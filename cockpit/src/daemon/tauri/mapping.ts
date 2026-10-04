/**
 * Adapter from the `agentuxd` API (`api.ts`) to the cockpit model (`../types.ts`).
 *
 * Mapping, field by field (API -> cockpit):
 *
 * Project
 *   id, name, path            -> same; createdAt dropped
 *
 * Run
 *   id, projectId, title, checks, gateAttempt/gateMaxAttempts,
 *   reviewRound/reviewMaxRounds, stepIndex, startedAt, updatedAt,
 *   activity                  -> same
 *   issue, prompt, branch, worktree, budgetUsd, finishedAt,
 *   pullRequest, error        -> null becomes undefined
 *   steps, step               -> unknown step kinds become `custom`
 *   status                    -> same; unknown values become `running`
 *   roles (role -> harness)   -> kept only for the cockpit's roles
 *                                (planner/implementer/reviewer) whose harness
 *                                is a known vendor (see `harnessToVendor`)
 *   sessions (role -> id)     -> same, every role (absent from old daemons: {})
 *   costUsd                   -> same (absent from old daemons: 0)
 *   check status              -> unknown values become `pending`
 *
 * PermissionRequest
 *   id, runId, projectId, title, detail, stepIndex, createdAt -> same
 *   kind                      -> `plan | step | permission | budget | question`;
 *                                unknown kinds become `step` (a plain approval)
 *   options                   -> same (absent from old daemons: [])
 *   status                    -> same; unknown become `cancelled` (resolved)
 *   step                      -> unknown kinds become `custom`
 *   sessionId, answer, resolvedAt -> null becomes undefined
 *
 * Session
 *   id, runId, projectId, role, harness, cwd, startedAt -> same
 *   vendor                    -> `harnessToVendor(harness)`, may be undefined
 *   model, endedAt            -> null becomes undefined
 *   state                     -> unknown values become `idle`
 *   usage                     -> usedTokens/contextTokens same, costUsd null
 *                                becomes undefined
 *   events                    -> built from `session_event` events (below);
 *                                kept when a session snapshot replaces the entry
 *   updatedAt                 -> dropped
 *
 * Session events (`session_event`), folded into `Session.events`:
 *   message                   -> appended; an agent message right after another
 *                                agent message is joined to it (the daemon cuts
 *                                long replies into ~4 KB chunks). `from`:
 *                                user (AgentUX's prompt), agent, system, human
 *                                (the cockpit user's `sessions.prompt`, shown
 *                                as their own bubble); unknown values: system
 *   tool_call                 -> the first event for a toolCallId adds an entry;
 *                                later ones update its tool/title/status/output
 *   diff                      -> appended with the whole texts (oldText null ->
 *                                undefined: a new file); the view computes the diff
 *   plan                      -> replaces the items of the session's plan entry
 *                                (the agent's plan replaces any earlier one)
 *   permission                -> appended once per request
 *   usage                     -> updates Session.usage, not shown as an entry
 *   Entries carry the event's seq; events with a seq at or below the last one
 *   folded into the session are ignored, so replays cannot duplicate entries.
 *
 * BusMessage (`bus.list`, `bus_message` events)
 *   id, runId, projectId, subject, body, at, turn, maxTurns -> same
 *   kind                      -> same; unknown kinds become `message`
 *   tool, messageId, exchange, inReplyTo, questionId, requestId,
 *   queuedForRole             -> null becomes undefined
 *   deliveredTo               -> same (missing: [])
 *   from, to                  -> session endpoints keep sessionId and role;
 *                                their `vendor` (the harness) becomes `harness`
 *                                plus the cockpit vendor; role/run/human/daemon
 *                                same; unknown endpoint kinds become `daemon`.
 *                                A session endpoint with only `sessionId` gets
 *                                role and harness from that session (or the
 *                                run's role -> session map), now or when the
 *                                session's snapshot arrives
 *   Entries are kept in `state.bus` by id (a replay or a later `bus.list`
 *   replaces, never duplicates), ordered by `at`. Routed entries (all but
 *   wake/joined/left and the refusals) from `bus_message` events are also added
 *   to the timeline of each session that sent or received them (`bus` entry).
 *
 * Other events: `project`, `run`, `request`, `session` replace the entry with
 * the same id. `attempt`, `log` and unknown kinds are ignored.
 */

import type {
  BusEndpoint,
  BusMessage,
  BusMessageKind,
  CheckStatus,
  CockpitState,
  PermissionRequest,
  PlanItem,
  Project,
  RequestKind,
  RequestStatus,
  Role,
  Run,
  RunStatus,
  Session,
  SessionEvent,
  SessionState,
  SessionUsage,
  StepKind,
  ToolKind,
  ToolStatus,
  Vendor,
} from "../types";
import { BUS_KINDS, BUS_SYSTEM_KINDS, BUS_WARNING_KINDS, MESSAGE_FROM, VENDORS } from "../types";
import type {
  ApiBusEndpoint,
  ApiBusMessage,
  ApiEvent,
  ApiProject,
  ApiRequest,
  ApiRun,
  ApiRunHistory,
  ApiSession,
  ApiSessionEvent,
  ApiSessionUsage,
  ApiSnapshot,
} from "./api";

const STEP_KINDS: readonly StepKind[] = ["plan", "implement", "gate", "review", "pull_request", "custom"];
const RUN_STATUSES: readonly RunStatus[] = ["running", "waiting", "done", "failed", "cancelled"];
const CHECK_STATUSES: readonly CheckStatus[] = ["pending", "running", "passed", "failed"];
const ROLES: readonly Role[] = ["planner", "implementer", "reviewer"];
const REQUEST_KINDS: readonly RequestKind[] = ["plan", "step", "permission", "budget", "question"];
const REQUEST_STATUSES: readonly RequestStatus[] = ["pending", "approved", "denied", "cancelled"];
const SESSION_STATES: readonly SessionState[] = ["active", "idle", "waiting", "ended"];
const TOOL_KINDS: readonly ToolKind[] = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "other"];
const TOOL_STATUSES: readonly ToolStatus[] = ["running", "ok", "error"];
const PLAN_STATUSES: readonly PlanItem["status"][] = ["pending", "in_progress", "done"];

/** Other names harness configs may use for the cockpit's vendors. */
const HARNESS_ALIASES: Record<string, Vendor> = {
  claude: "claude-code",
  "claude-code-acp": "claude-code",
  "codex-acp": "codex",
  agy: "antigravity",
};

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : undefined;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

/** The vendor a harness name stands for, or undefined if the cockpit does not know it. */
export function harnessToVendor(harness: string | null | undefined): Vendor | undefined {
  if (!harness) return undefined;
  const name = harness.trim().toLowerCase();
  return oneOf(VENDORS, name) ?? HARNESS_ALIASES[name];
}

export function mapStep(step: string): StepKind {
  return oneOf(STEP_KINDS, step) ?? "custom";
}

export function mapProject(p: ApiProject): Project {
  return { id: p.id, name: p.name, path: p.path };
}

export function mapRun(r: ApiRun): Run {
  const roles: Partial<Record<Role, Vendor>> = {};
  for (const [role, harness] of Object.entries(r.roles ?? {})) {
    const known = oneOf(ROLES, role);
    const vendor = harnessToVendor(harness);
    if (known && vendor) roles[known] = vendor;
  }
  const sessions: Record<string, string> = {};
  for (const [role, id] of Object.entries(r.sessions ?? {})) {
    if (typeof id === "string") sessions[role] = id;
  }
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title,
    issue: opt(r.issue),
    prompt: opt(r.prompt),
    branch: opt(r.branch),
    worktree: opt(r.worktree),
    steps: r.steps?.map(mapStep),
    stepIndex: r.stepIndex,
    step: mapStep(r.step),
    status: oneOf(RUN_STATUSES, r.status) ?? "running",
    roles,
    sessions,
    checks: (r.checks ?? []).map((c) => ({
      name: c.name,
      command: c.command,
      status: oneOf(CHECK_STATUSES, c.status) ?? "pending",
    })),
    gateAttempt: r.gateAttempt,
    gateMaxAttempts: r.gateMaxAttempts,
    reviewRound: r.reviewRound,
    reviewMaxRounds: r.reviewMaxRounds,
    budgetUsd: opt(r.budgetUsd),
    costUsd: typeof r.costUsd === "number" ? r.costUsd : 0,
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    finishedAt: opt(r.finishedAt),
    pullRequest: opt(r.pullRequest),
    activity: r.activity,
    error: opt(r.error),
  };
}

export function mapRequest(q: ApiRequest): PermissionRequest {
  return {
    id: q.id,
    kind: oneOf(REQUEST_KINDS, q.kind) ?? "step",
    runId: q.runId,
    projectId: q.projectId,
    sessionId: opt(q.sessionId),
    step: mapStep(q.step),
    stepIndex: q.stepIndex,
    title: q.title,
    detail: q.detail,
    options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : [],
    status: oneOf(REQUEST_STATUSES, q.status) ?? "cancelled",
    answer: opt(q.answer),
    createdAt: q.createdAt,
    resolvedAt: opt(q.resolvedAt),
  };
}

export function mapBusEndpoint(ep: ApiBusEndpoint | null | undefined): BusEndpoint {
  const e = (ep ?? {}) as { kind?: unknown; sessionId?: unknown; role?: unknown; vendor?: unknown };
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (e.kind) {
    case "session": {
      // Empty role / absent harness: not named, resolved from the run's sessions.
      const harness = str(e.vendor) || undefined;
      return {
        kind: "session",
        sessionId: str(e.sessionId) ?? "",
        role: str(e.role) ?? "",
        harness,
        vendor: harnessToVendor(harness),
      };
    }
    case "role":
      return { kind: "role", role: str(e.role) ?? "agent" };
    case "run":
      return { kind: "run" };
    case "human":
      return { kind: "human" };
    default:
      return { kind: "daemon" };
  }
}

export function mapBusMessage(m: ApiBusMessage): BusMessage {
  return {
    id: m.id,
    runId: m.runId,
    projectId: m.projectId,
    kind: oneOf(BUS_KINDS, m.kind) ?? "message",
    tool: opt(m.tool),
    from: mapBusEndpoint(m.from),
    to: mapBusEndpoint(m.to),
    subject: m.subject ?? "",
    body: m.body ?? "",
    at: m.at,
    turn: m.turn ?? 0,
    maxTurns: m.maxTurns ?? 0,
    messageId: opt(m.messageId),
    exchange: opt(m.exchange),
    inReplyTo: opt(m.inReplyTo),
    questionId: opt(m.questionId),
    requestId: opt(m.requestId),
    deliveredTo: Array.isArray(m.deliveredTo) ? m.deliveredTo : [],
    queuedForRole: opt(m.queuedForRole),
  };
}

/** Whether a session endpoint still lacks its role or harness. */
function unresolved(ep: BusEndpoint): boolean {
  return ep.kind === "session" && (!ep.role || !ep.harness);
}

/**
 * Fills the role, harness and vendor of a session endpoint that named only
 * its session (`{ kind: "session", sessionId }`), from the session's snapshot,
 * else from the run's role -> session map and the run's roles. Other
 * endpoints, and what cannot be found yet, are returned unchanged.
 */
export function resolveBusEndpoint(ep: BusEndpoint, runId: string, state: CockpitState): BusEndpoint {
  if (ep.kind !== "session" || !unresolved(ep)) return ep;
  const session = state.sessions[ep.sessionId];
  const run = state.runs[runId] ?? (session ? state.runs[session.runId] : undefined);
  const mapped = run ? Object.entries(run.sessions).find(([, id]) => id === ep.sessionId)?.[0] : undefined;
  // A placeholder (no snapshot yet) has no harness and only a guessed role.
  const known = session && session.harness ? session : undefined;
  const role = ep.role || known?.role || mapped || "";
  const harness = ep.harness ?? known?.harness;
  const vendor = ep.vendor ?? known?.vendor ?? harnessToVendor(harness) ?? (role ? run?.roles[role as Role] : undefined);
  if (role === ep.role && harness === ep.harness && vendor === ep.vendor) return ep;
  return { ...ep, role, harness, vendor };
}

function resolveBusMessage(m: BusMessage, state: CockpitState): BusMessage {
  const from = resolveBusEndpoint(m.from, m.runId, state);
  const to = resolveBusEndpoint(m.to, m.runId, state);
  return from === m.from && to === m.to ? m : { ...m, from, to };
}

/**
 * Re-resolves logged endpoints that still miss a role or harness, once the
 * sessions or runs they name are known (after a snapshot or a session
 * snapshot). `sessionId` limits it to the entries naming that session.
 */
export function refreshBusEndpoints(state: CockpitState, sessionId?: string): CockpitState {
  const names = (ep: BusEndpoint) =>
    unresolved(ep) && (sessionId === undefined || (ep.kind === "session" && ep.sessionId === sessionId));
  if (!state.bus.some((m) => names(m.from) || names(m.to))) return state;
  let changed = false;
  const bus = state.bus.map((m) => {
    if (!names(m.from) && !names(m.to)) return m;
    const next = resolveBusMessage(m, state);
    if (next !== m) changed = true;
    return next;
  });
  return changed ? { ...state, bus } : state;
}

function sameBus(a: BusMessage, b: BusMessage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Adds or replaces bus entries by id, keeping the log ordered by time (stable). */
export function mergeBus(current: BusMessage[], incoming: BusMessage[]): BusMessage[] {
  const byId = new Map(current.map((m) => [m.id, m] as const));
  let changed = false;
  for (const m of incoming) {
    const old = byId.get(m.id);
    if (old && sameBus(old, m)) continue;
    byId.set(m.id, m);
    changed = true;
  }
  if (!changed) return current;
  // Existing entries keep their order, new ones follow; the sort is stable.
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

/** Whether a bus entry is shown in the timelines of the sessions it involves. */
export function isRoutedBusKind(kind: BusMessageKind): boolean {
  return !BUS_SYSTEM_KINDS.includes(kind) && !BUS_WARNING_KINDS.includes(kind);
}

/** The sessions whose timeline shows `m`: its sender, a session recipient, the mailboxes it reached. */
function busSessions(m: BusMessage): string[] {
  const ids = new Set<string>(m.deliveredTo);
  if (m.from.kind === "session" && m.from.sessionId) ids.add(m.from.sessionId);
  if (m.to.kind === "session" && m.to.sessionId) ids.add(m.to.sessionId);
  return [...ids];
}

/** Applies bus entries: the run's log, plus a `bus` entry in each involved session's timeline. */
export function applyBusMessages(state: CockpitState, incoming: BusMessage[], seq?: number): CockpitState {
  const messages = incoming.map((m) => resolveBusMessage(m, state));
  const bus = mergeBus(state.bus, messages);
  let sessions = state.sessions;
  for (const m of messages) {
    if (!isRoutedBusKind(m.kind)) continue;
    for (const sid of busSessions(m)) {
      const current = sessions[sid] ?? placeholderSession(sid, m.runId, state);
      if (current.events.some((e) => e.kind === "bus" && e.messageId === m.id)) continue;
      const entry: SessionEvent = { id: `b${m.id}`, at: m.at, seq, kind: "bus", messageId: m.id };
      if (sessions === state.sessions) sessions = { ...sessions };
      sessions[sid] = { ...current, events: [...current.events, entry] };
    }
  }
  if (bus === state.bus && sessions === state.sessions) return state;
  return { ...state, bus, sessions };
}

/**
 * A run's log from `bus.list`. Only the log is updated: session timelines get
 * their bus entries from the run's events, in order with everything else.
 */
export function applyBusList(state: CockpitState, list: ApiBusMessage[]): CockpitState {
  const messages = list.filter((m) => m && typeof m.id === "string").map((m) => resolveBusMessage(mapBusMessage(m), state));
  const bus = mergeBus(state.bus, messages);
  return bus === state.bus ? state : { ...state, bus };
}

export function mapSessionUsage(u: ApiSessionUsage | null | undefined): SessionUsage {
  return {
    usedTokens: u?.usedTokens ?? 0,
    contextTokens: u?.contextTokens ?? 0,
    costUsd: typeof u?.costUsd === "number" ? u.costUsd : undefined,
  };
}

/** Maps a session snapshot; `previous` keeps the events already folded for it. */
export function mapSession(s: ApiSession, previous?: Session): Session {
  return {
    id: s.id,
    runId: s.runId,
    projectId: s.projectId,
    role: s.role,
    harness: s.harness,
    vendor: harnessToVendor(s.harness),
    model: opt(s.model),
    state: oneOf(SESSION_STATES, s.state) ?? "idle",
    cwd: s.cwd,
    events: previous?.events ?? [],
    lastSeq: previous?.lastSeq,
    usage: mapSessionUsage(s.usage),
    startedAt: s.startedAt,
    endedAt: opt(s.endedAt),
  };
}

/** A stand-in for a session whose snapshot has not arrived yet. */
function placeholderSession(id: string, runId: string | null, state: CockpitState): Session {
  const run = runId ? state.runs[runId] : undefined;
  const role = run ? Object.entries(run.sessions).find(([, sid]) => sid === id)?.[0] : undefined;
  return {
    id,
    runId: runId ?? "",
    projectId: run?.projectId ?? "",
    role: role ?? "agent",
    harness: "",
    state: "active",
    cwd: run?.worktree ?? "",
    events: [],
    usage: { usedTokens: 0, contextTokens: 0 },
    startedAt: 0,
  };
}

/** Folds one session event into the session's entries (see the table above). */
export function foldSessionEvent(session: Session, ev: ApiSessionEvent, seq: number, at: number): Session {
  if (session.lastSeq != null && seq <= session.lastSeq) return session;
  const next = { ...session, lastSeq: seq };
  const base = { id: `e${seq}`, at, seq };
  const events = session.events;
  switch (ev.kind) {
    case "message": {
      const from = oneOf(MESSAGE_FROM, ev.from) ?? "system";
      const last = events[events.length - 1];
      if (from === "agent" && last?.kind === "message" && last.from === "agent") {
        return { ...next, events: [...events.slice(0, -1), { ...last, text: last.text + ev.text }] };
      }
      return { ...next, events: [...events, { ...base, kind: "message", from, text: ev.text }] };
    }
    case "tool_call": {
      let i = events.length - 1;
      while (i >= 0 && !(events[i].kind === "tool_call" && (events[i] as { toolCallId: string }).toolCallId === ev.toolCallId)) i--;
      const tool = oneOf(TOOL_KINDS, ev.tool);
      const status = oneOf(TOOL_STATUSES, ev.status);
      if (i < 0) {
        const entry: SessionEvent = {
          ...base,
          kind: "tool_call",
          toolCallId: ev.toolCallId,
          tool: tool ?? "other",
          title: ev.title ?? ev.toolCallId,
          status: status ?? "running",
          output: ev.output,
        };
        return { ...next, events: [...events, entry] };
      }
      const old = events[i] as Extract<SessionEvent, { kind: "tool_call" }>;
      const updated: SessionEvent = {
        ...old,
        tool: tool ?? old.tool,
        title: ev.title ?? old.title,
        status: status ?? old.status,
        output: ev.output ?? old.output,
      };
      return { ...next, events: events.map((e, j) => (j === i ? updated : e)) };
    }
    case "diff":
      return {
        ...next,
        events: [
          ...events,
          { ...base, kind: "diff", toolCallId: ev.toolCallId, path: ev.path, oldText: opt(ev.oldText), newText: ev.newText },
        ],
      };
    case "plan": {
      const items: PlanItem[] = (ev.items ?? []).map((item) => ({
        text: item.text,
        status: oneOf(PLAN_STATUSES, item.status) ?? "pending",
      }));
      const i = events.findIndex((e) => e.kind === "plan");
      if (i < 0) return { ...next, events: [...events, { ...base, kind: "plan", items }] };
      return { ...next, events: events.map((e, j) => (j === i ? { ...e, kind: "plan", items, at } : e)) };
    }
    case "permission":
      if (events.some((e) => e.kind === "permission" && e.requestId === ev.requestId)) return next;
      return { ...next, events: [...events, { ...base, kind: "permission", requestId: ev.requestId }] };
    case "usage":
      return { ...next, usage: mapSessionUsage(ev.usage) };
    default:
      return next;
  }
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

/** Replaces projects, runs, requests and sessions with a fresh listing from the daemon. */
export function applySnapshot(state: CockpitState, snap: ApiSnapshot): CockpitState {
  return refreshBusEndpoints({
    ...state,
    projects: snap.projects.map(mapProject),
    runs: byId(snap.runs.map(mapRun)),
    requests: byId(snap.requests.map(mapRequest)),
    sessions: byId((snap.sessions ?? []).map((s) => mapSession(s, state.sessions[s.id]))),
  });
}

/**
 * Applies one daemon event. Returns the same state object when the event
 * changes nothing the cockpit shows, so listeners are not woken for nothing.
 */
export function applyEvent(state: CockpitState, event: ApiEvent): CockpitState {
  switch (event.kind) {
    case "project": {
      const project = mapProject((event as { project: ApiProject }).project);
      const i = state.projects.findIndex((p) => p.id === project.id);
      const projects = i < 0 ? [...state.projects, project] : state.projects.map((p, j) => (j === i ? project : p));
      return { ...state, projects };
    }
    case "run": {
      const run = mapRun((event as { run: ApiRun }).run);
      return { ...state, runs: { ...state.runs, [run.id]: run } };
    }
    case "request": {
      const request = mapRequest((event as { request: ApiRequest }).request);
      return { ...state, requests: { ...state.requests, [request.id]: request } };
    }
    case "session": {
      const api = (event as { session: ApiSession }).session;
      const session = mapSession(api, state.sessions[api.id]);
      return refreshBusEndpoints({ ...state, sessions: { ...state.sessions, [session.id]: session } }, session.id);
    }
    case "session_event": {
      const { sessionId, event: ev } = event as { sessionId: string; event: ApiSessionEvent };
      if (!sessionId || !ev) return state;
      const current = state.sessions[sessionId] ?? placeholderSession(sessionId, event.runId, state);
      const session = foldSessionEvent(current, ev, event.seq, event.at);
      if (session === current && state.sessions[sessionId]) return state;
      return { ...state, sessions: { ...state.sessions, [sessionId]: session } };
    }
    case "bus_message": {
      const message = (event as { message?: ApiBusMessage }).message;
      if (!message || typeof message.id !== "string") return state;
      return applyBusMessages(state, [mapBusMessage(message)], event.seq);
    }
    default:
      return state;
  }
}

/**
 * Rebuilds the entries of every session of `runId` from its stored events.
 * Only `session_event`s and `bus_message`s are used: snapshots in the
 * history are older than what the state already holds. Live events with a seq above `history.head`
 * must be applied again afterwards (the client does).
 */
export function applyRunHistory(state: CockpitState, runId: string, history: ApiRunHistory): CockpitState {
  const sessions = { ...state.sessions };
  for (const [id, s] of Object.entries(sessions)) {
    if (s.runId === runId) sessions[id] = { ...s, events: [], lastSeq: undefined };
  }
  let next: CockpitState = { ...state, sessions };
  for (const event of history.events) {
    if ((event.kind === "session_event" || event.kind === "bus_message") && event.seq <= history.head) {
      next = applyEvent(next, event);
    }
  }
  // Usage comes from the session snapshots, which are newer than the history.
  for (const [id, s] of Object.entries(state.sessions)) {
    if (s.runId === runId && next.sessions[id]) next.sessions[id] = { ...next.sessions[id], usage: s.usage };
  }
  return next;
}

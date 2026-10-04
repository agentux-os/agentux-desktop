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
 *   kind                      -> `plan | step | permission | budget`; unknown
 *                                kinds become `step` (a plain approval)
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
 *                                long replies into ~4 KB chunks)
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
 * Other events: `project`, `run`, `request`, `session` replace the entry with
 * the same id. `attempt`, `log` and unknown kinds are ignored.
 *
 * Not provided by the daemon (left empty): agent-bus messages.
 */

import type {
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
import { VENDORS } from "../types";
import type {
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
const REQUEST_KINDS: readonly RequestKind[] = ["plan", "step", "permission", "budget"];
const REQUEST_STATUSES: readonly RequestStatus[] = ["pending", "approved", "denied", "cancelled"];
const SESSION_STATES: readonly SessionState[] = ["active", "idle", "waiting", "ended"];
const TOOL_KINDS: readonly ToolKind[] = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "other"];
const TOOL_STATUSES: readonly ToolStatus[] = ["running", "ok", "error"];
const PLAN_STATUSES: readonly PlanItem["status"][] = ["pending", "in_progress", "done"];
const MESSAGE_FROM = ["user", "agent", "system"] as const;

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
    status: oneOf(REQUEST_STATUSES, q.status) ?? "cancelled",
    answer: opt(q.answer),
    createdAt: q.createdAt,
    resolvedAt: opt(q.resolvedAt),
  };
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
  return {
    ...state,
    projects: snap.projects.map(mapProject),
    runs: byId(snap.runs.map(mapRun)),
    requests: byId(snap.requests.map(mapRequest)),
    sessions: byId((snap.sessions ?? []).map((s) => mapSession(s, state.sessions[s.id]))),
  };
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
      return { ...state, sessions: { ...state.sessions, [session.id]: session } };
    }
    case "session_event": {
      const { sessionId, event: ev } = event as { sessionId: string; event: ApiSessionEvent };
      if (!sessionId || !ev) return state;
      const current = state.sessions[sessionId] ?? placeholderSession(sessionId, event.runId, state);
      const session = foldSessionEvent(current, ev, event.seq, event.at);
      if (session === current && state.sessions[sessionId]) return state;
      return { ...state, sessions: { ...state.sessions, [sessionId]: session } };
    }
    default:
      return state;
  }
}

/**
 * Rebuilds the entries of every session of `runId` from its stored events.
 * Only `session_event`s are used: snapshots in the history are older than
 * what the state already holds. Live events with a seq above `history.head`
 * must be applied again afterwards (the client does).
 */
export function applyRunHistory(state: CockpitState, runId: string, history: ApiRunHistory): CockpitState {
  const sessions = { ...state.sessions };
  for (const [id, s] of Object.entries(sessions)) {
    if (s.runId === runId) sessions[id] = { ...s, events: [], lastSeq: undefined };
  }
  let next: CockpitState = { ...state, sessions };
  for (const event of history.events) {
    if (event.kind === "session_event" && event.seq <= history.head) next = applyEvent(next, event);
  }
  // Usage comes from the session snapshots, which are newer than the history.
  for (const [id, s] of Object.entries(state.sessions)) {
    if (s.runId === runId && next.sessions[id]) next.sessions[id] = { ...next.sessions[id], usage: s.usage };
  }
  return next;
}

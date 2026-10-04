/**
 * Adapter from the `agentuxd` API (`api.ts`) to the cockpit model (`../types.ts`).
 *
 * Mapping, field by field (API -> cockpit):
 *
 * Project
 *   id, name, path            -> same
 *   createdAt                 -> dropped (not shown)
 *   repo, language            -> left undefined until the daemon sends them
 *
 * Run
 *   id, projectId, title, checks, gateAttempt/gateMaxAttempts,
 *   reviewRound/reviewMaxRounds, startedAt, updatedAt, activity -> same
 *   issue, prompt, branch, worktree, budgetUsd, finishedAt,
 *   pullRequest, error        -> null becomes undefined
 *   steps, step               -> unknown step kinds become `custom`
 *   stepIndex                 -> same
 *   status                    -> same; unknown values become `running`
 *   roles (role -> harness)   -> kept only for the cockpit's roles
 *                                (planner/implementer/reviewer) whose harness
 *                                is a known vendor (see `harnessToVendor`)
 *   sessions                  -> role -> session id when sent, else {}
 *   usage                     -> TokenUsage when sent, else undefined
 *   check status              -> unknown values become `pending`
 *
 * PermissionRequest
 *   id, runId, projectId, title, detail, createdAt -> same
 *   kind                      -> same for known kinds; unknown become `step`
 *   status                    -> same for known statuses; unknown become
 *                                `cancelled` (treated as resolved)
 *   step                      -> same (unknown -> `custom`)
 *   answer, resolvedAt        -> null becomes undefined
 *   sessionId, vendor (or harness), role, options -> when sent and valid,
 *                                else undefined (pipeline approvals have none)
 *   stepIndex                 -> dropped
 *
 * Events: `project`, `run`, `request` replace the entry with the same id.
 * `attempt` and `log` carry nothing the UI shows yet (the run snapshot that
 * follows has the activity line); they and unknown kinds are ignored.
 *
 * Not provided by the daemon (left empty): sessions and session events, agent
 * bus messages, per-vendor spend.
 */

import type {
  CheckStatus,
  CockpitState,
  PermissionRequest,
  Project,
  RequestKind,
  RequestStatus,
  Role,
  Run,
  RunStatus,
  StepKind,
  TokenUsage,
  Vendor,
} from "../types";
import { VENDORS } from "../types";
import type { ApiEvent, ApiProject, ApiRequest, ApiRun, ApiSnapshot, ApiUsage } from "./api";

const STEP_KINDS: readonly StepKind[] = ["plan", "implement", "gate", "review", "pull_request", "custom"];
const RUN_STATUSES: readonly RunStatus[] = ["running", "waiting", "done", "failed", "cancelled"];
const CHECK_STATUSES: readonly CheckStatus[] = ["pending", "running", "passed", "failed"];
const ROLES: readonly Role[] = ["planner", "implementer", "reviewer"];
const REQUEST_KINDS: readonly RequestKind[] = ["plan", "step", "command", "edit", "network", "question", "budget"];
const REQUEST_STATUSES: readonly RequestStatus[] = ["pending", "approved", "denied", "answered", "cancelled"];

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

export function mapUsage(usage: ApiUsage | null | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return { input: usage.input ?? 0, output: usage.output ?? 0, costUsd: usage.costUsd ?? 0 };
}

export function mapProject(p: ApiProject): Project {
  return { id: p.id, name: p.name, path: p.path, repo: opt(p.repo), language: opt(p.language) };
}

export function mapRun(r: ApiRun): Run {
  const roles: Partial<Record<Role, Vendor>> = {};
  for (const [role, harness] of Object.entries(r.roles ?? {})) {
    const known = oneOf(ROLES, role);
    const vendor = harnessToVendor(harness);
    if (known && vendor) roles[known] = vendor;
  }
  const sessions: Partial<Record<Role, string>> = {};
  for (const [role, id] of Object.entries(r.sessions ?? {})) {
    const known = oneOf(ROLES, role);
    if (known && typeof id === "string") sessions[known] = id;
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
    usage: mapUsage(r.usage),
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    finishedAt: opt(r.finishedAt),
    pullRequest: opt(r.pullRequest),
    activity: r.activity,
    error: opt(r.error),
  };
}

export function mapRequest(q: ApiRequest): PermissionRequest {
  const options = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : [];
  return {
    id: q.id,
    kind: oneOf(REQUEST_KINDS, q.kind) ?? "step",
    runId: q.runId,
    projectId: q.projectId,
    sessionId: opt(q.sessionId),
    vendor: harnessToVendor(q.vendor ?? q.harness),
    role: oneOf(ROLES, q.role),
    step: q.step ? mapStep(q.step) : undefined,
    title: q.title,
    detail: q.detail,
    options: options.length ? options : undefined,
    status: oneOf(REQUEST_STATUSES, q.status) ?? "cancelled",
    answer: opt(q.answer),
    createdAt: q.createdAt,
    resolvedAt: opt(q.resolvedAt),
  };
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

/** Replaces projects, runs and requests with a fresh listing from the daemon. */
export function applySnapshot(state: CockpitState, snap: ApiSnapshot): CockpitState {
  return {
    ...state,
    projects: snap.projects.map(mapProject),
    runs: byId(snap.runs.map(mapRun)),
    requests: byId(snap.requests.map(mapRequest)),
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
    default:
      return state;
  }
}

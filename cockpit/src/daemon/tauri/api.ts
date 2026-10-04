/**
 * Wire types of the `agentuxd` API (agentux-core `docs/api.md`, crate
 * `agentux-api`). These are what the Tauri backend forwards untouched; the
 * adapter in `mapping.ts` turns them into the cockpit model in `../types.ts`.
 *
 * Enum values are typed as `string`: the adapter maps unknown values to a
 * safe default instead of failing, so a newer daemon does not break the
 * cockpit. Fields added by the ACP executor (agentux-core #6) are optional so
 * older daemons still work.
 */

export interface ApiProject {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface ApiCheck {
  name: string;
  command: string;
  /** `pending | running | passed | failed` */
  status: string;
}

export interface ApiRun {
  id: string;
  projectId: string;
  title: string;
  prompt: string | null;
  issue: number | null;
  branch: string | null;
  worktree: string | null;
  steps: string[];
  stepIndex: number;
  step: string;
  /** `running | waiting | done | failed | cancelled` */
  status: string;
  /** Role name -> harness id (free-form role names). */
  roles: Record<string, string>;
  /**
   * Role name -> session id, as the run reaches each role. Daemons before the
   * ACP executor (agentux-core #6) do not send it.
   */
  sessions?: Record<string, string>;
  checks: ApiCheck[];
  gateAttempt: number;
  gateMaxAttempts: number;
  reviewRound: number;
  reviewMaxRounds: number;
  /** `budget.max_usd_per_run`, raised by that much per approved overrun. */
  budgetUsd: number | null;
  /** Sum of the sessions' reported cost; absent before agentux-core #6. */
  costUsd?: number;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  pullRequest: { number: number; url: string } | null;
  activity: string;
  error: string | null;
}

export interface ApiRequest {
  id: string;
  /** `plan | step | permission | budget` */
  kind: string;
  runId: string;
  projectId: string;
  /** The session that asked, for `permission` requests (absent before agentux-core #6). */
  sessionId?: string | null;
  stepIndex: number;
  step: string;
  title: string;
  detail: string;
  /** `pending | approved | denied | cancelled` */
  status: string;
  answer: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ApiAttempt {
  id: number;
  runId: string;
  stepIndex: number;
  step: string;
  status: string;
  output: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** ACP reports context-window usage and cumulative cost, not input/output counts. */
export interface ApiSessionUsage {
  usedTokens: number;
  contextTokens: number;
  costUsd: number | null;
}

export interface ApiSession {
  id: string;
  runId: string;
  projectId: string;
  role: string;
  /** Harness id, e.g. `codex` (the cockpit's vendor). */
  harness: string;
  model: string | null;
  /** `active | idle | waiting | ended` */
  state: string;
  cwd: string;
  usage: ApiSessionUsage;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
}

/**
 * What happened in a session (`session_event` payload). A tool call's first
 * event has `tool` and `title`; later ones carry only what changed.
 */
export type ApiSessionEvent =
  | { kind: "message"; from: string; text: string }
  | { kind: "tool_call"; toolCallId: string; tool?: string; title?: string; status?: string; output?: string }
  | { kind: "diff"; toolCallId: string; path: string; oldText: string | null; newText: string }
  | { kind: "plan"; items: { text: string; status: string }[] }
  | { kind: "permission"; requestId: string }
  | { kind: "usage"; usage: ApiSessionUsage };

interface ApiEventBase {
  seq: number;
  at: number;
  runId: string | null;
}

export type ApiEvent =
  | (ApiEventBase & { kind: "project"; project: ApiProject })
  | (ApiEventBase & { kind: "run"; run: ApiRun })
  | (ApiEventBase & { kind: "request"; request: ApiRequest })
  | (ApiEventBase & { kind: "attempt"; attempt: ApiAttempt })
  | (ApiEventBase & { kind: "log"; text: string })
  | (ApiEventBase & { kind: "session"; session: ApiSession })
  | (ApiEventBase & { kind: "session_event"; sessionId: string; event: ApiSessionEvent })
  /** Event kinds added by newer daemons are passed through and ignored. */
  | (ApiEventBase & { kind: string; [key: string]: unknown });

/** What `daemon_snapshot` returns: the list calls in one round trip. */
export interface ApiSnapshot {
  projects: ApiProject[];
  runs: ApiRun[];
  requests: ApiRequest[];
  /** `sessions.list`; empty from daemons that do not serve it. */
  sessions?: ApiSession[];
}

/**
 * What `daemon_run_history` returns: the run's stored events up to `head`
 * (the daemon's newest seq when it was asked), oldest first.
 */
export interface ApiRunHistory {
  head: number;
  events: ApiEvent[];
}

/** `daemon://status`, from the backend's event stream (`stream.rs`). */
export interface LinkStatus {
  state: "connecting" | "connected" | "disconnected";
  socket: string | null;
  detail: string;
  lastSeq: number | null;
  retryInMs: number | null;
}

/** Result of `daemon_probe`. */
export interface Probe {
  reachable: boolean;
  socket: string | null;
  detail: string;
}

/** Error returned by every `daemon_*` command (`CommandError` in client.rs). */
export interface CommandError {
  code: number | null;
  message: string;
  unavailable: boolean;
}

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
  /** `plan | step | permission | budget | question` */
  kind: string;
  runId: string;
  projectId: string;
  /** The session that asked, for `permission` and `question` requests (absent before agentux-core #6). */
  sessionId?: string | null;
  stepIndex: number;
  step: string;
  title: string;
  detail: string;
  /** Suggested answers of a `question`; [] otherwise (absent before agentux-core 0.2.0). */
  options?: string[];
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
  /** `active | idle | waiting | attached | ended` (`attached` from agentux-core #11) */
  state: string;
  cwd: string;
  usage: ApiSessionUsage;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  /** The harness's own session id (agentux-core #11); null until started. */
  vendorSessionId?: string | null;
}

/** A process on a daemon-managed pseudo-terminal (`terminals.*`, agentux-core #11). */
export interface ApiTerminal {
  terminalId: string;
  sessionId: string | null;
  runId: string | null;
  /** `harness-tui | shell`: what actually runs (a fallback is `shell`). */
  command: string;
  /** Why a harness-tui request got a shell. */
  fallback: string | null;
  argv: string[];
  cwd: string;
  cols: number;
  rows: number;
  /** `waiting | running | exited` */
  state: string;
  exitCode: number | null;
  createdAt: number;
  /** Added by the backend's `terminal_list`: this cockpit opened it and owns it. */
  held?: boolean;
}

/**
 * What the backend emits on `terminal://<stream>` (`terminal.rs`): output
 * (base64 of raw bytes), the exit (the last event; `code` null when killed
 * by a signal), or the connection lost without an exit.
 */
export type ApiTerminalEvent =
  | { kind: "output"; terminalId: string; data: string }
  | { kind: "exit"; terminalId: string; code: number | null }
  | { kind: "closed"; terminalId: string; reason: string };

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

/**
 * `{ kind: "session" | "role" | "run" | "human" | "daemon", ... }`; `vendor`
 * is the harness. A session endpoint may name only `sessionId` (as `bus.post`
 * accepts it); the cockpit then takes role and harness from the run's sessions.
 */
export type ApiBusEndpoint =
  | { kind: "session"; sessionId: string; role?: string; vendor?: string }
  | { kind: "role"; role: string }
  | { kind: "run" }
  | { kind: "human" }
  | { kind: "daemon" }
  | { kind: string; [key: string]: unknown };

/** One entry of a run's agent bus log (`bus.list`, `bus_message` events). */
export interface ApiBusMessage {
  id: string;
  runId: string;
  projectId: string;
  /** `message | review_request | handoff | human_answer | question | answer | wake | turn_limit | tool_denied | joined | left` */
  kind: string;
  tool: string | null;
  from: ApiBusEndpoint;
  to: ApiBusEndpoint;
  subject: string;
  body: string;
  at: number;
  turn: number;
  maxTurns: number;
  messageId: number | null;
  exchange: number | null;
  inReplyTo: number | null;
  questionId: number | null;
  requestId: string | null;
  deliveredTo: string[];
  queuedForRole: string | null;
}

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
  | (ApiEventBase & { kind: "bus_message"; message: ApiBusMessage })
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
 * What `daemon_run_history` returns: every stored event of the run up to
 * `head`, oldest first. Events with a higher seq come on the live stream.
 * `source`: `runs.events` (paged, then continued with
 * `events.subscribe { runId, since: headSeq }` up to its `replay_done`), or
 * `replay` (daemons before agentux-core #9: a replayed subscription).
 */
export interface ApiRunHistory {
  head: number;
  events: ApiEvent[];
  source?: "runs.events" | "replay";
}

/** One page of `runs.events { runId, sinceSeq?, limit? }`. */
export interface ApiRunEventsPage {
  events: ApiEvent[];
  more: boolean;
  /** Newest seq in the whole log when the page was read. */
  headSeq: number;
}

/** `bus.post` target: `role` and `vendor` of a session may be omitted. */
export type ApiBusTarget = { kind: "session"; sessionId: string } | { kind: "role"; role: string } | { kind: "run" };

/** Result of `bus.post` (`daemon_bus_post`). */
export interface ApiBusPostResult {
  messageId: number;
  exchange: number;
  turn: number;
  deliveredTo: string[];
  queuedForRole: string | null;
}

/**
 * Result of `daemon_capabilities`: which optional methods the daemon serves
 * (probed; a daemon without them answers -32601).
 */
export interface ApiCapabilities {
  sessionsPrompt: boolean;
  busPost: boolean;
  /** `terminals.*` (absent from backends before 0.4.0). */
  terminals?: boolean;
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

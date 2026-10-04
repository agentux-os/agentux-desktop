/**
 * Wire types of the `agentuxd` API (agentux-core `docs/api.md`, crate
 * `agentux-api`). These are what the Tauri backend forwards untouched; the
 * adapter in `mapping.ts` turns them into the cockpit model in `../types.ts`.
 *
 * Fields marked "not sent yet" are anticipated additions (harness sessions,
 * permission requests from agents, token usage). They are optional so the
 * cockpit works with daemons that do and do not send them.
 */

export interface ApiProject {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /** Not sent yet. */
  repo?: string | null;
  /** Not sent yet. */
  language?: string | null;
}

export interface ApiCheck {
  name: string;
  command: string;
  status: string;
}

export interface ApiUsage {
  input?: number;
  output?: number;
  costUsd?: number;
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
  status: string;
  /** Role name -> harness name (free-form role names). */
  roles: Record<string, string>;
  checks: ApiCheck[];
  gateAttempt: number;
  gateMaxAttempts: number;
  reviewRound: number;
  reviewMaxRounds: number;
  budgetUsd: number | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  pullRequest: { number: number; url: string } | null;
  activity: string;
  error: string | null;
  /** Not sent yet: role -> harness session id. */
  sessions?: Record<string, string> | null;
  /** Not sent yet: token usage of the whole run. */
  usage?: ApiUsage | null;
}

export interface ApiRequest {
  id: string;
  /** `plan | step` today; agent requests (`command`, `edit`, ...) may follow. */
  kind: string;
  runId: string;
  projectId: string;
  stepIndex: number;
  step: string;
  title: string;
  detail: string;
  /** `pending | approved | denied | cancelled`. */
  status: string;
  answer: string | null;
  createdAt: number;
  resolvedAt: number | null;
  /** Not sent yet: for requests raised by a harness session. */
  sessionId?: string | null;
  /** Not sent yet: harness name (or `vendor`). */
  harness?: string | null;
  vendor?: string | null;
  role?: string | null;
  /** Not sent yet: answers to pick from, for questions. */
  options?: string[] | null;
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
  /** Event kinds added by newer daemons are passed through and ignored. */
  | (ApiEventBase & { kind: string; [key: string]: unknown });

/** What `daemon_snapshot` returns: the three list calls in one round trip. */
export interface ApiSnapshot {
  projects: ApiProject[];
  runs: ApiRun[];
  requests: ApiRequest[];
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

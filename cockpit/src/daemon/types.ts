/**
 * Domain model the cockpit renders. It mirrors what `agentuxd` exposes
 * (ADR 0004 / 0005): projects, runs moving through pipeline steps, harness
 * sessions with vendor-neutral events, permission requests, and agent-bus
 * messages. Nothing here is vendor-specific beyond the `Vendor` tag.
 *
 * Optional fields are ones the daemon API does not provide (yet); the mock
 * fills them, the real client leaves them out (see `tauri/mapping.ts`).
 */

export type Vendor = "claude-code" | "codex" | "opencode" | "antigravity";

export const VENDORS: readonly Vendor[] = ["claude-code", "codex", "opencode", "antigravity"];

/** Pipeline step types from ADR 0005. `custom` steps run an agent with a free-form prompt. */
export type StepKind = "plan" | "implement" | "gate" | "review" | "pull_request" | "custom";

/** The default pipeline, used for board columns and when a run does not list its steps. */
export const STEPS: readonly StepKind[] = ["plan", "implement", "gate", "review", "pull_request"];

export type Role = "planner" | "implementer" | "reviewer";

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled";

export interface Project {
  id: string;
  name: string;
  /** Path on the local machine, e.g. ~/src/ledger-api */
  path: string;
  /** owner/name on the forge. Not reported by agentuxd yet. */
  repo?: string;
  /** Not reported by agentuxd yet. */
  language?: string;
}

export type CheckStatus = "pending" | "running" | "passed" | "failed";

export interface CheckResult {
  name: string;
  command: string;
  status: CheckStatus;
}

export interface TokenUsage {
  input: number;
  output: number;
  costUsd: number;
}

export interface Run {
  id: string;
  projectId: string;
  title: string;
  /** Forge issue the run works on; absent for prompt-only runs. */
  issue?: number;
  /** The prompt the run was started with, if any. */
  prompt?: string;
  /** `aux/<run-id>`, set once the worktree exists. */
  branch?: string;
  worktree?: string;
  /** The run's pipeline, when known. Defaults to `STEPS`. */
  steps?: StepKind[];
  /** Index into `steps` of the current step. */
  stepIndex?: number;
  step: StepKind;
  status: RunStatus;
  /** Harness per role. Roles whose harness is not a known vendor are left out. */
  roles: Partial<Record<Role, Vendor>>;
  /** Session id per role, filled as the run reaches each role. */
  sessions: Partial<Record<Role, string>>;
  checks: CheckResult[];
  gateAttempt: number;
  gateMaxAttempts: number;
  reviewRound: number;
  reviewMaxRounds: number;
  /** Per-run budget; absent when none is configured. */
  budgetUsd?: number;
  /** Absent until the daemon reports usage. */
  usage?: TokenUsage;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  pullRequest?: { number: number; url: string };
  /** Short human-readable line of what is happening right now. */
  activity: string;
  /** Why the run failed, if it did. */
  error?: string;
}

export type SessionState = "active" | "idle" | "waiting" | "ended";

export interface Session {
  id: string;
  runId: string;
  projectId: string;
  role: Role;
  vendor: Vendor;
  model: string;
  state: SessionState;
  /** Path of the git worktree the harness works in. */
  cwd: string;
  events: SessionEvent[];
  usage: TokenUsage;
  startedAt: number;
}

export interface DiffLine {
  kind: "ctx" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export type ToolKind = "read" | "search" | "edit" | "execute" | "fetch" | "bus";

export interface PlanItem {
  text: string;
  status: "pending" | "in_progress" | "done";
}

interface EventBase {
  id: string;
  at: number;
}

/**
 * Vendor-neutral session events. These map onto ACP session updates
 * (agent message chunks, tool calls, plans, permission requests).
 */
export type SessionEvent =
  | (EventBase & { kind: "message"; from: "user" | "agent" | "system"; text: string })
  | (EventBase & {
      kind: "tool_call";
      tool: ToolKind;
      title: string;
      status: "running" | "ok" | "error";
      input?: string;
      output?: string;
    })
  | (EventBase & { kind: "diff"; diff: FileDiff })
  | (EventBase & { kind: "plan"; items: PlanItem[] })
  | (EventBase & { kind: "permission"; requestId: string })
  | (EventBase & { kind: "bus"; messageId: string });

/** `step` is a pipeline approval for a step other than the plan. */
export type RequestKind = "plan" | "step" | "command" | "edit" | "network" | "question" | "budget";

/** `cancelled`: the run was cancelled while the request was pending. */
export type RequestStatus = "pending" | "approved" | "denied" | "answered" | "cancelled";

export interface PermissionRequest {
  id: string;
  kind: RequestKind;
  runId: string;
  projectId: string;
  /** Absent for pipeline approvals, which do not come from a harness session. */
  sessionId?: string;
  vendor?: Vendor;
  role?: Role;
  /** Pipeline step the request belongs to, when known. */
  step?: StepKind;
  title: string;
  /** Command line, file path, URL or question body. */
  detail: string;
  /** For `question` requests: answers the human can pick (first = suggested). */
  options?: string[];
  status: RequestStatus;
  answer?: string;
  createdAt: number;
  resolvedAt?: number;
}

export type BusTool = "post_message" | "request_review" | "handoff" | "ask_human";

export type BusEndpoint =
  | { kind: "session"; sessionId: string; role: Role; vendor: Vendor }
  | { kind: "human" }
  | { kind: "daemon" };

export interface BusMessage {
  id: string;
  runId: string;
  projectId: string;
  tool: BusTool;
  from: BusEndpoint;
  to: BusEndpoint;
  subject: string;
  body: string;
  at: number;
  /** Turn number within this exchange, and the configured limit. */
  turn: number;
  maxTurns: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface Connection {
  status: ConnectionStatus;
  /** Short name of what the cockpit is connected to ("mock", or the socket path). */
  daemon: string;
  detail: string;
  /** True when the cockpit shows mock data instead of a real daemon. */
  mock: boolean;
  /** Why the mock is shown although the cockpit runs inside Tauri (daemon unreachable). */
  fallbackReason?: string;
}

export interface CockpitState {
  connection: Connection;
  projects: Project[];
  runs: Record<string, Run>;
  sessions: Record<string, Session>;
  requests: Record<string, PermissionRequest>;
  /** Oldest first. */
  bus: BusMessage[];
  spend: Record<Vendor, TokenUsage>;
}

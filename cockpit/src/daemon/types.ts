/**
 * Domain model the cockpit renders. It mirrors what `agentuxd` will expose
 * (ADR 0004 / 0005): projects, runs moving through pipeline steps, harness
 * sessions with vendor-neutral events, permission requests, and agent-bus
 * messages. Nothing here is vendor-specific beyond the `Vendor` tag.
 */

export type Vendor = "claude-code" | "codex" | "opencode" | "antigravity";

export const VENDORS: readonly Vendor[] = ["claude-code", "codex", "opencode", "antigravity"];

/** Fixed pipeline step types from ADR 0005. */
export type StepKind = "plan" | "implement" | "gate" | "review" | "pull_request";

export const STEPS: readonly StepKind[] = ["plan", "implement", "gate", "review", "pull_request"];

export type Role = "planner" | "implementer" | "reviewer";

export type RunStatus = "running" | "waiting" | "done" | "failed";

export interface Project {
  id: string;
  name: string;
  /** Path on the local machine, e.g. ~/src/ledger-api */
  path: string;
  /** owner/name on the forge */
  repo: string;
  language: string;
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
  issue: number;
  branch: string;
  step: StepKind;
  status: RunStatus;
  roles: Record<Role, Vendor>;
  /** Session id per role, filled as the run reaches each role. */
  sessions: Partial<Record<Role, string>>;
  checks: CheckResult[];
  gateAttempt: number;
  gateMaxAttempts: number;
  reviewRound: number;
  reviewMaxRounds: number;
  budgetUsd: number;
  usage: TokenUsage;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  pullRequest?: { number: number; url: string };
  /** Short human-readable line of what is happening right now. */
  activity: string;
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

export type RequestKind = "plan" | "command" | "edit" | "network" | "question" | "budget";

export type RequestStatus = "pending" | "approved" | "denied" | "answered";

export interface PermissionRequest {
  id: string;
  kind: RequestKind;
  runId: string;
  projectId: string;
  sessionId: string;
  vendor: Vendor;
  role: Role;
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

export interface CockpitState {
  connection: { status: ConnectionStatus; daemon: string; detail: string };
  projects: Project[];
  runs: Record<string, Run>;
  sessions: Record<string, Session>;
  requests: Record<string, PermissionRequest>;
  /** Oldest first. */
  bus: BusMessage[];
  spend: Record<Vendor, TokenUsage>;
}

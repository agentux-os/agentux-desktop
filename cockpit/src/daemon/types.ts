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

/**
 * What a harness reports about its session over ACP: context-window usage and,
 * for some harnesses, the cumulative cost. There are no input/output counts.
 */
export interface SessionUsage {
  /** Tokens currently in the context window. */
  usedTokens: number;
  /** Size of the context window (0 until reported). */
  contextTokens: number;
  /** Cumulative session cost in USD; absent when the harness does not report it. */
  costUsd?: number;
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
  /** Session id per role name (free-form), filled as the run reaches each role. */
  sessions: Record<string, string>;
  checks: CheckResult[];
  gateAttempt: number;
  gateMaxAttempts: number;
  reviewRound: number;
  reviewMaxRounds: number;
  /** Per-run budget; absent when none is configured. */
  budgetUsd?: number;
  /** Sum of the sessions' reported cost (0 if none reports it). */
  costUsd: number;
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
  /** Role name from the pipeline; usually one of `Role`, but custom roles exist. */
  role: string;
  /** Harness id as configured (e.g. `codex`). */
  harness: string;
  /** The cockpit vendor the harness stands for; absent for unknown harnesses. */
  vendor?: Vendor;
  model?: string;
  state: SessionState;
  /** Path of the git worktree the harness works in. */
  cwd: string;
  events: SessionEvent[];
  usage: SessionUsage;
  startedAt: number;
  endedAt?: number;
  /** Daemon only: seq of the last event folded into `events`, to skip replays. */
  lastSeq?: number;
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

/** ACP tool kinds as agentuxd reports them, plus the cockpit's own `bus`. */
export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other" | "bus";

export type ToolStatus = "running" | "ok" | "error";

export interface PlanItem {
  text: string;
  status: "pending" | "in_progress" | "done";
}

interface EventBase {
  id: string;
  at: number;
  /** Daemon event `seq` the entry was built from (absent in mock data). */
  seq?: number;
}

/**
 * Vendor-neutral session events, as agentuxd records them from ACP session
 * updates. Agent message chunks arrive coalesced; a tool call is one entry
 * whose status and output are updated in place; the plan is one entry that
 * each new plan replaces; usage updates go to `Session.usage`, not here.
 */
/**
 * Who wrote a session message: `user` is the prompt AgentUX sent (a step's
 * prompt, a bus wake), `human` is what the person at the cockpit typed into
 * the session (`sessions.prompt`), `agent` the harness's reply, `system` a
 * note.
 */
export type MessageFrom = "user" | "agent" | "system" | "human";

export const MESSAGE_FROM: readonly MessageFrom[] = ["user", "agent", "system", "human"];

export type SessionEvent =
  | (EventBase & { kind: "message"; from: MessageFrom; text: string })
  | (EventBase & {
      kind: "tool_call";
      toolCallId: string;
      tool: ToolKind;
      title: string;
      status: ToolStatus;
      /** Mock only: what the tool was called with. */
      input?: string;
      output?: string;
    })
  /** A file edit: whole texts, not hunks (`oldText` absent for a new file). */
  | (EventBase & { kind: "diff"; toolCallId?: string; path: string; oldText?: string; newText: string })
  | (EventBase & { kind: "plan"; items: PlanItem[] })
  | (EventBase & { kind: "permission"; requestId: string })
  | (EventBase & { kind: "bus"; messageId: string });

/**
 * `plan`: approve the plan; `step`: any other `approve: true` step;
 * `permission`: an agent asks before a tool call; `budget`: the run is over
 * its budget (approving extends it); `question`: an agent asks the human
 * through the bus (`ask_human`): approving answers it, denying declines.
 */
export type RequestKind = "plan" | "step" | "permission" | "budget" | "question";

/** `cancelled`: no longer answerable (run cancelled, agent turn over, daemon restart). */
export type RequestStatus = "pending" | "approved" | "denied" | "cancelled";

export interface PermissionRequest {
  id: string;
  kind: RequestKind;
  runId: string;
  projectId: string;
  /** The session that asked, for `permission` and `question` requests. */
  sessionId?: string;
  /** Pipeline step the request belongs to. */
  step: StepKind;
  stepIndex: number;
  title: string;
  /** The plan text, the tool call description, the budget overrun, or the question's context. */
  detail: string;
  /** Suggested answers of a `question` (free text is fine too); empty otherwise. */
  options: string[];
  status: RequestStatus;
  answer?: string;
  createdAt: number;
  resolvedAt?: number;
}

/** The bus tools agents call (`tool` of a bus entry; other names may appear). */
export type BusTool = "post_message" | "read_messages" | "request_review" | "handoff" | "get_run_state" | "ask_human";

/**
 * What a bus log entry records (agentux-core `docs/api.md`, "Agent bus"):
 * - `message`, `review_request`, `handoff`: routed messages between agents
 *   (or to the run's channel, or to the human);
 * - `question` / `answer`: an agent's `ask_human` and the human's answer
 *   (or decline); `human_answer`: an answer that came after the agent stopped
 *   waiting, delivered as mail;
 * - `turn_limit`, `tool_denied`: refusals (warnings);
 * - `wake`, `joined`, `left`: system lines (the daemon prompting a session,
 *   sessions entering and leaving the bus).
 */
export type BusMessageKind =
  | "message"
  | "review_request"
  | "handoff"
  | "human_answer"
  | "question"
  | "answer"
  | "wake"
  | "turn_limit"
  | "tool_denied"
  | "joined"
  | "left";

export const BUS_KINDS: readonly BusMessageKind[] = [
  "message",
  "review_request",
  "handoff",
  "human_answer",
  "question",
  "answer",
  "wake",
  "turn_limit",
  "tool_denied",
  "joined",
  "left",
];

/** Entries shown as quiet one-line system notes (and hidden by the "system" filter). */
export const BUS_SYSTEM_KINDS: readonly BusMessageKind[] = ["wake", "joined", "left"];
/** Refusals, shown as warnings. */
export const BUS_WARNING_KINDS: readonly BusMessageKind[] = ["turn_limit", "tool_denied"];

export type BusEndpoint =
  /**
   * One session; `harness` as configured, `vendor` when the cockpit knows it.
   * `role` is empty while unknown (an endpoint that named only the session,
   * whose session the cockpit has not seen yet).
   */
  | { kind: "session"; sessionId: string; role: string; harness?: string; vendor?: Vendor }
  /** Every session playing the role. */
  | { kind: "role"; role: string }
  /** The run's channel (read by every session, wakes nobody). */
  | { kind: "run" }
  | { kind: "human" }
  | { kind: "daemon" };

export interface BusMessage {
  id: string;
  runId: string;
  projectId: string;
  kind: BusMessageKind;
  /** The bus tool whose call caused the entry, if any (`post_message`, `ask_human`, ...). */
  tool?: string;
  from: BusEndpoint;
  to: BusEndpoint;
  /** One line. */
  subject: string;
  /** The message text; for a wake, the prompt sent. */
  body: string;
  at: number;
  /** Turn within the exchange (routed messages; 0 otherwise), and the run's limit. */
  turn: number;
  maxTurns: number;
  /** The bus's message id (agents reply with it); also on the wake it caused. */
  messageId?: number;
  /** Exchange: a message and its replies, which share the turn budget. */
  exchange?: number;
  inReplyTo?: number;
  /** `question` and `answer` entries of the same `ask_human`. */
  questionId?: number;
  /** The `question` request holding a question. */
  requestId?: string;
  /** Session ids whose mailbox received the message. */
  deliveredTo: string[];
  /** No session played the target role: the message waits for one. */
  queuedForRole?: string;
}

/**
 * Where the human posts on a run's bus (`bus.post`): one session, every
 * session playing a role (a session is started for a role nobody plays), or
 * the run's channel (read by every session, wakes nobody).
 */
export type BusTarget = { kind: "session"; sessionId: string } | { kind: "role"; role: string } | { kind: "run" };

export interface BusPostInput {
  runId: string;
  /** Omitted with `inReplyTo`: the reply goes to that message's sender. */
  to?: BusTarget;
  body: string;
  /** One line; becomes the message's first line. */
  subject?: string;
  /** The bus `messageId` this answers (same exchange). */
  inReplyTo?: number;
}

export interface BusPostResult {
  messageId: number;
  exchange: number;
  turn: number;
  /** Session ids whose mailbox received the message. */
  deliveredTo: string[];
  /** No session played the target role: the message waits for one. */
  queuedForRole?: string;
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
  /** Agent-bus log of the runs loaded so far, oldest first. */
  bus: BusMessage[];
  /**
   * Optional daemon methods found by probing (absent or false: not served).
   * `sessionsPrompt`: the human can prompt a session; `busPost`: the human
   * can post on a run's bus.
   */
  capabilities?: { sessionsPrompt?: boolean; busPost?: boolean };
}

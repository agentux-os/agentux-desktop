import type { BusMessage, CockpitState, PermissionRequest, Run, Session, SessionEvent } from "../daemon/types";

/**
 * What a session event is to the person following the run
 * (agentux-desktop#84):
 *
 * - `execution`: what AgentUX asked the agent to do (a step's or a wake's
 *   prompt) and notices about the turn;
 * - `tool`: a tool the agent ran;
 * - `approval`: something that waits, or waited, for you;
 * - `blocker`: what went wrong (a failed tool, a turn that stalled or was
 *   not handled);
 * - `result`: what the agent produced (file changes, its plan);
 * - `message`: the conversation (the agent's replies, your messages, the
 *   bus).
 */
export type ActivityKind = "execution" | "tool" | "approval" | "blocker" | "result" | "message";

/** The filters of a session's activity, in the order they are offered. */
export const ACTIVITY_FILTERS = ["all", "tool", "approval", "blocker", "result"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export const ACTIVITY_LABEL: Record<ActivityFilter, string> = {
  all: "All",
  tool: "Tools",
  approval: "Approvals",
  blocker: "Problems",
  result: "Results",
};

/** agentuxd's system notices that mean the turn did not go as asked. */
const TROUBLE = /\b(fail(ed|s)?|error|not handled|stall(ed)?|refused|broke|cannot|could not|limit)\b/i;

export function activityOf(ev: SessionEvent, bus?: BusMessage): ActivityKind {
  switch (ev.kind) {
    case "message":
      if (ev.from === "user") return "execution";
      if (ev.from === "system") return TROUBLE.test(ev.text) ? "blocker" : "execution";
      return "message";
    case "tool_call":
      return ev.status === "error" ? "blocker" : "tool";
    case "diff":
    case "plan":
      return "result";
    case "permission":
      return "approval";
    case "bus":
      return bus?.kind === "question" ? "approval" : "message";
  }
}

export function matches(filter: ActivityFilter, kind: ActivityKind): boolean {
  return filter === "all" || filter === kind;
}

/** How many of a session's events each filter shows. */
export function activityCounts(session: Session, state: CockpitState): Record<ActivityFilter, number> {
  const counts: Record<ActivityFilter, number> = { all: 0, tool: 0, approval: 0, blocker: 0, result: 0 };
  for (const ev of session.events) {
    const bus = ev.kind === "bus" ? state.bus.find((m) => m.id === ev.messageId) : undefined;
    const kind = activityOf(ev, bus);
    counts.all += 1;
    if (kind in counts) counts[kind as ActivityFilter] += 1;
  }
  return counts;
}

export type SessionStatusKind = "offline" | "waiting" | "attached" | "working" | "blocked" | "done" | "ended" | "idle";

export interface SessionStatus {
  kind: SessionStatusKind;
  label: string;
  detail?: string;
  /** The request it waits on, to show it. */
  requestId?: string;
}

/** A pending request of this session, or of its run when none is the session's own. */
function waitingOn(session: Session, run: Run, state: CockpitState): PermissionRequest | undefined {
  const pending = Object.values(state.requests).filter((r) => r.status === "pending" && r.runId === run.id);
  return pending.find((r) => r.sessionId === session.id) ?? pending.find((r) => !r.sessionId);
}

/**
 * The one line that says what is going on in a session, so nobody has to
 * read the whole log to know whether it needs them.
 */
export function sessionStatus(session: Session, run: Run, state: CockpitState): SessionStatus {
  if (!state.connection.mock && state.connection.status !== "connected") {
    return {
      kind: "offline",
      label: state.connection.status === "connecting" ? "Connecting to agentuxd…" : "agentuxd is unreachable",
      detail: "This is the last state the cockpit saw on this computer; it updates when the connection is back.",
    };
  }
  const request = waitingOn(session, run, state);
  if (request) {
    return { kind: "waiting", label: "Waiting for you", detail: request.title, requestId: request.id };
  }
  if (session.state === "attached") {
    return { kind: "attached", label: "Open in its terminal", detail: "Turns for this session wait until the terminal closes." };
  }
  if (session.state === "active") {
    const running = [...session.events].reverse().find((e) => e.kind === "tool_call" && e.status === "running");
    return { kind: "working", label: "Working", detail: running?.kind === "tool_call" ? running.title : undefined };
  }
  if (run.status === "failed") return { kind: "blocked", label: "The run failed", detail: run.error };
  if (run.status === "done") return { kind: "done", label: "Done", detail: run.pullRequest ? `PR #${run.pullRequest.number}` : undefined };
  if (run.status === "cancelled") return { kind: "ended", label: "Cancelled" };
  if (session.state === "ended") return { kind: "ended", label: "Session ended" };
  return { kind: "idle", label: "Idle", detail: "Waiting for the run's next step or a message." };
}

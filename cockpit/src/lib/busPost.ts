import type { BusMessage, BusPostInput, BusTarget, CockpitState, Run } from "../daemon/types";
import { harnessInfo } from "../daemon/vendors";
import { roleLabel } from "./labels";

/** One choice of the bus composer's "To" menu. */
export interface BusTargetOption {
  key: string;
  label: string;
  /** Shown as the option's tooltip. */
  detail: string;
  to: BusTarget;
}

const ROLE_ORDER: readonly string[] = ["planner", "implementer", "reviewer"];

export function isActiveRun(run: Pick<Run, "status">): boolean {
  return run.status === "running" || run.status === "waiting";
}

/**
 * Why the human cannot post on `run`'s bus right now; `undefined` when they
 * can. The real daemon needs `bus.post` (found by the capability probe); a
 * finished run's bus is closed (agentuxd answers -32002).
 */
export function busPostBlocked(
  mode: "mock" | "daemon",
  capabilities: CockpitState["capabilities"],
  run: Pick<Run, "status"> | undefined,
): string | undefined {
  if (mode === "daemon" && !capabilities?.busPost) return "This agentuxd does not take posts on the bus yet (no bus.post)";
  if (!run) return "No running run to post to";
  if (!isActiveRun(run)) return "The run has finished: its bus is closed";
  return undefined;
}

export function targetKey(to: BusTarget): string {
  switch (to.kind) {
    case "session":
      return `session:${to.sessionId}`;
    case "role":
      return `role:${to.role}`;
    case "run":
      return "run";
  }
}

/**
 * Where the human can post on `run`'s bus: each role of the run (every
 * session playing it; agentuxd starts one for a role nobody plays yet), each
 * of its live sessions, and the run's channel (every session reads it, nobody
 * is woken).
 */
export function busTargets(run: Run, state: Pick<CockpitState, "sessions">): BusTargetOption[] {
  const rank = (role: string) => {
    const i = ROLE_ORDER.indexOf(role);
    return i < 0 ? ROLE_ORDER.length : i;
  };
  const roles = [...new Set([...Object.keys(run.roles), ...Object.keys(run.sessions)])].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
  const options: BusTargetOption[] = roles.map((role) => ({
    key: targetKey({ kind: "role", role }),
    label: `${roleLabel(role)} (role)`,
    detail: run.sessions[role]
      ? `Every session playing the ${role} role; wakes it`
      : `No session plays the ${role} role yet: agentuxd starts one for this message`,
    to: { kind: "role", role },
  }));
  const sessions = Object.values(state.sessions)
    .filter((s) => s.runId === run.id && s.state !== "ended")
    .sort((a, b) => rank(a.role) - rank(b.role) || a.startedAt - b.startedAt);
  for (const s of sessions) {
    options.push({
      key: targetKey({ kind: "session", sessionId: s.id }),
      label: `${harnessInfo(s.vendor, s.harness).label} ${roleLabel(s.role).toLowerCase()} · ${s.id}`,
      detail: `Only session ${s.id}; wakes it`,
      to: { kind: "session", sessionId: s.id },
    });
  }
  options.push({
    key: targetKey({ kind: "run" }),
    label: "Whole run (channel)",
    detail: "The run's channel: every session reads it, nobody is woken",
    to: { kind: "run" },
  });
  return options;
}

/** Whether the human can answer `m` with `inReplyTo` (it goes back to the session that sent it). */
export function canReplyTo(m: BusMessage): boolean {
  return m.messageId != null && m.from.kind === "session" && !!m.from.sessionId && (m.kind === "message" || m.kind === "review_request" || m.kind === "handoff");
}

/**
 * The `bus.post` input for what the composer holds, or `undefined` when it
 * cannot be sent (no text, nobody to send it to). A reply leaves `to` out:
 * agentuxd sends it to the replied message's sender, in its exchange.
 */
export function busPostInput(
  runId: string | undefined,
  to: BusTarget | undefined,
  replyTo: BusMessage | undefined,
  body: string,
  subject = "",
): BusPostInput | undefined {
  const text = body.trim();
  if (!runId || !text) return undefined;
  const line = subject.replace(/\s+/g, " ").trim();
  if (replyTo) {
    if (replyTo.runId !== runId || replyTo.messageId == null) return undefined;
    return { runId, body: text, subject: line || undefined, inReplyTo: replyTo.messageId };
  }
  if (!to) return undefined;
  return { runId, to, body: text, subject: line || undefined };
}

import { describe, expect, it } from "vitest";
import { MockDaemonClient } from "./MockDaemonClient";

describe("MockDaemonClient", () => {
  const client = new MockDaemonClient({ speed: 1 });
  const state = client.getState();
  const requests = Object.values(state.requests);
  const sessions = Object.values(state.sessions);

  it("seeds runs whose cost is the sum of their sessions' reported cost", () => {
    for (const run of Object.values(state.runs)) {
      const sum = sessions.filter((s) => s.runId === run.id).reduce((acc, s) => acc + (s.usage.costUsd ?? 0), 0);
      expect(run.costUsd).toBeCloseTo(sum);
    }
    expect(sessions.every((s) => s.usage.usedTokens <= s.usage.contextTokens && s.harness === s.vendor)).toBe(true);
  });

  it("uses the daemon's request kinds, with a session only on permission and question requests", () => {
    expect(new Set(requests.map((r) => r.kind))).toEqual(new Set(["plan", "permission", "budget", "question"]));
    for (const r of requests) {
      if (r.kind === "permission" || r.kind === "question") expect(state.sessions[r.sessionId!]?.runId).toBe(r.runId);
      else expect(r.sessionId).toBeUndefined();
      if (r.kind !== "question") expect(r.options).toEqual([]);
    }
  });

  it("logs the bus like agentuxd: every kind but late answers, exchanges with turns, wakes", () => {
    const kinds = new Set(state.bus.map((m) => m.kind));
    for (const k of ["message", "review_request", "handoff", "question", "wake", "turn_limit", "tool_denied", "joined", "left"]) {
      expect(kinds).toContain(k);
    }
    for (const m of state.bus) {
      expect(state.runs[m.runId]).toBeDefined();
      if (["message", "review_request", "handoff"].includes(m.kind)) {
        expect(m.exchange).toBeGreaterThan(0);
        expect(m.turn).toBeGreaterThan(0);
        expect(m.tool).toBeDefined();
      }
      if (m.kind === "wake") expect(m.from).toEqual({ kind: "daemon" });
    }
    const limit = state.bus.find((m) => m.kind === "turn_limit")!;
    expect(state.bus.some((m) => m.kind === "message" && m.exchange === limit.exchange && m.runId === limit.runId)).toBe(true);
  });

  it("answers a question over the bus; a question does not pause the run", async () => {
    const question = requests.find((r) => r.kind === "question" && r.status === "pending")!;
    expect(question.options.length).toBeGreaterThan(0);
    expect(client.getState().runs[question.runId].status).not.toBe("failed");
    await expect(client.approve(question.id)).rejects.toThrow(/answer/);
    await client.approve(question.id, question.options[1]);
    const s = client.getState();
    expect(s.requests[question.id]).toMatchObject({ status: "approved", answer: question.options[1] });
    const answer = s.bus.find((m) => m.kind === "answer" && m.requestId === question.id)!;
    expect(answer).toMatchObject({ from: { kind: "human" }, body: question.options[1] });
    // The agent had stopped waiting during seeding: the answer is also mail.
    expect(s.bus.some((m) => m.kind === "human_answer" && m.runId === question.runId)).toBe(true);
    expect(s.runs[question.runId].status).not.toBe("failed");
  });

  it("extends the budget on approval and fails the run on a denied plan", async () => {
    const budget = requests.find((r) => r.kind === "budget" && r.status === "pending")!;
    await client.approve(budget.id);
    let s = client.getState();
    const run = s.runs[budget.runId];
    expect(run.budgetUsd).toBeCloseTo(run.costUsd + 10);
    expect(s.requests[budget.id].status).toBe("approved");

    const plan = requests.find((r) => r.kind === "plan" && r.status === "pending")!;
    await client.deny(plan.id);
    s = client.getState();
    expect(s.runs[plan.runId]).toMatchObject({ status: "failed" });
  });

  it("records edits as whole texts and tool calls with ids", () => {
    const events = sessions.flatMap((s) => s.events);
    const diff = events.find((e) => e.kind === "diff");
    expect(diff).toMatchObject({ kind: "diff", path: expect.any(String), oldText: expect.any(String), newText: expect.any(String) });
    expect(events.filter((e) => e.kind === "tool_call").every((e) => e.kind === "tool_call" && !!e.toolCallId)).toBe(true);
  });
});

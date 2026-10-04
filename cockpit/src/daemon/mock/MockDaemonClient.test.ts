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

  it("uses the daemon's request kinds, with a session only on permission requests", () => {
    expect(new Set(requests.map((r) => r.kind))).toEqual(new Set(["plan", "permission", "budget"]));
    for (const r of requests) {
      if (r.kind === "permission") expect(state.sessions[r.sessionId!]?.runId).toBe(r.runId);
      else expect(r.sessionId).toBeUndefined();
    }
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

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

  it("records the human's prompt as theirs and routes the human's bus posts", async () => {
    const live = Object.values(client.getState().runs).find(
      (r) => (r.status === "running" || r.status === "waiting") && Object.values(r.sessions).some((sid) => client.getState().sessions[sid]?.state !== "ended"),
    )!;
    const sid = Object.values(live.sessions).find((id) => client.getState().sessions[id]?.state !== "ended")!;
    await client.sendPrompt(sid, "Also log every request");
    const events = client.getState().sessions[sid].events;
    const said = events[events.length - 1];
    expect(said).toMatchObject({ kind: "message", from: "human", text: "Also log every request" });

    const posted = await client.postBus({ runId: live.id, to: { kind: "session", sessionId: sid }, body: "Ping", subject: "Hi" });
    let s = client.getState();
    const mine = s.bus.find((m) => m.messageId === posted.messageId && m.runId === live.id && m.from.kind === "human")!;
    expect(mine).toMatchObject({ subject: "Hi", body: "Hi\n\nPing", turn: 1, deliveredTo: [sid], to: { kind: "session", sessionId: sid } });
    expect(s.sessions[sid].events.some((e) => e.kind === "bus" && e.messageId === mine.id)).toBe(true);
    expect(s.bus.some((m) => m.kind === "wake" && m.messageId === posted.messageId && m.runId === live.id)).toBe(true);

    // A reply goes to the sender, in its exchange; never back to the human.
    await expect(client.postBus({ runId: live.id, body: "x", inReplyTo: posted.messageId })).rejects.toThrow(/cannot go to you/);
    const agent = s.bus.find((m) => m.runId === live.id && m.kind === "message" && m.from.kind === "session" && m.messageId != null)!;
    const reply = await client.postBus({ runId: live.id, body: "And tests", inReplyTo: agent.messageId });
    s = client.getState();
    expect(reply.exchange).toBe(agent.exchange);
    const sent = s.bus.find((m) => m.messageId === reply.messageId && m.runId === live.id && m.from.kind === "human")!;
    expect(sent).toMatchObject({ to: agent.from, inReplyTo: agent.messageId });
    expect(sent.turn).toBeGreaterThan(agent.turn);

    await expect(client.postBus({ runId: live.id, to: { kind: "run" }, body: " " })).rejects.toThrow(/empty/);
    const done = Object.values(s.runs).find((r) => r.status === "done");
    if (done) await expect(client.postBus({ runId: done.id, to: { kind: "run" }, body: "x" })).rejects.toThrow(/finished/);
  });

  it("records edits as whole texts and tool calls with ids", () => {
    const events = sessions.flatMap((s) => s.events);
    const diff = events.find((e) => e.kind === "diff");
    expect(diff).toMatchObject({ kind: "diff", path: expect.any(String), oldText: expect.any(String), newText: expect.any(String) });
    expect(events.filter((e) => e.kind === "tool_call").every((e) => e.kind === "tool_call" && !!e.toolCallId)).toBe(true);
  });
});

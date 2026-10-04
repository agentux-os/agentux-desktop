import { describe, expect, it } from "vitest";
import type { BusMessage, CockpitState, Run, Session } from "../daemon/types";
import { busPostBlocked, busPostInput, busTargets, canReplyTo } from "./busPost";

function run(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    projectId: "p1",
    title: "Add a cache",
    step: "implement",
    status: "running",
    roles: { implementer: "codex", reviewer: "claude-code" },
    sessions: { implementer: "s1" },
    checks: [],
    gateAttempt: 0,
    gateMaxAttempts: 0,
    reviewRound: 0,
    reviewMaxRounds: 0,
    costUsd: 0,
    startedAt: 1,
    updatedAt: 1,
    activity: "",
    ...over,
  };
}

function session(id: string, role: string, over: Partial<Session> = {}): Session {
  return {
    id,
    runId: "r1",
    projectId: "p1",
    role,
    harness: role === "reviewer" ? "claude-code" : "codex",
    vendor: role === "reviewer" ? "claude-code" : "codex",
    state: "idle",
    cwd: "/wt",
    events: [],
    usage: { usedTokens: 0, contextTokens: 0 },
    startedAt: 1,
    ...over,
  };
}

function message(over: Partial<BusMessage> = {}): BusMessage {
  return {
    id: "b1",
    runId: "r1",
    projectId: "p1",
    kind: "message",
    from: { kind: "session", sessionId: "s2", role: "reviewer", harness: "claude-code", vendor: "claude-code" },
    to: { kind: "human" },
    subject: "on it",
    body: "on it",
    at: 1,
    turn: 2,
    maxTurns: 6,
    messageId: 2,
    exchange: 1,
    inReplyTo: 1,
    deliveredTo: [],
    ...over,
  };
}

describe("busPostBlocked: the composer is enabled only where bus.post can work", () => {
  it("on the real daemon, needs the capability probe to have found bus.post", () => {
    expect(busPostBlocked("daemon", undefined, run())).toMatch(/bus\.post/);
    expect(busPostBlocked("daemon", { sessionsPrompt: true, busPost: false }, run())).toMatch(/bus\.post/);
    expect(busPostBlocked("daemon", { busPost: true }, run())).toBeUndefined();
  });

  it("the mock always can", () => {
    expect(busPostBlocked("mock", undefined, run())).toBeUndefined();
  });

  it("needs a run that has not finished", () => {
    expect(busPostBlocked("daemon", { busPost: true }, undefined)).toMatch(/No running run/);
    expect(busPostBlocked("daemon", { busPost: true }, run({ status: "waiting" }))).toBeUndefined();
    for (const status of ["done", "failed", "cancelled"] as const) {
      expect(busPostBlocked("daemon", { busPost: true }, run({ status }))).toMatch(/finished/);
    }
  });
});

describe("busTargets", () => {
  it("offers the roles, the live sessions, then the whole run", () => {
    const state: Pick<CockpitState, "sessions"> = {
      sessions: {
        s2: session("s2", "reviewer"),
        s1: session("s1", "implementer"),
        s0: session("s0", "implementer", { state: "ended" }),
        x9: session("x9", "implementer", { runId: "r2" }),
      },
    };
    const targets = busTargets(run({ sessions: { implementer: "s1", qa: "s3" } }), state);
    expect(targets.map((t) => t.key)).toEqual(["role:implementer", "role:reviewer", "role:qa", "session:s1", "session:s2", "run"]);
    expect(targets.map((t) => t.to)).toEqual([
      { kind: "role", role: "implementer" },
      { kind: "role", role: "reviewer" },
      { kind: "role", role: "qa" },
      { kind: "session", sessionId: "s1" },
      { kind: "session", sessionId: "s2" },
      { kind: "run" },
    ]);
    // A role nobody plays yet gets a session started for the message.
    expect(targets[1].detail).toMatch(/starts one/);
    expect(targets[3].label).toBe("Codex implementer · s1");
  });
});

describe("busPostInput", () => {
  it("posts to the chosen target; a blank subject is left out", () => {
    expect(busPostInput("r1", { kind: "role", role: "reviewer" }, undefined, "  Look at errors  ", "   ")).toEqual({
      runId: "r1",
      to: { kind: "role", role: "reviewer" },
      body: "Look at errors",
      subject: undefined,
    });
    expect(busPostInput("r1", { kind: "run" }, undefined, "x", " Heads\nup ")).toMatchObject({ subject: "Heads up" });
  });

  it("a reply leaves `to` out and names the message it answers", () => {
    expect(busPostInput("r1", { kind: "run" }, message(), "Thanks")).toEqual({
      runId: "r1",
      body: "Thanks",
      subject: undefined,
      inReplyTo: 2,
    });
  });

  it("is nothing without text, a run, a target, or for a reply on another run", () => {
    expect(busPostInput("r1", { kind: "run" }, undefined, "  ")).toBeUndefined();
    expect(busPostInput(undefined, { kind: "run" }, undefined, "x")).toBeUndefined();
    expect(busPostInput("r1", undefined, undefined, "x")).toBeUndefined();
    expect(busPostInput("r2", undefined, message(), "x")).toBeUndefined();
  });
});

describe("canReplyTo", () => {
  it("routed messages from a session, not the human's own or system lines", () => {
    expect(canReplyTo(message())).toBe(true);
    expect(canReplyTo(message({ kind: "handoff" }))).toBe(true);
    expect(canReplyTo(message({ from: { kind: "human" } }))).toBe(false);
    expect(canReplyTo(message({ kind: "wake", from: { kind: "daemon" } }))).toBe(false);
    expect(canReplyTo(message({ kind: "question", messageId: undefined }))).toBe(false);
    expect(canReplyTo(message({ messageId: undefined }))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { BusMessage, BusMessageKind, CockpitState, Session, SessionEvent } from "../types";
import { BUS_KINDS } from "../types";
import type { ApiBusMessage, ApiEvent, ApiRequest, ApiRun, ApiSession, ApiSessionEvent, ApiSnapshot } from "./api";
import {
  applyBusList,
  applyEvent,
  applyRunHistory,
  applySnapshot,
  harnessToVendor,
  mapBusEndpoint,
  mapBusMessage,
  mergeBus,
  mapProject,
  mapRequest,
  mapRun,
  mapSession,
} from "./mapping";
import { emptyState } from "./TauriDaemonClient";
// Recorded from `aux daemon --fake-agents` (agentux-core 614483c, before the
// ACP executor): one run through the default pipeline with the plan
// approved. No sessions, no costUsd: checks that older daemons still map.
import recordedOld from "./__fixtures__/fake-agents-run.json";
// Recorded from agentuxd on agentux-core fc4132f (the ACP executor, #6): the
// engine with `AcpExecutor` driving in-process fake ACP agents (the harness
// the daemon's own tests use), served state dumped through the same
// agentux-api types. Planner (claude-code) with an approved plan, implementer
// (codex) asking two permissions (edit allowed, `pytest -q` denied), a budget
// overrun approved before the review, reviewer (claude-code) approving.
// `aux daemon --fake-agents` cannot produce this: its fake executor opens no
// sessions.
import recordedAcp from "./__fixtures__/acp-run.json";
// Recorded from agentuxd on agentux-core fec37d1 (0.2.0, the agent bus): a
// test like the daemon's own bus tests (in-process fake ACP agents calling
// the bus with their session tokens, the way `aux bus-stdio` does), served
// state, `bus.list` and the run's events dumped as raw JSON from the socket.
// The implementer (codex) asks three questions (answered "sqlite", declined,
// answered after it stopped waiting -> human_answer), calls a tool bus.allow
// leaves out (tool_denied), posts to the run channel and the human, then
// pings the reviewer (claude-code), whose session is started for the queued
// message; they ping-pong to the turn limit (3), the reviewer hands off, and
// its review step asks the implementer for a review before the run ends.
// One change to the daemon for the recording: the ask_human wait was 3 s
// instead of 2 min, so the late answer did not take two minutes.
import recordedBus from "./__fixtures__/bus-run.json";

type Fixture = { snapshot: ApiSnapshot; events: ApiEvent[] };
type BusFixture = Fixture & { bus: ApiBusMessage[] };
const busFixture = recordedBus as unknown as BusFixture;
const oldFixture = recordedOld as unknown as Fixture;
const acpFixture = recordedAcp as unknown as Fixture;

function apiRun(over: Partial<ApiRun> = {}): ApiRun {
  return {
    id: "3f9a0c12",
    projectId: "p1",
    title: "Add a health endpoint",
    prompt: "Add a health endpoint",
    issue: null,
    branch: null,
    worktree: null,
    steps: ["plan", "implement", "gate", "review", "pull_request"],
    stepIndex: 0,
    step: "plan",
    status: "running",
    roles: { planner: "claude-code", implementer: "codex", reviewer: "claude-code" },
    sessions: {},
    checks: [],
    gateAttempt: 0,
    gateMaxAttempts: 3,
    reviewRound: 0,
    reviewMaxRounds: 2,
    budgetUsd: null,
    costUsd: 0,
    startedAt: 1000,
    updatedAt: 1000,
    finishedAt: null,
    pullRequest: null,
    activity: "planning",
    error: null,
    ...over,
  };
}

function apiRequest(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: "q1",
    kind: "plan",
    runId: "3f9a0c12",
    projectId: "p1",
    sessionId: null,
    stepIndex: 0,
    step: "plan",
    title: "Approve the plan",
    detail: "1. do it",
    status: "pending",
    answer: null,
    createdAt: 2000,
    resolvedAt: null,
    ...over,
  };
}

function apiSession(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: "s1",
    runId: "3f9a0c12",
    projectId: "p1",
    role: "implementer",
    harness: "codex",
    model: null,
    state: "active",
    cwd: "/src/demo.worktrees/3f9a0c12",
    usage: { usedTokens: 0, contextTokens: 0, costUsd: null },
    startedAt: 3000,
    updatedAt: 3000,
    endedAt: null,
    ...over,
  };
}

const ev = (body: Record<string, unknown>, seq = 1) => ({ seq, at: seq * 10, runId: "3f9a0c12", ...body }) as ApiEvent;
const sev = (event: ApiSessionEvent, seq: number, sessionId = "s1") => ev({ kind: "session_event", sessionId, event }, seq);

/** State with run 3f9a0c12 and session s1 (no entries yet). */
function withSession(): CockpitState {
  let s = applyEvent(emptyState("test"), ev({ kind: "run", run: apiRun({ sessions: { implementer: "s1" } }) }));
  s = applyEvent(s, ev({ kind: "session", session: apiSession() }, 2));
  return s;
}

const entries = (s: CockpitState, id = "s1"): SessionEvent[] => s.sessions[id].events;

describe("harnessToVendor", () => {
  it("maps known harness names and aliases", () => {
    expect(harnessToVendor("claude-code")).toBe("claude-code");
    expect(harnessToVendor("Codex")).toBe("codex");
    expect(harnessToVendor("claude")).toBe("claude-code");
    expect(harnessToVendor("agy")).toBe("antigravity");
  });

  it("leaves unknown harnesses unmapped", () => {
    expect(harnessToVendor("aider")).toBeUndefined();
    expect(harnessToVendor(null)).toBeUndefined();
    expect(harnessToVendor("")).toBeUndefined();
  });
});

describe("mapProject", () => {
  it("keeps id/name/path", () => {
    expect(mapProject({ id: "p1", name: "ledger", path: "/src/ledger", createdAt: 1 })).toEqual({
      id: "p1",
      name: "ledger",
      path: "/src/ledger",
    });
  });
});

describe("mapRun", () => {
  it("turns nulls into absent fields", () => {
    const run = mapRun(apiRun());
    expect(run.issue).toBeUndefined();
    expect(run.branch).toBeUndefined();
    expect(run.budgetUsd).toBeUndefined();
    expect(run.finishedAt).toBeUndefined();
    expect(run.pullRequest).toBeUndefined();
    expect(run.error).toBeUndefined();
    expect(run.costUsd).toBe(0);
    expect(run.sessions).toEqual({});
    expect(run.prompt).toBe("Add a health endpoint");
  });

  it("keeps values that are present", () => {
    const run = mapRun(
      apiRun({
        issue: 42,
        branch: "aux/3f9a0c12",
        budgetUsd: 10,
        costUsd: 0.53,
        status: "done",
        step: "pull_request",
        stepIndex: 4,
        finishedAt: 5000,
        pullRequest: { number: 7, url: "https://forge/pr/7" },
        checks: [{ name: "unit", command: "cargo test", status: "passed" }],
      }),
    );
    expect(run).toMatchObject({
      issue: 42,
      branch: "aux/3f9a0c12",
      budgetUsd: 10,
      costUsd: 0.53,
      status: "done",
      step: "pull_request",
      stepIndex: 4,
      finishedAt: 5000,
      pullRequest: { number: 7, url: "https://forge/pr/7" },
      checks: [{ name: "unit", command: "cargo test", status: "passed" }],
    });
  });

  it("maps roles to vendors, dropping custom roles and unknown harnesses", () => {
    const run = mapRun(apiRun({ roles: { planner: "claude", implementer: "aider", reviewer: "codex", security: "codex" } }));
    expect(run.roles).toEqual({ planner: "claude-code", reviewer: "codex" });
  });

  it("keeps the session id of every role, custom roles included", () => {
    const run = mapRun(apiRun({ sessions: { planner: "s1", security: "s9" } }));
    expect(run.sessions).toEqual({ planner: "s1", security: "s9" });
  });

  it("works with daemons that send neither sessions nor costUsd", () => {
    const old = apiRun();
    delete old.sessions;
    delete old.costUsd;
    expect(mapRun(old)).toMatchObject({ sessions: {}, costUsd: 0 });
  });

  it("maps daemon-only enum values", () => {
    expect(mapRun(apiRun({ status: "cancelled" })).status).toBe("cancelled");
    expect(mapRun(apiRun({ step: "custom", steps: ["plan", "custom"] })).steps).toEqual(["plan", "custom"]);
    expect(mapRun(apiRun({ step: "security_scan" })).step).toBe("custom");
    expect(mapRun(apiRun({ status: "paused_somehow" })).status).toBe("running");
    expect(mapRun(apiRun({ checks: [{ name: "x", command: "y", status: "skipped" }] })).checks[0].status).toBe("pending");
  });
});

describe("mapRequest", () => {
  it("maps a plan approval: no session", () => {
    expect(mapRequest(apiRequest())).toEqual({
      id: "q1",
      kind: "plan",
      runId: "3f9a0c12",
      projectId: "p1",
      sessionId: undefined,
      step: "plan",
      stepIndex: 0,
      title: "Approve the plan",
      detail: "1. do it",
      options: [],
      status: "pending",
      answer: undefined,
      createdAt: 2000,
      resolvedAt: undefined,
    });
  });

  it("maps a question with its options and answer", () => {
    const r = mapRequest(
      apiRequest({
        kind: "question",
        sessionId: "s1",
        options: ["postgres", "sqlite"],
        status: "approved",
        answer: "sqlite",
        resolvedAt: 2500,
      }),
    );
    expect(r).toMatchObject({ kind: "question", sessionId: "s1", options: ["postgres", "sqlite"], status: "approved", answer: "sqlite" });
  });

  it("gives requests from older daemons no options", () => {
    const { options: _, ...old } = apiRequest({ kind: "question" });
    expect(mapRequest(old as ApiRequest).options).toEqual([]);
    expect(mapRequest(apiRequest({ options: ["a", 3 as unknown as string] })).options).toEqual(["a"]);
  });

  it("maps step approvals and cancelled requests", () => {
    const r = mapRequest(apiRequest({ kind: "step", step: "pull_request", stepIndex: 4, status: "cancelled", resolvedAt: 3000 }));
    expect(r).toMatchObject({ kind: "step", step: "pull_request", stepIndex: 4, status: "cancelled", resolvedAt: 3000 });
  });

  it("maps a permission request with the asking session", () => {
    const r = mapRequest(
      apiRequest({
        kind: "permission",
        sessionId: "s1",
        stepIndex: 1,
        step: "implement",
        title: "implementer (codex) wants to run: pytest -q",
        detail: "pytest -q\n\nTool call x1 (execute).",
        status: "denied",
        answer: "not here",
        resolvedAt: 2500,
      }),
    );
    expect(r).toMatchObject({
      kind: "permission",
      sessionId: "s1",
      step: "implement",
      title: "implementer (codex) wants to run: pytest -q",
      status: "denied",
      answer: "not here",
    });
  });

  it("maps a budget request", () => {
    const r = mapRequest(
      apiRequest({ kind: "budget", step: "review", stepIndex: 2, title: "over budget", detail: "The run has cost $0.53" }),
    );
    expect(r).toMatchObject({ kind: "budget", sessionId: undefined, step: "review", detail: "The run has cost $0.53" });
  });

  it("treats unknown kinds as step approvals and unknown statuses as resolved", () => {
    const r = mapRequest(apiRequest({ kind: "escalation", status: "answered" }));
    expect(r.kind).toBe("step");
    expect(r.status).toBe("cancelled");
  });

  it("works with daemons that do not send sessionId", () => {
    const old = apiRequest();
    delete old.sessionId;
    expect(mapRequest(old).sessionId).toBeUndefined();
  });
});

describe("mapSession", () => {
  it("maps a session snapshot", () => {
    expect(
      mapSession(apiSession({ model: "gpt-5", usage: { usedTokens: 52300, contextTokens: 272000, costUsd: 0.41 } })),
    ).toEqual({
      id: "s1",
      runId: "3f9a0c12",
      projectId: "p1",
      role: "implementer",
      harness: "codex",
      vendor: "codex",
      model: "gpt-5",
      state: "active",
      cwd: "/src/demo.worktrees/3f9a0c12",
      events: [],
      lastSeq: undefined,
      usage: { usedTokens: 52300, contextTokens: 272000, costUsd: 0.41 },
      startedAt: 3000,
      endedAt: undefined,
    } satisfies Session);
  });

  it("keeps unknown harnesses and custom roles, without a vendor", () => {
    const s = mapSession(apiSession({ harness: "aider", role: "security", state: "sleeping" }));
    expect(s).toMatchObject({ harness: "aider", vendor: undefined, role: "security", state: "idle" });
  });

  it("leaves cost absent when the harness does not report it", () => {
    expect(mapSession(apiSession()).usage).toEqual({ usedTokens: 0, contextTokens: 0, costUsd: undefined });
  });
});

describe("applyEvent", () => {
  const base = emptyState("test");

  it("upserts projects, runs and requests by id", () => {
    let s = applyEvent(base, ev({ kind: "project", project: { id: "p1", name: "a", path: "/a", createdAt: 1 } }));
    s = applyEvent(s, ev({ kind: "project", project: { id: "p1", name: "renamed", path: "/a", createdAt: 1 } }));
    expect(s.projects.map((p) => p.name)).toEqual(["renamed"]);

    s = applyEvent(s, ev({ kind: "run", run: apiRun() }));
    s = applyEvent(s, ev({ kind: "run", run: apiRun({ status: "waiting", activity: "waiting for approval" }) }));
    expect(Object.keys(s.runs)).toEqual(["3f9a0c12"]);
    expect(s.runs["3f9a0c12"].status).toBe("waiting");

    s = applyEvent(s, ev({ kind: "request", request: apiRequest() }));
    s = applyEvent(s, ev({ kind: "request", request: apiRequest({ status: "approved", resolvedAt: 9 }) }));
    expect(s.requests.q1.status).toBe("approved");
  });

  it("ignores attempt, log and unknown events without changing state", () => {
    expect(applyEvent(base, ev({ kind: "log", text: "hi" }))).toBe(base);
    expect(applyEvent(base, ev({ kind: "attempt", attempt: {} }))).toBe(base);
    expect(applyEvent(base, ev({ kind: "bus_message", message: {} }))).toBe(base);
  });

  it("session snapshots replace the session but keep its entries", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "message", from: "user", text: "do it" }, 3));
    s = applyEvent(
      s,
      ev({ kind: "session", session: apiSession({ state: "waiting", usage: { usedTokens: 10, contextTokens: 100, costUsd: 0.1 } }) }, 4),
    );
    expect(s.sessions.s1).toMatchObject({ state: "waiting", usage: { usedTokens: 10, contextTokens: 100, costUsd: 0.1 } });
    expect(entries(s)).toHaveLength(1);
  });
});

describe("session_event", () => {
  it("message: appended, consecutive agent chunks joined", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "message", from: "user", text: "Add /health" }, 3));
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "1. Add it\n" }, 4));
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "2. Test it\n" }, 5));
    s = applyEvent(s, sev({ kind: "message", from: "daemon", text: "resumed" }, 6));
    expect(entries(s)).toEqual([
      { id: "e3", seq: 3, at: 30, kind: "message", from: "user", text: "Add /health" },
      { id: "e4", seq: 4, at: 40, kind: "message", from: "agent", text: "1. Add it\n2. Test it\n" },
      { id: "e6", seq: 6, at: 60, kind: "message", from: "system", text: "resumed" },
    ]);
  });

  it("tool_call: the first event adds the call, later ones update it", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "tool_call", toolCallId: "x1", tool: "execute", title: "pytest -q", status: "running" }, 3));
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "running tests" }, 4));
    s = applyEvent(s, sev({ kind: "tool_call", toolCallId: "x1", status: "error", output: "denied" }, 5));
    expect(entries(s)).toEqual([
      { id: "e3", seq: 3, at: 30, kind: "tool_call", toolCallId: "x1", tool: "execute", title: "pytest -q", status: "error", output: "denied" },
      { id: "e4", seq: 4, at: 40, kind: "message", from: "agent", text: "running tests" },
    ]);
  });

  it("tool_call: unknown kinds and missing fields get defaults", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "tool_call", toolCallId: "z9", tool: "teleport" }, 3));
    expect(entries(s)[0]).toMatchObject({ kind: "tool_call", tool: "other", title: "z9", status: "running" });
  });

  it("diff: whole texts, a null oldText is a new file", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "diff", toolCallId: "w1", path: "app.py", oldText: "a\n", newText: "a\nb\n" }, 3));
    s = applyEvent(s, sev({ kind: "diff", toolCallId: "t1", path: "test.py", oldText: null, newText: "x\n" }, 4));
    expect(entries(s)).toEqual([
      { id: "e3", seq: 3, at: 30, kind: "diff", toolCallId: "w1", path: "app.py", oldText: "a\n", newText: "a\nb\n" },
      { id: "e4", seq: 4, at: 40, kind: "diff", toolCallId: "t1", path: "test.py", oldText: undefined, newText: "x\n" },
    ]);
  });

  it("plan: one entry per session, replaced by each new plan", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "plan", items: [{ text: "A", status: "pending" }, { text: "B", status: "pending" }] }, 3));
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "working" }, 4));
    s = applyEvent(s, sev({ kind: "plan", items: [{ text: "A", status: "done" }, { text: "B", status: "in_progress" }] }, 5));
    s = applyEvent(s, sev({ kind: "plan", items: [{ text: "A", status: "done" }, { text: "B", status: "blocked" }] }, 6));
    expect(entries(s)).toHaveLength(2);
    expect(entries(s)[0]).toEqual({
      id: "e3",
      seq: 3,
      at: 60,
      kind: "plan",
      items: [
        { text: "A", status: "done" },
        { text: "B", status: "pending" },
      ],
    });
  });

  it("permission: one entry per request", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "permission", requestId: "q7" }, 3));
    s = applyEvent(s, sev({ kind: "permission", requestId: "q7" }, 4));
    expect(entries(s)).toEqual([{ id: "e3", seq: 3, at: 30, kind: "permission", requestId: "q7" }]);
  });

  it("usage: updates the session's usage, adds no entry", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "usage", usage: { usedTokens: 18400, contextTokens: 200000, costUsd: 0.12 } }, 3));
    expect(s.sessions.s1.usage).toEqual({ usedTokens: 18400, contextTokens: 200000, costUsd: 0.12 });
    expect(entries(s)).toEqual([]);
  });

  it("ignores events already folded (by seq) and unknown kinds", () => {
    let s = withSession();
    s = applyEvent(s, sev({ kind: "message", from: "user", text: "once" }, 3));
    const again = applyEvent(s, sev({ kind: "message", from: "user", text: "once" }, 3));
    expect(entries(again)).toHaveLength(1);
    const unknown = applyEvent(s, sev({ kind: "thought", text: "hmm" } as unknown as ApiSessionEvent, 4));
    expect(entries(unknown)).toHaveLength(1);
  });

  it("creates a placeholder for a session whose snapshot has not arrived", () => {
    let s = applyEvent(emptyState("test"), ev({ kind: "run", run: apiRun({ sessions: { planner: "s5" } }) }));
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "hi" }, 2, "s5"));
    expect(s.sessions.s5).toMatchObject({ runId: "3f9a0c12", role: "planner", events: [{ text: "hi" }] });
    s = applyEvent(s, ev({ kind: "session", session: apiSession({ id: "s5", role: "planner", harness: "claude-code" }) }, 3));
    expect(s.sessions.s5).toMatchObject({ vendor: "claude-code", events: [{ text: "hi" }] });
  });
});

describe("applyRunHistory", () => {
  it("rebuilds the run's session entries up to head and keeps the newer usage", () => {
    let s = withSession();
    s = applyEvent(s, ev({ kind: "session", session: apiSession({ usage: { usedTokens: 9, contextTokens: 99, costUsd: 0.9 } }) }, 3));
    // A live event that arrived before the history did.
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "late" }, 12));
    const history = {
      head: 11,
      events: [
        ev({ kind: "run", run: apiRun({ status: "running" }) }, 1),
        sev({ kind: "message", from: "user", text: "prompt" }, 5),
        sev({ kind: "usage", usage: { usedTokens: 1, contextTokens: 99, costUsd: 0.1 } }, 6),
        sev({ kind: "tool_call", toolCallId: "r1", tool: "read", title: "Read a", status: "running" }, 7),
        sev({ kind: "tool_call", toolCallId: "r1", status: "ok" }, 8),
        sev({ kind: "message", from: "agent", text: "past head" }, 13),
      ],
    };
    s = applyRunHistory(s, "3f9a0c12", history);
    expect(entries(s).map((e) => e.kind)).toEqual(["message", "tool_call"]);
    expect(entries(s)[1]).toMatchObject({ status: "ok" });
    expect(s.sessions.s1.usage.costUsd).toBe(0.9);
    // The client then applies live events again; only newer ones count.
    s = applyEvent(s, sev({ kind: "message", from: "agent", text: "late" }, 12));
    s = applyEvent(s, sev({ kind: "message", from: "user", text: "old" }, 7));
    expect(entries(s).map((e) => (e.kind === "message" ? e.text : e.kind))).toEqual(["prompt", "tool_call", "late"]);
    // Runs are left alone: history snapshots are older than the state.
    expect(s.runs["3f9a0c12"].sessions).toEqual({ implementer: "s1" });
  });
});

function apiBus(over: Partial<ApiBusMessage> = {}): ApiBusMessage {
  return {
    id: "b1",
    runId: "3f9a0c12",
    projectId: "p1",
    kind: "message",
    tool: "post_message",
    from: { kind: "session", sessionId: "s1", role: "implementer", vendor: "codex" },
    to: { kind: "session", sessionId: "s2", role: "reviewer", vendor: "claude-code" },
    subject: "ping",
    body: "ping",
    at: 5000,
    turn: 1,
    maxTurns: 6,
    messageId: 1,
    exchange: 1,
    inReplyTo: null,
    questionId: null,
    requestId: null,
    deliveredTo: ["s2"],
    queuedForRole: null,
    ...over,
  };
}

const busEv = (message: ApiBusMessage, seq: number) => ev({ kind: "bus_message", message }, seq);

describe("bus messages", () => {
  const implementer = { kind: "session" as const, sessionId: "s1", role: "implementer", vendor: "codex" };

  it("maps endpoints: sessions get the vendor of their harness, unknown kinds become the daemon", () => {
    expect(mapBusEndpoint(implementer)).toEqual({ kind: "session", sessionId: "s1", role: "implementer", harness: "codex", vendor: "codex" });
    expect(mapBusEndpoint({ kind: "session", sessionId: "s9", role: "qa", vendor: "aider" })).toEqual({
      kind: "session",
      sessionId: "s9",
      role: "qa",
      harness: "aider",
      vendor: undefined,
    });
    expect(mapBusEndpoint({ kind: "role", role: "reviewer" })).toEqual({ kind: "role", role: "reviewer" });
    expect(mapBusEndpoint({ kind: "run" })).toEqual({ kind: "run" });
    expect(mapBusEndpoint({ kind: "human" })).toEqual({ kind: "human" });
    expect(mapBusEndpoint({ kind: "daemon" })).toEqual({ kind: "daemon" });
    expect(mapBusEndpoint({ kind: "elsewhere" })).toEqual({ kind: "daemon" });
  });

  it("maps a routed message field by field", () => {
    expect(mapBusMessage(apiBus({ inReplyTo: 4, queuedForRole: null }))).toEqual<BusMessage>({
      id: "b1",
      runId: "3f9a0c12",
      projectId: "p1",
      kind: "message",
      tool: "post_message",
      from: { kind: "session", sessionId: "s1", role: "implementer", harness: "codex", vendor: "codex" },
      to: { kind: "session", sessionId: "s2", role: "reviewer", harness: "claude-code", vendor: "claude-code" },
      subject: "ping",
      body: "ping",
      at: 5000,
      turn: 1,
      maxTurns: 6,
      messageId: 1,
      exchange: 1,
      inReplyTo: 4,
      questionId: undefined,
      requestId: undefined,
      deliveredTo: ["s2"],
      queuedForRole: undefined,
    });
  });

  // One wire entry per kind, shaped like agentuxd's (see the recorded fixture).
  const daemon = { kind: "daemon" as const };
  const human = { kind: "human" as const };
  const wire: Record<BusMessageKind, Partial<ApiBusMessage>> = {
    message: {},
    review_request: { tool: "request_review", to: { kind: "role", role: "reviewer" }, deliveredTo: [], queuedForRole: "reviewer" },
    handoff: { tool: "handoff", subject: "Handoff: finish it" },
    human_answer: { tool: null, from: human, to: implementer, deliveredTo: ["s1"] },
    question: { tool: "ask_human", to: human, turn: 0, messageId: null, exchange: null, questionId: 2, requestId: "q2", deliveredTo: [] },
    answer: { tool: "ask_human", from: human, to: implementer, turn: 0, messageId: null, exchange: null, questionId: 2, requestId: "q2", deliveredTo: [] },
    wake: { tool: null, from: daemon, to: implementer, turn: 0, exchange: null, deliveredTo: [] },
    turn_limit: { tool: "post_message", to: daemon, turn: 0, messageId: null, deliveredTo: [] },
    tool_denied: { tool: "get_run_state", to: daemon, turn: 0, messageId: null, exchange: null, deliveredTo: [] },
    joined: { tool: null, to: { kind: "run" }, turn: 0, messageId: null, exchange: null, deliveredTo: [] },
    left: { tool: null, to: { kind: "run" }, turn: 0, messageId: null, exchange: null, deliveredTo: [] },
  };

  it.each(BUS_KINDS.map((k) => [k]))("maps a %s entry and logs it", (kind) => {
    const m = mapBusMessage(apiBus({ kind, ...wire[kind] }));
    expect(m.kind).toBe(kind);
    const s = applyEvent(withSession(), busEv(apiBus({ kind, ...wire[kind] }), 5));
    expect(s.bus).toEqual([m]);
  });

  it("unknown kinds become plain messages; entries without an id are ignored", () => {
    expect(mapBusMessage(apiBus({ kind: "telepathy" })).kind).toBe("message");
    const base = withSession();
    expect(applyEvent(base, ev({ kind: "bus_message", message: { kind: "message" } }))).toBe(base);
  });

  it("adds routed entries, questions and answers to the involved sessions' timelines", () => {
    let s = withSession();
    const shown: BusMessageKind[] = [];
    BUS_KINDS.forEach((kind, i) => {
      const before = entries(s).length;
      s = applyEvent(s, busEv(apiBus({ id: `b${i}`, kind, ...wire[kind] }), 10 + i));
      if (entries(s).length > before) shown.push(kind);
    });
    // Wakes, joins/leaves and refusals stay in the bus log only. The review
    // request reached no mailbox (queued for the role) but s1 sent it.
    expect(shown).toEqual(["message", "review_request", "handoff", "human_answer", "question", "answer"]);
    expect(entries(s).every((e) => e.kind === "bus")).toBe(true);
    // The recipient session gets a placeholder until its snapshot arrives.
    expect(s.sessions.s2.events.map((e) => (e.kind === "bus" ? e.messageId : ""))).toEqual(["b0", "b2"]);
  });

  it("merges by id: replays and bus.list never duplicate, the log stays in time order", () => {
    let s = withSession();
    s = applyEvent(s, busEv(apiBus({ id: "b2", at: 20 }), 5));
    s = applyEvent(s, busEv(apiBus({ id: "b2", at: 20 }), 5));
    expect(s.bus).toHaveLength(1);
    const same = applyBusList(s, [apiBus({ id: "b2", at: 20 })]);
    expect(same).toBe(s);
    s = applyBusList(s, [apiBus({ id: "b1", at: 10 }), apiBus({ id: "b2", at: 20 }), apiBus({ id: "b3", at: 30 })]);
    expect(s.bus.map((m) => m.id)).toEqual(["b1", "b2", "b3"]);
    // bus.list fills the log only; timelines come from the events.
    expect(entries(s).filter((e) => e.kind === "bus")).toHaveLength(1);
    expect(mergeBus(s.bus, [])).toBe(s.bus);
  });

  it("rebuilds bus entries of a run's timelines from its history", () => {
    let s = applyEvent(withSession(), busEv(apiBus({ id: "late", at: 90 }), 12));
    s = applyRunHistory(s, "3f9a0c12", {
      head: 11,
      events: [
        sev({ kind: "message", from: "user", text: "prompt" }, 5),
        busEv(apiBus({ id: "b1", at: 60 }), 6),
        busEv(apiBus({ id: "past head", at: 70 }), 13),
      ],
    });
    expect(entries(s).map((e) => (e.kind === "bus" ? e.messageId : e.kind))).toEqual(["message", "b1"]);
    expect(s.bus.map((m) => m.id)).toEqual(["b1", "late"]);
  });
});

describe("recorded daemon output", () => {
  const sameAsListing = (fixture: Fixture) => {
    const replayed = fixture.events.reduce(applyEvent, emptyState("test"));
    const listed = applySnapshot(emptyState("test"), fixture.snapshot);
    expect(replayed.projects).toEqual(listed.projects);
    expect(replayed.runs).toEqual(listed.runs);
    expect(replayed.requests).toEqual(listed.requests);
    const strip = (s: CockpitState) =>
      Object.fromEntries(Object.entries(s.sessions).map(([id, x]) => [id, { ...x, events: [], lastSeq: undefined }]));
    expect(strip(replayed)).toEqual(strip(listed));
    return replayed;
  };

  it("an older daemon (no sessions): replaying gives the final listing", () => {
    sameAsListing(oldFixture);
    const s = applySnapshot(emptyState("test"), oldFixture.snapshot);
    const [run] = Object.values(s.runs);
    expect(run).toMatchObject({ status: "done", step: "pull_request", costUsd: 0, sessions: {} });
    expect(run.branch).toBe(`aux/${run.id}`);
    expect(run.pullRequest?.number).toBe(1);
    expect(run.roles.planner).toBe("claude-code");
    const [request] = Object.values(s.requests);
    expect(request).toMatchObject({ kind: "plan", status: "approved", runId: run.id, sessionId: undefined });
  });

  describe("the agent bus", () => {
    // The recording holds the run's events only (no project events): replay
    // them over the listing, as the cockpit does with a run's history.
    const state = () => applyBusList(busFixture.events.reduce(applyEvent, applySnapshot(emptyState("test"), busFixture.snapshot)), busFixture.bus);

    it("replays the same log the daemon lists, with every entry kind", () => {
      const replayed = busFixture.events.reduce(applyEvent, emptyState("test"));
      const listed = applySnapshot(emptyState("test"), busFixture.snapshot);
      expect(replayed.runs).toEqual(listed.runs);
      expect(replayed.requests).toEqual(listed.requests);
      expect(replayed.bus).toEqual(busFixture.bus.map(mapBusMessage));
      expect(applyBusList(replayed, busFixture.bus)).toBe(replayed);
      expect(new Set(replayed.bus.map((m) => m.kind))).toEqual(new Set(BUS_KINDS));
    });

    it("maps the questions: options, answers, a decline and a late answer", () => {
      const s = state();
      const questions = Object.values(s.requests)
        .filter((r) => r.kind === "question")
        .sort((a, b) => a.createdAt - b.createdAt);
      const implementer = Object.values(s.sessions).find((x) => x.role === "implementer")!;
      expect(questions.map((q) => [q.status, q.answer, q.options, q.sessionId])).toEqual([
        ["approved", "sqlite", ["postgres", "sqlite"], implementer.id],
        ["denied", undefined, ["yes", "no"], implementer.id],
        ["approved", "yes, drop it", ["yes", "no"], implementer.id],
      ]);
      const answers = s.bus.filter((m) => m.kind === "answer");
      expect(answers.map((m) => [m.body, m.requestId])).toEqual([
        ["sqlite", questions[0].id],
        ["(the human declined to answer)", questions[1].id],
        ["yes, drop it", questions[2].id],
      ]);
      const late = s.bus.find((m) => m.kind === "human_answer")!;
      expect(late).toMatchObject({ from: { kind: "human" }, to: { kind: "session", sessionId: implementer.id }, deliveredTo: [implementer.id] });
    });

    it("keeps exchanges, turns and refusals", () => {
      const s = state();
      const ping = s.bus.filter((m) => m.kind === "message" && m.exchange === 3);
      expect(ping.map((m) => [m.body, m.turn, m.maxTurns])).toEqual([
        ["ping", 1, 3],
        ["pong", 2, 3],
        ["pong", 3, 3],
      ]);
      expect(ping[0]).toMatchObject({ to: { kind: "role", role: "reviewer" }, queuedForRole: "reviewer", deliveredTo: [] });
      expect(s.bus.find((m) => m.kind === "turn_limit")).toMatchObject({ exchange: 3, to: { kind: "daemon" } });
      expect(s.bus.find((m) => m.kind === "tool_denied")).toMatchObject({ tool: "get_run_state" });
      const wakes = s.bus.filter((m) => m.kind === "wake");
      expect(wakes.every((w) => w.from.kind === "daemon" && w.messageId != null)).toBe(true);
      expect(s.bus.filter((m) => m.kind === "joined" || m.kind === "left")).toHaveLength(4);
    });

    it("puts the conversation in the sessions' timelines", () => {
      const s = state();
      const byRole = (role: string) => {
        const session = Object.values(s.sessions).find((x) => x.role === role)!;
        return session.events
          .filter((e) => e.kind === "bus")
          .map((e) => s.bus.find((m) => m.id === (e as { messageId: string }).messageId)!.kind);
      };
      expect(byRole("implementer")).toEqual([
        "question",
        "answer",
        "question",
        "answer",
        "question",
        "message",
        "message",
        "message",
        "message",
        "message",
        "handoff",
        "answer",
        "human_answer",
        "review_request",
      ]);
      expect(byRole("reviewer")).toEqual(["message", "message", "handoff", "review_request"]);
    });
  });

  describe("the ACP executor", () => {
    const s = sameAsListing.bind(null, acpFixture);

    it("replaying gives the final listing, with sessions, cost and budget", () => {
      const state = s();
      const [run] = Object.values(state.runs);
      expect(run).toMatchObject({ status: "done", step: "review", budgetUsd: 1.03 });
      expect(run.costUsd).toBeCloseTo(0.6);
      expect(Object.keys(run.sessions).sort()).toEqual(["implementer", "planner", "reviewer"]);
      const sessions = Object.values(state.sessions);
      expect(sessions.map((x) => [x.role, x.vendor, x.state])).toEqual([
        ["planner", "claude-code", "ended"],
        ["implementer", "codex", "ended"],
        ["reviewer", "claude-code", "ended"],
      ]);
      const sum = sessions.reduce((acc, x) => acc + (x.usage.costUsd ?? 0), 0);
      expect(sum).toBeCloseTo(run.costUsd);
      expect(state.sessions[run.sessions.implementer].usage).toEqual({ usedTokens: 52300, contextTokens: 272000, costUsd: 0.41 });
    });

    it("maps all four request kinds", () => {
      const state = s();
      const implementer = Object.values(state.sessions).find((x) => x.role === "implementer")!;
      const byKind = (k: string) => Object.values(state.requests).filter((r) => r.kind === k);
      expect(byKind("plan")).toMatchObject([{ status: "approved", sessionId: undefined, step: "plan" }]);
      expect(byKind("budget")).toMatchObject([{ status: "approved", sessionId: undefined, step: "review" }]);
      expect(byKind("budget")[0].detail).toContain("$0.53");
      const permissions = byKind("permission").sort((a, b) => a.createdAt - b.createdAt);
      expect(permissions.map((r) => [r.status, r.sessionId, r.step])).toEqual([
        ["approved", implementer.id, "implement"],
        ["denied", implementer.id, "implement"],
      ]);
      expect(permissions[1].title).toBe("implementer (codex) wants to run: pytest -q");
      expect(permissions[1].detail.startsWith("pytest -q\n\nTool call x1 (execute)")).toBe(true);
    });

    it("builds the session timelines", () => {
      const state = s();
      const byRole = (role: string) => Object.values(state.sessions).find((x) => x.role === role)!.events;
      const show = (e: SessionEvent) => {
        switch (e.kind) {
          case "message":
            return `${e.from}: ${e.text.slice(0, 24)}`;
          case "tool_call":
            return `tool ${e.toolCallId} ${e.tool} ${e.status}${e.output ? ` (${e.output})` : ""}`;
          case "diff":
            return `diff ${e.path}${e.oldText == null ? " (new)" : ""}`;
          case "plan":
            return `plan ${e.items.map((i) => i.status).join(",")}`;
          case "permission":
            return `permission ${state.requests[e.requestId].status}`;
          default:
            return e.kind;
        }
      };
      expect(byRole("planner").map(show)).toEqual([
        "user: You are the planner in a",
        "plan pending,pending",
        "agent: 1. Add GET /health retur",
      ]);
      expect(byRole("planner")[2]).toMatchObject({ text: "1. Add GET /health returning `ok`\n2. Cover it with a test\n" });
      expect(byRole("implementer").map(show)).toEqual([
        "user: You are the implementer ",
        "permission approved",
        "plan done,done",
        "tool r1 read ok",
        "tool w1 edit ok",
        "diff app.py",
        "permission denied",
        "tool t1 edit ok",
        "diff test_health.py (new)",
        "tool x1 execute error (denied)",
        "agent: Added `GET /health` and ",
      ]);
      expect(byRole("reviewer").map(show)).toEqual(["user: You are the reviewer in ", "agent: The endpoint is small an"]);
    });
  });
});

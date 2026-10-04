import { describe, expect, it } from "vitest";
import type { ApiEvent, ApiRequest, ApiRun, ApiSnapshot } from "./api";
import { applyEvent, applySnapshot, harnessToVendor, mapProject, mapRequest, mapRun } from "./mapping";
import { emptyState } from "./TauriDaemonClient";
// Recorded from `aux daemon --fake-agents` (agentux-core 614483c): one run
// through the default pipeline with the plan approved.
import recorded from "./__fixtures__/fake-agents-run.json";

const fixture = recorded as unknown as { snapshot: ApiSnapshot; events: ApiEvent[] };

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
    checks: [],
    gateAttempt: 0,
    gateMaxAttempts: 3,
    reviewRound: 0,
    reviewMaxRounds: 2,
    budgetUsd: null,
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
  it("keeps id/name/path and leaves repo/language empty", () => {
    expect(mapProject({ id: "p1", name: "ledger", path: "/src/ledger", createdAt: 1 })).toEqual({
      id: "p1",
      name: "ledger",
      path: "/src/ledger",
      repo: undefined,
      language: undefined,
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
    expect(run.usage).toBeUndefined();
    expect(run.sessions).toEqual({});
    expect(run.prompt).toBe("Add a health endpoint");
  });

  it("keeps values that are present", () => {
    const run = mapRun(
      apiRun({
        issue: 42,
        branch: "aux/3f9a0c12",
        budgetUsd: 10,
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

  it("maps daemon-only enum values", () => {
    expect(mapRun(apiRun({ status: "cancelled" })).status).toBe("cancelled");
    expect(mapRun(apiRun({ step: "custom", steps: ["plan", "custom"] })).steps).toEqual(["plan", "custom"]);
    expect(mapRun(apiRun({ step: "security_scan" })).step).toBe("custom");
    expect(mapRun(apiRun({ status: "paused_somehow" })).status).toBe("running");
    expect(mapRun(apiRun({ checks: [{ name: "x", command: "y", status: "skipped" }] })).checks[0].status).toBe("pending");
  });

  it("uses sessions and usage when a newer daemon sends them", () => {
    const run = mapRun(
      apiRun({ sessions: { planner: "s1", security: "s9" }, usage: { input: 1200, output: 300, costUsd: 0.02 } }),
    );
    expect(run.sessions).toEqual({ planner: "s1" });
    expect(run.usage).toEqual({ input: 1200, output: 300, costUsd: 0.02 });
  });
});

describe("mapRequest", () => {
  it("maps a pipeline approval without session fields", () => {
    const r = mapRequest(apiRequest());
    expect(r).toEqual({
      id: "q1",
      kind: "plan",
      runId: "3f9a0c12",
      projectId: "p1",
      sessionId: undefined,
      vendor: undefined,
      role: undefined,
      step: "plan",
      title: "Approve the plan",
      detail: "1. do it",
      options: undefined,
      status: "pending",
      answer: undefined,
      createdAt: 2000,
      resolvedAt: undefined,
    });
  });

  it("maps step approvals and cancelled requests", () => {
    const r = mapRequest(apiRequest({ kind: "step", step: "pull_request", status: "cancelled", resolvedAt: 3000 }));
    expect(r).toMatchObject({ kind: "step", step: "pull_request", status: "cancelled", resolvedAt: 3000 });
  });

  it("treats unknown kinds as step approvals and unknown statuses as resolved", () => {
    const r = mapRequest(apiRequest({ kind: "mystery", status: "expired" }));
    expect(r.kind).toBe("step");
    expect(r.status).toBe("cancelled");
  });

  it("uses harness session fields when a newer daemon sends them", () => {
    const r = mapRequest(
      apiRequest({
        kind: "question",
        sessionId: "s1",
        harness: "codex",
        role: "implementer",
        options: ["yes", "no"],
      }),
    );
    expect(r).toMatchObject({ kind: "question", sessionId: "s1", vendor: "codex", role: "implementer", options: ["yes", "no"] });
    expect(mapRequest(apiRequest({ vendor: "claude-code", role: "auditor" }))).toMatchObject({
      vendor: "claude-code",
      role: undefined,
    });
  });
});

describe("applyEvent", () => {
  const base = emptyState("test");
  const ev = (body: Record<string, unknown>, seq = 1) => ({ seq, at: 1, runId: null, ...body }) as ApiEvent;

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
    expect(applyEvent(base, ev({ kind: "session", session: { id: "s1" } }))).toBe(base);
  });
});

describe("recorded daemon output", () => {
  it("replaying every event gives the same state as the final listing", () => {
    const replayed = fixture.events.reduce(applyEvent, emptyState("test"));
    const listed = applySnapshot(emptyState("test"), fixture.snapshot);
    expect(replayed.projects).toEqual(listed.projects);
    expect(replayed.runs).toEqual(listed.runs);
    expect(replayed.requests).toEqual(listed.requests);
  });

  it("maps the finished run", () => {
    const s = applySnapshot(emptyState("test"), fixture.snapshot);
    const [run] = Object.values(s.runs);
    expect(run.status).toBe("done");
    expect(run.step).toBe("pull_request");
    expect(run.branch).toBe(`aux/${run.id}`);
    expect(run.pullRequest?.number).toBe(1);
    expect(run.roles.planner).toBe("claude-code");
    const [request] = Object.values(s.requests);
    expect(request).toMatchObject({ kind: "plan", status: "approved", runId: run.id, vendor: undefined });
  });
});

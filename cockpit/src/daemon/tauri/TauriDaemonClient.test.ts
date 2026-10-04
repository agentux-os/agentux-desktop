import { describe, expect, it } from "vitest";
import type { ApiEvent, ApiRequest, ApiRun, ApiSnapshot, LinkStatus } from "./api";
import { EVENT_CHANNEL, STATUS_CHANNEL, TauriDaemonClient, type Transport } from "./TauriDaemonClient";

function run(id: string, over: Partial<ApiRun> = {}): ApiRun {
  return {
    id,
    projectId: "p1",
    title: `run ${id}`,
    prompt: "do it",
    issue: null,
    branch: null,
    worktree: null,
    steps: ["plan"],
    stepIndex: 0,
    step: "plan",
    status: "running",
    roles: {},
    checks: [],
    gateAttempt: 0,
    gateMaxAttempts: 0,
    reviewRound: 0,
    reviewMaxRounds: 0,
    budgetUsd: null,
    startedAt: 1,
    updatedAt: 1,
    finishedAt: null,
    pullRequest: null,
    activity: "",
    error: null,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** In-memory stand-in for the Tauri backend. */
class FakeTransport implements Transport {
  handlers = new Map<string, ((p: unknown) => void)[]>();
  calls: { command: string; args?: Record<string, unknown> }[] = [];
  status: LinkStatus = { state: "connected", socket: "/run/agentuxd.sock", detail: "ok", lastSeq: 0, retryInMs: null };
  snapshots: (ApiSnapshot | Promise<ApiSnapshot>)[] = [];
  results: Record<string, unknown> = {};

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ command, args });
    if (command === "daemon_status") return this.status as T;
    if (command === "daemon_snapshot") return (await (this.snapshots.shift() ?? { projects: [], runs: [], requests: [] })) as T;
    if (command in this.results) return this.results[command] as T;
    return null as T;
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (p: unknown) => void);
    this.handlers.set(event, list);
    return () => this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
  }

  emit(event: string, payload: unknown) {
    (this.handlers.get(event) ?? []).forEach((h) => h(payload));
  }

  event(seq: number, body: Record<string, unknown>) {
    this.emit(EVENT_CHANNEL, { seq, at: seq, runId: null, ...body } as ApiEvent);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("TauriDaemonClient", () => {
  it("loads a snapshot on connect and follows events", async () => {
    const t = new FakeTransport();
    t.snapshots.push({ projects: [{ id: "p1", name: "a", path: "/a", createdAt: 1 }], runs: [run("r1")], requests: [] });
    const client = new TauriDaemonClient(t, "/run/agentuxd.sock");
    let notified = 0;
    client.subscribe(() => notified++);
    await client.connect();

    let s = client.getState();
    expect(s.connection).toMatchObject({ status: "connected", daemon: "/run/agentuxd.sock", mock: false });
    expect(s.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(Object.keys(s.runs)).toEqual(["r1"]);
    expect(t.calls.filter((c) => c.command === "daemon_snapshot")).toHaveLength(1);

    t.event(5, { kind: "run", run: run("r1", { status: "waiting" }) });
    t.event(6, { kind: "log", text: "ignored" });
    s = client.getState();
    expect(s.runs.r1.status).toBe("waiting");
    expect(notified).toBeGreaterThan(0);
  });

  it("applies events that arrive during a snapshot load after it, in order", async () => {
    const t = new FakeTransport();
    const snap = deferred<ApiSnapshot>();
    t.snapshots.push(snap.promise);
    const client = new TauriDaemonClient(t);
    const connecting = client.connect();
    await tick();

    // Newer than the snapshot below: must survive it.
    t.event(10, { kind: "run", run: run("r1", { status: "done" }) });
    snap.resolve({ projects: [], runs: [run("r1", { status: "running" })], requests: [] });
    await connecting;
    expect(client.getState().runs.r1.status).toBe("done");
  });

  it("reloads after the stream reconnects and reports disconnects", async () => {
    const t = new FakeTransport();
    const client = new TauriDaemonClient(t);
    await client.connect();

    t.emit(STATUS_CHANNEL, { state: "disconnected", socket: "/s", detail: "connection refused", lastSeq: 4, retryInMs: 2000 });
    expect(client.getState().connection).toMatchObject({ status: "disconnected" });
    expect(client.getState().connection.detail).toContain("retrying in 2s");

    const request: ApiRequest = {
      id: "q1", kind: "plan", runId: "r1", projectId: "p1", stepIndex: 0, step: "plan", title: "t", detail: "d",
      status: "pending", answer: null, createdAt: 1, resolvedAt: null,
    };
    t.snapshots.push({ projects: [], runs: [run("r1")], requests: [request] });
    t.emit(STATUS_CHANNEL, { state: "connected", socket: "/s", detail: "ok", lastSeq: 4, retryInMs: null });
    await tick();
    expect(t.calls.filter((c) => c.command === "daemon_snapshot")).toHaveLength(2);
    expect(client.getState().requests.q1.status).toBe("pending");
  });

  it("forwards actions to the backend commands", async () => {
    const t = new FakeTransport();
    t.results.daemon_start_run = run("r9", { title: "Fix it" });
    const client = new TauriDaemonClient(t);
    await client.connect();

    await client.approve("q1", "ok");
    await client.deny("q2");
    await client.cancelRun("r1");
    const started = await client.startRun({ projectPath: "/src/a", prompt: "Fix it" });

    expect(t.calls.filter((c) => !["daemon_status", "daemon_snapshot"].includes(c.command))).toEqual([
      { command: "daemon_approve", args: { requestId: "q1", answer: "ok" } },
      { command: "daemon_deny", args: { requestId: "q2" } },
      { command: "daemon_cancel", args: { runId: "r1" } },
      { command: "daemon_start_run", args: { path: "/src/a", prompt: "Fix it", title: undefined } },
    ]);
    expect(started.id).toBe("r9");
    expect(client.getState().runs.r9.title).toBe("Fix it");
    await expect(client.sendPrompt("s1", "hi")).rejects.toThrow();
    expect(await client.openTerminal("s1")).toBeNull();
  });

  it("stops listening on disconnect", async () => {
    const t = new FakeTransport();
    const client = new TauriDaemonClient(t);
    await client.connect();
    client.disconnect();
    t.event(3, { kind: "run", run: run("r1") });
    expect(client.getState().runs).toEqual({});
    expect(t.handlers.get(EVENT_CHANNEL)).toEqual([]);
  });
});

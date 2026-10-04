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
    if (command in this.results) return (await this.results[command]) as T;
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

    expect(t.calls.filter((c) => !["daemon_status", "daemon_snapshot", "daemon_capabilities"].includes(c.command))).toEqual([
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

  it("loads sessions with the snapshot and a run's history on watchRun", async () => {
    const t = new FakeTransport();
    const session = {
      id: "s1", runId: "r1", projectId: "p1", role: "implementer", harness: "codex", model: null, state: "active",
      cwd: "/wt", usage: { usedTokens: 5, contextTokens: 10, costUsd: 0.2 }, startedAt: 1, updatedAt: 1, endedAt: null,
    };
    t.snapshots.push({ projects: [], runs: [run("r1", { sessions: { implementer: "s1" }, costUsd: 0.2 })], requests: [], sessions: [session] });
    const history = deferred<unknown>();
    t.results.daemon_run_history = history.promise;
    const client = new TauriDaemonClient(t);
    await client.connect();
    expect(client.getState().sessions.s1).toMatchObject({ vendor: "codex", usage: { costUsd: 0.2 }, events: [] });

    client.watchRun("r1");
    client.watchRun("r1");
    expect(t.calls.filter((c) => c.command === "daemon_run_history")).toEqual([
      { command: "daemon_run_history", args: { runId: "r1" } },
    ]);
    // Live while the history loads: shown now, kept after the history.
    const live = (seq: number, text: string) =>
      t.emit(EVENT_CHANNEL, { seq, at: seq, runId: "r1", kind: "session_event", sessionId: "s1", event: { kind: "message", from: "agent", text } });
    live(9, "live ");
    expect(client.getState().sessions.s1.events).toHaveLength(1);
    history.resolve({
      head: 8,
      events: [
        { seq: 3, at: 3, runId: "r1", kind: "session_event", sessionId: "s1", event: { kind: "message", from: "user", text: "go" } },
        { seq: 9, at: 9, runId: "r1", kind: "session_event", sessionId: "s1", event: { kind: "message", from: "agent", text: "live " } },
      ],
    });
    await tick();
    live(10, "more");
    const texts = client.getState().sessions.s1.events.map((e) => (e.kind === "message" ? e.text : e.kind));
    expect(texts).toEqual(["go", "live more"]);
  });

  it("loads a run's bus log once, then follows bus_message events", async () => {
    const t = new FakeTransport();
    t.snapshots.push({ projects: [], runs: [run("r1"), run("r2")], requests: [] });
    const entry = (id: string, at: number) => ({
      id, runId: "r1", projectId: "p1", kind: "message", tool: "post_message",
      from: { kind: "session", sessionId: "s1", role: "implementer", vendor: "codex" }, to: { kind: "human" },
      subject: id, body: id, at, turn: 1, maxTurns: 6, messageId: at, exchange: at, inReplyTo: null,
      questionId: null, requestId: null, deliveredTo: [], queuedForRole: null,
    });
    const list = deferred<unknown>();
    t.results.daemon_bus_list = list.promise;
    const client = new TauriDaemonClient(t);
    await client.connect();

    client.watchRun("r1");
    client.watchBus(["r1", "r2"]);
    client.watchBus(["r1"]);
    expect(t.calls.filter((c) => c.command === "daemon_bus_list")).toEqual([
      { command: "daemon_bus_list", args: { runId: "r1" } },
      { command: "daemon_bus_list", args: { runId: "r2" } },
    ]);
    // A live entry before the listing arrives; the listing overlaps it.
    t.event(5, { runId: "r1", kind: "bus_message", message: entry("b2", 20) });
    list.resolve([entry("b1", 10), entry("b2", 20)]);
    await tick();
    expect(client.getState().bus.map((m) => m.id)).toEqual(["b1", "b2"]);
  });

  it("retries a failed bus load and probes optional methods", async () => {
    const t = new FakeTransport();
    // A thenable, so the rejection only happens when the client awaits it.
    t.results.daemon_bus_list = { then: (_: unknown, reject: (e: Error) => void) => reject(new Error("timeout")) };
    t.results.daemon_capabilities = { sessionsPrompt: true, busPost: false };
    const client = new TauriDaemonClient(t);
    await client.connect();
    await tick();
    expect(client.getState().capabilities).toEqual({ sessionsPrompt: true, busPost: false });
    client.watchBus(["r1"]);
    await tick();
    client.watchBus(["r1"]);
    expect(t.calls.filter((c) => c.command === "daemon_bus_list")).toHaveLength(2);
    await client.sendPrompt("s1", "hi");
    expect(t.calls[t.calls.length - 1]).toEqual({ command: "daemon_send_prompt", args: { sessionId: "s1", text: "hi" } });
  });

  it("keeps prompting disabled on daemons without sessions.prompt", async () => {
    const t = new FakeTransport();
    t.results.daemon_capabilities = { sessionsPrompt: false, busPost: false };
    const client = new TauriDaemonClient(t);
    await client.connect();
    await tick();
    await expect(client.sendPrompt("s1", "hi")).rejects.toThrow(/sessions.prompt/);
    expect(t.calls.some((c) => c.command === "daemon_send_prompt")).toBe(false);
  });

  it("posts on the bus only once the probe found bus.post", async () => {
    const t = new FakeTransport();
    t.results.daemon_capabilities = { sessionsPrompt: true, busPost: false };
    const client = new TauriDaemonClient(t);
    await client.connect();
    await tick();
    await expect(client.postBus({ runId: "r1", to: { kind: "run" }, body: "hi" })).rejects.toThrow(/bus.post/);
    expect(t.calls.some((c) => c.command === "daemon_bus_post")).toBe(false);

    // A later load (reconnect) probes again and finds it.
    t.results.daemon_capabilities = { sessionsPrompt: true, busPost: true };
    t.results.daemon_bus_post = { messageId: 1, exchange: 1, turn: 1, deliveredTo: [], queuedForRole: "reviewer" };
    t.status = { ...t.status, state: "disconnected" };
    t.emit(STATUS_CHANNEL, t.status);
    t.emit(STATUS_CHANNEL, { ...t.status, state: "connected" });
    await tick();
    await tick();
    expect(client.getState().capabilities).toEqual({ sessionsPrompt: true, busPost: true });
    const posted = await client.postBus({
      runId: "r1",
      to: { kind: "role", role: "reviewer" },
      body: " Look at the error path first. ",
      subject: "Review focus",
    });
    expect(posted).toEqual({ messageId: 1, exchange: 1, turn: 1, deliveredTo: [], queuedForRole: "reviewer" });
    expect(t.calls[t.calls.length - 1]).toEqual({
      command: "daemon_bus_post",
      args: { runId: "r1", to: { kind: "role", role: "reviewer" }, body: "Look at the error path first.", subject: "Review focus", inReplyTo: undefined },
    });
    // A reply goes without `to`; an empty body or no target never reaches the daemon.
    await client.postBus({ runId: "r1", body: "Thanks", inReplyTo: 2 });
    expect(t.calls[t.calls.length - 1].args).toEqual({ runId: "r1", to: undefined, body: "Thanks", subject: undefined, inReplyTo: 2 });
    await expect(client.postBus({ runId: "r1", to: { kind: "run" }, body: "  " })).rejects.toThrow(/empty/);
    await expect(client.postBus({ runId: "r1", body: "x" })).rejects.toThrow(/choose/);
    expect(t.calls.filter((c) => c.command === "daemon_bus_post")).toHaveLength(2);
  });

  it("answers a question with approve and declines it with deny", async () => {
    const t = new FakeTransport();
    const client = new TauriDaemonClient(t);
    await client.connect();
    await client.approve("q1", "sqlite");
    await client.deny("q2");
    expect(t.calls.filter((c) => c.command === "daemon_approve" || c.command === "daemon_deny")).toEqual([
      { command: "daemon_approve", args: { requestId: "q1", answer: "sqlite" } },
      { command: "daemon_deny", args: { requestId: "q2" } },
    ]);
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

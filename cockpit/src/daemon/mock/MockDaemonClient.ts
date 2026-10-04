import type { DaemonClient, StartRunInput, TerminalHandle } from "../client";
import type {
  BusEndpoint,
  CockpitState,
  PermissionRequest,
  Role,
  Run,
  Session,
  SessionEvent,
  SessionUsage,
} from "../types";
import { VENDOR_INFO, costOf } from "../vendors";
import { buildScript, scriptMarkIndex, type Beat, type DiffSpec, type Endpoint, type RunCtx, type ScenarioSpec } from "./script";
import { PROJECTS, SCENARIOS, SEED } from "./scenarios";

const TICK_MS = 400;
const MAX_ACTIVE_RUNS = 8;
const BUS_MAX_TURNS = 6;

interface Engine {
  runId: string;
  spec: ScenarioSpec;
  beats: Beat[];
  next: number;
  dueAt: number;
  blockedOn?: string;
  tools: Map<string, { sessionId: string; eventId: string }>;
}

/** Budget per run in mock runs (`budget.max_usd_per_run`). */
const MOCK_BUDGET_USD = 10;

/**
 * In-memory stand-in for `agentuxd`. Plays scripted runs (see scenarios.ts)
 * through the pipeline in real time, blocks on approvals until the human
 * answers in the UI, and starts new runs as old ones finish, so the cockpit
 * always has something moving.
 */
export class MockDaemonClient implements DaemonClient {
  readonly mode = "mock" as const;
  private state: CockpitState;
  private listeners = new Set<() => void>();
  private engines: Engine[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private interval: ReturnType<typeof setInterval> | undefined;
  private seq = 0;
  /** Clock used by beats: virtual during seeding, wall time afterwards. */
  private now = Date.now();
  private lastStarted = new Map<string, number>();
  private nextIssue = new Map<string, number>();
  private nextPr = new Map<string, number>();
  private readonly speed: number;

  /** `fallbackReason`: why the real daemon is not used (shown as a banner). */
  constructor(opts: { speed?: number; fallbackReason?: string } = {}) {
    this.speed = opts.speed ?? readSpeedParam();
    this.state = {
      connection: {
        status: "connecting",
        daemon: "mock",
        detail: "In-memory mock daemon",
        mock: true,
        fallbackReason: opts.fallbackReason,
      },
      projects: PROJECTS,
      runs: {},
      sessions: {},
      requests: {},
      bus: [],
    };
    for (const s of SCENARIOS) {
      this.nextIssue.set(s.projectId, Math.max(this.nextIssue.get(s.projectId) ?? 0, s.issue + 1));
      this.nextPr.set(s.projectId, Math.max(this.nextPr.get(s.projectId) ?? 0, s.pr.number + 1));
    }
    for (const seed of SEED) {
      const spec = SCENARIOS.find((s) => s.key === seed.key);
      if (spec) this.seedRun(spec, seed.until, seed.minutesAgo);
    }
    this.now = Date.now();
  }

  // ---- DaemonClient ---------------------------------------------------------

  async connect(): Promise<void> {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), TICK_MS);
    this.timers.push({
      at: Date.now() + 350,
      fn: () => this.update((s) => ({ ...s, connection: { ...s.connection, status: "connected" } })),
    });
  }

  disconnect(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    this.update((s) => ({ ...s, connection: { ...s.connection, status: "disconnected" } }));
    this.emit();
  }

  getState = (): CockpitState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async approve(requestId: string, answer?: string): Promise<void> {
    this.now = Date.now();
    this.resolve(requestId, "approve", answer);
    this.emit();
  }

  async deny(requestId: string): Promise<void> {
    this.now = Date.now();
    this.resolve(requestId, "deny");
    this.emit();
  }

  async startRun(_input: StartRunInput): Promise<Run> {
    throw new Error("Starting runs needs agentuxd; the cockpit is showing mock data");
  }

  async cancelRun(_runId: string): Promise<void> {
    throw new Error("Cancelling runs needs agentuxd; the cockpit is showing mock data");
  }

  watchRun(_runId: string): void {
    // Mock sessions carry their whole history already.
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    this.now = Date.now();
    const session = this.state.sessions[sessionId];
    if (!session) return;
    this.pushEvent(sessionId, { kind: "message", from: "user", text });
    this.emit();
    this.timers.push({
      at: Date.now() + 1400 / this.speed,
      fn: () => {
        this.pushEvent(sessionId, {
          kind: "message",
          from: "agent",
          text: "Noted. I'll take that into account for the rest of this step.",
        });
        this.addUsage(session.runId, sessionId, 4_000, 60);
      },
    });
  }

  async openTerminal(_sessionId: string): Promise<TerminalHandle | null> {
    // Terminal mode needs a PTY owned by agentuxd; there is none in mock mode.
    return null;
  }

  // ---- simulation -----------------------------------------------------------

  private tick() {
    const wall = Date.now();
    this.now = wall;
    const due = this.timers.filter((t) => t.at <= wall);
    this.timers = this.timers.filter((t) => t.at > wall);
    due.forEach((t) => t.fn());

    for (const e of [...this.engines]) {
      // A denied approval failed the run: its script stops there.
      if (this.state.runs[e.runId]?.status === "failed") {
        this.engines = this.engines.filter((x) => x !== e);
        this.timers.push({ at: wall + (12_000 + Math.random() * 15_000) / this.speed, fn: () => this.spawnRun() });
        continue;
      }
      if (e.blockedOn) {
        if (this.state.requests[e.blockedOn]?.status === "pending") continue;
        e.blockedOn = undefined;
        e.dueAt = wall + this.delayOf(e.beats[e.next]);
      }
      if (wall < e.dueAt) continue;
      this.step(e, false);
    }
    this.emit();
  }

  /** Executes the next beat of an engine. */
  private step(e: Engine, seeding: boolean): string | undefined {
    const beat = e.beats[e.next];
    if (!beat) return undefined;
    const result = beat.act(this.ctx(e));
    e.next += 1;
    const blockOn = result && "blockOn" in result ? result.blockOn : undefined;
    if (blockOn) e.blockedOn = blockOn;
    if (e.next >= e.beats.length) {
      this.engines = this.engines.filter((x) => x !== e);
      if (!seeding) this.timers.push({ at: Date.now() + (12_000 + Math.random() * 15_000) / this.speed, fn: () => this.spawnRun() });
    } else if (!seeding) {
      e.dueAt = this.now + this.delayOf(e.beats[e.next]);
    }
    return blockOn;
  }

  private delayOf(beat: Beat | undefined): number {
    return ((beat?.delay ?? 0) * (0.75 + Math.random() * 0.6)) / this.speed;
  }

  private seedRun(spec: ScenarioSpec, until: string | number, minutesAgo: number) {
    const beats = buildScript(spec);
    const stopAt = typeof until === "number" ? until : Math.min(beats.length, scriptMarkIndex(beats, until) + 1);
    const wall = Date.now();
    const startedAt = wall - minutesAgo * 60_000;
    const finished = stopAt >= beats.length;
    // Finished runs took 20-35 minutes; live ones have been going since startedAt.
    const span = finished ? (20 + Math.random() * 15) * 60_000 : minutesAgo * 60_000 - 5_000;
    const total = beats.slice(0, stopAt).reduce((acc, x) => acc + x.delay, 0) || 1;
    const engine = this.startEngine(spec, beats, startedAt);
    let t = startedAt;
    for (let i = 0; i < stopAt; i++) {
      t += (beats[i].delay / total) * span;
      this.now = t;
      const blockOn = this.step(engine, true);
      if (blockOn && i < stopAt - 1) {
        this.now = t + 20_000;
        this.resolve(blockOn, "approve");
        engine.blockedOn = undefined;
      }
    }
    this.now = wall;
    engine.dueAt = wall + this.delayOf(beats[engine.next]) + Math.random() * 2000;
  }

  private spawnRun() {
    const active = new Set(this.engines.map((e) => e.spec.key));
    if (active.size >= MAX_ACTIVE_RUNS) return;
    const candidates = SCENARIOS.filter((s) => !active.has(s.key)).sort(
      (a, b) => (this.lastStarted.get(a.key) ?? 0) - (this.lastStarted.get(b.key) ?? 0),
    );
    const base = candidates[0];
    if (!base) return;
    const issue = this.nextIssue.get(base.projectId) ?? base.issue;
    const pr = this.nextPr.get(base.projectId) ?? base.pr.number;
    this.nextIssue.set(base.projectId, issue + 1);
    this.nextPr.set(base.projectId, pr + 1);
    const spec: ScenarioSpec = {
      ...base,
      issue,
      pr: { ...base.pr, number: pr, summary: base.pr.summary.replace(/#\d+/, `#${pr}`) },
    };
    this.now = Date.now();
    const engine = this.startEngine(spec, buildScript(spec), this.now);
    engine.dueAt = this.now;
  }

  private startEngine(spec: ScenarioSpec, beats: Beat[], startedAt: number): Engine {
    const id = this.id("run");
    const run: Run = {
      id,
      projectId: spec.projectId,
      title: spec.title,
      issue: spec.issue,
      branch: `aux/${spec.issue}-${spec.slug}`,
      steps: ["plan", "implement", "gate", "review", "pull_request"],
      stepIndex: 0,
      step: "plan",
      status: "running",
      roles: spec.roles,
      sessions: {},
      checks: spec.checks.map((c) => ({ name: c.name, command: c.command, status: "pending" })),
      gateAttempt: 0,
      gateMaxAttempts: 3,
      reviewRound: 0,
      reviewMaxRounds: 2,
      budgetUsd: MOCK_BUDGET_USD,
      costUsd: 0,
      startedAt,
      updatedAt: startedAt,
      activity: "Queued",
    };
    this.update((s) => ({ ...s, runs: { ...s.runs, [id]: run } }));
    this.lastStarted.set(spec.key, startedAt);
    const engine: Engine = { runId: id, spec, beats, next: 0, dueAt: startedAt, tools: new Map() };
    this.engines.push(engine);
    return engine;
  }

  /** Binds the script operations to one run. */
  private ctx(e: Engine): RunCtx {
    const runId = e.runId;
    const run = () => this.state.runs[runId];
    const session = (role: Role) => this.ensureSession(runId, role);
    const endpoint = (x: Endpoint): BusEndpoint => {
      if (x === "human") return { kind: "human" };
      if (x === "daemon") return { kind: "daemon" };
      const sid = session(x);
      return { kind: "session", sessionId: sid, role: x, vendor: run().roles[x] };
    };
    return {
      branch: run().branch ?? "",
      step: (step, activity) =>
        this.patchRun(runId, { step, stepIndex: Math.max(0, (run().steps ?? []).indexOf(step)), activity }),
      activity: (activity) => this.patchRun(runId, { activity }),
      sessionState: (role, state) => {
        const sid = run().sessions[role];
        if (sid) this.patchSession(sid, { state });
      },
      user: (role, text) => {
        this.pushEvent(session(role), { kind: "message", from: "user", text });
      },
      say: (role, text, tokens = [8_000, 150]) => {
        const sid = session(role);
        this.pushEvent(sid, { kind: "message", from: "agent", text });
        this.addUsage(runId, sid, tokens[0], tokens[1]);
        this.patchRun(runId, {});
      },
      system: (role, text) => {
        this.pushEvent(session(role), { kind: "message", from: "system", text });
      },
      toolStart: (role, key, tool, title, input) => {
        const sid = session(role);
        const eventId = this.pushEvent(sid, { kind: "tool_call", toolCallId: key, tool, title, status: "running", input });
        e.tools.set(key, { sessionId: sid, eventId });
        this.patchRun(runId, {});
      },
      toolEnd: (key, status, output) => {
        const ref = e.tools.get(key);
        if (!ref) return;
        this.patchEvent(ref.sessionId, ref.eventId, { status, output });
        this.addUsage(runId, ref.sessionId, 3_000 + Math.round(Math.random() * 4000), 60);
      },
      diff: (role, spec) => {
        const sid = session(role);
        this.pushEvent(sid, { kind: "diff", ...specToTexts(spec) });
        this.addUsage(runId, sid, 14_000, 700);
      },
      plan: (role, items) => {
        const sid = session(role);
        const existing = this.state.sessions[sid].events.find((x) => x.kind === "plan");
        if (existing) this.patchEvent(sid, existing.id, { items });
        else this.pushEvent(sid, { kind: "plan", items });
      },
      request: (role, kind, title, detail) => this.addRequest(runId, role ? session(role) : undefined, kind, title, detail),
      budget: () => {
        const r = run();
        const budget = Math.max(0.01, Math.floor(r.costUsd * 90) / 100);
        this.patchRun(runId, { budgetUsd: budget });
        const id = this.addRequest(
          runId,
          undefined,
          "budget",
          `"${r.title}" is over its budget`,
          `The run has cost $${r.costUsd.toFixed(2)}, more than its budget of $${budget.toFixed(2)}. ` +
            `Approve to continue with another $${MOCK_BUDGET_USD.toFixed(2)}; deny to stop the run.`,
        );
        this.patchRun(runId, { activity: `waiting for approval (${id})` });
        return id;
      },
      decision: (requestId) => {
        const r = this.state.requests[requestId];
        return { status: r?.status ?? "approved", answer: r?.answer };
      },
      bus: (tool, from, to, subject, body, turn = 1) => {
        const id = this.id("msg");
        const r = run();
        const msg = {
          id,
          runId,
          projectId: r.projectId,
          tool,
          from: endpoint(from),
          to: endpoint(to),
          subject,
          body,
          at: this.now,
          turn,
          maxTurns: BUS_MAX_TURNS,
        };
        this.update((s) => ({ ...s, bus: [...s.bus, msg] }));
        for (const ep of [msg.from, msg.to]) {
          if (ep.kind === "session") this.pushEvent(ep.sessionId, { kind: "bus", messageId: id });
        }
      },
      checks: (status, only) =>
        this.patchRun(runId, {
          checks: run().checks.map((c) => (!only || c.name === only ? { ...c, status } : c)),
        }),
      gateAttempt: (n) => this.patchRun(runId, { gateAttempt: n }),
      reviewRound: (n) => this.patchRun(runId, { reviewRound: n }),
      finish: (prNumber) => {
        const r = run();
        const repo = this.state.projects.find((p) => p.id === r.projectId)?.repo ?? "";
        for (const sid of Object.values(r.sessions)) this.patchSession(sid, { state: "ended", endedAt: this.now });
        this.patchRun(runId, {
          status: "done",
          finishedAt: this.now,
          activity: `Pull request #${prNumber} opened`,
          pullRequest: { number: prNumber, url: `https://github.com/${repo}/pull/${prNumber}` },
        });
      },
    };
  }

  /** Same shape as agentuxd: pipeline approvals have no session; permissions name the asking session. */
  private addRequest(
    runId: string,
    sessionId: string | undefined,
    kind: PermissionRequest["kind"],
    title: string,
    detail: string,
  ): string {
    const id = this.id("req");
    const r = this.state.runs[runId];
    const req: PermissionRequest = {
      id,
      kind,
      runId,
      projectId: r.projectId,
      sessionId: kind === "permission" ? sessionId : undefined,
      step: r.step,
      stepIndex: r.stepIndex ?? 0,
      title,
      detail,
      status: "pending",
      createdAt: this.now,
    };
    this.update((s) => ({ ...s, requests: { ...s.requests, [id]: req } }));
    if (req.sessionId) {
      this.pushEvent(req.sessionId, { kind: "permission", requestId: id });
      this.patchSession(req.sessionId, { state: "waiting" });
    }
    this.patchRun(runId, { status: "waiting" });
    return id;
  }

  /**
   * Like agentuxd: denying a permission tells the agent no and the run goes
   * on; denying any other request fails the run. Approving a budget request
   * raises the budget to the current cost plus the configured amount.
   */
  private resolve(requestId: string, action: "approve" | "deny", answer?: string) {
    const req = this.state.requests[requestId];
    if (!req || req.status !== "pending") return;
    const next: PermissionRequest = {
      ...req,
      status: action === "deny" ? "denied" : "approved",
      answer,
      resolvedAt: this.now,
    };
    this.update((s) => ({ ...s, requests: { ...s.requests, [requestId]: next } }));
    if (action === "deny" && req.kind !== "permission") {
      for (const sid of Object.values(this.state.runs[req.runId]?.sessions ?? {})) {
        this.patchSession(sid, { state: "ended", endedAt: this.now });
      }
      this.patchRun(req.runId, { status: "failed", finishedAt: this.now, activity: "failed", error: `${req.title}: denied` });
      return;
    }
    const run = this.state.runs[req.runId];
    if (req.kind === "budget" && run) {
      const budgetUsd = run.costUsd + MOCK_BUDGET_USD;
      this.patchRun(req.runId, { budgetUsd, activity: `budget raised to $${budgetUsd.toFixed(2)}; continuing` });
    }
    const stillWaiting = Object.values(this.state.requests).some((r) => r.runId === req.runId && r.status === "pending");
    if (!stillWaiting) {
      this.patchRun(req.runId, { status: "running", activity: req.kind === "permission" ? "the agent is working" : "approved, continuing" });
    }
    if (req.sessionId) this.patchSession(req.sessionId, { state: "active" });
  }

  // ---- immutable state helpers ----------------------------------------------

  private update(fn: (s: CockpitState) => CockpitState) {
    this.state = fn(this.state);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq.toString(36)}`;
  }

  private patchRun(runId: string, patch: Partial<Run>) {
    this.update((s) => {
      const r = s.runs[runId];
      if (!r) return s;
      // Runs that finished stay finished, even if a late beat tries to touch them.
      const final = r.status === "done" || r.status === "failed";
      const status = final ? r.status : (patch.status ?? r.status);
      return { ...s, runs: { ...s.runs, [runId]: { ...r, ...patch, status, updatedAt: this.now } } };
    });
  }

  private patchSession(sessionId: string, patch: Partial<Session>) {
    this.update((s) => {
      const x = s.sessions[sessionId];
      if (!x) return s;
      return { ...s, sessions: { ...s.sessions, [sessionId]: { ...x, ...patch } } };
    });
  }

  private ensureSession(runId: string, role: Role): string {
    const run = this.state.runs[runId];
    const existing = run.sessions[role];
    if (existing) return existing;
    // Mock runs always fill every role.
    const vendor = run.roles[role] ?? "claude-code";
    const id = this.id("ses");
    const session: Session = {
      id,
      runId,
      projectId: run.projectId,
      role,
      harness: vendor,
      vendor,
      model: VENDOR_INFO[vendor].defaultModel,
      state: "active",
      cwd: `~/.local/share/agentux/worktrees/${run.id}`,
      events: [],
      usage: { usedTokens: 0, contextTokens: VENDOR_INFO[vendor].contextWindow, costUsd: 0 },
      startedAt: this.now,
    };
    this.update((s) => ({
      ...s,
      sessions: { ...s.sessions, [id]: session },
      runs: { ...s.runs, [runId]: { ...run, sessions: { ...run.sessions, [role]: id } } },
    }));
    return id;
  }

  private pushEvent(sessionId: string, event: DistributiveOmit<SessionEvent, "id" | "at">): string {
    const id = this.id("ev");
    const full = { ...event, id, at: this.now } as SessionEvent;
    this.update((s) => {
      const x = s.sessions[sessionId];
      if (!x) return s;
      const state = x.state === "ended" || x.state === "waiting" ? x.state : "active";
      return { ...s, sessions: { ...s.sessions, [sessionId]: { ...x, state, events: [...x.events, full] } } };
    });
    return id;
  }

  private patchEvent(sessionId: string, eventId: string, patch: Record<string, unknown>) {
    this.update((s) => {
      const x = s.sessions[sessionId];
      if (!x) return s;
      const events = x.events.map((ev) => (ev.id === eventId ? ({ ...ev, ...patch } as SessionEvent) : ev));
      return { ...s, sessions: { ...s.sessions, [sessionId]: { ...x, events } } };
    });
  }

  /**
   * Like an ACP usage update: the context window fills up and the session's
   * cumulative cost grows; the run's cost is the sum over its sessions.
   */
  private addUsage(runId: string, sessionId: string, input: number, output: number) {
    const session = this.state.sessions[sessionId];
    if (!session?.vendor) return;
    const window = VENDOR_INFO[session.vendor].contextWindow;
    const cost = costOf(session.vendor, input, output);
    const usage: SessionUsage = {
      contextTokens: window,
      usedTokens: Math.min(window, session.usage.usedTokens + Math.round(input / 3) + output),
      costUsd: (session.usage.costUsd ?? 0) + cost,
    };
    this.update((s) => {
      const r = s.runs[runId];
      return {
        ...s,
        sessions: { ...s.sessions, [sessionId]: { ...session, usage } },
        runs: r ? { ...s.runs, [runId]: { ...r, costUsd: r.costUsd + cost } } : s.runs,
      };
    });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function readSpeedParam(): number {
  if (typeof location === "undefined") return 0.7;
  const v = Number(new URLSearchParams(location.search).get("speed"));
  // Default pace is a little slower than real time so a demo stays readable.
  return Number.isFinite(v) && v > 0 ? v : 0.7;
}

/** Old and new text of the region a hand-written hunk covers (agentuxd sends whole texts, not hunks). */
export function specToTexts(spec: DiffSpec): { path: string; oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const raw of spec.body.split("\n")) {
    const prefix = raw[0] ?? " ";
    const text = raw.slice(1);
    if (prefix !== "+") oldLines.push(text);
    if (prefix !== "-") newLines.push(text);
  }
  return { path: spec.path, oldText: `${oldLines.join("\n")}\n`, newText: `${newLines.join("\n")}\n` };
}

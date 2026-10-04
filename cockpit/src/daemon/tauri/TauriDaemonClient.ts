import type { DaemonClient, StartRunInput, TerminalHandle, TerminalSink, TerminalSize } from "../client";
import type { BusPostInput, BusPostResult, CockpitState, Run } from "../types";
import {
  base64ToBytes,
  binaryToBase64,
  liveTerminalFor,
  targetKey,
  terminalMatches,
  textToBase64,
  type TerminalTarget,
} from "../../lib/terminal";
import type {
  ApiBusMessage,
  ApiBusPostResult,
  ApiCapabilities,
  ApiEvent,
  ApiRun,
  ApiRunHistory,
  ApiSnapshot,
  ApiTerminal,
  ApiTerminalEvent,
  CommandError,
  LinkStatus,
  Probe,
} from "./api";
import {
  applyBusList,
  applyEvent,
  applyRunHistory,
  applySnapshot,
  applyTerminalExit,
  applyTerminals,
  mapRun,
  mapTerminal,
} from "./mapping";

/** Tauri event channels emitted by the backend (`src-tauri/src/daemon/mod.rs`). */
export const EVENT_CHANNEL = "daemon://event";
export const STATUS_CHANNEL = "daemon://status";
/** A terminal's events (`terminal.rs`): `terminal://<stream>`, the stream named by the UI. */
export const terminalChannel = (stream: string) => `terminal://${stream}`;

/** How often a terminal waiting for its session's turn is looked up again. */
const TERMINAL_POLL_MS = 1000;
/** JSON-RPC "not found" (agentux-core): e.g. a terminal that exited. */
const NOT_FOUND = -32001;

/** The two Tauri primitives the client needs; injectable for tests. */
export interface Transport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
}

/** The real transport, loaded lazily so the browser build never touches Tauri. */
export async function tauriTransport(): Promise<Transport> {
  const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
  return {
    invoke: (command, args) => invoke(command, args),
    listen: (event, handler) => listen(event, (e) => handler(e.payload as never)),
  };
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function probeDaemon(transport: Transport): Promise<Probe> {
  try {
    return await transport.invoke<Probe>("daemon_probe");
  } catch (e) {
    return { reachable: false, socket: null, detail: errorMessage(e) };
  }
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as CommandError).message);
  return String(e);
}

export function emptyState(daemon: string): CockpitState {
  return {
    connection: { status: "connecting", daemon, detail: "Connecting to agentuxd", mock: false },
    projects: [],
    runs: {},
    sessions: {},
    requests: {},
    bus: [],
    terminals: {},
  };
}

function rpcCode(e: unknown): number | null {
  return e && typeof e === "object" && "code" in e && typeof (e as CommandError).code === "number"
    ? (e as CommandError).code
    : null;
}

/**
 * DaemonClient backed by the real `agentuxd`, through the Tauri backend.
 *
 * State comes from two sources: a snapshot (`daemon_snapshot`: projects, runs
 * and requests) loaded at start and after every reconnect, and the event
 * stream the backend forwards. Events that arrive while a snapshot is loading
 * are buffered and applied after it, in order; since every event carries a
 * full object, replaying them over a newer snapshot converges to the latest
 * state. The backend resumes its subscription from the last `seq` after a
 * reconnect, so no event is lost while the daemon restarts.
 *
 * The stream starts at the daemon's head, so session entries from before the
 * cockpit started come from a run's stored events (`daemon_run_history`),
 * loaded once per run when the UI opens it (`watchRun`). The backend pages
 * them with `runs.events` and continues with
 * `events.subscribe { runId, since: headSeq }` up to its `replay_done`, so the
 * history is exact up to its `head`; daemons before agentux-core #9 get a
 * replayed subscription instead. Live session events for that run keep being
 * applied meanwhile and are applied again on top of the history; sessions
 * skip events they already folded (by seq).
 *
 * The agent-bus log of a run comes from `bus.list` (`daemon_bus_list`), loaded
 * once per run when the UI shows it (`watchRun`, `watchBus`), and then from
 * live `bus_message` events; entries are merged by id, so overlaps are fine.
 * Optional methods (`sessions.prompt`, `bus.post`, `terminals.*`) are probed
 * after each load and stay disabled on daemons that do not serve them.
 *
 * Terminals: the backend gives each terminal its own socket connection (the
 * daemon ties a terminal to the connection that opened it) and emits its
 * output on `terminal://<stream>`, a name chosen here and listened to before
 * the open, so nothing that follows the open is missed. A target (a
 * session's TUI, a run's shell) with a terminal still running is attached
 * rather than opened again; concurrent opens of one target share the first.
 * A terminal waiting for its session's turn is looked up every second until
 * it runs.
 */
export class TauriDaemonClient implements DaemonClient {
  readonly mode = "daemon" as const;
  private state: CockpitState;
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  /** Bumped by connect/disconnect so late async work from an old connection is dropped. */
  private generation = 0;
  private active = false;
  private buffer: ApiEvent[] | null = null;
  private loading: Promise<void> | null = null;
  private reloadAgain = false;
  /** Runs whose history is loaded or loading; live session events of loading ones, to re-apply. */
  private histories = new Map<string, ApiEvent[] | "loaded">();
  /** Runs whose bus log is loaded or loading. */
  private busLogs = new Set<string>();
  /** Opens in flight by target key, so a second view of the target attaches instead. */
  private opening = new Map<string, Promise<ApiTerminal>>();
  private streamSeq = 0;
  /** Timers looking up terminals that wait for their session's turn. */
  private polls = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly transport: Transport,
    socket = "agentuxd",
  ) {
    this.state = emptyState(socket);
  }

  // ---- DaemonClient ---------------------------------------------------------

  async connect(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const gen = ++this.generation;
    const stops = await Promise.all([
      this.transport.listen<ApiEvent>(EVENT_CHANNEL, (e) => gen === this.generation && this.onEvent(e)),
      this.transport.listen<LinkStatus>(STATUS_CHANNEL, (s) => gen === this.generation && this.onStatus(s)),
    ]);
    if (gen !== this.generation) {
      stops.forEach((stop) => stop());
      return;
    }
    this.unlisten.push(...stops);
    try {
      this.onStatus(await this.transport.invoke<LinkStatus>("daemon_status"));
    } catch {
      /* status arrives with the next daemon://status event */
    }
    // The startup probe found the daemon reachable: load now rather than
    // waiting for the event stream to report `connected` (unless the status
    // above already started a load).
    await (this.loading ?? this.reload());
  }

  disconnect(): void {
    this.generation++;
    this.active = false;
    this.unlisten.forEach((stop) => stop());
    this.unlisten = [];
    this.buffer = null;
    this.loading = null;
    this.reloadAgain = false;
    this.histories.clear();
    this.busLogs.clear();
    this.polls.forEach((timer) => clearInterval(timer));
    this.polls.clear();
  }

  getState = (): CockpitState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async approve(requestId: string, answer?: string): Promise<void> {
    await this.transport.invoke("daemon_approve", { requestId, answer });
  }

  async deny(requestId: string): Promise<void> {
    await this.transport.invoke("daemon_deny", { requestId });
  }

  watchBus(runIds: string[]): void {
    if (!this.active) return;
    for (const runId of runIds) {
      if (!this.busLogs.has(runId)) void this.loadBus(runId);
    }
  }

  async startRun(input: StartRunInput): Promise<Run> {
    const run = await this.transport.invoke<ApiRun>("daemon_start_run", {
      path: input.projectPath,
      prompt: input.prompt,
      title: input.title,
    });
    // The run event follows on the stream; apply the result now so the UI can
    // open the run immediately.
    this.update((s) => applyEvent(s, { kind: "run", seq: 0, at: Date.now(), runId: run.id, run }));
    return mapRun(run);
  }

  async cancelRun(runId: string): Promise<void> {
    await this.transport.invoke("daemon_cancel", { runId });
  }

  watchRun(runId: string): void {
    if (!this.active) return;
    this.watchBus([runId]);
    if (this.histories.has(runId)) return;
    void this.loadHistory(runId);
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    if (!this.state.capabilities?.sessionsPrompt) {
      throw new Error("this agentuxd does not accept prompts into sessions (no sessions.prompt)");
    }
    await this.transport.invoke("daemon_send_prompt", { sessionId, text });
  }

  async postBus(input: BusPostInput): Promise<BusPostResult> {
    if (!this.state.capabilities?.busPost) {
      throw new Error("this agentuxd does not take posts on the bus (no bus.post)");
    }
    const body = input.body.trim();
    if (!body) throw new Error("the message is empty");
    if (!input.to && input.inReplyTo == null) throw new Error("choose who gets the message, or reply to one");
    const r = await this.transport.invoke<ApiBusPostResult>("daemon_bus_post", {
      runId: input.runId,
      to: input.to,
      body,
      subject: input.subject?.trim() || undefined,
      inReplyTo: input.inReplyTo,
    });
    // The entry itself follows on the stream as a `bus_message` event.
    return {
      messageId: r.messageId,
      exchange: r.exchange,
      turn: r.turn,
      deliveredTo: Array.isArray(r.deliveredTo) ? r.deliveredTo : [],
      queuedForRole: r.queuedForRole ?? undefined,
    };
  }

  async openTerminal(target: TerminalTarget, size: TerminalSize, sink: TerminalSink): Promise<TerminalHandle> {
    if (!this.state.capabilities?.terminals) {
      throw new Error("this agentuxd has no terminal mode (no terminals.*)");
    }
    const stream = `term-${++this.streamSeq}-${Math.random().toString(36).slice(2, 8)}`;
    let done = false;
    let unlisten: (() => void) | undefined;
    const stop = () => {
      done = true;
      unlisten?.();
      unlisten = undefined;
    };
    unlisten = await this.transport.listen<ApiTerminalEvent>(terminalChannel(stream), (e) => {
      if (done || !e) return;
      if (e.kind === "output") sink.output(base64ToBytes(e.data));
      else if (e.kind === "exit") {
        this.update((s) => applyTerminalExit(s, e.terminalId, e.code ?? null));
        stop();
        sink.exit(e.code ?? null);
      } else if (e.kind === "closed") {
        this.update((s) => applyTerminalExit(s, e.terminalId, null));
        stop();
        sink.lost(e.reason);
      }
    });

    let terminal: ApiTerminal;
    try {
      terminal = await this.openOrAttach(target, size, stream);
    } catch (e) {
      stop();
      throw e;
    }
    const terminalId = terminal.terminalId;
    if (terminal.cols !== size.cols || terminal.rows !== size.rows) {
      void this.transport.invoke("terminal_resize", { terminalId, ...size }).catch(() => undefined);
    }
    if (mapTerminal(terminal).state === "waiting") this.pollWhileWaiting(terminalId, target);

    const send = (data: string) => {
      if (done) return;
      void this.transport.invoke("terminal_write", { terminalId, data }).catch(() => undefined);
    };
    return {
      terminalId,
      input: (text) => send(textToBase64(text)),
      inputBinary: (data) => send(binaryToBase64(data)),
      resize: (cols, rows) => {
        if (done || cols < 1 || rows < 1) return;
        void this.transport.invoke("terminal_resize", { terminalId, cols, rows }).catch(() => undefined);
      },
      detach: () => {
        if (done) return;
        stop();
        void this.transport.invoke("terminal_detach", { terminalId }).catch(() => undefined);
      },
      close: async () => {
        // The exit also arrives on the stream (while it is listened to).
        await this.transport.invoke("terminal_close", { terminalId });
        this.update((s) => applyTerminalExit(s, terminalId, s.terminals[terminalId]?.exitCode ?? null));
      },
    };
  }

  async closeTerminals(filter: { runId: string; command?: TerminalTarget["command"] }): Promise<void> {
    const targets = Object.values(this.state.terminals).filter(
      (t) =>
        t.held &&
        t.state !== "exited" &&
        t.runId === filter.runId &&
        (!filter.command || (filter.command === "harness-tui" ? !!t.sessionId : !t.sessionId)),
    );
    await Promise.all(
      targets.map(async (t) => {
        try {
          await this.transport.invoke("terminal_close", { terminalId: t.terminalId });
        } catch {
          /* already gone */
        }
        this.update((s) => applyTerminalExit(s, t.terminalId, s.terminals[t.terminalId]?.exitCode ?? null));
      }),
    );
  }

  // ---- internals ------------------------------------------------------------

  /**
   * Attaches to the target's running terminal if there is one (an open in
   * flight for it, or one `terminal_list` reports), else opens one.
   */
  private async openOrAttach(target: TerminalTarget, size: TerminalSize, stream: string): Promise<ApiTerminal> {
    const key = targetKey(target);
    const inFlight = this.opening.get(key);
    let existing: { terminalId: string; held?: boolean } | undefined;
    if (inFlight) {
      existing = await inFlight.then(
        (t) => ({ terminalId: t.terminalId, held: true }),
        () => undefined,
      );
    } else {
      existing = await this.findLive(target);
    }
    if (existing) {
      const { terminalId, held } = existing;
      try {
        const attached = await this.transport.invoke<ApiTerminal>("terminal_attach", { terminalId, stream });
        this.update((s) => applyTerminals(s, [attached], held ?? s.terminals[attached.terminalId]?.held));
        return attached;
      } catch (e) {
        if (rpcCode(e) !== NOT_FOUND) throw e;
        this.update((s) => applyTerminalExit(s, terminalId, null));
      }
    }
    const opening = this.transport.invoke<ApiTerminal>("terminal_open", {
      sessionId: target.command === "harness-tui" ? target.sessionId : undefined,
      runId: target.runId,
      command: target.command,
      cols: size.cols,
      rows: size.rows,
      stream,
    });
    this.opening.set(key, opening);
    try {
      const opened = await opening;
      this.update((s) => applyTerminals(s, [opened], true));
      return opened;
    } finally {
      if (this.opening.get(key) === opening) this.opening.delete(key);
    }
  }

  private terminalFilter(target: TerminalTarget): Record<string, unknown> {
    return target.command === "harness-tui" ? { sessionId: target.sessionId } : { runId: target.runId };
  }

  /** The target's running terminal according to the daemon (recorded in the state), if any. */
  private async findLive(target: TerminalTarget): Promise<{ terminalId: string; held?: boolean } | undefined> {
    let list: ApiTerminal[];
    try {
      list = await this.transport.invoke<ApiTerminal[]>("terminal_list", this.terminalFilter(target));
    } catch {
      return undefined;
    }
    if (!Array.isArray(list)) return undefined;
    const matching = list.filter((t) => t && typeof t.terminalId === "string" && terminalMatches(mapTerminal(t), target));
    this.update((s) => applyTerminals(s, matching));
    const live = liveTerminalFor(Object.fromEntries(matching.map((t) => [t.terminalId, mapTerminal(t)])), target);
    return live && { terminalId: live.terminalId, held: live.held };
  }

  /** Looks the terminal up every second while it waits for its session's turn. */
  private pollWhileWaiting(terminalId: string, target: TerminalTarget): void {
    if (this.polls.has(terminalId)) return;
    const gen = this.generation;
    const timer = setInterval(() => {
      const t = this.state.terminals[terminalId];
      if (gen !== this.generation || !t || t.state !== "waiting") {
        clearInterval(timer);
        this.polls.delete(terminalId);
        return;
      }
      void this.transport
        .invoke<ApiTerminal[]>("terminal_list", this.terminalFilter(target))
        .then((list) => {
          if (gen !== this.generation || !Array.isArray(list)) return;
          const mine = list.find((x) => x && x.terminalId === terminalId);
          if (mine) this.update((s) => applyTerminals(s, [mine]));
        })
        .catch(() => undefined);
    }, TERMINAL_POLL_MS);
    this.polls.set(terminalId, timer);
  }

  private onEvent(event: ApiEvent): void {
    const pending = event.runId ? this.histories.get(event.runId) : undefined;
    if (Array.isArray(pending) && (event.kind === "session_event" || event.kind === "bus_message")) pending.push(event);
    if (this.buffer) {
      this.buffer.push(event);
      return;
    }
    this.update((s) => applyEvent(s, event));
  }

  private onStatus(status: LinkStatus): void {
    const was = this.state.connection.status;
    this.update((s) => ({
      ...s,
      connection: {
        ...s.connection,
        status: status.state,
        daemon: status.socket ?? s.connection.daemon,
        detail: status.state === "disconnected" && status.retryInMs != null
          ? `${status.detail} (retrying in ${Math.round(status.retryInMs / 100) / 10}s)`
          : status.detail,
      },
    }));
    // After a reconnect, reload: the daemon may have restarted with changes
    // that happened before the replayed events (or a reset store).
    if (status.state === "connected" && was !== "connected") void this.reload();
  }

  /** Loads a snapshot, buffering events meanwhile. Coalesces concurrent calls. */
  private reload(): Promise<void> {
    if (this.loading) {
      this.reloadAgain = true;
      return this.loading;
    }
    const loading: Promise<void> = this.load().finally(() => {
      if (this.loading === loading) this.loading = null;
    });
    this.loading = loading;
    return loading;
  }

  private async load(): Promise<void> {
    const gen = this.generation;
    this.buffer = [];
    try {
      const snap = await this.transport.invoke<ApiSnapshot>("daemon_snapshot");
      if (gen !== this.generation) return;
      const buffered = this.buffer ?? [];
      this.buffer = null;
      this.update((s) => buffered.reduce(applyEvent, applySnapshot(s, snap)));
      void this.probeCapabilities(gen);
    } catch (e) {
      if (gen !== this.generation) return;
      const buffered = this.buffer ?? [];
      this.buffer = null;
      this.update((s) => ({
        ...buffered.reduce(applyEvent, s),
        connection: { ...s.connection, detail: `Could not load state: ${errorMessage(e)}` },
      }));
    }
    if (this.reloadAgain && gen === this.generation) {
      this.reloadAgain = false;
      await this.load();
    }
  }

  private async loadHistory(runId: string): Promise<void> {
    const gen = this.generation;
    const live: ApiEvent[] = [];
    this.histories.set(runId, live);
    try {
      const history = await this.transport.invoke<ApiRunHistory>("daemon_run_history", { runId });
      if (gen !== this.generation) return;
      this.histories.set(runId, "loaded");
      this.update((s) => live.reduce(applyEvent, applyRunHistory(s, runId, history)));
    } catch {
      // Live events still show; opening the run again retries.
      if (gen === this.generation) this.histories.delete(runId);
    }
  }

  private async loadBus(runId: string): Promise<void> {
    const gen = this.generation;
    this.busLogs.add(runId);
    try {
      const list = await this.transport.invoke<ApiBusMessage[]>("daemon_bus_list", { runId });
      if (gen !== this.generation) return;
      if (Array.isArray(list)) this.update((s) => applyBusList(s, list));
    } catch {
      // Live entries still show; showing the run again retries.
      if (gen === this.generation) this.busLogs.delete(runId);
    }
  }

  /** Which optional methods this daemon serves; absent ones stay disabled. */
  private async probeCapabilities(gen: number): Promise<void> {
    try {
      const caps = await this.transport.invoke<ApiCapabilities>("daemon_capabilities");
      if (gen !== this.generation || !caps) return;
      const capabilities = {
        sessionsPrompt: caps.sessionsPrompt === true,
        busPost: caps.busPost === true,
        terminals: caps.terminals === true,
      };
      this.update((s) =>
        s.capabilities?.sessionsPrompt === capabilities.sessionsPrompt &&
        s.capabilities?.busPost === capabilities.busPost &&
        s.capabilities?.terminals === capabilities.terminals
          ? s
          : { ...s, capabilities },
      );
    } catch {
      /* an older backend: keep everything optional disabled */
    }
  }

  private update(fn: (s: CockpitState) => CockpitState): void {
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}

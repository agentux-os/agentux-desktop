import type { DaemonClient, StartRunInput, TerminalHandle } from "../client";
import type { CockpitState, Run } from "../types";
import type {
  ApiBusMessage,
  ApiCapabilities,
  ApiEvent,
  ApiRun,
  ApiRunHistory,
  ApiSnapshot,
  CommandError,
  LinkStatus,
  Probe,
} from "./api";
import { applyBusList, applyEvent, applyRunHistory, applySnapshot, mapRun } from "./mapping";

/** Tauri event channels emitted by the backend (`src-tauri/src/daemon/mod.rs`). */
export const EVENT_CHANNEL = "daemon://event";
export const STATUS_CHANNEL = "daemon://status";

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
  };
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
 * loaded once per run when the UI opens it (`watchRun`). Live session events
 * for that run keep being applied meanwhile and are applied again on top of
 * the history; sessions skip events they already folded (by seq).
 *
 * The agent-bus log of a run comes from `bus.list` (`daemon_bus_list`), loaded
 * once per run when the UI shows it (`watchRun`, `watchBus`), and then from
 * live `bus_message` events; entries are merged by id, so overlaps are fine.
 * Optional methods (`sessions.prompt`, `bus.post`) are probed after each load
 * and stay disabled on daemons that do not serve them.
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

  async openTerminal(_sessionId: string): Promise<TerminalHandle | null> {
    return null;
  }

  // ---- internals ------------------------------------------------------------

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
      const capabilities = { sessionsPrompt: caps.sessionsPrompt === true, busPost: caps.busPost === true };
      this.update((s) =>
        s.capabilities?.sessionsPrompt === capabilities.sessionsPrompt && s.capabilities?.busPost === capabilities.busPost
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

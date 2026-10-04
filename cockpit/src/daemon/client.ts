import type { CockpitState, Run } from "./types";
import { MockDaemonClient } from "./mock/MockDaemonClient";

/**
 * Everything the cockpit needs from `agentuxd`. The UI only ever talks to this
 * interface: `TauriDaemonClient` speaks to the real daemon through the Tauri
 * backend, `MockDaemonClient` plays scripted runs in memory.
 *
 * The model is a client-side store: the implementation keeps an immutable
 * `CockpitState` up to date from the daemon's event stream, and the UI reads it
 * through `getState` / `subscribe` (compatible with React's
 * `useSyncExternalStore`). A new state object is produced on every change.
 */
export interface DaemonClient {
  /** `mock` while showing scripted data; actions that need the daemon are disabled. */
  readonly mode: "mock" | "daemon";

  /** Start receiving updates. Safe to call more than once. */
  connect(): Promise<void>;
  /** Stop receiving updates and release resources. */
  disconnect(): void;

  getState(): CockpitState;
  /** Called after every state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  /**
   * The UI shows this run's sessions: load their history if needed. Cheap to
   * call repeatedly; a no-op for the mock.
   */
  watchRun(runId: string): void;

  /** Approve a pending request (for `budget`: extend the budget and go on). */
  approve(requestId: string, answer?: string): Promise<void>;
  deny(requestId: string): Promise<void>;

  /** Register the project at `projectPath` if needed and start a run on it. */
  startRun(input: StartRunInput): Promise<Run>;
  cancelRun(runId: string): Promise<void>;

  /** Send a prompt from the human into a running session. */
  sendPrompt(sessionId: string, text: string): Promise<void>;

  /**
   * Attach to the harness's own TUI for this session (embedded PTY managed by
   * the daemon). Returns null when terminal mode is unavailable.
   */
  openTerminal(sessionId: string): Promise<TerminalHandle | null>;
}

export interface StartRunInput {
  /** Any directory inside the project's git repository. */
  projectPath: string;
  prompt: string;
  /** Defaults to the first line of the prompt. */
  title?: string;
}

export interface TerminalHandle {
  write(data: string): void;
  onData(listener: (data: string) => void): () => void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/**
 * Picks the client implementation:
 * - outside Tauri (plain `npm run dev` in a browser): the mock;
 * - inside Tauri with a reachable daemon: the real client;
 * - inside Tauri without one: the mock, flagged with the reason so the UI can
 *   show a "daemon not running" banner. The window reloads by itself once the
 *   backend's event stream reaches the daemon.
 *
 * `?daemon=mock` forces the mock.
 */
export async function createDaemonClient(): Promise<DaemonClient> {
  const { isTauri, probeDaemon, tauriTransport, TauriDaemonClient, STATUS_CHANNEL } = await import(
    "./tauri/TauriDaemonClient"
  );
  const forced = new URLSearchParams(window.location.search).get("daemon") === "mock";
  if (!isTauri() || forced) return new MockDaemonClient();

  const transport = await tauriTransport();
  const probe = await probeDaemon(transport);
  if (probe.reachable) return new TauriDaemonClient(transport, probe.socket ?? "agentuxd");

  void transport.listen<{ state: string }>(STATUS_CHANNEL, (s) => {
    if (s.state === "connected") window.location.reload();
  });
  return new MockDaemonClient({ fallbackReason: probe.detail });
}

/** Probes the daemon again and reloads the window if it is reachable now. */
export async function retryDaemon(): Promise<boolean> {
  const { probeDaemon, tauriTransport } = await import("./tauri/TauriDaemonClient");
  const probe = await probeDaemon(await tauriTransport());
  if (probe.reachable) window.location.reload();
  return probe.reachable;
}

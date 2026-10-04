import type { BusPostInput, BusPostResult, CockpitState, Run } from "./types";
import type { TerminalTarget } from "../lib/terminal";
import { MockDaemonClient } from "./mock/MockDaemonClient";

export type { TerminalTarget } from "../lib/terminal";

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

  /**
   * The UI shows these runs' agent-bus log: load it (`bus.list`) once per run;
   * live entries follow on the event stream. A no-op for the mock.
   */
  watchBus(runIds: string[]): void;

  /**
   * Approve a pending request (for `budget`: extend the budget and go on).
   * A `question` needs `answer` (one of its options or free text).
   */
  approve(requestId: string, answer?: string): Promise<void>;
  /** Deny or reject; for a `question`, the agent is told the human declined. */
  deny(requestId: string): Promise<void>;

  /** Register the project at `projectPath` if needed and start a run on it. */
  startRun(input: StartRunInput): Promise<Run>;
  cancelRun(runId: string): Promise<void>;

  /**
   * Send a prompt from the human into a running session. Needs
   * `capabilities.sessionsPrompt` on the real daemon.
   */
  sendPrompt(sessionId: string, text: string): Promise<void>;

  /**
   * Post a message from the human on a run's bus: to a session, a role or the
   * whole run, or as a reply (`inReplyTo`). Needs `capabilities.busPost` on
   * the real daemon.
   */
  postBus(input: BusPostInput): Promise<BusPostResult>;

  /**
   * Terminal mode: shows `target` (a session's harness TUI, or a shell in a
   * run's worktree) on a PTY the daemon manages, streaming its output to
   * `sink`. A terminal that still runs for the same target is attached
   * (scrollback, then live output) rather than opened again. The terminal is
   * recorded in `state.terminals`. Needs `capabilities.terminals` on the real
   * daemon; rejects otherwise.
   */
  openTerminal(target: TerminalTarget, size: TerminalSize, sink: TerminalSink): Promise<TerminalHandle>;

  /**
   * Closes the terminals this cockpit opened for a run (optionally only one
   * kind): a harness TUI hands its session back to ACP when it closes.
   */
  closeTerminals(filter: { runId: string; command?: TerminalTarget["command"] }): Promise<void>;
}

export interface StartRunInput {
  /** Any directory inside the project's git repository. */
  projectPath: string;
  prompt: string;
  /** Defaults to the first line of the prompt. */
  title?: string;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Where a terminal's output goes; `exit` or `lost` is the last call. */
export interface TerminalSink {
  /** Raw terminal bytes, to feed to the emulator as is. */
  output(data: Uint8Array): void;
  /** The process exited; `code` is null when it was killed by a signal. */
  exit(code: number | null): void;
  /** The terminal went away without an exit (the daemon stopped). */
  lost(reason: string): void;
}

export interface TerminalHandle {
  readonly terminalId: string;
  /** Text typed or pasted into the emulator (xterm `onData`). */
  input(data: string): void;
  /** Binary input (xterm `onBinary`: one character per byte). */
  inputBinary(data: string): void;
  resize(cols: number, rows: number): void;
  /** Stops streaming to this sink; the terminal keeps running and can be attached again. */
  detach(): void;
  /** Closes the terminal (its exit still reaches the sink). */
  close(): Promise<void>;
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

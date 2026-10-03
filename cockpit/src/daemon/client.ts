import type { CockpitState } from "./types";
import { MockDaemonClient } from "./mock/MockDaemonClient";

/**
 * Everything the cockpit needs from `agentuxd`. The UI only ever talks to this
 * interface, so the mock below can be replaced by a client that speaks to the
 * real daemon (Tauri IPC or a local socket) without touching components.
 *
 * The model is a client-side store: the implementation keeps an immutable
 * `CockpitState` up to date from the daemon's event stream, and the UI reads it
 * through `getState` / `subscribe` (compatible with React's
 * `useSyncExternalStore`). A new state object is produced on every change.
 */
export interface DaemonClient {
  /** Start receiving updates. Safe to call more than once. */
  connect(): Promise<void>;
  /** Stop receiving updates and release resources. */
  disconnect(): void;

  getState(): CockpitState;
  /** Called after every state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  /** Approve a pending permission request (or pick an answer for a question). */
  approve(requestId: string, answer?: string): Promise<void>;
  deny(requestId: string): Promise<void>;

  /** Send a prompt from the human into a running session. */
  sendPrompt(sessionId: string, text: string): Promise<void>;

  /**
   * Attach to the harness's own TUI for this session (embedded PTY managed by
   * the daemon). Returns null when terminal mode is unavailable.
   */
  openTerminal(sessionId: string): Promise<TerminalHandle | null>;
}

export interface TerminalHandle {
  write(data: string): void;
  onData(listener: (data: string) => void): () => void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/**
 * Picks the client implementation. Only the mock exists until `agentuxd` ships;
 * a `?daemon=` query parameter or env switch will select the real one.
 */
export function createDaemonClient(): DaemonClient {
  return new MockDaemonClient();
}

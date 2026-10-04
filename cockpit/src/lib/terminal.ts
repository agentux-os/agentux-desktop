/**
 * Terminal-mode helpers shared by the clients and the terminal view: what a
 * terminal is for (its target), the byte encodings of the daemon's wire
 * (base64 of raw terminal bytes), the chord that leaves the terminal, and the
 * xterm.js theme taken from the cockpit's CSS variables.
 */

import type { Terminal, TerminalCommand } from "../daemon/types";

/** What the UI asks a terminal for: a session's harness TUI, or a shell in a run's worktree. */
export interface TerminalTarget {
  command: TerminalCommand;
  /** With `harness-tui`: the session to resume in its TUI. */
  sessionId?: string;
  /** With `shell`: the run whose worktree it runs in. */
  runId?: string;
}

/** A stable key per target (one live terminal per target). */
export function targetKey(t: TerminalTarget): string {
  return t.command === "harness-tui" ? `tui:${t.sessionId ?? ""}` : `shell:${t.runId ?? ""}`;
}

/**
 * Whether `terminal` serves `target`. A session's TUI may have fallen back to
 * a shell (`command: shell` with the session id), so it is matched by session;
 * a run's shell has no session.
 */
export function terminalMatches(terminal: Terminal, target: TerminalTarget): boolean {
  if (target.command === "harness-tui") return !!target.sessionId && terminal.sessionId === target.sessionId;
  return !!target.runId && terminal.runId === target.runId && !terminal.sessionId && terminal.command === "shell";
}

/** The newest terminal in `terminals` that serves `target` and has not exited. */
export function liveTerminalFor(terminals: Record<string, Terminal>, target: TerminalTarget): Terminal | undefined {
  return Object.values(terminals)
    .filter((t) => t.state !== "exited" && terminalMatches(t, target))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** The newest terminal in `terminals` that serves `target`, exited or not. */
export function terminalFor(terminals: Record<string, Terminal>, target: TerminalTarget): Terminal | undefined {
  return Object.values(terminals)
    .filter((t) => terminalMatches(t, target))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

// ---- bytes ------------------------------------------------------------------

/** Standard, padded base64 of `bytes` (what `terminals.write` takes). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Raw bytes of base64 `data` (what `terminal_output` carries); invalid input gives no bytes. */
export function base64ToBytes(data: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Text typed or pasted into the emulator (xterm's `onData`), as UTF-8. */
export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** xterm's `onBinary` data: one character per byte (0–255). */
export function binaryToBase64(data: string): string {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
  return bytesToBase64(bytes);
}

// ---- keyboard ---------------------------------------------------------------

/**
 * The chord that takes keyboard focus out of the terminal, back to the
 * cockpit's shortcuts: Shift+Esc or Ctrl+]. A plain Escape stays with the
 * program in the terminal (TUIs use it to interrupt or go back).
 */
export function isLeaveChord(e: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  if (e.key === "Escape" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) return true;
  return e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "]" || e.code === "BracketRight");
}

export const LEAVE_HINT = "Shift+Esc or Ctrl+] to leave";

// ---- theme ------------------------------------------------------------------

/** The subset of xterm.js `ITheme` the cockpit sets. */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * The terminal's colours from the cockpit's design tokens (`tokens.css`), so
 * it follows the dark and light themes. `read` returns a CSS variable's value
 * (empty when unset); the fallbacks are the dark theme's.
 */
export function terminalTheme(read: (name: string) => string): TerminalTheme {
  const v = (name: string, fallback: string) => read(name).trim() || fallback;
  const text = v("--text", "#e7eaef");
  const muted = v("--text-muted", "#949dab");
  const faint = v("--text-faint", "#636c79");
  const red = v("--err", "#f2615b");
  const green = v("--ok", "#46c46a");
  const yellow = v("--attention", "#f6b13c");
  const blue = v("--info", "#79a8ff");
  const magenta = v("--vendor-opencode", "#b59cff");
  const cyan = v("--vendor-codex", "#4fd1b0");
  const background = v("--term-bg", v("--bg-sunken", "#08090b"));
  return {
    background,
    foreground: text,
    cursor: v("--accent", "#c6f36b"),
    cursorAccent: background,
    selectionBackground: v("--term-selection", "rgba(121, 168, 255, 0.3)"),
    black: v("--term-black", faint),
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white: muted,
    brightBlack: faint,
    brightRed: v("--diff-del-fg", red),
    brightGreen: v("--diff-add-fg", green),
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: text,
  };
}

/** `terminalTheme` from the document's current CSS variables. */
export function documentTerminalTheme(): TerminalTheme {
  const style = getComputedStyle(document.documentElement);
  return terminalTheme((name) => style.getPropertyValue(name));
}

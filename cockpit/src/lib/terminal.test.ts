import { describe, expect, it } from "vitest";
import type { Terminal } from "../daemon/types";
import {
  base64ToBytes,
  binaryToBase64,
  bytesToBase64,
  isLeaveChord,
  liveTerminalFor,
  targetKey,
  terminalFor,
  terminalMatches,
  terminalTheme,
  textToBase64,
} from "./terminal";

function terminal(over: Partial<Terminal>): Terminal {
  return {
    terminalId: "t1",
    sessionId: "s1",
    runId: "r1",
    command: "harness-tui",
    argv: [],
    cwd: "/wt",
    cols: 80,
    rows: 24,
    state: "running",
    createdAt: 1,
    ...over,
  };
}

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe("terminal bytes", () => {
  it("encodes typed text as UTF-8 base64 and decodes output bytes", () => {
    expect(textToBase64("ls\r")).toBe("bHMN");
    expect(new TextDecoder().decode(base64ToBytes(textToBase64("çé → ✓")))).toBe("çé → ✓");
    expect(base64ToBytes("aGVsbG8NCg==")).toEqual(new TextEncoder().encode("hello\r\n"));
    expect(base64ToBytes("not base64!")).toEqual(new Uint8Array());
  });

  it("encodes binary input byte for byte", () => {
    expect(base64ToBytes(binaryToBase64("\x1b[M\xff\x80"))).toEqual(new Uint8Array([0x1b, 0x5b, 0x4d, 0xff, 0x80]));
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});

describe("terminal targets", () => {
  it("matches a session's TUI by session, also when it fell back to a shell", () => {
    const tui = { command: "harness-tui" as const, sessionId: "s1" };
    expect(terminalMatches(terminal({}), tui)).toBe(true);
    expect(terminalMatches(terminal({ command: "shell", fallback: "no TUI" }), tui)).toBe(true);
    expect(terminalMatches(terminal({ sessionId: "s2" }), tui)).toBe(false);
  });

  it("matches a run's shell only without a session", () => {
    const shell = { command: "shell" as const, runId: "r1" };
    expect(terminalMatches(terminal({ sessionId: undefined, command: "shell" }), shell)).toBe(true);
    expect(terminalMatches(terminal({ command: "shell", fallback: "no TUI" }), shell)).toBe(false);
    expect(terminalMatches(terminal({ sessionId: undefined, command: "shell", runId: "r2" }), shell)).toBe(false);
    expect(targetKey(shell)).not.toBe(targetKey({ command: "harness-tui", sessionId: "r1" }));
  });

  it("finds the newest live terminal of a target", () => {
    const terminals = {
      a: terminal({ terminalId: "a", createdAt: 1 }),
      b: terminal({ terminalId: "b", createdAt: 3, state: "exited", exitCode: 0 }),
      c: terminal({ terminalId: "c", createdAt: 2, state: "waiting" }),
    };
    const tui = { command: "harness-tui" as const, sessionId: "s1" };
    expect(liveTerminalFor(terminals, tui)?.terminalId).toBe("c");
    expect(terminalFor(terminals, tui)?.terminalId).toBe("b");
    expect(liveTerminalFor(terminals, { command: "harness-tui", sessionId: "s9" })).toBeUndefined();
  });
});

describe("leaving the terminal", () => {
  it("takes Shift+Esc and Ctrl+], not a plain Escape (the TUI needs it)", () => {
    expect(isLeaveChord(key({ key: "Escape", shiftKey: true }))).toBe(true);
    expect(isLeaveChord(key({ key: "]", ctrlKey: true }))).toBe(true);
    // Ctrl+] on layouts where `key` is something else.
    expect(isLeaveChord(key({ key: "Dead", code: "BracketRight", ctrlKey: true }))).toBe(true);
    expect(isLeaveChord(key({ key: "Escape" }))).toBe(false);
    expect(isLeaveChord(key({ key: "Escape", shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(isLeaveChord(key({ key: "t" }))).toBe(false);
  });
});

describe("terminal theme", () => {
  it("takes the cockpit's tokens and falls back to the dark theme", () => {
    const vars: Record<string, string> = { "--term-bg": " #fbfbfc", "--text": "#15181d", "--err": "#cc2f28", "--accent": "#4f7d0b" };
    const theme = terminalTheme((name) => vars[name] ?? "");
    expect(theme).toMatchObject({ background: "#fbfbfc", foreground: "#15181d", red: "#cc2f28", cursor: "#4f7d0b" });
    expect(theme.cursorAccent).toBe(theme.background);
    const dark = terminalTheme(() => "");
    expect(dark).toMatchObject({ background: "#08090b", foreground: "#e7eaef", green: "#46c46a" });
  });
});

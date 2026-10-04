import { describe, expect, it } from "vitest";
import type { ApiSession, ApiTerminal } from "./api";
import { applyEvent, applyTerminalExit, applyTerminals, mapSession, mapTerminal } from "./mapping";
import { emptyState } from "./TauriDaemonClient";

function apiTerminal(over: Partial<ApiTerminal> = {}): ApiTerminal {
  return {
    terminalId: "5d1c9a02",
    sessionId: "s1",
    runId: "r1",
    command: "harness-tui",
    fallback: null,
    argv: ["claude", "--resume", "0d9f"],
    cwd: "/src/a.worktrees/r1",
    cols: 120,
    rows: 32,
    state: "running",
    exitCode: null,
    createdAt: 1790000000000,
    ...over,
  };
}

function apiSession(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: "s1",
    runId: "r1",
    projectId: "p1",
    role: "implementer",
    harness: "claude-code",
    model: null,
    state: "active",
    cwd: "/wt",
    usage: { usedTokens: 1, contextTokens: 10, costUsd: null },
    startedAt: 1,
    updatedAt: 1,
    endedAt: null,
    ...over,
  };
}

describe("terminal mapping", () => {
  it("maps a daemon Terminal: nulls become undefined, enums are checked", () => {
    expect(mapTerminal(apiTerminal())).toEqual({
      terminalId: "5d1c9a02",
      sessionId: "s1",
      runId: "r1",
      command: "harness-tui",
      fallback: undefined,
      argv: ["claude", "--resume", "0d9f"],
      cwd: "/src/a.worktrees/r1",
      cols: 120,
      rows: 32,
      state: "running",
      exitCode: undefined,
      createdAt: 1790000000000,
      held: undefined,
    });
  });

  it("keeps a fallback shell's reason and the session it was asked for", () => {
    const t = mapTerminal(
      apiTerminal({ command: "shell", fallback: "antigravity has no TUI that can resume a session", argv: ["/bin/bash"] }),
    );
    expect(t.command).toBe("shell");
    expect(t.sessionId).toBe("s1");
    expect(t.fallback).toContain("no TUI");
  });

  it("accepts harness_tui, maps unknown values safely and a waiting terminal's empty argv", () => {
    expect(mapTerminal(apiTerminal({ command: "harness_tui" })).command).toBe("harness-tui");
    expect(mapTerminal(apiTerminal({ command: "weird" })).command).toBe("shell");
    expect(mapTerminal(apiTerminal({ state: "paused" })).state).toBe("running");
    const waiting = mapTerminal(apiTerminal({ state: "waiting", argv: [] }));
    expect(waiting).toMatchObject({ state: "waiting", argv: [] });
    expect(mapTerminal(apiTerminal({ state: "exited", exitCode: 0 }))).toMatchObject({ state: "exited", exitCode: 0 });
  });

  it("records terminals by id, keeping what this cockpit holds", () => {
    let s = emptyState("x");
    s = applyTerminals(s, [apiTerminal({ state: "waiting", argv: [] })], true);
    expect(s.terminals["5d1c9a02"]).toMatchObject({ state: "waiting", held: true });
    // A later lookup (no held flag) updates the state but keeps `held`.
    s = applyTerminals(s, [apiTerminal()]);
    expect(s.terminals["5d1c9a02"]).toMatchObject({ state: "running", held: true });
    // The backend's terminal_list says who holds what.
    s = applyTerminals(s, [apiTerminal({ terminalId: "other", held: false })]);
    expect(s.terminals.other.held).toBe(false);
    expect(applyTerminals(s, [])).toBe(s);
  });

  it("marks an exit with its code (null when killed)", () => {
    let s = applyTerminals(emptyState("x"), [apiTerminal()], true);
    s = applyTerminalExit(s, "5d1c9a02", 0);
    expect(s.terminals["5d1c9a02"]).toMatchObject({ state: "exited", exitCode: 0 });
    s = applyTerminalExit(applyTerminals(s, [apiTerminal({ terminalId: "t2" })]), "t2", null);
    expect(s.terminals.t2).toMatchObject({ state: "exited", exitCode: undefined });
    expect(applyTerminalExit(s, "unknown", 1)).toBe(s);
  });
});

describe("session attached state", () => {
  it("maps attached and the vendor session id", () => {
    const session = mapSession(apiSession({ state: "attached", vendorSessionId: "0d9f" }));
    expect(session.state).toBe("attached");
    expect(session.vendorSessionId).toBe("0d9f");
    expect(mapSession(apiSession({ vendorSessionId: null })).vendorSessionId).toBeUndefined();
    expect(mapSession(apiSession()).vendorSessionId).toBeUndefined();
  });

  it("follows a session through terminal mode: attached while the TUI holds it, idle after", () => {
    let s = applyEvent(emptyState("x"), { seq: 1, at: 1, runId: "r1", kind: "session", session: apiSession() });
    s = applyEvent(s, {
      seq: 2, at: 2, runId: "r1", kind: "session_event", sessionId: "s1",
      event: { kind: "message", from: "agent", text: "done" },
    });
    s = applyEvent(s, { seq: 3, at: 3, runId: "r1", kind: "session", session: apiSession({ state: "attached", vendorSessionId: "0d9f" }) });
    expect(s.sessions.s1.state).toBe("attached");
    // The snapshot keeps the entries folded so far.
    expect(s.sessions.s1.events).toHaveLength(1);
    s = applyEvent(s, { seq: 4, at: 4, runId: "r1", kind: "session", session: apiSession({ state: "idle", vendorSessionId: "0d9f" }) });
    expect(s.sessions.s1.state).toBe("idle");
  });
});

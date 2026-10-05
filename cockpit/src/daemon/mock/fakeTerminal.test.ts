import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminal } from "./fakeTerminal";
import { MockDaemonClient } from "./MockDaemonClient";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("FakeTerminal", () => {
  it("drops input until it starts, then echoes lines and exits on `exit`", () => {
    const t = new FakeTerminal({ banner: ["waiting"], program: "claude" });
    let out = "";
    t.onOutput((s) => (out += s));
    const codes: (number | null)[] = [];
    t.onExit((c) => codes.push(c));

    expect(plain(t.screen)).toContain("[agentux] waiting");
    t.input("ignored\r");
    expect(out).toBe("");

    t.start();
    t.input("hellx\x7fo\x1b[A\r");
    expect(plain(out)).toContain("hellx\b \bo\r\nclaude: hello\r\n");
    t.input("exit\r");
    expect(codes).toEqual([0]);
    expect(t.exited).toBe(true);
    // Scrollback for a view that attaches again.
    expect(plain(t.screen)).toContain("claude: hello");
  });
});

describe("MockDaemonClient terminals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The mock times its script beats with Math.random: pin it so a run
    // replays the same timeline every time.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens a TUI that waits for the turn, holds the session, reattaches with the scrollback, and gives the session back on close", async () => {
    const client = new MockDaemonClient({ speed: 1 });
    const session = Object.values(client.getState().sessions).find((s) => s.vendor === "claude-code" && s.state === "active");
    expect(session).toBeDefined();
    const sid = session!.id;

    let out = "";
    const exits: (number | null)[] = [];
    const sink = {
      output: (d: Uint8Array) => (out += new TextDecoder().decode(d)),
      exit: (c: number | null) => exits.push(c),
      lost: () => undefined,
    };
    const h = await client.openTerminal({ command: "harness-tui", sessionId: sid }, { cols: 80, rows: 24 }, sink);
    expect(client.getState().terminals[h.terminalId]).toMatchObject({ state: "waiting", argv: [] });
    expect(plain(out)).toContain("Waiting for the session's current turn");
    await client.connect();
    await vi.advanceTimersByTimeAsync(2500);
    client.disconnect();
    let s = client.getState();
    expect(s.terminals[h.terminalId]).toMatchObject({ command: "harness-tui", state: "running", sessionId: sid, held: true });
    expect(s.terminals[h.terminalId].argv[0]).toBe("claude");
    expect(s.sessions[sid].state).toBe("attached");
    // The run's script goes on (its beats are randomly timed), but while the
    // TUI holds the session none of its turns or requests take it back.
    await client.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    client.disconnect();
    expect(client.getState().sessions[sid].state).toBe("attached");

    h.input("hi\r");
    expect(plain(out)).toContain("claude: hi");

    // A new view of the same target attaches to the running terminal.
    h.detach();
    let replay = "";
    const h2 = await client.openTerminal({ command: "harness-tui", sessionId: sid }, { cols: 100, rows: 30 }, {
      ...sink,
      output: (d) => (replay += new TextDecoder().decode(d)),
    });
    expect(h2.terminalId).toBe(h.terminalId);
    expect(plain(replay)).toContain("claude: hi");

    await client.closeTerminals({ runId: session!.runId, command: "harness-tui" });
    s = client.getState();
    expect(s.terminals[h.terminalId].state).toBe("exited");
    expect(s.sessions[sid].state).toBe("idle");
    // Only the attached view hears the close (killed: no code); the first had detached.
    expect(exits).toEqual([null]);
  });

  it("falls back to a shell, with the reason, for a harness without a TUI", async () => {
    const client = new MockDaemonClient({ speed: 1 });
    const session = Object.values(client.getState().sessions).find((s) => s.vendor === "antigravity");
    if (!session) return; // no Antigravity session seeded
    const h = await client.openTerminal(
      { command: "harness-tui", sessionId: session.id },
      { cols: 80, rows: 24 },
      { output: () => undefined, exit: () => undefined, lost: () => undefined },
    );
    const t = client.getState().terminals[h.terminalId];
    expect(t.command).toBe("shell");
    expect(t.fallback).toMatch(/no TUI/);
    expect(client.getState().sessions[session.id].state).not.toBe("attached");
  });
});

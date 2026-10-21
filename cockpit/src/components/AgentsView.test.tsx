// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPrefs, HarnessInfo } from "../daemon/client";
import { MockSetupClient } from "../setup/mock";
import { AgentsView, orderedIds } from "./AgentsView";

const AGENTS: HarnessInfo[] = [
  {
    id: "claude-code",
    command: "claude",
    installed: true,
    signedIn: true,
    experimental: false,
    version: "2.1.30 (Claude Code)",
    usage: { todayUsd: 1.5, weekUsd: 9, weekSessions: 4 },
    limits: [
      {
        harness: "claude-code",
        model: null,
        kind: "credits",
        until: null,
        untilKnown: false,
        message: "Credit balance is too low",
        at: 0,
      },
    ],
  },
  {
    id: "codex",
    command: "codex",
    installed: true,
    signedIn: false,
    experimental: false,
    quota: [{ label: "weekly", usedPercent: 81, resetsAt: null, seenAt: 0 }],
  },
  { id: "opencode", command: "opencode", installed: true, signedIn: null, experimental: false },
  { id: "antigravity", command: "agy-acp-server", installed: false, signedIn: null, experimental: true },
];

const PREFS: AgentPrefs = { order: [], roles: {}, fallback: null, idleMinutes: null, toolMinutes: null, notifications: true };

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fakeClient() {
  return {
    harnesses: vi.fn(async () => AGENTS),
    clearLimit: vi.fn(async () => {}),
    testHarness: vi.fn(async (harness: string) => ({ harness, ok: true, detail: "OK", seconds: 2.5, limit: null })),
    getPrefs: vi.fn(async () => structuredClone(PREFS)),
    setPrefs: vi.fn(async (p: AgentPrefs) => p),
  };
}

describe("AgentsView", () => {
  afterEach(cleanup);

  it("orders agents by the user's preference", () => {
    expect(orderedIds({ ...PREFS, order: ["opencode"] }, ["claude-code", "codex", "opencode"])).toEqual([
      "opencode",
      "claude-code",
      "codex",
    ]);
  });

  it("shows each agent, tests one, lifts a limit and opens an update terminal", async () => {
    const client = fakeClient();
    const setup = new MockSetupClient();
    render(<AgentsView client={client} setup={async () => setup} />);
    await settle();

    const claude = screen.getByRole("article", { name: "Claude Code" });
    expect(claude.textContent).toContain("2.1.30");
    expect(claude.textContent).toContain("out of credits until you lift it");
    expect(screen.getByRole("article", { name: "Codex" }).textContent).toContain("81%");
    expect(screen.getByRole("article", { name: "Codex" }).textContent).toContain("Not signed in");
    expect(screen.getByRole("article", { name: "Antigravity" }).textContent).toContain("Not installed");

    fireEvent.click(within(claude).getByRole("button", { name: "Test" }));
    await settle();
    expect(client.testHarness).toHaveBeenCalledWith("claude-code");
    expect(within(claude).getByRole("status").textContent).toContain("Answered in 2.5 s: OK");

    fireEvent.click(within(claude).getByRole("button", { name: "Limit lifted" }));
    await settle();
    expect(client.clearLimit).toHaveBeenCalledWith("claude-code");

    fireEvent.click(within(screen.getByRole("article", { name: "OpenCode" })).getByRole("button", { name: "Update" }));
    await settle();
    expect(setup.calls).toContain("update-agent opencode");
  });

});

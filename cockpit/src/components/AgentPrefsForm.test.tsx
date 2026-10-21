// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPrefs } from "../daemon/client";
import { AgentPrefsForm } from "./AgentPrefsForm";

const PREFS: AgentPrefs = { order: [], roles: {}, fallback: null, idleMinutes: null, toolMinutes: null, notifications: true };

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fakeClient() {
  return {
    getPrefs: vi.fn(async () => structuredClone(PREFS)),
    setPrefs: vi.fn(async (p: AgentPrefs) => p),
  };
}

describe("AgentPrefsForm", () => {
  afterEach(cleanup);

  it("saves preferences", async () => {
    const client = fakeClient();
    render(<AgentPrefsForm client={client} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Move OpenCode up" }));
    fireEvent.change(screen.getByLabelText("Agent that plans"), { target: { value: "claude-code" } });
    fireEvent.change(screen.getByLabelText("Model that plans"), { target: { value: "opus" } });
    fireEvent.click(screen.getByLabelText("Only these (none: wait for the limit)"));
    fireEvent.change(screen.getByPlaceholderText("10"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await settle();
    expect(client.setPrefs).toHaveBeenCalledWith({
      order: ["claude-code", "opencode", "codex", "antigravity"],
      roles: { planner: { harness: "claude-code", model: "opus" } },
      fallback: [],
      idleMinutes: 15,
      toolMinutes: null,
      notifications: true,
    });
  });

  it("says when the daemon has no preferences", async () => {
    render(<AgentPrefsForm client={{ getPrefs: async () => null, setPrefs: async (p) => p }} />);
    await settle();
    expect(screen.getByText(/need agentuxd from agentux-core 0.4.8/)).toBeTruthy();
  });
});

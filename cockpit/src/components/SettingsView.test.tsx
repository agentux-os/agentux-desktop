// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPrefs } from "../daemon/client";
import { getCloneDir } from "../lib/localPrefs";
import { MockSetupClient } from "../setup/mock";
import { SettingsView } from "./SettingsView";

const PREFS: AgentPrefs = { order: [], roles: {}, fallback: null, idleMinutes: null, toolMinutes: null, notifications: true };

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

function view(setup: MockSetupClient) {
  const onTheme = vi.fn();
  render(
    <SettingsView
      client={{ getPrefs: async () => structuredClone(PREFS), setPrefs: async (p) => p }}
      state={{ connection: { status: "connected", daemon: "/run/user/1000/agentux/agentuxd.sock", detail: "", mock: false } }}
      setup={async () => setup}
      theme="dark"
      onTheme={onTheme}
      onWelcome={() => {}}
      version="0.5.9"
    />,
  );
  return { onTheme };
}

describe("SettingsView", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("adds and removes an API key without showing it", async () => {
    const setup = new MockSetupClient();
    view(setup);
    await settle();
    const row = screen.getByText("Anthropic").closest("li") as HTMLElement;
    expect(row.textContent).toContain("Not set");
    fireEvent.click(within(row).getByRole("button", { name: "Add" }));
    fireEvent.change(within(row).getByLabelText("Anthropic API key"), { target: { value: " sk-ant-123 " } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await settle();
    expect(setup.calls).toContain("key set ANTHROPIC_API_KEY");
    expect(row.textContent).toContain("Set");
    expect(row.textContent).not.toContain("sk-ant");

    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await settle();
    expect(setup.calls).toContain("key remove ANTHROPIC_API_KEY");
    expect(row.textContent).toContain("Not set");
  });

  it("keeps the clone folder and changes the theme", async () => {
    const { onTheme } = view(new MockSetupClient());
    await settle();
    const input = screen.getByPlaceholderText("~/src");
    fireEvent.change(input, { target: { value: "~/code/" } });
    fireEvent.blur(input);
    expect(getCloneDir()).toBe("~/code");
    fireEvent.change(input, { target: { value: "relative" } });
    fireEvent.blur(input);
    expect(getCloneDir()).toBe("~/src");

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
    expect(onTheme).toHaveBeenCalledWith("light");
    expect(screen.getByText("0.5.9")).toBeTruthy();
  });
});

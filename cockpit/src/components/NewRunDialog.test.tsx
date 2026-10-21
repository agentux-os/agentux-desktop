// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessInfo, HarnessLimit, StartRunInput } from "../daemon/client";
import { harnessOption, limitText, NewRunDialog } from "./NewRunDialog";

const HARNESSES: HarnessInfo[] = [
  { id: "claude-code", command: "claude", installed: true, signedIn: false, experimental: false },
  { id: "codex", command: "codex", installed: false, signedIn: null, experimental: false },
  { id: "opencode", command: "opencode", installed: true, signedIn: true, experimental: false },
  { id: "antigravity", command: "agy-acp-server", installed: true, signedIn: null, experimental: true },
];

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("NewRunDialog", () => {
  afterEach(cleanup);

  it("labels harnesses by what the user set up", () => {
    expect(harnessOption(HARNESSES[0])).toEqual({ label: "Claude Code (not signed in)", disabled: false });
    expect(harnessOption(HARNESSES[1])).toEqual({ label: "Codex (not installed)", disabled: true });
    expect(harnessOption(HARNESSES[2])).toEqual({ label: "OpenCode", disabled: false });
    expect(harnessOption(HARNESSES[3])).toEqual({ label: "Antigravity (experimental)", disabled: false });
  });

  it("sends only the roles the user picked", async () => {
    const onSubmit = vi.fn(async (_: StartRunInput) => {});
    render(
      <NewRunDialog
        projects={[]}
        initialPath="/src/a"
        onClose={() => {}}
        onSubmit={onSubmit}
        loadHarnesses={async () => HARNESSES}
      />,
    );
    await settle();
    fireEvent.change(screen.getByPlaceholderText("What should the agents do?"), { target: { value: "Fix it" } });
    fireEvent.change(screen.getByLabelText("Agent that implements"), { target: { value: "opencode" } });
    fireEvent.change(screen.getByLabelText("Agent that reviews"), { target: { value: "antigravity" } });
    fireEvent.click(screen.getByRole("button", { name: /Start run/ }));
    await settle();
    expect(onSubmit).toHaveBeenCalledWith({
      projectPath: "/src/a",
      prompt: "Fix it",
      title: undefined,
      roles: { implementer: "opencode", reviewer: "antigravity" },
    });
  });

  it("hides the agents on a daemon that cannot take them", async () => {
    render(<NewRunDialog projects={[]} initialPath="" onClose={() => {}} onSubmit={async () => {}} loadHarnesses={async () => null} />);
    await settle();
    expect(screen.queryByLabelText("Agent that plans")).toBeNull();
  });

  it("clones a repository and uses its directory", async () => {
    const onClone = vi.fn(async (source: string) => `/home/you/src/${source.split("/").pop()}`);
    render(<NewRunDialog projects={[]} initialPath="" onClose={() => {}} onSubmit={async () => {}} onClone={onClone} />);
    fireEvent.click(screen.getByRole("tab", { name: "Clone a repository" }));
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/), { target: { value: "agentux-os/agentux" } });
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    await settle();
    expect(onClone).toHaveBeenCalledWith("agentux-os/agentux");
    expect((screen.getByPlaceholderText("/home/you/src/project") as HTMLInputElement).value).toBe("/home/you/src/agentux");
    expect(screen.getByText("Cloned into /home/you/src/agentux.")).toBeTruthy();
  });

  it("shows why a clone failed", async () => {
    const onClone = async () => {
      throw new Error("clone: remote: Repository not found.");
    };
    render(<NewRunDialog projects={[]} initialPath="" onClose={() => {}} onSubmit={async () => {}} onClone={onClone} />);
    fireEvent.click(screen.getByRole("tab", { name: "Clone a repository" }));
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/), { target: { value: "nope/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("Repository not found");
  });
});

describe("NewRunDialog usage limits", () => {
  afterEach(cleanup);

  const at = new Date(2026, 9, 20, 10, 0).getTime();
  const limit = (over: Partial<HarnessLimit>): HarnessLimit => ({
    harness: "claude-code",
    model: null,
    kind: "weekly",
    until: new Date(2026, 9, 20, 15, 30).getTime(),
    untilKnown: true,
    message: "Weekly limit reached",
    at,
    ...over,
  });

  it("says until when an agent is out of use", () => {
    expect(limitText(limit({}), at)).toMatch(/^weekly limit until 15:30$/);
    expect(limitText(limit({ untilKnown: false, kind: "session" }), at)).toMatch(/^usage limit, trying again at 15:30$/);
    expect(limitText(limit({ kind: "credits", until: null }), at)).toBe("out of credits until you lift it");
    expect(limitText(limit({ model: "opus" }), at)).toMatch(/^weekly limit \(opus\) until/);
    const h: HarnessInfo = { ...HARNESSES[0], signedIn: true, limits: [limit({ kind: "credits", until: null })] };
    expect(harnessOption(h)).toEqual({ label: "Claude Code (out of credits until you lift it)", disabled: false });
  });

  it("lifts a limit when the human says so", async () => {
    let limits = [limit({ kind: "credits", until: null })];
    const onClearLimit = vi.fn(async () => {
      limits = [];
    });
    render(
      <NewRunDialog
        projects={[]}
        initialPath="/src/a"
        onClose={() => {}}
        onSubmit={async () => {}}
        loadHarnesses={async () => [{ ...HARNESSES[0], limits }]}
        onClearLimit={onClearLimit}
      />,
    );
    await settle();
    expect(screen.getByLabelText("Agents at a usage limit").textContent).toContain("out of credits");
    fireEvent.click(screen.getByRole("button", { name: "Limit lifted" }));
    await settle();
    await settle();
    expect(onClearLimit).toHaveBeenCalledWith("claude-code");
    expect(screen.queryByLabelText("Agents at a usage limit")).toBeNull();
  });
});

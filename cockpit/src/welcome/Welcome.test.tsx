// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockSetupClient } from "../setup/mock";
import { TauriSetupClient } from "../setup/tauri";
import { Welcome } from "./Welcome";

/** Lets pending promises and React updates settle. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Welcome wizard (mock backend)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the agent CLIs installing, then installed, and opens a sign-in terminal", async () => {
    const client = new MockSetupClient({ firstLoginDone: 1 });
    render(<Welcome client={client} pollMs={500} />);
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Your coding agents" })).toBeTruthy();
    const claude = screen.getByRole("article", { name: "Claude Code" });
    expect(within(claude).getByText("Installed")).toBeTruthy();
    const opencode = screen.getByRole("article", { name: "OpenCode" });
    expect(within(opencode).getByText("Installing…")).toBeTruthy();
    expect((within(opencode).getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(true);

    await flush(3000);
    expect(within(screen.getByRole("article", { name: "OpenCode" })).getByText("Installed")).toBeTruthy();

    fireEvent.click(within(claude).getByRole("button", { name: "Sign in" }));
    await flush();
    expect(client.calls).toContain("signin claude");
    expect(screen.getByText(/Inference stays with the providers/)).toBeTruthy();
  });

  it("shows the selected AgentUX OS profile and applied capabilities", async () => {
    const client = new MockSetupClient();
    render(<Welcome client={client} pollMs={500} />);
    await flush();
    expect(screen.getByRole("region", { name: "AgentUX OS profile" })).toBeTruthy();
    expect(screen.getByText("AgentUX Workstation")).toBeTruthy();
    expect(screen.getByText("node · desktop")).toBeTruthy();
  });

  it("offers a retry when first-login failed", async () => {
    const client = new MockSetupClient({ firstLoginDone: 2, fail: ["first-login"] });
    render(<Welcome client={client} pollMs={500} />);
    await flush(3000);
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    await flush();
    expect(client.calls).toContain("retry-first-login");
  });

  it("installs the ticked tools in the background, with the picked Java version, and retries a failure", async () => {
    const client = new MockSetupClient({ fail: ["dbeaver"] });
    render(<Welcome client={client} pollMs={500} />);
    await flush();
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Developer tools" })).toBeTruthy();

    // Node.js and Python are preselected.
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Visual Studio Code"));
    fireEvent.click(screen.getByLabelText("Java (Temurin JDK)"));
    fireEvent.change(screen.getByLabelText("Java (Temurin JDK) version"), { target: { value: "temurin-17" } });
    fireEvent.click(screen.getByLabelText("DBeaver Community"));
    fireEvent.click(screen.getByLabelText("IntelliJ IDEA"));
    fireEvent.click(screen.getByRole("button", { name: "Install 6" }));
    await flush();
    expect(client.calls).toEqual(["start vscode intellij-idea java@temurin-17 node python dbeaver"]);

    // Everything finishes, one by one; DBeaver fails and can be retried.
    await flush(6 * 3300);
    const dbeaver = screen.getByLabelText("DBeaver Community").closest("li")!;
    expect(within(dbeaver).getByText("Failed")).toBeTruthy();
    expect(within(screen.getByLabelText("Visual Studio Code").closest("li")!).getByText("Installed")).toBeTruthy();
    fireEvent.click(within(dbeaver).getByRole("button", { name: "Retry" }));
    await flush();
    expect(client.calls[1]).toBe("start dbeaver");
    await flush(3300);
    expect(within(screen.getByLabelText("DBeaver Community").closest("li")!).getByText("Installed")).toBeTruthy();
  });

  it("searches the catalog with / and shows an item's commands", async () => {
    const client = new MockSetupClient();
    render(<Welcome client={client} pollMs={500} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Tools & SDKs/ }));
    await flush();
    fireEvent.keyDown(window, { key: "/" });
    const search = screen.getByLabelText("Search tools");
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "postgres" } });
    expect(screen.getByLabelText("DBeaver Community")).toBeTruthy();
    expect(screen.queryByLabelText("Visual Studio Code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Flatpak: show the commands for DBeaver Community" }));
    expect(screen.getByText(/flatpak install --user --noninteractive --or-update flathub io.dbeaver.DBeaverCommunity/)).toBeTruthy();
  });

  it("saves the Git identity and creates an SSH key", async () => {
    const client = new MockSetupClient();
    render(<Welcome client={client} pollMs={500} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Git & SSH/ }));
    await flush();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ada@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(client.calls).toContain("git Ada Lovelace ada@example.org main");
    fireEvent.click(screen.getByRole("button", { name: "Generate key" }));
    await flush();
    expect((screen.getByLabelText("Public SSH key") as HTMLTextAreaElement).value).toMatch(/^ssh-ed25519 \S+ ada@example.org$/);
    fireEvent.click(screen.getByRole("button", { name: "Add to GitHub" }));
    await flush();
    expect(client.calls).toContain("open-url https://github.com/settings/ssh/new");
  });

  it("finishes: marks the wizard done and opens the cockpit; skipping marks it done too", async () => {
    const client = new MockSetupClient();
    render(<Welcome client={client} pollMs={500} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Open the cockpit" }));
    await flush();
    expect(client.calls.slice(-2)).toEqual(["finish", "close open-cockpit"]);

    cleanup();
    const skipper = new MockSetupClient();
    render(<Welcome client={skipper} pollMs={500} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    await flush();
    expect(skipper.calls.slice(-2)).toEqual(["finish", "close"]);
  });
});

describe("TauriSetupClient", () => {
  it("runs agentux-setup through setup_exec and parses its JSON", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const replies: Record<string, { code: number; stdout: string; stderr: string }> = {
      status: { code: 0, stdout: '{"arch":"x86_64","flathub":true,"items":{},"agents":[],"firstLogin":{"active":"inactive","result":"success","done":true,"steps":[]}}', stderr: "" },
      start: { code: 0, stdout: "agentux-setup-1.service\n", stderr: "" },
      git: { code: 2, stdout: "", stderr: "agentux-setup: git: a name and an e-mail address are needed\n" },
      "ssh-key": { code: 3, stdout: "", stderr: "" },
    };
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push([command, args]);
      if (command === "welcome_close") return undefined as T;
      return replies[(args!.args as string[])[0]] as T;
    };
    const client = new TauriSetupClient(invoke);
    expect((await client.status(true)).flathub).toBe(true);
    await client.start(["vscode", "java@temurin-17"]);
    await expect(client.setGit({ name: "", email: "x", defaultBranch: "main" })).rejects.toThrow(/a name and an e-mail/);
    expect(await client.sshKey()).toBeNull();
    await client.close(true);
    expect(calls).toEqual([
      ["setup_exec", { args: ["status", "--scan"], stdin: null }],
      ["setup_exec", { args: ["start", "vscode", "java@temurin-17"], stdin: null }],
      ["setup_exec", { args: ["git", "", "x", "main"], stdin: null }],
      ["setup_exec", { args: ["ssh-key", "--show"], stdin: null }],
      ["welcome_close", { openCockpit: true }],
    ]);
  });
});

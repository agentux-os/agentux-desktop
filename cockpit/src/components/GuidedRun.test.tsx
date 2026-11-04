// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessInfo, ProjectPlan } from "../daemon/client";
import type { Project } from "../daemon/types";
import { GuidedRun, draftFromAnswers, parseDraft } from "./GuidedRun";
import { NewRunDialog } from "./NewRunDialog";

const PROJECTS: Project[] = [
  { id: "p1", name: "shop", path: "/home/ana/src/shop" } as Project,
  { id: "p2", name: "blog", path: "/home/ana/src/blog" } as Project,
];

const PLAN: ProjectPlan = {
  projectId: "p1",
  source: "agentux.yaml",
  steps: [
    { kind: "plan", role: "planner", approve: true },
    { kind: "implement", role: "implementer", approve: false },
    { kind: "gate", approve: false, checks: ["test"], loopTo: 1, loopLimit: 3 },
    { kind: "review", role: "reviewer", approve: false, loopTo: 1, loopLimit: 2 },
    { kind: "pull_request", approve: false, draft: true },
  ],
  roles: { planner: { harness: "claude-code", model: "opus" }, implementer: { harness: "codex" }, reviewer: { harness: "claude-code" } },
  checks: [{ name: "test", run: "npm test" }],
  budgetUsd: 5,
  permissions: { implementer: { allow: ["read", "edit"], ask: ["execute"] }, reviewer: { deny: ["edit"] } },
};

function agent(id: string, extra: Partial<HarnessInfo> = {}): HarnessInfo {
  return { id, command: id, installed: true, signedIn: true, experimental: false, ...extra } as HarnessInfo;
}

const READY = [agent("claude-code"), agent("codex")];

function fill(goal: string, done = "", avoid = "") {
  fireEvent.change(screen.getByLabelText("Your goal, in your own words"), { target: { value: goal } });
  if (done) fireEvent.change(screen.getByLabelText(/How will you know it is done/), { target: { value: done } });
  if (avoid) fireEvent.change(screen.getByLabelText(/must not be touched/), { target: { value: avoid } });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // jsdom without storage
  }
});
afterEach(cleanup);

describe("guided run", () => {
  it("turns a goal into a reviewable proposal with the helper agent, and starts only on confirmation", async () => {
    const ask = vi.fn(async () => "Phone number at sign-up\n\nAdd an optional phone number field to the sign-up form and show it on the profile. Do not change the login page.");
    const onSubmit = vi.fn(async () => {});
    const describe = vi.fn(async () => PLAN);
    render(
      <GuidedRun
        projects={PROJECTS}
        describeProject={describe}
        loadHarnesses={async () => READY}
        guide={{ harness: "claude-code", ask }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "What do you want done?" })).toBeTruthy();
    // The goal goes to the helper's agent, and the cockpit says so.
    expect(screen.getByText(/your answers go to Claude Code, the agent you use for help/)).toBeTruthy();
    fill("Sign-up should ask for a phone number", "I see it on my profile", "The login page");
    fireEvent.click(screen.getByRole("button", { name: "Review the run" }));

    await screen.findByRole("heading", { name: "Review the run" });
    expect(describe).toHaveBeenCalledWith("p1");
    expect(ask).toHaveBeenCalledTimes(1);
    const question = (ask.mock.calls[0] as unknown as [string])[0];
    expect(question).toContain("Sign-up should ask for a phone number");
    expect(question).toContain("The login page");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Phone number at sign-up");
    expect(screen.getByText(/written by Claude Code/)).toBeTruthy();

    const proposal = screen.getByLabelText("What the run will do");
    expect(proposal.textContent).toContain("The project's agentux.yaml");
    expect(proposal.textContent).toContain("Planner: Claude Code (opus)");
    expect(proposal.textContent).toContain("Implementer: Codex");
    expect(proposal.textContent).toContain("runs npm test");
    expect(proposal.textContent).toContain("back to implement at most 3 times");
    expect(proposal.textContent).toContain("waits for your approval");
    expect(proposal.textContent).toContain("Agents ask you before running commands");
    expect(proposal.textContent).toContain("may never use editing files");
    expect(proposal.textContent).toContain("$5.00");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      projectPath: "/home/ana/src/shop",
      title: "Phone number at sign-up",
      prompt: expect.stringContaining("Add an optional phone number field"),
    });
  });

  it("falls back to the answers without a helper agent, and lets them be edited", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <GuidedRun projects={PROJECTS} describeProject={async () => ({ ...PLAN, source: "default" })} loadHarnesses={async () => READY} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/no agent sees them before you start the run/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p2" } });
    fill("Fix the typo on the about page", "", "The posts");
    fireEvent.click(screen.getByRole("button", { name: "Review the run" }));
    await screen.findByRole("heading", { name: "Review the run" });
    expect(screen.getByText(/from your answers/)).toBeTruthy();
    expect(screen.getByLabelText("What the run will do").textContent).toContain("AgentUX's default workflow");
    const instructions = screen.getByLabelText(/Instructions for the agents/) as HTMLTextAreaElement;
    expect(instructions.value).toBe("Fix the typo on the about page\n\nDo not change: The posts");
    fireEvent.change(instructions, { target: { value: "Fix the typo 'teh' on the about page" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ projectPath: "/home/ana/src/blog", title: "Fix the typo on the about page", prompt: "Fix the typo 'teh' on the about page" }),
    );
  });

  it("uses the answers when the helper agent fails, and says why", async () => {
    render(
      <GuidedRun
        projects={PROJECTS}
        describeProject={async () => PLAN}
        loadHarnesses={async () => READY}
        guide={{ harness: "codex", ask: async () => Promise.reject(new Error("not signed in")) }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fill("Add dark mode");
    fireEvent.click(screen.getByRole("button", { name: "Review the run" }));
    await screen.findByRole("heading", { name: "Review the run" });
    expect(screen.getByText(/Codex could not write the instructions \(not signed in\)/)).toBeTruthy();
    expect((screen.getByLabelText(/Instructions for the agents/) as HTMLTextAreaElement).value).toBe("Add dark mode");
  });

  it("does not start when an agent the run needs is not ready, and explains it", async () => {
    const onSubmit = vi.fn();
    render(
      <GuidedRun
        projects={PROJECTS}
        describeProject={async () => PLAN}
        loadHarnesses={async () => [agent("claude-code"), agent("codex", { signedIn: false })]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fill("Add dark mode");
    fireEvent.click(screen.getByRole("button", { name: "Review the run" }));
    await screen.findByRole("heading", { name: "Review the run" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("cannot start on this computer yet");
    expect(alert.textContent).toContain("Implementer: Codex is not signed in");
    const start = screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("can be cancelled at any point without starting anything", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<GuidedRun projects={PROJECTS} describeProject={async () => PLAN} loadHarnesses={async () => READY} onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fill("Add dark mode");
    fireEvent.click(screen.getByRole("button", { name: "Review the run" }));
    await screen.findByRole("heading", { name: "Review the run" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Your goal, in your own words") as HTMLTextAreaElement).value).toBe("Add dark mode");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says when the daemon cannot describe the workflow, and when there is no project", async () => {
    render(<GuidedRun projects={PROJECTS} describeProject={async () => null} loadHarnesses={async () => READY} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fill("Add dark mode");
    fireEvent.click(screen.getByRole("button", { name: "Review the run" }));
    await screen.findByRole("heading", { name: "Review the run" });
    expect(screen.getByLabelText("What the run will do").textContent).toContain("cannot describe the workflow before a run");
    cleanup();
    render(<GuidedRun projects={[]} describeProject={async () => PLAN} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/There is no project on this computer yet/)).toBeTruthy();
  });

  it("reads the helper's draft and writes one from the answers", () => {
    expect(parseDraft("```\nTitle: Dark mode\n\nAdd a dark theme.\n```")).toEqual({ title: "Dark mode", prompt: "Add a dark theme." });
    expect(parseDraft("only one line")).toBeNull();
    expect(draftFromAnswers({ projectId: "p1", goal: "Add dark mode", done: "It follows the system", avoid: "" })).toEqual({
      title: "Add dark mode",
      prompt: "Add dark mode\n\nDone when: It follows the system",
    });
  });
});

describe("New run dialog", () => {
  it("offers the guided path first and remembers Advanced", async () => {
    const props = {
      projects: PROJECTS,
      initialPath: "/home/ana/src/blog",
      onClose: vi.fn(),
      onSubmit: vi.fn(async () => {}),
      loadHarnesses: async () => READY,
      describeProject: async () => PLAN,
    };
    render(<NewRunDialog {...props} />);
    const modes = screen.getByRole("tablist", { name: "How to start" });
    expect(within(modes).getByRole("tab", { name: "Guided" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("p2");
    fireEvent.click(within(modes).getByRole("tab", { name: "Advanced" }));
    expect(screen.getByText("Project directory")).toBeTruthy();
    cleanup();
    render(<NewRunDialog {...props} />);
    expect(within(screen.getByRole("tablist", { name: "How to start" })).getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    // Without projects.describe there is only the form.
    render(<NewRunDialog {...props} describeProject={undefined} />);
    expect(screen.queryByRole("tablist", { name: "How to start" })).toBeNull();
  });
});

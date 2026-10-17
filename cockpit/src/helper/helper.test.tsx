// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { help } from "./content";
import { HelperProvider, type HelperHost } from "./HelperProvider";
import { Mascot } from "./Mascot";
import { getSettings, requestTour, resetSettingsCache, SETTINGS_KEY, updateSettings } from "./settings";
import type { TourStep } from "./Tour";

const STEPS: TourStep[] = [
  { id: "hello", title: "Hello there", body: "Intro." },
  { id: "a", title: "Step A", body: "The new run button.", targets: ["topbar.newRun"] },
  { id: "b", title: "Step B", body: "Not on screen.", targets: ["panel.mode"] },
  { id: "c", title: "Step C", body: "The theme.", targets: ["sidebar.theme"] },
];

function Page({ onNewRun = () => undefined, host }: { onNewRun?: () => void; host?: Partial<HelperHost> }) {
  return (
    <HelperProvider host={{ surface: "cockpit", tour: STEPS, ...host }}>
      <button {...help("topbar.newRun")} onClick={onNewRun}>
        New run
      </button>
      <div {...help("board")}>
        <span>A board</span>
      </div>
      <button {...help("sidebar.theme")}>Theme</button>
      <Mascot />
    </HelperProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
});
afterEach(() => cleanup());

describe("What's this?", () => {
  it("toggles with Shift+F1, explains what is clicked, and swallows the click", async () => {
    updateSettings({ tour: "done" });
    const onNewRun = vi.fn();
    render(<Page onNewRun={onNewRun} />);

    fireEvent.keyDown(window, { key: "F1", shiftKey: true });
    expect(await screen.findByText(/Click anything to learn about it/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(onNewRun).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "New run" });
    expect(within(dialog).getByText(/Starts a run/)).toBeTruthy();
    expect(within(dialog).getByText(/Learn more/)).toBeTruthy();

    // A non-interactive element is explained too.
    fireEvent.click(screen.getByText("A board"));
    expect(await screen.findByRole("dialog", { name: "Run board" })).toBeTruthy();

    // Escape closes the explanation, then leaves the mode.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Run board" })).toBeNull());
    expect(screen.getByText(/Click anything to learn about it/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Click anything to learn about it/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(onNewRun).toHaveBeenCalledTimes(1);
  });

  it("explains the focused element on Enter, and toggles from the penguin's button", async () => {
    updateSettings({ tour: "done" });
    const onNewRun = vi.fn();
    render(<Page onNewRun={onNewRun} />);
    fireEvent.click(screen.getByRole("button", { name: "What's this?" }));
    expect(screen.getByRole("button", { name: "What's this?" }).getAttribute("aria-pressed")).toBe("true");
    const theme = screen.getByRole("button", { name: "Theme" });
    theme.focus();
    fireEvent.keyDown(theme, { key: "Enter" });
    expect(await screen.findByRole("dialog", { name: "Theme" })).toBeTruthy();
    // The board is reachable with Tab while the mode is on.
    expect(screen.getByText("A board").parentElement?.getAttribute("tabindex")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "What's this?" }));
    await waitFor(() => expect(screen.queryByText(/Click anything to learn about it/)).toBeNull());
    expect(screen.getByText("A board").parentElement?.hasAttribute("tabindex")).toBe(false);
  });
});

describe("tour", () => {
  it("is offered on first use, skips steps whose element is missing, and remembers a skip", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Show me around" }));

    const card = () => screen.getByRole("dialog");
    await waitFor(() => expect(within(card()).getByRole("heading").textContent).toBe("Hello there"));
    expect(within(card()).getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
    // Focus moves into the card.
    expect(document.activeElement?.textContent).toMatch(/Next/);

    fireEvent.click(within(card()).getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(within(card()).getByRole("heading").textContent).toBe("Step A"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // Step B points at something not on screen: skipped.
    await waitFor(() => expect(within(card()).getByRole("heading").textContent).toBe("Step C"));
    expect(within(card()).getByText("4/4")).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(within(card()).getByRole("heading").textContent).toBe("Step A"));

    fireEvent.click(within(card()).getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(getSettings().tour).toBe("skipped");
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).tour).toBe("skipped");

    // No offer any more; the tour is in the penguin's menu.
    cleanup();
    resetSettingsCache();
    render(<Page />);
    expect(screen.queryByRole("button", { name: "Show me around" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AgentUX helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Take the tour/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("is marked done when finished, and Not now stops the offer", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(getSettings().tour).toBe("skipped");
    expect(screen.queryByRole("button", { name: "Show me around" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "AgentUX helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Take the tour/ }));
    for (const title of ["Hello there", "Step A", "Step C"]) {
      await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("heading").textContent).toBe(title));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Next|Done/ }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(getSettings().tour).toBe("done");
  });

  it("starts by itself when the Welcome wizard asks for it, and not while the wizard is open", async () => {
    localStorage.setItem("agentux.welcome.open", String(Date.now()));
    render(<Page />);
    expect(screen.queryByRole("button", { name: "Show me around" })).toBeNull();
    act(() => requestTour());
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "agentux.helper.tourRequest" })));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("heading").textContent).toBe("Hello there"),
    );
    expect(localStorage.getItem("agentux.helper.tourRequest")).toBeNull();
  });

  it("can be turned off, which hides the penguin and its shortcuts", async () => {
    updateSettings({ tour: "done" });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "AgentUX helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Turn the helper off/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "AgentUX helper" })).toBeNull());
    expect(getSettings().enabled).toBe(false);
    fireEvent.keyDown(window, { key: "F1", shiftKey: true });
    expect(screen.queryByText(/Click anything to learn about it/)).toBeNull();
  });
});

describe("Ask the penguin", () => {
  it("answers offline, points at the UI, and asks the user's agent only when turned on", async () => {
    updateSettings({ tour: "done" });
    const ask = vi.fn(async () => ({ harness: "codex", answer: "Click New run." }));
    render(<Page host={{ describeView: () => "Run board", ai: { ask } }} />);
    fireEvent.keyDown(window, { key: "F1" });
    const panel = await screen.findByRole("dialog", { name: "Ask the penguin" });
    const input = within(panel).getByLabelText("Your question");
    fireEvent.change(input, { target: { value: "How do I start a new run?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await within(panel).findByText("Here is what the docs say:", {}, { timeout: 5000 })).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();

    // Show me points at the New run button.
    fireEvent.click(within(panel).getAllByRole("button", { name: /Show me/ })[0]);
    expect(await screen.findByRole("dialog", { name: "New run" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    fireEvent.click(within(panel).getByRole("switch"));
    expect(getSettings().ai).toBe(true);
    fireEvent.change(within(panel).getByLabelText("Agent that answers"), { target: { value: "codex" } });
    fireEvent.change(input, { target: { value: "What is a gate?" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByText("Click New run.", {}, { timeout: 5000 })).toBeTruthy();
    expect(within(panel).getByText(/Codex · your agent account/)).toBeTruthy();
    const call = ask.mock.calls[0] as unknown as [{ harness: string; question: string; context: string }];
    expect(call[0].harness).toBe("codex");
    expect(call[0].question).toBe("What is a gate?");
    expect(call[0].context).toMatch(/^## What the user is looking at\n\nRun board/);

    // Out of scope: no call to the agent either.
    fireEvent.change(input, { target: { value: "How do I change the KDE wallpaper?" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByText(/I only know AgentUX/)).toBeTruthy();
    expect(ask).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask the penguin" })).toBeNull());
  });
});

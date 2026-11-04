// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionState } from "../daemon/types";
import { Composer } from "./SessionPanel";

function session(state: SessionState): Session {
  return {
    id: "s1",
    runId: "r1",
    projectId: "p1",
    role: "implementer",
    harness: "codex",
    vendor: "codex",
    state,
    cwd: "/w",
    events: [],
    usage: { usedTokens: 0, contextTokens: 0 },
    startedAt: 0,
  } as Session;
}

function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

afterEach(cleanup);

describe("Composer", () => {
  it("interrupts a turn in progress with Ctrl+Enter or the button", () => {
    const onSend = vi.fn();
    render(<Composer session={session("active")} onSend={onSend} />);
    type("Skip the cache");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenLastCalledWith("s1", "Skip the cache", true);

    type("Use sqlite");
    fireEvent.click(screen.getByRole("button", { name: "Interrupt and redirect" }));
    expect(onSend).toHaveBeenLastCalledWith("s1", "Use sqlite", true);

    // Enter queues it for after the turn.
    type("Then add tests");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenLastCalledWith("s1", "Then add tests", false);
  });

  it("interrupts a turn waiting on an approval", () => {
    const onSend = vi.fn();
    render(<Composer session={session("waiting")} onSend={onSend} />);
    type("Do not migrate");
    fireEvent.click(screen.getByRole("button", { name: "Interrupt and redirect" }));
    expect(onSend).toHaveBeenLastCalledWith("s1", "Do not migrate", true);
  });

  it("has nothing to interrupt between turns", () => {
    const onSend = vi.fn();
    render(<Composer session={session("idle")} onSend={onSend} />);
    expect(screen.queryByRole("button", { name: "Interrupt and redirect" })).toBeNull();
    type("Thanks");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenLastCalledWith("s1", "Thanks", false);
  });

  it("offers nothing on an ended session", () => {
    render(<Composer session={session("ended")} onSend={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Interrupt and redirect" })).toBeNull();
  });
});

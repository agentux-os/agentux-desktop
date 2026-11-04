// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "../daemon/tauri/TauriDaemonClient";
import type { CockpitState, PermissionRequest, Run, Session, SessionEvent } from "../daemon/types";
import { activityOf, sessionStatus } from "../lib/activity";
import { SessionEvents } from "./SessionEvents";
import { ActivityBar } from "./SessionPanel";

const NOW = 1_800_000_000_000;

const EVENTS: SessionEvent[] = [
  { id: "e1", at: NOW, kind: "message", from: "user", text: "## Your step: implement" },
  { id: "e2", at: NOW, kind: "tool_call", toolCallId: "t1", tool: "execute", title: "npm test", status: "ok" },
  { id: "e3", at: NOW, kind: "tool_call", toolCallId: "t2", tool: "execute", title: "npm run lint", status: "error" },
  { id: "e4", at: NOW, kind: "diff", path: "src/health.ts", newText: "export const ok = true;\n" },
  { id: "e5", at: NOW, kind: "permission", requestId: "q1" },
  { id: "e6", at: NOW, kind: "message", from: "agent", text: "Added the endpoint." },
  { id: "e7", at: NOW, kind: "message", from: "system", text: "Your message to the implementer was not handled: the session ended" },
];

function run(extra: Partial<Run> = {}): Run {
  return {
    id: "r1",
    projectId: "p1",
    title: "Add a health endpoint",
    step: "implement",
    status: "running",
    roles: {},
    sessions: {},
    checks: [],
    gateAttempt: 0,
    gateMaxAttempts: 3,
    reviewRound: 0,
    reviewMaxRounds: 2,
    costUsd: 0,
    startedAt: NOW - 60_000,
    ...extra,
  } as Run;
}

function session(extra: Partial<Session> = {}): Session {
  return {
    id: "s1",
    runId: "r1",
    projectId: "p1",
    role: "implementer",
    harness: "codex",
    vendor: "codex",
    state: "active",
    cwd: "/w",
    events: EVENTS,
    usage: { usedTokens: 0, contextTokens: 0 },
    startedAt: NOW - 50_000,
    ...extra,
  } as Session;
}

function request(extra: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "q1",
    kind: "permission",
    runId: "r1",
    projectId: "p1",
    sessionId: "s1",
    step: "implement",
    stepIndex: 1,
    title: "Run npm install left-pad",
    detail: "execute: npm install left-pad in /w",
    options: [],
    status: "pending",
    createdAt: NOW,
    ...extra,
  };
}

function state(extra: Partial<CockpitState> = {}): CockpitState {
  const s = emptyState("/run/agentuxd.sock");
  return {
    ...s,
    connection: { status: "connected", daemon: "/run/agentuxd.sock", detail: "", mock: false },
    runs: { r1: run() },
    sessions: { s1: session() },
    requests: { q1: request() },
    ...extra,
  };
}

afterEach(cleanup);

describe("session activity", () => {
  it("tells execution, tools, approvals, problems and results apart", () => {
    expect(EVENTS.map((e) => activityOf(e))).toEqual([
      "execution",
      "tool",
      "blocker",
      "result",
      "approval",
      "message",
      "blocker",
    ]);
  });

  it("filters the activity to one kind, with counts", () => {
    const st = state();
    const onFilter = vi.fn();
    render(
      <ActivityBar session={st.sessions.s1} run={st.runs.r1} state={st} filter="all" onFilter={onFilter} onShowRequest={vi.fn()} />,
    );
    const filter = screen.getByRole("group", { name: "Show activity" });
    expect(within(filter).getByRole("button", { name: "Problems, 2" })).toBeTruthy();
    expect(within(filter).getByRole("button", { name: "Results, 1" })).toBeTruthy();
    fireEvent.click(within(filter).getByRole("button", { name: /Problems/ }));
    expect(onFilter).toHaveBeenCalledWith("blocker");

    cleanup();
    render(<SessionEvents session={st.sessions.s1} state={st} now={NOW} onApprove={vi.fn()} onDeny={vi.fn()} filter="blocker" />);
    const items = within(screen.getByRole("list", { name: "Session activity" })).getAllByRole("listitem");
    expect(items.map((li) => li.dataset.activity)).toEqual(["blocker", "blocker"]);
    expect(items[0].textContent).toContain("npm run lint");
  });

  it("shows an approval in context, with what and where, and answers it there", () => {
    const st = state();
    const onApprove = vi.fn();
    render(<SessionEvents session={st.sessions.s1} state={st} now={NOW} onApprove={onApprove} onDeny={vi.fn()} filter="approval" />);
    const card = screen.getByRole("list", { name: "Session activity" });
    expect(card.textContent).toContain("Run npm install left-pad");
    expect(card.textContent).toContain("npm install left-pad in /w");
    fireEvent.click(within(card).getByRole("button", { name: /Allow/ }));
    expect(onApprove).toHaveBeenCalledWith("q1", undefined);
    expect(card.querySelector('[data-request="q1"]')).toBeTruthy();
  });

  it("says when the session waits for you, and shows the request", () => {
    const st = state();
    const onShow = vi.fn();
    render(<ActivityBar session={st.sessions.s1} run={st.runs.r1} state={st} filter="all" onFilter={vi.fn()} onShowRequest={onShow} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Waiting for you");
    expect(status.textContent).toContain("Run npm install left-pad");
    fireEvent.click(within(status).getByRole("button", { name: "Show" }));
    expect(onShow).toHaveBeenCalledWith("q1");
  });

  it("follows live updates and a lost and regained daemon", () => {
    const st = state({ requests: {} });
    const props = { run: st.runs.r1, filter: "all" as const, onFilter: vi.fn(), onShowRequest: vi.fn() };
    const { rerender } = render(<ActivityBar {...props} session={st.sessions.s1} state={st} />);
    expect(screen.getByRole("status").textContent).toContain("Working");

    const offline: CockpitState = { ...st, connection: { ...st.connection, status: "disconnected" } };
    rerender(<ActivityBar {...props} session={st.sessions.s1} state={offline} />);
    expect(screen.getByRole("status").textContent).toContain("agentuxd is unreachable");
    expect(screen.getByRole("status").textContent).toContain("last state");

    const running: SessionEvent = { id: "e8", at: NOW, kind: "tool_call", toolCallId: "t3", tool: "execute", title: "cargo build", status: "running" };
    const later = session({ events: [...EVENTS, running] });
    rerender(<ActivityBar {...props} session={later} state={{ ...st, sessions: { s1: later } }} />);
    expect(screen.getByRole("status").textContent).toContain("Working");
    expect(screen.getByRole("status").textContent).toContain("cargo build");

    cleanup();
    const { rerender: again } = render(
      <SessionEvents session={st.sessions.s1} state={st} now={NOW} onApprove={vi.fn()} onDeny={vi.fn()} />,
    );
    expect(screen.queryByText("cargo build")).toBeNull();
    again(<SessionEvents session={later} state={st} now={NOW} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText("cargo build")).toBeTruthy();
  });

  it("states the end of a run plainly", () => {
    const st = state({ requests: {} });
    const idle = session({ state: "idle" });
    expect(sessionStatus(idle, run({ status: "failed", error: "the gate failed 3 times" }), st)).toMatchObject({
      kind: "blocked",
      detail: "the gate failed 3 times",
    });
    expect(sessionStatus(idle, run({ status: "done" }), st).kind).toBe("done");
    expect(sessionStatus(session({ state: "attached" }), run(), st).kind).toBe("attached");
    expect(sessionStatus(idle, run(), st).kind).toBe("idle");
    // Mock data is not a lost daemon.
    const mock: CockpitState = { ...st, connection: { ...st.connection, status: "disconnected", mock: true } };
    expect(sessionStatus(idle, run(), mock).kind).toBe("idle");
  });

  it("has empty states", () => {
    const st = state({ requests: {} });
    const fresh = session({ events: [], state: "idle" });
    render(<SessionEvents session={fresh} state={st} now={NOW} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText(/No activity yet/)).toBeTruthy();
    cleanup();
    render(<SessionEvents session={fresh} state={st} now={NOW} onApprove={vi.fn()} onDeny={vi.fn()} filter="result" />);
    expect(screen.getByText(/Nothing of this kind/)).toBeTruthy();
  });

  it("stops animations for people who ask for reduced motion", () => {
    const css = readFileSync(resolve(__dirname, "../styles/app.css"), "utf8");
    const block = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("transition-duration: 0.01ms !important");
  });
});

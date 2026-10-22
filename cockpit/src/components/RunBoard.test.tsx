// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "../daemon/tauri/TauriDaemonClient";
import type { CockpitState, PermissionRequest, Run } from "../daemon/types";
import { Inbox } from "./Inbox";
import { RunBoard } from "./RunBoard";

const NOW = 1_800_000_000_000;

function run(id: string, extra: Partial<Run>): Run {
  return {
    id,
    projectId: "p1",
    title: `Run ${id}`,
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

function request(id: string, runId: string, extra: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id,
    kind: "plan",
    runId,
    projectId: "p1",
    step: "plan",
    stepIndex: 0,
    title: `Approve the plan of ${runId}`,
    detail: "1. Do it",
    options: [],
    status: "pending",
    createdAt: NOW - 30_000,
    ...extra,
  };
}

function state(runs: Run[], requests: PermissionRequest[] = []): CockpitState {
  const s = emptyState("test");
  s.projects = [{ id: "p1", name: "app", path: "/src/app" } as CockpitState["projects"][number]];
  s.runs = Object.fromEntries(runs.map((r) => [r.id, r]));
  s.requests = Object.fromEntries(requests.map((r) => [r.id, r]));
  return s;
}

afterEach(cleanup);

describe("RunBoard", () => {
  it("puts each run in its column, waiting runs first, finished ones in Done", () => {
    const board = state(
      [
        run("r1", { step: "plan", status: "waiting" }),
        run("r2", { step: "gate" }),
        run("r3", { step: "review", status: "done", finishedAt: NOW }),
        run("r4", { step: "custom" }),
      ],
      [request("q1", "r1")],
    );
    render(<RunBoard state={board} projectId={null} selectedRunId={null} now={NOW} onSelectRun={() => {}} />);
    const column = (name: string) => screen.getByRole("listitem", { name });
    expect(within(column("Waiting for you")).getByText("Run r1")).toBeTruthy();
    expect(within(column("Done")).getByText("Run r3")).toBeTruthy();
    // Custom steps run an agent, like implement.
    expect(within(column("Waiting for you")).queryByText("Run r4")).toBeNull();
    expect(screen.getAllByRole("listitem")[0].getAttribute("aria-label")).toBe("Waiting for you");
  });

  it("filters by project and selects a run on click", () => {
    const onSelectRun = vi.fn();
    const board = state([run("r1", {}), run("r2", { projectId: "other" })]);
    render(<RunBoard state={board} projectId="p1" selectedRunId={null} now={NOW} onSelectRun={onSelectRun} />);
    expect(screen.queryByText("Run r2")).toBeNull();
    fireEvent.click(screen.getByText("Run r1"));
    expect(onSelectRun).toHaveBeenCalledWith("r1");
  });
});

describe("Inbox", () => {
  it("lists pending requests with their actions, and says so when there are none", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const pending = [request("q1", "r1")];
    const inbox = state([run("r1", { status: "waiting", step: "plan" })], pending);
    const props = { now: NOW, selectedId: "q1", onSelect: () => {}, onApprove, onDeny, onOpenRun: () => {} };
    const { rerender } = render(<Inbox state={inbox} pending={pending} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve plan/ }));
    expect(onApprove).toHaveBeenCalledWith("q1", undefined);
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    expect(onDeny).toHaveBeenCalledWith("q1");

    rerender(<Inbox state={state([])} pending={[]} {...props} />);
    expect(screen.getByText("Inbox zero")).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import type { ApiBusMessage, ApiEvent, ApiSnapshot } from "../daemon/tauri/api";
import { applyBusList, applySnapshot } from "../daemon/tauri/mapping";
import { emptyState } from "../daemon/tauri/TauriDaemonClient";
import recorded from "../daemon/tauri/__fixtures__/bus-run.json";
import { groupBus, matchesBusFilter, recentRunIds } from "./bus";

const fixture = recorded as unknown as { snapshot: ApiSnapshot; events: ApiEvent[]; bus: ApiBusMessage[] };
const log = applyBusList(applySnapshot(emptyState("test"), fixture.snapshot), fixture.bus).bus;

describe("groupBus", () => {
  const groups = groupBus(log);
  const describe = (g: (typeof groups)[number]) =>
    g.kind === "exchange" ? `x${g.exchange}` : g.kind === "question" ? `q${g.questionId}` : g.entries[0].kind;

  it("groups exchanges (with their wakes and refusals) and questions, newest activity first", () => {
    expect(groups.map(describe)).toEqual([
      "left",
      "left",
      "x6",
      "x5",
      "q3",
      "x4",
      "x3",
      "joined",
      "x2",
      "x1",
      "tool_denied",
      "q2",
      "q1",
      "joined",
    ]);
  });

  it("an exchange shows its turns and whether it hit the limit", () => {
    const pingPong = groups.find((g) => g.exchange === 3)!;
    expect(pingPong.entries.map((m) => m.kind)).toEqual(["message", "wake", "message", "wake", "message", "wake", "turn_limit"]);
    expect([pingPong.turn, pingPong.maxTurns, pingPong.limited]).toEqual([3, 3, true]);
    expect(groups.find((g) => g.exchange === 4)!.limited).toBe(false);
  });

  it("a question group holds the question and its answer", () => {
    const late = groups.find((g) => g.questionId === 3)!;
    expect(late.entries.map((m) => [m.kind, m.subject])).toEqual([
      ["question", "May I drop the legacy /status route?"],
      ["answer", "yes, drop it"],
    ]);
  });
});

describe("matchesBusFilter", () => {
  const kinds = (filter: Parameters<typeof matchesBusFilter>[1], system: boolean) =>
    [...new Set(log.filter((m) => matchesBusFilter(m, filter, system)).map((m) => m.kind))].sort();

  it("hides system lines on request, and outside All", () => {
    expect(kinds("all", true)).toHaveLength(11);
    expect(kinds("all", false)).not.toContain("wake");
    expect(kinds("all", false)).not.toContain("joined");
    expect(kinds("warnings", true)).toEqual(["tool_denied", "turn_limit"]);
    expect(kinds("questions", true)).toEqual(["answer", "human_answer", "question"]);
    expect(kinds("messages", true)).toEqual(["handoff", "human_answer", "message", "review_request"]);
  });
});

describe("recentRunIds", () => {
  it("takes the most recently updated runs in scope", () => {
    const runs = [
      { id: "a", projectId: "p1", updatedAt: 1 },
      { id: "b", projectId: "p2", updatedAt: 3 },
      { id: "c", projectId: "p1", updatedAt: 2 },
    ];
    expect(recentRunIds(runs, null)).toEqual(["b", "c", "a"]);
    expect(recentRunIds(runs, "p1", 1)).toEqual(["c"]);
  });
});

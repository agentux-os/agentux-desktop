import { describe, expect, it } from "vitest";
import type { CockpitState, SessionEvent } from "../types";
import type { ApiBusMessage, ApiEvent, ApiRun, ApiRunEventsPage, ApiSession, ApiSnapshot } from "./api";
import { applyBusList, applyEvent, applyRunHistory, applySnapshot, mapBusEndpoint, resolveBusEndpoint } from "./mapping";
import { emptyState } from "./TauriDaemonClient";
// Recorded from agentux-core main (e9a7bb2) with a test added to
// crates/agentuxd/tests/bus.rs for the recording only: fake ACP agents as
// codex (implementer) and claude-code (reviewer). The human prompts the
// implementer mid-step (sessions.prompt), then posts on the bus to the
// reviewer role (nobody plays it yet: queued, a session is started), to the
// implementer's session by id only, as a reply to the reviewer's answer
// (inReplyTo, no `to`), and on the run's channel. `posts` holds the raw
// results, `pages` the raw runs.events pages (limit 10), `subscribe` the raw
// lines of events.subscribe { since: 0, runId } with its replay_done.
import recorded from "./__fixtures__/human-run.json";

interface HumanFixture {
  snapshot: ApiSnapshot;
  bus: ApiBusMessage[];
  posts: Record<"sessionsPrompt" | "toRole" | "toSession" | "reply" | "toRun", Record<string, unknown>>;
  pages: { params: { runId: string; sinceSeq?: number; limit: number }; result: ApiRunEventsPage }[];
  subscribe: { id?: number; method?: string; params?: { seq: number } & Record<string, unknown>; result?: { seq: number } }[];
}
const fx = recorded as unknown as HumanFixture;
const runId = fx.snapshot.runs[0].id;
const [implementer, reviewer] = fx.snapshot.sessions!;

const paged = fx.pages.flatMap((p) => p.result.events);
const replayed = fx.subscribe.filter((l) => l.method === "event").map((l) => l.params as unknown as ApiEvent);
const replayDone = fx.subscribe.find((l) => l.method === "replay_done")!.params!.seq;

/** What `daemon_run_history` returns from the recorded pages. */
const pagedHistory = { head: fx.pages[fx.pages.length - 1].result.headSeq, events: paged, source: "runs.events" as const };

const texts = (events: SessionEvent[]) =>
  events.filter((e) => e.kind === "message").map((e) => (e.kind === "message" ? `${e.from}: ${e.text.split("\n")[0]}` : ""));

function loaded(): CockpitState {
  return applyBusList(applyRunHistory(applySnapshot(emptyState("test"), fx.snapshot), runId, pagedHistory), fx.bus);
}

describe("the recording", () => {
  it("is what the core documents: pages that add up to the replay, a marker at the head", () => {
    expect(fx.pages.map((p) => p.result.more)).toEqual([...fx.pages.slice(1).map(() => true), false]);
    fx.pages.slice(1).forEach((p, i) => {
      const before = fx.pages[i].result.events;
      expect(p.params.sinceSeq).toBe(before[before.length - 1].seq);
    });
    expect(paged).toEqual(replayed);
    expect(replayDone).toBe(pagedHistory.head);
    expect(fx.posts.toRole).toMatchObject({ queuedForRole: "reviewer", deliveredTo: [] });
    expect(fx.posts.toSession).toMatchObject({ deliveredTo: [implementer.id] });
  });
});

describe("the human's messages in a session", () => {
  it("map to their own sender, apart from AgentUX's prompts", () => {
    const s = loaded();
    const lines = texts(s.sessions[implementer.id].events);
    expect(lines[0]).toBe("human: Also log every request");
    expect(lines.filter((l) => l.startsWith("human:"))).toHaveLength(1);
    expect(lines[1]).toMatch(/^user: You are the implementer/);
    // Bus wakes are AgentUX's prompts, not the human's.
    expect(texts(s.sessions[reviewer.id].events).some((l) => l.startsWith("user: [agentux bus] New message from the human"))).toBe(true);
  });

  it("are never joined to the agent's chunks, and unknown senders become system notes", () => {
    let s = applySnapshot(emptyState("test"), fx.snapshot);
    const msg = (seq: number, from: string, text: string) =>
      applyEvent(s, { seq, at: seq, runId, kind: "session_event", sessionId: implementer.id, event: { kind: "message", from, text } } as ApiEvent);
    s = msg(100, "agent", "a");
    s = msg(101, "human", "b");
    s = msg(102, "agent", "c");
    s = msg(103, "robot", "d");
    expect(texts(s.sessions[implementer.id].events)).toEqual(["agent: a", "human: b", "agent: c", "system: d"]);
  });
});

describe("run history", () => {
  it("assembled from runs.events pages equals the replayed subscription", () => {
    const base = applySnapshot(emptyState("test"), fx.snapshot);
    const fromPages = applyRunHistory(base, runId, pagedHistory);
    const fromReplay = applyRunHistory(base, runId, { head: replayDone, events: replayed });
    expect(fromPages.sessions).toEqual(fromReplay.sessions);
    expect(fromPages.bus).toEqual(fromReplay.bus);
    // Every routed bus entry of the run is in the log and the timelines.
    expect(fromPages.bus.map((m) => m.id).sort()).toEqual(fx.bus.map((m) => m.id).sort());
    const busEntries = fromPages.sessions[implementer.id].events.filter((e) => e.kind === "bus");
    expect(busEntries.length).toBeGreaterThan(0);
  });

  it("keeps live events past head for the client to apply again", () => {
    const base = applySnapshot(emptyState("test"), fx.snapshot);
    const live = { seq: pagedHistory.head + 1, at: 1, runId, kind: "session_event", sessionId: implementer.id, event: { kind: "message", from: "human", text: "later" } } as ApiEvent;
    const s = applyRunHistory(base, runId, { ...pagedHistory, events: [...paged, live] });
    expect(texts(s.sessions[implementer.id].events)).not.toContain("human: later");
    expect(texts(applyEvent(s, live).sessions[implementer.id].events)).toContain("human: later");
  });
});

describe("the human's posts on the bus", () => {
  it("come from the human, to roles, sessions and the run, with replies in their exchange", () => {
    const mine = loaded().bus.filter((m) => m.from.kind === "human");
    expect(mine.map((m) => [m.to.kind, m.subject, m.inReplyTo, m.exchange, m.turn])).toEqual([
      ["role", "Review focus", undefined, 1, 1],
      ["session", "Ping", undefined, 2, 1],
      ["session", "Thanks, ship it.", 2, 1, 3],
      ["run", "Remember the changelog", undefined, 3, 1],
    ]);
    expect(mine[0]).toMatchObject({ queuedForRole: "reviewer", body: "Review focus\n\nLook at the error path first." });
    expect(mine[1].to).toEqual({ kind: "session", sessionId: implementer.id, role: "implementer", harness: "codex", vendor: "codex" });
  });
});

function apiRun(over: Partial<ApiRun> = {}): ApiRun {
  return {
    ...fx.snapshot.runs[0],
    id: "r1",
    status: "running",
    roles: { implementer: "codex", reviewer: "claude-code" },
    sessions: { implementer: "s1", reviewer: "s2" },
    ...over,
  };
}

function apiSession(over: Partial<ApiSession>): ApiSession {
  return { ...implementer, runId: "r1", ...over } as ApiSession;
}

function entry(over: Partial<ApiBusMessage>): ApiBusMessage {
  return { ...fx.bus.find((m) => m.subject === "Ping")!, id: "x1", runId: "r1", ...over };
}

describe("session endpoints that name only the session", () => {
  const bare = (sessionId: string) => ({ kind: "session" as const, sessionId });

  it("map with an unknown role and harness", () => {
    expect(mapBusEndpoint(bare("s2"))).toEqual({ kind: "session", sessionId: "s2", role: "", harness: undefined, vendor: undefined });
  });

  it("get role and harness from the session's snapshot", () => {
    const s = applySnapshot(emptyState("test"), {
      projects: [],
      runs: [apiRun()],
      requests: [],
      sessions: [apiSession({ id: "s2", role: "reviewer", harness: "claude-code" })],
    });
    expect(resolveBusEndpoint(mapBusEndpoint(bare("s2")), "r1", s)).toEqual({
      kind: "session",
      sessionId: "s2",
      role: "reviewer",
      harness: "claude-code",
      vendor: "claude-code",
    });
    // Complete endpoints and other kinds are left alone.
    const full = mapBusEndpoint({ kind: "session", sessionId: "s2", role: "qa", vendor: "aider" });
    expect(resolveBusEndpoint(full, "r1", s)).toBe(full);
    const role = mapBusEndpoint({ kind: "role", role: "reviewer" });
    expect(resolveBusEndpoint(role, "r1", s)).toBe(role);
  });

  it("fall back to the run's role -> session map before the session is known", () => {
    let s = applyEvent(emptyState("test"), { seq: 1, at: 1, runId: "r1", kind: "run", run: apiRun() } as ApiEvent);
    s = applyEvent(s, { seq: 2, at: 2, runId: "r1", kind: "bus_message", message: entry({ to: bare("s2"), deliveredTo: ["s2"] }) } as ApiEvent);
    expect(s.bus[0].to).toEqual({ kind: "session", sessionId: "s2", role: "reviewer", harness: undefined, vendor: "claude-code" });
    // The session's snapshot completes it.
    s = applyEvent(s, { seq: 3, at: 3, runId: "r1", kind: "session", session: apiSession({ id: "s2", role: "reviewer", harness: "claude-code" }) } as ApiEvent);
    expect(s.bus[0].to).toMatchObject({ role: "reviewer", harness: "claude-code", vendor: "claude-code" });
  });

  it("are resolved in bus.list and by a later snapshot", () => {
    let s = applyBusList(emptyState("test"), [entry({ from: bare("s1"), to: { kind: "human" } })]);
    expect(s.bus[0].from).toMatchObject({ role: "", harness: undefined });
    s = applySnapshot(s, { projects: [], runs: [apiRun()], requests: [], sessions: [apiSession({ id: "s1" })] });
    expect(s.bus[0].from).toEqual({ kind: "session", sessionId: "s1", role: "implementer", harness: "codex", vendor: "codex" });
  });
});

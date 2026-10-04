import type { BusMessage, BusMessageKind } from "../daemon/types";
import { BUS_SYSTEM_KINDS } from "../daemon/types";

/** Filters of the agent-bus page. */
export type BusFilter = "all" | "messages" | "questions" | "warnings";

const FILTER_KINDS: Record<Exclude<BusFilter, "all">, readonly BusMessageKind[]> = {
  messages: ["message", "review_request", "handoff", "human_answer"],
  questions: ["question", "answer", "human_answer"],
  warnings: ["turn_limit", "tool_denied"],
};

export function matchesBusFilter(m: BusMessage, filter: BusFilter, showSystem: boolean): boolean {
  if (BUS_SYSTEM_KINDS.includes(m.kind)) return showSystem && filter === "all";
  return filter === "all" || FILTER_KINDS[filter].includes(m.kind);
}

/**
 * Entries shown together: one exchange (a message and its replies, sharing
 * the turn budget, with the wakes they caused and any turn-limit refusal),
 * one `ask_human` (question and answer), or a single entry.
 */
export interface BusGroup {
  key: string;
  runId: string;
  kind: "exchange" | "question" | "single";
  exchange?: number;
  questionId?: number;
  /** Oldest first. */
  entries: BusMessage[];
  lastAt: number;
  /** Highest turn used in the exchange, and the run's limit. */
  turn: number;
  maxTurns: number;
  /** A post in the exchange was refused at the turn limit. */
  limited: boolean;
  /** Position of the group's newest entry in the log (orders entries logged in the same millisecond). */
  lastIndex: number;
}

/** Groups a log (oldest first) by exchange and question; groups come newest activity first. */
export function groupBus(messages: BusMessage[]): BusGroup[] {
  const exchangeOf = new Map<string, number>();
  for (const m of messages) {
    if (m.exchange != null && m.messageId != null) exchangeOf.set(`${m.runId}:${m.messageId}`, m.exchange);
  }
  const groups = new Map<string, BusGroup>();
  messages.forEach((m, index) => {
    let exchange = m.exchange;
    if (exchange == null && m.kind === "wake" && m.messageId != null) exchange = exchangeOf.get(`${m.runId}:${m.messageId}`);
    let key: string;
    let kind: BusGroup["kind"];
    if (exchange != null) {
      key = `${m.runId}:x${exchange}`;
      kind = "exchange";
    } else if ((m.kind === "question" || m.kind === "answer") && m.questionId != null) {
      key = `${m.runId}:q${m.questionId}`;
      kind = "question";
    } else {
      key = m.id;
      kind = "single";
    }
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        runId: m.runId,
        kind,
        exchange: kind === "exchange" ? exchange : undefined,
        questionId: kind === "question" ? m.questionId : undefined,
        entries: [],
        lastAt: m.at,
        turn: 0,
        maxTurns: m.maxTurns,
        limited: false,
        lastIndex: index,
      };
      groups.set(key, g);
    }
    g.entries.push(m);
    g.lastAt = Math.max(g.lastAt, m.at);
    g.turn = Math.max(g.turn, m.turn);
    g.maxTurns = Math.max(g.maxTurns, m.maxTurns);
    g.lastIndex = index;
    if (m.kind === "turn_limit") g.limited = true;
  });
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt || b.lastIndex - a.lastIndex);
}

/** The runs whose bus log the UI should load: the most recently updated ones in scope. */
export function recentRunIds(runs: { id: string; projectId: string; updatedAt: number }[], projectId: string | null, limit = 20): string[] {
  return runs
    .filter((r) => projectId === null || r.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((r) => r.id);
}

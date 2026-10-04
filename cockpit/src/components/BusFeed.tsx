import { useMemo, useState } from "react";
import type { BusMessage, BusPostInput, CockpitState } from "../daemon/types";
import { groupBus, matchesBusFilter, type BusFilter, type BusGroup } from "../lib/bus";
import { isActiveRun } from "../lib/busPost";
import { runRef } from "../lib/labels";
import { BusComposer } from "./BusComposer";
import { BusItem } from "./BusItem";
import { Icon } from "./Icon";

const FILTERS: { id: BusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "messages", label: "Messages" },
  { id: "questions", label: "Questions" },
  { id: "warnings", label: "Warnings" },
];

/** Audit log of everything agents said to each other (and to you) over the bus, by exchange. */
export function BusFeed({
  state,
  mode,
  projectId,
  onOpenRun,
  onPost,
}: {
  state: CockpitState;
  mode: "mock" | "daemon";
  projectId: string | null;
  onOpenRun: (runId: string) => void;
  onPost: (input: BusPostInput) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<BusFilter>("all");
  const [showSystem, setShowSystem] = useState(true);
  const [replyTo, setReplyTo] = useState<BusMessage | undefined>();
  // Runs whose bus is open, newest activity first.
  const runs = useMemo(
    () =>
      Object.values(state.runs)
        .filter((r) => isActiveRun(r) && (projectId === null || r.projectId === projectId))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.runs, projectId],
  );
  const reply = (m: BusMessage) => setReplyTo(m);
  const groups = useMemo(
    () =>
      groupBus(
        state.bus.filter((m) => (projectId === null || m.projectId === projectId) && matchesBusFilter(m, filter, showSystem)),
      ),
    [state.bus, projectId, filter, showSystem],
  );

  return (
    <div className="page">
      <div className="page-intro">
        <p>
          Agents talk through the <code>agentux</code> MCP server. The daemon routes every message, wakes the target session,
          and stops an exchange at <code>max_turns_per_exchange</code>.
        </p>
        <div className="filters" role="group" aria-label="Filter the bus log">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip-btn ${filter === f.id ? "is-on" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
          <button
            className={`chip-btn ${showSystem ? "is-on" : ""}`}
            onClick={() => setShowSystem((v) => !v)}
            aria-pressed={showSystem}
            title="Wakes, sessions joining and leaving (shown with All)"
          >
            System lines
          </button>
        </div>
      </div>
      <BusComposer
        state={state}
        mode={mode}
        runs={runs}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(undefined)}
        onPost={onPost}
      />
      <div className="bus-list">
        {groups.map((g) => (
          <BusGroupView key={g.key} group={g} state={state} onOpenRun={onOpenRun} onReply={reply} />
        ))}
        {groups.length === 0 && <div className="empty">No messages yet.</div>}
      </div>
    </div>
  );
}

/** One exchange, question or single entry of the log. `onOpenRun` absent: shown inside that run. */
export function BusGroupView({
  group: g,
  state,
  onOpenRun,
  onReply,
}: {
  group: BusGroup;
  state: CockpitState;
  onOpenRun?: (runId: string) => void;
  onReply?: (m: BusMessage) => void;
}) {
  const run = state.runs[g.runId];
  const open = onOpenRun ? () => onOpenRun(g.runId) : undefined;
  if (g.kind === "single") {
    const [m] = g.entries;
    return <BusItem msg={m} run={open ? run : undefined} inExchange={!open} onOpen={open} onReply={onReply} />;
  }
  return (
    <section className={`bus-group ${g.limited ? "is-limited" : ""}`}>
      <header className="bus-group-head">
        <Icon name={g.kind === "question" ? "question" : "bus"} size={13} />
        <strong>{g.kind === "question" ? `Question ${g.questionId}` : `Exchange ${g.exchange}`}</strong>
        {run && open && (
          <button className="link-btn" onClick={open}>
            {runRef(run)} {run.title}
          </button>
        )}
        {g.kind === "exchange" && (
          <span className={`bus-turn ${g.limited ? "is-limited" : ""}`} title="Turns used in this exchange / max_turns_per_exchange">
            {g.limited && <Icon name="alert" size={12} />} turn {g.turn}/{g.maxTurns}
          </span>
        )}
      </header>
      <div className="bus-group-body">
        {g.entries.map((m) => (
          <BusItem key={m.id} msg={m} run={run} inExchange onOpen={open} onReply={onReply} />
        ))}
      </div>
    </section>
  );
}

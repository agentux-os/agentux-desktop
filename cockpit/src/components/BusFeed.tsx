import { useMemo, useState } from "react";
import type { CockpitState } from "../daemon/types";
import { groupBus, matchesBusFilter, type BusFilter, type BusGroup } from "../lib/bus";
import { runRef } from "../lib/labels";
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
  projectId,
  onOpenRun,
}: {
  state: CockpitState;
  projectId: string | null;
  onOpenRun: (runId: string) => void;
}) {
  const [filter, setFilter] = useState<BusFilter>("all");
  const [showSystem, setShowSystem] = useState(true);
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
      <div className="bus-list">
        {groups.map((g) => (
          <BusGroupView key={g.key} group={g} state={state} onOpenRun={onOpenRun} />
        ))}
        {groups.length === 0 && <div className="empty">No messages yet.</div>}
      </div>
    </div>
  );
}

function BusGroupView({ group: g, state, onOpenRun }: { group: BusGroup; state: CockpitState; onOpenRun: (runId: string) => void }) {
  const run = state.runs[g.runId];
  if (g.kind === "single") {
    const [m] = g.entries;
    return <BusItem msg={m} run={run} onOpen={() => onOpenRun(m.runId)} />;
  }
  return (
    <section className={`bus-group ${g.limited ? "is-limited" : ""}`}>
      <header className="bus-group-head">
        <Icon name={g.kind === "question" ? "question" : "bus"} size={13} />
        <strong>{g.kind === "question" ? `Question ${g.questionId}` : `Exchange ${g.exchange}`}</strong>
        {run && (
          <button className="link-btn" onClick={() => onOpenRun(g.runId)}>
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
          <BusItem key={m.id} msg={m} run={run} inExchange onOpen={() => onOpenRun(m.runId)} />
        ))}
      </div>
    </section>
  );
}

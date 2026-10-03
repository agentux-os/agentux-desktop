import { useState } from "react";
import type { BusTool, CockpitState } from "../daemon/types";
import { BUS_TOOL_LABEL } from "../lib/labels";
import { BusItem } from "./BusItem";

const FILTERS: (BusTool | "all")[] = ["all", "request_review", "post_message", "handoff", "ask_human"];

/** Audit log of everything agents said to each other over the bus. */
export function BusFeed({
  state,
  projectId,
  onOpenRun,
}: {
  state: CockpitState;
  projectId: string | null;
  onOpenRun: (runId: string) => void;
}) {
  const [filter, setFilter] = useState<BusTool | "all">("all");
  const messages = state.bus
    .filter((m) => (projectId === null || m.projectId === projectId) && (filter === "all" || m.tool === filter))
    .slice()
    .reverse();

  return (
    <div className="page">
      <div className="page-intro">
        <p>
          Agents talk through the <code>agentux</code> MCP server. The daemon routes every message, wakes the target session,
          and stops exchanges at <code>max_turns_per_exchange</code>.
        </p>
        <div className="filters" role="group" aria-label="Filter by bus tool">
          {FILTERS.map((f) => (
            <button key={f} className={`chip-btn ${filter === f ? "is-on" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : BUS_TOOL_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="bus-list">
        {messages.map((m) => (
          <BusItem key={m.id} msg={m} run={state.runs[m.runId]} onOpen={() => onOpenRun(m.runId)} />
        ))}
        {messages.length === 0 && <div className="empty">No messages yet.</div>}
      </div>
    </div>
  );
}

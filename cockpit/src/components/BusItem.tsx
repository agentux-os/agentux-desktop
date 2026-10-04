import type { BusEndpoint, BusMessage, Run } from "../daemon/types";
import { BUS_TOOL_LABEL, roleLabel, runRef } from "../lib/labels";
import { formatClock } from "../lib/format";
import { renderInline } from "../lib/inline";
import { Icon } from "./Icon";
import { VendorBadge } from "./VendorBadge";

function Endpoint({ ep }: { ep: BusEndpoint }) {
  if (ep.kind === "human") return <span className="bus-ep human">You</span>;
  if (ep.kind === "daemon") return <span className="bus-ep">agentuxd</span>;
  return (
    <span className="bus-ep">
      <VendorBadge vendor={ep.vendor} compact />
      {roleLabel(ep.role)}
    </span>
  );
}

/** One agent-bus message: who talked to whom, through which bus tool. */
export function BusItem({
  msg,
  run,
  compact,
  onOpen,
}: {
  msg: BusMessage;
  run?: Run;
  compact?: boolean;
  onOpen?: () => void;
}) {
  return (
    <article className={`bus-item tool-${msg.tool} ${compact ? "is-compact" : ""}`}>
      <header className="bus-head">
        <Endpoint ep={msg.from} />
        <Icon name="arrowRight" size={13} className="muted" />
        <Endpoint ep={msg.to} />
        <span className={`bus-tool tool-${msg.tool}`}>{BUS_TOOL_LABEL[msg.tool]}</span>
      </header>
      <div className="bus-subject">{msg.subject}</div>
      <p className="bus-body">{renderInline(msg.body)}</p>
      <footer className="bus-foot">
        {run && (
          <button className="link-btn" onClick={onOpen}>
            {runRef(run)} {compact ? "" : run.title} <span className="muted">· {run.projectId}</span>
          </button>
        )}
        <span className="bus-turn" title="Turn within this exchange / max_turns_per_exchange">
          turn {msg.turn}/{msg.maxTurns} · {formatClock(msg.at)}
        </span>
      </footer>
    </article>
  );
}

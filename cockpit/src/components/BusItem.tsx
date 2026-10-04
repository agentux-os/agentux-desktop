import type { BusEndpoint, BusMessage, Run } from "../daemon/types";
import { BUS_SYSTEM_KINDS, BUS_WARNING_KINDS } from "../daemon/types";
import { BUS_KIND_LABEL, roleLabel, runRef } from "../lib/labels";
import { canReplyTo } from "../lib/busPost";
import { formatClock } from "../lib/format";
import { renderInline } from "../lib/inline";
import { Icon } from "./Icon";
import { VendorBadge } from "./VendorBadge";

/** Who sent or received a bus entry. */
export function BusEndpointLabel({ ep }: { ep: BusEndpoint }) {
  switch (ep.kind) {
    case "human":
      return <span className="bus-ep human">You</span>;
    case "daemon":
      return <span className="bus-ep">agentuxd</span>;
    case "run":
      return <span className="bus-ep muted">run channel</span>;
    case "role":
      return (
        <span className="bus-ep" title="Every session playing this role">
          {roleLabel(ep.role)} <span className="muted">(role)</span>
        </span>
      );
    case "session":
      return (
        <span className="bus-ep" title={`Session ${ep.sessionId}`}>
          <VendorBadge vendor={ep.vendor} harness={ep.harness} compact />
          {roleLabel(ep.role)}
        </span>
      );
  }
}

export function isSystemEntry(m: BusMessage): boolean {
  return BUS_SYSTEM_KINDS.includes(m.kind);
}

export function isWarningEntry(m: BusMessage): boolean {
  return BUS_WARNING_KINDS.includes(m.kind);
}

/**
 * One agent-bus log entry. Wakes, joins and leaves are one quiet line;
 * refusals (turn limit, denied tool) are warnings; messages, questions and
 * answers are cards with who talked to whom.
 */
export function BusItem({
  msg,
  run,
  compact,
  inExchange,
  onOpen,
  onReply,
}: {
  msg: BusMessage;
  run?: Run;
  compact?: boolean;
  /** Shown inside an exchange group: the run link and turn limit are in its header. */
  inExchange?: boolean;
  onOpen?: () => void;
  /** Answer this message on the bus; absent where the human cannot post. */
  onReply?: (msg: BusMessage) => void;
}) {
  if (isSystemEntry(msg)) {
    return (
      <div className={`bus-line kind-${msg.kind}`} title={msg.kind === "wake" ? msg.body : undefined}>
        <Icon name={msg.kind === "wake" ? "bell" : msg.kind === "joined" ? "plus" : "minus"} size={12} />
        <span className="bus-line-text">{msg.subject}</span>
        {!inExchange && run && (
          <button className="link-btn" onClick={onOpen}>
            {runRef(run)}
          </button>
        )}
        <span className="bus-time">{formatClock(msg.at)}</span>
      </div>
    );
  }
  const warning = isWarningEntry(msg);
  return (
    <article className={`bus-item kind-${msg.kind} ${warning ? "is-warning" : ""} ${compact ? "is-compact" : ""}`}>
      <header className="bus-head">
        {warning && <Icon name="alert" size={13} className="bus-warn-icon" />}
        <BusEndpointLabel ep={msg.from} />
        <Icon name="arrowRight" size={13} className="muted" />
        <BusEndpointLabel ep={msg.to} />
        <span className={`bus-tool kind-${msg.kind}`}>{BUS_KIND_LABEL[msg.kind]}</span>
        {msg.tool && msg.kind === "tool_denied" && <code className="chip">{msg.tool}</code>}
        {msg.queuedForRole && (
          <span className="muted" title="No session played the role yet: the message waits for one">
            queued for {roleLabel(msg.queuedForRole).toLowerCase()}
          </span>
        )}
      </header>
      <div className="bus-subject">{msg.subject}</div>
      {msg.body && msg.body !== msg.subject && <p className="bus-body">{renderInline(msg.body)}</p>}
      <footer className="bus-foot">
        {!inExchange && run && (
          <button className="link-btn" onClick={onOpen}>
            {runRef(run)} {compact ? "" : run.title} <span className="muted">· {run.projectId}</span>
          </button>
        )}
        {onReply && canReplyTo(msg) && (
          <button className="link-btn" onClick={() => onReply(msg)} title="Answer this message on the bus (goes to its sender)">
            Reply
          </button>
        )}
        <span className="bus-turn" title="Turn within this exchange / max_turns_per_exchange">
          {msg.turn > 0 && (
            <>
              turn {msg.turn}/{msg.maxTurns} ·{" "}
            </>
          )}
          {formatClock(msg.at)}
        </span>
      </footer>
    </article>
  );
}

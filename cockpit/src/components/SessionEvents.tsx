import { memo } from "react";
import type { BusMessage, CockpitState, FileDiff, PermissionRequest, Session, SessionEvent, ToolKind } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { BUS_TOOL_LABEL, ROLE_LABEL } from "../lib/labels";
import { formatClock } from "../lib/format";
import { renderInline } from "../lib/inline";
import { Icon, type IconName } from "./Icon";
import { RequestCard } from "./RequestCard";
import { vendorStyle } from "./VendorBadge";

const TOOL_ICON: Record<ToolKind, IconName> = {
  read: "file",
  search: "search",
  edit: "edit",
  execute: "execute",
  fetch: "globe",
  bus: "bus",
};

interface Props {
  session: Session;
  state: CockpitState;
  now: number;
  onApprove: (requestId: string, answer?: string) => void;
  onDeny: (requestId: string) => void;
}

/**
 * Renders a session's events. The same components are used for every vendor:
 * only the badge colour tells Claude Code from Codex.
 */
export function SessionEvents({ session, state, now, onApprove, onDeny }: Props) {
  return (
    <ol className="events">
      {session.events.map((ev) => (
        <li key={ev.id} className={`ev ev--${ev.kind}`}>
          <EventView
            ev={ev}
            session={session}
            request={ev.kind === "permission" ? state.requests[ev.requestId] : undefined}
            bus={ev.kind === "bus" ? state.bus.find((m) => m.id === ev.messageId) : undefined}
            now={now}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        </li>
      ))}
      {session.state === "active" && (
        <li className="ev ev--typing" aria-label="Agent is working">
          <span className="typing" style={vendorStyle(session.vendor)}>
            <i />
            <i />
            <i />
          </span>
        </li>
      )}
    </ol>
  );
}

interface EventProps {
  ev: SessionEvent;
  session: Session;
  request?: PermissionRequest;
  bus?: BusMessage;
  now: number;
  onApprove: (requestId: string, answer?: string) => void;
  onDeny: (requestId: string) => void;
}

const EventView = memo(function EventView({ ev, session, request, bus, now, onApprove, onDeny }: EventProps) {
  switch (ev.kind) {
    case "message":
      if (ev.from === "system") {
        return (
          <div className="msg-system">
            <Icon name="info" size={13} />
            <span>{ev.text}</span>
          </div>
        );
      }
      return (
        <div className={`msg msg-${ev.from}`}>
          <div className="msg-head">
            {ev.from === "agent" ? (
              <span className="msg-author" style={vendorStyle(session.vendor)}>
                <span className="vmono">{VENDOR_INFO[session.vendor].mono}</span>
                {VENDOR_INFO[session.vendor].label}
                <span className="muted">{ROLE_LABEL[session.role]}</span>
              </span>
            ) : (
              <span className="msg-author">
                <span className="vmono you">You</span>
              </span>
            )}
            <time className="msg-time">{formatClock(ev.at)}</time>
          </div>
          <div className="msg-text">{renderInline(ev.text)}</div>
        </div>
      );
    case "tool_call":
      return (
        <details className={`tool tool-${ev.status}`} open={ev.status === "error"}>
          <summary>
            <Icon name={TOOL_ICON[ev.tool]} size={14} />
            <span className="tool-title">{ev.title}</span>
            <span className="tool-status">
              {ev.status === "running" ? <span className="spinner" /> : <Icon name={ev.status === "ok" ? "check" : "x"} size={14} />}
            </span>
          </summary>
          {ev.input && <pre className="tool-io">{ev.input}</pre>}
          {ev.output && <pre className="tool-io tool-out">{ev.output}</pre>}
        </details>
      );
    case "diff":
      return <DiffView diff={ev.diff} />;
    case "plan":
      return (
        <div className="plan">
          <div className="plan-head">
            <Icon name="plan" size={14} /> Plan
            <span className="muted">
              {ev.items.filter((i) => i.status === "done").length}/{ev.items.length}
            </span>
          </div>
          <ul>
            {ev.items.map((item, i) => (
              <li key={i} className={`plan-item is-${item.status}`}>
                <span className="plan-box">{item.status === "done" && <Icon name="check" size={11} />}</span>
                {renderInline(item.text)}
              </li>
            ))}
          </ul>
        </div>
      );
    case "permission":
      return request ? (
        <RequestCard
          request={request}
          now={now}
          inline
          showShortcuts
          onApprove={(a) => onApprove(request.id, a)}
          onDeny={() => onDeny(request.id)}
        />
      ) : null;
    case "bus": {
      if (!bus) return null;
      const outgoing = bus.from.kind === "session" && bus.from.sessionId === session.id;
      const other = outgoing ? bus.to : bus.from;
      const otherLabel =
        other.kind === "session" ? `${VENDOR_INFO[other.vendor].label} ${ROLE_LABEL[other.role].toLowerCase()}` : other.kind === "human" ? "you" : "agentuxd";
      return (
        <div className="ev-bus" style={other.kind === "session" ? vendorStyle(other.vendor) : undefined}>
          <div className="ev-bus-head">
            <Icon name="bus" size={13} />
            <span>
              {outgoing ? "Sent to" : "From"} <strong>{otherLabel}</strong>
            </span>
            <span className={`bus-tool tool-${bus.tool}`}>{BUS_TOOL_LABEL[bus.tool]}</span>
            <span className="muted">
              turn {bus.turn}/{bus.maxTurns}
            </span>
          </div>
          <div className="ev-bus-body">
            <strong>{bus.subject}</strong>
            <p>{renderInline(bus.body)}</p>
          </div>
        </div>
      );
    }
  }
});

export function DiffView({ diff }: { diff: FileDiff }) {
  return (
    <div className="diff">
      <div className="diff-head">
        <Icon name="file" size={14} />
        <span className="diff-path">{diff.path}</span>
        <span className="diff-stat">
          <span className="add">+{diff.additions}</span> <span className="del">−{diff.deletions}</span>
        </span>
      </div>
      {diff.hunks.map((h, i) => (
        <div key={i} className="diff-hunk">
          {h.header && <div className="diff-hunk-head">{h.header}</div>}
          <table>
            <tbody>
              {h.lines.map((l, j) => (
                <tr key={j} className={`dl dl-${l.kind}`}>
                  <td className="ln">{l.oldNo ?? ""}</td>
                  <td className="ln">{l.newNo ?? ""}</td>
                  <td className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</td>
                  <td className="code">{l.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

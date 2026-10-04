import { memo, useMemo } from "react";
import type { BusMessage, CockpitState, PermissionRequest, Session, SessionEvent, ToolKind } from "../daemon/types";
import { harnessInfo } from "../daemon/vendors";
import { diffTexts } from "../lib/diff";
import { BUS_TOOL_LABEL, roleLabel } from "../lib/labels";
import { formatClock } from "../lib/format";
import { renderInline } from "../lib/inline";
import { Icon, type IconName } from "./Icon";
import { RequestCard } from "./RequestCard";
import { vendorStyle } from "./VendorBadge";

const TOOL_ICON: Record<ToolKind, IconName> = {
  read: "file",
  search: "search",
  edit: "edit",
  delete: "x",
  move: "arrowRight",
  execute: "execute",
  think: "info",
  fetch: "globe",
  other: "shield",
  bus: "bus",
};

interface Props {
  session: Session;
  state: CockpitState;
  now: number;
  onApprove: (requestId: string) => void;
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
  onApprove: (requestId: string) => void;
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
                <span className="vmono">{harnessInfo(session.vendor, session.harness).mono}</span>
                {harnessInfo(session.vendor, session.harness).label}
                <span className="muted">{roleLabel(session.role)}</span>
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
      return <DiffView path={ev.path} oldText={ev.oldText} newText={ev.newText} />;
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
          session={session}
          now={now}
          inline
          showShortcuts
          onApprove={() => onApprove(request.id)}
          onDeny={() => onDeny(request.id)}
        />
      ) : null;
    case "bus": {
      if (!bus) return null;
      const outgoing = bus.from.kind === "session" && bus.from.sessionId === session.id;
      const other = outgoing ? bus.to : bus.from;
      const otherLabel =
        other.kind === "session"
          ? `${harnessInfo(other.vendor).label} ${roleLabel(other.role).toLowerCase()}`
          : other.kind === "human"
            ? "you"
            : "agentuxd";
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

/**
 * A file edit. agentuxd sends whole texts; the line diff is computed here.
 * Without an old text (a new file) every line shows as added.
 */
export function DiffView({ path, oldText, newText }: { path: string; oldText?: string; newText: string }) {
  const diff = useMemo(() => diffTexts(oldText, newText), [oldText, newText]);
  return (
    <div className="diff">
      <div className="diff-head">
        <Icon name="file" size={14} />
        <span className="diff-path">{path}</span>
        {oldText == null && <span className="muted">new file</span>}
        {diff.newOnly && <span className="muted">too large to diff; new content</span>}
        <span className="diff-stat">
          <span className="add">+{diff.additions}</span> <span className="del">−{diff.deletions}</span>
        </span>
      </div>
      {diff.hunks.length === 0 && <div className="diff-hunk-head">No changes</div>}
      {diff.hunks.map((h, i) => (
        <div key={i} className="diff-hunk">
          {diff.hunks.length > 1 && h.header && <div className="diff-hunk-head">{h.header}</div>}
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

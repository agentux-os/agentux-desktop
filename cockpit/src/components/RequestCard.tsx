import type { PermissionRequest, Run } from "../daemon/types";
import { REQUEST_LABEL, ROLE_LABEL, STEP_LABEL, runRef } from "../lib/labels";
import { formatAgo } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { VendorBadge } from "./VendorBadge";

const KIND_ICON: Record<PermissionRequest["kind"], IconName> = {
  plan: "plan",
  step: "shield",
  command: "execute",
  edit: "edit",
  network: "globe",
  question: "question",
  budget: "coins",
};

const OUTCOME: Record<PermissionRequest["status"], (answer?: string) => string> = {
  pending: () => "Pending",
  approved: () => "Approved",
  denied: () => "Denied",
  answered: (a) => `Answered: ${a ?? ""}`,
  cancelled: () => "Cancelled with the run",
};

interface Props {
  request: PermissionRequest;
  run?: Run;
  now: number;
  selected?: boolean;
  /** Hide project/run context (used inside a session view). */
  inline?: boolean;
  showShortcuts?: boolean;
  onApprove: (answer?: string) => void;
  onDeny: () => void;
  onOpen?: () => void;
}

/** One permission request or question, identical for every vendor. */
export function RequestCard({ request: r, run, now, selected, inline, showShortcuts, onApprove, onDeny, onOpen }: Props) {
  const pending = r.status === "pending";
  return (
    <article
      className={`req ${pending ? "is-pending" : "is-resolved"} ${selected ? "is-selected" : ""}`}
      aria-current={selected || undefined}
    >
      <header className="req-head">
        <span className="req-kind">
          <Icon name={KIND_ICON[r.kind]} size={14} />
          {REQUEST_LABEL[r.kind]}
        </span>
        {r.vendor && <VendorBadge vendor={r.vendor} compact />}
        {r.role ? (
          <span className="muted">{ROLE_LABEL[r.role]}</span>
        ) : (
          r.step && <span className="muted">{STEP_LABEL[r.step]} step</span>
        )}
        <span className="req-age">{formatAgo(r.createdAt, now)}</span>
      </header>
      {!inline && run && (
        <button className="req-run" onClick={onOpen} title="Open run">
          <span className="mono muted">{runRef(run)}</span> {run.title}
          <span className="muted"> · {run.projectId}</span>
        </button>
      )}
      <pre className={`req-detail ${r.kind === "question" ? "is-prose" : ""}`}>{r.detail}</pre>
      {pending ? (
        <div className="req-actions">
          {r.kind === "question" && r.options ? (
            r.options.map((o, i) => (
              <button key={o} className={i === 0 ? "btn btn-primary" : "btn"} onClick={() => onApprove(o)}>
                {o}
                {showShortcuts && <kbd>{i === 0 ? "A" : i + 1}</kbd>}
              </button>
            ))
          ) : (
            <button className="btn btn-primary" onClick={() => onApprove()}>
              <Icon name="check" size={14} /> Approve {showShortcuts && <kbd>A</kbd>}
            </button>
          )}
          <button className="btn btn-quiet" onClick={onDeny}>
            {r.kind === "question" ? "Dismiss" : "Deny"} {showShortcuts && <kbd>D</kbd>}
          </button>
        </div>
      ) : (
        <div className={`req-outcome is-${r.status}`}>
          <Icon name={r.status === "denied" || r.status === "cancelled" ? "x" : "check"} size={14} />
          {OUTCOME[r.status](r.answer)}
          {r.resolvedAt && <span className="muted"> · {formatAgo(r.resolvedAt, now)}</span>}
        </div>
      )}
    </article>
  );
}

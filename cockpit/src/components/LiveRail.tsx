import type { CockpitState, PermissionRequest } from "../daemon/types";
import { BusItem } from "./BusItem";
import { Icon } from "./Icon";
import { RequestCard } from "./RequestCard";

/** Right-hand rail on the board: what needs you, and what agents are saying. */
export function LiveRail({
  state,
  now,
  projectId,
  pending,
  onApprove,
  onDeny,
  onOpenRun,
  onInbox,
  onBus,
}: {
  state: CockpitState;
  now: number;
  projectId: string | null;
  pending: PermissionRequest[];
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
  onOpenRun: (runId: string) => void;
  onInbox: () => void;
  onBus: () => void;
}) {
  const scoped = pending.filter((r) => projectId === null || r.projectId === projectId);
  const bus = state.bus.filter((m) => projectId === null || m.projectId === projectId).slice(-12).reverse();
  return (
    <aside className="rail">
      <section className="rail-section">
        <header className="rail-head">
          <Icon name="inbox" size={14} />
          Waiting for you
          <span className={`nav-count ${scoped.length ? "attention" : ""}`}>{scoped.length}</span>
          <button className="link-btn rail-more" onClick={onInbox}>
            Inbox <kbd>I</kbd>
          </button>
        </header>
        {scoped.length === 0 && <div className="rail-empty">Nothing needs you right now.</div>}
        {scoped.slice(0, 2).map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            run={state.runs[r.runId]}
            session={r.sessionId ? state.sessions[r.sessionId] : undefined}
            now={now}
            onApprove={() => onApprove(r.id)}
            onDeny={() => onDeny(r.id)}
            onOpen={() => onOpenRun(r.runId)}
          />
        ))}
        {scoped.length > 2 && (
          <button className="link-btn rail-overflow" onClick={onInbox}>
            +{scoped.length - 2} more in the inbox
          </button>
        )}
      </section>
      <section className="rail-section rail-bus">
        <header className="rail-head">
          <Icon name="bus" size={14} />
          Agent bus
          <span className="live-dot" title="Live" />
          <button className="link-btn rail-more" onClick={onBus}>
            All <kbd>M</kbd>
          </button>
        </header>
        <div className="rail-scroll">
          {bus.map((m) => (
            <BusItem key={m.id} msg={m} run={state.runs[m.runId]} compact onOpen={() => onOpenRun(m.runId)} />
          ))}
        </div>
      </section>
    </aside>
  );
}

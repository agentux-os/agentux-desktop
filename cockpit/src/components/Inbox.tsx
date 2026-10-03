import type { CockpitState, PermissionRequest } from "../daemon/types";
import { Icon } from "./Icon";
import { RequestCard } from "./RequestCard";

interface Props {
  state: CockpitState;
  now: number;
  pending: PermissionRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApprove: (requestId: string, answer?: string) => void;
  onDeny: (requestId: string) => void;
  onOpenRun: (runId: string) => void;
}

/** Every permission request and question from every agent, in one queue. */
export function Inbox({ state, now, pending, selectedId, onSelect, onApprove, onDeny, onOpenRun }: Props) {
  const resolved = Object.values(state.requests)
    .filter((r) => r.status !== "pending")
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    .slice(0, 8);

  return (
    <div className="page">
      <div className="page-intro">
        <p>
          Permission requests and questions from every agent and vendor land here, oldest first.
          <span className="kbd-hints">
            <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>D</kbd> deny · <kbd>Enter</kbd> open run
          </span>
        </p>
      </div>
      {pending.length === 0 ? (
        <div className="empty-state">
          <Icon name="check" size={28} />
          <strong>Inbox zero</strong>
          <span className="muted">Agents will ask here when they need you.</span>
        </div>
      ) : (
        <div className="req-list">
          {pending.map((r) => (
            <div key={r.id} onMouseDown={() => onSelect(r.id)}>
              <RequestCard
                request={r}
                run={state.runs[r.runId]}
                now={now}
                selected={r.id === selectedId}
                showShortcuts={r.id === selectedId}
                onApprove={(a) => onApprove(r.id, a)}
                onDeny={() => onDeny(r.id)}
                onOpen={() => onOpenRun(r.runId)}
              />
            </div>
          ))}
        </div>
      )}
      {resolved.length > 0 && (
        <>
          <h3 className="section-title">Recently resolved</h3>
          <div className="req-list">
            {resolved.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                run={state.runs[r.runId]}
                now={now}
                onApprove={() => undefined}
                onDeny={() => undefined}
                onOpen={() => onOpenRun(r.runId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

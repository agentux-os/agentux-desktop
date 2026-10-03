import type { CockpitState, PermissionRequest, Run, StepKind } from "../daemon/types";
import { STEPS } from "../daemon/types";
import { formatDuration, formatUsd } from "../lib/format";
import { REQUEST_LABEL, STEP_LABEL } from "../lib/labels";
import { Icon } from "./Icon";
import { VendorBadge } from "./VendorBadge";

type ColumnId = StepKind | "waiting" | "done";

// "Waiting for you" leads: it is the only column that needs the human.
const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "waiting", label: "Waiting for you" },
  ...STEPS.map((s) => ({ id: s as ColumnId, label: STEP_LABEL[s] })),
  { id: "done", label: "Done" },
];

const DONE_LIMIT = 6;

function columnOf(run: Run): ColumnId {
  if (run.status === "done" || run.status === "failed") return "done";
  if (run.status === "waiting") return "waiting";
  return run.step;
}

interface Props {
  state: CockpitState;
  projectId: string | null;
  selectedRunId: string | null;
  now: number;
  onSelectRun: (id: string) => void;
}

export function RunBoard({ state, projectId, selectedRunId, now, onSelectRun }: Props) {
  const runs = Object.values(state.runs).filter((r) => projectId === null || r.projectId === projectId);
  const pendingByRun = new Map<string, PermissionRequest>();
  for (const r of Object.values(state.requests)) {
    if (r.status === "pending" && !pendingByRun.has(r.runId)) pendingByRun.set(r.runId, r);
  }

  return (
    <div className="board" role="list">
      {COLUMNS.map((col) => {
        let items = runs.filter((r) => columnOf(r) === col.id);
        items =
          col.id === "done"
            ? items.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
            : items.sort((a, b) => a.startedAt - b.startedAt);
        const hidden = col.id === "done" ? Math.max(0, items.length - DONE_LIMIT) : 0;
        if (hidden) items = items.slice(0, DONE_LIMIT);
        return (
          <section key={col.id} className={`col col-${col.id}`} role="listitem" aria-label={col.label}>
            <header className="col-head">
              <span className="col-title">{col.label}</span>
              <span className="col-count">{items.length + hidden}</span>
            </header>
            <div className="col-body">
              {items.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  now={now}
                  showProject={projectId === null}
                  pending={pendingByRun.get(run.id)}
                  selected={run.id === selectedRunId}
                  onClick={() => onSelectRun(run.id)}
                />
              ))}
              {items.length === 0 && <div className="col-empty">{col.id === "waiting" ? "Nothing needs you" : "—"}</div>}
              {hidden > 0 && <div className="col-more">+{hidden} earlier</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RunCard({
  run,
  now,
  showProject,
  pending,
  selected,
  onClick,
}: {
  run: Run;
  now: number;
  showProject: boolean;
  pending?: PermissionRequest;
  selected: boolean;
  onClick: () => void;
}) {
  const done = run.status === "done";
  const elapsed = (run.finishedAt ?? now) - run.startedAt;
  const failedCheck = run.checks.find((c) => c.status === "failed");
  return (
    <button className={`card status-${run.status} ${selected ? "is-selected" : ""}`} onClick={onClick}>
      <div className="card-top">
        <span className="mono muted">#{run.issue}</span>
        {showProject && <span className="card-project">{run.projectId}</span>}
        <span className="card-time" title={done ? "Duration" : "Elapsed"}>
          {formatDuration(elapsed)}
        </span>
      </div>
      <div className="card-title">{run.title}</div>
      {pending ? (
        <div className="card-activity attention">
          <Icon name="shield" size={13} />
          {REQUEST_LABEL[pending.kind]}
          <span className="muted"> · {STEP_LABEL[run.step]}</span>
        </div>
      ) : done && run.pullRequest ? (
        <div className="card-activity ok">
          <Icon name="pr" size={13} />
          PR #{run.pullRequest.number}
        </div>
      ) : (
        <div className={`card-activity ${failedCheck ? "err" : ""}`}>
          <span className="pulse" />
          <span className="ellipsis">{run.activity}</span>
        </div>
      )}
      <div className="card-foot">
        <span className="card-roles" title="Implementer → reviewer">
          <VendorBadge vendor={run.roles.implementer} role="implementer" compact />
          <Icon name="arrowRight" size={11} className="muted" />
          <VendorBadge vendor={run.roles.reviewer} role="reviewer" compact />
        </span>
        {!done && run.gateAttempt > 1 && (
          <span className="chip" title="Gate attempt">
            gate {run.gateAttempt}/{run.gateMaxAttempts}
          </span>
        )}
        {!done && run.reviewRound > 1 && (
          <span className="chip" title="Review round">
            round {run.reviewRound}/{run.reviewMaxRounds}
          </span>
        )}
        <span className="card-cost">{formatUsd(run.usage.costUsd)}</span>
      </div>
    </button>
  );
}

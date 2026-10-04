import { useState } from "react";
import type { PermissionRequest, Run, Session } from "../daemon/types";
import { REQUEST_LABEL, STEP_LABEL, roleLabel, runRef } from "../lib/labels";
import { formatAgo, formatUsd } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { VendorBadge } from "./VendorBadge";

const KIND_ICON: Record<PermissionRequest["kind"], IconName> = {
  plan: "plan",
  step: "shield",
  permission: "execute",
  budget: "coins",
  question: "question",
};

/** Button labels per kind: what approving and denying actually do in agentuxd. */
const ACTIONS: Record<PermissionRequest["kind"], { approve: string; deny: string; denyTitle: string }> = {
  plan: { approve: "Approve plan", deny: "Reject", denyTitle: "Rejecting fails the run" },
  step: { approve: "Approve", deny: "Reject", denyTitle: "Rejecting fails the run" },
  permission: { approve: "Allow", deny: "Deny", denyTitle: "The agent is told no and goes on" },
  budget: { approve: "Extend budget", deny: "Stop run", denyTitle: "Stopping fails the run" },
  question: { approve: "Answer", deny: "Decline", denyTitle: "The agent is told you declined to answer and goes on" },
};

/** Options the number keys pick (1-9). */
export const MAX_OPTION_KEYS = 9;

function outcome(r: PermissionRequest): string {
  switch (r.status) {
    case "pending":
      return "Pending";
    case "approved":
      return r.kind === "permission" ? "Allowed" : r.kind === "budget" ? "Budget extended" : r.kind === "question" ? "Answered" : "Approved";
    case "denied":
      return r.kind === "permission" ? "Denied" : r.kind === "budget" ? "Run stopped" : r.kind === "question" ? "Declined" : "Rejected";
    case "cancelled":
      return r.kind === "permission"
        ? "No longer asked (turn over or run cancelled)"
        : r.kind === "question"
          ? "No longer asked (run ended or daemon restarted)"
          : "Cancelled with the run";
  }
}

interface Props {
  request: PermissionRequest;
  run?: Run;
  /** The session that asked, for `permission` and `question` requests. */
  session?: Session;
  now: number;
  selected?: boolean;
  /** Hide project/run context (used inside a session view). */
  inline?: boolean;
  showShortcuts?: boolean;
  /** For a `question`, called with the answer (an option or free text). */
  onApprove: (answer?: string) => void;
  onDeny: () => void;
  onOpen?: () => void;
}

/** One approval request, identical for every vendor. */
export function RequestCard({ request: r, run, session, now, selected, inline, showShortcuts, onApprove, onDeny, onOpen }: Props) {
  const pending = r.status === "pending";
  const actions = ACTIONS[r.kind];
  return (
    <article
      className={`req req-${r.kind} ${pending ? "is-pending" : "is-resolved"} ${selected ? "is-selected" : ""}`}
      aria-current={selected || undefined}
    >
      <header className="req-head">
        <span className="req-kind">
          <Icon name={KIND_ICON[r.kind]} size={14} />
          {REQUEST_LABEL[r.kind]}
        </span>
        {session ? (
          <>
            <VendorBadge vendor={session.vendor} harness={session.harness} compact />
            <span className="muted">
              {roleLabel(session.role)} · {STEP_LABEL[r.step]} step
            </span>
          </>
        ) : (
          <span className="muted">{STEP_LABEL[r.step]} step</span>
        )}
        <span className="req-age">{formatAgo(r.createdAt, now)}</span>
      </header>
      {!inline && run && (
        <button className="req-run" onClick={onOpen} title="Open run">
          <span className="mono muted">{runRef(run)}</span> {run.title}
          <span className="muted"> · {run.projectId}</span>
        </button>
      )}
      <div className="req-title">{r.title}</div>
      {r.kind === "budget" && pending && run && <BudgetMeter run={run} />}
      {r.detail && <pre className={`req-detail ${r.kind === "budget" ? "is-prose" : ""}`}>{r.detail}</pre>}
      {pending && r.kind === "question" ? (
        <QuestionAnswer request={r} showShortcuts={showShortcuts} onAnswer={onApprove} onDecline={onDeny} />
      ) : pending ? (
        <div className="req-actions">
          <button className="btn btn-primary" onClick={() => onApprove()}>
            <Icon name="check" size={14} /> {actions.approve} {showShortcuts && <kbd>A</kbd>}
          </button>
          <button className="btn btn-quiet" onClick={onDeny} title={actions.denyTitle}>
            {actions.deny} {showShortcuts && <kbd>D</kbd>}
          </button>
        </div>
      ) : (
        <div className={`req-outcome is-${r.status}`}>
          <Icon name={r.status === "approved" ? "check" : "x"} size={14} />
          {outcome(r)}
          {r.answer && <span className="muted"> · “{r.answer}”</span>}
          {r.resolvedAt && <span className="muted"> · {formatAgo(r.resolvedAt, now)}</span>}
        </div>
      )}
    </article>
  );
}

/**
 * Answering an agent's question: one button per suggested option (keys 1-9
 * when the card has focus), or a free-text answer. Declining tells the agent
 * the human declined; the run goes on either way.
 */
function QuestionAnswer({
  request: r,
  showShortcuts,
  onAnswer,
  onDecline,
}: {
  request: PermissionRequest;
  showShortcuts?: boolean;
  onAnswer: (answer: string) => void;
  onDecline: () => void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const answer = text.trim();
    if (answer) onAnswer(answer);
  };
  return (
    <div className="req-question">
      {r.options.length > 0 && (
        <div className="req-options" role="group" aria-label="Suggested answers">
          {r.options.map((option, i) => (
            <button key={`${i}-${option}`} className="btn req-option" onClick={() => onAnswer(option)} title={`Answer “${option}”`}>
              {showShortcuts && i < MAX_OPTION_KEYS && <kbd>{i + 1}</kbd>} {option}
            </button>
          ))}
        </div>
      )}
      <form
        className="req-answer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="req-answer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={r.options.length ? "Or type another answer" : "Type your answer"}
          aria-label="Answer"
        />
        <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
          <Icon name="send" size={14} /> Answer
        </button>
        <button className="btn btn-quiet" type="button" onClick={onDecline} title={ACTIONS.question.denyTitle}>
          Decline {showShortcuts && <kbd>D</kbd>}
        </button>
      </form>
    </div>
  );
}

/** Spent vs budget of the run, as agentuxd reports them (costUsd / budgetUsd). */
function BudgetMeter({ run }: { run: Run }) {
  const budget = run.budgetUsd ?? 0;
  const ratio = budget > 0 ? Math.min(1, run.costUsd / budget) : 1;
  return (
    <div className="budget" title="Spent by the run's sessions / budget">
      <span className="budget-figures">
        <strong>{formatUsd(run.costUsd)}</strong> spent of {formatUsd(budget)}
      </span>
      <span className={`budget-bar ${run.costUsd > budget ? "is-over" : ""}`}>
        <i style={{ width: `${ratio * 100}%` }} />
      </span>
    </div>
  );
}

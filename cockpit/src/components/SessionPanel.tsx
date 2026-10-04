import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BusMessage, BusPostInput, CockpitState, Run, Session } from "../daemon/types";
import { STEPS } from "../daemon/types";
import { harnessInfo } from "../daemon/vendors";
import { groupBus } from "../lib/bus";
import { formatDuration, formatTokens, formatUsd } from "../lib/format";
import { STEP_LABEL, roleLabel, runRef } from "../lib/labels";
import { BusComposer } from "./BusComposer";
import { BusGroupView } from "./BusFeed";
import { Icon } from "./Icon";
import { SessionEvents } from "./SessionEvents";
import { VendorBadge, vendorStyle } from "./VendorBadge";

const ROLE_ORDER: readonly string[] = ["planner", "implementer", "reviewer"];

/** The run's sessions: pipeline roles first, then by start (a restart opens a new session per role). */
function runSessions(run: Run, state: CockpitState): Session[] {
  const rank = (s: Session) => {
    const i = ROLE_ORDER.indexOf(s.role);
    return i < 0 ? ROLE_ORDER.length : i;
  };
  return Object.values(state.sessions)
    .filter((s) => s.runId === run.id)
    .sort((a, b) => rank(a) - rank(b) || a.startedAt - b.startedAt);
}

interface Props {
  run: Run;
  state: CockpitState;
  now: number;
  sessionId: string | null;
  onSession: (id: string) => void;
  terminal: boolean;
  onTerminal: (open: boolean) => void;
  onClose: () => void;
  onApprove: (requestId: string, answer?: string) => void;
  onDeny: (requestId: string) => void;
  onSend: (sessionId: string, text: string) => void;
  /** Why the human cannot prompt sessions (the daemon has no `sessions.prompt`); absent when they can. */
  sendDisabled?: string;
  /** Cancels the run; absent when the client cannot (mock data). */
  onCancel?: () => void;
  mode: "mock" | "daemon";
  /** Posts the human's message on the run's bus; resolves true once taken. */
  onPost: (input: BusPostInput) => Promise<boolean>;
}

export function SessionPanel(props: Props) {
  const { run, state, now, terminal, onTerminal, onClose, onCancel } = props;
  const sessions = runSessions(run, state);
  const session = sessions.find((s) => s.id === props.sessionId) ?? defaultSession(run, sessions);
  const project = state.projects.find((p) => p.id === run.projectId);
  const [busTab, setBusTab] = useState(false);
  const busCount = useMemo(() => state.bus.filter((m) => m.runId === run.id).length, [state.bus, run.id]);

  return (
    <aside className="panel" aria-label={`Run ${run.title}`}>
      <header className="panel-head">
        <div className="panel-title-row">
          <h2 className="panel-title">{run.title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="panel-meta">
          <span className="mono">{runRef(run)}</span>
          <span>
            <Icon name="folder" size={13} /> {project?.name}
          </span>
          {run.branch && (
            <span className="mono">
              <Icon name="branch" size={13} /> {run.branch}
            </span>
          )}
          <span>{formatDuration((run.finishedAt ?? now) - run.startedAt)}</span>
          <span
            className={run.budgetUsd != null && run.costUsd > run.budgetUsd ? "is-over-budget" : undefined}
            title="Run cost: the sum of what its sessions reported (harnesses that do not report cost count as $0)"
          >
            <Icon name="coins" size={13} /> {formatUsd(run.costUsd)}
            {run.budgetUsd != null && <span className="muted"> / {formatUsd(run.budgetUsd)} budget</span>}
          </span>
          {run.pullRequest && (
            <a className="pr-link" href={run.pullRequest.url} target="_blank" rel="noreferrer">
              <Icon name="pr" size={13} /> PR #{run.pullRequest.number}
            </a>
          )}
        </div>
        <Pipeline run={run} />
        {run.error && <div className="panel-error">{run.error}</div>}
        {onCancel && (run.status === "running" || run.status === "waiting") && (
          <div className="panel-actions">
            <button className="btn btn-quiet" onClick={onCancel}>
              <Icon name="x" size={14} /> Cancel run
            </button>
          </div>
        )}
      </header>

      <div className="tabs" role="tablist">
        {sessions.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={!busTab && s.id === session?.id}
            className={`tab ${!busTab && s.id === session?.id ? "is-active" : ""}`}
            style={vendorStyle(s.vendor)}
            onClick={() => {
              setBusTab(false);
              props.onSession(s.id);
            }}
          >
            <span className="vmono">{harnessInfo(s.vendor, s.harness).mono}</span>
            {roleLabel(s.role)}
            <span className={`state-dot state-${s.state}`} title={s.state} />
          </button>
        ))}
        <button
          role="tab"
          aria-selected={busTab}
          className={`tab tab-bus ${busTab ? "is-active" : ""}`}
          onClick={() => setBusTab(true)}
          title="The run's agent bus: read it and post to its agents"
        >
          <Icon name="bus" size={13} /> Bus
          {busCount > 0 && <span className="muted">{busCount}</span>}
        </button>
        <span className="tabs-spacer" />
        {session && !busTab && (
          <div className="seg" role="group" aria-label="Session view mode">
            <button className={!terminal ? "is-on" : ""} onClick={() => onTerminal(false)}>
              Structured
            </button>
            <button className={terminal ? "is-on" : ""} onClick={() => onTerminal(true)} title="Open terminal (T)">
              <Icon name="terminal" size={13} /> Terminal
            </button>
          </div>
        )}
      </div>

      {busTab ? (
        <RunBus run={run} state={state} mode={props.mode} onPost={props.onPost} />
      ) : session ? (
        <>
          <div className="session-bar">
            <VendorBadge vendor={session.vendor} harness={session.harness} />
            {session.model && <span className="mono muted">{session.model}</span>}
            <span className="mono muted ellipsis" title={session.cwd}>
              {session.cwd}
            </span>
            <SessionUsageView session={session} />
          </div>
          {terminal ? (
            <TerminalPlaceholder session={session} />
          ) : (
            <EventScroller session={session} {...props} />
          )}
          <Composer session={session} onSend={props.onSend} disabledReason={props.sendDisabled} />
        </>
      ) : (
        <div className="empty">
          {run.prompt ? (
            <>
              No harness sessions reported for this run yet.
              <pre className="run-prompt">{run.prompt}</pre>
            </>
          ) : (
            "No session yet."
          )}
        </div>
      )}
    </aside>
  );
}

/** The run's bus log (newest activity first) with the human's composer. */
function RunBus({
  run,
  state,
  mode,
  onPost,
}: {
  run: Run;
  state: CockpitState;
  mode: "mock" | "daemon";
  onPost: (input: BusPostInput) => Promise<boolean>;
}) {
  const [replyTo, setReplyTo] = useState<BusMessage | undefined>();
  const groups = useMemo(() => groupBus(state.bus.filter((m) => m.runId === run.id)), [state.bus, run.id]);
  return (
    <>
      <div className="scroller run-bus">
        {groups.map((g) => (
          <BusGroupView key={g.key} group={g} state={state} onReply={setReplyTo} />
        ))}
        {groups.length === 0 && <div className="empty">Nothing on this run&apos;s bus yet.</div>}
      </div>
      <BusComposer
        state={state}
        mode={mode}
        runs={[run]}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(undefined)}
        onPost={onPost}
      />
    </>
  );
}

function defaultSession(run: Run, sessions: Session[]): Session | undefined {
  const byStep: Record<string, string> = { plan: "planner", review: "reviewer" };
  const role = byStep[run.step] ?? "implementer";
  const id = run.sessions[role];
  return sessions.find((s) => s.id === id) ?? [...sessions].reverse().find((s) => s.role === role) ?? sessions[sessions.length - 1];
}

/** Context-window fill and cost, as ACP reports them (no input/output token counts). */
function SessionUsageView({ session }: { session: Session }) {
  const { usedTokens, contextTokens, costUsd } = session.usage;
  const pct = contextTokens > 0 ? Math.round((usedTokens / contextTokens) * 100) : undefined;
  return (
    <span className="session-usage" title="Tokens in the context window / its size, and the session's cost as reported by the harness">
      {contextTokens > 0 ? (
        <>
          {formatTokens(usedTokens)} / {formatTokens(contextTokens)} ctx <span className="muted">({pct}%)</span>
        </>
      ) : (
        <span className="muted">no usage yet</span>
      )}
      {" · "}
      {costUsd != null ? formatUsd(costUsd) : <span className="muted">cost not reported</span>}
    </span>
  );
}

function EventScroller({ session, state, now, onApprove, onDeny }: Props & { session: Session }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = session.events.length;

  useLayoutEffect(() => {
    stick.current = true;
  }, [session.id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, session.id, session.events]);

  return (
    <div
      className="scroller"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      <SessionEvents session={session} state={state} now={now} onApprove={onApprove} onDeny={onDeny} />
    </div>
  );
}

function Pipeline({ run }: { run: Run }) {
  const steps = run.steps?.length ? run.steps : STEPS;
  const current = run.steps?.length && run.stepIndex != null ? run.stepIndex : steps.indexOf(run.step);
  const done = run.status === "done";
  return (
    <ol className="pipeline">
      {steps.map((step, i) => {
        const state = done || i < current ? "done" : i === current ? (run.status === "waiting" ? "waiting" : "current") : "todo";
        let extra = "";
        if (step === "gate" && run.gateAttempt > 0) extra = `${run.gateAttempt}/${run.gateMaxAttempts}`;
        if (step === "review" && run.reviewRound > 0) extra = `${run.reviewRound}/${run.reviewMaxRounds}`;
        return (
          <li key={`${i}-${step}`} className={`pipe pipe-${state}`}>
            <span className="pipe-dot">{state === "done" ? <Icon name="check" size={10} /> : null}</span>
            <span className="pipe-label">{STEP_LABEL[step]}</span>
            {extra && <span className="pipe-extra">{extra}</span>}
            {step === "gate" && run.gateAttempt > 0 && (
              <span className="checks">
                {run.checks.map((c) => (
                  <span key={c.name} className={`check check-${c.status}`} title={`${c.command}: ${c.status}`}>
                    {c.name}
                  </span>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function TerminalPlaceholder({ session }: { session: Session }) {
  const info = harnessInfo(session.vendor, session.harness);
  const bin = session.vendor
    ? { "claude-code": "claude", codex: "codex", opencode: "opencode", antigravity: "agy" }[session.vendor]
    : session.harness;
  return (
    <div className="term">
      <div className="term-bar">
        <span className="term-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="mono">
          {bin} — {session.cwd}
        </span>
      </div>
      <div className="term-body mono">
        <div className="muted">$ {bin} --resume {session.id}</div>
        <div style={vendorStyle(session.vendor)} className="term-accent">
          ╭─ {info.label} ──────────────────────────────
        </div>
        <div className="term-note">
          <Icon name="terminal" size={18} />
          <div>
            <strong>Terminal mode attaches {info.label}&apos;s own TUI to this same session.</strong>
            <p>
              The embedded PTY is owned by <code>agentuxd</code>, so switching between structured and terminal views never
              restarts the agent. It is not available yet.
            </p>
          </div>
        </div>
        <div className="term-cursor">▍</div>
      </div>
    </div>
  );
}

function Composer({
  session,
  onSend,
  disabledReason,
}: {
  session: Session;
  onSend: (sessionId: string, text: string) => void;
  disabledReason?: string;
}) {
  const [text, setText] = useState("");
  const ended = session.state === "ended" || !!disabledReason;
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(session.id, t);
    setText("");
  };
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        rows={1}
        value={text}
        disabled={ended}
        placeholder={
          ended ? (disabledReason ?? "Session ended") : `Message the ${roleLabel(session.role).toLowerCase()} (${harnessInfo(session.vendor, session.harness).label})…`
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <button className="btn btn-primary" type="submit" disabled={ended || !text.trim()} title="Send (Enter)">
        <Icon name="send" size={14} />
      </button>
    </form>
  );
}

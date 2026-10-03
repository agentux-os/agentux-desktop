import { useLayoutEffect, useRef, useState } from "react";
import type { CockpitState, Role, Run, Session } from "../daemon/types";
import { STEPS } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { formatDuration, formatTokens, formatUsd } from "../lib/format";
import { ROLE_LABEL, STEP_LABEL } from "../lib/labels";
import { Icon } from "./Icon";
import { SessionEvents } from "./SessionEvents";
import { VendorBadge, vendorStyle } from "./VendorBadge";

const ROLE_ORDER: Role[] = ["planner", "implementer", "reviewer"];

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
}

export function SessionPanel(props: Props) {
  const { run, state, now, terminal, onTerminal, onClose } = props;
  const sessions = ROLE_ORDER.map((r) => run.sessions[r]).filter((id): id is string => !!id).map((id) => state.sessions[id]);
  const session = sessions.find((s) => s.id === props.sessionId) ?? defaultSession(run, sessions);
  const project = state.projects.find((p) => p.id === run.projectId);

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
          <span className="mono">#{run.issue}</span>
          <span>
            <Icon name="folder" size={13} /> {project?.name}
          </span>
          <span className="mono">
            <Icon name="branch" size={13} /> {run.branch}
          </span>
          <span>{formatDuration((run.finishedAt ?? now) - run.startedAt)}</span>
          <span title={`Budget ${formatUsd(run.budgetUsd)} per run`}>
            {formatUsd(run.usage.costUsd)} <span className="muted">/ {formatUsd(run.budgetUsd)}</span>
          </span>
          {run.pullRequest && (
            <a className="pr-link" href={run.pullRequest.url} target="_blank" rel="noreferrer">
              <Icon name="pr" size={13} /> PR #{run.pullRequest.number}
            </a>
          )}
        </div>
        <Pipeline run={run} />
      </header>

      <div className="tabs" role="tablist">
        {sessions.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === session?.id}
            className={`tab ${s.id === session?.id ? "is-active" : ""}`}
            style={vendorStyle(s.vendor)}
            onClick={() => props.onSession(s.id)}
          >
            <span className="vmono">{VENDOR_INFO[s.vendor].mono}</span>
            {ROLE_LABEL[s.role]}
            <span className={`state-dot state-${s.state}`} title={s.state} />
          </button>
        ))}
        <span className="tabs-spacer" />
        {session && (
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

      {session ? (
        <>
          <div className="session-bar">
            <VendorBadge vendor={session.vendor} />
            <span className="mono muted">{session.model}</span>
            <span className="mono muted ellipsis" title={session.cwd}>
              {session.cwd}
            </span>
            <span className="session-usage" title="Session tokens (in / out) and cost">
              {formatTokens(session.usage.input)} in · {formatTokens(session.usage.output)} out · {formatUsd(session.usage.costUsd)}
            </span>
          </div>
          {terminal ? (
            <TerminalPlaceholder session={session} />
          ) : (
            <EventScroller session={session} {...props} />
          )}
          <Composer session={session} onSend={props.onSend} />
        </>
      ) : (
        <div className="empty">No session yet.</div>
      )}
    </aside>
  );
}

function defaultSession(run: Run, sessions: Session[]): Session | undefined {
  const byStep: Record<string, Role> = { plan: "planner", review: "reviewer" };
  const role = byStep[run.step] ?? "implementer";
  return sessions.find((s) => s.role === role) ?? sessions[sessions.length - 1];
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
  const current = STEPS.indexOf(run.step);
  const done = run.status === "done";
  return (
    <ol className="pipeline">
      {STEPS.map((step, i) => {
        const state = done || i < current ? "done" : i === current ? (run.status === "waiting" ? "waiting" : "current") : "todo";
        let extra = "";
        if (step === "gate" && run.gateAttempt > 0) extra = `${run.gateAttempt}/${run.gateMaxAttempts}`;
        if (step === "review" && run.reviewRound > 0) extra = `${run.reviewRound}/${run.reviewMaxRounds}`;
        return (
          <li key={step} className={`pipe pipe-${state}`}>
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
  const info = VENDOR_INFO[session.vendor];
  const bin = { "claude-code": "claude", codex: "codex", opencode: "opencode", antigravity: "agy" }[session.vendor];
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
              restarts the agent. It is not available with the mock daemon.
            </p>
          </div>
        </div>
        <div className="term-cursor">▍</div>
      </div>
    </div>
  );
}

function Composer({ session, onSend }: { session: Session; onSend: (sessionId: string, text: string) => void }) {
  const [text, setText] = useState("");
  const ended = session.state === "ended";
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
        placeholder={ended ? "Session ended" : `Message the ${ROLE_LABEL[session.role].toLowerCase()} (${VENDOR_INFO[session.vendor].label})…`}
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

import { useEffect, useMemo, useState } from "react";
import type { BusMessage, BusPostInput, CockpitState, Run } from "../daemon/types";
import { busPostBlocked, busPostInput, busTargets } from "../lib/busPost";
import { runRef } from "../lib/labels";
import { BusEndpointLabel } from "./BusItem";
import { Icon } from "./Icon";

interface Props {
  state: CockpitState;
  mode: "mock" | "daemon";
  /** Runs the human may pick from (the bus page); with one run the picker is hidden. */
  runs: Run[];
  /** The message being answered, if any: the post goes to its sender, in its exchange. */
  replyTo?: BusMessage;
  onCancelReply: () => void;
  /** Resolves true once agentuxd took the post. */
  onPost: (input: BusPostInput) => Promise<boolean>;
}

/**
 * The human's voice on a run's bus (`bus.post`): pick the run, who gets the
 * message (a role, one session, or the whole run's channel), an optional
 * subject, and the text; or answer a message (`inReplyTo`). Disabled with the
 * reason shown when the daemon does not serve `bus.post` or the run is over.
 */
export function BusComposer({ state, mode, runs, replyTo, onCancelReply, onPost }: Props) {
  const [runId, setRunId] = useState<string | undefined>(runs[0]?.id);
  const [targetKey, setTargetKey] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // A reply belongs to the replied message's run; otherwise keep the chosen run while it is offered.
  const effectiveRunId = replyTo?.runId ?? (runs.some((r) => r.id === runId) ? runId : runs[0]?.id);
  const run = effectiveRunId ? state.runs[effectiveRunId] : undefined;
  const targets = useMemo(() => (run ? busTargets(run, state) : []), [run, state]);
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const blocked = busPostBlocked(mode, state.capabilities, run);
  const input = busPostInput(run?.id, target?.to, replyTo, body, subject);

  useEffect(() => {
    if (replyTo) document.querySelector<HTMLTextAreaElement>(".bus-composer textarea")?.focus();
  }, [replyTo]);

  const send = async () => {
    if (!input || blocked || sending) return;
    setSending(true);
    try {
      if (await onPost(input)) {
        setBody("");
        setSubject("");
        if (replyTo) onCancelReply();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className={`bus-composer ${blocked ? "is-blocked" : ""}`}
      aria-label="Post on the agent bus"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="bus-composer-row">
        <span className="bus-composer-from">
          <span className="bus-ep human">You</span>
          <Icon name="arrowRight" size={13} className="muted" />
        </span>
        {replyTo ? (
          <span className="bus-composer-reply" title={replyTo.body}>
            <BusEndpointLabel ep={replyTo.from} />
            <span className="muted">re #{replyTo.messageId}</span>
            <span className="ellipsis">{replyTo.subject}</span>
            <button type="button" className="icon-btn" onClick={onCancelReply} title="Stop replying">
              <Icon name="x" size={13} />
            </button>
          </span>
        ) : (
          <>
            {runs.length > 1 && (
              <select
                aria-label="Run"
                value={effectiveRunId ?? ""}
                onChange={(e) => {
                  setRunId(e.target.value);
                  setTargetKey("");
                }}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {runRef(r)} {r.title}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="To"
              value={target?.key ?? ""}
              disabled={!targets.length}
              title={target?.detail}
              onChange={(e) => setTargetKey(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.key} value={t.key} title={t.detail}>
                  {t.label}
                </option>
              ))}
            </select>
          </>
        )}
        <input
          className="bus-composer-subject"
          aria-label="Subject"
          placeholder="Subject (optional)"
          value={subject}
          disabled={!!blocked}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className="bus-composer-row">
        <textarea
          rows={2}
          value={body}
          disabled={!!blocked}
          placeholder={blocked ?? (replyTo ? "Your answer…" : `Message ${target?.label.toLowerCase() ?? "the run"}…`)}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape") {
              if (replyTo) onCancelReply();
              e.currentTarget.blur();
            }
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={!!blocked || !input || sending} title="Post (Enter)">
          <Icon name="send" size={14} /> Post
        </button>
      </div>
    </form>
  );
}

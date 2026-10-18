import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { renderInline } from "../lib/inline";
import { AI_HARNESSES, harnessLabel, helperContext } from "./ai";
import { help, helpTarget } from "./content";
import { helpIndex } from "./docs";
import { useHelper } from "./context";
import { Penguin } from "./Penguin";
import { answer, type Answer, type Hit } from "./search";
import { openExternal } from "./util";

type Entry =
  | { id: number; who: "you"; text: string }
  | { id: number; who: "penguin"; answer: Answer }
  | { id: number; who: "agent"; harness: string; text: string }
  | { id: number; who: "error"; text: string }
  | { id: number; who: "pending"; harness: string };

const SUGGESTIONS = [
  "How do I approve a plan?",
  "What does the gate step do?",
  "How do I open a session in its own terminal?",
  "What is the agent bus?",
];

type NewEntry = Entry extends infer T ? (T extends unknown ? Omit<T, "id"> : never) : never;

type Agents = Record<string, { installed: boolean; signedIn: boolean | null }>;

/** Ask the penguin: offline answers from the bundled docs, and optionally from the user's agent. */
export function AskPanel({ onClose }: { onClose: () => void }) {
  const h = useHelper();
  const [log, setLog] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<Agents | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(document.activeElement);
  const nextId = useRef(1);
  const id = useId();
  const ai = h.host.ai;
  const aiOn = h.settings.ai && !!ai && !ai.unavailable;
  const harness = h.settings.aiHarness;
  const { setThinking } = h;

  useEffect(() => {
    inputRef.current?.focus();
    void helpIndex();
    const prev = back.current as HTMLElement | null;
    return () => {
      setThinking(false);
      prev?.focus?.();
    };
  }, [setThinking]);

  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    if (!h.settings.ai || !ai?.agents || agents) return;
    ai.agents()
      .then((list) => setAgents(Object.fromEntries(list.map((a) => [a.harness, a]))))
      .catch(() => setAgents({}));
  }, [h.settings.ai, ai, agents]);

  const push = (e: NewEntry) => {
    const entry = { ...e, id: nextId.current++ } as Entry;
    setLog((l) => [...l, entry]);
    return entry.id;
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    push({ who: "you", text: q });
    setBusy(true);
    try {
      const index = await helpIndex();
      const offline = answer(index, q);
      push({ who: "penguin", answer: offline });
      if (aiOn && ai && offline.kind !== "out-of-scope") {
        const pending = push({ who: "pending", harness });
        setThinking(true);
        h.announce(`Asking ${harnessLabel(harness)}…`);
        try {
          const context = helperContext(h.host.describeView?.() ?? "", index.search(q, 6));
          const reply = await ai.ask({ harness, question: q, context });
          setLog((l) => l.filter((e) => e.id !== pending));
          push({ who: "agent", harness: reply.harness, text: reply.answer });
        } catch (e) {
          setLog((l) => l.filter((x) => x.id !== pending));
          push({
            who: "error",
            text: `${harnessLabel(harness)} could not answer: ${e instanceof Error ? e.message : String(e)}`,
          });
        } finally {
          setThinking(false);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  const signedIn = agents?.[harness]?.signedIn;
  return (
    <section
      {...help("helper.ask")}
      className="ask"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-t`}
      data-helper-ui
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key.length === 1 || e.key === "Enter") {
          // Typing here never reaches the cockpit's shortcuts.
          e.stopPropagation();
        }
      }}
    >
      <header className="ask-head">
        <Penguin mood={busy ? "thinking" : "talking"} size={30} />
        <h2 id={`${id}-t`}>Ask the penguin</h2>
        <span className="muted ask-scope">AgentUX only</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close (Esc)">
          <Icon name="x" size={14} />
        </button>
      </header>

      <div ref={logRef} className="ask-log" role="log" aria-live="polite" aria-relevant="additions">
        {log.length === 0 && (
          <div className="ask-intro">
            <p>
              Ask me about the cockpit, runs, approvals, the agent bus, <code>aux</code>, <code>agentux.yaml</code> or
              updates. I answer from the AgentUX docs that ship with the cockpit.
            </p>
            <div className="ask-suggest" role="group" aria-label="Suggested questions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip-btn" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {log.map((e) => (
          <LogEntry key={e.id} entry={e} onShow={(key, el) => h.showMe(key, el)} />
        ))}
      </div>

      <form className="ask-form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          aria-label="Your question"
          placeholder="How do I…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(text);
            }
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
          <Icon name="send" size={14} /> Ask
        </button>
      </form>

      <footer className="ask-ai" {...help("helper.ai")}>
        <label className="ask-switch">
          <input
            type="checkbox"
            role="switch"
            checked={h.settings.ai}
            disabled={!ai || !!ai.unavailable}
            onChange={(e) => h.update({ ai: e.target.checked })}
          />
          Ask my agent too
        </label>
        <select
          aria-label="Agent that answers"
          value={harness}
          disabled={!h.settings.ai || !ai || !!ai.unavailable}
          onChange={(e) => h.update({ aiHarness: e.target.value })}
        >
          {AI_HARNESSES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {agents?.[a.id]?.signedIn
                ? " (signed in)"
                : agents?.[a.id] && !agents[a.id].installed
                  ? " (not installed)"
                  : ""}
            </option>
          ))}
        </select>
        <p className="muted ask-note">
          {!ai || ai.unavailable
            ? `Off: ${ai?.unavailable ?? "not available here"}.`
            : h.settings.ai
              ? `${harnessLabel(harness)} answers on your own account, with no tools and no files. It sees your question, matching docs passages and the view you are on.${signedIn === false ? ` It does not look signed in: run its sign-in from Welcome & setup.` : ""}`
              : "Off by default. When on, your own agent answers through agentuxd, on your account."}
        </p>
      </footer>
    </section>
  );
}

function LogEntry({ entry: e, onShow }: { entry: Entry; onShow: (key: string, el: HTMLElement) => void }) {
  switch (e.who) {
    case "you":
      return <div className="ask-you">{e.text}</div>;
    case "pending":
      return (
        <div className="ask-msg ask-pending" aria-busy="true">
          <span className="wz-spin" aria-hidden="true" /> Asking {harnessLabel(e.harness)}…
        </div>
      );
    case "error":
      return (
        <div className="ask-msg ask-error" role="alert">
          <Icon name="alert" size={14} /> {e.text}
        </div>
      );
    case "agent":
      return (
        <div className="ask-msg ask-agent">
          <div className="ask-by">
            <Icon name="bus" size={13} /> {harnessLabel(e.harness)} · your agent account
          </div>
          <div className="ask-agent-text">{renderInline(e.text)}</div>
        </div>
      );
    case "penguin":
      return <PenguinAnswer answer={e.answer} onShow={onShow} />;
  }
}

function PenguinAnswer({ answer: a, onShow }: { answer: Answer; onShow: (key: string, el: HTMLElement) => void }) {
  if (a.kind === "out-of-scope") {
    return (
      <div className="ask-msg">
        I only know AgentUX: the cockpit, <code>aux</code>, agentuxd, runs and agents. For the desktop itself (COSMIC,
        KDE Plasma) or Linux in general, its own help is the place to look.
      </div>
    );
  }
  if (a.kind === "none") {
    return (
      <div className="ask-msg">
        I couldn't find that in the AgentUX docs. Try other words, or{" "}
        <button
          className="link-btn"
          onClick={() => void openExternal("https://github.com/agentux-os/agentux/tree/main/docs")}
        >
          browse the docs
        </button>
        .
      </div>
    );
  }
  return (
    <div className="ask-msg">
      <p className="ask-lead">Here is what the docs say:</p>
      <ol className="ask-hits">
        {a.hits.map((hit) => (
          <HitView key={hit.passage.id} hit={hit} onShow={onShow} />
        ))}
      </ol>
    </div>
  );
}

function HitView({ hit, onShow }: { hit: Hit; onShow: (key: string, el: HTMLElement) => void }) {
  const p = hit.passage;
  const showable = p.helpKey && helpTarget(p.helpKey);
  return (
    <li className="ask-hit">
      <div className="ask-hit-head">
        <strong>{p.heading}</strong>
        <span className="muted"> · {p.source}</span>
      </div>
      <p>{renderInline(hit.snippet)}</p>
      <div className="ask-hit-actions">
        {showable && p.helpKey && (
          <button className="link-btn" onClick={(e) => onShow(p.helpKey!, e.currentTarget)}>
            <Icon name="arrowRight" size={12} /> Show me
          </button>
        )}
        {p.url && (
          <button className="link-btn" onClick={() => void openExternal(p.url!)}>
            <Icon name="file" size={12} /> Read more
          </button>
        )}
      </div>
    </li>
  );
}

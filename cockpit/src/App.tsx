import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PermissionRequest, Run } from "./daemon/types";
import { VENDOR_INFO } from "./daemon/vendors";
import { REQUEST_LABEL, runRef } from "./lib/labels";
import { useNow } from "./lib/useNow";
import { useCockpit, useDaemon } from "./state/daemon";
import type { StartRunInput } from "./daemon/client";
import { BusFeed } from "./components/BusFeed";
import { DaemonBanner } from "./components/DaemonBanner";
import { Icon } from "./components/Icon";
import { Inbox } from "./components/Inbox";
import { LiveRail } from "./components/LiveRail";
import { NewRunDialog } from "./components/NewRunDialog";
import { RunBoard } from "./components/RunBoard";
import { SessionPanel } from "./components/SessionPanel";
import { Sidebar, type View } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";

type Theme = "dark" | "light";

const VIEW_TITLE: Record<View, string> = { board: "Run board", inbox: "Approvals", bus: "Agent bus" };

function loadTheme(): Theme {
  try {
    return localStorage.getItem("agentux.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function App() {
  const client = useDaemon();
  const state = useCockpit();
  const now = useNow(5_000);

  const [view, setView] = useState<View>("board");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [inboxSel, setInboxSel] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [newRun, setNewRun] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("agentux.theme", theme);
    } catch {
      /* storage unavailable; theme still applies for this session */
    }
  }, [theme]);

  const showToast = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const pending = useMemo(
    () => Object.values(state.requests).filter((r) => r.status === "pending").sort((a, b) => a.createdAt - b.createdAt),
    [state.requests],
  );
  const inboxSelected = pending.find((r) => r.id === inboxSel) ?? pending[0];
  const run = runId ? state.runs[runId] : undefined;

  const openRun = useCallback((id: string) => {
    setRunId(id);
    setSessionId(null);
    setTerminal(false);
  }, []);

  const approve = useCallback(
    (requestId: string, answer?: string) => {
      const r = state.requests[requestId];
      void client.approve(requestId, answer);
      if (r) showToast(`${r.kind === "question" ? "Answered" : "Approved"}: ${requestLine(r, state.runs[r.runId])}`);
    },
    [client, state, showToast],
  );

  const deny = useCallback(
    (requestId: string) => {
      const r = state.requests[requestId];
      void client.deny(requestId);
      if (r) showToast(`Denied: ${requestLine(r, state.runs[r.runId])}`);
    },
    [client, state, showToast],
  );

  const canStartRuns = client.mode === "daemon" && state.connection.status === "connected";

  const startRun = async (input: StartRunInput) => {
    const started = await client.startRun(input);
    setNewRun(false);
    setView("board");
    setProjectId(started.projectId);
    openRun(started.id);
    showToast(`Started run ${started.id}: ${started.title}`);
  };

  const cancelRun = (id: string) => {
    client.cancelRun(id).then(
      () => showToast(`Cancelled run ${id}`),
      (e: unknown) => showToast(`Could not cancel: ${errorText(e)}`),
    );
  };

  /** The request keyboard shortcuts act on, depending on where the user is. */
  const focusedRequest = (): PermissionRequest | undefined => {
    if (view === "inbox") return inboxSelected;
    if (run) return pending.find((r) => r.runId === run.id);
    return undefined;
  };

  const moveInbox = (delta: number) => {
    if (!pending.length) return;
    const i = Math.max(0, pending.findIndex((r) => r.id === inboxSelected?.id));
    const next = pending[Math.min(pending.length - 1, Math.max(0, i + delta))];
    setInboxSel(next.id);
    document.querySelector(".req.is-selected")?.scrollIntoView({ block: "nearest" });
  };

  const selectAfterResolve = (r: PermissionRequest) => {
    const i = pending.findIndex((x) => x.id === r.id);
    const next = pending[i + 1] ?? pending[i - 1];
    setInboxSel(next ? next.id : null);
  };

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (newRun) return;
    const key = e.key.toLowerCase();
    const focused = focusedRequest();
    switch (key) {
      case "?":
        setHelp((h) => !h);
        break;
      case "escape":
        if (help) setHelp(false);
        else if (runId) setRunId(null);
        break;
      case "b":
        setView("board");
        break;
      case "i":
        setView("inbox");
        break;
      case "m":
        setView("bus");
        break;
      case "j":
      case "arrowdown":
        if (view !== "inbox") return;
        moveInbox(1);
        break;
      case "k":
      case "arrowup":
        if (view !== "inbox") return;
        moveInbox(-1);
        break;
      case "enter":
        if (view === "inbox" && inboxSelected) openRun(inboxSelected.runId);
        else return;
        break;
      case "a":
        if (!focused) {
          showToast(pending.length ? "Open the inbox (I) or a waiting run to approve" : "Nothing waiting for you");
          break;
        }
        selectAfterResolve(focused);
        approve(focused.id);
        break;
      case "d":
        if (!focused) return;
        selectAfterResolve(focused);
        deny(focused.id);
        break;
      case "t":
        if (run) setTerminal((t) => !t);
        break;
      case "n":
        if (!canStartRuns) return;
        setNewRun(true);
        break;
      case "[":
      case "]": {
        const ids = [null, ...state.projects.map((p) => p.id)];
        const i = ids.indexOf(projectId);
        setProjectId(ids[(i + (key === "]" ? 1 : ids.length - 1)) % ids.length]);
        break;
      }
      default:
        if (/^[1-9]$/.test(key) && focused?.options) {
          const answer = focused.options[Number(key) - 1];
          if (!answer) return;
          selectAfterResolve(focused);
          approve(focused.id, answer);
          break;
        }
        return;
    }
    e.preventDefault();
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const project = state.projects.find((p) => p.id === projectId);
  const panelOpen = !!run;

  return (
    <div className="app">
      <Sidebar
        state={state}
        view={view}
        onView={setView}
        projectId={projectId}
        onProject={setProjectId}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <main className="main">
        <header className="topbar">
          <h1 className="topbar-title">
            {VIEW_TITLE[view]}
            <span className="muted"> · {project ? project.name : "All projects"}</span>
          </h1>
          {project && <span className="mono muted topbar-path">{project.path}</span>}
          <span className="topbar-spacer" />
          {pending.length > 0 && view !== "inbox" && (
            <button className="btn btn-attention" onClick={() => setView("inbox")}>
              <Icon name="inbox" size={14} /> {pending.length} waiting for you
            </button>
          )}
          <button
            className="btn"
            disabled={!canStartRuns}
            onClick={() => setNewRun(true)}
            title={
              client.mode === "mock"
                ? "Starting runs needs agentuxd (the cockpit is showing mock data)"
                : canStartRuns
                  ? "Start a run (N)"
                  : "Waiting for agentuxd"
            }
          >
            <Icon name="plus" size={14} /> New run
          </button>
        </header>
        {state.connection.fallbackReason && <DaemonBanner reason={state.connection.fallbackReason} />}
        <div className={`content ${panelOpen ? "has-panel" : ""}`}>
          <div className="view">
            {view === "board" && (
              <div className="board-wrap">
                <RunBoard state={state} projectId={projectId} selectedRunId={runId} now={now} onSelectRun={openRun} />
                {!panelOpen && (
                  <LiveRail
                    state={state}
                    now={now}
                    projectId={projectId}
                    pending={pending}
                    onApprove={approve}
                    onDeny={deny}
                    onOpenRun={openRun}
                    onInbox={() => setView("inbox")}
                    onBus={() => setView("bus")}
                  />
                )}
              </div>
            )}
            {view === "inbox" && (
              <Inbox
                state={state}
                now={now}
                pending={pending}
                selectedId={inboxSelected?.id ?? null}
                onSelect={setInboxSel}
                onApprove={(id, a) => {
                  const r = state.requests[id];
                  if (r) selectAfterResolve(r);
                  approve(id, a);
                }}
                onDeny={(id) => {
                  const r = state.requests[id];
                  if (r) selectAfterResolve(r);
                  deny(id);
                }}
                onOpenRun={openRun}
              />
            )}
            {view === "bus" && <BusFeed state={state} projectId={projectId} onOpenRun={openRun} />}
          </div>
          {run && (
            <SessionPanel
              key={run.id}
              run={run}
              state={state}
              now={now}
              sessionId={sessionId}
              onSession={setSessionId}
              terminal={terminal}
              onTerminal={setTerminal}
              onClose={() => setRunId(null)}
              onApprove={approve}
              onDeny={deny}
              onSend={(sid, text) => void client.sendPrompt(sid, text)}
              onCancel={client.mode === "daemon" ? () => cancelRun(run.id) : undefined}
            />
          )}
        </div>
      </main>
      <StatusBar state={state} onHelp={() => setHelp(true)} />
      {toast && (
        <div className="toast" key={toast.id} role="status">
          <Icon name="check" size={14} /> {toast.text}
        </div>
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {newRun && (
        <NewRunDialog
          projects={state.projects}
          initialPath={project?.path ?? ""}
          onClose={() => setNewRun(false)}
          onSubmit={startRun}
        />
      )}
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return String(e);
}

/** "Plan approval · Codex on #142" (vendor and run when known). */
function requestLine(r: PermissionRequest, run: Run | undefined): string {
  let line = REQUEST_LABEL[r.kind];
  if (r.vendor) line += ` · ${VENDOR_INFO[r.vendor].label}`;
  if (run) line += ` on ${runRef(run)}`;
  return line;
}

const SHORTCUTS: [string, string][] = [
  ["B / I / M", "Run board / approvals inbox / agent bus"],
  ["A", "Approve the focused request (inbox selection or open run)"],
  ["D", "Deny or dismiss it"],
  ["1–9", "Pick an answer to an agent's question"],
  ["J / K", "Move through the inbox"],
  ["Enter", "Open the selected request's run"],
  ["T", "Toggle terminal mode for the open session"],
  ["N", "Start a new run (needs agentuxd)"],
  ["[ / ]", "Previous / next project"],
  ["Esc", "Close the session panel"],
  ["?", "Show this help"],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-head">
          <Icon name="keyboard" /> Keyboard shortcuts
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </header>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k}>
              <dt>
                {k.split(" / ").map((part, i) => (
                  <span key={part}>
                    {i > 0 && " "}
                    <kbd>{part}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

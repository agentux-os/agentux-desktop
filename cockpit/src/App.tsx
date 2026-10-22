import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusPostInput, BusPostResult, PermissionRequest, Run, Session } from "./daemon/types";
import { harnessInfo } from "./daemon/vendors";
import { recentRunIds } from "./lib/bus";
import { REQUEST_LABEL, STEP_LABEL, runRef } from "./lib/labels";
import { useNow } from "./lib/useNow";
import { useCockpit, useDaemon } from "./state/daemon";
import type { StartRunInput } from "./daemon/client";
import { BusFeed } from "./components/BusFeed";
import { DaemonBanner } from "./components/DaemonBanner";
import { UpdateBanner } from "./components/UpdateBanner";
import { Icon } from "./components/Icon";
import { Inbox } from "./components/Inbox";
import { LiveRail } from "./components/LiveRail";
import { NewRunDialog } from "./components/NewRunDialog";
import { AgentsView } from "./components/AgentsView";
import { SettingsView } from "./components/SettingsView";
import { getCloneDir } from "./lib/localPrefs";
import { openWelcome } from "./setup/open";
import { RunBoard } from "./components/RunBoard";
import { SessionPanel } from "./components/SessionPanel";
import { Sidebar, type View } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { help } from "./helper/content";
import { HelperProvider, type HelperHost } from "./helper/HelperProvider";
import { COCKPIT_TOUR } from "./helper/Tour";

type Theme = "dark" | "light";

const VIEW_TITLE: Record<View, string> = {
  board: "Run board",
  inbox: "Approvals",
  bus: "Agent bus",
  agents: "Agents",
  settings: "Settings",
};

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
  const [showKeys, setShowKeys] = useState(false);
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

  // Session entries from before the cockpit started come from the run's history.
  const connected = state.connection.status === "connected";
  useEffect(() => {
    if (runId && connected) client.watchRun(runId);
  }, [client, runId, connected]);

  // The bus log of the runs in view (bus page, board rail): loaded once per run.
  const busRuns = useMemo(
    () => (view === "inbox" ? [] : recentRunIds(Object.values(state.runs), projectId)).join(","),
    [view, state.runs, projectId],
  );
  useEffect(() => {
    if (connected && busRuns) client.watchBus(busRuns.split(","));
  }, [client, busRuns, connected]);

  const openRun = useCallback((id: string) => {
    setRunId(id);
    setSessionId(null);
    setTerminal(false);
  }, []);

  /** Approves a request; a question needs `answer` (agentuxd refuses an empty one). */
  const approve = useCallback(
    (requestId: string, answer?: string) => {
      const r = state.requests[requestId];
      if (r?.kind === "question" && !answer?.trim()) {
        showToast("Pick an option (1–9) or type an answer");
        return false;
      }
      client.approve(requestId, answer).catch((e: unknown) => showToast(`Could not ${r?.kind === "question" ? "answer" : "approve"}: ${errorText(e)}`));
      if (r) showToast(`${APPROVED[r.kind]}: ${requestLine(r, state)}${answer ? ` · “${answer}”` : ""}`);
      return true;
    },
    [client, state, showToast],
  );

  const deny = useCallback(
    (requestId: string) => {
      const r = state.requests[requestId];
      client.deny(requestId).catch((e: unknown) => showToast(`Could not deny: ${errorText(e)}`));
      if (r) showToast(`${DENIED[r.kind]}: ${requestLine(r, state)}`);
    },
    [client, state, showToast],
  );

  const canStartRuns = client.mode === "daemon" && state.connection.status === "connected";
  const sendDisabled =
    client.mode === "daemon" && !state.capabilities?.sessionsPrompt
      ? "This agentuxd does not take prompts into sessions yet"
      : undefined;

  const terminalDisabled =
    client.mode === "daemon" && !state.capabilities?.terminals
      ? "This agentuxd has no terminal mode yet (terminals.*)"
      : undefined;

  const sendPrompt = (sid: string, text: string) => {
    client.sendPrompt(sid, text).catch((e: unknown) => showToast(`Could not send: ${errorText(e)}`));
  };

  /** Posts on a run's bus; the entry itself arrives on the event stream. */
  const postBus = async (input: BusPostInput): Promise<boolean> => {
    try {
      showToast(postedLine(await client.postBus(input)));
      return true;
    } catch (e: unknown) {
      showToast(`Could not post: ${errorText(e)}`);
      return false;
    }
  };

  const loadHarnesses = useCallback(() => client.harnesses(), [client]);
  const setupClient = useCallback(async () => {
    const { createSetupClient } = await import("./setup/client");
    return createSetupClient();
  }, []);
  const clearLimit = useCallback((harness: string) => client.clearLimit(harness), [client]);
  const cloneRepo = useCallback(async (source: string) => {
    const { createSetupClient } = await import("./setup/client");
    return (await createSetupClient()).clone(source, getCloneDir());
  }, []);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const { isTauri } = await import("./daemon/tauri/TauriDaemonClient");
      if (!isTauri()) return;
      const { getVersion } = await import("@tauri-apps/api/app");
      setAppVersion(await getVersion());
    })().catch(() => {});
  }, []);

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
    // Keys typed into a terminal belong to the program in it (xterm's input is
    // a textarea, but say it explicitly); Shift+Esc or Ctrl+] leaves it.
    if (target.closest(".xterm, input, textarea, select, [contenteditable]")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (newRun) return;
    const key = e.key.toLowerCase();
    const focused = focusedRequest();
    switch (key) {
      case "?":
        setShowKeys((h) => !h);
        break;
      case "escape":
        if (showKeys) setShowKeys(false);
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
      case "g":
        setView("agents");
        break;
      case ",":
        setView("settings");
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
        if (focused.kind === "question") {
          // A question needs an answer: go to its answer field.
          focusAnswerField();
          break;
        }
        selectAfterResolve(focused);
        approve(focused.id);
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9": {
        const option = focused?.kind === "question" ? focused.options[Number(key) - 1] : undefined;
        if (!focused || option === undefined) return;
        selectAfterResolve(focused);
        approve(focused.id, option);
        break;
      }
      case "d":
        if (!focused) return;
        selectAfterResolve(focused);
        deny(focused.id);
        break;
      case "t":
        if (!run) return;
        if (terminalDisabled && !terminal) {
          showToast(terminalDisabled);
          break;
        }
        setTerminal((t) => !t);
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

  // What the helper may tell the user's agent about the screen: the view, the
  // project and the open run's summary; never files, transcripts or secrets.
  const viewRef = useRef("");
  viewRef.current = describeView(VIEW_TITLE[view], project?.name, run, pending.length);
  const runsRef = useRef(state.runs);
  runsRef.current = state.runs;
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  const helperAsk = client.mode === "daemon" && state.capabilities?.helperAsk === true;
  const helperHost = useMemo<HelperHost>(
    () => ({
      surface: "cockpit",
      tour: COCKPIT_TOUR,
      describeView: () => viewRef.current,
      openSomeRun: () => {
        if (runIdRef.current) return;
        const runs = Object.values(runsRef.current);
        const pick = runs.find((r) => r.status === "running" || r.status === "waiting") ?? runs[0];
        if (!pick) return;
        openRun(pick.id);
        return () => setRunId(null);
      },
      ai: {
        unavailable:
          client.mode === "mock"
            ? "the cockpit is showing mock data, without agentuxd"
            : helperAsk
              ? undefined
              : "this agentuxd cannot ask agents yet (helper.ask needs agentux-core 0.4.3 or later)",
        ask: (input) => client.askHelper(input),
        agents: async () => {
          const { createSetupClient } = await import("./setup/client");
          const status = await (await createSetupClient()).status();
          const harness: Record<string, string> = { claude: "claude-code", codex: "codex", opencode: "opencode", antigravity: "antigravity" };
          return status.agents.map((a) => ({ harness: harness[a.id] ?? a.id, installed: a.installed, signedIn: a.signedIn }));
        },
      },
    }),
    [client, helperAsk, openRun],
  );

  const page = (
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
          <h1 className="topbar-title" {...help("topbar.title")}>
            {VIEW_TITLE[view]}
            <span className="muted"> · {project ? project.name : "All projects"}</span>
          </h1>
          {project && (
            <span className="mono muted topbar-path" {...help("topbar.path")}>
              {project.path}
            </span>
          )}
          <span className="topbar-spacer" />
          {pending.length > 0 && view !== "inbox" && (
            <button className="btn btn-attention" onClick={() => setView("inbox")} {...help("topbar.waiting")}>
              <Icon name="inbox" size={14} /> {pending.length} waiting for you
            </button>
          )}
          <button
            {...help("topbar.newRun")}
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
        <UpdateBanner setup={setupClient} />
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
                onApprove={(id, answer) => {
                  const r = state.requests[id];
                  if (approve(id, answer) && r) selectAfterResolve(r);
                }}
                onDeny={(id) => {
                  const r = state.requests[id];
                  if (r) selectAfterResolve(r);
                  deny(id);
                }}
                onOpenRun={openRun}
              />
            )}
            {view === "agents" && <AgentsView client={client} setup={setupClient} onSettings={() => setView("settings")} />}
            {view === "settings" && (
              <SettingsView
                client={client}
                state={state}
                setup={setupClient}
                theme={theme}
                onTheme={setTheme}
                onWelcome={() => void openWelcome()}
                version={appVersion}
              />
            )}
            {view === "bus" && (
              <BusFeed state={state} mode={client.mode} projectId={projectId} onOpenRun={openRun} onPost={postBus} />
            )}
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
              onSend={sendPrompt}
              sendDisabled={sendDisabled}
              onCancel={client.mode === "daemon" ? () => cancelRun(run.id) : undefined}
              mode={client.mode}
              onPost={postBus}
              terminalDisabled={terminalDisabled}
            />
          )}
        </div>
      </main>
      <StatusBar state={state} onHelp={() => setShowKeys(true)} />
      {toast && (
        <div className="toast" key={toast.id} role="status">
          <Icon name="check" size={14} /> {toast.text}
        </div>
      )}
      {showKeys && <ShortcutHelp onClose={() => setShowKeys(false)} />}
      {newRun && (
        <NewRunDialog
          projects={state.projects}
          initialPath={project?.path ?? ""}
          onClose={() => setNewRun(false)}
          onSubmit={startRun}
          loadHarnesses={loadHarnesses}
          onClone={cloneRepo}
          onClearLimit={clearLimit}
        />
      )}
    </div>
  );
  return <HelperProvider host={helperHost}>{page}</HelperProvider>;
}

/** "Run board · project ledger-api. Open run 3f9a0c12 “Fix login”: waiting, step Plan." */
function describeView(title: string, project: string | undefined, run: Run | undefined, waiting: number): string {
  let out = `The user is on the ${title} view of the AgentUX cockpit, ${project ? `project ${project}` : "all projects"}.`;
  if (waiting) out += ` ${waiting} request${waiting === 1 ? "" : "s"} wait for the user.`;
  if (run) {
    out += ` Open run ${runRef(run)} "${run.title}": status ${run.status}, step ${STEP_LABEL[run.step] ?? run.step}`;
    if (run.gateAttempt > 0) out += `, gate attempt ${run.gateAttempt}/${run.gateMaxAttempts}`;
    if (run.reviewRound > 0) out += `, review round ${run.reviewRound}/${run.reviewMaxRounds}`;
    out += ".";
    if (run.error) out += ` Its error: ${run.error.slice(0, 300)}`;
  }
  return out;
}

/** Focuses the answer field of the selected question card (inbox), else the first one shown. */
function focusAnswerField() {
  const input =
    document.querySelector<HTMLInputElement>(".req.is-selected .req-answer-input") ??
    document.querySelector<HTMLInputElement>(".req-answer-input");
  input?.focus();
}

/** "Posted message 3 (exchange 2): delivered to 1 session" and the like. */
function postedLine(r: BusPostResult): string {
  const where = r.queuedForRole
    ? `queued for the ${r.queuedForRole} role (a session is starting)`
    : r.deliveredTo.length
      ? `delivered to ${r.deliveredTo.length} session${r.deliveredTo.length === 1 ? "" : "s"}`
      : "posted";
  return `Message ${r.messageId} (exchange ${r.exchange}, turn ${r.turn}): ${where}`;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return String(e);
}

const APPROVED: Record<PermissionRequest["kind"], string> = {
  plan: "Approved",
  step: "Approved",
  permission: "Allowed",
  budget: "Budget extended",
  question: "Answered",
  limit: "Retrying",
};
const DENIED: Record<PermissionRequest["kind"], string> = {
  plan: "Rejected",
  step: "Rejected",
  permission: "Denied",
  budget: "Stopped",
  question: "Declined",
  limit: "Stopped",
};

/** "Permission · Codex on 3f9a0c12" (the asking session's harness and the run, when known). */
function requestLine(r: PermissionRequest, state: { runs: Record<string, Run>; sessions: Record<string, Session> }): string {
  let line = REQUEST_LABEL[r.kind];
  const session = r.sessionId ? state.sessions[r.sessionId] : undefined;
  if (session) line += ` · ${harnessInfo(session.vendor, session.harness).label}`;
  const run = state.runs[r.runId];
  if (run) line += ` on ${runRef(run)}`;
  return line;
}

const SHORTCUTS: [string, string][] = [
  ["B / I / M / G / ,", "Run board / approvals inbox / agent bus / agents / settings"],
  ["A", "Approve the focused request (inbox selection or open run)"],
  ["D", "Deny or reject it (decline a question)"],
  ["1 … 9", "Answer the focused question with that option"],
  ["J / K", "Move through the inbox"],
  ["Enter", "Open the selected request's run"],
  ["T", "Structured / terminal view of the open session (its harness's own TUI)"],
  ["Shift+Esc / Ctrl+]", "Leave the terminal: give the keyboard back to the cockpit"],
  ["N", "Start a new run (needs agentuxd)"],
  ["[ / ]", "Previous / next project"],
  ["Esc", "Close the session panel"],
  ["?", "Show this help"],
  ["F1", "Ask the penguin about AgentUX"],
  ["Shift+F1", "What's this? Click anything to learn what it is"],
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

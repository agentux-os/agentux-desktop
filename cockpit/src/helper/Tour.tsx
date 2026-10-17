import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { helpEntry, helpTarget } from "./content";
import { Penguin, PenguinFull } from "./Penguin";
import { clampBox, nextFrame, placeNear, revealInScroller, useBox, useFocusTrap, type Box } from "./util";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Help keys of the element to point at, the first one on screen wins. None: a centred card. */
  targets?: string[];
  /** The element lives in a run's session panel: open a run first. */
  needsRun?: boolean;
}

/** The cockpit's tour, in order. Steps whose element is not on screen are skipped. */
export const COCKPIT_TOUR: TourStep[] = [
  {
    id: "hello",
    title: "Hi, I'm the AgentUX penguin",
    body: "A quick tour of the cockpit: where runs go, where agents wait for you and how they talk. Use the arrow keys or the buttons; Escape ends the tour.",
  },
  {
    id: "board",
    title: "The run board",
    body: "Each run is a prompt going through the project's pipeline in its own worktree: plan, implement, gate, review, pull request. Cards move as agents work. Click one to see its sessions.",
    targets: ["board"],
  },
  {
    id: "waiting",
    title: "Waiting for you",
    body: "The first column holds runs paused on something only you can decide: a plan to approve, an agent asking before a tool call, a budget overrun.",
    targets: ["board.col.waiting"],
  },
  {
    id: "inbox",
    title: "Approvals in one place",
    body: "Every request from every run lands here and in the approvals inbox (I). A approves, D denies, 1 to 9 answers an agent's question.",
    targets: ["rail.waiting", "nav.inbox"],
  },
  {
    id: "bus",
    title: "The agent bus",
    body: "Agents message each other, ask for reviews and hand off work over the bus. You can read every exchange and post as yourself (M).",
    targets: ["rail.bus", "nav.bus"],
  },
  {
    id: "new-run",
    title: "Start a run",
    body: "New run (N) takes a directory inside a git repository and a prompt. It needs agentuxd; on mock data it stays disabled.",
    targets: ["topbar.newRun"],
  },
  {
    id: "projects",
    title: "Projects",
    body: "Repositories register themselves on their first run. Pick one to narrow the board, or cycle with [ and ].",
    targets: ["nav.projects"],
  },
  {
    id: "terminal",
    title: "Terminal handoff",
    body: "In a run's panel, Terminal (T) opens the session in its agent's own TUI on the same conversation; the daemon holds the agent's turns until you come back. Shift+Esc gives the keyboard back.",
    targets: ["panel.mode"],
    needsRun: true,
  },
  {
    id: "status",
    title: "Daemon connection",
    body: "The status bar shows whether the cockpit is connected to agentuxd, active runs, what waits for you and what the agents cost.",
    targets: ["status.connection"],
  },
  {
    id: "settings",
    title: "Settings and theme",
    body: "Switch between dark and light here. Welcome & setup reopens the first-run wizard for sign-ins and tools.",
    targets: ["sidebar.theme"],
  },
  {
    id: "me",
    title: "Ask me any time",
    body: "Click me for this tour again, What's this? (Shift+F1) to explain anything you click, or Ask (F1) for questions about AgentUX.",
    targets: ["helper.penguin"],
  },
];

/** The first of `keys` that is on screen: revealed in its scroller, and at least partly in the window. */
function findTarget(keys: string[]): HTMLElement | null {
  for (const key of keys) {
    const el = helpTarget(key);
    if (!el) continue;
    revealInScroller(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return el; // no layout (tests)
    const vh = window.innerHeight || 800;
    const vw = window.innerWidth || 1280;
    const need = Math.min(24, r.height, r.width);
    if (Math.min(r.bottom, vh) - Math.max(r.top, 0) >= need && Math.min(r.right, vw) - Math.max(r.left, 0) >= need)
      return el;
  }
  return null;
}

/** The highlight around `box`, dimming the rest of the window. */
function Spotlight({ box, onClick }: { box: Box | null; onClick?: () => void }) {
  const pad = 6;
  return (
    <div className="spot-layer" onClick={onClick} data-helper-ui>
      {box ? (
        <div
          className="spot-hole"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
        />
      ) : (
        <div className="spot-dim" />
      )}
    </div>
  );
}

function CoachCard({
  box,
  labelledBy,
  describedBy,
  children,
  className = "",
}: {
  box: Box | null;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 340, height: 200 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (Math.abs(r.width - size.width) > 1 || Math.abs(r.height - size.height) > 1)) {
      setSize({ width: r.width, height: r.height });
    }
  });
  useFocusTrap(ref);
  const at = placeNear(box, size);
  return (
    <div
      ref={ref}
      className={`coach is-${at.side} ${className}`}
      style={{ top: at.top, left: at.left }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-helper-ui
    >
      {children}
    </div>
  );
}

export function Tour({
  steps,
  openSomeRun,
  onEnd,
}: {
  steps: TourStep[];
  openSomeRun?: () => (() => void) | void;
  onEnd: (how: "done" | "skipped") => void;
}) {
  const [index, setIndex] = useState(-1);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const undoRun = useRef<(() => void) | void>(undefined);
  const back = useRef<Element | null>(document.activeElement);
  const nextRef = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const id = useId();
  const box = clampBox(useBox(target));

  /** Shows step `i`, or the next one in direction `dir` whose element is on screen. */
  const go = useCallback(
    async (i: number, dir: 1 | -1) => {
      if (busy.current) return;
      busy.current = true;
      try {
        for (let j = i; j >= 0 && j < steps.length; j += dir) {
          const step = steps[j];
          if (step.needsRun && !undoRun.current && openSomeRun) {
            undoRun.current = openSomeRun();
            await nextFrame();
            await nextFrame();
          }
          const el = step.targets?.length ? findTarget(step.targets) : null;
          if (step.targets?.length && !el) continue;
          if (!step.needsRun && undoRun.current) {
            undoRun.current();
            undoRun.current = undefined;
            await nextFrame();
          }
          setTarget(el);
          setIndex(j);
          return;
        }
        if (dir === 1) finish("done");
      } finally {
        busy.current = false;
      }
    },
    [steps, openSomeRun],
  );

  const finish = (how: "done" | "skipped") => {
    if (undoRun.current) undoRun.current();
    undoRun.current = undefined;
    onEnd(how);
    (back.current as HTMLElement | null)?.focus?.();
  };

  useEffect(() => {
    void go(0, 1);
  }, [go]);

  useEffect(() => {
    if (index >= 0) nextRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("skipped");
      else if (e.key === "ArrowRight" && !e.altKey) void go(index + 1, 1);
      else if (e.key === "ArrowLeft" && !e.altKey) void go(index - 1, -1);
      else {
        // Tab, Enter and Space work on the card; the cockpit's own keys are off.
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (index < 0) return null;
  const step = steps[index];
  const first = index === 0;
  const last = index === steps.length - 1;
  return (
    <>
      <Spotlight box={target ? box : null} />
      <CoachCard
        box={target ? box : null}
        labelledBy={`${id}-t`}
        describedBy={`${id}-b`}
        className={target ? "" : "is-intro"}
      >
        {!target && <PenguinFull width={200} />}
        <div className="coach-head">
          {target && <Penguin mood="pointing" size={30} />}
          <h2 id={`${id}-t`}>{step.title}</h2>
          <span className="coach-count" aria-label={`Step ${index + 1} of ${steps.length}`}>
            {index + 1}/{steps.length}
          </span>
        </div>
        <p id={`${id}-b`}>{step.body}</p>
        <div className="coach-actions">
          <button className="btn btn-quiet" onClick={() => finish("skipped")}>
            Skip tour
          </button>
          <span className="coach-spacer" />
          <button className="btn" onClick={() => void go(index - 1, -1)} disabled={first}>
            Back
          </button>
          <button
            ref={nextRef}
            className="btn btn-primary"
            onClick={() => (last ? finish("done") : void go(index + 1, 1))}
          >
            {last ? "Done" : "Next"}
            {!last && <Icon name="arrowRight" size={14} />}
          </button>
        </div>
        <div className="sr-only" aria-live="polite">
          Step {index + 1} of {steps.length}: {step.title}
        </div>
      </CoachCard>
    </>
  );
}

/** Ask's Show me: points at one element until dismissed. */
export function ShowMe({ helpKey, onClose }: { helpKey: string; onClose: () => void }) {
  const [el] = useState(() => helpTarget(helpKey));
  const box = clampBox(useBox(el));
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const entry = helpEntry(helpKey);
  useEffect(() => {
    if (el) revealInScroller(el);
    closeRef.current?.focus();
  }, [el]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <>
      <Spotlight box={box} onClick={onClose} />
      <CoachCard box={box} labelledBy={`${id}-t`} className="is-show">
        <div className="coach-head">
          <Penguin mood="pointing" size={30} />
          <h2 id={`${id}-t`}>{el ? (entry?.title ?? "Here") : "Not on screen right now"}</h2>
        </div>
        <p>{el ? entry?.what : "Open the view it belongs to first, then ask me again."}</p>
        <div className="coach-actions">
          <span className="coach-spacer" />
          <button ref={closeRef} className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </CoachCard>
    </>
  );
}

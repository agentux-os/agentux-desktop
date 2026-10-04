import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalHandle } from "../daemon/client";
import type { Terminal } from "../daemon/types";
import { LEAVE_HINT, documentTerminalTheme, isLeaveChord, targetKey, terminalFor, type TerminalTarget } from "../lib/terminal";
import { useCockpit, useDaemon } from "../state/daemon";
import { Icon } from "./Icon";

type Phase =
  | { kind: "connecting" }
  | { kind: "open"; terminalId: string }
  | { kind: "exited"; code: number | null }
  | { kind: "lost"; reason: string }
  | { kind: "error"; message: string };

interface Props {
  target: TerminalTarget;
  /** Shown in the bar: what runs (e.g. "Claude Code TUI", "Shell"). */
  title: string;
  /** The run's worktree, shown until the daemon reports the terminal's cwd. */
  cwd?: string;
  /** Focus the terminal when it opens. */
  autoFocus?: boolean;
  /** Keyboard focus leaves the terminal (Shift+Esc or Ctrl+]). */
  onLeave: () => void;
}

/**
 * A daemon-managed terminal rendered with xterm.js. Opening it attaches to
 * the target's running terminal if there is one; unmounting only detaches
 * (whoever owns the view decides when to close). The terminal is sized to its
 * container, follows the cockpit theme, and keeps the keyboard while focused:
 * the cockpit's shortcuts ignore keys typed into it, and Shift+Esc or Ctrl+]
 * gives the keyboard back.
 */
export function TerminalView({ target, title, cwd, autoFocus = true, onLeave }: Props) {
  const client = useDaemon();
  const state = useCockpit();
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [focused, setFocused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const key = targetKey(target);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const style = getComputedStyle(document.documentElement);
    const term = new XTerm({
      theme: documentTerminalTheme(),
      fontFamily: style.getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const refit = () => {
      try {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
      } catch {
        /* not laid out yet */
      }
    };
    refit();

    term.attachCustomKeyEventHandler((e) => {
      if (!isLeaveChord(e)) return true;
      if (e.type === "keydown") {
        e.preventDefault();
        term.blur();
        onLeaveRef.current();
      }
      return false;
    });

    let handle: TerminalHandle | undefined;
    let disposed = false;
    setPhase({ kind: "connecting" });
    const note = (text: string) => term.write(`\r\n\x1b[2m[${text}]\x1b[0m\r\n`);
    client
      .openTerminal(
        target,
        { cols: term.cols, rows: term.rows },
        {
          output: (data) => term.write(data),
          exit: (code) => {
            note(code == null ? "the terminal was closed" : `process exited with code ${code}`);
            setPhase({ kind: "exited", code });
          },
          lost: (reason) => {
            note(reason);
            setPhase({ kind: "lost", reason });
          },
        },
      )
      .then(
        (h) => {
          if (disposed) {
            h.detach();
            return;
          }
          handle = h;
          h.resize(term.cols, term.rows);
          setPhase((p) => (p.kind === "connecting" ? { kind: "open", terminalId: h.terminalId } : p));
          if (autoFocus) term.focus();
        },
        (e: unknown) => {
          if (!disposed) setPhase({ kind: "error", message: e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e) });
        },
      );

    const subs = [
      term.onData((d) => handle?.input(d)),
      term.onBinary((d) => handle?.inputBinary(d)),
      term.onResize(({ cols, rows }) => handle?.resize(cols, rows)),
    ];
    const textarea = term.textarea;
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    textarea?.addEventListener("focus", onFocus);
    textarea?.addEventListener("blur", onBlur);

    const resizeObserver = new ResizeObserver(() => refit());
    resizeObserver.observe(host);
    // The cockpit theme is a data attribute on <html>: follow it.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = documentTerminalTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      textarea?.removeEventListener("focus", onFocus);
      textarea?.removeEventListener("blur", onBlur);
      subs.forEach((s) => s.dispose());
      handle?.detach();
      term.dispose();
    };
    // `target` is identified by its key; `attempt` reopens after an exit.
  }, [client, key, attempt]);

  const info: Terminal | undefined =
    phase.kind === "open" ? state.terminals[phase.terminalId] : terminalFor(state.terminals, target);
  const waiting = phase.kind === "open" && info?.state === "waiting";
  const ended = phase.kind === "exited" || phase.kind === "lost" || phase.kind === "error";

  return (
    <div className={`term ${focused ? "is-focused" : ""}`}>
      <div className="term-bar">
        <Icon name="terminal" size={13} />
        <span className="term-title">{info?.fallback ? "Shell" : title}</span>
        <span className="mono ellipsis term-cwd" title={info?.cwd ?? cwd}>
          {info?.argv.length ? info.argv.join(" ") : (info?.cwd ?? cwd ?? "")}
        </span>
        <span className="term-spacer" />
        <span className={`term-state term-state-${ended ? "ended" : waiting ? "waiting" : phase.kind}`}>
          {phase.kind === "connecting"
            ? "connecting…"
            : waiting
              ? "waiting for the current turn"
              : phase.kind === "open"
                ? "running"
                : phase.kind === "exited"
                  ? phase.code == null
                    ? "closed"
                    : `exited (${phase.code})`
                  : phase.kind === "lost"
                    ? "connection lost"
                    : "could not open"}
        </span>
        <span className="term-hint muted">{focused ? LEAVE_HINT : "click to type"}</span>
      </div>
      {info?.fallback && (
        <div className="term-banner term-banner-warn" role="note">
          <Icon name="alert" size={14} />
          <span>
            <strong>Shell instead of the TUI:</strong> {info.fallback}
          </span>
        </div>
      )}
      {waiting && (
        <div className="term-banner" role="status">
          <span className="pulse" />
          <span>
            Waiting for the session&apos;s current turn to end; the TUI starts right after it. Input is dropped until then.
          </span>
        </div>
      )}
      {phase.kind === "error" && (
        <div className="term-banner term-banner-err" role="alert">
          <Icon name="x" size={14} />
          <span>Could not open the terminal: {phase.message}</span>
        </div>
      )}
      <div className="term-host" ref={hostRef} />
      {ended && (
        <div className="term-foot">
          <span className="muted">
            {phase.kind === "lost" ? phase.reason : phase.kind === "error" ? "Terminal mode is unavailable" : "The terminal has ended."}
          </span>
          <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
            <Icon name="terminal" size={13} /> Open again
          </button>
        </div>
      )}
    </div>
  );
}

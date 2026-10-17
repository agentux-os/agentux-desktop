import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AskPanel } from "./AskPanel";
import type { Mood } from "./Penguin";
import { getSettings, updateSettings, useHelperSettings, type HelperSettings } from "./settings";
import { ShowMe, Tour } from "./Tour";
import { WhatsThis } from "./WhatsThis";
import { HelperContext, type HelperContextValue, type HelperHost } from "./context";

export { useHelper, useOptionalHelper, type HelperHost } from "./context";

export function HelperProvider({ host, children }: { host: HelperHost; children: ReactNode }) {
  const settings = useHelperSettings();
  const [whatsThis, setWhatsThisState] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [touring, setTouring] = useState(false);
  const [showing, setShowing] = useState<{ key: string; back: HTMLElement | null } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [message, setMessage] = useState("");
  const enabled = settings.enabled;

  const announce = useCallback((text: string) => {
    setMessage("");
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const setWhatsThis = useCallback(
    (on: boolean) => {
      setWhatsThisState(on);
      if (on) {
        setAskOpen(false);
        announce(
          "What's this? is on. Point at or tab to anything and press Enter or click to learn what it is. Escape leaves.",
        );
      } else {
        setExplaining(false);
        announce("What's this? is off.");
      }
    },
    [announce],
  );

  const startTour = useCallback(() => {
    if (!host.tour?.length) return;
    setWhatsThisState(false);
    setAskOpen(false);
    setShowing(null);
    setTouring(true);
  }, [host.tour]);

  const update = useCallback((patch: Partial<HelperSettings>) => void updateSettings(patch), []);

  const showMe = useCallback((key: string, back: HTMLElement | null = null) => setShowing({ key, back }), []);

  // Turning the helper off turns everything it does off.
  useEffect(() => {
    if (enabled) return;
    setWhatsThisState(false);
    setAskOpen(false);
    setTouring(false);
    setShowing(null);
  }, [enabled]);

  // F1: ask; Shift+F1: What's this? (not while a terminal has the keyboard).
  const state = useRef({ enabled, whatsThis, askOpen, touring });
  state.current = { enabled, whatsThis, askOpen, touring };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F1" || e.ctrlKey || e.altKey || e.metaKey) return;
      const s = state.current;
      if (!s.enabled || s.touring) return;
      if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey) setWhatsThis(!s.whatsThis);
      else {
        setWhatsThisState(false);
        setAskOpen(!s.askOpen);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setWhatsThis]);

  const mood: Mood = thinking
    ? "thinking"
    : touring || showing
      ? "pointing"
      : explaining || askOpen
        ? "talking"
        : "idle";

  const value = useMemo<HelperContextValue>(
    () => ({
      host,
      settings,
      update,
      whatsThis: enabled && whatsThis,
      setWhatsThis,
      askOpen: enabled && askOpen,
      setAskOpen,
      touring,
      startTour,
      showMe,
      mood,
      setThinking,
      announce,
    }),
    [host, settings, update, enabled, whatsThis, setWhatsThis, askOpen, touring, startTour, showMe, mood, announce],
  );

  return (
    <HelperContext.Provider value={value}>
      {children}
      {enabled && whatsThis && <WhatsThis onExit={() => setWhatsThis(false)} onExplaining={setExplaining} />}
      {enabled && askOpen && <AskPanel onClose={() => setAskOpen(false)} />}
      {enabled && touring && host.tour && (
        <Tour
          steps={host.tour}
          openSomeRun={host.openSomeRun}
          onEnd={(how) => {
            setTouring(false);
            if (getSettings().tour !== "done") updateSettings({ tour: how === "done" ? "done" : "skipped" });
            announce(how === "done" ? "Tour finished." : "Tour closed.");
          }}
        />
      )}
      {enabled && showing && (
        <ShowMe
          helpKey={showing.key}
          onClose={() => {
            const back = showing.back;
            setShowing(null);
            back?.focus();
          }}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite" data-helper-ui>
        {message}
      </div>
    </HelperContext.Provider>
  );
}

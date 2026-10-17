/**
 * The helper's settings and first-run state, per user, in localStorage. The
 * cockpit and the Welcome window share the origin, so they share these; a
 * change in one window reaches the other through the `storage` event.
 */
import { useSyncExternalStore } from "react";

export type TourState = "new" | "offered" | "done" | "skipped";

export interface HelperSettings {
  /** The penguin is shown (it can be turned off; the choice is kept). */
  enabled: boolean;
  /** The first-run tour: not offered yet, offered (bubble shown), done or skipped. */
  tour: TourState;
  /** Answers from the user's own agent through agentuxd (off by default). */
  ai: boolean;
  /** The harness that answers. */
  aiHarness: string;
}

export const SETTINGS_KEY = "agentux.helper";
/** Set by the Welcome window's "Take the tour"; the cockpit starts the tour and clears it. */
export const TOUR_REQUEST_KEY = "agentux.helper.tourRequest";
/** The Welcome window is open (a heartbeat timestamp); the tour offer waits for it. */
export const WELCOME_OPEN_KEY = "agentux.welcome.open";
/** A heartbeat older than this is a wizard that went away without saying so. */
export const WELCOME_STALE_MS = 90_000;

export const DEFAULTS: HelperSettings = { enabled: true, tour: "new", ai: false, aiHarness: "claude-code" };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the setting holds for this window only */
  }
}

function parse(raw: string | null): HelperSettings {
  if (!raw) return DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<HelperSettings>;
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.enabled,
      tour: v.tour === "offered" || v.tour === "done" || v.tour === "skipped" ? v.tour : "new",
      ai: v.ai === true,
      aiHarness: typeof v.aiHarness === "string" && v.aiHarness ? v.aiHarness : DEFAULTS.aiHarness,
    };
  } catch {
    return DEFAULTS;
  }
}

let current: HelperSettings | undefined;
let raw: string | null = null;
const listeners = new Set<() => void>();

export function getSettings(): HelperSettings {
  const now = read(SETTINGS_KEY);
  if (current === undefined || now !== raw) {
    raw = now;
    current = parse(now);
  }
  return current;
}

export function updateSettings(patch: Partial<HelperSettings>): HelperSettings {
  const next = { ...getSettings(), ...patch };
  current = next;
  raw = JSON.stringify(next);
  write(SETTINGS_KEY, raw);
  for (const l of listeners) l();
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SETTINGS_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHelperSettings(): HelperSettings {
  return useSyncExternalStore(subscribe, getSettings);
}

/** Asks the cockpit (possibly another window) to start the tour. */
export function requestTour(): void {
  write(TOUR_REQUEST_KEY, String(Date.now()));
}

/** Takes a pending tour request, if any. */
export function takeTourRequest(): boolean {
  if (!read(TOUR_REQUEST_KEY)) return false;
  write(TOUR_REQUEST_KEY, null);
  return true;
}

/** The Welcome window says it is open (call every minute or so), or closed. */
export function markWelcomeOpen(open: boolean): void {
  write(WELCOME_OPEN_KEY, open ? String(Date.now()) : null);
}

/** Whether a Welcome window is open now. */
export function welcomeOpen(now = Date.now()): boolean {
  const at = Number(read(WELCOME_OPEN_KEY));
  return Number.isFinite(at) && at > 0 && now - at < WELCOME_STALE_MS;
}

/** For tests: forget the cached settings. */
export function resetSettingsCache(): void {
  current = undefined;
  raw = null;
}

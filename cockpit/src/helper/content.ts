/**
 * The penguin's explanations of the cockpit and the Welcome wizard
 * (`content.json`). Components mark what can be explained with
 * `{...help("key")}`, which sets `data-help="key"`; `content.test.ts` checks
 * that every key used in the UI has an entry here and every entry is used.
 */
import CONTENT from "./content.json";

export interface HelpEntry {
  title: string;
  /** What it is. */
  what: string;
  /** How it works. */
  how?: string;
  /** What you can do with it. */
  do?: string[];
  /** Where to read more. */
  docs?: { label: string; url: string };
}

export type HelpKey = keyof typeof CONTENT;

export const HELP: Record<HelpKey, HelpEntry> = CONTENT;

export const HELP_KEYS = Object.keys(HELP) as HelpKey[];

/** Props that make an element explainable in What's this? mode and a tour target. */
export function help(key: HelpKey): { "data-help": HelpKey } {
  return { "data-help": key };
}

export function helpEntry(key: string): HelpEntry | undefined {
  return (HELP as Record<string, HelpEntry>)[key];
}

/** The element marked with `key`, if it is on screen. */
export function helpTarget(key: string, root: ParentNode = document): HTMLElement | null {
  if (!/^[\w.-]+$/.test(key)) return null;
  const all = Array.from(root.querySelectorAll<HTMLElement>(`[data-help="${key}"]`));
  return all.find(isShown) ?? null;
}

/**
 * Laid out with a size: not `display: none`, not inside something hidden.
 * Without a layout engine (tests), every connected element that is not
 * hidden counts as shown.
 */
export function isShown(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return true;
  return document.documentElement.getBoundingClientRect().width === 0 && !hiddenByStyle(el);
}

function hiddenByStyle(el: HTMLElement): boolean {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden") return true;
  }
  return false;
}

/** Docs home, for answers without a better link. */
export const DOCS_HOME = "https://github.com/agentux-os/agentux/tree/main/docs";

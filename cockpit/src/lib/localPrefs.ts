/** Cockpit settings kept in this window's local storage. */

const CLONE_DIR_KEY = "agentux.cloneDir";
export const DEFAULT_CLONE_DIR = "~/src";

/** Where New run clones repositories: `~/...` or an absolute path. */
export function getCloneDir(): string {
  try {
    return localStorage.getItem(CLONE_DIR_KEY) || DEFAULT_CLONE_DIR;
  } catch {
    return DEFAULT_CLONE_DIR;
  }
}

/** Stores the clone directory; anything but `~/...` or `/...` falls back to the default. Returns what is kept. */
export function setCloneDir(dir: string): string {
  const clean = dir.trim().replace(/\/+$/, "") || DEFAULT_CLONE_DIR;
  const kept = clean === "~" || clean.startsWith("~/") || clean.startsWith("/") ? clean : DEFAULT_CLONE_DIR;
  try {
    if (kept === DEFAULT_CLONE_DIR) localStorage.removeItem(CLONE_DIR_KEY);
    else localStorage.setItem(CLONE_DIR_KEY, kept);
  } catch {
    /* storage unavailable: the default applies */
  }
  return kept;
}

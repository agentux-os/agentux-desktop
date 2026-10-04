import type { DiffHunk, DiffLine } from "../daemon/types";

export interface ComputedDiff {
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** True when the texts were too large to diff and only the new text is shown. */
  newOnly: boolean;
}

/** Above this many cells (changed old lines x changed new lines) the diff is not computed. */
const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline ends the last line rather than starting an empty one.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Every line of `text` as an addition (a new file, or a diff too large to compute). */
function allAdded(newLines: string[], newOnly: boolean): ComputedDiff {
  const lines: DiffLine[] = newLines.map((text, i) => ({ kind: "add", text, newNo: i + 1 }));
  return { additions: lines.length, deletions: 0, hunks: lines.length ? [{ header: "", lines }] : [], newOnly };
}

/**
 * Line diff between two whole file texts (agentuxd sends whole texts, not
 * hunks), grouped into hunks with `context` unchanged lines around changes.
 * `oldText` absent means a new file. LCS over the lines between the common
 * prefix and suffix; very large changes fall back to showing the new text.
 */
export function diffTexts(oldText: string | undefined, newText: string, context = 3): ComputedDiff {
  const b = splitLines(newText);
  if (oldText == null) return allAdded(b, false);
  const a = splitLines(oldText);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_CELLS) return allAdded(b, true);

  // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB).
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[start + i] === b[start + j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const all: DiffLine[] = [];
  for (let k = 0; k < start; k++) all.push({ kind: "ctx", text: a[k], oldNo: k + 1, newNo: k + 1 });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      all.push({ kind: "ctx", text: a[start + i], oldNo: start + i + 1, newNo: start + j + 1 });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // Deletions before additions, as in unified diffs.
      all.push({ kind: "del", text: a[start + i], oldNo: start + i + 1 });
      i++;
    } else {
      all.push({ kind: "add", text: b[start + j], newNo: start + j + 1 });
      j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) {
    all.push({ kind: "ctx", text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }

  let additions = 0;
  let deletions = 0;
  for (const l of all) {
    if (l.kind === "add") additions++;
    if (l.kind === "del") deletions++;
  }

  // Keep changed lines plus `context` lines around them; split into hunks at gaps.
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((l, k) => {
    if (l.kind === "ctx") return;
    for (let x = Math.max(0, k - context); x <= Math.min(all.length - 1, k + context); x++) keep[x] = true;
  });
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | null = null;
  all.forEach((l, k) => {
    if (!keep[k]) {
      current = null;
      return;
    }
    if (!current) {
      current = [];
      hunks.push({ header: `line ${l.newNo ?? l.oldNo}`, lines: current });
    }
    current.push(l);
  });
  return { additions, deletions, hunks, newOnly: false };
}

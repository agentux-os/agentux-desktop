/**
 * The penguin's offline answers: a small BM25 search over the cockpit's help
 * (`content.json`) and the AgentUX documentation bundled at build time
 * (`docs/*.md`, refreshed by `scripts/sync-help-docs.mjs`). No network.
 */
import { HELP, HELP_KEYS, type HelpKey } from "./content";

export interface DocSource {
  id: string;
  title: string;
  url: string;
  markdown: string;
}

export interface Passage {
  id: string;
  /** Where it comes from: a doc's title, or "Cockpit help". */
  source: string;
  heading: string;
  /** Plain text. */
  text: string;
  url?: string;
  /** Set for cockpit help: the element it explains. */
  helpKey?: HelpKey;
}

export interface Hit {
  passage: Passage;
  score: number;
  /** The sentences that match best, for showing. */
  snippet: string;
}

export type Answer =
  | { kind: "hits"; hits: Hit[] }
  /** The question is about the desktop or Linux, not AgentUX. */
  | { kind: "out-of-scope" }
  | { kind: "none" };

// ---- text ------------------------------------------------------------------

const STOP = new Set(
  (
    "a an and are as at be but by can do does for from how i if in into is it its me my of on or so that the " +
    "their them then there these this to was what when where which who why will with you your about after " +
    "should could would get got have has use using used does did not no yes up out than too very just also " +
    "o que como para por uma um de do da dos das em no na os as eu meu minha isso esse essa onde quando qual " +
    "serve funciona fazer faz"
  ).split(" "),
);

const SYNONYMS: Record<string, string[]> = {
  approval: ["approve"],
  approv: ["approve"],
  aprovar: ["approve"],
  aprovacao: ["approve"],
  pr: ["pull", "request"],
  tui: ["terminal"],
  daemon: ["agentuxd"],
  shortcut: ["key"],
  keyboard: ["key"],
  atalho: ["key"],
  cost: ["budget", "spend"],
  price: ["cost"],
  token: ["context"],
  update: ["upgrade", "channel"],
  version: ["agentux-version", "release"],
  config: ["agentux", "yaml"],
  pipeline: ["step"],
  test: ["gate", "check"],
  lint: ["gate", "check"],
  check: ["gate"],
  review: ["reviewer"],
  question: ["ask_human"],
  agente: ["agent"],
  tarefa: ["run"],
};

/** Folds accents and case. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function queryTokens(text: string): string[] {
  const out: string[] = [];
  for (const t of tokens(text)) {
    out.push(t);
    for (const s of SYNONYMS[t] ?? []) out.push(...tokens(s));
  }
  return [...new Set(out)];
}

/** Markdown to readable plain text. */
export function plain(md: string): string {
  return md
    .replace(/```[a-z]*\n?/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2")
    .replace(/^\s*\|?[-:| ]+\|\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^>\s?/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** GitHub's heading anchor. */
export function slug(heading: string): string {
  return fold(heading)
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

// ---- passages --------------------------------------------------------------

const CHUNK = 900;

/** Splits a page into passages by heading, then by paragraphs. */
export function docPassages(doc: DocSource): Passage[] {
  const out: Passage[] = [];
  let heading = doc.title;
  let body: string[] = [];
  let fence = false;
  const flush = () => {
    const text = plain(body.join("\n"));
    body = [];
    if (!text) return;
    const anchor = heading === doc.title ? "" : `#${slug(heading)}`;
    let chunk = "";
    const push = () => {
      if (chunk.trim()) {
        out.push({
          id: `${doc.id}:${out.length}`,
          source: doc.title,
          heading,
          text: chunk.trim(),
          url: doc.url + anchor,
        });
      }
      chunk = "";
    };
    for (const para of text.split(/\n\n+/)) {
      if (chunk && chunk.length + para.length > CHUNK) push();
      chunk += (chunk ? "\n\n" : "") + para;
    }
    push();
  };
  for (const line of doc.markdown.split("\n")) {
    if (/^```/.test(line)) fence = !fence;
    const h = fence ? null : /^#{1,4}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1].replace(/`/g, "").trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return out;
}

export function helpPassages(): Passage[] {
  return HELP_KEYS.map((key) => {
    const e = HELP[key];
    return {
      id: `help:${key}`,
      source: "Cockpit help",
      heading: e.title,
      text: [e.what, e.how, ...(e.do ?? [])]
        .filter((s): s is string => !!s)
        .map((s) => (/[.!?:]$/.test(s) ? s : `${s}.`))
        .join(" "),
      url: e.docs?.url,
      helpKey: key,
    };
  });
}

// ---- index -----------------------------------------------------------------

interface Doc {
  passage: Passage;
  tf: Map<string, number>;
  len: number;
}

export class HelpIndex {
  private docs: Doc[];
  private df = new Map<string, number>();
  private avg: number;

  constructor(passages: Passage[]) {
    this.docs = passages.map((passage) => {
      const tf = new Map<string, number>();
      // The heading counts three times: it says what the passage is about.
      const all = [
        ...tokens(passage.heading),
        ...tokens(passage.heading),
        ...tokens(passage.heading),
        ...tokens(passage.text),
      ];
      for (const t of all) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { passage, tf, len: all.length };
    });
    this.avg = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit = 3): Hit[] {
    const q = queryTokens(query);
    if (!q.length) return [];
    const n = this.docs.length;
    const scored: Hit[] = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        matched++;
        const idf = Math.log(1 + (n - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        score += (idf * (f * 2.2)) / (f + 1.2 * (0.25 + 0.75 * (d.len / this.avg)));
      }
      if (!score) continue;
      // Reward covering more of the question, and the cockpit's own help.
      score *= 0.5 + matched / q.length;
      if (d.passage.helpKey) score *= 1.35;
      scored.push({ passage: d.passage, score, snippet: "" });
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: Hit[] = [];
    for (const h of scored) {
      const k = `${h.passage.source}|${h.passage.heading}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...h, snippet: snippet(h.passage.text, q) });
      if (out.length >= limit) break;
    }
    return out;
  }
}

/** The best one or two sentences for the query, about 320 characters at most. */
export function snippet(text: string, q: string[]): string {
  const sentences = text
    .replace(/\n+/g, " ")
    .replace(/([.!?:])\s+(?=[A-Z`(])/g, "$1\u0000")
    .split("\u0000")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return clip(sentences.join(" "));
  const want = new Set(q);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < sentences.length; i++) {
    const s = tokens(sentences[i]).filter((t) => want.has(t)).length;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return clip([sentences[best], sentences[best + 1]].filter(Boolean).join(" "));
}

function clip(s: string, max = 320): string {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// ---- scope -----------------------------------------------------------------

const DESKTOP = new Set(
  (
    "kde plasma cosmic gnome hyprland waybar kwin dolphin konsole wallpaper taskbar panel dock widget wifi wi fi " +
    "bluetooth printer monitor display resolution font fonts wayland x11 xorg audio sound volume speaker microphone " +
    "network vpn ethernet nvidia driver drivers gpu touchpad mouse brightness screensaver lockscreen " +
    "papel parede impressora rede som"
  )
    .split(" ")
    .map(stem),
);

const AGENTUX = new Set(
  (
    "agentux agentuxd aux cockpit run runs pipeline agent agents harness harnesses approval approve inbox bus worktree " +
    "gate review reviewer planner implementer wizard welcome penguin claude codex opencode antigravity session sessions " +
    "plan yaml acp mcp budget check checks request requests board"
  )
    .split(" ")
    .map(stem),
);

/** About the desktop or Linux rather than AgentUX's own tools. */
export function outOfScope(query: string): boolean {
  const t = tokens(query);
  return t.some((x) => DESKTOP.has(x)) && !t.some((x) => AGENTUX.has(x));
}

/** Below this, a match is noise. */
const MIN_SCORE = 1.2;

export function answer(index: HelpIndex, query: string): Answer {
  if (outOfScope(query)) return { kind: "out-of-scope" };
  const hits = index.search(query).filter((h) => h.score >= MIN_SCORE);
  return hits.length ? { kind: "hits", hits } : { kind: "none" };
}

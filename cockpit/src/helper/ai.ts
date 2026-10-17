/**
 * What the optional AI answer sends to agentuxd's `helper.ask` besides the
 * question: documentation excerpts and a summary of what the user is looking
 * at. Never file contents, diffs, session transcripts or secrets. The rules
 * the agent follows (AgentUX only, no tools) are the daemon's, not ours.
 */
import type { Hit } from "./search";

/** The harnesses that can answer, as in `agentux.yaml`. */
export const AI_HARNESSES: { id: string; label: string; agent: string }[] = [
  { id: "claude-code", label: "Claude Code", agent: "claude" },
  { id: "codex", label: "Codex", agent: "codex" },
  { id: "opencode", label: "OpenCode", agent: "opencode" },
  { id: "antigravity", label: "Antigravity", agent: "antigravity" },
];

export function harnessLabel(id: string): string {
  return AI_HARNESSES.find((h) => h.id === id)?.label ?? id;
}

/** Most of the context agentuxd keeps (48 KiB); ours stays well below. */
const MAX_CONTEXT = 16 * 1024;

/** The context for `helper.ask`: the view summary, then the best passages. */
export function helperContext(view: string, hits: Hit[]): string {
  let out = `## What the user is looking at\n\n${view.trim() || "The AgentUX cockpit."}\n\n## AgentUX documentation excerpts\n`;
  for (const h of hits) {
    const p = h.passage;
    const block = `\n### ${p.source}: ${p.heading}\n\n${p.text}\n${p.url ? `\nSource: ${p.url}\n` : ""}`;
    if (out.length + block.length > MAX_CONTEXT) break;
    out += block;
  }
  return out;
}

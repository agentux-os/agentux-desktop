#!/usr/bin/env node
// Refreshes the AgentUX documentation the helper (the penguin) searches
// offline: copies the pages below from sibling checkouts of the AgentUX
// repositories into src/helper/docs/, as they are on each repository's
// origin/main (not the working tree), and records where each came from in
// src/helper/docs/sources.json. The cockpit bundles these files at build
// time; nothing is fetched at run time.
//
//   node scripts/sync-help-docs.mjs [--root <dir holding the checkouts>]
//
// The default root is the directory that holds this agentux-desktop
// checkout. Run `git fetch` in each repository first.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cockpit = resolve(here, "..");
const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
const root = rootArg >= 0 ? resolve(args[rootArg + 1]) : resolve(cockpit, "..", "..");
const out = join(cockpit, "src", "helper", "docs");

const GH = "https://github.com/agentux-os";

/**
 * Pages to bundle. `sections` keeps only those headings (with everything
 * under them); `until` drops everything from that heading on.
 */
const PAGES = [
  { id: "getting-started", title: "Getting started", repo: "agentux", path: "docs/getting-started.md" },
  {
    id: "cockpit",
    title: "The cockpit (agentux-desktop README)",
    repo: "agentux-desktop",
    path: "README.md",
    until: "Desktop configuration",
  },
  { id: "core", title: "agentuxd and aux (agentux-core README)", repo: "agentux-core", path: "README.md" },
  { id: "api", title: "agentuxd API", repo: "agentux-core", path: "docs/api.md" },
  {
    id: "os",
    title: "Release channels and versions (agentux-os README)",
    repo: "agentux-os",
    path: "README.md",
    sections: ["Release channels", "Version", "AgentUX versions"],
  },
];

function git(repo, ...argv) {
  return execFileSync("git", ["-C", join(root, repo), ...argv], { encoding: "utf8", maxBuffer: 8 << 20 });
}

// Every ADR in agentux's docs/adr on origin/main, titled by its heading, so a
// new ADR is bundled without editing this list.
for (const file of git("agentux", "ls-tree", "--name-only", "origin/main", "docs/adr/").split("\n")) {
  const name = file.split("/").pop();
  if (!/^\d{4}-.*\.md$/.test(name)) continue;
  const heading = git("agentux", "show", `origin/main:${file}`).split("\n")[0];
  const m = /^#\s+(\d{4})\.\s+(.*)$/.exec(heading);
  if (!m) throw new Error(`${file}: first line is not "# NNNN. Title"`);
  PAGES.push({ id: `adr-${m[1]}`, title: `ADR ${m[1]}: ${m[2]}`, repo: "agentux", path: file });
}

/** Drops HTML blocks (badges, pictures, details/summary lines). */
function stripHtml(md) {
  return md
    .split("\n")
    .filter((line) => !/^\s*<\/?(p|a|picture|source|img|h\d|details|summary|br)\b/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function headingOf(line) {
  const m = /^(#{1,6})\s+(.*)$/.exec(line);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

function keepSections(md, names) {
  const lines = md.split("\n");
  const kept = [];
  let keepLevel = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = inFence ? null : headingOf(line);
    if (h) {
      if (keepLevel && h.level <= keepLevel) keepLevel = 0;
      if (!keepLevel && names.includes(h.text)) keepLevel = h.level;
    }
    if (keepLevel) kept.push(line);
  }
  return kept.join("\n");
}

function cutAt(md, name) {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => headingOf(l)?.text === name);
  return i < 0 ? md : lines.slice(0, i).join("\n");
}

mkdirSync(out, { recursive: true });
const sources = [];
for (const page of PAGES) {
  const commit = git(page.repo, "rev-parse", "--short", "origin/main").trim();
  let md = git(page.repo, "show", `origin/main:${page.path}`);
  if (page.sections) md = keepSections(md, page.sections);
  if (page.until) md = cutAt(md, page.until);
  md = stripHtml(md).trim() + "\n";
  writeFileSync(join(out, `${page.id}.md`), md);
  sources.push({
    id: page.id,
    title: page.title,
    url: `${GH}/${page.repo}/blob/main/${page.path}`,
    repo: page.repo,
    path: page.path,
    commit,
  });
  console.log(`${page.id}.md  ${page.repo}/${page.path} @ ${commit}  ${md.length} bytes`);
}
writeFileSync(join(out, "sources.json"), JSON.stringify(sources, null, 2) + "\n");

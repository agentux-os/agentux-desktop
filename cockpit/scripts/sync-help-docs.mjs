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
  ...[
    ["0001-linux-distribution-on-fedora-atomic", "ADR 0001: AgentUX is a Linux distribution on Fedora Atomic"],
    ["0002-harness-integration-via-acp", "ADR 0002: Harness integration via ACP"],
    ["0003-workflow-engine", "ADR 0003: Workflow engine"],
    ["0004-unified-interface-and-agent-bus", "ADR 0004: Unified interface and agent bus"],
    ["0005-agentux-yaml", "ADR 0005: Pipelines in agentux.yaml"],
    ["0007-terminal-mode-is-a-session-handoff", "ADR 0007: Terminal mode is a session handoff"],
    ["0008-releases-and-image-pinning", "ADR 0008: Releases and image pinning"],
    ["0009-container-isolation-for-checks", "ADR 0009: Container isolation for checks"],
    ["0010-image-variants-and-system-identity", "ADR 0010: Image variants and system identity"],
    ["0011-release-channels-and-iso-distribution", "ADR 0011: Release channels and ISO distribution"],
    ["0012-system-version-and-release-identity", "ADR 0012: System version and release identity"],
    ["0013-first-run-wizard", "ADR 0013: First-run wizard"],
    ["0014-installation-profiles-and-platform-services", "ADR 0014: Installation profiles and platform services"],
    ["0015-organization-command-office-contract", "ADR 0015: Organization definitions are versioned domain contracts"],
    ["0017-help-mascot", "ADR 0017: A help mascot that knows AgentUX, offline first"],
  ].map(([file, title]) => ({ id: `adr-${file.slice(0, 4)}`, title, repo: "agentux", path: `docs/adr/${file}.md` })),
];

function git(repo, ...argv) {
  return execFileSync("git", ["-C", join(root, repo), ...argv], { encoding: "utf8", maxBuffer: 8 << 20 });
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

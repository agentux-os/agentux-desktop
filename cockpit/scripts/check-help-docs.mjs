#!/usr/bin/env node
// Checks the penguin's bundled docs (src/helper/docs/) without the other
// repositories: every page in sources.json has its file and the other way
// round, and the pages that describe AgentUX as it is now never mention
// what was retired. ADRs are records of their time and may.
//
//   node scripts/check-help-docs.mjs
//
// Freshness against the other repositories is checked weekly by
// .github/workflows/help-docs.yml, which runs sync-help-docs.mjs.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docs = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "helper", "docs");

/** Retired from AgentUX (ADR 0018 retired the Hyprland variant). */
const RETIRED = [/hyprland/i];

const sources = JSON.parse(readFileSync(join(docs, "sources.json"), "utf8"));
const files = readdirSync(docs).filter((f) => f.endsWith(".md"));
const problems = [];

const listed = new Set(sources.map((s) => `${s.id}.md`));
for (const file of files) if (!listed.has(file)) problems.push(`${file} is not in sources.json`);
for (const file of listed) if (!files.includes(file)) problems.push(`sources.json lists ${file}, which is missing`);

for (const source of sources) {
  if (source.id.startsWith("adr-")) continue;
  const text = readFileSync(join(docs, `${source.id}.md`), "utf8");
  for (const pattern of RETIRED) {
    const line = text.split("\n").findIndex((l) => pattern.test(l));
    if (line >= 0) problems.push(`${source.id}.md:${line + 1} mentions ${pattern.source}, which AgentUX retired`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error("Refresh with: node scripts/sync-help-docs.mjs (after git fetch in each repository)");
  process.exit(1);
}
console.log(`help docs: ${files.length} pages OK`);

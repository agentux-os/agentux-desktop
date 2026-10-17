/**
 * The bundled AgentUX docs and the search index over them, loaded the first
 * time the penguin is asked something (they are a separate chunk).
 */
import { HelpIndex, docPassages, helpPassages, type DocSource } from "./search";
import SOURCES from "./docs/sources.json";

const PAGES = import.meta.glob<string>("./docs/*.md", { query: "?raw", import: "default" });

export async function loadDocs(): Promise<DocSource[]> {
  const docs: DocSource[] = [];
  for (const s of SOURCES) {
    const load = PAGES[`./docs/${s.id}.md`];
    if (!load) continue;
    docs.push({ id: s.id, title: s.title, url: s.url, markdown: await load() });
  }
  return docs;
}

let index: Promise<HelpIndex> | undefined;

/** The help and docs index, built once. */
export function helpIndex(): Promise<HelpIndex> {
  index ??= loadDocs().then((docs) => new HelpIndex([...helpPassages(), ...docs.flatMap(docPassages)]));
  return index;
}

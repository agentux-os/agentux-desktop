import { beforeAll, describe, expect, it } from "vitest";
import { helpIndex, loadDocs } from "./docs";
import { answer, docPassages, outOfScope, slug, type HelpIndex } from "./search";

let index: HelpIndex;

beforeAll(async () => {
  index = await helpIndex();
});

function top(query: string) {
  const a = answer(index, query);
  if (a.kind !== "hits") throw new Error(`no hits for ${query}: ${a.kind}`);
  return a.hits;
}

describe("offline search", () => {
  it("bundles the AgentUX docs", async () => {
    const docs = await loadDocs();
    const ids = docs.map((d) => d.id);
    for (const id of ["getting-started", "core", "api", "cockpit", "adr-0005", "adr-0007", "adr-0012"])
      expect(ids).toContain(id);
    for (const d of docs) expect(d.markdown.length, d.id).toBeGreaterThan(500);
    expect(index.size).toBeGreaterThan(300);
  });

  it("answers how to approve a plan from the cockpit help", () => {
    const hits = top("How do I approve a plan?");
    expect(hits[0].passage.helpKey).toBe("request.plan");
    expect(hits[0].snippet).toMatch(/approve/i);
  });

  it("explains the gate step", () => {
    const hits = top("What does the gate step do?");
    expect(hits.map((h) => h.passage.heading).join(" | ")).toMatch(/gate/i);
  });

  it("finds terminal handoff", () => {
    const hits = top("open a session in its own terminal TUI");
    expect(hits.some((h) => h.passage.helpKey === "panel.mode" || /terminal/i.test(h.passage.heading))).toBe(true);
  });

  it("finds agentux-version in the docs", () => {
    const hits = top("Which release am I on? agentux-version");
    expect(hits.some((h) => /agentux-version/.test(h.passage.text))).toBe(true);
    expect(hits.every((h) => h.passage.url?.startsWith("https://"))).toBe(true);
  });

  it("finds the aux command to answer an agent's question", () => {
    const hits = top("aux answer question");
    expect(hits.some((h) => /aux answer/.test(h.passage.text))).toBe(true);
  });

  it("keeps to AgentUX", () => {
    expect(answer(index, "How do I change the KDE wallpaper?").kind).toBe("out-of-scope");
    expect(answer(index, "my bluetooth headphones don't connect").kind).toBe("out-of-scope");
    expect(outOfScope("Does the cockpit work under COSMIC?")).toBe(false);
    expect(answer(index, "xyzzy plugh frobnicate").kind).toBe("none");
  });

  it("splits pages by heading with GitHub anchors", () => {
    const passages = docPassages({
      id: "t",
      title: "Test",
      url: "https://example.org/t.md",
      markdown: "Intro text.\n\n## 5. `agentux.yaml`\n\nRoles map to harnesses.\n\n```yaml\n# not a heading\n```\n",
    });
    expect(passages.map((p) => p.heading)).toEqual(["Test", "5. agentux.yaml"]);
    expect(passages[1].url).toBe("https://example.org/t.md#5-agentuxyaml");
    expect(slug("3. Cockpit tour")).toBe("3-cockpit-tour");
  });
});

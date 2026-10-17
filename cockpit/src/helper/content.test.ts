import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HELP, HELP_KEYS } from "./content";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "docs" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every help key the UI uses: `help("key")` calls and literal `data-help="key"` attributes. */
function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of sources(SRC)) {
    if (file.endsWith(join("helper", "content.ts"))) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bhelp\("([^"]+)"\)|data-help="([^"]+)"/g)) {
      const key = m[1] ?? m[2];
      used.set(key, [...(used.get(key) ?? []), relative(SRC, file)]);
    }
  }
  return used;
}

describe("help content", () => {
  const used = usedKeys();

  it("has an entry for every key the UI uses", () => {
    const missing = [...used.keys()].filter((k) => !(k in HELP));
    expect(missing).toEqual([]);
  });

  it("uses every entry somewhere in the UI", () => {
    const unused = HELP_KEYS.filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });

  it("covers the cockpit and the Welcome wizard", () => {
    const files = new Set([...used.values()].flat());
    for (const f of [
      "App.tsx",
      "components/Sidebar.tsx",
      "components/SessionPanel.tsx",
      "components/StatusBar.tsx",
      "welcome/Welcome.tsx",
      "welcome/DoneStep.tsx",
    ]) {
      expect(files.has(f.replace(/\//g, process.platform === "win32" ? "\\" : "/")), f).toBe(true);
    }
    expect(HELP_KEYS.length).toBeGreaterThanOrEqual(80);
  });

  it("gives every entry a title, a what and well-formed links", () => {
    for (const key of HELP_KEYS) {
      const e = HELP[key];
      expect(e.title.trim(), key).not.toBe("");
      expect(e.what.trim(), key).not.toBe("");
      if (e.docs) expect(e.docs.url, key).toMatch(/^https:\/\/github\.com\/agentux-os\//);
    }
  });
});

import { describe, expect, it } from "vitest";
import { CATALOG, availableOn, itemSpec, matches, type InstallMethod } from "./catalog";

/**
 * mise tools the catalog may use: checked against mise's registry
 * (github.com/jdx/mise, registry/<tool>.toml) when they were added.
 */
const MISE_REGISTRY = new Set([
  "java", "kotlin", "gradle", "maven", "node", "pnpm", "yarn", "deno", "python", "go", "rust", "dotnet", "ruby",
  "zig", "flutter", "terraform", "opentofu", "kubectl", "helm", "k9s", "kind", "aws-cli", "gcloud", "azure",
]);

/** Flatpak SDK extensions Flathub builds for the 25.08 runtime the VS Code Flatpaks use. */
const SDK_EXTENSIONS = new Set([
  "openjdk17", "openjdk21", "openjdk25", "node20", "node22", "node24", "golang", "rust-stable", "dotnet8", "dotnet9", "dotnet10",
]);

const METHODS: InstallMethod[] = ["flatpak", "jetbrains-toolbox", "mise", "distrobox"];
// The same rule agentux-setup applies before running a command.
const SAFE = /^[A-Za-z0-9._:/@+=,{}-]+$/;
const FLATHUB_ID = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+){2,}$/;

describe("setup catalog", () => {
  const ids = CATALOG.items.map((i) => i.id);

  it("has unique, simple item ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("puts every item in a known category, and every category has items", () => {
    const cats = new Set(CATALOG.categories.map((c) => c.id));
    for (const item of CATALOG.items) expect(cats, item.id).toContain(item.category);
    for (const c of cats) expect(CATALOG.items.some((i) => i.category === c), c).toBe(true);
  });

  it("gives every item a name, a summary and a known method with its fields", () => {
    for (const item of CATALOG.items) {
      expect(item.name.length, item.id).toBeGreaterThan(1);
      expect(item.summary.length, item.id).toBeGreaterThan(5);
      expect(METHODS, item.id).toContain(item.method);
      switch (item.method) {
        case "flatpak":
          expect(item.flatpak, item.id).toMatch(FLATHUB_ID);
          if (item.hostIntegration) {
            expect(item.hostIntegration).toBe("vscode");
            expect(item.settingsDir, item.id).toMatch(new RegExp(`^\\.var/app/${item.flatpak!.replace(/\./g, "\\.")}/config/`));
          }
          break;
        case "mise":
          expect(MISE_REGISTRY, item.id).toContain(item.mise);
          expect(item.defaultVersion, item.id).toBeTruthy();
          break;
        case "distrobox":
          expect(CATALOG.containers[item.container ?? ""], item.id).toBeDefined();
          break;
        case "jetbrains-toolbox":
          break;
      }
    }
  });

  it("does not list a Flathub app twice", () => {
    const apps = CATALOG.items.flatMap((i) => (i.flatpak ? [i.flatpak] : []));
    expect(new Set(apps).size).toBe(apps.length);
  });

  it("offers the default version among the versions, and maps SDK extensions Flathub has", () => {
    for (const item of CATALOG.items) {
      if (item.versions) expect(item.versions.map((v) => v.value), item.id).toContain(item.defaultVersion);
      for (const [version, ext] of Object.entries(item.sdkExtensions ?? {})) {
        expect(SDK_EXTENSIONS, item.id).toContain(ext);
        expect([item.defaultVersion, ...(item.versions ?? []).map((v) => v.value)], item.id).toContain(version);
      }
    }
  });

  it("uses only values agentux-setup accepts in commands", () => {
    for (const item of CATALOG.items) {
      for (const v of [item.flatpak, item.mise, item.settingsDir, item.defaultVersion, item.container, ...(item.packages ?? []), ...(item.versions ?? []).map((x) => x.value)]) {
        if (v !== undefined) expect(v, item.id).toMatch(SAFE);
      }
    }
    for (const c of Object.values(CATALOG.containers)) {
      expect(c.image).toMatch(SAFE);
      for (const word of c.install) expect(word).toMatch(SAFE);
    }
  });

  it("covers what the wizard promises", () => {
    for (const id of ["vscode", "intellij-idea", "pycharm", "dbeaver", "postman", "bruno", "java", "node", "python", "go", "rust", "dotnet", "fedora-dev", "ubuntu-dev", "flatseal"]) {
      expect(ids).toContain(id);
    }
    expect(CATALOG.items.find((i) => i.id === "java")?.versions?.map((v) => v.label)).toEqual(["21 LTS", "17 LTS", "25 LTS"]);
  });

  it("filters by search and architecture, and builds item specs", () => {
    const vscode = CATALOG.items.find((i) => i.id === "vscode")!;
    const java = CATALOG.items.find((i) => i.id === "java")!;
    const slack = CATALOG.items.find((i) => i.id === "slack")!;
    expect(matches(vscode, "visual")).toBe(true);
    expect(matches(vscode, "com.visualstudio")).toBe(true);
    expect(matches(vscode, "flatpak")).toBe(true);
    expect(matches(vscode, "postgres")).toBe(false);
    expect(availableOn(slack, "aarch64")).toBe(false);
    expect(availableOn(slack, "x86_64")).toBe(true);
    expect(availableOn(vscode, "aarch64")).toBe(true);
    expect(itemSpec(java)).toBe("java");
    expect(itemSpec(java, "temurin-21")).toBe("java");
    expect(itemSpec(java, "temurin-17")).toBe("java@temurin-17");
    expect(itemSpec(vscode, "x")).toBe("vscode");
  });
});

// Network check, off by default: CHECK_FLATHUB=1 npm test
describe.runIf(typeof process !== "undefined" && process.env.CHECK_FLATHUB === "1")("Flathub", () => {
  it("knows every Flatpak in the catalog, for the architectures it claims", async () => {
    for (const item of CATALOG.items.filter((i) => i.flatpak)) {
      const res = await fetch(`https://flathub.org/api/v2/summary/${item.flatpak}`);
      expect(res.ok, item.flatpak).toBe(true);
      const arches = ((await res.json()) as { arches: string[] }).arches;
      for (const a of item.arches ?? ["x86_64", "aarch64"]) expect(arches, item.flatpak).toContain(a);
    }
  }, 120_000);
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import { planCommands } from "./commands";

const REMOTE_FILE = "/usr/share/agentux/setup/flathub.flatpakrepo";

describe("planCommands", () => {
  it("installs a Flatpak per user from Flathub, adding the remote first", () => {
    expect(planCommands(["flatseal"]).map((c) => c.command)).toEqual([
      `flatpak remote-add --user --if-not-exists flathub ${REMOTE_FILE}`,
      "flatpak install --user --noninteractive --or-update flathub com.github.tchx84.Flatseal",
    ]);
  });

  it("gives VS Code host integration: D-Bus to Flatpak, home, settings and SDK extensions", () => {
    expect(planCommands(["vscode"])).toEqual(
      [
        `flatpak remote-add --user --if-not-exists flathub ${REMOTE_FILE}`,
        "flatpak install --user --noninteractive --or-update flathub com.visualstudio.code",
        "flatpak override --user --talk-name=org.freedesktop.Flatpak --filesystem=home com.visualstudio.code",
        "agentux-setup vscode-settings com.visualstudio.code .var/app/com.visualstudio.code/config/Code/User",
        "agentux-setup vscode-sdks",
      ].map((command) => ({ item: "vscode", command })),
    );
  });

  it("uses mise globally, with the picked or the default version", () => {
    expect(planCommands(["java", "java@temurin-17", "node", "python", "kubectl"]).map((c) => c.command)).toEqual([
      "mise use --global java@temurin-21",
      "agentux-setup vscode-sdks",
      "mise use --global java@temurin-17",
      "agentux-setup vscode-sdks",
      "mise use --global node@lts",
      "agentux-setup vscode-sdks",
      "mise use --global python@latest",
      "mise use --global kubectl@latest",
    ]);
  });

  it("installs JetBrains IDEs through Toolbox, never a JetBrains Flatpak", () => {
    for (const item of CATALOG.items.filter((i) => i.toolboxProduct)) {
      expect(planCommands([item.id]).map((c) => c.command)).toEqual(["agentux-setup jetbrains-toolbox"]);
    }
    expect(CATALOG.items.some((i) => i.flatpak?.startsWith("com.jetbrains."))).toBe(false);
  });

  it("creates Distrobox containers and installs packages in them", () => {
    expect(planCommands(["ubuntu-dev"]).map((c) => c.command)).toEqual([
      "agentux-setup distrobox-create ubuntu-dev quay.io/toolbx/ubuntu-toolbox:24.04",
    ]);
    expect(planCommands(["elixir"], CATALOG, "44").map((c) => c.command)).toEqual([
      "agentux-setup distrobox-create fedora-dev registry.fedoraproject.org/fedora-toolbox:44",
      "distrobox enter -T fedora-dev -- sudo dnf -y install elixir erlang",
    ]);
  });

  it("rejects unknown items", () => {
    expect(() => planCommands(["nope"])).toThrow(/unknown item/);
  });
});

/** bash and jq, as the image has them (not on Windows). */
function haveShell(): boolean {
  if (process.platform === "win32" && process.env.AGENTUX_SETUP_SHELL_TEST !== "1") return false;
  try {
    execFileSync("bash", ["-c", "command -v jq"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(haveShell())("agentux-setup plan (the script)", () => {
  const script = fileURLToPath(new URL("../../../common/usr/libexec/agentux-setup", import.meta.url));
  const catalog = fileURLToPath(new URL("../../../common/usr/share/agentux/setup/catalog.json", import.meta.url));

  function plan(specs: string[], fedora: string): { item: string; command: string }[] {
    // A fake os-release for the {fedora} image tag.
    const dir = mkdtempSync(join(tmpdir(), "agentux-setup-"));
    writeFileSync(join(dir, "os-release"), `VERSION_ID=${fedora}\n`);
    try {
      const out = execFileSync("bash", [script, "plan", ...specs], {
        env: { ...process.env, AGENTUX_SETUP_CATALOG: catalog, AGENTUX_OS_RELEASE: join(dir, "os-release"), HOME: dir },
        encoding: "utf8",
      });
      return out
        .trim()
        .split("\n")
        .map((line) => {
          const [item, command] = line.split("\t");
          return { item, command };
        });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("prints exactly what the UI shows, for every catalog item", () => {
    const specs = [...CATALOG.items.map((i) => i.id), "java@temurin-25", "node@22"];
    expect(plan(specs, "44")).toEqual(planCommands(specs, CATALOG, "44"));
  }, 120_000);

  it("refuses unknown items and bad versions", () => {
    expect(() => execFileSync("bash", [script, "plan", "nope"], { env: { ...process.env, AGENTUX_SETUP_CATALOG: catalog }, stdio: "pipe" })).toThrow();
    expect(() => execFileSync("bash", [script, "plan", "java@$(id)"], { env: { ...process.env, AGENTUX_SETUP_CATALOG: catalog }, stdio: "pipe" })).toThrow();
  });
});

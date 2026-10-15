/**
 * The commands a setup batch runs, item by item: the same lines
 * `agentux-setup plan` prints (a test runs the script and compares). The
 * wizard shows them under each selected item; the mock client "runs" them.
 * `agentux-setup X` lines are steps of the script itself (see its header).
 */
import { CATALOG, type Catalog, type CatalogItem } from "./catalog";

export interface PlannedCommand {
  item: string;
  command: string;
}

export function parseSpec(spec: string): { id: string; version?: string } {
  const at = spec.indexOf("@");
  return at < 0 ? { id: spec } : { id: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** Commands for one item; `fedora` stands in for the system's Fedora version. */
export function itemCommands(item: CatalogItem, version?: string, catalog: Catalog = CATALOG, fedora = "44"): string[] {
  switch (item.method) {
    case "flatpak": {
      const { remote, remoteFile } = catalog.flatpak;
      const cmds = [
        `flatpak remote-add --user --if-not-exists ${remote} ${remoteFile}`,
        `flatpak install --user --noninteractive --or-update ${remote} ${item.flatpak}`,
      ];
      if (item.hostIntegration === "vscode") {
        cmds.push(
          `flatpak override --user --talk-name=org.freedesktop.Flatpak --filesystem=home ${item.flatpak}`,
          `agentux-setup vscode-settings ${item.flatpak} ${item.settingsDir}`,
          "agentux-setup vscode-sdks",
        );
      }
      return cmds;
    }
    case "jetbrains-toolbox":
      return ["agentux-setup jetbrains-toolbox"];
    case "mise": {
      const cmds = [`mise use --global ${item.mise}@${version || item.defaultVersion || "latest"}`];
      if (item.sdkExtensions) cmds.push("agentux-setup vscode-sdks");
      return cmds;
    }
    case "distrobox": {
      const name = item.container ?? "";
      const container = catalog.containers[name];
      if (!container) throw new Error(`${item.id}: unknown container ${name}`);
      const cmds = [`agentux-setup distrobox-create ${name} ${container.image.split("{fedora}").join(fedora)}`];
      if (item.packages?.length) {
        cmds.push(`distrobox enter -T ${name} -- ${container.install.join(" ")} ${item.packages.join(" ")}`);
      }
      return cmds;
    }
  }
}

/** The plan for a batch of `ITEM[@VERSION]` specs, in order. */
export function planCommands(specs: string[], catalog: Catalog = CATALOG, fedora = "44"): PlannedCommand[] {
  return specs.flatMap((spec) => {
    const { id, version } = parseSpec(spec);
    const item = catalog.items.find((i) => i.id === id);
    if (!item) throw new Error(`unknown item: ${id}`);
    return itemCommands(item, version, catalog, fedora).map((command) => ({ item: id, command }));
  });
}

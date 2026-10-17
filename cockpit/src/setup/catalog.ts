/**
 * The setup catalog: every tool the welcome wizard offers and how it installs.
 * The data file ships in the common desktop bundle as
 * /usr/share/agentux/setup/catalog.json, where `agentux-setup` reads it; the
 * cockpit bundles the same file for the UI.
 */
import catalogJson from "../../../common/usr/share/agentux/setup/catalog.json";

/** How an item installs. */
export type InstallMethod = "flatpak" | "jetbrains-toolbox" | "mise" | "distrobox";

export interface CatalogVersion {
  value: string;
  label: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  summary: string;
  category: string;
  method: InstallMethod;
  /** Flathub application id (method flatpak). */
  flatpak?: string;
  /** Host integration applied after the Flatpak installs (VS Code and VSCodium). */
  hostIntegration?: "vscode";
  /** Where the app keeps its user settings, relative to $HOME. */
  settingsDir?: string;
  /** The product to install from JetBrains Toolbox (method jetbrains-toolbox). */
  toolboxProduct?: string;
  /** mise tool name (method mise). */
  mise?: string;
  versions?: CatalogVersion[];
  defaultVersion?: string;
  /** Flatpak SDK extension per requested version, for the sandboxed VS Code. */
  sdkExtensions?: Record<string, string>;
  /** Distrobox container (method distrobox). */
  container?: string;
  /** Packages installed in that container. */
  packages?: string[];
  /** Preselected in the wizard. */
  recommended?: boolean;
  /** Architectures the item exists for; all when absent. */
  arches?: string[];
}

export interface CatalogContainer {
  name: string;
  /** `{fedora}` stands for the system's Fedora version. */
  image: string;
  install: string[];
}

export interface Catalog {
  version: number;
  flatpak: { remote: string; remoteFile: string; sdkBranch: string };
  jetbrainsToolbox: { releases: string; dir: string };
  containers: Record<string, CatalogContainer>;
  categories: { id: string; name: string }[];
  items: CatalogItem[];
}

export const CATALOG = catalogJson as Catalog;

export const METHOD_LABEL: Record<InstallMethod, string> = {
  flatpak: "Flatpak",
  "jetbrains-toolbox": "JetBrains Toolbox",
  mise: "mise",
  distrobox: "Distrobox",
};

export const METHOD_HINT: Record<InstallMethod, string> = {
  flatpak: "A sandboxed app from Flathub, installed for you only",
  "jetbrains-toolbox": "Installed with JetBrains Toolbox in your home directory, no sandbox",
  mise: "Installed with mise in your home directory and on your PATH",
  distrobox: "Installed in a Distrobox container you can enter from any terminal",
};

export function itemById(id: string, catalog: Catalog = CATALOG): CatalogItem | undefined {
  return catalog.items.find((i) => i.id === id);
}

export function categoryName(id: string, catalog: Catalog = CATALOG): string {
  return catalog.categories.find((c) => c.id === id)?.name ?? id;
}

/** Whether the item exists for this machine's architecture (unknown: assume yes). */
export function availableOn(item: CatalogItem, arch: string | undefined): boolean {
  return !arch || !item.arches || item.arches.includes(arch);
}

/** Case-insensitive match on name, summary, id, Flathub id and method. */
export function matches(item: CatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.summary, item.id, item.flatpak ?? "", item.mise ?? "", METHOD_LABEL[item.method]]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** `ITEM` or `ITEM@VERSION`, as `agentux-setup` takes it. */
export function itemSpec(item: CatalogItem, version?: string): string {
  if (item.method !== "mise") return item.id;
  const v = version || item.defaultVersion;
  return v && v !== item.defaultVersion ? `${item.id}@${v}` : item.id;
}

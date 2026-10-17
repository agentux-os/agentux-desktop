import { forwardRef, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import {
  CATALOG,
  METHOD_HINT,
  METHOD_LABEL,
  availableOn,
  matches,
  type CatalogItem,
  type InstallMethod,
} from "../setup/catalog";
import { itemCommands } from "../setup/commands";
import type { ItemStatus, SetupStatus } from "../setup/client";
import { help } from "../helper/content";

/** Selected items and the version picked for each (undefined: the default). */
export type Selection = Map<string, string | undefined>;

/** The legend above the catalog: how each method installs, in a few words. */
const METHOD_SHORT: Record<InstallMethod, string> = {
  flatpak: "sandboxed, from Flathub",
  "jetbrains-toolbox": "IDEs, no sandbox",
  mise: "languages and CLIs",
  distrobox: "a mutable container",
};

const LAUNCHABLE: InstallMethod[] = ["flatpak", "jetbrains-toolbox", "distrobox"];

export function isBusy(s: ItemStatus | undefined): boolean {
  return s?.state === "queued" || s?.state === "running";
}

interface Props {
  status: SetupStatus | null;
  installed: Set<string>;
  selection: Selection;
  onToggle: (item: CatalogItem, on: boolean) => void;
  onVersion: (item: CatalogItem, version: string) => void;
  onInstall: () => void;
  onRetry: (item: CatalogItem) => void;
  onLaunch: (item: CatalogItem) => void;
}

export const ToolsStep = forwardRef<HTMLInputElement, Props>(function ToolsStep(
  { status, installed, selection, onToggle, onVersion, onInstall, onRetry, onLaunch },
  searchRef,
) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selectedOnly, setSelectedOnly] = useState(false);

  const groups = useMemo(() => {
    const items = CATALOG.items.filter(
      (i) => matches(i, query) && (category === "all" || i.category === category) && (!selectedOnly || selection.has(i.id)),
    );
    return CATALOG.categories
      .map((c) => ({ ...c, items: items.filter((i) => i.category === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [query, category, selectedOnly, selection]);

  const pending = [...selection.keys()].filter((id) => !installed.has(id) && !isBusy(status?.items[id]));
  const count = (cat: string) => CATALOG.items.filter((i) => cat === "all" || i.category === cat).length;

  return (
    <div className="wz-tools">
      <p className="wz-legend" {...help("wz.tools.legend")}>
        {(Object.keys(METHOD_LABEL) as InstallMethod[]).map((m) => (
          <span key={m} title={METHOD_HINT[m]}>
            <span className={`wz-method m-${m}`}>{METHOD_LABEL[m]}</span> {METHOD_SHORT[m]}
          </span>
        ))}
      </p>

      <div className="wz-filter" {...help("wz.tools.search")}>
        <label className="wz-search">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search editors, SDKs, databases…"
            aria-label="Search tools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <label className="wz-toggle">
          <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />
          Selected only
        </label>
      </div>
      <div className="wz-cats" role="group" aria-label="Categories">
        {[{ id: "all", name: "All" }, ...CATALOG.categories].map((c) => (
          <button
            key={c.id}
            className={`chip-btn ${category === c.id ? "is-on" : ""}`}
            aria-pressed={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.name} <span className="wz-cat-count">{count(c.id)}</span>
          </button>
        ))}
      </div>

      <div className="wz-catalog">
        {groups.length === 0 && <p className="muted wz-empty">Nothing matches “{query}”.</p>}
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`cat-${g.id}`}>
            <h3 id={`cat-${g.id}`} className="wz-cat-title">
              {g.name}
            </h3>
            <ul className="wz-items">
              {g.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  arch={status?.arch}
                  itemStatus={status?.items[item.id]}
                  installed={installed.has(item.id)}
                  selected={selection.has(item.id)}
                  version={selection.get(item.id)}
                  onToggle={onToggle}
                  onVersion={onVersion}
                  onRetry={onRetry}
                  onLaunch={onLaunch}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="wz-installbar">
        <div className="wz-installbar-text">
          {pending.length ? (
            <>
              <strong>{pending.length} selected</strong>
              <span className="muted ellipsis">
                {pending.map((id) => CATALOG.items.find((i) => i.id === id)?.name ?? id).join(", ")}
              </span>
            </>
          ) : (
            <span className="muted">Tick what you want. Installs run in the background; you can close this window.</span>
          )}
        </div>
        <button className="btn btn-primary" disabled={!pending.length} onClick={onInstall} {...help("wz.tools.install")}>
          <Icon name="arrowRight" size={14} />
          Install{pending.length ? ` ${pending.length}` : ""}
        </button>
      </div>
    </div>
  );
});

function ItemRow({
  item,
  arch,
  itemStatus,
  installed,
  selected,
  version,
  onToggle,
  onVersion,
  onRetry,
  onLaunch,
}: {
  item: CatalogItem;
  arch: string | undefined;
  itemStatus: ItemStatus | undefined;
  installed: boolean;
  selected: boolean;
  version: string | undefined;
  onToggle: Props["onToggle"];
  onVersion: Props["onVersion"];
  onRetry: Props["onRetry"];
  onLaunch: Props["onLaunch"];
}) {
  const available = availableOn(item, arch);
  const busy = isBusy(itemStatus);
  const failed = itemStatus?.state === "failed";
  const done = installed || itemStatus?.state === "done";
  const id = `item-${item.id}`;
  const [showCmds, setShowCmds] = useState(false);
  const checked = done || busy || selected;

  return (
    <li {...help("wz.tools.item")} className={`wz-item ${checked ? "is-on" : ""} ${!available ? "is-off" : ""} ${failed ? "is-failed" : ""}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={!available || done || busy}
        onChange={(e) => onToggle(item, e.target.checked)}
        aria-describedby={`${id}-sum`}
      />
      <div className="wz-item-text">
        <label htmlFor={id} className="wz-item-name">
          {item.name}
        </label>
        <span id={`${id}-sum`} className="wz-item-sum">
          {item.summary}
          {!available && <> Not available for {arch}.</>}
        </span>
        {(busy || failed) && itemStatus?.message && (
          <span className={`wz-item-msg mono ${failed ? "err" : ""}`} title={itemStatus.message}>
            {itemStatus.message}
          </span>
        )}
        {showCmds && (
          <pre className="wz-snippet wz-cmds">{itemCommands(item, version).join("\n")}</pre>
        )}
      </div>
      <div className="wz-item-side">
        {item.versions && (
          <select
            aria-label={`${item.name} version`}
            value={version ?? item.defaultVersion}
            disabled={done || busy}
            onChange={(e) => onVersion(item, e.target.value)}
          >
            {item.versions.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        )}
        <button
          className={`wz-method m-${item.method}`}
          title={`${METHOD_HINT[item.method]}. Show the commands.`}
          aria-expanded={showCmds}
          aria-label={`${METHOD_LABEL[item.method]}: show the commands for ${item.name}`}
          onClick={() => setShowCmds((v) => !v)}
        >
          {METHOD_LABEL[item.method]}
        </button>
        <ItemPill state={done ? "done" : itemStatus?.state} />
        {failed && (
          <button className="btn" onClick={() => onRetry(item)}>
            Retry
          </button>
        )}
        {done && LAUNCHABLE.includes(item.method) && (
          <button className="btn" onClick={() => onLaunch(item)} aria-label={`Open ${item.name}`}>
            Open
          </button>
        )}
      </div>
    </li>
  );
}

function ItemPill({ state }: { state: ItemStatus["state"] | undefined }) {
  if (!state) return null;
  const label = { queued: "Queued", running: "Installing…", done: "Installed", failed: "Failed" }[state];
  return (
    <span className={`wz-pill is-${state}`} role="status">
      {state === "running" && <span className="wz-spin" aria-hidden="true" />}
      {label}
    </span>
  );
}

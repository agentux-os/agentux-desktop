import { Icon } from "../components/Icon";
import { CATALOG, type CatalogItem } from "../setup/catalog";
import type { SetupClient, SetupStatus } from "../setup/client";

export const LINKS = {
  site: "https://agentuxos.org",
  gettingStarted: "https://github.com/agentux-os/agentux/blob/main/docs/getting-started.md",
};

export function DoneStep({
  client,
  status,
  installed,
  onOpenCockpit,
  onError,
}: {
  client: SetupClient;
  status: SetupStatus | null;
  installed: Set<string>;
  onOpenCockpit: () => void;
  onError: (message: string) => void;
}) {
  const items = Object.values(status?.items ?? {});
  const byState = (s: string) =>
    items
      .filter((i) => i.state === s)
      .map((i) => CATALOG.items.find((c) => c.id === i.id))
      .filter((c): c is CatalogItem => !!c);
  const running = [...byState("queued"), ...byState("running")];
  const failed = byState("failed");
  const done = CATALOG.items.filter((i) => installed.has(i.id));
  const agentsReady = status?.agents.filter((a) => a.installed).length ?? 0;
  const toolbox = CATALOG.items.filter(
    (i) => i.toolboxProduct && (installed.has(i.id) || status?.items[i.id]?.state === "done"),
  );
  const open = (url: string) => void client.openUrl(url).catch((e: Error) => onError(e.message));

  return (
    <div className="wz-stack">
      <div className="wz-summary">
        <Summary label="Agent CLIs ready" value={`${agentsReady}/4`} tone={agentsReady === 4 ? "ok" : undefined} />
        <Summary label="Installed" value={String(done.length)} tone={done.length ? "ok" : undefined} />
        <Summary label="Installing" value={String(running.length)} tone={running.length ? "attention" : undefined} />
        <Summary label="Failed" value={String(failed.length)} tone={failed.length ? "err" : undefined} />
      </div>

      {running.length > 0 && (
        <p className="wz-note">
          <span className="wz-spin" aria-hidden="true" /> Still installing {names(running)}. That carries on in the
          background after you close this window.
        </p>
      )}
      {failed.length > 0 && (
        <p className="wz-note err">
          <Icon name="alert" size={14} /> {names(failed)} did not install. Go back to Tools to retry; the logs are in{" "}
          <code>~/.local/state/agentux/setup/logs/</code>.
        </p>
      )}
      {toolbox.length > 0 && (
        <div className="wz-card wz-row">
          <div>
            <strong>Finish in JetBrains Toolbox</strong>
            <p className="muted">
              Toolbox installs and updates JetBrains IDEs. Open it and install {names(toolbox, (i) => i.toolboxProduct ?? i.name)}.
            </p>
          </div>
          <button className="btn" onClick={() => void client.launch("jetbrains-toolbox").catch((e: Error) => onError(e.message))}>
            Open Toolbox
          </button>
        </div>
      )}

      <div className="wz-links">
        <button className="wz-link-card" onClick={() => open(LINKS.gettingStarted)}>
          <Icon name="file" size={18} />
          <span>
            <strong>Getting started</strong>
            <span className="muted">Your first run, the agent bus and terminal mode</span>
          </span>
          <Icon name="arrowRight" size={14} />
        </button>
        <button className="wz-link-card" onClick={() => open(LINKS.site)}>
          <Icon name="globe" size={18} />
          <span>
            <strong>agentuxos.org</strong>
            <span className="muted">News, downloads and the docs</span>
          </span>
          <Icon name="arrowRight" size={14} />
        </button>
      </div>

      <div className="wz-finale">
        <div>
          <strong>You're set.</strong>
          <p className="muted">
            Press <kbd>Meta</kbd> + <kbd>A</kbd> any time for the cockpit. This wizard stays in the app menu as “Welcome to
            AgentUX” and in the cockpit's sidebar.
          </p>
        </div>
        <button className="btn btn-primary wz-big" onClick={onOpenCockpit}>
          Open the cockpit
          <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "ok" | "attention" | "err" }) {
  return (
    <div className={`wz-stat ${tone ?? ""}`}>
      <span className="wz-stat-value">{value}</span>
      <span className="wz-stat-label">{label}</span>
    </div>
  );
}

function names(items: CatalogItem[], name: (i: CatalogItem) => string = (i) => i.name): string {
  const list = items.map(name);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

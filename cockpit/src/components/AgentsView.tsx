import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { AgentPrefs, DaemonClient, HarnessInfo, HarnessTestResult, ToolInfo, ToolsListing } from "../daemon/client";
import { VENDORS, type Vendor } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import type { AgentId, SetupClient } from "../setup/client";
import { formatUsd } from "../lib/format";
import { help } from "../helper/content";
import { Icon } from "./Icon";
import { limitText } from "./NewRunDialog";

/** The wizard's id of each harness (agentux-setup's sign-in and update). */
const SETUP_ID: Record<string, AgentId> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  antigravity: "antigravity",
};

export function agentName(id: string): string {
  return (VENDORS as readonly string[]).includes(id) ? VENDOR_INFO[id as Vendor].label : id;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err);
}

/** The user's order, then the other agents. */
export function orderedIds(prefs: AgentPrefs | null, ids: string[]): string[] {
  const first = (prefs?.order ?? []).filter((id) => ids.includes(id));
  return [...first, ...ids.filter((id) => !first.includes(id))];
}

interface Props {
  client: Pick<DaemonClient, "harnesses" | "clearLimit" | "testHarness" | "getPrefs" | "tools">;
  /** The wizard's backend, for sign-in and update terminals; null where there is none. */
  setup: () => Promise<SetupClient | null>;
  /** Opens Settings, where the agent preferences are. */
  onSettings?: () => void;
}

/**
 * Every agent CLI in one place: installed, signed in, version, spending,
 * plan usage and limits, with sign-in, test and update. The agent
 * preferences are in Settings.
 */
export function AgentsView({ client, setup, onSettings }: Props) {
  const [agents, setAgents] = useState<HarnessInfo[] | null>(null);
  const [prefs, setPrefs] = useState<AgentPrefs | null>(null);
  const [tools, setTools] = useState<ToolsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, HarnessTestResult | "running">>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, p, t] = await Promise.all([
        client.harnesses(),
        client.getPrefs().catch(() => null),
        client.tools().catch(() => null),
      ]);
      setAgents(list);
      setPrefs(p);
      setTools(t);
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    try {
      const result = await client.testHarness(id);
      setTests((t) => ({ ...t, [id]: result }));
      if (result.limit) void load();
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { harness: id, ok: false, detail: errorText(err), seconds: 0, limit: null } }));
    }
  };

  const terminal = (id: string, what: "signIn" | "updateAgent") =>
    act(async () => {
      const s = await setup();
      if (!s) throw new Error("Sign-in and updates need the AgentUX desktop");
      const agent = SETUP_ID[id];
      if (!agent) throw new Error(`no sign-in for ${id}`);
      await (what === "signIn" ? s.signIn(agent) : s.updateAgent(agent));
    });

  if (!agents) {
    return (
      <div className="agents-view">
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : (
          <p className="muted">Loading agents…</p>
        )}
      </div>
    );
  }

  const order = orderedIds(prefs, agents.map((a) => a.id));
  return (
    <div className="agents-view">
      <div className="agents-head">
        <p className="muted">
          The agent CLIs runs use, in your order. Sign-in, updates and keys stay with each vendor's own CLI; AgentUX only
          reads what they report.
        </p>
        {onSettings && (
          <button className="btn btn-quiet" onClick={onSettings}>
            Preferences
          </button>
        )}
        <button className="btn btn-quiet" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="agent-cards">
        {order
          .map((id) => agents.find((a) => a.id === id))
          .filter((a): a is HarnessInfo => !!a)
          .map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              test={tests[a.id]}
              onTest={() => void test(a.id)}
              onSignIn={() => void terminal(a.id, "signIn")}
              onUpdate={() => void terminal(a.id, "updateAgent")}
              onLift={() =>
                void act(async () => {
                  await client.clearLimit(a.id);
                  await load();
                })
              }
            />
          ))}
      </div>
      {tools && <ToolsSection tools={tools} />}
    </div>
  );
}

/**
 * The tool catalog (agentux-core#68): the MCP servers every agent's sessions
 * get, declared once in tools.yaml or agentux.yaml.
 */
function ToolsSection({ tools }: { tools: ToolsListing }) {
  return (
    <section className="agent-tools" aria-label="Tools" {...help("agents.tools")}>
      <h3>Tools</h3>
      {tools.mcp.length === 0 ? (
        <p className="muted">
          No MCP servers yet. <code>aux tools add NAME --command CMD</code> gives one to every agent.
        </p>
      ) : (
        <ul className="tool-list">
          {tools.mcp.map((t) => (
            <ToolRow key={t.name} tool={t} />
          ))}
        </ul>
      )}
      {tools.notes.map((n) => (
        <p key={n} className="form-error">
          {n}
        </p>
      ))}
    </section>
  );
}

function ToolRow({ tool: t }: { tool: ToolInfo }) {
  const missing = t.secrets.filter((s) => !s.set);
  return (
    <li className="tool-row">
      <div className="tool-name">
        <strong>{t.name}</strong>
        <span className="muted">{t.source} catalog</span>
      </div>
      <span className="mono muted tool-target">{t.url ?? t.command}</span>
      <span>{t.harnesses ? t.harnesses.map(agentName).join(", ") : "Every agent"}</span>
      {missing.length > 0 ? (
        <span className="wz-pill is-failed" title="Sessions go without this server until the secret is set">
          {missing.map((s) => s.name).join(", ")} not set
        </span>
      ) : (
        <span className="wz-pill is-installed">Ready</span>
      )}
    </li>
  );
}

function AgentCard({
  agent: a,
  test,
  onTest,
  onSignIn,
  onUpdate,
  onLift,
}: {
  agent: HarnessInfo;
  test: HarnessTestResult | "running" | undefined;
  onTest: () => void;
  onSignIn: () => void;
  onUpdate: () => void;
  onLift: () => void;
}) {
  const info = (VENDORS as readonly string[]).includes(a.id) ? VENDOR_INFO[a.id as Vendor] : null;
  const style = { ["--vc" as string]: `var(${info?.colorVar ?? "--text-muted"})` } as CSSProperties;
  const signed = a.signedIn === true ? "Signed in" : a.signedIn === false ? "Not signed in" : "Sign-in unknown";
  return (
    <article className="wz-card wz-agent agent-card" style={style} aria-label={agentName(a.id)} {...help("agents.card")}>
      <div className="wz-agent-top">
        <span className="wz-agent-mono">{info?.mono ?? a.id.slice(0, 2).toUpperCase()}</span>
        <div className="wz-agent-name">
          <strong>{agentName(a.id)}</strong>
          <span className="muted mono">{a.version ?? (a.installed ? a.command : "not installed")}</span>
        </div>
        <span className={`wz-pill ${a.installed ? (a.signedIn === false ? "is-failed" : "is-installed") : "is-failed"}`}>
          {a.installed ? signed : "Not installed"}
        </span>
      </div>
      {a.experimental && <p className="muted">Experimental in AgentUX.</p>}
      {a.usage && (
        <p className="agent-usage">
          <span>
            Today <strong>{formatUsd(a.usage.todayUsd)}</strong>
          </span>
          <span>
            7 days <strong>{formatUsd(a.usage.weekUsd)}</strong> · {a.usage.weekSessions} sessions
          </span>
        </p>
      )}
      {(a.quota ?? []).map((q) => (
        <div className="agent-quota" key={q.label} title={q.resetsAt ? `Resets ${new Date(q.resetsAt).toLocaleString()}` : undefined}>
          <span>{q.label} window</span>
          <span className={`budget-bar ${q.usedPercent >= 90 ? "is-over" : ""}`}>
            <span style={{ width: `${Math.min(100, q.usedPercent)}%` }} />
          </span>
          <span className="mono">{Math.round(q.usedPercent)}%</span>
        </div>
      ))}
      {(a.limits ?? []).map((l) => (
        <div className="limit-list-item" key={`${l.harness}/${l.model ?? ""}`} title={l.message}>
          <Icon name="alert" size={13} />
          <span>{limitText(l)}</span>
          <button className="btn btn-quiet" onClick={onLift}>
            Limit lifted
          </button>
        </div>
      ))}
      {test && (
        <p className={`agent-test ${test === "running" ? "" : test.ok ? "ok" : "err"}`} role="status">
          {test === "running"
            ? "Testing…"
            : test.ok
              ? `Answered in ${test.seconds.toFixed(1)} s: ${test.detail.slice(0, 120)}`
              : `No answer: ${test.detail.slice(0, 300)}`}
        </p>
      )}
      <div className="wz-agent-actions">
        <button className="btn" disabled={!a.installed || test === "running"} onClick={onTest}>
          Test
        </button>
        <button className="btn" disabled={!a.installed} onClick={onSignIn}>
          <Icon name="terminal" size={14} /> Sign in
        </button>
        <button className="btn btn-quiet" disabled={!a.installed} onClick={onUpdate}>
          Update
        </button>
      </div>
    </article>
  );
}

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { AgentPrefs, DaemonClient, HarnessInfo, HarnessTestResult } from "../daemon/client";
import { VENDORS, type Vendor } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import type { AgentId, SetupClient } from "../setup/client";
import { formatUsd } from "../lib/format";
import { help } from "../helper/content";
import { Icon } from "./Icon";
import { limitText, RUN_ROLES } from "./NewRunDialog";

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
  client: Pick<DaemonClient, "harnesses" | "clearLimit" | "testHarness" | "getPrefs" | "setPrefs">;
  /** The wizard's backend, for sign-in and update terminals; null where there is none. */
  setup: () => Promise<SetupClient | null>;
}

/**
 * Every agent CLI in one place: installed, signed in, version, spending,
 * plan usage and limits, with sign-in, test and update; and the user's
 * agent preferences (~/.config/agentux/agents.yaml).
 */
export function AgentsView({ client, setup }: Props) {
  const [agents, setAgents] = useState<HarnessInfo[] | null>(null);
  const [prefs, setPrefs] = useState<AgentPrefs | null>(null);
  const [draft, setDraft] = useState<AgentPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, HarnessTestResult | "running">>({});
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, p] = await Promise.all([client.harnesses(), client.getPrefs().catch(() => null)]);
      setAgents(list);
      setPrefs(p);
      setDraft(p && structuredClone(p));
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

  const save = () =>
    act(async () => {
      if (!draft) return;
      const clean: AgentPrefs = {
        ...draft,
        roles: Object.fromEntries(
          Object.entries(draft.roles)
            .map(([role, p]) => [role, { harness: p.harness || undefined, model: p.model?.trim() || undefined }] as const)
            .filter(([, p]) => p.harness || p.model),
        ),
      };
      const next = await client.setPrefs(clean);
      setPrefs(next);
      setDraft(structuredClone(next));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
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

  const ids = agents.map((a) => a.id);
  const order = orderedIds(draft, ids);
  const moveUp = (i: number) => {
    if (!draft || i === 0) return;
    const next = [...order];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setDraft({ ...draft, order: next });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);

  return (
    <div className="agents-view">
      <div className="agents-head">
        <p className="muted">
          The agent CLIs runs use. Sign-in, updates and keys stay with each vendor's own CLI; AgentUX only reads what they
          report.
        </p>
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
              onLift={() => void act(async () => {
                await client.clearLimit(a.id);
                await load();
              })}
            />
          ))}
      </div>

      {draft ? (
        <section className="wz-card agent-prefs" aria-labelledby="prefs-title" {...help("agents.prefs")}>
          <h2 id="prefs-title">Preferences</h2>
          <p className="muted">
            For every project; a project's <code>agentux.yaml</code> comes first. Saved in{" "}
            <code>~/.config/agentux/agents.yaml</code>.
          </p>

          <div className="prefs-grid">
            <div>
              <h3>Order</h3>
              <p className="muted">Automatic picks and fallbacks try agents in this order.</p>
              <ol className="prefs-order">
                {order.map((id, i) => (
                  <li key={id}>
                    <span>{agentName(id)}</span>
                    <button className="icon-btn" aria-label={`Move ${agentName(id)} up`} disabled={i === 0} onClick={() => moveUp(i)}>
                      ↑
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h3>Roles</h3>
              <p className="muted">Without an agentux.yaml. Empty: automatic.</p>
              {RUN_ROLES.map((role) => {
                const pref = draft.roles[role.id] ?? {};
                const setRole = (p: { harness?: string; model?: string }) =>
                  setDraft({ ...draft, roles: { ...draft.roles, [role.id]: { ...pref, ...p } } });
                return (
                  <div className="prefs-role" key={role.id}>
                    <span>{role.label}</span>
                    <select
                      aria-label={`Agent that ${role.label.toLowerCase()}`}
                      value={pref.harness ?? ""}
                      onChange={(e) => setRole({ harness: e.target.value || undefined })}
                    >
                      <option value="">Automatic</option>
                      {order.map((id) => (
                        <option key={id} value={id}>
                          {agentName(id)}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Model that ${role.label.toLowerCase()}`}
                      placeholder="default model"
                      value={pref.model ?? ""}
                      onChange={(e) => setRole({ model: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>

            <div>
              <h3>At a usage limit</h3>
              <label className="prefs-check">
                <input
                  type="radio"
                  name="fallback"
                  checked={draft.fallback === null}
                  onChange={() => setDraft({ ...draft, fallback: null })}
                />
                Any agent I can use, in my order
              </label>
              <label className="prefs-check">
                <input
                  type="radio"
                  name="fallback"
                  checked={draft.fallback !== null}
                  onChange={() => setDraft({ ...draft, fallback: draft.fallback ?? [] })}
                />
                Only these (none: wait for the limit)
              </label>
              {draft.fallback !== null &&
                order.map((id) => (
                  <label className="prefs-check is-sub" key={id}>
                    <input
                      type="checkbox"
                      checked={draft.fallback?.includes(id) ?? false}
                      onChange={(e) => {
                        const set = new Set(draft.fallback ?? []);
                        if (e.target.checked) set.add(id);
                        else set.delete(id);
                        setDraft({ ...draft, fallback: order.filter((x) => set.has(x)) });
                      }}
                    />
                    {agentName(id)}
                  </label>
                ))}
            </div>

            <div>
              <h3>Stopped agents</h3>
              <label className="prefs-num">
                Give up after
                <input
                  type="number"
                  min={1}
                  placeholder="10"
                  value={draft.idleMinutes ?? ""}
                  onChange={(e) => setDraft({ ...draft, idleMinutes: e.target.value ? Number(e.target.value) : null })}
                />
                minutes without activity
              </label>
              <label className="prefs-num">
                or
                <input
                  type="number"
                  min={1}
                  placeholder="60"
                  value={draft.toolMinutes ?? ""}
                  onChange={(e) => setDraft({ ...draft, toolMinutes: e.target.value ? Number(e.target.value) : null })}
                />
                while a command runs
              </label>
              <label className="prefs-check">
                <input
                  type="checkbox"
                  checked={draft.notifications}
                  onChange={(e) => setDraft({ ...draft, notifications: e.target.checked })}
                />
                Desktop notifications for limits and agents taking over
              </label>
            </div>
          </div>
          <div className="form-actions">
            {saved && <span className="ok">Saved</span>}
            <button className="btn btn-quiet" disabled={!dirty} onClick={() => setDraft(prefs && structuredClone(prefs))}>
              Undo
            </button>
            <button className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
              Save preferences
            </button>
          </div>
        </section>
      ) : (
        <p className="muted">Preferences need agentux-core 0.4.8 or later.</p>
      )}
    </div>
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

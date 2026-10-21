import { useCallback, useEffect, useState } from "react";
import type { AgentPrefs, DaemonClient } from "../daemon/client";
import { help } from "../helper/content";
import { agentName, orderedIds } from "./AgentsView";
import { RUN_ROLES } from "./NewRunDialog";

const AGENT_IDS = ["claude-code", "codex", "opencode", "antigravity"];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err);
}

/**
 * The user's agent preferences (~/.config/agentux/agents.yaml, through
 * agentuxd): the order agents are picked and fall back in, an agent and model
 * per role, what happens at a usage limit, when a stopped agent is given up
 * on, and desktop notifications.
 */
export function AgentPrefsForm({ client }: { client: Pick<DaemonClient, "getPrefs" | "setPrefs"> }) {
  const [prefs, setPrefs] = useState<AgentPrefs | null | undefined>(undefined);
  const [draft, setDraft] = useState<AgentPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await client.getPrefs();
      setPrefs(p);
      setDraft(p && structuredClone(p));
    } catch (err) {
      setPrefs(null);
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (prefs === undefined) return <p className="muted">Loading preferences…</p>;
  if (!draft) {
    return (
      <>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <p className="muted">Agent preferences need agentuxd from agentux-core 0.4.8 or later.</p>
      </>
    );
  }

  const order = orderedIds(draft, AGENT_IDS);
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...order];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setDraft({ ...draft, order: next });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);

  const save = async () => {
    setError(null);
    try {
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
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="agent-prefs" {...help("agents.prefs")}>
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
            <input type="radio" name="fallback" checked={draft.fallback === null} onChange={() => setDraft({ ...draft, fallback: null })} />
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
          <h3 className="prefs-sub">Notifications</h3>
          <label className="prefs-check">
            <input
              type="checkbox"
              checked={draft.notifications}
              onChange={(e) => setDraft({ ...draft, notifications: e.target.checked })}
            />
            Desktop notifications when an agent hits a limit or stops responding, another takes over, or a run waits or goes
            on
          </label>
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        {saved && <span className="ok">Saved</span>}
        <button className="btn btn-quiet" disabled={!dirty} onClick={() => setDraft(prefs && structuredClone(prefs))}>
          Undo
        </button>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
          Save preferences
        </button>
      </div>
    </div>
  );
}

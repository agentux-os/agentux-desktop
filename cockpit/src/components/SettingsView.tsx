import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DaemonClient } from "../daemon/client";
import type { CockpitState } from "../daemon/types";
import { help, type HelpKey } from "../helper/content";
import { AI_HARNESSES } from "../helper/ai";
import { updateSettings, useHelperSettings } from "../helper/settings";
import { getCloneDir, setCloneDir } from "../lib/localPrefs";
import type { SetupClient } from "../setup/client";
import { AgentPrefsForm } from "./AgentPrefsForm";

/** The keys AgentUX keeps, and who reads them. */
export const API_KEYS: { variable: string; label: string; agents: string }[] = [
  { variable: "ANTHROPIC_API_KEY", label: "Anthropic", agents: "Claude Code, OpenCode" },
  { variable: "OPENAI_API_KEY", label: "OpenAI", agents: "Codex, OpenCode" },
  { variable: "GEMINI_API_KEY", label: "Google Gemini", agents: "Antigravity, OpenCode" },
  { variable: "OPENROUTER_API_KEY", label: "OpenRouter", agents: "OpenCode" },
];

type Theme = "dark" | "light";

interface Props {
  client: Pick<DaemonClient, "getPrefs" | "setPrefs">;
  state: Pick<CockpitState, "connection">;
  /** The wizard's backend (API keys); null where there is none. */
  setup: () => Promise<SetupClient | null>;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  /** Opens Welcome to AgentUX (Git, SSH, tools). */
  onWelcome: () => void;
  /** The cockpit's version, when known. */
  version?: string | null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err);
}

function Section({
  id,
  title,
  children,
  helpProps,
}: {
  id: string;
  title: string;
  children: ReactNode;
  helpProps: { "data-help": HelpKey };
}) {
  return (
    <section className="wz-card settings-section" aria-labelledby={`settings-${id}`} {...helpProps}>
      <h2 id={`settings-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

/** Everything the user can set for AgentUX, in one place. */
export function SettingsView({ client, state, setup, theme, onTheme, onWelcome, version }: Props) {
  const helper = useHelperSettings();
  const [cloneDir, setDir] = useState(getCloneDir);

  return (
    <div className="settings-view">
      <nav className="settings-toc" aria-label="Settings sections">
        {[
          ["agents", "Agents"],
          ["keys", "API keys"],
          ["projects", "Projects"],
          ["appearance", "Appearance & help"],
          ["git", "Git & SSH"],
          ["about", "About"],
        ].map(([id, label]) => (
          <a key={id} href={`#settings-${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <Section id="agents" title="Agents" helpProps={help("settings.agents")}>
        <AgentPrefsForm client={client} />
      </Section>

      <Section id="keys" title="API keys" helpProps={help("settings.keys")}>
        <ApiKeys setup={setup} />
      </Section>

      <Section id="projects" title="Projects" helpProps={help("settings.projects")}>
        <label className="field">
          <span>Clone repositories into</span>
          <input
            className="mono"
            value={cloneDir}
            onChange={(e) => setDir(e.target.value)}
            onBlur={() => setDir(setCloneDir(cloneDir))}
            placeholder="~/src"
          />
          <small className="muted">
            Where <strong>New run → Clone a repository</strong> puts them: <code>~/…</code> or an absolute path.
          </small>
        </label>
      </Section>

      <Section id="appearance" title="Appearance & help" helpProps={help("settings.appearance")}>
        <div className="settings-rows">
          <label className="prefs-check">
            Theme
            <select aria-label="Theme" value={theme} onChange={(e) => onTheme(e.target.value as Theme)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="prefs-check">
            <input type="checkbox" checked={helper.enabled} onChange={(e) => updateSettings({ enabled: e.target.checked })} />
            Show the penguin helper (F1, What's this?, the tour)
          </label>
          <label className="prefs-check">
            <input type="checkbox" checked={helper.ai} onChange={(e) => updateSettings({ ai: e.target.checked })} />
            The penguin also asks my agent
            <select
              aria-label="Agent that answers"
              value={helper.aiHarness}
              disabled={!helper.ai}
              onChange={(e) => updateSettings({ aiHarness: e.target.value })}
            >
              {AI_HARNESSES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Asking your agent sends the question, matching docs passages and the view you are on to that agent, on your
            account. Never files or transcripts.
          </p>
        </div>
      </Section>

      <Section id="git" title="Git & SSH" helpProps={help("settings.git")}>
        <p className="muted">Your Git name, e-mail and default branch, the SSH key for GitHub and other hosts, and GitHub's sign-in.</p>
        <button className="btn" onClick={onWelcome}>
          Open Welcome &amp; setup
        </button>
      </Section>

      <Section id="about" title="About" helpProps={help("settings.about")}>
        <dl className="settings-about">
          <dt>Cockpit</dt>
          <dd className="mono">{version ?? "development build"}</dd>
          <dt>agentuxd</dt>
          <dd>
            {state.connection.mock ? "not connected: showing mock data" : state.connection.status}
            {!state.connection.mock && <span className="mono muted"> · {state.connection.daemon}</span>}
          </dd>
          <dt>Preferences file</dt>
          <dd className="mono">~/.config/agentux/agents.yaml</dd>
        </dl>
      </Section>
    </div>
  );
}

/** API keys in the desktop's secret service: set, replace or remove; never shown. */
export function ApiKeys({ setup }: { setup: () => Promise<SetupClient | null> }) {
  const [keys, setKeys] = useState<Record<string, boolean> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await setup();
      if (!s) {
        setError("API keys need the AgentUX desktop (its secret service).");
        return;
      }
      setKeys(await s.keys());
    } catch (err) {
      setError(errorText(err));
    }
  }, [setup]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (f: (s: SetupClient) => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await setup();
      if (!s) throw new Error("API keys need the AgentUX desktop");
      await f(s);
      setEditing(null);
      setValue("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="muted">
        For agents you use with an API key instead of a subscription sign-in. Kept in the desktop's secret service (KWallet,
        GNOME Keyring), never in a file; agentuxd gives each key only to the agents that read it, when it starts them.
      </p>
      <ul className="key-list">
        {API_KEYS.map((k) => (
          <li key={k.variable}>
            <div>
              <strong>{k.label}</strong> <span className="mono muted">{k.variable}</span>
              <div className="muted">{k.agents}</div>
            </div>
            <span className={`wz-pill ${keys?.[k.variable] ? "is-installed" : ""}`}>
              {keys === null ? "…" : keys[k.variable] ? "Set" : "Not set"}
            </span>
            {editing === k.variable ? (
              <form
                className="key-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (value.trim()) void run((s) => s.setKey(k.variable, value.trim()));
                }}
              >
                <input
                  type="password"
                  autoComplete="off"
                  aria-label={`${k.label} API key`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-primary" disabled={busy || !value.trim()}>
                  Save
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <span className="key-actions">
                <button className="btn" disabled={busy || keys === null} onClick={() => setEditing(k.variable)}>
                  {keys?.[k.variable] ? "Replace" : "Add"}
                </button>
                {keys?.[k.variable] && (
                  <button className="btn btn-quiet" disabled={busy} onClick={() => void run((s) => s.removeKey(k.variable))}>
                    Remove
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

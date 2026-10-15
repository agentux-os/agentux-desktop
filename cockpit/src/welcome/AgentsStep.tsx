import { useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { VENDOR_INFO } from "../daemon/vendors";
import type { Vendor } from "../daemon/types";
import { AGENT_STEP, FIRST_LOGIN_STEPS, type AgentId, type AgentStatus, type SetupClient, type SetupStatus } from "../setup/client";

interface AgentGuide {
  vendor: Vendor;
  /** What the sign-in terminal runs. */
  signIn: string;
  /** How API keys work for this CLI. */
  apiKey: { env?: string; label?: string; text: string };
}

export const AGENT_GUIDE: Record<AgentId, AgentGuide> = {
  claude: {
    vendor: "claude-code",
    signIn: "claude",
    apiKey: {
      env: "ANTHROPIC_API_KEY",
      label: "Anthropic API key",
      text: "Sign in with a Claude subscription in the browser, or use an API key from console.anthropic.com.",
    },
  },
  codex: {
    vendor: "codex",
    signIn: "codex login",
    apiKey: {
      env: "OPENAI_API_KEY",
      label: "OpenAI API key",
      text: "Sign in with ChatGPT in the browser, or use an API key from platform.openai.com.",
    },
  },
  opencode: {
    vendor: "opencode",
    signIn: "opencode auth login",
    apiKey: {
      text: "OpenCode works with many providers; `opencode auth login` asks which one and stores its key in OpenCode's own auth file.",
    },
  },
  antigravity: {
    vendor: "antigravity",
    signIn: "agy",
    apiKey: { text: "The Antigravity CLI signs in with your Google account the first time it starts." },
  },
};

/** The secret-tool lines that keep an API key in the desktop's secret service (KWallet). */
export function apiKeySnippet(env: string, label: string): string {
  return [
    `secret-tool store --label="${label}" agentux-key ${env}`,
    `echo 'export ${env}="$(secret-tool lookup agentux-key ${env})"' >> ~/.bashrc`,
  ].join("\n");
}

type AgentState = "installing" | "waiting" | "installed" | "failed";

function agentState(agent: AgentStatus | undefined, id: AgentId, status: SetupStatus | null): AgentState {
  if (agent?.installed) return "installed";
  const step = status?.firstLogin.steps.find((s) => s.name === AGENT_STEP[id]);
  if (step && step.result !== "ok") return "failed";
  const fl = status?.firstLogin;
  if (!fl) return "waiting";
  if (fl.active === "failed") return "failed";
  if (fl.active === "active" || fl.active === "activating") {
    const next = FIRST_LOGIN_STEPS[fl.steps.length];
    return next === AGENT_STEP[id] ? "installing" : "waiting";
  }
  return fl.done ? "failed" : "waiting";
}

const STATE_LABEL: Record<AgentState, string> = {
  installing: "Installing…",
  waiting: "Queued",
  installed: "Installed",
  failed: "Not installed",
};

export function AgentsStep({
  client,
  status,
  onError,
}: {
  client: SetupClient;
  status: SetupStatus | null;
  onError: (message: string) => void;
}) {
  const fl = status?.firstLogin;
  const finished = fl ? fl.steps.filter((s) => s.result === "ok").length : 0;
  const running = fl?.active === "active" || fl?.active === "activating";
  const failed = fl?.active === "failed" || (fl ? fl.steps.some((s) => s.result !== "ok") && !running : false);
  const total = FIRST_LOGIN_STEPS.length;
  const pct = fl?.done ? 100 : Math.round((finished / total) * 100);

  const act = (p: Promise<void>) => void p.catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));

  return (
    <div className="wz-stack">
      <section className="wz-card wz-firstlogin" aria-labelledby="fl-title">
        <div className="wz-card-head">
          <div>
            <h2 id="fl-title">Agent CLIs</h2>
            <p className="muted">
              Installed for you in the background since you logged in, together with mise dev tools and the ACP adapters.
            </p>
          </div>
          <span className={`wz-pill ${fl?.done ? "is-done" : failed ? "is-failed" : "is-running"}`}>
            {fl?.done ? "Ready" : failed ? "Needs a retry" : running ? `Installing · ${finished}/${total}` : "Waiting for the network"}
          </span>
        </div>
        <div
          className={`wz-progress ${failed ? "is-failed" : ""}`}
          role="progressbar"
          aria-label="Agent CLI install"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <ol className="wz-fl-steps">
          {FIRST_LOGIN_STEPS.map((name, i) => {
            const step = fl?.steps.find((s) => s.name === name);
            const state = step ? (step.result === "ok" ? "ok" : "bad") : running && i === fl?.steps.length ? "now" : "todo";
            return (
              <li key={name} className={`is-${state}`}>
                <Icon name={state === "ok" ? "check" : state === "bad" ? "x" : "minus"} size={13} />
                {name}
                {step && state === "ok" && <span className="muted"> · {step.seconds}s</span>}
              </li>
            );
          })}
        </ol>
        {failed && (
          <div className="wz-alert" role="alert">
            <Icon name="alert" size={15} />
            <span>
              Some agent CLIs did not install, usually because the network was down. They retry on their own; you can
              retry now.
            </span>
            <button className="btn" onClick={() => act(client.retryFirstLogin())}>
              Retry now
            </button>
          </div>
        )}
      </section>

      <div className="wz-agents">
        {(Object.keys(AGENT_GUIDE) as AgentId[]).map((id) => (
          <AgentCard
            key={id}
            id={id}
            agent={status?.agents.find((a) => a.id === id)}
            state={agentState(
              status?.agents.find((a) => a.id === id),
              id,
              status,
            )}
            onSignIn={() => act(client.signIn(id))}
          />
        ))}
      </div>

      <aside className="wz-callout">
        <Icon name="shield" size={18} />
        <div>
          <strong>Inference stays with the providers.</strong> AgentUX runs each vendor's own CLI. Your prompts and code
          go to the provider you sign in to, under its terms, as they would on any other system. AgentUX runs no model and
          sends nothing anywhere itself.
        </div>
      </aside>
    </div>
  );
}

function AgentCard({
  id,
  agent,
  state,
  onSignIn,
}: {
  id: AgentId;
  agent: AgentStatus | undefined;
  state: AgentState;
  onSignIn: () => void;
}) {
  const guide = AGENT_GUIDE[id];
  const info = VENDOR_INFO[guide.vendor];
  const [showKey, setShowKey] = useState(false);
  const style = { ["--vc" as string]: `var(${info.colorVar})` } as CSSProperties;
  return (
    <article className="wz-card wz-agent" style={style} aria-label={info.label}>
      <div className="wz-agent-top">
        <span className="wz-agent-mono">{info.mono}</span>
        <div className="wz-agent-name">
          <strong>{info.label}</strong>
          <span className="muted">{info.maker}</span>
        </div>
        <span className={`wz-pill is-${state}`}>
          {state === "installing" && <span className="wz-spin" aria-hidden="true" />}
          {STATE_LABEL[state]}
        </span>
      </div>
      <div className="wz-agent-cmd">
        <code>{guide.signIn}</code>
        {agent?.signedIn && (
          <span className="ok wz-signed">
            <Icon name="check" size={13} /> signed in
          </span>
        )}
      </div>
      <div className="wz-agent-actions">
        <button className={`btn ${state === "installed" ? "btn-primary" : ""}`} disabled={state !== "installed"} onClick={onSignIn}>
          <Icon name="terminal" size={14} />
          Sign in
        </button>
        <button className="btn btn-quiet" aria-expanded={showKey} onClick={() => setShowKey((v) => !v)}>
          {guide.apiKey.env ? "Use an API key" : "About keys"}
          <Icon name="chevronDown" size={13} className={showKey ? "wz-flip" : undefined} />
        </button>
      </div>
      {showKey && (
        <div className="wz-key">
          <p>{guide.apiKey.text}</p>
          {guide.apiKey.env && guide.apiKey.label && (
            <>
              <p className="muted">
                To keep a key in the desktop's secret service (KWallet) rather than in a file, run this in a terminal and
                paste the key when asked; new shells then get <code>{guide.apiKey.env}</code>:
              </p>
              <pre className="wz-snippet">{apiKeySnippet(guide.apiKey.env, guide.apiKey.label)}</pre>
            </>
          )}
        </div>
      )}
    </article>
  );
}

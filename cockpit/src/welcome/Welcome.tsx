import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, Logo } from "../components/Icon";
import { CATALOG, itemSpec, type CatalogItem } from "../setup/catalog";
import type { SetupClient } from "../setup/client";
import { AgentsStep } from "./AgentsStep";
import { DoneStep } from "./DoneStep";
import { GitStep } from "./GitStep";
import { ToolsStep, isBusy, type Selection } from "./ToolsStep";
import { useSetupStatus } from "./useSetupStatus";

type StepId = "agents" | "tools" | "git" | "done";

const PROFILES = [
  { id: "workstation", title: "Workstation", detail: "Desktop, local agent node and developer tools.", resources: "8 GB RAM · 40 GB storage · network recommended" },
  { id: "node", title: "Agent Node", detail: "A headless execution node for local agents.", resources: "4 GB RAM · 20 GB storage · network optional" },
  { id: "command", title: "Command", detail: "Organization orchestration server; services remain guarded until configured.", resources: "16 GB RAM · 100 GB storage · network required" },
  { id: "executive", title: "Executive", detail: "Office command center and organization visibility.", resources: "8 GB RAM · 40 GB storage · network recommended" },
  { id: "complete", title: "Complete", detail: "Workstation, Node, Command and Office capabilities.", resources: "24 GB RAM · 150 GB storage · network required" },
  { id: "custom", title: "Custom", detail: "Choose the capabilities for this machine later.", resources: "Review the selected capabilities before applying" },
] as const;

const STEPS: { id: StepId; title: string; sub: string; heading: string; lead: string }[] = [
  {
    id: "agents",
    title: "Agents",
    sub: "Claude Code, Codex, OpenCode, Antigravity",
    heading: "Your coding agents",
    lead: "The agent CLIs install by themselves on your first login. Sign in to the ones you use; each opens a terminal with the vendor's own sign-in.",
  },
  {
    id: "tools",
    title: "Tools & SDKs",
    sub: "IDEs, languages, databases, apps",
    heading: "Developer tools",
    lead: "Pick editors, languages and apps. Everything installs for you only, in your home directory, without sudo, and you can change it all later.",
  },
  {
    id: "git",
    title: "Git & SSH",
    sub: "Identity, key, GitHub",
    heading: "Git and SSH",
    lead: "Tell Git who you are and get an SSH key for GitHub or any other forge.",
  },
  {
    id: "done",
    title: "Done",
    sub: "Summary and next steps",
    heading: "Welcome aboard",
    lead: "Here is where things stand. Installs keep going in the background, so you can close this window now.",
  },
];

function loadTheme(): "dark" | "light" {
  try {
    return localStorage.getItem("agentux.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function profileLabel(profile: string | null | undefined): string {
  const labels: Record<string, string> = {
    workstation: "AgentUX Workstation",
    node: "AgentUX Node",
    command: "AgentUX Command Server",
    executive: "AgentUX Executive",
    complete: "AgentUX Complete",
    custom: "Custom profile",
  };
  return (profile && labels[profile]) || "Profile not selected";
}

export function Welcome({ client, pollMs }: { client: SetupClient; pollMs?: number }) {
  const { status, installed, error: statusError, refresh } = useSetupStatus(client, pollMs);
  const [step, setStep] = useState(0);
  const [selection, setSelection] = useState<Selection>(
    () => new Map(CATALOG.items.filter((i) => i.recommended).map((i) => [i.id, undefined])),
  );
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [profile, setProfile] = useState("workstation");
  const [profileSaving, setProfileSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => {
    document.documentElement.dataset.theme = loadTheme();
    document.title = "Welcome to AgentUX";
  }, []);

  useEffect(() => {
    if (status?.profile.requested) setProfile(status.profile.requested);
  }, [status?.profile.requested]);

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      await client.selectProfile(profile);
      await refresh();
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setProfileSaving(false);
    }
  };

  // Move focus to the new step's heading (not on the first render).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const fail = useCallback((message: string) => setError(message), []);
  const go = useCallback((i: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, i))), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        go(step + 1);
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        go(step - 1);
      } else if (e.key === "/" && STEPS[step].id === "tools") {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  const toggle = useCallback((item: CatalogItem, on: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (on) next.set(item.id, prev.get(item.id));
      else next.delete(item.id);
      return next;
    });
  }, []);

  const setVersion = useCallback((item: CatalogItem, version: string) => {
    setSelection((prev) => new Map(prev).set(item.id, version));
  }, []);

  const start = useCallback(
    async (items: CatalogItem[]) => {
      if (!items.length) return;
      try {
        await client.start(items.map((i) => itemSpec(i, selection.get(i.id))));
        setSelection((prev) => {
          const next = new Map(prev);
          for (const i of items) next.delete(i.id);
          return next;
        });
        await refresh();
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    [client, selection, refresh, fail],
  );

  const install = () =>
    void start(
      CATALOG.items.filter((i) => selection.has(i.id) && !installed.has(i.id) && !isBusy(status?.items[i.id])),
    );

  const finish = async (openCockpit: boolean) => {
    try {
      await client.finish();
      await client.close(openCockpit);
      if (client.mode === "mock") setClosed(true);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };

  const activity = useMemo(() => {
    const all = Object.values(status?.items ?? {});
    const busy = all.filter(isBusy).length;
    const recent = all.filter((i) => i.state !== "failed").length;
    return { busy, failed: all.filter((i) => i.state === "failed").length, done: recent - busy, total: recent };
  }, [status]);

  if (closed) {
    return (
      <div className="wz-closed">
        <Logo size={40} />
        <p>The wizard is closed. In the real app this window goes away.</p>
        <button className="btn" onClick={() => setClosed(false)}>
          Show it again
        </button>
      </div>
    );
  }

  const s = STEPS[step];
  return (
    <div className="welcome">
      <aside className="wz-rail">
        <div className="wz-brand">
          <Logo size={34} />
          <div>
            <div className="wz-brand-name">AgentUX</div>
            <div className="wz-brand-sub">first-run setup</div>
          </div>
        </div>
        <nav aria-label="Setup steps">
          <ol className="wz-steps">
            {STEPS.map((st, i) => (
              <li key={st.id}>
                <button
                  className={`wz-step ${i === step ? "is-current" : ""} ${i < step ? "is-past" : ""}`}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => go(i)}
                >
                  <span className="wz-step-num">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
                  <span className="wz-step-text">
                    <span>{st.title}</span>
                    <small>{st.sub}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {activity.total + activity.failed > 0 && (
          <button className="wz-activity" onClick={() => go(1)} aria-label="Install progress, show tools">
            <div className="wz-activity-top">
              {activity.busy ? <span className="wz-spin" aria-hidden="true" /> : <Icon name="check" size={13} className="ok" />}
              <span>
                {activity.busy ? `Installing · ${activity.done}/${activity.total}` : `${activity.done} installed`}
              </span>
              {activity.failed > 0 && <span className="err">· {activity.failed} failed</span>}
            </div>
            <div className="wz-progress thin" aria-hidden="true">
              <span style={{ width: `${activity.total ? (activity.done / activity.total) * 100 : 0}%` }} />
            </div>
            {activity.busy > 0 && <small className="muted">Keeps going if you close this window</small>}
          </button>
        )}

        <section className="wz-profile" aria-label="AgentUX OS profile" role="region">
          <div className="wz-profile-kicker">AgentUX OS profile</div>
          <strong>{profileLabel(status?.profile.requested)}</strong>
          <span className="muted">
            {status?.profile.applied.length ? status.profile.applied.join(" · ") : "No capabilities applied"}
          </span>
          {(status?.profile.pending.length || status?.profile.failed.length) ? (
            <small className="err">
              {status.profile.pending.length ? `${status.profile.pending.length} pending` : ""}
              {status.profile.pending.length && status.profile.failed.length ? " · " : ""}
              {status.profile.failed.length ? `${status.profile.failed.length} failed` : ""}
            </small>
          ) : null}
        </section>

        <div className="wz-rail-foot">
          <button className="btn btn-quiet" onClick={() => void finish(false)}>
            Skip setup
          </button>
          <span className="muted wz-small">
            {client.mode === "mock" ? "Demo data" : "Reopen: app menu › Welcome to AgentUX"}
          </span>
        </div>
      </aside>

      <main className="wz-main">
        <header className="wz-head">
          <div className="wz-kicker">
            Step {step + 1} of {STEPS.length}
          </div>
          <h1 ref={headingRef} tabIndex={-1}>
            {s.heading}
          </h1>
          <p className="muted">{s.lead}</p>
        </header>

        {(error || statusError) && (
          <div className="wz-alert wz-banner" role="alert">
            <Icon name="alert" size={15} />
            <span className="mono">{error ?? statusError}</span>
            {error && (
              <button className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        )}

        <div className={`wz-body ${s.id === "tools" ? "is-tools" : ""}`}>
          {s.id === "agents" && (
            <>
              <section className="wz-panel" aria-labelledby="profile-selection-heading">
                <div className="wz-panel-head">
                  <div>
                    <h2 id="profile-selection-heading">Choose this machine's role</h2>
                    <p className="muted">This writes a local profile intent. The system applies it on first boot and can be reopened safely.</p>
                  </div>
                  <button className="btn btn-primary" onClick={() => void saveProfile()} disabled={profileSaving}>
                    {profileSaving ? "Saving…" : "Save profile"}
                  </button>
                </div>
                <div className="wz-profile-grid">
                  {PROFILES.map((option) => (
                    <label key={option.id} className={`wz-profile-option ${profile === option.id ? "is-selected" : ""}`}>
                      <input type="radio" name="os-profile" value={option.id} checked={profile === option.id} onChange={() => setProfile(option.id)} />
                      <strong>{option.title}</strong>
                      <span>{option.detail}</span>
                      <small>{option.resources}</small>
                    </label>
                  ))}
                </div>
                <p className="muted wz-small">Offline-safe: selection does not download anything. Command services require explicit image and configuration.</p>
              </section>
              <AgentsStep client={client} status={status} onError={fail} />
            </>
          )}
          {s.id === "tools" && (
            <ToolsStep
              ref={searchRef}
              status={status}
              installed={installed}
              selection={selection}
              onToggle={toggle}
              onVersion={setVersion}
              onInstall={install}
              onRetry={(item) => void start([item])}
              onLaunch={(item) => void client.launch(item.id).catch((e: Error) => fail(e.message))}
            />
          )}
          {s.id === "git" && <GitStep client={client} onError={fail} />}
          {s.id === "done" && (
            <DoneStep
              client={client}
              status={status}
              installed={installed}
              onOpenCockpit={() => void finish(true)}
              onError={fail}
            />
          )}
        </div>

        <footer className="wz-nav">
          <button className="btn" onClick={() => go(step - 1)} disabled={step === 0}>
            Back
          </button>
          <span className="muted wz-small wz-keys">
            <kbd>Alt</kbd>+<kbd>←</kbd> <kbd>→</kbd> steps
            {s.id === "tools" && (
              <>
                {" "}
                · <kbd>/</kbd> search · <kbd>Space</kbd> tick
              </>
            )}
          </span>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={() => go(step + 1)}>
              Next
              <Icon name="arrowRight" size={14} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void finish(true)}>
              Finish
              <Icon name="check" size={14} />
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}

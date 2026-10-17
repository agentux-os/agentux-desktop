import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import type { GitConfig, SetupClient } from "../setup/client";
import { help } from "../helper/content";

export const GITHUB_SSH_URL = "https://github.com/settings/ssh/new";

export function GitStep({ client, onError }: { client: SetupClient; onError: (message: string) => void }) {
  const [git, setGit] = useState<GitConfig>({ name: "", email: "", defaultBranch: "main" });
  const [saved, setSaved] = useState<GitConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void client
      .getGit()
      .then((g) => {
        setGit({ name: g.name, email: g.email, defaultBranch: g.defaultBranch || "main" });
        if (g.name && g.email) setSaved(g);
      })
      .catch(() => undefined);
    void client.sshKey().then(setKey).catch(() => undefined);
  }, [client]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      setSaved(await client.setGit({ ...git, defaultBranch: git.defaultBranch.trim() || "main" }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      setKey(await client.generateSshKey(git.email, passphrase));
      setPassphrase("");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onError("Could not copy; select the key and copy it with Ctrl+C.");
    }
  };

  const dirty = !saved || saved.name !== git.name || saved.email !== git.email || saved.defaultBranch !== git.defaultBranch;

  return (
    <div className="wz-two">
      <form className="wz-card" onSubmit={(e) => void save(e)} aria-labelledby="git-title" {...help("wz.git.identity")}>
        <h2 id="git-title">Git identity</h2>
        <p className="muted">Written to your global Git config (~/.gitconfig) and used for every commit you make.</p>
        <div className="wz-fields">
          <label className="field">
            <span>Name</span>
            <input value={git.name} onChange={(e) => setGit({ ...git, name: e.target.value })} autoComplete="name" required />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              value={git.email}
              onChange={(e) => setGit({ ...git, email: e.target.value })}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Default branch</span>
            <input
              className="mono"
              value={git.defaultBranch}
              onChange={(e) => setGit({ ...git, defaultBranch: e.target.value })}
              placeholder="main"
            />
          </label>
        </div>
        {formError && <div className="form-error">{formError}</div>}
        <div className="wz-card-actions">
          {saved && !dirty && (
            <span className="ok wz-saved">
              <Icon name="check" size={14} /> Saved
            </span>
          )}
          <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <section className="wz-card" aria-labelledby="ssh-title" {...help("wz.git.ssh")}>
        <h2 id="ssh-title">SSH key</h2>
        {key ? (
          <>
            <p className="muted">
              Your public key (<code>~/.ssh/id_ed25519.pub</code>). Add it to GitHub, GitLab or any server you push to.
            </p>
            <textarea className="wz-key-box mono" readOnly value={key} rows={3} aria-label="Public SSH key" onFocus={(e) => e.target.select()} />
            <div className="wz-card-actions wz-left">
              <button className="btn" onClick={() => void copy()}>
                <Icon name={copied ? "check" : "file"} size={14} />
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn" onClick={() => void client.openUrl(GITHUB_SSH_URL).catch((e: Error) => onError(e.message))}>
                <Icon name="globe" size={14} />
                Add to GitHub
              </button>
              <button className="btn" onClick={() => void client.signIn("github").catch((e: Error) => onError(e.message))}>
                <Icon name="terminal" size={14} />
                Sign in with gh
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              No key yet. This creates an ed25519 key in <code>~/.ssh/id_ed25519</code>. A passphrase is optional; you can
              add one later with <code>ssh-keygen -p</code>.
            </p>
            <label className="field">
              <span>Passphrase (optional)</span>
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
            </label>
            <div className="wz-card-actions wz-left">
              <button className="btn btn-primary" onClick={() => void generate()} disabled={generating}>
                <Icon name="plus" size={14} />
                {generating ? "Generating…" : "Generate key"}
              </button>
              <button className="btn" onClick={() => void client.signIn("github").catch((e: Error) => onError(e.message))}>
                <Icon name="terminal" size={14} />
                Sign in with gh
              </button>
            </div>
          </>
        )}
        <p className="muted wz-small">
          <code>gh auth login</code> signs the GitHub CLI in through your browser and can upload this key for you.
        </p>
      </section>
    </div>
  );
}

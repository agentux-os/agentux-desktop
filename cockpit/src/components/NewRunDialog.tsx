import { useEffect, useState, type FormEvent } from "react";
import type { HarnessInfo, StartRunInput } from "../daemon/client";
import { VENDORS, type Project, type Vendor } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { Icon } from "./Icon";
import { help } from "../helper/content";

interface Props {
  projects: Project[];
  /** Pre-filled project directory (the selected project, if any). */
  initialPath: string;
  onClose: () => void;
  /** Starts the run; a rejection is shown in the dialog. */
  onSubmit: (input: StartRunInput) => Promise<void>;
  /** The daemon's harnesses; resolves to null when it cannot take a choice per role. */
  loadHarnesses?: () => Promise<HarnessInfo[] | null>;
  /** Clones a repository (URL or GitHub OWNER/REPO); resolves to its directory. */
  onClone?: (source: string) => Promise<string>;
}

/** The roles of the built-in pipeline, in the order they act. */
export const RUN_ROLES = [
  { id: "planner", label: "Plans" },
  { id: "implementer", label: "Implements" },
  { id: "reviewer", label: "Reviews" },
] as const;

/** How a harness reads in the agent picker. */
export function harnessOption(h: HarnessInfo): { label: string; disabled: boolean } {
  const name = (VENDORS as readonly string[]).includes(h.id) ? VENDOR_INFO[h.id as Vendor].label : h.id;
  if (!h.installed) return { label: `${name} (not installed)`, disabled: true };
  if (h.signedIn === false) return { label: `${name} (not signed in)`, disabled: false };
  return { label: h.experimental ? `${name} (experimental)` : name, disabled: false };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err);
}

/**
 * Starts a run on agentuxd: a project directory (any path inside a git
 * repository; registered on first use, or cloned here first), the prompt for
 * the agents, and optionally which agent plays each role.
 */
export function NewRunDialog({ projects, initialPath, onClose, onSubmit, loadHarnesses, onClone }: Props) {
  const [path, setPath] = useState(initialPath);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"folder" | "clone">("folder");
  const [repo, setRepo] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState<string | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessInfo[] | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    loadHarnesses?.()
      .then((list) => live && setHarnesses(list))
      .catch(() => live && setHarnesses(null));
    return () => {
      live = false;
    };
  }, [loadHarnesses]);

  const clone = async () => {
    if (!onClone || !repo.trim() || cloning) return;
    setCloning(true);
    setError(null);
    try {
      const dir = await onClone(repo.trim());
      setPath(dir);
      setCloned(dir);
      setSource("folder");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCloning(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (source === "clone") {
      void clone();
      return;
    }
    if (!path.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = Object.fromEntries(Object.entries(roles).filter(([, h]) => h));
      await onSubmit({
        projectPath: path.trim(),
        prompt: prompt.trim(),
        title: title.trim() || undefined,
        roles: Object.keys(chosen).length ? chosen : undefined,
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="dialog form-dialog"
        role="dialog"
        aria-label="New run"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(e);
        }}
      >
        <header className="dialog-head">
          <Icon name="plus" /> New run
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="form-body">
          {onClone && (
            <div className="seg" role="tablist" aria-label="Project">
              <button
                type="button"
                role="tab"
                aria-selected={source === "folder"}
                className={source === "folder" ? "is-on" : undefined}
                onClick={() => setSource("folder")}
              >
                Folder on this computer
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={source === "clone"}
                className={source === "clone" ? "is-on" : undefined}
                onClick={() => setSource("clone")}
                {...help("newRun.clone")}
              >
                Clone a repository
              </button>
            </div>
          )}
          {source === "clone" ? (
            <label className="field" {...help("newRun.clone")}>
              <span>Repository</span>
              <div className="field-row">
                <input
                  className="mono"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="owner/repo or https://gitlab.com/group/project.git"
                  autoFocus
                />
                <button type="button" className="btn" disabled={cloning || !repo.trim()} onClick={() => void clone()}>
                  {cloning ? "Cloning…" : "Clone"}
                </button>
              </div>
              <small className="muted">
                GitHub's <code>owner/repo</code>, or the https or SSH URL of any Git host (GitLab, Bitbucket, Codeberg,
                your own). It goes to <code>~/src</code>. Private repositories need GitHub's sign-in or an SSH key from
                Welcome &amp; setup.
              </small>
            </label>
          ) : (
            <label className="field" {...help("newRun.path")}>
              <span>Project directory</span>
              <input
                className="mono"
                list="known-projects"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setCloned(null);
                }}
                placeholder="/home/you/src/project"
                autoFocus={!initialPath}
                required
              />
              <datalist id="known-projects">
                {projects.map((p) => (
                  <option key={p.id} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </datalist>
              <small className="muted">
                {cloned
                  ? `Cloned into ${cloned}.`
                  : "Any directory inside a git repository. New projects are registered automatically."}
              </small>
            </label>
          )}
          <label className="field" {...help("newRun.prompt")}>
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="What should the agents do?"
              autoFocus={!!initialPath}
              required={source === "folder"}
            />
          </label>
          {harnesses && (
            <fieldset className="field agents-field" {...help("newRun.agents")}>
              <span>Agents</span>
              <div className="agents-grid">
                {RUN_ROLES.map((role) => (
                  <label key={role.id}>
                    <small className="muted">{role.label}</small>
                    <select
                      aria-label={`Agent that ${role.label.toLowerCase()}`}
                      value={roles[role.id] ?? ""}
                      onChange={(e) => setRoles((r) => ({ ...r, [role.id]: e.target.value }))}
                    >
                      <option value="">Automatic</option>
                      {harnesses.map((h) => {
                        const o = harnessOption(h);
                        return (
                          <option key={h.id} value={h.id} disabled={o.disabled}>
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                ))}
              </div>
              <small className="muted">
                Automatic: the project's <code>agentux.yaml</code>, or else the agents you are signed in to.
              </small>
            </fieldset>
          )}
          <label className="field" {...help("newRun.title")}>
            <span>
              Title <span className="muted">(optional, defaults to the prompt's first line)</span>
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="form-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || source === "clone" || !path.trim() || !prompt.trim()}
          >
            {busy ? "Starting…" : "Start run"} <kbd>Ctrl Enter</kbd>
          </button>
        </footer>
      </form>
    </div>
  );
}

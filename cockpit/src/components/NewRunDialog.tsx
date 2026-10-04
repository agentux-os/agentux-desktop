import { useState, type FormEvent } from "react";
import type { StartRunInput } from "../daemon/client";
import type { Project } from "../daemon/types";
import { Icon } from "./Icon";

interface Props {
  projects: Project[];
  /** Pre-filled project directory (the selected project, if any). */
  initialPath: string;
  onClose: () => void;
  /** Starts the run; a rejection is shown in the dialog. */
  onSubmit: (input: StartRunInput) => Promise<void>;
}

/**
 * Starts a run on agentuxd: a project directory (any path inside a git
 * repository; registered on first use) and the prompt for the agents.
 */
export function NewRunDialog({ projects, initialPath, onClose, onSubmit }: Props) {
  const [path, setPath] = useState(initialPath);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!path.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ projectPath: path.trim(), prompt: prompt.trim(), title: title.trim() || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err));
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
          <label className="field">
            <span>Project directory</span>
            <input
              className="mono"
              list="known-projects"
              value={path}
              onChange={(e) => setPath(e.target.value)}
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
            <small className="muted">Any directory inside a git repository. New projects are registered automatically.</small>
          </label>
          <label className="field">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="What should the agents do?"
              autoFocus={!!initialPath}
              required
            />
          </label>
          <label className="field">
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
          <button type="submit" className="btn btn-primary" disabled={busy || !path.trim() || !prompt.trim()}>
            {busy ? "Starting…" : "Start run"} <kbd>Ctrl Enter</kbd>
          </button>
        </footer>
      </form>
    </div>
  );
}

import { useEffect, useId, useState } from "react";
import type { HarnessInfo, PlanStep, ProjectPlan, StartRunInput } from "../daemon/client";
import { VENDORS, type Project, type Vendor } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { STEP_LABEL, roleLabel } from "../lib/labels";
import { help } from "../helper/content";
import { limitText } from "./NewRunDialog";
import { Icon } from "./Icon";

/** The agent the user already uses for help, if they let it answer. */
export interface GuideAgent {
  harness: string;
  /** Sends one question to that agent and resolves to its answer. */
  ask: (question: string) => Promise<string>;
}

interface Props {
  projects: Project[];
  initialProjectId?: string;
  describeProject: (projectId: string) => Promise<ProjectPlan | null>;
  loadHarnesses?: () => Promise<HarnessInfo[] | null>;
  /** Absent: the instructions are written from the answers alone. */
  guide?: GuideAgent | null;
  onSubmit: (input: StartRunInput) => Promise<void>;
  onCancel: () => void;
}

interface Answers {
  projectId: string;
  goal: string;
  done: string;
  avoid: string;
}

function agentName(id: string): string {
  return (VENDORS as readonly string[]).includes(id) ? VENDOR_INFO[id as Vendor].label : id;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The run's instructions from the answers, with no agent involved. */
export function draftFromAnswers(a: Answers): { title: string; prompt: string } {
  const goal = a.goal.trim();
  const parts = [goal];
  if (a.done.trim()) parts.push(`Done when: ${a.done.trim()}`);
  if (a.avoid.trim()) parts.push(`Do not change: ${a.avoid.trim()}`);
  const first = goal.split("\n")[0].trim();
  return { title: first.length > 60 ? `${first.slice(0, 57)}…` : first, prompt: parts.join("\n\n") };
}

/** The helper's question: plain instructions for coding agents, title first. */
export function guideQuestion(a: Answers, project?: Project): string {
  return [
    "Rewrite this request from someone who is not a developer as clear instructions for coding agents working in a git repository.",
    "Answer with a short title (at most 60 characters) on the first line, then a blank line, then the instructions. Keep everything they asked for, including what must not change; do not add work they did not ask for; no preamble.",
    "",
    project ? `Project: ${project.name}` : "",
    `What they want: ${a.goal.trim()}`,
    a.done.trim() ? `How they will know it is done: ${a.done.trim()}` : "",
    a.avoid.trim() ? `What must not be touched: ${a.avoid.trim()}` : "",
  ]
    .filter((l, i) => l !== "" || i === 2)
    .join("\n");
}

/** The helper's answer as a title and instructions; null when it is unusable. */
export function parseDraft(answer: string): { title: string; prompt: string } | null {
  const text = answer.trim().replace(/^```[a-z]*\n?|```$/g, "").trim();
  const [head, ...rest] = text.split("\n");
  const title = head?.replace(/^(#+\s*|title:\s*)/i, "").trim();
  const prompt = rest.join("\n").trim();
  if (!title || !prompt || title.length > 120) return null;
  return { title: title.length > 60 ? `${title.slice(0, 57)}…` : title, prompt };
}

/** What stops a role's agent from acting on this computer, if anything. */
export function agentProblem(harness: string, harnesses: HarnessInfo[] | null): string | null {
  if (!harnesses) return null;
  const h = harnesses.find((x) => x.id === harness);
  if (!h) return `${agentName(harness)} is not an agent this computer knows`;
  if (!h.installed) return `${agentName(harness)} is not installed on this computer`;
  if (h.signedIn === false) return `${agentName(harness)} is not signed in`;
  const limit = h.limits?.find((l) => !l.model);
  if (limit) return `${agentName(harness)}: ${limitText(limit)}`;
  return null;
}

/** One step, in plain words. */
function stepLine(step: PlanStep, plan: ProjectPlan): string {
  const label = STEP_LABEL[step.kind as keyof typeof STEP_LABEL] ?? step.kind;
  const parts: string[] = [];
  if (step.role) {
    const role = plan.roles[step.role];
    parts.push(`${roleLabel(step.role)}: ${role ? agentName(role.harness) : "an available agent"}${role?.model ? ` (${role.model})` : ""}`);
  }
  if (step.kind === "gate") {
    const runs = (step.checks ?? []).map((name) => plan.checks.find((c) => c.name === name)?.run ?? name);
    parts.push(runs.length ? `runs ${runs.join(", ")}` : "no checks");
  }
  if (step.kind === "pull_request") parts.push(step.draft ? "opens a draft pull request" : "opens a pull request");
  if (step.loopTo != null && step.loopLimit) {
    const back = plan.steps[step.loopTo];
    const target = back ? (STEP_LABEL[back.kind as keyof typeof STEP_LABEL] ?? back.kind) : "an earlier step";
    parts.push(`back to ${target.toLowerCase()} at most ${step.loopLimit} time${step.loopLimit === 1 ? "" : "s"}`);
  }
  return `${label}${parts.length ? ` — ${parts.join("; ")}` : ""}`;
}

/** The tool categories agents must ask for, and those they may never use, over all roles. */
function permissionSummary(plan: ProjectPlan): { ask: string[]; deny: string[] } {
  const ask = new Set<string>();
  const deny = new Set<string>();
  for (const p of Object.values(plan.permissions)) {
    p.ask?.forEach((c) => ask.add(c));
    p.deny?.forEach((c) => deny.add(c));
  }
  return { ask: [...ask].sort(), deny: [...deny].sort() };
}

const CATEGORY: Record<string, string> = {
  read: "reading files",
  search: "searching",
  think: "thinking",
  edit: "editing files",
  delete: "deleting files",
  move: "moving files",
  execute: "running commands",
  fetch: "using the network",
  other: "other tools",
};

/**
 * The guided way to start a run (agentux-desktop#85): an everyday goal and a
 * few questions, a proposal built from the project's own workflow to review
 * and edit, and nothing started until the person confirms.
 */
export function GuidedRun({ projects, initialProjectId, describeProject, loadHarnesses, guide, onSubmit, onCancel }: Props) {
  const id = useId();
  const [stage, setStage] = useState<"ask" | "review">("ask");
  const [answers, setAnswers] = useState<Answers>({
    projectId: initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : (projects[0]?.id ?? ""),
    goal: "",
    done: "",
    avoid: "",
  });
  const [plan, setPlan] = useState<ProjectPlan | null | undefined>(undefined);
  const [harnesses, setHarnesses] = useState<HarnessInfo[] | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [drafted, setDrafted] = useState<"agent" | "answers">("answers");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find((p) => p.id === answers.projectId);

  useEffect(() => {
    let live = true;
    loadHarnesses?.()
      .then((list) => live && setHarnesses(list))
      .catch(() => live && setHarnesses(null));
    return () => {
      live = false;
    };
  }, [loadHarnesses]);

  const set = (patch: Partial<Answers>) => setAnswers((a) => ({ ...a, ...patch }));

  /** Builds the proposal: the project's workflow, and the run's instructions. */
  const propose = async () => {
    if (!answers.projectId || !answers.goal.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const [described, draft] = await Promise.all([
        describeProject(answers.projectId),
        guide
          ? guide
              .ask(guideQuestion(answers, project))
              .then((a) => parseDraft(a))
              .catch((e: unknown) => {
                setNote(`${agentName(guide.harness)} could not write the instructions (${errorText(e)}); they are written from your answers.`);
                return null;
              })
          : Promise.resolve(null),
      ]);
      const own = draft ?? draftFromAnswers(answers);
      if (guide && !draft) setNote((n) => n ?? `${agentName(guide.harness)}'s answer could not be used; the instructions are written from your answers.`);
      setPlan(described);
      setTitle(own.title);
      setPrompt(own.prompt);
      setDrafted(draft ? "agent" : "answers");
      setStage("review");
    } catch (e) {
      setError(`This project's workflow could not be read: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const problems = plan
    ? Object.entries(plan.roles).flatMap(([role, r]) => {
        const p = agentProblem(r.harness, harnesses);
        return p ? [`${roleLabel(role)}: ${p}`] : [];
      })
    : [];

  const start = async () => {
    if (!project || !prompt.trim() || problems.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ projectPath: project.path, prompt: prompt.trim(), title: title.trim() || undefined });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="form-body guided">
        <p>
          There is no project on this computer yet. Use <strong>Advanced</strong> to pick a folder with a git repository or
          clone one; the guided path works with it afterwards.
        </p>
        <footer className="form-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    );
  }

  if (stage === "ask") {
    return (
      <form
        className="guided"
        aria-labelledby={`${id}-ask`}
        onSubmit={(e) => {
          e.preventDefault();
          void propose();
        }}
      >
        <div className="form-body">
          <h3 id={`${id}-ask`}>What do you want done?</h3>
          <label className="field">
            <span>Project</span>
            <select value={answers.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {project && <small className="muted mono">{project.path}</small>}
          </label>
          <label className="field">
            <span>Your goal, in your own words</span>
            <textarea
              rows={3}
              value={answers.goal}
              onChange={(e) => set({ goal: e.target.value })}
              placeholder="The sign-up page should also ask for a phone number"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>
              How will you know it is done? <span className="muted">(optional)</span>
            </span>
            <textarea rows={2} value={answers.done} onChange={(e) => set({ done: e.target.value })} placeholder="I can sign up with a phone number and see it on my profile" />
          </label>
          <label className="field">
            <span>
              Anything that must not be touched? <span className="muted">(optional)</span>
            </span>
            <textarea rows={2} value={answers.avoid} onChange={(e) => set({ avoid: e.target.value })} placeholder="The login page and the database" />
          </label>
          <p className="muted wz-small" {...help("newRun.guidedPrivacy")}>
            {guide
              ? `To write the run's instructions, your answers go to ${agentName(guide.harness)}, the agent you use for help, on your own account, and to nothing else. Nothing starts until you confirm.`
              : "The run's instructions are written from your answers; no agent sees them before you start the run."}
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="form-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !answers.goal.trim() || !answers.projectId}>
            {busy ? (guide ? `Asking ${agentName(guide.harness)}…` : "Preparing…") : "Review the run"}
          </button>
        </footer>
      </form>
    );
  }

  const perms = plan ? permissionSummary(plan) : null;
  const approvals = plan ? plan.steps.filter((s) => s.approve) : [];
  return (
    <section className="guided" aria-labelledby={`${id}-review`}>
      <div className="form-body">
        <h3 id={`${id}-review`}>Review the run</h3>
        <p className="muted wz-small">Nothing has started. Change anything below, then start it, or go back.</p>
        {note && <p className="muted wz-small">{note}</p>}
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Instructions for the agents{" "}
            <span className="muted">({drafted === "agent" && guide ? `written by ${agentName(guide.harness)}` : "from your answers"})</span>
          </span>
          <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        </label>

        <dl className="proposal" aria-label="What the run will do">
          <dt>Project</dt>
          <dd>
            {project?.name} <span className="muted mono">{project?.path}</span>
          </dd>
          {plan === null ? (
            <>
              <dt>Workflow</dt>
              <dd className="muted">
                This agentuxd cannot describe the workflow before a run (it needs agentux-core 0.5.5). The run follows the
                project's <code>agentux.yaml</code>, or AgentUX's default workflow.
              </dd>
            </>
          ) : (
            plan && (
              <>
                <dt>Workflow</dt>
                <dd>
                  {plan.source === "default" ? "AgentUX's default workflow (the project has no agentux.yaml)" : "The project's agentux.yaml"}
                  <ol className="proposal-steps">
                    {plan.steps.map((s, i) => (
                      <li key={i}>
                        {stepLine(s, plan)}
                        {s.approve && (
                          <span className="chip">
                            <Icon name="inbox" size={11} /> waits for your approval
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </dd>
                <dt>Your approvals</dt>
                <dd>
                  {approvals.length
                    ? `After ${approvals.map((s) => (STEP_LABEL[s.kind as keyof typeof STEP_LABEL] ?? s.kind).toLowerCase()).join(", ")}.`
                    : "No step waits for you; you can still follow and stop the run."}
                  {perms && perms.ask.length > 0 && <> Agents ask you before {perms.ask.map((c) => CATEGORY[c] ?? c).join(", ")}.</>}
                  {perms && perms.deny.length > 0 && <> Some roles may never use {perms.deny.map((c) => CATEGORY[c] ?? c).join(", ")}.</>}
                </dd>
                {plan.budgetUsd != null && (
                  <>
                    <dt>Budget</dt>
                    <dd>Pauses and asks you past ${plan.budgetUsd.toFixed(2)}.</dd>
                  </>
                )}
              </>
            )
          )}
        </dl>

        {problems.length > 0 && (
          <div className="form-error" role="alert">
            <strong>This run cannot start on this computer yet:</strong>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            Set the agent up in <strong>Agents</strong> (install, sign in, or lift a limit), or choose another one with{" "}
            <strong>Advanced</strong>.
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setStage("ask")} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void start()}
          disabled={busy || !prompt.trim() || problems.length > 0}
          title={problems.length ? "An agent this run needs is not ready" : undefined}
        >
          {busy ? "Starting…" : "Start run"}
        </button>
      </footer>
    </section>
  );
}

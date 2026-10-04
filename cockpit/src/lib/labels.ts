import type { BusMessageKind, RequestKind, Role, Run, StepKind } from "../daemon/types";

export const STEP_LABEL: Record<StepKind, string> = {
  plan: "Plan",
  implement: "Implement",
  gate: "Gate",
  review: "Review",
  pull_request: "Pull request",
  custom: "Custom",
};

export const ROLE_LABEL: Record<Role, string> = {
  planner: "Planner",
  implementer: "Implementer",
  reviewer: "Reviewer",
};

export const REQUEST_LABEL: Record<RequestKind, string> = {
  plan: "Plan approval",
  step: "Step approval",
  permission: "Permission",
  budget: "Budget exceeded",
  question: "Question",
};

/** Label of a pipeline role; custom role names are shown capitalised. */
export function roleLabel(role: string): string {
  return (ROLE_LABEL as Record<string, string>)[role] ?? (role ? role[0].toUpperCase() + role.slice(1) : "Agent");
}

export const BUS_KIND_LABEL: Record<BusMessageKind, string> = {
  message: "message",
  review_request: "review request",
  handoff: "handoff",
  human_answer: "late answer",
  question: "question",
  answer: "answer",
  wake: "wake",
  turn_limit: "turn limit",
  tool_denied: "tool denied",
  joined: "joined",
  left: "left",
};

/** How a run is referred to: its issue number, or its id for prompt-only runs. */
export function runRef(run: Pick<Run, "id" | "issue">): string {
  return run.issue != null ? `#${run.issue}` : run.id;
}

import type { BusTool, RequestKind, Role, Run, StepKind } from "../daemon/types";

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
};

/** Label of a pipeline role; custom role names are shown capitalised. */
export function roleLabel(role: string): string {
  return (ROLE_LABEL as Record<string, string>)[role] ?? (role ? role[0].toUpperCase() + role.slice(1) : "Agent");
}

export const BUS_TOOL_LABEL: Record<BusTool, string> = {
  post_message: "message",
  request_review: "review request",
  handoff: "handoff",
  ask_human: "ask human",
};

/** How a run is referred to: its issue number, or its id for prompt-only runs. */
export function runRef(run: Pick<Run, "id" | "issue">): string {
  return run.issue != null ? `#${run.issue}` : run.id;
}

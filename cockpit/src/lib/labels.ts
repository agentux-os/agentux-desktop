import type { BusTool, RequestKind, Role, StepKind } from "../daemon/types";

export const STEP_LABEL: Record<StepKind, string> = {
  plan: "Plan",
  implement: "Implement",
  gate: "Gate",
  review: "Review",
  pull_request: "Pull request",
};

export const ROLE_LABEL: Record<Role, string> = {
  planner: "Planner",
  implementer: "Implementer",
  reviewer: "Reviewer",
};

export const REQUEST_LABEL: Record<RequestKind, string> = {
  plan: "Plan approval",
  command: "Run command",
  edit: "Edit file",
  network: "Network access",
  question: "Question",
  budget: "Budget exceeded",
};

export const BUS_TOOL_LABEL: Record<BusTool, string> = {
  post_message: "message",
  request_review: "review request",
  handoff: "handoff",
  ask_human: "ask human",
};

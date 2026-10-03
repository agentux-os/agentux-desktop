import type {
  BusTool,
  CheckStatus,
  PlanItem,
  RequestKind,
  RequestStatus,
  Role,
  SessionState,
  StepKind,
  ToolKind,
  Vendor,
} from "../types";

/** A unified diff fragment written by hand: lines prefixed with ' ', '+' or '-'. */
export interface DiffSpec {
  path: string;
  /** e.g. "@@ -12,6 +12,9 @@ fn start()" */
  header: string;
  body: string;
}

export interface ScenarioSpec {
  key: string;
  projectId: string;
  issue: number;
  title: string;
  slug: string;
  prompt: string;
  roles: Record<Role, Vendor>;
  explore: { intro: string; search: string; searchOutput: string; read: string; finding: string };
  plan: string[];
  planApproval?: boolean;
  implement: {
    intro: string;
    diffs: DiffSpec[];
    command?: { kind: Extract<RequestKind, "command" | "network">; cmd: string; why: string; output: string };
    summary: string;
  };
  checks: { name: string; command: string }[];
  gateFailure?: { check: string; output: string; note: string; fix: DiffSpec };
  question?: { at: "implement" | "review"; text: string; options: string[] };
  review: {
    stat: string;
    focus: string;
    changes?: { comment: string; reply: string; fix: DiffSpec };
    approve: string;
  };
  pr: { number: number; summary: string };
}

export type Endpoint = Role | "human" | "daemon";

/** Operations a beat may perform on its run. Implemented by the mock client. */
export interface RunCtx {
  readonly branch: string;
  step(step: StepKind, activity: string): void;
  activity(text: string): void;
  sessionState(role: Role, state: SessionState): void;
  user(role: Role, text: string): void;
  say(role: Role, text: string, tokens?: [number, number]): void;
  system(role: Role, text: string): void;
  toolStart(role: Role, key: string, tool: ToolKind, title: string, input?: string): void;
  toolEnd(key: string, status: "ok" | "error", output?: string): void;
  diff(role: Role, spec: DiffSpec): void;
  plan(role: Role, items: PlanItem[]): void;
  /** Creates a pending request and marks the run as waiting for the human. */
  request(role: Role, kind: RequestKind, title: string, detail: string, options?: string[]): string;
  decision(requestId: string): { status: RequestStatus; answer?: string };
  bus(tool: BusTool, from: Endpoint, to: Endpoint, subject: string, body: string, turn?: number): void;
  checks(status: CheckStatus, only?: string): void;
  gateAttempt(n: number): void;
  reviewRound(n: number): void;
  finish(prNumber: number): void;
}

export interface Beat {
  /** Milliseconds to wait after the previous beat (or after unblocking). */
  delay: number;
  /** Named point in the script, used to seed runs at a given stage. */
  mark?: string;
  act(ctx: RunCtx): void | { blockOn: string };
}


export function buildScript(s: ScenarioSpec): Beat[] {
  const beats: Beat[] = [];
  const b = (delay: number, act: Beat["act"], mark?: string) => beats.push({ delay, act, mark });
  let reqId = "";
  let gate = 0;
  let turn = 0;
  const planItems = (doneUpTo: number, active = -1): PlanItem[] =>
    s.plan.map((text, i) => ({
      text,
      status: i < doneUpTo ? "done" : i === active ? "in_progress" : "pending",
    }));

  const runGate = (failing?: string) => {
    gate += 1;
    const attempt = gate;
    b(1300, (c) => {
      c.step("gate", `Running checks (attempt ${attempt}/3)`);
      c.gateAttempt(attempt);
      c.checks("pending");
    }, attempt === 1 ? "gate-start" : undefined);
    for (const check of s.checks) {
      b(900, (c) => c.checks("running", check.name));
      b(1500, (c) => c.checks(check.name === failing ? "failed" : "passed", check.name));
    }
  };

  // ---- plan -------------------------------------------------------------
  b(0, (c) => {
    c.step("plan", "Planner reading the issue");
    c.user("planner", `#${s.issue} ${s.title}\n\n${s.prompt}`);
  }, "start");
  b(1500, (c) => c.say("planner", s.explore.intro, [9_000, 180]));
  b(1300, (c) => c.toolStart("planner", "search", "search", `Search for "${s.explore.search}"`, `rg -n "${s.explore.search}"`));
  b(1100, (c) => c.toolEnd("search", "ok", s.explore.searchOutput));
  b(1200, (c) => c.toolStart("planner", "read", "read", `Read ${s.explore.read}`, s.explore.read));
  b(1000, (c) => c.toolEnd("read", "ok"));
  b(1800, (c) => c.say("planner", s.explore.finding, [24_000, 420]));
  b(1500, (c) => {
    c.plan("planner", planItems(0));
    c.activity("Plan drafted");
  });
  if (s.planApproval) {
    b(1200, (c) => {
      reqId = c.request("planner", "plan", `Approve plan for #${s.issue}`, s.plan.map((p, i) => `${i + 1}. ${p}`).join("\n"));
      c.activity("Plan waiting for your approval");
      return { blockOn: reqId };
    }, "plan-approval");
    b(700, (c) => {
      const d = c.decision(reqId);
      c.system("planner", d.status === "denied" ? "Plan rejected. Planner narrowed the scope and continues with the first item only." : "Plan approved.");
    });
  }
  b(1000, (c) => {
    c.bus("handoff", "planner", "implementer", `Plan for #${s.issue}`, s.plan.map((p, i) => `${i + 1}. ${p}`).join("\n"));
    c.sessionState("planner", "ended");
  });

  // ---- implement --------------------------------------------------------
  b(1200, (c) => {
    c.step("implement", "Implementer starting");
    c.system("implementer", `Handoff from planner received. Worktree on branch ${c.branch}.`);
  });
  b(1500, (c) => {
    c.say("implementer", s.implement.intro, [18_000, 260]);
    c.plan("implementer", planItems(0, 0));
  });
  s.implement.diffs.forEach((d, i) => {
    b(1500, (c) => {
      c.activity(`Editing ${d.path}`);
      c.toolStart("implementer", `edit${i}`, "edit", `Edit ${d.path}`, d.path);
    });
    b(1400, (c) => {
      c.toolEnd(`edit${i}`, "ok");
      c.diff("implementer", d);
      c.plan("implementer", planItems(i + 1, i + 1));
    });
    if (i === 0 && s.question?.at === "implement") addQuestion("implementer");
  });
  const cmd = s.implement.command;
  if (cmd) {
    b(1300, (c) => {
      reqId = c.request("implementer", cmd.kind, cmd.kind === "network" ? "Allow network access" : "Run command", cmd.cmd);
      c.say("implementer", cmd.why, [6_000, 90]);
      c.activity("Waiting for permission to run a command");
      return { blockOn: reqId };
    }, "command-approval");
    b(800, (c) => {
      if (c.decision(reqId).status === "denied") {
        c.system("implementer", "Permission denied. Continuing without it.");
      } else {
        c.toolStart("implementer", "cmd", cmd.kind === "network" ? "fetch" : "execute", cmd.cmd, cmd.cmd);
      }
    });
    b(1600, (c) => {
      if (c.decision(reqId).status !== "denied") c.toolEnd("cmd", "ok", cmd.output);
    });
  }
  b(1500, (c) => {
    c.say("implementer", s.implement.summary, [31_000, 520]);
    c.plan("implementer", planItems(s.plan.length));
  });

  // ---- gate -------------------------------------------------------------
  if (s.gateFailure) {
    const gf = s.gateFailure;
    runGate(gf.check);
    b(1200, (c) => {
      c.toolStart("implementer", "gatefail", "execute", `Gate: ${gf.check} failed`, s.checks.find((x) => x.name === gf.check)?.command);
      c.toolEnd("gatefail", "error", gf.output);
      c.system("implementer", `Gate failed on ${gf.check} (attempt ${gate}/3). Output sent back to the implementer.`);
      c.step("implement", `Fixing ${gf.check} failure`);
    }, "gate-fail");
    b(1600, (c) => c.say("implementer", gf.note, [22_000, 240]));
    b(1400, (c) => c.toolStart("implementer", "gfix", "edit", `Edit ${gf.fix.path}`, gf.fix.path));
    b(1200, (c) => {
      c.toolEnd("gfix", "ok");
      c.diff("implementer", gf.fix);
    });
  }
  runGate();

  // ---- review -----------------------------------------------------------
  b(1200, (c) => {
    c.step("review", "Cross-vendor review");
    c.reviewRound(1);
    c.sessionState("implementer", "idle");
    turn = 1;
    c.bus("request_review", "implementer", "reviewer", `Review ${c.branch}`, `Ready for review. ${s.implement.summary}`, turn);
    c.system("reviewer", "Review requested by the implementer over the agentux bus.");
  });
  b(1400, (c) => c.toolStart("reviewer", "stat", "execute", "git diff --stat", "git diff main...HEAD --stat"));
  b(1100, (c) => c.toolEnd("stat", "ok", s.review.stat));
  b(1700, (c) => c.say("reviewer", s.review.focus, [38_000, 610]));
  if (s.question?.at === "review") addQuestion("reviewer");
  const ch = s.review.changes;
  if (ch) {
    b(1800, (c) => {
      turn += 1;
      c.say("reviewer", ch.comment, [12_000, 340]);
      c.bus("post_message", "reviewer", "implementer", "Changes requested", ch.comment, turn);
      c.activity("Reviewer requested changes");
    }, "review-changes");
    b(1300, (c) => {
      c.step("implement", "Addressing review feedback");
      c.sessionState("implementer", "active");
      c.system("implementer", "Message from reviewer received over the agentux bus.");
    });
    b(1600, (c) => {
      turn += 1;
      c.say("implementer", ch.reply, [16_000, 220]);
      c.bus("post_message", "implementer", "reviewer", "Re: Changes requested", ch.reply, turn);
    });
    b(1400, (c) => c.toolStart("implementer", "rfix", "edit", `Edit ${ch.fix.path}`, ch.fix.path));
    b(1200, (c) => {
      c.toolEnd("rfix", "ok");
      c.diff("implementer", ch.fix);
    });
    runGate();
    b(1200, (c) => {
      c.step("review", "Re-review");
      c.reviewRound(2);
      c.sessionState("implementer", "idle");
      turn += 1;
      c.bus("request_review", "implementer", "reviewer", `Re-review ${c.branch}`, "Feedback addressed, checks green.", turn);
    });
  }
  b(1700, (c) => {
    turn += 1;
    c.say("reviewer", s.review.approve, [21_000, 280]);
    c.bus("post_message", "reviewer", "implementer", "Approved", s.review.approve, turn);
    c.sessionState("reviewer", "ended");
  });

  // ---- pull request -----------------------------------------------------
  b(1200, (c) => {
    c.step("pull_request", "Opening pull request");
    c.sessionState("implementer", "active");
    c.toolStart("implementer", "pr", "execute", "Open pull request", `gh pr create --head ${c.branch} --fill`);
  });
  b(1700, (c) => {
    c.toolEnd("pr", "ok", `https://github.com/.../pull/${s.pr.number}`);
    c.say("implementer", s.pr.summary, [9_000, 300]);
    c.finish(s.pr.number);
  }, "end");

  return beats;

  function addQuestion(role: Role) {
    const q = s.question!;
    b(1300, (c) => {
      reqId = c.request(role, "question", "Question from agent", q.text, q.options);
      c.bus("ask_human", role, "human", "Decision needed", q.text);
      c.activity("Asked you a question");
      return { blockOn: reqId };
    }, "question");
    b(800, (c) => {
      const d = c.decision(reqId);
      c.system(role, d.status === "denied" ? "You dismissed the question; the agent picks the conservative option." : `You answered: ${d.answer}`);
    });
  }
}

export function scriptMarkIndex(beats: Beat[], mark: string): number {
  const i = beats.findIndex((x) => x.mark === mark);
  return i < 0 ? beats.length : i;
}

# 0003. Start with an embedded state machine, not Temporal

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

A run (plan → implement → test → review → PR) can take an hour, hit rate limits, wait days for a human approval, and must survive crashes and reboots. Durability is a core promise.

The original concept used both Temporal (durable workflows) and Langflow (visual LLM flows). These overlap: Langflow builds LLM pipelines visually but is not a durable workflow engine, and running both means two orchestrators to operate and reconcile. Temporal also requires a server process and a database, which is heavy for a tool installed on a laptop.

The MVP's workflow is a single linear pipeline with a bounded fix-up loop and approval gates. It does not need distributed workers, cross-machine scheduling or arbitrary graphs.

## Decision

- Runs are **explicit state machines persisted in SQLite**, embedded in `agentuxd`. Every transition is written before its side effects, so a restarted daemon resumes each run from its last committed state.
- Steps that call harnesses or external services are **idempotent or record enough to be safely retried** (for example, check whether a PR exists before creating it).
- Pipelines are **declared in the repository** (`agentux.yaml`): which harness implements, which reviews, which commands gate, the retry limit, and which steps require approval.
- **Langflow is out of scope.** A visual editor, if ever needed, edits `agentux.yaml`.
- The engine sits behind an interface so it can be replaced by Temporal or Restate once requirements justify it.

## Consequences

- Zero extra infrastructure: one binary and one SQLite file.
- AgentUX owns retry, timeout and resume logic that Temporal would provide for free. The scope stays small only while pipelines stay simple.
- Revisit this ADR when any of these becomes necessary: distributed workers, team-shared runs on a server, or workflows with arbitrary branching.

## Alternatives considered

- **Temporal** — the right tool at team or server scale; too heavy to require for a single developer's first run.
- **Restate / DBOS / Hatchet / Inngest** — lighter durable-execution options; worth re-evaluating together with Temporal when this ADR is revisited.
- **Langflow** — not a durable workflow engine.

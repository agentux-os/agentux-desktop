# 0005. Pipelines are declared in `agentux.yaml`

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

[0003](0003-workflow-engine.md) makes pipelines part of each repository, and [0004](0004-unified-interface-and-agent-bus.md) gives agents a bus to talk to each other. The format must let a project say which harness plays which role, which commands gate progress, where a human must approve, and how much agents may spend — without becoming a programming language.

## Decision

Each project may contain `agentux.yaml` at its root. Without one, AgentUX uses the built-in default pipeline below.

```yaml
version: 1

# Roles map to harnesses. Any harness configured in AgentUX can fill a role.
roles:
  implementer:
    harness: claude-code
  reviewer:
    harness: codex            # a different vendor than the implementer
  planner:
    harness: claude-code
    model: opus               # optional; passed to the harness if it supports it

# Commands the gate steps run, inside the run's worktree.
checks:
  - name: lint
    run: just lint
  - name: test
    run: just test

pipeline:
  - step: plan
    role: planner
    approve: true             # wait for the human before implementing
  - step: implement
    role: implementer
  - step: gate
    checks: [lint, test]
    on_fail: implement        # loop back with the failure output
    max_attempts: 3
  - step: review
    role: reviewer
    on_changes_requested: implement
    max_rounds: 2
  - step: pull_request
    draft: false
    approve: false            # true = wait for the human before opening the PR

# Agent bus limits (ADR 0004).
bus:
  max_turns_per_exchange: 6
  allow: [post_message, request_review, handoff, get_run_state, ask_human]

budget:
  max_usd_per_run: 10         # pause the run and ask the human when exceeded
```

Rules:

- **Fixed step types:** `plan`, `implement`, `gate`, `review`, `pull_request`, plus `custom` (a prompt sent to a role). New step types are added by ADR, not by users.
- **Loops only point backwards** and always carry a limit (`max_attempts`, `max_rounds`). There are no conditionals or arbitrary jumps.
- **Secrets and credentials never appear in the file.** Harness logins stay in each harness's own configuration on the machine.
- **Validation is strict:** unknown keys fail with a clear error, and `aux validate` checks a file without starting a run.
- The `version` key allows breaking changes with migration.

## Consequences

- A pipeline is readable in one screen and reviewable in a pull request like any other code.
- Swapping vendors for a role is a one-line change.
- Cross-vendor review is the default but not enforced; a project may use the same harness for both roles.
- Complex flows (fan-out to several implementers, conditional steps) are not expressible yet; they will need a new ADR and a new `version`.

## Alternatives considered

- **Workflows as code (TypeScript or Python)** — maximum flexibility, but every project then carries an executable orchestration program, which is harder to validate and visualize in the cockpit.
- **Visual-only editor (Langflow-style)** — not diffable or reviewable in a pull request.
- **GitHub Actions syntax** — familiar, but built for CI jobs, not for roles, conversations and approvals.

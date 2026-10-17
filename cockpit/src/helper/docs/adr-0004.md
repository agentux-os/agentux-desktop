# 0004. Unified interface over existing CLIs, and an agent bus so they talk to each other

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

AgentUX uses each provider's own CLI harness (Claude Code, Codex, OpenCode, Antigravity CLI) instead of reimplementing agents. Two problems follow:

1. **Fragmented interface.** Every CLI has its own TUI, keybindings, permission prompts and output format. Watching four of them across several projects means juggling terminals.
2. **Isolated agents.** Each CLI only knows its own session. An implementer cannot hand work to a reviewer, ask another agent a question, or see what others are doing in the same project.

## Decision

### One interface on top of every CLI

The **cockpit** is a desktop app (Tauri) and the main surface of the distribution. It talks only to `agentuxd`, never to harnesses directly.

- **Structured mode (default).** For harnesses connected through ACP ([0002](0002-harness-integration-via-acp.md)), the cockpit renders sessions natively: messages, tool calls, file diffs, plans and permission requests look identical whatever the vendor. A permission request from Codex and one from Claude Code appear in the same approval queue, with the same shortcut to approve.
- **Terminal mode (escape hatch).** Any session can be opened as the harness's own TUI in an embedded terminal (PTY managed by the daemon). This covers harnesses without ACP and features not exposed through it. Structured and terminal views attach to the same session; switching never restarts the agent.
- **Layout.** Projects in a sidebar; for the selected project, a board of runs (planned, implementing, testing, in review, waiting for you, done); a session view; a global approvals inbox; token spend per run, project and vendor in the status bar.
- **`aux` mirrors the cockpit** in the terminal (`aux ps`, `aux attach`, `aux approve`), so everything works over SSH.

### An agent bus so agents talk to each other

`agentuxd` hosts an **agent bus** and exposes it to every harness as an MCP server (`agentux`). Each session gets a scoped identity (run, project, role, vendor). Tools:

| Tool | Purpose |
|---|---|
| `post_message` / `read_messages` | Talk to another session, the run's channel, or the human |
| `request_review` | Ask a reviewer role (configured to another vendor) to review the current diff |
| `handoff` | Pass the task to another role with a summary and pointers |
| `get_run_state` | See the run's step, branch, test results and open requests |
| `ask_human` | Escalate a decision; it lands in the cockpit inbox |

Direct conversation is mediated, never peer-to-peer: the daemon routes messages, wakes the target session by sending it a prompt through ACP, logs every exchange, and enforces limits (maximum turns per exchange, token budget per run) so two agents cannot loop forever.

The pipeline in `agentux.yaml` ([0003](0003-workflow-engine.md)) still drives the main flow. The bus covers what a fixed pipeline cannot: questions, consultations and handoffs that agents decide on themselves.

## Consequences

- The user learns one interface; vendors become interchangeable roles.
- Cross-vendor review and consultation become first-class instead of copy-paste between terminals.
- The bus is ordinary MCP, so any harness that supports MCP servers can join without a custom adapter.
- Every inter-agent message is visible and auditable in the cockpit, which matters for trust and debugging.
- Two rendering paths (structured and terminal) must be maintained.
- Agents must be told the bus exists. Each harness's session starts with a short system prompt describing its role and the `agentux` tools.

## Alternatives considered

- **Terminal multiplexer only (tmux-style grid of TUIs)** — cheap, but no unified approvals, no shared state and no structured view.
- **A2A protocol for agent-to-agent communication** — designed for networked agent services; harness CLIs do not speak it, and MCP reaches all of them today.
- **Free-form shared chat room** — agents talking without routing or limits tends to loop and burn tokens; mediated messages keep it bounded.

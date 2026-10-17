# 0007. Terminal mode is a handoff of the vendor session, not a second driver

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** [0004](0004-unified-interface-and-agent-bus.md), "Terminal mode (escape hatch)"

## Context

[0004](0004-unified-interface-and-agent-bus.md) promises that any session can be opened in the harness's own TUI, that structured and terminal views attach to the same session, and that "switching never restarts the agent".

Building it ([agentux-core#11](https://github.com/agentux-os/agentux-core/pull/11)) showed that the promise cannot hold literally. A structured session is driven over stdio by the vendor's ACP adapter ([0002](0002-harness-integration-via-acp.md)); the interactive TUI is a separate process. The two can only share a conversation where the TUI can resume a vendor session by id, and they must never drive it at the same time: a stale adapter would not see what happened in the TUI, and two writers on one session would conflict.

What the harnesses offer, at the versions agentux-core pins:

| Harness | ACP session id is the vendor's id | TUI resume | ACP `session/load` |
|---|---|---|---|
| `claude-code` (`claude-agent-acp` 0.85.1) | yes | `claude --resume <id>` | yes |
| `codex` (`codex-acp` 2.1.1) | yes | `codex resume <id>` | yes |
| `opencode` (1.18.34) | yes | `opencode --session <id>` | yes |
| `antigravity` | not checked | none known | not checked |

## Decision

Terminal mode is a **handoff** of the vendor session between the daemon's ACP adapter and the harness's TUI, never two drivers at once. This replaces 0004's "switching never restarts the agent" with the following:

> **Terminal mode (escape hatch), amended.** Any session can be opened as the harness's own TUI in an embedded terminal (PTY managed by the daemon). The ACP session and the TUI are separate processes driving one vendor session, so they take turns: opening the TUI waits for the current ACP turn, stops the ACP adapter and holds the session's further turns (steps, bus wakes, human messages), and the TUI resumes the same vendor session by id (`claude --resume`, `codex resume`, `opencode --session`; the ACP session id is the vendor id for these adapters). When the TUI exits, the daemon reopens the session over ACP with `session/load`, so the agent keeps everything said in the TUI, and the held turns run. Switching never restarts the conversation; the adapter process is restarted. Harnesses that cannot resume a session by id in their TUI, or cannot `session/load`, get a shell in the run's worktree instead, with a banner explaining why. The agent bus is not available inside the TUI.

In practice:

1. Opening the TUI (`terminals.open` with `command: "harness-tui"`, used by `aux attach` and the cockpit) waits for the turn in progress, stops the session's ACP adapter and marks the session `attached`.
2. While the session is attached, every turn the daemon would send it — pipeline steps of that role, bus wakes, `sessions.prompt` / `aux say` — is queued, and the queuing is visible (a `system` message; `sessions.prompt` returns `queued: true`).
3. The TUI runs on the stored vendor session id (`Session.vendorSessionId`).
4. When the TUI exits (quit, detach, `terminals.close`, or the client connection dropping), the daemon reopens the session with ACP `session/load` and the same id, without recording the replayed history again, then runs the queued turns.
5. When a handoff is not possible — no resume command, no vendor id yet, the CLI missing, or fake agents — the terminal is a shell in the run's worktree, and the reason is reported (`Terminal.fallback`) and shown as a banner.

## Consequences

- The promise users rely on still holds where it matters: the conversation is never lost or restarted, and nothing said in the TUI is invisible to the next ACP turn.
- The daemon owns a per-session lock for the whole handoff, so a run can stall while a human sits in the TUI. That is the intended trade: the human has the session.
- Every harness that joins AgentUX needs two capabilities for a full terminal mode — a TUI that resumes by session id, and ACP `session/load` — plus a vendor session id equal to (or mappable from) the ACP session id. Harnesses without them get the worktree shell only.
- The `agentux` bus MCP server is not passed to the TUI, so an agent cannot use the bus while attached.
- Taking a session over mid-turn (cancelling the ACP turn) is not offered; the terminal waits for the turn to finish.
- The id equivalence for Claude Code and Codex comes from the adapters' source at pinned versions, so adapter upgrades must re-check it.

## Alternatives considered

- **Keep both drivers attached at once** — the adapter would act on a stale view of the conversation, and concurrent writes to one vendor session are undefined.
- **Mirror the ACP stream into a fake TUI** — keeps one driver but is not the vendor's TUI, which is the whole point of the escape hatch (features ACP does not expose).
- **Start a fresh TUI session with a summary of the ACP one** — simple, but it is a restart of the conversation, exactly what 0004 set out to avoid.
- **Shell only, no TUI** — always safe, but loses the vendor TUI for the harnesses that can resume.

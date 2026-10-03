# agentux-desktop

The desktop experience of [AgentUX](https://github.com/agentux-os/agentux): the cockpit app and the desktop configuration shipped with the distribution.

> **Status:** not started. Design decisions live in [agentux/docs/adr](https://github.com/agentux-os/agentux/tree/main/docs/adr).

## Cockpit

One interface on top of every coding agent CLI (Tauri app, talks only to `agentuxd`):

- **Session view.** Messages, tool calls, diffs, plans and permission requests rendered the same way whatever the vendor. The harness's own TUI opens in an embedded terminal on the same session, without restarting it.
- **Run board.** Per project: planned, implementing, testing, in review, waiting for you, done.
- **Approvals inbox.** Every permission request and escalation from every agent in one queue, with one shortcut to approve.
- **Agent bus feed.** Messages, review requests and handoffs between agents, visible and auditable.
- **Spend.** Tokens and cost per run, project and vendor.

## Desktop configuration

KDE Plasma (Wayland) defaults for the AgentUX image: layouts for watching several agents at once, global shortcuts (open cockpit, approve, new run), theme and status widgets.

## Relevant ADRs

- [0001 — Linux distribution on Fedora Atomic](https://github.com/agentux-os/agentux/blob/main/docs/adr/0001-linux-distribution-on-fedora-atomic.md)
- [0004 — Unified interface and agent bus](https://github.com/agentux-os/agentux/blob/main/docs/adr/0004-unified-interface-and-agent-bus.md)

## License

[Apache 2.0](LICENSE)

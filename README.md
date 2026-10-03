# agentux-desktop

The desktop experience of [AgentUX](https://github.com/agentux-os/agentux): the cockpit app and the desktop configuration shipped with the distribution.

> **Status:** cockpit scaffold running on mock data; `agentuxd` does not exist yet. Design decisions live in [agentux/docs/adr](https://github.com/agentux-os/agentux/tree/main/docs/adr).

## Cockpit

One interface on top of every coding agent CLI (Tauri app, talks only to `agentuxd`):

- **Session view.** Messages, tool calls, diffs, plans and permission requests rendered the same way whatever the vendor. The harness's own TUI opens in an embedded terminal on the same session, without restarting it.
- **Run board.** Per project: planned, implementing, testing, in review, waiting for you, done.
- **Approvals inbox.** Every permission request and escalation from every agent in one queue, with one shortcut to approve.
- **Agent bus feed.** Messages, review requests and handoffs between agents, visible and auditable.
- **Spend.** Tokens and cost per run, project and vendor.

## Developing the cockpit

The cockpit lives in [`cockpit/`](cockpit): a [Tauri 2](https://v2.tauri.app) app with a React + TypeScript + Vite frontend (ADR 0006). Until `agentuxd` exists, it runs on a mock daemon that plays realistic runs through the pipeline: several projects, sessions from Claude Code, Codex, OpenCode and Antigravity, permission requests, cross-vendor review over the agent bus, and token spend per vendor.

**Requirements:** Node.js 20+ and npm. For the desktop window you also need Rust (stable) and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) (on Fedora: `webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel`, plus the `C Development Tools and Libraries` group).

```sh
cd cockpit
npm install

npm run dev         # browser-only mock mode at http://localhost:1420 (no Rust needed)
npm run tauri dev   # the same UI in the native Tauri window
npm run typecheck   # tsc
npm run build       # typecheck + production bundle in dist/
```

Append `?speed=3` to the dev URL to make the mock runs move faster.

### Layout of the code

| Path | What it is |
|---|---|
| `cockpit/src/daemon/types.ts` | Domain model: projects, runs, steps, sessions, vendor-neutral session events, permission requests, bus messages, spend |
| `cockpit/src/daemon/client.ts` | The `DaemonClient` interface the UI depends on, and `createDaemonClient()` |
| `cockpit/src/daemon/mock/` | `MockDaemonClient` plus the scripted scenarios it plays |
| `cockpit/src/components/` | Run board, session view, approvals inbox, agent bus feed, status bar |
| `cockpit/src-tauri/` | Minimal Rust shell that hosts the window |

To plug in the real daemon, implement `DaemonClient` (keeping an immutable `CockpitState` up to date from the daemon's event stream) and return it from `createDaemonClient()`. No component talks to anything else.

### Keyboard

`B` / `I` / `M` switch between run board, approvals inbox and agent bus. `A` approves the focused request (the inbox selection or the open run's pending request), `D` denies, `1`–`9` answers an agent's question, `J`/`K` move through the inbox, `T` toggles terminal mode, `[`/`]` cycle projects, `?` lists everything.

### Not there yet

- Terminal mode is a placeholder; the embedded PTY will come from `agentuxd`.
- Starting runs ("New run") needs the daemon.
- Prices in the mock are illustrative.

## Desktop configuration

KDE Plasma (Wayland) defaults for the AgentUX image: layouts for watching several agents at once, global shortcuts (open cockpit, approve, new run), theme and status widgets.

## Relevant ADRs

- [0001 — Linux distribution on Fedora Atomic](https://github.com/agentux-os/agentux/blob/main/docs/adr/0001-linux-distribution-on-fedora-atomic.md)
- [0004 — Unified interface and agent bus](https://github.com/agentux-os/agentux/blob/main/docs/adr/0004-unified-interface-and-agent-bus.md)

## License

[Apache 2.0](LICENSE)

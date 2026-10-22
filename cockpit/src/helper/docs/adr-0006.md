# 0006. Rust for agentuxd and aux; Tauri 2 with React and TypeScript for the cockpit

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

`agentux-core` is about to get its first code. The language choice shapes everything that follows: how harnesses are driven, how the agent bus is served, how the daemon is packaged in the image, and how much code the cockpit can share with it.

The daemon is long-running and sits on a desktop next to several harness CLIs that run on Node or Bun and already dominate memory use ([0001](0001-linux-distribution-on-fedora-atomic.md)). It spawns and supervises child processes, manages PTYs for terminal mode ([0004](0004-unified-interface-and-agent-bus.md)), speaks ACP over stdio to harnesses ([0002](0002-harness-integration-via-acp.md)) and serves MCP to them as the agent bus.

The cockpit is a Tauri app ([0004](0004-unified-interface-and-agent-bus.md)), so its backend is Rust whatever the daemon uses.

## Decision

- **Rust for all of `agentux-core`.** `agentuxd`, `aux`, the harness adapters, the workflow engine and the agent bus are one cargo workspace.
- **Official protocol SDKs.** ACP through the [`agent-client-protocol`](https://crates.io/crates/agent-client-protocol) crate (the one Zed uses for external agents) and MCP through [`rmcp`](https://github.com/modelcontextprotocol/rust-sdk), the official MCP Rust SDK. Both are built on tokio.
- **One static binary per tool, low memory.** `agentuxd` and `aux` ship as single binaries with no runtime to install, which keeps packaging in the bootc image trivial and leaves memory to the harnesses. tokio covers async I/O, process supervision and PTYs.
- **Cockpit: Tauri 2.** Its Rust backend depends on shared crates from `agentux-core` for the daemon's API types, so the daemon, `aux` and the cockpit cannot drift apart.
- **Cockpit frontend: React, TypeScript and Vite**, chosen for contributor familiarity and ecosystem: diff viewers, and xterm.js for terminal mode.
- **Daemon API: JSON over a Unix domain socket**, local only, with server-sent events for streaming sessions, run state and approvals. `aux` and the cockpit are both clients of it. The exact protocol will be specified in a later ADR.

## Consequences

- Protocol support comes from maintained official SDKs instead of hand-written JSON-RPC.
- API types are defined once in Rust and reused by the daemon, the CLI and the cockpit backend.
- The image gains small binaries with predictable memory use and no extra runtime.
- Rust has a steeper learning curve than Go or TypeScript, which narrows the contributor pool for the core.
- Compile times are longer, especially for clean CI builds; caching is needed from the start.
- The cockpit spans two languages (Rust backend, TypeScript frontend), and frontend types must be generated from or kept in sync with the Rust ones.
- On Linux, Tauri renders with WebKitGTK, which is slower than Chromium and has GPU quirks on some drivers. The distribution pins the WebKitGTK version, and the cockpit's Rust shell only hosts the window, so moving the React frontend to Electron stays a contained change if VM and hardware testing shows WebKitGTK is not good enough.

## Alternatives considered

- **Go** — simple, fast builds and an official MCP Go SDK, but no code shared with Tauri's Rust backend and a weaker ACP SDK story.
- **TypeScript on Bun** — official ACP and MCP TypeScript SDKs and the fastest iteration, but heavier runtime memory next to Node-based harnesses and a weaker single-binary and daemon story.
- **Electron for the cockpit** — Chromium renders more consistently than WebKitGTK and the ecosystem (xterm.js, node-pty) is mature, but each window costs roughly 150–300 MB of RAM on a desktop that already runs several Node-based harness CLIs. Kept as the fallback, see Consequences.
- **Python** — not suited to a long-running desktop daemon shipped as a binary.

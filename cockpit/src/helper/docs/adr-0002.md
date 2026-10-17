# 0002. Integrate harnesses through ACP, with headless CLIs as fallback

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

AgentUX needs to drive coding harnesses from several vendors: start a session in a given directory, send prompts, stream progress, answer permission requests and collect the result.

The original concept used the Model Context Protocol (MCP) for this. MCP solves a different problem: it gives an agent access to tools and data. It does not let a client control the agent itself.

The [Agent Client Protocol](https://agentclientprotocol.com) (ACP) does. It is JSON-RPC 2.0 over stdio, created by Zed in 2025, and by 2026 Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI and dozens of other agents support it, natively or through adapters. Zed 1.0 and Microsoft's Intelligent Terminal both use it as their agent interface.

Desktop apps (Claude Desktop, the Codex app, the Antigravity app) cannot be embedded or driven. Only their CLI or SDK counterparts can be integrated.

## Decision

1. **ACP is the primary integration.** A harness that speaks ACP needs only configuration (command, arguments, environment), not code.
2. **Native headless modes are the fallback**, behind the same internal adapter interface:
   - Claude Code: `claude -p --output-format stream-json`, or the Claude Agent SDK.
   - Codex: `codex exec --json`.
   - OpenCode: `opencode serve` (HTTP API).
3. **Antigravity CLI (`agy`) is experimental.** Its print mode hangs without a TTY (google-antigravity/antigravity-cli#318). It is supported once ACP or a working headless mode is available.
4. **MCP is for tools, not control.** AgentUX exposes its agent bus to harnesses as an MCP server ([0004](0004-unified-interface-and-agent-bus.md)), but harnesses keep their own built-in tools.
5. **Credentials stay with the user.** Each harness uses the login or API key the user configured for it. AgentUX does not pool, share or proxy credentials, and does not route around any vendor's terms of use.

## Consequences

- Adding a new ACP harness is a configuration change, which keeps the multi-vendor promise cheap to maintain.
- Permission requests arrive through one protocol, so approvals look the same in the CLI and the cockpit regardless of vendor.
- Behavior still differs per harness (cost reporting, session resume, sandboxing). Adapters must normalize what they can and surface the rest as capabilities.
- AgentUX depends on ACP's evolution and on the quality of each vendor's adapter.

## Alternatives considered

- **MCP as the control protocol** — not designed for it; would require a custom protocol on top.
- **Pseudo-terminal scraping** — works with any CLI, but is fragile and loses structure (tool calls, diffs, permission requests).
- **Vendor SDKs only** — richest integration, but one bespoke adapter per vendor and no reuse of the ACP ecosystem.

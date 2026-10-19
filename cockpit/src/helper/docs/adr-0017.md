# 0017. A help mascot that knows AgentUX, offline first

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

The cockpit packs a lot into one window: a run board, an approvals inbox, the agent bus, session panels with a terminal handoff, and a status bar that tracks a daemon. The Welcome wizard ([0013](0013-first-run-wizard.md)) sets the machine up but explains none of it. The owner asked for "a mascot that answers questions and gives a guided tour on first use", with a mode where you "click on something in the cockpit and it says what it is and how it works". They set its scope: it only covers AgentUX's own tools, not the graphical environment. Since [0014](0014-installation-profiles-and-platform-services.md) and the move to COSMIC as the image base, that environment can be COSMIC, Plasma or Hyprland, so the scope rule also keeps the mascot from going stale with each desktop.

An assistant in a developer tool is tempting to build on a model. But AgentUX runs no model itself ([0002](0002-harness-integration-via-acp.md)): inference stays with the vendor CLIs the user signs in to. The cockpit also has to work offline, on the live ISO and on mock data.

## Decision

- **The mascot is the brand's swimming penguin** (the compact mark, in the theme's accent colour; the full mark for the tour's welcome). It sits at the foot of the cockpit's sidebar and of the wizard's rail, with idle, talking, thinking and pointing states drawn as CSS animation that stops under `prefers-reduced-motion`. It speaks up on its own once, to offer the tour. Its menu turns it off, the sidebar turns it back on, and the choice is kept.
- **Scope: AgentUX only.** The cockpit, the wizard, `aux`, agentuxd, agents and harnesses, runs, pipeline steps and `agentux.yaml`, approvals, the agent bus, terminal handoff, worktrees, gate checks, release channels and updates, and `agentux-version`. For the desktop or Linux in general, it says politely that it only knows AgentUX.
- **Three features, all working without a network or a daemon:**
  - **A guided tour** over the real UI (a spotlight and a coach card), offered on the cockpit's first launch or once the wizard closes, and started from the wizard's last step on request. Steps whose element is not on screen are skipped.
  - **What's this?** (`Shift+F1`): click or press Enter on any marked element for its explanation. Clicks do nothing else while the mode is on. Elements opt in with a `data-help` key, and the text is one reviewed file in agentux-desktop (`cockpit/src/helper/content.json`). A test checks that the keys and the entries match.
  - **Ask the penguin** (`F1`): a local search over that help and the AgentUX documentation, bundled into the cockpit at build time (this repository's getting-started guide and ADRs, the agentux-core READMEs and API, the cockpit README and agentux-os's release sections). It answers with the best passages, links to the docs, and Show me when the answer is about something on screen.
- **AI answers are optional, off by default, and use the user's own agent.** agentuxd gets one method, `helper.ask`. It starts a fresh session of the harness the user picks, in a new empty directory, with no MCP servers (no agent bus). It denies every permission request and cancels the turn at the first tool call. It sends one prompt: the daemon's helper rules (the scope rule above, no tools, say "I don't know" rather than guess), then the context from the cockpit, then the question. Nothing is stored, and the session belongs to no run. The cockpit shows which agent answered and says that it runs on the user's account.
- **What the AI helper sees:** the question; the documentation passages that matched it locally (at most 16 KiB); and one paragraph about the screen: the view, the project's name, how many requests are waiting, and the open run's id, title, status, step, gate attempt, review round and error line. Never file contents, diffs, session transcripts, bus messages, prompts of runs, paths beyond the project's name, environment variables or credentials.

## Consequences

- The mascot works the same on a fresh install, the live ISO, mock data and an offline machine. Its answers are only as good as the docs: a question the docs do not cover gets "I couldn't find that". This pushes documentation to be complete, and both the help file and the bundled docs are reviewed text in git.
- The bundled docs are a copy. `scripts/sync-help-docs.mjs` refreshes them from each repository's `main`, and a cockpit release carries the docs of its day. A stale copy can contradict a newer system.
- Turning AI answers on sends the question and the context above to the user's provider and costs what one short prompt costs. The rules forbid tools, the daemon denies permission requests, and it cancels on any tool call. But a harness that runs a tool without asking (because of its own settings) can still run that one call before the cancel lands. The empty working directory and a prompt without files or secrets limit what such a call could see. That residual risk is why the feature is opt-in and says which agent answers.
- Every explainable element carries a `data-help` key, and new UI needs a help entry, which the coverage test enforces.

## Alternatives considered

- **A model shipped with the cockpit, or a hosted AgentUX assistant.** It would contradict 0002: AgentUX would run inference or send data to a service of its own. It would also mean a large download, or a network dependency and a privacy policy.
- **AI answers by default.** They are better phrased, but slow, billed to the user, and unavailable offline or on mock data. Making them the default would make the helper depend on a signed-in agent.
- **Running the helper as a run step or a bus session.** That would give the helper a worktree, tools and the agent bus, which it does not need and should not have, and it would show up in runs and costs.
- **Docs fetched at run time from GitHub or agentuxos.org.** They would always be current but fail offline and on the live ISO, and every question would reach a server.
- **Tooltips and a static help page instead of a mascot.** They are simpler, but give no guided first run and no answers to questions, which is what was asked for.

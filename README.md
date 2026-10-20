<p align="center">
  <a href="https://agentuxos.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/agentux-os/agentux/main/brand/svg/lockup-dark.svg">
      <img alt="AgentUX" src="https://raw.githubusercontent.com/agentux-os/agentux/main/brand/svg/lockup-light.svg" width="340">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/agentux-os/agentux-desktop/releases/latest"><img alt="RPM downloads" src="https://img.shields.io/github/downloads/agentux-os/agentux-desktop/total?label=RPM%20downloads&logo=linux&labelColor=0b0d10&color=c6f36b"></a>
  <a href="https://github.com/agentux-os/agentux-desktop/releases/latest"><img alt="Latest desktop release" src="https://img.shields.io/github/v/release/agentux-os/agentux-desktop?include_prereleases&label=latest%20desktop&labelColor=0b0d10&color=4f7d0b"></a>
</p>

<h3 align="center">agentux-desktop: the AgentUX cockpit and the desktop it lives in</h3>

<p align="center">
  <a href="https://github.com/agentux-os/agentux-desktop/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/agentux-os/agentux-desktop/ci.yml?branch=main&label=ci&logo=github&labelColor=0b0d10"></a>
  <a href="https://github.com/agentux-os/agentux-desktop/actions/workflows/release.yml"><img alt="RPM release" src="https://img.shields.io/github/actions/workflow/status/agentux-os/agentux-desktop/release.yml?label=rpm%20build&logo=fedora&logoColor=white&labelColor=0b0d10"></a>
  <a href="https://github.com/agentux-os/agentux-desktop/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/agentux-os/agentux-desktop?include_prereleases&label=release&labelColor=0b0d10&color=4f7d0b"></a>
  <a href="https://v2.tauri.app"><img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-4f7d0b?logo=tauri&logoColor=white&labelColor=0b0d10"></a>
  <a href="#desktop-configuration"><img alt="KDE Plasma 6" src="https://img.shields.io/badge/KDE%20Plasma-6-4f7d0b?logo=kde&logoColor=white&labelColor=0b0d10"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/agentux-os/agentux-desktop?labelColor=0b0d10&color=4f7d0b"></a>
  <a href="https://agentuxos.org"><img alt="Website" src="https://img.shields.io/badge/website-agentuxos.org-c6f36b?labelColor=0b0d10"></a>
</p>

<p align="center">
  <a href="https://agentuxos.org"><b>Website</b></a> ·
  <a href="https://download.agentuxos.org"><b>Download</b></a> ·
  <a href="https://github.com/agentux-os/agentux/tree/main/docs"><b>Docs</b></a> ·
  <a href="https://github.com/agentux-os/agentux/blob/main/docs/getting-started.md"><b>Getting started</b></a> ·
  <a href="https://github.com/agentux-os/agentux-desktop/releases"><b>Releases</b></a>
</p>

The desktop experience of [AgentUX](https://github.com/agentux-os/agentux): the cockpit app and the desktop configuration shipped with the distribution.

<p align="center">
  <a href="https://raw.githubusercontent.com/agentux-os/agentux/main/docs/screenshots/cockpit-plan-approval.png"><img alt="The AgentUX cockpit on the live ISO: two demo runs, one waiting for plan approval" src="https://raw.githubusercontent.com/agentux-os/agentux/main/docs/screenshots/cockpit-plan-approval.png" width="760"></a>
</p>

> **Status:** the cockpit connects to `agentuxd` ([agentux-core](https://github.com/agentux-os/agentux-core)) when it is running and falls back to mock data otherwise. Runs, sessions, approvals (questions from agents included), the agent bus and terminal mode (a session's harness TUI, or a shell in a run's worktree) come from the daemon. Design decisions live in [agentux/docs/adr](https://github.com/agentux-os/agentux/tree/main/docs/adr).

## Releases and packages

Every `v*` release builds and verifies the cockpit RPMs for `x86_64` and `aarch64`, plus the architecture-independent Plasma overlay tarball. The artifacts are attached automatically to the newest release, so this README never needs a version edit.

- [Latest release and RPMs](https://github.com/agentux-os/agentux-desktop/releases/latest)
- [Release workflow](https://github.com/agentux-os/agentux-desktop/actions/workflows/release.yml)

## At a glance

This repository holds two things, and the [AgentUX image](https://github.com/agentux-os/agentux-os) ships both:

- **The cockpit** (`agentux-cockpit`, in [`cockpit/`](cockpit)): one desktop window over every coding agent CLI. Runs move across a board, sessions from Claude Code, Codex, OpenCode and Antigravity look the same, every approval lands in one inbox, and the agent bus shows agents talking to each other. Any session opens in its vendor's own TUI with one key. It talks only to `agentuxd` from [agentux-core](https://github.com/agentux-os/agentux-core). On AgentUX it starts at login; **Super+C** (Meta+C) brings it up, on Plasma and COSMIC.
- **The Plasma overlay** (in [`plasma/`](plasma)): the AgentUX look for KDE Plasma 6, as system-wide defaults: global theme, wallpaper, login and lock screens, login splash, panel, shortcuts and cockpit autostart. Every user can override all of it in System Settings.

See the cockpit in a minute, no Rust and no daemon needed (it plays scripted runs from a mock daemon):

```sh
cd cockpit
npm install
npm run dev    # open http://localhost:1420
```

The native window and a real daemon: [Developing the cockpit](#developing-the-cockpit). The overlay, file by file: [Desktop configuration](#desktop-configuration).

## Contents

- **Cockpit:** [Features](#cockpit) · [Help mascot](#help-mascot) · [Welcome wizard](#welcome-wizard) · [Developing the cockpit](#developing-the-cockpit) · [Running against a real daemon](#running-against-a-real-daemon) · [Layout of the code](#layout-of-the-code) · [Keyboard](#keyboard) · [Packaging](#packaging) · [Single instance and window identity](#single-instance-and-window-identity) · [WebKitGTK caveats](#webkitgtk-caveats) · [Not there yet](#not-there-yet)
- **Desktop:** [Desktop configuration](#desktop-configuration) · [Image bundle contract](#image-bundle-contract) · [Not verified on a running Plasma session](#not-verified-on-a-running-plasma-session)
- [Relevant ADRs](#relevant-adrs) · [License](#license)

## Cockpit

One interface on top of every coding agent CLI (Tauri app, talks only to `agentuxd`):

- **Session view.** Messages, tool calls, diffs, plans and permission requests rendered the same way whatever the vendor. The harness's own TUI opens in an embedded terminal on the same session, without restarting it.
- **Run board.** Per project: planned, implementing, testing, in review, waiting for you, done.
- **Approvals inbox.** Every permission request and escalation from every agent in one queue, with one shortcut to approve.
- **Agent bus feed.** Messages, review requests and handoffs between agents, grouped by exchange with their turn count; questions to you and your answers; turn limits and denied tools as warnings; wakes and sessions joining or leaving as quiet system lines.
- **Spend.** Tokens and cost per run, project and vendor.
- **Welcome to AgentUX.** A first-run wizard in its own window (see below).
- **The penguin helper.** A help mascot in the sidebar's corner: a guided tour on first use, **What's this?** for any element, and **Ask the penguin** for questions about AgentUX (see [Help mascot](#help-mascot)).

## Help mascot

The brand's swimming penguin sits at the foot of the cockpit's sidebar (and of the wizard's rail), in the theme's accent colour, with a small idle, talking, thinking and pointing animation that stops under `prefers-reduced-motion`. It knows AgentUX only: the cockpit, the wizard, `aux`, agentuxd, runs, pipelines, approvals, the agent bus, terminal mode, worktrees, gates, release channels and `agentux-version`. For the desktop itself (COSMIC, Plasma) or Linux in general it says so. Decisions and privacy: [ADR 0017](https://github.com/agentux-os/agentux/blob/main/docs/adr/0017-help-mascot.md).

- **Guided tour.** Offered once, by a speech bubble next to the penguin, on the cockpit's first launch, or as soon as the Welcome wizard closes (the bubble waits while the wizard is open). The wizard's Done step has **Take the tour with the penguin**, which finishes the wizard and starts the tour in the cockpit. It is a spotlight over the real UI: run board, Waiting for you, approvals, agent bus, New run, projects, terminal handoff (it opens a run for that step), the daemon connection in the status bar, and theme. Next, Back and Skip, arrow keys and Escape, focus kept in the card and announced to screen readers; steps whose element is not on screen are skipped. Restart it from the penguin's menu. It works on mock data and with `--fake-agents`.
- **What's this?** `Shift+F1` or the `?` next to the penguin. Pointing outlines explainable elements, clicking one (or `Enter` on it; `Tab` reaches every one while the mode is on) opens the penguin's explanation next to it: what it is, how it works, what you can do and a **Learn more** link. Clicks do nothing else while the mode is on, so nothing is approved or started by accident; `Escape` closes the explanation, then the mode. Elements opt in with `{...help("key")}` (`data-help="key"`), and the text lives in [`cockpit/src/helper/content.json`](cockpit/src/helper/content.json): 83 entries covering the cockpit and the wizard. A vitest test checks that every key in the UI has an entry and every entry is used.
- **Ask the penguin.** `F1`. Answers offline: a small BM25 search over the help entries and the AgentUX docs bundled at build time (getting started, the `aux` and daemon READMEs, the agentuxd API, this README's cockpit part, the release-channel and version sections of agentux-os, and the ADRs), shown as the best passages with **Read more** links, and **Show me** when a passage is about something on screen. `node cockpit/scripts/sync-help-docs.mjs` refreshes the bundled copies (`cockpit/src/helper/docs/`) from each repository's `origin/main`.
- **Ask my agent (optional, off by default).** With agentux-core 0.4.3 or later, the user can let one of their own agent CLIs answer too. The cockpit calls agentuxd's `helper.ask`: a fresh session of that harness, in an empty directory, with no tools, no files and no agent bus. It sends the question, the matching docs passages and a one-line summary of the view (the view, the project, the open run's title, status and step), never file contents, transcripts or secrets. The answer shows which agent wrote it, on the user's own account. Unavailable on mock data and on older daemons, with the reason shown.
- **Settings.** The penguin's menu turns it off (What's this? and Ask go with it); **Penguin helper** in the sidebar turns it back on. The choice, the tour state and the AI setting are kept in the window's local storage, shared with the wizard.

## Welcome wizard

On a user's first login the cockpit opens **Welcome to AgentUX** (`agentux-cockpit --welcome`), after `plasma-setup` has created the account and Plasma has started. It is skippable, keyboard driven (`Alt+←`/`Alt+→` between steps, `/` to search, `Space` to tick) and can be reopened any time from the app menu (**Welcome to AgentUX**), the cockpit's sidebar (**Welcome & setup**) or `agentux-cockpit --welcome`. Four steps:

1. **Agents.** The status of the agent CLIs that agentux-os's first-login service installs (Claude Code, OpenCode, Antigravity, Codex: installing, installed, failed with a retry), a **Sign in** button per CLI that opens a terminal with its own login (`claude`, `codex login`, `opencode auth login`, `agy`), and how to keep an API key in the desktop's secret service with `secret-tool`. Inference stays with the providers.
2. **Tools & SDKs.** One searchable catalog with categories (editors and IDEs, languages and SDKs, cloud and Kubernetes, databases, API clients, Git, containers, browsers, design, communication, utilities). Each item installs one of four ways, shown as a small hint: a **Flatpak** from Flathub (per user), the **JetBrains Toolbox** App (JetBrains IDEs, unsandboxed, in `~/.local/share/JetBrains/Toolbox`), **mise** (languages and CLIs, `mise use --global`) or **Distrobox** (a Fedora or Ubuntu dev container, and packages in it). Installs run in the background and keep going when the window closes; each item shows its progress, its error and a retry, and the commands it runs.
3. **Git & SSH.** Name, e-mail and default branch for `~/.gitconfig`; an ed25519 key with a button to GitHub's SSH keys page and `gh auth login`.
4. **Done.** A summary, the JetBrains IDEs left to install from Toolbox, links to agentuxos.org and the getting-started guide, and **Open the cockpit**.

**VS Code** (and VSCodium) come from Flathub with host integration: `flatpak override --user --talk-name=org.freedesktop.Flatpak --filesystem=home`, a default `settings.json` whose integrated terminal is `flatpak-spawn --host bash -l` (so mise SDKs, podman and the agent CLIs work in it; keys you set yourself win), `dev.containers.dockerPath` pointing at a small wrapper that runs the host's podman, and the `org.freedesktop.Sdk.Extension.*` matching your mise SDKs (`openjdk21`, `node24`, `golang`, `rust-stable`, `dotnet10`, ...) enabled with `FLATPAK_ENABLE_SDK_EXT` for the language extensions that run inside the sandbox. JetBrains IDEs never come as Flatpaks. The reasons are in [ADR 0013](https://github.com/agentux-os/agentux/blob/main/docs/adr/0013-first-run-wizard.md).

How it is built:

- **The backend is one script**, [`plasma/usr/libexec/agentux-setup`](plasma/usr/libexec/agentux-setup), shipped in the Plasma overlay. The wizard calls it through a single Tauri command (`setup_exec`, with an allowlist of subcommands); `agentux-setup --help` lists them. `start` runs a batch in a transient systemd user unit (`systemd-run --user`), one batch at a time; item states and logs go to `~/.local/state/agentux/setup/`. `plan` (or `install --dry-run`) prints the commands a batch would run without changing anything.
- **The catalog is data**, [`plasma/usr/share/agentux/setup/catalog.json`](plasma/usr/share/agentux/setup/catalog.json), read by the script at run time and bundled into the cockpit. Adding an app is adding an entry. The Flathub remote is added per user from the shipped [`flathub.flatpakrepo`](plasma/usr/share/agentux/setup/flathub.flatpakrepo), so it needs no download.
- **First run:** `/etc/xdg/autostart/agentux-welcome.desktop` runs `agentux-setup autostart`, which opens the wizard unless the user is a system account (`plasma-setup`'s session), the system is the live ISO (`/usr/share/agentux/live/marker` or `rd.live.image`), or `~/.local/state/agentux/welcome.done` exists. Finishing or skipping writes that marker; `agentux-setup reset` removes it.
- **Without a system:** `npm run dev` and open `http://localhost:1420/?view=welcome` for the wizard on a mock backend (`&speed=3` to hurry it, `&fail=dbeaver,first-login` to see failures).
- **Tests:** vitest checks the catalog (ids, categories, mise tool names, Flatpak id shapes, SDK extensions; `CHECK_FLATHUB=1 npm test` also asks Flathub's API about every Flatpak and its architectures), the command builder, that `agentux-setup plan` prints exactly what the UI shows for every item (where bash and jq exist), and the wizard flow on the mock backend. `plasma/check.sh` checks the script's dry run, the VS Code settings merge, `status` and the first-run marker.

## Developing the cockpit

The cockpit lives in [`cockpit/`](cockpit): a [Tauri 2](https://v2.tauri.app) app with a React + TypeScript + Vite frontend (ADR 0006). Inside the Tauri window it talks to the real `agentuxd`; in a plain browser, or when no daemon is running, it uses a mock daemon that plays realistic runs through the pipeline: several projects, sessions from Claude Code, Codex, OpenCode and Antigravity, permission requests, cross-vendor review over the agent bus, and token spend per vendor.

**Requirements:** Node.js 20+ and npm. For the desktop window you also need Rust (stable) and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) (on Fedora: `webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel`, plus the `C Development Tools and Libraries` group).

```sh
cd cockpit
npm install

npm run dev         # browser-only mock mode at http://localhost:1420 (no Rust needed)
npm run tauri dev   # the same UI in the native Tauri window
npm run typecheck   # tsc
npm test            # vitest: daemon adapter and client
npm run build       # typecheck + production bundle in dist/
```

Append `?speed=3` to the dev URL to make the mock runs move faster, or `?daemon=mock` to force mock data inside Tauri.

### Running against a real daemon

The Tauri backend connects to `agentuxd` over its Unix socket, `$AGENTUX_SOCKET` or else `$XDG_RUNTIME_DIR/agentux/agentuxd.sock` (the same rule `aux` uses). For a demo without real agents, start the daemon with scripted fake agents from an [agentux-core](https://github.com/agentux-os/agentux-core) checkout:

```sh
# terminal 1: the daemon (fake agents answer every agent step; gates run real commands)
cd agentux-core
cargo run -p aux-cli --bin aux -- daemon --fake-agents

# terminal 2: the cockpit window
cd agentux-desktop/cockpit
npm run tauri dev
```

Then click **New run** (or press `N`), enter a directory inside any git repository and a prompt. The run moves across the board, and the plan approval shows up in the approvals inbox (`A` to approve, `D` to deny); the open run's panel has **Cancel run**. `aux ps`, `aux approve <id>` and friends act on the same daemon, and the cockpit follows along.

<details>
<summary>How the connection behaves: probing, the event stream, reconnects, bus and terminals</summary>

How the connection behaves:

- At startup the frontend probes the daemon. If it answers, the cockpit uses `TauriDaemonClient`; if not, it shows mock data with a **Mock data** badge and a "agentuxd is not running" banner, and reloads by itself once the daemon is up.
- The backend keeps one `events.subscribe` stream open and forwards each event to the UI (`daemon://event`). When the daemon stops it reports the disconnect, retries with exponential backoff (0.5 s up to 15 s) and resubscribes from the last `seq` it saw, so nothing is lost while the daemon restarts. On daemons that mark the end of a replay (`replay_done`, agentux-core #9) the stream reports itself connected once the replayed events are forwarded; the UI reloads the project/run/request lists on every reconnect.
- Opening a run loads its stored events (session timelines) and its agent-bus log (`bus.list`); the bus page and the board's rail load the log of the most recent runs the same way. The run's history is read with `runs.events` in pages and continued with `events.subscribe { runId, since: headSeq }` up to its `replay_done`; daemons without `runs.events` (-32601) fall back to replaying a subscription, ended by the marker or, on the oldest daemons, by a short pause. Live `bus_message` events keep them current, merged by id. Questions agents ask through `ask_human` land in the approvals inbox: pick a suggested answer (buttons, or `1`–`9`), type one, or decline. See the mapping notes in `cockpit/src/daemon/tauri/mapping.ts`.
- Optional daemon methods (`sessions.prompt`, `bus.post`, `terminals.*`) are probed after each load. The session composer (`sessions.prompt`) puts your message in the session as your own bubble; the bus composer, on the bus page and in a run's **Bus** tab, posts as you (`bus.post`) to a role, one session or the whole run, or answers a message (**Reply**, `inReplyTo`). Each stays disabled, with the reason shown, on daemons that do not serve its method and on finished runs.
- **Terminal mode** (agentux-core #11). The session view's **Structured / Terminal** toggle (`T`) opens the session in its harness's own TUI (`terminals.open`, `command: harness-tui`) on a PTY the daemon manages, rendered with xterm.js, sized to the panel and themed from the cockpit's colours. While the session's turn is in progress the terminal waits (shown as such; input is dropped); then the daemon hands the session over and its badge shows **attached** (turns for it queue until the TUI exits). When the daemon cannot resume the session in a TUI it runs a shell instead, and the reason is shown as a banner. **Shell in worktree** on an active run opens a shell in the run's worktree in a **Shell** tab. While the terminal has the keyboard, the cockpit's shortcuts are off (Escape too, the TUI uses it); `Shift+Esc` or `Ctrl+]` gives the keyboard back.
  The daemon ties a terminal to the connection that opened it, so the backend gives each terminal its own socket connection (`src-tauri/src/daemon/terminal.rs`) and emits its output as `terminal://<stream>` events, a name the UI listens on before opening. Input and resizes go as JSON-RPC notifications on that connection. A view that is rebuilt while its terminal runs re-attaches (`terminals.attach`: scrollback, then live output) instead of opening another. Leaving terminal mode closes the run's TUIs (the sessions go back to ACP), closing the shell tab closes the shell, closing the run panel closes all of the run's terminals, and a closed or reloaded window drops every terminal connection. In mock mode the terminal is a fake echo shell that behaves the same way (waiting, attached, Antigravity's fallback).

</details>

### Layout of the code

| Path | What it is |
|---|---|
| `cockpit/src/daemon/types.ts` | Domain model: projects, runs, steps, sessions, vendor-neutral session events, permission requests, bus messages, spend |
| `cockpit/src/daemon/client.ts` | The `DaemonClient` interface the UI depends on, and `createDaemonClient()` |
| `cockpit/src/daemon/tauri/` | `TauriDaemonClient` (real daemon via the Tauri backend), API wire types, and the API-to-cockpit mapping |
| `cockpit/src/daemon/mock/` | `MockDaemonClient` plus the scripted scenarios it plays |
| `cockpit/src/setup/` | The welcome wizard's backend interface: catalog types, the command builder, `TauriSetupClient` (runs `agentux-setup`) and `MockSetupClient` |
| `cockpit/src/welcome/` | The welcome wizard's steps |
| `cockpit/src/components/` | Run board, session view, approvals inbox, agent bus feed, status bar |
| `cockpit/src/helper/` | The penguin helper: help content, tour, What's this?, Ask (offline search and `helper.ask`), and the bundled docs |
| `cockpit/src-tauri/` | Rust shell: hosts the window; `src/daemon/` is the socket client, the reconnecting event stream and the `daemon_*` commands; `src/setup.rs` is the welcome window, `--welcome` and `setup_exec` |

Components only talk to the `DaemonClient` interface; `createDaemonClient()` picks the implementation.

### Keyboard

`B` / `I` / `M` switch between run board, approvals inbox and agent bus. `A` approves the focused request (the inbox selection or the open run's pending request), `D` denies, `1`–`9` answers an agent's question, `J`/`K` move through the inbox, `T` toggles terminal mode (`Shift+Esc` or `Ctrl+]` leaves the terminal), `N` starts a new run (with a daemon), `[`/`]` cycle projects, `?` lists everything. `F1` asks the penguin, `Shift+F1` toggles What's this?

### Packaging

`.github/workflows/release.yml` builds the cockpit as an RPM (`agentux-cockpit`, binary `/usr/bin/agentux-cockpit`, desktop entry "AgentUX Cockpit" under Development) inside a `fedora:44` container, so it links against the same WebKitGTK the AgentUX image ships. It builds for both x86_64 and aarch64, each natively on GitHub's x86_64 and arm64 runners, and installs each RPM in a fresh container of its architecture to check that the binary's libraries resolve. Pushing a `v*` tag matching the version in `tauri.conf.json` attaches both RPMs to a GitHub release; running the workflow manually uploads them as artifacts. To install one on Fedora 44, pick the file for your architecture:

```sh
sudo dnf install ./agentux-cockpit-<version>-1.$(uname -m).rpm
```

The Plasma overlay tarball below is architecture-independent and built once. Rust dependencies are pinned by the committed `Cargo.lock` (CI builds with `--locked`).

### Single instance and window identity

The cockpit runs once per user session. Meta+C, the login autostart and the launcher all run `agentux-cockpit`; when one is already running, the new process hands over to it through [`tauri-plugin-single-instance`](https://v2.tauri.app/plugin/single-instance/) (a D-Bus name `os.agentux.cockpit.SingleInstance` on the session bus) and exits. The running cockpit then unminimizes, shows and focuses its `main` window.

On Wayland the window's `app_id` is `agentux-cockpit`: Tauri leaves `app.enableGTKAppId` off, so GTK uses the program name (the basename of `argv[0]`, i.e. the binary `/usr/bin/agentux-cockpit`). That matches the installed `/usr/share/applications/agentux-cockpit.desktop`, which is how KDE picks the task manager entry and icon. Keep `enableGTKAppId` off: turning it on would make the `app_id` `os.agentux.cockpit` (no such desktop file) and register a `GApplication` with that id. The desktop entries also set `StartupWMClass=agentux-cockpit` for X11/XWayland sessions.

Focus on KDE Wayland is up to KWin. Raising a window there needs an [xdg-activation](https://wayland.app/protocols/xdg-activation-v1) token; Plasma hands one to the process it launches (`XDG_ACTIVATION_TOKEN`), but that is the short-lived second process, and the plugin forwards only its arguments and working directory, not the token. So the running window can only ask for focus without the launcher's token, and KWin's focus stealing prevention may answer by marking it as demanding attention (highlighted in the task manager) instead of raising it, and may leave a minimized window minimized. Not yet tested on a Plasma 6 session.

### WebKitGTK caveats

On Linux, Tauri renders with the system WebKitGTK (`webkit2gtk4.1`), not Chromium, so behaviour and GPU quirks are WebKitGTK's. If the window is blank, flickers or crashes on start (seen mostly with the NVIDIA proprietary driver and some virtual GPUs), try:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 agentux-cockpit      # disable the DMA-BUF renderer (most common fix)
WEBKIT_DISABLE_COMPOSITING_MODE=1 agentux-cockpit     # last resort: no accelerated compositing
```

The desktop entry sets neither, since both cost performance on GPUs that work; to make one permanent for a user, put it in `~/.config/environment.d/`.

### Not there yet

- Terminal mode needs agentux-core with `terminals.*` (#11); with older daemons the toggle stays disabled. A terminal does not survive a reload of the window.
- The daemon is reached over a Unix socket only, so on Windows the Tauri build always shows mock data.
- Prices in the mock are illustrative.

## Desktop configuration

KDE Plasma 6 (Wayland) defaults for the AgentUX image live in [`plasma/`](plasma), laid out as a filesystem overlay: `plasma/usr/...` lands in `/usr`, `plasma/etc/...` in `/etc`. Desktop-neutral AgentUX integration lives in [`common/`](common), while COSMIC-specific settings live in [`cosmic/`](cosmic). They are system-wide defaults only. Nothing is written to any home directory or `/etc/skel`; each user's own settings override every key, and System Settings can change or reset all of it.

| Bundle path | What it does |
|---|---|
| `usr/share/plasma/look-and-feel/os.agentux.desktop/` | **AgentUX global theme.** `contents/defaults` sets Breeze Dark (colour scheme, icons, Plasma style, window decoration, cursors) and this package's own login splash. `contents/splash/Splash.qml` is that splash (KSplash, shown while Plasma starts after login): the AgentUX penguin swimming in place on Ink (it bobs and pitches, its flipper strokes, the water of its wake streams back and bubbles rise from its back), the wordmark below it and a Lime progress water line. It continues the agentux-os Plymouth boot splash as one scene: the same images (copied unchanged from agentux-os `files/usr/share/plymouth/themes/agentux/`), layout and motion, with `agentux.script`'s constants and its `swim()` carried over. `contents/layouts/org.kde.plasma.desktop-layout.js` builds the first desktop: the AgentUX wallpaper and a bottom panel with Kickoff, a task manager pinning AgentUX Cockpit, Konsole and the default browser, the system tray, the clock and Show Desktop |
| `usr/share/wallpapers/AgentUX/` | Wallpaper package: the AgentUX mark, a penguin swimming through faint water currents. `contents/images_dark/` (the default, since the global theme is Breeze Dark) and `contents/images/` (light colour schemes) hold PNGs at 3840x2160, 2560x1600 (a centred 16:10 crop of the art) and 1920x1080; Plasma picks the variant that matches the colour scheme and the size closest to the screen. Rendered from the key art in [agentux `brand/art/`](https://github.com/agentux-os/agentux/tree/main/brand) |
| `etc/xdg/kdeglobals` | Selects the global theme (`LookAndFeelPackage=os.agentux.desktop`) and the cockpit's accent colour `#c6f36b` (`AccentColor=198,243,107`) |
| `etc/xdg/ksplashrc` | Selects the AgentUX login splash (`[KSplash] Theme=os.agentux.desktop`), as the global theme's defaults do; System Settings > Splash Screen still overrides it. Without it Plasma falls back to the Breeze splash, the Plasma logo |
| `etc/xdg/kscreenlockerrc` | Uses the AgentUX wallpaper on the lock screen |
| `usr/lib/plasmalogin/plasmalogin.conf.d/50-agentux.conf` | Uses the AgentUX wallpaper on the login screen (Plasma Login, Fedora 44's display manager). Plasma Login reads `/etc/plasmalogin.conf.d/*`, then Fedora's `/usr/lib/plasmalogin/defaults.conf` (Fedora wallpaper), then this directory, then `/etc/plasmalogin.conf`, later files winning; so this beats Fedora's default and System Settings > Login Screen still beats this. The greeter takes its colours from the global theme in `/etc/xdg/kdeglobals` |
| `etc/xdg/kded5rc` | Turns off the kded module `kded_plasma_welcome`, which opens Fedora's Welcome Center ("Welcome to Fedora!") on first login and after Plasma feature upgrades. It has no XDG autostart entry to hide; KF6's kded still reads `kded5rc`. The app stays installed, and users can turn the module back on in System Settings > Background Services. AgentUX's own first run belongs in the cockpit |
| `usr/share/kglobalaccel/agentux-*-shortcut.desktop` | Global shortcuts: **Meta+C** launches the cockpit, **Meta+Return** opens Konsole (Konsole's own Ctrl+Alt+T stays) |
| `common/etc/xdg/autostart/agentux-cockpit.desktop` | Starts the cockpit at login (`TryExec`, so it does nothing if the cockpit isn't installed). Users turn it off in System Settings > Autostart |
| `common/etc/xdg/autostart/agentux-welcome.desktop` | Opens the [welcome wizard](#welcome-wizard) on a user's first login through `agentux-setup autostart` (not for system users, not on the live ISO, not once finished or skipped) |
| `common/usr/share/applications/agentux-welcome.desktop` | **Welcome to AgentUX** in the app menu: reopens the wizard |
| `common/usr/libexec/agentux-setup` | The wizard's backend: plans and runs installs (Flatpak, JetBrains Toolbox, mise, Distrobox) in transient user units, reports status as JSON, sets up Git and SSH, opens sign-in terminals |
| `common/usr/share/agentux/setup/` | The wizard's catalog (`catalog.json`) and Flathub's repo file |
| `common/usr/libexec/agentux-cockpit-autostart` | What the autostart entry runs: exits for system accounts (UID below `UID_MIN` from `/etc/login.defs`, the same rule as systemd's `ConditionUser=!@system`), otherwise execs `agentux-cockpit`. Fedora's first-boot wizard runs a whole Plasma session as the `plasma-setup` system user (UID 968), and XDG autostart, including ours, runs there too. A wrapper rather than a systemd drop-in for `app-agentux-cockpit@autostart.service` because it also covers Plasma's own autostart when systemd startup is off |

How it takes effect: on login, `startplasma` reads `LookAndFeelPackage` from `kdeglobals`, writes that global theme's defaults into `~/.config/kdedefaults` (a defaults layer, not user settings) and applies the colour scheme with the accent colour. plasmashell runs the theme's layout script only when the user has no desktop layout yet, so existing users keep their panels. On Fedora Kinoite `/etc/xdg` comes before Fedora's own defaults in `/usr/share/kde-settings/kde-profile/default/xdg` in `XDG_CONFIG_DIRS`, so these keys win over Fedora's.

**KWin tiling: not included.** Plasma 6 stores custom tile layouts in `kwinrc` under `[Tiling][<virtual desktop id>][<output uuid>]`, and both ids are created per user and per monitor, so a system-wide default layout can't be written ahead of time. The built-in tiling needs no configuration: drag a window with Shift held, or edit tiles with Meta+T.

**COSMIC** defaults live in [`cosmic/`](cosmic), the same kind of overlay:

| Bundle path | What it does |
|---|---|
| `usr/share/backgrounds/agentux/` | The AgentUX wallpaper, dark and light, at 3840x2160 (the Plasma package's images). COSMIC Settings lists both under Wallpaper |
| `usr/share/cosmic/com.system76.CosmicBackground/v1/all` | Makes the dark wallpaper cosmic-bg's default, on the desktop and the lock screen |
| `usr/share/cosmic/com.system76.CosmicAppList/v1/favorites` | Pins AgentUX Cockpit, COSMIC Terminal and Firefox first in the dock, then COSMIC's own defaults |
| `usr/share/cosmic/com.system76.CosmicSettings.Shortcuts/v1/custom` | **Super+C** opens the cockpit, **Super+Return** a terminal. COSMIC's Super+A (App Library) and Super+T (terminal) stay |
| `usr/share/cosmic/com.system76.CosmicSettings/v1/accent_palette_{dark,light}.ron` | The accent colours offered in COSMIC Settings: AgentUX Lime and Moss first |
| `usr/share/cosmic/com.system76.CosmicTheme.{Dark,Light}.Builder/v2/accent` | The active accent: Lime `#c6f36b` in the dark theme, the light palette's darker green in the light one |
| `usr/share/cosmic/com.system76.CosmicTheme.{Dark,Light}/v2/*` | The computed dark and light themes with the AgentUX accent (buttons, focus rings, selection), generated from the builders by [`tools/cosmic-theme/theme.sh`](tools/cosmic-theme/theme.sh) with libcosmic's own code: COSMIC's desktop reads these, not the builder, which is only what COSMIC Settings edits |

COSMIC reads a component's system defaults from the first data directory that has it, not key by key, so AgentUX's files replace the ones Fedora's COSMIC packages install for those components. CI lists every replaced file (cosmic-bg's background, cosmic-applets' dock favourites; the generated theme keys are vouched for separately) and fails when a new one appears or a listed one stops being packaged. Users' own settings override all of it, as on Plasma. The generated themes are checked in CI too: `theme.sh` builds both themes from Fedora 44's cosmic-settings defaults with the overlay on top, and the overlay must ship exactly that whole theme (Fedora's own COSMIC 1.10 theme defaults do not match its code, so COSMIC loads them only key by key with errors; a whole built theme loads cleanly). The generator is pinned to the libcosmic revision of Fedora's COSMIC release (1.10, whose themes use the `v2` schema), and CI fails when Fedora's cosmic-settings moves to another release, so the themes are regenerated with it.

**The login screen before the first login is not covered.** cosmic-greeter draws each user's last wallpaper, from their cosmic-bg state. A user who has never logged in has none, and cosmic-greeter falls back to an image compiled into it, which no setting replaces. From the second login on, it shows the AgentUX wallpaper.

<details>
<summary>What <code>plasma/check.sh</code> and CI check</summary>

**Check:** `plasma/check.sh` validates Plasma desktop entries, metadata, assets, wallpaper variants, splash/QML, and references to files owned by the Plasma overlay. `common/check.sh` separately validates shared launchers, executable setup scripts, the setup catalog, Flathub metadata, and the neutral install paths. CI runs each bundle validator and checks that the Plasma overlay does not replace a Fedora-owned file.

</details>

### Image bundle contract

The immutable bootc image is the deployment and rollback unit. The release workflow publishes three architecture-independent, reproducible archives, each containing only `usr/` and `etc/` and each accompanied by a SHA-256 sidecar:

- `agentux-desktop-common-<version>.tar.gz` — shared AgentUX launchers, setup backend, catalog, and generic integration.
- `agentux-desktop-plasma-<version>.tar.gz` — Plasma defaults and integration.
- `agentux-desktop-cosmic-<version>.tar.gz` — COSMIC defaults: wallpaper, dock, shortcuts and the AgentUX Lime accent.

The image verifies all pinned checksums, extracts `common` first, then exactly one desktop bundle. The Plasma image uses the Plasma bundle. The COSMIC image uses the COSMIC bundle and must not receive Plasma settings. The architecture-specific application package remains `agentux-cockpit`; overlays are build inputs baked into the image, not separately layered runtime RPMs.

`workflow_dispatch` uploads the same six archive/checksum files as workflow artifacts for verification and does not create a GitHub Release. Tag pushes attach the RPMs and all six bundle assets to the versioned release.

### Not verified on a running Plasma session

These files follow the Plasma 6 sources (plasma-workspace `startplasma`, `KLookAndFeelManager`, `shellcorona`, kglobalacceld) and the layout of shipping downstreams such as Aurora, but none of it has been booted yet. To check in a VM with a fresh user:

- the panel, pinned launchers and wallpaper appear on first login, and the accent colour shows up (selection, focus rings);
- Meta+C and Meta+Return appear in System Settings > Keyboard > Shortcuts and work, with no conflict with other default shortcuts;
- the cockpit starts at login and appears in System Settings > Autostart;
- the AgentUX splash, not the Plasma logo, shows between the login screen and the desktop, and it lines up with the Plymouth boot splash;
- the dark wallpaper variant (`images_dark/`) is used on the desktop, lock screen and login screen with Breeze Dark, and the light one after switching to a light colour scheme.

Known limits:

- **Meta+C on a running cockpit brings its window forward instead of opening a second one** (the cockpit is single-instance, see [Single instance and window identity](#single-instance-and-window-identity)). Whether KWin actually raises and focuses it, rather than only marking it as demanding attention, has not been checked on Plasma 6 Wayland.
- **First-boot wizard (`plasma-setup`) branding: only partly themed, and the rest can't be from this overlay.** It runs on the first boot of a bootc disk image even when a user already exists (it then skips account creation). Its background is AgentUX art, but not thanks to this overlay: a Fedora patch makes the wizard load `wallpapers/Default/contents/images{,_dark}/<size>.jxl`, `Default` is a symlink owned by Fedora's background packages, and replacing package-owned files from the overlay is off limits (CI checks it). The agentux-os image does it instead ([agentux-os#17](https://github.com/agentux-os/agentux-os/pull/17)): it renders an `AgentUX-Default` wallpaper package and points `Default` at it (see its README's "Default wallpaper" section). What remains: the landing page hard-codes "Welcome to Plasma Desktop", and prints "Powered by <NAME>" from `os-release`. Changing that line means changing `NAME` in the image's `/usr/lib/os-release`, an agentux-os decision with wider effects (tools that match on the distro name). The heading needs a patched `plasma-setup`, as Aurora does.
- If `plasma-setup` creates the account and the user flips its light/dark switch, it applies Fedora's `org.fedoraproject.fedora(dark).desktop` global theme (a Fedora patch) and copies the wizard's `kdeglobals` into the new home, so that user starts on Fedora's theme (and its Breeze splash) instead of AgentUX's. Left alone, the switch changes nothing (it starts on "dark" because our colour scheme is Breeze Dark). Same fix as above: a patched `plasma-setup`.
- Login screen: only the wallpaper is ours. Plasma Login shows no distribution logo.

## Relevant ADRs

- [0001 — Linux distribution on Fedora Atomic](https://github.com/agentux-os/agentux/blob/main/docs/adr/0001-linux-distribution-on-fedora-atomic.md)
- [0004 — Unified interface and agent bus](https://github.com/agentux-os/agentux/blob/main/docs/adr/0004-unified-interface-and-agent-bus.md)

## License

[Apache 2.0](LICENSE)

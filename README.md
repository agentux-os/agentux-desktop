# agentux-desktop

The desktop experience of [AgentUX](https://github.com/agentux-os/agentux): the cockpit app and the desktop configuration shipped with the distribution.

> **Status:** the cockpit connects to `agentuxd` ([agentux-core](https://github.com/agentux-os/agentux-core)) when it is running and falls back to mock data otherwise. Runs, sessions, approvals (questions from agents included), the agent bus and terminal mode (a session's harness TUI, or a shell in a run's worktree) come from the daemon. Design decisions live in [agentux/docs/adr](https://github.com/agentux-os/agentux/tree/main/docs/adr).

## Cockpit

One interface on top of every coding agent CLI (Tauri app, talks only to `agentuxd`):

- **Session view.** Messages, tool calls, diffs, plans and permission requests rendered the same way whatever the vendor. The harness's own TUI opens in an embedded terminal on the same session, without restarting it.
- **Run board.** Per project: planned, implementing, testing, in review, waiting for you, done.
- **Approvals inbox.** Every permission request and escalation from every agent in one queue, with one shortcut to approve.
- **Agent bus feed.** Messages, review requests and handoffs between agents, grouped by exchange with their turn count; questions to you and your answers; turn limits and denied tools as warnings; wakes and sessions joining or leaving as quiet system lines.
- **Spend.** Tokens and cost per run, project and vendor.

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

How the connection behaves:

- At startup the frontend probes the daemon. If it answers, the cockpit uses `TauriDaemonClient`; if not, it shows mock data with a **Mock data** badge and a "agentuxd is not running" banner, and reloads by itself once the daemon is up.
- The backend keeps one `events.subscribe` stream open and forwards each event to the UI (`daemon://event`). When the daemon stops it reports the disconnect, retries with exponential backoff (0.5 s up to 15 s) and resubscribes from the last `seq` it saw, so nothing is lost while the daemon restarts. On daemons that mark the end of a replay (`replay_done`, agentux-core #9) the stream reports itself connected once the replayed events are forwarded; the UI reloads the project/run/request lists on every reconnect.
- Opening a run loads its stored events (session timelines) and its agent-bus log (`bus.list`); the bus page and the board's rail load the log of the most recent runs the same way. The run's history is read with `runs.events` in pages and continued with `events.subscribe { runId, since: headSeq }` up to its `replay_done`; daemons without `runs.events` (-32601) fall back to replaying a subscription, ended by the marker or, on the oldest daemons, by a short pause. Live `bus_message` events keep them current, merged by id. Questions agents ask through `ask_human` land in the approvals inbox: pick a suggested answer (buttons, or `1`–`9`), type one, or decline. See the mapping notes in `cockpit/src/daemon/tauri/mapping.ts`.
- Optional daemon methods (`sessions.prompt`, `bus.post`, `terminals.*`) are probed after each load. The session composer (`sessions.prompt`) puts your message in the session as your own bubble; the bus composer, on the bus page and in a run's **Bus** tab, posts as you (`bus.post`) to a role, one session or the whole run, or answers a message (**Reply**, `inReplyTo`). Each stays disabled, with the reason shown, on daemons that do not serve its method and on finished runs.
- **Terminal mode** (agentux-core #11). The session view's **Structured / Terminal** toggle (`T`) opens the session in its harness's own TUI (`terminals.open`, `command: harness-tui`) on a PTY the daemon manages, rendered with xterm.js, sized to the panel and themed from the cockpit's colours. While the session's turn is in progress the terminal waits (shown as such; input is dropped); then the daemon hands the session over and its badge shows **attached** (turns for it queue until the TUI exits). When the daemon cannot resume the session in a TUI it runs a shell instead, and the reason is shown as a banner. **Shell in worktree** on an active run opens a shell in the run's worktree in a **Shell** tab. While the terminal has the keyboard, the cockpit's shortcuts are off (Escape too, the TUI uses it); `Shift+Esc` or `Ctrl+]` gives the keyboard back.
  The daemon ties a terminal to the connection that opened it, so the backend gives each terminal its own socket connection (`src-tauri/src/daemon/terminal.rs`) and emits its output as `terminal://<stream>` events, a name the UI listens on before opening. Input and resizes go as JSON-RPC notifications on that connection. A view that is rebuilt while its terminal runs re-attaches (`terminals.attach`: scrollback, then live output) instead of opening another. Leaving terminal mode closes the run's TUIs (the sessions go back to ACP), closing the shell tab closes the shell, closing the run panel closes all of the run's terminals, and a closed or reloaded window drops every terminal connection. In mock mode the terminal is a fake echo shell that behaves the same way (waiting, attached, Antigravity's fallback).

### Layout of the code

| Path | What it is |
|---|---|
| `cockpit/src/daemon/types.ts` | Domain model: projects, runs, steps, sessions, vendor-neutral session events, permission requests, bus messages, spend |
| `cockpit/src/daemon/client.ts` | The `DaemonClient` interface the UI depends on, and `createDaemonClient()` |
| `cockpit/src/daemon/tauri/` | `TauriDaemonClient` (real daemon via the Tauri backend), API wire types, and the API-to-cockpit mapping |
| `cockpit/src/daemon/mock/` | `MockDaemonClient` plus the scripted scenarios it plays |
| `cockpit/src/components/` | Run board, session view, approvals inbox, agent bus feed, status bar |
| `cockpit/src-tauri/` | Rust shell: hosts the window; `src/daemon/` is the socket client, the reconnecting event stream and the `daemon_*` commands |

Components only talk to the `DaemonClient` interface; `createDaemonClient()` picks the implementation.

### Keyboard

`B` / `I` / `M` switch between run board, approvals inbox and agent bus. `A` approves the focused request (the inbox selection or the open run's pending request), `D` denies, `1`–`9` answers an agent's question, `J`/`K` move through the inbox, `T` toggles terminal mode (`Shift+Esc` or `Ctrl+]` leaves the terminal), `N` starts a new run (with a daemon), `[`/`]` cycle projects, `?` lists everything.

### Packaging

`.github/workflows/release.yml` builds the cockpit as an RPM (`agentux-cockpit`, binary `/usr/bin/agentux-cockpit`, desktop entry "AgentUX Cockpit" under Development) inside a `fedora:44` container, so it links against the same WebKitGTK the AgentUX image ships. It builds for both x86_64 and aarch64, each natively on GitHub's x86_64 and arm64 runners, and installs each RPM in a fresh container of its architecture to check that the binary's libraries resolve. Pushing a `v*` tag matching the version in `tauri.conf.json` attaches both RPMs to a GitHub release; running the workflow manually uploads them as artifacts. To install one on Fedora 44, pick the file for your architecture:

```sh
sudo dnf install ./agentux-cockpit-<version>-1.$(uname -m).rpm
```

The Plasma overlay tarball below is architecture-independent and built once. Rust dependencies are pinned by the committed `Cargo.lock` (CI builds with `--locked`).

### Single instance and window identity

The cockpit runs once per user session. Meta+A, the login autostart and the launcher all run `agentux-cockpit`; when one is already running, the new process hands over to it through [`tauri-plugin-single-instance`](https://v2.tauri.app/plugin/single-instance/) (a D-Bus name `os.agentux.cockpit.SingleInstance` on the session bus) and exits. The running cockpit then unminimizes, shows and focuses its `main` window.

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

KDE Plasma 6 (Wayland) defaults for the AgentUX image live in [`plasma/`](plasma), laid out as a filesystem overlay: `plasma/usr/...` lands in `/usr`, `plasma/etc/...` in `/etc`. They are system-wide defaults only. Nothing is written to any home directory or `/etc/skel`; each user's own settings override every key, and System Settings can change or reset all of it.

| Overlay path | What it does |
|---|---|
| `usr/share/plasma/look-and-feel/os.agentux.desktop/` | **AgentUX global theme.** `contents/defaults` sets Breeze Dark (colour scheme, icons, Plasma style, window decoration, cursors). `contents/layouts/org.kde.plasma.desktop-layout.js` builds the first desktop: the AgentUX wallpaper and a bottom panel with Kickoff, a task manager pinning AgentUX Cockpit, Konsole and the default browser, the system tray, the clock and Show Desktop |
| `usr/share/wallpapers/AgentUX/` | Wallpaper package: an SVG of the cockpit logo on the cockpit's dark background |
| `etc/xdg/kdeglobals` | Selects the global theme (`LookAndFeelPackage=os.agentux.desktop`) and the cockpit's accent colour `#c6f36b` (`AccentColor=198,243,107`) |
| `etc/xdg/kscreenlockerrc` | Uses the AgentUX wallpaper on the lock screen |
| `usr/lib/plasmalogin/plasmalogin.conf.d/50-agentux.conf` | Uses the AgentUX wallpaper on the login screen (Plasma Login, Fedora 44's display manager). Plasma Login reads `/etc/plasmalogin.conf.d/*`, then Fedora's `/usr/lib/plasmalogin/defaults.conf` (Fedora wallpaper), then this directory, then `/etc/plasmalogin.conf`, later files winning; so this beats Fedora's default and System Settings > Login Screen still beats this. The greeter takes its colours from the global theme in `/etc/xdg/kdeglobals` |
| `etc/xdg/kded5rc` | Turns off the kded module `kded_plasma_welcome`, which opens Fedora's Welcome Center ("Welcome to Fedora!") on first login and after Plasma feature upgrades. It has no XDG autostart entry to hide; KF6's kded still reads `kded5rc`. The app stays installed, and users can turn the module back on in System Settings > Background Services. AgentUX's own first run belongs in the cockpit |
| `usr/share/kglobalaccel/agentux-*-shortcut.desktop` | Global shortcuts: **Meta+A** launches the cockpit, **Meta+Return** opens Konsole (Konsole's own Ctrl+Alt+T stays) |
| `etc/xdg/autostart/agentux-cockpit.desktop` | Starts the cockpit at login (`TryExec`, so it does nothing if the cockpit isn't installed). Users turn it off in System Settings > Autostart |
| `usr/libexec/agentux-cockpit-autostart` | What the autostart entry runs: exits for system accounts (UID below `UID_MIN` from `/etc/login.defs`, the same rule as systemd's `ConditionUser=!@system`), otherwise execs `agentux-cockpit`. Fedora's first-boot wizard runs a whole Plasma session as the `plasma-setup` system user (UID 968), and XDG autostart, including ours, runs there too. A wrapper rather than a systemd drop-in for `app-agentux-cockpit@autostart.service` because it also covers Plasma's own autostart when systemd startup is off |

How it takes effect: on login, `startplasma` reads `LookAndFeelPackage` from `kdeglobals`, writes that global theme's defaults into `~/.config/kdedefaults` (a defaults layer, not user settings) and applies the colour scheme with the accent colour. plasmashell runs the theme's layout script only when the user has no desktop layout yet, so existing users keep their panels. On Fedora Kinoite `/etc/xdg` comes before Fedora's own defaults in `/usr/share/kde-settings/kde-profile/default/xdg` in `XDG_CONFIG_DIRS`, so these keys win over Fedora's.

**KWin tiling: not included.** Plasma 6 stores custom tile layouts in `kwinrc` under `[Tiling][<virtual desktop id>][<output uuid>]`, and both ids are created per user and per monitor, so a system-wide default layout can't be written ahead of time. The built-in tiling needs no configuration: drag a window with Shift held, or edit tiles with Meta+T.

**Check:** `plasma/check.sh` runs `desktop-file-validate` on every `.desktop` file, a syntax check (`node --check`) on the layout script, a JSON check on package metadata and an XML check on the SVG, makes sure every `file:///usr/...` reference ships in the overlay, and refuses anything under `/home`, `/root`, `/var/home`, `/var/roothome` or `/etc/skel`. It also checks that `/usr/libexec/agentux-*` scripts are executable and parse (`sh -n`), runs the cockpit autostart wrapper against a stub `agentux-cockpit` as a system user (must not start it) and as a regular user (must exec it with its arguments; both cases need root and `setpriv`), checks that `kded5rc` turns `kded_plasma_welcome` off, and that only `.conf` files go into Plasma Login's drop-in directory. CI runs it in a `fedora:44` container (job `plasma overlay`), then uses `dnf repoquery` to check that the Fedora 44 paths the overlay relies on still exist (`kded_plasma_welcome.so`, `/usr/lib/plasmalogin/plasmalogin.conf.d`, `defaults.conf`) and that no overlay file replaces a file a Fedora package owns.

### How agentux-os consumes it (proposal)

The overlay has to land in the image at build time, since `/usr` is read-only on the installed system. Copy only `usr/` and `etc/`; `plasma/check.sh` must not end up in `/`. Two options:

1. **Release tarball (recommended).** The release workflow also attaches `agentux-plasma-<version>.tar.gz`, built reproducibly from `plasma/usr` and `plasma/etc` only (paths relative to `/`), plus a `.sha256`. The Containerfile pins it next to the cockpit RPM:

   ```dockerfile
   ARG AGENTUX_DESKTOP_VERSION=0.1.0
   RUN curl -fsSL "https://github.com/agentux-os/agentux-desktop/releases/download/v${AGENTUX_DESKTOP_VERSION}/agentux-plasma-${AGENTUX_DESKTOP_VERSION}.tar.gz" \
         | tar -xz -C / --no-same-owner
   ```

   One version number covers both the cockpit and its desktop defaults, and the image build doesn't need git.

2. **Git checkout at a pinned ref.** Use a multi-stage build that clones this repo at a tag and copies the two directories:

   ```dockerfile
   FROM docker.io/alpine/git AS desktop
   RUN git clone --depth 1 --branch v0.1.0 https://github.com/agentux-os/agentux-desktop /src
   FROM quay.io/fedora/fedora-kinoite:44
   COPY --from=desktop /src/plasma/usr/ /usr/
   COPY --from=desktop /src/plasma/etc/ /etc/
   ```

The agentux-os change (and adding the tarball to `release.yml`) is a separate task.

### Not verified on a running Plasma session

These files follow the Plasma 6 sources (plasma-workspace `startplasma`, `KLookAndFeelManager`, `shellcorona`, kglobalacceld) and the layout of shipping downstreams such as Aurora, but none of it has been booted yet. To check in a VM with a fresh user:

- the panel, pinned launchers and wallpaper appear on first login, and the accent colour shows up (selection, focus rings);
- Meta+A and Meta+Return appear in System Settings > Keyboard > Shortcuts and work, with no conflict with other default shortcuts;
- the cockpit starts at login and appears in System Settings > Autostart;
- the SVG wallpaper renders: Plasma loads wallpapers through Qt image plugins, and SVG needs the `qt6-qtsvg` image format plugin, which Kinoite ships with KDE.

Known limits:

- **Meta+A on a running cockpit brings its window forward instead of opening a second one** (the cockpit is single-instance, see [Single instance and window identity](#single-instance-and-window-identity)). Whether KWin actually raises and focuses it, rather than only marking it as demanding attention, has not been checked on Plasma 6 Wayland.
- **First-boot wizard (`plasma-setup`) branding: not themed, and can't be from this overlay.** It runs on the first boot of a bootc disk image even when a user already exists (it then skips account creation). Its landing page hard-codes "Welcome to Plasma Desktop", takes its background from `wallpapers/Default/contents/images/5120x2880.jxl` (a Fedora patch points it at the `Default` wallpaper, which Fedora's background packages provide as the F44 wallpaper; replacing package-owned files from the overlay is off limits, and CI checks it), and prints "Powered by <NAME>" from `os-release`. Changing that line means changing `NAME` in the image's `/usr/lib/os-release`, an agentux-os decision with wider effects (tools that match on the distro name). Anything more needs a patched `plasma-setup`, as Aurora does.
- If `plasma-setup` creates the account and the user flips its light/dark switch, it applies Fedora's `org.fedoraproject.fedora(dark).desktop` global theme (a Fedora patch) and copies the wizard's `kdeglobals` into the new home, so that user starts on Fedora's theme instead of AgentUX's. Left alone, the switch changes nothing (it starts on "dark" because our colour scheme is Breeze Dark). Same fix as above: a patched `plasma-setup`.
- Login screen: only the wallpaper is ours. Plasma Login shows no distribution logo.

## Relevant ADRs

- [0001 — Linux distribution on Fedora Atomic](https://github.com/agentux-os/agentux/blob/main/docs/adr/0001-linux-distribution-on-fedora-atomic.md)
- [0004 — Unified interface and agent bus](https://github.com/agentux-os/agentux/blob/main/docs/adr/0004-unified-interface-and-agent-bus.md)

## License

[Apache 2.0](LICENSE)

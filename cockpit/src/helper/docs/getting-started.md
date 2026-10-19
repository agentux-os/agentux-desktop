# Getting started

This guide takes you from installing AgentUX to a first run that ends in a pull request. AgentUX is pre-release: expect rough edges, and see the [roadmap](../README.md#roadmap) for what is not validated yet.

## 1. Install

AgentUX is a bootc image on Fedora Atomic (Kinoite). The [agentux-os README](https://github.com/agentux-os/agentux-os#install) describes installation in full; this section is the short version.

### Choose a variant

Both images are built from the same `Containerfile`, contain the same AgentUX components, cockpit and agent CLIs, and are signed the same way ([ADR 0010](adr/0010-image-variants-and-system-identity.md)):

| Image | Pick it if |
|---|---|
| `ghcr.io/agentux-os/agentux` | You want KDE Plasma with the AgentUX theme, panel and shortcuts. The default. |
| `ghcr.io/agentux-os/agentux-cosmic` | You want the lighter COSMIC desktop, with tiling built in. |

Both are released. Switching an installed system between them with `bootc switch` is not a supported path yet: install the one you want.

### From the ISO

Every release ships four ISOs per architecture, named `agentux-<desktop>-<live|installer>-<version>-<arch>.iso`: the desktop (`plasma` or `cosmic`), `live` to try it first (installing from it needs internet) or `installer` to install offline, and `x86_64` for PCs or `aarch64` for 64-bit ARM. The newest release is on [download.agentuxos.org/iso/stable/](https://download.agentuxos.org/iso/stable/) under the same names without the version. Check it and write it to a USB stick:

```sh
curl -LO https://download.agentuxos.org/iso/stable/agentux-plasma-installer-x86_64.iso
curl -LO https://download.agentuxos.org/iso/stable/agentux-plasma-installer-x86_64.iso.sha256
sha256sum -c agentux-plasma-installer-x86_64.iso.sha256
sudo dd if=agentux-plasma-installer-x86_64.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

Boot it and follow the installer: the disk, language, time zone and your account. The x86_64 ISOs boot with UEFI or legacy BIOS.

### From an existing Fedora Atomic or bootc system

```sh
sudo bootc switch ghcr.io/agentux-os/agentux:stable            # Plasma
sudo bootc switch ghcr.io/agentux-os/agentux-cosmic:stable     # COSMIC
systemctl reboot
```

The system then tracks that image's `:stable` (releases) and updates from it; use `:latest` instead for nightly builds. If an update breaks something, `sudo bootc rollback` (or the previous entry in the boot menu) brings back the image you had.

### On ARM

Each image tag is a manifest list with an amd64 and an arm64 image; `bootc switch`, `bootc upgrade` and `podman pull` pick the one for the machine, so the commands above are the same on aarch64. The arm64 image targets UEFI machines that Fedora supports on aarch64: SystemReady servers and workstations, and VMs on Apple silicon or Ampere hosts. Boards that need their own firmware or kernel are not covered.

Boot the `aarch64` ISO through the machine's UEFI firmware, or attach it as the CD of an aarch64 UEFI VM (UTM or Parallels on Apple silicon, or QEMU with `qemu-efi-aarch64`/`edk2-aarch64`). The arm64 image is built and smoke-tested in CI, but has not been booted there yet (CI's arm64 runners have no KVM), so expect to be among the first to try it, and please report what you find.

### Verifying the image

Every published image is signed with [cosign](https://github.com/sigstore/cosign) twice: keyless, with the identity of the agentux-os build workflow on `main`, and with the AgentUX signing key, whose public half is [`files/etc/pki/containers/agentux-os.pub`](https://github.com/agentux-os/agentux-os/blob/main/files/etc/pki/containers/agentux-os.pub) in agentux-os (and `/etc/pki/containers/agentux-os.pub` on an installed system). From a checkout of agentux-os, on any machine:

```sh
cosign verify ghcr.io/agentux-os/agentux:latest \
  --certificate-identity-regexp '^https://github\.com/agentux-os/agentux-os/\.github/workflows/build\.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

cosign verify --key files/etc/pki/containers/agentux-os.pub ghcr.io/agentux-os/agentux:latest
```

For the COSMIC image, use `ghcr.io/agentux-os/agentux-cosmic:latest`. These check the multi-arch list; to check one architecture's image, verify its digest, e.g. for arm64:

```sh
digest="$(skopeo inspect --raw docker://ghcr.io/agentux-os/agentux:latest \
  | jq -r '.manifests[] | select(.platform.architecture == "arm64") | .digest')"
cosign verify --key files/etc/pki/containers/agentux-os.pub "ghcr.io/agentux-os/agentux@$digest"
```

You do not need to do this on an installed system: its `/etc/containers/policy.json` requires the AgentUX key signature for both images, so `bootc upgrade` and `bootc switch` refuse an unsigned update before downloading it. A system installed from an image older than the signing change gets the policy with its next upgrade; see [On installed systems](https://github.com/agentux-os/agentux-os#on-installed-systems).

## 2. First login

**The agent CLIs install themselves per user.** On your first login, a user service (`agentux-first-login.service`) installs Claude Code, Codex, OpenCode, Antigravity CLI, the ACP adapters and the `mise`-managed dev tools (`bun`, `lazygit`, `ast-grep`, `yq`) into your home, so each CLI can keep itself up to date. It needs the network and downloads a few GB (the Antigravity ACP server alone is about 1 GB unpacked), so give it a few minutes. Follow it with:

```sh
journalctl --user -u agentux-first-login.service -f
```

If something fails, it retries and runs again on the next login. When it has succeeded it writes `~/.local/state/agentux/first-login.done`; delete that file and log in again to repeat it.

**The welcome wizard opens next to the cockpit.** On your first login AgentUX opens **Welcome to AgentUX**, a short setup in four steps. Every step can be skipped, and you can reopen the wizard any time from the app menu (**Welcome to AgentUX**), from the cockpit's sidebar (**Welcome & setup**) or with `agentux-cockpit --welcome`. It does not open on the live ISO.

1. **Agents.** It shows the agent CLIs installing, and has a **Sign in** button for each that opens a terminal with that CLI's own login. AgentUX never handles credentials: each harness uses the login or API key you set up for it, and inference is billed by that provider. To keep an API key in the desktop's secret service (KWallet) instead of a file, the wizard shows the `secret-tool` commands to use.
2. **Tools & SDKs.** One catalog to search and tick: editors and IDEs, languages and SDKs, cloud and Kubernetes CLIs, databases, API clients, Git tools, containers, browsers, design and chat apps. Everything installs for you only, without sudo, in the background (closing the window does not stop it), each item in one of four ways:
   - **Flatpak** from Flathub, for apps such as DBeaver, Postman, Bruno, GitKraken, Podman Desktop or Slack. **VS Code** is a Flatpak too, set up so its integrated terminal is a login shell on the host (`flatpak-spawn --host bash -l`), where your SDKs, podman and the agent CLIs work.
   - **JetBrains Toolbox** for IntelliJ IDEA, PyCharm, WebStorm, GoLand, Rider, CLion, DataGrip, Android Studio and the rest: the wizard installs Toolbox, and you install the IDEs from it. They run without a sandbox, so they see your SDKs.
   - **mise** for languages and CLIs: Java (Temurin 21 by default, or 17 or 25), Node.js, Python, Go, Rust, .NET, Kotlin, Gradle, Maven, Terraform, kubectl, the cloud CLIs and more, with `mise use --global`.
   - **Distrobox** for anything else: a mutable Fedora or Ubuntu container (`distrobox enter fedora-dev`), also used for PHP, Elixir and a C/C++ toolchain.
3. **Git & SSH.** Your Git name, e-mail and default branch, an SSH key, and buttons for GitHub's SSH keys page and `gh auth login`.
4. **Done.** What is installed or still installing, and **Open the cockpit**.

Each item's commands are one click away in the wizard, and the same commands work in a terminal. The wizard's backend is `/usr/libexec/agentux-setup` (`agentux-setup --help`); its logs are in `~/.local/state/agentux/setup/logs/`. To see the wizard again at your next login, run `/usr/libexec/agentux-setup reset`. Why tools install this way: [ADR 0013](adr/0013-first-run-wizard.md).

**Signing in by hand.** Without the wizard, open a terminal (Meta+Return opens Konsole in Plasma) and start each CLI you want to use once, following its sign-in:

```sh
claude      # Claude Code
codex       # Codex
opencode    # OpenCode
agy         # Antigravity CLI
```

You only need the vendors your pipeline uses. The default pipeline uses Claude Code for the planner and implementer and Codex for the reviewer (see [the `agentux.yaml` section](#5-agentuxyaml)).

**The daemon and the cockpit are already running.** `agentuxd` runs as a systemd user service for every user, and the AgentUX Cockpit starts at login. Super+C (Meta+C) opens the cockpit, or brings it forward, at any time.

## 3. Cockpit tour

The cockpit is a single window over every agent session the daemon runs. Projects are in the sidebar; `[` and `]` cycle through them.

- **Run board** (`B`). The runs of the selected project, by stage: planned, implementing, testing, in review, waiting for you, done. **New run** (`N`) asks for a directory inside a git repository and a prompt. Open a run to see its sessions, steps and **Cancel run**.
- **Session view.** Each role's session — messages, tool calls, diffs, plans and permission requests — rendered the same way whatever the vendor. The composer sends your message into the live session, handled after its current turn.
- **Approvals inbox** (`I`). Everything waiting for you, from every run: plan approvals, agents' permission requests, budget overruns and agents' questions. `J`/`K` move through it, `A` approves, `D` denies, `1`–`9` picks an answer to a question.
- **Agent bus** (`M`). Messages, review requests and handoffs between agents, grouped by exchange with their turn count, plus questions to you and your answers. The bus composer posts as you to a role, one session or the whole run.
- **Terminal mode** (`T`). Toggles the session view between the structured view and the harness's own TUI, resuming the same conversation (Claude Code, Codex and OpenCode). While you are in the TUI the session is marked **attached** and the daemon queues its turns; when you leave, the agent continues with everything said in the TUI ([ADR 0007](adr/0007-terminal-mode-is-a-session-handoff.md)). Harnesses that cannot resume get a shell in the run's worktree, with a banner saying why. **Shell in worktree** opens a shell in an active run's worktree. While a terminal has the keyboard, the cockpit's shortcuts are off; `Shift+Esc` or `Ctrl+]` gives the keyboard back.
- **Status bar.** Tokens and cost per run, project and vendor, for harnesses that report them.

Press `?` in the cockpit for the full list of shortcuts.

**The penguin helps.** The AgentUX penguin at the foot of the sidebar offers a short tour of the cockpit the first time you open it (the wizard's last step can start it too), and you can restart it from its menu. `Shift+F1` turns on **What's this?**: click anything in the cockpit or the wizard to learn what it is and how it works. `F1` opens **Ask the penguin**, which answers questions about AgentUX from the documentation that ships with the cockpit, offline. If you want, it can also ask one of your own agents (off by default; it runs on your agent account, without tools or files). It only knows AgentUX, not the desktop around it ([ADR 0017](adr/0017-help-mascot.md)).

| Key | Action |
|---|---|
| `B` / `I` / `M` | Run board / approvals inbox / agent bus |
| `N` | New run |
| `A` / `D` | Approve / deny the focused request |
| `1`–`9` | Answer an agent's question |
| `J` / `K` | Next / previous in the inbox |
| `T` | Toggle terminal mode |
| `Shift+Esc`, `Ctrl+]` | Leave the terminal |
| `[` / `]` | Previous / next project |
| `?` | All shortcuts |
| `F1` / `Shift+F1` | Ask the penguin / What's this? |

Desktop-wide, on Plasma and COSMIC: **Super+C** opens the cockpit and **Super+Return** a terminal (Konsole on Plasma, COSMIC Terminal on COSMIC). The Super key is the one Plasma calls Meta.

## 4. `aux` quick reference

`aux` is the cockpit's terminal twin and talks to the same daemon, so it works over SSH and both stay in sync. `aux --help` and `aux <command> --help` have the details.

```sh
# Runs
aux run [project-dir] --prompt "Add a health endpoint"   # start a run; prints its id
aux run --issue 42                     # from an issue on the project's forge
aux run . --prompt "..." --watch       # start and follow it (--title sets the title)
aux ps                                 # active runs and requests waiting for you
aux ps --all                           # finished runs too
aux watch <run-id>                     # history, then live events (bus included) until the run ends
aux cancel <run-id>                    # stop a run; its worktree and branch are kept

# Decisions
aux approve <request-id> [-m note]     # a plan, a step, a budget overrun, or a permission
aux deny <request-id> [-m reason]      # a denied permission tells the agent no; other denials fail the run
aux answer <request-id> <answer...>    # answer an agent's question (one of its options, or free text)

# Talking to agents
aux say <session-id> <text...>         # message a live session, after its current turn
aux bus <run-id>                       # the run's agent bus log
aux bus <run-id> --post role:reviewer <text...>   # post as you; to: role:<name>, session:<id> or run
aux bus <run-id> --post session:<id> --reply-to <message-id> <text...>

# Terminal mode
aux attach <session-id>                # the session in its harness's own TUI; Ctrl-] detaches
aux attach <session-id> --shell        # a shell in the run's worktree instead

# Pipelines and harnesses
aux validate [path]                    # check agentux.yaml (file or project dir); without one, show the default
aux exec --harness <id> [--cwd <dir>] "<prompt>"   # one prompt to claude-code, codex, opencode or antigravity
```

Session ids appear in `aux watch` (`session <id> started: <role> (<harness>) ...`) and in the cockpit's session view; request ids in `aux ps`.

Every command takes `--socket <path>` to talk to a daemon other than the default (`$AGENTUX_SOCKET`, else `$XDG_RUNTIME_DIR/agentux/agentuxd.sock`).

## 5. `agentux.yaml`

A project can declare its pipeline in `agentux.yaml` at the repository root ([ADR 0005](adr/0005-agentux-yaml.md)). Without one, AgentUX uses the built-in default below, with the `lint` and `test` checks detected from the project (justfile recipes, Cargo, npm scripts, pytest/ruff via uv, Go); if none are detected, the gate step is left out. `aux validate` shows what applies to a project.

Validation is strict: unknown keys fail with their line and column, and every rule violation is reported with its field path. This is the built-in default, annotated:

```yaml
version: 1                    # required; 1 is the only supported version

# Roles map to harnesses: claude-code, codex, opencode or antigravity (experimental).
roles:
  implementer:
    harness: claude-code
  reviewer:
    harness: codex            # a different vendor than the implementer
  planner:
    harness: claude-code
    model: opus               # optional; selected if the harness offers a model choice over ACP

# Commands gate steps run with `sh -c` inside the run's worktree. Names must be unique.
checks:
  - name: lint
    run: just lint
  - name: test
    run: just test
    # timeout: 45m            # optional; s, m or h; default 30m, then the check fails and is killed

# Step types are fixed: plan, implement, gate, review, pull_request, custom.
pipeline:
  - step: plan                # fields: role, approve
    role: planner
    approve: true             # wait for the human before implementing
  - step: implement           # fields: role, approve
    role: implementer
  - step: gate                # fields: checks, on_fail, max_attempts
    checks: [lint, test]
    on_fail: implement        # loop back with the failure output...
    max_attempts: 3           # ...at most this many times (a loop needs its limit)
  - step: review              # fields: role, approve, on_changes_requested, max_rounds
    role: reviewer
    on_changes_requested: implement
    max_rounds: 2
  - step: pull_request        # fields: draft, approve
    draft: false
    approve: false            # true = wait for the human before opening the PR
  # A custom step sends its own prompt to a role (fields: role, prompt, approve):
  # - step: custom
  #   role: reviewer
  #   prompt: Check the changelog mentions this change.

# Agent bus limits (ADR 0004).
bus:
  max_turns_per_exchange: 6   # at least 1
  # Tools agents may use. Leaving `allow` out allows all six: these five and read_messages.
  allow: [post_message, request_review, handoff, get_run_state, ask_human]

budget:
  max_usd_per_run: 10         # pause the run and ask the human when exceeded
```

Loops (`on_fail`, `on_changes_requested`) must point to exactly one earlier step that runs an agent. Credentials never go in this file.

**Running checks in a container.** Checks run code the agents just wrote, by default on your machine with your access. Add `isolation` to run them in a rootless Podman container instead ([ADR 0009](adr/0009-container-isolation-for-checks.md)):

```yaml
isolation:
  mode: podman                # none (default) runs checks on the host
  # image: ghcr.io/example/toolchain:1   # default: the `image` of .devcontainer/devcontainer.json,
  #                                      # else registry.fedoraproject.org/fedora-toolbox:44
  # network: true             # default false: no network inside the container
```

The container sees only the run's worktree (at the same path) and the repository's git directory, read-only; not your home directory, environment or credentials. Files the checks write belong to you. The image must contain the tools your checks call; the first run pulls it. If Podman is missing or the image cannot be pulled, the run fails with that reason. Agents still run on the host, since their CLIs need your logins. `aux validate` shows which image a project's checks would use.

## 6. Troubleshooting

**The cockpit window is blank, flickers or crashes on start.** The cockpit renders with the system WebKitGTK, which has GPU quirks with some drivers (the NVIDIA proprietary driver and some virtual GPUs). Try:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 agentux-cockpit    # most common fix
WEBKIT_DISABLE_COMPOSITING_MODE=1 agentux-cockpit   # last resort: no accelerated compositing
```

To make one permanent for your user, put it in a file under `~/.config/environment.d/` (for example `~/.config/environment.d/cockpit.conf` containing `WEBKIT_DISABLE_DMABUF_RENDERER=1`) and log in again.

**The cockpit shows a "Mock data" badge and "agentuxd is not running".** The cockpit could not reach the daemon and is showing sample data; it reloads by itself once the daemon is up. Check the service:

```sh
systemctl --user status agentuxd.service
journalctl --user -u agentuxd.service
systemctl --user restart agentuxd.service
aux ps                                   # fails if nothing answers on the socket
```

The socket is `$XDG_RUNTIME_DIR/agentux/agentuxd.sock`; the daemon's state is in `~/.local/state/agentux/agentuxd.db`.

**A CLI is not found.** First login may still be running or may have failed: see `journalctl --user -u agentux-first-login.service`. The per-user tools live in `~/.local/bin` and mise's shims, which login shells, user services and apps started from Plasma all have on their `PATH`.

**An agent step fails at once.** Usually the harness is not logged in: run the CLI by hand once (section 2). `aux exec --harness <id> "say hello"` tries one prompt against a harness outside any run.

**Try the whole flow without real agents.** `aux daemon --fake-agents` runs a daemon whose agent steps are answered by a scripted fake (gates still run the real commands), so nothing is billed. Run it on its own socket and database, next to the real daemon:

```sh
export AGENTUX_SOCKET=/tmp/agentux-demo/agentuxd.sock
aux daemon --fake-agents --database /tmp/agentux-demo/agentuxd.db &

mkdir /tmp/demo-repo && cd /tmp/demo-repo
git init && git -c user.name=Demo -c user.email=demo@example.invalid commit --allow-empty -m init
aux run . --prompt "Add a health endpoint"
aux ps                                   # approve the plan with: aux approve <request-id>
```

To watch it in the cockpit, quit the running cockpit first (it is single-instance, so a second launch would only bring the old window forward), then start it from the same shell, with `AGENTUX_SOCKET` still set: `agentux-cockpit &`. Without a GitHub `origin`, the run ends with `PR skipped` and a reason instead of a pull request.

# 0013. A first-run wizard, and how developer tools install

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

After installing AgentUX, the first boot runs `plasma-setup` (KDE's account wizard) and the first login starts Plasma, the cockpit and `agentux-first-login.service`, which installs the agent CLIs, the ACP adapters and a few mise tools in the background. Nothing then helps the user make the system their own: nobody says the agent CLIs are installing or how to sign in to them, and every other developer tool (an IDE, a database client, a JDK, a cloud CLI) is left to the user. On an image-based system that is harder than usual. `/usr` is read-only, `rpm-ostree install` layers packages and slows updates, and the obvious answers (Flatpak, a language version manager, a container) each fit some tools and not others.

The owner asked for a wizard that installs development tools such as VS Code, IntelliJ IDEA or DBeaver, "and SDKs of every kind". They decided the install channels: hybrid, with no VS Code in the image.

## Decision

- **A "Welcome to AgentUX" wizard in the cockpit**, a second window of the same Tauri app (`agentux-cockpit --welcome`, `index.html?view=welcome`). It opens on each user's first login and can be reopened from the app menu, from the cockpit's sidebar or with `agentux-cockpit --welcome`. It has four steps: agents, tools and SDKs, Git and SSH, and done. It is keyboard driven, can be skipped, and follows the cockpit's look. `plasma-setup` stays as it is: the wizard runs after it, in the user's own session.
- **When it opens:** an XDG autostart entry (`/etc/xdg/autostart/agentux-welcome.desktop`, shipped in agentux-desktop's Plasma overlay) runs `agentux-setup autostart`. That opens the wizard unless the user is a system account (like `plasma-setup`'s own session), the system is the live ISO (its marker file, or `rd.live.image`), or `~/.local/state/agentux/welcome.done` exists. Finishing or skipping writes the marker. The cockpit is single-instance, so `--welcome` opens the wizard in the running cockpit, as a child window of the main one.
- **All the work is done by one script**, `/usr/libexec/agentux-setup`, shipped in the Plasma overlay with the cockpit so they version together. The UI reaches it through one Tauri command with an allowlist of subcommands. Installs run in transient systemd user units (`systemd-run --user`), one batch at a time, so they keep going when the window closes. Per-item state and logs are files under `~/.local/state/agentux/setup/`, and `agentux-setup status` reports them as JSON. `agentux-setup plan` prints the exact commands without running them. This makes the backend testable without a window: the smoke test, `plasma/check.sh` and a vitest that compares the script's plan with the UI's run it headless.
- **The catalog is data**: `/usr/share/agentux/setup/catalog.json`, read by the script and bundled into the UI. The UI shows it as one catalog with categories and search. Each item names its install method, which the UI shows only as a small hint:

  | Method | For | How |
  |---|---|---|
  | `flatpak` | GUI apps that are happy in a sandbox: database and API clients, Git GUIs, browsers, chat, design, utilities, and VS Code (below) | `flatpak install --user` from Flathub. The remote is added per user from the shipped `flathub.flatpakrepo` (`remote-add --user --if-not-exists`), whatever Fedora's system remotes and third-party policy say |
  | `jetbrains-toolbox` | Every JetBrains IDE (IntelliJ IDEA, PyCharm, WebStorm, GoLand, Rider, CLion, RustRover, PhpStorm, RubyMine, DataGrip) and Android Studio | The official JetBrains Toolbox App tarball, resolved from JetBrains' release API, checked against its published SHA-256 and unpacked into `~/.local/share/JetBrains/Toolbox`, with a menu entry. The user then installs the IDE in Toolbox, and the wizard says which ones they picked. There is no supported Toolbox CLI to preselect them |
  | `mise` | Languages, SDKs and CLI tools: Java (Temurin 17, 21 or 25), Kotlin, Gradle, Maven, Node.js, pnpm, Yarn, Deno, Python, Go, Rust, .NET, Ruby, Zig, Flutter, Terraform, OpenTofu, kubectl, Helm, k9s, kind, and the AWS, Google Cloud and Azure CLIs | `mise use --global tool@version`, in the user's home, without sudo. Login shells, user services and Plasma apps already have mise's shims on their `PATH` (agentux-os's `profile.d` and `environment.d`) |
  | `distrobox` | Anything else, and what mise would compile on Fedora (PHP, Erlang/Elixir) or needs a C toolchain, which the image does not ship | A Fedora (toolbox image of the system's release) or Ubuntu 24.04 container created with `distrobox create`, and packages installed in it with its package manager |

- **VS Code is a Flatpak with host integration.** It is not in the image. The wizard installs `com.visualstudio.code` (and `com.vscodium.codium` the same way) and then:
  - applies `flatpak override --user --talk-name=org.freedesktop.Flatpak --filesystem=home`. Flathub's manifest grants both already; the override keeps them if it ever stops;
  - merges into its `settings.json` a terminal profile running `/usr/bin/flatpak-spawn --host --env=TERM=xterm-256color bash -l` and makes it the default. Keys the user set win, and a `settings.json` with comments is left alone with a note. The integrated terminal is then a host login shell, where mise SDKs, podman, distrobox and the agent CLIs all work;
  - points `dev.containers.dockerPath` at a small wrapper that runs `flatpak-spawn --host podman` inside the sandbox (and plain `podman` outside it);
  - installs the Flatpak SDK extensions matching the user's global mise SDKs (`org.freedesktop.Sdk.Extension.openjdk21`, `node24`, `golang`, `rust-stable`, `dotnet10`, ...) for VS Code's runtime branch, and enables them with `FLATPAK_ENABLE_SDK_EXT`. Language extensions run inside the sandbox and need a toolchain there. This sync runs again whenever an SDK installs.
- **Agents:** the wizard shows first-login's progress per CLI (from `first-login.steps` and the unit's state), with a retry that restarts the unit. It signs in through each vendor's own CLI in a terminal (`claude`, `codex login`, `opencode auth login`, `agy`) and shows how to keep an API key in the desktop's secret service with `secret-tool`. It never handles credentials itself, and it states that inference stays with the providers.
- **Git and SSH:** global name, e-mail and default branch; an ed25519 key (with an optional passphrase) shown with a copy button, GitHub's "new SSH key" page and `gh auth login`.

## Consequences

- A new user gets from the login screen to a working environment in one place, and every choice can be repeated or undone later. The commands are shown and are ordinary user-level `flatpak`, `mise` and `distrobox` calls.
- Nothing is added to the image. VS Code, IDEs and SDKs update on their own schedules (Flathub, Toolbox, mise) instead of the image's, and image updates stay small.
- **Trade-offs of the Flatpak VS Code:**
  - Its terminal is the host's, but its extensions are not. Language servers and debuggers run in the sandbox, with the runtime's libraries and the SDK extensions, not the user's mise versions. An extension that wants a version the extensions do not offer needs its path set by hand, or the Dev Containers or Remote workflow.
  - The `org.freedesktop.Flatpak` D-Bus access that makes `flatpak-spawn --host` work also lets VS Code run anything on the host. For an editor that runs arbitrary build commands that is the point, but it means the sandbox does not protect the host from VS Code.
  - Dev Containers with podman through `flatpak-spawn` is a documented community setup, not something Microsoft supports; it is untested here.
- **JetBrains through Toolbox** means no sandbox and no host-SDK problem, and JetBrains' own channel for updates and licences. The cost is a second step in Toolbox, and a ~150 MB download outside any package manager, verified only by JetBrains' checksum over HTTPS.
- **mise on Fedora** installs precompiled builds for most of the catalog. Erlang and PHP would compile from source, which needs a toolchain the image lacks, so they go to the Fedora container. Rust works, but crates that link C need a linker: the "C/C++ toolchain" item installs one in the Fedora container.
- The wizard depends on Flathub, JetBrains' servers, mise's sources and container registries being reachable. Failures show per item with the last log line and a retry, and logs stay in `~/.local/state/agentux/setup/logs/`.
- The catalog has to be kept honest. Its tests check ids, mise tool names and SDK extension names, and an opt-in test asks Flathub's API about every Flatpak and its architectures. Several apps exist only for x86_64; the catalog records that and the UI disables them on aarch64.

## Alternatives considered

- **VS Code as an RPM in the image** (Microsoft's repository): host SDKs and podman would just work, with no sandbox to bridge. The owner declined it to keep the image smaller and free of a third-party repository that every image build would depend on.
- **JetBrains IDEs as Flatpaks** (`com.jetbrains.*` on Flathub): community-maintained, and the sandbox breaks what an IDE needs: host JDKs, build tools, Docker or podman, and run configurations. Toolbox is the official channel and unsandboxed.
- **Everything in a Distrobox container** (IDEs exported to the host menu): one mutable world for everything, but a heavier first run, GUI apps one step removed from the desktop, and an extra layer for the common case that Flatpak and mise handle well. It stays as the fallback for anything else.
- **`rpm-ostree install` for tools:** layering makes every image update slower and can block updates on dependency conflicts. That is the opposite of what an image-based system is for.
- **A separate wizard app, or a KDE Plasma Welcome page:** a second program to build, theme and ship. The cockpit already has the design system, the Tauri shell, the single-instance handover and the autostart, and Fedora's Welcome Center is turned off on AgentUX.
- **Doing the work in Rust inside the cockpit:** installs would die with the window unless the app grew its own job runner, and they could not be tested without a window. A script run in transient systemd units gets both for free.

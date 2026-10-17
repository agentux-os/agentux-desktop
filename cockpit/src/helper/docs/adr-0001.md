# 0001. AgentUX is a Linux distribution, built as a bootc image on Fedora Atomic

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

AgentUX is a Linux distribution for developers who work with coding agents from several vendors at once. The machine itself is the product: it boots into an environment where harnesses, the toolchain, the orchestrator and a unified interface are already installed, configured and wired together.

Inference runs at the providers, so the distribution needs no special hardware. Its job is orchestration, isolation and developer experience.

Building a distribution from scratch (kernel configuration, package repositories, installer, update channel) would consume the project before the orchestration layer exists. The base must make the distribution cheap to build and maintain.

Agents run commands on the machine. A broken package, a bad config change or a runaway `rm` must be recoverable in one step.

## Decision

- **Base: Fedora Atomic, built with [bootc](https://containers.github.io/bootc/).** The whole OS is defined in a `Containerfile` in `agentux-os`, built by CI into an OCI image, and turned into an installable ISO with `bootc-image-builder`. This is the approach Universal Blue (Bluefin, Bazzite) uses to run downstream distributions with small teams.
- **Immutable system, image-based updates.** `/usr` is read-only; updates are atomic and the previous image stays bootable. If an agent breaks something, rollback is one command or one boot menu entry.
- **Desktop: KDE Plasma on Wayland** for the first release. It is familiar to people coming from Windows or macOS and supports tiling layouts that suit watching several agents at once. A Hyprland variant can be published later as a second image from the same Containerfile.
- **In the image:**
  - AgentUX: `agentuxd`, the `aux` CLI and the cockpit (see [0004](0004-unified-interface-and-agent-bus.md)).
  - System toolchain: `git`, `gh`, `mise`, `uv`, Node.js, `ripgrep`, `fd`, `jq`, `bat`, `delta`, `just`, Podman, Distrobox.
- **Installed per user on first login:** the harness CLIs (Claude Code, Codex, OpenCode, Antigravity CLI) and fast-moving tools (`bun`, `lazygit`, `ast-grep`, `yq`). Harness CLIs ship updates weekly or faster and update themselves; baking them into a read-only `/usr` would pin users to stale versions between image builds.
- **Language runtimes are per project** through `mise` and dev containers, not baked into the image. This keeps the image small and lets every project pin its own versions.
- **AgentUX components are ordinary Linux packages.** `agentuxd`, `aux` and the cockpit are developed and tested on any Linux, including WSL and VMs, and the image installs them. The distribution adds integration, not hidden logic.

## Consequences

- One `Containerfile` plus CI is the whole build pipeline; contributors can test an image in a VM without reinstalling anything.
- Atomic rollback replaces the Btrfs-snapshot idea from the original concept.
- Users install the distribution to use the full experience. Developing AgentUX itself does not require it.
- Some tools that expect a mutable `/usr` need to run in a container (Toolbx/Distrobox ship with Fedora Atomic).
- The `<800 MB RAM` target from the original concept is dropped. Harness CLIs run on Node or Bun and dominate memory use.

## Alternatives considered

- **Alpine** — musl libc breaks prebuilt Node binaries and webview toolkits that harnesses and the cockpit rely on.
- **Arch with archiso** — fresh packages, but no atomic updates or rollback, and a larger maintenance burden for a downstream distribution.
- **NixOS** — reproducible and rollback-capable, but a steep learning curve for contributors and users.
- **Hyprland as the default desktop** — efficient for tiling, but too niche for a first release aimed at a broad audience.

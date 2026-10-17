# 0008. Releases and image pinning

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The image ([0001](0001-linux-distribution-on-fedora-atomic.md)) is built from three repositories: `agentux-core` (`aux`, `agentuxd`), `agentux-desktop` (the cockpit and the Plasma defaults) and `agentux-os` (the `Containerfile`). `/usr` is read-only on an installed system, so everything AgentUX ships must land at image build time, and a given image must always be rebuildable with the same AgentUX components.

## Decision

- **Each component publishes GitHub releases.** Pushing a `v<version>` tag that matches the version in the repository builds the artifacts in a Fedora 44 container (so they link against the libraries the image ships) and attaches them to the release:
  - `agentux-core`: `agentux-<version>-1.fc44.x86_64.rpm`, installed and smoke-tested in a clean Fedora 44 container before it is attached.
  - `agentux-desktop`: `agentux-cockpit-<version>-1.x86_64.rpm`, plus the Plasma overlay `agentux-plasma-<version>.tar.gz` (paths relative to `/`, only `usr/` and `etc/`) and its `.sha256`.
  - Releases are marked pre-release while AgentUX is pre-1.0.
- **The image pins versions in one place**, the `ARG`s of the `Containerfile` in `agentux-os`: `AGENTUX_CORE_VERSION`, `AGENTUX_DESKTOP_VERSION` and `AGENTUX_PLASMA_SHA256`. The build installs both RPMs with `dnf` and extracts the Plasma tarball over `/` only if its checksum matches.
- **Bumping is a reviewed change.** `just bump-agentux` takes the newest non-draft release of each component (pre-releases included), rewrites the three pins (the checksum from the release's `.sha256` asset) and shows the diff; the bump lands in `agentux-os` through a pull request like any other change.
- **CI builds and boots the image.** `agentux-os` builds the image on every pull request and pushes `ghcr.io/agentux-os/agentux:latest` and a dated tag from `main` daily, so Fedora updates are picked up. Every build runs a first-login smoke test in a container. A nightly boot test (also on demand, and on pull requests that touch the image) boots the published image under QEMU/KVM with UEFI and checks over SSH that the system and user manager have no failed units, first-login completes, `agentuxd` answers, a fake-agent run reaches a pull request, and Plasma starts with the cockpit.

## Consequences

- An image is reproducible from its `Containerfile`: the AgentUX bits it contains are named by version and, for the overlay, by checksum.
- Components release independently; the image moves only when someone bumps it, and the bump is visible in `agentux-os` history.
- RPMs and images are not signed yet, and only `x86_64` is built.
- A change to an RPM's release number or Fedora tag (`-1.fc44`) needs a manual edit of the file name in the `Containerfile`.
- The boot test is slow (about an hour) and needs the network inside the VM, so it is not a required check.

## Alternatives considered

- **A Fedora COPR or own RPM repository** — proper package metadata and updates, but another service to run; the image is the update channel anyway.
- **Build components from source inside the `Containerfile`** — no release step, but slow image builds, a Rust and Node toolchain in the build, and no tested artifact to pin.
- **Track the latest release automatically** — fewer manual bumps, but images would change without review and builds would not be reproducible.

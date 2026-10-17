# 0010. Image variants and system identity

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

The image ([0001](0001-linux-distribution-on-fedora-atomic.md)) is Fedora Kinoite with the AgentUX components and Plasma defaults on top, built from one `Containerfile` in `agentux-os` ([0008](0008-releases-and-image-pinning.md)). Two requests followed. Developers who live in tiling window managers want a keyboard-driven desktop that can show the cockpit and several agent terminals side by side, and Hyprland is the one they ask for. And the installed system still introduced itself as Fedora Linux: in the boot menu, the first-boot wizard, `hostnamectl` and KDE's About page, with Fedora's boot splash.

Fedora 44 has no Hyprland package. Every new image also needs the same treatment as the first, which since [0008](0008-releases-and-image-pinning.md) gained two architectures ([agentux-os#12](https://github.com/agentux-os/agentux-os/pull/12)) and signatures with a policy that makes installed systems refuse unsigned updates ([agentux-os#9](https://github.com/agentux-os/agentux-os/pull/9)). This amends 0008's note that images are unsigned and `x86_64` only; the component RPMs are still unsigned.

## Decision

- **Two images from one `Containerfile`,** selected by the build argument `VARIANT`: `plasma` (the default) is `ghcr.io/agentux-os/agentux`; `hyprland` is `ghcr.io/agentux-os/agentux-hyprland`. Plasma stays the default image.
- **The Hyprland variant is Kinoite plus a Hyprland session,** not a minimal base. It adds a session, *AgentUX Hyprland*, which the login screen preselects; Plasma stays installed and selectable. Hyprland and its companions (hyprlock, hypridle, hyprpolkitagent, the Hyprland portal) come from the `sdegler/hyprland` COPR, which builds for x86_64 and aarch64; its repository file is left disabled in the image, so updates arrive only through new images. Waybar, fuzzel, mako, foot and the other tools come from Fedora. The defaults use the master layout with the cockpit as master, in the AgentUX colours; the user's `~/.config/hypr/hyprland.conf` sources the image's defaults, so they follow image updates while the user's own lines win.
- **Both images are treated alike:** built natively for amd64 and arm64 and published as one multi-arch manifest list each, smoke-tested on both architectures, signed with cosign (keyless and with the AgentUX key) on the list and on each architecture's image, and covered by the same `/etc/containers/policy.json` entries, so an installed system of either variant refuses an unsigned update and can `bootc switch` to the other.
- **The system calls itself AgentUX where people look, and Fedora where tools look.** `/usr/lib/os-release` sets `NAME=AgentUX`, `PRETTY_NAME` and `VERSION` as `AgentUX <YYYYMMDD> (Fedora Linux 44 base)`, `IMAGE_ID`/`IMAGE_VERSION`, `VARIANT`/`VARIANT_ID`, `LOGO`, the URLs, `DEFAULT_HOSTNAME` and `ANSI_COLOR`, and drops Fedora's Bugzilla fields. `ID`, `VERSION_ID`, `CPE_NAME` and `SUPPORT_END` stay Fedora's. KDE's About page gets an AgentUX `kcm-about-distrorc`.
- **AgentUX's Plymouth theme is the boot splash,** built into the initramfs bootc boots, with `rhgb quiet` added through `bootc/kargs.d` since Kinoite's image sets no kernel arguments.

## Consequences

- One `Containerfile` and one CI pipeline serve both desktops; the AgentUX components, the cockpit, first login and the first-boot wizard work unchanged in the Hyprland image.
- The Hyprland image is large (the KDE stack stays in it) and has two desktops, and Hyprland's updates depend on a third-party COPR rather than Fedora. If the COPR stops building for a Fedora release, the variant's build fails rather than shipping without Hyprland.
- Only the Plasma image is boot-tested; the Hyprland image's configuration is checked at build time (`Hyprland --verify-config`, `foot --check-config`, `jq` on Waybar's config) and in the smoke test, but its session is not started in CI.
- Keeping `ID`, `VERSION_ID` and `CPE_NAME` as Fedora's keeps everything that keys on them working: bootc-image-builder picks its Fedora definitions by `ID`/`VERSION_ID`, dnf resolves `$releasever` from `VERSION_ID`, toolbox picks `fedora-toolbox:<VERSION_ID>`, and vulnerability scanners map `CPE_NAME` to Fedora's advisories, which is correct because the packages are Fedora's. The build fails if those fields drift from the base image's, and the tests check them again. The cost is that a tool keying on `ID` cannot tell AgentUX from Fedora; it must look at `IMAGE_ID` or `VARIANT_ID`.
- The splash hides boot messages by default; Esc shows them, and removing `rhgb quiet` turns the splash off.

## Alternatives considered

- **A Hyprland image on a minimal Fedora Atomic base** — smaller, one desktop, but the cockpit's Plasma overlay, the login screen, plasma-setup's first-boot wizard and the boot test would all need replacements before the variant was usable.
- **A separate `Containerfile` or repository per variant** — clearer per variant, but the AgentUX section, pins, signing and tests would be duplicated and drift.
- **Building Hyprland from source in the image** — no third-party repository, but a long build, a C++ toolchain in the build and no upstream packaging to lean on.
- **Changing `ID` to `agentux` with `ID_LIKE=fedora`,** as Bluefin and Aurora do — a distinct identity for tools too, but it breaks tools that match on `ID` and needs the workarounds those images carry.
- **Keeping Fedora's name and splash** — no work, but the system would not say what it is, and bug reports would point at Fedora.

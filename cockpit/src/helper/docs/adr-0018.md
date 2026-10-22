# 0018. Retire the Hyprland variant

- **Status:** Accepted; amends [0010](0010-image-variants-and-system-identity.md) and [0011](0011-release-channels-and-iso-distribution.md)
- **Date:** 2026-10-18

## Context

[0010](0010-image-variants-and-system-identity.md) added `ghcr.io/agentux-os/agentux-hyprland` for people who want a keyboard-driven tiling desktop: Kinoite with a Hyprland session on top. Since then:

- AgentUX gained a COSMIC image, `ghcr.io/agentux-os/agentux-cosmic`, on Fedora COSMIC Atomic. COSMIC is a lighter desktop with tiling built in, and it is where the project is heading for that audience.
- The Hyprland image was the heaviest of the three (it carries the whole KDE stack and a second desktop), its desktop came from a third-party COPR rather than Fedora, and it doubled every release: two more images to promote, four more ISOs to build and test, and its own live session to check. Two release candidates in a row (v0.5.7 and v0.5.8) failed on the Hyprland live tests.
- Its users get the same AgentUX from the Plasma image; nothing in the cockpit, the agents or the daemon depends on Hyprland.

## Decision

- **v0.5.9 is the last release with the Hyprland variant.** From then on `agentux-os` builds two images, Plasma (`ghcr.io/agentux-os/agentux`, stable and nightly) and COSMIC (`ghcr.io/agentux-os/agentux-cosmic`, nightly until its launch gates pass), and releases Plasma ISOs only.
- **Nothing published is deleted.** The last `agentux-hyprland` images stay in the registry, signed, and the v0.5.9 Hyprland ISOs stay in `iso/v0.5.9/`; they leave `iso/stable/`, which holds the newest release only.
- **The signature requirement stays.** Every AgentUX image keeps requiring the AgentUX key for `ghcr.io/agentux-os/agentux-hyprland` in `/etc/containers/policy.json`, so a `bootc switch` to those images can never take an unsigned one.
- **Hyprland systems move to Plasma** with `sudo bootc switch ghcr.io/agentux-os/agentux:stable`; their home directory and settings are kept. `releases.json` keeps listing Hyprland for v0.5.9 and older, so they can still name their version until they switch.

## Consequences

- One stable image to build, promote, boot-test and document; a release builds four ISOs instead of eight, and no release depends on a COPR.
- People who want tiling lose the ready-made Hyprland layout until COSMIC is stable; they can use COSMIC's nightly image, or Plasma.
- A system left on `agentux-hyprland:stable` keeps working but gets no further updates, and nothing tells it so on the system itself: the move is documented in the READMEs and release notes.

## Alternatives considered

- **Keep Hyprland as a nightly-only variant** — less release work, but the build, the COPR and the tests would remain, for an image nobody promotes.
- **Rebuild Hyprland on the COSMIC or a minimal base** — one desktop per image, but it is a new variant to build and test, while COSMIC already covers tiling.
- **Delete the published Hyprland images** — a clean registry, but it would break `bootc rollback` and `bootc switch` for the systems still on them.

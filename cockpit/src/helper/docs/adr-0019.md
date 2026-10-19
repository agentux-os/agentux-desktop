# 0019. Updates without reinstalling: small, automatic image patches, and Flatpak for new apps

- **Status:** Accepted; amends [0011](0011-release-channels-and-iso-distribution.md)
- **Date:** 2026-10-19

## Context

An installed AgentUX system already updates without a new ISO: it follows a signed image tag (`:stable` by default), and `bootc upgrade` stages the new image for the next boot, with the previous one kept for rollback. The ISO is only for new installs.

What is missing is the path from a fix to a system that already runs AgentUX:

- **Every fix waits for a full image release.** A fix in `agentux-core` or `agentux-desktop` ships as a new RPM release, then needs a bump PR in `agentux-os`, a tag, the release tests and the approval of [0011](0011-release-channels-and-iso-distribution.md). Each step is manual, so small fixes wait for the next big release.
- **An update downloads more than the fix.** The AgentUX RPMs are installed midway through the `Containerfile`. Every layer after them (configuration files, wallpapers, the initramfs with the Plymouth theme) is rebuilt when they change, so a one-line fix to `agentuxd` changes much of the image.
- **Nothing updates on its own.** `agentux-releases.timer` fetches the list of releases; nothing stages a new image, and nothing tells the user one is waiting.
- **Every new app would grow the image.** Apps we write next (and the vendor tools around them) would each need an image release to ship and to update.

## Decision

**System packages keep shipping in the image, as small, automatic patch releases.**

- **Patch releases are automated up to the approval.** A release of `agentux-core` or `agentux-desktop` opens the bump PR in `agentux-os`, which merges once its CI is green. A patch tag (`v0.6.1`, `v0.6.2`, …) then runs the same release tests as any other release. The approval gate of [0011](0011-release-channels-and-iso-distribution.md) stays; only the steps before it are automated.
- **AgentUX's packages go in the last layers, and the image is rechunked.** Content that changes on every release (the AgentUX RPMs and their configuration) moves after the content that rarely changes (base packages, wallpapers, the boot theme), and the published image is split into content-based chunks. A patch release then changes only the chunks it touches, and an update downloads only those.
- **Installed systems stage updates in the background and never reboot on their own.** A timer runs `bootc upgrade` without applying it. When a new image is staged, the cockpit and a desktop notification say so. The system boots it on the next reboot, at a time the user chooses. Turning the timer off brings back fully manual updates.

**New apps that do not need the host ship as Flatpaks from an AgentUX Flatpak repository.**

- The repository is static and signed. It is published next to the ISOs, under `download.agentuxos.org`, and every image ships with it configured. Plasma's Discover and the COSMIC Store list its apps and update them on their own schedule, with no image release.
- An app stays in the image when it needs the host: the daemon, `aux`, the cockpit (it talks to `agentuxd` over a host socket), and anything that runs as a system service.
- Command-line tools for the user's own work install in the home directory, as [0013](0013-first-run-wizard.md) does for the vendor CLIs, and update on their own.

## Consequences

- A fix reaches installed systems within hours of its component release, as a small download, after the same tests and the same approval as every release.
- Patch releases become frequent, so the release notes, `releases.json` and the download page have to cope with many small versions.
- Rechunking and the new layer order change how the image is built; the first release with them downloads in full once.
- Background staging uses bandwidth and disk on installed systems without asking. Turning the timer off is documented, and the download stays small.
- A Flatpak repository is one more thing to build, sign and host. Its apps run sandboxed, which suits new apps but rules out the ones listed above.

## Alternatives considered

- **Layer RPMs on installed systems (`rpm-ostree install` or a dnf repository)** — fixes would ship without an image release, but every system would carry its own package set on top of the image. That breaks the image as the single tested state, makes each upgrade slower, and can conflict with the next image.
- **systemd system extensions (sysext) for `agentuxd` and `aux`** — they would update the daemon without an image release, but sysext under bootc is still young. Each extension also has to match the image it runs on, which means a second release train to test. Worth revisiting once bootc supports it fully.
- **A self-updater inside the cockpit or `agentuxd`** — fast, but it writes to a read-only `/usr`, or splits the system between the image and the home directory. It also skips the release tests.
- **Leave it as it is** — an image release per fix, done by hand. Fixes would keep waiting for the next big release.

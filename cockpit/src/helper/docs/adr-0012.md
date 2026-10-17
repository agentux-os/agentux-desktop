# 0012. System version, release identity and the branded installer

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

[0010](0010-image-variants-and-system-identity.md) renamed the system AgentUX in os-release but kept Fedora's release in what people read: `PRETTY_NAME` was `AgentUX <YYYYMMDD> (Fedora Linux 44 base)`. The owner's first VirtualBox test of the release ISOs reported two things:

- The installed system "was at Fedora's version 44, not at the releases we are shipping". The boot menu entries (`AgentUX 20261015 (Fedora Linux 44 base) (ostree:0)`), the live installer's title bar, `hostnamectl` and KDE's About page all showed Fedora's 44. None of them named the AgentUX release (v0.5.x).
- The offline installer ISO "still showed the Fedora name and logo". bootc-image-builder's `anaconda-iso` builds its installer environment from Fedora's packages:
  - Anaconda shows Fedora's logo and blue;
  - the boot menu says "Install AgentUX 44" (os-release `NAME` and Fedora's `VERSION_ID`);
  - the volume is labelled `Fedora-S-dvd-x86_64-44`;
  - the UEFI boot entry an install creates is called "Fedora".

  Its configuration has no setting for a logo, a product name or a theme. The live ISO's installer was already branded through Cockpit's branding.

The version has a constraint of its own. Since [0011](0011-release-channels-and-iso-distribution.md), a release builds nothing. `release.yml` promotes the digest that `main` built for the tagged commit (`sha-<commit>`) to `:<tag>` and `:stable`. The image is built, tested and signed before the release exists, so no file in it can contain the release's name. Rebuilding it to stamp one would ship something other than what was tested and signed.

This amends the os-release decision of [0010](0010-image-variants-and-system-identity.md) and the installer ISO of [0011](0011-release-channels-and-iso-distribution.md).

## Decision

- **The image carries its build.** `build.yml` passes `AGENTUX_VERSION=<YYYY.MM.DD>.<short commit>` (e.g. `2026.10.15.063578e`) and the full commit:
  - `IMAGE_VERSION` and `BUILD_ID` are that string, and so is the image's `org.opencontainers.image.version` label. The `.revision` label is the commit.
  - `VERSION` is the date, and `PRETTY_NAME` is `AgentUX <date>`. These are what the boot menu, the installers' title bars, `hostnamectl` and KDE's About page show.
  - `HOME_URL` is https://agentuxos.org, `DOCUMENTATION_URL` is the agentux README, and `SUPPORT_URL` and `BUG_REPORT_URL` point at the GitHub issues.
  - `/etc/system-release` becomes `AgentUX release <date>` (in Fedora it is a link to `fedora-release`). bootupd names the firmware boot entry after this file, and liveinst takes the installer's product name from it.
  - `ID`, `VERSION_ID`, `CPE_NAME` and `SUPPORT_END` stay Fedora's, for the reasons in [0010](0010-image-variants-and-system-identity.md). People see Fedora's release only where it is labelled as the base ("Based on: Fedora Linux 44 (Kinoite)").
- **The release and channel are read from the booted image at run time.** `agentux-version` reports them, and `agentux-version --json` gives the same to tools such as `aux` and the cockpit:
  - the booted image reference and digest come from `bootc status` (as root) or `rpm-ostree status` (as any user);
  - the channel comes from the reference's tag: `:stable`, `:latest` (nightly), or a pin;
  - the release is the tag itself for a `:v*` reference. Otherwise `agentux-version` looks the booted digest up in `https://download.agentuxos.org/releases.json`.
- **`releases.json` maps digests back to releases.** Each approved release regenerates it from the registry's `v*` tags, so releases from before this decision are listed too. It is signed with the AgentUX key, like `latest.json`. For every tag it lists:
  - both variants' manifest-list digests;
  - each architecture's image digest;
  - the image version.

  `agentux-releases.timer` fetches it into `/var/cache/agentux/`, two minutes after boot and then daily. A failed fetch keeps the cached list and is not an error. The list only names things: bootc and the image signatures still decide what is installed and updated.
- **KDE's About page** shows the AgentUX logo, agentuxos.org and `AgentUX <date>`. Two scripts listed in `ExtraSoftwareData` (in `kcm-about-distrorc`) add two more lines: "Release" (from `agentux-version`) and "Based on".
- **The offline installer is branded with Anaconda's product image.** After bootc-image-builder runs, `installer/brand-iso.sh` rewrites the ISO:
  - it adds `images/product.img`, which Anaconda's initramfs unpacks over the installer environment before Anaconda starts. The product image holds:
    - AgentUX's stylesheet and art, in place of the files Fedora's profile loads (`fedora.css` and its pixmaps);
    - a `.buildstamp` that names the product `AgentUX <release>` (or `nightly`);
  - it relabels the volume `AgentUX-<release>-<arch>` and renames the boot menu entries, both on the ISO and in its EFI boot image;
  - it keeps the boot records (`xorriso -boot_image any replay`) and implants the media-check checksum again.

  The payload and the kickstart are untouched, so the ISO still installs the signed image offline and switches the system to its channel.
- **The installer ISO test checks the branding.** It checks the volume label, the boot menu and the product image. It then boots the ISO through the firmware and GRUB, and fails if the screendump of the installer shows Fedora's blue instead of AgentUX's Ink and Lime.

## Consequences

- People see one AgentUX version everywhere, and it matches what they run: two systems that say `2026.10.15.063578e` run the same build. The release name (v0.5.3) is one step away, in `agentux-version` and on the About page, not in the boot menu or `hostnamectl`.
- Two builds of the same commit on the same day share a version. The digest tells them apart, and `agentux-version` shows it.
- A system that follows `:stable` can name its release only after it has fetched `releases.json` once. Until then an offline system says "stable channel, build …". A system that pins a `:v*` tag names its release offline. `agentux-releases.timer` makes one anonymous request a day to download.agentuxos.org, and users may disable it.
- Anything that reads `/etc/system-release` now sees AgentUX. `/etc/fedora-release`, `/etc/redhat-release` and the RPM provides that dnf uses for `$releasever` stay Fedora's.
- The offline installer keeps Fedora's installer environment (packages, text, help) under AgentUX's look and name. The product image overrides files by path. If a Fedora release renames Anaconda's style hooks or pixmaps, Fedora's look comes back; the screendump check in the installer test catches that before anything is published.
- The installer ISO is rewritten after bootc-image-builder, so its boot records are xorriso's replay of the ones bootc-image-builder wrote. The test boots it through the firmware and the ISO's own GRUB on x86_64 UEFI only. BIOS boot and aarch64 are not boot-tested.

## Alternatives considered

- **Stamp the release into the image at release time** (rebuild on the tag, or add a layer that names it). The image would carry its release, but the release would no longer be the digest that was tested and signed on `main` ([0011](0011-release-channels-and-iso-distribution.md)).
- **Name releases after the build** (use the image version as the release number). This is accurate and works offline, but releases would lose their semantic versions, which the downloads, the GitHub releases and `latest.json` already use.
- **Keep `(Fedora Linux 44 base)` in `PRETTY_NAME`.** It states the base everywhere, but people read the 44 as the system's version, which is what the owner reported.
- **image-builder's `bootc-installer` type.** The ISO's installer environment would be a container we build (AgentUX with Anaconda and our branding), with the payload embedded from container storage. This is the intended long-term shape, but the type is new. image-builder documents it as the type that "makes more assumptions" and recommends `bootc-generic-iso` instead. It also defaults to Anaconda's text mode, and it would mean maintaining a second image with Anaconda in it.
- **A Titanoboa installer like Bazzite's.** This is a live environment with the payload in its container storage, which installs with `ostreecontainer --transport=containers-storage`. Our live ISO is the same thing without the embedded payload. Embedding the payload would roughly double the ISO, to about 8 GB per architecture. Worth revisiting if the live ISO should become the only download.
- **Drop the offline installer and ship only the live ISO.** This was the fallback if branding had failed. The live ISO needs a network connection to install.

# 0011. Release channels, ISO distribution and the release gate

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Since [0008](0008-releases-and-image-pinning.md), `agentux-os` rebuilds the image from `main` every day and moves `ghcr.io/agentux-os/agentux:latest` to it; [0010](0010-image-variants-and-system-identity.md) added the Hyprland image, two architectures, and signatures that installed systems enforce. Every installed system follows `:latest`, so every system gets every nightly build: a Fedora update or a merge that breaks something reaches all users the next morning. There was no release, nothing a user could choose as "the tested one", and no way to say which build an ISO came from.

The ISOs (an Anaconda installer from bootc-image-builder, about 4.7 GB, and a Titanoboa live ISO, about 3.7 GB, per architecture) also needed a home. GitHub release assets are limited to 2 GiB per file, so neither fits. The installer ISO was published without ever being booted; only the live ISO was boot- and install-tested.

Publishing also needed a gate. Everything ran with repository secrets on any trigger: a tag published ISOs and a release as soon as its jobs finished, with nobody looking.

This amends [0008](0008-releases-and-image-pinning.md), where `main`'s daily `:latest` and dated tags were the only published images, and [0010](0010-image-variants-and-system-identity.md), whose signing and policy it builds on and whose trust model it states for two channels.

## Decision

- **Two channels per image repository** (both variants, both architectures):
  - `:latest` stays the **nightly** (testing) channel, moved by `build.yml` from `main` every day and on every merge. `:<YYYYMMDD>` keeps each nightly build.
  - `:stable` is the **release** channel. It moves only when a `v*` tag is released, and `:v<version>` names each release for good.
  - A promotion is a retag of the signed digest: the manifest list is copied with its digest preserved, so its cosign signatures (stored by digest) cover the new tags. Both signatures are verified again on the new tags and on each architecture's image.
- **Which channel a system follows:**
  - Systems installed from a release ISO follow `:stable`. Systems installed from a nightly ISO, and every system installed before this decision, follow `:latest`; nothing moves them.
  - `bootc switch ghcr.io/agentux-os/agentux:stable` (or `:latest`) changes channel at any time.
  - The installer ISO embeds the release's digest, tagged as `:stable` for bootc-image-builder, which names it in the installed system's origin.
  - The live ISO pulls the release's digest from the registry (so it installs exactly what was tested and released) and then switches the origin to `:stable`.
  - Until the first release there is no `:stable`, so ISO builds asked for it fall back to `:latest` with a warning.
- **A release is a tag of a commit on `main`, built and tested before anyone approves it.** `release.yml` runs these steps:
  1. It calls `build.yml`, which builds both images on both architectures, smoke-tests them, signs them, checks them against the shipped policy, and pushes them as `candidate-<tag>`.
  2. It checks that the tag is on `main` and resolves the candidate digests once.
  3. It builds the installer and live ISOs from those digests. The x86_64 ISOs are installed in VMs and the installed systems checked.
  4. The single `release` job runs in the `release` GitHub environment, which only `v*` tags can use and which requires the repository owner's approval. On approval it promotes `:<tag>` and `:stable` for both images, publishes the ISOs, writes the checksums and `latest.json`, and creates the GitHub release (a pre-release while AgentUX is 0.x).
  5. Rejecting the approval, or letting it lapse, publishes nothing.
- **ISOs are hosted on Cloudflare R2** (bucket `agentux-downloads`), served at `https://download.agentuxos.org`:
  - `iso/stable/` holds the newest release under fixed names (`agentux-live-x86_64.iso`).
  - `iso/v<version>/` keeps every release.
  - `iso/nightly/` holds the newest weekly build (or a run dispatched from `main`), replaced each time.
  - GitHub releases carry the checksums, their signatures and links to the ISOs.
- **Checksums and a manifest:**
  - Every ISO has a `.sha256` and a cosign bundle (`.sha256.sigstore.json`) signed with the AgentUX key.
  - Every directory has a combined `SHA256SUMS` with its own bundle. It is rebuilt from the bucket's `.sha256` files after every upload, because a directory's ISOs come from separate jobs and workflows.
  - `latest.json` at the root (signed too) describes the newest release for the website: version, date, image references and digests, and per ISO its name, URL, size, SHA-256, architecture, kind (`live` or `installer`), variant, channel and whether CI boot-tested it. It is written last, when the stable channel moves.
- **Both ISOs are tested before they are published.**
  - The live ISO was already booted and installed from its live session.
  - The installer ISO is now installed unattended: the ISO's own kernel, initrd, command line and kickstart, with only the UI's answers added and GRUB's interactive menu bypassed by a direct kernel boot. The installed disk is then booted and checked over SSH: it follows the ISO's channel from the registry, the signature policy requires the AgentUX key, and no units failed.
  - A failure in either test stops publishing.
  - Its first run found that every Anaconda install (installer and live ISO) started degraded: Anaconda writes the btrfs root into `/etc/fstab`, and `systemd-remount-fs` cannot apply its options to the composefs root. Both kickstarts now comment that entry out, as bootc's own installer writes none.
  - aarch64 ISOs are built but not booted, since GitHub's arm64 runners have no KVM, and the release notes and `latest.json` say so.
- **Signing and secrets:**
  - One AgentUX key keeps signing every image, nightly and release, as a repository secret.
  - The R2 credentials belong in two environments rather than the repository: `release` (approved `v*` tags) and `nightly` (`main` only, no reviewers, used by the weekly ISO publishing).

## Consequences

- Users choose between tested releases and daily builds, and a broken nightly no longer reaches systems on `:stable`. Releases are reproducible references: `:v<version>` and the ISOs in `iso/v<version>/` never move, and a release ISO installs exactly the digest that was tested and approved.
- **The approval gates what the stable channel and the downloads point at, not what the key can sign.**
  - Installed systems' policy checks signatures per repository and by digest (cosign signs digests, not tags), so a system on `:stable` accepts any digest in the repository signed with the AgentUX key, nightly ones included.
  - The nightly channel must stay keyed-signed, because every system installed so far follows `:latest`. So the key cannot move behind the approval, and it stays a repository secret available to any workflow run by someone with write access, from any branch.
  - A leaked key, or a malicious workflow on a branch, could therefore produce an image that every installed system accepts if it were pushed to a tag the system follows.
  - The gate protects against releasing by accident and against an unreviewed tag. It does not protect against a compromised writer. The key is the root of trust for both channels.
- Moving the R2 credentials into the environments means a branch's workflow can no longer write to download.agentuxos.org. The cost is that the weekly nightly ISOs can be published only from `main`, and the owner has to put the secrets into both environments and remove the repository-level copies; the workflows read the repository secrets until then.
- A release costs one approval, after all its tests. It must happen within 14 days, the ISO artifacts' retention; after that the run has to be repeated.
- The release ISOs are built from the Plasma image only; Hyprland ISOs stay a manual dispatch. Both images are promoted.
- Nightly ISOs are not kept: `iso/nightly/` holds only the newest of each, so R2 storage grows only with releases.
- Bandwidth is not a cost driver. R2 has no egress fees, so ISO downloads cost only storage, and updates of installed systems come from ghcr.io, not from the bucket.
- If another site fetches `latest.json` from the browser, the bucket needs a CORS rule for that site.

### Deferred

- **A separate release key**, held only in the `release` environment and required only for `:stable` (containers-policy.json can scope a requirement to `repository:tag`). This would make the approval cryptographic for systems on `:stable`, but every installed system must first receive the new policy and key through an update signed with the current key.
- **The image key in an environment limited to `main` and `v*` tags** (no reviewers, so nightly signing keeps working). This would end keyed signing of branch test builds (`gh workflow run build.yml --ref <branch>`).
- **SBOMs** for the images (and attestations of them). Useful for vulnerability tracking, but nothing consumes them yet.
- **BitTorrent and mirrors.** R2 serves the ISOs without egress cost and ghcr.io serves updates, so neither cost nor capacity calls for them yet.

## Alternatives considered

- **GitHub Releases for the ISOs**: no extra service, but release assets are capped at 2 GiB per file and every ISO is larger. Splitting ISOs into parts would make every download a reassembly.
- **ghcr.io as an OCI artifact store for the ISOs** (ORAS): no new service, but browsers and `curl` cannot download from it directly, which the website's buttons need.
- **Releasing by retagging a nightly digest** instead of building the tag: one build fewer, but the ISOs, tests and approval would all refer to a build of some other commit. Building the tagged commit keeps tag, image and ISOs the same thing.
- **Approval before the builds** (gate the whole run): the owner would approve without the test results. Approving last means approving what passed.
- **One approval per publishing job** (promotion, each ISO workflow): several approvals per release for the same decision; a single gated job after everything does it once.
- **Leaving `:latest` as the only channel** and pinning releases by date tag: no work, but users would have to pick tags by hand and nothing would ever say "this one is the release".

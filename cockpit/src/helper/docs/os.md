## Release channels

Each image repository has two channels, and an installed system follows exactly one of them:

| Tag | Channel | Moves |
|---|---|---|
| `:stable` | **Stable**: the newest release | When the owner approves a `v*` tag, to that tag's image |
| `:v<version>` (e.g. `:v0.5.5`) | One release | Never: set once, when its release is approved |
| `:latest` | **Nightly** (testing): `main`, rebuilt daily for Fedora's updates | Every day, and on every merge to `main` |
| `:<YYYYMMDD>` | One nightly build | Never |

Stable and nightly channels exist for Plasma and Hyprland. COSMIC is nightly-only (`:latest`) and receives no `:stable` promotion until its launch gates pass. All three repositories are multi-arch and require the same AgentUX image signature ([Verifying the image](#verifying-the-image)).

**Which channel a system follows** is the image reference in its origin, shown by `sudo bootc status`, and `bootc upgrade` pulls whatever that tag points at:

- Systems installed from a **release ISO** (`iso/stable/` or `iso/v<version>/` on download.agentuxos.org, or the links in a GitHub release) follow `:stable`.
- Systems installed from a **nightly ISO** (`iso/nightly/`), and every system installed before the channels existed (all installs so far), follow `:latest`. Nothing moves them: they stay on the nightly channel until you switch.

Switch channels at any time, either way:

```sh
sudo bootc switch ghcr.io/agentux-os/agentux:stable   # releases only
sudo bootc switch ghcr.io/agentux-os/agentux:latest   # nightly builds
systemctl reboot
```

(`agentux-hyprland` for the Hyprland variant.) Going from `:latest` to `:stable` usually moves to an older image, since a release is a nightly build from some days or weeks earlier; that is fine on an image-based system, and `sudo bootc rollback` returns to the previous deployment. Until the first release is approved there is no `:stable` (`bootc switch` to it fails with "manifest unknown"), so stay on `:latest` until then; the ISO workflows fall back to `:latest` too if asked for `:stable` before it exists.

### How a release reaches `:stable`

Pushing a `v*` tag of a commit on `main` runs [`release.yml`](.github/workflows/release.yml):

Build once, promote: a release builds no image. It ships the digest that `main` already built, smoke-tested, signed and published for the tagged commit, so `:stable` is exactly what was tested, not a rebuild that would pull newer Fedora packages.

1. **Candidate.** The tag must be on `main`, and `main` must have published `sha-<commit>` for it: [`build.yml`](.github/workflows/build.yml) tags every `main` build `sha-<first 12 hex of the commit>` (with the dated tag and `:latest`) only after the smoke tests passed and the signatures were checked against the shipped policy. Both images are resolved once to their digests, and their AgentUX-key and keyless signatures (from `build.yml` on `main`) are checked. Tag a commit whose `Build image` run on `main` has finished; the nightly rebuild of an unchanged `main` moves `sha-<commit>` to the newer build of that commit.
2. **Boot test.** That Plasma digest is installed to a disk and booted in QEMU/KVM ([`boot.yml`](.github/workflows/boot.yml), called by `release.yml`), and `tests/boot.sh` runs on it.
3. **ISOs.** The installer and live ISOs (Plasma, x86_64 and aarch64) are built from the same digest and set up to follow `:stable`; the x86_64 ones are installed in a VM. ISOs are only built by releases and the weekly ISO runs. A release ISO installs that digest itself (not whatever a tag points at by then), so it installs exactly what was tested and released, and the installed system then follows `:stable`.
4. **Approval.** The `release` job waits in the `release` [environment](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment), which only `v*` tags can use and which needs the repository owner's approval. Approving it is the last step, after every test of the tag passed. Rejecting it, or letting it time out, publishes nothing. Approve within 14 days: the release job publishes the ISO artifacts the run built and tested, which expire then (re-run the workflow after that).
5. **Promotion and publishing.** On approval, `:<tag>` and `:stable` of both images are pointed at the candidate digests ([`.github/scripts/promote.sh`](.github/scripts/promote.sh): a copy of the signed manifest list with its digest preserved, so the signatures, which are stored by digest, carry over; the key and keyless signatures are verified again on the new tags and on each architecture's image). Then the ISOs go to `iso/<tag>/` and `iso/stable/` on download.agentuxos.org, and the GitHub release is created.

To cut and approve a release from a terminal (Git Bash on Windows works too; needs `gh` logged in as the owner):

```sh
scripts/release.sh 0.5.2   # checks main's sha-<commit> images exist, shows the changes, pushes v0.5.2
scripts/approve.sh         # after the tests pass: shows the waiting run, asks, approves it
```

(`just release 0.5.2` and `just approve` run the same.) A version is never re-tagged: if a release run fails, fix it on `main` and tag the next patch version.

### Signing and approval: what the gate does and does not do

One AgentUX key signs every image, nightly or release, and installed systems' policy accepts any image in the AgentUX repositories signed with it, whatever its tag: `containers/image` checks signatures per repository and by digest, and cosign signs digests, not tags. The nightly channel must stay signed with that key (every installed system so far follows `:latest` and refuses anything else), so the key cannot move behind the approval: build.yml signs every build of `main` with it, and stays a repository secret (`COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`).

So the approval gates **what the stable channel and the downloads point at**, not what the key can sign:

- Nothing reaches `:stable`, `:v<version>`, `iso/stable/`, `iso/v<version>/` or a GitHub release without the owner approving that tag's run, after its tests; a tag that is not on `main` fails before that.
- Writing to download.agentuxos.org needs the R2 credentials, which belong in the environments, not the repository: the `release` environment (approved `v*` tags) for releases and the `nightly` environment (only `main`, no approval) for the weekly ISOs, so a workflow run from any other branch cannot write to the bucket.
- Anyone who can run a workflow with the repository secrets (a collaborator with write access, from any branch) can still have an image signed with the key, and every installed system, on either channel, would accept that image if it were pushed to a tag the system follows. The key is the root of trust for both channels; protecting it is protecting all of them. Pull requests from forks get no secrets, so the key is as safe as the set of people and tokens with write access to this repository.

Two stronger options were left for later, since each needs every installed system to take a new policy first: a separate **release key**, required only for `:stable` (containers-policy.json can scope a requirement to `repository:tag`), held only in the `release` environment; or the image key itself moved into an environment limited to `main` and `v*` tags (no reviewers, so nightly signing keeps working), which would end keyed signing of branch test builds (`gh workflow run build.yml --ref <branch>`).

### Version

A release does not rebuild the image: it promotes main's already-built, tested image to `:<tag>` and `:stable` ([Release channels](#release-channels)). So the image can carry its build (the date and commit above), but not the release it later became. Which release a system runs is worked out at run time, by `agentux-version`:

```console
$ agentux-version
AgentUX 2026.10.15 (Plasma)
  Release:   v0.5.3 (stable channel)
  Image:     ghcr.io/agentux-os/agentux:stable
  Digest:    sha256:…
  Build:     2026.10.15.063578e (commit 063578e…)
  Based on:  Fedora Linux 44 (Kinoite)
```

- **Image and channel:** the booted image reference and digest, from `bootc status` (as root) or `rpm-ostree status` (as anyone). The tag is the channel: `:stable`, `:latest` (nightly), or a pin such as `:v0.5.3`.
- **Release:** a `:v*` reference names it. Otherwise the booted digest is looked up in `https://download.agentuxos.org/releases.json`, which every release regenerates from the registry's `v*` tags (each tag with its list digest, both architectures' digests and the image version, signed like `latest.json`). `agentux-releases.timer` fetches it two minutes after boot and daily, into `/var/cache/agentux/releases.json`; offline, the cached list stays. It is one anonymous GET of a public file; `systemctl disable --now agentux-releases.timer` turns it off. The list only names things: bootc and the image signatures decide what is installed and updated.
- `agentux-version --json` gives the same for tools (the cockpit, `aux`); KDE's About page shows the Release line through `/usr/libexec/agentux/about-release`.

## AgentUX versions

The AgentUX components are installed from their GitHub releases, pinned in one place, the `ARG`s at the top of the AgentUX section of the [`Containerfile`](Containerfile). The architecture-specific `agentux-cockpit` RPM remains independent of desktop configuration. Three architecture-independent bundles provide common integration and the selected desktop's settings.

| Pin | What it selects |
|---|---|
| `AGENTUX_CORE_VERSION` | `agentux-<version>-1.fc44.<arch>.rpm` from agentux-core's `v<version>` release |
| `AGENTUX_DESKTOP_VERSION` | `agentux-cockpit-<version>-1.<arch>.rpm` plus the three bundle archives from agentux-desktop's `v<version>` release |
| `AGENTUX_COMMON_SHA256` | SHA-256 pin for `agentux-desktop-common-<version>.tar.gz` |
| `AGENTUX_PLASMA_SHA256` | SHA-256 pin for `agentux-desktop-plasma-<version>.tar.gz` |
| `AGENTUX_COSMIC_SHA256` | SHA-256 pin for `agentux-desktop-cosmic-<version>.tar.gz` |

`<arch>` is the build's `uname -m`, `x86_64` or `aarch64`; any other architecture fails the build. Each variant installs the common archive first, verifies it against its pinned SHA-256, and extracts exactly one desktop bundle: Plasma for the Plasma and Hyprland images, COSMIC for the COSMIC image. The archives contain only `usr/` and `etc/`; configuration is baked into the immutable image rather than layered as runtime RPMs. `just bump-agentux` (needs an authenticated `gh`) checks both architecture RPMs and all three archives plus their checksum sidecars before updating any pin, and leaves `Containerfile` unchanged if a required release asset is missing or malformed. If a release ever changes the RPM's release number or Fedora tag (`-1.fc44`), update the file name in the `Containerfile` by hand.

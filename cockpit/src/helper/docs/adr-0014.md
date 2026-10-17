# 0014. Installation profiles and optional platform services

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

AgentUX OS is a signed bootc image. The current image contains the local
AgentUX node (agentuxd, `aux`, ACP integration and the desktop cockpit), while
the first-login flow installs per-user tools that change faster than the
image. The product suite now also has server-side capabilities: AgentUX
Command coordinates remote nodes and AgentUX Office presents the operational
state to leadership.

Installing every server dependency on every workstation would make the OS
larger, increase the attack surface and blur the boundary between a local node
and a platform server. Conversely, making a separate OS image for every role
would multiply signing, testing and release work.

The installation flow therefore needs to answer a product question — “How will
this computer participate in AgentUX?” — without turning the immutable base
image into a mutable package distribution.

## Decision

### One signed base image, selectable profiles

AgentUX OS keeps one signed base image per desktop variant and architecture.
The installer records an initial profile selection, and the first-boot setup
applies it idempotently. The installer must not build a different OS image for
each profile.

The profile catalog is shipped as read-only data at
`/usr/share/agentux/profiles/catalog.json`. The selected and applied state is
mutable and lives at `/var/lib/agentux/profile.json`, so an image update does
not erase the computer's role.

The initial catalog is:

| Profile | Intended computer | Enabled capabilities |
|---|---|---|
| `workstation` | Human's AgentUX workstation | `node` + `desktop` |
| `node` | Headless or remote execution machine | `node` + node gateway/registration |
| `command` | Organization control-plane server | `command-server` and its platform services |
| `executive` | Screen or browser used by leadership | `office-client` only; no local platform stack |
| `complete` | Development/demo installation | `workstation` + `command-server` + `office-client` |
| `custom` | Advanced installation | Explicit component selection with dependency validation |

`node` is the essential local capability. `desktop` includes the Tauri
desktop/cockpit integration. `command-server` and `office-client` are
optional platform capabilities; Office is primarily a web experience and does
not imply a local database or orchestration runtime.

### Split installation intent from activation

The Anaconda/bootc installer presents the profile choice and writes an
installation-intent seed into the target system. It does not download
third-party tools or start the platform stack while the disk is being laid
out. On first boot, the existing AgentUX setup/welcome flow reads the seed,
shows the resolved components and applies them after the user confirms.

This keeps offline installation possible and gives the user a recoverable,
visible operation with progress, logs and retry. Re-running setup with the
same profile is safe.

The profile lifecycle is exposed through a small system-level interface:

```text
agentux profile show
agentux profile plan <profile>
agentux profile apply <profile>
agentux profile remove <optional-capability>
```

The CLI reports the requested, applied, pending and failed components as JSON
for the cockpit. Profile changes after installation are supported; removing
`node` is rejected while a local desktop or remote registration depends on
it. A profile change never removes user data or running organization history
without an explicit destructive action.

### Server dependencies are containers, not OS packages

The `command-server` capability runs PostgreSQL, Temporal, NATS, object
storage and related services through Podman Quadlet units. They are not
installed with `dnf`, layered with rpm-ostree or copied into `/usr`.

The command stack has a dedicated data and configuration boundary under
`/var/lib/agentux/command` and a systemd lifecycle. Secrets are supplied by
the operator through the platform configuration flow and are never embedded
in the image or the profile catalog. The initial implementation must define
health checks, backup/restore hooks and a clear upgrade policy before the
`command` profile is considered production-ready.

The base image may ship the profile manager, Podman/Quadlet integration and
the signed metadata needed to activate a capability. It must not start
Command services on profiles that do not select `command-server`.

### Repository and product boundaries

- `agentux-os` owns the base image, installer intent, profile catalog and
  activation plumbing.
- `agentux-core` owns the local execution node and remains required by the
  `node` capability.
- `agentux-command` owns the remote control plane and its server-side
  orchestration.
- `agentux-protocol` owns the versioned Command-to-node contract.
- `agentux-apps` owns web surfaces; AgentUX Office is an experience in this
  product, not a second server runtime.
- `agentux-desktop` owns the local cockpit and the setup UI that presents
  profile progress.

The conceptual ideas from the former Organa project inform the Command and
Office boundaries, but the OS does not depend on an external Organa repository
or name.

## Consequences

- A workstation installs only the local node and desktop experience; it does
  not pay the operational cost of a platform server.
- A remote node can be provisioned from the same signed OS and later registered
  with Command without changing the base image.
- A Command server can be installed reproducibly on AgentUX OS while its data
  and service lifecycle remain explicit and containerized.
- Profile changes are possible after installation, but they require careful
  idempotency, service ordering and migration tests.
- The installer and first-boot setup gain a new shared contract: profile
  catalog, intent seed and applied-state schema must stay versioned.
- The `command` and `complete` profiles need stronger resource guidance than
  `workstation` and `node`; the UI must show storage, memory and network
  expectations before activation.

## Alternatives considered

- **A separate OS image for every role** — makes role selection simple but
  multiplies release, signing and boot-test matrices.
- **Install all server services in the base image** — wastes resources on
  workstations and expands the trusted computing base.
- **Layer PostgreSQL/Temporal/NATS with rpm-ostree** — conflicts with the
  immutable-image model and couples platform upgrades to OS deployments.
- **Install the server stack directly on the host filesystem** — makes
  rollback, backups and dependency isolation harder than Quadlet-managed
  containers.
- **Only configure profiles after installation** — keeps the ISO simple but
  hides the most important product choice and makes unattended provisioning
  less predictable.

# 0009. Optional container isolation for check commands

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Gate steps ([0005](0005-agentux-yaml.md)) run the project's checks with `sh -c` in the run's worktree, as the user running `agentuxd`. Those commands execute code an agent has just written: tests, build scripts, lint plugins. On the host they can read the user's home directory (SSH keys, harness logins, `gh` tokens), reach the network, and leave processes running. Checks also had no time limit, and cancelling a run killed only `sh`, so whatever a check started outlived it.

The image already ships rootless Podman ([0001](0001-linux-distribution-on-fedora-atomic.md)), and many projects already describe their toolchain as a dev container. Agents themselves cannot move into a container yet: harness CLIs need the user's logins, and ACP sessions run on the host ([0002](0002-harness-integration-via-acp.md)). Checks can, because they need nothing but the worktree and a toolchain.

## Decision

`agentux.yaml` gets an optional top-level `isolation` key, and each check an optional `timeout`. This amends [0005](0005-agentux-yaml.md) without a new `version`: files without the keys behave as before.

```yaml
isolation:
  mode: podman        # none (default) | podman
  image: ghcr.io/example/toolchain:1   # optional
  network: false      # optional; default false

checks:
  - name: test
    run: just test
    timeout: 45m      # optional; s, m or h; default 30m
```

- **`mode: none`** runs checks on the host as today. `image` and `network` are rejected with `mode: none`, since they would have no effect.
- **`mode: podman`** runs each check as

  ```
  podman run --rm --replace --pull=missing --userns=keep-id
    --security-opt=no-new-privileges --network=none
    --name agentux-check-<run>-<n>
    -v <worktree>:<worktree>:Z -v <git-dir>:<git-dir>:ro,z
    -w <worktree> <image> sh -c <command>
  ```

  - Rootless, as the user's own uid inside (`keep-id`), so files the check writes in the worktree belong to the user.
  - The worktree is mounted at the same path, so paths in output and in build caches match the host. The repository's git directory is mounted read-only so `git` works in the worktree.
  - Nothing else from the host: no home directory, no environment variables, no credentials, no Podman or SSH sockets.
  - No network unless `network: true`, which uses Podman's default rootless network (pasta on Podman 5, slirp4netns on older versions) rather than naming one that may not be installed.
  - `--pull=missing` pulls an image once and then reuses it; `--replace` removes a container left behind by a daemon that died mid-check.
- **The image** is, in order: `isolation.image`; else the `image` field of `.devcontainer/devcontainer.json` (or `.devcontainer.json`), read as JSON with comments; else `registry.fedoraproject.org/fedora-toolbox:44`. Only `image` is used: dev container builds, features, Compose files and lifecycle commands are not. The file is read from the commit the run started from, not from the worktree, so an agent cannot change where its own checks run, just as it cannot change the run's `agentux.yaml`. Image references that start with `-` or contain spaces are rejected.
- **Timeouts and cleanup apply in both modes.** Each check runs in its own process group. A check that exceeds its `timeout` fails with its output so far, and the failure goes back to the agent like any other. On timeout or when the run is cancelled, the whole process group is killed and the container is removed (`podman rm --force`).
- **Checks that cannot run fail the run, not the gate.** Podman missing, an image that cannot be pulled, or Podman itself failing (exit 125) is not something the agent can fix in the code, so the run fails with the reason instead of looping back to `on_fail`.
- **`aux validate`** shows each check's timeout, the isolation mode, the network setting, and the image it would use with where it came from.
- **One setting for the whole gate**, not per check. A project's checks share a toolchain, and a single image keeps the file short and the security posture obvious in review. A per-check override can be added later without breaking files that use this form.

## Consequences

- A project opts into isolation with two lines; running checks the agent wrote no longer exposes the user's credentials or network by default.
- Projects with a dev container get the same toolchain in checks without repeating it.
- Isolated checks are slower to start (a container per check, and a pull the first time, which counts against the timeout), and build caches outside the worktree (for example `~/.cargo/registry`) are not shared with the host, so builds may refetch dependencies — which also needs `network: true`.
- `HOME` inside the container is whatever Podman sets up for the user (the host's home path), which usually does not exist in the image. Tools that need a writable home must find one in the image or be pointed elsewhere by the check command (for example `HOME=/tmp just test`).
- SELinux relabels the worktree (`Z`) and the git directory (`z`, shared because several runs may mount it).
- `.git/config` is visible read-only to isolated checks; it should not hold credentials.
- A check whose own command exits with 125 is indistinguishable from a Podman error and fails the run.
- Only gate commands are isolated. Agents, and the tools they call during implement and review steps, still run on the host with the user's access; isolating agent tool execution is future work and will need its own ADR (the harness has to run its tools inside a container while its login stays outside).

## Alternatives considered

- **Isolation per check** — more flexible (for example network only for one check), but the common case is one toolchain for all checks, and per-check settings make it harder to see at a glance what runs unconfined.
- **Toolbx or Distrobox** — preinstalled too, but they share the user's home directory and much of the host by design, which defeats the purpose.
- **Full dev container support (the `devcontainer` CLI)** — honours builds, features and lifecycle hooks, but needs Node.js and a build step per project, and runs project-defined hooks with more privileges; reading `image` covers the common case.
- **Firejail, bubblewrap or systemd-run sandboxes on the host** — lighter, but the toolchain would still have to be on the host, and the policy surface is larger to get right than a container with one bind mount.
- **Docker** — not in the image, and its daemon runs as root.

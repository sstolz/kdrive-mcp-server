---
id: F-015
title: Isolated self-hosted CI runner and CI consumption controls
ticket: "#72"
status: done
version: 2
---

## Context

GitHub Actions minutes for the private repository `sstolz/kdrive-mcp-server`
ran out (2026-11-06), so the mandatory CI of F-011 and F-013 (lint, format,
typecheck, test, build, image, `sonar`, `sonar-pr`) no longer runs. The owner
decided (2026-11-06) to run CI on a self-hosted runner on the owner's amd64
Linux server, which has KVM and also runs other services and a Docker engine
that must not be exposed. The Sonar server is reachable over public HTTPS.

Affected users: the owner (operates the server and runner, merges PRs) and
the agents that author and review PRs (their CI evidence comes from this
runner).

The design agreed with the owner on 2026-11-06 is recorded in Scope, D-01 to
D-16 and ADR-007 (proposed).

## Scope

- `ops/runner/` (JSON syntax where YAML is expected, as for `ci.yml`, so
  tests parse it with `JSON.parse`): host side `install.sh` (BR-233, the
  single owner-run entry point), `host-setup.sh` (BR-220),
  `nftables.conf` (BR-219), `lima.yaml` (BR-218),
  `kdrive-ci-runner.service` (BR-220), `kdrive-runner-nft.service`
  (BR-220), `egress-selftest.sh` (BR-224), `supervise.sh` (BR-223, BR-224); VM
  side, copied in by the supervisor, `provision.sh` (BR-221), `Dockerfile`,
  `entrypoint.sh` and `compose.yaml` (BR-222), `probe.sh` (BR-230, BR-231);
- `.github/workflows/ci.yml` (BR-015 v5, BR-149 v2, BR-183 v2,
  BR-225–BR-228); `.github/workflows/runner-acceptance.yml` (BR-229);
  `scripts/ci-changes.sh` and Make targets `ci-changes`, `runner-probe`,
  `runner-reset-mark`, `runner-reset-check` (BR-226, BR-229, BR-230);
- `docs/self-hosted-runner.md` — owner-run setup, operation, update and
  rollback guide (BR-232);
- tests: new `tests/runner-ops.test.ts`, `tests/ci-changes.test.ts`; updated
  `tests/ci-policy.test.ts`, its helper and `tests/image-policy.test.ts`;
- records: ADR-007, BR-218–BR-233 and the versioned BR files (pending
  acceptance), a `CHANGELOG.md` Changed line. No capability-map entry: CI
  infrastructure is not a user-facing capability.

### Out of scope

- The owner's Gitea act_runner and any other CI system.
- Product code under `src/` and its tests.
- Parallel runner instances (one VM, one job at a time in v1).
- Pre-pulling dev or scanner base images into the golden disk (cache).
- Merging the five gate jobs into one job.
- Any change to the BR-151 step texts or the Sonar scripts.

## Threat model

| Id | Actor / event | Goal | Control | Residual |
| -- | ------------- | ---- | ------- | -------- |
| T1 | Code run by a same-repository PR job (dependencies, tests, build scripts), root in the VM through the VM's Docker socket | Reach the host, the server's Docker engine or loopback services, or the LAN | The VM is the boundary: no mount, no port forward, no extra network (BR-218); egress is filtered **on the host** by the user id that owns QEMU and the Lima host agent, so root in the VM cannot lift it: no IPv6 at all, only TCP 443 over IPv4 to addresses that are not host-local, not private and not on a host-attached network, DNS to the recorded resolvers and the Lima SSH port (BR-219); the host user has no sudo and no Docker group (BR-220) | Public internet on 443 (exfiltration of what the job already holds, as on a hosted runner), including the public Sonar server (D-13); DNS queries through the host resolver; a QEMU/KVM escape lands as the unprivileged host user, still under BR-219, able to read the runner-minting token (D-14) |
| T2 | A PR job that leaves code behind for a later job (for example the `main` `sonar` job holding `SONAR_TOKEN`) | Persist across jobs | Every job runs on a VM restored from a read-only golden disk, with a fresh Docker state and workspace; a failed reset starts no runner (BR-224); acceptance proves it (BR-231) | Content of the golden disk itself, built once from reviewed files |
| T3 | Fork PR | Run code on the runner | Private repository with "Run workflows from fork pull requests" disabled (BR-232, AC-19); every self-hosted job depends on a `changes` job guarded against forks, and a hosted `fork-refusal` job fails for forks (BR-149 v2) | A fork can rewrite `ci.yml`, so the repository setting is the real control; the workflow guard is defence in depth; merge blocking is procedural (D-08) |
| T4 | Theft of the runner registration credential | Register a rogue runner or change repository settings | A fine-grained PAT limited to this repository, expiring within 90 days, in a 0600 file of the host user outside the VM (D-14); only a one-job JIT configuration enters the VM, on stdin, then a tmpfs file deleted before the runner starts (BR-222, BR-223) | Whoever reads the token file administers the repository until expiry or revocation; job code runs as the runner's own user during its single job and can read the JIT configuration from the listener's arguments or memory; that configuration is valid for that job only |
| T5 | Sonar secrets on the runner | Read `SONAR_TOKEN`, `SONAR_PR_TOKEN`, `SONAR_HOST_URL` | Unchanged F-011 controls (BR-015, BR-149–BR-151); the secrets exist in the VM only during the analysis step; the reset (T2) ends the exposure; the host and supervisor never receive them | Root in the VM during that same job can read them, as code in the job could on a hosted runner (F-011 T2 residual) |

## Business rules

### Versioned rules

- **BR-015 v5** — BR-015 v4 holds with these changes:
  - the exact job set adds `changes`, `fork-refusal` and `ci-result`;
  - every job except `fork-refusal` runs on the BR-225 label array, and every
    job has the BR-225 `timeout-minutes`;
  - "every main PR/push runs the five mandatory jobs" becomes: `lint`,
    `format`, `typecheck`, `test` and `build` each have `needs: [changes]`
    and the `if` of BR-227, so they run on every `push` and
    `workflow_dispatch` and on every same-repository PR except a records-only
    one (BR-226); the workflow still has no `paths`, `paths-ignore`,
    `branches-ignore` or `tags` filter;
  - the Make-only `run` allowlist adds `make ci-changes`, admitted only in the
    `changes` job;
  - the non-Make `run` texts add the `ci-result` failure text (BR-227), a
    named constant in `tests/helpers/ci-policy.ts`, admitted only in
    `ci-result`, and admit the BR-149 fork-refusal text also in the
    `fork-refusal` job (ten occurrences in all);
  - the workflow has the BR-228 top-level `concurrency`.

  (v4: every job on `ubuntu-24.04`, no job conditions on the gate jobs.)
  Verified by: AC-08, AC-10, AC-11.
- **BR-149 v2** — BR-149 v1 holds with these changes: `sonar-pr` runs on the
  BR-225 label array, needs `changes`, `lint`, `format`, `typecheck`, `test`
  and `build`, and its job `if` is exactly
  `github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && needs.changes.outputs.heavy != 'false'`;
  its steps and step conditions are unchanged. A separate job `fork-refusal`
  on `ubuntu-24.04` has `permissions: contents: read`, `timeout-minutes: 5`,
  no `needs`, no checkout, the job `if` exactly
  `github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository`,
  and one step whose `run` is the BR-149 fork-refusal text, so a fork PR
  never has a successful run. The v1 rule on where the head repository may
  appear is extended: besides step `if` expressions and the
  `SONAR_PR_HEAD_REPOSITORY` step `env`, it appears only in the job `if` of
  `sonar-pr`, `fork-refusal`, `changes` and `ci-result`, exactly as written
  in this rule and BR-227; still never in a `run` script or any other `env`.
  (v1: `sonar-pr` on `ubuntu-24.04`, no job `if` beyond the event, fork
  refusal only as its first step, head repository only in step `if` and
  that `env`.) Verified by: AC-10, AC-19.
- **BR-178 v2** — BR-178 v1 holds, and its scan also covers every file under
  `ops/runner/` and `.github/workflows/runner-acceptance.yml`, with two
  exceptions: `ghcr.io` is admitted in the single `FROM` line of
  `ops/runner/Dockerfile`, as `ghcr.io/actions/actions-runner:<version>@sha256:<64 hex>`,
  and as the exact string `https://ghcr.io/v2/` once in `ops/runner/probe.sh`
  (a read-only reachability probe, BR-230). (v1: no `ghcr.io` anywhere;
  `ops/runner/` did not exist.) Verified by: AC-03.
- **BR-183 v2** — BR-183 v1 holds with these changes: the `image` job runs on
  the BR-225 label array, has `needs: [changes]` and the job `if` exactly
  `needs.changes.outputs.image != 'false'`; its matrix, steps, step `env`,
  permissions and `timeout-minutes: 30` are unchanged. (v1: `ubuntu-24.04`,
  no `if`, no `needs`.) Verified by: AC-10.

### New rules

- **BR-218** — `ops/runner/lima.yaml` has exactly the top-level keys
  `vmType`, `arch`, `plain`, `mounts`, `portForwards`, `hostResolver`, `ssh`,
  `containerd`, `cpus`, `memory`, `disk` and `images` (any other key, for
  example `additionalDisks`, `vmOpts`, `firmware` or `networks`, is
  rejected), and `hostResolver`, `ssh` and `containerd` have exactly the
  sub-keys listed here. It defines the VM with: `vmType: "qemu"`,
  `arch: "x86_64"`, `plain: true`, `mounts: []`, exactly
  one `portForwards` entry `{"guestIPMustBeZero": false, "guestIP":
  "0.0.0.0", "guestPortRange": [1, 65535], "proto": "any", "ignore": true}`,
  `hostResolver.enabled: false`, `ssh.localPort: 60022`,
  `ssh.loadDotSSHPubKeys: false`, `ssh.forwardAgent: false`,
  `ssh.forwardX11: false`, `containerd.system: false`,
  `containerd.user: false`, `cpus: 4`, `memory: "8GiB"`, `disk: "60GiB"`, and exactly one `images`
  entry with `arch: "x86_64"`, an `https://` location and a
  `digest: "sha256:<64 hex>"`. Verified by: AC-01, AC-16.
- **BR-219** — `ops/runner/nftables.conf` defines one table
  `inet kdrive_runner` with one base chain on the `output` hook at a
  priority below `-100` (before destination NAT) whose rules apply only to
  packets with `meta skuid "kdrive-runner"`, in this order: drop
  `meta nfproto ipv6` (the runner user has no IPv6 egress); accept
  `ct state established,related`; accept TCP to `127.0.0.1` port `60022`
  (Lima SSH); accept UDP and TCP port 53 to the addresses of the named set
  `resolvers` only; accept IPv4 TCP port 443 to an address that is neither
  local to the host (`fib daddr type local`) nor in the named sets
  `private4` (`0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`,
  `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0/4`,
  `240.0.0.0/4`) or `internal`; then drop. `resolvers` and `internal` are
  IPv4 interval sets declared empty in the file and filled only by the
  generated file `/etc/kdrive-runner/nft-sets.conf`, which `nftables.conf`
  includes (BR-220). It contains no other accept rule and no rule matching
  another user. Verified by: AC-02, AC-14.
- **BR-220** — `ops/runner/host-setup.sh` creates the host user
  `kdrive-runner` with a home directory, adds it only to the `kvm`
  supplementary group, never to `sudo`, `wheel`, `adm` or `docker`, writes no
  sudoers entry, installs `ops/runner/nftables.conf` as a root-owned file
  that is never `/etc/nftables.conf` and contains no `flush ruleset`, loaded
  by the root oneshot unit `kdrive-runner-nft.service`, which deletes and
  recreates only the table `inet kdrive_runner` (host and Docker rules are
  never touched), and writes the root-owned `/etc/kdrive-runner/nft-sets.conf`
  with `add element` statements: `resolvers` holds the IPv4 `nameserver`
  addresses of the host's `/etc/resolv.conf` (the targets QEMU user-mode DNS
  forwards to, for example `127.0.0.53` behind systemd-resolved); `internal`
  holds the destination prefix of every IPv4 route of every table
  (`ip -4 route show table all`) other than `default`, `0.0.0.0/0`,
  `0.0.0.0/1` and `128.0.0.0/1`, every prefix of a host IPv4 address
  (`ip -4 addr`), and every IPv4 prefix listed in the optional root-owned
  owner file `/etc/kdrive-runner/extra-internal.conf` (one prefix per line;
  the site's public addresses, so a NAT hairpin through the router is
  blocked), so a LAN on public addresses is blocked too. It exits
  nonzero with a fixed message, loading nothing, when `resolvers` or
  `internal` would be empty, or when `resolvers` would hold `9.9.9.9` (the
  BR-230 direct-DNS probe target). It ends by running
  `systemctl restart kdrive-runner-nft.service` and exits nonzero when that
  fails, so re-running it after a host network change reloads both sets
  immediately. It installs `ops/runner/kdrive-ci-runner.service` as
  a system unit with `User=kdrive-runner`, `Requires=` and `After=`
  `kdrive-runner-nft.service`, which runs `ops/runner/supervise.sh run` and
  nothing else (no lingering user unit). No file under `ops/runner/`
  references `/var/run/docker.sock` or `/run/docker.sock` except
  `ops/runner/compose.yaml` (the VM's socket). Verified by: AC-02, AC-05, AC-16,
  AC-21.
- **BR-221** — `ops/runner/provision.sh`, run as root inside the VM, rewrites
  every APT source to `https://` before the first `apt-get`, installs Docker
  Engine, its CLI and the Buildx and Compose plugins at exact versions named
  in the script from `https://download.docker.com`, configures `dockerd`
  with no TCP listener, builds `ops/runner/Dockerfile` as
  `kdrive-ci-runner:local`, creates `/home/runner/_work` owned by uid 1001,
  records the VM `docker` group id in `/etc/kdrive-runner/docker-gid`, and
  contains no `curl … | sh`, `wget … | sh` or unpinned `latest`. Verified by:
  AC-05.
- **BR-222** — `ops/runner/Dockerfile` has exactly one `FROM`,
  `ghcr.io/actions/actions-runner:<version>@sha256:<64 hex>`, adds only the
  `make` package and the Docker Compose CLI plugin at an exact version whose
  SHA-256 is checked in the same `RUN`, copies `ops/runner/entrypoint.sh` as
  the image entrypoint, and ends with `USER runner`.
  `ops/runner/compose.yaml` defines exactly one service `runner` with image
  `kdrive-ci-runner:local`, `pull_policy: never`, `restart: "no"`, no
  `privileged`, `ports`, `network_mode`, `cap_add`, `devices`, `pid`,
  `environment` or `command`; its volumes are exactly `/var/run/docker.sock`
  → `/var/run/docker.sock`, `/home/runner/_work` → `/home/runner/_work`
  (identical paths, so job bind mounts resolve in the VM's Docker) and
  `/run/kdrive-runner` → `/run/kdrive-runner`; `group_add` is exactly
  `["${DOCKER_GID:?}"]`. The JIT configuration reaches the container only as
  the file `/run/kdrive-runner/jitconfig` on the VM's tmpfs `/run`, in a
  directory the supervisor recreates every cycle owned by uid 1001 with mode
  `0700`, the file owned by uid 1001 with mode `0400`, written from the stdin of `limactl shell`
  (BR-223). `entrypoint.sh` reads that file into a non-exported shell
  variable, deletes the file, exits nonzero with a fixed message when it was
  missing or empty or when the deletion fails, and then runs `exec ./run.sh --jitconfig "$cfg"`; no
  environment variable holds the value at any point. Verified by: AC-04.
- **BR-223** — The runner registration credential is read by
  `ops/runner/supervise.sh` only from `$HOME/.config/kdrive-runner/github-token`,
  which must be a regular non-symlink file owned by the running user with mode
  `0600` (otherwise the supervisor exits nonzero with a fixed message before
  any network call). It is sent only to `https://api.github.com` to request a
  JIT configuration (`POST /repos/sstolz/kdrive-mcp-server/actions/runners/generate-jitconfig`,
  runner group 1, labels exactly the BR-225 array, name
  `kdrive-ci-<UTC timestamp>`). Neither the credential nor the JIT
  configuration appears in a command argument on the host, in a file under
  the Lima instance or in the supervisor's output; the JIT configuration
  reaches the VM only on the stdin of `limactl shell`, which writes it to the
  BR-222 tmpfs file. Verified by: AC-07.
- **BR-224** — Before every `limactl start` (in `golden` and in each `run`
  cycle), the supervisor self-tests the egress filter with
  `ops/runner/egress-selftest.sh`: a UDP `sendto` from its own uid to
  `9.9.9.9:53` must fail at once with `EPERM`; on any other outcome
  `golden` exits nonzero with a fixed message and a `run` cycle starts no VM
  and waits the 60-second back-off. `ops/runner/supervise.sh golden` creates the instance from
  `ops/runner/lima.yaml`, copies `provision.sh`, `Dockerfile`, `compose.yaml`,
  `entrypoint.sh` and `probe.sh` into the VM, runs `provision.sh`, stops the
  VM and saves its writable disk as a `0444` golden overlay (the mode guards
  against mistakes only: the file belongs to the host user, which can change
  it). `ops/runner/supervise.sh run` loops over one cycle per job: force-stop
  the VM (`limactl stop -f`); check that no QEMU process of the instance
  remains (its pid file names no live process); replace its writable disk
  with a new `qemu-img` overlay backed by the golden overlay; start the VM;
  request one JIT configuration (BR-223); run the `runner` service in the
  foreground until it exits. When any step before the runner start fails,
  including a QEMU process that remains after the stop, no disk is replaced
  after that failure, no runner is registered or started in that
  cycle, and the next cycle starts after a fixed back-off of 60 seconds.
  Verified by: AC-06, AC-15.
- **BR-225** — In `.github/workflows/ci.yml`, every job except
  `fork-refusal` has `runs-on` exactly `["self-hosted", "linux", "x64",
  "kdrive-ci"]`, and `timeout-minutes` is: `changes` 5, `lint`, `format`,
  `typecheck`, `test` and `build` 20, `image` 30, `sonar` and `sonar-pr` 15,
  `ci-result` 5, `fork-refusal` 5. `fork-refusal` runs on `ubuntu-24.04`
  (BR-149 v2), the only exception; no job uses any other `runs-on` value.
  Verified by: AC-08.
- **BR-226** — `scripts/ci-changes.sh <event>` reads changed paths, one per
  line, on stdin and prints exactly two lines, `heavy=<true|false>` then
  `image=<true|false>`. `heavy=false` only when `<event>` is `pull_request`,
  the list is non-empty and every path is a records path: under `runs/`,
  `features/`, `business-rules/` or `architecture-decisions/`, or exactly
  `learnings.md`, `BACKLOG.md`, `CHANGELOG.md` or `capability-map.md`.
  `image=false` only when `<event>` is `pull_request`, the list is non-empty
  and no path is an image input: `Dockerfile`, `.dockerignore`,
  `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`,
  `LICENSE`, `NOTICE`, `README.md`, `Makefile`, `scripts/image-smoke.sh`,
  `scripts/http-acceptance.ts`, `scripts/ci-changes.sh`,
  `.github/workflows/ci.yml`, or any path under `src/`. Otherwise each value is
  `true`. `make ci-changes` requires `GITHUB_OUTPUT` and `GITHUB_EVENT_NAME`;
  on `pull_request` it feeds `git diff --no-renames --name-only -z HEAD^1 HEAD`
  (NUL converted to newline) to the script; when that `git` command fails, it
  writes `heavy=true` and `image=true`; it appends the result to
  `$GITHUB_OUTPUT`. Verified by: AC-09.
- **BR-227** — The `changes` job has no `needs`, the job `if` exactly
  `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`,
  outputs `heavy` and `image` from its step `classify`, and steps: the
  pinned checkout with `fetch-depth: 2` and `persist-credentials: false`,
  then `make ci-changes` (id `classify`). `lint`, `format`, `typecheck`,
  `test` and `build` have `needs: [changes]` and the job `if` exactly
  `needs.changes.outputs.heavy != 'false'`. Every self-hosted job except
  `changes` and `ci-result` depends on `changes` directly or through
  `needs`, and only `ci-result` uses `always()` at job level. `ci-result`
  needs every other job except `fork-refusal`, has the job `if` exactly
  `always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)`,
  no checkout, and one step with the `if` exactly
  `needs.changes.result != 'success' || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')`
  whose `run` prints a fixed message to stderr and exits 1. Verified by:
  AC-10, AC-18.
- **BR-228** — `.github/workflows/ci.yml` has the top-level `concurrency`
  exactly `{"group": "ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}", "cancel-in-progress": "${{ github.event_name == 'pull_request' }}"}`,
  so a new run of a PR cancels its superseded run and `push` or
  `workflow_dispatch` runs are never cancelled by concurrency. The job-level
  `concurrency` of `sonar` and `sonar-pr` is unchanged. Verified by: AC-11,
  AC-18.
- **BR-229** — `.github/workflows/runner-acceptance.yml` is triggered only by
  `workflow_dispatch` with the optional string inputs `lan_target` and
  `host_target` (`<address>:<port>`), has `permissions: contents: read`, no
  `secrets` reference, no `env` at workflow or job level, and three jobs on
  the BR-225 label array, each with `timeout-minutes: 10` and the pinned
  checkout with `persist-credentials: false`: `probe` (`make runner-probe`,
  receiving the two inputs only in that step's `env`), `reset-mark`
  (`make runner-reset-mark`) and `reset-check` (`needs: [reset-mark]`,
  `make runner-reset-check`). Verified by: AC-12.
- **BR-230** — `make runner-probe` runs `ops/runner/probe.sh network` twice,
  in the runner container (where job steps run) and in a
  `--network host --pid host --privileged` container of
  `kdrive-ci-runner:local` (the VM's own network view), masks the two inputs
  with `::add-mask::` before any use, and prints one `PASS <id>` or
  `FAIL <id>` line per probe, where `<id>` never contains an address. Each
  negative probe is a TCP connection or DNS query with a 5-second limit that
  passes only when it fails: the VM gateway `192.168.5.2` (the host loopback)
  on ports 22, 80, 443, 2375, 2376 and the owner canary port 47999;
  `host.lima.internal` on port 443 (when it resolves); `10.0.0.1`, `172.16.0.1`, `192.168.0.1`,
  `192.168.1.1` on ports 22 and 443; `169.254.169.254` on port 80; TCP port
  80 of `github.com`; a DNS query sent directly to `9.9.9.9:53` (never a
  recorded resolver, BR-220); TCP port 443 to `2606:4700:4700::1111` and to
  the IPv6 address `github.com` resolves to, when it has one (no IPv6
  egress); and, when given, `lan_target` and `host_target`. A positive DNS
  probe resolving `github.com` through the VM's own resolver must pass, so
  the direct-DNS probe is not vacuous. Each positive probe passes on any
  HTTP response over HTTPS from `https://api.github.com`,
  `https://github.com`, `https://ghcr.io/v2/`,
  `https://registry-1.docker.io/v2/`, `https://registry.npmjs.org/` and
  `https://download.docker.com/`. In the host-network container it also
  fails a probe `no-host-mount` when `nsenter -t 1 -m cat /proc/self/mounts`
  (the VM's mount namespace) lists a `9p`, `virtiofs` or `fuse.sshfs` mount.
  It exits nonzero when any probe fails. Verified by: AC-12, AC-14.
- **BR-231** — `make runner-reset-mark` leaves in the VM a file
  `/var/lib/kdrive-reset-sentinel`, a Docker volume `kdrive-reset-sentinel`,
  an image tag `kdrive-reset-sentinel:local`, a running container named
  `kdrive-reset-sentinel`, a file `kdrive-reset-sentinel` in the parent of
  `$GITHUB_WORKSPACE` and a file `kdrive-reset-sentinel` in `$RUNNER_TEMP`.
  `make runner-reset-check` fails when any of them exists, or
  when the parent of `$GITHUB_WORKSPACE` holds an entry other than the
  current checkout. Verified by: AC-12, AC-15.
- **BR-232** — `docs/self-hosted-runner.md` contains these sections, in order:
  Prerequisites (pinned Lima release and its SHA-256, QEMU, KVM, nftables),
  Installation (`install.sh`, `--check`, `--uninstall`, BR-233), Host user
  and egress rules (`host-setup.sh`, and re-running it after a host network
  change), Runner credential (the D-14 token: fine-grained, this repository
  only, Administration read and write, expiry at most 90 days; its file of
  BR-223; rotation before expiry: create the new token, replace the file
  content, revoke the old token; never pasted elsewhere), Golden disk
  (`supervise.sh golden`), Service, Repository settings and merge criterion
  ("Run workflows from fork pull requests" disabled; branch protection and
  required checks are unavailable on this plan, so a PR is merged only when
  `ci-result` succeeded on its head and `fork-refusal` did not fail,
  F-011 D5), Acceptance (the dispatch of BR-229 with the owner canary, and
  the evidence to record), Secrets exposure (the T1, T4 and T5 residuals of
  this spec), Updating (runner image digest, Lima image digest, Docker
  versions, golden rebuild), and Rollback (pause the service and delete the
  runner registration; restoring hosted runners is a reviewed PR that
  reverts `runs-on`). It names every file under `ops/runner/`.
  Verified by: AC-13.
- **BR-233** — `ops/runner/install.sh` is the single owner-run entry point,
  run as root (directly or through `sudo`). Before any change it refuses,
  exiting nonzero with a fixed message per case, when the machine is not
  `x86_64`, `/dev/kvm` is missing, `nft` is missing, it is not root, or the
  arguments are not exactly one of: `--token-file <path>`, `--check`,
  `--uninstall`. Install mode reads the token only from the file at
  `<path>` (a regular non-symlink file, else a fixed refusal), never from an
  argument value, the environment or a prompt; it runs `host-setup.sh`
  (BR-220), installs the pinned Lima release after checking its SHA-256,
  writes the token to the BR-223 file as `kdrive-runner` from stdin
  (`runuser -u kdrive-runner`, `umask 077`, no-follow: a symlink at that path
  is a fixed refusal), so root never opens a path inside that user's home; a
  re-run with a token whose SHA-256 differs from the stored one replaces it
  (rotation) and prints a fixed "token rotated" line,
  enables and starts `kdrive-runner-nft.service` (the egress table is loaded
  before any VM exists), then runs `supervise.sh golden` (BR-224) and the
  remaining steps as `kdrive-runner`, then enables and starts
  `kdrive-ci-runner.service`. Each step first
  checks its target state and skips when it already holds, so a second run
  changes nothing and prints a fixed "already installed, no change" line.
  `--check` changes nothing and exits nonzero when the user, groups,
  loaded rules, Lima version, golden overlay, token file mode and owner, or
  unit state differ from the installed state. `--uninstall` first stops and
  disables `kdrive-ci-runner.service`, then removes only what install mode
  created (that unit, the `kdrive-runner-nft.service` unit and its
  `inet kdrive_runner` table, the Lima instance and golden overlay, and the
  generated files of `/etc/kdrive-runner/` except the owner's
  `extra-internal.conf`); it keeps the user, its home, the token file, the
  `<path>` file and every other service, and prints a fixed reminder to
  revoke the token. Its output never contains the token, a JIT
  configuration, a host name or an address. Verified by: AC-21, AC-22.

## Acceptance criteria

Static and stub tests run in the dev container (`make check`); owner-run
evidence is recorded in `runs/72-acceptance-1.md` and the ticket, sanitized:
no token, JIT configuration, internal host name or internal address.

- **AC-01** (BR-218) — Given `ops/runner/lima.yaml`, When the runner-ops test
  parses it, Then the top-level and sub-key sets are exact and every BR-218
  key has its exact value, and a mutation of each key (for example
  `plain: false`, one mount, `ignore: false`, an image without `digest`) and
  an added `additionalDisks`, `vmOpts`, `firmware` or `networks` key are
  rejected. Verified by: `tests/runner-ops.test.ts` `BR-218 …`.
- **AC-02** (BR-219, BR-220) — Given `ops/runner/nftables.conf`, When the test reads
  it, Then it finds the one table and chain with the hook and priority, the
  `skuid` scope, the six rules in order, `private4` with exactly the listed
  elements, `resolvers` and `internal` declared empty and filled only by the
  include, and no other accept; mutations (port 80, a removed set element,
  `fib` or `internal` condition, no IPv6 drop, priority `0`, no `skuid`) are
  rejected; and Given stub `ip` outputs and a `resolv.conf`, When
  `host-setup.sh` generates `nft-sets.conf` (stub routes in several tables,
  a split default `0.0.0.0/1` + `128.0.0.0/1`, and an
  `extra-internal.conf` with one public prefix), Then it holds the expected
  elements (a public-address on-link prefix included, `default` excluded),
  and an empty set or `9.9.9.9` as resolver makes it exit nonzero. Verified
  by: `tests/runner-ops.test.ts` `BR-219 …`, `BR-220 …`.
- **AC-03** (BR-222, BR-178 v2) — Given `ops/runner/Dockerfile`, When the
  BR-178 scan and the runner-ops test run, Then the single digest-pinned
  `FROM` and the single `https://ghcr.io/v2/` string in `probe.sh` are
  accepted, and a tag-only `FROM`, a second `FROM`, a second or different
  `ghcr.io` string in `probe.sh`, a `ghcr.io` reference in any other
  `ops/runner/` file, `docker login` or `--push` in any `ops/runner/` file
  are rejected. Verified by: `tests/image-policy.test.ts`
  `BR-178 v2 …`, `tests/runner-ops.test.ts` `BR-222 …`.
- **AC-04** (BR-222) — Given `ops/runner/compose.yaml`, When the test parses
  it, Then every BR-222 setting matches, and mutations (`privileged`,
  `ports`, `network_mode: host`, a fourth volume, a different target path,
  an `environment` or `command` key) are rejected; and Given a stub
  `run.sh` that records its environment and the file's existence, When
  `entrypoint.sh` runs with a JIT file, Then the stub receives the value as
  its `--jitconfig` argument, the file no longer exists and no environment
  variable holds the value; with the file missing or empty, or its deletion
  failing (read-only stub directory), it exits nonzero
  without running the stub. Verified by: `tests/runner-ops.test.ts`
  `BR-222 …`.
- **AC-05** (BR-220, BR-221) — Given `host-setup.sh`, the service unit and
  `provision.sh`, When the test reads them, Then the BR-220 user, group,
  system-unit statements (`User=kdrive-runner`, `Requires=`/`After=`
  `kdrive-runner-nft.service`, no lingering), the oneshot that recreates only
  `inet kdrive_runner` with no `flush ruleset`, and the BR-221 HTTPS rewrite (before the first
  `apt-get`), exact versions, socket-only `dockerd` and image build are
  present, and `usermod … docker`, a sudoers write, `curl … | sh`, `latest`
  or a host Docker socket reference outside `compose.yaml` are rejected.
  Verified by: `tests/runner-ops.test.ts` `BR-220 …`, `BR-221 …`.
- **AC-06** (BR-224) — Given stub `limactl`, `qemu-img`, `curl` and `docker`
  executables that record their calls, When `supervise.sh run` performs one
  cycle with a stub `egress-selftest.sh` that reports `EPERM`, Then the calls are `stop -f`, the QEMU pid check, overlay creation
  backed by the golden overlay, start, JIT request, runner start, in that
  order; When a QEMU process remains after the stop, Then no overlay is
  created; and When the pid check, the overlay creation or the start fails,
  Then no JIT request and no runner start occur and the supervisor waits 60
  seconds (stubbed `sleep`); When the egress self-test connects instead of
  being refused, Then no `limactl` call occurs and it waits 60 seconds. Verified
  by: `tests/runner-ops.test.ts` `BR-224 …`.
- **AC-07** (BR-223) — Given the same stubs and a credential file, When the
  file is missing, a symlink, mode `0644` or owned by another user, Then the
  supervisor exits nonzero with a fixed message and makes no call; When the
  file is valid, Then the credential and the stubbed JIT value appear in no
  recorded argument, no file under the stub instance directory and no
  supervisor output, the JIT value reaches the `limactl shell` stub on stdin
  only, and the request body carries the BR-223 labels, group and name
  pattern. Verified by: `tests/runner-ops.test.ts` `BR-223 …`.
- **AC-08** (BR-015 v5, BR-225) — Given the real `ci.yml`, When the CI policy
  validator runs, Then it accepts the workflow, and it rejects: a job on
  `ubuntu-24.04` other than `fork-refusal`, a different `timeout-minutes`, a
  `paths` filter, `make ci-changes` or the `ci-result` text in another job. Verified by:
  `tests/ci-policy.test.ts` `BR-015 v5 …`, `BR-225 …`.
- **AC-09** (BR-226) — Given path lists on stdin, When `ci-changes.sh` runs,
  Then: `pull_request` with only `runs/x.md` and `BACKLOG.md` gives
  `heavy=false`, `image=false`; `docs/deployment.md` gives `heavy=true`,
  `image=false`; `src/cli.ts` gives `heavy=true`, `image=true`;
  `features/x.md` plus `README.md` gives `heavy=true`, `image=true`; an
  empty list gives `true`, `true`; `push` and `workflow_dispatch` with
  `runs/x.md` give `true`, `true`; a path `runs` (no slash) gives
  `heavy=true`. And Given a stub `git` on `PATH`, When `make ci-changes` runs
  with a failing `git`, Then `$GITHUB_OUTPUT` holds `heavy=true` and
  `image=true`; with a rename `src/a.ts` → `runs/a.ts` listed by
  `--no-renames` as both paths, Then `heavy=true`. Verified by:
  `tests/ci-changes.test.ts` `BR-226 …`.
- **AC-10** (BR-149 v2, BR-183 v2, BR-227) — Given the real `ci.yml`, When
  the validator runs, Then the `changes`, gate, `image`, `sonar-pr`,
  `fork-refusal` and `ci-result` jobs have exactly the BR-149 v2, BR-183 v2
  and BR-227 `needs`, `if`, outputs and steps, and mutations are rejected:
  `changes` without the fork guard, a gate job without `needs: [changes]`,
  `heavy == 'true'` instead of `!= 'false'`, `image` without its `if`,
  `always()` on a job other than `ci-result`, `ci-result` without the
  `needs.changes.result` term, `fork-refusal` with a checkout. Verified by:
  `tests/ci-policy.test.ts` `BR-149 v2 …`, `BR-183 v2 …`, `BR-227 …`.
- **AC-11** (BR-228) — Given the real `ci.yml`, When the validator runs, Then
  the top-level `concurrency` equals the BR-228 value and the `sonar` and
  `sonar-pr` job-level groups are unchanged; `cancel-in-progress: true` or a
  group without the event split is rejected. Verified by:
  `tests/ci-policy.test.ts` `BR-228 …`.
- **AC-12** (BR-229, BR-230, BR-231) — Given `runner-acceptance.yml` and
  `probe.sh`, When the tests read them, Then the trigger, inputs,
  permissions, jobs, `needs` and Make steps match BR-229, the probe list and
  thresholds match BR-230 (including the IPv6, `9.9.9.9` and positive DNS
  probes and the `nsenter` mount check), the sentinel names match BR-231,
  and a `secrets` reference, a `push` trigger or a missing `::add-mask::`
  are rejected.
  Verified by: `tests/runner-ops.test.ts` `BR-229 …`, `BR-230 …`, `BR-231 …`.
- **AC-13** (BR-232) — Given `docs/self-hosted-runner.md`, When the test
  reads it, Then the eleven sections exist in order, every `ops/runner/` file
  is named, the merge criterion names `ci-result` and `fork-refusal`, and no
  text claims required checks or branch protection are enabled. Verified by: `tests/runner-ops.test.ts` `BR-232 …`.
- **AC-14** (BR-218, BR-219, BR-230) — Given the real VM on the owner's
  server, the owner's loopback canary listening on host port 47999, and the
  inputs `lan_target` (a LAN host with an open port) and `host_target` (the
  host's public address on 443, listed in `extra-internal.conf` when the
  server is behind NAT; no Sonar exception, D-13), When the owner
  dispatches `runner-acceptance.yml`, Then the `probe` job succeeds and
  every probe line is `PASS` (IPv6 probes included), and the canary
  received no connection. Evidence: the run id, the `PASS`/`FAIL` lines, the canary's
  connection count (0). Owner-run.
- **AC-15** (BR-224, BR-231) — Given the same dispatch, When `reset-mark` and
  then `reset-check` run as two consecutive jobs, Then `reset-check`
  succeeds and the two jobs report different runner names. Evidence: the run
  id and the two runner names. Owner-run.
- **AC-16** (BR-218, BR-220) — Given the host after setup, When the owner
  runs `id kdrive-runner`, `sudo -l -U kdrive-runner`, `limactl validate
  ops/runner/lima.yaml` (as that user), `nft list table inet kdrive_runner`
  and, during a probe job, `ss -Hltnp` filtered to that user's processes,
  Then the groups are the primary group and `kvm` only, sudo is not allowed,
  validation passes, the loaded rules equal the file, and the only listener
  is `127.0.0.1:60022`. Evidence: those outputs with host names and
  addresses removed. Owner-run.
- **AC-17** (BR-015 v5, BR-149 v2, BR-183 v2, BR-225, F-011 BR-151 v3) —
  Given the #72 PR head, When CI runs, Then every job except `fork-refusal`
  (skipped) ran on a runner named `kdrive-ci-…`, `image` ran for both
  platforms (the PR changes `ci.yml`), `sonar-pr` passed its pristine
  export, comparison and final Git-metadata steps and the Quality Gate, and
  `ci-result` succeeded; and Given the merge, When the `main` push run
  completes, Then the same holds for `sonar` with `SONAR_TOKEN`. Evidence:
  the run ids, the head and `main` SHAs, the runner names. Owner-run.
- **AC-18** (BR-226, BR-227, BR-228) — Given the records-only PR that
  synchronizes the #72 markers, When CI runs, Then the gate jobs, `image`
  and `sonar-pr` are skipped and `ci-result` succeeds; and When two commits
  are pushed to one PR branch in quick succession, Then the first run is
  cancelled. Evidence: the run ids and job conclusions. Owner-run.
- **AC-19** (BR-149 v2, BR-232) — Given the repository settings, When the
  owner reads Settings → Actions → General, Then "Run workflows from fork
  pull requests" is disabled. Evidence: that value. Owner-run. (Merge
  blocking stays procedural, D-08.)
- **AC-20** (records) — Given the PR, Then ADR-007, BR-218–BR-233 and the
  four versioned BRs are `pending acceptance` and the CHANGELOG has a
  Changed line. Verified by: review.
- **AC-21** (BR-233, BR-220, BR-224) — Given stub `uname`, `nft`, `id`,
  `useradd`, `limactl`, `systemctl`, `sudo`, `runuser` and
  `egress-selftest.sh` executables that record their
  calls, and a fake `/dev/kvm` path, When `install.sh` runs: on `aarch64`,
  without `/dev/kvm`, without `nft`, as non-root, with no argument, with an
  unknown argument, with `--token-file` and a missing, symlink or directory
  path, or with a token passed as an argument value; Then each exits
  nonzero with its fixed message and records no changing call; When it runs
  in install mode on a fresh stubbed state, Then the recorded order is
  `host-setup.sh` (ending with the `kdrive-runner-nft.service` restart),
  starting that unit, the self-test, `supervise.sh golden`, starting
  `kdrive-ci-runner.service`; When the self-test stub reports a connection,
  Then `golden` exits nonzero and no `limactl start` is recorded; When it
  runs in install mode twice on the stubbed installed state, Then the second
  run records no changing call and prints the "no change" line; When a stored
  token with a different SHA-256 exists, Then it is replaced through
  `runuser` and the "token rotated" line is printed; When a symlink sits at
  the BR-223 path, Then the run exits with the fixed refusal and writes
  nothing; When it runs
  with `--check`, Then it records no changing call; When it runs with
  `--uninstall`, Then it never touches the token file, the `<path>` file,
  the user or another unit; and in every case the token value appears in no
  recorded argument and no output. Verified by: `tests/runner-ops.test.ts`
  `BR-233 …`.
- **AC-22** (BR-233) — Given the owner's server, When the owner runs
  `sudo ops/runner/install.sh --token-file <path>`, then
  `sudo ops/runner/install.sh --check`, then the install command again,
  Then the first succeeds, `--check` exits 0 and the second install prints
  the "no change" line. Evidence: the sanitized outputs. Owner-run, before
  AC-14–AC-16.

## Decisions

- **D-01 — Lima VM as the isolation boundary (ADR-007, proposed).** Chosen:
  a QEMU/KVM Lima VM in `plain` mode, user-mode networking only. Rejected:
  the runner on the host or in a host container (jobs need Docker: the host
  engine or a privileged host container); rootless Docker on the host
  (shared kernel, host network reachable); Firecracker/Kata (more ops).
- **D-02 — Egress enforced on the host by user id.** With user-mode
  networking, every VM packet leaves through the QEMU process owned by
  `kdrive-runner`, so an `nftables` `skuid` chain filters the VM where root
  in the VM cannot change it, and `fib daddr type local` covers every host
  address, including the slirp gateway's loopback mapping and the host's
  public address. The chain sits before destination NAT so published ports
  of the server's Docker engine are judged by their original address.
  Rejected: a firewall inside the VM (jobs are root there via Docker); a
  host-name allowlisting egress proxy (a proxy to run, and proxy settings in
  Docker, npm and the runner); a bridged or `socket_vmnet` network (traffic
  no longer tied to one host uid). IPv6 is dropped for that uid and the
  host's attached IPv4 networks form the `internal` set, so a public-address
  LAN is blocked too. Consequence: any public IPv4 host on 443 is reachable,
  as from a hosted runner.
- **D-03 — Fresh VM per job from a golden overlay.** Rejected: `docker
  system prune` and workspace cleanup between jobs (root in the VM can
  persist outside Docker, for example a systemd unit or a binfmt handler);
  re-provisioning the VM per job (minutes of network work). Consequence: no
  Docker or npm cache survives; each job pays a VM boot (measured).
- **D-04 — JIT configuration for ephemeral registration.** One API call per
  job yields a single-job runner; no long-lived registration token enters
  the VM. Rejected: `config.sh --ephemeral` with a registration token inside
  the VM (the minting credential or a reusable token would sit in the VM).
- **D-05 — A thin image derived from the official runner image.** The jobs
  need `make` and `docker compose` on the runner side; the official image
  is the pinned base and provides the Docker CLI and Buildx (AC-17 runs
  every target). BR-178 v2 admits only that `FROM` and the read-only probe
  URL `https://ghcr.io/v2/`.
- **D-06 — Identical workspace path in the runner container and the VM.**
  Jobs use Docker outside of Docker; `compose.yaml` bind sources (`.`,
  `./.git`, `./artifacts/sonar-input`) resolve in the VM's daemon, so
  `/home/runner/_work` is bound at the same path. The runner uid 1001 equals
  the existing `DEV_UID`.
- **D-07 — Classification by a Make target, skips by job conditions.**
  Rejected: workflow `paths-ignore` (a workflow that does not start leaves
  required checks pending); a third-party paths-filter action (new pinned
  dependency). Fail closed: a `git` failure, an empty list or another event
  runs everything, and conditions test `!= 'false'`. Records paths exclude
  `docs/` and `README.md`, which tests read.
- **D-08 — `ci-result` as the merge criterion; blocking stays procedural.**
  The plan allows no branch protection or required checks (F-011 D5 and T8,
  HTTP 403 verified 2026-11-03), so under AGENTS.md §3 step 6 a PR is merged
  only when `ci-result` succeeded on its head and `fork-refusal` did not
  fail. One aggregate job removes the dependency on job names and skips
  (skipped matrix jobs do not report their matrix names). `fork-refusal`
  uses the hosted runner so a fork PR never passes; with no hosted minutes
  it stays queued or fails. If the plan later allows it, the owner may make
  `ci-result` a required check (out of scope).
- **D-09 — Concurrency per PR, never on `main`**, so each `main` commit keeps
  a complete run for acceptance evidence.
- **D-10 — Keep the five gate jobs.** Merging them would cut VM boots but
  change the check structure F-011 relies on; revisit after measuring.
- **D-11 — F-011 guards unchanged.** BR-151 assumed a fresh workspace and
  `$RUNNER_TEMP`; BR-231 proves that premise on the real runner.
- **D-12 — Ops files in JSON syntax, tested statically or with stubs;
  fixed defaults.** No YAML dependency; what a unit test cannot reach is
  proven by the owner-run AC-14–AC-19. Like the F-013 image targets,
  `ci-changes` and the `runner-*` targets run on the runner side (host
  `git`, the VM's Docker) and are CI or ops only, not development commands.
  Defaults: label `kdrive-ci`, VM 4 CPU / 8 GiB / 60 GiB, SSH port 60022,
  canary port 47999; a change is a reviewed PR.

- **D-13 — No Sonar egress exception (owner, 2026-11-06).** Sonar runs on
  another server reachable over public HTTPS, so BR-219 needs no exception
  and `host_target` stays a negative probe. Rejected: a `sonar_exception`
  set (not needed).
- **D-14 — Fine-grained PAT mints JIT configurations (owner, 2026-11-06).**
  Scoped to this repository only, "Administration: read and write", expiry
  at most 90 days, stored on the host outside the VM in the BR-223 file
  (owner `kdrive-runner`, mode `0600`); rotated before expiry as BR-232
  describes. Rejected: a GitHub App (one more component to operate; a later
  hardening); a manual registration token per job (unusable for ephemeral
  runners).
- **D-15 — JIT configuration through a deleted tmpfs file.** The value
  never sits in a compose variable or the container environment, and the
  file is gone before `run.sh` starts (BR-222). Residual: job code runs as
  the runner user during its own single job and can read the listener's
  arguments; the configuration serves that job only. Rejected: a
  `RUNNER_JITCONFIG` environment variable (readable for the whole job and
  by `docker inspect`).
- **D-16 — One idempotent installer (owner, 2026-11-06).** `install.sh`
  wraps `host-setup.sh`, the Lima install and `supervise.sh golden` with
  `--check` and `--uninstall` (BR-233). It reads the token only from a
  file, and uninstall keeps the user and the token file so a mistaken
  uninstall loses no credential and the owner revokes the token knowingly.
- **D-17 — `$RUNNER_TEMP` freshness through a sentinel (v2, 2026-11-06).**
  v1 required an empty `$RUNNER_TEMP` at the start of the `reset-check`
  step, but the runner itself may write the step script and file-command
  files there before the step runs, so the check could fail on every real
  run. v2 marks `$RUNNER_TEMP` with a sentinel file like the other
  locations. Rejected: an allow-list of runner-owned names (couples the
  check to undocumented runner internals).

## Open questions

None.

## Stress-test

### Round 1 (review of `044b0dc`, `runs/72-spec-review-1.md`; owner answers 2026-11-06)

1. major, `ghcr.io` probe vs BR-178 — retained: BR-178 v2 admits the exact
   `https://ghcr.io/v2/` once in `probe.sh`; AC-03 tests it.
2. major, required checks impossible — retained: blocking stays procedural
   (F-011 D5/T8); merge criterion `ci-result` success and `fork-refusal` not
   failed (BR-232, D-08); AC-19 checks the fork setting only; AC-13 rejects
   a required-check claim.
3. major, IPv6 and public-IPv4 LAN — retained (orchestrator): IPv6 dropped
   for the runner uid; `internal` set from the host's non-default IPv4
   routes and address prefixes, filled by `host-setup.sh`; `private6`
   removed; IPv6 probes added (BR-219, BR-220, BR-230, AC-02, AC-12).
4. major, `resolvers` undefined — retained: the host `resolv.conf` IPv4
   nameservers that QEMU DNS forwards to, written by `host-setup.sh`; the
   direct probe targets `9.9.9.9`, refused as a resolver, plus a positive
   DNS probe (BR-220, BR-230).
5. minor, Q1/Q2 — retained: D-13 (no Sonar exception, AC-14 simplified) and
   D-14 (fine-grained PAT, ≤ 90 days, 0600 on the host, rotation in the
   guide); open questions empty.
6. minor, BR-149 head-repository rule — retained: v2 lists the four job
   `if`s where it may appear.
7. minor, BR-225 contradiction — retained: `fork-refusal` named as the only
   exception.
8. minor, `/proc/1/mounts` — retained: `--pid host` and
   `nsenter -t 1 -m` (BR-230).
9. minor, open lima key list — retained: exact top-level and sub-key sets,
   mutation tests for `additionalDisks`, `vmOpts`, `firmware`, `networks`
   (BR-218, AC-01).
10. minor, JIT readable by job code — retained (orchestrator): tmpfs file
    `0400` uid 1001, read and deleted by `entrypoint.sh` before `run.sh`, no
    environment variable; same-user residual recorded (T4, D-15, AC-04).
11. minor, graceful stop and `0444` — retained: `limactl stop -f`, QEMU pid
    check before the disk replacement; `0444` recorded as a guard against
    mistakes only (BR-224, AC-06).
12. owner addition (2026-11-06), single installer — retained: BR-233
    `install.sh` (preconditions, token from a file only, idempotent,
    `--check`, `--uninstall` keeping the user and the token file, sanitized
    output); AC-21 static stub tests; AC-22 owner-run `install.sh` then
    `--check` before AC-14–AC-16; D-16; BR-232 Installation section.

### Round 2 — 2026-11-06

Review `runs/72-spec-review-2.md` (changes: 2 major, 3 minor), all retained and
applied by the orchestrator (AGENTS.md project override: in-scope corrections
continue autonomously). Owner decision the same day: no Fable pass on #72.

1. major, egress filter not guaranteed before the VM starts: retained. A root
   oneshot `kdrive-runner-nft.service` recreates only `inet kdrive_runner`
   (never `/etc/nftables.conf`, never `flush ruleset`); the supervisor is a
   system unit with `User=kdrive-runner` and `Requires=`/`After=` that
   oneshot; each cycle self-tests the filter (`9.9.9.9:53` refused) before any
   VM step; `--uninstall` stops the service first and removes both units.
2. major, NAT hairpin to the site's public address: retained. The owner file
   `/etc/kdrive-runner/extra-internal.conf` feeds `internal`; AC-02 and AC-14
   cover it; `--uninstall` keeps it.
3. minor, root writing into the runner user's home: retained. The token is
   written as `kdrive-runner` from stdin with no-follow semantics; a different
   token rotates it with a fixed line.
4. minor, `/run/kdrive-runner` ownership: retained. Recreated each cycle,
   uid 1001, `0700`; `entrypoint.sh` fails when the deletion fails (AC-04).
5. minor, routes outside the main table and split defaults: retained.
   `ip -4 route show table all`, skipping `default`, `0.0.0.0/0`, `0.0.0.0/1`
   and `128.0.0.0/1` (AC-02).
- Nits: the Context cites D-01 to D-16; AC-02 and BR-220 reference each other.

### Round 3 — 2026-11-06

Diff-only check `runs/72-spec-review-3.md` (changes: 1 major, 3 minor), all
retained and applied by the orchestrator.

1. major, golden VM provisioned before the egress table and stale sets after
   a network change: retained. `install.sh` starts `kdrive-runner-nft.service`
   before `supervise.sh golden`; the self-test runs before every
   `limactl start`, `golden` included; `host-setup.sh` ends by restarting the
   oneshot (nonzero on failure); AC-21 asserts the order.
2. minor, TCP self-test times out instead of `EPERM`: retained. UDP
   `sendto` to `9.9.9.9:53` through the named `egress-selftest.sh`, stubbed in
   AC-06 and AC-21.
3. minor, token rotation and no-follow untested: retained in AC-21 with a
   `runuser` stub.
4. minor, Scope file list: retained (`kdrive-runner-nft.service`).

### v2 — 2026-11-06

BR-231 v1 asserted an empty `$RUNNER_TEMP` at step start, which the
implementation author flagged as likely unsatisfiable on a real runner
(`runs/72-development-1.md`); the owner chose a spec v2 before the first
real run. Only BR-231 and D-17 change; reviewed with the code review of
round 1.

# Self-hosted CI runner

Owner-run guide for the isolated self-hosted runner of
[F-015](../features/F-015-self-hosted-runner.md) and
[ADR-007](../architecture-decisions/ADR-007-isolated-self-hosted-runner.md).
Every CI job of `.github/workflows/ci.yml`, except the hosted `fork-refusal`
job, runs in a QEMU/KVM Lima VM on the owner's amd64 Linux server. Each job
gets a VM restored from a read-only golden disk, an ephemeral just-in-time
(JIT) runner registration and an egress filter enforced on the host.

The files, all under `ops/runner/`:

| File                                   | Side       | Role                                                                |
| -------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `ops/runner/install.sh`                | host, root | single entry point: install, `--check`, `--uninstall` (BR-233)      |
| `ops/runner/host-setup.sh`             | host, root | user, egress sets and units (BR-220)                                |
| `ops/runner/nftables.conf`             | host       | the `inet kdrive_runner` egress table (BR-219)                      |
| `ops/runner/kdrive-runner-nft.service` | host       | root oneshot that loads the egress table (BR-220)                   |
| `ops/runner/kdrive-ci-runner.service`  | host       | the supervisor unit, `User=kdrive-runner` (BR-220)                  |
| `ops/runner/egress-selftest.sh`        | host       | refuses to start a VM unless the filter answers `EPERM` (BR-224)    |
| `ops/runner/supervise.sh`              | host       | golden disk build and the per-job VM loop (BR-223, BR-224)          |
| `ops/runner/lima.yaml`                 | host       | the VM definition (BR-218)                                          |
| `ops/runner/provision.sh`              | VM, root   | Docker Engine and the runner image, once, in the golden VM (BR-221) |
| `ops/runner/Dockerfile`                | VM         | the thin `kdrive-ci-runner:local` image (BR-222)                    |
| `ops/runner/entrypoint.sh`             | VM         | reads and deletes the JIT file, then starts the runner (BR-222)     |
| `ops/runner/compose.yaml`              | VM         | the `runner` service (BR-222)                                       |
| `ops/runner/probe.sh`                  | VM         | acceptance probes and reset sentinels (BR-230, BR-231)              |

## Prerequisites

- An x86_64 Debian 12 host with KVM (`/dev/kvm`, group `kvm`), systemd,
  nftables (`/usr/sbin/nft`), `qemu-system-x86`, `qemu-utils` and `ovmf`.
  `install.sh` refuses to run without `x86_64`, `/dev/kvm` or `nft`.
- No `nftables.service` is required. The runner never loads or replaces
  `/etc/nftables.conf` and never flushes the ruleset, so tables owned by
  Docker or other services stay untouched. A host-wide ruleset reload (for
  example `nft -f` of a file that starts with a full flush) removes the
  runner table as well: after any such reload, run
  `sudo systemctl restart kdrive-runner-nft.service`, which also restarts
  the runner.
- The pinned Lima release **2.2.1**, tarball
  `lima-2.2.1-Linux-x86_64.tar.gz`, SHA-256
  `b391ac7fcac2b2a5a1628107756463188ded4d18d3104a40a66a8bb6fec01bcb`
  (from the release `SHA256SUMS`). `install.sh` downloads it, checks the
  SHA-256 and installs it in its own prefix `/opt/kdrive-runner/lima`. The
  units and the supervisor call that prefix only; any other `limactl` on the
  host (for example one in `/usr/local/bin`) is neither used nor replaced.
- The VM image is the Debian 12 `genericcloud` amd64 image named in
  `ops/runner/lima.yaml`, pinned by SHA-256.
- Outbound HTTPS from the host to GitHub, the container registries, npm, the
  Debian and Docker package servers and the Sonar server.

## Installation

Run everything from a checkout of this repository on the server:

```sh
sudo ops/runner/install.sh --token-file /path/to/token-file
sudo ops/runner/install.sh --check
sudo ops/runner/install.sh --token-file /path/to/token-file   # prints "already installed, no change"
```

- `--token-file <path>` installs or updates. The token is read only from that
  regular file, never from an argument, the environment or a prompt. The
  steps, each skipped when its target state already holds: copy
  `ops/runner/` to `/opt/kdrive-runner/ops` (root-owned), run
  `ops/runner/host-setup.sh`, install the pinned Lima release, store the token
  as `kdrive-runner`, enable and start `kdrive-runner-nft.service`, build the
  golden disk, enable and start `kdrive-ci-runner.service`.
- `--check` changes nothing and exits nonzero, with one line per difference,
  when the user, groups, egress files, loaded table, Lima version, golden
  overlay, token file mode and owner or unit state differ.
- `--uninstall` stops and disables `kdrive-ci-runner.service` first, then
  removes only what install mode created: both units, the
  `inet kdrive_runner` table, the Lima instance and golden overlay,
  `/opt/kdrive-runner` and the generated files of `/etc/kdrive-runner/`. It
  keeps the `kdrive-runner` user, its home, the token file, your
  `<path>` file and `/etc/kdrive-runner/extra-internal.conf`, and reminds you
  to revoke the token.

The output never contains the token, a JIT configuration, a host name or an
address. Remove the `<path>` file yourself once the installation succeeded.

## Host user and egress rules

`ops/runner/host-setup.sh` (run by `install.sh`) creates the host user
`kdrive-runner` with a home directory, member of the supplementary group
`kvm` only: never `sudo`, `wheel`, `adm` or `docker`, and no sudoers entry.
It installs `ops/runner/nftables.conf` as `/etc/kdrive-runner/nftables.conf`
and the two units, and writes `/etc/kdrive-runner/nft-sets.conf`:

- `resolvers`: the IPv4 `nameserver` lines of `/etc/resolv.conf`, the targets
  QEMU user-mode DNS forwards to. With systemd-resolved in uplink mode this is
  the upstream IPv4 resolver; IPv6 nameservers are ignored.
- `internal`: the prefix of every IPv4 route of every routing table except
  the default routes (Docker bridges, VPN and Tailscale tables included),
  every host IPv4 address prefix, and every prefix of the optional root-owned
  owner file `/etc/kdrive-runner/extra-internal.conf` (one prefix per line;
  list the site's public addresses there when the server sits behind NAT).

The table `inet kdrive_runner` applies only to packets of the
`kdrive-runner` user (QEMU and Lima run as that user): no IPv6 at all,
replies, the Lima SSH port `127.0.0.1:60022`, DNS to `resolvers`, and TCP 443
to IPv4 addresses that are not local to the host, not private and not in
`internal`; everything else is dropped. It sits before destination NAT, so
ports published by the host Docker engine are judged by their original
address.

**Re-run `sudo /opt/kdrive-runner/ops/host-setup.sh` after any host network
change** (new Docker network, VPN, address or resolver). It regenerates both
sets, restarts `kdrive-runner-nft.service` and exits nonzero when that fails.
It refuses to load anything when a set would be empty or when `9.9.9.9` would
be a resolver.

## Runner credential

The supervisor mints one JIT configuration per job with a **fine-grained
personal access token** (D-14):

- repository access: this repository only;
- permission: **Administration: read and write** (nothing else);
- expiry: at most 90 days.

`install.sh` stores it, as the `kdrive-runner` user and from stdin, in
`/home/kdrive-runner/.config/kdrive-runner/github-token` (mode `0600`, owner
`kdrive-runner`); a symlink at that path is refused. `ops/runner/supervise.sh`
reads it only from that file, sends it only to `https://api.github.com` on
curl's stdin, and stops before any call when the file is not a regular
`0600` file of that user. Never paste the token anywhere else (chat, issue,
PR, log or shell history).

Rotation, before expiry: create the new token with the same settings, write
it to a new `0600` file, run `sudo ops/runner/install.sh --token-file <new
file>` (it prints `token rotated`), delete that file, then revoke the old
token on GitHub.

## Golden disk

`ops/runner/supervise.sh golden` (run by `install.sh` as `kdrive-runner`)
self-tests the egress filter, creates the Lima instance `kdrive-ci` from
`ops/runner/lima.yaml`, copies `ops/runner/provision.sh`,
`ops/runner/Dockerfile`, `ops/runner/compose.yaml`, `ops/runner/entrypoint.sh`
and `ops/runner/probe.sh` into the VM, runs `provision.sh` (APT over HTTPS,
pinned Docker Engine with no TCP listener, the `kdrive-ci-runner:local`
image, `/home/runner/_work` owned by uid 1001), stops the VM and saves its
disk as `~kdrive-runner/.local/share/kdrive-runner/golden.qcow2`, mode `0444`
(a guard against mistakes only: the file belongs to the host user).

To rebuild it: `sudo systemctl stop kdrive-ci-runner.service`, then
`sudo runuser -u kdrive-runner -- /opt/kdrive-runner/ops/supervise.sh golden`,
then `sudo systemctl start kdrive-ci-runner.service`.

## Service

`kdrive-ci-runner.service` runs `/opt/kdrive-runner/ops/supervise.sh run` as
`kdrive-runner`. It requires `kdrive-runner-nft.service`: stopping or
restarting the egress unit stops or restarts the runner with it. Each cycle:
egress self-test (`ops/runner/egress-selftest.sh`: a UDP datagram to
`9.9.9.9:53` must fail at once with `EPERM`), forced stop of the VM, check
that no QEMU process of the instance remains, a fresh overlay backed by the
golden disk, VM start, one JIT configuration request, then the `runner`
container in the foreground until its single job ends. Any failure before the
runner start registers nothing and waits 60 seconds.

```sh
sudo systemctl status kdrive-ci-runner.service
sudo journalctl -u kdrive-ci-runner.service -f
```

## Repository settings and merge criterion

- Settings → Actions → General: **"Run workflows from fork pull requests"
  must stay disabled** (the real control against fork code on this runner).
- Branch protection and required status checks are unavailable on this
  repository's plan (F-011 D5, HTTP 403), so merge blocking stays procedural:
  a PR is merged only when the `ci-result` job succeeded on its head commit
  and the `fork-refusal` job did not fail (F-015 D-08). `ci-result` fails
  when the `changes` job did not succeed or when any job failed or was
  cancelled; records-only PRs skip the heavy jobs and still need `ci-result`.

## Acceptance

1. Run `sudo ops/runner/install.sh --token-file <path>`, then `--check`, then
   the install command again (AC-22); keep the sanitized outputs.
2. Start a loopback canary on the host port 47999 that counts connections.
3. Dispatch `.github/workflows/runner-acceptance.yml` with `lan_target` (a
   LAN host and open port) and `host_target` (the host's public address on
   443, listed in `extra-internal.conf` when behind NAT). The `probe` job
   masks both inputs and must print only `PASS` lines; `reset-check` must
   succeed on a different runner name than `reset-mark` (AC-14, AC-15).
4. Run `id kdrive-runner`, `sudo -l -U kdrive-runner`,
   `sudo runuser -u kdrive-runner -- /opt/kdrive-runner/lima/bin/limactl validate /opt/kdrive-runner/ops/lima.yaml`,
   `sudo nft list table inet kdrive_runner`, and during a probe job `ss -Hltnp`
   filtered to that user (AC-16).

Record in `runs/72-acceptance-1.md` and the ticket: the run ids, the
`PASS`/`FAIL` lines, the canary count (0), the runner names and those outputs,
with every host name, address and token removed.

## Secrets exposure

- T1: code of a same-repository PR job reaches the public internet on TCP 443
  and the host resolver, as on a hosted runner; a QEMU/KVM escape lands as the
  unprivileged `kdrive-runner` user, still filtered, able to read the token
  file.
- T4: whoever reads the token file administers the repository until the
  token expires or is revoked. Job code runs as the runner's user during its
  single job and can read that job's JIT configuration.
- T5: `SONAR_TOKEN`, `SONAR_PR_TOKEN` and `SONAR_HOST_URL` exist in the VM only
  during the analysis step; root in the VM during that same job can read them.
  The per-job reset ends the exposure; the host never receives them.

## Updating

Each update is a reviewed PR, then `sudo ops/runner/install.sh --token-file
<path>` with a fresh token file, which rebuilds what changed:

- runner image: the `FROM` digest in `ops/runner/Dockerfile` (the official
  `ghcr.io/actions/actions-runner` manifest-list digest of the new version) and
  the Compose plugin version and SHA-256;
- VM image: the location and SHA-256 in `ops/runner/lima.yaml` (Debian removes
  dated cloud images after some months);
- Docker Engine: the versions in `ops/runner/provision.sh`;
- Lima: `LIMA_VERSION` and `LIMA_SHA256` in `ops/runner/install.sh`.

After a change to `ops/runner/lima.yaml`, `ops/runner/provision.sh`,
`ops/runner/Dockerfile`, `ops/runner/compose.yaml` or
`ops/runner/entrypoint.sh`, rebuild the golden disk (see Golden disk).

## Rollback

1. Pause: `sudo systemctl stop kdrive-ci-runner.service` (or
   `sudo ops/runner/install.sh --uninstall`), then delete any remaining
   `kdrive-ci-…` runner under Settings → Actions → Runners and revoke the
   token if the runner is retired.
2. Restoring GitHub-hosted runners is a reviewed PR that reverts the
   `runs-on` values of `.github/workflows/ci.yml`; it needs hosted minutes.

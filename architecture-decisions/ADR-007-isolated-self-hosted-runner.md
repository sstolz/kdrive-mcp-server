# ADR-007 — Isolated self-hosted CI runner in a per-job Lima VM

Status: accepted (2026-11-06). Design of
[F-015 v2](../features/F-015-self-hosted-runner.md) (ticket #72, D-01 to D-17),
implemented in PR #73 and accepted on main `de9b283`
(acceptance (archived evidence `runs/72-acceptance-1.md`)).

## Context

GitHub Actions minutes for the private repository ran out on 2026-11-06, so
the mandatory CI of F-011 and F-013 stopped running. The owner decided to run
CI on a self-hosted runner on the owner's amd64 Linux server. That server has
KVM, but it also runs other services and a Docker engine that must not be
exposed, sits on a LAN, and holds no secret that CI may read. CI jobs need a
Docker engine (Docker-only development), run third-party dependency code from
same-repository PRs, and the `main` `sonar` job receives `SONAR_TOKEN`. The
plan offers no branch protection or required checks (F-011 D5).

## Decision

- Run every job except the hosted `fork-refusal` job in a QEMU/KVM Lima VM in
  `plain` mode with user-mode networking only: no mount, no port forward, no
  extra network, no host resolver (BR-218).
- Enforce egress on the host with an `nftables` table matching the user id of
  the unprivileged `kdrive-runner` user that owns QEMU and Lima: no IPv6,
  TCP 443 to public IPv4 only, DNS to the recorded resolvers, the Lima SSH
  port; host-local, private and host-attached prefixes are dropped (BR-219,
  BR-220). The table is loaded by its own root oneshot before any VM, and the
  supervisor self-tests it before every VM start (BR-224).
- Start every job from a read-only golden disk overlay, so no state survives
  between jobs (BR-224, BR-231).
- Register one ephemeral runner per job through a JIT configuration minted on
  the host with a fine-grained token that never enters the VM (BR-222,
  BR-223, D-14).
- Use a thin image derived from the digest-pinned official runner image
  (BR-222), Docker Engine pinned inside the VM (BR-221), and an idempotent
  owner-run installer with `--check` and `--uninstall` (BR-233).
- Keep merge blocking procedural on `ci-result` (BR-227, D-08).

## Options rejected

- The runner on the host or in a host container: jobs need Docker, which
  means the host engine or a privileged host container — host root for any PR
  job.
- Rootless Docker on the host: a shared kernel, and the host network and
  loopback services stay reachable.
- Firecracker or Kata: stronger isolation primitives, but more components to
  operate than this single-owner server warrants.
- A firewall inside the VM: jobs are root in the VM through Docker and can
  change it.
- A host-name allowlisting egress proxy: one more service, plus proxy settings
  in Docker, npm and the runner.
- A bridged or `socket_vmnet` network: traffic is no longer tied to one host
  user id, so the host filter loses its anchor.
- Cleaning one long-lived VM between jobs (`docker system prune`): root in the
  VM can persist outside Docker.
- A registration token with `config.sh --ephemeral` inside the VM: the minting
  credential or a reusable token would sit in the VM.

## Consequences

- Any public IPv4 host on port 443 is reachable from a job, as from a hosted
  runner; exfiltration of what a job already holds stays possible (T1, T5).
- A QEMU/KVM escape lands as the unprivileged host user, still filtered, but
  able to read the token file (T1, T4).
- Each job pays a VM boot and has no Docker or npm cache (D-03); one job runs
  at a time.
- The owner operates new host state: a user, two units, an nftables table, a
  pinned Lima release, a golden disk and a token to rotate within 90 days
  ([guide](../docs/self-hosted-runner.md)).
- Fork pull requests are kept off the runner by the repository setting; the
  workflow guard is defence in depth.
- Restoring hosted runners is a reviewed PR that reverts `runs-on`.

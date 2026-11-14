---
id: F-029
title: Persisted OAuth proxy state in the owner-run HTTP acceptance launcher
ticket: "#25"
status: draft
version: 1
---

# F-029 — Persisted OAuth proxy state in the owner-run HTTP acceptance launcher

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `01b43ff` (main `7a8c239`).
IDs: F-029; BR-396–BR-398 v1; BR-171 v3. No ADR: the change is confined to
an owner-run launcher and is cheap to reverse. Next free IDs checked on main
`7a8c239` (`docs/spec-index.md`, `business-rules/`): F-029, BR-396, ADR-012.

## Context

`make http-acceptance` (F-012, BR-171 v2) starts `scripts/http-acceptance.ts`
in the dev Compose service through `scripts/http-acceptance-entry.sh`. The
entry script validates an external secrets directory and mounts only its two
files read-only at `/run/secrets` (F-012 D-20). The launcher copies a fixed
list of settings (`SETTINGS`) from its environment into `startAcceptance`.

F-028 (#3) is done, but its owner-run claude.ai check (F-028 v2 D-13) is
blocked: the check restarts the server and expects the connected client to
keep working without a new login, which needs the F-019 OAuth state file
(`OAUTH_STATE_FILE`). The launcher does not list `OAUTH_STATE_FILE` in
`SETTINGS`, and the entry script neither forwards it nor mounts a writable
directory, so the proxy keeps its state in memory and a restart loses every
client and refresh family. F-028 AC-12 (`tests/http/cimd-rehearsal.test.ts`)
injects the state file straight into `startAcceptance` and so never exercised
the launcher; the gap surfaced only in code review (learnings 2026-11-14).

Users affected: the owner, who runs the acceptance launcher behind a tunnel
and connects claude.ai to it. No production code path, client or published
package changes.

## Scope

- `scripts/http-acceptance.ts`: accept `OAUTH_STATE_FILE`, through one
  exported settings filter that `main()` uses (BR-396).
- `scripts/http-acceptance-entry.sh`: an optional private, writable state
  directory outside the checkout, `HTTP_ACCEPTANCE_STATE_DIR`, validated like
  the secrets directory, mounted read-write at `/run/oauth-state` for that run
  only, with a fixed `OAUTH_STATE_FILE` forwarded (BR-397, BR-171 v3).
- A rehearsal that drives the real launcher path end to end against the
  existing test doubles, restart included (AC-05).
- `docs/oauth-proxy.md` owner-run section and the `make help` line (BR-398).
- Records: BR-396–BR-398 and BR-171 v3 files (pending acceptance),
  `docs/spec-index.md` (F-029 row; F-028 row and #3 line say the owner run is
  unblocked once F-029 is accepted), CHANGELOG Unreleased `Changed`.
- Once F-029 is accepted, the F-028 owner run (F-028 v2 D-13) is unblocked and
  follows the procedure below. The F-028 file (done) is not edited, but its
  owner-run wording "with `OAUTH_STATE_FILE` set" is replaced by this
  procedure, which sets `HTTP_ACCEPTANCE_STATE_DIR` instead (BR-397 (1)
  refuses `OAUTH_STATE_FILE`); the `docs/spec-index.md` F-028 row and #3 line
  point to this procedure.

### Out of scope

- OAuth proxy behaviour, the state-file format, its checks (F-019, BR-293)
  and its error codes.
- The secrets directory rules of BR-171 v2 (unchanged).
- Production deployment (`docs/deployment.md`, F-013).
- Running the owner check itself; it is recorded on #3 after F-029 is
  accepted.

## Business rules

- **BR-396** — `scripts/http-acceptance.ts` exports `acceptanceSettings(env)`,
  which returns exactly the non-empty values of the BR-171 settings
  (`MCP_PUBLIC_URL`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `OAUTH_ISSUER`,
  `OAUTH_ALLOWED_SUBJECTS`, `OAUTH_ALLOWED_EMAILS`, `OAUTH_UPSTREAM_CLIENT_ID`,
  `OAUTH_UPSTREAM_CLIENT_SECRET`, `OAUTH_UPSTREAM_CLIENT_SECRET_FILE`,
  `OAUTH_SIGNING_KEY_FILE`, `OAUTH_ALLOWED_REDIRECT_URIS`,
  `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`) plus `OAUTH_STATE_FILE`, and no other
  name; `main()` passes `acceptanceSettings(process.env)` as the only `env` of
  `startAcceptance`, with no other option. Verified by: AC-01, AC-05.
- **BR-397** — `scripts/http-acceptance-entry.sh`, after the BR-171 v2 checks
  and before any Docker command or Make prerequisite, refuses with exit status
  1 and exactly one fixed stderr line that never contains a path or file
  content, in this order (first failure wins):
  (1) `OAUTH_STATE_FILE` is non-empty in its environment
  (`Do not set OAUTH_STATE_FILE; set HTTP_ACCEPTANCE_STATE_DIR to persist the acceptance OAuth state.`);
  when `HTTP_ACCEPTANCE_STATE_DIR` is unset or empty, no further state check
  runs and no state directory is mounted; otherwise
  (2) the value does not start with `/`, contains `:` or a newline, or has a
  `.` or `..` path component
  (`Set HTTP_ACCEPTANCE_STATE_DIR to an absolute directory outside the checkout.`);
  (3) the value without trailing `/` is a symlink or does not resolve to an
  existing directory, or the directory is not readable, writable and
  searchable (`The acceptance state directory is unavailable.`);
  (4) its physical path equals, lies under or is an ancestor of the checkout's
  physical path, is `/`, or contains `:` or a newline
  (`The acceptance state directory is inside the dev checkout.`);
  (5) its physical path equals, lies under or is an ancestor of the secrets
  directory's physical path
  (`The acceptance state directory overlaps the secrets directory.`); the
  "lies under" branch is defence in depth that the BR-171 v2 "holds other
  entries" check of the secrets directory already refuses first, so no test
  reaches it;
  (6) its mode grants any permission to group or others, read through POSIX
  `find "$d" -prune \( -perm -040 -o -perm -020 -o -perm -010 -o -perm -004
  -o -perm -002 -o -perm -001 \)` (ACLs are not read; see D-3)
  (`The acceptance state directory is not private.`);
  (7) it holds an entry, hidden ones included, other than `oauth-state.sqlite`
  and `oauth-state.sqlite-journal`
  (`The acceptance state directory holds other entries.`);
  (8) either of those two entries exists and is a symlink or not a regular
  file (`An acceptance state file is unavailable.`).
  On success the single `compose run` adds
  `--volume <physical path>:/run/oauth-state` (read-write) and
  `-e OAUTH_STATE_FILE=/run/oauth-state/oauth-state.sqlite`. The checks and
  the mount are not atomic (accepted residual risk, as F-012 D-20 for the
  secrets mount; see D-3).
  Verified by: AC-02, AC-03, AC-05.
- **BR-171 v3** — v2 holds, except clause (7): the one `compose run` carries
  the v2 arguments and, only when `HTTP_ACCEPTANCE_STATE_DIR` is set, the two
  BR-397 arguments; without it the arguments are exactly the v2 ones. The
  secrets directory stays the only read-only mount and holds only its two
  files; the state directory is the only other mount; no other Make target or
  Compose service mounts either directory, and no tracked file under
  `Makefile`, `compose.yaml`, `scripts/` or `docs/` names a state path inside
  the checkout (as AC-04 scans it). The BR-171 file gets `version: 3`, its
  `source:` gains `F-029 v1`, a History line "v3 — <date> — F-029 v1 (#25) —
  optional state directory mount; pending acceptance", and the existing
  `BR-171 v2 AC-25` tests in `tests/http/acceptance-entry.test.ts` are renamed
  `BR-171 v3 AC-25` with unchanged assertions. Verified by: AC-03, AC-04.
- **BR-398** — `docs/oauth-proxy.md`, section "Owner-run acceptance
  composition", states that `HTTP_ACCEPTANCE_STATE_DIR` is optional, that
  without it a restart loses every client and login, the directory
  requirements of BR-397 (absolute, outside the checkout and the secrets
  directory, owned by the dev container user, mode `0700`, holding nothing
  but the state file and its journal), that on Linux the host account that
  owns the directory must have the uid the dev image was built with
  (`DEV_UID=… make setup`, `docs/development.md`), otherwise the server stops
  with `OAUTH_STATE_UNAVAILABLE`, that one tunnel and the same
  `MCP_PUBLIC_URL` must be kept across restarts (if the tunnel dies, its new
  URL needs a new `MCP_PUBLIC_URL`, and starting with it fails with
  `OAUTH_STATE_MISMATCH`; then delete `oauth-state.sqlite` and its `-journal`
  while stopped and start over), that it is a credential store
  (delete `oauth-state.sqlite` and its `-journal` while stopped to revoke
  everything), shows the command
  `HTTP_ACCEPTANCE_SECRETS_DIR=/abs/secrets HTTP_ACCEPTANCE_STATE_DIR=/abs/state make http-acceptance`,
  and lists the F-028 owner-run steps of this spec; the `make help` line for
  `http-acceptance` names `HTTP_ACCEPTANCE_STATE_DIR`. Verified by: AC-06.

## Acceptance criteria

- **AC-01** (BR-396) — Given an environment holding every BR-396 name with a
  value, `OAUTH_STATE_FILE=""`, `KDRIVE_TOKEN`, `OAUTH_MODE` and `HOME`, When
  `acceptanceSettings` reads it, Then the result holds exactly the BR-396 names
  with values, without `OAUTH_STATE_FILE` when it is empty and never the
  other three; and the source of `main()` calls
  `startAcceptance({ env: acceptanceSettings(process.env) })`. Verified by:
  `BR-396 AC-01` in `tests/http/acceptance-composition.test.ts`.
- **AC-02** (BR-397) — Given the AC-25 fixture checkout with a valid secrets
  directory and one variant per BR-397 refusal (1)–(8), with these
  sub-cases: (2) a relative path, a `..` component and a `:`; (3) a missing
  path and a symlink to a directory; (4) the checkout, a directory under it,
  an ancestor of it; (5) the secrets directory itself and an ancestor
  of it; (6) mode `0750` and mode `0701`; (7) a `.hidden` file; (8)
  `oauth-state.sqlite` as a symlink and as a directory, When `make http-acceptance` runs with a fake `docker`, Then it
  exits 1, stderr is exactly the fixed line, no Docker command or `build`
  runs, and output contains neither path nor file content. Verified by:
  `BR-397 AC-02` in `tests/http/acceptance-entry.test.ts`.
- **AC-03** (BR-397, BR-171 v3) — Given a valid secrets directory, When
  `make http-acceptance` runs (a) without `HTTP_ACCEPTANCE_STATE_DIR`, (b) with
  an empty private state directory, (c) with one holding regular
  `oauth-state.sqlite` and `oauth-state.sqlite-journal` files, Then (a)'s run
  arguments equal the v2 arguments, and (b) and (c) each run `build` then one
  `compose run` that adds `--volume <physical state path>:/run/oauth-state`
  without `:ro` and `-e OAUTH_STATE_FILE=/run/oauth-state/oauth-state.sqlite`,
  with the secrets mount unchanged. Verified by: `BR-397 BR-171 v3 AC-03` in
  `tests/http/acceptance-entry.test.ts`.
- **AC-04** (BR-171 v3) — Given the tracked tree, When `Makefile`,
  `compose.yaml`, `scripts/` and `docs/` are scanned, Then only the entry
  script mounts `/run/oauth-state`, only the `http-acceptance` recipe and help
  line, the entry script and `docs/oauth-proxy.md` name
  `HTTP_ACCEPTANCE_STATE_DIR`, no `OAUTH_STATE_FILE=` value is relative or
  under `/workspace`, and no `oauth-state.sqlite` path appears other than under
  `/run/oauth-state` or in the `docs/oauth-proxy.md` examples. Verified by: `BR-171 v3 AC-04` in
  `tests/http/acceptance-entry.test.ts`.
- **AC-05** (BR-396, BR-397, BR-171 v3) — launcher rehearsal of the owner run.
  Given the AC-25 fixture checkout, a fake `docker` that records each argument
  separately, a synthetic secrets directory, an empty `0700` state directory,
  and the F-028 AC-12 doubles (`FakeUpstream`, the CIMD document double and
  its fetch seam), When the test runs `make http-acceptance` with the owner
  environment of the procedure below, builds the container environment from
  the recorded run arguments only (`-e NAME=value` as given, `-e NAME` from the
  environment passed to `make`, values under a mounted container path mapped
  to the host directory, mount targets parsed only from recorded `--volume`
  arguments, the test failing when any `*_FILE` value is not under a recorded
  mount target, and `MCP_HTTP_HOST=0.0.0.0` replaced by `127.0.0.1`
  for the loopback publish; no other substitution), passes it through
  `acceptanceSettings` into `startAcceptance` with only the test seams
  (`upstream`, `clientMetadataSeam`, `stderr`), follows the procedure steps
  2–5 (discovery with a placeholder origin, origin found, consent page showing
  the client host, upstream login, tokens, a tool call), closes the server,
  runs `make http-acceptance` again on the same state directory and starts the
  composition the same way, Then the second entry run passes with the state
  file present and records the same `OAUTH_STATE_FILE`, the run-1 access token
  makes a tool call, the run-1 refresh token is exchanged and its access token
  makes a tool call, no authorize, consent or upstream token request happens
  in run 2, and the state directory holds only `oauth-state.sqlite` and at
  most `oauth-state.sqlite-journal`. Verified by: `BR-396 BR-397 BR-171 v3 AC-05` in
  `tests/http/launcher-state-rehearsal.test.ts`.
- **AC-06** (BR-398) — Given `docs/oauth-proxy.md` and `make help`, When they
  are read, Then they hold the BR-398 statements and command, and the help
  line names `HTTP_ACCEPTANCE_STATE_DIR`. Verified by: `BR-398 AC-06` in
  `tests/http/acceptance-entry.test.ts`.
- **AC-07** (gate) — `make check` passes in Docker. Verified by: `make check`.

### Owner-run procedure (F-028 v2 D-13; after acceptance, not a merge condition)

Rehearsed end to end by AC-05 (AGENTS.md §6). Recorded on #3.

1. After pulling main, run `make setup` (learnings 2026-11-10); on Linux your
   account's uid must be the `DEV_UID` the image was built with
   (`docs/development.md`). Create a state directory outside the checkout,
   owned by that account, `chmod 700`, empty.
2. Start one quick tunnel and keep it running until step 5; set
   `MCP_PUBLIC_URL` to its URL (learnings 2026-11-04) and keep it for every
   start below; set
   `OAUTH_ISSUER`, `OAUTH_ALLOWED_SUBJECTS`, `OAUTH_UPSTREAM_CLIENT_ID`,
   `OAUTH_ALLOWED_REDIRECT_URIS` and a placeholder
   `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`; run
   `HTTP_ACCEPTANCE_SECRETS_DIR=… HTTP_ACCEPTANCE_STATE_DIR=… make http-acceptance`.
3. Add the connector in claude.ai; read the `client_id` origin from the
   refused authorize address bar (F-028 discovery procedure); stop the server.
4. Set `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` to that origin, start again with the
   same state directory, connect claude.ai, check that the consent page shows
   the client host, approve, log in upstream, call a tool. If the tunnel died
   since step 2, see the recovery in step 5.
5. Stop and start the server again with the same settings, tunnel and
   directory; call a tool from the same claude.ai conversation without logging
   in again. If the tunnel died, its new URL needs a new `MCP_PUBLIC_URL`, and
   starting with it fails with `OAUTH_STATE_MISMATCH`: stop, delete
   `oauth-state.sqlite` and its `-journal`, and start over from step 2.
6. Record the origin in the client matrix and the result on #3. To clean up,
   stop the server and delete the state directory.

## Decisions

- **D-1 — The owner names a directory; the entry sets the file path.**
  `HTTP_ACCEPTANCE_STATE_DIR` is mounted at `/run/oauth-state` and
  `OAUTH_STATE_FILE` is fixed to `/run/oauth-state/oauth-state.sqlite`.
  Rejected: forwarding the owner's `OAUTH_STATE_FILE` as is (a host path does
  not exist in the container, and a relative or checkout path would land in the
  read-write dev mount that D-20 took credentials out of); a named Docker
  volume (the owner cannot inspect or delete the file as `docs/oauth-proxy.md`
  instructs, and its owner is not the dev user); a file in the secrets
  directory (that mount would have to become writable, exposing the signing
  key to writes).
- **D-2 — Optional, refused when half-set.** Without the variable the run is
  exactly v2 (in memory), so F-012 runs are unchanged; a non-empty
  `OAUTH_STATE_FILE` is refused so an owner who expects persistence never gets
  a silent in-memory run. Rejected: making it mandatory (no need outside the
  restart check); ignoring `OAUTH_STATE_FILE` silently.
- **D-3 — Directory guard mirrors the secrets guard, plus privacy.** Same
  lexical, symlink, checkout and allowed-entry checks as BR-171 v2; in
  addition no overlap with the secrets directory (a writable ancestor would let
  the container replace the key) and no group or other permission, stricter
  than BR-293's no group or other write, because the file is a credential
  store. The owner and uid check stays with the store at startup
  (`OAUTH_STATE_UNAVAILABLE`); the entry does not duplicate it, because on
  Docker Desktop for macOS bind-mount ownership is mapped and a host-side uid
  check against `DEV_UID` would refuse valid setups; the Linux uid requirement
  is documented instead (BR-398). Residual risks accepted: the checks and the
  mount are not atomic (as F-012 D-20); `--volume` creates a missing host path
  as root if it disappears between check and mount (the store then refuses
  it); ACLs can grant access the mode bits do not show. Rejected: reusing
  BR-293's looser mode rule (lets other accounts list the directory); a
  host-side owner check (above).
- **D-4 — The rehearsal drives the entry and the exported filter; Docker is
  emulated by path mapping.** The test runs the real Make recipe and entry
  script, derives the container environment only from the recorded arguments,
  and goes through `acceptanceSettings`, the function `main()` uses. Rejected:
  injecting `OAUTH_STATE_FILE` into `startAcceptance` (the F-028 AC-12 gap,
  learnings 2026-11-14); spawning `node scripts/http-acceptance.ts` (the real
  upstream needs a network OIDC double and `main()` has no CIMD seam);
  running real Docker in the gate (no Docker in the dev container). Residual
  gaps, covered only by the owner run: the bind mount itself and the uid as
  seen by the store; `main()`'s own code (AC-01 checks its source text only);
  SIGINT and close under `compose run --rm` with a TTY; the `:ro` flag and
  Compose's handling of `-e NAME`; the real upstream provider and CIMD network
  path.
- **D-5 — No ADR.** The launcher is owner tooling, outside the package, and the
  change is reversible by removing the variable.

## Open questions

## Stress-test

Review 1 (25-spec-review-1-reviewer), `changes` on `dda646d`; all findings
retained (applied by the orchestrator, economical mode agreed with the owner):

1. [major] Uid requirement: BR-398, step 1 and D-3/D-4 state that on Linux the
   directory owner's uid must equal the image's `DEV_UID`; the optional
   host-side owner refusal is rejected (Docker Desktop for macOS maps
   ownership), see D-3.
2. [major] Tunnel: steps 2 and 5 and BR-398 keep one tunnel and one
   `MCP_PUBLIC_URL` across restarts and give the recovery for
   `OAUTH_STATE_MISMATCH`.
3. [minor] Scope states that this procedure replaces F-028's
   "`OAUTH_STATE_FILE` set" wording; the spec-index F-028 row and #3 line
   point here.
4. [minor] D-4 lists every part the rehearsal leaves to the owner run.
5. [minor] AC-05 parses mount targets only from recorded `--volume` arguments
   and fails on any `*_FILE` value outside them.
6. [minor] BR-397 (5) "lies under" is marked defence in depth; AC-02 lists its
   sub-cases.
7. [minor] AC-04 gives a concrete scan.
8. [minor] Check-then-mount race, root-created path and ACLs are recorded as
   residual risks; (6) is read through POSIX mode tests.
9. [minor] BR-171 v3 source, History line, renamed v2 tests and the AC-05
   test name are specified.

Review 2 (25-spec-review-2-reviewer), `changes` on `f59775c` with three minor
findings; all retained (applied by the orchestrator):

1. AC-02 drops `/` from the (4) sub-cases: refusal (3) stops it first for a
   non-root test user.
2. The tunnel recovery says a dead tunnel needs a new `MCP_PUBLIC_URL`, which
   then fails with `OAUTH_STATE_MISMATCH`; step 4 points to it.
3. Check (6) gives the exact POSIX `find -perm` expression.

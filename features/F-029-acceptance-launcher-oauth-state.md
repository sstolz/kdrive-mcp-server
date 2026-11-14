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
  follows the procedure below. F-028 is not changed.

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
  (`The acceptance state directory overlaps the secrets directory.`);
  (6) its mode grants any permission to group or others
  (`The acceptance state directory is not private.`);
  (7) it holds an entry, hidden ones included, other than `oauth-state.sqlite`
  and `oauth-state.sqlite-journal`
  (`The acceptance state directory holds other entries.`);
  (8) either of those two entries exists and is a symlink or not a regular
  file (`An acceptance state file is unavailable.`).
  On success the single `compose run` adds `--volume <physical path>:/run/oauth-state`
  (read-write) and `-e OAUTH_STATE_FILE=/run/oauth-state/oauth-state.sqlite`.
  Verified by: AC-02, AC-03, AC-05.
- **BR-171 v3** — v2 holds, except clause (7): the one `compose run` carries
  the v2 arguments and, only when `HTTP_ACCEPTANCE_STATE_DIR` is set, the two
  BR-397 arguments; without it the arguments are exactly the v2 ones. The
  secrets directory stays the only read-only mount and holds only its two
  files; the state directory is the only other mount; no other Make target or
  Compose service mounts either directory, and no tracked file under
  `Makefile`, `compose.yaml`, `scripts/` or `docs/` names a state path inside
  the checkout. Verified by: AC-03, AC-04.
- **BR-398** — `docs/oauth-proxy.md`, section "Owner-run acceptance
  composition", states that `HTTP_ACCEPTANCE_STATE_DIR` is optional, that
  without it a restart loses every client and login, the directory
  requirements of BR-397 (absolute, outside the checkout and the secrets
  directory, owned by the dev container user `DEV_UID`, mode `0700`, holding
  nothing but the state file and its journal), that it is a credential store
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
  directory and one variant per BR-397 refusal (1)–(8) (for (6) mode `0750`;
  for (7) a `.hidden` file; for (8) `oauth-state.sqlite` as a symlink and as a
  directory), When `make http-acceptance` runs with a fake `docker`, Then it
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
  `HTTP_ACCEPTANCE_STATE_DIR`, and no file names a state path inside the
  checkout. Verified by: `BR-171 v3 AC-04` in
  `tests/http/acceptance-entry.test.ts`.
- **AC-05** (BR-396, BR-397, BR-171 v3) — launcher rehearsal of the owner run.
  Given the AC-25 fixture checkout, a fake `docker` that records each argument
  separately, a synthetic secrets directory, an empty `0700` state directory,
  and the F-028 AC-12 doubles (`FakeUpstream`, the CIMD document double and
  its fetch seam), When the test runs `make http-acceptance` with the owner
  environment of the procedure below, builds the container environment from
  the recorded run arguments only (`-e NAME=value` as given, `-e NAME` from the
  environment passed to `make`, values under a mounted container path mapped
  to the host directory, and `MCP_HTTP_HOST=0.0.0.0` replaced by `127.0.0.1`
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
  most `oauth-state.sqlite-journal`. Verified by: `BR-396 BR-397 AC-05` in
  `tests/http/launcher-state-rehearsal.test.ts`.
- **AC-06** (BR-398) — Given `docs/oauth-proxy.md` and `make help`, When they
  are read, Then they hold the BR-398 statements and command, and the help
  line names `HTTP_ACCEPTANCE_STATE_DIR`. Verified by: `BR-398 AC-06` in
  `tests/http/acceptance-entry.test.ts`.
- **AC-07** (gate) — `make check` passes in Docker. Verified by: `make check`.

### Owner-run procedure (F-028 v2 D-13; after acceptance, not a merge condition)

Rehearsed end to end by AC-05 (AGENTS.md §6). Recorded on #3.

1. After pulling main, run `make setup` (learnings 2026-11-10). Create a state
   directory outside the checkout, owned by your account, `chmod 700`, empty.
2. Set `MCP_PUBLIC_URL` (the tunnel URL, learnings 2026-11-04),
   `OAUTH_ISSUER`, `OAUTH_ALLOWED_SUBJECTS`, `OAUTH_UPSTREAM_CLIENT_ID`,
   `OAUTH_ALLOWED_REDIRECT_URIS` and a placeholder
   `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`; run
   `HTTP_ACCEPTANCE_SECRETS_DIR=… HTTP_ACCEPTANCE_STATE_DIR=… make http-acceptance`.
3. Add the connector in claude.ai; read the `client_id` origin from the
   refused authorize address bar (F-028 discovery procedure); stop the server.
4. Set `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` to that origin, start again with the
   same state directory, connect claude.ai, check that the consent page shows
   the client host, approve, log in upstream, call a tool.
5. Stop and start the server again with the same settings and directory; call
   a tool from the same claude.ai conversation without logging in again.
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
  (`OAUTH_STATE_UNAVAILABLE`); the entry does not duplicate it. Rejected:
  reusing BR-293's looser mode rule (lets other accounts list the directory).
- **D-4 — The rehearsal drives the entry and the exported filter; Docker is
  emulated by path mapping.** The test runs the real Make recipe and entry
  script, derives the container environment only from the recorded arguments,
  and goes through `acceptanceSettings`, the function `main()` uses. Rejected:
  injecting `OAUTH_STATE_FILE` into `startAcceptance` (the F-028 AC-12 gap,
  learnings 2026-11-14); spawning `node scripts/http-acceptance.ts` (the real
  upstream needs a network OIDC double and `main()` has no CIMD seam);
  running real Docker in the gate (no Docker in the dev container). Residual
  gap, covered by the owner run: the bind mount itself and the `DEV_UID`
  ownership as seen by the store.
- **D-5 — No ADR.** The launcher is owner tooling, outside the package, and the
  change is reversible by removing the variable.

## Open questions

## Stress-test

Not yet reviewed.

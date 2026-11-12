---
id: F-023
title: Hosted CI runners and a secret-fed privacy scan
ticket: "#1"
status: draft
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-12.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `f0983c4`. IDs: F-023,
BR-341–BR-352, BR-015 v7, BR-149 v3, BR-183 v3, BR-225 v2, BR-227 v2,
BR-229 v2; no ADR. BR-291 and BR-305–BR-311 are reserved and not used.
Ticket numbers: `#1` is this repository's ticket; older `#N` in cited
records refer to the archive (PROJECT.md "Repository and ticket numbering").

## Context

Development moved from the private archive to this repository, which is to
become public. Every `ci.yml` job except `fork-refusal` runs on the owner's
self-hosted label array (BR-225 v1), and `runner-acceptance.yml` runs only
there (BR-229 v1). A self-hosted runner must never be attached to a public
repository: a fork pull request could run code on it. Until now the archive's
`public-export` deny scan kept private names, hosts and links out of the
public tree; in this repository nothing scans pushed content or commit
messages.

Users affected: maintainers and agents (CI logs, required checks) and the
owner (provisions the deny-pattern secret, keeps the optional runner setup).
The MCP server and its users are unaffected.

Owner decisions 2026-11-12: (1) every `ci.yml` job runs on GitHub-hosted
`ubuntu-24.04`; the runner setup stays as optional documentation, never
attached here; (2) a new `privacy-scan` job reads the deny patterns only from
the repository secret `PRIVACY_DENY_PATTERNS`, fails closed and never prints
what it matched; (3) CI minutes consumed while the repository is private are
accepted; (4) the Sonar secrets `SONAR_HOST_URL`, `SONAR_TOKEN`,
`SONAR_PR_TOKEN` and the variable `SONAR_ENABLED` were recreated; Sonar jobs
keep their rules and change only `runs-on`.

### Self-hosted dependencies checked

- Docker engine and Buildx: `ubuntu-24.04` images ship both; `make
  image-binfmt` needs `docker run --privileged`, allowed on hosted runners.
- Caches: none. F-015 left image pre-pulling out of scope; no rule reads a
  runner-local cache, volume or path; `/home/runner/_work` (BR-220 area) is
  runner-internal only.
- Platform: x64 only; arm64 images are built under QEMU (BR-188), as before.
- Network: BR-219 egress filtering disappears (hosted runners have open
  egress). Sonar needs the owner's Sonar host reachable from GitHub-hosted
  addresses (D-13 of F-015 already relied on a public server; verified only
  by AC-13).
- Timing: the arm64 `image` leg under QEMU on a hosted runner may be slower
  than on the owner's server (see D-2).

### Threat model

- T1 fork code on owner hardware: removed by hosted runners (BR-225 v2,
  BR-229 v2, BR-351).
- T2 deny list disclosure: the patterns themselves name what must stay private;
  printing, echoing, writing or passing them as arguments leaks them (BR-342,
  BR-348).
- T3 matched-text disclosure: printing a hit's text republishes the leak in a
  public log (BR-348).
- T4 silent pass: a missing secret (fork, Dependabot, deleted secret) or an
  unparseable pattern turning the scan into a no-op (BR-344, BR-350).
- T5 secret exposure to, or scan bypass by, same-repository code: fork PRs get
  no secrets from GitHub. Same-repository authors (the owner and agents under
  review) are trusted: the scan guards against accidental leaks, not against a
  malicious collaborator. On `pull_request` the workflow file, the Make target
  and the scanner all come from the PR merge ref, so a PR could read the env or
  weaken the scan; a trusted-ref scanner checkout would add nothing, because
  the workflow itself is the PR's. Residual risk accepted (same trust level as
  the Sonar steps): any change to the scanner, the workflow or the Make target
  is caught by the mandatory independent review (D-10).
- T6 detection after the fact: a push to `main` (or a squash message edited at
  merge) is scanned only once public; the PR scan is the preventive check.
- T7 pathological pattern: a pattern with catastrophic backtracking (ReDoS)
  can stall the scan. Residual risk accepted: the job's 20-minute timeout
  cancels it, and `ci-result` fails on a non-success `privacy-scan` (fails
  closed).

## Scope

1. `ci.yml`: every job on `ubuntu-24.04`; new job `privacy-scan`; `ci-result`
   requires it.
2. `scripts/privacy-scan.ts` (Node built-ins only) and `make privacy-scan`
   (dev container, no `make setup`), with unit tests on synthetic patterns
   in `tests/privacy-scan.test.ts`.
3. `runner-acceptance.yml` kept, guarded so it never runs in this repository.
4. `tests/helpers/ci-policy.ts` and `tests/ci-policy.test.ts` updated to the
   versioned rules; `docs/self-hosted-runner.md` safety statement;
   `BR-015.md` v7 and the other versioned rule files.

### Out of scope

- Removing `ops/runner/`, `docs/self-hosted-runner.md` or
  `runner-acceptance.yml`; any change to their scripts.
- The archive's built-in e-mail rule, allowed literals, binary allowlist and
  substitutions (D-4).
- Rewriting existing history (an owner decision before going public, D-6);
  scanning issues, comments or PR edits made
  after the last CI run (T6, D-6).
- Sonar behaviour, tokens, conditions or summaries (F-011, F-022).
- Provisioning the secret (owner action before acceptance).

## Business rules

- **BR-341** — `ci.yml` has a job `privacy-scan` on `ubuntu-24.04` with
  `permissions: contents: read`, `timeout-minutes: 20`, no `needs`, no job
  `if`, no job `env`, and exactly three steps: (1) the
  BR-350 notice step; (2) the pinned checkout with `fetch-depth: 0` and
  `persist-credentials: false`; (3) `make privacy-scan`. The job does not run
  `make setup` (BR-352). Steps 2–3 have the `if` exactly
  `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`.
  Step 3 `env` is exactly `PRIVACY_DENY_PATTERNS: ${{ secrets.PRIVACY_DENY_PATTERNS }}`,
  `PRIVACY_EVENT: ${{ github.event_name }}`,
  `PRIVACY_RANGE_BASE: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}`,
  `PRIVACY_RANGE_HEAD: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}`,
  `PRIVACY_PR_TITLE: ${{ github.event.pull_request.title }}`,
  `PRIVACY_PR_BODY: ${{ github.event.pull_request.body }}`. Verified by: AC-01, AC-02.
- **BR-342** — `secrets.PRIVACY_DENY_PATTERNS` appears only in step 3 of
  `privacy-scan`; no Sonar secret appears in `privacy-scan`. `make
  privacy-scan` passes every `PRIVACY_*` variable to the dev container by name
  (`-e NAME`, never `-e NAME=value`), and the script never writes the pattern
  text to a file, argv, stdout or stderr. Verified by: AC-02, AC-12.
- **BR-343** — The secret is parsed like the archive's `deny-patterns.txt`:
  split on `\n` (a trailing `\r` removed), each line trimmed; empty lines and
  lines starting with `#` are skipped; every other line is one JavaScript regex
  compiled with flags `giu`. A pattern's number is its 1-based physical line in
  the secret, comments and blank lines included. Verified by: AC-05.
- **BR-344** — `make privacy-scan` exits 2 with a fixed message and no
  scan when `PRIVACY_DENY_PATTERNS` is unset, empty or yields zero patterns,
  and when any pattern fails to compile; the latter prints only
  `privacy-scan: pattern <n> is not a valid regex`. Verified by: AC-06.
- **BR-345** — The scanned entries are exactly the output of
  `git ls-files -z -s` at the checkout. Contents are read only from the object
  database through one `git cat-file --batch` process by blob id, never from
  the working tree. A symlink entry (mode `120000`) is scanned as its target
  text; a gitlink (mode `160000`) is skipped and counted. Decoding is exactly:
  a UTF-16 LE or BE byte-order mark decodes the rest as UTF-16; otherwise a
  blob that decodes as strict UTF-8 (a UTF-8 BOM removed) with no NUL byte is
  text; anything else is binary, skipped and counted. Each text is scanned per
  line in three views (as is; after `%XX` percent-decoding; after decoding
  HTML numeric entities `&#NN;` and `&#xHH;`), and once more over the as-is
  text with line breaks collapsed to single spaces, a hit reported at the line
  where the match starts (archive `scanText` semantics); one hit per line and
  pattern. Verified by: AC-07, AC-11, AC-15, AC-16.
- **BR-346** — The range is `<base>..<head>` from `PRIVACY_RANGE_BASE` and
  `PRIVACY_RANGE_HEAD`: on `pull_request` the PR base and head, on `push`
  `before..after`. The full history of the head is scanned instead when
  `PRIVACY_EVENT` is `workflow_dispatch`, or the base is empty, forty zeros
  (new branch), not a commit in the clone, or not an ancestor of the head
  (force push). For each commit of `git rev-list <range>`: its full message
  (`git log -1 --format=%B`) is scanned by the BR-345 views; and the added
  lines of its patch (`git log -p --no-ext-diff --no-textconv
  --format=commit%x20%H <range>`, lines starting with `+` except `+++`
  headers; merge commits show no patch) are scanned by the BR-345 per-line
  views and the collapsed view over each file's added lines. An empty head, or
  a head that is not a commit in the clone, prints only
  `privacy-scan: head is not a commit` and exits 2. Verified by: AC-09.
- **BR-347** — Only when `PRIVACY_EVENT` is `pull_request`, `PRIVACY_PR_TITLE`
  and `PRIVACY_PR_BODY` are scanned by the BR-345 views as the sources
  `pr-title` and `pr-body`; on other events they are ignored, whatever their
  value. Verified by: AC-10.
- **BR-348** — Each hit prints exactly one stdout line
  `privacy-scan: hit <location> pattern <n>`, where `<location>` is
  `<path>:<line>`, `commit <40-hex sha> line <line>` (message),
  `commit <40-hex sha> added` (added lines; one hit per commit and pattern),
  `pr-title:<line>` or `pr-body:<line>`. When the path itself matches any pattern, `<location>` is
  `file #<k>:<line>` with `k` the 1-based index in `git ls-files` order, and
  one extra line `privacy-scan: hit path file #<k> pattern <n>` is printed. No
  output ever contains matched text, a pattern, or text around a hit.
  Verified by: AC-07, AC-08.
- **BR-349** — After scanning, the last stdout line is
  `privacy-scan: <h> hits, <f> files, <b> binary skipped, <g> gitlinks skipped, <c> commits, <p> patterns`;
  the exit status is 0 when `h` is 0, else 1. Any unexpected error (Git
  failure, read error, exception) is caught by one top-level handler that
  prints only `privacy-scan: internal error` to stderr and exits 2; no stack,
  message or partial summary is printed. Verified by: AC-07, AC-16.
- **BR-350** — Step 1 of `privacy-scan` has the `if` exactly
  `github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository`
  and the `run` exactly the `PRIVACY_FORK_NOTICE` constant of
  `tests/helpers/ci-policy.ts`:
  `printf '%s\n' 'privacy-scan: fork pull request; deny patterns are unavailable, no scan was run.'`
  (exit 0). Fork PRs still fail CI through `fork-refusal` (BR-149 v2), and the
  merged commit is scanned on push to `main`. Verified by: AC-14.
- **BR-351** — `docs/self-hosted-runner.md` states that the runner setup is
  safe only for a private repository or when fork pull-request workflows cannot
  run, and that it is never attached to `sstolz/kdrive-mcp-server`; `ops/runner/`
  is unchanged. Verified by: AC-04.
- **BR-352** — `scripts/privacy-scan.ts` imports only Node built-ins (`node:`
  modules), so it needs no `node_modules`. `make privacy-scan` depends only on
  the container-config guard (not `_require-setup`) and runs exactly
  `$(COMPOSE) run --rm -T` with the `-e PRIVACY_*` names, then
  `dev node scripts/privacy-scan.ts`; the CI job does not run `make setup`.
  The existing dev-service mounts apply (`.git` read-only); no dedicated
  network-isolated service is added (D-9). Verified by: AC-12.

## Versioned rules

- **BR-225 v2** — v1 holds with these changes: every job of `ci.yml` has
  `runs-on` exactly `ubuntu-24.04`; no job of `ci.yml` has `runs-on` containing
  `self-hosted`. Timeouts unchanged, plus `privacy-scan` 20. (v1: label array
  `[self-hosted, linux, x64, kdrive-ci]` except `fork-refusal`.) The label
  array survives only in `runner-acceptance.yml` (BR-229 v2). Verified by:
  AC-01, AC-02.
- **BR-149 v3**, **BR-183 v3** — v2 holds with "the BR-225 label array"
  replaced by `ubuntu-24.04`. Verified by: AC-01.
- **BR-227 v2** — v1 holds with these changes: every job except `changes`,
  `privacy-scan`, `fork-refusal` and `ci-result` depends on `changes` directly
  or through `needs`; `ci-result` needs every other job except `fork-refusal`
  (adding `privacy-scan`), and its step `if` is exactly
  `needs.changes.result != 'success' || needs.privacy-scan.result != 'success' || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')`.
  Verified by: AC-01, AC-02.
- **BR-229 v2** — v1 holds with these changes: each of the three jobs has the
  job `if` exactly `github.repository != 'sstolz/kdrive-mcp-server'`; the
  trigger stays `workflow_dispatch` only. (v1: no job `if`.) Verified by: AC-03.
- **BR-015 v7** — v6 holds with these changes. The exact job set adds
  `privacy-scan` (BR-341). Every job runs on `ubuntu-24.04` (BR-225 v2). The
  Make-only `run` allowlist adds `make privacy-scan`, admitted only in
  `privacy-scan`; `make setup` is not admitted there. The non-Make `run`
  texts add `PRIVACY_FORK_NOTICE`, admitted only in `privacy-scan` (eleven
  occurrences). The word `secrets` (v3 matching) appears only inside the `env`
  values of the two Sonar analysis steps and of the `privacy-scan` step 3;
  each such value matches `^\$\{\{ secrets\.[A-Z_]+ \}\}$`. The Sonar gate set
  stays the five build gates. (v6: `secrets` only in the two analysis steps.)
  Verified by: AC-01, AC-02.

## Acceptance criteria

- **AC-01** (BR-015 v7, BR-149 v3, BR-183 v3, BR-225 v2, BR-227 v2, BR-341) —
  Given the real `ci.yml`, When the policy validator runs, Then it passes with
  every job on `ubuntu-24.04` and the exact `privacy-scan` and `ci-result`
  shapes. Verified by: `tests/ci-policy.test.ts` `BR-015 v7 BR-225 v2 accepts
  the real workflow on hosted runners`, `BR-341 …`, `BR-227 v2 …`.
- **AC-02** (BR-015 v7, BR-225 v2, BR-227 v2, BR-341, BR-342) — Given fixtures
  mutated to: one job on the label array; `privacy-scan` with `needs` or a job
  `if`; a `make setup` step in `privacy-scan`; the deny secret in another step,
  a `with`, or the job `env`; a Sonar secret in `privacy-scan`; checkout
  without `fetch-depth: 0`; `ci-result` without `privacy-scan`; When validated, Then each throws. Verified by:
  `tests/ci-policy.test.ts` `BR-341 rejects …` table.
- **AC-03** (BR-229 v2) — Given `runner-acceptance.yml`, When validated, Then
  only `workflow_dispatch` triggers it and each job has the repository guard;
  a fixture without the guard or with a `push` trigger throws. Verified by:
  `tests/ci-policy.test.ts` `BR-229 v2 …`.
- **AC-04** (BR-351) — Given `docs/self-hosted-runner.md`, When tested, Then
  it contains both safety statements. Verified by: `tests/runner-ops.test.ts`
  `BR-351 …`.
- **AC-05** (BR-343) — Given a synthetic secret with comments, blank lines,
  CRLF and two patterns on lines 3 and 5, When parsed, Then exactly two
  patterns numbered 3 and 5 result. Verified by: `tests/privacy-scan.test.ts`
  `BR-343 …`.
- **AC-06** (BR-344) — Given the variable unset, empty, comments only, or with
  an invalid regex on line 2, When the scan runs, Then it exits 2 with
  the fixed message (line number only for the regex case) and the output
  contains no pattern text. Verified by: `tests/privacy-scan.test.ts` `BR-344 …`.
- **AC-07** (BR-345, BR-348, BR-349) — Given a temporary Git repository and a
  secret with pattern 1 `synthetic-deny-[0-9]{4}` and pattern 2
  `synthetic deny [0-9]{4}` (contains a space), and a tracked file holding
  `synthetic-deny-1234` on line 2, a `%2D`-encoded form on line 4, a
  `&#45;`-encoded form on line 5, and `synthetic deny` on line 6 followed by
  `1234` on line 7, When scanned, Then exactly four hit lines (lines 2, 4 and 5
  pattern 1; line 6 pattern 2) and the summary print, the exit is 1, and no
  output contains `synthetic`, `deny` or either pattern. Verified by: `tests/privacy-scan.test.ts`
  `BR-345 seeded rehearsal …`.
- **AC-08** (BR-348) — Given a tracked path containing the synthetic token,
  When scanned, Then the path is reported as `file #<k>` only. Verified by:
  `tests/privacy-scan.test.ts` `BR-348 …`.
- **AC-09** (BR-346) — Given commits A–C with the token only in B's message,
  and the token only in an added line of C, When scanned with base A and head
  C, with base forty zeros, with an unknown base, with a base not an ancestor
  of C, with `PRIVACY_EVENT=workflow_dispatch` and base C, and with base C,
  Then `commit <B> line <n>` and `commit <C> added` are reported in the first
  five and nothing in the last; an empty head and an unknown non-empty head
  each print `privacy-scan: head is not a commit` and exit 2. Verified by: `tests/privacy-scan.test.ts`
  `BR-346 …`.
- **AC-10** (BR-347) — Given the token in `PRIVACY_PR_TITLE` and in
  `PRIVACY_PR_BODY` line 3, When scanned with `PRIVACY_EVENT=pull_request`,
  Then `pr-title:1` and `pr-body:3` are reported; with `PRIVACY_EVENT=push`,
  Then no `pr-` hit is reported and the exit is 0. Verified by:
  `tests/privacy-scan.test.ts` `BR-347 …`.
- **AC-11** (BR-345) — Given a tracked file with a NUL byte containing the
  token and one with invalid UTF-8 containing the token, When scanned, Then
  both are skipped and counted in `binary skipped`.
  Verified by: `tests/privacy-scan.test.ts` `BR-345 binary …`.
- **AC-12** (BR-342, BR-352) — Given the `Makefile`, When tested, Then the
  `privacy-scan` recipe passes `PRIVACY_*` by name only, runs
  `$(COMPOSE) run --rm -T` … `dev node scripts/privacy-scan.ts`, and does not
  depend on `_require-setup`; and `scripts/privacy-scan.ts` imports only
  `node:` modules. Verified by: `tests/privacy-scan.test.ts`
  `BR-352 Makefile …`.
- **AC-13** (BR-015 v7, BR-225 v2, BR-341, BR-346) — Given the owner
  provisioned `PRIVACY_DENY_PATTERNS`, no runner is attached, and the
  repository allows squash merging only with the default commit message
  "Pull request title and description", When the PR CI run, the push-to-`main`
  CI run and a `workflow_dispatch` CI run on `main` (full history) complete,
  Then every job ran on a GitHub-hosted runner, each `privacy-scan` printed
  `0 hits` with a non-zero pattern count, Sonar and `ci-result` are green. The
  `workflow_dispatch` run with 0 hits is the pre-public gate. Verified by: run links recorded in `runs/` at
  acceptance.
- **AC-14** (BR-350) — Given the real `ci.yml`, When validated, Then step 1 of
  `privacy-scan` equals `PRIVACY_FORK_NOTICE` under the fork condition.
  Verified by: `tests/ci-policy.test.ts` `BR-350 …`.
- **AC-15** (BR-345) — Given tracked files holding the token as UTF-16 LE with
  BOM, UTF-16 BE with BOM, and `&#x2d;`-encoded, When scanned, Then each is
  reported at its line and none is counted as binary. Verified by:
  `tests/privacy-scan.test.ts` `BR-345 decoders …`.
- **AC-16** (BR-345, BR-349) — Given a committed file holding the token then
  deleted from the working tree, a symlink whose target text holds the token,
  and a gitlink entry, When scanned, Then the deleted file and the symlink are
  reported at line 1 and the gitlink is counted in `gitlinks skipped`; and
  given a Git failure forced by the test (scan run outside a repository with a
  valid secret and head), Then stdout is empty, stderr is exactly
  `privacy-scan: internal error` and the exit is 2. Verified by:
  `tests/privacy-scan.test.ts` `BR-345 object database …`, `BR-349 internal
  error …`.

## Decisions

- **D-1 Hosted `ubuntu-24.04` for every job.** Rejected: keeping the runner
  with a fork guard (one misconfigured `if` exposes owner hardware); larger
  hosted runners (cost, not needed).
- **D-2 Timeouts unchanged.** The heaviest leg (`image` arm64 under QEMU) ran with
  30 minutes on `ubuntu-24.04` under BR-183 v1. Rejected: raising
  now without evidence. If AC-13 exceeds a timeout, a new spec version raises
  only that value.
- **D-3 `runner-acceptance.yml` kept with a repository guard.** Rejected:
  deleting it (owner keeps the optional setup); keeping it unguarded (a manual
  dispatch would queue jobs no runner serves).
- **D-4 Secret format compatible with the archive, no built-in rules.** The
  archive's e-mail rule would hit every `Co-Authored-By` trailer; the owner can
  add any pattern to the secret. Rejected: patterns in a tracked file (the
  list is itself private); allowed-literal lists (more secret plumbing).
- **D-5 Location and pattern number only.** Rejected: masked excerpts (partial
  text still identifies); relying on GitHub's log masking (multi-line secrets
  are not reliably masked per line, and matched text is not a secret value).
- **D-6 Range scan plus PR title and body; full history on demand.** The
  squash message comes from the PR title and body (AC-13 precondition), so
  scanning them makes the PR check preventive. PR and push runs scan only
  their range; new branches, force pushes and `workflow_dispatch` scan the
  full history, and the dispatch run is the pre-public gate (AC-13). A
  historic hit fails those runs until fixed; it can be fixed only before going
  public by recreating history, which is an owner decision outside this spec.
  Rejected: full history on every run (cost proportional to history on every
  PR); adding the `edited` PR type (re-runs the whole CI on each edit; T6
  accepted).
- **D-7 No dependency on `changes`.** Records-only PRs are the likeliest leak;
  `heavy=false` must not skip the scan.
- **D-8 Fork notice in the job, not a skipped job.** Gives a visible reason in
  the `privacy-scan` log; `fork-refusal` keeps failing fork PRs. Rejected:
  reusing `fork-refusal` (would change BR-149 text).
- **D-9 Dev container, Docker-only toolchain, Node built-ins only.** Same as
  every gate; no `make setup`, so no third-party package runs in the job.
  Rejected: a dedicated network-isolated compose service (the secret has the
  same trust level as the Sonar steps, T5; isolation would not stop a PR from
  changing the service).
- **D-10 Scanner runs from the PR's own code.** Same-repository authors are
  trusted (T5); the scan prevents accidental leaks. Rejected: checking out the
  scanner from a trusted ref (on `pull_request` the workflow file itself comes
  from the PR merge ref, so it adds no guarantee against a same-repository
  author, who already has write access). Changes to the scanner, workflow or
  Make target are caught by the mandatory independent review; residual risk
  T5.

## Open questions

## Stress-test

### Round 1 — reviewed SHA `d755f70` (Opus 5.5, `1-spec-review-1-reviewer`)

- [major] Scanner run from the PR's own code — rejected: on `pull_request` the workflow comes from the PR merge ref, so a trusted-ref scanner adds nothing against a same-repository author with write access; trusted authors, accidental-leak threat model, independent review of scanner/workflow/Make changes (T5, D-10).
- [major] Commit content not scanned — retained: added lines of every commit in the range scanned, reported as `commit <sha> added` without text (BR-346, BR-348, AC-09).
- [major] Range rules and D-6 contradiction — retained: push `before..after`; zero, unknown or non-ancestor base and `workflow_dispatch` scan full history; AC-13 adds the dispatch run as pre-public gate; D-6 states history recreation is an owner decision.
- [major] AC-07 wrapped case could not match a hyphen pattern — retained: second synthetic pattern with a space (AC-07).
- [major] Filesystem reads, symlinks, gitlinks, error output — retained: `git cat-file --batch`, symlink target text, gitlinks counted, one top-level `privacy-scan: internal error` exit 2 (BR-345, BR-349, AC-16).
- [minor] Dependencies and isolation of the scan container — partly retained: Node built-ins only, `run --rm -T`, no `make setup` (BR-341, BR-352, AC-12); network-isolated service rejected, same trust level as Sonar (T5, D-9).
- [minor] Decoders unspecified — retained: UTF-8, UTF-16 LE/BE with BOM, `%XX` and HTML numeric entity views, else binary (BR-345, AC-11, AC-15).
- [minor] Missing test rows and ReDoS — retained: unknown non-empty head (AC-09), PR sources ignored on non-PR events via `PRIVACY_EVENT` (BR-347, AC-10); ReDoS bounded by the 20-minute timeout failing closed (T7).
- [minor] Squash message assumption — retained: AC-13 owner precondition, squash only with "Pull request title and description".

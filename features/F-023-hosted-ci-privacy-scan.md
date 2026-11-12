---
id: F-023
title: Hosted CI runners and a secret-fed privacy scan
ticket: "#1"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-12.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `f0983c4`. IDs: F-023,
BR-341–BR-352, BR-015 v7, BR-149 v3, BR-183 v3, BR-225 v3, BR-227 v3,
BR-320 v2,
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

- T1 fork code on owner hardware: removed by hosted runners (BR-225 v3,
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
- Provisioning the secret: an owner action before the feature PR's first
  green CI, since `privacy-scan` exits 2 without it (BR-344); a merge
  precondition.
- Surfaces outside `main` that become public with the repository; they form
  an owner checklist before going public (#2): other branches and tags,
  `refs/pull/*` heads, issue, PR and review text, and Actions logs of the
  private period.

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
  (new branch) or not a commit in the clone. A base that is not an ancestor
  of the head (a PR whose base moved on, or a force push) keeps the range
  scan: `git rev-list <base>..<head>` already lists exactly the commits that
  the base lacks. For each commit of `git rev-list <range>`: its full message
  (`git log -1 --format=%B`) is scanned by the BR-345 views; its author and
  committer name and e-mail (`%an`, `%ae`, `%cn`, `%ce`) are scanned by the
  same views and reported as `commit <40-hex sha> identity`; and its changed
  blobs are scanned: `git diff-tree -r --no-renames --no-commit-id --root -z <commit>`
  (merge commits list no blobs, as no `-m` is given) gives, NUL-separated and never quoted, every path and its new
  blob id; each new blob that is neither all-zero (deleted entry) nor a
  gitlink (new mode `160000`) is read through
  `git cat-file --batch` and scanned whole with the BR-345 decoders (a cache used only by
  this commit scan, separate from the BR-345 entry scan, avoids reading the
  same blob id twice; these blobs do not count toward `<f>`); each path of the entry
  (including deleted paths) is scanned as text. Hits in a commit's blobs or
  paths are reported as `commit <sha> added`; binary blobs add to `<b>` once
  per blob of the commit scan. An empty head, or
  a head that is not a commit in the clone, prints only
  `privacy-scan: head is not a commit` and exits 2. Verified by: AC-09.
- **BR-347** — Only when `PRIVACY_EVENT` is `pull_request`, `PRIVACY_PR_TITLE`
  and `PRIVACY_PR_BODY` are scanned by the BR-345 views as the sources
  `pr-title` and `pr-body`; on other events they are ignored, whatever their
  value. Verified by: AC-10.
- **BR-348** — Each hit prints exactly one stdout line
  `privacy-scan: hit <location> pattern <n>`, where `<location>` is
  `<path>:<line>`, `commit <40-hex sha> line <line>` (message),
  `commit <40-hex sha> added` (changed blobs and paths of that commit; one hit per commit and pattern),
  `commit <40-hex sha> identity` (author or committer name or e-mail),
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
  message or partial summary is printed. Every git child process runs with
  its stderr piped and discarded, never inherited. Verified by: AC-07, AC-16.
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

- **BR-225 v3** — v2 holds with these changes: every job of `ci.yml` has
  `runs-on` exactly `ubuntu-24.04`; no job of `ci.yml` has `runs-on` containing
  `self-hosted`. Timeouts unchanged, plus `privacy-scan` 20. (v2: label array `[self-hosted, linux, x64, kdrive-ci]` except `fork-refusal`, `audit` included.) The label
  array survives only in `runner-acceptance.yml` (BR-229 v2). Verified by:
  AC-01, AC-02.
- **BR-149 v3**, **BR-183 v3** — v2 holds with "the BR-225 label array"
  replaced by `ubuntu-24.04`. Verified by: AC-01.
- **BR-320 v2** — v1 holds with "`runs-on` the BR-225 self-hosted label
  array" replaced by "`runs-on` `ubuntu-24.04`" for the `audit` job.
  Verified by: AC-01.
- **BR-227 v3** — v2 holds with these changes: every job except `changes`,
  `privacy-scan`, `fork-refusal` and `ci-result` depends on `changes` directly
  or through `needs`; `ci-result` needs every other job except `fork-refusal`
  (adding `privacy-scan`), and its step `if` is exactly
  `needs.changes.result != 'success' || needs.privacy-scan.result != 'success' || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')`.
  Verified by: AC-01, AC-02.
- **BR-229 v2** — v1 holds with these changes: each of the three jobs has the
  job `if` exactly `github.repository != 'sstolz/kdrive-mcp-server'`; the
  trigger stays `workflow_dispatch` only. (v1: no job `if`.) Verified by: AC-03.
- **BR-015 v7** — v6 holds with these changes. The exact job set adds
  `privacy-scan` (BR-341). Every job runs on `ubuntu-24.04` (BR-225 v3). The
  Make-only `run` allowlist adds `make privacy-scan`, admitted only in
  `privacy-scan`; `make setup` is not admitted there. The non-Make `run`
  texts add `PRIVACY_FORK_NOTICE`, admitted only in `privacy-scan` (eleven
  occurrences). The word `secrets` (v3 matching) appears only inside the `env`
  values of the two Sonar analysis steps and of the `privacy-scan` step 3;
  each such value matches `^\$\{\{ secrets\.[A-Z_]+ \}\}$`. The Sonar gate set
  stays the five build gates. (v6: `secrets` only in the two analysis steps.)
  Verified by: AC-01, AC-02.

## Acceptance criteria

- **AC-01** (BR-015 v7, BR-149 v3, BR-183 v3, BR-225 v3, BR-227 v3, BR-320 v2,
  BR-341) —
  Given the real `ci.yml`, When the policy validator runs, Then it passes with
  every job on `ubuntu-24.04` and the exact `privacy-scan` and `ci-result`
  shapes. Verified by: `tests/ci-policy.test.ts` `BR-015 v7 BR-225 v3 accepts
  the real workflow on hosted runners`, `BR-341 …`, `BR-227 v3 …`, `BR-320 v2 audit job on hosted runners`.
- **AC-02** (BR-015 v7, BR-225 v3, BR-227 v3, BR-341, BR-342) — Given fixtures
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
  and the token only in a blob that C adds, When scanned with base A and head
  C, with base forty zeros, with an unknown base, with
  `PRIVACY_EVENT=workflow_dispatch` and base C, and with base C, Then
  `commit <B> line <n>` and `commit <C> added` are reported in the first four
  and nothing in the last; given a PR whose base D (on another branch, not an
  ancestor of C) shares only A with C, Then the range `D..C` is scanned (B and
  C reported, no full-history scan of A); given a commit whose author e-mail holds the token,
  Then exactly one `commit <sha> identity` line is reported; given a commit E whose new blob has a line
  starting with `+++` that holds the token, and a later commit F that deletes
  a file whose path holds the token, Then exactly one `commit <E> added` and
  one `commit <F> added` line are reported; given a commit adding a UTF-16 LE
  file with BOM that holds the token, Then that commit is reported; an empty head and an unknown non-empty head
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
- **AC-13** (BR-015 v7, BR-225 v3, BR-341, BR-346) — Given the owner
  provisioned `PRIVACY_DENY_PATTERNS`, no runner is attached, the merging
  account keeps its e-mail private (GitHub `noreply` author on web and API
  merges), and the repository allows squash merging only with the default commit message
  "Pull request title and description", When the PR CI run, the push-to-`main`
  CI run and a `workflow_dispatch` CI run on `main` (full history) complete,
  Then every job ran on a GitHub-hosted runner, each `privacy-scan` printed
  `0 hits` with a non-zero pattern count, Sonar and `ci-result` are green. The
  `workflow_dispatch` run with 0 hits is the pre-public gate for `main`
  only. Verified by: run links recorded in the #1 acceptance comment.
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
  `privacy-scan: internal error` (no git `fatal:` line) and the exit is 2. Verified by:
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
  their range (a force push or a moved PR base keeps the range scan, BR-346);
  a new branch, an old tip that is not a commit in the clone, and
  `workflow_dispatch` scan the full history, and the dispatch run is the
  pre-public gate for `main` (AC-13). A
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

### Round 2 — reviewed SHA `4e77729` (Opus 5.5, `1-spec-review-2-reviewer`, diff-focused)

1. [major] Non-ancestor fallback would make most PRs scan full history —
   retained: dropped; `rev-list base..head` already lists the missing
   commits; AC-09 adds a moved-base PR row.
2. [minor] `+++` content lines and history paths — retained: headers only in
   the per-file header block; patch paths scanned; AC-09 row.
3. [minor] Patch decoding — retained: `--text`, strict UTF-8, invalid lines
   counted as binary.
4. [minor] Git child stderr — retained: piped and discarded; AC-16 asserts no
   `fatal:` line.

### Round 3 — reviewed SHA `7929f6b` (Opus 5.5, `1-spec-review-3-reviewer`, diff-only)

1. [major] Patch lines decoded unlike BR-345, mixed counts — retained, by
   design change: no patch parsing; each commit's changed blobs (from
   `git diff-tree -z`) are read through `cat-file` and scanned whole with the
   BR-345 decoders, counted per blob, deduplicated by blob id.
2. [minor] Quoted or ambiguous header paths — retained: paths come from
   `git diff-tree -r --no-renames --no-commit-id --root -z`, never quoted.
3. [minor] One hit per commit and pattern vs two expected — retained: the
   `+++` line and the deleted path are in separate commits in AC-09.

### Round 4 — reviewed SHA `a3474bf` (Opus 5.5, `1-spec-review-4-reviewer`, diff-only)

1. [major] Dedupe shared with the tree scan hid commit hits — retained: a
   cache private to the commit scan; its blobs do not count toward `<f>`.
2. [major] Deleted entries have an all-zero blob id — retained: skipped
   explicitly with gitlinks.
3. [minor] `--no-commit-id`, per-blob binary count wording, Round 3 text —
   retained.
4. [minor] Leftover "added line" in AC-09 — retained.

### Round 5 — reviewed SHA `5ef7a49` (Opus 5.5, `1-spec-review-5-reviewer`, diff-only), verdict approve

No finding.

### Decision pass — reviewed SHA `5ef7a49` (Fable 5.2, `1-spec-decision-1-reviewer`), verdict changes

1. [major] Commit identities not scanned; a squash merge carried a personal
   e-mail — retained: `%an %ae %cn %ce` scanned as `commit <sha> identity`;
   AC-09 row; AC-13 precondition (e-mail kept private). The affected commit
   was removed by recreating the repository (#1 comment
   `1-history-1-orchestrator`).
2. [major] BR-225 v2 and BR-227 v2 collided with accepted v2; BR-320 still
   required the self-hosted array — retained: BR-225 v3, BR-227 v3 ("v2
   holds"), BR-320 v2.
3. [minor] "Pre-public gate" overclaimed — retained: "for `main` only", and
   an owner checklist of the other public surfaces under Out of scope.
4. [minor] D-6 vs BR-346 on force pushes — retained: aligned.
5. [minor] Secret needed before the first green CI; round 5 unrecorded —
   retained: merge precondition; round 5 recorded above.

### Decision-pass confirmation — reviewed SHA `e4e0b30` (Opus 5.5, `1-spec-review-6-reviewer`, diff-only), verdict changes (2 minor)

Both minors folded in at freeze: BR-320 v2 added to AC-01 with a named test,
and the BR-225 v3 history note now cites v2.

### Freeze

Frozen 2026-11-12 by the orchestrator (autonomous mode, PROJECT.md D-1) on
reviewed SHA `e4e0b30` plus the two minor fixes above. Evidence: strong-tier
approve (`1-spec-review-5-reviewer`), strongest-tier decision pass
(`1-spec-decision-1-reviewer`, majors fixed and confirmed by
`1-spec-review-6-reviewer`), no open question. IDs F-023 and BR-341–BR-352
re-checked free on `main` `87c2ab6`.

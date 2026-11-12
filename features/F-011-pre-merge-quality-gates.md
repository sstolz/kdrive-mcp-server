---
id: F-011
title: Pre-merge quality gates (SonarJS lint and a blocking PR Quality Gate)
ticket: "#50"
status: done
version: 3
---

## Context

**Accepted (2026-11-04)** on actual main `bc09d562eb422acd2b284be8c14e1e0806d6a118`
with the owner's Sonar configuration (P1–P3) and real CI evidence; see
runs/50-acceptance-1.md (archived evidence `runs/50-acceptance-1.md`). Deviations from the
planned acceptance order (the merge preceded P2 and AC-13(b); AC-13(b) ran as
an unmerged CI PR with an S7781 seed) are recorded there.

**Version 3 (frozen, 2026-11-04).** Frozen autonomously by the orchestrator on 2026-11-04 at reviewed SHA `fb5ad17` after Opus approval of `1611a4d` (runs/50-spec-v3-review-1.md (archived evidence `runs/50-spec-v3-review-1.md`)) and Fable approval of `fb5ad17` (runs/50-spec-v3-fable-1.md (archived evidence `runs/50-spec-v3-fable-1.md`)); the Fable minors are applied in the freeze commit. The ticket is ready, no question remains, and the user is notified of the SHA and D19. The first real `sonar-pr` run after the
owner set `SONAR_ENABLED=true` (PR #58, run 41821992074) stopped in the BR-151
pristine export with `Unsupported Git metadata exists.`. A diagnostic job on the
same runner (run 41822983911, git 2.56.0, the pinned `actions/checkout`
v4.2.2 with `persist-credentials: false`) measured that the checkout itself
writes `.git/config.worktree` (keys `core.sparsecheckout`,
`core.sparsecheckoutcone`, `index.sparse`; only the names were printed, not
the values). The pinned checkout (v4.1.2 and later) runs `git sparse-checkout
disable`, which writes those three keys with the value `false` to
`config.worktree`, then unsets `extensions.worktreeConfig`, leaving an inert
file; `commondir` and `modules` were
absent and the local config held no `extensions.*` key. BR-151 v2 refused that
file, so both Sonar jobs fail on every run. v3 versions BR-151 to v3 only:
`.git/config.worktree` moves from the refused entries to the saved and compared
entries, with `config`, `hooks` and `info` (D19). `commondir` and `modules`
stay refused. Every other v2 statement is unchanged; the v2 text is preserved
as [F-011 v2](history/F-011-v2.md).

**Version 2 (frozen, 2026-11-03).** v2 frozen autonomously on 2026-11-03 by
the orchestrator after Opus approval of `3fbee72`
(runs/50-spec-v2-review-1.md (archived evidence `runs/50-spec-v2-review-1.md`)); minors m1–m9
applied in this commit, reviewed within the PR #52 code review (economy path
chosen by the owner).

 PR #52 code review round 1
(runs/50-pr52-review-1.md (archived evidence `runs/50-pr52-review-1.md`), M1) found that
dependency lifecycle code run by `make setup` can rewrite `.git/config` (for
example `core.fsmonitor`) or `.git/hooks`. The `actions/checkout` post step then
runs host `git` in the secret-bearing jobs, and post steps run even after a
failed step. The orchestrator decided to fix it rather than accept a residual.
v2 therefore versions BR-150 to v2 (`.git` is read-only in the dev and `prep`
containers) and BR-151 to v2 (Git metadata is saved at archive time, compared
before every later step and restored by a final `always()` step). It also
versions BR-144 to v2 (inline configuration comments stop the lint run) and
BR-015 to v3 (secret references in any form). Finally, it corrects the AC-13(b)
seed (erratum). The v1 text is preserved as
[F-011 v1](history/F-011-v1.md); every other v1 statement is unchanged.

v1 history: autonomous freeze by the orchestrator on 2026-11-03 at 09:42:59 UTC, exact
reviewed SHA `b4abcfd`, after fresh independent Fable
round 6 approval (archived evidence `runs/50-spec-review-6.md`) (full spec at `a12d034`) and
round 7 diff approval (archived evidence `runs/50-spec-review-7.md`). IDs re-checked free on
main `3fc14c3`. The ticket is ready, no question remains and the user was
notified of this SHA and the decisions. See the
freeze record (archived evidence `runs/50-freeze-1.md`). Allocates BR-144–BR-151 and ADR-005;
versions BR-010, BR-012, BR-014 and BR-015 to v2.

#50 (archive issue 50) is a full-path
change to the build and CI contract (AGENTS.md §1). Today SonarScanner runs
only on trusted `main` after the merge: the `sonar` job in
`.github/workflows/ci.yml` is skipped on pull requests (BR-015 v1), so Sonar
findings surface only after the merge (`learnings.md`). The owner decided on
2026-11-03 to catch them before the merge, on every pull request, and to do it
before #12 exposes the server over HTTP.

Owner facts (ticket body and owner comment, 2026-11-03):

- The server is **SonarQube Community Edition**: no native branch or
  pull-request analysis.
- GitHub Actions secrets are provisioned: `SONAR_HOST_URL`, `SONAR_TOKEN` (a
  project analysis token for `kdrive-mcp-server`, trusted `main` only) and
  `SONAR_PR_TOKEN` (a project analysis token for the dedicated PR project
  `kdrive-mcp-server-pr`, whose main branch is named `main` and whose Quality
  Gate applies to overall code). These are the first CI Sonar secrets; earlier
  analyses ran from the owner's machine.
- The repository variable `SONAR_ENABLED=true` is set **only after this ticket
  merges**, so the current hard-coded-host path is never enabled in CI.
- The repository is private, so CodeQL is out of scope.

Owner prerequisites (owner configuration, outside the repository; decided by
the orchestrator within the owner's intent, 2026-11-03):

- **P1 — PR-project Quality Gate.** `kdrive-mcp-server-pr` uses a custom
  Quality Gate named `kdrive-pr-gate` on **overall code** with exactly three
  conditions: Reliability rating is A, Security rating is A, Maintainability
  rating is A. It has no Security Hotspot condition (hotspots are reviewed in
  the `main` project) and no coverage condition (the PR project's coverage is
  informative only and not gated).
- **P2 — Baseline.** Before the merge, the owner runs one manual analysis of
  this PR's head into `kdrive-mcp-server-pr` with the owner's own scanner
  setup, passing `-Dsonar.projectKey=kdrive-mcp-server-pr` explicitly (the
  tracked properties file keeps the `main` key), and observes that `kdrive-pr-gate` passes. A finding in active code
  is fixed in this PR before the merge. The result is recorded as
  owner-observed evidence in `runs/50-acceptance-1.md`.
- **P3 — Enablement.** `SONAR_ENABLED=true` is set only after the merge and
  only after P1 and P2 hold.

Verified facts (2026-11-03, read-only):

- `gh api repos/sstolz/kdrive-mcp-server/branches/main/protection` returns HTTP
  403 "Upgrade to GitHub Pro or make this repository public": branch protection,
  rulesets with required checks and environment protection rules are not
  available on this private repository's plan.
- `eslint-plugin-sonarjs` 4.2.2 was published on 2026-09-28 (more than two
  weeks before 2026-11-03) with peer dependency `eslint: ^8 || ^9 || ^10`; the
  repository pins `eslint` 10.14.0 and `typescript-eslint` 8.72.1.
- The Sonar host name appears in 19 tracked files on `main` `3fc14c3`:
  active code and configuration (`scripts/sonar.ts`,
  `sonar-project.properties`, `tests/sonar-analysis.test.ts`,
  `tests/sonar-v4.test.ts`, `README.md`) and records (done F-001, its v3
  history snapshot, superseded BR-013, accepted ADR-002 and 10 `runs/`
  records).

Affected users: the owner (secrets, server projects, merge decisions), the
orchestrator and agents (lint gate, merge eligibility), and every contributor
whose pull request now runs a Sonar Quality Gate.

## Scope

1. **Lint gate.** Add `eslint-plugin-sonarjs` (exact pin `4.2.2`) with its
   `recommended` configuration, and move typescript-eslint from
   `recommendedTypeChecked` to `strictTypeChecked`, both for the existing typed
   file set. Fix every new finding, or justify it inline (BR-144). No rule is
   disabled just to reach green. Fixes in `src/` are limited to
   behaviour-preserving edits covered by existing tests; a finding whose fix
   would change behaviour gets an inline ` -- reason` suppression and a
   `BACKLOG.md` line instead.
2. **Host from configuration.** Remove the hard-coded host (`scripts/sonar.ts`
   `SERVER`, `sonar.host.url` in `sonar-project.properties`, tests, README).
   The host comes from `SONAR_HOST_URL` (GitHub secret in CI; environment
   locally) or from `SONAR_HOST_URL_FILE` (an external file, mirroring
   `SONAR_TOKEN_FILE`). It is validated and never printed (BR-145, BR-146).
3. **No Sonar host in active code and configuration** (Decision D9). Remove
   it from `src/`, `scripts/`, `tests/` (fixtures use the synthetic
   `https://sonar.example.test`), `.github/`, `Makefile`, `compose*.yaml`,
   `*.properties`, `package.json`, `README.md` and the current non-history
   docs that describe how to configure Sonar. Historical and immutable records
   keep it unchanged. Analysis fails when the analysed file set contains it
   (BR-147).
4. **Blocking PR Quality Gate on Community Edition.** A new `make sonar-pr`
   target and a new `sonar-pr` CI job analyse the pull-request merge commit of
   same-repository pull requests against the dedicated project
   `kdrive-mcp-server-pr` with `SONAR_PR_TOKEN`, and fail when its Quality Gate
   fails (BR-148, BR-149). Fork pull requests never receive a secret and fail
   closed. The `main` analysis keeps its project and history.
5. **Isolation of third-party code from Sonar secrets** (BR-150 v2) and a
   secret-free host-side pristine-tree comparison before any secret-bearing
   step (BR-151 v3), so that secret-bearing steps execute only pristine code.
   v2: `.git` is read-only inside the dev and `prep` containers, and the Git
   metadata that host `git` executes from (`.git/config`, `.git/hooks/`,
   `.git/info/`) is saved, compared and restored, so that the
   `actions/checkout` post step also runs on pristine metadata.
6. **Versioned rules:** BR-010 v2 (lint gate), BR-012 v2 (coverage snapshot),
   BR-014 v2 (official-scanner wrapper), BR-015 v3 (CI policy; v2 in F-011
   v1), BR-144 v2, BR-150 v2 and BR-151 v3 (v1 records of F-011 v1; v2 records of F-011 v2).
7. **Tests and records:** `tests/ci-policy.test.ts` and its helper,
   `tests/sonar-*.test.ts`, `tests/dev-environment.test.ts`,
   `tests/quality-commands.test.ts`, the Makefile help and `.PHONY`,
   `compose.yaml` and a new host-file overlay, ignore files, `.env.example`,
   README "Conditional remote analysis", the new BR records BR-144–BR-151
   (pending acceptance), BR-010/012/014/015 History lines (v2 pending),
   `business-rules/README.md`, `docs/spec-index.md`, `CHANGELOG.md`
   (Unreleased, pending), a provisional `capability-map.md` entry, and
   ADR-005 (dedicated PR project on Community Edition).
8. **#21 records synchronization (AGENTS.md §6), declared in this PR's scope.**
   #21 / F-010 was accepted on actual `main`
   `3fc14c3bbbd57b3c52ca4b74c07a512720f0d627` (`make check` rc=0, 76 files / 1746 tests; PR #51 CI green;
   closure comment on #21). This PR marks:
   - BR-124–BR-143 `active` (status and History line);
   - BR-100 v2 and BR-024 v2 `active` (an accepted History line; v2 becomes
     the accepted rule of the same record);
   - F-010 `done`, with an acceptance paragraph;
   - the BR index, the spec index, `CHANGELOG.md` (pending → accepted wording)
     and `capability-map.md` (provisional → accepted), following the F-008
     pattern of `d037ceb`.
   Real MCP client connections stay deferred to #12/#13 and are stated as not
   established.

### Out of scope

- CodeQL and any other analyser (private repository).
- SonarQube Developer Edition, the community branch plugin, branch or PR
  decoration, and any scanner `sonar.branch.*` / `sonar.pullrequest.*`
  parameter.
- Creating, configuring or deleting Sonar projects, Quality Gates or tokens
  (owner actions); custom Sonar REST calls.
- GitHub plan upgrades, branch protection, rulesets and environments.
- Rewriting Git history: the host stays in past commits.
- Editing historical or immutable records that contain the host: accepted
  ADRs, `features/history/`, done feature records (F-001), superseded BRs,
  `runs/` and CHANGELOG entries of past releases (Decision D9).
- Other hosts of the same domain recorded as OIDC/MCP evidence (the OIDC
  provider and MCP hosts in `runs/11-*`); "server URL" in this feature means
  the Sonar server only.
- typescript-eslint `stylistic*` configurations and Prettier changes.
- Dependabot or other bot pull requests receiving Sonar secrets: such PRs get
  no Actions secrets, so with `SONAR_ENABLED=true` their `sonar-pr` fails
  closed on the missing token; a maintainer re-pushes the change on an
  ordinary branch, as for forks (D3).
- Making `SONAR_ENABLED=true` (owner action after the merge).

## Threat model

Assets: `SONAR_TOKEN` (writes analyses of `kdrive-mcp-server`), `SONAR_PR_TOKEN`
(writes analyses of `kdrive-mcp-server-pr`), the Sonar host name (treated as
confidential by owner decision, not as a credential), and the integrity of the
`main` project's history and Quality Gate.

| #   | Actor / vector                                                                               | Threat                                                                     | Control                                                                                                                                                                                                                                                                                                                         | Residual risk                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Fork pull request (any author)                                                               | Exfiltrate a secret through code or a modified workflow.                   | `pull_request` event only (never `pull_request_target`); GitHub passes no Actions secret to fork runs; the `sonar-pr` secret step runs only when the head repository equals `github.repository`; fork runs reach only a fixed failing step (BR-149).                                                                             | None beyond GitHub's own fork isolation.                                                                                                                                                                              |
| T2  | Third-party dependency or test code on a same-repository PR (npm lifecycle scripts, build, tests) | Read a token or the host from the environment, a file or a mount; or tamper with code, Compose definitions or Git metadata that later run with secrets. During `make setup` (v1) the dev container bind-mounted the checkout read-write, `.git` included, with the runner's uid. It could rewrite `Makefile`, `scripts/sonar-entry.sh` or `compose*.yaml`, drop `GNUmakefile`, `compose.override.yaml` or `.env` and hide them in `.git`, or set `core.fsmonitor`, a hook or an attribute filter that host `git` executes. The `actions/checkout` post step runs host `git` in the secret-bearing job even after a failed step or a cancellation, so this is host execution beside the runner process that holds the job's secrets. During snapshot preparation, build and coverage execute third-party code just before the host starts the `analysis` service, and the snapshot later supplies `scripts/sonar.ts` and the uploaded sources. | Secrets exist only in the env of the single analysis step, and only the pinned official scanner image service receives them (BR-150, BR-014 v2). v2: `.git` is bound read-only in the `dev` and `prep` services, so container code cannot write Git metadata (BR-150 v2). Before `make setup`, an inline step exports `git archive "$GITHUB_SHA"` and a copy of `.git/config`, `.git/config.worktree` (v3), `.git/hooks/` and `.git/info/` to `$RUNNER_TEMP`, which no container mounts. After setup, an inline step compares the working tree (by `diff -r`) and that Git metadata with the saved copies. A final `if: always()` step, the last step of the job and therefore before the checkout post step, compares again and, on any difference, renames `.git` aside (never deletes it) and fails, so the post step finds no repository and runs no `git` (BR-151 v3). The checkout keeps `persist-credentials: false` and no submodules. Preparation runs in a `prep` service with the checkout mounted read-only and only `artifacts/sonar-input` writable; the entry script names Compose files with `-f` and refuses `.env` and override files. Before starting the analysis service, it compares the whole snapshot, minus enumerated generated entries, with the archive bidirectionally and binds the manifest to `GITHUB_SHA` (BR-150). | The pinned official scanner image, the GitHub runner, the host Docker daemon and the `actions/checkout` post step itself. That post step still runs host `git` on the checkout (no checkout input disables it), but only when the final step found Git metadata equal to the saved copy, and with `.git` never writable from a container. The save and comparison cover `config`, `config.worktree` (v3), `hooks` and `info`, and the steps fail when `.git/commondir` or `.git/modules` exists; the index, refs and objects rely on the read-only mount alone. Manifest fields other than `commit`, `runId` and `event` (cross-checked) remain writable by a `prep` grandchild that outlives the test run; they select nothing security-relevant. Coverage data (`coverage/`) is produced by the tests themselves and cannot be verified against the archive; it is not gated on the PR project (P1). A local `make sonar` without `SONAR_PRISTINE_TAR` skips the pristine and manifest comparisons (fixed notice); the owner's machine already runs the dependencies. |
| T3  | Writer with push access to the repository                                                    | Edit the workflow, Makefile or scripts on a branch to print or send secrets. | Same-repository `pull_request` runs use the branch's workflow, so this cannot be prevented on this plan (no environment protection). Mitigations: only the owner and the owner's agents have write access; two project-scoped analysis tokens limit a leak to analysis writes on one project; `SONAR_TOKEN` is referenced only by the `main` job, so review detects any new reference (BR-015 v2, BR-149 tests). | **Accepted:** a writer can read every Actions secret. Response: rotate the affected token on the server.                                                                                                              |
| T4  | Same-repository PR                                                                           | Pollute or corrupt the `main` project's history or gate.                   | PR runs use `SONAR_PR_TOKEN`, which is scoped to `kdrive-mcp-server-pr`; the wrapper selects the PR key only from the fixed `SONAR_ANALYSIS_MODE` set by the `make sonar-pr` target and cross-checks it against the manifest `event` (BR-150) and rejects the main key in PR mode (BR-148).                                                                                                                                             | None while tokens stay project-scoped (owner configuration).                                                                                                                                                          |
| T5  | Concurrent PRs on Community Edition (one branch per project)                                 | One PR's analysis is judged by another PR's result.                        | Concurrency group `sonar-kdrive-mcp-server-pr` with `cancel-in-progress: false` serializes runs: GitHub keeps at most one running and one pending job per group, and a newer job joining the group **cancels the previously pending one**. The scanner waits for its own task's gate (`sonar.qualitygate.wait`) and the wrapper checks this task's metadata (BR-148). A cancelled `sonar-pr` is not green: the PR stays ineligible for merge until that job is re-run and succeeds (D5). | The PR project's dashboard shows the last analysed PR only. CE has one Compute Engine worker, so `sonar` and `sonar-pr` tasks can queue behind each other and the 300-second wait includes queue time (a timeout is re-run). Alternating merge commits of divergent PRs close and reopen issues, so an owner-accepted issue may need re-acceptance. |
| T6  | Logs                                                                                         | Host or token printed by the scanner, the wrapper or the shell.            | GitHub masks secret values; the wrapper additionally redacts the token and the host name from captured scanner output; every wrapper/guard error is a fixed message (BR-146).                                                                                                                                                    | Host visible in Git history (out of scope) and to the owner's server logs.                                                                                                                                            |
| T7  | Disabled or missing variable                                                                 | The PR gate silently stops being enforced.                                 | A same-repository run with `SONAR_ENABLED != 'true'` succeeds with a fixed "PR Quality Gate disabled" notice; with `SONAR_ENABLED == 'true'`, a missing token or host fails (BR-149). Bot PRs (for example Dependabot) receive no Actions secrets and therefore fail closed. | Owner-controlled variable; the notice is visible in every run.                                                                                                                                                        |
| T8  | Merge without a passing gate                                                                 | A failing gate does not technically block the merge on this plan.          | AGENTS.md §3 step 6 merges only when all checks are green on the latest commit; `sonar-pr` is one of them (Decision D5).                                                                                                                                                                                                         | Procedural, not forge-enforced, until the owner enables branch protection.                                                                                                                                             |

## Business rules

### Versioned rules

- **BR-010 v2** — Make delegates install, lint, format, typecheck, test, build
  and pack to the specified non-watch npm commands in the Compose dev service
  using the lockfile. Typed ESLint applies the typescript-eslint
  `strictTypeChecked` configuration, `@typescript-eslint/no-floating-promises`
  and the `eslint-plugin-sonarjs` 4.2.2 `recommended` configuration to
  `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.ts` and `vitest.config.ts`,
  and rejects warnings. Prettier checks without writing; TypeScript checks
  source and tests; empty test discovery and build type errors fail.
  (v1: `recommendedTypeChecked` without SonarJS.) Verified by: AC-01, AC-02.
- **BR-012 v2** — Container Vitest coverage is unchanged from v1, and Sonar
  regenerates coverage in its exact analysed snapshot: the committed trusted
  `main` commit for `make sonar`, or the pull-request merge commit for
  `make sonar-pr`, where the snapshot's non-generated content is proven equal
  to the pristine `git archive "$GITHUB_SHA"` by the BR-150 comparison (in
  CI) rather than by `.git` state. Missing, stale, failed or mismatched
  ("mismatched" means provenance between the manifest and the inputs, not
  tamper evidence: coverage data is produced by the tests themselves) reports
  are rejected
  before upload. (v1: committed-main snapshot only.) Verified by: AC-11.
- **BR-014 v2** — BR-014 v1 holds with these changes: the scanner host comes
  only from the validated runtime host (BR-145), never from a tracked file or a
  constant; the scanner child receives it as `SONAR_HOST_URL` in its
  environment allowlist; task metadata `serverUrl` must equal the configured
  host without one trailing `/`; the project key is `kdrive-mcp-server` for
  `make sonar` and `kdrive-mcp-server-pr` for `make sonar-pr` (BR-148); and
  captured output redacts the host name as well as the token (BR-146).
  `make sonar` still accepts only trusted clean exact `main` on `local`,
  `push` or `workflow_dispatch` and rejects `pull_request` and
  `pull_request_target`. Verified by: AC-05, AC-08, AC-12.
- **BR-015 v3** — BR-015 v1 holds (every main PR/push runs the five mandatory
  Docker/Make jobs; read-only permissions; pinned Actions; no path filters,
  publication, release or tag path; trusted-main `sonar` job after all gates,
  serialized, only when enabled), with these changes:
  - the `sonar` job's analysis step receives exactly `SONAR_ENABLED`,
    `SONAR_HOST_URL` from `secrets.SONAR_HOST_URL`, `SONAR_TOKEN` from
    `secrets.SONAR_TOKEN` and `SONAR_PRISTINE_TAR`
    (`${{ runner.temp }}/pristine.tar`);
  - no other job references `secrets.SONAR_TOKEN`, and the `sonar` job never
    references `secrets.SONAR_PR_TOKEN`;
  - the `sonar` job runs the BR-151 pristine-export step before `make setup`,
    the BR-151 comparison step between `make setup` and its analysis step, and
    the BR-151 final Git-metadata step as its last step;
  - no CI step sets `SONAR_TOKEN_FILE` or `SONAR_HOST_URL_FILE`;
  - the PR analysis is the separate `sonar-pr` job of BR-149;
  - v3: the word `secrets`, matched case-insensitively as a whole word over
    every parsed key and string value of the workflow, appears only inside the
    `env` values of the two analysis steps (`make sonar`, `make sonar-pr`), so
    a secret reference in any other place or form is rejected: a `run`, `if`
    or `with` value, any job outside those two steps, a `secrets` key (such as
    `secrets: inherit`), bracket syntax such as `secrets['X']`,
    `toJSON(secrets)` or upper-case `SECRETS.SONAR_TOKEN`;
  - the v1 "Make-only `run`" rule admits exactly five non-Make `run` texts:
    the BR-151 pristine export, the BR-151 comparison, the BR-151 final
    Git-metadata step (v3), the BR-149 fork refusal and the BR-149 disabled
    notice. Each is a named constant in `tests/helpers/ci-policy.ts`, and each
    non-Make step occurrence (eight in all: the three BR-151 steps in each
    Sonar job, plus the two BR-149 steps) equals one of them.

  (v2: four run texts and the substring `secrets.` checked in `env` only; v1:
  no host secret, any PR analysis rejected.) Verified by: AC-09, AC-21.

### New rules

- **BR-144 v2** — Lint suppressions are explicit and justified: each
  `eslint-disable*` directive names at least one rule and carries a
  ` -- <reason>` description; unused disable directives are lint errors; no
  rule that the pinned upstream `strictTypeChecked` or SonarJS `recommended`
  configuration enables is lowered or disabled by repository configuration,
  except the justified entries of a bounded allowlist; the allowlist applies
  only to `tests/**/*.ts`, is asserted exactly by the BR-144 test, carries one
  justification comment per entry in `eslint.config.mjs`, and is listed with
  those justifications in the PR body; and no tracked TypeScript file contains
  `NOSONAR`. v2: a directive without rule names, and any inline ESLint
  configuration comment stops the lint run with a fixed error. An inline
  configuration comment follows ESLint's directive grammar: a block comment
  whose text, after leading whitespace is trimmed, starts with `eslint`,
  `eslint-env`, `global` or `globals` followed by whitespace (space, tab or
  newline) or the end of the comment, such as `/* eslint <rule>: "off" */` or
  `/*eslint\n <rule>: "off" */`. ESLint would otherwise apply it to
  every rule, including the rule that reports it. (v1: inline configuration
  comments were not covered.) Verified by: AC-02.
- **BR-145** — The Sonar host is selected from exactly one of `SONAR_HOST_URL`
  or `SONAR_HOST_URL_FILE`. A value is accepted only when it has no
  whitespace or control character and parses as a URL whose protocol is
  `https:`, with empty username, password, search and hash, and whose WHATWG
  serialization (`URL.href`) equals the value or the value followed by `/`.
  File mode mirrors `SONAR_TOKEN_FILE`: an absolute path, physically outside
  the checkout, not a final symlink, a readable regular file, and one terminal
  LF or CRLF removed. The entry guard rejects an existing or symlinked
  `.config/sonar-host-url` inside the checkout before any Docker prerequisite.
  Every rejection is a fixed message that never contains the value. Verified
  by: AC-03, AC-04.
- **BR-146** — The host is never printed: the wrapper replaces every ASCII
  case-insensitive occurrence of the configured host name in captured scanner
  stdout/stderr with `[REDACTED]` (including occurrences split across chunks or
  streams, as for the token), and no message from `scripts/sonar-entry.sh`,
  `scripts/sonar-snapshot.ts` or `scripts/sonar.ts` includes the host value,
  the host file path content or the token. Verified by: AC-05.
- **BR-147** — Active code and configuration never name the Sonar host:
  `sonar-project.properties` contains no `sonar.host.url` property (its
  presence fails property verification), keeps
  `sonar.projectKey=kdrive-mcp-server` (the `main` key; `make sonar-pr`
  overrides it by scanner argument, BR-148, and property verification accepts
  exactly this file in both modes), and keeps exactly `sonar.sources=src` and
  `sonar.tests=tests` with no inclusion or exclusion property, so the
  analysed file set is exactly the snapshot's files under `src/` and `tests/`
  plus `sonar-project.properties`; `scripts/sonar.ts` contains no `https://`
  literal whose host is not `github.com` (the trusted-repository URLs of
  BR-014 v1 stay); and before spawning the scanner the wrapper fails with a fixed
  message when any file of that analysed set contains the configured host
  name (ASCII case-insensitive). Files outside that set (for example
  `architecture-decisions/`, `features/history/`, `business-rules/`, `runs/`,
  `CHANGELOG.md`) never trigger the check. Verified by: AC-06, AC-15.
- **BR-148** — `make sonar-pr` analyses only a clean checkout whose provenance
  is a same-repository pull request into `main`: `GITHUB_ACTIONS=true`,
  `GITHUB_EVENT_NAME=pull_request`, `GITHUB_REPOSITORY` and
  `SONAR_PR_HEAD_REPOSITORY` (the workflow-supplied head repository, BR-149)
  both equal `sstolz/kdrive-mcp-server` (an empty or missing value is
  foreign), `GITHUB_BASE_REF=main`,
  `GITHUB_REF` matches `^refs/pull/[1-9][0-9]*/merge$`, and `GITHUB_SHA` is a
  40-hex commit equal to `HEAD` and to the snapshot commit, the snapshot's
  content being anchored to the pristine archive of that commit by BR-150. It sends project
  key `kdrive-mcp-server-pr` as the scanner argument
  `-Dsonar.projectKey=kdrive-mcp-server-pr` (never `kdrive-mcp-server`), passes
  `sonar.scm.revision` = that commit, no `sonar.branch.*` or
  `sonar.pullrequest.*` parameter, waits up to 300 seconds for this task's
  Quality Gate within the shared 15-minute deadline, verifies the task
  metadata `projectKey=kdrive-mcp-server-pr`, and exits nonzero on any failed
  gate, scanner, network, processing or timeout outcome. Any other provenance
  is rejected before coverage and upload. Verified by: AC-07, AC-08.
- **BR-149** — The CI workflow has a `sonar-pr` job that runs only for
  `pull_request` events into `main`, needs `lint`, `format`, `typecheck`,
  `test` and `build`, has `timeout-minutes: 15`, and uses concurrency group
  `sonar-kdrive-mcp-server-pr` with `cancel-in-progress: false` (which
  serializes runs and may cancel a pending one, T5). Its checkout
  uses the default pull-request merge ref, `fetch-depth: 0` and
  `persist-credentials: false`. The head repository is
  `github.event.pull_request.head.repo.full_name`; it appears only in step
  `if` expressions and in the `SONAR_PR_HEAD_REPOSITORY` step `env`, never in
  a `run` script, and an empty value (deleted fork) counts as foreign. The
  CI policy validator models step `if` and asserts the exact `if` condition
  of each `sonar-pr` step (fork refusal, disabled notice, pristine export,
  setup, comparison and analysis). For a head
  repository other than `github.repository`, its only executed `run` step fails with a fixed message and
  references no secret. For the same repository, when `vars.SONAR_ENABLED`
  is not `true`, it runs no analysis and prints a fixed "PR Quality Gate
  disabled" notice; when it is `true`, it runs the BR-151 pristine export,
  `make setup`, the BR-151 comparison, then a single analysis step that runs `make sonar-pr`
  with exactly `SONAR_ENABLED`, `SONAR_HOST_URL` from `secrets.SONAR_HOST_URL`,
  `SONAR_TOKEN` from `secrets.SONAR_PR_TOKEN`, `SONAR_PRISTINE_TAR`
  (`${{ runner.temp }}/pristine.tar`) and `SONAR_PR_HEAD_REPOSITORY`, and a
  missing or empty token or host fails the job.
  The workflow never uses `pull_request_target`, and no workflow-level or
  job-level `env` holds a secret. Verified by: AC-09, AC-13, AC-14.
- **BR-150 v2** — During `make sonar` and `make sonar-pr`, only the `analysis`
  Compose service receives `SONAR_TOKEN`, `SONAR_HOST_URL` or a credential/host
  file mount; the dev container that installs dependencies and the `prep`
  container that prepares the snapshot and runs build and coverage receive
  none of them. **Read-only preparation:** the entry script runs snapshot
  preparation in a dedicated `prep` Compose service that reuses the `dev` image (it declares
  the same `image:` name as `dev` and no `build:` of its own, so `make setup`
  builds it and no build runs inside the secret-bearing step) and mounts
  the checkout at `/workspace` **read-only**, with exactly one writable bind,
  `./artifacts/sonar-input` → `/workspace/artifacts/sonar-input` (created by
  the entry script on the host before the run), plus the existing
  `node_modules` and `npm_cache` named volumes; so no code run during
  preparation can rewrite `compose*.yaml`, `Makefile`, `scripts/`, `.git` or
  create `.env` or `compose.override.yaml` in the checkout. **Read-only Git
  metadata (v2):** the `dev` service binds `./.git` read-only at
  `/workspace/.git`, over its read-write checkout bind (long syntax,
  `read_only: true`, `create_host_path: false`), and the `prep` service keeps
  `.git` read-only through its read-only checkout bind. Every Compose service
  whose bind covers the checkout either binds it read-only or carries that
  read-only `.git` bind, and no other mount targets `/workspace/.git` or a
  path below it. So no container code,
  including dependency lifecycle scripts run by `make setup`, can write
  `.git/config`, `.git/hooks`, `.git/info`, the index, refs or objects. No Make
  target writes `.git`. **Compose project
  files:** every `docker compose` invocation of the entry script names its
  files explicitly (`-f compose.yaml`, plus `-f` overlays), and the entry
  script fails with a fixed message, at start and again immediately before
  starting the `analysis` service, when `compose.override.yaml`,
  `compose.override.yml`, `docker-compose.override.yaml`,
  `docker-compose.override.yml` or `.env` exists or is a symlink in the
  checkout. **Pristine snapshot:** the analysis service executes only
  pristine code and uploads only pristine content: before it starts,
  `scripts/sonar-entry.sh` (itself verified by BR-151) extracts the archive
  named by `SONAR_PRISTINE_TAR` (an absolute path outside the checkout, a
  regular non-symlink file, validated like `SONAR_TOKEN_FILE`) into a fresh
  `mktemp -d` directory under `${TMPDIR:-/tmp}`, never under the checkout,
  removed by the existing `cleanup` trap, resolves the snapshot directory
  behind `artifacts/sonar-input/current-<pid>` and fails with a fixed message
  unless the resolved physical path is a directory under the physical
  `artifacts/sonar-input` of the checkout, and fails with a fixed message
  unless a **bidirectional** `diff -r --no-dereference --exclude=coverage
  --exclude=dist --exclude=analysis-snapshot.json --exclude='*.tsbuildinfo'
  --exclude=node_modules` between that
  directory and the extracted archive reports no difference ("Only in"
  either side fails, so every analysed and configuration file is necessarily
  present). These exclusions are meant for the generated **root** entries
  only, but GNU `diff --exclude` matches base names at every depth, so the
  entry script also fails when `find <snapshot> -mindepth 2 \( -name coverage
  -o -name dist -o -name node_modules -o -name analysis-snapshot.json -o
  -name '*.tsbuildinfo' \) -print -quit` prints anything (as in BR-151), and
  when the root `node_modules`, if present in the snapshot, is not a symlink
  whose target equals exactly `/workspace/node_modules` (the value
  `scripts/sonar-snapshot.ts` writes). A
  tracked path that `scripts/sonar-snapshot.ts` filters out (a `secrets`,
  `node_modules`, `coverage`, `artifacts` or `dist` component, `.env*` except
  `.env.example`, key files) therefore fails closed by design; none exists
  today. **Fixed mode:** the entry script passes the mode to the `analysis`
  service as `SONAR_ANALYSIS_MODE=main` for `make sonar` and
  `SONAR_ANALYSIS_MODE=pr` for `make sonar-pr`, derived only from its `$1`
  target; this variable belongs to the exact `analysis`-service environment
  inspected by AC-10; `scripts/sonar.ts` takes the project key from that
  value only and fails with a fixed message, before spawning the scanner,
  when the manifest's `event` disagrees with it (`pull_request` in main mode,
  anything else in PR mode). **Manifest binding:** when
  `GITHUB_ACTIONS=true`, the entry script
  also fails unless the manifest's `commit` equals `GITHUB_SHA` and its
  `runId` equals the target name of `current-<pid>`. `SONAR_PRISTINE_TAR` is
  required when `GITHUB_ACTIONS=true`; locally, when it is unset, the
  pristine and manifest comparisons are skipped with a fixed notice; the
  read-only preparation and Compose project-file rules always apply. (v1:
  `.git` was writable in the `dev` service.) Verified by: AC-08, AC-10, AC-19,
  AC-20.
- **BR-151 v3** — In the `sonar` and `sonar-pr` jobs, three inline workflow
  steps (no file of the working tree is executed) declare no `env` key. The
  first two run before any step that receives a secret; the third is the last
  step of the job.
  - (1) **Pristine export**, before `make setup`. In both jobs it fails unless
    `git rev-parse HEAD` equals `GITHUB_SHA` (for `sonar`, the pushed or
    dispatched `main` tip; a moved `main` is already rejected by the snapshot's
    `GITHUB_SHA` check). It then writes `git archive --format=tar "$GITHUB_SHA"`
    to `$RUNNER_TEMP/pristine.tar` and extracts it to `$RUNNER_TEMP/pristine`,
    outside the checkout. v3: it fails unless `.git` is a non-symlink
    directory in which neither `commondir` nor `modules` exists or is a
    symlink, and it copies each of `.git/config`, `.git/config.worktree`,
    `.git/hooks/` and `.git/info/` that exists (as it is after checkout, links
    not followed) to `$RUNNER_TEMP/git-meta`. An entry absent at export is recorded as
    absent and must remain absent.
  - (2) **Comparison**, after `make setup`. It fails in each of these cases:
    - the root `node_modules` is neither absent nor an empty, non-symlink
      directory (the Compose volume mount point);
    - `diff -r --no-dereference --exclude=.git --exclude=node_modules
      "$RUNNER_TEMP/pristine" .` reports any difference (modified, missing or
      extra file, including ignored or excluded files);
    - `find . -mindepth 2 \( -name node_modules -o -name .git \) -not -path
      './.git/*' -print -quit` prints anything (the `node_modules` and `.git`
      exclusions cover only the root entries);
    - any of `GNUmakefile`, `makefile`, a root `*.mk` file,
      `compose.override.yaml`, `compose.override.yml`,
      `docker-compose.override.yaml`, `docker-compose.override.yml`, `.env`,
      `.config/qube-token` or `.config/sonar-host-url` exists or is a symlink
      in the checkout;
    - v3 (the **Git-metadata check**): `.git` is not a non-symlink directory;
      `.git/commondir` or `.git/modules` exists or is a symlink; or, for each
      of `config`, `config.worktree`, `hooks` and `info` present on
      either side, `diff -r --no-dereference` between its saved copy in
      `$RUNNER_TEMP/git-meta` and the current `.git` entry reports any
      difference (an entry present on one side only is a difference).

    `make setup` leaves nothing in the checkout except the empty `node_modules`
    mount point.
  - (3) **Final Git-metadata step** (v2), with the condition exactly
    `always()` in both jobs, the last step of the job and therefore before the
    `actions/checkout` post step. It invokes no `git` command. When
    `$RUNNER_TEMP/git-meta` does not exist (no export ran, for example on fork
    or disabled runs), it exits 0. Otherwise it runs the Git-metadata check of
    (2); when that check fails, it renames the `.git` entry itself, without
    following a link and never deleting it, with `mv -T -- .git
    .git.quarantine`, or, when that rename fails (for example an existing
    non-empty `.git.quarantine`), with `mv -T -- .git
    "$RUNNER_TEMP/git-quarantine"`, and exits nonzero with a fixed message.
    The checkout post step then finds no `.git/config` and runs no `git`.
    Post-condition: either the Git metadata equals the saved copy, or no
    `.git` entry is reachable in the checkout and the job fails.

  The analysis step receives `SONAR_PRISTINE_TAR` pointing to the exported
  archive. Both Sonar jobs keep `actions/checkout` with
  `persist-credentials: false` and no `submodules` input. What remains: the
  checkout post step still runs host `git` on the checkout, and no checkout
  input disables it; v2 bounds it to pristine Git metadata (T2). (v1: two
  steps; `.git` was neither compared nor moved aside.) Verified by: AC-09, AC-18,
  AC-21.

## Acceptance criteria

- **AC-01** (BR-010 v2) — Given a fixture whose only defect is a SonarJS-class
  issue (`if (flag) { run(); } else { run(); }`, rule
  `sonarjs/no-all-duplicated-branches`) and that compiles and is formatted,
  When the repository ESLint configuration lints it, Then lint exits nonzero
  naming that rule; and Given the same fixture without the duplicated branch,
  Then lint exits 0. Also, on this PR's own branch, one commit seeding that
  issue in `src/` makes `make lint` fail locally and the `lint` job fail in
  CI, and a following commit reverts it before the merge (no extra branch or
  PR, AGENTS.md §6). Verified by: `tests/quality-commands.test.ts` —
  `BR-010 v2 SonarJS rejects a seeded duplicated-branch fixture` /
  `BR-010 v2 accepts the fixed fixture`; the seeded and reverted commit SHAs
  and their CI run URLs recorded in `runs/50-development-1.md`.
- **AC-02** (BR-010 v2, BR-144 v2) — Given the committed `eslint.config.mjs`,
  When the effective configuration is computed for `src/index.ts`,
  `scripts/sonar.ts` and a `tests/` file, Then every rule that the pinned
  upstream `strictTypeChecked` and SonarJS `recommended` configuration objects
  set to `error` is still `error` for the first two (upstream `off` entries
  are not compared), `eslint.config.mjs` sets no rule to `off` or `warn` for
  `src/**` or `scripts/**`, `tests/` overrides equal the asserted allowlist,
  a directive without
  ` -- ` or an unused directive fails lint, a directive without rule names or
  an inline configuration comment (v2: `/* eslint <rule>: "off" */`, the
  newline form `/*eslint\n <rule>: "off" */`, and `eslint-env`, `global` and
  `globals` comments) stops the lint run, a tracked `NOSONAR` is reported,
  and `make lint` on the branch head exits 0. Verified by:
  `tests/quality-commands.test.ts` — `BR-144 ...` cases; `make lint` output in
  `runs/50-development-1.md`.
- **AC-03** (BR-145) — Given host values `https://sonar.example.test`,
  `https://sonar.example.test/` and `https://sonar.example.test/ctx` (accepted)
  and `http://…`, relative, `https://user:pw@…`, `…?q=1`, `…#f`,
  `https://SONAR.example.test`, `https://sonar.example.test:443`, a value with a
  space, LF or NUL, empty, both modes and neither mode (rejected), When the
  wrapper loads the host, Then exactly the accepted values succeed and every
  rejection message equals its fixed text and omits the value. Verified by:
  `tests/sonar-v4.test.ts` — `BR-145 loads exactly one canonical https host`.
- **AC-04** (BR-145) — Given `SONAR_HOST_URL_FILE` relative, inside the
  checkout (including `..` and directory-symlink aliases), a final symlink, a
  missing file, or an existing/symlinked `.config/sonar-host-url` in the
  checkout, When `make sonar`, `make sonar-pr` or `make quality` starts, Then
  it fails with the
  fixed message before any Docker prerequisite; and Given an external file
  with one terminal LF, Then the host loads. Verified by:
  `tests/dev-environment.test.ts` — `BR-145 %s rejects unsafe host file
  locations before any Docker prerequisite`; `tests/sonar-v4.test.ts` —
  `BR-145 host file accepts one terminal LF/CRLF only`.
- **AC-05** (BR-146, BR-014 v2) — Given a fake scanner that prints the host
  name whole, in upper case, split across two chunks, and split between stdout
  and stderr,
  When the wrapper runs, Then the emitted log contains `[REDACTED]`, no occurrence of
  the host name and no trailing partial prefix of it, and the
  child environment contains `SONAR_HOST_URL`; and every fixed error of the
  entry guard, snapshot and wrapper omits a synthetic host. Verified by:
  `tests/sonar-v4.test.ts` — `BR-146 redacts the host across chunks and
  streams`; `BR-146 fixed messages never contain the host`.
- **AC-06** (BR-147) — Given `sonar-project.properties` with an added
  `sonar.host.url` line, When properties are verified, Then verification
  fails, and so does an added `sonar.exclusions` or `sonar.inclusions` line or
  a changed `sonar.sources`; Given a snapshot whose `tests/x.test.ts` or
  `src/x.ts` contains the synthetic host name in upper case, When the wrapper
  runs, Then it fails with the fixed message before spawning the scanner;
  Given a snapshot whose only occurrence is in `runs/x.md` or
  `architecture-decisions/ADR-x.md`, Then the check passes; Given
  `scripts/sonar.ts`, Then every `https://` literal it contains has host
  `github.com`. Verified by:
  `tests/sonar-analysis.test.ts` — `BR-147 fails on the host in the analysed
  set`, `BR-147 ignores records outside the analysed set`,
  `BR-147 rejects host, inclusion and exclusion properties`.
- **AC-07** (BR-148) — Given PR provenance fixtures, When `make sonar-pr`
  preparation verifies them, Then only the valid same-repository merge
  commit passes, and each of: event `push`, `pull_request_target`, a fork head
  repository, an empty `SONAR_PR_HEAD_REPOSITORY`, base `develop`, ref `refs/heads/feature`, `GITHUB_SHA` ≠ `HEAD`,
  a dirty tree, or `GITHUB_ACTIONS` unset is rejected before coverage; and
  `make sonar` still rejects a `pull_request` event. Verified by:
  `tests/sonar-analysis.test.ts` — `BR-148 rejects untrusted PR provenance %j`
  and `BR-014 v2 main mode rejects pull_request`.
- **AC-08** (BR-148, BR-014 v2, BR-150) — Given a fake scanner in PR mode, When it
  exits 0 with metadata `projectKey=kdrive-mcp-server-pr` and the configured
  `serverUrl`, Then the wrapper exits 0 and its arguments contain
  `-Dsonar.projectKey=kdrive-mcp-server-pr` and no `sonar.branch.` or
  `sonar.pullrequest.` key; When it exits nonzero (failed gate), Then the
  wrapper returns that code; When metadata names `kdrive-mcp-server` or
  another `serverUrl`, Then the wrapper fails; When the manifest claims
  `push` with `SONAR_ANALYSIS_MODE=pr`, or `pull_request` with
  `SONAR_ANALYSIS_MODE=main`, Then the wrapper fails before spawning the
  scanner. Verified by:
  `tests/sonar-v4.test.ts` — `BR-148 PR mode targets only the PR project`,
  `BR-150 mode mismatch with the manifest event fails before the scanner`,
  `BR-148 preserves a failed PR gate exit code`.
- **AC-09** (BR-015 v3, BR-149, BR-151 v3) — Given the real `.github/workflows/ci.yml`,
  When the CI policy validator runs, Then it passes; and Given mutations that
  add `pull_request_target`, give the `sonar-pr` job `secrets.SONAR_TOKEN`,
  give the `sonar` job `secrets.SONAR_PR_TOKEN`, put a secret in job or
  workflow `env`, give a secret to `make setup`, remove the fork-refusal
  step, drop a `needs` entry, set `cancel-in-progress: true`, remove the
  same-repository condition from the analysis step, remove the BR-151
  pristine export or move it after `make setup`, remove the BR-151
  comparison or move it after the analysis step (either job), change any
  admitted non-Make `run` text from its constant (for example to run a
  working-tree file), add an `env` key to a BR-151 step, drop
  `SONAR_PRISTINE_TAR` from the analysis step, interpolate the head
  repository into a `run` script, or set `SONAR_TOKEN_FILE` or
  `SONAR_HOST_URL_FILE` in either job; and (v3) remove the BR-151 final
  Git-metadata step, move it before another step, drop its `if: always()`,
  add `secrets.SONAR_TOKEN` to a gate job's checkout `with` (`token`), use
  `secrets['SONAR_TOKEN']` or `toJSON(secrets)` in any `run`, `if` or `env`
  outside the two analysis env sets, use `SECRETS.SONAR_TOKEN` in a gate job,
  add a `secrets` key to a job, or give the final step a condition other than
  exactly `always()`, Then each is rejected.
  Verified by: `tests/ci-policy.test.ts` — `BR-015 v3 ...` and
  `BR-149 rejects unsafe PR gate fixture %s`.
- **AC-10** (BR-150) — Given `compose.yaml`, the host-file overlay and
  `scripts/sonar-entry.sh`, When the dev/prep invocation and service
  definitions are inspected, Then `SONAR_TOKEN`, `SONAR_HOST_URL`,
  `SONAR_TOKEN_FILE`, `SONAR_HOST_URL_FILE` and their mounts appear only on the
  `analysis` service, whose environment also contains the fixed
  `SONAR_ANALYSIS_MODE`; the `prep` service mounts `/workspace` read-only and
  `artifacts/sonar-input` is its only writable bind (besides the
  `node_modules` and `npm_cache` named volumes); the `prep` service uses the
  `dev` image with no `build:` of its own; and every `docker compose`
  call in the entry script passes `-f compose.yaml`. Verified by:
  `tests/dev-environment.test.ts` — `BR-150 only the analysis service
  receives Sonar secrets`, `BR-150 prep mounts the checkout read-only`.
- **AC-11** (BR-012 v2) — Given a PR merge-commit snapshot, When `make
  sonar-pr` prepares coverage, Then the manifest binds the merge SHA and
  source/test/config/lockfile digests, and stale or mismatched LCOV is
  rejected before upload. Verified by: `tests/sonar-analysis.test.ts` —
  `BR-012 v2 binds fresh coverage to the PR merge commit`.
- **AC-12** (BR-014 v2, BR-015 v3) — Given the merged actual `main` and the
  owner having set `SONAR_ENABLED=true`, When the `sonar` job runs on a `main`
  push or `workflow_dispatch`, Then it reads the host from the secret,
  analyses `kdrive-mcp-server` and succeeds with its Quality Gate, and the log
  shows no host. Verified by: the `main` push run of the merge of the
  records-synchronization PR of AGENTS.md §6 (the PR that marks F-011
  `done`), URL and conclusion recorded in `runs/50-acceptance-1.md`, or
  owner-observed.
- **AC-13** (BR-148, BR-149, P1, P2) — Given `kdrive-pr-gate` configured
  per P1: (a) Given this PR's head, When the owner analyses it into
  `kdrive-mcp-server-pr` (P2), Then the gate passes; (b) Given one commit on
  this PR's branch that seeds a single Reliability bug in `src/` (an
  identical-sub-expression bug `value > 1 && value > 1`, Sonar rule S1764,
  kept past lint by an inline
  `// eslint-disable-next-line sonarjs/no-identical-expressions -- F-011 AC-13 seeded gate violation`),
  (v2 erratum: v1 named `value === value`, which SonarJS 4.2.2 exempts as the
  NaN-check idiom, so its directive was unused and lint failed; acceptance
  erratum 2026-11-04: the S1764 seed produced no issue on the owner's server,
  so AC-13(b) was proven with a single S7781 seed
  (`value.replace(/a/gu, "b")`, reported as Reliability by that server and
  not by the lint gate), see the acceptance record),
  When the owner analyses that commit into the PR project, Then the gate
  fails on Reliability rating, and a following commit reverts the seed before
  the merge; (c) Given a fake scanner returning a failed-gate exit code, Then
  `make sonar-pr` exits nonzero, which fails the `sonar-pr` job and makes the
  PR not merge-eligible under AGENTS.md §3 step 6 (AC-08); (d) Given
  `SONAR_ENABLED=true` after the merge, When the records-synchronization PR
  of AGENTS.md §6 (the PR that marks F-011 `done`) runs, Then `sonar-pr`
  succeeds with the real gate. #50 closes only after the AC-12 and AC-13(d)
  run URLs are recorded. Verified by:
  owner-observed results for (a) and (b) with the seeded and reverted SHAs,
  the AC-08 test for (c), and the CI run URL for (d), all in
  `runs/50-acceptance-1.md`. A real failing `sonar-pr` job is recorded as
  owner-observed when it first occurs; no extra acceptance branch is created
  without the owner's authorization.
- **AC-14** (BR-149) — Given a fork pull request, When CI runs, Then no executed step
  references a secret, the refusal is the only executed `run` step apart from
  the BR-151 v2 final step (which exits 0 because no export ran), and
  `sonar-pr` fails with the fixed message. Verified
  by: `tests/ci-policy.test.ts` — `BR-149 fork runs execute only the
  secret-free refusal run step`; a real fork run is optional, owner-observed
  evidence (a second account is needed).
- **AC-15** (BR-147) — Given actual `main` after the merge, When the owner or
  orchestrator runs `git grep -c -i -F -f <external host-name file> --
  src scripts tests .github Makefile 'compose*.yaml' '*.properties'
  package.json README.md docs` (pattern read from a file outside the checkout,
  output limited to counts), Then it prints nothing and exits 1; record paths
  are deliberately not searched, as narrowed by D9 and the orchestrator's
  comment on #50 that records this narrowing of the ticket's acceptance line.
  Verified by: that command and its exit code in
  `runs/50-acceptance-1.md`.
- **AC-16** (#21 records) — Given this PR, When the records are inspected,
  Then BR-124–BR-143 have `status: active` and an acceptance History line
  citing main `3fc14c3`, BR-100 and BR-024 carry a v2-accepted History line,
  F-010 is `status: done` with its acceptance paragraph, and the BR index,
  spec index, `CHANGELOG.md` and `capability-map.md` show #21 accepted and
  client connections not established. Verified by: independent PR review and
  `grep -L 'status: active' business-rules/BR-1{2[4-9],3[0-9],4[0-3]}.md`
  printing nothing.
- **AC-17** (all) — Given the branch head and then actual `main`, When
  `make check` runs, Then it exits 0, and the PR's CI jobs are green on the
  latest commit. Verified by: `make check` output and CI run URL.
- **AC-18** (BR-151 v3) — Given the first two BR-151 constants from
  `tests/helpers/ci-policy.ts` (which AC-09 proves equal to the real
  workflow steps), each executed with `bash -eo pipefail` in the dev image
  (the constants use only GNU `diff` ≥ 3.3, `git` 2.39, `find`, `tar`,
  GNU `cp`, `mv`, `mkdir`, `rm`, `ls` and `test`),
  and a temporary Git repository with `RUNNER_TEMP` and `GITHUB_SHA` set,
  When the export then the comparison run on an unchanged checkout, with or
  without an empty root `node_modules` directory, Then both exit 0; When, between them, a tracked file is modified,
  a file is staged, an untracked file is added, `compose.override.yaml`,
  `.env` or `.config/sonar-host-url` is created under a fixture
  `.gitignore`, a modified `Makefile` is committed with `git commit -a`, a
  modified `scripts/sonar-entry.sh` is hidden with
  `git update-index --skip-worktree`, or a `GNUmakefile` is created and
  listed in `.git/info/exclude`, or the root `node_modules` is non-empty or
  a symlink, or `scripts/node_modules/x` or `scripts/.git/x` exists, Then
  the comparison exits
  nonzero; and When
  `HEAD` differs from `GITHUB_SHA`, Then the export exits nonzero. No output
  contains an environment value. Verified by: `tests/ci-policy.test.ts` —
  `BR-151 pristine comparison rejects %s`.
- **AC-19** (BR-150) — Given a pristine archive and a frozen snapshot fixture,
  When `scripts/sonar-entry.sh` reaches the pre-analysis comparison with a
  fake Docker, Then it continues for an identical snapshot; and When the
  fixture rewrites `scripts/sonar.ts`, `src/x.ts` or `tsconfig.json`, adds
  `scripts/extra.ts`, changes `sonar-project.properties` or `package.json`,
  removes `tests/x.test.ts`, replaces the `node_modules` symlink by a
  directory, re-points it at `coverage/nm`, or rewrites the manifest's `commit` or `runId` in the snapshot
  between coverage and freeze, or adds `src/coverage/x.ts`,
  `tests/dist/x.test.ts` or `scripts/node_modules/x`, or points
  `current-<pid>` at a directory outside `artifacts/sonar-input`, Then it
  fails with the fixed message before
  the `analysis` service starts; When `compose.override.yaml` or `.env`
  exists in the checkout at start, or a fake prep creates one (simulating a
  host-side writer) before the analysis step, Then the entry script fails
  before starting the `analysis` service (the read-only mount itself is
  verified statically by AC-10, because tests run in the dev container
  without a Docker socket); changes limited to
  the generated entries pass; no new entry appears in the checkout and the
  temporary extraction directory is removed; When `GITHUB_ACTIONS=true` and
  `SONAR_PRISTINE_TAR` is unset, relative, a symlink or inside the checkout,
  Then it fails before any Docker prerequisite. Verified by:
  `tests/dev-environment.test.ts` — `BR-150 analysis runs only pristine
  snapshot code (%s)`.
- **AC-20** (BR-150 v2) — Given `compose.yaml`, When every service definition
  is inspected, Then `dev` has a long-syntax bind `./.git` →
  `/workspace/.git` with `read_only: true` and `create_host_path: false`
  after its checkout bind, `prep` mounts the checkout read-only, every service
  whose bind covers the checkout either binds it read-only or carries that
  read-only `.git` bind, and no other mount targets `/workspace/.git` or a
  path below it; and Given mutations that drop that bind, set
  `read_only: false`, make the `prep` checkout bind writable, add a service
  with a read-write checkout bind and no `.git` bind, or add a read-write bind
  at `/workspace/.git/hooks`, Then the check rejects each. One runtime check is
  recorded in the runs evidence: writing a file under `.git` from
  `docker compose run --rm dev` fails. Verified by:
  `tests/dev-environment.test.ts` — `BR-150 v2 .git is read-only in dev and
  prep (%s)`; `runs/50-development-1.md`.
- **AC-21** (BR-151 v3) — Given the three BR-151 constants from
  `tests/helpers/ci-policy.ts`, each executed with `bash -eo pipefail` in the
  dev image, and a temporary Git repository with `RUNNER_TEMP` and
  `GITHUB_SHA` set:
  - When the export, the comparison and the final step run on an unchanged
    checkout, Then all three exit 0; v3: this holds both without
    `.git/config.worktree` and with one present at export holding the keys
    the checkout writes (`core.sparseCheckout`, `core.sparseCheckoutCone`,
    `index.sparse`; the fixture writes the file directly with the value
    `false`, because `git config --worktree` writes to `.git/config` while
    `extensions.worktreeConfig` is unset).
  - When `git config core.fsmonitor <command>` is set, a
    `.git/hooks/post-checkout` hook is written, `.git/info/attributes` is
    written, `.git/config` is replaced by a symlink, `.git/hooks` is replaced
    by a symlink to a directory, `.git/info` (absent at export) is created,
    `.git/commondir` or `.git/modules` is created, or `.git` is replaced by a
    symlink between export and comparison, Then the comparison exits
    nonzero; v3 adds `.git/config.worktree` created after an export without
    one, modified (`core.fsmonitor` added) after an export with one,
    replaced by a symlink after an export with one, and removed after an
    export with one.
  - When the same mutations are made, Then the final step exits nonzero, and
    afterwards no `.git` entry exists in the checkout (not even a link) and
    the moved entry exists as `.git.quarantine`; and When `.git.quarantine`
    already exists as a non-empty directory, Then `.git` is moved to
    `$RUNNER_TEMP/git-quarantine` instead and the step exits nonzero.
  - When no export ran, Then the final step exits 0.
  - When the export runs with `.git/commondir` or `.git/modules` present, Then
    it exits nonzero; v3: When it runs with `.git/config.worktree` present,
    Then it exits 0 and `$RUNNER_TEMP/git-meta/config.worktree` is
    byte-identical to it (`cmp`).
  - The final-step constant contains no `git` command (no token `git`
    followed by whitespace or the end of a line).
  - No output contains an environment value.

  And Given the real workflow, When the CI policy validator runs, Then it
  requires the final step as the last step of both Sonar jobs with the
  condition exactly `always()` and no `env`.
  Verified by: `tests/ci-policy.test.ts` — `BR-151 v2 Git metadata check
  rejects %s`, `BR-151 v2 final step quarantines .git after %s`,
  `BR-151 v3 Git metadata check rejects config.worktree %s`,
  `BR-151 v3 final step quarantines .git after config.worktree %s`,
  `BR-151 v2 final step passes without an export`, `BR-151 v3 export,
  comparison and final step accept an unchanged config.worktree`,
  `BR-151 v3 export rejects unsupported Git metadata %s`, and the AC-09
  mutations.

## Decisions

- **D1 — Dedicated PR project with an overall-code gate (owner decision).**
  Chosen: analyse PR merge commits as the single branch of
  `kdrive-mcp-server-pr`. Rejected: analysing PRs into `kdrive-mcp-server`
  (pollutes `main` history and its new-code period); the community branch
  plugin (third-party server change, owner's server is plain CE); Developer
  Edition (cost, owner decision); lint-only checks (miss server-only rules,
  duplication and coverage conditions).
- **D2 — `pull_request`, never `pull_request_target`.** The latter runs with
  secrets in the base context and would hand them to untrusted fork code.
- **D3 — Fork PRs fail closed.** Rejected: skipping the job for forks (a
  skipped job counts as passing, so the gate would be silently bypassed).
  Maintainers re-push reviewed fork content to a same-repository branch. That
  review covers `.github/`, `Makefile`, `scripts/`, `compose*.yaml`, the
  `package.json` scripts and lockfile changes, because the re-push gives the
  content access to secrets (T3); the PR body records it. Bot PRs follow the
  same path.
- **D4 — Disabled means a successful no-op with a fixed notice.** Needed
  because `SONAR_ENABLED` is set only after this PR merges, so this PR's own
  CI must pass. Rejected: failing when disabled (would block #50 itself).
- **D5 — Blocking is procedural.** The plan does not allow branch protection
  or required checks (HTTP 403, verified 2026-11-03). A failing `sonar-pr`
  check makes the PR not merge-eligible under AGENTS.md §3 step 6; a
  cancelled or skipped-by-cancellation `sonar-pr` is not green either and is
  re-run before the merge (T5). Rejected:
  requiring a GitHub plan upgrade (owner cost, out of scope). If the plan
  later allows it, the owner can enable branch protection or a ruleset that
  requires the five gates and `sonar-pr`, without changing this contract.
- **D6 — Analyse the merge commit (`GITHUB_SHA`).** It is the code that the
  merge produces. Rejected: the head SHA (ignores `main` changes).
- **D7 — The scanner keeps one token variable.** The workflow maps
  `secrets.SONAR_PR_TOKEN` to `SONAR_TOKEN` for `make sonar-pr`. Rejected: a
  second wrapper variable (larger surface, no benefit; tokens are
  project-scoped server-side).
- **D8 — Host from environment or external file, canonical form, host-name
  redaction.** Mirrors the token contract the owner already uses. Requiring
  the canonical serialization makes the configured host name lower case, and
  redaction matches it case-insensitively, so it also covers every URL form
  and any echo in another case. Rejected:
  storing the host in a tracked file (owner decision); redacting only the
  full URL (scanner errors can print the bare host name).
- **D9 — Remove the host from active code and configuration only (decision
  within the owner's intent, "not in the source code").** The removal set is
  `src/`, `scripts/`, `tests/`, `.github/`, `Makefile`, `compose*.yaml`,
  `*.properties`, `package.json`, `README.md` and current non-history docs
  that describe Sonar configuration. Historical and immutable records keep the
  host unchanged: accepted ADR-002, `features/history/F-001-v3.md`, the done
  F-001 record, superseded BR-013, `runs/` evidence and CHANGELOG entries of
  past releases. BR-147 checks only the analysed file set, which excludes
  them. Rejected: **rewriting history records** — accepted ADRs never change
  (AGENTS.md §7), frozen snapshots and `runs/` evidence are preserved, and
  altering them would falsify what was recorded at the time; rewriting Git
  history (out of scope). The orchestrator records this narrowing of the
  ticket's acceptance line in a comment on #50.
- **D10 — `eslint-plugin-sonarjs` 4.2.2 `recommended` and
  `strictTypeChecked`.** 4.2.2 is the latest release, older than two weeks,
  with an ESLint 10 peer range. Rejected: enabling every SonarJS rule (many
  are opinionated duplicates of typescript-eslint); `strict` without type
  information (weaker); adding `stylistic` (formatting is Prettier's job).
- **D11 — Separate `make sonar-pr` target.** Keeps `make sonar` strictly
  trusted-main (BR-014 unchanged in that respect). Rejected: inferring the
  mode from the event inside `make sonar` (one target with two trust levels).
- **D12 — `sonar-pr` needs the five gates.** No upload of code that fails a
  local gate; a lint failure already blocks the PR. Rejected: running in
  parallel (faster, but uploads broken code and costs server time).
- **D13 — Justified Sonar-only findings.** Inline ESLint suppressions need a
  ` -- reason`; `NOSONAR` is forbidden because it silently suppresses every
  rule on a line. A server-only finding judged acceptable is resolved in the
  Sonar UI by the owner, with the reason recorded in the ticket; CE issue
  tracking keeps that resolution on the PR project's single branch while the
  code is unchanged; alternating PR merge commits can close and reopen it, so
  re-acceptance may be needed (T5 residual).
- **D15 — Fixed PR-project gate (P1).** Ratings A on overall code only.
  Rejected: coverage conditions (coverage is not uploaded as a gated
  measure for PRs and would couple the gate to test volume); hotspot
  conditions (hotspots are reviewed once, in the `main` project); the
  default "Sonar way" (new-code conditions are meaningless on a single-branch
  project that receives unrelated merge commits).
- **D16 — Seeded evidence on this PR's branch.** AC-01 and AC-13 seed and
  revert commits on this branch instead of throwaway branches, respecting
  AGENTS.md §6 (one ticket, one branch, one PR; no branch without
  authorization). The real `sonar-pr` job cannot run before the merge
  because `SONAR_ENABLED` stays unset (P3), so AC-13's real gate failure is
  owner-observed through a manual analysis.
- **D17 — Git metadata is protected, not only compared (v2).** Chosen:
  `.git` read-only in the dev and `prep` containers, plus a saved copy of
  `.git/config`, `.git/hooks/` and `.git/info/` that is compared after setup
  and restored by a final `always()` step before the checkout post step.
  Rejected: a residual-risk acceptance (orchestrator decision; the attack gives
  host execution beside the secrets); comparing only (a failing step does not
  stop post steps); removing `actions/checkout` (would need an unpinned or
  hand-written fetch of the private repository); restoring the whole `.git`
  (large, and unnecessary once containers cannot write it); restoring only
  `config`, `hooks` and `info` in place (a restore through a symlinked entry
  writes to an attacker-chosen path, and the post step would still run `git`
  in an attacker-chosen gitdir); deleting `.git` (owner decision 2026-11-03:
  rename, never delete). On a mismatch the final step renames `.git` to
  `.git.quarantine` (fallback `$RUNNER_TEMP/git-quarantine`) so the checkout
  post step finds no repository. Consequence of the read-only bind with
  `create_host_path: false`: every `make` target fails where `./.git` is
  absent (a source tarball or an extracted archive); development and CI always
  run in a Git checkout, and the published npm package does not use Make.
- **D18 — Inline configuration comments stop the lint run (v2).** Like a blanket
  directive, `/* eslint <rule>: "off" */` lowers rules for its file, including
  the reporting rule, so a problem report would be silenced. Rejected:
  `noInlineConfig` (it would also disable the justified line directives that
  BR-144 relies on).
- **D19 — `config.worktree` is saved and compared, not refused (v3).** The
  pinned `actions/checkout` writes it on the runner (measured, Context v3), so
  refusing it fails every Sonar run. Git reads it only when
  `extensions.worktreeConfig` is set in `.git/config`, which is itself saved
  and compared; saving and comparing `config.worktree` byte for byte, like
  `config`, still detects any later change (for example a `core.fsmonitor`
  added there) before the post step runs `git`, and the final step still
  quarantines `.git` on a mismatch. `.git` stays read-only in the containers
  (BR-150 v2). Rejected: deleting `config.worktree` after checkout (it
  rewrites metadata the checkout produced and the comparison would no longer
  match what the post step reads); pinning another `actions/checkout` or a
  sparse option (the measured file comes from the action's own `git
  sparse-checkout disable` followed by unsetting `extensions.worktreeConfig`,
  not from an input this repository sets);
  keeping the refusal and accepting a disabled Sonar CI (it defeats #50);
  requiring `config.worktree` to be a regular file at export (v2 already
  trusts the post-checkout state of `config`, `hooks` and `info`, which only
  the pinned checkout writes before the export; a stricter export check is
  out of scope for this fix).
- **D14 — ADR-005** records D1–D5 and D15 because the PR-project strategy is costly to
  reverse (owner server setup, tokens, merge policy).

## Open questions

## Stress-test

### v3 round 1 — reviewed SHA `1611a4d`

Opus 5.5 high, approve, no critical or major
(runs/50-spec-v3-review-1.md (archived evidence `runs/50-spec-v3-review-1.md`)).

- **m1 (minor), retained:** the T2 control column names `config.worktree` and
  BR-151 v3.
- **m2 (minor), retained:** Scope items, AC-09 and AC-18 cite BR-151 v3.
- **m3 (minor), retained:** AC-21 and BR-151 E-09 add `config.worktree`
  removed after an export with one.
- **m4 (minor), retained:** Context states that only key names were measured;
  AC-21 and E-07 state the fixture values and why the fixture writes the file
  directly.
- **m5 (minor), retained:** the `config.worktree` cases get v3 test names; the
  AC-21 and BR-151 verification lists match.
- **Note (optional), rejected:** requiring a regular `config.worktree` at
  export; reason recorded in D19.

### v3 round 2 (Fable decision pass) — reviewed SHA `fb5ad17`

Fable 5.1, approve, no critical or major
(runs/50-spec-v3-fable-1.md (archived evidence `runs/50-spec-v3-fable-1.md`)).

- **m1 (minor), retained:** AC-21 and BR-151 E-07 require the saved copy to be
  byte-identical (`cmp`).
- **m2 (minor), retained:** Context and D19 record the checkout's
  `git sparse-checkout disable` then `extensions.worktreeConfig` unset.
- **Note, unchanged v2 residual:** when both `mv` targets are occupied the
  final step leaves `.git` in place; `$RUNNER_TEMP` is unreachable from
  containers. No change.


### Round 1 — reviewed SHA `5b7326ea57a8dcd62ede865d20ca5ef194e3dcd3`

Review: runs/50-spec-review-1.md (archived evidence `runs/50-spec-review-1.md`) (Fable,
devil's advocate with secrets threat model), verdict `changes`, 5 major,
10 minor. All findings retained; majors decided by the orchestrator.

- **F1 (major), retained:** new BR-151 inline secret-free tree-integrity step
  between `make setup` and any secret-bearing step, in both Sonar jobs; T2
  states the read-write bind mount; AC-09 mutations and AC-18 behaviour
  tests. `npm ci --ignore-scripts` not adopted (dependencies may need
  install scripts; the check covers the tampering path).
- **F2 (major), retained:** T5, BR-149 and D5 describe the one-running,
  one-pending cancellation behaviour; a cancelled `sonar-pr` is re-run before
  the merge.
- **F3 (major), retained:** BR-144 and AC-02 compare against the rules the
  pinned upstream configurations enable; a bounded, justified allowlist is
  the only exception.
- **F4 (major), retained:** the literal check is narrowed to `https://`
  literals whose host is not `github.com`.
- **F5 (major), retained:** owner prerequisites P1 (`kdrive-pr-gate`, ratings
  A on overall code, no hotspot or coverage condition), P2 (baseline manual
  analysis before the merge, active-code findings fixed in this PR) and P3;
  AC-13 uses one seeded Reliability bug; D15 added.
- **F6 (minor), retained:** 10 `runs/` records.
- **F7 (minor), retained:** `SONAR_PR_HEAD_REPOSITORY`, env-only, empty is
  foreign (BR-148, BR-149, AC-07, AC-09).
- **F8 (minor), retained:** AC-04 includes `make sonar-pr`.
- **F9 (minor), retained:** `SONAR_TOKEN_FILE` / `SONAR_HOST_URL_FILE` are
  rejected in CI (BR-015 v2, AC-09).
- **F10 (minor), retained:** case-insensitive host redaction (BR-146, D8,
  AC-05).
- **F11 (minor), retained with the orchestrator's variant:** no throwaway
  branches; seed-and-revert commits on this PR's branch (AC-01, AC-13, D16).
- **F12 (minor), retained:** D3 defines the review before re-pushing fork or
  bot content.
- **F13 (minor), retained:** Scope 1 limits `src/` fixes to
  behaviour-preserving edits; the allowlist is listed in the PR body
  (BR-144).
- **F14 (minor), retained:** bot PRs fail closed (Out of scope, T7, D3).
- **F15 (minor), retained:** CE queueing and issue re-acceptance recorded as
  residual risk (T5, D13).

### Round 2 — reviewed SHA `3a142b6`

Review: runs/50-spec-review-2.md (archived evidence `runs/50-spec-review-2.md`) (Fable),
verdict `changes`, 2 major, 5 minor; round 1 fixes confirmed. All findings
retained; majors decided by the orchestrator.

- **F16 (major), retained:** BR-151 no longer trusts post-setup `.git`
  state: a pristine `git archive HEAD` is exported to `$RUNNER_TEMP` before
  `make setup` and compared by `diff -r --exclude=.git` afterwards, plus an
  explicit forbidden-file list (`GNUmakefile`, `makefile`, root `*.mk`,
  compose overrides, `.env`, credential paths). AC-09 and AC-18 add the
  `git commit -a`, `skip-worktree` and `.git/info/exclude` + `GNUmakefile`
  cases.
- **F17 (major), retained, design (a):** BR-150 requires the entry script to
  compare the frozen snapshot's `scripts/`, `sonar-project.properties` and
  `package.json` with the pristine archive (`SONAR_PRISTINE_TAR`) before the
  analysis service starts; AC-19 added; T2 residual rewritten. Design (b)
  (rebuild the snapshot code after coverage and mount it read-only) was
  rejected as a larger change to `scripts/sonar-snapshot.ts` and compose with
  no added protection.
- **F18 (minor), retained:** BR-015 v2 enumerates the four admitted non-Make
  steps, each equal to a constant in `tests/helpers/ci-policy.ts`; AC-09
  asserts equality and AC-18 executes the constants.
- **F19 (minor), retained:** AC-12 and AC-13(d) use the AGENTS.md §6
  records-synchronization PR and its merge; #50 closes only after both URLs
  are recorded.
- **F20 (minor), retained:** D9 and AC-15 reference the orchestrator's
  comment on #50 recording the narrowed acceptance line.
- **F21 (minor), retained:** BR-147 keeps `sonar.projectKey=kdrive-mcp-server`
  in the file; BR-148 overrides it by argument; P2 passes the PR key
  explicitly.
- **F22 (minor), retained:** BR-151 steps declare no `env`; AC-09 rejects an
  added `env` key.

### Round 3 — reviewed SHA `232e7ef`

Review: runs/50-spec-review-3.md (archived evidence `runs/50-spec-review-3.md`) (Fable),
verdict `changes`, 2 major, 4 minor. All findings retained as proposed by the
reviewer, per the orchestrator's decision.

- **F23 (major), retained:** BR-151 allows only an empty, non-symlink root
  `node_modules` mount point, excludes just that entry from `diff`, and fails
  on any nested `node_modules`; the "creates no file" sentence is corrected;
  AC-18 adds the empty, non-empty, symlink and `scripts/node_modules/x`
  cases.
- **F24 (major), retained:** BR-150 compares the whole snapshot, minus the
  enumerated generated entries, with the pristine archive and requires the
  analysed and configuration files to be present; AC-19 adds `src/x.ts`,
  `tsconfig.json` and related cases; T2, BR-012 v2 and BR-148 anchor the
  snapshot to the archive instead of `.git` state.
- **F25 (minor), retained:** one export rule for both jobs: `HEAD` must equal
  `GITHUB_SHA`, and the archive is taken from `$GITHUB_SHA`.
- **F26 (minor), retained:** the head repository appears only in step `if`
  expressions and step `env`; the validator models step `if` and asserts the
  exact conditions.
- **F27 (minor), retained:** BR-150 extracts into a `mktemp -d` directory
  outside the checkout, removed by the `cleanup` trap; AC-19 asserts no new
  checkout entry.
- **F28 (minor), retained:** AC-18 runs the constants with
  `bash -eo pipefail` in the dev image and names the required tool versions.

### Round 4 — reviewed SHA `8a8d6b5`

Review: runs/50-spec-review-4.md (archived evidence `runs/50-spec-review-4.md`) (Fable),
verdict `changes`, 2 major, 4 minor. All findings retained.

- **F29 (major), retained, option (a) per the orchestrator:** snapshot
  preparation runs in a `prep` service with the checkout read-only and only
  `artifacts/sonar-input` writable (plus the named volumes); the entry script
  passes `-f compose.yaml` explicitly and refuses `.env` and Compose override
  files at start and before the analysis service. BR-150, T2, AC-10 and AC-19
  updated. Implementability checked against the current layout: the Makefile
  recipes call only `scripts/sonar-entry.sh` (no Make 3.81 feature needed);
  the `prep` service reuses the dev image; the nested writable bind needs its
  host directory and the `node_modules` mount point to exist before the run,
  which the entry script creates (`mkdir -p artifacts/sonar-input`) after the
  BR-151 comparison and `make setup` respectively; `git ls-tree`, `git show`
  and `git status` work on a read-only repository; build and coverage write
  only inside the snapshot directory. The read-only mount is verified
  statically (AC-10), since tests have no Docker socket; its run-time effect
  is observed in the first CI analysis after enablement.
- **F30 (major), retained:** `SONAR_PRISTINE_TAR` added to the exact key
  lists of BR-015 v2 and BR-149.
- **F31 (minor), retained:** the BR-150 comparison is stated as
  bidirectional on the resolved snapshot directory; the presence list is a
  consequence; filtered tracked paths fail closed by design (noted in the
  rule).
- **F32 (minor), retained:** in CI the entry script binds the manifest
  `commit` to `GITHUB_SHA` and `runId` to the `current-<pid>` target; AC-19
  adds a rewritten-manifest case.
- **F33 (minor), retained:** T2 residual and BR-012 v2 state that coverage
  data is not tamper-evident and not gated on the PR project.
- **F34 (minor), retained:** BR-015 v2 admits four `run` texts and six step
  occurrences.

### Round 5 — reviewed SHA `83ebc2a`

Review: runs/50-spec-review-5.md (archived evidence `runs/50-spec-review-5.md`) (Fable),
verdict `changes`, 1 major, 3 minor. All findings retained as proposed.

- **F35 (major), retained:** BR-150 pins the exact `--exclude` patterns
  (`coverage`, `dist`, `analysis-snapshot.json`, `*.tsbuildinfo`,
  `node_modules`; the dead `coverage/` form is dropped), states that they are
  for root entries only and adds a `find -mindepth 2` check for nested
  occurrences; AC-19 adds `src/coverage/x.ts`, `tests/dist/x.test.ts` and
  `scripts/node_modules/x`.
- **F36 (minor), retained:** BR-149 and AC-14 say "only executed `run`
  step" (the checkout step still executes for forks, without credentials).
- **F37 (minor), retained:** the resolved `current-<pid>` target must be a
  directory physically under `artifacts/sonar-input`; AC-19 adds an outside
  target case.
- **F38 (minor), retained:** `prep` reuses the `dev` image (same `image:`,
  no own `build:`), so `make setup` builds it; AC-10 asserts it.

### Round 6 — reviewed SHA `a12d034`

Review: runs/50-spec-review-6.md (archived evidence `runs/50-spec-review-6.md`) (Fable),
verdict `approve`, 0 major, 4 minor. All minors retained as proposed.

- **F39 (minor), retained:** the Make target sets a fixed
  `SONAR_ANALYSIS_MODE` (`main`/`pr`) for the `analysis` service; the
  wrapper takes the project key from it only and fails when the manifest
  `event` disagrees (BR-150, T4, T2 residual, AC-08, AC-10).
- **F40 (minor), retained:** the root `node_modules` symlink must target
  exactly `/workspace/node_modules`; AC-19 adds the `coverage/nm` case.
- **F41 (minor), retained:** AC-14 says "no executed step references a
  secret".
- **F42 (minor), retained:** the BR-151 nested check covers `.git` entries
  below the root; AC-18 adds `scripts/.git/x`.

### Version 2 inputs — PR #52 code review round 1 (reviewed head `850c441`)

Review: runs/50-pr52-review-1.md (archived evidence `runs/50-pr52-review-1.md`) (Opus, effort
high), verdict `changes`, 2 major, 8 minor. Contract-level dispositions:

- **M1 (major), retained (orchestrator decision: fix, no residual):**
  BR-150 v2 (`.git` read-only in `dev` and `prep`), BR-151 v2 (save, compare
  and restore Git metadata; final `always()` step), T2 rewritten, D17, AC-20,
  AC-21, AC-09 v3 mutations.
- **m3 (minor), retained:** BR-144 v2 and D18; AC-02 case.
- **m4 (minor), retained:** BR-015 v3 rejects secret references in any form;
  AC-09 mutations.
- **m8 (minor), retained as erratum:** the AC-13(b) seed.
- M2, m1, m2, m5, m6 and m7 are implementation or record fixes under the v1
  contract text and need no spec change; they are handled in the
  implementation of this version.

### Version 2, round 1 — reviewed SHA `3fbee72`

Review: runs/50-spec-v2-review-1.md (archived evidence `runs/50-spec-v2-review-1.md`) (Opus,
effort high), verdict `approve`, 0 critical, 0 major, 9 minor. All minors are
applied in the freeze commit; the orchestrator froze v2 autonomously and this
text is reviewed within the PR #52 code review.

- **m1 (minor), retained with the owner's decision (2026-11-03):** on any
  Git-metadata mismatch the final step renames `.git` aside with
  `mv -T -- .git .git.quarantine` (never deletes it; fallback
  `$RUNNER_TEMP/git-quarantine` when that rename fails) and fails, so the
  checkout post step finds no repository. The in-place restore is removed.
  AC-21 adds the `.git/config` and `.git/hooks` symlink rows and the
  occupied-quarantine row; the "failing restore" row no longer applies.
- **m2 (minor), retained (extension):** the export, comparison and final step
  fail when `.git/commondir`, `.git/config.worktree` or `.git/modules`
  exists; the T2 residual now names the index, refs and objects as protected
  by the read-only mount alone.
- **m3 (minor), retained:** the final step invokes no `git`; AC-21 checks the
  constant.
- **m4 (minor), retained:** an entry absent at export must remain absent;
  AC-18 lists the tools the v2 constants use.
- **m5 (minor), retained:** the final step's condition is exactly `always()`
  in both jobs; it exits 0 on fork and disabled runs. AC-14 now admits that
  step beside the refusal (consistency fix found while applying m5).
- **m6 (minor), retained:** BR-150 v2 and AC-20 cover every service and every
  mount under `/workspace/.git`; a runtime write check is recorded in the
  runs evidence; D17 records the no-`.git` consequence.
- **m7 (minor), retained:** BR-015 v3 matches `secrets` case-insensitively
  over every parsed key and string value; AC-09 adds the upper-case and
  `secrets`-key mutations.
- **m8 (minor), retained:** BR-144 v2 defines inline configuration comments
  by ESLint's directive grammar; AC-02 adds the newline form.
- **m9 (minor), retained:** the BR-144, BR-150, BR-151 and BR-015 records
  get v2/v3 examples, verification lines, rationale and index alignment in
  the implementation commits of PR #52.

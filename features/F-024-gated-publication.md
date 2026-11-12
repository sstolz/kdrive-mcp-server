---
id: F-024
title: Scoped package name and gated beta publication
ticket: "#2"
status: draft
version: 2
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-12.
Base: branch `claude/beautiful-maxwell-8mdk2w`, tree identical to `main`
`5e5a7db`. IDs: F-024, BR-353–BR-375, BR-378, BR-379, BR-016 v3, BR-178
v3; no ADR. BR-376 and BR-377 are withdrawn in v2 (never accepted, IDs never
reused); BR-321 stays at v1. BR-291 and BR-305–BR-311 are reserved and not
used. `#2` is this repository's ticket. The owner answered OQ-1 and OQ-2 on
2026-11-12; the answers are integrated as P-0, D-13 and residual risk (f)
(v2, see `## Version history`).

Version 2 author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-12,
base branch `claude/beautiful-maxwell-8mdk2w` at `ad50865`. It allocates no
new F or BR ID. Frozen v1 (`0624a1b`) is kept in
[history](history/F-024-v1.md).

## Version history

- **v2 (2026-11-12, draft).** Reason: implementing v1 hit the D-14 stop
  condition. A packed tarball shipping `npm-shrinkwrap.json`, installed with
  `npm install --global --prefix <tmp> ./…tgz` under npm 11.20.0, still
  resolved `zod@3.25.76` under `@jimp/types@1.6.1` and
  `@jimp/plugin-resize@1.6.1`, exactly as without a shrinkwrap; with the
  current `package.json` `files` list npm did not pack the shrinkwrap at
  all; `@jimp/*` 1.6.1 is the latest release and still depends on
  `zod ^3.23.8`. The owner chose option A on 2026-11-12 (V2-1). Changes: the
  production shrinkwrap is dropped (Context T8, Scope item 6, D-14); BR-376
  and BR-377 are withdrawn (never accepted, IDs never reused); BR-321 v2 is
  dropped and BR-321 stays at v1; AC-17–AC-20, which verified only the
  shrinkwrap and BR-321 v2, are withdrawn; residual risk (e), which applied
  only to the shipped shrinkwrap, is withdrawn; new residual risk (f)
  accepts the nested Zod 3 advisory for npm installs during the beta, fixed
  before 1.0 in #12. Everything else is unchanged from v1.
- **v1 (2026-11-12, frozen at `0624a1b`).** Kept in
  [history](history/F-024-v1.md).

## Context

Nothing has been published yet. The owner decided on 2026-11-12
([docs/publishing.md](../docs/publishing.md), #2 comment
`2-progress-1-orchestrator`):

1. the npm package is renamed `@sstolz/kdrive-mcp-server`; the command and
   the MCP server-info name stay `kdrive-mcp-server`;
2. the public beta starts at `0.6.0-beta.1`: an npm package published with
   `--tag beta --access public`, and a GHCR image
   `ghcr.io/sstolz/kdrive-mcp-server:<version>` for `linux/amd64` and
   `linux/arm64`, never tagged `latest` for a pre-release;
3. nothing is published without the owner's explicit go for that version and
   that commit (AGENTS.md §7); a build or a tag alone never publishes.

Today the repository forbids publication outright: BR-178 v2 rejects any push,
login or `ghcr.io` marker in Dockerfiles, the Makefile, scripts and
workflows, and `ci.yml` is read-only (BR-015 v7). BR-016 v1 (kept by v2)
fixes the package name `kdrive-mcp-server`.

Users affected: the owner (gives the go by approving a deployment, sets up
the npm and GitHub preconditions); maintainers and agents (prepare releases,
read the release logs); end users (install `@sstolz/kdrive-mcp-server@beta`
or pull the image). The MCP server's runtime behaviour is unchanged.

### Threat model

- T1 publication without a go: a tag push, a merge, a CI run or a dispatch
  publishes by itself. Covered by a dispatch-only workflow whose two
  publishing jobs each need the `release` environment's required reviewer
  (BR-355, BR-356). Because a missing or weakened protection rule would let
  those jobs run unapproved, `release-check` reads the environment's
  protection rules and branch policies through the GitHub API in every phase
  and fails closed unless a required reviewer and exactly the `main` branch
  policy are configured (BR-378).
- T2 wrong artifact: the published bytes do not come from the commit, version
  and tag the owner approved, or from a commit that never passed CI on `main`
  (BR-359–BR-363, re-checked inside each approved job, D-7), or the
  workflow and scripts that run do not come from the released commit. Every
  job checks out `${{ github.sha }}`, the `main` HEAD the run was dispatched
  on and the commit the workflow file comes from, never `inputs.sha`
  (BR-357); that trusted, checked-out code then asserts `RELEASE_SHA` equals
  `GITHUB_SHA` (BR-361, D-10). The input commit is therefore only compared,
  never executed, so the check is not decided by the code it checks.
- T3 untrusted code reaching publish credentials: fork and PR events, a
  dependency's install script, or a step that receives a token it does not
  need (BR-356, BR-358, D-4). Dependencies are installed with
  `--ignore-scripts` (BR-375, D-5), and the OIDC request token exists only in
  `publish-npm`, which runs no binfmt, release-image build or dependency
  install; its only build is the implicit, pinned `Dockerfile.dev` build
  that `docker compose run` performs on a fresh runner (BR-356, D-5).
- T4 long-lived credential theft: an npm token stored in GitHub. Avoided by
  npm trusted publishing (OIDC) and the short-lived `GITHUB_TOKEN` (D-3).
- T5 same-repository writer: an account with write access can dispatch a
  modified `release.yml` from another branch. That run's `GITHUB_SHA` is the
  other branch's HEAD, so the unmodified workflow's `main` guard (BR-356)
  skips it, and a modified copy without the guard still meets the `release`
  environment, which only admits `main` (precondition P-2, checked on `main`
  runs by BR-378), and the npm trusted publisher, which names the workflow
  file and the environment (P-1); such a run reaches neither the approval
  nor npm. It can still get `packages: write` through `GITHUB_TOKEN`, and a
  writer can push a `v*` tag unless the P-5 tag ruleset blocks it. Residual
  risk accepted, the same trust level as F-023 T5: same-repository writers
  are trusted, and every workflow change gets the mandatory independent
  review (see also `## Residual risks` (a)).
- T6 partial publication: one registry accepts and the other fails. npm
  versions cannot be reused, so the reversible push (GHCR) goes first and npm
  goes last (BR-371, D-8); a read-back failure after the npm publish is
  recovered by re-running only the `read-back` job (D-8).
- T7 endpoint substitution: the test-double endpoint overrides redirect a
  real run. Refused in CI (BR-367).
- T8 unaudited registry install: `overrides` apply only in the root project,
  so `npm install -g` of the published package resolves Jimp's nested Zod 3
  and its high advisory again. Not covered by F-024 v2: accepted for the
  beta as residual risk (f) and fixed before 1.0 (#12). The container image
  is built from the lockfile with the root overrides and is not affected.

## Scope

1. Rename: `package.json`, `package-lock.json`, the packed tarball name, and
   the README, SPEC.md and docs/publishing.md references.
2. `.github/workflows/release.yml`: dispatch-only, jobs `verify`,
   `publish-image`, `publish-npm` and `read-back`, with the two publish jobs
   in the `release` environment.
3. `scripts/release.ts` (Node built-ins only: input and commit checks, CI
   evidence, registry checks, npm publish, read-back) and
   `scripts/release-image.sh` (multi-platform build and push), with Make
   targets `release-check`, `release-setup`, `release-npm`, `release-image`
   and `release-verify`.
4. A policy validator for `release.yml` (`tests/helpers/release-policy.ts`,
   `tests/release-policy.test.ts`), script tests against test doubles
   (`tests/release.test.ts`), and BR-178 v3 in
   `tests/helpers/image-policy.ts` and `tests/image-policy.test.ts`.
5. docs/publishing.md: a "Release workflow" section with the procedure, the
   owner preconditions and partial-failure recovery.
6. Audited install resolution (OQ-2): not in F-024 v2. The BACKLOG.md entry
   of 2026-11-11 (nested `zod` 3 on npm and tarball installs) stays open,
   accepted for the beta as residual risk (f); the fix (replace Jimp, or
   bundle dependencies) is the 1.0 follow-up ticket #12. SECURITY.md's
   `## Dependency audit` section stays as BR-321 v1 requires.
7. The BR files (new and versioned), `business-rules/README.md`,
   `docs/spec-index.md`, `capability-map.md` and a CHANGELOG Unreleased line,
   all pending acceptance.

### Out of scope

- The real release of `0.6.0-beta.1` itself: version bump, CHANGELOG
  promotion, tag creation and the publishing dispatch. That is a later release
  step under its own owner go.
- The real-client smoke test of the published package and image.
- Stable releases: F-024 v1 refuses a stable version (BR-358). A later spec
  version adds the stable mapping (D-9) without changing the beta path.
- A GitHub Release object, release notes or a tag-triggered workflow.
- The Sonar CI speed-up.
- Any change to `ci.yml` or `runner-acceptance.yml` (BR-374).
- Automating the owner preconditions P-0–P-5, including the hand publication
  and deprecation of the placeholder version (P-0).
- Bundling dependencies into the tarball (`bundleDependencies`) or vendoring
  Jimp; `package.json` `files` and `overrides` stay unchanged.

### Owner preconditions (not automated)

Order, as listed below: P-0, P-1, P-4, P-2 and P-5 before the first
non-dry-run dispatch; P-3 during or after the first non-dry-run run, once
its image is pushed (it cannot precede the first push, which creates the
GHCR package).

- **P-0** Before the first real release, the owner publishes once, by hand
  from their own machine with npm 11.5.1 or later, the placeholder
  `@sstolz/kdrive-mcp-server@0.0.0-placeholder.0`: no code, only a
  `package.json` (`name` `@sstolz/kdrive-mcp-server`, `version`
  `0.0.0-placeholder.0`, the BR-016 v3 `repository`, no `bin`, no
  `scripts`) and a README that says it is a placeholder and points to the
  repository, in an otherwise empty directory. From that directory, exactly:

  ```sh
  npm login
  npm publish --access public --tag latest
  npm deprecate @sstolz/kdrive-mcp-server@0.0.0-placeholder.0 "Placeholder, not a release. Install @sstolz/kdrive-mcp-server@beta."
  npm view @sstolz/kdrive-mcp-server dist-tags.latest
  npm logout
  ```

  `--tag latest` is explicit because npm 11 refuses to publish a pre-release
  version without `--tag`, and `latest` must exist for BR-363 and BR-372; the
  `npm view` command must print `0.0.0-placeholder.0`. `npm logout` revokes
  the session token on the owner's machine; no npm token is ever stored in
  GitHub. `latest` points at the deprecated placeholder until a stable
  release moves it (D-9, D-13).
- **P-1** After P-0, the npm account that publishes owns the `@sstolz` scope
  and has a trusted publisher for `@sstolz/kdrive-mcp-server`: provider
  GitHub Actions, repository `sstolz/kdrive-mcp-server`, workflow file
  `release.yml`, environment `release`. Once the trusted publisher is
  configured, the owner sets the package's publishing access to "Require
  two-factor authentication and disallow tokens", which trusted publishing
  still satisfies. `0.6.0-beta.1` and every later version are published only
  by the workflow through OIDC (D-3).
- **P-4** The repository is public before P-2 and before the first
  non-dry-run dispatch: environment protection rules (required reviewers,
  deployment branch policies) are only available on public repositories for
  this account's plan, and npm provenance needs a public source repository
  (BR-372, D-10).
- **P-2** The repository environment `release` exists with a
  `required_reviewers` protection rule naming the owner, a custom deployment
  branch policy that is exactly the branch `main` (not "protected branches",
  no other branch or tag pattern), and no environment secret or variable.
  "Prevent self-review" stays off: the single maintainer both dispatches and
  approves. `release-check` verifies the reviewer rule and the branch policy
  in every phase (BR-378).
- **P-5** A repository ruleset on `main` already exists. The owner adds a tag
  ruleset on `refs/tags/v*` that restricts creation, update and deletion to
  the owner (bypass list: the owner only), or at least blocks update and
  deletion, so that the release tag BR-361 checks cannot be moved. Agents
  never dispatch `release.yml` with `dry_run=false` and never approve a
  `release` deployment; the owner does both (AGENTS.md §7).
- **P-3** The first non-dry-run run creates the GHCR package
  `kdrive-mcp-server`, private by default. The owner then sets it to public,
  either between the `publish-image` push and the `publish-npm` approval or
  after the run, and keeps this repository's Actions write access to it.
  Until then anonymous pulls fail and `read-back` fails its `image is
  public (P-3)` check (BR-373); after setting it public, the owner re-runs
  only the failed `read-back` job, which verifies the visibility.

## Business rules

### Package name

- **BR-353** — `package-lock.json` has top-level `name` and `packages[""].name`
  both exactly `@sstolz/kdrive-mcp-server`, and `make pack` writes exactly one
  tarball, `artifacts/sstolz-kdrive-mcp-server-<package.json version>.tgz`.
  Verified by: AC-01.
- **BR-354** — README.md names the packed tarball only as
  `./artifacts/sstolz-kdrive-mcp-server-<version>.tgz` (at the current
  version, with the leading `./`, without which npm reads the argument as a
  GitHub shorthand) and contains `npm install -g @sstolz/kdrive-mcp-server@beta`; no tracked file
  outside `features/`, `business-rules/` and CHANGELOG.md contains
  `artifacts/kdrive-mcp-server-`; SPEC.md's `npx` lines read
  `npx @sstolz/kdrive-mcp-server`; docs/publishing.md no longer has the
  "Pending change" paragraph, its Names table marks the npm name as in use,
  its Versions section states that `latest` points at the deprecated
  placeholder `0.0.0-placeholder.0` until 1.0.0 and that users install
  `@beta` or an exact version, and it no longer says that `latest` points to
  the first beta; its "Release workflow" section lists the preconditions in
  the order P-0, P-1, P-4, P-2, P-5, P-3, gives the P-0 commands of this
  spec verbatim (ending with `npm logout`), states that P-3 is done after
  the first image push and verified by `read-back`, states that the release
  is dispatched from `main` while the release commit is `main`'s HEAD (else
  BR-361 refuses it because `GITHUB_SHA` differs), and states that a green
  real `dry_run=true` dispatch of the same version and commit is required,
  and its run link recorded, before any `dry_run=false` dispatch. It states
  the recovery of D-8:
  - when npm published but `read-back` failed, re-run only the failed
    `read-back` job or verify by hand with
    `npm view @sstolz/kdrive-mcp-server@<version>` and
    `docker buildx imagetools inspect ghcr.io/sstolz/kdrive-mcp-server:<version>`;
    a new dispatch of that version is refused by BR-363, as intended;
  - when `npm publish` reports a failure, first check with `npm view`
    whether the registry accepted it anyway; if it did, verify the published
    version by hand with the read-back commands, and `read-back`, skipped
    because its `needs` failed, is not re-run;
  - when the image is pushed but npm is not published (the second approval
    is rejected, `release-check` fails in `publish-npm`, or `npm publish`
    reports a failure and `npm view` does not find the version), re-run the
    `publish-npm` job (its `release-check` in phase `npm` expects the pushed
    image), or delete the GHCR version and dispatch again;
  - when the second approval expires (GitHub cancels a run waiting 30 days
    and allows no re-run after 30 days), delete the GHCR version and
    dispatch again while the release commit is `main`'s HEAD, otherwise
    release the next beta;
  - when the image push reports a failure and GHCR does not have the
    version, re-run the failed `publish-image` job or dispatch again;
  - when the image push reports a failure but GHCR has the version,
    `publish-npm` never ran and npm is unpublished: the owner deletes the
    GHCR version and dispatches again, or releases the next beta;
  - deleting the GHCR version and dispatching again works only while the
    release commit is still `main`'s HEAD (BR-361); otherwise the next beta
    is released.

  Verified by: AC-02, AC-22.

### Release workflow

- **BR-355** — `.github/workflows/release.yml` has `name: Release`,
  `run-name` exactly
  `Release ${{ inputs.version }} @ ${{ inputs.sha }} dry_run=${{ inputs.dry_run }}`
  (so the approval page shows what the owner approves; it is display text
  only, and since every `run` is a bare `make <target>` and step `env` holds
  only the BR-358 values, it reaches no shell), `on` exactly
  `workflow_dispatch` with exactly three inputs: `version` (type `string`,
  required), `sha` (type `string`, required) and `dry_run` (type `boolean`,
  required `false`, default `true`). Top-level `permissions` is `{}`,
  top-level `concurrency` is exactly
  `{group: release, cancel-in-progress: false}`, top-level `env` is exactly
  `{DEV_UID: "1001", DEV_GID: "1001"}` (the hosted runner's uid and gid, as
  in `.github/workflows/ci.yml`, so the `dev` container writes files the
  runner user owns), and the job set is exactly `verify`, `publish-image`,
  `publish-npm` and `read-back`. Verified by: AC-03, AC-04.
- **BR-356** — Every job has `runs-on: ubuntu-24.04` and `timeout-minutes:
  60`. `verify` has the `if` exactly
  `github.repository == 'sstolz/kdrive-mcp-server' && github.ref == 'refs/heads/main'`,
  `permissions` exactly `{contents: read, actions: read, packages: read}`, no
  `needs`, no `environment`, and `outputs` exactly
  `{tarball-sha256: ${{ steps.release-npm.outputs.tarball-sha256 }}}`. The
  other three jobs have the `if` exactly the `verify` condition followed by
  ` && inputs.dry_run == false`, and:
  - `publish-image`: `needs: [verify]`, `environment: release`,
    `permissions` exactly `{contents: read, actions: read, packages: write}`;
  - `publish-npm`: `needs: [verify, publish-image]`, `environment: release`,
    `permissions` exactly
    `{contents: read, actions: read, packages: read, id-token: write}`;
  - `read-back`: `needs: [verify, publish-npm]` (`verify` so that its
    `tarball-sha256` output is readable, BR-379), no `environment`,
    `permissions` exactly `{contents: read, packages: read}`.

  Only `publish-image` has `packages: write` and only `publish-npm` has
  `id-token: write`. Verified by: AC-03, AC-04.
- **BR-357** — The steps of each job are exactly, in order:
  - `verify`: checkout; `make release-check`; `make release-setup`;
    `make pack`; `make release-npm` with `id: release-npm`;
    `make image-binfmt`; `make release-image`; upload of
    `artifacts/sstolz-kdrive-mcp-server-*.tgz` as artifact `npm-tarball`;
  - `publish-image`: checkout; `make release-check`; `make image-binfmt`;
    `make release-image`;
  - `publish-npm`: checkout; `make release-check`; download of artifact
    `npm-tarball` into `artifacts/`; `make release-npm`;
  - `read-back`: checkout; `make release-verify`.

  Every checkout uses `ref: ${{ github.sha }}` (the `main` HEAD the run was
  dispatched on, whose workflow file is the one running), `fetch-depth: 0`
  and `persist-credentials: false`; no step checks out or executes
  `inputs.sha`, which only BR-360 and BR-361, run from that checkout,
  compare. Verified by: AC-03, AC-04.
- **BR-358** — Step inputs and credentials in `release.yml`. The release
  policy validator is closed-set: any key not listed here or in BR-355–BR-357
  is rejected, at every level.
  - Top-level keys are exactly `name`, `run-name`, `on`, `permissions`,
    `concurrency`, `env` and `jobs`. Job keys are only `if`, `runs-on`,
    `timeout-minutes`, `permissions`, `needs`, `environment`, `outputs` and
    `steps`, each only where BR-356 lists it; so `continue-on-error`, job
    `env`, `container`, `services`, `strategy` and `defaults` are rejected.
  - Step keys are only `name` (a literal without `${{`), `id` (only
    `release-npm` on `verify`'s `make release-npm`), `uses`, `with`, `run`
    and `env`; no step has `if`, `continue-on-error`, `shell`,
    `working-directory` or `timeout-minutes`.
  - `with` has exactly the keys `ref` (`${{ github.sha }}`), `fetch-depth`
    (`0`) and `persist-credentials` (`false`) on checkout; exactly `name`
    (`npm-tarball`), `path` (`artifacts/sstolz-kdrive-mcp-server-*.tgz`) and
    `if-no-files-found` (`error`) on upload; and exactly `name`
    (`npm-tarball`) and `path` (`artifacts`) on download (no `run-id`,
    `github-token`, `repository` or `pattern`, which would fetch another
    run's artifact); no `make` step has `with`.
  - `uses` admits only `actions/checkout`, `actions/upload-artifact` and
    `actions/download-artifact`, each pinned to a 40-hex commit SHA;
  - every `run` is exactly one `make <target>` with no `${{`;
  - each step's `env` key set is exactly the set given here, with no other
    variable (for example no `RELEASE_NPM_REGISTRY_URL` or other BR-367
    override): `make release-check`: `RELEASE_VERSION`, `RELEASE_SHA`,
    `RELEASE_DRY_RUN`, `RELEASE_PHASE`, `GITHUB_TOKEN`;
    `make release-npm` in `verify`: `RELEASE_VERSION`, `RELEASE_SHA`,
    `RELEASE_DRY_RUN`; `make release-npm` in `publish-npm`: those three and
    `RELEASE_TARBALL_SHA256`; `make image-binfmt`: `IMAGE_PLATFORMS`;
    `make release-image` in `verify`: `RELEASE_VERSION`, `RELEASE_SHA`,
    `RELEASE_DRY_RUN`, `IMAGE_PLATFORMS`; `make release-image` in
    `publish-image`: those four and `GITHUB_TOKEN`; `make release-verify`:
    `RELEASE_VERSION`, `RELEASE_SHA`, `RELEASE_DRY_RUN`, `GITHUB_TOKEN`,
    `RELEASE_TARBALL_SHA256`;
    checkout, `make release-setup`, `make pack`, upload and download: no
    `env`;
  - workflow inputs reach steps only as step `env` values
    `RELEASE_VERSION: ${{ inputs.version }}`, `RELEASE_SHA: ${{ inputs.sha }}`
    and `RELEASE_DRY_RUN`, whose value is `'true'` on the `make release-npm`
    and `make release-image` steps of `verify` and
    `${{ inputs.dry_run }}` everywhere else;
  - each `make release-check` step has `RELEASE_PHASE` set to the literal
    `verify`, `image` or `npm` in `verify`, `publish-image` and
    `publish-npm` respectively;
  - the `make release-npm` step of `publish-npm` and the
    `make release-verify` step of `read-back` have
    `RELEASE_TARBALL_SHA256: ${{ needs.verify.outputs.tarball-sha256 }}`,
    and no other step has that variable;
  - the only credential is `GITHUB_TOKEN: ${{ github.token }}`, present
    exactly in the env of every `make release-check` step, of
    `make release-image` in `publish-image` and of `make release-verify`; no
    `make release-setup`, `make pack`, `make image-binfmt`, `make release-npm`,
    upload or download step has it;
  - the word `secrets` (BR-015 v3 matching) appears nowhere in the file;
  - `IMAGE_PLATFORMS` is exactly `linux/amd64 linux/arm64` on the
    `make image-binfmt` and `make release-image` steps.

  Verified by: AC-03, AC-04.

### Checks (`make release-check`)

- **BR-359** — Input validation runs first. `RELEASE_VERSION` must match the
  SemVer 2.0.0 reference regular expression in full, else
  `version is not a SemVer version`. A SemVer version that is not exactly
  `<major>.<minor>.<patch>-beta.<n>` (numeric parts without leading zeros, no
  build metadata) fails: a stable version with
  `stable releases are out of scope (F-024 v1)`, anything else with
  `unsupported pre-release`. `RELEASE_SHA` must be exactly 40 lowercase hex
  characters, else `sha is not a full commit id`. `RELEASE_DRY_RUN` must be
  exactly `true` or `false`, else `dry_run is not a boolean`. For
  `release-check`, `RELEASE_PHASE` must be exactly `verify`, `image` or
  `npm`, else `phase is not a release phase`. If any input
  fails, only the input lines and the summary print, no Git command or
  network request runs, and the exit status is 1. Every `scripts/release.ts`
  mode (`check`, `npm`, `verify`) and `scripts/release-image.sh` run this
  validation of `RELEASE_VERSION`, `RELEASE_SHA` and `RELEASE_DRY_RUN` first,
  before any of these values is interpolated into a path, ref, URL or
  argument and before any child process, `docker` or `npm` call (including
  `npm --version`) or request. Verified by: AC-05, AC-10, AC-11, AC-12.
- **BR-360** — `RELEASE_SHA` names a commit in the clone and equals
  `git rev-parse HEAD`; at that commit, `VERSION` is exactly `<version>\n`,
  `package.json` has `name` `@sstolz/kdrive-mcp-server` and `version`
  `<version>`, and `package-lock.json` has top-level `version` `<version>`.
  Each mismatch is one failed check. Verified by: AC-06.
- **BR-361** — `refs/tags/v<version>` exists and `v<version>^{commit}` equals
  `RELEASE_SHA` (lightweight and annotated tags are both accepted), and
  `git merge-base --is-ancestor <sha> refs/remotes/origin/main` succeeds,
  and the environment variable `GITHUB_SHA` (passed by name, BR-375) is
  exactly equal to `RELEASE_SHA`, else the check fails with
  `sha is not the dispatched commit`; an unset `GITHUB_SHA` fails the same
  way. Provenance and the npm OIDC claim name `GITHUB_SHA`, and the workflow
  and scripts that run come from it, so the release commit must be `main`'s
  HEAD when the run is dispatched. A missing tag, a tag on another commit, a
  commit not on `main` and a `GITHUB_SHA` mismatch each fail their check.
  Verified by: AC-06, AC-16.
- **BR-362** — The GitHub REST API lists at least one run of workflow
  `ci.yml` in this repository with `head_sha` equal to `RELEASE_SHA`,
  `head_branch` `main` and `event` `push` or `workflow_dispatch`, whose job
  named `ci-result` has `conclusion` `success`. A PR run, a failed or skipped
  `ci-result`, a run on another commit, and any non-2xx API status fail the
  check (fail closed). Verified by: AC-07.
- **BR-363** — The version is not already published, and the npm
  placeholder is in place:
  - npm: `GET <registry>/@sstolz%2fkdrive-mcp-server` returning 404 passes
    only when `RELEASE_DRY_RUN` is `true`; 200 passes only if neither
    `versions` nor `time` has the key `<version>` (npm never reuses an
    unpublished version); only that exact key counts, so other versions (the
    P-0 placeholder, earlier betas), deprecations and `dist-tags` never fail
    this check; any other status fails;
  - npm placeholder, only when `RELEASE_DRY_RUN` is `false`: the same
    request must return 200 (else `npm placeholder missing (P-0)`), and
    `dist-tags.latest` must name a version other than `<version>` whose
    `versions[<latest>].deprecated` is a non-empty string (else
    `npm latest is not a deprecated placeholder (P-0)`);
  - GHCR: a pull token for `repository:sstolz/kdrive-mcp-server:pull`
    obtained with `GITHUB_TOKEN` (any status other than 200 fails with
    `unexpected GHCR token status <code>; refer to the owner`), then
    `HEAD /v2/sstolz/kdrive-mcp-server/manifests/<version>`. In phases
    `verify` and `image`, 404 passes and 200 fails as already published; in
    phase `npm`, 200 passes (the image `publish-image` pushed) and 404 fails
    with `image not pushed`. Any status other than 200 or 404 (for example
    401 or 403 for a package never pushed) fails with
    `unexpected GHCR status <code>; refer to the owner`: the run stops and
    the spec goes back to the owner, who decides the handling of that
    status in a new spec version.

  All these checks and BR-378 run in `release-check`, which every publishing
  job runs before its publish step, so nothing is published when one fails.
  Verified by: AC-08, AC-16.
- **BR-364** — The checks only read: Git commands that do not write refs or
  objects, and HTTP `GET` or `HEAD` requests (plus the GHCR token request).
  All checks after input validation run even when one fails. Verified by:
  AC-08, AC-13.
- **BR-378** — In every phase, `release-check` reads, with `GITHUB_TOKEN`,
  `GET /repos/sstolz/kdrive-mcp-server/environments/release` and
  `GET /repos/sstolz/kdrive-mcp-server/environments/release/deployment-branch-policies?per_page=100`.
  The check `release environment protected` passes only when both return 200,
  `protection_rules` holds an entry of type `required_reviewers` whose
  `reviewers` has at least one entry, `deployment_branch_policy` is exactly
  `{protected_branches: false, custom_branch_policies: true}`, and the policy
  list has `total_count` 1 and exactly one entry, with `name` `main` and
  `type` `branch`. A non-2xx status fails with
  `release environment unreadable <code>; refer to the owner` (fail closed:
  the run stops and the decision goes back to the owner); any other
  departure fails with `release environment not protected (P-2)`.
  `prevent_self_review` is not checked (P-2 keeps it off). BR-356 grants
  `actions: read` to `verify`, `publish-image` and `publish-npm`, the only
  jobs that run `release-check`, for these reads; any status other than 200
  fails closed. Verified by: AC-21, AC-13, AC-16.

### Output and safety of `scripts/release.ts`

- **BR-365** — `release-check` prints one stdout line per check,
  `release-check: <check> ok` or `release-check: <check> FAIL <reason>` with
  a fixed reason text, and the last line
  `release-check: <k> of <n> checks failed`; it exits 0 when `k` is 0, else
  1. No output of any `scripts/release.ts` mode contains a token, an
  `Authorization` value or a response body; an HTTP failure is reported by
  status code only. Verified by: AC-05–AC-09.
- **BR-366** — Any unexpected error in a `scripts/release.ts` mode is caught
  by one top-level handler that prints only `release: internal error` to
  stderr and exits 2; Git child processes run with stderr piped and
  discarded. Verified by: AC-09.
- **BR-367** — `scripts/release.ts` reads three endpoint overrides,
  `RELEASE_GITHUB_API_URL`, `RELEASE_NPM_REGISTRY_URL` and
  `RELEASE_GHCR_URL` (defaults `https://api.github.com`,
  `https://registry.npmjs.org` and `https://ghcr.io`), for test doubles only.
  When `GITHUB_ACTIONS` is `true` and any override is set, every mode prints
  only `release: endpoint override refused in CI` to stderr and exits 2
  before any request or command. Verified by: AC-09.

### Publication

- **BR-368** — For a version `<x.y.z>-beta.<n>`, the npm dist-tag is exactly
  `beta` and the only image reference pushed is exactly
  `ghcr.io/sstolz/kdrive-mcp-server:<version>`. No mode passes `--tag latest`
  to npm, runs `npm dist-tag` or pushes an image tag `latest`, so npm
  `latest` stays on the P-0 placeholder in F-024 v1. Verified by: AC-10,
  AC-11.
- **BR-369** — `release-npm` first runs the BR-359 input validation, then
  requires exactly one file
  `artifacts/sstolz-kdrive-mcp-server-<version>.tgz` whose
  `package/package.json` has `name` `@sstolz/kdrive-mcp-server` and `version`
  `<version>`, else it exits 1 with a fixed message and publishes nothing. It
  runs `npm --version` and exits 1 with `npm 11.5.1 or later required`
  unless the output is a version `>=11.5.1` (the first npm with trusted
  publishing). It prints `release-npm: tarball sha256 <hex>` (lowercase hex
  SHA-256 of the tarball bytes, `node:crypto`). When `RELEASE_DRY_RUN` is
  `false`, it exits 1 before calling `npm publish`:
  - with `tarball digest does not match verify` unless
    `RELEASE_TARBALL_SHA256` is exactly 64 lowercase hex characters equal
    to that digest;
  - with `OIDC environment missing` unless `ACTIONS_ID_TOKEN_REQUEST_URL`
    and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are set;
  - with `npm token in environment refused` if any environment variable is
    present whose name, compared case-insensitively, is `NODE_AUTH_TOKEN`,
    `NPM_TOKEN`, `NPM_ID_TOKEN`, `NPM_CONFIG__AUTH`, `NPM_CONFIG__AUTHTOKEN`,
    `NPM_CONFIG__PASSWORD`, `NPM_CONFIG_USERNAME`, `NPM_CONFIG_USERCONFIG`
    or `NPM_CONFIG_GLOBALCONFIG`, or starts with `NPM_CONFIG_//` (per-registry
    keys such as `npm_config_//registry.npmjs.org/:_authToken`); the check
    reads the process environment, whatever was passed to the container.

  It also exits 1 with `publishConfig refused`, in both dry-run modes and
  before calling `npm publish`, when the tarball's `package/package.json` has
  a `publishConfig` key (it could redirect the registry, tag or access). It
  then runs exactly
  `npm publish ./artifacts/sstolz-kdrive-mcp-server-<version>.tgz --tag beta --access public --ignore-scripts --provenance`,
  with `--dry-run` appended when `RELEASE_DRY_RUN` is `true`, so no
  lifecycle script of the package runs at publish. The leading `./` is
  required: npm 11.20.0 parses `artifacts/<name>.tgz` as the GitHub
  shorthand `github:artifacts/<name>.tgz`, and only a path starting with
  `./` is a `file` spec. `--provenance` makes npm fail before publishing
  when it cannot generate provenance, instead of publishing without it
  (D-3, D-10). The tarball is
  built in `verify` from a dependency tree installed with
  `npm ci --ignore-scripts` (`make release-setup`, BR-375), as the
  Dockerfile does. Verified by: AC-10, AC-13, AC-23.
- **BR-370** — `release-image` (`scripts/release-image.sh`, host Docker)
  builds target `runtime` of `Dockerfile` for
  `--platform linux/amd64,linux/arm64` with a `docker-container` Buildx
  builder whose BuildKit image is pinned by digest, with no `--build-arg`,
  no secret mount, and no `--cache-from` or `--cache-to` (a shared cache
  could feed layers from an unapproved build into the release image). With `RELEASE_DRY_RUN=true` the command has no
  `--push`, `--load`, `--output` or `--tag`, and no login runs. With
  `RELEASE_DRY_RUN=false` it logs in to `ghcr.io` with `GITHUB_TOKEN` through
  `--password-stdin`, builds with `--push`, exactly one
  `--tag ghcr.io/sstolz/kdrive-mcp-server:<version>` and the labels
  `org.opencontainers.image.source=https://github.com/sstolz/kdrive-mcp-server`,
  `org.opencontainers.image.version=<version>` and
  `org.opencontainers.image.revision=<sha>`, and logs out on exit whatever the
  outcome. It runs the BR-359 input validation first, before any
  interpolation and before any `docker` command, and exits 1 without calling
  `docker` when an input fails. Verified by: AC-11.
- **BR-371** — `publish-npm` `needs` `publish-image` (BR-356), so
  `make release-npm` runs only after `make release-image` succeeded and a
  failed image push publishes nothing to npm. Verified by: AC-03, AC-04.

### Read-back (`make release-verify`)

- **BR-372** — `release-verify` first runs the BR-359 input validation (no
  request on failure), then reads the npm package document, retrying up
  to 20 times 15 seconds apart (about 5 minutes) until every condition holds
  or the attempts run out: `versions` has `<version>`; `dist-tags.beta`
  equals `<version>`; `dist-tags.latest` is present, differs from
  `<version>` and names a version whose `deprecated` is a non-empty string
  (with P-0 it names the placeholder, which BR-363 checked before the
  publish and BR-368 never moves); `versions[<version>].dist.attestations`
  exists (provenance). Verified by: AC-12.
- **BR-373** — `release-verify` reads the GHCR manifest of tag `<version>`
  with a pull token: it is an OCI image index or Docker manifest list whose
  entries, ignoring attestation entries (platform `unknown/unknown`), have
  exactly the platforms `linux/amd64` and `linux/arm64`; and tag `latest`
  returns 404 or a digest different from the digest of tag `<version>`. It
  prints the index digest of tag `<version>` as
  `release-verify: image digest sha256:<hex>`. The check
  `image is public (P-3)` requests a pull token for
  `repository:sstolz/kdrive-mcp-server:pull` without any credential and
  then `HEAD /v2/sstolz/kdrive-mcp-server/manifests/<version>` with it; it
  passes only when both return 200. It prints one line per condition like
  BR-365 and exits 0 only when all hold. Verified by: AC-12.
- **BR-379** — `release-verify` requires `RELEASE_TARBALL_SHA256`, passed by
  name like in `release-npm` (BR-358, BR-375), to be exactly 64 lowercase
  hex characters, else the check `npm tarball matches verify` fails with
  `verify digest missing` and no tarball is fetched. Once
  `versions[<version>]` is present (BR-372), it reads
  `versions[<version>].dist.tarball`, which must be a URL with the same
  origin as the npm registry endpoint (`https://registry.npmjs.org`, or the
  BR-367 test-double override) (else `npm tarball url refused`), fetches those bytes with
  a `GET`, and computes their lowercase hex SHA-256 with `node:crypto`. The
  check `npm tarball matches verify` passes only when the request returns
  200 and the digest equals `RELEASE_TARBALL_SHA256`; another digest fails
  with `npm tarball differs from verify`, and a non-200 status fails with
  its status code only (BR-365). The check is part of BR-372's retry loop.
  Verified by: AC-12, AC-13.

### Withdrawn in v2

- **BR-376** — withdrawn in v2; never accepted; the ID is never reused.
- **BR-377** — withdrawn in v2; never accepted; the ID is never reused.

### Make targets and script

- **BR-375** — `release-check`, `release-npm` and `release-verify` depend only on the
  container-config guard (not `_require-setup`) and each run exactly
  `$(COMPOSE) run --rm -T` with every environment variable passed by name
  (`-e NAME`, never `-e NAME=value`), then
  `dev node scripts/release.ts <check|npm|verify>`. The variables passed are
  exactly these lists, no more and no fewer (`GITHUB_ACTIONS` in all three,
  so that BR-367's refusal fires inside the container):
  - `release-check`: `GITHUB_ACTIONS`, `GITHUB_SHA`, `GITHUB_TOKEN`,
    `RELEASE_VERSION`, `RELEASE_SHA`, `RELEASE_DRY_RUN`, `RELEASE_PHASE`,
    `RELEASE_GITHUB_API_URL`, `RELEASE_NPM_REGISTRY_URL`,
    `RELEASE_GHCR_URL`;
  - `release-npm`: `GITHUB_ACTIONS`, `ACTIONS_ID_TOKEN_REQUEST_URL`,
    `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `GITHUB_EVENT_NAME`, `GITHUB_REF`,
    `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`,
    `GITHUB_REPOSITORY_OWNER_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_RUN_ID`,
    `GITHUB_SERVER_URL`, `GITHUB_SHA`, `GITHUB_WORKFLOW_REF`,
    `RUNNER_ENVIRONMENT` (what npm needs for trusted publishing and
    provenance), `RELEASE_VERSION`, `RELEASE_SHA`, `RELEASE_DRY_RUN`,
    `RELEASE_TARBALL_SHA256`;
  - `release-verify`: `GITHUB_ACTIONS`, `GITHUB_TOKEN`, `RELEASE_VERSION`,
    `RELEASE_SHA`, `RELEASE_DRY_RUN`, `RELEASE_TARBALL_SHA256`,
    `RELEASE_GITHUB_API_URL`, `RELEASE_NPM_REGISTRY_URL`,
    `RELEASE_GHCR_URL`;
  - `release-setup` passes no variable, and `release-image` runs on the host
    without a container, so it passes none.

  The three overrides are listed so the AC-13 rehearsal reaches its
  doubles; in CI they are unset and BR-367 refuses them if set. Each list is
  one named constant in `tests/release.test.ts`, compared exactly with the
  Makefile recipe. After that command exits 0, the
  `release-npm` recipe, only when `RELEASE_DRY_RUN` is `true` and
  `GITHUB_OUTPUT` is set, appends exactly one line
  `tarball-sha256=<hex>` to the host file `$GITHUB_OUTPUT`, with `<hex>` the
  first 64 characters of the host `sha256sum` of
  `artifacts/sstolz-kdrive-mcp-server-$RELEASE_VERSION.tgz` (the job output
  of BR-356). `release-setup` depends only on the container-config guard and
  runs exactly `$(COMPOSE) build dev` then
  `$(COMPOSE) run --rm -T dev npm ci --ignore-scripts`. `release-image` runs
  `/bin/sh scripts/release-image.sh`; none of the five is a prerequisite of
  another target; all five are in `.PHONY` and `make help`;
  `scripts/release.ts` imports only `node:` modules. Verified by: AC-13.

### Unchanged CI

- **BR-374** — `.github/workflows/ci.yml` and
  `.github/workflows/runner-acceptance.yml` are byte-identical to the base;
  BR-015 v7, BR-225 v3, BR-227 v3 and BR-229 v2 apply unchanged.
  Verified by: AC-15.

## Versioned rules

- **BR-016 v3** — v2 holds with these changes: the package name is
  `@sstolz/kdrive-mcp-server`; `bin` is exactly
  `{"kdrive-mcp-server": "dist/cli.js"}`, so the command stays
  `kdrive-mcp-server`; `--help` usage still starts `Usage: kdrive-mcp-server`,
  `--version` still prints the package version, the MCP server-info name
  stays `kdrive-mcp-server`, and the kDrive User-Agent product token stays
  `kdrive-mcp-server/<version>`; `repository` is exactly
  `{"type": "git", "url": "https://github.com/sstolz/kdrive-mcp-server.git"}`
  (npm rejects a provenance publish whose `repository.url` does not match
  the source repository). (v1, kept by v2: package name
  `kdrive-mcp-server`.) Verified by: AC-01.
- **BR-178 v3** — v2 holds with these changes. The marker list adds
  `npm publish`. Markers are admitted only here:
  - `scripts/release-image.sh`: `docker login` once, `--push` once and
    `ghcr.io` (login host, image reference);
  - `scripts/release.ts`: `npm publish` once and `ghcr.io` (default endpoint
    and image name);
  - the v2 exceptions in `ops/runner/`.

  `docker push`, `type=registry` and `push=true` are admitted nowhere;
  `.github/workflows/release.yml`, `ci.yml`, the Makefile and every other
  scanned file admit no marker. (v2: no marker admitted outside
  `ops/runner/`.) Verified by: AC-14.

BR-321 stays at v1 (the BR-321 v2 of F-024 v1 is withdrawn in v2).

## Acceptance criteria

- **AC-01** (BR-016 v3, BR-353) — Given the renamed package, When
  `make pack` runs and the packed CLI is executed, Then the only tarball is
  `artifacts/sstolz-kdrive-mcp-server-0.1.0.tgz`, its `package.json` has the
  scoped name, `bin` `kdrive-mcp-server` and `repository.url` exactly
  `https://github.com/sstolz/kdrive-mcp-server.git`, `--version` prints `0.1.0`, the
  lockfile names match, and the MCP server-info name and User-Agent stay
  `kdrive-mcp-server`. Verified by: `tests/package.test.ts`
  `BR-016 v3 packs the scoped package with the unchanged command`,
  `tests/package-version-wiring.test.ts` (unchanged), `BR-353 lockfile names`.
- **AC-02** (BR-354) — Given README.md, SPEC.md and docs/publishing.md, When
  the documentation test runs, Then the BR-354 strings are present
  (including the placeholder `latest` statement, P-0, P-1, P-4, P-2, P-5 and
  P-3 in that order with the P-0 commands ending in `npm logout`, the
  "release commit is `main`'s HEAD" statement, the required green real
  `dry_run=true` dispatch before any `dry_run=false` dispatch, the read-back
  recovery, the "check the registry first" recovery for npm, the "image
  pushed, npm not published" recovery naming a rejected second approval, a
  failed `release-check` in `publish-npm` and an unpublished
  failed `npm publish` (R5-1, widened by D2-6), the expired-approval
  recovery (R6-1), the "image push failed, GHCR
  lacks the version" recovery (R4-3), the "image in GHCR but npm never ran"
  recovery and the `main`-HEAD limit of a GHCR delete and re-dispatch, and
  the README tarball path with its leading `./`),
  `artifacts/kdrive-mcp-server-` appears in no tracked file outside the
  excluded records, and docs/publishing.md does not say that `latest`
  points to the first beta. Verified by: `tests/release-policy.test.ts`
  `BR-354 documentation uses the scoped name`.
- **AC-03** (BR-355–BR-358, BR-371) — Given the real `release.yml`, When the
  release policy validator runs, Then it passes. Verified by:
  `tests/release-policy.test.ts` `BR-355 accepts the real release workflow`.
- **AC-04** (BR-355–BR-358, BR-371) — Given fixtures mutated to: a `push`,
  `pull_request`, `pull_request_target` or `workflow_run` trigger;
  `dry_run` default `false`; top-level `permissions` not `{}`;
  `concurrency` missing, or with `cancel-in-progress: true`;
  `packages: write` or `id-token: write` on `verify`; `id-token: write` on
  `publish-image`, `read-back` or an added job; `packages: write` on
  `publish-npm`, `read-back` or an added job; `contents: write` on any job;
  `read-back` with an `environment` or without `verify` or `publish-npm` in
  `needs`; `RELEASE_TARBALL_SHA256` on a step other than `publish-npm`'s
  `make release-npm` and `read-back`'s `make release-verify`, or missing on
  `make release-verify`; a `RELEASE_PHASE` literal swapped between jobs;
  a publishing job without `make release-check`; `make release-check` placed
  after the publish step (`make release-image` in `publish-image`,
  `make release-npm` in `publish-npm`); an added `run` step
  (`make release-check` twice, or `make setup`) or an added `uses` step
  (a pinned `actions/checkout` a second time) in any job; a checkout with
  `fetch-depth` other than `0` (`1`, or missing); a `runs-on` other than
  `ubuntu-24.04` (`ubuntu-latest`, `self-hosted`) on any job;
  `publish-image` or `publish-npm` without `environment` or
  without `inputs.dry_run == false`; `publish-npm` without `publish-image`
  in `needs`; a job without the repository and `main` guard; a `secrets.`
  reference; a `run` with `${{ inputs.version }}`; `GITHUB_TOKEN` on
  `make release-setup`, `make pack`, `make image-binfmt`, `make release-npm`
  or the download step; a checkout with `persist-credentials: true` or a
  `ref` other than `${{ github.sha }}`; `make setup` in place of
  `make release-setup`; `verify` without the `tarball-sha256` output, or
  `publish-npm`'s `make release-npm` without `RELEASE_TARBALL_SHA256`;
  `IMAGE_PLATFORMS` other than `linux/amd64 linux/arm64` on
  `make image-binfmt` or `make release-image`; a `make release-check`
  without its literal `RELEASE_PHASE`; an unpinned or other action;
  `RELEASE_DRY_RUN` from the input on `verify`'s `make release-npm` or
  `make release-image`; a checkout `ref` of `${{ inputs.sha }}`; top-level
  `env` missing, with `DEV_UID` or `DEV_GID` other than `"1001"`, or with an
  extra key; `run-name` missing or other than the BR-355 text; an unlisted
  top-level key (`defaults`); `continue-on-error` on a job or a step; a
  step `if`; a job `env`, `container` or `services`; a step `shell`; an
  extra step env variable (`RELEASE_NPM_REGISTRY_URL` on `make release-check`,
  `GITHUB_TOKEN` on `make release-setup`); an extra `with` key on
  download-artifact (`run-id`, `github-token`) or checkout; When validated,
  Then each throws. Verified by:
  `tests/release-policy.test.ts` `BR-355 rejects release workflow mutation: %s`.
- **AC-05** (BR-359, BR-365) — Given the inputs `0.6.0`, `v0.6.0-beta.1`,
  `0.6.0-beta.01`, `0.6.0-rc.1`, `0.6.0-beta.1+build`, `0.6`, an empty
  version, a 39-hex or upper-case sha, `dry_run=yes`, and phase `deploy`, When
  `release-check` runs against doubles that record requests, Then each prints
  its fixed reason, the double records no request, no Git command runs, and
  the exit is 1; given `0.6.0-beta.1` and a valid sha, Then input validation
  passes. Verified by: `tests/release.test.ts` `BR-359 refuses input %s`.
- **AC-06** (BR-360, BR-361) — Given a temporary Git repository with `main`
  and a side branch, When `release-check` runs with: matching `VERSION`,
  `package.json`, lockfile and tag; `VERSION` `0.6.0-beta.2`; a
  `package.json` version mismatch; no tag; the tag on the parent commit; an
  annotated tag on the commit; a commit only on the side branch; `GITHUB_SHA`
  set to the parent commit; `GITHUB_SHA` unset; Then exactly the expected
  checks fail in each case (the last two with
  `sha is not the dispatched commit`) and the annotated tag passes.
  Verified by: `tests/release.test.ts` `BR-360 BR-361 commit checks: %s`.
- **AC-07** (BR-362) — Given a GitHub API double returning: a successful
  `push` run on `main` with `ci-result` success; only a `pull_request` run;
  `ci-result` `failure`; `ci-result` `skipped`; a run on another sha; status
  500; When checked, Then only the first passes. Verified by:
  `tests/release.test.ts` `BR-362 CI evidence: %s`.
- **AC-08** (BR-363, BR-364) — Given registry doubles returning, with dry
  run `true` and phase `verify`: npm 404; npm 200 without the version; npm
  200 with the version in `versions`; npm 200 with the version only in
  `time`; npm 200 with only the deprecated `0.0.0-placeholder.0` and
  `latest` on it; npm 503; GHCR manifest 404; 200; 401; 403; token 401;
  with dry run `false`: npm 404; the deprecated placeholder with `latest` on
  it; `latest` on a non-deprecated version; `dist-tags` without `latest`;
  with phase `npm`: GHCR manifest 200; 404; When checked, Then with dry run
  `true` the npm 404, "without" and placeholder cases and GHCR 404 pass;
  with dry run `false` only the placeholder case passes, the npm 404 failing
  with `npm placeholder missing (P-0)`; in phase `npm` only GHCR 200 passes;
  GHCR 401 and 403 fail with `unexpected GHCR status <code>; refer to the
  owner`; every other case fails; and the doubles saw only `GET`/`HEAD` and
  the token request. Verified by: `tests/release.test.ts`
  `BR-363 already published: %s`.
- **AC-09** (BR-365–BR-367) — Given a synthetic token `SYNTHETIC-RELEASE-TOKEN`
  and doubles that echo the `Authorization` header in their bodies and fail
  with 500, When every mode runs, Then no output contains the token or a body;
  given a Git failure forced by the test, Then stderr is exactly
  `release: internal error` and the exit is 2; given `GITHUB_ACTIONS=true`
  and `RELEASE_NPM_REGISTRY_URL` set, Then each mode prints only the override
  refusal, exits 2, and the doubles record no request. Verified by:
  `tests/release.test.ts` `BR-365 never prints credentials`,
  `BR-366 internal error`, `BR-367 refuses overrides in CI`.
- **AC-10** (BR-359, BR-368, BR-369) — Given a fake `npm` on `PATH` that records its
  argv and environment and answers `--version` with `11.5.1`, When
  `release-npm` runs with dry run `true`, Then it prints the tarball digest
  and the publish argv is exactly `publish ./artifacts/sstolz-kdrive-mcp-server-0.6.0-beta.1.tgz --tag beta --access public --ignore-scripts --provenance --dry-run`;
  with dry run `false`, the OIDC variables set and `RELEASE_TARBALL_SHA256`
  equal to the tarball digest, Then the same without `--dry-run`; given the
  exact-argv assertion applied to a mutated argv whose tarball argument
  lacks the leading `./` (`artifacts/sstolz-kdrive-mcp-server-0.6.0-beta.1.tgz`)
  or that lacks `--provenance`, Then the assertion throws; with
  `RELEASE_VERSION` `0.6.0`, `v0.6.0-beta.1` or `0.6.0-beta.1;id`, an
  upper-case `RELEASE_SHA` or `RELEASE_DRY_RUN=yes`, Then the BR-359 reason
  prints, the fake npm records no call at all (not even `--version`), and
  the exit is 1; with
  `RELEASE_TARBALL_SHA256` missing, upper-case, or the digest of another
  tarball; with each refused variable of BR-369 set, including
  `NPM_TOKEN`, `NPM_ID_TOKEN`, `node_auth_token` and
  `npm_config_//registry.npmjs.org/:_authToken`; without the OIDC
  variables; with the fake npm answering `11.5.0` or `10.9.2`; with a
  missing tarball, two tarballs, a tarball whose inner version differs, or a
  tarball whose `package.json` has `publishConfig` (dry run `true` and
  `false`, message `publishConfig refused`), Then `npm publish` is not called, the fixed message prints and the exit is
  1. Verified by: `tests/release.test.ts` `BR-369 npm publish: %s`.
- **AC-11** (BR-359, BR-368, BR-370) — Given a fake `docker` that records argv and
  stdin, When `release-image` runs dry, Then one `buildx build` has both
  platforms and target `runtime` and no `--push`, `--load`, `--output`,
  `--tag`, `--cache-from` or `--cache-to`, and no `login` call; when it runs
  for real, Then `login ghcr.io` reads the token from stdin (never argv), the
  build has `--push`, exactly one
  `--tag ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1` and the three labels,
  no `latest`, no `--cache-from` or `--cache-to`, and `logout ghcr.io`
  follows; given the fake build
  failing, Then `logout` still runs and the exit is non-zero; given
  `RELEASE_VERSION` `v0.6.0-beta.1` or `0.6.0-beta.1;id`, a 39-hex
  `RELEASE_SHA` or `RELEASE_DRY_RUN=yes`, dry and real, Then the BR-359
  reason prints, the fake `docker` records no call (no `login`, `buildx` or
  `logout`), and the exit is 1. Verified by:
  `tests/release.test.ts` `BR-370 image build: %s`.
- **AC-12** (BR-359, BR-372, BR-373, BR-379) — Given read-back doubles
  where: everything
  holds with the placeholder `0.0.0-placeholder.0` as the earlier version
  and `latest` on it, and the `dist.tarball` bytes hash to
  `RELEASE_TARBALL_SHA256`; the `dist.tarball` bytes hash to another digest;
  `dist.tarball` on another origin; the `dist.tarball` request returns 404;
  `RELEASE_TARBALL_SHA256` missing or upper-case; the version is the sole
  version and `latest` equals it
  (P-0 skipped); `beta` points elsewhere; `latest` moved to the new version
  with the placeholder present; `latest` is missing; `latest` names a
  non-deprecated version; attestations are missing; the index lacks `linux/arm64`; the index has an extra
  `linux/386`; image tag `latest` resolves to the new digest; the anonymous
  pull token request returns 401 (package still private, P-3); the
  anonymous manifest request returns 401 or 404; the version never appears
  within 20 attempts; the version appears only on the third attempt; When
  `release-verify` runs (retry delay shortened by the test double clock),
  Then only the first and last pass, the passing runs print the index digest,
  the tarball cases fail `npm tarball matches verify` with their BR-379
  reason (the other-origin case fetches nothing from that origin), and the
  anonymous requests carry no `Authorization` header; given `RELEASE_VERSION`
  `v0.6.0-beta.1`, a 39-hex `RELEASE_SHA` or `RELEASE_DRY_RUN=yes`, Then the
  BR-359 reason prints, the doubles record no request, and the exit is 1.
  Verified by: `tests/release.test.ts` `BR-372 BR-373 read-back: %s`,
  `BR-379 read-back tarball digest: %s`.
- **AC-13** (BR-357, BR-364, BR-369, BR-370, BR-375, BR-379) —
  Rehearsal (AGENTS.md §6). Given a temporary repository prepared as a
  `0.6.0-beta.1` release commit on `main` with its tag, `GITHUB_SHA` set to
  that commit and `GITHUB_OUTPUT` to a temporary file, doubles for the
  GitHub API (CI evidence, and the `release` environment and its
  deployment-branch-policies answering the P-2 configuration of BR-378), npm
  (deprecated placeholder on `latest`, version absent) and GHCR (version
  absent, anonymous pulls allowed after the push), and fake `npm` and
  `docker`, where the fake
  `docker` executes the inner command of every `compose run … dev <command>`
  on the host with only the `-e` variables passed by name (so
  `node scripts/release.ts` runs the real checks, and `npm` resolves to the
  fake, which answers `--version`, records `ci --ignore-scripts` and writes
  a prepared tarball for `pack`) and records `buildx`, `login` and `logout`
  itself; When the `verify`, `publish-image`, `publish-npm` and `read-back`
  sequences of BR-357 run in that order through the Make targets, with the
  BR-358 step environment (including `RELEASE_PHASE` and
  `RELEASE_TARBALL_SHA256` read from the `GITHUB_OUTPUT` file), with dry run
  `true` and then `false`, Then the dry run passes every check, calls
  `npm ci --ignore-scripts` and
  `npm publish ./artifacts/sstolz-kdrive-mcp-server-0.6.0-beta.1.tgz … --ignore-scripts --provenance --dry-run`,
  writes one
  `tarball-sha256=` line, and calls neither `login` nor `--push`; the real
  run calls the image push before `npm publish`, `publish-npm`'s
  `release-check` passes with the GHCR double now answering 200, every
  `release-check` read the two environment endpoints, and the read-back
  passes against doubles updated after the publish, whose `dist.tarball`
  serves the packed tarball and is compared with the digest read from the
  `GITHUB_OUTPUT` file; and the Makefile and
  import rules hold, the `-e` names of each of the three
  `scripts/release.ts` targets equalling exactly its BR-375 list. Verified by:
  `tests/release.test.ts` `F-024 rehearsal dry run then publish against doubles`,
  `BR-375 Makefile targets and imports`.
- **AC-14** (BR-178 v3) — Given the real publish scope, When
  `validateNoPublish` runs, Then it passes; given a marker added to
  `release.yml`, `ci.yml`, the Makefile or another script, a second
  `--push` or `docker login` in `release-image.sh`, `docker push` or
  `push=true` in `release-image.sh`, or `npm publish` outside
  `scripts/release.ts`, Then it throws. Verified by:
  `tests/image-policy.test.ts` `BR-178 v3 admits markers only in the release scripts`
  and `BR-178 v3 rejects %s`.
- **AC-15** (BR-374) — Given the feature branch, When compared with its base
  and the existing CI policy tests run, Then `ci.yml` and
  `runner-acceptance.yml` are unchanged and `tests/ci-policy.test.ts`
  passes unchanged. Verified by: `git diff --exit-code <base> -- .github/workflows/ci.yml .github/workflows/runner-acceptance.yml`
  in the PR body, and `make check`.
- **AC-16** (BR-355, BR-356, BR-359–BR-363, BR-365, BR-378) — Real wiring,
  after the merge, on actual `main`, with P-4, P-2 and P-5 in place and
  nothing published. Given
  three dispatches of `release.yml` from `main` with `dry_run=false`, made by
  the owner (P-5: agents never dispatch `dry_run=false`; the implementing
  agent only records the run links and results): (a)
  `version=0.1.0` and the `main` SHA; (b) `version=0.6.0-beta.1` and the
  `main` SHA; (c) `version=0.6.0-beta.1` and the parent of the `main` SHA;
  When they run, Then (a) fails input validation with the stable refusal;
  (b) fails `VERSION`, `package.json`, lockfile and tag checks while the
  `main`, `GITHUB_SHA`, CI-evidence, GHCR and BR-378 environment checks
  pass, and the npm
  checks pass if P-0 is done or fail only with
  `npm placeholder missing (P-0)` if it is not; (c) additionally fails with
  `sha is not the dispatched commit`; in all three, `publish-image`,
  `publish-npm` and `read-back` never start and no deployment approval is
  requested; and npm has no `0.6.0-beta.1` (404, or only the P-0
  placeholder). The status of the GHCR manifest request is recorded; if it
  is neither 200 nor 404 (for example 401 or 403 before the first push),
  the run shows `unexpected GHCR status <code>; refer to the owner` and the
  spec goes back to the owner (BR-363). The acceptance comment also records
  whether the job's `GITHUB_TOKEN` could read the two environment endpoints;
  if it could not, (b) fails closed with
  `release environment unreadable <code>; refer to the owner`, nothing runs
  past `verify`, and the decision goes back to the owner (a new spec
  version). Verified by: run links recorded in the #2 acceptance comment.

- **AC-17** — withdrawn in v2 (verified BR-376); never reused.
- **AC-18** — withdrawn in v2 (verified BR-377); never reused.
- **AC-19** — withdrawn in v2 (verified BR-377); never reused.
- **AC-20** — withdrawn in v2 (verified BR-321 v2); never reused.
- **AC-21** (BR-378) — Given a GitHub API double where: the environment has
  a `required_reviewers` rule with one reviewer and the policy list is
  exactly branch `main` (pass); no `required_reviewers` rule; the rule with
  an empty `reviewers`; `protected_branches: true`; a policy list `main` and
  `dev`; a single policy `main` of type `tag`; a single policy `main*`; the
  environment endpoint returning 404, 403 or 500; the policy endpoint
  returning 403; When `release-check` runs in each phase, Then only the first
  case passes, the non-2xx cases fail with
  `release environment unreadable <code>; refer to the owner`, the others
  with `release environment not protected (P-2)`, and the double saw only
  `GET`. Verified by: `tests/release.test.ts`
  `BR-378 release environment protection: %s`.
- **AC-22** (BR-354) — Release gate, checked at each release step (outside
  F-024 acceptance, starting with `0.6.0-beta.1`). Given a release commit on
  `main`'s HEAD with its tag, When the owner is asked for the go, Then the
  request links a green real dispatch of `release.yml` with `dry_run=true`,
  the same `version` and the same `sha`, whose `verify` job passed and whose
  other jobs were skipped, and no `dry_run=false` dispatch of that version
  precedes it. Verified by: the dry-run run link recorded in the #2 (or
  release ticket) go request, before the `dry_run=false` run link.
- **AC-23** (BR-369) — Real npm argv check, once, during implementation.
  Given the tarball `./artifacts/sstolz-kdrive-mcp-server-<version>.tgz`
  written by `make pack` at the current `package.json` version, When the pinned npm 11.20.0 of the `dev` container
  runs `docker compose run --rm -T -e GITHUB_ACTIONS=true dev npm publish ./artifacts/sstolz-kdrive-mcp-server-<version>.tgz --tag beta --access public --ignore-scripts --provenance --dry-run`
  (the exact BR-369 argv with `--dry-run`), Then it exits 0 and its output
  names `@sstolz/kdrive-mcp-server@<version>`; the record also states
  whether the dry run reached provenance generation (for example a
  provenance or OIDC message in its output). If it exits non-zero, names
  another package, or reaches provenance generation (the `verify` job's dry
  run has no `id-token: write`), implementation stops and the spec returns
  to the orchestrator. Verified by: the command, its exit status and its output
  recorded in the #2 implementation PR body.

## Decisions

- **D-1 Separate dispatch-only workflow with an environment approval.** The
  owner's approval of the `release` deployment, for a run whose inputs name
  the version and the full SHA, is the recorded go (AGENTS.md §7): GitHub
  keeps who approved, when, and for which run. The owner approves twice per
  run, once for `publish-image` and once for `publish-npm` (both target the
  `release` environment, D-5); the second approval comes after the image
  push, and rejecting it or letting it expire leaves only the GHCR version,
  recovered as in D-8 (after a rejection, re-run `publish-npm`; after an
  expiry, which cancels the run, delete the GHCR version and dispatch again
  while the release commit is `main`'s HEAD, otherwise release the next
  beta).
  Rejected: a tag-push trigger
  (a tag alone would publish, against §7); a job in `ci.yml` (mixes
  publication into the gate workflow, versions BR-015 and BR-225, and runs on
  every push); a manual publish from a workstation (no record, no check, a
  long-lived credential); a release bot or semantic-release (publishes on
  merge).
- **D-2 Unprivileged `verify` before the approved jobs.** `verify` runs
  every check, packs, runs `npm publish --dry-run` and builds both image
  platforms with no push, before any approval is requested; the owner
  approves after seeing it green. `dry_run` defaults to `true`, so a dispatch
  with defaults never reaches an approval. Rejected: one job (build tooling
  from `make release-setup` would share the job with write and OIDC
  permissions); a separate rehearsal workflow (duplicates the contract).
- **D-3 npm trusted publishing (OIDC) with provenance.** No npm token is
  stored; the short-lived credential is bound to this repository, workflow
  file and environment. BR-369 passes `--provenance` explicitly, so that npm
  fails before publishing when it cannot generate provenance instead of
  silently publishing without it, and refuses a token in the environment so
  the path cannot silently fall back.
  Rejected: an automation or granular token as a secret (long-lived,
  exfiltrable; the owner asked to prefer OIDC). The first publish of a new
  package is D-13.
- **D-4 GHCR through `GITHUB_TOKEN`, `packages: write` only on
  `publish-image`.** Rejected: a personal access token (long-lived,
  broader); `packages: write` on `verify` or `publish-npm` (no need). The
  token reaches only the steps that call GitHub or GHCR (`release-check`,
  `release-image` in `publish-image`, `release-verify`), never
  `make release-setup`, `make pack`, `make image-binfmt`, the download step
  or `make release-npm`.
- **D-5 Tarball built in `verify`, image pushed by `publish-image`, npm
  published by `publish-npm`.** The npm tarball needs the dependency tree,
  so it is built in `verify` without write permissions, from
  `npm ci --ignore-scripts` (`make release-setup`) as the Dockerfile does,
  so no dependency install script runs even there. It is passed as a run
  artifact; its SHA-256 travels separately as a `verify` job output, and
  `release-npm` refuses a tarball with another digest, besides re-checking
  its name and inner version. The image build runs untrusted package
  installs only inside BuildKit containers, which see no runner credential,
  and needs the privileged binfmt step, so it runs in `publish-image` with
  `packages: write` only. `publish-npm` holds `id-token: write` only and
  runs no binfmt, release-image build or dependency install (only the
  implicit, pinned `Dockerfile.dev` build of `docker compose run`), so the
  OIDC request token never reaches the privileged or release build steps; it `needs` `publish-image`, which
  keeps the image-first order (D-8). The cost is a second approval (D-1)
  and a `RELEASE_PHASE` input to `release-check`, since in `publish-npm`
  the image of this run already exists. Rejected: one publish job holding
  both permissions (the OIDC request token would sit in the environment of
  the binfmt and image steps); exporting the image as an OCI archive between
  jobs (more moving parts, a new push tool); re-packing in a publish job
  (dependencies would run next to the publish credentials); running the
  plain `make setup` (`npm ci` with install scripts) for the release
  tarball.
- **D-6 Checks in one Node script with test-double endpoints.** Input
  validation runs first and stops everything, since a malformed version or
  SHA must never reach a Git ref or a URL; later checks all run so one run
  shows every problem (AC-16 relies on it). Overrides exist only for doubles
  and are refused in CI (T7). Rejected: inline shell in the workflow
  (untestable, injection-prone); first-failure stop for every check.
- **D-7 Checks repeated inside each approved job.** The tag, `main`, CI
  evidence and registries can change between `verify` and each approval;
  `publish-image` and `publish-npm` each re-run `release-check` right before
  publishing. The workflow `concurrency` group serializes release runs.
- **D-8 Image before npm, read-back in its own job.** A GHCR version can be
  deleted by the owner; an npm version can never be reused. A failed
  publish may still have been accepted by the registry (a timeout or a lost
  response after the upload), so the owner first checks the registry. If
  `npm publish` failed but `npm view @sstolz/kdrive-mcp-server@<version>`
  finds it, the owner verifies it by hand with the read-back commands;
  `read-back` was skipped (its `needs` failed), not failed, and is not
  re-run, and re-running `publish-npm` would only fail its `release-check`.
  If the image push failed and GHCR does not have the version, the owner
  re-runs the failed `publish-image` job (its `release-check` in phase
  `image` expects a 404) or dispatches again. If the image was pushed but
  npm was not published (the second approval was rejected,
  `release-check` failed in `publish-npm`, or the npm step failed without
  publishing),
  the owner re-runs the `publish-npm` job (its `release-check` in
  phase `npm` expects the pushed image), or deletes the GHCR version and
  dispatches again. If the second approval expired, GitHub cancelled the
  run after 30 days and allows no re-run, so the owner deletes the GHCR
  version and dispatches again while the release commit is `main`'s HEAD,
  or releases the next beta. If the image push reported a failure but GHCR has the
  version, `publish-npm` never ran: re-running `publish-image` fails its
  `release-check` (200 in phase `image`), so the owner deletes the GHCR
  version and dispatches again, which BR-361 admits only while the release
  commit is still `main`'s HEAD, or releases the next beta. If npm published but
  `read-back` failed, the owner re-runs only the failed `read-back` job,
  which holds no publish permission, or verifies by hand with `npm view`
  and `docker buildx imagetools inspect`; a new dispatch of that version is
  refused by BR-363, which is intended, since that version is published. A
  `read-back` that fails only `image is public (P-3)` is re-run after the
  owner sets the package public. docs/publishing.md records this (BR-354). The read-back
  retries 20 times 15 seconds apart (about 5 minutes): the registry's
  package document and its attestations can lag the publish by minutes
  behind its cache, 10 tries (150 seconds) risks a false failure on a good
  release, and 5 minutes stays far inside the 60-minute job timeout.
  Rejected: automatic rollback (deleting packages needs broader rights and
  is a destructive action reserved to the owner); read-back as a step of
  `publish-npm` (re-running that job would re-run `release-check`, which
  fails once npm has the version).
- **D-9 Beta only in v1; stable refused.** The mapping is `beta` dist-tag
  and the version image tag. The later stable mapping is planned as the
  `latest` dist-tag and the image tags `<version>` and `latest`; adding it is
  a new spec version that extends BR-359 and BR-368 without touching the
  beta path; that stable publish is what moves `latest` off the P-0
  placeholder. Rejected: implementing stable now (no owner go for 1.0.0;
  untested path that could move `latest`).
- **D-10 Provenance required in the read-back.** It is the user-visible
  proof that the package came from this workflow. It needs a public
  repository, hence P-4, and a `repository.url` matching it (BR-016 v3).
  `npm publish` runs with `--provenance` (BR-369), so a publish that cannot
  generate provenance fails before upload rather than shipping a version
  that only the read-back would flag, and an npm version can never be
  reused. Provenance and the OIDC claim name `GITHUB_SHA`, the commit the workflow
  file comes from. Every job checks out that same commit
  (`ref: ${{ github.sha }}`, BR-357), so the scripts, Makefile and sources
  that run and are packed are those of `GITHUB_SHA`, and that trusted code
  requires `RELEASE_SHA` to equal `GITHUB_SHA` (BR-361); the release is
  therefore dispatched while the release commit is `main`'s HEAD.
  `inputs.sha` names what the owner approves (it is in `run-name`) and is
  only compared, never checked out. Rejected: optional provenance (a silent
  loss of provenance would go unnoticed); checking out `inputs.sha` (the
  equality check would then run from the very commit it checks, so a
  commit without the check would pass itself); trusting `inputs.sha` alone
  (the provenance could name a later `main` commit whose workflow differs
  from the released one).
- **D-11 `ci-result` on a `main` push or dispatch run as CI evidence.** On
  `push` and `workflow_dispatch` the `changes` job never skips a gate
  (BR-226), so a successful `ci-result` there means the full gate passed for
  that commit. Rejected: accepting the PR run (its merge ref is not the
  released commit); re-running the full gate in `release.yml` (duplicates
  CI, and Sonar secrets would enter the release workflow).
- **D-12 BR-178 versioned, not superseded.** Its purpose (no publication
  outside the release decision) is kept; v3 confines the markers to the two
  release scripts, which only the approved jobs run for real.
- **D-13 First publish through a hand-published placeholder (owner, OQ-1,
  2026-11-12).** npm configures a trusted publisher only on an existing
  package, so the owner publishes `0.0.0-placeholder.0` once by hand (P-0),
  deprecates it, then configures P-1; every real version goes through the
  workflow and OIDC, and no npm token ever lives in GitHub. Consequences:
  `latest` points at the deprecated placeholder until a stable release
  (BR-354, BR-368, BR-372), and BR-363 looks only at the exact version, so
  the placeholder never blocks a release. Rejected: a one-time granular
  token stored as a `release` environment secret (a token in GitHub, even
  briefly, and a v2 of BR-358 and BR-369 for a single run); `npm trust`
  before the package exists (not confirmed to work on a missing package, and
  it would still leave the first publish without a tested path); the owner
  publishing `0.6.0-beta.1` by hand from a `verify` tarball (the first real
  version would have no workflow provenance, against D-10).
- **D-14** — withdrawn in v2: the owner's decision of 2026-11-12 (V2-1)
  accepts the nested Zod 3 advisory for npm installs during the beta as
  residual risk (f) and fixes it before 1.0 (#12).

## Residual risks

Each entry gives the risk and its mitigation. The owner accepted (a)–(e) on
2026-11-12 (#2), (c) on the condition that the owner confirms the Claude
GitHub App holds no write permission on deployments, and (f) on 2026-11-12
with v2; (e) is withdrawn in v2.

- **(a)** GHCR tags are mutable and the image is unsigned: any writer, or
  any workflow on a pushed branch granted `packages: write`, can overwrite
  `ghcr.io/sstolz/kdrive-mcp-server:<version>` without an approval.
  Mitigation: `read-back` prints the index digest (BR-373), and
  docs/publishing.md tells users to pin the image by digest; image signing
  is deferred to 1.0 (#6). Owner acceptance: accepted 2026-11-12.
- **(b)** A compromised devDependency running in `verify` yields a tampered
  tarball whose digest and provenance are both valid. Mitigation: lockfile
  integrity, `npm ci --ignore-scripts` (BR-375), the dependency audit job,
  and review of every dependency update. Owner acceptance: accepted 2026-11-12.
- **(c)** The approval is only as strong as the owner's GitHub account.
  Mitigation: two-factor authentication on the account, and the P-5 rule
  that agents never dispatch a non-dry run or approve a deployment. Owner
  acceptance: accepted 2026-11-12, on the condition that the Claude GitHub
  App holds no deployment write permission. Condition checked by the owner
  on 2026-11-12: the App has read access to administration, commit
  statuses, merge queues and metadata, and read and write access to
  actions, checks, code, discussions, issues, pull requests, repository
  hooks and workflows; it has no deployments permission. With actions and
  workflows write it can dispatch workflows and change workflow files on a
  branch, which P-5 and risk (a) cover.
- **(d)** OIDC trusted publishing, provenance and the first GHCR push are
  exercised for real only by `0.6.0-beta.1`. Mitigation: the mandatory green
  real `dry_run=true` dispatch of the same version and commit (BR-354,
  AC-22) and the recovery of D-8. Owner acceptance: accepted 2026-11-12.
- **(e)** Withdrawn in v2: it applied only to package content withdrawn
  with D-14.
- **(f)** npm installs of the package (registry or packed tarball) resolve
  Jimp's nested `zod@3.25.76` and its high advisory, because `overrides`
  apply only in the root project. The container image is not affected: it
  is built from the lockfile with the root overrides applied. Mitigation:
  SECURITY.md already documents the limit (BR-321 v1); fixed before 1.0 in
  #12 (replace Jimp, or bundle dependencies). Owner acceptance: accepted
  2026-11-12.

## Open questions

## Stress-test

Review `2-spec-review-1-reviewer` (verdict `changes`, on `1c158ad`); every
finding retained.

- **R1-1** (major, retained) — BR-361 adds the check `GITHUB_SHA` (passed by
  name, BR-375) equals `RELEASE_SHA`, failing with
  `sha is not the dispatched commit`; AC-06 adds a mismatched and an unset
  `GITHUB_SHA`; AC-16 adds dispatch (c) on the parent commit; D-10 gives the
  reason; BR-354 makes docs/publishing.md state that the release is
  dispatched while the release commit is `main`'s HEAD.
- **R1-2** (major, retained) — New target `make release-setup`
  (`npm ci --ignore-scripts`, BR-375) replaces `make setup` in `verify`
  (BR-357); `verify` exports `tarball-sha256` as a job output (BR-356,
  written by the `release-npm` recipe, BR-375), passed to `publish-npm` as
  `RELEASE_TARBALL_SHA256` (BR-358); BR-369 refuses another digest; AC-04
  and AC-10 add the mutations; D-5 rewritten.
- **R1-3** (major, retained) — BR-363: with dry run `false`, npm must return
  200 and `dist-tags.latest` must name a deprecated version other than
  `<version>`, checked in `release-check` before any publish; BR-372 also
  requires `latest` deprecated; P-0 gives the exact commands, including
  `npm publish --access public --tag latest` and `npm deprecate`; AC-08 and
  AC-12 add the cases.
- **R1-4** (minor, retained) — AC-04 adds `persist-credentials: true`, a
  checkout `ref` other than `inputs.sha`, `concurrency` missing or with
  `cancel-in-progress: true`, `GITHUB_TOKEN` on `make pack`,
  `make image-binfmt` or the download step, wrong `IMAGE_PLATFORMS`, and
  `id-token: write` on any job other than `publish-npm` (an added job
  included).
- **R1-5** (minor, retained) — `publish` split into `publish-image`
  (`packages: write`) and `publish-npm` (`id-token: write`, `needs`
  `publish-image`), both in `release`, plus a `read-back` job (BR-355–BR-358,
  BR-371); `release-check` gains `RELEASE_PHASE` (BR-359, BR-363) because
  the image exists in phase `npm`; T3, D-1 (two approvals), D-2, D-4, D-5
  and D-7 updated.
- **R1-6** (minor, retained) — BR-369 lists the refused variables
  (case-insensitive exact names, plus the `NPM_CONFIG_//` prefix covering
  `npm_config_//registry.npmjs.org/:_authToken`) and refuses npm below
  11.5.1 with `npm 11.5.1 or later required`; AC-10 adds the cases.
- **R1-7** (minor, retained) — BR-016 v3 fixes `repository` with `url`
  exactly `https://github.com/sstolz/kdrive-mcp-server.git`; AC-01 tests it.
- **R1-8** (minor, retained) — BR-363: any GHCR status other than 200 or
  404 (token or manifest) fails with a fixed `refer to the owner` message,
  stops the run and sends the spec back to the owner; AC-08 adds 401 and
  403; AC-16 records the observed status.
- **R1-9** (minor, retained) — BR-372 retries 20 times every 15 seconds,
  justified in D-8; the read-back moved to its own `read-back` job so that
  it alone can be re-run; D-8 and BR-354 (docs/publishing.md) give the
  recovery and state that a new dispatch is refused by BR-363, as intended.
- **R1-10** (minor, retained) — AC-13: the fake `docker` executes the inner
  command of `compose run … dev <command>`, so `node scripts/release.ts`
  runs the real checks, and the rehearsal runs the four job sequences with
  `GITHUB_SHA`, `GITHUB_OUTPUT` and the digest hand-off.
- **R2-1** (minor, retained; `2-spec-review-2-reviewer`) — T3 and D-5 now
  say that `publish-npm` runs no binfmt, release-image build or dependency
  install, and name its only build: the implicit, pinned `Dockerfile.dev`
  build of `docker compose run`.
- **R2-2** (minor, retained) — AC-04 adds mutations for `packages: write` on
  `read-back` or an added job, `read-back` with an `environment` or without
  `needs: [publish-npm]`, `RELEASE_TARBALL_SHA256` on another step, and a
  swapped `RELEASE_PHASE` literal.
- **R2-3** (minor, retained) — AC-16 says "three dispatches".

Decision pass `2-spec-decision-1-reviewer` (strongest tier, verdict
`changes`, on `93b2522`); every finding retained.

- **D1-1** (major, retained) — BR-357: every checkout uses
  `ref: ${{ github.sha }}`; `inputs.sha` is never checked out and only
  compared by the trusted checkout (BR-360, BR-361). BR-358 and AC-04 flip
  the checkout mutation (a `ref` of `${{ inputs.sha }}` now throws). T2, T5
  and D-10 corrected.
- **D1-2** (major, retained) — New BR-378: `release-check` reads the
  `release` environment and its deployment-branch-policies, requires a
  `required_reviewers` rule with a reviewer and exactly the `main` branch
  policy, and fails closed. New AC-21; AC-13 adds the doubles; AC-16 (b)
  shows the check passing and records whether `GITHUB_TOKEN` can read the
  endpoints, else the run fails closed and the decision returns to the
  owner. P-2 keeps "prevent self-review" off; P-4 is ordered before P-2; T1
  updated.
- **D1-3** (major, retained) — BR-355: top-level `env` exactly
  `{DEV_UID: "1001", DEV_GID: "1001"}`; AC-04 mutations added. BR-354 and
  new AC-22 require a green real `dry_run=true` dispatch of the same
  version and commit before any `dry_run=false` dispatch.
- **D1-4** (minor, retained) — BR-358 makes the validator closed-set
  (top-level, job, step, `with` and per-step `env` key sets); AC-04 adds
  `continue-on-error`, step `if`, job `env`, `container`, `services`,
  `RELEASE_NPM_REGISTRY_URL` and extra download `with` keys. BR-375 passes
  `GITHUB_ACTIONS` by name in the three `scripts/release.ts` targets; AC-13
  checks it.
- **D1-5** (minor, retained) — BR-355 adds the `run-name` and states why it
  reaches no shell; AC-04 adds its mutation.
- **D1-6** (minor, retained) — D-8 and BR-354: check the registry first
  after a reported publish failure, verify by hand, `read-back` skipped not
  failed; delete-and-redispatch only while the release commit is `main`'s
  HEAD. P-3 becomes a step after the first image push, verified by the new
  `image is public (P-3)` read-back check (BR-373, AC-12); the precondition
  order line no longer contradicts it.
- **D1-7** (minor, retained) — P-0 ends with `npm logout`; P-1 sets "Require
  two-factor authentication and disallow tokens" after the trusted
  publisher; new P-5 (tag ruleset on `refs/tags/v*`, agents never dispatch
  non-dry runs or approve deployments).
- **D1-8** (minor, retained) — BR-369 adds `--ignore-scripts` to
  `npm publish` and refuses a tarball with `publishConfig`; BR-370 forbids
  `--cache-from` and `--cache-to`; AC-10, AC-11 and AC-13 add the cases.
- **D1-9** (retained, orchestrator request) — `## Residual risks` added with
  entries (a)–(e); the owner accepted all five on 2026-11-12, (c) on the
  condition that the Claude GitHub App holds no deployment write permission.
- **R4-1** (major, retained; `2-spec-review-4-reviewer`) — Residual risk (e)
  still read "pending"; it now reads accepted, like (a)–(d).
- **R4-2** (minor, retained) — D-8 no longer applies the npm hand-check to
  the image case; the npm and image failure cases are separate, as in
  BR-354.
- **R4-3** (minor, retained) — D-8 and BR-354 cover an image push that
  failed with no GHCR version: re-run `publish-image` or dispatch again.
- **R5-1** (minor, retained; `2-spec-review-5-reviewer`) — BR-354 adds the
  "npm failed and not published" recovery that D-8 already gave, so both
  list the same five cases; two D-8 lines re-wrapped.
- **R3-1** (major, retained; `2-spec-review-3-reviewer`) — AC-16 contradicted
  P-5: its three `dry_run=false` dispatches are now made by the owner; the
  implementing agent only records the run links and results.
- **R3-2** (minor, retained) — Recovery split: an image push reported as
  failed while GHCR has the version leaves npm unpublished; the owner
  deletes the GHCR version and dispatches again (only while the release
  commit is `main`'s HEAD) or releases the next beta. D-8, BR-354 and AC-02
  updated.
- **R3-3** (minor, retained) — BR-378 states that both reads rely on the
  BR-356 `actions: read` permission and fail closed without it.

Decision pass `2-spec-decision-2-reviewer` (strongest tier, verdict
`changes`, on `99ddd3a`); every finding retained.

- **D2-1** (major, retained) — npm 11.20.0 reads
  `artifacts/<name>.tgz` as the GitHub shorthand `github:artifacts/...`.
  BR-369, AC-10, AC-13, AC-19's install command and the README path of
  BR-354 now use `./artifacts/sstolz-kdrive-mcp-server-<version>.tgz`; AC-10
  adds the mutation case of an argv without `./`. New AC-23 records once,
  in the implementation PR body, the real pinned npm in the `dev` container
  running the exact BR-369 argv with `--dry-run` (exit 0, output naming
  `@sstolz/kdrive-mcp-server@<version>`, whether provenance generation is
  reached). New BR-379: `read-back` compares the SHA-256 of the registry
  `dist.tarball` bytes with the `verify` digest, passed as
  `RELEASE_TARBALL_SHA256` like in `publish-npm`; `read-back` now
  `needs: [verify, publish-npm]` (BR-356, BR-358, BR-375); AC-04, AC-12 and
  AC-13 add the cases.
- **D2-2** (minor, retained) — BR-369 appends `--provenance` to the publish
  argv, so npm fails before publishing instead of publishing without
  provenance; D-3 and D-10 give the reason; AC-10, AC-13 and AC-23 use it.
- **D2-3** (minor, retained) — BR-375 pins the exact `-e` lists of
  `release-check`, `release-npm` (the fourteen GitHub Actions and OIDC
  variables plus the release variables) and `release-verify`, and states
  that `release-setup` and `release-image` pass none; AC-13 compares each
  list exactly with the Makefile. BR-369 adds `NPM_ID_TOKEN` to the refused
  variables; AC-10 adds it.
- **D2-4** (minor, retained) — AC-04 adds the BR-357 mutations: a publishing
  job without `make release-check`, `make release-check` after the publish
  step, an added `run` or `uses` step, `fetch-depth` other than `0`,
  `contents: write` on a job, and another `runs-on`.
- **D2-5** (minor, retained) — BR-359 states that every `scripts/release.ts`
  mode and `scripts/release-image.sh` run the input validation first, before
  any interpolation or command; BR-369, BR-370 and BR-372 repeat it; AC-10,
  AC-11 and AC-12 add refusal cases with no `npm`, `docker` or request call.
- **D2-6** (minor, retained) — The "image pushed, npm not published"
  recovery in BR-354, D-1 and D-8 now covers a rejected or expired second
  approval and a failed `release-check` in `publish-npm`: re-run
  `publish-npm`, or delete the GHCR version and dispatch again while the
  release commit is `main`'s HEAD. AC-02 names the recoveries of R4-3 and
  R5-1.
- **D2-7** (minor, retained) — BR-378 now says that BR-356 grants
  `actions: read` for these reads and any status other than 200 fails
  closed, replacing the claim about removing the permission.
- **R6-1** (minor, retained; `2-spec-review-6-reviewer`) — An expired second
  approval cancels the run after 30 days and allows no re-run: BR-354, D-1,
  D-8 and AC-02 give only "delete the GHCR version and dispatch again while
  the commit is HEAD, otherwise the next beta" for it; re-running
  `publish-npm` stays for a rejection or a failed check or publish.
- **R6-2** (minor, retained) — AC-23 runs with `-e GITHUB_ACTIONS=true` and no
  OIDC variable, matching the `verify` environment.

Implementation finding and owner decision for v2.

- **V2-1** (blocking, retained; implementation of frozen v1 at `0624a1b`) —
  The D-14 stop condition was hit: an isolated-prefix install of the packed
  tarball under npm 11.20.0 still listed `zod@3.25.76` under
  `@jimp/types@1.6.1` and `@jimp/plugin-resize@1.6.1`, and with the current
  `files` list npm did not pack the shrinkwrap; `@jimp/*` 1.6.1 is the latest
  release and still depends on `zod ^3.23.8`. The owner decided on
  2026-11-12 (option A): drop the shrinkwrap from F-024, accept the nested
  Zod 3 advisory for npm installs during the beta as residual risk (f), and
  fix it before 1.0 in a separate ticket (#12). BR-376, BR-377, BR-321 v2,
  D-14, AC-17–AC-20 and residual risk (e) are withdrawn; Scope item 6 and T8
  updated.

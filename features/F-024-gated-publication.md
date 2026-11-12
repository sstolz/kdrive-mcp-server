---
id: F-024
title: Scoped package name and gated beta publication
ticket: "#2"
status: draft
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-12.
Base: branch `claude/beautiful-maxwell-8mdk2w`, tree identical to `main`
`5e5a7db`. IDs: F-024, BR-353–BR-375, BR-016 v3, BR-178 v3; no ADR.
BR-291 and BR-305–BR-311 are reserved and not used. `#2` is this
repository's ticket.

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
  publishes by itself. Covered by a dispatch-only workflow whose publishing
  job needs the `release` environment's required reviewer (BR-355, BR-356).
- T2 wrong artifact: the published bytes do not come from the commit, version
  and tag the owner approved, or from a commit that never passed CI on `main`
  (BR-359–BR-363, re-checked inside the approved job, D-7).
- T3 untrusted code reaching publish credentials: fork and PR events, a
  dependency's install script, or a step that receives a token it does not
  need (BR-356, BR-358, D-4).
- T4 long-lived credential theft: an npm token stored in GitHub. Avoided by
  npm trusted publishing (OIDC) and the short-lived `GITHUB_TOKEN` (D-3).
- T5 same-repository writer: an account with write access can dispatch a
  modified `release.yml` from another branch. The `release` environment only
  admits `main` (precondition P-2), and the npm trusted publisher names the
  workflow file and the environment (P-1), so such a run reaches neither the
  approval nor npm. It can still get `packages: write` through
  `GITHUB_TOKEN`. Residual risk accepted, the same trust level as F-023 T5:
  same-repository writers are trusted, and every workflow change gets the
  mandatory independent review.
- T6 partial publication: one registry accepts and the other fails. npm
  versions cannot be reused, so the reversible push (GHCR) goes first and npm
  goes last (BR-371, D-8).
- T7 endpoint substitution: the test-double endpoint overrides redirect a
  real run. Refused in CI (BR-367).

## Scope

1. Rename: `package.json`, `package-lock.json`, the packed tarball name, and
   the README, SPEC.md and docs/publishing.md references.
2. `.github/workflows/release.yml`: dispatch-only, jobs `verify` and
   `publish`, with the publish job in the `release` environment.
3. `scripts/release.ts` (Node built-ins only: input and commit checks, CI
   evidence, registry checks, npm publish, read-back) and
   `scripts/release-image.sh` (multi-platform build and push), with Make
   targets `release-check`, `release-npm`, `release-image` and
   `release-verify`.
4. A policy validator for `release.yml` (`tests/helpers/release-policy.ts`,
   `tests/release-policy.test.ts`), script tests against test doubles
   (`tests/release.test.ts`), and BR-178 v3 in
   `tests/helpers/image-policy.ts` and `tests/image-policy.test.ts`.
5. docs/publishing.md: a "Release workflow" section with the procedure, the
   owner preconditions and partial-failure recovery.
6. The BR files (new and versioned), `business-rules/README.md`,
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
- Automating the owner preconditions P-1–P-4.

### Owner preconditions (not automated)

- **P-1** The npm account that publishes owns the `@sstolz` scope and has a
  trusted publisher for `@sstolz/kdrive-mcp-server`: provider GitHub Actions,
  repository `sstolz/kdrive-mcp-server`, workflow file `release.yml`,
  environment `release` (see OQ-1 for the first publish).
- **P-2** The repository environment `release` exists with the owner as
  required reviewer, deployment branches limited to `main`, and no
  environment secret or variable.
- **P-3** After the first push, the owner sets the GHCR package
  `kdrive-mcp-server` to public and keeps this repository's Actions write
  access to it.
- **P-4** The repository is public before the first non-dry-run dispatch:
  npm provenance needs a public source repository (BR-372, D-10).

## Business rules

### Package name

- **BR-353** — `package-lock.json` has top-level `name` and `packages[""].name`
  both exactly `@sstolz/kdrive-mcp-server`, and `make pack` writes exactly one
  tarball, `artifacts/sstolz-kdrive-mcp-server-<package.json version>.tgz`.
  Verified by: AC-01.
- **BR-354** — README.md names the packed tarball only as
  `artifacts/sstolz-kdrive-mcp-server-<version>.tgz` (at the current version)
  and contains `npm install -g @sstolz/kdrive-mcp-server@beta`; no tracked file
  outside `features/`, `business-rules/` and CHANGELOG.md contains
  `artifacts/kdrive-mcp-server-`; SPEC.md's `npx` lines read
  `npx @sstolz/kdrive-mcp-server`; docs/publishing.md no longer has the
  "Pending change" paragraph and its Names table marks the npm name as in use.
  Verified by: AC-02.

### Release workflow

- **BR-355** — `.github/workflows/release.yml` has `name: Release`, `on`
  exactly `workflow_dispatch` with exactly three inputs: `version` (type
  `string`, required), `sha` (type `string`, required) and `dry_run` (type
  `boolean`, required `false`, default `true`). Top-level `permissions` is
  `{}`, top-level `concurrency` is exactly
  `{group: release, cancel-in-progress: false}`, there is no top-level `env`,
  and the job set is exactly `verify` and `publish`. Verified by: AC-03,
  AC-04.
- **BR-356** — Both jobs have `runs-on: ubuntu-24.04` and `timeout-minutes:
  60`. `verify` has the `if` exactly
  `github.repository == 'sstolz/kdrive-mcp-server' && github.ref == 'refs/heads/main'`,
  `permissions` exactly `{contents: read, actions: read, packages: read}`, no
  `needs` and no `environment`. `publish` has `needs: [verify]`,
  `environment: release`, `permissions` exactly
  `{contents: read, actions: read, packages: write, id-token: write}`, and the
  `if` exactly the `verify` condition followed by
  ` && inputs.dry_run == false`. No other job has `packages: write` or
  `id-token: write`. Verified by: AC-03, AC-04.
- **BR-357** — The `verify` steps are exactly, in order: checkout;
  `make release-check`; `make setup`; `make pack`; `make release-npm`;
  `make image-binfmt`; `make release-image`; upload of
  `artifacts/sstolz-kdrive-mcp-server-*.tgz` as artifact `npm-tarball`. The
  `publish` steps are exactly, in order: checkout; `make release-check`;
  download of artifact `npm-tarball` into `artifacts/`; `make image-binfmt`;
  `make release-image`; `make release-npm`; `make release-verify`. Every
  checkout uses `ref: ${{ inputs.sha }}`, `fetch-depth: 0` and
  `persist-credentials: false`. Verified by: AC-03, AC-04.
- **BR-358** — Step inputs and credentials in `release.yml`:
  - `uses` admits only `actions/checkout`, `actions/upload-artifact` and
    `actions/download-artifact`, each pinned to a 40-hex commit SHA;
  - every `run` is exactly one `make <target>` with no `${{`;
  - workflow inputs reach steps only as step `env` values
    `RELEASE_VERSION: ${{ inputs.version }}`, `RELEASE_SHA: ${{ inputs.sha }}`
    and `RELEASE_DRY_RUN`, whose value is `'true'` on the `make release-npm`
    and `make release-image` steps of `verify` and
    `${{ inputs.dry_run }}` everywhere else;
  - the only credential is `GITHUB_TOKEN: ${{ github.token }}`, present
    exactly in the env of `make release-check` (both jobs) and of
    `make release-image` and `make release-verify` (`publish` only);
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
  exactly `true` or `false`, else `dry_run is not a boolean`. If any input
  fails, only the input lines and the summary print, no Git command or
  network request runs, and the exit status is 1. Verified by: AC-05.
- **BR-360** — `RELEASE_SHA` names a commit in the clone and equals
  `git rev-parse HEAD`; at that commit, `VERSION` is exactly `<version>\n`,
  `package.json` has `name` `@sstolz/kdrive-mcp-server` and `version`
  `<version>`, and `package-lock.json` has top-level `version` `<version>`.
  Each mismatch is one failed check. Verified by: AC-06.
- **BR-361** — `refs/tags/v<version>` exists and `v<version>^{commit}` equals
  `RELEASE_SHA` (lightweight and annotated tags are both accepted), and
  `git merge-base --is-ancestor <sha> refs/remotes/origin/main` succeeds.
  A missing tag, a tag on another commit and a commit not on `main` each fail
  their check. Verified by: AC-06.
- **BR-362** — The GitHub REST API lists at least one run of workflow
  `ci.yml` in this repository with `head_sha` equal to `RELEASE_SHA`,
  `head_branch` `main` and `event` `push` or `workflow_dispatch`, whose job
  named `ci-result` has `conclusion` `success`. A PR run, a failed or skipped
  `ci-result`, a run on another commit, and any non-2xx API status fail the
  check (fail closed). Verified by: AC-07.
- **BR-363** — The version is not already published:
  - npm: `GET <registry>/@sstolz%2fkdrive-mcp-server` returning 404 passes;
    200 passes only if neither `versions` nor `time` has the key `<version>`
    (npm never reuses an unpublished version); any other status fails;
  - GHCR: a pull token for `repository:sstolz/kdrive-mcp-server:pull`
    obtained with `GITHUB_TOKEN`, then
    `HEAD /v2/sstolz/kdrive-mcp-server/manifests/<version>`: 404 passes;
    200 fails as already published; any other status of either request fails.

  Verified by: AC-08.
- **BR-364** — The checks only read: Git commands that do not write refs or
  objects, and HTTP `GET` or `HEAD` requests (plus the GHCR token request).
  All checks after input validation run even when one fails. Verified by:
  AC-08, AC-13.

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
  to npm or pushes an image tag `latest`. Verified by: AC-10, AC-11.
- **BR-369** — `release-npm` requires exactly one file
  `artifacts/sstolz-kdrive-mcp-server-<version>.tgz` whose
  `package/package.json` has `name` `@sstolz/kdrive-mcp-server` and `version`
  `<version>`, else it exits 1 with a fixed message and publishes nothing. It
  then runs exactly `npm publish <tarball> --tag beta --access public`, with
  `--dry-run` appended when `RELEASE_DRY_RUN` is `true`. When
  `RELEASE_DRY_RUN` is `false`, it exits 1 before calling npm unless
  `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are set
  and `NODE_AUTH_TOKEN`, `NPM_TOKEN` and every `NPM_CONFIG_*` auth variable
  are unset (trusted publishing only). Verified by: AC-10.
- **BR-370** — `release-image` (`scripts/release-image.sh`, host Docker)
  builds target `runtime` of `Dockerfile` for
  `--platform linux/amd64,linux/arm64` with a `docker-container` Buildx
  builder whose BuildKit image is pinned by digest, with no `--build-arg`
  and no secret mount. With `RELEASE_DRY_RUN=true` the command has no
  `--push`, `--load`, `--output` or `--tag`, and no login runs. With
  `RELEASE_DRY_RUN=false` it logs in to `ghcr.io` with `GITHUB_TOKEN` through
  `--password-stdin`, builds with `--push`, exactly one
  `--tag ghcr.io/sstolz/kdrive-mcp-server:<version>` and the labels
  `org.opencontainers.image.source=https://github.com/sstolz/kdrive-mcp-server`,
  `org.opencontainers.image.version=<version>` and
  `org.opencontainers.image.revision=<sha>`, and logs out on exit whatever the
  outcome. It runs the BR-359 input validation first. Verified by: AC-11.
- **BR-371** — In `publish`, `make release-image` runs before
  `make release-npm` (BR-357), so a failed image push publishes nothing to
  npm. Verified by: AC-03.

### Read-back (`make release-verify`)

- **BR-372** — `release-verify` reads the npm package document, retrying up
  to 10 times 15 seconds apart until every condition holds or the attempts
  run out: `versions` has `<version>`; `dist-tags.beta` equals `<version>`;
  `dist-tags.latest` equals `<version>` only when `<version>` is the only
  key of `versions` (the registry's first-publish behaviour), and differs
  from it otherwise; `versions[<version>].dist.attestations` exists
  (provenance). Verified by: AC-12.
- **BR-373** — `release-verify` reads the GHCR manifest of tag `<version>`
  with a pull token: it is an OCI image index or Docker manifest list whose
  entries, ignoring attestation entries (platform `unknown/unknown`), have
  exactly the platforms `linux/amd64` and `linux/arm64`; and tag `latest`
  returns 404 or a digest different from the digest of tag `<version>`. It
  prints one line per condition like BR-365 and exits 0 only when all hold.
  Verified by: AC-12.

### Make targets and script

- **BR-375** — `release-check`, `release-npm` and `release-verify` depend only on the
  container-config guard (not `_require-setup`) and each run exactly
  `$(COMPOSE) run --rm -T` with every environment variable passed by name
  (`-e NAME`, never `-e NAME=value`), then
  `dev node scripts/release.ts <check|npm|verify>`; `release-image` runs
  `/bin/sh scripts/release-image.sh`; none of the four is a prerequisite of
  another target; all four are in `.PHONY` and `make help`;
  `scripts/release.ts` imports only `node:` modules. `release-npm` passes the
  GitHub Actions and OIDC variables that npm needs for trusted publishing and
  provenance by name, as one named constant tested against the Makefile.
  Verified by: AC-13.

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
  `kdrive-mcp-server/<version>`. (v1, kept by v2: package name
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

## Acceptance criteria

- **AC-01** (BR-016 v3, BR-353) — Given the renamed package, When
  `make pack` runs and the packed CLI is executed, Then the only tarball is
  `artifacts/sstolz-kdrive-mcp-server-0.1.0.tgz`, its `package.json` has the
  scoped name and `bin` `kdrive-mcp-server`, `--version` prints `0.1.0`, the
  lockfile names match, and the MCP server-info name and User-Agent stay
  `kdrive-mcp-server`. Verified by: `tests/package.test.ts`
  `BR-016 v3 packs the scoped package with the unchanged command`,
  `tests/package-version-wiring.test.ts` (unchanged), `BR-353 lockfile names`.
- **AC-02** (BR-354) — Given README.md, SPEC.md and docs/publishing.md, When
  the documentation test runs, Then the BR-354 strings are present and
  `artifacts/kdrive-mcp-server-` appears in no tracked file outside the
  excluded records. Verified by: `tests/release-policy.test.ts`
  `BR-354 documentation uses the scoped name`.
- **AC-03** (BR-355–BR-358, BR-371) — Given the real `release.yml`, When the
  release policy validator runs, Then it passes. Verified by:
  `tests/release-policy.test.ts` `BR-355 accepts the real release workflow`.
- **AC-04** (BR-355–BR-358) — Given fixtures mutated to: a `push`,
  `pull_request`, `pull_request_target` or `workflow_run` trigger;
  `dry_run` default `false`; top-level `permissions` not `{}`;
  `packages: write` or `id-token: write` on `verify`; `publish` without
  `environment`, without `needs` or without `inputs.dry_run == false`; a job
  without the repository and `main` guard; a `secrets.` reference; a `run`
  with `${{ inputs.version }}`; `GITHUB_TOKEN` on `make setup` or
  `make release-npm`; an unpinned or other action; `make release-npm` before
  `make release-image` in `publish`; `RELEASE_DRY_RUN` from the input in
  `verify`; When validated, Then each throws. Verified by:
  `tests/release-policy.test.ts` `BR-355 rejects release workflow mutation: %s`.
- **AC-05** (BR-359, BR-365) — Given the inputs `0.6.0`, `v0.6.0-beta.1`,
  `0.6.0-beta.01`, `0.6.0-rc.1`, `0.6.0-beta.1+build`, `0.6`, an empty
  version, a 39-hex or upper-case sha, and `dry_run=yes`, When
  `release-check` runs against doubles that record requests, Then each prints
  its fixed reason, the double records no request, no Git command runs, and
  the exit is 1; given `0.6.0-beta.1` and a valid sha, Then input validation
  passes. Verified by: `tests/release.test.ts` `BR-359 refuses input %s`.
- **AC-06** (BR-360, BR-361) — Given a temporary Git repository with `main`
  and a side branch, When `release-check` runs with: matching `VERSION`,
  `package.json`, lockfile and tag; `VERSION` `0.6.0-beta.2`; a
  `package.json` version mismatch; no tag; the tag on the parent commit; an
  annotated tag on the commit; a commit only on the side branch; Then
  exactly the expected checks fail in each case and the annotated tag passes.
  Verified by: `tests/release.test.ts` `BR-360 BR-361 commit checks: %s`.
- **AC-07** (BR-362) — Given a GitHub API double returning: a successful
  `push` run on `main` with `ci-result` success; only a `pull_request` run;
  `ci-result` `failure`; `ci-result` `skipped`; a run on another sha; status
  500; When checked, Then only the first passes. Verified by:
  `tests/release.test.ts` `BR-362 CI evidence: %s`.
- **AC-08** (BR-363, BR-364) — Given registry doubles returning: npm 404;
  npm 200 without the version; npm 200 with the version in `versions`; npm
  200 with the version only in `time`; npm 503; GHCR manifest 404; 200;
  token 401; When checked, Then the 404 and "without" cases pass and the
  others fail, and the doubles saw only `GET`/`HEAD` and the token request.
  Verified by: `tests/release.test.ts` `BR-363 already published: %s`.
- **AC-09** (BR-365–BR-367) — Given a synthetic token `SYNTHETIC-RELEASE-TOKEN`
  and doubles that echo the `Authorization` header in their bodies and fail
  with 500, When every mode runs, Then no output contains the token or a body;
  given a Git failure forced by the test, Then stderr is exactly
  `release: internal error` and the exit is 2; given `GITHUB_ACTIONS=true`
  and `RELEASE_NPM_REGISTRY_URL` set, Then each mode prints only the override
  refusal, exits 2, and the doubles record no request. Verified by:
  `tests/release.test.ts` `BR-365 never prints credentials`,
  `BR-366 internal error`, `BR-367 refuses overrides in CI`.
- **AC-10** (BR-368, BR-369) — Given a fake `npm` on `PATH` that records its
  argv and environment, When `release-npm` runs with dry run `true`, Then the
  argv is exactly `publish artifacts/sstolz-kdrive-mcp-server-0.6.0-beta.1.tgz --tag beta --access public --dry-run`;
  with dry run `false` and the OIDC variables set, Then the same without
  `--dry-run`; with `NPM_TOKEN` set, without the OIDC variables, with a
  missing tarball, two tarballs, or a tarball whose inner version differs,
  Then npm is not called and the exit is 1. Verified by:
  `tests/release.test.ts` `BR-369 npm publish: %s`.
- **AC-11** (BR-368, BR-370) — Given a fake `docker` that records argv and
  stdin, When `release-image` runs dry, Then one `buildx build` has both
  platforms and target `runtime` and no `--push`, `--load`, `--output`,
  `--tag`, and no `login` call; when it runs for real, Then `login ghcr.io`
  reads the token from stdin (never argv), the build has `--push`, exactly
  one `--tag ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1` and the three
  labels, no `latest`, and `logout ghcr.io` follows; given the fake build
  failing, Then `logout` still runs and the exit is non-zero. Verified by:
  `tests/release.test.ts` `BR-370 image build: %s`.
- **AC-12** (BR-372, BR-373) — Given read-back doubles where: everything
  holds with an earlier version and `latest` on it; the version is the sole
  version and `latest` equals it; `beta` points elsewhere; `latest` moved to
  the new version with earlier versions present; attestations are missing;
  the index lacks `linux/arm64`; the index has an extra `linux/386`;
  `latest` resolves to the new digest; the version appears only on the third
  attempt; When `release-verify` runs (retry delay shortened by the test
  double clock), Then only the first, second and last pass. Verified by:
  `tests/release.test.ts` `BR-372 BR-373 read-back: %s`.
- **AC-13** (BR-357, BR-364, BR-369, BR-370, BR-375) —
  Rehearsal (AGENTS.md §6). Given a temporary repository prepared as a
  `0.6.0-beta.1` release commit on `main` with its tag, doubles for the
  GitHub API, npm and GHCR (version absent), and fake `npm` and `docker`,
  When the `verify` sequence and then the `publish` sequence of BR-357 run
  through the Make targets with dry run `true` and then `false`, Then the dry
  run passes every check, calls `npm publish … --dry-run`, and calls neither
  `login` nor `--push`; the real run calls the image push before
  `npm publish` and the read-back passes against doubles updated after the
  publish; and the Makefile and import rules hold. Verified by:
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
- **AC-16** (BR-355, BR-356, BR-359–BR-363, BR-365) — Real wiring, after the
  merge, on actual `main`, with P-2 in place and nothing published. Given
  two dispatches of `release.yml` from `main` with `dry_run=false`: (a)
  `version=0.1.0` and the `main` SHA; (b) `version=0.6.0-beta.1` and the
  `main` SHA; When they run, Then (a) fails input validation with the stable
  refusal; (b) fails `VERSION`, `package.json`, lockfile and tag checks while
  the `main`, CI-evidence, npm and GHCR checks pass; in both, `publish` never
  starts and no deployment approval is requested; and npm still returns 404
  for the package. Verified by: run links recorded in the #2 acceptance
  comment.

## Decisions

- **D-1 Separate dispatch-only workflow with an environment approval.** The
  owner's approval of the `release` deployment, for a run whose inputs name
  the version and the full SHA, is the recorded go (AGENTS.md §7): GitHub
  keeps who approved, when, and for which run. Rejected: a tag-push trigger
  (a tag alone would publish, against §7); a job in `ci.yml` (mixes
  publication into the gate workflow, versions BR-015 and BR-225, and runs on
  every push); a manual publish from a workstation (no record, no check, a
  long-lived credential); a release bot or semantic-release (publishes on
  merge).
- **D-2 Two jobs: unprivileged `verify`, approved `publish`.** `verify` runs
  every check, packs, runs `npm publish --dry-run` and builds both image
  platforms with no push, before the approval is requested; the owner
  approves after seeing it green. `dry_run` defaults to `true`, so a dispatch
  with defaults never reaches the approval. Rejected: one job (third-party
  code from `make setup` would share the job with write and OIDC
  permissions); a separate rehearsal workflow (duplicates the contract).
- **D-3 npm trusted publishing (OIDC) with provenance.** No npm token is
  stored; the short-lived credential is bound to this repository, workflow
  file and environment; provenance is attached automatically. BR-369 refuses
  a token in the environment so the path cannot silently fall back.
  Rejected: an automation or granular token as a secret (long-lived,
  exfiltrable; the owner asked to prefer OIDC). The first publish of a new
  package is OQ-1.
- **D-4 GHCR through `GITHUB_TOKEN`, `packages: write` only on `publish`.**
  Rejected: a personal access token (long-lived, broader); `packages: write`
  on `verify` (no need). The token reaches only the three steps that call
  GitHub or GHCR, never `make setup`, `make pack` or `make release-npm`.
- **D-5 Tarball built in `verify`, image built in `publish`.** The npm
  tarball needs `make setup`, so it is built without write permissions and
  passed as a run artifact; `release-npm` re-checks its name and inner
  version. The image build runs untrusted package installs only inside
  BuildKit containers, which see no runner credential, so it can run in
  `publish`. Rejected: exporting the image as an OCI archive between jobs (more
  moving parts, a new push tool); re-packing in `publish` (dependencies would
  run next to the publish credentials).
- **D-6 Checks in one Node script with test-double endpoints.** Input
  validation runs first and stops everything, since a malformed version or
  SHA must never reach a Git ref or a URL; later checks all run so one run
  shows every problem (AC-16 relies on it). Overrides exist only for doubles
  and are refused in CI (T7). Rejected: inline shell in the workflow
  (untestable, injection-prone); first-failure stop for every check.
- **D-7 Checks repeated inside the approved job.** The tag, `main`, CI
  evidence and registries can change between `verify` and the approval;
  `publish` re-runs `release-check` right before pushing. The workflow
  `concurrency` group serializes release runs.
- **D-8 Image before npm.** A GHCR version can be deleted by the owner; an
  npm version can never be reused. If the npm step fails after the push, the
  owner either deletes the GHCR version and dispatches again, or releases the
  next beta; docs/publishing.md records this. Rejected: automatic rollback
  (deleting packages needs broader rights and is a destructive action
  reserved to the owner).
- **D-9 Beta only in v1; stable refused.** The mapping is `beta` dist-tag
  and the version image tag. The later stable mapping is planned as the
  `latest` dist-tag and the image tags `<version>` and `latest`; adding it is
  a new spec version that extends BR-359 and BR-368 without touching the
  beta path. Rejected: implementing stable now (no owner go for 1.0.0;
  untested path that could move `latest`).
- **D-10 Provenance required in the read-back.** It is the user-visible
  proof that the package came from this workflow. It needs a public
  repository, hence P-4. Rejected: optional provenance (a silent loss of
  provenance would go unnoticed).
- **D-11 `ci-result` on a `main` push or dispatch run as CI evidence.** On
  `push` and `workflow_dispatch` the `changes` job never skips a gate
  (BR-226), so a successful `ci-result` there means the full gate passed for
  that commit. Rejected: accepting the PR run (its merge ref is not the
  released commit); re-running the full gate in `release.yml` (duplicates
  CI, and Sonar secrets would enter the release workflow).
- **D-12 BR-178 versioned, not superseded.** Its purpose (no publication
  outside the release decision) is kept; v3 confines the markers to the two
  release scripts, which only the approved job runs for real.

## Open questions

- **OQ-1 First npm publish of a package that does not exist yet.** npm
  configures a trusted publisher on an existing package; it has no pending
  publisher. Community sources mention an `npm trust` command (npm 11.10 or
  later) that may configure it beforehand; this is not confirmed. If the
  owner cannot configure P-1 before `0.6.0-beta.1` exists, which path does
  the owner choose? (a) a one-time granular publish token, scoped to
  `@sstolz`, with a short expiry, stored only as a `release` environment
  secret and used only when the package does not exist, then deleted (a
  v2 change of BR-358 and BR-369); (b) a placeholder version published by
  the owner by hand, which makes `latest` point at the placeholder and
  contradicts docs/publishing.md; (c) the owner publishes `0.6.0-beta.1`
  by hand from the tarball that a `verify` run built, outside the workflow.
  Recommendation: first try `npm trust`; otherwise (a).
- **OQ-2 Audited dependency resolution for registry installs.** BACKLOG.md
  (2026-11-11) notes that `npm install -g` of the package resolves Jimp's
  nested `zod` 3 and its high advisory again, because `overrides` apply only
  in the root project, and asks the publication ticket to decide. Must this
  be fixed (for example with `npm-shrinkwrap.json`) before the first beta, in
  this spec or another ticket, or is it accepted for the beta and stated in
  the README?

## Stress-test

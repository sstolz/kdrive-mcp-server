---
id: F-024
title: Gated first stable publication
ticket: "#89"
status: done
version: 3
---

## Context

Version 2 allowed only beta releases. It kept npm `latest` on a deprecated
placeholder and never pushed GHCR `latest`. The owner decided on 2026-11-16
in #6 to ship `1.0.0` directly as the first stable release. A stable release
moves both registries' `latest` tags to that release. Documentation continues
to recommend image pinning by digest.

This version adds stable publication to the existing gated workflow. It
changes version validation, tag selection, registry preflight and read-back.
It affects the owner who approves releases, maintainers who prepare them,
and users who install the default stable package or pull the stable image.
Runtime behavior stays unchanged. The owner narrowed v3 on 2026-11-16 to
the first stable release only. Stable publication requires npm `latest` to be
exactly the deprecated `0.0.0-placeholder.0`. Once it is not that placeholder,
every `release-check` is refused. Any stable version in npm `versions` or
`time`, except the placeholder, also refuses every `release-check`, even if
`latest` was reset to the placeholder. These refusals apply in phases
`verify`, `image` and `npm`, with either dry-run value, never to read-back.
There is no emergency path. Later releases belong
to #91 (F-024 v4).
Betas before the first stable retain v1/v2 behavior.

The completed v2 contract is preserved verbatim in
[the v2 snapshot](history/F-024-v2.md). The
[v1 snapshot](history/F-024-v1.md) remains unchanged. This draft supersedes
only the rules stated below. All other accepted contracts remain in force.
Historical v2 decisions and risks describe that version, not current registry
state. Later features' accepted changes, including dependency fixes, remain
in force.

This ticket is security-sensitive. It changes which publication commands can
move default registry tags. Independent spec review and the strongest-tier
decision pass are required before freeze. This authoring task does not freeze
the spec or implement it.

## Scope

- Extend `scripts/release.ts` for first-stable validation, preflight and
  read-back. Extend `scripts/release-image.sh` for stable tags and buildx
  metadata-file parsing.
- Extend `.github/workflows/release.yml` with the image job output. Update
  Makefile release targets to pass `RELEASE_IMAGE_DIGEST` to check/verify
  with stable digest validation and make `GITHUB_OUTPUT` available to the image job.
  Update their closed-set policy tests for these exact changes.
- Select npm and GHCR tags by release kind. Keep one release workflow and its
  current job order, permissions, environment and approval gates.
- Extend `release-check` and `release-verify` for stable registry state.
- Write tests first in `tests/release.test.ts`. Extend the existing workflow
  and image policy tests only where needed to cover the changed contracts.
  Rehearse the whole stable procedure against test doubles before requesting
  any real run.
- Update `docs/publishing.md`: Versions, Release workflow, read-back commands
  and partial-failure recovery. Explain direct `1.0.0` publication, both
  stable `latest` tags, exact-version checks and digest pinning.
- In the implementation PR, prepare the versioned BR files below with source
  `F-024 v3`, a pending v2 section, updated verification and History.
  Keep v1 as the accepted rule until v2 acceptance.
  Update the BR index, spec index, capability map and Unreleased changelog
  entry as needed. Final acceptance markers follow AGENTS.md §6.

### Out of scope

- Later stable releases, betas after stable, recovery of a deprecated stable
  npm `latest`, and repointing GHCR `latest`: #91 (F-024 v4).
- README.md and SPEC.md install strings. Their changes belong to the
  release-preparation PR of #6. While VERSION is beta, v1 text stays.
- Changes to `docs/publishing.md` in this spec phase. The guide changes only
  in the implementation PR.
- The `1.0.0` version bump, CHANGELOG promotion and README version strings.
  These belong to the release-preparation PR of #6.
- Any publication, tag creation, real workflow dispatch or deployment approval.
- A GitHub Release object, a separate stable workflow, or automatic dispatch.
- Changes to owner preconditions P-0 through P-5. Their text and order remain
  those in the v2 snapshot and `docs/publishing.md`. No new owner precondition
  is needed. Stable registry checks are automated gates, not a new manual step.
- Changes to `ci.yml`, `runner-acceptance.yml`, runtime code or dependencies.

## Business rules

These are proposed replacement texts. BR files are not edited in this task.
All twelve affected rules currently have version 1. Their purpose stays the
same, so each becomes version 2. No new BR ID; re-check the next free IDs
before freeze and before the PR. Never reuse withdrawn IDs.

### Changed rules

- **BR-354 v2** — The v1 naming, tarball references,
  precondition order and commands, dry-run evidence and dispatch instructions
  remain unchanged. `docs/publishing.md` states that `1.0.0` is the first
  stable release, published directly with npm `latest` and GHCR `<version>`
  and `latest`; beta publishes use npm `beta` and only GHCR `<version>`.
  npm `latest` stays on the deprecated placeholder until the first stable
  release. Only once VERSION is stable, the default install is
  `npm install -g @sstolz/kdrive-mcp-server`. Exact execution uses
  `npx -y @sstolz/kdrive-mcp-server@<version>`. Advise users to pin an exact
  version. Betas remain installable with `@beta` or an exact version.
  The guide states that GHCR `latest` is mutable and is not protected by
  the `release` environment approval. Any same-repository workflow with
  `packages: write` can overwrite it. Image pinning by the printed manifest
  digest remains recommended.
  The release procedure documents BR-363 v2 preflight and BR-372 v2 /
  BR-373 v2 read-back for each release kind. Stable recovery follows D-4
  below. The guide keeps the beta recovery cases from
  [features/history/F-024-v2.md D-8](history/F-024-v2.md#decisions) verbatim.
  D-4 adds first-stable recovery without replacing those beta cases.
  While VERSION is beta, BR-354 v1
  install text remains. Once VERSION is stable, tests assert that README.md
  and SPEC.md contain no `@beta` default. Explicit beta examples may remain.
  Verified by: AC-24, AC-32.
- **BR-356 v2** — Keep every v1 guard, permission, runner, timeout,
  environment and existing output. Add exactly the `publish-image` job output
  `image_digest: ${{ steps.release-image.outputs.image_digest }}`.
  Replace `read-back`'s `needs: [verify, publish-npm]` with
  `needs: [verify, publish-image, publish-npm]`. All other needs stay unchanged.
  Verified by: AC-30, AC-33.
- **BR-357 v2** — Keep the exact v1 step order and checkout contract.
  Add `id: release-image` only to `publish-image`'s `make release-image` step.
  Keep `id: release-npm` on `verify`'s `make release-npm` step.
  Verified by: AC-30, AC-33.
- **BR-358 v2** — Keep every v1 closed-set and credential restriction.
  Extend the allowed step IDs from only `release-npm` to `release-npm` and
  `release-image`, at exactly the steps named by BR-357 v2.
  Add `RELEASE_IMAGE_DIGEST: ${{ needs.publish-image.outputs.image_digest }}`
  only to `publish-npm`'s `make release-check` and `read-back`'s
  `make release-verify`. No `make release-npm` step receives it.
  These two steps forward the variable for both release kinds.
  All other step environment sets stay unchanged.
  Verified by: AC-30, AC-33.
- **BR-375 v2** — Keep the v1 targets, guards, commands, tarball output,
  imports and prerequisite restrictions. Add `-e RELEASE_IMAGE_DIGEST` to
  exactly the `release-check` and `release-verify` variable lists.
  Keep the `release-npm` variable list unchanged. Make `GITHUB_OUTPUT`
  available to `release-image`'s `/bin/sh scripts/release-image.sh`.
  After a successful real stable build and metadata validation, that script
  appends exactly one line `image_digest=<digest>` to `$GITHUB_OUTPUT` when
  it is set. Beta and dry builds emit no image digest output.
  Verified by: AC-30, AC-33.
- **BR-359 v2** — Every release mode validates inputs before Git, any child
  process, Docker, a request or input interpolation. `RELEASE_VERSION` is
  exactly `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-beta.N`. Each numeric
  component is `0` or an ASCII decimal integer with no leading zero.
  No whitespace, prefix, build metadata or other pre-release is accepted.
  Invalid SemVer reports `version is not a SemVer version`. Valid SemVer
  outside these two forms reports `unsupported release version`.
  `RELEASE_SHA` remains exactly 40 lowercase hex characters;
  `RELEASE_DRY_RUN` remains `true` or `false`; `release-check` requires
  `RELEASE_PHASE` to be `verify`, `image` or `npm`. Their v1 diagnostics,
  input-only failure output and exit 1 remain unchanged. For stable phase
  `npm` and stable read-back, `RELEASE_IMAGE_DIGEST` joins this validation-first
  list and must match `sha256:<64 lowercase hex>`. Missing or malformed values
  fail before any command or request. In stable `release-check` phases
  `verify` and `image`, the variable must be empty. Any non-empty value fails
  before commands or requests with
  `RELEASE_IMAGE_DIGEST must be empty in verify and image phases`.
  For beta check and read-back, the
  variable must be empty or match `sha256:<64 hex>` (either hex case).
  It is never used in a beta comparison. Any other beta value fails before
  commands or requests with `RELEASE_IMAGE_DIGEST is not a sha256 digest`.
  Verified by: AC-25.
- **BR-363 v2** — Stable preflight requires npm 200 with readable `versions`
  and `time` objects. The candidate is absent from both. npm `latest` is
  exactly `0.0.0-placeholder.0`, whose version entry has a non-empty
  `deprecated` string. The candidate is strictly greater in SemVer precedence
  than every published version in either object except that placeholder.
  In `time`, ignore exactly `created` and `modified`. Every other key must
  be valid SemVer. Malformed version keys fail closed. Compare numeric
  components as exact integers. Build metadata does not affect precedence.
  Include published betas, even betas above the candidate's base version.
  A readable npm document with non-placeholder `latest` or any stable version
  key in `versions` or `time`, except `0.0.0-placeholder.0`, refuses every
  release kind in `release-check` with the #91 diagnostic below. This applies
  in phases `verify`, `image` and `npm`, with either dry-run value, never to
  read-back. This holds even if `latest` was reset to the placeholder. There is no emergency path.
  Missing or malformed registry data fails closed. Stable has no npm-404 exemption.

  Before stable image publication, both GHCR candidate and `latest` must
  return 404. In stable phase `npm`, both must return 200 and resolve to
  exactly `RELEASE_IMAGE_DIGEST`. Compute SHA-256 over raw GET response bytes
  with the identical Accept list for both tags:
  `application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`.
  Never compare HEAD digests. Require valid image indexes and fail closed
  on missing digests, token errors or unexpected statuses. Keep v1 token
  and unexpected-status diagnostics. BR-378 still runs in every phase.
  Before first stable, beta retains v1/v2 checks, including npm dry-run 404,
  no ordering against published betas, and no new GHCR latest preflight.
  Verified by: AC-26, AC-27, AC-28.
- **BR-368 v2** — A beta release uses npm dist-tag `beta` and pushes only
  `ghcr.io/sstolz/kdrive-mcp-server:<version>`. It never writes `latest`.
  A stable release uses npm dist-tag `latest` and pushes exactly the image
  references `ghcr.io/sstolz/kdrive-mcp-server:<version>` and
  `ghcr.io/sstolz/kdrive-mcp-server:latest` from the same multi-platform build.
  No release mode runs `npm dist-tag`. Dry runs do not write registry tags.
  Verified by: AC-29, AC-30.
- **BR-369 v2** — The v1 tarball count, path, package name and version checks,
  npm minimum version, printed SHA-256, verified-digest comparison, OIDC
  requirements, refused credential variables and `publishConfig` refusal
  remain unchanged. After BR-359 v2 validation, npm runs exactly
  `npm publish ./artifacts/sstolz-kdrive-mcp-server-<version>.tgz --tag <tag> --access public --ignore-scripts --provenance`,
  where `<tag>` is `latest` for stable and `beta` for beta. Append
  `--dry-run` exactly when `RELEASE_DRY_RUN=true`. Trusted publishing,
  provenance and lifecycle-script refusal remain mandatory.
  Verified by: AC-29.
- **BR-370 v2** — The v1 validation-first, pinned BuildKit, runtime target,
  two-platform build, cache and build-argument restrictions remain unchanged.
  A dry run builds without login, push, load, output or tags. A real run
  logs in with `GITHUB_TOKEN` through stdin and builds with `--push`, the
  existing source, version and revision labels, and exactly the references
  selected by BR-368 v2. Stable uses two `--tag` arguments on one build;
  beta uses one. The real build writes a buildx `--metadata-file`.
  For stable only, parse the metadata as JSON and validate the exact
  top-level `containerimage.digest` value as `sha256:<64 lowercase hex>`.
  Do not use a line-based parser. Refuse newline-bearing values and decoy
  `digest` keys instead of the required value. After validation, print exactly
  once to stdout `release-image: image digest sha256:<hex>` and expose it as
  the `publish-image` job output `image_digest`.
  Pass that output (empty for beta) as `RELEASE_IMAGE_DIGEST` only via
  `publish-npm`'s `make release-check` and `read-back`'s `make release-verify`; add `publish-image` to read-back dependencies. The image
  recipe writes `image_digest=<digest>` to `GITHUB_OUTPUT` after validation.
  The workflow exposes `steps.release-image.outputs.image_digest` as
  `needs.publish-image.outputs.image_digest`. Beta behavior stays unchanged. Reject a missing
  or malformed digest before image requests. Dry builds produce no digest
  requirement. Logout still runs on exit, including build failure.
  Verified by: AC-30, AC-31, AC-32, AC-36.
- **BR-372 v2** — After BR-359 v2 validation, npm read-back keeps the v1
  retry limit of 20 attempts, 15 seconds apart, until all npm conditions
  hold. For beta, all v1/v2 read-back conditions remain unchanged.
  No stable-default support is added to beta. For stable,
  `versions[<version>]` exists and records the exact release version;
  `time[<version>]` exists;
  `dist-tags.latest` equals `<version>`; that exact version has
  `dist.attestations`; and its tarball bytes pass BR-379 v1 against the
  verified tarball SHA-256. Resolving `latest` therefore selects that same
  version, provenance and tarball. The exact `0.0.0-placeholder.0` entry
  remains present with a non-empty `deprecated` string. Stable read-back
  does not require the `beta` tag to move. A missing condition fails after
  the bounded retry loop. No registry mutation occurs during read-back.
  Verified by: AC-31.
- **BR-373 v2** — Image read-back keeps the v1 OCI index or Docker manifest
  list check for `<version>` with exactly `linux/amd64` and `linux/arm64`
  among non-attestation entries. For beta, `latest` remains absent or has
  another digest, as in v1. For stable, `<version>` and `latest` both return
  200 and resolve to exactly `RELEASE_IMAGE_DIGEST` from this run.
  Beta read-back stays unchanged from v2 and requires no run digest. An anonymous token request
  and anonymous manifest HEAD must succeed for both stable references.
  Digest comparisons use GET and the BR-363 v2 Accept list. HEAD is only
  an anonymous access check. Both stable tags must serve the checked index.
  Binding both tags to this run is mandatory, not a residual risk.
  The printed line remains `release-verify: image digest sha256:<hex>`.
  Fixed per-condition output and success only when every condition holds
  remain unchanged.
  Verified by: AC-31.

### Unchanged rules and gates

BR-353 v1, BR-360 v1 through BR-362 v1,
BR-364 v1 through BR-367 v1, BR-371 v1, BR-374 v1,
BR-378 v1 and BR-379 v1 retain their accepted texts. BR-016 v3 and
BR-178 v3 and BR-355 v1 remain unchanged. BR-356 v2, BR-357 v2,
BR-358 v2 and BR-375 v2 change only the digest plumbing stated above.
Their existing gates remain. This spec does not restore the withdrawn rules
or any dependency rule superseded by later features.

In particular, an owner go names the version and commit. A successful real
`dry_run=true` dispatch of that same pair and its recorded run evidence are
required before `dry_run=false`. Both publish jobs still need `release`
environment approval. The tagged release commit is `main` HEAD at dispatch,
equals `GITHUB_SHA`, and has successful `ci-result` evidence on `main`.
The trusted workflow checks out the dispatched SHA, not the untrusted input.
Environment protection is checked in every phase. Agents never dispatch a
real run, re-run a release job, or approve a deployment; a re-run is an
owner-only action. GHCR publishes before npm. Permissions,
credential isolation, endpoint override refusal in CI and safe output remain
unchanged. Verified by: AC-32, AC-33.

### BR record preparation

Follow the BR-016/BR-178 versioning pattern. Preserve the full accepted v1
text and evidence. Label v2 pending acceptance and state: "v1 stays the
accepted rule until acceptance". A file-level pending marker must not hide
v1's accepted status. Prepare the v2 front matter and separate version sections
without claiming v2 active. Append this History line in the implementation
PR, using that PR's date and the summary below:

`- v2 — <implementation-PR-date> — F-024 v3 (#89) — <summary>; pending acceptance, v1 stays the accepted rule until acceptance`

The final version changes are BR-354, BR-356, BR-357, BR-358, BR-359,
BR-363, BR-368, BR-369, BR-370, BR-372, BR-373 and BR-375: v1 to v2.
BR-356/357/358/375 change only the stable digest output, dependencies,
closed-set workflow validation and Makefile environment forwarding. Their
existing gate clauses remain. Verified by AC-30, AC-32 and AC-33.

### Registry conditions by kind and phase

Each preflight row also requires all unchanged owner, commit, CI and
environment gates. `preflight` means phase `verify`. Phase `image` and phase
`npm` are real-run checks. Dry builds never publish. Only `release-check`
rows (phases `verify`, `image` and `npm`, with either dry-run value) refuse a
non-placeholder npm `latest` or any stable version key in npm `versions` or
`time` (placeholder excluded) before publication with the #91 diagnostic,
even after `latest` is reset to the placeholder.
These refusals never apply to read-back. Stable read-back expects the new
candidate key in both `versions` and `time`, and npm `latest` equal to it.

| Kind   | Phase                   | Exact npm conditions                                                                                                                                                                                       | Exact GHCR conditions                                                                                                                                                          |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Beta   | preflight dry_run=true  | Unchanged from v2: 404 passes; 200 requires readable versions/time and candidate absent from both; other statuses fail. If latest is present and not the exact placeholder, refuse with #91.               | Unchanged from v2: authenticated token 200; candidate HEAD 404; no latest check.                                                                                               |
| Beta   | preflight dry_run=false | Unchanged from v2: 200; candidate absent from versions/time; latest names another deprecated version, subject to the exact-placeholder boundary above.                                                     | Unchanged from v2: authenticated token 200; candidate HEAD 404; no latest check.                                                                                               |
| Beta   | phase image             | Unchanged from v2: same real preflight npm conditions.                                                                                                                                                     | Unchanged from v2: candidate HEAD 404; push only version, both platforms.                                                                                                      |
| Beta   | phase npm               | Unchanged from v2: same real preflight npm conditions; publish with beta.                                                                                                                                  | Unchanged from v2: authenticated token 200; candidate HEAD 200; no latest check or run digest.                                                                                 |
| Beta   | read-back               | Unchanged from v2: candidate present; beta equals candidate; latest names another deprecated version; attestations present; tarball matches verify; 20 attempts, 15 seconds apart.                         | Unchanged from v2: candidate GET is an index with exactly both platforms; latest 404 or different GET digest; anonymous token and candidate HEAD 200; print digest.            |
| Stable | preflight dry_run=true  | 200; exact deprecated placeholder latest; readable versions/time; candidate absent and strictly above all published versions except placeholder; only created/modified time keys ignored.                  | Authenticated token 200; candidate and latest GET 404.                                                                                                                         |
| Stable | preflight dry_run=false | Same stable npm conditions as dry_run=true.                                                                                                                                                                | Authenticated token 200; candidate and latest GET 404.                                                                                                                         |
| Stable | phase image             | Same stable npm conditions as preflight.                                                                                                                                                                   | Candidate and latest GET 404; push both tags from one two-platform build; export metadata digest.                                                                              |
| Stable | phase npm               | Same stable npm conditions as preflight; publish with latest.                                                                                                                                              | Both tags GET 200, valid indexes, each raw-body digest equals RELEASE_IMAGE_DIGEST.                                                                                            |
| Stable | read-back               | Candidate entry records exact version; candidate key exists in time; latest equals candidate; attestations present; tarball matches verify; exact placeholder remains deprecated; beta tag need not move; 20 attempts, 15 seconds apart. | Both tags GET 200, each digest equals RELEASE_IMAGE_DIGEST; exactly linux/amd64 and linux/arm64; anonymous token and HEAD 200 for both; HEAD never supplies comparison digest. |

### Exact diagnostics and new read-back output

The following strings are fixed diagnostic reasons. Existing report prefixes
and input summaries remain. New read-back lines are shown in full. In those
lines `<reason>` is exactly one of the listed alternatives; `<hex>` is 64
lowercase hex digits. Do not print an untrusted registry key in a diagnostic.
Implementation removes `unsupported pre-release` and
`stable releases are out of scope (F-024 v1)` from code and tests.

| Input or condition                                       | Exact string                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01.0.0                                                   | `version is not a SemVer version`                                                                                                                             |
| v1.0.0                                                   | `version is not a SemVer version`                                                                                                                             |
| 1.0.0-beta.01                                            | `version is not a SemVer version`                                                                                                                             |
| 1.0.0-rc.1                                               | `unsupported release version`                                                                                                                                 |
| 1.0.0+b                                                  | `unsupported release version`                                                                                                                                 |
| Stable candidate not greater than a published version    | `stable version is not greater than every published version`                                                                                                  |
| Non-placeholder npm latest, either release kind          | `releases after the first stable are out of scope; see #91 (F-024 v4)`                                                                                        |
| Stable version key in versions/time, either release kind | `releases after the first stable are out of scope; see #91 (F-024 v4)`                                                                                        |
| Non-empty stable verify/image input digest               | `RELEASE_IMAGE_DIGEST must be empty in verify and image phases`                                                                                               |
| Stable build stdout digest line                          | `release-image: image digest sha256:<hex>`                                                                                                                    |
| Stable npm 404                                           | `npm registry status 404`                                                                                                                                     |
| Candidate already published on npm                       | `version already published on npm`                                                                                                                            |
| npm latest missing                                       | `npm placeholder missing (P-0)`                                                                                                                               |
| Exact placeholder latest not deprecated                  | `npm latest is not a deprecated placeholder (P-0)`                                                                                                            |
| GHCR candidate present before push                       | `image already published`                                                                                                                                     |
| Invalid non-empty beta input digest                      | `RELEASE_IMAGE_DIGEST is not a sha256 digest`                                                                                                                 |
| Existing GHCR latest before stable push                  | `GHCR latest already exists; first stable requires 404`                                                                                                       |
| Either stable tag digest differs from run digest         | `image digest does not match RELEASE_IMAGE_DIGEST`                                                                                                            |
| Non-SemVer time key other than created/modified          | `npm time contains a non-SemVer version key`                                                                                                                  |
| Non-SemVer versions key                                  | `npm versions contains a non-SemVer version key`                                                                                                              |
| Missing or malformed stable input digest                 | `RELEASE_IMAGE_DIGEST is not a sha256 digest`                                                                                                                 |
| Missing or malformed stable buildx metadata digest       | `buildx metadata digest is not a sha256 digest`                                                                                                               |
| New stable npm latest line                               | `release-verify: npm latest tag ok` or `release-verify: npm latest tag FAIL latest does not name the version`                                                 |
| New stable placeholder line                              | `release-verify: npm original placeholder deprecated ok` or `release-verify: npm original placeholder deprecated FAIL original placeholder is not deprecated` |
| New stable candidate digest line                         | `release-verify: image version digest ok` or `release-verify: image version digest FAIL <reason>`                                                             |
| New stable latest digest line                            | `release-verify: image latest digest ok` or `release-verify: image latest digest FAIL <reason>`                                                               |
| Digest-line reason alternatives                          | `image digest does not match RELEASE_IMAGE_DIGEST`; `image manifest unavailable`; `image manifest invalid`                                                    |
| New stable latest public line                            | `release-verify: image latest is public (P-3) ok` or `release-verify: image latest is public (P-3) FAIL anonymous pull failed`                                |
| Existing printed digest, unchanged                       | `release-verify: image digest sha256:<hex>`                                                                                                                   |

Only in `release-check` (phases `verify`, `image` and `npm`, with either
dry-run value), once the npm document is readable, the #91 refusal takes
precedence over every other npm condition. This precedence never applies
to read-back. In stable phase `npm`, a GHCR token failure keeps
the v1 token diagnostic; either GHCR tag returning 404 or another failed
manifest status maps to `image manifest unavailable`. Invalid index
content maps to `image manifest invalid`. A valid index with a different
digest maps to `image digest does not match RELEASE_IMAGE_DIGEST`.

Stable read-back does not emit the beta-only condition lines `npm beta tag`,
`npm latest is a deprecated placeholder` or `image latest tag`.

Retain existing version-platform, version-public, provenance and tarball
lines. Add no other new read-back condition lines. Failed manifest status or
token access uses `image manifest unavailable` on the new digest lines;
invalid index content uses `image manifest invalid`.

## Acceptance criteria

AC-01 through AC-23 remain historical evidence for v2. The criteria below
cover v3. All listed new test names are planned, not implemented or passing.
Use versioned BR citations in those tests. Tests run through `make check`.

- **AC-24 (BR-354 v2)** — Given the implementation guide, when
  `BR-354 v2 guide covers first stable recovery` runs in
  `tests/release-policy.test.ts`, then the guide describes the phase table,
  direct 1.0.0, tags, mutable and approval-unprotected GHCR `latest`, digest
  pinning, verbatim v2 D-8 beta recovery cases, D-4 recovery and unchanged
  P-0 through P-5. Given beta VERSION, when `BR-354 v2 install text follows VERSION`
  runs, then v1 README/SPEC expectations remain. Given stable VERSION in
  a synthetic fixture shipped by #89, when that test runs, then default install
  lines contain no `@beta`, use `npm install -g @sstolz/kdrive-mcp-server`
  and exact execution uses `npx -y @sstolz/kdrive-mcp-server@<version>`.
  #89 ships this synthetic stable-VERSION fixture for BR-354 v2 tests.
  Checks against the real README.md and SPEC.md apply only once the real
  VERSION is stable, in the release-preparation PR of #6.
  This spec phase changes neither the guide nor install strings.
- **AC-25 (BR-359 v2)** — Given each release entry point, when versions
  `1.0.0`, `1.2.3`, `0.0.0` and `0.6.0-beta.2` are supplied with other valid
  inputs, then validation passes. Given leading zeros, whitespace, `v1.0.0`,
  alpha, rc, incomplete beta, extra beta components, or build metadata on
  stable or beta, when validation runs, then it fails before any child,
  Docker call or request. Invalid SHA, boolean and phase still fail before side effects.
  Verified by: `tests/release.test.ts`,
  `BR-359 v2 accepts stable and beta inputs: %s` and
  `BR-359 v2 refuses inputs before side effects: %s`.
- **AC-26 (BR-363 v2)** — Given npm fixtures for every phase-table row,
  when `BR-363 v2 npm phase matrix: %s` runs in `tests/release.test.ts`,
  then exactly those conditions pass. Test stable 404 refusal and beta
  dry-run 404 acceptance. The following refusal cases apply only to
  `release-check` phases `verify`, `image` and `npm`, with both dry-run values.
  Test every non-placeholder latest, including
  deprecated stable, for both kinds and dry-run values with the #91 reason.
  Test `latest` reset to the deprecated placeholder with a stable key in
  either `versions` or `time`: every stable or beta release, dry or real,
  refuses with the #91 diagnostic. Test created/modified ignored, all other
  malformed time keys refused,
  candidate in either object refused, placeholder deprecation required,
  and unreadable/status failures. Test exact integer ordering above the safe
  integer range, 1.9.9 versus 1.10.0, equality and reverse order. Published
  0.6.0-beta.2 refuses stable 0.5.0 but permits 0.6.0 and 1.0.0.
  An unpublished beta below an existing beta remains accepted before stable.
  Share an AC-31 fixture where stable read-back passes with `1.0.0` present
  in both `versions` and `time`, and npm `latest` equal to `1.0.0`.
- **AC-27 (BR-363 v2)** — Given GHCR fixtures for every phase-table row,
  when `BR-363 v2 GHCR phase matrix: %s` runs in `tests/release.test.ts`,
  then stable requires both tags absent before push and beta keeps v2 HEAD
  checks. Existing latest, candidate, token failures and unexpected statuses
  fail with the specified diagnostics. Record methods and Accept headers.
- **AC-28 (BR-359 v2, BR-363 v2)** — Given stable phase npm, when
  `BR-363 v2 stable digest binding: %s` runs in `tests/release.test.ts`,
  then only both GET bodies matching the run digest pass. Equal HEAD digests
  with different GET bytes fail. Two equal tags from another run fail.
  Missing/malformed input digest fails before commands or requests in check
  and verify. Stable phases `verify` and `image` accept only an empty input
  digest; any non-empty value fails before commands or requests with the
  pinned empty-input diagnostic. Beta accepts an empty digest or a valid
  digest in either hex case, ignores it in comparisons and refuses every other value with the
  pinned diagnostic before commands or requests. Both GET requests use the exact Accept
  list above. `F-024 v3 exact diagnostics: %s` asserts every diagnostics-table
  string and absence of both removed legacy messages in code and tests.
- **AC-29 (BR-368 v2, BR-369 v2)** — Given fake npm and a valid stable
  tarball, when dry or real publication runs, then its exact argv uses
  `--tag latest --access public --ignore-scripts --provenance`, with
  `--dry-run` only for dry run. Given beta, when it runs, then the tag is
  `beta`. Neither path calls `npm dist-tag`. Given a bad tarball, digest,
  OIDC environment, npm version, refused credential variable or
  `publishConfig`, when its applicable check runs, then publication is
  refused as in v1. Verified by: `tests/release.test.ts`,
  `BR-368 v2 BR-369 v2 npm exact argv: %s` and
  `BR-369 v2 stable publish safeguards: %s`.
- **AC-30 (BR-356 v2, BR-357 v2, BR-358 v2, BR-368 v2, BR-370 v2, BR-375 v2)** — Given fake Docker, when a real stable
  image build runs, then one push builds both platforms with exactly the
  version and `latest` tags, existing labels and stdin login. Given beta,
  when it runs, then there is only the version tag. Given either kind in dry
  run, when it runs, then no login, tag or push occurs. Given a failed real
  build, when it exits, then logout still runs. Given a successful stable push,
  when buildx metadata is read, then its digest is validated, exported and
  passed to npm and read-back. Missing or malformed metadata stops the
  dependent jobs. A newline-bearing `containerimage.digest` value or a decoy
  `digest` key without the exact valid top-level value is refused with
  `buildx metadata digest is not a sha256 digest`. Assert no
  `image_digest` output line on beta or dry builds, and exactly one on a
  successful real stable build when `GITHUB_OUTPUT` is set. Assert exactly
  one stable stdout digest line with the pinned format. Assert zero
  `release-image:` digest lines on beta and dry builds. The fake-Docker
  metadata fixture derives from the real sample recorded by AC-36.
  Verified by:
  `tests/release.test.ts`, `BR-368 v2 BR-370 v2 image argv: %s`, and
  `tests/release-policy.test.ts`,
  `BR-356 v2 BR-358 v2 stable digest plumbing: %s` and
  `BR-375 v2 release target variables: %s`.
- **AC-31 (BR-372 v2, BR-373 v2, BR-379 v1)** — Given stable registry
  doubles serving the exact version through npm `latest`, with provenance,
  expected tarball digest, deprecated placeholder, and this run's public GHCR
  digests with both platforms, when read-back runs, then it succeeds and
  prints the image digest. The shared AC-26 fixture has `1.0.0` present in
  both npm `versions` and `time`, with npm `latest` equal to `1.0.0`. It
  passes when only read-back is re-run as D-4 requires. Given each missing or
  mismatched condition in turn, including anonymous access denied on either image tag, when
  read-back runs, then it fails. Given delayed npm consistency, when the
  conditions appear within 20 attempts, then it succeeds; otherwise it fails
  after attempt 20. Beta read-back remains unchanged from v2, without run-digest binding. Verified
  by: `tests/release.test.ts`, `BR-372 v2 stable npm read-back: %s`,
  `BR-373 v2 stable image read-back: %s`, and the existing
  `BR-372 v2 BR-373 v2 read-back: %s` beta cases.
  Rename `BR-372 BR-373 read-back: refuses %s` to
  `BR-372 v2 BR-373 v2 read-back: refuses %s`. Equal tags from another
  run fail even when their platforms are valid.
- **AC-32 (BR-354 v2; unchanged gates)** — Given an isolated Git fixture,
  fake npm and Docker executables, local npm/GHCR/GitHub HTTP doubles and a
  bounded fake retry clock, when the workflow job commands are rehearsed,
  then `verify` runs first with dry-run publication and no registry writes.
  Simulate dispatch inputs and `GITHUB_SHA`; the GitHub double supplies main
  CI success and protected environment responses. A harness approval flag
  simulates each of the two owner deployment approvals and blocks the next
  publish job until set. No GitHub dispatch or real approval occurs.
  Run `publish-image`, capture buildx metadata digest and job output, run
  `publish-npm` with that digest, then `read-back` with both verified digests.
  Assert image-before-npm order, exact tags, digest propagation and no writes
  in dry run. Missing approval flags must prevent each publication.
  Rehearse image-only success after rejected and expired second approval,
  failed npm preflight, failed npm publication, and a partial image push.
  Rehearse the failed `publish-npm` job re-run within the same run first,
  using the same image digest. Require every gate and a new simulated
  environment approval before npm publication. Rehearse refusal when a
  gate or approval is missing, and cleanup only when that re-run is
  unavailable.
  Apply every D-4 recovery step to the doubles through an owner-only harness
  action, never an agent registry command. Assert each stated preflight
  result after each D-4 step, redispatch and patch bump.
  The GHCR double models package versions keyed by digest; deleting a package
  version removes every tag on that digest. The npm double models versions,
  time, dist-tags, tarballs and attestations, including uncertain publish
  success. The fake Docker writes buildx metadata and captures exact argv.
  Test placeholder defaults only, main HEAD unchanged and
  advanced, uncertain npm success that did publish, and failed read-back.
  Assert no deletion or republish after npm accepted the version.
  Verified by: `tests/release.test.ts`,
  `F-024 v3 stable release and recovery rehearsal: %s` and
  `BR-354 v2 stable release procedure preserves owner gates`.
- **AC-33 (BR-355 v1, BR-356 v2, BR-357 v2, BR-358 v2, BR-375 v2; unchanged BR-360 v1 through
  BR-362 v1, BR-371 v1, BR-378 v1)** — Given the workflow and stable input
  fixtures, when workflow policy and release checks run, then approvals,
  least permissions, job order, tagged dispatched main HEAD, CI evidence and
  environment protections remain required. Given a mutation removing a gate,
  when its test runs, then it fails. Verified by:
  `tests/release-policy.test.ts`, existing workflow mutation tests,
  `BR-356 v2 BR-358 v2 stable digest plumbing: %s`,
  `BR-375 v2 release target variables: %s`, and
  `tests/release.test.ts`, `F-024 v3 stable release retains existing gates: %s`.

- **AC-34 (v3 acceptance on main; unchanged gates)** — Given the merged
  implementation on the actual main SHA, when the local gate and main CI
  finish, then record their results and every v3 AC mapping in #89. After
  AC-32 rehearsal passes, the owner runs three `dry_run=false` wiring probes
  from main: unsupported `1.0.0-rc.1` with main SHA; a valid but deliberately
  mismatched stable version greater than every published version with main
  SHA; and that version with main's parent SHA. No matching release tag is created. The first fails with
  `unsupported release version`; the second fails version and tag checks;
  the third also fails with `sha is not the dispatched commit`. All stop in
  `verify`, request no deployment approval and publish nothing. Record npm
  and GHCR read statuses and both environment endpoint results. Probe 2
  requires `ok` on stable npm preflight, both GHCR 404 checks and
  both environment endpoint checks. Otherwise stop for the owner. Unexpected
  registry or environment access stops acceptance for owner resolution.
  Record sanitized run evidence and the actual main SHA in #89. No probe
  is authorized by this draft revision task.
- **AC-35 (BR-354 v2; per-release gate)** — Given a tagged release commit
  at main HEAD, when the owner gives the release go, then the release ticket
  records a successful real `dry_run=true` dispatch for that exact version
  and SHA, with `verify` passed and all other jobs skipped, before any
  `dry_run=false` dispatch. Record both owner deployment approvals and full
  read-back evidence for the real run. Recheck this gate for every release,
  including a recovered redispatch or a new patch version. This is separate
  from #89 acceptance. Verified by: ordered release-ticket evidence.

- **AC-36 (BR-370 v2; one-time implementation check)** — Given a throwaway
  local registry, when real buildx pushes `<version>` and `latest` in one
  build with `--metadata-file`, then record the metadata file and assert
  `sha256(GET index body)` equals `containerimage.digest` for both tags.
  Use the BR-363 v2 Accept list. Produce an image index. Build both
  platforms if feasible; otherwise document the platform limit and keep
  attestations so the single-platform build still produces an image index.
  Derive the fake-Docker metadata fixture from
  this recorded sample. Verified by: commands, exit statuses, metadata,
  both raw-body hash comparisons and any platform limit in a sanitized
  implementation PR comment. This check uses no public registry and does
  not authorize the first stable publication.

## Decisions

- **D-1 First stable only.** Apply the owner narrowing of 2026-11-16.
  #6 chooses 1.0.0. Stable syntax is general, but the registry gate accepts
  it only while latest is the exact deprecated placeholder and neither npm
  `versions` nor `time` contains a stable version other than that placeholder.
  Resetting latest cannot reopen publication. There is no emergency path.
  Reject `next`
  promotion as an extra write. Later stable, beta after stable, deprecated
  stable recovery and GHCR latest repointing move to #91 (F-024 v4).
- **D-2 One workflow.** Select tags from validated inputs. Reject a separate
  workflow because approval and credential policy could drift.
- **D-3 Both defaults move once.** Build both stable tags together. Before
  push, GHCR latest must be 404. Reject accepting an existing default as
  partial publication could be hidden. Keep digest pinning. Beta has no new
  ordering or registry checks before first stable.
- **D-4 Owner-only first-stable recovery.** Registries cannot switch atomically.
  For image pushed but npm failed, confirm npm has no candidate version in
  either versions or time. Uncertain evidence stops recovery. At this step,
  fresh verify/image preflight is **blocked: image exists**; phase npm can
  pass only with this run's digest and all unchanged gates.
  The first option is for the owner to re-run the failed `publish-npm` job
  within the same run ("Re-run failed jobs" or that job alone, never "Re-run
  all jobs"), with the same image digest and every gate checked again.
  GitHub may reuse the approval already granted to this job; the owner's
  re-run is then the publication go. The behaviour observed at first
  occurrence is recorded in `docs/observations/`. AC-32 rehearses the re-run
  as a harness simulation. Re-run is unavailable if GitHub's re-run window
  expired, `main` advanced so a commit gate fails, run evidence is
  uncertain, the run was cancelled, its artifacts are gone, or "Re-run all
  jobs" was used (verify then fails because the image exists). If that
  re-run is unavailable, the owner deletes the GHCR candidate **package version**,
  not one tag. The guide
  identifies it by the digest in `release-image: image digest sha256:<hex>`
  and its exact `<version>` and `latest` tags.
  Both tags share a digest, so this removes both tags. Until read-back of
  deletion confirms absence, preflight is **blocked: cleanup unconfirmed**.
  The owner confirms candidate and latest both GET 404. Registry preflight
  is now **ready: placeholder and both tags absent**, subject to other gates.
  Redispatch after a new successful dry run only while the commit is main
  HEAD. If main advanced, state is **blocked: old commit is not main HEAD**;
  prepare a patch bump on main with its own tag, go and dry run. Cleanup is
  required before either new-dispatch choice. No repointing or previous
  stable exists in this scope. Agents never touch registries. The guide must give these
  explicit steps, with no loop over an empty `$previous` value.
  If npm accepted the version, state is **blocked for publication: see #91**;
  never delete or republish it. Verify manually if read-back was skipped;
  rerun only read-back if it failed. Uncertain image outcomes require the
  same GET confirmation. Reject automatic rollback as owner-only destruction.
- **D-5 Install documentation follows VERSION.** Stable BR-354 v2 install
  clauses apply only once VERSION is stable. Keep beta v1 text until then.
  README/SPEC edits move to #6 release prep. Guide edits belong to the
  implementation PR. Reject changing default installs in this spec phase.
- **D-6 Keep IDs and evidence.** Version existing rules because their purpose
  is unchanged. Keep BR-379 v1: its digest rule already applies to either
  release kind. Prepare pending records in implementation and accept them
  only on the actual main SHA. Keep the v2 snapshot byte-for-byte unchanged.

## Open questions

## Residual risks

- **Mutable default image tag** — GHCR `latest` is mutable and is not
  protected by the `release` environment approval. Any same-repository
  workflow with `packages: write` can overwrite it. This extends v2 accepted
  risk (a) to the default tag. The guide recommends pinning by digest.
  Status: accepted by the owner on 2026-11-16 (#89).
- **Registry timing gap** — GHCR `latest` may serve 1.0.0 before npm does,
  until npm publishes or D-4 cleanup finishes. Registries cannot switch
  atomically.
  Status: accepted by the owner on 2026-11-16 (#89).
- **No gated release yet** — After 1.0.0, no gated release of any kind
  (stable or beta) is available until #91. Resetting npm `latest` does not reopen
  the gate.
  Status: accepted by the owner on 2026-11-16 (#89).
- **Unsigned image** — 1.0.0 ships an unsigned GHCR image. Signing is
  deferred to #92. Digest pinning remains recommended.
  Status: accepted by the owner on 2026-11-16 (#89).
- **First live stable steps** — Stable-only workflow steps first run live
  on 1.0.0. AC-32 rehearses them against doubles. AC-36 mitigates the buildx
  metadata risk with a real two-tag local-registry push and a derived fixture.
  If these mitigations still fail before npm accepts 1.0.0, the fix commit
  forces `1.0.1`; after npm accepts it, D-4 applies and publication is
  blocked until #91.
  Status: accepted by the owner on 2026-11-16 (#89, second decision comment).

## Stress-test

Review `89-spec-review-6-opus`:

- **Review 6, finding 1: retained** — Scoped #91 refusal and precedence to
  `release-check`. Added the AC-26/AC-31 stable read-back fixture for D-4.
- **Review 6, finding 2: retained** — Recorded the second owner decision,
  AC-36 and AC-32 mitigations, and the required `1.0.1` after a fix commit.
- **Review 6, finding 3: retained** — The registry gap lasts until npm
  publishes or D-4 cleanup finishes, without a time bound.
- **Review 6, finding 4: retained** — Listed every unavailable re-run case
  in D-4.
- **Review 6, finding 5: retained** — Pinned the metadata refusal diagnostic
  and zero beta or dry-build stdout digest lines in AC-30.
- **Review 6, finding 6: retained** — AC-36 requires an image index and
  keeps attestations for a single-platform fallback.
- **Review 6, finding 7: retained** — AC-34 probe 2 exceeds every published
  version and requires both environment endpoint checks.
- **Review 6, finding 8: retained** — The residual risk excludes every
  gated release, stable or beta, until #91.

Decision pass `89-spec-decision-1-fable`:

- **Decision pass 1, finding 1: retained** — Added owner-accepted residual
  risks, signing deferral to #92 and the BR-354 v2 mutable-tag warning.
- **Decision pass 1, finding 2: retained** — Added AC-36 real buildx two-tag
  check, recorded metadata and hashes in a PR comment, and derived fixture.
- **Decision pass 1, finding 3: retained** — D-4 prefers same-run npm re-run
  with renewed gates and approval. AC-32 rehearses it. Beta D-8 stays verbatim.
- **Decision pass 1, finding 4: retained** — Stable history refuses every
  release even after latest resets. AC-26 covers both history objects.
- **Decision pass 1, finding 5: retained** — Pinned stable build stdout
  digest and guide identification of the package version by digest and tags.
- **Decision pass 1, finding 6: retained** — Refused verify/image input
  digests. Pinned output counts and JSON metadata parsing refusal cases.
- **Decision pass 1, finding 7: retained** — AC-34 probe 2 requires npm,
  both GHCR absence checks and environment check to report ok.

Round-1 decisions superseded by the owner narrowing:

- **Round 1, finding 1: retained in part** — Stable ordering still covers all
  published versions. Comparing against a prior stable latest moves to #91.
- **Round 1, finding 2: superseded** — Prior stable latest is refused. Phase
  npm binds only the first-stable pair to this run.
- **Round 1, finding 3: superseded** — Delete the package version and confirm
  both tags absent. Prior-default restoration moves to #91.
- **Round 1, finding 4: superseded** — Install defaults follow VERSION and
  change only in #6 release prep.
- **Round 1, finding 5: retained in part** — Metadata binds stable only.
- **Round 1, finding 6: retained** — Stable comparisons use identical GET Accept.
- **Round 1, finding 7: superseded** — All publication after placeholder latest
  moves to #91. No beta-after-stable path remains.
- **Round 1, finding 8: retained** — Pin diagnostics and remove legacy messages.
- **Round 1, finding 9: retained** — Accepted v1 remains beside pending v2.
- **Round 1, finding 10: retained** — No new IDs; recheck before freeze and PR.
- **Round 1, finding 11: retained in part** — Keep doubles, main acceptance and
  per-release gates. Remove later-stable cases and early install edits.
- **Round 1, finding 12: retained in part** — v2 D-8 remains recovery provenance;
  first-stable cleanup is now the explicit D-4 procedure.

- **Round 2, finding 1: retained** — Guide changes are implementation work.
  The orchestrator already reverted the spec-phase guide edit.
- **Round 2, finding 2: retained** — Split the phase matrix by kind. Beta v2
  behavior, including dry-run 404, stays unchanged before first stable.
- **Round 2, finding 3: retained** — Ignore exactly created/modified time keys;
  reject every other non-SemVer key with a fixed diagnostic.
- **Round 2, finding 4: retained** — Delete the package version, removing both
  shared-digest tags; confirm both 404. Repointing moves to #91.
- **Round 2, finding 5: moved to #91** — Deprecated stable latest refuses all
  publication. Its recovery is outside first stable.
- **Round 2, finding 6: retained** — Pin refused inputs and every new read-back
  line in the diagnostics table and named tests.
- **Round 2, finding 7: retained** — Stable install clauses require stable
  VERSION; README/SPEC edits belong to #6 release prep.
- **Round 2, finding 8: retained** — Explicit first-stable cleanup has no
  previous-tag loop and no empty `$previous` case.
- **Round 2, finding 9: retained** — Scope names Makefile targets, image
  metadata parsing and workflow job outputs.
- **Round 2, finding 10: retained** — Stable must exceed published betas;
  unpublished betas below existing betas keep v2 behavior before stable.

- **Round 3, finding 1: retained** — Added exact v2 deltas for BR-356,
  BR-357, BR-358 and BR-375. Pinned digest recipients, beta validation and
  the AC-30/AC-33 policy test names.
- **Round 3, finding 2: retained** — Pinned reused stable failures, phase
  npm digest reasons and precedence of the #91 refusal.
- **Round 3, finding 3: retained** — Excluded the three beta-only condition
  lines from stable read-back.
- **Round 3, finding 4: retained** — Assigned the synthetic stable-VERSION
  fixture to #89 and real README/SPEC checks to stable VERSION in #6.
- **Round 3, finding 5: retained** — Merged duplicate install-edit ownership
  and BR-355 statements. Removed the blank line in the Out of scope list.
- **Round 4 (diff-only), findings 1–3: retained** — A GHCR token failure in
  stable phase `npm` keeps the v1 token diagnostic; the #91 refusal takes
  precedence over every other npm condition once the npm document is
  readable; BR-370 v2 forwards the image output (empty for beta).
- **Review 7 (diff-only), finding 1: retained** — The forced `1.0.1` applies
  only before npm accepts 1.0.0; afterwards D-4 applies until #91. Finding 2:
  `make format-check` passes; no change.

- **Decision pass 2 (confirmation), findings 1–2: retained** — A same-run
  re-run is owner-only, agents never re-run a release job, and GitHub may
  reuse the earlier approval (observed behaviour recorded at first
  occurrence; AC-32 is a harness simulation). The guide forbids "Re-run all
  jobs", listed as an unavailable case.

Frozen on 2026-11-16 (autonomous freeze, PROJECT.md D-1) after
`89-spec-review-7-opus` (strong tier, approve) and
`89-spec-decision-2-fable` (strongest tier, approve), with the two
decision-pass minors folded in; freeze record on #89.

---
id: F-024
title: Gated beta and stable publication
ticket: "#89"
status: draft
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
Runtime behavior and the beta path stay unchanged.

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

- Extend input validation in `scripts/release.ts` and
  `scripts/release-image.sh` to accept stable versions.
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
  `F-024 v3`, status `pending acceptance`, updated verification and History.
  Update the BR index, spec index, capability map and Unreleased changelog
  entry as needed. Final acceptance markers follow AGENTS.md §6.

### Out of scope

- The `1.0.0` version bump, CHANGELOG promotion and README version strings.
  These belong to the release-preparation PR of #6.
- Any publication, tag creation, real workflow dispatch or deployment approval.
- A GitHub Release object, a separate stable workflow, or automatic dispatch.
- Changes to owner preconditions P-0 through P-5. Their text and order remain
  those in the v2 snapshot and `docs/publishing.md`. No new owner precondition
  is needed. Stable registry checks are automated gates, not a new manual step.
- Changes to `ci.yml`, `runner-acceptance.yml`, runtime code or dependencies.
- Enabling beta releases after npm `latest` has moved to a stable release.
  The existing beta placeholder checks remain unchanged in this version.

## Business rules

These are proposed replacement texts. BR files are not edited in this task.
All eight affected rules currently have version 1. Their purpose stays the
same, so each becomes version 2. No new BR ID is allocated. The supplied
inventory ends at BR-430; the local `main` ref is older and ends at BR-340.
Recheck the actual main branch before freeze and PR creation. Do not reuse
withdrawn BR-376 or BR-377.

### Changed rules

- **BR-354 v2** — The v1 naming, tarball references, installation examples,
  precondition order and commands, dry-run evidence and dispatch instructions
  remain unchanged. `docs/publishing.md` states that `1.0.0` is the first
  stable release, published directly with npm `latest` and GHCR `<version>`
  and `latest`; beta publishes use npm `beta` and only GHCR `<version>`.
  npm `latest` stays on the deprecated placeholder until the first stable
  release. Image pinning by the printed manifest digest remains recommended.
  The release procedure documents BR-363 v2 preflight and BR-372 v2 /
  BR-373 v2 read-back for each release kind. Stable recovery follows D-4
  below; the v1 beta recovery instructions remain unchanged.
  Verified by: AC-24, AC-32.
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
  input-only failure output and exit 1 remain unchanged.
  Verified by: AC-25.
- **BR-363 v2** — `release-check` keeps all v1 beta checks unchanged. For a
  stable version, in both dry-run modes and every phase, npm must return 200
  with readable `versions` and `time` objects. Neither object contains the
  proposed version. `dist-tags.latest` names either the exact
  `0.0.0-placeholder.0` version with a non-empty `deprecated` string, or an
  existing stable version strictly lower than the proposed version. A stable
  version here has the BR-359 v2 stable form. Compare major, then minor, then
  patch as exact non-negative integers; the first unequal component decides.
  Do not compare strings or use lossy numeric conversion. Equality, a higher
  version, metadata, any other pre-release, a dangling or missing tag and
  unreadable documents fail closed. The placeholder version remains present
  and deprecated even when `latest` names an older stable release.

  GHCR keeps the v1 authenticated pull-token and status handling. In phases
  `verify` and `image`, `<version>` must return 404. If npm `latest` is the
  placeholder, GHCR `latest` must return 404. If npm `latest` is an older
  stable version, that GHCR version and GHCR `latest` must both return 200
  and resolve to the same manifest digest. Thus GHCR `latest` cannot name an
  unrelated image before a stable push. In phase `npm`, the image has already
  been pushed: `<version>` and `latest` must both return 200 and resolve to
  the same manifest digest. The npm version must still be unpublished and
  its previous `latest` must still pass the checks above. Missing digests,
  malformed manifests, unexpected statuses and token failures fail closed.
  Manifest digests are SHA-256 hashes of the raw manifest response bytes,
  using the same accepted index media types for both tags.
  These checks run before each publish step, alongside BR-378 v1.
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
  beta uses one. Logout still runs on exit, including build failure.
  Verified by: AC-30.
- **BR-372 v2** — After BR-359 v2 validation, npm read-back keeps the v1
  retry limit of 20 attempts, 15 seconds apart, until all npm conditions
  hold. For beta, the v1 conditions remain unchanged. For stable,
  `versions[<version>]` exists and records the exact release version;
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
  200 and resolve to the same manifest digest. An anonymous token request
  and anonymous manifest HEAD must succeed for both stable references.
  Digest equality means both tags serve the checked two-platform index.
  The printed line remains `release-verify: image digest sha256:<hex>`.
  Fixed per-condition output and success only when every condition holds
  remain unchanged.
  Verified by: AC-31.

### Unchanged rules and gates

BR-353 v1, BR-355 v1 through BR-358 v1, BR-360 v1 through BR-362 v1,
BR-364 v1 through BR-367 v1, BR-371 v1, BR-374 v1, BR-375 v1,
BR-378 v1 and BR-379 v1 retain their accepted texts. BR-016 v3 and
BR-178 v3 remain unchanged. This spec does not restore the withdrawn rules
or any dependency rule superseded by later features.

In particular, an owner go names the version and commit. A successful real
`dry_run=true` dispatch of that same pair and its recorded run evidence are
required before `dry_run=false`. Both publish jobs still need `release`
environment approval. The tagged release commit is `main` HEAD at dispatch,
equals `GITHUB_SHA`, and has successful `ci-result` evidence on `main`.
The trusted workflow checks out the dispatched SHA, not the untrusted input.
Environment protection is checked in every phase. Agents never dispatch a
real run or approve a deployment. GHCR publishes before npm. Permissions,
credential isolation, endpoint override refusal in CI and safe output remain
unchanged. Verified by: AC-32, AC-33.

### BR record preparation

For each changed rule, preserve its v1 History and append this line in the
implementation PR, replacing `<summary>` with the text below:

`- v2 — 2026-11-16 — F-024 v3 (#89) — <summary>; pending acceptance`

| Rule      | Summary                                            |
| --------- | -------------------------------------------------- |
| BR-354 v2 | Document stable tags, checks and recovery          |
| BR-359 v2 | Accept stable inputs without metadata              |
| BR-363 v2 | Check stable ordering and phase-specific tag state |
| BR-368 v2 | Map stable releases to both latest tags            |
| BR-369 v2 | Select the npm publish tag by release kind         |
| BR-370 v2 | Push both stable image tags from one build         |
| BR-372 v2 | Verify stable npm latest and preserved placeholder |
| BR-373 v2 | Verify stable image tag equality and public access |

## Acceptance criteria

AC-01 through AC-23 remain historical evidence for v2. The criteria below
cover v3. All listed new test names are planned, not implemented or passing.
Use versioned BR citations in those tests. Tests run through `make check`.

- **AC-24 (BR-354 v2)** — Given the updated publishing guide, when its
  contract test reads it, then it describes direct `1.0.0` stable publication,
  beta and stable tag mappings, stable preflight, full read-back, digest
  pinning and unchanged P-0 through P-5. Verified by:
  `tests/release.test.ts`, `BR-354 v2 publishing guide covers stable and beta`.
- **AC-25 (BR-359 v2)** — Given each release entry point, when versions
  `1.0.0`, `1.2.3`, `0.0.0` and `0.6.0-beta.2` are supplied with other valid
  inputs, then validation passes. Given leading zeros, whitespace, `v1.0.0`,
  alpha, rc, incomplete beta, extra beta components, or build metadata on
  stable or beta, when validation runs, then it fails before any child,
  Docker call or request. Invalid SHA, boolean and phase still fail before side effects.
  Verified by: `tests/release.test.ts`,
  `BR-359 v2 accepts stable and beta inputs: %s` and
  `BR-359 v2 refuses inputs before side effects: %s`.
- **AC-26 (BR-363 v2)** — Given an unpublished stable candidate and the
  deprecated exact placeholder or an older stable npm `latest`, when
  preflight runs in either dry-run mode, then npm checks pass. Given a
  missing, dangling, malformed, pre-release, metadata-bearing, equal or newer
  `latest`, a missing deprecation on the placeholder, an unreadable document,
  non-200 response, or candidate in either `versions` or `time`, when it
  runs, then npm checks fail. Ordering cases include `1.9.9 < 1.10.0`,
  `1.10.9 < 1.11.0`, `1.99.99 < 2.0.0`, equality, reverse order and integers
  beyond JavaScript's safe integer range. Verified by:
  `tests/release.test.ts`, `BR-363 v2 stable npm preflight: %s`.
- **AC-27 (BR-363 v2)** — Given phase `verify` or `image`, when the candidate
  GHCR version is absent and `latest` is absent for the placeholder, or equals
  the older npm stable version's digest, then preflight passes. Given an
  existing candidate, unexpected `latest`, mismatched digest, missing older
  stable image, token failure or unexpected status, when preflight runs,
  then it fails. Verified by: `tests/release.test.ts`,
  `BR-363 v2 stable image preflight: %s`.
- **AC-28 (BR-363 v2)** — Given phase `npm` after a stable push and npm still
  on its valid previous `latest`, when both GHCR tags name the same digest,
  then preflight passes. Given either tag missing or the digests different,
  when preflight runs, then it fails before npm publication. Verified by:
  `tests/release.test.ts`, `BR-363 v2 stable npm phase image check: %s`.
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
- **AC-30 (BR-368 v2, BR-370 v2)** — Given fake Docker, when a real stable
  image build runs, then one push builds both platforms with exactly the
  version and `latest` tags, existing labels and stdin login. Given beta,
  when it runs, then there is only the version tag. Given either kind in dry
  run, when it runs, then no login, tag or push occurs. Given a failed real
  build, when it exits, then logout still runs. Verified by:
  `tests/release.test.ts`, `BR-368 v2 BR-370 v2 image argv: %s`.
- **AC-31 (BR-372 v2, BR-373 v2, BR-379 v1)** — Given stable registry
  doubles serving the exact version through npm `latest`, with provenance,
  expected tarball digest, deprecated placeholder, and equal public GHCR
  digests with both platforms, when read-back runs, then it succeeds and
  prints the image digest. Given each missing or mismatched condition in
  turn, including anonymous access denied on either image tag, when
  read-back runs, then it fails. Given delayed npm consistency, when the
  conditions appear within 20 attempts, then it succeeds; otherwise it fails
  after attempt 20. Beta read-back expectations remain unchanged. Verified
  by: `tests/release.test.ts`, `BR-372 v2 stable npm read-back: %s`,
  `BR-373 v2 stable image read-back: %s`, and the existing
  `BR-372 BR-373 read-back: %s` beta cases.
- **AC-32 (BR-354 v2; unchanged gates)** — Given the stable procedure and
  test doubles, when an end-to-end rehearsal runs dry-run verification,
  simulated owner approvals, image publication, npm publication and
  read-back, then it confirms the order, exact tags and shared digests.
  Given image-only success, uncertain npm success or failed read-back, when
  the documented recovery is rehearsed, then it follows D-4 without blind
  republishing or automatic cleanup. The guide requires owner go and a green
  real dry run for the same version and commit before real dispatch.
  Verified by: `tests/release.test.ts`,
  `F-024 v3 stable release and recovery rehearsal: %s` and
  `BR-354 v2 stable release procedure preserves owner gates`.
- **AC-33 (unchanged BR-355 v1 through BR-358 v1, BR-360 v1 through
  BR-362 v1, BR-371 v1, BR-378 v1)** — Given the workflow and stable input
  fixtures, when workflow policy and release checks run, then approvals,
  least permissions, job order, tagged dispatched main HEAD, CI evidence and
  environment protections remain required. Given a mutation removing a gate,
  when its test runs, then it fails. Verified by:
  `tests/release-policy.test.ts`, existing workflow mutation tests, and
  `tests/release.test.ts`, `F-024 v3 stable release retains existing gates: %s`.

## Decisions

- **D-1 Direct stable release.** Follow the owner decisions of 2026-11-16
  on #6. Publish `1.0.0` directly under npm `latest`. Reject publishing stable
  under `next` first: it adds an unrequested promotion step and another write.
  This spec accepts stable syntax generally; #6 chooses the first version.
- **D-2 One workflow.** Reuse the existing workflow and select tags from the
  validated version. Reject a separate stable workflow: it duplicates the
  approval and credential policy and can drift from it.
- **D-3 Both defaults move.** Push GHCR `latest` and the version from one
  two-platform build. Reject leaving GHCR `latest` untouched: it conflicts
  with the owner decision and would leave the registries' defaults divergent.
  Keep digest pinning advice because tags can move. Before the image push,
  require GHCR's default to agree with the prior npm stable release, or be
  absent for the placeholder. Reject accepting any arbitrary old GHCR default:
  it could hide a partial prior publication. Stable dry runs check this state
  too; they do not use beta's npm-404 exemption.
- **D-4 Partial publication is possible.** Keep GHCR before npm. The two
  registries cannot switch atomically. GHCR `latest` may move before npm
  publishes. If only the image succeeds, retry only `publish-npm` after
  checking npm is unpublished, both image tags agree, and all existing gates
  still pass. If npm reports failure, inspect the registry before retrying.
  If npm accepted the version, verify by read-back or by hand; never publish
  it again. If npm succeeded but read-back failed, rerun only read-back.
  Stable manual checks resolve npm `latest` and the exact version, provenance,
  tarball digest and placeholder deprecation, then inspect both GHCR tags,
  platforms and anonymous access. If the same-run retry is unavailable or
  gates no longer pass, stop for an owner recovery decision. Do not blindly
  delete a version, restore `latest`, or dispatch again. A partial image push
  can also move only one tag; preflight refuses that state. Reject automatic
  rollback or cleanup: it risks overwriting another release and needs a
  separate owner authorization. The stable guide replaces beta-only advice
  about deleting a GHCR version and redispatching with this recovery path.
- **D-5 Preserve beta.** Do not relax beta placeholder or read-back checks.
  A beta after stable remains refused by the current preflight contract.
  Enabling that later needs a separate versioned change. No P-0 through P-5
  change is needed for direct stable publication.
- **D-6 Keep IDs and evidence.** Version existing rules because their purpose
  is unchanged. Keep BR-379 v1: its digest rule already applies to either
  release kind. Prepare pending records in implementation and accept them
  only on the actual main SHA. Keep the v2 snapshot byte-for-byte unchanged.

## Open questions

## Stress-test

Independent review is pending. No approval or freeze is claimed.

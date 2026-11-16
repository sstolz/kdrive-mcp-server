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
Runtime behavior stays unchanged. Betas remain available after the first stable
release under the ordering and tag rules below.

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
  `F-024 v3`, a pending v2 section, updated verification and History.
  Keep v1 as the accepted rule until v2 acceptance.
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

## Business rules

These are proposed replacement texts. BR files are not edited in this task.
All eight affected rules currently have version 1. Their purpose stays the
same, so each becomes version 2. No new BR ID; re-check the next free IDs
before freeze and before the PR. Never reuse withdrawn IDs.

### Changed rules

- **BR-354 v2** — The v1 naming, tarball references,
  precondition order and commands, dry-run evidence and dispatch instructions
  remain unchanged. `docs/publishing.md` states that `1.0.0` is the first
  stable release, published directly with npm `latest` and GHCR `<version>`
  and `latest`; beta publishes use npm `beta` and only GHCR `<version>`.
  npm `latest` stays on the deprecated placeholder until the first stable
  release. From the first stable release, the default install is
  `npm install -g @sstolz/kdrive-mcp-server`. Exact execution uses
  `npx -y @sstolz/kdrive-mcp-server@<version>`. Advise users to pin an exact
  version. Betas remain installable with `@beta` or an exact version.
  Image pinning by the printed manifest digest remains recommended.
  The release procedure documents BR-363 v2 preflight and BR-372 v2 /
  BR-373 v2 read-back for each release kind. Stable recovery follows D-4
  below. The recovery cases derive from
  [features/history/F-024-v2.md D-8](history/F-024-v2.md#decisions),
  with the stable GHCR default restoration added here.
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
- **BR-363 v2** — In both dry-run modes and every phase, npm must return
  200 with readable `versions` and `time` objects. Neither object contains
  the candidate. A stable candidate is strictly greater, under SemVer
  precedence, than every published version in either object except exactly
  `0.0.0-placeholder.0`, and than npm `latest`. Include published betas in
  this comparison. Compare numeric components as exact integers, without
  lossy conversion. Build metadata does not change precedence.
  The exact placeholder remains present with a non-empty `deprecated` string.
  npm `latest` names that placeholder or an existing, non-deprecated stable
  version. A deprecated stable `latest` fails closed for owner recovery;
  it is never a placeholder. Missing, dangling, malformed, metadata-bearing
  or other pre-release `latest` values fail closed. Unreadable documents
  and unexpected statuses fail closed.
  A beta retains the other v1 checks, but may follow a stable release only
  when its SemVer precedence is greater than the stable npm `latest`.
  A beta never moves npm `latest`. Only `0.0.0-placeholder.0` qualifies as
  the placeholder, even if another version is deprecated.

  GHCR keeps the v1 authenticated pull-token and status handling. In phases
  `verify` and `image`, `<version>` must return 404. If npm `latest` is the
  placeholder, GHCR `latest` must return 404. If npm `latest` is an older
  stable version, that GHCR version and GHCR `latest` must both return 200
  and resolve to the same manifest digest. Thus GHCR `latest` cannot name an
  unrelated image before a stable push. In phase `npm`, the image has already
  been pushed: `<version>` and `latest` must both return 200 and resolve to
  this run's pushed manifest digest. In phase `npm`, re-run only the npm
  conditions above on the previous `latest` plus this new GHCR pair check.
  Do not re-run the pre-push GHCR absence or prior-image comparison checks.
  Missing digests,
  malformed manifests, unexpected statuses and token failures fail closed.
  Manifest digests are SHA-256 hashes of the raw manifest response bytes,
  using GET for every compared tag with the identical Accept list:
  `application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`.
  Never derive a comparison digest from HEAD. A HEAD-only digest cannot pass.
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
  beta uses one. The real build writes a buildx `--metadata-file`.
  Validate its `containerimage.digest` as `sha256:<64 lowercase hex>` and
  expose it as the `publish-image` job output `image_digest`.
  Pass that output as `RELEASE_IMAGE_DIGEST` only to phase `npm` and
  `read-back`; add `publish-image` to read-back dependencies. Reject a missing
  or malformed digest before image requests. Dry builds produce no digest
  requirement. Logout still runs on exit, including build failure.
  Verified by: AC-30, AC-31, AC-32.
- **BR-372 v2** — After BR-359 v2 validation, npm read-back keeps the v1
  retry limit of 20 attempts, 15 seconds apart, until all npm conditions
  hold. For beta, `beta` names the candidate and `latest` remains the exact
  deprecated placeholder or a non-deprecated stable version lower than the
  candidate; publication never changes that prior `latest`. Other v1 beta
  conditions remain unchanged. For stable,
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
  200 and resolve to exactly `RELEASE_IMAGE_DIGEST` from this run.
  Beta version read-back also equals this run's digest. An anonymous token request
  and anonymous manifest HEAD must succeed for both stable references.
  Digest comparisons use GET and the BR-363 v2 Accept list. HEAD is only
  an anonymous access check. Both stable tags must serve the checked index.
  Binding both tags to this run is mandatory, not a residual risk.
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

Follow the BR-016/BR-178 versioning pattern. Preserve the full accepted v1
text and evidence. Label v2 pending acceptance and state: "v1 stays the
accepted rule until acceptance". A file-level pending marker must not hide
v1's accepted status. Prepare the v2 front matter and separate version sections
without claiming v2 active. Append this History line in the implementation
PR, using that PR's date and the summary below:

`- v2 — <implementation-PR-date> — F-024 v3 (#89) — <summary>; pending acceptance, v1 stays the accepted rule until acceptance`

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
  pinning and unchanged P-0 through P-5. Pin these exact guide strings:
  `1.0.0 is the first stable release`,
  `npm install -g @sstolz/kdrive-mcp-server`,
  `npx -y @sstolz/kdrive-mcp-server@<version>`,
  `Pin an exact version`, `Betas remain installable with @beta or an exact version`,
  `Stable: npm latest; GHCR <version> and latest`,
  `Beta: npm beta; GHCR <version> only`, and
  `Agents never perform registry deletion`.
  In `tests/release-policy.test.ts`, rename
  `BR-354 documentation uses the scoped name` to
  `BR-354 v2 documentation uses the scoped name`. Replace its default README
  expectation `npm install -g @sstolz/kdrive-mcp-server@beta` with the default
  install string above. Replace its SPEC line prefix
  `npx @sstolz/kdrive-mcp-server` with the exact versioned `npx -y` command
  above. Keep explicit beta examples as beta examples. Replace old recovery
  string assertions with the steps in D-4 and the guide. Verified by:
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
  beyond JavaScript's safe integer range. With published `0.6.0-beta.2`,
  refuse stable `0.5.0`, equality with an already published `0.5.0`, and
  the already published `0.6.0-beta.2`; accept stable `0.6.0` and `1.0.0`.
  Refuse `0.0.0`. After stable `1.0.0`, accept `1.1.0-beta.1` without
  moving `latest`; refuse `1.0.0-beta.1`. Refuse deprecated stable `latest`
  and any substitute deprecated placeholder. Verified by:
  `tests/release.test.ts`, `BR-363 v2 stable npm preflight: %s`.
- **AC-27 (BR-363 v2)** — Given phase `verify` or `image`, when the candidate
  GHCR version is absent and `latest` is absent for the placeholder, or equals
  the older npm stable version's digest, then preflight passes. Given an
  existing candidate, unexpected `latest`, mismatched digest, missing older
  stable image, token failure or unexpected status, when preflight runs,
  then it fails. Record GET and the identical Accept header for both tags.
  A double offering equal HEAD digests but different GET bodies must fail.
  Verified by: `tests/release.test.ts`,
  `BR-363 v2 stable image preflight: %s`.
- **AC-28 (BR-363 v2)** — Given phase `npm` after a stable push and npm still
  on its valid previous `latest` (placeholder or older stable `1.0.0`
  before candidate `1.0.1`), when both GHCR tags name this run's digest,
  then preflight passes without the old-image comparison. Given either tag
  missing, different digests, both tags equal to another run's digest, or
  missing/malformed `RELEASE_IMAGE_DIGEST`,
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
  build, when it exits, then logout still runs. Given a successful push,
  when buildx metadata is read, then its digest is validated, exported and
  passed to npm and read-back. Missing or malformed metadata stops the
  dependent jobs. Verified by:
  `tests/release.test.ts`, `BR-368 v2 BR-370 v2 image argv: %s`.
- **AC-31 (BR-372 v2, BR-373 v2, BR-379 v1)** — Given stable registry
  doubles serving the exact version through npm `latest`, with provenance,
  expected tarball digest, deprecated placeholder, and this run's public GHCR
  digests with both platforms, when read-back runs, then it succeeds and
  prints the image digest. Given each missing or mismatched condition in
  turn, including anonymous access denied on either image tag, when
  read-back runs, then it fails. Given delayed npm consistency, when the
  conditions appear within 20 attempts, then it succeeds; otherwise it fails
  after attempt 20. Beta read-back uses the updated stable-default conditions above. Verified
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
  Apply every D-4 recovery step to the doubles through an owner-only harness
  action, never an agent registry command. Assert each stated preflight
  result after cleanup, default restoration, redispatch and patch bump.
  Test both placeholder and older stable defaults, main HEAD unchanged and
  advanced, uncertain npm success that did publish, and failed read-back.
  Assert no deletion or republish after npm accepted the version.
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

- **AC-34 (v3 acceptance on main; unchanged gates)** — Given the merged
  implementation on the actual main SHA, when the local gate and main CI
  finish, then record their results and every v3 AC mapping in #89. After
  AC-32 rehearsal passes, the owner runs three `dry_run=false` wiring probes
  from main: unsupported `1.0.0-rc.1` with main SHA; a valid but deliberately
  mismatched stable version with main SHA; and that version with main's
  parent SHA. No matching release tag is created. The first fails with
  `unsupported release version`; the second fails version and tag checks;
  the third also fails with `sha is not the dispatched commit`. All stop in
  `verify`, request no deployment approval and publish nothing. Record npm
  and GHCR read statuses and both environment endpoint results. Unexpected
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
- **D-4 Partial publication is possible.** Keep GHCR before npm. Follow
  [features/history/F-024-v2.md D-8](history/F-024-v2.md#decisions) for
  reported npm failure, skipped read-back, failed read-back and image-only
  recovery. The registries cannot switch atomically. Use the owner-run
  procedure in `docs/publishing.md` below for stable cleanup. Agents never
  perform registry deletion. First confirm npm lacks the exact version;
  unavailable or uncertain npm evidence stops recovery. While the image
  exists, `verify` and `image` preflight fail. Same-run `publish-npm` retry
  passes only if both tags still equal this run's digest and all gates pass.
  Otherwise the owner deletes the GHCR version tag. Preflight still fails
  while GHCR `latest` names the partial image. The owner repoints `latest`
  to the prior stable digest, or deletes `latest` when npm still names the
  placeholder. GET verification must confirm candidate 404 and default
  restored or absent. Registry preflight now passes if other gates pass.
  Redispatch the same version only while its commit is main HEAD, after a
  new successful dry-run gate. If main advanced, BR-361 still refuses the
  old SHA; prepare the next patch version on main with a new tag and gate.
  Cleanup of the partial default is still required before a patch release.
  If npm accepted the version, never delete or republish it. Verify manually
  if read-back was skipped; rerun only read-back if it failed. Uncertain
  image push outcomes use the same GET checks and cleanup procedure.
  Reject automatic rollback: only the owner can authorize registry cleanup.
- **D-5 Betas after stable.** Allow a beta strictly above the current stable
  npm `latest`, such as `1.1.0-beta.1` after `1.0.0`. Preserve stable defaults.
  Refuse a deprecated stable default for owner recovery. Only the exact
  placeholder is exempt from published-version ordering for stable releases.
- **D-6 Keep IDs and evidence.** Version existing rules because their purpose
  is unchanged. Keep BR-379 v1: its digest rule already applies to either
  release kind. Prepare pending records in implementation and accept them
  only on the actual main SHA. Keep the v2 snapshot byte-for-byte unchanged.

## Open questions

## Stress-test

- **Round 1, finding 1: retained** — Stable ordering covers every published version, including betas, and latest. Boundary cases are explicit.
- **Round 1, finding 2: retained** — Phase npm checks npm state and this run’s GHCR pair only. An older stable latest case permits later stable releases.
- **Round 1, finding 3: retained** — Owner cleanup restores the prior default before redispatch or a patch bump. AC-32 rehearses each preflight state.
- **Round 1, finding 4: retained** — Default stable install and exact npx commands replace beta defaults. AC-24 lists changed test strings.
- **Round 1, finding 5: retained** — Buildx metadata supplies a job digest. npm preflight and read-back require that exact digest, removing the gap.
- **Round 1, finding 6: retained** — Compared manifests use GET and one Accept list. A misleading HEAD digest case must fail.
- **Round 1, finding 7: retained** — Betas above stable latest are allowed. Deprecated stable latest and substitute placeholders are refused.
- **Round 1, finding 8: retained** — AC-25 pins refusal inputs and diagnostics. Implementation must remove both legacy messages.
- **Round 1, finding 9: retained** — BR preparation preserves accepted v1 beside pending v2. History uses the implementation PR date.
- **Round 1, finding 10: retained** — Environment inventories are replaced by the no-new-ID and pre-freeze/pre-PR recheck instruction.
- **Round 1, finding 11: retained** — AC-24 pins strings; AC-32 defines doubles and approval simulation; AC-34 and AC-35 add main acceptance and release gates. Read-back tests cite v2.
- **Round 1, finding 12: retained** — BR-354 and D-4 cite the v2 snapshot D-8 for recovery provenance.

No approval or freeze is claimed.

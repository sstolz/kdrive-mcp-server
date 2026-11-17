---
id: F-024
title: Stable release lifecycle
ticket: "#91"
status: draft
version: 4
---

## Context

F-024 v3 enabled the first stable release only. Its accepted contract is
preserved verbatim in [the v3 snapshot](history/F-024-v3.md); the
[v1](history/F-024-v1.md) and [v2](history/F-024-v2.md) snapshots remain
unchanged. This version enables later stable releases and betas after stable,
and defines recovery when an image has published before npm fails. It affects
release owners, maintainers and users of the registries' default tags.

This is a security-sensitive full-path ticket: publication changes defaults
and supply-chain evidence. This document is a draft, not a freeze or a release
go. Independent strong-tier review followed by the strongest-tier decision
pass is required before freeze. The policy recommendations identified as Q1
and Q2 below are provisional; no implementation starts before their resolution.

### Implementation baseline

The following observations come from the worktree, not a live registry probe:

- `scripts/release.ts`: `afterStable` refuses every release-check after a
  non-placeholder latest or stable history; `stableOrdering` compares stable
  candidates against keys in both npm history objects using exact integers;
  `npmChecks` still requires a deprecated default. `stableGhcrCheck` requires
  latest absent before push and binds both tags to this run in phase npm.
  `npmAttempt` still requires a deprecated placeholder for beta read-back.
- `scripts/release-image.sh` already pushes both stable tags in one build and
  exports a validated buildx metadata digest only for real stable builds.
  Beta pushes only its version tag. This behavior stays.
- `.github/workflows/release.yml` already serializes release runs, orders
  verify → publish-image → publish-npm → read-back, forwards the image digest
  to phase npm and read-back, and gates both publish jobs through `release`.
  Its job graph, permissions, input set and digest plumbing need no change.
- `tests/release.test.ts` contains v3 validation, registry matrices, digest
  binding, stable publication, read-back and recovery rehearsals.
  `tests/helpers/release.ts` supplies HTTP doubles, temporary Git repositories
  and raw index bodies. `tests/release-policy.test.ts` and
  `tests/helpers/release-policy.ts` enforce the workflow and image contracts.
  Existing recovery models package-version deletion by digest, which removes
  every tag on that digest; the v4 rehearsal must preserve that property.

The cited PR #90 review comments could not be fetched during drafting:
`gh pr view 90 --comments` failed to connect to api.github.com. The v3
Stress-test records their retained and deferred decisions, but is not a
substitute for reading those comments before freeze.

## Scope

- Extend release-check and read-back in `scripts/release.ts` for later stable,
  post-stable beta and the phase matrices below.
- Extend the existing tests first, including characterization of retained v3
  guards before changing the touched branches; use bounded registry fixtures.
- In implementation, update `docs/publishing.md` with the matrices, exact
  diagnostics and owner recovery procedure below. Rehearse that procedure
  end to end against doubles before requesting any owner run.
- Preserve the image script, workflow and Make targets' existing contracts;
  adjust their policy tests only for changed guide expectations or regression
  coverage. Any required contract change needs a reviewed spec revision.
- In implementation, prepare pending versions of BR-354, BR-363, BR-372 and
  BR-373, new BR-431–BR-433 records, capability/index and Unreleased entries.
  Do not mark them active or this spec done until actual-main acceptance.
- This authoring task writes only this spec, its verbatim history snapshot
  and the existing spec index (`docs/spec-index.md`; `features/README.md`
  does not exist).

### Out of scope

- Code, tests, BR records, guide or changelog edits in this draft task.
- Release preparation, VERSION/package bumps, release tags, publication,
  dispatches, deployment approvals, registry mutations or environment changes.
- Signing (#92), GitHub Release objects, automatic rollback or cleanup,
  publication to a second npm channel, new credentials or workflow permissions.
- Runtime behavior, dependency changes and CI/runner workflow changes.
- Removing original placeholder deprecation or weakening owner, commit, CI,
  tarball, provenance, approval or endpoint-isolation gates.

## Business rules

One rule defines each observable predicate below; the referenced tables and
procedures supply its exhaustive cases. All are proposed, not accepted.
The highest BR file in this worktree is BR-430; new IDs start at BR-431.
Recheck allocations on actual main before freeze and before the PR.
ADR-013 remains unused: no irreversible architecture choice is made here.

### Changed rules

- **BR-354 v3** — The publishing guide specifies the v4 phase matrices and
  recovery procedure in this document. Verified by: AC-37, AC-44.
  Change from v2: replaces first-stable-only wording and recovery with later
  stable/beta behavior and byte-preserving default restoration; all v2 naming,
  tarball references, precondition order, dry-run evidence, dispatch, install
  examples, beta access, mutable-default warning and digest-pinning advice stay.
  P-0's placeholder setup remains historical bootstrap; after stable, its
  default-tag condition is the automated npm policy below, not a demand to
  re-deprecate a healthy stable. P-1 through P-5 stay unchanged.
  The pre-stable beta recovery cases from v2 D-8 remain verbatim in the
  guide (and its existing beta-recovery fixture); append post-stable cases
  separately instead of rewriting those historical bootstrap instructions.
- **BR-363 v3** — Release-check admits registry state exactly when the npm
  and GHCR preflight predicates in the v4 phase matrices hold. Verified by:
  AC-38, AC-39, AC-40, AC-41, AC-45.
  Change from v2: removes the blanket #91 refusal, accepts an older stable
  npm latest, accepts its matching GHCR default before stable image push,
  and retains the new run's digest binding in phase npm.
- **BR-372 v3** — npm read-back succeeds exactly when the npm read-back row
  for its release kind holds within the existing bounded retry loop.
  Verified by: AC-42, AC-45.
  Change from v2: beta accepts a healthy stable latest, stable no longer
  requires latest to have been a placeholder, and the published candidate
  must be non-deprecated for either kind; exact-version, timestamp, provenance,
  verified tarball and original-placeholder evidence remain mandatory.
- **BR-373 v3** — Image read-back succeeds exactly when the GHCR read-back
  row for its release kind holds. Verified by: AC-42, AC-45.
  Change from v2: after stable, beta latest must match the versioned image of
  the npm stable default; first-stable and later-stable read-back still bind
  both stable tags to this run, with unchanged public access/platform checks.

### New rules

- **BR-431 v1** — A beta candidate has strictly greater SemVer precedence
  than every published version except the original placeholder.
  Verified by: AC-38. This is the recommended Q1 policy, not yet approved.
- **BR-432 v1** — A deprecated stable npm latest is an admissible default
  only for a stable successor authorized by the owner's version-and-SHA go.
  Verified by: AC-40, AC-44. This is the recommended Q2 policy, not yet approved;
  automated admission checks release kind and registry state, while the go
  remains an owner-evidence gate as in v3, not an agent-supplied bypass flag.
- **BR-433 v1** — Cleanup of a candidate GHCR package version with a prior
  stable default is permitted only after GET confirms latest restored to the
  recorded prior digest while the prior version still serves that digest.
  Verified by: AC-43, AC-44. npm absence and owner authority are prerequisites
  of the recovery procedure, not authority granted by this draft.

### Retained v3 rules

The complete accepted texts in [v3 Business rules](history/F-024-v3.md#business-rules)
are incorporated unchanged except for the four explicit replacements above:

- BR-356 v2, BR-357 v2, BR-358 v2 and BR-375 v2 retain the exact job output,
  step IDs, dependencies, closed environment sets and Make forwarding.
- BR-359 v2 retains validation before commands/requests: stable or beta.N
  syntax only, exact SHA/boolean/phase checks, stable run digest validation,
  empty digest in verify/image, and optional ignored valid beta digest.
- BR-368 v2, BR-369 v2 and BR-370 v2 retain exact npm argv, stable two-tag
  build, beta one-tag build, dry-run behavior, credential isolation, logout,
  JSON metadata parsing, printed digest and single job-output line.
- BR-353 v1, BR-355 v1, BR-360–BR-362 v1, BR-364–BR-367 v1,
  BR-371 v1, BR-374 v1, BR-378 v1 and BR-379 v1 retain their accepted texts.
  BR-016 v3 and BR-178 v3 remain unchanged; withdrawn IDs stay withdrawn.

In particular, real publication still requires an owner go naming the exact
version/SHA, a successful real dry-run dispatch for that pair, the dispatched
main HEAD with its release tag and successful main CI, and both protected
publish jobs. GHCR still precedes npm. Agents never dispatch, re-run or
approve releases or mutate registries. Same-run npm re-run is owner-only;
GitHub may reuse its earlier environment approval, so that re-run is itself
the owner's publication go. No release mode runs `npm dist-tag`.

Retained verification includes v3 AC-25, AC-29, AC-30, AC-33 and the per-release
AC-35, with AC-45 regression coverage below. AC-36's buildx metadata evidence
remains applicable. The v3-specific #91 refusal, placeholder-only matrix,
first-stable-only recovery states and one-time wiring probes are historical;
they are replaced by this version, not silently carried forward.

### SemVer and npm preflight predicates

`P` is exactly `0.0.0-placeholder.0`. Published history is the union of keys
in npm `versions` and `time`, ignoring exactly `time.created` and
`time.modified`. Both objects must be readable. Every other key must be
SemVer, even when the key occurs in only one object. `P` is excluded from
ordering only, not from the required deprecated-placeholder evidence.
Other placeholders, including `0.0.0-stage`, are ordinary published versions.

Ordering uses full SemVer precedence: compare exact unbounded integers in
major/minor/patch and numeric prerelease identifiers; numeric identifiers sort
below nonnumeric identifiers, nonnumeric identifiers use ASCII lexical order,
a shorter equal prefix sorts lower, and stable exceeds prerelease at the same
base. Build metadata never affects precedence. Registry keys may use any valid
SemVer even though candidate syntax remains stable or beta.N only.
A precedence-equal version with different build metadata still blocks.

Stable retains v3's strict ordering against **every** published version.
BR-431 proposes the same for beta. Thus 1.0.1, 1.1.0 and 2.0.0 can follow
1.0.0, subject to all intervening history; 1.1.0-beta.1 can follow 1.0.0;
1.0.5-beta.1 after 1.1.0-beta.1 is refused; 1.0.1 after 1.1.0-beta.1 is also
refused. Q1 asks the owner to confirm that hotfix consequence or choose a
policy revision before freeze. No undocumented maintenance exception exists.

An npm default is one of:

- **Bootstrap:** latest is exactly P, P exists and has a non-empty deprecated
  string, and no stable key exists in either history object.
- **Stable:** latest is a supported plain stable version, its version entry
  records that exact version, its timestamp exists, and it is the greatest
  stable precedence in the union history. It is non-deprecated, except for
  BR-432's proposed stable-fix path. P still exists and remains deprecated.

Missing latest, latest naming a beta/unknown version, incomplete default
records, resetting latest to P after stable history, or latest behind another
stable key fails closed. `deprecated` absent or the empty string means healthy;
a non-empty string means deprecated; a non-string value is unreadable data.
Stable default validity does not require it to exceed next-version betas.
A `beta` dist-tag is not an ordering authority: history is authoritative.

### Registry conditions by kind and phase

All preflight rows require the unchanged commit, CI and environment gates,
candidate absent from both npm history objects, ordering above, and valid npm
default above. Those predicates run in verify, image and npm, with either
boolean value. The sole npm 404 exception remains a beta dry-run preflight
(phases verify/image/npm with dry_run=true); it gives no publication authority.
For a readable npm 200 document, beta dry-run now validates the same history
and default as real beta, including BR-431. Stable never has a 404 exception.

All manifest comparisons use SHA-256 of raw GET response bytes and this exact
Accept header on every compared reference:
`application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`.
A valid index has exactly linux/amd64 and linux/arm64 among non-attestation
entries, retaining v3's index checks. HEAD never supplies comparison digests.
Authenticated token errors, malformed documents and unexpected statuses fail
closed. Beta candidate preflight keeps the existing HEAD checks.

| Kind | Phase | npm | GHCR |
| --- | --- | --- | --- |
| Stable | verify / image | Bootstrap or stable default, including Q2 deprecated-stable exception; candidate unpublished and above all history | Candidate GET 404. Bootstrap: latest GET 404. Prior stable S: GET S and latest return valid indexes with identical raw-body hashes. |
| Stable | npm | Same npm predicate; latest still names prior default, not candidate | Candidate and latest GET 200, valid indexes, both hashes equal RELEASE_IMAGE_DIGEST from this run. Do not compare latest to old S here. |
| Beta | verify / image | Bootstrap or healthy stable default; candidate unpublished and BR-431 ordering | Candidate HEAD 404; no new latest preflight request. |
| Beta | npm | Same npm predicate; publish only with beta tag | Candidate HEAD 200; no run-digest comparison, no latest mutation. |
| Stable | read-back | Candidate entry records exact version, candidate timestamp exists, latest equals candidate, candidate healthy, attestations present, tarball matches verify, P remains deprecated; beta need not move | Both candidate and latest valid indexes, hashes equal this run's digest; anonymous token and HEAD 200 for both. |
| Beta | read-back | Candidate entry records exact version and timestamp, beta equals candidate, candidate healthy, attestations and verified tarball present, P remains deprecated; latest is bootstrap or healthy greatest stable, different from candidate | Candidate valid index and anonymous HEAD 200. Bootstrap: latest absent or a different digest as in v3. Stable S: S and latest valid indexes with equal hashes, different from candidate; anonymous token and latest HEAD 200. |

npm read-back keeps 20 attempts, 15 seconds apart, and performs no mutations.
Beta publication argv cannot write latest; rehearsal also compares npm latest
before and after. Read-back checks the current stable mapping, not an invented
immutable cross-run snapshot: concurrent external default edits remain a risk.

### Exact diagnostics and output

Existing report prefixes, safe summaries, input failures, token/status reasons,
platform/provenance/tarball checks and exit 1 remain. These tables pin every
new or changed condition. No untrusted key, registry body, credential or
arbitrary exception text is interpolated. `<status>` is the existing numeric
HTTP status (0 for request failure). `<hex>` is 64 lowercase hex characters.

Npm preflight reports `release-check: npm version not published` for status,
unreadable data, candidate presence and ordering; it reports
`release-check: npm default` for default validity (replacing `npm placeholder`).
Each line ends in ` ok` or ` FAIL <reason>`. Determine the first history failure
in this order: status, object readability, malformed keys (versions then time),
candidate presence, ordering. Validate all keys before comparing precedence.
Default reasons use the table's order; when history is unreadable the default
reason is `npm document unreadable; refer to the owner`. GHCR stays a separate
`release-check: GHCR image` condition; other gates still report their results.

| Condition | Exact failure reason |
| --- | --- |
| Missing latest | `npm latest tag missing` |
| Latest is neither P nor a supported stable | `npm latest is not a supported stable default` |
| Latest version entry/version field/timestamp missing or inconsistent | `npm latest version record incomplete` |
| P missing or not deprecated | `original placeholder is not deprecated` |
| P selected after stable history | `npm placeholder latest cannot follow stable history` |
| Latest behind another stable key | `npm latest is not the greatest published stable version` |
| Deprecated stable latest for beta | `npm latest stable is deprecated; owner recovery required` |
| Stable ordering failure, unchanged | `stable version is not greater than every published version` |
| Beta ordering failure | `beta version is not greater than every published version` |
| Invalid history key, unchanged | `npm versions contains a non-SemVer version key` or `npm time contains a non-SemVer version key` |
| Candidate present in either object, unchanged | `version already published on npm` |
| Unreadable/inconsistent types | `npm document unreadable; refer to the owner` |
| Stable npm 404, unchanged | `npm registry status 404` |
| Candidate before image push, unchanged | `image already published` |
| Bootstrap latest present | `GHCR latest exists without a stable npm default` |
| Prior stable S GET 404 | `previous stable image unavailable` |
| Prior stable latest GET 404 | `GHCR latest missing for stable npm default` |
| Prior stable S or latest invalid index | `previous stable image manifest invalid` |
| Prior stable hashes differ | `GHCR latest does not match npm stable default` |
| Phase npm either manifest unavailable/invalid/different | `image manifest unavailable`; `image manifest invalid`; `image digest does not match RELEASE_IMAGE_DIGEST` (unchanged) |

Before stable push, unexpected GET statuses retain
`unexpected GHCR status <status>; refer to the owner`; token failures retain
`unexpected GHCR token status <status>; refer to the owner`. Check candidate
status/presence before prior-default checks, then S availability, latest
availability, index validity and hash equality. Phase npm retains v3's token
precedence and candidate-then-latest digest validation. Remove the blanket
`releases after the first stable are out of scope; see #91 (F-024 v4)` and
`GHCR latest already exists; first stable requires 404` from executable
code and current expectations; immutable historical snapshots keep them.

The read-back report adds/replaces exactly the following lines; other v3
lines remain as specified in the snapshot. `<reason>` below is restricted to
the alternatives in that row; each line has either ` ok` or ` FAIL <reason>`.

| Exact condition prefix | Failure reason alternatives |
| --- | --- |
| `release-verify: npm candidate not deprecated` | `candidate is deprecated`; `npm document unreadable; refer to the owner` |
| `release-verify: npm default` (beta only; replaces deprecated-placeholder line) | All npm default reasons above, including deprecated-stable refusal; `latest names the release` |
| `release-verify: npm original placeholder deprecated` (now both kinds) | `original placeholder is not deprecated` |
| `release-verify: image latest tag` (beta only, retained prefix) | Bootstrap: existing v3 reasons. Stable: `previous stable image unavailable`; `previous stable image manifest invalid`; `GHCR latest missing for stable npm default`; `GHCR latest does not match npm stable default`; `latest names the release`; `GHCR status <status>`; `GHCR token status <status>`; `npm stable default unavailable` |
| `release-verify: image latest is public (P-3)` (stable and beta with stable default) | `anonymous pull failed` |

Stable keeps `npm latest tag` and both `image version digest` / `image latest
digest` lines with exactly v3 reasons. Beta keeps `npm beta tag`. Both kinds
keep `npm version present` (now exact version/timestamp for beta too),
`npm provenance`, `npm tarball matches verify`, `image platforms`,
`image is public (P-3)` and `release-verify: image digest sha256:<hex>`.
Stable never emits `npm beta tag`, `npm default` or `image latest tag`.
Beta never emits run-digest comparison lines. Neither kind emits the obsolete
`npm latest is a deprecated placeholder` line. Candidate-health checks require
an existing readable version entry; absence uses the unreadable reason, not ok.

### Owner recovery procedure

This procedure is guide content and a rehearsal contract. It authorizes no
real mutation. Registry writes, including repointing, remain owner-only.

1. **Classify without replaying.** Read npm versions/time, candidate tarball
   and tags. If either history object contains the candidate, npm accepted
   it: never delete or republish it. Re-run only read-back or diagnose manually;
   a repair release uses a new version and all release gates. If requests or
   npm outcome are uncertain, stop with `recovery blocked: npm outcome uncertain`.
2. **Prefer the same-run npm retry.** When npm definitely lacks the candidate,
   re-run only the failed publish-npm job with the original image digest and
   tarball artifact, all commit/CI/environment gates rechecked. Never re-run
   all jobs. Retain v3's expired-window, advanced-main, cancelled-run, missing
   artifact and uncertain-evidence exclusions. If a gate/approval refuses,
   state is `recovery blocked: same-run npm retry unavailable` and continue
   only to the owner cleanup choice. Do not rebuild a pushed candidate.
3. **Identify cleanup precisely.** If retry is unavailable, record the
   candidate digest from build metadata/output and confirm candidate GET
   against it. Resolve the still-current npm stable default S to its GHCR
   versioned index; record `previous_digest` from raw GET bytes and confirm
   it against the release ticket's prior read-back evidence. Require S's
   index/digest to be distinct from the candidate and its original version
   tag to remain present. Unknown candidate digest, changed npm default,
   missing prior evidence, extra tags on the candidate package version,
   shared prior/candidate digest, or any uncertain state stops with
   `recovery blocked: image identity uncertain`. Deletion must identify the
   exact package-version ID and full tag set, never guess by tag alone.
4. **Restore before deleting.** With a prior stable S, the owner runs exactly
   one source through the following command, using the validated full digest
   and fixed repository. No annotations, append, platform filtering, file
   descriptors or rebuilding are allowed:

   ```sh
   image=ghcr.io/sstolz/kdrive-mcp-server
   docker buildx imagetools create --prefer-index=false \
     --tag "$image:latest" "$image@$previous_digest"
   ```

   `previous_digest` must match `sha256:<64 lowercase hex>` and must not be
   empty; the guide checks it before the command and reports
   `recovery blocked: image identity uncertain` on failure, without invoking
   Docker. This is a single-index
   copy, supported by the [Docker command contract](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/).
   After the command, GET latest and S with the exact Accept list above,
   hash their raw bytes and require both equal `previous_digest`. Print
   `recovery: GHCR latest restored sha256:<hex>` only after both checks.
   A command failure prints `recovery blocked: latest repoint failed`;
   a GET/status/index/hash failure prints
   `recovery blocked: latest restoration unconfirmed`. Stop before deletion
   in either case. Command success or HEAD digest equality is insufficient.
5. **Delete only the candidate package version.** Recheck npm absence and
   identities immediately before the owner's explicitly authorized deletion.
   Confirm candidate GET 404, S still serves the prior digest, and latest
   still serves that digest. Failed confirmation prints
   `recovery blocked: cleanup unconfirmed`. A package-version delete removes
   all tags still attached to that digest; restoration must already have
   detached latest. Never delete S. For bootstrap with no prior stable,
   retain v3 cleanup: candidate package-version deletion removes candidate
   and latest, then both GET 404. No repoint command or empty previous loop
   runs in bootstrap. Historical beta recovery remains as in v2 D-8, adding
   protection for an existing stable default and no latest mutation.
6. **Resume only through release gates.** Confirm state now passes fresh
   registry preflight. Redispatch the original version only if it is still
   unpublished, its tagged commit is main HEAD, and a new successful dry run
   and owner go exist. If main advanced, use a new version satisfying the
   ordering policy, a new tag, go and dry run; a patch is insufficient when
   a published next-minor beta blocks it. Confirm cleanup before either
   choice. No deletion, repoint or republish follows npm acceptance.

For Q2's recommended deprecated-default policy, the owner records the affected
version, deprecation reason and intended fixed version/SHA in the release
ticket, leaves the vulnerable version deprecated, and gives the usual go and
exact-pair dry-run evidence. Stable preflight permits that default and still
requires all ordering, image, CI, provenance and approval gates. The successor
publishes with latest and read-back requires it healthy. Beta remains blocked
until a healthy stable latest exists. If no earlier healthy stable exists, this
forward-fix route still works. A deprecated old image is restored only to the
unchanged npm default during failed-fix cleanup; that restores consistency,
not a claim that the vulnerable release is safe. If ordering blocks the desired
hotfix, Q1 governs the version choice; deprecation is not an ordering bypass.

Guide/rehearsal success states are exactly
`recovery: registry preflight ready` (after fresh checks) and the restored
digest line above. The listed `recovery blocked:` lines are fixed guide and
harness diagnostics, not new `release-check` modes. The harness also prints
`recovery blocked: npm already accepted candidate` for the non-deletion case.

### BR record preparation

The implementation PR preserves the full accepted v2 sections/evidence of
BR-354, BR-363, BR-372 and BR-373, adds proposed v3 sections and a History line
`v3 — <implementation-PR-date> — F-024 v4 (#91) — <change described above>;
pending acceptance, v2 stays accepted until acceptance`.
New BR-431–BR-433 use version 1, source F-024 v4 and pending acceptance.
Every rule gets a named unit test and concrete boundary examples; Q1/Q2
resolutions are reflected before freeze. No BR record is edited in this phase.
Acceptance and token accounting belong to #91, with per-agent model/effort,
exposed counters and coverage limits only; no invented attribution or per-run
repository files. Durable observations are promoted at closure. Synchronize
final active/done markers in the next scoped PR before release.

## Acceptance criteria

AC-01–AC-36 retain their historical evidence; changed expectations are
explicitly replaced above. The following test names are planned, not claims
of existing tests or passing checks. Unit suites run through `make check` in
the Docker-only toolchain. Each planned test cites its rule/version.

- **AC-37 (BR-354 v3)** — Given the guide and existing policy tests, when
  `BR-354 v3 lifecycle guide` in `tests/release-policy.test.ts` runs, then it
  verifies the matrices, Q1/Q2 resolved policies, diagnostics, recovery command,
  all preserved install/pinning/mutable-tag advice and unchanged owner gates.
- **AC-38 (BR-363 v3, BR-431 v1)** — Given both history objects and candidates,
  when `BR-363 v3 BR-431 v1 ordering: %s` in `tests/release.test.ts` runs, then
  the chosen precedence policy admits stable 1.0.1/1.1.0/2.0.0 after 1.0.0
  and beta 1.1.0-beta.1 after 1.0.0, and under recommended Q1 refuses
  1.0.5-beta.1 and stable 1.0.1 after 1.1.0-beta.1. Given stable 1.0.5 alone,
  when testing 1.0.5-beta.1 or 1.0.4, then both refuse; 1.0.6-beta.1 passes.
  Given beta.9/beta.10, numeric components above 2^53, prerelease lexical and
  prefix cases, precedence-equal build metadata, time-only versions,
  versions-only versions, P, stage and malformed keys in either object,
  when every phase and dry-run boolean is checked, then ordering and exact
  first-failure diagnostics match this spec; created/modified alone are ignored.
- **AC-39 (BR-363 v3)** — Given a healthy older stable S and valid candidate,
  when `BR-363 v3 lifecycle phase matrix: %s` runs in `tests/release.test.ts`,
  then every table row passes only its stated npm/GHCR predicates. Given
  latest absent, beta, missing entry/time, stale stable, or reset P after
  stable history in either object, when preflight runs, then the fixed
  default diagnostic refuses it in all phases and boolean combinations.
  Given npm 404, when beta dry-run and stable dry/real or beta real are
  compared, then only beta dry-run receives the retained exception.
- **AC-40 (BR-363 v3, BR-432 v1)** — Given deprecated stable latest 1.0.0
  with no healthy earlier stable and candidate 1.0.1, when
  `BR-432 v1 deprecated stable recovery: %s` in `tests/release.test.ts` runs,
  then under recommended Q2 all stable preflight phases pass valid registry
  state, beta refuses with the exact deprecated-default diagnostic, and
  stable read-back succeeds only after latest selects healthy 1.0.1.
  Given missing go, dry-run evidence or deployment approval in the rehearsal,
  when the same recovery is attempted, then publication never occurs.
- **AC-41 (BR-363 v3)** — Given S/latest indexes of the old digest, when
  `BR-363 v3 prior default and run binding: %s` in `tests/release.test.ts`
  runs, then verify/image accepts them only with candidate absent, while npm
  accepts only candidate/latest matching this run's digest even though npm
  latest still names S. Given latest still old, two equal tags from a different
  run, missing or invalid indexes, hash disagreement with matching HEAD
  digests, token errors or unexpected statuses, when the relevant phase runs,
  then it refuses with the pinned reason and never publishes npm. Assert
  exact GET methods and Accept bytes for every digest comparison.
- **AC-42 (BR-372 v3, BR-373 v3)** — Given later-stable and post-stable beta
  read-back fixtures, when `BR-372 v3 BR-373 v3 lifecycle read-back: %s` in
  `tests/release.test.ts` runs, then each row succeeds only with all its
  conditions; beta leaves both defaults unchanged and stable binds both
  image tags to the run. Given each missing record, wrong version/time/tag,
  candidate deprecation, missing provenance, wrong tarball, changed stable
  default mapping, missing public latest or bad image hash/platform, when
  read-back runs, then it fails after bounded npm retries where applicable,
  with exactly the specified lines. Assert bootstrap regression, exactly
  20 attempts/19 waits on persistent npm failure, and zero mutation requests.
- **AC-43 (BR-433 v1, BR-354 v3)** — Given a digest-keyed registry double
  holding old S and partially published candidate/latest, when
  `BR-433 v1 byte preserving restoration: %s` in `tests/release.test.ts`
  drives the guide's exact imagetools command through fake Docker and the
  GET hash checks, then it restores raw bytes before candidate deletion;
  deletion removes all tags on the candidate digest and leaves S/latest.
  Given a copy that reserializes JSON, matching HEAD with changed GET bytes,
  failed copy, missing S, same prior/candidate digest, extra candidate tags,
  missing evidence, changed default or failed cleanup confirmation, when
  recovery runs, then it prints the precise blocked state and performs no
  dependent deletion or publication. Assert both bootstrap and prior-stable
  branches, no empty digest command, and no deletion after npm acceptance.
- **AC-44 (BR-354 v3, BR-432 v1, BR-433 v1)** — Given the existing real
  release entry paths and bounded Git/GitHub/npm/GHCR doubles plus fake
  npm/Docker, when `F-024 v4 lifecycle rehearsal: %s` in
  `tests/release.test.ts` runs end to end, then later stable, post-stable
  beta and deprecated-default fix execute verify, approvals, image, npm and
  read-back in order with exact argv and digest forwarding. Given denied or
  expired second approval, npm preflight/publish failure, partial image push,
  uncertain npm success, cancelled/expired retry, missing artifact and
  advanced main, when recovery runs, then same-run npm retry is preferred,
  every gate is rechecked, cleanup is owner-only and restoration precedes
  deletion; new dispatch requires fresh dry run/go and eligible main version.
  No successful/uncertain npm publication is blindly replayed. All guide
  branches run against doubles before any real-environment request.
- **AC-45 (all changed/new rules and retained v3 gates)** — Given every
  new diagnostic fixture and existing workflow/image/tarball guard fixture,
  when `F-024 v4 exact diagnostics: %s` in `tests/release.test.ts` and the
  existing `tests/release-policy.test.ts` mutation tests run, then all exact
  strings, success/FAIL lines, suppression rules, input-first failures and
  unchanged permissions, output plumbing, approvals and job order hold.
  Given a removed guard, when its mutation test runs, then it fails. Given
  beta publish argv, when the rehearsal compares before/after defaults,
  then npm latest and GHCR latest are unchanged and no dist-tag command runs.
- **AC-46 (BR-433 v1; implementation command qualification)** — Given a
  throwaway local registry and real Docker buildx in the project toolchain,
  when the owner-command qualification copies a recorded two-platform index
  by the exact single-source imagetools command, then raw GET hashes of S
  and restored latest match the original digest before and after candidate
  package-version deletion is simulated by the double. Verified by: command
  argv, buildx version, exit statuses, Accept header and raw-body hashes in a
  sanitized implementation PR comment. This qualifies the copy command;
  digest-keyed deletion is rehearsed in AC-43, not claimed as a local-registry
  emulation of GHCR's package API. No public registry write is authorized.
- **AC-47 (actual-main acceptance)** — Given the merged implementation's
  actual main SHA, when `make check` and mandatory main CI finish and all
  AC-37–AC-46 evidence is checked against that SHA, then the orchestrator
  records results and mappings in #91 and closes it only on success. Verified
  by: gate output, CI checks and sanitized acceptance comment. Any live wiring
  check requires its own concrete rehearsed procedure and owner authorization;
  no unsupported real probe or publication is implied by ticket acceptance.
- **AC-48 (BR-354 v3; per-release evidence)** — Given an eligible tagged
  main HEAD and version, when the owner authorizes a real release, then its
  ticket records the exact-pair successful real dry-run dispatch, publication
  go, both publish-job approvals and full read-back evidence before claiming
  release success. Verified by: ordered release-ticket evidence, retaining
  v3 AC-35 for every redispatch or replacement version.

## Decisions

- **D-1 Keep the gated workflow.** Use the existing image digest output and
  phase distinction; phase npm checks the new run while npm still has the old
  default. Reject comparing GHCR latest to old npm latest in that phase:
  image publication intentionally moved it already. Reject a second workflow
  or extra promotion tag because they add credential/approval paths.
- **D-2 History is the ordering authority.** Preserve stable ordering against
  both history objects, exact integers and build-metadata equivalence; use a
  full comparator for beta. Reject dist-tags-only ordering because tags can
  move backwards or hide a published version. Beta/hotfix policy remains Q1.
- **D-3 Copy and verify raw bytes.** Use the existing Docker buildx toolchain's
  single-source imagetools command and raw GET hashes. Reject rebuilds,
  JSON reconstruction, multi-source creation and HEAD-only proof because
  they cannot prove preservation of the prior index digest. Command exit
  alone is not deletion authority. Actual tool behavior is qualified in AC-46.
- **D-4 Forward-only npm recovery.** Retain same-run owner npm retry before
  owner cleanup, and no npm deletion/republish after acceptance. Reject
  automatic rollback or agent-issued registry commands because uncertain
  outcomes and digest-wide deletion require owner reconciliation. Deprecated
  default admission is Q2; no new secret, bypass flag or npm mutation command
  is introduced by its recommended option.
- **D-5 Preserve accepted contracts and evidence.** Archive v3 verbatim,
  version four same-purpose BRs, allocate BR-431–BR-433 provisionally and
  leave implementation records pending. Reject rewriting v3 evidence or
  claiming current registry state from a historical fixture. No ADR is
  allocated for these reversible script/guide choices; unresolved release
  policy is not recorded as an architectural decision.

## Open questions

1. **Q1 — Ordering and maintenance releases.** Option A (recommended): keep
   stable greater than every published version and require beta likewise;
   refuse 1.0.5-beta.1 and stable 1.0.1 after 1.1.0-beta.1. This preserves the
   stated stable ordering scope and one monotonically advancing beta channel,
   but requires a fix at or beyond the beta line. Option B: retain strict
   stable ordering, order betas only against all stables plus betas of the
   same base, and allow lower-line betas to move `beta` backwards. Option C:
   permit independent maintenance lines for stable and beta; this changes
   the requested all-published stable policy and requires an explicit scope
   revision. Confirm A or select B/C; the draft matrices/ACs currently use A.
2. **Q2 — Deprecated stable latest.** Option A (recommended): allow a gated
   forward stable fix with the vulnerable default still deprecated, including
   when no healthy older release exists; owner go identifies the recovery,
   beta remains blocked and the fixed candidate must read back healthy.
   Option B: require the owner first to repoint npm latest to a healthy prior
   stable, with a reviewed exception to the greatest-stable-default predicate;
   if none exists, stop for a separate recovery decision. A avoids removing a
   vulnerability warning and always has a forward-fix route at an eligible
   version. The draft BR-432 and AC-40/AC-44 currently use A.

## Residual risks

The owner-accepted v3 mutable GHCR latest and non-atomic registry timing gap
remain: any other same-repository workflow with packages: write can move
latest, and image latest can precede npm until publication or owner cleanup.
Digest pinning remains recommended. Image signing remains deferred to #92.
The v3 temporary "no gated release after 1.0.0" limitation is resolved only
when v4 passes acceptance. Q1's maintenance restriction and Q2's temporary
exposure of a deprecated default need the owner's policy decision above.
No command creates a registry-wide transaction; external writes between
checks remain possible. Recovery stops on uncertainty rather than treating
check-before-delete as an atomic guarantee.

## Stress-test

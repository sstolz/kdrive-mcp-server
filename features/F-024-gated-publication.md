---
id: F-024
title: Stable release lifecycle
ticket: "#91"
status: frozen
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
and supply-chain evidence. This version is frozen (see the end of
Stress-test); it grants no release go. The owner resolved Q1 and Q2 on
2026-11-17 in issue #91; the decisions below govern this version.

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
- This correction task writes only this spec and the existing spec index
  (`docs/spec-index.md`; `features/README.md` does not exist). The verbatim
  history snapshots remain unchanged.

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
BR-431–BR-433 are provisional; re-check the next free ID on main before
freeze and before the PR.
ADR-013 remains unused: no irreversible architecture choice is made here.

### Changed rules

- **BR-354 v3** — The publishing guide specifies the v4 phase matrices and
  recovery procedure in this document. Verified by: AC-37, AC-43, AC-44, AC-48.
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
  compares stable candidates only against published stable versions, admits
  a deprecated stable default for a gated stable fix, and retains the new
  run's digest binding in phase npm; beta preflight checks the GHCR default
  against the npm stable default in every phase. Every admitted stable advances npm
  latest and GHCR latest; beta publication leaves both defaults unchanged.
- **BR-372 v3** — npm read-back succeeds exactly when the npm read-back row
  for its release kind holds within the existing bounded retry loop.
  Verified by: AC-42, AC-45.
  Change from v2: beta accepts a healthy stable latest, stable no longer
  requires latest to have been a placeholder, and the published candidate
  must be non-deprecated for either kind; exact-version, timestamp, provenance,
  verified tarball and original-placeholder evidence remain mandatory.
- **BR-373 v3** — Image read-back succeeds exactly when the GHCR read-back
  row for its release kind holds. Verified by: AC-39, AC-42, AC-45.
  Change from v2: after stable, beta latest must match the versioned image of
  the npm stable default; first-stable and later-stable read-back still bind
  both stable tags to this run, with unchanged public access/platform checks.

### New rules

- **BR-431 v1** — A beta candidate has strictly greater SemVer precedence
  than every published version except the original placeholder.
  Verified by: AC-38. Policy source: owner decision 2026-11-17, issue #91.
- **BR-432 v1** — A deprecated stable npm latest is an admissible default
  for a stable candidate and is refused for a beta candidate.
  Verified by: AC-40, AC-44. The vulnerable version remains deprecated when
  the healthy successor replaces it as default; no healthy earlier stable is required.
  Policy source: owner decision 2026-11-17, issue #91;
  automated admission checks release kind and registry state. The retained
  v3 owner's exact version-and-SHA go is a separate human-evidence gate,
  not an automated registry predicate or an agent-supplied bypass flag.
- **BR-433 v1** — Cleanup of a candidate GHCR package version with a prior
  stable default is permitted only after GET confirms latest restored to the
  recorded prior digest while the prior version still serves that digest.
  Verified by: AC-43, AC-44, AC-46. npm absence and owner authority are prerequisites
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
A precedence-equal version with different build metadata still blocks when
it belongs to the candidate kind's comparison set below.

A stable candidate must exceed **every published stable version** in the
union history; prereleases do not block it. A beta candidate must exceed
**every published version**, stable and prerelease, except P (BR-431).
Malformed keys still refuse either kind before ordering. Thus stable
1.1.1 can follow stable 1.1.0 and beta 1.2.0-beta.1, but stable 1.0.1 cannot
follow stable 1.1.0. No independent stable maintenance line bypass exists.

| Published history (besides P) | Candidate | Ordering result |
| --- | --- | --- |
| 1.0.0 | 1.0.1 / 1.1.0 / 2.0.0 | Allow each stable. |
| 1.0.0 | 1.1.0-beta.1 | Allow beta. |
| 1.1.0, 1.2.0-beta.1 | 1.1.1 | Allow stable; future beta does not block. |
| 1.0.0, 1.1.0-beta.1 | 1.0.1 | Allow stable. |
| 1.1.0 | 1.0.1 | Refuse stable hotfix below a published stable. |
| 1.1.0, 1.2.0-beta.1 | 1.1.2-beta.1 | Refuse beta below a published beta. |
| 1.0.0, 1.1.0-beta.1 | 1.0.5-beta.1 | Refuse beta. |
| 1.0.5 | 1.0.5-beta.1 / 1.0.4 | Refuse each candidate. |
| 1.0.5 | 1.0.6-beta.1 | Allow beta. |

These results cover ordering only; every other gate still applies. Because
a valid stable npm latest is the greatest stable in `versions`, every admitted
stable necessarily exceeds it. Its image publication moves GHCR latest to
the candidate's run digest, then npm publication moves npm latest to the
candidate. Bootstrap creates these defaults in the same order. There is no
admitted stable publication that leaves either latest on an older version.
Beta publication changes only npm beta and the versioned GHCR tag; npm latest
and GHCR latest stay untouched even when beta has greater precedence.

An npm default is one of:

- **Bootstrap:** latest is exactly P, P exists and has a non-empty deprecated
  string, and no stable key exists in either history object.
- **Stable:** latest is a supported plain stable version, its version entry
  records that exact version, its timestamp exists, and it is the greatest
  stable precedence among `versions` keys only. Time-only stable keys remain
  in candidate ordering but do not invalidate this default. It is
  non-deprecated, except for BR-432's stable-fix path. P still exists and
  remains deprecated.

Missing latest, latest naming a beta/unknown version, incomplete default
records, resetting latest to P after stable history, or latest behind another
stable key in `versions` fails closed. `deprecated` absent or the empty string
means healthy; a non-empty string means deprecated; a non-string value is
unreadable data.
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
| Stable | verify / image | Bootstrap or stable default, including BR-432 deprecated-stable exception; candidate unpublished and above every published stable | Candidate GET 404. Bootstrap: latest GET 404. Prior stable S: GET S and latest return valid indexes with identical raw-body hashes. Image publication then moves latest to this run's candidate digest. |
| Stable | npm | Same npm predicate; latest still names prior default, not candidate; npm publication then moves latest to candidate | Candidate and latest GET 200, valid indexes, both hashes equal RELEASE_IMAGE_DIGEST from this run. Do not compare latest to old S here. |
| Beta | verify / image | Bootstrap or healthy stable default; candidate unpublished and BR-431 ordering | Candidate HEAD 404; bootstrap latest absent or a different digest under the predicate below; stable S and latest GET valid indexes with equal hashes. |
| Beta | npm | Same npm predicate; publish only with beta tag | Candidate HEAD 200; same bootstrap or stable-default GHCR predicate as beta verify/image; no run-digest comparison, no latest mutation. |
| Stable | read-back | Candidate entry records exact version, candidate timestamp exists, latest equals candidate, candidate healthy, attestations present, tarball matches verify, P remains deprecated; beta need not move | Both candidate and latest valid indexes, hashes equal this run's digest; anonymous token and HEAD 200 for both. |
| Beta | read-back | Candidate entry records exact version and timestamp, beta equals candidate, candidate healthy, attestations and verified tarball present, P remains deprecated; latest is bootstrap or healthy greatest stable, different from candidate | Candidate valid index and anonymous HEAD 200. Bootstrap: latest absent or a different digest as in v3. Stable S: S and latest valid indexes with equal hashes, different from candidate; anonymous token and latest HEAD 200. |

npm read-back keeps 20 attempts, 15 seconds apart, and performs no mutations.
Beta's `image latest tag` check uses the final attempt's npm document to
validate the default and derive S, whether that attempt succeeds or exhausts
the loop; it never uses a document from an earlier attempt.
For every beta preflight phase, GET latest after the candidate HEAD check.
With bootstrap (also the retained npm-404 beta dry-run exception), latest
GET 404 passes. If latest GET 200, GET the candidate and require a valid index
and a raw-body hash different from latest, as in v3 read-back; an absent
candidate cannot prove a different digest, so a present latest then refuses.
With stable default S, GET S and latest and require valid indexes with equal
raw-body hashes; do not compare either to the run digest. Thus an orphaned
stable image at latest blocks beta before either publication, not only at
read-back. Beta read-back additionally requires latest different from the
published candidate, as in the table.
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
| Latest behind another stable key in `versions` | `npm latest is not the greatest published stable version` |
| Deprecated stable latest for beta | `npm latest stable is deprecated; owner recovery required` |
| Stable ordering failure | `stable version is not greater than every published stable version` |
| Beta ordering failure | `beta version is not greater than every published version` |
| Invalid history key, unchanged | `npm versions contains a non-SemVer version key` or `npm time contains a non-SemVer version key` |
| Candidate present in either object, unchanged | `version already published on npm` |
| Unreadable/inconsistent types | `npm document unreadable; refer to the owner` |
| Stable npm 404, unchanged | `npm registry status 404` |
| Candidate before image push, unchanged | `image already published` |
| Npm default invalid or unreadable, so no validated bootstrap/S is available | `npm stable default unavailable` |
| Bootstrap latest present in stable preflight or beta verify/image | `GHCR latest exists without a stable npm default` |
| Beta bootstrap latest present in phase npm or read-back without a readable valid candidate index of a different raw-body hash | `latest names the release` |
| Prior stable S GET 404 | `previous stable image unavailable` |
| Prior stable latest GET 404 | `GHCR latest missing for stable npm default` |
| Prior stable S or latest invalid index | `previous stable image manifest invalid` |
| Prior stable hashes differ | `GHCR latest does not match npm stable default` |
| Stable phase npm either manifest unavailable/invalid/different | `image manifest unavailable`; `image manifest invalid`; `image digest does not match RELEASE_IMAGE_DIGEST` (unchanged) |

Before stable push and in beta default checks, unexpected GET statuses retain
`unexpected GHCR status <status>; refer to the owner`; token failures retain
`unexpected GHCR token status <status>; refer to the owner`. Check candidate
status/presence before prior-default checks, then S availability, latest
availability, index validity and hash equality. Phase npm retains v3's token
precedence and candidate-then-latest digest validation for stable. Beta uses
the same prior-stable availability/index/hash reasons in all preflight phases;
bootstrap latest GET 404 passes, while GET 200 in beta verify/image uses
`GHCR latest exists without a stable npm default`. In beta phase npm and
read-back, GET 200 without proof of a different candidate digest uses
`latest names the release`. Other bootstrap GET failures use the fixed
status/token reasons above. Stable preflight also uses
`GHCR latest exists without a stable npm default` for bootstrap latest present.

Only resolve/request S after npm latest validates as a supported plain stable
default under the npm predicates for that kind, including record completeness,
ordering among `versions`, P evidence and deprecation policy. Never construct
an S URL from an unvalidated registry key. If npm default validation fails or
the document is unreadable, report `release-check: GHCR image FAIL npm stable default unavailable`
before requesting a GHCR token; make no GHCR request at all, including the
candidate request. This takes precedence over token and candidate/default
failures. The retained npm-404 beta dry-run exception uses bootstrap checks
instead. For beta read-back, the identical invalid or unreadable default
condition reports `release-verify: image latest tag FAIL npm stable default unavailable`
without S/latest requests; other npm and candidate image checks still report
independently. Remove the blanket
`releases after the first stable are out of scope; see #91 (F-024 v4)` and
`GHCR latest already exists; first stable requires 404` from executable
code and current expectations; immutable historical snapshots keep them.
Replace the old `stable version is not greater than every published version`
reason with the stable-only reason above. A future beta alone never produces
a stable ordering failure. A valid deprecated stable default produces no
default failure for a stable fix; beta retains its deprecated-default failure.

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
   all jobs. Retain v3's expired-window, cancelled-run, missing
   artifact and uncertain-evidence exclusions. If a gate/approval refuses,
   state is `recovery blocked: same-run npm retry unavailable` and continue
   only to the owner cleanup choice. An advanced main does not itself block
   this same-run retry: its HEAD, ancestry and GITHUB_SHA checks still use the
   approved run's commit. It blocks only redispatch of the old commit (step 6).
   Do not rebuild a pushed candidate.
3. **Identify cleanup precisely.** Post-stable beta uses the separate cleanup
   branch in step 5 without step 4's repoint. For stable, if retry is
   unavailable, record the candidate digest from build metadata/output and confirm candidate GET
   against it. Resolve the still-current npm stable default S to its GHCR
   versioned index; record `previous_digest` from raw GET bytes and confirm
   it against the release ticket's prior read-back evidence. Require S's
   original version tag to remain present; for deletion, also require its
   index/digest to be distinct from the candidate. If only the candidate digest is unknown, but npm
   absence, unchanged valid npm default S and its prior read-back evidence
   are certain, use the restore-only branch: run step 4 with `previous_digest`
   confirmed against that evidence and GET-confirm S/latest, perform no
   deletion, burn the candidate version and use a new version for the next
   release through step 6. Restoration does not depend on candidate identity.
   Otherwise, unknown candidate digest, changed npm default,
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

   The guide supplies one executable fenced shell block containing the digest
   format guard, this exact command, raw GET/hash commands with the exact
   Accept header above, and the confirmation/diagnostic branches below.
   AC-43 extracts and executes that block verbatim against fake Docker and
   the registry double; the harness does not re-implement the prose.
   The guide states the buildx version qualified by AC-46, including support
   for `--prefer-index=false`; an older version's safe refusal blocks recovery.
   `previous_digest` must match `sha256:<64 lowercase hex>` and must not be
   empty; the executable block checks it before the command and reports
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
   runs in bootstrap. Historical pre-stable beta recovery remains as in v2 D-8.
   For post-stable beta cleanup, first confirm npm candidate absence in both
   objects and record healthy S plus the equal raw GET hashes of S and latest.
   Identify the candidate package version/digest and full tag set; require
   its digest distinct from S/latest and no unexpected attached tags. After
   the owner's explicit authorization, delete only that candidate package
   version, with no latest repoint. Require candidate GET 404, npm candidate
   still absent, npm latest still S, and S/latest GET hashes unchanged from
   the recorded digest. Any failed confirmation uses `recovery blocked: cleanup unconfirmed`;
   uncertain identity stops before deletion with `recovery blocked: image identity uncertain`.
6. **Resume only through release gates.** Confirm state now passes fresh
   registry preflight. Redispatch the original version only if it is still
   unpublished, its tagged commit is main HEAD, and a new successful dry run
   and owner go exist. If main advanced, use a new version satisfying the
   ordering policy, a new tag, go and dry run. Published betas cannot block
   a stable patch above every published stable; a published higher stable
   blocks a lower-line hotfix, and a higher published beta blocks a lower
   beta. Confirm cleanup before either choice, except that the restore-only
   branch requires confirmed restoration, no deletion and a new version.
   No deletion, repoint or
   republish follows npm acceptance.

For the selected deprecated-default policy (BR-432), the owner records the
affected version, deprecation reason and intended fixed version/SHA in the release
ticket, leaves the vulnerable version deprecated, and gives the usual go and
exact-pair dry-run evidence. Stable preflight permits that default and still
requires all ordering, image, CI, provenance and approval gates. The successor
publishes with latest and read-back requires it healthy. Beta remains blocked
until a healthy stable latest exists. If no earlier healthy stable exists, this
forward-fix route still works. A deprecated old image is restored only to the
unchanged npm default during failed-fix cleanup; that restores consistency,
not a claim that the vulnerable release is safe. If ordering blocks the desired
hotfix, the stable-only ordering rule governs the version choice; deprecation
is not an ordering bypass. Do not roll back npm `latest` to a healthy older
stable during an incident: if done while the vulnerable greatest stable
remains in `versions`, npm and GHCR `latest` must first be restored to that
vulnerable greatest stable before the forward fix can ship.

If npm latest is behind a stable key still in `versions` (for example after
a manual dist-tag edit), stop publication with the pinned greatest-stable
diagnostic. The guide directs the owner to reconcile registry state manually
under separate authorization: restore npm latest to the greatest stable still
in `versions`, verify its exact version/timestamp and retained P evidence,
and reconcile GHCR latest to that stable's recorded versioned digest using
the byte-preserving command and GET confirmation above. A deprecated greatest
stable admits only the BR-432 forward stable fix. If records or image evidence
are unavailable, stop for owner diagnosis; no automatic fallback is allowed.
Then rerun all release gates and exact-pair dry-run/go requirements. No release
mode gains an npm dist-tag command. For any state with a valid npm default
and GHCR latest differing from S, including an unknown candidate digest,
the owner may separately authorize restore-only reconciliation to S's
recorded digest using step 4 and GET confirmation, without deleting anything;
burn any uncertain candidate version and use a new version for the next release.
If a higher stable was unpublished and is
now time-only, leave latest on the greatest remaining `versions` stable:
no npm default repair is required. If GHCR latest still names the unpublished
stable's digest, the owner reconciles it to S's recorded digest under separate
authorization using the byte-preserving command and GET confirmation above.
Choose a new candidate above the union history (for example 1.0.2 after
time-only 1.0.1); never attempt to republish it.

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
Every rule gets a named unit test and concrete boundary examples reflecting
the owner-resolved Q1/Q2 policies. No BR record is edited in this phase.
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
  verifies the matrices, owner-resolved Q1/Q2 policies, diagnostics, recovery
  command, all preserved install/pinning/mutable-tag advice and unchanged owner gates.
- **AC-38 (BR-363 v3, BR-431 v1)** — Given both history objects and candidates,
  when `BR-363 v3 BR-431 v1 ordering: %s` in `tests/release.test.ts` runs, then
  every ordering-table row has its stated result, including stable
  1.1.1 after both stable 1.1.0 and beta 1.2.0-beta.1, stable 1.0.1 after
  stable 1.0.0 and beta 1.1.0-beta.1, refusal of stable 1.0.1 after stable
  1.1.0, and refusal of beta 1.1.2-beta.1 after beta 1.2.0-beta.1.
  Given stable 1.0.5 alone,
  when testing 1.0.5-beta.1 or 1.0.4, then both refuse; 1.0.6-beta.1 passes.
  Given beta.9/beta.10, numeric components above 2^53, prerelease lexical and
  prefix cases, precedence-equal build metadata, time-only versions,
  versions-only versions, P, stage and malformed keys in either object,
  when every phase and dry-run boolean is checked, then ordering and exact
  first-failure diagnostics match this spec; created/modified alone are ignored.
- **AC-39 (BR-363 v3, BR-373 v3)** — Given a healthy older stable S and valid candidate,
  when `BR-363 v3 lifecycle phase matrix: %s` runs in `tests/release.test.ts`,
  then every table row passes only its stated npm/GHCR predicates. Given
  latest absent, beta, missing entry/time, stale stable, or reset P after
  stable history in either object, when preflight runs, then the fixed
  default diagnostic refuses it in all phases and boolean combinations.
  Given npm 404, when beta dry-run and stable dry/real or beta real are
  compared, then only beta dry-run receives the retained exception.
  Given latest 1.0.0, `versions` containing 1.0.0 and `time` also containing
  unpublished 1.0.1, when stable 1.0.2 is checked with each phase's valid GHCR
  state (S/latest before push, candidate/latest bound to this run in phase
  npm), then every preflight phase admits it; time-only 1.0.1 neither
  invalidates latest nor becomes republishable. A candidate at or below that
  time-only stable still refuses by union-history ordering.
  Given a beta and stable npm default S but GHCR latest on an orphaned stable
  candidate, when any beta preflight phase runs, then it refuses with
  `GHCR latest does not match npm stable default`. Include bootstrap latest
  absent, equal/different candidate hashes where available, S/latest missing,
  invalid indexes and unexpected status/token cases with pinned reasons.
  Given invalid/unreadable npm defaults or unsafe latest keys, when preflight
  or beta read-back runs, then it reports `npm stable default unavailable`
  under the specified prefix and makes no S/latest request. Assert the npm-404
  beta dry-run exception separately, and exact GET/Accept bytes for comparisons.
  Given an invalid npm default and a token failure configured in the preflight
  double, when preflight runs, then `npm stable default unavailable` takes
  precedence and the double receives no GHCR token or candidate request.
- **AC-40 (BR-363 v3, BR-432 v1)** — Given deprecated stable latest 1.0.0
  with no healthy earlier stable and candidate 1.0.1, when
  `BR-432 v1 deprecated stable recovery: %s` in `tests/release.test.ts` runs,
  then all stable preflight phases pass valid registry
  state, beta refuses with the exact deprecated-default diagnostic, and
  stable read-back succeeds only after latest selects healthy 1.0.1, with
  1.0.0 still deprecated. Include published 1.2.0-beta.1: the stable fix
  remains eligible. Include published stable 1.1.0 as the deprecated default:
  candidate 1.0.1 refuses with the stable-only ordering diagnostic.
  Given withheld exact-pair successful dry-run evidence in the rehearsal
  harness's owner model (as for approvals in v3 AC-32), or denied deployment
  approval in the GitHub double, when the same recovery is attempted, then
  publication never occurs. No release-check predicate reads dry-run runs
  or is added for this evidence. The human version-and-SHA go
  is checked as release-ticket evidence under AC-48, not simulated as an
  automated registry predicate.
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
  image tags to the run. Include stable 1.1.1 after stable 1.1.0 and beta
  1.2.0-beta.1: npm latest becomes 1.1.1 and GHCR latest becomes its run
  digest; the beta dist-tag need not move. Given each missing record, wrong
  version/time/tag, candidate deprecation, missing provenance, wrong tarball, changed stable
  default mapping, missing public latest or bad image hash/platform, when
  read-back runs, then it fails after bounded npm retries where applicable,
  with exactly the specified lines. Assert bootstrap regression, exactly
  20 attempts/19 waits on persistent npm failure, and zero mutation requests.
  Given a beta read-back with a valid stable default in an early npm attempt
  and an invalid or different stable default in the final attempt, when
  `image latest tag` runs after npm success or retry exhaustion, then S is
  derived only from the final document; a different valid default selects
  that final S, and an invalid final default reports
  `npm stable default unavailable` without S/latest requests.
- **AC-43 (BR-433 v1, BR-354 v3)** — Given a digest-keyed registry double
  holding old S and partially published candidate/latest, when
  `BR-433 v1 byte preserving restoration: %s` in `tests/release.test.ts`
  extracts and executes the guide's single fenced recovery block verbatim
  (digest-format guard, exact imagetools command and raw GET/hash confirmation)
  through fake Docker and the registry double, then it restores raw bytes before candidate deletion;
  deletion removes all tags on the candidate digest and leaves S/latest.
  Given post-stable beta cleanup with npm candidate absent and healthy S,
  when the beta branch runs, then it deletes only the distinct candidate
  package version without repointing latest and confirms candidate GET 404,
  npm absence, npm latest still S and unchanged S/latest raw GET hashes.
  Given a copy that reserializes JSON, matching HEAD with changed GET bytes,
  failed copy, missing S, same prior/candidate digest, extra candidate tags,
  missing evidence, changed default or failed cleanup confirmation, when
  recovery runs, then it prints the precise blocked state and performs no
  dependent deletion or publication. Assert both bootstrap and prior-stable
  branches, no empty digest command, and no deletion after npm acceptance.
  Given both image tags pushed but no candidate digest recorded and same-run
  retry unavailable, when the restore-only branch runs with certain npm
  absence and prior S read-back evidence, then GET confirms S/latest restored
  to `previous_digest`, no deletion occurs, the candidate version is burned
  and the next release requires a new version.
- **AC-44 (BR-354 v3, BR-432 v1, BR-433 v1)** — Given the existing real
  release entry paths and bounded Git/GitHub/npm/GHCR doubles plus fake
  npm/Docker, when `F-024 v4 lifecycle rehearsal: %s` in
  `tests/release.test.ts` runs end to end, then later stable, post-stable
  beta and deprecated-default fix execute verify, approvals, image, npm and
  read-back in order with exact argv and digest forwarding. Rehearse stable
  1.1.1 after stable 1.1.0 and beta 1.2.0-beta.1: GHCR latest advances during
  image publication, then npm latest advances during npm publication.
  Rehearse the deprecated-default fix without removing its deprecation,
  including when no healthy earlier stable exists. Refused stable 1.0.1
  after stable 1.1.0 and beta 1.1.2-beta.1 after beta 1.2.0-beta.1 stop before
  either publication. Given denied or
  expired second approval, npm preflight/publish failure, partial image push,
  uncertain npm success, cancelled/expired retry or missing artifact,
  when recovery runs, then same-run npm retry is preferred,
  every gate is rechecked, cleanup is owner-only and restoration precedes
  deletion; new dispatch requires fresh dry run/go and eligible main version.
  Given main advances after image publication while the original run and
  artifacts remain eligible, when the owner retries only publish-npm, then
  the original HEAD/ancestry/GITHUB_SHA gates still pass and npm retry remains
  available; redispatch of that old commit refuses. Rehearse separately the
  unavailable-retry path that needs cleanup and a new eligible main version.
  Given a partial stable push leaves GHCR latest on the orphan while npm
  latest is S, when a beta is attempted, then verify refuses before either
  publication; after owner restoration/cleanup, beta passes with defaults
  unchanged. Rehearse post-stable beta cleanup's explicit step-5 end state.
  Given npm latest behind a stable still in `versions`, when owner recovery
  is rehearsed, then publication first refuses, manual separately authorized
  npm/GHCR default reconciliation restores matching greatest-stable defaults,
  and fresh gates admit an eligible new candidate.
  Given vulnerable deprecated greatest stable 1.1.0 still in `versions` and
  npm latest rolled back to healthy 1.0.0, when the rehearsal attempts a fix,
  then it refuses with `npm latest is not the greatest published stable version`;
  separately authorized npm/GHCR reconciliation first restores defaults to
  deprecated 1.1.0, after which stable 1.1.1 passes all gates and beta refuses.
  Include time-only 1.0.1 above latest 1.0.0: stable 1.0.2 needs no npm
  default repair. Given GHCR
  latest still names unpublished 1.0.1's digest, when the owner separately
  authorizes reconciliation, then the byte-preserving command restores it
  to S's recorded digest, GET confirms equality, and fresh gates admit 1.0.2.
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
  Reject promoting GHCR latest only after npm succeeds: it needs
  `packages: write` in a post-npm job, a workflow contract change. The owner
  chose option A on 2026-11-17 (#91), accepting the v4 timing-risk extension
  recorded below while keeping the existing workflow contract.
- **D-2 Kind-specific ordering (Q1).** Select stable candidates greater than
  every published stable and beta candidates greater than every published
  version except P (owner decision 2026-11-17, issue #91). Use both history
  objects, exact integers and build-metadata equivalence. Published betas do
  not block stable fixes: 1.1.1 after 1.1.0 and 1.2.0-beta.1 is eligible.
  Every admitted stable exceeds current stable latest and moves both npm
  latest and GHCR latest through the existing publication sequence. Betas
  leave both defaults untouched. Refuse stable 1.0.1 after stable 1.1.0 and
  beta 1.1.2-beta.1 after beta 1.2.0-beta.1. Reject the draft's option A
  (both kinds above all history), because future betas would block forward
  stable fixes. Reject option B (beta ordering only against stables and
  same-base betas), because it allows the beta channel to move backwards.
  Reject option C (independent maintenance lines for both kinds), because
  it admits stable hotfixes below a published stable. Reject dist-tags-only
  ordering because movable tags can hide published history.
- **D-3 Copy and verify raw bytes.** Use the existing Docker buildx toolchain's
  single-source imagetools command and raw GET hashes. Reject rebuilds,
  JSON reconstruction, multi-source creation and HEAD-only proof because
  they cannot prove preservation of the prior index digest. Command exit
  alone is not deletion authority. Actual tool behavior is qualified in AC-46.
- **D-4 Forward-only npm recovery.** Retain same-run owner npm retry before
  owner cleanup, and no npm deletion/republish after acceptance. Reject
  automatic rollback or agent-issued registry commands because uncertain
  outcomes and digest-wide deletion require owner reconciliation. Select Q2
  option A: a gated forward stable fix while the vulnerable default remains
  deprecated, even without a healthy earlier stable (owner decision
  2026-11-17, issue #91). Beta remains blocked until healthy stable latest;
  the fixed successor must read back healthy. No deprecation removal,
  ordering bypass, new secret, bypass flag or npm mutation command is added.
  Reject Q2 option B (first repoint npm latest to a healthy prior stable),
  because it requires an exception to the greatest-stable-default predicate
  and has no recovery path when no healthy prior stable exists.
- **D-5 Preserve accepted contracts and evidence.** Archive v3 verbatim,
  version four same-purpose BRs, allocate BR-431–BR-433 provisionally and
  leave implementation records pending. Reject rewriting v3 evidence or
  claiming current registry state from a historical fixture. No ADR is
  allocated for these reversible script/guide choices; the resolved release
  policies are recorded in D-2 and D-4.

## Open questions

## Residual risks

The owner-accepted v3 mutable GHCR latest risk remains: any other
same-repository workflow with `packages: write` can move latest.
The non-atomic registry timing gap is extended in v4: unlike v3's first
latest with no existing consumers, later stable publication moves existing
latest consumers to a candidate npm may never receive. If the run is abandoned,
the exposure has no time bound until owner restoration. Status:
**accepted by the owner 2026-11-17 (#91)** (option A).
Digest pinning remains recommended. Image signing remains deferred to #92.
The v3 temporary "no gated release after 1.0.0" limitation is resolved only
when v4 passes acceptance. Under the owner-selected policies (2026-11-17,
issue #91), lower-line stable hotfixes below a published stable remain refused,
and a deprecated default can remain exposed until a gated forward fix succeeds.
Rolling npm latest back to a healthy older stable while the vulnerable
greatest stable remains in `versions` blocks that fix: the owner must first
restore npm and GHCR latest to the vulnerable greatest stable under separate
authorization. The freeze notification must name this rollback consequence
and the v4 timing-risk extension, including its owner-accepted status.
No command creates a registry-wide transaction; external writes between
checks remain possible. Recovery stops on uncertainty rather than treating
check-before-delete as an atomic guarantee.

## Stress-test

Inherited dispositions use the supplied `91-spec-review-1-opus` coverage summary and the preserved v3 Stress-test; they do not claim a new forge read.

- **91-spec-review-3-opus finding 1: retained** — AC-39 adds invalid-default precedence over a configured token failure and asserts no GHCR token or candidate request.
- **91-spec-review-3-opus finding 2: retained** — AC-42 adds early-valid/final-invalid-or-different npm documents for beta image-latest read-back, deriving S only from the final attempt and refusing an invalid final default with the fixed diagnostic.

- **91-spec-decision-1-fable finding 1: retained** — Step 3 and AC-43 add restore-only recovery with prior read-back evidence, no deletion and a burned candidate version; reconciliation covers any valid npm default with mismatching GHCR latest.
- **91-spec-decision-1-fable finding 2: retained** — The BR-432 guide paragraph and Residual risks state that rollback requires restoration to the vulnerable greatest stable first; AC-44 rehearses rollback plus deprecated greatest stable, and freeze notification must name the consequence.
- **91-spec-decision-1-fable finding 3: retained** — Residual risks records the v4 timing-risk extension as accepted by the owner 2026-11-17 (#91), requires it in the freeze notification, and D-1 rejects post-npm promotion because it changes workflow permissions and contract.
- **91-spec-decision-1-fable finding 4: retained** — AC-40 places dry-run evidence in the rehearsal harness's owner model, as in v3 AC-32, and explicitly adds no release-check predicate; AC-48 retains human ticket evidence.
- **91-spec-decision-1-fable finding 5: retained** — Step 4 requires one executable guide block with the format guard, command and raw GET/hash confirmation; AC-43 executes it verbatim, and the guide names the buildx version qualified in AC-46.
- **91-spec-decision-1-fable finding 6: retained** — Verified-by lists now include AC-39 for BR-373 v3, AC-43/AC-48 for BR-354 v3 and AC-46 for BR-433 v1.
- **91-spec-decision-1-fable finding 7: retained** — Invalid preflight defaults precede token acquisition and suppress all GHCR requests; beta image-latest read-back uses the final npm attempt's document.

- **89-spec-review-1-opus R1-1: retained** — SemVer and npm preflight predicates, D-2 and AC-38 compare union history with exact precedence under the owner-resolved kind-specific ordering.
- **89-spec-review-1-opus R1-2: retained** — Registry phase matrix, D-1 and AC-41 compare prior S before stable image push and this run's digest in phase npm, avoiding comparison to the displaced S.
- **89-spec-review-1-opus R1-3: retained** — BR-433, recovery steps 3–5 and AC-43 restore and verify prior-default bytes before digest-wide candidate deletion.
- **89-spec-review-1-opus R1-4: retained** — BR-354 preserves install advice and retained BR-355 keeps VERSION-dependent install edits in release preparation, outside this draft's scope.
- **89-spec-review-1-opus R1-5: retained** — Implementation baseline, retained BR-359/368–370 and AC-41/45 retain validated buildx digest binding for stable only.
- **89-spec-review-1-opus R1-6: retained** — Registry conditions and AC-41 require raw GET hashes with the identical Accept header; HEAD digests never prove equality.
- **89-spec-review-1-opus R1-7: retained** — BR-372/373, beta phase rows and AC-39/42/44 explicitly define beta after stable with unchanged defaults.
- **89-spec-review-1-opus R1-8: retained** — Exact diagnostics and output plus AC-45 pin failures, precedence, suppression and removal of obsolete executable messages.
- **89-spec-review-1-opus R1-9: retained** — BR record preparation and D-5 preserve accepted v2 evidence beside pending v3 definitions until actual-main acceptance.
- **89-spec-review-1-opus R1-10: retained** — Business rules declares BR-431–BR-433 provisional and requires main allocation checks before freeze and PR, without author-environment claims.
- **89-spec-review-1-opus R1-11: retained** — AC-43–48 separate doubles, command qualification, actual-main acceptance and human per-release go evidence; AC-40 withholds only dry-run evidence/approval that doubles control.
- **89-spec-review-1-opus R1-12: retained** — BR-354 and recovery step 5 preserve pre-stable v2 D-8 recovery and append explicit stable and post-stable beta branches.
- **89-spec-review-2-opus R2-1: retained** — Scope and Out of scope defer guide implementation; this correction task edits only the spec and index.
- **89-spec-review-2-opus R2-2: retained** — Kind/phase rows and AC-39 separate stable and beta, retaining beta dry-run npm 404 while defining the new default checks.
- **89-spec-review-2-opus R2-3: retained** — SemVer predicates and AC-38 ignore exactly time.created/time.modified and reject every other malformed key before ordering.
- **89-spec-review-2-opus R2-4: retained** — Recovery steps 4–5 and AC-43 model package-version deletion removing all attached digest tags, after prior-default restoration where applicable.
- **89-spec-review-2-opus R2-5: retained** — BR-432, D-4 and AC-40/44 define owner-selected deprecated-stable forward recovery, including no healthy prior stable.
- **89-spec-review-2-opus R2-6: retained** — Exact diagnostics and output plus AC-45 pin new preflight/read-back lines, input failures and suppression cases.
- **89-spec-review-2-opus R2-7: retained** — BR-354 and retained BR-355 preserve stable-VERSION install ownership in release preparation; no README/SPEC install edits enter this draft.
- **89-spec-review-2-opus R2-8: retained** — Recovery steps 4–5 and AC-43 explicitly guard empty prior digests and keep bootstrap free of any previous-tag loop or repoint.
- **89-spec-review-2-opus R2-9: retained** — Implementation baseline, Scope, retained BR-356–359/368–370/375 and AC-45 preserve Make forwarding, image metadata and workflow outputs.
- **89-spec-review-2-opus R2-10: retained** — Ordering table, BR-431, D-2 and AC-38 define both kinds explicitly under Q1; historical first-stable ordering is replaced by the owner-resolved stable-only comparison.
- **91-spec-review-1-opus finding 1: retained** — Recovery step 2 and AC-44 keep same-run retry available after main advances; step 6 alone blocks redispatch of the old commit.
- **91-spec-review-1-opus finding 2: retained** — Default validity uses versions-only greatest stable, ordering retains union history, AC-39 covers time-only 1.0.1 and admitted 1.0.2, and recovery/AC-44 cover owner reconciliation of latest behind.
- **91-spec-review-1-opus finding 3: retained** — Every beta preflight row now checks GHCR defaults, diagnostics pin its reasons, and AC-39/44 refuse an orphaned stable latest before beta publication.
- **91-spec-review-1-opus finding 4: retained** — Only a validated plain stable default supplies S; invalid/unreadable defaults use the pinned unavailable reason without S/latest requests in preflight and beta read-back, tested by AC-39.
- **91-spec-review-1-opus finding 5: retained** — BR-432 states the automated kind predicate; retained v3 gates and AC-48 carry human go evidence separately, while AC-40 withholds dry-run evidence/deployment approval only.
- **91-spec-review-1-opus finding 6: retained** — Recovery step 5 and AC-43/44 specify post-stable beta npm absence, candidate package-version deletion/GET 404 and unchanged S/latest without repointing.
- **91-spec-review-1-opus finding 7: retained** — Provisional allocation wording replaces the highest-file worktree observation, preserving IDs and main rechecks.
- **91-spec-review-1-opus finding 8: retained** — Removed the stale comment-fetch statement and recorded one disposition per inherited and current finding here, using the supplied summary and preserved historical dispositions.
- **91-spec-review-1-opus finding 9: retained** — The F-024 index row records Q1/Q2 resolved on 2026-11-17 (#91) and ready-for-freeze status, matching the spec.
- **91-spec-review-2-opus finding 1: retained** — The time-only stable recovery case requires no npm default repair but reconciles a stale GHCR latest to S's recorded digest with the byte-preserving command and GET confirmation; AC-44 rehearses that mismatch variant.
- **91-spec-review-2-opus finding 2: retained** — Beta bootstrap verify/image use `GHCR latest exists without a stable npm default`; phase npm and read-back retain `latest names the release` when candidate comparison cannot prove a different digest.
- **91-spec-review-2-opus finding 3: retained** — AC-39 links BR-373 v3 for beta image read-back, and BR-363 v3's change list explicitly includes the GHCR default check in every beta preflight phase.

Frozen on 2026-11-17 at `ad3928e` (autonomous freeze, PROJECT.md D-1) after
`91-spec-review-2-opus` (strong tier, approve), `91-spec-decision-1-fable`
(strongest tier, approve), and the diff-only confirmations
`91-spec-review-3-opus` and `91-spec-review-4-opus` (approve) of the minors
folded in since; owner decisions Q1, Q2 and decision-pass finding 3 (option
A) on #91; freeze record on #91.

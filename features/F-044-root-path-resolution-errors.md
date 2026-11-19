---
id: F-044
title: Root path resolution errors
ticket: "#88"
status: done
version: 1
---

## Context

Accepted on actual main `3f6e291` on 2026-11-19 ([#88 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/88#issuecomment-7005778721)).
BR-021 v2 and BR-207 v2 are active.

Startup users can select a root such as `7:/Documents`. If no child has that
exact name, startup reports `PREFLIGHT_FAILED (preflight)`. This suggests a
token or network problem instead of an unresolved root.

`child` already reads every listing page and compares names exactly.
It throws `readUnavailable()` for zero or several matches.
`resolveDirectory` also throws when an intermediate match is a file.
`resolveConfiguredRoot` maps every resolver rejection to `PREFLIGHT_FAILED`.
A returned final file already gives `ROOT_NOT_RESOLVED (roots)`.

Sources: [BR-021 v1](../business-rules/BR-021.md), accepted under
[F-002 v2](history/F-002-v2.md), and
[BR-207 v1](../business-rules/BR-207.md), accepted under
[F-014 v1](history/F-014-v1.md). Their existing tests are in
`tests/config-preflight.test.ts`, `tests/config-selection-boundaries.test.ts`
and `tests/kdrive/adapter-preflight.test.ts`.

## Scope

Classify path resolution failures through the production adapter and
configuration preflight. The change touches only startup preflight:
`createPreflight` in `src/kdrive/adapter.ts`, called from `src/config.ts`.
Runtime tool errors and codes are unchanged. Preserve fail-closed startup and
sanitized diagnostics. Version BR-021 and BR-207 in place. Allocate no new BR
or ADR.

The existing `TestBR207_%s_gives_PREFLIGHT_FAILED` tests in
`tests/kdrive/adapter-preflight.test.ts` pin `PREFLIGHT_FAILED` for
"file as intermediate", "missing name" and "duplicated name". Under BR-207 v2,
re-expect these three cases as `ROOT_NOT_RESOLVED (roots)` and rename them.
Never delete them. "init 401" and "missing ID root" stay `PREFLIGHT_FAILED`.

F-044 was the next free feature ID on `main` on 2026-11-19 (checked by the
orchestrator). Re-check before the PR is marked ready.

This is an error classification change. It changes no authorization decision
or permitted root. It is not security-sensitive.

### Out of scope

- README changes, tracked in #99.
- Any other error code or setting, including numeric ID lookup failures.
- Root syntax, case folding, Unicode normalization or path rebinding.
- Request counts, pagination, retries, caching or preflight budget changes.
- Code, tests, BR files, acceptance records or freeze in this drafting task.

## Business rules

Both v2 rules below are proposed by F-044 v1. Each v1 stays the accepted rule
until its v2 acceptance on actual `main`. Keep both IDs and their prior text
and history. Follow the pending-version pattern in
[BR-016](../business-rules/BR-016.md) and
[BR-178](../business-rules/BR-178.md). Later implementation records v2 as
pending acceptance, adds a dated F-044 history entry and updates verification.
This draft does not activate either version.

- **BR-021 v2** — v1 holds with this addition: a path selector that cannot
  resolve because any component has zero exact-name matches, several
  exact-name matches or a non-directory match fails the entire preflight with
  `ROOT_NOT_RESOLVED (roots)`. An upstream HTTP error, timeout or malformed
  kDrive response during resolution still gives `PREFLIGHT_FAILED (preflight)`.
  This refines v1's sentence “Absent, ambiguous, wrong-ID, wrong-drive,
  non-directory, malformed or rejected results fail the entire preflight.”
  Rejected callbacks still give `PREFLIGHT_FAILED`; explicit unresolved
  results give `ROOT_NOT_RESOLVED`. A malformed resolver return value keeps
  the v1 `ROOT_NOT_RESOLVED` mapping. Other v1 validation and error mappings
  remain intact. No partial configuration escapes and no later selector runs
  after a failure. Verified by: AC-01–AC-07.
- **BR-207 v2** — v1 holds with two replacements. Remove “a non-directory
  intermediate component, zero or several matches for a component” from v1's
  rejection list. `resolveDirectory` resolves to `null` when a path component
  has zero exact-name matches, several exact-name matches or a non-directory
  match. This includes a final file. A unique final directory match still
  returns its directory record. Replace “`src/config.ts`
  maps any rejection to `PREFLIGHT_FAILED`, and a resolved non-directory to
  `ROOT_NOT_RESOLVED`” with: explicit unresolved path results and returned
  non-directories map to `ROOT_NOT_RESOLVED (roots)`; upstream failures and
  other rejections map to `PREFLIGHT_FAILED (preflight)`. A malformed kDrive
  response rejects and gives `PREFLIGHT_FAILED (preflight)`. A malformed
  resolver return value keeps the v1 `ROOT_NOT_RESOLVED` mapping. Missing ID
  metadata and the 64-component, 1,024-request and 120,000 ms bounds retain
  v1 behavior.
  `inspectDrive` is unchanged. Names still match exactly and case-sensitively.
  Each component uses the same complete listing pages as v1. The request
  sequence and count stay unchanged for identical responses. No probe or retry
  is added. Verified by: AC-01–AC-08.

## Acceptance criteria

The named tests below are planned, not implemented or executed by this draft.
Use synthetic drives and responses. Unless stated otherwise, drive `7` is
`admin`, its root is ID `1`, and listings are valid single pages.
Assert both `code` and `setting` on every configuration failure.

AC-01–AC-06 run through the production adapter and `preflightConfiguration`
in `tests/kdrive/adapter-preflight.test.ts`. For failures, include an earlier
valid selector and a later selector. Assert no partial configuration escapes
and the later selector sends no request. Test names start with `BR-207 v2`.

- **AC-01 (BR-021 v2, BR-207 v2)** — Given `7:/Documents` and zero children
  named `Documents`, When preflight runs, Then it fails with
  `ROOT_NOT_RESOLVED (roots)`. Init is counted once per configured drive for
  the whole preflight, including the earlier valid selector. The failing
  selector sends one listing request. Earlier-selector listing requests are
  counted separately.
  Verified by: `BR-207 v2 missing first component gives ROOT_NOT_RESOLVED`.
  An adapter unit test, `BR-207 v2 unresolved components resolve to null`,
  asserts `null` directly for zero matches, several matches and a
  non-directory match at an intermediate or final component.
- **AC-02 (BR-021 v2, BR-207 v2)** — Given `7:/Documents` and two distinct
  children named `Documents`, When preflight runs, Then it fails with
  `ROOT_NOT_RESOLVED (roots)`, whether both are directories or one is a file.
  Verified by: `BR-207 v2 ambiguous component gives ROOT_NOT_RESOLVED`.
- **AC-03 (BR-021 v2, BR-207 v2)** — Given a unique file at the first or
  deeper component, When preflight resolves `7:/Documents`,
  `7:/Documents/Reports` or `7:/Documents/Reports/Archive`, Then a file at
  either the final or an intermediate component fails with
  `ROOT_NOT_RESOLVED (roots)`. No listing request is sent beneath a file.
  Verified by:
  `BR-207 v2 file at final or intermediate component gives ROOT_NOT_RESOLVED`.
- **AC-04 (BR-021 v2, BR-207 v2)** — Given `7:/Documents/Reports`, a unique
  directory `Documents` at ID `10`, and separately zero, two or one directory
  matches named `Reports` beneath it, When preflight runs, Then zero and two
  fail with `ROOT_NOT_RESOLVED (roots)`, while one directory at ID `11`
  resolves to `{driveId:7, folderId:11}`. Verified by:
  `BR-207 v2 deeper component resolves only one exact directory`.
- **AC-05 (BR-021 v2, BR-207 v2)** — Given `7:/Documents` and separately only
  `documents`, or both `documents` and one directory named `Documents`, When
  preflight runs, Then the first case fails with `ROOT_NOT_RESOLVED (roots)`
  and the second resolves the exact `Documents` directory. Verified by:
  `BR-207 v2 component matching remains case sensitive`.
- **AC-06 (BR-021 v2, BR-207 v2)** — Given a two-page listing, When preflight
  resolves `7:/Documents`, Then no match on page 1 and one directory match on
  page 2 resolves. One match on each page fails with
  `ROOT_NOT_RESOLVED (roots)`. Zero across both pages also fails with that
  code and setting. All three cases read both pages once: the failing or
  resolving selector sends two listing requests. Init is counted once per
  configured drive for the whole preflight. Verified by:
  `BR-207 v2 complete pagination determines unique path matches`.
- **AC-07 (BR-021 v2, BR-207 v2)** — Given `7:/Documents/Reports`, When an
  HTTP error, timeout or malformed kDrive response occurs at the first or
  deeper component, Then preflight fails with `PREFLIGHT_FAILED (preflight)`.
  A failure on a later listing page still gives that result after zero, one
  or several matches on earlier pages. No retry or later selector runs.
  Verified by: `BR-207 v2 upstream failures at every component remain PREFLIGHT_FAILED`
  in `tests/kdrive/adapter-preflight.test.ts`, and
  `BR-021 v2 unresolved results and resolver rejections remain distinct`
  in `tests/config-preflight.test.ts`. The latter checks explicit unresolved
  results, returned files, malformed resolver return values and unexpected
  callback rejections separately. Malformed resolver return values keep the
  v1 `ROOT_NOT_RESOLVED (roots)` mapping.
- **AC-08 (BR-207 v2)** — Given the same synthetic responses as v1 for a
  successful path, missing name, duplicate name, intermediate file, final
  file, paginated path or upstream failure, When preflight runs, Then its
  ordered kDrive request trace and count equal the v1 trace. Complete pages
  are consumed even after multiple matches appear. Missing numeric ID, init
  failure and existing budget failures retain their codes and request bounds.
  Verified by: `BR-207 v2 classification preserves request traces` in
  `tests/kdrive/adapter-preflight.test.ts`, with pre-change characterization
  traces and the existing `TestBR207_*` budget and numeric-ID cases. Rename
  and re-expect the existing `TestBR207_%s_gives_PREFLIGHT_FAILED` cases
  "file as intermediate", "missing name" and "duplicated name" as
  `ROOT_NOT_RESOLVED (roots)` under BR-207 v2. Never delete these three cases.
  "init 401" and "missing ID root" stay `PREFLIGHT_FAILED`.

## Decisions

- Use `null` as the unresolved result from `resolveDirectory` for zero
  matches, several matches or a non-directory match at any path component.
  `src/config.ts` already maps any non-directory-record value to
  `ROOT_NOT_RESOLVED (roots)`. A malformed resolver return value keeps this
  v1 mapping. Keep callback rejections for upstream and other operational
  failures, including a malformed kDrive response, which gives
  `PREFLIGHT_FAILED (preflight)`. Do not classify by exception message. This
  preserves the configuration error boundary.
- Reject a new error code. `ROOT_NOT_RESOLVED (roots)` already describes the
  failure and keeps the public diagnostic format stable.
- Reject case-insensitive matching. It changes which directory is selected
  and can introduce new ambiguities.
- Reject early success or early ambiguity termination within a listing.
  Complete pagination preserves request counts and detects later upstream
  failures. Do not add metadata probes to explain missing names.
- Keep numeric-ID failures and budget failures unchanged. They are outside
  this path classification correction.
- Version both existing BRs instead of allocating replacements. Their
  purposes remain root validation and adapter preflight resolution.

## Open questions

## Stress-test

- Round 1, finding 1: retained — Scope and AC-08 require renaming and
  re-expecting the three existing path failure cases as
  `ROOT_NOT_RESOLVED (roots)` under BR-207 v2. They are never deleted. Init 401 and missing ID
  root keep `PREFLIGHT_FAILED`.
- Round 1, finding 2: retained — `resolveDirectory` resolves to `null` for
  zero matches, several matches or a non-directory match. Decisions names the
  existing `src/config.ts` mapping. AC-01 adds a direct adapter unit
  assertion of `null`.
- Round 1, finding 3: retained — Malformed kDrive responses reject with
  `PREFLIGHT_FAILED`. Malformed resolver return values keep the v1
  `ROOT_NOT_RESOLVED` mapping.
- Round 1, finding 4: retained — Scope limits the change to startup
  `createPreflight`, called from `src/config.ts`. Runtime tool errors and
  codes stay unchanged.
- Round 1, finding 5: retained — AC-01 counts init once per configured drive
  for the whole preflight. It counts the failing selector's listing request
  separately.
- Round 1, finding 6: retained — Scope records the orchestrator's feature ID
  check on `main` on 2026-11-19 and requires a re-check before PR readiness.

- Round 2 (diff-only), finding 1: retained — AC-06 counts requests with the
  AC-01 wording.

Frozen on 2026-11-19 (autonomous freeze, PROJECT.md D-1) after
`88-spec-review-2-opus` (strong tier, approve); freeze record on #88.

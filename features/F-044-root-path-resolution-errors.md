---
id: F-044
title: Root path resolution errors
ticket: "#88"
status: draft
version: 1
---

## Context

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
configuration preflight. Preserve fail-closed startup and sanitized diagnostics.
Version BR-021 and BR-207 in place. Allocate no new BR or ADR.

F-044 is the next free feature ID in this worktree and the local `main` tree.
F-043 is the highest existing feature ID. Remote allocation is not checked.

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
  response during resolution still gives `PREFLIGHT_FAILED (preflight)`.
  This refines v1's sentence “Absent, ambiguous, wrong-ID, wrong-drive,
  non-directory, malformed or rejected results fail the entire preflight.”
  Rejected callbacks still give `PREFLIGHT_FAILED`; explicit unresolved
  results give `ROOT_NOT_RESOLVED`. Other v1 validation and error mappings
  remain intact. No partial configuration escapes and no later selector runs
  after a failure. Verified by: AC-01–AC-07.
- **BR-207 v2** — v1 holds with two replacements. Remove “a non-directory
  intermediate component, zero or several matches for a component” from v1's
  rejection list. For these path outcomes, `resolveDirectory` returns an
  explicit unresolved result instead of rejecting. A unique final match
  still returns its own `type`, including `file`. Replace “`src/config.ts`
  maps any rejection to `PREFLIGHT_FAILED`, and a resolved non-directory to
  `ROOT_NOT_RESOLVED`” with: explicit unresolved path results and returned
  non-directories map to `ROOT_NOT_RESOLVED (roots)`; upstream failures and
  other rejections map to `PREFLIGHT_FAILED (preflight)`. Missing ID metadata
  and the 64-component, 1,024-request and 120,000 ms bounds retain v1 behavior.
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
  `ROOT_NOT_RESOLVED (roots)` after one init and one listing request.
  Verified by: `BR-207 v2 missing first component gives ROOT_NOT_RESOLVED`.
  The request count excludes the shared earlier-selector setup.
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
  code and setting. All three cases read both pages once, for one init and
  two listing requests excluding earlier-selector setup. Verified by:
  `BR-207 v2 complete pagination determines unique path matches`.
- **AC-07 (BR-021 v2, BR-207 v2)** — Given `7:/Documents/Reports`, When an
  HTTP error, timeout or malformed response occurs at the first or deeper
  component, Then preflight fails with `PREFLIGHT_FAILED (preflight)`.
  A failure on a later listing page still gives that result after zero, one
  or several matches on earlier pages. No retry or later selector runs.
  Verified by: `BR-207 v2 upstream failures at every component remain PREFLIGHT_FAILED`
  in `tests/kdrive/adapter-preflight.test.ts`, and
  `BR-021 v2 unresolved results and resolver rejections remain distinct`
  in `tests/config-preflight.test.ts`. The latter checks explicit unresolved
  results, returned files and unexpected callback rejections separately.
- **AC-08 (BR-207 v2)** — Given the same synthetic responses as v1 for a
  successful path, missing name, duplicate name, intermediate file, final
  file, paginated path or upstream failure, When preflight runs, Then its
  ordered kDrive request trace and count equal the v1 trace. Complete pages
  are consumed even after multiple matches appear. Missing numeric ID, init
  failure and existing budget failures retain their codes and request bounds.
  Verified by: `BR-207 v2 classification preserves request traces` in
  `tests/kdrive/adapter-preflight.test.ts`, with pre-change characterization
  traces and the existing `TestBR207_*` budget and numeric-ID cases.

## Decisions

- Use the existing explicit unresolved-result channel. Keep callback
  rejections for upstream and other operational failures. Do not classify by
  exception message. This preserves the configuration error boundary.
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

Independent spec review is pending. This document remains a draft.

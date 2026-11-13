---
id: F-025
title: Changelog release sections
ticket: "#2"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-13.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `698d9db`. IDs: F-025,
BR-321 v3; no new BR ID, no ADR. `#2` is this repository's ticket.

## Context

`0.6.0-beta.1` was released on 2026-11-13: tag `v0.6.0-beta.1` on `163e701`,
published to npm and GHCR. AGENTS.md §7 says that at a release the Unreleased
entries of `CHANGELOG.md` are promoted to a version section. BR-321 v1
(F-020 v1) requires the #104 `### Fixed` and `### Added` lines under
`## [Unreleased]`, and `TestBR321_audit_docs` reads only that section. The
promotion would therefore turn the test red, so release PR #14 kept every
entry under Unreleased and added a temporary note at the top of
`CHANGELOG.md`. The owner decided that the BR-321 update and the promotion
come in this records PR.

Users affected: readers of `CHANGELOG.md` (operators and contributors, who
see which changes shipped in `0.6.0-beta.1`) and maintainers and agents
(release records, the content test). The MCP server, CI and the release
workflow are unaffected.

## Scope

1. **Release section format (Keep a Changelog).** A release section starts
   with a level-2 heading of the form `## [<version>] - <YYYY-MM-DD>`, here
   `## [0.6.0-beta.1] - 2026-11-13`: the SemVer version in square brackets,
   one space, a hyphen, one space, the ISO release date. A level-2 heading
   without the date (for example `## [0.7.0]`) is not a release section.
   `## [Unreleased]` stays the first level-2 section of the file; release
   sections follow it, newest first. `## [Unreleased]` may be empty after a
   promotion (heading only, no `###` subsection).
2. **Promotion.** Every entry currently under `## [Unreleased]` moves, with
   its `###` subsection (`Added`, `Changed`, `Fixed`, `Removed`) and order
   unchanged, into a new `## [0.6.0-beta.1] - 2026-11-13` section placed
   directly after `## [Unreleased]`. No entry is reworded, merged or dropped
   (AC-06).
3. **Temporary note.** The paragraph that PR #14 added between the
   introduction line and `## [Unreleased]` (it starts "Version
   `0.6.0-beta.1` (2026-11-13) is the first public beta") is removed. The
   introduction line ("User-facing changes follow Keep a Changelog and
   Semantic Versioning.") stays.
4. **Entry changed after the tag.** The records-sync commit `698d9db`
   changed one line of one entry in `CHANGELOG.md`: the first line of the
   `### Added` entry `#2 / F-024 v2`, where `(pending acceptance)` became
   `(accepted 2026-11-13)`. This is a records update of an entry that
   shipped in `0.6.0-beta.1`; it stays part of that entry and moves with it
   into the release section in its current wording. No separate Unreleased
   entry is written for it (D-3).
5. **BR-321 v3.** `business-rules/BR-321.md` goes to v3 (status `pending
   acceptance`, source F-025 v1) with the rule text of § Business rules, and
   `TestBR321_audit_docs` in `tests/dependency-audit.test.ts` is updated to
   that rule (AC-01–AC-05). In `BR-321.md`:
   - **Examples**: the two docs examples stay; the `CHANGELOG.md` example is
     replaced by two, one per side of the release-section/Unreleased
     boundary: "Given a changelog with a release section, When the content
     test runs, Then the first release section citing #104 has the #104
     Fixed and Added lines" (AC-01, AC-02, AC-03, AC-05), and "Given a
     changelog with no release section, When the content test runs, Then
     `## [Unreleased]` has the #104 Fixed and Added lines" (AC-04).
   - **Verification**: names `tests/dependency-audit.test.ts`
     (`TestBR321_audit_docs`, the cases of AC-01–AC-05), review, and
     `make check`.
   - **History**: v1 and its acceptance line are kept, followed by exactly
     these two lines, in this order:
     - `v2 — 2026-11-12 — F-024 v1 — proposed, withdrawn in F-024 v2, never accepted; number not reused`
     - `v3 — 2026-11-13 — F-025 v1 (#2) — CHANGELOG.md location moved to the first release section citing #104; pending acceptance`

   Index updates: `business-rules/README.md` (the status sentence around
   line 20, the withdrawal note around lines 671-673 and the BR-321 row)
   and `docs/spec-index.md:111` record F-025 v1 and say "BR-321 v3"
   (pending acceptance); they keep stating that the BR-321 v2 of F-024 v1
   was withdrawn. `capability-map.md` records F-025 v1 and BR-321 v3.
6. **No changelog entry for F-025.** This change has no user-facing effect;
   `## [Unreleased]` is empty after the promotion.

### Out of scope

- Any product change (source under `src/`, the MCP tools, configuration).
- Any CI change (`.github/workflows/`, Make targets, gates) and any change
  to the release workflow (`release.yml`, `make release-*`) or to `VERSION`
  and `package.json`.
- Automating the promotion, link reference definitions for version
  headings, and any rewording of existing entries.
- Every part of BR-321 other than its `CHANGELOG.md` sentence.

## Business rules

- **BR-321 v3** (supersedes BR-321 v1, same purpose: dependency audit
  documentation; v2 was proposed in F-024 v1 and withdrawn, D-4) —
  `docs/development.md` no longer states that the audit is not clean; its
  dependency-audit paragraph names the BR-315 overrides, ADR-009,
  `make audit` and the CI `audit` job. `SECURITY.md` has a section
  `## Dependency audit` stating that CI fails on any high or critical `npm
  audit` finding, that a new one is fixed before a release, not allowlisted,
  and that the overrides do not apply to an install of the packed tarball
  (`npm install -g`), which can resolve Jimp's nested Zod 3 again.
  `CHANGELOG.md` has a `### Fixed` line for the advisories and an `### Added`
  line for `make audit` and the CI job, both citing #104, located as
  follows. A release section is a level-2 section whose heading has the
  form `## [<version>] - <YYYY-MM-DD>`; a heading without the date is not
  one. A line cites #104 when it matches `#104\b` (`#1040` does not cite
  #104). If any release section exists, a release section citing #104 must
  exist, and the first such section in file order has both lines; otherwise
  `## [Unreleased]` has both. Verified by: AC-01, AC-02, AC-03, AC-04,
  AC-05.

The first two sentences are BR-321 v1 word for word; only the
`CHANGELOG.md` sentence changes.

## Acceptance criteria

- **AC-01** (BR-321 v3) — Given the repository's `CHANGELOG.md` after the
  promotion, When the content test runs, Then the
  `## [0.6.0-beta.1] - 2026-11-13` section has a `### Fixed` line citing
  #104 and `GHSA-mrhx-c7xc-m3w5` and an `### Added` line citing #104 and
  `make audit`, and the `docs/development.md` and `SECURITY.md` checks of v1
  still pass unchanged. Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs development, security and changelog state the audit contract`),
  `make check`.
- **AC-02** (BR-321 v3) — Given a fixture changelog with an empty
  `## [Unreleased]` and a `## [0.6.0-beta.1] - 2026-11-13` section holding
  the #104 Fixed and Added lines, When the changelog check runs on it, Then
  it passes. Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog release section holding the #104 lines passes`).
- **AC-03** (BR-321 v3) — Given a fixture changelog with a
  `## [0.6.0-beta.1] - 2026-11-13` section from which the #104 Fixed line,
  or in a second case the #104 Added line, is missing, while the other #104
  line is present in that section, When the changelog check runs on it,
  Then it fails; and given a fixture whose release section has no #104 line
  while both #104 lines remain under `## [Unreleased]`, When the changelog
  check runs on it, Then it fails too. Verified by:
  `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog release section missing the #104 lines fails`).
- **AC-04** (BR-321 v3) — Given a fixture changelog with no release section
  and both #104 lines under `## [Unreleased]`, When the changelog check runs
  on it, Then it passes; given the same fixture with an undated
  `## [0.7.0]` heading added after `## [Unreleased]`, When the check runs,
  Then it still passes; and given either #104 line missing under
  `## [Unreleased]`, When the check runs, Then it fails. Verified by:
  `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog without a release section reads Unreleased`).
- **AC-05** (BR-321 v3) — Given a fixture changelog with a release section
  and no line citing #104 anywhere, When the changelog check runs on it,
  Then it fails; given a fixture whose release section holds the Fixed and
  Added lines citing only `#1040`, When the check runs, Then it fails; and
  given a fixture with two release sections,
  `## [0.7.0] - 2026-12-01` without #104 lines followed by
  `## [0.6.0-beta.1] - 2026-11-13` holding both #104 lines, When the check
  runs, Then it passes. Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog selects the first release section citing #104`).
- **AC-06** (promotion) — Given `git diff 698d9db -- CHANGELOG.md` on the
  implementation branch, When it is reviewed, Then the only changes are the
  removal of the temporary note (Scope 3) and the inserted
  `## [0.6.0-beta.1] - 2026-11-13` heading (with its blank line); every
  entry is byte-identical and in the same order under the same `###`
  subsection, and `## [Unreleased]` stays the first level-2 section and is
  empty. Verified by: the review, and `make check`.

The changelog check is one helper in the test file, applied to the real
`CHANGELOG.md` (AC-01) and to inline fixtures (AC-02–AC-05).

## Decisions

- **D-1 — Version BR-321 rather than create a new BR.** Chosen: a new
  version of BR-321 with the same purpose; the rule still states where the
  #104 audit lines live, only the location changes. Rejected: a new BR
  (BR-380) for the changelog requirement with BR-321 narrowed to the docs.
  It would split one documentation contract across two records and allocate
  an ID for a location change. No new BR ID is needed.
- **D-2 — Keep the changelog requirement.** Chosen: keep it, located in the
  release section. Rejected: dropping the `CHANGELOG.md` sentence from
  BR-321. The #104 lines tell users that the advisories were fixed and that
  the audit gate exists; without the rule a later edit could drop them
  unnoticed. The fallback to `## [Unreleased]` keeps the rule valid in a
  file that has no release yet.
- **D-3 — Records-only edits after the tag stay in their entries.** Chosen:
  the one-line `698d9db` change only flips "pending acceptance" to
  "accepted" and is promoted as part of the entry it belongs to. Rejected:
  leaving the original "pending acceptance" wording in the release section
  and adding an Unreleased entry for the acceptance (noise for readers;
  acceptance is not a user-facing change), and leaving that entry under
  Unreleased (it shipped in `0.6.0-beta.1`).
- **D-4 — Version number.** Chosen: v3. "BR-321 v2" already names the
  shrinkwrap-related rule that F-024 v1 proposed and F-024 v2 withdrew; the
  frozen F-024 records and the business-rule index use that name. Reusing
  v2 would make one identifier mean two different rules. The withdrawn v2
  gets a History line in `BR-321.md` stating that it was never accepted and
  that the number is not reused, so the gap is explained. Rejected: v2,
  which would collide with the withdrawn rule in frozen records.
- **D-5 — "First release section citing #104" in file order.** Chosen:
  file order (newest first), the first release section containing a line
  matching `#104\b`. Later releases do not repeat #104 entries, so this is
  the release that shipped #104. Once any release section exists, a release
  section must cite #104, so the lines cannot stay only under Unreleased
  after a promotion. Rejected: a fixed version string in the rule, which
  would tie a lasting rule to one release; and selecting the first release
  section regardless of #104, which would fail at every later release.

## Open questions

## Stress-test

- **R1-1** (major, retained) — Rule selection was circular ("the first
  release section that contains #104 entries"). Changed: BR-321 v3 now
  says that if any release section exists, a release section citing #104
  must exist and the first such section in file order has both lines,
  otherwise `## [Unreleased]` has both; citation is `#104\b`; an undated
  heading is not a release section (Scope 1). Added AC-05 (no #104 with a
  release section fails; `#1040` only fails; #104 only in the older of two
  release sections passes) and the undated-heading case in AC-04; D-5
  updated.
- **R1-2** (major, retained) — No AC covered the promotion itself. Changed:
  added AC-06 on `git diff 698d9db -- CHANGELOG.md` (only the note removal
  and the inserted heading; entries byte-identical and in order;
  `## [Unreleased]` first and empty), verified by the review and
  `make check`; Scope 2 references it.
- **R1-3** (minor, retained) — Scope did not list the `BR-321.md` updates.
  Changed: Scope 5 now lists the Examples (one per side of the
  release-section/Unreleased boundary, each mapped to ACs), the
  Verification naming `tests/dependency-audit.test.ts`, and the exact
  History lines.
- **R1-4** (minor, retained) — Scope 4 overstated the `698d9db` change and
  AC-03's second clause had no When. Changed: Scope 4 and D-3 say that
  `698d9db` changed one line of one entry; AC-03's second clause has a When.
- **R1-5** (major, retained) — "BR-321 v2" already names the withdrawn rule
  of F-024 v1 in frozen records. Changed: the rule is BR-321 v3 throughout;
  D-4 rewritten; Scope 5 requires the History line
  `v2 — 2026-11-12 — F-024 v1 — proposed, withdrawn in F-024 v2, never accepted; number not reused`
  before the v3 line, and lists the index updates in
  `business-rules/README.md` (around lines 20 and 671-673) and
  `docs/spec-index.md:111` saying "BR-321 v3".

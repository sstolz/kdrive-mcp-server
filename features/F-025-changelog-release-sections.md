---
id: F-025
title: Changelog release sections
ticket: "#2"
status: draft
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-13.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `698d9db`. IDs: F-025,
BR-321 v2; no new BR ID, no ADR. `#2` is this repository's ticket.

## Context

`0.6.0-beta.1` was released on 2026-11-13: tag `v0.6.0-beta.1` on `163e701`,
published to npm and GHCR. AGENTS.md §7 says that at a release the Unreleased
entries of `CHANGELOG.md` are promoted to a version section. BR-321 v1
(F-020 v1) requires the #104 `### Fixed` and `### Added` lines under
`## [Unreleased]`, and `TestBR321_audit_docs` reads only that section. The
promotion would therefore turn the test red, so release PR #14 kept every
entry under Unreleased and added a temporary note at the top of
`CHANGELOG.md`. The owner decided that BR-321 v2 and the promotion come in
this records PR.

Users affected: readers of `CHANGELOG.md` (operators and contributors, who
see which changes shipped in `0.6.0-beta.1`) and maintainers and agents
(release records, the content test). The MCP server, CI and the release
workflow are unaffected.

## Scope

1. **Release section format (Keep a Changelog).** A release section starts
   with a level-2 heading of the form `## [<version>] - <YYYY-MM-DD>`, here
   `## [0.6.0-beta.1] - 2026-11-13`: the SemVer version in square brackets,
   one space, a hyphen, one space, the ISO release date. `## [Unreleased]`
   stays the first level-2 section of the file; release sections follow it,
   newest first. `## [Unreleased]` may be empty after a promotion (heading
   only, no `###` subsection).
2. **Promotion.** Every entry currently under `## [Unreleased]` moves, with
   its `###` subsection (`Added`, `Changed`, `Fixed`, `Removed`) and order
   unchanged, into a new `## [0.6.0-beta.1] - 2026-11-13` section placed
   directly after `## [Unreleased]`. No entry is reworded, merged or dropped.
3. **Temporary note.** The paragraph that PR #14 added between the
   introduction line and `## [Unreleased]` (it starts "Version
   `0.6.0-beta.1` (2026-11-13) is the first public beta") is removed. The
   introduction line ("User-facing changes follow Keep a Changelog and
   Semantic Versioning.") stays.
4. **Entries changed after the tag.** The records-sync commit `698d9db`
   changed only wording of existing entries (`F-024 v2 (pending acceptance)`
   became `F-024 v2 (accepted 2026-11-13)`). These are records updates of
   entries that shipped in `0.6.0-beta.1`; they stay part of those entries
   and move with them into the release section in their current wording. No
   separate Unreleased entry is written for them (D-3).
5. **BR-321 v2.** `business-rules/BR-321.md` goes to v2 (status `pending
   acceptance`, source F-025 v1, v1 kept in its History), and
   `TestBR321_audit_docs` is updated to the v2 rule (AC-01–AC-04). The
   business-rule index, spec index and capability map record F-025 v1 and
   BR-321 v2.
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

- **BR-321 v2** (supersedes BR-321 v1, same purpose: dependency audit
  documentation) — `docs/development.md` no longer states that the audit is
  not clean; its dependency-audit paragraph names the BR-315 overrides,
  ADR-009, `make audit` and the CI `audit` job. `SECURITY.md` has a section
  `## Dependency audit` stating that CI fails on any high or critical `npm
  audit` finding, that a new one is fixed before a release, not allowlisted,
  and that the overrides do not apply to an install of the packed tarball
  (`npm install -g`), which can resolve Jimp's nested Zod 3 again.
  `CHANGELOG.md` has a `### Fixed` line for the advisories and an `### Added`
  line for `make audit` and the CI job, both citing #104, under the first
  release section (in file order; heading `## [<version>] - <YYYY-MM-DD>`)
  that contains #104 entries, or under `## [Unreleased]` while no release
  section exists. Verified by: AC-01, AC-02, AC-03, AC-04.

The first two sentences are BR-321 v1 word for word; only the
`CHANGELOG.md` sentence changes.

## Acceptance criteria

- **AC-01** (BR-321 v2) — Given the repository's `CHANGELOG.md` after the
  promotion, When the content test runs, Then the
  `## [0.6.0-beta.1] - 2026-11-13` section has a `### Fixed` line citing
  #104 and `GHSA-mrhx-c7xc-m3w5` and an `### Added` line citing #104 and
  `make audit`, and the `docs/development.md` and `SECURITY.md` checks of v1
  still pass unchanged. Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs development, security and changelog state the audit contract`),
  `make check`.
- **AC-02** (BR-321 v2) — Given a fixture changelog with an empty
  `## [Unreleased]` and a `## [0.6.0-beta.1] - 2026-11-13` section holding
  the #104 Fixed and Added lines, When the changelog check runs on it, Then
  it passes. Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog release section holding the #104 lines passes`).
- **AC-03** (BR-321 v2) — Given a fixture changelog with a
  `## [0.6.0-beta.1] - 2026-11-13` section from which the #104 Fixed line,
  or in a second case the #104 Added line, is missing, while the other #104
  line is present in that section, When the changelog check runs on it,
  Then it fails; and given a fixture whose release section has no #104 line
  while both #104 lines remain under `## [Unreleased]`, Then it fails too.
  Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog release section missing the #104 lines fails`).
- **AC-04** (BR-321 v2) — Given a fixture changelog with no release section
  and both #104 lines under `## [Unreleased]`, When the changelog check runs
  on it, Then it passes; and with either #104 line missing there, Then it
  fails. Verified by: `tests/dependency-audit.test.ts`
  (`TestBR321_audit_docs changelog without a release section reads Unreleased`).

The changelog check is one helper in the test file, applied to the real
`CHANGELOG.md` (AC-01) and to inline fixtures (AC-02–AC-04).

## Decisions

- **D-1 — Version BR-321 rather than create a new BR.** Chosen: BR-321 v2
  with the same purpose; the rule still states where the #104 audit lines
  live, only the location changes. Rejected: a new BR (BR-380) for the
  changelog requirement with BR-321 narrowed to the docs. It would split one
  documentation contract across two records and allocate an ID for a
  location change. No new BR ID is needed.
- **D-2 — Keep the changelog requirement.** Chosen: keep it, located in the
  release section. Rejected: dropping the `CHANGELOG.md` sentence from
  BR-321. The #104 lines tell users that the advisories were fixed and that
  the audit gate exists; without the rule a later edit could drop them
  unnoticed. The fallback to `## [Unreleased]` keeps the rule valid in a
  file that has no release yet.
- **D-3 — Records-only edits after the tag stay in their entries.** Chosen:
  the `698d9db` wording changes only flip "pending acceptance" to
  "accepted" and are promoted as part of the entries they belong to.
  Rejected: leaving the original "pending acceptance" wording in the release
  section and adding Unreleased entries for the acceptance (noise for
  readers; acceptance is not a user-facing change), and leaving those
  entries under Unreleased (they shipped in `0.6.0-beta.1`).
- **D-4 — Version number.** Chosen: v2. F-024 v1 had proposed a BR-321 v2
  that F-024 v2 withdrew; it was never accepted and never had a record, and
  BR-321 is at v1. Rejected: v3, which would leave a gap with no record.
- **D-5 — "First release section" in file order.** Chosen: file order
  (newest first), the first release section containing a line citing #104.
  Later releases do not repeat #104 entries, so this is the release that
  shipped #104. Rejected: a fixed version string in the rule, which would
  tie a lasting rule to one release.

## Open questions

## Stress-test

---
id: F-043
title: Queue documentation changelog release sections
ticket: "#67"
status: draft
version: 1
---

# F-043 — Queue documentation changelog release sections

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: `local/f043` at `3b035b8bd44487437afaa6eae4447b0791dd7567` (cached `origin/main`).
IDs: F-043; BR-387 v2; no new BR or ADR.
Next free IDs: F-044, BR-431, ADR-013.

## Context

BR-387 v1 (F-026, #16) is active and requires the #16 Fixed entry under
Unreleased. `TestBR387_docs_describe_queue_and_retryable_SERVER_BUSY` in
`tests/invocation-queue.test.ts` checks that location. Promoting Unreleased
into `## [0.6.0-beta.2] - 2026-11-15` would fail that check even though the
entry remains present. Maintainers need the documentation check to survive
release promotion; changelog readers still need the queue-fix entry.

[F-025](F-025-changelog-release-sections.md) defines release headings and
file-order selection. [BR-321 v4](../business-rules/BR-321.md) adds the
fallback when no release cites the current ticket and the archive cutoff.

## Scope

- Version BR-387 to v2, changing only its changelog location requirement.
  Preserve the complete v1 text and acceptance evidence; v1 remains active
  until v2 acceptance. README Key limits and compatibility Parallel tool
  calls obligations remain word for word.
- Specify the future update to the existing BR-387 content test and the
  synthetic cases below, using the same check for real and synthetic text.
- Include a test-only update to the #12 real-file heading assertion in
  `TestBR321_audit_docs development, security and changelog state the audit contract`
  (`tests/dependency-audit.test.ts:401` at `728b4c3`). Apply BR-321 v4's
  selection to the real file instead of pinning Unreleased (AC-07);
  BR-321 itself is unchanged.
- Prefer extracting the existing `changelogTicketSection` parsing and
  subsection logic into a shared test helper under `tests/helpers/`.
  Reuse `RELEASE_HEADING`, word-boundary ticket matching, entry/subsection
  boundaries and the `changelogTicket12Section` archive cutoff. Support
  a "Fixed required, no marker" option for #16 without changing #104 or #12
  selection or content requirements.
- Record the draft and pending v2 in the rule index, spec index, capability
  map and Unreleased changelog entry.

### Out of scope

Product behavior, README or compatibility wording changes, BR-321 changes,
source or test edits in this draft, release promotion, version bumps, tags,
publication, CI or build changes, and acceptance claims.

## Business rules

- **BR-387 v2** — README "Key limits" and the section `## Parallel tool calls` of `docs/mcp-client-compatibility.md` state that one call per session runs at a time, that up to 4 further calls wait in arrival order for at most 12 seconds, and that `SERVER_BUSY` means the call was refused before any kDrive request, so it is safe to retry (writes included) once an earlier call has completed.
  `CHANGELOG.md` selects the first release section whose body cites #16 anywhere, in file order; if no such release section exists, it selects `## [Unreleased]`. The selected section has a `### Fixed` line citing #16. A release section has a heading of the form `## [<version>] - <YYYY-MM-DD>`, using the F-025 version/date grammar; an undated heading is not a release section. A citation matches `#16\b`, so `#160` does not cite #16. Only text before the `## [0.6.0-beta.1]` heading is searched, as in BR-321 v4: that section and older sections use archived ticket numbers.
  Verified by: AC-01–AC-06.

## Acceptance criteria

The existing test names in AC-01 and AC-07 are retained. AC-02–AC-06 name
planned tests in `tests/invocation-queue.test.ts`; they do not yet exist.
Successful synthetic checks assert the selected heading; negative cases
assert failure.
Future verification: these tests plus the existing BR-321 synthetic cases
in `tests/dependency-audit.test.ts`, then `make check`.

- **AC-01** (BR-387 v2) — Given the repository documents, When
  `TestBR387_docs_describe_queue_and_retryable_SERVER_BUSY` runs, Then the
  README and compatibility assertions remain unchanged and the #16 Fixed
  entry passes in its selected section. The assertion requires the returned
  heading to equal the BR-387 v2 selection applied to the real `CHANGELOG.md`
  (`## [Unreleased]` before promotion, `## [0.6.0-beta.2] - 2026-11-15` after).
- **AC-02** (BR-387 v2) — Given a synthetic changelog with the #16 Fixed
  line under Unreleased, When checked with no release section, with only an
  undated `## [0.7.0]` section, or with a dated release containing only #7,
  Then Unreleased is selected and passes. Removing its #16 line fails.
  Verified by: `TestBR387_v2_changelog_unreleased_fallback`.
- **AC-03** (BR-387 v2) — Given empty Unreleased and a
  `## [0.6.0-beta.2] - 2026-11-15` section with the #16 Fixed line,
  When checked, Then that release passes, including when another Fixed
  bullet precedes #16. Given instead that #16 appears only under Added or
  Changed and nowhere under Fixed, When checked, Then it fails.
  Verified by: `TestBR387_v2_changelog_release_fixed_line`.
- **AC-04** (BR-387 v2) — Given otherwise valid synthetic fixtures whose
  only citation is #160 instead of #16, separately under Unreleased and
  under a dated release, When checked, Then both fail. A #16 citation in
  another subsection cannot make a #160 Fixed entry pass.
  Verified by: `TestBR387_v2_changelog_ticket_boundary`.
- **AC-05** (BR-387 v2) — Given a `## [0.7.0] - 2026-12-01` section
  with no #16 citation followed by `## [0.6.0-beta.2] - 2026-11-15`
  with a #16 Fixed entry, When checked, Then the older beta.2 section is
  selected and passes. If both releases have that entry,
  the first in file order is selected and passes. If the newer release
  mentions #16 only under Added, it is selected and fails even when the
  older release or Unreleased has a valid #16 Fixed entry. Only when no
  release body cites #16 is Unreleased selected.
  Verified by: `TestBR387_v2_changelog_first_matching_release`.
- **AC-06** (BR-387 v2) — Given empty Unreleased and the only #16 Fixed
  entry in `## [0.6.0-beta.1] - 2026-11-13`, or in an older section
  following it, When checked, Then it fails because both are outside the
  searched text. Adding the entry to Unreleased passes and selects
  Unreleased. Given a heading-only final Unreleased section, When checked,
  Then it fails without truncating or borrowing an entry from another
  section. Verified by: `TestBR387_v2_changelog_archive_cutoff_and_empty_section`.
- **AC-07** (BR-321 v4, unchanged) — Given the real `CHANGELOG.md`, When
  `TestBR321_audit_docs development, security and changelog state the audit contract`
  runs in `tests/dependency-audit.test.ts`, Then the heading returned for
  #12 equals the BR-321 v4 selection applied to that file
  (`## [Unreleased]` before promotion, `## [0.6.0-beta.2] - 2026-11-15` after).
  The #12 Fixed and Added requirements, markers, archive cutoff, #104
  assertion and other documentation assertions remain unchanged.

## Decisions

- **D-1 — Same rule, new version.** BR-387 v2 changes only the changelog
  sentence; v1 remains active and unchanged. Dropping the changelog check
  would lose evidence of the queue fix; a new BR would split one contract.
- **D-2 — Ticket selection, not a pinned release.** Use F-025 heading and
  file-order semantics with BR-321 v4's no-match fallback. BR-321 v3's
  stricter #104 fallback (only when no release exists) is unsuitable for
  new entries after an earlier release. Select by a #16 citation anywhere
  in the release body, exactly as `releases.find((s) => cites.test(s.body))`
  in `tests/dependency-audit.test.ts:463` at `728b4c3`, then require the
  #16 Fixed line in that section. Unlike BR-321, BR-387 requires no Added
  entry or additional text marker.
  Keep valid older matches before the archive cutoff. F-025 AC-05 explicitly
  permits these; the cutoff comes from BR-321 v4 / F-027, not F-025.
- **D-3 — Share bounded parsing.** Prefer a shared helper with explicit
  required-subsection/marker options to a copied parser or importing a
  test suite. Preserve BR-321's #104 and #12 selection, markers and negative
  cases. #16 uses the same body-citation selection and archive cutoff as
  #12, with a "Fixed required, no marker" option. Update the #12 real-file
  heading assertion through AC-07 so it follows the existing BR-321 v4
  contract across promotion; no BR-321 revision is needed.
- **D-4 — Draft only.** Record the pending requirement without moving
  existing changelog entries. Release 0.6.0-beta.2 is a separate change.

## Open questions

## Stress-test

### Review 1 dispositions

The supplied review findings are recorded below with their dispositions;
this is not a new review or approval of the revised head. Reviewer
model/effort and token counters were not supplied (unknown); no usage is
inferred. This revision remains draft v1; no freeze or acceptance is claimed.

### 67-spec-review-1-reviewer — verdict: changes

1. **Major — release selection. Retained, fixed in this revision.**
   BR-387 v2 and AC-05 select the first release whose body cites #16
   anywhere, in file order, before requiring its Fixed line. Verified
   against `changelogTicketSection` at `tests/dependency-audit.test.ts:463`
   and `changelogTicket12Section` at line 500 (`728b4c3`): retain the
   archive cutoff and no-match Unreleased fallback. A newer Added-only
   citation fails even with a valid older Fixed entry. The helper needs
   only a "Fixed required, no marker" option for #16.
2. **Minor — real-file heading assertion. Retained, fixed in this revision.**
   AC-01 explicitly asserts the returned heading equals BR-387 v2's
   selection on the real file, with the before/after-promotion headings.
3. **Minor — #12 promotion blocker. Retained, fixed in this revision.**
   The scope and AC-07 name the test-only update to the real-file assertion
   at `tests/dependency-audit.test.ts:401` (`728b4c3`), which currently
   pins Unreleased. Its expected heading follows BR-321 v4's selection
   on the real file; BR-321 and the #12 content requirements are unchanged.

---
id: BR-NNN
version: 1
status: pending acceptance
source: F-NNN v1
supersedes: none
---

# BR-NNN — Rule title

Template only; allocate a new ID through its source feature and the index when
the rule has a new purpose. This placeholder allocates no identifier. For a
same-purpose change, retain the existing ID, increment its BR version and cite
it as `BR-NNN vN`; a source feature version is a separate identifier.

## Rule

Write one testable statement in the present tense without an ambiguous “should”.

## Rationale

Explain the user need or invariant protected by the rule.

## Examples

Replace these prompts with concrete synthetic inputs, a single action and
observable results. Include one example on each side of every boundary and map
each example to exactly one identifiable test case or parameter row. Examples
do not replace the full rule or ACs. Label superseded examples as historical.

- **E-01 — Given** a concrete value on the accepted side of a boundary.
  **When** the specific operation runs.
  **Then** its observable output or state matches the rule.
- **E-02 — Given** a concrete value on the rejected side of that boundary.
  **When** the same operation runs.
  **Then** the specific observable error or refusal occurs.

## Verification

Map each E-NN to one real test name, file path and parameter row where applicable.
Name its BR version in specs, tests and PRs. Link the exact source feature
version, AC and acceptance evidence. Do not invent coverage or execution.
Record a missing test honestly as a traceability gap; that gap does not satisfy
the required test mapping or authorize bypassing the quality path.

Prepare status `pending acceptance` in the feature PR, or `observed` for a
brownfield rule reconstructed from characterization tests (AGENTS.md §0.3); promote it
only as AGENTS.md §0.3 says. Use `active` or
`superseded by BR-MMM` only after successful actual-main acceptance recorded in
the issue; synchronize markers in the next scoped, reviewed PR before release.
Preserve superseded meaning, source provenance and successor links.

## History

- v1 — YYYY-MM-DD — F-NNN v1 — Created with its source feature.

For a later same-purpose change, append a dated History line naming the feature
and change, increment `version`, update tests and cite `BR-NNN vN`. A change of
purpose receives a new allocated ID with `supersedes: BR-MMM`; never reuse or
renumber IDs. A first versioned record of an already existing rule must say so,
without inventing earlier BR version numbers or rewriting historical chains.

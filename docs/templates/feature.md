---
id: F-NNN
title: Feature title
ticket: "#N"
status: draft
version: 1
---

# F-NNN — Feature title

Template only; no identifier is allocated by this file.

## Context

State the concrete problem, affected users and relevant baseline evidence.

## Scope

List observable deliverables and identify dependencies.

### Out of scope

State explicit exclusions.

## Business rules

- **BR-NNN v1** — One testable rule, with no ambiguous “should”. Verified by: AC-NN.

Cite each rule's actual BR version, independently of this feature's version.
For later same-purpose changes, retain the rule ID, increment its version,
append History and update tests. For a different purpose, allocate a new BR ID
that supersedes the old one. Preserve pre-existing IDs and historical chains.

## Acceptance criteria

- **AC-NN** (BR-NNN v1) — Given a concrete state, When an action occurs, Then the
  observable outcome occurs. Verified by: named test / command and post-merge check.

## Decisions

Record chosen/rejected options and reasons; link source sections and ADRs.

## Open questions

List unresolved questions during drafting. This section must be empty at freeze.

## Stress-test

Record the new, independent reviewer/report for this act/round, model/effort,
critical/major/minor findings and retained/rejected author dispositions. Spawn
with `fork_turns="none"`, standalone criteria and no author conversation or
prior-verdict anchoring. Reviewers do not edit code; every round uses a new agent.

## Freeze and verification

Generic directive: record explicit human go and the exact reviewed version before
freeze. Apply this project's override in [AGENTS.md](../../AGENTS.md): after a
ready ticket, resolved spec and fresh independent `approve`, the orchestrator
records the exact version/date/evidence as frozen without manual human go.
Allowed lifecycle: draft → ready-for-freeze → frozen → done. Material changes
need a new version and fresh review; manual freeze returns only if reinstated
or an actual unresolved decision requires user input. Record BR-named failing
test evidence before implementation; PR maps ACs → tests and BR coverage.
Include BR/capability/CHANGELOG records provisionally in the feature PR; never
mark active/done before acceptance. After merge, check ACs on the exact `main`
SHA and record evidence in the existing issue; close only on success. That issue
is authoritative while repository markers await synchronization through the next
appropriately scoped, reviewed PR before release. No mandatory separate closure
ticket/PR. Never prefill acceptance; pending markers do not erase issue evidence.

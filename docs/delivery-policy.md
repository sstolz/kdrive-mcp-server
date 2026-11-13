# Delivery policy — issue #2 baseline

Status: documentation baseline accepted on 2026-11-01 after reviewed PR #24
merged at `40a80e31c88d3bdf4a52e4437ae4f3f538a732c4`; the
issue #2 acceptance record (archive issue 2)
verifies all 19 reviewed file blobs. No additional human policy freeze was
required. This is not an accepted ADR or released product.
The index records F-001's autonomous freeze under the project-specific waiver.
[AGENTS.md](../AGENTS.md) is the working method, including the user's corrected
proportional paths, independent reviews and acceptance-record workflow.

## Sources and language

Preserve the French [umbrella draft](../SPEC.md), [API observations](api-notes.md)
and [v0.3 review](spec-review.md) unchanged as historical design/evidence sources.
They are not a frozen v0.4 contract or proof that all open API questions are solved.
The [English index](spec-index.md) links features to their eventual contracts.
An independently reviewed English feature spec governs its scope after recorded
freeze. The generic human-freeze directive remains in AGENTS, but this project's
explicit waiver lets the orchestrator freeze the exact version after a ready
ticket, resolved spec and fresh independent `approve`. Resolve actual conflicts
before freeze; material changes need a new version and fresh review, not another
manual freeze unless reinstated or a real decision remains unresolved.
New artifacts are English; user discussion is French.
Full translation is deferred.

## Proportional work and reviews

Use the full path for product behavior, security, public contracts, or build/CI
contract changes:
ready ticket → resolved spec/BRs/ACs → fresh independent approve → recorded freeze → failing
tests → implementation → checks/CI → independent review → PR merge → acceptance.
Use the short path for docs/admin/editorial or behavior-preserving mechanical
changes: ticket/clear request → branch → appropriate checks → independent review
→ PR merge → verification. Do not invent BRs, specs, tests or freezes for prose.

The orchestrator may author small mechanical work and delegates substantial
work. Every review act/round gets a new agent with `fork_turns="none"`, standalone
criteria and no author conversation or prior-verdict anchoring. Reviewers never
edit reviewed work. Match model/effort to complexity; reviewer strength is at
least the author's, with stronger review when needed, not by default. Reports
record model/effort, verdict, findings and executed evidence. After two unresolved
rounds, escalate. Independent sub-agent approval is valid; a second GitHub identity
is conditional only on selected GitHub enforcement.

One ticket, branch and PR; no stacking, direct-main writes or unapproved branch
deletion. Merge sequentially by squash, updating shared branches by merge.
The #2 baseline was imported through reviewed PR #24. Pending #1 settings
remain separate; documentation acceptance does not claim #1 fully accepted or waive product
checks. Existing user authorization persists; make routine reversible choices
without another permission loop. Out-of-scope findings go to [BACKLOG.md](../BACKLOG.md).

## Acceptance and repository markers

Prepare reviewed BR files, capability entries and Unreleased text provisionally
in the feature PR. Label pending acceptance; never predeclare `active`, `done`
or a working capability. After merge, check every AC on the actual `main` SHA
and record commands/results, AC/test mapping and commit evidence in the existing
issue. Close only on success; the issue is authoritative for that transition
while file markers remain pending. Failures keep the issue open.

Synchronize final repository markers in the next appropriately scoped, reviewed
PR before release; declare those bookkeeping updates explicitly. No separate
closure ticket/PR is mandatory for every feature, no unrelated behavior may be
added and no direct-main write is permitted. This follows corrected AGENTS;
the earlier separate-closure-PR draft is not the current working method.

## Checks, records and release

Before CI exists, the approved docs/admin-only #1/#2 bootstrap exception permits
independent `approve` plus local document/link/content checks. Do not call absent
CI green. CI is mandatory from #3 onward; once available, run relevant checks
and never disable configured gates. Product changes require tests, lint, format,
typecheck, build and applicable CI. Use [templates](spec-index.md#templates)
proportionately; evidence must match each claim.

Allocate immutable sequential F/BR/ADR IDs through [the index](spec-index.md).
Keep accepted ADRs immutable. Under the current prospective AGENTS policy, a
same-purpose BR change keeps its ID, increments its version, appends History and
updates tests; a different-purpose replacement receives a new ID that supersedes
the old one. Cite BR-NNN vN in specs, tests and PRs. Preserve existing historical
chains and frozen meanings; the #35 migration creates initial versioned records
without inventing earlier BR versions. [The capability map](../capability-map.md) distinguishes provisional
entries from accepted capabilities. Keep [Unreleased](../CHANGELOG.md) truthful.
F-001 v1 established the initial unreleased version at 0.1.0; #3 created VERSION
and package metadata. The first beta is 0.6.0-beta.1 (#2). Changes accumulate under Unreleased
until an explicitly authorized release; documentation updates do not bump the
version, create a tag or publish a release.

Explicit human go for the version/commit precedes tagging, a published release
or npm/GHCR publication. Build/tag events alone never grant publication approval.
The feature-freeze waiver does not waive reviews, tests, CI, secret/destructive
safeguards or human release approval.
Synchronize closure markers before release; reconcile historical SPEC §11
automation without editing that source. [The environment example](../.env.example)
contains only empty placeholders; no deployment credentials belong in this PR.

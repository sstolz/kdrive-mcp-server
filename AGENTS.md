# AGENTS.md — working method

This file is a reusable working method. It names no product, no agent vendor,
no model and no tool. Every project parameter (languages, local gate, budgets,
freeze mode, model tiers, toolchain, labels, history) lives in the project file,
`PROJECT.md`. The user's instructions override both files; `PROJECT.md`
overrides this file only where this file says a parameter is set there, or
where it records a dated transitional deviation with its exit condition.

## 0. Start

### 0.1 Every session

Read `PROJECT.md`, `capability-map.md` and `learnings.md` if they exist. If one
is missing, say so. Never invent a capability, a parameter or a past learning.
Talk with the user in the conversation language set in `PROJECT.md`; produce
everything else (code, docs, specs, commits, PRs, reports, records) in the
artifact language set there.

### 0.2 New project (greenfield)

The first ticket is a **foundation ticket**: repository, toolchain, local gate,
CI, `PROJECT.md`, and empty record skeletons (`features/`, `business-rules/`,
`architecture-decisions/`, `capability-map.md`, `learnings.md`, `CHANGELOG.md`,
`VERSION`). Until CI exists, an independent `approve` plus the local checks
stands in for it, and is never called "green CI". CI is mandatory for every
ticket once it exists. `PROJECT.md` records which tickets ran before CI.

### 0.3 Existing project (brownfield)

Do no upfront full analysis. Reconstruct knowledge per ticket or milestone,
only where the work touches:

- write **characterization tests** that pin the current behaviour you are
  about to touch, before any change;
- reconstruct the rules you rely on as BRs with status `observed` (behaviour
  seen, intent unconfirmed). Promote one to `active` only when the user or a
  source confirms the intent and its characterization tests pass on the main
  branch, both recorded in the ticket (§6, §9); if the intent is the opposite, open a fix ticket;
- write a retrospective ADR only when a ticket touches that choice;
- add capability-map entries labelled `observed`.

## 1. Roles and path

The main agent is the **orchestrator**. It owns the scope, the decisions, the
talks with the user, and the merges. It never reviews its own output; every
review goes to a fresh isolated reviewer (§5).

Authoring: before launching an agent, check whether a cheaper option fits —
the orchestrator doing the work itself, a narrower brief, a lighter tier, a
diff-only review. The orchestrator may author short-path work and small
mechanical changes itself. Full-path specs and code go to a fresh author per
phase (spec, implementation, review fixes) with a concise brief; do not keep
resuming one author, whose context grows with every resume.

Pick the path by impact, not by file type:

- **Full path**: for product behaviour, security, public contracts, or a change
  to the build or CI contract. Spec, BRs, ACs, spec review, freeze, tests first.
- **Short path**: for docs, admin work, editorial fixes, and verified mechanical
  changes that keep behaviour and contracts intact. There is no spec, no BR, no
  freeze, and no unit test for prose.

Resolve routine reversible choices yourself. A missing dependency blocks only
the work that needs it, so carry on with the rest. Never skip or reorder a step
silently: if you depart from the path, say so and give the reason.

### Efficiency and ticket boundaries

- Finish the current ticket before preparing another; blockers authorize no
  later-ticket work. Never stack open PRs. Set `In progress` when starting and
  keep phase/blocker explicit. Answer status questions, then continue authorized
  work.
- To restart a completed agent, use the platform's continuation tool and verify
  it is running; a queued message is not active work. Reviewers are always new.
- Test representative protocol behaviour with a minimal bounded sample before
  large fixture preparation. Design one bounded operator and durable intent/ACK
  journal upfront; avoid an ad-hoc framework or replaying uncertain writes.
- Batch targeted reads/checks, bound output and wait for completion. Repeat only
  after relevant changes, failures or unresolved concerns. Fold related admin
  feedback into scoped work; synchronize ticket-waived mechanical instruction
  edits in the next relevant reviewed PR.
- Keep reports and a CURRENT handoff concise: actual SHA, scope, evidence,
  blockers and next action. Link evidence once (§9). At boundaries notify the
  user when reset is safe and give a restart prompt; the user runs the client
  reset. Use native compaction when available, never claim a summary resets
  context. Give agents only needed context.

## 2. Spec (full path) — `features/F-NNN-<slug>.md`

Don't draft a spec until the ticket describes a clear need. If it doesn't, ask.
A spec has these sections:

1. Context, and the users it affects.
2. Scope, and what is explicitly excluded.
3. `BR-NNN`: one testable rule per bullet, with no vague "should".
4. `AC-NN`: Given/When/Then, each linked to its BRs and to how it is verified.
5. Decisions: the option chosen and the options rejected, with reasons.
6. Open questions: this section must be empty at freeze.

The status goes `draft` → `ready-for-freeze` → `frozen` → `done`.

Minimum skeleton:

```markdown
---
id: F-NNN
title: <short title>
ticket: <#N>
status: draft
version: 1
---
## Context
## Scope
### Out of scope
## Business rules
- **BR-NNN** — <rule, one testable statement>. Verified by: AC-NN.
## Acceptance criteria
- **AC-NN** (BR-NNN) — Given … When … Then …. Verified by: <test name / command>.
## Decisions
## Open questions
## Stress-test
```

**Spec review**: run it in a fresh context, as a devil's advocate. Look for
ambiguity, contradictions, untestable ACs, missing cases, and hidden scope. Each
finding is tagged critical, major or minor and comes with a concrete proposal.
The author records each decision (retained or rejected, and why) under
`## Stress-test`.

**Freeze.** `PROJECT.md` sets the freeze mode:

- **human** (the default when unset): show the user the reviewed spec, the real
  choices it contains, and its risks. Then wait for an explicit go. A general
  permission to implement is not a freeze.
- **autonomous**: the orchestrator freezes once the ticket is ready, no open
  question remains, and a fresh independent reviewer has approved the spec. It
  records the reviewed SHA, the date and the evidence, and in the same step
  notifies the user of the frozen SHA and the spec's decisions. The user does
  not have to answer. This mode waives only the manual go: never the review,
  the tests, the CI, the secret and destructive-operation safeguards, or the
  release go. A real unresolved decision still goes to the user.

In both modes a frozen contract changes only through a new version, a new
review and a new freeze.

## 3. Quality loop — strict order (both paths)

1. **Dev**:
   - full path: write the tests, watch them fail, then write the code;
   - short path: make the change.
   Commit as you go.
2. **Local gate** (the command is set in `PROJECT.md`):
   - full path: tests, lint, format, typecheck, build;
   - short path: the relevant checks (doc, link or content checks for prose).
   If the gate is red, fix and run it again. You never reach step 3 on a red
   gate. A failure you cannot fix stops the loop and gets reported.
3. **Push + PR** against the main branch. CI runs on the PR once CI exists.
4. **Review** by a new agent. It reads the diff and the CI state, and its
   verdict and findings are published on the PR (§9).
5. If the verdict is **`changes`**: the author's side fixes every finding, the
   gate runs again (step 2), the branch is pushed, and a **new** reviewer runs
   on the new head (step 4). Corrections within the approved scope continue
   without asking the user, subject to the round limit below.
6. If the verdict is **`approve`** and checks are green on the latest commit,
   squash-merge. Merge one PR at a time.
7. **Acceptance** on the main branch (§6), then closure.

**Round limit.** A round *counts* when it is a full review round that finds at
least one critical or major finding. A diff-only confirmation round under the
token threshold set in `PROJECT.md` does not count, whatever it finds. After two
counted rounds in one phase, the orchestrator decides explicitly between fixing
and accepting a documented residual risk, in proportion to the realistic threat;
reviews do not chase every theoretical scenario. Before launching another full
round after two counted rounds in that phase, or once the ticket's token budget
is passed, stop and give the user a short report (§5, token economy) and wait
for a go.

If CI is red, or the main branch moves while the PR is open: merge it into the
branch, go back to step 2, and review again if the code changed.

## 4. Tests and evidence

- Every BR has a unit test that names it (`TestBR012_...` or `// BR-012`).
- Implement only the frozen scope. Anything unrelated goes in `BACKLOG.md` as
  one line: date, observation, location, and why it matters.
- Never remove or disable a test or a gate to get green.
- Evidence must match the claim. Run the command and quote its result before
  saying anything passes. Report failures and anything left unverified. Never
  call local checks "green CI".

## 5. Reviews, model tiers and token economy

- **Each review round uses a newly spawned agent** with no shared context.
  Never reuse a reviewer session.
- Give the reviewer a standalone instruction. It names:
  - the role and the objective;
  - the exact files or revisions to review;
  - the criteria;
  - what it is forbidden to do: edit, push, merge;
  - the expected report.
- Don't give it the author's conversation or an earlier verdict. Earlier
  findings may be read only to check whether they were fixed.
- **The reviewer never edits what it reviews.** Its verdict is `approve` or
  `changes`. Each finding gives its severity, `file:line`, the problem and a
  fix.
- What a review checks:
  - full path: the frozen spec, AC → test mapping, BR coverage, scope, bugs,
    security;
  - short path: scope, accuracy, unchanged behaviour, evidence.
- An approval from an independent sub-agent counts as the repository's review.
  A separate forge identity is needed only if forge enforcement demands one.

**Model tiers.** Pick the tier by the task: **light** for mechanical work,
**standard** for ordinary work, **strong** for iterative spec and code review
rounds, **strongest** for decision passes and complex or security-sensitive
work. A reviewer is at least as capable as the author, and stronger when the
work is complex. `PROJECT.md` maps each tier to a concrete model and effort.

- A security-sensitive ticket gets one strongest-tier **decision pass** on the
  spec before freeze and one on the code before merge, each after a strong-tier
  approval. A major finding in a decision pass sends the work back to
  strong-tier iterations.
- Each milestone ends with one strongest-tier global pass over its combined
  changes.
- Reports record the author's and the reviewer's model and effort. Write
  `unknown` when you don't know them; never make them up.

**Token economy.** Token spend is a continuous-improvement metric.

- Each ticket has a soft budget of sub-agent tokens, set in `PROJECT.md`. When
  the spend passes it, or a phase hits the round limit (§3), stop and give the
  user a short report: what was consumed, its size, why, and a cheaper
  alternative. Wait for the user's go before resuming.
- Record per-agent token totals with their source and limits at spec freeze and
  at closure (§7).

## 6. Git, acceptance, closure

- Never commit or push to the main branch directly. One ticket, one branch, one
  PR. Never stack a PR on an open one.
- Branch: `feat/<ticket>-<slug>`, or a ticketed branch for the short path.
  Use Conventional Commits that reference the ticket. PR title:
  `<type>(<scope>): <summary>`.
- Classify tickets with the label taxonomy named in `PROJECT.md`, not with
  title prefixes; preserve historical planning IDs in titles.
- What the PR body lists:
  - full path: AC → tests, the BRs, and any deviations from the spec;
  - short path: the scope and the checks actually run.
- Never use a ticket-closing keyword in a PR whose merge does not complete the
  ticket's acceptance; reference the ticket without closing it.
- **Remote history is never rewritten**: no rebase or force-push of a pushed
  branch. Update a branch from the main branch by merging. A branch reused after
  its PR was squash-merged restarts from the main branch and merges its old tip,
  so the push stays a fast-forward.
- Never delete a branch, a file or data without authorization. Approving a merge
  does not authorize deleting the branch.
- **Rehearse before a real run.** Every manual or real-environment acceptance
  procedure runs end to end against a test double in the feature PR before a
  human or real-environment run is requested.
- **Acceptance**: after the merge, check every AC on the actual main-branch SHA.
  Record the commands, the results and the SHA in the ticket (§9). Close the
  ticket only on success; a merge alone does not close it.
- The BR files, capability entries and changelog lines are prepared in the
  feature PR and marked as pending. Never mark a BR `active`, a capability as
  working, or a spec as `done` before acceptance. The final markers are
  synchronized in the next PR (declared in its scope), before any release.

## 7. Records

- `business-rules/BR-NNN.md`: the statement, the rationale, the source spec, the
  tests that cover it, and a status: `observed` (brownfield, §0.3),
  `pending acceptance`, `active`, or `superseded by BR-MMM`. Minimum skeleton:

  ```markdown
  ---
  id: BR-NNN
  version: 1
  status: pending acceptance
  source: F-NNN v<version>
  supersedes: <BR-MMM or none>
  ---
  ## Rule
  <one testable statement, present tense, no "should">
  ## Rationale
  <why the rule exists — the need or the risk it covers>
  ## Examples
  - **Given** <initial state, concrete values>
    **When** <single action or event>
    **Then** <observable outcome, concrete values>
  - **Given** a cart totalling 99.00 €
    **When** the customer checks out
    **Then** shipping is charged 5.00 €
  - **Given** a cart totalling 100.00 €
    **When** the customer checks out
    **Then** shipping is 0.00 €
  (One example per side of each boundary; each example maps to one test.)
  ## Verification
  <test names, file paths>
  ## History
  - v1 — YYYY-MM-DD — F-NNN — created
  ```
  An `observed` BR names its characterization tests and gives `source:
  observed <ticket>` instead of a spec.
- `capability-map.md`: the accepted, user-facing capabilities, each linked to its
  F and BR records. Provisional entries are labelled as provisional; brownfield
  entries not yet confirmed are labelled `observed`.
- `architecture-decisions/ADR-NNN-<slug>.md`: write one when a choice is costly
  to reverse. Sections: Context, Decision, Options rejected (and why),
  Consequences. An accepted ADR never changes; a new ADR supersedes it.
- F, BR and ADR IDs are sequential and global, and they are never renumbered or
  reused. Re-check the next free IDs on the main branch just before freeze and
  again before opening the PR.
- **BR versioning.** When a later feature changes a rule while keeping its
  purpose (a new threshold, a new case, a tighter condition), the BR keeps its
  ID and its `version` goes up by one:
  - add a History line that gives the version, the date, the feature that made
    the change, and what changed;
  - update the tests;
  - cite the rule as `BR-NNN vN` in specs, tests and PRs.
  When a rule is replaced by one with a different purpose, write a new BR that
  `supersedes` the old one, and mark the old one `superseded by BR-MMM`. Never
  rewrite a BR's meaning without bumping its version.
- `learnings.md`: one line per non-obvious fact that has evidence behind it:
  `- YYYY-MM-DD — <fact> — <how to apply>`. Prune duplicates.
- **Token accounting per ticket.** Record per-agent token totals (author,
  reviewer, other sub-agents) by model, with timestamps, the source of each
  figure and its coverage limits, in the ticket at spec freeze and at closure.
  Record only the counters the platform exposes; omit the others and say so.
  Never sum cumulative snapshots or count a subset counter twice. Report
  shared, missing or unattributable usage separately; never invent
  retrospective attribution, quota costs or prices. Keep transcripts, account
  identifiers and credentials out of the records.
- `CHANGELOG.md`: Keep a Changelog format, with Added, Changed, Fixed and Removed
  under Unreleased. `VERSION` follows SemVer: MAJOR for a breaking change, MINOR
  for a feature, PATCH for a fix.
- **Release only on the user's explicit go** for that version and that commit.
  Synchronize the records, promote Unreleased, bump `VERSION`, and tag
  `vx.y.z`. A build or a tag never authorizes a publication by itself.

## 8. Stop and ask — and only then

Stop and ask in these cases:

- a freeze in human mode (§2);
- a destructive or irreversible operation that hasn't been authorized;
- secrets: keep them out of the repo, the reports and the logs. List `.env` and
  key files in `.gitignore` and commit an `.env.example` with empty placeholders.
  Never generate a secret and never search for one; ask for the provisioning
  step instead;
- the round limit or the token budget is reached (§3, §5);
- a real contradiction, or a choice that is genuinely unresolved: give 2–3
  options and your recommendation.

An authorization holds for the scope it was given for, never beyond it. Within
that scope, don't ask again. Prepare everything that can be reviewed before you
ask for a decision.

A sub-agent returns 15 lines at most. Messages to the user stay short: the
decision or the blocker, with a link to the details. Don't narrate progress.

## 9. Where evidence lives

Several people and agents may work on the same project. Classify each output by
its value; the product repository holds **no per-run files**.

1. **Durable knowledge** (measurements of external systems, observed limits) is
   curated into the repository under `docs/observations/<system>.md`. Each entry
   gives the date, the method, the result and a link to its evidence. It is
   reviewed like code and contains no personal or sensitive data.
2. **Proof of a decision** (spec freeze, review verdicts, acceptance on a SHA,
   token usage) lives in the ticket and the PR:
   - the reviewer publishes its verdict on the PR itself;
   - acceptance evidence and token usage go in a ticket comment;
   - BR and capability records link to that comment.
3. **Work traces** (drafts, intermediate reports, handoffs) stay in the ticket
   or the PR.
4. Optionally, `PROJECT.md` may name a companion records repository, keyed by
   ticket.

Multi-user rules:

- Every evidence identifier has the form `<ticket>-<act>-<round>-<author>`,
  where the author is the person or agent that produced it. Never reuse an
  identifier; preserve earlier records.
- A review verdict is published by the reviewer, never transcribed by the
  author.
- At ticket closure, promote every reusable fact explicitly to
  `docs/observations/` or `learnings.md`.
- Raw outputs of real-environment runs stay with the person or agent that ran
  them; only sanitized summaries are shared.

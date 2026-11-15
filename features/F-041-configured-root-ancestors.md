---
id: F-041
title: Protect configured-root ancestors from structural mutations
ticket: "#47"
status: frozen
version: 1
---

# F-041 — Protect configured-root ancestors from structural mutations

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `fix/47-e-root-ancestor`, supplied main
`27ebcf19c02a9c136aa19954404a309f30559178`.
IDs: F-041; BR-277 v2, BR-278 v2 and new BR-427 v1; AC-01–AC-10.
No ADR. Lot D / PR #58 is merged as `67c101a`, with frozen F-040 v1,
BR-423–BR-426 v1 and BR-118 v3 pending acceptance (BR-118 v2 stays active).
The 2026-11-15 ID recheck against local `origin/main` at `67c101a` found
no collision: main allocates through F-040, BR-426 and ADR-012; this lot
adds F-041 and BR-427. Next free IDs: F-042, BR-428, ADR-013.
Recheck current main and concurrent allocations before freeze and PR creation;
no network check is authorized in this revision.

Frozen v1 on 2026-11-15 at the owner's explicit instruction, from reviewed
base `75c0ceaec1f8ba3603863ca91330ff5337ab6b3c` (local HEAD verified),
with supplied
`47e-spec-review-2-reviewer` (changes) and
`47e-spec-decision-1-fable` (approve, minors), with all corrections and
verdicts recorded below. This explicit freeze instruction overrides the
usual requirement for a new approval of the corrected head; no such
approval is claimed. This uncommitted freeze revision has no new SHA.
Implementation, code review, CI and actual-main acceptance remain pending.
Review token totals and actual reviewer model/effort were not supplied;
no retrospective usage is inferred. Decision-pass tier is Fable 5.2 per PROJECT.md.

Freeze allocation recheck: cached `origin/main` is `67c101a`, allocating
through F-040, BR-426 and ADR-012. This branch adds F-041 and BR-427;
all 425 allocated BR IDs have records (withdrawn BR-376/BR-377 excluded).
Next free IDs: F-042, BR-428, ADR-013. Recheck current main before the PR.
No network or ticket-state update is performed. Tests first follows
AGENTS.md §3; local checks use existing host dependencies under this
assignment's no-Docker constraint and are neither `make check` nor CI.

## Context

Ticket #47 lot E addresses finding 5 of the supplied cross-vendor review.
F-017 / BR-278 protects configured roots only when their drive-qualified
IDs are targeted directly. With overlapping roots, an authorized folder
inside an outer root can contain an inner configured root. Trashing,
renaming or moving that folder changes the inner root indirectly. This is
the documented residual risk R-17-2 in `SECURITY.md` and BR-277.

The owner chose option b: refuse those three structural mutations on every
strict ancestor of a configured root that the server can establish from
its evidence. This protects operators' configured boundaries in both
`write` and `share` modes. Overlapping roots remain valid configuration.
An unprovable relationship cannot authorize a structural mutation.

The targeted source inventory found the direct-ID guard in
`src/policy/index.ts` (`effects`), canonical evidence validation in
`src/policy/values.ts` (`item`, `path`, `observe` in the policy index),
provider parent-ID normalization in `src/kdrive/normalize.ts` (`treeItem`,
`ordered`), and the refusal/audit mapping in `src/mutation-gate.ts`
(`decide`, `recordBase`) and `src/audit/sink.ts`.
These existing contracts already have active BRs; no new observed rule is
needed. The new behavior below is pending, not an observation of the code.

## Scope

- Extend the shared policy's protected-source check for folder `trash`,
  `rename` and `move`, including compound effects that contain those kinds.
- Determine current ancestry from fresh, validated server-side evidence
  for configured root IDs in the source drive; fail closed on unknowns.
- Preserve the direct-root refusal, public code and audit schema.
- Prepare pending BRs, indices, capability and changelog records; mark
  R-17-2 as remediation specified, still present until acceptance.
- In the later implementation, update README and SECURITY wording under
  BR-277 v2 without claiming acceptance before actual-main verification.

### Out of scope

- Rejecting overlapping roots during configuration (owner option a).
- Other #47 lots, received-share write qualification, new mutation tools,
  new limits, new audit fields/events, or new refusal codes.
- Changes to copy, upload (including replacement), create, restore, read
  or share-link policy; changes to move destination authorization.
- Solving provider check-then-act races, tracking external changes with
  watches, storing ancestry between invocations, or following unbounded
  parent links. No claim of atomic provider-wide root protection.
- Source edits, Docker, network, commits, implementation, acceptance or
  release in this assignment. This assignment freezes the revised contract
  and writes tests first; code review and acceptance remain required.

## Business rules

- **BR-278 v2** — The policy refuses `trash`, `rename` and `move` when the
  source is a configured root or a folder that is a strict ancestor of
  any configured root in the same drive, in every mutation-enabled mode;
  the gate returns `denied` / `ACCESS_DENIED` with zero attempts and no
  intent or mutation request. Verified by: AC-01–AC-04, AC-07–AC-09.
- **BR-427 v1** — A folder structural mutation is eligible only after
  current, complete, mutually consistent live evidence excludes the source
  from the strict ancestors of every configured root in that drive;
  missing or invalid evidence refuses through the existing protected-root
  public refusal. Verified by: AC-05–AC-08.
- **BR-277 v2** — Write-tool documentation states the ancestor protection,
  unknown-ancestry refusal and its visibility/race limits, and tracks
  R-17-2 as pending until actual-main acceptance. Verified by: AC-10.

BR-277 v1 and BR-278 v1 remain active and their statements are preserved.
Unchanged dependencies: BR-029 (trusted evidence), BR-030 (ID membership),
BR-033 (complete consistent evidence), BR-034–BR-039 (effects/denies),
BR-043 (guarded dispatch), BR-070 v5 (invocation bounds), BR-199 (provider
normalization), BR-234/BR-236/BR-237 (audit schema/identity), BR-246 (denial
audit), BR-257 (received writes), BR-259 v2 (audit append bounds),
BR-262 (tool projection) and BR-275 (same-drive move).

## Contract details

### Current ancestry, identity and path validation

Keep the early direct `(driveId, target.id)` comparison against configured
root pairs, including ID 1, without needing a root metadata read to refuse.
For another source, retain normal mode, scope, evidence and deny checks.
Only a live directory source of `trash`, `rename` or `move` needs the new
negative ancestry proof. Place it after `authorize(source)` and the source
`dir` type check, before destination effects, execution or intent, in
`src/policy/index.ts` (`effects`; review-base line 449,
`if (source) authorize(source);`), before the destination inspect at line 455. A file cannot
contain a root. An otherwise unauthorized call need not perform extra
inspections. Received-share sources come from drives that are not configured,
so no configured root can match: zero configured-root reads hold only
because that drive has no configured root. `shared.gate` (policy line 469)
runs after the new check; BR-257 still refuses afterwards. This check does
not qualify received-share writes.

For each configured root in the source drive, use its resolved folder ID,
never its configuration-time path. Inspect that exact ID at location `live`
through the existing bounded policy dependency. One inspection per distinct
identity within the decision can be reused and must participate in the
invocation's observation/consistency checks. Do not reuse preflight evidence
or evidence from a previous invocation. Root ID 1 has no strict ancestors
by the existing sentinel contract and needs no additional inspection for
this proof. Roots in other drives need no inspection and cannot match.

Each other root must be a complete live directory with the requested
identity and a complete ordered same-drive parent chain. Validate the
existing F-003 / BR-033 and BR-199 invariants, including unique IDs, no
self-parent/cycle, adjacency and canonical path/name consistency. A source
is a strict ancestor iff its drive-qualified ID occurs in that chain.
Reconcile source and ancestor observations; contradictory chains are
unknown, never evidence of non-ancestry. A canonical strict path-prefix
relationship and the ID relationship must agree: disagreement is incomplete
evidence. Paths validate the identity chain; path prefixes alone cannot
establish or exclude ancestry. No descendant-tree traversal is needed for
this additional check, even with empty denies. Existing deny traversal is
unchanged and can still independently refuse.

Canonical server-side paths retain F-003's exact code-point semantics:
absolute `/`-separated components, 4,096-byte limit, no empty component,
`.` or `..`, controls or backslash. `/` alone is the root sentinel; other
trailing slashes and repeated slashes are invalid evidence, not silently
trimmed. Do not case-fold, URL-decode, trim spaces or normalize Unicode.
`/A` and `/a`, and NFC and NFD component strings, remain distinct when
consistently represented. A strict prefix ends at a component boundary:
`/A` is not an ancestor of `/AB`. IDs make protection independent of the
root's spelling. Case-only or Unicode-form changes between invocations
still protect the same root ID; inconsistent representations within one
decision fail closed. No new normalization policy is introduced.

The configured ID remains protected after an external rename or move.
Inspecting that ID again protects its new current parents; a former parent
is no longer protected solely by the obsolete relationship. A different
folder created at the old path is not the configured root. If the configured
ID is missing, inaccessible, trashed, not a directory, incomplete, or its
inspection rejects, ancestry is unknown: refuse, even for an apparent
sibling. Do not assume that an invisible root cannot be below the source.
Inspection is internal evidence acquisition, not a new client read
capability; deny patterns do not filter roots out of the protected set.

All root inspections share existing request budgets, deadlines and
cancellation. No extra budget, retry loop, background lookup or constructor
I/O is introduced. Stop when a protected relationship or unknown is found;
otherwise all same-drive roots must be proved non-descendants. Existing
invocation/admission interruption results retain precedence if a deadline,
budget or cancellation has already ended the invocation; none may dispatch
a mutation. The ordinary unknown-evidence refusal below assumes an admitted,
live invocation, exactly as the existing protected-root refusal does.

### Refusal and audit

At policy `check`, a proven protected source uses existing internal
`INVALID_OPERATION`; malformed/missing ancestry uses `EVIDENCE_UNAVAILABLE`.
The guarded dispatch exposes `{ok:false,code:"ACCESS_DENIED"}` in both
cases. An admitted gate run returns exactly
`{result:"denied",op:O,code:"ACCESS_DENIED",attempts:0}`. The mutation tool
returns `isError:true` and one text item containing JSON of that gate result,
as BR-262 requires. No root path, ancestry detail or internal code escapes.

With a healthy sink, exactly one serialized audit record is emitted:

```json
{"v":1,"ts":"T","event":"denied","op":"O","identity":{"kind":"stdio"},"tool":"kdrive_trash","kind":"trash","drive":101,"ids":{"target":10},"code":"ACCESS_DENIED"}
```

Here `T` is the injected UTC timestamp and `O` the gate's 32 lowercase hex
operation ID, identical in the result and record. Substitute the admitted
identity per BR-237, actual tool/kind and source drive/ID; move also has
`ids.destination`. `destinationDrive` is present only for a different-drive
destination as in `recordBase` (such moves remain independently refused).
The serialized object has exactly these schema keys and a final LF; it has
no `result`, `attempts`, `ms`, `status`, `created`, root ID list, path, name,
reason or new event. There are zero `intent`/`outcome` records and zero
upstream mutation requests. Read-only metadata requests are permitted.
The one denied append is best effort: its rejection leaves the result
unchanged (BR-246), under BR-259 v2's existing bound and failure latch.
This is an append attempt, not a guarantee of delivery to a failed sink.

### Source versus destination

Move tests ancestry of the source, never the destination as a protected
source. Moving a protected ancestor anywhere, including to its existing
parent or another ancestor, refuses. Moving an unrelated item into a root,
its parent or its grandparent is not refused by this rule; ordinary scope,
denies, collision and self/descendant-move restrictions still apply.
Renaming to the current name still refuses for a protected source.
Copy/upload/create/restore get no new root inspection or ancestor restriction.
Copy remains unavailable: neither the policy operation registry nor the
production tool registry currently supports it; this lot adds no support.

## Acceptance criteria

These are exact planned test names, not execution claims. Each matrix row
uses a fresh fixture unless it explicitly tests successive invocations.
Use drive 101 with configured roots `101:1` and `101:40`, directories
`10:/A`, `11:/A/B`, `40:/A/B/R`, `20:/S`, `30:/D` and file `21:/S/f`.
Denies are empty unless stated; both `write` and `share` modes use a healthy
admitted gate. The synthetic mutator returns valid HTTP 200 success.
`D` means the exact refusal and serialized denied record specified above,
zero intent/outcome and zero mutation requests. `S` means `succeeded`,
`attempts:1`, `status:200`, one mutation request and exactly `intent` then
`outcome` (`result:"succeeded",attempts:1,status:200`), no denied event;
correlation, IDs and unchanged kind-specific values follow F-017/F-018.

- **AC-01** (BR-278 v2) — Given this fixture in each mode, When trash,
  rename to `New`, or move to 30 targets direct parent 11 and grandparent
  10, Then every row yields D. Verified by
  `TestBR278_v2_AC01_parent_and_grandparent_refused_in_write_and_share`
  in `tests/mutation-production.test.ts` (12 rows, repeated with nonempty
  unrelated denies `["/blocked/**"]`). Given a policy batch containing a
  permitted sibling rename and a protected-ancestor mutation, Then the
  entire dispatch is `{ok:false,code:"ACCESS_DENIED"}` with zero executions.
  Verified by `TestBR278_v2_AC01_batch_cannot_bypass_ancestor_protection`
  in `tests/policy.test.ts`.
- **AC-02** (BR-278 v2) — Given each mode, When those three operations
  target root 40 or root 1, Then every row yields D without root inspection
  for this check. Given sibling folder 20, When the same operations target
  it, Then every row yields S. Verified by
  `TestBR278_v2_AC02_direct_roots_still_refused_and_siblings_allowed`
  in `tests/mutation-production.test.ts`. Also retain the existing
  `TestBR278_trash_rename_move_of_roots_1_and_40_are_denied` baseline.
- **AC-03** (BR-278 v2) — Given unrelated source 20, When moved into 10,
  11 or 40, Then S. Given source 10 or 11, When moved to 30, 1 or its
  existing parent, or renamed to its current name, Then D. Given source
  20 moved into itself or its descendant, Then the existing refusal D.
  Verified by `TestBR278_v2_AC03_move_destination_is_not_a_protected_source`
  in `tests/mutation-production.test.ts`, in both mutation modes.
- **AC-04** (BR-278 v2, BR-246) — Given a protected ancestor denial with
  marker names/paths, When the tool completes, Then its complete result,
  audit JSON keys/values/LF and event counts equal D, with no marker or
  protected-root metadata. When the denied append rejects, Then exactly
  one append is attempted, no mutation starts, and the result remains D's
  gate result. Verified by
  `TestBR278_v2_AC04_ancestor_denial_preserves_result_and_audit_schema`
  in `tests/mutation-production.test.ts` and
  `TestBR278_v2_AC04_failed_denied_append_keeps_access_denied`
  in `tests/mutation-gate.test.ts` using real guarded dispatch.
- **AC-05** (BR-427) — Given a folder source and root 40 whose live
  inspection is missing, incomplete, rejected, trashed, a file, wrong ID,
  wrong drive, cyclic, missing an intermediate parent, or contradictory
  to the source observation, When any of the three structural operations
  is requested, Then D, even for apparent sibling 20. Verified by
  `TestBR427_AC05_unknown_root_ancestry_fails_closed`
  in `tests/mutation-production.test.ts` for missing/incomplete/rejected
  transport evidence, and `tests/policy.test.ts` for every normalized
  evidence row (dispatch exactly `{ok:false,code:"ACCESS_DENIED"}` and
  zero executions). Use the same exact test name in those two suites.
- **AC-06** (BR-427) — Given consistent fresh ancestry, When parent names
  use case variants or NFC/NFD forms and a structural operation targets
  their ID, Then it refuses; unrelated `/AB`, `/a` and a canonically
  equivalent but distinct Unicode-name sibling remain allowed by ID.
  Given trailing slash, double slash, mismatched case or Unicode forms
  between path/name/chain, or a strict path prefix without the matching
  ancestor ID, Then dispatch refuses `ACCESS_DENIED`, zero executions.
  Verified by `TestBR427_AC06_ids_and_exact_canonical_paths_agree`
  in `tests/policy.test.ts`; allowed rows return `{allowed:true}` from
  `check`, protected rows `{allowed:false,code:"INVALID_OPERATION"}`,
  invalid rows `{allowed:false,code:"EVIDENCE_UNAVAILABLE"}`.
- **AC-07** (BR-427, BR-278 v2) — Given the same policy instance, When
  external changes rename root 40 (including case-only and NFC/NFD changes)
  before the next call, Then trash/rename/move of 10 and 11 still yield D.
  When root 40 moves under 30 between calls, Then operations on 30 yield
  D, and on former parent 11 yield S if no other root remains below it;
  root 40 itself still yields D. A new ID at the former root path does not
  change that outcome. Assert fresh root GETs in every folder trash/rename/move invocation whose
  source is not a configured root, and assert current parent evidence; no preflight-path match or
  cross-invocation cache. Verified by
  `TestBR427_AC07_renamed_and_moved_roots_use_current_id_ancestry`
  in `tests/mutation-production.test.ts`.
- **AC-08** (BR-427, BR-278 v2) — Given several roots in drive 101 with
  only the last below source 10, Then each structural operation yields D;
  unknown evidence for any same-drive root also yields D. Given all such
  roots proved outside source 20, and inaccessible roots only in drive
  102 (including matching numeric IDs), Then S and no drive-102 ancestry
  inspections. Count at most one inspect per distinct same-drive root ID
  per decision, no added inspection of sentinel 1, and no new child-list
  request when denies are empty. Verified by
  `TestBR427_AC08_all_same_drive_roots_checked_once_without_tree_walk`
  in `tests/mutation-production.test.ts`. Given a pending root read and
  invocation expiry/cancellation, Then existing interruption behavior
  settles without intent or mutation; late evidence cannot execute.
  Verified by `TestBR427_AC08_root_reads_share_existing_invocation_bounds`
  in `tests/invocation-queue.test.ts`: an admitted run returns exactly
  `{result:"failed",op:O,code:"REQUEST_TIMEOUT",attempts:0}` at the
  BR-070 v5 invocation deadline (the existing navigation deadline constant),
  or `{result:"failed",op:O,code:"CANCELLED",attempts:0}` on cancellation,
  with zero audit records and zero mutation requests. The tool wraps this
  gate JSON with `isError:true`; the pre-intent interruption precedence in
  `navigation.mutate` / `mutation-gate.decide` remains unchanged.
  Given the configuration maximum of same-drive roots (256 entries,
  `src/config-values.ts:204`: 255 roots plus the sentinel) and a deny
  traversal that together exhaust the existing shared 512-call invocation
  budget (`src/navigation.ts:321`), When their calls consume that budget, Then the admitted run
  returns `{result:"failed",op:O,code:"LIMIT_EXCEEDED",attempts:0}`,
  with zero mutation attempts, no intent or mutation, and the same error
  tool wrapper. Verified by the same invocation-bounds test's
  `budget-exhaustion` row. No new root-count cap or extra budget is introduced.
- **AC-09** (BR-278 v2) — Given a root inspection double that would fail,
  When allowed create/upload into 10 or 11, or rename/move/trash of file
  21 runs, Then S and zero additional root inspection calls. Given a
  `copy` operation, Then policy `check` remains
  `{allowed:false,code:"INVALID_OPERATION"}` with no root reads. Given
  permitted restore evidence, Then `check` remains `{allowed:true}`
  with no additional root reads. Given a received-share folder source from
  an unconfigured drive, with `sharedWithMe=true` and `sharedWrite=true`,
  When trash, rename or move is requested, Then BR-257 still yields D
  after a fresh complete `shared_with_me` list, with zero configured-root
  reads. Verified by `TestBR278_v2_AC09_received_share_refused_without_root_reads`
  in `tests/mutation-composition.test.ts`.
  Read mode still exposes no mutation tools and refuses direct structural
  policy requests with `{allowed:false,code:"LEVEL_REQUIRED"}`.
  Verified by `TestBR278_v2_AC09_other_operations_and_read_mode_unchanged`
  in `tests/policy.test.ts`, and
  `TestBR278_v2_AC09_create_upload_and_file_mutations_unchanged`
  in `tests/mutation-production.test.ts` (create/file operations) and
  `tests/upload-production.test.ts` (upload). Existing scope, denies,
  received-share and move-cycle tests remain unchanged controls.
- **AC-10** (BR-277 v2) — Given the frozen records, Then R-17-2 explicitly
  remains present, with remediation pending implementation/acceptance.
  Given later implementation documentation, Then README and SECURITY name
  source-ancestor protection in write/share, fail-closed unknown ancestry,
  permitted overlapping configuration and unchanged destination handling;
  the visibility and check-then-act limits remain explicit. README includes
  a troubleshooting sentence: check that configured roots are readable when
  a folder mutation is denied; restore remains available under its existing
  restrictions. Only after
  actual-main acceptance may the next records PR mark the specific known-
  ancestor bypass addressed and link its evidence. Verified by
  `TestBR277_v2_AC10_documented_ancestor_protection_and_residual_status`
  in `tests/mutation-tools.test.ts` for implementation wording, and the
  independent reviewer's document/status check at each phase.

## Test plan

1. After independent review and freeze, characterize the baseline before
   source edits: direct root refusal and exact audit, permitted sibling
   operations, destination-side moves, canonical path validation and
   create/upload/copy/restore behavior. Run existing policy, mutation gate,
   production mutation and upload suites and record their actual results.
2. Write AC-01–AC-10 tests first. Observe ancestor, unknown-root and moved-
   root cases fail on the old implementation; keep unchanged cases as
   passing controls. Use minimal bounded synthetic trees and injected
   local transport; run each mutating row on a fresh fixture. No real
   provider write, token or owner-run acceptance is needed for this lot.
3. Implement only the frozen contract in the shared policy and its existing
   evidence path; exercise production wiring, not only mocked policy
   decisions. Verify empty and nonempty denies, both modes, ID/drive
   isolation and the audit append-failure case. Run the affected suites
   and `make check` via the normal Docker/Make gate in the authorized
   implementation environment. Do not weaken limits to accommodate roots.
4. A fresh strong-tier spec review and strongest-tier security decision
   pass after approval precede freeze. The corresponding code reviews,
   PR CI and acceptance on the actual main SHA remain mandatory. Publish
   review, freeze, acceptance and exposed token totals in #47/its PR with
   unique lot-E evidence IDs; this lot does not close the whole ticket.
   Synchronize accepted BR/spec/capability/R-17-2 markers in the next
   reviewed PR before release. No per-run repository files are produced.

The freeze revision and tests-first assignment run local document/content
and targeted host checks where dependencies permit; the Docker gate and CI
are not run. No corrected-head review or acceptance is claimed. No per-agent token counter is exposed for this authoring phase;
no retrospective attribution or total is inferred.

## Decisions

- **D-1 — Refuse source ancestors, retain overlapping configuration.**
  Owner option b is the contract. Option a (reject overlaps) is out of
  scope; warning-only protection leaves the known bypass open.
- **D-2 — Fresh root ID chains, paths as consistency checks.** The existing
  normalized evidence port supplies complete chains. Configuration-time
  paths go stale; path-prefix-only matching confuses spellings and cannot
  bind the configured identity. Recursive descendant enumeration costs
  more and is unnecessary to establish ancestors of known IDs.
- **D-3 — Unknown means refuse.** Inspect all relevant same-drive roots
  unless already refusing. Ignoring inaccessible roots could authorize
  their indirect removal; refusing other drives adds no protection.
- **D-4 — Keep existing refusal and audit.** Reuse `ACCESS_DENIED` and
  `denied`; do not disclose which configured root prevented the operation.
  Existing admission/interruption and audit-failure contracts stand.
- **D-5 — Source effects only.** Destination ancestry neither removes nor
  relocates that destination. Apply existing destination/effect checks;
  broad destination bans or copy/upload/create restrictions exceed the
  owner decision. No-op source renames/moves receive no exception.
- **D-6 — Stage the residual status honestly.** Mark remediation specified
  now, implementation pending; only actual-main acceptance can justify
  retiring the known-ancestor R-17-2 bypass. R-17-1 and other race risks
  are unchanged. No costly new architecture choice requires an ADR.

## Risks

- A stale or inaccessible configured ID blocks otherwise permissible folder
  structural mutations in its drive until evidence/configuration is fixed;
  this is the intentional fail-closed availability tradeoff. These denials
  look like scope denials; README troubleshooting must tell operators to
  check configured-root readability and that restore remains available.
  A transient upstream failure on any root read also yields a spurious
  `ACCESS_DENIED`; this becomes more likely with many roots.
- Extra root metadata reads consume existing budgets and can cause earlier
  refusals. Root count is capped at 256 by configuration
  (`src/config-values.ts:204`); the linear cost is one GET per
  non-sentinel same-drive root per folder trash/rename/move, sharing the
  512-call invocation budget with deny traversal (`src/navigation.ts:321`).
  Per-decision reuse avoids duplicates; no increase to limits or new
  background cache is authorized.
- Fresh inspections are not an atomic provider snapshot. Another actor can
  move a root beneath a checked source after evidence acquisition. Detect
  contradictions observed in one decision, but retain SPEC §10.6's race
  limit rather than claiming the entire class eliminated. The ancestry
  proof precedes deny traversal (`src/policy/index.ts:520–525`), so the
  race window can approach the invocation deadline. This risk is accepted.
- Case/Unicode inconsistencies from a provider refuse rather than being
  repaired. Consistent external changes still follow the configured ID.
- Lot D / PR #58 is merged as `67c101a`; the local ID recheck found no
  collision. Concurrent allocations still require rechecking before freeze
  and PR creation; no remote freshness or lot-D acceptance is inferred.

## Open questions

None. Ancestry strategy, unknown evidence, destination semantics and staged
R-17-2 status are resolved by D-2–D-6; overlap policy is the owner's D-1.

## Stress-test

### Review 1 dispositions

The owner supplied this review for this revision; the entries below record
its verdict and the disposition of every finding, not a new review or an
approval of the revised head. Reviewer model/effort and token counters were
not supplied (unknown); no usage is inferred. That revision remained draft v1.

### 47e-spec-review-1-reviewer — verdict: changes

1. **Major — pending-rule counts. Retained, fixed in this revision.**
   Kept main's distinction between rules and pending versions in the BR
   index. Verified the files: 412 active, eight superseded and five pending
   rules (BR-423–BR-427), plus three pending versions of active rules
   (BR-118 v3, BR-277 v2, BR-278 v2): eight pending versions in total,
   across 425 allocated rule IDs. Existing accepted definitions stay active.
2. **Major — lot-D allocation and next IDs. Retained, fixed in this revision.**
   The spec index retains main's F-040 record and adds F-041, with current
   next free IDs F-042, BR-428 and ADR-013. Both lots' pending records remain.
3. **Minor — merged lot-D base. Retained, fixed in this revision.**
   Recorded PR #58 merged as `67c101a` and the collision-free local
   `origin/main` ID recheck; no network freshness or acceptance is claimed.
4. **Minor — received-share refusal. Retained, fixed in this revision.**
   Recorded unconfigured source drives, no matching configured root and
   BR-257's prior refusal. Added an AC-09 received-share row with zero
   configured-root reads and a named production-composition test.
5. **Minor — fresh-read assertion scope. Retained, fixed in this revision.**
   AC-07 now requires fresh reads for every folder trash/rename/move
   invocation whose source is not a configured root.
6. **Minor — check placement. Retained, fixed in this revision.**
   Pinned the check after source authorization and the directory type
   check, before destination effects, execution and intent in `effects`.
7. **Minor — invocation deadline reference. Retained, fixed in this revision.**
   AC-08 cites the BR-070 v5 invocation deadline constant instead of
   duplicating a numeric duration.

### 47e-spec-review-2-reviewer — verdict: changes

- **R2-1 — Major, stale allocation paragraph. Retained, fixed.** The BR
  index now states that all 425 allocated IDs have records; next free BR-428.
- **R2-2 — Check placement. Retained, fixed.** Cite policy line 449's
  `if (source) authorize(source);`, before destination inspection at 455;
  lines 431–439 describe the existing direct-root guard.
- **R2-3 — Received-share ordering. Retained, fixed.** `shared.gate` at
  469 follows the new check. No roots are read only because the received
  source drive has no configured roots; BR-257 still refuses afterwards.
  This supersedes Review 1's incorrect "prior refusal" description.
- **R2-4 — Merged lot D. Retained, fixed.** The BR index names merged
  lot D (`67c101a`), not concurrent PR #58.

### 47e-spec-decision-1-fable — verdict: approve, minors

- **F-1 — Shared budget and linear cost. Retained, fixed.** AC-08 adds
  `budget-exhaustion`, preserving `LIMIT_EXCEEDED` and zero mutation
  attempts; Risks records the per-root GET cost under the existing 256-root
  configuration cap (corrected at freeze: Fable's "uncapped" premise was
  wrong; noted by the tests-first author).
- **F-2 — Troubleshooting. Retained, fixed.** AC-10 and BR-277 v2 require
  README guidance to check root readability and retain restore availability.
- **F-3 — Long race window. Retained, accepted risk.** The proof precedes
  deny traversal; the check-then-act window can approach the deadline.
- **F-4 — Transient upstream failures. Retained, accepted risk.** Any root
  read failure can cause a spurious `ACCESS_DENIED`, more likely with many roots.

These verdicts were supplied by the owner, not generated in this assignment.
No corrected-head approval, forge publication or actual-main acceptance is
claimed. Actual reviewer model/effort and per-agent token counters were not
supplied; no retrospective attribution is inferred.

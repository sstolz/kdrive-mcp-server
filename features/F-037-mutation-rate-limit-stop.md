---
id: F-037
title: Stop rate-limited mutations before stale authorization can be reused
ticket: "#47"
status: done
version: 1
---

# F-037 — Stop rate-limited mutations before stale authorization can be reused

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `fix/47-a-mutation-retry`, main
`22db2a07a73a1842903a814339e7b93a174524a7`.
IDs: F-037; BR-248, BR-249, BR-250 and BR-268 v2; AC-01–AC-08. No new BR ID or ADR.
Next free IDs checked in the supplied main checkout (`docs/spec-index.md`,
`business-rules/`): F-037, BR-423, ADR-013. Recheck on main before freeze
and before opening the implementation PR; no remote check was performed.

## Context

Ticket #47 lot A addresses the supplied cross-vendor finding confirmed by
`src/mutation-gate.ts`: `decide()` dispatches through the policy once,
`execute()` starts one committed run, and `attempts()` retries a 429 by
calling the mutator again after a wait, without another policy decision.
The original proof can be stale if the target, its ancestors or the
destination moves during that wait. Operators' configured boundaries can
therefore be bypassed by a later attempt. Write/share callers and audit
operators are affected.

The owner permits either full authorization before every retry or returning
`RATE_LIMITED` without retrying. This spec selects the latter (D-1): every
gate run makes at most one upstream attempt. A subsequent client invocation
enters the ordinary admission and policy path afresh. This removes the
retry window without building another authorization/execution lifecycle.

Authorization remains the existing complete check: configured drive/root
membership and identity-bound roots (BR-029–BR-031), fresh consistent
evidence (BR-032–BR-033), deny patterns and derived/descendant effects
(BR-034, BR-035 v2, BR-036–BR-038), restore proof (BR-039 v2), sharing
restrictions and cumulative mode (BR-040–BR-042), guarded single-use
dispatch (BR-043), bounded refusal (BR-046), and protected configured
roots (BR-278). BR-256 binds this policy to the gate. The policy's sharing
checks include public-link enablement and the invitation-domain allowlist.

Configuration is captured when the policy/composition is constructed
(`src/policy/index.ts`); this is not a hot-reload feature. The mutation
`Operation` schema and production mutators have no version/ETag request
precondition. Upload `conflict=version` is a provider conflict mode, not
an optimistic version guard. No stale precondition can be replayed within
a run after this change, and no new version guarantee is claimed.

## Scope

- BR-248 v2: terminate a valid upstream 429 with the existing `RATE_LIMITED`
  result after one attempt; remove automatic mutation retries and their waits.
- BR-249 v2: retain the 60,000 ms run deadline from the first attempt and
  the 30,000 ms attempt cap; explicitly apply them to the sole attempt and
  replace the historical second-attempt example (D-5).
- BR-250 v2: remove the obsolete cancellation-during-retry-wait branch;
  cancellation during the sole attempt leaves its classification intact,
  including a 429. Preserve all pre-attempt cancellation rules.
- BR-268 v2: preserve the raw-port contract and bounded `Retry-After`
  forwarding; replace the gate-level wait example with a terminal 429.
- Specify exact audit/results, race and control tests, malformed-reply
  classification, deadlines and outcome-write failure regressions.
- Prepare pending records only in this phase. At implementation update
  `SECURITY.md`, `docs/development.md` and `docs/mcp-client-compatibility.md`
  to explain the one-attempt rule, fresh authorization on a new invocation,
  and unchanged uncertainty warning. Client guidance distinguishes a new
  invocation after a pause for `RATE_LIMITED` from an uncertain write, which
  must not be re-invoked without first verifying the item state.
- At implementation, document in `SECURITY.md` the quantified residual
  first-attempt window and the unmeasured D-16-5 assumption described under
  Risks; add the exact follow-up line specified there to `BACKLOG.md`.
  Tracking this residual risk is in scope; closing the window is not.

### Out of scope

- Other lots of #47, read retries, provider rate limits, tool availability,
  configuration reload, new authorization rules or mutation version guards.
- An idempotency key, deduplication store, persistent retry job, new audit
  event/field/code, returned `Retry-After`, or a client retry scheduler.
- Closing the existing check-then-act window before the first request,
  including an asynchronous intent append; atomic provider authorization.
- Editing `src/` or `tests/`, running Docker or network operations, commits,
  a new review, freeze, implementation, acceptance or release in this
  spec-revision step; record the two supplied reviews under Stress-test.

## Business rules

- **BR-248 v2** — Each admitted mutation run makes at most one upstream
  attempt. A reply that passes BR-247's reply contract and has HTTP status
  429 terminates the run as `failed`, code `RATE_LIMITED`, status `429`,
  attempts `1`, without waiting for `Retry-After` or calling upstream again.
  Any subsequent client invocation is a new run subject to all ordinary
  admission and authorization checks; it inherits no grant from the previous
  run. Verified by: AC-01–AC-08.
- **BR-249 v2** — The run retains a 60,000 ms monotonic deadline from
  the first attempt; its sole upstream attempt is aborted after the smaller
  of 30,000 ms and the remaining run time and is then `uncertain`. The
  60,000 ms ceiling is retained but redundant for one attempt, not a retry
  window or an additional wait. A valid 429 before timeout terminates under
  BR-248 v2. Verified by: AC-06.
- **BR-250 v2** — v1 holds except that there is no 429 wait or cancellation
  branch after a 429. Cancellation during the sole upstream attempt does
  not abort it or replace its classification, including `failed` /
  `RATE_LIMITED` on a valid 429; cancellation after that classification
  likewise cannot replace it. Pre-intent and post-intent/pre-attempt rules
  stay unchanged. Verified by: AC-05 and AC-06.
- **BR-268 v2** — The v1 raw-port reply, body validation and 32-byte
  `Retry-After` bound remain unchanged. Forwarding a bounded header never
  schedules a gate retry: a valid 429 terminates under BR-248 v2 regardless
  of whether the header is passed or omitted. Verified by: AC-08.

Unchanged dependencies: [BR-243](../business-rules/BR-243.md) (one durable
intent and one outcome), [BR-244](../business-rules/BR-244.md) (intent
failure), [BR-245](../business-rules/BR-245.md) (admission),
[BR-246](../business-rules/BR-246.md) (policy denial),
[BR-247](../business-rules/BR-247.md) (reply validation/classification),
[BR-251](../business-rules/BR-251.md) (uncertainty),
[BR-252](../business-rules/BR-252.md) (outcome-write failure),
[BR-255](../business-rules/BR-255.md) (result fields),
[BR-256](../business-rules/BR-256.md) (composition),
[BR-258 v2](../business-rules/BR-258.md) (navigation commit boundary), and
[BR-278](../business-rules/BR-278.md) (protected roots). BR-247's ordinary
classification table still excludes the special 429 handled by BR-248.

## Contract details

### One run, one attempt

Retain the current admission, dispatch, intent, attempt and finish order.
Do not recursively call `run()` or `dispatch()` after a 429. Do not add a
wrapper that silently resubmits the tool call. No deferred task or timer
can call the mutator after the run settles. `Retry-After` can remain in
the internal port reply for compatibility, but schedules nothing and is
not exposed in the client result or audit log. BR-247 validation precedes
classification: a malformed object merely containing `status: 429` is
still `uncertain`, not proof of a rate-limit refusal.

BR-248's former three-attempt ceiling becomes one, and its 30-second wait
ceiling and fallback waits no longer apply. BR-249 v2 keeps the 60,000 ms
total deadline from the first attempt, never reset or extended; the sole
attempt remains bounded by the smaller of 30,000 ms and remaining run
time. D-5 retains this now-redundant ceiling; it never permits waiting
beyond the sole attempt's 30,000 ms cap. A 429 received before that attempt
expires ends immediately after the outcome append, even with a zero, missing or invalid retry delay.
At the attempt timeout, the existing `uncertain` classification wins;
late replies cannot change it. Audit append bounds remain unchanged.

### Exact results and audit records

Use synthetic clocks, synchronous successful sink appends and a recording
sink. These symbols specify complete parsed JSONL objects (including `v`),
not subsets. `T` is the injected ISO timestamp at each append, `O` the
run's injected 32-hex identifier, `M` the rounded elapsed monotonic time
since intent resolution, and `B` the exact base for that operation:

```ts
const B = {
  v: 1, ts: T, op: O, identity: { kind: "stdio" },
  tool: "kdrive_rename", kind: "rename", drive: 101,
  ids: { target: 42 },
};
const I = { ...B, event: "intent" };
const L = {
  ...B, event: "outcome", result: "failed", attempts: 1, ms: M,
  status: 429, code: "RATE_LIMITED",
};
const D = { ...B, event: "denied", code: "ACCESS_DENIED" };
const S = {
  ...B, event: "outcome", result: "succeeded", attempts: 1, ms: M,
  status: 200,
};
const U = {
  ...B, event: "outcome", result: "uncertain", attempts: 1, ms: M,
  code: "UPSTREAM_UNCERTAIN",
};
```

For other operations substitute their exact tool/kind/IDs and optional
`destinationDrive` under BR-234; include no name, path, payload, header,
exception text or additional field. Use distinct injected IDs for successive
runs. Capture each run separately and compare complete result/event arrays.

| Case | Exact gate result | Complete audit array |
| --- | --- | --- |
| Valid 429, sink succeeds | `{result:"failed", op:O, code:"RATE_LIMITED", attempts:1, status:429}` | `[I, L]` |
| Fresh invocation denied by policy | `{result:"denied", op:O, code:"ACCESS_DENIED", attempts:0}` | `[D]` |
| Fresh gate admission in read mode | `{result:"failed", code:"ACCESS_DENIED", attempts:0}` | `[]` |
| Accepted 200 without value/created in the fixture | `{result:"succeeded", op:O, attempts:1, status:200}` | `[I, S]` |
| Timeout or malformed reply | `{result:"uncertain", op:O, code:"UPSTREAM_UNCERTAIN", attempts:1, message:W}` | `[I, U]` |

`W` is exactly `The upstream result is unknown; verify the item's state
before any new attempt.` A valid 503 adds `status:503` to both the
uncertain result and `U`; a valid 412 gives `failed`, `UPSTREAM_REJECTED`,
`attempts:1`, `status:412` in both result and outcome, without a message.
Gate results have no `value` in these fixtures. The navigation controller
wraps gate results as `{ok:true,value:<gate result>}` once gate execution
is reached; a tool absent in read mode retains its existing admission
behavior, rather than gaining a new registration.

A refused new invocation is independent of the completed 429 run: do not
append a `denied` event to the old `op`, amend its outcome, or reuse its
intent. A new authorized invocation has its own intent and outcome. No
cross-run idempotency or exactly-once guarantee is introduced.

## Acceptance criteria

All names below are exact intended test names, not claims of existing tests.
Use fake time and controlled promises, never real sleeps. Except AC-08's
local transport double, no socket or external provider is involved.

- **AC-01** (BR-248 v2, BR-243, BR-247, BR-255) — Given a mutator queued to
  answer valid 429 then accepted 200, When each `Retry-After` case runs
  (absent, `"0"`, `"1"`, `"5"`, `"30"`, `"31"`, `"9999999999"`, `""`,
  `"-1"`, `"1.5"`, `" 5"`, `"12345678901"`, and
  `"Wed, 21 Oct 2026 07:28:00 GMT"`), Then it settles at fake elapsed 0
  after the outcome append with exactly the 429 result and `[I,L]`,
  `M=0`. After advancing 60,001 ms there is still exactly one mutator
  call, one policy dispatch and no new record. Run the same assertion for
  all nine admitted operation kinds, including injected share mutators;
  this does not introduce production share tools. Verified by
  `TestBR248_v2_AC01_retry_after_%j_never_schedules_another_attempt` and
  `TestBR248_v2_AC01_kind_%s_stops_on_the_first_429` in
  `tests/mutation-gate.test.ts`.
- **AC-02** (BR-248 v2, BR-032, BR-034, BR-246, BR-256) — Given an
  authorized rename of file 42 under root 10 and deny `/r/secret/**`,
  When the first attempt returns 429 with `Retry-After: 5` at T0 and at
  T0+1,000 ms another actor moves file 42 into `/r/secret`, Then the
  original invocation has already ended with `[I,L]` and makes no further
  request through T0+5,000 ms. When the client explicitly invokes the same
  rename at T0+5,000 ms, Then fresh ancestry/path reads return the moved
  target, the new gate result is exactly the policy-denial row, and the
  new log is `[D]` with a different `op`; aggregate mutator calls stay 1.
  Update the whole evidence chain consistently; this must exercise deny
  matching, not merely inconsistent evidence. Verified by
  `TestBR248_v2_AC02_target_moves_into_denied_directory_during_retry_after`
  in `tests/mutation-composition.test.ts`.
- **AC-03** (BR-248 v2, BR-032, BR-043, BR-243) — Given the AC-02 fixture
  with no move or configuration change, When time advances past 5,000 ms,
  Then the first run remains rate-limited and no automatic second attempt
  occurs. When the client explicitly invokes the same rename again and
  its mutator answers accepted 200 without a value, Then fresh inspection
  occurs, the second run has the exact success result and `[I,S]` under a
  new `op`, and there are exactly two total mutator calls. Verified by
  `TestBR248_v2_AC03_unchanged_target_requires_a_new_authorized_invocation`
  in `tests/mutation-composition.test.ts`.
- **AC-04** (BR-248 v2, BR-030, BR-035 v2, BR-039 v2, BR-041, BR-042 v2, BR-278) —
  Given a completed 429 run, When the relevant state changes before a
  second explicit invocation, Then no background attempt occurs and
  the new invocation applies the same refusal as a first invocation in
  that state. Exercise these named rows: `target_outside_root`,
  `destination_denied`, `destination_outside_root`,
  `replacement_parent_changed`, `restore_parent_denied`,
  `configured_root_target`, `share_mode_removed`, `domain_removed`,
  `public_links_disabled`, and `read_mode`. All rows except `read_mode`
  use the policy-denial result and `[D]`, with zero new mutator calls;
  `read_mode` uses the gate-admission result and `[]`. Use real configured
  policy and injected mutators, including sharing. For configuration
  changes construct a new gate/policy with the new configuration: do not
  imply in-process reload. For `share_mode_removed`, keep the injected
  share mutators registered in the new write-mode gate so admission does
  not return `UNAVAILABLE` (`src/mutation-gate.ts:327-328`); the refusal
  must come from BR-042 policy denial with `[D]`.
  For `configured_root_target`, configure the former target as a root
  before invoking rename again. For replacement,
  keep both paths allowed and change only the target's parent to isolate
  BR-035's binding check. Verified by
  `TestBR248_v2_AC04_new_invocation_after_%s_uses_current_authorization`
  in `tests/mutation-composition.test.ts`.
- **AC-05** (BR-250 v2, BR-248 v2) — Given a started attempt, When client
  cancellation/session close aborts the cancellation signal before a
  controlled valid 429 reply, Then its attempt signal is not aborted,
  the result is exactly `failed` / `RATE_LIMITED` with one attempt and
  the audit is `[I,L]`, never `CANCELLED`. Repeat with cancellation after
  the reply while the outcome append is held, then release the append:
  same result and records. Given an admitted run cancelled during policy
  dispatch before intent, Then retain exactly
  `{result:"failed", op:O, code:"CANCELLED", attempts:0}` and `[]`;
  after intent resolves but before the attempt,
  Then retain `failed` / `CANCELLED`, attempts 0, `[I,C]`, where `C` has
  exactly the base plus `event:"outcome", result:"failed", attempts:0,
  ms:0, code:"CANCELLED"`, no status. Verified by
  `TestBR250_v2_AC05_cancellation_%s_does_not_replace_a_429` and
  `TestBR250_v2_AC05_pre_attempt_cancellation_keeps_its_boundary` in
  `tests/mutation-gate.test.ts` (rows `during_attempt`, `during_outcome`).
- **AC-06** (BR-248 v2, BR-249 v2, BR-250 v2, BR-258 v2) — Given a first
  attempt answering 429 at 8,000 ms with `Retry-After: 5`, When it
  settles, Then the controller returns `{ok:true,value:<429 result>}`
  at 8,000 ms with `[I,L]`, `M=8000`, one attempt, and no navigation
  timeout or later write after advancing past 60,000 ms. Given a pending
  attempt at 29,999 ms, Then no outcome yet; at 30,000 ms it is aborted
  with exactly the timeout result and `[I,U]`, `M=30000`; a subsequently
  delivered 429 or accepted 200 changes nothing. Given a valid 429 at
  25,000 ms with `Retry-After: 10` and a queued second reply that never
  settles, Then the run ends at 25,000 ms with the exact 429 result,
  `[I,L]`, `M=25000` and attempts 1; after advancing through 60,001 ms
  no second attempt or record exists. Verified by
  `TestBR248_v2_AC06_429_at_8000_ms_finishes_without_a_navigation_retry`
  in `tests/mutation-composition.test.ts` and
  `TestBR249_v2_AC06_attempt_deadline_remains_uncertain_without_retry`
  and `TestBR249_v2_AC06_429_at_25000_ms_never_starts_a_second_attempt`
  in `tests/mutation-gate.test.ts`.
- **AC-07** (BR-248 v2, BR-247, BR-251, BR-252) — Given valid 503 or
  412, an unbranded throw, a branded `NotSent`, or malformed replies
  carrying status 429 (missing `accepted`, accessor `status`, or
  `retryAfter` longer than 32 bytes), When the run ends, Then there is
  exactly one attempt. Valid 503/412 have the contract-table outcomes;
  malformed replies and the unbranded throw have the no-status uncertain
  outcome and fixed message; branded `NotSent` has `failed`, `NOT_SENT`,
  attempts 1, no status/message. Each has exactly `[I,outcome]` and no
  retry; no accessor is invoked. Given a valid 429 and an outcome append
  rejection, Then the result is the exact 429 result plus
  `audit:"outcome_unrecorded"`, the persisted array is `[I]`, the
  attempted appends are exactly `[I,L]`, and the sink latches with exactly
  one diagnostic `Audit outcome could not be recorded; further writes
  are refused until restart.\n`. The next invocation returns
  `{result:"failed", code:"AUDIT_UNAVAILABLE", attempts:0}` with no new
  record or attempt. Verified by
  `TestBR248_v2_AC07_reply_%s_preserves_classification_without_retry` and
  `TestBR248_v2_AC07_failed_429_outcome_append_never_replays` in
  `tests/mutation-gate.test.ts`.
- **AC-08** (BR-248 v2, BR-268 v2, BR-255) — Given the production mutator
  and a local injected transport double answering 429, When `Retry-After`
  is `"2"`, 32 ASCII digits or 33 ASCII digits, Then the port still
  passes through the bounded raw value for the first two rows and omits
  it for the third; the complete gate result is always the 429 row with
  exactly one non-GET request and `[I,L]`. No retry header, body or path
  appears in result/audit. Verified by
  `TestBR268_v2_TestBR248_v2_AC08_bounded_retry_after_%s_never_replays`
  in `tests/kdrive-mutation-port.test.ts`. Given the production upload
  mutator for each of `upload-new` and `replace` and a transport double
  queued to answer 429 then 200, When the run completes, Then there is
  exactly one request with the original payload and the result is `failed`,
  code `RATE_LIMITED`, status 429, attempts 1; the queued 200 is unused.
  Verified by `TestBR248_v2_${kind}_429_then_200_stops_after_one_request`
  in `tests/kdrive-upload-mutator.test.ts`.
  Given the implementation docs and pending records, Then a scoped
  content/link check (not a new prose unit test) verifies all of:

  - `SECURITY.md:128` and `docs/development.md:385` (the baseline wording
    "Only HTTP 429 is retried") are replaced with the one-attempt rule and
    fresh authorization for every new invocation; uncertainty guidance stays.
  - `SECURITY.md` names the residual first-attempt window: intent append up
    to 5,000 ms, followed by transport queue, DNS and TLS within the
    30,000 ms attempt timer. It states that authorization is not atomic,
    and that "429 means not applied" is the unmeasured F-016 D-16-5
    assumption, with a link to `docs/kdrive-write-evidence.md` (baseline
    lines 69–70: none of the 85 measured responses was a 429).
  - `docs/mcp-client-compatibility.md` says a `RATE_LIMITED` mutation may
    be explicitly re-invoked after a pause, with fresh admission and full
    authorization. An uncertain result must not be re-invoked without first
    verifying the item state; it is never automatically replayed.
  - `BACKLOG.md` contains the exact residual-window follow-up line in Risks;
    BR-248, BR-249, BR-250 and BR-268 v2 remain pending acceptance with
    v1 active in their frontmatter, README table and spec index.

## Test plan

1. After independent review and freeze, characterize the implementation
   base before editing production code: run the existing mutation gate,
   mutation composition, policy, mutation-port and upload-mutator suites.
   Retain their first-attempt authorization, audit and classification assertions.
2. Write AC-01–AC-08 first. In AC-02/AC-03, drive the real guarded policy
   with mutable synthetic ancestry, a controlled 429 and fake time. The
   denied-directory row must fail on the old code's second upstream call;
   the unchanged row must fail on its automatic retry. Record these red
   results before implementation. Tests assert immediate settlement as
   well as eventual call counts, so a permanently suspended run cannot pass.
3. Update v1 retry expectations to the reviewed v2 contract, retaining
   their inputs and boundary coverage. Specifically replace the BR-248
   wait/three-attempt tests, BR-249's retry-wait/second-attempt scenarios,
   BR-250's wait-cancellation test,
   `TestBR258_TestBR070_a_429_at_8000_ms_retried_after_5_s_succeeds`, and
   `TestBR268_a_429_with_Retry_After_%s_is_retried_after_%i_ms` with the
   named v2 AC tests. Also replace
   `TestBR248_${kind}_429_then_200_resends_identical_bytes` in
   `tests/kdrive-upload-mutator.test.ts:249` for both `upload-new` and
   `replace` with
   `TestBR248_v2_${kind}_429_then_200_stops_after_one_request` (AC-08):
   one request with the original payload, `failed` / `RATE_LIMITED`,
   status 429, attempts 1, and no consumed second response. Keep the
   existing 30,000 ms timeout, BR-247/251
   uncertainty, BR-243/244 audit, BR-246 denial and BR-278 root tests.
   This changes assertions for a versioned contract, not a gate exemption.
4. Implement only this contract; run the same suites and `make check`
   through the project's Docker/Make toolchain. Confirm all admitted kinds
   use this gate and no wrapper/port resubmits the mutation. Review the
   PR and CI using the required fresh strong-tier reviewer and subsequent
   strongest-tier security decision pass. No real write acceptance is
   needed for this local retry-control change; all races use test doubles.
5. After merge, verify every AC on the actual main SHA and record commands,
   results and available token counters in #47 for lot A. This alone does
   not close #47's other lots. Keep records pending until that acceptance;
   synchronize final markers in the next scoped reviewed PR before release.

This spec-revision step uses the owner's author approval and sandbox
override: no Docker, network, commits, implementation or product tests are
run. The supplied reviews and their dispositions are recorded below; no
new review, passing product test, freeze or CI result is claimed here.

## Decisions

- **D-1 — Return `RATE_LIMITED`; do not retry inside the gate.** Selected
  from the two alternatives authorized in the brief. Re-running complete
  policy after every wait could retain transparent retry, but would need
  a new guarded execution context after the intent, fresh bounded evidence
  under the same deadline, late-executor suppression, cancellation rules,
  and a defined audit outcome for a refusal after a prior attempt. It
  must also re-run any preflight outside the policy facade. Simply calling
  `dispatch()` again is insufficient: the current single-use `execute()`
  rejects a run whose execution already exists. Returning the existing
  code removes that entire stale-grant path and is the smaller security
  repair. Cost: transient 429s previously hidden by successful retries
  become visible; a client must choose whether and when to invoke again.
- **D-2 — Preserve audit truth and uncertainty.** A valid 429 is still a
  refusal under the unmeasured F-016 D-16-5 assumption, producing one intent
  and one failed outcome. It is not a policy denial and has no `denied` event. Keep the
  existing assumption that 429 means no mutation effect; this is not a new
  provider measurement. No idempotency is inferred for other outcomes.
  Unknown effects still require state verification before any new attempt.
  Do not turn malformed responses, transport failures or timeouts into
  `RATE_LIMITED`, and never replay after an audit failure.
- **D-3 — Keep boundaries and public schemas.** Version BR-248, BR-249,
  BR-250 and BR-268 to v2, preserving their v1 text, examples, evidence and
  active status until acceptance. Frontmatter stays `status: active`; the
  v2 blocks, README table and spec index mark v2 pending acceptance.
  BR-249 v2 states the single-attempt deadline interpretation (D-5) and
  replaces its second-attempt example. BR-268 v2 retains bounded header
  parsing and replaces its gate-level wait example with terminal 429 cases.
  Do not add a delay field, event, API switch or alternative retry mode.
  No ADR is needed for this localized, reversible behavior change.
- **D-4 — Re-enter the complete existing path on client resubmission.**
  Keep root scope, denies, protected roots, mode, allowlists, restore and
  replacement bindings in their current owners. No saved grant/payload
  job survives to execute later. Configuration changes take effect through
  the existing construction/startup boundary. Adding hot reload or atomic
  ETag/version preconditions would be separate contracts, not implied by
  this fix. Preserve valid upstream 412 as `UPSTREAM_REJECTED`.
- **D-5 — Keep BR-249's 60,000 ms run deadline clause.** It continues to
  start with the first attempt and is never reset or extended. With one
  attempt capped at 30,000 ms, the 60,000 ms ceiling is redundant; it is
  neither a retry allowance nor a minimum run duration. BR-249 v2 makes
  that consequence explicit and replaces the now-unreachable second-attempt
  example. Removing the ceiling or changing its origin is rejected as an
  unnecessary deadline-contract change. Intent and outcome appends retain
  their separate existing bounds; the run deadline is not an end-to-end
  invocation deadline.

## Risks

- Clients see more `RATE_LIMITED` results and might resubmit too quickly.
  This feature adds no client scheduler, backoff hint or cross-invocation
  limit; each new invocation still passes ordinary admission and policy.
- The first-attempt check-then-act window remains: intent append may take
  up to 5,000 ms, followed by transport queueing, DNS and TLS bounded by
  the 30,000 ms attempt timer. The intent bound is separate from that timer;
  these stages can therefore consume up to 35,000 ms after the policy
  check, not a single 30,000 ms total bound. This lot prevents reuse after
  429 and does not claim atomic provider-side authorization. `SECURITY.md`
  must document these bounds and this residual risk. Existing F-017 risks
  remain. Add this exact line to `BACKLOG.md` at implementation (in scope):

  > - 2026-11-15 — F-037 (#47 lot A) leaves the first-attempt authorization window: intent append up to 5,000 ms plus transport queue, DNS and TLS within the 30,000 ms attempt timer — src/mutation-gate.ts; SECURITY.md — A target or ancestor may move after policy validation and before the first write; track a separate authorization/precondition design, since stopping 429 retries does not make authorization atomic.

- "429 means not applied" remains the unmeasured F-016 D-16-5 assumption,
  not an observed provider guarantee: `docs/kdrive-write-evidence.md:69-70`
  reports no 429 among 85 responses. If the provider applies a write before
  returning 429, a later explicit invocation could duplicate its effect.
  `SECURITY.md` must repeat this assumption and link the measurement limit;
  this feature supplies no new provider evidence or idempotency guarantee.
- Tests that use a fake dispatch cannot establish fresh root/deny checks.
  AC-02–AC-04 use the actual policy; fixture moves update complete evidence.
  Read-mode gate admission and policy denial have different audit shapes.
- Cancellation during a 429 attempt now retains `RATE_LIMITED` where v1
  could return `CANCELLED` before its wait. BR-250 v2 and AC-05 explicitly
  capture that intentional compatibility change.
- Retry assumptions also occur in port/composition tests and operational
  docs. The implementation must migrate those expectations together and
  leave read retries untouched. No result/log can imply a new ETag guard.

## Open questions

None. D-1 keeps the explicitly permitted no-retry alternative. The supplied
review and decision pass are recorded below; this revision is ready for
freeze, not frozen. Any required confirmation of the corrected revision
remains with the orchestrator before freeze.

## Stress-test

The owner supplied these reviews for this revision; the entries below record
their verdicts and the disposition of every finding, not a new review or an
approval of the revised head. Reviewer model/effort and token counters were
not supplied (unknown); no usage is inferred.

### 47a-spec-review-1-reviewer — verdict: changes

1. **Major — active v1 frontmatter. Retained, fixed in this revision.**
   BR-248 and BR-250 frontmatter is `status: active`; only v2 is pending
   in the version block, README table and spec index.
2. **Major — stale BR-249/BR-268 examples. Retained, fixed in this revision.**
   Added pending v2 blocks, replacement examples and named tests while
   preserving active v1 verbatim. Both versions are listed in Scope,
   Business rules, README and spec index. D-5 explicitly keeps the
   60,000 ms deadline as a redundant ceiling under the 30,000 ms sole
   attempt cap; AC-06 covers timeout and the former second-attempt case.
3. **Minor — `share_mode_removed` fixture. Retained, fixed in this revision.**
   AC-04 keeps injected share mutators registered so BR-042 policy denial
   produces `[D]`, rather than admission returning `UNAVAILABLE`.
4. **Minor — precise doc checks. Retained, fixed in this revision.**
   AC-08 names `SECURITY.md:128` and `docs/development.md:385` and their
   baseline "Only HTTP 429 is retried" wording for replacement.

### 47a-spec-decision-1-fable — verdict: approve, with minors

5. **Minor — upload migration. Retained, fixed in this revision.**
   The migration list names `TestBR248_${kind}_429_then_200_resends_identical_bytes`
   and its v2 successor for `upload-new` and `replace`; AC-08 requires one
   request, `RATE_LIMITED`, status 429 and attempts 1.
6. **Minor — residual first-attempt window. Retained, fixed in this revision.**
   Risks quantifies the separate 5,000 ms intent append and transport queue,
   DNS and TLS within the 30,000 ms attempt timer. Scope and AC-08 require
   the SECURITY documentation and the exact BACKLOG line given in Risks
   at implementation; closing the window remains out of scope.
7. **Minor — unmeasured 429 assumption. Retained, fixed in this revision.**
   Risks repeats D-16-5 and the no-429 measurement limit at
   `docs/kdrive-write-evidence.md:69-70`; AC-08 requires the same warning
   and evidence link in `SECURITY.md`. D-2 no longer calls it proven.
8. **Minor — client compatibility guidance. Retained, fixed in this revision.**
   Scope and AC-08 include `docs/mcp-client-compatibility.md`: explicit
   re-invocation after a pause is allowed for `RATE_LIMITED`, with fresh
   authorization; uncertain writes require state verification first and
   are never automatically replayed.

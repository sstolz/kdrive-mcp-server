---
id: F-039
title: Bound audit append waits and shutdown drain
ticket: "#47"
status: draft
version: 1
---

# F-039 — Bound audit append waits and shutdown drain

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `fix/47-c-audit-sink`, supplied main and cached `origin/main`
`c39a77a3f4e996541732d8a6c036f63e4df40a4c`.
IDs: F-039; BR-070 v5 and BR-240, BR-241, BR-254, BR-259 v2;
AC-01–AC-11. No new BR ID or ADR. The base index gives next free IDs
F-039, BR-423, ADR-013. Local `main` is stale at `7fdc7b3`; allocation uses
the supplied base, not that ref. Recheck current main before freeze and PR.

## Context

Ticket #47 lot C addresses finding 4 of the supplied cross-vendor review.
In `src/audit/sink.ts`, the stderr append promise settles only through the
write callback. A stream `error` event latches the sink but does not reject
that pending promise. A full pipe or stalled collector can therefore hold
the mutation and the serialized append tail indefinitely. Gate shutdown
awaits those runs, and sink closure awaits the tail and file release.

F-016 accepted the unbounded stderr wait in D-16-7. This repair changes that
contract. Operators need a bounded shutdown and a failure that refuses
further writes; clients need an accurate account of whether a mutation was
attempted. An intent failure prevents dispatch (BR-244). An outcome failure
after dispatch preserves the actual classification and adds
`audit:"outcome_unrecorded"` (BR-252); reporting a performed write as
`AUDIT_UNAVAILABLE` would invite duplication. Fail-closed does not mean
rewriting a known successful upstream result as a failed operation.

## Scope

- Bound both sink implementations' append promises, including queue wait,
  and reject outstanding appends on stream errors without awaiting callbacks.
- Latch failures until restart, suppress late completion effects and preserve
  serialization, record bytes, durability checks and mutation classifications.
- Bound audit sink closure and the audit contribution to gate shutdown;
  preserve transport → gate → exit ordering.
- Prepare pending BR versions and index/capability/changelog records.
- In the later implementation PR, synchronize the audit guidance in
  `README.md` and `docs/deployment.md` with these bounds and limitations.

### Out of scope

- Other #47 lots, mutation retries, authorization policy, new configuration,
  audit schema changes, new event types, rotation, reconciliation or replay.
- Stronger stderr durability, cancelling bytes already handed to the OS,
  a worker/process isolation redesign, or a hard real-time guarantee during
  synchronous event-loop blockage or process suspension.
- Source/test edits, test execution, Docker, network, commits, review,
  freeze, PR publication, implementation, acceptance and release in this
  assignment. The owner explicitly authorizes Codex to author this draft;
  the later independent reviews remain required.

## Business rules

- **BR-240 v2** — Successful append acknowledgement requires the unchanged
  full single write and file `fdatasync` or error-free stderr callback,
  completed before the BR-259 deadline while the sink is healthy. A late
  callback never acknowledges a rejected append. Verified by: AC-01, AC-06.
- **BR-241 v2** — Write/short-write/sync/stream errors and append timeouts
  latch the sink for its lifetime, reject its pending and queued appends
  with `AuditUnavailable` (`AUDIT_UNAVAILABLE`), and refuse later appends
  without I/O; a stream error does not wait for a write callback. Oversize
  validation alone still does not latch. Verified by: AC-01–AC-06, AC-10.
- **BR-259 v2** — Every file or stderr append has one 5,000 ms monotonic
  budget from the `append` call, including queue time, write and sync or
  callback; unresolved work at or after that deadline rejects and latches.
  Intent rejection gives BR-244; outcome rejection gives BR-252. The gate
  also refuses dispatch when intent acknowledgement is observed at or after
  5,000 ms from its append call. Verified by: AC-01–AC-05, AC-07, AC-10.
- **BR-254 v2** — Gate close refuses new runs, lets in-flight runs reach
  their bounded result/outcome failure, then closes the sink. Sink close
  settles within 5,000 ms from its first call, including tail drain and file
  release; on expiry it latches, rejects outstanding appends and resolves
  closed without claiming a flush. Gate close in the production composition
  is bounded by 45,000 ms from its call under the existing guarded policy
  and sole-attempt contracts. Transport → gate → exit and HTTP 503 semantics
  remain unchanged. Verified by: AC-07–AC-09.
- **BR-070 v5** — v4 holds with the stderr shutdown exception replaced by
  BR-259 v2's append bounds and BR-254 v2's gate/sink closure bounds. The
  1,000 ms stdio exit bound without a run past intent remains; the navigation
  deadline never substitutes for a committed mutation's result.
  Verified by: AC-08, AC-09, AC-11.

Unchanged dependencies: BR-234–BR-239 (record schema, sanitization, 8,192-byte
cap, identity, fd 2 routing, startup and file permissions), BR-242
(single-write serialization), BR-243–BR-246 (intent ordering, failures,
admission and denials), BR-247, BR-248 v2, BR-249 v2, BR-250 v2 and
BR-251–BR-253 (classification, sole attempt, cancellation and late audit
failure), BR-255, BR-258 v2 (result schema and commit boundary), BR-169 v3
(HTTP close), BR-210 (signal exit), and BR-380–BR-388 (invocation queues).
Their definitions and F-016's accepted text remain unchanged.

## Contract details

### One append deadline and permanent failure

Use the existing `AUDIT_APPEND_TIMEOUT_MS = 5000` as the single append
constant for both sinks and the gate's stale-intent guard. Start the budget
when `append` is called, before enqueueing, and never restart it when the
write starts or a callback fires. At elapsed time 4,999 ms an unresolved
append is still pending; at 5,000 ms it fails. Check monotonic time on
completion as well as using a timer: a callback processed at the deadline
cannot win by timer registration order. No per-append timer remains after
settlement. Test injection can control clocks/timers; operators get no new
environment variable or configurable timeout.

Successful writes remain in call order, with one complete JSONL record per
write call; stderr `write()` returning `false` is backpressure, not failure
or success. The error-free callback before the deadline remains its success
condition; no new `drain` requirement is added. File success still requires
all bytes and `fdatasync` within the same budget.

An error event, synchronous write throw, callback error, short file write,
sync rejection or timeout settles all outstanding append promises as
`AuditUnavailable` with fixed message `AUDIT_UNAVAILABLE`, without retaining
or publishing an underlying error, stack, path or stream payload. Queued
records never start after latching. Future appends reject in the next
promise settlement turn without waiting for the old tail or starting I/O.
Recovery requires a process restart; late success never clears the latch.
Even an idle stream error latches the sink. Already acknowledged appends
remain acknowledged. Invalid oversize records keep BR-236's non-latching
rejection when the sink is otherwise healthy.

Observe late callbacks, rejections and repeated `error` events safely:
settle once, start no later record, and produce no unhandled rejection or
unhandled stream error. Keep only the bounded listener/state needed to
handle a late error; do not accumulate a listener per append or remove the
last error handler while a timed-out write can still emit an error. Never
destroy, end or close shared process stderr. An already-issued OS write
may still finish later; no promise timeout can retract it. Do not retry a
record, append a repair record or infer that timed-out bytes were absent.

### Exact caller and event behavior

No `AUDIT_TIMEOUT` code or new JSON event is introduced. The existing audit
events remain exactly `intent`, `outcome`, `denied`.

- Failed/timed-out intent: `failed`, `AUDIT_UNAVAILABLE`, `attempts:0`, the
  admitted `op`, no upstream call and no outcome append. The one attempted
  `intent` line might eventually reach the collector; it is not an
  acknowledged record. A later invocation is an admission refusal with
  `failed`, `AUDIT_UNAVAILABLE`, `attempts:0`, no `op`, no policy call and
  no record.
- Failed/timed-out outcome: preserve result, code, status, value, attempts
  and fixed uncertain message, and add `audit:"outcome_unrecorded"` per
  BR-252. Never return an unqualified success, retry or compensate. Offer
  exactly the existing diagnostic once per gate to stderr:
  `Audit outcome could not be recorded; further writes are refused until restart.\n`.
  This is a best-effort diagnostic, not an audit record. Its callback or
  drain is never awaited, and a diagnostic write failure cannot replace the
  gate result or retain shutdown. Delivery through blocked stderr cannot
  be guaranteed.
- Failed/timed-out `denied` append: keep `denied`, `ACCESS_DENIED`,
  `attempts:0`, the admitted `op` and zero upstream calls (BR-246); latch
  the sink. Do not manufacture an `outcome` or a new diagnostic.
- If cancellation occurs after intent starts, an intent rejection still
  takes precedence under BR-244. If intent succeeds before the deadline
  and cancellation prevents dispatch, keep `failed`/`CANCELLED`, attempts
  zero; a failing outcome append adds the existing unrecorded marker and
  diagnostic. Cancellation during an attempt never changes its known
  classification. Closed sessions publish no later wire result.

### Shutdown

Sink `close()` stops admission immediately, refuses queued records not yet
written, and waits only for an active append and owned file release within
one `AUDIT_CLOSE_TIMEOUT_MS = 5000` budget from the first close call. It
attempts owned file close once after the active append settles or fails;
that release gets only the remaining close budget, not another 5,000 ms.
Expiry latches the sink and resolves close; it does not report durable
delivery. Concurrent/repeated closes share completion, do not reset the
deadline and do not close a descriptor twice. Errors from release are
contained and latch the sink; late release settlement cannot reopen it.
No new audit event or diagnostic is emitted by sink close. The existing
gate outcome-failure diagnostic remains the only such diagnostic.

The gate drains runs before calling sink close; do not race an entire
mutation against a 5,000 ms shutdown timer. With lot A accepted, a committed
run has at most 5,000 ms intent + 30,000 ms sole attempt + 5,000 ms outcome
= 40,000 ms remaining. Concurrent runs share the sink, but each append's
queue time is included in its budget, so their waits do not add serial
5,000 ms allowances to this ceiling. A pre-intent run remains subject to
the 10,000 ms navigation guard and may not cross intent after gate close.
Thus `max(10000, 40000) + 5000 = 45000` bounds gate close. This is a derived
ceiling, not a new upstream timeout or permission to wait after completion.
It assumes the existing guarded production dispatch, not an arbitrary
unbounded injected policy function.

HTTP transport close still runs first under BR-169; its existing response
flush allowance is 1,000 ms. Audit work therefore fits inside the existing
75 s deployment grace without changing that setting. This does not make a
new promise about unrelated OAuth store or OS shutdown stalls. Preserve the
existing normal signal exit code (HTTP 0; stdio's existing exit status).
The dedicated process must reach its exit path without awaiting stderr
delivery or a timed-out file release. Library compositions resolve closure
without terminating their host process.

For stdio shutdown with no run past intent, the existing 1,000 ms exit
budget takes precedence: pass its remaining budget to sink closure rather
than allowing a stalled idle file release to consume 5,000 ms. This is an
internal shorter close allowance, not operator configuration; repeat calls
cannot extend the earliest deadline. The ordinary committed-run close
budget remains 5,000 ms.

## Acceptance criteria

Names below are exact planned test names, not execution claims. Use fake
monotonic time, controlled callbacks and synthetic ports; flush microtasks
after each clock advance. Gate fixtures use `OP =
"000102030405060708090a0b0c0d0e0f"`, `kdrive_rename`, target `{driveId:101,id:42}`,
stdio identity and validated value `{id:42}` from the existing gate harness.
Count attempted record writes separately from acknowledged records and
diagnostic writes. All returned objects below are exact (no extra members).

- **AC-01** (BR-240 v2, BR-241 v2, BR-259 v2, BR-244) — Given stderr
  accepts the intent write but never calls back, When 4,999 then 5,000 ms
  elapse from append, Then the run is respectively pending then exactly
  `{result:"failed",op:OP,code:"AUDIT_UNAVAILABLE",attempts:0}`; one intent
  write was attempted, zero records acknowledged, zero outcome writes and
  zero upstream calls. Sink is latched; the next run returns exactly
  `{result:"failed",code:"AUDIT_UNAVAILABLE",attempts:0}` with no added
  policy/record/upstream call. Verified by
  `TestBR259_v2_AC01_blocked_stderr_intent_fails_closed_at_5000_ms`
  in `tests/mutation-gate.test.ts`.
- **AC-02** (BR-241 v2, BR-259 v2) — Given a pending stderr append and two
  queued appends, When `error` fires at 100 ms without a callback, Then all
  three reject immediately with `AuditUnavailable`/`AUDIT_UNAVAILABLE`,
  only one write has started, and subsequent append rejects without I/O.
  An idle error before the first append likewise permits zero writes.
  Later success/error callbacks and repeated error events change nothing
  and throw nothing. Verified by
  `TestBR241_v2_AC02_stream_error_rejects_active_queued_and_future_appends`
  in `tests/audit-sink.test.ts`; gate integration
  `TestBR241_v2_AC02_stream_error_without_callback_refuses_dispatch`
  in `tests/mutation-gate.test.ts` asserts AC-01's exact failed result at
  100 ms, not at the timeout. Synthetic error text is absent from results.
- **AC-03** (BR-259 v2, BR-241 v2, BR-242) — Given append A at 0 ms and B
  at 1,000 ms, When A acknowledges at 4,000 ms and B then stalls, Then B
  remains pending at 5,999 ms and rejects/latches at 6,000 ms, not 9,000 ms;
  exactly two writes start in order, with no overlap. Given three appends
  at 0 ms whose first stalls, Then all reject at 5,000 ms with one write
  start. Run both cases for stderr and file sinks, stalling file sync too.
  Verified by `TestBR259_v2_AC03_queue_time_is_inside_each_append_budget`
  in `tests/audit-sink.test.ts`.
- **AC-04** (BR-259 v2, BR-241 v2, BR-252) — Given acknowledged intent and
  an immediate sole response of 200, 409, 429 or 503, When the outcome
  callback never arrives, Then at 5,000 ms after its append the exact
  results are respectively:
  `{result:"succeeded",op:OP,attempts:1,status:200,value:{id:42},audit:"outcome_unrecorded"}`;
  `{result:"failed",op:OP,code:"UPSTREAM_REJECTED",attempts:1,status:409,audit:"outcome_unrecorded"}`;
  `{result:"failed",op:OP,code:"RATE_LIMITED",attempts:1,status:429,audit:"outcome_unrecorded"}`;
  `{result:"uncertain",op:OP,code:"UPSTREAM_UNCERTAIN",attempts:1,status:503,audit:"outcome_unrecorded",message:"The upstream result is unknown; verify the item's state before any new attempt."}`.
  Each row has one upstream attempt, one acknowledged intent, one attempted
  outcome, a latched sink and the exact diagnostic above once; subsequent
  runs give AC-01's admission refusal without another diagnostic. Repeat
  with an outcome stream error at 100 ms and assert the same immediate
  result. A held or throwing diagnostic writer cannot retain settlement.
  Verified by `TestBR259_v2_AC04_outcome_failure_preserves_each_classification`
  in `tests/mutation-gate.test.ts`.
- **AC-05** (BR-259 v2, BR-241 v2, BR-246, BR-250 v2) — Given policy
  denial and a blocked denied-record callback, When 5,000 ms elapse, Then
  exactly `{result:"denied",op:OP,code:"ACCESS_DENIED",attempts:0}` returns,
  the sink latches, and there is one attempted `denied` record, no intent,
  outcome, diagnostic or upstream call. Given client cancellation during
  a stalled intent, Then AC-01's audit failure wins at 5,000 ms. Given a
  timely intent and pre-attempt cancellation followed by a stalled outcome,
  Then return exactly `{result:"failed",op:OP,code:"CANCELLED",attempts:0,audit:"outcome_unrecorded"}`
  with one intent acknowledged, one outcome attempted and the diagnostic
  once. Verified by `TestBR259_v2_AC05_denied_and_cancelled_runs_settle`
  in `tests/mutation-gate.test.ts`.
- **AC-06** (BR-240 v2, BR-241 v2, BR-259 v2) — Given success completion
  at 4,999, 5,000 or 6,000 ms from append, When processed before or after
  the due timeout callback, Then only 4,999 succeeds; the other rows
  reject/latch, with no later write or unhandled error. Cover stderr
  callback and file write-plus-sync, callback error, synchronous write
  throw and late file rejection. `write(false)` plus a timely success
  callback succeeds; no callback does not. Verified by
  `TestBR240_v2_AC06_success_requires_completion_before_deadline` in
  `tests/audit-sink.test.ts`. Gate counterpart
  `TestBR259_v2_AC06_late_intent_never_dispatches` in
  `tests/mutation-gate.test.ts` asserts AC-01's result, no outcome write
  and zero attempts at 5,000 and 6,000 ms with the real stderr sink.
  Separately inject an acknowledged intent whose gate continuation observes
  elapsed time 5,000 ms: assert zero attempts and exactly
  `{result:"failed",op:OP,code:"AUDIT_UNAVAILABLE",attempts:0}` with one
  acknowledged intent and one acknowledged failed outcome (code
  `AUDIT_UNAVAILABLE`, attempts 0, ms 0), using
  `TestBR259_v2_AC06_gate_rejects_stale_acknowledgement` in that file.
  Healthy repeated appends retain a stable error-listener count and zero
  pending append timers; failures retain at most one sink error listener.
- **AC-07** (BR-254 v2, BR-259 v2) — Given an active stderr append with no
  callback and a queued record, When sink close starts immediately, Then
  the queued record rejects without I/O, the active append fails by
  5,000 ms and close resolves by 5,000 ms; later appends reject and shared
  stderr is never ended/destroyed. For a file append that succeeds at
  4,000 ms but whose file close never settles, close is pending at 4,999 ms
  and resolves/latches at 5,000 ms; file close was called once. Also cover
  immediate release rejection and idle healthy close (immediate, no latch).
  Concurrent/repeated closes never return early or extend the bound;
  late callbacks/rejections cause no extra release or event. Verified by
  `TestBR254_v2_AC07_sink_close_bounds_drain_and_release`
  in `tests/audit-sink.test.ts`.
- **AC-08** (BR-254 v2, BR-070 v5) — Given a real bounded sink and gate,
  When gate close starts during a stalled intent, Then AC-01's result and
  close settle by 5,000 ms with no dispatch. Given intent success at
  4,999 ms, an already-started attempt that never settles, a blocked
  outcome and a file release that never settles, When close starts just
  after dispatch, Then the attempt aborts at 30,000 ms from its start,
  its result is exactly
  `{result:"uncertain",op:OP,code:"UPSTREAM_UNCERTAIN",attempts:1,audit:"outcome_unrecorded",message:"The upstream result is unknown; verify the item's state before any new attempt."}`
  after the 5,000 ms outcome bound, and close completes after at most
  5,000 ms more. Every case fits 45,000 ms from gate close; no new
  invocation is admitted, and a late 200 changes nothing. Also close
  during a pre-intent guarded policy wait that completes at 100 ms, before
  its existing 10,000 ms guard: the run returns exactly
  `{result:"failed",op:OP,code:"CANCELLED",attempts:0}` with no record or
  upstream attempt after close.
  Verified by `TestBR254_v2_AC08_gate_close_preserves_attempt_and_bounds_audit_waits`
  in `tests/mutation-composition.test.ts` and
  `TestBR070_v5_AC08_shutdown_keeps_committed_result_semantics` in that file.
- **AC-09** (BR-254 v2, BR-070 v5, BR-169, BR-210) — Given the production
  stdio/HTTP compositions with injected upstream, clocks, streams and exit,
  When EOF (stdio), SIGINT or SIGTERM arrives during an outcome stall,
  Then observable order is transport close, outcome failure, sink close,
  gate close, process exit; HTTP receives its existing 503 and exits 0;
  stdio with no prior error retains exit 0 and publishes no closed-session
  result. Neither awaits the diagnostic callback or stderr drain. Without
  a run past intent, stdio still closes within 1,000 ms, including a file
  sink whose idle release never settles. Verified by
  `TestBR254_v2_AC09_stdio_and_HTTP_shutdown_do_not_wait_for_stderr`
  and `TestBR070_v5_AC09_idle_stdio_exit_bound_is_unchanged` in
  `tests/mutation-composition.test.ts`. Repeat using a rejecting release;
  exit still follows gate completion, never an unhandled rejection.
- **AC-10** (BR-240 v2, BR-241 v2, BR-259 v2, BR-234–BR-239, BR-242) —
  Given healthy sinks, When a successful rename completes, Then its exact
  gate result is AC-04's 200 result without `audit`; records are exactly
  one `intent`, then one `outcome` with `result:"succeeded",attempts:1,status:200`,
  the same OP, existing schema/member order/escaping, and no diagnostic.
  A file append resolves only after one complete write and `fdatasync`;
  stderr only after callback. Preserve 8,192-byte success / 8,193-byte
  non-latching rejection, full single writes, short-write latching, startup
  permissions, fd 2 routing and read-mode no-sink behavior. Verified by
  `TestBR240_v2_AC10_normal_audit_path_is_unchanged` in
  `tests/mutation-gate.test.ts` and
  `TestBR241_v2_AC10_validation_and_file_failure_controls` in
  `tests/audit-sink.test.ts`, plus existing BR-234–BR-242 tests.
- **AC-11** (BR-070 v5, BR-254 v2, BR-259 v2) — Given the real navigation
  controller with a queued read behind a mutation whose intent stalls,
  When 5,000 ms elapse, Then mutate returns AC-01's failed gate value,
  releases its slot and the read runs; no navigation timeout replaces the
  audit result. Verified by
  `TestBR070_v5_AC11_audit_timeout_releases_navigation_slot`
  in `tests/mutation-composition.test.ts`. At implementation review, check
  `README.md` and `docs/deployment.md` state the 5,000 ms append/close
  bounds, permanent latch, best-effort diagnostics, late-byte possibility
  and unchanged 75 s grace; no claim of unlimited stderr wait remains.

## Test plan

1. After independent review and freeze, write characterization tests before
   source edits: healthy intent/outcome bytes and result, file sync barrier,
   error classifications, pre-/post-intent cancellation, shutdown ordering,
   and read mode. Run the existing audit-sink, mutation-gate and
   mutation-composition suites on the implementation base and record results.
2. Write AC-01–AC-11 first. Observe failing assertions for blocked stderr,
   error-without-callback, queue deadlines, exact deadline boundaries and
   bounded release on the old implementation; use fake time and captured
   callbacks rather than hanging tests or real pipe saturation. Preserve
   existing healthy-path controls. Replace the obsolete
   `TestBR259_a_stderr_intent_resolving_after_5000_ms_makes_zero_attempts`
   expectation of a later outcome and
   `TestBR259_a_stderr_intent_resolving_at_5000_ms_proceeds` success
   expectation with AC-06's versioned refusal assertions.
3. Implement only the frozen contract. Recheck every `AuditSink` caller,
   `close`, `latch`, diagnostic writer and shutdown path, including
   pending appends from multiple HTTP sessions. Keep outcome failure
   visible without replay, leaked data or unhandled errors. Run the affected
   tests and Docker/Make `make check` when that phase is authorized.
4. Obtain fresh strong-tier spec review, then the strongest-tier decision
   pass before freeze (audit failure is security-sensitive); repeat the
   required independent code reviews before merge. Run PR CI and every AC
   on the actual main SHA after merge. Synthetic composition tests rehearse
   shutdown end to end; no live mutation or owner environment is required.
   Evidence and exposed usage counters belong in #47/its PR, scoped to lot C;
   this lot alone does not authorize closing other lots or releasing.

Only documentation is authored now. No tests, Docker gate, CI, independent
review, acceptance or remote ticket-state update is claimed. No per-agent
usage counters are exposed for this draft; record available usage and its
limits in the ticket at freeze and closure rather than inventing totals.

## Decisions

- **D-1 — Reuse 5,000 ms; include the queue.** This is the accepted file
  append and stale-intent allowance, below the 10,000 ms navigation budget.
  Extend it to stderr and move its start to append invocation for both
  sinks. A write-start-only timer leaves callers behind other sessions
  waiting for multiples of the budget. Raising the value or adding a knob
  is unnecessary. A heavily backpressured healthy collector can now fail
  closed; timely logging is required to keep mutations available.
- **D-2 — Poison until restart and retain exact classifications.** Reuse
  `AuditUnavailable`, `AUDIT_UNAVAILABLE` and BR-252's fixed diagnostic.
  Reject all pending/queued work on failure; never reopen on a later callback.
  Reject silent success, automatic replay, synthetic timeout audit events
  through the broken sink, and pretending a known performed write failed.
- **D-3 — Bound close without truncating upstream classification.** Give
  sink drain plus file release one 5,000 ms budget, with idempotent resolved
  closure on failure. The derived gate ceiling is 45,000 ms with lot A's
  sole 30,000 ms attempt; retain its 60,000 ms outer deadline without using
  it to justify another wait. Reject a blanket 5 s gate timeout that could
  discard a dispatched write's result. Keep 75 s deployment grace and
  existing exit codes; do not wait for delivery of a failure diagnostic.
- **D-4 — Exact deadline refuses.** Success requires elapsed time strictly
  below 5,000 ms. The previous stderr callback-at-5,000 success case is an
  intentional compatibility change; timestamp checks remove timer-order
  ambiguity. An acknowledged intent observed too late by the gate must
  not dispatch; retain its zero-attempt `failed`/`AUDIT_UNAVAILABLE` outcome
  path, now using `>= 5000`. It is distinct from a sink rejection, which
  attempts no outcome. Any failure of that zero-attempt outcome keeps its
  failed classification and adds the existing unrecorded marker.
- **D-5 — Version only changed rules.** Follow F-038's pending-version
  convention: increment version/source metadata, retain `status: active`
  for the accepted definition, preserve that text/evidence and append
  explicitly pending definitions/examples/verification/history. BR-070 v4
  inherits the unlimited stderr exception and therefore needs v5; BR-240,
  BR-241, BR-254 and BR-259 need v2. BR-242 ordering and BR-244/BR-252
  classification already specify the required behavior and need no version.
  No new BR or costly architectural choice warrants an ADR.

## Risks

- A timed-out OS write or file release may finish later. A late intent can
  exist without an attempt, and a reported unrecorded outcome can eventually
  appear. Do not promise absence, durable completion, retry safety or repaired
  partial lines. Keep F-016's local-filesystem and stderr durability limits.
- A timeout cannot preempt a synchronous blocking stream implementation or
  a suspended event loop. Bounds mean settlement at the first runnable
  deadline turn, with monotonic checks preventing late dispatch/acknowledgement;
  this repair bounds asynchronous waits, not OS scheduling.
- Queued append deadlines deliberately reduce availability during collector
  congestion; each append must remain independently bounded even across
  sessions. Latching prevents subsequent audit writes behind uncertain bytes.
- Removing an error listener too early can turn a handled stream failure
  into a process crash; retaining one per append leaks listeners. Test both
  late-error safety and stable listener/timer counts across healthy appends.
- Existing implementation docs still describe unlimited stderr waits. Their
  later update is part of implementation acceptance, while frozen F-016
  remains historical. No current implementation guarantee follows from this
  draft or its pending records.

## Open questions

None. The ticket authorizes the timer, failure and shutdown decisions above.

## Stress-test

Not reviewed.

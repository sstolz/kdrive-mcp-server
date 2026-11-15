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
AC-01–AC-15. No new BR ID or ADR. The base index gives next free IDs
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
- Remove the callback-dependent stdout/stderr flush wait in the production
  exit helper (`src/production.ts`); test that real helper through injected
  process ports, rather than substituting the whole exit dependency.
- Offer the existing fixed diagnostic once on any sink failure latch.
- Prepare pending BR versions and index/capability/changelog records.
- In the later implementation PR, synchronize the audit guidance in
  `README.md` and `docs/deployment.md` with these bounds and limitations.

### Out of scope

- Other #47 lots, mutation retries, authorization policy, new configuration,
  audit schema changes, new event types, rotation, reconciliation or replay.
- Stronger stderr durability, cancelling bytes already handed to the OS,
  a worker/process isolation redesign, or a hard real-time guarantee during
  synchronous event-loop blockage or process suspension. In particular,
  Node's synchronous fd 2 writes to a file or TTY can block the event loop
  so no timer can fire; these waits are unbounded and outside the append
  and shutdown guarantees. A file write or `fdatasync` stuck in the libuv
  threadpool can also hold OS/runtime teardown after `process.exit` is
  called; this unbounded OS-level stall is documented, not fixed.
  README/deployment guidance must name both limits.
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
  without audit I/O; a stream error does not wait for a write callback.
  Every first latch offers the same fixed best-effort diagnostic once per
  gate, including intent, denied, idle-error and close failures; an outcome
  failure shares that once guard. Oversize validation alone still does not
  latch. Verified by: AC-01–AC-06, AC-10, AC-14.
- **BR-259 v2** — Every file or stderr append has one ordinary 5,000 ms monotonic
  budget from the `append` call, including queue time, write and sync or
  callback; unresolved work at or after that deadline rejects and latches.
  Intent rejection gives BR-244; outcome rejection gives BR-252. The gate
  also refuses dispatch when intent acknowledgement is observed at or after
  5,000 ms from its append call. For stdio shutdown without a run past
  intent, the remaining BR-070 budget shortens non-committed appends.
  Synchronous fd 2 writes to a file or TTY
  that block the event loop remain unbounded. Verified by: AC-01–AC-05,
  AC-07, AC-10, AC-11, AC-13, AC-15.
- **BR-254 v2** — Gate close refuses new runs, lets in-flight runs reach
  their bounded result/outcome failure, then closes the sink. Sink close
  settles within 5,000 ms from its first call, including tail drain and file
  release; on expiry it latches, rejects outstanding appends and resolves
  closed without claiming a flush. File release waits for the underlying
  port operation itself to settle, never merely its append timeout; if it
  remains pending at close expiry, retain the fd until actual process
  termination, which is not bounded during OS/runtime teardown stalls.
  Synchronous fd 2 blockage is also outside these bounds. Gate close in the
  production composition is bounded by 45,000 ms from its call under the
  existing guarded policy and sole-attempt contracts. Transport → gate → exit and HTTP 503 semantics
  remain unchanged. The production exit helper sets the requested exit code
  and calls `process.exit` in the same turn without a stdout/stderr flush
  write or callback wait. Verified by: AC-07–AC-09, AC-11–AC-13;
  AC-11's documentation row maps to
  `TestBR259_v2_AC11_docs_state_audit_bounds_and_ambiguity` in
  `tests/deployment-examples.test.ts`.
- **BR-070 v5** — v4 holds with the stderr shutdown exception replaced by
  BR-259 v2's append bounds and BR-254 v2's gate/sink closure bounds. The
  1,000 ms stdio exit-call bound without a run past intent remains: the
  remaining budget covers non-committed in-flight appends (including denied)
  before sink close, as well as release and the production exit helper.
  The navigation deadline never substitutes for a committed mutation's result.
  Verified by: AC-08, AC-09, AC-11–AC-13.

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

Use the existing `AUDIT_APPEND_TIMEOUT_MS = 5000` as the ordinary append
constant for both sinks and the gate's stale-intent guard. The remaining
stdio shutdown budget can shorten a non-committed append under AC-13;
it never extends a deadline or shortens a run past intent. Start the budget
when `append` is called, before enqueueing, and never restart it when the
write starts or a callback fires. Under the ordinary budget, at elapsed
time 4,999 ms an unresolved
append is still pending; at 5,000 ms it fails. Check monotonic time on
completion as well as using a timer: a callback processed at the effective deadline
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
Each first latch notifies the gate's once-only diagnostic path described
below; later refusal of audit I/O does not prohibit that one diagnostic.
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
  acknowledged record. An intent with no outcome is ambiguous: it can be
  this late delivery without dispatch or a dispatched run with no recorded
  outcome. It proves neither dispatch nor its absence; the client's mutation
  result is the authority. An HTTP shutdown 503 is not such a result and
  retains BR-254's existing semantics. README/deployment guidance must state
  this ambiguity and authority. A later invocation is an admission refusal with
  `failed`, `AUDIT_UNAVAILABLE`, `attempts:0`, no `op`, no policy call and
  no record.
- Failed/timed-out outcome: preserve result, code, status, value, attempts
  and fixed uncertain message, and add `audit:"outcome_unrecorded"` per
  BR-252. Never return an unqualified success, retry or compensate. Offer
  the same once-per-gate diagnostic path used by every first sink latch,
  without a second diagnostic when the sink has already notified it.
- Failed/timed-out `denied` append: keep `denied`, `ACCESS_DENIED`,
  `attempts:0`, the admitted `op` and zero upstream calls (BR-246); latch
  the sink and offer the same fixed diagnostic once. Do not manufacture
  an `outcome` or introduce different diagnostic text.
- If cancellation occurs after intent starts, an intent rejection still
  takes precedence under BR-244. If intent succeeds before the deadline
  and cancellation prevents dispatch, keep `failed`/`CANCELLED`, attempts
  zero; a failing outcome append adds the existing unrecorded marker and
  diagnostic. Cancellation during an attempt never changes its known
  classification. Closed sessions publish no later wire result.

On any first failure latch (intent, outcome, denied, idle stream error,
append timeout, close expiry or release error), offer exactly the existing
fixed line once per gate to stderr:
`Audit outcome could not be recorded; further writes are refused until restart.\n`.
Wire the sink's first-latch notification to this same gate diagnostic path,
including idle and close failures; outcome handling shares its once guard.
Set the guard before attempting the diagnostic so a synchronous throw or
reentrant stream error cannot retry it. The text is reused even when no
outcome was attempted; it contains no error payload, path, stack, record or
secret. This is a best-effort diagnostic, not an audit record. Never await
its callback or drain, retry it or let its failure replace a result or
retain shutdown. Blocked stderr can prevent delivery. Successful close and
non-latching oversize validation emit nothing.

### Shutdown

Sink `close()` stops admission immediately, refuses queued records not yet
written, and waits only for an active append and owned file release within
one `AUDIT_CLOSE_TIMEOUT_MS = 5000` budget from the first close call. It
attempts owned file close at most once, only after the underlying
`port.write` or `port.fdatasync` operation itself has settled, successfully
or with an error, and no port operation is still in flight. Rejection of
the append's timeout wrapper does not establish that settlement: the port
operation may still be queued in the libuv threadpool. Never race it with
`close(fd)`, which could free the fd number for reuse by an unrelated file
before the late operation runs. Start no further write or sync after the
sink latches. If the underlying operation settles before the close deadline,
release gets only the remaining close budget, not another 5,000 ms. If it
is still pending at close expiry, skip release and leave the fd open until
actual process termination, even if that operation later settles; library
compositions retain that descriptor until their host process terminates.
Termination itself is not guaranteed within a bound: a write or fdatasync
stuck in the libuv threadpool may hold teardown after `process.exit` is
called. This is an unbounded OS-level stall alongside synchronous fd 2
blockage, not a reason to race release against the outstanding operation.
Expiry latches the sink and resolves close; it does not report durable
delivery. Concurrent/repeated closes share completion, do not reset the
deadline and do not close a descriptor twice. Errors from release are
contained and latch the sink; late release settlement cannot reopen it.
Sink close emits no new audit event. A close failure offers the same fixed
diagnostic through the first-latch path, once in total per gate.

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
The dedicated process must call its exit primitive without awaiting stderr
delivery or a timed-out file release. The real helper in `src/production.ts`
sets `process.exitCode` and calls `process.exit(code)` in the same turn, with
no empty stdout/stderr flush writes and no callback dependency: its flush
wait budget is zero. This preserves the full 1,000 ms stdio allowance for
transport/gate shutdown and adds nothing to HTTP's 1,000 + 45,000 ms audit
shutdown ceiling within the 75 s grace. It may discard buffered output;
transport closure remains responsible for its existing bounded response
flush. Existing non-shutdown exit callers use the same immediate helper
and keep their codes. Test injection replaces only the process ports (exit
primitive, exit-code setter and stdout/stderr), not this helper's logic;
production always supplies the real process ports, with no operator knob.
Calling `process.exit` within a bound does not guarantee OS termination in
the stall cases above. Library compositions resolve closure without
terminating their host process.

For stdio shutdown with no run past intent, the existing 1,000 ms exit
budget takes precedence, measured from EOF/signal handling, including time
already spent closing transport. Before draining runs, propagate its
absolute deadline to non-committed in-flight appends, including `denied`;
their effective deadline is the earlier of their append deadline and this
stdio deadline. At expiry reject/latch and preserve the denied result
(BR-246), with zero upstream calls and no outcome. Pre-intent policy waits
must also settle on session close without crossing intent. Sink closure
then receives only the remaining budget, possibly zero: it resolves/latches
immediately at expiry rather than starting another wait, and never releases
an fd whose operation is pending. This is an internal shorter allowance,
not operator configuration; repeated calls cannot extend the earliest
deadline. Gate close still precedes exit. If any run has started intent,
keep the ordinary committed-run budgets and result semantics; this shorter
allowance never races that run.

## Acceptance criteria

Names below are exact planned test names, not execution claims. Except for
AC-15's real child runtime probe, use fake monotonic time, controlled
callbacks and synthetic ports; flush microtasks
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
  in `tests/mutation-gate.test.ts`; the fixed diagnostic is offered once.
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
  outcome or upstream call, and the fixed diagnostic is offered once.
  Given client cancellation during
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
  late callbacks/rejections cause no extra release or event. Given a file
  append at 0 ms with `port.write` or `port.fdatasync` still pending after
  its 5,000 ms append timeout, When close starts at 5,000 ms, Then no file
  release occurs while that port operation remains pending. If it settles
  (success or rejection) at 6,000 ms, release may start once afterwards
  with only the remaining 4,000 ms close budget; no further write or sync
  starts. If it is still pending at 10,000 ms, close resolves/latches with
  zero release calls and the fd retained until process exit; settlement at
  11,000 ms or no settlement and repeated close calls still cause zero
  release calls, no new I/O and no unhandled rejection. This pins underlying
  port settlement independently of append-promise rejection. Verified by
  `TestBR254_v2_AC07_sink_close_bounds_drain_and_release`
  in `tests/audit-sink.test.ts`.
- **AC-08** (BR-254 v2, BR-070 v5) — Given a real bounded sink and gate,
  When gate close starts during a stalled intent, Then AC-01's result and
  close settle by 5,000 ms with no dispatch. Given a pre-intent guarded
  policy wait, When gate close starts and the policy completes at 100 ms,
  before its existing 10,000 ms guard, Then the run returns exactly
  `{result:"failed",op:OP,code:"CANCELLED",attempts:0}` with no record or
  upstream attempt after close. Both rows are verified only by
  `TestBR254_v2_AC08_gate_close_preserves_attempt_and_bounds_audit_waits`
  in `tests/mutation-composition.test.ts`. Given intent success at
  4,999 ms, an already-started attempt that never settles, a blocked
  outcome and a file release that never settles, When close starts just
  after dispatch, Then the attempt aborts at 30,000 ms from its start,
  its result is exactly
  `{result:"uncertain",op:OP,code:"UPSTREAM_UNCERTAIN",attempts:1,audit:"outcome_unrecorded",message:"The upstream result is unknown; verify the item's state before any new attempt."}`
  after the 5,000 ms outcome bound, and close completes after at most
  5,000 ms more; a late 200 changes nothing. This committed-run row is
  verified only by `TestBR070_v5_AC08_shutdown_keeps_committed_result_semantics`
  in that file. Each test asserts its rows fit 45,000 ms from gate close
  and admit no new invocation.
- **AC-09** (BR-254 v2, BR-070 v5, BR-169, BR-210) — Given the production
  stdio/HTTP compositions with injected upstream, clocks, streams and exit,
  When EOF (stdio), SIGINT or SIGTERM arrives during an outcome stall,
  Then observable order is transport close, outcome failure, sink close,
  gate close, process exit; HTTP receives its existing 503 and exits 0;
  stdio with no prior error retains exit 0 and publishes no closed-session
  result. Neither awaits the diagnostic callback or stderr drain. Repeat
  these outcome-stall rows using a rejecting file release; exit still
  follows gate completion, never an unhandled rejection. These rows are
  verified only by
  `TestBR254_v2_AC09_stdio_and_HTTP_shutdown_do_not_wait_for_stderr`
  in `tests/mutation-composition.test.ts`. Given stdio without a run past
  intent and a file sink whose idle release either stalls indefinitely or rejects,
  When EOF, SIGINT or SIGTERM starts closure, Then stdio still closes within
  1,000 ms, and exit follows gate completion without an unhandled rejection.
  These idle rows are verified only by
  `TestBR070_v5_AC09_idle_stdio_exit_bound_is_unchanged` in that file.
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
  in `tests/mutation-composition.test.ts`. Given `README.md` and
  `docs/deployment.md`, When their audit/shutdown guidance is checked,
  Then both state the 5,000 ms append/close bounds for asynchronous waits,
  permanent latch, best-effort diagnostics, late-byte possibility and
  unchanged 75 s grace. Both explicitly state that synchronous fd 2 writes
  to a file or TTY can block the event loop, prevent timers from firing and
  remain unbounded; an intent without an outcome is ambiguous and the
  client's mutation result is the authority, while a shutdown HTTP 503
  does not determine whether a write occurred. Both also name a write or
  fdatasync stuck in the libuv threadpool as an unbounded OS-level teardown
  stall even after `process.exit` is called: retained fds last until actual
  termination, not a guaranteed deadline. State the zero flush wait in the
  production helper, possible loss of buffered output, and the shared
  1,000 ms stdio allowance for non-committed appends and release. Neither
  claims asynchronous stderr waits are unlimited. This documentation row is verified only by
  `TestBR259_v2_AC11_docs_state_audit_bounds_and_ambiguity`
  in `tests/deployment-examples.test.ts`.
- **AC-12** (BR-254 v2, BR-070 v5) — Given the real production exit helper
  used by `productionDependencies()` with injected process ports, stderr
  whose write would never call back, and an exit primitive spy, When the
  helper is called with code 0 or 1, Then it sets that code and calls the
  primitive exactly once in the same turn (zero ms flush wait), without
  advancing a timer or waiting for a callback; neither stdout nor stderr
  receives an empty flush write. Repeat with stdout also never calling
  back. Exercise the actual helper, not a replacement `MainDependencies.exit`.
  Verified only by
  `TestBR254_v2_AC12_real_production_exit_has_no_flush_wait`
  in `tests/cli.test.ts`. AC-09 keeps its separate composition-order rows.
- **AC-13** (BR-070 v5, BR-254 v2, BR-259 v2, BR-246) — Given stdio
  with no run past intent, a policy-denied run whose audit append started
  at time 0 and never calls back, and EOF/SIGINT/SIGTERM at time 100 ms,
  When transport close consumes 200 ms and run drain begins at 300 ms,
  Then the still-pending denied append gets only 800 ms of the 1,000 ms
  shutdown allowance: it is pending at 1,099 ms and rejects/latches by
  1,100 ms, not its ordinary 5,000 ms deadline. Its exact gate value stays
  `{result:"denied",op:OP,code:"ACCESS_DENIED",attempts:0}`; no intent,
  outcome or upstream call starts, and the diagnostic is offered once.
  Sink close receives zero remaining time, then gate close settles and
  the real AC-12 helper calls the injected exit primitive by 1,100 ms;
  no closed-session result is published. Repeat for file write/fdatasync
  stalls; never release a still-busy fd. In a separate row, let the denied
  append acknowledge at 400 ms and stall the now-idle file release: close
  gets only 700 ms, resolves/latches by 1,100 ms and offers one diagnostic;
  gate close and the real exit helper meet the same deadline. Repeated
  close cannot reset either deadline, and late completion changes nothing.
  Verified only by
  `TestBR070_v5_AC13_denied_append_shares_remaining_stdio_shutdown_budget`
  in `tests/mutation-composition.test.ts`.
- **AC-14** (BR-241 v2, BR-252) — Given a real sink/gate composition,
  When the first latch is caused by intent timeout, denied timeout,
  outcome failure, idle stream error, close expiry or release rejection,
  Then exactly one attempt writes the fixed diagnostic above, with no
  injected secret sentinel, underlying error, stack, path or record data.
  Repeated errors, later admission refusals, late callbacks and subsequent
  outcome handling emit no second diagnostic. A diagnostic writer that
  never calls back, throws, or synchronously emits another stream error
  cannot block settlement, recurse, alter the result or produce an
  unhandled error. Healthy close and oversize-only validation emit none.
  Verified by `TestBR241_v2_AC14_every_first_latch_offers_one_fixed_diagnostic`
  in `tests/mutation-gate.test.ts`; count diagnostics separately from audit
  writes, and keep AC-01/AC-04/AC-05 result assertions unchanged.
- **AC-15** (BR-259 v2) — Given a child using the supported production
  Node runtime/platform and the real stderr sink, with fd 2 connected to a
  pipe the parent immediately pauses and never reads, When the child
  prefills stderr with a fixed maximum of 8 MiB of synthetic bytes then
  starts one valid audit append, Then that append rejects with
  `AuditUnavailable`/`AUDIT_UNAVAILABLE` and latches after the 5,000 ms
  budget despite the blocked pipe. Use real monotonic time; assert no
  early timeout and settlement within 5,500 ms from append (500 ms test
  scheduling tolerance, not an extended product budget), with the write
  callback still pending when timeout wins. Report only fixed status and
  elapsed time over a separate IPC channel. The parent enforces a
  10,000 ms watchdog from spawn, sends SIGKILL on expiry or after the
  assertion (also on assertion failure), and waits at most 1,000 ms for
  cleanup before failing; no unbounded fill loop, reads from the stderr
  pipe or reliance on natural child exit. Failure to reach the
  timeout assertion is a test failure, never a skip or evidence of support.
  Verified by
  `TestBR259_v2_AC15_unread_child_stderr_pipe_keeps_append_timeout_runnable`
  in `tests/audit-sink.test.ts`. This planned runtime evidence complements
  fake-clock rows; it has not been run in this spec phase.

## Test plan

1. After independent review and freeze, write characterization tests before
   source edits: healthy intent/outcome bytes and result, file sync barrier,
   error classifications, pre-/post-intent cancellation, shutdown ordering,
   and read mode. Run the existing audit-sink, mutation-gate and
   mutation-composition suites on the implementation base and record results.
2. Write AC-01–AC-15 first. Observe failing assertions for blocked stderr,
   error-without-callback, queue deadlines, exact deadline boundaries and
   bounded release on the old implementation; use fake time and captured
   callbacks for deterministic boundaries. AC-15 alone uses bounded child
   pipe saturation to verify the supported runtime assumption; its parent
   watchdog and forced cleanup are mandatory. AC-12 drives the real
   production helper, and AC-13 covers the pre-sink-close denied wait.
   Preserve existing healthy-path controls. Replace the obsolete
   `TestBR259_a_stderr_intent_resolving_after_5000_ms_makes_zero_attempts`
   expectation of a later outcome and
   `TestBR259_a_stderr_intent_resolving_at_5000_ms_proceeds` success
   expectation with AC-06's versioned refusal assertions.
   For AC-11's named documentation test, follow the existing content-check
   pattern in `tests/deployment-examples.test.ts` and
   `tests/helpers/deployment.ts`: read the tracked Markdown from the tree
   and assert required guidance in the relevant sections. README content
   assertions also exist in `TestBR387_docs_describe_queue_and_retryable_SERVER_BUSY`
   in `tests/invocation-queue.test.ts`. These are planned implementation
   checks, not a manual review substituted for an AC test.
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
  Offer that same diagnostic once on every first latch, including intent,
  denied and idle/close failures; share the guard with outcome handling.
  Reject all pending/queued work on failure; never reopen on a later callback.
  Reject silent success, automatic replay, synthetic timeout audit events
  through the broken sink, and pretending a known performed write failed.
- **D-3 — Bound close without truncating upstream classification.** Give
  sink drain plus file release one 5,000 ms budget, with idempotent resolved
  closure on failure. Release only after the underlying port operation
  settles; retain the fd until process exit if it outlives close's budget.
  Accept retention of that descriptor, potentially indefinitely during an
  OS teardown stall, to prevent fd-reuse corruption.
  The derived gate ceiling is 45,000 ms with lot A's
  sole 30,000 ms attempt; retain its 60,000 ms outer deadline without using
  it to justify another wait. Reject a blanket 5 s gate timeout that could
  discard a dispatched write's result. Keep 75 s deployment grace and
  existing exit codes; do not wait for delivery of a failure diagnostic.
  For no-intent stdio shutdown, apply the remaining 1,000 ms allowance to
  non-committed appends before draining runs, then to sink close; shortening
  only sink close would leave a denied append waiting up to 5,000 ms.
  The production exit helper has zero flush wait. A further 1,000 ms flush
  timer would overspend stdio's total allowance; reusing 5,000 ms would be
  worse, while callback-only flushing can wait forever. Accept loss of
  buffered output after transport close. OS/runtime teardown may still
  stall indefinitely on a blocked libuv file operation; this is documented
  alongside synchronous fd 2 stalls, not claimed fixed.
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
  A targeted search of `business-rules/` for `flush`, `process.exit` and
  `exit callback` found no rule specifically governing the production
  helper's flush. BR-254 governs transport → gate → process exit, so its
  pending v2 carries the no-flush requirement; BR-210's HTTP signal code
  stays unchanged. BR-241 v2 owns the expanded diagnostic trigger; BR-252's
  outcome text and classification remain unchanged with one shared guard.
  No new BR or costly architectural choice warrants an ADR.

## Risks

- A timed-out OS write or file release may finish later. A late intent can
  exist without an attempt, and a reported unrecorded outcome can eventually
  appear. An intent with no outcome is ambiguous; the client's mutation
  result is the authority, subject to the shutdown HTTP 503 exception above.
  Do not promise absence, durable completion, retry safety or repaired partial
  lines. Keep F-016's local-filesystem and stderr durability limits.
- A timeout cannot preempt Node's synchronous fd 2 writes to a file or TTY:
  a stalled device blocks the event loop, prevents timers from firing and
  leaves the wait unbounded. A suspended event loop is also outside the
  guarantee. Bounds mean settlement at the first runnable
  deadline turn, with monotonic checks preventing late dispatch/acknowledgement;
  this repair bounds asynchronous waits, not OS scheduling.
- A write or fdatasync stuck in the libuv threadpool may block runtime/OS
  teardown even after `process.exit` is called. The retained fd can then
  remain open indefinitely; this unbounded OS-level stall is documented,
  not fixed by append/close timers or the no-flush exit helper.
- Pipe bounds require asynchronous fd 2 writes on the supported Node
  runtime/platform. Planned evidence is
  `TestBR259_v2_AC15_unread_child_stderr_pipe_keeps_append_timeout_runnable`
  (`tests/audit-sink.test.ts`, AC-15), using an unread pipe, independent
  parent watchdog and forced child cleanup. It is not yet executed; no
  runtime qualification is claimed from fake-port tests alone.
- Immediate process exit can discard buffered stdout/stderr, including the
  best-effort diagnostic. Existing transport flush bounds still apply
  before exit; the helper adds no further delivery guarantee.
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

### Review 1 dispositions

The owner supplied this review for this revision; the entries below record
its verdict and the disposition of every finding, not a new review or an
approval of the revised head. Reviewer model/effort and token counters were
not supplied (unknown); no usage is inferred. This revision remains draft v1.

### 47c-spec-review-1-reviewer — verdict: changes

1. **Major — file descriptor release race. Retained, fixed in this revision.**
   Shutdown and pending BR-254 v2 require underlying port settlement before
   release, with the fd retained until process exit if close expires first.
   AC-07 covers pending write/sync, timely and late settlement, rejection
   and no settlement; an append timeout never permits a racing close.
2. **Minor — synchronous fd 2 limits. Retained, fixed in this revision.**
   Scope, risks and pending bounds explicitly exclude blocking synchronous
   file/TTY stderr writes as unbounded; AC-11 requires both operator docs
   to explain that no timer can fire while the event loop is blocked.
3. **Minor — orphan intent ambiguity. Retained, fixed in this revision.**
   Caller behavior and risks distinguish a late undispatched intent from a
   dispatched run with no outcome: the record alone cannot decide which.
   AC-11 requires the docs to identify the client's mutation result as the
   authority, preserving the existing shutdown HTTP 503 exception.
4. **Minor — AC-08/AC-09 row ownership. Retained, fixed in this revision.**
   AC-08 assigns stalled-intent/pre-intent rows to its BR-254 test and the
   committed-run row to its BR-070 test. AC-09 assigns outcome-stall rows
   to its BR-254 test and idle stdio rows to its BR-070 test, including
   release-rejection variants. Each row has exactly one named test.
5. **Minor — AC-11 manual documentation check. Retained, fixed in this revision.**
   Replaced the manual check with a named planned documentation test,
   following existing deployment and README content-test patterns. The
   test plan records those patterns; no source or test file was changed
   and no tests were run.

### 47c-spec-review-2-reviewer — verdict: approve, with one minor

6. **R2-1 Minor — BR-254 verification coverage. Retained, fixed.**
   Added AC-11 and its named `deployment-examples.test.ts` mapping to the
   BR-254 v2 summary and record, covering the fd 2 exclusion as well as
   the expanded shutdown guidance. The approval applies to the supplied
   review's head, not this revised draft.

### 47c-spec-decision-1-fable — verdict: changes

7. **F1 Major — production exit waits behind blocked stderr. Retained, fixed.**
   Brought `src/production.ts`'s real exit helper into implementation scope;
   BR-254 v2 requires zero stdout/stderr flush wait. D-3 ties this choice
   to the existing 1,000 ms stdio and 45,000 ms gate budgets and records
   possible buffered-output loss. No dedicated production-flush BR was
   found, so the closest shutdown rule, BR-254, carries the change from
   active v1 to pending v2. AC-12 drives the real helper with process-port
   injection and callbacks that never fire; it asserts same-turn exit.
8. **F2 Minor — denied append exceeds idle stdio bound. Retained, fixed.**
   Apply the remaining absolute stdio deadline to non-committed appends
   before gate drain, then to sink close; preserve denied classification
   and committed-run semantics. BR-070 v5, BR-254 v2 and BR-259 v2 agree.
   AC-13 accounts for time already spent closing transport and tests
   stalled denied writes, file sync/release and repeated closure.
9. **F3 Minor — OS teardown can retain the fd indefinitely. Retained, documented.**
   Scope, shutdown, risks, BR-254 v2 and AC-11 operator guidance name a
   write/fdatasync stuck in the libuv threadpool as an unbounded OS-level
   stall beside synchronous fd 2 blockage. Exit-call bounds do not claim
   actual termination or timely descriptor release; no OS-level fix is
   proposed.
10. **F4 Minor — intent/denied latch has no operator signal. Retained, fixed.**
    BR-241 v2 and D-2 offer the identical fixed diagnostic once on any
    first latch, including idle/close failures; outcome handling shares
    the guard. AC-14 pins no secrets, no duplicates, no callback wait and
    safe reentrant failures; AC-01/AC-05 now expect that diagnostic.
11. **F5 Minor — asynchronous pipe assumption lacks evidence. Retained, fixed.**
    AC-15 names a real Node child test with an unread stderr pipe, finite
    prefill, IPC result, 5,000 ms append deadline, explicit scheduling
    tolerance, parent watchdog and forced cleanup. Risks cites that test
    as planned evidence; fake-clock tests alone do not qualify the runtime.

These review identifiers and verdicts were supplied by the owner, not
produced by a new agent review. Decision-pass model: Fable 5.2 per
PROJECT.md; actual reported model/effort and token counters: unknown/not
supplied. This revision remains draft v1, with all proposed BR versions
pending acceptance. No tests, Docker, network, commits, freeze or forge
publication were performed for these dispositions.

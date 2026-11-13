---
id: F-026
title: Bounded invocation queue
ticket: "#16"
status: ready-for-freeze
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-13.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `b509c26`. IDs: F-026,
BR-380–BR-387 v1, BR-258 v2; no ADR. `#16` is this repository's ticket.

## Context

The navigation controller (`src/navigation.ts`) runs one invocation at a
time per MCP session. Every tool call (`perform`), every resource read
(`perform`) and every gate run (`mutate`) takes the single invocation slot;
a call that arrives while the slot is held is refused at once with the fixed
text `SERVER_BUSY` (`if (current) return SERVER_BUSY` in both `perform` and
`mutate`). This immediate refusal is stated by F-005 v1 ("a concurrent second
tool call returns fixed `SERVER_BUSY`"), F-007 v1 ("no waiting queue.
Concurrent calls receive `SERVER_BUSY`"), F-016 v1 (BR-258 v1, AC-25) and
F-018 v1 (AC-10, last clause).

During the `0.6.0-beta.1` smoke test, claude.ai issued two `kdrive_info`
calls in parallel in one session; the second failed with `SERVER_BUSY`
(learnings.md, 2026-11-13). MCP clients may send several requests at once,
so a correct read was lost for a reason the user cannot act on.

Users affected: MCP clients and their users over stdio and HTTP (parallel
calls in one session now complete instead of failing), operators (the
documented meaning of `SERVER_BUSY` changes), and maintainers (the tests
listed under Scope that observe the old immediate refusal).

## Scope

- One bounded first-in first-out wait queue per navigation controller, in
  front of the existing single invocation slot, shared by `perform` (tool
  calls and resource reads) and `mutate` (gate runs). Execution stays
  strictly one invocation at a time (BR-380, BR-383).
- Constants: at most **4** waiting calls per controller (`MAX_WAITING`) and
  at most **12,000 ms** of monotonic waiting time per call (`MAX_WAIT_MS`)
  (D-2).
- Refusals: queue full (BR-381) and wait timeout (BR-382) give `SERVER_BUSY`
  with zero kDrive requests and zero audit records; abort while waiting
  (BR-385) and controller close while waiting (BR-386) give `ACCESS_DENIED`
  with zero requests and records, as an abort or close gives today.
- Each invocation's 10,000 ms deadline, 512 dependency-call budget, five-list
  budget, output bounds and pagination state start when it takes the slot,
  never when it joins the queue (BR-384).
- The stdio composition (`src/stdio.ts`) and every HTTP session
  (`src/http/handler.ts`) each create their controller through
  `createNavigationServer`, so both transports use this queue with no
  transport-specific code; each HTTP session has its own queue (BR-380).
- BR-258 v2: `mutate` waits in the shared queue instead of refusing at once.
- Documentation (BR-387): README "Key limits", a new section of
  `docs/mcp-client-compatibility.md`, and one `CHANGELOG.md` line under
  `## [Unreleased]`.
- Existing tests that observe the immediate `SERVER_BUSY` change to observe
  waiting, or reach `SERVER_BUSY` through a full queue or a wait timeout. No
  rule changes for these BRs; only their tests (and, for BR-118, one
  example) change:
  - BR-070 v2: `tests/navigation.test.ts` ("BR-070 never-settling evidence
    times out and concurrent requests are busy") and
    `tests/navigation-wire-boundaries.test.ts` ("BR-070 actual SDK
    cancellation suppresses a late result and busy response never starts
    protected work").
  - BR-089 v1: `tests/download-retry.test.ts` (`TestBR089_content_lifecycle
    cancel retry wait releases slot without new attempts`).
  - BR-118 v1: `tests/read-boundaries.test.ts` and
    `tests/read-worker-lifecycle.test.ts` (`TestBR118_worker_lifecycle*`);
    the example "a pending read and a concurrent info call → `SERVER_BUSY`"
    is replaced at implementation by "the info call waits and runs after the
    read settles; a call refused by a full queue gets `SERVER_BUSY`". The
    rule (termination before slot release, no late publication) is
    unchanged, so BR-118 keeps v1; the record gets a History note, not a
    version.
  - BR-258: `tests/mutation-composition.test.ts`
    (`TestBR258_mutate_answers_SERVER_BUSY_while_another_invocation_is_active`
    and `TestBR258_TestBR070_a_12000_ms_write_succeeds_and_holds_the_slot`)
    follow BR-258 v2.
  - BR-284 v1: `tests/upload-production.test.ts`
    (`TestBR284_concurrent_calls_in_one_session_are_SERVER_BUSY`) becomes
    `TestBR284_concurrent_calls_in_one_session_run_one_after_the_other`;
    BR-284's rule (conflict modes) does not mention concurrency.
- The frozen F-005, F-007, F-016 and F-018 files are not edited. The
  sentences quoted under Context, F-016 AC-25 ("a concurrent read gets
  `SERVER_BUSY` until then", "Given another invocation active, When `mutate`
  is called, Then it returns `SERVER_BUSY`") and F-018 AC-10's last clause
  are superseded by this spec.

### Out of scope

- Parallel execution of invocations in one session (D-1).
- Any change to the process-wide upstream limiter (BR-195: 8 in flight, 64
  queued), the mutation gate's own deadlines (BR-249), HTTP session caps and
  rate limits, or the stdio frame and send bounds.
- Queueing across sessions: two sessions never share a queue or a slot.
- New error codes or text; `SERVER_BUSY` and `ACCESS_DENIED` keep their
  fixed text and envelopes (tool error `isError:true`, resource read
  protocol error `-32000`).
- Client-side retry; the server never retries a refused call itself.

## Business rules

- **BR-380** — Each navigation controller (one per MCP session, stdio or
  HTTP) runs at most one invocation at a time. A tool call, resource read or
  `mutate` call that passes the existing closed and aborted checks, and
  arrives while an invocation holds the slot or while any call is waiting,
  joins the tail of that controller's wait queue and makes no kDrive request,
  dependency call or audit append while it waits. Verified by: AC-01, AC-02,
  AC-10.
- **BR-381** — When 4 calls are already waiting, an arriving call returns
  `SERVER_BUSY` at once, with zero kDrive requests and zero audit records,
  and the 4 waiting calls and the running invocation are unaffected.
  Verified by: AC-04.
- **BR-382** — A call still waiting 12,000 ms of monotonic time after it
  joined leaves the queue and returns `SERVER_BUSY`, with zero kDrive
  requests and zero audit records; the calls behind it keep their relative
  order. Verified by: AC-05.
- **BR-383** — When the slot is released, it passes, before any other call
  can take it, to the oldest call still waiting; calls take the slot in the
  order they joined, and no invocation (read, resource read or gate run)
  starts until the previous one has settled, so writes never overlap any
  other invocation. Verified by: AC-02, AC-03, AC-08.
- **BR-384** — An invocation's 10,000 ms deadline, its 512 dependency-call
  budget, its five-list budget, its output bounds and its pagination state
  start when it takes the slot; the time spent waiting counts toward none of
  them. Verified by: AC-01, AC-09.
- **BR-385** — When the abort signal of a waiting call fires, the call
  leaves the queue at once and returns `ACCESS_DENIED`, with zero kDrive
  requests and zero audit records; its wait timer and abort listener are
  removed, and the calls behind it keep their order and move up. Verified
  by: AC-06.
- **BR-386** — When the controller closes, every waiting call leaves the
  queue at once and returns `ACCESS_DENIED`, with zero kDrive requests and
  zero audit records, without waiting for the running invocation to settle;
  no call takes the slot after close, and all wait timers and abort
  listeners are removed. Verified by: AC-07.
- **BR-387** — README "Key limits" and the section `## Parallel tool calls`
  of `docs/mcp-client-compatibility.md` state that one call per session runs
  at a time, that up to 4 further calls wait in arrival order for at most
  12 seconds, and that `SERVER_BUSY` means the call was refused before any
  kDrive request, so it is safe to retry (writes included) once an earlier
  call has completed. `CHANGELOG.md` `## [Unreleased]` has a `### Fixed`
  line citing #16. Verified by: AC-11.
- **BR-258 v2** (supersedes BR-258 v1, same purpose: the single gate-run
  entry point and its post-intent bounds) — `mutate` waits in the shared
  queue (BR-380) when another invocation holds the slot or a call is
  waiting, instead of refusing; it answers `SERVER_BUSY` with zero records
  only under BR-381 and BR-382, and `ACCESS_DENIED` with zero records under
  BR-385 and BR-386; while a gate run holds the slot, other calls wait
  (BR-380) or are refused under BR-381 and BR-382. Every other sentence of
  v1 is unchanged. Verified by: AC-03, AC-05, AC-12.

## Acceptance criteria

Unless stated otherwise, tests use the real navigation controller with
injected policy dependencies, a fake monotonic clock, and a counting fake
kDrive port; "zero requests" means the port and the audit sink saw no call
for that invocation. Planned tests live in `tests/invocation-queue.test.ts`
unless another file is named.

- **AC-01** (BR-380, BR-384) — Two parallel reads, both orders.
  Given an idle session, When `kdrive_info` (file 41) and `kdrive_list`
  (folder 40) are started in the same tick, Then both succeed with their own
  result, the first dependency call of `kdrive_list` happens only after
  `kdrive_info` settled; and Given the reverse start order, Then both
  succeed and `kdrive_info` starts only after `kdrive_list` settled. Given
  two parallel `kdrive_info` calls where the first never gets an answer,
  Then the first returns `REQUEST_TIMEOUT` at 10,000 ms and the second takes
  the slot then and succeeds. Verified by:
  `TestBR380_parallel_reads_info_then_list_both_succeed`,
  `TestBR380_parallel_reads_list_then_info_both_succeed`,
  `TestBR384_second_read_succeeds_after_first_times_out`.
- **AC-02** (BR-380, BR-383) — Read behind a mutation. Given mode `write`
  and a `kdrive_rename` whose mutator answers 200 after 2,000 ms, When a
  `kdrive_info` is started at 100 ms, Then it makes no request until the
  rename result is returned, then succeeds; the rename is `succeeded`.
  Verified by: `TestBR383_read_waits_behind_mutation_without_overlap`.
- **AC-03** (BR-383, BR-258 v2) — Mutation behind a read, and two
  mutations. Given a `kdrive_info` whose port answers after 2,000 ms, When a
  `kdrive_rename` is started at 100 ms, Then its intent append and mutator
  attempt happen only after the read settled and the rename is `succeeded`.
  Given two `kdrive_create_folder` calls started together, Then the second's
  intent append happens after the first's outcome record. Verified by:
  `TestBR383_mutation_waits_behind_read_without_overlap`,
  `TestBR383_two_mutations_run_one_after_the_other`.
- **AC-04** (BR-381) — Queue full. Given a running read whose port never
  answers and 4 waiting calls, When a fifth call arrives as a tool call, as
  a resource read and as a `mutate`, Then each returns `SERVER_BUSY` at
  once (resource read: protocol error `-32000` `SERVER_BUSY`) with zero
  requests and zero records, and the 4 waiting calls still run in order
  afterwards. Given 3 waiting calls, Then an arriving call joins as the
  fourth. Verified by:
  `TestBR381_fourth_waiting_call_is_admitted`,
  `TestBR381_fifth_waiting_call_is_SERVER_BUSY_with_zero_requests`.
- **AC-05** (BR-382, BR-258 v2) — Wait timeout, both sides. Given a gate run past its
  intent append whose mutator answers 200 after 11,999 ms after a read
  joined the queue, Then the read takes the slot and succeeds; Given the
  mutator answering after 12,001 ms, Then the read returns `SERVER_BUSY` at
  12,000 ms with zero requests, and a call that joined behind it is not
  reordered; Given a waiting `mutate` in the read's place, Then it returns
  `SERVER_BUSY` at 12,000 ms with zero records and zero attempts. Verified
  by: `TestBR382_waiter_gets_slot_at_11999_ms`,
  `TestBR382_waiter_is_SERVER_BUSY_at_12000_ms_with_zero_requests`,
  `TestBR382_waiting_mutation_is_SERVER_BUSY_with_zero_records`.
- **AC-06** (BR-385) — Abort while waiting. Given a running read and
  waiting calls A, B, C, When B's abort signal fires, Then B returns
  `ACCESS_DENIED` at once with zero requests, and A then C run in that
  order; Given a waiting `mutate` whose signal fires, Then it returns
  `ACCESS_DENIED` with zero records; in both cases no wait timer or abort
  listener of B remains. Verified by:
  `TestBR385_aborted_waiter_leaves_queue_with_zero_requests`,
  `TestBR385_aborted_waiting_mutation_writes_no_record`.
- **AC-07** (BR-386) — Close while waiting. Given a running read whose port
  never answers and 2 waiting calls (one read, one `mutate`), When the
  controller closes, Then both waiting calls return `ACCESS_DENIED` before
  the running read settles, with zero requests and zero records, no call
  takes the slot afterwards, and no wait timer remains. Verified by:
  `TestBR386_close_settles_waiters_with_ACCESS_DENIED`.
- **AC-08** (BR-383) — FIFO. Given a running read and four waiting calls
  of mixed kinds (read, resource read, `mutate`, read) joined in that order,
  When each running invocation settles, Then the slot is taken in join
  order; Given the slot released while a new call arrives in the same tick,
  Then the oldest waiter takes the slot and the new call joins the tail.
  Verified by: `TestBR383_waiters_start_in_join_order`,
  `TestBR383_new_call_never_overtakes_a_waiter`.
- **AC-09** (BR-384) — Waiting is not charged. Given a call that waited
  9,000 ms, When its port answers 9,500 ms after it took the slot, Then it
  succeeds; Given its port never answers, Then it returns
  `REQUEST_TIMEOUT` 10,000 ms after it took the slot (19,000 ms after it
  joined), not before. Given a first invocation that made 512 dependency
  calls, Then the next invocation can make 512 dependency calls and five
  list pages. Verified by:
  `TestBR384_deadline_starts_when_the_slot_is_taken`,
  `TestBR384_budgets_are_fresh_per_invocation`.
- **AC-10** (BR-380) — Both transports. Given the stdio composition driven
  by the real SDK client, When two `kdrive_info` calls are sent without
  waiting, Then both responses are successes; Given the HTTP handler with
  one session, When two `tools/call` POSTs for `kdrive_info` are sent
  concurrently on that session, Then both succeed; Given two HTTP sessions
  each holding a never-answering read, Then a call on the second session is
  queued only behind the second session's read. Verified by:
  `tests/invocation-queue-transports.test.ts`
  (`TestBR380_stdio_parallel_reads_both_succeed`,
  `TestBR380_http_parallel_reads_in_one_session_both_succeed`,
  `TestBR380_http_sessions_have_separate_queues`).
- **AC-11** (BR-387) — Given the repository files, When the content test
  runs, Then README "Key limits" and `docs/mcp-client-compatibility.md`
  `## Parallel tool calls` each name `SERVER_BUSY`, the 4 waiting calls,
  the 12-second wait and the retry guidance, and `CHANGELOG.md`
  `## [Unreleased]` has a `### Fixed` line citing `#16`. Verified by:
  `TestBR387_docs_describe_queue_and_retryable_SERVER_BUSY`.
- **AC-12** (BR-258 v2, BR-070 v2, BR-089, BR-118, BR-284) — Regression.
  Given the tests listed under Scope, updated to observe waiting or a
  queue-full/wait-timeout `SERVER_BUSY`, When `make check` runs, Then they
  pass with every other assertion unchanged (worker termination before
  release, no late publication, 12,000 ms write succeeds and holds the
  slot, one request per upload attempt). Verified by: `make check`, with
  `TestBR258_mutate_waits_while_another_invocation_is_active` replacing
  `TestBR258_mutate_answers_SERVER_BUSY_while_another_invocation_is_active`.

## Decisions

- **D-1 — A bounded FIFO wait queue in front of the single slot.** Chosen
  (orchestrator decision): one short queue per controller, shared by
  `perform` and `mutate`; execution stays one at a time, so writes stay
  serialized, at most one mutation is outstanding, and each invocation keeps
  its own fresh deadline and budgets, which start when it takes the slot.
  Rejected: (a) keep the immediate refusal and only document it, because it
  does not fix the observed client failure: clients send parallel calls and
  the user cannot act on the refusal; (b) true parallel execution, because
  the controller's invocation state (`current`, `boundCode`, pagination
  finish, budgets) is shared per session and the one-outstanding-mutation
  guarantee would need new locking.
- **D-2 — Constants: 4 waiting calls, 12,000 ms maximum wait.** 12,000 ms is
  above the 10,000 ms invocation deadline, so a call queued directly behind
  one read always gets the slot, even when that read runs to its deadline;
  the 2,000 ms margin covers settlement after the deadline (owned worker
  termination, BR-118). An admitted read therefore answers within about
  22 s (12 s wait plus 10 s run), well inside the 60,000 ms default request
  timeout of the MCP TypeScript SDK client. 4 waiting calls cover the
  observed pair and a model's usual batch of a few calls, while bounding
  memory: each waiter holds at most its parsed arguments and one decoded
  upload payload (at most 524,288 bytes, BR-280), so at most about 2 MiB per
  session. Rejected: an unbounded wait or one as long as the gate's 60,000
  ms run deadline (BR-249), because clients time out first and then retry
  into a still-full queue; 10,000 ms, because it ties with the deadline of
  the call ahead; a larger queue, because the tail would mostly hit the
  wait timeout anyway.
- **D-3 — Keep `SERVER_BUSY` as the retryable refusal.** It is already in
  the fixed message set (BR-090) and in the stdio transport's allowed texts;
  it now means "refused before any kDrive request or audit record", so a
  retry is safe for writes too. Rejected: a new code (for example
  `QUEUE_TIMEOUT`), because it adds a client-visible text for the same
  client action.
- **D-4 — Abort or close while waiting give `ACCESS_DENIED`.** This is what
  `perform` and `mutate` return today for an aborted signal or a closed
  controller before any work; MCP cancellation lets the SDK drop that
  response anyway. Rejected: `SERVER_BUSY`, because the call was cancelled,
  not refused for load.
- **D-5 — Strict FIFO hand-off, no overtaking.** The slot passes directly to
  the oldest waiter, so a call arriving as the slot is released cannot
  overtake. Rejected: "first to see a free slot wins", which can starve a
  waiter until its timeout.
- **D-6 — Per-session queue.** Sessions stay independent; process-wide load
  is already bounded by BR-195 and the HTTP session limits. No ADR: the
  change is local to the controller and is reversed by restoring the
  immediate refusal.

## Open questions

## Stress-test

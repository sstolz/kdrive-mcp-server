---
id: F-026
title: Bounded invocation queue
ticket: "#16"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-13; revised
the same day after spec review 1 (reviewed revision `908d6b3`).
Base: branch `claude/beautiful-maxwell-8mdk2w` at `b509c26`. IDs: F-026,
BR-380–BR-388 v1, BR-258 v2, BR-070 v3, BR-118 v2; no ADR. `#16` is this
repository's ticket. The spec stays at version 1: it was never frozen, and
AGENTS.md §2 requires a new version only for a frozen contract.

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

The stdio transport (`src/stdio-transport.ts`, `send`) writes one outbound
frame at a time and closes the whole session with `STDIO_OUTPUT_FAILED` when
a second frame is sent while one is still being written (BR-070 v2 example
"second pending send → close"). Today a refused call answers at once while
the first call runs, so two sends rarely overlap. With a queue they do: the
next call starts as soon as the slot is released and can answer before the
previous response's write callback has fired, and waiters that joined in the
same tick reach their wait timeout in the same timers phase and answer back
to back. The outbound path therefore changes with the queue (BR-388).

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
  `createNavigationServer`, so both transports use this queue; each HTTP
  session has its own queue (BR-380).
- Stdio outbound frames (`src/stdio-transport.ts`, `send`): a bounded FIFO
  of at most 6 frames waiting behind the frame being written replaces the
  "second pending send closes the session" behaviour; overflow still closes
  with `STDIO_OUTPUT_FAILED`; the 1,048,576-byte frame bound and the
  1,000 ms per-frame write bound stay, the latter counted from when that
  frame's write starts (BR-388, BR-070 v3, D-7). The HTTP transport needs no
  outbound change: each response has its own HTTP stream.
- BR-258 v2: `mutate` waits in the shared queue instead of refusing at once.
- Documentation (BR-387): README "Key limits", a new section of
  `docs/mcp-client-compatibility.md`, and one `CHANGELOG.md` line under
  `## [Unreleased]`.
- Existing tests that observe the immediate `SERVER_BUSY` change to observe
  waiting, or reach `SERVER_BUSY` through a full queue or a wait timeout.
  BR-089 v1 and BR-284 v1 keep their rule and examples; BR-070 v3, BR-118
  v2 and BR-258 v2 are versioned under Business rules:
  - BR-070 (v3, see below): `tests/navigation.test.ts` ("BR-070
    never-settling evidence times out and concurrent requests are busy"),
    `tests/navigation-wire-boundaries.test.ts` ("BR-070 actual SDK
    cancellation suppresses a late result and busy response never starts
    protected work") and `tests/navigation-stdio.test.ts:263` ("one pending
    write and a second send close, settle, destroy and remove owned
    listeners"), which becomes the BR-388 overflow test (a seventh waiting
    frame closes). The other BR-070 stdio outbound tests
    (`tests/navigation-stdio.test.ts` "never-draining output times out at
    exactly 1000ms", the write-callback-error and frame-size tests, and
    `tests/navigation-review1.test.ts` R2) send one frame at a time and
    keep passing unchanged.
  - BR-089 v1: `tests/download-retry.test.ts` (`TestBR089_content_lifecycle
    cancel retry wait releases slot without new attempts`).
  - BR-118 v2: `tests/read-boundaries.test.ts` and
    `tests/read-worker-lifecycle.test.ts` (`TestBR118_worker_lifecycle*`).
    The rule text (termination before slot release, no late publication) is
    unchanged, but its example "a pending read and a concurrent info call →
    `SERVER_BUSY`" maps to a test whose observable outcome changes, so the
    record goes to v2 with the example "the info call waits and runs after
    the read settles; a call refused by a full queue gets `SERVER_BUSY`"
    (AGENTS.md §7); v1 stays the active rule until v2 is accepted.
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
  rate limits, the stdio ingress bounds, or the 1,048,576-byte outbound
  frame bound and 1,000 ms per-frame write bound (kept by BR-388).
- Forwarding the HTTP request's abort signal to the invocation (D-8).
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
  AC-10, AC-13.
- **BR-381** — When 4 calls are already waiting, an arriving call returns
  `SERVER_BUSY` at once, with zero kDrive requests and zero audit records,
  and the 4 waiting calls and the running invocation are unaffected.
  Verified by: AC-04.
- **BR-382** — A call still waiting 12,000 ms of monotonic time after it
  joined leaves the queue and returns `SERVER_BUSY`, with zero kDrive
  requests and zero audit records; the calls behind it keep their relative
  order. When the slot is released at the instant the wait reaches
  12,000 ms, whichever of the release and the wait timer runs first, the
  call is refused with `SERVER_BUSY` and the slot goes to the next waiter
  (BR-383). Verified by: AC-05, AC-14.
- **BR-383** — When the slot is released, it is assigned in the same
  synchronous step (before any microtask or timer runs) to the oldest call
  still waiting whose monotonic wait is below 12,000 ms at that moment; a
  waiter at or past 12,000 ms is refused under BR-382 and skipped. Calls
  take the slot in the order they joined, and no invocation (read, resource
  read or gate run) starts until the previous one has settled, so writes
  never overlap any other invocation. In that same step the taker's wait
  timer is cleared and its wait abort listener is replaced by the
  invocation's cancel listener, so no abort can fall between them; the
  taker then re-runs the closed and aborted checks, and if either holds it
  returns `ACCESS_DENIED` with zero kDrive requests and zero audit records
  and the slot passes on in the same way. Verified by: AC-02, AC-03, AC-05,
  AC-08.
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
- **BR-388** — The stdio transport writes outbound frames one at a time in
  the order `send` is called. A `send` called while a frame is being
  written joins a first-in first-out queue of at most 6 waiting frames, and
  its promise resolves once its own frame has been written and drained. A
  `send` that would make a seventh waiting frame closes the session once
  with the fixed diagnostic `STDIO_OUTPUT_FAILED`, and that send, the frame
  being written and every waiting frame reject; nothing is written after
  close. Each frame is serialized and checked against the 1,048,576-byte
  bound when `send` is called (an oversized frame closes the session, as
  today), and each frame's 1,000 ms write bound counts from when that
  frame's write starts, not from when it joined. Verified by: AC-13, AC-14,
  AC-15.
- **BR-070 v3** (same purpose: bounded invocations and bounded stdio
  output) — the v2 rule plus: on stdio, a second outbound frame while one
  is being written waits in the BR-388 queue instead of closing the
  session; only a queue overflow, an oversized frame or a frame not written
  within its 1,000 ms closes it, besides a write error or a serialization
  failure, which still close it as today. Verified by: AC-12, AC-15.
- **BR-118 v2** (rule text unchanged) — its example "a pending read and a
  concurrent info call → `SERVER_BUSY`" becomes "the info call waits and
  runs after the read settles; a call refused by a full queue gets
  `SERVER_BUSY`". Verified by: AC-12.

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
- **AC-05** (BR-382, BR-383, BR-258 v2) — Wait timeout, both sides. Given a gate run past its
  intent append whose mutator answers 200 after 11,999 ms after a read
  joined the queue, Then the read takes the slot and succeeds; Given the
  mutator answering after 12,001 ms, Then the read returns `SERVER_BUSY` at
  12,000 ms with zero requests, and a call that joined behind it is not
  reordered; Given a waiting `mutate` in the read's place, Then it returns
  `SERVER_BUSY` at 12,000 ms with zero records and zero attempts. Given
  the mutator answering exactly 12,000 ms after the read joined, with a
  second read joined behind it, When the release and the read's wait timer
  fall due at the same instant (both orders of the two callbacks), Then the
  first read returns `SERVER_BUSY` with zero requests and the second read
  takes the slot and succeeds. Given a waiter whose signal is aborted in
  the same step as the release, Then it returns `ACCESS_DENIED` with zero
  requests and the next waiter takes the slot. Verified by:
  `TestBR382_waiter_gets_slot_at_11999_ms`,
  `TestBR382_waiter_is_SERVER_BUSY_at_12000_ms_with_zero_requests`,
  `TestBR382_waiting_mutation_is_SERVER_BUSY_with_zero_records`,
  `TestBR382_release_and_timeout_at_the_same_instant_is_SERVER_BUSY`,
  `TestBR383_taker_rechecks_abort_with_zero_requests`.
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
- **AC-12** (BR-258 v2, BR-070 v3, BR-089, BR-118 v2, BR-284) — Regression.
  Given the tests listed under Scope, updated to observe waiting or a
  queue-full/wait-timeout `SERVER_BUSY`, When `make check` runs, Then they
  pass with every other assertion unchanged (worker termination before
  release, no late publication, 12,000 ms write succeeds and holds the
  slot, one request per upload attempt, single-frame stdio write bounds).
  Verified by: `make check`, with
  `TestBR258_mutate_waits_while_another_invocation_is_active` replacing
  `TestBR258_mutate_answers_SERVER_BUSY_while_another_invocation_is_active`.
- **AC-13** (BR-380, BR-388) — Stdio parallel reads with a synchronously
  answering port. Given the stdio composition over the owned stdio
  transport, a port whose `kdrive_info` answer is an already-resolved
  promise, and a stdout whose write callbacks fire 5 ms after each write,
  When two `kdrive_info` requests arrive in one input chunk, Then both
  responses are successes written in the order they were produced, no
  `STDIO_OUTPUT_FAILED` diagnostic is written, and a third request
  afterwards succeeds on the same session. Verified by:
  `tests/invocation-queue-transports.test.ts`
  (`TestBR388_stdio_parallel_reads_with_synchronous_port_keep_session_open`).
- **AC-14** (BR-382, BR-388) — Two stdio waiters time out in the same tick.
  Given mode `write`, the stdio composition, and a `kdrive_rename` past its
  intent append whose mutator answers 200 after 20,000 ms, When two
  `kdrive_info` requests arrive in one input chunk at 1,000 ms, Then at
  13,000 ms both get `SERVER_BUSY` with zero requests, no
  `STDIO_OUTPUT_FAILED` diagnostic is written, and at 20,000 ms the rename
  answers `succeeded` on the still-open session. Verified by:
  `tests/invocation-queue-transports.test.ts`
  (`TestBR382_TestBR388_two_stdio_waiters_time_out_together_session_stays_open`).
- **AC-15** (BR-388, BR-070 v3) — Outbound queue bounds. Given the owned
  stdio transport and a stdout whose write callbacks never fire, When 7
  frames are sent, Then the session stays open (1 writing, 6 waiting);
  When an eighth frame is sent, Then the diagnostic `STDIO_OUTPUT_FAILED`
  is written once, all 8 sends reject, stdout is destroyed and no drain
  listener or timer remains. Given a stdout that completes each write 1 ms
  later, When 7 frames are sent, Then they are written in send order and all
  resolve. Given a first frame drained at 900 ms, When the second frame
  drains 999 ms after its own write started (1,899 ms), Then both resolve;
  When it drains 1,000 ms after its write started, Then the session closes
  with `STDIO_OUTPUT_FAILED`. Verified by: `tests/navigation-stdio.test.ts`
  (`TestBR388_seventh_waiting_frame_is_admitted_eighth_closes`,
  `TestBR388_frames_are_written_in_send_order`,
  `TestBR388_write_bound_counts_from_write_start`).

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
  memory. Each waiter can hold its raw JSON-RPC frame, the base64 (or
  text) argument string parsed from it, and the decoded upload payload
  (BR-280, at most 524,288 bytes). On stdio a frame is at most 1,048,576
  bytes, so a waiter holds at most about 1 + 1 + 0.5 = 2.5 MiB and the 4
  waiters of a session about 10 MiB, plus at most 7 outbound frames of
  1 MiB in the BR-388 queue. Over HTTP the body is at most `MCP_BODY_LIMIT`
  = 262,144 bytes (`src/http/limits.ts`), so a waiter holds at most about
  256 + 256 + 192 KiB = 704 KiB, a session about 2.75 MiB, and the
  `SESSIONS_TOTAL` = 64 sessions of the process about 176 MiB. A refused
  fifth upload is fully decoded before `mutate` refuses it
  (`src/navigation.ts` `invokeMutation` decodes, then calls `mutate`); this
  order predates the ticket and is unchanged, and the decoded payload is
  released when the refusal returns. Rejected: an unbounded wait or one as long as the gate's 60,000
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
- **D-7 — Stdio outbound FIFO of 6 waiting frames (BR-388).** Chosen:
  frames wait in send order behind the frame being written; the cap is
  `MAX_WAITING + 2` = 6. A session has at most 1 running and 4 waiting
  invocations, so a burst of parallel calls produces at most 5 invocation
  responses (4 waiting frames behind the one being written); the 2 extra places
  cover frames produced at once without an invocation (a `SERVER_BUSY`
  refusal of a fifth call, a parse or invalid-request error, a `ping` or
  `tools/list` answer). At most 7 frames of at most 1 MiB are held. The
  1,000 ms bound counts from each frame's write start so a frame is not
  charged for the frames ahead of it; a stalled stdout still closes the
  session within 1,000 ms of the first frame's write start. Accepted
  residual: a peer that sends more than about 7 requests answered in the
  same tick (for example 12 parallel calls, whose refusals answer at once)
  while stdout is not drained, or that keeps pipelining requests while not
  draining stdout, gets the session closed; today the second frame closes
  it. Rejected: (a) keep closing on the second pending send,
  because the queue makes overlapping responses normal and the session
  would die (review 1, finding 1); (b) an unbounded queue, because a
  non-reading peer would grow memory without limit; (c) serializing
  responses inside the controller, because SDK responses to `ping`,
  `tools/list` and parse errors bypass the controller.
- **D-8 — The HTTP request's abort signal is not forwarded (accepted
  residual risk).** `sdkRequest` (`src/http/handler.ts`) builds the request
  the SDK sees without the original request's signal, so a client that
  disconnects does not abort its invocation. With the queue, a queued call
  (writes included) from a disconnected HTTP client still runs up to 12 s
  later unless `notifications/cancelled` or session close removes it. A
  mutation can take the 12 s wait plus the 60 s BR-249 gate run deadline,
  beyond the 60,000 ms default request timeout of the SDK client; the gate
  deadline part predates this ticket. Accepted because: the run is bounded
  (12 s wait, then the existing deadlines), it is audited like any gate run,
  a disconnected client has the audit outcome as authority (BR-258), and
  forwarding the signal changes the BR-166 request-construction contract
  and the cancellation semantics of every HTTP call, which belongs in its
  own ticket (BACKLOG.md, 2026-11-13).

## Open questions

## Stress-test

Spec review 1 (`16-spec-review-1-reviewer`, revision `908d6b3`, verdict
changes):

1. **critical, retained** — a queue makes two stdio responses overlap and
   the stdio transport closes the session on a second pending send. Fixed by
   bringing the stdio outbound path into scope: BR-388 (FIFO of 6 waiting
   frames, overflow closes, 1 MiB and per-frame 1,000 ms bounds kept, the
   latter from write start), BR-070 v3, D-7, AC-13–AC-15; the "no
   transport-specific code" and out-of-scope claims are removed, and
   `tests/navigation-stdio.test.ts:263` is listed under Scope.
2. **minor, retained** — the hand-off was underspecified. BR-383 now states
   synchronous assignment at release, the taker's closed/aborted re-check
   (`ACCESS_DENIED`, zero requests), the listener replacement with no gap,
   and BR-382 defines the release-versus-timeout tie (refused with
   `SERVER_BUSY`, slot to the next waiter); AC-05 covers both.
3. **minor, retained as a recorded residual risk; the alternative is
   rejected** — the HTTP request signal is not forwarded and a mutation can
   exceed the SDK client's 60 s default. D-8 records both facts and accepts
   them; forwarding the signal is out of scope (BACKLOG.md line) because it
   changes the BR-166 request contract and cancellation for every HTTP call.
4. **minor, retained** — the memory figure left out the raw frame and the
   base64 string. D-2 restates it from `MCP_BODY_LIMIT` (262,144),
   `SESSIONS_TOTAL` (64) and the 1 MiB stdio frame, and notes that a refused
   fifth upload is decoded before refusal (pre-existing order, unchanged).
   Rejected: decoding only after the call takes the slot, because it moves
   the BR-280 encoding check after `mutate` and changes a frozen order for
   a transient allocation.
5. **minor, retained** — BR-118's example changed without a version bump.
   BR-118 goes to v2 (rule text unchanged, example changed, History line);
   v1 stays the active rule until acceptance.

Review 2 (`16-spec-review-2-reviewer`, revision 01dc831): `approve` with
three minor findings, all retained and applied editorially by the
orchestrator before freeze:

1. **minor, retained** — BR-070 v3 and its F-026 entry omitted the write
   error and serialization failure that still close the stdio session;
   both now say so.
2. **minor, retained** — the sentence on existing tests said no rule text
   changes; it now names BR-089 v1 and BR-284 v1 as unchanged and BR-070
   v3, BR-118 v2 and BR-258 v2 as versioned.
3. **minor, retained** — "at most 5 invocation responses pending" was not
   structural; D-7 and BR-388 now bound a burst of parallel calls, and the
   D-7 residual includes a peer that keeps pipelining while not draining
   stdout.

---
id: F-054
title: Close process and stdio lifecycle gaps
ticket: "#139"
status: frozen
version: 1
---

## Context

This ticket is **security-sensitive**: shutdown must drain dispatched mutations,
process exit must report close failures, and the stdio sanitizer must not echo
unvalidated bytes. It affects operators of dedicated HTTP/stdio processes and
hosts using owned stdio streams.

The inspected composition has four gaps:

1. F-016 AC-21 promises an outcome before stdio exit for a mutator settling
   after 3,000 ms and shutdown by EOF or SIGTERM. The original stdio test uses
   EOF and a manually released mutator. That test does not prove the dedicated
   signal path or the `main` owned-signal path.
2. HTTP's `void close().then(exit0)` has no rejection handler. Both the owned
   stdio stop in `src/main.ts` and the dedicated signal in `src/stdio.ts` also
   discard a close promise, as do the transport EOF, failure and SDK-close
   callbacks. `src/http/server.ts` can propagate a rejected
   handler close. The gate's production close, by contrast, is specified to
   resolve even on sink failure (BR-254 v2).
3. `src/stdio-transport.ts` validates parsed gate error JSON through
   `isGateErrorText` but emits the original string. Earlier duplicate-key
   values can therefore survive on the wire although JSON.parse discarded them.
4. Extraction admission and the default stdio diagnostic write to process
   stderr. A write callback and synchronous catch do not contain its asynchronous
   `error` event. Extraction diagnostics can occur after the session closes.
   The same gap affects pending process stdout writes after transport close:
   `close()` removes its output error listener, but destroying process.stdout
   does not destroy it. An asynchronous EPIPE can then terminate the process
   before the committed mutation gate drains.

[Node process observations](../docs/observations/node-process.md) records the
supplied Node v26.13.0 measurements, not new measurements by this author.
The supplied pending-write-after-destroy stdout probe reproduces this failure
in three of three runs; the orchestrator extended this draft's scope after
that measurement.

## Scope

- Complete the F-016 AC-21 SIGTERM coverage with a 3,000 ms virtual mutator.
- Handle close rejection in HTTP signal shutdown and both stdio compositions,
  including transport EOF, failure and SDK-close callbacks, with a fixed failure
  diagnostic and the appropriate failure status. Bound the stdio server-close
  wait by the existing shutdown deadline.
- Emit re-serialized validated gate error JSON at the stdio output boundary,
  requiring finite numeric `attempts` and optional `status`.
- Give process stderr and process stdout one permanent process-owned error
  listener each, including diagnostic and pending protocol writes after session
  closure, without replacing audit failure handling or in-session transport
  failure detection. Contain post-close stdout failures throughout gate drain
  and preserve their failure status through exit flushing.
- Record the supplied runtime measurements in `docs/observations/node-process.md`.

### Out of scope

No new shutdown allowance, retry, mutation classification, audit schema,
transport queue policy, extraction admission limit, configuration option or
public error payload. No redesign of HTTP close steps (BR-169 v4), gate drain,
or the existing operating-system teardown limitations. This spec-authoring
deliverable creates no BR files, tests, code or acceptance markers.

Stdin `error` after transport close is an accepted residual: it is unmeasured
and unlikely on pipes; any stdin failure before close is already handled by
the transport.

## Business rules

Proposed versions: BR-069 v3, BR-210 v2, BR-254 v3 and BR-262 v2 retain their existing
purposes and IDs. Only the deltas below are new; inherited clauses remain.
BR-447–BR-448 v1 are new allocations. Recheck IDs on main before freeze and PR.

- **BR-254 (unchanged drain coverage, F-016 AC-21)** — Dedicated stdio shutdown by
  SIGTERM records the outcome of a run past intent before process exit.
  Verified by: AC-01.
- **BR-254 (unchanged owned drain coverage, F-016 AC-21)** — Owned stdio
  shutdown by SIGTERM settles closure only after the in-flight committed run's outcome is recorded.
  Verified by: AC-02.
- **BR-210 v2** — An HTTP signal stop requests exit 0 only after transport and
  gate close both fulfill, and requests exit 1 if either rejects.
  Verified by: AC-03.
- **BR-254 v3 (stdio failure status)** — A rejected stdio close, including
  signal, EOF, transport-failure, SDK-close, start-failure and host-invoked
  paths, selects failure status 1
  through the dedicated exit port or the owned host's non-terminating status
  setter, respectively, without an unhandled rejection. Dedicated exit and
  owned `closed` wait for gate close and for server close to settle or reach
  the existing shutdown deadline; server-close expiry is a close failure. This
  holds even when transport `onclose` starts gate cleanup first. No new
  allowance extends the existing 1,000 ms no-committed-run or 45,000 ms gate
  bound. Session `close()` and `ready` never reject after a consumed close
  failure; status 1 is selected through the same shutdown result owner.
  Server-close rejection or expiry starts cleanup if it has not started,
  re-evaluating `hasCommitted` before exit. Verified by: AC-04.
- **BR-254 v3 (close diagnostic)** — Each HTTP signal shutdown or stdio
  shutdown whose server/transport or gate close rejects or reaches the deadline offers exactly
  one `PROCESS_CLOSE_FAILED\n` diagnostic without any rejection payload.
  Verified by: AC-03, AC-04.
- **BR-262 v2** — The gate error parsed-object validator requires
  `Number.isFinite` for required `attempts` and optional `status`.
  Verified by: AC-05.
- **BR-069 v3** — At the stdio output boundary, gate error text that passes
  that validator is emitted as JSON.stringify of the validated object rather
  than as the original input text. Verified by: AC-05.
- **BR-447 v1** — Built-in use of process stderr and process stdout shares one
  idempotently installed process-owned error listener per stream, installed
  before its first built-in write and never removed by a session close.
  `productionDependencies()` in `src/production.ts` installs both owners before
  returning dependencies to `main`, covering every `deps.stderr` write in both
  transports, including HTTP logger events.
  Verified by: AC-06, AC-07, AC-09, AC-10.
- **BR-448 v1** — The process stream owner contains stderr EPIPE `error` events as
  unavailable diagnostic delivery without changing the exit code. Every other
  stderr `error` event latches process failure, whatever its origin, including
  empty flush writes. The stdout latch is driven only by a protocol frame whose
  write callback reports an error, issued by the stdio transport, including
  callbacks after transport close. Stdout `error` events are only contained,
  never latch; empty stdout flush writes and HTTP stdout never latch. No error
  payload is logged or retained. Verified by: AC-06, AC-07, AC-08, AC-09, AC-10.
- **BR-254 v3 (failure precedence)** — A close failure, unexpected stderr
  failure or stdio protocol-frame stdout failure observed before the exit
  primitive runs prevents a later success request or flush completion from selecting exit 0, without
  interrupting committed mutation drain. Verified by: AC-03, AC-04, AC-08,
  AC-09, AC-10. Owned closure considers only that session's own close outcome
  for its status setter; owned closure calls the setter only with 1, never
  with 0, selecting status 1 once per session regardless of the number of
  failure sources. Process-level stream latches affect only dedicated
  process exit, never a later owned session's status.

BR-169 v4, BR-070 v5 and BR-426 v1 remain dependencies, not new versions:
HTTP server close ordering, stdio budgets and best-effort extraction diagnostic
delivery retain their purposes and behavior. BR-069 is currently v2; proposed
v3 adds the stdio-boundary reserialization clause while retaining its sanitized
channels and audit-record exception. BR-262 v2 narrows numeric validation; it
preserves its single mutate call, single text item, result fields and `isError`
classification. Its persisted BR version is currently v1; v2 is the proposed
version, not an additional draft-version bump.

Every BR-254 v2 clause is retained or replaced as follows:

| v2 clause | v3 disposition |
| --- | --- |
| Refuse new runs; drain bounded outcomes/append failures; close sink; production gate close always resolves, including sink/release failures | Kept; defensive rejection handling does not change the production gate contract. |
| Sink close's shared 5,000 ms drain/release budget; expiry latches, rejects outstanding appends and resolves without claiming flush | Kept. |
| Release only after underlying write/fdatasync settles with no operation in flight, within remaining budget; skip release at expiry and retain fd until exit even after late settlement | Kept. |
| No write/sync after latching; repeated close shares completion/deadline and never releases twice; queued unwritten appends reject without I/O | Kept. |
| Guarded gate close bound 45,000 ms; pre-intent guard 10,000 ms and no commit after close | Kept. |
| No-committed-run stdio's remaining 1,000 ms also shortens non-committed appends, then sink close, without a fresh allowance | Kept. |
| Transport → gate → dedicated exit; HTTP in-flight 503 remains independent of audit outcome | Kept; stdio exit/owned closure additionally waits for server close to settle or reach the existing shutdown deadline; expiry selects close failure, and any later rejection is consumed. |
| Dedicated stdio uses shared production helper via `deps.exit`, separately from owned status setter; owned/library never terminates host, including transport failure | Kept. |
| `exit(code, shutdownDeadline?)` uses absolute monotonic time; HTTP, non-shutdown and committed-run shutdown omit deadline | Kept. |
| First call fixes code/deadline; repeated calls cannot reset code/deadline | Replaced only for code: observed close failure, unexpected stderr failure or stdio protocol-frame stdout failure upgrades success to 1 before primitive exit; later success cannot downgrade 1. First deadline remains fixed. |
| Set requested `process.exitCode`; arm ref'd timer before either empty stdout/stderr write behind queued output | Kept, with effective code upgraded to 1 on the qualifying failures above. |
| Both stream completions race 250 ms from helper entry, capped at `max(0, min(250, shutdownDeadline - now()))` when supplied; exhausted budget exits immediately | Kept. |
| Destroyed streams, error callbacks and synchronous write throws count as completion; flush errors never throw, emit unhandled errors or change code | Replaced only for non-EPIPE stderr `error` events: these latch failure even during empty flushing. Flush callback errors and synchronous throws remain completion-only; stdout `error` events and stderr EPIPE `error` events are contained without changing code. A distinct qualifying protocol-frame callback failure can upgrade code during this wait. |
| Exactly one primitive exit; clear timer when streams win; ignore late callbacks/errors safely; repeated calls never write again | Kept. Failures observed before primitive exit can upgrade code; no post-exit observation is promised. |
| Dedicated STDIO_OUTPUT_FAILED/STDIO_START_FAILED preserve 1; non-shutdown callers retain codes and 250 ms cap | Kept, subject to the explicit failure-upgrade rule above. HTTP stdout never latches. |
| Queued output may be lost at cap or shorter stdio remainder | Kept. |
| Sink/gate never waits for diagnostic callback/stderr drain; shared stderr never ended/destroyed | Kept. |
| Synchronous fd 2 blockage prevents timers; libuv write/fdatasync stalls can hold teardown and retained fd release after primitive exit | Kept, documented and unbounded. |

## Acceptance criteria

All names below are planned tests, not claims of execution. Use synthetic
ports/data only; annotate each test with its BR and version. Run the relevant
files and then Docker/Make `make check` during implementation, not authoring.

- **AC-01** (unchanged BR-254, F-016 AC-21) — Given the real dedicated `main` → stdio composition
  (no `protocol` override), a synthetic file audit sink and a mutator whose
  successful HTTP 200 settlement is scheduled 3,000 virtual ms after dispatch,
  When SIGTERM reaches the installed process signal handler after intent and
  before settlement, Then at virtual 1,000 and 2,999 ms exit has not been
  requested, and at 3,000 ms the ordered trace is mutator success → successful
  outcome append → sink close → exit 0, with one attempt and one outcome.
  Verified by: `TestBR254_unchanged_F016_AC21_AC01_dedicated_SIGTERM_drains_3000ms_mutation`
  in `tests/mutation-composition.test.ts`.
- **AC-02** (unchanged BR-254, F-016 AC-21) — Given the same committed virtual mutator through
  `main` via the `runMain` test seam with owned protocol streams and an
  observable status setter,
  When its injected signal source emits SIGTERM, Then closure remains pending
  at 1,000 and 2,999 ms and settles only after outcome append and sink close at
  3,000 ms, with no call to the terminating exit port.
  Verified by: `TestBR254_unchanged_F016_AC21_AC02_owned_SIGTERM_drains_3000ms_mutation`
  in `tests/mutation-composition.test.ts`.
- **AC-03** (BR-210 v2, BR-254 v3) — Given HTTP close ports that respectively
  fulfill, reject transport close, or defensively reject gate close with a
  canary-bearing Error, When SIGINT or SIGTERM starts shutdown (including a
  repeat while pending), Then gate drain is attempted after transport close,
  exit is requested once with 0 only in the successful row and 1 in each
  rejected row, failed rows offer exactly `PROCESS_CLOSE_FAILED\n`, signal
  handlers are removed, and no rejection or canary/stack reaches stderr or
  stdout; a synchronous diagnostic throw cannot prevent exit 1.
  Verified by: `TestBR210_v2_AC03_signal_close_failure_is_fixed_exit1`
  in `tests/http/cli-http.test.ts`.
- **AC-04** (BR-254 v3) — Given dedicated and owned stdio compositions whose
  server close rejects, and a separate defensive gate-close rejection row,
  When SIGINT or SIGTERM starts closure, Then rejection is consumed, cleanup
  settles rather than hanging, the fixed failure diagnostic is offered once,
  and dedicated exit is 1 while owned closure reports 1 only through its
  setter; repeat signals cannot produce exit 0 or duplicate failure handling.
  In the owned transport-failure row followed by a rejecting close, expected
  setter calls are `[1]`: status 1 is selected once per session regardless of
  the number of failure sources.
  A throwing diagnostic does not suppress the failure status, and stdout
  contains neither diagnostic nor error payload. Include a row in both
  compositions where gate close resolves first while server close remains
  pending, then server close rejects: neither dedicated exit nor owned
  `closed` settles early, and final status is 1. Add an owned-session row where
  a process-level stderr failure latched earlier and a later owned session
  closes cleanly: that session's setter is not called (calls equal `[]`),
  without terminating its host. Add dedicated and owned rows with a
  never-settling server close: with no committed run, gate/sink drain completes
  before the existing 1,000 ms deadline, closure stays pending until that
  deadline, then dedicated exit is requested with 1 or owned closure settles
  with setter 1, offering exactly `PROCESS_CLOSE_FAILED\n`. A committed-run
  row uses the existing 45,000 ms gate deadline, counted from the gate close
  call, without a fresh allowance;
  gate/sink drain completes before exit 1 at that deadline. Consume a server
  rejection arriving after expiry without another diagnostic/status request.
  Add dedicated and owned variants where server close rejects or expires
  without invoking transport `onclose`: cleanup starts if it has not started,
  re-evaluates `hasCommitted` to choose the existing bound, and gate/sink drain
  completes before exit or owned `closed`.
  Also exercise each `src/stdio-transport.ts` EOF, failure and SDK-close
  `void close()` site with a rejecting `sdk.close()` in both compositions:
  consume the rejection, select status 1, and finish gate/sink drain before
  exit or owned `closed`, with no unhandled rejection or canary disclosure.
  Add a start-failure row with a rejecting `sdk.close()` in both compositions:
  session `ready` and `close()` fulfill after the close failure is consumed,
  status 1 is selected through the same result owner, and gate/sink drain
  completes before exit or owned `closed`, without an unhandled rejection or
  canary/stack disclosure. Exercise host-invoked session `close()` with the
  same rejecting close and fulfillment/status expectations.
  The EOF row uses the F-016 AC-21 committed mutator settling successfully
  at 3,000 virtual ms: reject `sdk.close()` during gate drain, verify no exit
  at 1,000 or 2,999 ms, then outcome append → sink close → exit 1 (or owned
  setter 1 and `closed`) at 3,000 ms. Each shutdown whose server/transport close
  rejects or reaches the deadline offers the fixed close-failure diagnostic
  once, even when the transport already reported
  its separate fixed failure diagnostic.
  Verified by: `TestBR254_v3_AC04_stdio_signal_close_rejection_is_contained`
  in `tests/mutation-composition.test.ts`.
- **AC-05** (BR-069 v3, BR-262 v2) — Given the actual owned transport's send boundary and
  error text `{"result":"private-canary","result":"denied","attempts":0}`,
  When the frame is written, Then its one text item is exactly
  `{"result":"denied","attempts":0}`, without the canary or duplicate key.
  Valid failed/uncertain/denied objects preserve their parsed fields; invalid
  JSON, forbidden keys, invalid field types and invalid fixed messages become
  `INVALID_ARGUMENTS`. Include `{"result":"denied","attempts":1e400}`
  and `{"result":"failed","attempts":0,"status":1e400}` rows: both become
  `INVALID_ARGUMENTS` because the parsed numeric field is non-finite. Finite
  numeric fields retain their validation behavior; existing allowed plain
  tool errors and successful tool envelopes retain their behavior. Verified by:
  `TestBR069_v3_TestBR262_v2_AC05_stdio_emits_only_validated_gate_JSON`
  in `tests/navigation-wire-boundaries.test.ts`, with existing
  `TestBR262_*` coverage retained in `tests/mutation-tools.test.ts`.
- **AC-06** (BR-447 v1, BR-448 v1) — Given an isolated process stderr double,
  When repeated installation, stdio diagnostics and extraction detach/release
  diagnostics occur across two sessions and after closure, Then exactly one
  owner error listener remains, later asynchronous EPIPE events are contained,
  delivery is not retried or awaited, and extraction release/results and
  existing audit error listeners still work. Include HTTP-mode `main` with
  production-style dependencies that install both owners before entry: a
  broken stderr reader causes an observed EPIPE on a `deps.stderr` write
  (including an HTTP logger event), no crash, and subsequent SIGTERM exits 0.
  Any non-EPIPE stderr `error` event, including one from an empty flush write,
  latches process failure 1 without keeping/logging its message, stack or other
  properties.
  Verified by: `TestBR447_TestBR448_AC06_permanent_stderr_owner`
  in new `tests/process-stderr.test.ts`, and
  `TestBR447_AC06_extraction_diagnostic_after_session_close`
  in `tests/extraction-admission.test.ts`, plus
  `TestBR447_TestBR448_AC06_HTTP_closed_stderr_SIGTERM_exit0`
  in `tests/http/cli-http.test.ts`.
- **AC-07** (BR-447 v1, BR-448 v1) — Given a child using the built-in lazy
  stderr writer and a parent that destroys the stderr pipe reader before
  acknowledging readiness over IPC, When the child attempts two writes,
  including one after session closure, Then it observes EPIPE through each
  write callback or an owner test counter before sending that write's IPC
  acknowledgment, reaches both acknowledgments and exits 0 with neither
  uncaught error nor unhandled rejection. Verified by: `TestBR447_TestBR448_AC07_closed_stderr_pipe`
  in `tests/process-stderr.test.ts`. IPC ordering, not wall-clock sleep,
  establishes reader closure; a bounded watchdog only detects a stuck test.
- **AC-08** (BR-254 v3, BR-448 v1) — Given the real production exit helper
  with controlled streams and exit primitive, When a latched close/unexpected
  stderr failure or a stdio protocol-frame stdout failure (including EPIPE)
  precedes a success request or arrives during its flush wait, Then the primitive receives 1
  exactly once; stderr EPIPE alone does not convert a successful
  diagnostic-only shutdown to failure, an already selected failure stays 1,
  and the 250 ms cap and any shorter remaining deadline are unchanged.
  Additional rows: dedicated stdio EOF shutdown with stdout reader closed
  and no pending protocol frame exits 0 even if the helper's empty stdout flush write errors;
  HTTP shutdown with a stdout error exits 0 absent another failure. Empty
  flush callback errors and synchronous throws count as stream completion
  without changing the code in either mode. Stdout `error` events never latch;
  stderr EPIPE `error` events are contained without changing code, while
  non-EPIPE stderr `error` events latch failure even from an empty flush write.
  Verified by: `TestBR254_v3_TestBR448_AC08_failure_survives_exit_flush`
  in `tests/cli.test.ts`, retaining F-039 AC-12 success/failure/late-event rows
  except the row "contain subsequent error events without changing code",
  amended for non-EPIPE stderr errors before primitive exit: code 0 becomes 1
  and code 1 stays 1. EPIPE, stdout and post-exit rows stay unchanged.
- **AC-09** (BR-254 v3, BR-447 v1, BR-448 v1) — Given the dedicated stdio
  composition, the real transport and gate, a process stdout double retaining
  a pending 256 KiB frame (including its newline, below byteLimit 1,048,576)
  from the named synthetic tool `synthetic_large_result` (a test fixture
  registered only in the AC-09 test composition and the AC-10 child fixture,
  never in a production tool list) through destroy(),
  and a committed 3,000 virtual ms mutator with a healthy synthetic file audit
  sink, When SIGTERM closes the transport before the frame's 1,000 ms write
  bound expires and, during gate drain, the pending write callback receives EPIPE
  and the stream emits its asynchronous EPIPE error, Then no uncaught error or
  unhandled rejection occurs, the process remains up with exit unrequested at
  1,000 and 2,999 ms, and at 3,000 ms mutation success → successful outcome
  append → sink close → exactly one exit 1 occur in order. Repeated owner
  installation across two sessions leaves exactly one owner listener after
  both close; the transport listener may be removed independently. Repeat with
  a non-EPIPE stdout error and an already selected close failure: failure
  remains 1, without error payloads or protocol retries. In every row stderr
  contains no `STDIO_OUTPUT_FAILED`, excluding the existing per-frame timeout
  or transport failure path as the source of exit 1. Verified by:
  `TestBR254_v3_TestBR447_TestBR448_AC09_stdout_failure_during_drain`
  in `tests/mutation-composition.test.ts`.
- **AC-10** (BR-254 v3, BR-447 v1, BR-448 v1) — Given a child running the
  dedicated stdio composition with real process.stdout, a parent pausing its
  pipe reader, a pending 256 KiB frame (including its newline, below byteLimit
  1,048,576) from the named synthetic tool `synthetic_large_result`
  (write returned false and writableLength is positive),
  and a committed mutator held at a synthetic upstream response barrier with a
  healthy file audit sink, the child acknowledging over IPC right after that
  write() returns false (assert this and positive writableLength before
  acknowledging; fail loudly otherwise), When the parent sends SIGTERM as soon as that
  acknowledgment arrives, before the frame's 1,000 ms write bound expires, to initiate
  transport closure, the child acknowledges transport closure and pending gate
  drain over IPC and the parent then destroys the reader, Then the child
  acknowledges the contained
  EPIPE while still draining and before exit. After the parent releases the
  mutator, its successful outcome is recorded and the sink closes before the
  actual child exits 1, with neither uncaught error nor unhandled rejection
  and no `STDIO_OUTPUT_FAILED` on stderr, excluding the existing per-frame
  timeout or transport failure path as the source of exit 1. Add a healthy
  slow-client row with the same pending write and transport-close barriers:
  the parent resumes its reader instead of destroying it, receives all
  262144 frame bytes, and the write callback reports no error. The parent
  releases the mutator only after it has received all 262144 bytes and the
  child's IPC milestone "write callback, no error". No stdout
  failure latches; after mutator release, outcome append and sink close
  precede actual exit 0, without uncaught error or unhandled rejection.
  The 262144-byte frame includes the JSON-RPC envelope and newline: use a
  successful response with numeric id 1, one text item and ASCII padding.
  Use `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":""}]}}`
  as the empty-text envelope: 74 bytes including newline, so 262070 ASCII text
  bytes produce exactly 262144 bytes, below byteLimit 1048576. Assert the
  encoded size. The supplied pending-threshold measurement is setup-dependent,
  not a pipe-capacity guarantee; the write-return assertion is mandatory.
  Verify ordered IPC milestones and the synthetic audit record; IPC barriers,
  not sleeps, establish pending write, transport close, EPIPE and release order.
  A bounded watchdog detects a stuck test. A `STDIO_OUTPUT_FAILED` on stderr is
  reported as a harness timing failure, never as a pass. Verified by:
  `TestBR254_v3_TestBR447_TestBR448_AC10_pending_stdout_pipe_drain`
  in `tests/mutation-composition.test.ts`.

## Decisions

1. **Deterministic mutation proof.** Use fake timers for the actual 3,000 ms
   mutator timer after an explicit dispatch/intent barrier, with async timer
   advancement and microtask draining. Observe outcome append, sink close and
   exit in one ordered trace. Reuse the existing F-039 dedicated process-port
   harness and `runMain` owned seam; extend only their necessary test ports.
   Do not mock away the signal handler, transport close or real gate. Reject
   real 3,000 ms sleeps and a release-only proof: the former is slow/flaky,
   the latter alone misses the specified elapsed-time and signal composition.
2. **One shutdown result owner per composition.** Attach explicit fulfillment
   and rejection handling to every signal-started close, start-failure close
   and host-invoked session close, including the cleanup
   gate promise in stdio, and to the EOF, failure and SDK-close `void close()`
   sites in `src/stdio-transport.ts` (currently around lines 111, 150 and 315).
   Those transport paths consume a rejected `sdk.close()` and select failure
   status 1 without an unhandled rejection, including during EOF gate drain.
   Session `close()` and `ready` never reject after a consumed close failure;
   status 1 goes through the same shutdown result owner.
   Settle cleanup and remove signal handlers in a finally
   path, keeping handlers installed during committed mutation drain. A server
   close rejection still attempts gate drain before reporting failure. Both
   stdio closes are observed before dedicated exit or owned `closed`, including
   when synchronous transport `onclose` starts gate cleanup first: gate close
   keeps its existing bound, and server close races the same existing absolute
   shutdown deadline (1,000 ms without a committed run, otherwise the existing
   45,000 ms gate bound counted from the gate close call; the choice is made
   when cleanup evaluates `hasCommitted`). Do not start another allowance for server close.
   Server-close expiry counts as close failure with status 1 and the fixed
   diagnostic, while gate/sink drain still completes before exit/owned `closed`.
   Server-close rejection or expiry starts cleanup if it has not started,
   re-evaluating `hasCommitted` to choose the existing bound before exit.
   Keep a rejection handler attached to server close after expiry. Dedicated
   modes use `deps.exit(1)` (stdio's injected exit port); owned modes use their
   setter only with 1, never with 0, selecting 1 once per session regardless of
   the number of failure sources, and never terminate the host. Repeated
   signals join the same result.
   Reject fire-and-forget promises and an unconditional final exit 0: both lose
   the explicit failure contract. `PROCESS_CLOSE_FAILED\n` is the sole new
   fixed diagnostic; reporting it is best effort and cannot replace status 1.
3. **Install process stream ownership lazily before built-in writes.** A
   shared process module exposes an owner factory over an injectable stream,
   with failure state scoped to that owner. A `WeakMap` keyed by stream object
   identity resolves shared owners at call time through the `process.stdout`
   and `process.stderr` getters, reused by writers, stdio and exit helpers.
   Fresh stream objects in each test row therefore get fresh owners/latches;
   reject module-level stream singletons, which bypass getter spies and leak
   state across test rows. `productionDependencies()` installs both owners
   before returning to `main`, including HTTP mode's `deps.stderr` and logger writes;
   importing modules alone does not attach listeners. Extraction admission,
   default stdio diagnostics and production stderr use that same owner before
   writing. Built-in protocol use of process.stdout installs its owner before
   transport writes, and production flushes ensure ownership of both streams.
   Installation is idempotent per stream for the process lifetime, including
   repeated sessions and exit-helper creation. Reject installation only in
   the `main` entry (`runMain` is only a test seam): embedded/default writers
   can run without that entry and detached extraction outlives sessions. The owner never removes itself,
   ends/destroys either stream, retries, recursively logs, or throws from its
   error handler. Injected owned streams retain their transport ownership;
   they do not acquire process-lifetime listeners. Existing transport listeners
   may remain for in-session failure detection; their removal cannot remove
   process ownership. Existing audit listeners still classify/latch audit
   failures independently, including EPIPE.
   Accepted consequence for embedded hosts: the first built-in stderr write
   installs a permanent listener that also contains the host's own non-EPIPE
   stderr errors and latches process failure; no owned session reads that latch.
4. **Share ownership with exit flushing and preserve failure status.** The
   production helper uses the permanent owners for both stdout and stderr,
   rather than installing another process-level error listener per helper.
   Flush completion can subscribe to the owners without owning/removing their
   stream listeners. Stderr EPIPE `error` events are contained as unavailable
   diagnostic delivery and leave an otherwise successful exit at 0. Any other
   stderr `error` event latches process failure, whatever its origin, including
   an empty flush write. Flush callback errors and synchronous throws count as
   completion without changing code; stdout `error` events are only contained
   and never latch. Only a protocol frame whose write callback reports an error,
   issued by the stdio transport, drives the stdout latch, including callbacks
   after close. Change the callback's early return at `src/stdio-transport.ts:235`:
   notify, before the `settled || closed` guard, the owner registered in the
   owner `WeakMap` for the transport's own `output` stream identity (never
   resolved through the `process.stdout` getter; a no-op for injected owned
   streams, which have no registered owner), then retain the guard for transport settlement/failure handling.
   Reject routing all frames through the owner: callback notification is the
   narrower change and preserves transport write/queue ownership. Empty stdout
   flush writes are excluded and HTTP stdout never latches.
   Latch a qualifying failure immediately without terminating committed drain.
   The dedicated stdio shutdown-result layer in `src/stdio.ts` reads the process
   stream latches after server/gate/sink closure and selects 1 through the injected
   exit port (observable in AC-09). Owned sessions have no process stdout owner;
   their non-terminating status setter considers only their own close outcome,
   ignoring the process-level stderr latch, including failures from earlier
   sessions. The production exit helper also checks shared owner state until
   primitive exit to catch qualifying failures during flush.
   Exit 1 only after the existing shutdown obligations settle.
   A previously selected failure remains 1, including a close or audit failure;
   a later success cannot overwrite it. Failure state takes precedence until
   the primitive runs; no post-exit observation is promised. Preserve the
   250 ms flush cap and any shorter remaining deadline. Reject exit 0 for
   post-close stdout EPIPE: containing an asynchronous error must not mask its
   failure status. Reject immediate exit 1: it would lose mutation drain.
   Reject treating every stderr error as benign: that would hide failures
   unrelated to a broken diagnostic pipe.
5. **Serialize the object actually validated.** Parse once, validate against the
   `isGateErrorText` contract narrowed with `Number.isFinite` for required
   `attempts` and optional `status`, then serialize that same object. A helper
   may return the validated object instead of only a boolean. Do not broaden
   the key/value allowlist or reject all duplicate-key JSON: emitting the final
   validated object removes discarded values without a new parser contract.
6. **Records and review boundary.** This is a draft, not a freeze or review
   verdict. Before freeze the orchestrator obtains independent strong-tier
   approval followed by the security-sensitive strongest-tier decision pass,
   records evidence/available token counters in the ticket. The stdout
   measurement premise is resolved by the supplied owner-listener and
   pending-threshold measurements in [Node process observations](../docs/observations/node-process.md),
   [139-probe-2-orchestrator](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157477735):
   after transport-listener removal and destroy(), the remaining owner contains
   EPIPE in 3/3 broken-reader runs; resumed readers get all 1048576 bytes and
   error-free callbacks in 3/3 runs. The 262144-byte pending threshold was
   observed once and must be asserted in the AC-10 setup. Subsequent BR
   records carry the listed versions and pending acceptance status, not
   active status. No ADR is needed for this
   local correction of existing ownership contracts.
7. **Deterministic stdout lifecycle proof.** AC-09 uses controlled stream
   callbacks/events and fake timers to place EPIPE strictly after transport
   close and before real gate drain completes, without relying on OS pipe
   scheduling. AC-10 additionally uses a child process because a generic fake
   stream cannot establish Node process.stdout's special destroy behavior or
   actual process survival/exit status. IPC orders all milestones; the held
   mutator proves drain without a timing race. Reject a fake-only proof and
   sleep-based child coordination: they respectively miss runtime behavior
   and make the critical ordering nondeterministic.

## Open questions

## Stress-test

- **Retained — scope extension by the orchestrator, 2026-11-25.** Supplied
  probes show stdout EPIPE is uncaught without an error listener, and transport
  close removes that listener while a pending OS pipe write survives destroy().
  The resulting exit 1 can interrupt BR-254 drain. Extend the process-owner
  rules to stdout within #139's asynchronous-failure/drain need, replacing the
  earlier follow-up-only exclusion. Keep stderr diagnostic EPIPE best effort;
  classify stdio protocol-frame stdout EPIPE as failure 1 after drain so exit
  codes are never masked; empty flush writes and HTTP stdout are excluded.
  AC-09/AC-10 cover the newly measured post-close window; AC-08 covers late
  failure precedence during exit flushing.

Spec review round 1 (`139-spec-review-1-opus`) produced these decisions:

- **Finding 1 — retained.** Enumerate all BR-254 v2 clauses above; limit stdout
  latching to stdio protocol frames, preserving empty-flush completion and HTTP
  stdout semantics. AC-08 adds EOF/closed-reader/no-pending-frame exit 0 and
  HTTP stdout rows, avoiding a false shutdown failure.
- **Finding 2 — retained.** BR-447 and D-3 require both owners installed by
  `productionDependencies()` before `main`; AC-06 covers observed HTTP stderr
  EPIPE followed by SIGTERM exit 0, closing the `deps.stderr` coverage gap.
- **Finding 3 — retained.** AC-07 requires observed EPIPE before each write's
  IPC acknowledgment, preventing success before asynchronous error delivery.
- **Finding 4 — retained.** D-3 uses an injectable-stream owner factory and one
  production instance per process stream; D-4 names stdio shutdown-result code
  selection and the helper's late-failure check. Fresh test owners isolate rows
  and the injected exit port exposes AC-09's status.
- **Finding 5 — retained.** BR-254/D-2 wait for both closes; AC-04 delays server
  rejection until after gate resolution, preventing premature exit/closure.
- **Finding 6 — retained.** AC-01/AC-02, their test names and rule bullets cite
  unchanged BR-254 drain coverage from F-016 AC-21, distinguishing proof from
  a new behavioral delta.
- **Finding 7 — retained, allocation amended by the decision pass below.**
  Proposed BR-262 v2 includes finite numeric validation and BR-069 v3 owns
  stdio reserialization; AC-05 rejects overflowing attempts and
  status, preventing serialized null from escaping the validator contract.
- **Finding 8 — retained.** Node observations link the supplied identified
  stdout and earlier stderr/close ticket evidence, making each premise
  traceable without another probe or forge write.
- **Finding 9 — retained.** AC-10 names parent-sent SIGTERM as the transport
  closure trigger, making the IPC ordering reproducible.

Spec review round 2 (`139-spec-review-2-opus`) produced these decisions:

- **Finding 1 — retained.** BR-448, AC-06/AC-08 and D-4 classify stdout only
  through stdio protocol-frame write callbacks, even after close; move owner
  notification before the callback guard rather than routing frames through the
  owner, preserving transport ownership. Stdout events are only contained.
  Stderr EPIPE events never change code; all other stderr events latch,
  including flush events. The BR-254 clause table records this replacement.
- **Finding 2 — retained.** AC-09/AC-10 use a 256 KiB encoded frame including
  newline from `synthetic_large_result`, below byteLimit; the measured
  setup-dependent pending threshold and mandatory assertion below supersede
  the earlier pipe-capacity claim. SIGTERM precedes its 1,000 ms bound and
  stderr must lack
  `STDIO_OUTPUT_FAILED`, so the existing timeout cannot prove the new latch.
- **Finding 3 — retained.** D-3 resolves owners through process getters at call
  time, keyed by stream identity in a `WeakMap`; reject module-level stream
  singletons to preserve getter-spy substitution and test-row isolation.
- **Finding 4 — retained.** BR-254 and D-4 limit owned status to that session's
  close outcome; process stderr latches affect only dedicated-process exit.
  AC-04 adds earlier stderr failure followed by a clean owned close; the
  decision-pass correction below requires no setter call, preserving earlier
  failure status.
- **Finding 5 — retained.** Node observations and Context distinguish the
  once-run stdout listener/no-listener cases from the pending-write-after-destroy
  probe's three identical runs, matching the supplied evidence.
- **Finding 6 — retained.** AC-02 and D-3 name `main` as the entry and `runMain`
  as its test seam; no production `runMain` entry is implied.

### 139-spec-review-3-opus (diff-only confirmation, approve)

- **Minor 1 — retained.** AC-09 states that `synthetic_large_result` is a test
  fixture registered only in the AC-09 and AC-10 test compositions, never in a
  production tool list.
- **Minor 2 — retained.** D-4 resolves the stdout owner from the owner `WeakMap`
  by the transport's own `output` stream identity, never through the
  `process.stdout` getter; injected owned streams have no owner.
- **Minor 3 — retained.** The probe evidence comment was amended with repeat
  counts (stdout listener cases once each; pending-write probe 3/3).
- **Minor 4 — retained.** AC-10 acknowledges right after `write()` returns false,
  the parent sends SIGTERM on that acknowledgment, and a `STDIO_OUTPUT_FAILED`
  is a harness timing failure, never a pass.

### 139-spec-decision-1-fable (strongest-tier decision pass, changes)

- **Finding 1 — retained.** Owned closure calls its setter only with 1, never
  with 0; AC-04 expects `[]` for a clean owned close after an earlier stderr
  latch. This preserves the existing contract and cannot clear an earlier 1.
- **Finding 2 — retained, measured.** Record the supplied 2026-11-25
  `139-probe-2-orchestrator` owner-listener results in Node observations and
  cite them in D-6. AC-10 adds resumed-reader delivery without a latch and
  exit 0, ruling out a false failure on a healthy slow client.
- **Finding 3 — retained.** Bound stdio server-close observation by the
  existing shutdown deadline. Expiry selects 1 and `PROCESS_CLOSE_FAILED\n`;
  AC-04 covers never-settling close, completed drain before deadline exit and
  safely consumed late rejection. No new shutdown allowance is introduced.
- **Finding 4 — retained.** Include transport EOF, failure and SDK-close
  fire-and-forget sites in D-2/BR-254 v3. AC-04 covers rejecting `sdk.close()`
  on each path, including F-016 AC-21 EOF during committed drain, with failure
  status 1 and no unhandled rejection.
- **Finding 5 — retained.** The persisted BR-069 is v2; propose v3 for stdio
  boundary reserialization and retain BR-262 v2 for finite-number validation.
  AC-05 maps both versions; no new BR ID or BR-file edit is needed here.
- **Finding 6 — retained.** AC-08 explicitly amends F-039 AC-12's "contain
  subsequent error events without changing code" row for non-EPIPE stderr
  errors before primitive exit (0 becomes 1). EPIPE, stdout and post-exit
  rows retain their existing expectations.
- **Finding 7 — retained, measured.** Record the supplied one-run-per-size
  pending threshold and its setup dependence. Keep the 262144-byte frame
  including envelope/newline below byteLimit; AC-10 asserts its encoded size,
  `write() === false` and positive writableLength before IPC acknowledgment,
  failing loudly if the setup does not produce backpressure.

No freeze or acceptance is claimed in this section.

### 139-spec-review-4-opus (diff-only confirmation, approve)

- **Minor 1 — retained.** AC-10's healthy row releases the mutator only after
  the parent has received all 262144 bytes and the child's "write callback, no
  error" milestone.
- **Minor 2 — retained.** The close diagnostic applies to each shutdown whose
  server/transport close rejects or reaches the deadline, not to a transport
  failure whose `sdk.close()` resolves.
- **Minor 3 — retained.** The committed-run bound is the existing 45,000 ms
  counted from the gate close call, chosen when cleanup evaluates
  `hasCommitted`.

### 139-spec-decision-2-fable (strongest-tier decision pass, approve)

- **Finding 1 — retained.** BR-254 v3 and D-2 include start-failure and
  host-invoked close paths: session `close()` and `ready` never reject after a
  consumed close failure, with status 1 through the same result owner. AC-04
  adds start failure with rejecting `sdk.close()` and host-invoked close.
- **Finding 2 — retained, accepted residual.** Choose the Out-of-scope line:
  stdin `error` after transport close is unmeasured and unlikely on pipes;
  any stdin failure before close is already handled by the transport.
- **Finding 3 — retained.** Add gate close to the close-diagnostic BR bullet,
  matching AC-03/AC-04's defensive gate-close rejection rows.
- **Finding 4 — retained.** AC-04 expects owned setter calls `[1]` when
  transport failure is followed by rejecting close: status 1 is selected once
  per session regardless of the number of failure sources; BR-254 and D-2
  state the same rule.
- **Finding 5 — retained, accepted consequence.** D-3 records that the first
  built-in stderr write in an embedded host installs a permanent listener
  containing the host's own non-EPIPE stderr errors, while no owned session
  reads the process failure latch.
- **Finding 6 — retained.** BR-254 and D-2 require server-close rejection or
  expiry to start cleanup if it has not started, re-evaluating `hasCommitted`
  before exit. AC-04 adds variants without transport `onclose`, with gate/sink
  drain completed before exit or owned `closed`.

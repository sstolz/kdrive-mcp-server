---
id: F-054
title: Close process and stdio lifecycle gaps
ticket: "#139"
status: draft
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
   discard a close promise. `src/http/server.ts` can propagate a rejected
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
The supplied stdout probes reproduce this failure in three of three runs;
the orchestrator extended this draft's scope after that measurement.

## Scope

- Complete the F-016 AC-21 SIGTERM coverage with a 3,000 ms virtual mutator.
- Handle close rejection in HTTP and both stdio signal compositions with a
  fixed failure diagnostic and the appropriate failure status.
- Emit re-serialized validated gate error JSON at the stdio output boundary.
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

## Business rules

Proposed versions: BR-210 v2, BR-254 v3 and BR-262 v2 retain their existing
purposes and IDs. Only the deltas below are new; inherited clauses remain.
BR-447–BR-448 v1 are new allocations. Recheck IDs on main before freeze and PR.

- **BR-254 v3 (retained drain obligation)** — Dedicated stdio shutdown by
  SIGTERM records the outcome of a run past intent before process exit.
  Verified by: AC-01.
- **BR-254 v3 (owned drain obligation)** — Owned stdio shutdown by SIGTERM
  settles closure only after the in-flight committed run's outcome is recorded.
  Verified by: AC-02.
- **BR-210 v2** — An HTTP signal stop requests exit 0 only after transport and
  gate close both fulfill, and requests exit 1 if either rejects.
  Verified by: AC-03.
- **BR-254 v3 (stdio failure status)** — A rejected signal-driven stdio close
  selects failure status 1 through the dedicated exit port or the owned host's
  non-terminating status setter, respectively. Verified by: AC-04.
- **BR-254 v3 (close diagnostic)** — Each failed signal shutdown offers exactly
  one `PROCESS_CLOSE_FAILED\n` diagnostic without any rejection payload.
  Verified by: AC-03, AC-04.
- **BR-262 v2** — A stdio gate error text that passes the existing parsed-object
  validator is emitted as JSON.stringify of that validated object rather than
  as the original input text. Verified by: AC-05.
- **BR-447 v1** — Built-in use of process stderr and process stdout shares one
  idempotently installed process-owned error listener per stream, installed
  before its first built-in write and never removed by a session close.
  Verified by: AC-06, AC-07, AC-09, AC-10.
- **BR-448 v1** — The process stream owner treats stderr EPIPE as unavailable
  diagnostic delivery and every other stderr error or any stdout error
  (including EPIPE) as a latched process failure without logging or retaining
  the error payload. Verified by: AC-06, AC-07, AC-08, AC-09, AC-10.
- **BR-254 v3 (failure precedence)** — A close failure, unexpected stderr
  failure or stdout failure observed before the exit primitive runs prevents
  a later success request or flush completion from selecting exit 0, without
  interrupting committed mutation drain. Verified by: AC-03, AC-04, AC-08,
  AC-09, AC-10.

BR-169 v4, BR-069 v2, BR-070 v5 and BR-426 v1 remain dependencies, not new
versions: HTTP server close ordering, sanitized channels, stdio budgets and
best-effort extraction diagnostic delivery retain their purposes and behavior.
BR-254 v3 explicitly replaces v2's first-code-wins clause only for an observed
failure taking precedence over success; deadlines, single flush pair and
exactly-once primitive exit remain. BR-262 v2 preserves its single mutate call,
single text item, result fields and `isError` classification.

## Acceptance criteria

All names below are planned tests, not claims of execution. Use synthetic
ports/data only; annotate each test with its BR and version. Run the relevant
files and then Docker/Make `make check` during implementation, not authoring.

- **AC-01** (BR-254 v3) — Given the real dedicated `main` → stdio composition
  (no `protocol` override), a synthetic file audit sink and a mutator whose
  successful HTTP 200 settlement is scheduled 3,000 virtual ms after dispatch,
  When SIGTERM reaches the installed process signal handler after intent and
  before settlement, Then at virtual 1,000 and 2,999 ms exit has not been
  requested, and at 3,000 ms the ordered trace is mutator success → successful
  outcome append → sink close → exit 0, with one attempt and one outcome.
  Verified by: `TestBR254_v3_AC01_dedicated_SIGTERM_drains_3000ms_mutation`
  in `tests/mutation-composition.test.ts`.
- **AC-02** (BR-254 v3) — Given the same committed virtual mutator through
  `runMain` with owned protocol streams and an observable status setter,
  When its injected signal source emits SIGTERM, Then closure remains pending
  at 1,000 and 2,999 ms and settles only after outcome append and sink close at
  3,000 ms, with no call to the terminating exit port.
  Verified by: `TestBR254_v3_AC02_owned_SIGTERM_drains_3000ms_mutation`
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
  A throwing diagnostic does not suppress the failure status, and stdout
  contains neither diagnostic nor error payload.
  Verified by: `TestBR254_v3_AC04_stdio_signal_close_rejection_is_contained`
  in `tests/mutation-composition.test.ts`.
- **AC-05** (BR-262 v2) — Given the actual owned transport's send boundary and
  error text `{"result":"private-canary","result":"denied","attempts":0}`,
  When the frame is written, Then its one text item is exactly
  `{"result":"denied","attempts":0}`, without the canary or duplicate key.
  Valid failed/uncertain/denied objects preserve their parsed fields; invalid
  JSON, forbidden keys, invalid field types and invalid fixed messages become
  `INVALID_ARGUMENTS`; existing allowed plain tool errors and successful tool
  envelopes retain their behavior. Verified by:
  `TestBR262_v2_AC05_stdio_emits_only_validated_gate_JSON`
  in `tests/navigation-wire-boundaries.test.ts`, with existing
  `TestBR262_*` coverage retained in `tests/mutation-tools.test.ts`.
- **AC-06** (BR-447 v1, BR-448 v1) — Given an isolated process stderr double,
  When repeated installation, stdio diagnostics and extraction detach/release
  diagnostics occur across two sessions and after closure, Then exactly one
  owner error listener remains, later asynchronous EPIPE events are contained,
  delivery is not retried or awaited, and extraction release/results and
  existing audit error listeners still work. An unexpected error latches
  failure 1 without keeping/logging its message, stack or other properties.
  Verified by: `TestBR447_TestBR448_AC06_permanent_stderr_owner`
  in new `tests/process-stderr.test.ts`, and
  `TestBR447_AC06_extraction_diagnostic_after_session_close`
  in `tests/extraction-admission.test.ts`.
- **AC-07** (BR-447 v1, BR-448 v1) — Given a child using the built-in lazy
  stderr writer and a parent that destroys the stderr pipe reader before
  acknowledging readiness over IPC, When the child attempts two writes,
  including one after session closure, Then it reaches both subsequent IPC
  acknowledgments and exits 0 with neither uncaught error nor unhandled
  rejection. Verified by: `TestBR447_TestBR448_AC07_closed_stderr_pipe`
  in `tests/process-stderr.test.ts`. IPC ordering, not wall-clock sleep,
  establishes reader closure; a bounded watchdog only detects a stuck test.
- **AC-08** (BR-254 v3, BR-448 v1) — Given the real production exit helper
  with controlled streams and exit primitive, When a latched close/unexpected
  stderr failure or any stdout failure (including EPIPE) precedes a success
  request or arrives during its flush wait, Then the primitive receives 1
  exactly once; stderr EPIPE alone does not convert a successful
  diagnostic-only shutdown to failure, an already selected failure stays 1,
  and the 250 ms cap and any shorter remaining deadline are unchanged.
  Verified by: `TestBR254_v3_TestBR448_AC08_failure_survives_exit_flush`
  in `tests/cli.test.ts`, retaining F-039 AC-12 success/failure/late-event rows.
- **AC-09** (BR-254 v3, BR-447 v1, BR-448 v1) — Given the dedicated stdio
  composition, the real transport and gate, a process stdout double retaining
  a pending frame write through destroy(), and a committed 3,000 virtual ms
  mutator with a healthy synthetic file audit sink, When SIGTERM closes the
  transport and, during gate drain, the pending write callback receives EPIPE
  and the stream emits its asynchronous EPIPE error, Then no uncaught error or
  unhandled rejection occurs, the process remains up with exit unrequested at
  1,000 and 2,999 ms, and at 3,000 ms mutation success → successful outcome
  append → sink close → exactly one exit 1 occur in order. Repeated owner
  installation across two sessions leaves exactly one owner listener after
  both close; the transport listener may be removed independently. Repeat with
  a non-EPIPE stdout error and an already selected close failure: failure
  remains 1, without error payloads or protocol retries. Verified by:
  `TestBR254_v3_TestBR447_TestBR448_AC09_stdout_failure_during_drain`
  in `tests/mutation-composition.test.ts`.
- **AC-10** (BR-254 v3, BR-447 v1, BR-448 v1) — Given a child running the
  dedicated stdio composition with real process.stdout, a parent pausing its
  pipe reader, a pending 1 MiB frame write (write returned false and
  writableLength is positive), and a committed mutator held at a synthetic
  upstream response barrier with a healthy file audit sink, When the child
  acknowledges transport closure and pending gate drain over IPC and the
  parent then destroys the reader, Then the child acknowledges the contained
  EPIPE while still draining and before exit. After the parent releases the
  mutator, its successful outcome is recorded and the sink closes before the
  actual child exits 1, with neither uncaught error nor unhandled rejection.
  Verify ordered IPC milestones and the synthetic audit record; IPC barriers,
  not sleeps, establish pending write, transport close, EPIPE and release order.
  A bounded watchdog detects a stuck test. Verified by:
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
   and rejection handling to every signal-started close, including the cleanup
   gate promise in stdio. Settle cleanup and remove signal handlers in a finally
   path, keeping handlers installed during committed mutation drain. A server
   close rejection still attempts gate drain before reporting failure. Dedicated
   modes use `deps.exit(1)` (stdio's injected exit port); owned modes use their
   setter and never terminate the host. Repeated signals join the same result.
   Reject fire-and-forget promises and an unconditional final exit 0: both lose
   the explicit failure contract. `PROCESS_CLOSE_FAILED\n` is the sole new
   fixed diagnostic; reporting it is best effort and cannot replace status 1.
3. **Install process stream ownership lazily before built-in writes.** A
   shared process module owns registration and payload-free failure state;
   importing modules alone does not attach listeners. Extraction admission,
   default stdio diagnostics and production stderr use that same owner before
   writing. Built-in protocol use of process.stdout installs its owner before
   transport writes, and production flushes ensure ownership of both streams.
   Installation is idempotent per stream for the process lifetime, including
   repeated sessions and exit-helper creation. Reject installation only in
   `main`/`runMain`: embedded/default writers can run without that entry and
   detached extraction outlives sessions. The owner never removes itself,
   ends/destroys either stream, retries, recursively logs, or throws from its
   error handler. Injected owned streams retain their transport ownership;
   they do not acquire process-lifetime listeners. Existing transport listeners
   may remain for in-session failure detection; their removal cannot remove
   process ownership. Existing audit listeners still classify/latch audit
   failures independently, including EPIPE.
4. **Share ownership with exit flushing and preserve failure status.** The
   production helper uses the permanent owners for both stdout and stderr,
   rather than installing another process-level error listener per helper.
   Flush completion can subscribe to the owners without owning/removing their
   stream listeners. Stderr EPIPE alone means failed best-effort diagnostic
   delivery and leaves an otherwise successful exit at 0. Any stdout error,
   including post-close EPIPE on a pending protocol frame, selects exit 1:
   protocol delivery failed, even when the committed mutation succeeds and its
   outcome is recorded. Latch that failure immediately without terminating
   drain; exit 1 only after the existing gate/sink shutdown obligations settle.
   A previously selected failure remains 1, including a close or audit failure;
   a later success cannot overwrite it. Failure state takes precedence until
   the primitive runs; no post-exit observation is promised. Preserve the
   250 ms flush cap and any shorter remaining deadline. Reject exit 0 for
   post-close stdout EPIPE: containing an asynchronous error must not mask its
   failure status. Reject immediate exit 1: it would lose mutation drain.
   Reject treating every stderr error as benign: that would hide failures
   unrelated to a broken diagnostic pipe.
5. **Serialize the object actually validated.** Parse once, validate against the
   current `isGateErrorText` contract and serialize that same object. A helper
   may return the validated object instead of only a boolean. Do not broaden
   the key/value allowlist or reject all duplicate-key JSON: emitting the final
   validated object removes discarded values without a new parser contract.
6. **Records and review boundary.** This is a draft, not a freeze or review
   verdict. Before freeze the orchestrator obtains independent strong-tier
   approval followed by the security-sensitive strongest-tier decision pass,
   records evidence/available token counters in the ticket. The stdout
   measurement premise is resolved by the supplied probes. Subsequent BR
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
  classify stdout EPIPE as failure 1 after drain so exit codes are never masked.
  AC-09/AC-10 cover the newly measured post-close window; AC-08 covers late
  failure precedence during exit flushing.

No independent review has run for this draft. No freeze or acceptance is claimed.

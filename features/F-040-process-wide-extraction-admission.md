---
id: F-040
title: Bound process-wide extraction admission before source buffering
ticket: "#47"
status: done
version: 1
---

# F-040 — Bound process-wide extraction admission before source buffering

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `fix/47-d-extraction-limit`, supplied main
`c39a77a3f4e996541732d8a6c036f63e4df40a4c` (original draft base).
Review-1 revision base: `6fab436e414ca9a1eb3eb6cb7fde8eb04e7b8773`
(local HEAD verified; no commit created).
Review-2 / Decision-1 revision base: `13b0f8d` (local HEAD verified; no commit created).
IDs: F-040; new BR-423–BR-426 v1; pending BR-118 v3; AC-01–AC-12. No new ADR.
The owner reserves F-039 for lot C on `fix/47-c-audit-sink`, not yet merged,
including BR-070 v5 and pending versions of BR-240, BR-241, BR-254 and
BR-259. This feature does not edit or version those rules. Next IDs after this
allocation: F-041, BR-427, ADR-013. Recheck current main and concurrent
allocations before freeze and PR; no remote check is authorized here.

Frozen v1 on 2026-11-15 at the owner's explicit instruction, from reviewed
base `ca61295225c814f973857b6583651610d840f1e5`, with supplied
`47d-spec-review-3-reviewer` (approve, minors) and
`47d-spec-decision-2-fable` (changes, one major), with all corrections
and verdicts recorded below. This explicit freeze instruction overrides the
usual requirement for a new approval of the corrected decision-pass head;
no such approval is claimed. This uncommitted freeze revision has no new SHA.
Implementation, code review, CI and actual-main acceptance remain pending.
Review token totals and reported reviewer model/effort were not supplied;
no retrospective usage is inferred. Decision-pass tier is Fable 5.2 per PROJECT.md.

Freeze allocation recheck: local `main` is stale at `7fdc7b3`; cached
`origin/main` is `c39a77a`, where F-039 and BR-423 are next. The supplied
head `ca61295` allocates F-040 and BR-423–BR-426; F-039 remains reserved for
lot C. Next IDs are F-041, BR-427 and ADR-013. No ID is reused; recheck
current main before the PR. No network or ticket-state update is performed.
Tests first follows AGENTS.md §3; local checks use existing host dependencies
under this assignment's no-Docker constraint and are neither `make check` nor CI.

## Context

Ticket #47 lot D addresses finding 3 of the supplied cross-vendor review.
Users in different HTTP sessions can run extraction simultaneously: the
listener allows 64 sessions (`src/http/limits.ts`), and each controller has
its own invocation slot. `src/navigation.ts` calls `content.complete` before
`runExtraction`; `src/content.ts` allocates the complete source buffer and
navigation copies it to a transferable `Uint8Array`. Each extraction creates
a new worker in `src/extraction-owner.ts` with 128 MiB old-generation,
16 MiB young-generation and 4 MiB stack limits. Those limits do not cap
ArrayBuffers, Buffers or other external memory, as F-009 already records.

F-038 permits complete sources up to 8 MiB to reach the worker. Sixty-four
such sources represent 512 MiB of source payload alone, before transfer
copies, parser allocations and worker heaps. Per-invocation byte and time
bounds do not limit this concurrent multiplication. The need is to bound
the number of extraction pipelines from before source buffering through
owned cleanup, and to bound the calls waiting for them, across sessions.

## Scope

- One process-wide semaphore shared by every production navigation controller
  and runtime in that process for all `kdrive_read` formats: text, PDF and image,
  including continuation calls and empty sources.
- Two active extraction permits, at most one per identity, and at most four
  waiters with at most one live waiter per identity, ordered by oldest eligible
  identity, acquired
  before `content.complete`, with explicit overload, deadline and cancellation
  outcomes and release on every terminal path with confirmed worker exit.
- Fixed, payload-free diagnostics on detach and eventual permit release;
  immediate refusal while an identity holds a detached permit.
- Preserve per-call source, decoded, structural, worker, output and time
  bounds, fresh authorization, byte evidence and worker isolation.
- Prepare new pending BR records, indexes, provisional capability and changelog.
- Require README, MCP compatibility and `kdrive_read` description guidance for transient queue
  saturation, verified by a named documentation test in the implementation phase.

### Out of scope

- Other #47 findings/lots, mutation or audit-sink changes, new configuration,
  public schemas, dependencies, worker pooling, cross-process coordination,
  weighted scheduling, per-identity queue reservations or a throughput guarantee.
- A hard RSS or external-memory byte cap, OS isolation, parser budget changes,
  new format support, source caching, retry/backoff or changes to raw downloads
  and resource reads. They do not acquire extraction permits.
- Source edits, Docker, network, commits, PR publication, new review,
  acceptance or release in this freeze-and-tests assignment. No current rule is
  promoted or marked accepted by these records.

## Business rules

- **BR-423 v1** — Every extraction pipeline holds one of two process-wide
  permits before entering complete-source acquisition, with at most one held
  permit per identity. Verified by: AC-01, AC-02, AC-09, AC-10, AC-11.
- **BR-424 v1** — Contended extraction admission uses at most four live
  waiters, at most one per identity, serving the oldest whose identity holds
  no active permit; it immediately refuses an identity with a detached permit,
  a second live waiter of one identity, all permits held by detached workers,
  or a caller unable to obtain an eligible
  permit or queue place with `SERVER_BUSY`,
  without an automatic retry. Verified by: AC-02, AC-03, AC-09, AC-11, AC-12.
- **BR-425 v1** — Extraction waiting uses the running invocation's existing
  deadline and cancellation state, removing dead waiters before they can
  acquire a permit or start content work. Verified by: AC-04, AC-05, AC-06.
- **BR-426 v1** — Every granted permit remains charged until owned source cleanup
  and confirmed worker exit, then releases exactly once; failed or overdue
  termination transfers ownership to a detached exit watcher while the
  invocation settles no later than its deadline and releases its session slot;
  detach and eventual release each offer one fixed, payload-free diagnostic.
  Verified by: AC-06, AC-07, AC-08.
- **BR-118 v3** (pending; v2 remains active) — Ordinary owned-worker exit
  precedes session-slot release; failed/overdue termination instead detaches
  permit ownership and releases the session slot no later than the deadline,
  without releasing the extraction permit before exit or publishing late data.
  Verified by: AC-07, AC-08.

Dependencies (unchanged; BR-118 v3 above versions the lifecycle exception): [BR-070 v4](../business-rules/BR-070.md) (invocation
bounds; lot C reserves v5), [BR-084](../business-rules/BR-084.md) and
[BR-089](../business-rules/BR-089.md) (exact body evidence and ownership),
[BR-109](../business-rules/BR-109.md) (fresh authorization),
[BR-111](../business-rules/BR-111.md) (complete source),
[BR-117](../business-rules/BR-117.md) (per-invocation bounds),
[BR-120](../business-rules/BR-120.md) (fixed redacted errors),
[BR-121](../business-rules/BR-121.md) (own-data projections),
[BR-122 v3](../business-rules/BR-122.md) and
[BR-209](../business-rules/BR-209.md) (worker dependencies and hygiene),
[BR-384 v2](../business-rules/BR-384.md) (per-session slot starts the
invocation deadline). BR-112–BR-116, BR-390–BR-391 and BR-412–BR-420 retain
their text/PDF/image behavior. F-040 adds aggregate admission; it changes
none of the byte/time bounds or F-026's per-session queue. The sole lifecycle
exception to active BR-118 v2 is recorded in pending BR-118 v3 and D-4.

## Contract details

### Admission, ordering and ownership

Use fixed internal constants `MAX_ACTIVE_EXTRACTIONS = 2` and
`MAX_WAITING_EXTRACTIONS = 4` and
`MAX_ACTIVE_EXTRACTIONS_PER_IDENTITY = 1` and
`MAX_WAITING_EXTRACTIONS_PER_IDENTITY = 1`. The default composition shares one admission
owner in the parent process; constructing a controller, HTTP session or
runtime never creates or resets its capacity. Separate server processes
have separate capacity. A test seam may isolate state, but production has
no caller-supplied limiter, limit, bypass or reset selector.

Keep argument validation and per-session invocation admission first. Once
that invocation owns its session slot, check liveness and request one
extraction permit before `content.complete`, hence before `describe`,
`open`, any body read, source-sized allocation/copy or worker construction.
A queued call retains only bounded invocation/admission state, no source
bytes, open body, worker or prefetched descriptor. It keeps its session
slot; other calls of that session continue following F-026. No dependency
operation is charged for waiting or permit handoff.

Identity is trusted composition state, never a tool argument or session ID.
`src/http/handler.ts` authenticates to the exact issuer/subject pair, binds
that key in `src/http/sessions.ts`, and passes `auditIdentity(identity)` to
`createNavigationServer`. `src/navigation.ts` currently exposes that value
on the server options/binding, but `NavigationOptions` and the extraction
call path do not consume it. Thread it internally into controller admission;
use a collision-free tagged key from the exact `iss` and `sub` values, so
separate sessions of the same verified identity share one allowance.
`SESSIONS_PER_IDENTITY = 8` must not create eight extraction allowances.
`src/stdio.ts` already passes `{kind:"stdio"}`: all stdio controllers in the
process use one identity. Insecure HTTP uses one distinct `insecure` identity.
Embedded controllers without identity use the single stdio fallback, never
a new identity per controller. No identity is exposed in errors or diagnostics.

Retire cancelled/expired waiters before counting capacity or granting; no
queue entry remains as a tombstone. After checking liveness, immediately
refuse a caller whose identity holds a detached permit with `SERVER_BUSY`,
without enqueueing. After the same liveness check, if every global permit
is held by a detached worker, refuse any new caller immediately with
`SERVER_BUSY`, even for another identity; do not occupy its session slot
until timeout. Existing distinct-identity waiters keep their original deadline
and can start only after confirmed exit frees capacity. A second live waiter of an identity also refuses immediately
with `SERVER_BUSY`. On detach, remove and settle any already-queued waiter of
that identity with `SERVER_BUSY` (unless its earlier abort/deadline dictates
its existing liveness code); this prevents an earlier waiter from remaining
stranded behind detached ownership. A waiter is eligible only when its
identity holds no active permit, including permits held by detached exit
watchers. Whenever capacity is free, serve the oldest live eligible waiter,
repeating while another permit and eligible waiter remain. Skip an ineligible
waiter without moving its queue position: FIFO is preserved among eligible
identities, and skipped callers retain their original age. A newcomer may
start only after older eligible waiters have been served and only if its
identity holds no active permit. Otherwise enqueue only if fewer than four
live waiters remain, the identity has no live waiter and it holds no detached
permit; if any condition fails, refuse immediately with `SERVER_BUSY`. An ineligible queue head must
not leave capacity idle when an eligible waiter exists. If all waiters are
ineligible, the spare permit stays idle. Release the old identity's charge
and assign the next identity atomically with the permit handoff.

With distinct identities, two active calls plus four waiters are admitted;
the seventh caller (fifth would-be waiter) refuses. A second extraction from
an active identity waits even if the other global permit is free; it uses
one of the same four queue places; a third call of that identity refuses
`SERVER_BUSY` instead of adding a second waiter. There is no per-identity
queue reservation. With a spare permit, at most one waiter can be ineligible:
only the other permit holder can have an ineligible waiter. Four ineligible
waiters cannot coexist under the two-permit and one-waiter-per-identity caps.
A full queue does not bar an immediate eligible grant after older eligible
waiters have been served.

After grant, recheck liveness before entering `content.complete`; its existing
fresh policy and descriptor/version checks run then. Waiting conveys no
authorization and caches no earlier grant. After content work, retain the
existing final authorization for success and content-dependent failures.
Admission refusals occur outside that content-publication path: no source
was consulted, no fresh dependency call is needed to publish a fixed
admission code, and `describe`/`open` remain at zero for that call.

The permit covers source acquisition (and any existing admitted pre-body
retry), transfer copies, worker execution/termination, result projection
and final authorization. Release in one ownership cleanup path on success,
source/policy failure, synchronous worker-construction failure, worker error,
invalid output, projection failure, deadline, cancellation and session close.
Before handoff, close any owned source body exactly once and drop pipeline
references to source bytes and intermediate output. Ordinarily await owned
worker termination/exit, release its permit, then release the session slot.
A termination request or rejection is not proof of exit.

If termination rejects before exit while the invocation is live, transfer
its permit and identity charge to a detached exit watcher. Preserve the
existing final authorization at `src/navigation.ts:556–562` before returning
`E("CONTENT_UNAVAILABLE")`: check liveness, authorize afresh, then check
liveness again. Authorization denial returns `E("ACCESS_DENIED")`. This
final authorization is bounded by the original invocation deadline; if it
stalls, settle `E("REQUEST_TIMEOUT")` at that deadline and discard any late
completion. Release the session slot on settlement, never later than the
deadline. No policy call starts after abort/deadline/close. BR-109 is unchanged.
If termination is still pending at the invocation deadline, detach the same
ownership and settle exactly as `E("REQUEST_TIMEOUT")` at that deadline.
A previously recorded cancel/close retains `E("ACCESS_DENIED")`; a closed
session publishes no wire result. Liveness is checked before choosing the
failure: at or beyond the deadline, with no earlier recorded abort cause,
`REQUEST_TIMEOUT` wins over a late termination rejection. No success or
content-dependent result is published while exit is unconfirmed, and no
termination or authorization promise can extend the 10 s invocation deadline.
This is pending BR-118 v3's explicit exception to active v2's ordinary
exit-before-slot-release ordering, not to memory accounting.

Install the exit observer before requesting termination; transfer ownership
atomically with an already-observed-exit check so exit/rejection/deadline
races cannot lose or duplicate a release. The detached watcher retains only
the worker handle, minimal exit/error-drain bookkeeping and the permit/
identity release token and the process-owned diagnostic sink, not the
invocation, session, source or result. It
consumes late messages/errors without publishing or retaining their payloads.
Only confirmed exit releases the permit and identity charge exactly once.
A fulfilled termination acknowledgment counts only when it confirms exit;
a rejection never does. If the worker never exits, its permit and identity
remain charged indefinitely, but its invocation and session slot do not.
At most two such watchers can exist because each owns a global permit.
At detach, offer exactly `Extraction worker detached; capacity remains charged until exit.\n`
once per watcher to the admission owner's own process-wide diagnostic sink.
Create this sink at process start and wire it to process stderr in both stdio
and HTTP compositions; retain it after any originating session closes.
HTTP currently passes `undefined` at `src/http/handler.ts:454` and navigation's
default at `src/navigation.ts:222` is a no-op, so a session diagnostic port is
not sufficient. The owner/exit watcher must retain the process sink directly.
On its eventual confirmed exit and permit release, offer exactly
`Detached extraction worker exited; capacity released.\n` once for that
watcher. These are fixed constants, without paths, IDs, names, counts,
error messages, stacks, source bytes or other payloads. Use F-039's fixed
best-effort diagnostic style: set each once guard before the attempt, contain
synchronous throws/reentrant errors, never await a callback/drain or retry,
and never let diagnostic failure delay settlement/release or change a result.
Blocked stderr may prevent delivery. Ordinary exit without detach emits neither
line; immediate admission refusals emit neither line. These are diagnostics,
not audit events, and do not change lot C's audit contracts.
Garbage collection/RSS reduction is not a release prerequisite or asserted
outcome. The bounded final tool result can remain for transport publication.

The semaphore never retains request bodies or results after settlement.
Remove waiter timers/listeners on grant, refusal, timeout, abort and close.
Release and waiter settlement are idempotent: late abort, deadline, worker
message/error/exit or a duplicate cleanup cannot grant twice, reduce the
active count below zero or publish a second result. Closing one session
removes only its waiter or cleans up its active permit, not other sessions'
work. No second acquisition occurs inside an already-permitted pipeline.

### Time and observable outcomes

F-026's per-session queue still precedes invocation start. Its waiting time
does not spend the invocation's 10,000 ms. The new extraction queue is
inside the running invocation: its deadline is exactly session-slot start
plus 10,000 ms, including all extraction waiting and subsequent work.
Never restart or extend that deadline at enqueue, grant, chunk or worker
start. There is no additional queue timeout. The existing worker-specific
timeout still starts at worker creation and is the smaller of
`extractTimeoutMs` and remaining invocation time; it is not a new full
invocation window after waiting.

Check the existing invocation liveness/code on enqueue, before grant and
immediately after awaited grant. Cancellation or close uses `ACCESS_DENIED`;
invocation expiry uses `REQUEST_TIMEOUT`. Preserve the controller's existing
recorded abort cause when abort/deadline events race; with no recorded
abort cause, monotonic time at or beyond the deadline refuses as
`REQUEST_TIMEOUT`, even if its timer callback has not run. No dead caller
is enqueued or granted merely because capacity is available. If abort wins
after ownership transferred but before content starts, release that permit
once without starting content. If it wins before handoff, remove the waiter
without releasing someone else's permit.

The observable refusal is the existing tool result, with no additional
fields: `E(code) = {isError:true,content:[{type:"text",text:code}]}`.

| Condition | Exact controller result | Content work for that caller |
| --- | --- | --- |
| Four live waiting and no immediate eligible grant | `E("SERVER_BUSY")` | None; no retry or retry timer |
| Identity holds a detached permit, already has a live waiter, or all global permits are detached | `E("SERVER_BUSY")` immediately | None; no enqueue or retry |
| Existing live waiter when its identity detaches | `E("SERVER_BUSY")` immediately | None; removed from queue |
| Queued invocation reaches its deadline | `E("REQUEST_TIMEOUT")` | None; removed from queue |
| Queued invocation cancelled or session closed | `E("ACCESS_DENIED")` | None; removed from queue |
| Live invocation: termination rejects before worker exit | `E("CONTENT_UNAVAILABLE")` after successful final authorization; denial gives `E("ACCESS_DENIED")`, expiry gives `E("REQUEST_TIMEOUT")` | Session slot released on settlement by its deadline; detached watcher retains permit/identity until exit |
| Termination still pending at invocation deadline, no earlier cancel/close | `E("REQUEST_TIMEOUT")` by t=10,000 ms | Session slot released; detached watcher retains permit/identity until exit |
| Other admitted extraction failure | Existing fixed failure code | Existing cleanup and authorization rules |

A closed session publishes no wire result. Admission refusal emits no
diagnostic or audit event, new HTTP status, `Retry-After`, queue position/count,
target identifier or dependency message. Only detached lifecycle transitions
offer the two fixed diagnostics above. Queue saturation reuses `SERVER_BUSY`,
already returned by `src/navigation.ts` for per-session queue saturation or
wait expiry before upstream work; README describes that refusal as safe to
retry once earlier work completes. The server does not automatically retry
any admission refusal; a later client invocation is a new admission with
fresh authorization. Existing download retries after successful admission
retain their contract. Size limits and worker error/exit retain `LIMIT_EXCEEDED`.

The README `kdrive_read` guidance, its registered tool description and
`docs/mcp-client-compatibility.md` under `## Parallel tool calls` (BR-387
surface, current lines 67–71) must all include: "SERVER_BUSY is a transient admission refusal before source
work, including extraction queue saturation, an identity's waiting limit or
a detached worker holding its permit. The server does not automatically retry;
a later client invocation requires fresh admission and authorization. Capacity
may remain unavailable until a stuck worker exits or the process restarts."
Transient describes capacity rather than a permanent size/content limit; it
promises neither recovery time nor success on retry. Verify all three surfaces
with AC-12; qualify existing retry-after-earlier-work guidance with the same
detached-capacity caveat on all three surfaces. BR-387 is unchanged.

## Acceptance criteria

All names below are exact planned tests, not implementation or execution
claims. New unit/controller tests live in `tests/extraction-admission.test.ts`
unless another path is named. Use distinct controllers sharing the default
process owner, controlled promises and fake monotonic time. Unless an AC
explicitly tests identity sharing, give every controller a distinct trusted
OAuth identity, including controllers added for capacity recovery. `P(value)` is
`{content:[{type:"text",text:JSON.stringify(value)}]}` with no `isError`.
The successful text fixture is `contentFixture({}, Buffer.from("safe"))`,
file 3 in drive 7, ETag `"version-1"`. Its exact result `S` is
`P({drive_id:7,file_id:3,etag:'"version-1"',size_bytes:4,format:"text",
offset:0,characters_read:4,total_characters:4,text:"safe",has_more:false,
encoding:"utf-8"})` for `{file_id:3,format:"text"}`.

- **AC-01** (BR-423 v1) — Given two controllers with their first source
  read held pending, When a third controller invokes `kdrive_read`, Then
  the first two have each opened exactly one body, the third has zero
  `describe`, `open`, body reads, source-buffer allocations/copies and worker
  starts, and its result remains pending. Releasing one complete pipeline
  starts the third exactly once; all three eventually return `S` and each
  opened body closes once. Repeat with the first two workers held instead
  of their reads. Verified by
  `TestBR423_v1_AC01_third_extraction_waits_before_source_buffering`.
  Instrument the complete-source allocation/copy boundary as well as ports;
  fixture-owned input bytes are not product source buffers.
- **AC-02** (BR-423 v1, BR-424 v1) — Given two active extractions, When
  four distinct controllers join in known order, Then all four remain
  pending with no content calls; granting one slot starts only the oldest.
  A newcomer arriving during that handoff joins behind the three remaining
  waiters. Drain by explicit completion before deadlines: content starts
  follow enqueue order, each call starts once and returns `S`, and active
  pipeline/worker counts never exceed two. Verified by
  `TestBR424_v1_AC02_four_waiters_are_FIFO_without_barging`.
- **AC-03** (BR-424 v1) — Given two active and four live queued calls,
  When a seventh caller (fifth would-be waiter) arrives, Then it returns exactly `E("SERVER_BUSY")`
  without advancing time, with zero content calls, buffering and worker
  starts for that call. Free a slot and advance controlled time: that
  refused call never starts again and schedules no retry. A new invocation
  can join once capacity exists. Verified by
  `TestBR424_v1_AC03_seventh_caller_fifth_waiter_refuses_SERVER_BUSY_without_retry`.
- **AC-04** (BR-425 v1, BR-384 v2) — Given a running invocation with
  session-slot start at t=0 that joins extraction waiting at t=2,000 ms,
  When it still waits at t=9,999, Then it remains pending; at t=10,000 it
  returns exactly `E("REQUEST_TIMEOUT")`, leaves the queue and never
  starts content, even after a permit is freed. In a second row, grant at
  t=9,000 and stall its body read: the same result occurs at t=10,000 with
  its read signal aborted, one body close and no worker; a queued third caller
  starts once at t=10,000. In a third row,
  create its worker at t=9,000 with `extractTimeoutMs=500`: terminate and
  return that error at t=9,500; with `extractTimeoutMs=5000`, at t=10,000.
  Verified by `TestBR425_v1_AC04_queue_and_work_share_invocation_deadline`
  (rows `queued`, `body`, `worker-short`, `worker-remaining`).
  Retain `TestBR384_v2_AC06_waiting_and_prior_operations_do_not_spend_stream_deadline`
  in `tests/invocation-queue.test.ts` as the per-session-queue control.
- **AC-05** (BR-425 v1) — Given two active calls and four waiters,
  When one queued caller aborts or its session closes, Then it settles
  exactly once as `E("ACCESS_DENIED")` with zero content/worker starts;
  the other calls remain pending and a replacement caller can occupy the
  freed fourth queue place. Drain: the removed caller never starts and the
  survivors keep FIFO order. A pre-aborted or already-closed caller also
  returns that result without occupying either capacity. Verified by
  `TestBR425_v1_AC05_queued_cancel_and_close_remove_only_the_owner`
  (rows `cancel`, `close`, `pre-aborted`, `already-closed`); a wire close
  case in `tests/read-worker-lifecycle.test.ts` named
  `TestBR425_v1_AC05_closed_queued_session_publishes_no_wire_result`
  asserts zero responses after close, including after later slot release.
- **AC-06** (BR-425 v1, BR-426 v1) — Given a permit handoff, When the
  recipient is cancelled immediately before grant or immediately after
  grant but before resuming content, Then exactly one `E("ACCESS_DENIED")`
  settles, zero content calls start, the next live waiter gets one permit,
  and two subsequent calls can occupy exactly two slots. Repeat expiry at
  t=10,000 without first running the timeout callback: the expired recipient
  gets exactly `E("REQUEST_TIMEOUT")`. Late timer/abort callbacks cannot
  grant again. Verified by
  `TestBR425_v1_AC06_dead_waiter_cannot_win_permit_handoff`
  (rows `abort-before`, `abort-after`, `deadline-before`, `deadline-after`).
- **AC-07** (BR-426 v1, BR-118 v3) — Given two active pipelines and a
  third queued, When one active pipeline takes each terminal path below,
  Then it has the exact result listed, any opened body closes once, a
  created worker exits before permit reuse, and the third starts once and
  returns `S`. No later callback changes either result. After draining,
  two fresh extractions start together and a third waits, proving recovery
  without a leaked or duplicated permit. Verified by
  `TestBR426_v1_AC07_every_terminal_path_releases_once`.

  | Parameter row | Trigger | Exact result |
  | --- | --- | --- |
  | `success` | Valid text `safe` | `S` |
  | `source-error` | First body read rejects with `ReadFailure(503)` | `E("READ_UNAVAILABLE")` |
  | `source-bound` | Descriptor size 8,388,609 with cap 8,388,608 | `E("LIMIT_EXCEEDED")`; no open/worker |
  | `worker-error` | Worker emits `error` after starting | `E("LIMIT_EXCEEDED")` |
  | `worker-construction` | Worker factory throws a generic canary Error | `E("ACCESS_DENIED")`, existing generic normalization |
  | `invalid-output` | Started worker sends an invalid result envelope | `E("CONTENT_UNAVAILABLE")` |
  | `projection-error` | Four-character `safe`, requested offset 5 with matching `etag:'"version-1"'` | `E("INVALID_RANGE")` |
  | `final-denial` | Policy revoked after worker success | `E("ACCESS_DENIED")` |
  | `final-auth-stalled` | Worker has exited; final authorization remains pending at t=10,000 | `E("REQUEST_TIMEOUT")`; abandon final authorization, release once and start the queued third caller at t=10,000; late success/failure cannot publish or release again |
  | `timeout` | Worker reaches `extractTimeoutMs` before invocation expiry | `E("REQUEST_TIMEOUT")` |
  | `invocation-timeout` | Worker remains pending at invocation expiry | `E("REQUEST_TIMEOUT")` |
  | `cancel` | Active worker's invocation is aborted | `E("ACCESS_DENIED")` |
  | `close` | Active worker's session closes | `E("ACCESS_DENIED")`; no wire result |

- **AC-08** (BR-426 v1, BR-118 v3, BR-424 v1, BR-109) — Given two held permits for identities A and B
  and a queued extraction C, When A's real started worker begins cleanup,
  Then enforce the following exact outcomes with slot start t=0. Verified by
  `TestBR426_v1_AC08_worker_exit_precedes_permit_reuse` in
  `tests/read-worker-lifecycle.test.ts`.

  | Parameter row | Controlled termination/exit | Exact result and ownership |
  | --- | --- | --- |
  | `success`, `error`, `timeout`, `cancel`, `close` | Hold acknowledgment, then confirm exit before t=10,000 | Until exit the permit and session slot stay held and C never starts; on exit settle once with respectively `S`, `E("LIMIT_EXCEEDED")`, `E("REQUEST_TIMEOUT")`, `E("ACCESS_DENIED")`, `E("ACCESS_DENIED")` (close: no wire result), release once and start C once |
  | `termination-rejection` | Reject termination at t=1,000 while A's worker keeps running beyond t=10,000, with no abort | Final authorization succeeds immediately at t=1,000; settle exactly `E("CONTENT_UNAVAILABLE")` and release A's session slot; a detached watcher keeps A's permit and identity charged; at t=10,000 C still has zero starts and A has no second result |
  | `termination-pending-at-deadline` | Termination neither resolves nor rejects, worker has not exited at t=10,000 | At t=10,000 settle exactly `E("REQUEST_TIMEOUT")`, release the session slot and transfer permit/identity to the watcher; C stays unstarted |
  | `cancel-pending-at-deadline`, `close-pending-at-deadline` | Record cancel/close at t=1,000; hold termination/exit through t=10,000 | By t=10,000 settle exactly `E("ACCESS_DENIED")` and release the slot; close publishes no wire result; watcher retains permit/identity |

  In these detached rows, start B and C at t=500 (deadlines t=10,500).
  For an open session, a same-session metadata call completes after settlement.
  In `termination-rejection`, A's second extraction has session-slot start
  t=1,500 (deadline t=11,500); it returns `E("SERVER_BUSY")` immediately with
  zero content starts and no queue entry. In the other detached rows, make
  the same attempt in another open A session at t=10,000 after detach
  (deadline t=20,000); it also refuses immediately. Release B at t=10,001:
  C starts once. At t=10,002 explicitly stop A's test worker and confirm exit:
  its permit/identity release once; previously refused calls never restart.
  A fresh A invocation at t=10,003 can start once on the released permit.
  Inject duplicate late message/error/exit and late termination rejection;
  observe no extra grant/result or retained invocation timer/listener. Cover
  exit immediately before and after ownership transfer. Use the existing
  owned-worker harness with a wall watchdog and clean up every real worker;
  "never exits" is simulated until explicit harness teardown.

  Add these rows to the same AC-08 test; also assert BR-118 v3 explicitly
  with `TestBR118_v3_AC08_detached_exit_preserves_deadline_and_slot_reuse`
  over all detached rows in `tests/read-worker-lifecycle.test.ts`:

  | Parameter row | Given / When | Then |
  | --- | --- | --- |
  | `termination-rejection-final-denial` | Termination rejects at t=1,000; final authorization denies at t=1,001 | Exactly `E("ACCESS_DENIED")`, session slot released; detached permit remains charged until exit |
  | `termination-rejection-final-auth-deadline` | Termination rejects at t=1,000; final authorization stays pending through t=10,000 | Exactly `E("REQUEST_TIMEOUT")` at t=10,000, session slot released; late authorization success/failure cannot publish; permit remains charged until exit |
  | `detach-removes-existing-waiter` | A1 owns a permit and A2 waits in another session; A1 detaches while A2 is live | A2 immediately returns `E("SERVER_BUSY")`, leaves the queue with zero content starts, and never restarts after A1 exits |
  | `detach-diagnostics` | Each detached row above, with canary paths, IDs, names, errors and payloads; later confirm exit and inject duplicate events | Exactly one offer of the fixed detach line, then exactly one offer of the fixed release line; no other text or audit event, no canary; ordinary exit and immediate admission refusals offer neither line |
  | `http-process-stderr` | Through the real HTTP server/session composition, detach a started worker, close its originating session and later confirm exit | Exactly the fixed detach line and fixed release line reach the process stderr port, once each, despite session close; no canary or audit event; verified in `tests/http/extraction-admission.test.ts` under the same AC-08 test name |
  | `diagnostic-failure` | Repeat detach/release with a process diagnostic sink that throws, reenters or never acknowledges | Each line is attempted once; settlement and release keep their original timing/results without waiting, retry or unhandled failure |
  | `two-stuck-workers` | A and B detach and remain alive; skip B's release at t=10,001 in this row; C is already queued and a new distinct identity D requests extraction | A/B and D requests refuse `SERVER_BUSY` immediately, without content or queue entry; C retains its own deadline and starts no content until exit frees capacity; two detach lines, no release lines until explicit worker teardown; no permit is recycled early |
  | `stdio-stuck-worker` | The shared stdio/fallback identity's worker detaches and remains alive | Every later stdio/fallback extraction refuses `SERVER_BUSY` immediately despite the free second permit; metadata still runs; one detach line, no release line until explicit worker teardown |

- **AC-09** (BR-424 v1, BR-120, BR-109) — Given a full queue and canary
  target/source/dependency values, When admission refuses, Then the complete
  result equals `E("SERVER_BUSY")`, with no canary, retry field, queue
  field, new diagnostic or audit event. Queued deadline/cancel give only
  their exact codes above. Given a queued read whose authority is revoked
  before grant, When a permit becomes available, Then it returns exactly
  `E("ACCESS_DENIED")` with zero describe/open/worker starts and releases
  its permit; no cached authorization bypasses policy. Verified by
  `TestBR424_v1_AC09_admission_errors_are_fixed_and_silent` and
  `TestBR423_v1_AC09_granted_waiter_rechecks_authority`.
- **AC-10** (BR-423 v1, BR-111, BR-117) — Given two active pipelines,
  When a third controller requests each of `text`, `pdf`, `image`, a text
  continuation or an empty source, Then each waits with zero content and
  worker starts until grant. Use these exact fixtures and outcomes after
  grant, also characterized without contention before source changes:

  | Row | Source and arguments beyond `file_id:3` | Exact outcome |
  | --- | --- | --- |
  | `text` | `safe`; `format:"text"` | `S` |
  | `continuation` | `safe`; `format:"text",offset:2,etag:'"version-1"'` | `S` with `offset:2,characters_read:2,text:"fe"`; total stays 4 |
  | `empty` | Zero bytes; `format:"text"` | `S` with `size_bytes:0,characters_read:0,total_characters:0,text:""`; zero open calls |
  | `pdf` | `classicPdf(["safe"])` from `tests/helpers/extraction.ts`; `format:"pdf",pages:[1]` | `S` with source `size_bytes` equal to fixture byte length and `format:"pdf"`, without `encoding`, plus `pages:[1],total_pages:1` |
  | `image` | `encodePng({width:1,height:1,data:Buffer.alloc(4,255)})` from `tests/helpers/image-codecs.ts`; `format:"image"` | Two blocks, no `isError`: text JSON `{drive_id:7,file_id:3,etag:'"version-1"',size_bytes:bytes.length,format:"image",width:1,height:1,mime_type:"image/png"}` and `{type:"image",mimeType:"image/png",data:bytes.toString("base64")}` |

  All unmentioned `S` fields remain unchanged in these substitutions.
  A separate controller's `kdrive_info`, `kdrive_download` and resource read
  of the `safe` fixture complete while both permits are held: respectively
  `P({item:{drive_id:7,id:3,name:"a",type:"file",path:"/docs/a"}})`,
  `P({drive_id:7,file_id:3,offset_bytes:0,bytes_read:4,size_bytes:4,
  etag:'"version-1"',encoding:"base64",data:"c2FmZQ==",has_more:false})`,
  and `{contents:[{uri:"kdrive://7/file/3",mimeType:"application/octet-stream",
  blob:"c2FmZQ=="}]}`. Constructing another controller/runtime cannot add capacity.
  Verified by `TestBR423_v1_AC10_formats_share_capacity_and_other_reads_do_not`.
  Retain F-038's exact 8 MiB text success test
  `TestBR070_v4_AC01_eight_MiB_in_16_KiB_chunks_succeeds` in
  `tests/read-boundaries.test.ts` under unsaturated admission; it must still
  return the existing one-character `a` payload with total 8,388,608 and
  exactly one body close. Retain its 8 MiB + 1 refusal control unchanged,
  and `TestBR070_v4_AC01_eight_MiB_PDF_reaches_bounded_extraction_worker`
  in the same file: exact one-page PDF result with text `a`, source size
  8,388,608, 513 body reads and one close under unsaturated admission.

- **AC-11** (BR-423 v1, BR-424 v1) — Given trusted identities bound through
  the production composition, When extraction demand spans their sessions,
  Then each identity holds at most one permit, including detached ownership.
  Verified by `TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter` in
  `tests/extraction-admission-identity.test.ts`, with these exact rows:

  | Row | Given / When | Then |
  | --- | --- | --- |
  | `same-identity` | A1 runs; another session A2 requests extraction | A2 waits with zero content/worker starts although the second permit is free; after A1 exits A2 starts once and returns `S` |
  | `oldest-eligible` | A1 and B1 run; enqueue A2, C1, B2, D1 in that order; release B1 | Skip A2; start C1 only. Release C1: B2 starts before D1. Release A1: A2 starts before D1. Remaining completions return `S` |
  | `no-barging` | Same queue; a newcomer E1 arrives during B1's release | C1 starts first, E1 joins behind A2, B2 and D1; no older eligible waiter is overtaken |
  | `eight-http-sessions` | Bind eight sessions to the same verified issuer/subject; A1 runs, A2 waits, A3–A8 request extraction; while A2 remains queued and the second permit is free, distinct B arrives | One A permit and one A waiter; A3–A8 each return `E("SERVER_BUSY")` immediately; B starts at once without cancelling A2; A2 retains its age and starts once after A1 exits |
  | `one-waiter-per-identity` | A1 and B1 run; enqueue C1, then C2 in another session of C while three queue places remain | C2 returns `E("SERVER_BUSY")` immediately with zero source/worker starts and no queue entry; C1 retains its position; after cancelling C1, a fresh C3 may enqueue once |
  | `identity-key` | Separate identity objects have equal issuer/subject; another has a different issuer or subject | Equal pairs share one allowance across sessions; either differing component permits overlap up to two globally |
  | `stdio-and-fallback` | Separate stdio controllers and controllers without identity request extraction | They share one process-local identity and serialize; the spare permit cannot be used by another stdio/fallback call |
  | `insecure-http` | Two insecure HTTP sessions request extraction | They share one insecure identity and serialize |

  Repeat the identity binding rows through HTTP server/session construction
  in `tests/http/extraction-admission.test.ts` and stdio server composition, not only injected semaphore keys. No tool
  argument can select a different identity. AC-08 verifies detached ownership.
- **AC-12** (BR-424 v1; BR-387 unchanged) — Given README text and
  `docs/mcp-client-compatibility.md` lines 67–71 (`## Parallel tool calls`)
  read from the working tree and the actual `kdrive_read` description returned by tool listing, When the
  documentation contract is checked, Then all three surfaces contain the transient queue
  saturation, no automatic retry, and fresh admission/authorization wording
  above, including the identity/detached refusal and recovery caveat; no surface
  assigns extraction queue saturation to `LIMIT_EXCEEDED`.
  Verified by `TestBR424_v1_AC12_docs_explain_transient_SERVER_BUSY` in
  `tests/extraction-admission-docs.test.ts`. Follow
  `tests/deployment-examples.test.ts`: read files without Git, validate the
  required statements, and seed mutations removing each required statement
  or substituting "LIMIT_EXCEEDED means extraction queue saturation" or
  "SERVER_BUSY guarantees success on retry" on each
  surface; every mutated fixture must fail the validator. Do not merely
  search source code for the tool-description string.

## Test plan

1. After independent review and freeze, before source changes, characterize
   current exact text/PDF/image/continuation/empty results, fresh policy
   refusals, worker error/constructor normalization, termination ordering
   and raw/metadata/resource results on the implementation base. Add BR-named
   cases in the planned suites, preserving existing active BR coverage.
   Reuse the content and worker-lifecycle helpers; first prove the bounded
   three-controller sample, then extend to seven callers for queue overflow.
2. Write AC-01–AC-12 tests first and record the failures on the old code:
   the third pipeline starts immediately and the seventh caller is not refused
   for aggregate capacity. Unchanged characterization controls need not fail.
   Hold reads/workers deterministically; do not infer ordering from sleeps
   or assert nondeterministic RSS/garbage-collection thresholds. Count
   pipeline/worker starts, instrument source buffering, and verify timer/
   listener removal and state drained after every parameter row.
3. Implement only the frozen scope. Inventory `content.complete`,
   `runExtraction`, `createExtractionWorker`, source allocations/copies,
   controller/runtime factories, trusted identity propagation and close paths
   across `src/` and `tests/`. Add the required README and tool-description
   and compatibility wording with AC-12; this assignment tests those future edits.
   Ensure every production extraction shares one owner and no nested
   acquisition, direct-worker path or test-only injection bypasses it.
   Run the affected extraction, read, invocation-queue and HTTP/session
   composition suites, then Docker/Make `make check`.
4. Obtain fresh strong-tier spec approval followed by the strongest-tier
   decision pass before freeze for this resource-exhaustion fix, and the
   corresponding code reviews before merge. PR CI and actual-main AC
   acceptance remain mandatory. Record commands, results, SHA and exposed
   token totals in #47 with lot-D evidence identifiers; lot D alone does
   not close #47. Synchronize accepted records in the next scoped reviewed
   PR before release. No real provider acceptance or new manual operator
   is needed for this process-local invariant.

The supplied Reviews 1–3 and Decisions 1–2 are recorded below; no new
review, approval or token counter is claimed. Tests first is AGENTS.md §3's
standard next step. Host checks under the no-Docker constraint are not
`make check` or CI. Review/usage evidence belongs in the ticket/PR when
those phases occur, not in a new per-run repository file.

## Decisions

- **D-1 — Two active, one per identity, four waiting, fixed across formats.** Two admits
  overlap while reducing the maximum concurrent 8 MiB source payloads from
  512 MiB at 64 sessions to 16 MiB. The current full transfer copy can add
  another 16 MiB across those two pipelines; worker heap guards total
  256 MiB old generation, 32 MiB young generation and 8 MiB stacks at two
  workers. These are separate contributions, not an RSS bound or a measured
  capacity requirement. Even under ideal distinct-identity parallelism,
  eight waiters need four service waves: with two active calls having
  remaining duration R and each queued service taking T, the last pair
  starts at R + 3T and finishes at R + 4T. Four waiters need two waves,
  finishing at R + 2T. Neither fits 10 s in the worst case (R alone can
  approach 10 s); identity conflicts and detached workers can extend it
  further. Choose four to bound retained work, without claiming deadline
  completion. Each waiter expires on its own original deadline. One active
  permit and one live waiter per identity prevent one identity's eight sessions
  from holding both permits or all queue places; oldest-eligible ordering avoids head-of-line blocking while
  preserving age across identities. One active globally would serialize all extraction; four would double these
  concurrent contributions without measured need. Sixty-four active or
  waiting and an unbounded queue retain too much work. Configurability and
  format-weighted budgets add contracts without evidence and are excluded.
- **D-2 — Acquire before the entire complete-source path.** A worker-only
  limit leaves queued source buffers/copies unbounded. Admission before
  `content.complete` also avoids waiting with a body open and makes the
  boundary testable. Hold through final authorization/projection so the
  pipeline's intermediate data is covered until cleanup. A shared internal
  owner, rather than a per-session limiter, covers HTTP and embedded
  controllers in the same parent process. No new ADR is needed for this
  small reversible internal composition choice.
- **D-3 — Existing deadline and non-retried fixed refusal.** Use the
  running invocation deadline for queue waiting; a fresh deadline at grant
  would extend existing work bounds. Retain the worker-specific timeout's
  current start and cap. Choose existing `SERVER_BUSY` for aggregate queue
  saturation, a second waiter of an identity, a detached charged identity
  and all global permits held by detached workers:
  all refuse before source work, matching the existing transient admission
  meaning. `LIMIT_EXCEEDED` remains the size/worker failure code; overloading
  it for queue capacity is rejected. Require README and tool-description
  and MCP compatibility guidance (AC-12, BR-387 unchanged): no server retry, fresh admission/authorization on a later
  client call, and no recovery-time promise. The two fixed lifecycle
  diagnostics signal detached capacity to operators without caller data.
  Refuse new callers immediately when every permit is detached: waiting for
  REQUEST_TIMEOUT would retain their session slots with no usable capacity.
  Existing waiters retain their own deadlines. The process owner creates and
  retains its own stderr sink in both transports; reusing HTTP's absent
  session diagnostic port would silently lose the capacity-loss signal.
- **D-4 — Aggregate ownership with a bounded settlement exception.**
  BR-423–BR-426 add process-wide admission. BR-117's per-invocation ceilings
  and BR-384's pre-invocation queue remain unchanged. BR-118 v2 remains the
  accepted baseline, but the owner explicitly chooses to release a session
  slot on failed/overdue termination while a detached watcher owns the
  worker's permit until exit. Preserve ordinary exit-before-settlement;
  record this narrow exception now in pending BR-118 v3, preserving active
  v2 and its evidence. Termination rejection retains BR-109 final authorization
  within the deadline; it is not an authorization bypass. Indefinitely
  holding the invocation violates its deadline; recycling the permit before
  exit loses external-memory accounting. Neither alternative is accepted.
  BR-070 remains untouched, so F-039's v5 requires no follow-on v6 or semantic
  merge dependency. Shared records need ordinary reconciliation with lot C;
  do not overwrite its reservation, pending clauses or later acceptance.

## Risks

- Two pathological inputs can still consume substantial memory. Worker
  resource limits exclude external allocations; parser scratch, duplicate
  representations, parent results and GC lag remain. This bounds concurrent
  pipelines, not total RSS; existing parser/byte guards remain necessary.
- Slow downloads hold scarce permits before workers start. That is intentional
  to cover source memory. One permit per identity prevents monopolizing both
  permits; oldest-eligible FIFO gives ordering, not guaranteed completion.
  One identity can hold at most one live waiter; four different identities
  can still fill the queue and refuse others. Detached identities are refused
  immediately. No queue reservation or starvation-free throughput is claimed.
- Moving admission after a metadata/open/buffering step, creating one owner
  per session, or releasing on worker-message rather than exit would miss
  the finding. Integration tests need separate controllers, shared production
  composition and real worker lifecycle evidence, not only semaphore tests.
- A worker whose exit cannot be confirmed cannot safely yield its permit.
  This may reduce capacity; recycling it early breaks the active bound.
  The detached watcher retains the permit and identity until exit, potentially
  indefinitely; the invocation still settles and releases its slot within
  10 s. Permanently stuck workers reduce capacity until process restart:
  two halt all extraction, and one blocks all stdio/fallback extraction because
  it shares a single identity. Charged identities get immediate `SERVER_BUSY`;
  when all permits are detached, new callers of every identity also refuse
  immediately. Existing distinct-identity waiters retain their deadlines.
  HTTP currently supplies no session diagnostic port, so AC-08 must exercise
  the real HTTP composition and its process-owned stderr sink after session
  close. The fixed detach diagnostic is the
  operator signal; the fixed release diagnostic signals eventual recovery.
  Both are best effort and blocked stderr can prevent delivery. Other tools
  still run; no automatic restart or process-crash recovery guarantee is added.
- Global test state can leak between cases. Settle/close every controller and
  owned worker; use an isolated internal test owner where needed, and keep
  explicit tests of the shared default. Do not add a production reset hook.
- Bursts previously running concurrently will now wait or refuse. Reusing
  `SERVER_BUSY` uses the existing transient admission meaning and gives no
  fine-grained capacity diagnosis;
  it reveals neither another user's activity nor protected content details.

## Open questions

None. Limits, queue behavior, timing, cancellation and observability are
resolved by D-1–D-4 and the supplied review dispositions.

## Stress-test

### Review 1 dispositions

The owner supplied this review for this revision; the entries below record
its verdict and the disposition of every finding, not a new review or an
approval of the revised head. Reviewer model/effort and token counters were
not supplied (unknown); no usage is inferred. That revision was draft v1.

### 47d-spec-review-1-reviewer — verdict: changes

1. **Major — termination rejection outlives the deadline. Retained, fixed.**
   BR-426 and AC-08 separate invocation settlement from permit ownership:
   live termination rejection returns exactly `CONTENT_UNAVAILABLE`, matching
   `src/extraction.ts`; pending termination reaches `REQUEST_TIMEOUT` by the
   original deadline. The session slot is released; a detached exit watcher
   retains the permit and identity charge until confirmed exit. D-4 explicitly
   records the narrow BR-118 lifecycle exception and its pre-freeze record sync.
2. **Major — one identity monopolizes both permits. Retained, fixed.**
   One active permit per identity includes detached workers. Serve the oldest
   waiter whose identity holds no active permit, preserving skipped callers'
   age. Identity propagation was checked in HTTP/session/navigation and stdio
   code; stdio/fallback use one identity. AC-11 names identity and fairness
   tests, including eight HTTP sessions and no barging.
3. **Minor — queue bound versus deadline. Retained, fixed.**
   Reduce eight waiters to four. D-1 gives R + 4T versus R + 2T drain-time
   arithmetic and makes no promise that either queue drains within 10 s.
4. **Minor — transient LIMIT_EXCEEDED meaning. Retained, fixed.**
   Require README and actual tool-description wording about transient queue
   saturation, no automatic retry and fresh admission/authorization. AC-12
   names a documentation test with seeded invalid variants following the
   deployment-examples patterns; permanent size and worker failure uses stay.
5. **Minor — overflow caller/test mismatch. Retained, fixed.**
   AC-03 and BR-424 E-02 both name the seventh caller, fifth would-be waiter,
   with two active distinct identities and four queued calls. The exact test
   name is `TestBR424_v1_AC03_seventh_caller_fifth_waiter_refuses_LIMIT_EXCEEDED_without_retry`.


### Review 2 / Decision 1 dispositions

The owner supplied `47d-spec-review-2-reviewer` and
`47d-spec-decision-1-fable` for this revision. Both require changes; these
entries record supplied findings and decisions, not a new review or approval.
Reviewer model/effort and token counters were not supplied (unknown).
Decision-pass model: Fable 5.2 per PROJECT.md; actual reported model/effort
and usage remain unknown. No forge publication is performed. That revision stayed draft v1.
The seven dispositions below supersede conflicting Review 1 choices, including
its deferred BR-118 record and its LIMIT_EXCEEDED admission code/test name.

1. **Major — both reviews: missing BR-118 version. Retained, fixed.**
   Add pending BR-118 v3 now, with active v2 preserved, detached AC-08 examples,
   verification and History. Business rules, AC-07/08 and the BR index cite v3;
   the index counts four new pending rules plus one pending existing-rule version.
2. **Major — Decision 1 F-2: silent permanent capacity loss. Retained, fixed.**
   Detach/release each offers one fixed payload-free diagnostic; detached
   identities and their already-live waiters refuse SERVER_BUSY. AC-08 pins
   diagnostics, failed delivery, two stuck workers and the single stdio identity;
   Risks names restart as recovery for permanently stuck workers.
3. **Major — Decision 1 F-3: one identity fills the queue. Retained, fixed.**
   At most one live waiter per identity; a second refuses SERVER_BUSY even
   with free queue places. AC-11 verifies this limit and cancellation recovery.
4. **Minor — both reviews: spare permit behind ineligible waiters. Retained
   with a reachable scenario.** Four ineligible waiters are impossible with
   two permits and one waiter per identity. AC-11's eight-session row keeps
   A2 queued behind A1 while B arrives and immediately takes the spare permit;
   AC-02/03 separately retain the four-distinct-waiter saturation boundary.
5. **Minor — Review 2: AC-08 second-extraction timing. Retained, fixed.**
   A's second extraction in the rejection row starts its slot at t=1,500,
   deadline t=11,500, and now refuses immediately under the detached-identity
   decision. Other detached rows use t=10,000; a fresh post-exit call starts
   at t=10,003. No refused call is later resumed.
6. **Minor — Decision 1 F-5: final authorization. Retained, fixed.**
   Preserve navigation's final authorization before CONTENT_UNAVAILABLE,
   with liveness before/after and deadline-bounded settlement. AC-08 covers
   approval, denial and stalled authorization; BR-109 stays unchanged.
7. **Minor — Decision 1 F-6: admission error meaning. Retained, fixed.**
   Existing navigation/README SERVER_BUSY means refusal before upstream work
   and is retryable by a later client call. Use it for queue/identity capacity,
   synchronize BRs, ACs, test names and AC-12 documentation requirements, and
   correct Risks; LIMIT_EXCEEDED remains the size/worker failure code.


### 47d-spec-review-3-reviewer — verdict: approve, with minors

- **R3-1 — Minor — compatibility retry caveat. Retained, fixed.**
  AC-12 adds `docs/mcp-client-compatibility.md:67–71`, under `## Parallel tool
  calls`, as the third surface requiring the detached-capacity caveat.
  Earlier call completion alone does not prove that a detached permit is
  reusable. BR-387 remains unchanged. Merged with Decision 2 F-3.
- **R3-2 — Minor — stuck-worker timeline and identity. Retained, fixed.**
  AC-08 names the new identity D, preserving C as the queued call, and
  explicitly skips B's t=10,001 release in `two-stuck-workers`.

### 47d-spec-decision-2-fable — verdict: changes, one major

- **F-1 — Major — absent HTTP diagnostic port. Retained, fixed.**
  The process-wide admission owner/exit watcher owns a diagnostic sink,
  created at process start and wired to process stderr in both stdio and
  HTTP compositions, retained after session close. Contract, BR-426 and
  Risks name HTTP's current absent port/no-op default; AC-08 adds the real
  HTTP composition row asserting both fixed lines on the stderr port.
- **F-2 — Permit reuse after abandoned work. Retained, fixed.**
  AC-04 `body` starts a queued third caller once at t=10,000; AC-07 adds
  `final-auth-stalled` with reuse at the deadline and suppressed late results.
- **F-3 — Third documentation surface. Retained, fixed.**
  Merged with R3-1 in AC-12 and the required wording; BR-387 is unchanged.
- **F-4 — All capacity detached. Retained, fixed.**
  D-3 and BR-424 refuse new callers immediately with SERVER_BUSY when all
  permits belong to detached workers. AC-08 `two-stuck-workers` asserts
  D's immediate refusal instead of retaining its slot until REQUEST_TIMEOUT.

These verdicts were supplied by the orchestrator, not generated in this assignment.
No corrected-head approval, forge publication or actual-main acceptance is
claimed. Actual reviewer model/effort and per-agent token counters were not
supplied; no retrospective attribution is inferred.

### 47d-spec-freeze-confirm-1-reviewer — verdict: changes, minors only

- **Minor — `projection-error` precondition.** The freeze added
  `etag:'"version-1"'` to the AC-07 `projection-error` row so the fixture
  reaches projection with a strong validator (F-038 refuses absent or weak
  validators before extraction). Retained as a test-fixture precondition;
  no behaviour change.
- **Minor — AC-11 test location.** AC-11 maps to
  `tests/extraction-admission-identity.test.ts`, with the real HTTP rows in
  `tests/http/extraction-admission.test.ts`, to keep identity scenarios apart
  from the process-wide queue tests. Retained; traceability only.
- **Minor — stale "diagnostic port" wording** in the AC-08
  `diagnostic-failure` row. Fixed: "process diagnostic sink".

---
id: F-040
title: Bound process-wide extraction admission before source buffering
ticket: "#47"
status: draft
version: 1
---

# F-040 — Bound process-wide extraction admission before source buffering

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `fix/47-d-extraction-limit`, supplied main
`c39a77a3f4e996541732d8a6c036f63e4df40a4c` (original draft base).
Review-1 revision base: `6fab436e414ca9a1eb3eb6cb7fde8eb04e7b8773`
(local HEAD verified; no commit created).
IDs: F-040; new BR-423–BR-426 v1; AC-01–AC-12. No existing BR version or ADR.
The owner reserves F-039 for lot C on `fix/47-c-audit-sink`, not yet merged,
including BR-070 v5 and pending versions of BR-240, BR-241, BR-254 and
BR-259. This draft does not edit or version those rules. Next IDs after this
allocation: F-041, BR-427, ADR-013. Recheck current main and concurrent
allocations before freeze and PR; no remote check is authorized here.

This assignment authors the draft and pending records only. Review 1 dispositions are recorded below; revised-spec approval,
decision pass, freeze, tests, implementation and acceptance are pending.
The supplied finding and owner brief are the ticket context; no GitHub access
or ticket-state update is performed under the no-network instruction.

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
  waiters ordered by oldest eligible identity, acquired
  before `content.complete`, with explicit overload, deadline and cancellation
  outcomes and release on every terminal path.
- Preserve per-call source, decoded, structural, worker, output and time
  bounds, fresh authorization, byte evidence and worker isolation.
- Prepare new pending BR records, indexes, provisional capability and changelog.
- Require README and `kdrive_read` description guidance for transient queue
  saturation, verified by a named documentation test in the implementation phase.

### Out of scope

- Other #47 findings/lots, mutation or audit-sink changes, new configuration,
  public schemas, dependencies, worker pooling, cross-process coordination,
  weighted scheduling, per-identity queue reservations or a throughput guarantee.
- A hard RSS or external-memory byte cap, OS isolation, parser budget changes,
  new format support, source caching, retry/backoff or changes to raw downloads
  and resource reads. They do not acquire extraction permits.
- Source/test edits, Docker, network, commits, PR publication, review, freeze,
  acceptance or release in this authoring assignment. No current rule is
  promoted or marked accepted by these records.

## Business rules

- **BR-423 v1** — Every extraction pipeline holds one of two process-wide
  permits before entering complete-source acquisition, with at most one held
  permit per identity. Verified by: AC-01, AC-02, AC-09, AC-10, AC-11.
- **BR-424 v1** — Contended extraction admission uses at most four live
  waiters, serving the oldest whose identity holds no active permit, and
  immediately refuses a caller unable to obtain an eligible permit or queue
  place with `LIMIT_EXCEEDED`,
  without an automatic retry. Verified by: AC-02, AC-03, AC-09, AC-11, AC-12.
- **BR-425 v1** — Extraction waiting uses the running invocation's existing
  deadline and cancellation state, removing dead waiters before they can
  acquire a permit or start content work. Verified by: AC-04, AC-05, AC-06.
- **BR-426 v1** — Every granted permit remains charged until owned source cleanup
  and confirmed worker exit, then releases exactly once; failed or overdue
  termination transfers ownership to a detached exit watcher while the
  invocation settles no later than its deadline and releases its session slot.
  Verified by: AC-06, AC-07, AC-08.

Dependencies (unchanged except the proposed BR-118 lifecycle exception): [BR-070 v4](../business-rules/BR-070.md) (invocation
bounds; lot C reserves v5), [BR-084](../business-rules/BR-084.md) and
[BR-089](../business-rules/BR-089.md) (exact body evidence and ownership),
[BR-109](../business-rules/BR-109.md) (fresh authorization),
[BR-111](../business-rules/BR-111.md) (complete source),
[BR-117](../business-rules/BR-117.md) (per-invocation bounds),
[BR-118 v2](../business-rules/BR-118.md) (accepted owned-worker baseline;
F-040 proposes the explicit failed/overdue-termination exception below),
[BR-120](../business-rules/BR-120.md) (fixed redacted errors),
[BR-121](../business-rules/BR-121.md) (own-data projections),
[BR-122 v3](../business-rules/BR-122.md) and
[BR-209](../business-rules/BR-209.md) (worker dependencies and hygiene),
[BR-384 v2](../business-rules/BR-384.md) (per-session slot starts the
invocation deadline). BR-112–BR-116, BR-390–BR-391 and BR-412–BR-420 retain
their text/PDF/image behavior. F-040 adds aggregate admission; it changes
none of the byte/time bounds or F-026's per-session queue. The sole lifecycle
exception to BR-118 v2 is recorded in D-4; do not describe it as unchanged.

## Contract details

### Admission, ordering and ownership

Use fixed internal constants `MAX_ACTIVE_EXTRACTIONS = 2` and
`MAX_WAITING_EXTRACTIONS = 4` and
`MAX_ACTIVE_EXTRACTIONS_PER_IDENTITY = 1`. The default composition shares one admission
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
queue entry remains as a tombstone. A waiter is eligible only when its
identity holds no active permit, including permits held by detached exit
watchers. Whenever capacity is free, serve the oldest live eligible waiter,
repeating while another permit and eligible waiter remain. Skip an ineligible
waiter without moving its queue position: FIFO is preserved among eligible
identities, and skipped callers retain their original age. A newcomer may
start only after older eligible waiters have been served and only if its
identity holds no active permit. Otherwise enqueue if fewer than four live
waiters remain; with four, refuse immediately. An ineligible queue head must
not leave capacity idle when an eligible waiter exists. If all waiters are
ineligible, the spare permit stays idle. Release the old identity's charge
and assign the next identity atomically with the permit handoff.

With distinct identities, two active calls plus four waiters are admitted;
the seventh caller (fifth would-be waiter) refuses. A second extraction from
an active identity waits even if the other global permit is free; it uses
one of the same four queue places. Queue saturation may therefore occur
with only one active permit. There is no per-identity queue reservation.

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
its permit and identity charge to a detached exit watcher and settle the
invocation immediately as `E("CONTENT_UNAVAILABLE")`, releasing its session
slot. This is the existing termination-rejection code in `src/extraction.ts`.
It is a fixed lifecycle failure, carries no content, and requires no new
policy/dependency call before settlement. If termination is still pending
at the invocation deadline, detach the same ownership and settle exactly
as `E("REQUEST_TIMEOUT")` at that deadline. A previously recorded cancel/
close retains `E("ACCESS_DENIED")`; a closed session publishes no wire result.
Liveness is checked before choosing the failure: at or beyond the deadline,
with no earlier recorded abort cause, `REQUEST_TIMEOUT` wins over a late
termination rejection. No success or content-dependent result is published
while exit is unconfirmed, and no termination promise can extend the 10 s
invocation deadline. This is an explicit exception to BR-118 v2's ordinary
exit-before-slot-release ordering, not to memory accounting.

Install the exit observer before requesting termination; transfer ownership
atomically with an already-observed-exit check so exit/rejection/deadline
races cannot lose or duplicate a release. The detached watcher retains only
the worker handle, minimal exit/error-drain bookkeeping and the permit/
identity release token, not the invocation, session, source or result. It
consumes late messages/errors without publishing or retaining their payloads.
Only confirmed exit releases the permit and identity charge exactly once.
A fulfilled termination acknowledgment counts only when it confirms exit;
a rejection never does. If the worker never exits, its permit and identity
remain charged indefinitely, but its invocation and session slot do not.
At most two such watchers can exist because each owns a global permit.
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
| Four live waiting and no immediate eligible grant | `E("LIMIT_EXCEEDED")` | None; no retry or retry timer |
| Queued invocation reaches its deadline | `E("REQUEST_TIMEOUT")` | None; removed from queue |
| Queued invocation cancelled or session closed | `E("ACCESS_DENIED")` | None; removed from queue |
| Live invocation: termination rejects before worker exit | `E("CONTENT_UNAVAILABLE")` immediately | Session slot released; detached watcher retains permit/identity until exit |
| Termination still pending at invocation deadline, no earlier cancel/close | `E("REQUEST_TIMEOUT")` by t=10,000 ms | Session slot released; detached watcher retains permit/identity until exit |
| Other admitted extraction failure | Existing fixed failure code | Existing cleanup and authorization rules |

A closed session publishes no wire result. No new diagnostic, audit event,
HTTP status, `Retry-After`, queue position/count, target identifier or
dependency message is emitted by extraction admission. In particular, a
full queue is not `SERVER_BUSY`, whose per-session retry guidance stays
unchanged. The server does not automatically retry any admission refusal;
a later client invocation is a new admission with fresh authorization.
Existing download retries after successful admission retain their contract.

The README `kdrive_read` guidance and its registered tool description must
both include: "LIMIT_EXCEEDED may be transient when the extraction queue is
saturated. The server does not automatically retry; a later client invocation
requires fresh admission and authorization." Retain the existing meaning for
permanent size limits and worker error/exit; this code alone does not identify
the cause or promise success on retry. Verify both surfaces with AC-12.

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
  When a seventh caller (fifth would-be waiter) arrives, Then it returns exactly `E("LIMIT_EXCEEDED")`
  without advancing time, with zero content calls, buffering and worker
  starts for that call. Free a slot and advance controlled time: that
  refused call never starts again and schedules no retry. A new invocation
  can join once capacity exists. Verified by
  `TestBR424_v1_AC03_seventh_caller_fifth_waiter_refuses_LIMIT_EXCEEDED_without_retry`.
- **AC-04** (BR-425 v1, BR-384 v2) — Given a running invocation with
  session-slot start at t=0 that joins extraction waiting at t=2,000 ms,
  When it still waits at t=9,999, Then it remains pending; at t=10,000 it
  returns exactly `E("REQUEST_TIMEOUT")`, leaves the queue and never
  starts content, even after a permit is freed. In a second row, grant at
  t=9,000 and stall its body read: the same result occurs at t=10,000 with
  its read signal aborted, one body close and no worker. In a third row,
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
- **AC-07** (BR-426 v1, BR-118 v2) — Given two active pipelines and a
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
  | `projection-error` | Four-character `safe`, requested offset 5 | `E("INVALID_RANGE")` |
  | `final-denial` | Policy revoked after worker success | `E("ACCESS_DENIED")` |
  | `timeout` | Worker reaches `extractTimeoutMs` before invocation expiry | `E("REQUEST_TIMEOUT")` |
  | `invocation-timeout` | Worker remains pending at invocation expiry | `E("REQUEST_TIMEOUT")` |
  | `cancel` | Active worker's invocation is aborted | `E("ACCESS_DENIED")` |
  | `close` | Active worker's session closes | `E("ACCESS_DENIED")`; no wire result |

- **AC-08** (BR-426 v1) — Given two held permits for identities A and B
  and a queued extraction C, When A's real started worker begins cleanup,
  Then enforce the following exact outcomes with slot start t=0. Verified by
  `TestBR426_v1_AC08_worker_exit_precedes_permit_reuse` in
  `tests/read-worker-lifecycle.test.ts`.

  | Parameter row | Controlled termination/exit | Exact result and ownership |
  | --- | --- | --- |
  | `success`, `error`, `timeout`, `cancel`, `close` | Hold acknowledgment, then confirm exit before t=10,000 | Until exit the permit and session slot stay held and C never starts; on exit settle once with respectively `S`, `E("LIMIT_EXCEEDED")`, `E("REQUEST_TIMEOUT")`, `E("ACCESS_DENIED")`, `E("ACCESS_DENIED")` (close: no wire result), release once and start C once |
  | `termination-rejection` | Reject termination at t=1,000 while A's worker keeps running beyond t=10,000, with no abort | At t=1,000 settle exactly `E("CONTENT_UNAVAILABLE")` and release A's session slot; a detached watcher keeps A's permit and identity charged; at t=10,000 C still has zero starts and A has no second result |
  | `termination-pending-at-deadline` | Termination neither resolves nor rejects, worker has not exited at t=10,000 | At t=10,000 settle exactly `E("REQUEST_TIMEOUT")`, release the session slot and transfer permit/identity to the watcher; C stays unstarted |
  | `cancel-pending-at-deadline`, `close-pending-at-deadline` | Record cancel/close at t=1,000; hold termination/exit through t=10,000 | By t=10,000 settle exactly `E("ACCESS_DENIED")` and release the slot; close publishes no wire result; watcher retains permit/identity |

  In detached rows, start B and C at t=500 (their deadlines are t=10,500).
  For a session still open, a same-session metadata call completes after settlement;
  a new extraction for A in an open session waits with zero content starts.
  Release B at t=10,001: C starts once while A still cannot acquire.
  At t=10,002 explicitly stop A's test worker and confirm exit: its permit/identity
  release once and A's oldest eligible waiter starts. Inject duplicate late
  message/error/exit and late termination rejection after timeout; observe
  no extra grant/result or retained invocation timer/listener. Cover exit
  immediately before and after ownership transfer. Use the existing owned-
  worker harness with a wall watchdog and clean up every real test worker;
  "never exits" is simulated until explicit harness teardown.
- **AC-09** (BR-424 v1, BR-120, BR-109) — Given a full queue and canary
  target/source/dependency values, When admission refuses, Then the complete
  result equals `E("LIMIT_EXCEEDED")`, with no canary, retry field, queue
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
  `tests/extraction-admission.test.ts`, with these exact rows:

  | Row | Given / When | Then |
  | --- | --- | --- |
  | `same-identity` | A1 runs; another session A2 requests extraction | A2 waits with zero content/worker starts although the second permit is free; after A1 exits A2 starts once and returns `S` |
  | `oldest-eligible` | A1 and B1 run; enqueue A2, C1, B2, D1 in that order; release B1 | Skip A2; start C1 only. Release C1: B2 starts before D1. Release A1: A2 starts before D1. Remaining completions return `S` |
  | `no-barging` | Same queue; a newcomer E1 arrives during B1's release | C1 starts first, E1 joins behind A2, B2 and D1; no older eligible waiter is overtaken |
  | `eight-http-sessions` | Bind eight sessions to the same verified issuer/subject; A1 runs, A2–A5 queue; A6–A8 request extraction | One permit held by A, four waiters, A6–A8 each return `E("LIMIT_EXCEEDED")`; after cancelling queued A2 to free a queue place, distinct identity B starts on the spare permit while A1 remains held |
  | `identity-key` | Separate identity objects have equal issuer/subject; another has a different issuer or subject | Equal pairs share one allowance across sessions; either differing component permits overlap up to two globally |
  | `stdio-and-fallback` | Separate stdio controllers and controllers without identity request extraction | They share one process-local identity and serialize; the spare permit cannot be used by another stdio/fallback call |
  | `insecure-http` | Two insecure HTTP sessions request extraction | They share one insecure identity and serialize |

  Repeat the identity binding rows through HTTP server/session construction
  and stdio server composition, not only injected semaphore keys. No tool
  argument can select a different identity. AC-08 verifies detached ownership.
- **AC-12** (BR-424 v1) — Given README text read from the working tree and
  the actual `kdrive_read` description returned by tool listing, When the
  documentation contract is checked, Then both contain the transient queue
  saturation, no automatic retry, and fresh admission/authorization wording
  above; neither claims that every `LIMIT_EXCEEDED` is permanent or transient.
  Verified by `TestBR424_v1_AC12_docs_explain_transient_queue_saturation` in
  `tests/extraction-admission-docs.test.ts`. Follow
  `tests/deployment-examples.test.ts`: read files without Git, validate the
  required statements, and seed mutations removing each required statement
  or adding "LIMIT_EXCEEDED always means a permanent size limit" on each
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
   wording with AC-12; this assignment only specifies those future edits.
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

No test or gate is run in this spec-only, no-Docker assignment; document
content checks are not `make check` or CI. The supplied Review 1 is recorded below; no new review, approval or token
counter is claimed. Review/usage evidence belongs in the ticket/PR when
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
  permit per identity prevents one identity's eight sessions from holding
  both permits; oldest-eligible ordering avoids head-of-line blocking while
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
  current start and cap. Choose `LIMIT_EXCEEDED` for aggregate queue
  saturation, avoiding new public error codes or `SERVER_BUSY`'s retry
  guidance. `src/extraction.ts` also uses this code for worker error/exit;
  existing size limits keep their permanent meaning. Require the README and
  tool description to state that queue saturation may be transient (AC-12),
  without exposing a cause discriminator or encouraging automatic retries.
  The exact tool error is the observable signal; adding an event
  catalogue or logging caller data is unnecessary.
- **D-4 — Aggregate ownership with a bounded settlement exception.**
  BR-423–BR-426 add process-wide admission. BR-117's per-invocation ceilings
  and BR-384's pre-invocation queue remain unchanged. BR-118 v2 remains the
  accepted baseline, but the owner explicitly chooses to release a session
  slot on failed/overdue termination while a detached watcher owns the
  worker's permit until exit. Preserve ordinary exit-before-settlement;
  record this narrow exception in a pending BR-118 version before freeze
  (its canonical record is not edited in this draft revision). Indefinitely
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
  One identity can still fill the four queue places, so queue refusal can
  affect others. No queue reservation or starvation-free throughput is claimed.
- Moving admission after a metadata/open/buffering step, creating one owner
  per session, or releasing on worker-message rather than exit would miss
  the finding. Integration tests need separate controllers, shared production
  composition and real worker lifecycle evidence, not only semaphore tests.
- A worker whose exit cannot be confirmed cannot safely yield its permit.
  This may reduce capacity; recycling it early breaks the active bound.
  The detached watcher retains the permit and identity until exit, potentially
  indefinitely; the invocation still settles and releases its slot within
  10 s. Both stuck permits can halt all extraction admission, but waiting
  calls still time out and other tool paths can run. No process-crash recovery guarantee is added.
- Global test state can leak between cases. Settle/close every controller and
  owned worker; use an isolated internal test owner where needed, and keep
  explicit tests of the shared default. Do not add a production reset hook.
- Bursts previously running concurrently will now wait or refuse. Reusing
  `LIMIT_EXCEEDED` intentionally gives no fine-grained capacity diagnosis;
  it reveals neither another user's activity nor protected content details.

## Open questions

None. Limits, queue behavior, timing, cancellation and observability are
resolved by D-1–D-4 for independent review; no owner decision is required to
complete this draft.

## Stress-test

### Review 1 dispositions

The owner supplied this review for this revision; the entries below record
its verdict and the disposition of every finding, not a new review or an
approval of the revised head. Reviewer model/effort and token counters were
not supplied (unknown); no usage is inferred. This revision remains draft v1.

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

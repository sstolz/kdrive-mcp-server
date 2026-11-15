---
id: F-038
title: Separate stream reads from operation budgets and refuse weak validators
ticket: "#47"
status: draft
version: 1
---

# F-038 — Separate stream reads from operation budgets and refuse weak validators

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `fix/47-b-stream-budget`, main
`2f80ff87e3aea98968d65c56a8337a38ae130a78`.
IDs: F-038; BR-070 v4, BR-205 v2 and BR-384 v2; AC-01–AC-09.
No new BR ID or ADR. Next free IDs checked in the supplied main checkout:
F-038, BR-423, ADR-013. Recheck on main before freeze and before the PR;
no remote check was performed.

## Context

Ticket #47 lot B addresses findings 2 and 6 of the supplied cross-vendor
review. Content callers can currently exhaust the 512-operation invocation
budget just by consuming a response. `src/content.ts` calls the runtime
wrapper for every body read, including the EOF probe; `src/navigation.ts`
charges that wrapper as a dependency operation. An 8 MiB source needs 512
reads at the maximum 16 KiB chunk size, another read for EOF, and separate
metadata/authorization operations. Even a small source fails when delivered
in enough fragments. The source remains within its byte cap in both cases.

Separately, `derivedETag` in `src/kdrive/adapter.ts` hashes any admitted
provider validator into a strong-looking `"kd1-…"` value. Hashing a weak
validator does not establish byte identity. The owner requires a value
starting with the case-sensitive prefix `W/` to follow exactly the absent
validator path. The owner reports a live download without an ETag; this
draft does not independently establish a provider-wide observation or add
a fallback version scheme. Existing no-ETag refusals remain intentional.

## Scope

- Separate response-body reads from charged upstream operations in the
  content runtime, including the final EOF check and every content consumer.
- Preserve the 512-operation ceiling, five-list ceiling, retries, byte caps,
  cancellation, cleanup, output bounds and existing deadlines.
- Exclude `W/` validators from BR-205 derivation in both `describe` and
  `open`, preserving the existing no-ETag result at each stage.
- Prepare pending BR versions and index/capability/changelog records.

### Out of scope

- Other #47 lots, new limits or configuration, new retry policies, mutation
  behavior, relaxed range/length evidence or full-body download fallback.
- A content hash, metadata-based version, alternative validator, or support
  for reading unversioned content. No full RFC entity-tag grammar migration.
- Replacing the existing dependency-operation accounting with a new
  transport-wide counter of every physical HTTP request, including
  metadata/probe/redirect hops (D-1). This is a BACKLOG-worthy follow-up
  requiring a separate transport/accounting contract.
- Source/test edits, Docker, network, commits, review, freeze, implementation,
  acceptance and release in this authoring step. The owner explicitly
  authorized Codex as author; later phases retain the repository's reviews.

## Business rules

- **BR-070 v4** — The existing 512 upstream-operation budget excludes reads
  from an already-open response body, including EOF probes; those reads
  remain bounded by bytes, the existing invocation deadline and lifecycle
  checks, and are never retried. All v3 behavior otherwise holds, including
  the committed-mutation exception. Verified by: AC-01–AC-06.
- **BR-205 v2** — A provider validator starting with the exact prefix `W/`
  is normalized to `null`, exactly like an absent validator, wherever
  BR-205 derivation is used; all other v1 derivation conditions and bytes
  are unchanged. Verified by: AC-07–AC-09.
- **BR-384 v2** — v1's slot-start and budget-reset rules hold with the
  512 budget counting upstream operations and excluding response-body
  reads; no stream read resets or extends the invocation deadline.
  Verified by: AC-04–AC-06.

Unchanged dependencies: [BR-073](../business-rules/BR-073.md) (five lists),
[BR-084](../business-rules/BR-084.md) (exact range/body evidence),
[BR-085](../business-rules/BR-085.md) (raw/output byte bounds),
[BR-088](../business-rules/BR-088.md) (pre-body retries),
[BR-089](../business-rules/BR-089.md) (owned body lifecycle),
[BR-111](../business-rules/BR-111.md) (complete bounded extraction source),
[BR-117](../business-rules/BR-117.md) (cumulative extraction bounds),
[BR-118 v2](../business-rules/BR-118.md) (worker lifecycle),
[BR-195](../business-rules/BR-195.md) (transport bounds),
[BR-206](../business-rules/BR-206.md) (`open` uses BR-205 normalization),
and [BR-207](../business-rules/BR-207.md) (preflight bounds).

## Contract details

### Accounting and lifecycle

Keep the current operation admission points: authorization metadata,
discovery/listing, `describe`, `open` and their admitted retry attempts
consume the same shared operation budget as before. The 513th operation
is refused with `LIMIT_EXCEEDED` before its port is invoked. The five-list
limit and retry attempt/wait bounds stay unchanged. Reaching 512 operations
does not itself forbid consuming a body already opened by an admitted
operation; any subsequent required authorization operation still needs
budget and may refuse publication.

Data reads and the `read(1)` EOF probe instead use a deadline/cancellation
guard without charging an operation. Check liveness before starting and
after completing each read, race a pending read against cancellation and
deadline, retain error normalization, never retry a body read, and close
the owned body exactly once. A late read cannot publish bytes or start
another read. Preserve the abort signal and final authorization checks.
Do not merely delete the wrapper: that would lose pending-read settlement.
Do not reset the deadline at chunk boundaries or introduce a fragment cap.

The permitted source length and requested range remain the byte bounds.
Reads request at most `min(16384, remaining)` bytes; only nonempty byte
chunks no larger than requested are admitted. Early EOF, an empty chunk,
an oversized chunk, or data instead of the final EOF retain
`CONTENT_UNAVAILABLE`; an oversized declared extraction source retains
`LIMIT_EXCEEDED` before `open`. No partially accumulated result is returned.
The 10,000 ms invocation deadline and any earlier existing transport or
extraction timeout remain in force.

The targeted source audit found two body-charge sites in `src/content.ts`
(data loop and EOF), both routed through `bounded`/`call` in
`src/navigation.ts`. The separate increment at mutation execution remains.
`src/kdrive/adapter.ts` preflight increments once before `transport.json`,
not per chunk; its 1,024-request and 120,000 ms bounds remain unchanged.
`src/kdrive/transport.ts` body reads do not charge that preflight counter.
At implementation repeat this inventory across `src/` and `tests/`, including
`512`, `PREFLIGHT_REQUESTS`, `BR-070`, `BR-088`, `BR-207`, `BR-384`,
`derivedETag`, `etag`, `If-Match`, budget increments and body reads, so
another chunk-charging or validator-consuming path is not overlooked.

### Validator results

The source inventory (`rg -n -i 'derivedETag|etag|if-match' src/`) confirms
that provider validators are consumed only by `describe` and `open` through
`derivedETag`. No mutation or `If-Match` path uses provider validators;
there is no `If-Match` path in the current source.

The prefix test is case-sensitive and applies before hashing: `W/"x"`
returns `null`; `w/"x"` retains the current opaque-validator derivation.
Do not strip `W/`, lowercase, trim or otherwise transform the value.
Strong `"x"` keeps the exact old digest over its Latin-1 bytes, including
the quotes. The existing 1–256 visible-ASCII validation remains unchanged.

For a valid 16-byte file and valid probe headers, `describe` with weak or
absent ETag returns exactly
`{target:{driveId:D,id:I},size_bytes:16,etag:null,version_bound:false}`.
The content caller returns `VERSION_UNAVAILABLE` without calling `open`.
For valid range headers on `open`, weak or absent ETag returns the same
range envelope/body as before with `etag:null`. If `describe` supplied a
strong version first, the content caller then returns `CONTENT_UNAVAILABLE`,
closes that body without reading it, and publishes no bytes. Do not change
this to `VERSION_CHANGED` (reserved for a different strong ETag) or to
`VERSION_UNAVAILABLE` (the descriptor-stage refusal).

## Acceptance criteria

Names below are exact planned test names, not existing-test or execution
claims. `E(code)` denotes the complete controller result
`{isError:true,content:[{type:"text",text:code}]}`. `P(value)` denotes
`{content:[{type:"text",text:JSON.stringify(value)}]}` with no `isError`.
Use synthetic bytes, ports and controlled time; later transport checks use
the existing local double. No live provider or real write is required.

- **AC-01** (BR-070 v4, BR-111, BR-117) — Given `contentFixture` with
  8,388,608 ASCII `a` bytes, `maxReadBytes=8388608`,
  `maxExtractBytes=8388608`, valid range/ETag evidence and time within all
  existing deadlines, When `kdrive_read` receives
  `{file_id:3,format:"text",length:1}`, Then 512 reads of 16,384 bytes and
  one EOF read succeed, with one `describe`, one `open`, one body close,
  and exactly `P({drive_id:7,file_id:3,etag:'"version-1"',
  size_bytes:8388608,format:"text",offset:0,characters_read:1,
  total_characters:8388608,text:"a",has_more:true,next_offset:1,
  encoding:"utf-8"})`. The complete source is read despite the one-character
  output; raw-output limits are not enlarged. Verified by
  `TestBR070_v4_AC01_eight_MiB_in_16_KiB_chunks_succeeds` in
  `tests/read-boundaries.test.ts`.
- **AC-02** (BR-070 v4, BR-084, BR-088) — Given `contentFixture` with a
  600-byte all-zero file and no retries,
  When `kdrive_download` receives `{file_id:3}` with either 600 one-byte
  fragments or one 600-byte fragment, each followed by EOF, Then both
  return exactly `P({drive_id:7,file_id:3,offset_bytes:0,bytes_read:600,
  size_bytes:600,etag:'"version-1"',encoding:"base64",data:"A".repeat(800),
  has_more:false})`. Read counts are 601 and 2 respectively; each body
  closes once. Both rows start exactly one `describe`, one `open` and four
  authorization `inspect` calls: initial authorization, before `describe`,
  before `open` and final authorization. Assert these observable mock call
  counts from `tests/helpers/content.ts` and `tests/helpers/navigation.ts`,
  not the internal charged-operation counter. Verified
  by `TestBR070_v4_AC02_fragmentation_does_not_consume_operations` in
  `tests/download-retry.test.ts`. This replaces the obsolete expectation
  in `TestBR088_shared_retry_budgets body reads share512 actual starts`.
- **AC-03** (BR-070 v4, BR-084, BR-111, BR-117) — Given AC-01's caps,
  When the descriptor declares 8,388,609 bytes, Then return exactly
  `E("LIMIT_EXCEEDED")` with zero `open` calls. Given the AC-02 600-byte
  range, When its reader instead supplies a 601-byte chunk on a request
  for 600, or supplies 600 one-byte chunks then another byte on the EOF
  probe, Then return exactly `E("CONTENT_UNAVAILABLE")`, close once and
  publish no data; read counts are respectively 1 and 601. Empty first
  chunk and early EOF also give that error after one read. Verified by
  `TestBR070_v4_AC03_declared_source_over_byte_cap_refuses_before_open`
  in `tests/read-boundaries.test.ts` and
  `TestBR070_v4_AC03_stream_byte_evidence_remains_bounded` in
  `tests/download-boundaries.test.ts` (one test iterates the four rows).
- **AC-04** (BR-070 v4, BR-384 v2, BR-089) — Given AC-02 with the first
  read pending, or 600 bytes consumed and the EOF probe pending, When
  fake monotonic time reaches 10,000 ms from slot acquisition, Then
  return exactly `E("REQUEST_TIMEOUT")`, abort the read signal and close
  once. No further read/operation or result appears if the pending read
  later resolves; a subsequent invocation can take the slot. A read that
  returns fragments through 9,999 ms does not extend the deadline. Given
  cancellation or session close during either pending-read case, Then the
  controller settles as `E("ACCESS_DENIED")`, closes once and suppresses
  late success (a closed session publishes no wire result). Verified by
  `TestBR070_v4_AC04_pending_data_and_EOF_obey_deadline` and
  `TestBR070_v4_AC04_pending_data_and_EOF_obey_cancel_and_close` in
  `tests/download-retry.test.ts`.
- **AC-05** (BR-070 v4, BR-073, BR-088) — Given the existing received-root
  boundary fixture with 255 discovery inspections, 255 fresh anchor reads
  and two list calls, When path resolution runs, Then all 512 real
  upstream operations start and the root projection succeeds. With three
  list calls required, Then return exactly `E("LIMIT_EXCEEDED")` and only
  512 operations start: the 513th port is not invoked. These are upstream
  operation starts, never body-read stand-ins. Verified by
  `TestBR070_v4_AC05_operation_512_succeeds_and_513_never_starts` in
  `tests/navigation-boundaries.test.ts`, retaining the inputs/assertions
  of `BR-070 dependency call 512 succeeds and 513 refuses without invoking the port`.
  Retain `TestBR088_shared_retry_budgets fifth list attempt prevents sixth retry`:
  five starts, exactly `E("LIMIT_EXCEEDED")`, no sixth attempt.
- **AC-06** (BR-384 v2, BR-207) — Given consecutive invocations, When the
  first spends 512 operations and the next takes the slot, Then the next
  has its own full 512-operation budget; waiting 9,000 ms does not reduce
  its 10,000 ms deadline, and a pending read times out 10,000 ms after
  its own slot acquisition. Verified by
  `TestBR384_v2_AC06_waiting_and_prior_operations_do_not_spend_stream_deadline`
  in `tests/invocation-queue.test.ts`. Preserve BR-207 unchanged and retain
  `TestBR207_exhausted_request_budget_gives_PREFLIGHT_FAILED` and
  `TestBR207_120000_ms_bound_gives_PREFLIGHT_FAILED` in
  `tests/kdrive/adapter-preflight.test.ts`: respectively exactly 1,024
  requests with no 1,025th, and timeout at 120,000 ms, both mapped to
  `PREFLIGHT_FAILED`. Do not turn either into a fragment-count test.
- **AC-07** (BR-205 v2) — Given the valid 16-byte descriptor fixture,
  When the probe returns `W/"x"` or no ETag, Then both return the exact
  null/unbound descriptor above and the controller returns exactly
  `E("VERSION_UNAVAILABLE")`, with zero `open` calls. The probe body is
  closed. Verified by
  `TestBR205_v2_AC07_weak_descriptor_matches_absent_validator` in
  `tests/kdrive/adapter-content.test.ts` (assert the equivalent existing
  client-double projection `{error:"VERSION_UNAVAILABLE"}` when using
  that suite's client helper).
- **AC-08** (BR-205 v2, BR-206, BR-084) — Given a strong descriptor and
  valid range headers, When `open` returns `W/"x"` or no ETag, Then both
  have `etag:null` and the content controller returns exactly
  `E("CONTENT_UNAVAILABLE")`, with zero body reads and one body close.
  No retry or bytes are published. Verified by
  `TestBR205_v2_AC08_weak_open_matches_absent_validator` in
  `tests/kdrive/adapter-content.test.ts` (client-double projection
  `{error:"CONTENT_UNAVAILABLE"}`).
- **AC-09** (BR-205 v2) — Given `derivedETag`, When the input is `W/"x"`,
  `W/`, undefined, `"x"` or `w/"x"`, Then the first three return `null`
  and the last two return exactly `"kd1-` plus the base64url SHA-256 of
  the unchanged Latin-1 input bytes plus `"`. Given strong `"x"` on
  both describe/open for the existing 16-byte fixture, Then its descriptor
  is version-bound and its exact download payload remains byte-for-byte
  identical to the baseline. Retain the existing 256-byte accepted and
  257-byte refused boundaries. Verified by
  `TestBR205_v2_AC09_prefix_is_case_sensitive_and_strong_derivation_unchanged`
  in `tests/kdrive/adapter-content.test.ts`.

## Test plan

1. After independent review and freeze, before source changes, add and run
   characterization tests for strong/absent validators in both adapter
   methods, exact-body failures, pending-read cleanup and operation limits.
   Run the existing download, read-boundary, navigation-boundary, invocation
   queue, adapter-content and adapter-preflight suites on the implementation
   base; record results rather than assuming they pass.
2. Write AC-01–AC-09 tests first. Record failures for valid fragmented
   reads and weak validators on the old implementation. Keep unchanged
   boundaries green as characterization controls; not every new assertion
   is expected to fail. The old 600-byte fixture never emitted EOF: fix
   that fixture for AC-02, and preserve its endless-data refusal in AC-03.
3. Implement only the frozen contract. Re-run the source inventory and
   the affected suites. Keep body reads non-retryable and test both data
   and EOF stalls with fake time/controlled promises, not real sleeps.
   Preserve transport byte/idle bounds, retry charging, final authorization
   and the committed-mutation exception. Run `make check` through Docker/Make.
4. Obtain the required fresh strong-tier review and, because version binding
   is security-sensitive, the strongest-tier decision passes on the spec
   before freeze and code before merge, following strong-tier approval.
   PR CI and actual-main acceptance remain mandatory. Publish evidence and
   exposed token totals in #47, scoped to lot B; this lot alone cannot
   close the other lots. Synchronize accepted markers in the next reviewed
   PR before release.

This revision step runs no product tests or Docker gate and claims no CI,
new review, freeze or acceptance. The supplied review's dispositions are
recorded below. No source/test edits or commits are made.

## Decisions

- **D-1 — Separate stream consumption, preserve operation accounting.**
  Keep 512 at the existing upstream dependency-operation boundary, including
  retries; do not increase it, charge fragments, or set another fragment
  ceiling. Production dependency operations issue HTTP requests, but an
  adapter operation can include several requests (e.g. `describe` metadata
  plus probe, or a storage redirect). This repair does not introduce an
  exact 512-physical-HTTP-hop cap that the current code does not implement.
  BR-207 separately continues counting preflight requests. The owner resolved
  OQ-1 in this revision by selecting the existing charging points; counting
  every physical HTTP request is a separate, out-of-scope follow-up.
- **D-2 — Keep guarded reads.** A dedicated internal stream-read path
  separates accounting from deadline/error/cleanup behavior. An unguarded
  direct `await body.read` is rejected because a stalled promise could
  retain the slot. No public port or MCP schema needs to change.
- **D-3 — Treat weak as absent at both derivation sites.** Apply the
  owner's exact case-sensitive `W/` rule to the shared derivation helper.
  Stripping the prefix or hashing it is rejected because neither makes a
  weak validator strong. A broader syntax migration or fallback hash would
  change unrelated contracts and is excluded.
- **D-4 — Version only changed definitions.** Prepare BR-070 v4, BR-205 v2
  and BR-384 v2 in their canonical files using the F-037 convention:
  new version/source metadata with `status: active`, preserved current
  definitions/evidence and explicit pending blocks. BR-088 retains its
  rule; its obsolete body-budget test changes. BR-206 already delegates
  normalization to BR-205. BR-207 already counts requests, not chunks.
  Neither needs a new version. No new BR ID or ADR is needed.

## Risks

- Many tiny fragments cost more scheduling work; byte limits, rejection of
  empty chunks and the unchanged monotonic deadline bound that work. A test
  that covers only a timer firing misses immediate-promise loops; retain
  monotonic liveness checks before and after each read.
- Exempting all `retry:false` operations would also exempt non-body work.
  Identify body reads explicitly; do not use the retry flag as accounting.
- The 8 MiB success test must use `kdrive_read` with a small text output;
  an 8 MiB raw JSON response violates existing output limits independently.
- Weak and absent validators still prevent content access; this fix does
  not make the owner's no-ETag live response readable. A weak `open` after
  a strong descriptor must not silently fall back or publish mixed bytes.
- Synthetic fragmentation and strong validators establish the local
  contract, not provider support for strong versioning or a live throughput
  guarantee. D-1 preserves operation accounting and therefore does not
  guarantee a ceiling of 512 physical HTTP requests.

## Open questions

## Stress-test

### Review 1 dispositions

The owner supplied this review for this revision; the entries below record
its verdict and the disposition of every finding, not a new review or an
approval of the revised head. Reviewer model/effort and token counters were
not supplied (unknown); no usage is inferred. Status remains draft v1.

### 47b-spec-review-1-reviewer — verdict: changes

1. **Major — OQ-1 accounting boundary. Retained, fixed in this revision.**
   D-1 records the owner's decision to preserve 512 at existing upstream
   operation charging points. Counting every physical HTTP request is a
   BACKLOG-worthy follow-up under Out of scope. Removed the open question
   and its blockers from the spec index, capability map, BR README and BR-070.
2. **Minor — validator consumer inventory. Retained, fixed in this revision.**
   Added `derivedETag`, `etag` and `If-Match` to the inventory and recorded
   the source search confirming no mutation or `If-Match` consumer.
3. **Minor — observable AC-02 counts. Retained, fixed in this revision.**
   Replaced the internal-counter assertion with identical port starts in
   both rows: `describe=1`, `open=1`, `inspect=4`. Checked the existing test
   fixtures and their authorization call path; no tests were run.
4. **Minor — BR-070 History formatting. Retained, fixed in this revision.**
   Removed the blank line separating the v4 entry from the History list.

---
id: F-007
title: Bounded raw downloads and policy-protected resources
ticket: "#10"
status: done
version: 1
---

## Context

Autonomous freeze by the orchestrator on2026-11-02T23:42:29Z, exact reviewed SHA
`f5a2cfdfab03bea5f1ee4cf482af80e69127cb18`, after fresh independent
round1 approval (archived evidence `runs/10-spec-review-1.md`). The ticket is ready, no question
remains and the user was notified of this SHA and the decisions.

#10 (archive issue 10) adds bounded binary
content to the accepted injected SDK composition at actual main
`30e059ef8ef3540c4aa4bb6a0de0bf209c963b12`. #9 acceptance established F-006's
synthetic navigation/collections; it established neither a provider adapter nor
a production entrypoint. Clients need a raw byte continuation distinct from
later extracted-character continuation and a resource with an explicit binary
representation. The same live read policy must guard every content surface.

[#5 evidence](../docs/kdrive-read-evidence.md#selected-synthetic-observations)
measured a known 16-byte binary: API302 followed by one allowed tokenless storage
hop returned206 with exact bytes for0–0,7–9,15–15;16–16 returned416 with an empty
text/html body. Repeated bounded ETags were equal but had nonstandard syntax.
Changed-version behavior, standard strong/conditional semantics, ignored ranges,
maximum sizes and provider rate ceilings remain unqualified. Those observations
cannot establish atomic version binding. The injected contract below deliberately
requires stronger evidence than an equal opaque observed tag.

This is the same injected delivery stage as F-005/F-006. Positive/negative
synthetic SDK tests are required; working provider access is not claimed.
#6 AC-19/AC-20 and #7 AC-14/AC-15 remain mandatory and blocked. This ticket does
not replace, waive or satisfy them with a blanket-denying adapter. Its resource
registration supplies a future consumer boundary; qualification still requires
their original production ACs and separately authorized provider evidence.

## Scope

- `kdrive_download`, stateless byte continuation, a strict normalized content
  port and one private immediate guarded content path shared with resources.
- One binary resource template `kdrive://{drive_id}/file/{id}`; complete blobs
  only, with explicit refusals for other representations and oversize files.
- Central bounded read retries in the injected runtime composition, including
  existing metadata/collection/received reads and new descriptor/range opens.
- Tests first, named BR unit coverage, bounded synthetic SDK wire integration,
  package checks, and truthful composition/representation documentation.
- Synchronize accepted #9 F-006/BR-060 v2/BR-065 v2/BR-072–081/capability markers
  from its actual-main acceptance (archived evidence `runs/9-acceptance-1.md`). Carry unchanged
  review3 (archived evidence `runs/9-pr45-review-3.md`), acceptance1 and
  usage-summary1 (archived evidence `runs/9-usage-summary-1.md`) in this reviewed PR.
- Version BR-060 to v3 for its same-purpose registration contract. Preserve
  F-005/F-006 frozen definitions; later BR-060 v3 governs #10 registration.

### Out of scope

Production HTTP/provider adapters or credential bindings, account/private-fixture
access, provider probes/redirect execution, writes or mutation retries, extraction,
text decoding, MCP image output, content caches, content cursor state, prompts,
resource enumeration/subscription, configuration additions, SDK/dependency
upgrades, VERSION/release/publication changes and completion of #6/#7.
No whole-file buffering fallback or unguarded dependency escape is introduced.

## Business rules

BR-082–BR-093 are new v1 rules. BR-060 becomes v3, preserving v1/v2 history.
Canonical records accompany implementation after independent review and freeze.

- **BR-060 v3** — Every operation mode registers exactly the nine declared
  cumulative read tools and the single declared binary resource template, with
  no mutation tool, prompt or enumerated resource. Verified by: AC-01.
- **BR-082** — Each content attempt and each publication uses the existing live
  read policy for the exact owner drive and file; denial starts no protected
  content call and publishes no bytes. Verified by: AC-02, AC-03.
- **BR-083** — Raw continuation offsets count bytes, and every successful chunk
  is bound to one qualified strong file version. Verified by: AC-04, AC-05.
- **BR-084** — A successful range contains exactly the requested identity,
  inclusive byte bounds, total size, strong ETag and body length, with no ignored
  range or full-body fallback. Verified by: AC-06.
- **BR-085** — Raw body consumption and successful serialization stay within
  the stated byte, time, call and base64-inclusive output limits without partial
  publication. Verified by: AC-07, AC-08.
- **BR-086** — A resource success contains one complete raw binary blob and
  never a truncated blob, extracted text or sliced MCP image. Verified by: AC-09.
- **BR-087** — Unsupported resource representations refuse explicitly before
  any protected dependency call. Verified by: AC-10.
- **BR-088** — A retry starts only for a branded pre-body normalized read
  failure with status429 or500–599, and never exceeds three attempts for that
  logical call or the invocation's shared limits. Verified by: AC-11, AC-12.
- **BR-089** — Cancellation, deadline and close prevent new attempts and late
  publication, settle owned waits and close any opened body. Verified by: AC-13.
- **BR-090** — Errors and diagnostics contain only declared fixed strings and
  never serialize content, credentials, raw headers, URLs or dependency errors.
  Verified by: AC-14.
- **BR-091** — Content envelopes are validated from own data properties before
  use and output is copied into the declared scalar/blob projection without
  invoking dependency getters or serialization hooks. Verified by: AC-15.
- **BR-092** — Missing qualified content dependencies fail explicitly and leave
  the existing diagnostic production CLI unchanged. Verified by: AC-16.
- **BR-093** — The central retry wrapper applies to injected read ports only
  and never changes abstract policy dispatch or retries `execute`.
  Verified by: AC-12, AC-16.

## Contract details

### Registration and composition

All existing eight tools keep their F-005/F-006 schemas and output shapes.
Add `kdrive_download` with the same four read annotations and untrusted-data
notice in read/write/share modes. The notice extends names/paths to file content.
The server advertises resources, lists no concrete resources, and lists exactly
one resource template with the URI above and MIME `application/octet-stream`.
Resources cannot discover drive/file IDs and do not default the URI drive.
No subscription support is advertised or implemented.

Construction remains I/O-free and requires the exact branded resolved stdio
configuration and explicit policy dependencies. A new optional trusted `content`
dependency is part of this internal composition; it is never an MCP argument,
environment adapter selector or production CLI mode. The nine tools/template
remain registered when it is absent. Valid authorized content reads then return
`CONTENT_UNAVAILABLE`; ordinary navigation stays functional. A denied request
still returns `ACCESS_DENIED`, including when content is absent.

The private content facade reuses F-003/F-004 `read` evaluation, normalized item,
complete received-membership proof, deny/capability checks and final received
cache-age check. It never calls `execute`, returns a grant or exposes raw ports.
The authorized item must be a live file; directories use `ACCESS_DENIED`.
Read authorization occurs before descriptor/open work, again before every
retried content attempt, and after body completion immediately before result
publication. Any failed fresh check discards the result. A changed received
root, revocation, expired proof, deny or identity cannot inherit an earlier
authorization. The final authorization remains subject to the same invocation
limits. There is no atomic policy/content snapshot claim.

### Raw tool schema and byte continuation

The strict tool arguments are required positive safe numeric `file_id`, optional
positive safe numeric `drive_id` (the configured default when absent), optional
nonnegative safe numeric `offset_bytes` (default0), optional positive safe numeric
`length_bytes`, and optional `etag`. No coercion, null, unknown field or extracted
`offset`/`cursor` is accepted. Any positive `offset_bytes` requires `etag`.
The tag is an exact bounded strong quoted ASCII entity-tag: surrounding quotes,
1–254 interior bytes in `!` or `#` through `~`, at most256 bytes in total, no
weak `W/` prefix, controls or non-ASCII. An explicit tag at offset0 is permitted.
Malformed arguments use `INVALID_ARGUMENTS` before dependency work.

Success is one text block containing exactly this JSON payload:

`{drive_id,file_id,offset_bytes,bytes_read,size_bytes,etag,encoding:"base64",data,has_more,next_offset_bytes?}`

`data` is canonical padded standard base64 of the returned bytes, encoded
independently for each chunk. Clients decode each whole chunk and concatenate
decoded bytes; they never concatenate base64 strings or count base64 characters
as bytes. `bytes_read` is the decoded length. `has_more` is true exactly when
`offset_bytes + bytes_read < size_bytes`; `next_offset_bytes` exists exactly then
and equals that sum. The next request repeats owner IDs and the returned `etag`.
No opaque collection cursor or provider cursor participates in raw continuation.

`length_bytes`, when supplied, is a maximum requested chunk length, not a promise
to exceed the remaining file or output budget. Values above `maxReadBytes` use
`LIMIT_EXCEEDED` before content work. Choose the largest positive chunk fitting
remaining bytes, the supplied length, `maxReadBytes`, the fixed262144-byte
serialized tool-payload limit and `maxOutputChars` UTF-16 code units. Calculate
the exact complete JSON shape and `4 * ceil(bytes / 3)` base64 expansion before
opening a body, including escaped ETag/number fields and optional next offset.
Check the actual completed serialization again before publication. No partial
JSON/base64 or zero-progress continuation is returned if even one byte cannot
fit. Equality at any ceiling is permitted.

Offset equal to EOF succeeds with empty data, zero bytes and no continuation,
including an empty file; no range is opened. Offset beyond EOF uses
`INVALID_RANGE` after authorization/descriptor validation. All additions and
inclusive end calculations stay within safe-integer arithmetic. This contract
does not bound total file size to `maxReadBytes`: large raw files can be read in
separate bounded calls. A resource, unlike the tool, requires the whole file.

### Normalized version/range port and body admission

The trusted injected content port has `describe(target, signal)` and
`open(request, signal)` operations. `target` is the exact immutable
`{driveId,id}`. Descriptor own-data fields are exactly
`{target,size_bytes,etag,version_bound:true}`, with nonnegative safe integer
`size_bytes` and the strong `etag` above. That last field
asserts the normalized adapter contract: the tag identifies one byte-exact
representation and its range responses are atomically bound to that version.
It is not a provider capability discovered from tag syntax. A production adapter
cannot assert it until positive/changed-version/negative qualification establishes
that contract; #5's opaque equality is insufficient. Missing/nonstandard/weak
or unqualified validators return fixed `VERSION_UNAVAILABLE` without body work.

If a caller supplied `etag`, compare it byte-for-byte with the fresh descriptor
after authorization. A different valid tag returns `VERSION_CHANGED` before
opening a body. An equal tag with a contradictory known size/range also refuses;
no mixing, restart at0 or fallback is attempted. Continuation is stateless: no
content or prior tag is retained, and the trusted version contract supplies its
binding. A new controller can read the same qualified version with these explicit
arguments; it cannot reuse F-006's session collection cursor.

Open request fields are exactly `{target,start,end,size_bytes,etag}` with
start/end inclusive. The success own-data envelope is exactly
`{target,start,end,size_bytes,etag,status:206,body}`. `body` is a trusted bounded
reader; extra envelope properties refuse. A metadata/response identity or total mismatch,
missing/malformed Content-Range-equivalent evidence, ignored status200, redirect,
416 or other non206 status, or changed ETag refuses before consuming body bytes.
A valid different ETag uses `VERSION_CHANGED`; other malformed/contradictory
range evidence uses `CONTENT_UNAVAILABLE`. Empty/EOF success never needs status200.
Actual HTTP parsing, redirect allowlists, credential stripping and transport
version enforcement belong to the future qualified production adapter.

The internal body reader offers own data methods `read(max_bytes, signal)` and
idempotent synchronous `close():void`; it has no unbounded asynchronous cleanup.
Each read is requested for at most16384 bytes and the remaining expected length;
it returns a fresh plain Uint8Array (Buffer is allowed) or null at EOF. A returned
chunk larger than requested, non-byte chunk, empty non-EOF chunk, early EOF or
extra byte after the expected length refuses and closes. After receiving the
expected length, one read bounded to1 verifies EOF; the extra byte, if present,
is rejected and never retained/output. Count actual admitted bytes before copying;
never retain more than the admitted chunk plus bounded result. The trusted port
must honor the read size and abort without an eager whole-file download; tests
verify requested sizes, close and rejection, not upstream allocation guarantees.
Readers close on success, refusal, throw, cancellation and timeout. If an open
settles after cancellation, its returned reader is closed without consumption.
Late reads are ignored and cannot reopen, publish or start subsequent calls. Body chunks
and the assembled raw buffer are invocation-local and discarded at completion.

### Binary resources and unsupported representation

Only the exact canonical URI is supported: lowercase scheme, positive safe
decimal drive/file IDs without leading zeroes, exact `/file/` segment, no
credentials, port, trailing slash, percent encoding, query or fragment. Parse
the original bytes; never normalize a noncanonical URI into a permitted target.
Any other URI or request for text/image/preview/offset/representation parameters
returns fixed `UNSUPPORTED_REPRESENTATION`, with zero policy/content calls.
Malformed protocol argument types retain sanitized SDK invalid-params behavior.

An authorized successful `resources/read` returns exactly
`{contents:[{uri,mimeType:"application/octet-stream",blob}]}`, where `uri` is the
canonical request and `blob` is one complete base64 encoding of the entire file.
Every file type uses this MIME and representation; MIME never triggers extraction
or MCP image rendering. This can be arbitrary complete binary data, including an
image file, but it is never an MCP image block or a sliced valid-image claim.
Future extraction must explicitly version/extend this representation contract.

Use the same private content path with offset0 and complete-file requirement.
Precompute exact JSON `contents` result overhead plus full base64 length against
both262144 UTF-8 bytes and `maxOutputChars` UTF-16 units. Also require file size
at most `maxReadBytes`. A file exceeding any bound returns `LIMIT_EXCEEDED`
before body work, even if a tool could download it through several calls.
An empty file yields one empty complete blob. Resources never truncate, return
a tool envelope, embed JSON/text in `blob`, expose next offsets or silently fall
back to another representation. A positive resource and a tool for the same
file obtain equivalent policy decisions; representation budgets can differ.

### Central retries, limits and lifecycle

The injected runtime wraps configured/received `inspect`, `children`, `collection`
and received `list`, plus content descriptor/open operations, in one central
bounded read helper before policy collapses dependency errors. Retry recognition
uses only a runtime-owned error brand with a validated numeric HTTP status,
stored in a private WeakMap; never inspect properties/prototypes/getters of
arbitrary thrown values. The brand means a retryable attempt failed before
yielding a successful body. It conveys no raw response or text.

Only429 and500–599 retry. Maximum three starts per logical dependency call:
the original, then delays100ms and200ms. All other statuses, malformed return
envelopes, unbranded throws, transport/body failures after opening, body-read
errors and deadlines do not retry. Exhausted pre-body read retries return
`READ_UNAVAILABLE`; no failing provider status is reflected. No Retry-After,
jitter, unbounded backoff, nested retry loop or retry inside the policy exists.
Content retry attempts reauthorize before starting. No bytes are published or
retained across a retry; streaming failure ends the invocation without replay.

Every actual dependency start, including retry and body `read`, consumes the
same existing512-call invocation budget. Descriptor/open/authorization starts
also count. Every actual list-type retry consumes F-006's same five-list-call
budget; it never starts a sixth call. Content/resource authorization also uses
that five-list-call bound. Retry scheduling reserves no extra calls and cannot
extend the10000ms monotonic invocation deadline. Check all shared budgets and
liveness before each wait, after waking, before the actual call, after return
and before publication. A limit that prevents an attempt returns the bound
error, rather than exceeding it to complete a retry. Existing smaller policy
tree/cache bounds stay cumulative and unchanged.

One active invocation covers tools and resource reads together; no waiting queue.
Concurrent calls receive `SERVER_BUSY`. Existing bounded input/output frames and
backpressure/close ownership remain unchanged. Cancellation/close abort both
retry waits and body reads, settle the slot and suppress late output. Timeout
uses `REQUEST_TIMEOUT` while the session remains live. The central helper never
wraps `execute`, abstract `check`/`dispatch` or mutation simulation. No change to
F-003/F-004 abstract no-retry semantics is inferred from this runtime consumer.

### Errors and disclosure

Tool failures retain `isError:true` and one fixed text block. Add only
`CONTENT_UNAVAILABLE`, `VERSION_UNAVAILABLE`, `VERSION_CHANGED`, `INVALID_RANGE`
and `READ_UNAVAILABLE` to the existing fixed application error set. Resource
failures use JSON-RPC code-32000 and the same fixed message, plus
`UNSUPPORTED_REPRESENTATION`; omit `error.data`. Protocol errors keep the existing
sanitized code/message contract. Extend transport sanitization to preserve only
these application messages for resources. No unknown error becomes its message.

Metadata/authorization failures precede content/version/range diagnostics, so
an unauthorized object reveals only `ACCESS_DENIED`. Invalid syntax and unsupported
representation precede protected calls. Operational bounds precede body work.
Expected fixed refusals need no diagnostic; unexpected failures emit only existing
`NAVIGATION_FAILED\n`, without stack, status, credentials, identifiers, paths,
tags, body/base64, headers, redirect URL or thrown-object inspection. Successful
content deliberately contains authorized data/ETag; error/log tests distinguish
that intended output from forbidden reflection.

## Acceptance criteria

- **AC-01 (BR-060 v3)** — Given each mode and content present/absent, When actual
  SDK initialization/tool/resource-template/list exchanges run, Then exactly
  nine read tools, one binary template, no concrete resources/prompts/mutations
  and the extended notice/annotations are exposed. Verified by:
  `TestBR060_v3_registration` and SDK `download-stdio` tests.
- **AC-02 (BR-082)** — Given configured roots, denies, default/explicit owner
  drives, unrelated IDs, directories and equal IDs on different drives, When
  info/download/resource calls run, Then permitted file reads agree and every
  denied case performs zero protected content calls. Verified by:
  `TestBR082_surface_policy_agreement`, exact call traces.
- **AC-03 (BR-082)** — Given complete synthetic received-root/child evidence,
  opt-out, expiry, capability revocation, root transition and external root1,
  When initial/retried/resumed/final content authorization runs, Then only fresh
  permitted reads publish and failed checks expose no bytes. Verified by:
  `TestBR082_received_freshness`, synthetic clock/call trace tests. This does
  not establish #7's production AC-14/AC-15.
- **AC-04 (BR-083)** — Given binary lengths0,1,2,3,16 and a multichunk fixture
  containing0x00 and0xff, When whole base64 chunks are decoded and resumed with
  returned byte offsets/ETag, Then their concatenation equals the exact original,
  EOF is terminal and all chunk metadata is exact. Verified by:
  `TestBR083_binary_continuation`, one bounded actual SDK reconstruction.
- **AC-05 (BR-083)** — Given same size but a changed qualified version, missing,
  weak, malformed or opaque-only validators and a positive offset without a tag,
  When reading/resuming, Then fixed version/schema errors occur before body
  opening and no mixed bytes succeed. Verified by:
  `TestBR083_version_binding`, negative same-tag/unqualified port fixtures.
- **AC-06 (BR-084)** — Given exact, nonzero, final, EOF and beyond-EOF requests,
  ignored200,416/redirect, wrong identity/size/bounds/tag, short/long/changing
  body and unsafe arithmetic, When consuming a range, Then only exact206 evidence
  succeeds, EOF opens nothing and every refusal closes the body without bytes
  escaping. Verified by: `TestBR084_exact_range_evidence`.
- **AC-07 (BR-085)** — Given byte caps just below/at/above a requested chunk,
  a file larger than one call and malicious body chunks, When download runs,
  Then request/retention/read sizes remain bounded and oversize requests do not
  start content work. Verified by: `TestBR085_raw_byte_budget`, read traces.
- **AC-08 (BR-085)** — Given0/1/2/3-byte base64 boundaries, escaped tags and
  serialized payload limits just below/at/above both ceilings, When output is
  planned/published, Then expansion and complete envelope overhead count, equality
  succeeds and no partial/zero-progress success is emitted. Verified by:
  `TestBR085_base64_output_budget`, independently decoded exact payload sizes.
- **AC-09 (BR-086)** — Given empty, ordinary, image and oversize binary files,
  When the actual SDK reads their canonical resources, Then successes are one
  complete correctly decoded blob and oversize cases fail before body work.
  Verified by: `TestBR086_complete_binary_resource`, SDK wire shapes.
- **AC-10 (BR-087)** — Given text/image/offset query requests, fragments,
  percent encodings, noncanonical/unsafe IDs and altered scheme/path/authority,
  When resource reads run, Then `UNSUPPORTED_REPRESENTATION` has zero protected
  calls and no normalized target disclosure. Verified by:
  `TestBR087_unsupported_resource_representation` and actual wire refusals.
- **AC-11 (BR-088)** — Given branded429,500,599 then success/exhaustion and
  branded400/401/403/404/416, unbranded hostile errors or malformed successes,
  When central reads run, Then only retryable pre-body failures wait100/200ms
  and start at most three calls, with fixed exhaustion text. Verified by:
  `TestBR088_bounded_retry_matrix`, deterministic clock/start traces.
- **AC-12 (BR-088, BR-093)** — Given inspect/list/received/descriptor/open
  failures near the shared512/five-list limits and execute failures, When retry
  logic runs, Then no over-budget call starts, every read surface shares one
  helper and execute/abstract dispatch never retry. Verified by:
  `TestBR088_shared_retry_budgets`, `TestBR093_read_only_retry_composition`.
- **AC-13 (BR-089)** — Given pending waits/opens/reads, never-settling ports,
  cancellation/deadline/EOF/signals/close and a concurrent cross-surface call,
  When lifecycle events occur, Then waits settle, readers close, no new/late work
  publishes and busy/deadline/error behavior matches the contract. Verified by:
  `TestBR089_content_lifecycle`, bounded SDK child watchdog tests.
- **AC-14 (BR-090)** — Given canary content/base64/tokens/headers/tags/URLs and
  hostile failures on tools/resources/retries/protocol validation, When fixed
  errors and captured stderr are inspected, Then none appears outside intentional
  authorized success and all public errors have only permitted shapes. Verified
  by: `TestBR090_content_error_redaction`, SDK transport error tests.
- **AC-15 (BR-091)** — Given getters, toJSON, prototypes, identity mismatches,
  malformed fields and extra envelope properties, When validating/projection
  runs, Then hooks are never invoked, invalid envelopes fail and successful
  outputs have exactly the declared keys. Verified by:
  `TestBR091_content_own_data_projection`.
- **AC-16 (BR-092, BR-093)** — Given no content port and the packaged executable,
  When authorized/denied content and existing navigation/CLI tests run, Then the
  fixed content-unavailable/denial behavior and unchanged accepted production
  diagnostic are proved; no provider call, real write or production qualification
  is claimed. Verified by: `TestBR092_missing_content_port`, existing CLI/package
  tests and full `make check` on the merged main SHA.

Run named tests through Compose dev/Make; implementation records name exact
commands and observed outcomes. At acceptance repeat AC-01–AC-16 on actual main
and record SHA/evidence in #10. These are injected-scope ACs, not substitute
production ACs for #6/#7. No provider qualification, release or publication is
an implicit consequence of this feature's acceptance.

## Decisions

1. Resolve D-03 for raw reads with explicit byte offsets and strong version-bound
   chunks; reserve extracted-character `offset`, decoding and complete MCP image
   generation for #14/#15. Reject byte-sliced image blocks and base64-string offsets.
2. Require qualified normalized strong version evidence, rather than treating
   #5's equal nonstandard opaque ETag as an atomic version guarantee. Synthetic
   positive/changed-version tests establish the consumer contract only. Provider
   inability to meet it means explicit refusal until separately qualified.
3. Use one complete binary MCP resource blob with constant MIME, no enumeration
   and no resource continuation. Reject implicit text previews/truncation and
   hidden extraction. A later representation extension needs reviewed versioning.
4. Keep the established injected composition boundary and missing-port refusal;
   do not introduce a provider adapter or silently change the diagnostic CLI.
   Production #6/#7 obligations remain mandatory and separately tracked.
5. Retry branded pre-body read failures at most three starts with100/200ms waits,
   sharing all budgets; never replay a partially consumed body or retry execute.
   Reject ad-hoc status-property inspection and independent retry multipliers.
6. Use stateless explicit offset/ETag raw continuation, rather than retaining
   file buffers or extending the collection cursor framework. A complete chunk
   has bounded memory and a client can reconstruct without hidden session state.

## Open questions

None for this injected contract. Production version/conditional/redirect/provider
qualification remains unmeasured and is not a product choice answered here.

## Stress-test

- **Round1 — approve, retained.** Fresh independent gpt-6-astra/high review of
  `f5a2cfdfab03bea5f1ee4cf482af80e69127cb18` found no blocking or nonblocking
  findings. The author records this disposition without changing the reviewed
  contract. Root's autonomous freeze authorizes tests-first implementation of
  this injected scope only; production qualification and quality gates remain.

---
id: F-016
title: Mutation audit gate with intent/outcome journal and bounded retries
ticket: "#17"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-09.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `82ecb7c` (origin/main).
IDs: F-016 and BR-234–BR-259 are the next unused IDs per `ls features
business-rules` on that base; re-check before freeze and before the PR.

## Context

Ticket #17 (P-17, milestone 0.4) prepares every write and share tool of #18–#20.
Before any of them can call kDrive, the server needs one gate that:

- writes a structured audit record before each upstream write and after it
  ([SPEC.md §9](../SPEC.md): timestamp, OAuth subject or `stdio`, tool, drive,
  IDs, result; no content, no secret; a failed audit write refuses the
  operation before it runs);
- retries mutations on 429 only and turns a timeout, a lost response or a 5xx
  into an `uncertain` result without automatic replay (SPEC §6 "Reprises");
- runs every mutation through the fail-closed effect policy of
  [F-003](F-003-tree-access-policy.md) (descendants, result paths, scan cap) and
  the fresh received-share checks of [F-004](F-004-received-share-policy.md).

What already exists on the base:

- The F-003 core derives every mutation effect and traverses descendants from
  injected evidence (BR-035–BR-038, BR-045); the F-004 core reloads the
  received-share list for every mutation (BR-052) and requires
  `sharedWrite=true` plus per-effect capabilities (BR-053).
- The F-014 production adapter supplies `inspect`, `children` and received
  evidence (BR-201); its `execute` returns `unavailable` (BR-200) and every
  received mutation predicate is `false` (BR-204, D-09).
- Reads already retry 429/5xx at most three attempts (BR-088). This feature
  does not change the read path.
- `KDRIVE_MCP_AUDIT_LOG` is parsed (F-002: `stderr` or a path resolved against
  the working directory) but unused in `src/`.
- #16 measured write endpoints (runs/16-execution-A-1.md, -B-1.md): no 429 was
  observed and no 5xx or timeout was provoked, so the classification of those
  cases below rests on HTTP semantics, not on measurement.

Users affected: operators who enable `write` or `share` (they need an audit
trail and fail-closed writes), MCP clients and their users (they must never be
told that a performed write was prevented, and must be told to verify state
when the result is unknown), and the authors of #18–#20 (they plug endpoint
code into this gate instead of re-implementing it).

## Scope

1. An audit sink: JSONL records on stderr (default) or in a configured file,
   with the schema, redaction, size, durability and failure rules below.
2. A mutation gate used by every future write and share tool: admission →
   F-003/F-004 policy decision through the shared guarded facade → durable
   intent record → upstream dispatch through a per-kind _mutator_ → result
   classification and 429-only retry → outcome record → caller result.
3. The late outcome-log failure response (decision D-06).
4. Identity plumbing: `stdio`, or the verified OAuth identity bound to the HTTP
   session, reaches the gate.
5. Production composition: the gate shares the navigation policy instance and
   the F-014 adapter evidence, with the configured `maxTreeItems`, and is
   closed on shutdown. Its mutator registry is empty in this feature.
6. The mutation invocation lifecycle inside the navigation controller
   (BR-258) and the shutdown order (BR-254), which version two F-005 rules
   (see "Versioned rules" below).
7. Deployment documentation (`docs/deployment.md`, README): in `write` and
   `share` modes the container `stop_grace_period` is at least 75 s and a
   file audit log needs a writable mount, because the read-only root of
   F-013 cannot hold it (AC-28).

### Versioned rules

F-016 raises two active F-005 rules to version 2. Their record files
(`business-rules/BR-069.md`, `BR-070.md`) get the new statement and a History
line in the implementation PR, marked pending acceptance.

- **BR-069 v2** (was v1: stderr carries only fixed sanitized diagnostics) —
  The stdio runtime writes only MCP protocol messages with sanitized
  tool/protocol error text to stdout, and emits to stderr only fixed sanitized
  diagnostics and, when `auditLog` is `stderr`, F-016 audit records
  (BR-234–BR-236). Verified by: F-005 AC-11 (unchanged) and F-016 AC-05.
- **BR-070 v2** (was v1: every invocation stops after cancellation, deadline
  or close) — Every active tool invocation obeys the stated request/output
  bounds and stops publishing results or starting dependency calls after
  cancellation, deadline or session close, except a mutation gate run once
  its intent append has started: from that point the navigation deadline,
  cancellation, session close and output checks no longer abort, race or
  replace the run, which is bounded by F-016 (BR-249, BR-250, BR-254,
  BR-258), and its gate result is published unless the session is closed.
  The F-005 1,000 ms exit bound after EOF, SIGINT or SIGTERM holds when no
  gate run is past its intent append start; otherwise the process exits
  after the gate close (BR-254), bounded by that run's total deadline plus
  two bounded appends (BR-259; file sink — with the stderr sink the wait
  also depends on stderr draining, D-16-7). Verified by: F-005 AC-12 (scoped to no gate
  run past its intent) and F-016 AC-21, AC-25, AC-26.

### Out of scope

- Every write and share tool and endpoint (#18 create/rename/move/trash/restore,
  #19 upload, #20 sharing), restore evidence (`original-trash` stays
  unavailable), upload collision policy (D-07).
- The production implementation of the mutation port (non-GET requests in the
  kDrive transport). #18 delivers it with its first endpoint and must honour
  the port contract below (`not-sent` only when no request byte was written).
- The received-share mutation capability mapping: every predicate stays
  `false` (BR-204 v1 unchanged) until a tool ticket qualifies each mapping
  against a live received share (D-16-4). `KDRIVE_MCP_SHARED_WRITE=1` therefore
  authorizes no received-share write after this feature.
- The `batch` operation kind (no mutator; refused at admission).
- Share-specific audit fields (recipient domain, link type): #20 adds them by a
  new version of BR-234.
- Log rotation, audit reading, startup reconciliation of unfinished intents.
- Real-API acceptance of the gate: it happens through #18, the first ticket
  with a real mutator. This feature is accepted with unit tests (synthetic
  mutator, fake port) and a production composition test.

## Business rules

All rules below are new, version 1, and `pending acceptance` until
acceptance on `main`; BR-069 v2 and BR-070 v2 (above) are pending too.

### Audit record and sink

- **BR-234** — Each audit record is one JSON object followed by one LF, whose
  members are exactly those of the record schema below for its `event`.
  Verified by: AC-01.
- **BR-235** — Audit records, gate errors and every gate-authored result
  member never contain item names, paths, search queries, e-mail domains, file content, tokens,
  credentials, HTTP headers, URLs, provider response bodies or exception text.
  The mutator's validated `value` (BR-255) passes through to the caller
  unchanged and is never recorded. Verified by: AC-02.
- **BR-236** — A serialized record escapes every control character (U+0000–
  U+001F, U+007F) and U+2028/U+2029, escapes every identity code point outside
  U+0020–U+007E as `\uXXXX` (C1 controls and bidi overrides included), and is at most 8,192 bytes including its
  LF. A gate run is refused at admission as `failed` with code
  `AUDIT_UNAVAILABLE`, without latching the sink, when its identity `iss`
  exceeds 4,096 UTF-8 bytes, its `sub` exceeds 1,024 UTF-8 bytes, its identity
  strings are empty or not well-formed Unicode, or its largest possible
  record (the `outcome` record with every optional member at its widest
  value) serializes to more than 8,192 bytes. An append of a record over
  8,192 bytes rejects without I/O and without latching. Verified by: AC-03.
- **BR-237** — The record identity is `{"kind":"stdio"}` for the stdio server,
  `{"kind":"oauth","iss":…,"sub":…}` from the verified identity bound to the
  HTTP session, and `{"kind":"insecure"}` for the loopback unauthenticated HTTP
  mode; a gate run without one of these identities is refused at admission as
  `failed` with code `AUDIT_UNAVAILABLE`. Verified by: AC-04.
- **BR-238** — With `auditLog` equal to `stderr`, records are written only to
  file descriptor 2 and never to stdout; otherwise to the configured absolute
  file path; the sink is opened at startup only when the configured mode is
  `write` or `share`, and never in mode `read`. Verified by: AC-05.
- **BR-239** — The file sink opens its path with `O_WRONLY | O_APPEND | O_CREAT
  | O_NOFOLLOW | O_CLOEXEC` and creation mode `0600`, then requires by `fstat`
  a regular file owned by the effective user ID with no group or other
  permission bit (`mode & 0o077 === 0`); any failure stops startup with a fixed
  message, without changing the file's mode or owner. Verified by: AC-06.
- **BR-240** — An append resolves only after the complete record was passed to
  one write call and that call wrote every byte, followed, for the file sink,
  by a successful `fdatasync`, and, for the stderr sink, by an error-free write
  callback. Verified by: AC-07.
- **BR-241** — Any write error, short write, `fdatasync` error or stream
  `error` event latches the sink as failed for the process lifetime; every
  later append rejects without I/O. An oversize record (BR-236) does not latch
  the sink. Verified by: AC-08.
- **BR-242** — Appends in one process are written in call order, one at a
  time, each as a single write of at most 8,192 bytes to an `O_APPEND`
  descriptor, so that records from concurrent writers on one local file never
  share a line. Verified by: AC-09.
- **BR-259** — A file-sink append that has not resolved 5,000 ms of
  monotonic time after its write started rejects and latches the sink
  (BR-241); an intent append timeout then gives BR-244 and an outcome append
  timeout gives BR-252. The stderr sink has no append time limit (D-16-7),
  but on either sink an intent append that resolves more than 5,000 ms after
  it started gives zero attempts and an outcome record `failed` with code
  `AUDIT_UNAVAILABLE`, so a write is never dispatched long after its policy
  decision. Verified by: AC-27.

### Gate order and results

- **BR-243** — For an authorized mutation, the gate appends the `intent` record
  and awaits its resolution before the first upstream attempt starts, and
  appends the `outcome` record only after the final classification; both carry
  the same `op`, 32 lowercase hexadecimal characters from 16 bytes of the
  injected random source. Verified by: AC-10.
- **BR-244** — When the intent append rejects (disk full, permission error,
  closed stream, latched sink, oversize record), the gate makes zero upstream
  attempts and returns `failed` with code `AUDIT_UNAVAILABLE` and `attempts:0`.
  Verified by: AC-11.
- **BR-245** — Admission refuses a run as `failed`, with zero records, zero
  policy calls and zero upstream attempts, with code `UNAVAILABLE` when the
  tool name is not one of the eight mutation tools of SPEC §6, the operation
  is not a valid F-003 mutation or share kind other than `batch`, its kind is
  not admitted for the tool by the admission table below, or no mutator is
  registered for its kind; with `ACCESS_DENIED` when the configured mode is
  `read`; and with `AUDIT_UNAVAILABLE` when the sink is latched or the gate is
  closed. Verified by: AC-12.
- **BR-246** — Every admitted run is decided by the guarded facade `dispatch`
  of the same policy instance that serves tools and resources; a denial
  returns `denied` with code `ACCESS_DENIED`, makes zero intent records and zero
  upstream attempts, and attempts one `denied` record whose failure leaves the
  result unchanged. Verified by: AC-13.
- **BR-247** — The final result of an upstream attempt follows the
  classification table below; a value the port returns outside its contract,
  or any thrown value other than the branded `not-sent` failure, is classified
  `uncertain`. Verified by: AC-14.
- **BR-248** — Only an HTTP 429 response is retried, for at most 3 attempts per
  run; the wait before attempt n+1 is the 429's `Retry-After` value in
  seconds when it consists of 1–10 ASCII digits, or else 1,000 × 2^(n−1) ms;
  when the wait
  exceeds 30 s or would end after the run's total deadline, or the third
  attempt answers 429, the run ends `failed` with code `RATE_LIMITED`.
  Verified by: AC-15.
- **BR-249** — The run's total deadline is 60,000 ms of monotonic time from
  the start of the first attempt; each upstream attempt is aborted by the
  gate after the smaller of 30,000 ms and the time left until that deadline,
  and is then classified `uncertain`. Verified by: AC-16.
- **BR-250** — Cancellation means the client's cancellation or session close;
  after the intent append starts, the navigation 10,000 ms deadline is not a
  cancellation and does not reach the gate. When the navigation signal is
  aborted at the moment `dispatch` settles (denied or thrown) and no intent
  append has started, the run makes zero records (no `denied` record,
  overriding BR-246) and zero attempts, and the caller gets `REQUEST_TIMEOUT`
  for the navigation deadline or `CANCELLED` for a cancellation. Cancellation
  observed after the intent append starts and before the first attempt, or
  during a 429 wait, ends the run `failed` with code `CANCELLED` and an
  outcome record (once a pending intent append resolves; if it rejects,
  BR-244 applies), with no further attempt. Cancellation during an attempt
  does not abort it, and the attempt is classified and recorded normally.
  Verified by: AC-17.
- **BR-251** — An `uncertain` classification ends the run without any further
  upstream attempt, and its result carries code `UPSTREAM_UNCERTAIN` and the
  fixed message `The upstream result is unknown; verify the item's state before
  any new attempt.` Verified by: AC-18.
- **BR-252** — When the outcome append rejects after an upstream attempt was
  made, the gate returns the attempt's classification (`succeeded`, `failed` or
  `uncertain`, with its code and value) unchanged plus `audit:
  "outcome_unrecorded"`, latches the sink, writes the fixed diagnostic `Audit
  outcome could not be recorded; further writes are refused until restart.` to
  stderr once, and neither reports `AUDIT_UNAVAILABLE`, nor replays, nor
  compensates the write. Verified by: AC-19.
- **BR-253** — A process that stops between a resolved intent append and its
  outcome append leaves that complete `intent` record as the last record with
  its `op`, and no other record is written for that `op` by a later process.
  Verified by: AC-20.
- **BR-254** — Closing the gate refuses new runs at admission, waits for each
  in-flight run to append or fail its outcome (bounded by that run's total
  deadline plus two bounded appends, BR-259; with the stderr sink the wait
  also depends on stderr draining, D-16-7), then closes the sink. On shutdown the
  composition closes in this order: (1) the transport (HTTP `close()` per
  BR-169, or the stdio session), (2) the gate, (3) process exit. An HTTP
  request whose run is in flight at step (1) receives BR-164's 503 while the
  gate still completes the run and records its outcome; that 503 does not
  state whether the write was performed, and the audit outcome is the
  authority. Verified by: AC-21.
- **BR-255** — A gate result contains only `result`, `op` (absent for an
  admission refusal), `code` (absent on `succeeded`), `attempts`, `status`
  (last HTTP status, when one was received), `audit`, `message` (fixed strings
  only) and, on `succeeded`, the mutator's validated value. Verified by: AC-22.

### Production composition

- **BR-256** — The production composition binds the policy `execute`
  dependency to the gate executor, which dispatches only the operation of the
  gate run active in the same async context and returns `{status:
  "unavailable"}` with no record and no upstream request for any other call;
  mutation decisions use the F-014 `inspect`, `children` and received evidence
  and the configured `maxTreeItems`, so that a denied descendant or result
  path, a reached cap, an exhausted page budget, unproven paging termination,
  or a path or parent that differs between observations of one decision gives
  `denied` with zero intent records and zero upstream requests. Verified by:
  AC-23.
- **BR-257** — In production, a received-share mutation run with
  `sharedWithMe=true` and `sharedWrite=true` fetches a new complete
  `shared_with_me` list even while a read snapshot is valid, and is denied,
  because every received mutation predicate is `false`. Verified by: AC-24.

### Invocation lifecycle

- **BR-258** — The navigation controller exposes `mutate(tool, operation,
  identity, signal, payload?)`, the only entry point for a gate run: it runs the gate
  inside `perform` with `paged:false`, answers `SERVER_BUSY` with zero
  records when another invocation is active, and returns the gate result
  (BR-255) as its value. When a gate run executes through the policy
  `execute` dependency inside that invocation, the navigation 10,000 ms
  deadline, cancellation, session close, dependency-call cap and output
  checks apply only until the gate starts the intent append. From then on
  the navigation controller does not abort, race, time out or discard the
  `execute` call, and the caller receives the gate result (BR-255), never a
  navigation `REQUEST_TIMEOUT`, `ACCESS_DENIED` or `LIMIT_EXCEEDED` code; the
  navigation abort signal reaches the gate only as a BR-250 cancellation; a
  gate result whose serialization exceeds the navigation output bound is
  returned without its `value` member; and the navigation slot stays held
  (other calls get `SERVER_BUSY`) until the gate result is returned. After a
  client cancellation the MCP response may be dropped (MCP cancellation
  semantics); the audit outcome is then the authority. Verified by: AC-25,
  AC-26.

## Contract details

### Record schema (BR-234)

Common members, in this order:

- `v`: integer `1`.
- `ts`: wall-clock UTC time from the injected clock, `Date#toISOString()`.
- `event`: `"intent"`, `"outcome"` or `"denied"`.
- `op`: correlation ID (BR-243).
- `identity`: BR-237.
- `tool`: one of `kdrive_create_folder`, `kdrive_upload`, `kdrive_rename`,
  `kdrive_move`, `kdrive_trash`, `kdrive_restore`, `kdrive_share_link`,
  `kdrive_share_access`.
- `kind`: the F-003 operation kind (`create`, `upload-new`, `replace`,
  `rename`, `move`, `trash`, `restore`, `share-link`, `share-invite`).
- `drive`: the target's drive ID, or the destination's when there is no
  target (integer).
- `destinationDrive`: optional, the destination's drive ID when it differs
  from `drive` (a refused cross-drive move); placed right after `drive`.
- `ids`: object with `target` and/or `destination` integer IDs, exactly those
  present in the validated operation.

Members by event:

- `intent`: none.
- `outcome`: `result` (`succeeded`, `failed`, `uncertain`), `attempts`
  (integer 0–3), `ms` (integer monotonic duration from intent resolution),
  optional `status` (last HTTP status 100–599), optional `code` (absent on
  `succeeded`), optional `created` (integer ID returned by a successful
  creation, when the mutator reports one).
- `denied`: `code` (`ACCESS_DENIED`).

Codes are a closed set: `ACCESS_DENIED`, `AUDIT_UNAVAILABLE`, `UNAVAILABLE`,
`CANCELLED`, `RATE_LIMITED`, `NOT_SENT`, `UPSTREAM_REJECTED`,
`UPSTREAM_UNCERTAIN`.

Example (one line in the file):
`{"v":1,"ts":"2026-11-09T10:00:00.000Z","event":"intent","op":"0f…","identity":{"kind":"stdio"},"tool":"kdrive_rename","kind":"rename","drive":101,"ids":{"target":42}}`

### Mutation port and mutators

A mutator, registered per operation kind by #18–#20, receives the validated
operation, the run's opaque `payload` (upload bytes, recipients, link
options; passed unchanged from `mutate`, never recorded, never returned) and
an `AbortSignal`, and returns one attempt result. Within one call it sends
each HTTP request at most once, with no internal retry and no redirect
following; it returns `status:429` only when no earlier request of the call
was accepted, and otherwise throws (classified `uncertain`):

- `{outcome:"response", status, retryAfter?, accepted, value?, created?}`:
  a complete HTTP status was received. `accepted` is the mutator's own
  validation of a 2xx body (false when the body is invalid or could not be
  read). `retryAfter` is the raw header text, bounded to 32 bytes.
- a thrown branded `NotSent` failure: the transport proves that no request
  byte was written (DNS, connect, TLS handshake or address-policy failure).
- anything else (timeout, abort, connection loss, other thrown values,
  malformed results) is treated as unknown.

### Classification table (BR-247)

- 2xx with `accepted:true` → `succeeded`.
- 2xx with `accepted:false` → `uncertain`, `UPSTREAM_UNCERTAIN`.
- 429 → retried under BR-248; when retries end → `failed`, `RATE_LIMITED`.
- 400, 401, 403, 404, 405, 409, 410, 411, 412, 413, 415, 422 → `failed`,
  `UPSTREAM_REJECTED`.
- Any other status (1xx, 3xx, 408, other 4xx, 5xx) → `uncertain`,
  `UPSTREAM_UNCERTAIN`. A 3xx is never followed.
- Branded `NotSent` → `failed`, `NOT_SENT`.
- Gate attempt timeout (BR-249), connection loss, other throws, malformed
  results → `uncertain`, `UPSTREAM_UNCERTAIN`.

### Admission table (BR-245)

Each tool admits only these operation kinds:

- `kdrive_create_folder` → `create`.
- `kdrive_upload` → `upload-new`, `replace`.
- `kdrive_rename` → `rename`.
- `kdrive_move` → `move`.
- `kdrive_trash` → `trash`.
- `kdrive_restore` → `restore`.
- `kdrive_share_link` → `share-link`.
- `kdrive_share_access` → `share-invite`.

### Gate sequence

1. Admission (BR-236, BR-237, BR-245). No record.
2. Policy decision through `policy.dispatch` (BR-246); on denial, a `denied`
   record is attempted.
3. Inside the policy `execute` dependency: intent append (BR-243, BR-244).
   Its start is the commit point after which navigation bounds stop applying
   (BR-258, BR-070 v2).
4. Attempts with classification and 429 retry (BR-247–BR-251).
5. Outcome append (BR-243, BR-252); result to the caller (BR-255).

## Acceptance criteria

Planned test files: `tests/audit-sink.test.ts`, `tests/mutation-gate.test.ts`,
`tests/mutation-composition.test.ts`. Unit tests use a synthetic mutator and a
fake port; sink tests use a temporary directory inside the dev container.

- **AC-01** (BR-234) — Given intent, outcome (each result) and denied records,
  When they are serialized, Then each is one line ending in exactly one LF,
  parses as JSON, and has exactly the schema members for its event, in order;
  Given a cross-drive move refused by the policy, Then its `denied` record
  carries `drive` (target) and `destinationDrive`. Verified by:
  `audit-sink.test.ts` and `mutation-gate.test.ts` (`TestBR234_*`).
- **AC-02** (BR-235) — Given an operation whose name, destination path, query
  and domain contain the marker `SECRETMARK`, a mutator returning a response
  whose raw body, header and thrown error message carry that marker (its
  validated `value` excluded, BR-235), and a bearer token in the run
  context, When runs end in every result, Then neither the sink bytes, nor the
  results, nor stderr contain the marker or the token. Verified by:
  `mutation-gate.test.ts` (`TestBR235_*`).
- **AC-03** (BR-236) — Given an OAuth `sub` containing LF, CR, NUL, U+007F,
  U+0085, U+009B, U+202E and U+2028, Then the record is one line with those characters escaped; Given a
  `sub` of 1,024 and 1,025 bytes, an `iss` of 4,096 and 4,097 bytes, an empty
  `sub` and a lone surrogate, Then the in-bound ones are recorded and the
  others are refused with `AUDIT_UNAVAILABLE`, zero records and zero policy
  calls; Given an in-bound `iss` and a `sub` of 1,024 control characters
  whose escaped outcome record would exceed 8,192 bytes, Then the run is
  refused at admission with `AUDIT_UNAVAILABLE` and zero records, and a next
  run with a short identity is recorded; Given a record forced to 8,193
  bytes, Then the append rejects without any port call and the next append
  succeeds. Verified by: `audit-sink.test.ts` and `mutation-gate.test.ts`
  (`TestBR236_*`).
- **AC-04** (BR-237) — Given a stdio context, an HTTP session bound to
  `(iss, sub)`, an insecure loopback session, and a context without identity,
  When a run is started, Then the identities are recorded as specified and the
  last is refused with `AUDIT_UNAVAILABLE` before policy evaluation. Verified
  by: `mutation-composition.test.ts` (`TestBR237_*`).
- **AC-05** (BR-238, BR-069 v2) — Given the stdio composition in mode
  `write` with `auditLog=stderr` and a synthetic mutator, When a run
  completes, Then stdout
  carries only MCP frames and stderr carries the two records; Given mode
  `read` with a file path, When the server starts, Then the file is not
  created. Verified by: `mutation-composition.test.ts` (`TestBR238_*`,
  `TestBR069_*`).
- **AC-06** (BR-239) — Given a missing file, Then it is created with mode
  `0600`; Given a symlink at the path, a directory, a FIFO, a file with mode
  `0640`, and an unwritable parent, When startup runs, Then it stops with the
  fixed message, the target's mode is unchanged and nothing is written.
  Verified by: `audit-sink.test.ts` (`TestBR239_*`).
- **AC-07** (BR-240) — Given a file port whose `write`/`fdatasync` are
  observed, When an append resolves, Then exactly one write of the whole record
  and one `fdatasync` completed before resolution; Given a stderr stream whose
  callback is delayed, Then the append is still pending. Verified by:
  `audit-sink.test.ts` (`TestBR240_*`).
- **AC-08** (BR-241) — Given injected `ENOSPC`, `EACCES`, a short write, an
  `fdatasync` failure and an `EPIPE` stream error, When an append runs, Then
  it rejects, and every later append rejects without any port call; Given an
  oversize record, Then only that append rejects. Verified by:
  `audit-sink.test.ts` (`TestBR241_*`).
- **AC-09** (BR-242) — Given two sinks in separate processes appending 1,000
  records of 8,000 bytes each to one file, When both finish, Then the file has
  2,000 lines, each parses, and each process's records keep their order.
  Verified by: `audit-sink.test.ts` (`TestBR242_*`).
- **AC-10** (BR-243) — Given a mutator that records whether the intent was
  already durable, When an authorized run succeeds, Then the intent resolved
  before the first attempt, the outcome followed the classification, and both
  share a 32-hex `op` derived from the injected random bytes. Verified by:
  `mutation-gate.test.ts` (`TestBR243_*`).
- **AC-11** (BR-244) — Given intent appends failing with `ENOSPC`, `EACCES`, a
  closed stream and a latched sink, When an authorized run starts, Then the
  mutator is called zero times and the result is `failed`, `AUDIT_UNAVAILABLE`,
  `attempts:0`. Verified by: `mutation-gate.test.ts` (`TestBR244_*`).
- **AC-12** (BR-245) — Given an unknown tool name, a `batch` operation, an
  invalid operation, `kdrive_rename` with a `move` operation, `kdrive_upload`
  with a `create` operation, a kind without mutator, mode `read`, a latched
  sink and a closed gate, When a run starts, Then each is refused with its
  code (`UNAVAILABLE` for the first six), zero records, zero policy calls and
  zero attempts; Given each admission-table pair, Then admission passes.
  Verified by: `mutation-gate.test.ts` (`TestBR245_*`).
- **AC-13** (BR-246) — Given a policy denial, When a run starts, Then the
  result is `denied`/`ACCESS_DENIED`, no intent exists, the mutator was not
  called, and one `denied` record was written; Given the same with a failing
  sink, Then the result is identical. Verified by: `mutation-gate.test.ts`
  (`TestBR246_*`).
- **AC-14** (BR-247) — Given each row of the classification table (including
  every listed status, 301, 408, 418, 500, 503, `accepted:false`, `NotSent`, a
  thrown string, a thrown object with a `status` property, and a malformed
  result), When it is the attempt result, Then result and code match the table
  and are recorded in the outcome. Verified by: `mutation-gate.test.ts`
  (`TestBR247_*`).
- **AC-15** (BR-248) — Given a fake clock and responses 429 then 200, Then two
  attempts with a 1,000 ms wait; Given `Retry-After: 5`, Then a 5,000 ms wait;
  Given `Retry-After` of `31` and `100`, Then the run ends `RATE_LIMITED`
  after one attempt; Given `-1`, `1.5`, an HTTP-date and 11 digits, Then the
  default wait is used; Given three
  429s, Then 3 attempts and `RATE_LIMITED`; Given a 5xx, Then one attempt.
  Verified by: `mutation-gate.test.ts` (`TestBR248_*`).
- **AC-16** (BR-249) — Given a mutator that never settles, When 30,000 ms pass
  on the fake clock, Then its signal is aborted and the run ends `uncertain`;
  Given 429 waits that would end after 60,000 ms, Then the run ends
  `RATE_LIMITED` without waiting; Given a first attempt answering 429 with
  `Retry-After: 10` at 25,000 ms and a second attempt that never settles,
  Then the second attempt is aborted at 60,000 ms (after 25,000 ms) and the
  run ends `uncertain` with 2 attempts. Verified by: `mutation-gate.test.ts`
  (`TestBR249_*`).
- **AC-17** (BR-250) — Given cancellation (a) after the policy decision and
  before the intent append starts, (b) while the intent append is pending,
  (c) after the intent resolved and before the first attempt, (d) during a
  429 wait, and (e) during an attempt that then answers 200, Then the results
  are (a) `CANCELLED`, 0 attempts, zero records; (b) and (c) `CANCELLED`, 0
  attempts, intent and outcome records; (d) `CANCELLED`, 1 attempt, with an
  outcome record; (e) `succeeded` with an outcome record and an unaborted
  mutator signal. Verified by: `mutation-gate.test.ts` (`TestBR250_*`).
- **AC-18** (BR-251) — Given a 503, a timeout and a connection loss, When the
  run ends, Then the mutator was called once, the result is `uncertain` with
  the fixed message, and the outcome says `uncertain`. Verified by:
  `mutation-gate.test.ts` (`TestBR251_*`).
- **AC-19** (BR-252) — Given an outcome append failure after a 200, a 503 and
  a 409, When the run ends, Then the results are `succeeded`, `uncertain` and
  `failed`/`UPSTREAM_REJECTED`, each with `audit:"outcome_unrecorded"`, never
  `AUDIT_UNAVAILABLE`; the mutator was called once; stderr has the fixed
  diagnostic once; the next run is refused at admission. Verified by:
  `mutation-gate.test.ts` (`TestBR252_*`).
- **AC-20** (BR-253) — Given a child process that runs a gate on a file sink
  and is killed with SIGKILL from inside the mutator, When a second process
  starts a sink on the same file and completes one run, Then the file holds the
  first `op`'s intent line intact with no outcome for it, then the second
  run's two records. Verified by: `audit-sink.test.ts` (`TestBR253_*`).
- **AC-21** (BR-254) — Given an in-flight run whose mutator settles after
  `close()` is called, When `close()` resolves, Then the run's outcome was
  recorded before the sink closed and a run started after `close()` was
  refused at admission; Given the HTTP composition with a run past its intent
  whose mutator settles 200 after shutdown starts, When shutdown runs, Then
  the HTTP close completes first and the client gets BR-164's 503, the
  outcome `succeeded` is recorded before the sink closes, and exit follows
  the gate close; Given the stdio composition with a run past its intent
  whose mutator settles 200 after 3,000 ms, When EOF or SIGTERM arrives, Then
  the outcome `succeeded` is recorded and the process exits after the gate
  close, and with no run past its intent the process exits within 1,000 ms.
  Verified by: `mutation-gate.test.ts` and
  `mutation-composition.test.ts` (`TestBR254_*`).
- **AC-22** (BR-255) — Given every result type, When results are returned,
  Then their members are a subset of the listed ones and `message` is one of
  the fixed strings. Verified by: `mutation-gate.test.ts` (`TestBR255_*`).
- **AC-23** (BR-256) — Given the production composition with a fake kDrive
  transport, `deny=["**/secret", "**/secret/**"]` and synthetic `rename`,
  `move`, `trash` and `create` mutators, When a move puts a folder into a
  `secret` folder, a folder trash covers a `secret` descendant, or a create
  would produce a result path named `secret`, Then each is `denied` with no
  intent record and no non-GET request; When a folder rename targets: a
  folder with a `secret` descendant, a tree that
  reaches `maxTreeItems=3`, a paging loop exceeding the page budget, a page with
  `has_more` and no cursor, a child whose path differs from parent + name, and
  a target whose `inspect` path differs from its path in the parent listing,
  Then each is `denied` with no intent record and no non-GET request; Given a
  clean tree, Then the run succeeds; Given a direct call of the policy
  `execute` dependency outside a gate run, Then it returns `unavailable` with
  no record and no request. Verified by: `mutation-composition.test.ts`
  (`TestBR256_*`).
- **AC-24** (BR-257) — Given the production composition with a fake transport,
  `sharedWithMe=true`, `sharedWrite=true`, mode `write`, a received folder with
  `can_write:true` and a read that cached the received list, When a `rename`
  run targets that folder, Then a new `shared_with_me` GET is made and the run
  is `denied` with no intent record. Verified by:
  `mutation-composition.test.ts` (`TestBR257_*`).
- **AC-25** (BR-258, BR-070 v2) — Given the stdio composition with the real
  navigation controller, mode `write`, a fake clock and a synthetic `rename`
  mutator answering 200 after 12,000 ms, When a gate run is dispatched
  through the shared policy facade served by that controller, Then the
  caller receives `succeeded` (not `REQUEST_TIMEOUT`), the outcome record says
  `succeeded`, and a concurrent read gets `SERVER_BUSY` until then; Given the
  navigation deadline firing before the intent append starts, Then the
  caller gets `REQUEST_TIMEOUT`, zero records and zero attempts; Given a
  mutator value whose serialization exceeds `maxOutputChars`, Then the
  caller receives `succeeded` without `value`; Given a mutator answering
  429 at 8,000 ms with `Retry-After: 5` and then 200, Then the run ends
  `succeeded` with `attempts:2` (the 10,000 ms navigation deadline is not a
  cancellation); Given the navigation deadline or a client cancellation
  firing while the policy decision is pending, Then the caller gets
  `REQUEST_TIMEOUT` or `CANCELLED` respectively, with zero records and zero
  attempts; Given another invocation active, When `mutate` is called, Then it
  returns `SERVER_BUSY` with zero records. Verified by:
  `mutation-composition.test.ts` (`TestBR258_*`, `TestBR070_*`,
  `TestBR250_*`).
- **AC-26** (BR-258, BR-070 v2) — Given the same composition and a mutator
  that answers 200 after 2,000 ms, When the MCP client cancels the call
  during the attempt, Then the mutator signal is not aborted, the value
  returned by the controller's `mutate` and the outcome record both say
  `succeeded`, and no navigation `ACCESS_DENIED` replaces it (the MCP
  response itself is not asserted); Given the client cancelling after the intent resolved and before
  the first attempt, Then the result is `CANCELLED` with 0 attempts and an
  outcome record. Verified by: `mutation-composition.test.ts`
  (`TestBR258_*`, `TestBR070_*`).

- **AC-27** (BR-259) — Given a file sink whose `fdatasync` never settles and
  a fake clock, When an intent append is 5,000 ms old, Then it rejects, the
  sink is latched and the run returns `AUDIT_UNAVAILABLE` with zero attempts;
  Given the same stall on the outcome append after a 200, Then the run
  returns `succeeded` with `audit:"outcome_unrecorded"`; Given a stderr sink
  whose intent write callback fires 6,000 ms after the write, Then the run
  makes zero attempts and records outcome `failed`/`AUDIT_UNAVAILABLE`.
  Verified by: `audit-sink.test.ts` and `mutation-gate.test.ts`
  (`TestBR259_*`).
- **AC-28** (Scope 7) — Given `docs/deployment.md` and the README after the
  implementation PR, When read, Then they state a `stop_grace_period` of at
  least 75 s for `write`/`share` modes, a writable mount for a file audit
  log, and that the audit outcome is authoritative after a 503 or a dropped
  response. Verified by: reviewer document check in the implementation PR.

## Decisions

- **D-16-1 — Late outcome-log failure (resolves D-06).** Chosen: return the
  real classification of the attempt (`succeeded`, `failed` or `uncertain`)
  with `audit:"outcome_unrecorded"`, latch the sink so further writes are
  refused until restart, and emit one fixed stderr diagnostic; the orphan
  intent stays detectable (BR-253). Rejected: (a) report a failure or
  `AUDIT_UNAVAILABLE` — it claims a performed write was prevented and invites a
  duplicate; (b) turn every result into `uncertain` — the server knows the
  outcome, and hiding it forces needless verification; (c) retry the outcome
  write until it succeeds — the call may never end and the cause (disk full) is
  usually persistent; (d) compensate by undoing the write — an unaudited write
  that may itself fail; (e) keep accepting writes after the failure — later
  writes would have no outcome trail.
- **D-16-2 — Intent after the policy decision.** The intent describes an
  authorized dispatch. Denials get a separate best-effort `denied` record.
  Rejected: intent before the decision (records for operations that never ran
  and still needs a second record). The intent append and its `fdatasync` sit
  between authorization and dispatch, which slightly widens the SPEC §10.6
  window; it stays a documented residual risk. Rejected: a fresh re-inspection
  after the intent (one more call per write, does not close the window).
- **D-16-3 — Record content: IDs, no names or paths.** IDs correlate with
  kDrive's own activity history without exposing names, which can be sensitive
  and are untrusted strings. Rejected: names/paths (sensitive, injection into
  log viewers); hashed names (unsalted hashes are dictionary-reversible).
  Identity strings are the only untrusted text and are escaped and bounded.
- **D-16-4 — Received mutation predicates stay `false`.** #16 measured flag
  names on a received share (`docs/api-notes.md`) but not which flag the API
  enforces for each effect. Mapping them now would authorize writes in another
  person's folder on an untested assumption. The first tool ticket that writes
  into a received share versions BR-204 with live evidence. Consequence:
  `KDRIVE_MCP_SHARED_WRITE=1` has no effect until then; the README must not
  advertise received-share writes.
- **D-16-5 — Retry numbers.** Three attempts matches BR-088. `Retry-After` is
  honoured only as delta-seconds, and a request to wait more than 30 s ends the
  run, because no 429 was observed (#16) and an HTTP-date needs a trusted
  clock; an absent or unusable value uses 1 s then 2 s. 30 s per attempt and 60 s per run bound the call for MCP clients.
  Assumption, not measured: a kDrive 429 means the write was not performed.
  Rejected: retrying 5xx or timeouts (may duplicate a write); unbounded
  `Retry-After`.
- **D-16-6 — Classification.** Only a fully received status that HTTP defines
  as a refusal of the request counts as `failed`; 408, 3xx and other 4xx/5xx
  are `uncertain` because the request reached a server whose effect is not
  established. `not-sent` requires transport proof, so an unproven error is
  `uncertain`. Rejected: treating every 4xx as `failed` (408 and unknown 4xx
  do not prove non-performance).
- **D-16-7 — Durability.** File: one `write` plus `fdatasync` per record, with
  the sink latched on any failure. Stderr: the write callback; its durability
  is that of whatever reads stderr, which the README states (a file is
  recommended for a durable trail). A file append is bounded at 5,000 ms
  (BR-259); a stderr reader that stops draining cannot be bounded by the
  server and holds the run, which the README states. Rejected: buffered or batched records (an
  intent could be lost after dispatch); continuing after a short write
  (a partial line followed by later records corrupts the next line).
- **D-16-8 — File sink checks.** `O_NOFOLLOW` plus `fstat` owner and `0o077`
  checks refuse a planted symlink or a readable file; the server never chmods
  an existing file. Rejected: following symlinks; fixing permissions silently.
  Limits: parent directories are not checked; NFS and other network
  filesystems do not get the `O_APPEND` line guarantee; rotation needs a
  restart because the descriptor stays open.
- **D-16-9 — Cancellation does not abort a dispatched attempt.** Aborting it
  turns a definite result into `uncertain` without stopping the server-side
  effect. Rejected: propagating the client's cancellation into the request.
- **D-16-10 — Executor bound by async context.** The policy facade passes a
  frozen copy of the operation to `execute`, so the gate binds the run through
  `AsyncLocalStorage` and checks the copy against the run's operation by value.
  Rejected: a per-run policy instance (would bypass the single shared facade
  of BR-043).
- **D-16-11 — Port implementation deferred to #18.** The gate is testable with a
  fake port; the non-GET transport needs a real endpoint for qualification.
  Rejected: building the transport here without any endpoint to qualify it.
- **D-16-12 — Sink opened only for `write`/`share`.** Read mode has nothing to
  audit; a bad audit path then fails startup only where it matters. Rejected:
  lazy opening on the first write (the failure would surface mid-session).

- **D-16-13 — Commit point at the start of the intent append.** Navigation
  bounds stop applying when the intent append starts, not when it resolves,
  because a started append cannot be withdrawn: if navigation still aborted
  the call, a durable intent could follow a navigation error. Before that
  point no record exists and navigation codes are accurate. Rejected: keeping
  the 10 s navigation deadline for writes (reports performed writes as
  `REQUEST_TIMEOUT`); raising the deadline for every tool (weakens BR-070 for
  reads). Consequence: a write holds the navigation slot, and delays stdio
  exit, up to the 60 s run deadline plus two 5,000 ms file appends (with the
  stderr sink, also until stderr drains).
- **D-16-14 — Shutdown order and HTTP 503.** HTTP close runs before the gate
  close so no new run is admitted while in-flight runs finish; BR-164 already
  discards the call result of a closed session, so the client may get a 503
  for a performed write. Rejected: delaying HTTP close until gates drain (the
  BR-169 1,000 ms bound would no longer hold). The README tells operators the
  audit outcome is authoritative after a 503.

## Open questions

None.

## Stress-test

### Review round 1 (`runs/17-spec-review-1.md`)

1. major, retained — added BR-258, BR-070 v2, AC-25/AC-26, D-16-13; the
   commit point is the start of the intent append, since it cannot be undone.
2. major, retained — BR-069 v2 allows audit records on stderr; AC-05 cites it.
3. minor, retained — BR-236 refuses at admission a run whose widest record
   exceeds 8,192 bytes; oversize no longer latches (BR-241, AC-03, AC-08).
4. minor, retained — BR-250 and AC-17 split cancellation before the intent
   append (no records) from after it (CANCELLED outcome).
5. minor, retained — BR-249 attempt timeout is min(30 s, time left); AC-16
   row added.
6. minor, retained — BR-254 states transport → gate → exit and the possible
   503 for a performed write; AC-21 row; D-16-14.
7. minor, retained — admission table added; BR-245 codes made explicit
   (`UNAVAILABLE` for tool/kind errors); AC-12 mismatch rows.
8. minor, retained — AC-23 rows for move into a denied folder, folder trash
   with a denied descendant, and a denied create result path.

### Review round 2 (`runs/17-spec-review-2.md`)

Fixed by the orchestrator (owner delegated autonomy, 2026-11-09).

1. major, retained — BR-070 v2 scopes the F-005 1,000 ms exit bound to no
   gate run past its intent; BR-254 bound restated; AC-21 stdio row.
2. minor, retained — BR-259 bounds file appends at 5,000 ms and latches on
   timeout; D-16-7 notes stderr cannot be bounded; AC-27.
3. minor, retained — BR-250 defines cancellation as client cancel or session
   close after the commit point; AC-25 row for 429 at 8 s + Retry-After 5.
4. minor, retained — BR-250: an aborted signal at `dispatch` settle with no
   intent gives zero records, `REQUEST_TIMEOUT` or `CANCELLED`; AC-25 row.
5. minor, retained — BR-258 names the controller entry point `mutate`, with
   `paged:false`, `SERVER_BUSY` and the gate result as value.
6. minor, retained — AC-26 asserts `mutate`'s return value and the outcome
   record; BR-258 states the audit outcome is authoritative after a cancel.

### Review round 3 (`runs/17-spec-review-3.md`)

Verdict approve; both minors applied editorially by the orchestrator: the
exit/close bound now names the stderr-draining dependency (BR-070 v2, BR-254,
D-16-13), and the ID note says BR-234–BR-259.

### Fable decision pass (`runs/17-spec-fable-1.md`)

Verdict approve (no critical/major); all 7 minors folded in before freeze:
1. `destinationDrive` member for cross-drive refusals; AC-01 row.
2. Mutator contract: one send per request, no internal retry/redirect, 429
   only before any accepted request, else throw (`uncertain`).
3. BR-259: an intent append resolving after 5,000 ms on either sink gives
   zero attempts and `failed`/`AUDIT_UNAVAILABLE`; AC-27 row.
4. BR-235 scoped to records, errors and gate-authored members; `value`
   passes through and is never recorded; AC-02 clarified.
5. Opaque `payload` channel on `mutate` and mutators, never recorded or
   returned (avoids versioning BR-258 in #19/#20).
6. Scope 7 and AC-28: deployment grace ≥ 75 s and writable audit mount.
7. BR-236 escapes every identity code point outside U+0020–U+007E; AC-03.

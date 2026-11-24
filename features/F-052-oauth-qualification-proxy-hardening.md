---
id: F-052
title: OAuth qualification and proxy hardening
ticket: "#72"
status: draft
version: 1
---

## Context

The qualification operator and clients using the OAuth proxy encounter five
edge cases in F-008, F-010 and F-033: conflicting discovery endpoints,
irrelevant issuer-identification uncertainty, unfinished hidden terminal reads,
registration defaults applied to explicit nulls and duplicate capacity events,
and CIMD protocol upgrades retaining fetch capacity until timeout.

This is security-sensitive full-path work: discovery selects credential
destinations, the terminal reads secrets and CIMD fetching consumes bounded
unauthenticated capacity. The owner fixed the scope on 2026-11-24. This draft
records the review dispositions below, but no freeze, implementation or test
result.

## Scope

1. `scripts/oidc/discovery.ts` and `scripts/oidc-qualify.ts`: refuse the token
   step on conflicting endpoints while preserving discovery anomalies.
2. `src/auth/verdict.ts`: require issuer-rejection evidence only for a
   delegation path applicable to the client.
3. `scripts/oidc/terminal.ts`: settle EOF/errors, define control handling and
   restore terminal state on every exit.
4. `src/auth/proxy/proxy.ts`: refuse explicit null registration members and
   emit one capacity event per full-store refusal.
5. `src/auth/proxy/client-metadata-fetch.ts`: settle status 101 immediately
   and release the BR-309 fetch slot through the existing fetch lifecycle.

### Out of scope

- Terminal-slash issuer support: retain F-002 canonicalization and the exact
  upstream issuer match of F-010, BR-131 v2. This is a documented limitation;
  Infomaniak's issuer has no terminal slash (owner decision, 2026-11-24).
- Cold/rotated JWKS concurrency, already fixed by F-035, BR-133 v2.
- Every other behavior change, new configuration, dependency or protocol.

## Business rules

These are deltas: each previous version otherwise holds. New terminal-rule
IDs BR-440–BR-442 are allocated to this draft.

- **BR-096 v2** — Token-step admission additionally requires no endpoint
  disagreement between the two usable discovery documents: for each of
  `authorization_endpoint` and `token_endpoint`, two present values (neither
  `undefined`, including `null` and non-strings) disagree exactly when their
  `JSON.stringify` results differ, matching the existing discovery anomaly
  without URL normalization. Admission checks run in this order: discovery
  usable, PKCE S256 yes, endpoint disagreement, effective-endpoint HTTPS,
  then the supported client-secret authentication-method check. Disagreement
  refuses before either interactive prompt, authorization URL output or token
  exchange and writes an `unsupported` report with the existing
  `<member> differs between documents` anomalies and the exact `tokenStep`
  `refused: <members> differs between documents`, where `<members>` is
  `authorization_endpoint`, `token_endpoint`, or
  `authorization_endpoint, token_endpoint` in that order. Verified by: AC-01,
  AC-02.
- **BR-103 v2** — On an inconsistent run, the client fact "rejects inconsistent
  issuer identification" is needed exactly when, ignoring that fact, steps 3 or 4
  can select delegation for this provider/client, treating other `unverified`
  facts as potentially `supported`; otherwise it cannot make the result
  `undetermined`. Verified by: AC-03, AC-04.
- **BR-440 v1** — A pending hidden read rejects once on stdin `end` with
  `Input ended`, or stdin `error` with `Input failed`, without returning
  buffered input or exposing the original error text or stack.
  Verified by: AC-05.
- **BR-441 v1** — The hidden reader consumes controls as follows: CR or LF
  completes the line, Ctrl-C rejects with `Interrupted`, DEL (`U+007F`)
  keeps its existing backspace edit, Ctrl-D (`U+0004`) rejects with
  `Input ended`, and any other Unicode `Cc` character, including backspace
  (`U+0008`) and ESC (`U+001B`), rejects with `Unsupported control character`
  rather than stripping or returning it. Verified by: AC-06.
- **BR-442 v1** — Every hidden-read exit once raw-mode activation is attempted
  attempts each cleanup step once, independently and best-effort: restore the
  pre-read raw state (`isRaw`, default false when unavailable), pause input,
  remove each of the read's data/end/error listeners and write one cleanup
  newline before settlement. This includes success, Ctrl-C, EOF, input error,
  control refusal and setup failure. A throwing cleanup step cannot prevent
  the remaining steps or settlement: preserve the specified payload-free
  read failure, or reject with exactly `Input failed` if cleanup fails on an
  otherwise successful read, without exposing the cleanup error payload or stack. If
  `setRawMode(true)` itself throws after the prompt, the same cleanup attempts
  restoration of the captured state. Setup failures during or after
  `setRawMode(true)` reject with exactly `Input failed`, without the original
  error text or stack, including when cleanup also fails. Admission first
  refuses non-TTY input or a missing raw-mode setter with `A terminal is required`,
  then refuses already-ended or destroyed input with `Input ended`; both
  checks precede the prompt, produce no prompt and no newline, and neither
  activates raw mode nor attaches read listeners. An exported
  `createProductionDeps` factory in `scripts/oidc-qualify.ts` takes the input
  and output streams, installs one payload-free stdin `error` handler before
  any read and returns the production dependencies including both hidden
  readers bound to those streams. The main block calls this factory once.
  The handler remains for the process lifetime, including between reads and
  after settlement; it exposes neither error payload nor stack. Late events
  cannot settle or clean up a read again.
  Verified by: AC-07.
- **BR-127 v2** — Registration with an explicit JSON `null` for
  `token_endpoint_auth_method` or `grant_types` returns 400
  `{"error":"invalid_client_metadata"}` without creating a client; defaults
  apply only when the member is absent. Verified by: AC-08.
- **BR-143 v5** — Each refusal caused by a full consent, flow or code store
  has a whole log delta of exactly one `store_full` event, with only `store`
  and `count` naming the saturated store and its live count, without `handler`.
  The handler-level event is removed, not renamed. This supersedes F-028's
  "today's" consent-store-full row and handler requirement for that refusal
  under BR-394 v1–v2 (via F-028 Contract details); other authorization-refusal events are unchanged.
  Each client or family eviction continues to emit exactly one `store_full`
  event with only `{store, count}` naming that store and its live count at
  capacity. Verified by: AC-09.
- **BR-306 v3** — A complete header block accepted by Node's HTTP parser
  with status 101, within the existing 8,192-byte bound, ends the CIMD fetch
  immediately as
  `{ok:false, reason:"status", status:101, transient:false}`, destroying
  the request, dedicated agent and any upgraded socket, clearing its deadline
  and releasing its BR-309 fetch slot without awaiting body bytes, peer
  closure or the 5,000 ms deadline. A status-line match by the byte watcher
  alone does not establish status 101: parser errors retain the existing
  `connection` / `transient:true` classification and status 0 when no response
  was accepted. Header overflow still takes precedence as `size`, status 0,
  `transient:false`. Verified by: AC-10, AC-11.
- **BR-394 v3** — A CIMD authorization refused because of that 101 emits
  exactly one `client_metadata_refused` with
  `{handler:"authorize", reason:"status", status:101}`.
  Verified by: AC-11.

## Acceptance criteria

All named tests below are planned Vitest tests in existing files. They use
synthetic input and local doubles; none qualifies a real provider. Test names
include their BR versions. Existing BR-104 v1 output redaction remains in force.

- **AC-01** (BR-096 v2) — Given otherwise qualifying usable documents with
  different authorization endpoints, different token endpoints, or both,
  When `token` runs, Then it writes an `unsupported` report with each existing
  anomaly and exactly `tokenStep: "refused: authorization_endpoint differs between documents"`,
  `tokenStep: "refused: token_endpoint differs between documents"`, or
  `tokenStep: "refused: authorization_endpoint, token_endpoint differs between documents"`
  respectively, prints no authorization URL, calls no
  hidden reader and makes no token request (metadata/JWKS reads remain
  allowed). Include differences only in host case, explicit default port,
  percent-encoding and terminal slash even when URL serialization would make
  them equal. Include a valid HTTPS endpoint in the first document and `null`
  or a non-string such as `42` in the second, and the reverse order; these
  refuse on disagreement even when the effective endpoint is invalid.
  Verify that existing not-usable and PKCE refusals keep precedence, while
  disagreement precedes both the HTTPS refusal and the unsupported
  client-secret-method stop (so disagreement yields `unsupported`, not
  `incomplete`). Verified by `BR-096 v2 AC-01 endpoint disagreement refuses token`
  in `tests/auth/discovery.test.ts`.
- **AC-02** (BR-096 v2) — Given identical endpoints, one usable document, or
  a member absent from one usable document, When discovery and token
  admission run, Then the existing first-defined endpoint and admission
  behavior remain; an unusable document cannot cause a conflict, and a
  missing/invalid effective endpoint still refuses under the existing HTTPS
  check. Given disagreeing documents, When `discover` alone runs, Then it
  still reports `incomplete` with the anomalies. Verified by
  `BR-096 v2 AC-02 endpoint agreement and discovery boundaries`
  in `tests/auth/discovery.test.ts`.
- **AC-03** (BR-103 v2) — Given a `proxy-only` provider with usable ID token,
  inconsistent issuer identification and a client with dynamic registration
  `supported`, When deciding with the issuer-rejection fact set in turn to
  `unverified`, `supported` and `not supported`, Then each result is `proxy`
  and the promotion flag is true. Given a delegating provider but no applicable
  registration/manual-entry path even under supported completions, Then that
  fact alone does not cause `undetermined`. Verified by
  `BR-103 v2 AC-03 issuer uncertainty does not block proxy`
  in `tests/auth/verdict.test.ts`.
- **AC-04** (BR-103 v2) — Given an inconsistent run where dynamic registration,
  CIMD with `none` yes, or manual client ID entry can enable delegation,
  When the issuer-rejection fact is `unverified`, Then the result remains
  `undetermined`, including an otherwise eligible path whose mechanism fact
  is also `unverified`; consistent runs retain delegation, and unsupported or
  incomplete providers retain `not decided`. Verified by
  `BR-103 v2 AC-04 applicable delegation still needs issuer evidence`
  in `tests/auth/verdict.test.ts`.
- **AC-05** (BR-440 v1) — Given a pending hidden read with empty or nonempty
  synthetic secret input, When stdin ends or emits an error containing that
  secret, Then it rejects promptly with exactly `Input ended` or `Input failed`
  and terminal output contains only the prompt and cleanup newline. Given
  either reader rejects in the qualification runner, When `run` catches it,
  Then it returns 1, writes no report and prints only its existing fixed
  `Qualification failed; no report was written.` diagnostic, without a stack
  or input. Verified by `BR-440 v1 AC-05 EOF and errors settle without payload`
  in `tests/auth/terminal.test.ts` and
  `BR-440 v1 AC-05 reader failure stays redacted`
  in `tests/auth/qualify-report.test.ts`.
- **AC-06** (BR-441 v1) — Given hidden input, When it contains Ctrl-D,
  backspace `\b`, tab, NUL, a C1 control or an escape sequence (whole or split
  across chunks), Then the specified fixed refusal occurs at its first
  refused control with no returned/echoed input; CR/LF still complete, DEL
  still edits and Ctrl-C still interrupts. Verified by
  `BR-441 v1 AC-06 controls refuse without silent stripping`
  in `tests/auth/terminal.test.ts`.
- **AC-07** (BR-442 v1) — Given a fake terminal initially raw or nonraw,
  When a hidden read succeeds, receives Ctrl-C, EOF, error or a refused
  control, or setup throws during or after `setRawMode(true)`, Then its raw
  state returns to the captured initial value, input pauses, owned listeners
  are removed and one cleanup newline is written, once before settlement;
  late data/end cannot repeat cleanup. Setup failures during or after
  `setRawMode(true)` reject with exactly `Input failed`, without the original
  error text or stack, including when cleanup also throws. Given a cleanup
  step throws (including restoring `setRawMode`, pausing, removing a listener
  or writing the newline),
  When a successful or failing read exits, Then every remaining cleanup step
  is still attempted once and the promise settles once, preserving the
  specified payload-free read failure or rejecting an otherwise successful
  read with exactly `Input failed`, without exposing the cleanup error payload
  or stack.
  Given already-ended or destroyed TTY input, When a read starts, Then it
  rejects immediately with exactly `Input ended`; non-TTY input or a missing
  raw-mode setter instead rejects first with `A terminal is required`, even
  if ended or destroyed. In each admission refusal, output is empty (no prompt,
  no newline), raw mode is never activated and no read listeners are attached.
  Given a fake input emitter and output streams passed directly to the exported
  `createProductionDeps` factory, When its returned readers run sequentially
  and a payload-bearing error arrives after settlement or between reads,
  Then it is handled without an uncaught exception, output or stack, cannot
  change the settled result, and the single lifetime handler remains while
  per-read listeners are removed. The main block uses that same factory (verified by code review).
  Verified by
  `BR-442 v1 AC-07 every exit restores terminal state including Ctrl-C`
  in `tests/auth/terminal.test.ts` and
  `BR-442 v1 AC-07 runner retains payload-free stdin error handler`
  in `tests/auth/qualify-report.test.ts`.
- **AC-08** (BR-127 v2) — Given otherwise valid registrations, When either
  named member is null, or both are null, Then each returns 400
  `invalid_client_metadata` with no client insertion; when omitted, Then
  registration still returns 201 with `client_secret_basic` and both grants,
  and explicit supported methods/grants still succeed. Verified by
  `BR-127 v2 AC-08 null is not absent`
  in `tests/auth/proxy-registration.test.ts`.
- **AC-09** (BR-143 v5) — Given respectively 1,000 live consents, flows or
  codes and a valid request needing one more entry, When that request is
  refused, Then its whole log delta is exactly one `store_full` with exactly
  `{store, count:1000}`, without `handler` or any additional event under any
  name, and the existing 503 HTML, `temporarily_unavailable`
  redirect or `server_error` redirect respectively remains; expiry restores
  admission. Given full client and family stores, When the existing eviction
  paths admit a new entry, Then eviction behavior remains and each eviction
  has exactly one `store_full` log delta with exactly
  `{store:"clients", count:1000}` or `{store:"families", count:1000}`
  respectively. Verified by
  `BR-143 v5 AC-09 each full-store refusal emits one event`
  in `tests/auth/proxy-bounds.test.ts`.
- **AC-10** (BR-306 v3) — Given a local TLS double holding its socket open
  after a 101, with and without upgrade headers, sent whole or fragmented,
  optionally after 103, When its complete bounded header block is accepted
  by Node's HTTP parser with status 101,
  Then the production fetch returns the exact terminal status outcome before
  a 1,000 ms watchdog after header delivery without advancing the 5,000 ms
  deadline, and closes the socket; trailing bytes do not change the outcome.
  An 8,192-byte block gives status 101, whereas an 8,193-byte block retains
  `size`, status 0, `transient:false`. A bounded block whose status line
  matches the byte watcher's status pattern but which Node's parser rejects
  retains `{ok:false, reason:"connection", status:0, transient:true}` rather
  than becoming a terminal status-101 outcome. Verified by
  `BR-306 v3 AC-10 101 settles before deadline and preserves header precedence`
  in `tests/auth/cimd-fetch.test.ts`.
- **AC-11** (BR-306 v3, BR-394 v3) — Given three held CIMD fetches and a
  fourth receiving a held-open 101 through the production fetch port,
  When the fourth settles, Then a fifth distinct URL starts and completes
  while the three remain held and no deadline is advanced; the refused
  authorization has one exact status-101 event and the existing terminal
  400 page. On stale-entry refetch, 101 deletes the entry rather than serving
  it, under unchanged BR-309 v2. Verified by
  `BR-306 v3 BR-394 v3 AC-11 101 releases capacity and refuses terminally`
  in `tests/auth/proxy-cimd.test.ts`.

## Decisions

- **D-1 — Match existing endpoint anomalies.** Compare `JSON.stringify`
  results for any two present endpoint values, including `null` and
  non-strings, exactly as discovery already does. For string values this
  preserves lexical differences without URL normalization: metadata must
  agree on the destination without guessing which differences a provider
  treats as equivalent. Absence (`undefined`) in one document is not
  disagreement. Existing usable/PKCE checks precede disagreement; HTTPS and
  client-secret-method checks follow it. Reject choosing one conflicting
  document silently or merely recording the anomaly.
- **D-2 — Client-specific relevance.** The issuer-rejection fact guards only
  delegation paths; do not require it solely because an issuer is inconsistent.
  Other unknown client facts keep the existing counterfactual relevance rule.
- **D-3 — Refuse residual controls.** Ctrl-D means EOF in raw mode. The current
  reader appends `\b`, ESC and other residual controls to the returned value.
  Refuse them: returning controls can carry escape sequences into a pasted
  URL, while stripping them could silently change a secret or leave sequence
  suffixes. Retain the existing DEL editing behavior. Reader failures use fixed
  messages; the runner retains its fixed diagnostic and no-stack policy.
- **D-4 — Version existing purposes.** BR-127 v2 tightens registration
  presence semantics; BR-143 v5 defines capacity-event multiplicity and its
  existing store/count shape. Full consent/flow/code refusals remove the
  handler-level event rather than renaming it: the whole log delta is one
  `store_full` with only `{store, count}`, without `handler`. For consent-store
  saturation this supersedes F-028's "today's" row and BR-394 v1–v2's handler
  requirement; other authorization-refusal events remain unchanged.
  BR-306 v3 makes 101 a final status failure
  when Node's parser accepts the block rather than an interim block or
  timeout; BR-394 v3 explicitly records its received status. Parser errors
  retain their existing classification; header overflow still takes
  precedence. BR-309 v2 already
  releases settled slots and deletes terminally failed stale entries, so it
  needs no version bump. No new event, reason or ADR is needed.
- **D-5 — Terminal-slash limitation retained.** The owner's 2026-11-24
  decision keeps F-002 canonicalization and BR-131 v2's exact issuer match;
  accepting or normalizing a slash at discovery is excluded. Infomaniak's
  issuer has no terminal slash, so this limitation does not block that provider.

## Open questions

## Stress-test

- 72-spec-review-1-opus #1 (major) — retained — BR-096 v2 and D-1 now match the existing JSON.stringify anomaly for all present values; AC-01 includes null and non-string conflicts in both document orders.
- 72-spec-review-1-opus #2 (minor) — retained — BR-096 v2 fixes the exact tokenStep strings, member order and admission-check precedence; AC-01 asserts each outcome.
- 72-spec-review-1-opus #3 (minor) — retained — BR-442 v1 requires a process-lifetime payload-free stdin error handler and immediate Input ended rejection for ended or destroyed input; AC-07 covers both in named reader and runner tests.
- 72-spec-review-1-opus #4 (minor) — retained — BR-442 v1 and AC-07 include setRawMode(true) throwing, restoration of captured isRaw and the cleanup newline before rejection.
- 72-spec-review-1-opus #5 (minor) — retained — BR-306 v3 requires Node parser acceptance for status 101, preserves parser-error classification and names the BR-309 fetch slot; AC-10 covers parser rejection.
- 72-spec-review-1-opus #6 (minor) — retained — BR-143 v5 explicitly preserves one store_full event per client/family eviction; AC-09 asserts the exact store/count payloads.
- 72-spec-review-1-opus #7 (minor) — retained — The business-rule introduction now states that BR-440–BR-442 are allocated, with no allocation question remaining.
- 72-spec-review-1-opus #8 (minor) — retained — D-3 now states that the current reader returns residual controls and explains why refusal replaces that behavior.
- 72-spec-review-2-opus #1 (minor) — retained — BR-442 v1 requires an exported createProductionDeps stream factory used by main; AC-07 exercises its returned readers and lifetime handler directly with a fake emitter.
- 72-spec-review-2-opus #2 (minor) — retained — BR-442 v1 orders non-TTY/missing-setter refusal before ended/destroyed refusal, both before the prompt; AC-07 asserts no prompt, newline, raw-mode activation or read listeners.
- 72-spec-review-2-opus #3 (minor) — retained — BR-442 v1 makes each cleanup step independently best-effort before one settlement, preserving failures and rejecting successful reads with Input failed on cleanup failure; AC-07 covers throwing restoration and the other cleanup steps.
- 72-spec-review-2-opus #4 (minor) — retained — BR-103 v2 now says the issuer-rejection fact is needed exactly when a delegation path can apply, matching AC-04's positive direction.
- 72-spec-review-3-opus #1 (minor) — retained — AC-07 states that the main block's use of the factory is verified by code review.
- 72-spec-decision-1-fable #1 (minor) — retained — BR-143 v5 and D-4 remove the handler-level event and supersede F-028's consent-store-full row and handler requirement; AC-09 asserts the whole log delta is one store_full with only store/count, without handler or any additional event under another name.
- 72-spec-decision-1-fable #2 (minor) — retained — BR-442 v1 fixes setup-failure rejection to exactly Input failed without original error text or stack, including when cleanup fails; AC-07 asserts that exact result.
- 72-spec-review-4-opus #1 (minor) — retained — the supersession now names BR-394 v1–v2 (via F-028 Contract details).

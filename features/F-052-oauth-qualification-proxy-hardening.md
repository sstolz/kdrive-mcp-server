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
records no review, freeze, implementation or test result.

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
   and release the fetch slot through the existing resolver lifecycle.

### Out of scope

- Terminal-slash issuer support: retain F-002 canonicalization and the exact
  upstream issuer match of F-010, BR-131 v2. This is a documented limitation;
  Infomaniak's issuer has no terminal slash (owner decision, 2026-11-24).
- Cold/rotated JWKS concurrency, already fixed by F-035, BR-133 v2.
- Every other behavior change, new configuration, dependency or protocol.

## Business rules

These are deltas: each previous version otherwise holds. New terminal-rule
IDs BR-440–BR-442 are proposed pending the allocation question below.

- **BR-096 v2** — Token-step admission additionally requires no endpoint
  disagreement between the two usable discovery documents: for each of
  `authorization_endpoint` and `token_endpoint`, two present string values
  disagree exactly when their decoded JSON strings are unequal, without URL
  normalization; disagreement refuses before either interactive prompt,
  authorization URL output or token exchange and writes an `unsupported`
  report identifying the conflicting member with its existing
  `<member> differs between documents` anomaly. Verified by: AC-01, AC-02.
- **BR-103 v2** — On an inconsistent run, the client fact "rejects inconsistent
  issuer identification" is needed only if, ignoring that fact, steps 3 or 4
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
- **BR-442 v1** — Every hidden-read exit after raw-mode activation restores
  the pre-read raw state (`isRaw`, default false when unavailable), pauses
  input and removes the read's data/end/error listeners before settlement,
  including success, Ctrl-C, EOF, input error, control refusal and setup
  failure; late events cannot settle or clean up the read again.
  Verified by: AC-07.
- **BR-127 v2** — Registration with an explicit JSON `null` for
  `token_endpoint_auth_method` or `grant_types` returns 400
  `{"error":"invalid_client_metadata"}` without creating a client; defaults
  apply only when the member is absent. Verified by: AC-08.
- **BR-143 v5** — Each refusal caused by a full consent, flow or code store
  emits exactly one `store_full` event, with only `store` and `count` naming
  the saturated store and its live count. Verified by: AC-09.
- **BR-306 v3** — A complete status-101 header block within the existing
  8,192-byte bound ends the CIMD fetch immediately as
  `{ok:false, reason:"status", status:101, transient:false}`, destroying
  the request, dedicated agent and any upgraded socket, clearing its deadline
  and releasing its resolver slot without awaiting body bytes, peer closure
  or the 5,000 ms deadline. Verified by: AC-10, AC-11.
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
  anomaly and the endpoint refusal, prints no authorization URL, calls no
  hidden reader and makes no token request (metadata/JWKS reads remain
  allowed). Include differences only in host case, explicit default port,
  percent-encoding and terminal slash even when URL serialization would make
  them equal. Verified by `BR-096 v2 AC-01 endpoint disagreement refuses token`
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
  control, or setup throws after activation, Then its raw state returns to
  the initial value, input pauses and owned listeners are removed once
  before settlement; late data/end do nothing and a subsequent error handled
  by the stream's owner cannot change the settled result. Non-TTY refusal
  never activates raw mode. Verified by
  `BR-442 v1 AC-07 every exit restores terminal state including Ctrl-C`
  in `tests/auth/terminal.test.ts`.
- **AC-08** (BR-127 v2) — Given otherwise valid registrations, When either
  named member is null, or both are null, Then each returns 400
  `invalid_client_metadata` with no client insertion; when omitted, Then
  registration still returns 201 with `client_secret_basic` and both grants,
  and explicit supported methods/grants still succeed. Verified by
  `BR-127 v2 AC-08 null is not absent`
  in `tests/auth/proxy-registration.test.ts`.
- **AC-09** (BR-143 v5) — Given respectively 1,000 live consents, flows or
  codes and a valid request needing one more entry, When that request is
  refused, Then its log delta contains exactly one `store_full` with exactly
  `{store, count:1000}`, and the existing 503 HTML, `temporarily_unavailable`
  redirect or `server_error` redirect respectively remains; expiry restores
  admission, and client/family eviction behavior remains. Verified by
  `BR-143 v5 AC-09 each full-store refusal emits one event`
  in `tests/auth/proxy-bounds.test.ts`.
- **AC-10** (BR-306 v3) — Given a local TLS double holding its socket open
  after a 101, with and without upgrade headers, sent whole or fragmented,
  optionally after 103, When its complete bounded header block arrives,
  Then the production fetch returns the exact terminal status outcome before
  a 1,000 ms watchdog after header delivery without advancing the 5,000 ms
  deadline, and closes the socket; trailing bytes do not change the outcome.
  An 8,192-byte block gives status 101, whereas an 8,193-byte block retains
  `size`, status 0. Verified by
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

- **D-1 — Exact endpoint strings.** Compare decoded JSON strings exactly,
  not canonical URLs: metadata must agree on the destination without guessing
  which lexical differences a provider treats as equivalent. Absence in one
  document is not disagreement; the existing effective-endpoint HTTPS checks
  and anomaly handling for malformed present values remain. Reject choosing
  one conflicting document silently or merely recording the anomaly.
- **D-2 — Client-specific relevance.** The issuer-rejection fact guards only
  delegation paths; do not require it solely because an issuer is inconsistent.
  Other unknown client facts keep the existing counterfactual relevance rule.
- **D-3 — Refuse residual controls.** Ctrl-D means EOF in raw mode. Refuse
  `\b`, ESC and other residual controls instead of stripping them: stripping
  can silently change a secret or leave escape-sequence suffixes in a pasted
  URL. Retain the existing DEL editing behavior. Reader failures use fixed
  messages; the runner retains its fixed diagnostic and no-stack policy.
- **D-4 — Version existing purposes.** BR-127 v2 tightens registration
  presence semantics; BR-143 v5 defines capacity-event multiplicity and its
  existing store/count shape. BR-306 v3 makes 101 a final status failure
  rather than an interim block or timeout; BR-394 v3 explicitly records its
  received status. Header overflow still takes precedence. BR-309 v2 already
  releases settled slots and deletes terminally failed stale entries, so it
  needs no version bump. No new event, reason or ADR is needed.
- **D-5 — Terminal-slash limitation retained.** The owner's 2026-11-24
  decision keeps F-002 canonicalization and BR-131 v2's exact issuer match;
  accepting or normalizing a slash at discovery is excluded. Infomaniak's
  issuer has no terminal slash, so this limitation does not block that provider.

## Open questions

- The brief starts new rules at BR-438, but BR-438 v1 and BR-439 v1 are
  already active for F-051 (#77); `docs/spec-index.md` names BR-440 as next
  free. Confirm the proposed BR-440–BR-442 allocation before freeze; existing
  IDs are not reused. No product decision remains open.

## Stress-test

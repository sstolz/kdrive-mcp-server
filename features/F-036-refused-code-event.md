---
id: F-036
title: Refused authorization-code redemption events restored
ticket: "#49"
status: frozen
version: 1
---

# F-036 — Refused authorization-code redemption events restored

Author: Codex (model and effort unknown), spec phase, 2026-11-15.
Base: branch `feat/49-refused-code-event` (main `4136853`).
IDs: F-036; BR-137 v3; AC-01–AC-06. No new BR ID or ADR.
Next free IDs checked in the supplied main checkout (`docs/spec-index.md`,
`business-rules/`): F-036, BR-423, ADR-013.

## Context

F-035 (#46), accepted on main `703bece`, made BR-137 v2 check all code
bindings before consumption or replay revocation. Its steps (1)–(4) and
step (5) without a remaining refresh family now return without an event.
Previously these refusals logged `token_refused`. The strongest-tier code
pass identified the lost audit signal for a stolen or replayed code; the
owner decided in #49 to restore it. Operators need to see refused attempts
without exposing credentials or changing the protections established by
F-035. Refresh-token and client-authentication refusals already log this
event.

The existing `tokenError()` in `src/auth/proxy/proxy.ts:756` emits
`token_refused` with `handler`, `error` and `status`. BR-143 v4 limits event
names and fields; the `token_refused` catalogue entry is in F-010's Contract
details, referenced by BR-143.
BR-394 adds enumerated `reason` values for CIMD events, not code redemption.
BR-167 v3 forbids peer addresses in responses and events.

## Scope

- BR-137 v3: restore exactly one `token_refused` per refused code redemption
  through the existing optional logger, using the existing event shape.
- Keep BR-137 v2's validation order, response bodies and headers, lifetime,
  redirect-URI compatibility, consumption and replay-revocation semantics.
- Replace F-035 AC-01–AC-04's empty-log assertions for refusals with exact
  event arrays; retain empty arrays for successful redemptions. Extend
  coverage to missing/unknown codes, repeated refusals, replay after family
  deletion, precedence, and exact field privacy.
- Prepare the pending BR, business-rule index, spec index, capability and
  changelog records. At implementation, add an F-036 pending-acceptance note
  to `docs/oauth-proxy.md` describing the restored event and its fields.

### Out of scope

- A new event name, `reason` field, identifier, address, correlation value,
  timestamp or grant-type field in the proxy event; log-sink changes.
- Changes to BR-136 admission/authentication, BR-140 refresh refusals,
  BR-298 commits, BR-299 store-failure handling, HTTP admission or rate limits.
- Consuming a code on a failed binding, revoking on a mismatching or expired
  replay, a per-code attempt counter, persistence changes, or new dependencies.
- Editing `src/` or `tests/`, implementation, review, freeze, commits, forge
  operations, acceptance or release during this draft-authoring step.

## Business rules

- **BR-137 v3** — v2 holds except for refusal logging. After BR-136, each
  refusal at steps (1)–(5) without a BR-299 failure emits exactly one `token_refused` to the optional
  logger with exactly `{ handler: "token", error, status: 400 }`, where
  `error` is `invalid_target` only at step (4), otherwise `invalid_grant`.
  Step (5) with a remaining family retains its existing single
  `refresh_family_revoked` event followed by its single `token_refused`;
  it gains no duplicate. Steps (1)–(4) and step (5) without a family add no
  state change or commit: v2's in-memory client-last-use exception remains.
  Matching replay revocation, success and BR-299 failure handling are
  unchanged. No `reason` or request-derived value is added. Verified by:
  AC-01–AC-06.

Unchanged dependencies: [BR-136 v2](../business-rules/BR-136.md),
[BR-140 v2](../business-rules/BR-140.md),
[BR-143 v4](../business-rules/BR-143.md),
[BR-167 v3](../business-rules/BR-167.md),
[BR-298 v2](../business-rules/BR-298.md) and
[BR-299 v2](../business-rules/BR-299.md). BR-143's catalogue already permits
this name and these fields, so it is not versioned.

## Contract details

The following are exact captured logger entries, in the existing `h.logs`
shape. The labels are notation for the ACs, not new production constants.

```ts
const G = {
  name: "token_refused",
  fields: { handler: "token", error: "invalid_grant", status: 400 },
};
const T = {
  name: "token_refused",
  fields: { handler: "token", error: "invalid_target", status: 400 },
};
const R = {
  name: "refresh_family_revoked",
  fields: { handler: "token" },
};
```

| Outcome after BR-136 | Exact event array for that request |
| --- | --- |
| Step (1): absent, empty or unknown code | `[G]` |
| Step (2): expired code, consumed or not | `[G]` |
| Step (3): client, redirect URI or PKCE mismatch | `[G]` |
| Step (4): resource mismatch after all earlier checks pass | `[T]` |
| Step (5): matching replay with no remaining family | `[G]` |
| Step (5): matching replay with a family, commit succeeds | `[R, G]` |
| Step (6): successful redemption in a fixture below store bounds | `[]` |

Every response retains the BR-136 headers and the v2 body; a refusal in the
table has exactly `{"error":"invalid_grant"}` or
`{"error":"invalid_target"}`. Exact event equality rejects any extra field,
including `reason`, address, code, verifier, redirect URI, resource, client
ID, client secret, identity, cookie or token. With no logger, there is no
new output or state; responses remain identical.

The table describes normally operating fixtures, with initialization logs
cleared and no unrelated purge/eviction. Existing BR-299 failures still
answer 503 `temporarily_unavailable` and log exactly one
`token_refused` with `{ handler: "token", error: "temporarily_unavailable",
status: 503 }`, alongside the existing store/revocation events when
applicable. Do not add a second event around `revoke()` or `unavailable()`.
Requests refused before BR-137 keep their existing events; the restoration
does not log them again or alter HTTP-layer refusals.

## Acceptance criteria

All test names below are the exact intended names after implementation.
The F-035 tests keep their cases and assertions except the BR version and
the changed logging expectations. Clear or slice `h.logs` immediately before
each measured request (after login/registration), assert before subsequent
refresh probes, and compare whole arrays with `toEqual`, not just counts or
filtered subsets. No success, startup or refresh event is attributed to a
code-refusal request.

- **AC-01** (BR-137 v3, BR-143 v4) — Given fresh codes for registered and
  CIMD clients, When the F-035 AC-01 mismatch rows run (another client,
  empty/altered redirect URI, wrong verifier, 42/129-character verifier,
  forbidden verifier character, another resource), Then each refusal has
  exactly `[G]`, except a resource mismatch has `[T]`, and a later correct
  redemption returns 200 with a refresh token and no event. Given the
  single/multiple/variable-loopback redirect profiles for both client kinds,
  When the URI is omitted, matching or mismatching, Then the v2 success and
  refusal decisions stay the same, with `[]` for success and `[G]` for
  refusal. Given matching 43- and 128-character verifiers, Then each
  succeeds with `[]`. Verified by
  `BR-137 v3 AC-01 refuses %s without consuming the code`,
  `BR-137 v3 AC-01 redirect URI %s follows the compatibility profile` and
  `BR-137 v3 AC-01 accepts a %i-character verifier` in
  `tests/auth/proxy-token.test.ts`.
- **AC-02** (BR-137 v3, BR-298 v2) — Given a redeemed code and family F,
  When each AC-01 mismatch is presented (including disallowed URI omission),
  Then each request logs `[G]` or `[T]` as above, commits nothing and leaves
  F refreshable. When every binding matches before expiry, Then the replay
  returns 400 `invalid_grant`, logs exactly `[R, G]`, commits one
  `deleteFamily` before the response, and F's latest refresh token fails.
  When that code is replayed again, or a code issued to a client without
  the refresh grant is replayed, Then each request returns 400
  `invalid_grant`, logs `[G]` and commits nothing. Verified by
  `BR-137 v3 AC-02 only a replay matching every binding revokes the family`
  in `tests/auth/proxy-token.test.ts` and
  `BR-298 BR-137 v3 AC-02 a refused replay commits nothing` in
  `tests/auth/proxy-persistence.test.ts`.
- **AC-03** (BR-137 v3) — Given independent codes created at T, When a
  matching first redemption occurs at T + 59,999 ms, Then 200 and `[]`;
  at T + 60,000 ms, Then 400 `invalid_grant` and `[G]`. Given codes already
  redeemed at T + 1 s, When matching replay occurs at T + 59,999 ms, Then
  400 `invalid_grant`, `[R, G]` and family revocation; at T + 60,000 ms,
  Then 400 `invalid_grant`, `[G]` and the family still refreshes. Repeat
  the expired case after code purge: the unknown code still logs `[G]` and
  cannot revoke the family. Verified by
  `BR-137 v3 AC-03 the 60-second lifetime bounds redemption and replay revocation`
  in `tests/auth/proxy-token.test.ts`.
- **AC-04** (BR-137 v3) — Given a fresh code, When two matching redemptions
  run concurrently, Then one returns 200 and one 400 `invalid_grant`, with
  exactly `[R, G]` in the combined log and the family revoked. When one
  wrong-verifier request races a correct request, in either invocation
  order, Then 400 and 200, exactly `[G]` in the combined log and the issued
  refresh token still works. Verified by
  `BR-137 v3 AC-04 concurrent redemptions consume and revoke only on matching requests`
  in `tests/auth/proxy-token.test.ts`.
- **AC-05** (BR-137 v3, BR-298 v2, BR-299 v2) — Given otherwise valid requests,
  When the code is absent, empty or unknown, Then each returns 400
  `invalid_grant` and `[G]`. Given fresh and consumed codes with both a
  binding mismatch and resource mismatch, Then step (3) wins: 400
  `invalid_grant` and `[G]`; with only a resource mismatch, step (4) wins:
  400 `invalid_target` and `[T]`. Given an expired code, in fresh and
  consumed variants, with only a resource mismatch, Then step (2) wins
  over step (4): 400 `invalid_grant` and `[G]`, not `[T]`. Repeat a fresh-code
  wrong-verifier attempt twice: each logs `[G]`, and a subsequent correct
  request succeeds. All these refusals leave code/family state unchanged
  (apart from the existing in-memory client last use) and commit nothing
  under a recording store; include expired unconsumed codes and both
  no-family replay cases. Given a valid first redemption at step (6), When
  `failCommit` is enabled after setup, Then the response is 503
  `temporarily_unavailable` and the whole event array is exactly:

  ```ts
  [
    {
      name: "store_write_failed",
      fields: { handler: "token", store: "families" },
    },
    {
      name: "token_refused",
      fields: { handler: "token", error: "temporarily_unavailable", status: 503 },
    },
  ]
  ```

  Given a matching replay at step (5) with a remaining family, When
  `failCommit` is enabled after successful redemption, Then the response
  is 503 `temporarily_unavailable` and the whole event array is exactly:

  ```ts
  [
    R,
    {
      name: "store_write_failed",
      fields: { handler: "token", store: "families" },
    },
    {
      name: "token_refused",
      fields: { handler: "token", error: "temporarily_unavailable", status: 503 },
    },
  ]
  ```

  Neither failed-commit case logs a 400 `G`. Verified by
  `BR-137 v3 AC-05 missing codes and competing failures log the first refusal`
  in `tests/auth/proxy-token.test.ts` and
  `BR-298 BR-137 v3 AC-05 restored refusal events write no state` and
  `BR-299 BR-137 v3 AC-05 failed code commits log exactly one refusal`
  in `tests/auth/proxy-persistence.test.ts`.
- **AC-06** (BR-137 v3, BR-143 v4, BR-167 v3) — Given synthetic
  recognizable request values and a capturing logger, When every table
  refusal is exercised, Then the complete event arrays equal those above
  and contain none of those values or any `reason` field. When the same
  cases run without a logger, Then response status, headers and body are
  identical and no fallback output is written to stdout or stderr.
  Verified by `BR-137 v3 BR-143 v4 AC-06 code refusal events contain only fixed fields`
  and `BR-137 v3 AC-06 code refusals work without a logger` in
  `tests/auth/proxy-secrecy.test.ts`. Given the implementation records and
  `docs/oauth-proxy.md`, Then they describe these exact fields, no reason,
  no new state change and the preserved matching-replay exception; verify
  by a scoped content/link check, not a unit test for prose.

## Test plan

1. After independent spec review and freeze, run the existing F-035
   AC-01–AC-04 tests on the implementation base as characterization of v2.
   Retain their state, response, concurrency and persistence assertions.
2. Before changing production code, rename the covered tests to BR-137 v3,
   replace only refusal-side empty logs with the exact arrays above, and
   add AC-05/AC-06 and the missing replay/purge cases. Run the targeted
   suites and record the expected failures on the currently silent paths.
3. Implement only the missing event emissions, then run the same suites.
   Retain BR-136 client-authentication, BR-140 refresh-refusal, BR-143
   secrecy and BR-299 failed-commit coverage as regressions, including
   `BR-299 AC-08 a failed code-redemption commit issues no token` and
   `BR-299 AC-08 after a failed reuse revocation the current token gets 503 and no token`
   in `tests/auth/proxy-persistence.test.ts`.
4. Run `make check` through the project's Docker/Make toolchain, followed
   by PR CI and the independent reviews required for this security-sensitive
   ticket. All fixtures use synthetic values, a fake clock and the existing
   injected upstream/store; no provider or owner-environment run is needed.
5. After merge, verify AC-01–AC-06 on the actual main SHA and record commands,
   results and token accounting in #49. Keep v3 pending until acceptance;
   synchronize final markers in the next scoped reviewed PR before release.

The draft-authoring sandbox forbids Docker, network access and commits;
the runtime gate and all implementation tests above belong to the later
implementation phase. This draft makes no passing-test or CI claim.

## Decisions

- **D-1 — Reuse the existing event without `reason`.** The owner requested
  restoration of an audit signal, not branch-specific diagnostics. The
  fixed OAuth `error` already distinguishes resource mismatch from other
  grant refusals. Rejected: an enumerated reason such as `unknown`,
  `expired`, `binding`, `resource` or `replay`, which would widen the event
  contract without an established operator need; free-form reasons, which
  could leak request data. No reason values are permitted here. If a later
  feature adds reasons, it must enumerate bounded constants and version
  the affected event rule; BR-394's CIMD reasons do not authorize them here.
- **D-2 — One refusal event, preserving revocation.** Use the existing
  refusal path for the currently silent exits. Rejected: logging around
  every call to `redeemCode()`, which would duplicate the event already
  emitted by matching replay and storage failures. "No state change" applies
  to the newly logged refusals; it does not undo v2's matching-replay
  revocation or its client-last-use exception.
- **D-3 — Version only BR-137.** No event catalogue or field changes are
  necessary. Keep BR-137 v2's text and acceptance evidence unchanged, and
  add v3 as pending. No new BR ID or costly-to-reverse architectural choice.

## Risks

- A shared refusal helper can double-log matching replay or 503 failures;
  AC-02's matching-replay and AC-05's two explicit `failCommit` whole-array
  assertions guard this. Existing BR-299 regressions check responses and
  state, not these exact event arrays; the reuse case covers refresh reuse.
- A broad empty-log replacement can hide a success regression or count a
  following refresh refusal. Capture each request separately; successful
  redemptions still assert `[]` under the bounded fixtures.
- Logs regain attempt counts but intentionally do not identify a client or
  distinguish expiry from a bad verifier or unknown code. This is the
  existing privacy tradeoff, not evidence that a refusal proves theft.
- Restoring logging increases volume under abuse. BR-162 v3's per-peer and
  global `/oauth/token` windows bound the events per minute; no sampling, new
  log storage or rate-limit change is added.

## Open questions

None. The draft chooses the existing event shape without `reason` (D-1).

## Stress-test

- **Round 1 — `49-spec-review-1-reviewer`: approve with two minors.**
  Retained both: clarify the BR-299 503 exception so BR-137's 400 wording
  does not contradict store-failure handling; name BR-162 v3 as the
  log-volume bound so the risk cites the existing admission rule. Fixed
  in `3c79f16`.
- **Decision pass — `49-spec-decision-1-fable`: approve with three minors.**
  Retained all three: add AC-05's two `failCommit` whole-array assertions
  and correct the risk claim because existing regressions do not assert
  those logs; use expired fresh and consumed codes with only a resource
  mismatch to distinguish step (2) from step (4); record both reviews here
  so the stress-test reflects their verdicts and dispositions. Fixed in
  this revision. No freeze is claimed.

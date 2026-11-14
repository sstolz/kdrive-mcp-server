---
id: F-032
title: Repeated consent POST answered idempotently
ticket: "#33"
status: draft
version: 1
---

# F-032 — Repeated consent POST answered idempotently

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` (main `489883b`).
IDs: F-032; BR-411 v1; BR-129 v5; BR-142 v3. No ADR: one bounded in-memory
map and one branch in the consent handler, nothing persisted, cheap to reverse.
Next free IDs checked on main (`docs/spec-index.md`, `business-rules/`):
F-032, BR-411, ADR-012.

## Context

In `proxy` mode the consent page (BR-129 v4) posts a one-use consent
identifier and `decision` to `<issuer>/oauth/consent?lang=xx`. The handler in
`src/auth/proxy/proxy.ts` (`consent`) deletes the identifier on its first
presentation, before any check, then either redirects to the client with
`error=access_denied` (deny) or, after `discover()` (BR-131), stores an
upstream flow and answers 302 to the identity provider with a refreshed
`Set-Cookie` (approve).

A double click on Approve posts the form twice. The first POST consumes the
identifier and prepares the 302; the browser aborts that navigation in favour
of the second POST, which finds the identifier consumed and gets the 400
`consent` ("already used") page. The user is stranded although the
authorization was valid. Affected: every browser user of a proxy-mode server.

Owner decision on #33 (option A): fix it on the server, without JavaScript and
with the CSP unchanged. A repeat from the same browser within a short window
gets the same 302 as the first POST. The upstream flow stays one-use at the
callback, so nothing can be authorized twice.

## Scope

- BR-411: a bounded, memory-only record of recently decided consents, and the
  replay of the first POST's 302 to a repeat from the same browser within
  10 seconds, for `approve` and `deny`.
- BR-129 v5: the "consumed identifier yields 400" clause gains the BR-411
  exception.
- BR-142 v3: the new record is listed among the proxy stores with its bound
  and its eviction.
- Three test-only additions carried from `31-code-decision-1-fable`
  (AC-10–AC-12): no rule changes for BR-409 v1 or BR-157 v1.

### Out of scope

- Any JavaScript, button disabling or CSP change (owner).
- Replaying an outcome other than the decision's own 302 (503 `busy`, client
  redirect `temporarily_unavailable` after an upstream or store failure).
- The authorize, callback and token handlers; the HTTP layer (Origin, rate
  windows, body checks) is unchanged and still runs before the proxy.
- Persisting the record in the state file (BR-292), or sharing it across
  instances.

## Business rules

- **BR-411** — Repeated consent POST.
  (1) **Record.** When the consent handler takes a live pending consent past
  every BR-129 check (identifier known and unexpired, no repeated form
  parameter, cookie match of BR-130, `decision` `approve` or `deny`), it
  records, under that identifier, the consent's cookie hash, the `decision`
  and the consumption time `t0` (the clock read when the identifier was
  consumed, before `discover()`), with the outcome pending. When that first
  POST answers the decision's 302 (approve: the BR-131 upstream redirect after
  its flow is stored; deny: the client redirect with `error=access_denied`),
  the record keeps that response's `Location`. When it answers anything else
  (503 `busy`, client redirect `temporarily_unavailable`), the record is
  deleted.
  (2) **Replay.** A consent POST whose `consent` value is not a pending
  consent but has a record is replayed when all hold: the time is before
  `t0 + 10` seconds; the form repeats no parameter; its `decision` equals the
  recorded one; and the request's cookie matches the recorded hash under
  BR-130 (exactly one well-formed `__Host-kdrive-oauth`, constant-time
  SHA-256 comparison). A replay answers 302 with the recorded `Location`
  byte for byte and `Cache-Control: no-store`, and no `Set-Cookie`. If the
  outcome is still pending, the repeat waits for the first POST's own
  completion (no second `discover()` call) and then is replayed only if the
  record then holds a `Location`; otherwise it gets the 400 `consent` page.
  Any number of repeats inside the window is replayed.
  (3) **No side effect.** A replay creates, deletes or changes no pending
  consent, flow, code, client, family or cache, starts no upstream fetch, logs
  no event, and moves no time: `t0`, the flow's `created` time (BR-142 TTL)
  and the cookie expiry stay as they were. A repeat that fails (2) gets the
  existing 400 `consent` page with its single `consent_refused` event, and the
  record is left unchanged.
  (4) **Unchanged cases.** An unknown identifier, an expired window, another
  or absent cookie, a different `decision`, and an identifier consumed by a
  failing first presentation (no record) get the 400 `consent` page as today.
  A latched store (BR-299) still answers the 503 `busy` page first.
  (5) **Bounds.** Records live in memory only, are never written to the state
  file (BR-292) and a new instance starts with none. The purge before a write
  (BR-142 v3) deletes every record with `time >= t0 + 10` s. At most 1,000
  records exist; recording into a full set evicts the oldest record in
  insertion order, with no event and no effect on the first POST's answer.
  Verified by: AC-01–AC-09.
- **BR-129 v5** — v4 holds, except that a consumed identifier with a BR-411
  record is answered under BR-411 (2) instead of the 400 page; the identifier
  stays one-use for every other purpose. Verified by: AC-01, AC-03, AC-05.
- **BR-142 v3** — v2 holds, except that the stores add the BR-411 consent
  replay records: memory only in every mode, at most 1,000, purged at
  `t0 + 10` s, and a full set evicts its oldest record instead of refusing.
  Verified by: AC-06.

Existing rules this feature relies on without change:

- **BR-130 v1**: the replay sets no cookie, consistent with "every response
  that creates cookie-bound state" carries `Set-Cookie`; a replay creates none.
- **BR-143 v4**: no new event name or field. A replayed `Location` re-issues
  the upstream `state`/`nonce`/challenge or the echoed client `state` only to
  the browser that holds the matching cookie, the holder BR-143 already allows.
- **BR-157 v1** (Origin on `/oauth/consent`) and **BR-162 v2** (consent window
  30 per 60 s) run in `src/http/handler.ts` before `proxy.consent`, so a
  repeat is Origin-checked and counted like any POST.
- **BR-409 v1**: unchanged; only its tests grow (AC-10, AC-11).

## Acceptance criteria

Tests use the deterministic clock, random source and fake upstream of
`tests/auth/proxy-consent.test.ts`; HTTP-layer tests use
`tests/http/host-origin.test.ts`.

- **AC-01** (BR-411, BR-129 v5) — Given a pending consent approved by POST at
  `t0` with cookie `C`, When the same form is posted again with `C` at
  `t0 + 1` s, Then both answers are 302 with byte-identical `Location` (the
  identity provider), the second carries `Cache-Control: no-store` and no
  `Set-Cookie`, the flow store holds one flow, the fake upstream saw one
  discovery fetch, and the logger received no call for the repeat; and the
  callback with that upstream `state` succeeds once, a second callback with
  it gets the existing flow refusal. Verified by:
  `BR-411 AC-01 a repeated approve replays the upstream redirect`.
- **AC-02** (BR-411) — Given no cached discovery and a fake upstream whose
  discovery reply is held, When two approve POSTs of one consent with `C`
  start before the reply is released, Then after release both are 302 with
  the same `Location`, one discovery fetch and one flow exist; and when the
  held reply fails instead, the first gets the `temporarily_unavailable`
  client redirect and the second the 400 `consent` page. Verified by:
  `BR-411 AC-02 a repeat during discovery shares the first outcome`.
- **AC-03** (BR-411, BR-129 v5) — Given a consent denied at `t0` with `C`,
  When the form is posted again with `C` at `t0 + 1` s, Then both answers are
  302 with the same client `Location` holding `error=access_denied`, `state`
  and `iss`, and exactly one `consent_refused` event was logged. Verified by:
  `BR-411 AC-03 a repeated deny replays the client redirect`.
- **AC-04** (BR-411) — Given an approval at `t0`, When repeats are posted at
  `t0 + 6` s, `t0 + 9.999` s and `t0 + 10` s, Then the first two are replayed
  and the third gets the 400 `consent` page (a repeat does not extend the
  window). Verified by: `BR-411 AC-04 the window is 10 seconds from t0`.
- **AC-05** (BR-411, BR-129 v5) — Given an approval at `t0` with `C`, When a
  repeat inside the window has another well-formed cookie, no cookie, two
  binding cookies, `decision=deny`, or a repeated `consent` field, Then each
  gets the 400 `consent` page with one `consent_refused` event, and a later
  repeat with `C` is still replayed; and given an unknown identifier, an
  identifier first presented with a wrong cookie or `decision=maybe`, and
  approvals that ended in `temporarily_unavailable` (upstream down; full flow
  store) or the 503 `busy` page (latched store), Then a repeat with the right
  cookie gets the 400 `consent` page (latched: 503 `busy`). Verified by:
  `BR-411 AC-05 %s is not replayed`.
- **AC-06** (BR-411, BR-142 v3) — Given 1,000 records inside the window, When
  a 1,001st approval is recorded, Then the oldest record's repeat gets the
  400 page and the newest is replayed; given records older than 10 s, When
  any write purges, Then the snapshot holds none of them; and given
  `oauthStateFile` set, Then after an approval and a replay the file holds no
  consent identifier or record, and a proxy reopened from it answers the
  repeat with the 400 page. Verified by:
  `BR-411 AC-06 the replay records are bounded, purged and never stored`.
- **AC-07** (BR-411, BR-157 v1, BR-162 v2) — Given an approval, When the
  repeat carries a foreign `Origin`, Then it gets 403 `invalid_origin` and
  `proxy.consent` is not called; When 30 consent POSTs (repeats included)
  were made in the window, Then the 31st gets 429 `rate_limited`. Verified
  by: `BR-411 AC-07 a repeat passes the HTTP checks` in
  `tests/http/host-origin.test.ts`.
- **AC-08** (BR-411) — Given a replay, Then no logger call, response header
  or body other than the replayed `Location` contains the consent
  identifier, the cookie value or the upstream `state`, `nonce` or
  challenge. Verified by: `BR-411 AC-08` in `tests/http/secrecy.test.ts`.
- **AC-09** (BR-411) — Given an approval replayed at `t0 + 1` s, Then the
  pending flow's `created` value in the snapshot equals that of the first
  POST and the flow expires at the same time as without a repeat. Verified
  by: `BR-411 AC-09 a replay moves no lifetime`.
- **AC-10** (BR-409 v1) — Given, with cookie `C`, an equal pending consent
  created at `T` and a second equal one created at `T + 300` s, When the
  switcher is followed at `T + 600` s (the first expired, the second live),
  Then the purge removes the first, the second is replaced, one consent
  remains and the second's identifier gets the 400 page. Verified by:
  `BR-409 AC-05 the oldest live equal consent after the purge is replaced`
  in `tests/auth/proxy-language.test.ts`.
- **AC-11** (BR-409 v1) — Given a CIMD consent, When the switch arrives after
  the client's document changed its kept grants (`cimdGrants` differs), and
  given a registered client's consent, When a `lang` request differs only in
  `code_challenge`, Then each adds a consent and deletes none (two pending,
  the first still approves with 302); and a CIMD switch with the same grants
  replaces it. Verified by: `BR-409 AC-05 cimdGrants and codeChallenge are
  compared` in `tests/auth/proxy-language.test.ts`.
- **AC-12** (BR-157 v1) — Given a consent POST to `/mcp/oauth/consent?lang=fr`
  with a foreign `Origin`, Then it gets 403 `invalid_origin` and the proxy is
  not called. Verified by: `BR-157 AC-05 consent with lang and a foreign
  Origin is refused` in `tests/http/host-origin.test.ts`.

## Decisions

- **D-1 — Replay on the server (owner, option A).** Rejected: disabling the
  button with JavaScript (needs a `script-src` in the BR-401 CSP; the owner
  excluded it); keeping the identifier alive until the callback (the
  identifier would stop being one-use and could start a second flow).
- **D-2 — Deny is replayed too.** A double click on Deny has the same
  failure: the client never receives `access_denied` and keeps waiting, while
  the user sees "already used". The replayed client redirect holds only
  `error`, `state` and `iss`, grants nothing and was already issued to that
  browser. Rejected: keeping the error for Deny (asymmetric, strands the
  client).
- **D-3 — Window 10 s from consumption, not from the answer.** It covers a
  double or triple click and a slow round trip, and stays far below the
  600 s consent and flow TTLs. Rejected: up to the flow TTL (a stolen
  identifier plus cookie would keep yielding the redirect; no use case).
- **D-4 — Only the decision's own 302 is replayed.** A failure outcome is
  not worth caching: the user restarts from the client anyway, and the
  record is deleted so no stale answer is replayed.
- **D-5 — The repeat waits for a pending first POST.** Without it, the first
  approval after start or after a discovery expiry (BR-133) would still fail
  on a double click, since discovery is the only await. Sharing the first
  POST's completion keeps one discovery and one flow.
- **D-6 — No `Set-Cookie` on a replay.** The repeat presented the cookie, so
  the browser holds the value; re-sending `Max-Age=600` would only push its
  expiry. The `Location` stays identical.
- **D-7 — No event for a replay.** An approval logs none and a denial logs one
  `consent_refused`; a replay is the same answer, not a new decision.
  Rejected: a new event name (BR-143 change and an F-010 event-list change for
  a diagnostic only).
- **D-8 — Eviction, not refusal, when full.** The record is a convenience; a
  full set must never refuse a valid first POST.
- **D-9 — A failing repeat leaves the record.** Deleting it would let a
  request with a wrong cookie cancel the real browser's replay.
- **D-10 — No ADR** (memory only, cheap to reverse, no dependency).

## Open questions

None.

## Stress-test

Not reviewed yet.

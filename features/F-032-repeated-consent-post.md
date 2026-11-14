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
IDs: F-032; BR-411 v1; BR-129 v5; BR-142 v3; AC-01–AC-13. No ADR: one bounded in-memory
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
- The proxy's test snapshot (the one the existing store tests read) gains the
  replay records (identifier, `t0`, decision, pending or settled), so AC-06
  can observe the purge; no production output changes.
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
  records, under that identifier and before `discover()`, the consent's
  cookie hash, the `decision`, the consumption time `t0` (the clock read when
  the identifier was consumed) and the first POST's completion, with the
  outcome pending. When that first POST answers the decision's 302 (approve:
  the BR-131 upstream redirect after its flow is stored; deny: the client
  redirect with `error=access_denied`), the record keeps that response's
  `Location` and becomes settled. When it ends in anything else (503 `busy`,
  client redirect `temporarily_unavailable`, or an exception), the record is
  deleted; the first POST's own answer is unchanged.
  (2) **Replay.** A consent POST whose `consent` value is not a pending
  consent but has a record is eligible when all hold on its arrival: the
  clock read on arrival is before `t0 + 10` seconds; the form repeats no
  parameter; its `decision` equals the recorded one; and the request's cookie
  matches the recorded hash under BR-130 (exactly one well-formed
  `__Host-kdrive-oauth`, constant-time SHA-256 comparison). The window is
  checked on arrival only, never again after a wait. An eligible repeat of a
  settled record is replayed at once. An eligible repeat of a pending record
  waits on the completion captured from the record on arrival (not on a later
  lookup of the record), with no second `discover()` call; the completion is
  released whatever the first POST's end, an exception included. After the
  wait the repeat re-reads the BR-299 latch and answers the 503 `busy` page if
  it is set; otherwise it is replayed if the first POST answered the
  decision's 302, and gets the 400 `consent` page in every other case (failure
  outcome or exception). A replay repeats the first answer's headers: status
  302, the recorded `Location` byte for byte and `Cache-Control: no-store`;
  for `approve` also `Set-Cookie` with the bound value taken from the repeat's
  own cookie (equal to the first, since the hashes match) and the BR-130
  attributes (`Max-Age=600`), as the first answer sent; for `deny` no
  `Set-Cookie`, as the first answer (the client redirect) sends none today.
  Any number of repeats inside the window is replayed.
  (3) **No side effect.** A replay creates, deletes or changes no pending
  consent, flow, code, client, family or cache, starts no upstream fetch, logs
  no event, and moves no server-side time: `t0` and the flow's `created` time
  (BR-142 TTL) stay as they were. The approve replay's `Set-Cookie` gives the
  browser a cookie expiring 600 s after the replay, which is no earlier than
  the flow's expiry (`created + 600` s, `created` being before the replay), so
  the callback's cookie check (BR-130) does not fail for lack of the cookie
  while the flow lives. A repeat that fails (2) gets the existing 400
  `consent` page with its single `consent_refused` event, and the record is
  left unchanged.
  (4) **Unchanged cases.** An unknown identifier, a repeat arriving at or
  after `t0 + 10` s, another or absent cookie, a different `decision`, and an
  identifier consumed by a failing first presentation (no record) get the 400
  `consent` page as today. A latched store (BR-299) still answers the 503
  `busy` page first, on arrival and after a wait.
  (5) **Bounds.** Records live in memory only, are never written to the state
  file (BR-292) and a new instance starts with none. The purge before a write
  (BR-142 v3) deletes every settled record with `time >= t0 + 10` s; a pending
  record is never purged nor evicted (its first POST may purge at
  `after >= t0 + 10` s, since the discovery deadline `UPSTREAM_DEADLINE_MS` is
  also 10 s). At most 1,000 records exist; recording into a full set evicts
  the oldest settled record in insertion order, or records nothing when all
  are pending, with no event and no effect on the first POST's answer.
  Verified by: AC-01–AC-09, AC-13.
- **BR-129 v5** — v4 holds, except that a consumed identifier with a BR-411
  record is answered under BR-411 (2) instead of the 400 page; the identifier
  stays one-use for every other purpose. Verified by: AC-01, AC-03, AC-05.
- **BR-142 v3** — v2 holds, except that the stores add the BR-411 consent
  replay records: memory only in every mode, at most 1,000, purged at
  `t0 + 10` s, and a full set evicts its oldest record instead of refusing.
  Verified by: AC-06.

Existing rules this feature relies on without change:

- **BR-130 v1**: an approve replay carries the same `Set-Cookie` as the first
  approve answer (same value and attributes); a deny replay, like a deny
  answer, carries none. A double click aborts the first navigation, so the
  replay is usually the only upstream redirect whose `Set-Cookie` the browser
  stores.
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
  identity provider), the second carries `Cache-Control: no-store` and a
  `Set-Cookie` byte-identical to the first's (value of `C`, `Max-Age=600`),
  the flow store holds one flow, the fake upstream saw one
  discovery fetch, and the logger received no call for the repeat; and the
  callback with that upstream `state` succeeds once, a second callback with
  it gets the existing flow refusal. Verified by:
  `BR-411 AC-01 a repeated approve replays the upstream redirect`.
- **AC-02** (BR-411) — Given no cached discovery and a fake upstream whose
  discovery reply is held, When two approve POSTs of one consent with `C`
  start before the reply is released, Then after release both are 302 with
  the same `Location`, one discovery fetch and one flow exist; and when the
  held reply fails instead, the first gets the `temporarily_unavailable`
  client redirect and the second the 400 `consent` page; when the random
  source throws during the first POST's flow creation, the waiting repeat is
  released and gets the 400 `consent` page; and when the store latches
  (BR-299) while the reply is held, the waiting repeat gets the 503 `busy`
  page. Verified by:
  `BR-411 AC-02 a repeat during discovery shares the first outcome`.
- **AC-03** (BR-411, BR-129 v5) — Given a consent denied at `t0` with `C`,
  When the form is posted again with `C` at `t0 + 1` s, Then both answers are
  302 with the same client `Location` holding `error=access_denied`, `state`
  and `iss`, neither carries `Set-Cookie`, and exactly one `consent_refused` event was logged. Verified by:
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
  store), the 503 `busy` page (latched store) or an exception (throwing
  random source), Then a repeat with the right
  cookie gets the 400 `consent` page (latched: 503 `busy`). Verified by:
  `BR-411 AC-05 %s is not replayed`.
- **AC-06** (BR-411, BR-142 v3) — Given 1,000 records inside the window, When
  a 1,001st approval is recorded, Then the oldest record's repeat gets the
  400 page and the newest is replayed; given records older than 10 s, When
  any write purges, Then the test snapshot (Scope) holds none of the settled
  ones and still holds a pending one; and given
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
  or body other than the replayed `Location` and, for approve, the BR-130
  `Set-Cookie` contains the consent identifier, the cookie value or the
  upstream `state`, `nonce` or challenge; the `Set-Cookie` carries only the
  cookie value. Verified by: `BR-411 AC-08` in `tests/http/secrecy.test.ts`.
- **AC-09** (BR-411) — Given an approval replayed at `t0 + 1` s, Then the
  pending flow's `created` value in the snapshot equals that of the first
  POST and the flow expires at the same time as without a repeat. Verified
  by: `BR-411 AC-09 a replay moves no lifetime`.
- **AC-10** (BR-409 v1) — Given, with cookie `C`, an equal pending consent
  created at `T` and a second equal one created at `T + 300` s by an
  authorize request without `lang` (so it adds a consent instead of replacing
  the first), When the
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
- **AC-13** (BR-411) — Given no cached discovery and a held discovery reply,
  an approval POST at `t0` with `C` and a repeat with `C` arriving at
  `t0 + 1` s, When the clock is advanced to `t0 + 10` s or later and the
  reply is then released, Then the first POST stores its flow and answers
  302, the waiting repeat is replayed with the same `Location`, the record is
  not purged while pending, and a further repeat arriving after the release
  at `t0 + 10` s or later gets the 400 `consent` page. Verified by:
  `BR-411 AC-13 the window is checked on arrival`.

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
- **D-6 — An approve replay repeats the first answer's `Set-Cookie`.** In a
  double click the browser aborts the first navigation, so the first 302's
  `Set-Cookie` is usually never stored and the replay is the only upstream
  redirect the browser processes. Without it the cookie keeps the expiry set
  by the consent page, up to 600 s earlier than the flow's (`created` is
  `after`), and the callback's cookie check could fail on a flow still alive.
  The value is the bound value of the repeat's own cookie, equal to the first
  since the hashes match, so no cookie secret is kept in the record. A deny
  replay sends no `Set-Cookie`, exactly as the deny answer does today.
  Rejected: no `Set-Cookie` on a replay (strands a slow user at the callback).
- **D-7 — No event for a replay.** An approval logs none and a denial logs one
  `consent_refused`; a replay is the same answer, not a new decision.
  Rejected: a new event name (BR-143 change and an F-010 event-list change for
  a diagnostic only).
- **D-8 — Eviction, not refusal, when full.** The record is a convenience; a
  full set must never refuse a valid first POST. Over HTTP the consent window
  (BR-162 v2, `src/http/limits.ts`) is process-wide 30 per 60 s, so at most
  about 30 records exist in any 10 s; the 1,000 bound is a backstop for
  direct callers, an attacker cannot reach it to evict a victim's record, and
  an eviction only brings back today's 400 page.
- **D-9 — A failing repeat leaves the record.** Deleting it would let a
  request with a wrong cookie cancel the real browser's replay.
- **D-10 — No ADR** (memory only, cheap to reverse, no dependency).

## Open questions

None.

## Stress-test

Review 1 (33-spec-review-1-reviewer):

1. [major] D-6 wrong: the aborted first navigation means the first 302's
   `Set-Cookie` is usually never stored, and the cookie can expire before
   the flow (`created = after`, `proxy.ts` consent; callback cookie check).
   **Retained.** D-6, the BR-130 note and BR-411 (2)/(3) rewritten: an
   approve replay repeats the first answer's `Set-Cookie` (bound value from
   the request, `Max-Age=600`); a deny replay sends none, mirroring the deny
   answer (`clientRedirect` adds no `Set-Cookie`). AC-01 and AC-03 assert it.
2. [major] Window check timing, waiter binding, purge of pending records.
   **Retained.** BR-411 (2): window checked on arrival only; the waiter is
   bound to the completion captured from the record on arrival. BR-411 (5):
   pending records are exempt from purge and eviction, since the first POST
   purges at `after` and `UPSTREAM_DEADLINE_MS` (`upstream.ts`) is 10 s.
   New AC-13.
3. [minor] Release on exception; latch after the wait. **Retained.**
   BR-411 (1)/(2)/(4); AC-02 (throwing random source, latch while held) and
   AC-05 (exception case).
4. [minor] AC-06 snapshot. **Retained.** Scope adds the test snapshot's
   replay records; AC-06 names it.
5. [minor] D-8 bound rationale. **Retained.** D-8 cites the process-wide
   consent window 30 per 60 s (`limits.ts`) and says an eviction only brings
   back today's 400.
6. [minor] AC-10 precondition. **Retained.** The second equal consent comes
   from an authorize request without `lang`.

Review 2 (33-spec-review-2-reviewer), `changes` on `24a5685`; retained
(applied by the orchestrator): AC-08 now excepts the approve replay's BR-130
`Set-Cookie`, which carries the cookie value by design (AC-01), so AC-01 and
AC-08 no longer contradict.

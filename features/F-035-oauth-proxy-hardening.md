---
id: F-035
title: OAuth proxy admission and grant handling hardened
ticket: "#46"
status: done
version: 1
---

# F-035 — OAuth proxy admission and grant handling hardened

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-15.
Base: branch `feat/46-oauth-hardening` (main `958138f`).
IDs: F-035; BR-421 v1; BR-422 v1; BR-023 v4; BR-024 v5; BR-131 v2;
BR-133 v2; BR-137 v2; BR-162 v3; BR-167 v3; BR-184 v3; BR-186 v2;
AC-01–AC-21.
No ADR (D-8).
Next free IDs checked on main (`docs/spec-index.md`, `business-rules/`):
F-035, BR-421, ADR-013.

## Context

The cross-vendor review `0-review-1-codex` found four defects in the
`proxy`-mode OAuth server and its HTTP layer, confirmed in the code of
main `958138f` and collected in #46. Affected: the owner, whose AI clients
log in and refresh through the proxy, and every operator who runs the
server behind a reverse proxy.

1. **Code redemption.** `redeemCode()` in `src/auth/proxy/proxy.ts` sets
   `code.consumed = true` before it checks the client binding, the
   `redirect_uri`, the PKCE verifier and the `resource`, and on an already
   consumed code revokes the refresh family before those checks
   (BR-137 v1, F-010 D-8). A holder of a leaked code, without the verifier,
   can therefore burn the code with any invalid request, or revoke the
   family the legitimate client just received. OAuth 2.1 asks the server to
   deny a code used more than once and to revoke the tokens issued from it;
   a request that fails the code's bindings is not a use of the code.
2. **JWKS on a cold cache.** `fetchJwks()` sets `lastJwksFetch` before it
   awaits the upstream reply. A second callback that arrives while that
   fetch is pending finds no keys and a fetch "started less than 60 s ago",
   so it is throttled and its ID token is rejected (`server_error`), although
   the pending fetch would have supplied the key (BR-133 v1). The same
   happens to concurrent callbacks after a key rotation. Discovery already
   shares its in-flight promise (`discover()`, BR-131).
3. **Shared windows.** `ROUTE_WINDOWS` in `src/http/limits.ts` (BR-162 v2)
   are process-wide, keyed by route name only, and count every request
   before its body is read, valid or not. Thirty invalid registrations close
   `/oauth/register` for an hour for everyone; sixty invalid token requests
   a minute block every login and refresh. F-012 D-7 accepted this because
   the HTTP layer had no trustworthy client address behind a reverse proxy:
   the server ignores `X-Forwarded-*` (`docs/oauth-proxy.md`), and the
   documented Compose deployment puts Traefik in front, so the socket peer
   is always the proxy.
4. **Upstream early exits.** `exchange()` in `src/auth/proxy/upstream.ts`
   throws on a redirect response without cancelling its body, and aborts the
   request's `AbortController` only at the 10-second deadline. A refused
   redirect, an oversized body or a body read error leaves the connection
   and its unread body to the garbage collector (BR-131 v1).

## Scope

- BR-137 v2: every binding of a code is checked before anything changes;
  only a request that would succeed consumes the code, and only a replay
  that matches every binding revokes the family.
- BR-133 v2: one JWKS fetch at a time, shared by every request that needs
  it; the 60-second throttle counts from a fetch's start; ID-token temporal
  validation reads the clock after asynchronous verification completes.
- BR-131 v2: the production upstream port cancels an unread body and aborts
  its request on every early exit without waiting for cancellation to settle.
- BR-421 (new): the proxy-only setting `httpTrustedProxies`
  (`MCP_HTTP_TRUSTED_PROXIES`), empty by default; BR-023 v4 adds its bounds
  and BR-024 v5 its proxy-only restriction.
- BR-422 (new): the peer of an OAuth request: the socket address, or the
  `X-Forwarded-For` client behind a listed proxy; IPv4 per address, IPv6
  per `/64`.
- BR-162 v3: each unauthenticated OAuth route gets a per-peer window and a
  global ceiling; the per-peer tables are bounded.
- BR-167 v3: a 429 from an OAuth window names which window refused; no peer
  address reaches a response or a log.
- The HTTP adapter passes `req.socket.remoteAddress` to the router
  (`HttpHandler.handle(request, target, remoteAddress?)`; tests that call
  `handle` without it get the peer `unknown`).
- BR-184 v3: `examples/compose.yaml` passes the optional
  `MCP_HTTP_TRUSTED_PROXIES`, empty by default, with a comment on exact
  proxy addresses or a dedicated proxy-only network (D-9).
- BR-186 v2: required installation-specific Compose values stay required;
  an optional value may have an empty default. The Compose header comment
  states this distinction (AC-21).
- `docs/oauth-proxy.md` (reverse-proxy requirements, limits and residual
  risks) and `docs/deployment.md` (step 4, exact proxy addresses or a
  dedicated proxy-only network without an address literal, BR-186 v2,
  and the Compose variable): each
  change marked as F-035 pending acceptance.

### Out of scope

- The MCP per-identity window (BR-161), the health windows (BR-325), the
  connection cap and timeouts (BR-169), and the metadata routes `prm` and
  `as_metadata`, which have no window.
- The `Forwarded` header (RFC 7239), `X-Real-IP`, other `X-Forwarded-*`
  headers and the PROXY protocol (D-4).
- Any other use of the peer: it binds no consent, cookie, code or CIMD
  fetch, and is never logged (BR-167 v3).
- Any other change to `examples/compose.yaml` beyond the optional setting
  and its comment, the header comment and loading checks (D-9, AC-21).
- A cap on failed attempts per code (D-1), and any change to consent or
  flow consumption (BR-129, BR-132), which stays one-use whatever the
  outcome.
- The CIMD fetch port (`client-metadata-fetch.ts`, BR-306 v2), which has its
  own pinned client and bounds; discovery sharing (BR-131 v1), unchanged.
- Persisting windows across restarts: windows stay in memory and a restart
  empties them, as in v2.

## Business rules

- **BR-137 v2** — v1 holds, except for the order of the checks, redirect
  URI compatibility and what a refused request changes. After BR-136, a token
  request with
  `grant_type=authorization_code` is decided in this order:
  (1) `code` absent or unknown: 400 `invalid_grant`;
  (2) the code's 60-second lifetime has ended (now ≥ creation + 60 s):
  400 `invalid_grant`;
  (3) the code is bound to another client, a present `redirect_uri` is not
  byte-identical to the authorization request's bound URI, an omitted
  `redirect_uri` fails the omission condition below, or `code_verifier` is
  not 43–128 unreserved characters whose S256 value equals the bound
  challenge:
  400 `invalid_grant`;
  (4) `resource` is present and differs from the bound one:
  400 `invalid_target`;
  (5) the code is consumed: its refresh family, when one was created from it
  and still exists, is revoked (deleted, committed before the response under
  BR-298 v2, one `refresh_family_revoked` event, BR-140 v2) and the answer is
  400 `invalid_grant`; with no such family, 400 `invalid_grant` and nothing
  else;
  (6) otherwise the code is marked consumed and the request succeeds as under
  v1.
  Steps (1)–(4) change nothing but the client's in-memory last use (as under
  v1): the code stays as it was (unconsumed or consumed), no family is
  revoked, no row is written and no event is logged.
  Step (6) marks the code consumed in the same synchronous step that starts
  its family and commits, before the first `await` of the request, so of two
  concurrent requests that both pass (1)–(4) one succeeds and the other is a
  step (5) replay. A consumed code is kept until its lifetime ends, as under
  v1; from then on step (2) answers it, whether or not the purge has removed
  it, and no replay revokes. Omission of `redirect_uri` is accepted only
  when the authorization request's URI was byte-identical to the client's
  single registered redirect URI in the client snapshot at authorization
  (the resolved document snapshot for CIMD); multiple registered URIs or
  a loopback port differing from the registered URI require an explicit
  exact match to the bound URI. An empty value is present, not omitted.
  Verified by: AC-01–AC-04.
- **BR-133 v2** — v1 holds, except for how JWKS fetches start and are
  shared, and when ID-token time checks read the clock. At most one JWKS
  fetch is in flight. A request needs a fetch when
  the cache is empty or its 3,600 s have ended (it is then discarded, as
  under v1), or when its ID token carries a `kid` that no cached usable key
  matches. When a fetch is needed and one is in flight, the request awaits
  that fetch, then uses the cache as that fetch left it and starts no fetch
  of its own, even if a `kid` still matches nothing. When a fetch is needed
  and none is in flight, a fetch starts only if no fetch started in the last
  60 s; otherwise the request uses the cache as it is, and an empty cache
  rejects the ID token. A fetch's start is the reading taken when the
  callback starts verification; the 60 s throttle and the 3,600 s lifetime
  of the key set it stores both count from it. A fetch that rejects, or
  answers other than 200,
  leaves the cache as it was, for the request that started it and for every
  request awaiting it. A request whose cache was empty and whose `kid` still
  matches nothing after the fetch it started or awaited starts no second
  fetch. A request whose cached keys match its token uses them at once, even
  while a fetch is in flight. For both the initiator and every waiter,
  `now` for the ID-token `exp` and `nbf` checks is a fresh clock reading
  after key retrieval and asynchronous signature verification complete,
  not the callback or fetch start time; `exp` must be strictly later than
  that reading, with no tolerance. Verified by: AC-05–AC-07.
- **BR-131 v2** — v1 holds, and the production upstream port
  (`createFetchUpstream`) initiates cleanup on every early exit. When an
  exchange rejects because `fetch` rejects, the response is a redirect (type
  `opaqueredirect` or status 300–399), the body exceeds 65,536 bytes, reading
  the body fails, or the 10-second deadline passes, then before the returned
  promise rejects it aborts the request's signal and initiates cancellation
  of any still-readable response body not read to its end, through its
  owning reader when locked and through the body otherwise. A closed or
  errored stream needs no cancellation callback; a missing body needs only
  the abort. Aborting is independent of cancellation settlement: the port
  never awaits cancellation, so a rejected or never-settling cancellation
  cannot delay rejection or extend the 10-second deadline. Synchronous
  cleanup throws and asynchronous cancellation rejections are handled and
  never replace the original failure. Stream termination, cancellation
  initiation and eventual transport closure are distinct; no source callback
  is required after abort has already closed or errored the stream. A URL
  other than `https` still rejects before any `fetch`. The rejection is
  otherwise as under v1 (discovery unusable, `server_error` at the code
  exchange, BR-132). A fulfilled exchange has read its body to its end and
  does not abort its signal. Verified by: AC-08, AC-09.
- **BR-421** — The F-002 setting `httpTrustedProxies` (environment
  `MCP_HTTP_TRUSTED_PROXIES`, comma-separated like the other list settings;
  option `--http-trusted-proxies`; YAML `httpTrustedProxies`) is an optional
  list, default empty, of at most 64 entries; an empty value
  (`MCP_HTTP_TRUSTED_PROXIES=`, YAML `[]`) is the empty list, as for
  BR-291. Each entry is an IPv4 address
  in dotted-decimal form without leading zeros, or an IPv6 address
  byte-identical to the WHATWG URL serialisation of itself (lowercase,
  compressed, no zone, no brackets, no dotted IPv4 part) and not inside
  `::ffff:0:0/96` (IPv4-mapped); either may be followed by `/` and a prefix
  length without a leading zero, 8–32 for IPv4 and 8–128 for IPv6, with no
  address bit set after the prefix. An entry without a prefix stands for
  `/32` (IPv4) or `/128` (IPv6). Any other entry is refused with
  `INVALID_VALUE`, and so is a list of more than 64 entries or with two
  entries naming the same prefix (for example `192.0.2.1` and
  `192.0.2.1/32`); overlapping prefixes of different lengths are accepted.
  The setting is accepted only with transport `http`, authentication on and
  OAuth mode `proxy` (the BR-290 restriction); set explicitly in any other
  configuration, the empty list included, it is refused with
  `CONFLICTING_SETTINGS`, as BR-291 is. It is read at startup only.
  Verified by: AC-10.
- **BR-422** — The peer of a request on an OAuth route is derived from the
  socket's remote address `S`, as Node reports it, and the BR-421 list `T`:
  (1) normalise `S`: drop its IPv6 zone index (`%…`), parse the full
  address, and convert IPv4-mapped IPv6 to IPv4, including hexadecimal
  mapped forms; an IPv4 address never matches an IPv6 entry of `T`, nor
  the reverse; compare full addresses against trusted prefixes, never
  addresses already grouped to `/64`;
  (2) when `T` is empty or `S` is not inside an entry of `T`, the peer
  address is `S`, and no forwarding header is read;
  (3) otherwise the `X-Forwarded-For` field lines are joined in order with
  commas and split on commas, each element is trimmed of spaces and tabs,
  and the elements are examined from the rightmost, at most 32 of them;
  first validate each raw trimmed element as an IPv4 address in
  dotted-decimal form without leading zeros or an IPv6 address without
  brackets, port or zone (uppercase and uncompressed IPv6 and dotted or
  hexadecimal IPv4-mapped forms are valid); an invalid or empty element
  ends the walk before normalisation, so a header zone is never stripped;
  then normalise each valid element to its full address, converting mapped
  IPv6 to IPv4, and compare it against `T`; the peer address is the first
  examined valid element outside `T`, which ends the walk; when none is
  found before an invalid element, the leftmost element or the 32nd, it is
  the leftmost valid element examined, or `S` if none was valid (no header,
  an empty one, or an invalid rightmost element);
  (4) only after the walk, group the final peer address: the peer is the
  IPv4 address itself, or the first 64 bits of an IPv6 address; two IPv6
  addresses whose first 64 bits are equal are the same peer; a socket
  without a remote address is the one peer `unknown`;
  (5) the `Forwarded`, `X-Real-IP` and other `X-Forwarded-*` headers are
  never read, and the peer serves only the BR-162 v3 windows.
  Verified by: AC-11–AC-13.
- **BR-162 v3** — v2 holds for the two health windows (BR-325) and for MCP
  requests, which have no OAuth window. Each unauthenticated OAuth route has
  a per-peer window and a global window:

  | Route       | Per peer | Global | Window length |
  | ----------- | -------- | ------ | ------------- |
  | `register`  | 30       | 60     | 3,600 s       |
  | `authorize` | 30       | 60     | 60 s          |
  | `consent`   | 30       | 60     | 60 s          |
  | `callback`  | 30       | 60     | 60 s          |
  | `token`     | 60       | 1,200  | 60 s          |

  The peer is the BR-422 peer. Each window keeps the v1 semantics: it opens
  at the first counted request while none is open for its key, lasts the
  window length, and is full when it holds its limit. A request on these
  routes is checked where v1 checks it, after the shutdown, target-length,
  `Host`, method, framing and `Origin` checks and before its body is read:
  when its peer's window for the route is full it is refused with `window`
  `peer`; otherwise, when the route's global window is full, it is refused
  with `window` `global`; otherwise it is counted once in each. A refusal is
  the HTTP-layer error 429 `rate_limited` with `Retry-After` in whole
  seconds, rounded up, until the full window ends, and no handler is called.
  A refused request is counted in no window and adds no per-peer entry. An
  admitted request counts whatever the handler then answers, an invalid
  request included. Per-peer entries live in memory only, one table per
  route; before an entry is added, every entry of that table whose window
  has ended is removed, so a table holds fewer than twice its global limit
  (at most 119 entries for `register`, `authorize`, `consent` and
  `callback`, 2,399 for `token`). Verified by: AC-13–AC-18.
- **BR-167 v3** — v2 holds, except that the `request_refused` event of a
  429 from a BR-162 v3 OAuth window also has the field `window`, `peer` or
  `global`; every other event keeps its v2 fields. No response, error,
  thrown message or logger call is built from the socket address, an
  `X-Forwarded-For` value or element, or a BR-422 peer. Verified by:
  AC-14, AC-15, AC-19.
- **BR-023 v4** (F-002) — adds the bounds of BR-421. Verified by: AC-10.
- **BR-024 v5** (F-002) — adds `httpTrustedProxies` to the proxy-only
  settings (BR-421). Verified by: AC-10.
- **BR-184 v3** (F-013) — v2 holds, and the service environment also has
  `MCP_HTTP_TRUSTED_PROXIES: ${MCP_HTTP_TRUSTED_PROXIES:-}`, the only
  variable of the file with a default, directly preceded by a comment line
  that names `MCP_HTTP_TRUSTED_PROXIES`, exact proxy addresses or a
  dedicated proxy-only network, and `docs/deployment.md`, and contains no
  IP address. The v1 loading check
  replaces this variable by its empty default, and the environment then
  loads with an empty `httpTrustedProxies`; with the value `192.0.2.0/24`
  it loads with that one entry. Verified by: AC-21.
- **BR-186 v2** (F-013) — v1 holds, except that required
  installation-specific Compose values are `${NAME:?…}` variables; an
  optional one may be `${NAME:-}` with an empty default. The header comment
  of `examples/compose.yaml` states this distinction and still states that
  credentials are file secrets only. Verified by: AC-20, AC-21.

Existing rules this feature relies on without change:

- **BR-136 v2**: client authentication runs before BR-137 v2 and never
  touches the code.
- **BR-140 v2**, **BR-298 v2**, **BR-299 v2**: the family revocation of
  BR-137 v2 step (5) is the one they define, committed before its
  `invalid_grant`; a failed commit answers 503.
- **BR-142 v3**: the stores and their 1,000-entry bounds that the global
  windows protect (D-5).
- **BR-325**, **BR-161 v1**: the health and MCP windows are unchanged.
- **BR-306 v2**, **F-028 D-5**: CIMD refetches remain bounded by the
  authorize window, now 60 per 60 s globally (30 per peer), and by four
  concurrent fetches; there is still no failure cache.
- **BR-411**, **F-032 D-8**: consent replay records live for 10 s; the
  consent window now permits up to 120 across a window boundary, still
  below the 1,000-record cap. Eviction remains a direct-caller backstop.
- **BR-186 v1 privacy clauses**, retained by v2: `docs/deployment.md` keeps
  `0.0.0.0` and `127.0.0.1` as its only IP addresses.

## Acceptance criteria

Proxy tests use the fake clock, upstream port and logger of
`tests/helpers/proxy.ts`; HTTP tests use the router fixture of
`tests/http/rate-limits.test.ts`, which passes a remote address to
`handle`; addresses come from the documentation ranges (`192.0.2.0/24`,
`198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`) and loopback.

- **AC-01** (BR-137 v2) — Given a fresh code issued to client A, When it is
  presented with client B's credentials, a mismatching `redirect_uri`
  (including an altered loopback port or an empty value), a wrong verifier,
  a 42-character verifier, a 129-character verifier, a verifier with `+`,
  or another `resource`, Then each gets 400 `invalid_grant`
  (`invalid_target` for the resource), no event is logged, and a following
  correct redemption by A gets 200 with a refresh token. Given fresh codes
  with every other binding matching, When `redirect_uri` is omitted and
  the authorization URI equals the single registered URI, Then 200; When
  omitted with multiple registered URIs or with a loopback port different
  from the single registered URI, Then 400 `invalid_grant`, no event, and
  a following explicit matching redemption gets 200; When present and
  byte-identical to the bound URI, Then 200 in each registration case.
  Run these rows for registered and CIMD clients using their authorization
  snapshots. Given codes whose challenges come from a 43-character and a
  128-character verifier, Then each correct redemption gets 200.
  Verified by: `BR-137 v2 AC-01 refuses %s without consuming the code`,
  `BR-137 v2 AC-01 redirect URI %s follows the compatibility profile` and
  `BR-137 v2 AC-01 accepts a %i-character verifier` in
  `tests/auth/proxy-token.test.ts`.
- **AC-02** (BR-137 v2, BR-298 v2) — Given a code redeemed by A (family F)
  and a state file, When the code is presented again with each mismatch of
  AC-01, Then each gets the same error, no `refresh_family_revoked` is
  logged, no transaction is committed, and F's refresh token still gets 200;
  When it is then presented with every binding matching, Then 400
  `invalid_grant`, one `refresh_family_revoked`, one committed
  `deleteFamily`, and F's latest refresh token gets 400 `invalid_grant`.
  Given a client without the refresh grant, Then a matching replay gets 400
  `invalid_grant` with no event and no commit. Verified by:
  `BR-137 v2 AC-02 only a replay matching every binding revokes the family`
  in `tests/auth/proxy-token.test.ts` and `BR-298 BR-137 v2 AC-02 a refused
  replay commits nothing` in `tests/auth/proxy-persistence.test.ts`.
- **AC-03** (BR-137 v2) — Given a code created at `T`, Then a correct
  redemption at `T + 60` s − 1 ms gets 200, and for another code a correct
  redemption at `T + 60` s gets 400 `invalid_grant` and nothing else; Given
  a code created at `T` and redeemed at `T + 1` s (family F), Then a
  matching replay at `T + 60` s − 1 ms revokes F, and for another such code
  a matching replay at `T + 60` s gets 400 `invalid_grant` with no event and
  F still refreshes. Verified by: `BR-137 v2 AC-03 the 60-second lifetime
  bounds redemption and replay revocation` in
  `tests/auth/proxy-token.test.ts`.
- **AC-04** (BR-137 v2) — Given a fresh code, When two correct redemptions
  run concurrently, Then one gets 200 and the other 400 `invalid_grant`
  with one `refresh_family_revoked`; When a wrong-verifier request and a
  correct one run concurrently, in either order, Then they get 400 and 200
  and no event is logged. Verified by: `BR-137 v2 AC-04 concurrent
  redemptions consume and revoke only on matching requests` in
  `tests/auth/proxy-token.test.ts`.
- **AC-05** (BR-133 v2) — Given an empty JWKS cache and an upstream whose
  JWKS reply is held, When two and then three callbacks whose ID tokens
  carry the served `kid` arrive before the reply is released, Then every
  callback redirects with a `code`, and the upstream receives exactly one
  JWKS request. Verified by: `BR-133 v2 AC-05 concurrent callbacks on a
  cold cache share one JWKS fetch` in `tests/auth/proxy-id-token.test.ts`.
  Given an initiator and a waiter whose tokens expire at `T + 1` s, When
  the shared fetch started at `T` is released at `T + 5` s, Then both
  redirect with `server_error`, neither creates a code, and exactly one
  fetch occurred; fresh fixtures released at `T + 1` s − 1 ms succeed,
  and at `T + 1` s reject. Given a valid cached key and a verification
  promise held past `exp`, Then releasing verification rejects as well.
  Verified by: `BR-133 v2 AC-05 shared fetch checks expiry at completion`
  and `BR-133 v2 AC-05 signature verification checks expiry at completion`
  in `tests/auth/proxy-id-token.test.ts`.
- **AC-06** (BR-133 v2) — Given keys fetched at `T` and an upstream that
  now also serves a rotated key, When at `T + 61` s two callbacks whose
  tokens carry the rotated `kid` arrive while the refetch is held, Then
  both redirect with a `code` after one JWKS request; When a third such
  callback arrives after the refetch settled, Then it redirects with a
  `code` without a request; and When at `T + 61` s a callback with the
  original `kid` arrives while the refetch is held, Then it redirects with
  a `code` before the refetch is released. Verified by: `BR-133 v2 AC-06
  concurrent callbacks with a rotated kid share one refetch` in
  `tests/auth/proxy-id-token.test.ts`.
- **AC-07** (BR-133 v2) — Given an empty cache, When a JWKS fetch started
  at `T` is held and then fails while two callbacks await it, Then both are
  rejected (`server_error` redirect) after one request; When a callback
  arrives at `T + 60` s − 1 ms, Then it is rejected with no request; When
  one arrives at `T + 60` s, Then exactly one request is made and, the
  upstream answering, it redirects with a `code`. Given a fetch started at
  `T` and released at `T + 5` s, Then a callback at `T + 3,600` s − 1 ms uses
  the cache without a request and one at `T + 3,600` s makes one. Verified
  by: `BR-133 v2 AC-07 a shared fetch fails for every waiter and both
  bounds count from its start` in `tests/auth/proxy-id-token.test.ts`.
- **AC-08** (BR-131 v2) — Given the production port over a fake `fetch`
  whose response body is a `ReadableStream` kept readable independently of
  the abort signal, with a recording source `cancel` callback, When
  `fetchJson` and `postForm` each receive a 301, 302, 303, 307 or 308
  response with that body, Then each rejects as a refused redirect, with
  one source `cancel` call and an aborted signal before rejection is
  observed. The `opaqueredirect` row uses a duck-typed response object
  holding that readable body; a native opaque redirect has no body, and
  its separate bodyless row requires only the abort. Verified by:
  `BR-131 v2 AC-08 a refused redirect cancels its body and aborts its request`
  and `BR-131 v2 AC-08 a bodyless opaque redirect aborts its request` in
  `tests/auth/proxy-upstream.test.ts`.
- **AC-09** (BR-131 v2) — Given the same port, When the body ends after
  65,536 bytes, Then the exchange fulfils, the signal is not aborted and
  the source's `cancel` is not called; When it emits 65,537 bytes and stays
  readable independently of abort, Then the exchange rejects, the signal
  is aborted and the owning reader initiates cancellation once (the body
  is locked). Given a source that enqueues 65,537 bytes and closes before
  the size check, Then the same rejection and abort occur without a source
  `cancel` callback. When a stream errors after 10 bytes or `fetch` itself
  rejects, Then the exchange rejects and aborts without a required source
  callback. When the headers arrive and a readable body stalls, Then the
  exchange is pending at 9,999 ms and rejects at 10,000 ms, with abort and
  one cancellation initiation. With that fixture and with the oversize
  fixture, When source cancellation throws, returns a rejected promise or
  never settles, Then the original rejection is preserved, abort occurs
  independently, rejection never waits for cancellation, and no unhandled
  rejection occurs. With an abort-aware source that errors on abort, Then
  rejection and abort still occur, with no required source callback.
  Verified by: `BR-131 v2 AC-09 every other early exit aborts its request
  and releases the body`, `BR-131 v2 AC-09 a closed oversized stream needs
  no cancel callback`, `BR-131 v2 AC-09 cancellation %s cannot delay or
  replace the failure` and `BR-131 v2 AC-09 abort-aware streams need no
  cancel callback` in `tests/auth/proxy-upstream.test.ts`.
  Given real `fetch` against a local HTTPS test double with a synthetic
  trusted certificate, When the double sends a redirect with an unended
  body, an oversized unended body, or a body stalled past the deadline,
  Then rejection occurs without waiting for the double to end the body,
  the double observes connection closure within 1 s after rejection, and
  the test exits without open handles; use a 15 s outer test deadline and
  no external host. Verified by: `BR-131 v2 AC-09 real fetch closes refused
  transports` in `tests/auth/proxy-upstream-transport.test.ts`.
- **AC-10** (BR-421, BR-023 v4, BR-024 v5) — Given each source
  (environment, option, YAML), When the list holds `127.0.0.1`,
  `192.0.2.0/24`, `10.0.0.0/8`, `198.51.100.7/32`, `2001:db8::1`,
  `2001:db8::/32`, `fd00::/8` and `2001:db8::/128`, or 64 valid entries,
  Then it loads; When `MCP_HTTP_TRUSTED_PROXIES` is set to the empty value
  or YAML `httpTrustedProxies` is `[]`, Then it loads as the empty list, as
  when the setting is absent; When it holds 65 entries, `192.0.2.1` with
  `192.0.2.1/32`, `10.0.0.0/7`, `fc00::/7`, `fd00::/7`, `0.0.0.0/0`, `::/0`,
  `192.0.2.0/33`,
  `2001:db8::/129`, `10.0.0.1/8`, `2001:db8::1/32`, `192.0.2.0/024`,
  `010.0.0.1`, `192.0.2`, `2001:DB8::1`, `2001:db8:0:0:0:0:0:1`,
  `[2001:db8::1]`, `fe80::1%eth0`, `::ffff:192.0.2.1`, `::ffff:c000:201`,
  `192.0.2.1:80`, `proxy.example.com` or an empty entry (`127.0.0.1,`),
  Then `INVALID_VALUE`; Given stdio, `--insecure-no-auth`, or `delegate`
  mode, When the list holds `127.0.0.1`, or is set to the empty value or
  `[]`, Then `CONFLICTING_SETTINGS`. Verified by: `BR-421 BR-023 v4 AC-10
  accepts %s` and `BR-421 BR-023 v4 AC-10 refuses %s as INVALID_VALUE` in
  `tests/config-value-boundaries.test.ts`, and `BR-421 AC-10 loads the
  list from environment, option and YAML`, `BR-421 AC-10 an empty value is
  the empty list` and `BR-421 BR-024 v5 AC-10 refuses the list with %s as
  CONFLICTING_SETTINGS` in `tests/config.test.ts`.
- **AC-11** (BR-422) — Given an empty list, Then the peers of sockets
  `192.0.2.7` and `::ffff:192.0.2.7` are equal; `2001:db8:1:2::1`,
  `2001:db8:1:2:ffff:ffff:ffff:ffff` and `2001:db8:1:2::5%eth0` are one
  peer; `2001:db8:1:3::1` is another; `192.0.2.8` is another; and an
  undefined socket address is `unknown`. Verified by: `BR-422 AC-11 peers
  are IPv4 addresses and IPv6 /64 prefixes` in `tests/http/peer.test.ts`.
- **AC-12** (BR-422) — Given socket `127.0.0.1`: with an empty list and
  `X-Forwarded-For: 203.0.113.9`, Then the peer is `127.0.0.1`; with list
  `127.0.0.1`, Then for `198.51.100.1, 203.0.113.9` it is `203.0.113.9`;
  with list `127.0.0.1,203.0.113.0/24`, `198.51.100.1`; for the two field
  lines `198.51.100.1` and `203.0.113.9`, `203.0.113.9`; for no header, an
  empty header, `junk`, `203.0.113.9:443` or `[2001:db8::9]`, `127.0.0.1`;
  for `198.51.100.1, junk, 127.0.0.2` with list `127.0.0.0/8`, `127.0.0.2`;
  with list `127.0.0.0/8`, for `198.51.100.1` followed by 31 elements
  `127.0.0.3` (the client is element 32, examined), `198.51.100.1`, and for
  `198.51.100.1` followed by 32 such elements (the client is element 33,
  never examined), `127.0.0.3`;
  for `::ffff:203.0.113.9`, the peer of `203.0.113.9`; and Given socket
  `192.0.2.50` not in the list, Then `X-Forwarded-For` is ignored.
  Verified by: `BR-422 AC-12 the X-Forwarded-For walk trusts only listed
  proxies` in `tests/http/peer.test.ts`.
  Additional rows below give `T`; `S`; header; expected peer (IPv6 results
  mean the peer of that address after final `/64` grouping):
  - `127.0.0.1`; `::ffff:127.0.0.1`; `203.0.113.9`; `203.0.113.9`.
  - `2001:db8:a::/48`; `2001:db8:a::1`;
    `2001:db8:b::9, 2001:db8:a:ffff::2`; peer of `2001:db8:b::9`.
  - `2001:db8::/33`; `2001:db8:7fff::1`; `203.0.113.9`; `203.0.113.9`.
  - `2001:db8::/33`; `2001:db8:8000::1`; `203.0.113.9`;
    peer of `2001:db8:8000::1` (header ignored).
  - `10.128.0.0/9`; `10.128.0.1`; `203.0.113.9`; `203.0.113.9`.
  - `10.128.0.0/9`; `10.127.255.255`; `203.0.113.9`;
    `10.127.255.255` (header ignored).
  - `::/8`; `::ffff:192.0.2.7`; `203.0.113.9`; `192.0.2.7`
    (IPv4 never matches IPv6 trust entries).
  - `127.0.0.1,203.0.113.0/24`; `127.0.0.1`;
    `198.51.100.1, ::ffff:cb00:7109`; `198.51.100.1` (mapped hop skipped).
  - `127.0.0.1`; `127.0.0.1`; `::ffff:cb00:7109`; `203.0.113.9`.
  - `127.0.0.1`; `127.0.0.1`; `2001:DB8::9` and, separately,
    `2001:0DB8:0000:0000:0000:0000:0000:0009`; peer of `2001:db8::9`
    (both valid, with identical peers).
  - `127.0.0.1`; `127.0.0.1`; `fe80::1%eth0`; `127.0.0.1`
    (zone invalid before normalisation).
  - `2001:db8::9/128`; `2001:0DB8:0:0:0:0:0:9`; `203.0.113.9`;
    `203.0.113.9` (full normalised address trusted).
  - `2001:db8::9/128`; `2001:db8::a`; `203.0.113.9`;
    peer of `2001:db8::a` (same `/64`, untrusted neighbour).
  - `127.0.0.1,2001:db8::9/128`; `127.0.0.1`;
    `198.51.100.1, 2001:0DB8:0:0:0:0:0:9`; `198.51.100.1`.
  - `127.0.0.1,2001:db8::9/128`; `127.0.0.1`;
    `198.51.100.1, 2001:db8::a`; peer of `2001:db8::a`.
  Verified by: `BR-422 AC-12 address boundary %s` in
  `tests/http/peer.test.ts`, one named table row per case.
- **AC-13** (BR-422, BR-162 v3) — Given the real server listening on
  `127.0.0.1` with list `127.0.0.1`, When 30 authorize requests carry
  `X-Forwarded-For: 198.51.100.1`, Then the 31st with that header gets 429
  and one with `203.0.113.9` does not; Given the same server with an empty
  list, Then after 30 requests with `198.51.100.1` a request with
  `203.0.113.9` gets 429 (`window` `peer`). Verified by: `BR-422 BR-162 v3
  AC-13 the adapter passes the socket address` in
  `tests/http/peer-admission.test.ts`.
- **AC-14** (BR-162 v3, BR-167 v3) — For each route of the table, Given
  peer P, Then its limit of requests passes and the next gets 429
  `rate_limited` with `Retry-After` and one `request_refused` with `route`,
  429, `rate_limited` and `window` `peer`, and the handler is not called;
  a request from peer Q at the same instant passes; P is still refused one
  millisecond before its window ends and passes when it ends. Verified by:
  `BR-162 v3 AC-14 limits %s to %i per peer per %i seconds` in
  `tests/http/rate-limits.test.ts`.
- **AC-15** (BR-162 v3, BR-167 v3) — For each route, Given its global limit
  of requests from distinct peers in one window, Then the next request from
  a new peer gets 429 with `Retry-After` until the global window ends and
  `window` `global`, and a request from a peer already counted gets the same;
  the refused new peer has no entry, and when the global window ends it
  passes as a first request. Verified by: `BR-162 v3 AC-15 the global
  ceiling of %s is %i per %i seconds` in `tests/http/rate-limits.test.ts`.
- **AC-16** (BR-162 v3) — Given peer P sending 60 token requests with an
  unknown client and then a valid refresh, Then the valid one gets 429
  `window` `peer`, while a valid refresh from peer Q gets 200; Given P
  sending 30 registrations with an invalid body, Then a valid registration
  from Q gets 201. Verified by: `BR-162 v3 AC-16 invalid requests lock out
  only their own peer` in `tests/http/rate-limits.test.ts`.
  Given a fresh fixture with distinct clients sharing one hosted egress
  peer, When 60 valid refreshes arrive within one minute, Then all get
  200; the 61st valid refresh gets 429 `peer` despite global capacity,
  and a valid refresh from a different peer gets 200. Verified by:
  `BR-162 v3 AC-16 shared egress admits only 60 token requests per minute`
  in `tests/http/rate-limits.test.ts`.
  Given a fresh fixture using the real SQLite state store, ES256 signer,
  synthetic keys, 20 peers and one family per peer, When each peer sends
  60 sequential valid refreshes in the same fake-clock minute, Then 1,200
  requests succeed, each commits a rotation and returns a verifiable ES256
  access token, the persisted latest refresh tokens survive reopening,
  and a 1,201st request from a fresh peer gets 429 `global` without a write
  or signature. Record elapsed time as evidence, not a throughput promise.
  Verified by: `BR-162 v3 AC-16 persisted refresh workload respects the
  global ceiling` in `tests/http/peer-admission.test.ts`.
- **AC-17** (BR-162 v3) — Given the authorize table, When one peer is
  admitted at `T`, 59 others at `T + 60` s − 1 ms and 60 others at
  `T + 60` s, Then the table holds 119 entries (the first one removed); When
  a new peer arrives at `T + 120` s − 1 ms, Then it is refused (`global`) and
  the table still holds 119; When one arrives at `T + 120` s, Then it is
  admitted and the table holds 1; and for `token`, with 1, 1,199 and 1,200
  peers at the same instants, the table holds 2,399. Verified by:
  `BR-162 v3 AC-17 a peer table holds fewer than twice its global limit`
  in `tests/http/rate-limits.test.ts` (through the limiter's entry count).
- **AC-18** (BR-162 v3) — Given a full window for peer P, Then requests
  refused with 403 `invalid_host`, 405, 413 by framing, 403 `invalid_origin`
  and 429 are counted in neither P's nor the global window; Given a full
  global window, Then a request refused by it does not count for its peer;
  and Given 30 MCP requests and 120 health requests, Then no OAuth window
  changes (through the limiter's counts). Verified by: `BR-162 v3 AC-18
  refused and non-OAuth requests count in no OAuth window` in
  `tests/http/rate-limits.test.ts`.
- **AC-19** (BR-167 v3, BR-422) — Given a capturing logger, list
  `192.0.2.66`, socket `192.0.2.66` and sentinel header
  `198.51.100.77, 203.0.113.88`, Then its peer is `203.0.113.88`.
  For every OAuth route use separate fresh fixtures for admission, peer
  refusal and global refusal. For peer refusal, admit that peer's limit
  then send the sentinel request, expecting 429 `window` `peer`. For
  global refusal, prefill the global window from distinct normalised peers
  other than the sentinel, each below its own limit; send the sentinel
  from its still-unused peer, expecting 429 `window` `global`. For each
  admitted or refused sentinel request, Then no response header or body or
  logged field contains any of the three sentinel addresses, and every
  `request_refused` of a 429 has exactly `route`, `status`, `error` and
  `window`. Verified by: `BR-167 v3 AC-19 no peer address reaches a
  response or an event` in `tests/http/secrecy.test.ts`.
- **AC-20** (BR-421, BR-162 v3, BR-186 v2) — Given `docs/oauth-proxy.md`
  and `docs/deployment.md`, Then both name `MCP_HTTP_TRUSTED_PROXIES`,
  recommend exact proxy addresses or a dedicated access-controlled
  proxy-only network, require every trusted hop to append the observed
  upstream address, and warn that trusting a whole shared network trusts
  every container on it. Both include an adversarial direct-connection
  example: an untrusted container on a listed shared network sends a
  victim's address in `X-Forwarded-For` and thereby selects the victim's
  peer; exact proxy addresses or an isolated proxy-only network prevent
  that trust mistake. `docs/deployment.md` uses symbolic addresses in the
  example, keeping BR-186's IP privacy clauses. Both document that a
  residential `/56` or `/48` supplies 256 or 65,536 `/64` peers, so one
  home line can cross the two-peer or twenty-peer global barriers. Given
  `docs/oauth-proxy.md`, Then it also states the per-peer and global table
  limits, IPv6 `/64` grouping and the 60-token-requests-per-minute limit
  shared by a hosted client egress even with spare global capacity, and
  replaces the claim that all `X-Forwarded-*` headers are ignored with the
  precise BR-422 policy. Verify the stated guidance and adversarial example
  in both files, not merely the presence of keywords. Verified by:
  `BR-421 BR-162 v3 AC-20 the operator documentation describes peer admission`
  and `BR-186 v2 AC-20 deployment guidance keeps address privacy` in
  `tests/docs/oauth-admission-docs.test.ts`.
- **AC-21** (BR-184 v3, BR-186 v2) — Given `examples/compose.yaml`, Then
  its service environment maps `MCP_HTTP_TRUSTED_PROXIES` to
  `${MCP_HTTP_TRUSTED_PROXIES:-}`, directly preceded by a comment naming
  the setting, exact proxy addresses or a dedicated proxy-only network,
  and `docs/deployment.md`; no other value has a default. The header
  comment states that required installation-specific values use
  `${NAME:?…}`, optional values may use `${NAME:-}` with an empty default,
  and credentials are file secrets only. The BR-186 hygiene check passes;
  a required value replaced by an optional default or an optional default
  made nonempty fails it. When the environment loads with the trusted-proxy
  variable replaced by its empty default, Then `httpTrustedProxies` is
  `[]`; with `192.0.2.0/24`, Then it is `["192.0.2.0/24"]`. A copy without
  the setting comment, with the old all-values-required header claim, or
  with `${MCP_HTTP_TRUSTED_PROXIES:?…}` is rejected. Verified by:
  `BR-184 v3 AC-21 the Compose example passes an optional empty
  trusted-proxy list` and `BR-186 v2 AC-21 required and optional variables
  match the Compose header` in `tests/deployment-examples.test.ts`.

The v2 tests `BR-162 AC-11 ...` and `BR-325 BR-162 v2 ...` keep passing
unchanged: without a remote address every request is the peer `unknown`,
whose limits equal the v1 limits. The v1 test `BR-137 refuses %s and
consumes the code` is replaced by AC-01's test (BR-137 v2). The v1 test
`BR-184 Compose environment loads as HTTP proxy configuration` keeps its
assertions; its substitution also replaces `${NAME:-}` by its empty default
(BR-184 v3).

## Decisions

- **D-1 — Validate first, consume and revoke only on a matching request.**
  A code is decided by its bindings before anything changes, so only its
  legitimate client, holding the verifier, can consume it or trigger the
  replay revocation. This reverses F-010 D-8 for codes only. D-8 feared
  online guessing against a known code: the only secret left to guess is
  the verifier, of at least 43 unreserved characters (RFC 7636 §7.1 requires
  enough entropy), within the code's 60 s and under the per-peer token
  window of 60 a minute, so guessing gains nothing. The lifetime check runs
  before the replay check, so whether a replay revokes no longer depends on
  when the purge runs. Rejected: v1 (anyone holding a leaked code burns it
  or revokes the family); a cap on failed attempts per code (the attacker
  burns the code by reaching the cap); revoking on any replay (lets an
  invalid request revoke, which is defect 1); a new event for a live-code
  binding mismatch (no new event is needed for the fix; it would add a
  high-volume signal under attack). Such mismatches log nothing.
  The token endpoint accepts omitted `redirect_uri` only for an exact
  single registered URI at authorization. Accepting omission deliberately
  departs from RFC 6749 §4.1.3, which requires `redirect_uri` to be present
  and identical when the authorization request included it, following
  OAuth 2.1 §10.2, which drops the token parameter. In this compatibility
  profile:
  supplied values keep the 2.0 exact-match check, while omission is safe
  with a single possible registered destination and valid client/PKCE
  bindings. Multiple destinations and variable loopback ports still need
  the explicit URI. Rejected: requiring it always (breaks 2.1 clients);
  allowing omission for every code (broader compatibility than the chosen
  unambiguous-destination rule).
- **D-2 — One shared JWKS fetch, throttled from its start.** The pattern
  is discovery's: an in-flight promise that every concurrent request
  awaits. Waiters start no fetch of their own, so a burst of tokens with a
  bogus `kid` still costs at most one fetch per 60 s. Rejected: setting
  `lastJwksFetch` after the reply (every concurrent request would fetch); a
  second fetch for a waiter whose `kid` is still unmatched (a refetch per
  bogus token). BR-133 already governs ID-token expiry, so its pending v2
  also fixes the existing stale-clock bug: both initiator and waiter read
  the clock after asynchronous verification, separately from fetch timing.
- **D-3 — Abort and cancel on every early exit.** An unread body holds its
  connection until the peer or the collector closes it; aborting the
  signal starts transport teardown independently of stream cancellation.
  Cancellation goes through the owning reader when locked and is never
  awaited; neither a cleanup failure nor stalled cancellation replaces or
  delays the original error. Closed and errored streams need no source
  callback. AC-09 checks actual transport closure with a local test double.
  Rejected: relying on garbage collection (sockets held for an unbounded
  time); awaiting cancellation (an untrusted source can stall indefinitely).
- **D-4 — Peer from the socket, `X-Forwarded-For` only behind a listed
  proxy.** By default no header is trusted, so a direct client cannot pick
  its peer. Behind a listed proxy, the walk from the right skips the
  listed hops and stops at the first unlisted address, which the last
  listed proxy observed itself; elements further left are client-supplied
  and never reached. An invalid element ends the walk at the nearest
  listed hop, so a malformed header can only put requests in a proxy's
  peer. 32 elements bound the walk inside Node's 16 KiB header limit. IPv4
  is per address; IPv6 is per `/64`, the usual assignment to one host or
  subnet, since per-address peers would give the holder of one `/64` 2^64
  peers. Prefixes shorter than `/8` are refused so that "trust everything"
  cannot be configured by accident. The list holds up to 64 entries so
  that the published ranges of a CDN in front of the server fit (one such
  provider lists more than 16). This reverses F-012 D-8 ("no forwarded
  headers in process") for `X-Forwarded-For` behind a listed proxy, and
  F-012 D-7's rejection of per-IP limits in process, which held only while
  no trustworthy client address existed behind the proxy. Rejected: always
  trusting `X-Forwarded-For` (any client chooses its peer); the leftmost
  element (client-supplied); the `Forwarded` header (Traefik and most
  proxies send `X-Forwarded-For` by default; a second parser doubles the
  surface); per-address IPv6; `/56` or `/48` grouping (joins unrelated
  customers of hosting providers that assign one `/64` per machine);
  host-name entries (DNS at startup, rebinding); a cap of 16 entries (too
  few for a CDN's published ranges).
- **D-5 — Per-peer limits equal to the v1 limits; global ceilings above
  them; invalid requests count in both.** With an empty list behind one
  reverse proxy every request has the same peer, so the server behaves
  exactly as under v2, never stricter. With a listed proxy, a single
  abusive peer consumes only its own per-peer allowance; clients sharing
  that peer share the lockout, and global ceilings remain shared. The global
  ceilings keep the stores of BR-142 v3 below their bounds, updating
  F-012 D-7's arithmetic: at most 11 fixed windows of 60 intersect a 600 s
  lifetime, so at most 660 live entries, below each store's 1,000. For
  example, one at `T`, 59 just before `T + 60` s and 60
  at each boundary through `T + 600` s leave 659 live entries when the
  first expires. Thus the former 600 bound was too low. At 60 registrations
  per hourly window, cycling 1,000 clients takes at least 16 hours from
  an empty window (about 16.7 hours at a steady rate). The token route
  creates no entry beyond the families of codes, which the callback ceiling
  bounds, so its
  ceiling is 1,200 a minute (D-10). An admitted refresh authenticates the
  client, scans family/client state, rotates persisted state and signs an
  ES256 access token; it is not merely one hash. This is a request ceiling,
  not verified persisted-refresh throughput; AC-16 records a representative
  workload with the real store and signer. Counting before
  the body is read keeps v1's protection of the body reader; counting by
  outcome would need the body first. The table bound follows from removing
  ended windows before each insertion, so no eviction exists that an
  attacker could use to reset its own count. Rejected: per-peer windows
  only (many peers fill the consent store and BR-142 then refuses everyone);
  per-peer limits below v1 (stricter than v2 for an unconfigured
  deployment, where all clients share one peer); a fixed-size table with
  least-recently-used eviction (eviction resets an evicted peer's count);
  sliding windows or token buckets (new semantics, no gain at these
  rates); counting only failed requests per peer (a valid flood would
  still exhaust the global ceiling, and the outcome is known only after the
  body).
- **D-6 — The refusal names its window, never its peer.** `window` lets the
  operator tell one abusive client (`peer`) from a distributed load
  (`global`) without logging an address, which BR-167 and the public-content
  rule treat as identifying data. Rejected: no field (both cases look
  alike); logging the peer or a hash of it (personal data; a hash of an IPv4
  address is reversible by enumeration).
- **D-7 — Residual risks**, listed in `docs/oauth-proxy.md`: an attacker
  with two or more peers (two IPv6 `/64`s, for example) can still hold a
  global window full, which locks the route for everyone as under v2 but at
  twice the rate (twenty times for `token`, 20 peers at their per-peer
  limit). One residential IPv6 subscriber usually has a `/56` or `/48`,
  giving 256 or 65,536 `/64` peers: these peer-count barriers can be crossed
  from one home line, not necessarily a distributed attack. Clients whose
  token and registration requests come from a shared hosted-service egress
  share one peer; it gets only 60 token requests per minute, so its 61st
  legitimate refresh fails even with spare global capacity, and another
  user of the service can fill it; with an empty list behind a reverse proxy,
  v2's shared lockout remains; every trusted hop must append the upstream
  address it observed
  as the last `X-Forwarded-For` element, or clients can choose their peer.
  A wrong list (an address that is not a proxy, or a proxy that forwards
  client-supplied elements) lets an attacker name a victim's address as
  its peer and lock that peer out with 30 requests (60 on `token`), and so
  does a listed range that also contains clients, whose own elements are
  then skipped as trusted hops. Listing a whole shared container network
  trusts every container on it, including direct connections from non-proxy
  containers; use exact proxy addresses or a dedicated proxy-only network.
  The doubled `register` ceiling roughly halves the
  time an attacker needs to evict an idle client from the 1,000-client
  store, and its refresh families with it: at least 16 hours from an empty
  window instead of 33 under v2 (about 16.7 versus 33.3 hours at a steady
  rate).
- **D-8 — No ADR.** The setting is additive and empty by default, the
  windows live in memory, nothing is persisted and the choice is reversed
  by a new version of BR-162 and BR-422.
- **D-9 — The Compose example offers the setting, empty by default
  (owner decision Q-1 (c), 2026-11-15).** Per-peer admission behind Traefik
  requires listing its exact proxy address(es), or a dedicated,
  access-controlled proxy-only network. Never recommend trusting a shared
  network merely because Traefik belongs to it: every container on that
  network would be trusted. Every listed hop must append the upstream
  address it observed. AC-20 requires both operator documents to explain
  this and show a direct connection from an untrusted container forging a
  victim's forwarded address under an overbroad list. The Compose example
  passes `${MCP_HTTP_TRUSTED_PROXIES:-}`: unset, the server gets an empty
  list, so existing deployments retain shared windows. Its comment points
  to `docs/deployment.md` and contains no address literal. BR-186 v2 makes
  the required/optional distinction explicit, and AC-21 updates the header
  comment to match it. Rejected: documentation only (a copied example
  hides the setting); a required `${MCP_HTTP_TRUSTED_PROXIES:?…}` (existing
  deployments fail until configured); trusting a shared Traefik network
  (unrelated containers can forge peers).
- **D-10 — Global ceilings (owner decision Q-2, 2026-11-15).** The global
  ceilings of `register`, `authorize`, `consent` and `callback` are twice
  their v2 limits, which the store arithmetic of D-5 allows; `token` gets
  1,200 a minute (table bound 2,399), with 60 per peer. At 300 a minute,
  five IPv6 `/64`s at their per-peer limit would block every refresh;
  1,200 needs 20 peers, still available to one residential IPv6 subscriber
  (D-7); a hosted shared egress remains limited to 60 a minute. Rejected:
  global ceilings equal to v2 with per-peer limits at half of them (stricter
  than v2 for an unconfigured deployment, where every client shares one
  peer); 300 for `token` (five
  peers close it).

## Open questions

None. Q-1 (Compose example) and Q-2 (global ceilings) were answered by the
owner on 2026-11-15 and are recorded as D-9 and D-10.

## Stress-test

Spec review 1 (`46-spec-review-1-reviewer`, approve with minors; owner
decisions Q-1 (c), Q-2):

- **Minor 1 — retained.** An errored stream never calls its source's
  `cancel`, and `cancel()` on a locked body rejects. BR-131 v2 now requires
  only the abort for a body whose stream has errored; AC-08 and AC-09
  observe the `cancel` callback of the fake body's underlying source, and
  AC-09's stream-error and `fetch`-rejection rows require only the aborted
  signal.
- **Minor 2 — retained.** BR-421 states that an empty value
  (`MCP_HTTP_TRUSTED_PROXIES=`, YAML `[]`) is the empty list, as for
  BR-291 (`asList()` already maps `""` to `[]` for list settings), and that
  any explicit value outside proxy mode, the empty list included, is
  `CONFLICTING_SETTINGS`, as the other proxy-only settings (BR-290,
  BR-291) are refused whenever set. AC-10 has rows for both. The premise
  of the former Q-1 (c) is corrected in D-9.
- **Minor 3 — retained.** AC-12 tests the boundary: 31 trusted elements
  (the client is element 32 and is the peer) and 32 (the client is element
  33 and is never examined). The BR-422 record's example follows.
- **Minor 4 — retained.** AC-10 adds `fc00::/7`, which breaks only the
  length rule (`fd00::/7` stays as a row that breaks two). AC-01 adds a
  refused 129-character verifier and accepted 43- and 128-character
  verifiers.
- **Minor 5 — retained.** Every AC names its exact tests and their files;
  AC-10's names follow the `BR-NNN [vN] AC-NN …` convention.
- **Minor 6 — retained.** (a) D-4 records that it reverses F-012 D-8 and
  F-012 D-7's rejection of per-IP limits. (b) D-7 adds the residual of a
  wrong list or a listed range that contains clients (a chosen victim's
  peer locked out with 30 requests). (c) D-7 adds that the doubled
  `register` ceiling halves the time to evict an idle client and its
  families (about 16.7 h instead of 33 h). (d) The list cap rises from 16
  to 64 entries (BR-421, AC-10 with 64 and 65 entries, D-4).
- **Q-1 — owner decision (c).** `examples/compose.yaml` passes
  `${MCP_HTTP_TRUSTED_PROXIES:-}` with a comment on Traefik's network:
  BR-184 v3, AC-21, D-9. The follow-up reviews below replace the network
  wording and add BR-186 v2; this records the original review disposition.
- **Q-2 — owner decision.** The global ceilings stay twice v2 for
  `register`, `authorize`, `consent` and `callback`; `token` rises to 1,200
  a minute with 60 per peer, so its table bound is 2,399: BR-162 v3, AC-17,
  D-5, D-7, D-10.

Cross-vendor review (`46-spec-review-2-codex`, changes):

- **1 — retained.** D-9 and AC-20 require exact proxy addresses or a
  dedicated proxy-only network, observed-address append at every trusted
  hop, and a direct-connection spoofing example in both operator documents.
- **2 — retained.** BR-137 v2 and D-1 define omission only for an exact
  single registered URI at authorization; AC-01 covers omitted, matching
  and mismatching values, multiple URIs and variable loopback ports.
- **3 — retained.** BR-131 v2 separates cancellation initiation, stream
  termination and abort, uses the owning reader when locked, never awaits
  cancellation and preserves the original error. AC-08/09 add closed,
  abort-aware, rejected and never-settling cancellation fixtures and a
  bounded real-fetch transport test against a local HTTPS double.
- **4 — retained.** BR-133 is also the ID-token validation rule; its
  pending v2 now reads the clock after asynchronous verification. AC-05
  checks initiator/waiter expiry during the shared fetch and expiry during
  signature verification, including the exact expiry boundary.
- **5 — retained.** BR-422 validates raw XFF before normalisation, compares
  full addresses to trust entries and groups only the final peer. AC-12
  covers zones, uppercase/expanded IPv6, mapped hex and `/128` neighbours.
- **6 — retained.** D-5 replaces the one-hash cost claim with persisted
  rotation and ES256 signing, and the 600 bound with 660 (659 in the given
  boundary sequence). D-7/AC-16 keep the shared-egress limit explicit;
  AC-16 adds a persisted-refresh workload without a throughput promise.
- **7 — retained.** AC-19 uses independent admission, peer-refusal and
  global-refusal fixtures; global prefill uses distinct peers and the
  sentinel remains below its own limit.

Spec decision pass (`46-spec-decision-1-fable`, approve with minors):

- **1 — retained.** AC-12 adds every requested mapped-socket, multi-hop
  IPv6, `/33`, `/9`, IPv4-versus-IPv6 trust and hexadecimal-mapped row;
  uppercase/uncompressed IPv6 is valid and XFF zones are invalid.
- **2 — retained.** Existing rules names F-028 D-5 (60 authorize requests
  per minute) and F-032 D-8 (up to 120 replay records across a boundary).
  D-5 uses the conservative 660-entry bound, below 1,000.
- **3 — retained.** BR-186 v2 permits an optional empty default while
  required values remain `${NAME:?…}`. Its pending record and index row
  are added; AC-21 brings the Compose header comment into scope.
- **4 — retained.** D-7/AC-20 state that one residential `/56` or `/48`
  supplies 256–65,536 peers and that listing a shared network trusts every
  container on it; D-9 removes the shared-network recommendation.
- **5 — retained.** AC-08 uses a duck-typed opaque redirect for the body
  case and requires only abort for a native bodyless opaque redirect.
- **6 — retained.** D-1 explicitly rejects a new live-code binding-mismatch
  event; BR-137 v2 and AC-01 retain no logging for those failures.

Spec review 3 (`46-spec-review-3-reviewer`, approve; ready to freeze):

- **Minor 1 — retained.** The F-035 capability-map entry is rewrapped to
  at most 80 columns.
- **Minor 2 — retained.** D-1 states that accepting omitted `redirect_uri`
  deliberately departs from RFC 6749 §4.1.3, which requires presence and
  identity when included at authorization, following OAuth 2.1 §10.2.
- **Minor 3 — retained.** BR-133 v2 names the reading taken when the
  callback starts verification as the origin of both the 60 s throttle
  and the 3,600 s cache lifetime; the rule record uses identical wording.
- **Minor 4 — retained.** D-5 states the bound: at most 11 fixed windows
  of 60 intersect a 600 s lifetime, so at most 660 live entries, below
  each store's 1,000.
- **Minor 5 — retained.** Stray blank lines inside the business-rules
  list, between D-8 and D-9, and before the Cross-vendor review are removed.

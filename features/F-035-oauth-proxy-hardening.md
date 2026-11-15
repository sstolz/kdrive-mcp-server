---
id: F-035
title: OAuth proxy admission and grant handling hardened
ticket: "#46"
status: ready-for-freeze
version: 1
---

# F-035 — OAuth proxy admission and grant handling hardened

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-15.
Base: branch `feat/46-oauth-hardening` (main `958138f`).
IDs: F-035; BR-421 v1; BR-422 v1; BR-023 v4; BR-024 v5; BR-131 v2;
BR-133 v2; BR-137 v2; BR-162 v3; BR-167 v3; AC-01–AC-20. No ADR (D-8).
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
  it; the 60-second throttle counts from a fetch's start.
- BR-131 v2: the production upstream port cancels an unread body and aborts
  its request on every early exit.
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
- `docs/oauth-proxy.md` (reverse-proxy requirements, limits and residual
  risks) and `docs/deployment.md` (step 4, the reverse proxy's network
  without an address literal, BR-186): each change marked as F-035 pending
  acceptance.

### Out of scope

- The MCP per-identity window (BR-161), the health windows (BR-325), the
  connection cap and timeouts (BR-169), and the metadata routes `prm` and
  `as_metadata`, which have no window.
- The `Forwarded` header (RFC 7239), `X-Real-IP`, other `X-Forwarded-*`
  headers and the PROXY protocol (D-4).
- Any other use of the peer: it binds no consent, cookie, code or CIMD
  fetch, and is never logged (BR-167 v3).
- `examples/compose.yaml` and BR-184: the example sets no trusted proxy
  (open question Q-1).
- A cap on failed attempts per code (D-1), and any change to consent or
  flow consumption (BR-129, BR-132), which stays one-use whatever the
  outcome.
- The CIMD fetch port (`client-metadata-fetch.ts`, BR-306 v2), which has its
  own pinned client and bounds; discovery sharing (BR-131 v1), unchanged.
- Persisting windows across restarts: windows stay in memory and a restart
  empties them, as in v2.

## Business rules

- **BR-137 v2** — v1 holds, except for the order of the checks and what a
  refused request changes. After BR-136, a token request with
  `grant_type=authorization_code` is decided in this order:
  (1) `code` absent or unknown: 400 `invalid_grant`;
  (2) the code's 60-second lifetime has ended (now ≥ creation + 60 s):
  400 `invalid_grant`;
  (3) the code is bound to another client, `redirect_uri` is absent or not
  byte-identical to the bound one, or `code_verifier` is not 43–128
  unreserved characters whose S256 value equals the bound challenge:
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
  it, and no replay revokes. Verified by: AC-01–AC-04.
- **BR-133 v2** — v1 holds, except for how JWKS fetches start and are
  shared. At most one JWKS fetch is in flight. A request needs a fetch when
  the cache is empty or its 3,600 s have ended (it is then discarded, as
  under v1), or when its ID token carries a `kid` that no cached usable key
  matches. When a fetch is needed and one is in flight, the request awaits
  that fetch, then uses the cache as that fetch left it and starts no fetch
  of its own, even if a `kid` still matches nothing. When a fetch is needed
  and none is in flight, a fetch starts only if no fetch started in the last
  60 s; otherwise the request uses the cache as it is, and an empty cache
  rejects the ID token. A fetch's start is the clock reading of the request
  that starts it; the 60 s throttle and the 3,600 s lifetime of the key set it
  stores both count from it. A fetch that rejects, or answers other than 200,
  leaves the cache as it was, for the request that started it and for every
  request awaiting it. A request whose cache was empty and whose `kid` still
  matches nothing after the fetch it started or awaited starts no second
  fetch. A request whose cached keys match its token uses them at once, even
  while a fetch is in flight. Verified by: AC-05–AC-07.
- **BR-131 v2** — v1 holds, and the production upstream port
  (`createFetchUpstream`) releases what it owns on every early exit. When an
  exchange rejects because `fetch` rejects, the response is a redirect (type
  `opaqueredirect` or status 300–399), the body exceeds 65,536 bytes, reading
  the body fails, or the 10-second deadline passes, then before the returned
  promise rejects: the request's abort signal is aborted, and a response
  whose body has not been read to its end has that body cancelled. A URL
  other than `https` still rejects before any `fetch`. The rejection is
  otherwise as under v1 (discovery unusable, `server_error` at the code
  exchange, BR-132), and a cancellation or abort that throws is ignored. A
  fulfilled exchange has read its body to its end and does not abort its
  signal. Verified by: AC-08, AC-09.
- **BR-421** — The F-002 setting `httpTrustedProxies` (environment
  `MCP_HTTP_TRUSTED_PROXIES`, comma-separated like the other list settings;
  option `--http-trusted-proxies`; YAML `httpTrustedProxies`) is an optional
  list, default empty, of at most 16 entries. Each entry is an IPv4 address
  in dotted-decimal form without leading zeros, or an IPv6 address
  byte-identical to the WHATWG URL serialisation of itself (lowercase,
  compressed, no zone, no brackets, no dotted IPv4 part) and not inside
  `::ffff:0:0/96` (IPv4-mapped); either may be followed by `/` and a prefix
  length without a leading zero, 8–32 for IPv4 and 8–128 for IPv6, with no
  address bit set after the prefix. An entry without a prefix stands for
  `/32` (IPv4) or `/128` (IPv6). Any other entry is refused with
  `INVALID_VALUE`, and so is a list of more than 16 entries or with two
  entries naming the same prefix (for example `192.0.2.1` and
  `192.0.2.1/32`); overlapping prefixes of different lengths are accepted.
  The setting is accepted only with transport `http`, authentication on and
  OAuth mode `proxy` (the BR-290 restriction); otherwise
  `CONFLICTING_SETTINGS`. It is read at startup only. Verified by: AC-10.
- **BR-422** — The peer of a request on an OAuth route is derived from the
  socket's remote address `S`, as Node reports it, and the BR-421 list `T`:
  (1) every address is normalised before it is compared or used: an
  IPv4-mapped IPv6 address becomes its IPv4 address and an IPv6 zone index
  (`%…`) is dropped; an IPv4 address never matches an IPv6 entry of `T`, nor
  the reverse;
  (2) when `T` is empty or `S` is not inside an entry of `T`, the peer
  address is `S`, and no forwarding header is read;
  (3) otherwise the `X-Forwarded-For` field lines are joined in order with
  commas and split on commas, each element is trimmed of spaces and tabs,
  and the elements are examined from the rightmost, at most 32 of them; the
  walk ends at the first element that is not an IPv4 address in
  dotted-decimal form without leading zeros or an IPv6 address without
  brackets, port or zone (an empty element included), at the leftmost
  element, or after the 32nd; the peer address is the first examined valid
  element that is not inside an entry of `T`; when there is none, it is the
  leftmost valid element examined, or `S` when no examined element was valid
  (no header, an empty one, or an invalid rightmost element);
  (4) the peer is the IPv4 peer address itself, or the first 64 bits of an
  IPv6 peer address: two IPv6 addresses whose first 64 bits are equal are
  the same peer; a socket without a remote address is the one peer
  `unknown`;
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
  | `token`     | 60       | 300    | 60 s          |

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
  `callback`, 599 for `token`). Verified by: AC-13–AC-18.
- **BR-167 v3** — v2 holds, except that the `request_refused` event of a
  429 from a BR-162 v3 OAuth window also has the field `window`, `peer` or
  `global`; every other event keeps its v2 fields. No response, error,
  thrown message or logger call is built from the socket address, an
  `X-Forwarded-For` value or element, or a BR-422 peer. Verified by:
  AC-14, AC-15, AC-19.
- **BR-023 v4** (F-002) — adds the bounds of BR-421. Verified by: AC-10.
- **BR-024 v5** (F-002) — adds `httpTrustedProxies` to the proxy-only
  settings. Verified by: AC-10.

Existing rules this feature relies on without change:

- **BR-136 v2**: client authentication runs before BR-137 v2 and never
  touches the code.
- **BR-140 v2**, **BR-298 v2**, **BR-299 v2**: the family revocation of
  BR-137 v2 step (5) is the one they define, committed before its
  `invalid_grant`; a failed commit answers 503.
- **BR-142 v3**: the stores and their 1,000-entry bounds that the global
  windows protect (D-5).
- **BR-325**, **BR-161 v1**: the health and MCP windows are unchanged.
- **BR-186**: `docs/deployment.md` keeps `0.0.0.0` and `127.0.0.1` as its
  only IP addresses.

## Acceptance criteria

Proxy tests use the fake clock, upstream port and logger of
`tests/helpers/proxy.ts`; HTTP tests use the router fixture of
`tests/http/rate-limits.test.ts`, which passes a remote address to
`handle`; addresses come from the documentation ranges (`192.0.2.0/24`,
`198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`) and loopback.

- **AC-01** (BR-137 v2) — Given a fresh code issued to client A, When it is
  presented with client B's credentials, without `redirect_uri`, with an
  altered loopback port, a wrong verifier, a 42-character verifier, a
  verifier with `+`, or another `resource`, Then each gets 400
  `invalid_grant` (`invalid_target` for the resource), no event is logged,
  and a following correct redemption by A gets 200 with a refresh token.
  Verified by: `BR-137 v2 AC-01 refuses %s without consuming the code` in
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
  bounds redemption and replay revocation`.
- **AC-04** (BR-137 v2) — Given a fresh code, When two correct redemptions
  run concurrently, Then one gets 200 and the other 400 `invalid_grant`
  with one `refresh_family_revoked`; When a wrong-verifier request and a
  correct one run concurrently, in either order, Then they get 400 and 200
  and no event is logged. Verified by: `BR-137 v2 AC-04 concurrent
  redemptions consume and revoke only on matching requests`.
- **AC-05** (BR-133 v2) — Given an empty JWKS cache and an upstream whose
  JWKS reply is held, When two and then three callbacks whose ID tokens
  carry the served `kid` arrive before the reply is released, Then every
  callback redirects with a `code`, and the upstream receives exactly one
  JWKS request. Verified by: `BR-133 v2 AC-05 concurrent callbacks on a
  cold cache share one JWKS fetch` in `tests/auth/proxy-id-token.test.ts`.
- **AC-06** (BR-133 v2) — Given keys fetched at `T` and an upstream that
  now also serves a rotated key, When at `T + 61` s two callbacks whose
  tokens carry the rotated `kid` arrive while the refetch is held, Then
  both redirect with a `code` after one JWKS request; When a third such
  callback arrives after the refetch settled, Then it redirects with a
  `code` without a request; and When at `T + 61` s a callback with the
  original `kid` arrives while the refetch is held, Then it redirects with
  a `code` before the refetch is released. Verified by: `BR-133 v2 AC-06
  concurrent callbacks with a rotated kid share one refetch`.
- **AC-07** (BR-133 v2) — Given an empty cache, When a JWKS fetch started
  at `T` is held and then fails while two callbacks await it, Then both are
  rejected (`server_error` redirect) after one request; When a callback
  arrives at `T + 60` s − 1 ms, Then it is rejected with no request; When
  one arrives at `T + 60` s, Then exactly one request is made and, the
  upstream answering, it redirects with a `code`. Given a fetch started at
  `T` and released at `T + 5` s, Then a callback at `T + 3,600` s − 1 ms uses
  the cache without a request and one at `T + 3,600` s makes one. Verified
  by: `BR-133 v2 AC-07 a shared fetch fails for every waiter and both
  bounds count from its start`.
- **AC-08** (BR-131 v2) — Given the production port over a fake `fetch`
  whose response body records `cancel`, When `fetchJson` and `postForm`
  each receive a 301, 302, 303, 307 and 308 response with a body, and an
  `opaqueredirect` response, Then each rejects as a refused redirect, and
  when its rejection is observed the body's `cancel` has been called once
  and the request's signal is aborted. Verified by: `BR-131 v2 AC-08 a
  refused redirect cancels its body and aborts its request` in
  `tests/auth/proxy-upstream.test.ts`.
- **AC-09** (BR-131 v2) — Given the same port, When the body has 65,536
  bytes, Then the exchange fulfils and the signal is not aborted; When it
  has 65,537 bytes, when its stream errors after 10 bytes, and when `fetch`
  itself rejects, Then the exchange rejects, the signal is aborted and a
  received body has been cancelled; When the headers arrive and the body
  then stalls past 10,000 ms, Then the exchange rejects at 10,000 ms with
  the signal aborted and the body cancelled, and at 9,999 ms it is still
  pending; and When `cancel` throws, Then the rejection is unchanged.
  Verified by: `BR-131 v2 AC-09 every other early exit aborts its request
  and releases the body`.
- **AC-10** (BR-421, BR-023 v4, BR-024 v5) — Given each source
  (environment, option, YAML), When the list holds `127.0.0.1`,
  `192.0.2.0/24`, `10.0.0.0/8`, `198.51.100.7/32`, `2001:db8::1`,
  `2001:db8::/32`, `fd00::/8` and `2001:db8::/128`, or 16 valid entries,
  Then it loads; When it holds 17 entries, `192.0.2.1` with `192.0.2.1/32`,
  `10.0.0.0/7`, `fd00::/7`, `0.0.0.0/0`, `::/0`, `192.0.2.0/33`,
  `2001:db8::/129`, `10.0.0.1/8`, `2001:db8::1/32`, `192.0.2.0/024`,
  `010.0.0.1`, `192.0.2`, `2001:DB8::1`, `2001:db8:0:0:0:0:0:1`,
  `[2001:db8::1]`, `fe80::1%eth0`, `::ffff:192.0.2.1`, `::ffff:c000:201`,
  `192.0.2.1:80`, `proxy.example.com` or an empty entry, Then
  `INVALID_VALUE`; Given stdio, `--insecure-no-auth`, or `delegate` mode,
  Then `CONFLICTING_SETTINGS`. Verified by:
  `tests/config-value-boundaries.test.ts` and `tests/config.test.ts`
  (`BR-421 AC-10 ...`).
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
  for 33 elements `127.0.0.3` followed by `198.51.100.1` on the left with
  list `127.0.0.0/8`, `127.0.0.3`, and for 31 such elements, `198.51.100.1`;
  for `::ffff:203.0.113.9`, the peer of `203.0.113.9`; and Given socket
  `192.0.2.50` not in the list, Then `X-Forwarded-For` is ignored.
  Verified by: `BR-422 AC-12 the X-Forwarded-For walk trusts only listed
  proxies`.
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
  ceiling of %s is %i per %i seconds`.
- **AC-16** (BR-162 v3) — Given peer P sending 60 token requests with an
  unknown client and then a valid refresh, Then the valid one gets 429
  `window` `peer`, while a valid refresh from peer Q gets 200; Given P
  sending 30 registrations with an invalid body, Then a valid registration
  from Q gets 201. Verified by: `BR-162 v3 AC-16 invalid requests lock out
  only their own peer`.
- **AC-17** (BR-162 v3) — Given the authorize table, When one peer is
  admitted at `T`, 59 others at `T + 60` s − 1 ms and 60 others at
  `T + 60` s, Then the table holds 119 entries (the first one removed); When
  a new peer arrives at `T + 120` s − 1 ms, Then it is refused (`global`) and
  the table still holds 119; When one arrives at `T + 120` s, Then it is
  admitted and the table holds 1; and for `token`, with 1, 299 and 300 peers
  at the same instants, the table holds 599. Verified by: `BR-162 v3 AC-17
  a peer table holds fewer than twice its global limit` (through the
  limiter's entry count).
- **AC-18** (BR-162 v3) — Given a full window for peer P, Then requests
  refused with 403 `invalid_host`, 405, 413 by framing, 403 `invalid_origin`
  and 429 are counted in neither P's nor the global window; Given a full
  global window, Then a request refused by it does not count for its peer;
  and Given 30 MCP requests and 120 health requests, Then no OAuth window
  changes (through the limiter's counts). Verified by: `BR-162 v3 AC-18
  refused and non-OAuth requests count in no OAuth window`.
- **AC-19** (BR-167 v3, BR-422) — Given a capturing logger and list
  `192.0.2.66`, When requests with remote address `192.0.2.66` and
  `X-Forwarded-For: 198.51.100.77, 203.0.113.88` are admitted and refused by
  both windows on every OAuth route, Then no response header or body and no
  logged field contains `192.0.2.66`, `198.51.100.77` or `203.0.113.88`, and
  every `request_refused` of a 429 has exactly `route`, `status`, `error`
  and `window`. Verified by: `BR-167 v3 AC-19 no peer address reaches a
  response or an event` in `tests/http/secrecy.test.ts`.
- **AC-20** (BR-421, BR-162 v3) — Given `docs/oauth-proxy.md`, Then it
  names `MCP_HTTP_TRUSTED_PROXIES`, `X-Forwarded-For`, the per-peer and
  global limits of the table and the IPv6 `/64` grouping, and no longer
  states that the server ignores `X-Forwarded-*`; Given
  `docs/deployment.md`, Then it names `MCP_HTTP_TRUSTED_PROXIES` and the
  BR-186 privacy test still passes. Verified by: `BR-421 BR-162 v3 AC-20
  the operator documentation describes peer admission` in
  `tests/docs/oauth-admission-docs.test.ts`.

The v2 tests `BR-162 AC-11 ...` and `BR-325 BR-162 v2 ...` keep passing
unchanged: without a remote address every request is the peer `unknown`,
whose limits equal the v1 limits. The v1 test `BR-137 refuses %s and
consumes the code` is replaced by AC-01's test (BR-137 v2).

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
  invalid request revoke, which is defect 1).
- **D-2 — One shared JWKS fetch, throttled from its start.** The pattern
  is discovery's: an in-flight promise that every concurrent request
  awaits. Waiters start no fetch of their own, so a burst of tokens with a
  bogus `kid` still costs at most one fetch per 60 s. Rejected: setting
  `lastJwksFetch` after the reply (every concurrent request would fetch); a
  second fetch for a waiter whose `kid` is still unmatched (a refetch per
  bogus token).
- **D-3 — Abort and cancel on every early exit.** An unread body holds its
  connection until the peer or the collector closes it; aborting the
  signal and cancelling the body releases both at once. Rejected: relying
  on garbage collection (sockets held for an unbounded time).
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
  cannot be configured by accident. Rejected: always trusting
  `X-Forwarded-For` (any client chooses its peer); the leftmost element
  (client-supplied); the `Forwarded` header (Traefik and most proxies send
  `X-Forwarded-For` by default; a second parser doubles the surface);
  per-address IPv6; `/56` or `/48` grouping (joins unrelated customers of
  hosting providers that assign one `/64` per machine); host-name entries
  (DNS at startup, rebinding).
- **D-5 — Per-peer limits equal to the v1 limits; global ceilings above
  them; invalid requests count in both.** With an empty list behind one
  reverse proxy every request has the same peer, so the server behaves
  exactly as under v2, never stricter. With a listed proxy, a single
  abusive peer locks out only itself. The global ceilings keep the stores
  of BR-142 v3 below their bounds as F-012 D-7 computed: 60 authorize or
  consent requests a minute create at most 600 pending consents and 600
  flows per 600 s (bound 1,000 each), and 60 registrations an hour need
  over 16 hours to cycle 1,000 clients. The token route creates no entry
  beyond the families of codes, which the callback ceiling bounds, so its
  ceiling is 300 a minute (one hash per refused request). Counting before
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
  twice the rate (five times for `token`); clients whose token and
  registration requests come from a shared egress (for example a hosted AI
  service's servers) share one peer, and another user of that service can
  fill it; with an empty list behind a reverse proxy, v2's shared lockout
  remains; a listed proxy that does not set or append the client address
  as the last `X-Forwarded-For` element lets clients choose their peer.
- **D-8 — No ADR.** The setting is additive and empty by default, the
  windows live in memory, nothing is persisted and the choice is reversed
  by a new version of BR-162 and BR-422.

## Open questions

- **Q-1 — Compose example.** The documented Compose deployment
  (`examples/compose.yaml`, BR-184) puts Traefik in front, so it gets the
  per-peer protection only if the operator sets `MCP_HTTP_TRUSTED_PROXIES`
  to Traefik's network. Options: (a) document it in `docs/deployment.md`
  only, the example unchanged (this spec); (b) add
  `MCP_HTTP_TRUSTED_PROXIES: ${MCP_HTTP_TRUSTED_PROXIES:?…}` to the example,
  which versions BR-184 and makes every existing deployment set it before
  `docker compose up` succeeds again; (c) add it as optional with an empty
  default, which needs the list grammar to accept an empty value.
  Recommendation: (a) now, (b) with the next breaking release.
- **Q-2 — Global ceilings.** D-5 doubles the v2 process-wide limits (five
  times for `token`) as global ceilings, so a single source can no longer
  close a route but unauthenticated load may double. Options: (a) the
  table as written; (b) global ceilings equal to v2 and per-peer limits at
  half of them (stricter than v2 for an unconfigured deployment).
  Recommendation: (a).

## Stress-test

Pending spec review.

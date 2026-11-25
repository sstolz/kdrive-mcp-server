---
id: F-053
title: HTTP lifecycle hardening
ticket: "#73"
status: frozen
version: 1
---

## Context

Ticket #73 collects six HTTP-layer gaps found during F-012, F-026 and F-035
reviews. Each leaves a resource held after its owner is gone, or an
asynchronous failure uncontained:

1. `create` (`src/http/handler.ts`): when transport handling throws after an
   `initialize` registered its session, the request gets 500 but the session
   stays registered until it idles out (30 minutes), counting toward the 8
   per-identity and 64 process bounds of BR-164.
2. `WindowLimiter` (`src/http/limits.ts`) never removes expired windows. It
   backs the BR-161 per-identity MCP window and the two BR-325 health
   windows. The per-route OAuth windows already use `OAuthWindowLimiter`,
   which prunes under BR-162 v3 (F-035); MCP requests have no per-route
   window (BR-162 v3), so the identity map is the only unbounded one.
3. `remove` (`src/http/handler.ts`) awaits the SDK's DELETE handling without
   racing `session.gone`, although BR-164 v1 requires every in-flight request
   other than the closing DELETE to settle when its session closes for any
   reason.
4. `defaultListen` (`src/http/server.ts`) removes its `error` listener after
   a successful bind, so an accept-time error (for example `EMFILE`) is an
   unhandled `error` event that ends the process.
5. `sdkRequest` (`src/http/handler.ts`) builds the request the SDK sees
   without any disconnect signal, so a call queued under F-026 (writes
   included) from a disconnected client still runs up to 12 s later
   (F-026 D-8, accepted residual risk). The owner reverses that acceptance
   for calls that have not started.
6. `node:http` keeps at most `maxHeadersCount` (default 2,000) header lines
   and drops the rest silently; the count is not pinned and the router never
   learns that headers were dropped.

Users affected: operators of the HTTP transport (availability, memory,
logs) and MCP clients over HTTP (disconnect and header-limit behaviour).
Stdio is unaffected.

## Scope

- Close a registered session when `initialize` transport handling throws
  (BR-164 v2, BR-167 v4).
- Prune expired `WindowLimiter` windows (BR-443).
- Race an in-flight DELETE against session closure (BR-164 v2, already
  required by v1).
- Keep a post-bind `error` listener with a bounded, payload-free diagnostic
  (BR-444, BR-167 v4).
- Carry an HTTP disconnect signal to the handlers (BR-166 v2) and use it
  to cancel queued, not-yet-started invocations (BR-445). `serve`
  (`src/http/adapter.ts`) creates the disconnect controller and passes its
  signal to `handle()` as an explicit parameter; `sdkRequest`
  (`src/http/handler.ts`) builds the SDK request with no `signal` option
  and registers the disconnect signal in a `WeakMap<Request, AbortSignal>`
  keyed by that request; the handlers resolve it by looking up
  `ctx.http.req` in that map (D-4). The navigation controller's `invoke`,
  `invokeMutation` and `readResource` (`src/navigation.ts`) gain an
  optional disconnect-signal parameter, passed by the tool, mutation,
  resource-template and custom `resources/read` handlers (D-4). Stdio has
  no map entry and passes none, so stdio behaviour is unchanged.
- Pin `maxHeadersCount` and refuse more than 100 header lines with 431
  (BR-169 v4, BR-446, BR-167 v4).
- Records: `CHANGELOG.md` `## [Unreleased]` lines citing #73; the 431
  header-count limit is recorded in BR-446, BR-167 v4 and the
  `docs/oauth-proxy.md` "Limits and residual risks" list, which also gains
  the disconnect-cancellation behaviour. One policy for closed specs: no
  closed spec is edited (neither F-012 nor F-026); the reversal of F-026
  D-8 for queued calls is recorded only in D-4 and the CHANGELOG.

### Out of scope

- Process, stdio and mutation shutdown items (moved to #139).
- Any change to the 16,384-byte header-size limit, to Node's own 431 for
  oversized headers, or to the other BR-169 server settings.
- Cancelling an invocation that has started on HTTP disconnect; aborting a
  started call through `notifications/cancelled` keeps its current
  behaviour (BR-383, BR-250).
- Transport exceptions on requests bound to an existing session (`bound`).
- Changes to `OAuthWindowLimiter`, the BR-161 limit or the BR-325 windows'
  counting.
- New error codes beyond those named below; stdio behaviour.

## Business rules

These are deltas: each previous version otherwise holds. New IDs
BR-443–BR-446 are allocated to this draft.

- **BR-164 v2** — v1 holds, plus: when the SDK transport's handling of an
  `initialize` request, after its `onsessioninitialized` callback registered
  the session, either throws or rejects, or resolves with a response whose
  status is outside 200–299, the router closes that session with reason
  `initialize_failed` (closing its transport and `McpServer`) before it
  answers, and answers HTTP-layer error 500 `server_error` (the SDK's
  response body is discarded); the session no longer counts toward the 8 or
  64 bounds and its ID yields 404. A session that another reason already
  closed is not closed again and is answered as under v1. A
  `DELETE` whose SDK handling is in flight when its session closes for a
  reason other than that DELETE settles at once with BR-164's 503
  `temporarily_unavailable` without `Retry-After`, without waiting on the
  SDK transport, and does not close the session a second time. Verified by:
  AC-01, AC-02, AC-03.
- **BR-443** — `WindowLimiter.take` (`src/http/limits.ts`), each time it
  opens a new window for a key (no window for that key, or its window has
  ended: `now >= start + windowMs`), first removes every entry whose window
  has ended at `now`; a `take` that counts into or refuses from a live
  window removes nothing. After a `take` that opens a window, the limiter
  holds only entries whose window is live at that `take`'s `now`; after a
  `take` that counts into or refuses from a live window, the entry count is
  unchanged. Pruning changes no
  admission or `Retry-After` result of BR-161 or BR-325. An aggregate
  `size` accessor (test evidence only, exposing no key) reports the entry
  count. Verified by: AC-04, AC-05.
- **BR-444** — Once `startHttpServer` has bound its listener (with any
  `ListenPort`), the server keeps one `error` listener until `close()`
  resolves. An `error` event on the listening server never closes the
  listener, ends a connection, rejects or resolves anything, or ends the
  process; the server keeps accepting and answering requests. It emits the
  event `listener_error` with exactly the fields `code` (the error's `code`
  property when it is a string matching `^E[A-Z0-9]{1,31}$`, else `other`)
  and `suppressed` (the number of `error` events not logged since the
  previous `listener_error`, `0` for the first). At most one
  `listener_error` is emitted per 60,000 ms of the handler clock: an error
  less than 60,000 ms after the last emitted `listener_error` is only
  counted. The window is measured from the last emit attempt: an attempt
  starts a new 60,000 ms window and resets the suppressed count to `0`
  whether or not the logger throws; a throwing logger otherwise changes
  nothing. When the clock reads earlier than the last emit attempt
  (negative elapsed time), the elapsed time counts as 60,000 ms or more and
  the event is emitted. A bind error before the
  listener is bound still yields `LISTEN_FAILED` (BR-153). Verified by:
  AC-06, AC-07.
- **BR-166 v2** — v1 holds, plus: for each HTTP request, `serve` creates one
  disconnect `AbortController` and passes its signal to `handle()` as an
  explicit parameter. That controller aborts when, and only when, either the
  `ServerResponse` `close` event or the `close` event of `req.socket` fires
  while the response's `writableFinished` is false; it never aborts after
  the response was completely written. `serve` attaches at most one `close`
  listener per socket, shared by every unsettled request on that socket
  (not one per request); when it fires, it aborts the controller of each
  unsettled request on the socket and settles each one's pending
  response-write wait, so every `serve` promise settles and leaves the
  server's in-flight set even when its response never emits `finish` or
  `close`. The shared socket listener is removed once the socket has no
  unsettled request, and each `ServerResponse` listener once its response
  settles (finishes or closes), so a kept-alive socket holds no listener of
  a settled request. Neither the request built by `toRequest` nor the SDK
  request built by `sdkRequest` is constructed with a `signal` option, and
  neither is ever aborted by a disconnect. `sdkRequest` registers the
  disconnect signal in a `WeakMap<Request, AbortSignal>` keyed by the SDK
  request it builds. The SDK request never carries `Authorization`,
  `Cookie` or `authInfo`. Handlers obtain the disconnect signal only by
  looking up the SDK context field `ctx.http.req` (the request given to the
  transport) in that map; no entry (stdio, or no HTTP request) means no
  disconnect signal. The disconnect signal is distinct from, and never
  linked to, `ctx.mcpReq.signal`, so a disconnect does not abort
  `ctx.mcpReq.signal`, and a `notifications/cancelled` does not abort the
  disconnect signal. Verified by: AC-08, AC-14.
- **BR-445** — A tool call, resource read or `mutate` call carried by an
  HTTP request is *started* once it holds its controller's slot: the
  BR-383 `start` step has run, which sets its invocation deadline (BR-384),
  either at arrival on a free slot or on a slot handed to it. When the
  BR-166 v2 disconnect signal aborts while such a call has not started
  (it is waiting under BR-380, or arrives with the signal already aborted),
  the call leaves the queue at once or does not join it and returns
  `ACCESS_DENIED` (tool error `isError:true`, resource read protocol error
  `-32000`), with zero kDrive requests, zero dependency calls and zero
  audit records (no intent appended); its wait timer and listeners are
  removed, and the calls behind it keep their order and move up (as
  BR-385). The disconnect listener is removed in the same BR-383 step in
  which the call takes the slot, so it is never attached while the call
  runs. A call that has started is unaffected by the disconnect: it
  runs until it settles under its existing bounds, a gate run keeps every
  BR-258 v2 and BR-250 semantics, including a committed write and its
  audit outcome, and its result is discarded by the adapter. A disconnect
  emits no new event and no HTTP response is written for it. When the
  disconnect and a slot release fall in the same synchronous step, the
  BR-383 order decides: a call that took the slot first is started. This
  reverses F-026 D-8 for calls that have not started. Verified by: AC-08,
  AC-09, AC-10, AC-11, AC-14.
- **BR-169 v4** — v3 holds, plus: the server sets `maxHeadersCount` to 101,
  so Node keeps at least one header line beyond the BR-446 bound;
  `maxHeaderSize` stays 16,384 bytes. Verified by: AC-12.
- **BR-446** — A request whose header block holds more than 100 header
  lines, counted as the name/value pairs Node reports in `rawHeaders`
  (repeated names counted separately, `Host` included, trailers excluded),
  is answered with HTTP-layer error 431 `invalid_request` (BR-167 body and
  headers, plus `Connection: close`), before `handle()` runs and so before
  the shutdown, target-length, `Host`, authentication, window and body
  checks, with no body read; a request with exactly 100 header lines is
  handled as before. Verified by: AC-12, AC-13.
- **BR-167 v4** — v3 holds, plus: `session_closed` `reason` may also be
  `initialize_failed` (BR-164 v2); the feature adds the event
  `listener_error` with exactly the fields of BR-444, built from no error
  message, address or stack; a BR-446 431 emits exactly one
  `request_refused` with `status` 431, `error` `invalid_request` and the
  `route` rule of v1 (byte-exact path match, else `unknown`). Verified by:
  AC-01, AC-06, AC-13.

## Acceptance criteria

Tests are Vitest tests run through `make check`, with synthetic keys, a fake
clock, a fake upstream port and synthetic navigation dependencies. Test
names cite their BR versions.

- **AC-01** (BR-164 v2, BR-167 v4) — Given an `initialize` whose SDK
  transport handling throws after `onsessioninitialized` registered the
  session, When the router answers, Then the response is 500
  `server_error` with one `request_refused` (`route` `mcp`, `status` 500),
  one `session_closed` with `reason` `initialize_failed` and the decremented
  `count` was emitted before the response, the transport and server were
  closed, a request with that session ID gets 404, and 8 further
  `initialize` calls of that identity evict nothing; and Given the real SDK
  transport answering a registered `initialize` with its own 500 (its
  `_checkScopeChallenge` step made to reject, SDK `index.mjs:549-553`),
  Then the same holds: the router answers 500 `server_error` with no SDK
  body, `session_closed` `initialize_failed` is emitted, and the ID yields
  404. Verified by: `tests/http/sessions.test.ts` "BR-164 v2 BR-167 v4
  AC-01 closes a registered session when initialize handling throws" and
  "BR-164 v2 AC-01 closes a registered session when the SDK answers
  initialize with a non-2xx status".
- **AC-02** (BR-164 v2) — Given 64 sessions of which one is created by a
  throwing `initialize` as in AC-01, When a 65th `initialize` arrives, Then
  it is admitted (the failed session freed its slot). Verified by:
  `tests/http/sessions.test.ts` "BR-164 v2 AC-02 a failed initialize
  frees its process slot".
- **AC-03** (BR-164 v2) — Given a session whose DELETE is held in the SDK
  transport, When the session is closed for `evicted` (and, in a second
  case, `idle` through a sweep and `shutdown`), Then the DELETE is answered
  503 `temporarily_unavailable` without `Retry-After` without waiting on
  the transport, exactly one `session_closed` is emitted for that session,
  and a held DELETE whose transport then answers 200 closes nothing again.
  Verified by: `tests/http/sessions.test.ts` "BR-164 v2 AC-03 settles a
  held DELETE when its session closes for another reason".
- **AC-04** (BR-443) — Given a `WindowLimiter` (limit 120, 60,000 ms) with
  windows for keys A and B opened at t=0, When key C takes at t=60,000,
  Then `size` is 1; and Given a fresh limiter where A takes at t=0 and B at
  t=30,000, When B takes at t=60,000 (A's window has ended, B's is live),
  Then `size` is still 2. Verified by: `tests/http/rate-limits.test.ts`
  "BR-443 AC-04 prunes ended windows only when a new window opens".
- **AC-05** (BR-443, BR-161) — Given 1,000 distinct keys each taking once
  at successive times spanning more than 60,000 ms, When each take
  completes, Then `size` never exceeds the number of keys whose window is
  live at that time, and the BR-161 121st-request refusal and its
  `Retry-After` are unchanged. Verified by: `tests/http/rate-limits.test.ts`
  "BR-443 BR-161 AC-05 keeps only live identity windows".
- **AC-06** (BR-444, BR-167 v4) — Given a started HTTP server with a
  recording logger, When the listening server emits `error` with codes
  `EMFILE` at t=0, then a non-string code, then a code `emfile`, then
  `EAGAIN` at t=59,999, Then the process stays up, a following MCP request
  is answered, the first error emits `listener_error`
  `{code:"EMFILE", suppressed:0}`, the three others emit nothing, and an
  `ENFILE` error at t=60,000 emits `{code:"ENFILE", suppressed:3}`; and
  When the clock then reads 1,000 ms before that last emit and an error
  with code `emfile` follows, Then it is emitted as
  `{code:"other", suppressed:0}`; no event field holds a message, address
  or stack. Verified by:
  `tests/http/startup.test.ts` "BR-444 BR-167 v4 AC-06 logs accept-time
  errors once per minute and keeps serving".
- **AC-07** (BR-444) — Given a logger whose `event` throws, and a custom
  `ListenPort`, When the server emits `error` after bind, Then nothing
  throws and the server keeps answering, and a second error 1 ms later is
  suppressed (the throwing attempt started the window) and counted as
  `suppressed:1` in the next `listener_error` 60,000 ms after that attempt,
  emitted to a logger that no longer throws; and Given a port in use, Then
  startup still fails with `LISTEN_FAILED`. Verified by:
  `tests/http/startup.test.ts` "BR-444 AC-07 contains a throwing logger and
  keeps LISTEN_FAILED before bind".
- **AC-08** (BR-166 v2, BR-445) — Given a socket client whose tool call
  waits behind a held invocation of the same session, When the client
  destroys its connection, Then the request the SDK saw carried no
  `Authorization`, `Cookie` or `authInfo` and its own `signal` stayed not
  aborted, the disconnect signal resolved from it through the map aborted,
  the waiting call returned `ACCESS_DENIED` with zero kDrive requests and
  zero audit records, a held tool handler observes the disconnect signal
  resolved from `ctx.http.req` aborted while its `ctx.mcpReq.signal` stays
  not aborted, and a request whose response was fully written never sees
  its disconnect signal abort; and Given a held tool call, When the client
  sends `notifications/cancelled` for it on a live connection, Then its
  `ctx.mcpReq.signal` aborts while the disconnect signal resolved from its
  `ctx.http.req` stays not aborted; and Given a resource read
  through the custom `resources/read` handler waiting the same way, When
  its client disconnects, Then it is answered protocol error `-32000`
  `ACCESS_DENIED` with zero kDrive requests, and the waiter's disconnect
  listener count is 0 once a call takes the slot. Verified by:
  `tests/http/disconnect.test.ts` "BR-166 v2 BR-445 AC-08 a disconnect
  cancels a waiting call".
- **AC-09** (BR-445) — Given a `mutate` call waiting behind a held read,
  When its client disconnects, Then the mutation never runs: zero intent,
  zero kDrive requests, zero audit records, and the next waiter takes the
  slot in order. Verified by: `tests/http/disconnect.test.ts` "BR-445 AC-09
  a disconnect cancels a queued write before intent".
- **AC-10** (BR-445) — Given a started read; separately, a started gate
  run that has appended its intent; and separately, a started gate run held
  in a pre-intent `dispatch` step (slot taken, no intent appended yet),
  When their clients disconnect, Then the read runs to completion with its
  kDrive requests, both gate runs append their intent, commit their write
  and append their audit outcome as without a disconnect (the pre-intent
  run's BR-250 `interrupted` check never reports `CANCELLED`), and nothing
  is written to the closed connections. Verified by:
  `tests/http/disconnect.test.ts` "BR-445 AC-10 a started invocation runs to
  completion after a disconnect".
- **AC-11** (BR-445) — Given a waiting call, When the slot is released and
  the disconnect fires in the same synchronous step in each order, Then the
  call is either refused `ACCESS_DENIED` with zero records (disconnect
  first) or started and completed (release first), never both; and a call
  whose signal is already aborted at arrival on a free slot does not start.
  Verified by: `tests/http/disconnect.test.ts` "BR-445 AC-11 the slot order
  decides a disconnect at release".
- **AC-12** (BR-169 v4, BR-446) — Given the created server, Then
  `maxHeadersCount` is 101 and `maxHeaderSize` 16,384; and Given a socket
  request with exactly 100 header lines, Then it is handled as before.
  Verified by: `tests/http/lifecycle.test.ts` "BR-169 v4 BR-446 AC-12 pins
  the header count and accepts 100 header lines".
- **AC-13** (BR-446, BR-167 v4) — Given socket requests with 101 header
  lines and with 2,500 header lines (each request's entire header block
  under 16,384 bytes, e.g. repeated `x:` lines with empty values, so
  repeated names are included), sent to `/mcp` with a valid token and to an
  unknown path during shutdown, When they arrive, Then each gets 431
  `{"error":"invalid_request"}` with `Connection: close`, no
  authentication, window count or body read occurs, and one
  `request_refused` (`route` `mcp` or `unknown`, `status` 431) is emitted.
  Verified by: `tests/http/lifecycle.test.ts` "BR-446 BR-167 v4 AC-13
  refuses more than 100 header lines with 431".
- **AC-14** (BR-166 v2, BR-445, BR-381 v1) — Given `serve` handling a request, When
  `handle()` is called, Then it receives the disconnect signal as an
  explicit parameter, looking up the SDK request in the map returns that
  same signal, and after a disconnect neither the `toRequest` request's
  nor the SDK request's own `signal` is aborted; and Given 12 pipelined
  HTTP/1.1 requests written in one socket write on one session, the first
  holding a started tool call and the 11 others carrying tool calls, When
  4 calls wait behind the first and the other 7 have been refused at
  arrival by BR-381 v1, and the client then destroys the socket, Then the
  4 waiting calls return `ACCESS_DENIED` and the 7 refused calls returned
  `SERVER_BUSY`, all with zero kDrive requests and zero audit records, the
  first runs to completion, every `serve`
  promise settles, the server's in-flight set is empty, the socket never
  held more than one `close` listener added by `serve`, and the process
  emitted no `warning` event; and Given 10 sequential requests on one
  kept-alive socket, When each has settled, Then the socket holds no
  `close` listener added by `serve`. Verified by:
  `tests/http/disconnect.test.ts` "BR-166 v2 BR-445 AC-14 the disconnect
  signal is passed explicitly and covers pipelined requests".

## Decisions

- **D-1 — Close reason `initialize_failed`.** A dedicated reason keeps the
  `session_closed` vocabulary distinguishable from `deleted`. Rejected:
  reusing `deleted` (misleading in logs); leaving the session to idle out
  (holds bounds for 30 minutes).
- **D-2 — Prune on new-window creation, as `OAuthWindowLimiter` does.** No
  timer, so construction stays I/O- and timer-free (BR-059 style). Cost is
  one scan per opened window, bounded by the live keys. Rejected: a periodic
  timer (adds a timer to the handler lifecycle); a constant cap on keys (a
  cap would refuse legitimate identities, a policy change not requested).
- **D-3 — Keep serving on accept-time errors (owner decision 2026-11-25),
  with a once-per-minute diagnostic.** Rejected: controlled shutdown (owner
  decision); logging every event (an `EMFILE` storm repeats per accept
  attempt and would flood the log).
- **D-4 — The disconnect signal reaches only the queue (owner decision
  2026-11-25), through `ctx.http.req`.** The disconnect is a separate
  signal from the SDK's `notifications/cancelled` signal: it is listened to
  only while the call waits and is never attached to the started
  invocation's cancel listener, so it cannot abort a read or a gate run
  that started. `serve` owns the disconnect controller and passes its
  signal to `handle()` as an explicit parameter; `sdkRequest` builds the
  SDK `Request` with no `signal` option and registers the disconnect
  signal in a `WeakMap<Request, AbortSignal>` keyed by that `Request`; the
  `toRequest` `Request` carries no signal either; the handlers look up
  `ctx.http?.req` in the map and pass the result to the controller next to
  `ctx.mcpReq.signal`. The map is GC-independent: its key is the very
  `Request` the SDK holds as `ctx.http.req` while it handles the call, so
  the entry exists whenever a handler can look it up, and its value is
  `serve`'s own signal, which `serve`'s closure holds until the response
  settles; no derived signal exists that could be collected. Because the
  SDK `Request` carries no live signal, the SDK's own `request.signal`
  handling (stateless path, `index.mjs:871`) can never react to a
  disconnect. Rejected: any derived-signal path. Measured in the dev
  container's Node v26.13.0 (2026-11-25, `node --expose-gc`, one bounded
  script): a `Request` built from another `Request` follows the parent's
  signal only while the parent is reachable; with the intermediate
  `Request` dropped and `gc()` run five times, aborting the original
  controller left the derived request's signal not aborted, while a
  `Request` given the controller's signal directly and kept referenced
  aborted. A two-hop chain (`toRequest` then `sdkRequest`) is therefore
  GC-dependent. The earlier path of this draft (the signal set directly on
  the SDK `Request`, kept strongly referenced by the router) was also
  rejected (73-spec-decision-1-fable #1): it relied on an untested
  reference whose loss would silently fall back to F-026 D-8, and it handed
  the SDK a live signal. No GC-forcing AC is added: a forced `gc()` does
  not guarantee collection, so such a test cannot be made deterministic;
  AC-14 instead pins the structure (explicit parameter, map lookup, no own
  signal aborted on either `Request`). The disconnect also listens on the
  socket's `close`: a pipelined HTTP/1.1 request whose response does not
  own the socket yet may never see its `ServerResponse` `close` or
  `finish`, and the socket listener is cheaper than excluding pipelined
  requests with a separate rule. One listener is shared per socket, so
  pipelined requests never exceed EventEmitter's default of 10 listeners
  (`MaxListenersExceededWarning`); it also settles the pending write wait
  of each unsettled request, so a queued response on a closed socket never
  keeps a `serve` promise in the in-flight set and never makes a later
  shutdown wait its full bound; it is removed once the socket has no
  unsettled request, so kept-alive sockets do not accumulate listeners.
  This reverses F-026 D-8 for queued calls; the
  reversal is recorded here and in the CHANGELOG, and F-026 (closed) is not
  edited. Measured in the installed
  `@modelcontextprotocol/server` 2.4.0 (read-only, dev container,
  2026-11-25): `WebStandardStreamableHTTPServerTransport.handlePostRequest`
  passes the request it received unchanged (`dist/index.mjs:500`) as
  `request` to `onmessage` (`:571-574`, `:616-620`); `buildContext` puts it
  on `ctx.http.req` (`dist/mcp-oHn3ureC.mjs:931-933`), typed
  `req?: globalThis.Request` (`dist/mcp-BCJHyo7l.d.mts:2254`);
  `ctx.mcpReq.signal` is a fresh `AbortController` per request
  (`dist/src-DdvbAHrR.mjs:6518-6531`), aborted only by
  `notifications/cancelled` (`:6350`) and transport close (`:6427-6436`),
  never from the request's signal; and the transport reads no
  `req.signal` (only the unused stateless handler does, `index.mjs:871`).
  The field is therefore clean and unlinked; AC-08 pins both facts, so an
  SDK upgrade that moves or links it fails the gate. Rejected: a
  per-session map keyed by JSON-RPC id set before `handleRequest`
  (SDK-independent, but more state and a duplicate-id case to define; kept
  as the fallback if AC-08 fails after an SDK upgrade); cancelling started
  reads too (owner decision); keeping F-026 D-8 (a queued write would run
  for a gone client).
- **D-6 — A non-2xx `initialize` after registration is a failure.**
  Measured in the same SDK source: after `onsessioninitialized`
  (`dist/index.mjs:539`) the transport catches its own failures and
  resolves non-2xx responses instead of throwing: 404 `-32001` when closed
  (`:547`), 500 `-32603` when `_checkScopeChallenge` throws (`:549-553`),
  and 400 `-32700` with `data: String(error)` for any other caught error
  (`:636-638`). The router today returns such a response as-is once the
  session is registered, so the session would leak. BR-164 v2 closes it
  and answers 500 `server_error`, which also keeps the SDK's
  `String(error)` out of the response. Rejected: forwarding the SDK
  response (leaks the session and possibly error text); excluding the case
  (it is reachable in the installed SDK).
- **D-5 — Count header lines from `rawHeaders` with `maxHeadersCount` 101.**
  Node truncates beyond `maxHeadersCount`, so a limit of 101 guarantees a
  request over 100 lines shows at least 101 pairs; the 16,384-byte limit still
  bounds parser memory. The check runs in the adapter before `handle()`,
  because the Fetch `Headers` object merges repeated names. Rejected:
  `maxHeadersCount` 100 (truncation would hide the excess); 0 (unlimited
  pairs kept); answering 400 (431 is the standard status).

## Open questions

## Stress-test

- 73-spec-review-1-opus #1 (major) — retained — BR-166 v2 and D-4 name the
  channel `ctx.http.req.signal`, measured in SDK 2.4.0 as passed unchanged
  and unlinked to `ctx.mcpReq.signal`; AC-08 pins both; the per-session map
  is recorded as the rejected fallback.
- 73-spec-review-1-opus #2 (major) — retained — AC-10 adds a started gate
  run held before its intent append; it must append intent, commit and
  audit as without a disconnect.
- 73-spec-review-1-opus #3 (major) — retained — BR-443's invariant is
  limited to a `take` that opens a window; AC-04's second case uses a fresh
  limiter (A at 0, B at 30,000, B again at 60,000, `size` 2).
- 73-spec-review-1-opus #4 (minor) — retained — the SDK source shows
  non-2xx answers after registration (D-6); BR-164 v2 closes the session
  on them too and answers 500; AC-01 adds a real-SDK case.
- 73-spec-review-1-opus #5 (minor) — retained — BR-444: an emit attempt
  starts the window even when the logger throws; negative elapsed time
  counts as 60,000 ms or more; AC-06 and AC-07 cover both.
- 73-spec-review-1-opus #6 (minor) — retained — BR-445 removes the
  disconnect listener in the BR-383 slot-take step; AC-08 adds a custom
  `resources/read` case (`-32000`) and the listener count.
- 73-spec-review-1-opus #7 (minor) — retained — Scope lists the controller
  parameter and the handlers that pass it; stdio passes none and is
  unchanged.
- 73-spec-review-2-opus #1 (major) — retained — measured in Node v26.13.0
  that a derived `Request` stops following its parent's signal once the
  parent is collected; BR-166 v2, Scope and D-4 now fix the path: `serve`
  creates the controller and passes its signal to `handle()`, `sdkRequest`
  sets it directly, `toRequest` carries none, the router holds the SDK
  request until its response settles; AC-14 pins the structure; no
  GC-forcing AC (not deterministic, D-4).
- 73-spec-review-2-opus #2 (minor) — retained — AC-06 adds an error at
  t=59,999 (suppressed, count 3) and the post-rewind `emfile` error now
  expects `{code:"other", suppressed:0}`.
- 73-spec-review-2-opus #3 (minor) — retained — AC-08 adds a
  `notifications/cancelled` case: `ctx.mcpReq.signal` aborts,
  `ctx.http.req.signal` does not.
- 73-spec-review-2-opus #4 (minor) — retained — BR-166 v2 also aborts on
  `req.socket` `close` while the response is unfinished, with listeners
  removed at settle; AC-14 tests a pipelined waiting call and listener
  cleanup on a kept-alive socket.
- 73-spec-review-2-opus #5 (minor) — retained — AC-13 requires each
  request's entire header block under 16,384 bytes (repeated empty `x:`
  lines).
- 73-spec-review-2-opus #6 (minor) — retained — Scope no longer edits
  F-026; the D-8 reversal is recorded only in D-4 and the CHANGELOG.
- 73-spec-decision-1-fable #1 (minor) — retained — the SDK request carries
  no signal; `sdkRequest` registers `serve`'s disconnect signal in a
  `WeakMap<Request, AbortSignal>` keyed by the SDK request and handlers
  resolve it from `ctx.http.req`; BR-166 v2, Scope, D-4, AC-08 and AC-14
  updated; D-4 records why the map is GC-independent and rejects the
  derived-signal and strong-reference paths.
- 73-spec-decision-1-fable #2 (minor) — retained — BR-166 v2: the socket
  `close` listener also settles each unsettled request's write wait; AC-14
  asserts every `serve` promise settles and the in-flight set is empty.
- 73-spec-decision-1-fable #3 (minor) — retained — BR-166 v2 uses one
  shared `close` listener per socket; AC-14 uses 12 pipelined requests and
  asserts at most one such listener and no process `warning`.
- 73-spec-decision-1-fable #4 (minor) — retained — Scope no longer edits
  F-012; 431 is recorded in BR-446, BR-167 v4 and `docs/oauth-proxy.md`
  only; one policy: no closed spec is edited.
- 73-spec-decision-1-fable #5 (minor) — retained — D-5 reads "at least 101
  pairs".
- 73-spec-review-4-opus #1 (minor) — retained — AC-14 now states the 4 waiting / 7 refused split under BR-381 v1, the socket destroyed after both, and cites BR-381 v1.

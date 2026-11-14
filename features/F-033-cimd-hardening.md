---
id: F-033
title: CIMD document handling hardened
ticket: "#26"
status: ready-for-freeze
version: 1
---

# F-033 — CIMD document handling hardened

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` (main `2b08013`).
IDs: F-033; BR-129 v6; BR-306 v2; BR-307 v2; BR-309 v2; BR-394 v2;
AC-01–AC-10. No ADR: one display check, one branch in the resolver, one byte
bound and four address ranges, nothing persisted, cheap to reverse.
Next free IDs checked on main (`docs/spec-index.md`, `business-rules/`):
F-033, BR-412, ADR-012.

## Context

F-028 (#3) lets a `proxy`-mode server accept Client ID Metadata Documents
(CIMD) from listed origins. Its decision pass left four residuals, collected
in #26. All four concern input that a CIMD host or a registering client
controls. Affected: every operator who lists a CIMD origin
(`oauthClientMetadataOrigins`), and every browser user who reads a consent
page.

1. **Name display.** `client_name` refuses only `\p{Cc}` (BR-308, BR-127).
   Format characters such as U+200B–U+200F, U+202A–U+202E and U+2066–U+2069
   pass. The consent page prints the name inside `<strong>` in a `<p>`
   followed by the "self-declared, unverified" suffix (`pages.ts`
   `consentPage`), so a U+202E in the name reverses the suffix on screen, and
   invisible characters make two different names look the same.
2. **Busy with a stale entry.** With four fetches in flight, `resolve` in
   `client-metadata.ts` answers `busy` (503 page) before it looks at a stale
   entry. A URL whose entry is stale but still usable gets the 503 page,
   although a transient fetch failure would have served the stale client.
3. **Header bytes.** `watchBodyBytes` in `client-metadata-fetch.ts`
   concatenates socket chunks (one `Buffer.concat` per chunk) until the first
   `\r\n\r\n`, and only the 5,000 ms deadline bounds that buffer: Node's
   header limit (16 KiB by default, then a `connection` failure) counts
   neither CR/LF bytes received before a status line nor whitespace after a
   header colon, and accepts 200,000 CR/LF bytes before a 200 status line,
   or 20,000 spaces after a header colon, without an error (probed on Node
   26.13.0, the production runtime). The watcher stops
   counting at the first `\r\n\r\n`, which can be an empty "block" before
   the status line or the end of an interim `1xx` block, so the final block
   can escape it. And Node's parser, whose `data` listener is attached
   before the request emits `socket`, sees each chunk before the watcher: a
   complete oversized block reaches the status and media-type checks first.
4. **Address ranges.** The BR-307 IPv4 list omits three entries of the IANA
   IPv4 Special-Purpose Address Registry: `192.31.196.0/24` (AS112-v4),
   `192.52.193.0/24` (AMT) and `192.175.48.0/24` (Direct Delegation AS112
   Service). The IPv6 list omits `2620:4f:8000::/48`, the IPv6 entry of the
   Direct Delegation AS112 Service, which lies inside `2000::/3`.

## Scope

- BR-129 v6: the consent page shows a client name that holds a
  bidirectional control (Bidi_Control), U+2028 or U+2029 as an unnamed
  client, for CIMD and registered clients.
- BR-309 v2: a usable stale entry is served before the in-flight cap check.
- BR-306 v2: each response header block, interim `1xx` blocks included, is
  bounded at 8,192 bytes, counted from the first received byte (CR/LF
  before a status line included) and checked before Node's parser and
  before the status, `Content-Type` and `Content-Encoding` checks; beyond
  that the fetch fails as `size`, terminal, status 0. The body count keeps
  its v1 order, after those checks. The request sets `maxHeaderSize`
  16,384.
- BR-307 v2: the four ranges above join the blocked lists.
- `docs/oauth-proxy.md`: the address-policy list, the in-flight cap
  sentence, the header bound and the accepted residual risks, each marked as
  F-033 pending acceptance.

### Out of scope

- Changing what registration (BR-127 v1) or document validation (BR-308 v1)
  accepts or stores: both keep their `\p{Cc}` refusal, and a CIMD document
  or registration with a format character in its name stays valid (D-1).
- Bidi isolation markup (`<bdi>`, `unicode-bidi: isolate`) on the consent
  page, and strong right-to-left letters in names (legitimate text).
- Names with format characters outside Bidi_Control (for example U+00AD,
  U+200B, U+200C, U+200D, U+FEFF or tag characters): shown as sent (D-1).
- CSS clipping of the name line (it would change the BR-401 CSP style
  hash); the overflow of stacked combining marks is an accepted residual
  (D-1).
- Any change to the body bound of BR-306, and to how Node handles an interim
  `1xx` response other than bounding its header block.
- IPv4 ranges that are not in the special-purpose registry (for example
  public anycast resolvers) and IPv6 entries already blocked (`2001::/23`
  holds `2001:4:112::/48` and `2001:3::/32`; everything outside `2000::/3`
  is blocked).
- Any new event name or `reason` value, and the state file (BR-292).

## Business rules

- **BR-129 v6** — v5 holds, except that a client name that contains a code point
  with the Unicode property Bidi_Control (the runtime's `\p{Bidi_Control}`:
  U+061C, U+200E, U+200F, U+202A–U+202E and U+2066–U+2069), U+2028 LINE
  SEPARATOR or U+2029 PARAGRAPH SEPARATOR is displayed exactly as an absent
  name: the page language's "unnamed client" text (BR-407), without the
  self-declared suffix and without any part of the name. This applies to CIMD
  clients and to registered clients alike, whether the client was registered in
  this process or loaded from the state file. Nothing else changes: the name is
  still accepted, stored, snapshotted and echoed in the registration response as
  before, the display logs no event of its own (a CIMD resolution still logs its
  one `client_metadata_fetched`), and the rest of the page (the BR-393 lines
  included) is unchanged. A name with any other format character (for example
  U+200B, U+200C, U+200D, U+00AD, U+FEFF or a tag character) is shown as sent,
  escaped and with the self-declared suffix, as under v5. Verified by:
  AC-01–AC-03.
- **BR-309 v2** — v1 holds, except that when an authorization request finds
  no fresh entry and no fetch in flight for its URL while 4 fetches are in
  flight, it is answered from that URL's stale entry when one exists and its
  stale end is not reached, exactly as a stale entry answers a transient
  failure; no fetch starts, no event is logged and the entry stays as it
  was. Only without such an entry does the request get the
  503 HTML error page with `client_metadata_refused` `busy`. Verified by:
  AC-04.
- **BR-306 v2** — v1 holds, except that every header block of the response
  has at most 8,192 bytes. The first block starts at the first received
  byte of the response, and each later block at the byte after the
  `\r\n\r\n` that ends an interim `1xx` block. A block's status line starts
  at its first byte that is neither CR nor LF, and the block ends with the
  first `\r\n\r\n` at or after that byte, inclusive. Every byte from the
  start of a block is counted, the CR and LF bytes before its status line
  and the whitespace in its header lines included; CR and LF bytes before a
  status line never end a block. Each interim `1xx` block and the final
  (non-`1xx`) block are bounded separately. The header bound is checked on
  each received chunk before Node's HTTP parser receives that chunk (the
  header watcher's `data` listener is added with `socket.prependListener`,
  since Node's client attaches its parser listener before it emits
  `socket`), and therefore before the status, `Content-Type` and
  `Content-Encoding` checks. As soon as more than 8,192 bytes of one block
  have been received and none of its first 8,192 completes it, the fetch
  fails as `size`, terminal, with `status` 0 (BR-394 v2), whatever status
  line the block starts with, and no further header byte is buffered. Only
  the header bound runs before the parser: the v1 body count starts after
  the final block and keeps its v1 order, after the status, `Content-Type`
  and `Content-Encoding` checks, so a response whose final block passes the
  header bound fails as `status` or `content_type` when those checks refuse
  it, whatever its body length and however its bytes are split, and
  otherwise still fails as `size` at the 5,121st body byte, after any
  interim block. The request sets Node's `maxHeaderSize` to 16,384 bytes,
  so Node's own limit stays above the bound whatever
  `--max-http-header-size` says. Verified by: AC-05, AC-06, AC-08–AC-10.
- **BR-307 v2** — v1 holds, except that the blocked IPv4 ranges also hold
  `192.31.196.0/24`, `192.52.193.0/24` and `192.175.48.0/24`, and the
  blocked IPv6 ranges inside `2000::/3` also hold `2620:4f:8000::/48`.
  Verified by: AC-07.
- **BR-394 v2** — v1 holds, except that the reasons with `status` 0 also
  include `size` from the BR-306 v2 header bound: it is decided before any
  status line is parsed, even when the oversized block starts with one (a
  503 or a 302 included). A `size` from the body bound keeps the received
  status (200). A terminal `size` deletes a stale entry and gives the 400
  page under BR-309. Verified by: AC-05, AC-06.

Existing rules this feature relies on without change:

- **BR-127 v1** and **BR-308 v1**: names with format characters are still
  accepted; only their display changes (BR-129 v6).
- **BR-393 v3** and **BR-407 v1**: the CIMD lines and the "unnamed client"
  catalogue texts are reused as they are.
- **BR-143 v4**: no new event or field; the header bound adds no logged text.

## Acceptance criteria

Proxy tests use the fake fetch port, clock and logger of
`tests/auth/proxy-cimd.test.ts`; fetch tests use the local TLS servers of
`tests/auth/cimd-fetch.test.ts`.

- **AC-01** (BR-129 v6) — Given a CIMD document whose `client_name` is `Pay`
  followed by each of U+061C, U+200E, U+200F, U+202A, U+202B, U+202C, U+202D,
  U+202E, U+2066, U+2067, U+2068, U+2069 (all twelve `\p{Bidi_Control}` code
  points), U+2028 or U+2029 and then `Pal`, When authorize resolves it with
  `lang=en` and with `lang=fr`, Then the consent page is 200, its name line
  holds `unnamed client` (`client sans nom`) and no self-declared suffix, the
  page contains neither `Pal` nor the character, the client ID, host and
  notice lines are present, and no event is logged other than the one
  `client_metadata_fetched` of the fetch. Verified by:
  `BR-129 v6 AC-01 a CIMD client_name with %s is shown as unnamed`.
- **AC-02** (BR-129 v6) — Given a registration with `client_name` `Pay`
  U+202E `laPyaP` (written with an escape in the test, never as a literal
  character), Then it gets 201 and the response echoes that name unchanged;
  When that client's authorization request is shown, Then the name line
  holds `unnamed client` and the page contains neither U+202E nor `laPyaP`;
  and given `oauthStateFile` set, When a proxy reopened from the file shows
  the same client's consent page, Then it is the same. Verified by:
  `BR-129 v6 AC-02 a registered client_name with a format character is shown
  as unnamed` in `tests/auth/proxy-consent.test.ts`.
- **AC-03** (BR-129 v6, BR-308 v1) — Given CIMD names `Café 日本`, `עברית`,
  `Claude`, and `Pay` followed by each of U+200B, U+200C, U+200D, U+00AD or
  U+FEFF and then `Pal`, Then each is shown escaped with the self-declared
  suffix as today, the format character included unchanged; and given a CIMD
  name holding U+0007, Then authorize gets the 400 page with
  `client_metadata_refused` `document`, as today. Verified by: `BR-129 v6 AC-03
  names without a bidi control or separator are unchanged`.
- **AC-04** (BR-309 v2) — Given URL `c5` resolved at `T` (fresh 300 s) and
  four other URLs with pending fetches, When `c5` is requested at
  `T + 300` s and at `T + 3,900` s − 1 ms, Then each gets the consent page of
  the cached client, the port is not called for `c5` and no event is logged;
  When a URL with no entry, or `c5` at `T + 3,900` s, is requested, Then each
  gets the 503 page with `client_metadata_refused` `busy` and no call; and
  given the same `c5` entry at `T + 300` s after the four fetches have
  settled, Then the `c5` request calls the port. Verified by:
  `BR-309 v2 AC-04 a stale entry is served while four fetches are pending`.
- **AC-05** (BR-306 v2, BR-394 v2) — Given a server whose 200 JSON response has
  a header block of exactly 8,192 bytes, also when sent in single-byte writes,
  Then the fetch succeeds, and so does `\r\n\r\n` followed by a 200 JSON block,
  8,192 bytes in total; Given one of 8,193 bytes, one that sends 20,000 header
  bytes without `\r\n\r\n` and then stalls, a 503 and a 302 response each with a
  header block of 8,193 bytes sent in one write, `\r\n\r\n` followed by a 200
  JSON block, 8,193 bytes in total, and 8,193 CR/LF bytes (`\r\n` pairs, then
  one CR) followed by a stall, Then each fails as `size`, terminal, status 0,
  before the 5,000 ms deadline and without a `connection` or `status` failure.
  Verified by: `BR-306 v2 AC-05 the header block is bounded at 8,192 bytes`.
- **AC-06** (BR-306 v2, BR-309 v2, BR-394 v2) — Given a cached client past its
  fresh end, When the refetch fails as `size`, terminal, status 0, Then
  authorize gets the 400 page with `client_metadata_refused` `size` status 0 and
  the entry is deleted (a later transient failure gives the 503 page). Verified
  by: `BR-306 v2 AC-06 a header overflow on refetch deletes the stale entry`.
- **AC-07** (BR-307 v2) — Given the production address policy, Then
  `192.31.196.1`, `192.52.193.1`, `192.175.48.1`, `192.175.48.255` and
  `2620:4f:8000::1` are blocked and `192.31.195.255`, `192.52.194.0`,
  `192.175.49.0` and `2620:4f:8001::1` are allowed; and Given a resolver
  answering `192.175.48.6`, Then the fetch fails as `blocked_address` without
  connecting. Verified by: `BR-307 blocks a sample inside %s` (rows added)
  and `BR-307 v2 AC-07 the added ranges are blocked, their neighbours
  allowed` in `tests/auth/cimd-address.test.ts`.
- **AC-08** (BR-306 v2) — Given a child process started with
  `NODE_OPTIONS=--max-http-header-size=4096` (spawned with
  `process.execPath` and a helper `tests/helpers/cimd-header-child.mjs`, as
  the proxy-variable child test of `tests/auth/cimd-fetch.test.ts` does),
  When its production port fetches a 200 JSON response with a header block of
  8,192 bytes and then one of 8,193 bytes, Then the first succeeds and the
  second fails as `size`, terminal, status 0, not as `connection`. Verified
  by: `BR-306 v2 AC-08 the 8,192-byte header bound decides with
  --max-http-header-size=4096 in a child process` in
  `tests/auth/cimd-fetch.test.ts`.
- **AC-09** (BR-306 v2) — Given a server that sends an interim
  `103 Early Hints` block and then a 200 JSON response whose final header
  block has 8,193 bytes, Then the fetch fails as `size`, terminal, status 0;
  given an interim block of 8,193 bytes, Then the same; and given an interim
  block of 8,192 bytes followed by a final 200 JSON block of 8,192 bytes,
  Then the fetch succeeds (each block is bounded on its own); and given an
  interim `103` block followed by a 200 JSON response with `Content-Length:
  10` and 5,121 body bytes, Then the fetch fails as `size` (the body count
  starts after the final block); and given an interim `103` block, then
  `\r\n\r\n`, then a final 200 JSON block, the `\r\n\r\n` and the final
  block totalling 8,193 bytes, Then the fetch fails as `size`, terminal,
  status 0 (the CR/LF bytes are counted in the final block). Verified by:
  `BR-306 v2 AC-09 each interim and final header block is bounded at 8,192
  bytes` in `tests/auth/cimd-fetch.test.ts`.
- **AC-10** (BR-306 v2) — Given a server whose 200 `text/html` response has
  `Content-Length: 6000` and a 6,000-byte body, sent once in one write and
  once as the header block and then the body in separate writes, Then each
  fetch fails as `content_type`, terminal, with `status` 200, never as
  `size`; and given a 503 response with a 6,000-byte body in one write, Then
  it fails as `status`, transient, with `status` 503. Verified by:
  `BR-306 v2 AC-10 the body bound runs after the status and media-type
  checks` in `tests/auth/cimd-fetch.test.ts`.

## Decisions

- **D-1 — Bidi controls and separators shown as absent, not refused.**
  Bidirectional controls and U+2028/U+2029 are what lets a name reorder or
  break the consent line; the name is self-declared and secondary to the
  client ID and host (BR-393), and the consent page already has an "unnamed
  client" line. Other format characters change no order outside the name
  and are legitimate in real names (U+200C in Persian, U+200D in emoji
  sequences, tag characters in flag emoji), so they are shown as sent.
  Rejected: all of `\p{Cf}` (shows working names such as emoji sequences as
  unnamed for no reordering threat); refusing the document or registration
  (locks out a working client over a display detail); stripping the
  characters (shows a name the client did not send); checking at intake
  under BR-308 and BR-127 (misses registered clients already in the state
  file, and needs two rule changes instead of one); clipping the name line
  in CSS (changes the BR-401 CSP style hash for a display detail). Accepted
  residuals, listed in `docs/oauth-proxy.md`: a name of up to 200 combining
  marks can draw over the client ID and host lines, and two names that differ
  only by invisible characters look the same, as look-alike letters already
  allow.
- **D-2 — Registered clients included.** The same name line shows a
  registered client's `client_name`, and open registration (BR-127) lets any
  caller with an allowlisted redirect URI choose it, so the risk is the same.
- **D-3 — Stale before the cap.** The cap protects the fetch slots; a stale
  use takes none and already answers a transient failure, so `busy` is
  treated as one more transient condition. Rejected: queueing for a slot
  (holds a request open on an unauthenticated route). Accepted residual,
  listed in `docs/oauth-proxy.md`: any unauthenticated requester can hold
  the four slots (four slow or parallel URLs on listed origins), so a third
  party can defer the refetch of a cached document, which may have changed
  or been withdrawn, until its stale end, at most 3,600 s past its fresh
  end. Under v1 the same requester denies that client with the 503 page
  instead.
- **D-4 — 8,192 bytes per header block, checked first, `size` terminal.** `size`
  is terminal for consistency with the body bound of BR-306: an oversized
  response fails the same way whether its headers or its body pass the bound.
  The count runs on raw bytes before Node's parser sees a chunk, so an oversized
  block gives `size`, status 0, whatever its status line and however its bytes
  are split, never `status` or `content_type` depending on the chunking. The
  count starts at the first received byte, since Node skips CR/LF bytes before a
  status line without counting them. Only the header bound moves ahead of the
  parser: the body count stays after the status and media-type checks, so a
  refused status or media type is reported as such whatever the body length and
  chunking (AC-10). 8,192 is far above the headers a static document host sends,
  and `maxHeaderSize` 16,384 on the request keeps Node's limit above it whatever
  `--max-http-header-size` says. Each interim `1xx` block is bounded too, so no
  block escapes the bound by following an interim one. `status` 0 is stated in
  BR-394 v2 since no status was parsed; BR-394 is versioned (AGENTS.md: a new
  case) because its v1 list of status-0 reasons does not name `size`. Rejected:
  `connection` transient (what Node's limit gives today; it would treat
  oversized headers unlike an oversized body); relying on Node's `maxHeaderSize`
  and mapping `HPE_HEADER_OVERFLOW` to `size` (Node counts neither CR/LF bytes
  before a status line nor whitespace after a header colon, so it bounds neither
  the watcher's buffer nor the block); checking after the status (the outcome
  would depend on chunking); one cumulative bound over all blocks (no added
  protection: a finished interim block is not kept, and the 5,000 ms deadline
  ends the fetch); a new `reason` value (a new BR-394 reason and a BR-143
  change, for a diagnostic only).
- **D-5 — Only registry entries.** The three IPv4 blocks are the remaining
  entries of the IANA IPv4 Special-Purpose Address Registry (RFC 7535,
  RFC 7450, RFC 7534 and RFC 6890 as updated); `2620:4f:8000::/48` is the
  same service's IPv6 entry. They are anycast infrastructure that never
  serves a client metadata document, and an anycast address reaches whichever
  local operator announces it. Rejected: adding public anycast services
  outside the registry (no stable list).
- **D-6 — No ADR** (no dependency, nothing persisted, cheap to reverse).

## Open questions

None.

## Stress-test

Spec review 1 (`26-spec-review-1-reviewer`, changes); all findings
retained:

- (major) The header bound ran after Node's parser, so an oversized 503 or
  302 sent in one write was answered as `status`. Retained: BR-306 v2 checks
  every block before the parser and the status, `Content-Type` and
  `Content-Encoding` checks, always `size` status 0; AC-05 rows added;
  BR-394 wording reworded.
- (minor) Node's limit follows `--max-http-header-size`. Retained:
  `maxHeaderSize` 16,384 on the request; AC-08 runs in a child process.
- (minor) D-4 gave no sound reason for terminal, and `1xx` blocks escaped
  the bound. Retained: consistency with the body bound; every block bounded;
  AC-09.
- (minor) AC-02 held a literal U+202E. Retained: written as `Pay` U+202E
  `laPyaP`; the diff holds no literal bidi or format character.
- (minor) `\p{Cf}` hid legitimate names. Retained: Bidi_Control plus U+2028
  and U+2029 (D-1, AC-01, AC-03); no CSS clipping, combining marks recorded
  as a residual.
- (minor) `docs/oauth-proxy.md` was stale. Retained: added to the scope.

Spec review 2 (`26-spec-review-2-reviewer`, approve with minors):

- (minor) The body count was lost after an interim block. Retained: BR-306
  v2 starts it after the final block; AC-09 row.
- (minor) AC-01 tested 7 of 12 Bidi_Control code points. Retained: all 12.
- (minor) BR-394's status-0 list did not name `size`. Retained after spec
  review 3: BR-394 v2.

Spec review 3 (`26-spec-review-3-reviewer`, approve with minors):

- (minor) Versioning BR-394 versus a reading note. Retained: BR-394 v2
  (D-4, AC-05).
- (minor) Paragraphs not reflowed. Retained: reflowed.
- (minor) BR-306 v2 in the spec and in its record differed. Retained: the
  spec's server reference dropped; both now match.

Spec review 4 (`26-spec-review-4-reviewer`, approve once the minors are
fixed):

- (minor) The BR-394 v2 event is asserted by AC-06, not AC-05. Retained:
  AC-06 tagged BR-394 v2; verified by AC-05 and AC-06.
- (minor) D-4's rejected new `reason` wording. Retained: reworded.
- (minor) A `size` note sat under the unchanged rules. Retained: moved into
  BR-394 v2.
- (minor) Lines over 80 columns or not reflowed; a loose list. Retained:
  reflowed; blank line removed.

Spec decision pass (`26-spec-decision-1-fable`, changes); all findings
retained:

- (major) Bytes before a status line were outside every block: Node skips
  CR/LF there without counting it, so a watcher ending a block at the first
  `\r\n\r\n` stopped bounding. Retained: BR-306 v2 counts from the first
  received byte and from the byte after each interim block, CR/LF before a
  status line counted and never ending a block (probed on Node 26.13.0);
  AC-05 rows (`\r\n\r\n` with a 200 block, 8,192 and 8,193 bytes; 8,193
  CR/LF bytes then a stall) and an AC-09 row.
- (major) Prepending the watcher also moved the body count ahead of the
  parser, so a 200 `text/html` response with a 6,000-byte body in one write
  gave `size` instead of `content_type`. Retained: only the header bound
  runs before the parser; the body count keeps its v1 order (BR-306 v2,
  D-4); AC-10.
- (minor) Context 3 and D-4 said Node's limit bounds the watcher's buffer.
  Retained: only the deadline does; D-4 rejects relying on `maxHeaderSize`
  and mapping `HPE_HEADER_OVERFLOW`.
- (minor) AC-01 and BR-129 v6 said no event is logged, but the resolution
  logs `client_metadata_fetched`. Retained: reworded in both; AC-02 and
  AC-03 make no event claim and are unchanged.
- (minor) `busy` can be induced by any unauthenticated requester, which
  lets a third party defer a refetch until the stale end. Retained: D-3
  kept; the residual recorded in D-3 and `docs/oauth-proxy.md`.

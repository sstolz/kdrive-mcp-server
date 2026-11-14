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
IDs: F-033; BR-129 v6; BR-306 v2; BR-307 v2; BR-309 v2; AC-01–AC-07. No ADR:
one display check, one branch in the resolver, one byte bound and four
address ranges, nothing persisted, cheap to reverse.
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
   concatenates socket chunks until `\r\n\r\n`. Only Node's header limit
   (16 KiB by default, then a `connection` failure) and the 5,000 ms deadline
   bound that buffer.
4. **Address ranges.** The BR-307 IPv4 list omits three entries of the IANA
   IPv4 Special-Purpose Address Registry: `192.31.196.0/24` (AS112-v4),
   `192.52.193.0/24` (AMT) and `192.175.48.0/24` (Direct Delegation AS112
   Service). The IPv6 list omits `2620:4f:8000::/48`, the IPv6 entry of the
   Direct Delegation AS112 Service, which lies inside `2000::/3`.

## Scope

- BR-129 v6: the consent page shows a client name that holds a format or
  separator character as an unnamed client, for CIMD and registered clients.
- BR-309 v2: a usable stale entry is served before the in-flight cap check.
- BR-306 v2: the response header block is bounded at 8,192 bytes; beyond
  that the fetch fails as `size`, terminal, status 0.
- BR-307 v2: the four ranges above join the blocked lists.

### Out of scope

- Changing what registration (BR-127 v1) or document validation (BR-308 v1)
  accepts or stores: both keep their `\p{Cc}` refusal, and a CIMD document
  or registration with a format character in its name stays valid (D-1).
- Bidi isolation markup (`<bdi>`, `unicode-bidi: isolate`) on the consent
  page, and strong right-to-left letters in names (legitimate text).
- Interim `1xx` responses in the byte watcher, Node's own header limit, and
  any change to the body bound of BR-306.
- IPv4 ranges that are not in the special-purpose registry (for example
  public anycast resolvers) and IPv6 entries already blocked (`2001::/23`
  holds `2001:4:112::/48` and `2001:3::/32`; everything outside `2000::/3`
  is blocked).
- Any new event name or `reason` value, and the state file (BR-292).

## Business rules

- **BR-129 v6** — v5 holds, except that a client name that contains a code
  point of general category `Cf` (the runtime's `\p{Cf}`), U+2028 LINE
  SEPARATOR or U+2029 PARAGRAPH SEPARATOR is displayed exactly as an absent
  name: the page language's "unnamed client" text (BR-407), without the
  self-declared suffix and without any part of the name. This applies to CIMD
  clients and to registered clients alike, whether the client was registered
  in this process or loaded from the state file. Nothing else changes: the
  name is still accepted, stored, snapshotted and echoed in the registration
  response as before, no event is logged, and the rest of the page (the
  BR-393 lines included) is unchanged. Verified by: AC-01–AC-03.
- **BR-309 v2** — v1 holds, except that when an authorization request finds
  no fresh entry and no fetch in flight for its URL while 4 fetches are in
  flight, it is answered from that URL's stale entry when one exists and its
  stale end is not reached, exactly as a stale entry answers a transient
  failure; no fetch starts, no event is logged and the entry stays as it
  was. Only without such an entry does the request get the
  503 HTML error page with `client_metadata_refused` `busy`. Verified by:
  AC-04.
- **BR-306 v2** — v1 holds, except that the header block of the response
  (the bytes from the first response byte through the `\r\n\r\n` that ends
  the headers, inclusive) has at most 8,192 bytes. As soon as more than
  8,192 bytes have been received and none of the first 8,192 completes the
  block, the fetch fails as `size`, terminal, with `status` 0 (no response
  status was parsed), and no further header byte is buffered. The bound runs
  before Node's own header limit (16,384 bytes by default) can apply.
  Verified by: AC-05, AC-06.
- **BR-307 v2** — v1 holds, except that the blocked IPv4 ranges also hold
  `192.31.196.0/24`, `192.52.193.0/24` and `192.175.48.0/24`, and the
  blocked IPv6 ranges inside `2000::/3` also hold `2620:4f:8000::/48`.
  Verified by: AC-07.

Existing rules this feature relies on without change:

- **BR-127 v1** and **BR-308 v1**: names with format characters are still
  accepted; only their display changes (BR-129 v6).
- **BR-393 v3** and **BR-407 v1**: the CIMD lines and the "unnamed client"
  catalogue texts are reused as they are.
- **BR-394 v1**: `size` is an existing `reason`; its `status` is 0 because no
  response status was received. A terminal `size` deletes a stale entry and
  gives the 400 page under BR-309.
- **BR-143 v4**: no new event or field; the header bound adds no logged text.

## Acceptance criteria

Proxy tests use the fake fetch port, clock and logger of
`tests/auth/proxy-cimd.test.ts`; fetch tests use the local TLS servers of
`tests/auth/cimd-fetch.test.ts`.

- **AC-01** (BR-129 v6) — Given a CIMD document whose `client_name` is
  `Pay` followed by each of U+00AD, U+200B, U+200E, U+202E, U+2066, U+FEFF,
  U+2028 or U+2029 and then `Pal`, When authorize resolves it with `lang=en`
  and with `lang=fr`, Then the consent page is 200, its name line holds
  `unnamed client` (`client sans nom`) and no self-declared suffix, the page
  contains neither `Pal` nor the character, the client ID, host and notice
  lines are present, and no event is logged. Verified by:
  `BR-129 v6 AC-01 a CIMD client_name with %s is shown as unnamed`.
- **AC-02** (BR-129 v6) — Given a registration with `client_name`
  `Pay‮laPyaP`, Then it gets 201 and the response echoes that name
  unchanged; When that client's authorization request is shown, Then the
  name line holds `unnamed client` and the page contains neither U+202E nor
  `laPyaP`; and
  given `oauthStateFile` set, When a proxy reopened from the file shows the
  same client's consent page, Then it is the same. Verified by:
  `BR-129 v6 AC-02 a registered client_name with a format character is shown
  as unnamed` in `tests/auth/proxy-consent.test.ts`.
- **AC-03** (BR-129 v6, BR-308 v1) — Given CIMD names `Café 日本`, `עברית`
  and `Claude`, Then each is shown escaped with the self-declared suffix as
  today; and given a CIMD name holding U+0007, Then authorize gets the 400
  page with `client_metadata_refused` `document`, as today. Verified by:
  `BR-129 v6 AC-03 names without format characters are unchanged`.
- **AC-04** (BR-309 v2) — Given URL `c5` resolved at `T` (fresh 300 s) and
  four other URLs with pending fetches, When `c5` is requested at
  `T + 300` s and at `T + 3,900` s − 1 ms, Then each gets the consent page of
  the cached client, the port is not called for `c5` and no event is logged;
  When a URL with no entry, or `c5` at `T + 3,900` s, is requested, Then each
  gets the 503 page with `client_metadata_refused` `busy` and no call; and
  given the same `c5` entry at `T + 300` s after the four fetches have
  settled, Then the `c5` request calls the port. Verified by:
  `BR-309 v2 AC-04 a stale entry is served while four fetches are pending`.
- **AC-05** (BR-306 v2) — Given a server whose 200 JSON response has a
  header block of exactly 8,192 bytes, also when sent in single-byte writes,
  Then the fetch succeeds; Given one of 8,193 bytes, and one that sends
  20,000 header bytes without `\r\n\r\n` and then stalls, Then each fails as
  `size`, terminal, status 0, before the 5,000 ms deadline and without a
  `connection` failure. Verified by:
  `BR-306 v2 AC-05 the header block is bounded at 8,192 bytes`.
- **AC-06** (BR-306 v2, BR-309 v2) — Given a cached client past its fresh
  end, When the refetch fails as `size`, terminal, status 0, Then authorize
  gets the 400 page with `client_metadata_refused` `size` status 0 and the
  entry is deleted (a later transient failure gives the 503 page). Verified
  by: `BR-306 v2 AC-06 a header overflow on refetch deletes the stale entry`.
- **AC-07** (BR-307 v2) — Given the production address policy, Then
  `192.31.196.1`, `192.52.193.1`, `192.175.48.1`, `192.175.48.255` and
  `2620:4f:8000::1` are blocked and `192.31.195.255`, `192.52.194.0`,
  `192.175.49.0` and `2620:4f:8001::1` are allowed; and Given a resolver
  answering `192.175.48.6`, Then the fetch fails as `blocked_address` without
  connecting. Verified by: `BR-307 blocks a sample inside %s` (rows added)
  and `BR-307 v2 AC-07 the added ranges are blocked, their neighbours
  allowed` in `tests/auth/cimd-address.test.ts`.

## Decisions

- **D-1 — Display the name as absent, not refuse the document.** Format
  characters are legitimate in real names (U+200C in Persian, U+200D in
  emoji sequences), the name is self-declared and secondary to the client
  ID and host (BR-393), and the consent page already has an "unnamed client"
  line. Rejected: refusing the document or registration (locks out a
  working client over a display detail and makes `\p{Cc}` and `\p{Cf}`
  behave alike only by making both fatal); stripping the characters (shows a
  name the client did not send and still lets invisible characters merge
  two names); checking at intake under BR-308 and BR-127 (misses registered
  clients already in the state file, and needs two rule changes instead of
  one). U+2028 and U+2029 are added because they are bidi paragraph
  separators that can break the line; other `Z` and `C` categories are not
  needed by the threat.
- **D-2 — Registered clients included.** The same name line shows a
  registered client's `client_name`, and open registration (BR-127) lets any
  caller with an allowlisted redirect URI choose it, so the risk is the same.
- **D-3 — Stale before the cap.** The cap protects the fetch slots; a stale
  use takes none and already answers a transient failure, so `busy` is
  treated as one more transient condition. Rejected: queueing for a slot
  (holds a request open on an unauthenticated route).
- **D-4 — 8,192 header bytes, `size` terminal.** 8,192 is below Node's
  16,384 default, so the outcome is decided by this rule and never by a race
  with the parser, and far above the headers a static document host sends.
  `size` is the existing reason for an oversized response and is terminal
  like the body bound; `status` 0 follows BR-394 since no status was parsed.
  Rejected: `connection` transient (what Node's limit gives today; it would
  keep serving a stale entry from a host that misbehaves on purpose); a new
  `reason` value (BR-394 and BR-143 changes for a diagnostic only).
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

Pending spec review.

---
id: F-028
title: Client ID Metadata Documents in the OAuth proxy
ticket: "#3"
status: draft
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `254d5da` (main `75c9f48`).
IDs: F-028; BR-291 and BR-305–BR-311 v1 (reserved for this work by F-019 and
`docs/spec-index.md`; the archive ticket that reserved them was archive issue
109, now this repository's `#3`); BR-393–BR-395 v1; BR-023 v3, BR-024 v4,
BR-125 v2, BR-128 v3, BR-129 v2, BR-136 v2, BR-143 v3, BR-295 v2, BR-302 v2;
ADR-011 (proposed). The design starts from the reviewed CIMD section of an
earlier F-019 draft (archive, parent of the commit that split it off) and
resolves the findings of that draft's decision pass listed in the ticket.

## Context

The OAuth proxy (`OAUTH_MODE=proxy`, F-010, F-012, F-019) issues its own
tokens to MCP clients. Today a client gets a `client_id` only through dynamic
client registration (`POST /oauth/register`, BR-127). With F-019 the
registration survives a restart when `OAUTH_STATE_FILE` is set, but every new
client installation still registers, and the store holds up to 1,000
registered clients.

The current MCP authorization specification (version 2026-07-28, page
"Client Registration") ranks Client ID Metadata Documents (CIMD) before
dynamic registration and marks dynamic registration deprecated: a client
whose `client_id` is an `https` URL publishes its metadata at that URL, and
the authorization server fetches it. The MCP text cites
`draft-ietf-oauth-client-id-metadata-document-00`; the MCP `draft` revision
cites `-03`, the latest IETF draft (tagged 2026-11-02). Both texts were read
for this spec from their source repositories (MCP specification repository
`main` at `0175d20`, 2026-11-13; IETF draft repository tag
`draft-ietf-oauth-client-id-metadata-document-03`); Deviations lists every
point where this spec differs.

The client matrix (`docs/mcp-client-compatibility.md`, checked 2026-11-02)
lists CIMD as supported by claude.ai, Claude iOS, Claude Desktop, ChatGPT and
Codex, and states that claude.ai uses CIMD whenever the metadata sets
`client_id_metadata_document_supported` and lists `none`. The matrix
documents no fallback to dynamic registration once CIMD is advertised, and
no client documents the origin of its metadata document.

Fetching a URL named by an unauthenticated authorization request is a
server-side request forgery (SSRF) primitive. The proxy runs next to the
operator's private network and, through `OAUTH_STATE_FILE`, holds refresh
families. CIMD therefore stays off by default and is limited to operator-listed
origins, and every fetch is bounded.

Users affected: the operator (one new setting, a discovery procedure, a store
format change that is reversible while no CIMD family exists) and MCP clients
that support CIMD (no stored registration). Clients without CIMD are
unchanged.

## Scope

1. A new proxy-only setting `oauthAllowedClientIdOrigins`
   (`OAUTH_ALLOWED_CLIENT_ID_ORIGINS`), default empty. Empty keeps today's
   behaviour exactly: no CIMD advertisement, every `https` client ID unknown.
2. With a nonempty list: the metadata advertises CIMD; an authorization
   request whose `client_id` is an acceptable `https` URL under a listed origin
   makes the proxy fetch and validate the document, then continue the existing
   flow (consent, upstream login, code) with the document's allowed redirect
   URIs and grants.
3. The fetch: https only, one DNS resolution, every resolved address checked
   against an address policy, connection pinned to the checked addresses, a
   dedicated agent that ignores proxy variables, no redirect, 5,120 bytes,
   5,000 ms, at most four concurrent fetches, and a bounded in-memory cache.
4. Token endpoint: a CIMD client authenticates with method `none`; codes and
   refresh families work as for a registered public client; no fetch at the
   token endpoint.
5. Persistence: CIMD families are stored like other families, with the URL as
   client ID and no client row (store format version 2, ADR-011). Removing an
   origin from the list cuts its clients off at once at the token endpoint and
   purges their families at the next startup.
6. Logging, consent display and operator documentation, including the origin
   discovery procedure and the "every client switches" warning.

### Out of scope

- Multi-instance deployments (F-019 single-instance restriction stands).
- The `delegate` and `delegate-static` OAuth modes.
- `private_key_jwt` and any client authentication other than `none` for CIMD
  clients; `jwks` and `jwks_uri` are ignored.
- Fetching any URL referenced inside a document (`logo_uri`, `jwks_uri`,
  `client_uri`, `policy_uri`, `tos_uri`); they are never fetched, displayed or
  stored.
- `software_statement` and pushed authorization requests (the proxy has no
  PAR endpoint).
- Revoking families when a refetched document changes or mismatches (D-7).
- Per-client advertisement of CIMD (the metadata is one document).
- Removing or changing dynamic registration (BR-127 unchanged).

## Business rules

### Configuration

- **BR-291** — The F-002 setting `oauthAllowedClientIdOrigins` (environment
  `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`, comma-separated like the other list
  settings; option `--oauth-allowed-client-id-origins`; YAML
  `oauthAllowedClientIdOrigins`) is an optional list, default empty, of at
  most 16 distinct entries of at most 1,024 characters. Each entry is
  `https://<host>` or `https://<host>:<port>` where `<host>` is a lowercase DNS
  name of at least two labels (not an IP literal, not `localhost`, no trailing
  dot) and `<port>` is 1–65535 without a leading zero and other than `443`,
  with no path, trailing slash, userinfo, query or fragment; any other entry is
  refused with `INVALID_VALUE`. It is accepted only with transport `http`,
  authentication on and OAuth mode `proxy` (the BR-290 restriction); otherwise
  `CONFLICTING_SETTINGS`. An entry equal to the origin of `publicUrl` or of
  `oauthIssuer` is refused with `CONFLICTING_SETTINGS`. Verified by: AC-01.

### Client ID Metadata Documents

- **BR-305** — A `client_id` that starts with `https://` is a CIMD client ID.
  It is acceptable only when: it has at most 1,024 bytes; its WHATWG URL
  serialization is byte-identical to it; it has no userinfo, query or
  fragment; its host is a DNS name (not an IP literal); its path is not `/`
  and has no `.` or `..` segment, also percent-encoded (`%2e`, `%2E`); it is
  not byte-identical to the proxy issuer, the audience or the upstream issuer;
  and its origin (`https://host[:port]`, port omitted when 443) is
  byte-identical to an entry of the current `oauthAllowedClientIdOrigins`. At
  the authorize handler a CIMD client ID that is not acceptable, or any CIMD
  client ID while the list is empty, is an unknown client: 400 HTML error page,
  no redirect, no fetch (BR-128 v3). A `client_id` that does not start with
  `https://` is looked up among registered clients as today. Verified by:
  AC-02.
- **BR-306** — The proxy fetches an acceptable CIMD client ID with one HTTPS
  `GET` to that exact URL with `Accept: application/json`, no cookie, no
  `Authorization` header and no other credential, verifying the certificate
  for the URL host against Node's default CA store, on the URL port (443 when
  absent). The request uses a dedicated `https.Agent` created without
  `proxyEnv`, so `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY` and
  `NO_PROXY` have no effect on it, with keep-alive off. The host is resolved
  exactly once, with `all: true`; every returned address is checked under
  BR-307, and if any is blocked, or the resolution returns no address, the
  fetch fails without connecting. Otherwise the agent's `lookup` returns only
  the checked addresses, and no second resolution happens for this fetch. The
  fetch succeeds only with status 200 (no redirect is followed; every other
  status fails), a `Content-Type` media type `application/json` or
  `application/<name>+json` (parameters ignored, case-insensitive), a body of
  at most 5,120 bytes (reading stops and fails at the 5,121st byte, whatever
  `Content-Length` says) and completion within 5,000 ms from the start of the
  resolution. A failure is transient when the resolution fails, the
  connection or TLS handshake does not complete for a reason other than a
  certificate verification failure, the 5,000 ms elapse, or the status is 429
  or 5xx; every other failure is terminal. Verified by: AC-03.
- **BR-307** — An address is allowed only when it is (a) an IPv4 address
  outside every range of Contract details "Blocked IPv4 ranges", or (b) an IPv6
  address inside `2000::/3` and outside every range of Contract details
  "Blocked IPv6 ranges". Every other IPv6 address is blocked, which includes
  the unspecified and loopback addresses, IPv4-mapped (`::ffff:0:0/96`),
  IPv4-translated (`::ffff:0:0:0/96`), IPv4-compatible (`::/96`), the NAT64
  prefixes `64:ff9b::/96` and `64:ff9b:1::/48`, unique-local, link-local,
  site-local and multicast addresses, whatever address they embed. Verified
  by: AC-04.
- **BR-308** — A fetched body is a valid document when it is a JSON object
  (UTF-8, no byte-order mark) such that: `client_id` is byte-identical to the
  fetched URL; it has no `client_secret` and no `client_secret_expires_at`
  member; the token endpoint method resolves to `none` (when
  `token_endpoint_auth_methods_supported` is present it is an array of strings
  that contains `none`; otherwise `token_endpoint_auth_method` is absent or
  `none`; when both are present the singular value is in the array);
  `redirect_uris` is a nonempty array of strings of which at least one matches
  an entry of the current `oauthAllowedRedirectUris` under BR-126;
  `grant_types` is absent (meaning `authorization_code` and `refresh_token`)
  or an array of strings that contains `authorization_code`; `response_types`
  is absent or an array of strings that contains `code`; `client_name` is
  absent or a string of 1–200 characters without control characters.
  Redirect URIs that match no allowlist entry, and grant and response types
  other than `authorization_code`, `refresh_token` and `code`, are ignored,
  not refused. The client used by the authorization request has the matching
  redirect URIs (at most the first 10 in document order), the kept grant
  types and the name; every other member is ignored and never stored, logged
  or displayed. An invalid document is a terminal failure. Verified by:
  AC-05.
- **BR-309** — Resolution results are cached in memory only, keyed by URL, at
  most 100 entries. A valid document is fresh for its `Cache-Control`
  `max-age` clamped to 60–3,600 s, for 300 s without `max-age`, and for 60 s
  with `no-store`, `no-cache` or `max-age=0`; `Expires` is ignored. A failure
  is never cached. While fresh, an entry is used without fetching. After it
  expires it is kept for 3,600 s more as a stale entry that is used only when
  the refetch fails transiently; a terminal failure deletes it. When a new
  entry would exceed 100, the entry that would be discarded first (stale end
  for stale entries, freshness end plus 3,600 s otherwise) is evicted. At most
  one fetch per URL is in flight (concurrent authorization requests for that
  URL share it) and at most 4 fetches in total; an authorization request that
  would start a fifth gets the 503 HTML error page without fetching. A
  transient failure with no usable stale entry gives the 503 HTML error page;
  a terminal failure gives the 400 HTML error page; neither redirects.
  Verified by: AC-06.
- **BR-310** — At the token endpoint a CIMD client ID is authenticated with
  method `none` only: it is presented as `client_id` in the body, without
  `client_secret` and without Basic, and it is acceptable under BR-305 with the
  current configuration; otherwise 401 `invalid_client` (BR-136 v2). No
  document is fetched at the token endpoint. `authorization_code` is allowed
  when the code is bound to that client ID; a code yields a refresh token only
  when the document used at authorization kept `refresh_token`;
  `refresh_token` is allowed for families of that client ID. Removing an
  origin from the list (and restarting) therefore refuses every code and
  refresh token of its clients from the first request. Verified by: AC-07.
- **BR-311** — A CIMD client is never stored as a registered client and never
  counts against the client bound; its refresh families are stored with the
  URL as client ID and count against the family bound (BR-303). The store
  format becomes version 2 (Contract details, ADR-011): the version 1 schema
  unchanged, with the family row rule extended so that a family's
  `client_id` either names a client row or is a CIMD client ID meeting the
  syntax checks of BR-305 (all except the origin, issuer and audience checks)
  with no client row. A committed transaction that inserts a CIMD family sets
  `user_version` to 2 in that transaction; the startup transaction (BR-295 v2
  step (11)) sets it to 2 when a CIMD family remains after the purge and to 1
  otherwise. After a restart a CIMD client refreshes without any fetch.
  Verified by: AC-08.

### Display, logging and documentation

- **BR-393** — The consent page of a CIMD client shows, before the
  self-declared name, the client ID URL and on its own line its host
  (`Client host: <host>`), both HTML-escaped; it states that the name comes
  from the client's metadata document and is unverified; and when every
  redirect URI of the request is an `http` loopback URI it shows the line
  `This client redirects to this computer only (loopback).` The page of a
  registered client is unchanged. Verified by: AC-09.
- **BR-394** — The proxy adds the event `client_metadata_refused` (handler
  `authorize`, fields `reason` and `status`) logged once per refused CIMD
  authorization request, with `reason` one of `not_allowed` (BR-305),
  `blocked_address`, `resolution`, `connection`, `certificate`, `timeout`,
  `status`, `content_type`, `size`, `document` (BR-306–BR-308) or `busy`
  (BR-309), and the event `client_metadata_fetched` (fields `status` and
  `count`, where `count` is the number of cache entries) logged once per
  completed successful fetch. `reason` joins the BR-143 field list. No event,
  response, page other than the consent page, or thrown message contains a
  CIMD URL, host, resolved address, document member or TLS error text.
  Verified by: AC-10.
- **BR-395** — `docs/oauth-proxy.md` gains a section "Client ID Metadata
  Documents (`OAUTH_ALLOWED_CLIENT_ID_ORIGINS`)" stating: CIMD is off while the
  list is empty; the entry grammar; that a nonempty list advertises CIMD to
  every client and that claude.ai, Claude iOS, Claude Desktop, ChatGPT and
  Codex then use CIMD with no documented fallback to dynamic registration, so
  the list holds the document origin of every CIMD-capable client in use or
  stays empty; the origin discovery procedure of Contract details; that a
  document's redirect URIs are still limited to `OAUTH_ALLOWED_REDIRECT_URIS`;
  the fetch limits of BR-306, BR-307 and BR-309; that removing an origin is
  the cut-off for its clients (immediate at the token endpoint, families
  purged at the next start); that the state file moves to version 2 while it
  holds a CIMD family and that an older release then refuses it with
  `OAUTH_STATE_VERSION` (operator action: remove the origins, start this
  release once, then downgrade); and the accepted residual risks of D-8.
  `docs/deployment.md` lists the variable; `.env.example` (or the deployment
  example that lists the OAuth variables) has it empty; `SECURITY.md` names
  the SSRF limits; the client matrix notes that the proxy advertises CIMD only
  with a nonempty list. Verified by: AC-11.

### Existing rules changed

- **BR-023 v3** (F-002) — adds the bounds of BR-291.
- **BR-024 v4** (F-002) — adds `oauthAllowedClientIdOrigins` to the
  proxy-only settings and the origin conflicts of BR-291.
- **BR-125 v2** — the metadata has `client_id_metadata_document_supported`
  `true` when `oauthAllowedClientIdOrigins` is nonempty and no such member
  otherwise; the other members are unchanged (`none` is already listed).
- **BR-128 v3** — a CIMD client ID is resolved under BR-305–BR-309 before the
  `redirect_uri` check; the `redirect_uri` must match under BR-126 a redirect
  URI of the client (registered, or kept from the document) and an entry of
  the current `oauthAllowedRedirectUris`; otherwise the 400 HTML error page,
  no redirect. The authorize handler becomes asynchronous: the BR-299 latch is
  checked again after the resolution, and a latched store answers the 503
  page.
- **BR-129 v2** — the consent page content of BR-393 for CIMD clients.
- **BR-136 v2** — a CIMD client ID is authenticated under BR-310; registered
  clients are unchanged.
- **BR-143 v3** — the events and the `reason` field of BR-394.
- **BR-295 v2** — step (5) refuses a `user_version` above 2 with
  `OAUTH_STATE_VERSION`; step (9) applies the row rules of the file's own
  version (a CIMD family in a version 1 file is `OAUTH_STATE_CORRUPT`); step
  (11) sets the version under BR-311. Version 1 to 2 needs no migration step:
  the schema is identical.
- **BR-302 v2** — the startup purge also deletes every CIMD family whose
  client ID is not acceptable under BR-305 with the current configuration (all
  of them while the list is empty).

## Contract details

### Blocked IPv4 ranges (BR-307)

`0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`,
`172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`,
`192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`,
`224.0.0.0/4`, `240.0.0.0/4` (includes `255.255.255.255`).

### Blocked IPv6 ranges inside `2000::/3` (BR-307)

`2001::/23` (IETF protocol assignments, including Teredo `2001::/32`),
`2001:db8::/32`, `2002::/16` (6to4, blocked whatever it embeds),
`3fff::/20`. Everything outside `2000::/3` is blocked.

### Store format version 2 (BR-311, BR-295 v2)

- Schema: the version 1 schema, unchanged.
- Row rules: version 1, except that a family row's `client_id` may instead be
  a CIMD client ID (BR-305 syntax checks only) with no client row.
- `user_version`: 2 while at least one CIMD family is stored after a commit
  that inserted one, or after a startup purge that kept one; 1 otherwise.

### Origin discovery procedure (BR-395)

1. Start with the list empty; confirm each client connects through dynamic
   registration.
2. Set `OAUTH_ALLOWED_CLIENT_ID_ORIGINS=https://cimd-discovery.invalid` and
   restart. The metadata now advertises CIMD.
3. Connect each CIMD-capable client in use. Its authorization request is
   refused with the 400 page; the browser address bar shows the `client_id`
   query parameter, whose origin is the value to list.
4. Set the list to the origins found (no placeholder) and restart; connect
   each client again and approve.

### Planned code layout

- `src/auth/proxy/client-metadata.ts`: BR-305 URL checks, BR-308 document
  validation and BR-309 cache, behind a `ClientMetadataFetch` port.
- `src/auth/proxy/client-metadata-fetch.ts`: the production port over
  `node:https` with the dedicated agent and the BR-306 resolution; the
  resolver, the address policy and the CA list are injectable for tests and
  the rehearsal only, and the production composition passes none.
- `src/auth/proxy/address-policy.ts`: BR-307, built on `net.BlockList`.

## Acceptance criteria

- **AC-01** (BR-291, BR-023 v3, BR-024 v4) — Given each source (environment,
  option, YAML), When the list holds valid entries, 17 entries, a duplicate, a
  1,025-character entry, `http://`, an uppercase host, an IP host,
  `localhost`, a one-label host, a trailing dot, port `443`, port `0`, `08080`,
  a path, `/`, userinfo, a query or a fragment, Then valid lists load and each
  other case is `INVALID_VALUE`; Given stdio, `delegate`, or authentication
  off, or an entry equal to the `publicUrl` or `oauthIssuer` origin, Then
  `CONFLICTING_SETTINGS`. Verified by: `tests/config-value-boundaries.test.ts`,
  `tests/config.test.ts` (`BR-291 ...`).
- **AC-02** (BR-305, BR-128 v3, BR-125 v2) — Given origins
  `https://client.example.com`, When authorize receives client IDs with
  `http`, userinfo, a query, a fragment, path `/`, `/a/../b`, `/a/%2e%2e/b`,
  `/a/%2E/b`, an IP host, an unlisted origin, port `8443` on a listed
  port-less origin, `:443` spelled out, 1,025 bytes, a non-normalized
  spelling, or the proxy issuer, Then the 400 page, no redirect, and the fetch
  port is not called; Given an empty list, Then every `https` client ID is
  refused without fetch and the metadata lacks
  `client_id_metadata_document_supported`; Given a nonempty list, Then it is
  `true`. Verified by: `tests/auth/proxy-cimd.test.ts`,
  `tests/auth/proxy-metadata.test.ts`.
- **AC-03** (BR-306) — Given a local TLS server trusted through the
  injectable CA list and an injected resolver and address policy that allow
  loopback, When the production fetch port runs, Then: it sends `GET` with
  `Accept: application/json` and no cookie or `Authorization`; a resolver
  that changes its answer on a second call is called once and the connection
  goes to a first-answer address; it refuses 301, 302, 307, 308 without
  following, and 404, as terminal; 429 and 503 as transient; `text/html` as
  terminal; accepts `application/json; charset=utf-8` and
  `application/cimd+json`; refuses a 5,121-byte body (also with a false
  `Content-Length` of 100) and accepts 5,120 bytes; a body stalled past
  5,000 ms and a resolver that never answers fail as `timeout` at 5,000 ms on
  the fake clock; an untrusted certificate fails as `certificate`; and, in a
  child process started with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` and
  `HTTP_PROXY` pointing at a local proxy, the fetch succeeds and the proxy
  receives no connection. Verified by: `tests/auth/cimd-fetch.test.ts`.
- **AC-04** (BR-307, BR-306) — Given the production address policy, Then one
  sample inside and one just outside each blocked IPv4 range, one sample per
  blocked IPv6 range, `::`, `::1`, `::ffff:8.8.8.8`, `::ffff:0:8.8.8.8`,
  `::8.8.8.8`, `64:ff9b::808:808`, `64:ff9b:1::1`, `fc00::1`, `fe80::1`,
  `fec0::1`, `ff02::1`, `2002:808:808::1` are classified as listed and
  `8.8.8.8` and `2606:4700::1` are allowed; Given the production fetch port
  with an injected resolver, When the answer is one blocked address, or
  `[8.8.8.8, 127.0.0.1]`, or empty, Then the fetch fails as
  `blocked_address` (or `resolution` for empty) and no socket is opened.
  Verified by: `tests/auth/cimd-address.test.ts`.
- **AC-05** (BR-308, BR-128 v3) — Given documents with a different
  `client_id`, a `client_secret`, `client_secret_expires_at`,
  `token_endpoint_auth_method` `client_secret_basic`,
  `token_endpoint_auth_methods_supported` `["private_key_jwt"]`, a singular
  method absent from the array, no redirect URI in the allowlist, no
  `authorization_code`, `response_types` `["token"]`, an empty name, invalid
  JSON, a byte-order mark and a JSON array, Then the 400 page without
  redirect; Given a document with two allowed and three non-allowed redirect
  URIs, grants `["authorization_code","refresh_token","urn:x"]`,
  `token_endpoint_auth_methods_supported` `["private_key_jwt","none"]` and a
  `jwks_uri`, Then the request reaches consent, a `redirect_uri` among the
  non-allowed ones gets the 400 page, and no URL of the document is fetched.
  Verified by: `tests/auth/proxy-cimd.test.ts`.
- **AC-06** (BR-309) — Given the fake clock and a counting fetch port, When
  documents carry `max-age=600`, `max-age=86400`, `max-age=10`, no header,
  `no-store` and `no-cache`, Then the port is called again exactly after
  600 s, 3,600 s, 60 s, 300 s, 60 s and 60 s; Given a failing port, Then
  every request calls it again (no failure cache) within the BR-162 window;
  Given an expired entry, When the refetch fails transiently, Then the stale
  document is used until 3,600 s past expiry and then the 503 page; When it
  fails terminally, Then the 400 page and the entry is gone; ten concurrent
  requests for one URL make one call; four distinct URLs pending make a fifth
  get 503 without a call; the 101st URL evicts the entry discarded first.
  Verified by: `tests/auth/proxy-cimd.test.ts`.
- **AC-07** (BR-310, BR-136 v2) — Given a CIMD client that completed
  authorization, When it redeems its code with `client_id` in the body and no
  secret, Then tokens are issued and the fetch port is not called; with Basic
  or a body secret, Then 401 `invalid_client`; with a code of another client,
  Then `invalid_grant`; a document without `refresh_token` yields no refresh
  token; When the proxy is rebuilt with the origin removed, Then the code
  and the refresh token both get 401 `invalid_client`. Verified by:
  `tests/auth/proxy-cimd.test.ts`.
- **AC-08** (BR-311, BR-295 v2, BR-302 v2) — Given a state file, When a CIMD
  client gets a refresh token, Then the file holds a family with the URL as
  client ID, no client row, and `user_version` 2; When the proxy is rebuilt on
  the file with the same list, Then the refresh succeeds without fetch; When
  it is rebuilt with the origin removed, Then the family is deleted at
  startup, `user_version` is 1 and `store_loaded` counts no family; Given a
  version 1 file holding a CIMD family row, Then `OAUTH_STATE_CORRUPT`; Given
  `user_version` 3, Then `OAUTH_STATE_VERSION`; Given 1,000 families including
  CIMD ones, Then the BR-142 v2 eviction applies to them. Verified by:
  `tests/auth/proxy-persistence.test.ts`, `tests/auth/proxy-store.test.ts`.
- **AC-09** (BR-393, BR-129 v2) — Given a CIMD client named
  `<b>Claude</b>` with loopback-only redirect URIs, Then the consent page
  shows the escaped client ID, `Client host: client.example.com`, the escaped
  name with the unverified notice and the loopback line; with an `https`
  redirect URI the loopback line is absent; a registered client's page is
  byte-identical to today's. Verified by: `tests/auth/proxy-consent.test.ts`.
- **AC-10** (BR-394, BR-143 v3) — Given every refusal path of AC-02 to AC-08
  with a capturing logger and captured stderr, Then each refusal logs one
  `client_metadata_refused` with the expected `reason`, each successful fetch
  one `client_metadata_fetched`, and no event, response or line contains the
  CIMD URL, its host, a resolved address, a document member or a TLS message.
  Verified by: `tests/auth/proxy-secrecy.test.ts`.
- **AC-11** (BR-395) — Given the updated documents, When the content tests
  run, Then each BR-395 statement, the variable and the discovery procedure
  are present in the named files. Verified by:
  `tests/docs/oauth-cimd-docs.test.ts`.
- **AC-12** (BR-305–BR-311, BR-393; rehearsal for the owner run) — Given
  `scripts/http-acceptance.ts` with the real HTTP layer, a fake upstream, a
  temporary state file, a local TLS CIMD client double (test CA and loopback
  allowed only through the rehearsal seam) and a listed origin, When a scripted
  client follows the discovery procedure (placeholder origin first, then the
  real one), authorizes with its URL client ID, approves, redeems, the server
  restarts on the same file and the client refreshes, Then each step gives the
  expected status, the double served the document once per freshness window,
  and the refresh needs no fetch. Verified by:
  `tests/http/cimd-rehearsal.test.ts` (`make check`).
- **AC-13** (all) — `make check` passes with the new tests, and the
  production composition passes no resolver, address policy or CA override
  (asserted by a source test on the composition). Verified by: `make check`,
  `tests/auth/proxy-construction.test.ts`.

Owner-run acceptance (after merge, not a merge condition, recorded on the
ticket): run `make http-acceptance` behind the quick tunnel (learnings
2026-11-04) with `OAUTH_STATE_FILE` set, follow the discovery procedure with
claude.ai, list the origin found, connect claude.ai, check that the consent
page shows the client host, call a tool, restart, and check that the
connector still works without a new login. Record the origin found in the
client matrix.

## Decisions

- **D-1 — CIMD behind an operator origin list, off by default.** Fetching a
  URL from an unauthenticated request is an SSRF primitive; the list limits it
  to known client vendors, the address policy and pinning stop DNS rebinding
  for a listed origin, and redirect URIs stay within
  `OAUTH_ALLOWED_REDIRECT_URIS`, so CIMD never widens where codes can go.
  Rejected: open CIMD with address checks only (anyone could make the server
  fetch any public URL); an exact client-ID URL list (no client documents its
  URL, and origins are what the draft's trust policies describe); CIMD on by
  default (moves every listed client at once with no known origins).
- **D-2 — Shipped empty; discovery procedure instead of guessed origins.** A
  nonempty list advertises CIMD to every client and the matrix documents no
  fallback, so a missing origin breaks that client. Rejected: shipping guessed
  vendor origins (unverified; a wrong one breaks the client).
- **D-3 — Lenient document filtering (review finding).** Non-allowlisted
  redirect URIs and unknown grant or response types are ignored; at least one
  allowed URI, `authorization_code` and `code` are required. This matches the
  draft's intersection rule (Client Information Discovery) and lets one vendor
  document list URIs for other deployments. Rejected: refusing the whole
  document (the earlier draft), which breaks clients whose document lists more
  URIs than this deployment allows.
- **D-4 — Origin removal is the cut-off, with a startup purge (review
  finding).** The token endpoint re-checks the current list on every request;
  the startup purge deletes the families of unlisted origins so the file does
  not keep dead families. Rejected: refetching at the token endpoint (adds
  SSRF and latency to every refresh, and a transient failure would break
  refresh, which the draft says it should not); keeping families until expiry
  (an operator cut-off would not be effective).
- **D-5 — No failure cache (re-read of the draft).** The draft says the server
  MUST NOT cache error responses or invalid documents; the earlier 60 s failure
  cache is dropped. Repeated fetches stay bounded by the origin list, four
  concurrent fetches and the BR-162 authorize window of 30 per 60 s.
  Rejected: a failure cache (non-compliant).
- **D-6 — Freshness clamp of 60–3,600 s and stale use on transient failure.**
  The draft recommends maximum and minimum effective durations, allows rate
  limiting that fetches less often than the headers ask, and says transient
  failures should not discard cached valid metadata. Rejected: honouring
  `no-store` literally (one fetch per authorization of a busy client).
- **D-7 — No revocation on document change or mismatch.** The draft says a
  terminal `client_id` mismatch SHOULD invalidate refresh tokens. Here the
  document is fetched only at authorization; the cut-off is origin removal.
  Rejected: revoking on mismatch at authorize (a new store write on an
  unauthenticated path, and the URL's owner, who controls the document, is
  the only party able to trigger it).
- **D-8 — Accepted residual risks.** A listed origin's owner controls the
  document (bounded by the redirect allowlist and the consent page); a
  TLS-intercepting proxy in front of the container is outside the threat
  model; the fetch uses the system resolver; the 503 page during a remote
  outage when no stale entry exists.
- **D-9 — Address policy: only `2000::/3` for IPv6 (ticket design point).**
  Allowing global unicast only removes the need to decode every embedding
  form (mapped, translated, compatible, NAT64); 6to4 is blocked entirely.
  Rejected: the earlier list of blocked IPv6 ranges with embedded-address
  checks (more surface, same result for real client hosts).
- **D-10 — Content-dependent store version 2 (ADR-011).** A file moves to
  version 2 only while it holds a CIMD family, so an operator who never uses
  CIMD can still downgrade, and an older release refuses a CIMD file with
  `OAUTH_STATE_VERSION` instead of `OAUTH_STATE_CORRUPT`. Rejected: storing
  CIMD clients as client rows (needs a schema change and invents a
  registration); always writing version 2 (blocks downgrade for everyone);
  keeping version 1 with relaxed rules (older releases report corruption).
- **D-11 — `grant_types` absent means both grants**, as for registration
  (BR-127), so a client that omits it still gets refresh tokens. Rejected: the
  RFC 7591 default of `authorization_code` only (silent loss of refresh for
  such clients, inconsistent with BR-127).

### Deviations from the MCP specification and the IETF draft

MCP 2026-07-28 "Client Registration" and "Security Considerations"; IETF
`draft-ietf-oauth-client-id-metadata-document-03` (2026-11-02):

1. CIMD only for listed origins (draft "Client ID Domain Trust" and MCP "Trust
   Policies" allow this; MCP says servers SHOULD support CIMD).
2. A query component is refused (draft: SHOULD NOT).
3. `no-store` and `no-cache` are held 60 s and `max-age` is clamped (draft:
   SHOULD respect cache headers; MAY rate-limit; SHOULD enforce bounds).
4. No revocation on a terminal mismatch (draft: SHOULD; D-7).
5. Only method `none`; a document allowing only `private_key_jwt` is refused
   (draft: MUST abort with `invalid_client` when no declared method is
   supported; this is that case).
6. `grant_types` absent means both grants (D-11; RFC 7591 default differs).
7. Authorization-endpoint failures use the 400 or 503 HTML page rather than an
   `invalid_client` error code; the draft forbids redirecting in that case,
   which this follows.

Points checked and followed: https scheme, no userinfo or fragment, path not
`/`, no dot segments, simple string comparison without normalization, exact
`client_id` match, 200 only, no redirects, `Accept: application/json`,
`+json` content types, no shared-secret methods or `client_secret`,
`token_endpoint_auth_methods_supported` recognized, `none` assumed when no
method is declared, special-use addresses never fetched, about 5 KB read
limit, error responses and invalid documents not cached, transient failures
keep valid cached metadata, client host and redirect URI shown on consent,
loopback-only redirect warning, client ID equal to the issuer refused, `iss`
in the authorization response (already BR-132), persisted state scoped to
client ID and `resource` (families already carry `resource`).

## Open questions

1. Which client origins, if any, the shipped documentation and example list
   should name. Proposal: none; the list ships empty and the owner records
   origins found with the discovery procedure in the client matrix.
2. Whether the owner-run claude.ai check is an acceptance condition of this
   ticket or, as for F-019, recorded separately after acceptance. Proposal:
   recorded separately; AC-12 is the rehearsal.

## Stress-test

Not yet reviewed.

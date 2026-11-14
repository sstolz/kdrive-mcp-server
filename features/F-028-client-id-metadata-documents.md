---
id: F-028
title: Client ID Metadata Documents in the OAuth proxy
ticket: "#3"
status: done
version: 2
---

Version 1 frozen 2026-11-14 (autonomous mode, PROJECT.md D-1) on reviewed
revision `67efaf8` after spec reviews 1 (`changes`), 2 (`approve`), decision
pass 1 (Fable, `approve`), review 3 (`changes`) and review 4 (`approve`),
published on #3; kept in `features/history/F-028-v1.md`. Version 2
(2026-11-14) changes only the owner-run acceptance paragraph and D-13: the
owner run is blocked until #25 makes the launcher persist the OAuth state;
see `## Stress-test`, Code review 1. Version 2 frozen 2026-11-14 on
reviewed revision `315f3ae` after 3-code-review-3-reviewer approved it
(PR #24).

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `254d5da` (main `75c9f48`).
Review 1 fixes applied on `35eb1e9`.
IDs: F-028; BR-291 and BR-305–BR-311 v1 (reserved for this work by F-019 and
`docs/spec-index.md`; the archive ticket that reserved them was archive issue
109, now this repository's `#3`); BR-393–BR-395 v1; BR-023 v3, BR-024 v4,
BR-125 v2, BR-128 v3, BR-129 v2, BR-136 v2, BR-143 v3, BR-169 v3, BR-295 v2, BR-298 v2,
BR-299 v2, BR-302 v2; ADR-011 (proposed). Next free IDs re-checked on main
`75c9f48` after review 1: F-028, BR-393, ADR-011. The design starts from the reviewed CIMD section of an
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
documents no fallback to dynamic registration once CIMD is advertised.
claude.ai documents no metadata document URL; the matrix records the document
URLs that ChatGPT and Codex document (`docs/mcp-client-compatibility.md`,
ChatGPT and Codex rows), each with a per-callback alternative, from
owner-supplied pages and unverified. This spec names none of them (D-12).

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
3. The fetch: https only, one cancellable DNS resolution outside the libuv
   threadpool, every resolved address checked against an address policy,
   connection pinned to the checked addresses, a dedicated agent that ignores
   proxy variables and always verifies certificates, no redirect, 5,120 bytes,
   5,000 ms, at most four concurrent fetches, and a bounded in-memory cache.
4. Token endpoint: a CIMD client authenticates with method `none`; codes and
   refresh families work as for a registered public client; no fetch at the
   token endpoint.
5. Persistence: CIMD families are stored like other families, with the URL as
   client ID and no client row (store format version 2, ADR-011). Removing an
   origin from the list, effective at the restart that applies it, cuts its
   clients off at the token endpoint and purges their families in that
   startup. Removing a redirect URI does not cut off a CIMD client.
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
  `https://<host>` or `https://<host>:<port>` where `<host>` is a DNS name of
  at least two dot-separated labels, each label 1–63 characters of ASCII
  lowercase letters, digits and hyphens, not starting or ending with a hyphen
  (an internationalized name is written as its A-labels, `xn--…`), the last
  label not all digits, at most 253 characters, not `localhost`, no trailing
  dot; `<port>` is 1–65535 without a leading zero and other than `443`; there
  is no path, trailing slash, userinfo, query or fragment; and the entry is
  byte-identical to the WHATWG URL origin serialization of itself. Any other
  entry is refused with `INVALID_VALUE`. It is accepted only with transport `http`,
  authentication on and OAuth mode `proxy` (the BR-290 restriction); otherwise
  `CONFLICTING_SETTINGS`. An entry equal to the origin of `publicUrl` or of
  `oauthIssuer` is refused with `CONFLICTING_SETTINGS`. Verified by: AC-01.

### Client ID Metadata Documents

- **BR-305** — A `client_id` that starts with `https://` is a CIMD client ID.
  It is acceptable only when: it meets every check of Contract details "CIMD
  client ID syntax"; it is
  not byte-identical to the proxy issuer, the audience or the upstream issuer;
  and its origin (`https://host[:port]`, port omitted when 443) is
  byte-identical to an entry of the current `oauthAllowedClientIdOrigins`. At
  the authorize handler a CIMD client ID that is not acceptable, or any CIMD
  client ID while the list is empty, is an unknown client: 400 HTML error page,
  no redirect, no fetch (BR-128 v3). A `client_id` that does not start with
  `https://` is looked up among registered clients as today. Verified by:
  AC-02.
- **BR-306** — The proxy fetches an acceptable CIMD client ID with one HTTPS
  `GET` to that exact URL whose only request headers are `Host`,
  `Accept: application/json`, `User-Agent: kdrive-mcp-server` (fixed, no
  version or host detail) and `Connection: close`: no `Accept-Encoding`, no
  cookie, no `Authorization` header and no other credential. It verifies the
  certificate for the URL host against Node's default CA store (the bundled
  roots plus any `NODE_EXTRA_CA_CERTS`), on the URL port (443 when absent). The
  request uses a dedicated `https.Agent` created without `proxyEnv`, so
  `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` have no
  effect on it, with keep-alive off and `rejectUnauthorized: true` set
  explicitly, so `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot disable verification
  (as for the kDrive transport, BR-191 and BR-216 v2). The host is resolved
  exactly once, never through `dns.lookup` (getaddrinfo on the libuv
  threadpool), but through a `dns.promises.Resolver` (c-ares, outside the
  threadpool) created for this fetch with `timeout` 2,000 ms and `tries` 2,
  which queries `resolve4` and `resolve6` in parallel; the answer is the union
  of both. A query that ends with `ENODATA` or `ENOTFOUND` contributes no
  address; any other query error fails the fetch as `resolution`. When the
  5,000 ms deadline passes the proxy calls the resolver's `cancel()`, so no
  query outlives the fetch. Every returned address is checked under BR-307,
  and if any is blocked, or the union is empty, the fetch fails without
  connecting. Otherwise the agent's `lookup` returns, from memory, every
  checked address and only those (the `all` form, `resolve4` answers first,
  then `resolve6` answers, each in answer order), and the connection is made
  with `autoSelectFamily` true, so Node's connection attempts fall over from
  one checked address to the next until one connects or the 5,000 ms
  deadline passes; no second resolution happens for this fetch. The
  fetch succeeds only with status 200 (no redirect is followed; every other
  status fails), a `Content-Type` media type `application/json` or
  `application/<name>+json` (parameters ignored, case-insensitive), no
  `Content-Encoding` other than `identity` (the body is never decompressed; any
  other coding is a terminal `content_type` failure), a body of at most 5,120
  bytes (reading stops and fails at the 5,121st byte, whatever
  `Content-Length` says) and completion within 5,000 ms from the start of the
  resolution. A failure is transient when the resolution fails, the
  connection or TLS handshake does not complete for a reason other than a
  certificate verification failure, the 5,000 ms elapse, or the status is 429
  or 5xx; every other failure is terminal. Verified by: AC-03, AC-14.
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
  or displayed. The pending consent, the pending upstream flow and the
  authorization code each carry a snapshot of this resolved client (kept
  redirect URIs, kept grants, whether `refresh_token` is kept, name), taken at
  the resolution; the client is never re-resolved later in the flow (consent
  submission, callback, code redemption), whatever the cache then holds. An
  invalid document is a terminal failure. Verified by: AC-05, AC-06.
- **BR-309** — Resolution results are cached in memory only, keyed by URL, at
  most 100 entries. A valid document is fresh for 60 s when `Cache-Control`
  has a `no-store` or `no-cache` directive; otherwise for its `max-age`
  clamped to 60–3,600 s; otherwise for 300 s. Parsing: the `Cache-Control`
  field lines are joined with commas and split into comma-separated
  directives, each trimmed of spaces and tabs, the name (before any `=`)
  compared case-insensitively and the value taken after the first `=`; `max-age` is the value of the
  first `max-age` directive whose value is 1–10 ASCII digits (no quotes, sign
  or other character); a field with no such directive has no `max-age`; every other directive (`public`, `private`,
  `s-maxage`, `must-revalidate`, `immutable`, unknown ones) and `Expires` are
  ignored. A failure
  is never cached. While fresh, an entry is used without fetching. After it
  expires it is kept for 3,600 s more as a stale entry that is used only when
  the refetch fails transiently; a terminal failure deletes it. When a new
  entry would exceed 100, the entry that would be discarded first (stale end
  for stale entries, freshness end plus 3,600 s otherwise) is evicted. At most
  one fetch per URL is in flight (concurrent authorization requests for that
  URL share it) and at most 4 fetches in total; an authorization request that
  would start a fifth gets the 503 HTML error page without fetching. At the
  5,000 ms deadline or at any failure, the proxy calls the resolver's
  `cancel()`, destroys the request and its socket, and frees the slot at that
  moment. A
  transient failure with no usable stale entry gives the 503 HTML error page;
  a terminal failure gives the 400 HTML error page; neither redirects. When
  the HTTP server's `close()` closes the handler (BR-169 v3 step (2)), the
  proxy cancels every in-flight fetch in the same way (resolver `cancel()`,
  request and socket destroyed, slot freed), and every authorization request
  waiting on one gets the 503 HTML error page without redirect, settled in
  that step, and creates no pending consent. Verified by: AC-06.
- **BR-310** — At the token endpoint a CIMD client ID is authenticated with
  method `none` only: it is presented as `client_id` in the body, without
  `client_secret` and without Basic, and it is acceptable under BR-305 with the
  current configuration; otherwise 401 `invalid_client` (BR-136 v2), decided
  before any code or family is looked up, so no code is consumed and no family
  is touched. No document is fetched at the token endpoint.
  `authorization_code` is allowed when the code is bound to that client ID; a
  code yields a refresh token only when the snapshot bound to it (BR-308) kept
  `refresh_token`; `refresh_token` is allowed for families of that client ID.
  The configuration is read at startup, so removing an origin takes effect at
  the restart that applies it: codes do not survive that restart, and from its
  first request every refresh token of the origin's clients gets 401
  `invalid_client`. Verified by: AC-07.
- **BR-311** — A CIMD client is never stored as a registered client and never
  counts against the client bound; its refresh families are stored with the
  URL as client ID and count against the family bound (BR-303). The store
  format becomes version 2 (Contract details, ADR-011): the version 1 schema
  unchanged, with the family row rule extended so that a family's
  `client_id` either names a client row or meets Contract details "CIMD
  client ID syntax" with no client row. That syntax stands on its own (no
  origin, issuer or audience check), so a version 2 file read at startup and
  a row to be written are checked without the configuration (a family whose
  `client_id` names no client row and fails that syntax is
  `OAUTH_STATE_CORRUPT` at load and a failed write at write). A committed
  transaction that inserts a CIMD family sets
  `user_version` to 2 in that transaction; the startup transaction (BR-295 v2
  step (11)) sets it to 2 when a CIMD family remains after the purge and to 1
  otherwise. Between startups the version never goes back to 1: it stays 2
  after the last CIMD family is deleted (revocation, expiry purge, eviction)
  until the next startup transaction. A transaction writes version 2 when the
  file is at version 2 or the transaction inserts a CIMD family, and version 1
  otherwise; its rows are checked against the row rules of that version
  (BR-298 v2, BR-299 v2). After a restart a CIMD client refreshes without any
  fetch. Verified by: AC-08.

### Display, logging and documentation

- **BR-393** — The consent page of a CIMD client shows, before the
  self-declared name, the client ID URL and on its own line its host
  (`Client host: <host>`), both HTML-escaped; it states that the name comes
  from the client's metadata document and is unverified; and when the
  request's `redirect_uri` is a loopback URI (scheme `http` and host an IPv4
  address in `127.0.0.0/8`, `[::1]` or `localhost`) it shows the line
  `This client redirects to this computer only (loopback).` The page of a
  registered client is unchanged. Verified by: AC-09.
- **BR-394** — The proxy adds the event `client_metadata_refused` (handler
  `authorize`, fields `reason` and `status`), with `reason` one of
  `not_allowed` (BR-305), `blocked_address`, `resolution`, `connection`,
  `certificate`, `timeout`, `status`, `content_type`, `size`, `document`
  (BR-306–BR-308, and a `redirect_uri` not kept from the document) or `busy`
  (BR-309). Every refused authorization request logs exactly one event, the
  one Contract details "Authorization refusal events" assigns to it: with an
  empty list, and for a `client_id` that does not start with `https://`,
  today's event only; `client_metadata_refused` only with a nonempty list.
  The proxy also adds the event `client_metadata_fetched` (fields `status` and
  `count`, where `count` is the number of cache entries) logged once per
  completed successful fetch. In both events `status` is the HTTP status code
  of the document response, or `0` when no response status was received
  (`not_allowed`, `blocked_address`, `resolution`, `connection`,
  `certificate`, `busy`, and `timeout` before the status line); it is
  therefore always 200 in `client_metadata_fetched`. The status of the proxy's
  own page follows from `reason` (BR-309). `reason` joins the BR-143 field
  list. No event,
  response, page other than the consent page, or thrown message contains a
  CIMD URL, host, resolved address, document member or TLS error text.
  Verified by: AC-10.
- **BR-395** — `docs/oauth-proxy.md` gains a section "Client ID Metadata
  Documents (`OAUTH_ALLOWED_CLIENT_ID_ORIGINS`)" stating: CIMD is off while the
  list is empty; the entry grammar; that a nonempty list advertises CIMD to
  every client and that claude.ai, Claude iOS, Claude Desktop, ChatGPT and
  Codex then use CIMD with no documented fallback to dynamic registration, so
  the list holds the document origin of every CIMD-capable client in use or
  stays empty; that an origin is listed only when its vendor controls every
  path under it (no multi-tenant hosting where third parties can publish
  files under the origin), because any document under a listed origin is
  accepted; that one client may use several document URLs under one origin
  (for example a per-callback document), which is why origins, not URLs, are
  listed; the origin discovery procedure of Contract details; that a
  document's redirect URIs are still limited to `OAUTH_ALLOWED_REDIRECT_URIS`,
  which acts only at authorization: removing a URI from it does not cut off a
  CIMD client already holding a refresh family; the fetch limits of BR-306,
  BR-307 and BR-309; that the fetch ignores proxy variables, so CIMD is
  unusable where egress must go through a proxy, and that
  `NODE_EXTRA_CA_CERTS` extends the CAs trusted for the fetch; that removing an
  origin is the only cut-off for its clients, effective at the restart that
  applies it (refresh tokens refused, families purged), while access tokens
  already issued to those clients stay valid until they expire (one hour)
  unless the signing key is replaced; that the state file moves to version 2 while it
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
- **BR-128 v3** — for a CIMD client ID the authorize handler checks, in this
  order and each before any fetch: (1) a repeated parameter; (2) BR-305
  acceptability; (3) a `redirect_uri` that is absent or matches no entry of
  the current `oauthAllowedRedirectUris` under BR-126. Each refusal is the 400
  HTML error page, no redirect. Only then is the client resolved under
  BR-306–BR-309, and the `redirect_uri` must match under BR-126 a redirect URI
  kept from the document; otherwise the 400 page, no redirect. Registered
  clients keep today's order. The authorize handler becomes asynchronous: the
  BR-299 latch is checked again after the resolution, and a latched store
  answers the 503 page and creates no pending consent. The event of each
  refusal follows Contract details "Authorization refusal events".
- **BR-129 v2** — the consent page content of BR-393 for CIMD clients.
- **BR-136 v2** — a CIMD client ID is authenticated under BR-310; registered
  clients are unchanged.
- **BR-143 v3** — the events and the `reason` field of BR-394.
- **BR-169 v3** — step (2) also cancels in-flight CIMD fetches and settles
  their authorization requests with the 503 page (BR-309).
- **BR-295 v2** — step (5) refuses a `user_version` above 2 with
  `OAUTH_STATE_VERSION`; step (9) applies the row rules of the file's own
  version (a CIMD family in a version 1 file is `OAUTH_STATE_CORRUPT`); step
  (11) sets the version under BR-311. Version 1 to 2 needs no migration step:
  the schema is identical.
- **BR-298 v2** — each row the store writes passes, before its transaction
  commits, the row rules of the format version that transaction writes
  (BR-311: version 1 or 2, Contract details) instead of always the version 1
  rules; otherwise unchanged.
- **BR-299 v2** — a row to be written that breaks a row rule of the version
  its transaction writes (BR-311) is a failed write, instead of a row that
  breaks a version 1 rule; otherwise unchanged. The first CIMD family write is
  therefore not a failed write.
- **BR-302 v2** — the startup purge also deletes every CIMD family whose
  client ID is not acceptable under BR-305 with the current configuration (all
  of them while the list is empty). A CIMD family stores no redirect URI, so
  the redirect-URI purge does not apply to it: removing a URI from
  `oauthAllowedRedirectUris` acts on CIMD clients only at authorization, and
  only origin removal cuts off a CIMD client (D-4).

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

### CIMD client ID syntax (BR-305, BR-311)

A string meets the CIMD client ID syntax when every check holds; none reads
the configuration:

1. it starts with the bytes `https://`;
2. it has at most 1,024 bytes;
3. it parses as a WHATWG URL whose serialization is byte-identical to it;
4. that URL has an empty username and password, and the string contains no
   `?` and no `#` (no query, not even an empty one, and no fragment);
5. the URL host is a domain: neither an IPv4 address nor a bracketed IPv6
   literal;
6. the URL path is not `/`, and no path segment is `.` or `..`, also when
   any dot is percent-encoded (`%2e` or `%2E`).

### Authorization refusal events (BR-394, BR-128 v3)

Each refused authorization request logs exactly one event, handler
`authorize`. "Today's" means the event, page and redirect of the current
authorize handler, unchanged.

| Request                                                                                                          | Event                     | `reason`                                     | Answer                                |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------- | ------------------------------------- |
| List empty, any `client_id` (CIMD or not)                                                                        | today's                   | none                                         | today's (an `https` ID: 400, unknown) |
| List nonempty, `client_id` not starting with `https://`                                                          | today's                   | none                                         | today's                               |
| Store latched on entry                                                                                           | `authorization_refused`   | none                                         | 503 page                              |
| CIMD ID, repeated parameter (check 1)                                                                            | `authorization_refused`   | none                                         | 400 page                              |
| CIMD ID, not acceptable under BR-305 (check 2)                                                                   | `client_metadata_refused` | `not_allowed`                                | 400 page                              |
| CIMD ID, `redirect_uri` absent or not allowlisted (check 3)                                                      | `authorization_refused`   | none                                         | 400 page                              |
| CIMD ID, fifth concurrent fetch                                                                                  | `client_metadata_refused` | `busy`                                       | 503 page                              |
| CIMD ID, fetch fails, no usable stale entry                                                                      | `client_metadata_refused` | the failure (BR-306–BR-308)                  | 503 or 400 page (BR-309)              |
| CIMD ID, `redirect_uri` not kept from the resolved document                                                      | `client_metadata_refused` | `document`                                   | 400 page                              |
| CIMD ID, server closing while the fetch is pending (BR-309)                                                      | `authorization_refused`   | none                                         | 503 page                              |
| CIMD ID, store latched after the resolution                                                                      | `authorization_refused`   | none                                         | 503 page                              |
| CIMD ID resolved, later check fails (`response_type`, `state`, PKCE, `resource`) or consent store full           | today's                   | none                                         | today's (redirect or 503 page)        |

`client_metadata_refused` is therefore logged only with a nonempty list. With
`reason` `document` its `status` is 200 (the document's response, fetched or
cached).

### Store format version 2 (BR-311, BR-295 v2)

- Schema: the version 1 schema, unchanged.
- Row rules: version 1, except that a family row's `client_id` may instead
  meet "CIMD client ID syntax" below with no client row.
- `user_version`: set to 2 by a commit that inserts a CIMD family; set by
  each startup transaction to 2 when a CIMD family remains after the purge
  and to 1 otherwise; between startups it is never lowered, so a file stays at
  2 after its last CIMD family is deleted until the next startup transaction
  (BR-311).

### Origin discovery procedure (BR-395)

1. Start with the list empty; confirm each client connects through dynamic
   registration.
2. Set `OAUTH_ALLOWED_CLIENT_ID_ORIGINS=https://cimd-discovery.invalid` and
   restart. The metadata now advertises CIMD.
3. Connect each CIMD-capable client in use. A connector that already holds a
   dynamic registration may keep using it: remove that connector in the
   client and add it again so that it starts a new authorization. Its
   authorization request is refused with the 400 page; the browser address
   bar shows the `client_id` query parameter, whose origin is the value to
   list. A client that still connects through dynamic registration reveals no
   origin; record that in the client matrix.
4. Set the list to the origins found (no placeholder), keeping only origins
   whose vendor controls every path (BR-395), and restart; connect each client
   again and approve. Record the origins found in the client matrix.

### Planned code layout

- `src/auth/proxy/client-metadata.ts`: BR-305 URL checks, BR-308 document
  validation and BR-309 cache, behind a `ClientMetadataFetch` port.
- `src/auth/proxy/client-metadata-fetch.ts`: the production port over
  `node:https` with the dedicated agent and the BR-306 c-ares resolution; the
  resolver (a factory returning a `Resolver`-shaped object, or the DNS server
  list of the real one), the address policy and the CA list are injectable for tests and
  the rehearsal only, and the production composition passes none.
- `src/auth/proxy/address-policy.ts`: BR-307, built on `net.BlockList`.

## Acceptance criteria

- **AC-01** (BR-291, BR-023 v3, BR-024 v4) — Given each source (environment,
  option, YAML), When the list holds valid entries, 17 entries, a duplicate, a
  1,025-character entry, `http://`, an uppercase host, an IP host,
  `localhost`, a one-label host, a trailing dot, an all-digit last label
  (`https://a.123`), an underscore, a label starting or ending with a hyphen,
  a 64-character label, a 254-character host, the Unicode host
  `https://bücher.example` (its A-label `https://xn--bcher-kva.example` is a
  valid case that loads), port `443`, port `0`, `08080`, a path,
  `/`, userinfo, a query or a fragment, Then valid lists load and each other
  case is `INVALID_VALUE`; Given stdio, `delegate`, or authentication
  off, or an entry equal to the `publicUrl` or `oauthIssuer` origin, Then
  `CONFLICTING_SETTINGS`. Verified by: `tests/config-value-boundaries.test.ts`,
  `tests/config.test.ts` (`BR-291 ...`).
- **AC-02** (BR-305, BR-128 v3, BR-125 v2) — Given origins
  `https://client.example.com`, When authorize receives client IDs with
  `http`, userinfo, a query, a fragment, path `/`, `/a/../b`, `/a/%2e%2e/b`,
  `/a/%2E/b`, an IP host, an unlisted origin, port `8443` on a listed
  port-less origin, `:443` spelled out, 1,025 bytes, a non-normalized
  spelling, or the proxy issuer, Then the 400 page, no redirect, and the fetch
  port is not called; Given a listed, acceptable client ID with a repeated
  parameter, an absent `redirect_uri` or one outside the allowlist, Then the
  400 page and the fetch port is not called; Given an empty list, Then every `https` client ID is
  refused without fetch and the metadata lacks
  `client_id_metadata_document_supported`; Given a nonempty list, Then it is
  `true`. Verified by: `tests/auth/proxy-cimd.test.ts`,
  `tests/auth/proxy-metadata.test.ts`.
- **AC-03** (BR-306) — Given a local TLS server trusted through the
  injectable CA list and an injected resolver and address policy that allow
  loopback, When the production fetch port runs, Then: it sends `GET` whose
  only headers are `Host`, `Accept: application/json`,
  `User-Agent: kdrive-mcp-server` and `Connection: close` (no
  `Accept-Encoding`, cookie or `Authorization`); a response with
  `Content-Encoding: gzip` fails as `content_type` (terminal); a resolver
  that changes its answer on a second call is called once and the connection
  goes to a first-answer address; it refuses 301, 302, 307, 308 without
  following, and 404, as terminal; 429 and 503 as transient; `text/html` as
  terminal; a resolver answering two addresses of which the first has no
  listener (`127.0.0.2`, server bound to `127.0.0.1` only) and the second is
  the server succeeds through the second; accepts `application/json; charset=utf-8` and
  `application/cimd+json`; refuses a 5,121-byte body (also with a false
  `Content-Length` of 100) and accepts 5,120 bytes; a body stalled past
  5,000 ms and a resolver that never answers fail as `timeout` at 5,000 ms on
  the fake clock; an untrusted certificate fails as `certificate`; and, in a
  child process started with `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and
  `HTTP_PROXY` pointing at a local proxy, and `NODE_TLS_REJECT_UNAUTHORIZED=0`,
  the fetch to the trusted server succeeds, the proxy receives no connection,
  and a server whose certificate is not in the injected CA list still fails
  as `certificate`. Verified by: `tests/auth/cimd-fetch.test.ts`.
- **AC-04** (BR-307, BR-306) — Given the production address policy, Then one
  sample inside each blocked IPv4 range and one just outside it where a
  non-blocked neighbour exists, one sample per blocked IPv6 range,
  `2001:200::1` (just outside `2001::/23`, allowed), `::`, `::1`, `::ffff:8.8.8.8`, `::ffff:0:8.8.8.8`,
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
- **AC-06** (BR-309, BR-308) — Given the fake clock and a counting fetch port, When
  documents carry `max-age=600`, `max-age=86400`, `max-age=10`, no header,
  `no-store` and `no-cache`, Then the port is called again exactly after
  600 s, 3,600 s, 60 s, 300 s, 60 s and 60 s; When they carry
  `MAX-AGE=600`, `public, max-age=600, max-age=10`, `max-age=abc, max-age=600`,
  `max-age="600"`, `max-age=-5`, `s-maxage=10`, `no-store, max-age=600`, two
  field lines `public` and `max-age=600`, or `max-age=600` with an `Expires`
  in the past, Then the port is called again after 600 s, 600 s, 600 s, 300 s,
  300 s, 300 s, 60 s, 600 s and 600 s; Given a request authorized with a
  document keeping `refresh_token`, When the cached document is replaced by
  one without it before consent and redemption, Then the code still yields a
  refresh token (snapshot, BR-308); Given a failing port, Then
  every request calls it again (no failure cache) within the BR-162 window;
  Given an expired entry, When the refetch fails transiently, Then the stale
  document is used until 3,600 s past expiry and then the 503 page; When it
  fails terminally, Then the 400 page and the entry is gone; ten concurrent
  requests for one URL make one call; four distinct URLs pending make a fifth
  get 503 without a call; right after one of four pending fetches times out,
  a fifth URL is fetched; the 101st URL evicts the entry discarded first;
  When the store latches while a fetch is pending and the fetch then
  succeeds, Then the 503 page and no pending consent is created (BR-128 v3);
  When the HTTP server's `close()` runs while a fetch is pending, Then the
  resolver's `cancel()` is called, the fetch socket is destroyed, the request
  gets the 503 page and no pending consent is created (BR-169 v3).
  Verified by: `tests/auth/proxy-cimd.test.ts`.
- **AC-07** (BR-310, BR-136 v2) — Given a CIMD client that completed
  authorization, When it redeems its code with `client_id` in the body and no
  secret, Then tokens are issued and the fetch port is not called; with Basic
  or a body secret, Then 401 `invalid_client`; with a code of another client,
  Then `invalid_grant`; a document without `refresh_token` yields no refresh
  token; Given a proxy whose list does not cover a CIMD client ID, When that
  client ID presents a listed client's code or a refresh token, Then 401
  `invalid_client` and
  the code and family stores are not read (spy), so the code stays
  redeemable by its own client; When the proxy is rebuilt on the same state
  file with the origin removed, Then the refresh token gets 401
  `invalid_client`. Verified by: `tests/auth/proxy-cimd.test.ts`.
- **AC-08** (BR-311, BR-295 v2, BR-298 v2, BR-299 v2, BR-302 v2) — Given a
  version 1 state file, When a CIMD client gets a refresh token, Then the
  write commits without latching and the file holds a family with the URL as
  client ID, no client row, and `user_version` 2; When that family is then
  revoked, Then `user_version` stays 2 until the next startup; When a
  transaction writes a family row whose client ID fails the CIMD client ID
  syntax (`https://127.0.0.1/c`) and names no client row, Then it is a failed write and the store
  latches, while one whose client ID `https://client.example.com/c.json`
  meets the CIMD client ID syntax commits whatever the list holds; Given a
  version 2 file holding a family with client ID
  `https://client.example.com/a/%2E%2E/b` and no client row, Then
  `OAUTH_STATE_CORRUPT`, and with `https://client.example.com/c.json` and
  the origin listed, Then it loads; When the proxy is rebuilt on the file with the same list, Then the
  refresh succeeds without fetch; When it is rebuilt with the CIMD client's
  redirect URI removed from the allowlist but the origin listed, Then the
  family is kept and the refresh succeeds; When it is rebuilt with the origin
  removed, Then the family is deleted at
  startup, `user_version` is 1 and `store_loaded` counts no family; Given a
  version 1 file holding a CIMD family row, Then `OAUTH_STATE_CORRUPT`; Given
  `user_version` 3, Then `OAUTH_STATE_VERSION`; Given 1,000 families including
  CIMD ones, Then the BR-142 v2 eviction applies to them. Verified by:
  `tests/auth/proxy-persistence.test.ts`, `tests/auth/proxy-store.test.ts`.
- **AC-09** (BR-393, BR-129 v2) — Given a CIMD client named
  `<b>Claude</b>`, When the request's `redirect_uri` is
  `http://127.0.0.1:33418/cb`, `http://127.0.0.2/cb`, `http://[::1]/cb` or
  `http://localhost:8080/cb`, Then the consent page shows the escaped client
  ID, `Client host: client.example.com`, the escaped name with the unverified
  notice and the loopback line; with an `https` `redirect_uri`, or `http` to
  `localhost.example.com`, the loopback line is absent; a registered client's page is
  byte-identical to today's. Verified by: `tests/auth/proxy-consent.test.ts`.
- **AC-10** (BR-394, BR-143 v3) — Given every refusal path of AC-02 to AC-08
  with a capturing logger and captured stderr, Then each refusal logs exactly
  one event, the event and `reason` of its row in Contract details
  "Authorization refusal events" (with an empty list, an `https` client ID
  logs today's `authorization_refused` and no `client_metadata_refused`; a
  `redirect_uri` not kept from the document logs `document`), each successful fetch
  one `client_metadata_fetched`, and no event, response or line contains the
  CIMD URL, its host, a resolved address, a document member or a TLS message.
  Verified by: `tests/auth/proxy-secrecy.test.ts`.
- **AC-11** (BR-395) — Given the updated documents, When the content tests
  run, Then each BR-395 statement (including several document URLs under one
  origin, and access tokens staying valid for up to one hour after an origin
  is removed unless the signing key is replaced), the variable and the
  discovery procedure are present in the named files. Verified by:
  `tests/docs/oauth-cimd-docs.test.ts`.
- **AC-12** (BR-305–BR-311, BR-393; rehearsal for the owner run) — Given
  `scripts/http-acceptance.ts` with the real HTTP layer, a fake upstream, a
  temporary state file, a local TLS CIMD client double (test CA and loopback
  allowed only through the rehearsal seam), the real c-ares `Resolver`
  pointed through the DNS server list seam at a stub UDP DNS server that
  answers an A record `127.0.0.1` for the double's host and an empty NOERROR
  (ENODATA) to its AAAA query (so only the CA and
  the loopback allowance are substituted, and the real resolution feeds the
  pinned `lookup`) and a listed origin, When a scripted
  client follows the discovery procedure (placeholder origin first, then the
  real one), authorizes with its URL client ID, checks the consent page's
  `Client host:` line, approves, redeems, calls a tool, the server restarts on
  the same file, the client refreshes and calls a tool again, Then each step
  gives the expected status, the consent page shows the double's host, both
  tool calls succeed, the double served the document once per freshness
  window, and the refresh needs no fetch. Verified by:
  `tests/http/cimd-rehearsal.test.ts` (`make check`).
- **AC-13** (all) — `make check` passes with the new tests, and the
  production composition passes no resolver, address policy, CA override or
  DNS server list
  (asserted by a source test on the composition). Verified by: `make check`,
  `tests/auth/proxy-construction.test.ts`.
- **AC-14** (BR-306, D-8) — Given a source test on the fetch module, Then it
  never calls `dns.lookup` and creates its `Resolver` with `timeout` 2,000 and
  `tries` 2; Given an injected `Resolver`-shaped fake that never answers, When
  5,000 ms pass on the fake clock, Then `cancel()` is called once and the
  fetch fails as `timeout`; Given a `resolve6` that fails with `ENODATA` and a
  `resolve4` returning an allowed address, Then the fetch connects to it;
  Given a `resolve4` that fails with `ESERVFAIL`, Then `resolution`; and, in a
  child process with `UV_THREADPOOL_SIZE=1` whose real `Resolver` points at a
  local UDP DNS server that never answers, When four fetches are pending,
  Then a concurrent `fs.promises.readFile` and `crypto.pbkdf2` both complete
  before the fetches time out, the stub UDP server receives no query more
  than 100 ms after the 5,000 ms deadline, and the child exits without open
  handles. Verified by: `tests/auth/cimd-fetch.test.ts`.

Owner-run acceptance (after merge, not a merge condition, recorded on the
ticket separately, as for F-019; D-13). Blocked until #25: `make
http-acceptance` does not yet read or persist `OAUTH_STATE_FILE`, and AC-12
injects the state file without exercising the launcher, so no owner run is
requested before #25 lands and its rehearsal passes. Once unblocked: run
`make http-acceptance` behind the quick tunnel (learnings
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
  fetch any public URL); an exact client-ID URL list (claude.ai documents no
  URL, one client may use several document URLs under one origin, such as
  per-callback documents, and origins are what the draft's trust policies
  describe); CIMD on by
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
  (an operator cut-off would not be effective). A CIMD family stores no
  redirect URI, so removing a URI from `OAUTH_ALLOWED_REDIRECT_URIS` cuts off
  registered clients (BR-302 purge) but acts on CIMD clients only at their
  next authorization; origin removal is their only cut-off (review 1).
  Rejected: storing the kept redirect URIs on each CIMD family (a schema
  change, which ADR-011 avoids; the operator already has origin removal as an
  effective cut-off).
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
- **D-8 — c-ares resolution and accepted residual risks.** The fetch
  resolves through a per-fetch c-ares `dns.promises.Resolver` (`resolve4` and
  `resolve6`, explicit timeout and tries, `cancel()` at the deadline), not
  `dns.lookup`: getaddrinfo runs on the libuv threadpool (4 threads by
  default) and cannot be cancelled, so with no failure cache a vendor DNS
  outage could hold every thread and stall the kDrive `dns.lookup`
  (`src/kdrive/production.ts`), crypto and file I/O; c-ares uses no threadpool
  thread and its queries end at the deadline. Pinning is unchanged: the
  agent's `lookup` returns the checked addresses from memory. Rejected:
  `dns.lookup` with an abandoning timer (the thread stays busy); a failure
  cache (D-5). Accepted residual risks: a listed origin's owner controls the
  document (bounded by the redirect allowlist and the consent page); c-ares
  reads the resolv.conf servers and ignores `/etc/hosts` and nsswitch, so a
  CIMD host cannot be overridden locally; `NODE_EXTRA_CA_CERTS`, set by the
  operator, extends the CAs trusted for the fetch; a TLS-intercepting proxy in
  front of the container is outside the threat model, and a deployment whose
  egress must go through a proxy cannot use CIMD, because the fetch ignores
  proxy variables (BR-395 says so); the 503 page during a remote outage when
  no stale entry exists.
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
- **D-12 — No client origin named in the shipped documents (owner
  decision).** `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` ships empty, and neither the
  documentation nor the example names a client origin; origins found with the
  discovery procedure are recorded in the client matrix. Rejected: naming
  vendor origins in the documentation or example (unverified; see D-2).
- **D-13 — Owner-run claude.ai check recorded separately (owner
  decision).** As for F-019, the owner-run check is recorded on the ticket
  after acceptance and is not an acceptance condition. v2: the owner run is
  blocked until #25 lands; #25's run through the real launcher (settings
  filtering and a restart on the same state file) is its rehearsal (AGENTS.md
  §6). AC-12 stays a test with the state file injected, which does not
  rehearse the launcher. Rejected: making the real claude.ai run an
  acceptance condition (depends on a third-party service and a tunnel outside the gate).

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

None. The two questions of the first draft were decided by the owner (D-12,
D-13).

## Stress-test

### Review 1 (3-spec-review-1-reviewer)

Spec at `35eb1e9`; 3 major and 12 minor findings, all retained.

1. Major, retained: getaddrinfo on the libuv threadpool cannot be cancelled,
   so a vendor DNS outage could exhaust the pool. BR-306 now resolves through
   a per-fetch c-ares `Resolver` (`resolve4` and `resolve6`, `timeout` 2,000
   ms, `tries` 2, `cancel()` at the deadline); D-8 records the choice and its
   consequences; new AC-14 (including a `UV_THREADPOOL_SIZE=1` child process).
   Checked: the c-ares path uses no threadpool thread, `Resolver` exposes
   `cancel()`, `timeout` and `tries` in the dev image (Node 26.13.0), and
   pinning still holds because the agent's `lookup` serves the checked
   addresses from memory.
2. Major, retained: BR-298 and BR-299 named the version 1 row rules, so the
   first CIMD family write would latch the store. Added BR-298 v2 and BR-299
   v2 (row rules of the version the transaction writes, defined in BR-311),
   listed in the header and Existing rules changed, cited and tested in
   AC-08.
3. Major, retained: CIMD families store no redirect URI, so the F-019
   redirect-URI purge does not cut them off. Stated in BR-302 v2, D-4 (with
   the rejected alternative of storing URIs) and BR-395; AC-08 case added.
4. Minor, retained: `rejectUnauthorized: true` set explicitly against
   `NODE_TLS_REJECT_UNAUTHORIZED=0` (BR-306, as BR-191 and BR-216 v2); that
   variable added to the AC-03 child process; `NODE_EXTRA_CA_CERTS` and
   mandatory egress proxies named in D-8 and BR-395.
5. Minor, retained: exact request headers in BR-306 (no `Accept-Encoding`,
   fixed `User-Agent: kdrive-mcp-server`); a non-`identity`
   `Content-Encoding` is a terminal `content_type` failure; AC-03 cases.
6. Minor, retained: the version stays 2 between startups after the last CIMD
   family is deleted (BR-311, Contract details, ADR-011); AC-08 case.
7. Minor, retained: pending consent, flow and code carry a snapshot of the
   resolved client, never re-resolved (BR-308, BR-310); BR-128 v3 orders the
   checks (repeated parameter, BR-305, absent or non-allowlisted
   `redirect_uri`) before any fetch; AC-02 and AC-06 cases.
8. Minor, retained: the loopback line depends on the request's
   `redirect_uri`, with loopback defined (BR-393); AC-09 cases.
9. Minor, retained: `status` defined for both events as the document
   response status, `0` when none was received (BR-394).
10. Minor, retained: `Cache-Control` parsing defined (first valid `max-age`,
    unparseable means none, other directives ignored, `no-store` and
    `no-cache` first) in BR-309; AC-06 cases.
11. Minor, retained: host grammar of BR-291 (ASCII LDH labels, A-labels for
    IDN, last label not all digits, origin serialization equality); AC-01
    cases.
12. Minor, retained: the discovery procedure removes and re-adds a connector
    that keeps its dynamic registration; BR-395 warns to list only origins
    whose every path the vendor controls.
13. Minor, retained: AC-04 samples outside a range only where a non-blocked
    neighbour exists, plus `2001:200::1` just outside `2001::/23`.
14. Minor, retained: codes do not survive the restart, so BR-310, Scope and
    BR-395 now say the cut-off is effective at the restart that applies it;
    AC-07 tests that `invalid_client` is decided before any code or family
    lookup, and the restart case covers the refresh token only.
15. Minor, retained: AC-12 rehearses the consent host line and tool calls
    before and after the restart; the owner decisions moved to D-12 and D-13
    and Open questions is empty.

Review 2 (3-spec-review-2-reviewer), `approve` on `c3dc6dc` with five minor
findings; all retained:

1. AC-01 separates the refused Unicode host from its valid A-label and adds
   a 254-character host.
2. BR-309 trims directives, matches names case-insensitively and takes the
   value after `=`; the undefined "cannot be parsed" clause is dropped.
3. BR-309 frees a fetch slot at the deadline or at any failure, after
   `cancel()` and destroying the request and socket; AC-06 adds the fifth
   fetch after a timeout.
4. AC-13 also excludes an injected DNS server list from production.
5. AC-14 measures the outstanding-query check with the stub UDP server and
   the child's open handles.

Decision pass 1 (3-spec-decision-1-fable), on `90b553f`, eight minor
findings; all retained:

1. BR-306: the agent's `lookup` returns every checked address and the
   connection uses `autoSelectFamily`, so attempts fall over between them
   within the 5,000 ms deadline; AC-03 case (unreachable first address,
   reachable second).
2. BR-394 and BR-128 v3: new Contract details "Authorization refusal events"
   maps each refusal to exactly one event: an empty list and non-CIMD client
   IDs keep today's events (Scope 1); `client_metadata_refused` only with a
   nonempty list; the repeated-parameter and `redirect_uri` pre-fetch checks
   log `authorization_refused`; a `redirect_uri` not kept from the document
   logs `document`. AC-10 checks against the table.
3. BR-128 v3: the latch re-check after the resolution creates no pending
   consent; AC-06 case.
4. New Contract details "CIMD client ID syntax", standalone and
   configuration-free, used by BR-305, BR-311, the version 2 row rule and
   ADR-011, so `OAUTH_STATE_CORRUPT` at load and the failed write are fully
   defined; AC-08 cases on each side for load and write.
5. Context reworded: claude.ai documents no document URL; the ChatGPT and
   Codex URLs are recorded in the matrix, unverified, and not repeated here
   (D-12 kept). BR-395 and D-1: one client may use several document URLs
   under one origin.
6. AC-12 resolves the double's host through the real c-ares `Resolver` and
   the DNS server list seam (stub UDP server answering an A record), so only
   the CA and the loopback allowance are substituted.
7. BR-309: the HTTP server's `close()` (BR-169 v3 step (2)) cancels in-flight
   fetches and their requests get the 503 page; AC-06 case.
8. BR-395 and AC-11: access tokens already issued stay valid until expiry
   (one hour) after an origin removal, unless the signing key is replaced.

Review 3 (3-spec-review-3-reviewer), `changes` on `d82f25f` with two minor
findings; both retained:

1. BR-309's cancellation at `close()` adds a case to BR-169: BR-169 v3 is
   listed in the header IDs and Existing rules changed, and BR-309 and AC-06
   cite it.
2. AC-12's stub DNS server also answers the AAAA query with an empty NOERROR
   (ENODATA), so the parallel `resolve6` does not time out.

Code review 1 (3-code-review-1-reviewer, PR #24), version 2 (2026-11-14):

1. [major] The owner-run restart step cannot run through `make
   http-acceptance` (no `OAUTH_STATE_FILE` in the launcher) and AC-12 does
   not exercise the launcher. Retained by deferral: the launcher is another
   contract (its mount rule), CIMD ships off with an empty origin list, and
   the owner run is not a merge condition; F-028 v2 blocks the owner run
   until #25 adds the state file and its rehearsal.
Code review 2 (3-code-review-2-reviewer, PR #24), version 2 (2026-11-14):

1. D-13 now carries the v2 change (the stray paragraph under Deviations is
   removed) and v2 stayed `ready-for-freeze` until an approving review.

Code review 3 (3-code-review-3-reviewer, PR #24): `approve`; v2 freezable;
two layout minors (a long D-13 line, this entry's heading) applied at freeze.

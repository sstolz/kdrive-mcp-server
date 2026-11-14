# OAuth proxy — operator notes

These notes cover the `proxy` mode of [F-010 v1](../features/F-010-oauth-proxy.md).
They contain no secret and no key-generation output. The proxy handlers are
transport-independent; [F-012 v1](../features/F-012-authenticated-http.md) (P-12)
mounts them on HTTP routes (see "HTTP server" below).

## Signing key (`OAUTH_SIGNING_KEY_FILE`)

- The file holds exactly one PEM `PRIVATE KEY` block (PKCS#8) with an EC P-256
  private key. Any other key type, curve or format is refused at start with one
  fixed message.
- The owner provisions the file; the server never generates a key.
- The key's `kid` is its RFC 7638 thumbprint. Restarting with the same file
  keeps issued access tokens valid until they expire (one hour). Replacing the
  file invalidates them, and clients authorize again.

## Upstream client

- Register `<MCP_PUBLIC_URL>/oauth/callback` as the redirect URI of the static
  upstream client (`OAUTH_UPSTREAM_CLIENT_ID` and its secret).
- The proxy discovers the upstream through
  `<OAUTH_ISSUER>/.well-known/openid-configuration` once and caches the result
  for the life of the process. A change of upstream endpoints or client
  authentication methods needs a restart.

## Redirect allowlist (`OAUTH_ALLOWED_REDIRECT_URIS`)

- Every entry is compared byte for byte. The only exception is the port of an
  `http` loopback URI on `127.0.0.1`, `[::1]` or `localhost`, which may vary
  (RFC 8252 §7.3).
- Prefer `127.0.0.1` entries when a client allows it: RFC 8252 prefers IP
  literals because `localhost` may resolve elsewhere.

## Discovery aliases

The same authorization-server metadata is served at the RFC 8414 path and at
both OpenID Connect discovery paths. It is not an OpenID provider configuration
(it lacks required members such as `jwks_uri`), so a strict OIDC client may
reject the alias; owner acceptance should attribute such a failure to this.

## Restart and persisted state (F-019, pending acceptance)

- Without `OAUTH_STATE_FILE` all state is in memory in one instance. A restart
  loses registered clients, pending flows and refresh tokens; clients get
  `401 invalid_client`, register again and authorize again.
- `OAUTH_STATE_FILE` (option `--oauth-state-file`, YAML `oauthStateFile`; an
  optional path of at most 4,096 characters, relative to the working
  directory, with no default) persists registered clients and refresh families
  in an SQLite file. After a restart a client refreshes without registering and
  without logging in again. The value `stderr` has no special meaning and names
  a file. The setting is accepted only with transport `http`, authentication on
  and OAuth mode `proxy`; any other configuration is refused with
  `CONFLICTING_SETTINGS`, as is a path equal to the audit log or to its
  `-journal`.
- A restart still loses pending consents, upstream flows, authorization codes
  and the discovery and JWKS caches: a login in progress starts again.
- The proxy never stores an upstream access, refresh or ID token. The file holds
  no refresh-token secret, client secret, authorization code, PKCE verifier,
  cookie or signing key: client secrets and refresh-token secrets are kept only
  as their SHA-256. A family holds the upstream `sub` and, only when
  `OAUTH_ALLOWED_EMAILS` is set, the `email` and `email_verified` claims.
- Refresh tokens are `<family id>.<secret>`; a token in the former format is
  refused with `invalid_grant`.
- Replacing the signing key keeps refresh families valid while access tokens
  fail until they are refreshed.
- A client unused for 30 days with no live family, an expired family and a
  client whose redirect URIs are all gone from `OAUTH_ALLOWED_REDIRECT_URIS`
  are purged at startup; an allowlist change is also enforced at the next
  refresh. The file holds at most 1,000 clients and 1,000 families and never
  exceeds 64 MiB.
- At startup the server logs one `store_loaded` event with the counts `clients`
  and `families` after the purge. No event, response or startup line contains
  the path, a row value or an operating-system or SQLite message.

## State file requirements

- One instance, on a local file system. The server takes an exclusive lock on
  the file from startup to shutdown, so a second process on the same file stops
  with `OAUTH_STATE_LOCKED`. Network file systems and anything that does not
  honour `fsync` are not supported.
- The directory must exist, be a real directory (not a symlink), be owned by the
  user the server runs as (UID 1000 in the image), allow that user to read,
  write and search it, and give no group or other write permission. Use mode
  `0700`. In the deployment guide this is the `/audit` mount; for example
  `OAUTH_STATE_FILE=/audit/oauth-state.sqlite`.
- The file must be a regular file (not a symlink) with one link, owned by that
  user, with mode `0600`. When it is absent the server creates it with mode
  `0600`. The server never changes the mode, owner or content of an existing
  file to make it acceptable: it refuses to start instead.
- `<path>-journal` belongs to the store. It exists while the server runs (empty
  between commits), may remain after a crash and is removed by a clean
  shutdown. Never delete, move or copy it apart from the file. Its mode and
  owner must satisfy the same checks as the file. `<path>-wal` or `<path>-shm`
  must not exist.

## State file startup errors

A refused state file stops startup before any socket is opened. The process
prints one fixed line to stderr, without the path or any value, and exits 1. The
server never repairs, replaces or deletes the file.

- `OAUTH_STATE_UNAVAILABLE` — "The OAuth state file could not be opened or is
  not private." Action: check the directory and file against "State file
  requirements" (existence, symlink, owner, mode, link count, a leftover
  `<path>-wal` or `<path>-shm`), that the mount is writable and not full, and
  correct it yourself.
- `OAUTH_STATE_LOCKED` — "The OAuth state file is in use by another process."
  Action: stop the other process or the previous container, which may still be
  shutting down, and start only one instance on the file.
- `OAUTH_STATE_CORRUPT` — "The OAuth state file is not a valid OAuth state
  file." Action: do not edit it. If the path is right and you accept that every
  user logs in again, delete the file and its `<path>-journal` while the server
  is stopped, and keep nothing of it in service.
- `OAUTH_STATE_VERSION` — "The OAuth state file was written by a newer
  version." Action: start the version that wrote it. To go back to this version
  instead, delete the file and its `<path>-journal` while the server is stopped.
- `OAUTH_STATE_MISMATCH` — "The OAuth state file belongs to another issuer,
  audience or upstream." The file is bound to the proxy issuer, the audience
  and `OAUTH_ISSUER`. Action: restore `MCP_PUBLIC_URL` and `OAUTH_ISSUER`, or
  point `OAUTH_STATE_FILE` at another path.

## The state file is a credential store

- Treat the mount as a credential store. Anyone who can write the file or its
  directory can add a client and a family for an allowlisted subject and obtain
  tokens after the next restart. The file is not signed or encrypted: nothing
  detects a modified row.
- Restoring an older copy brings back families revoked or rotated since that
  copy, so never restore the file from a backup and keep it out of backups. Give
  the mount the same protection as the signing key.
- To revoke every client and family, delete the file and its `<path>-journal`
  while the server is stopped. Every user logs in again.

## After a write failure or a downgrade

- A failed write (SQLite or I/O error, full disk, the size limit) logs one
  `store_write_failed` event with `handler` (`"register"` or `"token"`) and
  `store` (`"clients"` or `"families"`), then latches the store until restart.
  Registration and token requests answer 503 `temporarily_unavailable`; the
  authorize, consent and callback routes show the generic 503 `busy` page;
  revocations already decided stay in force in memory. Action: fix the cause,
  then restart. The revocation whose failed commit latched the store is lost at
  that restart, and its family is usable again with its current token;
  replacing the file is the only way to be sure that no revoked family
  returns, at the cost of a new login for every user.
- Starting an image without `OAUTH_STATE_FILE` ignores the file. Families from
  before the downgrade return when you upgrade again and stay valid until they
  expire. Action: replace the file before upgrading again.

## Residual risks

- There is no integrity check on the file: a writer can insert rows or restore
  an older copy (see "The state file is a credential store").
- A power loss during a commit is covered by SQLite's journal only on file
  systems that honour `fsync`; use a local file system.
- Refresh requests are limited only by the process-wide window of F-012 BR-162
  (see "HTTP server" below). Each store still holds at most 1,000 entries.
- A revocation that was not committed is lost at the next restart.
- A crash or dropped connection after a refresh commit but before the client
  receives the response makes the client present its old token, which revokes
  the family and forces a new login.
- A redirect URI removed from the allowlist stays in the client row but is never
  used.
- A hot journal owned by the same user may make SQLite create `<path>-wal`
  before the file is refused; this needs write access already equivalent to
  replacing the file.
- A `<path>-journal` left by a crash stays on disk until the next open and
  close.
- The unauthenticated OAuth routes are rate-limited by the HTTP layer (F-012
  BR-162; see "HTTP server" below).

## Client ID Metadata Documents (`OAUTH_ALLOWED_CLIENT_ID_ORIGINS`)

[F-028 v2](../features/F-028-client-id-metadata-documents.md), accepted on
main `aa540d4`. With Client ID Metadata Documents (CIMD) a client's `client_id` is
an `https` URL, and the proxy fetches the client's metadata document from it
instead of asking the client to register.

- `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` (option `--oauth-allowed-client-id-origins`,
  YAML `oauthAllowedClientIdOrigins`; comma-separated) is empty by default.
  CIMD is off while the list is empty: the metadata does not advertise it and
  every `https` client ID is an unknown client.
- Each entry is `https://<host>` or `https://<host>:<port>`, at most 16 entries
  of at most 1,024 characters. The host is a DNS name of at least two labels of
  ASCII lowercase letters, digits and hyphens (an internationalized name is
  written as its A-labels, `xn--…`), the last label not all digits, not
  `localhost`, no trailing dot; the port is not `443` (omit it) and has no
  leading zero; there is no path, trailing slash, userinfo, query or fragment.
  Anything else is refused with `INVALID_VALUE`. The setting is accepted only
  with transport `http`, authentication on and OAuth mode `proxy`, and no entry
  may be the origin of `MCP_PUBLIC_URL` or `OAUTH_ISSUER`
  (`CONFLICTING_SETTINGS`).
- A nonempty list advertises CIMD to every client
  (`client_id_metadata_document_supported`). claude.ai, Claude iOS, Claude
  Desktop, ChatGPT and Codex then use CIMD, and their documentation states no
  documented fallback to dynamic registration. The list therefore holds the
  document origin of every CIMD-capable client in use, or stays empty: a
  client whose origin is missing cannot connect.
- List an origin only when its vendor controls every path under it (no
  multi-tenant hosting where third parties can publish files under the
  origin): any document under a listed origin is accepted. One client may use
  several document URLs under one origin (for example a per-callback
  document), which is why origins, not URLs, are listed.
- A document's redirect URIs are still limited to
  `OAUTH_ALLOWED_REDIRECT_URIS`; the others are ignored. That allowlist acts on
  CIMD clients only at authorization: removing a URI from it does not cut off a
  CIMD client already holding a refresh family.
- The consent page of a CIMD client shows its client ID URL and
  `Client host: <host>` before the name, which comes from the document and is
  unverified, and says when the client redirects to this computer only.

### Origin discovery procedure

1. Start with the list empty; confirm each client connects through dynamic
   registration.
2. Set `OAUTH_ALLOWED_CLIENT_ID_ORIGINS=https://cimd-discovery.invalid` and
   restart. The metadata now advertises CIMD.
3. Connect each CIMD-capable client in use. A connector that already holds a
   dynamic registration may keep using it: remove that connector in the client
   and add it again so that it starts a new authorization. Its authorization
   request is refused with the 400 page; the browser address bar shows the
   `client_id` query parameter, whose origin is the value to list. A client that
   still connects through dynamic registration reveals no origin; record that
   in the client matrix.
4. Set the list to the origins found (no placeholder), keeping only origins
   whose vendor controls every path, and restart; connect each client again and
   approve. Record the origins found in the client matrix
   ([mcp-client-compatibility.md](mcp-client-compatibility.md)).

### Fetch limits

- One HTTPS `GET` to the exact client ID URL, with only `Accept`,
  `User-Agent: kdrive-mcp-server`, `Host` and `Connection: close`; no cookie
  or credential. No redirect is followed: only status 200 with an
  `application/json` or `application/<name>+json` body of at most 5,120 bytes,
  not compressed, received within 5,000 ms, is accepted.
- The host is resolved once through c-ares (`resolve4` and `resolve6`, 2,000 ms
  per try, 2 tries, cancelled at the deadline), never through the libuv
  threadpool. Every address must pass the address policy (IPv4 outside the
  private, loopback, link-local, shared, documentation, benchmark, multicast
  and reserved ranges; IPv6 only inside `2000::/3`, without Teredo, 6to4 and
  the documentation ranges), and the connection is pinned to the checked
  addresses.
- At most four concurrent fetches; a fifth authorization request gets the 503
  page. Valid documents are cached in memory (at most 100 entries) for their
  `max-age` clamped to 60–3,600 s, 60 s with `no-store` or `no-cache`, 300 s
  otherwise; failures are never cached. After expiry a document stays usable
  for 3,600 s when the refetch fails transiently (timeout, connection, DNS,
  429 or 5xx).
- The fetch uses a dedicated agent: it ignores proxy variables
  (`NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`), so CIMD is
  unusable where egress must go through a proxy, and it always verifies the
  certificate against Node's default CA store, whatever
  `NODE_TLS_REJECT_UNAUTHORIZED` says. `NODE_EXTRA_CA_CERTS` extends the CAs
  trusted for the fetch.
- Events: `client_metadata_refused` (`reason`: `not_allowed`,
  `blocked_address`, `resolution`, `connection`, `certificate`, `timeout`,
  `status`, `content_type`, `size`, `document` or `busy`; `status`: the
  document response status or 0) and `client_metadata_fetched` (`status`,
  `count` of cache entries). No event names a URL, host or address.

### Cut-off, tokens and the state file

- A CIMD client authenticates at the token endpoint with method `none` only;
  no document is fetched there. Removing an origin is the only cut-off for its
  clients, effective at the restart that applies it: their refresh tokens are
  refused with `401 invalid_client` and their refresh families are purged at
  that startup. Access tokens already issued to those clients stay valid until
  they expire (one hour) unless the signing key is replaced.
- With `OAUTH_STATE_FILE`, CIMD refresh families are stored with the URL as
  client ID and no client row. The file is at format version 2 while it holds
  a CIMD family, and at version 1 otherwise. An older release refuses a
  version 2 file with `OAUTH_STATE_VERSION`. To downgrade: remove the origins,
  start this release once, then downgrade; that start purges the CIMD
  families and writes version 1.

### Accepted residual risks

- The owner of a listed origin controls the document: the redirect allowlist
  and the consent page bound what it can do.
- c-ares reads the `resolv.conf` servers and ignores `/etc/hosts` and
  nsswitch, so a CIMD host cannot be overridden locally.
- `NODE_EXTRA_CA_CERTS`, set by the operator, extends the CAs trusted for the
  fetch.
- A TLS-intercepting proxy in front of the container is outside the threat
  model; a deployment whose egress must go through a proxy cannot use CIMD.
- The 503 page during a remote outage, when no stale document is cached.

## HTTP server (F-012, pending acceptance)

`src/http/` serves the proxy and the MCP endpoint over Streamable HTTP in
`proxy` mode only (`delegate` and `delegate-static` are refused at startup). The
unauthenticated `--insecure-no-auth` switch is for local development only: it
binds `127.0.0.1`, serves only the MCP endpoint and verifies no credential.

### Reverse proxy requirements

- Terminate TLS in the reverse proxy; the server speaks plain HTTP and binds
  `MCP_HTTP_HOST:MCP_HTTP_PORT` (default `127.0.0.1:3000`).
- Preserve the `Host` header and forward to the bind address. The server
  refuses any `Host` other than the public URL's host (403 `invalid_host`).
- The public URL (`MCP_PUBLIC_URL`) must have a nonempty path such as `/mcp`.
  The MCP endpoint is served at that path, and it is also the OAuth issuer and
  the token audience; an origin-only URL is refused at startup
  (`PUBLIC_URL_PATH_REQUIRED`).
- The reverse proxy's idle timeout for upstream keep-alive connections must be
  below 5 seconds (the server's `keepAliveTimeout`), or a reused socket can
  produce an intermittent 502.
- The server does not handle `X-Forwarded-*` headers, CORS or TLS.

### Routes

With public URL `https://host/mcp`: `POST` and `DELETE` `/mcp`; `GET
/.well-known/oauth-protected-resource/mcp`; the authorization-server metadata
paths of F-010; `POST /mcp/oauth/register`, `GET /mcp/oauth/authorize`, `POST
/mcp/oauth/consent`, `GET /mcp/oauth/callback`, `POST /mcp/oauth/token`. Matching
is byte-exact; any other path is 404 and any other method 405. There is no SSE
stream, no legacy `/sse` or `/messages`, and no JSON-RPC batch.

### Protocol era

Only the 2025-era sessionful protocol (`initialize`, `Mcp-Session-Id`) is
served. A client pinned to the 2026-07-28 per-request era cannot connect; SDK
clients in `auto` negotiation fall back to `initialize` after a 400 on their
`server/discover` probe.

### Limits and residual risks

- 120 authenticated MCP requests per 60 seconds per identity; 8 sessions per
  identity (the least recently used is closed on a ninth), 64 sessions in total,
  30 minutes idle and 24 hours lifetime.
- Bodies: 262,144 bytes on the MCP endpoint, 32,768 bytes on registration,
  consent and token; headers 16,384 bytes; request target 8,192 bytes;
  `headersTimeout` 10 s, `requestTimeout` 30 s, at most 256 connections.
- Process-wide windows for the unauthenticated routes: `/oauth/register` 30 per
  hour; `/oauth/authorize`, `/oauth/consent` and `/oauth/callback` 30 per minute
  each; `/oauth/token` 60 per minute. Behind a reverse proxy the peer address is
  the proxy's, so these are not per-client. An attacker who sustains more than a
  window's count keeps that route closed to the owner for as long as it does
  (registration after a restart and token refresh are then blocked). The same
  applies to the connection cap: a client holding 256 connections within the
  timeouts keeps new connections out. Add per-client-IP request and connection
  limits at the reverse proxy. MCP requests have no shared window, so invalid
  tokens never block a valid one.
- Nothing bounds the duration of a call inside the MCP server (BACKLOG).

### Owner-run acceptance composition

`make http-acceptance` runs `scripts/http-acceptance.ts` in the dev Compose
service with the real HTTP layer and upstream OIDC port and a synthetic
in-memory drive (no kDrive credential, no kDrive call). Provision
`upstream-client-secret` and `signing-key.pem` yourself in a directory outside
the checkout that holds nothing else, both readable by the dev container user
(`DEV_UID`), and name it per invocation, not in a shell profile:

```sh
HTTP_ACCEPTANCE_SECRETS_DIR=/abs/dir make http-acceptance
```

Before any Docker command, `scripts/http-acceptance-entry.sh` refuses with a
fixed line when the variable is not an absolute path, when the directory is a
symlink, inside or above the checkout, holds other entries or lacks a regular
readable file, and while a `secrets` path exists in the checkout (move the old
files out yourself; no tool moves or deletes them). The directory is mounted
read-only at `/run/secrets` for this run only, so code run by `make setup`,
`test`, `lint`, `build` or the Sonar steps never sees it; `make sonar`,
`sonar-pr` and `quality` also refuse a checkout holding `secrets` (BR-189).
Set `MCP_PUBLIC_URL`, `OAUTH_ISSUER`,
`OAUTH_ALLOWED_SUBJECTS` (or `OAUTH_ALLOWED_EMAILS`), `OAUTH_UPSTREAM_CLIENT_ID`
and `OAUTH_ALLOWED_REDIRECT_URIS` in the environment. The port
(`HTTP_ACCEPTANCE_PORT`, default 3000) is published on the host's `127.0.0.1`
only; point your HTTPS reverse proxy or tunnel at it. The upstream client
secret is refused inline. Events are written to stderr as JSON lines.

Persisted state across restarts (F-029): `HTTP_ACCEPTANCE_STATE_DIR` is
optional. Without it the proxy keeps its state in memory, so a restart loses every client and login. With it, the launcher
keeps registered clients and refresh families in `oauth-state.sqlite` in that
directory, which is mounted read-write at `/run/oauth-state` for this run only
(`OAUTH_STATE_FILE` is set by the entry script; setting it yourself is
refused). The directory must be absolute, outside the checkout and the secrets
directory, owned by the dev container user, mode `0700`, and hold nothing but
the state file and its journal (`oauth-state.sqlite` and
`oauth-state.sqlite-journal`); otherwise the entry script refuses with a fixed
line before any Docker command. On Linux the host account that owns the
directory must have the uid the dev image was built with (`DEV_UID=… make
setup`, see `docs/development.md`), otherwise the server stops with
`OAUTH_STATE_UNAVAILABLE`.

```sh
HTTP_ACCEPTANCE_SECRETS_DIR=/abs/secrets HTTP_ACCEPTANCE_STATE_DIR=/abs/state make http-acceptance
```

Keep one tunnel and the same `MCP_PUBLIC_URL` across restarts. If the tunnel
dies, its new URL needs a new `MCP_PUBLIC_URL`, and starting with it fails
with `OAUTH_STATE_MISMATCH`; then delete `oauth-state.sqlite` and its
`-journal` while the server is stopped and start over. The directory is a
credential store: delete `oauth-state.sqlite` and its `-journal` while the
server is stopped to revoke everything.

F-028 owner-run claude.ai check (restart without a new login):

1. After pulling main, run `make setup`; on Linux your account's uid must be
   the `DEV_UID` the image was built with (`docs/development.md`). Create a
   state directory outside the checkout, owned by that account, `chmod 700`,
   empty.
2. Start one quick tunnel and keep it running until step 5; set
   `MCP_PUBLIC_URL` to its URL and keep it for every start below; set
   `OAUTH_ISSUER`, `OAUTH_ALLOWED_SUBJECTS`, `OAUTH_UPSTREAM_CLIENT_ID`,
   `OAUTH_ALLOWED_REDIRECT_URIS` and a placeholder
   `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`; run
   `HTTP_ACCEPTANCE_SECRETS_DIR=… HTTP_ACCEPTANCE_STATE_DIR=… make http-acceptance`.
3. Add the connector in claude.ai; read the `client_id` origin from the
   refused authorize address bar; stop the server.
4. Set `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` to that origin, start again with the
   same state directory, connect claude.ai, check that the consent page shows
   the client host, approve, log in upstream, call a tool. If the tunnel died
   since step 2, see the recovery in step 5.
5. Stop and start the server again with the same settings, tunnel and
   directory; call a tool from the same claude.ai conversation without logging
   in again. If the tunnel died, its new URL needs a new `MCP_PUBLIC_URL`, and
   starting with it fails with `OAUTH_STATE_MISMATCH`: stop, delete
   `oauth-state.sqlite` and its `-journal`, and start over from step 2.
6. Record the origin in the client matrix and the result on the ticket. To
   clean up, stop the server and delete the state directory.

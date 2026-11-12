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

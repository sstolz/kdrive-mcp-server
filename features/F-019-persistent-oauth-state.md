---
id: F-019
title: Persistent OAuth proxy state
ticket: "#103"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-11.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `a5ee476` (main at
`18c2325`). IDs: F-019 and BR-290–BR-314 are the next unused IDs per
`git ls-tree origin/main features/ business-rules/`; the next ADR is ADR-008.
Re-check before freeze and before the PR. Revised on 2026-11-11 after the
owner's scope split (`103-decision-1-orchestrator`): Client ID Metadata
Documents (CIMD) moved to ticket #109; the BR and AC numbers they used stay
reserved here and are never reused.

## Context

The OAuth proxy of [F-010 v1](F-010-oauth-proxy.md) (mounted on HTTP by
[F-012](F-012-authenticated-http.md)) keeps all its state in the memory of one
process (BR-142). Access tokens survive a restart because they are signed with
the configured key (BR-124, BR-138), but a restart loses the dynamically
registered clients, the pending authorization flows and the refresh families.
After a routine restart or an image update every client gets `401
invalid_client` on its next refresh, registers again and sends the user
through a new login ([docs/oauth-proxy.md](../docs/oauth-proxy.md), "Restart
and residual risks").

Users affected: the owner who operates the server (restarts, image updates)
and every person connected through an MCP client in `proxy` mode (claude.ai,
Claude Desktop and iOS, Claude Code, ChatGPT, Codex; see
[docs/mcp-client-compatibility.md](../docs/mcp-client-compatibility.md)).

Facts read in the code on the base above, which shape this spec:

- The proxy keeps **no upstream token**. The callback exchanges the upstream
  code, verifies the ID token and keeps only the identity (`sub`, `email`,
  `email_verified`); the upstream access and refresh tokens are discarded
  (`callback` in `src/auth/proxy/proxy.ts`). Refreshing a proxy token never
  calls the upstream.
- Refresh families keep every rotated token hash until the family ends
  (BR-139 v1), so a family's record grows with each refresh (about 720 hashes
  in 30 days at one refresh per hour).
- The only writable location of the hardened container is the mount used for
  the audit log (F-013 BR-184, F-016 BR-239; `docs/deployment.md`, "Writable
  mount").
- `node:sqlite` is built in on the pinned Node `v26.13.0` (dev and runtime
  images use `node:26.13.0-bookworm[-slim]`). Checked on 2026-11-11 with
  `docker compose run --rm -T dev node -e '…'`: `require("node:sqlite")`,
  `new DatabaseSync(":memory:")` and a statement ran with **no
  ExperimentalWarning** on stderr, SQLite `3.54.0`; `node
  --no-experimental-sqlite` makes the module unknown
  (`ERR_UNKNOWN_BUILTIN_MODULE`) and `node --help` still describes the flag as
  "experimental node:sqlite module". The Node v26.13.1 documentation of the
  module (read 2026-11-11) gives "Stability: 1.2 - Release candidate"; its
  history says v25.7.0 "SQLite is now a release candidate" and v23.4.0/v22.13.0
  no longer require `--experimental-sqlite` (see D-2).

## Scope

1. An optional persistent store, `oauthStateFile`, for dynamically registered
   clients and refresh families, in one SQLite file on the writable mount,
   single instance only. Without it the proxy behaves as today (in memory).
2. Store security: hashes only for client secrets and refresh-token secrets,
   private file and directory checks aligned with the audit file, an exclusive
   lock, a format version and configuration binding, fail-closed startup errors
   and write failures, expiry purge and size bounds.
3. A refresh-token format that keeps reuse detection with one stored hash per
   family (BR-139 v2, BR-140 v2), and a re-check of the identity allowlists on
   every refresh.
4. Logging of the new events without any secret, and documentation updates
   (`docs/oauth-proxy.md`, `docs/deployment.md`, `examples/`, `SPEC.md` §8).

Ticket #103 also asked for Client ID Metadata Documents; by owner decision of
2026-11-11 they are specified under ticket #109 (D-13).

### Out of scope

- CIMD (Client ID Metadata Documents), its configuration and its metadata
  advertisement: #109. A `client_id` that is an `https` URL stays an unknown
  client, as today.
- Several instances or a shared store (Redis, PostgreSQL), and any network
  file system.
- The `delegate` and `delegate-static` OAuth modes.
- Persisting pending consents, upstream flows and authorization codes (lifetimes
  of 600 s and 60 s): a restart during a login fails that login with the
  existing error pages and the user starts it again (D-5).
- Storing upstream tokens, and therefore their encryption at rest and an
  encryption-key secret file (D-4).
- Token revocation (RFC 7009) and introspection endpoints, an admin command to
  list or revoke grants, store backup or export tooling.
- Changing the access-token lifetime, the signing-key handling or the HTTP
  rate windows of F-012 BR-162.
- Changing `docs/mcp-client-compatibility.md` facts or `make oidc-qualify`.
- Automatic deletion or repair of an unusable state file.

## Business rules

### Configuration

- **BR-290** — The F-002 setting `oauthStateFile` (environment
  `OAUTH_STATE_FILE`, option `--oauth-state-file`, YAML `oauthStateFile`) is an
  optional nonempty string of at most 4,096 characters without control
  characters, resolved against the working directory like `auditLog`; unlike
  `auditLog`, the value `stderr` has no special meaning and names a file. It
  has no default. It
  is accepted only when the effective configuration has transport `http`,
  `insecureNoAuth` false and OAuth mode `proxy`; set explicitly in any other
  configuration it is refused with `CONFLICTING_SETTINGS` (BR-024 v3). A
  resolved `oauthStateFile` byte-identical to the resolved `auditLog`, or a
  resolved `auditLog` byte-identical to the resolved `oauthStateFile` followed
  by `-journal`, is refused with `CONFLICTING_SETTINGS`. Verified by: AC-01.
- **BR-291** — reserved for #109 (CIMD); not part of F-019.

### Persistent store

- **BR-292** — Without `oauthStateFile` every proxy store is in memory (BR-142
  v2). With it, registered clients and refresh families (BR-139 v2) are loaded
  from the file at startup after the BR-302 purge and every change to them is written to it; pending
  consents, upstream flows, authorization codes and the discovery and JWKS
  caches stay in memory only and start empty.
  Verified by: AC-02.
- **BR-293** — Before the file is used: its parent directory must exist, be a
  directory (by `lstat`, not a symlink) owned by the effective user ID with the
  owner read, write and search bits (`mode & 0o700 === 0o700`) and no group or
  other write bit (`mode & 0o022 === 0`); the path, when present, must be by
  `lstat` a regular file (not a symlink) with one link (`nlink === 1`), owned
  by the effective user ID, with the owner read and write bits
  (`mode & 0o600 === 0o600`) and no group or other permission bit
  (`mode & 0o077 === 0`); when absent it is created with
  `O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC` and mode `0600`. The path
  `<path>-journal`, when present before SQLite opens the file, must pass the
  same checks as the path. Neither `<path>-wal` nor `<path>-shm` may exist (by
  `lstat`, whatever its type, a dangling symlink included). After SQLite has
  opened the path, a second `lstat` must give the same device and inode
  (BR-295 step (3a)), and SQLite must not have opened the database read-only,
  which is detected by the failure of the real write that BR-295 step (11)
  always commits (`BEGIN EXCLUSIVE` succeeds on a read-only database; only the
  first write fails, D-2). Any failure stops startup with
  `OAUTH_STATE_UNAVAILABLE` (BR-297), changes no mode, owner or content of the
  file or the journal and creates no `<path>-wal` or `<path>-shm`, except the
  `<path>-wal` that SQLite may create in the residual case of BR-295 step (3b)
  (D-9). Verified by: AC-03.
- **BR-294** — The store holds an exclusive lock on the file from startup to
  close (`locking_mode=EXCLUSIVE`, `busy_timeout` 0, then one `BEGIN EXCLUSIVE`
  transaction at open). A second process opening the same file stops at startup
  with `OAUTH_STATE_LOCKED` without changing the file. Because the lock is a
  POSIX `fcntl` lock that any close of a descriptor on the same file in the
  process releases, the process never opens the path or `<path>-journal`
  other than through SQLite from the moment SQLite opens the path until the
  store is closed: the BR-293 identity check and the BR-295 size check use
  `lstat` only, and the BR-293 creation descriptor and the BR-295 header-read
  descriptor are closed before SQLite opens the path. Verified by: AC-04.
- **BR-295** — The file is an SQLite database with `application_id`
  `0x4B444F53` and `user_version` `1`, holding exactly the version 1 schema of
  Contract details, and is opened and checked in this order, the first failing
  step deciding the code:
  (1) the BR-293 checks (`OAUTH_STATE_UNAVAILABLE`);
  (2) a file larger than 67,108,864 bytes by the step (1) `lstat` gives
  `OAUTH_STATE_CORRUPT`; a nonempty file is refused with `OAUTH_STATE_CORRUPT` unless its first
  100 bytes, read through a descriptor opened with
  `O_RDONLY | O_NOFOLLOW | O_CLOEXEC` and closed before SQLite opens the path,
  exist, start with the 16 bytes `SQLite format 3\0` and have bytes 18 and 19
  both equal to 1 (rollback journal, not WAL);
  (3a) SQLite opens the path, then the second BR-293 `lstat` identity check
  runs (`OAUTH_STATE_UNAVAILABLE`);
  (3b) the BR-294 `BEGIN EXCLUSIVE` runs, its failure mapped by the primary
  result code `errcode & 0xff` of the thrown error (extended codes such as
  `SQLITE_BUSY_RECOVERY` 261 map with their primary code): `SQLITE_BUSY` (5)
  or `SQLITE_LOCKED` (6) gives `OAUTH_STATE_LOCKED`, `SQLITE_CORRUPT` (11) or
  `SQLITE_NOTADB` (26) gives `OAUTH_STATE_CORRUPT`, any other code gives
  `OAUTH_STATE_UNAVAILABLE`;
  `trusted_schema=OFF` and `secure_delete=ON` are set before the schema or any
  row is read;
  `PRAGMA journal_mode` must then return `delete`, otherwise
  `OAUTH_STATE_CORRUPT`; a zero-length file is then initialized to version 1,
  meta included, in one transaction;
  (4) an `application_id` other than `0x4B444F53` gives `OAUTH_STATE_CORRUPT`;
  (5) a `user_version` above 1 gives `OAUTH_STATE_VERSION`, before any other
  check of the content, and a `user_version` below 1 gives
  `OAUTH_STATE_CORRUPT`;
  (6) a `PRAGMA integrity_check` result other than the single row `ok` gives
  `OAUTH_STATE_CORRUPT`;
  (7) a schema other than the version 1 schema gives `OAUTH_STATE_CORRUPT`:
  its `sqlite_schema` rows, compared on `type`, `name`, `tbl_name` and `sql`,
  differ in any way from the rows that the version 1 initialization creates,
  so any extra table, index, trigger or view is refused;
  (8) more rows than BR-303 allows in `clients` or `families`, counted with
  `COUNT(*)` before any row is read and before the purge, gives
  `OAUTH_STATE_CORRUPT`;
  (9) a row of any table, expired or not, that breaks a version 1 row rule of
  Contract details gives `OAUTH_STATE_CORRUPT`;
  (10) the meta check of BR-296 (`OAUTH_STATE_MISMATCH`);
  (11) one transaction, always committed, that sets `user_version` to 1 again
  (a real write even when nothing is purged) and runs the BR-302 startup
  purge.
  An SQLite error thrown by steps (4) to (10) gives `OAUTH_STATE_CORRUPT` when
  its `errcode & 0xff` is `SQLITE_CORRUPT` (11) or `SQLITE_NOTADB` (26), and
  `OAUTH_STATE_UNAVAILABLE` otherwise.
  A later format version migrates upward only, from each older version in one
  exclusive transaction after step (5), and is defined by the feature that
  introduces it, including where its checks run; version 1 has no migration.
  An SQLite or I/O error in the zero-length initialization, a migration or the
  step (11) transaction (a read-only open included) rolls that transaction back and stops startup with
  `OAUTH_STATE_UNAVAILABLE`. A refusal after SQLite opened the path closes that connection,
  releasing its lock, before the error is raised. A refused file is left
  unchanged, with one
  exception: SQLite's rollback of a hot journal that passed BR-293, which
  happens when SQLite opens the file, is the only change allowed before a
  refusal under this rule or BR-296. Verified by: AC-03, AC-05, AC-12, AC-23.
- **BR-296** — The file's `meta` table binds it to the exact strings the proxy
  uses for its tokens (BR-124): `issuer` is the proxy issuer, the WHATWG
  serialization of `publicUrl` without trailing slashes; `audience` is the
  configured audience as used for `aud`, which the HTTP handler sets to
  `publicUrl` verbatim; `upstream_issuer` is the WHATWG serialization of
  `oauthIssuer` without trailing slashes. They are written when the file is
  initialized; a file whose three values are not byte-identical to these
  strings for the effective configuration stops startup with
  `OAUTH_STATE_MISMATCH` and is left unchanged. Verified by: AC-05.
- **BR-297** — A store refusal at startup raises `HttpStartupError` with code
  `OAUTH_STATE_UNAVAILABLE`, `OAUTH_STATE_LOCKED`, `OAUTH_STATE_CORRUPT`,
  `OAUTH_STATE_VERSION` or `OAUTH_STATE_MISMATCH`, before any socket is opened;
  the process writes exactly that code's fixed line of Contract details to
  stderr and exits 1. No line contains the path, a configuration value, a row
  value or an operating-system or SQLite message. Verified by: AC-06.
- **BR-298** — The store uses `journal_mode=DELETE`, `synchronous=FULL`,
  `secure_delete=ON` and `journal_size_limit=0`. `<path>-journal` is part of
  the store: under `locking_mode=EXCLUSIVE` it stays on disk while the store is
  open, is truncated to 0 bytes at each commit, is removed by a clean close,
  and after a crash may remain empty or as a hot journal; it is then checked by BR-293 and the next open succeeds. Each
  row the store writes passes the version 1 row rules of Contract details
  before its transaction commits. Each request that changes persisted state commits its changes in one
  synchronous transaction before its response is built and before its first
  `await` after the change: the registration response (201) only after the
  client row is committed, a token response carrying a refresh token only after
  its family row holds that token's hash, every family revocation or deletion
  (BR-140 v2 steps (2) and (3), BR-137 code replay, BR-301 identity refusal)
  before its `invalid_grant` response, and a BR-142 v2 eviction in the transaction of the
  entry that caused it, before that request's response. A client's last use is written on registration
  and in the transaction of each successful token response; an authorization
  request updates it in memory only. Verified by: AC-04, AC-07, AC-23.
- **BR-299** — A failed write is any of: an SQLite or I/O error, including a
  full disk, the page limit of BR-303 and a write on a closed store (BR-304);
  a row to be written that breaks a version 1 row rule; an `UPDATE` or
  `DELETE` keyed by primary key on a row held in memory whose `changes` count
  is not 1. It rolls the transaction back, throws nothing to the caller and
  latches the store; the request whose write failed answers the 503 below and
  issues no token, code or client. From then until restart the in-memory state keeps every revocation
  already decided but takes no other change, and registration and every token
  request answer 503 `{"error":"temporarily_unavailable"}` with the BR-136
  headers (registration: `Cache-Control: no-store`) without reading or
  consuming a code or refresh token; authorization, consent and
  `/oauth/callback` requests answer the 503 HTML error page of BR-142 v2
  without calling the upstream and without consuming a pending flow. One `store_write_failed` event is
  logged at the latch, except for a write on a store already closed under
  BR-304, which latches without logging any event. Verified by: AC-08.
- **BR-300** — The proxy never stores, in memory or in the file, an upstream
  access, refresh or ID token after the callback returns. The file never holds
  a refresh-token secret, client secret, authorization code, PKCE verifier,
  `nonce`, `state`, cookie value, access token, upstream client secret or
  signing-key material: client secrets and refresh-token secrets are stored
  only as their SHA-256 (input encoding in Contract details). A family stores
  the upstream `sub`, and, only when `oauthAllowedEmails` is nonempty, `email`
  when the ID token's `email` claim is a string (otherwise `NULL`) and
  `email_verified`. Verified by: AC-09.

### Refresh, purge and bounds

- **BR-301** — After BR-140 v2 step (3) and before its step (4), a refresh
  request that passed steps (1)–(3) is refused with 400 `invalid_grant`, and its family revoked (one
  `refresh_family_revoked` event), when the family's identity no longer
  satisfies the current subject and email allowlists under the F-010 rule used
  at the callback (`identity_refused`); no token is issued. Verified by: AC-10.
- **BR-302** — Expired state is purged at startup and before each write, in
  memory and in the file: a family whose absolute or inactivity expiry
  (BR-139 v2) has passed, and a dynamically registered client whose last use is
  30 days or more in the past and that has no live family. A revoked family is
  deleted in the transaction that revokes it. The startup purge also deletes,
  with its families, every registered client none of whose stored redirect
  URIs matches an entry of the current `oauthAllowedRedirectUris` under BR-126.
  Verified by: AC-11, AC-22.
- **BR-303** — The client and family stores each hold at most 1,000 entries
  (BR-142 v2) and a family holds one current token hash. The database
  `max_page_count` is set at open so that the file cannot exceed 67,108,864
  bytes; a write that would exceed it fails under BR-299. A file holding more
  than 1,000 rows in either table is refused at open (BR-295 step (8)).
  Verified by: AC-05, AC-12.
- **BR-304** — The HTTP handler opens the store (BR-152 v2), holds its only
  reference and exposes `closeStore()`; the store is closed exactly once: by
  the HTTP server's `close()` calling `closeStore()` as BR-169 v2 step (6), after the listener has closed and before that
  `close()` resolves, which also covers `LISTEN_FAILED`; and, when the proxy
  construction throws, by the handler before the error leaves
  `createHttpHandler`. The handler's own `close()` (BR-169 v2 step (2)) does
  not close the store. A closed store releases its lock, and a write on it is
  a BR-299 failure. Step (6) catches any throw from `closeStore()`: the store
  counts as closed and the server's `close()` still resolves; further calls
  do nothing. Verified by: AC-13.

### Reserved for #109

- **BR-305** — reserved for #109 (CIMD); not part of F-019.
- **BR-306** — reserved for #109 (CIMD); not part of F-019.
- **BR-307** — reserved for #109 (CIMD); not part of F-019.
- **BR-308** — reserved for #109 (CIMD); not part of F-019.
- **BR-309** — reserved for #109 (CIMD); not part of F-019.
- **BR-310** — reserved for #109 (CIMD); not part of F-019.
- **BR-311** — reserved for #109 (CIMD); not part of F-019.

### Logging and documentation

- **BR-312** — The proxy adds the events `store_write_failed` (fields
  `handler`, `store`) and `store_loaded` (fields `clients`, `families`, logged
  once at startup with the counts after purge). Under BR-143 v2 no event,
  response or startup line contains the state-file path, a row value or an
  SQLite, JSON-parser or operating-system message. Verified by: AC-19.
- **BR-313** — `docs/oauth-proxy.md` replaces "Restart and residual risks" with
  sections that state: what `OAUTH_STATE_FILE` persists and what a restart
  still loses; the file and directory requirements and the five startup codes
  with the operator action for each; the single-instance and local-file-system
  restriction; that replacing the signing key keeps refresh families valid
  while access tokens fail until refreshed; that the file and its directory
  are a credential store: anyone who can write either can add a client and a
  family for an allowlisted subject and obtain tokens after the next restart,
  and restoring an older copy brings back families revoked or rotated since,
  so the mount gets the same protection as the signing key and the file is
  never restored from a backup; that `<path>-journal` belongs to the store
  (it exists while the server runs and may remain after a crash) and is never
  deleted, moved or copied apart from the file; that deleting the file and its
  `<path>-journal` while the server is stopped revokes every client and family
  (every user logs in again); the
  operator action after `store_write_failed` (fix the cause,
  then restart; the revocation whose failed commit latched the store is lost at
  that restart, and
  replacing the file is the only way to be sure no revoked family returns, at
  the cost of a new login for every user); the operator action after a
  downgrade to an image without `OAUTH_STATE_FILE` (replace the file before
  upgrading again, or families from before the downgrade return); and the
  residual risks of D-9. Verified by: AC-20.
- **BR-314** — `docs/deployment.md` states in its existing audit-log section
  that `OAUTH_STATE_FILE` uses the same writable mount, in the step-by-step
  guide how to enable it, and in Troubleshooting each `OAUTH_STATE_*` line;
  `examples/compose.yaml` and `examples/config.yaml` add only commented lines
  for the new setting; every example path of the state file uses the
  existing `/audit/` mount (for example `/audit/oauth-state.sqlite`), never a
  prefix that BR-186 forbids; `SPEC.md` §8 "Contrat du mode `proxy`" updates its
  "Enregistrement" and "Stockage" bullets in the file's language. The BR-184,
  BR-185, BR-186 and BR-187 v2 tests pass unchanged. Verified by: AC-20.

### Existing rules changed

Each is versioned in the feature PR under AGENTS.md §7; the new text below
replaces the old one only where stated.

- **BR-023 v2** (F-002) — adds the bounds of BR-290.
- **BR-024 v3** (F-002) — adds `oauthStateFile` to the proxy-only settings.
- **BR-124 v2** — `createOAuthProxy` also takes an optional state-store port
  (opened, checked, purged and loaded beforehand by `openOAuthStateStore`);
  construction still performs no network or clock I/O and reads state only
  through the store port.
- **BR-128 v2** — the `redirect_uri` matches only when it matches under
  BR-126 both a registered URI of the client and an entry of the current
  `oauthAllowedRedirectUris`, otherwise the 400 HTML error page with no
  redirect; the handler is otherwise unchanged.
- **BR-139 v2** — a refresh token is `<family id>.<secret>`: the family ID is
  16 random bytes and the secret 32 random bytes, both base64url without
  padding (66 characters). A family stores the client ID, identity, resource,
  creation time and only the SHA-256 of its current secret (input in Contract
  details) with its issue time.
  Expiries and rotation are unchanged; rotated secrets are not kept.
- **BR-140 v2** — step (1): a malformed token, an unknown family ID or a
  revoked family yields 400 `invalid_grant`; step (2): a known family whose
  current secret hash differs (constant-time comparison) or that belongs to
  another client is revoked and yields 400 `invalid_grant`; steps (3)–(4),
  concurrency and success are unchanged; BR-301 runs after step (3) and
  before step (4).
- **BR-142 v2** — state is in memory only without `oauthStateFile` (BR-292);
  purge also follows BR-302; a full store's eviction is written to the file in
  the transaction of the entry that caused it; a latched store (BR-299) answers
  503 as stated there.
- **BR-143 v2** — the event list adds BR-312's events and the field list adds
  `clients` and `families`.
- **BR-152 v2** (F-012) — with `oauthStateFile` set, the handler opens the
  store (BR-293–BR-297) before constructing the proxy and before any socket is
  opened.
- **BR-169 v2** (F-012) — `close()` step (5) waits until the listener is
  closed instead of resolving; a new step (6) then closes the OAuth state
  store when the handler opened one (BR-304), and `close()` resolves after
  step (6). Steps (1)–(4) and the rest of the rule are unchanged.

## Contract details

### Startup lines (BR-297)

| Code                      | Line                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| `OAUTH_STATE_UNAVAILABLE` | The OAuth state file could not be opened or is not private.             |
| `OAUTH_STATE_LOCKED`      | The OAuth state file is in use by another process.                      |
| `OAUTH_STATE_CORRUPT`     | The OAuth state file is not a valid OAuth state file.                   |
| `OAUTH_STATE_VERSION`     | The OAuth state file was written by a newer version.                    |
| `OAUTH_STATE_MISMATCH`    | The OAuth state file belongs to another issuer, audience or upstream.   |

### Version 1 schema (BR-295)

Every table is `STRICT`; times are integer milliseconds since the epoch.

- `meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` with exactly the keys
  `issuer`, `audience`, `upstream_issuer`.
- `clients(id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL, grant_types TEXT
  NOT NULL, method TEXT NOT NULL, name TEXT, secret_hash BLOB, last_use INTEGER
  NOT NULL)`; `redirect_uris` and `grant_types` are JSON arrays.
- `families(id TEXT PRIMARY KEY, client_id TEXT NOT NULL, sub TEXT NOT NULL,
  email TEXT, email_verified TEXT, resource TEXT NOT NULL, created INTEGER NOT
  NULL, token_hash BLOB NOT NULL, token_issued INTEGER NOT NULL)`;
  `email_verified` is the JSON value copied from the ID token.

The schema is created by these three `CREATE TABLE` statements, exactly as
written above, in this order; `sqlite_schema` then also holds the automatic
primary-key indexes SQLite creates for them, and nothing else.

### Version 1 row rules (BR-295)

Every row loaded at startup satisfies all of these; any row that does not,
including a JSON text that does not parse, makes the open fail with
`OAUTH_STATE_CORRUPT` without reporting the parser message or the value.

- `meta`: exactly the three keys above, each value a string.
- `clients`: `id` is 43 base64url characters (32 random bytes, BR-127), so
  an `https://` client ID is invalid; `redirect_uris` parses to a JSON array
  of 1 to 10 distinct nonempty strings (whether each is still allowed is
  decided by BR-302 and BR-128 v2, not by this rule); `grant_types` parses to a
  JSON array of distinct strings from `authorization_code` and
  `refresh_token` that contains `authorization_code`; `method` is `none`,
  `client_secret_basic` or `client_secret_post`; `name` is `NULL` or a string
  of 1 to 200 Unicode code points without control characters (BR-127); `secret_hash` is `NULL` when `method` is `none`
  and otherwise a BLOB of exactly 32 bytes; `last_use` is not negative.
- `families`: `id` is 22 base64url characters (BR-139 v2); `client_id` is
  the `id` of a row of `clients`; `sub` is 1 to 255 bytes of UTF-8; `email` is
  `NULL` or a string; `email_verified` is `NULL` or a text that parses as JSON;
  `resource` is byte-identical to the `meta` value `audience` (BR-128);
  `token_hash` is a BLOB of exactly 32 bytes;
  `created` and `token_issued` are not negative and `created` is not after
  `token_issued`; the store writes `token_issued` as the larger of the clock
  value and `created`, so a backward clock step cannot break this rule.

### Hash inputs (BR-300, BR-139 v2)

- `secret_hash` is the SHA-256 of the UTF-8 bytes of the issued
  `client_secret` text (43 base64url characters).
- `token_hash` is the SHA-256 of the UTF-8 bytes of the secret part of the
  refresh token (the 43 base64url characters after the `.`), not of the
  whole token and not of the decoded random bytes.
- Hashes are stored as the raw 32-byte digest and compared in constant time.

### Planned code layout

- `src/auth/proxy/store.ts`: `openOAuthStateStore` and the store port.
- `src/config-values.ts`: the `oauthStateFile` row is appended at the end of
  `inventory`, because `proxyKeys` is `inventory.slice(27)`.

## Acceptance criteria

Tests use a fake clock, a deterministic random source, a fake upstream port,
synthetic P-256 keys and temporary directories created per test; none reads a
real secret or contacts a network host other than a local test server.

- **AC-01** (BR-290, BR-023 v2, BR-024 v3) — Given the key through
  environment, option and YAML, When the configuration loads in proxy mode,
  Then a relative state path is resolved against the working directory; Given
  stdio, insecure HTTP or a non-proxy mode with the key set, Then
  `CONFLICTING_SETTINGS`; Given `oauthStateFile` and
  `auditLog` that resolve to the same path (one relative, one absolute), Then
  `CONFLICTING_SETTINGS`; Given `auditLog` that resolves to
  `<oauthStateFile>-journal`, Then `CONFLICTING_SETTINGS`; Given a path of
  4,097 characters, Then `LIMIT_EXCEEDED`; Given an empty value or a path
  with a control character, Then `INVALID_VALUE`; Given the value `stderr`,
  Then it resolves to the file `stderr` in the working directory. Verified by:
  `tests/config.test.ts`, `tests/config-value-boundaries.test.ts`.
- **AC-02** (BR-292, BR-124 v2, BR-142 v2) — Given a store file, When a client registers,
  obtains a code and a refresh token, and a new proxy is built on the reopened
  file, Then the refresh succeeds and the registration is known, while a
  consent identifier, upstream `state` and code issued before the reopen are
  refused as unknown; Given no state file, Then the existing BR-142 restart test
  still passes. Verified by: `tests/auth/proxy-persistence.test.ts`,
  `tests/auth/proxy-restart.test.ts`.
- **AC-03** (BR-293, BR-295) — Given a missing parent, a parent that is a
  symlink, owned by another user (port fake) or with mode
  `0o770`/`0o777`/`0o500`, a path that is a symlink, a directory, a FIFO, a
  file with two hard links, owned by another user or with mode `0o640`, a
  path swapped between the checks, a `<path>-journal` that is a symlink, a
  directory, owned by another user or with mode `0o640`, a `<path>-wal` that
  is a regular file or a dangling symlink, and a `<path>-shm` that is a
  regular file, When the store opens, Then `OAUTH_STATE_UNAVAILABLE`, mode,
  owner and content of the file and the journal are unchanged and no
  `<path>-wal` or `<path>-shm` is created; Given a valid file of mode `0400`
  holding an expired family, Then `OAUTH_STATE_UNAVAILABLE` and the file bytes
  are unchanged; Given a valid file holding an expired family whose purge
  commit fails (fault-injecting port), Then `OAUTH_STATE_UNAVAILABLE` and the
  file bytes are unchanged; Given a valid file, with and without an expired
  family, that the real `DatabaseSync` opens with `readOnly: true` (test port
  passing the option), Then `OAUTH_STATE_UNAVAILABLE`, the file bytes are
  unchanged and the connection is closed; Given a fault-injecting port whose
  step (3b) `BEGIN EXCLUSIVE` throws with `errcode` 5, 261
  (`SQLITE_BUSY_RECOVERY`), 11, 26 or 1544 (`SQLITE_READONLY_DIRECTORY`), Then
  respectively `OAUTH_STATE_LOCKED`, `OAUTH_STATE_LOCKED`,
  `OAUTH_STATE_CORRUPT`, `OAUTH_STATE_CORRUPT` and `OAUTH_STATE_UNAVAILABLE`,
  and the connection is closed; Given a port that throws at step (6) with
  `errcode` 11 and at step (7) with `errcode` 10 (`SQLITE_IOERR`), Then
  respectively `OAUTH_STATE_CORRUPT` and `OAUTH_STATE_UNAVAILABLE`; Given an absent path in a `0700` directory, Then
  the file is created with mode `0600`. Verified by:
  `tests/auth/proxy-store.test.ts`.
- **AC-04** (BR-294, BR-298) — Given a store open in one child process, When a second
  child process opens the same file, Then it fails with `OAUTH_STATE_LOCKED`
  and the first keeps working; after the first closes, a new open succeeds;
  Given a store opening on an existing file and on an absent one, with the
  `node:fs` functions that open a descriptor spied, Then no descriptor is
  opened on the path or `<path>-journal` after SQLite has opened the path, the
  size and identity checks call `lstat` only, and a second child process
  started after the open still fails with `OAUTH_STATE_LOCKED`; Given an open
  refused with `OAUTH_STATE_CORRUPT` after SQLite opened the path, When a child
  process then opens a valid file at the same path, Then it succeeds; Given a
  store whose child process committed a write, When the commit returns, Then
  `<path>-journal` is 0 bytes while the store is open; When the child closes the store,
  Then no `<path>-journal` remains, and When instead the child is killed with
  `SIGKILL` after the commit, Then the `<path>-journal` left behind (mode
  `0600`) passes BR-293, a new open succeeds and loads the committed rows.
  Verified by: `tests/auth/proxy-store.test.ts`.
- **AC-05** (BR-295, BR-296) — Given a zero-length file, Then it is
  initialized with `application_id` `0x4B444F53`, `user_version` 1 and the
  meta values; Given random bytes, another SQLite database, a truncated file,
  an extra column, an extra table, an extra index, a trigger, a view, a
  version 1 table created with different SQL text, 1,001 client rows, a
  64 MiB + 1 byte file, a 50-byte file, a valid version 1 file whose header
  bytes 18 and 19 are 2 (WAL), and one row each with `redirect_uris` that is not
  JSON, `grant_types` that is a JSON object, `method` `private_key_jwt`, a
  31-byte `secret_hash`, a `secret_hash` with method `none`, a client `id`
  `https://client.example.com/cimd`, a family whose `client_id` has no client
  row, a 33-byte `token_hash`, a `resource` different from the meta
  `audience`, a 201-code-point `name`, and an expired family with a 33-byte
  `token_hash`, Then `OAUTH_STATE_CORRUPT`, no `<path>-wal` or `<path>-shm`
  exists afterwards, the stderr line
  is the fixed line only and no seeded value or parser message appears; the
  opened database reports `trusted_schema` 0; Given `user_version` 2 on a
  version 1 schema, and `user_version` 2 with an extra table and a row that
  breaks a version 1 row rule, Then `OAUTH_STATE_VERSION`; Given another
  issuer and an expired family, Then `OAUTH_STATE_MISMATCH` and the expired
  family is still in the file; Given another issuer, audience or upstream issuer,
  Then `OAUTH_STATE_MISMATCH`, and Given a `publicUrl` with a trailing slash
  the stored `issuer` has none while the stored `audience` equals `publicUrl`
  byte for byte; in each refusal the file bytes are unchanged;
  Given a valid file with a private hot journal left by an interrupted write,
  Then the open rolls it back and the rows committed before that write are
  loaded; Given the same file and journal with another issuer, Then
  `OAUTH_STATE_MISMATCH` and the file bytes equal those after the rollback.
  Verified by: `tests/auth/proxy-store.test.ts`.
- **AC-06** (BR-297, BR-152 v2) — Given each refusal, When `startHttpServer`
  runs, Then it raises the code before any listener exists and the main entry
  writes exactly the Contract details line and exits 1; no output contains the
  path or a seeded row value. Verified by: `tests/http/state-startup.test.ts`.
- **AC-07** (BR-298) — Given a store port that records commits, When
  registration, code redemption, refresh, reuse revocation, code-replay
  revocation (BR-137), identity revocation (BR-301) and a store-full eviction
  run, Then each commit precedes the response and the response body is built
  only after it;
  two concurrent presentations of one refresh token yield one success and one
  revocation, both persisted. Verified by:
  `tests/auth/proxy-persistence.test.ts`.
- **AC-08** (BR-299) — Given a store whose commit fails (fault-injecting port,
  and a real file with a page limit reached), When a refresh runs, Then 503
  `temporarily_unavailable`, no token is issued, no exception escapes, the
  presented token is still current in the file,
  later registration and token requests get 503 without consuming anything,
  authorize, consent and `/oauth/callback` get the 503 page and the fake
  upstream receives no request, and one `store_write_failed` is logged;
  Given a commit that fails at registration, Then 503 and the client ID is
  unknown afterwards; Given a commit that fails at code redemption, Then 503
  and no token is issued; Given a reuse revocation whose commit fails, When
  the family's current token is then presented, Then 503 and no token; Given
  a keyed `UPDATE` reporting 0 changes and a row breaking a version 1 row rule
  (fault-injecting port), Then each latches the store as above. Verified by:
  `tests/auth/proxy-persistence.test.ts`.
- **AC-09** (BR-300) — Given a full flow with a secret client, the email
  allowlist empty then nonempty and two refreshes, When the file
  bytes (including any journal) are scanned, Then none contains any issued
  client secret, refresh token, refresh secret, code, verifier, nonce, state,
  cookie, access token, upstream token, upstream secret or signing-key PEM, raw
  or base64url; `email` is absent with the empty allowlist; Given the
  nonempty allowlist and an ID token whose `email` is a number, Then the
  family is committed with `email` `NULL` and the store is not latched; a
  stored `token_hash` equals the SHA-256 of the UTF-8 secret part of the
  issued token; after the callback
  the fake upstream token values are absent from a serialization of every
  in-memory store. Verified by:
  `tests/auth/proxy-secrecy.test.ts`.
- **AC-10** (BR-301, BR-139 v2, BR-140 v2) — Given a family, When its token
  is refreshed, Then the new token matches `^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$`
  and the old one, presented again, revokes the family; a forged secret with a
  valid family ID revokes it; an unknown family ID does not revoke anything;
  a token in the former format (43 base64url characters, no `.`) yields
  `invalid_grant` and revokes nothing; the current token presented by another
  registered client yields `invalid_grant` and revokes the family; When the
  subject is removed from the allowlist and the proxy rebuilt on the same
  file, Then refresh yields `invalid_grant` and the family is gone, also when
  the request carries a `resource` different from the family's (BR-301 runs
  before BR-140 v2 step (4), so the answer is not `invalid_target`).
  Verified by: `tests/auth/proxy-refresh.test.ts`.
- **AC-11** (BR-302) — Given families at each side of the 30-day absolute and
  7-day inactivity limits and clients at each side of the 30-day client limit
  with and without a live family, When the store opens and when a write runs,
  Then exactly the expired ones are removed from memory and file. Verified by:
  `tests/auth/proxy-persistence.test.ts`.
- **AC-12** (BR-303, BR-295) — Given 1,000 clients and 1,000 families persisted, When
  one more of each is created, Then BR-142 eviction applies and the file holds
  1,000 of each after reopening; the opened database reports a
  `max_page_count` whose product with `page_size` is at most 67,108,864;
  Given a file holding 1,000 clients and 1,001 families, When the store opens,
  Then `OAUTH_STATE_CORRUPT`. Verified by: `tests/auth/proxy-bounds.test.ts`.
- **AC-13** (BR-304, BR-169 v2) — Given a running server with a state file and a store
  port that records calls, When SIGTERM shutdown completes, Then the store was
  closed once, not during the handler's `close()`, after the listener closed
  and before the server's `close()` resolved, and a new open of the file in a
  child process succeeds; Given a token request whose handling is held by a
  deferred fake port until after the store is closed, When it resumes and
  writes, Then it gets 503 `temporarily_unavailable`, no token is issued, no
  `store_write_failed` event is logged and no exception or unhandled rejection
  escapes;
  Given a listening port already in use (`LISTEN_FAILED`) and a proxy
  construction that throws, When `startHttpServer` fails, Then the store was
  closed once and a new open of the file in a child process succeeds; Given a
  store port whose close throws, When SIGTERM shutdown runs, Then the server's
  `close()` resolves, no unhandled rejection escapes and a child process opens
  the file. Verified by: `tests/http/lifecycle.test.ts`.
- **AC-14** — moved to #109.
- **AC-15** — moved to #109.
- **AC-16** — moved to #109.
- **AC-17** — moved to #109.
- **AC-18** — moved to #109.
- **AC-19** (BR-312, BR-143 v2) — Given every refusal path of AC-03 to AC-13
  with a capturing logger and captured stderr, Then the event names and fields
  are exactly those of BR-143 v2 and no event or line contains the state path,
  a seeded row value, an SQLite message or a JSON-parser message;
  Given a file with live and expired rows, When the store opens, Then
  `store_loaded` is logged exactly once with `clients` and `families` equal to
  the counts after the purge. Verified by: `tests/auth/proxy-secrecy.test.ts`.
- **AC-20** (BR-313, BR-314) — Given the updated documents, When the content
  tests run, Then `docs/oauth-proxy.md` contains the statements of BR-313
  (including the credential-store warning, the delete-to-revoke-all action,
  the `store_write_failed` and downgrade operator actions), each
  `OAUTH_STATE_*` code appears in it and in `docs/deployment.md`
  Troubleshooting, the examples' new lines are comments only, and
  `tests/deployment-examples.test.ts` passes unchanged. Verified by:
  `tests/docs/oauth-state-docs.test.ts`, `tests/deployment-examples.test.ts`.
- **AC-21** (BR-292, BR-298, rehearsal for the owner run) — Given the real HTTP
  layer, a fake upstream and a temporary state file, When a client registers,
  authorizes and gets tokens, the server closes and a new server starts on the
  same file, Then a refresh over HTTP succeeds without registration or login.
  Verified by: `tests/http/state-restart.test.ts`. The owner-run check with a
  real client (restart without reconnecting) is recorded separately after
  acceptance and is not a merge condition.
- **AC-22** (BR-128 v2, BR-302) — Given a file holding client A registered
  with `https://a.example/cb` and `https://b.example/cb` and client B registered
  with `https://b.example/cb` only, each with a family, When a new proxy is
  built on the file with `oauthAllowedRedirectUris` reduced to
  `https://a.example/cb`, Then client B and its family are gone from memory and
  file, client A is kept, an authorization request of A with `redirect_uri`
  `https://b.example/cb` gets the 400 HTML error page with no redirect, and one
  with `https://a.example/cb` reaches consent. Verified by:
  `tests/auth/proxy-persistence.test.ts`.
- **AC-23** (BR-295, BR-298) — Given the state files produced by the AC-02,
  AC-07, AC-10 and AC-12 flows, one of them with the fake clock stepped back
  by one hour between a family's creation and its refresh, When a store is
  opened on each file, Then the open succeeds and loads the same rows, and
  that family's `token_issued` equals its `created`. Verified by:
  `tests/auth/proxy-persistence.test.ts`.

## Decisions

- **D-1 — Persist only what a restart breaks for users.** Clients and refresh
  families are what make a client re-register and the user log in again.
  Pending flows live 600 s, codes 60 s, caches refill. Rejected: persisting
  everything (more secret-bearing rows such as PKCE verifiers, for a rare
  mid-login restart).
- **D-2 — `node:sqlite` (`DatabaseSync`) as the store.** Synchronous
  transactions keep the existing "committed before the first `await`"
  guarantees (BR-137, BR-140) with no new async race; SQLite gives atomic
  commits, crash recovery from its journal, an exclusive lock that enforces the
  single instance, and row-level writes. It is built into the pinned Node, so no
  dependency is added. Risk: the module is a release candidate (Node v26.13.1
  documentation, read 2026-11-11: "Stability: 1.2 - Release candidate", since
  v25.7.0; not behind `--experimental-sqlite` since v23.4.0/v22.13.0), not
  stable, so its API may still change in a minor Node release, and `node
  --help` on v26.13.0 still calls the flag experimental. Residual risk
  accepted: a release candidate only changes for serious issues, the store
  uses a narrow part of the API (`DatabaseSync` with its `readOnly` and
  `timeout` options, prepared statements and their `changes` result, `exec`,
  `close`, and the `errcode` of a thrown error), Node is pinned by digest so a change can only arrive through an
  explicit Node upgrade, that upgrade runs the full gate including the store
  tests, and the store sits behind a port that a later feature can reimplement
  without changing the file format. Rejected: a JSON file rewritten with atomic rename (full rewrite and
  `fsync` of file and directory on each refresh, a separate lock file to
  enforce one instance, async writes or blocking whole-file I/O, own crash and
  corruption handling); a third-party database package (supply chain and native
  build in the Docker-only toolchain). An ADR (ADR-008) records this choice in
  the feature PR. Probes on the pinned dev image (Node v26.13.0, SQLite
  3.54.0, user ID 1000, 2026-11-11): on a file opened with `readOnly: true`
  and on a mode-`0444` file, `BEGIN EXCLUSIVE` succeeds and the first write
  (`PRAGMA user_version=1`, value unchanged) throws `errcode` 8 "attempt to
  write a readonly database"; in a mode-`0555` directory the first write throws
  the extended `errcode` 1544 (`SQLITE_READONLY_DIRECTORY`); with
  `locking_mode=EXCLUSIVE` and `journal_mode=DELETE`, `<path>-journal` remains
  after each commit (0 bytes with `journal_size_limit=0`, the deleted value no
  longer in it; probe of 2026-11-11), is removed by `close()`, and after
  `SIGKILL` (probe run without `journal_size_limit`) remains with a zeroed
  header and mode `0600`, the next open succeeding with
  `integrity_check` `ok`; a second process gets `errcode` 5 "database is
  locked" on `BEGIN EXCLUSIVE` and on a read while the lock is held.
- **D-3 — Stateless sealed refresh tokens rejected.** An encrypted
  self-contained refresh token survives restarts without a store, but it
  cannot detect reuse after rotation, cannot be revoked early (allowlist
  change, BR-301) and turns the signing or sealing key into a long-lived
  bearer secret. It is not used even as a complement.
- **D-4 — No encryption at rest, no new secret file.** The ticket asked to
  encrypt upstream refresh tokens; the proxy holds none (Context), and
  refreshing never calls the upstream. Everything secret that the file needs
  is a SHA-256 of a 256-bit random value, which an offline reader cannot
  invert. The file still holds personal data (`sub`, optionally email) and is
  protected by mode `0600`, the directory check and the container user;
  `secure_delete=ON` (BR-298) overwrites purged and revoked rows, `sub` and
  `email` included, in freed database pages, and `journal_size_limit=0`
  truncates the journal at each commit so its before-images do not stay on
  disk. A
  future feature that keeps upstream tokens must add encryption with a key from
  a `*_FILE` secret. Integrity is not protected by the store either: a writer
  of the file or its directory can insert rows or restore an older copy
  (D-9). No row MAC is added, because the same user ID already reads the
  signing key (`docs/deployment.md`, secrets step), so an attacker with that
  write access can mint tokens directly; the mount is treated as a credential
  store instead (BR-313). The owner accepted no encryption at rest on
  2026-11-11 (`103-decision-1-orchestrator`). Rejected: encrypting rows with a
  new key (key management with no secret to protect); a MAC over rows keyed by
  the signing key or a new secret (no gain against a writer who can read
  either key, and a key rotation would then invalidate every family).
- **D-5 — Refresh token as family ID plus secret.** One stored hash per family
  keeps reuse detection (any non-current secret of a known family revokes it)
  with constant storage, which bounds the file (BR-303). Knowing a family ID
  without its current secret only lets one revoke that family; family IDs
  appear only inside tokens issued to that client. Rejected: keeping every
  rotated hash (unbounded growth); keeping the last N (blind spot after N
  rotations).
- **D-6 — Fail closed.** A store that cannot be trusted stops startup with a
  fixed line, and a failed write latches until restart like the audit sink
  (F-016 BR-241), because the in-memory and on-disk views would otherwise
  keep diverging under new writes. The latch does not make a failed write
  durable: the revocation whose failed commit latched the store (no other
  revocation can be decided while latched, BR-299) lives only in memory, and after the restart its family loads again
  with its current hash, so that reuse detection is lost (D-9, BR-313 operator
  action). No file is ever deleted,
  repaired or recreated automatically. Rejected: falling back to memory
  (silently reintroduces the problem and hides a disk fault); starting empty
  on a corrupt file (destroys evidence and logs every user out silently).
- **D-7 — Configuration binding and restart semantics.** The file is bound to
  issuer, audience and upstream issuer because identities and resources in it
  are only meaningful for them. The signing key is not bound: replacing it
  invalidates access tokens but refresh families stay valid, which lets the
  owner rotate the key without logging users out. Allowlist changes are
  enforced at the next refresh (BR-301) and already at access-token validation
  (BR-141).
- **D-8** — moved to #109 (CIMD).
- **D-9 — Accepted residual risks.** Write access to the state file or its
  directory lets someone insert a client and a family for an allowlisted
  `sub` and obtain tokens after the next restart, and restoring an older copy
  of the file brings back families revoked or rotated since that copy; no
  integrity check detects either (D-4), so the operator treats the mount as a
  credential store and deletes the file, server stopped, to revoke every
  client and family (BR-313); refresh requests are still limited only by the F-012
  process-wide window; a power loss during a commit is covered by SQLite's
  journal with `synchronous=FULL` only on file systems that honour `fsync`
  (local file systems only, documented); a revocation that is not committed
  (the revocation whose failed commit latched the store; BR-299 decides no
  other while latched) is lost at the next
  restart and its family becomes usable again with its current token; a crash
  or dropped connection after a refresh commit but before the client receives
  the response makes the client present its old token, which revokes the
  family and forces a new login (the safe side of reuse detection); a
  downgrade to an image that ignores `OAUTH_STATE_FILE` followed by an upgrade
  brings back the families of the file as they were before the downgrade,
  until they expire, unless the owner replaces the file (BR-313); a stored
  redirect URI removed from the allowlist stays in the client row but is never
  used (BR-128 v2); a hot journal owned by the same user that passed BR-293
  and switches page 1 to WAL may make SQLite create `<path>-wal` before the
  BR-295 step (3b) `journal_mode` check refuses the file, which needs write
  access already equivalent to replacing the file; a `<path>-journal` left by
  a crash stays on disk until the next open and close (BR-298).
- **D-10** — moved to #109 (CIMD).
- **D-11 — Dynamic registration kept as is.** Every client keeps using it,
  now persisted.
  The registration and token rules for registered clients do not change,
  except that a stored redirect URI is usable only while it is still allowed
  (BR-128 v2) and a client with no allowed URI left is purged at startup
  (BR-302): without this, persistence would let a URI the operator removed
  keep receiving codes, which today's restart prevents.
- **D-12 — Store opened by the HTTP handler.** Opening before any socket keeps
  BR-152's "every refusal before listening" contract and reuses the
  `HttpStartupError` fixed-message mechanism. The handler holds the store, and
  the HTTP server closes it only after its listener has closed (BR-169 v2 step
  (6), BR-304), because the handler's `close()` runs before in-flight
  responses drain (`src/http/server.ts`): closing the store there would let a
  late OAuth request write to a closed database. A write that still arrives
  after the close is a BR-299 failure (503, no token). No path leaves the lock
  held. Rejected: opening inside `createOAuthProxy` (breaks BR-124's no-I/O
  construction); closing in the handler's `close()` (the race above).
- **D-13 — Ticket deviations.** Two points depart from ticket #103, both
  decided by the owner on 2026-11-11 (`103-decision-1-orchestrator`):
  1. CIMD is moved to ticket #109; F-019 covers only the persistent store for
     dynamically registered clients and refresh families. Its BR, AC and
     decision numbers stay reserved here (BR-291, BR-305–BR-311, AC-14–AC-18,
     D-8, D-10).
  2. No encryption at rest and no new secret file (D-4), because the proxy
     keeps no upstream token and the file holds only hashes of random secrets
     besides `sub` and the optional email.

## Open questions

None.

## Stress-test

Round 1 (`103-spec-review-1-reviewer`, Opus 5.5, on `ff7f3c1`):

1. Major, stored redirect URIs outlive the allowlist — retained. BR-128 v2
   now requires the `redirect_uri` to match both the client's URIs and the
   current `oauthAllowedRedirectUris` under BR-126; the BR-302 startup purge
   deletes a client with no allowed URI left, with its families (dropping is
   preferred to refusing startup, which would block every user for one stale
   client); AC-22 added; D-9 and D-11 updated.
2. Major, CIMD advertised to every client — retained. BR-313 warns that a
   nonempty list switches claude.ai, Claude iOS and Desktop, ChatGPT and Codex
   to CIMD without fallback, so the list holds every origin in use or stays
   empty; AC-20 checks the warning; BR-125 v2 and D-8 state the advertisement
   is global; D-13 raises the choice at freeze. CIMD stays off by default.
3. Minor, revocation lost after a failed commit — retained. D-6 no longer
   claims the latch prevents it; D-9 lists it; BR-313 gives the operator
   action (fix, restart, replace the file to be sure).
4. Minor, crash before response and downgrade/upgrade — retained. Both are in
   D-9; BR-313 documents the downgrade operator action. The crash case needs no
   operator action (it fails safe with a new login), so BR-313 covers it
   through the D-9 residual risks.
5. Minor, hot journal unchecked — retained. BR-293 applies its checks to
   `<path>-journal`; BR-295 names SQLite's hot-journal rollback as the only
   allowed change before a refusal; cases added to AC-03 and AC-05.
6. Minor, state file equal to the audit log — retained. BR-290 refuses equal
   resolved paths with `CONFLICTING_SETTINGS`; AC-01 case added.
7. Minor, environment proxy and `all: true` lookup — retained. BR-306 requires
   a dedicated proxy-free `https.Agent` and checks every returned address;
   both cases added to AC-15; planned layout and D-8 updated.
8. Minor, NAT64 prefixes — retained. BR-307 and Contract details block
   `64:ff9b::/96` and `64:ff9b:1::/48` whatever they embed, and add
   `::ffff:0:0:0/96` (IPv4-translated) under the embedded-address rule; AC-15
   samples both NAT64 prefixes with a public embedded address.
9. Minor, commit-before-response for other revocations — retained. BR-298
   names BR-137 code-replay, BR-301 revocations and BR-142 v2 eviction; AC-07
   covers them; AC-19 checks `store_loaded` once with the post-purge counts.
10. Minor, ticket deviations — retained. D-13 lists both deviations (CIMD off
    by default; no encryption at rest) for the owner at freeze.
11. Minor, `node:sqlite` stability — retained. Context and D-2 record the
    v26.13.1 documentation ("Stability: 1.2 - Release candidate") and accept
    the residual risk with the pinning, gate and port mitigations.

Round 2 (`103-spec-review-2-reviewer`, Opus 5.5, diff-only `ff7f3c1..80d5266`):
approve, four minors, all retained and applied by the orchestrator (short text
edits):

1. An `auditLog` equal to `<oauthStateFile>-journal` would be deleted by
   SQLite: BR-290 refuses it with `CONFLICTING_SETTINGS`; AC-01 case added.
2. No revocation can be decided while latched (BR-299 answers 503 first):
   BR-313, D-6 and D-9 now name only the revocation whose failed commit
   latched the store.
3. `NODE_USE_ENV_PROXY` is read at process start: the AC-15 proxy case runs in
   a child process started with it and asserts the proxy got no connection.
4. The matrix does not state a no-fallback behaviour: BR-313 and D-8 now say
   it documents no fallback once CIMD is advertised; the warning is kept.

Scope split (owner, 2026-11-11, `103-decision-1-orchestrator`): CIMD moves to
ticket #109 and the owner accepts no encryption at rest (D-4, D-13). Removed
from F-019: BR-291, BR-305–BR-311 (kept as reserved placeholders), BR-125 v2
and BR-136 v2 (they existed only for CIMD), the CIMD part of BR-128 v2,
BR-124 v2, BR-152 v2, BR-312 and BR-313, `oauthAllowedClientIdOrigins`, the
blocked address ranges, `client-metadata.ts`, AC-14–AC-18 (kept as "moved"
lines), D-8 and D-10. The CIMD findings of rounds 1 and 2 above (round 1
items 2, 7, 8 and the CIMD parts of 10; round 2 items 3 and 4) now belong to
#109.

Decision pass 1 (`103-spec-decision-1-reviewer`, Fable 5.2, on `fcf6f72`):

1. CIMD finding — moved to #109 with the scope split; not handled here.
2. Integrity of the file not argued — retained. No row MAC (the same user ID
   reads the signing key); D-4 states why, D-9 lists insertion by a writer
   and restore of an older copy as residual risks, BR-313 documents the mount
   as a credential store and deleting the file to revoke everything; AC-20
   checks both statements.
3. Row content not validated at load — retained. BR-295 refuses any row that
   breaks the new "Version 1 row rules" (an `https://` client ID is now
   invalid) with `OAUTH_STATE_CORRUPT` and no parser message, compares
   `sqlite_schema` exactly and sets `trusted_schema=OFF`; "Hash inputs" pins
   the SHA-256 input encoding; AC-05 and AC-09 cases added.
4. Non-string `email` latching the store — retained. BR-300 stores `email`
   only when the claim is a string, `NULL` otherwise; AC-09 case added.
5. `fcntl` lock dropped by another descriptor — retained. BR-294 forbids
   opening the path or its journal outside SQLite while the store is open
   (checks by `lstat` only, creation descriptor closed first); AC-04 case
   added.
6. BR-302 purge — registered-client part retained unchanged (clients with no
   allowed redirect URI left are purged at startup, AC-22); the CIMD cut-off
   part moved to #109.
7. CIMD finding — moved to #109.
8. CIMD finding — moved to #109.
9. "Canonical forms" wrong for the audience — retained. BR-296 pins the
   three strings: issuer and upstream issuer as WHATWG serializations without
   trailing slashes, audience as `publicUrl` verbatim; AC-05 case added.

Round 3 (`103-spec-review-3-reviewer`, Opus 5.5, on `cc9fb3b`):

1. Major, load-check order undefined — retained. BR-295 now lists the steps:
   BR-293, header, open and lock, `application_id`, `user_version` (above 1 →
   VERSION before any other content check), `quick_check`, schema, row rules
   on every row before the purge, bounds, meta (MISMATCH), then the purge;
   AC-05 adds `user_version` 2 with an extra table and a bad row (VERSION),
   an expired bad row (CORRUPT) and a mismatch with an expired row (kept).
2. Major, startup write failure and read-only open — retained. BR-293
   requires owner read/write on the file and owner `rwx` on the directory and
   refuses a read-only SQLite open; BR-295 stops startup with
   `OAUTH_STATE_UNAVAILABLE` after a rolled-back initialization, migration or
   purge; AC-03 adds a `0400` file with an expired family, a `0500`
   directory and a failing purge commit.
3. Major, WAL files and header — retained, `nlink === 1` included. BR-293
   refuses an existing `<path>-wal` or `<path>-shm` by `lstat`; BR-295 step
   (2) reads the 100-byte header before SQLite opens the path (descriptor
   closed first, BR-294) and requires `SQLite format 3\0` with bytes 18-19
   equal to 1; AC-03 and AC-05 cases added.
4. Minor, BR-301 position — retained. BR-301 and BR-140 v2 state "after step
   (3), before step (4)"; AC-10 adds a removed subject with a different
   `resource` (`invalid_grant`, not `invalid_target`).
5. Minor, BR-298 revocation list — retained; it names BR-140 v2 steps (2)
   and (3), BR-137 and BR-301, revocation or deletion.
6. Minor, store ownership and close — retained. BR-304 makes the handler own
   and close the store at the end of its `close()` and on every startup
   failure after the open; D-12 says so; AC-13 adds `LISTEN_FAILED` and a
   throwing proxy construction, each followed by a successful open.
7. Minor, `resource` and `name` row rules — retained: `resource` is
   byte-identical to meta `audience`; `name` is counted in Unicode code
   points; AC-05 cases added.
8. Minor, BR-290 and BR-299 gaps — retained. BR-290 requires a nonempty value
   and gives `stderr` no special meaning; BR-299 answers `/oauth/callback`
   with the 503 page without calling the upstream; AC-01 maps 4,097
   characters to `LIMIT_EXCEEDED` and empty or control characters to
   `INVALID_VALUE`; Planned code layout appends the key at the end of
   `inventory` (`proxyKeys` is `inventory.slice(27)`).
9. Minor, AC-10 BR-140 v2 cases — retained: the former 43-character format
   (no revocation) and the current token presented by another client
   (revocation) added.
10. Doc example paths — retained. BR-313 targets `docs/oauth-proxy.md`, which
    BR-186 does not scan; BR-314 now requires example state paths under the
    existing `/audit/` mount, so the BR-186 test passes unchanged.

Round 4 (`103-spec-review-4-reviewer`, Opus 5.5, diff-only `cc9fb3b..d24372c`):
changes, one major and two minors, all retained and applied by the
orchestrator (short text edits):

1. Major, step (3) mapped every failure to LOCKED although `BEGIN EXCLUSIVE`
   is where a truncated file or a read-only open first fails: BR-295 splits
   step (3) into (3a) open plus identity check and (3b) lock with failures
   mapped by SQLite error code; BR-293 detects read-only by `SQLITE_READONLY`
   at (3b); AC-03 adds fault-injected BUSY, READONLY and CORRUPT cases.
2. Minor, a refused open could keep its connection and lock: BR-295 closes
   the connection before raising; AC-04 adds a CORRUPT open followed by a
   successful child-process open.
3. Minor, a replayed hot journal could switch page 1 to WAL after the header
   check: step (3b) requires `journal_mode` `delete` (otherwise CORRUPT). A
   `<path>-wal` that SQLite may already have created in that case is accepted
   as a documented residual risk: it needs a hot journal owned by the same
   user that passed BR-293, that is, write access already equivalent to
   replacing the file (D-9).

Decision pass 2 (`103-spec-decision-2-reviewer`, Fable 5.2, on `93185de`):
changes, two majors and seven minors, all retained; probe results in D-2.

1. Major, read-only open not detected — retained. Probe: `BEGIN EXCLUSIVE`
   succeeds on a read-only database and the first write fails (`errcode` 8).
   BR-295 step (11) always commits a real write (`user_version` set to 1 again)
   and maps its failure to `OAUTH_STATE_UNAVAILABLE`; BR-293 cites it; AC-03
   replaces the injected `SQLITE_READONLY` case with a real `readOnly: true`
   open.
2. Major, store closed by the wrong `close()` — retained. The handler's
   `close()` runs before responses drain and the listener closes
   (`src/http/server.ts`); BR-169 v2 adds step (6), the store close by the
   HTTP server after the listener closed; the handler keeps the reference and
   closes only on a throwing proxy construction; a write after close is a
   BR-299 failure; BR-304, D-12 and AC-13 reworded, BR-169 v2 listed.
3. Minor, extended result codes — retained. Mapping on `errcode & 0xff`
   (probe: 1544 seen for a read-only directory); steps (4)–(10) map
   CORRUPT/NOTADB to `OAUTH_STATE_CORRUPT`, others to UNAVAILABLE; `errcode`
   added to D-2's API surface; AC-03 cases 261, 26, 1544, 10.
4. Minor, backward clock step breaks a row rule — retained. `token_issued` is
   written as the larger of the clock and `created`; every written row passes
   the row rules before commit (BR-298), else a BR-299 failure; AC-23 reopens
   the files of the AC-02, AC-07, AC-10 and AC-12 flows.
5. Minor, bounds checked after the work they bound — retained. The size check
   moves to step (2) and the `COUNT(*)` row bounds to step (8), before the row
   rules (9).
6. Minor, `quick_check` and unchecked `changes` — retained. Step (6) uses
   `integrity_check`; a keyed `UPDATE`/`DELETE` whose `changes` is not 1 is a
   BR-299 failure (AC-08 case).
7. Minor, journal left on disk — retained, corrected by probe: the journal
   stays while the store is open and is removed by a clean close, but remains
   (zeroed header, `0600`) after `SIGKILL`. BR-298 and BR-313 make it part of
   the store; AC-04 adds the clean-close and `SIGKILL` reopen cases;
   `secure_delete=ON` set at open (BR-295, BR-298, D-4).
8. Minor, `-wal` statement contradicted round 4 item 3 — retained. BR-293 now
   excepts that residual case; D-9 lists it.
9. Minor, AC-08 contradicted BR-299 — retained. AC-08 states 503 and no token
   for a family whose revocation commit latched the store, and adds the
   registration and code-redemption failures; AC-12 adds a 1,001-family file
   (`OAUTH_STATE_CORRUPT`).

Round 5 (`103-spec-review-5-reviewer`, Opus 5.5, diff-only `93185de..57c41a1`):
changes, three minors, all retained and applied by the orchestrator (short text
edits):

1. `secure_delete` does not clear the journal body: option (a) retained,
   `journal_size_limit=0` (probe on Node 26.13.0: journal 0 bytes after a
   commit, deleted value absent, `journal_mode` still `delete`); BR-298, D-2,
   D-4 and AC-04 updated.
2. A late write on the closed store logs no `store_write_failed` (BR-299);
   AC-13 asserts it.
3. BR-304 names `closeStore()`, called by BR-169 v2 step (6); a throw from it
   is ignored once the lock is released.

Round 6 (`103-spec-review-6-reviewer`, Opus 5.5, diff-only `57c41a1..0d7f0c6`):
approve, three minors, all retained and applied by the orchestrator (short text
edits): step (6) catches any throw from `closeStore()` and AC-13 tests it; D-2
states that the `SIGKILL` probe ran without `journal_size_limit`; the AC-04
journal clause has its When.

## Freeze

Frozen autonomously (PROJECT.md D-1) on 2026-11-11: ticket ready, Open
questions empty, the two ticket deviations (D-13) and the scope split accepted
by the owner (#103 `103-decision-1-orchestrator`), strong-tier approval of
`0d7f0c6` (round 6) and strongest-tier decision passes 1 and 2 with every
finding resolved (decision pass 2's majors confirmed fixed by rounds 5 and 6).
The freeze commit changes only `status`, the round 6 minors and this note.
Next free IDs re-checked on main: F-019, BR-290 (BR-290–BR-314 used, BR-291
and BR-305–BR-311 reserved for #109), ADR-008.

### Acceptance (v1)

Accepted on main `68209fe` on 2026-11-11 (`make check` rc=0, 138 files /
3,527 tests; AC-01–AC-13 and AC-19–AC-23 pass;
acceptance (archive issue 103)).
AC-14–AC-18 moved to #109. BR-290, BR-292–BR-304, BR-312–BR-314 v1 and the v2
and v3 versions it lists are active. The owner-run check with a real MCP client
across a container restart has not been run and is not a merge condition.

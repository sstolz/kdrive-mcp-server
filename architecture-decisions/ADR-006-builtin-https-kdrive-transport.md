# ADR-006 — Built-in `node:https` transport for the kDrive adapter

Status: accepted (2026-11-09). Design of F-014 (#70, decision D-01), accepted
with F-014 v7 on main `2a9c1e3` (acceptance (archived evidence `runs/70-acceptance-4.md`)).

## Context

The production kDrive read adapter ([F-014](../features/F-014-production-kdrive-adapter.md),
decision D-01) sends a bearer token to `https://api.infomaniak.com` and follows
one tokenless download redirect to a storage host. Its rules require:

- an address check on every resolved address before each connection, with
  IPv4-mapped and IPv6 transition ranges refused (BR-191);
- default TLS certificate and hostname verification for the original host,
  through an agent the adapter owns, ignoring proxy environment variables even
  with `NODE_USE_ENV_PROXY=1` (BR-191);
- manual redirect handling limited to one allowlisted hop without credentials
  (BR-192);
- socket-level deadlines, immediate destruction on abort, byte counting before
  parsing and bounded streaming body readers (BR-193–BR-195, BR-206);
- in-process test seams only: an injected `{lookup, connect}` pair, never an
  environment variable, flag or file (BR-216).

The project's dependency set is deliberately small; every new runtime
dependency adds supply-chain surface and version pinning work.

## Decision

The adapter uses Node's built-in `node:https` with an adapter-owned
`https.Agent` subclass (`keepAlive: false`). Its `createConnection` override
dials through the injected `connect` with an options object whose key set is
exactly `{host, port, servername}`: `host` is an address already resolved by
the injected `lookup` and checked by the fixed address policy
(`src/kdrive/address.ts`), `servername` is the original host. Production
`lookup` is `dns.lookup` with `all: true`; production `connect` forwards its
options to `tls.connect` unchanged, so Node's default CA store and hostname
verification apply. Redirects, deadlines, body bounds, encoding checks and the
8/64 admission queue are implemented in `src/kdrive/transport.ts`. No new
dependency is added.

## Options rejected

- **Global `fetch` (undici bundled in Node).** No supported per-request
  `lookup` without importing `undici` directly; its redirect and abort
  semantics hide the socket, so per-connection address checks, socket
  destruction and byte-level bounds could not be enforced or tested.
- **Adding `undici` as a dependency.** It would provide a custom dispatcher
  and connector, but adds a new supply-chain surface and version pinning for
  capabilities `node:https` already covers.
- **The global `https.Agent`.** Proxy support enabled by `NODE_USE_ENV_PROXY`
  applies to the global agents; an adapter-owned agent is required so proxy
  variables are ignored.

## Consequences

- The transport, its tests (a loopback TLS server with a per-process openssl
  test CA) and the address guard are built on `node:https` internals such as
  `Agent.createConnection`; changing the HTTP client later means rewriting the
  transport and its tests. This is why the choice is recorded as an ADR.
- HTTP keep-alive is not used: every upstream request opens a fresh checked
  connection. This costs latency per request but keeps the address check per
  connection and the socket ownership simple.
- Outbound proxies are not supported (F-014 D-12); a deployment needs direct
  egress to `api.infomaniak.com` and the storage hosts.
- The storage-host suffix and the address policy are constants of
  `src/kdrive/`; widening either needs a new spec version (F-014 D-19).

---
id: F-014
title: Bounded production kDrive read adapter and runtime composition
ticket: "#70"
status: done
version: 7
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-05.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `9f4f731` (merge of main
`584999d`). Revised after spec review round 1 (draft `f73ab18`).
IDs: F-014 and BR-190–BR-217 are the next unused IDs per
[the spec index](../docs/spec-index.md); ADR-006 is the next unused ADR ID.
Re-check all three on main before freeze and again before the PR.

Version 2: Claude Opus 5.5 (effort unknown), 2026-11-08, on branch
`feat/70-production-kdrive-adapter` at `6192f05`. It sets the upstream page
size to 100 (latency probe (archived evidence `runs/70-list-latency-1.md`), D-02), closes the
wording gaps of code review round 1 (archived evidence `runs/70-code-review-1.md`) and pins
TLS verification (Fable code pass 1 (archived evidence `runs/70-code-fable-1.md`)); see
Stress-test "v2 changes". Version 1 is preserved unchanged in
[history](history/F-014-v1.md). No new F, BR or ADR ID is allocated.

Version 3: Claude Opus 5.5 (effort unknown), 2026-11-09, on branch
`feat/70-production-kdrive-adapter` at `39d81c9`. The owner recording on a
drive with 1- to 3-digit IDs failed the BR-213 leak check only on non-ID
numbers (HTTP status, `limit`, `Range`, `content-length`, `content-type`
charset, `size`); BR-213 v2 exempts a closed list of fields with constrained
forms, strips only the `utf-8` charset from `content-type`, names the
synthetic cursor/ETag forms, and fixes a value-free failure message (D-21; Stress-test "v3 changes").
Version 2 is preserved unchanged in [history](history/F-014-v2.md). No new F,
BR or ADR ID is allocated.

Version 4: Claude Opus 5.5 (effort unknown), 2026-11-09, on branch
`feat/70-production-kdrive-adapter` at `012ff13`. The successful owner
recording (run `20261109073932`) shows that kDrive sends no `path` in
`parents` members, so BR-203 v2's anchor hypothesis left every received
descendant `incomplete`. BR-203 v3 derives the anchor from the item's own
recipient path (D-22; Stress-test "v4 changes"). Version 3 is preserved
unchanged in [history](history/F-014-v3.md). No new F, BR or ADR ID is
allocated.

Version 5: Claude Opus 5.5 (effort unknown), 2026-11-09, on branch
`feat/70-f014-v5` from main `7b1769f`. The first owner acceptance run on main
`7b1769f` failed in run B: a children page of 100 took 5,010 ms (beyond
BR-193), and AC-23 required the outside-scope item to be denied in run B,
whose root `1` contains it. A tail probe (runs/70-list-latency-2.md (archived evidence `runs/70-list-latency-2.md`))
measured pages of 50 at a 1,911 ms maximum. v5 sets pages of 50 (BR-201 v3,
BR-202 v3, BR-211 v3, BR-213 v3, D-02) and fixes AC-23 for run B (Stress-test
"v5 changes"). Version 4 is preserved unchanged in
[history](history/F-014-v4.md). No new F, BR or ADR ID is allocated.

Version 6: Claude Opus 5.5 (effort unknown), 2026-11-09, on branch
`feat/70-f014-v6` from main `0a17373`. Owner acceptance run 2
(runs/70-acceptance-2.md (archived evidence `runs/70-acceptance-2.md`)) passed every check but
the AC-25 revocation read: kDrive refuses a removed share at once (HTTP 403,
absent from `shared_with_me`), which the error mapping turns into
`READ_UNAVAILABLE`, while AC-25 expected `ACCESS_DENIED`. v6 accepts either
refusal code with no content (D-23) and aligns the acceptance script's AC-25
page threshold with v5's six pages. Version 5 is preserved unchanged in
[history](history/F-014-v5.md). No new F, BR or ADR ID is allocated.

Version 7: Claude Opus 5.5 (effort unknown), 2026-11-09, on branch
`feat/70-f014-v7` from main `e057d14`. Acceptance run 3
(runs/70-acceptance-3.md (archived evidence `runs/70-acceptance-3.md`)) showed that v5's
"six pages" for the 257-entry received folder counted MCP tool pages, which
aggregate upstream pages; v7 counts upstream children requests instead.
Version 6 is preserved unchanged in [history](history/F-014-v6.md).

## Context

The policy core ([F-003 v2](F-003-tree-access-policy.md),
[F-004 v1](F-004-received-share-policy.md)), the read tools
([F-005](F-005-stdio-navigation.md), [F-006](F-006-filtered-pagination.md),
[F-007](F-007-bounded-downloads.md), [F-009](F-009-bounded-content-reading.md))
and the authenticated HTTP listener ([F-012](F-012-authenticated-http.md),
[F-013](F-013-http-image.md)) are accepted only against injected or synthetic
dependencies. `src/kdrive/client.ts` is a stub. `src/cli.ts` validates the
configuration and exits 1 with `Configuration validated locally; <transport>
runtime is not implemented yet.` (F-002 BR-016 v1, F-005 BR-071 v1, F-013
BR-175 v1). Nothing works against a real kDrive.

Blocked production acceptance criteria that this feature must unblock:

- F-003 AC-19 (real metadata/list/search fixtures, root `1`, a nested permitted
  directory, the >1000-child tree, positive and negative outcomes, fresh
  reinspection) and AC-20 (real tool and resource registrations dispatch through
  the facade; unauthorized requests dispatch nothing).
- F-004 AC-14 (real shared-root and shared-child fixtures, discovery, positive
  root/child reads, multi-page scoped reads, negative unrelated-ID/denied-path/
  revoked-share cases, capability mapping) and AC-15 (real registrations).

Evidence available ([api-notes](../docs/api-notes.md),
[read evidence](../docs/kdrive-read-evidence.md),
final measurements (archived evidence `runs/5-final-read-measurements-1.md`)):

- Base `https://api.infomaniak.com`, `Authorization: Bearer`. Routes:
  `/2/drive/init?with=drives` (drive IDs and roles `admin`/`external`),
  `/3/drive/{d}/files/{f}` with `with=path,parents,capabilities`,
  `/3/drive/{d}/files/{f}/files` (`limit` ≤ 1000, `cursor`, `has_more`),
  `/3/drive/{d}/files/search` (`query`, `limit`, `with`; `per_page` → 422),
  `/3/drive/files/shared_with_me` (unscoped; the drive-scoped form returned an
  empty list), `/3/drive/{d}/files/my_shared`, `/3/drive/{d}/files/recents`
  ([SPEC.md §3](../SPEC.md); route unmeasured), and
  `/2/drive/{d}/files/{f}/download`.
- Pagination P row: `limit=1000` pages of 1000 + 1 entries, cursor/has_more,
  zero duplicates, 388,133 bytes for a 1000-entry page without `with`.
- Metadata M row: `parents` excludes root `1`; `depth − 1` parents; path suffix
  consistent. Received shares: anchor `depth` 1, empty `parents`, recipient
  path `/Shared/<name>`; descendant ancestry and external search visibility
  are **unmeasured** (A and V rows).
- Download R/E rows: API 302 → one tokenless hop to a storage host → 206 for
  known ranges with exact bytes, `Content-Range`, `Content-Length`; 416 with an
  empty `text/html` body past the end; an opaque bounded ETag of nonstandard
  syntax that compared equal on repeat. Changed-version behaviour (C row) is
  **unmeasured**.
- Errors: 404 `object_not_found`, 401 `not_authorized` for an inaccessible
  drive, 422 `validation_failed`. No rate-limit header and no 429 observed.
- Our download-host allowlist (one lowercase label under
  `.download.kdrive.infomaniakusercontent.com`, HTTPS 443, public address) is a
  chosen restriction, not a provider guarantee.

Existing contracts the adapter must satisfy, by interface name:

- `PolicyDependencies` (`src/policy/index.ts`): `inspect(target, location)`,
  `children(EvidenceRequest)`, `collection(CollectionRequest)`,
  `execute(operation)`, plus optional `received: ReceivedDependencies`
  (`src/policy/received.ts`: `list`, `inspect`, `children`, `collection`) and
  `content: ContentDependencies` (`src/content.ts`: `describe(target, signal)`,
  `open(ContentRange, signal)`).
- Normalized item shape validated by `item()` in `src/policy/values.ts`;
  page envelopes validated by `page()` and the echo checks in
  `src/policy/index.ts`; received roots/targets by `src/policy/received.ts`.
- `PreflightResolver` (`src/config-schema.ts`): `inspectDrive(driveId)`,
  `resolveDirectory(driveId, selector)`.
- Retry: `ReadFailure(status)` (`src/read-retry.ts`) is the only retry brand;
  the central helper (F-007 BR-088, BR-089) retries 429/500–599 at most three
  starts with 100/200 ms waits inside the 10,000 ms invocation deadline and the
  512-call budget. The navigation runtime refuses a paged result with more than
  256 entries (`src/navigation.ts`, F-006 "upstream page bounds remain 256").
- Content: `describe` returns exactly `{target,size_bytes,etag,version_bound}`
  with a strong `etag` matching `strongETag()`; `open` returns exactly
  `{target,start,end,size_bytes,etag,status:206,body}` with a bounded body
  reader `read(max, signal)` / `close()`.

Users affected: the owner, who runs the server over stdio or behind an HTTPS
reverse proxy with an Infomaniak token; every MCP client user of that
deployment; reviewers relying on the policy guarantees.

## Scope

1. A production adapter module `src/kdrive/` that implements, for **read
   calls only**, `PolicyDependencies` (with `received` and `content`) and
   `PreflightResolver`, normalized to the contracts above.
2. Its HTTPS transport: fixed API origin, address checks, one bounded download
   redirect, deadlines, cancellation, size caps, bounded concurrency, error
   mapping onto the existing brands. No retry inside the adapter.
3. Runtime composition in `src/cli.ts`: after local configuration, production
   preflight through the adapter, then the stdio runtime
   (`startStdioNavigation`) or the HTTP runtime (`startHttpServer`) with the
   adapter behind the policy facade. Versions BR-016, BR-028, BR-071, BR-123
   and BR-175 (below).
4. Credential handling through the existing F-002 sources
   (`KDRIVE_TOKEN` / `KDRIVE_TOKEN_FILE`), confined to the adapter; extraction
   worker isolation (`env: {}`, `argv: []`, `execArgv: []`) from
   [BACKLOG.md](../BACKLOG.md) and
   the 0.3 global review (archived evidence `runs/0.3-fable-global-1.md`).
5. Qualification: adapter contract tests replaying recorded, sanitized
   fixtures in CI; an owner-run recording target; an owner-run acceptance
   target against designated real fixtures that executes F-003 AC-19/AC-20 and
   F-004 AC-14/AC-15.
6. Pending records: BR-190–BR-217 records, versioned BR records, ADR-006,
   provisional capability-map and changelog lines, spec-index allocation.

### Out of scope

- Any non-GET request, write tool, mutation execution, trash/restore evidence
  (`original-trash` stays unavailable), share-link or invitation calls (#17–#20).
- Office extraction (#15); changes to extraction formats or bounds.
- Changes to the frozen policy contracts (F-003 v2, F-004 v1), the F-007 content
  port, F-006 paging, F-012 HTTP behaviour or F-002 configuration inventory.
  No new configuration setting is added.
- Release, version bump, image publication.
- Outbound HTTP proxy support (`HTTPS_PROXY`), IPv6-only egress tuning, rate
  ceiling measurement, maximum file size measurement.
- The other BACKLOG items of the 0.3 global review (pre-`started` worker
  failure mapping, extra `authorize` after denial).

## Business rules

All rules are version 1 and `pending acceptance` unless marked as a version
bump. "Adapter" means the production module of Scope 1–2.

### Transport

- **BR-190** — The adapter issues only `GET` requests, only to origin
  `https://api.infomaniak.com` (port 443) on the fixed route templates of the
  Route table, with every ID rendered as a decimal positive safe integer and
  every query value encoded by `URLSearchParams`; it attaches
  `Authorization: Bearer <token>` to requests on that origin only. Verified by:
  AC-01.
- **BR-191** — Before each connection the adapter resolves the host, refuses the
  connection unless every resolved address is a public unicast address (not
  loopback, private, link-local, unique-local, carrier-grade NAT, multicast,
  unspecified, documentation, benchmarking or reserved; an IPv4-mapped
  `::ffff:0:0/96` address is checked as its embedded IPv4 address; NAT64
  `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4 `2002::/16` and Teredo
  `2001::/32` are refused), connects to a checked address with
  default TLS certificate and hostname verification for the original host
  through an adapter-owned `https.Agent` (never the global agent), and ignores
  proxy environment variables, including when `NODE_USE_ENV_PROXY=1` is set.
  Verified by: AC-02.
- **BR-192** — A JSON route response with any 3xx status is refused. A download
  request accepts either a direct 206 from the API origin or exactly one 302
  whose `Location` is an absolute `https:` URL on default port 443, without
  userinfo or fragment, whose host is one label matching `^[a-z0-9-]{1,63}$` followed by
  `.download.kdrive.infomaniakusercontent.com`; the second request carries no
  `Authorization` or `Cookie` header, and any 3xx on it is refused. Verified by:
  AC-03.
- **BR-193** — Each JSON request completes, body included, within 5,000 ms;
  each download open reaches its final response headers, both hops included,
  within 5,000 ms; each body `read` settles within 5,000 ms; an aborted
  content `signal` destroys the socket at once; on any of these the adapter
  rejects with the unbranded failure of BR-196. Verified by: AC-04.
- **BR-194** — The adapter counts body bytes before parsing or keeping them and
  refuses a JSON success body above 4 MiB, an error or redirect body above
  8 KiB, and any `Content-Encoding` other than absent or `identity`. Verified
  by: AC-05.
- **BR-195** — At most 8 upstream requests are in flight per process; further
  requests wait first-in first-out in a queue of at most 64, the wait counting
  toward the BR-193 deadline; a request arriving at a full queue is refused with
  the unbranded failure of BR-196. A download keeps its slot while its body
  reader is open and releases it, destroying the socket, at end of stream,
  `close`, a failed `read`, or 5,000 ms with no pending `read`. Verified by:
  AC-06.
- **BR-196** — The adapter never retries. It rejects with `ReadFailure(status)`
  for a pre-body 401, 403, 422, 429 or 500–599, and for any other 4xx except a
  metadata 404 with `error.code === "object_not_found"` (`missing` for policy
  ports per BR-198; an unbranded `READ_UNAVAILABLE` rejection for `describe`
  and preflight); it rejects with an unbranded `Error` whose message
  is exactly `READ_UNAVAILABLE` for a transport, TLS, address, deadline, size,
  encoding, redirect or queue failure, and, for the preflight and content ports
  only, for an envelope failure (policy ports return `incomplete` instead,
  BR-198/BR-201 v3). The client-visible code of
  each outcome is fixed by the Error-mapping table. No rejection carries a
  provider body, header, URL, ID, cursor or token. Verified by: AC-07.
- **BR-197** — Every port call issues its own fresh upstream requests: the
  adapter keeps no response, ancestry, role, capability or ETag cache between
  port calls. Verified by: AC-08.

### Normalization

- **BR-198** — `inspect` of a `live` target returns the normalized complete
  item when the BR-199 v2 checks pass, `{status:"missing"}` for a 404 whose error
  code is `object_not_found`, and `{status:"incomplete"}` for any other
  successful but unnormalizable response. Verified by: AC-09.
- **BR-199 v2** — Root `1` normalizes to the sentinel root
  `{id:1,type:"dir",name:"",path:"/"}` with an empty chain only when its
  `drive_id` equals the requested drive, its `status` member passes the rule
  below, its `type` is `dir`, its provider `path` is `/` and its `parents`
  member is absent or an empty array; its `parent_id` is not read. Any other
  provider item normalizes to a complete live item only when: its `id`, `drive_id`, `parent_id` are positive safe integers and `drive_id`
  equals the requested drive; `type` is `dir` or `file`; the `status` member is present with the
  value `null` or `"ok"` (any other value, or an absent member, is not live);
  the chain is the
  sentinel root `{id:1,type:"dir",name:"",path:"/"}` followed by the provider
  `parents` ordered so that each member's `parent_id` is the previous member's
  `id` (exactly one of provider order or reverse order satisfies this) and the
  item's `parent_id` is the last member's `id`; and the provider `path` equals
  the path joined from the chain names and the item name. Verified by: AC-09.
- **BR-200** — `inspect` with location `original-trash` and every `execute`
  call return `{status:"unavailable"}` without any upstream request. Verified
  by: AC-10.
- **BR-201 v3** — `children` requests `limit=50` with
  `with=path,parents,capabilities` and the request cursor; it returns the echoed
  request identity with `status:"complete"`, entries in provider order and
  `terminal:true` when `has_more` is false, or `next:<cursor>` when `has_more`
  is true and the cursor is a nonempty string of at most 4,096 bytes; any entry
  whose `parent_id` differs from the requested directory, more than 50
  entries, or any other envelope returns `{status:"incomplete"}`. Verified by:
  AC-11.
- **BR-202 v3** — `collection` serves `list` (children route), `search`
  (`query`, plus `directory_id` when the scope is not root `1`), `recents` and
  `my-shared` with `limit=50` and the same envelope rule as BR-201 v3, and
  returns only entries whose normalized chain or identity contains the scope
  directory (all entries for scope `1`). Verified by: AC-12.
- **BR-203 v3** — Received `list` uses only the unscoped
  `/3/drive/files/shared_with_me`; received `inspect` uses the metadata route,
  and received `children` and `collection` use the BR-201 v3/BR-202 v3 routes, all on
  the request's `driveId` (the share owner's drive) with the BR-203 v3
  normalization below. Every received result carries `role` from a fresh
  `/2/drive/init?with=drives` lookup for that drive and is complete only when
  that role is `external`. The provider chain is the `parents` members ordered
  and linked as in BR-199 v2 (exactly one of provider or reverse order links
  each member's `parent_id` to the previous member's `id`, the item's
  `parent_id` is the last member's `id` when the chain is nonempty, IDs are unique and never `1`; the
  first member's `parent_id` is not constrained), or empty when `parents` is
  absent or an empty array; each member's `type` is `dir`, its `drive_id` when
  present equals the requested drive, and its `status` member when present is
  `null` or `"ok"`. A root is an item whose provider `path` is
  `/Shared/<name>` with its own name; every chain member is dropped, its
  relative chain is empty, its `anchorId` is its own ID and its recipient path
  is `/Shared/<name>`. A descendant's provider `path` is `/Shared/c1/…/cn` with
  n ≥ 2 nonempty components and `cn` equal to its name; its provider chain has
  at least n−1 members, and its last n−1 members carry exactly the names
  c1 … c(n−1) in that order. Its anchor is the first of those n−1 members,
  its relative chain is those n−1 members (the anchor included, as F-004
  `parse()` requires; earlier members are dropped), and the recipient path of
  the i-th relative member is `/Shared/c1/…/ci`. A `path` member of a
  `parents` entry is never read. Any other shape is `{status:"incomplete"}`. Verified by: AC-13.
- **BR-204** — Normalized received capabilities set `read` to the provider
  `can_read === true`, set `list` and `search` to `can_read === true` on a
  directory, and set every mutation predicate of the F-004 matrix to `false`.
  The received list envelope sets `discover:true` only on a complete
  `shared_with_me` page. Verified by: AC-13.

### Content

- **BR-205** — `describe` reads fresh metadata, then issues one download with
  `Range: bytes=0-0`; it returns `version_bound:true` and
  `etag` = `"kd1-` + base64url(SHA-256(provider ETag bytes)) + `"` only when the
  metadata is a live `file` of size ≥ 1, the response is 206 with
  `Content-Range: bytes 0-0/<size>` equal to the metadata size, and the provider
  ETag is 1–256 visible ASCII bytes; when the metadata is a valid live item but
  any of these conditions fails (not a file, size 0, a 2xx download that fails
  the range or length checks, or an absent or out-of-range ETag) it returns a
  descriptor whose `etag` is `null`, which the content reader refuses with
  `VERSION_UNAVAILABLE`. Verified by: AC-14.
- **BR-206** — `open` sends `Range: bytes=<start>-<end>` and
  `Accept-Encoding: identity`; before exposing a body it requires status 206,
  `Content-Range: bytes <start>-<end>/<size_bytes>`, `Content-Length` equal to
  `end − start + 1`, and returns the BR-205 normalization of the response ETag;
  its body reader returns at most `max` bytes per `read`, `null` at end of
  stream, and destroys the socket on `close`. Verified by: AC-15.

### Preflight

- **BR-207** — `inspectDrive` returns `{id, role}` with the provider role of
  that drive from one `/2/drive/init?with=drives` request, or role `"absent"`
  when the drive is not listed. `resolveDirectory` returns
  `{driveId,id,type}` with the item's own `type` from fresh metadata for an ID
  selector, and for a path selector walks from root `1` through complete
  children listings (BR-201 v3) matching each component by exact name and returns
  the unique final match with its own `type`. It rejects for a missing ID, a
  non-directory intermediate component, zero or several matches for a
  component, more than 64 components, more than 1,024 requests or more than
  120,000 ms in one preflight. The resulting F-002 codes are those of AC-16
  (`src/config.ts` maps any rejection to `PREFLIGHT_FAILED`, and a resolved
  non-directory to `ROOT_NOT_RESOLVED`). Verified by: AC-16.

### Credentials and isolation

- **BR-208** — The token is read only through the existing F-002 sources.
  After `loadConfiguration` the CLI deletes `KDRIVE_TOKEN` from its environment
  object, passes the token only to the adapter factory, and passes to
  `preflightConfiguration` and to each runtime only the configuration returned
  by `withoutCredential(local)` (exported from `src/config.ts`: a frozen copy
  whose `token` is the empty string and which has no `tokenFile`). No exported
  value, runtime configuration, error, log line, MCP result, HTTP event,
  recording or acceptance report contains the token. Verified by: AC-17.
- **BR-209** — The extraction worker starts with `env: {}`, `argv: []` and
  `execArgv: []`. This is hygiene, not a boundary (D-13). Verified by: AC-18.

### Composition

Composition rules are versioned by F-014 (each BR record gains a v2 History
line citing F-014); the source specs F-002, F-005, F-009 and F-013 are not
re-versioned.

- **BR-016 v2** (replaces v1's local-only ordinary invocation) —
  Standalone `--version` keeps v1 behaviour. `--help` keeps v1 behaviour
  except that the two lines starting `Validate local configuration;` and
  `Injected stdio modules exist;` are replaced by the single line
  `Serve kDrive over stdio or HTTP after production preflight.` Ordinary
  invocation loads
  the local configuration, runs production preflight through the adapter, and
  starts the selected stdio or HTTP runtime with the production adapter;
  any configuration or preflight failure prints one sanitized
  `Configuration error [<code>] (<setting>).` line to stderr and exits 1;
  the text `runtime is not implemented yet` no longer exists. Verified by:
  AC-19.
- **BR-028 v2** — `LocalConfiguration` and `ResolvedConfiguration`
  stay separate exported types; unit and CI tests use injected
  readers/resolvers/transports and synthetic credentials only, and a real
  credential is used only by the owner-run targets of BR-211 v3 and BR-215 v2.
  Verified by: AC-19, AC-21.
- **BR-071 v2** — The packaged CLI composes
  `startStdioNavigation` with the resolved configuration and the production
  adapter, keeps stdout for MCP protocol messages only, and starts no synthetic
  session. Verified by: AC-19.
- **BR-210** — In HTTP mode the CLI composes `startHttpServer` with the
  resolved configuration, the production adapter, `createFetchUpstream` in
  proxy mode, the production clock and random ports, and a logger writing one
  JSON event per stderr line; SIGTERM or SIGINT runs the F-012 BR-169
  `close()` and exits 0. Verified by: AC-20.
- **BR-216 v2** — The API origin, the storage-host suffix, port 443 and the
  BR-191 address policy are constants of `src/kdrive/`; no environment
  variable, CLI flag, configuration value or file changes them, and
  `src/kdrive/` reads no `process.env`. The only seams are the in-process
  exports `main(deps)` (`src/main.ts`) and the adapter factory, which accept
  `{lookup, connect}` and an optional read-only observer
  `onRequest(method, routeTemplate)` that receives no ID, query, header or body
  and cannot alter or cancel a request; it is called once per outgoing HTTP
  request (each central-helper retry and the download redirect hop included),
  before `connect`, and any exception it throws is caught and ignored. Throughout this spec an "injected
  transport" means a test `lookup` plus a test `connect` that dials a loopback
  TLS server serving scripted or recorded responses. Production `lookup` is `dns.lookup` with `all: true`, and
  production `connect` is `tls.connect` to the checked address with
  `servername` set to the original host and the default CA store: the adapter
  passes `connect` an options object whose key set is exactly `{host, port,
  servername}`, and production `connect` calls `tls.connect` with exactly
  those three members plus `rejectUnauthorized: true`, so certificate
  verification holds even when `NODE_TLS_REJECT_UNAUTHORIZED=0` is set, and no
  other TLS option (`ca`, `checkServerIdentity`, `secureContext`,
  `minVersion`, `maxVersion`, `ciphers`, `secureOptions`, `pfx`,
  `secureProtocol` or any other) is set, so Node's other defaults apply; the address
  policy, header handling and redirect checks run in the adapter before
  `connect` and cannot be replaced; `src/cli.ts`, the packaged `bin` entry, only calls `main`
  with the production dependencies and has no other top-level behaviour. No
  environment variable, CLI flag, configuration value or file enables request
  or response logging. Verified by: AC-27.
- **BR-217 v2** — When an upstream response has status 401 or 403, the adapter
  reports it to the composition, which emits at most one operator event per
  60,000 ms of monotonic time: in stdio mode the stderr line exactly
  `kDrive upstream refused a request (<status>).`, in HTTP mode the stderr JSON
  line exactly `{"event":"kdrive_upstream_refused","status":<status>}`. The
  event carries no other field; the client-visible result is unchanged
  (Error-mapping table). Likewise, when a request fails unbranded for a
  timeout, DNS/address, TLS, socket or queue-full cause, the composition emits
  at most one such event per 60,000 ms, in a rate window separate from the
  refused-event window (timeout → `timeout`; DNS failure, address refusal or
  socket error → `network`; TLS → `tls`; queue full → `queue`; abort, size and
  encoding failures emit nothing): in stdio mode the stderr line
  exactly `kDrive upstream unavailable (<class>).`, in HTTP mode exactly
  `{"event":"kdrive_upstream_unavailable","class":"<class>"}`, where `<class>`
  is one of `timeout`, `network`, `tls`, `queue`; no other field. Both event
  kinds are emitted only once preflight has succeeded: a refusal or an
  unavailable cause during preflight emits no event, and the single BR-016 v2
  configuration-error line remains the only stderr output of a failed
  preflight (BR-175 v2). Verified by: AC-28.
- **BR-123 v2** — Missing qualified content dependencies refuse
  authorized reads explicitly while raw reads, resources and navigation keep
  their accepted contracts; the production composition always supplies the
  content port. Verified by: AC-19.
- **BR-175 v2** — The runtime image keeps v1's stage settings and
  `--version` behaviour; run with `--http` under the BR-180 flags,
  `--network none` and the synthetic secret files, it prints exactly
  `Configuration error [PREFLIGHT_FAILED] (preflight).` and exits 1. Verified
  by: AC-20.

### Qualification

- **BR-211 v3** — `make kdrive-record` runs only inside the dev Compose service,
  reads the token and the private fixture manifest from the BR-212 directory,
  issues at most 200 GET requests within 600,000 ms through the production
  transport, records every children page of each folder in its plan up to the
  terminal page (21 pages for the 1,001-child folder and at least 6 for the
  received child folder at 50 entries per page) and fails without writing
  when a folder is still nonterminal after 32 pages, and writes only sanitized recordings under
  `artifacts/kdrive-recordings/<run>/`; it writes nothing when the BR-213 leak
  check fails. On success it prints, per route template (the `shared_with_me`
  route included), the request count and the maximum request duration in
  milliseconds measured with a monotonic clock, and nothing that names an ID,
  name, path, cursor, ETag, URL or token. Verified by: AC-21.
- **BR-212** — `make kdrive-record` and `make kdrive-acceptance` refuse, before
  any Docker command, a `KDRIVE_ACCEPTANCE_DIR` that is not an absolute
  directory outside the checkout, is a symlink, is unreadable, or holds entries
  other than `kdrive-token` and `fixtures.json`; they mount it read-only at
  `/run/kdrive-acceptance` and pass the token only as
  `KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token`. Verified by: AC-21.
- **BR-213 v3** — A sanitized recording keeps only the JSON members of the
  Recorded-members list and drops every other member (emails, users,
  `created_by`, drive names, share links, timestamps included). It replaces
  every drive/file ID except `1` by a consistent synthetic ID, assigned only
  after the whole session is recorded, drawn sequentially from 1,000,001 upward
  and skipping every real ID observed in the session, every name by an
  alias (`n<k>` for manifest fixtures, `x<k>` for any other entry, so entry
  counts are preserved), every path by the path rebuilt from aliases with the
  literal components `Shared` and `Private` kept, every ETag and cursor by a
  synthetic value preserving equality, and every storage `Location` by
  `https://s1.download.kdrive.infomaniakusercontent.com/r`; it keeps only the
  header allowlist (`status`, `content-type`, `content-length`,
  `content-range`, `accept-ranges`, `etag`, `location`) and body bytes only of
  the designated synthetic binary. Synthetic cursors are `cursor<k>` and synthetic ETags `"etag<k>"`, each `k`
  a decimal counter from 1 in first-seen order per kind, so neither contains a
  whole decimal token and every ETag stays within BR-205's bound. The leak
  check refuses output containing the token, any real ID other than `1` as a
  whole decimal token (a digit run with no letter, digit or underscore
  immediately before or after it) outside the exempt fields, any real name of
  4 or more bytes seen in any response, any `@` between word characters, or any
  `http:`/`https:` URL other than the fixed synthetic `Location`. The exempt
  fields are an exchange `template` exactly equal to a route-table template, a
  hop's `status`, the `limit` query value, the request `range`, the
  `content-length` and `content-range` header values, and the value of every
  `size` member; only the real-ID search skips them. Each exempt value has its
  form or the check fails: `status` an integer from 100 to 599, `limit` exactly
  `50`, `range` `bytes=<a>-<b>`, `content-range` `bytes <a>-<b>/<n>` or
  `bytes */<n>` with `<a>`, `<b>` and `<n>` decimal digits, `content-length` decimal digits, and
  `size` a nonnegative integer or `null`; a
  form violation fails with the category `exempt field form` and its location
  only. The `content-type` value is searched
  with its `charset=utf-8` parameter (ASCII case-insensitive) removed. A
  failure message names only the category and, for real IDs, the digit count
  and the JSON location of each colliding ID, never a value; a location prints
  array indices as numbers and a member name only when it is in the
  Recorded-members list, the header allowlist, the route-table path
  placeholders, or the recording schema (`exchanges`, `template`, `params`,
  `query` as `[name, value]` pairs, `range`, `hops`, `status`, `headers`,
  `json`, `body`), and every other member name as `<member>`. Verified
  by: AC-21.
- **BR-214 v2** — CI runs the adapter contract suite against the committed
  recordings through an injected transport with no network access, and a test
  refuses committed recordings that contain a member outside the
  Recorded-members list or a value outside the BR-213 v3 synthetic forms
  (including a cursor other than `cursor<k>` or an ETag other than
  `"etag<k>"`). Verified by: AC-22.
- **BR-215 v2** — `make kdrive-acceptance` runs on an actual main checkout inside
  the dev Compose service with at most 400 GET requests and 900,000 ms, executes
  the checks of AC-23–AC-26 in process through `main(deps)` with the production
  `{lookup, connect}` and a counting `onRequest` observer (BR-216 v2) that records
  only method, route template and count, plus a packaged-CLI smoke (initialize, tool listing and one
  permitted read, with no request-log assertion),
  and prints only a sanitized summary (per-check pass/fail, request counts,
  durations, byte totals, main SHA) that contains no ID, name, path, cursor,
  ETag, URL or token. The durations include, measured with a monotonic clock in
  the acceptance process, the maximum single-request duration per route
  template and the maximum navigation tool invocation duration (an
  invocation run by the `src/navigation.ts` runtime under the F-005
  10,000 ms deadline, measured in the acceptance process from the tool call to
  its result); the mechanism adds no seam to production code. "Actual main" means: the target refuses, before any
  Docker command, unless the worktree is clean and `HEAD` equals the
  `origin/main` ref the owner fetched beforehand; the orchestrator checks the
  printed SHA against GitHub's `main` when recording the report. Verified by:
  AC-21, AC-23–AC-26.

## Contract details

### Route table (BR-190)

| Port | Route | Query |
| --- | --- | --- |
| `inspectDrive`, received `role` | `/2/drive/init` | `with=drives` |
| `inspect`, `describe`, `resolveDirectory` (ID) | `/3/drive/{d}/files/{f}` | `with=path,parents,capabilities` |
| `children`, `collection` `list`, path walk | `/3/drive/{d}/files/{f}/files` | `limit=50`, `with=…`, `cursor?` |
| `collection` `search` | `/3/drive/{d}/files/search` | `query`, `limit=50`, `with=…`, `directory_id?`, `cursor?` |
| `collection` `recents` | `/3/drive/{d}/files/recents` | `limit=50`, `with=…`, `cursor?` |
| `collection` `my-shared` | `/3/drive/{d}/files/my_shared` | `limit=50`, `with=…`, `cursor?` |
| received `list` | `/3/drive/files/shared_with_me` | `limit=50`, `with=path,capabilities`, `cursor?` |
| `describe`, `open` | `/2/drive/{d}/files/{f}/download` | none; `Range` header |

Fixed request headers: `Accept: application/json` (JSON routes),
`User-Agent: kdrive-mcp-server/<package version>`, `Accept-Encoding: identity`.
A JSON success requires `result === "success"` and a `data` member; anything
else is an envelope failure. The `recents`, search cursor and `my_shared`
behaviours are unmeasured: the recording session (AC-21) establishes their
envelope; a route whose recorded envelope does not fit BR-201 v3/BR-202 v3 makes the
corresponding collection return `{status:"incomplete"}` and is reported as a
blocker, not silently accepted.

### Recorded members (BR-213 v3, BR-214 v2)

Envelope: `result`, `data`, `has_more`, `cursor`, `error.code`. Item (in
`data`, list entries and `parents` members): `id`, `drive_id`, `parent_id`,
`type`, `status`, `name`, `path`, `size`, `parents`, and `capabilities` with
boolean-valued members only. Init: each drive's `id` and `role`. These are the
only members the adapter reads.

### Error mapping (BR-196, BR-198)

Client-visible codes follow the existing wrappers: the navigation `bounded`
wrapper (`src/navigation.ts:270-274`) turns a branded `ReadFailure` into
`READ_UNAVAILABLE` and any unbranded rejection into `ACCESS_DENIED`, for policy
and content ports alike; preflight turns any rejection into `PREFLIGHT_FAILED`
(`src/config.ts:200-203`).

| Upstream outcome | Adapter result | Client / operator sees |
| --- | --- | --- |
| 2xx JSON, valid envelope | normalized value | normal result |
| 2xx JSON, invalid envelope or item | `{status:"incomplete"}` (policy ports) / unbranded `READ_UNAVAILABLE` (preflight, content) | `ACCESS_DENIED` / `PREFLIGHT_FAILED` |
| 404 with `error.code === "object_not_found"` on metadata | `{status:"missing"}` (policy ports) / unbranded `READ_UNAVAILABLE` (`describe`, preflight) | `ACCESS_DENIED` / preflight `PREFLIGHT_FAILED` |
| `describe` on a valid live item failing a BR-205 condition | descriptor with `etag: null` | `VERSION_UNAVAILABLE` |
| 401, 403, 422, other 4xx | `ReadFailure(status)` (not retried by the central helper) | `READ_UNAVAILABLE` / `PREFLIGHT_FAILED`; 401/403 also BR-217 v2 event after preflight |
| 429, 500–599 | `ReadFailure(status)` (retried by the central helper only) | after retries `READ_UNAVAILABLE` / `PREFLIGHT_FAILED` |
| 3xx on JSON, second redirect, disallowed host | unbranded `READ_UNAVAILABLE` | `ACCESS_DENIED` / `PREFLIGHT_FAILED` |
| Timeout, abort, DNS/address, TLS, socket, size, encoding, queue full | unbranded `READ_UNAVAILABLE` | `ACCESS_DENIED` / `PREFLIGHT_FAILED`; after preflight, timeout, network, TLS and queue causes also emit the BR-217 v2 unavailable event |

Only `error.code` is read from an error body, and only to recognize
`object_not_found`; nothing from it is kept or exposed. Preflight failures
surface only as F-002 `PREFLIGHT_FAILED` / `DRIVE_NOT_ALLOWED` /
`ROOT_NOT_RESOLVED`. Retries happen only in the existing central helper; the
adapter has no Retry-After handling.

### Deadlines and cancellation (BR-193)

The policy ports (`inspect`, `children`, `collection`, received ports) receive
no `AbortSignal` in the frozen F-003/F-004 interfaces. The adapter therefore
owns a 5,000 ms per-request deadline for them; when the navigation invocation
is aborted earlier, the navigation runtime already discards the late result
and the upstream request ends at its own deadline at the latest, keeping its
BR-195 slot until then. Content ports receive the invocation signal and abort
immediately. Every socket is destroyed on deadline, abort, refusal or
`close()`. No timer or socket survives a settled port call except an open
body reader, which its owner closes and which BR-195 bounds by a 5,000 ms idle
limit.

### Normalized shapes

Configured-tree items follow `item()` exactly: `status:"complete"`,
`location:"live"`, `lifecycle:"live"`, `rootId:1`, the chain of BR-199 v2.
The adapter never invents a missing ancestor, reorders beyond the single
provider-order/reverse check, URL-decodes, trims, folds case or normalizes
Unicode. Children and collection envelopes echo the request fields the policy
checks (`invocation`, `listing`, `driveId`, `id`, `location`, `treeRootId`,
`cursor`, `kind`, `scope`, `query`) by copying them from the request object.
Received items carry `anchorId`, `role`, recipient path and capabilities as
F-004 requires; the anchor rule of BR-203 v3 rests on the recorded descendant
ancestry of run `20261109073932` (share root directly under the owner's root)
and is qualified on other placements only by AC-25.

### Version binding (BR-205, BR-206)

F-007 lets a production adapter assert `version_bound:true` only after
positive, changed-version and negative qualification. The adapter derives a
strong-syntax tag from the opaque provider ETag (hash, so the provider value is
never exposed) and checks the response ETag on every 206. The assertion holds
only if a content change changes the provider ETag and a range response never
mixes versions under one ETag; AC-26 must show the first on a designated
fixture, and the residual risk of the second is recorded in Decisions. If AC-26
fails, the ticket does not close and a new spec version sets
`version_bound` to `false` for all content.

### Composition (BR-016 v2, BR-071 v2, BR-210)

`src/main.ts` exports `main(deps)` (argv, environment object, standard streams,
signal source, exit, monotonic clock, and the adapter transport/resolver);
`src/cli.ts` (the `bin` entry) is a single call of it with production
dependencies (BR-216 v2), so tests import `src/main.ts` without running production
code. Ordinary
path: `loadConfiguration` → delete `KDRIVE_TOKEN` from the environment object
→ construct the adapter with `local.token` and the BR-217 v2 refusal hook →
`safe = withoutCredential(local)` →
`preflightConfiguration(safe, adapter.preflight)` → stdio:
`startStdioNavigation(configuration, adapter.dependencies, {signals: true})`;
HTTP: `startHttpServer({...})` per BR-210. The BR-217 v2 HTTP-mode line is written
by the CLI's stderr writer, not as an F-012 `HttpEvent`, so the F-012 event set
is unchanged. The HTTP startup failures keep their
F-012 sanitized diagnostics. The dev-only `scripts/http-acceptance.ts`
composition and F-013's smoke stage are unchanged.

### Owner-run qualification

Owner provides, in a directory outside the checkout (`KDRIVE_ACCEPTANCE_DIR`):

- `kdrive-token`: an Infomaniak API token with the `drive` scope;
- `fixtures.json`: the private manifest naming the designated fixtures by ID:
  the drive; the #5 synthetic namespace folder; the 16-byte binary; a nested
  directory; the 1,001-child pagination folder; an item outside the namespace
  (outside-scope control); a namespace child used as the deny-pattern target;
  a nonexistent file ID; the version-change file (a synthetic text file of at
  least 1 byte inside the namespace, D-15); and the received-share fixtures of
  D-16: a received root shared with the token's account by a second kDrive
  account, holding a child folder with at least 257 entries and a grandchild
  file; a received descendant used as the deny-pattern target; a second
  received folder (the revocable share); and an unrelated external ID.

Sequence: (1) on the feature branch, `make kdrive-record` produces sanitized
recordings and prints per-route request counts and maximum request durations
(BR-211 v3); the author copies them to `tests/fixtures/kdrive/` after review;
(2) CI runs the contract suite on them (BR-214); (3) after merge, the owner runs
`make kdrive-acceptance` on actual main; (4) the orchestrator records
`runs/70-acceptance-<n>.md` and posts sanitized results on #70, #6 and #7.
Evidence never contains IDs, names, paths, cursors, ETags, URLs or the token;
only the manifest, which stays outside the repository, maps aliases to IDs.

Acceptance configurations: run A with root = the namespace folder and a deny
pattern on the designated child; run B with root `1` of the drive and the same
deny; run C with `KDRIVE_MCP_SHARED_WITH_ME=true` and a deny pattern on the
received deny target. All runs keep `maxTreeItems` at its default 1,000,000
(at least 1,001 is required). Owner steps happen inside one acceptance process
at a prompt that waits for the owner's confirmation; the wait counts toward
the 900,000 ms bound: (a) the version edit of AC-26, (b) the revocation of the
revocable share by the second account in AC-25. The simulated directory
effect of F-003 AC-19 uses `createPolicy` in `write` mode with a spy `execute`
that never reaches the transport; the same construction in `share` mode
simulates re-sharing a received item (AC-25). The transport refuses any non-GET
in all cases (BR-190).

## Acceptance criteria

- **AC-01 (BR-190)** — Given the adapter with an injected recording transport,
  When every port is exercised, Then every request is `GET` to
  `https://api.infomaniak.com` on a Route-table template with encoded query
  values, the bearer header is present only there, and a request built from a
  non-safe-integer ID throws before transport. Verified by:
  `tests/kdrive/adapter-transport.test.ts` (`TestBR190_*`).
- **AC-02 (BR-191)** — Given an injected resolver returning, in turn, each
  refused address class (including IPv4-mapped private, NAT64, 6to4 and Teredo
  addresses) and a mixed public/private answer, When a request
  starts, Then the test `connect` is never called and the call rejects
  `READ_UNAVAILABLE`; Given a public address, Then the test `connect` receives
  exactly that checked address, `servername` equal to the original host and no
  CA override, and an options object whose key set is exactly `{host, port,
  servername}`, asserts them, and then dials the loopback test server with the
  test CA, and the request succeeds; Given a child process started with
  `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` pointing at a local recording proxy,
  When the adapter, built by the same factory with the same test `connect`,
  issues a request, Then the proxy receives zero connections. Verified by: `adapter-transport.test.ts`
  (`TestBR191_*`) with a local TLS test server, test CA and recording proxy.
- **AC-03 (BR-192)** — Given scripted responses (JSON 301/302; download 302 to
  the allowed host; to `api.infomaniak.com`, an IP literal, an uppercase,
  underscore, 64-character or two-label host, port 8443, userinfo, fragment, `http:`; a second 302; direct
  206), When requested, Then only the allowed single hop and the direct 206
  succeed, and the second request carries no `Authorization` or `Cookie`.
  Verified by: `adapter-redirect.test.ts` (`TestBR192_*`).
- **AC-04 (BR-193)** — Given a stalled JSON body, stalled download headers, a
  stalled body read and an aborted content signal (fake timers), When the
  deadlines elapse or the signal aborts, Then each call rejects
  `READ_UNAVAILABLE` within its bound, the socket is destroyed, and no timer
  remains. Verified by: `adapter-deadline.test.ts` (`TestBR193_*`).
- **AC-05 (BR-194)** — Given bodies of 4 MiB and 4 MiB + 1 (JSON), 8 KiB and
  8 KiB + 1 (error, redirect), and `Content-Encoding: gzip`, When received,
  Then the first of each pair is accepted and the others are refused before
  parsing. Verified by: `adapter-limits.test.ts` (`TestBR194_*`).
- **AC-06 (BR-195)** — Given 8 in-flight requests, 64 waiters and one more,
  When started, Then the 73rd is refused, waiters start in order, and a waiter
  past its deadline rejects without starting; Given an open body reader, Then
  it holds a slot until end of stream, `close`, a failed `read` or 5,000 ms
  without a pending `read`, after which the slot is free and the socket
  destroyed. Verified by:
  `adapter-limits.test.ts` (`TestBR195_*`).
- **AC-07 (BR-196)** — Given each row of the Error-mapping table, When a port
  call receives it, Then the result is the mapped one, the client-visible code
  through `createNavigationServer` is the table's, `retryableRead` is true
  only for 429/5xx, the transport was called once, and no rejection's message
  or own properties contain body text, header, URL, ID, cursor or token.
  Verified by: `adapter-errors.test.ts` (`TestBR196_*`) plus a navigation-level
  test that 503, 503, 200 succeeds in three starts.
- **AC-08 (BR-197)** — Given two consecutive identical `inspect` calls and two
  received calls, When the provider answer changes between them, Then the
  second result reflects the change and the transport saw two requests each
  (plus one role lookup per received call). Verified by:
  `adapter-freshness.test.ts` (`TestBR197_*`).
- **AC-09 (BR-198, BR-199 v2)** — Given recorded metadata for root `1`, a file at
  depth 3, provider parents in each order, and tampered variants (missing
  parent, gap, cycle, wrong `drive_id`, path mismatch, unknown or absent
  `status`, extra root in parents, 404 `object_not_found`, 404 other code),
  When inspected, Then valid ones (status `null` and `"ok"`) normalize to items
  accepted by `item()`, the 404 `object_not_found` gives `missing`, the 404
  with another code rejects `ReadFailure(404)` (BR-196), and every other
  variant gives `incomplete`; Given root `1` variants with `parent_id` `null`
  and `0` (otherwise valid), Then each normalizes to
  `{id:1,type:"dir",name:"",path:"/"}` with an empty chain; Given root `1`
  tampered with `type` `file`, a provider `path` other than `/`, a nonempty
  `parents` array, a `drive_id` other than the requested drive, an absent
  `status` member, or an unknown `status` value, Then each gives
  `incomplete`. Verified by: `adapter-normalize.test.ts` (`TestBR198_*`,
  `TestBR199_*`).
- **AC-10 (BR-200)** — Given `inspect(…, "original-trash")` and `execute(any)`,
  When called, Then each returns `{status:"unavailable"}` and the transport saw
  no request. Verified by: `adapter-normalize.test.ts` (`TestBR200_*`).
- **AC-11 (BR-201 v3)** — Given the recorded 1,001-child folder pages and tampered
  pages (foreign `parent_id`, 51 entries, `has_more` without cursor, cursor of
  4,097 bytes, `has_more` false with entries from another folder), When
  `children` runs, Then valid pages carry `terminal`/`next` and the echoed
  request fields and pass `page()`, and tampered ones are `incomplete`; the
  policy traversal of the folder completes in ⌈1001/50⌉ = 21 pages; Given the
  same recordings with the third page truncated (`has_more` true without a
  cursor), When the adapter is composed with `createPolicy` in `write` mode and
  a spy `execute`, Then the simulated directory effect is denied and `execute`
  is never called. Verified by: `adapter-pages.test.ts` (`TestBR201_*`).
- **AC-12 (BR-202 v3)** — Given recorded `search`, `recents` and `my_shared`
  responses containing entries inside and outside a scope folder, When
  `collection` runs with that scope and with scope `1`, Then only in-scope
  entries are returned for the folder, all for `1`, `directory_id` is sent only
  for the folder, and `query` is passed unchanged. Verified by:
  `adapter-pages.test.ts` (`TestBR202_*`).
- **AC-13 (BR-203 v3, BR-204)** — Given recorded `shared_with_me`, init roles
  (`external`, `admin`, absent) and shared-child metadata, When the received
  ports run, Then roots and descendants normalize as F-004 requires only with
  role `external`, capabilities map as BR-204 with every mutation predicate
  `false`, `discover:true` appears only on a complete page, the drive-scoped
  shared route is never requested, received `children`/`collection` use the
  BR-201 v3/BR-202 v3 routes on the request's `driveId`; a descendant with
  path `/Shared/A/B/C` and a provider chain P → A → B whose members carry no
  `path` has anchor A and relative chain A (`/Shared/A`), B (`/Shared/A/B`),
  P dropped; a descendant with path `/Shared/team/x` and chain `team` →
  `team` has the inner `team` as anchor; a root with path `/Shared/A` and a
  linked chain P → Q has `anchorId` its own ID and an empty relative chain; the
  recorded received descendants of run `20261109073932` are `complete`; and a
  descendant whose path is not under `/Shared` (`/Other/A/B`), has one component, whose last name
  differs from its own, whose chain is shorter than n−1 or whose last n−1
  chain names differ from c1 … c(n−1) is `incomplete`. Verified by: `adapter-received.test.ts`
  (`TestBR203_*`, `TestBR204_*`).
- **AC-14 (BR-205)** — Given the recorded 16-byte binary (206,
  `bytes 0-0/16`), and variants (size 0, `Content-Range` total 15, missing or
  257-byte ETag, 200 ignoring the range, folder target), When `describe` runs,
  Then only the first yields `version_bound:true` and an `etag` accepted by
  `strongETag()` that differs from the provider value, and the content reader
  refuses every other variant with `VERSION_UNAVAILABLE` (each variant yields a
  null-`etag` descriptor; `src/content.ts` checks the ETag before the size);
  Given a metadata 404 `object_not_found`, Then `describe` rejects unbranded
  and the client sees `ACCESS_DENIED`.
  Verified by: `adapter-content.test.ts` (`TestBR205_*`).
- **AC-15 (BR-206)** — Given recorded ranges 0-0, 7-9, 15-15 and 16-16 (416),
  plus variants (wrong `Content-Range`, wrong `Content-Length`, different ETag,
  status 200, an extra trailing byte), When `open` and the reader run through
  `createContentReader`, Then the exact known bytes are returned for valid
  ranges, a different ETag gives `VERSION_CHANGED`, other variants refuse
  before any body byte is read, each `read` returns ≤ `max` bytes, and `close`
  destroys the socket. Verified by: `adapter-content.test.ts`
  (`TestBR206_*`).
- **AC-16 (BR-207)** — Given recorded init, metadata and listing responses,
  When `preflightConfiguration` runs with the adapter, Then: an admin drive, a
  directory ID root and a unique directory path root resolve; an external or
  absent drive gives `DRIVE_NOT_ALLOWED`; an ID root that is a file and a path
  whose final component is a file give `ROOT_NOT_RESOLVED`; an init
  `ReadFailure(401)`, a missing ID root, a file as intermediate component, a
  missing or duplicated name, 65 components, an exhausted request budget and
  the 120,000 ms bound (fake timers) give `PREFLIGHT_FAILED`. Verified by:
  `adapter-preflight.test.ts` (`TestBR207_*`).
- **AC-17 (BR-208)** — Given a synthetic canary token, When every test of
  AC-01–AC-16 and AC-19–AC-20 runs, Then the canary appears only in the
  `Authorization` header of API-origin requests, and never in captured stderr,
  stdout, MCP results, HTTP events, rejection messages, `JSON.stringify` of
  the adapter, of the configuration passed to `preflightConfiguration` and to
  each runtime, or recordings; and after `main` loads the configuration from an
  environment object holding `KDRIVE_TOKEN`, that object no longer has the
  key. Verified by: `adapter-credential.test.ts`
  (`TestBR208_*`).
- **AC-18 (BR-209)** — Given a running extraction, When the worker reads
  `process.env`, `process.argv.slice(2)` and `process.execArgv`, Then all are
  empty. Verified by: `extraction-isolation.test.ts` (`TestBR209_*`).
- **AC-19 (BR-016 v2, BR-028 v2, BR-071 v2, BR-123 v2)** — Given in-process
  `main(deps)` with a synthetic token file, in-memory streams and an injected
  transport answering init and metadata, When started in stdio mode, Then a
  real SDK client lists the ten BR-060 v4 tools and reads the synthetic file
  through `kdrive_info` and the `kdrive://` resource, and stdout carries only
  protocol messages; Given the injected transport failing, Then stderr is
  exactly `Configuration error [PREFLIGHT_FAILED] (preflight).` and exit is
  called with 1. Given the packaged `dist/cli.js`, When run with `--version`,
  `--help` and a local configuration error (paths that end before any adapter
  request), Then `--version` is unchanged, `--help` shows the BR-016 v2 line
  and neither replaced line, and the error line and exit 1 hold. Verified by: `tests/cli.test.ts` (`TestBR016v2_*`,
  `TestBR071v2_*`, `TestBR123v2_*`).
- **AC-20 (BR-210, BR-175 v2)** — Given HTTP insecure-loopback configuration
  and in-process `main(deps)` with the injected transport, When it starts, Then
  an SDK HTTP client initializes and calls `kdrive_info`, every stderr line is
  one JSON event, and SIGTERM, and in a second run SIGINT, from the injected
  signal source closes the server and calls exit with 0; Given proxy-mode
  configuration, Then the composition passes `createFetchUpstream` to
  `startHttpServer`; Given
  the runtime image under `--network none`, Then BR-175 v2's exact line and
  exit 1 hold. Verified by: `tests/http/cli-http.test.ts` (`TestBR210_*`) and
  `make image-smoke` (`scripts/image-smoke.sh` check updated).
- **AC-21 (BR-211 v3, BR-212, BR-213 v3, BR-028 v2)** — Given invalid
  `KDRIVE_ACCEPTANCE_DIR` values (relative, inside the checkout, symlink, extra
  entry, missing token) or a dirty worktree or `HEAD` other than `origin/main`
  for `kdrive-acceptance`, When either target runs, Then it refuses with a
  fixed message before any Docker command; Given a synthetic sanitizer input
  with an email, a share-link URL, a `created_by` user object, a drive name, a
  non-manifest entry, root `1` and a `/Shared/<name>` path, Then the output
  keeps only Recorded members, aliases the non-manifest entry as `x<k>`, keeps
  `1`, `Shared` and the entry count; Given output still containing the canary
  token, a real ID, a 4-byte real name, an email or a URL, Then no file is
  written; Given real IDs 2, 7, 8, 16, 50 and 200 that equal only a route
  `template` segment, a `status`, the `limit`, a `range`, a `content-range`, a
  `content-length`, a `bytes */<n>` `content-range`, a `charset=utf-8`
  `content-type` or a `size` value, Then the check passes, and Given the same ID in any other member, a cursor, a
  decoded body or another `content-type` parameter, or an exempt field with
  another form, Then a real-ID collision fails with the category, digit count
  and location only, a non-allowlisted member name printing as `<member>`, and
  a form violation fails with `exempt field form` and its location only; Given
  `limit=200`, Then it fails with `exempt field form at
  exchanges[<i>].query[<j>][1]`. Owner-run: `make kdrive-record KDRIVE_ACCEPTANCE_DIR=<dir>` on the
  feature branch writes recordings whose request count is ≤ 200 and that hold
  all 21 pages of the 1,001-child folder through its terminal page; Given a
  scripted folder still nonterminal after 32 pages, Then the recorder fails
  and writes no file; Given a scripted recorder session with a fake monotonic
  clock (one `children` request lasting 1,879 ms, the others shorter) whose
  pages carry a planted ID, name, cursor and URL, Then the success summary
  lists, per route template (`shared_with_me` included), the request count and
  the maximum duration (1,879 ms for `children`) and contains none of the
  planted values. Verified by:
  `tests/kdrive/recordings.test.ts` (`TestBR211_*`),
  `tests/kdrive/acceptance-entry.test.ts` (`TestBR212_*`),
  `tests/kdrive/sanitize.test.ts` (`TestBR213_*`), and the owner-run record
  report `runs/70-record-<n>.md`, which quotes the recorder's per-route
  request counts and maximum request durations (`shared_with_me` included).
- **AC-22 (BR-214 v2)** — Given the committed recordings, When `make check` and
  CI run, Then the contract suite passes with network disabled, and the
  recordings test refuses a planted non-synthetic name or ID, a planted cursor
  `cursor-1`, a planted ETag `"etag-1"` and a planted member outside the
  Recorded-members list. Verified by:
  `tests/kdrive/recordings.test.ts` (`TestBR214_*`) and the PR CI run.
- **AC-23 (BR-215 v2; F-003 AC-19)** — Given runs A and B against the designated
  fixtures on actual main, When `make kdrive-acceptance` runs, Then: the binary,
  root `1` and the nested directory are permitted by fresh metadata (two
  consecutive checks issue two metadata requests); list and search return
  permitted entries; the 1,001-child traversal completes and authorizes the
  simulated `write`-mode directory effect with zero calls to the real
  `execute`; the denied child and the nonexistent ID are denied in both runs
  and collections omit them; the outside-scope item is denied and omitted in
  run A, and permitted by fresh metadata in run B, whose root `1` contains it. Incomplete and contradictory evidence is
  covered on recordings by AC-09, AC-11 (including the truncated-page replay
  through `createPolicy`) and AC-13, as F-003 AC-19 allows adapter contract
  tests against qualified fixtures; the report quotes the maximum
  single-request duration per route template and the maximum navigation tool
  invocation duration against the 5,000 ms (BR-193) and 10,000 ms (F-005)
  deadlines. These durations are reported, not judged: any `REQUEST_TIMEOUT`
  in an AC-23–AC-26 check fails that check and acceptance, and opens the F-006
  owner decision on the per-invocation list bound. Given the acceptance
  summary formatter with scripted results (a request of 1,879 ms on one route
  template, an invocation of 9,400 ms) and inputs carrying a planted ID, name,
  cursor and URL, Then the summary holds those two maxima and none of the
  planted values. Verified by: `tests/kdrive/acceptance-entry.test.ts`
  (`TestBR215_*`) and owner-run
  `make kdrive-acceptance`, report `runs/70-acceptance-<n>.md`.
- **AC-24 (BR-215 v2; F-003 AC-20)** — Given in-process `main(deps)` in stdio mode
  and in HTTP insecure-loopback mode with run A and the BR-215 v2 counting spy, When an SDK client reads the binary
  through the `kdrive_info` tool and the `kdrive://` resource, Then the tool
  returns its metadata and the resource its 16 known bytes; When it requests the outside-scope ID through each surface,
  Then the result is `ACCESS_DENIED` and the spy counts zero download requests
  for it; Given the packaged CLI in stdio mode, Then initialize, tool listing
  and the permitted read succeed. Verified by: owner-run `make kdrive-acceptance`.
- **AC-25 (BR-215 v2; F-004 AC-14, AC-15)** — Given run C and the D-16
  received-share fixtures, When acceptance runs, Then discovery lists the
  received root and the revocable share; root, child and grandchild reads
  succeed through the tools with the F-004 recipient paths and capabilities; a
  scoped listing of the child folder (all tool pages, following `next_cursor`) issues at least six upstream children requests (⌈257/50⌉, counted by the BR-216 v2 observer; tool pages aggregate upstream pages); the unrelated
  external ID and the denied descendant are denied; external-root enumeration
  is refused; a simulated `share`-mode re-share of the received root through
  `createPolicy` with a spy `execute` is denied with zero `execute` calls.
  Within the same process, after a successful read of the revocable share
  starts a list snapshot, the prompt asks the owner to have the second account
  remove that share; the first read of it started at least 60,000 ms of
  monotonic time after the owner's confirmation is refused with
  `ACCESS_DENIED` or `READ_UNAVAILABLE` and returns no metadata or content;
  when the code is `READ_UNAVAILABLE` (which BR-196 also uses for transient
  upstream failures), the same check then requires that discovery
  (`kdrive_shared_with_me`) lists the received root but not the revocable
  share, and that a repeat read of the revocable share is refused again (any
  reusable snapshot predates the revocation, so it is then at least 60 s old;
  earlier reads may still succeed, per F-004 BR-051; kDrive itself may refuse
  the removed share with 403, mapped per BR-196 and BR-217 v2).
  Verified by: owner-run `make kdrive-acceptance`.
- **AC-26 (BR-215 v2, BR-205; F-007 version contract)** — Given the designated
  version-change file, When acceptance reads it twice (same `etag`), then
  prompts the owner, who edits the file's content in the kDrive web interface
  and confirms, and acceptance continues with the first `etag`, Then the next
  describe yields a different `etag` and the continuation returns
  `VERSION_CHANGED`. Verified by: owner-run `make kdrive-acceptance`.
- **AC-27 (BR-216 v2)** — Given `main(deps)` with a recording transport and an
  environment object holding `KDRIVE_API_URL` and `KDRIVE_API_ORIGIN`, When it
  starts, Then F-002 refuses them with `UNKNOWN_SETTING` before any request;
  Given instead names outside the F-002 namespaces (`API_URL`,
  `INFOMANIAK_API_ORIGIN`, `HTTPS_PROXY`, `HTTP_PROXY`; origin selection only,
  proxy bypass is AC-02), When it starts, Then every request still targets
  `https://api.infomaniak.com`; Given `--api-url` or a YAML key `apiUrl`, Then
  configuration fails with `UNKNOWN_OPTION` or `UNKNOWN_SETTING` (F-002); and a source
  test finds no `process.env` reference in `src/kdrive/` and, by parsing the
  TypeScript AST (object keys and identifiers, not substrings), that
  production `connect` calls `tls.connect` with an object literal made of the
  `host`, `port` and `servername` of its options argument and the single
  further key `rejectUnauthorized` with the literal `true`; Given
  `NODE_TLS_REJECT_UNAUTHORIZED=0` and a loopback TLS server with a
  self-signed certificate, When production `connect` dials it, Then the
  handshake fails with a certificate error, and an adapter whose test resolver
  returns a public address (so the BR-191 address guard admits it) and whose
  test `connect` delegates to production `connect` with the loopback server's
  address and port instead rejects with the unbranded `READ_UNAVAILABLE` of
  class `tls`; the variable is set only for this case and restored in a
  `finally` block (or the case runs in a child process), so no other test sees
  it; Given an `onRequest` observer that throws, Then every request
  result is unchanged; and the source test finds only the
  production-dependency `main` call in `src/cli.ts`, and no logging of request
  or response data in `src/kdrive/` or `src/main.ts`. Verified by:
  `tests/kdrive/adapter-origin.test.ts` (`TestBR216_*`).
- **AC-28 (BR-217 v2)** — Given `main(deps)` with a fake monotonic clock in stdio
  and in HTTP mode, When the transport answers 401 three times within
  60,000 ms, then 403 at 60,000 ms, Then stderr holds exactly one 401 line and
  then one 403 line in the mode's fixed format, no line contains an ID, URL or
  the canary token, and the MCP results are `READ_UNAVAILABLE`; Given the
  transport timing out twice and then failing TLS within 60,000 ms, Then stderr
  holds exactly one `timeout` unavailable line in the mode's format and the MCP
  results are `ACCESS_DENIED`; Given a 401 then a timeout within 60,000 ms,
  Then one refused line and one unavailable line appear (separate windows);
  Given, after each window expires, a DNS failure and an abort, Then the line
  is `network` and the abort emits nothing; Given 73 requests at the adapter
  seam (8 in flight, 64 waiters and one more; navigation admits at most 64
  concurrent invocations, so the full queue cannot be reached through
  `main(deps)`), Then the adapter reports the `queue` cause once, and the
  composition formats a `queue` cause as the mode's `queue` line; Given an init
  401 and, separately, an init timeout during preflight in each mode, Then
  stderr holds only `Configuration error [PREFLIGHT_FAILED] (preflight).` and
  no event line.
  Verified by:
  `tests/kdrive/adapter-refusal.test.ts` (`TestBR217_*`).

## Decisions

- **D-01 — HTTP client: Node built-in `node:https` with a custom `lookup`,
  recorded as ADR-006.** It gives per-connection address checks (BR-191),
  manual redirects, socket-level deadlines and streaming reads with no new
  dependency. Rejected: global `fetch` (no supported per-request `lookup`
  without importing `undici`; redirect and abort semantics hide the socket);
  adding `undici` as a dependency (new supply-chain surface and version pinning
  for a feature `node:https` already covers). Costly to reverse because the
  transport, its tests and the address guard are built on it.
- **D-02 — Upstream page size 50 (v5; v2 chose 100, v1 256).** Every listing
  route uses `limit=50`. Evidence: the 2026-11-08 probe
  (runs/70-list-latency-1.md (archived evidence `runs/70-list-latency-1.md`)) put 256 entries
  with `with=path,parents,capabilities` at 3,552–7,340 ms; the 2026-11-09
  owner acceptance on main `7b1769f` (runs/70-acceptance-1.md (archived evidence `runs/70-acceptance-1.md`))
  saw a 100-entry page at 5,010 ms, and the
  tail probe (runs/70-list-latency-2.md (archived evidence `runs/70-list-latency-2.md`), 3 full
  traversals of the 1,001-child folder) measured 100 entries at median
  2,459 ms / max 3,926 ms and 50 entries at median 1,360 ms / max 1,911 ms;
  owner decision 2026-11-09. Server time dominates, a full traversal takes
  about the same total time at either size, and 50 keeps the worst measured
  page about 2.6 times under the 5,000 ms deadline. Rejected: 100 (no margin
  against observed peaks), raising the 5,000 ms deadline (lengthens every
  stalled request and the BR-195 slot it holds, and a single page could then
  consume most of the F-005 10,000 ms invocation deadline), retrying a timed-out
  page (two attempts exceed the invocation deadline). Cost: twice the calls per
  folder (21 pages for 1,001 children), within the BR-211 and BR-215 request
  bounds.
- **D-03 — No adapter retry; reuse the central F-007 helper.** Consistent with
  SPEC §7's "reads retry 429/5xx with progressive, capped wait" and with the
  accepted F-007 BR-088; a second retry layer would multiply attempts.
  Preflight does not retry: a failed start is visible and restartable.
- **D-04 — Adapter-owned 5,000 ms deadlines for signal-less policy ports**
  instead of changing the frozen F-003/F-004 interfaces to pass a signal.
  Residual: an aborted invocation can keep one concurrency slot up to 5 s.
- **D-05 — Concurrency 8 / queue 64** matches F-012's per-identity session bound
  (8) and process session bound (64); invocations are sequential per session.
- **D-06 — Fresh lookups, no cache.** Drive role and ancestry are fetched per
  port call (one extra init request per received call). Rejected: a TTL cache,
  which F-003 forbids as hidden evidence reuse.
- **D-07 — Derived strong ETag** (`"kd1-<base64url sha256>"`) rather than
  quoting the provider value: it always matches `strongETag()`, hides the
  provider value and versions the scheme (`kd1`). Residual risk: version
  binding relies on the provider serving each range from the version named by
  its ETag; AC-26 checks change detection, not atomicity under a concurrent
  write. Empty files get no tag and read as `VERSION_UNAVAILABLE` (behaviour of
  a 0-byte range is unmeasured).
- **D-08 — Include `my_shared` and `recents`.** Both back accepted read tools
  (`kdrive_my_shared`, `kdrive_recents`); excluding them would leave registered
  tools failing in production. Sharing writes stay out of scope.
- **D-09 — Received capability mapping is read-only.** All mutation predicates
  are `false`, so received-share writes stay denied until #17–#20 qualify them;
  `list`/`search` derive from `can_read` on a directory, qualified by AC-25.
- **D-10 — Recorded fixtures come from an owner-run recording on the feature
  branch**, sanitized in memory and leak-checked, then reviewed and committed.
  Rejected: hand-written fixtures only (would not qualify provider semantics);
  live calls in CI (needs a credential in CI).
- **D-11 — Version the runtime-unavailable rules** (BR-016, BR-071, BR-123,
  BR-175) and BR-028 rather than adding superseding rules: their purpose
  (sanitized CLI diagnostics, test separation, image check) is unchanged.
- **D-12 — No outbound proxy support.** The adapter ignores `HTTPS_PROXY`; a
  deployment needs direct egress to `api.infomaniak.com` and the storage hosts.

- **D-13 — Credential confinement is best effort in one process.** The
  runtimes get a token-free configuration and the environment loses
  `KDRIVE_TOKEN` (BR-208), but the adapter closure, the token file and process
  memory stay readable to code in the same process, and the extraction worker
  runs in that process, so `/proc/self/environ` (the start-time environment)
  and memory remain readable to it; BR-209's empty worker `env` is hygiene.
  Rejected: a separate credential process (new IPC surface, out of scope).
- **D-14 — Live status allowlist `null` / `"ok"`, fail-closed.** The `status`
  values are unmeasured; trash and transfer states must not read as live. If
  the recording shows live items with another value, they normalize to
  `incomplete`, the recording report names it as a blocker, and widening the
  set needs a new spec version. Rejected: a denylist of known non-live values
  (fails open on unknown values); deferring to the recordings (hidden open
  question at freeze).
- **D-15 — Changed-version qualification by an owner web-interface edit**
  (owner answer to former Q1, 2026-11-05). The acceptance process waits at a
  prompt while the owner edits a synthetic test file in the kDrive web
  interface; the server never writes. Rejected: shipping `version_bound:false`
  (leaves F-003 AC-20's resource read blocked); an acceptance-script upload (a
  write outside this ticket's scope).
- **D-16 — Received-share fixtures from a second kDrive account** (owner
  answer to former Q2, 2026-11-05). The owner provides a folder shared with the
  token's account by a second account, plus a second shared folder that the
  second account revokes at the AC-25 prompt. Rejected: closing #70 with F-004
  AC-14/AC-15 blocked.
- **D-17 — Upstream credential refusal is reported to the operator (BR-217 v2)**
  (former Q3, settled by the author as a routine choice). Clients see
  `READ_UNAVAILABLE` for a 401/403 (Error-mapping table); the operator gets one
  fixed event per 60 s with only the status. Rejected: no signal (an expired
  token looks like an outage until restart); stopping the process on a 401 (a
  401 also means an inaccessible drive, so one denied request would stop the
  service).
- **D-18 — Transport seams only in-process (BR-216 v2).** Positive CLI paths are
  tested through `main(deps)`; the packaged binary is tested only on paths
  that end before any request, and the image under `--network none`. Rejected:
  an environment variable or flag to inject a transport or origin (would let
  anyone redirect the bearer token).
- **D-19 — Storage-host suffix is unmeasured, fail-closed.** The #5 evidence
  names only a storage/CDN hop. If the recorded `Location` host does not match
  BR-192, every download fails `READ_UNAVAILABLE`, the recording report names
  it a blocker, and widening the allowlist needs a new spec version. Rejected:
  accepting any `infomaniak` host (too wide for a token-free hop that still
  serves private bytes).
- **D-20 — Upstream outages are visible to the operator (BR-217 v2).** Clients
  keep `ACCESS_DENIED` for unbranded failures (accepted `bounded` wrapper), but
  the owner gets one rate-limited, fixed-class event so an outage is
  distinguishable from a policy denial. Rejected: a new client-visible code
  (changes the accepted F-005 wrapper contract).
- **D-21 — The real-ID search skips a closed list of non-ID fields (BR-213
  v2).** On a drive whose IDs have 1 to 3 digits, route versions, protocol
  values, byte counts and the `utf-8` charset collide with real IDs, so v1's
  whole-output search cannot pass on the designated fixtures. The exempt
  fields never carry an ID and their forms admit only fixed literals or
  numbers, so an ID cannot hide in them as free text; `content-type` stays
  searched except for its `charset=utf-8` parameter; names, emails, URLs and
  the token are still searched everywhere. Locations print only allowlisted
  member names because the check is the safety net for sanitizer bugs, where
  an unexpected key may itself be a real ID or name. Rejected:
  synthetic sizes and lengths (breaks the byte-range checks of AC-23–AC-26);
  re-recording on a drive with longer IDs (the revocable share lives on the
  designated drive, and any small file size or status can still collide);
  ignoring short IDs (a short ID in a name or path would pass).
- **D-22 — The received anchor comes from the item's recipient path (BR-203
  v3).** The recording shows `parents` members without `path`, while the item
  itself carries the recipient path `/Shared/…` and its chain begins at the
  share root. Matching the last n−1 chain names against the path components
  needs no member path, drops any owner-side ancestors above the share, and is
  unambiguous because the anchor is chosen by position, not by name. Rejected:
  one extra metadata request per chain member to fetch member paths (more
  requests within the BR-193 deadline and the request budget); treating the
  first chain member as the anchor (wrong whenever owner-side ancestors sit
  above the shared folder).

- **D-23 — A revoked share may be refused by kDrive or by the policy (AC-25,
  v6).** Acceptance run 2 measured that kDrive removes a revoked share from
  `shared_with_me` and answers its metadata with 403 at once; the adapter maps
  403 to `READ_UNAVAILABLE` (BR-196) and emits the BR-217 v2 refusal event.
  A refusal returns no data; together with the share's absence from
  discovery while the received root stays listed, and a repeated refusal
  (AC-25), it proves the revocation rather than a transient upstream
  failure, which BR-196 also reports as `READ_UNAVAILABLE`. Rejected:
  mapping a received-item 403 to `ACCESS_DENIED` (changes BR-196 and BR-217
  v2 for every 403, and a 403 can also mean a revoked token, which the
  operator must see as an upstream refusal); relying on the snapshot TTL alone
  (kDrive's own refusal comes first).
## Open questions

None.

## Stress-test

### Round 1 — 2026-11-05

Review: runs/70-spec-review-1.md (archived evidence `runs/70-spec-review-1.md`) (draft
`f73ab18`, verdict `changes`, 7 major, 5 minor). All findings retained.

1. **Major, token held outside the closure — retained.** BR-208 now removes
   `KDRIVE_TOKEN` from the environment object and gives preflight and the
   runtimes `withoutCredential(local)`; AC-17 stringifies those
   configurations; D-13 records that BR-209 is hygiene only.
2. **Major, drive-wide routes leak real data — retained.** Recorded-members
   list; BR-213 drops all other members, aliases non-manifest entries as
   `x<k>`, keeps `1`, `Shared`, `Private`; the leak check adds emails and URLs;
   AC-21 and AC-22 cover it.
3. **Major, client-visible codes — retained.** The Error-mapping table gains a
   client/operator column based on `src/navigation.ts:270-274` and
   `src/config.ts:200-203`; AC-07 checks the code through
   `createNavigationServer`; the false Q3 premise is gone (D-17).
4. **Major, transport injection into the packaged CLI — retained.**
   `main(deps)` carries positive paths (AC-19, AC-20); the packaged binary is
   tested only on request-free paths; new BR-216/AC-27 forbid origin or
   transport overrides (D-18).
5. **Major, cache expiry and re-sharing — retained.** AC-25 revokes inside one
   process and asserts denial once the snapshot is 60 s old (earlier success
   allowed by F-004 BR-051), and adds a simulated re-share denial.
6. **Major, received anchor and routes — retained.** BR-203 names the member
   whose path is exactly `/Shared/<name>` and the routes and `driveId` of
   received `children`/`collection`; AC-13 extended.
7. **Major, hidden live-status set — retained.** BR-199 fixes `null`/`"ok"`
   fail-closed (D-14); AC-09 adds absent status.
8. **Minor, preflight codes — retained.** BR-207 returns the item's own type,
   so a file root gives `ROOT_NOT_RESOLVED`; AC-16 lists the exact code per
   case.
9. **Minor, help text and BR sources — retained.** BR-016 v2 fixes the new help
   line; versioned BRs cite F-014 instead of implied source-spec bumps.
10. **Minor, bounds — retained.** Body-reader slot and idle limit (BR-195,
    AC-06); named IPv6 transition ranges (BR-191, AC-02); label grammar
    `^[a-z0-9-]{1,63}$` (BR-192, AC-03); "actual main" check (BR-215, AC-21);
    `maxTreeItems` default 1,000,000 stated for all runs.
11. **Minor, tampered recordings for F-003 negatives — retained.** AC-11 adds a
    truncated-page replay through `createPolicy` that denies the directory
    effect; AC-23 cites it.
12. **Minor, Q3 is routine — retained.** Settled as D-17 with BR-217/AC-28;
    emitted by the CLI writer, so the F-012 `HttpEvent` set is unchanged.

Owner answers applied: Q1 → D-15 and the AC-26 prompt step; Q2 → D-16, the
manifest and AC-25. Author-side correction found while revising: AC-09
expected `incomplete` for a 404 with another error code, contradicting BR-196;
it now expects `ReadFailure(404)`.

### Round 2 — 2026-11-05

Review `runs/70-spec-review-2.md` (changes: 1 major, 5 minor), all retained;
applied by the orchestrator directly to save an author round (owner go,
2026-11-05).

- major, BR-215/AC-24 unobservable transport log: retained. AC-23–AC-26 run in
  process through `main(deps)` with a counting spy (method, route template,
  count only); the packaged CLI gets a smoke without log assertion; BR-216
  forbids any env, flag, configuration or file that enables request or
  response logging, and AC-27's source test checks it.
- minor, error mapping: retained. BR-196's envelope case is limited to the
  preflight and content ports; BR-205's null-`etag` case is limited to valid
  live items; the table gains the `describe` 404 and null-`etag` rows; AC-14
  expects `VERSION_UNAVAILABLE` for every variant (the content reader checks
  the ETag first, `src/content.ts`) and `ACCESS_DENIED` for a metadata 404.
- minor, AC-25 timing: retained. The first read started at least 60,000 ms
  after the owner's confirmation returns `ACCESS_DENIED`.
- minor, `main` side effects: retained. `main(deps)` lives in `src/main.ts`;
  `src/cli.ts` is a single production call.
- minor, `NODE_USE_ENV_PROXY`: retained. BR-191 requires an adapter-owned
  `https.Agent`; AC-02 and AC-27 set `NODE_USE_ENV_PROXY=1`.
- minor, AC-20 coverage: retained. AC-20 adds SIGINT, the one-JSON-line stderr
  logger and the proxy-mode `createFetchUpstream` composition.

### Round 3 — 2026-11-05

Diff-only review `runs/70-spec-review-3.md` (changes: 2 minor), both retained
and applied by the orchestrator; the following Fable spec pass reviews the
whole spec including these edits instead of a fourth Opus round (orchestrator
decision, token economy).

- minor, BR-196 vs the `describe` 404 row and AC-14: retained. BR-196's 4xx
  exception now names the metadata 404 `object_not_found` case for every port.
- minor, `NODE_USE_ENV_PROXY` untestable in process: retained. AC-02 runs a
  child process started with the variable and a local recording proxy that must
  receive zero connections; AC-27 drops the variable and covers origin
  selection only; BR-191 is verified by AC-02 alone.

### Fable spec pass 1 — 2026-11-05

Review `runs/70-spec-fable-1.md` (changes: 1 major, 3 minor), all retained and
applied by the orchestrator; per owner policy the change returns to an Opus
review (diff-only, owner go 2026-11-05).

- major, BR-191/AC-02 untestable: retained. BR-216 names the `{lookup,
  connect}` seam; production `connect` is `tls.connect` with `servername` =
  original host and default CA; AC-02's test `connect` asserts address,
  servername and CA, then dials the loopback test server.
- minor, outages indistinguishable from denials: retained. BR-217 adds a
  rate-limited `kdrive_upstream_unavailable` event with a fixed class; D-20;
  AC-28 extended.
- minor, unmeasured storage-host suffix: retained as D-19 (fail-closed,
  blocker report, new spec version to widen).
- minor, synthetic ID collisions: retained. BR-213 draws synthetic IDs from
  1,000,001 upward, skipping observed real IDs.

### Opus review after the Fable pass — 2026-11-05

Diff-only review `runs/70-spec-review-4.md` (approve, 4 minor), all retained
and applied by the orchestrator; a short diff-only check precedes the freeze.

- minor, "transport" vs the `{lookup, connect}` seam: retained. BR-216 defines
  "injected transport" as a test `lookup` plus a test `connect` dialing a
  loopback TLS server, and adds a read-only `onRequest(method, routeTemplate)`
  observer used by the BR-215 counting spy.
- minor, production TLS options untested: retained. BR-216 forbids `ca`,
  `rejectUnauthorized`, `checkServerIdentity` and `secureContext` in
  `src/kdrive/`; AC-02 asserts none reach `connect`.
- minor, BR-217 class map and window: retained. The cause-to-class map is
  explicit and the unavailable event has its own rate window.
- minor, BR-213 ID assignment order: retained. Synthetic IDs are assigned only
  after the whole session is recorded.

### Pre-freeze check — 2026-11-05

Diff-only check `runs/70-spec-review-5.md` (changes: 3 minor), all retained and
applied by the orchestrator: TLS options become an allowlist (exact key set
`{host, port, servername}`, forwarded unchanged, AST source test); the
`onRequest` observer is called once per HTTP request including retries and the
redirect hop, before `connect`, with exceptions ignored (AC-27 case); AC-28
covers the separate windows, `network`, `queue` and the silent abort.

Orchestrator decision (AGENTS.md project override, token economy): after four
Opus rounds, one Fable pass and two diff checks, the remaining findings are
minor wording refinements; the spec freezes with these edits without another
review round. The code review verifies AC-to-test coverage of the edited ACs.

### v2 changes — 2026-11-08

Sources: latency probe (archived evidence `runs/70-list-latency-1.md`) and owner decision
(page size), code review round 1 (archived evidence `runs/70-code-review-1.md`) "Author
interpretations" (wording), Fable code pass 1 (archived evidence `runs/70-code-fable-1.md`)
and the owner decision of 2026-11-07 (TLS).

- Page size 256 → 100 (D-02): BR-201 v2, BR-202 v2, route table, AC-11
  (101-entry tamper, 11 pages), AC-25 (at least three pages). The received
  `shared_with_me` route takes the same size since it requests `with=`; that
  size is a conservative, unmeasured choice: the route requests only
  `with=path,capabilities` (no `parents`) and the probe did not time it.
  BR-211 v2 makes `make kdrive-record` print its maximum request duration so
  the choice is checked on real data. The BR-193 deadline is unchanged.
- Impact on BR-207 (unchanged text): the 1,024-request and 120,000 ms
  preflight bounds stay. A path walk now reads at most 102,400 entries in
  1,024 requests (262,144 before); at the measured 1.5–1.9 s per page the
  120,000 ms bound binds first, at about 63–78 pages (6,300–7,800 entries)
  per preflight, against about 16–33 pages (4,100–8,400 entries) at 256.
  No change is needed.
- Impact on navigation budgets (F-006, unchanged): one invocation's 512 calls
  cover at most 51,200 listed entries (131,072 before), and a paged
  invocation's five list calls at most 500 entries (1,280 before). A received
  discovery snapshot acquired inside a paged invocation is complete only up
  to 500 received roots; beyond that F-006 already returns `LIMIT_EXCEEDED`.
  This is a capacity reduction, not a contract change; it is recorded here
  rather than versioning F-006.
- Impact on the navigation invocation deadline (F-005, F-006, unchanged): an
  invocation has a 10,000 ms wall-clock deadline (F-005; `src/navigation.ts`
  sets it at invocation start and also arms a timer). When it is reached, the
  runtime aborts the invocation's signal, starts no further port call, and
  returns `REQUEST_TIMEOUT`; per F-006 BR-081 the traversal is invalidated and
  no partial batch or reusable continuation is published. At the measured
  1.5–1.9 s per page, five list calls take about 7.6–9.5 s before any
  `inspect` or `/2/drive/init` request, so a paged invocation that needs all
  five list calls (only when the first four pages yield no new visible item,
  for example a run of 400 or more filtered entries, or a received discovery
  snapshot above 400 roots) can reach the deadline. Decision: the margin is
  accepted, not bounded lower in F-014. The outcome fails closed
  (`REQUEST_TIMEOUT`, nothing authorized or published); the common case stops
  after the first page with a visible item (one list call); v1 at 256 entries
  (3.6–7.3 s per page) reached the deadline within two to three pages, so v2
  strictly improves it; and F-014 cannot lower the five-list bound without
  changing F-006's frozen contract, while a smaller page (50 entries, about
  0.85 s) would halve every batch against the owner's 100-entry decision.
  Residual risk: a scope with a long run of filtered entries can time out
  repeatedly. BR-211 v2 and BR-215 v2 require `runs/70-record-<n>.md` and
  `runs/70-acceptance-<n>.md` to report the maximum page and invocation
  durations, so the margin is checked on real data; if acceptance shows a
  timeout, lowering the per-invocation list bound is an F-006 owner decision.
- Recording plan (BR-211 v2, AC-21): the recorder previously stopped after 8
  children pages per folder, which would truncate the 1,001-child folder at
  800 entries (11 pages needed). v2 requires every page up to the terminal
  page, failing without output past 16 pages. Worst case: 1 init + 9
  metadata requests on the owned drive (root `1`, namespace, binary, nested
  directory, pagination folder, outside item, deny child, nonexistent ID,
  version file) + 6 metadata requests on the share owner's drive (received
  root, child, grandchild, deny target, revocable share, unrelated ID) +
  5 folders × 16 pages (namespace, nested, pagination, received root,
  received child) + 4 collection (two `search`, `recents`, `my_shared`) +
  4 `shared_with_me` pages + 10 download requests (five ranged GETs, each a
  redirect and a storage hop) = 114 ≤ 200.
- Owner acceptance (BR-215 v2, AC-23–AC-26): the 400-request and 900,000 ms
  bounds stay; v2 adds the maximum request and invocation durations to the
  sanitized summary. The 1,001-child traversal costs 11 pages per run (A and B)
  instead of 4, at most about 55 s at the 5,000 ms deadline; the received
  child of at least 257 entries now spans at least three pages. The exact
  acceptance request count is not measured here; the implementation phase
  reports it, and the target refuses rather than exceeds 400.
- Wording gaps, no behaviour change: BR-199 v2 states the root `1` rule
  (no `parent_id` read); BR-203 v2 includes the anchor in the relative chain;
  BR-217 v2 and the Error-mapping table state that no event is emitted during
  preflight; AC-27 names the `KDRIVE_*` refusal and the non-namespaced names
  tested; AC-28 drives the full queue at the adapter seam and adds the
  preflight case.
- TLS (BR-216 v2, AC-27): production `connect` sets `rejectUnauthorized:
  true` so `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot disable verification; the
  adapter-to-`connect` key set stays `{host, port, servername}`. This closes
  the residual risk accepted for v1.

### v2 review round 1 — 2026-11-08

Independent spec review of v2 (changes: 2 major, 6 minor). Fix author:
Claude Opus 5.5 (effort unknown). Every finding retained:

1. Major, AC-09 root `1` coverage — retained. AC-09 adds the root `1`
   tampers (type `file`, path not `/`, nonempty `parents`, foreign
   `drive_id`, absent or unknown `status`, each `incomplete`) and the valid
   root with `parent_id` `null` or `0` normalizing to the sentinel.
2. Major, 10,000 ms invocation deadline — retained. "v2 changes" states the
   F-005 deadline and its F-006 BR-081 outcome (`REQUEST_TIMEOUT`, no partial
   batch or continuation), and accepts the margin as a documented residual
   risk: fail-closed, common case one list call, strictly better than v1, and
   a lower list bound would change F-006's frozen contract (owner decision
   only if acceptance shows timeouts). BR-211 v2 and BR-215 v2 (new version)
   make the record and acceptance reports carry maximum request and
   invocation durations; AC-21 and AC-23 require them.
3. Minor, AC-13 anchor-first chain — retained; AC-13 asserts the relative
   chain starts with the anchor and drops the members before it.
4. Minor, versioned citations — retained; normative text, AC headers and
   decisions cite `BR-NNN v2`; earlier Stress-test entries stay as written.
5. Minor, BR record sources — retained; Rationale cites F-014 v2 and the BR
   index counts the v2 rules.
6. Minor, AC-27 environment leak — retained; the case restores
   `NODE_TLS_REJECT_UNAUTHORIZED` in `finally` or runs in a child process,
   and the test resolver returns a public address while the test `connect`
   dials the loopback server.
7. Minor, `shared_with_me` size — retained; 100 is stated as a
   conservative unmeasured choice and the recorder prints that route's
   maximum duration.
8. Minor, recorder worst case — retained; the 9 and 6 metadata terms and
   the other terms are spelled out.

### v2 review round 2 — 2026-11-08

- major, BR-211 v2/BR-215 v2 summaries verified only by owner-run reports:
  retained. AC-21 adds a scripted recorder case (`TestBR211_*`) and AC-23 a
  summary-formatter case (`TestBR215_*`), each with planted ID, name, cursor
  and URL, mapping the 1,879 ms and 9,400 ms examples to tests.
- minor, AC-23 durations without a pass/fail rule: retained. Durations are
  reported only; any `REQUEST_TIMEOUT` in AC-23–AC-26 fails acceptance and
  opens the F-006 owner decision.
- minor, "navigation tool invocation" undefined: retained, defined in BR-215 v2.
- Edits made by the orchestrator (mechanical, within the reviewer's
  proposals), recorded as a deviation from author/orchestrator separation.

### Fable spec pass v2 — 2026-11-08

Fable 5.1 approved `7a35077` (runs/70-freeze-2.md). One minor, retained: the
`business-rules/README.md` allocated and active counts now include F-015
(233 allocated; 163 active, 7 superseded, 63 pending).

### v3 changes — 2026-11-09

Source: owner recording runs of 2026-11-09 on the designated fixtures. The
leak check listed 12 collisions, all on non-ID numbers: `status` (200/206),
the `limit` query value, two request `range` values, a `content-type` charset
`utf-8`, three `size` members and two `content-length` headers. Owner go for a
v3 given the same day.

- BR-213 → BR-213 v2: synthetic cursor/ETag forms without a whole decimal
  token; the real-ID search skips the closed exempt-field list, whose forms
  are constrained; the failure message format is fixed. D-21 added; AC-21
  extended. BR-214 → BR-214 v2 (stricter synthetic forms), AC-22 extended.

### v3 review round 1 — 2026-11-09

Opus 5.5 reviewed `3c2875b`: changes. All six findings retained.
- major, content-type regex let a parameter or subtype carry an ID: retained;
  `content-type` is no longer exempt, only its `charset=utf-8` is removed.
- major, locations could print unexpected keys: retained; member names print
  only from the Recorded-members list, header allowlist or recording schema,
  else `<member>`.
- minor, synthetic forms unnamed: retained; `cursor<k>`, `"etag<k>"` named.
- minor, route `template` collides with IDs 2/3: retained; exempt when exactly
  a route-table template.
- minor, digits of range/content-range and `size: null`: retained.
- minor, no wrong-form example: retained (`limit=200` in AC-21 and BR-213).

### v3 review round 2 — 2026-11-09

Opus 5.5 reviewed `80313a8`: changes; round-1 findings all fixed. All four
findings retained.
- major, a 416 `content-range` `bytes */<n>` would fail the form check:
  retained; that form is accepted and listed in AC-21.
- minor, query and param names printed as `<member>`: retained; route-table
  query names and path placeholders are printable.
- minor, no message for a form violation: retained; category `exempt field
  form` with location only, checked by AC-21.
- minor, BR-214 stricter without a version: retained; BR-214 v2 cites BR-213
  v2, AC-22 plants `cursor-1` and `"etag-1"`.

### Fable spec pass v3 — 2026-11-09

Fable 5.1 approved `098359c` (runs/70-freeze-3.md); round-2 fixes verified.
Three minors retained: AC-21 splits the real-ID and form-violation messages;
`query` is recorded as `[name, value]` pairs, so only path placeholders are
added to the printable names; the Recorded-members heading cites v2 BRs.

### v4 changes — 2026-11-09

Source: owner recording run `20261109073932` (48 requests, leak check
passed). Replayed through the contract suite, owner items and share roots
were `complete` and all three received descendants `incomplete`: their
`parents` members carry `id`, `drive_id`, `parent_id`, `type`, `status` and
`name` only, so no member matched BR-203 v2's `/Shared/<name>` path test.
Owner go for v4 given the same day.

- BR-203 v2 → BR-203 v3: anchor and relative chain derived from the item's
  own path; member paths never read. D-22 added; AC-13 updated; the
  hypothesis note under "Normalized shapes" now cites the recording.

### v4 review round 1 — 2026-11-09

Opus 5.5 approved `e19df81`; four minors, all retained: a root may carry a
linked chain whose members are all dropped (so D-22 holds for nested share
roots); the chain ordering cites BR-199 v2 explicitly; AC-13 adds the
`/Other/A/B` negative case, the same-name `team` → `team` case and the nested
root case; the BR-203 rationale cites the recording. Out of scope, noted: a
recipient-side mount name differing from the owner's name fails closed as
`incomplete`; AC-25 may surface it.

### Fable spec pass v4 — 2026-11-09

Fable 5.1 approved `2e15369` (runs/70-freeze-4.md); round-1 minors verified.
Two minors retained at freeze: chain members must be live directories on the
requested drive (`type`, `drive_id`, `status`), as F-004 requires; the
recipient-side mount-rename case is recorded in `BACKLOG.md`.


### v5 changes — 2026-11-09

Source: owner acceptance run on main `7b1769f` (AC-23 run B failed: a
children page of 5,010 ms, and the outside-scope denial check, which cannot
hold in run B) and the tail probe of runs/70-list-latency-2.md. Owner go for v5 the same day, recorded in runs/70-list-latency-2.md (archived evidence `runs/70-list-latency-2.md`).

- Page size 100 → 50: BR-201 v3, BR-202 v3 (routes and entry cap), BR-211 v3
  (21 and 6 pages; nonterminal cap 16 → 32 pages), BR-213 v3 (exempt `limit`
  form `50`), route table, AC-11, AC-21, AC-25 page counts, D-02 rewritten.
  The recording of run `20261109073932` (pages of 100) must be replaced by a
  new owner recording.
- AC-23: the outside-scope item is denied in run A and permitted in run B.
- Capacity at 50 entries per page (F-005, F-006, BR-207 unchanged; recorded
  here rather than versioning them, as in v2): one invocation's 512 calls
  cover at most 25,600 listed entries; a paged invocation's five list calls
  cover at most 250 entries, so received discovery returns `LIMIT_EXCEEDED`
  above 250 received roots; a BR-207 path walk's 1,024 requests cover at most
  51,200 entries, and at the measured 1.36–1.91 s per page the 120,000 ms
  bound binds first at about 63–88 pages (3,150–4,400 entries); five list
  calls take about 6.8–9.6 s, inside the 10,000 ms invocation deadline. The v2
  argument that rejected 50 ("twice the calls for no deadline need") is
  superseded by the measured peaks.
- First owner acceptance run on main `7b1769f`: runs/70-acceptance-1.md (archived evidence `runs/70-acceptance-1.md`).
- Request budgets at 50 per page: BR-211 worst case 5 folders × 32 pages + 34
  other requests = 194 ≤ 200 (realistic plan about 61); BR-215: run 1 used
  60 GET in 60,355 ms at 100 per page, pages of 50 add about 20 requests for
  the A and B traversals (42 pages instead of 22) and 3 for AC-25, and one
  21-page traversal measured 29–40 s (105 s at the deadline), within 400 GET
  and 900,000 ms.

### v5 review round 1 — 2026-11-09

Opus 5.5 reviewed `c8cb4f8`: changes, four minors, all retained: the BR-201
v2 History line restored; the BR index rows moved to the current versions;
the capacity impact of pages of 50 recorded under "v5 changes"; the failed
acceptance run recorded in runs/70-acceptance-1.md and linked.

### Fable spec pass v5 — 2026-11-09

Fable 5.1 approved `eba8ec2` (runs/70-freeze-5.md); round-1 minors verified.
Three minors applied at freeze: BR-211 and BR-215 budgets recomputed for
pages of 50, owner decision cited.

### v6 changes — 2026-11-09

Source: owner acceptance run 2 on main `0a17373` (runs/70-acceptance-2.md)
and two read-only owner-run probes after it: the revocable share was absent
from `shared_with_me`, its metadata returned 403, the received root stayed
readable, and the packaged CLI returned `READ_UNAVAILABLE` for the revoked
share twice. Owner go for v6 the same day.

- AC-25: the post-revocation read is refused with `ACCESS_DENIED` or
  `READ_UNAVAILABLE` and returns no metadata or content. D-23 added.
- Acceptance script: the AC-25 scoped child listing check requires at least
  six pages, as v5's AC-25 already states (the script still checked three).

### v6 review round 1 — 2026-11-09

Opus 5.5 reviewed `5c3f585`: changes. Retained: (major) `READ_UNAVAILABLE`
alone could be a transient failure, so AC-25 now also requires the share's
absence from discovery with the received root still listed and a repeated
refusal; (minor) D-23 wording narrowed accordingly; (minor) the script
changes ship in the implementation phase with these checks.

### Fable pass v6 — 2026-11-09

Fable 5.1 approved `223bd85` (spec and acceptance script; runs/70-freeze-6.md);
round-1 fixes verified. One minor kept as a note: the AC-25 discovery checks
read only the first `kdrive_shared_with_me` page, enough for the two-entry
fixture.

### v7 changes — 2026-11-09

Source: acceptance run 3 on main `e057d14` (runs/70-acceptance-3.md): the
AC-25 check counting tool pages failed (fewer than six) although run 2 had
counted at least three, so tool pages hold more than 50 entries. AC-25 now
counts upstream children requests (≥ 6) during the scoped listing. Owner go
for v7 the same day. Review: one Opus round on spec and script; no separate
Fable pass (acceptance-script counting only; recorded deviation).

### v7 review and freeze — 2026-11-09

Opus 5.5 approved `f7d938d` (spec and script). Applied after approval
(mechanical, strengthens the check; recorded deviation): the listing must
reach its terminal tool page. Noted residual risk: retried or policy-evidence
children hops can only raise the upstream count, which is a minimum. Frozen
autonomously; owner go given for v7.

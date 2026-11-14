# Access-policy security boundary

The unreleased F-003 policy is an abstract injected core, pending acceptance.
It does not register an MCP server or qualify a production kDrive adapter.
The current executable remains local configuration preparation only. Ticket #6
stays open for real adapter and tool/resource integration (AC-19/AC-20).

Configuration and dependency implementations are trusted composition components;
client arguments and dependency results are untrusted data. Only the exact
successful preflight configuration object is admitted. The core copies relevant
settings, validates runtime operations and evidence, and rejects caller-supplied
ancestry, paths, grants and effect lists. A malicious in-process dependency is
outside this trust model. Freshness of a real adapter needs separate qualification.

Use only the guarded facade for protected tool/resource work. Every invocation
copies and freezes its operation, acquires fresh evidence and authorizes all
derived effects before immediate execution. `check` confers no reusable grant.
No protected call occurs after a refusal. Public refusals contain only
`ACCESS_DENIED`; internal decisions contain a finite static code. Raw provider
errors, paths, IDs, cursors and credentials are never refusal diagnostics. An
execution failure propagates and must not be interpreted as proof that a write
did not occur. The core never retries.

With nonempty denies, relevant folder mutations require a complete descendant
proof; the Nth descendant refuses, even on a final page. Incomplete pages,
identity/path contradictions, duplicate descendants and cursor loops refuse.
Restore requires provable original-trash membership and original descendants,
with a separately authorized live destination. Current trash-container paths
cannot substitute. Folder sharing refuses symmetric literal-prefix conflicts,
including intentionally conservative `/a` versus `/ab/**` and empty prefixes.
Received-share/external operations remain denied in F-003's configured-tree
route. The distinct F-004 injected route requires explicit received-share
opt-in, a complete credential-bound root list, fresh same-drive anchor-relative
membership and actual normalized capabilities. Known IDs and owner-drive root
listing/search cannot confer authority. Denies apply to recipient-visible paths.
Common/team folders retain ordinary configured-tree behavior.

Only the complete received-share list is cached across reads, for strictly less
than 60 seconds measured from acquisition start. Target/ancestry/capability
evidence remains fresh; cache age is checked again before dispatch. Invalid
clock evidence or failed refresh invalidates the cache without stale fallback.
This permits a bounded read revocation lag. Each mutation/batch reloads the list
and affected evidence, requires both shared flags and at-least-write level, and
checks every frozen operation-specific capability. Directory mutations also
require explicit recursive authority; nonempty denies still require complete
descendant path proofs. Restore capabilities describe the current trashed source,
separately from historical original paths. Re-sharing always denies.

These are abstract synthetic guarantees. F-004 production adapter AC-14 and real
consumer AC-15 remain blocked and mandatory, alongside #6 AC-19/AC-20. Provider
ancestry, recipient paths, recursive capabilities and actual runtime wiring have
not been qualified; blanket refusal cannot satisfy the positive acceptance cases.

A fresh check precedes execution, but an upstream change can race with execution.
Traversal across pages likewise cannot establish a single concurrent snapshot.
Detectable inconsistencies refuse; undetectable concurrent changes remain
possible. Single-use immediate dispatch narrows this window and establishes no
atomic provider transaction guarantee. Production dependencies must implement
qualified bounded cancellation/timeouts; a never-resolving dependency cannot
yield authorization or protected dispatch. Synthetic tests establish neither
production freshness nor real restore support.

Credentials remain externally provisioned and outside repository artifacts.
No release, live provider probe, real mutation or cleanup is authorized by these
implementation records.

## Injected stdio navigation boundary

The injected SDK transport exposes nine read tools and one binary resource
template under F-007 (pending #10 acceptance), extending accepted F-006. Its additive policy
projection returns exactly the normalized item authorized in that invocation,
without using an arbitrary execute response. Listing also checks direct-parent
identity/path, and path resolution follows fresh guarded anchors and children.
No caller supplies proofs, an adapter, a shared-access flag or an authorization
grant. Only configured drives appear in the catalogue; explicit external reads
still require the existing F-004 opt-in proof route.

The runner permits one active invocation, 512 evidence calls and a 10-second
deadline. Each paged invocation shares a five-list-call proof/data budget and
refuses more than256 raw page entries. Cursors are single-use opaque session
handles with five-minute absolute expiry and bounded retained IDs/state; they
never cache authority. Complete F-004 received proof remains mandatory and
nonterminal path resolution remains unavailable. Nested recipients and links
are never projected, including in read/write modes.
Tool JSON is capped at 262,144 UTF-8 bytes and the configured UTF-16 character
limit. Input normalization is capped at 1 MiB and emits only fixed null-ID
parse/envelope errors; SDK validation/protocol errors are sanitized without
reflected input or error data. Each complete outbound frame is capped at 1 MiB,
with one pending write, no queue and a 1-second deadline. Overflow/backpressure
closes without adding a stdout error. Names/paths remain escaped JSON data and
the server never invokes prompts, sampling or elicitation.

Content reads use the same configured/received live read policy before each
attempt and immediately before publication. Raw continuation uses byte offsets
and a qualified strong ETag; the trusted normalized port must assert atomic
version binding, not merely equal opaque tags. Non206/identity/range/size/version
mismatches refuse before body consumption. Bounded16KiB reads verify exact length
and EOF, close on every outcome and never replay a partially consumed body.
The raw payload and complete resource blob include full base64/envelope costs
in both output bounds. Resources cannot silently truncate or render another
representation; original noncanonical URI bytes and unsupported extra parameters
refuse before policy/content work. No content cache or grant is retained.

Central retries use only a private runtime error brand for429/500–599 pre-body
failures, with at most three starts and100/200ms waits. Every start shares the
same invocation/list/deadline counters; body reads count too. Arbitrary thrown
objects are not inspected for status or message. Abstract policy dispatch and
execute do not acquire retries. Resource errors use fixed code-32000/messages
without error.data; credentials, headers, URLs, ETags and content never appear in
failure diagnostics. Authorized success deliberately contains requested content.
No production adapter/version/redirect qualification follows from synthetic
tests, and #6/#7's mandatory production ACs remain blocked.

Close aborts evidence, settles owned sends, removes owned listeners/timers and
destroys the output without waiting for drain. The dedicated default process
composition terminates after cleanup because Node process stdout can retain a
pending OS pipe write after stream destruction. Embedded callers provide
separate owned streams. These bounds do not prove cancellation of an underlying
real provider request: no production adapter is qualified. Received-list cache
age and multi-step resolution retain the existing revocation/concurrency limits.

## Mutation audit gate (F-016)

Every write and share tool runs through one gate (#17). Before any
upstream write the gate writes a durable `intent` record (JSONL: time, identity,
tool, operation kind, drive and item IDs; never names, paths, content, tokens,
URLs or provider text), and after it an `outcome` record. If the intent cannot be
written, nothing is sent. Only HTTP 429 is retried; a timeout, a lost response or
a 5xx returns `uncertain` and is never replayed. If the outcome cannot be written,
the client still gets the real result, marked `audit:"outcome_unrecorded"`, and
every later write is refused until restart.

- File sink: opened with `O_APPEND | O_NOFOLLOW`, created `0600`; an existing
  file must be owned by the server's user with no group or other permission bit.
  The server never changes its mode. Each record is followed by `fdatasync`; a
  write or sync failure, or a sync slower than 5 s, stops further writes.
- stderr sink (default): durability is that of the stderr collector; a file on a
  writable mount is recommended for a durable trail.
- After an HTTP 503 at shutdown or a dropped response after a cancellation, the
  audit outcome is the authority on whether a write happened.
- Received-share writes stay denied even with `KDRIVE_MCP_SHARED_WRITE=1`.

## Controlled tree mutations (F-017)

The five write tools (#18) — `kdrive_create_folder`, `kdrive_rename`,
`kdrive_move`, `kdrive_trash` and `kdrive_restore` — exist only in `write` and
`share` modes. Each runs through the policy and the audit gate above.

- No permanent deletion: this server never requests it. The route table holds
  no route that deletes permanently or empties the trash, and nothing issues a
  `DELETE` on a `/trash` path.
- Restore returns an item only to its former parent when that parent is live
  and authorized, and refuses otherwise. A folder restore is refused when deny
  patterns are configured, because the trashed tree cannot be enumerated.
- Received-share writes stay refused, even with `KDRIVE_MCP_SHARED_WRITE=1`.
- Configured roots cannot be trashed, renamed or moved.
- A mutation request uses its own TLS connection. A failure before the
  handshake completes is reported as not sent; any later failure is
  `uncertain` and is never replayed.
- A check-then-act window remains (SPEC §10.6). A former parent trashed
  between the check and a restore makes kDrive recreate a folder at the former
  path and restore into it; when that former parent is a configured root, the
  recreated folder has a new ID outside every configured root. An item trashed
  between the check and a trash request meets `DELETE /2/drive/{d}/files/{f}`
  in the trash; that effect is unmeasured.
- Residual risk R-17-1 (not observed on the measured server): restore
  authorizes the former parent's current path, so an item trashed under a denied
  folder that is renamed or moved out of the deny patterns outside this server
  could be restored if kDrive recomputed the trash `path`; owner acceptance on
  2026-11-10 (step 6) observed a deletion-time snapshot, so such a restore was
  denied.
- Residual risk R-17-2: the root protection covers only a configured root
  targeted directly. With nested roots, trashing, renaming or moving an
  authorized folder of an outer root that contains an inner configured root
  also affects that inner root, and with deny patterns the trashed folder
  cannot be restored through this server.

## Upload (F-018)

`kdrive_upload` exists only in `write` and `share` modes. It takes `text`
(sent as UTF-8) or canonical `base64`, at most 524,288 decoded bytes; over
HTTP the 262,144-byte MCP request body limit is lower. The call passes the
policy and the audit gate, and the resulting path `parent_id`/`name` is
checked against the deny patterns.

- `overwrite:false` (the default) asks kDrive to refuse an existing file of
  the same name (`conflict=error`). That refusal is observed kDrive behaviour
  (9 of 9 measured samples, checked when the upload completes), not a
  guarantee of this server. Names are case-sensitive.
- `overwrite:true` requires `file_id`, the existing file called `name` in
  `parent_id`; the policy checks that binding against live metadata, and the
  file's content is replaced in place under the same ID
  (`conflict=version`).
- An `uncertain` upload is never replayed; check the file with a read tool
  before any new attempt.
- Received-share uploads stay refused, even with `KDRIVE_MCP_SHARED_WRITE=1`.
- Names given to `kdrive_upload`, `kdrive_create_folder` and `kdrive_rename`
  must be in Unicode NFC (composed form); other forms are refused with
  `INVALID_ARGUMENTS`. An existing file whose name is not NFC must be renamed
  to its NFC name before it can be overwritten.
- Deny patterns match the exact stored code points. Write the NFC form of a
  non-ASCII pattern to cover names these tools create, and keep (or add) the
  stored form for any existing item whose name is not NFC; replacing a
  working NFD pattern by its NFC form alone would drop the deny for those
  items, reads included.
- The 524,288-byte bound applies to the decoded bytes, while the transport
  limit (1 MiB stdio frame, 262,144-byte HTTP body) applies to the
  JSON-encoded request. `text` that JSON escaping enlarges (quotes,
  backslashes, control characters, or non-ASCII escaped as `\uXXXX` by the
  client) can be refused by the transport below 524,288 bytes: over HTTP the
  request gets HTTP 413; over stdio a frame above 1 MiB terminates the server
  with `STDIO_INPUT_FAILED` and no MCP error. An upload already in flight
  completes and its outcome is recorded in the audit log before exit, but its
  tool result is not delivered. Use `base64` for large or non-ASCII content.
- Residual risk R-18-1: the `conflict=error` refusal is not proven under every
  interleaving; a concurrent writer could still win a race this server cannot
  see.
- Residual risk R-18-2 (check-then-act, SPEC §10.6): between the check and a
  replace, the target can be renamed or moved and another file can take its
  name; kDrive then writes that file at the same authorized path and the
  result is `uncertain`. A destination renamed into a deny pattern between
  check and upload is not detected; a destination moved or trashed out of the
  configured roots between check and write is still reported `succeeded`.
- Residual risk R-18-3 (accepted): kDrive stores a file named like an
  existing folder under another name in the same folder (observed); that
  name is not checked against the deny patterns. The result is `uncertain`
  and nothing is replayed.
- Residual risk R-18-4: kDrive keeps or discards the replaced content
  according to its own version history, which this server neither reads nor
  guarantees.
- Residual risk R-18-5: kDrive stored a decomposed (NFD) name under a
  different name. Names must now be in NFC (see above), and the owner
  acceptance showed NFC names, including a compatibility ligature, stored
  unchanged. Other name rewriting, not tested, would still store a file at a
  path this server did not check: reported `uncertain` for upload and folder
  creation, but `succeeded` for rename, which reads no name back.

## Client ID Metadata Documents (F-028)

Accepted on main `aa540d4` (2026-11-14). In OAuth `proxy` mode, a client ID
that is an `https` URL makes the server fetch that URL: an unauthenticated request can trigger it, so
it is a server-side request forgery (SSRF) primitive. The limits are:

- CIMD is off by default: `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` is empty, and only
  client IDs under listed origins are ever fetched. The operator lists only
  origins whose vendor controls every path.
- One HTTPS `GET`, no credential sent, no redirect followed, status 200 only,
  at most 5,120 bytes, 5,000 ms in all, at most four concurrent fetches, no
  failure cache (repeats stay bounded by the authorize rate limit).
- One c-ares resolution outside the libuv threadpool; every resolved address
  must pass the address policy (no private, loopback, link-local, shared,
  multicast, reserved or documentation IPv4 range; IPv6 only in `2000::/3`,
  without embedded-IPv4 forms), and the connection is pinned to the checked
  addresses, so DNS rebinding cannot reach another host.
- A dedicated agent ignores proxy variables and always verifies the
  certificate (`NODE_EXTRA_CA_CERTS` extends the trusted CAs).
- Document redirect URIs stay within `OAUTH_ALLOWED_REDIRECT_URIS`, so CIMD
  never widens where authorization codes can go; URLs inside a document are
  never fetched. Logs and error pages never contain a CIMD URL, host, address
  or TLS message.

The accepted residual risks are listed in
[the OAuth proxy notes](docs/oauth-proxy.md#accepted-residual-risks).

## Dependency audit

CI fails on any high or critical `npm audit` finding: the `audit` job runs
`make audit` (`npm audit --audit-level=high`) and `ci-result` needs it
(F-020, #104). A new high or critical finding is fixed before a release, not
allowlisted; there is no advisory ignore list. Moderate and low findings do not
fail the job and are triaged as tickets.

An install of the packed tarball or of the published package (`npm install -g`)
resolves no `zod` below 4.6.6 from the first release that includes #12
(F-027): the image route uses the dependency-free codecs `pngjs` and `jpeg-js`
directly (see
[ADR-010](architecture-decisions/ADR-010-direct-image-codecs.md)), and the CI
`audit` job checks such an install of the packed tarball with
`make install-check`. Earlier published versions (`0.6.0-beta.1` and older)
still resolve Jimp's nested Zod 3 (`zod` 3.25.76,
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)) on
such an install, so their users upgrade to the first release that includes #12
or use the container image, whose `npm ci` install is not affected.

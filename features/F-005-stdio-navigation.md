---
id: F-005
title: Guarded injected stdio navigation
ticket: "#8"
status: done
version: 2
---

## Context

Injected-scope acceptance completed on actual main
`209a68de956b328e04e2d98d6745128a587184bd`,2026-11-02; see
the acceptance evidence (archived evidence `runs/8-acceptance-1.md`). This marker synchronization
changes no frozen v1 contract. F-006 later versions BR-060/065 for #9.

Autonomous freeze by the orchestrator on 2026-11-02 at 22:01:12 UTC, exact
reviewed SHA `afc53e42ead78d140a8a41d8d5c94d6c65dccbc5`, after fresh independent
round 3 approval (archived evidence `runs/8-spec-review-3.md`). The ticket is ready, no question
remains and the user was notified of this SHA and the decisions. See the
freeze record (archived evidence `runs/8-freeze-1.md`). Only the injected F-005 scope is authorized.

#8 (archive issue 8) needs a real MCP
stdio session through which a client can navigate authorized synthetic drives.
The accepted foundation currently validates configuration but starts no runtime.
The abstract F-003 v2/F-004 v1 policy exists at actual main
`ee257a381ee9f4934760932c3b136e4234455923`. Their staged handoffs permit this
separately authorized ticket; #6 AC-19/20 and #7 AC-14/15 remain mandatory and
blocked. A real SDK transport with injected synthetic evidence qualifies runtime
behavior, never real kDrive provider semantics or working production CLI access.

## Scope

- A reusable actual MCP server factory and stdio runner taking the exact F-002
  preflight configuration and trusted injected F-003/F-004 dependencies.
- Four navigation tools, safe metadata projection, guarded path resolution,
  cumulative registration, bounded lifecycle and protocol integration tests.
- Truthful packaged CLI/help/docs about the injected runtime and unavailable
  production adapter; preserve all configuration and diagnostic contracts.
- Carry the preserved #7 acceptance3 and PR43 review3 reports into this reviewed
  PR as dependency evidence, without changing their contents or acceptance state.

### Out of scope

Production adapters, credential access/provisioning, provider/private fixture
access, network probes, real writes, HTTP, resources, prompts, search/recents/
share-list tools, mutation tools, retries and publication. #9 owns list cursors,
continuation, five-call paging and D-04. This feature does not complete #6/#7,
claim a working production server, bump VERSION or authorize a release.

## Business rules

BR-059–BR-071 are newly allocated version 1, pending acceptance. Canonical
records and named unit tests accompany implementation after reviewed freeze.

- **BR-059** — Runtime construction requires the exact successful preflight
  object, of transport `stdio` or `http`, and explicit trusted dependencies and
  performs no provider or process I/O until started; the stdio runner refuses a
  configuration whose transport is not `stdio` before it uses a stream or a
  dependency. Verified by: AC-01. (v2, F-012: HTTP preflight objects accepted;
  v1 snapshot in [history](history/F-005-v1.md).)
- **BR-060** — In each of read/write/share modes the MCP tool list contains
  exactly the four F-005 read tools, each with the declared read annotations,
  and registers no prompt, resource or mutation tool. Verified by: AC-02.
- **BR-061** — Item navigation uses the configured default drive when its drive
  argument is omitted, catalogue omission enumerates configured drives, and an
  explicit drive never changes or falls back to the default. Verified by: AC-03.
- **BR-062** — Drive enumeration exposes only configured drives and their
  currently authorized root descriptors. Verified by: AC-04.
- **BR-063** — Metadata output is a fixed scalar projection of the exact
  normalized live item authorized by the policy invocation. Verified by: AC-05.
- **BR-064** — Listing returns only authorized direct children of the exact
  authorized directory scope, optionally filtered by file/directory type.
  Verified by: AC-06.
- **BR-065** — F-005 returns a successful listing only from one bounded terminal
  collection page, and returns no partial entries or upstream cursor otherwise.
  Verified by: AC-07.
- **BR-066** — Path resolution uses only authorized anchors and successive
  guarded direct-child listings and returns an item only for an exact canonical
  path match. Verified by: AC-08.
- **BR-067** — Explicit external-drive reads and scoped listings use the
  existing opt-in received-share proof route and never external-root enumeration.
  Verified by: AC-09.
- **BR-068** — Session instructions and every tool description identify the
  server as unofficial and returned names/paths as untrusted data, never commands
  or authorization. Verified by: AC-10.
- **BR-069** — The stdio runtime writes only MCP protocol messages with sanitized
  tool/protocol error text to stdout and emits only fixed sanitized diagnostics
  to stderr. Verified by: AC-11.
- **BR-070** — Every active tool invocation obeys the stated request/output
  bounds and stops publishing results or starting dependency calls after
  cancellation, deadline or session close. Verified by: AC-12.
- **BR-071** — The packaged CLI retains the exact accepted F-002/BR-016 local
  preparation diagnostics, status and streams without starting a synthetic
  session or production runtime.
  Verified by: AC-13.

## Contract details

### Composition and policy projection

Export an internal typed server factory and stdio runner from compiled modules;
no new package bin, environment switch, dynamic adapter path or synthetic CLI mode
is introduced. Construction accepts the branded `ResolvedConfiguration` and
`PolicyDependencies`, with stream/diagnostic injection for tests. The factory
accepts stdio and HTTP preflight objects; the stdio runner rejects HTTP
configuration. The runner owns one server/transport per session, and
provides an idempotent asynchronous close operation. The existing pinned
`@modelcontextprotocol/server` 2.4.0 and its `/stdio` transport are used directly.
No MCP client SDK dependency is necessary: the integration fixture is a small
bounded JSON-RPC client performing the real initialize, initialized, tools/list
and tools/call exchange with a child process running the production factory and
stdio runner. Synthetic dependency composition exists only in test helpers.

Add an immediate, result-returning navigation projection to the existing policy
facade for `read` and `list`. It reuses the existing private operation evaluation,
normalized inspected item and final synchronous received-cache age check.
It returns no grant, callback or reusable proof. For metadata it exposes the
authorized inspection rather than arbitrary `dependencies.execute` payloads.
For list it projects the authorized scope and validated entries from that same
invocation and enforces immediate-parent identity and canonical child path.
For configured root ID 1, the existing normalized empty-parent representation
of a direct child is accepted as that implicit root; no other parent identity
is inferred from a path.
Existing `check`/`dispatch`, operation registry, configured-tree behavior,
received proofs, cache limits and all frozen F-003/F-004 tests remain unchanged.
The projection is an additive F-005 consumer boundary, not a new policy route.

Projection emits exactly `{drive_id, id, name, type, path}`; positive safe integer
IDs, `type` in `file|dir`, canonical path and matching final name come from the
normalized item. The configured drive root has `name:""`, `path:"/"`, `id:1`.
No raw metadata, parent array, capabilities, recipients, links, token, content,
custom property, provider error or cursor is serialized. Data properties are
copied into fresh plain output; getters and `toJSON` from dependency objects are
never called to construct an MCP response. Unauthorized evidence never becomes
MCP content. Independent later path-resolution steps remain fresh guarded
invocations; this provides no atomic filesystem snapshot or cached grant.

### Tool schemas and responses

All tool argument objects reject unknown fields. IDs are numeric positive safe
integers, with no coercion. Optional `drive_id` defaults only when absent.
Explicit null/string/fractional/zero/negative/unsafe values are invalid arguments.
Each successful tool response contains one text block with JSON encoding of
the following payload, and no separate raw metadata representation:

| Tool                  | Arguments besides optional `drive_id`                             | Success payload                           |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| `kdrive_list_drives`  | None                                                              | `{drives:[{drive_id,name,roots:[item]}]}` |
| `kdrive_info`         | Required `file_id`                                                | `{item}`                                  |
| `kdrive_list`         | Required `folder_id`; optional `type`, either `"file"` or `"dir"` | `{items:[item],has_more:false}`           |
| `kdrive_resolve_path` | Required `path`                                                   | `{item}`                                  |

Here `item` is the fixed five-field projection above. An empty terminal list
succeeds with `items:[]`. Filtering preserves dependency order and applies only
after policy/direct-child checks. Within one page identical validated identities
are deduplicated by the existing policy; contradictory identities/evidence
refuse. The transport advertises no `next_cursor` and accepts no `cursor` yet.

Without `drive_id`, drive enumeration visits all configured drives in configuration
order; this is the sole enumeration exception to default-drive selection.
With `drive_id`, it visits only that configured drive; an external/unknown drive
gets the generic refusal. For each drive it reads each resolved root through
the guarded projection, omitting denied roots, and omits drives with no visible
root. Authorized roots retain configuration order. The name is the explicit
local display label `Drive <drive_id>`; F-002 retains no provider drive name and
this feature does not invent one or call an unguarded catalogue port. Denied
root IDs/paths are absent. This is a configured catalogue, not share discovery.

For `info` and `list`, the tool makes a guarded exact-ID request; it cannot
request a raw adapter, path proof, policy mode or shared flag. Listing a file
refuses. The navigation projection refuses a nonterminal collection page or more
than 256 raw entries; it never follows `next` in F-005. This check occurs before
publication. `PAGINATION_UNAVAILABLE` explains a valid nonterminal page, without
its entries/cursor; pagination is deliberately unavailable until #9, even if
type/deny filtering would empty the first page. No provider completeness
guarantee is inferred from a successful HTTP response.

Path uses F-003's canonical absolute grammar, case-sensitive matching and
4,096-byte ceiling. `/` is valid; repeated/trailing separators, relative paths,
dot/dot-dot segments, backslashes, controls and paths exceeding 64 components
refuse. There is no percent decoding, Unicode normalization or case folding.
For configured drives, read the configured root anchors through the facade,
choose the longest canonical ancestor path, and resolve each remaining segment
by a guarded terminal direct-child list. Intermediate matches must be directories;
the final match may be a file or directory. Multiple different identities for
the matching name, missing segments, nonterminal pages, mismatched final path
or no permitted anchor refuse without partial path disclosure. An exact anchor
path resolves directly. Root `/` resolves only when it is an authorized anchor.

For an explicit external drive with opt-in enabled, obtain anchor candidates
only through the facade's existing guarded `shared-with-me` discovery; consider
only authorized anchors on that exact drive and apply the same longest-path
and guarded traversal rules. File anchors resolve only their own exact path.
No external root ID 1, guessed owner path or fallback configured drive is used.
Known external IDs for info/list still need fresh F-004 membership/capabilities;
opt-out performs no received dependency call. No new share-list tool is exposed.

All four annotations are explicit: `readOnlyHint:true`,
`destructiveHint:false`, `idempotentHint:true`, `openWorldHint:true`.
Read level is cumulative; higher levels expose the same four tools because
future write/share tools have not been implemented. No prompts are registered
or advertised. No content resource is registered or advertised before #10.

### Errors, bounds and lifecycle

Policy denial, missing item/path, contradictory/malformed evidence and unknown
drive return `isError:true` with one fixed text `ACCESS_DENIED`, without
distinguishing existence. Valid nonterminal list/path traversal returns fixed
`PAGINATION_UNAVAILABLE`. Bound failures return fixed `LIMIT_EXCEEDED`;
deadline returns fixed `REQUEST_TIMEOUT`; a concurrent second tool call returns
fixed `SERVER_BUSY`. Schema-invalid arguments to a registered tool use the
pinned SDK's native tool-error envelope: `isError:true` and exactly one text
block whose application-sanitized text is `INVALID_ARGUMENTS`, with no JSON-RPC
`error`. Malformed JSON-RPC requests and unknown methods/tools instead use
JSON-RPC protocol errors. Unknown tool names retain SDK code `-32602` with fixed
message `Invalid params`; unknown methods retain `-32601` with fixed message
`Method not found`. The explicit pre-SDK complete-line boundary below generates
parse/invalid-envelope errors as `-32700`/`-32600`, with fixed messages
`Parse error`/`Invalid request` and `id:null`. Other protocol failures use their
SDK numeric code with fixed message `Protocol error`. No protocol `error.data`
or SDK validation detail is emitted. The application sanitizes SDK-generated
error envelopes before serialization; SDK defaults alone do not supply redaction
or produce the required malformed-input responses.
It preserves protocol request IDs for correlation but never reflects a canary
from argument values, unknown fields, tool names or method names in error text.
Static messages never interpolate user or dependency data. Unexpected application
errors become the generic refusal plus a fixed stderr diagnostic, with no
stack/object inspection, response echo, raw input or dependency message.

The session permits one active tool invocation, with no waiting queue. Each
invocation has a 10,000 ms wall-clock deadline and at most 512 dependency calls
across all inspection/list/discovery work. Each raw collection/discovery page
has at most 256 entries before policy processing. Existing smaller F-003/F-004
budgets remain cumulative. The runner wraps every asynchronous injected
dependency, races cancellation/deadline and checks liveness before another call
and immediately before output; a never-settling dependency cannot retain the
active slot beyond the deadline or publish late data. These are injected read
ports; no provider cancellation capability is claimed. Client cancellation
aborts the invocation without a late tool result, consistent with SDK transport
semantics. Timeout sends its fixed result while the session is live.

The runner owns one minimal bounded complete-line input normalization boundary
before the pinned stdio parser. Its buffered, not-yet-forwarded bytes, including
the current partial frame, are capped at 1,048,576; an over-cap buffer closes
with fixed stderr `STDIO_INPUT_FAILED\n`, nonzero status and no stdout error. Each LF
completes one UTF-8 JSON frame; CRLF is accepted, and an empty line is malformed
JSON. Invalid UTF-8 or JSON syntax produces exactly
`{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}`.
A parsed JSON value that is not a valid generic JSON-RPC message envelope under
the pinned SDK's envelope schema produces exactly
`{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid request"}}`.
Both frames include the normal terminating newline and travel through the same
owned outbound admission/byte/deadline path as SDK messages. No raw frame,
field, validation detail or supplied ID is copied into these pre-dispatch errors.
They perform zero protected dependency work. Do not infer them from SDK error
callbacks: the pinned parser can drop syntax failures without a callback.

After a handled bad frame's fixed response is sent, continue processing further
frames while all existing bounds hold. Valid generic protocol frames are
forwarded to the SDK without changing their validated correlation IDs or
implementing method/argument dispatch in this boundary. Unknown methods/tools
and registered-tool schema validation remain SDK-owned. No general parser or
transport framework, alternate MCP implementation or SDK upgrade is introduced.
An oversized ingress buffer, an outbound failure/backpressure limit or session
close instead terminates processing; no further input error is enqueued. EOF
with an unfinished frame follows the existing close path without a late error.
Close clears the owned input buffer and its listeners along with the SDK side.

The SDK stdio transport read buffer is also capped at 1,048,576 bytes. Serialized tool
JSON text must fit both 262,144 UTF-8 bytes and `maxOutputChars` UTF-16 code units;
overflows return only the fixed bound error, never truncated JSON or partial
entries. Fixed protocol/tool descriptions and result-envelope overhead are
outside this payload limit. There is no persistent queue, content cache or
dependency-result cache added by F-005. The F-004 list-only cache remains private.

The runner owns a minimal outbound transport boundary, in addition to the
bounded input normalization and SDK stdio parser/lifecycle. Every SDK-originated
send and explicitly defined pre-dispatch input-error response passes through this
boundary for error sanitization and finite writes; it does not rely on the
pinned transport's unbounded concurrent `send`/`drain` behavior. No SDK upgrade
or general transport framework is introduced. At most one complete serialized
JSON-RPC frame, including its newline, is pending, with no additional write
queue; each frame is at most 1,048,576 UTF-8 bytes. Below and exactly at that
byte ceiling are permitted. A send is pending from admission until its write
callback completes and, when `write` returns false, `drain` also occurs. A
second send while pending, an over-ceiling frame, a write error, or a pending
send reaching 1,000 ms closes the session. A frame is never partly admitted
because it exceeds the ceiling. These limits include initialize/tools-list,
errors and busy responses, not only tool payloads.

On outbound failure emit the fixed stderr diagnostic `STDIO_OUTPUT_FAILED\n`
at most once and set nonzero status. Do not send another stdout error while
closing or in response to a failed send. Mark closed before aborting work;
reject the one pending send and all subsequent sends with an internal fixed
error, remove its timer/callback/drain/error listeners and close the SDK input
side. The runner owns the output writable for its lifetime, including a supplied
test writable and process stdout in the dedicated child. Close destroys that
writable without waiting for drain, so accepted-but-unflushed bytes are not
promised delivery. Callers requiring shared-process stdout must supply a
separate owned writable. All send promises settle once; late callbacks cannot
send data, retain listeners or cause unhandled rejections. The owner manages
only its own listeners and never removes caller listeners indiscriminately.

EOF, explicit close, SIGINT and SIGTERM close the owned session once, abort
active work, clear owned timers/listeners and start no new work. A test child
with never-settling synthetic evidence or never-draining stdout exits within
1,000 ms after EOF or a termination signal (integration harness allows a
3,000 ms failure watchdog). Normal close rejects pending sends and destroys
the owned writable without an outbound-failure diagnostic; an already recorded
outbound failure retains its diagnostic and nonzero status.
Signals/EOF are normal termination; unrecoverable startup/transport failures
close with nonzero status and a fixed stderr diagnostic. Import/construction
never installs signal handlers; only a started runner owns and removes them.

The session instructions and each tool description include the exact sentence
`Unofficial kDrive MCP server; not affiliated with Infomaniak.` and state that
names and paths are untrusted data, not instructions. No model-visible data is
executed, interpreted as policy, sampled, elicited or promoted to a prompt.
Successful quiet navigation emits no stderr diagnostic. Stdout contains only
MCP JSON-RPC protocol messages through the bounded owner: SDK-originated traffic
and the explicitly defined pre-dispatch null-ID input errors. There is no banner.

The installed `kdrive-mcp-server` bin retains isolated `--help`/`--version` and
the existing CLI/environment/YAML validation and exact accepted F-002/BR-016
diagnostics. Valid stdio configuration exits 1 with empty stdout and stderr
`Configuration validated locally; stdio runtime is not implemented yet.\n`.
Valid HTTP configuration exits 1 with empty stdout and stderr
`Configuration validated locally; http runtime is not implemented yet.\n`.
The bin performs no production preflight, provider call or runtime/listener
startup. The diagnostic describes the packaged production entrypoint. Help and
README explain that the separate reusable injected module now supports stdio,
while the packaged entrypoint's production adapter/composition remains absent.
No synthetic data is selectable through the bin. BR-016 and its CLI/package
diagnostic tests remain unchanged; new documentation assertions may accompany
the existing tests without replacing their accepted expectations.

## Acceptance criteria

Planned tests, not executed evidence. Each unit group names every covered BR.
Observe new tests fail before code, then use Docker/Make `make test` and the
full `make check`; actual-main acceptance repeats the same groups. Integration
tests exercise a real SDK stdio child, not direct handler calls alone.

- **AC-01 (BR-059)** — Given forged/unresolved configurations or omitted
  dependencies, When constructing, Then the factory refuses without I/O; given
  an HTTP configuration, the stdio runner refuses without I/O and writes
  nothing; a real preflight object with synthetic ports constructs without I/O
  and starts one real session. Verified by `navigation-construction` unit/integration groups.
- **AC-02 (BR-060)** — Given each cumulative mode, When a real MCP client lists
  tools and inspects capabilities, Then exactly the four named tools and all
  four annotation values appear; mutation/share/search tools, prompts and
  resources are absent. Calls to absent names do not touch dependencies.
  Verified by `navigation-registration` unit and stdio groups.
- **AC-03 (BR-061)** — Given two configured drives with colliding item IDs and
  an explicit disallowed drive, When omitting/selecting/malforming drive IDs,
  Then default and explicit selection stay isolated; disallowed/malformed IDs
  never fall back or reach ordinary protected ports. Verified by
  `navigation-drive-selection` unit and stdio groups.
- **AC-04 (BR-062)** — Given configured/denied roots and an enabled received
  share, When listing all/one/unknown/external drives, Then only authorized
  configured root descriptors and the documented local labels appear in order,
  and absent roots/drives disclose no IDs/paths. Verified by `navigation-drives`.
- **AC-05 (BR-063)** — Given authorized/denied metadata and hostile extra fields,
  getters, `toJSON`, wrong-ID execute payloads and provider errors, When reading,
  Then only exact authorized normalized five-field items are returned and
  execute payloads/callbacks/errors never enter responses. Existing dispatch
  regressions remain unchanged. Verified by `navigation-metadata` plus the
  F-003/F-004 suites and a stdio canary test.
- **AC-06 (BR-064)** — Given mixed allowed/denied/file/directory entries and
  an unrelated item within another allowed root, When listing with each type
  filter, Then only permitted immediate children appear in order and a file
  scope refuses. Verified by `navigation-list` unit and stdio groups.
- **AC-07 (BR-065)** — Given empty terminal, filtered-empty terminal,
  nonterminal and 256/257-entry pages, When listing, Then terminal bounded
  results alone succeed; nonterminal returns no entries/cursor and never
  implies exhaustion; oversized pages refuse. Verified by
  `navigation-terminal-list`, including nonterminal filtered-empty pages.
- **AC-08 (BR-066)** — Given nested/overlapping roots, exact-root/file/deep paths,
  malformed/overlong/65-component paths, duplicate names and incomplete pages,
  When resolving, Then only exact authorized paths resolve through guarded
  anchors/segments, with no root-wide fallback or partial result. Verify the
  4,096-byte/64-component accepted boundaries separately. Verified by
  `navigation-resolve` unit and stdio groups.
- **AC-09 (BR-067)** — Given opt-out and opt-in synthetic shared root/child
  proofs, When actual tools read/list/resolve explicit external identities,
  Then proved positive cases succeed and opt-out, unrelated known IDs, denied
  recipient paths, revoked/expired membership and external-root requests refuse.
  No configured-drive catalogue includes the external owner. Verified by
  `navigation-received` unit and stdio groups; no production AC is credited.
- **AC-10 (BR-068)** — Given malicious names/paths, When initializing/listing
  tools/navigating, Then all required unofficial/untrusted notices appear in
  instructions/descriptions and names remain only escaped JSON data. No prompt,
  sampling or elicitation is initiated. Verified by `navigation-notices`.
- **AC-11 (BR-069)** — Given real startup/navigation and failing evidence/parse
  cases plus schema-invalid registered-tool arguments, unknown tool and unknown
  method, When capturing child streams with numeric correlation IDs and canaries
  in unknown argument keys, null/string/unsafe IDs, tool names and method names,
  Then registered-tool schema errors are fixed `INVALID_ARGUMENTS` tool results,
  unknown tool/method errors are fixed `-32602`/`-32601` protocol errors as above,
  every rejected request makes zero protected dependency calls, and no canary,
  SDK validation detail, error data, raw dependency error or stack appears on
  either stream. Every emitted stdout line is MCP JSON-RPC and quiet success
  has empty stderr. Actual malformed JSON lines, including a canary-bearing
  syntax failure, yield exactly the null-ID `-32700` frame above; a parsed
  invalid-envelope line carrying a supplied ID/canary yields exactly the
  null-ID `-32600` frame above. Both perform zero protected work, expose no
  canary on either stream and permit a subsequent valid initialize/navigation
  exchange when all bounds hold. Verified by actual `navigation-stdio-output`
  client tests; test the actual malformed/invalid lines, not SDK error callbacks.
- **AC-12 (BR-070)** — Given concurrent calls, 512/513 dependency calls,
  1 MiB ingress boundary, output-byte/character boundary, delayed/never-settling
  evidence, cancellation, EOF and both signals, plus outbound frames below/at/
  above 1,048,576 bytes, one pending send versus a second, and writes completing
  before/at/after the 1,000 ms deadline, When exercising the runner,
  Then limits/refusals and close latency match this contract, timers/listeners
  are removed, no late result/new dependency call occurs, and close is
  idempotent. An injected never-draining writable retains at most one frame,
  settles every pending send once on close, removes owned listeners/timers and
  emits at most the fixed outbound diagnostic, with no stdout error loop. A
  real client that stops reading stdout before EOF/SIGINT/SIGTERM still observes
  the stated exit bound. Verified by `navigation-bounds` fake-clock unit groups
  and bounded real child lifecycle tests, including positive below-bound and
  exactly-at-byte-limit controls; completion at the deadline times out.
- **AC-13 (BR-071)** — Given packed executable help/version and valid stdio/HTTP
  configuration, When invoking the actual bin, Then diagnostics/exit/streams
  match the exact accepted F-002/BR-016 behavior, production preflight never
  starts and no synthetic/runtime backdoor exists. Verified by unchanged
  `cli.test.ts`/`package.test.ts` diagnostic expectations and no-network/file-read
  guards, plus assertions for the clarified help/documentation distinction.

## Decisions

1. Deliver real injected MCP/stdio integration and keep the packaged production
   adapter unavailable. Reject a fake consumer as sole runtime evidence and
   reject inventing kDrive mappings or releasing a synthetic production mode.
2. Add a narrow guarded projection beside unchanged `check`/`dispatch`. Reject
   serializing arbitrary execute results or checking an ID then independently
   fetching unchecked metadata. Return only navigation fields already proved.
3. Resolve paths from guarded configured/shared anchors, then guarded direct
   children. Reject a raw resolver bypass, owner-root enumeration and fabricated
   shared paths. Each step is fresh; atomic multi-step resolution is not promised.
4. Restrict this staged list to bounded terminal pages. Reject false `has_more`
   claims, silent truncation and inventing #9's unresolved cursor protocol.
5. Use fixed finite request limits and one active invocation. Reject an unbounded
   queue, arbitrary exception serialization and ad-hoc replay machinery. The
   minimal transport owner permits one bounded pending frame and destroys its
   owned writable on close; SDK send backpressure alone is insufficient.
6. Use explicit local drive display labels because preflight retains no provider
   names. No ADR is allocated: the injectable navigation boundary extends the
   existing design and these bounded initial schemas can be versioned in #9.

## Open questions

None. Fresh independent round 3 approval and the orchestrator's readiness check
precede the recorded autonomous freeze. Production adapter semantics remain blocked verification,
not assumed answers; #6/#7 obligations remain unchanged.

## Stress-test

Fresh review round 1 (archived evidence `runs/8-spec-review-1.md`) returned `changes` against
`d63aabcfbcebe0d88858e400746f2d79a162bd7c`. All findings are retained:

- **R1, major — retained.** Keep exact accepted stdio/HTTP diagnostics, exit 1,
  empty stdout and no production preflight. Clarify the injected-module versus
  packaged-entrypoint distinction in help/README only. BR-016/F-002 and existing
  CLI/package diagnostic tests remain unchanged; no rule version bump needed.
- **R2, major — retained.** Add the minimal one-pending-frame/no-queue outbound
  owner, 1 MiB serialized-frame ceiling and 1,000 ms send deadline; close on
  overflow/failure without another stdout error. Settle sends/listeners/timers
  and destroy the owned writable even when it never drains. Extend AC-12 with
  boundary, callback/drain and real stopped-reader shutdown coverage.
- **R3, major — retained.** Specify SDK-native registered-argument tool errors
  versus unknown-tool/method protocol errors. Sanitize messages/error data at
  the application outbound boundary; assert exact envelopes/codes/text, zero
  protected dependency calls and reflected-canary absence through actual stdio.
- **R4, minor — retained.** Replace the table's unescaped inline-code union
  with `type`, either `"file"` or `"dir"`; verify three rendered columns and the
  list success payload in the third cell.

At author round 2 the revised draft remained unfrozen pending fresh independent
review. That draft granted no implementation permission, acceptance or release. Correction evidence:
author round 2 (archived evidence `runs/8-spec-author-2.md`).

Fresh review round 2 (archived evidence `runs/8-spec-review-2.md`) returned `changes` against
`4afd9b27e905cd955d8f95f2ef284d894e5484f6`.

- **Round 2 R1, major — retained.** Explicitly own bounded complete-line
  normalization before the SDK. Generate only fixed null-ID parse/invalid-envelope
  protocol errors through the same bounded outbound path, forward valid generic
  messages to SDK dispatch, and continue after handled bad frames while all
  limits hold. Oversized input, output failure or close terminates. Protocol-only
  stdout explicitly includes these application-generated errors; AC-11 sends
  malformed and invalid-envelope lines and verifies exact wire frames, no echo,
  zero protected work and subsequent valid traffic. Prior CLI, policy and finite
  lifecycle contracts remain unchanged; no SDK migration/framework is introduced.

Correction evidence: author round 3 (archived evidence `runs/8-spec-author-3.md`). Fresh
round 3 approval (archived evidence `runs/8-spec-review-3.md`) of the exact SHA recorded above
preceded autonomous freeze; all five findings are resolved. Acceptance and
production qualification remain separate.

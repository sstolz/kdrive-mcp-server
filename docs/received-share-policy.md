# Abstract received-share integration boundary

[F-004 v1](../features/F-004-received-share-policy.md) is frozen jointly with
[F-003 v2](../features/F-003-tree-access-policy.md). This page documents the
injected implementation, not a qualified provider adapter or public MCP schema.
F-004 AC-14/AC-15 and #6 AC-19/AC-20 remain blocked and mandatory.

`createPolicy` admits only the exact successful preflight configuration. Its
optional credential-bound `received` dependency supplies `list`, `inspect`,
`children`, `collection` and an optional trusted monotonic `now` clock.
Consumers retain only `check`/`dispatch`; no raw dependency or reusable
authorization grant is returned.

| Port                     | Normalized evidence contract                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list(request)`          | Echo invocation/listing identities and requested cursor. Each page has status=complete, discover=true, a dense entries array, and exactly one of terminal=true or a bounded next cursor. All pages complete before use.                                              |
| Received-list root       | Exact owner drive/item IDs, role=external, anchorId equal to item ID, live lifecycle/location, file/dir type, canonical recipient path below /Shared/, matching name, empty parents and explicit capabilities record. Root ID1 cannot be an anchor.                  |
| `inspect(ref, location)` | Exact requested identity and live or original-trash state; explicit anchorId, canonical recipient path/name, complete anchor-relative parents, and current operation capabilities. Fresh live anchor inspection agrees with the list's identity/type/path/role.      |
| `children(request)`      | F-003's exact request-binding and complete paging contract, using recipient-relative item proofs and the distinct original-trash namespace where applicable. One invalid descendant denies the whole effect.                                                         |
| `collection(request)`    | Exact invocation/listing/kind/scope/query envelope; entries have fresh same-invocation received membership/path/read-capability evidence. Out-of-scope, denied or unreadable individual entries are omitted; conflicting duplicates and bad envelopes fail the page. |

An item's relative parent array starts with its shared directory anchor; the
anchor itself has an empty array. Every adjacent identity/path/name is checked.
Owner-root ID1 is forbidden everywhere in that relative array. Compatible
overlapping anchors retain the same recipient namespace: shorter and longer
chains must have equal overlapping suffix identities and paths, and the
invocation retains the stronger proved prefix. Configured-tree chains continue
to require complete exact equality. Different alias paths, identities, types or
lifecycle evidence still refuse.
The entire received-root set is validated before cache/use: two distinct
identities on the same owner drive cannot claim one canonical recipient path,
even on different pages or when the requested third root is individually valid.
This invalidates the complete snapshot; ordinary valid-but-unreadable or
path-denied roots may still be omitted from discovery.
There is no fabricated owner-drive root or ancestor. Original-trash parents
describe the historical recipient location; source restore capabilities must
still be fresh current evidence for that trashed identity. The existing
live/original lifecycle reconciliation and batch interaction checks also apply.

Discovery and collection results expose only permitted driveId/id/type/name/path
fields. Capability evidence, anchor proof objects and raw dependency fields are
not returned as grants. Ordinary direct reads execute the frozen checked
operation through the registered protected dependency, as in F-003.

Capabilities normalize to the frozen known predicates with primitive boolean
values only: exact true grants the predicate; false, missing or malformed values
do not. Unknown nested/function data is discarded without traversal or method
execution. Duplicate comparison fingerprints controlled primitives only, while
every ancestry proof is separately reconciled; a toJSON callback cannot hide a
contradictory read predicate or execute during policy comparison.

Only the complete validated list snapshot survives read invocations, strictly
below60 seconds including acquisition time. Target and anchor inspections are
fresh per invocation. Mutations/batches acquire a new list and exact required
source/destination predicates. The frozen matrix defines recursive authority;
unknown provider semantics never become a true predicate. Empty denies skip
path traversal but never skip capability predicates.

After asynchronous evaluation, a synchronous terminal age check reads the
invocation-private resolved snapshot immediately before execution or prepared
discovery/collection publication, with no intervening await. Expiry denies and
invalidates the cached list; it does not silently refresh or retry. A pending
snapshot cannot pass the guard. Configured-only operations consult no received
clock, and an executed dependency failure still propagates.

The implementation has no provider calls, retries, real write tools or runtime
registrations. Production qualification must demonstrate positive shared-root
and shared-child access, complete scoped pagination, recipient paths, capability
and recursive-authority mappings, bounded cancellation, revocation/cache cases,
negative controls and actual tool/resource wiring. A deny-all adapter cannot
satisfy that qualification. Fresh checks retain the documented upstream race.

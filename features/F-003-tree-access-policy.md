---
id: F-003
title: Configured-tree access policy and guarded operation effects
ticket: "#6"
status: done
version: 2
---

## Context

Version 2 is a frozen amendment under #7, reviewed with
[F-004 v1](F-004-received-share-policy.md). It narrows BR-042 to the
configured-tree route; all other configured-tree rules and blocked production
AC-19/AC-20 remain unchanged. The orchestrator autonomously froze both contracts
at 2026-11-02 19:32:08 UTC on reviewed SHA
`e913aa40af932889daa88be780095ff9095706c2`, after fresh independent
round 2 approval (archived evidence `runs/7-spec-review-2.md`), and notified the user.
[The immutable v1 snapshot](history/F-003-v1.md) preserves its contract
and review record. V1 autonomous freeze: 2026-11-02 at 07:44:57 UTC, reviewed commit
`ba18efdc983d5e3fe800b4d4eb62c65f1347ee0f`; fresh independent
round 2 approval (archived evidence `runs/6-spec-review-2.md`). The orchestrator confirms abstract
contract readiness and no open product question. AC-19/AC-20 remain blocked;
this freeze establishes neither production qualification nor ticket acceptance.

Users configuring a small kDrive subtree need that boundary to apply to direct
IDs, collections, resources and future mutations, even when the upstream token
can access more data. Accepted [F-002 v2](F-002-configuration.md) provides local
configuration and synthetic injected preflight, not authorization. This feature
adds the central policy contract described by [SPEC.md §§10.1–10.7](../SPEC.md).
The ticket's complete obligation remains #6 (archive issue 6).

At freeze, the [read evidence dossier](../docs/kdrive-read-evidence.md) contained
only a current HTTP 401 attempt. Subsequent accepted #5 documentation now records
bounded positive owned metadata and complete two-page children measurements;
see the sanitized observations (archived evidence `runs/5-final-read-measurements-1.md`).
Those measurements do not implement or qualify a normalized production adapter,
nor establish all required positive/negative access-policy fixtures. Historical
samples and public client code likewise do not qualify that adapter. An abstract
injected policy implementation can advance independently; their success cannot
close #6 or establish production enforcement. No provider request is authorized
by this specification. See readiness (archived evidence `runs/6-readiness-1.md`).

## Scope

- Central `policy.check(operation)` for a successfully preflighted configuration;
  configured-drive identity, roots, fresh ancestry, paths and denies.
- A normalized, injected evidence boundary with explicit incomplete outcomes;
  no provider field names or undocumented ancestry assumptions.
- One guarded dispatch facade shared by tool and resource consumers, with
  synthetic consumers proving the boundary before production consumers exist.
- Complete operation-effect descriptions and simulated future writes, including
  folder descendants, restoration and conservative sharing decisions.
- Bounded fail-closed behavior, collection filtering and documented races.
- Unit evidence and pending records for this contract; real adapter/consumer
  acceptance remains a separately visible blocked part of the same ticket.

### Out of scope

Positive received-share authorization/caching is specified separately in
[F-004 v1](F-004-received-share-policy.md) under #7; production MCP registration,
listeners and read tools (#8–#10); actual write tools or requests (#16 onward);
API probing or credential provisioning; retries, audit durability, collision
policy, content/version handling or an atomic provider transaction guarantee.
These exclusions identify ownership, not permission to waive #6's production
integration obligations. No feature, BR or capability is marked accepted by a
synthetic test or a spec freeze. Existing BR-019–BR-023 v1 are unchanged.

## Business rules

BR-042 is revised to version 2; all other rules remain version 1 and pending
full acceptance. Rule
records are prepared in the implementation PR, not represented as active here.

- **BR-029** — A policy decision uses only a successful F-002 resolved
  configuration and evidence acquired by its injected evidence dependency for
  that decision; caller assertions of ancestry, paths or completeness cannot
  confer authority. Verified by: AC-01.
- **BR-030** — A configured-tree operation is authorized only when every
  affected existing identity and destination belongs to a configured drive and
  its own identity or complete ancestor chain includes a resolved root in that
  same drive, with root ID `1` treated as whole-drive membership. Verified by:
  AC-02.
- **BR-031** — Resolved path roots remain bound to their preflighted
  `(driveId, folderId)` until a new startup; a rename, move or path replacement
  does not rebind them. Verified by: AC-03.
- **BR-032** — Every decision acquires fresh ancestry/path evidence without
  cross-decision caching, including consecutive checks of the same identity.
  Verified by: AC-04.
- **BR-033** — Invalid, missing, contradictory, cyclic, failed or incomplete
  evidence produces a denial without protected dispatch. Verified by: AC-05.
- **BR-034** — An affected current or resulting path matching a configured
  deny pattern under the matching contract below produces a denial, including
  under root ID `1`. Verified by: AC-06.
- **BR-035** — The policy derives the complete effect set from a recognized
  operation kind and validated arguments according to the effect matrix below;
  callers cannot omit required effects or supply an alternate effect set.
  Verified by: AC-07.
- **BR-036** — When denies are nonempty, folder rename, move, trash and
  restore require a complete traversal proving every relevant descendant's
  current/original and resulting paths permitted. Verified by: AC-08.
- **BR-037** — A descendant proof that reaches `maxTreeItems` examined
  descendant entries, exceeds its page-request budget, or cannot prove paging
  termination produces a denial. Verified by: AC-09.
- **BR-038** — An empty deny list causes no descendant traversal, while all
  identity, membership, evidence and operation-level checks remain required.
  Verified by: AC-10.
- **BR-039** — Restore requires fresh provable original trash-location
  membership and path authorization as well as authorized destination/result
  effects, and stores no server-side substitute for missing trash evidence.
  Verified by: AC-11.
- **BR-040** — Folder sharing is denied when any deny pattern's literal
  prefix and the folder path are prefixes of one another, including an empty
  literal prefix, regardless of present descendants. Verified by: AC-12.
- **BR-041** — Read operations require level `read`, mutations require at
  least `write`, and sharing operations require `share`; no feature switch can
  increase the configured cumulative level. Verified by: AC-13.
- **BR-042 v2** — The configured-tree authorization route denies received-share
  discovery and external-drive operations regardless of configured roots, known
  IDs or shared-access switches; only the separate F-004 route can authorize
  received-share operations.
  Verified by: AC-14.
- **BR-043** — Tools and resources dispatch protected work only through the
  same guarded facade, which checks the exact immutable operation and immediately
  consumes its single-use authorization within that invocation. Verified by:
  AC-15, AC-20.
- **BR-044** — A collection exposes only entries individually authorized
  using fresh request-bound evidence; an invalid page envelope fails the page
  without exposing a partial page. Verified by: AC-16, AC-19.
- **BR-045** — A multi-target protected operation dispatches nothing unless
  its effects are independent under the batch contract below and every target
  and derived effect passes one shared authorization invocation.
  Verified by: AC-17.
- **BR-046** — Refusals expose only the bounded diagnostic codes below and
  never include raw evidence, provider exceptions, credentials or paths.
  Verified by: AC-18.

## Contract details

### Trust boundary and normalized evidence

The future composition root injects credential-bound evidence and execution
dependencies. Configuration, adapters and registered operation definitions are
trusted program components; client arguments and every dependency result are
untrusted data. A malicious adapter implementation is outside the process trust
model: freshness is an adapter obligation and cannot be inferred from a boolean
in an arbitrary caller object. Contract tests verify that the core requests new
evidence; provider qualification must separately verify that the adapter actually
fetches it without a hidden cache.

Constructing the policy performs no I/O. It consumes the opaque successful
`ResolvedConfiguration` from preflight, copies and freezes relevant roots,
denies, level and limits, and exposes no method for replacing them per call.
Runtime validation remains necessary at exported boundaries; TypeScript types
alone do not establish provenance. Existing foundation `DriveClient.info()`
returns `unknown` and is not a qualified proof source.

The internal evidence dependency supports separate fresh inspection of an exact
live `(driveId, fileId)`, live direct-child pages of an exact directory, and
original-location inspection/enumeration for a trashed identity. Results
distinguish complete, missing, incomplete and failed outcomes. Every complete
result has an explicit validated location discriminator: `live` or
`original-trash`. The discriminator is a claim to validate with the rest of the
untrusted result, never a caller-selected permission. Missing, unknown or
contradictory lifecycle/location state is incomplete. A complete ordinary item
has location `live`, lifecycle `live`, and contains:

- Exact positive-safe-integer drive/item IDs, type `file` or `dir`, and name.
- A canonical absolute path and a complete ordered parent chain from drive
  root to immediate parent. Each parent contains the same drive ID, a unique
  ID, type `dir`, name and canonical absolute path. Root ID `1` has path `/`
  and no parent; it can be omitted from the normalized chain only as the
  explicitly identified drive-root sentinel. No other missing ancestor is
  permitted. The item cannot occur in its own chain.
- A structural relationship consistent with every adjacent path/name and
  parent identity. Root membership uses IDs, never textual path-prefix tests.
  Directory root `1` has an empty chain. A non-root item needs its immediate
  parent represented, except a direct child of the explicit root sentinel.
  Every parent is a live directory. No current trash path or historical
  original-location record can satisfy this ordinary-item contract.

Every non-restore source, read/list/search scope, collection entry and mutation
destination requires this live contract. Restore alone consumes a source with
location `original-trash`, lifecycle `trashed`, the exact requested identity,
original name/path and a complete original ordered parent chain. Original
parent fields describe their identities and paths at deletion, not their
current locations. They must establish the same root-membership and structural
invariants in that original namespace. The proof explicitly identifies its
trashed tree root and distinguishes the original namespace from a current
trash-container path. A live record cannot substitute for original trash proof,
and original trash proof cannot authorize an ordinary read or destination.

For a restored directory with nonempty denies, a separate original-trash child
enumeration must prove the entire original descendant set for that exact
trashed tree root. Every page/entry binds its original parent identity, original
name/path/chain and tree-root identity to that namespace; each entry proves
membership in the same trashed tree and its historical parent relationship.
Every original directory requires a terminal complete listing, including empty
directories, under the paging and count limits below. Current live children or
current trash-container children do not substitute. Missing original entries,
unknown historical parent relationships or unproved enumeration completeness
deny the restore. These are abstract evidence requirements, not a claim that
kDrive supplies a deletion snapshot. Without qualified support the adapter must
return incomplete, and no real restore capability is established.

Canonical paths follow F-002 root-path grammar and the 4,096-byte bound.
Names are single nonempty path components, never `/`, `.`, `..`, controls or
backslash. Do not URL-decode percent sequences, fold case, trim spaces or
normalize Unicode. Complete parent chains are bounded by the canonical path
size, not by fetching arbitrary parent links without a terminal proof. A result
that cannot represent this normalized evidence is incomplete, even if the
provider returned HTTP success. The adapter must establish the complete chain
from measured provider semantics; the core must validate its consistency.

A direct item check obtains one normalized fresh inspection per distinct
identity in the invocation. Additional reads needed to build that inspection
are adapter work and must be declared in production qualification. One item
may be reused within a single invocation for multiple effects; nothing survives
as ancestry/path evidence for another invocation. The historical single-request
optimization in SPEC §10.2 is conditional on #5 proving sufficient response
fields. It is not a fabricated guarantee of this abstract port.

### Pattern matching

Use precisely the accepted F-002 deny grammar; do not introduce extglobs,
escapes, braces, bracket classes, URL handling or filesystem glob libraries
with additional syntax. Match entire canonical paths, case-sensitively and
without Unicode normalization. Literals compare exactly. `*` matches zero or
more non-slash Unicode code points, `?` exactly one, and a complete `**`
component matches zero or more whole path components. Leading `/` anchors at
the drive root. Leading `**/` permits any number of leading components from
that root; the root's leading slash is not itself a component. No hidden-file
exception applies. A terminal `/**` includes the named directory itself.

Patterns match the actual full path, not automatically every descendant of a
matched directory. Configure `/private/**` to exclude that complete subtree;
`/private` matches that exact path only. `/` matches only the drive root. Denies
apply identically on every configured drive and to each relevant path in the
effect matrix. Examples forming the minimum matching table:

| Pattern | Matches | Does not match |
| --- | --- | --- |
| `/private/**` | `/private`, `/private/a/b` | `/private2/a` |
| `**/.ssh/**` | `/.ssh`, `/a/.ssh/key` | `/a/.ssh2/key` |
| `/a/*/c` | `/a/b/c` | `/a/b/d/c`, `/a/c` |
| `/a/?` | `/a/é`, `/a/😀` | `/a/ee` |
| `/A/%2F` | `/A/%2F` | `/a/%2F`, `/A/` |
| `/café` | `/café` (precomposed) | `/café` (decomposed) |

### Operation effects and dispatch

The internal discriminated operation registry accepts only known operation
kinds and exact documented fields. IDs and names are runtime-validated; caller
paths, `allowed=true`, ancestry or caller-supplied effect lists are rejected.
At most 256 targets are accepted in a batch; empty, oversized or duplicate
identity batches are invalid. Each operation is copied into immutable internal
data before any asynchronous evidence acquisition. Unknown kinds fail closed.

| Operation kind | Required effects and level |
| --- | --- |
| Read metadata/content/resource, or list/search scope | Current target or scope membership/path; `read`. Reading a directory does not authorize all descendants. |
| Create file/directory or new upload | Fresh destination directory membership/current path, derived `destination/name` path; `write`. Existing-file replacement is a distinct existing-target effect and cannot masquerade as creation. |
| Replace/upload existing file | Fresh existing file membership/current path; `write`. Content policy is later scope. |
| Rename file | Current source and derived same-parent/new-name path; `write`. |
| Move file | Current source, destination directory and derived destination/name path; `write`. Cross-drive moves are refused in v1. |
| Rename/move directory | Same checks as file, plus relevant descendant current/result paths with nonempty denies; `write`. Moving root `1` or moving into itself/its descendants is refused. |
| Trash file/directory | Current source; directory descendants with nonempty denies; `write`. No invented trash destination path is checked. Trashing root `1` is refused. |
| Restore file/directory | Original source identity/location proof, destination directory, resulting source path and, with denies, original/result descendant paths; `write`. Missing original proof refuses even with empty denies. |
| Share file | Current source membership/path; `share`. Public link additionally requires `effectivePublicLinks`; an invitation requires an exact normalized configured invitation domain. |
| Share directory | Current source membership/path and static literal-prefix test; `share`, with the same public-link/invitation switches. No present-content walk can substitute for that static test. |

Sources of a rename/move and all destination directories require live evidence
and must independently be within resolved roots. A restore source instead
requires the original-trash proof above to establish original membership;
its destination requires live evidence. Destination parents cannot be files,
trashed, historical-only or unknown-lifecycle records.
Renaming root `1` is refused. A non-root configured root can be renamed: its
identity remains authorized and current/result denies still apply. Moving a
configured root to a destination outside all roots is refused. This does not
prevent an external client from moving it; subsequent membership follows its
bound ID and actual fresh paths. Future restore evidence must include the
original full chain, not merely a trash path or a claimed old root ID.

The core derives descendant result paths by replacing the exact source prefix
on component boundaries with the validated result prefix, never substring
replacement. Trash uses only original/current paths; restore uses original and
result paths. The operation cannot gain authority by moving a forbidden source
to an allowed destination.

Batch operations are limited to independent effects; execution order does not
compose or relax their proofs. For each mutation derive its source region and
result region from validated evidence: a file is an exact identity/path, and a
directory is its identity plus the entire path subtree on component boundaries.
Restore uses its original source region and live result region. Creation has
only a result region; trash has only a source region. Reject the entire batch
if any source/result region of one mutation overlaps a source/result region of
another, or contains another target's existing source, read/share dependency or
destination directory. Compare same-drive identities as well as canonical
component-boundary paths; use original paths conservatively for restore source
comparisons. Duplicate resulting paths and a destination equal to or inside
another mutated source are therefore invalid even if current source subtrees
are disjoint. Distinct result paths may share an unchanged destination parent.
An unknown interaction denies rather than assuming independence. Apply these
checks with empty as well as nonempty denies.

For example, under `/r`, moving directory `a` into directory `b` while renaming
`b` to `c` is refused in either input/execution order. The source region `/r/b`
intersects the first result `/r/b/a` and contains its destination identity `b`;
fresh pre-operation proofs cannot authorize the eventual `/r/c/a` under deny
`/r/c/a/**`. Reject both orders before any dispatch rather than attempting
effect composition. Partial success at the provider is not made atomic by an
all-target policy decision; batch execution/retry semantics remain later
mutation scope and must never automatically replay uncertain writes.

The facade owns both `policy.check(operation)` and dispatch. Consumers pass
validated client inputs to registered operations; they cannot pass arbitrary
execution callbacks or obtain the adapter. Evidence requests are privileged
internal reads used to establish policy, not recursively guarded content reads.
Their raw data is never returned to consumers. There is no public raw-adapter
export through the runtime facade. The existing injected foundation client is
not removed, but future tools/resources must not receive it or its dependency.

An allow decision is not a reusable public grant: any internal authorization
object is private, bound to operation/configuration/invocation and consumed
exactly once before the next application-level await or queue boundary. Invoke
the registered protected dependency immediately after checking, with the frozen
operation that was checked. No caller confirmation, deferred job, retry or
second dispatch reuses it; each requires another check. Denials dispatch zero
protected calls. A production composition test must establish that both actual
tool and resource registrations use this facade; fake consumers alone do not
establish that integration.

### Traversal, paging and collections

With nonempty denies, enumerate a live directory's complete current subtree
using fresh live direct-child pages; restore instead enumerates its complete
original-trash subtree under the distinct proof contract above. No traversal
mixes these namespaces. The subject directory is checked separately and does
not count as a descendant. Count each returned descendant entry, files and
directories alike, across the entire invocation, including multiple target
subtrees; do not reset counts per folder or page. Duplicate identities,
cursor loops within one listing chain, repeated directory visits, cycles, a child outside its stated
parent or inconsistent paths invalidate the proof rather than being silently
deduplicated. Overlapping explicit batch source subtrees are refused as invalid
operations, avoiding ambiguous effect and budget accounting.

Let `N = maxTreeItems`. The Nth descendant entry reaches the ceiling and
immediately denies, even if that page claims to be final. At most N−1 entries
can authorize. This deliberately follows SPEC §10.4's stop-and-refuse wording;
N=1 permits a proven empty subtree and refuses its first child. The one-directory
empty-tree proof still needs a complete final children page.

Each requested directory page has an exact parent identity, an ordered entry
array, and either an explicit complete terminal marker or an opaque nonempty
next cursor. Bind cursor use and repetition detection to the exact
`(invocation, driveId, directoryId, location, trashedTreeRoot-if-any, listingChain)`;
the listing-chain identity is allocated internally when enumeration starts.
A cursor cannot transfer to another listing or namespace. Identical opaque
cursor text in distinct directory/drive/listing chains is permitted; returning
to an already used cursor within the same chain is incomplete. Both terminal
and next, neither, or failed pages are incomplete. Empty nonterminal pages are
refused. The same binding rule applies to collection listing chains and their
scope/query identity. A single authorization
invocation has at most `2*N + 256` children-page requests: the extra allowance
covers the bounded batch's empty source directories, and a complete page chain
with fewer than N entries cannot legitimately need more than that budget.
Refuse before issuing the next over-budget request. Cursors and raw errors
never enter diagnostics. This is a local safety bound, not a claimed upstream
page size. Do not assume that 1000 entries means termination.

For collections, the fresh list/search/recents/my-shared request is itself a
registered internal evidence request under an authorized scope. Its complete
page envelope binds entries to the current invocation and requested scope;
caller-submitted or previous-page objects cannot be used as evidence. Validate
each item's ancestry/path independently: an unauthorized or incomplete entry
is omitted, never exposed as a path/ID diagnostic. A structurally invalid
envelope, conflicting duplicate identity or request failure fails the entire
page. A well-formed page of entirely denied entries returns an empty result,
not the denied upstream items. Traversal proofs differ: one omitted/incomplete
descendant denies the operation, because filtering cannot prove absence.

The internal facade may reuse complete fresh collection-entry evidence without
another metadata request during that invocation. This preserves SPEC §10.2's
zero-extra-request filtering when the measured adapter can supply it. Producer
completeness, cursor exposure and final client pagination remain acceptance
obligations of the real collection tools; synthetic injection cannot prove them.
The configured-tree route exposes no received-share collection, even with
opt-in set. The separate F-004 route supplies its own positive discovery and
membership proof; it never turns an external drive into a configured root.

### Refusals and guarantee limits

An internal denial contains one code from `INVALID_OPERATION`,
`OUTSIDE_SCOPE`, `EVIDENCE_UNAVAILABLE`, `DENIED_PATH`, `LEVEL_REQUIRED`,
`TRAVERSAL_LIMIT`, `SHARE_RESTRICTED`, `SHARED_ACCESS_UNAVAILABLE`; no dynamic
message, path, ID, cursor, pattern, provider status/body or cause is exposed.
The public facade returns the same generic `ACCESS_DENIED` for all policy
refusals, preventing a known-ID existence oracle. It never catches an executed
mutation failure and misreports that as proof that no write occurred. Unknown
evidence failures normalize to refusal, without stringifying thrown objects.

README and SECURITY.md document that a fresh check precedes the protected
operation, with an unavoidable upstream race absent an evidenced atomic API.
Traversal across pages likewise cannot prove a single concurrent snapshot;
detectable inconsistencies refuse, but undetectable concurrent changes remain
possible. Single-use immediate dispatch narrows the window without eliminating
it. No provider timeout is invented here: the production dependency must supply
bounded cancellation/timeouts before qualification; a never-resolving promise
cannot yield permission or dispatch. No automatic retries occur in the core.

## Acceptance criteria

Every named test below is a planned test, not an executed result. Unit tests
name each BR. Tests are written and observed failing before implementation,
then run via Docker/Make (`make test`, full gate `make check`). Each synthetic
AC is repeated on the actual merged main SHA. Blocked ACs remain unaccepted;
the ticket stays open until its full acceptance evidence exists.

### Staged implementation and ownership handoff

First implement and review #6's abstract core and AC-01–AC-18 through one scoped
PR. Its merge may establish only those synthetic results on actual main;
AC-19/AC-20 remain blocked and #6 stays open. Save the exact merged SHA, evidence,
remaining ACs and adapter/facade contracts in a #6 handoff, then release #6's
active implementation ownership before advancing another implementation ticket.
Any evidence/provisioning work for #5 remains explicit prerequisite work.

Advance #7's separate received-share contract and then #8–#10's runtime/read
integration sequentially under their own contracts, one active implementation
ticket and one PR at a time. Never stack an integration PR on the abstract
policy PR. Each downstream ticket links the #6 handoff and preserves its
production acceptance obligations; it does not mark #6 accepted as a dependency
shortcut. If positive #7 support changes F-003's deny-all external rule, use the
required versioned, reviewed contract change rather than silently bypassing it.
Once qualified adapter evidence and actual registrations exist, resume #6 for
AC-19/AC-20 on actual main and record all remaining acceptance evidence before
closure. This is a staged handoff, not simultaneous ownership of implementation
tickets or a waiver of any gate.

- **AC-01 (BR-029)** — Given failed/unresolved configuration or caller-supplied
  proof fields, When checking, Then no authority or protected dispatch results;
  successful preflight and fresh injected evidence can authorize a valid read.
  Verified by planned `policy-trust-boundary` unit group.
- **AC-02 (BR-030)** — Given drive/ID collisions, outside-root siblings, root
  self-match, an ancestor match, and root `1` absent from parents, When checking,
  Then only same-drive configured-root members pass; denies still apply.
  Verified by planned `policy-root-membership` unit group.
- **AC-03 (BR-031)** — Given an ID-bound path root renamed or externally moved
  and a new directory occupying its old path, When checking, Then authority
  follows the original ID and the replacement receives none. Verified by
  planned `policy-root-identity` unit group.
- **AC-04 (BR-032)** — Given a permitted file moved outside all bound roots
  between two calls, When checking again, Then a second fresh read occurs and
  access is denied; no previous proof is reused. Verified by planned
  `policy-freshness` unit group; real adapter behavior also needs AC-19.
- **AC-05 (BR-033)** — Given each missing/failed/incomplete outcome and each
  wrong identity, wrong type, broken chain, cyclic/duplicate parent, inconsistent
  path and malformed runtime value, When checking, Then no protected call
  occurs. Verified by planned `policy-evidence-validation` unit group.
- **AC-06 (BR-034)** — Given the complete matching table above, zero-length
  wildcard cases, literal spaces/percent signs, decomposed Unicode and root `1`,
  When matching current/result paths, Then matches deny and nonmatches do not
  independently deny. Verified by planned `policy-deny-grammar` unit group.
- **AC-07 (BR-035)** — Given every effect-matrix row and attempts to omit source,
  destination or result checks, When simulating the operation, Then derived
  effects match the matrix and any forbidden effect denies the operation.
  Include file replacement, root mutations, cross-drive move, self/descendant
  move and malformed new names. Verified by planned `policy-operation-effects`
  unit group; spy dependencies perform no real writes.
- **AC-08 (BR-036)** — Given folder rename/move/trash/restore with a forbidden
  child/grandchild either before or after the transformation, When checking,
  Then dispatch is denied; a wholly allowed proven subtree passes. Verified by
  planned `policy-descendant-effects` unit group.
- **AC-09 (BR-037)** — Given N=1 and N=3, empty, N−1, N and N+1-entry trees,
  multi-page and multi-target inputs, bad/missing final markers, duplicate or
  cyclic pages and a failing later page, When checking, Then only complete
  below-ceiling proofs authorize, and no request exceeds the page budget.
  Verified by planned `policy-traversal-bounds` unit group, including an
  independently constructed fake beyond the budget (not provider evidence).
  Include two different directory listings returning identical cursor text
  and completing successfully, and a cursor loop within one exact listing
  chain that denies; test drive/namespace binding against cursor transfer.
- **AC-10 (BR-038)** — Given empty denies and an unauthorized source, invalid
  destination or insufficient level, When checking a directory effect, Then
  no children request occurs and those failures still deny. Given valid other
  proofs, it passes without traversal. Verified by planned
  `policy-empty-deny` unit group.
- **AC-11 (BR-039)** — Given a trashed file/folder originally outside roots or
  under a deny, or missing original location, When restoring toward an allowed
  directory, Then access is denied. Given complete allowed original/result
  proofs, the simulated restore passes. Verified by planned
  `policy-restore-origin` unit group. Include a trashed/unknown-state destination,
  live/original-trash substitution in both directions, a missing original
  descendant or historical parent proof, current-child pages substituted for
  original enumeration, and a complete allowed original subtree transformed
  into an allowed result subtree. Real trash capability remains unqualified
  and no restore tool is exposed.
- **AC-12 (BR-040)** — Given `/a/private/**`, `/else/**`, a literal-prefix
  collision `/ab/**` versus folder `/a`, and `**/.ssh/**`, When sharing a
  directory, Then symmetric raw string-prefix conflicts refuse, including the
  intentionally broad collision and empty-prefix cases; unrelated prefixes
  pass. Verified by planned `policy-folder-share-prefix` unit group.
- **AC-13 (BR-041)** — Given every level and shared-write/public-link switch
  combination, When simulating reads, mutations and shares, Then read mode
  never writes, write never shares, and share-specific switches/domain checks
  still apply. Verified by planned `policy-levels` unit group.
- **AC-14 (BR-042 v2)** — Given an external or unconfigured drive and a known
  shared root/child ID, with shared options both off and on, When reading or
  simulating mutation/sharing through the configured-tree route, Then all deny
  without protected dispatch. Verified by
  planned `policy-external-separation` unit group; no positive #7 claim.
- **AC-15 (BR-043)** — Given equivalent fake tool/resource calls, operation
  arguments mutated during awaited evidence acquisition and attempted grant
  reuse/deferred dispatch, When using the facade, Then equal decisions apply
  to the original immutable operation and each protected call has exactly one
  fresh check immediately preceding dispatch. Verified by planned
  `policy-guarded-dispatch` unit group and adapter spies.
- **AC-16 (BR-044)** — Given mixed allowed/denied/incomplete fresh entries,
  malformed page envelopes, conflicting duplicates and objects from an earlier
  invocation, When filtering a collection, Then only individually proved fresh
  allowed entries escape, invalid pages fail wholly and no metadata request
  is added for sufficient fresh entry proofs. Verified by planned
  `policy-collection-filter` unit group.
- **AC-17 (BR-045)** — Given two targets with the second denied, overlapping
  source subtrees, duplicate targets and the 256/257-target boundary, When
  authorizing a batch, Then any invalid or denied target causes zero protected
  calls; two independent allowed targets dispatch only after all proofs pass.
  Include under `/r` initially disjoint directories `a` and empty `b`, moving
  `a` into `b` plus renaming `b` to `c`, with deny `/r/c/a/**`: both batch orders
  produce zero dispatches. Also cover interacting source/destination identities,
  duplicate result paths and independent files sharing an unchanged parent.
  Verified by planned `policy-batch-effects` unit group.
- **AC-18 (BR-046)** — Given upstream errors containing paths, cursors,
  credential-shaped sentinels and throwing accessors, When evidence fails,
  Then the facade returns only generic `ACCESS_DENIED`, internal codes remain
  finite and no arbitrary value is logged/stringified. Verified by planned
  `policy-refusal-redaction` unit group and README/SECURITY content checks for
  races, folder-share restrictions and synthetic-only qualification.
- **AC-19 (BR-032, BR-033, BR-037, BR-044)** — Given the designated real #5
  metadata/list/search fixtures, including a permitted file, root `1`, a nested
  permitted directory and the >1000-child tree below the configured count
  ceiling, When qualifying the production normalized adapter, Then permitted
  real metadata proofs authorize reads, permitted collection entries are
  returned, and the complete measured multi-page traversal authorizes a wholly
  allowed simulated directory effect without issuing a real mutation. Fresh
  reinspection is required on consecutive checks. Given designated denied or
  outside-scope fixtures and missing, incomplete or contradictory evidence,
  Then metadata access denies, collections expose none of those entries, and
  incomplete descendant proofs deny. Both positive and negative outcomes are
  mandatory: an adapter that refuses every fixture cannot satisfy this AC.
  Verified by a future dated sanitized #5 ledger and
  adapter contract tests against its qualified fixtures. **Blocked:** #5's bounded
  successful owned metadata/two-page observations now exist, but the normalized
  adapter, bounded cancellation and complete positive/negative fixture contract
  tests remain unimplemented. The historical HTTP 401 is not qualification.
- **AC-20 (BR-043)** — Given actual runtime MCP tool/resource registrations,
  When the same permitted qualified real file is read through a metadata tool
  and content resource, Then both dispatch through the facade after fresh
  authorization and return the intended permitted data. When an unauthorized
  ID or scope is requested through either surface, Then no protected API
  dispatch occurs. Only the facade is reachable from those consumers; blanket
  refusal cannot satisfy the positive read cases. Verified by future
  production-composition integration tests and
  exact-main evidence. **Blocked:** no production adapter or consumers yet;
  fake consumers establish AC-15 only. #6 is not closed on AC-01–AC-18 alone.

## Decisions

1. Choose an explicit normalized evidence port with runtime consistency checks;
   reject treating `unknown` foundation metadata or historical provider fields
   as complete ancestry. The production adapter remains evidence-dependent.
2. Preserve accepted drive/root/preflight/level/config grammar; reject changing
   BR-019–BR-023 or using the token's wider visibility as authority.
3. Choose full-path glob matching and whole-component `**`, including zero
   components; reject implicit subtree matching for literal patterns and URL,
   case or Unicode normalization. This makes `/private/**` the subtree deny.
4. Choose strict stop-at-N traversal, counting descendants across the complete
   operation and refusing duplicate evidence; reject silently granting at N,
   count reset per page, truncation and filtered partial-tree proofs.
5. Choose raw symmetric literal-prefix folder-share refusal exactly as SPEC
   §10.4, including false positives such as `/a` versus `/ab`; reject boundary
   relaxation or present-content scans that cannot protect future additions.
6. Keep configured-tree denial for external/received-share operations while
   F-004 supplies a separate proved route under #7; reject permissive treatment
   of opt-in flags and silently adding external drives to configured roots.
7. Choose one immutable, immediate, single-use guarded invocation and all-target
   authorization of independent batch effects before dispatch; reject effect
   interactions instead of composing them, public reusable grants, arbitrary
   consumer callbacks and claims of atomic provider batch behavior.
8. Keep evidence-dependent production ACs blocked and #6 open; reject reducing
   the issue to a synthetic core. A future contradiction requires reviewed
   versioning, never silent adapter normalization that expands authority.
9. Explicitly distinguish fresh request-bound collection filtering from complete
   descendant proofs. Reject caller-supplied evidence, extra metadata reads
   when complete current-page evidence suffices, and treating omitted entries
   as proof that a subtree is safe.

## Open questions

No unresolved product choice remains for v2. Production prerequisites AC-19
and AC-20 remain blocked, not assumed. The recorded joint freeze with F-004
authorizes the abstract stage only; no provider request is authorized.

## Stress-test

The dispositions below belong to preserved v1. Fresh independent #7 round 2
approved this amendment and F-004 together on the joint freeze SHA above.

Fresh review round 1 (archived evidence `runs/6-spec-review-1.md`) returned `changes` against
`86182007b8f744ba9fddd492d4f709cbf453e8c7`. All four findings are retained:

- **R1, major — retained.** Reject interdependent batch effects before dispatch,
  including mutated-source/destination interactions and overlapping planned
  result regions. AC-17 includes the exact `/r/a`, `/r/b` → `/r/c/a` bypass in
  both orders. Conservative refusal avoids inventing future ordered mutation
  composition and preserves unchanged-parent independent batches.
- **R2, major — retained.** Add explicit live/original-trash lifecycle/location
  contracts, live-only ordinary sources/destinations, and complete original
  descendant enumeration for restore. AC-11 includes namespace substitution,
  unknown lifecycle, trashed destination and missing original-child proofs.
  Unknown provider trash support remains a refusal, never an inferred snapshot.
- **R3, major — retained.** AC-19 requires usable positive real metadata,
  collection and multi-page proofs plus negative checks; AC-20 requires positive
  real tool/resource reads plus negative enforcement. Blanket denial cannot
  satisfy either AC. Both remain blocked until their actual evidence exists.
- **R4, minor — retained.** Scope cursor loops to exact drive/directory/namespace
  listing chains. AC-09 permits equal cursor text in distinct listings and
  refuses loops or transfers within/between the wrong chains.

The staged ownership handoff preserves the complete ticket while enabling
sequential #7–#10 integration after abstract-core review/merge. A new independent
review must approve the revised SHA before any autonomous freeze; no author
approval, freeze or acceptance is asserted here.

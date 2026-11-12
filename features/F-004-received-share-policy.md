---
id: F-004
title: Separate received-share authorization
ticket: "#7"
status: done
version: 1
---

## Context

Autonomous joint freeze by the orchestrator: 2026-11-02 at 19:32:08 UTC,
reviewed commit `e913aa40af932889daa88be780095ff9095706c2`, after fresh
independent round 2 approval (archived evidence `runs/7-spec-review-2.md`). F-004 v1 and F-003 v2
are frozen together. The user was notified; no open decision remains. This
authorizes only the abstract stage and no provider request; AC-14/15 remain blocked.

Users who explicitly enable received shares need access to their shared files
without granting access to an owner's whole external drive. #7 (archive issue 7)
requires positive discovery, membership proof, recipient-path denies and tightly
bounded read caching, with separately gated writes and no re-sharing.

[F-003 v1](history/F-003-v1.md) has an accepted abstract implementation at main
`f31ee2f0e772c87d4ebfbe6a7aa77bc925d5b330`, but its production AC-19/AC-20 remain
blocked. [F-003 v2](F-003-tree-access-policy.md) and BR-042 v2 are reviewed with
this contract to preserve configured-tree separation while adding this route.
The joint freeze permits the abstract implementation; it establishes no
production qualification or acceptance.

The #5 final measurements (archived evidence `runs/5-final-read-measurements-1.md`) explicitly
leave shared-child ancestry and external visibility unmeasured. SPEC §10.3's
provider field descriptions are hypotheses requiring qualification, not facts
that this feature may assume. No credentials, private fixtures, provider calls
or writes are authorized by this specification.

## Scope

- An injected received-share evidence boundary and opt-in discovery independent
  of configured drive roots, integrated with the existing guarded policy facade.
- Positive shared-root and descendant reads; simulated mutations authorized
  against complete source/destination/result effects and actual capabilities.
- Recipient-visible path matching with the existing deny grammar; complete
  descendant proofs where F-003 requires them.
- A private complete received-share-list cache, at most 60 seconds for reads;
  fresh membership, paths, capabilities and ancestry for mutations.
- Synthetic unit evidence and explicit production acceptance obligations.

### Out of scope

Real write tools/requests, retries, content caching, runtime/listener authoring,
new public MCP tool schemas, visibility-based filters, API probing, provisioning,
and atomic upstream authorization. Runtime/read integration remains #8–#10;
production qualification is nevertheless required before #7 closes. Common/team
folders remain ordinary configured-drive folders. #6 AC-19/AC-20 remain owned
by #6 and are neither waived nor implicitly satisfied here.

## Business rules

New BRs are version 1, pending acceptance; BR-042 changes to version 2 without
changing its separation purpose. Records and named unit tests accompany the
implementation, after freeze.

- **BR-042 v2** — The configured-tree authorization route denies received-share
  discovery and external-drive operations regardless of configured roots, known
  IDs or shared-access switches; only the separate F-004 route can authorize
  received-share operations. Verified by: AC-01.
- **BR-047** — With `sharedWithMe=false`, received-share discovery and every
  received-share operation deny without received-share evidence or protected
  dispatch. Verified by: AC-02.
- **BR-048** — Opt-in discovery exposes only validated live received-share
  roots from a complete dependency-acquired snapshot, after recipient-path deny
  checks, without treating external drives as configured drives. Verified by: AC-03.
- **BR-049** — An external target is authorized only when its exact same-drive
  identity is a discovered received-share root or a complete validated fresh
  chain connects it to such a root. Verified by: AC-04.
- **BR-050** — Every affected current, original and resulting received-share
  path passes the existing deny matcher in the recipient namespace, using the
  F-003 operation-effect and complete descendant-proof requirements. Verified by: AC-05.
- **BR-051** — Only complete validated received-share-list snapshots are cached
  across read invocations, and a read may use one only while elapsed monotonic
  time from acquisition start is nonnegative and strictly less than 60 seconds.
  Verified by: AC-06.
- **BR-052** — Each mutation invocation obtains a new complete received-share
  list and fresh ancestry, paths and capabilities for every affected identity
  without using a previous invocation's evidence. Verified by: AC-07.
- **BR-053** — A received-share mutation requires `sharedWithMe=true`,
  `sharedWrite=true`, configured level at least `write`, and every operation-specific
  actual capability required by its complete effect set. Verified by: AC-08.
- **BR-054** — Re-sharing received-share items through either sharing operation
  always denies, at every level and capability combination. Verified by: AC-09.
- **BR-055** — External drive-root listing/search and unscoped external
  enumeration deny even with shared discovery enabled. Verified by: AC-10.
- **BR-056** — Missing, failed, contradictory, cyclic, incomplete or over-budget
  received-share evidence denies without protected dispatch, with the same
  generic public refusal as the configured-tree route. Verified by: AC-11.
- **BR-057** — All received-share protected operations and exposed collection
  entries pass through the same immediate single-use guarded facade as ordinary
  configured-tree operations. Verified by: AC-12.
- **BR-058** — Common/team folders on configured non-external drives use the
  ordinary configured-tree rules regardless of shared flags or visibility
  metadata. Verified by: AC-13.

## Contract details

### Evidence and namespace

Successful F-002 preflight remains mandatory. The composition root injects a
credential-bound received-share dependency; callers cannot select an evidence
adapter, supply proofs, select a cache entry or request a more permissive route.
The facade copies/freeze-validates operation inputs before awaits. Construction
performs no I/O. The configured-tree core retains its existing fail-closed route.

Discovery is a distinct internal operation with no external drive-root scope.
It acquires all pages of the received-share list into one immutable snapshot
before exposing results or using membership. A normalized complete root contains
positive-safe-integer owner drive/item IDs, a qualified external drive role,
live lifecycle, file/directory type, a single-component name, a canonical
recipient path and normalized actual capability evidence. Root ID `1` is never
a shared anchor. Paths use F-003's canonical grammar and 4,096-byte bound and
live below `/Shared/`; the adapter proves the actual recipient namespace rather
than inventing an owner's path or guessing the name of a mount. File anchors
authorize only their exact identity; directory anchors can authorize descendants.

Every fresh target proof identifies its exact requested drive/item and anchor,
live lifecycle, current name/type, recipient path and an ordered chain from the
anchor to the immediate parent. The anchor itself has an empty relative chain.
Every chain member is a unique live directory in the same owner drive, with
consistent adjacent identities, names and recipient paths. No owner-root chain
is required or invented. A complete fresh anchor inspection must agree with
the snapshot's anchor identity/type/path; an old cached alias cannot authorize
a freshly renamed anchor. Same-ID cross-drive, root substitution, gaps, cycles,
contradictions and current-trash substitution deny. When multiple listed anchors
cover a target, complete evidence must resolve them to one consistent recipient
path or the target denies; selecting a convenient permitted alias is forbidden.

Provider qualification may use sufficient `parents` fields or bounded parent-ID
resolution, but must demonstrate every link and stopping condition on real
shared descendants. An HTTP success or provider `can_read` flag alone is not
membership proof. No ancestry/path/capability result survives an invocation.
Cached root-list capabilities never substitute for fresh target capabilities.
The exhaustive normalized capability matrix below selects the abstract policy;
actual provider-field mappings and their semantics remain qualification work
under AC-14. A generic `can_write` cannot substitute for an unknown predicate.

### Normalized capability matrix

Each named predicate is an explicit boolean in validated dependency evidence;
only literal `true` authorizes. Missing, false, malformed or unknown values deny.
Predicates are internal proof fields, never client arguments or returned grants.
`S` is the existing source/target, `D` the existing live destination directory,
and `T` the known resulting item type. A predicate on `S` or `D` is read from a
fresh exact-identity inspection during this invocation. Read and mutation level,
flags, membership, denies, effect proofs and lifecycle checks remain cumulative
requirements; capabilities never replace them.

| Operation kind | Required predicates and identities | Supported effect |
| --- | --- | --- |
| `shared-with-me` | Complete list envelope `discover=true`; fresh `read=true` on every exposed anchor | Unscoped received-root discovery only; no external-root listing |
| `read` | `S.read` | Metadata/content read of a live anchor or descendant |
| `list` | `S.read`, `S.list`; each exposed entry has fresh `read` | Direct children of a proved live shared directory |
| `search` | `S.read`, `S.search`; each exposed entry has fresh `read` | Search scoped to a proved live shared directory |
| `create` with type `file` | `D.createFile` | Create a new file |
| `create` with type `dir` | `D.createDirectory` | Create a new empty directory |
| `upload-new` | `D.createFile` | Upload a new file |
| `replace` | `S.replace` | Replace content of an existing live file |
| `rename` | `S.rename`; additionally `S.renameTree` when S is a directory | Rename S and derive all resulting descendant paths |
| `move` | `S.moveOut`, `D.acceptMove`; additionally `S.moveTree` when S is a directory | Move S of its proved type into D; derive all resulting descendant paths |
| `trash` | `S.trash`; additionally `S.trashTree` when S is a directory | Trash S and its subtree |
| `restore` | `S.restore`, `D.acceptRestore`, and `D.createFile` for T=file or `D.createDirectory` for T=dir; additionally `S.restoreTree` when S is a directory | Restore a proved trashed source into a proved live destination, with original and resulting paths |
| `batch` | Union of predicates for every contained supported operation | Independent all-target effects only; no nested batch or discovery |
| `recents`, `my-shared`, `share-link`, `share-invite`, unknown kinds | Always denied on the received-share route | No supported received-share effect in this version; no capability can enable one |

`discover` authorizes the dependency's complete received-root enumeration, not
access to any root's metadata/content. Fresh per-anchor inspections are required
even when discovery reuses a cached snapshot; denied/unreadable roots are omitted
from output. The immutable cached envelope may retain `discover` for the read
cache interval, but snapshot capabilities never authorize a mutation or target
read. Collection entries can use fresh same-invocation complete entry evidence
without an extra metadata request, as in F-003.

`acceptMove` authorizes attaching the exact proved source type to D; it is not
permission to create unrelated content. `acceptRestore` authorizes attaching the
proved restored type to D, and the corresponding create predicate is separately
required. Restore source predicates come from fresh current capability evidence
bound to its trashed identity, separate from the historical original-path proof.
Neither historical capabilities nor capabilities of a live same-ID substitute
authorize restore. Creation has no nonexistent source predicate; rename/trash
have no destination predicate; replace never accepts a directory.

The four `*Tree` predicates explicitly certify authority for that operation's
entire recursive effect at the source directory, including all affected
descendants. They supplement the source operation predicate. They are not an
inference from ordinary file or directory write access. No per-descendant
mutation capability is required once this complete recursive authority is
proved; descendant enumeration remains required for paths whenever denies are
nonempty. With empty denies there is no capability-only descendant traversal:
the source still needs its `*Tree` predicate. Unknown provider support for such
authority makes that production operation unavailable, not the abstract matrix
ambiguous. Positive synthetic directory cases provide the explicit predicate;
qualified production semantics cannot be replaced by blanket refusal.

F-003's effect matrix, batch independence checks, live/original-trash distinction,
stop-at-`maxTreeItems` descendant limit, page bounds and no filtered partial-tree
proof apply in the recipient namespace. Restore needs separate original
recipient-location proof; a live mount is not deletion-history evidence.
Effects crossing configured/external drives deny. Effects involving different
anchors on the same external drive require proof of every anchor and path,
with one consistent recipient namespace. Unknown root rename/move or historical
mount semantics deny the affected operation rather than inventing result paths.
Positive unambiguous descendant writes remain mandatory synthetic coverage.

Received-share root discovery uses the same explicit terminal/next-page envelope,
cursor repetition checks, per-listing bindings and request budget as F-003.
Each complete snapshot contains fewer than `maxTreeItems` entries; reaching
that ceiling denies before publication. Duplicate root identities or inconsistent
aliases invalidate the snapshot; well-formed roots denied by path are omitted
from discovery output but are never silently removed from membership/path proof.
The evidence producer must terminate ancestry within the canonical path bound
(at most 2,048 parent-link inspections per target). Production dependencies must
provide bounded cancellation/deadlines; never-resolving evidence cannot dispatch.
No upstream timeout, page size or completeness guarantee is inferred.

### Cache and freshness

The cache belongs to one immutable policy instance/credential-bound dependency
and successful preflight configuration, and is never exported. It stores only
the full validated received-share-list snapshot, not filtered output, targets,
ancestry, paths fetched outside that list, content, errors or authorization grants.
Invalid/failed refresh discards the previous snapshot; no stale-on-error fallback.
Age includes acquisition time and all pages. A negative or nonfinite clock delta,
elapsed time of exactly 60 seconds, or completion after 60 seconds cannot create
a usable read cache entry. A newly acquired complete snapshot may serve its
current invocation, but a decision whose list is already 60 seconds old denies.
Default monotonic clock is internal; tests inject it as a trusted dependency.

Reads may reuse this snapshot below the age ceiling, but inspect target and
relative ancestry freshly each invocation and recheck snapshot age immediately
before protected dispatch. Discovery rechecks age before publishing its output.
Mutations bypass cached snapshots, refresh once per complete invocation/batch,
and never coalesce their refresh with an earlier read or write. List freshness
does not imply atomic revocation handling: read membership may lag by less than
60 seconds, and fresh write checks still have the F-003 check/operation race.
No automatic retry or uncertain-write replay is introduced.

### Routing and protected dispatch

The facade derives configured-tree versus received-share handling from its
trusted configuration/evidence boundary, never from a client `shared` flag.
No failed configured-tree check is converted into authorization merely because
an ID is known externally. Opt-in enables the separate proof route; it never
adds external drives to configured roots. Shared-root list/search are permitted
after proof; owner-drive root ID `1`, root-wide recents/my-shared and arbitrary
external scopes are denied. Received `recents` and `my-shared` are also denied
within shared directories in this version, as the exhaustive matrix specifies.
Received discovery is the sole unscoped entry point.

Collections under a proved shared directory filter every entry through fresh
same-invocation membership/path/capability evidence. Bad envelope or contradictory
duplicate identities fail the page; unauthorized individual entries are omitted.
Raw owner paths, denied identities, upstream errors, cursors and capabilities
never leak through diagnostics. Denials use F-003's generic `ACCESS_DENIED`.
All-target batches dispatch nothing until all effects authorize; existing
single-use immediate dispatch and operation registry remain mandatory.

## Acceptance criteria

These are planned tests, not executed results. Each unit group names every BR
it covers. Tests are observed failing before code and run through `make test`;
the complete Docker/Make gate is `make check`. Actual-main acceptance repeats
all synthetic ACs and preserves blocked production ACs explicitly.

- **AC-01 (BR-042 v2)** — Given configured roots and every shared-flag setting,
  When the configured-tree route sees received discovery or external targets,
  Then it denies; an opted-in F-004 facade instead permits a fully proved positive
  external read. Verified by `shared-route-separation` unit group and updated
  BR-042 v2 regressions.
- **AC-02 (BR-047)** — Given opt-in disabled and known shared IDs, When discovery,
  reads or mutations are requested, Then no received evidence nor protected
  execution occurs. Verified by `shared-opt-in` unit group.
- **AC-03 (BR-048)** — Given a complete two-page mixed discovery snapshot with
  denied paths, When opt-in discovery runs, Then only permitted validated roots
  are returned with owner drive IDs; incomplete discovery returns none and a
  generic refusal. Verified by `shared-discovery` unit group.
- **AC-04 (BR-049)** — Given a shared file, shared directory, deep child,
  unrelated known ID, wrong drive, gap and cyclic chain, When reading, Then the
  first three permit with fresh proofs and all invalid/unrelated cases deny.
  Verified by `shared-membership` unit group.
- **AC-05 (BR-050)** — Given `/Shared/Project/private/**` and rename/move/trash/
  restore cases affecting descendants, When any current/original/result path
  matches or traversal is incomplete, Then dispatch denies; a completely proved
  permitted descendant rename/move allows. Verified by `shared-recipient-effects`
  unit group, including ambiguous aliases and missing historical-location proof.
- **AC-06 (BR-051)** — Given a complete list started at time zero, When reads
  occur at 59,999 ms and 60,000 ms, Then only the former may reuse it; both request
  fresh target/ancestry evidence. Failed refresh, clock rollback, slow acquisition,
  cross-instance reuse and age crossing during inspection never dispatch stale
  membership. Verified by `shared-read-cache` unit group.
- **AC-07 (BR-052)** — Given a cached permitted root followed by revocation or
  changed capabilities, When two consecutive invocations of every supported
  mutation matrix row run (including both create types, file/directory variants
  and batch), Then each reloads the full list and every required exact S/D proof;
  a true-to-false change of each required predicate individually denies the
  second invocation. Restore also refreshes its trashed-source capability proof;
  no historical or cached capability substitutes. Neither invocation uses an
  earlier list, ancestry or capability proof. Verified by table-driven
  `shared-write-freshness` unit group, including removed shared membership.
- **AC-08 (BR-053)** — Given every mode/flag combination and present/absent
  operation capabilities, When simulating every supported mutation matrix row,
  Then only both flags plus at-least-write plus every required predicate allow;
  read mode always denies. Verified by table-driven `shared-write-gates` unit
  group: each row has an all-required-true positive and, separately for every
  required S/D predicate, false/missing/malformed cases with all other predicates
  true. Rows cover both create types, upload-new, replace, file and directory
  rename/move/trash/restore, both restored types' destination create predicates,
  and an independent batch. Every directory row covers empty and nonempty denies,
  explicit `*Tree` true/false/missing, and complete path traversal where required.
  Positive permitted descendant mutations cannot be substituted with refusal.
  The unsupported rows and unknown kind deny even with all capability booleans
  true. Read/discovery/list/search matrix requirements receive corresponding
  all-true and each-predicate-false/missing/malformed cases under AC-03/04/10,
  including fresh read capability for each exposed anchor/entry.
- **AC-09 (BR-054)** — Given every flag/mode and full sharing capability, When
  either sharing operation targets a received root or child, Then no dispatch
  occurs. Verified by `shared-resharing-denied` unit group.
- **AC-10 (BR-055)** — Given opt-in and full capabilities, When listing/searching
  external root ID `1` or performing root-wide enumeration, Then deny, while
  discovery and list/search under a proved shared directory succeed. Verified by
  `shared-external-scopes` unit group.
- **AC-11 (BR-056)** — Given malformed, failed, missing, over-budget, wrong-role,
  contradictory and never-resolving proofs, When checking, Then no protected call
  occurs and completed refusals expose only generic denial. Verified by
  `shared-fail-closed` unit group, including cursor loops, snapshot count ceiling,
  ancestry bounds and no stale-on-error fallback.
- **AC-12 (BR-057)** — Given fake tool/resource consumers, collections and a
  batch whose later target fails, When dispatching, Then both positive consumers
  use one immediate checked invocation and negative/batch cases dispatch nothing;
  callers cannot inject evidence or reuse grants. Verified by `shared-facade`
  unit group and F-003 facade/batch regressions.
- **AC-13 (BR-058)** — Given ordinary private/team folders on a configured drive,
  When varying shared flags and visibility, Then unchanged roots/denies/levels
  decide access without a visibility filter. Verified by `shared-common-folders`
  unit group.
- **AC-14 (BR-048–BR-056)** — Given separately authorized real shared-root and
  shared-child fixtures, When a qualified bounded production adapter performs
  complete discovery, positive root/child metadata and scoped multi-page reads,
  plus negative unrelated-ID/denied-path/revoked-share cases, Then measured
  provider semantics establish actual membership, recipient paths, capability
  mappings and cache/freshness enforcement. Verified by a sanitized production
  adapter contract suite and exact-main evidence report, command recorded when
  available. **Blocked:** #5 has no shared-child/external-visibility qualification;
  no provider calls are authorized here. Blanket denial does not satisfy this AC.
- **AC-15 (BR-047–BR-058)** — Given actual registered MCP tool/resource consumers
  and the qualified adapter, When discovery, permitted shared-root/child reads,
  denied known IDs, cache expiry, external-root enumeration and re-sharing run,
  Then positive reads succeed and every required refusal prevents protected
  execution through the facade. Verified by the real runtime integration suite
  and exact-main report, command recorded when available. **Blocked:** actual
  runtime/read registrations belong to #8–#10. Simulated writes verify policy;
  no real write request is needed or authorized for #7 acceptance.

## Decisions

1. Preserve positive authorization requirements while staging abstract evidence
   separately from provider/runtime qualification. Reject counting blanket denial,
   injected success or a merge as full #7 acceptance.
2. Cache only complete received-share lists, with a strict age ceiling including
   fetch time and a final age check. Reject ancestry/content caches and stale
   fallback; expose the bounded read revocation lag in security documentation.
3. Use recipient paths and complete anchor-relative proofs, not fabricated owner
   ancestry. Reject accepting an ID, a capability or a caller-provided path alone.
4. Refuse inconsistent aliases and unproved effects. Reject choosing an alias
   merely because it avoids a deny, new visibility filters and inferred provider
   semantics. Qualified positive root/child reads and descendant writes remain
   required, rather than treating missing production evidence as product success.
5. Version F-003 and BR-042 together; preserve the v1 snapshot, existing configured
   behavior and pending #6 production obligations. Other F-003 BRs keep their
   versions because their configured-tree purpose and behavior do not change.

### Staged implementation and ownership handoff

One #7 PR may deliver the abstract route and synthetic AC-01–AC-13 after freeze,
TDD, local gate, CI and independent review. Accept those ACs on actual main only;
keep #7 open and AC-14/AC-15 blocked until real qualification exists. Preserve
pending BR/capability/changelog markers. The orchestrator records the exact SHA,
evidence, dependency contracts and blockers and releases abstract implementation
ownership before separately authorized #8–#10 work. Never stack PRs. Resume #7
for real acceptance after qualification. This staging does not close #6 or waive
its AC-19/AC-20; a future contract contradiction requires reviewed versioning.

## Open questions

No unresolved product decision remains. Provider semantics and
real registrations are blocked verification dependencies, not assumed answers.
The recorded joint freeze authorizes the abstract stage only.

## Stress-test

Fresh review round 1 (archived evidence `runs/7-spec-review-1.md`) returned `changes` against
`c0538b9290c4b84915b1b252cdaf14dd1b31433b`.

- **R1, major — retained.** Add the exhaustive normalized capability matrix for
  every registered kind, exact source/destination predicates, separate restore
  source/current capability and historical-path proofs, and explicit recursive
  authority. Directory operation capability plus its `*Tree` predicate covers
  the complete recursive effect; path traversal follows F-003 and empty denies
  do not trigger a new capability-only traversal. Extend AC-07/08 with every
  supported row, individual missing/false/malformed predicates, freshness flips,
  positive descendant mutations and always-denied kinds. Provider mapping remains
  blocked under AC-14; no real behavior or successful qualification is invented.

Fresh round 2 approval (archived evidence `runs/7-spec-review-2.md`) of
`e913aa40af932889daa88be780095ff9095706c2` resolves R1. The orchestrator froze
this joint contract at the timestamp recorded above. Production qualification
and actual-main acceptance remain separate and mandatory.

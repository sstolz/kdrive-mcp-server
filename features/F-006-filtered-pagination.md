---
id: F-006
title: Guarded filtered pagination and collection tools
ticket: "#9"
status: done
version: 1
---

## Context

Injected-scope acceptance completed on actual main
`30e059ef8ef3540c4aa4bb6a0de0bf209c963b12`,2026-11-02; see
the acceptance evidence (archived evidence `runs/9-acceptance-1.md`). This marker synchronization
changes no frozen v1 contract. F-007 later versions BR-060 for #10.

Autonomous freeze by the orchestrator on 2026-11-02, reviewed SHA
`59f462ff1e0444a5a55c3907676480d70baf8e75`, after fresh independent
round2 approval and freeze record (archived evidence `runs/9-spec-review-2.md`). The ticket is
ready, no question remains and the user was notified of this SHA and decisions.

#9 (archive issue 9) extends the accepted
injected F-005 stdio runtime at actual main
`209a68de956b328e04e2d98d6745128a587184bd`. Clients need bounded continuation
through authorized lists, searches, recents and share listings without treating
filtered emptiness as exhaustion or disclosing sharing details.

[#5 evidence](../docs/kdrive-read-evidence.md#selected-synthetic-observations)
measured one owned-folder traversal: HTTP200 pages1000+1, zero duplicates,
exact expected union and terminal completeness; an invalid limit returned422.
Search completeness, provider cursor expiry/concurrent mutation and received-share
ancestry/external visibility remain unmeasured. This feature qualifies injected
synthetic behavior, not provider semantics. #6 AC19/20 and #7 AC14/15 remain
mandatory and blocked. D-04 (archive `docs/github-backlog.md`)
is resolved by the explicit work/continuation contract below.

## Scope

- One session-owned opaque continuation mechanism shared by five collection
  tools, four new read tools and guarded normalized page projection.
- Configured root order, per-invocation five-list-call accounting, cross-call
  deduplication, fresh policy evaluation and exact scalar output.
- Named unit tests and actual SDK stdio client tests, including >1000 synthetic
  objects, root overlap and consecutive calls.
- Synchronize accepted #8 F-005/BR-059–071/capability markers using its
  actual-main acceptance (archived evidence `runs/8-acceptance-1.md`); carry preserved #8 review2,
  acceptance1 and usage-summary1 records unchanged into the reviewed PR.
- Version BR-060 and BR-065 for their same-purpose registration/list contracts.
  F-005 v1 remains immutable history; these later definitions govern #9.

### Out of scope

A production adapter or entrypoint, account/private-fixture/credential access,
provider probes, real writes, retries, HTTP, resources, prompts, content reads,
share mutations or recipients/link output, VERSION/release/publication changes.
F-003/F-004 authorization and complete received-membership proof are not weakened.
Path resolution retains its bounded terminal-only traversal; #9 does not add
pagination to `kdrive_resolve_path` or change its existing errors.

## Business rules

BR-072–BR-081 are new v1 rules; BR-060/065 become v2 with preserved history.
Canonical records accompany implementation after independent review and freeze.

- **BR-060 v2** — Each mode exposes exactly the eight declared cumulative read
  tools with read annotations and no mutation tool, prompt or resource.
  Verified by: AC-01.
- **BR-065 v2** — Each paged collection response exposes only a bounded authorized
  batch with continuation exactly when the session retains unfinished work.
  Verified by: AC-02, AC-03.
- **BR-072** — Configured collection scopes execute in configuration order and
  preserve upstream page order without global sorting. Verified by: AC-04.
- **BR-073** — A paged tool invocation starts at most five upstream list-type
  dependency calls, counting authorization discovery and traversal calls.
  Verified by: AC-05.
- **BR-074** — A continuation traversal emits each `(drive_id,id)` at most once
  across pages and overlapping roots. Verified by: AC-06.
- **BR-075** — Every continuation belongs to one live session, tool, effective
  argument set and immutable configuration/authorization context.
  Verified by: AC-07.
- **BR-076** — Continuation state is bounded in age, count and retained data and
  fails without a partial success when those bounds cannot be maintained.
  Verified by: AC-08.
- **BR-077** — Every resumed collection invocation obtains current policy
  authorization before publishing its items; retained state is never a grant.
  Verified by: AC-09.
- **BR-078** — Collection output contains only the five declared metadata fields
  in every mode and never serializes raw or nested sharing metadata.
  Verified by: AC-10.
- **BR-079** — Configured collection entries satisfy the requested scope and
  external entries satisfy the existing opt-in received-share proof route.
  Verified by: AC-11.
- **BR-080** — An invalid, expired or unavailable continuation produces one fixed
  sanitized error and starts no dependency call. Verified by: AC-07, AC-08.
- **BR-081** — Cancellation, timeout, close or a failed page invalidates the
  affected traversal and publishes no partial batch or reusable continuation.
  Verified by: AC-12.

## Contract details

### Tools and scope selection

The existing `kdrive_list_drives`, `kdrive_info` and `kdrive_resolve_path` contracts
remain unchanged. The five paged tools share optional `cursor` and `type`
(`file|dir`). Arguments remain strict, with positive safe numeric IDs and no
coercion. Omitted `drive_id` selects the configured default drive, except
`kdrive_shared_with_me`, whose omission discovers received roots across drives.
An explicit drive never changes the default or causes fallback.

| Tool                    | Additional arguments                               | Ordered scopes                                                                                    |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `kdrive_list`           | Required `folder_id`; optional `drive_id`          | Exact authorized directory; direct children only                                                  |
| `kdrive_search`         | Required `query`; optional `drive_id`, `folder_id` | Explicit authorized directory, otherwise configured roots of the selected drive                   |
| `kdrive_recents`        | Optional `drive_id`, `folder_id`                   | Explicit authorized directory, otherwise configured roots of the selected drive                   |
| `kdrive_my_shared`      | Optional `drive_id`, `folder_id`                   | Explicit authorized directory, otherwise configured roots of the selected drive                   |
| `kdrive_shared_with_me` | Optional `drive_id`                                | Complete authorized received-root discovery order, optionally restricted to the exact owner drive |

Search `query` is an exact nonempty string of at most4096 UTF-8 bytes. It is
passed unchanged to the trusted normalized search port; no trim, case folding,
local matching, query expansion or global search-completeness claim is added.
Search/recents/my-shared entries can be the scope itself or any descendant;
list entries must be direct children and exclude the directory itself. Each
entry needs a compatible normalized ancestry/path within the exact requested
scope, in addition to existing configured-root, deny and capability checks.
Malformed/contradictory page evidence refuses; individually unauthorized entries
are omitted under existing policy behavior. Type filtering follows authorization.

Configured roots retain their resolved configuration order, including overlapping
roots; each root is completed before the next starts. A denied root is skipped
without a collection call or disclosing its identity. Recents and my-shared
therefore preserve root-local upstream order, with no claimed global chronology.
An explicit external drive requires an explicit authorized non-root directory
for list/search/recents/my-shared. External ID1 enumeration and implicit external
root search are refused. `shared_with_me` with opt-in disabled returns the empty
terminal result with zero received calls. Opt-in uses F-004's complete discovery
and fresh capabilities, preserves owner `drive_id`, excludes configured-drive
entries and never reveals owner paths guessed outside the received proof.

All eight tools have `readOnlyHint:true`, `destructiveHint:false`,
`idempotentHint:true`, `openWorldHint:true` and the F-005 untrusted-data notice.
No higher-level sharing projection is introduced in this feature.

### Normalized pages, budget and stopping

Add a private guarded page projection on the constructed policy facade; it is
not an MCP-supplied callback, operation grant or raw adapter escape. It accepts
only the existing collection kinds, exact trusted scope/query and an internal
upstream cursor. A request is invocation/listing-bound, echoes scope/kind/query
and requested cursor, and returns a dense array of at most256 raw entries plus
exactly one of `terminal:true` or a nonempty upstream `next` of at most4096 bytes.
An ordinary scoped nonterminal data page may have zero raw entries. This does
not alter F-004 discovery proof: empty nonterminal discovery pages and duplicate
received-root identities remain invalid and cannot create continuation.
Repeated/cyclic upstream cursors, contradictory envelopes and malformed entries
retain fail-closed validation. Cursor repetition is tracked within the exact
listing chain: tool/kind, owner drive, scope ID, exact query and root position.
Successive invocations resuming that chain share its history; another root or
fresh proof acquisition is a different chain and can legitimately reuse the
same opaque upstream token. SHA-256 fingerprints include an unambiguous encoding
of that chain identity and token, never a traversal-global token alone.
The old abstract check/dispatch contracts and terminal-only path projection do
not acquire a public cursor field. No upstream cursor reaches an MCP result.

For these five tools only, one counter wraps every actual start of
`children`, `collection`, received `list`, received `children` and received
`collection`. Cached reads consume zero list calls; `inspect` is not a list
call. The existing512 total-dependency and10000ms invocation limits also apply.
A sixth list-type port is never started. All upstream page bounds remain256;
no assumption that a real provider honors that page size is qualified here.

For ordinary scoped pages, process a whole page, validate/authorize/filter/dedup
it, then stop on the first page yielding any new visible items. Otherwise advance
through terminal scopes and empty/filtered pages until work is exhausted or five
list calls are used. This bounds one success batch at256 items without retaining
an unprocessed raw-page tail. A successful batch can be smaller than256.
No extra lookahead list call is made to prove a future visible result.

Received discovery is different evidence, not an authorization shortcut: the
existing F-004 route requires a complete snapshot before any membership can be
used. Its at-most-five-page acquisition can contain at most1280 entries and must
also satisfy F-004's smaller configured tree and sub-60-second cache bounds.
If a sixth proof page is needed, return `LIMIT_EXCEEDED`, invalidate the traversal
and expose no partial discovery or cursor. Once complete, retain only ordered
candidate identity pairs. A private paging consumer obtains those pairs from
the complete F-004 snapshot without calling the legacy eager discovery projection,
which inspects every root. It examines at most256 candidate pairs per invocation,
freshly authorizes those roots, emits at most256 items and resumes the bounded
candidate queue. Legacy dispatch/discover remains unchanged. Candidate pairs disclose
nothing before authorization; no old snapshot age is extended by continuation.
An expired membership cache may be reacquired only within the same five-call
counter. If proof acquisition consumes the remaining budget and a further data
page is needed, return empty success with continuation before starting that page.
An incomplete proof cannot itself become resumable authority.

The following applicability matrix governs the test cases; it does not weaken
any received proof requirement:

| Case                                           | `list`                                                      | `search`, `recents`, `my_shared`                                                        | `shared_with_me`                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Empty raw nonterminal data page                | Allowed; continue within budget                             | Allowed; continue within budget                                                         | Invalid discovery proof; refuse without cursor                                                              |
| Duplicate-only nonterminal data page           | Allowed; dedup and continue                                 | Allowed; dedup and continue                                                             | Duplicate discovery roots invalidate proof                                                                  |
| Empty batch after authorization/type filtering | Continue exact-scope data work                              | Continue data/root work                                                                 | Continue only remaining candidates from a complete snapshot                                                 |
| >1000 distinct identities                      | At least1001 direct children of one drive/folder over pages | At least1001 identities over ordered overlapping configured roots of one selected drive | At least1001 unique received roots in at most five complete discovery pages, then bounded candidate batches |
| Overlapping configured roots                   | Not applicable: one exact folder                            | Required across consecutive calls                                                       | Not applicable: received-root identities must be unique                                                     |
| Equal numeric ID on different drives           | Separate traversals demonstrate drive isolation             | Separate selected-drive traversals demonstrate isolation                                | One all-drive discovery demonstrates distinct owner pairs                                                   |
| Nonterminal fifth discovery page               | Refuse if required authorization proof is incomplete        | Same for external authorization proof                                                   | Refuse; no partial snapshot or continuation                                                                 |

Every success is exactly one text block encoding
`{items:[{drive_id,id,name,type,path}],has_more:boolean,next_cursor?:string}`.
`next_cursor` exists exactly when `has_more` is true. `has_more` means remaining
unprocessed upstream pages, roots or received candidate pairs; it promises no
visible result. It is false exactly when all such work is known exhausted.
Filtered empty batches can therefore have true. A fifth call returning terminal
on the last scope returns false, even with a full256-item batch; there is no
unconditional cap-based true. After a terminal scope, denied remaining scopes
may be checked without a list call to determine whether actual work remains.
Dedup is by owner drive and item ID, preserves the first emitted occurrence,
and spans consecutive successful calls in the same traversal. Unrelated fresh
calls start independent traversals. Same ID on different drives is distinct.

### Cursor identity, lifetime and failure

Use random runtime UUID handles in exact `v1.<lowercase-UUID>` form, never a
client-readable serialization of provider cursors, metadata or dedup IDs.
This randomness is handle identity, not a provisioned credential. State is
in-memory inside one controller instance, bound to its immutable preflight/policy
context. A new controller or a changed configuration/authentication composition
cannot reuse old handles. No disk, shared global store, dynamic config reload or
cross-session replay is introduced.

Bind each state to tool name, effective drive/scopes/query/type and its original
start time. All normal arguments must be repeated on continuation; equivalent
omitted/default `drive_id` is accepted after normalization. Any other argument
change refuses before a dependency call. Cursor strings must be nonempty and at
most128 UTF-8 bytes; wrong JSON types use existing `INVALID_ARGUMENTS`, while
malformed handle grammar, unknown version/handle, binding mismatch, eviction,
expiry, consumed handles and a foreign session use fixed `INVALID_CURSOR`.
No failure reveals which of these conditions occurred or echoes the cursor.

Absolute lifetime is300000 monotonic milliseconds from initial traversal start,
without renewal; exactly that boundary expires. Retain at most16 traversals per
session, evicting the least recently used inactive traversal when a new one is
created. One active invocation remains the existing global maximum. A traversal
retains at most8192 emitted identity pairs,8192 SHA-256 fingerprints of previously
followed, chain-namespaced upstream cursors and1280 received candidate pairs. Besides these bounded pairs,
retain only root position, effective arguments, current provider cursor and
scalar timestamps; no raw dependency objects or grants. Refuse
`LIMIT_EXCEEDED` before publishing a batch that would exceed a traversal bound.
No silent dedup eviction or success/exhaustion claim is permitted.

Continuation consumes its input handle on admission after schema/binding checks;
a successful nonterminal response issues a new handle for that traversal. A
replayed consumed handle fails, including after a lost response. Busy rejection
does not consume a handle. Initial calls need no client handle; a terminal
response releases its state. Timeout, cancellation, close, provider/policy error,
output limit or failure to publish releases the affected state; session close
releases all state. A failed call returns no partial items/new cursor. Existing
fixed error envelopes, input/output bounds and sanitized stderr continue to apply.

Each resumed page is a new guarded policy invocation. Re-evaluate scope, entry
ancestry/deny/capability evidence and received membership/cache age; do not cache
a grant or publish a buffered candidate's old metadata. Authorization denial of
a root skips it; malformed/changed proof fails generically. Received candidates
are re-inspected before emission; disappeared/denied candidates are omitted.
The traversal is not an atomic filesystem snapshot: concurrent provider changes
can omit newly inserted items or alter order. It guarantees no repeated emitted
identity, not account-wide completeness or provider cursor stability. An upstream
stale/error response yields fixed `ACCESS_DENIED` and invalidates local state.

### Metadata and records

All modes retain exactly F-005's five scalar metadata fields copied from the
current authorized normalized item. Unknown fields, arbitrary nested arrays or
objects, recipients, users, teams, sharelinks, tokens and provider errors never
enter output. No recursive denylist or dependency `toJSON`/getter call substitutes
for projection. Preserve F-005's sanitization, bounds and production CLI behavior.

BR-060 v2 replaces its four-tool count with eight; BR-065 v2 replaces terminal-only
collection delivery with bounded guarded continuation. Their rationale remains
unchanged and their canonical histories/tests cite F-006. F-005's other rules
retain their versions. Completion markers for accepted #8 are synchronized in
this PR; #9 rules/capability/changelog remain pending acceptance, and #6/#7
production blockers remain explicit.

## Acceptance criteria

Each named suite below runs through Docker/Make, with named BR unit tests and
an actual SDK stdio client check where indicated. Commands are planned checks,
not executed evidence. The full local gate remains `make check`.

- **AC-01** (BR-060 v2) — Given each mode, when listing tools through the real
  SDK stdio session, then exactly the eight declared read tools and annotations
  appear and no mutation/prompt/resource appears. Verified by:
  `tests/pagination-stdio.test.ts`, `TestBR060_v2_tool_registration`.
- **AC-02** (BR-065 v2) — Given the applicability matrix's valid empty raw,
  denied-only, type-filtered or duplicate-only ordinary data pages, when calling
  list/search/recents/my-shared, then work continues within budget and an empty
  batch can carry true plus a usable cursor. Given a complete received snapshot,
  when its next256 candidates all filter out but more candidates remain, then
  shared-with-me returns an empty batch with true; given empty nonterminal or
  duplicate-root discovery proof, it refuses without a cursor. Verified by:
  `tests/pagination.test.ts`, `TestBR065_v2_filtered_empty_is_not_exhaustion`,
  `TestBR065_v2_received_candidate_continuation` and proof-refusal cases.
- **AC-03** (BR-065 v2) — Given the fifth list call is terminal on the last scope,
  when it yields zero or256 visible entries, then `has_more:false` and no cursor
  are returned; given another root/page remains, true describes only work.
  Verified by: `TestBR065_v2_final_capped_page`, real stdio continuation.
- **AC-04** (BR-072) — Given roots A/B overlap and upstream order differs from
  name/time order, when search/recents/my-shared traverse them, then all A pages
  precede B with first-occurrence upstream order. Verified by:
  `TestBR072_configuration_order`, default/explicit-drive and query-echo tests.
- **AC-05** (BR-073) — Given proof traversal, discovery and data pages share an
  invocation, when the fifth starts, then no sixth list-type dependency starts;
  complete proof can defer data with a cursor, incomplete received proof refuses
  without one. Verified by: `TestBR073_all_list_ports_share_budget`, exact call
  spies and zero/sixth-call cases for all five tools.
- **AC-06** (BR-074) — Given each tool's compatible at-least1001-identity fixture
  from the applicability matrix, when following consecutive cursors to terminal,
  then the authorized union is exact and each pair appears once in first-occurrence
  order. Overlap/duplicate-page cases apply to ordinary configured collections;
  single-folder list uses repeated data pages, and received discovery uses unique
  complete-snapshot roots across owner drives. Given equal opaque cursor text on
  different scoped chains, both chains continue; given a same-chain cursor cycle
  across invocations, the traversal refuses without partial items/new cursor.
  Verified by: `TestBR074_large_overlap_continuation`, tool-specific large fixtures,
  `TestBR074_cursor_chain_namespace`, and invalid received-proof cases.
- **AC-07** (BR-075, BR-080) — Given a valid handle, when changing tool/query/type/
  drive/folder, using another session, replaying it or supplying malformed/versioned
  handles, then fixed `INVALID_CURSOR` occurs with zero dependency calls and no
  data echo; equivalent default-drive spelling succeeds. Verified by:
  `TestBR075_context_binding`, `TestBR080_invalid_handle`, real stdio tests.
- **AC-08** (BR-076, BR-080) — Given fake monotonic time and bounded state, when
  reaching expiry300000ms, creating traversal17 or exceeding any retained-data
  bound, then expiry/eviction refuses safely and overflow gives no partial
  success; boundary-minus-one cases succeed. Verified by:
  `TestBR076_state_bounds`, `TestBR080_expiry_and_eviction`.
- **AC-09** (BR-077) — Given a cursor and subsequently revoked capability,
  deny/scope change or expired received cache, when resuming, then current
  authorization is checked and stale metadata/grants never publish. Verified by:
  `TestBR077_reauthorize_continuation`, received-cache59/60-second boundaries.
- **AC-10** (BR-078) — Given malicious nested recipients/users/teams/links,
  unknown fields, getters and `toJSON` canaries in dependency objects, when each
  collection runs in read/write/share modes, then only five scalar metadata
  fields appear, unsafe accessors are not invoked and stdout/stderr contain no
  canary. Verified by: `TestBR078_fixed_projection`, actual stdio canary tests.
- **AC-11** (BR-079) — Given out-of-scope configured entries, indirect list children,
  external ID1, opt-out received discovery and valid/invalid received anchors,
  when invoking each applicable tool, then only current authorized scope members
  publish, opt-out performs zero received calls and owner drive IDs survive.
  Verified by: `TestBR079_collection_scope`, existing F-003/F-004 regression suites.
- **AC-12** (BR-081) — Given an admitted traversal, when cancellation, timeout,
  close, provider rejection, repeated upstream cursor or output failure occurs,
  then no partial batch/new cursor publishes, late calls cannot start and its
  old handle cannot resume; unrelated inactive traversals remain valid except
  on session close. Verified by: `TestBR081_invalidation`, real stdio lifecycle
  tests and unchanged F-005 diagnostic/package checks.

## Decisions

- Resolve D-04 locally: `has_more` denotes known unfinished work, with no promise
  of visible results. Reject result-count and unconditional five-call heuristics.
- Use session-owned opaque handles with finite lifetime and retained identities;
  reject exposed/base64 provider state, unbounded dedup, and cross-session grants.
- Stop after the first productive whole256-entry page rather than buffer raw
  tails or promise a full256-item batch. This keeps authorization and state small.
- Count all actual list-type proof/data calls together. Preserve complete F-004
  membership proof, failing boundedly when it cannot finish within five calls;
  reject partial received discovery as authority. This is a stated capacity
  limit, not a claim of complete provider share enumeration.
- Keep scalar metadata in share mode too; recipient/link schema work is excluded
  because #9 requires safe listings, not new disclosure behavior.
- Preserve default-drive selection, with the documented all-drive received-list
  exception; explicit scoped external search never means external-root search.
- Retain the injected-only delivery boundary accepted in #8. Provider qualification
  gaps do not block synthetic implementation or become invented provider guarantees.

## Open questions

None. Independent review and orchestrator freeze completed as recorded above.

## Stress-test

- **Round 1 R1, major — retained.** Independent review (archived evidence `runs/9-spec-review-1.md`)
  identified incompatible all-five-tool fixture assumptions. The applicability
  matrix and AC-02/06 now separate ordinary data pages from complete received
  proof/candidate batches, retain compatible >1000 fixtures for every tool, and
  require malformed/incomplete received proof refusal. A private snapshot
  candidate consumer avoids the legacy eager discovery's >512-inspection cost
  without changing F-004 proof, old dispatch or invocation limits.
- **Round 1 R2, minor — retained.** Cursor-cycle fingerprints now include exact
  listing-chain identity. AC-06 tests identical token text on different roots as
  valid and same-chain cycles across continuations as invalid.

- **Round 2 — approve.** Fresh independent reviewer approved exact SHA
  `59f462ff1e0444a5a55c3907676480d70baf8e75`; no finding remains. The
  orchestrator froze this v1 and notified the user; no contract changed here.

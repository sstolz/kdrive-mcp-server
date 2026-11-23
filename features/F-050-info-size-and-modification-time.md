---
id: F-050
title: Info size and modification time
ticket: "#75"
status: frozen
version: 1
---

## Context

A client requested a file's size and modification date during the
0.6.0-beta.1 smoke test. Milestone 1.1 commits to providing both through
`kdrive_info`; versioning the five-field projection is an already settled
owner decision. Users inspecting authorized files need bytes and a portable
UTC timestamp without downloading content or guessing from a filename.

[F-005](F-005-stdio-navigation.md) and [BR-063 v1](../business-rules/BR-063.md)
currently specify exactly `drive_id`, `id`, `name`, `type`, `path`.
`src/navigation.ts` returns the policy navigation projection directly.
`src/policy/index.ts` shares `NavigationItem` and `project()` with directory
entries, configured roots, path resolution and paginated collections.
`src/kdrive/normalize.ts` discards size and date; policy value normalization
also reconstructs items, so adding fields at the handler alone cannot work.
`src/kdrive/adapter.ts`'s content `describe()` already validates raw `size`
as a non-negative safe integer, but uses a content-specific zero fallback
and may download a range. That content contract is not the info contract.

The repository has no verified observation of the modification field's shape
or unit. The historical
[API notes](../docs/api-notes.md#modèle-de-fichier) list `last_modified_at`,
but give neither a value shape nor a unit. The curated
[observations](../docs/observations/kdrive-api.md) and
[read evidence](../docs/kdrive-read-evidence.md) do not qualify its conversion.
The public Infomaniak
[metadata API route](https://developer.infomaniak.com/docs/api/get/3/drive/%7Bdrive_id%7D/files/%7Bfile_id%7D)
was opened on 2026-11-23; its response table was not readable by the text
reader, so it supplies no verified field/unit guarantee here. The official
[Android File model](https://github.com/Infomaniak/android-kDrive/blob/main/app/src/main/java/com/infomaniak/drive/data/models/File.kt)
maps `last_modified_at` to an integer and multiplies it by 1000 for Java dates
(`lastModifiedAt`, `getLastModifiedInMilliSecond`). This supports the inference
of Unix seconds, but is client-source evidence, not an API guarantee or a
real-account verification of this feature. The chosen source is the metadata
response's `data.last_modified_at`, in whole seconds since the Unix epoch.
Other shapes yield `null`; no alternate field or unit is guessed.

This is full-path public-contract work. It is not classified as
security-sensitive: it adds two validated scalars to an already authorized
read and changes no authority, credential admission or trust boundary.
Projection and refusal regressions still require independent review.
This draft does not freeze or authorize implementation. The allocation ledger
reserves F-050 and BR-436–BR-437 for this ticket; ADR-013 remains free.
Recheck the ledger on main before freeze and PR creation.

## Scope

1. Extend only the successful `kdrive_info` item's projection to exactly seven
   fields, always present: `drive_id`, `id`, `name`, `type`, `path`,
   `size_bytes`, `modified_at`. Preserve `{item}` in the existing single JSON
   text result, input schema, annotations, error codes and transport behavior.
2. Carry only the two validated optional scalars from the configured-tree live
   `inspect()` and received live `inspect()` paths in `src/kdrive/adapter.ts`,
   through normalization and policy inspection. The configured-tree `inspect()`
   attaches them only when `location === "live"`; trashed inspections carry
   neither scalar. Keep shared `treeItem()` and
   `receivedItem()` normalization metadata-free for their other callers:
   list/collection, children, trash, resolve and received-list items acquire
   neither scalar. Attach the validated scalars only in those live inspection
   paths. Re-validate them in `src/policy/values.ts`'s `item()` and
   `src/policy/received.ts`'s `parse()`: `size_bytes` accepts only a BR-436
   non-negative safe integer or `null`; `modified_at` accepts only a string
   matching `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$` or `null`.
   Anything else becomes `null`. Publish them from the
   exact normalized live item authorized in that invocation, after existing
   terminal received-cache checks. Do not fetch separate unchecked metadata,
   call content `describe()`/download, use `execute` payloads, cache a grant,
   or infer authority from either scalar. Preserve getter/toJSON safeguards.
   Missing or invalid optional scalars do not invalidate otherwise complete
   identity/ancestry/capability evidence; invalid required evidence still refuses.
3. Keep the existing five-field `NavigationItem` projection for every other
   public output. Introduce a separate private info consumer port, exposed by
   `infoPolicy(policy, ref)` for exact constructed policy instances through a
   WeakMap, alongside the existing navigation port. It constructs the existing
   `{kind:"read", target:ref}` operation, runs `evaluate()`, then the existing
   terminal received check, and immediately projects the invocation's authorized
   live item to seven fields without an intervening application await. Only
   the `kdrive_info` handler uses this port. Keep `navigatePolicy()` and shared
   `project()` five-field, and leave `operation()`, `readKinds`, the read-mode
   gate, received capability mapping, `check()` and `dispatch()` unchanged.
   `kdrive_list`, `kdrive_search`, `kdrive_recents`, `kdrive_my_shared`,
   `kdrive_shared_with_me`, `kdrive_list_drives` roots and
   `kdrive_resolve_path` items retain their exact shapes, including resumed pages.
4. Read raw metadata `size` for files only. Accept a JavaScript number that is
   an integer in `0..9007199254740991`; emit that many bytes without coercion.
   Normalize numeric negative zero to `0`. Emit `null` for directories,
   including drive root ID 1, even if upstream supplies a numeric size.
   Do not sum descendants or replace unknown size with zero.
5. Read only raw `last_modified_at` for files and directories, including root
   ID 1 when present. Accept a numeric safe integer in
   `0..253402300799` inclusive (epoch through `9999-12-31T23:59:59Z`).
   Convert seconds to UTC and emit exactly `YYYY-MM-DDTHH:mm:ssZ`, with no
   fractional seconds or offset. Zero is `1970-01-01T00:00:00Z`; negative
   zero is equivalent. Reject negative, fractional, non-finite, unsafe and
   larger values to `null`. Do not parse numeric/ISO strings, treat milliseconds
   as seconds outside this range, round fractions, or fall back to `updated_at`,
   `created_at`, `revised_at` or the clock. Values within the range are always
   interpreted as seconds; no magnitude heuristic can establish another unit.
6. Absent, explicit null, wrong-type or out-of-range optional values become
   independent `null`s. Extra upstream data never reaches the response.
   Existing structural refusals for hostile dependency objects still apply;
   a getter is never evaluated to recover optional metadata.
7. Replace only `kdrive_info`'s F-042 purpose P with this exact trusted literal:
   `Gets authorized metadata for a file or folder. Returns JSON item with drive_id, id, name, type, path, size_bytes (bytes; null for folders or unknown size) and modified_at (UTC ISO 8601 to whole seconds; null when unknown). Use kdrive_read or kdrive_download for file content. No cursor.`
   Keep the existing name prefix, notice N and all other catalog text and
   budgets. Update the independent catalog expectation. No output schema is
   present anywhere in `src/` (checked on `7ec6709`); do not add a new schema
   contract. Correct README's blanket
   five-field statement to distinguish info from all other item outputs and
   document source units, range, null semantics and real-account uncertainty.
   Historical F-005/F-042 specs and past evidence remain unchanged; this
   feature and BR versions record the explicit exceptions.
8. In the implementation PR, prepare BR-063 v2, BR-436–BR-437 v1 and BR-428 v2
   with dated history and test mappings, their indexes, a provisional capability
   entry and one `Unreleased/Added` changelog entry, pending acceptance.
   Preserve accepted versions until actual-main acceptance. Synchronize final
   markers in the next reviewed PR. No VERSION, release, tag or ADR is needed.
9. Prepare a bounded read-only acceptance operator and its documented owner
   command: `scripts/kdrive-info-acceptance.ts`, invoked by the planned
   `make kdrive-info-acceptance` target. Follow the existing
   `scripts/kdrive-acceptance.ts` / `make kdrive-acceptance` pattern in the
   Makefile, using `scripts/kdrive-entry.sh` and its launcher/transport
   conventions.
   Inputs identify one owner-designated authorized file of independently known
   size and modification time and one authorized folder, plus an optional
   owner-designated authorized received-share item. Apply the same comparisons
   and per-item bounds to that item when present. Run the same entry
   path end to end against the synthetic kDrive first; no fixture creation or
   mutation on a real account. Compare the upstream scalars with tool output,
   with at most one explicit direct metadata read and one info call per item
   (existing bounded authorization reads remain in force). Raw values and
   identifiers stay with the owner; print only bounded sanitized assertions.
   After an owner run on actual main, record date, method, field, numeric shape,
   seconds unit, conversion outcome and evidence link in
   `docs/observations/kdrive-api.md`. A missing field records an inconclusive
   observation and does not count as successful non-null date qualification.
   If no received-share item is available, record unverified real-account
   received-share metadata as a residual risk in that observation entry;
   synthetic received-share coverage remains mandatory.

### Out of scope

- New metadata in collections, roots, path resolution, content descriptors,
  read/download responses, mutation results, resources or audit events.
- Folder aggregate sizes, MIME types, creation dates, permissions, alternate
  date fields, version/ETag guarantees or atomic filesystem snapshots.
- New configuration, credentials, upstream routes, retries or access rights;
  fixing unrelated normalization or real-provider compatibility problems.
- Real-account execution by the spec author, installation, Docker, tests or
  code in this phase. This phase writes only this draft and its index entry;
  no BR record is written yet.

## Business rules

- **BR-063 v2** — Successful info output contains exactly `drive_id`, `id`,
  `name`, `type`, `path`, `size_bytes`, `modified_at` from the exact authorized
  normalized live item; all other
  navigation item outputs retain the five-field projection and existing
  authority/refusal safeguards. Verified by: AC-01, AC-04–AC-06.
- **BR-436 v1** — Info `size_bytes` equals raw `size` only for files with a
  numeric non-negative safe integer, with negative zero normalized to zero;
  otherwise it is `null`, including every directory. Verified by: AC-01–AC-02,
  AC-05, AC-08–AC-09.
- **BR-437 v1** — Info `modified_at` converts only numeric whole Unix seconds
  from `last_modified_at` in `0..253402300799` to the specified UTC string for
  files and directories; every other optional value yields `null`.
  Verified by: AC-01, AC-03, AC-05, AC-08–AC-09.
- **BR-428 v2** — Every registered tool retains F-042 v1's exact description
  composition and catalog except for info purpose P, replaced by Scope 7's
  literal; mandatory notices and all catalog budgets remain unchanged.
  Verified by: AC-07.

## Acceptance criteria

All test names below are implementation targets, not existing passing tests.
Tests cite these exact BR versions. The orchestrator runs characterization
tests against the unchanged base, then observes the new contract tests fail
before implementation; it runs `make check` and CI after implementation.

- **AC-01 (BR-063 v2, BR-436 v1, BR-437 v1)** — Given an authorized file
  with size 16 and `last_modified_at: 0`, when info runs, then its JSON text
  contains exactly the seven fields, with `size_bytes:16` and
  `modified_at:"1970-01-01T00:00:00Z"`, and unchanged identity/path values.
  Verified by `tests/navigation.test.ts`,
  `TestBR063_v2_info_seven_fields`, and `tests/navigation-stdio.test.ts`,
  `TestBR063_v2_info_sdk_wire_projection` through the production SDK path.
- **AC-02 (BR-436 v1)** — Given raw sizes 0, negative zero, 1, MAX_SAFE_INTEGER,
  MAX_SAFE_INTEGER+1, -1, 0.5, NaN, both infinities, missing, null, strings,
  booleans, arrays and objects, when file metadata is normalized and info runs,
  then only the first four produce their non-negative integer sizes; every
  other size is null. Given those sizes on a directory or root 1, every
  size is null. Verified by `tests/kdrive/adapter-normalize.test.ts`,
  `TestBR436_v1_size_boundaries`, and `tests/navigation.test.ts`,
  `TestBR436_v1_info_size_nullability`.
- **AC-03 (BR-437 v1)** — Given timestamps 0, negative zero, 1, 253402300799,
  -1, 0.5, 253402300800, MAX_SAFE_INTEGER, an unsafe integer, NaN, infinities,
  missing, null, numeric/ISO strings, booleans, arrays and objects, when file,
  folder and root metadata are normalized and info runs, then the first four
  yield respectively epoch, epoch, `1970-01-01T00:00:01Z` and
  `9999-12-31T23:59:59Z`; all others yield null without throwing. Alternate
  date fields cannot fill an absent/invalid `last_modified_at`.
  Verified by `tests/kdrive/adapter-normalize.test.ts`,
  `TestBR437_v1_timestamp_boundaries`, and `tests/navigation.test.ts`,
  `TestBR437_v1_info_dates_and_no_fallback`.
- **AC-04 (BR-063 v2)** — Given the same authorized items with valid optional
  metadata, when all collection tools, resumed pages, path resolution and
  drive-root enumeration run, then their item keys and envelopes equal the
  pre-change five-field baselines. At the adapter boundary, list/collection,
  children, trash, resolve and received-list items carry neither new scalar,
  even when their upstream metadata contains valid values. Configured-tree
  `inspect()` attaches scalars only for `location === "live"`; trashed
  inspections carry neither scalar. Verified by
  `TestBR063_v2_non_inspect_metadata_absent` in
  `tests/kdrive/adapter-normalize.test.ts` and
  `tests/kdrive/adapter-received.test.ts`, and by characterization tests
  `TestBR063_v2_non_info_projection_unchanged` in
  `tests/navigation.test.ts` and `tests/pagination.test.ts`; run these on the
  unchanged base before adding the info-specific failing tests.
- **AC-05 (BR-063 v2, BR-436 v1, BR-437 v1)** — Given configured-tree and
  authorized received-share files/folders with valid, independently malformed
  and absent optional scalars, when metadata flows through the real adapter,
  policy and controller, then info follows the same rules in both namespaces;
  malformed size preserves a valid date and vice versa. No download or execute
  call occurs and optional metadata adds no upstream requests. Verified by
  `tests/kdrive/adapter-normalize.test.ts`,
  `TestBR436_v1_optional_metadata_preserves_required_evidence`, and
  `tests/kdrive/adapter-received.test.ts`,
  `TestBR063_v2_received_info_metadata_end_to_end`.
- **AC-06 (BR-063 v2)** — Given denied, missing, mismatched-ID, stale received
  proof or incomplete required evidence, when info runs, then it returns the
  existing refusal without size/date. Given hostile extras, accessors, toJSON
  or execute canaries, none is executed or serialized; successful output has
  no eighth key. Given a policy dependency injecting objects, arbitrary strings
  or wrong types as optional scalars, `item()` and `parse()` re-validate them
  against Scope 2 and replace invalid values with `null`, without leaking them
  in info output. The info port refuses an unconstructed policy instance;
  ordinary navigation reads still have exactly five fields. Info operation
  kinds or projection flags sent to `check()`/`dispatch()` retain their existing
  rejection, and read-mode and received-share capability decisions match the
  unchanged read baselines. Verified by `tests/navigation-boundaries.test.ts`,
  `TestBR063_v2_info_authority_and_hostile_fields`, retaining the existing
  `BR-063 getters and toJSON are never executed and raw provider errors never escape`
  regression with its new info expectation. Existing cancellation/deadline
  regressions in `tests/navigation-lifecycle.test.ts` remain required.
- **AC-07 (BR-428 v2)** — Given read/write/share catalogs, when tools/list is
  obtained, then only info P changes to Scope 7's literal; notices, parameters,
  annotations, all other descriptions and four F-042 size budgets remain
  unchanged. Given current README guidance, then it documents all seven info
  fields, independent nulls, folder semantics and the unchanged other outputs.
  Verified by `tests/tool-descriptions.test.ts`,
  `TestBR428_v2_info_metadata_description_and_docs`, the existing
  `TestBR428_AC01_all_registered_tool_descriptions` with updated expected P,
  and the existing F-042 budget/notice assertions.
- **AC-08 (BR-436 v1, BR-437 v1)** — Given a synthetic file of known size and
  timestamp, a folder and optional received-share item (both present and absent
  cases), when the planned `make kdrive-info-acceptance` owner command invokes
  `scripts/kdrive-info-acceptance.ts` through its
  real launcher and injected test-double transport, then it compares raw
  metadata and info end to end within Scope 9's bounds. Missing/wrong-shaped
  date produces an inconclusive qualification, mismatched conversion fails,
  and neither case reports successful real qualification. Verified by
  `tests/kdrive/info-acceptance.test.ts`,
  `TestBR437_v1_owner_procedure_rehearsal` and
  `TestBR436_v1_owner_procedure_bounds_and_redaction`; the implementation PR
  records the exact command and successful rehearsal before requesting a run.
- **AC-09 (BR-436 v1, BR-437 v1)** — Given successful rehearsal and designated
  real-account items, when the owner runs `make kdrive-info-acceptance`
  (`scripts/kdrive-info-acceptance.ts`), rehearsed in AC-08, on the actual
  merged main SHA, then known file size and whole-second modification time
  match the upstream values and info conversion, folder size is null, and
  Scope 9's sanitized observation is recorded. If a designated received-share
  item is available, compare its raw scalars and info output under the same
  rules and bounds; otherwise the observation explicitly records the residual
  risk of unverified real-account received-share metadata. Its absence alone
  does not block acceptance. Verified by `make kdrive-info-acceptance`,
  rehearsed in AC-08, and a ticket acceptance comment with SHA,
  command, results and evidence identifier; the observation links that comment.
  This remains unverified until that run. An unsupported real shape is recorded
  as such, keeps the output null and leaves this AC and ticket acceptance open;
  changing the source contract requires a reviewed new spec version.

## Decisions

- Keep BR-063's purpose and version it to v2; allocate BR-436 for size and
  BR-437 for timestamp validation. Retain fixed keys and explicit nulls rather
  than omitted fields or arbitrary raw metadata, so clients can distinguish
  unknown values from zero without new upstream leakage.
- Keep the proposed names, bytes unit and UTC second precision. Choose null
  folder size instead of zero or recursive totals; accept folder modification
  time under the same validation as files. Choose epoch through year 9999 to
  retain a fixed four-digit year; reject fractional seconds rather than round.
- Choose `last_modified_at` in numeric Unix seconds, supported by the official
  client source. Reject alternate names, coercion and unit guessing. Historical
  notes mention the field, but neither they nor the unreadable API page verify
  its shape/unit on a real account.
  Rehearsal proves implementation only; AC-09 separately qualifies reality.
- Choose a separate WeakMap-backed `infoPolicy(policy, ref)` consumer port as
  specified in Scope 3. Reuse the existing read evaluation and terminal checks
  so the authority surface stays unchanged. Reject making every navigation
  `read` seven-field: configured roots and resolve anchors also use that path.
  Reject a new operation kind: it would change the operation registry, read-mode
  gate and received capability mapping. Reject caller-selected projection flags
  on operation objects: they would widen the strict operation contract. Reject
  post-authorization metadata fetching: it would bypass the exact authorized
  live evidence and add requests. Leave content `describe()` untouched.
- Attach optional metadata only in the two live adapter `inspect()` paths.
  Reject adding it to shared `treeItem()`/`receivedItem()` results because those
  helpers also serve collections, children, trash, resolve and received lists.
- Include an optional received-share item in the rehearsed owner procedure.
  Its absence records a residual risk rather than blocking acceptance because
  real-account share availability is optional; synthetic coverage is required.
- Also version BR-428 to v2 because its existing rule pins F-042's exact
  catalog text; silently changing that text would violate an active contract.
  Only info P is replaced. No new ADR: this is a narrow extension of the
  existing guarded projection, not a new architecture or upstream service.

## Open questions

## Stress-test

- 75-spec-review-1-opus finding 1 (major) — retained — Chose a separate
  WeakMap-backed info consumer port using existing read evaluation and terminal
  checks. Scope 3, Decisions and AC-06 preserve five-field navigation reads and
  the operation, mode and capability contracts; rejected alternatives and their
  reasons are explicit.
- 75-spec-review-1-opus finding 2 (minor) — retained — Scope 2 limits scalar
  attachment to the two live adapter inspect paths; shared normalizers stay
  metadata-free for other callers. AC-04 asserts no new scalars on collection,
  children, trash, resolve or received-list items, including adapter evidence.
- 75-spec-review-1-opus finding 3 (minor) — retained — BR-063 v2 explicitly
  names all seven output fields.
- 75-spec-review-1-opus finding 4 (minor) — retained — Scope 7 records that no
  output schema exists in src/ as checked on 7ec6709 and removes the conditional
  schema amendment.
- 75-spec-review-1-opus finding 5 (minor) — retained — Scope 9 and AC-09 add an
  optional received-share observation and require an explicit residual risk
  when absent; AC-08 rehearses both availability cases.
- 75-spec-review-1-opus finding 6 (minor) — retained — Context and Decisions
  state repository evidence and allocation status directly, removing references
  to task provenance. The index entry contains no such references.
- 75-spec-review-2-opus finding 1 (minor) — retained — Scope 2 requires
  `item()` and `parse()` to re-validate size and timestamp scalars; AC-06 adds
  policy-dependency injection of objects, arbitrary strings and wrong types.
- 75-spec-review-2-opus finding 2 (minor) — retained — Scope 2 and AC-04
  explicitly restrict configured-tree scalar attachment to `location === "live"`
  and require trashed inspections to carry neither scalar.
- 75-spec-review-2-opus finding 3 (minor) — retained — Scope 9 and AC-08/AC-09
  name the planned `scripts/kdrive-info-acceptance.ts` operator and
  `make kdrive-info-acceptance` target, following the verified existing
  `scripts/kdrive-acceptance.ts` / `make kdrive-acceptance` launcher pattern.
- 75-spec-review-3-opus optional note — rejected — the policy pattern alone
  accepts calendar-invalid strings such as `2026-13-45T25:61:61Z`. The adapter
  conversion (Scope 5) emits only valid instants, so the policy check is
  defense in depth against a faulty dependency; v1 keeps the pattern check
  only, as a documented residual risk.

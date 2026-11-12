---
id: F-017
title: Controlled folder creation, rename, move, trash and restore
ticket: "#18"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-10.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `7fc5198` (origin/main).
IDs: F-017 and BR-260–BR-278 are the next unused IDs per `ls features
business-rules` on that base; re-check before freeze and before the PR.

## Context

Ticket #18 (P-18, milestone 0.4) delivers the first five write tools:
`kdrive_create_folder`, `kdrive_rename`, `kdrive_move`, `kdrive_trash` and
`kdrive_restore` ([SPEC.md §6](../SPEC.md), §10.4, §10.5).

What already exists on the base:

- The F-016 mutation gate (BR-234–BR-259): admission, one policy decision
  through the shared guarded facade, durable intent, one mutator per operation
  kind, 429-only retry, `uncertain` without replay, outcome record. Its mutator
  registry is empty and the production mutation port (non-GET transport) was
  deferred to #18 (F-016 D-16-11, Out of scope), which must honour the port
  contract: `NotSent` only when no request byte was written.
- The F-003 policy core derives every mutation effect (BR-035), traverses
  descendants when denies are nonempty (BR-036, BR-037) and already accepts
  `original-trash` source evidence for restore (BR-039). The F-014 adapter
  returns `unavailable` for `original-trash` and for `execute` (BR-200), and
  issues only `GET` requests (BR-190).
- #16 measured the write routes and trash metadata
  ([evidence](../docs/kdrive-write-evidence.md),
  Stage A (archived evidence `runs/16-execution-A-1.md`), Stage B (archived evidence `runs/16-execution-B-1.md`)).
  The owner chose restore option A
  (decisions (archived evidence `runs/16-decisions-1.md`)): restore only when the trashed
  item's former parent is live and authorized, otherwise refuse, because the
  server recreates a trashed former parent (new ID) at the former path.
- Spec review round 1 (orchestrator decision): `kdrive_trash`,
  `kdrive_rename` and `kdrive_move` are denied on any configured root ID
  (BR-278).

Users affected: operators who enable `write` (they get the five tools under
the existing policy and audit), MCP clients and their users (they can
organize a drive and are told when a result is unknown), and the authors of
#19–#20 (they reuse the mutation port of this feature).

## Scope

1. Five MCP tools with strict schemas, annotations, fixed descriptions and
   registration in `write` and `share` modes only (BR-060 v5, BR-260–BR-263),
   with configured roots protected from trash, rename and move (BR-278).
2. Five mutators registered in the F-016 gate, one per operation kind
   `create`, `rename`, `move`, `trash`, `restore` (BR-271–BR-274).
3. The production mutation port: non-GET requests in the kDrive transport on
   five fixed routes (BR-190 v2, BR-266–BR-270).
4. Restore evidence: `inspect` with location `original-trash` from the trash
   metadata plus the live former parent (BR-264, BR-265); restore to the
   original location only, with the destination derived by the policy core
   (BR-039 v2); trashed-tree enumeration stays unavailable (BR-200 v2).
5. Owner-run real-API acceptance in one designated folder (BR-276).
6. README and `SECURITY.md` text for the five tools (BR-277).
7. Pending records: BR-260–BR-278, versioned BR-039, BR-060, BR-190, BR-200
   records with a History line (the BR-039 line names the F-003 amendment),
   capability-map entry marked provisional, CHANGELOG line under Unreleased,
   BACKLOG lines of Decisions, and the planned `SECURITY.md` residual-risk
   line R-17-1 (BR-277).

### Versioned rules

- **BR-039 v2** (was v1: restore requires original-trash proof, authorized
  destination/result effects, no server-side substitute) — A restore operation
  carries only `target`; the policy core takes its destination as the
  immediate parent of the original-trash evidence (root `1` when the original
  chain is the root sentinel only), inspects it as `live`, and requires the
  original-trash membership/path proof, an authorized live directory
  destination whose ID and path equal that immediate parent's, and an
  authorized result path; any difference between the two reads is `denied`;
  a restore operation with `destination` or `name` is refused
  `INVALID_OPERATION`; no server-side substitute for missing trash evidence is
  stored. This amends F-003's evidence contract: the original parent chain is
  the former parent's chain as read live at restore time (BR-264), not a
  deletion-time record, and F-003's sentences "Original parent fields describe
  their identities and paths at deletion" and "Future restore evidence must
  include the original full chain" no longer apply to it; the BR-039 History
  line records this amendment. Verified by: AC-07.
- **BR-060 v5** (was v4: every mode registers exactly the ten read tools and
  no mutation tool) — Mode `read` registers exactly the ten declared read
  tools; modes `write` and `share` register exactly those ten plus
  `kdrive_create_folder`, `kdrive_rename`, `kdrive_move`, `kdrive_trash` and
  `kdrive_restore`; every mode registers the single existing complete-binary
  resource template and no prompt or enumerated resource. Verified by: AC-01.
- **BR-190 v2** (was v1: only `GET` requests on the fixed route table) — The
  adapter issues only the method/route pairs of the Route table below: `GET`
  on the F-014 routes and on the trash-metadata route, and `POST` or `DELETE`
  only on the five mutation routes, all to origin `https://api.infomaniak.com`
  port 443, IDs rendered as decimal positive safe integers, query values
  encoded by `URLSearchParams`, `Authorization: Bearer <token>` on that origin
  only. Verified by: AC-10.
- **BR-200 v2** (was v1: `original-trash` inspect and every `execute` return
  `unavailable`) — `children` with location `original-trash` and the adapter's
  own `execute` return `{status:"unavailable"}` without any upstream request;
  production binds the policy `execute` to the gate (BR-256 unchanged).
  Verified by: AC-09.

### Out of scope

- `kdrive_upload` (#19), sharing tools (#20), the `batch` kind (no mutator).
- Restore to an explicit destination (`destination_directory_id` is
  unmeasured; BACKLOG line of 2026-11-04), restore of an item whose former
  parent is not live (owner decision A), and trashed-tree enumeration, so a
  directory restore with a nonempty deny list is refused (D-17-4).
- Move combined with a rename (`name` on `move`), cross-drive move, copy,
  duplicate, permanent deletion, emptying the trash, the cancel route of a
  cancellable action.
- Received-share mutations: every received mutation predicate stays `false`
  (BR-204 v1, F-016 D-16-4), so they are denied.
- Any read-back, reconciliation or compensation after a write; startup
  reconciliation of unfinished intents (F-016 Out of scope).
- Changes to the gate contract (F-016), the audit schema (BR-234), the
  navigation lifecycle (BR-258) or the configuration inventory (F-002).

## Business rules

All new rules are version 1 and `pending acceptance`.

### Tools

- **BR-260** — Each of the five tools accepts exactly the arguments of the
  Tool table below (strict objects, IDs and `drive_id` positive safe integers,
  `name` a valid F-003 single path component with no leading or trailing
  whitespace (JavaScript `\s`)), and builds
  exactly the listed operation with `drive_id` defaulting to the configured
  default drive; any other argument set returns `INVALID_ARGUMENTS` with zero
  gate runs, zero records and zero upstream requests. Verified by: AC-02.
- **BR-261** — Each of the five tools carries `readOnlyHint:false`,
  `idempotentHint:false`, `openWorldHint:true`, and `destructiveHint:true` for
  `kdrive_trash` only (`false` for the other four). Verified by: AC-01.
- **BR-262** — A call to one of the five tools makes exactly one navigation
  `mutate` call with the tool name, the built operation, the session identity,
  the call signal and no payload, and returns one text content item holding
  the JSON of the gate result (BR-255), with `isError` false only when
  `result` is `succeeded`. Verified by: AC-03.
- **BR-263** — Each tool description contains the fixed sentences of the Tool
  table for that tool and the sentence `If the result is uncertain, verify the
  item's state with a read tool before any new attempt.` Verified by: AC-01.

### Restore evidence

- **BR-264** — `inspect(target, "original-trash")` issues one `GET` on the
  trash-metadata route and, when the item's `status` is `trashed`, then one
  `GET` on the item route for its `parent_id`; it returns complete
  original-trash evidence (location `original-trash`, lifecycle `trashed`,
  `treeRootId` equal to the target ID, the trashed item's ID, type and name,
  `path` equal to the trash `path`, and as original parent chain the
  normalized live chain of the former parent followed by the former parent)
  only when that former parent normalizes as a complete live directory
  (BR-198, BR-199 v2) and the trash `path` equals the former parent's path
  joined with the item's name. Verified by: AC-08.
- **BR-265** — `inspect(target, "original-trash")` returns
  `{status:"missing"}` for a trash-metadata 404 `object_not_found`, and
  `{status:"incomplete"}` without the second `GET` when the trash `status` is
  not exactly `trashed` (`trash_inherited` included), the metadata has a
  `drive_id` member different from the requested drive, or it lacks a valid
  ID equal to the target, type, name, positive `parent_id` or canonical
  `path`; it returns `{status:"incomplete"}` when the former parent is missing,
  trashed, not a directory, not normalizable, or its joined path differs from
  the trash `path`. Verified by: AC-08.

### Mutation port

- **BR-266** — Each mutation request opens a new TLS connection through the
  BR-191 address policy and the BR-216 v2 `connect`, carries no other
  request, sends `Connection: close` and an explicit `Content-Length`, sends a
  body only for `create` and `rename` (`Content-Type: application/json`, the
  bytes of `JSON.stringify({name})`), and never follows a redirect. Verified
  by: AC-10.
- **BR-267** — A mutation request that fails before its connection's TLS
  handshake has completed (queue full, abort while queued, DNS failure,
  BR-191 address refusal, TCP connect or TLS failure) rejects with the gate's
  branded `NotSent`; any failure from the completed handshake on (write
  error, socket close, timeout, abort, truncated status line or headers)
  rejects with an unbranded `Error` whose message is exactly
  `MUTATION_UNKNOWN`. Verified by: AC-11.
- **BR-268** — Once the status line and headers are received, the port
  returns `{status, retryAfter?, body?}`, where `retryAfter` is the raw
  `Retry-After` text only when it is at most 32 bytes and `body` holds the
  bytes of a 2xx body only when it is complete within the BR-194 limits; a
  non-2xx body is discarded after at most 8 KiB. The port never parses or
  validates a body: the mutator alone does, and returns the gate reply
  `{outcome:"response", status, retryAfter?, accepted, value?, created?}`
  with `accepted:true` only when `body` is present, is JSON with `result`
  equal to `success`, and its `data` passes the kind's check (BR-272,
  BR-273); any other 2xx gives `accepted:false`. Verified by: AC-12.
- **BR-269** — A mutation request has no adapter deadline other than the
  gate's attempt signal (BR-249); that signal's abort destroys the socket at
  once and the request rejects under BR-267. Verified by: AC-11.
- **BR-270** — The route table contains no route that permanently deletes an
  item or empties the trash, and no tool, mutator or acceptance step can issue
  a `DELETE` on a path containing `/trash`. Verified by: AC-10.

### Mutators

- **BR-271** — Each registered mutator sends exactly one request per attempt,
  on the route of the Route table for its kind, with the operation's IDs, and
  no other request (no read-back); the `restore` request has no body and no
  `destination_directory_id`. Verified by: AC-10, AC-13.
- **BR-272** — The `create` check accepts a `data` file object whose `id` is a
  positive safe integer, `type` is `dir`, `name` equals the requested name and
  `parent_id` equals the destination ID; the mutator then returns `created`
  equal to that `id` and `value` `{drive_id, id}` with the new ID. Verified
  by: AC-12.
- **BR-273** — The `rename`, `move`, `trash` and `restore` check accepts a
  `data` object whose `cancel_id` is a string of 1–256 bytes and `valid_until`
  is a finite number; the mutator then returns `value` `{drive_id, id}` with
  the target ID, and no result, record or diagnostic contains the
  `cancel_id`. Verified by: AC-12.
- **BR-274** — The production composition registers exactly the mutators for
  `create`, `rename`, `move`, `trash` and `restore`; a run of any other kind
  is refused at admission (BR-245). Verified by: AC-04.

### Structural denials

- **BR-275** — `kdrive_move` has a single `drive_id` for its source and
  destination, and a move operation whose source and destination evidence
  carry different drive IDs is denied with zero intent records and zero
  mutation requests. Verified by: AC-02, AC-06.
- **BR-278** — The policy core denies (`ACCESS_DENIED`) a `trash`, `rename`
  or `move` operation whose `(drive_id, target ID)` pair equals any
  configured root pair (root `1` included), so the gate returns `denied` with zero intent records and zero
  mutation requests; this replaces F-003's sentence "A non-root configured
  root can be renamed". Verified by: AC-06.

### Acceptance and documentation

- **BR-276** — `make kdrive-write-acceptance` runs only on an actual main
  checkout (BR-215 v2 definition) inside the dev Compose service, reads the
  token through BR-212, requires `KDRIVE_WRITE_FOLDER` (a positive decimal
  folder ID) and refuses before any Docker command without it, configures the
  server with mode `write` and that folder as the only root, runs the two
  phases of the Acceptance sequence below (deny list empty, then
  `**/*-deny*`) with at most 200 upstream requests within 600,000 ms, writes the audit log to a container temporary
  file, and prints only a sanitized summary (per-step pass/fail, statuses,
  request counts by method and route template, durations, main SHA) with no
  ID, name, path, token or `cancel_id`. Verified by: AC-15.
- **BR-277** — The README and `SECURITY.md` state that the five tools exist
  only in `write` and `share` modes, that this server never requests
  permanent deletion (BR-270), that restore returns an item only to its former
  parent when that parent is live and authorized and refuses otherwise, that
  a folder restore is refused when deny patterns are configured, that
  received-share writes stay refused, that configured roots cannot be
  trashed, renamed or moved (BR-278), and that a check-then-act window remains
  (SPEC §10.6), including a former parent trashed between the check and the
  restore (when that former parent is a configured root, the folder the
  server recreates has a new ID outside every configured root), and an item
  trashed between the check and a trash request, whose effect under
  `DELETE /2/drive/{d}/files/{f}` is unmeasured. They also state residual risk R-17-1: restore authorizes the
  former parent's current path, so an item trashed under a denied folder that
  is renamed or moved out of the deny patterns outside this server can be
  restored. The implementation PR includes R-17-1; the records PR after
  acceptance keeps it when Acceptance step 6 shows `succeeded` (trash `path`
  recomputed) and narrows it to "not observed on the measured server" when
  step 6 shows `denied` (snapshot); a `succeeded` restore that lands
  anywhere other than under `G2` with the same ID, or that recreates `G`,
  fails acceptance; any other step-6 result keeps R-17-1 unchanged and is
  recorded as unmeasured. They also state residual risk
  R-17-2: BR-278 protects only a configured root targeted directly, so with
  nested roots, trashing, renaming or moving an authorized folder of an outer root
  that contains an inner configured root also affects that inner root, and
  with nonempty denies the trashed folder cannot be restored through this
  server (D-17-4). Verified by: AC-16.

## Contract details

### Tool table (BR-260, BR-263)

| Tool                   | Arguments                                           | Operation                                                                |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `kdrive_create_folder` | `drive_id?`, `parent_id`, `name`                    | `{kind:"create", destination:{driveId, id:parent_id}, name, type:"dir"}` |
| `kdrive_rename`        | `drive_id?`, `file_id`, `name`                      | `{kind:"rename", target:{driveId, id:file_id}, name}`                    |
| `kdrive_move`          | `drive_id?`, `file_id`, `destination_folder_id`     | `{kind:"move", target, destination:{driveId, id:destination_folder_id}}` |
| `kdrive_trash`         | `drive_id?`, `file_id`                              | `{kind:"trash", target}`                                                 |
| `kdrive_restore`       | `drive_id?`, `file_id`                              | `{kind:"restore", target}`                                               |

Fixed description sentences:

- `kdrive_create_folder`: `Creates a folder in an authorized folder.`
- `kdrive_rename`: `Renames a file or folder in place; the current and
  resulting paths, and a folder's descendants, are checked.`
- `kdrive_move`: `Moves a file or folder to another folder of the same drive;
  the current and resulting paths, and a folder's descendants, are checked.`
- `kdrive_trash`: `Moves a file or folder to the kDrive trash; it never
  deletes permanently. A trashed folder cannot be restored through this
  server while deny patterns are configured.`
- `kdrive_restore`: `Restores a trashed item to its former folder only when
  that folder is live and authorized; otherwise the restore is refused. A
  folder restore is refused while deny patterns are configured.`

### Route table (BR-190 v2, BR-271)

The F-014 GET routes are unchanged. Added routes:

| Kind / use     | Method   | Template                               | Body       |
| -------------- | -------- | -------------------------------------- | ---------- |
| trash metadata | `GET`    | `/3/drive/{d}/trash/{f}` `with=path,parents,capabilities` | none |
| `create`       | `POST`   | `/3/drive/{d}/files/{f}/directory`     | `{name}`   |
| `rename`       | `POST`   | `/2/drive/{d}/files/{f}/rename`        | `{name}`   |
| `move`         | `POST`   | `/3/drive/{d}/files/{f}/move/{p}`      | none       |
| `trash`        | `DELETE` | `/2/drive/{d}/files/{f}`               | none       |
| `restore`      | `POST`   | `/2/drive/{d}/trash/{f}/restore`       | none       |

For `create`, `{f}` is the destination folder; for `move`, `{p}` is the
destination folder. The `onRequest` observer (BR-216 v2) receives the method
and template of every request. Mutation requests share the BR-195 slots and
queue; a 401/403 response is reported under BR-217 v2.

### Acceptance sequence (BR-276)

Every name is `p18x-<run>-<letter>`, a per-run prefix that cannot occur in
other fixture names (learnings 2026-11-04); `<n>-deny` names match the deny
pattern `**/*-deny*`. All items live under `KDRIVE_WRITE_FOLDER` (root R). A
"zero writes" step sends no non-GET request.

Phase 1, deny list empty (a folder restore needs no enumeration, D-17-4):

1. Create `A`, `B`, `F` in R, `C` in `A`, `X-deny` in `C`, `E` in `B` →
   each `succeeded` with a `created` ID in its outcome record.
2. Rename `F` to `F2`, then move `F2` into `B` → `succeeded`; `kdrive_info`
   shows the new path.
3. Rename `B` to the name of `A` → `failed`, `UPSTREAM_REJECTED`, 409.
4. Move `A` into `C` (its own descendant) → `denied`, zero writes.
5. Trash `E`, then trash `B`; restore `E` → `denied` (former parent
   trashed), zero writes; restore `B` → `succeeded`, `kdrive_info` shows `B`
   in R with the same ID.
6. Create `G` in R and `H` in `G`, trash `H`, rename `G` to `G2`, then
   restore `H` → the restore result is recorded as observed, not asserted:
   `denied` means the trash `path` is a deletion-time snapshot, `succeeded`
   means it is recomputed (D-17-3, residual risk R-17-1 in BR-277); on
   `succeeded`, `kdrive_info` must show `H` with the same ID, parent `G2`'s ID
   and path `<G2 path>/H`, and a listing of R must show no folder named `G`;
   any other landing fails acceptance (BR-039 v2 is then not accepted and a
   new spec version is required); the other writes are `succeeded`.
7. Create `A` again in R → the result and status are recorded as observed
   (folder-create collision, D-17-9), not asserted.

Phase 2, deny list `**/*-deny*`:

8. Rename the step-1 `A` (by its ID) to `A3`, move it into `B`, trash it
   (descendant `A/C/X-deny`) → each `denied`, zero writes.
9. Create `Y-deny` in R, rename `F2` to `F2-deny` → each `denied`, zero
   writes.
10. Trash `B` → `succeeded`; restore `B` → `denied` (folder restore with
    denies), zero writes for the restore.
11. In both phases, each `succeeded`, `failed` or `uncertain` result has one
    `intent` and one `outcome` record and each `denied` result one `denied`
    record with the same tool; no record contains a fixture name.

Fixtures stay in place or in the trash; the owner empties them manually.

## Acceptance criteria

Planned test files: `tests/mutation-tools.test.ts`,
`tests/kdrive-mutation-port.test.ts`, `tests/kdrive-trash-evidence.test.ts`,
`tests/mutation-production.test.ts`, plus the existing restore cases of
`tests/policy.test.ts`.
Port, evidence and production tests use an injected transport (BR-216 v2):
a test `lookup` and `connect` dialing a loopback TLS server with scripted
responses, and a counting `onRequest` observer.

- **AC-01** (BR-060 v5, BR-261, BR-263) — Given each mode, When tools are
  listed through the real MCP exchange, Then `read` lists exactly the ten read
  tools, `write` and `share` list exactly fifteen tools, and each mutation tool
  has the BR-261 annotations and the BR-263 sentences. Verified by:
  `mutation-tools.test.ts` (`TestBR060_*`, `TestBR261_*`, `TestBR263_*`).
- **AC-02** (BR-260, BR-275) — Given each tool with valid arguments, with and
  without `drive_id`, Then the operation passed to `mutate` equals the Tool
  table; Given an extra member (including `destination_drive_id` on
  `kdrive_move` and `destination_folder_id` or `name` on `kdrive_restore`), a
  missing member, ID 0, a negative ID, an ID above `Number.MAX_SAFE_INTEGER`,
  a non-integer ID, a string ID (`"5"`), and the names `""`, `.`, `..`,
  `a/b`, `a\b`, a control character, `" a"`, `"a "` and `"\ta"`, Then the
  call returns `INVALID_ARGUMENTS` with zero `mutate` calls and zero
  requests. Verified by: `mutation-tools.test.ts` (`TestBR260_*`,
  `TestBR275_*`).
- **AC-03** (BR-262) — Given gate results `succeeded`, `failed`, `uncertain`
  and `denied`, When a tool call ends, Then `mutate` was called once with no
  payload, the content is one text item whose JSON equals the gate result,
  and `isError` is false only for `succeeded`. Verified by:
  `mutation-tools.test.ts` (`TestBR262_*`).
- **AC-04** (BR-274) — Given the production composition in `write` mode,
  Then the gate registry has exactly the five kinds, and a run of kind
  `upload-new` or `share-link` is refused `UNAVAILABLE` with zero records.
  Verified by: `mutation-production.test.ts` (`TestBR274_*`).
- **AC-05** (BR-036, BR-034, BR-271) — Given denies `["**/secret/**"]` and a
  folder `P` whose descendant is `P/x/secret/k`, When `kdrive_rename`,
  `kdrive_move` and `kdrive_trash` target `P` (parent rename/move/trash), Then
  each is `denied` with zero intent records and zero non-GET requests; Given
  a rename or a move whose result path matches a deny pattern, and a create
  whose result path matches it, Then each is `denied` likewise; Given the
  same operations on a permitted tree, Then each sends exactly one request on
  its route and returns `succeeded`. Verified by:
  `mutation-production.test.ts` (`TestBR036_*`, `TestBR034_*`,
  `TestBR271_*`).
- **AC-06** (BR-275, BR-035, BR-278) — Given a move whose destination
  evidence has another drive ID, and a move into the source itself or its
  descendant, Then each is `denied`; Given configured roots `1` and `40`,
  When `kdrive_trash`, `kdrive_rename` and `kdrive_move` target `1` and then
  `40`, Then each of the six calls is `denied`, while a rename of a non-root
  child of `40` is `succeeded`; Given a second configured drive whose root
  contains an item with ID `40`, When that item is renamed, Then the result
  is `succeeded`; every `denied` case has zero intent records
  and zero non-GET requests. Verified by: `mutation-production.test.ts`
  (`TestBR275_*`, `TestBR035_*`, `TestBR278_*`); the F-003 policy test that
  authorizes renaming a non-root configured root, if any, is updated under
  BR-278.
- **AC-07** (BR-039 v2) — Given original-trash evidence whose former parent
  is outside every root (outside-source restore), whose former parent is
  inside a root but whose path matches a deny pattern, a former parent that
  is a file, a former parent whose live destination read returns another ID
  or path than the evidence's immediate parent, and a valid one, When the
  policy decides `{kind:"restore", target}`, Then the first four are denied
  and the valid one is authorized with the former parent as destination; Given a restore operation carrying
  `destination` or `name`, Then it is refused `INVALID_OPERATION`; Given a
  directory restore with nonempty denies, Then it is denied because
  original-trash enumeration is unavailable, and with empty denies it is
  authorized without enumeration; Given root `1` configured and evidence
  whose former parent is the root sentinel, Then the restore is authorized
  with destination root `1`. Verified by: the F-003
  restore cases of `tests/policy.test.ts` (`BR-039 …`, updated to v2) and
  `mutation-production.test.ts` (`TestBR039_*`).
- **AC-08** (BR-264, BR-265) — Given trash metadata shaped as in `docs/kdrive-write-evidence.md` for a
  directly trashed file and folder with a live former parent whose joined path
  equals the trash `path`, Then `inspect` returns the BR-264 evidence after
  exactly two GETs; Given `status` `trash_inherited`, any other status, a
  missing or invalid `id`, `type`, `name`, `parent_id` or `path`, an `id`
  differing from the target, a `drive_id` differing from the requested drive,
  Then it returns `incomplete` after one GET;
  Given a former parent that is 404, trashed, a file, unnormalizable, or whose
  joined path differs from the trash `path` (parent renamed), Then
  `incomplete`; Given a directly trashed item whose former parent is root
  `1` and trash `path` equals `/` plus its name, Then `inspect` returns the
  BR-264 evidence with the root sentinel chain; Given a trash 404
  `object_not_found`, Then `missing`.
  Verified by: `kdrive-trash-evidence.test.ts` (`TestBR264_*`,
  `TestBR265_*`).
- **AC-09** (BR-200 v2) — Given `children` with location `original-trash` and
  the adapter `execute`, Then each returns `unavailable` and the observer
  counts zero requests. Verified by: `kdrive-trash-evidence.test.ts`
  (`TestBR200_*`).
- **AC-10** (BR-190 v2, BR-266, BR-271, BR-270) — Given each mutator, When it
  runs once against the loopback server, Then the server sees exactly one
  request with the Route-table method, path and body bytes, `Connection:
  close`, `Content-Length`, the bearer token, on a connection carrying no
  other request; a 3xx response is not followed; the route table has no
  `DELETE` template containing `/trash` and no source file under `src/` or
  implementing `make kdrive-write-acceptance` builds one. Verified by: `kdrive-mutation-port.test.ts` (`TestBR190_*`,
  `TestBR266_*`, `TestBR271_*`, `TestBR270_*`).
- **AC-11** (BR-267, BR-269) — Given a full queue, a DNS failure, a refused
  private address, a refused TCP connect and a TLS failure, Then the port
  throws `NotSent` and the gate result is `failed` `NOT_SENT`; Given the
  port's signal aborted while the request is queued, Then the port throws
  `NotSent` (port level only: at gate level the only abort is the BR-249
  attempt timer, which resolves `uncertain`); Given the server closing the
  socket after reading the request, sending half a status line, or never
  answering until the 30,000 ms attempt abort (fake clock), Then the port
  throws `MUTATION_UNKNOWN`, the socket is destroyed, and the gate result is
  `uncertain` `UPSTREAM_UNCERTAIN`. Verified by:
  `kdrive-mutation-port.test.ts` (`TestBR267_*`, `TestBR269_*`).
- **AC-12** (BR-268, BR-272, BR-273) — Given 200 bodies that are valid, have
  `result` other than `success`, invalid JSON, exceed 4 MiB, are truncated,
  or fail the kind's check (create name or parent different from the request,
  `type` `file`; `cancel_id` missing, empty or longer than 256 bytes,
  `valid_until` not finite), Then only the valid ones are `succeeded` with the
  BR-272/BR-273 `value` (and `created` for create) and the others are
  `uncertain`; Given a 409 with a 20 KiB body and a 429 with `Retry-After` of
  2 and of 33 bytes, Then the results follow F-016 BR-247/BR-248; no result,
  record or stderr line contains the `cancel_id`. Verified by:
  `kdrive-mutation-port.test.ts` (`TestBR268_*`, `TestBR272_*`,
  `TestBR273_*`).
- **AC-13** (BR-271, BR-251) — For each operation family (create, rename,
  move, trash, restore), Given a permitted operation whose response is lost
  after the request was received (socket destroyed), When the tool is called,
  Then the result is `uncertain` with the fixed F-016 message, `attempts:1`,
  the server saw exactly one non-GET request, no further request of any kind
  follows the mutation request, and the outcome record says `uncertain`.
  Verified by: `mutation-production.test.ts` (`TestBR271_lostResponse_*`).
- **AC-14** (BR-234, BR-257) — Given each tool with a name and path carrying
  the marker `SECRETMARK`, Then the audit records contain IDs only and no
  marker; Given a received-share target with `sharedWrite=true`, Then each
  tool is `denied` with zero non-GET requests. Verified by:
  `mutation-production.test.ts` (`TestBR234_*`, `TestBR257_*`).
- **AC-15** (BR-276, real API) — Given an actual main checkout, the owner's
  token and a designated folder (its other content cannot match the per-run
  prefix), When the owner runs
  `make kdrive-write-acceptance KDRIVE_WRITE_FOLDER=<id>`, Then every
  asserted Acceptance-sequence step passes and steps 6 and 7 are recorded,
  the request and time caps hold, and the printed summary passes the BR-213
  v3 leak check (token, real IDs other than `1`, real names, `@`, URLs) and
  contains no `cancel_id` value; without `KDRIVE_WRITE_FOLDER` the target refuses before any Docker
  command. Verified by: owner-run command, report
  `runs/18-acceptance-1.md`; the refusal by a `Makefile` test in
  `mutation-tools.test.ts` (`TestBR276_*`).
- **AC-16** (BR-277) — Given the README and `SECURITY.md` after the
  implementation PR, Then they state each BR-277 item. Verified by: reviewer
  document check in the implementation PR.

## Decisions

- **D-17-1 — One PR, no split.** Nineteen new rules and four version bumps fit a
  reviewable spec; the five tools share one port, one gate and one evidence
  addition. Rejected: splitting create/rename/move from trash/restore (two
  freezes and two acceptance runs for one transport change).
- **D-17-2 — Restore to the former parent only, destination derived by the
  policy core.** Owner decision A (runs/16-decisions-1.md). The core derives
  the destination from fresh original-trash evidence inside the single policy
  decision, so no pre-read outside the guarded facade picks it. Rejected: a
  caller-supplied destination equal to the former parent (a second source of
  truth to reconcile); `destination_directory_id` (unmeasured, T5 skipped);
  accepting a recreated parent (owner rejected option B).
- **D-17-3 — Original-trash evidence = trash metadata + live former parent.**
  Trash metadata has `parent_id` and `path` but an empty `parents` list
  (Stage A T1), so the original chain is taken from the live former parent
  and accepted only when the trash `path` equals that parent's live path plus
  the item name. Whether the trash `path` is a deletion-time snapshot is
  unmeasured: if it is, a moved or renamed former parent makes the paths
  differ and the restore is refused; if it is recomputed, the check proves
  the current location, where the item will land, and the original location
  at deletion time is not provable beyond it — the owner accepted the "former
  parent live and authorized" rule on that basis. Acceptance step 6 measures
  which case holds and also checks where a `succeeded` restore lands (same
  ID under the renamed parent, no recreated folder at the former path); a
  restore by path that recreates the former folder fails acceptance. BR-277
  names the residual risk R-17-1. Rejected:
  trusting `path`
  alone (no ancestor identities); refusing all restores (option D, rejected
  by the owner).
- **D-17-4 — No trashed-tree enumeration.** `GET …/trash/{f}/files` was
  observed once (T2) without its paging envelope or nested-folder behaviour,
  and F-003 requires a complete original descendant proof bound to the
  trashed tree. `children` with `original-trash` stays unavailable, so a
  folder restore with nonempty denies is denied (fail closed) and a folder
  restore with empty denies needs no enumeration (BR-038). A BACKLOG line
  records qualification of that route. Rejected: assuming the live children
  envelope for the trash route.
- **D-17-5 — `NotSent` boundary at TLS handshake completion, one connection
  per mutation.** Before the handshake completes no HTTP byte can have
  reached the server; after it, Node may have flushed headers. A dedicated
  connection avoids a reused keep-alive socket whose failure would be
  ambiguous. Rejected: pooled sockets (stale-socket resets would be
  `uncertain` or, worse, misread as not sent); byte-level write tracking
  (fragile across Node versions).
- **D-17-6 — No 5,000 ms adapter deadline for mutations.** Rename, move or
  trash of a large folder may take longer than a read; the gate already
  bounds an attempt at 30,000 ms (BR-249). Rejected: BR-193's 5,000 ms (would
  turn slow successes into `uncertain`).
- **D-17-7 — Annotations.** `idempotentHint:false` for all five: a repeated
  call after an unknown result is exactly what the uncertain message forbids,
  and a second rename/move/trash/restore can fail or act differently.
  `destructiveHint:true` only for trash, matching SPEC §6. Rejected:
  idempotent rename/move (misleads clients into automatic replay).
- **D-17-8 — `cancel_id` never exposed.** The cancel route is unmeasured and
  no cancel tool exists; the value is a server capability token with no use
  for the client. Rejected: returning it.
- **D-17-9 — Folder-create collision.** Not measured in #16. A 2xx whose
  folder name or parent differs from the request (a possible server-side
  rename) is `uncertain`, because the created path was not the checked one;
  a 409 is `failed`. The acceptance run records the real behaviour (step 7).
  Rejected: trusting any 2xx (would hide an unchecked result path).
- **D-17-10 — No post-write read-back.** F-016 forbids extra requests in a
  mutator and rejected re-inspection (D-16-2); the client verifies with read
  tools after `uncertain`. The restore race (former parent trashed between
  the decision and the request, which makes the server recreate a folder at
  the former path) is a documented SPEC §10.6 residual risk (BR-277).
  Rejected: a gate-level read-back (changes the frozen F-016 classification).
  A BACKLOG line records that the effect of the trash route on an item
  already trashed between the check and the request is unmeasured.
- **D-17-11 — `kdrive_move` without rename.** Keeps the schema and the route
  minimal; collision returns 409 (M1). Rejected: optional `name` (the move
  route's rename parameter is unmeasured).
- **D-17-12 — Owner-run acceptance in one designated folder.** Real writes
  need the owner's token and a disposable folder; fixtures stay in place or
  trashed because no permanent deletion route exists. Rejected: CI writes
  (no credentials in CI); automated cleanup by permanent deletion (BR-270).

## Open questions

None.

## Stress-test

Round 1 (review (archived evidence `runs/18-spec-review-1.md`), fixes in
runs/18-spec-fix-1.md (archived evidence `runs/18-spec-fix-1.md`)):

1. major, F-003 evidence contract — retained: BR-039 v2 now states the
   amendment (live former-parent chain, named F-003 sentences no longer
   apply) and its History line records it.
2. major, trash `path` snapshot vs recomputed — retained: Acceptance step 6
   measures it; BR-277 names residual risk R-17-1, kept or narrowed by the
   records PR after acceptance; planned `SECURITY.md` line in Scope item 7.
3. major, AC-11 abort while queued — retained: `NotSent` asserted at port
   level only; the gate-level abort is the BR-249 timer (`uncertain`).
4. major, test names — retained: every AC test name now matches a BR the AC
   lists; `TestBR278` now names the new root rule.
5. major, trash of a configured root — retained per orchestrator decision:
   BR-278 denies trash, rename and move on any configured root ID; AC-06.
6. minor, whitespace names — retained: BR-260 refuses leading or trailing
   whitespace; AC-02 cases.
7. minor, trash `drive_id` — retained: BR-265 `incomplete` on mismatch;
   AC-08 case.
8. minor, former parent read twice — retained: BR-039 v2 denies when the
   live destination read differs in ID or path; AC-07 case.
9. minor, editorial — retained: D-17-1 count, D-17-9 step number, step 8
   rename target, AC-15 leak categories and folder wording.
10. minor, AC-02 IDs — retained: negative, above `MAX_SAFE_INTEGER` and string
    IDs added.
11. minor, BR-268 body ownership — retained: the port returns raw bytes; the
    mutator alone validates the 2xx body.

### Round 2 (`runs/18-spec-review-2.md`, verdict approve)

1. minor, BR-260 garbled text — retained: single sentence.
2. minor, step 10 contradiction — retained: trash `succeeded`, zero writes
   for the restore only.
3. minor, step-6 other results — retained: R-17-1 unchanged, recorded as
   unmeasured.
4. minor, nested roots — retained as residual R-17-2 in BR-277 rather than a
   new parent-chain rule: the policy has no root ancestry without traversal,
   and the effect stays inside an authorized outer root.
5. minor, root-sentinel former parent — retained: AC-07 and AC-08 cases.
6. minor, AC-10 static check — retained: extended to the acceptance tooling.

### Fable decision pass (`runs/18-spec-fable-1.md`, verdict changes)

1. major, step-6 landing unchecked — retained: step 6, BR-277 and D-17-3
   check the landing (same ID under `G2`, no recreated `G`); any other
   landing fails acceptance.
2. minor, root match not drive-qualified — retained: BR-278 matches
   `(drive_id, ID)` pairs; AC-06 second-drive case.
3. minor, permanent-delete effect of a race-trashed item unmeasured —
   retained: named in BR-277; BACKLOG line in the implementation PR.
4. minor, restore race recreating a configured root — retained: BR-277
   clause.
5. minor, fixed sentences silent on folder restore with denies — retained:
   `kdrive_trash` and `kdrive_restore` sentences; "renaming" added to R-17-2.

### Round 3 (`runs/18-spec-review-3.md`, diff-only, verdict approve)

1. minor, AC-06 second-drive case untestable as worded — retained: concrete
   setup and `succeeded` outcome.
2. minor, absolute "never permanent" claim beside the unmeasured race —
   retained: BR-277 now states that this server never requests permanent
   deletion (BR-270); the race clause stays the stated exception. The fixed
   `kdrive_trash` sentence is unchanged (it describes the request made).

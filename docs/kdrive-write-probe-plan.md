# Bounded kDrive write-behavior probe plan (#16)

Status: approved at a162fed (runs/16-plan-review-3.md); Stages A and B executed on 2026-11-04, Stage C not run (the owner cleans up). Results: [write evidence](kdrive-write-evidence.md). Ticket: #16 (archive issue 16)
(P-16). Path: research ticket, no F/BR allocation; this plan plays the role the
[read probe plan](kdrive-read-probe-plan.md) played for #5. Review model: Opus
5.5 high (milestone 0.4 table: "#16: Opus only").

Nothing in this plan authorizes a request. Live execution needs, in order:
this plan approved by an independent reviewer, the operator approved by an
independent security reviewer, and the owner's explicit E-03 authorization
(dedicated disposable folder plus credential provisioning outside Git) for the
exact operator revision and stage.

## Purpose and consumers

The observations feed three later decisions; none is taken here.

| Question                                                                   | Consumer                    |
| -------------------------------------------------------------------------- | --------------------------- |
| Exact method/path/body of each write the 0.4 tools need                    | P-17, P-18, P-19            |
| Whether trash metadata proves former path/ancestry well enough to restore  | P-18 restore feasibility    |
| Whether upload refuses a name collision atomically, including concurrently | D-07, P-19                  |
| Rename/move collision behavior, response shapes, cancellable-action fields | P-18                        |
| Whether any write accepts a precondition (ETag/If-Match) or lock           | P-17 concurrency safeguards |
| Write/share endpoint methods for sharing                                   | P-20 (blocked here, below)  |

The restore-feasibility outcome and D-07 are brought to the owner as options
with a recommendation. A measurement never silently selects either.

## Candidate routes and their source

The candidates come from the official open-source Android client
(`Infomaniak/android-kDrive`, `ApiRoutes.kt`, `ApiRepository.kt`,
`UploadTask.kt`, read on 2026-11-03 from the default branch). They are
**candidates**, not provider guarantees; the operator review pins the exact
commit read and the exact parameter names before execution. The developer
portal pages are script-rendered and were not readable by the tooling used.

| ID  | Operation               | Candidate                                                                                        |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| R1  | Create folder           | `POST /3/drive/{d}/files/{parent}/directory` with JSON `name`                                    |
| R2  | Direct upload           | `POST /3/drive/{d}/upload?directory_id={parent}&file_name=…&total_size=…&conflict={c}`, raw body |
| R3  | Rename                  | `POST /2/drive/{d}/files/{f}/rename` with JSON `name`                                            |
| R4  | Move                    | `POST /3/drive/{d}/files/{f}/move/{newParent}`                                                   |
| R5  | Move to trash           | `DELETE /2/drive/{d}/files/{f}` (client returns a "cancellable action")                          |
| R6  | Trashed item metadata   | `GET /3/drive/{d}/trash/{f}` with the `with` projection under test                               |
| R7  | Trashed folder children | `GET /3/drive/{d}/trash/{f}/files`                                                               |
| R8  | Restore                 | `POST /2/drive/{d}/trash/{f}/restore` (optional destination parameter to confirm)                |
| R9  | Read-back               | `GET /3/drive/{d}/files/{f}?with=path,parents,capabilities` and the folder children list         |
| R10 | Delete one trashed item | `DELETE /2/drive/{d}/trash/{f}` (client `deleteTrashFile`); permanent                            |

`conflict` takes `error`, `version` or `rename` in the client enum. `error` is
the candidate atomic refusal for D-07.

Upload sessions (`/upload/session/*`), copy, duplicate, bulk actions, cancel
of a cancellable action, versions, comments, categories, favorites, and
cross-drive copy are **out of scope**.

### Request shape constraints

- Every ID placed in a path is a positive decimal integer (`^[1-9][0-9]{0,11}$`)
  taken from the private manifest or the journal; anything else (empty,
  `undefined`, `NaN`, signs, spaces) aborts before the request. After
  substitution, the full path must match the exact pattern of its row (for R10:
  `^/2/drive/[1-9][0-9]*/trash/[1-9][0-9]*$`). The operator has negative unit
  tests proving that an empty or invalid ID never yields `/2/drive/{d}/trash`.
- R2's query keys are exactly `directory_id`, `file_name`, `total_size` and
  `conflict`, plus any key the operator review pins from the client source.
  `directory_path` is never sent. Every name the operator sends (R1, R2, R3)
  matches `^p16-[A-Za-z0-9-]{1,80}$`; no `/`, no dot-segments.
- The client's direct-versus-session upload threshold is read from the client
  source during the operator review and recorded as a source-derived
  candidate, unmeasured.

### Never sent

The operator refuses, by construction, every method/path outside its static
allowlist. These are named explicitly because they are destructive or global:

- `DELETE /2/drive/{d}/trash` (empty the whole drive trash): it reaches every
  trashed item of the drive, not only fixtures;
- R10 outside Stage C, or on an ID that is not a journal-proven or
  server-derived fixture whose R6 read-back in the same session shows a
  `p16-` name;
- R5 on an item already in the trash, or on any ID that is not a fixture;
- `/files/bulk`, every `/access`, `/link`, `/invitations`, `/teams`, `/users`
  and `/force` route, every cancel of a cancellable action;
- any write whose target, parent or destination is not the run container `C`
  or a fixture inside it. Two exceptions: R8 restore, whose server-chosen
  landing place is observed; and, in Stage C only, R5/R10 on a server-derived
  fixture that a restore placed outside `C`, after same-session R6/R9 identity
  checks;
- any request to a host other than `api.infomaniak.com`. Redirects are never
  followed: any 3xx, or any status outside the request's declared set, stops
  the session.

## Sharing probes — blocked

Public-link and recipient probes (P-20) need a separate explicit owner
authorization naming the recipient or the link policy. None is given, so S1
(public link) and S2 (invitation) are **blocked** and reported as such. The
candidate routes are recorded from the client source only, unmeasured.

## Provisioning boundary (E-03)

- **Authorization.** On 2026-11-03, in the #16 session, the owner answered
  “oui tu peux avoir un espace de test sur mon kDrive” with a link to one
  folder, and “le token que tu as te permet de faire ça”. The folder's drive
  and folder IDs live only in the private manifest outside Git; published
  evidence uses aliases (`D`, `F0`).
- **Credential.** The owner states the credential provisioned for #5
  (`.config/kdrive-token`, ignored by Git) permits these writes. That is an
  owner statement, checked only through P0's capability booleans. The
  orchestrator never reads, searches for, generates, prints or copies it. It is
  mounted read-only into the operator container exactly as in #5 (regular
  file, owner and mode 0600 checked, no argv/env exposure, NOFOLLOW read, size
  cap).
- **Isolation.** Each run first creates one container folder `C` =
  `p16-<run>` in `F0`; every other fixture lives inside `C`. `F0` must contain
  nothing but earlier `p16-*` containers known to a P-16 journal; any other
  child stops the run. Fixture content is synthetic known bytes. No personal
  file is read, renamed, moved, trashed or overwritten.
- **Cleanup — owner override of P-16's “no permanent deletion”.** The owner's
  words, 2026-11-03, #16 session: “tu peux utiliser la corbeille et la vider
  pour les tests, je n'ai pas de données critiques dedans”. The plan narrows
  this to per-item permanent deletion of fixtures (Stage C, R10), never the
  whole drive trash. Stage C is gated separately and no evidence row depends
  on it. If Stage C is not run or stops, fixtures stay trashed (or in place)
  and are reported; leaving them to the provider's purge is acceptable. The
  P-18 product contract (no permanent deletion tool) is unaffected.

## Operator and journal

One bounded operator, ignored by Git under `artifacts/16-probes/`, run through
Make/Compose in an isolated clean checkout (Docker-only rule). It is a probe
helper, not product code. Its **revision** is the SHA-256 manifest of its
files (as #5's bound-source check); reviews, owner authorizations and receipts
cite that digest, and the operator refuses to start if its files differ.

- **Static allowlist**: method, exact path pattern and closed query keys per
  request; IDs come only from the private manifest (`D`, `F0`) or the journal.
- **Durable intent/ACK journal** (append-only JSONL, 0600, fsync after each
  line, outside Git): `intent` (row, method, path template, aliases, content
  digest) is written and synced **before** the request; `ack` (status, alias → ID mapping
  of created IDs, sanitized summary) after. An intent without an ACK is
  **uncertain**.
- **ID classes**: `journal` (returned by an acknowledged create), and
  `server-derived` (a new or moved ID observed by a read-back after an
  acknowledged write of this run, e.g. a restore that recreates or relocates
  an object, or a `rename`-mode upload). Both are fixtures. Any other unknown
  ID in a read-back of `C` stops the run; IDs outside `C` are never followed
  except the one R9 that locates a restore's landing place.
- **No replay**: an uncertain write stops the session. Reconciliation is
  read-only (R9 list of the parent, R6 of a trash item) in a later session and
  records `observed-after-uncertain`, never success.
- **Expected outcomes per request**: each request declares `expect=success`
  or `expect=observe`. For `observe`, any 2xx and any 400/404/409/412/422 is
  a recorded result, not a stop (refusals are the measurement). For
  `success`, a 4xx stops the rows that depend on that object. In every case
  the session stops on: 401/403, 429, 5xx, timeout, malformed body, an
  unknown ID inside `C`, or a cap.
- **Asynchronous effects**: a write answered with a cancellable action or 202
  is read back at once; if the effect is absent, one re-read after 3 seconds.
  The result is classified `immediate`, `eventual` or `unconfirmed`;
  `unconfirmed` skips the rows that depend on that object. Re-reads count
  toward the caps.
- The private journal (0600, outside Git) is the only place holding the
  alias → ID mapping that later stages and reconciliation use; published
  receipts carry aliases only.
- **Pacing**: one request in flight and at least one second between starts,
  except inside C2, which is exempt (below). No automatic retry. Per-request
  deadline 10 s (30 s for R2).
- **Caps**: Stage A ≤ 25 requests, Stage B ≤ 105 requests (one or two
  sessions), Stage C ≤ 25 requests; each session ≤ 15 minutes; uploaded bytes
  ≤ 1.1 MiB total. JSON response ≤ 256 KiB, error body ≤ 8 KiB, total received
  ≤ 4 MiB. A reached cap stops the session; caps are never raised mid-run.
- **Publication**: logs and receipts hold only UTC time, row, method, path
  template, aliases, status, whitelisted error `code`, field presence and
  types, booleans and counts. `path` and `parents` values are published only
  as booleans (equals the expected alias chain), as a path **relative to `F0`**
  built from `p16-*` names, or as depth counts. Names or IDs of `F0` itself
  and of anything above it, emails, tokens, request IDs, `Location`, cookies
  and raw bodies are never logged.

## Rows

All fixtures live in `C`. Aliases: `dirA`, `f1`, `f2`… are created by the row
that first names them. Counts are planned requests including read-backs; async re-reads (one at
most per write) are not pre-counted and consume the margin between the planned
total and the stage cap. Reaching the cap stops the session.

### Stage A — minimal representative sample

| Row | Pre-state → action                                                                  | Expect           | Requests | Observation                                                                                       |
| --- | ----------------------------------------------------------------------------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| P0  | R9 `F0` with `path,parents,capabilities`; R9 children of `F0`                       | success          | 2        | Capability booleans (write, upload, create, rename, move, delete); children are known containers. |
| W0  | R1 create `C`; R9 read-back                                                         | success          | 3        | Status, response shape, parent equals `F0`.                                                       |
| W1  | R1 create `dirA` in `C`; R9                                                         | success          | 3        | Same, parent `C`.                                                                                 |
| W2  | R2 16 known bytes as `f1` in `C`, `conflict=error`; R9                              | success          | 3        | Accepted parameter names, shape, size 16, parent `C`.                                             |
| C1  | R2 different 16 bytes named `f1` in `C`, `conflict=error`; R9 `f1`; R9 children `C` | observe          | 3        | Refusal status/`code`; `f1` size/version unchanged; no second or renamed child.                   |
| T1  | R5 `f1`; R6 `f1` with `with=path,parents`; R6 with `with=path,parents,capabilities` | success, observe | 4        | Former parent/path presence and equality with `C`, depth, `status`, cancellable-action fields.    |
| T1r | R8 restore `f1` (its former parent `C` still exists); R9 `f1`                       | success          | 3        | Landing place equals `C`; ID kept or changed.                                                     |

Stage A: 21 planned requests, cap 25. It confirms parameter names, response shapes, the
journal and the stop behavior before anything larger.

### Stage B — remaining measurements

Runs only after the Stage A receipt is reviewed and the owner re-authorizes the
same operator digest for Stage B. A row whose prerequisite failed is reported,
not retried. Every Stage B session starts with **P0b**: R9 `F0` capabilities
and R9 children of `C`, all journal or server-derived (2 requests). C6 runs
last, because a hang there ends the session.

| Row | Pre-state → action                                                                                                                                             | Expect  | Requests | Observation                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| C2  | Two R2 of different bytes, same new name `f2` in `C` (`f2-r2`… on repeats), `conflict=error` (protocol below); R9 children `C`                                 | observe | 3        | Per-request status; number of `f2` children; one winner and one refusal, or another outcome.                        |
| C2b | Like C2 with `f3` (`f3-r2`… on repeats); A holds its body half-sent until B completes or 2 s, whichever first; R9 children `C`                                 | observe | 3        | Whether B is refused while A is in progress, and A's outcome after B succeeds.                                      |
| C3  | R2 named `f1`, `conflict=rename`; R2 named `f1`, `conflict=version`; R9 each                                                                                   | observe | 6        | `rename` name pattern (server-derived ID); `version` keeps ID or not, size/content change (`overwrite:true` input). |
| C4  | R2 named `F1` (case variant of `f1`), `conflict=error`; R9 children `C`                                                                                        | observe | 3        | Whether case-only differences collide.                                                                              |
| C5  | R2 named `dirA`, `conflict=error`; R9 children `C`                                                                                                             | observe | 3        | Collision with a folder of the same name.                                                                           |
| C6  | (last row) R2 `f4` with query `total_size=32`, a 16-byte body and `Content-Length: 16`; R9 children `C`                                                        | observe | 3        | Refusal, truncation or dangling object.                                                                             |
| C7  | R2 `f5` with a 0-byte body; R9                                                                                                                                 | observe | 3        | Empty upload accepted or refused.                                                                                   |
| N1  | R3 rename `f1` to `f1-renamed`; R2 `g1`; R3 rename `g1` to `f1-renamed`; R9 each                                                                               | observe | 7        | Success shape; rename collision status/`code` or silent suffix; cancellable-action fields.                          |
| M1  | R4 move `f1-renamed` into `dirA`; R2 `f1-renamed` in `C`; R4 move it into `dirA`; R9 each                                                                      | observe | 7        | Moved parent; move collision outcome.                                                                               |
| T2  | (`dirA` holds `f1-renamed`) R5 `dirA`; R6 `dirA`; R7 children of trashed `dirA`; R6 `f1-renamed`                                                               | observe | 5        | Children travel with the folder; their former-path metadata.                                                        |
| T3  | R8 restore `f1-renamed` alone while `dirA` is trashed; R9 it                                                                                                   | observe | 3        | Landing place: original parent, `C`, drive root, recreated parent (server-derived) or refusal.                      |
| T4  | R8 restore `dirA`; R9 children of `dirA`                                                                                                                       | observe | 3        | Restored location and child presence (with or without the T3 object).                                               |
| T5  | R2 `h1`; R5 `h1`; R6 `h1` (continue only if `immediate`/`eventual`); R8 restore `h1` with an explicit destination `dirA`, only if the parameter was pinned; R9 | observe | 6        | Destination honored or refused. Skipped, with reason, if no parameter is pinned.                                    |
| T6  | R2 `k1`; R5 `k1`; R6 `k1` (continue only if `immediate`/`eventual`); R2 a new `k1` in `C`; R8 restore the trashed `k1`; R9 children `C`                        | observe | 7        | Restore onto an existing same-named item: refusal, rename (server-derived) or overwrite.                            |
| K1  | Only if exactly one `f2` exists (the C2 winner, by ID); otherwise skipped with reason. R3 rename it with `If-Match: "p16-bogus"`; R9                           | observe | 3        | 412 versus success; ETag presence on write responses.                                                               |
| K2  | Same condition as K1; R2 named like the C2 winner, `conflict=version`, with `If-Match: "p16-bogus"`; R9                                                        | observe | 3        | Whether an upload precondition is honored.                                                                          |
| Z1  | R2 `z1` of 1 MiB synthetic bytes, `conflict=error`; R9                                                                                                         | success | 3        | Direct upload of a non-trivial size works. The maximum size is not sought.                                          |
| S1  | Public link                                                                                                                                                    | —       | 0        | Blocked (no authorization).                                                                                         |
| S2  | Invitation                                                                                                                                                     | —       | 0        | Blocked (no authorization).                                                                                         |

Stage B: 73 planned requests for one pass including P0b; C2/C2b repeats add
at most 18 and a second session's P0b 2, so 93 planned, cap 105.

**C2 protocol.** Both intents are journaled and synced before either request
starts. The two requests start within 50 ms of each other; spacing does not
apply inside the pair. If one fails with a stop condition, the operator waits
for its peer up to the peer's deadline, journals that result, then stops. A
timed-out peer is uncertain and never replayed. Start and finish offsets are
recorded in milliseconds. C2b sends A's headers and half of its body, holds
until B completes or 2 seconds pass, whichever comes first (recorded), then
sends the rest. Each repeat uses a fresh name. C2
and C2b may each be repeated at most 3 more times, only if the previous sample
was clean. Even unanimous refusals do not prove atomicity; the evidence states
the sample size and the remaining unknown.

### Stage C — cleanup (separately gated)

| Row | Action                                                                                                                                                                                                                                      | Requests |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| X0  | R9 children of `C` and of each fixture folder inside it (`dirA`): every item is a journal or server-derived fixture. R9/R6 on any fixture outside `C` (T3 landing place) and on journal fixtures still trashed (refused T3/T5/T6 restores). | ≤ 6      |
| X1  | R5 any fixture outside `C`, then R5 `C`; R6 each trashed item (including those already trashed), showing a `p16-` name and the expected ID; R7 trashed `C` matches X0                                                                       | ≤ 9      |
| X2  | R10 on each item checked by X1; R6 again (404 or other, recorded)                                                                                                                                                                           | ≤ 8      |

Any mismatch in X0 or X1 skips X2 for that item and reports it.

## Evidence and unknowns

Each executed stage produces `runs/16-execution-<stage>-<n>.md` (sanitized
receipt summary, request count, operator digest, journal digest) and the
consolidated `docs/kdrive-write-evidence.md`. Every row states what remains
unknown. Known unknowns at the outset:

- server-side atomicity of `conflict=error` beyond the sampled interleavings;
- maximum upload size, the actual direct/session threshold and session-upload
  behavior;
- rate limits for writes (no 429 is provoked);
- locks and any precondition other than `If-Match` on rename/upload;
- behavior under other clients' concurrent changes;
- trash retention period and automatic purge;
- sharing endpoints (blocked).

## Decisions handed to the owner after Stage B

1. **Restore feasibility (P-18)**: options derived from T1, T1r and T2–T6,
   e.g. restore only when the trash metadata proves the former parent and it
   is still authorized; restore only to an explicit authorized destination;
   or withhold restore.
2. **D-07 (P-19)**: atomic `conflict=error` evidenced (C1–C2b, C4, C5) → keep
   `overwrite:false` as a server-enforced guarantee; otherwise choose between
   withholding upload and the weaker “no overwrite known at preflight” policy,
   stated in schema and README.

Each comes with a recommendation and its evidence. None is recorded as decided
before the owner answers.

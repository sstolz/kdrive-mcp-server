# kDrive API observations

Durable knowledge about the kDrive API, measured while building this server.
Each entry gives its date, the method, the result and where its evidence is
kept. Every measurement was made on one account and one drive, inside a
dedicated test folder; these are observations, not provider guarantees.
Identifiers, names and raw responses stay out of this file.

Route placeholders: `{d}` is a drive ID, `{f}` a file or folder ID, `{p}` a
parent folder ID.

## Authentication and drive discovery

### Access tokens are opaque

- Date: 2026-11-03.
- Method: an owner-run OIDC qualification of the Infomaniak provider
  (`make oidc-qualify`), with the server's JWT validator.
- Result: the Infomaniak access token is opaque (the validator answers 401
  `malformed`); the ID token is a JWT. The provider is usable only behind the
  OAuth proxy of this server (`proxy-only`), never by direct token validation.
- Evidence: archived evidence `runs/11-acceptance-infomaniak-token-1.md`.

### Drive initialisation

- Date: 2026-11-02.
- Method: one bounded `GET /2/drive/init?with=drives` with an API token, after
  a first attempt with an expired token.
- Result: the expired token gave HTTP 401 with no usable body; the retry gave
  HTTP 200 with one projection per accessible drive (ID and role). A bare
  `GET /2/drive` was reported as 422 in the earlier historical notes.
- Evidence: archived evidence `runs/5-read-probes-1.md` and
  `runs/5-init-retry-1.md`; summary in `docs/kdrive-read-evidence.md`.

## Reads

### Children pagination

- Date: 2026-11-02.
- Method: listing `GET /3/drive/{d}/files/{f}/files` over a synthetic folder of
  1,001 children, two pages of `limit=1000`.
- Result: HTTP 200 pages of 1,000 + 1 items, no duplicate, exact union and a
  terminal page. `limit=5000` was refused earlier with 422
  `validation_rule_max`; an invalid limit returned 422 `validation_failed`
  without validation details.
- Evidence: archived evidence `runs/5-final-read-measurements-1.md` and
  `runs/5-remaining-read-probes-execution-2.md`.

### Downloads redirect to a storage host

- Date: 2026-11-02.
- Method: `GET /2/drive/{d}/files/{f}/download` with `Range` headers on a
  16-byte synthetic binary.
- Result: the API answers 302 to a storage host; the storage host answers 206
  with the exact bytes for `0-0`, `7-9` and `15-15` (matching
  `Content-Length`), and 416 with an empty `text/html` body for `16-16`. The
  storage hop is followed without the bearer token.
- Evidence: archived evidence `runs/5-remaining-read-probes-execution-2.md`.

### ETag shape

- Date: 2026-11-02 and 2026-11-04.
- Method: repeated range downloads of an unchanged file; header capture on
  every write-probe response.
- Result: download responses carry a bounded opaque ETag that is stable for an
  unchanged file but does not follow the standard syntax. None of the 85
  write-probe responses carried an `ETag` header. Conditional requests are not
  qualified: `If-Match` is ignored on rename.
- Evidence: archived evidence `runs/5-remaining-read-probes-execution-2.md`
  and `runs/16-execution-B-1.md`.

### Error codes and rate limits

- Date: 2026-10-31 to 2026-11-04.
- Method: about 30 historical GET samples, then the write probes, all bounded
  (at most about 100 requests per session).
- Result: unknown ID 404 `object_not_found`; inaccessible drive 401
  `not_authorized`; invalid parameter 422 `validation_failed` (historical
  samples, `docs/api-notes.md`). No rate-limit header and no 429 were seen in
  any session. No rate ceiling was sought.
- Evidence: historical notes in `docs/api-notes.md`; archived evidence
  `runs/16-execution-A-1.md` and `runs/16-execution-B-1.md`.

## Writes

### Write routes and their answers

- Date: 2026-11-04.
- Method: owner-authorized probes in one disposable folder (Stage A, 16
  requests; Stage B, 69 requests).
- Result: create folder (`POST /3/drive/{d}/files/{p}/directory`) and direct
  upload (`POST /3/drive/{d}/upload?directory_id&file_name&total_size&conflict`)
  are synchronous and return the file object. Rename
  (`POST /2/drive/{d}/files/{f}/rename`), move
  (`POST /3/drive/{d}/files/{f}/move/{p}`), trash
  (`DELETE /2/drive/{d}/files/{f}`) and restore
  (`POST /2/drive/{d}/trash/{f}/restore`) return a cancellable action
  (`cancel_id`, `valid_until`) whose effect is visible immediately.
- Evidence: archived evidence `runs/16-execution-A-1.md` and
  `runs/16-execution-B-1.md`; summary in `docs/kdrive-write-evidence.md`.

### Upload collisions

- Date: 2026-11-04.
- Method: uploads with `conflict=error` onto an existing name: one sequential,
  four concurrent pairs, four with a half-sent upload held while another
  completed.
- Result: 9/9 refused with 409 `file_already_exists_error`, the original
  unchanged; the name is (also) checked when the upload completes.
  `conflict=rename` creates `<base> (1)`; `conflict=version` keeps the same ID
  and replaces the content. Names are case-sensitive: case-only variants
  coexist. A size mismatch gives 400 `upload_failed_error`; a 0-byte upload is
  accepted. Atomicity under every interleaving is not proven.
- Evidence: archived evidence `runs/16-execution-A-1.md`,
  `runs/16-execution-B-1.md` and `runs/16-decisions-1.md`.

### Rename and move collisions

- Date: 2026-11-04 and 2026-11-10.
- Method: write probes, then the owner-run write acceptance on main.
- Result: rename or move onto an existing sibling name gives 409
  `conflict_error`, nothing changed. Creating a folder under an existing name
  gives HTTP 400, not an automatically renamed folder.
- Evidence: archived evidence `runs/16-execution-B-1.md` and
  `runs/18-acceptance-1.md` (steps 3 and 7).

### Upload names

- Date: 2026-11-10 and 2026-11-11.
- Method: owner-run upload acceptance on main (63 and 65 requests).
- Result: the upload response carries `parent_id`, equal to the destination;
  `Content-Type: application/octet-stream` is accepted. A file named like an
  existing folder is answered 200 but stored under another name in the same
  folder. A decomposed (NFD) name is stored under a different name, presumably
  its NFC form; NFC names, including the compatibility ligature U+FB01, are
  stored unchanged, so no NFKC rewriting is applied.
- Evidence: archived evidence `runs/19-acceptance-1.md`,
  `runs/19-acceptance-2.md` and `runs/91-acceptance-1.md`.

## Trash and restore

### Trash metadata

- Date: 2026-11-04 and 2026-11-10.
- Method: `GET /3/drive/{d}/trash/{f}` after trashing files and folders, then a
  restore after the former parent was renamed.
- Result: a trashed item has `status` `trashed`, `deleted_at`, `deleted_by`,
  `parent_id` (former parent) and `path` (former path); `parents` is empty for
  the trashed root. Children of a trashed folder have `status`
  `trash_inherited`. `path` is a deletion-time snapshot: it does not follow a
  later rename of the former parent.
- Evidence: archived evidence `runs/16-execution-A-1.md`,
  `runs/16-execution-B-1.md` and `runs/18-acceptance-1.md` (step 6).

### Restore recreates a trashed parent

- Date: 2026-11-04.
- Method: restore of a child while its former parent was still trashed.
- Result: HTTP 200; the server created a new folder (new ID) at the former
  path and restored the child into it. Restoring the original folder then gave
  409 `conflict_error`. Restoring over a live same-name item also gives 409
  `conflict_error`, without overwrite. This server therefore restores only when
  the former parent is live.
- Evidence: archived evidence `runs/16-execution-B-1.md` and
  `runs/16-decisions-1.md`.

## Not measured

Maximum upload and download sizes, the cancel endpoint and `valid_until`
semantics, restore to an explicit destination, sharing, locks, write rate
limits, received-share ancestry, search completeness and cursor expiry remain
unmeasured.

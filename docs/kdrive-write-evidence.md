# Measured kDrive write behavior (#16)

Source: owner-authorized probes of 2026-11-04 inside one dedicated disposable
folder, with the reviewed operator (digest `cf16cc1e…db845b`) and the
[probe plan](kdrive-write-probe-plan.md). Records:
Stage A (archived evidence `runs/16-execution-A-1.md`), Stage B (archived evidence `runs/16-execution-B-1.md`),
owner decisions (archived evidence `runs/16-decisions-1.md`). Measured on one drive and one
account; these are observations, not provider guarantees.

## Routes measured

| Operation        | Method and path                                                                             | Success                       |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| Create folder    | `POST /3/drive/{d}/files/{parent}/directory`, JSON `name`                                   | 200, file object, synchronous |
| Direct upload    | `POST /3/drive/{d}/upload?directory_id&file_name&total_size&conflict`, raw body             | 200, file object, synchronous |
| Rename           | `POST /2/drive/{d}/files/{f}/rename`, JSON `name`                                           | 200, cancellable action       |
| Move             | `POST /3/drive/{d}/files/{f}/move/{parent}`                                                 | 200, cancellable action       |
| Move to trash    | `DELETE /2/drive/{d}/files/{f}`                                                             | 200, cancellable action       |
| Trashed metadata | `GET /3/drive/{d}/trash/{f}` (`with=path,parents`, `capabilities`), `GET …/trash/{f}/files` | 200                           |
| Restore          | `POST /2/drive/{d}/trash/{f}/restore`                                                       | 200, cancellable action       |

A cancellable action is `{cancel_id: string, valid_until: number}`; every
effect was visible on the immediate read-back. No response of run `r20261104c`
(Stage A session 2 and Stage B, 85 requests) carried an `ETag` header.

## Collisions (D-07)

- Upload `conflict=error` onto an existing name: **409
  `file_already_exists_error`**, original unchanged. 9/9 samples: 1 sequential,
  4 with two concurrent uploads, 4 where a half-sent upload was held while a
  second one completed. Each time exactly one object existed afterwards. The
  name is (also) checked when an upload completes: a held upload started first
  was refused once a later one had completed.
- `conflict=rename` creates `<base> (1)`. `conflict=version` keeps the ID and
  replaces the content (new version).
- Names are case-sensitive: `p16-F1` coexists with `p16-f1`.
- A file named like an existing folder was accepted (200); its stored name is
  not established.
- `total_size` larger than the body: 400 `upload_failed_error`, nothing
  created. A 0-byte upload and a 1 MiB upload were accepted.
- Rename or move onto an existing name: **409 `conflict_error`**, no change.
- `If-Match` with a bogus value is ignored on rename (applied). On an upload
  with `conflict=version` it returned 422 `validation_failed`, cause not
  established.

## Trash and restore (P-18)

- A trashed item keeps `parent_id` (former parent) and `path` (former path);
  `deleted_at` and `deleted_by` are present. `parents` is empty for an item
  trashed directly, and has one entry (depth 1) for an item inside a trashed folder (`status`
  `trash_inherited`); that entry's identity was not recorded.
- Restore with the former parent live: the item returns there with the same ID.
- Restore while the former parent is itself trashed: the server **recreates a
  new folder at the former path** (new ID) and restores into it.
- Restore onto an existing same-name item (file, or a recreated folder): **409
  `conflict_error`**, the item stays trashed, nothing is overwritten.
- Restore with `destination_directory_id` (body key from the official Android
  client): not measured.

## Capabilities

The designated folder reported `can_write`, `can_upload`, `can_create_file`,
`can_create_directory`, `can_rename`, `can_move`, `can_move_into`,
`can_delete`, `can_share` true and `can_leave`, `can_use_team` false.

## Not measured

Atomicity under every interleaving; maximum direct upload size and upload
sessions; write rate limits (none of the 85 responses of run
`r20261104c` was a 429); locks; the cancel route and
`valid_until`; restore to an explicit destination; permanent deletion (cleanup
left to the owner); sharing routes (no authorization).

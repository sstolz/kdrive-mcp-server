# Development notes

This page holds the development, process and feature-history content that was in
the README until #94. It is temporary: the planned developer documentation will
replace it. For using the server, read the [README](../README.md).

Unofficial project, not affiliated with Infomaniak.

This unreleased TypeScript package provides local configuration validation, an
injected startup-preflight boundary and isolated per-drive metadata access.
F-005 adds the accepted injected scope of a real SDK stdio runtime with trusted injected synthetic
evidence; production kDrive adaptation and entrypoint composition remain absent.
No installable release has been published.

The injected modules expose `kdrive_list_drives`, `kdrive_list`, `kdrive_info`
and `kdrive_resolve_path` through the shared guarded policy. Accepted #9 / F-006
adds `kdrive_search`, `kdrive_recents`, `kdrive_shared_with_me`, `kdrive_my_shared`
and continuation for list. Accepted #10 / F-007 provides raw content/resources.
Since #14 / F-009 (accepted on main `7b046a0`), all modes expose ten read tools including
`kdrive_read`, `kdrive_download` and one complete-binary resource template,
with no prompt; `write` and `share` modes add the five write tools of #18
and `kdrive_upload` of #19
(see [Write tools](#write-tools-pending-acceptance)). Metadata still has exactly `drive_id`, `id`,
`name`, `type` and `path`; names, paths and file content are untrusted data.

The five collections accept optional `type` and session-owned `cursor` handles.
Repeat the same arguments when resuming; omitted and explicit default drive are
equivalent. Search requires a nonempty `query`; search/recents/my-shared accept
optional `folder_id`, otherwise configured roots of the default/explicit drive
are visited in configuration order without global sorting. Received listings
omit the drive argument to discover all proved owner drives.

Each batch has at most256 items and starts at most five list-type calls, including
authorization discovery. `has_more` means unfinished work, not a promised visible
result; an empty filtered batch can carry true. `next_cursor` exists exactly
when true. Handles are single-use, session/context-bound, expire after five
minutes and can be evicted when16 traversals are retained. Invalid handles return
fixed `INVALID_CURSOR`; start a fresh traversal after a lost/expired response.
Complete received proof must fit five pages or safely refuses; retained candidate
batches never extend its sub-60-second membership cache. Recipients/links are
absent in every mode. See the [F-006 contract](../features/F-006-filtered-pagination.md).

`kdrive_download` accepts `file_id`, optional `drive_id`, `offset_bytes`,
`length_bytes` and a strong quoted `etag`. Positive byte offsets require the
previous chunk's ETag. Success has `encoding:"base64"`, `data`, decoded
`bytes_read`, `size_bytes`, `offset_bytes`, `etag`, `has_more` and, only when
unfinished, `next_offset_bytes`, plus owner IDs. Decode each complete base64
chunk and concatenate the bytes; raw offsets never count base64 or extracted
characters. Every call obtains fresh policy/version evidence. A changed version
fails rather than mixing bytes. Empty files and exact EOF return empty terminal
data; beyond EOF fails explicitly.

The binary resource `kdrive://{drive_id}/file/{id}` uses the same fresh read policy
and returns one complete `application/octet-stream` blob. It lists no concrete
resources. Query/fragment/rendering/offset parameters and noncanonical IDs/URIs
return `UNSUPPORTED_REPRESENTATION` before protected calls. Resources require the
entire file to fit; they never truncate, extract text or return MCP image blocks.
The raw tool can continue a larger file across separate calls.

Content dependencies are optional trusted injected `describe`/`open` ports.
Absent ports yield `CONTENT_UNAVAILABLE` after authorization. Qualified strong
version evidence and bounded streaming are required: #5's measured opaque ETag
equality establishes neither. No production provider can be assumed to meet this
contract. See [F-007](../features/F-007-bounded-downloads.md) and
[ADR-003](../architecture-decisions/ADR-003-bounded-raw-content.md).

Raw calls obey `maxReadBytes`, the262144-byte serialized output ceiling and
`maxOutputChars`, including base64 expansion and complete envelope overhead.
Central injected read retries permit at most three pre-body starts for branded429
or500–599 failures, waiting100/200ms, within the shared512-call, five-list-call
and10-second invocation limits. Streams never replay after partial consumption;
all opened readers close on completion, refusal or cancellation. Tools and
resource reads share one active slot. Errors/logs contain fixed sanitized text.

`kdrive_read` requires `file_id` and `format:"text"|"pdf"|"image"`; `drive_id`
is optional. Text/PDF accept `offset` (default0), `length` (maximum code points)
and a strong `etag`; positive offsets require the previous ETag. Offsets count
Unicode code points, so 😀 is one and e plus a combining accent is two. Each
call redownloads and reextracts the complete source version; repeat exactly the
same encoding/page selection and returned ETag with `next_offset`. Different
selections define different representations. No extracted-content cache or
cheap byte-range continuation is implied: bandwidth and CPU repeat in full.

Text supports strict UTF-8, UTF-16LE/BE BOM detection and explicit
`encoding:"utf-8"|"utf-16le"|"utf-16be"|"windows-1252"`. An explicit encoding
must agree with any BOM. Invalid sequences refuse instead of replacement;
one leading BOM is removed, while line endings and later BOMs are preserved.
Code, Markdown, CSV and JSON stay ordinary text without parsing/reformatting.
Binary controls and unsupported representations refuse explicitly. Successful
text JSON includes `text`, `offset`, `characters_read`, `total_characters`,
`has_more` and, only when unfinished, `next_offset`, plus owner/version/size.

PDF adds optional ordered unique `pages` (1–10, default[1]). Only a conservative
single-revision classic-xref profile is supported: direct stream lengths,
unfiltered/single-Flate streams, one unique content stream per page, simple
Helvetica/WinAnsi text operators and bounded raw RGB/gray image XObjects.
Object/xref streams, indirect lengths, predictors, Forms, embedded/CID/Type3
fonts, custom mappings, encryption, annotations and incremental PDFs refuse.
Many common valid PDFs therefore return `UNSUPPORTED_FORMAT`. All stream and
text-production admission precedes PDF.js; it receives a separately bounded
canonical uncompressed PDF. Selected page text follows dependency item order,
with LF/FF/LF between pages, without a layout/table-order guarantee. Blank or
image-only selections use `NO_EXTRACTABLE_TEXT`; no OCR or scan detection runs.

Image input supports baseline JPEG and noninterlaced8-bit RGB/RGBA PNG containing
only IHDR/IDAT/IEND chunks. Animation, ancillary PNG metadata, palette/grayscale
PNG, progressive JPEG and other formats refuse. EXIF orientation is ignored.
Success is metadata plus one complete independently decodable PNG MCP image,
fitted within512x512 without upscaling. If necessary it repeatedly halves the
whole image, at most10 encodes; base64 is never sliced or truncated. Images
forbid offset/length/pages/encoding arguments and have no continuation. Binary
resources retain their complete raw blob representation.

Complete sources fit min(maxReadBytes,8MiB). Logical expanded streams, canonical
PDF and decoded UTF-8 text each obey min(maxExtractBytes,16MiB); structural,
pixel, producer/item and finite scratch limits are separate, not an RSS claim.
Owned workers obey min(extractTimeoutMs, remaining10-second invocation deadline)
and terminate before releasing the slot. Full serialized MCP results count
both JSON escaping layers, image base64 expansion and all block overhead against
262144 UTF-8 bytes and maxOutputChars UTF-16 units. Oversize containers refuse
before partial extraction; text truncates only at whole code points.

The pinned pure-JavaScript dependencies are Mozilla pdfjs-dist6.5.438 and minimal
Jimp core/PNG/JPEG/resize modules1.6.1; Node text/zlib APIs need no external
executable. [ADR-004](../architecture-decisions/ADR-004-bounded-extraction-dependencies.md)
records the choice, alternatives and compatibility cost. Exact source-hash and
producer tests bind the PDF profile. Runtime verification inside Docker installs
with dev/optional packages omitted and proves extraction without native canvas;
the unchanged development npm-ci contract can install inactive optional canvas.
The modern PDF entry uses no native canvas, WASM, external fetching or eval.

Dependency audit (F-020, #104, accepted 2026-11-11): `package.json` overrides
make `@jimp/types` and `@jimp/plugin-resize` use the root `zod` 4 (`"$zod"`),
which removes the high Zod 3.25.76
[oversized-collection advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
and pin `minimatch` to `11.0.8` for the development tooling. Jimp declares
`zod ^3.23.8`; its runtime schemas use only APIs present in Zod 4, and the
BR-317 tests pin that behaviour through the real image route. Jimp's
declarations name Zod 3 types, so `tsconfig.json` sets `skipLibCheck: true`;
`src/extraction-image.ts` types its resize options locally because the library
type becomes `any`.
[ADR-009](../architecture-decisions/ADR-009-dependency-overrides-skiplibcheck.md)
records the choice and its residual risks. `make audit` runs
`npm audit --audit-level=high` inside `dev` and fails on any high or critical
finding; it queries the registry advisory service, so `make check` does not run
it. The CI `audit` job runs `make setup` then `make audit` on every heavy run,
and `ci-result` needs it. The overrides apply only to installs from this
repository's lockfile (`npm ci`, the container image), not to an install of the
packed tarball (see `SECURITY.md`).

This is an explicit composition boundary: compiled `navigation.js` provides
`createNavigationServer(configuration, dependencies)`, and `stdio.js` provides
`startStdioNavigation(configuration, dependencies, options)`. The configuration
must be the exact successful F-002 preflight object. Dependencies implement the
normalized F-003/F-004 ports; they are trusted injected code, not client-selected
adapters. The runner returns `ready`, `closed` and idempotent `close()`; supplied
streams are owned for the session. The default process-stdio composition owns
termination after close, including blocked output; embedded callers supply
separate owned streams. Test helpers compose synthetic evidence only outside
the package artifact. There is no synthetic CLI/environment mode.

The packaged binary still validates locally and exits 1 for ordinary stdio/HTTP
invocations with the exact accepted runtime-unimplemented diagnostic. Help and
version remain isolated. Injected-module success does not establish a production
adapter, provider qualification, #6/#7 acceptance or a release.

An injected received-share policy is implemented provisionally under
[F-004 v1](../features/F-004-received-share-policy.md). It requires explicit opt-in,
proves membership from a complete received-share list and fresh relative ancestry,
matches denies against recipient paths, and caches only that list for less than
60 seconds on reads. Every mutation simulation reloads the list and requires both
shared flags, at-least-write level and actual operation/recursive capabilities.
Re-sharing and external-root enumeration deny; common/team folders remain ordinary
configured folders. This adds no real provider access or write tool; F-005's
injected MCP registration does not qualify a production adapter/runtime:
production AC-14/AC-15 and #6 AC-19/AC-20 remain blocked and mandatory. See the
[security boundary](../SECURITY.md) for the bounded read revocation lag and races.

The development version is `0.1.0` ([VERSION](../VERSION)); changes remain under
[Unreleased](../CHANGELOG.md#unreleased) until an explicitly authorized release.

## Local development

Prerequisites: Docker with Compose (`docker compose`) and existing GNU Make 3.81
or 4.x. Node, npm, Git for fixtures, TypeScript and all quality tools run inside
the development container. No host toolchain installation is needed.

```sh
make help
make setup
make check
```

The default `make` target displays help without Docker, network or daemon access.
`make setup` builds the pinned official Node 26.13.0 Bookworm development image
and runs `npm ci` against the committed lockfile. The image verifies Node 26.13.0,
npm 11.20.0 and Git 2.39.5. The development service is separate from any future
production image and exposes no ports or Docker socket.

The checkout is mounted at `/workspace`; dependencies and npm cache use separate
project-scoped named volumes. Build output in `dist/`, package archives in
`artifacts/` and explicit lockfile updates persist in the checkout. Normal
commands run as the non-root `node` identity.

Linux users must supply their existing numeric checkout-owner identity on the
first setup, for example `DEV_UID=1000 DEV_GID=1000 make setup` with their actual
values. These variables map the image user and fresh volume permissions. CI uses
1001/1001 for its hosted Ubuntu runner. On Docker Desktop for macOS, keep the
defaults and verify that `make build` writes to the checkout. Changing identity
with existing volumes may need separately authorized volume maintenance. Setup
never recursively changes checkout ownership or deletes volumes.

## Commands and checks

| Command             | Runs inside `dev`                                                              |
| ------------------- | ------------------------------------------------------------------------------ |
| `make lint`         | `npm run lint`: type-aware ESLint, including unhandled Promises; warnings fail |
| `make format-check` | `npm run format:check`: Prettier without rewriting                             |
| `make format`       | `npm run format`: explicit formatting writes                                   |
| `make typecheck`    | `npm run typecheck`: TypeScript source, tests and quality scripts              |
| `make build`        | `npm run build`: strict NodeNext compilation to `dist/`                        |
| `make test`         | Build, then `npm test`: non-watch Vitest; zero tests fail                      |
| `make pack`         | Build, `npm pack --pack-destination artifacts`, packed artifact checks         |
| `make audit`        | `npm audit --audit-level=high` (network; not part of `make check`)             |
| `make check`        | Ordered lint, format, typecheck, build, tests, package verification            |
| `make coverage`     | Build, pinned Vitest V8 coverage, LCOV and input-digest metadata               |
| `make shell`        | Container shell for diagnosis                                                  |
| `make lockfile`     | Explicit container-only lockfile generation/update                             |
| `make oidc-qualify` | Interactive OIDC provider qualification with `ARGS="..."` (see below)          |

Focused targets require successful setup. `make check` stops on the first
failure; its five CI jobs use the same image and Make targets. Tests include
synthetic negative fixtures for quality failures and package/privacy boundaries.
The five required job names are `lint`, `format`, `typecheck`, `test`, `build`.
Local checks establish local evidence; only GitHub runs establish CI results.

For initial lockfile bootstrapping or deliberate dependency changes, run
`make lockfile` and review the resulting manifest/lockfile diff, then run
`make setup` again. Do not install tools on the host. Ordinary stopped-container
cleanup preserves data; this project provides no volume deletion or prune target.

## Diagnostic package

After building, invoke inside the development container:

```sh
make shell
# Inside the dev shell:
node dist/cli.js --help
node dist/cli.js --version
```

The published executable name is `kdrive-mcp-server`. `--help` and `--version`
exit successfully without reading deployment configuration or credentials. Ordinary
invocations validate local configuration, run production preflight against
`https://api.infomaniak.com`, then serve MCP over stdio or HTTP; any
configuration or preflight failure prints one sanitized
`Configuration error [<code>] (<setting>).` line and exits 1 (pending #70
acceptance).
The foundation client delegates only to an injected metadata adapter, binds one
positive safe-integer drive ID, validates file IDs and preserves adapter results
and errors. It supplies no production adapter.

## Configuration and injected preflight

F-002 v2 is accepted on actual main `88bf8caa7412988e11099a4a01f9e600aa38eeee`; see the
acceptance evidence (archived evidence `runs/33-acceptance-1.md`). The [configuration contract](../features/F-002-configuration.md)
lists every CLI option, environment name, YAML key, default, bound and diagnostic.

Sources replace settings in this order: CLI, environment, explicitly selected YAML,
defaults. Lists replace completely. `--config PATH` selects the only YAML file read;
relative config and audit paths resolve against the supplied working directory.
No `.env` file is loaded. Empty values are present and do not fall back. Unknown
reserved environment names, unknown YAML keys and malformed sources fail even if
a higher-priority source supplies another value. YAML accepts one bounded flat
mapping; no tags, anchors, aliases, merges or interpolation are supported.

Provide `KDRIVE_TOKEN` through the runtime environment or select an existing absolute
credential file with `--token-file` / `KDRIVE_TOKEN_FILE`. Do not place raw credentials
in CLI arguments or YAML. Each inline/file pair is selected atomically from its
highest-priority source; both members at that source conflict. All effective
configuration checks precede credential reads. Token/upstream-secret files are
bounded to 16,384 bytes and signing material to 65,536 bytes. Final symlinks,
nonregular files and identity changes fail; parent-directory symlinks are allowed.
One terminal LF or CRLF is stripped only from token/secret files. Signing bytes
are opaque: loading them proves no algorithm or cryptographic readiness.

Configure `--drive-id` or `--drive-ids`; token visibility never adds drives. With
only a list, its first drive is the default. Absent roots select folder ID 1 on
each configured drive. Present roots, such as `7:42,8:/Documents`, must cover every
configured drive and no others. YAML sequences can represent comma-containing
paths. No path or numeric ID authorizes a root before injected preflight.

The default level is `read`; `write` and `share` are cumulative. Shared reads,
shared writes and public links default off. Effective shared writes require both
shared switches plus a non-read level; effective public links require their
switch plus share level. Domain/email allowlists normalize domain case only;
subject IDs and redirect URIs remain exact. Configuration does not implement
policy enforcement or glob matching, and audit paths are never opened here.

HTTP requires an HTTPS public URL, OAuth mode and issuer, and at least one subject
or email allowlist entry. Delegate modes reject proxy-only fields. Proxy mode
requires upstream client ID, secret, signing-file reference and redirect allowlist;
its issuer must differ from the public URL. Audience defaults to the canonical
public URL and cannot identify a different resource. No discovery or verification
occurs. Explicit HTTP/OAuth fields are rejected in stdio mode.

For local unauthenticated preparation, `--http --insecure-no-auth` forces host
`127.0.0.1`, including when another valid host was supplied. Its optional public
URL must use literal loopback HTTP and the configured port. OAuth fields are
forbidden. This prepares configuration only and opens no listener.

For future composition, `loadConfiguration({ argv, env, cwd, readFile })` returns
`LocalConfiguration`. Only `preflightConfiguration(local, resolver)` returns the
separate `ResolvedConfiguration` type. The injected resolver inspects all configured
drives for exact role `admin` before resolving any selector. It validates same-drive
directories and exact numeric-root ID equality, collapses resolved duplicates,
and never returns partial readiness. There is no production resolver; future
runtimes must complete this step before exposing tools or binding listeners.

## Mutation audit log (pending acceptance)

[F-016](../features/F-016-mutation-audit-gate.md) (#17) adds the audit gate that the
write and share tools (#18–#20) use; the #18 write tools are described below. In
`write` and `share` modes the server opens `KDRIVE_MCP_AUDIT_LOG` at startup:
`stderr` (default) or an absolute file path, created with mode `0600`. An
existing file must be a regular file owned by the server's user with no group or
other permission bit, or startup stops. `read` mode never opens it.

Each write gets one JSON line before it is sent (`intent`) and one after
(`outcome`), sharing an `op` ID; a denied write gets one `denied` line. Records
carry the time, the identity (`stdio`, the OAuth issuer and subject, or
`insecure`), the tool, the operation kind and the drive and item IDs, never
names, paths, content or secrets. If the intent cannot be written, nothing is
sent. Only HTTP 429 is retried; a timeout, a lost response or a 5xx returns
`uncertain` (verify the item before retrying).

- In a container, a file audit log needs a writable mount (the root file system
  is read-only) and `stop_grace_period` must be at least 75 s in `write` and
  `share` modes, so in-flight writes can record their outcome; see
  [deployment](deployment.md#write-and-share-modes-audit-log).
- After an HTTP 503 during shutdown, or a response dropped after a client
  cancellation, the audit `outcome` record is the authority on whether the write
  was performed.
- With `stderr`, records are as durable as whatever collects stderr, and a
  collector that stops reading holds the pending write; use a file for a durable
  trail.
- `KDRIVE_MCP_SHARED_WRITE=1` does not authorize writes in received shares yet.

## Write tools

[F-017](../features/F-017-controlled-tree-mutations.md) (#18) adds five write
tools that exist only in `write` and `share` modes (`read` mode lists the ten
read tools only): `kdrive_create_folder`, `kdrive_rename`, `kdrive_move`,
`kdrive_trash` and `kdrive_restore`. Each call passes the policy and the audit
gate above and returns the gate result (`succeeded`, `failed`, `uncertain` or
`denied`); after `uncertain`, check the item with a read tool before any new
attempt.

- This server never requests permanent deletion: `kdrive_trash` moves an item
  to the kDrive trash and no route empties the trash or deletes for good.
- `kdrive_restore` returns an item only to its former parent, and only when
  that parent is live and authorized; otherwise the restore is refused. A
  folder restore is refused while deny patterns are configured (the trashed
  tree cannot be enumerated).
- Configured roots cannot be trashed, renamed or moved.
- `kdrive_move` stays inside one drive and does not rename.
- Received-share writes stay refused, even with `KDRIVE_MCP_SHARED_WRITE=1`.
- A check-then-act window remains (SPEC §10.6): the drive can change between
  the check and the write. If the former parent is trashed between the check
  and a restore, kDrive recreates a folder at the former path and restores into
  it; when that former parent is a configured root, the recreated folder has a
  new ID outside every configured root. If an item is trashed between the check
  and a trash request, the effect of `DELETE /2/drive/{d}/files/{f}` on the
  already trashed item is unmeasured.
- Residual risk R-17-1 (not observed on the measured server): restore
  authorizes the former parent's current path, so an item trashed under a denied
  folder that is renamed or moved out of the deny patterns outside this server
  could be restored if kDrive recomputed the trash `path`; owner acceptance on
  2026-11-10 (step 6) observed a deletion-time snapshot, so such a restore was
  denied.
- Residual risk R-17-2: the root protection covers only a configured root
  targeted directly. With nested roots, trashing, renaming or moving an
  authorized folder of an outer root that contains an inner configured root
  also affects that inner root, and with deny patterns the trashed folder
  cannot be restored through this server.

The owner checks the tools against the real API with
`make kdrive-write-acceptance KDRIVE_WRITE_FOLDER=<id>` (actual main,
`KDRIVE_ACCEPTANCE_DIR`); every fixture stays in that folder or in the trash.

### Upload

[F-018](../features/F-018-upload.md) (#19) adds `kdrive_upload`, which exists only in `write` and `share` modes. It takes `text`
(sent as UTF-8) or canonical `base64`, at most 524,288 decoded bytes; over
HTTP the 262,144-byte MCP request body limit is lower. The call passes the
policy and the audit gate, and the resulting path `parent_id`/`name` is
checked against the deny patterns.

- `overwrite:false` (the default) asks kDrive to refuse an existing file of
  the same name (`conflict=error`). That refusal is observed kDrive behaviour
  (9 of 9 measured samples, checked when the upload completes), not a
  guarantee of this server. Names are case-sensitive.
- `overwrite:true` requires `file_id`, the existing file called `name` in
  `parent_id`; the policy checks that binding against live metadata, and the
  file's content is replaced in place under the same ID
  (`conflict=version`).
- An `uncertain` upload is never replayed; check the file with a read tool
  before any new attempt.
- Received-share uploads stay refused, even with `KDRIVE_MCP_SHARED_WRITE=1`.
- Names given to `kdrive_upload`, `kdrive_create_folder` and `kdrive_rename`
  must be in Unicode NFC (composed form); other forms are refused with
  `INVALID_ARGUMENTS`. An existing file whose name is not NFC must be renamed
  to its NFC name before it can be overwritten.
- Deny patterns match the exact stored code points. Write the NFC form of a
  non-ASCII pattern to cover names these tools create, and keep (or add) the
  stored form for any existing item whose name is not NFC; replacing a
  working NFD pattern by its NFC form alone would drop the deny for those
  items, reads included.
- The 524,288-byte bound applies to the decoded bytes, while the transport
  limit (1 MiB stdio frame, 262,144-byte HTTP body) applies to the
  JSON-encoded request. `text` that JSON escaping enlarges (quotes,
  backslashes, control characters, or non-ASCII escaped as `\uXXXX` by the
  client) can be refused by the transport below 524,288 bytes: over HTTP the
  request gets HTTP 413; over stdio a frame above 1 MiB terminates the server
  with `STDIO_INPUT_FAILED` and no MCP error. An upload already in flight
  completes and its outcome is recorded in the audit log before exit, but its
  tool result is not delivered. Use `base64` for large or non-ASCII content.
- Residual risk R-18-1: the `conflict=error` refusal is not proven under every
  interleaving; a concurrent writer could still win a race this server cannot
  see.
- Residual risk R-18-2 (check-then-act, SPEC §10.6): between the check and a
  replace, the target can be renamed or moved and another file can take its
  name; kDrive then writes that file at the same authorized path and the
  result is `uncertain`. A destination renamed into a deny pattern between
  check and upload is not detected; a destination moved or trashed out of the
  configured roots between check and write is still reported `succeeded`.
- Residual risk R-18-3 (accepted): kDrive stores a file named like an
  existing folder under another name in the same folder (observed); that
  name is not checked against the deny patterns. The result is `uncertain`
  and nothing is replayed.
- Residual risk R-18-4: kDrive keeps or discards the replaced content
  according to its own version history, which this server neither reads nor
  guarantees.
- Residual risk R-18-5: kDrive stored a decomposed (NFD) name under a
  different name. Names must now be in NFC (see above), and the owner
  acceptance showed NFC names, including a compatibility ligature, stored
  unchanged. Other name rewriting, not tested, would still store a file at a
  path this server did not check: reported `uncertain` for upload and folder
  creation, but `succeeded` for rename, which reads no name back.

The owner checks uploads against the real API with
`make kdrive-upload-acceptance KDRIVE_WRITE_FOLDER=<id>` (actual main,
`KDRIVE_ACCEPTANCE_DIR`); every fixture stays in that folder.

## Abstract configured-tree policy (pending acceptance)

[F-003 v1](../features/F-003-tree-access-policy.md) adds an injected policy core in
`src/policy/`, separate from the executable. It accepts only the exact successful
preflight configuration object and snapshots its policy settings. The composition
root injects fresh normalized inspection, child-page, collection and execution
ports. There is no production adapter or actual MCP tool/resource registration.
Synthetic tests establish only the abstract contract; AC-19/AC-20 and ticket #6
remain pending until qualified production integration is accepted.

`createPolicy(config, dependencies)` exposes `check(operation)` and
`dispatch(operation)`. A check returns an internal bounded decision and conveys
no reusable grant. Consumers use dispatch with a registered operation; both
future tools and resources must receive this same facade, with no raw adapter or
arbitrary execution callback. Dispatch freezes the exact operation before any
evidence await, authorizes all effects, then invokes its injected protected port
immediately. Refusals return only `ACCESS_DENIED`; execution failures propagate
because a failed write may already have taken effect. No automatic retry occurs.

Roots remain bound to their preflighted drive/folder IDs. Evidence must prove
complete consistent live ancestry and paths; restore instead requires distinct
original-trash proofs. Denies match full case-sensitive paths without decoding
or Unicode normalization. `/private/**` includes the directory and descendants;
`/private` matches only that exact path. Folder mutations with denies require a
complete descendant proof and refuse on the Nth entry, where N is
`maxTreeItems`. Empty denies skip traversal. Folder sharing uses a conservative
symmetric literal-prefix conflict test, including `/a` versus `/ab/**` and
patterns with no literal prefix. All received-share/external access is refused
in this feature, including with shared-access switches enabled.

Fresh checks precede protected operations, but the provider can change between
inspection and execution. Multi-page traversal cannot prove a concurrent atomic
snapshot; detectable inconsistencies refuse while undetectable races remain.
Immediate dispatch narrows this window without eliminating it. A production port
must supply qualified bounded cancellation/timeouts before acceptance. See
[SECURITY.md](../SECURITY.md) and the [pending rule index](../business-rules/README.md).

## OIDC provider qualification (pending acceptance)

[F-008 v1](../features/F-008-oidc-qualification.md) adds the access-token
validator in `src/auth/` that P-12 will reuse, and a development-only command
that qualifies an OIDC provider for the HTTP modes of [SPEC §8](../SPEC.md):

```sh
make oidc-qualify ARGS="discover --issuer https://idp.example --label infomaniak"
make oidc-qualify ARGS="token --issuer https://idp.example --client-id <id> \
  [--client-secret-prompt] --redirect-uri http://127.0.0.1:8080/callback \
  --resource https://mcp.example/mcp [--scope <extra>]... \
  [--allow-subject <sub>]... [--allow-email <email>]... --label infomaniak"
```

The owner runs it on their own machine; it needs an interactive terminal. The
`token` step prints the authorization URL, waits for the pasted redirect URL and
exchanges the code. A client secret is read only from a no-echo prompt; the
command refuses to start when any `*CLIENT_SECRET*` environment variable is set.
The redacted report is written under the ignored
`artifacts/oidc-qualification/` directory and never contains tokens, codes,
secrets or identity values. The command and reports stay out of the npm package.

The per-client decisions come from the dated
[MCP client compatibility matrix](mcp-client-compatibility.md). Provider
results and real client tests remain pending owner-run acceptance (#11).

## Conditional remote analysis

`make coverage` is local and needs no Sonar configuration. `make sonar` and
`make quality` opt into an official SonarScanner container for the project
`kdrive-mcp-server`, as fixed by reviewed `sonar-project.properties`. The server
address is not tracked: the scanner host comes from `SONAR_HOST_URL` (a GitHub
Actions secret in CI, the environment locally) or from an external
`SONAR_HOST_URL_FILE`. It must be an absolute canonical `https` URL without
credentials, query or fragment, and it is never printed: the wrapper redacts the
host name from scanner output and fails before upload if an analysed file under
`src/` or `tests/` names it. Use the already provisioned Project analysis token.
The official scanner handles authentication, analysis and its own Quality Gate
wait; no project creation or broader credential is used. The only custom Sonar
Web API reads are the failure summary below, made with the same token.

Use an isolated actual Git checkout of the canonical repository, with clean
`main` HEAD matching the current trusted `origin/main` SHA. The provisioned
credential and host files must remain outside that checkout. Select their
existing absolute paths:

```sh
SONAR_ENABLED=true SONAR_TOKEN_FILE=/absolute/external/path/.config/qube-token \
  SONAR_HOST_URL_FILE=/absolute/external/path/.config/sonar-host-url make sonar
```

Do not source or copy these files. Only the analysis service mounts them
read-only; the scanner-image Node wrapper loads them in memory. The dev
container and the snapshot `prep` container never receive the token, the host or
their mounts. Alternatively, supply `SONAR_TOKEN` and `SONAR_HOST_URL` through
the runtime environment and leave the file variables unset. Selecting both modes
of either value fails. `.env.example` contains empty names only and is not
loaded automatically. Never place values in `.env`, command arguments, logs,
tracked properties or configuration dumps.

Before any dev prerequisite, every analysis target rejects an existing or
symlinked `.config/qube-token` or `.config/sonar-host-url` inside the active
checkout, and any Compose override file or `.env`. File modes also reject
relative paths, final file symlinks and physical paths inside the checkout,
including directory-symlink/`..` aliases. Use a separate clean checkout rather
than moving or deleting the provisioned files. After that guard, `make quality`
runs `make check` before `make sonar`.

Analysis regenerates coverage from an immutable committed snapshot and checks
source/test/config/lockfile digests before upload. Snapshot preparation runs in
a `prep` service (the dev image) with the checkout mounted read-only and only
`artifacts/sonar-input` writable. With `SONAR_PRISTINE_TAR` (an external
`git archive` of the analysed commit, required in CI), the entry script compares
the whole snapshot, minus generated coverage/build entries, with that archive
before the analysis container starts; a local run without it prints a notice and
skips that comparison. The pinned official Scanner CLI 8.1.0.6389 image uses
`linux/amd64`; an ARM Docker host needs Docker's amd64 execution support. The
scanner waits up to 300 seconds for its own Quality Gate. One 15-minute deadline
includes snapshot preparation, build, fresh coverage, analysis and waiting.
Failed gates, processing/network errors and timeouts fail the command;
diagnostics preserve the scanner error after token and host redaction.

### CI analysis and the PR Quality Gate

CI analysis stays off until the owner sets the repository variable
`SONAR_ENABLED=true`. On trusted `main` push or manual events, the `sonar` job
runs after all five gates with `SONAR_HOST_URL` and `SONAR_TOKEN` (project
`kdrive-mcp-server`). On every pull request, the `sonar-pr` job runs after the
gates: a same-repository pull request runs `make sonar-pr`, which analyses the
merge commit into the dedicated project `kdrive-mcp-server-pr` with
`SONAR_PR_TOKEN` and fails when that project's Quality Gate fails. SonarQube
Community Edition has no branch analysis, so the PR project shows only the last
analysed pull request. A fork pull request receives no secret and fails with a
fixed message; re-push reviewed fork or bot changes to a same-repository branch.
While `SONAR_ENABLED` is not `true`, `sonar-pr` prints a "PR Quality Gate
disabled" notice and runs no analysis. Both jobs export a pristine archive before
`make setup` and compare the working tree with it before any step that receives a
secret. This repository's plan has no branch protection, so a failing or
cancelled `sonar-pr` blocks the merge by the review workflow (all checks green),
not by GitHub; the owner can require the checks if the plan later allows it.

Owner prerequisites before enabling CI analysis: configure the Quality Gate
`kdrive-pr-gate` on `kdrive-mcp-server-pr` (overall code; Reliability, Security
and Maintainability rating A; no hotspot or coverage condition), and run one
baseline analysis of the current code into that project with
`-Dsonar.projectKey=kdrive-mcp-server-pr`, which must pass the gate. See
[F-011](../features/F-011-pre-merge-quality-gates.md) and
[ADR-005](../architecture-decisions/ADR-005-pr-quality-gate-community-edition.md).

Generated snapshots remain under ignored `artifacts/sonar-input/`; the scanner
mounts the current immutable snapshot read-only. No target removes old snapshots
or named volumes.

### Quality Gate failure summary

When the scanner exits nonzero (for example `QUALITY GATE STATUS: FAILED`), the
analysis wrapper prints a short summary in the same `sonar` or `sonar-pr` log,
so the failure can be diagnosed without the dashboard
([F-022](../features/F-022-sonar-gate-summary.md)). It runs only on a nonzero
exit, only with verified task metadata of that run, within 60 seconds and before
the 15-minute deadline, and it always keeps the scanner's exit code. It reads
the task (`api/ce/task`), the Quality Gate conditions of that analysis
(`api/qualitygates/project_status`) and, when a condition failed, the open
issues (`api/issues/search`) with the existing analysis token. Line formats:

```text
Quality Gate summary: <projectKey> status <status>
- condition <metricKey> <comparator> <errorThreshold>: actual <actualValue>
- <N> more conditions not shown
Quality Gate issues: current open issues of <projectKey> (may include another analysis of this project).
- issue <severity> <type> <rule> <file>:<line> <message>
- <N> more issues not shown
```

At most 20 failed conditions and 20 issues print. Without `severity` and `type`,
an issue shows up to three `<softwareQuality>:<severity>` impacts, or `-`.
Server text is escaped (`\\` for a backslash, `\uXXXX` or `\u{X…}` for
control, format, bidirectional and line-separator characters), the host and the
token are redacted as `[REDACTED]`, and fields are cut at 100 code points (200
for the message). The issues request is narrowed to the software qualities
(or legacy issue types) of the failed conditions, for example
`impactSoftwareQualities=RELIABILITY` for a failed
`software_quality_reliability_rating`; an unmapped metric such as `coverage`
leaves it unfiltered. Issue lines are the project's current open issues, not bound
to the analysed task: for `kdrive-mcp-server-pr` they may include
another pull request's latest analysis.

A failure prints one fixed line and no response body, URL, host or token:
`Quality Gate summary unavailable: <reason>.`, where the reason is
`no verified task metadata`, `<stage> stage failed`, `<stage> stage failed
(HTTP <status>)`, `<stage> stage failed (unexpected response)` (stage `task`,
`conditions` or `issues`), `time limit reached` or `internal error`.

Degraded mode: a Project analysis token can read the task and the conditions
but not the issues, which need Browse permission. The issues request then
prints, after the conditions:

```text
Quality Gate issues unavailable (HTTP 403): the token may lack Browse permission on the project.
```

Upgrade path: the owner replaces the `SONAR_TOKEN` and `SONAR_PR_TOKEN` secrets
with a user token holding Browse (and Execute Analysis) on the project; this
needs no code change.

## Licensing and contribution

The [read API evidence dossier](kdrive-read-evidence.md) separates historical
observations, current public sources and unmeasured cases. Its
[bounded read-only probe plan](kdrive-read-probe-plan.md) awaits approved
fixture access; the included examples are invented and contain no account data.

Original project code uses the [MIT license](../LICENSE). [NOTICE](../NOTICE) records
the pinned upstream comparison baseline and dependency licensing. No upstream
implementation is copied into this foundation; P-05 owns adaptation/provenance.
The official SDK v2 dependency is Apache-2.0 and installs its own license files.

Follow [AGENTS.md](../AGENTS.md) and [PROJECT.md](../PROJECT.md), the [specification index](spec-index.md),
the [business-rule index](../business-rules/README.md),
[issues](https://github.com/sstolz/kdrive-mcp-server/issues) and
project board (archive project board). Product work needs a
reviewed frozen contract, tests first, local checks, PR/CI, independent review and
acceptance on the actual merged main SHA. Release and publication require the
user's explicit authorization.

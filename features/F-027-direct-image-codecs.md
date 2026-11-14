---
id: F-027
title: Direct image codecs without Jimp
ticket: "#12"
status: frozen
version: 2
---

# F-027 — Direct image codecs without Jimp

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-13.
Version 1 frozen 2026-11-13 (autonomous mode, PROJECT.md D-1) on reviewed
revision `cf27035` after spec reviews 1 (`changes`), 2 and 3 (`approve`),
published on #12; kept in `features/history/F-027-v1.md`. Version 2
(2026-11-14) changes only the BR-321 v4 changelog selection and AC-12, see
`## Stress-test`, Implementation; it is frozen after an independent review
published on the pull request.
Base: branch `claude/beautiful-maxwell-8mdk2w`, based on `main` at
`768f1b6`. IDs: F-027, BR-389–BR-392 v1, BR-122 v3, BR-315 v2, BR-318 v2,
BR-320 v3, BR-321 v4; BR-317 superseded by BR-390; ADR-010 (supersedes
ADR-009 and the image-codec part of ADR-004, whose texts stay unchanged).
`#12` is this repository's ticket. Next free IDs re-checked on `main` at
`768f1b6` (again after review 1, `origin/main` still `768f1b6`): F-027,
BR-389, ADR-010.

## Context

`kdrive_read` with `format: image` (F-009, BR-116) decodes an admitted PNG
or JPEG, scales it to fit 512 × 512 with nearest-neighbour sampling, and
halves it until the PNG result fits the output ceiling
(`src/extraction-image.ts`, `extractImage`). It does so through four Jimp
1.6.1 modules: `@jimp/core` (`createJimp`), `@jimp/js-png`, `@jimp/js-jpeg`
and `@jimp/plugin-resize`. Every `@jimp/*` package depends on `@jimp/types`,
which depends on `zod ^3.23.8`, and `@jimp/plugin-resize` depends on
`zod ^3.23.8` directly. Jimp 1.6.1 is the latest release.

F-020 (#104, ADR-009) moved that nested Zod 3 onto the root Zod 4 with
`package.json` `overrides` (BR-315) and set `skipLibCheck: true` because
Jimp's declarations name Zod 3 types (BR-318). npm applies `overrides` only
in the root project. The container image (`npm ci` on the lockfile) is
covered, but an install of the packed tarball or of the published package
(`npm install -g`) resolves its dependencies afresh and gets
`zod@3.25.76` under `@jimp/types` and `@jimp/plugin-resize`, with the high
advisory GHSA-mrhx-c7xc-m3w5 (affected `<4.6.6`, no fixed 3.x).
`SECURITY.md` states this limit (BR-321 v3), and the owner accepted it for
the beta as residual risk (f) of F-024 v2, to be fixed before 1.0 in #12.
F-024 v1 tried to carry the audited tree into installs with a generated
`npm-shrinkwrap.json`; an install of that tarball still resolved
`zod@3.25.76` under both Jimp packages, and the shrinkwrap was withdrawn
(F-024 v2, D-14 withdrawn, BR-376/BR-377 withdrawn).

Users affected: anyone who installs the npm package (`npm install -g
@sstolz/kdrive-mcp-server` or the packed tarball) gets a dependency tree
with a known high advisory. Container users are not affected today.
Contributors are affected by `skipLibCheck: true`, which hides errors in all
third-party declarations.

What the image route uses from Jimp, read from the installed 1.6.1 sources
(`@jimp/js-png`, `@jimp/js-jpeg`, `@jimp/plugin-resize` `dist/esm`):

- **PNG decode.** `png().decode(bytes, { checkCRC: true })` is
  `PNG.sync.read(bytes, { checkCRC: true })` of `pngjs`, returning
  `{ data, width, height }` (RGBA, 4 bytes per pixel).
- **JPEG decode.** `jpeg().decode(bytes, options)` is
  `JPEG.decode(bytes, options)` of `jpeg-js` with the options unchanged:
  `{ tolerantDecoding: false, maxResolutionInMP: 1048576 / 1000000,
maxMemoryUsageInMB: 32 }`.
- **PNG encode.** `png().encode(bitmap)` with no options creates
  `new PNG({ width, height })`, assigns `png.data = bitmap.data` and returns
  `PNG.sync.write(png, { deflateLevel: 9, deflateStrategy: 3,
filterType: -1, colorType: 6, inputHasAlpha: true })` (`filterType` −1 is
  `PNGFilterType.AUTO`, `colorType` 6 is `PNGColorType.COLOR_ALPHA`).
- **Resize.** `image.resize({ w, h, mode: NEAREST_NEIGHBOR })` validates the
  options with Zod, rounds `w` and `h` (`Math.round(x) || 1`, a no-op for the
  positive integers the route passes), allocates
  `Buffer.alloc(w * h * 4)` and runs `operations.nearestNeighbor(src, dst)`:
  for each destination row `i` and column `j`,
  `iSrc = Math.floor((i * hSrc) / hDst)`,
  `jSrc = Math.floor((j * wSrc) / wDst)`, and the 4 bytes at
  `(iSrc * wSrc + jSrc) * 4` are copied to `(i * wDst + j) * 4`. The image's
  bitmap is replaced by the destination, so each later resize in the halving
  loop samples the previous, already resized bitmap, not the decoded one.
- **Core.** `new Jimp({ data, width, height })` stores the bitmap as given;
  no other Jimp code runs on the route.
- **Fixture encoders.** The tests build fixtures with Jimp's encoders and no
  options: `png().encode(bitmap)` is the PNG encode call above, and
  `jpeg().encode(bitmap)` is `JPEG.encode(bitmap, 100).data` of `jpeg-js`
  (default `quality = 100`).
- **Error path.** `extractImage` does not catch codec exceptions: a decode
  error rejects its promise with the codec's own `Error`, and the extraction
  worker maps any error that is not a `ContentFailure` to
  `CONTENT_UNAVAILABLE` (`src/extraction-worker.ts`, the `catch` around the
  route). A probe on the base (dev container, linux/amd64 host, Node
  v26.13.0, 2026-11-13) built inputs that pass `preflightImage` but fail in
  the codec and ran them through `extractImage` and `kdrive_read`: a 4 × 2
  colour-type-6 PNG whose first scanline has filter type 5 (valid CRCs,
  exact inflated length) rejects with `Error: Unrecognised filter type - 5`;
  a JPEG whose first DHT segment has its 16 code-length counts set to
  `[1, 0, …, 0]` rejects with `Error: Could not recreate Huffman Table`; a
  JPEG cut 8 bytes after the SOS segment and closed with `FF D9` rejects
  with `Error: unexpected marker: ffd9`; each returns the tool error
  `CONTENT_UNAVAILABLE` through `kdrive_read`. A PNG with a bad CRC or a bad
  IDAT stream cannot reach the codec: `preflightImage` checks every chunk CRC
  and inflates the IDAT stream to its exact length first. A JPEG whose
  entropy bytes are overwritten with zeros (no new marker) decodes without
  error, so it is not an error case.

The codecs have no dependencies of their own: `pngjs` 7.0.0 and `jpeg-js`
0.4.4 (the versions Jimp resolves in the lockfile) declare none.
`@types/pngjs` 6.0.5 is already a devDependency; `jpeg-js` ships its own
`index.d.ts`. A feasibility probe in the dev container (2026-11-13, not
product code) re-implemented the resize and the encode call directly on
`pngjs` and compared them with the Jimp path for 600 × 400, 1023 × 7,
513 × 513 and 3 × 1000 noise bitmaps through six chained halving steps: the
encoded PNG bytes were identical in every case. A second probe type-checked
the three codec calls against `@types/pngjs` and `jpeg-js` with
`skipLibCheck: false` and the project's strict options: no error. Running
`tsc --noEmit -p tsconfig.json --skipLibCheck false` on the base reports
errors only in `@jimp/types` and `@jimp/plugin-resize` declarations.

`tests/package.test.ts` (run by `make pack`, part of `make check`) packs a
temporary copy of `dist/`, `LICENSE`, `NOTICE`, `README.md` and
`package.json` with `npm pack --json --ignore-scripts`, unpacks it with
`tar`, and runs the packed CLI's diagnostics after copying the locked
`node_modules/yaml` in; it never runs `npm install` and needs no network.
An install of the tarball resolves the dependency tree from the npm
registry, so the new check needs the network, like `make audit` (BR-319),
and cannot be part of `make check`.

## Scope

1. **Characterization first.** Before any source change, a new test file
   `tests/image-characterization.test.ts` pins the current outputs of
   `extractImage` (width, height and SHA-256 of the returned PNG bytes) for
   the seven inputs of AC-01, and the error outcomes of the three inputs of
   AC-14, and passes on the Jimp path. It generates its inputs with `pngjs`,
   `jpeg-js` and `node:zlib` only, so it runs unchanged after the switch
   (BR-390, BR-391). The same commit adds the fixture helper
   `tests/helpers/image-codecs.ts` (item 6).
2. **Install check first.** `scripts/install-check.ts` and
   `make install-check` (BR-392) are added and run on the Jimp path before
   the switch; that run fails and lists the nested `zod` 3.25.76 (AC-10).
3. **Codec switch.** `src/extraction-image.ts` imports `PNG` from `pngjs`
   and the default export of `jpeg-js`, calls them exactly as BR-390 states,
   and resizes with a local exported function `resizeNearest` (BR-391). The
   local `ImageResizeOptions` type and every `@jimp/*` import are removed.
   Admission (`preflightImage`), limits, the target size and the halving
   loop are unchanged.
4. **Dependencies.** `package.json` drops the four `@jimp/*` dependencies,
   adds `pngjs` `7.0.0` and `jpeg-js` `0.4.4` as exact `dependencies`, keeps
   `@types/pngjs` a devDependency, and drops both `@jimp/*` keys from
   `overrides` (BR-389, BR-315 v2). `package-lock.json` is regenerated with
   `make lockfile` and still satisfies BR-316 v1 unchanged.
5. **Type checking.** `tsconfig.json` drops `skipLibCheck` (BR-318 v2).
6. **Tests.** A new helper `tests/helpers/image-codecs.ts` exports
   `encodePng(bitmap)`, which returns `PNG.sync.write` of a
   `new PNG({ width, height })` with `data` set to `bitmap.data` and the
   BR-390 encode options (Jimp's `png().encode` defaults), and
   `encodeJpeg(bitmap)`, which returns `encode(bitmap, 100).data` of
   `jpeg-js` (Jimp's `jpeg().encode` default quality 100), so every fixture
   keeps the bytes Jimp produced (AC-01 pins them). It also exports
   `decodePng(data)`, which returns `{ data, width, height }` of
   `PNG.sync.read(data)`, and `decodeJpeg(data, options)`, which returns
   `jpeg-js` `decode(data, options)` (Jimp's pass-through), so the tests'
   `png().decode` and `jpeg().decode` calls keep their assertions. Every `@jimp/*`
   reference in the tests changes, file by file:
   - `tests/read-image.test.ts`: the imports at lines 2–3 become the helper;
     the route test at line 149 (`TestBR317_jimp_on_root_zod image route
     resizes a 600 x 400 PNG to 512 x 341`) is kept with its assertions and
     renamed `TestBR390_codec_calls image route resizes a 600 x 400 PNG to
     512 x 341`; the AC-02 and AC-03 tests are added;
   - `tests/read-wire.test.ts` line 2 and `tests/read-review1.test.ts`
     line 172 (dynamic import): the helper, assertions unchanged;
   - `tests/read-dependencies.test.ts`: the `@jimp/js-png` import at line 14,
     used by the packed-runtime test at line 139 (`TestBR122_pure_js_dependencies
     packed-runtime composition ...`), becomes the helper with that test
     otherwise unchanged; the imports at lines 15–17, `jimpZod` and the three
     `TestBR317_jimp_on_root_zod` tests are removed with BR-317; the
     `TestBR122_pure_js_dependencies` lockfile test drops its Jimp
     schema-surface and root-Zod checks and is renamed (AC-05);
   - `tests/dependency-audit.test.ts`: the `@jimp/plugin-resize` imports at
     lines 3–4 and the BR-318 type-level tests on `ResizeOptions` and
     `ImageResizeOptions` are removed with BR-318 v1 (the BR-318 v2 test
     replaces them); the `@jimp/types` and `@jimp/plugin-resize` override
     expectations (the expected overrides object, the parameterized override
     test and the override loop) follow BR-315 v2 (AC-06); the nested
     `@jimp/types/node_modules/zod` mutation of the BR-316 test stays a
     synthetic lock key (data, not an import); the BR-389 and BR-392 tests
     are added.
   `tests/image-characterization.test.ts` and `tests/dev-environment.test.ts`
   get the tests AC-01, AC-14 and AC-09 name.
7. **CI.** The `audit` job of `.github/workflows/ci.yml` gets a fourth step
   `run: make install-check` (BR-320 v3).
8. **Documentation.** `SECURITY.md` `## Dependency audit`,
   `docs/development.md` (the dependency list, the dependency-audit
   paragraph, and a `make install-check` row in the Make target table),
   `CHANGELOG.md` (a `### Fixed` and an `### Added` line, BR-321 v4),
   `capability-map.md` (the two Jimp/Zod sentences), and `BACKLOG.md` (the
   2026-11-11 tarball-install line, removed as done).
9. **Records.** ADR-010 (new, accepted with the feature) records that it
   supersedes ADR-009 and the image-codec choice of ADR-004. ADR-004 and
   ADR-009 are not edited (AGENTS.md §7: an accepted ADR never changes).
   `docs/spec-index.md` records the supersession in its ADR prose, after the
   ADR-009 sentence: `#12 allocates [ADR-010](../architecture-decisions/ADR-010-direct-image-codecs.md)
(direct image codecs, F-027), which supersedes ADR-009 and the image-codec
choice (Jimp modules) of ADR-004; ADR-004 and ADR-009 keep their text.`,
   with the acceptance SHA added at closure as for the other ADRs, and its
   next unused ADR identifier becomes ADR-011. BR records: BR-389–BR-392
   created; BR-122, BR-315, BR-318, BR-320, BR-321 versioned with History
   lines; BR-317 marked `superseded by BR-390`; `business-rules/README.md`
   and the F-027 row and allocation sentence of `docs/spec-index.md`
   updated.

### Out of scope

- Any change to admission, limits, target size, halving, output format or
  error codes of the image route (BR-116, BR-119, BR-120 unchanged).
- Other image formats, other resize strategies, EXIF handling.
- `release.yml` and the `make release-*` targets: the release already
  requires green CI on the tagged commit (F-024), which now includes the
  install check through `ci-result` → `audit`.
- Publishing a new version; bumping `VERSION`.
- The `minimatch` override (development tooling only; kept as is).
- Upgrading Node or the codecs. The pinned PNG-byte digests of AC-01 depend
  on the deflate output of the Node zlib in the dev image, and linux/amd64
  is their reference architecture (the CI runners and the probe host); the
  inflated-IDAT digests and the dimensions do not depend on zlib. A later
  Node upgrade that changes deflate output updates the PNG-byte digests in
  its own ticket, and the unchanged inflated-IDAT digests show that the
  pixels and filters did not change.
- Changing the error path of the image route: codec errors keep reaching the
  worker's existing `CONTENT_UNAVAILABLE` mapping (BR-390, AC-14).
- A grayscale (1-component) JPEG characterization input: `jpeg-js` encodes
  only 3-component JPEGs, and no generator is available without a new
  dependency. The grayscale-to-RGBA conversion happens inside `jpeg-js`, and
  BR-390 keeps the identical call (D-7).

## Business rules

- **BR-389 v1** — `package.json` has no key starting with `@jimp/` in
  `dependencies`, `devDependencies` or `overrides`; `dependencies.pngjs` is
  exactly `7.0.0` and `dependencies["jpeg-js"]` exactly `0.4.4`.
  `package-lock.json` has no `packages` key containing `node_modules/@jimp/`,
  and has `node_modules/pngjs` at `7.0.0` and `node_modules/jpeg-js` at
  `0.4.4`. No `.ts` file under `src/`, `tests/` or `scripts/` imports a
  module specifier starting with `@jimp/`. Verified by: AC-04.
- **BR-390 v1** (supersedes BR-317 v1) — `extractImage` decodes an admitted
  PNG with `PNG.sync.read(bytes, { checkCRC: true })` of `pngjs` and an
  admitted JPEG with `decode(bytes, { tolerantDecoding: false,
maxResolutionInMP: 1048576 / 1000000, maxMemoryUsageInMB: 32 })` of
  `jpeg-js`, with exactly these option objects; it keeps the existing check
  that the decoded width, height and data length match the preflight plan.
  It encodes every attempt with `new PNG({ width, height })` of `pngjs`,
  `data` set to the current RGBA bitmap, and
  `PNG.sync.write(png, { deflateLevel: 9, deflateStrategy: 3,
filterType: -1, colorType: 6, inputHasAlpha: true })`. Through
  `kdrive_read`, a 600 × 400 white PNG is returned as a 512 × 341 PNG.
  `extractImage` does not catch, wrap or translate an exception thrown by
  `pngjs` or `jpeg-js`: it rejects with that exception unchanged (an `Error`
  that is not a `ContentFailure`), and `src/extraction-worker.ts` keeps its
  mapping of such an error to `CONTENT_UNAVAILABLE` unchanged. Verified by:
  AC-01, AC-02, AC-14.
- **BR-391 v1** — `resizeNearest(src, width, height)`, exported by
  `src/extraction-image.ts`, returns a new bitmap of `width × height` whose
  data is a new `Buffer` of `width * height * 4` bytes, where the 4 bytes of
  destination pixel (row `i`, column `j`) equal the 4 bytes of source pixel
  (row `Math.floor((i * src.height) / height)`, column
  `Math.floor((j * src.width) / width)`), computed in that operation order.
  `extractImage` calls it only when the current bitmap's size differs from
  the attempt's target, and always on the current bitmap (the previous
  attempt's result), never on the decoded one. For each input of the
  characterization set (AC-01), `extractImage` returns the width, height and
  PNG bytes (SHA-256) recorded on the Jimp 1.6.1 path at the base.
  Verified by: AC-01, AC-03.
- **BR-392 v1** — `make install-check` (prerequisites `_require-setup` and
  `build`) runs exactly `$(COMPOSE) run --rm -T dev node
scripts/install-check.ts` and exits with its status; `make help` lists
  it; `make check` does not run it (it needs the npm registry).
  `scripts/install-check.ts` uses Node built-ins only. It copies `dist/`,
  `LICENSE`, `NOTICE`, `README.md` and `package.json` into a new temporary
  directory, runs `npm pack --json --ignore-scripts --prefer-online` there
  (timeout 120 s) and requires exactly one tarball, then runs `npm install
--global --prefix <new empty directory> <tarball> --ignore-scripts
--no-audit --no-fund --prefer-online` (timeout 600 s). Each `npm` command
  runs through `execFileSync` with that `timeout`; a timeout or a non-zero
  exit is an `npm` failure. It then calls the exported collector
  `collectInstalled(prefix)`, which walks every directory named
  `node_modules` under the prefix at every depth: each entry is read with
  `lstat`; an entry whose name starts with `.` is skipped; an entry
  `@<scope>` that is a directory is read one level further for its
  `<name>` entries; a `<name>` or `@<scope>/<name>` directory with a
  `package.json` is one installed package `{ name, version, path }` (name
  and version from that `package.json`, `version` `null` when absent or not
  a string, `path` relative to the prefix), and its own `node_modules`, if
  any, is walked the same way; a symbolic link is never followed and is
  collected as `{ name, version: null, path, symlink: true }`, `name`
  being its directory-entry name (with its scope). It prints
  one line per collected `zod` with its version and path. It exits 0 only
  when at least one `zod` is collected, every collected `zod` has a version
  `>=4.6.6` (a prerelease of 4.6.6, `null` or an unparseable version counts
  as below), no collected name starts with `@jimp/`, and no entry is a
  symbolic link; otherwise, and when any `npm` command fails, it prints each
  finding and exits 1. It removes its temporary directories in every case.
  The verdict is computed by an exported pure function over the collected
  list. Verified by: AC-09, AC-10.
- **BR-122 v3** — Extraction and image dependencies execute without
  external requests, optional native or WASM codecs, eval or
  document-supplied JavaScript (the v1 statement, unchanged). Two clauses of
  the v2 rule text are removed: "scalar-only Jimp schema surface with no
  `z.array|record|map|set`" and "the Jimp schemas run on the single root
  `zod` of BR-316". The image codecs are `pngjs` and `jpeg-js`, whose
  `package-lock.json` entries declare no `dependencies`, so no package on
  the image path loads `zod`. In the BR record, the example "Given
  untrusted image collections in unknown arguments, When tool validation
  runs, Then they never reach Jimp scalar resize schemas" is removed and
  replaced by: "Given the locked `node_modules/pngjs` and
  `node_modules/jpeg-js` entries, When the BR-122 test reads them, Then
  neither declares `dependencies`, so the image route loads no `zod`"; the
  other example (compiled PDF and PNG workers succeed without native canvas)
  stays. Verified by: AC-05.
- **BR-315 v2** — `package.json` has a top-level `overrides` object
  deep-equal to `{"minimatch": "11.0.8"}`, and `zod` stays a direct
  `dependencies` entry with an exact version. Verified by: AC-06.
- **BR-316 v1** (unchanged) — the regenerated lockfile still holds one
  `zod`, `node_modules/zod`, at `>=4.6.6`, and no `minimatch` below
  `11.0.1`. Verified by: AC-07.
- **BR-318 v2** — `tsconfig.json` `compilerOptions` deep-equal the base
  options without `skipLibCheck`; `tsconfig.build.json` sets no
  `skipLibCheck`; `make typecheck` and `make build` pass with every
  third-party declaration checked. `src/extraction-image.ts` exports no
  `ImageResizeOptions`. Verified by: AC-08.
- **BR-320 v3** — v2 holds with "exactly three steps" replaced by "exactly
  four steps: the pinned checkout with `persist-credentials: false`,
  `run: make setup`, `run: make audit`, `run: make install-check`"; the
  policy validator admits `make install-check` only in the `audit` job.
  Verified by: AC-11.
- **BR-321 v4** — v3 holds with these changes. `docs/development.md`'s
  dependency-audit paragraph names the BR-315 `minimatch` override,
  ADR-010, `make audit`, `make install-check` and the CI `audit` job; its
  Make target table has a row whose first cell is `` `make install-check` ``
  and whose description says it installs the packed tarball from the
  registry and is not part of `make check`; and the file contains neither
  `Jimp` nor `@jimp/` (case-insensitive). `SECURITY.md`
  `## Dependency audit` keeps the high/critical gate and the no-allowlist
  sentences and states: (a) from the first release that includes #12, an
  install of the packed tarball or of the published package
  (`npm install -g`) resolves no `zod` below 4.6.6, and the CI `audit` job
  checks this with `make install-check`; (b) in one sentence, that earlier
  published versions (`0.6.0-beta.1` and older) still resolve the nested
  Zod 3 (`zod` 3.25.76, GHSA-mrhx-c7xc-m3w5) on such an install, and that their
  users upgrade to the first release that includes #12 or use the container
  image, whose `npm ci` install is not affected. The section may name the
  former image library (Jimp) only in sentence (b); it contains neither
  `@jimp/` nor `fixed before 1.0`, and no sentence other than (b) contains
  `Jimp` or `Zod 3`. `CHANGELOG.md` has a `### Fixed` line citing #12 (the
  tarball install no longer resolves Zod 3) and an `### Added` line citing
  #12 (the `make install-check` target and its CI step), both matching
  `#12\b`, both in the first release section citing #12 in file order or,
  when no release section cites #12, under `## [Unreleased]` (release
  section as defined in v3). Only the text before the `## [0.6.0-beta.1]`
  heading is searched for this selection: that section and older ones cite
  tickets of the archived repository, whose `#12` is another ticket.
  Verified by: AC-12.
- **BR-317 v1** — superseded by BR-390; its tests are removed except the
  600 × 400 route test (Scope item 6).

## Acceptance criteria

Unless stated otherwise, tests run with `make check` in the dev container.

- **AC-01** (BR-390, BR-391) — Characterization. Given seven inputs built in
  the test from a fixed deterministic generator (RGBA noise; alpha forced to
  255 for RGB and JPEG inputs) and encoded with `pngjs` or `jpeg-js`
  quality 90: PNG colour type 2 600 × 400, PNG colour type 6 300 × 200, PNG
  colour type 6 1024 × 1024, PNG colour type 2 1023 × 7, PNG colour type 6
  64 × 48, JPEG 640 × 480, JPEG 100 × 700; When `extractImage` runs on each
  with budget 16777216 and `maxOutputChars` 200000; Then each returns the
  width and height recorded on the Jimp path, the SHA-256 hex of the
  concatenated, inflated IDAT payload of `data` (the filtered scanlines,
  independent of zlib's deflate output) recorded on the Jimp path, and, on
  the reference architecture linux/amd64 only (`process.platform ===
"linux" && process.arch === "x64"`; elsewhere that assertion is a named
  `it.skipIf` case, never deleted), the SHA-256 hex of `data` recorded on
  the Jimp path (the
  feasibility probe on the base gave 256 × 170, 150 × 100, 128 × 128,
  512 × 3, 128 × 96 and 73 × 512 for six of them, and 64 × 48 is below
  every limit; the test records the values measured on the base). And
  Given the bitmaps 20 × 10 and 600 × 400 filled with 255, When the
  `tests/helpers/image-codecs.ts` encoders run, Then `encodeJpeg` returns
  bytes whose SHA-256 was recorded on the base, where it equalled that of
  `jpeg().encode` of `@jimp/js-jpeg`, and `encodePng` returns bytes whose
  inflated-IDAT SHA-256 (all architectures) and SHA-256 (linux/amd64 only)
  were recorded on the base, where they equalled those of `png().encode` of
  `@jimp/js-png`; the PR body quotes that equality run on the commit before
  the switch. The cases cover: initial resize then halving, halving from an
  unresized decode, two halvings, a non-integer ratio, no resize at all,
  JPEG with two halvings, and a resize with no halving. The test is
  committed before the source change and passes on it, and is unchanged by
  the switch. Verified by: `tests/image-characterization.test.ts`
  (`TestBR391_characterization <case>`), plus the PR body quoting its run on
  the commit before the switch and the commit order.
- **AC-02** (BR-390) — Codec calls. Given `pngjs` and `jpeg-js` wrapped by
  spies that delegate to the real functions, When `extractImage` processes
  a PNG and a JPEG, Then `PNG.sync.read` received `{ checkCRC: true }`, the
  JPEG `decode` received `{ tolerantDecoding: false, maxResolutionInMP:
1.048576, maxMemoryUsageInMB: 32 }`, and every `PNG.sync.write` call
  received `{ deflateLevel: 9, deflateStrategy: 3, filterType: -1,
colorType: 6, inputHasAlpha: true }`; and Given a 600 × 400 white PNG,
  When it goes through `kdrive_read` with `format: image`, Then the result
  is a 512 × 341 PNG. Verified by: `tests/read-image.test.ts`
  (`TestBR390_codec_calls ...`, including the kept 600 × 400 route test).
- **AC-03** (BR-391) — Nearest-neighbour unit. Given a 3 × 2 bitmap whose
  pixel `k` holds bytes `[k, k + 10, k + 20, k + 30]`, When
  `resizeNearest` targets 2 × 1, 5 × 3 and 1 × 1, Then each destination
  pixel holds the source pixel the BR-391 formula names (expected arrays
  written out in the test) and the source data is unchanged; and Given a
  4 × 4 bitmap, When it is resized to 2 × 2 and the result to 1 × 1, Then
  the 1 × 1 pixel is the one the formula names on the 2 × 2 result; and
  Given a 30 × 1 bitmap, When it is resized to 22 × 1, Then destination
  column 11 holds source column 15 (`Math.floor((11 * 30) / 22)`), not
  column 14, which `Math.floor(11 * (30 / 22))` would give. Verified by:
  `tests/read-image.test.ts` (`TestBR391_resize_nearest ...`).
- **AC-04** (BR-389) — Dependency set. Given the real `package.json`,
  `package-lock.json` and the `.ts` files under `src/`, `tests/` and
  `scripts/`, When the test reads them, Then no `@jimp/` key, lock entry or
  import exists and `pngjs` 7.0.0 and `jpeg-js` 0.4.4 are exact in both;
  and Given in-memory copies with a `@jimp/core` dependency, a
  `node_modules/@jimp/types` lock key, or `pngjs` at `^7.0.0`, When the
  checker runs, Then each is rejected. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR389_image_dependencies ...`).
- **AC-05** (BR-122 v3) — Given the lockfile, When the test reads the
  `node_modules/pngjs` and `node_modules/jpeg-js` entries, Then neither has
  a `dependencies` key, and the existing pdfjs source-hash pins still hold.
  Verified by: `tests/read-dependencies.test.ts`
  (`TestBR122_pure_js_dependencies ...`, renamed to drop "Jimp schema
  surface").
- **AC-06** (BR-315 v2) — Given the real `package.json`, When the BR-315
  test parses it, Then `overrides` equals `{"minimatch": "11.0.8"}` and
  `dependencies.zod` is `4.6.7`; copies with a `@jimp/types` override or
  `minimatch` at `^11.0.8` are rejected. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR315_overrides ...`).
- **AC-07** (BR-316 v1) — Given the lockfile regenerated by `make lockfile`,
  When the BR-316 test walks it, Then it passes unchanged. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR316_lockfile ...`).
- **AC-08** (BR-318 v2) — Given `tsconfig.json` and `tsconfig.build.json`,
  When the test parses them, Then `compilerOptions` deep-equals the base
  options with no `skipLibCheck` and the build config has none, and
  `src/extraction-image.ts` contains no `ImageResizeOptions`; and When
  `make typecheck` and `make build` run, Then both exit 0. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR318_skiplibcheck ...`, renamed
  `TestBR318_full_lib_check ...`), `make check`.
- **AC-09** (BR-392) — Install-check verdict and target. Given collected
  lists `[zod 4.6.7]`, `[zod 4.6.6]`, `[zod 4.6.7, zod 3.25.76 under
@jimp/types]`, `[zod 4.6.5]`, `[zod 4.6.6-beta.1]`, `[zod "x"]`, `[]`,
  `[zod 4.6.7, @jimp/core 1.6.1]`, `[zod 4.6.7, zod null]`,
  `[zod 4.6.7, symlink entry]`, When the exported verdict function runs,
  Then only the first two pass and each failure names its package and path;
  and Given a temporary tree (offline, no `npm`) with
  `lib/node_modules/zod` 4.6.7, `lib/node_modules/@jimp/types/node_modules/zod`
  3.25.76, `lib/node_modules/a/node_modules/b/node_modules/@s/c/node_modules/zod`
  4.6.6 (four `node_modules` levels, a scoped parent), a directory
  `lib/node_modules/d` without `package.json`, a `.bin` directory, and a
  symbolic link `lib/node_modules/e` to a directory outside the tree that
  holds `node_modules/zod` 3.25.76, When `collectInstalled` runs on the tree,
  Then it returns exactly the three `zod` entries, `@jimp/types`, `a`, `b`,
  `@s/c` and `e` as a symlink entry with their relative paths, does not
  return the zod behind the link, and the verdict fails naming `zod`
  3.25.76, `@jimp/types` and `e`; and Given `scripts/install-check.ts`, When
  the test reads it, Then both `npm` invocations pass `--prefer-online` and
  a numeric `timeout` of 120000 and 600000 ms; and When `make help` runs,
  Then it lists `make install-check`; and When `make check` runs, Then it
  does not invoke `install-check`. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR392_install_check ...`),
  `tests/dev-environment.test.ts` (`TestBR392_install_check help lists the
target and check never runs it`).
- **AC-10** (BR-392, BR-389; the #12 acceptance) — Given the commit before
  the codec switch (Scope item 2), When `make install-check` runs, Then it
  exits 1 and lists `zod` 3.25.76 under `@jimp/types` and
  `@jimp/plugin-resize` and the `@jimp/*` packages; and Given the final
  commit, When `make install-check` runs, Then it exits 0, lists only `zod`
  versions `>=4.6.6`, and no `@jimp/` package. Both runs need the npm
  registry; they run in the dev container locally and in the CI `audit`
  job. Verified by: `make install-check` outputs quoted in the PR body, and
  the CI `audit` job log on the PR head.
- **AC-11** (BR-320 v3) — Given `.github/workflows/ci.yml`, When the CI
  policy test compares the `audit` job, Then it equals the BR-320 v3 form
  with four steps, and mutations that drop `make install-check`, add a flag
  to it, or move it to another job are rejected. Verified by:
  `tests/ci-policy.test.ts` (`TestBR320_audit_job ...`).
- **AC-12** (BR-321 v4) — Given the updated `docs/development.md`,
  `SECURITY.md` and `CHANGELOG.md`, When the content test runs, Then each
  holds the BR-321 v4 statements and none of the removed ones: the
  development guide has the `make install-check` table row; `SECURITY.md`
  `## Dependency audit` says "from the first release that includes #12",
  and its sentences (split on `. `) that contain `Jimp` or `Zod 3` are
  exactly one, which contains `0.6.0-beta.1`, `3.25.76`, `upgrade` and
  `container`; a synthetic section that claims the published package
  resolves no `zod` below 4.6.6 without the "first release that includes
  #12" limit, or that lacks the earlier-versions sentence, fails; the
  changelog has the #12 `### Fixed` and `### Added` lines; the #104
  changelog checks of v3 still pass; a synthetic changelog with a #12 line
  only in an older release section, with only one of the two #12 lines, or
  with `#120` instead of `#12`, fails; a synthetic changelog whose only #12
  lines are in `## [0.6.0-beta.1]` fails.
  Verified by: `tests/dependency-audit.test.ts` (`TestBR321_audit_docs ...`).
- **AC-14** (BR-390) — Error-path characterization. Given three inputs
  built in the test that pass `preflightImage`: (a) a 4 × 2 PNG, colour type
  6, every scanline byte 7, filter byte 5 on row 0 and 0 on row 1, deflated
  with `node:zlib` `deflateSync`, every chunk CRC valid; (b) the AC-01
  generator's 64 × 48 noise bitmap encoded with `jpeg-js` quality 90, with
  the 16 code-length counts of its first DHT segment set to
  `[1, 0, …, 0]`; (c) the same JPEG cut 8 bytes after the end of its SOS
  segment and closed with `FF D9`; When `extractImage` runs on each, Then it
  rejects with an `Error` for which `contentFailure` returns `undefined` and
  whose message is the one recorded on the Jimp path (the base probe gave
  `Unrecognised filter type - 5`, `Could not recreate Huffman Table`,
  `unexpected marker: ffd9`); and When each goes through `kdrive_read` with
  `format: image`, Then the result is the tool error `CONTENT_UNAVAILABLE`.
  The test is committed with AC-01, passes before and after the switch, and
  is unchanged by it. Verified by: `tests/image-characterization.test.ts`
  (`TestBR390_codec_errors <case>`), plus the PR body quoting its run on the
  commit before the switch.
- **AC-13** (all) — Given the final branch, When `make check` runs, Then it
  exits 0 with the existing image tests (BR-116, BR-119, BR-120) unchanged
  except for their fixture imports, and `make audit` exits 0. Verified by:
  `make check`, `make audit`, CI on the PR head.

## Decisions

- **D-1 — Replace Jimp with direct `pngjs` and `jpeg-js` calls and a local
  nearest-neighbour resize.** Chosen: it removes every `@jimp/*` package
  and with them every Zod 3 range from the published dependency tree, so the
  fix holds for any install of a release that includes it, needs no override, and shrinks the runtime
  tree (`@jimp/core` also pulls `file-type`, `mime`, `exif-parser`,
  `await-to-js` and `@jimp/utils` with `tinycolor2`, none used by the
  route). The resize is 15 lines, and the codecs are the ones Jimp already
  ran. Rejected:
  - (a) `bundleDependencies` for the Jimp packages: the tarball would carry
    a frozen copy of Jimp and its tree, which consumers' `npm audit` and
    `npm update` do not manage and which only a republish can fix; it keeps
    Jimp's Zod 3 range forced onto Zod 4 and `skipLibCheck`; and what npm
    places in the bundle under root `overrides` is the same install-time
    resolution question that defeated the F-024 v1 shrinkwrap, without a
    gain over removing the dependency.
  - (b) Wait for a Jimp release on Zod 4: no release or date exists (1.6.1
    is the latest and declares `zod ^3.23.8`); the published beta keeps a
    known high advisory meanwhile, and #12 is due before 1.0.
  - (c) `npm-shrinkwrap.json`: tried in F-024 v1; an install of the tarball
    still resolved `zod@3.25.76` under both Jimp packages.
  - (d) Another image library: `sharp` and similar are native, which BR-122
    forbids; other pure-JavaScript libraries bring a larger surface than
    two codecs and a 15-line resize.
  - (e) Fork Jimp: maintains a copy of a large codebase to change one
    dependency range.
- **D-2 — Byte-identical output, proven by characterization tests written
  before the change.** Chosen: the image route's output is a user-visible
  contract (BR-116); pinning SHA-256 digests on the Jimp path and keeping
  them green after the switch proves no behaviour change, including the
  chained halving. Rejected: comparing only dimensions or decoded pixels,
  which would not catch a different encoder setting or resize order.
- **D-3 — Drop `skipLibCheck`.** Chosen: its only cause (Jimp's Zod 3 type
  names) disappears; on the base, `--skipLibCheck false` reports errors only
  in the two Jimp packages, and the codec calls type-check cleanly against
  `@types/pngjs` and `jpeg-js`. Rejected: keeping it, which keeps hiding
  every third-party declaration error for no reason. If an unrelated
  declaration error appears during implementation, that is a stop
  condition for the implementer (report to the orchestrator), not a reason
  to keep `skipLibCheck` silently.
- **D-4 — The install check is a Make target run by the CI `audit` job.**
  Chosen: it needs the npm registry, as `make audit` does, so it joins the
  job that already depends on the network and is already needed by
  `ci-result`, and the release gate inherits it through CI. Rejected: a
  `make check` or vitest test (would make the offline gate depend on the
  registry); a separate CI job (a second `make setup` for no isolation
  gain); a check inside `release.yml` only (the regression would be seen
  late, at release time). The result depends on the registry state at run
  time; a new upstream release that brings a Zod below 4.6.6 back turns CI
  red on an unrelated PR, which is intended, as for `make audit`.
- **D-5 — Exact pins `pngjs` 7.0.0 and `jpeg-js` 0.4.4.** Chosen: the
  versions Jimp resolves in the current lockfile, so codec behaviour is
  unchanged and the characterization holds; exact pins follow ADR-004.
- **D-6 — ADR-010.** The dependency choice is costly to reverse and changes
  the decisions of ADR-009 (overrides and `skipLibCheck` for Jimp) and the
  image-codec part of ADR-004; per AGENTS.md §7 a new ADR supersedes them
  and an accepted ADR never changes, so ADR-004 and ADR-009 are not edited:
  ADR-010's status line and `docs/spec-index.md` record the supersession
  (Scope item 9). Rejected: a status line in the accepted ADRs (it would
  change accepted text).
- **D-7 — No grayscale JPEG in the characterization set.** `jpeg-js`
  encodes only 3-component JPEGs; the decode call, where grayscale is
  expanded to RGBA, is the identical `jpeg-js` call (BR-390, AC-02).
- **D-8 — BR mapping.** BR-317's purpose (Jimp's schemas behave on the root
  Zod) disappears, so BR-390 supersedes it; BR-315, BR-318, BR-320, BR-321
  and BR-122 keep their purposes and get new versions; BR-316 holds
  unchanged.
- **D-9 — Two digests per PNG output, linux/amd64 as reference.** The
  PNG bytes depend on Node's zlib deflate output, which the project does not
  control across Node versions and may differ across architectures; the
  inflated IDAT payload depends only on the pixels, the resize and the
  `pngjs` filter choice, which are exactly what the switch could change. So
  every PNG output pins the inflated-IDAT digest on all architectures and
  the byte digest on linux/amd64, the architecture of the CI runners and of
  the probe. Rejected: byte digests only (a cross-architecture or Node zlib
  difference would fail the test without a behaviour change); proving
  cross-architecture equality (no arm64 runner or `platform` in the dev
  image).
- **D-10 — Codec errors keep the existing path.** `extractImage` lets codec
  exceptions propagate and the worker maps them to `CONTENT_UNAVAILABLE`,
  as on the base; AC-14 pins that on the Jimp path. Rejected: wrapping codec
  errors in `ContentFailure` inside `extractImage` (same wire result, but a
  change to the module's contract that this ticket does not need).

## Open questions

## Stress-test

Review 1 (12-spec-review-1-reviewer), findings on `24a1ff3`; all retained:

1. [major] BR-321 v4 claimed the published package resolves no Zod below
   4.6.6, false for `0.6.0-beta.1`. Retained: the claim now holds "from the
   first release that includes #12", and one sentence states that
   `0.6.0-beta.1` and older still resolve `zod` 3.25.76 with an upgrade or
   container recommendation; AC-12 checks both and rejects the unlimited
   claim.
2. [major] Untrusted-input error path not pinned. Retained: BR-390 states
   codec exceptions propagate unchanged from `extractImage` and the worker
   mapping is unchanged (D-10); new AC-14 characterizes three inputs that
   pass preflight, with outcomes probed on the base (Context, "Error
   path"). A PNG with bad CRC or bad IDAT cannot pass preflight, so the PNG
   case is an invalid filter type instead; a zeroed JPEG entropy segment
   decodes without error and is not used.
3. [minor] PNG digests depend on zlib; no `platform` in the dev image.
   Retained: AC-01 pins a zlib-independent inflated-IDAT digest on every
   architecture and the byte digest on linux/amd64 only, named as the
   reference (D-9, Out of scope); cross-architecture equality is not proven.
4. [minor] Install-check walk under-specified. Retained: BR-392 specifies a
   walk at every depth with `lstat`, scopes, no symlink followed (a link is
   a failing finding), an exported `collectInstalled`, and a timeout and
   `--prefer-online` on both `npm` commands; AC-09 adds an offline temp-tree
   case and a check of the `npm` arguments.
5. [minor] Test file list incomplete. Retained: Scope item 6 lists every
   file and line with `@jimp/*` (including `tests/read-dependencies.test.ts`
   line 14 for the packed-runtime test at line 139 and
   `tests/dependency-audit.test.ts` lines 3–4) and the kept route test at
   `tests/read-image.test.ts` line 149; a fixture helper reproduces Jimp's
   encode defaults (PNG options of BR-390, JPEG quality 100, read from the
   installed sources), pinned in AC-01.
6. [minor] Missing `make install-check` documentation. Retained: the
   development-guide table row and a CHANGELOG `### Added` line citing #12
   are in Scope item 8, BR-321 v4 and AC-12.
7. [minor] BR-122 v3 "v1 holds" ambiguous. Retained: BR-122 v3 restates the
   v1 statement, names the two removed v2 clauses and the removed example,
   and gives the replacement example.
8. [minor] Editing accepted ADR-004 and ADR-009 breaks AGENTS.md §7.
   Retained: neither is edited; ADR-010's status line and a
   `docs/spec-index.md` ADR sentence (given in Scope item 9, written in the
   implementation like the other records) record the supersession (D-6).
   `docs/spec-index.md` is not changed in the spec phase: it lists ADRs in
   prose with their acceptance, and ADR-010 is not accepted yet.

Review 2 (12-spec-review-2-reviewer), `approve` on `331e670` with two minor
findings; both retained:

1. [minor] The test helper had no decode functions for the tests'
   `png().decode` and `jpeg().decode` calls. Retained: Scope item 6 adds
   `decodePng` and `decodeJpeg`.
2. [minor] BR-321 v4 (b) could be met without the literal `Zod 3`, so a
   compliant section could fail AC-12. Retained: sentence (b) now names
   Zod 3 literally.

Implementation (2026-11-14), version 2:

1. The released `## [0.6.0-beta.1]` section of `CHANGELOG.md` already cites
   `#12` for archive-era entries (F-012), so the v1 selection ("the first
   release section citing #12") picked that section instead of the #12 lines
   of this ticket. Retained: BR-321 v4 searches only the text before the
   `## [0.6.0-beta.1]` heading, the same rule for the real file and the
   synthetic fixtures, and AC-12 adds the matching negative case.

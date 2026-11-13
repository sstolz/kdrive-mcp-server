---
id: F-027
title: Direct image codecs without Jimp
ticket: "#12"
status: draft
version: 1
---

# F-027 — Direct image codecs without Jimp

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-13.
Base: branch `claude/beautiful-maxwell-8mdk2w`, based on `main` at
`768f1b6`. IDs: F-027, BR-389–BR-392 v1, BR-122 v3, BR-315 v2, BR-318 v2,
BR-320 v3, BR-321 v4; BR-317 superseded by BR-390; ADR-010 (supersedes
ADR-009 and the image-codec part of ADR-004). `#12` is this repository's
ticket. Next free IDs re-checked on `main` at `768f1b6`: F-027, BR-389,
ADR-010.

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
   the seven inputs of AC-01, and passes on the Jimp path. It generates its
   inputs with `pngjs` and `jpeg-js` only, so it runs unchanged after the
   switch (BR-391).
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
6. **Tests.** Tests that import `@jimp/*` to build or decode fixtures
   (`tests/read-image.test.ts`, `tests/read-wire.test.ts`,
   `tests/read-review1.test.ts`) use `pngjs` and `jpeg-js` directly with
   unchanged assertions. The BR-317 tests in
   `tests/read-dependencies.test.ts` are removed with the superseded rule,
   except the 600 × 400 route test, which is kept as
   `TestBR390_codec_calls image route resizes a 600 x 400 PNG to 512 x 341`.
   The BR-318 type-level tests on `ResizeOptions` and `ImageResizeOptions`
   are removed with BR-318 v1; the BR-318 v2 test replaces them.
7. **CI.** The `audit` job of `.github/workflows/ci.yml` gets a fourth step
   `run: make install-check` (BR-320 v3).
8. **Documentation.** `SECURITY.md` `## Dependency audit`,
   `docs/development.md` (the dependency list and the dependency-audit
   paragraph), `CHANGELOG.md` (BR-321 v4), `capability-map.md` (the two
   Jimp/Zod sentences), and `BACKLOG.md` (the 2026-11-11 tarball-install
   line, removed as done).
9. **Records.** ADR-010 (new, accepted with the feature); ADR-009 gets the
   status line `Superseded by ADR-010 (F-027, #12)`; ADR-004 gets the line
   `Its image-codec choice (Jimp modules) is superseded by ADR-010 (F-027,
#12); the rest stands`; nothing else in either ADR changes. BR records:
   BR-389–BR-392 created; BR-122, BR-315, BR-318, BR-320, BR-321 versioned
   with History lines; BR-317 marked `superseded by BR-390`;
   `business-rules/README.md`, `docs/spec-index.md` updated.

### Out of scope

- Any change to admission, limits, target size, halving, output format or
  error codes of the image route (BR-116, BR-119, BR-120 unchanged).
- Other image formats, other resize strategies, EXIF handling.
- `release.yml` and the `make release-*` targets: the release already
  requires green CI on the tagged commit (F-024), which now includes the
  install check through `ci-result` → `audit`.
- Publishing a new version; bumping `VERSION`.
- The `minimatch` override (development tooling only; kept as is).
- Upgrading Node or the codecs. The pinned digests of AC-01 depend on the
  Node zlib in the dev image; a later Node upgrade that changes deflate
  output updates them in its own ticket.
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
  Verified by: AC-01, AC-02.
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
  directory, runs `npm pack --json --ignore-scripts` there and requires
  exactly one tarball, then runs `npm install --global --prefix <new empty
directory> <tarball> --ignore-scripts --no-audit --no-fund`. It then
  collects every installed package under the prefix (each directory
  `node_modules/<name>` or `node_modules/@scope/<name>` with a
  `package.json`) and prints one line per installed `zod` with its version
  and path relative to the prefix. It exits 0 only when at least one `zod`
  is installed, every installed `zod` has a version `>=4.6.6` (a
  prerelease of 4.6.6 or an unparseable version counts as below), and no
  installed package name starts with `@jimp/`; otherwise, and when any
  `npm` command fails, it prints each finding and exits 1. It removes its
  temporary directories in every case. The verdict is computed by an
  exported pure function over the collected `{ name, version, path }` list.
  Verified by: AC-09, AC-10.
- **BR-122 v3** — v1 holds (pure-JS extraction, no external request, no
  native or WASM codec, no eval). The image codecs are `pngjs` and
  `jpeg-js`, whose `package-lock.json` entries declare no `dependencies`,
  so no package on the image path loads `zod`. This replaces the v2 clause
  on the Jimp schema surface and the root Zod 4. Verified by: AC-05.
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
  ADR-010, `make audit`, `make install-check` and the CI `audit` job, and
  the file contains neither `Jimp` nor `@jimp/` (case-insensitive).
  `SECURITY.md` `## Dependency audit` keeps the high/critical gate and the
  no-allowlist sentences, states that an install of the packed tarball or of
  the published package (`npm install -g`) resolves no `zod` below 4.6.6,
  and that the CI `audit` job checks this with `make install-check`; the
  section contains neither `Jimp`, nor `Zod 3`, nor `fixed before 1.0`.
  `CHANGELOG.md` has a `### Fixed` line citing #12
  (matching `#12\b`): in the first release section citing #12 in file order
  or, when no release section cites #12, under `## [Unreleased]` (release
  section as defined in v3). Verified by: AC-12.
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
  width, height and SHA-256 hex of `data` recorded on the Jimp path (the
  feasibility probe on the base gave 256 × 170, 150 × 100, 128 × 128,
  512 × 3, 128 × 96 and 73 × 512 for six of them, and 64 × 48 is below
  every limit; the test records the values measured on the base). The cases cover: initial resize then halving, halving from an
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
  `[zod 4.6.7, @jimp/core 1.6.1]`, When the exported verdict function
  runs, Then only the first two pass and each failure names its package and
  path; and When `make help` runs, Then it lists `make install-check`; and
  When `make check` runs, Then it does not invoke `install-check`. Verified
  by: `tests/dependency-audit.test.ts` (`TestBR392_install_check ...`),
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
  holds the BR-321 v4 statements and none of the removed ones; the #104
  changelog checks of v3 still pass; a synthetic changelog with the #12 line
  only in an older release section, or with `#120` instead of `#12`, fails.
  Verified by: `tests/dependency-audit.test.ts` (`TestBR321_audit_docs ...`).
- **AC-13** (all) — Given the final branch, When `make check` runs, Then it
  exits 0 with the existing image tests (BR-116, BR-119, BR-120) unchanged
  except for their fixture imports, and `make audit` exits 0. Verified by:
  `make check`, `make audit`, CI on the PR head.

## Decisions

- **D-1 — Replace Jimp with direct `pngjs` and `jpeg-js` calls and a local
  nearest-neighbour resize.** Chosen: it removes every `@jimp/*` package
  and with them every Zod 3 range from the published dependency tree, so the
  fix holds for any install, needs no override, and shrinks the runtime
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
  and the accepted ADRs get only a status line.
- **D-7 — No grayscale JPEG in the characterization set.** `jpeg-js`
  encodes only 3-component JPEGs; the decode call, where grayscale is
  expanded to RGBA, is the identical `jpeg-js` call (BR-390, AC-02).
- **D-8 — BR mapping.** BR-317's purpose (Jimp's schemas behave on the root
  Zod) disappears, so BR-390 supersedes it; BR-315, BR-318, BR-320, BR-321
  and BR-122 keep their purposes and get new versions; BR-316 holds
  unchanged.

## Open questions

## Stress-test

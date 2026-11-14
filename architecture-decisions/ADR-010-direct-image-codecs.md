# ADR-010 — Direct image codecs instead of Jimp

Status: proposed (2026-11-13), design of
[F-027 v2](../features/F-027-direct-image-codecs.md), ticket #12. Becomes
accepted with the acceptance of F-027 on `main`. Supersedes
[ADR-009](ADR-009-dependency-overrides-skiplibcheck.md) and the image-codec
choice (Jimp modules) of
[ADR-004](ADR-004-bounded-extraction-dependencies.md); the rest of ADR-004
stands. ADR-004 and ADR-009 are accepted and keep their text unchanged
(AGENTS.md §7); this ADR and `docs/spec-index.md` record the supersession.

## Context

The image route of `kdrive_read` (F-009, ADR-004) decodes PNG and JPEG,
resizes with nearest-neighbour sampling and encodes PNG through four Jimp
1.6.1 modules. Every `@jimp/*` package depends on `@jimp/types`, which
declares `zod ^3.23.8`; `@jimp/plugin-resize` declares it too. ADR-009 moved
that Zod 3 onto the root Zod 4 with `package.json` `overrides` and set
`skipLibCheck: true` because Jimp's declarations name Zod 3 types. npm
applies `overrides` only in the root project, so an install of the packed
tarball or the published package resolves `zod@3.25.76` and its high
advisory GHSA-mrhx-c7xc-m3w5 again. A generated `npm-shrinkwrap.json`
(F-024 v1) did not change that resolution. Jimp 1.6.1 is the latest release.

Jimp's PNG and JPEG modules are thin wrappers over `pngjs` and `jpeg-js`,
which have no dependencies, and its nearest-neighbour resize is a
two-line index formula. A probe re-implemented the resize and encode on
`pngjs` and produced byte-identical PNGs to the Jimp path through chained
halving steps.

## Decision

- The image route calls `pngjs` 7.0.0 (`PNG.sync.read`, `PNG.sync.write`)
  and `jpeg-js` 0.4.4 (`decode`) directly, with the option values Jimp
  passed, and resizes with a local nearest-neighbour function using Jimp's
  formula (`Math.floor((i * hSrc) / hDst)`, `Math.floor((j * wSrc) / wDst)`)
  on the current bitmap (BR-389, BR-390, BR-391). Both codecs are exact
  `dependencies`; no `@jimp/*` package remains. Codec exceptions propagate
  from `extractImage` unchanged and the extraction worker keeps mapping them
  to `CONTENT_UNAVAILABLE` (BR-390).
- Characterization tests written on the Jimp path pin the output (the
  inflated-IDAT digest on every architecture, the PNG-byte digest on the
  reference architecture linux/amd64) and the codec-error outcomes, and
  stay green after the switch (BR-390, BR-391).
- `overrides` keep only `minimatch` 11.0.8 (BR-315 v2). The lockfile still
  holds one `zod` at `>=4.6.6` (BR-316, unchanged).
- `tsconfig.json` no longer sets `skipLibCheck` (BR-318 v2).
- `make install-check` packs the package, installs the tarball into an
  empty prefix from the npm registry, walks every installed package at
  every depth without following symbolic links, and fails on any installed
  `zod` below 4.6.6, any `@jimp/*` package or any symbolic link; the CI `audit` job runs it after
  `make audit` (BR-392, BR-320 v3).
- `make audit` and the CI `audit` job otherwise stay as ADR-009 set them
  (BR-319, BR-320).

## Options rejected

- `bundleDependencies` for Jimp: ships a frozen third-party tree that
  consumers cannot audit or update and only a republish can fix; keeps
  Jimp's Zod 3 range and `skipLibCheck`.
- Waiting for a Jimp release on Zod 4: no release or date; the published
  beta would keep a known high advisory.
- `npm-shrinkwrap.json`: tried in F-024 v1; installs still resolved the
  nested Zod 3.
- A native library such as `sharp`: violates the pure-JavaScript rule of
  ADR-004 (BR-122).
- Another pure-JavaScript image library or a Jimp fork: a larger surface or
  a maintained copy, for what two codec calls and a short resize do.

## Consequences

- From the first release that includes #12, every install, container or
  npm, resolves no Zod 3. Published versions up to `0.6.0-beta.1` still
  resolve the nested `zod` 3.25.76 on a tarball or `npm install -g` install;
  `SECURITY.md` tells their users to upgrade or use the container image. The
  runtime tree loses `@jimp/*`, `file-type`, `mime`, `exif-parser`, `await-to-js` and
  `tinycolor2`.
- The project owns a short resize function; its formula and operation order
  are pinned by unit and characterization tests.
- Third-party declarations are type-checked again; a dependency upgrade with
  a broken `.d.ts` now fails `make typecheck`.
- The install check depends on the registry state at run time: an upstream
  release that brings back a Zod below 4.6.6 turns CI red on an unrelated
  PR, which is intended.
- The PNG-byte characterization digests depend on the Node zlib of the dev
  image and are asserted on linux/amd64 only; a Node upgrade that changes
  deflate output updates them in its own ticket, while the zlib-independent
  inflated-IDAT digests must stay unchanged.
- Reversing the decision means re-adding Jimp, its overrides and
  `skipLibCheck`, and accepting the tarball-install advisory again.

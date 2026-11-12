# ADR-009 — Dependency overrides for Jimp's Zod and `skipLibCheck`

Status: accepted (2026-11-11). Design of
[F-020 v1](../features/F-020-dependency-audit.md) (ticket #104, D-1 and D-5),
implemented in PR #111 and accepted on main `b6acf86`
(acceptance (archive issue 104)).
Owner decision 2026-11-11: override plus `skipLibCheck`.

## Context

`npm audit` on `main` reported 7 high findings from `zod` 3.25.76, nested under
`@jimp/types` and `@jimp/plugin-resize` (runtime image extraction, F-009,
[ADR-004](ADR-004-bounded-extraction-dependencies.md)), advisory
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
(affected `<4.6.6`, no fixed 3.x), and 10 moderate findings from `minimatch`
10.2.6 in the development tooling. Jimp 1.6.1 is the latest release and
declares `zod ^3.23.8`. A public beta must not ship known high findings, and
nothing in the gate stopped a new one.

Jimp's runtime use of Zod is `z.object`, `z.union`,
`z.instanceof(Buffer | Uint8Array)`, `z.number().min(0)`, `.optional()`,
`z.nativeEnum` and `Schema.parse`; all exist in Zod 4. Jimp's declaration files
name Zod 3 types (`ZodTypeDef`, `ZodNativeEnum`), so `tsc` fails on them once
Zod 4 is the only Zod.

## Decision

- `package.json` `overrides` set `zod` to `"$zod"` (the root direct dependency,
  Zod 4) for `@jimp/types` and `@jimp/plugin-resize`, and pin `minimatch` to
  `11.0.8` globally (BR-315). The lockfile holds one `zod` and no `minimatch`
  below `11.0.1` (BR-316).
- Tests pin Jimp's behaviour on the root Zod 4 through the real image route
  (BR-317, BR-122 v2).
- `tsconfig.json` sets `skipLibCheck: true`; `tsconfig.build.json` inherits it
  and sets nothing of its own (BR-318). `src/extraction-image.ts` types its
  resize options locally (`ImageResizeOptions`), because `ResizeOptions` of
  `@jimp/plugin-resize` resolves to `any` under this setting; a type-level test
  records that `any`.
- `make audit` and the CI `audit` job fail on any high or critical finding
  (BR-319, BR-320).

## Options rejected

- Keeping Zod 3 with a written non-reachability justification and a CI
  allowlist: ships a known high finding in a public beta, and an allowlist rots.
- A local type shim or patched Jimp `.d.ts`: maintains a copy of third-party
  types for no runtime gain.
- Replacing or forking Jimp: a large F-009 change, out of proportion to the
  finding.
- `npm-shrinkwrap.json` to carry the resolution into tarball installs:
  considered and deferred, because it changes the package contract; it belongs
  to the public-publication preparation ticket.
- Waiting for upstream tooling releases for `minimatch`: no date, leaves the
  finding open.

## Consequences

- One Zod in the tree; `npm audit` reports 0 vulnerabilities on the lockfile.
- A Jimp release relying on a Zod 3-only API would break at run time; the
  BR-317 and BR-122 v2 tests catch it on the upgrade PR.
- Errors inside any third-party `.d.ts` are no longer reported, and library
  types built on the missing Zod 3 names collapse to `any`. Project sources and
  tests stay fully type-checked (BR-010 unchanged); the type-level test fails
  when a Jimp release fixes `ResizeOptions`, so the local type is revisited.
- `overrides` apply only in the root project: the container image (`npm ci` on
  the lockfile) is covered, but an install of the packed tarball
  (`npm install -g`) can resolve Jimp's nested Zod 3 and its high advisory
  again. `SECURITY.md` states this limit.
- A newly published advisory can turn CI red on an unrelated PR; that is
  intended, and the fix goes through its own ticket.
- Reversing the decision means removing the overrides and `skipLibCheck`
  together, which brings the advisories back.

---
id: F-020
title: Clean dependency audit and audit gate
ticket: "#104"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-11; fix phase
after `104-spec-review-1-reviewer`, 2026-11-11.
Base: branch `claude/beautiful-maxwell-8mdk2w`; the uncommitted working tree
holds the override experiment described below. IDs: F-020, BR-315–BR-321 and
ADR-009 (BR-291 and BR-305–BR-311 stay reserved for #109; ADR-008 stays
promised to done F-019 and is unwritten, see `BACKLOG.md`). Re-check before
freeze and before the PR.

## Context

`npm audit` on `main` reports 10 moderate and 7 high findings:

- **moderate (10)** — `minimatch` 10.2.6, reached through `eslint`,
  `typescript-eslint` and `eslint-plugin-sonarjs` (development tooling only),
  advisory "globparts amplification", affected range `>=7.0.0 <11.0.1`.
- **high (7)** — `zod` 3.25.76 nested under `@jimp/types` and
  `@jimp/plugin-resize` (runtime image extraction, F-009),
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
  "oversized constrained collections", affected range `<4.6.6`. No fixed 3.x
  exists; Jimp 1.6.1 is the latest release and declares `zod ^3.23.8`.

`docs/development.md` ("The dependency audit is not clean", F-009 #14) accepts
the high findings on a non-reachability argument. A public beta must not ship
known high findings without a fix, and nothing in the gate stops a new one.

Users affected: the owner who releases and operates the server, contributors
who run the gate, and every user of the published image or package.

Facts established on the working tree (2026-11-11, inside the dev container):

- With the overrides of BR-315, the regenerated `package-lock.json` holds one
  `zod` (`node_modules/zod`, 4.6.7, the direct dependency) and `minimatch`
  11.0.8; `npm audit` reports 0 vulnerabilities; lint passes.
- `tsc` then fails inside Jimp's declaration files (`ZodTypeDef`,
  `ZodNativeEnum`: Zod 3 type names) unless `tsconfig.json` sets
  `skipLibCheck: true`; with it, `make test` passes 138/138 files.
- With `skipLibCheck: true` and Zod 4, the type `ResizeOptions` exported by
  `@jimp/plugin-resize` resolves to `any` (reviewer probe,
  `104-spec-review-1-reviewer`), so the argument of `image.resize` in
  `src/extraction-image.ts` is no longer type-checked by the library type.
- Jimp's runtime use of Zod (`@jimp/types/dist/esm/index.js`,
  `@jimp/plugin-resize/dist/esm/index.js`) is `z.object`, `z.union`,
  `z.instanceof(Buffer | Uint8Array)`, `z.number().min(0)`, `.optional()`,
  `z.nativeEnum(ResizeStrategy)` and `Schema.parse(options)`; all exist in
  Zod 4.
- The executed route (`src/extraction-image.ts`) builds `new Jimp({ data,
  width, height })` from a validated bitmap and calls `image.resize({ w, h,
  mode: ResizeStrategy.NEAREST_NEIGHBOR })` with server-derived scalars.
- npm applies `overrides` only in the root project. The container image
  installs with `npm ci` on this repository's lockfile and is covered. A user
  who installs the packed tarball (`npm install -g
  artifacts/kdrive-mcp-server-0.1.0.tgz`, documented in `README.md`) gets a
  fresh resolution without these overrides, so Jimp's nested `zod` 3.25.76
  and its high advisory come back in that install. This residual risk is
  stated, not fixed, in #104 (D-1).

Owner decision 2026-11-11: override plus `skipLibCheck`, recorded in ADR-009.

## Scope

1. A reviewed `overrides` block in `package.json` and the regenerated lockfile
   that remove both advisories.
2. Tests that pin the overrides, the resolved versions in the lockfile, and
   Jimp's runtime behaviour on Zod 4 through the real image route.
3. `skipLibCheck: true` in `tsconfig.json`, with its residual risk stated, and
   a locally typed resize options object in `src/extraction-image.ts`
   (BR-318).
4. A `make audit` target and a CI job `audit` that fails on any high or
   critical finding.
5. Documentation: `docs/development.md` audit paragraph, a `SECURITY.md`
   "Dependency audit" section, `CHANGELOG.md` Unreleased lines,
   `architecture-decisions/ADR-009-dependency-overrides-skiplibcheck.md`.
6. Records, prepared in the feature PR and marked pending (AGENTS.md §6):
   `business-rules/BR-315.md` to `BR-321.md` (`pending acceptance`); History
   lines for BR-122 v2, BR-015 v6, BR-225 v2 and BR-227 v2 in their files;
   `docs/spec-index.md` allocation of F-020, BR-315–BR-321 and ADR-009, with
   the sentence "next unused architecture-decision identifier is ADR-008"
   updated (ADR-008 stays allocated to F-019, unwritten; the next unused
   becomes ADR-010); `business-rules/README.md` rows and rule count; a
   provisional `capability-map.md` entry.

### Out of scope

- Replacing or forking Jimp, or patching its sources or declaration files.
- Fixing moderate or low findings that may appear later (the gate threshold is
  high, D-3); any such finding goes to `BACKLOG.md` or its own ticket.
- An advisory allowlist or ignore mechanism.
- Automated dependency update tooling (Dependabot, Renovate).
- Changing `tsconfig.build.json` beyond what it inherits from `tsconfig.json`.
- Adding `audit` to the `needs` of `sonar` or `sonar-pr`, or to the Sonar
  two-run gate check (BR-149 v2 unchanged).
- `npm-shrinkwrap.json` or any other change to the package contract that
  would carry the overrides into tarball installs (D-1; `BACKLOG.md`, for the
  public-publication preparation ticket).
- Writing the missing ADR-008 of F-019 (`BACKLOG.md`).
- Release automation; releases stay on the owner's explicit go.

## Business rules

### Overrides and lockfile

- **BR-315** — `package.json` has a top-level `overrides` object deep-equal to
  `{"@jimp/types": {"zod": "$zod"}, "@jimp/plugin-resize": {"zod": "$zod"},
  "minimatch": "11.0.8"}`, and `zod` stays a direct `dependencies` entry with an
  exact version. Verified by: AC-01.
- **BR-316** — In `package-lock.json`, the only `packages` key whose last
  `node_modules/` segment is `zod` is `node_modules/zod`, and its version is
  `>=4.6.6`; every `packages` entry whose last `node_modules/` segment is
  `minimatch` has a version `>=11.0.1`. Verified by: AC-02.

### Runtime compatibility

- **BR-317** — With the lockfile of BR-316, `@jimp/types` and
  `@jimp/plugin-resize` resolve `zod` to the same module as the root package
  (`require.resolve("zod")` from each package directory equals the root
  resolution). Through the executed image route, a 600 × 400 PNG is
  extracted and resized to 512 × 341, as on the base; a direct
  `image.resize` with `w: -1` throws an error that is an instance of the root
  `zod` `ZodError`, and `JimpClassSchema.safeParse` (exported by
  `@jimp/types`, not called by `@jimp/core` at run time) refuses a bitmap whose
  `data` is neither a `Buffer` nor a `Uint8Array`. Verified by: AC-03.
- **BR-122 v2** — v1 holds (pure-JS extraction, no external request, no
  native/WASM codec, no eval, scalar-only Jimp schema surface with no
  `z.array|record|map|set`), and the Jimp schemas run on the single root `zod`
  of BR-316 instead of a nested Zod 3. Verified by: AC-03 (renamed test
  `TestBR122_pure_js_dependencies pins exact producer source, scalar-only Jimp
  schema surface and root Zod 4`).

### Type checking

- **BR-318** — `tsconfig.json` `compilerOptions` deep-equals its value on the
  base plus `skipLibCheck: true`; `tsconfig.build.json` sets no
  `skipLibCheck` of its own. Project sources and tests stay fully
  type-checked (BR-010 unchanged: a type error in `src/` still fails
  `make typecheck` and `make build`). Because `ResizeOptions` of
  `@jimp/plugin-resize` resolves to `any` under this setting,
  `src/extraction-image.ts` declares a local type for the resize options
  (`{ w: number; h: number; mode: ResizeStrategy }`, exported for the test),
  builds the options as a value of that type, and passes that value to
  `image.resize`; it passes no inline object literal. Verified by: AC-04.

### Audit target and CI job

- **BR-319** — `make audit` (prerequisite `_require-setup`) runs exactly
  `$(COMPOSE) run --rm dev npm audit --audit-level=high` and exits with npm
  audit's status. `make help` lists `make audit`. `make check` does not run
  `audit` (it needs the network advisory service). Verified by: AC-05.
- **BR-320** — `.github/workflows/ci.yml` has a job `audit` whose canonical
  form equals the expected job of the CI policy helper, compared like the
  `image` job: `runs-on` the BR-225 self-hosted label array, `needs:
  [changes]`, `if` exactly `needs.changes.outputs.heavy != 'false'`,
  `timeout-minutes: 20`, no job-level `permissions`, `env`, `strategy` or
  secrets reference, and exactly three steps: the pinned checkout with
  `persist-credentials: false`, `run: make setup`, `run: make audit`. The
  policy validator admits `make audit` only in the `audit` job. `audit` is not
  one of the five build gates (`lint`, `format`, `typecheck`, `test`,
  `build`): it is not in `sonar` or `sonar-pr` `needs` nor in the Sonar
  two-run gate check. `ci-result` needs `audit`. Verified by: AC-06.
- **BR-015 v6** — v5 holds; the exact job set adds `audit` (BR-320) and the
  Make-only `run` allowlist adds `make audit`, admitted only in `audit`; the
  admitted non-Make `run` texts are unchanged (ten occurrences); the gates
  that Sonar waits for stay the five build gates. Verified by: AC-06.
- **BR-225 v2** — v1 holds; `audit` runs on the label array, and the
  `timeout-minutes` table adds `audit` 20. Verified by: AC-06.
- **BR-227 v2** — v1 holds; `audit` has `needs: [changes]` and the heavy `if`
  of the gate jobs, and `ci-result` needs every job except `fork-refusal`,
  `audit` included. Verified by: AC-06.

### Documentation

- **BR-321** — `docs/development.md` no longer states that the audit is not
  clean; its dependency-audit paragraph names the BR-315 overrides, ADR-009,
  `make audit` and the CI `audit` job. `SECURITY.md` has a section
  `## Dependency audit` stating that CI fails on any high or critical `npm
  audit` finding, that a new one is fixed before a release, not allowlisted,
  and that the overrides do not apply to an install of the packed tarball
  (`npm install -g`), which can resolve Jimp's nested Zod 3 again.
  `CHANGELOG.md` Unreleased has a `### Fixed` line for the advisories and an
  `### Added` line for `make audit` and the CI job, both citing #104.
  Verified by: AC-07.

## Acceptance criteria

Tests read the repository files on the branch; no test contacts the advisory
service except AC-08, which is a real-environment check.

- **AC-01** (BR-315) — Given `package.json`, When the test parses it, Then
  `overrides` deep-equals the BR-315 object and `dependencies.zod` is an exact
  version; Given a copy without one override entry or with `minimatch` set to
  `^11.0.8`, Then the assertion helper rejects it. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR315_...`).
- **AC-02** (BR-316) — Given `package-lock.json`, When the test walks
  `packages`, Then exactly one `zod` entry exists, at `node_modules/zod`, with a
  version `>=4.6.6`, and every `minimatch` entry is `>=11.0.1`; Given synthetic
  lockfile objects with a nested `node_modules/@jimp/types/node_modules/zod`
  at 3.25.76, or a `minimatch` at 10.2.6, Then the checker rejects each.
  Verified by: `tests/dependency-audit.test.ts` (`TestBR316_...`).
- **AC-03** (BR-317, BR-122 v2) — Given the installed dependencies, When the
  test resolves `zod` from each Jimp package, Then it equals the root
  resolution; When a 600 × 400 PNG goes through the image extraction route,
  Then the result is a PNG of 512 × 341 as on the base; When `image.resize({
  w: -1 })` runs, Then it throws an instance of the root `ZodError`; When
  `JimpClassSchema.safeParse` gets `{ bitmap: { data: "x", width: 1, height: 1
  } }`, Then `success` is false; the BR-122 source-surface test
  still passes under its v2 name. Verified by: `tests/read-dependencies.test.ts`,
  `tests/read-image.test.ts` (`TestBR317_...`, `TestBR122_...`).
- **AC-04** (BR-318) — Given `tsconfig.json` and `tsconfig.build.json`, When
  the test parses them, Then `tsconfig.json` `compilerOptions` deep-equals
  the base `compilerOptions` (a literal copy in the test) plus `skipLibCheck:
  true`, and `tsconfig.build.json` has no `skipLibCheck`; a type-level
  assertion records that `ResizeOptions` of `@jimp/plugin-resize` is `any`
  (it fails when a Jimp release fixes the type, so the local type is
  revisited); two `@ts-expect-error` assignments show that the local resize
  options type rejects `mode: "nearest"` and a missing `h`;
  a source check finds `image.resize` called with the typed value, not an
  inline literal; the existing BR-010 type-error fixtures still fail `tsc`
  and the build; `make typecheck` passes. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR318_...`),
  `tests/quality-commands.test.ts` (BR-010, unchanged), `make check`.
- **AC-05** (BR-319) — Given the Makefile fixture with a fake `docker`, When
  `make audit` runs, Then the recorded command is the compose `run --rm dev npm
  audit --audit-level=high`, and the fake's exit status 1 or 0 becomes the
  target's status; When `make help` runs, Then its output contains `make
  audit`; When `make -n check` runs, Then no `npm audit` command appears.
  Verified by: `tests/dev-environment.test.ts` (`TestBR319_...`).
- **AC-06** (BR-320, BR-015 v6, BR-225 v2, BR-227 v2) — Given the real
  workflow, When the policy validator runs, Then it accepts it with the `audit`
  job equal to `expectedAuditJob`, `TIMEOUTS.audit` 20, `ci-result` needing
  `audit`, and `sonar`/`sonar-pr` needs unchanged; Given mutations — `audit`
  removed, its `if` changed, `needs` removed, `persist-credentials` removed,
  `make audit` replaced or moved to another job, `make audit` added to a gate
  job, `audit` dropped from `ci-result` needs, `audit` added to `sonar` needs,
  another timeout, a step `env` with a secret — Then each is rejected.
  Verified by: `tests/ci-policy.test.ts`, `tests/helpers/ci-policy.ts`
  (`expectedAuditJob` compared canonically like `expectedImageJob`; `GATES`
  unchanged).
- **AC-07** (BR-321) — Given the docs, When the content test runs, Then
  `docs/development.md` has no "audit is not clean" sentence and names
  `make audit` and ADR-009, `SECURITY.md` has `## Dependency audit` with the
  tarball-install limit, and `CHANGELOG.md` Unreleased cites #104 under Fixed
  and Added; `make format-check` passes. Verified by:
  `tests/dependency-audit.test.ts` (`TestBR321_...`), review.
- **AC-08** (BR-319, BR-320; real environment) — Given the merged `main` SHA,
  When `make audit` runs in the dev container and CI runs on that SHA, Then
  `npm audit` reports 0 high and 0 critical findings, `make audit` exits 0 and
  the CI `audit` and `ci-result` jobs succeed. Verified by: acceptance comment
  on #104 (command output and run link). Rehearsed in the PR by the PR's own
  CI `audit` job.

## Decisions

- **D-1 — Override nested Zod to the root Zod 4 (`$zod`).** It removes the
  high advisory at the source, keeps one Zod in the tree, and needs no fork.
  Jimp's runtime surface uses only APIs present in Zod 4 (Context), and BR-317
  pins that behaviour through the real route. Risk: Jimp declares
  `^3.23.8`, so a Jimp release relying on a Zod 3-only API would break; BR-317
  and BR-122 v2 tests catch it on the upgrade PR. Residual risk, accepted for
  #104: `overrides` apply only in the root project, so an install of the
  packed tarball (`npm install -g`, `README.md`) resolves Jimp's nested Zod 3
  again; the container image (`npm ci` on the lockfile) is covered; BR-321
  states the limit in `SECURITY.md`. Considered and deferred:
  `npm-shrinkwrap.json`, which would carry the resolution into tarball
  installs but changes the package contract; it belongs to the
  public-publication preparation ticket (`BACKLOG.md`). Rejected: keeping
  Zod 3 with a written justification and a CI allowlist (ships a known high
  finding in a public beta, and an allowlist rots); a local type shim for
  Jimp's `.d.ts` (maintains a copy of third-party types for no runtime gain);
  replacing Jimp (large F-009 change, out of proportion to the finding).
- **D-2 — Pin `minimatch` to `11.0.8` globally.** All its users are
  development tooling; lint passes on 11.0.8. Rejected: waiting for upstream
  tooling releases (no date; leaves the finding open).
- **D-3 — Gate threshold `high`.** High and critical findings block; moderate
  and low are triaged as tickets. Rejected: `moderate` (tooling-only moderates
  would block unrelated PRs with no runtime exposure); no CI gate, release
  checklist only (a finding is seen late, after merges).
- **D-4 — Audit as a CI job, not part of `make check`.** `npm audit`
  queries the registry advisory service; `make check` stays offline and
  deterministic. Consequence: a newly published advisory can turn CI red on an
  unrelated PR; that is intended, and the fix goes through its own ticket.
  Fail-closed is the intent: if the advisory service cannot be reached, the
  job is expected to fail rather than pass silently (npm's own exit status;
  not asserted by a test). `audit` is a separate job compared canonically,
  not a sixth build gate, so Sonar's `needs` and two-run gate check keep the
  five build gates (BR-149 v2). Rejected: a release-checklist step only
  (manual, easy to skip); a scheduled workflow (not a merge criterion); adding
  `audit` to `GATES` (forces it into Sonar's needs).
- **D-5 — `skipLibCheck: true`.** Needed because Jimp's declarations name Zod 3
  types. Residual risk, accepted: errors inside any third-party `.d.ts` are no
  longer reported, and types built on the missing Zod 3 names collapse to
  `any`. Concretely, `ResizeOptions` of `@jimp/plugin-resize` is `any`, so
  the argument of `image.resize` is not checked by the library type; BR-318
  restores a check at that call through a local options type and records the
  `any` in a type-level test. Other Jimp types reached by project code may be
  similarly weakened; project sources and tests stay fully checked against
  the types they declare, and the runtime tests of BR-317 cover the Jimp
  boundary. Rejected: a shim or patched `.d.ts` (see D-1).
- **D-6 — ADR-009 records D-1, D-5 and their rejected options**, because the
  override and the weaker library check are costly to reverse silently.
  ADR-008 is not used: done F-019 promises it and it is not written yet
  (`BACKLOG.md`).

## Open questions

## Stress-test

Review `104-spec-review-1-reviewer` (verdict changes), posted on #104
(issuecomment-6806805640). Dispositions:

- **104-spec-review-1 #1** (major, ADR-008 already promised by F-019) —
  retained. F-020 uses ADR-009 (header, Context, BR-321, AC-07, D-6); the
  missing ADR-008 of F-019 is a `BACKLOG.md` line; Scope item 6 updates the
  `docs/spec-index.md` "next identifier" sentence in the feature PR.
- **104-spec-review-1 #2** (major, `audit` in `GATES` contradicts BR-149 v2)
  — retained. BR-320 gives the explicit canonical shape compared like
  `expectedImageJob`; `GATES` unchanged; `TIMEOUTS` and `ci-result` needs gain
  `audit`; `make audit` admitted only in `audit`; BR-015 v6 states Sonar keeps
  the five build gates; AC-06 adds the Sonar and gate-job mutations.
- **104-spec-review-1 #3** (major, `ResizeOptions` is `any`) — retained. D-5
  states it precisely; BR-318 requires a local typed options value passed to
  `image.resize`; AC-04 adds the type-level `any` record and the rejection
  of a wrong option.
- **104-spec-review-1 #4** (major, overrides ignored by tarball installs) —
  retained. Context, D-1 and BR-321 (`SECURITY.md`) state the residual risk;
  `npm-shrinkwrap.json` considered and deferred to the public-publication
  preparation ticket (out of scope, `BACKLOG.md` line).
- **104-spec-review-1 #5** (minor, AC-04 full `compilerOptions`) — retained.
  BR-318 and AC-04 deep-equal the base `compilerOptions` plus `skipLibCheck`.
- **104-spec-review-1 #6** (minor, missing Verified by) — retained. BR-015 v6,
  BR-225 v2 and BR-227 v2 cite AC-06; BR-225 v2 names `audit` 20.
- **104-spec-review-1 #7** (minor, Scope omits records) — retained. Scope
  item 6 lists every record the PR touches.
- **104-spec-review-1 #8** (minor, untested unreachable-service claim) —
  retained. BR-319 says "exits with npm audit's status"; fail-closed stays as
  D-4 rationale.

Review `104-spec-review-2-reviewer` (verdict approve, diff `b606094..5b9228a`),
posted on #104 (issuecomment-6806844318). Disposition:

- **104-spec-review-2 #1** (minor, AC-04 lets the author pick one rejected
  case) — retained. AC-04 requires both `@ts-expect-error` cases.

Freeze (autonomous, PROJECT.md D-1): frozen 2026-11-11 by the orchestrator
after the `approve` of `104-spec-review-2-reviewer`; no open question remains.

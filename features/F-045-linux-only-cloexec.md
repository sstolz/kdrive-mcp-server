---
id: F-045
title: Linux-only close-on-exec flag
ticket: "#96"
status: draft
version: 1
---

## Context

The audit file sink and the persistent OAuth state store each define
`O_CLOEXEC = 0o2000000`. This is the Linux value. Both pass it to file opens
on every platform. Elsewhere, that bit can mean something else or nothing.
This affects users who open an audit file or an OAuth state file outside Linux.

The owner decision of 2026-11-19 limits this explicit flag to
`process.platform === "linux"`. On every other platform, omit it. Libuv already
opens files with close-on-exec. Linux is the supported production platform.
Its numeric open flags and behavior stay byte-for-byte the same.

Sources: [BR-239](../business-rules/BR-239.md),
[BR-293](../business-rules/BR-293.md), [BR-295](../business-rules/BR-295.md),
the open-flag passages in [F-016](F-016-mutation-audit-gate.md) and
[F-019](F-019-persistent-oauth-state.md), `src/audit/sink.ts` and
`src/auth/proxy/store.ts`. All three rule texts state `O_CLOEXEC`.
BR-239 and BR-293 are active at v1. BR-295 is already active at v2 under
F-028, so this feature proposes BR-295 v3. Its version number is not reused.

F-045 was the next free feature ID on `main` on 2026-11-19, checked by the
orchestrator. F-044 was the latest on `main`. Re-check current main before
freeze and before the implementation PR.

This ticket is not security-sensitive by owner decision on 2026-11-19.
Linux behavior is unchanged. Elsewhere, an undefined flag is removed.

## Scope

1. Use one shared helper, `closeOnExecFlag`, in `src/open-flags.ts`.
   It accepts a platform parameter that defaults to `process.platform`.
   It returns exactly `0o2000000` for `linux` and `0` otherwise.
   Both source files import it for all three open flag sets. Each keeps
   module-level flag constants computed once at module load from the helper.
   Neither keeps its own close-on-exec value or platform condition. No
   `platform` option is added to the sink or store. Preserve all other flags
   and modes.
   Version only BR-239, BR-293 and BR-295 for this behavior change.
2. As a separate records-only item in the implementation PR, synchronize the
   acceptance markers left by #88 under AGENTS.md §6. Set BR-021 v2 and
   BR-207 v2 active and F-044 done. Update `capability-map.md` and
   `business-rules/README.md` markers. Remove `pending acceptance` from the
   #88 / F-044 CHANGELOG line. Link these updates to the acceptance comment
   in the [#88 acceptance record](https://github.com/sstolz/kdrive-mcp-server/issues/88#issuecomment-7005778721).
   This item changes no #88 behavior and allocates no new rule version.

### Out of scope

- Other platform-specific flag values or new platform support guarantees.
- File validation, ownership, permissions, error mapping or SQLite changes.
- Changes to audit records, writes, locking, schema or startup ordering.

## Business rules

Keep the IDs and all accepted text and history. Follow the version pattern in
[BR-016](../business-rules/BR-016.md) and
[BR-178](../business-rules/BR-178.md). BR-239 v1 and BR-293 v1 stay accepted
until their v2 acceptance on actual main. BR-295 v2 stays accepted until v3
acceptance. Implementation adds the proposed versions as pending acceptance,
with dated F-045 history entries and updated examples and verification.
This draft activates no rule.
The done specs F-016 and F-019 stay unchanged as history. The versioned BRs
are authoritative.

- **BR-239 v2** — v1 holds with this exact replacement of its open flag list:
  `O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_NONBLOCK`, plus
  `0o2000000` only when `process.platform === "linux"`.
  `O_NONBLOCK` folds the existing PR #84 implementation note into the rule;
  it is already passed today. Creation mode stays `0600`. All v1 file checks,
  refusals and mode and owner preservation stay unchanged.
  Verified by: AC-01, AC-02, AC-04 and AC-05.
- **BR-293 v2** — v1 holds with this exact replacement of its absent-file
  creation flags: `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`, plus
  `0o2000000` only when `process.platform === "linux"`.
  `O_WRONLY` records the access flag already passed today. Creation mode
  stays `0600`. All v1 directory, path, journal, identity and write checks
  and failure behavior stay unchanged. Verified by: AC-01, AC-02, AC-04 and AC-05.
- **BR-295 v3** — v2 holds with one replacement in step (2): the header
  descriptor opens with `O_RDONLY | O_NOFOLLOW`, plus `0o2000000` only when
  `process.platform === "linux"`. No creation mode is passed for this read.
  The v2 changes to steps (5), (9) and (11) remain accepted. All other steps,
  header bytes, descriptor closure, errors and rollback rules stay unchanged.
  Against v1, this changes only the explicit close-on-exec flag condition in
  step (2), in addition to the already accepted F-028 v2 changes.
  Verified by: AC-01–AC-05.

## Acceptance criteria

Use injectable file ports to capture actual open calls in
`tests/audit-sink.test.ts` and `tests/auth/proxy-store.test.ts`.
Stub `process.platform`, then dynamically import the consumer modules after
`vi.resetModules()`, following `tests/read-worker-lifecycle.test.ts`.
Restore stubs after each case. Do not require Darwin or Windows runners.
Do not send simulated-platform flags to real opens.

Expected values are independent expressions using `node:fs` constants and
the literal `0o2000000`. Do not derive expectations from production flag
exports. Assert the whole numeric flag value and mode argument for each open.
Retain existing behavioral tests. The current BR-239, BR-293 and BR-295 tests
cover file checks and modes, but contain no direct open-flag assertion.
Add Linux characterization assertions before changing production code.

- **AC-01 (BR-239 v2, BR-293 v2, BR-295 v3)** — Given platform `linux`,
  When the audit file opens, the absent state file is created and the nonempty
  state file header is read, Then each open includes `0o2000000` and equals
  its pre-change numeric flags exactly. Both creation modes are `0o600`.
  Verified by named tests
  `BR-239 v2 linux preserves exact open flags`,
  `BR-293 v2 linux preserves exact creation flags` and
  `BR-295 v3 linux preserves exact header flags` in the files above.
- **AC-02 (BR-239 v2, BR-293 v2, BR-295 v3)** — Given platform `darwin`
  and separately `win32`, When those three opens run through fake file ports,
  Then each whole numeric flag value equals the existing base expression
  in its rule above, without `0o2000000`. Both creation modes are `0o600`.
  Verified by parameterized tests
  `BR-239 v2 non-linux omits Linux close-on-exec flag`,
  `BR-293 v2 non-linux omits Linux close-on-exec flag` and
  `BR-295 v3 non-linux omits Linux close-on-exec flag`, each with both rows.
- **AC-03 (BR-295 v3)** — Given each of `linux`, `darwin` and `win32`,
  When the state file header opens, Then the open passes no mode argument.
  Verified by the parameterized test `BR-295 v3 header open passes no mode`.
- **AC-04 (BR-239 v2, BR-293 v2, BR-295 v3)** — Given the shared helper
  and a platform parameter, When called for `linux`, Then it returns exactly
  `0o2000000`; When called for any other platform, Then it returns `0`.
  Verified by `BR-239 v2 BR-293 v2 BR-295 v3 shared flag is Linux only` in
  `tests/open-flags.test.ts`, with `darwin`, `win32`, `freebsd`, `aix` and
  `android` rows expecting `0`. Also verify that
  `grep -rn "0o2000000" src/` matches only `src/open-flags.ts`.
- **AC-05 (BR-239 v2, BR-293 v2, BR-295 v3)** — Given the existing audit
  and state-store regression cases, When `make check` runs in the development
  container, Then they pass with unchanged validation, refusals, file bytes,
  descriptor closure and startup ordering. Verified by the retained
  `TestBR239_*`, `BR-293 ...`, `BR-295 ...` and `BR-295 v2 ...` tests and the
  new named tests above. Repeat acceptance on the actual merged main SHA.
- **AC-06 (BR-021 v2, BR-207 v2; separate #88 records item)** — Given the
  verified #88 acceptance comment, When the implementation PR synchronizes
  records, Then both versions are active, F-044 is done, and its capability,
  rule index and CHANGELOG markers no longer say pending. Each affected
  acceptance record links to that exact comment. Verified by a content and
  link check of the scoped record diff against the comment. No new unit test
  is needed for this marker update.

## Decisions

- Apply the Linux value only for `process.platform === "linux"`, as decided
  on 2026-11-19. Use one shared helper in `src/open-flags.ts` so both consumers
  use the same platform decision. Libuv provides close-on-exec elsewhere.
  The `android` result is `0` under the owner's Linux-only rule because
  libuv still sets close-on-exec.
- Keep module-level flag constants computed once at module load from the
  shared helper. Tests stub `process.platform` and dynamically import the
  modules after `vi.resetModules()`, following
  `tests/read-worker-lifecycle.test.ts`.
- Reject adding a `platform` option to the sink or store. Module reset and
  platform stubbing test the chosen behavior without adding consumer options.
- Reject dropping the flag everywhere. That would change the supported Linux
  open flags and violate the owner's compatibility requirement.
- Reject a per-platform value table. It adds values to maintain and verify
  without a need; the owner chose omission on every non-Linux platform.
- Keep BR-295's accepted v2 and propose v3. Reusing v2 would overwrite an
  accepted rule. Allocate no new BR or ADR.

## Open questions

## Stress-test

- Round 1, finding 1: retained — Removed drafting-task exclusions. Out of
  scope now lists only product exclusions.
- Round 1, finding 2: retained — Recorded the orchestrator's 2026-11-19
  feature ID check on main. Removed stale drafting and review notes.
- Round 1, finding 3: retained — Added the exact #88 acceptance comment permalink.
- Round 1, finding 4: retained — Chose module-level flag constants from the
  shared helper and dynamic imports after module reset with platform stubs.
  Rejected a sink or store platform option.
- Round 1, finding 5: retained — Added the android helper row expecting zero,
  its owner-rule rationale and the source-literal grep check.
- Round 1, finding 6: retained — Kept F-016 and F-019 unchanged as history
  and stated that the versioned BRs are authoritative.
- Round 1, finding 7: retained — Merged exact flag and creation-mode checks
  into AC-01 and AC-02. AC-03 now checks only that header opens pass no mode.

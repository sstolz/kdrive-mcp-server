---
id: F-048
title: Warn about deny patterns outside configured roots
ticket: "#110"
status: draft
version: 1
---

## Context

Operators can configure root `7:/Private/Documents` and deny pattern
`/Documents/Confidential/**`. Both inputs are valid, but the pattern excludes
nothing below that root. The API tree includes `/Private`, even when the web
UI omits it. The owner decision of 2026-11-19 is to warn, without refusing
startup or changing filtering.

Sources examined:

- [F-002](F-002-configuration.md), BR-023 v4,
  `src/config-schema.ts` and `src/config-values.ts`: patterns are at most
  1,024 UTF-8 bytes, start with `/` or `**/`, and allow component-local `*`
  and `?` and whole-component `**`. `/` is valid. Selected lists reject
  duplicates and retain order; existing bounds and grammar remain intact.
- [F-003](F-003-tree-access-policy.md), BR-034 v1,
  `src/policy/index.ts` and `src/policy/glob.ts`: matching is of entire paths,
  case-sensitive, without Unicode normalization, and global across configured
  drives. A folder match does not automatically match its descendants.
  `/Private` alone does not deny `/Private/Documents`; terminal `/**`
  includes the named folder and its descendants. `/` matches only `/`.
- [F-044](F-044-root-path-resolution-errors.md), BR-021 v2 and BR-207 v2,
  `src/config.ts` and `src/kdrive/adapter.ts`: both ID and path selectors
  resolve during preflight, but the resolved configuration currently retains
  only `(driveId, folderId)`. ID metadata is currently checked for identity
  and type, not retained as a full path. Successful path walks establish the
  exact selected path. [Deployment guidance](../docs/deployment.md) explains
  the API's `/Private` component.
- `src/main.ts`, BR-027 v1, BR-071 v2, BR-167 v3 and BR-217 v2:
  configuration diagnostics redact input values and file paths; stdout in
  stdio is reserved for MCP. HTTP operator events use stderr JSON lines.
  Existing upstream events use fixed text in stdio and JSON in HTTP and are
  suppressed during failed preflight. Their format is not changed here.

## Scope

Add a bounded, conservative startup diagnostic over the effective selected
deny list and resolved configured roots. Emit one warning per pattern proved
incompatible with every root, in both stdio and HTTP modes. Preserve local
validation, startup eligibility, root authorization by ID, and runtime policy.

This is a full-path, non-security-sensitive diagnostic change: it grants no
access, changes no filtering, and logs no path content. Privacy and unchanged
authorization remain review criteria. This authoring task creates only this
draft and its allocation entry; implementation follows review and freeze.

IDs were checked in the worktree and the locally available `origin/main`
at `55f2b8e3d1f1eb5dcf7d4c72cf3abe5aa8a69b70`: F-047 and BR-433 are the
highest allocated IDs. Local `main` is older. Reserve F-048 and BR-434–BR-435
for this draft; the orchestrator rechecks actual main before freeze and PR.

### Out of scope

- Refusing syntactically valid patterns, correcting them or inserting
  `/Private`; changing glob syntax, filtering, case or Unicode handling.
- Proving that an item currently exists at a potentially matching path;
  enumerating descendants, received shares or unconfigured drives.
- Monitoring root moves or renames after startup, configuration reload,
  per-session warnings, or guaranteeing that an unwarned pattern is useful.
- New configuration settings, diagnostic commands, metrics or audit records.
- Changes to existing preflight failures, retries, request counts or budgets;
  extra upstream requests solely for this warning.

## Business rules

The versions below are proposals, not accepted records. Implementation retains
prior definitions/history, records changed versions as pending acceptance with
F-048 as source, adds dated History entries and updates BR-named tests.
No BR file is written during drafting.

- **BR-023 v5** — v4's limits, grammar, validation order and normalization
  remain unchanged; a valid deny pattern classified by BR-434 v1 as outside
  all resolved roots is retained unchanged and causes a startup warning,
  never a configuration rejection. This keeps the configuration-validation
  purpose and adds a valid-input diagnostic case, hence an in-place version.
  Verified by: AC-01, AC-09.
- **BR-021 v3** — v2 holds, except that successful preflight also retains
  diagnostic path evidence, when available, bound to each resolved
  `(driveId, folderId)`. An unavailable diagnostic path does not invalidate
  an otherwise successful root resolution. Existing root validation and
  failure mappings are unchanged. This versions the existing resolved-root
  output contract, rather than introducing another authorization rule.
  Verified by: AC-05, AC-06, AC-07.
- **BR-207 v3** — v2 holds with diagnostic path evidence obtained from the
  same successful path walk or ID-metadata response, as specified below,
  without additional upstream requests. This versions the existing resolver
  return contract; its identity/type checks, failure classifications and
  budgets remain intact. Verified by: AC-05, AC-06, AC-07.
- **BR-027 v2** — v1's error contract remains unchanged; successful startup
  additionally permits only the redacted warning shape in BR-435 v1.
  Raw input values and paths remain prohibited. This versions the existing
  diagnostics contract because stable codes and setting names alone no
  longer describe every configuration diagnostic. Verified by: AC-08, AC-09.
- **BR-434 v1** — A valid pattern is classified as outside configured roots
  exactly when all configured roots have known diagnostic paths and none
  satisfies the conservative compatibility criterion below. This is a new
  diagnostic classification purpose, separate from BR-034's enforcement.
  Verified by: AC-01–AC-07, AC-10.
- **BR-435 v1** — Each startup offers exactly one stderr JSON warning of the
  specified shape for each BR-434 v1 classification, after complete successful
  preflight and before starting either transport. This new operator event
  does not alter filtering or the startup result. Verified by: AC-01,
  AC-07–AC-10.

### Resolved diagnostic paths (BR-021 v3, BR-207 v3)

Finish all existing drive inspections and root resolutions first. Preserve
first-selector ordering and deduplication by `(driveId, folderId)`. Associate
path evidence with that identity, never with list position alone.

A successfully resolved path selector supplies its exact absolute API path
from the completed walk, including `/Private` when present. Do not compare a
path selector that has not yet resolved. For an ID selector such as `7:42`,
use the same metadata response already fetched to validate that ID: obtain
its canonical full path through the existing live-tree normalization rules
in `src/kdrive/normalize.ts` (`treeItem`), including identity and ancestry
consistency. A successfully validated drive-root directory ID `1` has path
`/`. Never infer another ID's path from a name, the UI, or a different root.

Do not add metadata calls, parent walks, retries or descendant listings.
Missing or invalid path/ancestry evidence in otherwise sufficient ID/type
metadata means diagnostic path **unknown**, not a new preflight failure.
Do not fall back to a raw provider `path` string that failed normalization.
For duplicate resolved identities, one known path can supply a missing path;
conflicting known paths make that identity unknown for this diagnostic.

If any root path is unknown, suppress all outside-root warnings: it could
make any global pattern useful. Do not emit a second diagnostic about the
unknown path. An ordinary preflight failure retains F-044's existing error,
exit status and single sanitized stderr line, with no deny warnings even if
earlier roots resolved successfully. No partial diagnostic escapes.

Retained paths are startup snapshots used only for this diagnostic. They
never authorize runtime access or rebind configured IDs after a rename.

### Conservative compatibility criterion (BR-434 v1)

This check proves a narrow class of configuration mistakes. It deliberately
allows false negatives to avoid false warnings on useful patterns. It reasons
about possible paths, without consulting current descendants.

1. A pattern starting with `**/` is always potentially useful: no warning.
2. For an anchored pattern, split its components after the initial `/`.
   Take the maximal leading sequence of complete literal components before
   the first component containing `*` or `?` (including whole-component `**`).
   A component such as `Priv*` contributes **no** literal component; do not
   use its character prefix. If there is no wildcard, take all components.
   `/` has an empty sequence.
3. Split each resolved root path into components; `/` has none. A pattern
   is compatible with a root when its literal sequence is a component-prefix
   of the root sequence **or** the root sequence is a component-prefix of
   its literal sequence. Comparisons are exact, case-sensitive and without
   Unicode normalization, just as BR-034. Component boundaries are mandatory.
4. Warn only if no root in any configured drive is compatible. A pattern
   useful on one drive is sufficient to suppress the warning globally;
   there is no per-drive warning.

Consequences for root `/Private/Documents`:

| Pattern | Warn | Reason |
| --- | --- | --- |
| `/Documents/Confidential/**` | Yes | First literal components differ. |
| `/Private2/**` | Yes | Component boundary prevents a character-prefix match. |
| `/private/**` | Yes | Case differs. |
| `/Private/Documents/Confidential/**` | No | Root is a prefix of the literal sequence. |
| `/Private/Documents` | No | Equal sequences. |
| `/Private` | No | Ancestor-only match is conservatively retained. |
| `/` | No | Empty literal sequence is compatible with every root. |
| `/Private/**` | No | Literal sequence is above the root. |
| `/Priv*/Documents/**`, `/?/Other/**`, `/**/Other` | No | Leading wildcard makes the literal sequence empty. |
| `/Private/Doc?ments/**` | No | Stop before the wildcard component. |
| `/Other*/Documents/**` | No | Do not attempt to prove a wildcard component disjoint. |
| `/Other/*/Documents/**` | Yes | Literal `Other` already diverges before the wildcard. |
| `**/Confidential/**` | No | Leading globstar exemption. |

A pattern matching only an ancestor, including `/` for a non-root root, does
not directly deny any item beneath the root under BR-034. It still receives
no warning under this deliberately conservative criterion. The warning claims
`outside_configured_roots`, not an exhaustive proof that unwarned patterns
match descendants. A configured root `/` suppresses every such warning.

### Event and lifecycle (BR-027 v2, BR-435 v1)

In both transports the warning is one JSON object plus LF, with exactly:

```json
{"event":"deny_pattern_root_warning","level":"warn","setting":"deny","pattern_index":0,"reason":"outside_configured_roots"}
```

`pattern_index` is the zero-based index in the effective selected deny list,
after existing source selection/list parsing, preserving its order. All other
values are the fixed strings shown. Emit in ascending index order, once per
pattern per process startup, independent of the upstream-event rate windows.
At most the existing 256 deny entries can produce warnings. Do not add a
timestamp, drive ID, root ID, pattern text, root path, filename, path fragment,
hash, configuration source location, URL, token, identity, exception, stack,
or configuration dump. The index lets the operator consult their own selected
configuration without logging its contents. BR-027's path/input-value ban
applies; BR-167 and BR-217's existing event allowlists remain unchanged.

Run the diagnostic immediately after complete successful preflight in the
common `main` composition, before audit-sink opening, stdio activation or HTTP
listener binding. A later unrelated startup failure can follow these warnings;
they do not claim that the transport is ready. Warnings are best-effort stderr
writes, with no new flush wait or fatal error if a warning write throws.
They are never MCP frames, HTTP response bodies or mutation audit entries.
No warning on session creation, tool calls or shutdown.

There is no configuration-check command in the current argument parser/help.
The CLI's normal stdio and HTTP startup paths both report the warning.
`--help`, `--version`, local-only `loadConfiguration`, and failed local
validation do not resolve roots or report it. No new command is introduced.

## Acceptance criteria

All test names below are planned, not executed evidence. Each new test names
its BR/version. Use synthetic metadata and the real `main(deps)` composition
with injected transport dependencies; no real account is required.

- **AC-01** (BR-023 v5, BR-434 v1, BR-435 v1) — Given root
  `7:/Private/Documents` and deny `/Documents/Confidential/**`, When startup
  completes preflight, Then the deny remains unchanged, exactly index `0`
  warns, and normal startup succeeds. Verified by:
  `tests/deny-root-warning.test.ts`, `TestBR434_mismatched_literal_prefix`,
  and `tests/cli.test.ts`, `TestBR435_stdio_warns_without_refusal`.
- **AC-02** (BR-434 v1) — Given each pattern/root row in the compatibility
  table, When classification runs, Then its result equals the Warn column,
  including ancestor-only patterns and `/`. Verified by:
  `tests/deny-root-warning.test.ts`, `TestBR434_compatibility_table`.
- **AC-03** (BR-434 v1) — Given wildcard components before or after a
  diverging literal component, When classification runs, Then it stops before
  the first wildcard component, never uses a partial component, and exempts
  leading `**/`. Verified by: `tests/deny-root-warning.test.ts`,
  `TestBR434_wildcard_prefix_is_conservative` (all wildcard rows above).
- **AC-04** (BR-434 v1) — Given roots `7:/Private/Documents` and
  `8:/Documents`, and deny `/Documents/Confidential/**`, When startup checks
  every root, Then no warning is emitted; replacing the second root by
  `8:/Other` produces exactly one warning, without a drive field. The same
  any-root behavior holds for two roots in one drive, and a root `/` suppresses
  all warnings. Verified by: `tests/deny-root-warning.test.ts`,
  `TestBR434_any_root_in_any_drive_suppresses_warning`.
- **AC-05** (BR-021 v3, BR-207 v3, BR-434 v1) — Given ID selector `7:42`
  with valid full metadata path `/Private/Documents` and, separately, a path
  selector resolving to that same folder, When preflight finishes, Then both
  produce the same diagnostic result, preserve ID authorization and existing
  request counts, and never diagnose the raw string `7:42` as a path.
  Verified by: `tests/config-preflight.test.ts`,
  `TestBR021v3_retains_identity_bound_diagnostic_paths`, and
  `tests/kdrive/adapter-preflight.test.ts`,
  `TestBR207v3_paths_from_existing_resolution_evidence` (including ID `1`).
- **AC-06** (BR-021 v3, BR-207 v3, BR-434 v1) — Given valid ID/type
  resolution but missing or inconsistent path/ancestry evidence on any root,
  When startup runs, Then it succeeds without outside-root warnings or extra
  requests. Given duplicate IDs with one known path or conflicting known
  paths, When deduplication runs, Then the former retains the known path and
  the latter becomes unknown. Verified by: `tests/config-preflight.test.ts`,
  `TestBR021v3_unknown_or_conflicting_paths_are_conservative`, and
  `tests/kdrive/adapter-preflight.test.ts`,
  `TestBR207v3_optional_path_failure_does_not_reject_root`.
- **AC-07** (BR-021 v3, BR-207 v3, BR-434 v1, BR-435 v1) — Given a
  warning candidate and failed drive inspection, unresolved path, missing ID,
  malformed mandatory resolver fields or upstream failure, When preflight
  fails, Then no warning escapes and the existing F-044 error/status/stream
  contract holds, even after an earlier successful root. Verified by:
  `tests/cli.test.ts`, `TestBR435_failed_preflight_has_only_existing_error`,
  together with existing `tests/config-preflight.test.ts` and
  `tests/kdrive/adapter-preflight.test.ts` failure cases.
- **AC-08** (BR-027 v2, BR-435 v1) — Given mixed useful and useless
  patterns at known indices and canaries in paths, names and credentials,
  When either stdio or HTTP startup runs, Then stderr contains exactly the
  specified warning objects at the useless indices in ascending order before
  transport activation, with no canary or extra field; stdout carries no
  warning and subsequent sessions/tools produce no repeat. A throwing warning
  writer does not refuse startup. Verified by: `tests/cli.test.ts`,
  `TestBR027v2_warning_shape_and_redaction`, and
  `tests/http/cli-http.test.ts`, `TestBR435_http_startup_warning_lifecycle`.
- **AC-09** (BR-023 v5, BR-027 v2) — Given invalid patterns, boundary-size
  inputs, an empty deny list, locally loaded configuration, `--help` or
  `--version`, When their existing entry paths run, Then validation, limits,
  output and exit behavior remain unchanged and no root warning appears.
  Given a valid but incompatible pattern selected through CLI, environment or
  YAML, When normal startup runs, Then the same warning/index contract applies
  to the winning list only. Verified by: `tests/config.test.ts`,
  `TestBR023v5_deny_validation_and_source_selection_unchanged`, and
  `tests/cli.test.ts`, `TestBR027v2_no_warning_on_nonstartup_paths`.
- **AC-10** (BR-434 v1, BR-435 v1) — Given a fixed resolved configuration
  and synthetic paths below its roots, When classification and existing policy
  operations run, Then warnings do not change allow/deny results, including
  exact-folder versus descendant matching. For every generated root/path pair
  where an accepted glob actually matches the root or a descendant, the
  classifier never warns. Given 256 distinct incompatible patterns, When
  startup runs, Then exactly 256 ordered warnings are offered. Verified by:
  `tests/deny-root-warning.test.ts`, `TestBR434_no_false_warning_for_matches`
  (bounded deterministic glob/path enumeration),
  `TestBR435_warning_count_bound`, and `tests/policy.test.ts`,
  `TestBR034_warning_does_not_change_matching`.

## Decisions

1. **Conservative literal-component prefixes.** Choose the criterion above,
   including retaining ancestor-only patterns and `/`. It detects the reported
   missing `/Private` mistake without claiming exhaustive glob usefulness.
   Reject raw character-prefix comparison (component-boundary errors), exact
   literal-only comparison ignoring wildcard positions (false warnings), and
   a full glob-language intersection solver (unnecessary complexity). Reject
   warning on every ancestor-only match: it departs from the conservative
   prefix criterion and expands this ticket beyond the reported mistake.
2. **Global usefulness across drives.** One compatible root anywhere suppresses
   the warning, matching global deny semantics. Reject per-drive warnings:
   they would flag intentional patterns serving another configured drive.
3. **Use completed resolution evidence, with unknown as compatible.** Extend
   BR-021 and BR-207 rather than inventing paths for IDs. Reuse existing
   metadata and successful path walks. Reject checking before resolution
   (wrong for IDs), extra path-discovery requests (additional latency/failure
   surface), and rejecting otherwise valid ID roots for absent diagnostic
   evidence (contradicts warn-without-refusal). A sparse ID response can
   therefore suppress the diagnostic; this is an explicit conservative limit.
4. **One redacted structured event in both transports.** Select the exact
   BR-435 schema and lifecycle above. Reject pattern/root text, hashes and
   drive IDs as unnecessary log content; reject stderr prose variants because
   one schema is easier to test and consume. Existing upstream-event formats
   and OAuth/request logger allowlists are unaffected.
5. **Normal startup only.** No config-check command exists. Reject adding one
   and warning during local parsing: root paths are not yet resolved there.
6. **Tests first after freeze.** First add characterization tests for current
   grammar, exact matching, source selection and preflight failures; run them
   on the unchanged implementation. Then add the named warning/path-evidence
   tests, observe the new expectations fail, and implement only this contract.
   Preserve existing tests; run focused tests and the Docker-only `make check`
   gate, then PR CI and independent review. Acceptance repeats ACs on actual
   main with synthetic dependencies, recording SHA/commands/results in #110.
   No execution or acceptance is claimed by this draft.
7. **Records.** Version BR-023 v4→v5, BR-021 v2→v3, BR-207 v2→v3 and
   BR-027 v1→v2 in place for their same-purpose extensions; allocate BR-434
   and BR-435 v1 for the classifier and event. BR-034, BR-071, BR-167 and
   BR-217 remain unchanged for the reasons above. No ADR is needed for this
   reversible diagnostic. Implementation prepares pending BR/capability and
   changelog records; acceptance evidence and exposed token counters belong
   in the ticket/PR, not per-run repository files. Final active/done markers
   follow acceptance and are synchronized in the next scoped PR.

## Open questions

## Stress-test

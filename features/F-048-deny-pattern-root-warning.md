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
The diagnostic preserves patterns whose raw prefixes can refuse folder sharing
under BR-040, even when they match no path below a configured root. Any
non-empty deny list also retains traversal effects on folder mutations.

Sources examined:

- [F-002](F-002-configuration.md), BR-023 v4,
  `src/config-schema.ts` and `src/config-values.ts`: patterns are at most
  1,024 UTF-8 bytes, start with `/` or `**/`, and allow component-local `*`
  and `?` and whole-component `**`. `/` is valid. Selected lists reject
  duplicates and retain order; existing bounds and grammar remain intact.
- [F-003](F-003-tree-access-policy.md), BR-034 v1,
  `src/policy/index.ts` and `src/policy/glob.ts`: matching is of entire paths,
  case-sensitive, without Unicode normalization, and global across configured
  drives and, when `sharedWithMe=true`, received-share recipient paths under
  `/Shared/` (`src/policy/received.ts`, BR-048 and BR-050). A folder match
  does not automatically match its descendants.
  `/Private` alone does not deny `/Private/Documents`; terminal `/**`
  includes the named folder and its descendants. `/` matches only `/`.
- [BR-040 v1](../business-rules/BR-040.md), `src/policy/index.ts`
  (folder-share refusal): the raw prefix before the first `*` or `?` and the
  folder path are compared with `startsWith` in both directions, without
  component boundaries. `/`, `/*`, `/Private` and `/Private/Documents2/**`
  can therefore refuse folder sharing beneath `/Private/Documents`.
  Received-folder sharing is refused earlier by `src/policy/received.ts`
  (`gate`), so BR-040 does not apply to synthetic `/Shared`. Any non-empty
  deny list also makes otherwise eligible folder rename/move/trash/restore
  walk descendants, with `TRAVERSAL_LIMIT` on large trees; the existing
  folder-restore refusal remains.
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
deny list and resolved configured roots, plus the possible `/Shared` namespace
when `sharedWithMe=true`. Emit one warning per pattern proved incompatible
with every applicable root and without a BR-040 raw-prefix relation to any
known configured root, in both stdio and HTTP modes. Preserve local
validation, startup eligibility, root authorization by ID, and runtime policy.

This is a full-path, non-security-sensitive diagnostic change: it grants no
access, changes no filtering, and logs no path content. Privacy and unchanged
authorization remain review criteria. This authoring task creates only this
draft; implementation follows review and freeze. Separate index upkeep is
tracked in #124.

Implementation also updates `docs/deployment.md`: add the new operator event
beside the existing troubleshooting events and link it from the `/Private`
guidance. Explain the index, unchanged startup/filtering, conservative limits
(wildcards, unknown paths, startup snapshots and no proof of existing items),
and `/Shared` compatibility when `sharedWithMe=true`. Explain BR-040's
raw-prefix exception, including character-prefix overlaps. State that any
non-empty deny list still refuses folder restores, as documented in `README.md`,
and makes otherwise eligible folder rename/move/trash/restore walk descendants,
with `TRAVERSAL_LIMIT` on large trees. A flagged pattern is therefore not
entirely without effect; the warning is not advice to remove it automatically.

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

- **BR-021 v3** — v2 holds, except that the new
  `preflightConfigurationWithDiagnosticPaths` export also returns diagnostic
  path evidence after successful preflight, when available, bound to each resolved
  `(driveId, folderId)`. An unavailable diagnostic path does not invalidate
  an otherwise successful root resolution. Existing root validation and
  failure mappings are unchanged. This versions the existing resolved-root
  output contract, rather than introducing another authorization rule. The
  evidence is separate from the unchanged `ResolvedConfiguration` object.
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
  satisfies the conservative compatibility criterion below, including the
  synthetic `/Shared` root when `sharedWithMe=true`. This is a new
  diagnostic classification purpose, separate from BR-034's enforcement.
  BR-040's raw-prefix relation to any known configured root also suppresses
  the warning, as specified below.
  Verified by: AC-01–AC-07, AC-10, AC-11.
- **BR-435 v1** — Each startup offers exactly one stderr JSON warning of the
  specified shape for each BR-434 v1 classification, after complete successful
  preflight and before starting either transport. This new operator event
  does not alter filtering or the startup result. Verified by: AC-01,
  AC-07–AC-10, AC-12.

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

Keep exported `preflightConfiguration(local, resolver)` and its
`Promise<ResolvedConfiguration>` return type unchanged, including BR-029's
branding contract and all existing callers. Add a separate exported function
`preflightConfigurationWithDiagnosticPaths(local, resolver)` in `src/config.ts`,
which `main` calls instead. It returns a preflight result with `configuration`
(the existing branded `ResolvedConfiguration`) and `diagnosticRootPaths` (identity-bound entries
containing `driveId`, `folderId` and a known path or an explicit unknown).
Keep the `ResolvedConfiguration` type, branding and `resolvedRoots` entries
unchanged: each root still contains only `driveId` and `folderId`. Both exports
share one resolution implementation; `main` calls only the new export, without
a second preflight or additional requests. `main` consumes the separate path
evidence for this diagnostic and passes only
`configuration` to policy, navigation, pagination and the HTTP handler.
These paths are startup snapshots used only for this diagnostic. They never
authorize runtime access or rebind configured IDs after a rename.

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
3. Split each resolved root path into components; `/` has none. When
   `sharedWithMe=true`, include `/Shared` as an additional synthetic root for
   this check only, without enumerating shares or configuring another drive.
   A pattern is compatible with a root when its literal sequence is a
   component-prefix of the root sequence **or** the root sequence is a component-prefix of
   its literal sequence. Comparisons are exact, case-sensitive and without
   Unicode normalization, just as BR-034. Component boundaries are mandatory.
   In addition, if the pattern has no whole-component `**`, its total component
   count `n` must be at least the root component count. `/` has zero components;
   each pattern component containing `*` or `?` still matches exactly one path
   component, so such a pattern can match only paths of exactly `n` components.
   Apply both conditions to each root.
4. Independently apply BR-040's exact raw-prefix relation to every known
   configured root path `r`: let `p` be the pattern substring before its first
   `*` or `?`, or the entire pattern if neither occurs. If
   `p.startsWith(r) || r.startsWith(p)`, suppress the warning. This includes
   empty prefixes and uses exact case-sensitive characters without component
   boundaries or Unicode normalization. Apply this exception regardless of
   startup mode, because the deny retains its folder-sharing effect in share
   mode. Do not apply it to synthetic `/Shared`: received-folder shares are
   refused by `received.gate` before BR-040, independently of the deny list.
5. Warn only if no configured or synthetic root is component-compatible and
   no configured root satisfies the BR-040 exception. A pattern
   potentially useful on one drive or in the enabled received namespace
   suppresses the warning globally; there is no per-drive warning.

Consequences for root `/Private/Documents` with `sharedWithMe=false`, except
where explicitly stated:

| Pattern | Warn | Reason |
| --- | --- | --- |
| `/Documents/Confidential/**` | Yes | First literal components differ. |
| `/Private2/**` | Yes | Component boundary prevents a character-prefix match. |
| `/private/**` | Yes | Case differs. |
| `/Private/Documents/Confidential/**` | No | Root is a prefix of the literal sequence. |
| `/Private/Documents` | No | Equal sequences. |
| `/Private` | No | BR-040 raw prefix is a prefix of the root, despite insufficient component count. |
| `/` | No | BR-040 raw prefix `/` is a prefix of the root. |
| `/*` | No | BR-040 raw prefix `/` is a prefix of the root. |
| `/Private/Documents2/**` | No | BR-040 raw prefix starts with the root, despite the component mismatch. |
| `/Private/*` | No | Two components can match the root itself. |
| `/Private/**` | No | Literal sequence is above the root. |
| `/Priv*/Documents/**`, `/?/Other/**`, `/**/Other` | No | Leading wildcard makes the literal sequence empty. |
| `/Private/Doc?ments/**` | No | Stop before the wildcard component. |
| `/Other*/Documents/**` | No | Do not attempt to prove a wildcard component disjoint. |
| `/Other/*/Documents/**` | Yes | Literal `Other` already diverges before the wildcard. |
| `**/Confidential/**` | No | Leading globstar exemption. |
| `/Shared/Project/**` | Yes | Received namespace disabled; configured root diverges. |
| `/Shared/Project/**` with `sharedWithMe=true` | No | Synthetic `/Shared` root is a prefix of the literal sequence. |
| `/Other/**` with `sharedWithMe=true` | Yes | Neither configured root nor `/Shared` is compatible. |
| `/Shared2/**` with `sharedWithMe=true` | Yes | Component mismatch; BR-040 does not apply to synthetic `/Shared`. |

A pattern without `**` that is shorter than every applicable root receives
a warning only if the BR-040 exception does not apply. Ancestor-only literals
`/Private` and `/` are deliberately silent. The previously warned examples
`/Documents/Confidential/**`, `/Private2/**`, `/private/**`,
`/Other/*/Documents/**`, `/Shared/Project/**` with received shares disabled,
and `/Other/**` with received shares enabled still warn; only `/Private` and
`/` move from warned to silent in the previous table. Wildcard component
contents are still not solved for intersection: some incompatible patterns
remain unwarned.
The warning claims `outside_configured_roots`, not an exhaustive proof that
unwarned patterns match descendants. A configured root `/` suppresses every
such warning. The event reason also accounts for the enabled received namespace.

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

- **AC-01** (BR-023 v4 unchanged, BR-434 v1, BR-435 v1) — Given root
  `7:/Private/Documents` and deny `/Documents/Confidential/**`, When startup
  completes preflight, Then the deny remains unchanged, exactly index `0`
  warns, and normal startup succeeds. Verified by:
  `tests/deny-root-warning.test.ts`, `TestBR434_mismatched_literal_prefix`,
  and `tests/cli.test.ts`, `TestBR435_stdio_warns_without_refusal`.
- **AC-02** (BR-434 v1) — Given each pattern/root row in the compatibility
  table, When classification runs, Then its result equals the Warn column,
  including no warning for `/Private`, `/`, `/*` and
  `/Private/Documents2/**` under BR-040's raw-prefix exception, and no warning
  for `/Private/*` because it matches the root itself. Assert the exception
  in read, write and share modes. Cover component counts below, equal to
  and above the root depth, with `*`/`?` and with or without `**`. Verified by:
  `tests/deny-root-warning.test.ts`, `TestBR434_compatibility_table` and
  `TestBR434_raw_share_prefix_suppresses_warning`.
- **AC-03** (BR-434 v1) — Given wildcard components before or after a
  diverging literal component, When classification runs, Then its component
  criterion stops before the first wildcard component and never uses a partial
  component; the separate BR-040 raw-prefix exception still applies, and
  leading `**/` is exempt. Verified by: `tests/deny-root-warning.test.ts`,
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
  return identity-bound paths separately from `configuration` through
  `preflightConfigurationWithDiagnosticPaths`, produce the
  same diagnostic result, preserve ID authorization and existing request
  counts, and never diagnose the raw string `7:42` as a path. The branded
  `ResolvedConfiguration` and its `resolvedRoots` shape remain unchanged;
  policy, navigation, pagination and HTTP receive only that configuration,
  without diagnostic paths. Existing `preflightConfiguration` callers still
  receive `ResolvedConfiguration` directly and pass BR-029 branding checks,
  without mechanical caller updates.
  Verified by: `tests/config-preflight.test.ts`,
  `TestBR021v3_retains_identity_bound_diagnostic_paths`,
  `TestBR029_existing_preflight_return_contract_unchanged`, and
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
- **AC-09** (BR-023 v4 unchanged, BR-027 v2) — Given invalid patterns, boundary-size
  inputs, an empty deny list, locally loaded configuration, `--help` or
  `--version`, When their existing entry paths run, Then validation, limits,
  output and exit behavior remain unchanged and no root warning appears.
  Given a valid but incompatible pattern selected through CLI, environment or
  YAML, When normal startup runs, Then the same warning/index contract applies
  to the winning list only. Verified by: `tests/config.test.ts`,
  `TestBR023_deny_validation_and_source_selection_unchanged` (BR-023 v4), and
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
- **AC-11** (BR-434 v1) — Given root `7:/Private/Documents` and deny
  `/Shared/Project/**`, When startup runs with `sharedWithMe=true`, Then no
  warning is emitted; with `sharedWithMe=false`, exactly index `0` warns.
  Given `/Other/**` instead, Then index `0` warns in both cases. Given
  `/Shared2/**` with `sharedWithMe=true`, Then it still warns: BR-040's raw
  exception does not extend to synthetic `/Shared`. Include
  `/Shared/Project/report` as a received path in AC-10's no-false-warning
  enumeration, independently of configured drives. Verified by:
  `tests/deny-root-warning.test.ts`,
  `TestBR434_shared_with_me_namespace_suppresses_warning`,
  `TestBR434_received_namespace_has_no_raw_share_prefix_exception`, and
  `tests/cli.test.ts`, `TestBR434_received_namespace_startup`.
- **AC-12** (BR-435 v1) — Given the operator guidance in
  `docs/deployment.md`, When the feature is documented, Then its operator-event
  guidance describes the exact event shape, zero-based selected-list index,
  both transports and successful-preflight timing, and its `/Private` guidance
  explains the warning for `/Documents/Confidential/**` with a concrete
  corrected full-path example. It explains BR-040's raw-prefix exception
  (including silent `/`, `/*`, `/Private` and `/Private/Documents2/**`) and
  does not advise automatic removal of warned patterns. It states
  the conservative limits (unknown root paths suppress warnings, wildcard
  false negatives, startup snapshots, no existence proof), the enabled
  `/Shared` compatibility case, and the unchanged refusal of folder restores
  for any non-empty deny list, even when every pattern is flagged. It also
  states that any non-empty deny list makes otherwise eligible folder rename,
  move, trash and restore walk descendants and may cause `TRAVERSAL_LIMIT`
  on large trees. Verified by:
  `tests/deployment-examples.test.ts`,
  `TestBR435_operator_warning_guidance`, and a documentation content/link check
  against this spec and README's existing restore guidance.

## Decisions

1. **Conservative literal-component prefixes plus component counts.** Choose
   the criterion above, requiring `n ≥ root component count` for patterns
   without `**`, plus BR-040's exact raw-prefix exception for configured roots.
   `/Private`, `/`, `/*` and `/Private/Documents2/**` are deliberately silent
   for root `/Private/Documents` because they retain folder-share effects;
   `/Private/*` is also silent because it matches the root.
   This follows the existing exact-path matcher and the issue's need without
   requiring a full glob intersection solver.
   Reject raw character-prefix comparison as the sole matching criterion;
   retain it only for the unchanged BR-040 effect. Reject exact
   literal-only comparison ignoring wildcard positions (false warnings), and
   a full glob-language intersection solver (unnecessary complexity).
2. **Global usefulness across drives and received shares.** One compatible
   root anywhere suppresses the warning, matching global deny semantics. When
   `sharedWithMe=true`, treat `/Shared` as a synthetic compatible-root candidate
   under the component criterion, without the BR-040 raw-prefix exception:
   received-folder shares are already refused by `received.gate`. This
   prevents false warnings on effective received-share denies while still
   diagnosing patterns such as `/Other/**`.
   Reject suppressing all warnings when received shares are enabled (needlessly
   loses useful diagnostics) and per-drive warnings (flag intentional patterns
   serving another configured drive or the received namespace).
3. **Use completed resolution evidence, with unknown as compatible.** Extend
   BR-021 and BR-207 rather than inventing paths for IDs. Reuse existing
   metadata and successful path walks. Reject checking before resolution
   (wrong for IDs), extra path-discovery requests (additional latency/failure
   surface), and rejecting otherwise valid ID roots for absent diagnostic
   evidence (contradicts warn-without-refusal). Return paths separately in the
   result of `preflightConfigurationWithDiagnosticPaths`; keep the existing
   `preflightConfiguration` return type and callers unchanged, using a shared
   resolution implementation. Reject a second resolution pass and extending
   `ResolvedConfiguration`, because paths are diagnostic evidence with no role
   in its runtime consumers. A sparse ID
   response can therefore suppress the diagnostic; this is an explicit
   conservative limit.
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
7. **Records.** Version BR-021 v2→v3, BR-207 v2→v3 and
   BR-027 v1→v2 in place for their same-purpose extensions; allocate BR-434
   and BR-435 v1 for the classifier and event. Keep BR-023 v4 unchanged:
   its accepted/rejected inputs do not change; BR-435 owns the warning.
   BR-029, BR-034, BR-040, BR-048, BR-050, BR-071, BR-167 and
   BR-217 remain unchanged for the reasons above. No ADR is needed for this
   reversible diagnostic. Implementation prepares pending BR/capability and
   changelog records; acceptance evidence and exposed token counters belong
   in the ticket/PR, not per-run repository files. Final active/done markers
   follow acceptance and are synchronized in the next scoped PR.

## Open questions

## Stress-test

- **110-spec-review-1-opus #1 — retained.** Denies also apply to received
  paths under `/Shared/`; include the synthetic `/Shared` root only when
  `sharedWithMe=true`. Updated Context, BR-434, table, AC-10/AC-11 and
  Decision 2 prevent false warnings without suppressing unrelated warnings.
- **110-spec-review-1-opus #2 — retained.** Apply the proposed component-count
  condition for patterns without `**`: fewer components cannot reach a root
  or its descendants. Updated criterion, table, AC-02 and Decision 1 cover
  `/Private`, `/` and `/Private/*`; no owner-decision narrowing is taken.
- **110-spec-review-1-opus #3 — retained.** Drop proposed BR-023 v5 because
  validation semantics remain v4. AC-09 retains a BR-023 regression test;
  BR-435 alone owns the new warning. Allocation and Decision 7 reflect this.
- **110-spec-review-1-opus #4 — retained.** Return identity-bound diagnostic
  paths beside `configuration` in the preflight result and keep
  `ResolvedConfiguration` unchanged. AC-05 asserts the separation because
  runtime authorization, navigation, pagination and HTTP do not need paths.
- **110-spec-review-1-opus #5 — retained.** Add deployment operator guidance
  to implementation scope and AC-12, including the event, conservative limits,
  enabled received namespace and existing non-empty-deny folder-restore
  refusal. A warning describes path incompatibility, not absence of all effects.
- **110-spec-review-1-opus #6 — retained.** Move the #110 allocation paragraph
  after the ledger table beside the existing allocation notes, preserving the
  index's established structure and removing the withdrawn BR-023 version.
- **110-spec-review-2-opus #1 — retained, option (a).** Suppress BR-434
  warnings whenever BR-040's exact raw-prefix relation holds for a configured
  root, preserving folder-share effects. `/Private` and `/` move consciously
  to silent; the other previously warned table examples still warn. Add `/*`
  and `/Private/Documents2/**`, AC-02 tests, and explicit traversal/large-tree
  guidance in AC-12. Verified in `received.gate` that received-folder sharing
  is refused before BR-040, so synthetic `/Shared` uses only the component
  criterion; AC-11 tests that boundary. Context, Scope and Decisions reflect
  these unchanged policy effects.
- **110-spec-review-2-opus #2 — retained.** Keep `preflightConfiguration`
  and its `Promise<ResolvedConfiguration>` return type unchanged. Name the
  separate exported `preflightConfigurationWithDiagnosticPaths` that `main`
  calls, sharing one resolution implementation, so existing callers and
  BR-029 branding retain their contract without extra upstream requests.
- **110-spec-review-2-opus #3 — deferred to #124.** The pre-existing spec-index
  ledger gap is outside #110's scope. Leave `docs/spec-index.md` unchanged;
  the separate issue tracks its repair without widening this draft.

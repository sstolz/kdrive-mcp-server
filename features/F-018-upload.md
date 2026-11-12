---
id: F-018
title: Bounded file upload with explicit overwrite
ticket: "#19, #91, #100"
status: done
version: 3
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-10.
Base: main `8b85fc1` (same tree as `6ef7a08`, where this branch started).
IDs: F-018 and BR-279–BR-289 are the next unused IDs per `ls features
business-rules` on that base; re-check before freeze and before the PR.

Version 2 author: Claude Opus 5.5 (effort unknown), orchestrator, 2026-11-10,
base main `11e1ef0`. It allocates no new F or BR ID.

Version 3 author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-11,
base main `4e9678e`. It allocates no new F or BR ID (re-checked with `ls
features business-rules` on that base: next free IDs F-019 and BR-290, not
needed).

## Version 3 (#100)

Version 3 changes only what this section states. The version 2 section and
the version 1 text below stay in force for everything else. Version 2,
accepted on main `b6b7fbb`, is kept in [history](history/F-018-v2.md).

### Context (v3)

The milestone 0.4 global review (verdict `approve`, two minors) raised
ticket #100:

1. The well-formed UTF-16 check of `name` (no unpaired surrogate, BR-279 v2)
   applies only to `kdrive_upload`. `kdrive_create_folder` and
   `kdrive_rename` accept a name with a lone surrogate: it passes the F-003
   `name()` component check and the NFC comparison of BR-260 v2 (a lone
   surrogate is its own NFC form). The mutator then sends it as a `\udXXX`
   escape in the JSON body (`json()` in `src/kdrive/mutators.ts`). How kDrive
   stores such a name is unmeasured. A rename is judged on `cancel_id` only
   (BR-273), so a name that kDrive rewrites would be reported `succeeded` at
   a path the deny check never saw. This is the same class of exposure as
   D-18-12.
2. `src/kdrive/transport.ts` (the `USER_AGENT` constant) and
   `src/navigation.ts` (the `McpServer` server info) hard-code the version
   `0.1.0`, while `src/version.ts` exports `PACKAGE_VERSION`. F-014 fixes
   the User-Agent as `kdrive-mcp-server/<package version>`.
   `tests/kdrive/adapter-transport.test.ts` pins the literal. Today the
   package version is `0.1.0`, so no observable behaviour differs yet; the
   first version bump would make the header and the server info wrong.

Users affected:

- MCP clients that send a `name` holding an unpaired surrogate (U+D800 to
  U+DFFF not part of a valid pair) to `kdrive_create_folder` or
  `kdrive_rename` now get `INVALID_ARGUMENTS`. Such a string is not valid
  Unicode text; over JSON it can only arrive as a `\uDXXX` escape. Upload
  clients see no change.
- No user sees a change from item 2 while the package version stays `0.1.0`.

### Scope (v3)

1. `kdrive_create_folder` and `kdrive_rename` refuse a `name` that is not a
   well-formed UTF-16 string (BR-260 v3). The three name-taking tools share
   one name validator; `kdrive_upload` keeps its BR-279 behaviour unchanged.
2. The adapter User-Agent and the MCP server info version are taken from
   `PACKAGE_VERSION` (`src/version.ts`); the tests assert against it. See
   D-18-15.
3. Records: BR-260 v3 with a History line, the `business-rules/README.md`
   row, two CHANGELOG lines under Fixed (the surrogate refusal and the
   version literals).

#### Out of scope (v3)

- Replacing lone surrogates on the caller's behalf (D-18-14).
- Any change to the tool descriptions (BR-263 and BR-283 stay v2, D-18-14).
- Content checks: `text` with a lone surrogate is already refused (BR-280).
- Stored names read from kDrive (evidence, listings): the policy-core
  `name()` keeps validating them as today.
- `--version` and `package.json`: they already use the package version
  (BR-016).
- Measuring how kDrive stores a lone-surrogate name.

### Business rules (v3)

- **BR-260 v3** (was v2: strict arguments of the F-017 write tools; `name` a
  valid F-003 single path component with no edge whitespace; the `name` of
  `kdrive_create_folder` and `kdrive_rename` in Unicode NFC). v2 is
  unchanged, plus: the `name` of `kdrive_create_folder` and `kdrive_rename`
  is a well-formed UTF-16 string (it contains no code unit U+D800–U+DFFF
  outside a valid high-then-low surrogate pair); otherwise the call returns
  `INVALID_ARGUMENTS` with zero gate runs, zero records and zero upstream
  requests. Verified by: AC-18.

BR-279 v2 is not versioned again. Its own clause already requires a well-formed
upload `name`, and the BR-260 v2 and v3 additions name only
`kdrive_create_folder` and `kdrive_rename`, so the BR-260 name rule that
BR-279 cites is unchanged for upload. Sharing the validator in code does not
change upload behaviour; AC-18 checks that as a regression.

### Acceptance criteria (v3)

Examples are written as escaped code units, because a lone surrogate cannot
be rendered.

- **AC-18** (BR-260 v3, BR-279 v2 regression) — Given `kdrive_create_folder`
  and `kdrive_rename` in mode `write`:
  - When `name` is one of `a` U+D800 (lone high at the end), U+DC00 (lone
    low alone), U+D800 `a` (lone high at the start, followed by a
    non-surrogate), `a` U+D800 `b` (lone high inside), `x` U+DFFF `y` (lone low inside), U+DC00 U+D800 (a reversed
    pair), `a` U+D83D U+D83D U+DE00 (a high surrogate followed by a valid
    pair), Then the call returns `INVALID_ARGUMENTS` with zero gate runs,
    zero `inspect` calls, zero records and zero upstream requests.
  - When `name` is U+D83D U+DE00 (one valid pair, the emoji U+1F600) or
    `a` U+D83D U+DE00 `b`, Then the call makes one gate run whose operation
    carries exactly that name.
  - Given `kdrive_upload` with the five refused names above and valid
    content, Then each returns `INVALID_ARGUMENTS` with zero `mutate` calls
    (unchanged BR-279 behaviour).

  Verified by: `tests/mutation-tools.test.ts`
  (`TestBR260_v3_%s_lone_surrogate_name_is_INVALID_ARGUMENTS`,
  `TestBR260_v3_%s_surrogate_pair_name_makes_one_gate_run_with_that_name`)
  and `tests/upload-tool.test.ts`
  (`TestBR279_lone_surrogate_regression_%s_is_INVALID_ARGUMENTS`).
- **AC-19** (F-014 BR-190 contract detail "Fixed request headers") — Given
  the adapter transport, When it sends a JSON route request, Then the
  `user-agent` header equals `kdrive-mcp-server/${PACKAGE_VERSION}`; and
  Given `src/version.js` substituted with the version `9.9.9-test`, Then the
  header equals `kdrive-mcp-server/9.9.9-test`. Verified by:
  `tests/kdrive/adapter-transport.test.ts` (the existing BR-190 assertion,
  now against `PACKAGE_VERSION`) and `tests/package-version-wiring.test.ts`
  (`TestBR190_user_agent_follows_PACKAGE_VERSION`).
- **AC-20** (no BR, D-18-15) — Given the MCP server built by
  `src/navigation.ts`, When a client completes `initialize`, Then the server
  info is `{name: "kdrive-mcp-server", version: PACKAGE_VERSION}`; and Given
  `src/version.js` substituted with `9.9.9-test`, Then the version is
  `9.9.9-test`. Verified by: `tests/package-version-wiring.test.ts`
  (`server_info_version_follows_PACKAGE_VERSION`).

### Decisions (v3)

- **D-18-14 — Create and rename refuse an unpaired surrogate in `name`.**
  The check joins the one shared name validator of the three tools
  (`src/mutation-tools.ts`), at the same schema layer as D-18-12 and for the
  same reason: `invokeMutation` is the only route from a tool call to the
  gate, so a refusal there costs no gate run, record or request. The check
  is linear in the name length, so its position relative to the 4,096-byte
  bound and the NFC comparison does not change any outcome; every failure
  is `INVALID_ARGUMENTS`.
  Rejected options:
  - Replacing lone surrogates with U+FFFD (`String.prototype.toWellFormed`):
    the stored name would differ from the requested one, the objection
    D-18-12 already records for normalization.
  - Checking in the mutator `json()`: too late, the gate run and its record
    already exist, which breaks the zero-record refusal of BR-260.
  - Checking in the policy-core `name()`: it also validates stored names
    read from kDrive, so it would turn a lone surrogate in an existing name
    into a read failure (D-18-12 layer note).
  - Reading the name back after a rename: an extra request, against F-017
    D-17-10 (no read-back); it would only detect, not prevent, the write.
  - A new description sentence: a lone surrogate is not text a client
    produces on purpose, and `INVALID_ARGUMENTS` is enough; BR-263 v2 and
    BR-283 v2 stay unchanged.
- **D-18-15 — The version literals are a conformance fix, with no new
  contract version.** F-014 v7 already states the User-Agent as
  `kdrive-mcp-server/<package version>` ("Contract details", "Route table
  (BR-190)", fixed request headers); the code drifted from that text, so
  using `PACKAGE_VERSION` conforms to F-014 v7 under BR-190 v3 and F-014
  stays at v7. No spec states the MCP server info version (checked F-005,
  F-012 and F-014: they name the `McpServer` but no version), so using
  `PACKAGE_VERSION` there is consistency work with no BR; AC-20 still pins
  it. Rejected: versioning F-014 or BR-190, because their text does not
  change; adding a new BR for the server info version, because no user need
  or contract asks for one beyond consistency with `--version` (BR-016).

### Residual risks (v3)

- R-18-5 (restated in v2) is unchanged for every other kDrive name rewrite.
  This version removes only the lone-surrogate case for create and rename,
  which was never observed.

### Open questions (v3)

None.

### Stress-test (v3)

Spec review round 1 (`100-spec-review-1-reviewer`, verdict `changes`, 3 minor):

1. minor — BR-279 cited as v1 while it is v2. Retained: cited as v2 in the
   scope, AC-18 and the BR-279 paragraph.
2. minor — AC-18 lacked a lone high surrogate at the start or inside followed
   by a non-surrogate. Retained: U+D800 `a` and `a` U+D800 `b` added to the
   refused names.
3. minor — one CHANGELOG line planned for two fixes. Retained: two Fixed
   lines.

## Version 2 (#91)

Version 2 changes only what this section states. The version 1 text below
stays in force for everything else. Version 1, accepted on main `0f1852c`, is
kept in [history](history/F-018-v1.md).

### Context (v2)

The owner-run acceptance of v1
(runs/19-acceptance-2.md (archived evidence `runs/19-acceptance-2.md`)) triggered D-18-11:

- step 9: kDrive stored a decomposed (NFD) name under a different name,
  presumably its NFC form;
- step 8: kDrive stored a file named like an existing folder under another
  name.

Both uploads were reported `uncertain` and not replayed, but the writes
happened at paths the deny list never checked. On 2026-11-10 the owner
decided to refuse names that are not in Unicode NFC, and to accept the
folder-name rename as a documented residual risk (no pre-check, no extra
listing).

Users affected:

- MCP clients that send decomposed names now get `INVALID_ARGUMENTS` and
  must send the composed form.
- A file whose stored name is not in NFC (for example synced from macOS) can
  no longer be overwritten through `overwrite:true`, because `name` must equal
  the stored name (BR-035 v2) and must be NFC. Renaming the file to its NFC
  name first still works, because `kdrive_rename` targets the file by ID.
- Operators whose deny patterns contain non-ASCII characters. Deny matching
  compares the exact stored code points (`src/policy/glob.ts`). A pattern
  must therefore exist in the NFC form to cover names these tools create.
  It must also keep, or add, the stored form for any existing item whose
  name is not NFC. Rewriting a working NFD pattern to NFC alone would
  silently drop the deny for such items, reads included.

### Scope (v2)

1. `kdrive_create_folder` and `kdrive_rename` refuse a `name` that differs
   from its NFC form (BR-260 v2). `kdrive_upload` refuses it as part of its
   schema (BR-279 v2). See D-18-12.
2. The descriptions of the three tools state the NFC rule (BR-263 v2,
   BR-283 v2).
3. Acceptance step 9 asserts the refusal of an NFD name and the success of an
   NFC non-ASCII name, and observes a compatibility ligature (9 (c)); step 8
   stays observed and also records the off-set run-prefix count (step 8 (v2))
   (BR-287 v2, D-18-13). This changes
   `scripts/kdrive-upload-acceptance.ts` and
   `tests/upload-acceptance-script.test.ts`.
4. The README and `SECURITY.md` state the NFC rule and the NFC requirement for
   non-ASCII deny patterns. R-18-3 becomes an accepted risk and R-18-5 is
   restated (BR-288 v2).
5. Records:
   - BR-260 v2, BR-263 v2, BR-279 v2, BR-283 v2, BR-287 v2 and BR-288 v2,
     each with a History line;
   - a CHANGELOG line and a capability-map note;
   - a BACKLOG line for a configuration-time warning on non-NFC deny
     patterns (never a rejection or a normalization).

#### Out of scope (v2)

- A pre-check or listing for a same-name folder (owner decision, D-18-13).
- Normalizing names on the caller's behalf (D-18-12).
- Normalizing or checking deny patterns at configuration time (BACKLOG;
  documented instead, BR-288 v2).
- Any other kDrive name rewriting (case folding, reserved names): not
  tested, so it stays under R-18-5. Compatibility forms are only observed by
  step 9 (c).
- Names in `kdrive_move` (it sends no name), `kdrive_trash`,
  `kdrive_restore` and the read tools.

### Business rules (v2)

All examples below are written as escaped code points, because rendered NFD
and NFC text look identical.

- **BR-260 v2** (was v1: strict arguments of the F-017 write tools; `name` is
  a valid F-003 single path component with no edge whitespace). v1 is
  unchanged, plus: the `name` of `kdrive_create_folder` and `kdrive_rename`
  equals its Unicode NFC normalization (`name === name.normalize("NFC")`);
  otherwise the call returns `INVALID_ARGUMENTS` with zero gate runs, zero
  records and zero upstream requests. Verified by: AC-14.
- **BR-263 v2** (was v1: fixed description sentences of the F-017 tools and
  the uncertain-result sentence). v1 is unchanged, plus the descriptions of
  `kdrive_create_folder` and `kdrive_rename` contain the NFC sentence below.
  Verified by: AC-15.
- **BR-279 v2** (was v1). v1 is unchanged, plus: `name` equals its Unicode
  NFC normalization. This check belongs to the BR-279 schema check, so it
  runs first in the BR-280 order, before the content and byte-bound checks.
  Verified by: AC-14.
- **BR-283 v2** (was v1). v1 is unchanged, plus the `kdrive_upload`
  description contains the NFC sentence below. Verified by: AC-15.
- **BR-287 v2** (was v1). v1 is unchanged, except that steps 8 and 9 of the
  Acceptance sequence are replaced by step 8 (v2) and step 9 (v2) below. Verified by: AC-16.
- **BR-288 v2** (was v1). v1 is unchanged, plus the README and `SECURITY.md`
  state:
  - that the names of `kdrive_upload`, `kdrive_create_folder` and
    `kdrive_rename` must be in Unicode NFC;
  - that a deny pattern matches the exact stored code points: write the
    NFC form to cover names these tools create, and also keep or add the
    stored form for any existing item whose name is not NFC;
  - R-18-3 as an accepted risk;
  - R-18-5 as restated below.

  Verified by: AC-17.

NFC sentence (fixed text): `name must be in Unicode NFC (composed form);
other forms are refused.`

### Acceptance sequence (v2)

Step 9 (v2) replaces step 9:

9. (a) Upload text `n-` + `e` + U+0301 (NFD), 8 bytes → `INVALID_ARGUMENTS`,
   zero requests. (b) Upload text `c-` + U+00E9 (NFC), 8 bytes →
   `succeeded`. One paginated GET listing of R, filtered in memory by the run
   prefix, shows a child whose name equals the sent code points (asserted).
   (c) Upload text `k-` + U+FB01 (NFC, but not NFKC), 8 bytes. Record the
   result, and whether the stored name equals the sent code points
   (`yes`/`no`/`unknown`), using the same listing. This step is observed,
   not asserted. A `no` triggers D-18-11 again. All three names are added to
   the summary's secret names for the leak check.

Step 8 (v2) records one more observed value: the count of run-prefix
children of R that are not among the items the run kept (`unknown` if the
listing is incomplete). This shows whether the renamed file stayed in R. The
count reuses the step-8 listing. The extra uploads stay within the BR-287 v2
caps (unchanged from v1).

### Acceptance criteria (v2)

- **AC-14** (BR-260 v2, BR-279 v2) — Given `kdrive_upload`,
  `kdrive_create_folder` and `kdrive_rename`:
  - Refused names, each with `INVALID_ARGUMENTS`, zero gate runs, zero
    `inspect` calls and zero requests:
    - `e` U+0301 (NFD);
    - U+00E9 `-e` U+0301 (mixed);
    - Hangul jamo U+1112 U+1161 U+11AB;
    - U+212B ANGSTROM SIGN (its NFC form is U+00C5);
    - for upload only, an NFD name together with oversized content (the
      schema refusal comes first).
  - Accepted names, each making one gate run with exactly that name:
    - U+00E9;
    - an ASCII name;
    - U+00C5;
    - `q` U+0307 (a combining mark with no precomposed form, already NFC);
    - Hangul syllable U+D55C;
    - U+FB01 (a compatibility ligature; NFC keeps it, and it marks the
      R-18-5 boundary).

  Verified by: `upload-tool.test.ts`, `mutation-tools.test.ts`
  (`TestBR260_v2_*`, `TestBR279_v2_*`).
- **AC-15** (BR-263 v2, BR-283 v2) — Given mode `write`, When tools are
  listed, Then the descriptions of `kdrive_upload`, `kdrive_create_folder`
  and `kdrive_rename` contain the NFC sentence. Verified by:
  `upload-tool.test.ts`, `mutation-tools.test.ts` (`TestBR263_v2_*`,
  `TestBR283_v2_*`).
- **AC-16** (BR-287 v2, real API) — First, the synthetic end-to-end test
  passes the v2 sequence: step 9 (a) makes zero requests, step 9 (b) is
  asserted, and the summary contains both observed values, step 9 (c)
  (result and stored-equals-sent `yes`/`no`/`unknown`) and the step 8 (v2)
  off-set count. Then, Given the owner run on actual main, steps 9 (a) and
  9 (b) pass and every other asserted step passes as in v1; step 9 (c) and
  step 8 (v2) are recorded, not asserted, and a 9 (c) `no` triggers D-18-11. Verified by:
  `upload-acceptance-script.test.ts` (`TestBR287_*`) and the owner report
  `runs/91-acceptance-1.md`.
- **AC-17** (BR-288 v2) — Given the README and `SECURITY.md`, Then they state
  the NFC rule for the three tools; that deny patterns match exact stored
  code points, so the NFC form is needed for new names and the stored form
  must be kept for existing non-NFC names; R-18-3 as an accepted risk; and
  R-18-5 as restated. Neither document
  claims that a checked path is always the stored one. Verified by: reviewer
  document check.

### Decisions (v2)

- **D-18-12 — NFC is required for all three write tools that take a name.**
  kDrive rewrote an NFD name in step 9. For an upload or a folder creation,
  the result is `uncertain` (the mutator checks `data.name`), but the write
  still happened at an unchecked path. For a rename, the check (BR-273)
  accepts a cancellable action without reading the name back
  (`src/kdrive/mutators.ts`), so a rewritten rename would be reported
  `succeeded`. One shared validator covers all three tools; the rule is
  versioned in BR-260 (create, rename) and BR-279 (upload). Consequence: an
  existing non-NFC file cannot be overwritten until it is renamed to NFC.
  Layer: the rule lives in the tool schemas because `invokeMutation`
  (`src/navigation.ts`) is the only route from a tool call, over HTTP or
  stdio, to the gate, and the gate admits no `batch` kind. The policy-core
  `name` function also validates stored names in evidence, so it cannot
  carry the rule. Any future tool that carries a name (the policy `move`
  kind already accepts one) must reuse the same validator or add the check
  in `operation()`.
  Rejected options:
  - Normalizing the name silently: the stored name would still differ from
    the requested one, which defeats a client that verifies and then retries.
    An explicit refusal is clearer.
  - Upload only: it leaves the rename exposure.
  - Matching deny patterns against several normal forms: it does not remove
    the BR-285 `uncertain` outcome.
  - Telling only the upload clients: create and rename clients would get
    `INVALID_ARGUMENTS` with no hint, so BR-263 v2 adds the sentence there
    too.
- **D-18-13 — The folder-name rename is accepted (owner decision,
  2026-11-10).** kDrive stores a file named like an existing folder under
  another name, presumably in the same authorized folder (step 8 (v2) records
  this). The result stays `uncertain`
  (BR-285) and is never replayed (BR-289). Rejected: listing the destination
  before the upload, because it adds requests and a check-then-act window
  (owner decision).

### Residual risks (v2)

- **R-18-3** (accepted) — A file named like an existing folder in the same
  folder is stored under another name that kDrive chooses (observed in step
  8; step 8 (v2) records whether it stays in the folder). That name is not checked against the deny patterns. The result is
  `uncertain` and nothing is replayed.
- **R-18-5** (restated) — Run 2 shows that kDrive stored the NFD name under a
  different name; the NFC form is presumed, not proven. NFC enforcement
  removes that case only if step 9 (b) shows that an NFC name is stored
  unchanged on the real API; until that run passes, R-18-5 stands as in v1.
  Other kDrive name rewriting, which has not been tested (step 9 (c) only
  observes a compatibility ligature), would still store
  a file at an unchecked path. That outcome is reported `uncertain` for
  upload and folder creation, and `succeeded` for rename. The rename exposure
  already existed under F-017 v1 and has never been observed for rename.

### Open questions (v2)

None.

### Stress-test (v2)

Spec review round 1 (`runs/91-spec-review-1.md`, Opus, verdict `changes`):

| #   | Severity | Finding                                                         | Decision | Change                                                                |
| --- | -------- | --------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| 1   | major    | Non-ASCII deny patterns written in NFD silently stop matching   | Retained | BR-288 v2 and AC-17 require NFC patterns; BACKLOG line for a config-time check |
| 2   | major    | BR-279 inherits the BR-260 change without a version bump        | Retained | BR-260 v2 limited to create and rename; new BR-279 v2 for upload      |
| 3   | major    | R-18-5 overstated "the observed normalization no longer applies" | Retained | R-18-5 made conditional on step 9 (b); rename exposure dated to F-017 v1 |
| 4   | minor    | AC-14 lacks edge cases                                           | Retained | Escaped code-point cases: combining mark, Hangul, jamo, U+212B, U+FB01 |
| 5   | minor    | Create and rename descriptions lack the NFC hint                 | Retained | BR-263 v2 adds the NFC sentence                                        |
| 6   | minor    | Overwrite of an existing non-NFC file becomes impossible         | Retained | Users affected and D-18-12 state it; rename-first workaround           |
| 7   | minor    | Script and test changes missing from Scope                       | Retained | Scope item 3 names both; step 9 (v2) adds both names to secrets        |

Spec review round 2 (`runs/91-spec-review-2.md`, Opus diff-only, verdict
`approve`): one minor, retained. "BR-287 caps" now reads "BR-287 v2 caps
(unchanged from v1)".

Fable decision pass (`runs/91-spec-fable-1.md`, verdict `changes`; the major
finding sends the spec back to an Opus round):

| #   | Severity | Finding                                                              | Decision | Change                                                                 |
| --- | -------- | -------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| 1   | major    | "Write deny patterns in NFC" fails open for stored non-NFC names     | Retained | Patterns match stored code points: NFC for new names, keep the stored form; BACKLOG warns only |
| 2   | minor    | "Not observed" overstates; NFKC is untested                          | Retained | "Not tested"; observed step 9 (c) with U+FB01                          |
| 3   | minor    | "In the same folder" is inferred                                     | Retained | "Presumably"; step 8 (v2) records off-set run-prefix children          |
| 4   | minor    | The reason the rule lives in the schema layer is not recorded        | Retained | D-18-12 records the single entry point and the rule for future tools  |

Spec review round 3 (`runs/91-spec-review-3.md`, Opus diff-only, verdict
`changes`): finding 1 (major) — AC-16 did not cover the observed step 9 (c)
and step 8 (v2) values — retained, AC-16 now states both as recorded, not
asserted, and checked as present by the synthetic test; finding 2 (minor) —
BR-287 v2 and Scope item 3 named only step 9 — retained, both now name steps
8 (v2) and 9 (v2).

## Context

Ticket #19 (P-19, milestone 0.4) delivers `kdrive_upload` ([SPEC.md §6](../SPEC.md),
"Écrasement"): text or base64 content, a checked result path, and overwrite
only with `overwrite: true`. Its acceptance asks that `overwrite:true` be
explicit, that the `false`/default behaviour be stated truthfully in the
schema, the descriptions and the README and be tested with same-name
concurrency, that no unsafe automatic replay follow an unknown result, and
that shared write stay doubly gated.

What already exists on the base:

- The F-016 gate (admission table: `kdrive_upload` → `upload-new`,
  `replace`; opaque `payload` channel on `mutate` and mutators, never
  recorded or returned; 429-only retry; `uncertain` without replay, BR-251).
- The F-017 mutation port (BR-266–BR-269: one request on a new TLS
  connection, `NotSent` only before handshake completion, `MUTATION_UNKNOWN`
  after) and mutator contract (BR-271: one request per attempt, no read-back,
  D-17-10).
- The F-003 policy core already knows `upload-new` (destination + name,
  result path `destination/name` checked) and `replace` (target only, must be
  a file). F-004 sets every received mutation predicate to `false`
  (BR-204 v1); BR-257 refetches the received list for a received write.
- #16 measured the upload route (runs/16-execution-A-1.md W2, C1;
  runs/16-execution-B-1.md C2–C7, K2, Z1): `POST
  /3/drive/{d}/upload?directory_id&file_name&total_size&conflict=error` is
  synchronous and returns the file object; a same-name upload with
  `conflict=error` was refused 409 `file_already_exists_error` on 9/9
  samples (1 sequential, 4 concurrent, 4 with a held half-sent body: the
  name is (also) checked at completion); `conflict=version` kept the same ID
  and replaced the content; names are case-sensitive; a `total_size`
  mismatch gave 400 `upload_failed_error`; 0 bytes and 1 MiB were accepted;
  the maximum size is unknown; a file named like an existing folder was
  created (stored name unknown, C5).
- Owner decision D-07 option A (runs/16-decisions-1.md): `overwrite:false`
  maps to `conflict=error`, stated as observed behaviour, not a contractual
  guarantee; `overwrite:true` maps to `conflict=version`.
- Inbound bounds: stdio frames are at most 1 MiB (F-005); the HTTP MCP body
  is at most 262,144 bytes (BR-160).

Users affected: operators who enable `write` or `share` (one more tool under
the existing policy and audit), MCP clients and their users (they can create
small files and replace a named file's content, and are told what the
no-overwrite default really guarantees), and the author of #20 (reuses the
port with a payload).

## Scope

1. `kdrive_upload`: strict schema, content decoding and size bound,
   annotations, fixed descriptions, registration in `write` and `share`
   modes only (BR-060 v6, BR-279–BR-283).
2. The `replace` operation carries its folder and name and the policy core
   checks them against the target's live evidence (BR-035 v2). This includes
   migrating every existing `{kind:"replace", target}` test fixture to the
   BR-035 v2 shape (`target`, `destination` = the fixture target's parent,
   `name` = its name; for a fixture whose target does not exist, an
   existing fixture folder as `destination`, keeping the original denial
   cause) with each assertion unchanged: `tests/policy.test.ts`,
   `tests/mutation-gate.test.ts`, `tests/helpers/received.ts`,
   `tests/received-review1.test.ts`, `tests/received-review2.test.ts`,
   `tests/received-boundaries.test.ts` and
   `tests/received-matrix-boundaries.test.ts` (18 occurrences on the base,
   located with `grep -rn 'kind: *"replace"' tests/`). A fixture that cannot
   keep its assertion under v2 is reported in the PR, never silently changed.
3. Two mutators, `upload-new` and `replace`, on one new route (BR-190 v3,
   BR-266 v2, BR-274 v2, BR-284–BR-286).
4. Unit tests per BR, including same-name concurrency against a synthetic
   server (AC-10).
5. Owner-run real-API acceptance `make kdrive-upload-acceptance` in one
   designated folder (BR-287).
6. README and `SECURITY.md` text (BR-288).
7. Pending records: BR-279–BR-289, versioned BR-035, BR-060, BR-190, BR-266,
   BR-274 records with a History line, capability-map entry marked
   provisional, CHANGELOG line under Unreleased, BACKLOG lines of Decisions,
   and the `SECURITY.md` residual-risk lines R-18-1–R-18-5 (BR-288).

### Versioned rules

- **BR-035 v2** (was v1: the policy derives the complete effect set from a
  recognized kind and validated arguments) — v1 unchanged, plus: a `replace`
  operation carries exactly `target`, `destination` and `name`; the core
  inspects the target and the destination `live`, and authorizes it only
  when the target is a file whose immediate parent ID equals the destination
  ID and whose name equals `name` exactly (code-point equality), the
  destination is an authorized live directory, and the path
  `destination/name` (equal to the target's current path) is permitted;
  any difference is denied with zero intent records and zero mutation
  requests; an operation without `destination` or `name` is invalid. BR-035
  v2 supersedes the F-003 v1 effect-matrix row "Replace/upload existing
  file" (fresh existing file membership/current path only): the replace row
  is now the target's fresh membership and current path, the destination's
  fresh live directory membership and current path, and the parent and name
  bindings above, all at level `write`. Verified by: AC-05.
- **BR-060 v6** (was v5: `write` and `share` register the ten read tools and
  five mutation tools) — Mode `read` registers exactly the ten read tools;
  modes `write` and `share` register exactly those ten plus the five F-017
  tools and `kdrive_upload`; every mode registers the single existing
  complete-binary resource template and no prompt or enumerated resource.
  Verified by: AC-01.
- **BR-190 v3** (was v2: `GET` routes, trash metadata and five mutation
  routes) — v2 unchanged, plus `POST` on the upload route of the Route table
  below, with the query members in the stated order. Verified by: AC-07.
- **BR-266 v2** (was v1: a body only for `create` and `rename`) — v1
  unchanged, except that `upload-new` and `replace` requests also send a
  body: exactly the payload bytes, with `Content-Type:
  application/octet-stream` and `Content-Length` equal to their count (0
  included). Verified by: AC-07.
- **BR-274 v2** (was v1: exactly five mutators) — The production composition
  registers exactly the mutators for `create`, `rename`, `move`, `trash`,
  `restore`, `upload-new` and `replace`; a run of any other kind is refused
  at admission (BR-245). Verified by: AC-04.

### Unchanged rules applied by reference

F-004 received `replace` row: its required predicate stays `S.replace`
only. The added destination is the target's own parent, so replace creates
nothing in it and needs no destination predicate; the destination is still
an affected identity, so BR-049 (received-root connection), BR-050 (deny
matching) and BR-052 (fresh evidence) apply to it through their existing
"every affected identity/path" wording, and BR-053 still requires only the
predicates of the effect set. No F-004 rule text changes, so no F-004 BR is
versioned; received replaces stay denied by BR-204 v1.

BR-204 v1 and BR-257 (received-share writes denied), BR-034 (deny matching on
current and result paths), BR-245–BR-259 (gate, classification, 429-only
retry, `uncertain` without replay, audit records), BR-267–BR-269 (port
failure classes and deadline), BR-268 (body bounds), BR-270 (no permanent
deletion), BR-271 (one request per attempt, no read-back), BR-263 (the
`uncertain` sentence).

### Out of scope

- Chunked or session uploads (`/upload/session/*`), files above the BR-280
  bound, resumable uploads.
- `conflict=rename`, upload by path (`directory_path`), creation of missing
  intermediate folders, `last_modified_at`, `If-Match` (K2: 422, cause not
  established), the MIME type (server-derived).
- A pre-check for an existing file or folder of the same name (D-18-4), any
  read-back or reconciliation after a write (D-17-10).
- Received-share uploads (stay denied), sharing (#20), changes to the F-016
  gate, the audit schema (BR-234) or the F-002 configuration inventory.

## Business rules

All new rules are version 1 and `pending acceptance`.

### Tool

- **BR-279** — `kdrive_upload` accepts exactly a strict object with
  `drive_id?`, `parent_id`, `name`, exactly one of `text` (string) and
  `base64` (string), `overwrite?` (boolean, default `false`) and `file_id`,
  where `file_id` is present when and only when `overwrite` is `true`; IDs
  and `drive_id` follow BR-260 (positive safe integers, `drive_id` defaulting
  to the configured default drive) and `name` follows the BR-260 name rule
  and is a well-formed UTF-16 string (no unpaired surrogate, so the
  `file_name` sent by `URLSearchParams` equals the checked name);
  any other argument set returns `INVALID_ARGUMENTS` with zero `mutate`
  calls, zero records and zero upstream requests. Verified by: AC-02.
- **BR-280** — The content bytes are the UTF-8 encoding of `text`, or the
  decoding of `base64`; `text` with an unpaired surrogate, and `base64` that
  is not canonical RFC 4648 §4 (standard alphabet, `=` padding to a length
  multiple of 4, no whitespace or other character, zero pad bits), return
  `INVALID_ARGUMENTS`; content of more than 524,288 bytes returns
  `LIMIT_EXCEEDED`; both refusals make zero `mutate` calls, zero records and
  zero upstream requests; 0 bytes is valid. Checks apply in this order and
  the first failure is returned: (1) the BR-279 schema → `INVALID_ARGUMENTS`;
  (2) the content encoding above → `INVALID_ARGUMENTS`; (3) the byte bound →
  `LIMIT_EXCEEDED`; (4) the `mutate` call (policy, then gate). Input that is
  both invalid and oversized therefore returns `INVALID_ARGUMENTS`.
  Verified by: AC-03.
- **BR-281** — A valid call makes exactly one navigation `mutate` call with
  tool `kdrive_upload`, the operation `{kind:"upload-new",
  destination:{driveId, id:parent_id}, name}` when `overwrite` is `false`,
  or `{kind:"replace", target:{driveId, id:file_id},
  destination:{driveId, id:parent_id}, name}` when it is `true`, the session
  identity, the call signal and the content bytes as payload; it returns one
  text content item holding the JSON of the gate result (BR-255), with
  `isError` false only when `result` is `succeeded`. Verified by: AC-02,
  AC-04.
- **BR-282** — `kdrive_upload` carries `readOnlyHint:false`,
  `destructiveHint:true`, `idempotentHint:false` and `openWorldHint:true`.
  Verified by: AC-01.
- **BR-283** — The `kdrive_upload` description contains the fixed sentences
  of the Tool text below and the BR-263 sentence, and the input schema
  description of `overwrite` contains the Overwrite sentence below.
  Verified by: AC-01.

### Mutators

- **BR-284** — The `upload-new` mutator sends `conflict=error` and the
  `replace` mutator sends `conflict=version`; no other `conflict` value is
  ever sent; `directory_id` is the operation's destination ID, `file_name`
  its `name` and `total_size` the payload byte count; each sends exactly one
  request per attempt and no other request (BR-271). Verified by: AC-07,
  AC-09.
- **BR-285** — The `upload-new` check accepts a `data` file object whose
  `id` is a positive safe integer, `type` is `file`, `name` equals the
  requested name, `size` equals the payload byte count and `parent_id` is
  present and equals the destination ID (absent or different gives
  `accepted:false`, `uncertain`); the mutator then returns `created`
  equal to that `id` and `value` `{drive_id, id, size, action:"created"}`.
  Verified by: AC-08.
- **BR-286** — The `replace` check accepts a `data` file object whose `id`
  equals the target ID, `type` is `file`, `name` equals the requested name,
  `size` equals the payload byte count and `parent_id` is present and equals
  the destination ID; the mutator then returns `value` `{drive_id, id,
  size, action:"replaced"}` and no `created`; a 2xx whose `id` differs from
  the target, or whose `parent_id` is absent or different, gives
  `accepted:false` (`uncertain`). Verified by: AC-08.

### Acceptance and documentation

- **BR-287** — `make kdrive-upload-acceptance` follows the BR-276 v1
  conditions (actual main checkout, dev Compose service, token through
  BR-212, `KDRIVE_WRITE_FOLDER` required and checked before any Docker
  command, mode `write` with that folder as the only root, audit log in a
  container temporary file, sanitized summary with no ID, name, path, token
  or content), runs the two phases of the Acceptance sequence below with at
  most 100 upstream requests within 300,000 ms, and uploads at most
  1,048,576 bytes in total. Verified by: AC-12.
- **BR-288** — The README and `SECURITY.md` state that `kdrive_upload`
  exists only in `write` and `share` modes, its 524,288-byte bound (and that
  over HTTP the 262,144-byte MCP body limit is lower), that `overwrite:false`
  asks kDrive to refuse an existing file of the same name and that this
  refusal is observed server behaviour (9/9 measured samples, checked at
  upload completion), not a guarantee of this server, that names are
  case-sensitive, that `overwrite:true` requires `file_id` and replaces that
  file's content in place under the same ID, that an `uncertain` upload is
  never replayed, that received-share uploads stay refused even with
  `KDRIVE_MCP_SHARED_WRITE=1`, that the bound applies to the decoded bytes
  while the transport limit (1 MiB stdio frame, 262,144-byte HTTP body)
  applies to the JSON-encoded request, so `text` that JSON escaping enlarges
  (quotes, backslashes, control characters) can be refused by the transport
  below 524,288 bytes: over HTTP the request gets HTTP 413, while over stdio
  a frame above 1 MiB terminates the server with `STDIO_INPUT_FAILED` and no
  MCP error (F-005); an upload already in flight completes and its outcome
  is recorded in the audit log before exit (BR-254), but its tool result is
  not delivered;
  base64 is the reliable form for large or non-ASCII content, and
  residual risks R-18-1–R-18-5. Verified
  by: AC-13.
- **BR-289** — An `uncertain` upload result is never followed by an
  automatic attempt from this server: the gate makes no further attempt
  (BR-251), and the tool makes no second `mutate` call. Verified by: AC-09.

## Contract details

### Tool text (BR-283)

Fixed description sentences:

- `Uploads a file of at most 524,288 bytes, given as UTF-8 text or base64,
  into an authorized folder; the resulting path is checked.`
- `With overwrite false (the default), kDrive is asked to refuse an existing
  file of the same name (names are case-sensitive); this refusal is observed
  kDrive behaviour, not a guarantee of this server.`
- `With overwrite true, file_id must be the existing file called name in
  parent_id; its content is replaced in place and it keeps its ID.`
- `Use base64 for large or non-ASCII content: escaped text can exceed the
  transport message limit, which over stdio stops the server.`

Overwrite sentence (schema description of `overwrite`): `false (default):
kDrive is asked to refuse an existing same-name file; observed behaviour,
not guaranteed. true: replaces the content of file_id.`

### Route table (BR-190 v3, BR-266 v2, BR-284)

| Kind         | Method | Template                                                                          | Body          |
| ------------ | ------ | --------------------------------------------------------------------------------- | ------------- |
| `upload-new` | `POST` | `/3/drive/{d}/upload?directory_id={p}&file_name={n}&total_size={s}&conflict=error`   | payload bytes |
| `replace`    | `POST` | `/3/drive/{d}/upload?directory_id={p}&file_name={n}&total_size={s}&conflict=version` | payload bytes |

Query values are encoded by `URLSearchParams` (BR-190 v2). The `onRequest`
observer receives the template `/3/drive/{d}/upload`. Upload requests share
the BR-195 slots and queue and the BR-249 attempt timer.

### Acceptance sequence (BR-287)

Every name is `p19x-<run>-<letter>`, a per-run prefix that cannot occur in
other fixture names; `-deny` names match `**/*-deny*`. All items live
directly in `KDRIVE_WRITE_FOLDER` (root R). "Zero writes" means no non-GET
request.

Phase 1, deny list empty:

1. Upload text `a` (16 bytes) → `succeeded`, `action` `created`, `created`
   ID; `kdrive_info` shows size 16. Its success shows that kDrive accepts
   `Content-Type: application/octet-stream` (D-18-10) and a present, equal
   `parent_id` (D-18-9). The summary records, without any value, `parent_id
   present: yes` when step 1 succeeds (BR-285 requires it) and `unknown`
   otherwise. Any result other than `succeeded` at a step whose item later
   steps use (steps 1 and 7) stops the run; the remaining steps are
   reported `not run`.
2. Upload `a` again (24 other bytes), `overwrite` omitted → `failed`,
   `UPSTREAM_REJECTED`, 409; `kdrive_info` on the step-1 ID shows size 16.
3. Upload base64 `e` with 0 bytes → `succeeded`, size 0.
4. Upload `A` (case variant of `a`) → `succeeded` with a new ID.
5. Upload `a` with `overwrite:true`, `file_id` = step-1 ID, 24 bytes →
   `succeeded`, `action` `replaced`, same ID; `kdrive_read` returns the 24
   new bytes.
6. Upload with `overwrite:true`, `file_id` = step-1 ID and `name` `e` →
   `denied`, zero writes.
7. Upload text `y-deny` (8 bytes) → `succeeded` (no deny yet).
8. Create folder `D` (`kdrive_create_folder`), then upload a file named `D`
   in R → recorded as observed (result, status, and a listing count of
   children named `D`), not asserted (C5, D-18-4).
9. Upload text `n-é` written with a decomposed `é` (`e` + U+0301, NFD),
   8 bytes, one request → recorded as observed, not asserted: the result
   and, without the name, whether the stored name equals the sent code
   points (`yes`/`no`/`unknown`) (R-18-5), observed through one paginated
   GET listing of R filtered in memory by the run prefix and counted
   against the BR-287 caps.
10. Upload 524,289 bytes → `LIMIT_EXCEEDED`, zero requests.

Phase 2, deny list `**/*-deny*`:

11. Upload `x-deny` → `denied`; upload `y-deny` with `overwrite:true` and
    its step-7 ID → `denied`; zero writes.
12. In both phases each `succeeded`, `failed` or `uncertain` result has one
    `intent` and one `outcome` record and each `denied` one `denied` record,
    tool `kdrive_upload`; no record contains a fixture name or content.

Fixtures stay in place; the owner removes them manually.

## Acceptance criteria

Planned test files: `tests/upload-tool.test.ts`,
`tests/kdrive-upload-mutator.test.ts`, `tests/upload-production.test.ts`,
plus the replace cases of `tests/policy.test.ts`. Port and production tests
use the F-017 injected transport (loopback TLS server, counting `onRequest`).

- **AC-01** (BR-060 v6, BR-282, BR-283) — Given each mode, When tools are
  listed through the real MCP exchange, Then `read` lists ten tools, `write`
  and `share` list sixteen, and `kdrive_upload` has the BR-282 annotations,
  the Tool-text sentences, the BR-263 sentence and the Overwrite sentence.
  Verified by: `upload-tool.test.ts` (`TestBR060_*`, `TestBR282_*`,
  `TestBR283_*`).
- **AC-02** (BR-279, BR-281) — Given valid arguments with and without
  `drive_id`, with `overwrite` omitted, `false` and `true` (+`file_id`), Then
  the operation passed to `mutate` equals BR-281; Given an extra member,
  both `text` and `base64`, neither, `overwrite:"true"`, `overwrite:true`
  without `file_id`, `file_id` with `overwrite` omitted or `false`, the
  BR-260 invalid IDs and invalid names (`""`, `.`, `..`, `a/b`, `a\b`, a
  control character, `" a"`, `"a "`, `"a\uD800"`), Then `INVALID_ARGUMENTS` with zero
  `mutate` calls and zero requests. Verified by: `upload-tool.test.ts`
  (`TestBR279_*`, `TestBR281_*`).
- **AC-03** (BR-280) — Given `text` `"é😀"`, Then the payload is its 6 UTF-8
  bytes; Given `text` with a lone `\uD800`, base64 with whitespace, a
  URL-safe character, missing padding, nonzero pad bits (`"QQ=="` valid,
  `"QR=="` invalid), Then `INVALID_ARGUMENTS`; Given content of exactly
  524,288 bytes (text and base64), Then one `mutate` call; Given 524,289
  bytes, Then `LIMIT_EXCEEDED`, zero `mutate` calls; Given base64 that is
  both non-canonical and decodes or would decode to more than 524,288 bytes,
  `text` with a lone surrogate and more than 524,288 bytes, and an extra
  member with oversized content, Then `INVALID_ARGUMENTS` (BR-280 order);
  Given `""` in both forms, Then a 0-byte payload. Verified by: `upload-tool.test.ts`
  (`TestBR280_*`).
- **AC-04** (BR-274 v2, BR-281) — Given the production composition in
  `write` mode, Then the registry has exactly the seven kinds, a run of kind
  `share-link` is refused `UNAVAILABLE` with zero records; Given gate results
  `succeeded`, `failed`, `uncertain` and `denied`, Then the content is one
  text item equal to the gate result and `isError` is false only for
  `succeeded`. Verified by: `upload-production.test.ts` (`TestBR274_*`,
  `TestBR281_*`).
- **AC-05** (BR-035 v2, BR-034) — Given denies `["**/*-deny*"]`, When
  uploading `x-deny` into a permitted folder, into a folder whose own path is
  denied, and replacing a file at a denied path, Then each is `denied` with
  zero intent records and zero non-GET requests; Given a replace whose
  `file_id` is a folder, is a file in another folder than `parent_id`, has
  another name than `name` (including a case-only difference), is in
  another drive, or whose destination is a file; Given an upload-new or
  replace whose destination is outside every configured root, a replace
  whose target is outside every root, and a destination or target that is
  trashed or answers 404, Then each is `denied`
  likewise; Given a permitted upload-new and replace, Then each sends
  exactly one non-GET request and returns `succeeded`. Verified by: `policy.test.ts`
  (`BR-035 v2 …`) and `upload-production.test.ts` (`TestBR035_*`).
- **AC-06** (BR-204 v1, BR-257) — Given `KDRIVE_MCP_SHARED_WRITE=1` and a
  destination or replace target inside a received share with
  `sharedWrite=true`, Then the call is `denied` after a fresh
  `shared_with_me` list, with zero intent records and zero non-GET requests.
  Verified by: `upload-production.test.ts` (`TestBR257_upload*`).
- **AC-07** (BR-190 v3, BR-266 v2, BR-284) — Given each mutator, When it runs
  once against the loopback server with payloads of 0, 16 and 524,288
  bytes, Then the server sees exactly one `POST` with the Route-table path
  and query (order, encoding of a name with `&`, `=`, `%`, space and
  non-ASCII, the decoded `file_name` equal to the checked name), the exact
  body bytes, `Content-Type:
  application/octet-stream`, `Content-Length`, `Connection: close` and the
  bearer token, on a connection carrying no other request; `conflict` is
  `error` for `upload-new` and `version` for `replace` and never another
  value. Verified by: `kdrive-upload-mutator.test.ts` (`TestBR190_*`,
  `TestBR266_*`, `TestBR284_*`).
- **AC-08** (BR-285, BR-286, BR-268) — Given 200 bodies that are valid, have
  `result` other than `success`, invalid JSON, a truncated body, a `name`,
  `size`, `type` or `parent_id` different from the request, an absent
  `parent_id`, or (for
  replace) an `id` other than the target, Then only the valid ones are
  `succeeded` with the BR-285/BR-286 `value` (and `created` for upload-new)
  and the others are `uncertain`; Given 409 `file_already_exists_error`, 400
  `upload_failed_error` and 422, Then `failed` `UPSTREAM_REJECTED`; Given a
  429 then a 200, Then `succeeded` after two attempts with identical bytes
  (BR-248). Verified by: `kdrive-upload-mutator.test.ts` (`TestBR285_*`,
  `TestBR286_*`).
- **AC-09** (BR-289, BR-251, BR-284) — For upload-new and replace, Given a
  permitted call whose response is lost after the server read the whole
  body, or after half of it, or never answered until the 30,000 ms attempt
  abort (fake clock), Then the result is `uncertain` with the BR-251
  message, `attempts:1`, the server saw exactly one non-GET request and no
  later request of any kind, and the outcome record says `uncertain`.
  Verified by: `upload-production.test.ts` (`TestBR289_*`).
- **AC-10** (BR-284, BR-285, D-07) — Same-name concurrency. Given one
  synthetic loopback server applying `conflict=error` at body completion
  (first complete body wins, the other gets 409
  `file_already_exists_error`), and two independent production compositions
  (separate navigation controllers and audit sinks), When both upload the
  same new name with `overwrite` omitted, (a) started together and (b) with
  the first holding half its body until the second completes, Then in each
  case exactly one result is `succeeded` and one `failed`
  `UPSTREAM_REJECTED` 409, each composition sent exactly one request with
  `conflict=error`, and the server holds one file with the winner's bytes;
  Given two concurrent calls in one session, Then the second returns
  `SERVER_BUSY` with zero requests (BR-258). This verifies this server's
  mapping only; server atomicity stays R-18-1. Verified by:
  `upload-production.test.ts` (`TestBR284_concurrent*`).
- **AC-11** (BR-234) — Given an upload whose name and content carry the
  marker `SECRETMARK`, Then the audit records hold IDs only, no marker, no
  size and no content; the gate result holds no content. Verified by:
  `upload-production.test.ts` (`TestBR234_upload*`).
- **AC-12** (BR-287, real API) — Given an actual main checkout, the owner's
  token and a designated folder, When the owner runs `make
  kdrive-upload-acceptance KDRIVE_WRITE_FOLDER=<id>`, Then every asserted
  step passes, steps 8 and 9 are recorded, the caps hold, and the summary passes the
  BR-213 v3 leak check; without `KDRIVE_WRITE_FOLDER` the target refuses
  before any Docker command. Verified by: owner-run command, report
  `runs/19-acceptance-1.md`; the refusal by a `Makefile` test in
  `upload-tool.test.ts` (`TestBR287_*`).
- **AC-13** (BR-288) — Given the README, `SECURITY.md` and the tool
  description after the implementation PR, Then they state each BR-288 item
  and none claims that `overwrite:false` is guaranteed. Verified by:
  reviewer document check in the implementation PR.

## Decisions

- **D-18-1 — D-07 option A as the contract.** `overwrite:false` →
  `conflict=error`, `overwrite:true` → `conflict=version`; the refusal is
  described as observed, never guaranteed. Rejected by the owner: B (weaker
  preflight-only wording), C (withhold upload).
- **D-18-2 — `overwrite:true` requires `file_id`, checked by the policy.**
  `conflict=version` selects the file by folder and name, so the policy must
  bind that pair to an authorized file identity; the caller names the file
  it expects to replace and the core checks parent and name against its live
  evidence (BR-035 v2); a 2xx with another ID is `uncertain` (BR-286).
  Rejected: resolving the name by a pre-listing (extra paginated reads and
  the same check-then-act window); sending `conflict=version` under
  `upload-new` (F-003 forbids replacement masquerading as creation);
  carrying folder and name only in the payload (unchecked, could replace a
  denied file).
- **D-18-3 — Fixed 524,288-byte bound, not configurable.** Below the
  measured 1 MiB (the maximum is unknown); a base64 payload of that size
  (699,052 characters) fits the 1 MiB stdio frame; over HTTP the 262,144-byte
  body limit binds first. The bound is on decoded bytes; `text` is sent as a
  JSON string, so escaping can make a request under the byte bound exceed
  the frame (up to 6 characters per control byte, and clients that escape
  non-ASCII as `\uXXXX` reach it from about 175–350 KiB of non-Latin
  `text`). Over HTTP the transport refuses it with 413 (BR-160) before the
  tool runs; over stdio F-005 terminates the server with
  `STDIO_INPUT_FAILED` and no MCP error; an upload already in flight
  completes and its outcome is recorded in the audit log before exit
  (BR-254), but its tool result is not delivered. BR-288 and a fixed tool-text sentence document this
  and steer large or non-ASCII content to `base64`. Rejected: bounding the encoded request length in the tool (the
  transport already enforces it, and two limits on different units would
  confuse callers). Rejected: a configurable key (changes the F-002
  inventory and versioned config rules for a bound inbound limits already
  cap); 1 MiB (does not fit a stdio frame as base64).
- **D-18-4 — No same-name or folder-name pre-check.** A pre-check is
  check-then-act and adds a listing; the server refusal is the control.
  The folder-name case (C5) is unknown, so acceptance step 8 records it;
  BR-285 makes a stored name different from the request `uncertain`.
- **D-18-5 — `destructiveHint:true`.** Annotations are per tool and
  `overwrite:true` replaces content. Rejected: `false` (untrue for the
  overwrite path).
- **D-18-6 — No real-API concurrency in acceptance.** #16 measured 8
  concurrent samples; the acceptance uses one stdio session (BR-258
  serializes calls). Same-name concurrency is tested on this server's
  mapping with a synthetic server (AC-10).
- **D-18-7 — Separate acceptance target.** `make kdrive-upload-acceptance`
  reuses the BR-276 guards without re-running the F-017 sequence. Rejected:
  BR-276 v2 with a third phase (longer owner run, higher caps).
- **D-18-8 — 429 retry kept.** A 429 is a refusal before acceptance, so the
  BR-248 retry resends the same bytes; any other unknown result is never
  replayed (BR-289).
- **D-18-9 — `parent_id` required in the upload response.** BR-285/BR-286
  accept a success only when the response's `parent_id` equals the
  destination, so a write to another folder is never reported `succeeded`.
  #16 did not record whether the upload response carries `parent_id`;
  acceptance step 1 records it. If it is absent, every upload would be
  `uncertain`: a new spec version (another binding, or a documented residual
  risk) is required before release. Rejected: accepting an absent
  `parent_id` (an unverified write location reported as success).
- **D-18-10 — `application/octet-stream` assumed.** BR-266 v2 sends the
  payload as `application/octet-stream`; #16 did not establish which
  content types the upload route accepts. This is an explicit assumption,
  evidenced by acceptance step 1. If kDrive rejects it, BR-266 gets a new
  version with the accepted type, through a new spec version, review and
  freeze, before release. Rejected: deriving a MIME type from the name (out
  of scope; the server derives it).

- **D-18-11 — Stored-name divergence blocks release.** If acceptance step
  8 or 9 shows kDrive storing a name different from the sent one, each such
  upload writes at an unchecked path and returns `uncertain`, and a
  verify-then-retry client can accumulate renamed copies. A new spec version
  (pre-check, name restriction, or an explicitly accepted risk) is then
  required before release. Rejected: releasing with the divergence
  undocumented.

## Residual risks

- **R-18-1** — The `conflict=error` refusal is server behaviour observed on
  9/9 samples (checked at upload completion), not proven under every
  interleaving; a concurrent writer could still win a race this server
  cannot see.
- **R-18-2** — Check-then-act (SPEC §10.6): between the policy check and a
  replace, the target can be renamed or moved and another file can take its
  name in that folder; kDrive then replaces or creates that file at the same
  authorized path, and the result is `uncertain` (BR-286). A destination
  renamed into a deny pattern between check and upload is not detected; a
  destination moved or trashed out of the authorized roots between check
  and write still matches the response `parent_id`, so the upload is
  reported `succeeded` outside the roots.
- **R-18-3** — A file named like an existing folder (C5): the stored name is
  unknown until acceptance step 8.
- **R-18-4** — kDrive keeps or discards the replaced content according to its
  own version history, which this server neither reads nor guarantees.
- **R-18-5** — kDrive may normalize a name (for example Unicode NFC/NFD or
  other rewriting); the file is then stored at a path this server did not
  check against the deny list. BR-285/BR-286 report a stored name different
  from the request as `uncertain`, but the write has happened; acceptance
  step 9 records whether normalization occurs. If step 8 or step 9 shows a
  stored name different from the sent one, a new spec version (a pre-check,
  a name restriction, or an explicitly accepted risk) is required before
  release (D-18-11).

## Open questions

None.

## Stress-test

Round 1 (`runs/19-spec-review-1.md`, verdict `changes`):

| #   | Severity | Finding                                          | Decision | Change                                                                                                    |
| --- | -------- | ------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| 1   | major    | BR-035 v2 breaks existing `replace` fixtures     | Retained | Scope item 2 migrates them, assertions unchanged; BR-035 v2 supersedes the F-003 row; F-004 row unchanged |
| 2   | minor    | AC-05 lacks outside-root and trashed/404 cases   | Retained | Cases added to AC-05                                                                                      |
| 3   | minor    | `parent_id` presence unverified                  | Retained | `parent_id` required (absent → `uncertain`); step 1 records it; D-18-9                                    |
| 4   | minor    | `application/octet-stream` unverified            | Retained | Explicit assumption D-18-10, evidenced by step 1, version path stated                                     |
| 5   | minor    | Refusal order undefined                          | Retained | BR-280 states the order; AC-03 cases added                                                                |
| 6   | minor    | JSON-escaped `text` can exceed the stdio frame   | Retained | D-18-3 and BR-288 state the decoded-bytes bound versus the transport limit                                |
| 7   | minor    | Server name normalization could bypass the check | Retained | R-18-5 and acceptance step 9 (one NFD upload, observed)                                                   |
| 8   | minor    | Base should cite main `8b85fc1`                  | Retained | Base line updated                                                                                         |

Round 2 (`runs/19-spec-review-2.md`, verdict `approve`, three minors folded in
by the orchestrator):

| #   | Severity | Finding                                              | Decision | Change                                                                   |
| --- | -------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 1   | minor    | Only a step-1 `uncertain` stopped the acceptance run | Retained | Any non-`succeeded` result at steps 1 and 7 stops the run (`not run`)    |
| 2   | minor    | Step 9 observation method unstated                   | Retained | One paginated GET listing of R, filtered in memory, within BR-287 caps   |
| 3   | minor    | Fixture migration undefined for a missing target     | Retained | Existing fixture folder as destination; AC-05 says "one non-GET request" |

Fable decision pass (`runs/19-spec-fable-1.md`, verdict `approve`, five
minors folded in by the orchestrator; findings 1 and 2 change BR and tool
text, so an Opus diff-only round checks them):

| #   | Severity | Finding                                                  | Decision | Change                                                                       |
| --- | -------- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| 1   | minor    | Unpaired surrogate in `name` is sent as U+FFFD           | Retained | BR-279 requires a well-formed name; AC-02 adds `"a\uD800"`; AC-07 decodes it |
| 2   | minor    | "Refused by the transport" is false for stdio            | Retained | BR-288, D-18-3 state stdio termination; tool-text sentence steers to base64  |
| 3   | minor    | No consequence defined for a stored-name divergence      | Retained | D-18-11 and R-18-5: new spec version before release                          |
| 4   | minor    | R-18-2 omits a destination moved out of roots mid-flight | Retained | Sentence added to R-18-2                                                     |
| 5   | minor    | Mismatched 2xx drops the written ID from audit           | Retained | BACKLOG line for an F-016 follow-up; no change in this ticket                |

Round 3 (`runs/19-spec-review-3.md`, Opus diff-only, verdict `changes`): one
minor, retained — the stdio-termination text wrongly said an in-flight
upload stays intent-only; `src/stdio.ts` drains the gate before exit
(BR-254), so BR-288 and D-18-3 now say the outcome is recorded and only the
tool result is lost.

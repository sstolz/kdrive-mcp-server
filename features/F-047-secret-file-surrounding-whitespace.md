---
id: F-047
title: Secret file surrounding whitespace
ticket: "#111"
status: frozen
version: 1
---

## Context

The owner decision of 2026-11-19 (#99, decision B) ignores leading and
trailing space, tab, CR and LF around file-provided secrets. An empty result
remains invalid; interior bytes retain their current validation. Operators
commonly provision files with `echo`, which appends a newline.

The reported single-newline refusal needs qualification: on the inspected
main `e8ae20d`, `src/config.ts` already removes exactly one terminal LF or
CRLF from token and upstream-secret files. Two terminal newlines, a remaining
CR or a tab fail; spaces are currently retained. The existing LF and CRLF
success cases in `tests/config.test.ts` confirm that code contract. This
ticket broadens surrounding-whitespace handling, without claiming a plain
`echo` file currently fails in every case.

Targeted inspection found these three runtime secret-file sources:

| Selector | Reader and existing validation | Existing refusal identities |
| --- | --- | --- |
| `KDRIVE_TOKEN_FILE` (`tokenFile`, `--token-file`) | `loadSecret` via `secretPairs`; bounded read, fatal UTF-8 decode, one terminal LF/CRLF removed, nonempty text without ASCII controls | `CREDENTIAL_INVALID/token`; read and size errors use `tokenFile` |
| `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` (`oauthUpstreamClientSecretFile`, `--oauth-upstream-client-secret-file`) | The same `loadSecret` path and text validation | `CREDENTIAL_INVALID/oauthUpstreamClientSecret`; read and size errors use `oauthUpstreamClientSecretFile` |
| `OAUTH_SIGNING_KEY_FILE` (`oauthSigningKeyFile`, `--oauth-signing-key-file`) | `loadSigning`: bounded nonempty opaque bytes; subsequently `src/auth/proxy/keys.ts` parses exactly one PKCS#8 PEM EC P-256 private key | Empty bytes: `CREDENTIAL_INVALID/oauthSigningKeyFile`; invalid key: `AuthConfigurationError` with the fixed `SIGNING_KEY_ERROR` message |

The PEM parser already accepts outer whitespace on both sides: its anchored
regex in `src/auth/proxy/keys.ts` uses Unicode `\s*` before the opening
and after the closing delimiter. ASCII trimming changes signing-key validation
behavior only for nonempty files consisting entirely of the four trim bytes:
currently `loadSigning` accepts them unchanged, then proxy construction throws
`AuthConfigurationError` with `SIGNING_KEY_ERROR` because no PEM block matches;
afterward loading fails earlier with `CREDENTIAL_INVALID/oauthSigningKeyFile`.
An already empty file has that configuration error today. Nonempty signing
content keeps the same interior bytes and the same subsequent parser.
These outcomes follow from the inspected branches, not a runtime measurement.

`src/config-schema.ts` inventories no additional runtime `*_FILE` secret.
`OAUTH_STATE_FILE` names a SQLite state store, not a secret-content input.
`SIGNING_KEY_FILE` in Compose selects the host mount for the same signing
key, not a fourth runtime source. Build/scanner credentials outside `src/`
configuration loading are outside this ticket.

Sources: [BR-026 v1](../business-rules/BR-026.md),
[BR-023 v4](../business-rules/BR-023.md),
[BR-027 v1](../business-rules/BR-027.md),
[BR-124 v2](../business-rules/BR-124.md),
`src/config.ts`, `src/config-files.ts`, `src/config-values.ts`,
`src/config-sources.ts`, `src/config-schema.ts`,
`tests/config.test.ts`, `tests/config-value-boundaries.test.ts` and
`tests/auth/proxy-construction.test.ts`. F-002's credential-file contract is
historical; this versioned rule supplies the new normalization contract.

This is the full path and is security-sensitive because it changes the bytes
used as credentials. Strong-tier spec approval and the strongest-tier
security decision pass precede autonomous freeze; the corresponding code
reviews precede merge. This document is ready for those reviews, not frozen.
The orchestrator re-checks IDs and versions on current main before freeze and
before the implementation PR. Local inventory ends at BR-433; BR-434 is free
but is not needed here.

## Scope

1. Normalize every selected runtime secret file listed above after its
   existing bounded read, before content validation. Remove the maximal
   contiguous prefix and suffix consisting exclusively of bytes `20`, `09`,
   `0D`, `0A` (hex): U+0020 SPACE, U+0009 TAB, U+000D CR, U+000A LF.
   Repeated and mixed occurrences are all removed, not just one line ending.
   A nonmember stops trimming at that edge. Do not split lines or normalize
   interior bytes. Do not trim a file selector or a nonsecret file.
2. For token and upstream-secret files, trim these ASCII bytes, then perform
   the existing fatal UTF-8 decode and nonempty/control validation on the
   result. The disallowed control range stays U+0000–U+001F and U+007F.
   Ordinary interior spaces remain valid; interior tabs, CR and LF remain
   invalid. The same byte operation applies to signing material before its
   existing nonempty check, retaining opaque bytes locally; proxy construction
   still performs the existing key parsing. No common text decoder is imposed
   on binary signing input.
3. Do not trim any other Unicode whitespace, NUL or BOM. In particular,
   U+00A0 NBSP and U+FEFF BOM are not members. Preserve their existing handling
   at each validation stage, including the signing parser's broader whitespace
   grammar and decoder behavior; this ticket does not tighten that parser.
4. Preserve direct `KDRIVE_TOKEN` and `OAUTH_UPSTREAM_CLIENT_SECRET` behavior.
   Although they share `loadSecret`, its file and inline branches are already
   separate. Apply trimming only in the file branch. Direct spaces remain
   significant, including a spaces-only value; direct tabs/CR/LF remain
   invalid. There is no inline signing-key source to change.
5. Preserve raw file-byte limits before trimming: 16,384 for token/upstream
   files and 65,536 for signing files, including all discarded padding.
   Preserve streaming limits, regular-file checks, final-entry no-follow
   open, pre/open/post identity checks, allowed parent symlinks and all read
   failures. The runtime reader has no explicit UID/GID or mode-bit ownership
   policy; normal filesystem readability is enforced by opening the file.
   Do not add or remove a permission/ownership policy. Keep the deployment
   guidance requiring UID 1000 readability and private secret files.
6. Keep source selection, conflicts, requiredness, validation ordering before
   credential I/O and no-fallback behavior. Empty-after-trim uses the existing
   `CREDENTIAL_INVALID` identity with `token`, `oauthUpstreamClientSecret` or
   `oauthSigningKeyFile`, respectively. Oversize raw input still wins over
   content validation with `LIMIT_EXCEEDED` and the file selector setting.
   Read failures remain `CREDENTIAL_READ_FAILED` with that selector setting.
   No error/log gains secret content, paths, secret length, raw length or a
   trimmed-byte count. Keep fixed configuration messages and the signing
   parser's fixed message; do not log successful normalization.
7. Update `README.md`'s two token-file instructions; `docs/development.md`'s
   credential contract; and `docs/deployment.md`'s Secrets, provisioning step 3
   and `CREDENTIAL_INVALID` troubleshooting. Replace the one-newline/extra-tab
   refusal wording with the exact four-character boundary rule, empty-result
   refusal, unchanged interior validation and unchanged environment behavior.
   Align `docs/oauth-proxy.md`'s signing-key instructions with the same file
   normalization while preserving PKCS#8/P-256 requirements. Inspect
   `SPEC.md`'s proxy configuration contract and `examples/config.yaml`,
   `examples/compose.yaml`, `examples/compose-traefik.yaml` comments for
   consistency: the targeted search found no explicit refusal wording there.
   Amend only directly relevant credential guidance if needed; do not change
   example sources, mount expressions or provisioning commands. Do not copy
   unrelated existing names, addresses or hosts into new public content.
8. Prepare BR-026 v2, its dated history, examples and AC/test links,
   `business-rules/README.md`, `capability-map.md` and an Unreleased
   `CHANGELOG.md` entry as pending acceptance for #111. BR-026 v1 remains the
   accepted version until acceptance on actual main. F-047 remains frozen
   during implementation and acceptance; its `done` marker and the accepted
   capability/BR markers are synchronized in the next reviewed PR after
   successful acceptance. Do not alter completed historical specs to rewrite
   their contracts. No release or VERSION change belongs to this ticket.
9. As record synchronization for accepted #112 under AGENTS.md §6, set F-046
   v1 to `done` and BR-184 v4, BR-186 v3 and BR-187 v4 to `active`, including
   their index, capability and changelog markers. Link the records to the
   supplied [#112 acceptance evidence](https://github.com/sstolz/kdrive-mcp-server/issues/112#issuecomment-7014711154)
   on actual main `e8ae20d`. This is acceptance synchronization, not a new
   version of those rules. Include the three deferred minor review items:
   - Add a parameterized test for every alternative in the BR-187 v4 negative
     example and retain the example, without expanding the accepted guidance
     contract.
   - Add a sentence to the BR-184 v3 and BR-186 v2 Verification lines that
     their AC-21 tests were renamed to the F-046 AC-06/AC-07 tests,
     respectively. Preserve their historical accepted text and history.
   - Collapse whitespace in `validateAllowlistGuidance`
     (`tests/helpers/deployment.ts`) before its table-cell/prose comparisons,
     matching the accepted BR-187 v4 wording. Retain the case-sensitive
     comparisons and every per-location assertion.

### Out of scope

- #110, #105, BR-014 and unrelated deployment work.
- Changes to secret formats, key types, curves, lengths, entropy requirements,
  sources, precedence or selector syntax; adding secret discovery or fallback.
- Trimming inline environment credentials, normalizing interior whitespace,
  broad Unicode trimming, state-store contents or build/scanner secrets.
- Real-secret provisioning, live-provider acceptance, key generation by the
  server, release or publication.

## Business rules

Retain existing IDs and purposes. Add BR-026 v2 as `pending acceptance` with
source F-047 v1; do not activate it before acceptance. No new BR is allocated.

- **BR-026 v2** — Selected token, upstream-secret and signing-key files are
  read under their raw byte limits (16,384 bytes for token/upstream-secret,
  65,536 for signing-key), their maximal leading and trailing
  U+0020/U+0009/U+000D/U+000A sequences are removed, an empty result gives
  `CREDENTIAL_INVALID`, the unchanged content checks follow on the result,
  and inline environment values are never trimmed.
  Verified by: AC-01–AC-25.

This is one guarded-loading statement; Scope defines its exact normalization
and preserved safeguards. Update v1's one-terminal-newline examples and the
opaque-signing example ending in LF to describe v2 explicitly. Retain the
accepted v1 examples as historical, rather than presenting contradictory
unqualified expectations.

BR-023 v4 remains unchanged: its byte budgets and validation bounds do not
change. Clarify references to normalization in the pending BR-026 v2 record,
without changing BR-023's accepted statement or input-byte accounting.

During implementation, make these explicit citation/wording dispositions:

- In `tests/config-value-boundaries.test.ts` and the BR-026 v2 record,
  re-cite P-BR026-001–P-BR026-022 as BR-026 v2, preserving their IDs,
  inputs and assertions: all these boundary outcomes remain valid under v2.
  In particular, `P-BR026-004 BR-026 v1: counts token LF in the 16384-byte
  file budget` becomes `P-BR026-004 BR-026 v2: counts token LF in the
  16384-byte file budget`; its LF wording stays because that fixture still
  counts and removes LF. `P-BR026-005 BR-026 v1: rejects token file overflow
  before LF stripping` becomes `P-BR026-005 BR-026 v2: rejects token file
  overflow before LF stripping`; its LF wording stays because this raw-byte
  overflow still precedes removal of that fixture's LF. The BR-026 v2 example
  for P-BR026-004 describes removal of its sole LF, without implying that only
  one LF can be removed in general; historical v1 expectations stay labelled.
- Keep `selected input bytes before URL canonicalization/newline stripping`
  in `business-rules/BR-023.md` and `business-rules/BR-024.md`: the inspected
  phrase describes budget ordering, which remains accurate because newline
  stripping is still part of file normalization after raw-byte accounting.
  Neither rule needs a version change for this wording.
- BR-014 stays out of scope; no statement, test or citation for it changes.

BR-027 v1 remains unchanged: stable redaction already excludes values and
configuration details; no normalization diagnostics are introduced.
BR-124 v2 remains unchanged: key parsing and cryptographic qualification
retain their existing contract. BR-184 v4, BR-186 v3 and BR-187 v4 are reused
for the accepted #112 synchronization and deferred checks, without new versions.

## Acceptance criteria

All fixtures are obviously synthetic. Escapes denote exact characters/bytes,
not literal backslashes. `T` is `SYNTHETIC_TOKEN`; `U` is
`SYNTHETIC_CLIENT_SECRET`. `P` denotes the existing test-only
`syntheticPem()` EC P-256 PKCS#8 fixture with only its outer four-character
padding removed; do not print its bytes or embed any private key in this
specification. Tests use temporary files or injected readers, never operator
files. Otherwise complete valid configuration uses only example.com,
example.org or example.net hosts. Each table row is a separate Given/When/Then
criterion and has its own named test; each listed alternative is a separate
parameter row. Test titles contain only the listed synthetic case labels,
never file content or secret-dependent counts.

First characterize current outcomes at the public `loadConfiguration` and
proxy-construction boundaries, before implementation. Retain the passing
single-LF/CRLF, malformed UTF-8, controls, source-selection and raw-budget
tests. Add the new mixed/repeated-padding and empty-after-trim cases and
observe their expected failures before code changes. Update tests that pinned
the superseded v1 behavior only after recording that baseline; do not remove
security coverage to pass the gate. Named tests below are required additions
or adaptations, not claims of execution.

For AC-01–AC-07, When means `loadConfiguration` reads the selected
`KDRIVE_TOKEN_FILE`. Tests are in `tests/config.test.ts` and each full test
name is exactly `BR-026 v2 AC-NN <label>` from its row.

| AC / BR | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-01 / BR-026 v2 | File bytes `T + "\n"`, also `T + "\n\n"` | Loading runs | Token equals T | token trailing LF |
| AC-02 / BR-026 v2 | `T + "\r\n"`, also two CRLF pairs | Loading runs | Token equals T | token trailing CRLF |
| AC-03 / BR-026 v2 | `" \t" + T + "\t "`, also `"\r\n\t " + T + " \t\r\n"` | Loading runs | Token equals T | token surrounding spaces and tabs |
| AC-04 / BR-026 v2 | Empty bytes, `" "`, `"\t"`, `"\r"`, `"\n"`, or `" \t\r\n\n"` | Loading runs | `CREDENTIAL_INVALID/token`; no fallback | token empty after trim |
| AC-05 / BR-026 v2 | `"SYNTHETIC TOKEN"`, `"SYNTHETIC\tTOKEN"`, `"SYNTHETIC\rTOKEN"`, `"SYNTHETIC\nTOKEN"` | Loading runs | Space retained and accepted; each interior control refused with `CREDENTIAL_INVALID/token` | token interior whitespace |
| AC-06 / BR-026 v2 | `"\u00a0" + T + "\u00a0"`, `"\ufeff" + T + "\ufeff"`, or `"\u2003" + T` | Loading runs | Exact decoded string retained and accepted, as today; none of those characters trimmed | token nontrimmed Unicode |
| AC-07 / BR-026 v2 | `" \t\0" + T + "\n"`, also malformed UTF-8 byte `ff` between ASCII padding | Loading runs | `CREDENTIAL_INVALID/token`; NUL is not trimmed and malformed encoding is not repaired | token NUL and invalid encoding |

For AC-08–AC-14, When means `loadConfiguration` reads the selected
`OAUTH_UPSTREAM_CLIENT_SECRET_FILE` in valid proxy configuration. Tests are
in `tests/config.test.ts`, with exact names `BR-026 v2 AC-NN <label>`.

| AC / BR | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-08 / BR-026 v2 | `U + "\n"`, also `U + "\n\n"` | Loading runs | Upstream secret equals U | upstream trailing LF |
| AC-09 / BR-026 v2 | `U + "\r\n"`, also two CRLF pairs | Loading runs | Upstream secret equals U | upstream trailing CRLF |
| AC-10 / BR-026 v2 | `" \t" + U + "\t "`, also `"\r\n\t " + U + " \t\r\n"` | Loading runs | Upstream secret equals U | upstream surrounding spaces and tabs |
| AC-11 / BR-026 v2 | Empty bytes, `" "`, `"\t"`, `"\r"`, `"\n"`, or `" \t\r\n\n"` | Loading runs | `CREDENTIAL_INVALID/oauthUpstreamClientSecret`; no fallback | upstream empty after trim |
| AC-12 / BR-026 v2 | `"SYNTHETIC CLIENT"`, `"SYNTHETIC\tCLIENT"`, `"SYNTHETIC\rCLIENT"`, `"SYNTHETIC\nCLIENT"` | Loading runs | Space retained and accepted; interior controls refused with `CREDENTIAL_INVALID/oauthUpstreamClientSecret` | upstream interior whitespace |
| AC-13 / BR-026 v2 | `"\u00a0" + U + "\u00a0"`, `"\ufeff" + U + "\ufeff"`, or `"\u2003" + U` | Loading runs | Exact decoded string retained and accepted, as today | upstream nontrimmed Unicode |
| AC-14 / BR-026 v2 | `" \t\0" + U + "\n"`, also malformed UTF-8 byte `ff` between ASCII padding | Loading runs | `CREDENTIAL_INVALID/oauthUpstreamClientSecret` | upstream NUL and invalid encoding |

For AC-15–AC-21, tests are in `tests/auth/proxy-construction.test.ts`, with
exact names `BR-026 v2 BR-124 v2 AC-NN <label>`. Drive the actual
`loadConfiguration` file path and pass the loaded bytes into proxy construction;
do not test a replacement trim function alone. Assert local bytes separately
from construction outcomes, preserving the existing no-port-I/O checks.

| AC / BRs | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-15 / BR-026 v2, BR-124 v2 | Signing file `P + "\n"`, also two LF | Loading then construction run | Loaded bytes equal P; construction succeeds with the same `kid` as P | signing trailing LF |
| AC-16 / BR-026 v2, BR-124 v2 | `P + "\r\n"`, also two CRLF pairs | Loading then construction run | Loaded bytes equal P; same successful key and `kid` | signing trailing CRLF |
| AC-17 / BR-026 v2, BR-124 v2 | `" \t" + P + "\t "`, also `"\r\n\t " + P + " \t\r\n"` | Loading then construction run | Loaded bytes equal P; same successful key and `kid` | signing surrounding spaces and tabs |
| AC-18 / BR-026 v2 | Empty bytes, `" "`, `"\t"`, `"\r"`, `"\n"`, or `" \t\r\n\n"` | Loading runs | `CREDENTIAL_INVALID/oauthSigningKeyFile` before proxy construction | signing empty after trim |
| AC-19 / BR-026 v2, BR-124 v2 | P with LF or CRLF internal PEM line endings; alternatively insert one space or tab inside a base64 line | Loading then construction run | First characterize direct construction from each exact variant before implementation and pin its result; loaded interior bytes remain unchanged and construction matches that direct result: same `kid` on success or the same fixed signing-key error on refusal | signing interior whitespace |
| AC-20 / BR-026 v2, BR-124 v2 | `"\u00a0" + P + "\u00a0"`, `"\ufeff" + P + "\ufeff"`, or `"\u2003" + P` | Loading then construction run | Nonmember bytes retained exactly locally; construction has the identical outcome as direct construction from those unmodified bytes: same `kid` on success or the same fixed signing-key error on refusal | signing nontrimmed Unicode |
| AC-21 / BR-026 v2, BR-124 v2 | `" \t\0" + P + "\n"`, also byte `ff` before P between ASCII padding | Loading then construction run | Local result retains NUL/invalid byte and remains nonempty; construction fails with the existing fixed signing-key error, not a new configuration error | signing NUL and invalid encoding |

- **AC-22 (BR-026 v2, BR-023 v4)** — Given each selected file kind,
  When loading reads raw bytes at or beyond its limit, Then the original
  raw-byte budget applies before trimming. In `tests/config.test.ts`,
  `BR-026 v2 BR-023 v4 AC-22 raw file budgets precede trimming` covers each
  text secret with `"x"` repeated 16,383 times plus LF (accepted with LF
  removed), 16,384 times plus LF (refused), and 16,385 spaces (refused);
  signing with 65,535 zero bytes plus LF (locally accepted as 65,535 zero
  bytes), 65,536 zero bytes plus LF (refused), and 65,537 spaces (refused).
  Also test whitespace-only files exactly at each limit: 16,384 spaces
  for each text secret and 65,536 spaces for signing give
  `CREDENTIAL_INVALID` with `token`, `oauthUpstreamClientSecret` and
  `oauthSigningKeyFile`, respectively, not `LIMIT_EXCEEDED`. Test 16,383
  spaces plus one valid `x` for each text secret: exactly 16,384 raw bytes
  are accepted and normalize to `x`. For signing, pad P with ASCII spaces
  to exactly 65,536 raw bytes: loading yields P and proxy construction
  succeeds with P's `kid`; verify this construction in
  `tests/auth/proxy-construction.test.ts` under the same AC-22 test name.
  Every overflow is `LIMIT_EXCEEDED` with its file selector setting, rather
  than an empty/content error. Signing's opaque synthetic bytes do not claim
  cryptographic validity. Retain the existing 65,536-zero-byte local success.
- **AC-23 (BR-026 v2, BR-023 v4)** — Given each direct environment secret
  (`KDRIVE_TOKEN`, `OAUTH_UPSTREAM_CLIENT_SECRET`), When loading runs, Then
  `" SYNTHETIC \u0020"` and `" "` remain exact accepted values; empty text,
  `"SYNTHETIC\n"`, `"SYNTHETIC\r\n"`, `"\tSYNTHETIC"` and
  `"SYNTHETIC\t"` remain `CREDENTIAL_INVALID` with the logical setting.
  NBSP/BOM remain exact accepted characters; 16,384 `x` bytes pass and
  16,385 fail with `LIMIT_EXCEEDED` at the logical setting. Verified by
  `tests/config.test.ts`,
  `BR-026 v2 AC-23 inline credentials remain unchanged`, with rows for both
  names. Existing config-value-boundary tests remain part of the regression.
- **AC-24 (BR-026 v2, BR-027 v1)** — Given all three selected secret kinds
  and padded synthetic inputs, When reads or validation fail, Then retained
  real-file tests still reject missing/unreadable files, nonregular files,
  final symlinks, identity replacement and streaming growth; parent symlinks
  remain allowed. Source conflicts and invalid configuration still precede
  credential I/O, and unselected files are not read. Extend
  `tests/config.test.ts` with
  `BR-026 v2 BR-027 v1 AC-24 guarded reads and diagnostics remain unchanged`
  to exercise all three kinds and exact `{code, setting}` serialization and
  `Configuration error [<code>] (<setting>).` messages for whitespace-only,
  oversize and injected read failures. Use different synthetic padding
  amounts to assert the same messages: no content, length or trimmed count
  is exposed and no normalization log is emitted. Retain CLI redaction tests
  in `tests/cli.test.ts` and the fixed-message invalid-key checks in
  `tests/auth/proxy-construction.test.ts`. Adapt the old opaque-signing
  `ff 00 0a` expectation to `ff 00` locally; never decode or repair those
  remaining bytes.
- **AC-25 (BR-026 v2, BR-124 v2)** — Given synthetic invalid signing kinds
  (P-384, RSA, Ed25519, public-key PEM, two private-key blocks and corrupted
  PKCS#8), each surrounded by `" \t\r\n"`, When configuration loads and
  proxy construction validates the result, Then every case still fails
  with `AuthConfigurationError` and exactly
  `The OAuth signing key must be one PKCS#8 PEM EC P-256 private key.`
  Verified by `tests/auth/proxy-construction.test.ts`,
  `BR-026 v2 BR-124 v2 AC-25 padding cannot bypass key qualification`.
- **AC-26 (BR-187 v4)** — Given the accepted deployment guidance plus
  synthetic variants changing only wrapping or repeated whitespace in each
  relevant table cell/prose phrase, When `validateAllowlistGuidance` runs,
  Then the variants pass; altered case, missing guidance and per-location
  omissions still fail. In `tests/deployment-examples.test.ts`, add
  `BR-187 v4 F-047 AC-26 guidance comparisons collapse whitespace` and
  `BR-187 v4 F-047 AC-26 negative example stays covered` unconditionally,
  with separate rows for an unconditional `Yes` e-mail requirement, a missing
  subject row or assignment, and missing combined-requirement or reassignment
  guidance in each scoped location. Each mutation fails validation; retain
  the BR-187 v4 negative example and F-046 AC-01–AC-08 checks.

For AC-19 and AC-20, characterize each exact input through the existing
parser before implementation and pin that result. Its regex permits outer Unicode
whitespace and its decoder consumes an initial BOM, but `createPrivateKey`
also validates the PEM envelope; regex acceptance alone is not proof of
successful key construction. The equality of loaded and original bytes and
the unchanged parser fix the expected outcome without broadening acceptance.
No runtime result for those cases is claimed here: Docker access was denied
during spec authoring. This requires characterization, not a new owner choice.

Doc and record synchronization uses scoped content/link/diff review and
formatting checks, not unit tests for prose. Verify #112 markers and its
acceptance permalink against the supplied main/evidence reference; no new
acceptance claim is made by this spec. The implementation runs `make check`
through the Docker-only gate, mandatory PR CI and independent security
review. Acceptance repeats all scoped ACs on the actual merged main SHA and
records commands, results and SHA in #111; only then may the ticket close.
No real secret or live provider is needed for acceptance.

## Decisions

- Choose file-only maximal four-character trimming per #99 decision B. The
  file and inline branches already differ, so sharing `loadSecret` does not
  require changing environment semantics. Preserve inline bytes to avoid
  changing deployed credentials or turning whitespace-only inline values into
  a different contract.
- Apply trimming to signing bytes too. PEM is an ASCII envelope around
  base64-encoded PKCS#8 key data; outer space, tab, CR and LF are envelope
  padding, not key entropy. The existing PEM regex already accepts Unicode
  whitespace on both sides of the delimiters. The safety argument rests on
  preserving interior bytes and the existing fatal UTF-8/PEM/key parsing,
  including line breaks and base64, rather than changing parser acceptance.
  For nonempty files made solely of the four trim bytes, the existing later
  `AuthConfigurationError` becomes earlier
  `CREDENTIAL_INVALID/oauthSigningKeyFile`; empty files already fail there.
  Keep local opaque-byte handling and later key checks as separate stages.
- **Threat analysis.** Token/upstream edge padding becomes provisioning
  syntax under the owner's decision. These values are opaque; the code has
  no provider-specific length/entropy minimum, and this spec does not invent
  one. Nonempty validation, forbidden controls and fatal UTF-8 checks still
  apply after trim. The signing key still must parse as one EC P-256 PKCS#8
  private key; its curve fixes its existing strength qualification. There is
  no separate measured-entropy or secret-length minimum to relax. No key
  data is shortened or repaired. Raw budgets still bound padded files, so
  whitespace cannot bypass memory/read limits. NUL/BOM/Unicode are not silently
  discarded by the new normalization. The existing signing decoder's BOM
  handling and PEM regex's Unicode whitespace acceptance remain explicit
  residual behavior, not a new broad trim. No diagnostic reveals whether or
  how much padding was present.
- Reject keeping refusal of surrounding controls: it conflicts with the
  owner's provisioning decision. Reject trimming all Unicode whitespace:
  it would silently widen the normalization set and alter opaque text values.
  Reject removing only one trailing newline: that is already the text-file
  behavior and misses leading, repeated and mixed padding. Reject changing
  key formats, strength checks or the PEM parser to implement this feature.
- Version BR-026 as v2 because its guarded-source purpose is unchanged and
  its file-content contract changes. Reuse BR-023 v4, BR-027 v1 and BR-124 v2
  unchanged because raw bounds, diagnostics and key qualification stay the
  same. Reject allocating BR-434 for an existing rule's evolution. No costly
  architectural choice or new ADR is needed.
- Keep the accepted #112 synchronization and its three deferred minor items
  explicit and separate from #111's pending records. They neither reopen
  #112's allowlist decisions nor activate #111 before main acceptance.

## Open questions

## Stress-test

- **111-spec-1-reviewer / 1 / major — retained.** The inspected PEM regex accepts outer Unicode whitespace on both sides; corrected the safety argument and the whitespace-only signing error stage/identity before and after.
- **111-spec-1-reviewer / 2 / minor — retained.** BR-026 v2 now states the file limits, exact trim set, empty-result error, subsequent checks and unchanged inline handling in one standalone sentence.
- **111-spec-1-reviewer / 3 / minor — retained.** AC-22 now distinguishes exact-limit empty results and valid padded content from over-limit raw-byte refusal using the limits verified in `loadSecret`/`loadSigning`.
- **111-spec-1-reviewer / 4 / minor — retained.** The inspected BR-187 v4 negative example is retained and its missing parameterized coverage is an unconditional AC-26 requirement.
- **111-spec-1-reviewer / 5 / minor — retained.** AC-19 requires characterization against direct construction from identical bytes because regex acceptance alone does not establish the unmeasured CRLF construction outcome.
- **111-spec-1-reviewer / 6 / minor — retained.** Verified boundary-test citations are re-cited as v2, accurate LF/budget-order wording is explicitly kept with reasons, and BR-014 remains out of scope.

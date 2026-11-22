---
id: F-049
title: Secret file BOM refusal
ticket: "#117"
status: frozen
version: 1
---

## Context

The owner decision of 2026-11-20, broadened on 2026-11-21 and confirmed in
[#117's owner decision comment](https://github.com/sstolz/kdrive-mcp-server/issues/117#issuecomment-7077592488)
(recorded 2026-11-22), refuses
U+FEFF anywhere in a selected secret file at startup, with an explicit,
redacted error. A BOM is U+FEFF, encoded as the three bytes `EF BB BF`; it
is not credential padding to remove silently.

On the supplied base main `4032440`, F-047 v1
and BR-026 v2 remove maximal boundary sequences
of SPACE, TAB, CR and LF from all three selected secret files. BOM is outside
that set. `src/config-files.ts` decodes text with fatal UTF-8 and
`ignoreBOM: true`, retaining U+FEFF. The text-secret control check does not
reject U+FEFF. Configuration therefore accepts a BOM-prefixed token today.
Signing files remain opaque during configuration loading; the subsequent
key parser uses a decoder with `ignoreBOM: false` (the default), which drops
one leading U+FEFF; its Unicode-mode PEM regex `\s` also accepts U+FEFF.

The orchestrator reports a bounded synthetic measurement on 2026-11-21 in
the development container, Node v26.13.0: `https.request` with authorization
value `"Bearer \uFEFFSYNTHETIC"` throws synchronously with `TypeError` /
`ERR_INVALID_CHAR` before network access; `new Headers` with that value also
throws `TypeError`. This demonstrates a local header-construction failure,
not an upstream rejection. The current MCP tool-level error was not measured
and is not claimed here. The existing F-047 AC-20 test records BOM-wrapped
signing material being refused locally and accepted in CI, comparing the
loaded result with direct construction instead of demanding one outcome.
The orchestrator's 2026-11-21 direct `loadSigningKey` measurement in the
arm64 development container with OpenSSL 3.5.9 used synthetic PEM P without
trailing LF and B = U+FEFF: P and B+P were accepted; P+B and B+P+B were
refused; P+LF+B was accepted. The trailing BOM, not the leading one, explains
the measured divergence. CI on ubuntu-24.04 x64 accepted B+P+B under F-047
AC-20; individual BOM positions were not measured in CI. This ticket refuses
all file BOM positions before decoding or key parsing, independently of runtime.

The runtime secret-file inventory is unchanged:

| Selector | Loading boundary | New BOM refusal setting |
| --- | --- | --- |
| `KDRIVE_TOKEN_FILE` / `tokenFile` / `--token-file` | `loadSecret`, text | `token` |
| `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` / `oauthUpstreamClientSecretFile` / `--oauth-upstream-client-secret-file` | `loadSecret`, text | `oauthUpstreamClientSecret` |
| `OAUTH_SIGNING_KEY_FILE` / `oauthSigningKeyFile` / `--oauth-signing-key-file` | `loadSigning`, opaque bytes | `oauthSigningKeyFile` |

Compose's host signing-file selector mounts the third source; it is not a
fourth secret reader. The state database, YAML configuration and build/scanner
credentials are not secret-content inputs covered here.

Sources: `src/config.ts`, `src/config-files.ts`, `src/auth/proxy/keys.ts`,
`tests/config.test.ts`, `tests/auth/proxy-construction.test.ts`, F-047 v1,
BR-026 v2, BR-023 v4,
BR-027 v2,
BR-124 v2, and the supplied #117 decision and
measurement. Measurements above are supplied evidence, not commands run by
this author.

This is full-path, security-sensitive work: it changes credential admission
and the startup error catalogue. Fresh strong-tier spec approval followed by
a strongest-tier security decision pass precedes autonomous freeze; equivalent
code reviews precede merge. This document is a draft, not a freeze or approval.
The orchestrator rechecks F-049 and BR-026's current version on main before
freeze and before opening the implementation PR. No new BR ID is required;
BR-436 remains unallocated by this feature.

## Scope

1. Apply one byte-level rule to every selected secret file in the table.
   Complete the existing guarded read and raw-byte limit checks, then search
   the raw bytes for the contiguous sequence `EF BB BF` at any position.
   Any occurrence fails configuration loading with `CREDENTIAL_BOM` and the
   setting above, before UTF-8 decoding, trimming outcome checks, control
   checks or key parsing. Never strip the BOM, retry, fall back to another
   source, or pass this input onward. Scan before F-047 trimming to express
   the raw-file contract directly; trimming never removes BOM bytes, so this
   detects the same occurrences as a post-trim search.
2. Leading, trailing and interior occurrences all fail, including after
   trailing whitespace and between whitespace: `B + X`, `X + B`,
   `X + B + Y`, `X + W + B`, `X + W + B + W`, and `W + B + X + W`,
   where B is `EF BB BF` and W comprises the four padding byte values.
   BOM-only, padded BOM-only and repeated BOMs also fail. A preceding NBSP
   or EM SPACE does not hide a BOM. Partial sequences `EF` or `EF BB` are
   not a BOM; existing validation handles them. UTF-16/UTF-32 markers are
   not added to the recognized set.
3. Text files without `EF BB BF` retain F-047's trim of maximal leading and
   trailing runs of the four byte values `20/09/0D/0A`, fatal UTF-8 decoding,
   nonempty validation and rejection of U+0000–U+001F and U+007F. Other
   Unicode whitespace stays significant. No general non-ASCII credential
   validation or silent repair is introduced.
4. Inline `KDRIVE_TOKEN` and `OAUTH_UPSTREAM_CLIENT_SECRET` are unchanged,
   including leading, middle and terminal U+FEFF. They are not files with an
   encoding preamble. Keep existing byte budgets, empty/control validation
   and significant spaces; never trim or introduce a BOM check on that branch.
   There is no inline signing-key source. Inline token acceptance carries
   the header limitation measured in Context; it is not a successful-use claim.
5. Signing material without BOM remains opaque bytes during configuration
   loading. The raw-byte BOM search precedes any text decoding, PEM parsing,
   key construction, key-derived output or proxy-port use. It refuses BOMs
   before, within or after a valid PEM, including `P + LF + B`, and BOMs
   alongside invalid bytes, with the same configuration error. No BOM ever
   reaches decoding or `createPrivateKey` from a successfully loaded signing
   file. Valid PEM headers, footers and base64 bodies are ASCII and cannot
   contain these bytes, so this preserves valid keys and makes file BOM
   refusal runtime-independent. Direct key-construction callers bypassing
   configuration, parser algorithms, curves, grammar and key strength stay
   unchanged.
6. Preserve BR-023 v4: all raw bytes, including BOM and discarded ASCII
   padding, count toward 16,384 bytes for token/upstream files and 65,536
   for signing files. A BOM cannot rescue an over-limit file. Preserve
   regular-file/no-follow/identity/streaming safeguards and selected-source
   semantics, including configuration validation before credential I/O.
   Existing source order remains token, upstream secret, then signing key;
   an earlier source's failure still prevents reading the later one.
7. Preserve the read machinery's first detected failure; do not invent a
   total precedence between an unreadable file and its unknowable length.
   A detected raw overflow is `LIMIT_EXCEEDED/<file selector>`; an ordinary
   read/open/type/identity failure is `CREDENTIAL_READ_FAILED/<file selector>`.
   Failed reads are never inspected for content. A successfully returned
   oversize buffer fails the raw limit before trim or BOM inspection. Only
   a successfully read, within-budget buffer proceeds to the raw-byte BOM
   search, then trim of maximal boundary runs of `20/09/0D/0A`.
   For text, the order is BOM refusal, trimming, fatal UTF-8 decoding,
   empty-result validation, then ASCII-control validation (the latter three keep
   `CREDENTIAL_INVALID/<logical setting>`). For signing bytes, BOM precedes
   the existing empty-result check; UTF-8/control/PEM checks remain later
   BR-124 parsing rather than new local checks. A BOM-only file therefore
   gives `CREDENTIAL_BOM`, not an empty-credential error.
8. Add exactly one public configuration code, `CREDENTIAL_BOM`. Keep the
   exact message `Configuration error [CREDENTIAL_BOM] (<setting>).` and
   serialization containing only `{code, setting}`. The existing executable
   renders the fixed message plus LF with the existing startup failure exit
   behavior. No diagnostic, log, nested cause, successful-normalization
   message or test title exposes secret content, path, length, trim count,
   BOM offset or count. The error identifies the class of failure, not its
   location in the input. Do not attach decoder, filesystem or parser errors.
9. During implementation, update the two token-file instructions in
   `README.md`; only the credential-contract paragraph in
   `docs/development.md` (currently around lines 346–354); Secrets,
   provisioning step 3 and Troubleshooting in `docs/deployment.md`; and
   signing-key guidance in `docs/oauth-proxy.md`. Document refusal of
   `EF BB BF` anywhere in raw file bytes after read/limit checks and before
   trim of maximal runs of the four byte values `20/09/0D/0A`, the code,
   canonical settings and remediation: save the selected file as UTF-8
   without a BOM, then restart. State that inline values remain unchanged;
   never advise logging, displaying or copying credentials. Remove any
   implication that signing-file BOM admission depends on runtime parsing.
   Keep other Unicode whitespace, raw limits, guarded reads and PKCS#8/P-256
   requirements accurate. In `docs/deployment.md` Troubleshooting, add a
   `[CREDENTIAL_BOM]` bullet beside `[CREDENTIAL_INVALID]` (currently around
   line 678), update the startup-error summary (around line 668), and cite
   F-049 alongside the historical F-002 catalogue without claiming F-002
   lists this new code. `docs/development.md` has no error catalogue.
   Do not rewrite completed F-002 or F-047 or historical acceptance evidence.
   Inspect `SPEC.md` and configuration/example comments for directly
   conflicting guidance; amend only relevant current guidance, without
   changing commands, sources or mounts. No new personal or deployment
   identifiers belong here.
10. In the implementation PR, prepare BR-026 v3 and BR-027 v3, dated history,
    boundary examples and named-test mappings, their rule index, a provisional
    capability entry and an Unreleased changelog entry as pending acceptance.
    BR-026 v2 remains accepted and BR-027 v2 stays active until successful
    acceptance on actual main. BR-027 v3 permits `CREDENTIAL_BOM` in the closed
    diagnostic code set with unchanged redaction rules; follow BR-027's F-048
    v2 history precedent for pending and accepted entries. Update
    `docs/spec-index.md`: allocate F-049, set the next free feature ID to
    F-050, keep BR-436 as the next free BR, and mark BR-026 and BR-027 v3 as
    pending. The Unreleased entry goes under "Changed" with an upgrade note:
    a secret file containing a BOM, including a signing file that loads
    today, now stops startup; re-save it without the BOM (same key and kid).
    The SemVer class is left to the release go. Synchronize
    final active/done markers in the next reviewed PR, as required by
    AGENTS.md. This authoring phase writes only this draft spec. No release,
    VERSION change, unrelated acceptance synchronization or new ADR is needed.

### Out of scope

- Expanding inline validation or imposing a general ByteString/provider
  grammar on credentials; changing direct key-construction callers, Unicode
  trim rules, key formats or cryptographic qualification.
- `scripts/kdrive-acceptance.ts`, which reads `KDRIVE_TOKEN_FILE` directly:
  follow-up issue #127, no milestone.
- Token characters above U+00FF other than U+FEFF, in files and inline, and
  inline (environment) values containing U+FEFF, which F-049 does not refuse:
  follow-up issue #128, owner decision needed, no milestone.
- Changing file budgets, source selection, filesystem safeguards or nonsecret
  inputs; provisioning real credentials, live-provider acceptance or release.
- Characterizing or changing today's MCP tool-level error for a token that
  reaches header construction. The supplied measurement proves only the
  local HTTP API failures; this feature prevents that path for file
  BOMs at any position and makes no tool-error assertion. Such a
  characterization is not a dependency of this bounded startup change.
- Signing files with trailing Unicode whitespace other than U+FEFF (for
  example `P + NBSP`), which the PEM pattern's `\s` accepts and key
  construction then decides; a possible runtime dependence, unmeasured,
  tracked as residual risk in #129, no milestone. Scope 9 guidance stays
  limited to BOMs.

## Business rules

Version the existing guarded-source and diagnostic rules rather than allocating
a new ID.

- **BR-026 v3** — After a selected token, upstream-secret or signing-key file
  passes its unchanged guarded read and raw-byte budget, any raw `EF BB BF`
  sequence refuses startup with `CREDENTIAL_BOM` at `token`,
  `oauthUpstreamClientSecret` or `oauthSigningKeyFile`, respectively, before
  trimming, decoding, empty/control checks or key construction; otherwise
  trim maximal leading/trailing runs of the four byte values `20/09/0D/0A`
  and apply existing content checks, preserving remaining bytes and inline
  credential behavior. Verified by: AC-01–AC-26.
- **BR-027 v3** — The closed configuration diagnostic code set additionally
  permits `CREDENTIAL_BOM` with the fixed message and canonical settings in
  Scope 8; all existing diagnostic shapes, startup warnings and redaction
  rules remain unchanged. Verified by: AC-11, AC-18, AC-23, AC-24, AC-25.
  Prepare the record as pending acceptance in the implementation PR; BR-027 v2
  stays active until acceptance on actual main, following its F-048 history
  precedent.

The purpose remains explicit guarded credential loading. The pending v3 record
must label v2's BOM-acceptance examples as historical and give the new outcomes.
Preserve unchanged boundary coverage and cite current tests as v3; identify
the changed F-047 AC-06, AC-13 and AC-20 BOM rows explicitly rather than
removing their NBSP/EM SPACE cases or rewriting F-047. Keep F-047 AC-23's
BOM acceptance in `BR-026 v2 AC-23 inline credentials remain unchanged`.
Retain the former raw-budget, control, UTF-8 and no-fallback regressions. In `tests/config-value-boundaries.test.ts`, inspect BR-026
citations and update only current-version descriptions and any genuinely
superseded file-BOM assertion, preserving stable test identifiers.

BR-023 v4 is unchanged: byte accounting and limits are identical. BR-027 v3
extends the closed code set with `CREDENTIAL_BOM`, retaining the fixed
diagnostic shape and redaction policy from BR-027 v2 and the F-002 error
contract. BR-124 v2 is unchanged: successful file loading still proves no
key validity, and downstream key qualification is untouched.

## Acceptance criteria

All fixtures are synthetic; use injected readers or temporary test files,
never operator files. Hex denotes exact bytes; `+` denotes concatenation.
`B = EF BB BF`, `X = 53 59 4E 54 48 45 54 49 43` (ASCII `SYNTHETIC`),
`Y = 59`, `W = 20 09 0D 0A`, and `P` is the existing test-only synthetic
PKCS#8 EC P-256 PEM with maximal outer runs of the four byte values
`20/09/0D/0A` removed (no trailing LF). Do not embed or print private-key bytes. `L` is the source's exact raw limit.
For all-source rows use each source in the Context table separately, with
otherwise valid configuration and earlier sources valid. Every listed input
is a separate parameter row, titled with a fixed synthetic label rather than
its content, path or length. Each row below is a Given/When/Then criterion.

Tests-first: the orchestrator characterizes the public configuration and
proxy-construction boundaries on unchanged code before implementation. Record
the passing v2 leading-BOM load and existing runtime-dependent signing
comparison in ticket evidence, then add the fixed v3 assertions and observe
their failures before production changes. Keep historical evidence outside the
repository. These names specify required tests, not executed results.

For AC-01–AC-18 and AC-26, use `tests/config.test.ts`. Exact names are
`BR-026 v3 F-049 AC-NN <label>`, except AC-11 and AC-18 use
`BR-026 v3 BR-027 v3 F-049 AC-NN <label>`; rows also verify the other BRs listed.
The two AC-15 rows that run key construction (`FF FE + P`, `FE FF + P`) go
instead in `tests/auth/proxy-construction.test.ts`, named
`BR-026 v3 BR-124 v2 F-049 AC-15 <label>`.

| AC / BRs | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-01 / BR-026 v3 | Token file `B + X` | Configuration loads | `CREDENTIAL_BOM/token`; no loaded configuration or fallback | token leading BOM |
| AC-02 / BR-026 v3 | Upstream-secret file `B + X` | Configuration loads | `CREDENTIAL_BOM/oauthUpstreamClientSecret`; signing file not read | upstream leading BOM |
| AC-03 / BR-026 v3 | Signing file `B + P`, also `B + FF 00` | Configuration loads | `CREDENTIAL_BOM/oauthSigningKeyFile`; no key parsing | signing leading BOM |
| AC-04 / BR-026 v3 | Each file: `20 20 + B + X`, `B + 20 20 + X`, `W + B + X + W` | Configuration loads | Source-specific `CREDENTIAL_BOM` before trimming or validation | raw BOM before trim |
| AC-05 / BR-026 v3 | Each file: `B`, `W + B + W`, `B + B + X` | Configuration loads | `CREDENTIAL_BOM`, never empty-result error or BOM removal | BOM only and repeated occurrences |
| AC-06 / BR-026 v3 | Each of the three files: `X + B`, `X + B + Y`, `X + W + B`, `X + W + B + W`, `W + X + B + W` | Configuration loads | Source-specific `CREDENTIAL_BOM`; trailing, interior, after-whitespace and between-whitespace positions all refused | all file BOM positions refused |
| AC-07 / BR-026 v3 | Each of the three files: `C2 A0 + B + X`, `E2 80 83 + B + X` | Configuration loads | Source-specific `CREDENTIAL_BOM` despite preceding NBSP/EM SPACE | nontrim prefix cannot hide BOM |
| AC-08 / BR-026 v3 | Each inline text source: `B + X`, `X + B + Y`, `X + B`, `20 + B + X + 20`, expressed as their Unicode environment strings | Configuration loads | Exact strings retained; no file BOM check, trim or file read for that source | inline BOM remains significant |
| AC-09 / BR-026 v3, BR-023 v4 | Each file: `B + (78 repeated L-3)` (L bytes), then `B + (78 repeated L-2)` (L+1 bytes) | Reader returns bytes and configuration loads | Exact limit gives `CREDENTIAL_BOM/<logical setting>`; overflow gives `LIMIT_EXCEEDED/<file selector>` | raw limit before BOM |
| AC-10 / BR-026 v3, BR-023 v4 | Each file: `W + B + (20 repeated L-6)` (L+1 raw bytes) | Configuration loads | `LIMIT_EXCEEDED/<file selector>` despite removable padding | padding and BOM count toward limit |
| AC-11 / BR-026 v3, BR-027 v3 | Selected reader throws an ordinary error whose synthetic message contains `EF BB BF` decoded as U+FEFF | Configuration loads | `CREDENTIAL_READ_FAILED/<file selector>`; no content inspection or cause leak | read failure before BOM |
| AC-12 / BR-026 v3 | Each text file: `B + FF`, `B + 00`, `W + B + FF 00 + W` | Configuration loads | `CREDENTIAL_BOM` wins over malformed UTF-8 or ASCII controls | BOM before text validation |
| AC-13 / BR-026 v3 | Each text file: `EF`, `EF BB`, `FF FE 78 00`, `FF`, `78 00`, `78 09 79` | Configuration loads | `CREDENTIAL_INVALID/<logical setting>`; partial/other markers not misclassified as BOM | other invalid text unchanged |
| AC-14 / BR-026 v3 | Each file: zero bytes, `W`; each text file also `W + X + W`, `58 20 59` | Configuration loads | Empty results give `CREDENTIAL_INVALID`; text results are SYNTHETIC and the three ASCII characters U+0058, SPACE, U+0059 respectively | empty and ASCII trim unchanged |
| AC-15 / BR-026 v3 | Signing file `FF 00 0A`, also `EF BB` | Configuration loads without proxy construction | Opaque bytes `FF 00` and `EF BB` retained; no local UTF-8 or control check | opaque signing bytes unchanged |
| AC-15 / BR-026 v3, BR-124 v2 | Signing file `FF FE + P` | Configuration loads, then key construction runs | Opaque bytes unchanged; no `CREDENTIAL_BOM`; existing BR-124 refusal at key construction | UTF-16LE marker stays opaque |
| AC-15 / BR-026 v3, BR-124 v2 | Signing file `FE FF + P` | Configuration loads, then key construction runs | Opaque bytes unchanged; no `CREDENTIAL_BOM`; existing BR-124 refusal at key construction | UTF-16BE marker stays opaque |
| AC-16 / BR-026 v3 | Invalid drive ID `0` with selected file `B + X`; separately conflicting inline/file selectors with that fixture | Configuration loads | Existing `INVALID_VALUE/driveId` or selector-conflict error wins; zero credential reads | configuration errors before reads |
| AC-17 / BR-026 v3 | Valid higher-priority inline X and unselected lower-priority file fixture `B + X`; separately selected token `B + X` with valid lower-priority source | Configuration loads | First case retains X without reading the file; second refuses with `CREDENTIAL_BOM/token` without fallback | selection and no fallback unchanged |
| AC-18 / BR-026 v3, BR-027 v3 | Each selected file with `B + X`, `W + B + X + W`, `B + B + X`; synthetic selector path and reader-error canaries | Configuration loads and error is serialized | Exactly `{code:"CREDENTIAL_BOM",setting:<canonical setting>}` and fixed message; no extra enumerable data/cause or console logging; content/path/length/trim/BOM position absent | fixed BOM diagnostics |
| AC-26 / BR-026 v3 | YAML configuration file starting with `EF BB BF`, otherwise valid, with no secret file selected | Configuration loads | Same outcome (loaded values, or error code and setting) as on main 4032440; never `CREDENTIAL_BOM`. Characterization test written and run on the base before the change | YAML config BOM unchanged |

For AC-19–AC-22, use `tests/auth/proxy-construction.test.ts`, exact names
`BR-026 v3 BR-124 v2 F-049 AC-NN <label>`. Drive actual configuration file
loading; never substitute a new standalone BOM helper for that boundary.

| AC / BRs | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-19 / BR-026 v3, BR-124 v2 | Signing file `B + P`, `B + P + B`, `W + B + P + W`; continuation instrumented to fail if called | Load configuration then construct proxy only on success, in local gate and CI | `CREDENTIAL_BOM/oauthSigningKeyFile`; parser/key construction and all proxy ports called zero times | BOM refuses before construction |
| AC-20 / BR-026 v3, BR-124 v2 | Signing file `P + B`, P with B after its first base64 byte, `P + W + B`, `P + W + B + W`, `P + 0A + B` | Load configuration then construct proxy only on success, in local gate and CI | Every row gives `CREDENTIAL_BOM/oauthSigningKeyFile` before decoding or parsing; continuation and all proxy ports called zero times | signing suffix and interior BOM refused |
| AC-21 / BR-026 v3, BR-124 v2 | Signing file `W + P + W` | Configuration loads then proxy construction runs | Loaded bytes equal P, construction succeeds with P's kid and no upstream-port use | valid signing padding unchanged |
| AC-22 / BR-026 v3, BR-124 v2 | Existing synthetic RSA, P-384, Ed25519, public PEM, two-block and corrupt PKCS#8 fixtures, each wrapped only in W, without B anywhere | Configuration loads then proxy construction runs | Existing fixed key-qualification refusal remains; no BOM code substitutes for invalid-key parsing | key qualification unchanged |

AC-19 and AC-20 replace only the U+FEFF row of F-047 AC-20's
`BR-026 v2 BR-124 v2 AC-20 signing nontrimmed Unicode` loaded-versus-direct
comparison with unconditional `CREDENTIAL_BOM/oauthSigningKeyFile` before
construction. NBSP and EM SPACE rows retain their unchanged byte-preservation
and parser-refusal assertions. Instrument the zero-call boundary with a spy
or failing continuation and inspect that the raw search is in configuration
loading. Running fixed assertions locally and in CI supplies runtime evidence;
refusal before decoding or crypto explains runtime independence. Direct
construction of BOM bytes remains outside this rule.

- **AC-23 (BR-026 v3, BR-027 v3)** — Given a temporary token file containing
  `W + B + X + W` and otherwise valid synthetic startup configuration, When
  the configuration diagnostic executable runs through the existing CLI
  harness, Then it exits with the existing configuration failure status and
  emits exactly `Configuration error [CREDENTIAL_BOM] (token).` plus LF,
  with no stack, content or path. Verify in `tests/cli.test.ts`,
  `BR-026 v3 BR-027 v3 F-049 AC-23 CLI BOM refusal is redacted`.
- **AC-24 (BR-026 v3, BR-023 v4, BR-027 v3)** — Given actual synthetic files
  containing `B + X` for each secret kind, When the existing missing-file,
  nonregular-file, final-symlink, identity-change and streaming-overflow
  harness cases execute, Then existing guarded-read identities remain
  `CREDENTIAL_READ_FAILED/<file selector>` or
  `LIMIT_EXCEEDED/<file selector>` as applicable, without inspecting a failed
  read for BOM. Parent symlinks remain allowed, so a stable regular target
  containing `B + X` instead reaches `CREDENTIAL_BOM/<logical setting>`.
  Adapt and retain `tests/config.test.ts` coverage under
  `BR-026 v3 BR-027 v3 F-049 AC-24 guarded reads precede BOM inspection`; do not remove
  a security assertion to make the new BOM cases pass.
- **AC-25 (BR-026 v3, BR-027 v3; documentation)** — Given Scope 9's guidance
  and fixtures `B + X`, `X + B`, `X + B + Y`, `X + W + B + W`,
  `P + 0A + B` and inline U+FEFF followed by X, When the
  orchestrator runs the scoped documentation check recorded as
  `117-docs-1-orchestrator`, Then the deployment Troubleshooting startup
  summary (around line 668) names `[CREDENTIAL_BOM]`, and a new bullet beside
  `[CREDENTIAL_INVALID]` (around line 678) gives the exact fixed message,
  all three canonical settings, raw-byte anywhere refusal and UTF-8-without-BOM
  remediation. The development credential-contract paragraph (around lines
  346–354) states that same read/limit-before-BOM-before-trim order and
  unchanged inline behavior; it gains no error catalogue. Other Scope 9
  guidance agrees, signing notes do not delegate BOM admission to parsing,
  and completed F-002/F-047 remain unchanged. The deployment summary cites
  this extension without claiming the historical F-002 catalogue includes it.
  The orchestrator runs and records these exact scoped content commands,
  then checks the matched guidance against the requirements above:

  ```sh
  git grep -n -F CREDENTIAL_BOM -- README.md docs/development.md docs/deployment.md docs/oauth-proxy.md
  git grep -n -F CREDENTIAL_BOM -- SPEC.md
  ```

  A missing match in `SPEC.md` is permitted when no directly conflicting
  guidance required an amendment. The Makefile has no link-check target;
  record that limitation and inspect links in the scoped guidance manually.
  Record scoped content, link inspection and formatting checks under
  `117-docs-1-orchestrator`; this is an orchestrator-run documentation check
  with no test name or prose unit test.

The orchestrator runs the Docker-only full gate, mandatory PR CI and fresh
independent reviews; no tests, package commands or Docker commands run in this
spec-authoring phase. Acceptance repeats the scoped ACs on the actual merged
main SHA, records commands/results/SHA and exposed token counters in #117,
then closes only on success. No real credential or provider call is needed.

## Decisions

- **Dedicated `CREDENTIAL_BOM`, rather than `CREDENTIAL_INVALID` plus docs.**
  A distinct code gives an explicit, actionable cause while keeping the exact
  code-and-setting-only message. Reusing `CREDENTIAL_INVALID` would minimize
  public-contract cost, but conflate BOM, empty text, malformed UTF-8 and
  controls, requiring operators to guess among those causes. Accept the
  bounded additive cost: one code in the type/catalogue, focused error/CLI
  assertions and the listed guidance updates. No arbitrary reason string or
  additional diagnostic field is added. Clients enumerating codes need to
  recognize this new startup code; this public extension is intentional.
- **Search raw bytes anywhere after read and limit checks.** This directly
  expresses the selected-file contract and precedes all content handling.
  Searching after the trim of maximal runs of the four byte values
  `20/09/0D/0A` would find the same occurrences, since trim cannot remove
  any BOM byte, but adds an unnecessary dependency on normalization.
  Reject leading-only refusal: the measured divergence comes from the
  trailing BOM and interior U+FEFF can also break token headers. Reject
  leading-plus-trailing-suffix checks: interior occurrences and BOMs between
  whitespace would remain. Include the measured accepted `P + LF + B` in
  fixed refusal coverage as well.
  Reject accepting residual file-BOM risk: an anywhere search is bounded,
  explicit and removes runtime divergence without excluding valid ASCII PEM.
  Reject stripping BOM anywhere, which silently changes credential values.
- **Preserve inline U+FEFF.** Inline values have no file encoding preamble and
  remain outside this file-admission decision. Their byte budgets and
  validation remain unchanged; inline token transport compatibility is not
  claimed. Broader token character policy, including inline U+FEFF, is tracked
  separately in #128.
- **Check signing bytes before parsing.** No file BOM reaches the decoder or
  `createPrivateKey`; valid PEM headers, footers and base64 bodies are ASCII.
  This fixes the configuration outcome without changing direct parser callers
  or general key qualification.
- **Keep read and budget precedence.** Early content inspection of partial
  reads would change guarded-read failure identities and might mask a raw
  overflow. Only a successful bounded read can be inspected. Do not weaken
  byte accounting to discount BOM or padding.
- **Threat analysis.** Refusing file BOMs anywhere changes startup admission rather
  than repairing secret bytes. No request, key-derived result or signing
  operation may occur from a refused configuration. Raw memory/read budgets,
  source conflicts, no-fallback behavior, redaction and cryptographic
  qualification stay intact. The code discloses only the intended BOM failure
  class and canonical setting; no content, offset, count or source path is
  logged. Inline behavior is an explicit scope boundary,
  not evidence of transport compatibility.
- **Accept the compatibility break.** A signing file `B + P` constructs
  successfully today and stops startup after the upgrade. This is the
  intended outcome of the owner decision: one result in every runtime. The
  changelog states it under "Changed" with the re-save upgrade note.
- **BR-026 v3 and BR-027 v3, no new BR or ADR.** The guarded-source and
  diagnostic purposes are unchanged; admission tightens file BOM handling and
  BR-027 v3 permits its new error identity in the closed code set with unchanged
  redaction rules. Keep the existing budgets and downstream key rules under
  their current versions; BR-027 v2 stays active until acceptance. Reject
  allocating BR-436 for the same purpose.

## Open questions

None.

## Stress-test

- **117-spec-review-1-opus — finding 1 — major — retained.** The broadened
  anywhere decision replaces the leading-only policy. Raw bytes are searched
  after read/limit checks; position cases and precedence are explicit. Context
  records the decoder/regex behavior and supplied per-position measurement;
  only F-047 AC-20's BOM row changes, preserving NBSP/EM SPACE rows. Rejected
  alternatives and unchanged inline handling are recorded in Decisions.
- **117-spec-review-1-opus — finding 2 — major — retained.** Scope 9 and AC-25
  target the deployment Troubleshooting summary and adjacent code bullet,
  and only the development credential-contract paragraph. The historical
  F-002 catalogue is not rewritten.
- **117-spec-review-1-opus — finding 3 — minor — retained.** Trim wording now
  means maximal runs of the four byte values `20/09/0D/0A`, not four bytes
  total; the raw BOM search precedes this unchanged normalization.
- **117-spec-review-1-opus — finding 4 — minor — retained.** The unchanged
  inline reference explicitly names F-047 AC-23 and its exact existing test,
  avoiding confusion with this feature's CLI AC-23.
- **117-spec-review-1-opus — finding 5 — minor — retained.** The acceptance
  script's direct token-file reader is explicitly out of scope under #127,
  with no milestone, rather than implicitly covered by configuration loading.
- **117-spec-review-1-opus — finding 6 — minor — retained.** Token characters
  above U+00FF other than U+FEFF, in files and inline, remain out of scope
  under #128, with owner decision needed and no milestone. This does not
  weaken the anywhere-file-U+FEFF refusal selected for #117.
- **117-spec-review-2-opus — finding 1 — major — retained.** BR-027 v3 permits the new closed-set code with unchanged redaction; its pending record belongs in the implementation PR and v2 stays active until acceptance.
- **117-spec-review-2-opus — finding 2 — minor — retained.** Inline U+FEFF remains unrefused by F-049 and is explicitly tracked in #128.
- **117-spec-review-2-opus — finding 3 — minor — retained.** Context cites the owner decision comment recorded on 2026-11-22 confirming the 2026-11-21 broadening.
- **117-spec-review-2-opus — finding 4 — minor — retained.** AC-25 names the orchestrator evidence and exact content commands, records the absent Makefile link target and has no test name.
- **117-spec-review-2-opus — finding 5 — minor — retained.** AC-15 preserves both UTF-16 marker prefixes as opaque bytes before the existing BR-124 key-construction refusal.
- **117-spec-review-3-opus — residual — minor — retained.** The two UTF-16 AC-15 rows get distinct labels and live in `tests/auth/proxy-construction.test.ts`, since they run key construction.
- **117-spec-decision-1-fable — finding 1 — minor — retained.** Scope 10 now updates `docs/spec-index.md` (F-049 allocated, next free F-050, BR-436 free, BR-026/BR-027 v3 pending).
- **117-spec-decision-1-fable — finding 2 — minor — retained.** Decisions state the `B + P` signing-file compatibility break; the changelog entry goes under "Changed" with a re-save upgrade note; SemVer left to the release go.
- **117-spec-decision-1-fable — finding 3 — minor — retained.** Trailing non-BOM Unicode whitespace in signing files is an explicit out-of-scope residual risk, tracked in #129; Scope 9 stays BOM-only.
- **117-spec-decision-1-fable — finding 4 — minor — retained.** AC-26 pins by characterization that a YAML configuration file starting with `EF BB BF` behaves as on main 4032440.

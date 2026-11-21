---
id: F-049
title: Secret file BOM refusal
ticket: "#117"
status: draft
version: 1
---

## Context

The owner decision of 2026-11-20 (#117) refuses a leading UTF-8 byte-order
mark in a secret file at startup, with an explicit, redacted error. A BOM is
U+FEFF, encoded as the three bytes `EF BB BF`; it is not credential padding
to remove silently.

On the supplied base main `4032440`, [F-047 v1](F-047-secret-file-surrounding-whitespace.md)
and [BR-026 v2](../business-rules/BR-026.md) remove maximal boundary sequences
of SPACE, TAB, CR and LF from all three selected secret files. BOM is outside
that set. `src/config-files.ts` decodes text with fatal UTF-8 and
`ignoreBOM: true`, retaining U+FEFF. The text-secret control check does not
reject U+FEFF. Configuration therefore accepts a BOM-prefixed token today.
Signing files remain opaque during configuration loading; the subsequent
key parser has a separate decoder and PEM grammar.

The orchestrator reports a bounded synthetic measurement on 2026-11-21 in
the development container, Node v26.13.0: `https.request` with authorization
value `"Bearer \uFEFFSYNTHETIC"` throws synchronously with `TypeError` /
`ERR_INVALID_CHAR` before network access; `new Headers` with that value also
throws `TypeError`. This demonstrates a local header-construction failure,
not an upstream rejection. The current MCP tool-level error was not measured
and is not claimed here. The existing F-047 AC-20 test records BOM-wrapped
signing material being refused locally and accepted in CI, comparing the
loaded result with direct construction instead of demanding one outcome.
This ticket moves the leading-BOM refusal before either downstream operation.

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
BR-026 v2, [BR-023 v4](../business-rules/BR-023.md),
[BR-027 v2](../business-rules/BR-027.md),
[BR-124 v2](../business-rules/BR-124.md), and the supplied #117 decision and
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

1. Apply one byte-level leading-BOM rule to every selected secret file in the
   table. Complete the existing guarded, raw-bounded read, apply F-047's
   maximal four-byte boundary trim, then inspect the first three remaining
   bytes. If they are exactly `EF BB BF`, fail configuration loading with
   `CREDENTIAL_BOM` and the setting above. Never strip the BOM, decode to
   detect it, retry, fall back to another source, or pass this input onward.
   Checking after trimming also catches a BOM at raw offset zero, since BOM
   is not trimmed. No additional pre-trim scan is needed.
2. The rule is a prefix check, not a search. `EF BB BF 78`,
   `20 20 EF BB BF 78`, `EF BB BF 20 20 78`, and
   `20 09 EF BB BF 78 0D 0A` all fail. `EF BB BF` alone, a padded BOM alone,
   and repeated leading BOMs fail too. `78 EF BB BF` and `78 EF BB BF 79`
   are outside this refusal, even when trailing ASCII padding follows them.
   A nontrim byte before the BOM stops the trim: `C2 A0 EF BB BF 78` has
   no leading BOM under this rule. Partial prefixes `EF` or `EF BB` are not
   a BOM; existing validation handles them. UTF-16/UTF-32 markers are not
   added to the recognized set.
3. Text files without that prefix keep fatal UTF-8 decoding, nonempty
   validation and rejection of U+0000–U+001F and U+007F. Middle/end U+FEFF
   remains significant and accepted by configuration when other checks pass.
   This is deliberately a file-preamble policy, not a complete HTTP-header
   character policy. U+FEFF anywhere in a kDrive token cannot be represented
   by the header paths described above; accepting a nonleading occurrence
   locally does not establish that requests will work. An upstream client
   secret is passed as a form field through the proxy's existing upstream
   port, not as this kDrive Bearer header; changing its opaque interior value
   is not justified by the token-header constraint. Do not silently repair
   either value or add general non-ASCII credential validation here.
4. Inline `KDRIVE_TOKEN` and `OAUTH_UPSTREAM_CLIENT_SECRET` are unchanged,
   including leading, middle and terminal U+FEFF. They are not files with an
   encoding preamble. Keep existing byte budgets, empty/control validation
   and significant spaces; never trim or introduce a BOM check on that branch.
   There is no inline signing-key source. Inline token acceptance carries
   the same header limitation just stated; it is not a successful-use claim.
5. Signing material remains opaque bytes during configuration loading. The
   prefix check precedes any text decoding, PEM parsing, key construction,
   key-derived output or proxy-port use. It refuses a BOM-prefixed valid PEM
   and a BOM-prefixed invalid byte sequence with the same configuration error,
   independently of runtime parser behavior. A BOM inside the PEM or after
   its closing delimiter remains unchanged locally and reaches the existing
   BR-124 v2 parser. Its success or fixed signing-key refusal remains that
   parser's contract; no cross-runtime equality is promised for these
   nonleading cases or for callers bypassing configuration loading. No
   parser, algorithm, curve, PEM grammar or key-strength change is included.
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
   a successfully read, within-budget buffer proceeds to trim, then BOM.
   For text, BOM refusal precedes fatal UTF-8 decoding, then empty-result
   validation, then ASCII-control validation (the latter three keep
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
   `README.md`; the credential contract and current error catalogue in
   `docs/development.md`; Secrets, provisioning step 3 and Troubleshooting
   in `docs/deployment.md`; and signing-key guidance in `docs/oauth-proxy.md`.
   Document the three-byte prefix after the exact four-byte trim, the code
   and canonical settings, and remediation: save the selected file as UTF-8
   without a BOM, then restart. Distinguish unchanged middle/end and inline
   handling; never advise logging, displaying or copying credentials.
   Remove the signing guidance's implication that leading BOM behavior is
   left to its decoder. Keep other Unicode whitespace, raw limits, guarded
   reads and PKCS#8/P-256 requirements accurate. Add a current catalogue row
   for this code and link this spec alongside F-002 from troubleshooting,
   because F-002's completed catalogue does not contain this extension.
   Do not rewrite completed F-002 or F-047 or historical acceptance evidence.
   Inspect `SPEC.md` and configuration/example comments for directly conflicting
   guidance; amend only relevant current guidance, without changing commands,
   sources or mounts. No new personal or deployment identifiers belong here.
10. In the implementation PR, prepare BR-026 v3, dated history, boundary
    examples and named-test mapping, its rule index, a provisional capability
    entry and an Unreleased changelog entry as pending acceptance. BR-026 v2
    remains accepted until successful acceptance on actual main. Synchronize
    final active/done markers in the next reviewed PR, as required by
    AGENTS.md. This authoring phase writes only this draft spec. No release,
    VERSION change, unrelated acceptance synchronization or new ADR is needed.

### Out of scope

- Rejecting U+FEFF at every position, expanding inline validation or imposing
  a general ByteString/provider grammar on credentials.
- Changing nonleading signing BOM handling, direct key-construction callers,
  Unicode trim rules, key formats or cryptographic qualification.
- Changing file budgets, source selection, filesystem safeguards or nonsecret
  inputs; provisioning real credentials, live-provider acceptance or release.
- Characterizing or changing today's MCP tool-level error for a token that
  reaches header construction. The supplied measurement proves only the
  local HTTP API failures; this feature prevents that path for leading file
  BOMs and makes no tool-error assertion. Such a characterization is not a
  dependency of this bounded startup change.

## Business rules

Version the existing guarded-source rule rather than allocating a new ID.

- **BR-026 v3** — After a selected token, upstream-secret or signing-key file
  passes its unchanged raw byte budget and guarded read, its maximal boundary
  sequences of bytes `20`, `09`, `0D`, `0A` are removed; a remaining prefix
  `EF BB BF` refuses startup with `CREDENTIAL_BOM` at `token`,
  `oauthUpstreamClientSecret` or `oauthSigningKeyFile`, respectively, before
  decoding or key construction; otherwise the existing empty/content checks
  follow, with all remaining bytes and inline credential behavior preserved.
  Verified by: AC-01–AC-25.

The purpose remains explicit guarded credential loading. The pending v3 record
must label v2's BOM-acceptance examples as historical and give the new outcomes.
Preserve unchanged boundary coverage and cite current tests as v3; identify
the changed F-047 AC-06, AC-13 and AC-20 BOM rows explicitly rather than
removing their NBSP/EM SPACE cases or rewriting F-047. Keep inline AC-23's
BOM acceptance. Retain the former raw-budget, control, UTF-8 and no-fallback
regressions. In `tests/config-value-boundaries.test.ts`, inspect BR-026
citations and update only current-version descriptions and any genuinely
superseded leading-file-BOM assertion, preserving stable test identifiers.

BR-023 v4 is unchanged: byte accounting and limits are identical. BR-027 v2
is unchanged: the fixed diagnostic shape and redaction policy hold; this
feature adds a permitted code through BR-026 v3 and this additive error
catalogue. BR-124 v2 is unchanged: successful file loading still proves no
key validity, and downstream key qualification is untouched.

## Acceptance criteria

All fixtures are synthetic; use injected readers or temporary test files,
never operator files. Hex denotes exact bytes; `+` denotes concatenation.
`B = EF BB BF`, `X = 53 59 4E 54 48 45 54 49 43` (ASCII `SYNTHETIC`),
`Y = 59`, `W = 20 09 0D 0A`, and `P` is the existing test-only synthetic
PKCS#8 EC P-256 PEM with only its outer four-byte padding removed. Do not
embed or print private-key bytes. `L` is the source's exact raw limit.
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

For AC-01–AC-18, use `tests/config.test.ts`. Exact names are
`BR-026 v3 F-049 AC-NN <label>`; rows also verify the unchanged BRs listed.

| AC / BRs | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-01 / BR-026 v3 | Token file `B + X` | Configuration loads | `CREDENTIAL_BOM/token`; no loaded configuration or fallback | token leading BOM |
| AC-02 / BR-026 v3 | Upstream-secret file `B + X` | Configuration loads | `CREDENTIAL_BOM/oauthUpstreamClientSecret`; signing file not read | upstream leading BOM |
| AC-03 / BR-026 v3 | Signing file `B + P`, also `B + FF 00` | Configuration loads | `CREDENTIAL_BOM/oauthSigningKeyFile`; no key parsing | signing leading BOM |
| AC-04 / BR-026 v3 | Each file: `20 20 + B + X`, `B + 20 20 + X`, `W + B + X + W` | Configuration loads | Same source-specific `CREDENTIAL_BOM` as a raw leading BOM | trim precedes prefix check |
| AC-05 / BR-026 v3 | Each file: `B`, `W + B + W`, `B + B + X` | Configuration loads | `CREDENTIAL_BOM`, never empty-result error or BOM removal | BOM only and repeated prefix |
| AC-06 / BR-026 v3 | Each text file: `X + B`, `X + B + Y`, `W + X + B + W` | Configuration loads | Exact decoded text after four-byte trim is retained and accepted | text nonleading BOM preserved |
| AC-07 / BR-026 v3 | Each text file: `C2 A0 + B + X`, `E2 80 83 + B + X` | Configuration loads | NBSP/EM SPACE stops trim; exact text retained and accepted | nontrim prefix stops BOM rule |
| AC-08 / BR-026 v3 | Each inline text source: `B + X`, `X + B + Y`, `X + B`, `20 + B + X + 20`, expressed as their Unicode environment strings | Configuration loads | Exact strings retained; no file-prefix check, trim or file read for that source | inline BOM remains significant |
| AC-09 / BR-026 v3, BR-023 v4 | Each file: `B + (78 repeated L-3)` (L bytes), then `B + (78 repeated L-2)` (L+1 bytes) | Reader returns bytes and configuration loads | Exact limit gives `CREDENTIAL_BOM/<logical setting>`; overflow gives `LIMIT_EXCEEDED/<file selector>` | raw limit before BOM |
| AC-10 / BR-026 v3, BR-023 v4 | Each file: `W + B + (20 repeated L-6)` (L+1 raw bytes) | Configuration loads | `LIMIT_EXCEEDED/<file selector>` despite removable padding | padding and BOM count toward limit |
| AC-11 / BR-026 v3, BR-027 v2 | Selected reader throws an ordinary error whose synthetic message contains `EF BB BF` decoded as U+FEFF | Configuration loads | `CREDENTIAL_READ_FAILED/<file selector>`; no content inspection or cause leak | read failure before BOM |
| AC-12 / BR-026 v3 | Each text file: `B + FF`, `B + 00`, `W + B + FF 00 + W` | Configuration loads | `CREDENTIAL_BOM` wins over malformed UTF-8 or ASCII controls | BOM before text validation |
| AC-13 / BR-026 v3 | Each text file: `EF`, `EF BB`, `FF FE 78 00`, `FF`, `78 00`, `78 09 79` | Configuration loads | `CREDENTIAL_INVALID/<logical setting>`; partial/other markers not misclassified as BOM | other invalid text unchanged |
| AC-14 / BR-026 v3 | Each file: zero bytes, `W`; each text file also `W + X + W`, `58 20 59` | Configuration loads | Empty results give `CREDENTIAL_INVALID`; text results are SYNTHETIC and the three ASCII characters U+0058, SPACE, U+0059 respectively | empty and ASCII trim unchanged |
| AC-15 / BR-026 v3 | Signing file `FF 00 0A`, also `EF BB` | Configuration loads without proxy construction | Opaque bytes `FF 00` and `EF BB` retained; no local UTF-8 or control check | opaque signing bytes unchanged |
| AC-16 / BR-026 v3 | Invalid drive ID `0` with selected file `B + X`; separately conflicting inline/file selectors with that fixture | Configuration loads | Existing `INVALID_VALUE/driveId` or selector-conflict error wins; zero credential reads | configuration errors before reads |
| AC-17 / BR-026 v3 | Valid higher-priority inline X and unselected lower-priority file fixture `B + X`; separately selected token `B + X` with valid lower-priority source | Configuration loads | First case retains X without reading the file; second refuses with `CREDENTIAL_BOM/token` without fallback | selection and no fallback unchanged |
| AC-18 / BR-026 v3, BR-027 v2 | Each selected file with `B + X`, `W + B + X + W`, `B + B + X`; synthetic selector path and reader-error canaries | Configuration loads and error is serialized | Exactly `{code:"CREDENTIAL_BOM",setting:<canonical setting>}` and fixed message; no extra enumerable data/cause or console logging; content/path/length/trim/BOM position absent | fixed BOM diagnostics |

For AC-19–AC-22, use `tests/auth/proxy-construction.test.ts`, exact names
`BR-026 v3 BR-124 v2 F-049 AC-NN <label>`. Drive actual configuration file
loading; never substitute a new standalone prefix helper for that boundary.

| AC / BRs | Given | When | Then | Test label |
| --- | --- | --- | --- | --- |
| AC-19 / BR-026 v3, BR-124 v2 | Signing file `B + P + B`, also `W + B + P + W`; key-construction continuation instrumented to fail if called | Load configuration then construct proxy only on success, in local gate and CI | Both reject with `CREDENTIAL_BOM/oauthSigningKeyFile` before continuation; parser/key construction and all proxy ports called zero times, regardless of whether the runtime would accept this PEM | leading BOM refuses before construction |
| AC-20 / BR-026 v3, BR-124 v2 | Signing file `P + B`; separately P with B inserted after the first base64 byte of its first body line | Configuration loads then proxy construction runs | Loaded bytes equal exact input; outcome equals direct construction from identical bytes in that runtime: same kid on success or existing fixed `SIGNING_KEY_ERROR` on refusal; no new BOM configuration error | nonleading signing BOM preserved |
| AC-21 / BR-026 v3, BR-124 v2 | Signing file `W + P + W` | Configuration loads then proxy construction runs | Loaded bytes equal P, construction succeeds with P's kid and no upstream-port use | valid signing padding unchanged |
| AC-22 / BR-026 v3, BR-124 v2 | Existing synthetic RSA, P-384, Ed25519, public PEM, two-block and corrupt PKCS#8 fixtures, each wrapped only in W, without a leading B | Configuration loads then proxy construction runs | Existing fixed key-qualification refusal remains; no BOM code substitutes for invalid-key parsing | key qualification unchanged |

AC-19 replaces F-047 AC-20's leading-BOM loaded-versus-direct comparison
with an unconditional pre-construction refusal. Retain the separate NBSP and
EM SPACE rows and their unchanged parser assertions. The implementation must
demonstrate the zero-call boundary (a spy or failing continuation) as well as
inspect that the byte check is in configuration loading, not runtime crypto.
Running the same fixed assertion locally and in CI supplies runtime evidence;
the earlier boundary supplies the reason it does not depend on decoder or
crypto behavior. Direct construction of BOM bytes remains outside this rule.

- **AC-23 (BR-026 v3, BR-027 v2)** — Given a temporary token file containing
  `W + B + X + W` and otherwise valid synthetic startup configuration, When
  the configuration diagnostic executable runs through the existing CLI
  harness, Then it exits with the existing configuration failure status and
  emits exactly `Configuration error [CREDENTIAL_BOM] (token).` plus LF,
  with no stack, content or path. Verify in `tests/cli.test.ts`,
  `BR-026 v3 BR-027 v2 F-049 AC-23 CLI BOM refusal is redacted`.
- **AC-24 (BR-026 v3, BR-023 v4, BR-027 v2)** — Given actual synthetic files
  containing `B + X` for each secret kind, When the existing missing-file,
  nonregular-file, final-symlink, identity-change and streaming-overflow
  harness cases execute, Then existing guarded-read identities remain
  `CREDENTIAL_READ_FAILED/<file selector>` or
  `LIMIT_EXCEEDED/<file selector>` as applicable, without inspecting a failed
  read for BOM. Parent symlinks remain allowed, so a stable regular target
  containing `B + X` instead reaches `CREDENTIAL_BOM/<logical setting>`.
  Adapt and retain `tests/config.test.ts` coverage under
  `BR-026 v3 F-049 AC-24 guarded reads precede BOM inspection`; do not remove
  a security assertion to make the new prefix cases pass.
- **AC-25 (BR-026 v3, BR-027 v2; documentation)** — Given the current guidance
  listed in Scope 9 and fixtures `20 20 + B + X`, `B + 20 20 + X`,
  `X + B`, and inline U+FEFF followed by X, When scoped content/link review
  checks that guidance against this spec, Then every relevant current page
  states the post-trim leading-file refusal and `CREDENTIAL_BOM` remediation,
  without claiming all U+FEFF or inline values are refused. The current
  catalogue names all three canonical settings and the exact fixed message;
  troubleshooting links the extension, and signing notes no longer delegate
  leading BOM admission to runtime parsing. Verify by scoped content/link
  and formatting checks run by the orchestrator, recorded as
  `117-docs-1-orchestrator`; no unit test is required for prose.

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
- **One check after F-047 trimming.** This catches both raw-leading and
  ASCII-padding-hidden BOMs without changing the trim set. Raw-only checking
  would let `20 20 EF BB BF 78` reach the runtime. Two checks give no additional
  coverage because the trim never removes a BOM. Removing BOM would alter
  credentials silently and conflicts with the refusal decision.
- **Preserve nonleading and inline U+FEFF.** Rejecting it everywhere would
  broaden a file-preamble fix into a new credential grammar and could reject
  an opaque upstream form secret. The token header constraint is real, but
  it also covers other non-ByteString characters; a complete header-safety
  policy is a separate need. This bounded choice leaves nonleading/inline
  token use potentially failing locally, explicitly documented rather than
  claimed working. Reject stripping U+FEFF anywhere, which could silently
  authenticate with a different value.
- **Check signing bytes before parsing.** UTF-8 decoding or relying on PEM
  construction repeats the observed runtime divergence. A three-byte prefix
  check on the trimmed bounded buffer has no runtime decoder dependency.
  Reject scanning or normalizing the PEM interior or suffix: those bytes
  remain subject to existing key qualification and are not a file preamble.
- **Keep read and budget precedence.** Early content inspection of partial
  reads would change guarded-read failure identities and might mask a raw
  overflow. Only a successful bounded read can be inspected. Do not weaken
  byte accounting to discount BOM or padding.
- **Threat analysis.** Refusing the prefix changes startup admission rather
  than repairing secret bytes. No request, key-derived result or signing
  operation may occur from a refused configuration. Raw memory/read budgets,
  source conflicts, no-fallback behavior, redaction and cryptographic
  qualification stay intact. The code discloses only the intended BOM failure
  class and canonical setting; no content, offset, count or source path is
  logged. Nonleading and inline behavior is an explicit scope boundary,
  not evidence of transport compatibility.
- **BR-026 v3, no new BR or ADR.** The guarded-source purpose is unchanged;
  admission tightens one file prefix and adds its error identity. Keep the
  existing budgets, diagnostic shape and downstream key rules under their
  current versions. Reject allocating BR-436 for the same purpose.

## Open questions

None.

## Stress-test

No independent review has run for this draft. Record each subsequent finding,
severity, retained/rejected disposition and reason here before freeze.

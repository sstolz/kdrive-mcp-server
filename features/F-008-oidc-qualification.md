---
id: F-008
title: Real OIDC provider qualification and MCP client compatibility matrix
ticket: "#11"
status: done
version: 1
---

## Context

Acceptance completed on 2026-11-03: AC-01–AC-19 passed on actual main
`2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4` (`make check` rc=0, see the
acceptance summary (archived evidence `runs/11-acceptance-1.md`)); the owner ran AC-20 on actual main
`7b046a0446930ab6a935510314c6c1b975d13550`, see the Infomaniak discover (archived evidence `runs/11-acceptance-infomaniak-1.md`), Infomaniak token (archived evidence `runs/11-acceptance-infomaniak-token-1.md`), Gitea discover (archived evidence `runs/11-acceptance-gitea-1.md`) and Gitea token (archived evidence `runs/11-acceptance-gitea-token-1.md`) reports. Infomaniak
and Gitea are both `proxy-only`, every matrix client resolves to `proxy` and the
P-21 promotion flag is true; the owner selected Infomaniak as the production
provider. This marker synchronization changes no frozen v1 contract.

Version note (2026-11-03, #21): [F-010 v1](F-010-oauth-proxy.md) versions BR-100
to v2 (optional `upstreamIssuer` for proxy-issued tokens, pending acceptance);
this F-008 v1 contract and its accepted behaviour without that option are
unchanged.

Autonomous freeze by the orchestrator on 2026-11-02 at 23:42:29 UTC, exact
reviewed SHA `50c399405a4afe4d8a062070314b20614a09bcb6`, after fresh independent
round 8 approval (archived evidence `runs/11-spec-review-8.md`) and
round 9 diff approval (archived evidence `runs/11-spec-review-9.md`). The ticket is ready, no
question remains and the user was notified of this SHA and the decisions. See
the freeze record (archived evidence `runs/11-freeze-1.md`). Allocates BR-094–BR-108.

Administrative renumbering on 2026-11-03 (no contract change): this feature
was drafted, reviewed and frozen as F-006 with BR-072–BR-086; #45 and #46
merged F-006/F-007 and BR-072–BR-093 to main meanwhile, so it became F-008 and
BR-094–BR-108 (BR-0NN → BR-0NN+22, order preserved). Review and freeze records
keep the original numbers.

#11 (archive issue 11) (P-11) must decide,
with real-token evidence, whether the chosen OIDC provider supports the
`delegate` or `delegate-static` HTTP auth modes of [SPEC §8](../SPEC.md) for the
owner's MCP clients, or whether the server must use `proxy` (P-21 promoted to
milestone 0.2). The decision gates P-12 (HTTP + OAuth).

Users affected: the owner, who operates the server and runs the qualification;
later every MCP client user, through the mode chosen from this evidence.

Owner decisions (2026-11-02, recorded in #11): providers to qualify are
Infomaniak (primary) and the owner's Gitea instance (secondary); the owner runs
the real-token step on their own machine and only a redacted report enters the
repository; the matrix covers claude.ai, Claude iOS, Claude Desktop, Claude
Code, ChatGPT and Codex. The agent never receives a token, code or client
secret. The agent's cloud session cannot reach provider hosts, so no provider
result in this feature is produced by the agent.

## Scope

1. A production access-token validator (`src/auth/access-token.ts`). It holds
   the rules P-12 will cite by version (BR-098–BR-100); P-12 still owns the HTTP
   401/403 mapping, `WWW-Authenticate`, JWKS fetching and caching.
2. Pure decision functions (`src/auth/verdict.ts`): the provider verdict and the
   per-client mode decision.
3. A development-only qualification command (`scripts/oidc-qualify.ts` with
   modules under `scripts/oidc/`, run by `make oidc-qualify`) with two steps:
   `discover` (public metadata, no secret) and `token` (authorization code +
   PKCE S256 + `nonce` + `resource`, manual redirect paste, token exchange,
   analysis through the validator of item 1). These files are typechecked,
   linted and tested like `scripts/coverage.ts`.
4. A redacted Markdown report written under the ignored `artifacts/` directory.
5. A dated MCP client compatibility matrix, `docs/mcp-client-compatibility.md`,
   built from the clients' current public documentation; the README and SPEC §8
   (including its now-stale statement that the claude.ai documentation does not
   mention CIMD)
   point to it (SPEC §8 currently says the README holds the matrix).

### Out of scope

- HTTP listener, protected-resource metadata endpoint, `WWW-Authenticate`
  responses, JWKS fetching/caching/rotation and rate limits (P-12).
- The `proxy` mode (P-21).
- Exercising dynamic client registration or CIMD against a real provider (D-4).
- Token introspection and opaque-token support (SPEC §8 v1 exclusion).
- Refresh tokens: never used; only their presence is reported.
- Real connections from MCP clients (evidenced in P-12 for the qualified mode).
- Choosing the production provider: the owner decides from the reports.

## Business rules

- **BR-094** — Discovery accepts only an issuer that is an absolute `https` URL
  without query, fragment or userinfo; it fetches the OIDC document
  `<issuer without trailing slash>/.well-known/openid-configuration` and the
  RFC 8414 document `<issuer origin>/.well-known/oauth-authorization-server<issuer
  path without trailing slash>`, where the origin keeps any port. A
  document is usable only when it is a JSON object whose `issuer` equals the
  configured issuer exactly. Discovery is usable when at least one document is
  usable. Verified by: AC-01, AC-02.
- **BR-095** — Each capability (PKCE S256, authorization-code grant, dynamic
  registration, CIMD, JWKS, `none` and `client_secret_basic`/`client_secret_post`
  token-endpoint authentication) is evaluated per usable document as `yes`, `no`
  or `unknown`: `unknown` when the field is absent; `no` when the field is present
  with a non-qualifying value; `yes` only when PKCE lists `S256`, the grant list
  contains `authorization_code` (absent list: `yes` per RFC 8414 default),
  `registration_endpoint` is an `https` URL, `client_id_metadata_document_supported`
  is the boolean `true`, `token_endpoint_auth_methods_supported` lists the
  method (absent list: `unknown`), or `jwks_uri` is an `https` URL whose
  document holds at least one usable key (BR-107). The effective value over the
  usable documents is: `yes`+`yes` or `yes`+`unknown` → `yes`; `yes`+`no` →
  `unknown`, listed as a contradiction; different `jwks_uri` values → JWKS
  `unknown`, listed; `no`+`no` or `no`+`unknown` → `no`; `unknown`+`unknown` →
  `unknown`; with one usable document, its value. The `none` method is used by
  BR-103 step 3. `authorization_response_iss_parameter_supported` is `yes`
  when it is the boolean `true`, `no` when `false` or absent (RFC 9207 §3
  default), and `no` with a listed anomaly for any other value.
  Verified by: AC-03, AC-04.
- **BR-096** — The `token` step starts only when discovery is usable, the
  effective PKCE S256 is `yes`, the `authorization_endpoint` and `token_endpoint`
  are `https` URLs, `--resource` is a canonical audience (BR-098), and
  `--redirect-uri` parses as an `http` URL without userinfo whose host is exactly
  `127.0.0.1`, `[::1]` or `localhost` and whose authority in the input string
  carries a port other than 80; otherwise it sends no request. A refusal for a
  provider condition (discovery, PKCE S256, endpoint scheme) writes a report
  with verdict `unsupported` and the failing condition; a refusal for an owner
  input writes no report and exits nonzero. The validator used by the step has audience `--resource` and
  the keys of the effective `jwks_uri`, or an empty key set when the effective
  JWKS value is not `yes`. The
  authorization request uses response type `code`, a fresh PKCE verifier of 43
  characters from 32 random bytes with method `S256`, a fresh random `state` and
  `nonce` of 32 random bytes each, scope `openid` plus configured extra scopes,
  and the configured `resource`. Verified by: AC-05, AC-06.
- **BR-097** — A pasted redirect URL is accepted only when its origin and path
  equal the redirect URI and its `state` equals the issued state; an `error`
  parameter or a missing code ends the run with the error code only (BR-106).
  The token exchange sends `grant_type=authorization_code`, the code, the
  redirect URI, the PKCE verifier and `resource`; with a client secret it uses
  `client_secret_basic` (client ID and secret each
  `application/x-www-form-urlencoded` before Base64, RFC 6749 §2.3.1) when the
  effective value is `yes` or `unknown`, else
  `client_secret_post` when `yes`, else stops; without a secret it sends
  `client_id` as a public client. The client secret is read only from an
  interactive no-echo prompt, never from an argument, environment variable or
  file; when any environment variable whose name contains `CLIENT_SECRET` is
  set, the command exits nonzero before any request. Verified by: AC-06, AC-07.
- **BR-098** — The validator accepts an access token only when it is a compact
  JWS whose header `alg` is one of `RS256`, `RS384`, `RS512`, `PS256`, `PS384`,
  `PS512`, `ES256`, `ES384`, `EdDSA`, `Ed25519`, whose header has no unknown `crit`
  parameter, whose signature verifies against a usable key of the supplied JWKS,
  whose `iss` equals the configured issuer exactly, whose `aud` equals the
  configured audience or is an array containing it, whose `sub` is a non-empty
  string (else reason `malformed`), whose `exp` is present and
  later than now (else reason `expired`), and whose `nbf`, when present, is not later than now. No clock
  tolerance is applied; `iat` is not checked. Any other token is rejected with
  status 401. The configured audience must be canonical: `https`, lowercase
  scheme and host, no default port, no userinfo, query or fragment, and no
  trailing slash unless the path is `/`; a non-canonical audience is a
  configuration error. Verified by: AC-08, AC-09.
- **BR-099** — The validator rejects with status 401 reason `id-token` a token
  carrying a `nonce` claim or a header `typ` other than absent, `JWT`, `at+jwt`,
  `application/jwt` or `application/at+jwt` (case-insensitive). Together with
  BR-098's audience rule, an OIDC ID token is never accepted as an access token.
  Verified by: AC-10.
- **BR-100** — Authorization uses the `(iss, sub)` subject allowlist and the
  optional exact email allowlist; an email matches only when the token's
  `email_verified` is the boolean `true`. A token that passes BR-098/BR-099 but
  whose identity matches neither list is rejected with status 403 reason
  `identity`. Creating a validator with both lists empty is a configuration
  error raised before any token is examined. Verified by: AC-11, AC-12.
- **BR-101** — Token analysis records `token_type` compared case-insensitively
  with `Bearer`, whether a refresh token and an ID token were returned (presence
  only), and classifies the access token as `opaque` (not a three-part compact
  JWS) or `jwt`. For a JWT it records header `alg`, `typ`, presence of `kid`, the
  issuer comparison, the audience relation (`resource`, `client-id`, `other` or
  `absent`), presence of `exp` and `sub`, and the validator status and reason.
  It runs the validator twice on the access token, with the owner's allowlists
  (positive check) and with only the fixed synthetic subject
  `qualification-negative-subject` (negative check, expected 403 `identity`),
  and once on the ID token when one is returned, recording each status and
  reason; when the access token is rejected with 401, both identity checks are
  reported as `not applicable (unauthenticated)`. An ID token is `usable` only
  when it is a compact JWS whose `iss` equals the issuer, whose `aud` contains
  the client ID and whose `nonce` equals the sent nonce. It also records RFC 9207
  issuer identification: the effective
  `authorization_response_iss_parameter_supported` value and whether the pasted
  redirect URL's `iss` is `equal` to the issuer, `different` or `absent`, flagging
  `advertised but absent` and `different` as inconsistent, where advertised
  means an effective value (BR-095) of `yes` or `unknown` (ChatGPT and Codex
  then reject the response, and both use a stable redirect URI only with
  consistent issuer identification). The `token` step
  refuses to start without at least one allowlist entry. Verified by: AC-13.
- **BR-102** — The provider verdict is `delegate-capable` when discovery is
  usable, PKCE S256 and JWKS are `yes`, dynamic registration or CIMD is `yes`,
  the real access token is authenticated (validator status not 401), and the
  validator rejects the real ID token with 401 when one is returned;
  `delegate-static-capable` under the same conditions with neither dynamic
  registration nor CIMD `yes`; `proxy-only` when delegation fails, discovery is
  usable, PKCE S256 is `yes` and a usable ID token (BR-101) was returned;
  `unsupported` otherwise; `incomplete` for a `discover`-only run or a started `token` run that obtains no
  token response, with the failing step reported. The order is
  `delegate-capable` > `delegate-static-capable` > `proxy-only`. The identity
  result never changes the provider verdict and is reported separately.
  Verified by: AC-14.
- **BR-103** — For each matrix client the mode decision applies these steps in
  order: (1) an `incomplete` or `unsupported` provider yields `not decided`;
  (2) `undetermined` when a needed matrix fact is `unverified`, a fact being
  needed when changing it from `unverified` to `supported` would change the
  result of steps 3–6; (3) `delegate` when the provider is `delegate-capable`
  and the client documents a registration mechanism that the provider has as
  `yes`, CIMD counting only when the provider's `none` token-endpoint method is
  also `yes` (Claude and Codex require `none` for CIMD; ChatGPT accepts `none`
  or `private_key_jwt`, the latter not evaluated, D-13); (4) `delegate-static`
  when the provider is `delegate-capable` or `delegate-static-capable` and the
  client documents manual client ID entry; steps 3 and 4 do not apply to a
  client whose matrix fact "rejects inconsistent issuer identification" is
  `supported` when the run's issuer identification is inconsistent (BR-101),
  and that fact counts as needed in step 2 in that case; (5) `proxy` when the run returned a usable ID token
  (BR-101) and the client documents dynamic registration as `supported` (the
  SPEC §8 proxy offers dynamic registration); (6) `not decided` otherwise. An `incomplete` or `unsupported`
  provider has a promotion flag `false`. The report's
  promotion flag is true when at least one client resolves to `proxy`; #11
  promotes P-21 to milestone 0.2 when the report of the provider the owner
  selects for production has the flag true. Verified by: AC-15.
- **BR-104** — The report and the command's standard output and error never
  contain the access token, ID token, refresh token, any of their non-empty
  dot-separated segments, the authorization code, PKCE verifier or client secret, nor the
  values of the identity claims `sub`, `email`, `name`, `preferred_username`,
  `given_name`, `family_name` and `nickname` of either token. The single
  exception is the authorization URL, printed once before the paste prompt as
  the serialized URL built from the validated `authorization_endpoint`; it may
  contain `state`, `nonce` and the PKCE challenge, which appear nowhere else.
  Identity reaches the report renderer only as booleans and appears as
  `allowed by subject list: yes/no`, `allowed by email list: yes/no` and the
  JSON type and value of `email_verified`. Before writing, the command scans the
  report for each secret value and segment and for each identity value of at
  least 8 characters, and writes nothing and exits nonzero when one is found.
  Failures print a fixed message without stack trace. Verified by: AC-16.
- **BR-105** — The qualification command and its report stay out of the npm
  package: no `scripts/` file and no report is packed, while the built
  `src/auth/` modules and the pinned `jose` dependency are. Verified by: AC-17.
- **BR-106** — Except the authorization URL of BR-104, every
  provider-controlled value written to the report or the terminal is cut to 200 characters, stripped of control characters, and written
  in a Markdown code span with backticks replaced; an OAuth `error` code is
  written only when it matches `^[A-Za-z0-9_.-]{1,64}$`, otherwise as
  `invalid`; `error_description`, `error_uri` and HTTP response bodies are never
  written. Verified by: AC-18.
- **BR-107** — A JWKS key is usable only when its `kty` is `RSA`, `EC` or
  `OKP` with `crv` `Ed25519`, an `EC` key having `crv` `P-256` or `P-384`, it has no private member (`d`, `p`, `q`, `dp`,
  `dq`, `qi`, `k`), its `use` is absent or `sig`, its `key_ops` is absent or
  contains `verify`, and its `alg` is absent or in BR-098's list; a JWKS
  that contains any private member is unusable as a whole. Verified by: AC-04.
- **BR-108** — Each row of the compatibility matrix names the client, the
  documentation check date (`YYYY-MM-DD`), at least one `https` source URL, and
  for dynamic registration, CIMD and manual client ID entry a value in
  `supported`, `not supported` or `unverified`, the same three values for
  "rejects inconsistent issuer identification" (RFC 9207), the redirect URI
  forms with their conditions (for example stable versus per-connection under
  RFC 9207) or `unverified`,
  the MCP authorization specification version or `unverified`, and a real-test
  result in `not tested`, `passed`, `failed`; a fact not read in the cited source
  on the check date is `unverified`. The matrix states the reference MCP
  authorization version of SPEC §8 (2026-07-28) and, per row, whether the
  stated version equals it. Verified by: AC-19.

## Contract details

### Command

```text
make oidc-qualify ARGS="discover --issuer <https-url> --label <name>"
make oidc-qualify ARGS="token --issuer <https-url> --client-id <id>
  [--client-secret-prompt] --redirect-uri <loopback-uri>
  --resource <canonical-https-uri> [--scope <extra>]...
  [--allow-subject <sub>]... [--allow-email <email>]... --label <name>"
```

- The target recipe is silent (`@`), so allowlist values are not echoed, and
  runs `node scripts/oidc-qualify.ts` in the Compose `dev` service
  with an interactive terminal (no `-T`), on the owner's machine. No listener and
  no published port is used, so BR-009 is unchanged; no secret is stored in
  Compose, the image, the environment or a file.
- `token` prints the authorization URL, waits for one pasted redirect URL on
  standard input, then exchanges the code. The browser's failed loopback page
  still shows the redirect URL to paste.
- The report goes to `artifacts/oidc-qualification/<label>-<UTC timestamp>.md`;
  `<label>` matches `^[a-z0-9-]{1,32}$` and is written as its own report
  field. Apart from the authorization URL and
  the prompts, the terminal shows only the report path and the verdict.
- The owner obtains their `sub` outside the tool (the provider's account or
  user API page) or uses `--allow-email` when the provider issues a verified
  email claim.
- The matrix is filled by the agent from the clients' official pages it can
  read; the owner may supply pages the agent cannot reach, cited by URL.
- Every network call has a 10-second deadline, follows no redirect and goes
  through an injected `fetch`, so tests use synthetic responses without network.

### Validator interface (`src/auth/access-token.ts`)

```ts
createAccessTokenValidator({ issuer, audience, jwks, allowedSubjects, allowedEmails })
  -> (token: string, now: Date) => Promise<
       | { ok: true; identity: { iss: string; sub: string } }
       | { ok: false; status: 401 | 403; reason: string }>
```

`reason` is one of `malformed`, `algorithm`, `signature`, `issuer`,
`audience`, `expired`, `not-yet-valid`, `id-token`, `identity`; it never echoes
token content. Checks run in this order: structure and `crit` (`malformed`),
`alg` (`algorithm`), `typ`/`nonce` (`id-token`), signature, issuer, audience,
`sub` (`malformed`), `exp` (`expired`), `nbf` (`not-yet-valid`), identity.

### Report

Sections: run metadata (label, UTC timestamp, issuer, resource, tool commit as its
first 12 hexadecimal characters),
per-document and effective capability tables (BR-095), token analysis and
checks (BR-101), provider verdict with failing conditions (BR-102), and the
per-client decisions computed from the matrix (BR-103), each with the redirect
URI form that applies to the client for this run's issuer identification.

### Acceptance evidence

The owner sends the redacted report. The orchestrator, who has no secret
values, runs a pattern scan before committing. The patterns are one exported
constant used by the code, the tests and the orchestrator:

- JWT: `eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*`;
- parameters: `(?<![A-Za-z0-9_])(?:code|state|nonce|code_verifier)=`;
- email: `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+`;
- long secret-like run: `[A-Za-z0-9_-]{40,}` (a UUID is 36 characters and a
  DNS label at most 63 but separated by dots, so URLs in the report do not
  match unless a path segment itself is 40 characters or more, which then
  blocks and is reviewed by hand).

Any hit blocks the commit. A long-run hit only may be overridden: the
orchestrator records in the acceptance record each hit's location and why it is
provider metadata; JWT, parameter and email hits are never overridable. It then
commits it as `runs/11-acceptance-<label>-1.md`, updates the matrix
real-test results and records the verdict, the client decisions and any P-21
promotion in #11.

## Acceptance criteria

- **AC-01** (BR-094) — Given synthetic metadata whose `issuer` differs from the
  configured issuer by one trailing slash, When discovery runs, Then that
  document is unusable; with one usable document and one 404, discovery is
  usable. Verified by: `tests/auth/discovery.test.ts`.
- **AC-02** (BR-094) — Given issuers `http://idp.test`, `https://idp.test?x=1`,
  `https://idp.test#f` and `https://u@idp.test`, Then each is refused before any
  fetch; Given `https://idp.test/realm`, Then the RFC 8414 request is
  `https://idp.test/.well-known/oauth-authorization-server/realm`; Given
  `https://idp.test:8443/realm/`, Then the requests are
  `https://idp.test:8443/realm/.well-known/openid-configuration` and
  `https://idp.test:8443/.well-known/oauth-authorization-server/realm`. Verified by:
  `tests/auth/discovery.test.ts`.
- **AC-03** (BR-095) — Given metadata variants, When capabilities are extracted,
  Then: S256 field absent → `unknown`; `["plain"]` → `no`; `registration_endpoint`
  over `http` → `no`; CIMD flag `"true"` (string) → `no`; grant list absent →
  `yes`; `["implicit"]` → `no`; the complete variant → `yes` for all; and two
  usable documents with different `jwks_uri` → JWKS `unknown` with the
  contradiction listed; token auth methods `["client_secret_post"]` in one
  document and absent in the other → `client_secret_basic` `no`; field absent
  in both → `unknown`; S256 listed in one document and `["plain"]` in the other
  → `unknown` with the contradiction listed, and `token` refused;
  `authorization_response_iss_parameter_supported` absent → `no`, `"true"`
  (string) → `no` with an anomaly listed, `true` in one document and absent in
  the other → `unknown`. Verified by:
  `tests/auth/discovery.test.ts`.
- **AC-04** (BR-095, BR-107) — Given JWKS variants (only `oct`; RSA key with `d`;
  RSA key with `use: enc`; RSA key with `alg: HS256`; `OKP` key with `crv` `X25519`; `EC` key with `crv` `secp256k1`; RSA key with
  `key_ops: ["encrypt"]`; valid EC key), Then only
  the valid EC key makes JWKS `yes`, and the variant mixing a private member with
  a valid key is unusable. Verified by: `tests/auth/discovery.test.ts`.
- **AC-05** (BR-096) — Given unusable discovery, PKCE S256 `unknown`, an `http`
  authorization or token endpoint, a non-canonical `--resource`, or redirect URIs
  `https://127.0.0.1:8080/cb`, `http://localhost:8080@evil.test/cb`,
  `http://127.0.0.1.evil.test:80/cb`, `http://evil.test:80/cb` and
  `http://127.0.0.1/cb` and `http://127.0.0.1:80/cb`, When `token` starts, Then it
  stops without any request, writing an `unsupported` report for the first three
  provider conditions and no report for the owner inputs;
  `http://127.0.0.1:8080/cb` is accepted. Verified by:
  `tests/auth/qualify-flow.test.ts`.
- **AC-06** (BR-096, BR-097) — Given a built authorization request, Then the
  verifier is 43 base64url characters, the challenge is its SHA-256 base64url,
  `state` and `nonce` decode to 32 bytes, and the URL carries
  `code_challenge_method=S256`, `resource`, `nonce`, `state` and scope `openid`;
  pasted URLs with a different `state`, another origin or path, `error=access_denied`
  or no code end the run without a token request. Verified by:
  `tests/auth/qualify-flow.test.ts`.
- **AC-07** (BR-097) — Given a synthetic token endpoint, When the exchange runs
  with a secret and auth methods `unknown`, `["client_secret_post"]` and
  `["private_key_jwt"]`, and without a secret, Then the request uses Basic, post,
  stops, and public `client_id` respectively; a secret `a:b+c%` is
  form-urlencoded before Base64; the parser rejects
  `--client-secret` and `--client-secret-file`; and with `OIDC_CLIENT_SECRET`
  set the command exits nonzero before any request. Verified by:
  `tests/auth/qualify-flow.test.ts`.
- **AC-08** (BR-098) — Given tokens signed by a synthetic key, When validated,
  Then a correct token (single `aud`, `aud` array, and an `Ed25519` key) is
  accepted, and tokens
  with `alg` `none`/`HS256`, an unknown `crit`, a key absent from the JWKS, a
  wrong issuer, `aud` equal to the client ID, missing or empty `sub`, missing `exp`, `exp` equal to now,
  or `nbf` one second after now are rejected with 401 and the matching reason.
  Verified by: `tests/auth/access-token.test.ts`.
- **AC-09** (BR-098) — Given audiences `https://MCP.test/mcp`,
  `https://mcp.test:443/mcp`, `https://mcp.test/mcp/` and `https://mcp.test/mcp#x`,
  When a validator is created, Then each is a configuration error. Verified by:
  `tests/auth/access-token.test.ts`.
- **AC-10** (BR-099) — Given otherwise valid tokens with a `nonce` claim, with
  `typ` `id_token`, and with `typ` `application/at+jwt`, Then the first two are
  rejected with 401 `id-token` and the third is accepted; Given an ID-token-shaped
  JWT without `nonce`, `typ: JWT` and `aud` equal to the client ID, Then it is
  rejected with 401 `audience`. Verified by: `tests/auth/access-token.test.ts`.
- **AC-11** (BR-100) — Given a valid token whose `(iss, sub)` is not listed and
  whose email is listed with `email_verified` `"true"` (string), Then it is
  rejected with 403 `identity`; with `email_verified` `true` it is accepted.
  Verified by: `tests/auth/access-token.test.ts`.
- **AC-12** (BR-100) — Given both allowlists empty, When the validator is
  created, Then creation throws a configuration error. Verified by:
  `tests/auth/access-token.test.ts`.
- **AC-13** (BR-101) — Given synthetic token responses (opaque access token;
  JWT with `aud` = client ID; accepted JWT plus ID token and refresh token;
  `token_type` `bearer`), When analysed, Then classification, audience relation,
  presence flags, issuer identification (`equal`, `different` → inconsistent,
  `absent` while advertised → inconsistent, `absent` while not advertised →
  consistent, `absent` with one document `true` and the other silent
  (effective `unknown`) → inconsistent), positive check, negative check (403 `identity`), the
  `not applicable (unauthenticated)` case and ID-token usability (wrong `nonce`
  → not usable) match BR-101; and `token` without any allowlist entry stops
  before any request. Verified by: `tests/auth/qualify-flow.test.ts`.
- **AC-14** (BR-102) — Given the truth table of BR-102 (an authenticated access
  token with a real ID token that the validator accepts yields no delegated
  verdict; each capability `yes`/
  `no`/`unknown`, token `opaque`/authenticated/401, ID token present/absent,
  identity 403, usable/unusable ID token, `discover` only), When the provider
  verdict is computed, Then each row yields its specified verdict, a `token` run
  without token response yields `incomplete`, and identity
  403 never changes it. Verified by: `tests/auth/verdict.test.ts`.
- **AC-15** (BR-103) — Given provider verdicts and client facts (dynamic only,
  CIMD only, manual entry only, `unverified`), When client modes are decided,
  Then each yields `delegate`, `delegate-static`, `undetermined` or `proxy` per
  BR-103 — including provider `delegate-capable` with dynamic `yes` and CIMD
  `no`, client dynamic `unverified`, CIMD `not supported` and manual `supported`
  → `undetermined`; provider CIMD `yes` with `none` `no` and a CIMD-only client
  → not `delegate`; provider `delegate-capable` with inconsistent issuer
  identification and a client with dynamic `supported` and "rejects
  inconsistent issuer identification" `supported` → `proxy` when a usable ID
  token was returned, and the same client with that fact `unverified` →
  `undetermined`; the same `delegate-capable` provider with consistent issuer
  identification and that client → `delegate`; inconsistent issuer
  identification and a client whose fact is `not supported` → `delegate` — the
  providers
  `incomplete` and `unsupported` yield `not decided` with flag `false`, a
  `delegate-capable` provider without a usable ID token and a client with no
  matching mechanism yields `not decided` (never `proxy`), and the
  P-21 promotion flag is true exactly when at least one client is `proxy`;
  provider `delegate-static-capable`, client CIMD `unverified` and manual
  `supported` → `delegate-static`; provider `proxy-only` and a client with
  dynamic registration `not supported` → `not decided`. Verified by:
  `tests/auth/verdict.test.ts`.
- **AC-16** (BR-104) — Given a full synthetic `token` run with issuer
  `https://login.idp.example.test/realm/0f8fad5b-d9cb-469f-a165-70867728950e`
  and distinctive values for every secret and identity claim, When the report and captured
  stdout/stderr are produced, Then no token, segment, code, verifier, secret or
  identity value appears, the scan detects `` `code=x`` and `|state=x` injected
  into a report, `state` and `nonce` appear only in the authorization
  URL line, and the allowed yes/no lines appear; with `sub` = `1` the run
  completes and writes the report; and an injected leak makes the command write
  no file, print no stack trace and exit nonzero; the completed synthetic report
  passes the orchestrator pattern scan of the Acceptance evidence section; a
  token with an empty signature segment does not make every report match; and
  the `oidc-qualify` Make recipe line starts with `@`. Verified by:
  `tests/auth/qualify-report.test.ts`.
- **AC-17** (BR-105) — Given the packed artifact and `package.json`, Then `jose`
  is an exact pinned dependency and the artifact contains `dist/auth/`
  and no `scripts/` file nor report. Verified by: `tests/package.test.ts`.
- **AC-18** (BR-106) — Given a provider `issuer` and header `typ` containing backticks,
  newlines, `\x1b[31m` and 500 characters, an `error` of `bad code!` and an
  `error_description`, Then the report holds bounded code spans without control
  characters, `error` is `invalid`, and the description is absent; an
  `authorization_endpoint` with a newline is refused or percent-encoded in the
  printed URL. Verified by: `tests/auth/qualify-report.test.ts`.
- **AC-19** (BR-108) — Given `docs/mcp-client-compatibility.md`, When the matrix
  check runs, Then the six client rows exist, each with a valid date, an `https`
  source, only allowed values and the comparison with reference version
  2026-07-28. Verified by:
  `tests/auth/compatibility-matrix.test.ts`.
- **AC-20** (BR-101–BR-104, real) — Given the merged command on the owner's
  machine, When the owner runs `discover` and `token` against Infomaniak and,
  if reachable, Gitea, Then each redacted report passes the orchestrator pattern
  scan and shows a provider verdict; when the access token is authenticated the
  positive check is accepted and the negative check is 403 `identity`, otherwise
  both are `not applicable (unauthenticated)` and the allowlist evidence is
  recorded as not obtained for that provider; a positive check of 403
  `identity` is recorded as an owner allowlist mismatch, not a provider
  failure, and the primary provider is re-run with a corrected allowlist before
  #11 closes; when an ID token is returned, its check is
  401 (`id-token` or `audience`); and #11
  records the client
  decisions and any P-21 promotion. Verified by: committed
  `runs/11-acceptance-<label>-1.md` records.

## Decisions

- **D-1 — Validator in `src/auth/`, tool in `scripts/`.** P-12 reuses the exact
  validator that qualified the provider, so qualification cannot pass with
  weaker rules. Rejected: a script-only validator (would diverge).
- **D-2 — `jose` 6.2.12 (published 2026-09-05, checked against the npm registry
  on 2026-11-02) as a pinned runtime dependency** with a local JWKS. This adds a
  runtime dependency to the published package. Rejected: hand-written JWS on
  `node:crypto` (algorithm-confusion and parsing risk); `createRemoteJWKSet`
  (fetching and caching belong to P-12).
- **D-3 — Manual redirect paste, no loopback listener.** Keeps the dev service
  without published ports (BR-009). Rejected: a published port.
- **D-4 — Registration capability from metadata only.** Rejected: a live dynamic
  registration (durable side effect at the provider). A `delegate` decision is
  confirmed by the real client connection in P-12.
- **D-5 — ID-token rejection by `nonce`, `typ` and audience.** The flow sends a
  `nonce`, so a real ID token carries it. Rejected: requiring `typ: at+jwt`
  (RFC 9068), which several providers omit; the report records `typ`.
- **D-6 — No clock tolerance.** Rejected: a skew window (weakens expiry).
- **D-7 — No identity values in the report.** Low-entropy identifiers make
  hashes confirmable. Rejected: truncated SHA-256 and per-run HMAC (no use to the
  reader).
- **D-8 — Client secret by no-echo prompt.** Keeps BR-009 v1 ("no secrets")
  intact. Rejected: a secret file through the workspace bind.
- **D-9 — Provider verdict separate from client decision.** SPEC §8 also routes
  to `proxy` when a client cannot use the provider's registration path.
  Rejected: a provider-only verdict.
- **D-10 — `aud` array membership** is the accepted reading of SPEC §8 "égal à"
  (RFC 7519 allows an array). Rejected: single-valued only.
- **D-11 — `unsupported` is not routed to `proxy`.** The ticket says
  unsupported/opaque providers route to proxy, but SPEC §8 requires an OIDC ID
  token from the upstream provider for `proxy`. An opaque-token provider with a
  usable ID token is `proxy-only` and routes to proxy; one without is reported
  unusable, and the owner picks another provider.
- **D-12 — Promotion follows the selected provider.** With two qualified
  providers, P-21 is promoted only from the report of the provider the owner
  selects for production.
- **D-13 — CIMD requires `none`.** Claude and Codex documents choose CIMD only
  with `none`; ChatGPT also accepts `private_key_jwt`, which the qualification
  does not evaluate. Rejected: per-client authentication-method columns (no
  matrix client needs them today).
- **D-14 — RFC 9207 is client-specific.** It does not change the provider
  verdict; it removes the delegated modes for a client documented to reject
  inconsistent issuer identification (ChatGPT and Codex) when the run shows the
  inconsistency, and it decides their redirect URI form. Rejected: provider-wide
  impact. Claude's documentation states no such rule, so its rows hold
  `unverified` and become `undetermined` on an inconsistent run until a source
  or a real client test settles the fact.

## Open questions

None.

## Stress-test

Round 1 (report (archived evidence `runs/11-spec-review-1.md`), reviewed SHA
`9b158bd507b6cc4d677d8197ff86f0b5e5a2c9f8`, verdict `changes`, 9 major, 11
minor). All findings retained:

- M-01 → BR-102 provider verdict + BR-103 per-client decision, D-9.
- M-02 → BR-094/BR-095 per-document evaluation and contradiction rule, AC-01/03.
- M-03 → `no`/`unknown` defined; AC-03 asserts exact values.
- M-04 → BR-096 `https` endpoints and loopback redirect only, AC-05.
- M-05 → `typ` set widened; `nonce` sent; AC-10 audience case.
- M-06 → authentication-only verdict; mandatory allowlist; positive/negative
  checks in BR-101, AC-13/AC-20.
- M-07 → no identity values, D-7.
- M-08 → BR-106 sanitization, BR-104 extended to segments and stdout/stderr.
- M-09 → secret by no-echo prompt, D-8; interactive target stated.
- m-01 → issuer query/fragment/userinfo refused (AC-02).
- m-02 → `crit`, `nbf` rules; `iat` unchecked (BR-098).
- m-03 → canonical audience rule (AC-09), D-10.
- m-04 → BR-107.
- m-05 → `client_secret_post` fallback and stop (BR-097, AC-07).
- m-06 → `token_type` and refresh presence (BR-101).
- m-07 → `unsupported` handling (BR-103) and truth table (AC-14).
- m-08 → matrix location in scope item 5; allowed values in BR-108.
- m-09 → version checked against the registry (D-2).
- m-10 → scope item 1 states what P-12 keeps.
- m-11 → plain `node`; acceptance evidence section; module locations.

Round 2 (report (archived evidence `runs/11-spec-review-2.md`), reviewed SHA
`63532f2c47163d220d5a11c6bd494fa720279f62`, verdict `changes`, 3 major, 10
minor; all round-1 findings confirmed fixed or partly fixed). All retained:

- N-01 → authorization URL exception in BR-104/BR-106, AC-16/AC-18.
- N-02 → identity claims listed, booleans-only renderer, 8-character scan
  threshold, `sub` = `1` case in AC-16.
- N-03 → verdict order, `incomplete`/`unsupported` give `not decided` and flag
  `false`, promotion follows the selected provider (BR-103, D-12, AC-15).
- n-01 → effective `no`/`unknown` rule (BR-095, AC-03).
- n-02 → BR-101 wording; AC-20 expected outcomes.
- n-03 → validator bound to `--resource` and effective JWKS (BR-096).
- n-04 → lookalike redirect URIs and remaining refusals (AC-05).
- n-05 → orchestrator pattern scan (Acceptance evidence).
- n-06 → usable ID token for `proxy-only` (BR-101/BR-102), D-11.
- n-07 → `Ed25519` added (BR-098, AC-08).
- n-08 → `CLIENT_SECRET` variables make the command exit (BR-097, AC-07).
- n-09 → needed fact defined (BR-103, AC-15).
- n-10 → matrix sourcing stated; reference version comparison (BR-108, AC-19).

Round 3 (report (archived evidence `runs/11-spec-review-3.md`), reviewed SHA
`5f550a2a9eb4362437d61eae5af1f568e33703c8`, verdict `changes`, 3 major, 7
minor; all round-2 findings confirmed fixed). All retained:

- R3-M-01 → BR-103 rewritten as ordered steps, `undetermined` before
  `delegate-static`.
- R3-M-02 → `proxy` requires a usable ID token (BR-103 step 5, AC-15 row).
- R3-M-03 → tool commit shortened to 12 characters; AC-16 runs the pattern scan
  on the synthetic report.
- R3-m-01 → no-token run is `incomplete` (BR-102, AC-14).
- R3-m-02 → token-endpoint auth `yes` condition (BR-095).
- R3-m-03 → `sub` required (BR-098, AC-08).
- R3-m-04 → well-known URL construction with port and trailing slash (BR-094,
  AC-02).
- R3-m-05 → port read from the input string, port 80 refused (BR-096, AC-05).
- R3-m-06 → AC-18 uses `typ`, a written value.
- R3-m-07 → BR-105 wording and `jose` pin check (AC-17).

Round 4 (report (archived evidence `runs/11-spec-review-4.md`), reviewed SHA
`acb60e2f9d79155a416ac205c6ef2cc4360dcb18`, verdict `changes`, 1 major, 6
minor; all round-3 findings confirmed fixed). All retained:

- R4-M-01 → exact scan patterns as one shared constant; AC-16 uses a
  multi-label issuer with a UUID path segment.
- R4-m-01 → BR-095 effective-value table.
- R4-m-02 → AC-15 row where an `unverified` fact does not change the result.
- R4-m-03 → how the owner obtains `sub`; AC-20 positive-403 branch.
- R4-m-04 → BR-103 step 5 requires client dynamic registration; AC-15 row.
- R4-m-05 → `none` reported only (BR-095).
- R4-m-06 → AC-15 "at least one".

Round 5 (report (archived evidence `runs/11-spec-review-5.md`), reviewed SHA
`00f9b0b88cea6cafc411d5ed9dbfef3d56620d96`, verdict `changes`, 1 major, 6
minor; round-4 findings confirmed fixed except an AC-03 row). All retained:

- R5-M-01 → a rejected real ID token is a condition of both delegated verdicts
  (BR-102, AC-14, AC-20).
- R5-m-01 → label limited to 32 characters, written as its own field.
- R5-m-02 → long-run override rule; other hits never overridable.
- R5-m-03 → AC-03 `yes`+`no` row.
- R5-m-04 → parameter pattern with a negative lookbehind.
- R5-m-05 → `client_secret_basic` encoding (BR-097, AC-07).
- R5-m-06 → AC-15 row specified; AC-20 wording and primary-provider re-run.

Owner-supplied OpenAI pages (2026-11-02) added: CIMD counts only with `none`
(BR-103, D-13) and RFC 9207 issuer identification is recorded (BR-101, D-14).

Round 6 (report (archived evidence `runs/11-spec-review-6.md`), reviewed SHA
`28fbb51fddd26b734d54193f86ee787fbc5d018d`, verdict `changes`, 1 major, 6
minor; round-5 findings fixed except an AC-16 scan test). All retained:

- R6-M-01 → matrix fact "rejects inconsistent issuer identification"; BR-103
  steps 3–4 excluded on inconsistency; D-14 rewritten; AC-15 rows.
- R6-m-01 → accurate CIMD method statement (BR-103).
- R6-m-02 → effective value of `authorization_response_iss_parameter_supported`
  (BR-095, AC-03).
- R6-m-03 → AC-13 `different` row.
- R6-m-04 → redirect URI forms with conditions (BR-108).
- R6-m-05 → stale SPEC §8 CIMD statement updated in scope item 5.
- R6-m-06 → AC-16 backtick/pipe scan test; decisions reordered.

Round 7 (report (archived evidence `runs/11-spec-review-7.md`), reviewed SHA
`aa8d0a80a521558dbd79bb142033fc3501fad848`, verdict `changes`, 1 major, 6
minor; round-6 findings fixed or completed here). All retained:

- R7-M-01 → "advertised" means effective `yes` or `unknown` (BR-101); AC-03 and
  AC-13 rows.
- R7-m-01 → AC-15 consistent-run `delegate` row.
- R7-m-02 → per-client redirect URI form in the report.
- R7-m-03 → leak scan covers non-empty segments only.
- R7-m-04 → silent Make recipe.
- R7-m-05 → provider-condition refusal is `unsupported`; owner-input refusal
  writes no report (BR-096, AC-05).
- R7-m-06 → `OKP` only with `Ed25519`, `key_ops` rule (BR-107, AC-04); AC-20
  ID-token check only when returned.

Round 8 (report (archived evidence `runs/11-spec-review-8.md`), reviewed SHA
`e6798b6677b1dd2507e426c9ded5f4cdbea171c7`, verdict `approve`, 0 major, 5
minor). All minors retained:

- R8-m-01 → AC-15 `not supported` row.
- R8-m-02 → AC-16 empty-segment and silent-recipe checks.
- R8-m-03 → `exp` reason and `sub` position in the check order.
- R8-m-04 → D-14 states Claude's `unverified` fact and its consequence.
- R8-m-05 → `EC` curves limited to `P-256` and `P-384` (BR-107, AC-04).

Round 9 (report (archived evidence `runs/11-spec-review-9.md`), diff
`e6798b6..50c3994`, verdict `approve`, 1 minor). R9-m-01 retained as a test
reading, without contract change: the AC-16 empty-segment case is verified as
"a run whose token has an empty signature segment completes and writes the
report".

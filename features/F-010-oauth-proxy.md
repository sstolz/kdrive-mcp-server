---
id: F-010
title: Bounded OAuth proxy (transport-independent authorization server)
ticket: "#21"
status: done
version: 1
---

## Context

Acceptance completed on 2026-11-03: all ACs passed on actual main
`3fc14c3bbbd57b3c52ca4b74c07a512720f0d627` (`make check` rc=0, 76 test files / 1746 tests;
PR #51 CI green), see the closure comment on #21 (archive issue 21).
BR-124–BR-143 v1, BR-100 v2 and BR-024 v2 (F-002 v3) are active. Real MCP-client
connections are deferred to #12/#13 and are not established. This marker
synchronization (#50) changes no frozen v1 contract.

Autonomous freeze by the orchestrator on 2026-11-03 at 07:42:54 UTC, exact
reviewed SHA `c4d95c1`, after fresh independent Fable
round 2 approval (archived evidence `runs/21-spec-review-2.md`) (full spec at `520a15b`) and
round 3 diff approval (archived evidence `runs/21-spec-review-3.md`). IDs re-checked free on
main `ca6f387`. The ticket is ready, no question remains and the user was
notified of this SHA and the decisions. See the
freeze record (archived evidence `runs/21-freeze-1.md`). Allocates BR-124–BR-143; versions
BR-100 to v2 and BR-024 to v2 (F-002 v3).

#21 (archive issue 21) (P-21) implements
the `proxy` mode of [SPEC §8](../SPEC.md) ("Contrat du mode `proxy`"). F-008
qualified the owner's production provider, Infomaniak, as `proxy-only`
(report (archived evidence `runs/11-acceptance-infomaniak-token-1.md`)): discovery is usable,
PKCE S256 is supported, the access token is opaque, a usable OIDC ID token is
returned, `client_secret_basic`/`client_secret_post` are listed, `none` is not,
RFC 9207 issuer identification is not advertised, and no dynamic registration
is offered. Every client of the
[compatibility matrix](../docs/mcp-client-compatibility.md) therefore resolves
to `proxy`. All six clients document dynamic registration; ChatGPT and Codex use
a stable redirect URI only when the authorization server advertises RFC 9207;
Claude Code and Codex use loopback redirects whose port varies (RFC 8252 §7.3),
and Claude Code documents `http://localhost:<port>/callback`.

The proxy acts, towards MCP clients, as an OAuth 2.1 authorization server with
its own issuer, and delegates user authentication to the upstream OIDC provider
through one static confidential client. It issues its own short, signed,
audience-bound access tokens and rotating refresh tokens.

Owner decisions (2026-11-03, recorded in #21): upstream provider Infomaniak, but
the code stays provider-agnostic (SPEC §8); D-05: proxy access tokens carry the
upstream `(iss, sub)`; the `(iss, sub)` allowlist and the optional verified-email
allowlist (F-008 BR-100) are checked at upstream login before anything is issued
and on every request; refresh tokens last 30 days absolute and 7 days of
inactivity, rotate on each use, and a reused one revokes its whole family;
access tokens last 1 hour; v1 state is in memory in one instance, and a restart
loses clients, flows and refresh state; HTTP loopback redirect URIs on
`127.0.0.1`, `[::1]` **and `localhost`** are accepted with a variable port so
that Claude Code works (this changes the F-002 redirect grammar, see Scope 10).
Real MCP-client connections need a public HTTPS deployment and are an owner-run
acceptance step after P-12 (like F-008 AC-20); they are not an acceptance
criterion of this feature.

Ordering constraint: P-21 now precedes P-12 (HTTP listener, protected-resource
metadata, `WWW-Authenticate`, Origin checks, rate and request-size limits).
F-010 therefore defines the proxy as **transport-independent request → response
handlers** plus the access-token issuance and verification contract; P-12
mounts the handlers on HTTP routes and maps verification results to HTTP.

Users affected: the owner, who provisions the upstream client, the signing key
and the redirect allowlist; every MCP client user, who authorizes through the
proxy once P-12 exposes it.

IDs: F-010 and BR-124–BR-143 were re-checked against `origin/main` `ca6f387` on
2026-11-03 ([spec index](../docs/spec-index.md): next unused F-010 and BR-124);
they are checked again before freeze because another agent allocates IDs for
other tickets in parallel. This feature also versions BR-100 to v2 (BR-141) and
BR-024 to v2 (Scope 10).

## Scope

1. `src/auth/proxy/` (module names indicative): a pure factory
   `createOAuthProxy(options)` returning the handlers of BR-125–BR-140 and a
   proxy access-token verifier (BR-141). No I/O at construction (BR-124).
2. Signing-key parsing from the bytes that F-002 already reads from
   `OAUTH_SIGNING_KEY_FILE`, `kid` derivation and access-JWT signing (BR-124,
   BR-138).
3. An upstream OIDC port and its production implementation over `fetch`, and
   `createProductionPorts()` wiring the clock to `new Date()` and the random
   source to `node:crypto` `randomBytes` (BR-124, BR-131).
4. Strict upstream ID-token verification (BR-133) reusing the F-008 key and
   algorithm rules (BR-098, BR-107).
5. An extension of `createAccessTokenValidator` (`src/auth/access-token.ts`)
   with an optional upstream issuer, recorded as BR-100 v2 (BR-141): the
   BR-100 History line names the new `upstream_iss` claim check and the
   identity change, and F-008 receives a version note pointing to BR-100 v2.
   F-008 behaviour without the option is unchanged.
6. In-memory single-instance stores with explicit capacity bounds (BR-142).
7. Shared pure helpers may move from `scripts/oidc/` to `src/auth/` when the
   proxy needs them; F-008 tests stay unchanged and green.
8. `docs/oauth-proxy.md`: operator note on the accepted key format, the
   upstream callback URL to register at the provider, the redirect allowlist
   (including the loopback port rule), the restart and key-replacement
   consequences, the fact that an upstream endpoint or authentication-method
   change needs a restart (BR-131 caches discovery), that a strict OIDC client
   may reject the OIDC-path alias of BR-125 (it lacks OIDC Discovery required
   members such as `jwks_uri`), and the residual
   registration/authorization/consent flooding risk until P-12 rate limits
   exist (BR-142). It contains no secret and no key-generation output. A matching
   one-line `BACKLOG.md` entry records the flooding risk and the P-12
   dependency (rate limits on `/oauth/register`, `/oauth/authorize` and
   `/oauth/consent`).
9. Records prepared and marked pending: `business-rules/BR-124.md`–`BR-143.md`,
   BR-100 v2, spec-index rows, a provisional capability-map entry and a
   CHANGELOG `Unreleased` line.
10. **Redirect-URI contract change (owner decision 2026-11-03).**
    [F-002](F-002-configuration.md) moves to v3 (v2 snapshot in
    [history](history/F-002-v2.md)): HTTP redirect URIs may use the host
    written exactly as lowercase `localhost`, besides `127.0.0.1` and `[::1]`;
    other spellings stay rejected. [BR-024](../business-rules/BR-024.md) moves
    to v2 (examples: `http://localhost/cb` now retained; `http://LOCALHOST/cb`
    and `http://localhost./cb` rejected) and `tests/config.test.ts` is updated
    to cite `BR-024 v2`. The feature PR changes the `literalLoopback` check in
    `src/config-values.ts:160` to admit `localhost`, and updates the BR-024
    row of `docs/spec-index.md` (`:121`, "v1 … Active") to v2 pending
    acceptance. F-002 v3 and BR-024 v2 are reviewed and frozen with
    this spec. BR-025 (insecure loopback listener) is unchanged.
11. **SPEC §8 amendment** (French): "comparaison exacte" of
    `OAUTH_ALLOWED_REDIRECT_URIS` now states the single exception, the port of
    `http` loopback URLs on `127.0.0.1`, `[::1]` and `localhost` (RFC 8252
    §7.3). Applied in this revision.

### Out of scope

- HTTP wiring (P-12): listener, routing and method checks, request parsing and
  body/size limits, `Content-Type` checks, Origin validation, rate limits,
  TLS, protected-resource metadata (RFC 9728), `WWW-Authenticate` challenges and
  the 401/403 mapping of verifier results on MCP requests. P-12 mounts the
  handlers at the URLs that BR-125 advertises and adds rate limits on
  registration, authorization and consent.
- CIMD: no matrix client requires it (all document dynamic registration); the
  ticket allows it only if a verified client needs it.
- Persistence, multi-instance operation, token revocation (RFC 7009) and
  introspection endpoints, JWKS publication, OIDC provider behaviour towards
  clients (no ID tokens, no userinfo), scopes, remembered consent.
- Generating, rotating or storing deployment secrets. The code never generates
  a signing key or an upstream secret; tests use synthetic key material
  generated in memory per test run.
- Real MCP-client connections (owner-run, after P-12 and a public HTTPS
  deployment).
- Docker image and deployment examples (P-13).

## Business rules

Common definitions used by BR-128–BR-140:

- A **client redirect** is a 302 to the `redirect_uri` of the pending
  authorization request; it carries the listed parameters, `iss` equal to the
  proxy issuer, and the client `state` **only when it was present and valid**
  under BR-128. An invalid `state` is never echoed. Parameters are appended to
  any existing query of the redirect URI as `application/x-www-form-urlencoded`
  pairs (percent-encoded).
- **Random values** are the stated number of random bytes encoded base64url
  without padding (32 bytes → 43 characters; 16 bytes → 22 characters).
- An item created at `t` with lifetime `L` is **valid while** `now < t + L`.

- **BR-124** — `createOAuthProxy` takes the effective proxy configuration of
  F-002 (`publicUrl`, `oauthIssuer`, `oauthAudience`, `oauthAllowedSubjects`,
  `oauthAllowedEmails`, `oauthUpstreamClientId`, upstream client secret,
  signing-key bytes, `oauthAllowedRedirectUris`) and injected ports (clock,
  random bytes, upstream OIDC port, optional logger) and performs no network,
  file or clock I/O while constructing. The signing-key bytes must be one PEM
  `PRIVATE KEY` (PKCS#8) block holding an EC P-256 private key; any other
  content, curve or key type raises `AuthConfigurationError` with a fixed
  message that echoes no key material. The key's `kid` is the RFC 7638 SHA-256
  JWK thumbprint of its public key, base64url without padding, so the same key
  file always yields the same `kid`. The proxy issuer is the canonical public
  URL (F-002 canonical form) and the upstream issuer is the canonical
  `oauthIssuer`. `createProductionPorts()` returns the clock `() => new Date()`
  and `node:crypto` `randomBytes` as the random source. Verified by: AC-01.
- **BR-125** — The metadata handler returns status 200, `Content-Type:
  application/json` and an RFC 8414 document whose members are exactly:
  `issuer` (proxy issuer), `authorization_endpoint` (`<issuer>/oauth/authorize`),
  `token_endpoint` (`<issuer>/oauth/token`), `registration_endpoint`
  (`<issuer>/oauth/register`), `response_types_supported` `["code"]`,
  `grant_types_supported` `["authorization_code","refresh_token"]`,
  `code_challenge_methods_supported` `["S256"]`,
  `token_endpoint_auth_methods_supported`
  `["none","client_secret_basic","client_secret_post"]` and
  `authorization_response_iss_parameter_supported` `true`. It has no
  `client_id_metadata_document_supported` member. `<issuer>` is the proxy
  issuer without trailing slash. `metadataPaths` lists, in order, the RFC 8414
  path `/.well-known/oauth-authorization-server<issuer path>`, the OIDC
  path-insertion form `/.well-known/openid-configuration<issuer path>` and the
  OIDC path-append form `<issuer path>/.well-known/openid-configuration`
  (duplicates removed when the issuer path is empty); P-12 serves the same
  document at each. Verified by: AC-02.
- **BR-126** — A candidate redirect URI matches a reference URI when the two
  strings are byte-identical, or when both begin with `http://127.0.0.1`,
  `http://[::1]` or `http://localhost` and are byte-identical after removing
  from each the port suffix `:<1–5 digits>` that directly follows the host,
  where that suffix, when present, denotes a port from 1 to 65535 and is
  followed by `/`, `?` or the end of the string (RFC 8252 §7.3). Scheme, host,
  path and query are compared exactly; no other normalization (case,
  percent-encoding, trailing slash, default port, other loopback spellings) is
  applied. Verified by: AC-03.
- **BR-127** — The registration handler takes the raw body text; a body over
  16,384 UTF-8 bytes, not a JSON object, or with an invalid member yields 400
  `{"error":"invalid_client_metadata"}`. `redirect_uris` is required: a
  nonempty array of at most 10 distinct strings, each matching an entry of
  `oauthAllowedRedirectUris` under BR-126; otherwise 400
  `{"error":"invalid_redirect_uri"}`. `token_endpoint_auth_method` is `none`,
  `client_secret_basic` (default when absent, RFC 7591) or
  `client_secret_post`; `grant_types` is absent (meaning both) or a nonempty
  subset of `authorization_code` and `refresh_token` that contains
  `authorization_code`; `response_types` is absent or `["code"]`; `client_name`
  is absent or a string of 1–200 characters without control characters. Other
  members are ignored and never stored or echoed. Success returns 201 with
  `Cache-Control: no-store` and `client_id` (32 random bytes),
  `client_id_issued_at`, the stored `redirect_uris`, `grant_types`,
  `response_types` `["code"]`, `token_endpoint_auth_method`, `client_name` when
  given, and for a secret method a `client_secret` (32 random bytes) with
  `client_secret_expires_at` `0`; only the SHA-256 of the secret is stored.
  Verified by: AC-04, AC-05.
- **BR-128** — The authorize handler takes the query parameters and the
  `Cookie` header. A repeated parameter, an unknown `client_id`, or a
  `redirect_uri` that is absent or matches none of the client's registered
  URIs under BR-126 yields a 400 HTML error page and no redirect;
  `redirect_uri` is required even for a client with one registered URI. A
  `state` is valid when absent, or when it is 1–1,024 bytes without control
  characters. With a known client and matching `redirect_uri`, the first
  defect in this order produces a client redirect with `error`:
  `response_type` absent or other than `code` → `unsupported_response_type`;
  invalid `state` → `invalid_request`; `code_challenge` absent or not exactly
  43 base64url characters, or `code_challenge_method` absent or other than
  `S256` → `invalid_request`; `resource` absent or not byte-identical to the
  audience → `invalid_target`. `scope` and unknown parameters are ignored. A
  valid request returns the consent page (BR-129). Verified by: AC-06, AC-07.
- **BR-129** — Every valid authorization request shows a consent page; no
  consent is remembered. The page states the client's `client_name` labelled
  as self-declared and unverified (or "unnamed client"), the `client_id`, the
  exact `redirect_uri` of the request and the protected resource (audience),
  with every value HTML-escaped. It holds one form posting to
  `<issuer>/oauth/consent` with a hidden one-use consent identifier (32 random
  bytes) and `decision` `approve` or `deny`. The pending request is stored
  under that identifier for 600 seconds, bound to the browser cookie of
  BR-130. Page and error-page responses carry `Cache-Control: no-store`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none';
  base-uri 'none'`. The consent handler consumes the identifier on its first
  presentation whatever the outcome; an unknown, expired or consumed
  identifier, a missing or mismatched cookie, or a `decision` other than
  `approve`/`deny` yields a 400 HTML error page. `deny` produces a client
  redirect with `error=access_denied`; `approve` starts the upstream leg
  (BR-131). Verified by: AC-08, AC-09.
- **BR-130** — Browser binding uses the cookie `__Host-kdrive-oauth` with
  attributes `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` and no
  `Domain`. Its value is 32 random bytes. The authorize handler reuses the
  incoming value when exactly one well-formed `__Host-kdrive-oauth` cookie is
  present, and otherwise sets a new one. Every response that
  creates cookie-bound state (the consent page and the upstream redirect of
  BR-131) carries `Set-Cookie` with the bound value and `Max-Age=600`, so the
  cookie lives at least as long as the state it protects. A pending consent
  and an upstream flow store the SHA-256 of the value, and a presentation
  matches only when the request carries exactly one well-formed
  `__Host-kdrive-oauth` cookie whose SHA-256 equals the stored one
  (constant-time comparison). Verified by: AC-09, AC-12.
- **BR-131** — On consent approval the proxy discovers the upstream provider
  through `<upstream issuer>/.well-known/openid-configuration`, usable only when
  it is a JSON object whose `issuer` equals the configured upstream issuer
  exactly, whose `authorization_endpoint`, `token_endpoint` and `jwks_uri` are
  `https` URLs and whose `code_challenge_methods_supported` lists `S256`; the
  upstream client authentication is `client_secret_basic` when
  `token_endpoint_auth_methods_supported` is absent or lists it, else
  `client_secret_post` when listed, else discovery is unusable. A usable result
  is cached for the life of the process; an unusable or failed one is not
  cached, is retried at most once per 60 seconds, and produces a client
  redirect with `error=temporarily_unavailable`. The proxy then stores an
  upstream flow keyed by a fresh `state` (32 random bytes), valid for 600
  seconds, bound to the browser cookie, the pending request, a fresh PKCE
  verifier (32 random bytes, method `S256`) and a fresh `nonce` (32 random
  bytes), and redirects (302) to the upstream `authorization_endpoint` with
  `response_type=code`, the upstream client ID,
  `redirect_uri=<issuer>/oauth/callback`, `scope=openid` (plus ` email` when the
  email allowlist is nonempty), `state`, `nonce`, `code_challenge` and
  `code_challenge_method=S256`, and no `resource`. Every upstream request uses
  `https` only, follows no redirect, times out after 10 seconds and reads at
  most 65,536 response bytes. Verified by: AC-10, AC-11.
- **BR-132** — The callback handler takes the query parameters and the
  `Cookie` header and checks, in this order: (1) a repeated parameter, or an
  absent, unknown, expired or already-presented `state`, or a cookie mismatch
  (BR-130) yields a 400 HTML error page and no redirect; the flow is consumed
  on its first presentation whatever the outcome; (2) when the upstream
  metadata advertises `authorization_response_iss_parameter_supported` `true`
  `iss` is required, and when `iss` is present it must equal the upstream
  issuer, else a client redirect with `error=server_error`; (3) `code` and
  `error` together, or neither, or an empty `code`, produce a client redirect
  with `error=server_error`; (4) an upstream `error` produces a client
  redirect with `error=access_denied` when it is `access_denied`, else
  `server_error`, and upstream `error_description` and `error_uri` are never
  forwarded; (5) otherwise the proxy exchanges the code at the upstream token
  endpoint with `grant_type=authorization_code`, the code, the callback
  `redirect_uri` and the PKCE verifier, authenticated per BR-131 (Basic
  components form-urlencoded before Base64, RFC 6749 §2.3.1). Steps 2–4 make
  no upstream request. A failed or non-200 exchange, a missing `id_token` or a
  `token_type` other than `Bearer` (case-insensitive) produces a client
  redirect with `error=server_error`. Verified by: AC-12, AC-13.
- **BR-133** — The upstream ID token is accepted only when it is a compact JWS
  without `crit`, whose `alg` is in the F-008 BR-098 list, whose signature
  verifies against a usable key (BR-107) of the upstream JWKS whose `kid`
  equals the token's `kid` when both carry one, whose `alg` equals the token's
  `alg` when the key carries one, and whose key type and curve match the
  `alg` (RSA for `RS*`/`PS*`, P-256 for `ES256`, P-384 for `ES384`, `OKP`
  Ed25519 for `EdDSA`/`Ed25519`); whose `iss` equals the upstream issuer
  exactly; whose `aud` equals the upstream client ID or is an array containing
  it; whose `azp`, when present (and necessarily when `aud` is an array of more
  than one member), equals the upstream client ID; whose `nonce` equals the
  flow's nonce; whose `exp` is a number later than now; whose `iat` is a
  number; whose `nbf`, when present, is not later than now; and whose `sub` is
  a nonempty string of at most 255 bytes. No clock tolerance is applied. The
  JWKS is cached for at most 3,600 seconds; when the token carries a `kid` that
  no cached usable key matches, it is refetched at most once per 60 seconds; a
  token without `kid` triggers no refetch. A rejected ID token produces a
  client redirect with `error=server_error`. The upstream access token,
  refresh token and ID token are discarded after this check and never stored,
  returned or logged. Verified by: AC-14.
- **BR-134** — The identity of an accepted ID token is the pair (upstream
  issuer, `sub`) plus `email` and `email_verified` when present. It is
  authorized when the pair is in `oauthAllowedSubjects` (paired with the
  upstream issuer), or when the email allowlist contains `email` exactly and
  `email_verified` is the boolean `true`. An unauthorized identity produces a
  client redirect with `error=access_denied`, and no code is created.
  Verified by: AC-15.
- **BR-135** — For an authorized identity the proxy creates an authorization
  code (32 random bytes) valid for 60 seconds, bound to the client ID, the
  exact `redirect_uri` of the authorization request, the `code_challenge`,
  the `resource` and the identity, and produces a client redirect with
  `code`. Verified by: AC-13, AC-16.
- **BR-136** — The token handler takes the `Authorization` header and the form
  parameters. Basic credentials are Base64-decoded, split at the first `:` and
  each part form-urlencoded-decoded (RFC 6749 §2.3.1). A repeated parameter,
  Basic together with a body `client_secret`, Basic together with a body
  `client_id` that differs from the Basic one, a malformed Basic header, or no
  client identification yields 400 `{"error":"invalid_request"}`. An unknown
  `client_id`, a method different from the registered one, or a wrong secret
  (SHA-256 compared in constant time) yields 401 `{"error":"invalid_client"}`,
  with `WWW-Authenticate: Basic realm="oauth-token"` when the request used
  Basic. An absent `grant_type` yields 400 `invalid_request`; a `grant_type`
  other than `authorization_code` or `refresh_token` yields 400
  `unsupported_grant_type`; a grant type not registered for the
  client yields 400 `unauthorized_client`. These checks never read or consume
  a code or refresh token. Every token response carries `Cache-Control:
  no-store` and `Pragma: no-cache`, and every error body is exactly
  `{"error":"<code>"}`. Verified by: AC-17.
- **BR-137** — For `authorization_code`, once a request passes BR-136 its code
  is consumed on its first presentation whatever the outcome; a consumed code
  stays in the store, marked consumed, until its 60-second lifetime ends. The
  consumption is committed before the first `await` of the request, so two
  concurrent redemptions yield at most one success. The grant yields 400
  `invalid_grant` when the code is absent or unknown, consumed, expired, bound to
  another client, when `redirect_uri` is absent or not byte-identical to the
  bound one, or when `code_verifier` is not 43–128 unreserved characters
  (RFC 7636) whose S256 value equals the bound challenge; a `resource` that is
  present and differs from the bound one yields 400 `invalid_target`. A
  second presentation of a code that already produced tokens also revokes the
  refresh family created from it. Success returns 200 with `access_token`
  (BR-138), `token_type` `Bearer`, `expires_in` `3600` and, when the client
  registered `refresh_token`, a `refresh_token` starting a new family
  (BR-139). Verified by: AC-16, AC-18.
- **BR-138** — An access token is a compact JWS signed with the configured key,
  header `{"alg":"ES256","typ":"at+jwt","kid":<BR-124 kid>}`, payload `iss`
  (proxy issuer), `sub` (upstream `sub`), `upstream_iss` (upstream issuer),
  `aud` (audience string), `client_id`, `iat` (now, seconds), `exp` (`iat` +
  3600), `jti` (16 random bytes) and, only when the email allowlist is
  nonempty and the identity has an email, `email` and `email_verified` copied
  from the ID token. It carries no `nonce` and no `scope`.
  Verified by: AC-19.
- **BR-139** — A refresh token is 32 random bytes, stored only as its SHA-256
  with its family, client ID, identity, resource, issue time and state
  (current or rotated). A family's absolute expiry is its creation + 30 days;
  a token's inactivity expiry is its issue + 7 days; a token is usable while
  now is before both. Each successful refresh marks the presented token as
  rotated and issues a new token in the same family; rotation never extends
  the family's absolute expiry. Rotated tokens stay recorded until the family
  ends so that reuse is detected. Verified by: AC-20, AC-21.
- **BR-140** — For `refresh_token`, after BR-136, checks run in this order:
  (1) an absent or unknown token, or a token of a revoked family, yields 400
  `invalid_grant`; (2) a rotated token, or a token presented by another client
  than its family's, revokes every token of its family and yields 400
  `invalid_grant`, whether or not it is also expired; (3) an expired token
  (BR-139) yields 400 `invalid_grant` and marks its family revoked, so later
  tokens of it hit step (1) and at most one `refresh_family_revoked` event is
  logged per family; (4) a `resource`
  that is present and differs from the family's yields 400 `invalid_target`
  without rotation. The rotation is committed before the first `await` of the
  request, so two concurrent presentations of one token produce one success
  and one family revocation; the winner's new refresh token then belongs to a
  revoked family and is refused (RFC 9700 §4.14.2). Success returns 200 with
  the same members as BR-137 success: a new access token (BR-138) for the
  family's identity and client, `token_type` `Bearer`, `expires_in` `3600` and
  the new `refresh_token`. Already issued access tokens stay valid until their
  `exp`. Verified by: AC-21, AC-22.
- **BR-141** — `createAccessTokenValidator` accepts an optional
  `upstreamIssuer` (BR-100 v2). With it, a token whose `upstream_iss` is absent
  or not equal to it is rejected with 401 `issuer` right after the `iss` check,
  the subject allowlist is matched against (`upstreamIssuer`, `sub`), and the
  success identity is (`upstreamIssuer`, `sub`); without it, F-008 behaviour is
  unchanged. The proxy verifier is that validator created with the proxy
  issuer, the audience, a JWKS holding only the public key of the configured
  signing key (with its `kid`), both allowlists and `upstreamIssuer` set to the
  upstream issuer; it never accepts an upstream token. Verified by: AC-19,
  AC-23.
- **BR-142** — All proxy state (clients, pending consents, upstream flows,
  codes, refresh families, discovery and JWKS caches) lives in the memory of
  one proxy instance; a new instance starts empty, so its token handler
  answers 401 `invalid_client` to a client registered with a previous instance
  and its verifier accepts access tokens of a previous instance only when
  created from the same key. Each store holds at most 1,000 live entries;
  expired entries are purged before a write. A full client store evicts the
  client with the oldest last use (registration, authorization or token
  request) together with its codes and refresh families; a full consent, flow
  or code store refuses the new entry (consent: 503 HTML error page; flow:
  client redirect `temporarily_unavailable`; code: client redirect
  `server_error`); a full family store evicts the family with the oldest
  creation. Verified by: AC-24, AC-25.
- **BR-143** — The optional logger receives only a fixed event name from the
  list in Contract details and fields limited to: handler name, OAuth error
  code, HTTP status, store name and count. No handler response, error page,
  thrown error message or logger call contains a client secret, upstream
  secret, authorization code, PKCE verifier, `nonce`, upstream `state`, client
  `state`, cookie value, access, refresh or ID token, `client_id`, identity
  value or signing-key material, except the response that issues that value
  to its holder (registration response, consent page, code redirect, token
  response, upstream redirect `state`/`nonce`/challenge, `Set-Cookie`, and the
  client redirect's echoed `state`). Verified by: AC-26.

## Contract details

### Handler surface (consumed by P-12)

```ts
createOAuthProxy(options: {
  config: EffectiveProxyConfig;          // F-002 proxy fields + key bytes + secret
  clock: () => Date;
  randomBytes: (size: number) => Uint8Array;
  upstream: UpstreamOidcPort;            // production: createFetchUpstream(...)
  logger?: { event(name: ProxyEvent, fields: Record<string, string | number>): void };
}) -> {
  metadataPaths: readonly string[];      // BR-125
  metadata(): ProxyResponse;
  register(input: { body: string }): Promise<ProxyResponse>;
  authorize(input: { query: URLSearchParams; cookie?: string }): Promise<ProxyResponse>;
  consent(input: { form: URLSearchParams; cookie?: string }): Promise<ProxyResponse>;
  callback(input: { query: URLSearchParams; cookie?: string }): Promise<ProxyResponse>;
  token(input: { authorization?: string; form: URLSearchParams }): Promise<ProxyResponse>;
  verifier: AccessTokenValidator;        // BR-141
}

createProductionPorts() -> { clock; randomBytes }   // BR-124
createFetchUpstream({ fetch }) -> UpstreamOidcPort  // BR-131 bounds

ProxyResponse = { status: number; headers: Array<[string, string]>; body: string }

UpstreamOidcPort = {
  fetchJson(url: string): Promise<{ status: number; json: unknown }>;
  postForm(url: string, form: URLSearchParams, authorization?: string):
    Promise<{ status: number; json: unknown }>;
}
```

`ProxyEvent` is one of `registration_refused`, `authorization_refused`,
`consent_refused`, `upstream_unavailable`, `callback_refused`,
`id_token_refused`, `identity_refused`, `token_refused`,
`refresh_family_revoked`, `store_full`.

`URLSearchParams` preserves repeated keys, so handlers detect repetitions.
Handlers never throw for client input; they throw only for programming or
configuration errors. P-12 maps routes as follows:

| Handler | Method and URL |
| --- | --- |
| `metadata` | GET each `metadataPaths` entry on the issuer origin |
| `register` | POST `<issuer>/oauth/register` (JSON) |
| `authorize` | GET `<issuer>/oauth/authorize` |
| `consent` | POST `<issuer>/oauth/consent` (form) |
| `callback` | GET `<issuer>/oauth/callback` |
| `token` | POST `<issuer>/oauth/token` (form) |

The owner registers `<issuer>/oauth/callback` as the redirect URI of the static
upstream client.

### Flow summary

1. Client registers (BR-127) with redirect URIs from the allowlist.
2. Client opens `authorize` (BR-128) → consent page and browser cookie
   (BR-129, BR-130).
3. User approves → upstream redirect with proxy `state`, `nonce`, PKCE and a
   refreshed cookie (BR-130, BR-131).
4. Upstream redirects to `callback` (BR-132) → ID-token verification (BR-133) →
   identity authorization (BR-134) → code redirect to the client with `iss`
   (BR-135).
5. Client exchanges the code (BR-136, BR-137) → access JWT (BR-138) + refresh
   token (BR-139); later refreshes rotate (BR-140).
6. P-12 verifies each MCP request with `verifier` (BR-141).

### Times and bounds

| Item | Lifetime | Store bound |
| --- | --- | --- |
| Client registration | process lifetime | 1,000 (oldest last use evicted) |
| Browser cookie | 600 s, refreshed by each state-creating response | — |
| Pending consent | 600 s, one use | 1,000 (refuse) |
| Upstream flow (`state`) | 600 s, one use | 1,000 (refuse) |
| Authorization code | 60 s, one use, kept consumed until expiry | 1,000 (refuse) |
| Access JWT | 3,600 s, stateless | — |
| Refresh token | 7 days inactivity, family 30 days absolute | 1,000 families (oldest evicted) |
| Upstream discovery | process lifetime once usable; retry ≥ 60 s | — |
| Upstream JWKS | ≤ 3,600 s; `kid`-miss refetch ≥ 60 s apart | — |

## Acceptance criteria

All tests use a fake clock, a deterministic random source, a fake
`UpstreamOidcPort`, a capturing logger and synthetic P-256 keys generated in
memory per run; none reads a real secret or contacts a network host.

- **AC-01** (BR-124) — Given a synthetic PKCS#8 P-256 PEM, When the proxy is
  constructed, Then no port is called and the `kid` equals the RFC 7638
  thumbprint, identical across two constructions; Given a P-384 key, an RSA
  key, an Ed25519 key, a public-key PEM, two PEM blocks and random bytes, Then
  construction raises `AuthConfigurationError` whose message equals the fixed
  BR-124 string and contains no 16-byte substring of the input; `createProductionPorts().randomBytes` is `node:crypto` `randomBytes`.
  Verified by: `tests/auth/proxy-construction.test.ts`.
- **AC-02** (BR-125) — Given issuers `https://mcp.test` and
  `https://mcp.test/mcp`, When metadata is requested, Then the members equal
  BR-125 exactly (endpoints `https://mcp.test/mcp/oauth/...` in the second
  case), `authorization_response_iss_parameter_supported` is `true`, no CIMD
  member exists, and `metadataPaths` is
  `["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]`
  and `["/.well-known/oauth-authorization-server/mcp",
  "/.well-known/openid-configuration/mcp", "/mcp/.well-known/openid-configuration"]`
  respectively. Verified by: `tests/auth/proxy-metadata.test.ts`.
- **AC-03** (BR-126) — Given reference `http://127.0.0.1/callback`, Then
  `http://127.0.0.1:53121/callback` and `http://127.0.0.1:1/callback` match,
  and `http://127.0.0.1:0/callback`, `http://127.0.0.1:65536/callback`,
  `http://127.0.0.1:80.evil/callback`, `http://127.0.0.1.evil.com/callback`,
  `http://localhost:53121/callback`, `http://127.0.0.1:53121/callback/`,
  `http://127.0.0.1:53121/Callback` do not; Given reference
  `http://[::1]:8080/cb`, Then `http://[::1]:9/cb` matches; Given reference
  `http://localhost/callback`, Then `http://localhost:49152/callback` matches
  and `http://LOCALHOST:49152/callback`, `http://localhost.evil.com/callback`,
  `http://127.0.0.1:49152/callback` and `http://localhost:49152/callback?x=1`
  do not; Given reference `https://claude.ai/api/mcp/auth_callback`, Then
  `https://claude.ai:443/api/mcp/auth_callback`,
  `https://CLAUDE.ai/api/mcp/auth_callback` and the same URL with `?x=1` do not
  match. Verified by: `tests/auth/proxy-redirect.test.ts`.
- **AC-04** (BR-127) — Given an allowlist with the claude.ai callback,
  `http://127.0.0.1/callback` and `http://localhost/callback`, When a client
  registers each with methods absent, `none`, `client_secret_post`, and
  `http://localhost:8123/callback`, Then 201 with a 43-character `client_id`,
  method `client_secret_basic`/`none`/`client_secret_post`, a `client_secret`
  only for secret methods, `client_secret_expires_at` `0`,
  `Cache-Control: no-store`, and an unknown member `logo_uri` not echoed.
  Verified by: `tests/auth/proxy-registration.test.ts`.
- **AC-05** (BR-127) — Given registrations with an unlisted redirect URI, an
  empty or 11-item list, `http://LOCALHOST/callback`, `grant_types`
  `["implicit"]` or `["refresh_token"]`, `response_types` `["token"]`, method
  `private_key_jwt`, a 201-character `client_name`, a non-object body and a
  16,385-byte body, Then each yields 400 with `invalid_redirect_uri` or
  `invalid_client_metadata` as BR-127 states, and no client is stored.
  Verified by: `tests/auth/proxy-registration.test.ts`.
- **AC-06** (BR-128) — Given an unknown `client_id`, a `redirect_uri` absent or
  not registered (altered path, altered host, extra query) or a repeated
  `client_id`, When authorizing, Then 400 HTML with no `Location` header.
  Verified by: `tests/auth/proxy-authorize.test.ts`.
- **AC-07** (BR-128) — Given a known client and matching redirect, When
  `response_type=token`, `code_challenge_method=plain` or absent,
  `code_challenge` absent or of 42 characters, `resource` absent or
  `https://other.test`, a 1,025-byte `state`, or a `state` containing `%0D%0A`,
  Then 302 to the redirect URI with the BR-128 error and `iss` equal to the
  proxy issuer; the `state` is echoed in the valid-state cases and absent from
  `Location` in the two invalid-state cases; a valid `state` `a&b#c%d é`
  round-trips byte for byte after form-decoding. Verified by:
  `tests/auth/proxy-authorize.test.ts`.
- **AC-08** (BR-129) — Given a client named `<script>alert(1)</script>`, When
  a valid authorization request is made twice, Then each response is a 200
  consent page with the escaped name, the "unverified" label, the exact
  redirect URI, a distinct consent identifier and the four BR-129 security
  headers; Given `decision=deny`, Then a client redirect with
  `error=access_denied`, `state` and `iss`. Verified by:
  `tests/auth/proxy-consent.test.ts`.
- **AC-09** (BR-129, BR-130) — Given a pending consent, When it is posted
  without the cookie, with another cookie value, with two cookies of that
  name, after 600 s, a second time, or with `decision=maybe`, Then 400 HTML
  and no upstream redirect; the first failed presentation also makes a later
  correct one fail. The authorize response sets `__Host-kdrive-oauth` with
  exactly the BR-130 attributes, reuses a single well-formed incoming value and
  sets a new value when two such cookies or a malformed one arrive; the
  approval redirect re-sends `Set-Cookie` with the same value and
  `Max-Age=600`. Verified by: `tests/auth/proxy-consent.test.ts`.
- **AC-10** (BR-131) — Given upstream metadata variants (issuer with trailing
  slash, `http` token endpoint, no `S256`, auth methods `["none"]`), When a
  consent is approved, Then a client redirect with
  `error=temporarily_unavailable`; a second approval within 60 s makes no
  upstream request, one after 60 s does. Given Infomaniak-shaped metadata
  (S256, `client_secret_basic` and `client_secret_post`, no RFC 9207), Then
  discovery is cached and the upstream redirect carries exactly the BR-131
  parameters, a 43-character `state` and `nonce`, a verifier-derived
  43-character challenge and no `resource`.
  Verified by: `tests/auth/proxy-upstream.test.ts`.
- **AC-11** (BR-131) — Given the production `createFetchUpstream` with an
  injected `fetch`, When it is asked for an `http` URL, a response that
  redirects, a response over 65,536 bytes or one that does not finish in
  10 s (fake timers), Then each fails without retry and the client receives
  `temporarily_unavailable` or `server_error` per BR-131/BR-132.
  Verified by: `tests/auth/proxy-upstream.test.ts`.
- **AC-12** (BR-130, BR-132) — Given a flow, When the callback arrives with an
  altered `state`, no `state`, the right `state` after 600 s, the right
  `state` a second time, no cookie or another browser's cookie, Then 400 HTML
  without redirect and no upstream token request. Given authorize at `t`,
  approval at `t + 599 s` and callback at `t + 1,198 s` with the cookie the
  approval re-sent, Then the callback succeeds. Verified by:
  `tests/auth/proxy-callback.test.ts`.
- **AC-13** (BR-132, BR-135) — Given a valid callback, When the upstream
  advertises RFC 9207 and `iss` is absent, or `iss` is `https://evil.test`,
  or both `code` and `error` are present, or neither, or `code` is empty,
  Then a client redirect with `server_error` and no upstream request; When
  the upstream returns `error=access_denied` with an `error_description`, or
  `error=login_required`, Then `access_denied` (no description) or
  `server_error`; When the exchange returns 400, no `id_token` or
  `token_type` `mac`, Then `server_error`; each with `state` and `iss`. The
  code exchange uses Basic with form-urlencoded components. Given a client
  redirect URI with query `?a=1`, Then the success redirect keeps `a=1` and
  adds `code`, `state`, `iss`. Verified by: `tests/auth/proxy-callback.test.ts`.
- **AC-14** (BR-133) — Given synthetic upstream ID tokens with a wrong
  signature, `alg` `HS256`, a `crit` header, `iss` with a trailing slash, `aud`
  another client, an `aud` array without `azp`, a single `aud` with `azp`
  another client, a wrong `nonce`, `exp` equal to now, no `iat`, `nbf` in the
  future, an empty `sub` and a 256-byte `sub`, Then each produces
  `server_error` and no code; an unknown `kid` triggers one JWKS refetch, a
  second within 60 s none, and a token without `kid` none. Verified by:
  `tests/auth/proxy-id-token.test.ts`.
- **AC-15** (BR-134) — Given allowlists, When the ID token identity is an
  allowed `sub`, an allowed email with `email_verified` `true`, the same email
  with `email_verified` `"true"` or absent, or an unlisted `sub`, Then the
  first two produce a code and the others a client redirect with
  `access_denied` and no code. Verified by: `tests/auth/proxy-callback.test.ts`.
- **AC-16** (BR-135, BR-137) — Given a code issued at `t`, When it is redeemed
  at `t + 59.999 s`, Then it succeeds; at `t + 60 s`, Then `invalid_grant`.
  Verified by: `tests/auth/proxy-token.test.ts`.
- **AC-17** (BR-136) — Given registered clients of each method, When the
  token request has an unknown `client_id`, a wrong secret, Basic for a `post`
  client, both Basic and body secret, Basic and a different body `client_id`,
  a repeated `code`, `grant_type=password`, or `refresh_token` for a client
  without that grant, Then 401 `invalid_client` (with
  `WWW-Authenticate: Basic realm="oauth-token"` for Basic requests), 400
  `invalid_request`, 400 `unsupported_grant_type` or 400 `unauthorized_client`
  as BR-136 states, each body exactly `{"error":…}` with `no-store` headers,
  and a code used in any of these requests still redeems afterwards. A Basic
  client ID and secret containing `%3A` and `+` authenticate after decoding.
  Verified by: `tests/auth/proxy-token.test.ts`.
- **AC-18** (BR-137) — Given a code, When it is redeemed with another client's
  credentials, an absent or altered `redirect_uri` (other loopback port
  included), a wrong verifier, a 42-character verifier, or
  `resource=https://other.test`, Then `invalid_grant` (or `invalid_target`)
  and a later correct redemption also fails; When a correct redemption is
  followed by a second one, Then the second yields `invalid_grant` and the
  refresh token from the first is rejected; When two redemptions start before
  either resolves, Then exactly one succeeds. Verified by:
  `tests/auth/proxy-token.test.ts`.
- **AC-19** (BR-138, BR-141) — Given a successful redemption, Then the access
  token header and payload hold exactly the BR-138 members, `exp − iat` is
  3600, and the proxy verifier accepts it with identity (upstream issuer,
  `sub`) at `exp − 1 s` and rejects it 401 `expired` at `exp`; a token
  re-signed with `aud` `https://other.test` yields 401 `audience`; with
  `upstream_iss` altered or absent, 401 `issuer`. Verified by:
  `tests/auth/proxy-token.test.ts`.
- **AC-20** (BR-139) — Given a family created at `t`, When refreshing every
  6 days, Then refresh succeeds until the absolute bound and the token
  presented at or after `t + 30 days` yields `invalid_grant`; Given a token
  issued at `u` and unused, Then it works at `u + 7 days − 1 ms` and yields
  `invalid_grant` at `u + 7 days` (separate fixtures). Verified by:
  `tests/auth/proxy-refresh.test.ts`.
- **AC-21** (BR-139, BR-140) — Given a refresh token R1 rotated into R2, When
  R1 is presented again, Then `invalid_grant` and R2 and every later token of
  the family also yield `invalid_grant`; the same holds when R1 is presented
  after its inactivity expiry; Given R2 presented by another registered
  client, Then `invalid_grant` and the family is revoked; a successful refresh
  body holds `access_token`, `token_type` `Bearer`, `expires_in` `3600` and
  `refresh_token`. Verified by: `tests/auth/proxy-refresh.test.ts`.
- **AC-22** (BR-140) — Given R1, When two refresh requests with R1 start
  before either resolves, Then exactly one succeeds, the family is revoked and
  the winner's new refresh token yields `invalid_grant`; Given
  `resource=https://other.test`, Then `invalid_target` and R1 still works
  once. Verified by: `tests/auth/proxy-refresh.test.ts`.
- **AC-23** (BR-141, BR-100 v2) — Given the extended validator, When created
  without `upstreamIssuer`, Then the F-008 access-token tests pass unchanged;
  When the proxy verifier receives a synthetic upstream-style token (issuer =
  upstream, signed by an upstream key), an upstream ID token, or a proxy token
  whose `sub` is unlisted, Then 401 `signature`/`id-token` and 403 `identity`
  respectively. Verified by: `tests/auth/access-token.test.ts`,
  `tests/auth/proxy-verifier.test.ts`.
- **AC-24** (BR-142) — Given instance A that registered a client and issued
  tokens, When instance B is constructed with the same configuration and key,
  Then B's token handler answers 401 `invalid_client` for both grants of that
  client and B's verifier accepts A's access token until its `exp`; Given
  instance C with another synthetic key, Then C's verifier rejects A's token
  with 401 `signature`. Verified by: `tests/auth/proxy-restart.test.ts`.
- **AC-25** (BR-142) — Given 1,000 live clients, When one more registers, Then
  the client with the oldest last use is evicted with its refresh families;
  Given 1,000 live pending consents, flows or codes, Then the next entry is
  refused as BR-142 states; Given expired entries filling a store, Then a new
  entry is accepted after the purge. Verified by:
  `tests/auth/proxy-bounds.test.ts`.
- **AC-26** (BR-143) — Given a full flow with recognizable synthetic values
  for secrets, codes, verifier, nonce, states, cookie, tokens, client ID,
  identity and key, When every handler path of AC-04–AC-25 runs with a
  capturing logger, Then every logger call uses a listed event name and only
  the allowed fields, and no response body, header (other than the issuing
  response), thrown message or logger call contains any of these values.
  Verified by: `tests/auth/proxy-secrecy.test.ts`.
- **AC-27** (BR-024 v2, F-002 v3) — Given proxy configuration with redirects
  `http://localhost/cb,http://localhost:8765/callback`, Then both strings are
  retained byte for byte; Given `http://127.1/cb`, `http://LOCALHOST/cb` or
  `http://localhost./cb`, Then `INVALID_VALUE/oauthAllowedRedirectUris`.
  Verified by: `tests/config.test.ts` (`BR-024 v2` rows).

Gate: `make check` (tests, lint, format, typecheck, build) inside the dev
service. Every BR has a test naming it (`BR-1NN`).

## Decisions

- **D-1 — Transport-independent handlers.** P-21 precedes P-12, so the proxy
  ships as pure handlers returning `{status, headers, body}`; P-12 mounts them.
  Rejected: building the HTTP listener here (duplicates P-12 scope and its
  Origin/rate/size rules); a framework adapter (couples the contract to one
  library).
- **D-2 — Proxy tokens verified by the F-008 validator** with an optional
  `upstreamIssuer` (BR-100 v2). One validator keeps one set of algorithm,
  `crit`, ID-token and expiry rules. Rejected: a second validator (divergence);
  putting the upstream issuer in `iss` (would make proxy tokens look like
  upstream tokens and break issuer distinction).
- **D-3 — Identity carried as `sub` + `upstream_iss`** (D-05). `sub` stays the
  upstream subject so allowlists keep SPEC §8 semantics. Rejected: a
  proxy-minted pseudonymous `sub` with a server-side mapping (lost on restart,
  breaking surviving access tokens).
- **D-4 — ES256 only, PKCS#8 PEM, RFC 7638 `kid`.** Small, standard,
  owner-provisionable with common tools; a deterministic `kid` lets tokens
  survive a restart with the same key and makes a replaced key fail
  verification. Rejected: RSA (larger keys, more parameters to qualify),
  Ed25519 as a second accepted type (a second code and test path with no
  benefit, since only the proxy verifies its tokens), a JWK file (no common
  tooling), a random `kid` per start (would break the restart contract).
- **D-5 — Consent on every authorization**, labelled self-declared client
  name, exact redirect URI. Open dynamic registration plus a static upstream
  client is the MCP confused-deputy case; remembering consent would let a newly
  registered client ride an earlier approval. Rejected: remembered consent per
  client or per browser (state across restart, larger attack surface).
- **D-6 — Loopback port variance on `127.0.0.1`, `[::1]` and `localhost`
  (owner decision 2026-11-03, supersedes the v1 draft that excluded
  `localhost`).** RFC 8252 §7.3 requires port variance for loopback
  redirects; Codex needs it, and Claude Code documents
  `http://localhost:<port>/callback`. Scheme, host, path and query stay exact;
  only the port varies, and only on these three hosts written exactly so. This
  clarifies SPEC §8 "comparaison exacte" (amended in this revision) and fills
  the gap F-002 v2 deliberately left ("no … variable-port authorization is
  implied"); admitting `localhost` needs F-002 v3 / BR-024 v2 (Scope 10).
  RFC 8252 §8.3 prefers IP literals because `localhost` may resolve
  elsewhere; the risk is accepted for client compatibility, and
  `docs/oauth-proxy.md` recommends `127.0.0.1` entries when a client allows
  it. Rejected: IP literals only (Claude Code may not connect); variance on
  any HTTP host (open redirect to non-loopback hosts).
- **D-7 — Browser binding by a `__Host-` cookie with `SameSite=Lax`,
  refreshed by each state-creating response.** Lax is required because the
  upstream callback is a cross-site top-level GET; the `__Host-` prefix forbids
  `Domain` and forces `Secure` and `Path=/`. The cookie holds a random browser
  identifier and flows store its hash, so concurrent flows in one browser
  work. Refreshing at approval keeps the cookie alive for the full flow
  lifetime. Rejected: `SameSite=Strict` (cookie not sent on the callback),
  binding by IP or User-Agent (unstable, spoofable), a signed stateless cookie
  (needs a second secret), a longer fixed `Max-Age` (outlives its state).
- **D-8 — Every presentation consumes state, consent and code**, even when it
  fails (codes once client authentication passed). Rejected: consuming only on
  success (allows online guessing against a known identifier and replay after
  a partial failure); consuming a code on a failed client authentication (lets
  anyone holding a leaked `client_id` burn codes).
- **D-9 — `resource` required at `/authorize` with `invalid_target` when
  absent, optional but checked at `/token`; `redirect_uri` required at both.**
  MCP authorization requires clients to send `resource` and `redirect_uri`;
  `invalid_target` is used for absence too, so a client sees one error for any
  unacceptable target (RFC 8707 reserves it for unacceptable values; absence is
  treated as an unacceptable target here). At the token endpoint the code
  binding already fixes `resource`. Cross-feature dependency: MCP clients take
  `resource` from the protected-resource metadata, so P-12 must publish
  `resource` byte-identical to the audience string, otherwise every client
  receives `invalid_target`. Rejected: defaulting a missing `resource`
  to the audience (hides non-conformant clients); allowing `redirect_uri`
  omission as OAuth 2.1 drafts permit with PKCE (owner-run client acceptance
  will show whether a client omits it; a change then needs a new version).
- **D-10 — Supported client authentication `none`, `client_secret_basic`,
  `client_secret_post`.** Maximizes compatibility with dynamic-registration
  clients; PKCE is mandatory for all. Rejected: `none` only (RFC 7591 default
  is `client_secret_basic`; rewriting a requested method is error-prone for
  clients); `private_key_jwt` (only needed with CIMD, out of scope).
- **D-11 — No `resource` sent upstream; upstream access token discarded.** The
  upstream does not support RFC 8707 and the proxy needs only the ID token.
  Rejected: forwarding `resource` (meaningless upstream audience) or storing
  the upstream token (no use; secret at rest).
- **D-12 — Allowlists checked at login and by the verifier on every request;
  not again at refresh.** Allowlists are immutable for a process and refresh
  state does not survive a restart, so a refresh-time recheck would be
  untestable dead code. Rejected: a refresh-time recheck.
- **D-13 — Reuse of a redeemed code revokes the family it created**
  (RFC 6749 §4.1.2). Access tokens already issued cannot be revoked
  statelessly and expire within one hour; accepted for v1.
- **D-14 — Bounded stores of 1,000 entries.** Prevents unbounded memory from
  open registration until P-12 rate limits exist. Residual risk, recorded in
  `docs/oauth-proxy.md` and `BACKLOG.md`: unauthenticated registrations can
  evict the owner's client (forcing re-registration) and about 1.7
  authorization requests per second keep the consent store full, and as many
  consent approvals (needing no login, only the attacker's own consent
  identifier and cookie) keep the flow store full, until P-12 rate-limits
  `/oauth/register`, `/oauth/authorize` and `/oauth/consent`. Rejected: unbounded
  stores; refusing new clients when full (would lock the owner out after
  abuse).
- **D-15 — No CIMD in v1.** Every matrix client documents dynamic
  registration. Rejected: implementing CIMD now (fetching client-hosted
  documents adds SSRF surface with no verified need).
- **D-16 — Error pages, not redirects, for unverified redirect targets and
  callback-state failures.** Redirecting with an unverified URI or without a
  trustworthy flow would make the proxy an open redirector. Rejected: a
  generic redirect to the client.
- **D-17 — Logging through an optional port with fixed events.** Keeps BR-143
  testable and the proxy silent by default. Rejected: no logging at all (no
  operator signal for refused flows or family revocations); free-text logs
  (secret leakage risk).
- **D-18 — OIDC discovery aliases.** MCP clients probe RFC 8414 and OIDC
  well-known forms; serving the same document at each avoids a P-12 contract
  gap. The document is not an OIDC provider configuration (no ID tokens to
  clients) and lacks OIDC Discovery required members; `docs/oauth-proxy.md`
  says a strict OIDC client may reject the alias. Rejected: RFC 8414 path only.

## Open questions

None.

## Stress-test

### Round 1 — reviewed SHA `348c03c30ec090b0327a1adb72c50e37247b5d49`

Review: runs/21-spec-review-1.md (archived evidence `runs/21-spec-review-1.md`), verdict
`changes`, 0 critical, 4 major, 11 minor.

| Finding | Severity | Decision | Change |
| --- | --- | --- | --- |
| R1-01 | major | Retained | SPEC §8 amended in French (loopback port exception); D-6 states it clarifies SPEC §8 and the gap F-002 left; Scope 11. |
| R1-02 | major | Retained | BR-130: every state-creating response, including the approval redirect, re-sends `Set-Cookie` with `Max-Age=600`; AC-09 and AC-12 add the long-flow case. |
| R1-03 | major | Retained | "Client redirect" defined once: `state` echoed only when present and valid; BR-128 defines validity and check order; AC-07 asserts absence for invalid states. |
| R1-04 | major | Retained | Optional `logger` port with fixed `ProxyEvent` names and allowed fields (BR-143, D-17); AC-26 checks the logger calls. |
| R1-05 | minor | Retained | BR-132 fixes the check order and the `code`/`error` combinations; AC-13 extended. |
| R1-06 | minor | Retained | BR-133: `azp` checked whenever present, key selection stated inline, no refetch without `kid`; AC-14 extended. |
| R1-07 | minor | Retained | BR-136: `realm="oauth-token"`, percent-decoding of Basic parts, Basic/body `client_id` mismatch → `invalid_request`; AC-17 extended. |
| R1-08 | minor | Retained | BR-140: success body as BR-137, explicit check order (rotated before expired), race winner's token refused; AC-21/AC-22 extended. |
| R1-09 | minor | Retained | BR-136/BR-137: BR-136 failures never touch the code; consumed codes kept until expiry; consumption before first `await`; `redirect_uri` required (D-9); AC-17/AC-18 extended. |
| R1-10 | minor | Retained | BR-128: absent challenge/method explicit; absent `resource` keeps `invalid_target` with the reason in D-9; `redirect_uri` always required, stated as deliberate. |
| R1-11 | minor | Retained | Random-value encoding defined once (nonce 43 characters); discovery restart note in `docs/oauth-proxy.md` (Scope 8); `createProductionPorts()` wires `node:crypto` `randomBytes` (BR-124, AC-01). |
| R1-12 | minor | Resolved by owner decision | Owner accepted `localhost` on 2026-11-03: D-6 rewritten, BR-126 covers `localhost`, F-002 v3 / BR-024 v2 (Scope 10, AC-27). No residual client-coverage consequence to record. |
| R1-13 | minor | Retained | Residual flooding risk recorded in D-14, `docs/oauth-proxy.md` and a `BACKLOG.md` line; P-12 rate limits named as dependency (Out of scope). |
| R1-14 | minor | Retained | BR-141 rejects absent `upstream_iss`; AC-19 tests absence; Scope 5 names the BR-100 v2 History content and the F-008 version note. |
| R1-15 | minor | Retained | `metadataPaths` lists RFC 8414 and both OIDC forms (BR-125, D-18, AC-02); IDs re-checked on `origin/main` `ca6f387`, unchanged. |

### Round 2 — reviewed SHA `520a15b`

Review: runs/21-spec-review-2.md (archived evidence `runs/21-spec-review-2.md`), verdict
`approve`, 0 major, 9 minor. All minors applied as proposed.

| Finding | Severity | Decision | Change |
| --- | --- | --- | --- |
| R2-01 | minor | Retained | AC-01: fixed BR-124 message, no 16-byte substring of the input. |
| R2-02 | minor | Retained | BR-136: absent `grant_type` → `invalid_request`; BR-137/BR-140: absent `code`/`refresh_token` treated as unknown → `invalid_grant`. |
| R2-03 | minor | Retained | BR-130: reuse only when exactly one well-formed cookie; AC-09 adds two-cookie and malformed cases. |
| R2-04 | minor | Retained | `/oauth/consent` added to D-14 residual risk, Scope 8 BACKLOG dependency and the P-12 rate-limit item. |
| R2-05 | minor | Retained | Client-redirect parameters appended as percent-encoded form pairs; AC-07 round-trips `a&b#c%d é`. |
| R2-06 | minor | Retained | BR-140 step 3 marks the family revoked (single revocation event). |
| R2-07 | minor | Retained | BR-024 Source line names v2 / F-002 v3; Scope 10 names `src/config-values.ts:160` and the spec-index BR-024 row. |
| R2-08 | minor | Retained | D-9 states the P-12 dependency: published `resource` byte-identical to the audience. |
| R2-09 | minor | Retained | Scope 8 and D-18: `docs/oauth-proxy.md` notes that strict OIDC clients may reject the alias. |

Round 3 (report (archived evidence `runs/21-spec-review-3.md`), diff `520a15b..c4d95c1`,
verdict `approve`, 2 minor). Retained as test readings without contract change:
R3-01 — the absent `grant_type`/`code`/`refresh_token` cases of BR-136/BR-137/
BR-140 are asserted under AC-17/AC-18/AC-21; R3-02 — AC-01 is verified as "one
message identical across all failing inputs".

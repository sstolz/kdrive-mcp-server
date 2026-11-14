---
id: F-031
title: OAuth proxy pages in English and French
ticket: "#31"
status: draft
version: 1
---

# F-031 — OAuth proxy pages in English and French

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` (main `3ff195b`).
IDs: F-031; BR-404–BR-410 v1; BR-129 v4; BR-393 v3; BR-399 v2; BR-402 v2;
BR-403 v2. No ADR: the change is confined to page texts, one query parameter
that only selects a language and one header read, all cheap to reverse.
Next free IDs checked on main (`docs/spec-index.md`, `business-rules/`):
F-031, BR-404, ADR-012.

## Context

In `proxy` mode the OAuth proxy serves HTML pages from
`src/auth/proxy/pages.ts`, routed in `src/auth/proxy/proxy.ts`: the consent
page (BR-129 v3, BR-393 v2, BR-402) and the 400/503 error pages (BR-403).
F-030 gave them one frame (BR-399–BR-401), all in English (`<html lang="en">`).

Owner decisions (#31, 2026-11-14): languages English and French; the default
comes from the `Accept-Language` request header, with English as fallback; the
choice is carried in the URL (`?lang=en` / `?lang=fr`), never in a cookie,
and nothing is stored; a switcher shows each language's full name in its own
language ("English", "Français"), no flags; no external dependency; CSP
unchanged (one style hash, any switcher CSS in the same static stylesheet);
the French security texts (intro, unverified notices, loopback line, password
note, error sentences) say the same thing as the English ones; the only cookie
stays the strictly necessary `__Host-kdrive-oauth` (BR-130).

How each page is reached (verified in `proxy.ts` and `src/http/handler.ts`):

| Page | Request | Handler |
| --- | --- | --- |
| Consent page (200) | `GET /oauth/authorize` | `authorizeNow` / `authorizeCimd` → `admit` |
| Error page `invalid_request` 400, `busy` 503 | `GET /oauth/authorize` | `refusePage`, `metadataRefused`, store full in `admit` |
| Error page `consent` 400, `busy` 503 | `POST /oauth/consent` | `consent` |
| Error page `callback` 400, `busy` 503 | `GET /oauth/callback` | `callback` (consumes the flow on every visit) |

Each authorize GET that reaches `admit` creates a new pending consent (32
random bytes, 600 s, bound to the BR-130 cookie hash; BR-142 store bound 1000)
and consumes one slot of the process-wide authorize window (BR-162, 30 per
minute). A switcher link that simply reloaded authorize would leave the
previous pending consent behind; BR-409 replaces it instead. An error page
never contains a request value (BR-143, BR-403), so it cannot carry a link
that rebuilds the request; error pages therefore get no switcher (D-2).

Users affected: whoever authorizes an MCP client against a server run in
`proxy` mode. OAuth clients are unaffected: they never send `lang`, and no
response to them (redirects, JSON) changes.

## Scope

- New `src/auth/proxy/language.ts`: the `Language` type (`"en" | "fr"`), the
  `lang` parameter reading (BR-405) and `Accept-Language` parsing (BR-406),
  the page-language resolution (BR-404).
- `src/auth/proxy/pages.ts`: the message catalogue (BR-407), the
  language-dependent shell and texts (BR-399 v2, BR-402 v2, BR-403 v2), the
  switcher (BR-408) and its rules in the one stylesheet (BR-400 unchanged,
  BR-401 unchanged).
- `src/auth/proxy/proxy.ts`: page language per route (BR-404), consent form
  action with `lang` (BR-129 v4), switcher query (BR-408), pending-consent
  replacement on a language switch (BR-409).
- `src/http/handler.ts`: pass the `Accept-Language` header to the authorize,
  consent and callback handlers, and the request query to the consent handler.
- Tests: new `tests/auth/proxy-language.test.ts`; parametrised additions to
  `tests/auth/proxy-pages.test.ts`; adapted `tests/auth/proxy-consent.test.ts`.
- Records: BR-404–BR-410 files (pending acceptance); History, Rule and
  `source:` updates of BR-129 v4, BR-393 v3, BR-399 v2, BR-402 v2, BR-403 v2;
  `business-rules/README.md`; `docs/spec-index.md` (F-031 row, next free
  IDs); `docs/oauth-proxy.md` (a short "Page language" paragraph);
  CHANGELOG Unreleased `Added`.

### Out of scope

- Languages other than English and French; the OIDC `ui_locales` parameter;
  passing a language to the upstream identity provider.
- Responses that are not proxy HTML pages: the HTTP layer's 4xx/5xx refusals
  (BR-167: 404, 405, 413, 414, 429…), JSON errors, redirects, metadata.
- Product name, GitHub URL, colour tokens, contrast pairs and CSP form.
- Remembering a language choice across authorizations.

## Business rules

- **BR-404** — Every proxy HTML page (consent page and every error page) is
  rendered in exactly one page language, `en` or `fr`, resolved per request in
  this order: (1) the request's `lang` query parameter when it is valid under
  BR-405 (authorize GET, the consent POST target of BR-129 v4, callback GET);
  (2) otherwise the `Accept-Language` result of BR-406; (3) otherwise `en`.
  The language is never read from a cookie, a form field, the client's
  registration or document, or stored state. Verified by: AC-01, AC-02, AC-08.
- **BR-405** — The `lang` query parameter is valid when the query holds it
  exactly once and its value is byte-identical to `en` or `fr` (lower case).
  Any other value (`FR`, `fr-CH`, `de`, empty) is ignored: the page language
  falls to BR-404 (2), and nothing is refused for it. For the OAuth checks
  `lang` is an unknown parameter of BR-128 v3: it never changes which check
  passes or fails, which event is logged, or which redirect or `error` is
  produced; like any parameter, a repeated `lang` on authorize or callback is
  the existing repeated-parameter refusal (400 page). `lang` is never copied
  into a client redirect (deny, refusal redirects, the code redirect), into
  the upstream authorization URL, into a pending consent, flow, code or the
  state file. Verified by: AC-02.
- **BR-406** — The `Accept-Language` header (all field lines joined as the
  runtime joins them) is ignored when absent or longer than 256 bytes.
  Otherwise it is split on `,`; each item, trimmed of spaces and tabs, is a
  language range (`*` or 1–8 letters followed by any number of `-` and 1–8
  letters or digits) optionally followed by optional whitespace, `;`,
  optional whitespace and a weight `q=` / `Q=` of `0`, `0.` plus up to three
  digits, `1` or `1.` plus up to three `0`. An item that does not match is
  skipped; an item without a weight has weight 1. A range whose primary subtag
  (before the first `-`), compared case-insensitively, is `en` or `fr` stands
  for that language; `*` stands for `en`; every other range is ignored, as is
  every item of weight 0. The result is the language of the remaining item
  with the highest weight, the first such item on a tie; with no remaining
  item there is no result. Examples: `fr-CH, fr;q=0.9, en;q=0.8` → `fr`;
  `de-CH,de;q=0.9` → none; `de, *;q=0.1` → `en`; `en;q=0, fr;q=0.1` → `fr`;
  `fr;q=0` → none; `FR-ch` → `fr`; `fr;q=0.5, en;q=0.5` → `fr`;
  `fr;q=2` → none; `fr_CH` → none; `fr;level=1` → none. Verified by: AC-01.
- **BR-407** — The fixed texts of the pages come from one catalogue object
  per language, `MESSAGES.en` and `MESSAGES.fr`, both typed by one `Messages`
  type so that a missing or extra key fails `tsc`; the error sentences are a
  nested object keyed by every `ErrorPage` kind. The English values are the
  current texts (BR-399, BR-402, BR-403, BR-129, BR-393, `ERROR_TEXT`), the
  French values are those of the "French texts" table below, byte for byte. No
  catalogue value contains `<`, `>`, `&` or `"`, and no French value equals its
  English value. Dynamic values (`clientName`, `clientId`, `cimd.host`,
  `redirectUri`, `resource`, `action`, `consentId`, the switcher query) are
  never translated and are HTML-escaped as today in both languages.
  Verified by: AC-03, AC-07.
- **BR-408** — The consent page, and no error page, carries a language
  switcher as the last child of `<header>`, exactly:
  `<nav class="languages" aria-label="{languageNav}">` + the English item +
  one space + the French item + `</nav>`, English first. The item of the page
  language is `<span lang="xx" aria-current="true">Name</span>`; the other is
  `<a href="?{query}" lang="xx" hreflang="xx">Name</a>`, where Name is
  `English` or `Français` and `{query}` is the HTML-escaped serialization
  (`URLSearchParams.toString()`) of the authorize request's own query with
  `lang` set to the other language (`URLSearchParams.set`: every original
  parameter kept, in order, a previous `lang` replaced in place, otherwise
  `lang` appended). The link is a relative reference, so it resolves to the
  same authorize path. When the byte length of the issuer URL's path +
  `/oauth/authorize?` + the serialization exceeds 8,192 (BR-169), the `<nav>`
  is omitted. Following the link is an ordinary authorize GET: every BR-128
  check runs again, and the result can be the consent page, a client redirect
  or an error page. Verified by: AC-04.
- **BR-409** — When an authorize request reaches the point of creating a
  pending consent, carries a valid `lang` (BR-405) and a well-formed binding
  cookie (BR-130), and a live pending consent exists with the same cookie
  hash and a pending request equal in every field (`clientId`,
  `redirectUri`, `state`, `codeChallenge`, `resource`, `cimdGrants`), that
  consent is deleted before the BR-142 store-bound check and the new one is
  created; at most one consent is replaced per request. The number of pending
  consents is therefore unchanged by a language switch and a switch is never
  refused as `store_full` when it replaces one. The replaced identifier is
  then unknown: a form posted from the earlier page gets the `consent` error
  page. Without a valid `lang` or without the cookie, behaviour is today's (a
  new consent is added). Verified by: AC-05.
- **BR-410** — Localisation adds no cookie, header or stored data: the
  consent page still carries exactly one `Set-Cookie` (the
  `__Host-kdrive-oauth` cookie of BR-130), error pages carry none, the BR-129
  headers are unchanged, and the `Content-Security-Policy` is the BR-401 value
  with the hash of the one stylesheet, identical for both languages and every
  page. The page language is not written to any store, log event or the state
  file. Verified by: AC-06.
- **BR-399 v2** — v1 holds, except: `<html lang="xx">` carries the page
  language; the `<title>` page title, the header line and the GitHub link text
  are the page language's catalogue texts (`productTagline`, `sourceLink`;
  English unchanged); the header ends with the BR-408 `<nav>` on the consent
  page; the document's `<a>` elements are the GitHub link and, on the consent
  page when BR-408 offers it, the one switcher link (outside `<main>` and
  `<form>`, no button class); the switcher `href` is a relative reference
  starting with `?` and is not an absolute URL. Verified by: AC-07.
- **BR-402 v2** — v1 holds in the page language: title, intro, `Request
  details` heading, the BR-129/BR-393 line texts, button labels and after-note
  are the catalogue texts of the page language, with the same structure,
  markup, escaping and order; the form's values (`decision` `approve`/`deny`,
  hidden `consent`) do not change with the language. Verified by: AC-07.
- **BR-403 v2** — v1 holds in the page language: title, `<h1>`, the error
  sentence of the kind and the fixed paragraph are the catalogue texts of the
  page language; no request value, status unchanged, no switcher.
  Verified by: AC-07.
- **BR-129 v4** — v3 holds, except: the form posts to
  `<issuer>/oauth/consent?lang=xx` with the page language, used only to choose
  the language of the consent handler's error pages; "unnamed client" and the
  "self-declared and unverified" label are the page language's catalogue
  texts; a valid request carrying `lang` may replace an equal pending consent
  under BR-409. Verified by: AC-08.
- **BR-393 v3** — v2 holds, except that the line texts (`Client host:`,
  the metadata notice, the loopback line) are those of the page language;
  the English texts are unchanged. Verified by: AC-08.

### French texts

Every value is plain text. In French values the space before `:` is U+00A0
(no-break space); every other space is U+0020; the apostrophe is ASCII `'`.

| Key | English (current) | French |
| --- | --- | --- |
| `productTagline` | Unofficial MCP server for kDrive, not affiliated with Infomaniak. | Serveur MCP non officiel pour kDrive, non affilié à Infomaniak. |
| `sourceLink` | Source code on GitHub | Code source sur GitHub |
| `languageNav` | Language | Langue |
| `consentTitle` | Authorize access | Autoriser l'accès |
| `consentIntro` | An application is asking to connect to this kdrive-mcp-server. The server gives MCP clients, such as AI assistants, access to files in kDrive, limited to the folders and mode its operator configured. Approve only if you started this connection yourself and recognise the client below. | Une application demande à se connecter à ce kdrive-mcp-server. Ce serveur donne à des clients MCP, tels que des assistants d'IA, accès à des fichiers dans kDrive, dans la limite des dossiers et du mode configurés par son opérateur. N'approuvez que si vous avez vous-même lancé cette connexion et reconnaissez le client ci-dessous. |
| `requestDetails` | Request details | Détails de la demande |
| `clientIdLabel` | Client ID: | Identifiant du client : |
| `clientHostLabel` | Client host: | Hôte du client : |
| `clientNameLabel` | Client name: | Nom du client : |
| `unnamedClient` | unnamed client | client sans nom |
| `selfDeclaredSuffix` | (self-declared, unverified) | (déclaré par le client, non vérifié) |
| `metadataNotice` | This name comes from the client's metadata document and is unverified. | Ce nom provient du document de métadonnées du client et n'est pas vérifié. |
| `loopbackLine` | This client redirects to this computer only (loopback). | Ce client redirige uniquement vers cet ordinateur (boucle locale). |
| `selfDeclaredNotice` | The client name is self-declared and unverified. | Le nom du client est déclaré par le client lui-même et n'est pas vérifié. |
| `redirectUriLabel` | Redirect URI: | URI de redirection : |
| `resourceLabel` | Protected resource: | Ressource protégée : |
| `approve` | Approve | Approuver |
| `deny` | Deny | Refuser |
| `consentNote` | Approve takes you to sign in with your account; the client gets access only after that sign-in. Deny returns to the client without access. Enter your password only on your identity provider's sign-in page, never on this page. | Approuver vous amène à vous connecter avec votre compte. Le client n'obtient l'accès qu'après cette connexion. Refuser vous ramène au client sans lui donner accès. Saisissez votre mot de passe uniquement sur la page de connexion de votre fournisseur d'identité, jamais sur cette page. |
| `errorTitle` | Authorization error | Erreur d'autorisation |
| `error.invalid_request` | The authorization request is invalid. | La demande d'autorisation n'est pas valide. |
| `error.consent` | This consent request is unknown, expired or already used. | Cette demande de consentement est inconnue, a expiré ou a déjà été utilisée. |
| `error.callback` | This sign-in response is unknown, expired or already used. | Cette réponse de connexion est inconnue, a expiré ou a déjà été utilisée. |
| `error.busy` | Too many authorization requests are pending. Try again later. | Trop de demandes d'autorisation sont en attente. Réessayez plus tard. |
| `errorNote` | This request was not completed. If your application is not connected, return to it and start the connection again. | Cette demande n'a pas abouti. Si votre application n'est pas connectée, revenez-y et relancez la connexion. |

The language names `English` and `Français` are one fixed constant, the same
on both pages (each name in its own language). The page shows the label and
its value as `<label> <value>` (one U+0020 after the label), as today.

### Switcher by page type

| Page | Reached by | Switcher | Language of the page |
| --- | --- | --- | --- |
| Consent | authorize GET | link to the same authorize query with the other `lang` (BR-408); replaces the pending consent (BR-409) | BR-404 |
| Error (`invalid_request`, `busy`) | authorize GET | none (BR-143: no request value on an error page) | BR-404, from the request's `lang` |
| Error (`consent`, `busy`) | consent POST | none (a link cannot re-post; replay is excluded) | `lang` of the form target, else `Accept-Language` |
| Error (`callback`, `busy`) | callback GET | none (the callback consumes its flow; replay is excluded) | `Accept-Language` (a valid `lang` is honoured but never sent) |

No language switch submits a form, re-posts a consent or replays a callback.

## Acceptance criteria

- **AC-01** (BR-404, BR-406) — Given the `Accept-Language` values of BR-406's
  examples plus absent, empty, a 257-byte value starting with `fr`,
  `*`, `en-GB,fr;q=0.9`, `fr ; q=0.700`, `fr;Q=1.000` and `fr;q=1.0001`, and
  `lang` absent, valid and invalid, When the resolution runs, Then each result
  is the one stated (257 bytes → `en`; `fr;q=1.0001` → none). Verified by:
  `BR-404 AC-01` and `BR-406 AC-01` in `tests/auth/proxy-language.test.ts`.
- **AC-02** (BR-405, BR-404) — Given a valid registered-client authorize
  request, When it is sent with `lang=fr`, with `lang=de`, with `lang=FR`,
  without `lang` and `Accept-Language: fr`, and with `lang=fr&lang=en`, Then
  the first and fourth show the French consent page, the second and third the
  English one (no `Accept-Language`), and the fifth the 400 repeated-parameter
  page with the same `authorization_refused` event as without `lang`; and
  given requests with a missing `code_challenge`, a wrong `resource`, and a
  deny and an approve submitted from a French page, each with `lang=fr`, Then
  the client redirect or upstream `Location` is byte-identical to the one
  produced without `lang` and contains no `lang`, and `proxyStateSnapshot`
  contains no `lang`. Verified by: `BR-405 AC-02` in
  `tests/auth/proxy-language.test.ts`.
- **AC-03** (BR-407) — Given `MESSAGES`, When the test compares them, Then the
  key sets (nested `error` included) are equal, every value is a non-empty
  string without `<`, `>`, `&` or `"`, no French value equals its English
  value, every French value equals the table, and every English value equals
  the text asserted by the existing F-030 tests; and a test line marked
  `// @ts-expect-error` that types an object missing one key as `Messages`
  keeps `tsc` green only while the type rejects it. Verified by:
  `BR-407 AC-03` in `tests/auth/proxy-language.test.ts` and `tsc` in
  `make check`.
- **AC-04** (BR-408) — Given authorize requests (registered and CIMD) whose
  query holds `client_id`, `redirect_uri` `https://app.example/cb?a=1&b=2`,
  `state` `"<x>'&`, `code_challenge`, `code_challenge_method`,
  `response_type`, `resource`, `scope` and an unknown `extra=1`, with and
  without `lang`, When the consent page is shown in each language, Then the
  `<nav>` is the last child of `<header>` with the exact BR-408 markup, the
  current language is the `aria-current` span and not a link, the link's
  `href` unescaped and parsed equals the original parameters in order with
  `lang` set to the other language, the raw `href` contains no `"`, `<`, `'`
  or unescaped `&`; following that link yields the consent page in the other
  language; a query whose serialization makes the path + query exceed 8,192
  bytes yields no `<nav>`; and no error page (each kind, both languages,
  each route) contains `<nav` or `lang=`. Verified by: `BR-408 AC-04` in
  `tests/auth/proxy-language.test.ts`.
- **AC-05** (BR-409) — Given a consent page obtained with cookie C, When the
  switcher link is followed with C, Then the pending-consent count is
  unchanged, the earlier identifier posted with C gets the 400 `consent` page,
  and the new identifier approves normally; given a store filled to 1000
  including that consent, the switch still shows the consent page; and given
  the same switch without the cookie, or the same request without `lang`, or
  with a different `state`, Then a consent is added and none deleted.
  Verified by: `BR-409 AC-05` in `tests/auth/proxy-language.test.ts`.
- **AC-06** (BR-410, BR-401) — Given the consent page and every error page in
  both languages, When the headers are read, Then the consent page has one
  `Set-Cookie`, named `__Host-kdrive-oauth`, the error pages none, the other
  BR-129 headers are unchanged, and the CSP equals the BR-401 value with the
  hash recomputed from the body's `<style>`, the same for all pages; and the
  emitted events and the state-file snapshot after a French flow contain no
  `lang` or `fr` field. Verified by: `BR-410 AC-06` in
  `tests/auth/proxy-language.test.ts`.
- **AC-07** (BR-399 v2, BR-402 v2, BR-403 v2, BR-407, BR-400) — Given the
  pages of F-030 AC-01 rendered in `en` and in `fr`, When the F-030 AC-01,
  AC-02, AC-05 and AC-06 checks run for each language (parametrised), Then
  they pass with the language's catalogue texts and `<html lang>`, the only
  `<a>` elements are those of BR-399 v2, the hostile `ConsentView` values and
  hostile query values appear only escaped, the French consent page and each
  French error page contain each French text of the table in BR-402/BR-403
  order, and the BR-400 AC-03 stylesheet test (tokens, contrast, no colour
  literal, width rules) passes with the switcher rules included. Verified by:
  `BR-399 v2 AC-07`, `BR-402 v2 AC-07`, `BR-403 v2 AC-07` in
  `tests/auth/proxy-pages.test.ts` and the unchanged `BR-400 AC-03`.
- **AC-08** (BR-129 v4, BR-393 v3, BR-404) — Given the existing BR-129 and
  BR-393 tests, When they run, Then their English assertions pass unchanged
  except the form action, now `<issuer>/oauth/consent?lang=en`; a consent POST
  to `/oauth/consent?lang=fr` with an unknown identifier and to
  `/oauth/consent` with `Accept-Language: fr` each give the French `consent`
  page; a callback with an unknown `state` and `Accept-Language: fr` gives the
  French `callback` page; a CIMD loopback request with `lang=fr` shows the
  French BR-393 lines. Verified by: `BR-129 v4 ...` and `BR-393 v3 ...` in
  `tests/auth/proxy-consent.test.ts`.
- **AC-09** (all) — Given the branch, When `make check` runs in Docker, Then
  it exits 0 with every existing proxy and HTTP test passing. Verified by:
  `make check` output quoted in the PR.
- **AC-10** (BR-402 v2, BR-408; owner-visible, outside the gate) — Given the
  French consent page of a CIMD client with a loopback redirect, the English
  one, and the French `consent` error page, rendered from synthetic values by
  a throwaway script, When the orchestrator screenshots them in a headless
  browser in light and dark at 320 px and 1280 px wide, Then the PR shows the
  screenshots, no horizontal scrollbar and no clipped switcher at 320 px, and
  the owner can judge the French texts and the switcher. Not part of
  `make check`; if no browser is available the PR says so and attaches the
  rendered HTML.

## Decisions

- **D-1 — Language in the query, resolved per request.** Chosen: `lang`
  (`en`/`fr`) > `Accept-Language` > English, as the owner decided. Rejected: a
  cookie or stored preference (owner); a path prefix such as `/fr/oauth/…`
  (new routes and a changed `authorization_endpoint`).
- **D-2 — Switcher on the consent page only.** An error page holds no request
  value (BR-143), so it cannot rebuild the authorize URL; after a POST or a
  callback, a link could only replay the step or need a new static route.
  Rejected: a new `GET /oauth/error?kind=…&lang=…` route (new public surface
  and rate window for a terminal page whose only instruction is to return to
  the application); a link replaying authorize from an error page (needs the
  request values). Error pages still follow the user's language through
  `lang` and `Accept-Language`.
- **D-3 — The switch replaces the pending consent (BR-409)**, keyed on cookie
  and an equal request, only when `lang` is valid, so client behaviour and
  ordinary reloads stay as today. Rejected: a GET route re-rendering a pending
  consent by its identifier (puts the one-use identifier in a URL and history);
  accepting a duplicate per switch (grows the store, which the owner excluded).
  Residual: each switch uses one slot of the authorize window (BR-162).
- **D-4 — Invalid `lang` ignored, not refused.** A cosmetic parameter must not
  break an authorization; a repeated `lang` keeps the generic repetition
  refusal so BR-128 needs no exception.
- **D-5 — Consent POST language through its form target**
  (`/oauth/consent?lang=xx`), keeping the choice in the URL; the form fields
  are unchanged. Rejected: a hidden form field (not the URL); storing the
  language in the pending consent or flow ("nothing stored"). Callback error
  pages use `Accept-Language`, since the language is not carried through the
  identity provider.
- **D-6 — Catalogue as typed objects in `pages.ts`**, no i18n library,
  plain-text values with markup added by the renderer. French typography: a
  no-break space before `:`, ASCII apostrophes, "vous", no `;` in the note.
- **D-7 — No `Vary: Accept-Language` or `Content-Language`.** Pages are
  `no-store`; `<html lang>` declares the language.
- **D-8 — No ADR** (cheap to reverse, no dependency).

## Open questions

None.

## Stress-test

(Spec reviews pending.)

---
id: F-030
title: Designed OAuth proxy consent and error pages
ticket: "#23"
status: draft
version: 1
---

# F-030 — Designed OAuth proxy consent and error pages

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `claude/beautiful-maxwell-8mdk2w` (main `029f747`).
IDs: F-030; BR-399–BR-403 v1; BR-129 v3; BR-393 v2. No ADR: the change is
confined to static page markup and one CSP directive and is cheap to reverse.
Next free IDs checked on main `029f747` (`docs/spec-index.md`,
`business-rules/`): F-030, BR-399, ADR-012.

## Context

In `proxy` mode (F-010) the OAuth proxy serves HTML pages from
`src/auth/proxy/pages.ts`: the consent page (BR-129 v2, BR-393 v1) and the
400/503 error pages (`errorPage`, used by BR-128, BR-132, BR-142, BR-305,
BR-309 and others). They are unstyled HTML: a heading, paragraphs and two
browser-default buttons. Before 1.0 the owner wants them to look like a
finished, trustworthy product.

Owner input (#23, 2026-11-14): no style preference; no call to an external
resource; light and dark themes (`prefers-color-scheme`); sober and modern;
show the tool's name with a short text recalling where the user is, why they
are here and what the tool does; a link to the GitHub repository is welcome.

Current constraints that stay: the BR-129 headers, in particular
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`
(asserted in `tests/auth/proxy-consent.test.ts`), which forbids every inline
`<style>` and `style` attribute through the `default-src` fallback; HTML
escaping of every dynamic value (BR-129); no request value in an error page
(BR-143); the F-028 consent additions (client host line, unverified notice,
loopback line; BR-393) with their wording and order.

Users affected: whoever authorizes an MCP client against a server run in
`proxy` mode (the owner today, any operator after 1.0). Flows, routes, status
codes, events and limits do not change.

## Scope

- `src/auth/proxy/pages.ts`: one shared page shell (BR-399), one fixed
  stylesheet with light and dark themes (BR-400), the CSP `style-src` hash
  (BR-401, BR-129 v3), the consent page layout and fixed texts (BR-402,
  BR-129 v3, BR-393 v2) and the error page layout (BR-399, BR-403).
- Tests: a new `tests/auth/proxy-pages.test.ts` (shell, CSS, CSP, escaping,
  error pages) and the BR-129/BR-393 tests in
  `tests/auth/proxy-consent.test.ts` renamed and adapted (BR-129 v3, BR-393 v2).
- Records: BR-399–BR-403 files (pending acceptance), BR-129 v3 and BR-393 v2
  History and `source:` lines, `business-rules/README.md`,
  `docs/spec-index.md` (F-030 row, next free IDs), `docs/oauth-proxy.md`
  (one line: the pages' look and CSP), CHANGELOG Unreleased `Changed`.

### Out of scope

- The OAuth flow, routes, handlers, status codes, events, limits and storage.
- The fixed error texts of `ERROR_TEXT` and which handler shows which page.
- Bidirectional and invisible characters in `client_name` (#26 hardening):
  related, separate ticket; F-030 renders the escaped name as today.
- Any non-HTML response (JSON errors, redirects, metadata documents).
- A theme switcher, localisation, a favicon file or any JavaScript.

## Business rules

- **BR-399** — Every HTML page of the proxy (consent page and every error
  page) is one document of this shape, in this order: `<!doctype html>`;
  `<html lang="en">`; in `<head>`, `<meta charset="utf-8">`,
  `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  `<meta name="color-scheme" content="light dark">`,
  `<title><page title> · kdrive-mcp-server</title>` and exactly one
  `<style>` element whose content is the fixed stylesheet of BR-400; in
  `<body>`, exactly one `<header>`, one `<main>` and one `<footer>`. The
  header holds one inline `<svg>` mark with `aria-hidden="true"` and
  `focusable="false"` and no `href`/`xlink:href`, the product name
  `kdrive-mcp-server` and the line
  `Unofficial MCP server for kDrive, not affiliated with Infomaniak.` The
  main holds exactly one `<h1>` (the page title). The footer holds exactly one
  link, `<a href="https://github.com/sstolz/kdrive-mcp-server" target="_blank" rel="noopener noreferrer">Source code on GitHub</a>`;
  it is the only `<a>` of the document, is outside `<main>` and `<form>`, and
  has no button class. The document contains no `<script>`, `<link>`, `<img>`,
  `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta http-equiv>`, `on*`
  attribute and `style` attribute, and no absolute URL other than the GitHub
  link and the HTML-escaped request values of BR-402. Verified by: AC-01,
  AC-02.
- **BR-400** — The stylesheet is one fixed string (identical in every
  response) that: (1) declares its colours as CSS custom properties in `:root`
  (light) and redeclares every one of them inside
  `@media (prefers-color-scheme: dark)`, and sets `color-scheme: light dark`;
  (2) uses a system font stack only and contains no `@import`, `@font-face`,
  `url(` or `image-set(`; (3) contains no `transition`, `animation` or
  `@keyframes` (nothing moves, so reduced motion holds without a query);
  (4) gives `:focus-visible` on buttons and links an `outline` of at least
  2px solid in a declared colour; (5) wraps long values
  (`overflow-wrap: anywhere` on `code`) and limits the content width so that a
  320 px-wide viewport needs no horizontal scrolling; (6) reaches, in both
  themes, a WCAG 2.x contrast ratio of at least 4.5:1 for body text, muted
  text, link text, code text and each button's label against its background,
  and at least 3:1 for the focus outline and the button borders against the
  page background. Verified by: AC-03.
- **BR-401** — The `Content-Security-Policy` of every proxy HTML page is
  `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; style-src 'sha256-<b64>'`,
  where `<b64>` is the base64 SHA-256 of the exact UTF-8 text between `<style>`
  and `</style>`, computed once from the same constant that is rendered. No
  `'unsafe-inline'`, nonce or other source is added; the other BR-129 headers
  are unchanged. Verified by: AC-04.
- **BR-402** — The consent page title is `Authorize access`. Below the `<h1>`
  it shows, in this order: (1) the fixed paragraph
  `An application is asking to connect to this kdrive-mcp-server. The server gives MCP clients, such as AI assistants, access to files in a kDrive, limited to the folders and mode its operator configured. Approve only if you started this connection yourself and recognise the client below.`;
  (2) an `<h2>Request details</h2>` followed by the BR-129 and BR-393 lines,
  each the text of its own `<p>`, with the same wording, `<code>`/`<strong>`
  markup, escaping and order as BR-129 v2/BR-393 v1 (CIMD: client ID, client
  host, client name, metadata notice, loopback line when applicable;
  registered: client name, self-declared notice, client ID; then redirect URI
  and protected resource); (3) the unchanged form (method, action, hidden
  `consent` input, `Approve` then `Deny` buttons with `name="decision"`), the
  Approve button styled as primary and Deny as secondary, both the same size;
  (4) the fixed paragraph
  `Approve takes you to sign in with your account; the client gets access only after that sign-in. Deny returns to the client without access. This page never asks for a password.`
  Verified by: AC-05.
- **BR-403** — An error page has the title and `<h1>` `Authorization error`,
  then the unchanged `ERROR_TEXT` sentence of its kind in its own `<p>`, then
  the fixed paragraph
  `Nothing was authorized. Return to your application and start the connection again.`;
  it contains no request value (BR-143) and keeps its status (400 or 503).
  Verified by: AC-06.
- **BR-129 v3** — v2 holds, except that the `Content-Security-Policy` value
  is the BR-401 one and the page follows BR-399–BR-402; the v2 example "a
  registered client's page is unchanged" now reads "a registered client's
  page carries no BR-393 line". The `BR-129 v2 ... byte-identical` test is
  replaced by `BR-129 v3` tests (AC-05); the other `BR-129` tests keep their
  assertions, the CSP assertion using the BR-401 value. History line "v3 —
  <date> — F-030 v1 (#23) — designed page and CSP style hash; pending
  acceptance". Verified by: AC-04, AC-05.
- **BR-393 v2** — v1 holds, except its last sentence becomes "The page of a
  registered client carries none of these lines." (it was "is unchanged",
  tested as byte-identical to the F-010 page). Verified by: AC-05.

## Acceptance criteria

- **AC-01** (BR-399) — Given the consent page of a registered client, of a
  CIMD client with and without a loopback redirect, and the error page of
  each `ERROR_TEXT` kind at 400 and of `busy` at 503, When each is rendered,
  Then each has the BR-399 head elements, one style, one header with the
  mark, product name and unofficial line, one main with one `<h1>`, one
  footer with the exact GitHub link as the only `<a>`, after `</main>` and
  outside the form. Verified by: `BR-399 AC-01` in
  `tests/auth/proxy-pages.test.ts`.
- **AC-02** (BR-399) — Given the same pages with request values chosen to
  contain `<script>`, `" onload="`, `style=`, `http://evil.example` and
  `javascript:`, When the body is scanned after removing the escaped request
  values, Then it holds none of the forbidden elements or attributes and no
  `http:`/`https:` URL other than the GitHub link. Verified by:
  `BR-399 AC-02` in `tests/auth/proxy-pages.test.ts`.
- **AC-03** (BR-400) — Given the stylesheet constant, When the test parses
  its custom properties for light and dark, Then every light property is
  redeclared in dark, items (2)–(5) hold as string checks, and the contrast
  ratios of item (6), computed with the WCAG relative-luminance formula from
  a named pair list in the test, meet their thresholds in both themes.
  Verified by: `BR-400 AC-03` in `tests/auth/proxy-pages.test.ts`.
- **AC-04** (BR-401, BR-129 v3) — Given every page of AC-01, When the
  headers are read, Then the CSP equals the BR-401 value with the hash
  recomputed by the test from the body's `<style>` text, is identical across
  pages, and `Cache-Control`, `X-Frame-Options`, `Referrer-Policy` and
  `Content-Type` keep their BR-129 values. Verified by: `BR-401 AC-04` in
  `tests/auth/proxy-pages.test.ts` and the adapted `BR-129` test in
  `tests/auth/proxy-consent.test.ts`.
- **AC-05** (BR-402, BR-129 v3, BR-393 v2) — Given a registered client named
  `Plain`, a CIMD client named `<b>Claude</b>` with redirects
  `http://127.0.0.1:33418/cb` and `https://app.example/cb`, When authorize
  shows the consent page, Then the intro, `Request details`, the BR-129/BR-393
  lines (as text of their own `<p>`), the form and the after-note appear in
  BR-402 order; the existing `BR-393` substring and order assertions pass
  unchanged; the registered page has no `Client host:`, metadata notice or
  loopback line; and a direct `consentPage` call with `"<>&'` in every
  `ConsentView` field shows each only escaped. Verified by: `BR-402 AC-05` in
  `tests/auth/proxy-pages.test.ts`, `BR-129 v3 ...` and `BR-393 v2 ...` in
  `tests/auth/proxy-consent.test.ts`.
- **AC-06** (BR-403) — Given an authorize request with an unknown
  `client_id` of `<x>` and a full consent store, When the handler answers,
  Then the 400 page and the 503 page carry their `ERROR_TEXT` sentence and the
  fixed paragraph, and neither contains `<x>`, `&lt;x&gt;` or the request's
  `redirect_uri`. Verified by: `BR-403 AC-06` in
  `tests/auth/proxy-pages.test.ts`.
- **AC-07** (all) — Given the branch, When `make check` runs in Docker, Then
  it exits 0 with every existing proxy test (BR-128, BR-129, BR-132, BR-142,
  BR-143, BR-305, BR-309, BR-393, `tests/http/cimd-rehearsal.test.ts`)
  passing. Verified by: `make check` output quoted in the PR.
- **AC-08** (BR-399, BR-400, BR-402, BR-403; owner-visible, outside the
  gate) — Given the four pages of AC-01 rendered from synthetic values by a
  throwaway script, When the orchestrator screenshots them in a headless
  browser in light and dark at 375 px and 1280 px wide, Then the PR shows the
  screenshots, no horizontal scrollbar at 375 px, and the owner can judge the
  design. Not part of `make check`; if no browser is available the PR says so
  and attaches the rendered HTML instead.

## Decisions

- **D-1 — CSP: `style-src` hash.** The current policy blocks inline styles.
  Chosen: one static `<style>` whitelisted by its SHA-256, computed from the
  rendered constant so the two cannot diverge. Rejected: `'unsafe-inline'`
  (weakens the policy against injected styles); a nonce (needs per-response
  randomness for static content and gives nothing more); a served stylesheet
  route (`style-src 'self'`, a new route and a second request); keeping the
  pages unstyled (fails the ticket). `style` attributes stay forbidden because
  the hash does not cover them. Inline SVG presentation attributes
  (`fill="currentColor"`) are not styles and need no source.
- **D-2 — Keep the BR-393 lines as plain `<p>` text.** A definition list
  would read better but would change the BR-393 strings its tests assert;
  styled `<p>` rows keep BR-393's meaning (v2 changes only the
  "unchanged registered page" sentence) and its tests.
- **D-3 — Product name `kdrive-mcp-server`** (README title, package name
  without scope) with the unofficial line next to it in the header, not only
  in the footer, so that a "kDrive" name is never read as an Infomaniak page.
- **D-4 — GitHub link** in the footer, plain link styling, opening a new tab
  (`target="_blank"`, `rel="noopener noreferrer"`) so the pending consent page
  stays open; static URL, no request data; `Referrer-Policy: no-referrer`
  already applies.
- **D-5 — No motion at all** rather than motion behind
  `prefers-reduced-motion`; nothing on these pages needs animation.
- **D-6 — Approve primary, Deny secondary, equal size**, Approve first as
  today. Rejected: equal styling (looks unfinished); Deny first (changes the
  accepted order).
- **D-7 — Verification by content and CSS tests**, contrast computed from
  the CSS tokens. Rejected: a rendered-screenshot check in `make check`
  (Chromium is not in the dev image; AC-08 covers the visual check outside
  the gate).
- **D-8 — No `form-action` directive.** Adding it would change form
  behaviour behind proxies and tunnels; out of scope for a design ticket.

## Open questions

None.

## Stress-test

Not yet reviewed.

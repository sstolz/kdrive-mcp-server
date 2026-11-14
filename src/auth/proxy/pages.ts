import { createHash } from "node:crypto";
import type { Language } from "./language.js";

/** A transport-independent handler response (P-12 maps it to HTTP). */
export interface ProxyResponse {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

/**
 * F-030 BR-400: the one fixed stylesheet of every proxy page. Colours are
 * the tokens of the two `:root` blocks only (light, then dark).
 */
export const PAGE_STYLESHEET = [
  ":root{color-scheme:light dark;",
  "--bg:#f4f5f7;--surface:#ffffff;--fg:#1b1f27;--muted:#5a6170;--link:#3451b2;",
  "--code-fg:#1b1f27;--code-bg:#eceef2;--primary-fg:#ffffff;--primary-bg:#3451b2;",
  "--secondary-fg:#1b1f27;--secondary-bg:#ffffff;--border:#8a919e;--focus:#3451b2}",
  "@media (prefers-color-scheme: dark){:root{",
  "--bg:#0f1117;--surface:#181b22;--fg:#e7e9ee;--muted:#a3a9b6;--link:#9db0f5;",
  "--code-fg:#e7e9ee;--code-bg:#262a33;--primary-fg:#ffffff;--primary-bg:#4a63c9;",
  "--secondary-fg:#e7e9ee;--secondary-bg:#20242c;--border:#6e7584;--focus:#9db0f5}}",
  "*,*::before,*::after{box-sizing:border-box}",
  "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
  "body{margin:0;min-height:100vh;display:flex;flex-direction:column;padding:0 1rem;",
  "background:var(--bg);color:var(--fg);",
  'font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
  "font-size:1rem;line-height:1.55}",
  "header,main,footer{width:100%;max-width:38rem;margin:0 auto}",
  "header,footer{background:var(--bg)}",
  "header{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;padding:clamp(1.5rem,6vh,3.5rem) 0 1.25rem}",
  "header>div{flex:1 1 12rem}",
  ".mark{flex:none;display:block;color:var(--link)}",
  ".mark path{stroke:var(--surface)}",
  ".product{margin:0;font-weight:600;font-size:.9375rem;letter-spacing:-.005em}",
  ".tagline{margin:0;font-size:.8125rem;color:var(--muted);line-height:1.4}",
  "main{background:var(--surface);border:1px solid var(--code-bg);border-radius:.875rem;",
  "padding:clamp(1.25rem,5vw,2.5rem)}",
  "h1{margin:0 0 .75rem;font-size:1.5rem;line-height:1.25;font-weight:650;letter-spacing:-.015em}",
  "main p{margin:0 0 1rem}",
  ".details{margin:1.5rem 0;padding:1rem 1.125rem;background:var(--bg);border-radius:.625rem}",
  ".details h2{margin:0 0 .625rem;font-size:.75rem;font-weight:600;letter-spacing:.06em;",
  "text-transform:uppercase;color:var(--muted)}",
  ".details p{margin:0;font-size:.9375rem}",
  ".details p+p{margin-top:.5rem}",
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;',
  "font-size:.875em;padding:.0625rem .375rem;border-radius:.3125rem;",
  "background:var(--code-bg);color:var(--code-fg);overflow-wrap:anywhere}",
  "form{margin:1.75rem 0 0}",
  ".actions{display:flex;flex-wrap:wrap;gap:.75rem}",
  ".button{flex:1 1 9rem;min-height:2.75rem;padding:.625rem 1.25rem;border-radius:.5rem;",
  "font:inherit;font-weight:600;line-height:1.2;cursor:pointer}",
  ".primary{color:var(--primary-fg);background:var(--primary-bg);border:1px solid var(--primary-bg)}",
  ".secondary{color:var(--secondary-fg);background:var(--secondary-bg);border:1px solid var(--border)}",
  ".button:hover{filter:brightness(.93)}",
  "main p.note{margin:1.25rem 0 0;font-size:.875rem;color:var(--muted)}",
  "footer{padding:1.5rem 0 2rem;text-align:center;font-size:.875rem}",
  "footer p{margin:0}",
  ".languages{margin-left:auto;display:flex;gap:.75rem;font-size:.875rem}",
  ".languages span{font-weight:600}",
  "a{color:var(--link);text-underline-offset:.2em}",
  "button:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}",
].join("");

/** BR-401: the CSP allows exactly the stylesheet above, by its hash. */
const STYLE_HASH = createHash("sha256")
  .update(PAGE_STYLESHEET, "utf8")
  .digest("base64");

/** BR-129 v3: headers of the consent page and every error page. */
const PAGE_HEADERS: Array<[string, string]> = [
  ["Content-Type", "text/html; charset=utf-8"],
  ["Cache-Control", "no-store"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "no-referrer"],
  [
    "Content-Security-Policy",
    `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; style-src 'sha256-${STYLE_HASH}'`,
  ],
];

/** BR-399: a neutral shield-and-check glyph, decorative only. */
const MARK =
  '<svg class="mark" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="currentColor"/>' +
  '<path d="M16 7.5l6.5 2.4v5.3c0 4.3-2.8 7.6-6.5 9.3-3.7-1.7-6.5-5-6.5-9.3V9.9z" ' +
  'fill="none" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M13.2 16.1l2 2 3.8-4" fill="none" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const GITHUB = "https://github.com/sstolz/kdrive-mcp-server";

/** The error page kinds; an error page never contains request values. */
export type ErrorPage = "invalid_request" | "consent" | "callback" | "busy";

/**
 * F-031 BR-407: the fixed texts of one language. Plain text only (no `<`,
 * `>`, `&` or `"`); the renderer adds the markup.
 */
export interface Messages {
  productTagline: string;
  sourceLink: string;
  languageNav: string;
  consentTitle: string;
  consentIntro: string;
  requestDetails: string;
  clientIdLabel: string;
  clientHostLabel: string;
  clientNameLabel: string;
  unnamedClient: string;
  selfDeclaredSuffix: string;
  metadataNotice: string;
  loopbackLine: string;
  selfDeclaredNotice: string;
  redirectUriLabel: string;
  resourceLabel: string;
  approve: string;
  deny: string;
  consentNote: string;
  errorTitle: string;
  error: Readonly<Record<ErrorPage, string>>;
  errorNote: string;
}

/**
 * BR-407: the catalogue. Non-ASCII characters are written as escapes; the
 * French no-break space before a colon is U+00A0.
 */
export const MESSAGES: Readonly<Record<Language, Readonly<Messages>>> = {
  en: {
    productTagline:
      "Unofficial MCP server for kDrive, not affiliated with Infomaniak.",
    sourceLink: "Source code on GitHub",
    languageNav: "Language",
    consentTitle: "Authorize access",
    consentIntro:
      "An application is asking to connect to this kdrive-mcp-server. The server gives MCP clients, such as AI assistants, access to files in kDrive, limited to the folders and mode its operator configured. Approve only if you started this connection yourself and recognise the client below.",
    requestDetails: "Request details",
    clientIdLabel: "Client ID:",
    clientHostLabel: "Client host:",
    clientNameLabel: "Client name:",
    unnamedClient: "unnamed client",
    selfDeclaredSuffix: "(self-declared, unverified)",
    metadataNotice:
      "This name comes from the client's metadata document and is unverified.",
    loopbackLine: "This client redirects to this computer only (loopback).",
    selfDeclaredNotice: "The client name is self-declared and unverified.",
    redirectUriLabel: "Redirect URI:",
    resourceLabel: "Protected resource:",
    approve: "Approve",
    deny: "Deny",
    consentNote:
      "Approve takes you to sign in with your account; the client gets access only after that sign-in. Deny returns to the client without access. Enter your password only on your identity provider's sign-in page, never on this page.",
    errorTitle: "Authorization error",
    error: {
      invalid_request: "The authorization request is invalid.",
      consent: "This consent request is unknown, expired or already used.",
      callback: "This sign-in response is unknown, expired or already used.",
      busy: "Too many authorization requests are pending. Try again later.",
    },
    errorNote:
      "This request was not completed. If your application is not connected, return to it and start the connection again.",
  },
  fr: {
    productTagline:
      "Serveur MCP non officiel pour kDrive, non affili\u00e9 \u00e0 Infomaniak.",
    sourceLink: "Code source sur GitHub",
    languageNav: "Langue",
    consentTitle: "Autoriser l'acc\u00e8s",
    consentIntro:
      "Une application demande \u00e0 se connecter \u00e0 ce kdrive-mcp-server. Ce serveur donne \u00e0 des clients MCP, tels que des assistants d'IA, acc\u00e8s \u00e0 des fichiers dans kDrive, dans la limite des dossiers et du mode configur\u00e9s par son op\u00e9rateur. N'approuvez que si vous avez vous-m\u00eame lanc\u00e9 cette connexion et reconnaissez le client ci-dessous.",
    requestDetails: "D\u00e9tails de la demande",
    clientIdLabel: "Identifiant du client\u00a0:",
    clientHostLabel: "H\u00f4te du client\u00a0:",
    clientNameLabel: "Nom du client\u00a0:",
    unnamedClient: "client sans nom",
    selfDeclaredSuffix:
      "(d\u00e9clar\u00e9 par le client, non v\u00e9rifi\u00e9)",
    metadataNotice:
      "Ce nom provient du document de m\u00e9tadonn\u00e9es du client et n'est pas v\u00e9rifi\u00e9.",
    loopbackLine:
      "Ce client redirige uniquement vers cet ordinateur (boucle locale).",
    selfDeclaredNotice:
      "Le nom du client est d\u00e9clar\u00e9 par le client lui-m\u00eame et n'est pas v\u00e9rifi\u00e9.",
    redirectUriLabel: "URI de redirection\u00a0:",
    resourceLabel: "Ressource prot\u00e9g\u00e9e\u00a0:",
    approve: "Approuver",
    deny: "Refuser",
    consentNote:
      "Approuver vous am\u00e8ne \u00e0 vous connecter avec votre compte. Le client n'obtient l'acc\u00e8s qu'apr\u00e8s cette connexion. Refuser vous ram\u00e8ne au client sans lui donner acc\u00e8s. Saisissez votre mot de passe uniquement sur la page de connexion de votre fournisseur d'identit\u00e9, jamais sur cette page.",
    errorTitle: "Erreur d'autorisation",
    error: {
      invalid_request: "La demande d'autorisation n'est pas valide.",
      consent:
        "Cette demande de consentement est inconnue, a expir\u00e9 ou a d\u00e9j\u00e0 \u00e9t\u00e9 utilis\u00e9e.",
      callback:
        "Cette r\u00e9ponse de connexion est inconnue, a expir\u00e9 ou a d\u00e9j\u00e0 \u00e9t\u00e9 utilis\u00e9e.",
      busy: "Trop de demandes d'autorisation sont en attente. R\u00e9essayez plus tard.",
    },
    errorNote:
      "Cette demande n'a pas abouti. Si votre application n'est pas connect\u00e9e, revenez-y et relancez la connexion.",
  },
};

/** BR-408: each language's name in its own language. */
const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: "English",
  fr: "Fran\u00e7ais",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** BR-408: the switcher; `query` is the other language's authorize query. */
function languageNav(language: Language, query: string): string {
  const item = (code: Language) =>
    code === language
      ? `<span lang="${code}" aria-current="true">${LANGUAGE_NAMES[code]}</span>`
      : `<a href="?${escapeHtml(query)}" lang="${code}" hreflang="${code}">${LANGUAGE_NAMES[code]}</a>`;
  return `<nav class="languages" aria-label="${MESSAGES[language].languageNav}">${item("en")} ${item("fr")}</nav>`;
}

/**
 * BR-399 v2: the shared page shell in the page language; `main` is
 * already-escaped markup and `nav` the optional BR-408 switcher.
 */
function document(
  language: Language,
  title: string,
  main: string,
  nav = "",
): string {
  const text = MESSAGES[language];
  return (
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    `<title>${title} \u00b7 kdrive-mcp-server</title><style>${PAGE_STYLESHEET}</style></head>` +
    `<body><header>${MARK}<div><p class="product">kdrive-mcp-server</p>` +
    `<p class="tagline">${text.productTagline}</p></div>${nav}</header>` +
    `<main><h1>${title}</h1>${main}</main>` +
    `<footer><p><a href="${GITHUB}" target="_blank" rel="noopener noreferrer">${text.sourceLink}</a></p></footer>` +
    "</body></html>"
  );
}

export function htmlPage(
  status: number,
  body: string,
  extra: Array<[string, string]> = [],
): ProxyResponse {
  return { status, headers: [...PAGE_HEADERS, ...extra], body };
}

/** BR-403 v2: the error page in the page language; never a request value. */
export function errorPage(
  kind: ErrorPage,
  status = 400,
  language: Language = "en",
): ProxyResponse {
  const text = MESSAGES[language];
  return htmlPage(
    status,
    document(
      language,
      text.errorTitle,
      `<p>${text.error[kind]}</p><p class="note">${text.errorNote}</p>`,
    ),
  );
}

export interface ConsentView {
  clientName: string | undefined;
  clientId: string;
  redirectUri: string;
  resource: string;
  action: string;
  consentId: string;
  /** F-028 BR-393: set for a CIMD client only. */
  cimd?: { host: string; loopback: boolean };
  /**
   * F-031 BR-408: the authorize query with `lang` set to the other language;
   * absent, the page has no switcher.
   */
  switchQuery?: string;
}

/**
 * BR-129 v4 / BR-393 v3 / BR-402 v2: the consent page in the page language;
 * every view value is HTML-escaped.
 */
export function consentPage(
  view: ConsentView,
  setCookie: string,
  language: Language = "en",
): ProxyResponse {
  const text = MESSAGES[language];
  const name =
    view.clientName === undefined
      ? text.unnamedClient
      : `${escapeHtml(view.clientName)} ${text.selfDeclaredSuffix}`;
  const clientId = `<p>${text.clientIdLabel} <code>${escapeHtml(view.clientId)}</code></p>`;
  const clientName = `<p>${text.clientNameLabel} <strong>${name}</strong></p>`;
  const identity = view.cimd
    ? [
        clientId,
        `<p>${text.clientHostLabel} ${escapeHtml(view.cimd.host)}</p>`,
        clientName,
        `<p>${text.metadataNotice}</p>`,
        ...(view.cimd.loopback ? [`<p>${text.loopbackLine}</p>`] : []),
      ]
    : [clientName, `<p>${text.selfDeclaredNotice}</p>`, clientId];
  const body = [
    `<p>${text.consentIntro}</p>`,
    `<section class="details"><h2>${text.requestDetails}</h2>`,
    ...identity,
    `<p>${text.redirectUriLabel} <code>${escapeHtml(view.redirectUri)}</code></p>`,
    `<p>${text.resourceLabel} <code>${escapeHtml(view.resource)}</code></p>`,
    "</section>",
    `<form method="post" action="${escapeHtml(view.action)}">`,
    `<input type="hidden" name="consent" value="${escapeHtml(view.consentId)}">`,
    '<div class="actions">',
    `<button type="submit" name="decision" value="approve" class="button primary">${text.approve}</button>`,
    `<button type="submit" name="decision" value="deny" class="button secondary">${text.deny}</button>`,
    "</div></form>",
    `<p class="note">${text.consentNote}</p>`,
  ].join("");
  const nav =
    view.switchQuery === undefined
      ? ""
      : languageNav(language, view.switchQuery);
  return htmlPage(200, document(language, text.consentTitle, body, nav), [
    ["Set-Cookie", setCookie],
  ]);
}

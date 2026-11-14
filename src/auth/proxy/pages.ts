import { createHash } from "node:crypto";

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
  "header{display:flex;align-items:center;gap:.75rem;padding:clamp(1.5rem,6vh,3.5rem) 0 1.25rem}",
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

const HEADER =
  `<header>${MARK}<div><p class="product">kdrive-mcp-server</p>` +
  '<p class="tagline">Unofficial MCP server for kDrive, not affiliated with Infomaniak.</p></div></header>';

const FOOTER =
  '<footer><p><a href="https://github.com/sstolz/kdrive-mcp-server" target="_blank" rel="noopener noreferrer">Source code on GitHub</a></p></footer>';

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** BR-399: the shared page shell; `main` is already-escaped markup. */
function document(title: string, main: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    `<title>${title} · kdrive-mcp-server</title><style>${PAGE_STYLESHEET}</style></head>` +
    `<body>${HEADER}<main><h1>${title}</h1>${main}</main>${FOOTER}</body></html>`
  );
}

export function htmlPage(
  status: number,
  body: string,
  extra: Array<[string, string]> = [],
): ProxyResponse {
  return { status, headers: [...PAGE_HEADERS, ...extra], body };
}

/** Fixed error texts: an error page never contains request values. */
const ERROR_TEXT = {
  invalid_request: "The authorization request is invalid.",
  consent: "This consent request is unknown, expired or already used.",
  callback: "This sign-in response is unknown, expired or already used.",
  busy: "Too many authorization requests are pending. Try again later.",
} as const;

export type ErrorPage = keyof typeof ERROR_TEXT;

/** BR-403: the fixed paragraph under every error text. */
const ERROR_NOTE =
  "This request was not completed. If your application is not connected, return to it and start the connection again.";

export function errorPage(kind: ErrorPage, status = 400): ProxyResponse {
  return htmlPage(
    status,
    document(
      "Authorization error",
      `<p>${ERROR_TEXT[kind]}</p><p class="note">${ERROR_NOTE}</p>`,
    ),
  );
}

/** BR-402: the fixed texts around the consent details. */
const CONSENT_INTRO =
  "An application is asking to connect to this kdrive-mcp-server. The server gives MCP clients, such as AI assistants, access to files in kDrive, limited to the folders and mode its operator configured. Approve only if you started this connection yourself and recognise the client below.";
const CONSENT_NOTE =
  "Approve takes you to sign in with your account; the client gets access only after that sign-in. Deny returns to the client without access. Enter your password only on your identity provider's sign-in page, never on this page.";

export interface ConsentView {
  clientName: string | undefined;
  clientId: string;
  redirectUri: string;
  resource: string;
  action: string;
  consentId: string;
  /** F-028 BR-393: set for a CIMD client only. */
  cimd?: { host: string; loopback: boolean };
}

/** BR-129 v3 / BR-393 v2 / BR-402: the consent page; every value is HTML-escaped. */
export function consentPage(
  view: ConsentView,
  setCookie: string,
): ProxyResponse {
  const name =
    view.clientName === undefined
      ? "unnamed client"
      : `${escapeHtml(view.clientName)} (self-declared, unverified)`;
  const identity = view.cimd
    ? [
        `<p>Client ID: <code>${escapeHtml(view.clientId)}</code></p>`,
        `<p>Client host: ${escapeHtml(view.cimd.host)}</p>`,
        `<p>Client name: <strong>${name}</strong></p>`,
        "<p>This name comes from the client's metadata document and is unverified.</p>",
        ...(view.cimd.loopback
          ? ["<p>This client redirects to this computer only (loopback).</p>"]
          : []),
      ]
    : [
        `<p>Client name: <strong>${name}</strong></p>`,
        `<p>The client name is self-declared and unverified.</p>`,
        `<p>Client ID: <code>${escapeHtml(view.clientId)}</code></p>`,
      ];
  const body = [
    `<p>${CONSENT_INTRO}</p>`,
    '<section class="details"><h2>Request details</h2>',
    ...identity,
    `<p>Redirect URI: <code>${escapeHtml(view.redirectUri)}</code></p>`,
    `<p>Protected resource: <code>${escapeHtml(view.resource)}</code></p>`,
    "</section>",
    `<form method="post" action="${escapeHtml(view.action)}">`,
    `<input type="hidden" name="consent" value="${escapeHtml(view.consentId)}">`,
    '<div class="actions">',
    '<button type="submit" name="decision" value="approve" class="button primary">Approve</button>',
    '<button type="submit" name="decision" value="deny" class="button secondary">Deny</button>',
    "</div></form>",
    `<p class="note">${CONSENT_NOTE}</p>`,
  ].join("");
  return htmlPage(200, document("Authorize access", body), [
    ["Set-Cookie", setCookie],
  ]);
}

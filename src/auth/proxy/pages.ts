/** A transport-independent handler response (P-12 maps it to HTTP). */
export interface ProxyResponse {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

/** BR-129: headers of the consent page and every error page. */
const PAGE_HEADERS: Array<[string, string]> = [
  ["Content-Type", "text/html; charset=utf-8"],
  ["Cache-Control", "no-store"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "no-referrer"],
  [
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  ],
];

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function document(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
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

export function errorPage(kind: ErrorPage, status = 400): ProxyResponse {
  return htmlPage(
    status,
    document(
      "Authorization error",
      `<h1>Authorization error</h1><p>${ERROR_TEXT[kind]}</p>`,
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
}

/** BR-129 v2 / BR-393: the consent page; every value is HTML-escaped. */
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
    "<h1>Authorize access</h1>",
    ...identity,
    `<p>Redirect URI: <code>${escapeHtml(view.redirectUri)}</code></p>`,
    `<p>Protected resource: <code>${escapeHtml(view.resource)}</code></p>`,
    `<form method="post" action="${escapeHtml(view.action)}">`,
    `<input type="hidden" name="consent" value="${escapeHtml(view.consentId)}">`,
    '<button type="submit" name="decision" value="approve">Approve</button>',
    '<button type="submit" name="decision" value="deny">Deny</button>',
    "</form>",
  ].join("");
  return htmlPage(200, document("Authorize access", body), [
    ["Set-Cookie", setCookie],
  ]);
}

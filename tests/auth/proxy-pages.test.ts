// F-030 (#23): the designed consent and error pages (BR-399–BR-403).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PAGE_STYLESHEET,
  consentPage,
  errorPage,
  escapeHtml,
  type ConsentView,
  type ErrorPage,
  type ProxyResponse,
} from "../../src/auth/proxy/pages.js";
import { FakeMetadata, cimdDocument } from "../helpers/cimd.js";
import { PUBLIC_URL, harness, header, s256 } from "../helpers/proxy.js";

const PRODUCT = "kdrive-mcp-server";
const UNOFFICIAL =
  "Unofficial MCP server for kDrive, not affiliated with Infomaniak.";
const GITHUB = "https://github.com/sstolz/kdrive-mcp-server";
const LINK = `<a href="${GITHUB}" target="_blank" rel="noopener noreferrer">Source code on GitHub</a>`;
const INTRO =
  "An application is asking to connect to this kdrive-mcp-server. The server gives MCP clients, such as AI assistants, access to files in kDrive, limited to the folders and mode its operator configured. Approve only if you started this connection yourself and recognise the client below.";
const AFTER =
  "Approve takes you to sign in with your account; the client gets access only after that sign-in. Deny returns to the client without access. Enter your password only on your identity provider's sign-in page, never on this page.";
const ERROR_NOTE =
  "This request was not completed. If your application is not connected, return to it and start the connection again.";
const ERROR_TEXT: Record<ErrorPage, string> = {
  invalid_request: "The authorization request is invalid.",
  consent: "This consent request is unknown, expired or already used.",
  callback: "This sign-in response is unknown, expired or already used.",
  busy: "Too many authorization requests are pending. Try again later.",
};
const KINDS = Object.keys(ERROR_TEXT) as ErrorPage[];
const challenge = s256("v".repeat(43));

function view(overrides: Partial<ConsentView> = {}): ConsentView {
  return {
    clientName: "Example client",
    clientId: "client-123",
    redirectUri: "https://app.example/cb",
    resource: PUBLIC_URL,
    action: `${PUBLIC_URL}/oauth/consent`,
    consentId: "consent-abc",
    ...overrides,
  };
}

const CIMD_ID = "https://client.example.com/c.json";

/** The pages of AC-01, rendered by direct calls. */
function pages(
  base: Partial<ConsentView> = {},
): Array<[string, ProxyResponse]> {
  return [
    ["registered consent", consentPage(view(base), "c=1")],
    [
      "CIMD consent with loopback",
      consentPage(
        view({
          clientId: CIMD_ID,
          redirectUri: "http://127.0.0.1:33418/cb",
          cimd: { host: "client.example.com", loopback: true },
          ...base,
        }),
        "c=1",
      ),
    ],
    [
      "CIMD consent without loopback",
      consentPage(
        view({
          clientId: CIMD_ID,
          cimd: { host: "client.example.com", loopback: false },
          ...base,
        }),
        "c=1",
      ),
    ],
    ...KINDS.map((kind): [string, ProxyResponse] => [
      `error ${kind} 400`,
      errorPage(kind, 400),
    ]),
    ["error busy 503", errorPage("busy", 503)],
  ];
}

function count(body: string, needle: string): number {
  return body.split(needle).length - 1;
}

function styleOf(body: string): string {
  const match = /<style>([^<]*)<\/style>/u.exec(body);
  if (!match?.[1]) throw new Error("no style element");
  return match[1];
}

function expectedCsp(body: string): string {
  const hash = createHash("sha256")
    .update(styleOf(body), "utf8")
    .digest("base64");
  return `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; style-src 'sha256-${hash}'`;
}

describe("BR-399 page shell", () => {
  it.each(pages())(
    "BR-399 AC-01 %s has the shared shell",
    (_name, response) => {
      const body = response.body;
      const title = /<title>([^<]*)<\/title>/u.exec(body)?.[1] ?? "";
      expect(title).toMatch(
        /^(Authorize access|Authorization error) · kdrive-mcp-server$/u,
      );
      expect(
        body.startsWith(
          '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="color-scheme" content="light dark">' +
            `<title>${title}</title><style>${PAGE_STYLESHEET}</style></head><body>`,
        ),
      ).toBe(true);
      expect(body.endsWith("</body></html>")).toBe(true);
      for (const tag of [
        "<style",
        "<header",
        "<main",
        "<footer",
        "<h1",
        "<svg",
      ])
        expect(count(body, tag)).toBe(1);
      const head = body.slice(
        body.indexOf("<header>"),
        body.indexOf("</header>"),
      );
      const svg = head.slice(head.indexOf("<svg"), head.indexOf("</svg>"));
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
      expect(svg).not.toMatch(/href|xmlns/u);
      expect(head).toContain(PRODUCT);
      expect(head).toContain(UNOFFICIAL);
      const main = body.slice(body.indexOf("<main"), body.indexOf("</main>"));
      expect(count(main, "<h1>")).toBe(1);
      expect(body.indexOf("<header")).toBeLessThan(body.indexOf("<main"));
      expect(count(body, "<a ")).toBe(1);
      expect(count(body, "<a")).toBe(1);
      expect(count(body, LINK)).toBe(1);
      const footer = body.slice(
        body.indexOf("<footer"),
        body.indexOf("</footer>"),
      );
      expect(footer).toContain(LINK);
      expect(body.indexOf(LINK)).toBeGreaterThan(body.indexOf("</main>"));
      if (body.includes("</form>"))
        expect(body.indexOf(LINK)).toBeGreaterThan(body.indexOf("</form>"));
    },
  );

  it("BR-399 AC-02 hostile view values never add elements, attributes or URLs", () => {
    const hostile = (field: string) =>
      `<script>${field}" onload="x" style="y" http://evil.example/${field} javascript:alert(1)`;
    const values = {
      clientId: hostile("id"),
      clientName: hostile("name"),
      redirectUri: hostile("redirect"),
      resource: hostile("resource"),
      action: hostile("action"),
    };
    const host = hostile("host");
    const rendered = [
      consentPage(view(values), "c=1"),
      consentPage(view({ ...values, cimd: { host, loopback: true } }), "c=1"),
      consentPage(view({ ...values, cimd: { host, loopback: false } }), "c=1"),
      ...KINDS.map((kind) => errorPage(kind, 400)),
      errorPage("busy", 503),
    ];
    for (const response of rendered) {
      let body = response.body;
      for (const value of [...Object.values(values), host])
        body = body.replaceAll(escapeHtml(value), "");
      expect(body).not.toMatch(
        /<(script|link|img|iframe|object|embed|base)\b|http-equiv|\son[a-z]+\s*=|\sstyle\s*=|javascript:/iu,
      );
      expect(body.match(/https?:[^"<\s]*/giu) ?? []).toEqual([GITHUB]);
    }
  });
});

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TOKENS = [
  "bg",
  "surface",
  "fg",
  "muted",
  "link",
  "code-fg",
  "code-bg",
  "primary-fg",
  "primary-bg",
  "secondary-fg",
  "secondary-bg",
  "border",
  "focus",
];
const PAIRS: Array<[string, string, number]> = [
  ["fg", "bg", 4.5],
  ["fg", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["link", "bg", 4.5],
  ["code-fg", "code-bg", 4.5],
  ["primary-fg", "primary-bg", 4.5],
  ["secondary-fg", "secondary-bg", 4.5],
  ["focus", "bg", 3],
  ["focus", "surface", 3],
  ["border", "surface", 3],
];
const LIGHT_BLOCK = /:root\s*\{([^}]*)\}/u;
const DARK_BLOCK =
  /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/u;

/** The trimmed declarations of a CSS fragment, split at `{`, `}` and `;`. */
function declarationsOf(css: string): string[] {
  return css.split(/[{};]/u).map((part) => part.trim());
}

function tokens(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of declarationsOf(block)) {
    const colon = part.indexOf(":");
    if (part.startsWith("--"))
      map.set(part.slice(2, colon), part.slice(colon + 1).trim());
  }
  return map;
}

describe("BR-400 stylesheet", () => {
  it("BR-400 AC-03 declares the colour tokens, stays static and meets the contrast pairs", () => {
    const css = PAGE_STYLESHEET;
    const lightBlock = LIGHT_BLOCK.exec(css)?.[1] ?? "";
    const darkBlock = DARK_BLOCK.exec(css)?.[1] ?? "";
    const light = tokens(lightBlock);
    const dark = tokens(darkBlock);
    // (1) the exact token set, #rrggbb values, redeclared in dark.
    expect([...light.keys()].sort()).toEqual([...TOKENS].sort());
    expect([...dark.keys()].sort()).toEqual([...TOKENS].sort());
    for (const value of [...light.values(), ...dark.values()])
      expect(value).toMatch(/^#[0-9a-f]{6}$/u);
    expect(lightBlock).toMatch(/color-scheme:\s*light dark/u);
    const rest = css.replace(DARK_BLOCK, "").replace(LIGHT_BLOCK, "");
    expect(
      declarationsOf(rest).filter((part) => part.startsWith("--")),
    ).toEqual([]);
    expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(rest).not.toMatch(
      /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/iu,
    );
    expect(rest).not.toMatch(
      /\b(transparent|currentcolor|white|black|gr[ae]y|silver|red|blue|green|navy)\b/iu,
    );
    for (const match of rest.matchAll(/var\(--([a-z-]+)\)/gu))
      expect(TOKENS).toContain(match[1]);
    expect(rest).toMatch(/body\s*\{[^}]*background:\s*var\(--bg\)/u);
    expect(rest).toMatch(/main\s*\{[^}]*background:\s*var\(--surface\)/u);
    expect(rest).toMatch(/code\s*\{[^}]*background:\s*var\(--code-bg\)/u);
    expect(rest).toMatch(
      /\.primary\s*\{[^}]*color:\s*var\(--primary-fg\)[^}]*background:\s*var\(--primary-bg\)/u,
    );
    expect(rest).toMatch(
      /\.secondary\s*\{[^}]*color:\s*var\(--secondary-fg\)[^}]*background:\s*var\(--secondary-bg\)/u,
    );
    // (2) system fonts only, no external resource.
    expect(css).not.toMatch(/@import|@font-face|url\(|image-set\(/iu);
    for (const match of css.matchAll(/font-family:\s*([^;}]+)/gu))
      for (const family of (match[1] ?? "").split(","))
        expect([
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          '"Liberation Mono"',
          "monospace",
        ]).toContain(family.trim());
    // (3) nothing moves.
    expect(css).not.toMatch(/transition|animation|@keyframes/iu);
    // (4) visible focus on buttons and links.
    const at = css.indexOf(":focus-visible");
    const open = css.indexOf("{", at);
    const selector = css.slice(css.lastIndexOf("}", at) + 1, open);
    const declarations = css.slice(open + 1, css.indexOf("}", open));
    expect(selector.split(",").sort()).toEqual([
      "a:focus-visible",
      "button:focus-visible",
    ]);
    const outline = /outline:\s*(\d+)px solid var\(--([a-z-]+)\)/u.exec(
      declarations,
    );
    expect(Number(outline?.[1])).toBeGreaterThanOrEqual(2);
    expect(TOKENS).toContain(outline?.[2]);
    // (5) wrapping, bounded width, border-box, no fixed width.
    expect(css).toMatch(/code\s*\{[^}]*overflow-wrap:\s*anywhere/u);
    const maxWidths = [...css.matchAll(/max-width:\s*([^;}]+)/gu)];
    expect(maxWidths.length).toBeGreaterThan(0);
    for (const match of maxWidths)
      expect(match[1]?.trim()).toMatch(/^[\d.]+(rem|%)$/u);
    expect(css).toMatch(
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/u,
    );
    for (const match of css.matchAll(
      /(?<![-\w])(?:min-)?width\s*:\s*([^;})]+)/gu,
    ))
      expect(match[1]?.trim()).toMatch(/^([\d.]+%|auto)$/u);
    // (6) contrast in both themes.
    for (const theme of [light, dark])
      for (const [fg, bg, threshold] of PAIRS)
        expect(
          contrast(theme.get(fg) ?? "", theme.get(bg) ?? ""),
          `${fg}/${bg}`,
        ).toBeGreaterThanOrEqual(threshold);
  });
});

describe("BR-401 style hash in the CSP", () => {
  it("BR-401 AC-04 every page carries the style hash of its own stylesheet", () => {
    const policies = new Set<string>();
    for (const [, response] of pages()) {
      expect(styleOf(response.body)).toBe(PAGE_STYLESHEET);
      const csp = header(response, "content-security-policy") ?? "";
      expect(csp).toBe(expectedCsp(response.body));
      expect(csp).not.toMatch(/unsafe-inline|nonce-/u);
      policies.add(csp);
      expect(header(response, "content-type")).toBe("text/html; charset=utf-8");
      expect(header(response, "cache-control")).toBe("no-store");
      expect(header(response, "x-frame-options")).toBe("DENY");
      expect(header(response, "referrer-policy")).toBe("no-referrer");
    }
    expect(policies.size).toBe(1);
  });
});

/** The positions of `parts` in `body`, asserting each follows the previous. */
function expectInOrder(body: string, parts: string[]): void {
  let position = -1;
  for (const part of parts) {
    const next = body.indexOf(part, position + 1);
    expect(next, part).toBeGreaterThan(position);
    position = next;
  }
}

describe("BR-402 consent page layout", () => {
  it("BR-402 AC-05 a registered client's page shows intro, details, form and note in order", async () => {
    const h = await harness();
    const client = await h.register({ client_name: "Plain" });
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge),
    });
    const body = response.body;
    expectInOrder(body, [
      "<h1>Authorize access</h1>",
      `<p>${INTRO}</p>`,
      "<h2>Request details</h2>",
      "<p>Client name: <strong>Plain (self-declared, unverified)</strong></p>",
      "<p>The client name is self-declared and unverified.</p>",
      `<p>Client ID: <code>${client.clientId}</code></p>`,
      `<p>Redirect URI: <code>${client.redirect}</code></p>`,
      `<p>Protected resource: <code>${PUBLIC_URL}</code></p>`,
      `<form method="post" action="${PUBLIC_URL}/oauth/consent">`,
      '<input type="hidden" name="consent" value="',
      '<button type="submit" name="decision" value="approve" class="button primary">Approve</button>',
      '<button type="submit" name="decision" value="deny" class="button secondary">Deny</button>',
      "</form>",
      `<p class="note">${AFTER}</p>`,
      "</main>",
    ]);
    expect(body).not.toContain("Client host:");
    expect(body).not.toContain("metadata document");
    expect(body).not.toContain("(loopback)");
  });

  it.each([
    ["http://127.0.0.1:33418/cb", true],
    ["https://app.example/cb", false],
  ])(
    "BR-402 AC-05 a CIMD client's page with redirect %s shows its lines in order",
    async (redirect, loopback) => {
      const redirects = ["http://127.0.0.1:33418/cb", "https://app.example/cb"];
      const meta = new FakeMetadata();
      meta.serve.set(CIMD_ID, {
        body: cimdDocument(CIMD_ID, {
          client_name: "<b>Claude</b>",
          redirect_uris: redirects,
        }),
      });
      const h = await harness({
        origins: ["https://client.example.com"],
        clientMetadata: meta,
        redirects,
      });
      const response = await h.proxy.authorize({
        query: h.authorizeQuery(
          { clientId: CIMD_ID, method: "none", redirect },
          challenge,
        ),
      });
      const body = response.body;
      const loopbackLine =
        "<p>This client redirects to this computer only (loopback).</p>";
      expectInOrder(body, [
        "<h1>Authorize access</h1>",
        `<p>${INTRO}</p>`,
        "<h2>Request details</h2>",
        `<p>Client ID: <code>${CIMD_ID}</code></p>`,
        "<p>Client host: client.example.com</p>",
        "<p>Client name: <strong>&lt;b&gt;Claude&lt;/b&gt; (self-declared, unverified)</strong></p>",
        "<p>This name comes from the client's metadata document and is unverified.</p>",
        ...(loopback ? [loopbackLine] : []),
        `<p>Redirect URI: <code>${redirect}</code></p>`,
        `<p>Protected resource: <code>${PUBLIC_URL}</code></p>`,
        `<form method="post" action="${PUBLIC_URL}/oauth/consent">`,
        'class="button primary">Approve</button>',
        'class="button secondary">Deny</button>',
        "</form>",
        `<p class="note">${AFTER}</p>`,
      ]);
      if (!loopback) expect(body).not.toContain(loopbackLine);
    },
  );

  it("BR-402 AC-05 every view field shows only escaped", () => {
    const raw = `"<>&'`;
    const escaped = "&quot;&lt;&gt;&amp;&#39;";
    const fields: ConsentView = {
      clientName: `n${raw}`,
      clientId: `i${raw}`,
      redirectUri: `r${raw}`,
      resource: `s${raw}`,
      action: `a${raw}`,
      consentId: `c${raw}`,
      cimd: { host: `h${raw}`, loopback: true },
    };
    const body = consentPage(fields, "c=1").body;
    expect(body).not.toContain(raw);
    for (const prefix of ["n", "i", "r", "s", "a", "c", "h"])
      expect(body).toContain(`${prefix}${escaped}`);
  });
});

describe("BR-403 error page layout", () => {
  it.each(KINDS)(
    "BR-403 AC-06 the %s page carries its text and the fixed note",
    (kind) => {
      const response = errorPage(kind);
      expect(response.status).toBe(400);
      expectInOrder(response.body, [
        "<h1>Authorization error</h1>",
        `<p>${ERROR_TEXT[kind]}</p>`,
        `<p class="note">${ERROR_NOTE}</p>`,
        "</main>",
      ]);
    },
  );

  it(
    "BR-403 AC-06 the 400 and 503 pages of authorize carry no request value",
    { timeout: 60_000 },
    async () => {
      const h = await harness();
      const client = await h.register();
      const unknown = await h.proxy.authorize({
        query: h.authorizeQuery(client, challenge, { client_id: "<x>" }),
      });
      for (let index = 0; index < 1000; index += 1)
        await h.proxy.authorize({ query: h.authorizeQuery(client, challenge) });
      const full = await h.proxy.authorize({
        query: h.authorizeQuery(client, challenge),
      });
      expect(unknown.status).toBe(400);
      expect(full.status).toBe(503);
      for (const [response, kind] of [
        [unknown, "invalid_request"],
        [full, "busy"],
      ] as const) {
        expect(response.body).toContain(`<p>${ERROR_TEXT[kind]}</p>`);
        expect(response.body).toContain(`<p class="note">${ERROR_NOTE}</p>`);
        expect(response.body).not.toContain("<x>");
        expect(response.body).not.toContain("&lt;x&gt;");
        expect(response.body).not.toContain(client.redirect);
      }
    },
  );
});

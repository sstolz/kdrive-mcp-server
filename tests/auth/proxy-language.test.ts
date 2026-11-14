// F-031 (#31): OAuth proxy pages in English and French (BR-404–BR-410,
// BR-143 v4).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  acceptLanguage,
  langParameter,
  pageLanguage,
} from "../../src/auth/proxy/language.js";
import {
  MESSAGES,
  errorPage,
  escapeHtml,
  type ErrorPage,
  type Messages,
  type ProxyResponse,
} from "../../src/auth/proxy/pages.js";
import { proxyStateSnapshot } from "../../src/auth/proxy/proxy.js";
import { FakeMetadata, cimdDocument } from "../helpers/cimd.js";
import {
  NAMES,
  OTHER,
  TEXTS,
  type PageLanguage,
} from "../helpers/page-texts.js";
import {
  COOKIE,
  PUBLIC_URL,
  harness,
  header,
  headers,
  s256,
  type Harness,
  type Registered,
} from "../helpers/proxy.js";

const challenge = s256("v".repeat(43));
const LANGUAGES: PageLanguage[] = ["en", "fr"];
const KINDS: ErrorPage[] = ["invalid_request", "consent", "callback", "busy"];
const GITHUB_LINK = '<a href="https://github.com/sstolz/kdrive-mcp-server"';
/** The issuer path of the harness plus the authorize route (BR-408). */
const AUTHORIZE_PATH = "/mcp/oauth/authorize?";

function htmlLang(response: ProxyResponse): string | undefined {
  return /^<!doctype html><html lang="([a-z]+)">/u.exec(response.body)?.[1];
}

function headerOf(body: string): string {
  return body.slice(body.indexOf("<header>"), body.indexOf("</header>"));
}

/** The switcher href of a consent page, unescaped, or undefined. */
function switchHref(body: string): string | undefined {
  const raw = /<nav class="languages"[^>]*>.*?<a href="\?([^"]*)"/u.exec(
    body,
  )?.[1];
  return raw?.replaceAll("&amp;", "&");
}

function count(body: string, needle: string): number {
  return body.split(needle).length - 1;
}

function pendingConsents(h: Harness): number {
  return (proxyStateSnapshot(h.proxy) as { consents: unknown[] }).consents
    .length;
}

/** Every object key of a JSON value, recursively. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [
      key,
      ...keysOf(inner),
    ]);
  return [];
}

describe("BR-406 Accept-Language parsing", () => {
  it.each([
    ["fr-CH, fr;q=0.9, en;q=0.8", "fr"],
    ["de-CH,de;q=0.9", undefined],
    ["de, *;q=0.1", "en"],
    ["en;q=0, fr;q=0.1", "fr"],
    ["fr;q=0", undefined],
    ["FR-ch", "fr"],
    ["fr;q=0.5, en;q=0.5", "fr"],
    ["fr;q=2", undefined],
    ["fr_CH", undefined],
    ["fr;level=1", undefined],
    ["en;q=0, *", "fr"],
    ["en-GB;q=0, *", "fr"],
    ["en;q=0.1, *", "en"],
    ["en;q=0, fr;q=0, *", undefined],
    [undefined, undefined],
    ["", undefined],
    [`fr${" ".repeat(255)}`, undefined],
    [`fr${" ".repeat(254)}`, "fr"],
    ["*", "en"],
    ["en-GB,fr;q=0.9", "en"],
    ["fr ; q=0.700", "fr"],
    ["\tfr;Q=1.000 ", "fr"],
    ["fr;q=1.0001", undefined],
    ["fr;q=0., en;q=0.001", "en"],
    ["de, fr;q=1.", "fr"],
  ])("BR-406 AC-01 %j gives %s", (value, expected) => {
    expect(acceptLanguage(value)).toBe(expected);
  });
});

describe("BR-404 page-language resolution", () => {
  it.each([
    ["", undefined, "en"],
    ["", "fr", "fr"],
    ["lang=fr", undefined, "fr"],
    ["lang=en", "fr", "en"],
    ["lang=%66r", undefined, "fr"],
    ["lang=FR", undefined, "en"],
    ["lang=FR", "fr", "fr"],
    ["lang=fr-CH", "fr", "fr"],
    ["lang=de", undefined, "en"],
    ["lang=", "fr", "fr"],
    ["lang=en&lang=en", "fr", "fr"],
    ["lang=fr&lang=fr", undefined, "en"],
    ["", `fr${" ".repeat(255)}`, "en"],
    ["", "de", "en"],
  ])(
    "BR-404 AC-01 query %j with Accept-Language %j gives %s",
    (query, value, expected) => {
      expect(pageLanguage(new URLSearchParams(query), value)).toBe(expected);
    },
  );

  it("BR-404 AC-01 reads lang only when it is present exactly once", () => {
    expect(langParameter(new URLSearchParams("a=1&lang=fr"))).toBe("fr");
    expect(langParameter(new URLSearchParams("lang=en"))).toBe("en");
    expect(
      langParameter(new URLSearchParams("lang=fr&lang=en")),
    ).toBeUndefined();
    expect(langParameter(new URLSearchParams("lang=%20fr"))).toBeUndefined();
    expect(langParameter(new URLSearchParams())).toBeUndefined();
    expect(pageLanguage(undefined, undefined)).toBe("en");
  });
});

/** A fresh harness with one registered client. */
async function registered(): Promise<{ h: Harness; client: Registered }> {
  const h = await harness();
  return { h, client: await h.register() };
}

describe("BR-405 the lang parameter", () => {
  it("BR-405 AC-02 chooses the consent page language and refuses only a repeated lang", async () => {
    const { h, client } = await registered();
    const show = (extra: Record<string, string>, value?: string) =>
      h.proxy.authorize({
        query: h.authorizeQuery(client, challenge, extra),
        ...(value === undefined ? {} : { acceptLanguage: value }),
      });
    const french = await show({ lang: "fr" });
    const german = await show({ lang: "de" });
    const upper = await show({ lang: "FR" });
    const fromHeader = await show({}, "fr");
    for (const [response, language] of [
      [french, "fr"],
      [german, "en"],
      [upper, "en"],
      [fromHeader, "fr"],
    ] as const) {
      expect(response.status).toBe(200);
      expect(htmlLang(response)).toBe(language);
      expect(response.body).toContain(
        `<h1>${TEXTS[language].consentTitle}</h1>`,
      );
    }
    const repeated = h.authorizeQuery(client, challenge, { lang: "fr" });
    repeated.append("lang", "en");
    const before = h.logs.length;
    const refused = await h.proxy.authorize({ query: repeated });
    const refusedLogs = h.logs.slice(before);
    const reference = h.authorizeQuery(client, challenge);
    reference.append("client_id", client.clientId);
    const middle = h.logs.length;
    const referenceRefused = await h.proxy.authorize({ query: reference });
    expect(refused.status).toBe(400);
    expect(refused.body).toContain(`<p>${TEXTS.en.error.invalid_request}</p>`);
    expect(refused.body).toBe(referenceRefused.body);
    expect(refusedLogs).toEqual(h.logs.slice(middle));
    expect(refusedLogs).toEqual([
      {
        name: "authorization_refused",
        fields: { handler: "authorize", status: 400 },
      },
    ]);
  });

  /** Runs `steps` on a fresh proxy (same deterministic random sequence). */
  async function outcome(
    withLang: boolean,
    steps: (
      h: Harness,
      client: Registered,
      lang: Record<string, string>,
    ) => Promise<ProxyResponse>,
  ): Promise<{ location: string | undefined; snapshot: string }> {
    const { h, client } = await registered();
    const response = await steps(h, client, withLang ? { lang: "fr" } : {});
    expect(response.status).toBe(302);
    return {
      location: header(response, "location"),
      snapshot: JSON.stringify(proxyStateSnapshot(h.proxy)),
    };
  }

  async function decide(
    h: Harness,
    client: Registered,
    lang: Record<string, string>,
    decision: string,
  ): Promise<ProxyResponse> {
    const page = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, lang),
    });
    expect(htmlLang(page)).toBe(lang.lang ?? "en");
    return h.proxy.consent({
      form: new URLSearchParams({ consent: h.consentId(page), decision }),
      cookie: `${COOKIE}=${h.cookieOf(page)}`,
      query: new URLSearchParams(lang),
    });
  }

  it.each<
    [
      string,
      (
        h: Harness,
        client: Registered,
        lang: Record<string, string>,
      ) => Promise<ProxyResponse>,
    ]
  >([
    [
      "a missing code_challenge",
      (h, client, lang) =>
        h.proxy.authorize({
          query: h.authorizeQuery(client, challenge, {
            code_challenge: undefined,
            ...lang,
          }),
        }),
    ],
    [
      "a wrong resource",
      (h, client, lang) =>
        h.proxy.authorize({
          query: h.authorizeQuery(client, challenge, {
            resource: "https://other.test/mcp",
            ...lang,
          }),
        }),
    ],
    ["a deny from a French page", (h, c, lang) => decide(h, c, lang, "deny")],
    [
      "an approve from a French page",
      (h, c, lang) => decide(h, c, lang, "approve"),
    ],
  ])(
    "BR-405 AC-02 %s gives the same redirect with and without lang",
    async (_name, steps) => {
      const plain = await outcome(false, steps);
      const french = await outcome(true, steps);
      expect(french.location).toBeDefined();
      expect(french.location).toBe(plain.location);
      expect(french.location).not.toContain("lang");
      expect(french.snapshot).not.toContain("lang");
      expect(french.snapshot).toBe(plain.snapshot);
    },
  );
});

describe("BR-407 message catalogue", () => {
  it("BR-407 AC-03 both catalogues hold the same keys and the exact texts", () => {
    const en: Messages = MESSAGES.en;
    const fr: Messages = MESSAGES.fr;
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(fr.error).sort()).toEqual(Object.keys(en.error).sort());
    expect(Object.keys(en.error).sort()).toEqual([...KINDS].sort());
    for (const language of LANGUAGES) {
      const { error, ...plain } = MESSAGES[language];
      const { error: expectedError, ...expectedPlain } = TEXTS[language];
      expect(plain).toEqual(expectedPlain);
      expect(error).toEqual(expectedError);
      for (const value of [...Object.values(plain), ...Object.values(error)]) {
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(/[<>&"]/u);
      }
    }
    const { error: enError, ...enPlain } = MESSAGES.en;
    const { error: frError, ...frPlain } = MESSAGES.fr;
    for (const [key, value] of Object.entries(frPlain))
      expect(value, key).not.toBe(enPlain[key as keyof typeof enPlain]);
    for (const kind of KINDS) expect(frError[kind]).not.toBe(enError[kind]);
    const { approve, ...missing } = MESSAGES.en;
    expect(approve).toBe("Approve");
    // @ts-expect-error -- BR-407: a catalogue missing one key is not a Messages.
    const incomplete: Messages = missing;
    expect(incomplete).not.toHaveProperty("approve");
  });
});

const SWITCH_REDIRECT = "https://app.example/cb?a=1&b=2";
const HOSTILE_STATE = `"<x>'&`;
const CIMD_ID = "https://client.example.com/c.json";

/** A harness serving one registered and one CIMD client for that redirect. */
async function switchHarness() {
  const meta = new FakeMetadata();
  meta.serve.set(CIMD_ID, {
    body: cimdDocument(CIMD_ID, { redirect_uris: [SWITCH_REDIRECT] }),
  });
  const h = await harness({
    origins: ["https://client.example.com"],
    clientMetadata: meta,
    redirects: [SWITCH_REDIRECT],
  });
  const client = await h.register({ redirect_uris: [SWITCH_REDIRECT] });
  return { h, ids: [client.clientId, CIMD_ID] };
}

/** The AC-04 query, with `lang` after `state` when given. */
function switchQuery(clientId: string, lang?: string): URLSearchParams {
  const query = new URLSearchParams([
    ["client_id", clientId],
    ["redirect_uri", SWITCH_REDIRECT],
    ["state", HOSTILE_STATE],
  ]);
  if (lang !== undefined) query.append("lang", lang);
  for (const pair of [
    ["code_challenge", challenge],
    ["code_challenge_method", "S256"],
    ["response_type", "code"],
    ["resource", PUBLIC_URL],
    ["scope", "files"],
    ["extra", "1"],
  ])
    query.append(pair[0] ?? "", pair[1] ?? "");
  return query;
}

function expectedNav(language: PageLanguage, query: string): string {
  const item = (code: PageLanguage) =>
    code === language
      ? `<span lang="${code}" aria-current="true">${NAMES[code]}</span>`
      : `<a href="?${escapeHtml(query)}" lang="${code}" hreflang="${code}">${NAMES[code]}</a>`;
  return `<nav class="languages" aria-label="${TEXTS[language].languageNav}">${item("en")} ${item("fr")}</nav>`;
}

/** Every error page: direct renders and one of each route, both languages. */
async function everyErrorPage(): Promise<Array<[string, ProxyResponse]>> {
  const { h, ids } = await switchHarness();
  const pages: Array<[string, ProxyResponse]> = [];
  for (const language of LANGUAGES) {
    for (const kind of KINDS)
      for (const status of [400, 503])
        pages.push([
          `${kind} ${status} ${language}`,
          errorPage(kind, status, language),
        ]);
    const unknown = switchQuery("unknown-client", language);
    pages.push([
      `authorize ${language}`,
      await h.proxy.authorize({ query: unknown }),
    ]);
    const cimdRefused = switchQuery("https://other.example/c.json", language);
    pages.push([
      `authorize CIMD ${language}`,
      await h.proxy.authorize({ query: cimdRefused }),
    ]);
    pages.push([
      `consent ${language}`,
      await h.proxy.consent({
        form: new URLSearchParams({ consent: "unknown", decision: "approve" }),
        query: new URLSearchParams({ lang: language }),
      }),
    ]);
    pages.push([
      `callback ${language}`,
      await h.proxy.callback({
        query: new URLSearchParams({ state: HOSTILE_STATE, code: "c" }),
        acceptLanguage: language,
      }),
    ]);
  }
  expect(ids).toHaveLength(2);
  return pages;
}

describe("BR-408 language switcher", () => {
  it.each([
    ["registered", 0, undefined, "en"],
    ["registered", 0, "fr", "fr"],
    ["registered", 0, "en", "en"],
    ["CIMD", 1, undefined, "en"],
    ["CIMD", 1, "fr", "fr"],
    ["CIMD", 1, "en", "en"],
  ] as const)(
    "BR-408 AC-04 a %s client with lang %s shows the exact switcher",
    async (_kind, index, lang, language) => {
      const { h, ids } = await switchHarness();
      const query = switchQuery(ids[index] ?? "", lang);
      const response = await h.proxy.authorize({ query });
      expect(response.status).toBe(200);
      expect(htmlLang(response)).toBe(language);
      const other = OTHER[language];
      const expected = new URLSearchParams(query);
      expected.set("lang", other);
      const head = headerOf(response.body);
      expect(head.endsWith(expectedNav(language, expected.toString()))).toBe(
        true,
      );
      expect(count(response.body, "<nav")).toBe(1);
      expect(count(response.body, "<a ")).toBe(2);
      const raw = /<a href="\?([^"]*)" lang=/u.exec(head)?.[1] ?? "";
      expect(raw).not.toMatch(/["<']|&(?!amp;)/u);
      const href = switchHref(response.body) ?? "";
      expect([...new URLSearchParams(href)]).toEqual([...expected]);
      if (lang !== undefined)
        expect([...new URLSearchParams(href).keys()].indexOf("lang")).toBe(3);
      const followed = await h.proxy.authorize({
        query: new URLSearchParams(href),
      });
      expect(followed.status).toBe(200);
      expect(htmlLang(followed)).toBe(other);
    },
  );

  it("BR-408 AC-04 omits the switcher when its link would exceed 8,192 bytes", async () => {
    const { h, ids } = await switchHarness();
    const linkLength = (query: URLSearchParams) => {
      const link = new URLSearchParams(query);
      link.set("lang", "fr");
      return Buffer.byteLength(`${AUTHORIZE_PATH}${link.toString()}`);
    };
    const sized = (total: number) => {
      const query = switchQuery(ids[0] ?? "");
      query.delete("extra");
      const padding = total - linkLength(query) - "&extra=".length;
      query.append("extra", "x".repeat(padding));
      expect(linkLength(query)).toBe(total);
      return query;
    };
    const fits = await h.proxy.authorize({ query: sized(8192) });
    const exceeds = await h.proxy.authorize({ query: sized(8193) });
    expect(fits.status).toBe(200);
    expect(count(fits.body, "<nav")).toBe(1);
    expect(exceeds.status).toBe(200);
    expect(exceeds.body).not.toContain("<nav");
    expect(count(exceeds.body, "<a ")).toBe(1);
  });

  it(
    "BR-408 AC-04 no error page carries a switcher",
    { timeout: 30_000 },
    async () => {
      for (const [name, response] of await everyErrorPage()) {
        expect(response.status, name).toBeGreaterThanOrEqual(400);
        for (const needle of ["<nav", "hreflang", "?lang="])
          expect(response.body, name).not.toContain(needle);
        expect(count(response.body, "<a"), name).toBe(1);
        expect(count(response.body, GITHUB_LINK), name).toBe(1);
      }
    },
  );

  it(
    "BR-143 v4 the state appears only inside the consent page's switcher href",
    { timeout: 30_000 },
    async () => {
      const encoded = "%22%3Cx%3E%27%26";
      const plainEscaped = escapeHtml(HOSTILE_STATE);
      const { h, ids } = await switchHarness();
      for (const id of ids)
        for (const lang of [undefined, "fr"]) {
          const body = (
            await h.proxy.authorize({ query: switchQuery(id, lang) })
          ).body;
          expect(body).not.toContain(HOSTILE_STATE);
          expect(body).not.toContain(plainEscaped);
          expect(count(body, encoded)).toBe(1);
          const nav = body.slice(body.indexOf("<nav"), body.indexOf("</nav>"));
          expect(nav).toContain(encoded);
        }
      for (const [name, response] of await everyErrorPage()) {
        expect(response.body, name).not.toContain(HOSTILE_STATE);
        expect(response.body, name).not.toContain(plainEscaped);
        expect(response.body, name).not.toContain(encoded);
      }
    },
  );
});

describe("BR-409 a language switch replaces the pending consent", () => {
  async function approves(
    h: Harness,
    page: ProxyResponse,
    cookie: string,
  ): Promise<number> {
    return (
      await h.proxy.consent({
        form: new URLSearchParams({
          consent: h.consentId(page),
          decision: "approve",
        }),
        cookie,
      })
    ).status;
  }

  async function start() {
    const { h, client } = await registered();
    const first = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge),
    });
    const cookie = `${COOKIE}=${h.cookieOf(first)}`;
    const link = new URLSearchParams(switchHref(first.body) ?? "");
    expect(link.get("lang")).toBe("fr");
    return { h, client, first, cookie, link };
  }

  it("BR-409 AC-05 following the switcher with the cookie replaces the consent", async () => {
    const { h, first, cookie, link } = await start();
    expect(pendingConsents(h)).toBe(1);
    const switched = await h.proxy.authorize({ query: link, cookie });
    expect(switched.status).toBe(200);
    expect(htmlLang(switched)).toBe("fr");
    expect(pendingConsents(h)).toBe(1);
    const stale = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(first),
        decision: "approve",
      }),
      cookie,
    });
    expect(stale.status).toBe(400);
    expect(stale.body).toContain(`<p>${TEXTS.en.error.consent}</p>`);
    expect(await approves(h, switched, cookie)).toBe(302);
  });

  it(
    "BR-409 AC-05 a switch on a full store still shows the consent page",
    { timeout: 60_000 },
    async () => {
      const { h, client, cookie, link } = await start();
      for (let index = 1; index < 1000; index += 1)
        await h.proxy.authorize({ query: h.authorizeQuery(client, challenge) });
      expect(pendingConsents(h)).toBe(1000);
      const switched = await h.proxy.authorize({ query: link, cookie });
      expect(switched.status).toBe(200);
      expect(htmlLang(switched)).toBe("fr");
      expect(pendingConsents(h)).toBe(1000);
    },
  );

  it.each<
    [
      string,
      (
        h: Harness,
        client: Registered,
        link: URLSearchParams,
        cookie: string,
      ) => { query: URLSearchParams; cookie?: string },
    ]
  >([
    ["the switch without the cookie", (_h, _c, link) => ({ query: link })],
    [
      "the same request without lang",
      (h, client, _l, cookie) => ({
        query: h.authorizeQuery(client, challenge),
        cookie,
      }),
    ],
    [
      "a different state with lang",
      (h, client, _l, cookie) => ({
        query: h.authorizeQuery(client, challenge, {
          state: "other-state",
          lang: "fr",
        }),
        cookie,
      }),
    ],
    [
      "the switch with another well-formed cookie",
      (_h, _c, link) => ({
        query: link,
        cookie: `${COOKIE}=${"A".repeat(43)}`,
      }),
    ],
  ])("BR-409 AC-05 %s adds a consent and deletes none", async (_n, make) => {
    const { h, client, first, cookie, link } = await start();
    const added = await h.proxy.authorize(make(h, client, link, cookie));
    expect(added.status).toBe(200);
    expect(pendingConsents(h)).toBe(2);
    expect(await approves(h, first, cookie)).toBe(302);
  });

  it("BR-409 AC-05 only the older of two equal consents is replaced", async () => {
    const { h, client, first, cookie, link } = await start();
    const second = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge),
      cookie,
    });
    expect(pendingConsents(h)).toBe(2);
    const switched = await h.proxy.authorize({ query: link, cookie });
    expect(switched.status).toBe(200);
    expect(pendingConsents(h)).toBe(2);
    expect(await approves(h, first, cookie)).toBe(400);
    expect(await approves(h, second, cookie)).toBe(302);
    expect(await approves(h, switched, cookie)).toBe(302);
  });
});

describe("BR-410 localisation adds no cookie, header or stored data", () => {
  function csp(body: string): string {
    const style = /<style>([^<]*)<\/style>/u.exec(body)?.[1] ?? "";
    const hash = createHash("sha256").update(style, "utf8").digest("base64");
    return `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; style-src 'sha256-${hash}'`;
  }

  it(
    "BR-410 AC-06 every page keeps the BR-129 headers and one CSP",
    { timeout: 30_000 },
    async () => {
      const { h, ids } = await switchHarness();
      const policies = new Set<string>();
      const expectHeaders = (response: ProxyResponse, cookies: number) => {
        expect(header(response, "content-type")).toBe(
          "text/html; charset=utf-8",
        );
        expect(header(response, "cache-control")).toBe("no-store");
        expect(header(response, "x-frame-options")).toBe("DENY");
        expect(header(response, "referrer-policy")).toBe("no-referrer");
        const policy = header(response, "content-security-policy") ?? "";
        expect(policy).toBe(csp(response.body));
        policies.add(policy);
        expect(headers(response, "set-cookie")).toHaveLength(cookies);
        expect(response.headers).toHaveLength(5 + cookies);
      };
      for (const id of ids)
        for (const language of LANGUAGES) {
          const response = await h.proxy.authorize({
            query: switchQuery(id, language),
          });
          expect(htmlLang(response)).toBe(language);
          expectHeaders(response, 1);
          expect(header(response, "set-cookie")).toMatch(
            /^__Host-kdrive-oauth=/u,
          );
        }
      for (const [, response] of await everyErrorPage())
        expectHeaders(response, 0);
      expect(policies.size).toBe(1);
    },
  );

  it("BR-410 AC-06 a French flow stores and logs no language", async () => {
    const { h, client } = await registered();
    const page = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, { lang: "fr" }),
      acceptLanguage: "fr",
    });
    expect(htmlLang(page)).toBe("fr");
    const cookie = `${COOKIE}=${h.cookieOf(page)}`;
    const upstreamRedirect = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(page),
        decision: "approve",
      }),
      cookie,
      query: new URLSearchParams({ lang: "fr" }),
      acceptLanguage: "fr",
    });
    expect(upstreamRedirect.status).toBe(302);
    const done = await h.callback({ page, cookie, upstreamRedirect }, {}, {});
    expect(done.status).toBe(302);
    const snapshot = proxyStateSnapshot(h.proxy);
    for (const key of [
      ...keysOf(snapshot),
      ...h.logs.flatMap((entry) => Object.keys(entry.fields)),
    ])
      expect(["lang", "fr", "language"]).not.toContain(key);
    for (const entry of h.logs)
      expect(Object.values(entry.fields)).not.toContain("fr");
    expect(JSON.stringify(snapshot)).not.toContain("lang");
  });
});

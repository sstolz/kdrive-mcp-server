import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STORE_LIMIT, type ProxyResponse } from "../../src/auth/proxy/index.js";
import { proxyStateSnapshot } from "../../src/auth/proxy/proxy.js";
import type { OAuthStateStore } from "../../src/auth/proxy/store.js";
import {
  CLAUDE,
  COOKIE,
  Clock,
  PUBLIC_URL,
  SECOND,
  UPSTREAM,
  counterRandom,
  harness,
  header,
  headers,
  location,
  openState,
  removeStateFiles,
  s256,
  stateFile,
  type Harness,
  type HarnessOptions,
  type Registered,
} from "../helpers/proxy.js";
import { FakeMetadata, cimdDocument } from "../helpers/cimd.js";
import { TEXTS } from "../helpers/page-texts.js";

const challenge = s256("v".repeat(43));
const ATTRIBUTES = "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600";

/** BR-401: the CSP with the hash recomputed from the page's own `<style>`. */
function expectedCsp(body: string): string {
  const style = /<style>([^<]*)<\/style>/u.exec(body)?.[1] ?? "";
  const hash = createHash("sha256").update(style, "utf8").digest("base64");
  return `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; style-src 'sha256-${hash}'`;
}

async function page(h: Harness, client: Registered, cookie?: string) {
  return h.proxy.authorize({
    query: h.authorizeQuery(client, challenge),
    ...(cookie === undefined ? {} : { cookie }),
  });
}

describe("BR-129 consent page", () => {
  it("BR-129 v3 shows an escaped, unverified client name, the exact redirect and a fresh identifier each time", async () => {
    const h = await harness();
    const client = await h.register({
      client_name: "<script>alert(1)</script>",
    });
    const first = await page(h, client);
    const second = await page(h, client);
    for (const response of [first, second]) {
      expect(response.status).toBe(200);
      expect(response.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(response.body).not.toContain("<script>");
      expect(response.body).toContain("unverified");
      expect(response.body).toContain(client.redirect);
      expect(response.body).toContain(client.clientId);
      expect(response.body).toContain(PUBLIC_URL);
      expect(response.body).toContain(
        `action="${PUBLIC_URL}/oauth/consent?lang=en"`,
      );
      expect(header(response, "cache-control")).toBe("no-store");
      expect(header(response, "x-frame-options")).toBe("DENY");
      expect(header(response, "referrer-policy")).toBe("no-referrer");
      expect(header(response, "content-security-policy")).toBe(
        expectedCsp(response.body),
      );
    }
    expect(h.consentId(first)).not.toBe(h.consentId(second));
  });

  it("BR-129 labels a client without a name", async () => {
    const h = await harness();
    const response = await page(h, await h.register());
    expect(response.body).toContain("unnamed client");
  });

  it("BR-129 deny redirects to the client with access_denied, state and iss", async () => {
    const h = await harness();
    const client = await h.register();
    const response = await page(h, client);
    const denied = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(response),
        decision: "deny",
      }),
      cookie: `${COOKIE}=${h.cookieOf(response)}`,
    });
    expect(denied.status).toBe(302);
    const target = location(denied);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
    expect(h.upstream.calls).toEqual([]);
  });
});

describe("BR-130 browser binding of the consent", () => {
  it("BR-130 sets the cookie with exactly the stated attributes and reuses a single well-formed value", async () => {
    const h = await harness();
    const client = await h.register();
    const first = await page(h, client);
    const value = h.cookieOf(first);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(headers(first, "set-cookie")).toEqual([
      `${COOKIE}=${value}${ATTRIBUTES}`,
    ]);
    const reused = await page(h, client, `other=1; ${COOKIE}=${value}`);
    expect(h.cookieOf(reused)).toBe(value);
    const two = await page(h, client, `${COOKIE}=${value}; ${COOKIE}=${value}`);
    expect(h.cookieOf(two)).not.toBe(value);
    const malformed = await page(h, client, `${COOKIE}=short`);
    expect(h.cookieOf(malformed)).not.toBe("short");
  });

  it.each([
    ["without the cookie", () => undefined, {}],
    ["with another cookie value", () => `${COOKIE}=${"A".repeat(43)}`, {}],
    [
      "with two cookies of that name",
      (v: string) => `${COOKIE}=${v}; ${COOKIE}=${v}`,
      {},
    ],
    [
      "with decision maybe",
      (v: string) => `${COOKIE}=${v}`,
      { decision: "maybe" },
    ],
  ])(
    "BR-130 refuses a consent posted %s and consumes it",
    async (_l, cookieFor, extra) => {
      const h = await harness();
      const client = await h.register();
      const response = await page(h, client);
      const value = h.cookieOf(response);
      const id = h.consentId(response);
      const cookie = cookieFor(value);
      const refused = await h.proxy.consent({
        form: new URLSearchParams({
          consent: id,
          decision: "approve",
          ...extra,
        }),
        ...(cookie === undefined ? {} : { cookie }),
      });
      expect(refused.status).toBe(400);
      expect(header(refused, "location")).toBeUndefined();
      const retry = await h.proxy.consent({
        form: new URLSearchParams({ consent: id, decision: "approve" }),
        cookie: `${COOKIE}=${value}`,
      });
      expect(retry.status).toBe(400);
      expect(h.upstream.calls).toEqual([]);
    },
  );

  it("BR-129 refuses an expired or reused consent identifier", async () => {
    const h = await harness();
    const client = await h.register();
    const response = await page(h, client);
    const cookie = `${COOKIE}=${h.cookieOf(response)}`;
    h.clock.advance(600 * SECOND);
    const expired = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(response),
        decision: "approve",
      }),
      cookie,
    });
    expect(expired.status).toBe(400);
    const fresh = await page(h, client);
    const flow = { consent: h.consentId(fresh), decision: "deny" };
    const ok = await h.proxy.consent({
      form: new URLSearchParams(flow),
      cookie: `${COOKIE}=${h.cookieOf(fresh)}`,
    });
    expect(ok.status).toBe(302);
    // BR-129 v5: a reuse inside the BR-411 window is replayed (AC-04).
    h.clock.advance(10 * SECOND);
    const again = await h.proxy.consent({
      form: new URLSearchParams(flow),
      cookie: `${COOKIE}=${h.cookieOf(fresh)}`,
    });
    expect(again.status).toBe(400);
  });

  it("BR-130 the approval redirect re-sends the same cookie with Max-Age=600", async () => {
    const h = await harness();
    const client = await h.register();
    const flow = await h.approve(client, "v".repeat(43));
    expect(flow.upstreamRedirect.status).toBe(302);
    expect(headers(flow.upstreamRedirect, "set-cookie")).toEqual([
      `${flow.cookie}${ATTRIBUTES}`,
    ]);
  });
});

// F-028 AC-09 / F-030 AC-05: the consent page of a CIMD client (BR-393 v2, BR-129 v3).
describe("BR-393 v2 BR-129 v3 consent page of a CIMD client", () => {
  const URL_ID = "https://client.example.com/c.json";
  const redirects = [
    "http://127.0.0.1/cb",
    "http://127.0.0.2/cb",
    "http://[::1]/cb",
    "http://localhost/cb",
    "https://app.example/cb",
    "http://localhost.example.com/cb",
  ];
  async function cimdPage(redirect: string) {
    const meta = new FakeMetadata();
    meta.serve.set(URL_ID, {
      body: cimdDocument(URL_ID, {
        client_name: "<b>Claude</b>",
        redirect_uris: redirects,
      }),
    });
    const h = await harness({
      origins: ["https://client.example.com"],
      clientMetadata: meta,
      redirects,
    });
    return page(h, { clientId: URL_ID, method: "none", redirect });
  }

  it.each([
    "http://127.0.0.1:33418/cb",
    "http://127.0.0.2/cb",
    "http://[::1]/cb",
    "http://localhost:8080/cb",
  ])(
    "BR-393 v2 shows the client ID, its host, the unverified name and the loopback line for %s",
    async (redirect) => {
      const response = await cimdPage(redirect);
      expect(response.status).toBe(200);
      const body = response.body;
      expect(body).toContain(`<code>${URL_ID}</code>`);
      expect(body).toContain("Client host: client.example.com");
      expect(body).toContain("&lt;b&gt;Claude&lt;/b&gt;");
      expect(body).not.toContain("<b>Claude</b>");
      expect(body).toContain(
        "This name comes from the client's metadata document and is unverified.",
      );
      expect(body).toContain(
        "This client redirects to this computer only (loopback).",
      );
      expect(body.indexOf(URL_ID)).toBeLessThan(body.indexOf("Claude"));
      expect(body.indexOf("Client host:")).toBeLessThan(body.indexOf("Claude"));
    },
  );

  it.each(["https://app.example/cb", "http://localhost.example.com/cb"])(
    "BR-393 v2 omits the loopback line for %s",
    async (redirect) => {
      const response = await cimdPage(redirect);
      expect(response.status).toBe(200);
      expect(response.body).toContain("Client host: client.example.com");
      expect(response.body).not.toContain("(loopback)");
    },
  );

  it("BR-129 v3 a registered client's page carries no BR-393 line", async () => {
    const h = await harness();
    const client = await h.register({ client_name: "Plain" });
    const response = await page(h, client);
    const consentId = h.consentId(response);
    expect(response.body).toContain(
      [
        "<p>Client name: <strong>Plain (self-declared, unverified)</strong></p>",
        "<p>The client name is self-declared and unverified.</p>",
        `<p>Client ID: <code>${client.clientId}</code></p>`,
        `<p>Redirect URI: <code>${client.redirect}</code></p>`,
        `<p>Protected resource: <code>${PUBLIC_URL}</code></p>`,
      ].join(""),
    );
    expect(response.body).toContain(
      `<form method="post" action="${PUBLIC_URL}/oauth/consent?lang=en"><input type="hidden" name="consent" value="${consentId}">`,
    );
    expect(response.body).not.toContain("Client host:");
    expect(response.body).not.toContain("metadata document");
    expect(response.body).not.toContain("(loopback)");
  });
});

// F-031 AC-08: the consent flow in French (BR-129 v4, BR-393 v3, BR-404).
describe("BR-129 v4 BR-393 v3 consent flow in French", () => {
  const FR = TEXTS.fr;

  it("BR-129 v4 a French page posts to the consent route with lang=fr and labels the client in French", async () => {
    const h = await harness();
    const named = await h.register({ client_name: "Plain" });
    const unnamed = await h.register();
    const query = h.authorizeQuery(named, challenge, { lang: "fr" });
    const response = await h.proxy.authorize({ query });
    expect(response.body).toContain(
      `<form method="post" action="${PUBLIC_URL}/oauth/consent?lang=fr"><input type="hidden" name="consent" value="${h.consentId(response)}">`,
    );
    expect(response.body).toContain(
      `<p>${FR.clientNameLabel} <strong>Plain ${FR.selfDeclaredSuffix}</strong></p>`,
    );
    const anonymous = await h.proxy.authorize({
      query: h.authorizeQuery(unnamed, challenge),
      acceptLanguage: "fr-CH, fr;q=0.9",
    });
    expect(anonymous.body).toContain(
      `<p>${FR.clientNameLabel} <strong>${FR.unnamedClient}</strong></p>`,
    );
    expect(anonymous.body).toContain(
      `action="${PUBLIC_URL}/oauth/consent?lang=fr"`,
    );
  });

  it.each([
    ["the form target lang=fr", { query: new URLSearchParams("lang=fr") }],
    ["Accept-Language: fr", { acceptLanguage: "fr" }],
    [
      "lang=fr over Accept-Language: en",
      { query: new URLSearchParams("lang=fr"), acceptLanguage: "en" },
    ],
  ])(
    "BR-129 v4 an unknown consent posted with %s gets the French consent page",
    async (_name, extra) => {
      const h = await harness();
      const refused = await h.proxy.consent({
        form: new URLSearchParams({ consent: "unknown", decision: "approve" }),
        ...extra,
      });
      expect(refused.status).toBe(400);
      expect(refused.body).toContain('<html lang="fr">');
      expect(refused.body).toContain(`<h1>${FR.errorTitle}</h1>`);
      expect(refused.body).toContain(`<p>${FR.error.consent}</p>`);
    },
  );

  it("BR-129 v4 an unknown consent without a language gets the English page", async () => {
    const h = await harness();
    const refused = await h.proxy.consent({
      form: new URLSearchParams({ consent: "unknown", decision: "approve" }),
      query: new URLSearchParams("lang=de"),
    });
    expect(refused.body).toContain('<html lang="en">');
    expect(refused.body).toContain(`<p>${TEXTS.en.error.consent}</p>`);
  });

  it.each([
    ["Accept-Language: fr", "", "fr"],
    ["?lang=fr and no header", "&lang=fr", undefined],
  ])(
    "BR-129 v4 a callback with an unknown state and %s gets the French callback page",
    async (_name, suffix, acceptLanguage) => {
      const h = await harness();
      const refused = await h.proxy.callback({
        query: new URLSearchParams(`code=c&state=unknown${suffix}`),
        ...(acceptLanguage === undefined ? {} : { acceptLanguage }),
      });
      expect(refused.status).toBe(400);
      expect(refused.body).toContain('<html lang="fr">');
      expect(refused.body).toContain(`<p>${FR.error.callback}</p>`);
      expect(refused.body).not.toContain("<nav");
    },
  );

  it("BR-393 v3 a CIMD loopback request with lang=fr shows the French lines", async () => {
    const URL_ID = "https://client.example.com/c.json";
    const redirect = "http://127.0.0.1:33418/cb";
    const meta = new FakeMetadata();
    meta.serve.set(URL_ID, {
      body: cimdDocument(URL_ID, { redirect_uris: [redirect] }),
    });
    const h = await harness({
      origins: ["https://client.example.com"],
      clientMetadata: meta,
      redirects: [redirect],
    });
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(
        { clientId: URL_ID, method: "none", redirect },
        challenge,
        { lang: "fr" },
      ),
    });
    expect(response.status).toBe(200);
    const body = response.body;
    expect(body).toContain(`<p>${FR.clientHostLabel} client.example.com</p>`);
    expect(body).toContain(`<p>${FR.metadataNotice}</p>`);
    expect(body).toContain(`<p>${FR.loopbackLine}</p>`);
    expect(body).not.toContain("Client host:");
    expect(body).not.toContain("(loopback)");
  });
});

// F-032 (#33): a repeated consent POST by the same browser within 10 s is
// answered idempotently (BR-411, BR-129 v5, BR-142 v3).
describe("BR-411 BR-129 v5 BR-142 v3 repeated consent POST", () => {
  afterEach(() => {
    removeStateFiles();
  });

  const DISCOVERY = "/.well-known/openid-configuration";

  interface Replays {
    flows: Array<[string, { created: number }]>;
    replays?: Array<
      [string, { t0: number; decision: string; settled: boolean }]
    >;
  }
  const stateOf = (h: Harness) => proxyStateSnapshot(h.proxy) as Replays;
  const recorded = (h: Harness) =>
    (stateOf(h).replays ?? []).map(([id, record]) => [id, record.settled]);

  interface Pending {
    client: Registered;
    page: ProxyResponse;
    id: string;
    value: string;
    cookie: string;
  }

  async function pending(h: Harness, known?: Registered): Promise<Pending> {
    const client = known ?? (await h.register());
    const response = await page(h, client);
    const value = h.cookieOf(response);
    return {
      client,
      page: response,
      id: h.consentId(response),
      value,
      cookie: `${COOKIE}=${value}`,
    };
  }

  function post(
    h: Harness,
    id: string,
    cookie: string | undefined,
    decision = "approve",
    extra: Array<[string, string]> = [],
  ): Promise<ProxyResponse> {
    return h.proxy.consent({
      form: new URLSearchParams([
        ["consent", id],
        ["decision", decision],
        ...extra,
      ]),
      ...(cookie === undefined ? {} : { cookie }),
    });
  }

  /** Holds every upstream fetch until `release` (or `fail`) is called. */
  function holdDiscovery(h: Harness) {
    const original = h.upstream.fetchJson.bind(h.upstream);
    let settle!: (fail: boolean) => void;
    const held = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    h.upstream.fetchJson = async (url: string) => {
      if (await held) throw new Error("synthetic discovery failure");
      return original(url);
    };
    return {
      release: () => {
        settle(false);
      },
      fail: () => {
        settle(true);
      },
    };
  }

  async function storeHarness(options: HarnessOptions = {}) {
    const clock = options.clock ?? new Clock();
    const path = stateFile();
    const store = openState(path, { clock });
    const h = await harness({ ...options, clock, store });
    return { h, store, path };
  }

  /** BR-299 / BR-304: a write on a closed store latches the proxy. */
  async function latch(h: Harness, store: OAuthStateStore): Promise<void> {
    store.close();
    const refused = await h.proxy.register({
      body: JSON.stringify({
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(refused.status).toBe(503);
  }

  /** A random source that throws once `failing` is set. */
  function breakableRandom() {
    const base = counterRandom();
    const control = { failing: false };
    const random = (size: number) => {
      if (control.failing) throw new Error("synthetic random failure");
      return base(size);
    };
    return { control, random };
  }

  function expectConsentPage(response: ProxyResponse): void {
    expect(response.status).toBe(400);
    expect(header(response, "location")).toBeUndefined();
    expect(response.body).toContain(TEXTS.en.error.consent);
  }

  function expectBusy(response: ProxyResponse): void {
    expect(response.status).toBe(503);
    expect(header(response, "content-type")).toContain("text/html");
    expect(header(response, "location")).toBeUndefined();
  }

  const refusals = (h: Harness) =>
    h.logs.filter((entry) => entry.name === "consent_refused").length;

  it("BR-411 AC-01 a repeated approve replays the upstream redirect", async () => {
    const h = await harness();
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie);
    h.clock.advance(SECOND);
    const logged = h.logs.length;
    const second = await post(h, c.id, c.cookie);
    expect(h.logs).toHaveLength(logged);
    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(header(second, "location")).toBe(header(first, "location"));
    const target = location(second);
    expect(`${target.origin}${target.pathname}`).toBe(`${UPSTREAM}/authorize`);
    expect(header(second, "cache-control")).toBe("no-store");
    expect(headers(second, "set-cookie")).toEqual(headers(first, "set-cookie"));
    expect(headers(second, "set-cookie")).toEqual([
      `${COOKIE}=${c.value}${ATTRIBUTES}`,
    ]);
    expect(second.headers).toEqual(first.headers);
    expect(second.body).toBe("");
    expect(stateOf(h).flows).toHaveLength(1);
    expect(h.upstream.count("get", DISCOVERY)).toBe(1);
    const flow = { page: c.page, cookie: c.cookie, upstreamRedirect: second };
    const done = await h.callback(flow);
    expect(done.status).toBe(302);
    expect(location(done).searchParams.get("code")).toBeTruthy();
    const again = await h.callback(flow);
    expect(again.status).toBe(400);
    expect(header(again, "location")).toBeUndefined();
  });

  async function sharedApproval(): Promise<void> {
    const h = await harness();
    const c = await pending(h);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    const second = post(h, c.id, c.cookie);
    hold.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(302);
    expect(b.status).toBe(302);
    expect(header(b, "location")).toBe(header(a, "location"));
    expect(b.headers).toEqual(a.headers);
    expect(h.upstream.count("get", DISCOVERY)).toBe(1);
    expect(stateOf(h).flows).toHaveLength(1);
  }

  async function sharedFailure(): Promise<void> {
    const h = await harness();
    const c = await pending(h);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    const second = post(h, c.id, c.cookie);
    hold.fail();
    const a = await first;
    expect(a.status).toBe(302);
    expect(location(a).searchParams.get("error")).toBe(
      "temporarily_unavailable",
    );
    expectConsentPage(await second);
    expect(stateOf(h).flows).toEqual([]);
  }

  async function sharedException(): Promise<void> {
    const { control, random } = breakableRandom();
    const h = await harness({ random });
    const c = await pending(h);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    const second = post(h, c.id, c.cookie);
    control.failing = true;
    hold.release();
    await expect(first).rejects.toThrow("synthetic random failure");
    expectConsentPage(await second);
  }

  async function sharedLatch(): Promise<void> {
    const { h, store } = await storeHarness();
    const c = await pending(h);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    const second = post(h, c.id, c.cookie);
    await latch(h, store);
    hold.release();
    expectBusy(await first);
    expectBusy(await second);
  }

  it("BR-411 AC-02 a repeat during discovery shares the first outcome", async () => {
    await sharedApproval();
    await sharedFailure();
    await sharedException();
    await sharedLatch();
  });

  it("BR-411 AC-03 a repeated deny replays the client redirect", async () => {
    const h = await harness();
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie, "deny");
    h.clock.advance(SECOND);
    const second = await post(h, c.id, c.cookie, "deny");
    for (const response of [first, second]) {
      expect(response.status).toBe(302);
      const target = location(response);
      expect(target.searchParams.get("error")).toBe("access_denied");
      expect(target.searchParams.get("state")).toBe("client-state");
      expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
      expect(headers(response, "set-cookie")).toEqual([]);
    }
    expect(header(second, "location")).toBe(header(first, "location"));
    expect(second.headers).toEqual(first.headers);
    expect(refusals(h)).toBe(1);
    expect(h.upstream.calls).toEqual([]);
  });

  it("BR-411 AC-04 the window is 10 seconds from t0", async () => {
    const h = await harness();
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie);
    expect(first.status).toBe(302);
    h.clock.advance(6 * SECOND);
    const six = await post(h, c.id, c.cookie);
    h.clock.advance(3 * SECOND + 999);
    const almost = await post(h, c.id, c.cookie);
    h.clock.advance(1);
    const ten = await post(h, c.id, c.cookie);
    for (const replay of [six, almost]) {
      expect(replay.status).toBe(302);
      expect(header(replay, "location")).toBe(header(first, "location"));
    }
    expectConsentPage(ten);
  });

  it.each<
    [
      string,
      (c: Pending) => {
        cookie?: string;
        decision?: string;
        extra?: Array<[string, string]>;
      },
    ]
  >([
    [
      "a repeat with another well-formed cookie",
      () => ({ cookie: `${COOKIE}=${"A".repeat(43)}` }),
    ],
    ["a repeat without a cookie", () => ({})],
    [
      "a repeat with two binding cookies",
      (c) => ({ cookie: `${c.cookie}; ${c.cookie}` }),
    ],
    [
      "a repeat with decision=deny",
      (c) => ({ cookie: c.cookie, decision: "deny" }),
    ],
    [
      "a repeat with a repeated consent field",
      (c) => ({ cookie: c.cookie, extra: [["consent", c.id]] }),
    ],
  ])("BR-411 AC-05 %s is not replayed", async (_name, make) => {
    const h = await harness();
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie);
    expect(first.status).toBe(302);
    h.clock.advance(SECOND);
    const before = refusals(h);
    const variant = make(c);
    const refused = await post(
      h,
      c.id,
      variant.cookie,
      variant.decision ?? "approve",
      variant.extra ?? [],
    );
    expectConsentPage(refused);
    expect(refusals(h)).toBe(before + 1);
    const replay = await post(h, c.id, c.cookie);
    expect(replay.status).toBe(302);
    expect(header(replay, "location")).toBe(header(first, "location"));
  });

  async function wrongFirst(
    cookie: (c: Pending) => string,
    decision: string,
  ): Promise<{ h: Harness; c: Pending; status: number }> {
    const h = await harness();
    const c = await pending(h);
    expectConsentPage(await post(h, c.id, cookie(c), decision));
    return { h, c, status: 400 };
  }

  async function downstreamFailure(): Promise<{
    h: Harness;
    c: Pending;
    status: number;
  }> {
    const h = await harness();
    h.upstream.metadataStatus = 500;
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie);
    expect(location(first).searchParams.get("error")).toBe(
      "temporarily_unavailable",
    );
    return { h, c, status: 400 };
  }

  async function fullFlows(): Promise<{
    h: Harness;
    c: Pending;
    status: number;
  }> {
    const h = await harness();
    const client = await h.register();
    for (let index = 0; index < STORE_LIMIT; index += 1)
      await h.approve(client, "v".repeat(43));
    expect(stateOf(h).flows).toHaveLength(STORE_LIMIT);
    const c = await pending(h, client);
    const first = await post(h, c.id, c.cookie);
    expect(location(first).searchParams.get("error")).toBe(
      "temporarily_unavailable",
    );
    return { h, c, status: 400 };
  }

  async function busyFirst(): Promise<{
    h: Harness;
    c: Pending;
    status: number;
  }> {
    const { h, store } = await storeHarness();
    const c = await pending(h);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    await latch(h, store);
    hold.release();
    expectBusy(await first);
    return { h, c, status: 503 };
  }

  async function throwingFirst(): Promise<{
    h: Harness;
    c: Pending;
    status: number;
  }> {
    const { control, random } = breakableRandom();
    const h = await harness({ random });
    const c = await pending(h);
    control.failing = true;
    await expect(post(h, c.id, c.cookie)).rejects.toThrow(
      "synthetic random failure",
    );
    control.failing = false;
    return { h, c, status: 400 };
  }

  it.each<[string, () => Promise<{ h: Harness; c: Pending; status: number }>]>([
    [
      "an unknown identifier",
      async () => {
        const h = await harness();
        const c = await pending(h);
        return { h, c: { ...c, id: "unknown-consent" }, status: 400 };
      },
    ],
    [
      "an identifier first presented with a wrong cookie",
      () => wrongFirst(() => `${COOKIE}=${"A".repeat(43)}`, "approve"),
    ],
    [
      "an identifier first presented with decision=maybe",
      () => wrongFirst((c) => c.cookie, "maybe"),
    ],
    ["an approval that ended with the upstream down", downstreamFailure],
    ["an approval that ended with a full flow store", fullFlows],
    ["an approval that ended in the busy page", busyFirst],
    ["an approval that ended in an exception", throwingFirst],
  ])(
    "BR-411 AC-05 %s is not replayed",
    async (_name, setup) => {
      const { h, c, status } = await setup();
      h.clock.advance(SECOND);
      const repeat = await post(h, c.id, c.cookie);
      expect(repeat.status).toBe(status);
      expect(header(repeat, "location")).toBeUndefined();
      if (status === 400) expectConsentPage(repeat);
      else expectBusy(repeat);
    },
    60_000,
  );

  async function boundedRecords(): Promise<void> {
    const h = await harness();
    const client = await h.register();
    const oldest = await pending(h, client);
    expect((await post(h, oldest.id, oldest.cookie, "deny")).status).toBe(302);
    let newest = oldest;
    for (let index = 0; index < STORE_LIMIT; index += 1) {
      newest = await pending(h, client);
      expect((await post(h, newest.id, newest.cookie, "deny")).status).toBe(
        302,
      );
    }
    expect(stateOf(h).replays).toHaveLength(STORE_LIMIT);
    expectConsentPage(await post(h, oldest.id, oldest.cookie, "deny"));
    expect((await post(h, newest.id, newest.cookie, "deny")).status).toBe(302);
  }

  async function purgedRecords(): Promise<void> {
    const h = await harness();
    const client = await h.register();
    for (let index = 0; index < 3; index += 1) {
      const c = await pending(h, client);
      expect((await post(h, c.id, c.cookie, "deny")).status).toBe(302);
    }
    const c = await pending(h, client);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    expect(recorded(h)).toHaveLength(4);
    h.clock.advance(10 * SECOND);
    await page(h, client);
    expect(recorded(h)).toEqual([[c.id, false]]);
    hold.release();
    expect((await first).status).toBe(302);
  }

  async function neverStored(): Promise<void> {
    const { h, store, path } = await storeHarness();
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie);
    h.clock.advance(SECOND);
    const second = await post(h, c.id, c.cookie);
    expect(second.status).toBe(302);
    expect(header(second, "location")).toBe(header(first, "location"));
    const state = location(first).searchParams.get("state") ?? "";
    store.close();
    const directory = dirname(path);
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name)).toString("latin1");
      for (const secret of [c.id, c.value, state])
        expect(bytes, name).not.toContain(secret);
    }
    const reopened = openState(path, { clock: h.clock });
    const fresh = await harness({
      clock: h.clock,
      store: reopened,
      pem: h.pem,
    });
    expectConsentPage(await post(fresh, c.id, c.cookie));
    reopened.close();
  }

  it(
    "BR-411 AC-06 the replay records are bounded, purged and never stored",
    { timeout: 60_000 },
    async () => {
      await boundedRecords();
      await purgedRecords();
      await neverStored();
    },
  );

  it("BR-411 AC-09 a replay moves no lifetime", async () => {
    const h = await harness();
    const c = await pending(h);
    const first = await post(h, c.id, c.cookie);
    expect(first.status).toBe(302);
    const created = h.clock.ms;
    expect(stateOf(h).flows.map(([, flow]) => flow.created)).toEqual([created]);
    h.clock.advance(SECOND);
    expect((await post(h, c.id, c.cookie)).status).toBe(302);
    expect(stateOf(h).flows.map(([, flow]) => flow.created)).toEqual([created]);
    h.clock.advance(599 * SECOND - 1);
    await page(h, c.client);
    expect(stateOf(h).flows).toHaveLength(1);
    h.clock.advance(1);
    await page(h, c.client);
    expect(stateOf(h).flows).toEqual([]);
  });

  it("BR-411 AC-13 the window is checked on arrival", async () => {
    const h = await harness();
    const c = await pending(h);
    const hold = holdDiscovery(h);
    const first = post(h, c.id, c.cookie);
    h.clock.advance(SECOND);
    const second = post(h, c.id, c.cookie);
    h.clock.advance(9 * SECOND);
    await page(h, c.client);
    expect(recorded(h)).toEqual([[c.id, false]]);
    hold.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(302);
    expect(b.status).toBe(302);
    expect(header(b, "location")).toBe(header(a, "location"));
    expect(stateOf(h).flows).toHaveLength(1);
    expectConsentPage(await post(h, c.id, c.cookie));
  });
});

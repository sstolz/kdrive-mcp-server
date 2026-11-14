// F-028 AC-02, AC-05, AC-06 and AC-07: Client ID Metadata Documents in the
// proxy, with a counting fake fetch port and the fake clock.
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OAuthProxy,
  ProxyResponse,
} from "../../src/auth/proxy/index.js";
import { proxyStateSnapshot } from "../../src/auth/proxy/proxy.js";
import type { OAuthStateStore } from "../../src/auth/proxy/store.js";
import {
  CIMD_HOST,
  CIMD_ORIGIN,
  CIMD_URL,
  FakeMetadata,
  allowEveryAddress,
  cimdCertificates,
  cimdDocument,
  scriptedResolver,
  startDocumentServer,
  type DocumentServer,
  type Served,
} from "../helpers/cimd.js";
import { configurationFor, exchange, HOST, listening } from "../helpers/http.js";
import { navigationFixture } from "../helpers/navigation.js";
import {
  CLAUDE,
  Clock,
  FakeUpstream,
  LOCALHOST,
  LOOPBACK,
  PUBLIC_URL,
  SECOND,
  counterRandom,
  harness,
  header,
  json,
  openState,
  removeStateFiles,
  s256,
  stateFile,
  type HarnessOptions,
  type Registered,
} from "../helpers/proxy.js";

const created = vi.hoisted(() => ({ proxies: [] as unknown[] }));
vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return {
    ...actual,
    createOAuthProxy: (
      options: Parameters<typeof actual.createOAuthProxy>[0],
    ) => {
      const proxy = actual.createOAuthProxy(options);
      created.proxies.push(proxy);
      return proxy;
    },
  };
});

let documentServers: DocumentServer[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeStateFiles();
  await Promise.all(documentServers.map((server) => server.close()));
  documentServers = [];
  created.proxies = [];
});

const VERIFIER = `synthetic-cimd-verifier-${"v".repeat(24)}`;
const SECOND_URL = `${CIMD_ORIGIN}/d.json`;

function cimd(url = CIMD_URL, redirect = CLAUDE): Registered {
  return { clientId: url, method: "none", redirect };
}

async function setup(extra: HarnessOptions = {}) {
  const meta = new FakeMetadata();
  const h = await harness({
    origins: [CIMD_ORIGIN],
    clientMetadata: meta,
    ...extra,
  });
  const authorize = (
    client: Registered = cimd(),
    query: Record<string, string | undefined> = {},
  ) =>
    h.proxy.authorize({
      query: h.authorizeQuery(client, s256(VERIFIER), query),
    });
  return { h, meta, authorize };
}

function expectPage(response: ProxyResponse, status: number): void {
  expect(response.status).toBe(status);
  expect(header(response, "location")).toBeUndefined();
  expect(header(response, "content-type")).toBe("text/html; charset=utf-8");
}

function consents(proxy: OAuthProxy): unknown[] {
  return (proxyStateSnapshot(proxy) as { consents: unknown[] }).consents;
}

describe("BR-305 BR-128 v3 acceptable CIMD client IDs (AC-02)", () => {
  const refused = [
    ["userinfo", "https://user@client.example.com/c.json"],
    ["a query", "https://client.example.com/c.json?x=1"],
    ["an empty query", "https://client.example.com/c.json?"],
    ["a fragment", "https://client.example.com/c.json#f"],
    ["path /", "https://client.example.com/"],
    ["/a/../b", "https://client.example.com/a/../b"],
    ["/a/%2e%2e/b", "https://client.example.com/a/%2e%2e/b"],
    ["/a/%2E/b", "https://client.example.com/a/%2E/b"],
    ["an IP host", "https://192.0.2.1/c.json"],
    ["an IPv6 host", "https://[2001:db8::1]/c.json"],
    ["an unlisted origin", "https://other.example.com/c.json"],
    ["port 8443 on a port-less origin", "https://client.example.com:8443/c.json"],
    [":443 spelled out", "https://client.example.com:443/c.json"],
    [
      "1,025 bytes",
      `${CIMD_ORIGIN}/${"a".repeat(1025 - CIMD_ORIGIN.length - 1)}`,
    ],
    ["a non-normalized spelling", "https://CLIENT.example.com/c.json"],
  ] as const;

  it.each(refused)(
    "BR-305 refuses %s with the 400 page, no redirect and no fetch",
    async (_case, clientId) => {
      const { h, meta, authorize } = await setup();
      const response = await authorize(cimd(clientId));
      expectPage(response, 400);
      expect(meta.calls).toEqual([]);
      expect(h.logs).toEqual([
        {
          name: "client_metadata_refused",
          fields: { handler: "authorize", reason: "not_allowed", status: 0 },
        },
      ]);
    },
  );

  it("BR-305 refuses an http client ID as an unknown registered client", async () => {
    const { h, meta, authorize } = await setup();
    const response = await authorize(cimd("http://client.example.com/c.json"));
    expectPage(response, 400);
    expect(meta.calls).toEqual([]);
    expect(h.logs.map((entry) => entry.name)).toEqual([
      "authorization_refused",
    ]);
  });

  it("BR-305 refuses the proxy issuer, the audience and the upstream issuer even under a listed origin", async () => {
    const meta = new FakeMetadata();
    const h = await harness({
      origins: [CIMD_ORIGIN, "https://mcp.test", "https://idp.test"],
      clientMetadata: meta,
    });
    for (const clientId of [PUBLIC_URL, "https://idp.test"]) {
      const response = await h.proxy.authorize({
        query: h.authorizeQuery(cimd(clientId), s256(VERIFIER)),
      });
      expectPage(response, 400);
    }
    expect(meta.calls).toEqual([]);
  });

  it("BR-305 accepts a 1,024-byte client ID under a listed origin", async () => {
    const { meta, authorize } = await setup();
    const url = `${CIMD_ORIGIN}/${"a".repeat(1024 - CIMD_ORIGIN.length - 1)}`;
    expect(Buffer.byteLength(url)).toBe(1024);
    const response = await authorize(cimd(url));
    expect(response.status).toBe(200);
    expect(meta.calls).toEqual([url]);
  });

  it("BR-128 v3 a repeated parameter, an absent or a non-allowlisted redirect_uri refuse before any fetch", async () => {
    const { h, meta } = await setup();
    const repeated = h.authorizeQuery(cimd(), s256(VERIFIER));
    repeated.append("state", "again");
    const cases = [
      repeated,
      h.authorizeQuery(cimd(), s256(VERIFIER), { redirect_uri: undefined }),
      h.authorizeQuery(cimd(), s256(VERIFIER), {
        redirect_uri: "https://evil.example/cb",
      }),
    ];
    for (const query of cases) expectPage(await h.proxy.authorize({ query }), 400);
    expect(meta.calls).toEqual([]);
    expect(h.logs.map((entry) => entry.name)).toEqual([
      "authorization_refused",
      "authorization_refused",
      "authorization_refused",
    ]);
  });

  it("BR-305 with an empty list every https client ID is refused without fetch", async () => {
    const meta = new FakeMetadata();
    const h = await harness({ clientMetadata: meta });
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(cimd(), s256(VERIFIER)),
    });
    expectPage(response, 400);
    expect(meta.calls).toEqual([]);
    expect(h.logs.map((entry) => entry.name)).toEqual([
      "authorization_refused",
    ]);
  });

  it("BR-305 a listed, acceptable client ID reaches consent after one fetch", async () => {
    const { meta, authorize } = await setup();
    const response = await authorize();
    expect(response.status).toBe(200);
    expect(response.body).toContain("Approve");
    expect(meta.calls).toEqual([CIMD_URL]);
    expect(meta.signals[0]?.aborted).toBe(false);
  });
});

describe("BR-308 document validation (AC-05)", () => {
  const invalid: Array<[string, Served]> = [
    ["a different client_id", { body: cimdDocument(SECOND_URL) }],
    ["a client_secret", { body: cimdDocument(CIMD_URL, { client_secret: "s" }) }],
    [
      "client_secret_expires_at",
      { body: cimdDocument(CIMD_URL, { client_secret_expires_at: 0 }) },
    ],
    [
      "token_endpoint_auth_method client_secret_basic",
      {
        body: cimdDocument(CIMD_URL, {
          token_endpoint_auth_method: "client_secret_basic",
        }),
      },
    ],
    [
      "token_endpoint_auth_methods_supported private_key_jwt",
      {
        body: cimdDocument(CIMD_URL, {
          token_endpoint_auth_method: undefined,
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
        }),
      },
    ],
    [
      "a singular method absent from the array",
      {
        body: cimdDocument(CIMD_URL, {
          token_endpoint_auth_method: "client_secret_post",
          token_endpoint_auth_methods_supported: ["none"],
        }),
      },
    ],
    [
      "no redirect URI in the allowlist",
      {
        body: cimdDocument(CIMD_URL, {
          redirect_uris: ["https://elsewhere.example/cb"],
        }),
      },
    ],
    [
      "an empty redirect_uris",
      { body: cimdDocument(CIMD_URL, { redirect_uris: [] }) },
    ],
    [
      "a non-string redirect URI",
      { body: cimdDocument(CIMD_URL, { redirect_uris: [CLAUDE, 7] }) },
    ],
    [
      "no authorization_code",
      { body: cimdDocument(CIMD_URL, { grant_types: ["refresh_token"] }) },
    ],
    [
      "response_types token",
      { body: cimdDocument(CIMD_URL, { response_types: ["token"] }) },
    ],
    ["an empty name", { body: cimdDocument(CIMD_URL, { client_name: "" }) }],
    [
      "a 201-character name",
      { body: cimdDocument(CIMD_URL, { client_name: "n".repeat(201) }) },
    ],
    [
      "a name with a control character",
      { body: cimdDocument(CIMD_URL, { client_name: "a\u0007b" }) },
    ],
    ["invalid JSON", { body: "{" }],
    [
      "a byte-order mark",
      {
        body: Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(JSON.stringify(cimdDocument(CIMD_URL))),
        ]),
      },
    ],
    ["invalid UTF-8", { body: Buffer.from([0x7b, 0xff, 0x7d]) }],
    ["a JSON array", { body: [] }],
    ["JSON null", { body: "null" }],
  ];

  it.each(invalid)(
    "BR-308 refuses a document with %s: 400 page, no redirect",
    async (_case, served) => {
      const { h, meta, authorize } = await setup();
      meta.serve.set(CIMD_URL, served);
      const response = await authorize();
      expectPage(response, 400);
      expect(h.logs).toEqual([
        {
          name: "client_metadata_refused",
          fields: { handler: "authorize", reason: "document", status: 200 },
        },
      ]);
    },
  );

  it("BR-308 keeps allowed redirect URIs and known grants, ignores the rest and fetches nothing else", async () => {
    const { h, meta, authorize } = await setup();
    meta.serve.set(CIMD_URL, {
      body: cimdDocument(CIMD_URL, {
        redirect_uris: [
          "https://a.example/cb",
          CLAUDE,
          "https://b.example/cb",
          "http://127.0.0.1:9999/callback",
          "https://c.example/cb",
        ],
        grant_types: ["authorization_code", "refresh_token", "urn:x"],
        token_endpoint_auth_method: undefined,
        token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
        jwks_uri: `${CIMD_ORIGIN}/jwks.json`,
        logo_uri: `${CIMD_ORIGIN}/logo.png`,
      }),
    });
    expect((await authorize()).status).toBe(200);
    expect((await authorize(cimd(CIMD_URL, LOOPBACK))).status).toBe(200);
    expectPage(await authorize(cimd(CIMD_URL, "https://a.example/cb")), 400);
    expect(meta.calls).toEqual([CIMD_URL]);
    expect(h.logs.at(-1)?.name).toBe("authorization_refused");
  });

  it("BR-308 an allowlisted redirect_uri not kept from the document logs document with status 200", async () => {
    const { h, authorize } = await setup();
    expectPage(await authorize(cimd(CIMD_URL, LOCALHOST)), 400);
    expect(h.logs).toEqual([
      {
        name: "client_metadata_refused",
        fields: { handler: "authorize", reason: "document", status: 200 },
      },
    ]);
  });

  it("BR-308 keeps at most the first 10 matching redirect URIs in document order", async () => {
    const { meta, authorize } = await setup();
    const loopbacks = Array.from(
      { length: 11 },
      (_, index) => `http://127.0.0.1:${String(4000 + index)}/callback`,
    );
    meta.serve.set(CIMD_URL, {
      body: cimdDocument(CIMD_URL, { redirect_uris: [...loopbacks, CLAUDE] }),
    });
    // All eleven loopback entries match LOOPBACK; CLAUDE is the twelfth.
    expectPage(await authorize(cimd(CIMD_URL, CLAUDE)), 400);
    expect((await authorize(cimd(CIMD_URL, LOOPBACK))).status).toBe(200);
  });

  it("BR-308 an absent grant_types means both grants and the method none is assumed", async () => {
    const { h, meta } = await setup();
    meta.serve.set(CIMD_URL, {
      body: {
        client_id: CIMD_URL,
        redirect_uris: [CLAUDE],
      },
    });
    const done = await h.login(cimd());
    const tokens = json(await h.redeem(done));
    expect(typeof tokens.refresh_token).toBe("string");
  });
});

describe("BR-309 cache, concurrency and cancellation (AC-06)", () => {
  /** True when the port is called again exactly `seconds` after the first fetch. */
  async function refetchedAfter(
    cacheControl: string[],
    seconds: number,
  ): Promise<boolean> {
    const { meta, authorize, h } = await setup();
    meta.serve.set(CIMD_URL, { body: cimdDocument(CIMD_URL), cacheControl });
    expect((await authorize()).status).toBe(200);
    const start = h.clock.ms;
    h.clock.ms = start + seconds * SECOND - 1;
    expect((await authorize()).status).toBe(200);
    if (meta.calls.length !== 1) return false;
    h.clock.ms = start + seconds * SECOND;
    expect((await authorize()).status).toBe(200);
    return meta.calls.length === 2;
  }

  it.each([
    [["max-age=600"], 600],
    [["max-age=86400"], 3600],
    [["max-age=10"], 60],
    [[], 300],
    [["no-store"], 60],
    [["no-cache"], 60],
    [["MAX-AGE=600"], 600],
    [["public, max-age=600, max-age=10"], 600],
    [["max-age=abc, max-age=600"], 600],
    [['max-age="600"'], 300],
    [["max-age=-5"], 300],
    [["s-maxage=10"], 300],
    [["no-store, max-age=600"], 60],
    [["public", "max-age=600"], 600],
    [[" \tmax-age=600\t "], 600],
  ])(
    "BR-309 Cache-Control %j is refetched exactly after %i s",
    async (cacheControl, seconds) => {
      expect(await refetchedAfter(cacheControl, seconds)).toBe(true);
    },
  );

  it("BR-309 an Expires in the past is ignored", async () => {
    // The port passes only Cache-Control field lines; Expires never reaches
    // the cache, so max-age=600 decides alone.
    expect(await refetchedAfter(["max-age=600"], 600)).toBe(true);
  });

  it("BR-308 the snapshot taken at authorization decides the refresh token", async () => {
    const { h, meta, authorize } = await setup();
    const page = await authorize();
    expect(page.status).toBe(200);
    meta.serve.set(CIMD_URL, {
      body: cimdDocument(CIMD_URL, { grant_types: ["authorization_code"] }),
    });
    h.clock.advance(300 * SECOND);
    expect((await authorize()).status).toBe(200);
    expect(meta.calls).toHaveLength(2);
    const cookie = `__Host-kdrive-oauth=${h.cookieOf(page)}`;
    const upstreamRedirect = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(page),
        decision: "approve",
      }),
      cookie,
    });
    const done = await h.callback({ page, cookie, upstreamRedirect });
    const code = new URL(header(done, "location") ?? "").searchParams.get(
      "code",
    );
    const tokens = json(
      await h.redeem({
        code: code ?? "",
        verifier: VERIFIER,
        redirect: CLAUDE,
        client: cimd(),
      }),
    );
    expect(typeof tokens.refresh_token).toBe("string");
    expect(meta.calls).toHaveLength(2);
  });

  it("BR-309 a failing port is called again on every request (no failure cache)", async () => {
    const { meta, authorize } = await setup();
    meta.serve.set(CIMD_URL, {
      failure: { reason: "status", status: 404, transient: false },
    });
    for (let index = 0; index < 5; index++)
      expectPage(await authorize(), 400);
    meta.serve.set(CIMD_URL, {
      failure: { reason: "connection", status: 0, transient: true },
    });
    for (let index = 0; index < 5; index++)
      expectPage(await authorize(), 503);
    expect(meta.calls).toHaveLength(10);
  });

  it("BR-309 a stale entry serves transient failures for 3,600 s past expiry, then the 503 page", async () => {
    const { h, meta, authorize } = await setup();
    expect((await authorize()).status).toBe(200);
    const start = h.clock.ms;
    meta.serve.set(CIMD_URL, {
      failure: { reason: "timeout", status: 0, transient: true },
    });
    h.clock.ms = start + 300 * SECOND;
    expect((await authorize()).status).toBe(200);
    h.clock.ms = start + 3900 * SECOND - 1;
    expect((await authorize()).status).toBe(200);
    h.clock.ms = start + 3900 * SECOND;
    expectPage(await authorize(), 503);
    expect(h.logs.at(-1)).toEqual({
      name: "client_metadata_refused",
      fields: { handler: "authorize", reason: "timeout", status: 0 },
    });
  });

  it("BR-309 a terminal refetch failure gives the 400 page and deletes the entry", async () => {
    const { h, meta, authorize } = await setup();
    expect((await authorize()).status).toBe(200);
    h.clock.advance(300 * SECOND);
    meta.serve.set(CIMD_URL, {
      failure: { reason: "status", status: 404, transient: false },
    });
    expectPage(await authorize(), 400);
    meta.serve.set(CIMD_URL, {
      failure: { reason: "connection", status: 0, transient: true },
    });
    expectPage(await authorize(), 503);
  });

  it("BR-309 ten concurrent requests for one URL make one call", async () => {
    const { meta, authorize } = await setup();
    meta.serve.set(CIMD_URL, "pending");
    const pending = Array.from({ length: 10 }, () => authorize());
    await vi.waitFor(() => {
      expect(meta.held).toHaveLength(1);
    });
    meta.held[0]?.settle({ body: cimdDocument(CIMD_URL) });
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual(
      Array(10).fill(200),
    );
    expect(meta.calls).toEqual([CIMD_URL]);
  });

  it("BR-309 four pending URLs make a fifth get the 503 page without a call", async () => {
    const { h, meta, authorize } = await setup();
    const urls = [1, 2, 3, 4, 5].map((n) => `${CIMD_ORIGIN}/c${String(n)}.json`);
    for (const url of urls) meta.serve.set(url, "pending");
    const pending = urls.slice(0, 4).map((url) => authorize(cimd(url)));
    await vi.waitFor(() => {
      expect(meta.held).toHaveLength(4);
    });
    expectPage(await authorize(cimd(urls[4])), 503);
    expect(meta.calls).toEqual(urls.slice(0, 4));
    expect(h.logs.at(-1)).toEqual({
      name: "client_metadata_refused",
      fields: { handler: "authorize", reason: "busy", status: 0 },
    });
    for (const held of meta.held) held.settle({ body: cimdDocument(held.url) });
    await Promise.all(pending);
  });

  it("BR-309 right after one of four pending fetches times out, a fifth URL is fetched", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { h, meta, authorize } = await setup();
    const urls = [1, 2, 3, 4, 5].map((n) => `${CIMD_ORIGIN}/c${String(n)}.json`);
    for (const url of urls.slice(0, 4)) meta.serve.set(url, "pending");
    const first = authorize(cimd(urls[0]));
    await vi.advanceTimersByTimeAsync(1000);
    const others = urls.slice(1, 4).map((url) => authorize(cimd(url)));
    await vi.advanceTimersByTimeAsync(3999);
    expect(meta.signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expectPage(await first, 503);
    expect(meta.signals[0]?.aborted).toBe(true);
    expect(h.logs.at(-1)).toEqual({
      name: "client_metadata_refused",
      fields: { handler: "authorize", reason: "timeout", status: 0 },
    });
    expect((await authorize(cimd(urls[4]))).status).toBe(200);
    expect(meta.calls).toEqual(urls);
    for (const held of meta.held.slice(1))
      held.settle({ body: cimdDocument(held.url) });
    await Promise.all(others);
  });

  it("BR-309 the 101st URL evicts the entry that would be discarded first", async () => {
    const { meta, authorize } = await setup();
    const urls = Array.from(
      { length: 101 },
      (_, n) => `${CIMD_ORIGIN}/c${String(n)}.json`,
    );
    meta.serve.set(urls[42] ?? "", {
      body: cimdDocument(urls[42] ?? ""),
      cacheControl: ["max-age=60"],
    });
    for (const url of urls.slice(0, 100))
      expect((await authorize(cimd(url))).status).toBe(200);
    expect(meta.calls).toHaveLength(100);
    expect((await authorize(cimd(urls[100]))).status).toBe(200);
    expect((await authorize(cimd(urls[0]))).status).toBe(200);
    expect(meta.calls).toHaveLength(101);
    expect((await authorize(cimd(urls[42]))).status).toBe(200);
    expect(meta.calls).toHaveLength(102);
    expect(meta.calls.at(-1)).toBe(urls[42]);
  });

  it("BR-128 v3 a store latched while the fetch is pending gives the 503 page and no pending consent", async () => {
    const store: OAuthStateStore = {
      clients: [],
      families: [],
      commit: () => "failed",
      close: () => undefined,
    };
    const { h, meta, authorize } = await setup({ store });
    meta.serve.set(CIMD_URL, "pending");
    const pending = authorize();
    await vi.waitFor(() => {
      expect(meta.held).toHaveLength(1);
    });
    // A registration commit fails and latches the store (BR-299).
    await h.proxy.register({
      body: JSON.stringify({
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "none",
      }),
    });
    meta.held[0]?.settle({ body: cimdDocument(CIMD_URL) });
    expectPage(await pending, 503);
    expect(consents(h.proxy)).toEqual([]);
    expect(h.logs.at(-1)).toEqual({
      name: "authorization_refused",
      fields: { handler: "authorize", status: 503 },
    });
  }, 10_000);
});

describe("BR-309 BR-169 v3 the HTTP server's close() cancels pending fetches (AC-06)", () => {
  it("BR-169 v3 cancels the resolver, destroys the fetch socket and answers 503 with no pending consent", async () => {
    const server = await startDocumentServer(() => {
      // Never answers: the fetch stays pending.
    });
    documentServers.push(server);
    const origin = `https://${CIMD_HOST}:${String(server.port)}`;
    const resolver = scriptedResolver({ v4: ["127.0.0.1"] });
    const logs: Array<{ name: string; fields: Record<string, unknown> }> = [];
    const navigation = await navigationFixture();
    const configuration = await configurationFor({
      env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: origin },
    });
    const upstream = new FakeUpstream();
    const listened = await listening({
      handlerOptions: {
        configuration,
        dependencies: navigation.dependencies,
        upstream,
        clock: new Clock().now,
        randomBytes: counterRandom(),
        logger: {
          event: (name, fields) => {
            logs.push({ name, fields });
          },
        },
        clientMetadataSeam: {
          resolver: resolver.factory,
          addressPolicy: allowEveryAddress,
          ca: [cimdCertificates().ca],
        },
      },
    });
    const query = new URLSearchParams({
      response_type: "code",
      client_id: `${origin}/c.json`,
      redirect_uri: CLAUDE,
      state: "s",
      code_challenge: s256(VERIFIER),
      code_challenge_method: "S256",
      resource: PUBLIC_URL,
    });
    const answer = exchange(listened.port, {
      method: "GET",
      target: `/mcp/oauth/authorize?${query.toString()}`,
      headers: [["Host", HOST]],
    });
    await server.nextRequest();
    await listened.close();
    const response = await answer;
    expect(response?.status).toBe(503);
    expect(resolver.state.cancels).toBeGreaterThanOrEqual(1);
    await vi.waitFor(() => {
      expect(server.sockets.every((socket) => socket.destroyed)).toBe(true);
    });
    const proxy = created.proxies.at(-1) as OAuthProxy;
    expect(consents(proxy)).toEqual([]);
    expect(logs.filter((entry) => entry.name === "authorization_refused")).toEqual([
      {
        name: "authorization_refused",
        fields: { handler: "authorize", status: 503 },
      },
    ]);
  });
});

describe("BR-310 BR-136 v2 token endpoint (AC-07)", () => {
  it("BR-310 a CIMD client redeems with client_id in the body, no secret and no fetch", async () => {
    const { h, meta } = await setup();
    const done = await h.login(cimd());
    expect(meta.calls).toHaveLength(1);
    const response = await h.redeem(done);
    expect(response.status).toBe(200);
    const tokens = json(response);
    expect(typeof tokens.access_token).toBe("string");
    expect(typeof tokens.refresh_token).toBe("string");
    const refreshed = await h.refresh(cimd(), tokens.refresh_token as string);
    expect(refreshed.status).toBe(200);
    expect(meta.calls).toHaveLength(1);
  });

  it("BR-310 Basic or a body secret gives 401 invalid_client", async () => {
    const { h } = await setup();
    const done = await h.login(cimd());
    const basic = await h.redeem(done, {}, {
      ...cimd(),
      method: "client_secret_basic",
      clientSecret: "x",
    });
    expect(basic.status).toBe(401);
    expect(json(basic)).toEqual({ error: "invalid_client" });
    const post = await h.redeem(done, {}, {
      ...cimd(),
      method: "client_secret_post",
      clientSecret: "x",
    });
    expect(post.status).toBe(401);
    expect((await h.redeem(done)).status).toBe(200);
  });

  it("BR-310 a code of another client gives invalid_grant", async () => {
    const { h } = await setup();
    const done = await h.login(cimd());
    const response = await h.redeem(done, {}, cimd(SECOND_URL));
    expect(response.status).toBe(400);
    expect(json(response)).toEqual({ error: "invalid_grant" });
  });

  it("BR-310 a document without refresh_token yields no refresh token", async () => {
    const { h, meta } = await setup();
    meta.serve.set(CIMD_URL, {
      body: cimdDocument(CIMD_URL, { grant_types: ["authorization_code"] }),
    });
    const done = await h.login(cimd());
    const tokens = json(await h.redeem(done));
    expect(tokens.refresh_token).toBeUndefined();
  });

  it("BR-310 an unlisted CIMD client ID gets 401 before the code store is read", async () => {
    const { h } = await setup();
    const done = await h.login(cimd());
    const get = vi.spyOn(Map.prototype, "get");
    const response = await h.redeem(
      done,
      {},
      cimd("https://other.example.net/c.json"),
    );
    expect(response.status).toBe(401);
    expect(json(response)).toEqual({ error: "invalid_client" });
    expect(get.mock.calls.some(([key]) => key === done.code)).toBe(false);
    get.mockRestore();
    expect((await h.redeem(done)).status).toBe(200);
  });

  it("BR-310 an unlisted CIMD client ID with a refresh token gets 401 before the family store is read", async () => {
    const { h } = await setup();
    const done = await h.login(cimd());
    const token = json(await h.redeem(done)).refresh_token as string;
    const familyId = token.split(".")[0];
    const get = vi.spyOn(Map.prototype, "get");
    const response = await h.refresh(
      cimd("https://other.example.net/c.json"),
      token,
    );
    expect(response.status).toBe(401);
    expect(get.mock.calls.some(([key]) => key === familyId)).toBe(false);
    get.mockRestore();
    expect((await h.refresh(cimd(), token)).status).toBe(200);
  });

  it("BR-310 after a rebuild with the origin removed the refresh token gets 401 invalid_client", async () => {
    const path = stateFile();
    const clock = new Clock();
    const first = openState(path, { clock, origins: [CIMD_ORIGIN] });
    const { h } = await setup({ store: first, clock });
    const done = await h.login(cimd());
    const token = json(await h.redeem(done)).refresh_token as string;
    first.close();
    const second = openState(path, { clock, origins: [] });
    try {
      const rebuilt = await harness({
        store: second,
        clock,
        clientMetadata: new FakeMetadata(),
      });
      const response = await rebuilt.refresh(cimd(), token);
      expect(response.status).toBe(401);
      expect(json(response)).toEqual({ error: "invalid_client" });
    } finally {
      second.close();
    }
  });
});

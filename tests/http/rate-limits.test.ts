import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
import { OAuthWindowLimiter } from "../../src/http/limits.js";
import { httpAdmissionSnapshot } from "../../src/http/handler.js";
import { harness, json } from "../helpers/proxy.js";
import { expectError, httpFixture, wrapProxy } from "../helpers/http.js";

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return { ...actual, createOAuthProxy: vi.fn(actual.createOAuthProxy) };
});

let spies: Awaited<ReturnType<typeof wrapProxy>>;
beforeEach(async () => {
  spies = await wrapProxy(vi.mocked(createOAuthProxy));
});
afterEach(() => {
  vi.mocked(createOAuthProxy).mockReset();
  vi.restoreAllMocks();
});

const retry = (response: Response) =>
  Number(response.headers.get("retry-after"));

describe("BR-161 per-identity window", () => {
  it("BR-161 AC-10 refuses the 121st request in 60 seconds and recovers", async () => {
    const f = await httpFixture({
      env: { OAUTH_ALLOWED_SUBJECTS: "user-1,user-2" },
    });
    const a = await f.mint({ sub: "user-1" });
    const b = await f.mint({ sub: "user-2" });
    for (let i = 0; i < 120; i++) {
      const response = await f.mcp(a, "{}");
      expect(response.status).toBe(400);
      await response.text();
    }
    f.clock.advance(10_500);
    const refused = await f.mcp(a, "{}");
    expect(refused.status).toBe(429);
    expect(retry(refused)).toBe(50);
    await expectError(refused, 429, "rate_limited");
    const other = await f.mcp(b, "{}");
    expect(other.status).toBe(400);
    await other.text();
    f.clock.advance(49_500);
    const again = await f.mcp(await f.mint({ sub: "user-1" }), "{}");
    expect(again.status).toBe(400);
    await again.text();
    await f.handler.close();
  });

  it("BR-161 AC-10 refuses before any body read", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    for (let i = 0; i < 120; i++) await (await f.mcp(token, "{}")).text();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const response = await f.handler.handle(
      new Request("http://placeholder.invalid/", {
        method: "POST",
        headers: {
          host: "mcp.test",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: stream,
        duplex: "half",
      } as RequestInit),
      "/mcp",
    );
    expect(response.status).toBe(429);
    expect(pulled).toBe(0);
    await f.handler.close();
  });
});

describe("BR-162 process-wide OAuth windows", () => {
  const post = (path: string) => (f: Awaited<ReturnType<typeof httpFixture>>) =>
    f.send("POST", path, {
      headers: {
        "content-type": path.endsWith("register")
          ? "application/json"
          : "application/x-www-form-urlencoded",
      },
      body: path.endsWith("register") ? "{}" : "grant_type=x",
    });
  const get = (path: string) => (f: Awaited<ReturnType<typeof httpFixture>>) =>
    f.send("GET", path);

  it("BR-162 AC-11 limits registration to 30 per hour and restores service", async () => {
    const f = await httpFixture();
    for (let i = 0; i < 30; i++)
      await (await post("/mcp/oauth/register")(f)).text();
    expect(spies.register).toHaveBeenCalledTimes(30);
    f.clock.advance(1000);
    const refused = await post("/mcp/oauth/register")(f);
    expect(refused.status).toBe(429);
    expect(retry(refused)).toBe(3599);
    await expectError(refused, 429, "rate_limited");
    expect(spies.register).toHaveBeenCalledTimes(30);
    f.clock.advance(3_599_000);
    expect((await post("/mcp/oauth/register")(f)).status).not.toBe(429);
    await f.handler.close();
  });

  it.each([
    ["GET", "/mcp/oauth/authorize", 30],
    ["POST", "/mcp/oauth/consent", 30],
    ["GET", "/mcp/oauth/callback", 30],
    ["POST", "/mcp/oauth/token", 60],
  ] as const)(
    "BR-162 AC-11 limits %s %s to %i per 60 seconds",
    async (method, path, count) => {
      const f = await httpFixture();
      const make = method === "GET" ? get(path) : post(path);
      for (let i = 0; i < count; i++) {
        const response = await make(f);
        expect(response.status).not.toBe(429);
        await response.text();
      }
      const refused = await make(f);
      expect(refused.status).toBe(429);
      expect(retry(refused)).toBe(60);
      const name = path.split("/").at(-1) as
        "authorize" | "consent" | "callback" | "token";
      expect(spies[name]).toHaveBeenCalledTimes(count);
      f.clock.advance(60_000);
      expect((await make(f)).status).not.toBe(429);
      await f.handler.close();
    },
  );

  it("BR-162 AC-11 never refuses an MCP request whose token verifies", async () => {
    const f = await httpFixture();
    for (let i = 0; i < 1000; i++) {
      const response = await f.mcp("AAAA.BBBB.CCCC", "{}");
      expect(response.status).toBe(401);
      await response.text();
    }
    const handle = vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "handleRequest",
    );
    const ok = await f.mcp(
      await f.mint(),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "c", version: "1" },
        },
      }),
    );
    expect(ok.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    await f.handler.close();
  });
});

describe("BR-325 health windows", () => {
  const LOOPBACK = "127.0.0.1:3000";
  const health = (
    f: Awaited<ReturnType<typeof httpFixture>>,
    host: string,
    method = "GET",
    headers: Record<string, string> = {},
    target = "/healthz",
  ) => f.send(method, target, { host, headers });

  it.each([
    ["health_public", "mcp.test", LOOPBACK],
    ["health_loopback", LOOPBACK, "mcp.test"],
  ] as const)(
    "BR-325 BR-162 v2 BR-167 v2 AC-05 fills %s at 120 per 60 seconds and spares the other window",
    async (_window, full, other) => {
      const f = await httpFixture();
      for (let i = 0; i < 120; i++) {
        const response = await health(f, full);
        expect(response.status).toBe(200);
        await response.text();
      }
      const before = f.events("request_refused").length;
      const refused = await health(f, full);
      expect(retry(refused)).toBe(60);
      await expectError(refused, 429, "rate_limited");
      expect(f.events("request_refused").slice(before)).toEqual([
        {
          name: "request_refused",
          fields: { route: "health", status: 429, error: "rate_limited" },
        },
      ]);
      expect((await health(f, other)).status).toBe(200);
      f.clock.advance(30_000);
      const later = await health(f, full);
      expect(retry(later)).toBe(30);
      await later.text();
      f.clock.advance(30_000);
      expect((await health(f, full)).status).toBe(200);
      await f.handler.close();
    },
  );

  it("BR-325 BR-162 v2 AC-05 counts no refused request in a health window", async () => {
    const f = await httpFixture();
    for (let i = 0; i < 130; i++) {
      expect((await health(f, "mcp.test", "POST")).status).toBe(405);
      expect((await health(f, "attacker.example")).status).toBe(403);
      expect(
        (await health(f, "mcp.test", "GET", {}, `/healthz?${"a".repeat(8200)}`))
          .status,
      ).toBe(414);
      expect(
        (await health(f, "mcp.test", "GET", { "content-length": "5" })).status,
      ).toBe(413);
    }
    for (let i = 0; i < 120; i++)
      expect((await health(f, "mcp.test")).status).toBe(200);
    for (let i = 0; i < 30; i++)
      expect((await health(f, "mcp.test")).status).toBe(429);
    f.clock.advance(60_000);
    for (let i = 0; i < 120; i++)
      expect((await health(f, "mcp.test")).status).toBe(200);
    expect((await health(f, "mcp.test")).status).toBe(429);
    await f.handler.close();
  });

  it("BR-325 BR-162 v2 AC-05 leaves the OAuth windows unchanged", async () => {
    const f = await httpFixture();
    for (let i = 0; i < 120; i++) await (await health(f, "mcp.test")).text();
    for (let i = 0; i < 120; i++) await (await health(f, LOOPBACK)).text();
    for (let i = 0; i < 30; i++) {
      const response = await f.send("GET", "/mcp/oauth/authorize");
      expect(response.status).not.toBe(429);
      await response.text();
    }
    expect((await f.send("GET", "/mcp/oauth/authorize")).status).toBe(429);
    expect(spies.authorize).toHaveBeenCalledTimes(30);
    await f.handler.close();
  });
});

const admissionRoutes = [
  ["register", 30, 3600, 60],
  ["authorize", 30, 60, 60],
  ["consent", 30, 60, 60],
  ["callback", 30, 60, 60],
  ["token", 60, 60, 1200],
] as const;
function admissionRequest(f: Awaited<ReturnType<typeof httpFixture>>, route: string, peer: string, body?: string) {
  const post = ["register", "consent", "token"].includes(route);
  return f.send(post ? "POST" : "GET", `/mcp/oauth/${route}`, {
    remoteAddress: peer,
    ...(post ? {
      headers: { "content-type": route === "register" ? "application/json" : "application/x-www-form-urlencoded" },
      body: body ?? (route === "register" ? "{}" : "grant_type=x"),
    } : {}),
  });
}
const distinctPeer = (n: number) => `2001:db8:${n.toString(16)}::1`;

it.each(admissionRoutes)("BR-162 v3 AC-14 limits %s to %i per peer per %i seconds", async (route, limit, seconds) => {
  const f = await httpFixture();
  try {
    for (let i = 0; i < limit; i++) expect((await admissionRequest(f, route, "192.0.2.1")).status).not.toBe(429);
    const before = spies[route].mock.calls.length;
    const events = f.logs.length;
    const refused = await admissionRequest(f, route, "192.0.2.1");
    expect(retry(refused)).toBe(seconds);
    await expectError(refused, 429, "rate_limited");
    expect(spies[route]).toHaveBeenCalledTimes(before);
    expect(f.logs.slice(events)).toEqual([{ name: "request_refused", fields: { route, status: 429, error: "rate_limited", window: "peer" } }]);
    expect((await admissionRequest(f, route, "192.0.2.2")).status).not.toBe(429);
    f.clock.advance(seconds * 1000 - 1);
    const last = await admissionRequest(f, route, "192.0.2.1");
    expect(last.status).toBe(429);
    expect(retry(last)).toBe(1);
    f.clock.advance(1);
    expect((await admissionRequest(f, route, "192.0.2.1")).status).not.toBe(429);
  } finally { await f.handler.close(); }
});

it.each(admissionRoutes.map((row) => [row[0], row[3], row[2]] as const))(
  "BR-162 v3 AC-15 the global ceiling of %s is %i per %i seconds",
  async (route, limit, seconds) => {
    const f = await httpFixture();
    try {
      for (let i = 0; i < limit; i++) expect((await admissionRequest(f, route, distinctPeer(i))).status).not.toBe(429);
      const before = httpAdmissionSnapshot(f.handler);
      for (const peer of [distinctPeer(limit), distinctPeer(0)]) {
        const refused = await admissionRequest(f, route, peer);
        expect(retry(refused)).toBe(seconds);
        await expectError(refused, 429, "rate_limited");
        expect(f.events("request_refused").at(-1)?.fields).toEqual({ route, status: 429, error: "rate_limited", window: "global" });
      }
      expect(httpAdmissionSnapshot(f.handler)).toEqual(before);
      f.clock.advance(seconds * 1000);
      expect((await admissionRequest(f, route, distinctPeer(limit))).status).not.toBe(429);
      expect(httpAdmissionSnapshot(f.handler)[route]).toEqual({ entries: 1, peerRequests: 1, globalRequests: 1 });
    } finally { await f.handler.close(); }
  },
);

function refreshBody(clientId: string, token: string) {
  return new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token }).toString();
}

it("BR-162 v3 AC-16 invalid requests lock out only their own peer", async () => {
  const h = await harness();
  vi.mocked(createOAuthProxy).mockReturnValue(h.proxy);
  const f = await httpFixture({ clock: h.clock });
  try {
    const done = await h.login();
    const token = json(await h.redeem(done)).refresh_token as string;
    for (let i = 0; i < 60; i++) expect((await admissionRequest(f, "token", "192.0.2.1", "grant_type=refresh_token&client_id=unknown&refresh_token=x")).status).toBe(401);
    const valid = refreshBody(done.client.clientId, token);
    expect((await admissionRequest(f, "token", "192.0.2.1", valid)).status).toBe(429);
    expect(f.events("request_refused").at(-1)?.fields.window).toBe("peer");
    expect((await admissionRequest(f, "token", "192.0.2.2", valid)).status).toBe(200);
    for (let i = 0; i < 30; i++) expect((await admissionRequest(f, "register", "192.0.2.1")).status).toBe(400);
    const body = JSON.stringify({ redirect_uris: [done.redirect], token_endpoint_auth_method: "none" });
    expect((await admissionRequest(f, "register", "192.0.2.2", body)).status).toBe(201);
  } finally { await f.handler.close(); }
});

it("BR-162 v3 AC-16 shared egress admits only 60 token requests per minute", async () => {
  const h = await harness();
  vi.mocked(createOAuthProxy).mockReturnValue(h.proxy);
  const f = await httpFixture({ clock: h.clock });
  try {
    const refreshes: string[] = [];
    for (let i = 0; i < 62; i++) {
      const done = await h.login();
      refreshes.push(refreshBody(done.client.clientId, json(await h.redeem(done)).refresh_token as string));
    }
    for (const body of refreshes.slice(0, 60)) expect((await admissionRequest(f, "token", "192.0.2.1", body)).status).toBe(200);
    expect((await admissionRequest(f, "token", "192.0.2.1", refreshes[60])).status).toBe(429);
    expect(f.events("request_refused").at(-1)?.fields.window).toBe("peer");
    expect((await admissionRequest(f, "token", "192.0.2.2", refreshes[61])).status).toBe(200);
  } finally { await f.handler.close(); }
});

it("BR-162 v3 AC-17 a peer table holds fewer than twice its global limit", () => {
  for (const global of [60, 1200]) {
    const limiter = new OAuthWindowLimiter(global === 60 ? 30 : 60, global, 60_000);
    expect(limiter.take("first", 0)).toBeUndefined();
    for (let i = 0; i < global - 1; i++) expect(limiter.take(`a${String(i)}`, 59_999)).toBeUndefined();
    for (let i = 0; i < global; i++) expect(limiter.take(`b${String(i)}`, 60_000)).toBeUndefined();
    expect(limiter.stats().entries).toBe(2 * global - 1);
    expect(limiter.take("new", 119_999)).toEqual({ window: "global", retryAfter: 1 });
    expect(limiter.stats().entries).toBe(2 * global - 1);
    expect(limiter.take("new", 120_000)).toBeUndefined();
    expect(limiter.stats()).toEqual({ entries: 1, peerRequests: 1, globalRequests: 1 });
  }
});

it("BR-162 v3 AC-18 refused and non-OAuth requests count in no OAuth window", async () => {
  const f = await httpFixture();
  try {
    for (let i = 0; i < 30; i++) await admissionRequest(f, "consent", "192.0.2.1");
    const before = httpAdmissionSnapshot(f.handler);
    const route = "/mcp/oauth/consent";
    const base = { remoteAddress: "192.0.2.1", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "x" };
    expect((await f.send("POST", route, { ...base, host: "invalid.example" })).status).toBe(403);
    expect((await f.send("GET", route, { remoteAddress: "192.0.2.1" })).status).toBe(405);
    expect((await f.send("POST", route, { ...base, headers: { ...base.headers, "content-length": "32769" } })).status).toBe(413);
    expect((await f.send("POST", route, { ...base, headers: { ...base.headers, origin: "https://invalid.example" } })).status).toBe(403);
    expect((await f.send("POST", route, base)).status).toBe(429);
    for (let i = 0; i < 30; i++) await f.mcp("invalid", "{}");
    for (let i = 0; i < 120; i++) await f.send("GET", "/healthz");
    expect(httpAdmissionSnapshot(f.handler)).toEqual(before);
    for (let i = 0; i < 30; i++) await admissionRequest(f, "consent", distinctPeer(i));
    const full = httpAdmissionSnapshot(f.handler);
    expect((await admissionRequest(f, "consent", "198.51.100.9")).status).toBe(429);
    expect(f.events("request_refused").at(-1)?.fields.window).toBe("global");
    expect(httpAdmissionSnapshot(f.handler)).toEqual(full);
  } finally { await f.handler.close(); }
});

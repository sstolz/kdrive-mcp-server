import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
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

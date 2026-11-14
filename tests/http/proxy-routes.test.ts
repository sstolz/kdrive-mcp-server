import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebStandardStreamableHTTPServerTransport,
  McpServer,
} from "@modelcontextprotocol/server";
import {
  createOAuthProxy,
  type OAuthProxy,
  type ProxyResponse,
} from "../../src/auth/proxy/index.js";
import { createNavigationServer } from "../../src/navigation.js";
import {
  HOST,
  INITIALIZE,
  PRM,
  RawClient,
  expectError,
  httpFixture,
  listening,
  rawHeaders,
  rawText,
} from "../helpers/http.js";

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return { ...actual, createOAuthProxy: vi.fn(actual.createOAuthProxy) };
});
vi.mock("../../src/navigation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/navigation.js")>();
  return {
    ...actual,
    createNavigationServer: vi.fn(actual.createNavigationServer),
  };
});

const reply: ProxyResponse = {
  status: 200,
  headers: [
    ["content-type", "text/plain"],
    ["set-cookie", "a=1; Path=/"],
    ["set-cookie", "b=2; Path=/"],
    ["www-authenticate", 'Bearer realm="x"'],
  ],
  body: "from-handler",
};

function fakeProxy() {
  const calls: Record<string, unknown[]> = {
    register: [],
    authorize: [],
    consent: [],
    callback: [],
    token: [],
  };
  const answer = (name: string) => (input: unknown) => {
    calls[name]!.push(input);
    return Promise.resolve(reply);
  };
  const proxy = {
    kid: "kid",
    metadataPaths: ["/.well-known/oauth-authorization-server/mcp"],
    metadata: () => reply,
    register: answer("register"),
    authorize: answer("authorize"),
    consent: answer("consent"),
    callback: answer("callback"),
    token: answer("token"),
    verifier: () =>
      Promise.resolve({ ok: true as const, identity: { iss: "i", sub: "s" } }),
    cancelFetches: () => undefined,
  } satisfies OAuthProxy;
  return { proxy, calls };
}

beforeEach(() => {
  vi.mocked(createNavigationServer).mockClear();
});
afterEach(() => {
  vi.mocked(createOAuthProxy).mockReset();
  vi.restoreAllMocks();
});

describe("BR-165 OAuth routes call the F-010 handlers", () => {
  it("BR-165 AC-15 passes the exact query, form, body, cookie and authorization", async () => {
    const fake = fakeProxy();
    vi.mocked(createOAuthProxy).mockImplementation(() => fake.proxy);
    const f = await httpFixture();
    await f.send("POST", "/mcp/oauth/register", {
      headers: { "content-type": "application/json" },
      body: '{"redirect_uris":[]}',
    });
    expect(fake.calls.register).toEqual([{ body: '{"redirect_uris":[]}' }]);

    await f.send("GET", "/mcp/oauth/authorize?a=1&a=2&b=%20c", {
      headers: { cookie: "k=v" },
    });
    await f.send("GET", "/mcp/oauth/authorize");
    const authorize = fake.calls.authorize as Array<{
      query: URLSearchParams;
      cookie?: string;
    }>;
    expect(authorize[0]!.query.getAll("a")).toEqual(["1", "2"]);
    expect(authorize[0]!.query.get("b")).toBe(" c");
    expect(authorize[0]!.cookie).toBe("k=v");
    expect(Object.hasOwn(authorize[1]!, "cookie")).toBe(false);

    const form = { "content-type": "application/x-www-form-urlencoded" };
    await f.send("POST", "/mcp/oauth/consent", {
      headers: { ...form, cookie: "k=v" },
      body: "consent=x&decision=approve",
    });
    const consent = fake.calls.consent as Array<{
      form: URLSearchParams;
      cookie?: string;
    }>;
    expect(consent[0]!.form.get("decision")).toBe("approve");
    expect(consent[0]!.cookie).toBe("k=v");

    await f.send("GET", "/mcp/oauth/callback?code=c&state=s", {
      headers: { cookie: "k=v" },
    });
    const callback = fake.calls.callback as Array<{
      query: URLSearchParams;
      cookie?: string;
    }>;
    expect(callback[0]!.query.get("state")).toBe("s");
    expect(callback[0]!.cookie).toBe("k=v");

    await f.send("POST", "/mcp/oauth/token", {
      headers: { ...form, authorization: "Basic abc" },
      body: "grant_type=x",
    });
    const token = fake.calls.token as Array<{
      form: URLSearchParams;
      authorization?: string;
    }>;
    expect(token[0]!.form.get("grant_type")).toBe("x");
    expect(token[0]!.authorization).toBe("Basic abc");
    await f.handler.close();
  });

  it("BR-165 BR-170 AC-15 (socket) joins Cookie headers and keeps handler headers unchanged", async () => {
    const fake = fakeProxy();
    vi.mocked(createOAuthProxy).mockImplementation(() => fake.proxy);
    const f = await httpFixture();
    const server = await listening(f);
    try {
      const client = await RawClient.connect(server.port);
      client.write(
        rawText({
          target: "/mcp/oauth/callback?code=c",
          headers: [
            ["Host", HOST],
            ["Cookie", "a=1"],
            ["Cookie", "b=2"],
          ],
        }),
      );
      const response = await client.next();
      expect(response?.status).toBe(200);
      expect(response?.body).toBe("from-handler");
      expect(rawHeaders(response!, "set-cookie")).toEqual([
        "a=1; Path=/",
        "b=2; Path=/",
      ]);
      expect(rawHeaders(response!, "www-authenticate")).toEqual([
        'Bearer realm="x"',
      ]);
      expect(
        (fake.calls.callback as Array<{ cookie?: string }>)[0]!.cookie,
      ).toBe("a=1; b=2");
      client.destroy();
    } finally {
      await server.close();
    }
  });
});

describe("BR-170 exceptions in the request path", () => {
  it("BR-163 BR-170 AC-15 answers 500 for a throwing handler and serves the next request", async () => {
    const fake = fakeProxy();
    fake.proxy.token = () =>
      Promise.reject(new Error("CANARY-HANDLER-FAILURE"));
    vi.mocked(createOAuthProxy).mockImplementation(() => fake.proxy);
    const f = await httpFixture();
    const failed = await f.send("POST", "/mcp/oauth/token", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=b",
    });
    await expectError(failed, 500, "server_error");
    const next = await f.send(
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(next.status).toBe(200);
    expect(f.events("request_refused").map((e) => e.fields)).toEqual([
      { route: "token", status: 500, error: "server_error" },
    ]);
    await f.handler.close();
  });

  it("BR-163 BR-170 AC-15 answers 500 for a throwing navigation factory", async () => {
    const f = await httpFixture();
    vi.mocked(createNavigationServer).mockImplementationOnce(() => {
      throw new Error("CANARY-FACTORY-FAILURE");
    });
    const failed = await f.mcp(await f.mint(), INITIALIZE);
    await expectError(failed, 500, "server_error");
    const ok = await f.mcp(await f.mint(), INITIALIZE);
    expect(ok.status).toBe(200);
    await f.handler.close();
  });

  it("BR-163 BR-170 AC-15 answers 500 for a throwing transport", async () => {
    const f = await httpFixture();
    vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "handleRequest",
    ).mockRejectedValueOnce(new Error("CANARY-TRANSPORT-FAILURE"));
    const failed = await f.mcp(await f.mint(), INITIALIZE);
    await expectError(failed, 500, "server_error");
    expect((await f.mcp(await f.mint(), INITIALIZE)).status).toBe(200);
    await f.handler.close();
  });

  it("BR-163 AC-15 answers 500 and registers nothing when the logger throws on session_opened", async () => {
    let thrown = 0;
    const f = await httpFixture({
      logger: {
        event(name) {
          if (name === "session_opened" && thrown++ === 0)
            throw new Error("CANARY-LOGGER-FAILURE");
        },
      },
    });
    const transportClose = vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "close",
    );
    const serverClose = vi.spyOn(McpServer.prototype, "close");
    const failed = await f.mcp(await f.mint(), INITIALIZE);
    expect(failed.headers.get("mcp-session-id")).toBeNull();
    await expectError(failed, 500, "server_error");
    expect(transportClose).toHaveBeenCalled();
    expect(serverClose).toHaveBeenCalled();
    const { response, session } = await f.initialize(await f.mint());
    expect(response.status).toBe(200);
    expect(session).toHaveLength(43);
    const tools = await f.mcp(
      await f.mint(),
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      "x".repeat(43),
    );
    expect(tools.status).toBe(404);
    await f.handler.close();
    expect(PRM).toContain("mcp.test");
  });
});

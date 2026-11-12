import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOAuthProxy,
  openOAuthStateStore,
} from "../../src/auth/proxy/index.js";
import { SessionRegistry } from "../../src/http/sessions.js";
import {
  HOST,
  exchange,
  expectError,
  httpFixture,
  listening,
  rawHeader,
  wrapProxy,
  type Fixture,
} from "../helpers/http.js";
import { removeStateFiles, stateFile } from "../helpers/proxy.js";

// F-021 AC-01 and AC-03: the `/healthz` route of the F-012 handler.

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return {
    ...actual,
    createOAuthProxy: vi.fn(actual.createOAuthProxy),
    openOAuthStateStore: vi.fn(actual.openOAuthStateStore),
  };
});

const OK = '{"status":"ok"}';
const HEADERS = [
  ["cache-control", "no-store"],
  ["content-type", "application/json"],
  ["x-content-type-options", "nosniff"],
];

let spies: Awaited<ReturnType<typeof wrapProxy>>;
const commit = vi.fn();
beforeEach(async () => {
  spies = await wrapProxy(vi.mocked(createOAuthProxy));
  const actual = await vi.importActual<
    typeof import("../../src/auth/proxy/index.js")
  >("../../src/auth/proxy/index.js");
  vi.mocked(openOAuthStateStore).mockImplementation((options) => {
    const store = actual.openOAuthStateStore(options);
    return {
      clients: store.clients,
      families: store.families,
      commit: (writes) => {
        commit(writes);
        return store.commit(writes);
      },
      close: () => {
        store.close();
      },
    };
  });
});
afterEach(() => {
  vi.mocked(createOAuthProxy).mockReset();
  vi.mocked(openOAuthStateStore).mockReset();
  commit.mockReset();
  vi.restoreAllMocks();
  removeStateFiles();
});

async function expectOk(response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expect([...response.headers].sort()).toEqual(HEADERS);
  expect(await response.text()).toBe(OK);
}

describe("BR-322 health route", () => {
  let f: Fixture;
  afterEach(async () => {
    await f.handler.close();
  });

  it("BR-322 AC-01 answers GET /healthz with the constant body and exactly three headers", async () => {
    f = await httpFixture();
    await expectOk(await f.send("GET", "/healthz"));
    await expectOk(await f.send("GET", "/healthz?x=1"));
    await expectOk(
      await f.send("GET", "/healthz", { headers: { "content-length": "0" } }),
    );
    await expectOk(
      await f.send("GET", "/healthz", { headers: { "content-length": "000" } }),
    );
    expect(f.handler.routeOf("/healthz")).toBe("health");
    expect(f.handler.routeOf("/healthz?x=1")).toBe("health");
  });

  it("BR-322 AC-01 refuses other methods with 405 and Allow: GET", async () => {
    f = await httpFixture();
    for (const method of ["HEAD", "POST", "DELETE", "PUT"]) {
      const response = await f.send(method, "/healthz");
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      if (method !== "HEAD")
        expect(await response.text()).toBe('{"error":"method_not_allowed"}');
    }
  });

  it("BR-322 AC-01 refuses a framed body with 413 and connection: close", async () => {
    f = await httpFixture();
    for (const headers of [
      { "content-length": "5" },
      { "transfer-encoding": "chunked" },
    ]) {
      const response = await f.send("GET", "/healthz", { headers });
      expect(response.headers.get("connection")).toBe("close");
      await expectError(response, 413, "payload_too_large");
    }
  });

  it("BR-322 AC-01 answers 414 for a long target and 404 for neighbouring paths", async () => {
    f = await httpFixture();
    await expectError(
      await f.send("GET", `/healthz?${"a".repeat(8192)}`),
      414,
      "invalid_request",
    );
    for (const path of ["/healthz/", "/HEALTHZ", "/healthz/x", "/mcp/healthz"])
      await expectError(await f.send("GET", path), 404, "not_found");
  });

  it("BR-322 AC-01 keeps /healthz for an MCP endpoint at that path", async () => {
    f = await httpFixture({
      env: { MCP_PUBLIC_URL: "https://mcp.test/healthz" },
    });
    const response = await f.send("GET", "/healthz");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    expect(f.handler.routeOf("/healthz")).toBe("mcp");
    await response.text();
  });

  it("BR-322 AC-01 answers 503 while the server closes", async () => {
    f = await httpFixture();
    await f.handler.close();
    await expectError(
      await f.send("GET", "/healthz"),
      503,
      "temporarily_unavailable",
    );
    const refused = f.events("request_refused").at(-1)?.fields;
    expect(refused).toEqual({
      route: "health",
      status: 503,
      error: "temporarily_unavailable",
    });
  });

  it("BR-322 BR-170 AC-01 (socket) adds only the transport headers on the wire", async () => {
    f = await httpFixture();
    const server = await listening(f);
    try {
      const response = await exchange(server.port, {
        target: "/healthz",
        headers: [["Host", HOST]],
      });
      expect(response?.status).toBe(200);
      expect(response?.body).toBe(OK);
      const names = (response?.headers ?? [])
        .map(([name]) => name.toLowerCase())
        .sort();
      expect(names).toEqual([
        "cache-control",
        "connection",
        "content-length",
        "content-type",
        "date",
        "keep-alive",
        "x-content-type-options",
      ]);
      expect(rawHeader(response!, "content-length")).toBe("15");
    } finally {
      await server.close();
    }
  });
});

describe("BR-323 health route independence", () => {
  it("BR-323 BR-167 v2 AC-03 answers byte-identically and touches no dependency", async () => {
    const f = await httpFixture({ env: { OAUTH_STATE_FILE: stateFile() } });
    const token = await f.mint();
    const session = await f.open(token);
    const upstreamCalls = f.upstream?.calls.length ?? 0;
    const logged = f.logs.length;
    for (const spy of Object.values(spies)) spy.mockClear();
    commit.mockClear();
    const registry = [
      vi.spyOn(SessionRegistry.prototype, "find"),
      vi.spyOn(SessionRegistry.prototype, "sweep"),
      vi.spyOn(SessionRegistry.prototype, "register"),
      vi.spyOn(SessionRegistry.prototype, "close"),
    ];
    const inspect = vi.spyOn(f.handlerOptions.dependencies, "inspect");
    const variants: Array<Record<string, string>> = [
      {},
      { authorization: `Bearer ${token}` },
      { authorization: "Bearer invalid.token.value" },
      { authorization: "Basic eDp5" },
      { cookie: "kdrive_mcp_consent=synthetic; other=1" },
      { origin: "https://attacker.example" },
      { "mcp-session-id": session },
      { "mcp-session-id": "x".repeat(43) },
    ];
    const seen: string[] = [];
    for (const headers of variants)
      for (const target of ["/healthz", "/healthz?access_token=x&a=b"]) {
        const response = await f.send("GET", target, { headers });
        expect(response.headers.has("set-cookie")).toBe(false);
        seen.push(
          `${String(response.status)}|${JSON.stringify([...response.headers])}|${await response.text()}`,
        );
      }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain(OK);
    for (const spy of [...Object.values(spies), commit, inspect, ...registry])
      expect(spy).not.toHaveBeenCalled();
    expect(f.upstream?.calls.length).toBe(upstreamCalls);
    expect(f.logs).toHaveLength(logged);
    await f.handler.close();
  });

  it("BR-323 AC-03 answers the same with zero sessions and in insecure mode", async () => {
    const authenticated = await httpFixture();
    const insecure = await httpFixture({ insecure: true, upstream: null });
    const bodies: string[] = [];
    for (const f of [authenticated, insecure]) {
      const response = await f.send("GET", "/healthz");
      bodies.push(
        `${String(response.status)}|${JSON.stringify([...response.headers])}|${await response.text()}`,
      );
      expect(f.logs).toEqual([]);
      await f.handler.close();
    }
    expect(bodies[0]).toBe(bodies[1]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
import {
  HOST,
  P,
  SYNTHETIC_PLACEHOLDER,
  exchange,
  expectError,
  httpFixture,
  jsonRpc,
  listening,
  wrapProxy,
  type Fixture,
} from "../helpers/http.js";

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return { ...actual, createOAuthProxy: vi.fn(actual.createOAuthProxy) };
});

let spies: Awaited<ReturnType<typeof wrapProxy>>;
beforeEach(async () => {
  spies = await wrapProxy(vi.mocked(createOAuthProxy));
});
afterEach(() => vi.mocked(createOAuthProxy).mockReset());

const routes: Array<[string, string]> = [
  ["POST", "/mcp"],
  ["GET", "/.well-known/oauth-protected-resource/mcp"],
  ["POST", "/mcp/oauth/token"],
  ["GET", "/unknown"],
];

describe("BR-156 Host check", () => {
  it("BR-156 AC-05 (socket) accepts and refuses Host values on every route", async () => {
    const f = await httpFixture();
    const server = await listening(f);
    try {
      for (const host of ["mcp.test", "MCP.TEST", "mcp.test:443"]) {
        const ok = await exchange(server.port, {
          target: "/.well-known/oauth-protected-resource/mcp",
          headers: [["Host", host]],
        });
        expect(ok?.status).toBe(200);
      }
      const bad: Array<Array<[string, string]>> = [
        [["Host", "evil.test"]],
        [["Host", "mcp.test:8443"]],
        [["Host", "mcp.test.evil.test"]],
        [["Host", ""]],
        [
          ["Host", "mcp.test"],
          ["Host", "mcp.test"],
        ],
        [],
      ];
      for (const headers of bad)
        for (const [method, target] of routes) {
          const response = await exchange(server.port, {
            method,
            target,
            headers: [...headers, ["Content-Length", "0"]],
          });
          expect(response?.status).toBe(403);
          expect(response?.body).toBe('{"error":"invalid_host"}');
        }
      const old = await exchange(server.port, {
        target: "/mcp",
        version: "1.0",
      });
      expect(old?.status).toBe(403);
      expect(old?.body).toBe('{"error":"invalid_host"}');
      expect(spies.verifier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("BR-156 BR-025 v2 AC-05 accepts loopback forms in insecure mode on port 80", async () => {
    const f = await httpFixture({
      insecure: true,
      upstream: null,
      env: { MCP_HTTP_PORT: "80" },
    });
    for (const host of [
      "127.0.0.1",
      "127.0.0.1:80",
      "localhost",
      "localhost:80",
    ]) {
      const r = await f.send("POST", "/", { host, body: "{}" });
      expect(r.status).not.toBe(403);
      await r.text();
    }
    await expectError(
      await f.send("POST", "/", { host: "127.0.0.1:3000", body: "{}" }),
      403,
      "invalid_host",
    );
  });

  it("BR-156 AC-05 insecure mode on port 3000 accepts only the explicit port", async () => {
    const f = await httpFixture({ insecure: true, upstream: null });
    for (const host of ["127.0.0.1:3000", "localhost:3000"]) {
      const r = await f.send("POST", "/", { host, body: "{}" });
      expect(r.status).not.toBe(403);
      await r.text();
    }
    for (const host of ["127.0.0.1", "127.0.0.1:80", "localhost:80"])
      await expectError(
        await f.send("POST", "/", { host, body: "{}" }),
        403,
        "invalid_host",
      );
  });

  it("BR-156 AC-05 a public URL with an explicit port refuses the default-port forms", async () => {
    const f = await httpFixture({
      env: { MCP_PUBLIC_URL: "https://mcp.test:8443/mcp" },
    });
    const ok = await f.send(
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
      { host: "mcp.test:8443" },
    );
    expect(ok.status).toBe(200);
    await ok.text();
    for (const host of ["mcp.test", "mcp.test:443"])
      await expectError(
        await f.send("GET", "/.well-known/oauth-protected-resource/mcp", {
          host,
        }),
        403,
        "invalid_host",
      );
  });

  it("BR-156 AC-05 refuses a DNS rebinding request", async () => {
    const f = await httpFixture();
    await expectError(
      await f.send("POST", "/mcp", {
        host: "attacker.test",
        headers: { origin: "http://attacker.test" },
        body: "{}",
      }),
      403,
      "invalid_host",
    );
  });
});

describe("BR-324 health route loopback Host allowance", () => {
  const healthz = async (f: Fixture, hosts: readonly string[]) => {
    const headers = new Headers();
    for (const host of hosts) headers.append("host", host);
    return await f.handler.handle(
      new Request(SYNTHETIC_PLACEHOLDER, { headers }),
      "/healthz",
    );
  };

  it("BR-324 BR-156 v2 AC-04 accepts the loopback forms and the public Host on /healthz", async () => {
    const f = await httpFixture();
    for (const host of [
      "127.0.0.1",
      "127.0.0.1:3000",
      "LOCALHOST:65535",
      "localhost",
      "[::1]:8080",
      "[::1]",
      HOST,
      "MCP.TEST:443",
    ]) {
      const response = await healthz(f, [host]);
      expect(response.status, host).toBe(200);
      expect(await response.text()).toBe('{"status":"ok"}');
    }
    await f.handler.close();
  });

  it("BR-324 AC-04 refuses every other Host with 403 before any window is counted", async () => {
    const f = await httpFixture();
    const refusedHosts: Array<readonly string[]> = [
      [],
      [""],
      ["127.0.0.1", "127.0.0.1"],
      ["127.0.0.2"],
      ["127.0.0.1:123456"],
      ["127.0.0.1:"],
      ["10.0.0.1:3000"],
      ["attacker.example"],
      ["::1"],
      ["localhost.attacker.example"],
      ["127.0.0.1:30a0"],
    ];
    for (let i = 0; i < 130; i++)
      for (const hosts of refusedHosts)
        await expectError(await healthz(f, hosts), 403, "invalid_host");
    for (const host of ["127.0.0.1:3000", HOST])
      for (let i = 0; i < 120; i++)
        expect((await healthz(f, [host])).status).toBe(200);
    await f.handler.close();
  });

  it("BR-324 BR-325 AC-04 counts a loopback Host only in health_loopback and the public Host only in health_public", async () => {
    const f = await httpFixture();
    for (let i = 0; i < 120; i++)
      expect((await healthz(f, ["localhost"])).status).toBe(200);
    expect((await healthz(f, ["[::1]:1"])).status).toBe(429);
    expect((await healthz(f, [HOST])).status).toBe(200);
    await f.handler.close();
  });

  it("BR-156 v2 AC-04 keeps refusing a loopback Host on every other route", async () => {
    const f = await httpFixture();
    await expectError(
      await f.send("GET", "/.well-known/oauth-protected-resource/mcp", {
        host: "127.0.0.1:3000",
      }),
      403,
      "invalid_host",
    );
    await expectError(
      await f.send("POST", "/mcp", {
        host: "127.0.0.1:3000",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      403,
      "invalid_host",
    );
    for (const path of ["/healthz/", "/HEALTHZ", "/unknown"])
      await expectError(
        await f.send("GET", path, { host: "localhost" }),
        403,
        "invalid_host",
      );
    expect(spies.verifier).not.toHaveBeenCalled();
    await f.handler.close();
  });
});

describe("BR-157 Origin check", () => {
  const origins: Array<[string | undefined, boolean]> = [
    ["https://mcp.test", true],
    [undefined, true],
    ["https://evil.test", false],
    ["null", false],
    ["http://mcp.test", false],
  ];

  it.each(origins)(
    "BR-157 AC-05 MCP endpoint with Origin %s passes: %s",
    async (origin, pass) => {
      const f = await httpFixture();
      const token = await f.mint();
      const response = await f.send("POST", "/mcp", {
        headers: f.mcpHeaders(
          token,
          undefined,
          origin === undefined ? {} : { origin },
        ),
        body: jsonRpc("initialize", 1, {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "c", version: "1" },
        }),
      });
      if (pass) expect(response.status).toBe(200);
      else await expectError(response, 403, "invalid_origin");
      await f.handler.close();
    },
  );

  it("BR-157 AC-05 (socket) refuses two Origin headers on the MCP endpoint", async () => {
    const f = await httpFixture();
    const server = await listening(f);
    try {
      const response = await exchange(server.port, {
        method: "POST",
        target: "/mcp",
        headers: [
          ["Host", HOST],
          ["Origin", "https://mcp.test"],
          ["Origin", "https://mcp.test"],
          ["Content-Length", "0"],
        ],
      });
      expect(response?.status).toBe(403);
      expect(response?.body).toBe('{"error":"invalid_origin"}');
    } finally {
      await server.close();
    }
  });

  it.each(origins)(
    "BR-157 AC-05 consent with Origin %s is refused unless allowed",
    async (origin, pass) => {
      const f = await httpFixture();
      const headers: Record<string, string> = {
        "content-type": "application/x-www-form-urlencoded",
        ...(origin === undefined ? {} : { origin }),
      };
      const response = await f.send("POST", "/mcp/oauth/consent", {
        headers,
        body: "consent=x&decision=approve",
      });
      const text = await response.text();
      if (pass || origin === "null") {
        expect(text).not.toBe('{"error":"invalid_origin"}');
        expect(spies.consent).toHaveBeenCalledTimes(1);
      } else {
        expect(response.status).toBe(403);
        expect(text).toBe('{"error":"invalid_origin"}');
        expect(spies.consent).not.toHaveBeenCalled();
      }
      await f.handler.close();
    },
  );

  it("BR-157 AC-05 other routes ignore Origin", async () => {
    const f = await httpFixture();
    const response = await f.send("POST", "/mcp/oauth/token", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.test",
      },
      body: "grant_type=authorization_code",
    });
    expect(await response.text()).not.toBe('{"error":"invalid_origin"}');
    expect(spies.token).toHaveBeenCalledTimes(1);
    const prm = await f.send(
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
      { headers: { origin: "https://evil.test" } },
    );
    expect(prm.status).toBe(200);
    await f.handler.close();
    expect(P).toBe("https://mcp.test/mcp");
  });
});

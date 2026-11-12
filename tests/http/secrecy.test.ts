import { afterEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import {
  INITIALIZE,
  httpFixture,
  jsonRpc,
  oauthLogin,
  type Fixture,
} from "../helpers/http.js";

afterEach(() => vi.restoreAllMocks());

const KDRIVE = "CANARY-KDRIVE-CREDENTIAL";
const SECRET = "CANARY-UPSTREAM-SECRET";
const IDENTITY = "canary-subject-identity";
const REFRESH = "CANARY-UPSTREAM-REFRESH";
const ACCESS = "SYNTHETIC-UPSTREAM-ACCESS";

interface Seen {
  target: string;
  status: number;
  headers: string;
  body: string;
  session: string | null;
}

async function secrecyFixture() {
  const seen: Seen[] = [];
  const f = await httpFixture({
    env: {
      KDRIVE_TOKEN: KDRIVE,
      OAUTH_UPSTREAM_CLIENT_SECRET: SECRET,
      OAUTH_ALLOWED_SUBJECTS: IDENTITY,
    },
    observe: async (response, target) => {
      seen.push({
        target,
        status: response.status,
        headers: [...response.headers]
          .filter(([name]) => name !== "mcp-session-id")
          .map(([name, value]) => `${name}: ${value}`)
          .join("\n"),
        body: await response.text(),
        session: response.headers.get("mcp-session-id"),
      });
    },
  });
  return { f, seen };
}

function pemLines(pem: string): string[] {
  return pem
    .split("\n")
    .filter((line) => line.length >= 40 && !line.startsWith("-----"));
}

function expectSecrecy(
  f: Fixture,
  seen: Seen[],
  token: string,
  sessions: string[],
): void {
  const secrets = [
    KDRIVE,
    SECRET,
    IDENTITY,
    REFRESH,
    ACCESS,
    ...pemLines(f.pem),
  ];
  for (const entry of seen) {
    if (entry.target.endsWith("/oauth/token")) continue;
    for (const canary of [...secrets, token]) {
      expect(entry.headers, entry.target).not.toContain(canary);
      expect(entry.body, entry.target).not.toContain(canary);
    }
    for (const id of sessions) {
      if (!id) continue;
      expect(entry.headers).not.toContain(id);
      expect(entry.body).not.toContain(id);
    }
  }
  const logged = JSON.stringify(f.logs);
  for (const canary of [...secrets, token, ...sessions])
    expect(logged).not.toContain(canary);
  const allowed = new Set([
    "request_refused",
    "session_opened",
    "session_closed",
    "registration_refused",
    "authorization_refused",
    "consent_refused",
    "upstream_unavailable",
    "callback_refused",
    "id_token_refused",
    "identity_refused",
    "token_refused",
    "refresh_family_revoked",
    "store_full",
  ]);
  for (const entry of f.logs) expect(allowed.has(entry.name)).toBe(true);
  for (const entry of f.events("request_refused"))
    expect(Object.keys(entry.fields).sort()).toEqual([
      "error",
      "route",
      "status",
    ]);
  for (const entry of f.events("session_opened"))
    expect(Object.keys(entry.fields).sort()).toEqual([
      "count",
      "requested_protocol",
    ]);
  for (const entry of f.events("session_closed"))
    expect(Object.keys(entry.fields).sort()).toEqual(["count", "reason"]);
}

describe("BR-167 secrecy and logging", () => {
  it("BR-167 AC-17 leaks no canary through any refusal or flow response, or logger call", async () => {
    const { f, seen } = await secrecyFixture();
    const login = await oauthLogin(
      f,
      { sub: IDENTITY },
      { refresh_token: REFRESH },
    );
    const token = login.accessToken;
    const bearer = { authorization: `Bearer ${token}` };

    const refusals: Array<{
      name: string;
      route: string;
      status: number;
      error: string;
      run: () => Promise<Response>;
    }> = [
      {
        name: "414",
        route: "unknown",
        status: 414,
        error: "invalid_request",
        run: () => f.send("GET", `/${"a".repeat(8200)}`),
      },
      {
        name: "host mcp",
        route: "mcp",
        status: 403,
        error: "invalid_host",
        run: () => f.send("POST", "/mcp", { host: "evil.test" }),
      },
      {
        name: "host unknown",
        route: "unknown",
        status: 403,
        error: "invalid_host",
        run: () => f.send("GET", "/x", { host: "evil.test" }),
      },
      {
        name: "404 canary target",
        route: "unknown",
        status: 404,
        error: "not_found",
        run: () => f.send("GET", `/${KDRIVE}/${SECRET}/${token}`),
      },
      {
        name: "405",
        route: "mcp",
        status: 405,
        error: "method_not_allowed",
        run: () => f.send("GET", "/mcp"),
      },
      {
        name: "413 framing",
        route: "prm",
        status: 413,
        error: "payload_too_large",
        run: () =>
          f.send("GET", "/.well-known/oauth-protected-resource/mcp", {
            headers: { "content-length": "4" },
          }),
      },
      {
        name: "origin",
        route: "mcp",
        status: 403,
        error: "invalid_origin",
        run: () =>
          f.mcp(token, INITIALIZE, undefined, { origin: "https://evil.test" }),
      },
      {
        name: "unauthorized",
        route: "mcp",
        status: 401,
        error: "unauthorized",
        run: () => f.send("POST", "/mcp", { body: "{}" }),
      },
      {
        name: "access_token query",
        route: "mcp",
        status: 400,
        error: "invalid_request",
        run: () => f.send("POST", `/mcp?access_token=${token}`, { body: "{}" }),
      },
      {
        name: "invalid token",
        route: "mcp",
        status: 401,
        error: "invalid_token",
        run: () => f.mcp(`${token}x`, "{}"),
      },
      {
        name: "access denied",
        route: "mcp",
        status: 403,
        error: "access_denied",
        run: async () => f.mcp(await f.mint({ sub: "intruder" }), "{}"),
      },
      {
        name: "415",
        route: "mcp",
        status: 415,
        error: "unsupported_media_type",
        run: () =>
          f.send("POST", "/mcp", {
            headers: { ...f.mcpHeaders(token), "content-type": "text/plain" },
            body: "x",
          }),
      },
      {
        name: "400 body",
        route: "mcp",
        status: 400,
        error: "invalid_request",
        run: () => f.mcp(token, "{bad"),
      },
      {
        name: "sessionless",
        route: "mcp",
        status: 400,
        error: "invalid_request",
        run: () => f.mcp(token, jsonRpc("tools/list", 1)),
      },
      {
        name: "404 session",
        route: "mcp",
        status: 404,
        error: "session_not_found",
        run: () => f.mcp(token, jsonRpc("tools/list", 1), "A".repeat(43)),
      },
      {
        name: "delete without session",
        route: "mcp",
        status: 400,
        error: "invalid_request",
        run: () => f.del(token),
      },
      {
        name: "500",
        route: "mcp",
        status: 500,
        error: "server_error",
        run: () => {
          vi.spyOn(
            WebStandardStreamableHTTPServerTransport.prototype,
            "handleRequest",
          ).mockRejectedValueOnce(
            new Error(`CANARY-THROWN ${KDRIVE} ${SECRET} ${token}`),
          );
          return f.mcp(token, INITIALIZE);
        },
      },
    ];
    for (const item of refusals) {
      const before = f.events("request_refused").length;
      const response = await item.run();
      expect(response.status, item.name).toBe(item.status);
      const entries = f.events("request_refused").slice(before);
      expect(
        entries.map((e) => e.fields),
        item.name,
      ).toEqual([
        { route: item.route, status: item.status, error: item.error },
      ]);
    }

    // Responses of the SDK and of an F-010 handler emit no request_refused.
    const before = f.events("request_refused").length;
    const sdk = await f.send("POST", "/mcp", {
      headers: { "content-type": "application/json", ...bearer },
      body: INITIALIZE,
    });
    expect(sdk.status).toBe(406);
    const handler = await f.send("POST", "/mcp/oauth/register", {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(handler.status).toBe(400);
    expect(f.events("request_refused")).toHaveLength(before);

    // Two sessions opened and one deleted; protocol values.
    const date = await f.initialize(token);
    const other = await f.send("POST", "/mcp", {
      headers: f.mcpHeaders(token),
      body: jsonRpc("initialize", 1, {
        protocolVersion: "not-a-date",
        capabilities: {},
        clientInfo: { name: "c", version: "1" },
      }),
    });
    const otherSession = other.headers.get("mcp-session-id") ?? "";
    await f.del(token, otherSession);
    expect(f.events("session_opened").map((e) => e.fields)).toEqual([
      { count: 1, requested_protocol: "2025-06-18" },
      { count: 2, requested_protocol: "other" },
    ]);
    expect(f.events("session_closed").map((e) => e.fields)).toEqual([
      { reason: "deleted", count: 1 },
    ]);
    const tools = await f.mcp(token, jsonRpc("tools/list", 2), date.session);
    expect(tools.headers.get("mcp-session-id")).toBe(date.session);

    expectSecrecy(f, seen, token, [date.session, otherSession]);
    await f.handler.close();
  });

  it("BR-167 v2 BR-323 AC-03 leaks no canary through /healthz and logs no event for its 200", async () => {
    const { f, seen } = await secrecyFixture();
    const token = await f.mint({ sub: IDENTITY });
    const session = await f.open(token);
    const logged = f.logs.length;
    for (const headers of [
      {},
      { authorization: `Bearer ${token}` },
      { authorization: `Bearer ${KDRIVE}` },
      { cookie: `session=${SECRET}` },
      { origin: "https://attacker.example" },
      { "mcp-session-id": session },
    ]) {
      const response = await f.send("GET", "/healthz", { headers });
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(f.logs).toHaveLength(logged);
    const health = seen.filter((entry) => entry.target === "/healthz");
    expect(health).toHaveLength(6);
    for (const entry of health) {
      expect(entry.body).toBe('{"status":"ok"}');
      expect(entry.session).toBeNull();
    }
    const refused = await f.send("PUT", "/healthz");
    await refused.text();
    expect(f.events("request_refused").at(-1)?.fields).toEqual({
      route: "health",
      status: 405,
      error: "method_not_allowed",
    });
    expectSecrecy(f, seen, token, [session]);
    await f.handler.close();
  });

  it("BR-167 AC-17 uses only listed route names", async () => {
    const { f } = await secrecyFixture();
    const names = [
      "mcp",
      "prm",
      "as_metadata",
      "register",
      "authorize",
      "consent",
      "callback",
      "token",
      "health",
      "unknown",
    ];
    const probes: Array<[string, string, string]> = [
      ["GET", "/mcp", "mcp"],
      ["POST", "/.well-known/oauth-protected-resource/mcp", "prm"],
      ["POST", "/.well-known/oauth-authorization-server/mcp", "as_metadata"],
      ["GET", "/mcp/oauth/register", "register"],
      ["POST", "/mcp/oauth/authorize", "authorize"],
      ["GET", "/mcp/oauth/consent", "consent"],
      ["POST", "/mcp/oauth/callback", "callback"],
      ["GET", "/mcp/oauth/token", "token"],
      ["POST", "/healthz", "health"],
      ["GET", "/nothing", "unknown"],
    ];
    for (const [method, path, route] of probes) {
      const before = f.events("request_refused").length;
      await f.send(method, path);
      expect(f.events("request_refused").slice(before)[0]?.fields.route).toBe(
        route,
      );
      expect(names).toContain(route);
    }
    await f.handler.close();
  });
});

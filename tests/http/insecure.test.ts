import { afterEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import {
  INITIALIZE,
  RawClient,
  exchange,
  expectError,
  httpFixture,
  jsonRpc,
  listening,
  rawHeader,
  rawText,
} from "../helpers/http.js";

afterEach(() => vi.restoreAllMocks());

const HOST = "127.0.0.1:3000";

describe("BR-168 insecure loopback mode", () => {
  it("BR-168 BR-025 v2 AC-18 (socket) serves the endpoint without credentials and strips Authorization", async () => {
    const f = await httpFixture({ insecure: true, upstream: null });
    const spy = vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "handleRequest",
    );
    const server = await listening(f);
    try {
      const client = await RawClient.connect(server.port);
      const post = (
        body: string,
        session?: string,
        extra: Array<[string, string]> = [],
      ) => {
        client.write(
          rawText({
            method: "POST",
            target: "/",
            headers: [
              ["Host", HOST],
              ["Content-Type", "application/json"],
              ["Accept", "application/json, text/event-stream"],
              ["Content-Length", String(Buffer.byteLength(body))],
              ...(session
                ? ([["Mcp-Session-Id", session]] as Array<[string, string]>)
                : []),
              ...extra,
            ],
            body,
          }),
        );
      };
      post(INITIALIZE, undefined, [["Authorization", "Bearer IGNORED-TOKEN"]]);
      const init = await client.next();
      expect(init?.status).toBe(200);
      const session = rawHeader(init!, "mcp-session-id")!;
      post(jsonRpc("notifications/initialized", undefined), session);
      expect((await client.next())?.status).toBe(202);
      post(jsonRpc("tools/list", 2), session);
      expect((await client.next())?.body).toContain("kdrive_list_drives");
      post(
        jsonRpc("tools/call", 3, {
          name: "kdrive_info",
          arguments: { file_id: 3 },
        }),
        session,
      );
      expect((await client.next())?.status).toBe(200);
      for (const [request] of spy.mock.calls)
        expect(request.headers.get("authorization")).toBeNull();
      client.destroy();
    } finally {
      await server.close();
    }
  });

  it("BR-168 AC-18 serves no OAuth or metadata path and refuses another Host", async () => {
    const f = await httpFixture({ insecure: true, upstream: null });
    for (const [method, path] of [
      ["GET", "/.well-known/oauth-protected-resource"],
      ["POST", "/oauth/token"],
      ["GET", "/.well-known/oauth-authorization-server"],
    ] as const)
      await expectError(await f.send(method, path), 404, "not_found");
    await expectError(
      await f.send("POST", "/", { host: "evil.test", body: "{}" }),
      403,
      "invalid_host",
    );
    await f.handler.close();
  });

  it("BR-168 BR-161 AC-18 refuses the 121st request in 60 seconds", async () => {
    const f = await httpFixture({ insecure: true, upstream: null });
    for (let i = 0; i < 120; i++)
      await (await f.mcp(undefined, "{}", undefined, {}, "/")).text();
    await expectError(
      await f.mcp(undefined, "{}", undefined, {}, "/"),
      429,
      "rate_limited",
    );
    await f.handler.close();
  });

  it("BR-168 BR-164 AC-18 closes the least recently used session on a ninth", async () => {
    const f = await httpFixture({ insecure: true, upstream: null });
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      f.clock.advance(1000);
      const { response, session } = await f.initialize("", {}, "/");
      await response.text();
      ids.push(session);
    }
    expect(f.events("session_closed").map((e) => e.fields.reason)).toEqual([
      "evicted",
    ]);
    await expectError(
      await f.mcp(undefined, jsonRpc("tools/list", 2), ids[0], {}, "/"),
      404,
      "session_not_found",
    );
    await f.handler.close();
  });

  it("BR-168 v2 BR-322 AC-02 (socket) serves /healthz and still no OAuth or PRM path", async () => {
    const f = await httpFixture({ insecure: true, upstream: null });
    const server = await listening(f);
    try {
      for (const host of [`localhost:${String(server.port)}`, HOST]) {
        const response = await exchange(server.port, {
          target: "/healthz",
          headers: [["Host", host]],
        });
        expect(response?.status).toBe(200);
        expect(response?.body).toBe('{"status":"ok"}');
        expect(rawHeader(response!, "content-type")).toBe("application/json");
      }
      for (const target of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/",
        "/.well-known/oauth-authorization-server",
        "/oauth/register",
        "/oauth/authorize",
        "/oauth/token",
      ]) {
        const response = await exchange(server.port, {
          target,
          headers: [["Host", HOST]],
        });
        expect(response?.status).toBe(404);
        expect(response?.body).toBe('{"error":"not_found"}');
      }
    } finally {
      await server.close();
    }
    await f.handler.close();
  });

  it("BR-168 AC-18 serves the endpoint at the path of an explicit public URL", async () => {
    const f = await httpFixture({
      insecure: true,
      upstream: null,
      env: { MCP_PUBLIC_URL: "http://127.0.0.1:3000/mcp" },
    });
    const ok = await f.mcp(undefined, INITIALIZE, undefined, {}, "/mcp");
    expect(ok.status).toBe(200);
    await ok.text();
    await expectError(
      await f.mcp(undefined, INITIALIZE, undefined, {}, "/"),
      404,
      "not_found",
    );
    const origin = await f.mcp(
      undefined,
      INITIALIZE,
      undefined,
      { origin: "http://localhost:3000" },
      "/mcp",
    );
    expect(origin.status).toBe(200);
    await origin.text();
    await expectError(
      await f.mcp(
        undefined,
        INITIALIZE,
        undefined,
        { origin: "http://evil.test" },
        "/mcp",
      ),
      403,
      "invalid_origin",
    );
    await f.handler.close();
  });
});

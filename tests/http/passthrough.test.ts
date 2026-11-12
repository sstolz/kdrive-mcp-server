import { afterEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { bodyJson, httpFixture, jsonRpc, oauthLogin } from "../helpers/http.js";

afterEach(() => vi.restoreAllMocks());

describe("BR-166 no client credential reaches the server", () => {
  it("BR-166 AC-16 strips Authorization and Cookie and passes no authInfo", async () => {
    const f = await httpFixture();
    const login = await oauthLogin(f);
    const token = login.accessToken;
    const spy = vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "handleRequest",
    );
    const upstreamCalls = f.upstream!.calls.length;
    const session = await f.open(token);
    const extra = { cookie: "__Host-kdrive-oauth=CANARY-COOKIE" };
    const list = await f.mcp(token, jsonRpc("tools/list", 2), session, extra);
    expect(list.status).toBe(200);
    await list.text();
    const call = await f.call(token, session, "kdrive_info", { file_id: 3 });
    expect(call.status).toBe(200);
    expect(JSON.stringify(await bodyJson(call))).toContain("result");
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    for (const [request, options] of spy.mock.calls) {
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
      expect(
        (options as { authInfo?: unknown } | undefined)?.authInfo,
      ).toBeUndefined();
      expect(JSON.stringify([...request.headers])).not.toContain(token);
    }
    const toolCalls = JSON.stringify([
      f.navigation.inspect.mock.calls,
      f.navigation.collection.mock.calls,
      f.navigation.execute.mock.calls,
      f.navigation.children.mock.calls,
    ]);
    expect(f.navigation.inspect).toHaveBeenCalled();
    expect(toolCalls).not.toContain(token);
    expect(f.upstream!.calls).toHaveLength(upstreamCalls);
    await f.handler.close();
  });
});

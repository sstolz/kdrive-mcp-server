import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { createNavigationServer } from "../../src/navigation.js";
import {
  INITIALIZE,
  blockedDependencies,
  bodyJson,
  exchange,
  expectError,
  holdNextHandle,
  httpFixture,
  jsonRpc,
  listening,
  type Fixture,
} from "../helpers/http.js";
import { navigationFixture } from "../helpers/navigation.js";

vi.mock("../../src/navigation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/navigation.js")>();
  return {
    ...actual,
    createNavigationServer: vi.fn(actual.createNavigationServer),
  };
});

const transportClose = () =>
  vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
const serverClose = () => vi.spyOn(McpServer.prototype, "close");

beforeEach(() => {
  vi.mocked(createNavigationServer).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SESSION = /^[A-Za-z0-9_-]{43}$/u;
const sessionClosed = (f: Fixture) =>
  f.events("session_closed").map((e) => e.fields);
const second = async (f: Fixture, seconds = 1) => {
  f.clock.advance(seconds * 1000);
  return await f.mint();
};

describe("BR-163 sessions", () => {
  it("BR-163 AC-12 initializes with JSON, a 43-character ID and a stable server", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const { response, session } = await f.initialize(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(session).toMatch(SESSION);
    await response.text();
    const initialized = await f.mcp(
      token,
      jsonRpc("notifications/initialized", undefined),
      session,
    );
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe("");
    expect(initialized.headers.get("content-type")).toBeNull();
    const list = await f.mcp(token, jsonRpc("tools/list", 2), session);
    expect(list.status).toBe(200);
    expect(list.headers.get("mcp-session-id")).toBe(session);
    expect(JSON.stringify(await bodyJson(list))).toContain(
      "kdrive_list_drives",
    );
    expect(vi.mocked(createNavigationServer)).toHaveBeenCalledTimes(1);
    await f.handler.close();
  });

  it("BR-163 AC-12 refuses a sessionless request that is not initialize, including server/discover", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    for (const body of [
      jsonRpc("tools/list", 1),
      jsonRpc("server/discover", 1),
      jsonRpc("initialize", undefined),
    ]) {
      const response = await f.mcp(token, body);
      await expectError(response, 400, "invalid_request");
    }
    expect(f.events("session_opened")).toEqual([]);
    expect(vi.mocked(createNavigationServer)).not.toHaveBeenCalled();
    await f.handler.close();
  });

  it("BR-163 AC-12 closes the transport and the server of an initialize the SDK rejects", async () => {
    const f = await httpFixture();
    const transport = transportClose();
    const server = serverClose();
    const bad = JSON.stringify({
      jsonrpc: "1.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const response = await f.mcp(await f.mint(), bad);
    expect(response.status).toBe(400);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    await response.text();
    expect(f.events("session_opened")).toEqual([]);
    expect(transport).toHaveBeenCalled();
    expect(server).toHaveBeenCalled();
    await f.handler.close();
  });

  it("BR-163 AC-12 answers one 404 for unknown, malformed and foreign session IDs", async () => {
    const f = await httpFixture({
      env: { OAUTH_ALLOWED_SUBJECTS: "user-1,user-2" },
    });
    const a = await f.mint({ sub: "user-1" });
    const b = await f.mint({ sub: "user-2" });
    const session = await f.open(a);
    const cases: Array<[string, string]> = [
      [a, "A".repeat(43)],
      [a, "short"],
      [a, `${session}, ${session}`],
      [b, session],
    ];
    const bodies = new Set<string>();
    for (const [token, id] of cases) {
      const response = await f.mcp(token, jsonRpc("tools/list", 2), id);
      expect(response.status).toBe(404);
      bodies.add(await response.text());
    }
    expect(bodies).toEqual(new Set(['{"error":"session_not_found"}']));
    await f.handler.close();
  });

  it("BR-163 AC-12 (socket) answers 404 for a repeated Mcp-Session-Id header", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const session = await f.open(token);
    const server = await listening(f);
    try {
      const response = await exchange(server.port, {
        method: "POST",
        target: "/mcp",
        headers: [
          ["Host", "mcp.test"],
          ["Authorization", `Bearer ${token}`],
          ["Content-Type", "application/json"],
          ["Accept", "application/json, text/event-stream"],
          ["Mcp-Session-Id", session],
          ["Mcp-Session-Id", session],
          ["Content-Length", String(jsonRpc("tools/list", 2).length)],
        ],
        body: jsonRpc("tools/list", 2),
      });
      expect(response?.status).toBe(404);
      expect(response?.body).toBe('{"error":"session_not_found"}');
    } finally {
      await server.close();
      await f.handler.close();
    }
  });

  it("BR-163 AC-12 AC-13 answers DELETE rules and keeps other identities out", async () => {
    const f = await httpFixture({
      env: { OAUTH_ALLOWED_SUBJECTS: "user-1,user-2" },
    });
    const a = await f.mint({ sub: "user-1" });
    const b = await f.mint({ sub: "user-2" });
    const session = await f.open(a);
    await expectError(await f.del(a), 400, "invalid_request");
    expect((await f.mcp(a, jsonRpc("tools/list", 2), session)).status).toBe(
      200,
    );
    await expectError(await f.del(b, session), 404, "session_not_found");
    expect((await f.mcp(a, jsonRpc("tools/list", 3), session)).status).toBe(
      200,
    );
    const deleted = await f.del(a, session);
    expect(deleted.status).toBe(200);
    await expectError(
      await f.mcp(a, jsonRpc("tools/list", 4), session),
      404,
      "session_not_found",
    );
    expect(sessionClosed(f)).toEqual([{ reason: "deleted", count: 0 }]);
    await f.handler.close();
  });

  it("BR-163 AC-12 answers SDK errors for a request that reaches the transport", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const response = await f.send("POST", "/mcp", {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: INITIALIZE,
    });
    expect(response.status).toBe(406);
    await f.handler.close();
  });
});

describe("BR-164 session bounds", () => {
  it("BR-164 AC-14 closes a session after 1,800 idle seconds, not 1,799", async () => {
    const usable = await httpFixture();
    const session = await usable.open(await usable.mint());
    const ok = await usable.mcp(
      await second(usable, 1799),
      jsonRpc("tools/list", 2),
      session,
    );
    expect(ok.status).toBe(200);
    await usable.handler.close();

    const f = await httpFixture();
    const transport = transportClose();
    const server = serverClose();
    const id = await f.open(await f.mint());
    const gone = await f.mcp(
      await second(f, 1800),
      jsonRpc("tools/list", 2),
      id,
    );
    await expectError(gone, 404, "session_not_found");
    expect(sessionClosed(f)).toEqual([{ reason: "idle", count: 0 }]);
    expect(transport).toHaveBeenCalled();
    expect(server).toHaveBeenCalled();
    await f.handler.close();
  });

  it("BR-164 AC-14 closes a session 86,400 seconds after creation however often used", async () => {
    const f = await httpFixture();
    const id = await f.open(await f.mint());
    for (let i = 0; i < 86; i++) {
      const ok = await f.mcp(
        await second(f, 1000),
        jsonRpc("tools/list", 2 + i),
        id,
      );
      expect(ok.status).toBe(200);
      await ok.text();
    }
    const gone = await f.mcp(
      await second(f, 400),
      jsonRpc("tools/list", 99),
      id,
    );
    await expectError(gone, 404, "session_not_found");
    expect(sessionClosed(f)).toEqual([{ reason: "lifetime", count: 0 }]);
    await f.handler.close();
  });

  it("BR-164 AC-14 closes the least recently used session of an identity on the ninth", async () => {
    const f = await httpFixture();
    const transport = transportClose();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await f.open(await second(f)));
    const touched = await f.mcp(
      await second(f),
      jsonRpc("tools/list", 2),
      ids[0],
    );
    expect(touched.status).toBe(200);
    await touched.text();
    ids.push(await f.open(await second(f)));
    // BR-167: opened then evicted, both with the net registered count (8).
    expect(
      f.logs.filter((e) => e.name.startsWith("session_")).slice(-2),
    ).toEqual([
      {
        name: "session_opened",
        fields: { count: 8, requested_protocol: "2025-06-18" },
      },
      { name: "session_closed", fields: { reason: "evicted", count: 8 } },
    ]);
    expect(transport).toHaveBeenCalled();
    await expectError(
      await f.mcp(await second(f), jsonRpc("tools/list", 3), ids[1]),
      404,
      "session_not_found",
    );
    expect(
      (await f.mcp(await second(f), jsonRpc("tools/list", 3), ids[0])).status,
    ).toBe(200);
    const opened = f.events("session_opened").map((e) => e.fields.count);
    expect(opened).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);
    await f.handler.close();
  });

  const subjects = Array.from({ length: 8 }, (_, i) => `u${String(i)}`);

  async function fill() {
    const f = await httpFixture({
      env: { OAUTH_ALLOWED_SUBJECTS: subjects.join(",") },
    });
    for (const sub of subjects)
      for (let n = 0; n < 8; n++) await f.open(await f.mint({ sub }));
    return f;
  }

  it("BR-164 AC-14 answers 503 with Retry-After 60 for the 65th initialize without creating anything", async () => {
    const f = await fill();
    expect(f.events("session_opened")).toHaveLength(64);
    const before = vi.mocked(createNavigationServer).mock.calls.length;
    const response = await f.mcp(await f.mint({ sub: "u0" }), INITIALIZE);
    expect(response.headers.get("retry-after")).toBe("60");
    await expectError(response, 503, "temporarily_unavailable");
    expect(vi.mocked(createNavigationServer).mock.calls).toHaveLength(before);
    await f.handler.close();
  });

  it("BR-164 AC-14 counts a creation in progress toward the 64 sessions", async () => {
    const f = await httpFixture({
      env: { OAUTH_ALLOWED_SUBJECTS: subjects.join(",") },
    });
    for (const sub of subjects.slice(0, 7))
      for (let n = 0; n < 8; n++) await f.open(await f.mint({ sub }));
    for (let n = 0; n < 7; n++) await f.open(await f.mint({ sub: "u7" }));
    expect(f.events("session_opened")).toHaveLength(63);
    const hold = holdNextHandle();
    const first = f.mcp(await f.mint({ sub: "u7" }), INITIALIZE);
    await vi.waitFor(() => {
      expect(vi.mocked(createNavigationServer).mock.calls).toHaveLength(64);
    });
    await expectError(
      await f.mcp(await f.mint({ sub: "u0" }), INITIALIZE),
      503,
      "temporarily_unavailable",
    );
    hold.release();
    expect((await first).status).toBe(200);
    expect(f.events("session_opened").at(-1)?.fields.count).toBe(64);
    await expectError(
      await f.mcp(await f.mint({ sub: "u0" }), INITIALIZE),
      503,
      "temporarily_unavailable",
    );
    await f.handler.close();
  });

  it.each(["deleted", "idle", "evicted"] as const)(
    "BR-164 AC-14 settles a held tool call with 503 when its session closes by %s",
    async (reason) => {
      const base = await navigationFixture();
      const { held, dependencies } = blockedDependencies(base.dependencies);
      const f = await httpFixture({ dependencies });
      const token = await f.mint();
      const session = await f.open(token);
      const call = f.call(token, session, "kdrive_info", { file_id: 3 });
      await vi.waitFor(() => {
        expect(held.entered()).toBe(1);
      });
      if (reason === "deleted")
        expect((await f.del(token, session)).status).toBe(200);
      else if (reason === "idle") {
        f.clock.advance(1_800_000);
        await f.open(await f.mint());
      } else for (let i = 0; i < 8; i++) await f.open(await second(f));
      const response = await call;
      expect(response.headers.get("retry-after")).toBeNull();
      await expectError(response, 503, "temporarily_unavailable");
      const refusals = f
        .events("request_refused")
        .filter((e) => e.fields.status === 503);
      expect(refusals).toHaveLength(1);
      expect(f.events("session_closed").map((e) => e.fields.reason)).toContain(
        reason,
      );
      held.release();
      await f.handler.close();
    },
  );
});

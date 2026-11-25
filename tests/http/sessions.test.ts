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

// ---- F-053: initialize failures and held DELETEs (BR-164 v2, BR-167 v4) ----

const TIMEOUT = Symbol("timeout");

/** Bounded wait: the work's value, or TIMEOUT well below the Vitest timeout. */
async function within<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => {
          resolve(TIMEOUT);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const transportProto = WebStandardStreamableHTTPServerTransport.prototype;
const originalHandle = Reflect.get(transportProto, "handleRequest");

/**
 * Runs the next transport `handleRequest` for real, records the session ID
 * the SDK registered and the SDK's own status, then throws when `fail`.
 */
function captureInitialize(fail: boolean) {
  const ids: Array<string | undefined> = [];
  const statuses: number[] = [];
  vi.spyOn(transportProto, "handleRequest").mockImplementationOnce(
    async function (
      this: WebStandardStreamableHTTPServerTransport,
      ...args: Parameters<typeof transportProto.handleRequest>
    ) {
      const response = await originalHandle.apply(this, args);
      ids.push(this.sessionId);
      statuses.push(response.status);
      if (fail) throw new Error("synthetic transport failure");
      return response;
    },
  );
  return { ids, statuses };
}

/** Holds the next transport call (the DELETE), then answers it 200. */
function holdDelete() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(transportProto, "handleRequest")
    .mockImplementationOnce(async () => {
      await opened;
      return new Response(null, { status: 200 });
    });
  return { release, spy };
}

const sessionEvents = (f: Fixture) =>
  f.logs
    .filter((e) =>
      ["session_opened", "session_closed", "request_refused"].includes(e.name),
    )
    .map((e) => e.name);

async function expectGoneSession(f: Fixture, token: string, id?: string) {
  expect(id).toMatch(SESSION);
  await expectError(
    await f.mcp(token, jsonRpc("tools/list", 2), id),
    404,
    "session_not_found",
  );
}

describe("F-053 BR-164 v2 initialize failures and held DELETEs", () => {
  it("BR-164 v2 BR-167 v4 AC-01 closes a registered session when initialize handling throws", async () => {
    const f = await httpFixture();
    const transport = transportClose();
    const server = serverClose();
    const token = await f.mint();
    const captured = captureInitialize(true);
    const response = await f.mcp(token, INITIALIZE);
    await expectError(response, 500, "server_error");
    expect(captured.ids).toHaveLength(1);
    // BR-164 v2: the session is closed before the router answers.
    expect(sessionEvents(f)).toEqual([
      "session_opened",
      "session_closed",
      "request_refused",
    ]);
    expect(sessionClosed(f)).toEqual([
      { reason: "initialize_failed", count: 0 },
    ]);
    expect(f.events("request_refused").map((e) => e.fields)).toEqual([
      { route: "mcp", status: 500, error: "server_error" },
    ]);
    expect(transport).toHaveBeenCalled();
    expect(server).toHaveBeenCalled();
    await expectGoneSession(f, token, captured.ids[0]);
    // The failed session holds no per-identity slot: eight more evict nothing.
    for (let i = 0; i < 8; i++) await f.open(await second(f));
    expect(sessionClosed(f).map((e) => e.reason)).toEqual([
      "initialize_failed",
    ]);
    expect(f.events("session_opened").at(-1)?.fields.count).toBe(8);
    await f.handler.close();
  });

  it("BR-164 v2 AC-01 closes a registered session when the SDK answers initialize with a non-2xx status", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const scope = vi
      .spyOn(
        transportProto as unknown as { _checkScopeChallenge: () => unknown },
        "_checkScopeChallenge",
      )
      .mockImplementationOnce(() => {
        throw new Error("synthetic scope failure");
      });
    const captured = captureInitialize(false);
    const response = await f.mcp(token, INITIALIZE);
    expect(scope).toHaveBeenCalled();
    // The SDK answered its own 500 after registration (D-6).
    expect(captured.statuses).toEqual([500]);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    // The SDK body is discarded: only the BR-167 body is sent.
    await expectError(response, 500, "server_error");
    expect(sessionClosed(f)).toEqual([
      { reason: "initialize_failed", count: 0 },
    ]);
    await expectGoneSession(f, token, captured.ids[0]);
    await f.handler.close();
  });

  it("BR-164 v2 AC-02 a failed initialize frees its process slot", async () => {
    const subjects = Array.from({ length: 8 }, (_, i) => `u${String(i)}`);
    const f = await httpFixture({
      env: { OAUTH_ALLOWED_SUBJECTS: subjects.join(",") },
    });
    captureInitialize(true);
    await expectError(
      await f.mcp(await f.mint({ sub: "u7" }), INITIALIZE),
      500,
      "server_error",
    );
    for (const sub of subjects.slice(0, 7))
      for (let n = 0; n < 8; n++) await f.open(await f.mint({ sub }));
    for (let n = 0; n < 7; n++) await f.open(await f.mint({ sub: "u7" }));
    // 64 initialize calls registered a session; one of them failed.
    expect(f.events("session_opened")).toHaveLength(64);
    const admitted = await f.mcp(await f.mint({ sub: "u7" }), INITIALIZE);
    expect(admitted.status).toBe(200);
    await admitted.text();
    expect(f.events("session_opened").at(-1)?.fields.count).toBe(64);
    await f.handler.close();
  });

  const closers = [
    { reason: "evicted" },
    { reason: "idle" },
    { reason: "shutdown" },
  ] as const;

  async function closeFor(
    f: Fixture,
    reason: (typeof closers)[number]["reason"],
  ): Promise<void> {
    if (reason === "evicted")
      for (let i = 0; i < 8; i++) await f.open(await second(f));
    else if (reason === "idle") {
      f.clock.advance(1_800_000);
      await f.open(await f.mint());
    } else await f.handler.close();
  }

  it.each(closers)(
    "BR-164 v2 AC-03 settles a held DELETE when its session closes for another reason ($reason)",
    async ({ reason }) => {
      const f = await httpFixture();
      const token = await f.mint();
      const session = await f.open(token);
      const hold = holdDelete();
      const deleting = f.del(token, session);
      await vi.waitFor(() => {
        expect(hold.spy).toHaveBeenCalled();
      });
      await closeFor(f, reason);
      // Answered while the transport still holds the DELETE.
      const response = await within(deleting, 1000);
      expect(response).not.toBe(TIMEOUT);
      if (response === TIMEOUT) return;
      expect(response.headers.get("retry-after")).toBeNull();
      await expectError(response, 503, "temporarily_unavailable");
      const closed = () => sessionClosed(f).map((e) => e.reason);
      expect(closed()).toEqual([reason]);
      // The transport then answers 200: nothing is closed a second time.
      hold.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed()).toEqual([reason]);
      await f.handler.close();
    },
  );
});

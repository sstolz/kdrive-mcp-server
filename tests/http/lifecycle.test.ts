import { EventEmitter } from "node:events";
import http from "node:http";
import { Readable } from "node:stream";
import { createConnection } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHttpHandler,
  createHttpServer,
  startHttpServer,
} from "../../src/http/index.js";
import { recordingPort, stateOptions } from "../helpers/http-state.js";
import { kdriveFixture } from "../helpers/kdrive.js";
import { runMain, tokenFile } from "../helpers/main.js";
import {
  CLAUDE,
  UPSTREAM,
  UPSTREAM_CLIENT,
  removeStateFiles,
  stateFile,
  syntheticPem,
} from "../helpers/proxy.js";
import { childOpen } from "../helpers/state-child.js";
import {
  HOST,
  INITIALIZE,
  P,
  SYNTHETIC_PLACEHOLDER,
  bodyJson,
  listeningPort,
  oauthLogin,
  RawClient,
  blockedDependencies,
  exchange,
  expectError,
  holdNextHandle,
  httpFixture,
  jsonRpc,
  listening,
  rawHeader,
  rawText,
} from "../helpers/http.js";
import { navigationFixture } from "../helpers/navigation.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeStateFiles();
});

const post = (token: string, body: string, session?: string) =>
  rawText({
    method: "POST",
    target: "/mcp",
    headers: [
      ["Host", HOST],
      ["Authorization", `Bearer ${token}`],
      ["Content-Type", "application/json"],
      ["Accept", "application/json, text/event-stream"],
      ["Content-Length", String(Buffer.byteLength(body))],
      ...(session
        ? ([["Mcp-Session-Id", session]] as Array<[string, string]>)
        : []),
    ],
    body,
  });

describe("BR-169 server settings and shutdown", () => {
  it("BR-169 AC-19 applies the fixed server settings", async () => {
    const f = await httpFixture();
    const spy = vi.spyOn(http, "createServer");
    const created = createHttpServer(f.handlerOptions);
    const { server } = created;
    expect(spy.mock.calls[0]?.[0]).toEqual({
      requireHostHeader: false,
      headersTimeout: 10_000,
      requestTimeout: 30_000,
      keepAliveTimeout: 5000,
      maxHeaderSize: 16_384,
    });
    expect(server.headersTimeout).toBe(10_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.keepAliveTimeout).toBe(5000);
    expect(server.maxConnections).toBe(256);
    await created.close();
  });

  it("BR-169 AC-19 (socket) answers 414 for an 8,193-byte target and accepts 8,192", async () => {
    const f = await httpFixture();
    const server = await listening(f);
    try {
      const long = await exchange(server.port, {
        target: `/${"a".repeat(8192)}`,
        headers: [["Host", HOST]],
      });
      expect(long?.status).toBe(414);
      expect(long?.body).toBe('{"error":"invalid_request"}');
      const ok = await exchange(server.port, {
        target: `/${"a".repeat(8191)}`,
        headers: [["Host", HOST]],
      });
      expect(ok?.status).toBe(404);
      const bad = await exchange(server.port, {
        target: `/${"a".repeat(8192)}`,
        headers: [["Host", "evil.test"]],
      });
      expect(bad?.status).toBe(414);
    } finally {
      await server.close();
    }
  });

  it("BR-169 AC-19 close() closes sessions with reason shutdown and stops accepting", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const server = await listening(f);
    const client = await RawClient.connect(server.port);
    for (let i = 0; i < 2; i++) {
      client.write(post(token, INITIALIZE));
      expect((await client.next())?.status).toBe(200);
    }
    client.destroy();
    await server.close();
    expect(f.events("session_closed").map((e) => e.fields)).toEqual([
      { reason: "shutdown", count: 1 },
      { reason: "shutdown", count: 0 },
    ]);
    const refused = await new Promise<boolean>((resolve) => {
      const probe = createConnection({ port: server.port, host: "127.0.0.1" });
      probe.once("connect", () => {
        probe.destroy();
        resolve(false);
      });
      probe.once("error", () => {
        resolve(true);
      });
    });
    expect(refused).toBe(true);
  });

  it("BR-164 BR-169 AC-19 (socket) writes a complete 503 before ending a held keep-alive connection", async () => {
    const base = await navigationFixture();
    const { held, dependencies } = blockedDependencies(base.dependencies);
    const f = await httpFixture({ dependencies });
    const token = await f.mint();
    const server = await listening(f);
    const client = await RawClient.connect(server.port);
    client.write(post(token, INITIALIZE));
    const init = await client.next();
    const session = rawHeader(init!, "mcp-session-id")!;
    client.write(
      post(token, jsonRpc("notifications/initialized", undefined), session),
    );
    expect((await client.next())?.status).toBe(202);
    client.write(
      post(
        token,
        jsonRpc("tools/call", 3, {
          name: "kdrive_info",
          arguments: { file_id: 3 },
        }),
        session,
      ),
    );
    await vi.waitFor(() => {
      expect(held.entered()).toBe(1);
    });
    await server.close();
    const response = await client.next();
    expect(response?.status).toBe(503);
    expect(response?.body).toBe('{"error":"temporarily_unavailable"}');
    expect(await client.waitClosed()).toBe(true);
    held.release();
    expect(
      f.events("request_refused").filter((e) => e.fields.status === 503),
    ).toHaveLength(1);
  });

  it("BR-169 AC-19 resolves close() after 1,000 ms when a settled response is never written", async () => {
    const base = await navigationFixture();
    const { held, dependencies } = blockedDependencies(base.dependencies);
    const f = await httpFixture({ dependencies });
    const token = await f.mint();
    const server = await listening(f);
    const client = await RawClient.connect(server.port);
    client.write(post(token, INITIALIZE));
    const session = rawHeader((await client.next())!, "mcp-session-id")!;
    client.write(
      post(token, jsonRpc("notifications/initialized", undefined), session),
    );
    await client.next();

    const body = Buffer.from(
      jsonRpc("tools/call", 3, {
        name: "kdrive_info",
        arguments: { file_id: 3 },
      }),
    );
    const req = Object.assign(Readable.from([body]), {
      method: "POST",
      url: "/mcp",
      httpVersion: "1.1",
      complete: true,
      rawHeaders: [
        "Host",
        HOST,
        "Authorization",
        `Bearer ${token}`,
        "Content-Type",
        "application/json",
        "Accept",
        "application/json, text/event-stream",
        "Content-Length",
        String(body.length),
        "Mcp-Session-Id",
        session,
      ],
      socket: { destroy: vi.fn(), end: vi.fn() },
    });
    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    server.server.emit("request", req, res);
    await vi.waitFor(() => {
      expect(held.entered()).toBe(1);
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let resolved = false;
    const closing = server.close().then(() => {
      resolved = true;
    });
    // Let the close sequence reach its bounded wait (setImmediate is real).
    for (let i = 0; i < 200 && vi.getTimerCount() === 0; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(res.writeHead.mock.calls[0]?.[0]).toBe(503);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(resolved).toBe(true);
    held.release();
    client.destroy();
  });

  it("BR-169 AC-19 answers 503 after close() started and creates no transport", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const transport = vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "handleRequest",
    );
    await f.handler.close();
    const response = await f.mcp(token, INITIALIZE);
    expect(response.headers.get("retry-after")).toBeNull();
    await expectError(response, 503, "temporarily_unavailable");
    expect(transport).not.toHaveBeenCalled();
    await expectError(
      await f.send("GET", "/.well-known/oauth-protected-resource/mcp"),
      503,
      "temporarily_unavailable",
    );
    await f.handler.close();
  });

  it("BR-169 AC-19 registers no session for an initialize in flight when close() starts", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const hold = holdNextHandle();
    const pending = f.mcp(token, INITIALIZE);
    await vi.waitFor(() => {
      expect(hold.spy).toHaveBeenCalled();
    });
    const closing = f.handler.close();
    hold.release();
    await closing;
    await expectError(await pending, 503, "temporarily_unavailable");
    expect(f.events("session_opened")).toEqual([]);
  });
});

describe("BR-304 BR-169 v2 OAuth state store lifecycle (AC-13)", () => {
  async function listen(server: ReturnType<typeof createHttpServer>) {
    await new Promise<void>((resolve, reject) => {
      server.server.once("error", reject);
      server.server.listen(0, "127.0.0.1", resolve);
    });
  }

  it("BR-304 BR-169 v2 AC-13 the server closes the store once, after the listener and before close() resolves", async () => {
    const path = stateFile();
    const events: string[] = [];
    const recorded = recordingPort(events);
    const { handlerOptions } = await stateOptions(path, {
      port: recorded.port,
    });
    const created = createHttpServer(handlerOptions);
    await listen(created);
    created.server.on("close", () => events.push("listener-closed"));
    await created.close();
    events.push("close-resolved");
    expect(events).toEqual([
      "listener-closed",
      "store-closed",
      "close-resolved",
    ]);
    await created.close();
    expect(recorded.closes()).toBe(1);
    expect(await childOpen(path)).toMatch(/^open /u);
  });

  it("BR-304 AC-13 the handler's close() leaves the store open; closeStore() closes it once", async () => {
    const path = stateFile();
    const recorded = recordingPort([]);
    const { handlerOptions } = await stateOptions(path, {
      port: recorded.port,
    });
    const handler = createHttpHandler(handlerOptions);
    await handler.close();
    expect(recorded.closes()).toBe(0);
    handler.closeStore();
    handler.closeStore();
    expect(recorded.closes()).toBe(1);
  });

  it("BR-210 BR-304 AC-13 SIGTERM shutdown of the main entry releases the state file", async () => {
    const path = stateFile();
    const f = await kdriveFixture();
    try {
      const directory = await mkdtemp(join(tmpdir(), "kdrive-state-main-"));
      await writeFile(join(directory, "upstream-secret"), "SYNTHETIC-SECRET\n");
      await writeFile(join(directory, "signing.pem"), syntheticPem());
      const run = await runMain({
        argv: ["--http"],
        env: {
          KDRIVE_ID: "101",
          KDRIVE_TOKEN_FILE: tokenFile(),
          MCP_HTTP_HOST: "127.0.0.1",
          MCP_HTTP_PORT: String(await listeningPort()),
          MCP_PUBLIC_URL: P,
          OAUTH_MODE: "proxy",
          OAUTH_ISSUER: UPSTREAM,
          OAUTH_ALLOWED_SUBJECTS: "user-1",
          OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
          OAUTH_UPSTREAM_CLIENT_SECRET_FILE: join(directory, "upstream-secret"),
          OAUTH_SIGNING_KEY_FILE: join(directory, "signing.pem"),
          OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
          OAUTH_STATE_FILE: path,
        },
        lookup: f.lookup,
        connect: f.connect,
      });
      expect(run.exits).toEqual([]);
      expect(await childOpen(path)).toBe("OAUTH_STATE_LOCKED");
      run.signals.emit("SIGTERM");
      for (let i = 0; i < 2000 && run.exits.length === 0; i++)
        await new Promise((r) => setImmediate(r));
      expect(run.exits).toEqual([0]);
      expect(await childOpen(path)).toMatch(/^open /u);
    } finally {
      await f.close();
    }
  });

  it("BR-299 BR-304 AC-13 a token request resumed after the store closed gets 503 without an event", async () => {
    const path = stateFile();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const f = await httpFixture({ env: { OAUTH_STATE_FILE: path } });
      const login = await oauthLogin(f);
      let release!: () => void;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            controller.enqueue(
              new TextEncoder().encode(
                new URLSearchParams({
                  grant_type: "refresh_token",
                  refresh_token: login.refreshToken ?? "",
                  client_id: login.clientId,
                }).toString(),
              ),
            );
            controller.close();
          };
        },
      });
      const request = new Request(SYNTHETIC_PLACEHOLDER, {
        method: "POST",
        headers: {
          host: HOST,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        duplex: "half",
      } as RequestInit);
      const pending = f.handler.handle(request, "/mcp/oauth/token");
      await f.handler.close();
      f.handler.closeStore();
      release();
      const response = await pending;
      expect(response.status).toBe(503);
      const data = await bodyJson(response);
      expect(data).toEqual({ error: "temporarily_unavailable" });
      expect(f.events("store_write_failed")).toEqual([]);
      expect(await childOpen(path)).toMatch(/^open /u);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("BR-304 AC-13 LISTEN_FAILED closes the store once", async () => {
    const path = stateFile();
    const busy = createNetServer();
    await new Promise<void>((resolve) => busy.listen(0, "127.0.0.1", resolve));
    const port = (busy.address() as AddressInfo).port;
    try {
      const recorded = recordingPort([]);
      const { handlerOptions } = await stateOptions(path, {
        port: recorded.port,
        env: { MCP_HTTP_HOST: "127.0.0.1", MCP_HTTP_PORT: String(port) },
      });
      await expect(startHttpServer(handlerOptions)).rejects.toMatchObject({
        code: "LISTEN_FAILED",
      });
      expect(recorded.closes()).toBe(1);
      expect(await childOpen(path)).toMatch(/^open /u);
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });

  it("BR-304 AC-13 a throwing proxy construction closes the store before the error leaves", async () => {
    const path = stateFile();
    const recorded = recordingPort([]);
    const { handlerOptions } = await stateOptions(path, {
      port: recorded.port,
      keyBytes: new TextEncoder().encode("not a signing key"),
    });
    const listen = vi.fn();
    await expect(
      startHttpServer({ ...handlerOptions, listen }),
    ).rejects.toThrow();
    expect(listen).not.toHaveBeenCalled();
    expect(recorded.closes()).toBe(1);
    expect(await childOpen(path)).toMatch(/^open /u);
  });

  it("BR-304 BR-169 v2 AC-13 a throwing store close still lets close() resolve", async () => {
    const path = stateFile();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const recorded = recordingPort([], { throwOnClose: true });
      const { handlerOptions } = await stateOptions(path, {
        port: recorded.port,
      });
      const created = createHttpServer(handlerOptions);
      await listen(created);
      await expect(created.close()).resolves.toBeUndefined();
      await created.close();
      expect(recorded.closes()).toBe(1);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(await childOpen(path)).toMatch(/^open /u);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

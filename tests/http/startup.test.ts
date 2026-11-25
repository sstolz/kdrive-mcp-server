import http, { type Server } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi, type MockInstance } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../../src/config.js";
import {
  HttpStartupError,
  createHttpHandler,
  startHttpServer,
  type HttpHandlerOptions,
} from "../../src/http/index.js";
import { navigationFixture } from "../helpers/navigation.js";
import {
  Clock,
  FakeUpstream,
  UPSTREAM_SECRET,
  counterRandom,
} from "../helpers/proxy.js";
import {
  HOST,
  INITIALIZE,
  configurationFor,
  exchange,
  httpFixture,
  listeningPort,
  type LoggedEvent,
} from "../helpers/http.js";

const address = (host: string, port: number): AddressInfo => ({
  address: host,
  family: "IPv4",
  port,
});

async function optionsFor(
  settings: Parameters<typeof configurationFor>[0] & {
    upstream?: boolean;
  } = {},
): Promise<HttpHandlerOptions> {
  const navigation = await navigationFixture();
  return {
    configuration: await configurationFor(settings),
    dependencies: navigation.dependencies,
    ...(settings.upstream === false ? {} : { upstream: new FakeUpstream() }),
    clock: new Clock().now,
    randomBytes: counterRandom(),
  };
}

async function expectRefusal(options: HttpHandlerOptions, code: string) {
  const attempt = () => createHttpHandler(options);
  expect(attempt).toThrow(HttpStartupError);
  try {
    attempt();
  } catch (error) {
    expect((error as HttpStartupError).code).toBe(code);
    const text = (error as HttpStartupError).message;
    for (const value of ["mcp.test", "idp.test", UPSTREAM_SECRET, "/synthetic"])
      expect(text).not.toContain(value);
  }
  const listen = vi.fn();
  await expect(startHttpServer({ ...options, listen })).rejects.toMatchObject({
    code,
  });
  expect(listen).not.toHaveBeenCalled();
}

describe("BR-152 startup validation", () => {
  it("BR-152 AC-01 refuses a stdio configuration and an unresolved object", async () => {
    const options = await optionsFor();
    const local = await loadConfiguration({
      argv: [],
      env: { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC" },
    });
    const stdio = await preflightConfiguration(local, {
      inspectDrive: async (id) => await Promise.resolve({ id, role: "admin" }),
      resolveDirectory: async (driveId) =>
        await Promise.resolve({ driveId, id: 1, type: "dir" }),
    });
    await expectRefusal(
      { ...options, configuration: stdio },
      "CONFIGURATION_UNSUPPORTED",
    );
    await expectRefusal(
      { ...options, configuration: { ...options.configuration } },
      "CONFIGURATION_UNSUPPORTED",
    );
    await expectRefusal(
      { ...options, configuration: {} as never },
      "CONFIGURATION_UNSUPPORTED",
    );
  });

  it("BR-152 AC-01 refuses a resolved configuration that lacks a proxy field", async () => {
    const options = await optionsFor();
    const local = await loadConfiguration({
      argv: [],
      env: {
        KDRIVE_ID: "7",
        KDRIVE_TOKEN: "SYNTHETIC",
        KDRIVE_MCP_TRANSPORT: "http",
        MCP_PUBLIC_URL: "https://mcp.test/mcp",
        OAUTH_MODE: "proxy",
        OAUTH_ISSUER: "https://idp.test",
        OAUTH_ALLOWED_SUBJECTS: "user-1",
        OAUTH_UPSTREAM_CLIENT_ID: "client",
        OAUTH_UPSTREAM_CLIENT_SECRET: "SYNTHETIC",
        OAUTH_SIGNING_KEY_FILE: "/synthetic/key",
        OAUTH_ALLOWED_REDIRECT_URIS: "https://claude.ai/api/mcp/auth_callback",
      },
      readFile: async () => await Promise.resolve(new Uint8Array([1])),
    });
    const copy: Record<string, unknown> = { ...local };
    delete copy.oauthIssuer;
    const resolved = await preflightConfiguration(copy as never, {
      inspectDrive: async (id) => await Promise.resolve({ id, role: "admin" }),
      resolveDirectory: async (driveId) =>
        await Promise.resolve({ driveId, id: 1, type: "dir" }),
    });
    await expectRefusal(
      { ...options, configuration: resolved },
      "CONFIGURATION_UNSUPPORTED",
    );
  });

  it.each(["delegate", "delegate-static"])(
    "BR-152 AC-01 refuses oauth mode %s before any later check",
    async (mode) => {
      const env: Record<string, string | undefined> = {
        OAUTH_MODE: mode,
        OAUTH_UPSTREAM_CLIENT_ID: undefined,
        OAUTH_UPSTREAM_CLIENT_SECRET: undefined,
        OAUTH_SIGNING_KEY_FILE: undefined,
        OAUTH_ALLOWED_REDIRECT_URIS: undefined,
        MCP_PUBLIC_URL: "https://mcp.test",
        ...(mode === "delegate-static"
          ? { OAUTH_ISSUER: "https://idp.test" }
          : {}),
      };
      const options = await optionsFor({ env, upstream: false });
      await expectRefusal(options, "OAUTH_MODE_UNSUPPORTED");
    },
  );

  it("BR-152 AC-01 refuses a public URL without a path, then an absent upstream", async () => {
    await expectRefusal(
      await optionsFor({ env: { MCP_PUBLIC_URL: "https://mcp.test" } }),
      "PUBLIC_URL_PATH_REQUIRED",
    );
    await expectRefusal(
      await optionsFor({
        env: { MCP_PUBLIC_URL: "https://mcp.test" },
        upstream: false,
      }),
      "PUBLIC_URL_PATH_REQUIRED",
    );
    await expectRefusal(
      await optionsFor({ upstream: false }),
      "UPSTREAM_PORT_REQUIRED",
    );
  });

  it("BR-152 AC-01 refuses an upstream option in insecure mode", async () => {
    await expectRefusal(
      await optionsFor({ insecure: true }),
      "UPSTREAM_PORT_UNEXPECTED",
    );
  });

  it("BR-152 AC-01 propagates the error of a rejected signing key", async () => {
    const options = await optionsFor({
      keyBytes: new TextEncoder().encode("not a key"),
    });
    expect(() => createHttpHandler(options)).toThrow(
      /OAuth signing key must be one PKCS#8/u,
    );
    const listen = vi.fn();
    await expect(startHttpServer({ ...options, listen })).rejects.toThrow(
      /signing key/u,
    );
    expect(listen).not.toHaveBeenCalled();
  });

  it("BR-152 performs no I/O while constructing", async () => {
    const f = await httpFixture();
    expect(f.upstream?.calls).toEqual([]);
    expect(f.logs).toEqual([]);
  });
});

describe("BR-153 bind address", () => {
  it("BR-153 AC-02 binds the default host and port", async () => {
    const options = await optionsFor();
    const listen = vi.fn(
      async () => await Promise.resolve(address("127.0.0.1", 3000)),
    );
    const started = await startHttpServer({ ...options, listen });
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen.mock.calls[0]?.slice(1)).toEqual([3000, "127.0.0.1"]);
    expect(started.address.port).toBe(3000);
    await started.close();
  });

  it("BR-153 BR-025 v2 AC-02 binds literal 127.0.0.1 in insecure mode", async () => {
    const options = await optionsFor({
      insecure: true,
      env: { MCP_HTTP_HOST: "0.0.0.0" },
      upstream: false,
    });
    const listen = vi.fn(
      async () => await Promise.resolve(address("127.0.0.1", 3000)),
    );
    const started = await startHttpServer({ ...options, listen });
    expect(listen.mock.calls[0]?.slice(1)).toEqual([3000, "127.0.0.1"]);
    await started.close();
  });

  it("BR-153 AC-02 closes the server and refuses an insecure listener bound elsewhere", async () => {
    const options = await optionsFor({ insecure: true, upstream: false });
    let close: MockInstance<Server["close"]> | undefined;
    const listen = vi.fn(async (server: Server) => {
      close = vi.spyOn(server, "close");
      return await Promise.resolve(address("0.0.0.0", 3000));
    });
    await expect(startHttpServer({ ...options, listen })).rejects.toMatchObject(
      {
        code: "INSECURE_BIND_REFUSED",
      },
    );
    expect(close).toHaveBeenCalled();
  });

  it("BR-153 AC-02 reports LISTEN_FAILED for a port in use without system text", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(0, "127.0.0.1", resolve),
    );
    const port = (blocker.address() as AddressInfo).port;
    try {
      const options = await optionsFor({
        env: { MCP_HTTP_PORT: String(port) },
      });
      const failure = await startHttpServer(options).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(HttpStartupError);
      expect((failure as HttpStartupError).code).toBe("LISTEN_FAILED");
      expect((failure as HttpStartupError).message).not.toMatch(
        /EADDRINUSE|address/iu,
      );
    } finally {
      await new Promise<void>((resolve) =>
        blocker.close(() => {
          resolve();
        }),
      );
    }
  });

  it("BR-153 listens through the default port and stops on close", async () => {
    const port = await listeningPort();
    const options = await optionsFor({ env: { MCP_HTTP_PORT: String(port) } });
    const started = await startHttpServer(options);
    expect(started.address.port).toBe(port);
    expect(started.address.address).toBe("127.0.0.1");
    await started.close();
    await expect(
      new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(resolve));
      }),
    ).resolves.toBeUndefined();
  });
});

// ---- F-053 BR-444: accept-time errors after bind ----

/** An accept-time error carrying text that must never reach a log event. */
function acceptError(code: unknown): Error {
  return Object.assign(new Error("CANARY_ACCEPT_FAILURE 10.9.8.7:443"), {
    code,
    address: "10.9.8.7",
  });
}

async function initializeOver(port: number, token: string) {
  return await exchange(port, {
    method: "POST",
    target: "/mcp",
    headers: [
      ["Host", HOST],
      ["Authorization", `Bearer ${token}`],
      ["Content-Type", "application/json"],
      ["Accept", "application/json, text/event-stream"],
      ["Content-Length", String(Buffer.byteLength(INITIALIZE))],
    ],
    body: INITIALIZE,
  });
}

async function healthOver(port: number) {
  return await exchange(port, { target: "/healthz", headers: [["Host", HOST]] });
}

const listenerErrors = (logs: LoggedEvent[]) =>
  logs.filter((e) => e.name === "listener_error").map((e) => e.fields);

/** A custom ListenPort that binds an ephemeral loopback port. */
function ephemeralListen() {
  const bound: { server?: Server } = {};
  const listen = async (server: Server, _port: number, host: string) => {
    bound.server = server;
    await new Promise<void>((resolve) => {
      server.listen(0, host, resolve);
    });
    return server.address() as AddressInfo;
  };
  return { bound, listen };
}

describe("F-053 BR-444 accept-time errors", () => {
  it("BR-444 BR-167 v4 AC-06 logs accept-time errors once per minute and keeps serving", async () => {
    const port = await listeningPort();
    const f = await httpFixture({ env: { MCP_HTTP_PORT: String(port) } });
    const created = vi.spyOn(http, "createServer");
    const started = await startHttpServer(f.handlerOptions);
    const server = created.mock.results[0]?.value as Server;
    created.mockRestore();
    try {
      expect(server.listenerCount("error")).toBeGreaterThanOrEqual(1);
      const start = f.clock.ms;
      server.emit("error", acceptError("EMFILE"));
      server.emit("error", acceptError(24));
      server.emit("error", acceptError("emfile"));
      f.clock.ms = start + 59_999;
      server.emit("error", acceptError("EAGAIN"));
      expect(listenerErrors(f.logs)).toEqual([
        { code: "EMFILE", suppressed: 0 },
      ]);
      const answered = await initializeOver(port, await f.mint());
      expect(answered?.status).toBe(200);
      f.clock.ms = start + 60_000;
      server.emit("error", acceptError("ENFILE"));
      // The clock runs backwards: negative elapsed time counts as a minute.
      f.clock.ms = start + 60_000 - 1000;
      server.emit("error", acceptError("emfile"));
      expect(listenerErrors(f.logs)).toEqual([
        { code: "EMFILE", suppressed: 0 },
        { code: "ENFILE", suppressed: 3 },
        { code: "other", suppressed: 0 },
      ]);
      const logged = JSON.stringify(
        f.logs.filter((e) => e.name === "listener_error"),
      );
      for (const leak of ["CANARY", "10.9.8.7", "stack", "message", "at "])
        expect(logged).not.toContain(leak);
      expect(server.listening).toBe(true);
    } finally {
      await started.close();
    }
  });

  it("BR-444 AC-07 contains a throwing logger and keeps LISTEN_FAILED before bind", async () => {
    const logs: LoggedEvent[] = [];
    const state = { throwing: true };
    const f = await httpFixture({
      logger: {
        event: (name, fields) => {
          if (state.throwing) throw new Error("logger down");
          logs.push({ name, fields });
        },
      },
    });
    const custom = ephemeralListen();
    const started = await startHttpServer({
      ...f.handlerOptions,
      listen: custom.listen,
    });
    const server = custom.bound.server as Server;
    try {
      expect(server.listenerCount("error")).toBeGreaterThanOrEqual(1);
      const start = f.clock.ms;
      expect(() => server.emit("error", acceptError("EMFILE"))).not.toThrow();
      expect((await healthOver(started.address.port))?.status).toBe(200);
      // The throwing attempt started the window: 1 ms later is suppressed.
      f.clock.ms = start + 1;
      expect(() => server.emit("error", acceptError("EMFILE"))).not.toThrow();
      state.throwing = false;
      f.clock.ms = start + 60_000;
      server.emit("error", acceptError("EMFILE"));
      expect(listenerErrors(logs)).toEqual([{ code: "EMFILE", suppressed: 1 }]);
      expect((await healthOver(started.address.port))?.status).toBe(200);
    } finally {
      await started.close();
    }

    const blocker = createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(0, "127.0.0.1", resolve),
    );
    const used = (blocker.address() as AddressInfo).port;
    try {
      const g = await httpFixture({ env: { MCP_HTTP_PORT: String(used) } });
      await expect(startHttpServer(g.handlerOptions)).rejects.toMatchObject({
        code: "LISTEN_FAILED",
      });
    } finally {
      await new Promise<void>((resolve) =>
        blocker.close(() => {
          resolve();
        }),
      );
    }
  });
});

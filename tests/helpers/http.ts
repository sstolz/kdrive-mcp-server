import { createConnection, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { expect, vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../../src/config.js";
import type { ResolvedConfiguration } from "../../src/config.js";
import { loadSigningKey, signAccessToken } from "../../src/auth/proxy/keys.js";
import {
  createHttpHandler,
  createHttpServer,
  type HttpHandlerOptions,
} from "../../src/http/index.js";
import {
  CLAUDE,
  COOKIE,
  Clock,
  FakeUpstream,
  UPSTREAM,
  UPSTREAM_CLIENT,
  UPSTREAM_SECRET,
  b64url,
  counterRandom,
  s256,
  signIdToken,
  syntheticPem,
  upstreamKey,
  upstreamMetadata,
} from "./proxy.js";
import { navigationFixture } from "./navigation.js";

// Synthetic values only: keys are generated in memory per run, and no host or
// secret of a real deployment appears here.
export const P = "https://mcp.test/mcp";
export const HOST = "mcp.test";
export const PRM = "https://mcp.test/.well-known/oauth-protected-resource/mcp";
export const SYNTHETIC_PLACEHOLDER = "http://placeholder.invalid/";

export interface LoggedEvent {
  name: string;
  fields: Record<string, string | number>;
}

export interface FixtureOptions {
  env?: Record<string, string | undefined>;
  argv?: string[];
  insecure?: boolean;
  /** `null` omits the upstream option. */
  upstream?: FakeUpstream | null;
  keyBytes?: Uint8Array;
  logger?: HttpHandlerOptions["logger"] | null;
  clock?: Clock;
  dependencies?: HttpHandlerOptions["dependencies"];
  /** F-016: the mutation gate shared by every session. */
  gate?: HttpHandlerOptions["gate"];
  /** Receives a clone of every response `send` returns, with its target. */
  observe?: (response: Response, target: string) => Promise<void>;
}

export type Fixture = Awaited<ReturnType<typeof httpFixture>>;

/** A gate for a synthetic dependency call held until released. */
export function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  return {
    enter: async () => {
      entered++;
      await opened;
    },
    release,
    entered: () => entered,
  };
}

export async function configurationFor(
  options: Pick<FixtureOptions, "env" | "argv" | "insecure" | "keyBytes"> & {
    pem?: string;
  } = {},
): Promise<ResolvedConfiguration> {
  const pem = options.pem ?? syntheticPem();
  const base = { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC_KDRIVE_TOKEN" };
  const env: Record<string, string | undefined> = options.insecure
    ? {
        ...base,
        KDRIVE_MCP_TRANSPORT: "http",
        KDRIVE_MCP_INSECURE_NO_AUTH: "1",
        ...options.env,
      }
    : {
        ...base,
        KDRIVE_MCP_TRANSPORT: "http",
        MCP_PUBLIC_URL: P,
        OAUTH_MODE: "proxy",
        OAUTH_ISSUER: UPSTREAM,
        OAUTH_ALLOWED_SUBJECTS: "user-1",
        OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
        OAUTH_UPSTREAM_CLIENT_SECRET: UPSTREAM_SECRET,
        OAUTH_SIGNING_KEY_FILE: "/synthetic/key",
        OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
        ...options.env,
      };
  const local = await loadConfiguration({
    argv: options.argv ?? [],
    env,
    cwd: "/work",
    readFile: async () =>
      await Promise.resolve(options.keyBytes ?? new TextEncoder().encode(pem)),
  });
  return await preflightConfiguration(local, {
    inspectDrive: async (id) => {
      await Promise.resolve();
      return { id, role: "admin" };
    },
    resolveDirectory: async (driveId) => {
      await Promise.resolve();
      return { driveId, id: 1, type: "dir" };
    },
  });
}

export function jsonRpc(
  method: string,
  id: number | undefined,
  params: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    params,
  });
}

export const INITIALIZE = jsonRpc("initialize", 1, {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "synthetic-client", version: "1" },
});

export async function httpFixture(options: FixtureOptions = {}) {
  const pem = syntheticPem();
  const clock = options.clock ?? new Clock();
  const upstream =
    options.upstream === null
      ? undefined
      : (options.upstream ?? new FakeUpstream());
  const idKey = await upstreamKey();
  if (upstream) upstream.jwks = { keys: [idKey.jwk] };
  const configuration = await configurationFor({ ...options, pem });
  const navigation = await navigationFixture();
  const logs: LoggedEvent[] = [];
  const logger =
    options.logger === null
      ? undefined
      : (options.logger ?? {
          event: (name: string, fields: Record<string, string | number>) => {
            logs.push({ name, fields });
          },
        });
  const handlerOptions: HttpHandlerOptions = {
    configuration,
    dependencies: options.dependencies ?? navigation.dependencies,
    ...(upstream === undefined ? {} : { upstream }),
    clock: clock.now,
    randomBytes: counterRandom(),
    ...(logger === undefined ? {} : { logger }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
  };
  const handler = createHttpHandler(handlerOptions);
  const defaultHost = options.insecure ? "127.0.0.1:3000" : HOST;
  const key = loadSigningKey(new TextEncoder().encode(pem));

  /** Signs a proxy-shaped access token with the configured synthetic key. */
  async function mint(
    claims: Record<string, unknown> = {},
    signer = key,
  ): Promise<string> {
    const iat = Math.floor(clock.ms / 1000);
    return await signAccessToken(signer, {
      iss: P,
      sub: "user-1",
      upstream_iss: UPSTREAM,
      aud: P,
      client_id: "synthetic-client",
      iat,
      exp: iat + 3600,
      jti: `jti-${String(iat)}`,
      ...claims,
    });
  }

  async function send(
    method: string,
    target: string,
    init: {
      headers?: Record<string, string>;
      body?: string | Uint8Array;
      host?: string | null;
    } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (init.host !== null && !headers.has("host"))
      headers.set("host", init.host ?? defaultHost);
    const request = new Request(SYNTHETIC_PLACEHOLDER, {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body as BodyInit }),
    });
    const response = await handler.handle(request, target);
    if (options.observe) await options.observe(response.clone(), target);
    return response;
  }

  function mcpHeaders(
    token?: string,
    session?: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    return {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(session === undefined ? {} : { "mcp-session-id": session }),
      ...extra,
    };
  }

  async function mcp(
    token: string | undefined,
    body: string,
    session?: string,
    extra: Record<string, string> = {},
    target = "/mcp",
  ): Promise<Response> {
    return await send("POST", target, {
      headers: mcpHeaders(token, session, extra),
      body,
    });
  }

  async function initialize(token: string, extra = {}, target = "/mcp") {
    const response = await mcp(token, INITIALIZE, undefined, extra, target);
    return { response, session: response.headers.get("mcp-session-id") ?? "" };
  }

  async function del(token: string, session?: string): Promise<Response> {
    return await send("DELETE", "/mcp", {
      headers: mcpHeaders(token, session),
    });
  }

  /** Initializes and completes the handshake; returns the session ID. */
  async function open(token: string): Promise<string> {
    const { response, session } = await initialize(token);
    if (response.status !== 200)
      throw new Error(`initialize ${response.status}`);
    const done = await mcp(
      token,
      jsonRpc("notifications/initialized", undefined),
      session,
    );
    if (done.status !== 202) throw new Error(`initialized ${done.status}`);
    return session;
  }

  async function call(
    token: string,
    session: string,
    name: string,
    args: Record<string, unknown>,
    id = 3,
  ): Promise<Response> {
    return await mcp(
      token,
      jsonRpc("tools/call", id, { name, arguments: args }),
      session,
    );
  }

  const events = (name: string) => logs.filter((entry) => entry.name === name);

  return {
    handler,
    handlerOptions,
    defaultHost,
    configuration,
    navigation,
    upstream,
    idKey,
    clock,
    logs,
    events,
    pem,
    key,
    mint,
    send,
    mcpHeaders,
    mcp,
    initialize,
    open,
    del,
    call,
  };
}

export async function body(response: Response): Promise<string> {
  return await response.text();
}

export async function bodyJson(
  response: Response,
): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

/** Spies a tool dependency that never answers until `release` is called. */
export function blockedDependencies(
  base: Awaited<ReturnType<typeof navigationFixture>>["dependencies"],
) {
  const held = gate();
  const inspect = vi.fn(async (ref: Parameters<typeof base.inspect>[0]) => {
    await held.enter();
    return await base.inspect(ref);
  });
  return { held, dependencies: { ...base, inspect } };
}

// ---- raw HTTP/1.x client for (socket) cases ---------------------------------

export interface RawResponse {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

export function rawHeader(
  response: RawResponse,
  name: string,
): string | undefined {
  return response.headers.find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

export function rawHeaders(response: RawResponse, name: string): string[] {
  return response.headers
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
}

export interface RawRequest {
  method?: string;
  target: string;
  version?: "1.0" | "1.1";
  headers?: Array<[string, string]>;
  body?: string;
}

export function rawText(request: RawRequest): string {
  const lines = [
    `${request.method ?? "GET"} ${request.target} HTTP/${request.version ?? "1.1"}`,
    ...(request.headers ?? []).map(([key, value]) => `${key}: ${value}`),
  ];
  return `${lines.join("\r\n")}\r\n\r\n${request.body ?? ""}`;
}

export class RawClient {
  private buffer = Buffer.alloc(0);
  private waiting: Array<() => void> = [];
  closed = false;
  readonly closePromise: Promise<void>;

  private constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    this.closePromise = new Promise<void>((resolve) => {
      socket.on("close", () => {
        this.closed = true;
        this.wake();
        resolve();
      });
    });
    socket.on("error", () => {
      this.closed = true;
      this.wake();
    });
  }

  static async connect(port: number): Promise<RawClient> {
    const socket = createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    return new RawClient(socket);
  }

  private wake() {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) resolve();
  }

  write(text: string | Buffer): void {
    this.socket.write(text);
  }

  end(): void {
    this.socket.end();
  }

  destroy(): void {
    this.socket.destroy();
  }

  private parse(): RawResponse | undefined {
    const end = this.buffer.indexOf("\r\n\r\n");
    if (end < 0) return undefined;
    const head = this.buffer.subarray(0, end).toString("latin1");
    const [statusLine = "", ...lines] = head.split("\r\n");
    const headers = lines.map((line): [string, string] => {
      const at = line.indexOf(":");
      return [line.slice(0, at), line.slice(at + 1).trim()];
    });
    const length = Number(
      headers.find(([key]) => key.toLowerCase() === "content-length")?.[1] ??
        "0",
    );
    const total = end + 4 + length;
    if (this.buffer.length < total) return undefined;
    const body = this.buffer.subarray(end + 4, total).toString("utf8");
    this.buffer = this.buffer.subarray(total);
    return { status: Number(statusLine.split(" ")[1]), headers, body };
  }

  /** The next complete response, or undefined when the connection closed first. */
  async next(timeoutMs = 3000): Promise<RawResponse | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const parsed = this.parse();
      if (parsed) return parsed;
      if (this.closed || Date.now() > deadline) return undefined;
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  /** Waits until the server has closed the connection. */
  async waitClosed(timeoutMs = 3000): Promise<boolean> {
    await Promise.race([
      this.closePromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return this.closed;
  }
}

export async function listening(f: Pick<Fixture, "handlerOptions">) {
  const created = createHttpServer(f.handlerOptions);
  await new Promise<void>((resolve, reject) => {
    created.server.once("error", reject);
    created.server.listen(0, "127.0.0.1", resolve);
  });
  const port = (created.server.address() as AddressInfo).port;
  return { ...created, port };
}

/** One request on a fresh connection; undefined when none was answered. */
export async function exchange(
  port: number,
  request: RawRequest,
): Promise<RawResponse | undefined> {
  const client = await RawClient.connect(port);
  client.write(rawText(request));
  const response = await client.next();
  client.destroy();
  return response;
}

// ---- browser-side OAuth steps, run through `handle()` -----------------------

export interface LoggedIn {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
}

/**
 * The browser side of one login: consent approval and the simulated upstream
 * redirect, run through the handler. Returns the final redirect to the client.
 */
export async function browserLogin(
  f: Fixture,
  authorizeUrl: string,
  claims: Record<string, unknown> = {},
  tokenFields: Record<string, unknown> = {},
): Promise<URL> {
  const upstream = f.upstream;
  if (!upstream) throw new Error("no upstream");
  const url = new URL(authorizeUrl);
  const authorize = await f.send("GET", `${url.pathname}${url.search}`);
  const page = await authorize.text();
  const consent = /name="consent" value="([^"]+)"/u.exec(page)?.[1] ?? "";
  const cookie = `${COOKIE}=${/__Host-kdrive-oauth=([^;]+)/u.exec(authorize.headers.get("set-cookie") ?? "")?.[1] ?? ""}`;
  const approved = await f.send("POST", "/mcp/oauth/consent", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "null",
      cookie,
    },
    body: new URLSearchParams({ consent, decision: "approve" }).toString(),
  });
  const up = new URL(approved.headers.get("location") ?? "");
  const nonce = up.searchParams.get("nonce") ?? "";
  const iat = Math.floor(f.clock.ms / 1000);
  upstream.tokenReply = {
    status: 200,
    json: {
      token_type: "Bearer",
      access_token: "SYNTHETIC-UPSTREAM-ACCESS",
      ...tokenFields,
      id_token: await signIdToken(f.idKey, {
        iss: UPSTREAM,
        aud: UPSTREAM_CLIENT,
        sub: "user-1",
        nonce,
        iat,
        exp: iat + 300,
        ...claims,
      }),
    },
  };
  upstream.metadata = upstreamMetadata();
  const done = await f.send(
    "GET",
    `/mcp/oauth/callback?${new URLSearchParams({
      code: "SYNTHETIC-UPSTREAM-CODE",
      state: up.searchParams.get("state") ?? "",
    }).toString()}`,
    { headers: { cookie } },
  );
  return new URL(done.headers.get("location") ?? "");
}

/** Runs registration, authorize, consent, callback and token through the handler. */
export async function oauthLogin(
  f: Fixture,
  claims: Record<string, unknown> = {},
  tokenFields: Record<string, unknown> = {},
): Promise<LoggedIn> {
  const registration = await f.send("POST", "/mcp/oauth/register", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = (await bodyJson(registration)).client_id as string;
  const verifier = `synthetic-verifier-${"v".repeat(40)}`;
  const redirect = await browserLogin(
    f,
    `https://mcp.test/mcp/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: client,
      redirect_uri: CLAUDE,
      state: "client-state",
      code_challenge: s256(verifier),
      code_challenge_method: "S256",
      resource: P,
    }).toString()}`,
    claims,
    tokenFields,
  );
  const token = await f.send("POST", "/mcp/oauth/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code") ?? "",
      redirect_uri: CLAUDE,
      code_verifier: verifier,
      client_id: client,
    }).toString(),
  });
  const data = await bodyJson(token);
  return {
    accessToken: data.access_token as string,
    ...(typeof data.refresh_token === "string"
      ? { refreshToken: data.refresh_token }
      : {}),
    clientId: client,
  };
}

export { b64url };

/** A currently free loopback port (bound and released). */
export async function listeningPort(): Promise<number> {
  const { createServer } = await import("node:net");
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) =>
    probe.close(() => {
      resolve();
    }),
  );
  return port;
}

export async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe(`{"error":"${code}"}`);
}

type ProxyModule = typeof import("../../src/auth/proxy/index.js");

/** Wraps the mocked `createOAuthProxy` so each proxy call is recorded. */
export async function wrapProxy(mocked: {
  mockImplementation: (fn: ProxyModule["createOAuthProxy"]) => unknown;
}) {
  const actual = await vi.importActual<ProxyModule>(
    "../../src/auth/proxy/index.js",
  );
  const spies = {
    verifier: vi.fn(),
    register: vi.fn(),
    authorize: vi.fn(),
    consent: vi.fn(),
    callback: vi.fn(),
    token: vi.fn(),
  };
  mocked.mockImplementation((options) => {
    const proxy = actual.createOAuthProxy(options);
    return {
      ...proxy,
      verifier: (token: string, now: Date) => {
        spies.verifier(token, now);
        return proxy.verifier(token, now);
      },
      register: (input: Parameters<typeof proxy.register>[0]) => {
        spies.register(input);
        return proxy.register(input);
      },
      authorize: (input: Parameters<typeof proxy.authorize>[0]) => {
        spies.authorize(input);
        return proxy.authorize(input);
      },
      consent: (input: Parameters<typeof proxy.consent>[0]) => {
        spies.consent(input);
        return proxy.consent(input);
      },
      callback: (input: Parameters<typeof proxy.callback>[0]) => {
        spies.callback(input);
        return proxy.callback(input);
      },
      token: (input: Parameters<typeof proxy.token>[0]) => {
        spies.token(input);
        return proxy.token(input);
      },
    };
  });
  return spies;
}

export const PROXY_MODULE = "../../src/auth/proxy/index.js";

/** Holds the next transport `handleRequest` call until `release` is called. */
export function holdNextHandle() {
  const proto = WebStandardStreamableHTTPServerTransport.prototype;
  const original: typeof proto.handleRequest = Reflect.get(
    proto,
    "handleRequest",
  );
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(proto, "handleRequest")
    .mockImplementationOnce(async function (
      this: WebStandardStreamableHTTPServerTransport,
      ...args: Parameters<typeof proto.handleRequest>
    ) {
      await opened;
      return await original.apply(this, args);
    });
  return { release, spy };
}

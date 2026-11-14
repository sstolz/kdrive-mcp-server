import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import {
  createOAuthProxy,
  openOAuthStateStore,
  type EffectiveProxyConfig,
  type OAuthProxy,
  type OAuthStateStore,
} from "../auth/proxy/index.js";
import { stateBinding } from "../auth/proxy/proxy.js";
import { createClientMetadataFetch } from "../auth/proxy/client-metadata-fetch.js";
import { isRecord } from "../auth/access-token.js";
import {
  isResolvedConfiguration,
  type ResolvedConfiguration,
} from "../config.js";
import { createNavigationServer } from "../navigation.js";
import type { AuditIdentity } from "../audit/sink.js";
import {
  decodeUtf8,
  framingRefusal,
  hostForms,
  isLoopbackHost,
  mediaType,
  originForms,
  parseCredential,
  readBounded,
} from "./checks.js";
import { HttpStartupError } from "./errors.js";
import {
  IDENTITY_LIMIT,
  IDENTITY_WINDOW_MS,
  MAX_TARGET_BYTES,
  MAX_TOKEN_BYTES,
  MCP_BODY_LIMIT,
  OAUTH_BODY_LIMIT,
  HEALTH_LIMIT,
  HEALTH_PATH,
  HEALTH_WINDOW_MS,
  ROUTE_WINDOWS,
  WindowLimiter,
} from "./limits.js";
import { errorResponse, fromProxy } from "./responses.js";
import { GONE, SessionRegistry, closeBoth, type Session } from "./sessions.js";
import type {
  HttpEvent,
  HttpHandler,
  HttpHandlerOptions,
  RouteName,
} from "./types.js";

interface Route {
  readonly name: Exclude<RouteName, "unknown">;
  readonly methods: readonly string[];
  /** The POST body limit; `undefined` when the route accepts no body. */
  readonly limit?: number;
}

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/u;
const PROTOCOL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const INSECURE_IDENTITY = JSON.stringify(["insecure", "local"]);
/** BR-237: the audit identity of a session's verified identity key. */
function auditIdentity(identity: string): AuditIdentity {
  if (identity === INSECURE_IDENTITY) return { kind: "insecure" };
  const [iss, sub] = JSON.parse(identity) as [string, string];
  return { kind: "oauth", iss, sub };
}
const FORM = "application/x-www-form-urlencoded";
const JSON_TYPE = "application/json";
/** F-021 BR-322: the constant `/healthz` body. */
const HEALTH_BODY = '{"status":"ok"}';

/** BR-152: the F-010 proxy configuration mapped from the F-002 configuration only. */
function proxyConfiguration(
  configuration: ResolvedConfiguration,
  publicUrl: string,
): EffectiveProxyConfig {
  const {
    oauthIssuer,
    oauthUpstreamClientId,
    oauthUpstreamClientSecret,
    oauthSigningKey,
    oauthAllowedRedirectUris,
  } = configuration;
  if (
    oauthIssuer === undefined ||
    oauthUpstreamClientId === undefined ||
    oauthUpstreamClientSecret === undefined ||
    oauthSigningKey === undefined ||
    oauthAllowedRedirectUris === undefined
  )
    throw new HttpStartupError("CONFIGURATION_UNSUPPORTED");
  return {
    publicUrl,
    oauthIssuer,
    oauthAudience: publicUrl,
    oauthAllowedSubjects: configuration.oauthAllowedSubjects,
    oauthAllowedEmails: configuration.oauthAllowedEmails,
    oauthUpstreamClientId,
    oauthUpstreamClientSecret,
    oauthSigningKey,
    oauthAllowedRedirectUris,
    oauthAllowedClientIdOrigins: configuration.oauthAllowedClientIdOrigins,
  };
}

function queryOf(target: string): string {
  const at = target.indexOf("?");
  return at < 0 ? "" : target.slice(at + 1);
}

function pathOf(target: string): string {
  const at = target.indexOf("?");
  return at < 0 ? target : target.slice(0, at);
}

/** BR-166: the request the SDK sees carries no credential header. */
function sdkRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  return new Request(request.url, { method: request.method, headers });
}

function requestedProtocol(parsed: unknown): string {
  const params = isRecord(parsed) ? parsed.params : undefined;
  const version = isRecord(params) ? params.protocolVersion : undefined;
  return typeof version === "string" && PROTOCOL_DATE.test(version)
    ? version
    : "other";
}

function isInitializeRequest(parsed: unknown): boolean {
  return (
    isRecord(parsed) &&
    parsed.method === "initialize" &&
    (typeof parsed.id === "string" || typeof parsed.id === "number")
  );
}

/** BR-152 to BR-170: the authenticated HTTP router in front of the SDK transport. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- the router closes over one shared state; its steps are small named functions
export function createHttpHandler(options: HttpHandlerOptions): HttpHandler {
  const { configuration, dependencies, upstream, clock, logger } = options;
  if (
    !isResolvedConfiguration(configuration) ||
    configuration.transport !== "http" ||
    configuration.publicUrl === undefined
  )
    throw new HttpStartupError("CONFIGURATION_UNSUPPORTED");
  const publicUrl = configuration.publicUrl;
  const insecure = configuration.insecureNoAuth;
  const url = new URL(publicUrl);
  let proxy: OAuthProxy | undefined;
  let store: OAuthStateStore | undefined;
  /** BR-304: the store is closed at most once; a throwing close still counts. */
  function closeStore(): void {
    const open = store;
    store = undefined;
    open?.close();
  }
  if (insecure) {
    if (upstream !== undefined)
      throw new HttpStartupError("UPSTREAM_PORT_UNEXPECTED");
  } else {
    if (configuration.oauthMode !== "proxy")
      throw new HttpStartupError("OAUTH_MODE_UNSUPPORTED");
    if (url.pathname === "/")
      throw new HttpStartupError("PUBLIC_URL_PATH_REQUIRED");
    if (upstream === undefined)
      throw new HttpStartupError("UPSTREAM_PORT_REQUIRED");
    const config = proxyConfiguration(configuration, publicUrl);
    // BR-152 v2: the store is opened before the proxy and before any socket.
    if (configuration.oauthStateFile !== undefined)
      store = openOAuthStateStore({
        path: configuration.oauthStateFile,
        binding: stateBinding(config),
        allowedRedirectUris: config.oauthAllowedRedirectUris,
        allowedClientIdOrigins: configuration.oauthAllowedClientIdOrigins,
        clock,
        ...(options.oauthStatePort === undefined
          ? {}
          : { port: options.oauthStatePort }),
      });
    try {
      proxy = createOAuthProxy({
        config,
        clock,
        randomBytes: options.randomBytes,
        upstream,
        ...(logger === undefined ? {} : { logger }),
        ...(store === undefined ? {} : { store }),
        // F-028: the rehearsal seam only; production passes none (AC-13).
        ...(options.clientMetadataSeam === undefined
          ? {}
          : {
              clientMetadataFetch: createClientMetadataFetch(
                options.clientMetadataSeam,
              ),
            }),
      });
    } catch (error) {
      // BR-304: a construction failure releases the store before it leaves.
      try {
        closeStore();
      } catch {
        // The construction error is the one reported.
      }
      throw error;
    }
  }

  const endpoint = url.pathname;
  const prmPath = `/.well-known/oauth-protected-resource${endpoint}`;
  const prmUrl = `${url.origin}${prmPath}`;
  const hostnames = insecure ? [url.hostname, "localhost"] : [url.hostname];
  const hosts = hostForms(url, hostnames);
  const origins = originForms(url, hostnames);

  const routes = new Map<string, Route>();
  const add = (path: string, route: Route) => {
    if (!routes.has(path)) routes.set(path, route);
  };
  add(endpoint, {
    name: "mcp",
    methods: ["POST", "DELETE"],
    limit: MCP_BODY_LIMIT,
  });
  if (proxy) {
    add(prmPath, { name: "prm", methods: ["GET"] });
    for (const path of proxy.metadataPaths)
      add(path, { name: "as_metadata", methods: ["GET"] });
    add(`${endpoint}/oauth/register`, {
      name: "register",
      methods: ["POST"],
      limit: OAUTH_BODY_LIMIT,
    });
    add(`${endpoint}/oauth/authorize`, { name: "authorize", methods: ["GET"] });
    add(`${endpoint}/oauth/consent`, {
      name: "consent",
      methods: ["POST"],
      limit: OAUTH_BODY_LIMIT,
    });
    add(`${endpoint}/oauth/callback`, { name: "callback", methods: ["GET"] });
    add(`${endpoint}/oauth/token`, {
      name: "token",
      methods: ["POST"],
      limit: OAUTH_BODY_LIMIT,
    });
  }
  // F-021 BR-322: after every other route, so an MCP endpoint at /healthz keeps it.
  add(HEALTH_PATH, { name: "health", methods: ["GET"] });

  let closing = false;
  const emit = (name: HttpEvent, fields: Record<string, string | number>) => {
    logger?.event(name, fields);
  };
  const safeEmit: typeof emit = (name, fields) => {
    try {
      emit(name, fields);
    } catch {
      // A logger failure never changes a response.
    }
  };
  const registry = new SessionRegistry(emit, safeEmit);
  const identityWindow = new WindowLimiter(IDENTITY_LIMIT, IDENTITY_WINDOW_MS);
  const routeWindows = new Map(
    Object.entries(ROUTE_WINDOWS).map(([name, window]) => [
      name,
      new WindowLimiter(window.limit, window.windowMs),
    ]),
  );
  const healthWindow = new WindowLimiter(HEALTH_LIMIT, HEALTH_WINDOW_MS);
  const now = () => clock().getTime();

  /** BR-167: an HTTP-layer error response and its single `request_refused` event. */
  function refuse(
    route: RouteName,
    status: number,
    code: string,
    extra: Readonly<Record<string, string>> = {},
  ): Response {
    safeEmit("request_refused", { route, status, error: code });
    return errorResponse(status, code, {
      ...extra,
      ...(status === 413 ? { connection: "close" } : {}),
    });
  }

  const challenge = (error?: string) =>
    error === undefined
      ? `Bearer resource_metadata="${prmUrl}"`
      : `Bearer error="${error}", resource_metadata="${prmUrl}"`;

  /** BR-158/BR-159: the verified identity key, or the refusal. */
  async function authenticate(
    request: Request,
    target: string,
  ): Promise<string | Response> {
    if (!proxy) return INSECURE_IDENTITY;
    if (new URLSearchParams(queryOf(target)).has("access_token"))
      return refuse("mcp", 400, "invalid_request", {
        "www-authenticate": challenge("invalid_request"),
      });
    const credential = parseCredential(request.headers.get("authorization"));
    if (credential.kind === "missing")
      return refuse("mcp", 401, "unauthorized", {
        "www-authenticate": challenge(),
      });
    if (credential.kind === "malformed")
      return refuse("mcp", 400, "invalid_request", {
        "www-authenticate": challenge("invalid_request"),
      });
    const invalid = () =>
      refuse("mcp", 401, "invalid_token", {
        "www-authenticate": challenge("invalid_token"),
      });
    if (Buffer.byteLength(credential.token) > MAX_TOKEN_BYTES) return invalid();
    const result = await proxy.verifier(credential.token, clock());
    if (result.ok)
      return JSON.stringify([result.identity.iss, result.identity.sub]);
    return result.status === 401
      ? invalid()
      : refuse("mcp", 403, "access_denied");
  }

  /** BR-160: encoding, media type, bound and UTF-8 of a POST body. */
  async function readText(
    request: Request,
    route: RouteName,
    limit: number,
    type: string,
  ): Promise<string | Response> {
    const encoding = request.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity")
      return refuse(route, 415, "unsupported_media_type");
    if (mediaType(request.headers.get("content-type")) !== type)
      return refuse(route, 415, "unsupported_media_type");
    const bytes = await readBounded(request, limit);
    if (bytes === undefined) return refuse(route, 413, "payload_too_large");
    const text = decodeUtf8(bytes);
    return text ?? refuse(route, 400, "invalid_request");
  }

  async function readJson(
    request: Request,
  ): Promise<{ value: unknown } | Response> {
    const text = await readText(request, "mcp", MCP_BODY_LIMIT, JSON_TYPE);
    if (typeof text !== "string") return text;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return refuse("mcp", 400, "invalid_request");
    }
    return Array.isArray(value)
      ? refuse("mcp", 400, "invalid_request")
      : { value };
  }

  /** BR-164: waits for the response, or answers 503 when the session closes first. */
  async function settle(
    session: Session,
    call: Promise<Response>,
  ): Promise<Response> {
    call.catch(() => undefined);
    const outcome = await Promise.race([call, session.gone]);
    return outcome === GONE
      ? refuse("mcp", 503, "temporarily_unavailable")
      : outcome;
  }

  async function bound(
    request: Request,
    identity: string,
    parsed: unknown,
  ): Promise<Response> {
    const id = request.headers.get("mcp-session-id");
    if (id === null) return await create(request, identity, parsed);
    const session = SESSION_ID.test(id)
      ? registry.find(id, identity)
      : undefined;
    if (!session) return refuse("mcp", 404, "session_not_found");
    session.lastUsed = now();
    return await settle(
      session,
      session.transport.handleRequest(sdkRequest(request), {
        parsedBody: parsed,
      }),
    );
  }

  async function remove(request: Request, identity: string): Promise<Response> {
    const id = request.headers.get("mcp-session-id");
    if (id === null) return refuse("mcp", 400, "invalid_request");
    const session = SESSION_ID.test(id)
      ? registry.find(id, identity)
      : undefined;
    if (!session) return refuse("mcp", 404, "session_not_found");
    session.lastUsed = now();
    const response = await session.transport.handleRequest(sdkRequest(request));
    if (response.ok) await registry.close(session, "deleted");
    return response;
  }

  /** BR-163: a new session from an `initialize` request. */
  async function create(
    request: Request,
    identity: string,
    parsed: unknown,
  ): Promise<Response> {
    if (!isInitializeRequest(parsed))
      return refuse("mcp", 400, "invalid_request");
    if (registry.full)
      return refuse("mcp", 503, "temporarily_unavailable", {
        "retry-after": "60",
      });
    registry.creating++;
    let released = false;
    const release = () => {
      if (!released) registry.creating--;
      released = true;
    };
    const state: { registered: boolean; failure?: "error" | "closing" } = {
      registered: false,
    };
    let server: McpServer | undefined;
    let transport: WebStandardStreamableHTTPServerTransport | undefined;
    try {
      server = createNavigationServer(configuration, dependencies, undefined, {
        gate: options.gate,
        identity: auditIdentity(identity),
      });
      let settleGone!: () => void;
      const gone = new Promise<typeof GONE>((resolve) => {
        settleGone = () => {
          resolve(GONE);
        };
      });
      const created = server;
      const register = (id: string) => {
        if (closing) {
          state.failure = "closing";
          return;
        }
        const time = now();
        try {
          registry.register(
            {
              id,
              identity,
              server: created,
              transport: current(),
              createdAt: time,
              lastUsed: time,
              closed: false,
              gone,
              settle: settleGone,
            },
            requestedProtocol(parsed),
          );
          state.registered = true;
        } catch {
          state.failure = "error";
        }
        release();
      };
      const current = () => {
        if (!transport) throw new Error("transport");
        return transport;
      };
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () =>
          Buffer.from(options.randomBytes(32)).toString("base64url"),
        enableJsonResponse: true,
        onsessioninitialized: register,
      });
      await server.connect(transport);
      const call = transport.handleRequest(sdkRequest(request), {
        parsedBody: parsed,
      });
      call.catch(() => undefined);
      const response = await Promise.race([call, gone]);
      if (response === GONE)
        return refuse("mcp", 503, "temporarily_unavailable");
      if (state.registered) return response;
      await closeBoth(server, transport);
      if (state.failure === "error") return refuse("mcp", 500, "server_error");
      if (state.failure === "closing")
        return refuse("mcp", 503, "temporarily_unavailable");
      return response;
    } catch (error) {
      if (server && transport && !state.registered)
        await closeBoth(server, transport);
      throw error;
    } finally {
      release();
    }
  }

  /** BR-161, BR-163, BR-164: identity window, body and session steps of the MCP endpoint. */
  async function mcp(request: Request, target: string): Promise<Response> {
    const identity = await authenticate(request, target);
    if (typeof identity !== "string") return identity;
    const wait = identityWindow.take(identity, now());
    if (wait !== undefined)
      return refuse("mcp", 429, "rate_limited", {
        "retry-after": String(wait),
      });
    let parsed: unknown;
    if (request.method === "POST") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      parsed = body.value;
    }
    await registry.sweep(now());
    return request.method === "DELETE"
      ? await remove(request, identity)
      : await bound(request, identity, parsed);
  }

  async function oauth(
    request: Request,
    target: string,
    route: Route,
  ): Promise<Response> {
    if (!proxy) throw new Error("proxy");
    const name = route.name;
    const wait = routeWindows.get(name)?.take(name, now());
    if (wait !== undefined)
      return refuse(name, 429, "rate_limited", { "retry-after": String(wait) });
    let text = "";
    if (request.method === "POST" && route.limit !== undefined) {
      const read = await readText(
        request,
        name,
        route.limit,
        name === "register" ? JSON_TYPE : FORM,
      );
      if (typeof read !== "string") return read;
      text = read;
    }
    const cookie = request.headers.get("cookie");
    const authorization = request.headers.get("authorization");
    const withCookie = cookie === null ? {} : { cookie };
    const query = new URLSearchParams(queryOf(target));
    switch (name) {
      case "register":
        return fromProxy(await proxy.register({ body: text }));
      case "authorize":
        return fromProxy(await proxy.authorize({ query, ...withCookie }));
      case "consent":
        return fromProxy(
          await proxy.consent({
            form: new URLSearchParams(text),
            ...withCookie,
          }),
        );
      case "callback":
        return fromProxy(await proxy.callback({ query, ...withCookie }));
      default:
        return fromProxy(
          await proxy.token({
            form: new URLSearchParams(text),
            ...(authorization === null ? {} : { authorization }),
          }),
        );
    }
  }

  /** F-021 BR-322, BR-323, BR-325: the constant liveness answer. */
  function health(host: string): Response {
    const key = isLoopbackHost(host) ? "health_loopback" : "health_public";
    const wait = healthWindow.take(key, now());
    if (wait !== undefined)
      return refuse("health", 429, "rate_limited", {
        "retry-after": String(wait),
      });
    return new Response(HEALTH_BODY, {
      status: 200,
      headers: {
        "content-type": JSON_TYPE,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  /** BR-156 v2, F-021 BR-324: the public forms, plus loopback on /healthz. */
  function hostAccepted(host: string, route: Route | undefined): boolean {
    return (
      hosts.has(host) || (route?.name === "health" && isLoopbackHost(host))
    );
  }

  function originRefused(request: Request, name: RouteName): boolean {
    const origin = request.headers.get("origin");
    if (origin === null || (name !== "mcp" && name !== "consent")) return false;
    return !(origins.has(origin) || (name === "consent" && origin === "null"));
  }

  function routeOf(target: string): RouteName {
    const path = pathOf(target);
    return (
      (path.startsWith("/") ? routes.get(path)?.name : undefined) ?? "unknown"
    );
  }

  async function dispatch(request: Request, target: string): Promise<Response> {
    const path = pathOf(target);
    const route = path.startsWith("/") ? routes.get(path) : undefined;
    const name: RouteName = route?.name ?? "unknown";
    if (closing) return refuse(name, 503, "temporarily_unavailable");
    if (Buffer.byteLength(target) > MAX_TARGET_BYTES)
      return refuse(name, 414, "invalid_request");
    const host = request.headers.get("host")?.toLowerCase();
    if (host === undefined || !hostAccepted(host, route))
      return refuse(name, 403, "invalid_host");
    if (!route) return refuse("unknown", 404, "not_found");
    if (!route.methods.includes(request.method))
      return refuse(name, 405, "method_not_allowed", {
        allow: route.methods.join(", "),
      });
    const limit = request.method === "POST" ? route.limit : undefined;
    const framing = framingRefusal(
      request.headers.get("content-length"),
      request.headers.get("transfer-encoding"),
      limit,
    );
    if (framing === "invalid") return refuse(name, 400, "invalid_request");
    if (framing === "too_large") return refuse(name, 413, "payload_too_large");
    if (originRefused(request, name))
      return refuse(name, 403, "invalid_origin");
    if (name === "health") return health(host);
    if (name === "mcp") return await mcp(request, target);
    if (!proxy) throw new Error("proxy");
    if (name === "prm")
      return new Response(
        JSON.stringify({
          resource: publicUrl,
          authorization_servers: [publicUrl],
          bearer_methods_supported: ["header"],
        }),
        { status: 200, headers: { "content-type": JSON_TYPE } },
      );
    if (name === "as_metadata") return fromProxy(proxy.metadata());
    return await oauth(request, target, route);
  }

  return {
    async handle(request, target) {
      try {
        return await dispatch(request, target);
      } catch {
        return refuse(routeOf(target), 500, "server_error");
      }
    },
    routeOf,
    async close() {
      closing = true;
      // BR-169 v3 step (2): pending CIMD fetches end with the 503 page.
      proxy?.cancelFetches();
      await registry.closeAll("shutdown");
    },
    closeStore,
  };
}

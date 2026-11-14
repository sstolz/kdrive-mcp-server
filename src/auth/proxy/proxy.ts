import { createHash, timingSafeEqual } from "node:crypto";
import type { JWK } from "jose";
import {
  ALLOWED_ALGORITHMS,
  createAccessTokenValidator,
  decodeCompact,
  hasMatchingKey,
  isRecord,
  usableKeys,
  verifiesWithKeys,
  type AccessTokenValidator,
} from "../access-token.js";
import {
  acceptableCimdClientId,
  createClientMetadataResolver,
  type ClientMetadataFetch,
  type MetadataRefusal,
  type ResolvedCimdClient,
} from "./client-metadata.js";
import { createClientMetadataFetch } from "./client-metadata-fetch.js";
import { loadSigningKey, signAccessToken } from "./keys.js";
import {
  consentPage,
  errorPage,
  type ErrorPage,
  type ProxyResponse,
} from "./pages.js";
import { redirectMatches } from "./redirect.js";
import {
  clientIdle,
  familyExpired,
  type OAuthStateBinding,
  type OAuthStateStore,
  type StoredClient,
  type StoredFamily,
  type StoreWrite,
} from "./store.js";
import type { UpstreamOidcPort } from "./upstream.js";

/** The F-002 proxy fields that F-010 consumes. */
export interface EffectiveProxyConfig {
  publicUrl: string;
  oauthIssuer: string;
  oauthAudience?: string;
  oauthAllowedSubjects: readonly string[];
  oauthAllowedEmails: readonly string[];
  oauthUpstreamClientId: string;
  oauthUpstreamClientSecret: string;
  oauthSigningKey: Uint8Array;
  oauthAllowedRedirectUris: readonly string[];
  /** F-028 BR-291: CIMD origins; absent or empty keeps CIMD off. */
  oauthAllowedClientIdOrigins?: readonly string[];
}

/** BR-143: the only event names the logger receives. */
export type ProxyEvent =
  | "registration_refused"
  | "authorization_refused"
  | "consent_refused"
  | "upstream_unavailable"
  | "callback_refused"
  | "id_token_refused"
  | "identity_refused"
  | "token_refused"
  | "refresh_family_revoked"
  | "store_full"
  | "store_write_failed"
  | "store_loaded"
  // F-028 BR-394.
  | "client_metadata_refused"
  | "client_metadata_fetched";

export interface ProxyLogger {
  event(name: ProxyEvent, fields: Record<string, string | number>): void;
}

export interface OAuthProxyOptions {
  config: EffectiveProxyConfig;
  clock: () => Date;
  randomBytes: (size: number) => Uint8Array;
  upstream: UpstreamOidcPort;
  logger?: ProxyLogger;
  /** BR-124 v2 / BR-292: the opened, checked, purged and loaded state store. */
  store?: OAuthStateStore;
  /**
   * F-028: the CIMD fetch port. Absent, the production port without any seam
   * is used (AC-13).
   */
  clientMetadataFetch?: ClientMetadataFetch;
}

export interface OAuthProxy {
  readonly kid: string;
  readonly metadataPaths: readonly string[];
  metadata(): ProxyResponse;
  register(input: { body: string }): Promise<ProxyResponse>;
  authorize(input: {
    query: URLSearchParams;
    cookie?: string;
  }): Promise<ProxyResponse>;
  consent(input: {
    form: URLSearchParams;
    cookie?: string;
  }): Promise<ProxyResponse>;
  callback(input: {
    query: URLSearchParams;
    cookie?: string;
  }): Promise<ProxyResponse>;
  token(input: {
    authorization?: string;
    form: URLSearchParams;
  }): Promise<ProxyResponse>;
  verifier: AccessTokenValidator;
  /**
   * F-028 BR-309 / BR-169 v3 step (2): cancels every in-flight CIMD fetch;
   * the authorization requests waiting on one get the 503 page.
   */
  cancelFetches(): void;
}

const SECOND = 1000;
/** BR-142 store bound. */
export const STORE_LIMIT = 1000;
const CONSENT_TTL = 600 * SECOND;
const FLOW_TTL = 600 * SECOND;
const CODE_TTL = 60 * SECOND;
const ACCESS_TTL_SECONDS = 3600;
const RETRY_INTERVAL = 60 * SECOND;
const JWKS_TTL = 3600 * SECOND;
const MAX_REGISTRATION_BYTES = 16_384;
const MAX_STATE_BYTES = 1024;
const COOKIE_NAME = "__Host-kdrive-oauth";
const COOKIE_ATTRIBUTES =
  "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600";
const TOKEN_VALUE = /^[A-Za-z0-9_-]{43}$/u;
/** BR-139 v2: `<family id>.<secret>`. */
const REFRESH_TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/u;
const CONTROL = /\p{Cc}/u;
const GRANTS = ["authorization_code", "refresh_token"] as const;
const METHODS = ["none", "client_secret_basic", "client_secret_post"] as const;
type Method = (typeof METHODS)[number];
type Grant = (typeof GRANTS)[number];

interface Client {
  id: string;
  redirectUris: string[];
  grantTypes: Grant[];
  method: Method;
  name: string | undefined;
  secretHash: Buffer | undefined;
  lastUse: number;
}

interface PendingRequest {
  clientId: string;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  resource: string;
  /** F-028 BR-308: the CIMD client's kept grants, snapshotted at resolution. */
  cimdGrants?: readonly Grant[];
}

interface Consent {
  request: PendingRequest;
  cookieHash: Buffer;
  created: number;
}

interface Flow {
  request: PendingRequest;
  cookieHash: Buffer;
  created: number;
  verifier: string;
  nonce: string;
}

interface Identity {
  sub: string;
  email: unknown;
  emailVerified: unknown;
}

interface Code {
  request: PendingRequest;
  identity: Identity;
  created: number;
  consumed: boolean;
  familyId: string | undefined;
}

/** BR-139 v2: one current secret hash per family; revoked families are deleted. */
interface Family {
  id: string;
  clientId: string;
  identity: Identity;
  resource: string;
  created: number;
  tokenHash: Buffer;
  /** The current secret's issue time, never before `created` (BR-298). */
  lastIssued: number;
}

/**
 * BR-298/BR-299: the writes of one request and their in-memory effects. The
 * effects apply only once the writes are committed; `revoke` effects apply
 * even when the commit fails (BR-299: revocations already decided are kept).
 */
interface Change {
  writes: StoreWrite[];
  apply: Array<() => void>;
  revoke: Array<() => void>;
  goneFamilies: Set<string>;
  goneClients: Set<string>;
}

interface Discovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  basic: boolean;
  issParameter: boolean;
}

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hasRepetition(params: URLSearchParams): boolean {
  const keys = [...params.keys()];
  return new Set(keys).size !== keys.length;
}

/** Appends form-encoded pairs to a URI that may already hold a query. */
function appendQuery(uri: string, pairs: Array<[string, string]>): string {
  const query = new URLSearchParams(pairs).toString();
  if (!uri.includes("?")) return `${uri}?${query}`;
  return uri.endsWith("?") || uri.endsWith("&")
    ? `${uri}${query}`
    : `${uri}&${query}`;
}

function formEncode(value: string): string {
  return new URLSearchParams([["", value]]).toString().slice(1);
}

function formDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return undefined;
  }
}

/** BR-130: the single well-formed binding cookie, or undefined. */
function boundCookie(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`))
    .map((part) => part.slice(COOKIE_NAME.length + 1));
  return values.length === 1 && TOKEN_VALUE.test(values[0] ?? "")
    ? values[0]
    : undefined;
}

function validState(state: string | null): boolean {
  return (
    state === null ||
    (state.length > 0 &&
      Buffer.byteLength(state) <= MAX_STATE_BYTES &&
      !CONTROL.test(state))
  );
}

/**
 * BR-393: scheme `http` and host an IPv4 address in `127.0.0.0/8`, `[::1]` or
 * `localhost`.
 */
function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return (
    host === "localhost" ||
    host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
  );
}

function canonical(url: string): string {
  // eslint-disable-next-line sonarjs/super-linear-regex -- F-011: applied only to short, locally bounded strings
  return new URL(url).href.replace(/\/+$/u, "");
}

/** BR-296: the exact issuer, audience and upstream strings the proxy uses for its tokens. */
export function stateBinding(config: EffectiveProxyConfig): OAuthStateBinding {
  return {
    issuer: canonical(config.publicUrl),
    audience: config.oauthAudience ?? config.publicUrl,
    upstreamIssuer: canonical(config.oauthIssuer),
  };
}

const snapshots = new WeakMap<OAuthProxy, () => unknown>();

/** Test seam (F-019 AC-09): a JSON-serializable copy of every in-memory store. */
export function proxyStateSnapshot(proxy: OAuthProxy): unknown {
  return snapshots.get(proxy)?.();
}

/** BR-300: the claim as JSON text, or null when it is absent. */
function jsonText(value: unknown): string | null {
  if (value === undefined) return null;
  const text: unknown = JSON.stringify(value);
  return typeof text === "string" ? text : null;
}

function parseJsonText(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function loadClient(row: StoredClient) {
  return {
    id: row.id,
    redirectUris: [...row.redirectUris],
    grantTypes: [...row.grantTypes],
    method: row.method,
    name: row.name ?? undefined,
    secretHash:
      row.secretHash === null ? undefined : Buffer.from(row.secretHash),
    lastUse: row.lastUse,
  };
}

function loadFamily(row: StoredFamily) {
  return {
    id: row.id,
    clientId: row.clientId,
    identity: {
      sub: row.sub,
      email: row.email ?? undefined,
      emailVerified: parseJsonText(row.emailVerified),
    },
    resource: row.resource,
    created: row.created,
    tokenHash: Buffer.from(row.tokenHash),
    lastIssued: Math.max(row.tokenIssued, row.created),
  };
}

/** BR-124–BR-143: the transport-independent OAuth proxy. */
export function createOAuthProxy(options: OAuthProxyOptions): OAuthProxy {
  const { config, clock, upstream, logger, store } = options;
  const key = loadSigningKey(config.oauthSigningKey);
  const { issuer, audience, upstreamIssuer } = stateBinding(config);
  const emailsEnabled = config.oauthAllowedEmails.length > 0;
  const callbackUri = `${issuer}/oauth/callback`;
  const issuerPath = new URL(issuer).pathname.replace(/\/$/u, "");
  const metadataPaths = [
    ...new Set([
      `/.well-known/oauth-authorization-server${issuerPath}`,
      `/.well-known/openid-configuration${issuerPath}`,
      `${issuerPath}/.well-known/openid-configuration`,
    ]),
  ];

  const clients = new Map<string, Client>();
  const consents = new Map<string, Consent>();
  const flows = new Map<string, Flow>();
  const codes = new Map<string, Code>();
  const families = new Map<string, Family>();
  /** BR-299: set when a commit fails or meets a closed store; never cleared. */
  let latched = false;
  /** Reads the latch after an await, where it may have been set meanwhile. */
  const isLatched = () => latched;
  let discovery: Discovery | undefined;
  let lastDiscovery: number | undefined;
  let discovering: Promise<Discovery | undefined> | undefined;
  let jwks: { keys: JWK[]; fetched: number } | undefined;
  let lastJwksFetch: number | undefined;

  const now = () => clock().getTime();
  const random = (size: number) =>
    Buffer.from(options.randomBytes(size)).toString("base64url");
  const log = (name: ProxyEvent, fields: Record<string, string | number>) =>
    logger?.event(name, fields);

  // ---- F-028: Client ID Metadata Documents ---------------------------------
  const origins = config.oauthAllowedClientIdOrigins ?? [];
  const cimdBinding = { issuer, audience, upstreamIssuer };
  const metadataLayer =
    origins.length > 0
      ? createClientMetadataResolver({
          port: options.clientMetadataFetch ?? createClientMetadataFetch(),
          clock: now,
          allowedRedirectUris: config.oauthAllowedRedirectUris,
          onFetched: (count) => {
            log("client_metadata_fetched", { status: 200, count });
          },
        })
      : undefined;
  /** BR-305 with the current configuration. */
  const acceptable = (clientId: string) =>
    acceptableCimdClientId(clientId, origins, cimdBinding);

  // ---- BR-292: state loaded from the store, after its startup purge -------
  if (store) {
    for (const row of store.clients) clients.set(row.id, loadClient(row));
    for (const row of store.families) families.set(row.id, loadFamily(row));
    log("store_loaded", { clients: clients.size, families: families.size });
  }

  const verifier = createAccessTokenValidator({
    issuer,
    audience,
    jwks: { keys: [key.publicJwk] },
    allowedSubjects: config.oauthAllowedSubjects.map((sub) => ({
      iss: upstreamIssuer,
      sub,
    })),
    allowedEmails: config.oauthAllowedEmails,
    upstreamIssuer,
  });

  // ---- BR-142 v2: bounded stores ------------------------------------------
  /** The memory-only stores (consents, flows, codes); never persisted (BR-292). */
  function purge(time: number): void {
    for (const [id, entry] of consents)
      if (time >= entry.created + CONSENT_TTL) consents.delete(id);
    for (const [id, entry] of flows)
      if (time >= entry.created + FLOW_TTL) flows.delete(id);
    for (const [id, entry] of codes)
      if (time >= entry.created + CODE_TTL) codes.delete(id);
  }

  function full(name: string, size: number): boolean {
    if (size < STORE_LIMIT) return false;
    log("store_full", { store: name, count: size });
    return true;
  }

  function removeClient(id: string): void {
    clients.delete(id);
    for (const [value, code] of codes)
      if (code.request.clientId === id) codes.delete(value);
    for (const family of [...families.values()])
      if (family.clientId === id) families.delete(family.id);
  }

  function familyGone(change: Change, family: Family): boolean {
    return (
      change.goneFamilies.has(family.id) ||
      change.goneClients.has(family.clientId)
    );
  }

  function liveFamilies(change: Change): Family[] {
    return [...families.values()].filter(
      (family) => !familyGone(change, family),
    );
  }

  function liveClients(change: Change): Client[] {
    return [...clients.values()].filter(
      (client) => !change.goneClients.has(client.id),
    );
  }

  /** A family delete; a family deleted with its client needs no write of its own. */
  function dropFamilyIn(change: Change, family: Family): void {
    if (familyGone(change, family)) return;
    change.goneFamilies.add(family.id);
    change.writes.push({ op: "deleteFamily", id: family.id });
    change.apply.push(() => families.delete(family.id));
  }

  /** A client delete; the store deletes its families with it. */
  function dropClientIn(change: Change, client: Client): void {
    if (change.goneClients.has(client.id)) return;
    change.goneClients.add(client.id);
    change.writes.push({ op: "deleteClient", id: client.id });
    change.apply.push(() => {
      removeClient(client.id);
    });
  }

  /** BR-302: a change starts with the purge of expired families and idle clients. */
  function begin(time: number): Change {
    const change: Change = {
      writes: [],
      apply: [],
      revoke: [],
      goneFamilies: new Set(),
      goneClients: new Set(),
    };
    for (const family of families.values())
      if (
        familyExpired(
          { created: family.created, tokenIssued: family.lastIssued },
          time,
        )
      )
        dropFamilyIn(change, family);
    const live = new Set(liveFamilies(change).map((family) => family.clientId));
    for (const client of clients.values())
      if (!live.has(client.id) && clientIdle(client, time))
        dropClientIn(change, client);
    return change;
  }

  /** BR-142 v2: the client with the oldest last use goes, with its families. */
  function evictClient(change: Change): void {
    let oldest: Client | undefined;
    for (const client of liveClients(change))
      if (oldest === undefined || client.lastUse < oldest.lastUse)
        oldest = client;
    if (oldest) dropClientIn(change, oldest);
  }

  /** BR-142 v2: the family with the oldest creation goes. */
  function evictFamily(change: Change): void {
    let oldest: Family | undefined;
    for (const family of liveFamilies(change))
      if (oldest === undefined || family.created < oldest.created)
        oldest = family;
    if (oldest) dropFamilyIn(change, oldest);
  }

  /**
   * BR-298/BR-299: commits the change in one synchronous transaction, then
   * applies its effects; a failed or closed commit latches the proxy, keeps
   * only the revocations and returns false.
   */
  function persist(change: Change, handler: string, name: string): boolean {
    if (store && change.writes.length > 0) {
      const result = store.commit(change.writes);
      if (result !== "committed") {
        latched = true;
        // BR-304: a write on a store already closed latches without an event.
        if (result === "failed")
          log("store_write_failed", { handler, store: name });
        for (const effect of change.revoke) effect();
        return false;
      }
    }
    for (const effect of change.apply) effect();
    return true;
  }

  function storedClient(client: Client): StoredClient {
    return {
      id: client.id,
      redirectUris: [...client.redirectUris],
      grantTypes: [...client.grantTypes],
      method: client.method,
      name: client.name ?? null,
      secretHash: client.secretHash ?? null,
      lastUse: client.lastUse,
    };
  }

  /** BR-300: email only with a nonempty email allowlist and a string claim. */
  function familyIdentity(identity: Identity): Identity {
    return emailsEnabled
      ? {
          sub: identity.sub,
          email:
            typeof identity.email === "string" ? identity.email : undefined,
          emailVerified: identity.emailVerified,
        }
      : { sub: identity.sub, email: undefined, emailVerified: undefined };
  }

  function storedFamily(family: Family): StoredFamily {
    const { identity } = family;
    return {
      id: family.id,
      clientId: family.clientId,
      sub: identity.sub,
      email: typeof identity.email === "string" ? identity.email : null,
      emailVerified: jsonText(identity.emailVerified),
      resource: family.resource,
      created: family.created,
      tokenHash: family.tokenHash,
      tokenIssued: family.lastIssued,
    };
  }

  // ---- shared responses --------------------------------------------------
  function clientRedirect(
    request: PendingRequest,
    pairs: Array<[string, string]>,
    extra: Array<[string, string]> = [],
  ): ProxyResponse {
    const all: Array<[string, string]> = [...pairs];
    if (request.state !== undefined) all.push(["state", request.state]);
    all.push(["iss", issuer]);
    return {
      status: 302,
      headers: [
        ["Location", appendQuery(request.redirectUri, all)],
        ["Cache-Control", "no-store"],
        ...extra,
      ],
      body: "",
    };
  }

  function refusePage(
    event: ProxyEvent,
    handler: string,
    kind: ErrorPage,
    status = 400,
  ): ProxyResponse {
    log(event, { handler, status });
    return errorPage(kind, status);
  }

  function refuseRedirect(
    event: ProxyEvent,
    handler: string,
    request: PendingRequest,
    error: string,
  ): ProxyResponse {
    log(event, { handler, error });
    return clientRedirect(request, [["error", error]]);
  }

  function setCookie(value: string): string {
    return `${COOKIE_NAME}=${value}${COOKIE_ATTRIBUTES}`;
  }

  function tokenJson(
    status: number,
    body: Record<string, unknown>,
    extra: Array<[string, string]> = [],
  ): ProxyResponse {
    return {
      status,
      headers: [
        ["Content-Type", "application/json"],
        ["Cache-Control", "no-store"],
        ["Pragma", "no-cache"],
        ...extra,
      ],
      body: JSON.stringify(body),
    };
  }

  function tokenError(
    status: number,
    error: string,
    extra: Array<[string, string]> = [],
  ): ProxyResponse {
    log("token_refused", { handler: "token", error, status });
    return tokenJson(status, { error }, extra);
  }

  // ---- BR-125 -------------------------------------------------------------
  function metadata(): ProxyResponse {
    return {
      status: 200,
      headers: [["Content-Type", "application/json"]],
      body: JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: [...GRANTS],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [...METHODS],
        authorization_response_iss_parameter_supported: true,
        // BR-125 v2: only with a nonempty origin list.
        ...(metadataLayer === undefined
          ? {}
          : { client_id_metadata_document_supported: true }),
      }),
    };
  }

  // ---- BR-127 -------------------------------------------------------------
  function registrationError(error: string, status = 400): ProxyResponse {
    log("registration_refused", { handler: "register", error, status });
    return {
      status,
      headers: [
        ["Content-Type", "application/json"],
        ["Cache-Control", "no-store"],
      ],
      body: JSON.stringify({ error }),
    };
  }

  function parseMetadata(
    data: Record<string, unknown>,
  ): { method: Method; grants: Grant[]; name: string | undefined } | undefined {
    const method = data.token_endpoint_auth_method ?? "client_secret_basic";
    if (!METHODS.includes(method as Method)) return undefined;
    const grantList = data.grant_types ?? [...GRANTS];
    if (
      !Array.isArray(grantList) ||
      !grantList.every((grant) => GRANTS.includes(grant as Grant)) ||
      !grantList.includes("authorization_code")
    )
      return undefined;
    const responses = data.response_types;
    if (
      responses !== undefined &&
      !(
        Array.isArray(responses) &&
        responses.length === 1 &&
        responses[0] === "code"
      )
    )
      return undefined;
    const name = data.client_name;
    if (
      name !== undefined &&
      (typeof name !== "string" ||
        // eslint-disable-next-line @typescript-eslint/no-misused-spread -- F-011: code-point iteration of the string is intended
        [...name].length < 1 ||
        // eslint-disable-next-line @typescript-eslint/no-misused-spread -- F-011: code-point iteration of the string is intended
        [...name].length > 200 ||
        CONTROL.test(name))
    )
      return undefined;
    return {
      method: method as Method,
      grants: GRANTS.filter((grant) => grantList.includes(grant)),
      name,
    };
  }

  function validRedirects(value: unknown): value is string[] {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 10 &&
      new Set(value).size === value.length &&
      value.every(
        (uri) =>
          typeof uri === "string" &&
          config.oauthAllowedRedirectUris.some((entry) =>
            redirectMatches(uri, entry),
          ),
      )
    );
  }

  function register(input: { body: string }): Promise<ProxyResponse> {
    // BR-299: a latched store answers 503 before reading anything.
    if (latched)
      return Promise.resolve(registrationError("temporarily_unavailable", 503));
    if (Buffer.byteLength(input.body) > MAX_REGISTRATION_BYTES)
      return Promise.resolve(registrationError("invalid_client_metadata"));
    let data: unknown;
    try {
      data = JSON.parse(input.body) as unknown;
    } catch {
      data = undefined;
    }
    if (!isRecord(data))
      return Promise.resolve(registrationError("invalid_client_metadata"));
    const parsed = parseMetadata(data);
    if (!parsed)
      return Promise.resolve(registrationError("invalid_client_metadata"));
    const redirects = data.redirect_uris;
    if (!validRedirects(redirects))
      return Promise.resolve(registrationError("invalid_redirect_uri"));
    const time = now();
    const change = begin(time);
    if (full("clients", liveClients(change).length)) evictClient(change);
    const id = random(32);
    const secret = parsed.method === "none" ? undefined : random(32);
    const client: Client = {
      id,
      redirectUris: [...redirects],
      grantTypes: parsed.grants,
      method: parsed.method,
      name: parsed.name,
      secretHash: secret === undefined ? undefined : sha256(secret),
      lastUse: time,
    };
    change.writes.push({ op: "insertClient", client: storedClient(client) });
    change.apply.push(() => clients.set(id, client));
    // BR-298: the 201 is built only after the client row is committed.
    if (!persist(change, "register", "clients"))
      return Promise.resolve(registrationError("temporarily_unavailable", 503));
    const body: Record<string, unknown> = {
      client_id: id,
      client_id_issued_at: Math.floor(time / SECOND),
      redirect_uris: [...redirects],
      grant_types: parsed.grants,
      response_types: ["code"],
      token_endpoint_auth_method: parsed.method,
      ...(parsed.name === undefined ? {} : { client_name: parsed.name }),
      ...(secret === undefined
        ? {}
        : { client_secret: secret, client_secret_expires_at: 0 }),
    };
    return Promise.resolve({
      status: 201,
      headers: [
        ["Content-Type", "application/json"],
        ["Cache-Control", "no-store"],
      ],
      body: JSON.stringify(body),
    });
  }

  // ---- BR-128, BR-129, BR-130 ----------------------------------------------
  function authorize(input: {
    query: URLSearchParams;
    cookie?: string;
  }): Promise<ProxyResponse> {
    const clientId = input.query.get("client_id") ?? "";
    // F-028 Contract details "Authorization refusal events": CIMD only with
    // a nonempty list; every other request keeps today's handling.
    if (metadataLayer !== undefined && clientId.startsWith("https://"))
      return authorizeCimd(input.query, input.cookie, clientId, metadataLayer);
    return Promise.resolve(authorizeNow(input.query, input.cookie));
  }

  function authorizeNow(
    query: URLSearchParams,
    cookie: string | undefined,
  ): ProxyResponse {
    if (latched)
      return refusePage("authorization_refused", "authorize", "busy", 503);
    const refuse = () =>
      refusePage("authorization_refused", "authorize", "invalid_request");
    if (hasRepetition(query)) return refuse();
    const client = clients.get(query.get("client_id") ?? "");
    const redirectUri = query.get("redirect_uri");
    // BR-128 v2: a registered URI that is still allowed by the current list.
    if (
      !client ||
      redirectUri === null ||
      !client.redirectUris.some((entry) =>
        redirectMatches(redirectUri, entry),
      ) ||
      !allowlisted(redirectUri)
    )
      return refuse();
    return admit(query, cookie, redirectUri, {
      id: client.id,
      name: client.name,
      touch: (time) => {
        client.lastUse = time;
      },
    });
  }

  function allowlisted(redirectUri: string): boolean {
    return config.oauthAllowedRedirectUris.some((entry) =>
      redirectMatches(redirectUri, entry),
    );
  }

  function metadataRefused(
    reason: MetadataRefusal,
    status: number,
    page: 400 | 503,
  ): ProxyResponse {
    log("client_metadata_refused", { handler: "authorize", reason, status });
    return errorPage(page === 503 ? "busy" : "invalid_request", page);
  }

  /** BR-128 v3: the CIMD checks, each before any fetch, then the resolution. */
  async function authorizeCimd(
    query: URLSearchParams,
    cookie: string | undefined,
    clientId: string,
    layer: NonNullable<typeof metadataLayer>,
  ): Promise<ProxyResponse> {
    const busy = () =>
      refusePage("authorization_refused", "authorize", "busy", 503);
    if (latched) return busy();
    const refuse = () =>
      refusePage("authorization_refused", "authorize", "invalid_request");
    if (hasRepetition(query)) return refuse();
    if (!acceptable(clientId)) return metadataRefused("not_allowed", 0, 400);
    const redirectUri = query.get("redirect_uri");
    if (redirectUri === null || !allowlisted(redirectUri)) return refuse();
    const resolution = await layer.resolve(clientId);
    // BR-169 v3 / BR-299: closing, or latched during the await.
    if (resolution.kind === "closed" || isLatched()) return busy();
    if (resolution.kind === "refused")
      return metadataRefused(
        resolution.reason,
        resolution.status,
        resolution.transient ? 503 : 400,
      );
    const resolved: ResolvedCimdClient = resolution.client;
    if (
      !resolved.redirectUris.some((entry) =>
        redirectMatches(redirectUri, entry),
      )
    )
      return metadataRefused("document", 200, 400);
    return admit(query, cookie, redirectUri, {
      id: clientId,
      name: resolved.name,
      cimd: {
        grants: [...resolved.grantTypes],
        host: new URL(clientId).hostname,
        loopback: isLoopbackRedirect(redirectUri),
      },
    });
  }

  /** The checks after the client and redirect URI, then the consent page. */
  function admit(
    query: URLSearchParams,
    cookie: string | undefined,
    redirectUri: string,
    client: {
      id: string;
      name: string | undefined;
      touch?: (time: number) => void;
      cimd?: { grants: Grant[]; host: string; loopback: boolean };
    },
  ): ProxyResponse {
    const state = query.get("state");
    const stateOk = validState(state);
    const challenge = query.get("code_challenge");
    const request: PendingRequest = {
      clientId: client.id,
      redirectUri,
      state: stateOk && state !== null ? state : undefined,
      codeChallenge: challenge ?? "",
      resource: query.get("resource") ?? "",
      ...(client.cimd === undefined ? {} : { cimdGrants: client.cimd.grants }),
    };
    const fail = (error: string) =>
      refuseRedirect("authorization_refused", "authorize", request, error);
    if (query.get("response_type") !== "code")
      return fail("unsupported_response_type");
    if (!stateOk) return fail("invalid_request");
    if (
      challenge === null ||
      !TOKEN_VALUE.test(challenge) ||
      query.get("code_challenge_method") !== "S256"
    )
      return fail("invalid_request");
    if (request.resource !== audience) return fail("invalid_target");
    const time = now();
    client.touch?.(time);
    purge(time);
    if (full("consents", consents.size))
      return refusePage("store_full", "authorize", "busy", 503);
    const binding = boundCookie(cookie) ?? random(32);
    const consentId = random(32);
    consents.set(consentId, {
      request,
      cookieHash: sha256(binding),
      created: time,
    });
    return consentPage(
      {
        clientName: client.name,
        clientId: client.id,
        redirectUri,
        resource: audience,
        action: `${issuer}/oauth/consent`,
        consentId,
        ...(client.cimd === undefined
          ? {}
          : {
              cimd: { host: client.cimd.host, loopback: client.cimd.loopback },
            }),
      },
      setCookie(binding),
    );
  }

  function cookieMatches(header: string | undefined, hash: Buffer): boolean {
    const value = boundCookie(header);
    return value !== undefined && sameHash(sha256(value), hash);
  }

  async function consent(input: {
    form: URLSearchParams;
    cookie?: string;
  }): Promise<ProxyResponse> {
    if (latched) return refusePage("consent_refused", "consent", "busy", 503);
    const refuse = () => refusePage("consent_refused", "consent", "consent");
    const id = input.form.get("consent") ?? "";
    const entry = consents.get(id);
    consents.delete(id);
    const time = now();
    const decision = input.form.get("decision");
    if (
      !entry ||
      hasRepetition(input.form) ||
      time >= entry.created + CONSENT_TTL ||
      !cookieMatches(input.cookie, entry.cookieHash) ||
      (decision !== "approve" && decision !== "deny")
    )
      return refuse();
    if (decision === "deny")
      return refuseRedirect(
        "consent_refused",
        "consent",
        entry.request,
        "access_denied",
      );
    const binding = boundCookie(input.cookie) ?? "";
    const found = await discover(time);
    // BR-299: a store latched during the await takes no new flow.
    if (isLatched())
      return refusePage("consent_refused", "consent", "busy", 503);
    if (!found)
      return refuseRedirect(
        "upstream_unavailable",
        "consent",
        entry.request,
        "temporarily_unavailable",
      );
    const after = now();
    purge(after);
    if (full("flows", flows.size))
      return refuseRedirect(
        "store_full",
        "consent",
        entry.request,
        "temporarily_unavailable",
      );
    const state = random(32);
    const verifierValue = random(32);
    const nonce = random(32);
    flows.set(state, {
      request: entry.request,
      cookieHash: entry.cookieHash,
      created: after,
      verifier: verifierValue,
      nonce,
    });
    const location = appendQuery(found.authorizationEndpoint, [
      ["response_type", "code"],
      ["client_id", config.oauthUpstreamClientId],
      ["redirect_uri", callbackUri],
      ["scope", emailsEnabled ? "openid email" : "openid"],
      ["state", state],
      ["nonce", nonce],
      ["code_challenge", sha256(verifierValue).toString("base64url")],
      ["code_challenge_method", "S256"],
    ]);
    return {
      status: 302,
      headers: [
        ["Location", location],
        ["Cache-Control", "no-store"],
        ["Set-Cookie", setCookie(binding)],
      ],
      body: "",
    };
  }

  // ---- BR-131 -------------------------------------------------------------
  function evaluateDiscovery(reply: {
    status: number;
    json: unknown;
  }): Discovery | undefined {
    const document = reply.json;
    if (reply.status !== 200 || !isRecord(document)) return undefined;
    if (document.issuer !== upstreamIssuer) return undefined;
    const { authorization_endpoint, token_endpoint, jwks_uri } = document;
    if (
      !isHttpsUrl(authorization_endpoint) ||
      !isHttpsUrl(token_endpoint) ||
      !isHttpsUrl(jwks_uri)
    )
      return undefined;
    const pkce = document.code_challenge_methods_supported;
    if (!Array.isArray(pkce) || !pkce.includes("S256")) return undefined;
    const methods = document.token_endpoint_auth_methods_supported;
    let basic: boolean;
    if (
      methods === undefined ||
      (Array.isArray(methods) && methods.includes("client_secret_basic"))
    )
      basic = true;
    else if (Array.isArray(methods) && methods.includes("client_secret_post"))
      basic = false;
    else return undefined;
    return {
      authorizationEndpoint: authorization_endpoint,
      tokenEndpoint: token_endpoint,
      jwksUri: jwks_uri,
      basic,
      issParameter:
        document.authorization_response_iss_parameter_supported === true,
    };
  }

  async function fetchDiscovery(): Promise<Discovery | undefined> {
    try {
      discovery = evaluateDiscovery(
        await upstream.fetchJson(
          `${upstreamIssuer}/.well-known/openid-configuration`,
        ),
      );
    } catch {
      discovery = undefined;
    }
    return discovery;
  }

  /** BR-131: one discovery at a time; concurrent approvals share it. */
  async function discover(time: number): Promise<Discovery | undefined> {
    if (discovery) return discovery;
    if (discovering) return discovering;
    if (lastDiscovery !== undefined && time < lastDiscovery + RETRY_INTERVAL)
      return undefined;
    lastDiscovery = time;
    discovering = fetchDiscovery();
    try {
      return await discovering;
    } finally {
      discovering = undefined;
    }
  }

  // ---- BR-133 -------------------------------------------------------------
  async function fetchJwks(found: Discovery, time: number): Promise<void> {
    lastJwksFetch = time;
    try {
      const reply = await upstream.fetchJson(found.jwksUri);
      if (reply.status === 200)
        jwks = { keys: usableKeys(reply.json), fetched: time };
    } catch {
      // A cache within its TTL stays; an expired one was already discarded.
    }
  }

  const mayFetchJwks = (time: number) =>
    lastJwksFetch === undefined || time >= lastJwksFetch + RETRY_INTERVAL;

  async function keysFor(
    found: Discovery,
    alg: string,
    kid: unknown,
    time: number,
  ): Promise<JWK[]> {
    // BR-133: a cache is never used after 3,600 s, even if the refetch fails.
    if (jwks && time >= jwks.fetched + JWKS_TTL) jwks = undefined;
    if (!jwks && mayFetchJwks(time)) await fetchJwks(found, time);
    const keys = () => jwks?.keys ?? [];
    if (
      typeof kid === "string" &&
      !hasMatchingKey(keys(), alg, kid) &&
      mayFetchJwks(time)
    )
      await fetchJwks(found, time);
    return keys();
  }

  async function verifyIdToken(
    found: Discovery,
    token: unknown,
    nonce: string,
    time: number,
  ): Promise<Identity | undefined> {
    if (typeof token !== "string") return undefined;
    const decoded = decodeCompact(token);
    if (!decoded || decoded.header.crit !== undefined) return undefined;
    const { header, payload } = decoded;
    const alg = header.alg;
    if (typeof alg !== "string" || !ALLOWED_ALGORITHMS.includes(alg))
      return undefined;
    if (header.kid !== undefined && typeof header.kid !== "string")
      return undefined;
    const keys = await keysFor(found, alg, header.kid, time);
    if (!(await verifiesWithKeys(token, keys, alg, header.kid)))
      return undefined;
    const client = config.oauthUpstreamClientId;
    const aud = payload.aud;
    const audOk =
      aud === client || (Array.isArray(aud) && aud.includes(client));
    const multiple = Array.isArray(aud) && aud.length > 1;
    const azpOk =
      payload.azp === undefined ? !multiple : payload.azp === client;
    const seconds = time / SECOND;
    const sub = payload.sub;
    if (
      payload.iss !== upstreamIssuer ||
      !audOk ||
      !azpOk ||
      payload.nonce !== nonce ||
      typeof payload.exp !== "number" ||
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- F-011: the negated comparison is NaN-safe; the opposite operator would accept NaN
      !(payload.exp > seconds) ||
      typeof payload.iat !== "number" ||
      (payload.nbf !== undefined &&
        (typeof payload.nbf !== "number" || payload.nbf > seconds)) ||
      typeof sub !== "string" ||
      sub === "" ||
      Buffer.byteLength(sub) > 255
    )
      return undefined;
    return { sub, email: payload.email, emailVerified: payload.email_verified };
  }

  // ---- BR-134 -------------------------------------------------------------
  function authorized(identity: Identity): boolean {
    return (
      config.oauthAllowedSubjects.includes(identity.sub) ||
      (typeof identity.email === "string" &&
        config.oauthAllowedEmails.includes(identity.email) &&
        identity.emailVerified === true)
    );
  }

  // ---- BR-132, BR-135 -------------------------------------------------------
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function callback(input: {
    query: URLSearchParams;
    cookie?: string;
  }): Promise<ProxyResponse> {
    if (latched) return refusePage("callback_refused", "callback", "busy", 503);
    const { query } = input;
    const states = query.getAll("state");
    const flow = states.length === 1 ? flows.get(states[0] ?? "") : undefined;
    for (const state of states) flows.delete(state);
    const time = now();
    if (
      !flow ||
      hasRepetition(query) ||
      time >= flow.created + FLOW_TTL ||
      !cookieMatches(input.cookie, flow.cookieHash) ||
      !discovery
    )
      return refusePage("callback_refused", "callback", "callback");
    const found = discovery;
    const request = flow.request;
    const fail = (event: ProxyEvent, error: string) =>
      refuseRedirect(event, "callback", request, error);
    const iss = query.get("iss");
    if (
      (found.issParameter && iss === null) ||
      (iss !== null && iss !== upstreamIssuer)
    )
      return fail("callback_refused", "server_error");
    const code = query.get("code");
    const error = query.get("error");
    if ((code !== null) === (error !== null) || code === "")
      return fail("callback_refused", "server_error");
    if (error !== null)
      return fail(
        "callback_refused",
        error === "access_denied" ? "access_denied" : "server_error",
      );
    const form = new URLSearchParams([
      ["grant_type", "authorization_code"],
      ["code", code ?? ""],
      ["redirect_uri", callbackUri],
      ["code_verifier", flow.verifier],
    ]);
    const id = config.oauthUpstreamClientId;
    const secret = config.oauthUpstreamClientSecret;
    let authorization: string | undefined;
    if (found.basic)
      // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
      authorization = `Basic ${Buffer.from(`${formEncode(id)}:${formEncode(secret)}`).toString("base64")}`;
    else {
      form.set("client_id", id);
      form.set("client_secret", secret);
    }
    let reply: { status: number; json: unknown };
    try {
      reply = await upstream.postForm(found.tokenEndpoint, form, authorization);
    } catch {
      return fail("callback_refused", "server_error");
    }
    const body = reply.json;
    if (
      reply.status !== 200 ||
      !isRecord(body) ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer" ||
      typeof body.id_token !== "string"
    )
      return fail("callback_refused", "server_error");
    const identity = await verifyIdToken(
      found,
      body.id_token,
      flow.nonce,
      now(),
    );
    if (!identity) return fail("id_token_refused", "server_error");
    if (!authorized(identity)) return fail("identity_refused", "access_denied");
    // BR-299: a store latched during the awaits takes no new code.
    if (isLatched())
      return refusePage("callback_refused", "callback", "busy", 503);
    const issued = now();
    purge(issued);
    if (full("codes", codes.size)) return fail("store_full", "server_error");
    const value = random(32);
    codes.set(value, {
      request,
      identity,
      created: issued,
      consumed: false,
      familyId: undefined,
    });
    return clientRedirect(request, [["code", value]]);
  }

  // ---- BR-136 -------------------------------------------------------------
  interface Credentials {
    id: string;
    secret: string | undefined;
    method: Method;
    basic: boolean;
  }

  function parseBasic(
    header: string,
  ): { id: string; secret: string } | undefined {
    const match = /^Basic ([A-Z0-9+/]+={0,2})$/iu.exec(header);
    if (!match?.[1]) return undefined;
    const text = Buffer.from(match[1], "base64").toString("utf8");
    const colon = text.indexOf(":");
    if (colon < 0) return undefined;
    const id = formDecode(text.slice(0, colon));
    const secret = formDecode(text.slice(colon + 1));
    return id === undefined || secret === undefined
      ? undefined
      : { id, secret };
  }

  function credentials(
    authorization: string | undefined,
    form: URLSearchParams,
  ): Credentials | undefined {
    const bodyId = form.get("client_id");
    const bodySecret = form.get("client_secret");
    if (authorization !== undefined) {
      const basic = parseBasic(authorization);
      if (!basic || bodySecret !== null) return undefined;
      if (bodyId !== null && bodyId !== basic.id) return undefined;
      return {
        id: basic.id,
        secret: basic.secret,
        method: "client_secret_basic",
        basic: true,
      };
    }
    if (bodyId === null) return undefined;
    return bodySecret === null
      ? { id: bodyId, secret: undefined, method: "none", basic: false }
      : {
          id: bodyId,
          secret: bodySecret,
          method: "client_secret_post",
          basic: false,
        };
  }

  async function token(input: {
    authorization?: string;
    form: URLSearchParams;
  }): Promise<ProxyResponse> {
    // BR-299: a latched store answers 503 before reading a code or token.
    if (latched) return tokenError(503, "temporarily_unavailable");
    const { form } = input;
    const presented = credentials(input.authorization, form);
    if (hasRepetition(form) || !presented || form.get("grant_type") === null)
      return tokenError(400, "invalid_request");
    const challenge: Array<[string, string]> = presented.basic
      ? [["WWW-Authenticate", 'Basic realm="oauth-token"']]
      : [];
    // BR-310 / BR-136 v2: a CIMD client ID authenticates with `none` only and
    // must be acceptable now; decided before any code or family lookup.
    const cimd = presented.id.startsWith("https://");
    if (cimd && (presented.method !== "none" || !acceptable(presented.id)))
      return tokenError(401, "invalid_client", challenge);
    const client = cimd ? cimdClient(presented.id) : clients.get(presented.id);
    if (
      !client ||
      client.method !== presented.method ||
      (client.secretHash !== undefined &&
        !sameHash(sha256(presented.secret ?? ""), client.secretHash))
    )
      return tokenError(401, "invalid_client", challenge);
    const grant = form.get("grant_type") ?? "";
    if (!GRANTS.includes(grant as Grant))
      return tokenError(400, "unsupported_grant_type");
    if (!client.grantTypes.includes(grant as Grant))
      return tokenError(400, "unauthorized_client");
    const time = now();
    client.lastUse = time;
    return grant === "authorization_code"
      ? redeemCode(client, form, time)
      : redeemRefresh(client, form, time);
  }

  /**
   * BR-310: a CIMD client at the token endpoint. It has no client row; the
   * snapshot bound to a code decides its refresh token (BR-308).
   */
  function cimdClient(id: string): Client {
    return {
      id,
      redirectUris: [],
      grantTypes: [...GRANTS],
      method: "none",
      name: undefined,
      secretHash: undefined,
      lastUse: 0,
    };
  }

  /** A registered client has a row to touch; a CIMD client has none (BR-311). */
  function touch(change: Change, client: Client, time: number): void {
    if (clients.get(client.id) === client)
      change.writes.push({ op: "touchClient", id: client.id, lastUse: time });
  }

  // ---- BR-137, BR-138, BR-139 -----------------------------------------------
  async function issue(
    client: Client,
    identity: Identity,
    time: number,
    refreshToken: string | undefined,
  ): Promise<ProxyResponse> {
    const iat = Math.floor(time / SECOND);
    const payload: Record<string, unknown> = {
      iss: issuer,
      sub: identity.sub,
      upstream_iss: upstreamIssuer,
      aud: audience,
      client_id: client.id,
      iat,
      exp: iat + ACCESS_TTL_SECONDS,
      jti: random(16),
    };
    if (emailsEnabled && typeof identity.email === "string") {
      payload.email = identity.email;
      if (identity.emailVerified !== undefined)
        payload.email_verified = identity.emailVerified;
    }
    const accessToken = await signAccessToken(key, payload);
    return tokenJson(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    });
  }

  const unavailable = () => tokenError(503, "temporarily_unavailable");

  /**
   * BR-140 v2 / BR-302: the family is revoked by deleting it, committed
   * before the `invalid_grant` (BR-298); a failed commit keeps the revocation
   * in memory and answers 503 (BR-299).
   */
  function revoke(family: Family, time: number): ProxyResponse {
    const change = begin(time);
    dropFamilyIn(change, family);
    change.revoke.push(() => families.delete(family.id));
    log("refresh_family_revoked", { handler: "token" });
    if (!persist(change, "token", "families")) return unavailable();
    return tokenError(400, "invalid_grant");
  }

  /** BR-139 v2: a new family and its first `<family id>.<secret>` token. */
  function startFamily(
    change: Change,
    client: Client,
    identity: Identity,
    resource: string,
    time: number,
  ): { family: Family; token: string } {
    if (full("families", liveFamilies(change).length)) evictFamily(change);
    const id = random(16);
    const secret = random(32);
    const family: Family = {
      id,
      clientId: client.id,
      identity: familyIdentity(identity),
      resource,
      created: time,
      tokenHash: sha256(secret),
      lastIssued: time,
    };
    change.writes.push({ op: "insertFamily", family: storedFamily(family) });
    change.apply.push(() => families.set(id, family));
    return { family, token: `${id}.${secret}` };
  }

  function redeemCode(
    client: Client,
    form: URLSearchParams,
    time: number,
  ): Promise<ProxyResponse> {
    const value = form.get("code");
    const code = value === null ? undefined : codes.get(value);
    if (!code) return Promise.resolve(tokenError(400, "invalid_grant"));
    if (code.consumed) {
      const family =
        code.familyId === undefined ? undefined : families.get(code.familyId);
      if (family) return Promise.resolve(revoke(family, time));
      return Promise.resolve(tokenError(400, "invalid_grant"));
    }
    code.consumed = true;
    if (time >= code.created + CODE_TTL)
      return Promise.resolve(tokenError(400, "invalid_grant"));
    const verifierValue = form.get("code_verifier") ?? "";
    if (
      code.request.clientId !== client.id ||
      form.get("redirect_uri") !== code.request.redirectUri ||
      !VERIFIER.test(verifierValue) ||
      sha256(verifierValue).toString("base64url") !== code.request.codeChallenge
    )
      return Promise.resolve(tokenError(400, "invalid_grant"));
    const resource = form.get("resource");
    if (resource !== null && resource !== code.request.resource)
      return Promise.resolve(tokenError(400, "invalid_target"));
    const change = begin(time);
    touch(change, client, time);
    let refreshToken: string | undefined;
    const grants = code.request.cimdGrants ?? client.grantTypes;
    if (grants.includes("refresh_token")) {
      const started = startFamily(
        change,
        client,
        code.identity,
        code.request.resource,
        time,
      );
      change.apply.push(() => {
        code.familyId = started.family.id;
      });
      refreshToken = started.token;
    }
    // BR-298: committed before the response and before the first await.
    if (!persist(change, "token", "families"))
      return Promise.resolve(unavailable());
    return issue(client, code.identity, time, refreshToken);
  }

  function redeemRefresh(
    client: Client,
    form: URLSearchParams,
    time: number,
  ): Promise<ProxyResponse> {
    const match = REFRESH_TOKEN.exec(form.get("refresh_token") ?? "");
    const family = match ? families.get(match[1] ?? "") : undefined;
    // Step (1): malformed, unknown or revoked (deleted) family.
    if (!match || !family)
      return Promise.resolve(tokenError(400, "invalid_grant"));
    // Step (2): a non-current secret or another client revokes the family.
    if (
      !sameHash(sha256(match[2] ?? ""), family.tokenHash) ||
      family.clientId !== client.id
    )
      return Promise.resolve(revoke(family, time));
    // Step (3): an expired family is revoked.
    if (
      familyExpired(
        { created: family.created, tokenIssued: family.lastIssued },
        time,
      )
    )
      return Promise.resolve(revoke(family, time));
    // BR-301: the identity must still satisfy the current allowlists.
    if (!authorized(family.identity))
      return Promise.resolve(revoke(family, time));
    // Step (4).
    const resource = form.get("resource");
    if (resource !== null && resource !== family.resource)
      return Promise.resolve(tokenError(400, "invalid_target"));
    const change = begin(time);
    const secret = random(32);
    const tokenHash = sha256(secret);
    const issued = Math.max(time, family.created);
    touch(change, client, time);
    change.writes.push({
      op: "rotateFamily",
      id: family.id,
      tokenHash,
      issued: time,
    });
    change.apply.push(() => {
      family.tokenHash = tokenHash;
      family.lastIssued = issued;
    });
    // BR-298: the rotation is committed before the first await (BR-140).
    if (!persist(change, "token", "families"))
      return Promise.resolve(unavailable());
    return issue(client, family.identity, time, `${family.id}.${secret}`);
  }

  const proxy: OAuthProxy = {
    kid: key.kid,
    metadataPaths,
    metadata,
    register,
    authorize,
    consent,
    callback,
    token,
    verifier,
    cancelFetches: () => {
      metadataLayer?.close();
    },
  };
  snapshots.set(
    proxy,
    () =>
      JSON.parse(
        JSON.stringify({
          clients: [...clients.values()],
          consents: [...consents.entries()],
          flows: [...flows.entries()],
          codes: [...codes.entries()],
          families: [...families.values()],
          discovery,
          jwks,
        }),
      ) as unknown,
  );
  return proxy;
}

import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import {
  createOAuthProxy,
  type EffectiveProxyConfig,
  type OAuthProxy,
  type ProxyEvent,
  type ProxyResponse,
  type UpstreamOidcPort,
} from "../../src/auth/proxy/index.js";
import {
  openOAuthStateStore,
  type OAuthStateStore,
  type OAuthStateStorePort,
} from "../../src/auth/proxy/store.js";

// Synthetic values only: every key is generated in memory per run and no
// real issuer, client, secret, code or token is used.
export const PUBLIC_URL = "https://mcp.test/mcp";
export const UPSTREAM = "https://idp.test";
export const UPSTREAM_CLIENT = "synthetic-upstream-client";
export const UPSTREAM_SECRET = "SYNTHETIC-UPSTREAM-SECRET-7f3a";
export const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
export const LOOPBACK = "http://127.0.0.1/callback";
export const LOCALHOST = "http://localhost/callback";
export const SECOND = 1000;
export const DAY = 86_400_000;
export const COOKIE = "__Host-kdrive-oauth";

export function syntheticPem(
  type: "ec" | "rsa" | "ed25519" = "ec",
  curve = "P-256",
): string {
  const pair =
    type === "ec"
      ? generateKeyPairSync("ec", { namedCurve: curve })
      : type === "rsa"
        ? generateKeyPairSync("rsa", { modulusLength: 2048 })
        : generateKeyPairSync("ed25519");
  return pair.privateKey.export({ format: "pem", type: "pkcs8" });
}

export function publicPem(): string {
  return generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({
    format: "pem",
    type: "spki",
  });
}

export function b64url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString("base64url");
}

export function s256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function counterRandom(
  prefix = "synthetic-random",
): (size: number) => Uint8Array {
  let counter = 0;
  return (size) => {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < size) {
      const chunk = createHash("sha256")
        .update(`${prefix}-${counter++}`)
        .digest();
      chunks.push(chunk);
      total += chunk.length;
    }
    return new Uint8Array(Buffer.concat(chunks).subarray(0, size));
  };
}

export class Clock {
  ms = Date.parse("2026-11-03T12:00:00Z");
  now = () => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export interface UpstreamCall {
  kind: "get" | "post";
  url: string;
  form?: URLSearchParams;
  authorization?: string;
}

export function upstreamMetadata(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    issuer: UPSTREAM,
    authorization_endpoint: `${UPSTREAM}/authorize`,
    token_endpoint: `${UPSTREAM}/token`,
    jwks_uri: `${UPSTREAM}/jwks`,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    ...extra,
  };
}

export class FakeUpstream implements UpstreamOidcPort {
  metadata: unknown = upstreamMetadata();
  metadataStatus = 200;
  jwks: unknown = { keys: [] };
  /** Makes every JWKS request reject. */
  jwksFail = false;
  calls: UpstreamCall[] = [];
  /** The next token response; `fail` makes the port reject. */
  tokenReply: { status: number; json: unknown } | "fail" = {
    status: 200,
    json: {},
  };
  fetchJson(url: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ kind: "get", url });
    if (url === `${UPSTREAM}/.well-known/openid-configuration`)
      return Promise.resolve({
        status: this.metadataStatus,
        json: this.metadata,
      });
    if (url === `${UPSTREAM}/jwks`)
      return this.jwksFail
        ? Promise.reject(new Error("jwks unavailable"))
        : Promise.resolve({ status: 200, json: this.jwks });
    return Promise.reject(new Error("unexpected url"));
  }
  postForm(
    url: string,
    form: URLSearchParams,
    authorization?: string,
  ): Promise<{ status: number; json: unknown }> {
    this.calls.push({
      kind: "post",
      url,
      form,
      ...(authorization === undefined ? {} : { authorization }),
    });
    if (this.tokenReply === "fail")
      return Promise.reject(new Error("upstream failure"));
    return Promise.resolve(this.tokenReply);
  }
  count(kind: "get" | "post", suffix: string): number {
    return this.calls.filter(
      (call) => call.kind === kind && call.url.endsWith(suffix),
    ).length;
  }
}

export interface LogEntry {
  name: ProxyEvent;
  fields: Record<string, string | number>;
}

export function header(
  response: ProxyResponse,
  name: string,
): string | undefined {
  return response.headers.find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

export function headers(response: ProxyResponse, name: string): string[] {
  return response.headers
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
}

export function location(response: ProxyResponse): URL {
  const value = header(response, "location");
  if (value === undefined) throw new Error("no location");
  return new URL(value);
}

export function json(response: ProxyResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

export interface Registered {
  clientId: string;
  clientSecret?: string;
  method: string;
  redirect: string;
}

export interface Login {
  code: string;
  verifier: string;
  redirect: string;
  client: Registered;
}

export interface HarnessOptions {
  pem?: string;
  subjects?: string[];
  emails?: string[];
  redirects?: string[];
  random?: (size: number) => Uint8Array;
  clock?: Clock;
  upstream?: FakeUpstream;
  upstreamKey?: UpstreamKey;
  /** F-019: the opened state store handed to the proxy (BR-124 v2). */
  store?: OAuthStateStore;
}

export interface UpstreamKey {
  privateKey: CryptoKey;
  jwk: JWK;
}

export async function upstreamKey(kid = "u1"): Promise<UpstreamKey> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid } };
}

export async function signIdToken(
  key: UpstreamKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: key.jwk.kid ?? "", ...header })
    .sign(key.privateKey);
}

export type Harness = Awaited<ReturnType<typeof harness>>;

export async function harness(options: HarnessOptions = {}) {
  const clock = options.clock ?? new Clock();
  const upstream = options.upstream ?? new FakeUpstream();
  const idKey = options.upstreamKey ?? (await upstreamKey());
  upstream.jwks = { keys: [idKey.jwk] };
  const pem = options.pem ?? syntheticPem();
  const logs: LogEntry[] = [];
  const config: EffectiveProxyConfig = {
    publicUrl: PUBLIC_URL,
    oauthIssuer: UPSTREAM,
    oauthAllowedSubjects: options.subjects ?? ["user-1"],
    oauthAllowedEmails: options.emails ?? [],
    oauthUpstreamClientId: UPSTREAM_CLIENT,
    oauthUpstreamClientSecret: UPSTREAM_SECRET,
    oauthSigningKey: new TextEncoder().encode(pem),
    oauthAllowedRedirectUris: options.redirects ?? [
      CLAUDE,
      LOOPBACK,
      LOCALHOST,
    ],
  };
  const proxy: OAuthProxy = createOAuthProxy({
    config,
    clock: clock.now,
    randomBytes: options.random ?? counterRandom(),
    upstream,
    logger: { event: (name, fields) => logs.push({ name, fields }) },
    ...(options.store === undefined ? {} : { store: options.store }),
  });

  async function register(
    body: Record<string, unknown> = {},
  ): Promise<Registered> {
    const response = await proxy.register({
      body: JSON.stringify({
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "none",
        ...body,
      }),
    });
    if (response.status !== 201) throw new Error(response.body);
    const data = json(response);
    return {
      clientId: data.client_id as string,
      ...(typeof data.client_secret === "string"
        ? { clientSecret: data.client_secret }
        : {}),
      method: data.token_endpoint_auth_method as string,
      redirect: (data.redirect_uris as string[])[0] ?? "",
    };
  }

  function authorizeQuery(
    client: Registered,
    challenge: string,
    extra: Record<string, string | undefined> = {},
  ): URLSearchParams {
    const values: Record<string, string | undefined> = {
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirect,
      state: "client-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: PUBLIC_URL,
      ...extra,
    };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) query.append(key, value);
    return query;
  }

  function consentId(response: ProxyResponse): string {
    const match = /name="consent" value="([^"]+)"/u.exec(response.body);
    if (!match?.[1]) throw new Error("no consent id");
    return match[1];
  }

  function cookieOf(response: ProxyResponse): string {
    const value = header(response, "set-cookie");
    const match = value ? /^__Host-kdrive-oauth=([^;]+)/u.exec(value) : null;
    if (!match?.[1]) throw new Error("no cookie");
    return match[1];
  }

  /** Runs authorize and consent approval; returns the upstream redirect. */
  async function approve(
    client: Registered,
    verifier: string,
    extra: Record<string, string | undefined> = {},
  ) {
    const page = await proxy.authorize({
      query: authorizeQuery(client, s256(verifier), extra),
    });
    if (page.status !== 200) throw new Error(`authorize ${page.status}`);
    const cookie = `${COOKIE}=${cookieOf(page)}`;
    const upstreamRedirect = await proxy.consent({
      form: new URLSearchParams({
        consent: consentId(page),
        decision: "approve",
      }),
      cookie,
    });
    return { page, cookie, upstreamRedirect };
  }

  async function idToken(
    nonce: string,
    extra: Record<string, unknown> = {},
    tokenHeader: Record<string, unknown> = {},
    key: UpstreamKey = idKey,
  ): Promise<string> {
    const iat = Math.floor(clock.ms / 1000);
    return signIdToken(
      key,
      {
        iss: UPSTREAM,
        aud: UPSTREAM_CLIENT,
        sub: "user-1",
        nonce,
        iat,
        exp: iat + 300,
        ...extra,
      },
      tokenHeader,
    );
  }

  /** Completes the upstream leg and returns the callback response. */
  async function callback(
    flow: Awaited<ReturnType<typeof approve>>,
    idClaims: Record<string, unknown> = {},
    query: Record<string, string> = {},
  ): Promise<ProxyResponse> {
    const up = location(flow.upstreamRedirect);
    const state = up.searchParams.get("state") ?? "";
    const nonce = up.searchParams.get("nonce") ?? "";
    upstream.tokenReply = {
      status: 200,
      json: {
        token_type: "Bearer",
        access_token: "SYNTHETIC-UPSTREAM-ACCESS",
        id_token: await idToken(nonce, idClaims),
      },
    };
    return proxy.callback({
      query: new URLSearchParams({
        code: "SYNTHETIC-UPSTREAM-CODE",
        state,
        ...query,
      }),
      cookie: flow.cookie,
    });
  }

  let verifierCounter = 0;
  async function login(
    client?: Registered,
    idClaims: Record<string, unknown> = {},
  ): Promise<Login> {
    const registered = client ?? (await register());
    const verifier = `synthetic-verifier-${String(verifierCounter++).padStart(4, "0")}-${"v".repeat(24)}`;
    const flow = await approve(registered, verifier);
    const done = await callback(flow, idClaims);
    const code = location(done).searchParams.get("code");
    if (!code) throw new Error(`no code: ${header(done, "location")}`);
    return {
      code,
      verifier,
      redirect: registered.redirect,
      client: registered,
    };
  }

  function clientAuth(
    client: Registered,
    form: URLSearchParams,
  ): string | undefined {
    if (client.method === "client_secret_basic")
      // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
      return `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret ?? "")}`).toString("base64")}`;
    form.set("client_id", client.clientId);
    if (client.method === "client_secret_post")
      form.set("client_secret", client.clientSecret ?? "");
    return undefined;
  }

  async function redeem(
    done: Login,
    extra: Record<string, string | undefined> = {},
    as: Registered = done.client,
  ): Promise<ProxyResponse> {
    const values: Record<string, string | undefined> = {
      grant_type: "authorization_code",
      code: done.code,
      redirect_uri: done.redirect,
      code_verifier: done.verifier,
      ...extra,
    };
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) form.append(key, value);
    const authorization = clientAuth(as, form);
    return proxy.token({
      form,
      ...(authorization === undefined ? {} : { authorization }),
    });
  }

  async function refresh(
    client: Registered,
    token: string | undefined,
    extra: Record<string, string> = {},
  ): Promise<ProxyResponse> {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      ...extra,
    });
    if (token !== undefined) form.set("refresh_token", token);
    const authorization = clientAuth(client, form);
    return proxy.token({
      form,
      ...(authorization === undefined ? {} : { authorization }),
    });
  }

  return {
    proxy,
    clock,
    upstream,
    idKey,
    logs,
    pem,
    config,
    register,
    authorizeQuery,
    consentId,
    cookieOf,
    approve,
    idToken,
    callback,
    login,
    redeem,
    refresh,
  };
}

// ---- F-019: persistent state helpers ----------------------------------------

/** BR-296: the binding strings of the harness configuration. */
export const STATE_BINDING = {
  issuer: PUBLIC_URL,
  audience: PUBLIC_URL,
  upstreamIssuer: UPSTREAM,
};

const stateDirectories: string[] = [];

/** A fresh private directory (mode 0700) holding no state file yet. */
export function stateFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-proxy-state-"));
  chmodSync(directory, 0o700);
  stateDirectories.push(directory);
  return join(directory, "state.db");
}

/** Removes every directory `stateFile` created; call from `afterEach`. */
export function removeStateFiles(): void {
  for (const directory of stateDirectories.splice(0)) {
    for (const entry of readdirSync(directory))
      try {
        chmodSync(join(directory, entry), 0o600);
      } catch {
        // Already removed.
      }
    rmSync(directory, { recursive: true, force: true });
  }
}

export function openState(
  path: string,
  options: {
    clock?: Clock;
    redirects?: readonly string[];
    port?: Partial<OAuthStateStorePort>;
  } = {},
): OAuthStateStore {
  const clock = options.clock ?? new Clock();
  return openOAuthStateStore({
    path,
    binding: STATE_BINDING,
    allowedRedirectUris: options.redirects ?? [CLAUDE, LOOPBACK, LOCALHOST],
    clock: clock.now,
    ...(options.port === undefined ? {} : { port: options.port }),
  });
}

export interface FileRows {
  clients: Array<Record<string, unknown>>;
  families: Array<Record<string, unknown>>;
}

/** The rows of a closed state file, read without changing it. */
export function readState(path: string): FileRows {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      clients: db.prepare("SELECT * FROM clients ORDER BY id").all(),
      families: db.prepare("SELECT * FROM families ORDER BY id").all(),
    };
  } finally {
    db.close();
  }
}

export function sha256Bytes(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

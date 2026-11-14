import { isIPv4 } from "node:net";
import { redirectMatches } from "./redirect.js";

// ---- the fetch port (BR-306) -------------------------------------------------

export type FetchFailureReason =
  | "blocked_address"
  | "resolution"
  | "connection"
  | "certificate"
  | "timeout"
  | "status"
  | "content_type"
  | "size";

/** One completed fetch: the document bytes, or a classified failure. */
export type FetchOutcome =
  | {
      ok: true;
      status: 200;
      body: Uint8Array;
      /** The `Cache-Control` field lines, in order. */
      cacheControl: readonly string[];
    }
  | {
      ok: false;
      reason: FetchFailureReason;
      /** The document response status, 0 when none was received (BR-394). */
      status: number;
      transient: boolean;
    };

/** BR-306: fetches one CIMD URL; aborting `signal` cancels it. */
export interface ClientMetadataFetch {
  fetch(url: string, signal: AbortSignal): Promise<FetchOutcome>;
}

// ---- BR-305: client ID syntax and acceptability --------------------------------

/** Contract details "CIMD client ID syntax": reads no configuration (BR-311). */
export function meetsCimdClientIdSyntax(value: string): boolean {
  if (!value.startsWith("https://") || Buffer.byteLength(value) > 1024)
    return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.href !== value) return false;
  if (
    url.username !== "" ||
    url.password !== "" ||
    value.includes("?") ||
    value.includes("#")
  )
    return false;
  const host = url.hostname;
  if (host === "" || host.startsWith("[") || isIPv4(host)) return false;
  if (url.pathname === "/") return false;
  return url.pathname
    .split("/")
    .slice(1)
    .every((segment) => {
      const decoded = segment.replaceAll(/%2e/giu, ".");
      return decoded !== "." && decoded !== "..";
    });
}

/** The exact strings a CIMD client ID must not equal (BR-305). */
export interface CimdBinding {
  issuer: string;
  audience: string;
  upstreamIssuer: string;
}

/** BR-305: syntax, not a proxy identity, and a listed origin. */
export function acceptableCimdClientId(
  value: string,
  origins: readonly string[],
  binding: CimdBinding,
): boolean {
  return (
    origins.length > 0 &&
    meetsCimdClientIdSyntax(value) &&
    value !== binding.issuer &&
    value !== binding.audience &&
    value !== binding.upstreamIssuer &&
    origins.includes(new URL(value).origin)
  );
}

// ---- BR-308: document validation -------------------------------------------

export type CimdGrant = "authorization_code" | "refresh_token";

/** The client an authorization request uses, snapshotted at resolution. */
export interface ResolvedCimdClient {
  id: string;
  redirectUris: readonly string[];
  grantTypes: readonly CimdGrant[];
  name: string | undefined;
}

const MAX_REDIRECT_URIS = 10;
const CONTROL = /\p{Cc}/u;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function parseDocument(body: Uint8Array): Record<string, unknown> | undefined {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf)
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(body));
  } catch {
    return undefined;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/** BR-308: the token endpoint method resolves to `none`. */
function methodIsNone(document: Record<string, unknown>): boolean {
  const many = document.token_endpoint_auth_methods_supported;
  const one = document.token_endpoint_auth_method;
  if (many !== undefined) {
    if (!isStringArray(many) || !many.includes("none")) return false;
    return one === undefined || (typeof one === "string" && many.includes(one));
  }
  return one === undefined || one === "none";
}

function validName(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  return length >= 1 && length <= 200 && !CONTROL.test(value);
}

/** BR-308: the resolved client, or undefined for an invalid document. */
export function validateDocument(
  body: Uint8Array,
  url: string,
  allowedRedirectUris: readonly string[],
): ResolvedCimdClient | undefined {
  const document = parseDocument(body);
  if (!document) return undefined;
  if (document.client_id !== url) return undefined;
  if ("client_secret" in document || "client_secret_expires_at" in document)
    return undefined;
  if (!methodIsNone(document)) return undefined;
  const redirects = document.redirect_uris;
  if (!isStringArray(redirects) || redirects.length === 0) return undefined;
  const kept = redirects
    .filter((uri) =>
      allowedRedirectUris.some((entry) => redirectMatches(uri, entry)),
    )
    .slice(0, MAX_REDIRECT_URIS);
  if (kept.length === 0) return undefined;
  const grants = document.grant_types;
  if (
    grants !== undefined &&
    (!isStringArray(grants) || !grants.includes("authorization_code"))
  )
    return undefined;
  const responses = document.response_types;
  if (
    responses !== undefined &&
    (!isStringArray(responses) || !responses.includes("code"))
  )
    return undefined;
  const name = document.client_name;
  if (!validName(name)) return undefined;
  const grantTypes: CimdGrant[] =
    grants === undefined
      ? ["authorization_code", "refresh_token"]
      : (["authorization_code", "refresh_token"] as const).filter((grant) =>
          grants.includes(grant),
        );
  return { id: url, redirectUris: kept, grantTypes, name };
}

// ---- BR-309: cache, concurrency and cancellation --------------------------------

const SECOND = 1000;
const MAX_ENTRIES = 100;
const MAX_IN_FLIGHT = 4;
const STALE_MS = 3600 * SECOND;
const DEFAULT_FRESH_MS = 300 * SECOND;
const MIN_FRESH_MS = 60 * SECOND;
const MAX_FRESH_MS = 3600 * SECOND;
/** The layer's own deadline; the fetch port enforces the same (BR-306). */
const DEADLINE_MS = 5000;
const MAX_AGE_VALUE = /^\d{1,10}$/u;

/** Trims spaces and tabs only (BR-309). */
function trimSpaces(value: string): string {
  const blank = (char: string | undefined) => char === " " || char === "\t";
  let start = 0;
  let end = value.length;
  while (start < end && blank(value[start])) start += 1;
  while (end > start && blank(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/** BR-309: the freshness lifetime from the `Cache-Control` field lines. */
export function freshnessMs(cacheControl: readonly string[]): number {
  let maxAge: number | undefined;
  let noStore = false;
  for (const directive of cacheControl.join(",").split(",")) {
    const trimmed = trimSpaces(directive);
    const equals = trimmed.indexOf("=");
    const name = (
      equals < 0 ? trimmed : trimmed.slice(0, equals)
    ).toLowerCase();
    const value = equals < 0 ? undefined : trimmed.slice(equals + 1);
    if (name === "no-store" || name === "no-cache") noStore = true;
    else if (
      name === "max-age" &&
      maxAge === undefined &&
      value !== undefined &&
      MAX_AGE_VALUE.test(value)
    )
      maxAge = Number(value) * SECOND;
  }
  if (noStore) return MIN_FRESH_MS;
  if (maxAge === undefined) return DEFAULT_FRESH_MS;
  return Math.min(MAX_FRESH_MS, Math.max(MIN_FRESH_MS, maxAge));
}

export type MetadataRefusal =
  FetchFailureReason | "not_allowed" | "document" | "busy";

export type Resolution =
  | { kind: "resolved"; client: ResolvedCimdClient }
  | {
      kind: "refused";
      reason: MetadataRefusal;
      status: number;
      transient: boolean;
    }
  /** The HTTP server is closing (BR-169 v3 step (2)). */
  | { kind: "closed" };

interface Entry {
  client: ResolvedCimdClient;
  freshUntil: number;
  staleUntil: number;
}

type Settled =
  | { kind: "document"; client: ResolvedCimdClient }
  | {
      kind: "failed";
      reason: MetadataRefusal;
      status: number;
      transient: boolean;
    }
  | { kind: "closed" };

interface Flight {
  controller: AbortController;
  settled: Promise<Settled>;
  settle: (value: Settled) => void;
}

export interface ClientMetadataResolverOptions {
  port: ClientMetadataFetch;
  clock: () => number;
  allowedRedirectUris: readonly string[];
  /** Called once per completed successful fetch with the cache size. */
  onFetched: (count: number) => void;
}

export interface ClientMetadataResolverLayer {
  resolve(url: string): Promise<Resolution>;
  /** Cancels every in-flight fetch; waiting requests resolve as closed. */
  close(): void;
}

const CLOSED = Symbol("closed");
const DEADLINE = Symbol("deadline");

/** Lets an aborted port settle first so that its known status is kept. */
function shortly(): Promise<undefined> {
  return new Promise((resolve) => {
    queueMicrotask(() => {
      queueMicrotask(() => {
        queueMicrotask(() => {
          resolve(undefined);
        });
      });
    });
  });
}

/** BR-308/BR-309: resolves CIMD client IDs through the port and a cache. */
export function createClientMetadataResolver(
  options: ClientMetadataResolverOptions,
): ClientMetadataResolverLayer {
  const { port, clock, allowedRedirectUris, onFetched } = options;
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Flight>();
  let closed = false;

  function store(url: string, client: ResolvedCimdClient, fresh: number) {
    const time = clock();
    cache.delete(url);
    if (cache.size >= MAX_ENTRIES) {
      let first: [string, Entry] | undefined;
      for (const item of cache)
        if (first === undefined || item[1].staleUntil < first[1].staleUntil)
          first = item;
      if (first) cache.delete(first[0]);
    }
    cache.set(url, {
      client,
      freshUntil: time + fresh,
      staleUntil: time + fresh + STALE_MS,
    });
  }

  function outcomeToSettled(url: string, outcome: FetchOutcome): Settled {
    if (!outcome.ok) {
      if (!outcome.transient) cache.delete(url);
      return {
        kind: "failed",
        reason: outcome.reason,
        status: outcome.status,
        transient: outcome.transient,
      };
    }
    const client = validateDocument(outcome.body, url, allowedRedirectUris);
    if (!client) {
      cache.delete(url);
      return {
        kind: "failed",
        reason: "document",
        status: 200,
        transient: false,
      };
    }
    store(url, client, freshnessMs(outcome.cacheControl));
    onFetched(cache.size);
    return { kind: "document", client };
  }

  function start(url: string): Flight {
    const controller = new AbortController();
    let settle!: (value: Settled) => void;
    const settled = new Promise<Settled>((resolve) => {
      settle = resolve;
    });
    const flight: Flight = { controller, settled, settle };
    let done = false;
    const release = (value: Settled) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (inflight.get(url) === flight) inflight.delete(url);
      settle(value);
    };
    const fetched = port.fetch(url, controller.signal).then(
      (outcome) => outcome,
      (): FetchOutcome => ({
        ok: false,
        reason: "connection",
        status: 0,
        transient: true,
      }),
    );
    const timer = setTimeout(() => {
      if (done) return;
      controller.abort(DEADLINE);
      // The slot is free at the deadline (BR-309).
      if (inflight.get(url) === flight) inflight.delete(url);
      void Promise.race([fetched, shortly()]).then((outcome) => {
        // A transient failure: a stale entry stays usable (BR-309).
        release({
          kind: "failed",
          reason: "timeout",
          status: outcome !== undefined && !outcome.ok ? outcome.status : 0,
          transient: true,
        });
      });
    }, DEADLINE_MS);
    void fetched.then((outcome) => {
      if (done || controller.signal.aborted) return;
      release(outcomeToSettled(url, outcome));
    });
    flight.settle = release;
    inflight.set(url, flight);
    return flight;
  }

  function fromStale(url: string, settled: Settled): Resolution {
    if (settled.kind === "closed") return { kind: "closed" };
    if (settled.kind === "document")
      return { kind: "resolved", client: settled.client };
    const entry = cache.get(url);
    if (settled.transient && entry && clock() < entry.staleUntil)
      return { kind: "resolved", client: entry.client };
    return {
      kind: "refused",
      reason: settled.reason,
      status: settled.status,
      transient: settled.transient,
    };
  }

  return {
    async resolve(url: string): Promise<Resolution> {
      if (closed) return { kind: "closed" };
      const time = clock();
      const entry = cache.get(url);
      if (entry && time >= entry.staleUntil) cache.delete(url);
      else if (entry && time < entry.freshUntil)
        return { kind: "resolved", client: entry.client };
      let flight = inflight.get(url);
      if (!flight) {
        if (inflight.size >= MAX_IN_FLIGHT)
          return {
            kind: "refused",
            reason: "busy",
            status: 0,
            transient: true,
          };
        flight = start(url);
      }
      return fromStale(url, await flight.settled);
    },
    close() {
      closed = true;
      for (const flight of [...inflight.values()]) {
        flight.controller.abort(CLOSED);
        flight.settle({ kind: "closed" });
      }
      inflight.clear();
    },
  };
}

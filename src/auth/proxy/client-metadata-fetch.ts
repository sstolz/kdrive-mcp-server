import { promises as dns, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { Agent, request, type RequestOptions } from "node:https";
import { isIPv6, type Socket } from "node:net";
import {
  productionAddressPolicy,
  type AddressPolicy,
} from "./address-policy.js";
import type {
  ClientMetadataFetch,
  FetchFailureReason,
  FetchOutcome,
} from "./client-metadata.js";

/** The part of `dns.promises.Resolver` the fetch uses (BR-306). */
export interface ClientMetadataResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

/**
 * Test and rehearsal seams only (F-028 AC-13): the production composition
 * passes none of them.
 */
export interface ClientMetadataFetchOptions {
  /** A factory returning a `Resolver`-shaped object, one per fetch. */
  resolver?: () => ClientMetadataResolver;
  /** The DNS server list of the real c-ares resolver. */
  dnsServers?: readonly string[];
  addressPolicy?: AddressPolicy;
  /** Replaces Node's default CA store. */
  ca?: readonly string[];
}

/** BR-306: the deadline from the start of the resolution. */
export const FETCH_DEADLINE_MS = 5000;
/** BR-306: the largest accepted body. */
export const MAX_DOCUMENT_BYTES = 5120;
const USER_AGENT = "kdrive-mcp-server";
const MEDIA_TYPE = /^application\/(?:json|[!#$%&'*+.^_`|~0-9a-z-]+\+json)$/u;
/** Certificate verification failures (terminal); other TLS errors are not. */
const CERTIFICATE_CODES =
  /^(?:CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|HOSTNAME_MISMATCH$|ERR_TLS_CERT_ALTNAME_INVALID$|INVALID_CA$|PATH_LENGTH_EXCEEDED$|INVALID_PURPOSE$)/u;
const EMPTY_ANSWER = new Set(["ENODATA", "ENOTFOUND"]);
const HEADER_END = Buffer.from("\r\n\r\n");

/** BR-306: a per-fetch c-ares resolver, outside the libuv threadpool. */
function productionResolver(
  servers: readonly string[] | undefined,
): ClientMetadataResolver {
  const resolver = new dns.Resolver({ timeout: 2000, tries: 2 });
  if (servers !== undefined) resolver.setServers([...servers]);
  return resolver;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** `resolve4` and `resolve6` in parallel; ENODATA and ENOTFOUND are empty. */
function resolveBoth(
  resolver: ClientMetadataResolver,
  hostname: string,
): Promise<string[] | undefined> {
  const query = (answer: Promise<string[]>) =>
    answer.catch((error: unknown) => {
      if (EMPTY_ANSWER.has(errorCode(error) ?? "")) return [];
      throw error;
    });
  return Promise.all([
    query(resolver.resolve4(hostname)),
    query(resolver.resolve6(hostname)),
  ]).then(
    ([v4, v6]) => [...v4, ...v6],
    () => undefined,
  );
}

function mediaTypeOk(value: string | undefined): boolean {
  if (value === undefined) return false;
  const type = (value.split(";")[0] ?? "").trim().toLowerCase();
  return MEDIA_TYPE.test(type);
}

function encodingOk(value: string | undefined): boolean {
  return value === undefined || value.trim().toLowerCase() === "identity";
}

interface FetchSettings {
  policy: AddressPolicy;
  makeResolver: () => ClientMetadataResolver;
  ca: string[] | undefined;
}

/** BR-306: an agent whose lookup returns every checked address from memory. */
function pinnedAgent(addresses: string[], ca: string[] | undefined): Agent {
  const records: LookupAddress[] = addresses.map((address) => ({
    address,
    family: isIPv6(address) ? 6 : 4,
  }));
  // No second resolution happens for this fetch.
  const lookup = (
    _hostname: string,
    lookupOptions: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (lookupOptions.all) callback(null, records);
    else callback(null, records[0]?.address, records[0]?.family);
  };
  return new Agent({
    keepAlive: false,
    maxCachedSessions: 0,
    rejectUnauthorized: true,
    autoSelectFamily: true,
    lookup: lookup as unknown as RequestOptions["lookup"],
    ...(ca === undefined ? {} : { ca }),
  });
}

/**
 * BR-306: counts the bytes after the header block, whatever `Content-Length`
 * says, so a body announced short but sent long still fails at the 5,121st
 * byte. Chunked bodies are counted by the response reader instead (their
 * framing is not body). Calls `tooLarge` once the limit is passed.
 */
function watchBodyBytes(socket: Socket, tooLarge: () => void): void {
  let head: Buffer | undefined = Buffer.alloc(0);
  let counted = false;
  let body = 0;
  socket.on("data", (chunk: Buffer) => {
    if (head !== undefined) {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf(HEADER_END);
      if (end < 0) return;
      const text = head.subarray(0, end).toString("latin1");
      counted =
        /^HTTP\/1\.[01] 200 /u.test(text) &&
        !/\r\ntransfer-encoding[ \t]*:/iu.test(text);
      body = head.length - end - HEADER_END.length;
      head = undefined;
    } else body += chunk.length;
    if (counted && body > MAX_DOCUMENT_BYTES) tooLarge();
  });
}

/** One fetch: resolution, address check, pinned HTTPS GET, bounded body. */
function runFetch(
  url: string,
  signal: AbortSignal,
  settings: FetchSettings,
): Promise<FetchOutcome> {
  return new Promise<FetchOutcome>((resolve) => {
    const target = new URL(url);
    const hostname = target.hostname;
    const port = target.port === "" ? 443 : Number(target.port);
    const resolver = settings.makeResolver();
    let done = false;
    let status = 0;
    let agent: Agent | undefined;
    let pending: ReturnType<typeof request> | undefined;

    const finish = (outcome: FetchOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      try {
        resolver.cancel();
      } catch {
        // A resolver that cannot cancel has nothing left to stop.
      }
      pending?.destroy();
      agent?.destroy();
      resolve(outcome);
    };
    const fail = (reason: FetchFailureReason, transient: boolean) => {
      finish({ ok: false, reason, status, transient });
    };
    const onAbort = () => {
      fail("timeout", true);
    };
    // Deferred so that a byte count on the same chunk decides first.
    const classify = (error: unknown) => {
      if (CERTIFICATE_CODES.test(errorCode(error) ?? ""))
        fail("certificate", false);
      else fail("connection", true);
    };
    const timer = setTimeout(onAbort, FETCH_DEADLINE_MS);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    const onResponse = (response: IncomingMessage) => {
      status = response.statusCode ?? 0;
      if (status !== 200) {
        fail("status", status === 429 || status >= 500);
        return;
      }
      if (
        !mediaTypeOk(response.headers["content-type"]) ||
        !encodingOk(response.headers["content-encoding"])
      ) {
        fail("content_type", false);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) fail("size", false);
        else chunks.push(chunk);
      });
      response.on("end", () => {
        finish({
          ok: true,
          status: 200,
          body: Buffer.concat(chunks),
          cacheControl: [...(response.headersDistinct["cache-control"] ?? [])],
        });
      });
      response.on("error", () => {
        fail("connection", true);
      });
    };

    const connect = (addresses: string[]) => {
      agent = pinnedAgent(addresses, settings.ca);
      pending = request(
        {
          protocol: "https:",
          host: hostname,
          port,
          servername: hostname,
          path: target.pathname,
          method: "GET",
          agent,
          rejectUnauthorized: true,
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            Connection: "close",
          },
        },
        onResponse,
      );
      pending.on("socket", (socket: Socket) => {
        watchBodyBytes(socket, () => {
          status = 200;
          fail("size", false);
        });
      });
      pending.on("error", (error: unknown) => {
        queueMicrotask(() => {
          classify(error);
        });
      });
      pending.end();
    };

    void resolveBoth(resolver, hostname).then((answer) => {
      if (done) return;
      if (answer === undefined || answer.length === 0) {
        fail("resolution", true);
        return;
      }
      if (!answer.every((address) => settings.policy.allows(address))) {
        fail("blocked_address", false);
        return;
      }
      connect(answer);
    });
  });
}

/**
 * BR-306: the production CIMD fetch port over `node:https`, with one c-ares
 * resolution, the BR-307 address check, a pinned lookup and a dedicated agent.
 */
export function createClientMetadataFetch(
  options: ClientMetadataFetchOptions = {},
): ClientMetadataFetch {
  const settings: FetchSettings = {
    policy: options.addressPolicy ?? productionAddressPolicy,
    makeResolver:
      options.resolver ?? (() => productionResolver(options.dnsServers)),
    ca: options.ca === undefined ? undefined : [...options.ca],
  };
  return {
    fetch: (url, signal) => runFetch(url, signal, settings),
  };
}

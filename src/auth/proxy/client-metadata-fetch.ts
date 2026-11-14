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

/** BR-306 v2: the largest accepted response header block. */
const MAX_HEADER_BLOCK_BYTES = 8192;
const CR = 0x0d;
const LF = 0x0a;
const TERMINATOR = [CR, LF, CR, LF] as const;
/*
 * Blocks are classified by status code alone: Node's parser also accepts
 * `RTSP/` and `ICE/` status lines, and a line it refuses fails the fetch.
 */
/** An interim block; Node's parser treats 101 as final. */
const INTERIM = /^[^ \r\n]+ (?!101)1\d\d(?!\d)/u;
/** A final 200 block, with or without a reason phrase. */
const OK = /^[^ \r\n]+ 200(?!\d)/u;
/** `scanBlock`: the block passed the bound before it ended. */
const OVERFLOW = -2;
/** `scanBlock`: the block did not end in this chunk. */
const OPEN = -1;

/** BR-306 v2: one response header block being received. */
interface HeaderBlock {
  /** Every byte received since the block started. */
  size: number;
  /** Terminator bytes matched so far; -1 before the status line. */
  matched: number;
  /** The block's bytes (at most the bound), for the status line and fields. */
  parts: Buffer[];
}

const newBlock = (): HeaderBlock => ({ size: 0, matched: -1, parts: [] });

/** Advances the `\r\n\r\n` match; CR and LF before a status line never end a block. */
function blockEnds(block: HeaderBlock, byte: number): boolean {
  if (block.matched < 0) {
    if (byte === CR || byte === LF) return false;
    block.matched = 0;
  }
  if (byte === TERMINATOR[block.matched]) block.matched += 1;
  else block.matched = byte === CR ? 1 : 0;
  return block.matched === TERMINATOR.length;
}

/**
 * BR-306 v2: counts the bytes of `block` in `chunk` from `from`. Returns the
 * index after the block's end, `OPEN` when the chunk ends first, or
 * `OVERFLOW` at the first byte past the bound.
 */
function scanBlock(block: HeaderBlock, chunk: Buffer, from: number): number {
  for (let index = from; index < chunk.length; index += 1) {
    block.size += 1;
    if (block.size > MAX_HEADER_BLOCK_BYTES) return OVERFLOW;
    if (blockEnds(block, chunk[index] ?? 0)) {
      block.parts.push(chunk.subarray(from, index + 1));
      return index + 1;
    }
  }
  block.parts.push(chunk.subarray(from));
  return OPEN;
}

/** The block from its status line, as Latin-1 text. */
function blockText(block: HeaderBlock): string {
  return Buffer.concat(block.parts)
    .toString("latin1")
    .replace(/^[\r\n]+/u, "");
}

interface ResponseLimits {
  /** A header block passed 8,192 bytes (BR-306 v2). */
  headerTooLarge(): void;
  /** The body passed 5,120 bytes (BR-306). */
  bodyTooLarge(): void;
}

/**
 * BR-306 v2: bounds each header block, interim `1xx` blocks included, before
 * Node's parser sees a chunk (the listener is prepended: Node attaches its
 * parser before it emits `socket`). Then, after the parser as in v1, counts
 * the bytes after the final block whatever `Content-Length` says, so a body
 * announced short but sent long still fails at the 5,121st byte. Chunked
 * bodies are counted by the response reader instead (their framing is not
 * body).
 */
function watchResponseBytes(socket: Socket, limits: ResponseLimits): void {
  let block: HeaderBlock | undefined = newBlock();
  let counted = false;
  let body = 0;
  /** The body bytes of the chunk being delivered. */
  let fresh = 0;
  const onFinal = (text: string, rest: number) => {
    counted = OK.test(text) && !/\r\ntransfer-encoding[ \t]*:/iu.test(text);
    fresh = rest;
  };
  socket.prependListener("data", (chunk: Buffer) => {
    fresh = chunk.length;
    if (block === undefined) return;
    fresh = 0;
    for (let from = 0; block !== undefined && from < chunk.length;) {
      const end = scanBlock(block, chunk, from);
      if (end === OPEN) return;
      if (end === OVERFLOW) {
        block = undefined;
        limits.headerTooLarge();
        return;
      }
      const text = blockText(block);
      block = INTERIM.test(text) ? newBlock() : undefined;
      if (block === undefined) onFinal(text, chunk.length - end);
      from = end;
    }
  });
  socket.on("data", () => {
    if (!counted) return;
    body += fresh;
    if (body > MAX_DOCUMENT_BYTES) limits.bodyTooLarge();
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
          // BR-306 v2: Node's own limit stays above the 8,192-byte bound.
          maxHeaderSize: 16_384,
          // BR-306 v2: the block watcher relies on strict CRLF parsing.
          insecureHTTPParser: false,
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            Connection: "close",
          },
        },
        onResponse,
      );
      pending.on("socket", (socket: Socket) => {
        watchResponseBytes(socket, {
          headerTooLarge: () => {
            status = 0;
            fail("size", false);
          },
          bodyTooLarge: () => {
            status = 200;
            fail("size", false);
          },
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

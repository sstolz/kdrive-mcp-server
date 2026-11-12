import { Agent, request as httpsRequest } from "node:https";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "node:http";
import type { Duplex } from "node:stream";
import { NotSent } from "../mutation-gate.js";
import { ReadFailure } from "../read-retry.js";
import { isPublicAddress } from "./address.js";
import type { MutationRoute, Route } from "./routes.js";
import { PACKAGE_VERSION } from "../version.js";

/** BR-216: fixed constants. Nothing outside this module can change them. */
export const API_HOST = "api.infomaniak.com";
export const STORAGE_SUFFIX = ".download.kdrive.infomaniakusercontent.com";
export const HTTPS_PORT = 443;
export const DEADLINE_MS = 5_000;
export const JSON_LIMIT = 4 * 1024 * 1024;
export const ERROR_LIMIT = 8 * 1024;
export const MAX_IN_FLIGHT = 8;
export const MAX_QUEUE = 64;
const USER_AGENT = `kdrive-mcp-server/${PACKAGE_VERSION}`;
const STORAGE_HOP = "{storage}";
const storageLocation =
  /^https:\/\/([a-z0-9-]{1,63})\.download\.kdrive\.infomaniakusercontent\.com(\/[^#\s]*)?$/u;

export interface LookupAddress {
  readonly address: string;
  readonly family: number;
}
export type Lookup = (
  hostname: string,
  options: { all: true },
) => Promise<readonly LookupAddress[]>;
export interface ConnectOptions {
  readonly host: string;
  readonly port: number;
  readonly servername: string;
}
export type Connect = (options: ConnectOptions) => Duplex;
/** BR-216 v2: method and route template of every request (F-017 adds POST/DELETE). */
export type RequestObserver = (
  method: "GET" | "POST" | "DELETE",
  routeTemplate: string,
) => void;
export type UnavailableClass = "timeout" | "network" | "tls" | "queue";
export interface TransportOptions {
  readonly token: string;
  readonly lookup: Lookup;
  readonly connect: Connect;
  readonly onRequest?: RequestObserver | undefined;
  readonly onRefused?: ((status: 401 | 403) => void) | undefined;
  readonly onUnavailable?: ((cause: UnavailableClass) => void) | undefined;
}

/** Unbranded failure: the message is fixed and nothing else is attached. */
function unavailable(): Error {
  return new Error("READ_UNAVAILABLE");
}
type Cause = UnavailableClass | "abort" | "silent";
const causes = new WeakMap<object, Cause>();
function failure(cause: Cause): Error {
  const error = unavailable();
  causes.set(error, cause);
  return error;
}
function causeOf(error: unknown): Cause | undefined {
  return typeof error === "object" && error !== null
    ? causes.get(error)
    : undefined;
}
const tlsCodes =
  /^(?:ERR_SSL|ERR_TLS|ERR_OSSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH|ERR_TLS_CERT)/u;

/** BR-195: process-wide FIFO admission, 8 in flight and 64 waiting. */
class Limiter {
  private active = 0;
  private readonly waiters: {
    start: () => void;
    fail: (error: Error) => void;
  }[] = [];
  acquire(call: Call): Promise<() => void> {
    if (this.active < MAX_IN_FLIGHT) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    if (this.waiters.length >= MAX_QUEUE)
      return Promise.reject(failure("queue"));
    return new Promise((resolve, reject) => {
      const waiter = {
        start: () => {
          call.offAbort(cancel);
          resolve(this.releaser());
        },
        fail: reject,
      };
      const cancel = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(call.failure());
      };
      this.waiters.push(waiter);
      call.onAbort(cancel);
    });
  }
  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next.start();
      else this.active--;
    };
  }
}

/** One deadline-bound unit of work (BR-193); owns its sockets and timer. */
class Call {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cause: Cause | undefined;
  private readonly external: AbortSignal | undefined;
  private readonly abortExternal = () => {
    this.stop("abort");
  };
  readonly sockets = new Set<Duplex>();
  /** `milliseconds` undefined: no deadline but the external signal (BR-269). */
  constructor(milliseconds: number | undefined, external?: AbortSignal) {
    this.external = external;
    if (external?.aborted) this.stop("abort");
    else {
      external?.addEventListener("abort", this.abortExternal, { once: true });
      if (milliseconds !== undefined)
        this.timer = setTimeout(() => {
          this.stop("timeout");
        }, milliseconds);
    }
  }
  get aborted(): boolean {
    return this.controller.signal.aborted;
  }
  failure(): Error {
    return failure(this.cause ?? "abort");
  }
  onAbort(listener: () => void): void {
    if (this.aborted) queueMicrotask(listener);
    else
      this.controller.signal.addEventListener("abort", listener, {
        once: true,
      });
  }
  offAbort(listener: () => void): void {
    this.controller.signal.removeEventListener("abort", listener);
  }
  stop(cause: Cause): void {
    if (this.aborted) return;
    this.cause = cause;
    this.finish();
    this.controller.abort();
    this.destroy();
  }
  destroy(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }
  /** Clears the deadline; sockets are kept for a body reader. */
  finish(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.external?.removeEventListener("abort", this.abortExternal);
  }
}

/** Socket address checks and pinned connection; never the global agent. */
const pinned = Symbol("pinned-address");
export class PinnedAgent extends Agent {
  constructor(private readonly dial: Connect) {
    super({ keepAlive: false });
  }
  override createConnection(options: object): Duplex {
    const record = options as { host?: string; [pinned]?: string };
    const host = record[pinned];
    const servername = record.host;
    // BR-191: fail closed; never dial without the checked address.
    if (!host || !servername) throw failure("network");
    // BR-216: exactly {host, port, servername}; Node's TLS defaults apply.
    return this.dial({ host, port: HTTPS_PORT, servername });
  }
}

export interface Exchange {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly response: IncomingMessage;
}

export interface BodyReader {
  read(max: number, signal: AbortSignal): Promise<Uint8Array | null>;
  close(): void;
}

export interface Download {
  readonly status: number;
  readonly contentRange: string | undefined;
  readonly contentLength: string | undefined;
  readonly etag: string | undefined;
  readonly body: BodyReader;
}

export type JsonOutcome =
  | { readonly kind: "success"; readonly value: Record<string, unknown> }
  | { readonly kind: "envelope" }
  | { readonly kind: "missing" };

/** F-017 BR-268: the raw attempt result of one mutation request. */
export interface MutationResponse {
  readonly status: number;
  /** The raw `Retry-After` text, only when it is at most 32 bytes. */
  readonly retryAfter?: string;
  /** The complete 2xx body within BR-194 limits; never parsed here. */
  readonly body?: Buffer;
}
/** BR-267: the fixed message of a mutation failure after the handshake. */
export const MUTATION_UNKNOWN = "MUTATION_UNKNOWN";
function mutationUnknown(): Error {
  return new Error(MUTATION_UNKNOWN);
}
const RETRY_AFTER_BYTES = 32;

export interface RecordedHop {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
}

export function createTransport(options: TransportOptions) {
  const { token, lookup } = options;
  const agent = new PinnedAgent(options.connect);
  const limiter = new Limiter();

  function observe(
    template: string,
    method: "GET" | "POST" | "DELETE" = "GET",
  ) {
    try {
      options.onRequest?.(method, template);
    } catch {
      /* BR-216: an observer cannot alter or cancel a request. */
    }
  }
  function refused(status: number) {
    if (status !== 401 && status !== 403) return;
    try {
      options.onRefused?.(status);
    } catch {
      /* Operator reporting never changes the result. */
    }
  }
  function report(error: unknown): never {
    const cause = causeOf(error);
    if (
      cause === "timeout" ||
      cause === "network" ||
      cause === "tls" ||
      cause === "queue"
    )
      try {
        options.onUnavailable?.(cause);
      } catch {
        /* Operator reporting never changes the result. */
      }
    throw error instanceof ReadFailure ? error : unavailable();
  }

  async function hop(
    call: Call,
    host: string,
    target: string,
    template: string,
    headers: Record<string, string>,
  ): Promise<Exchange> {
    observe(template);
    let addresses: readonly LookupAddress[];
    try {
      addresses = await race(call, lookup(host, { all: true }));
    } catch (error) {
      if (call.aborted) throw call.failure();
      throw causeOf(error) ? error : failure("network");
    }
    if (call.aborted) throw call.failure();
    const list: readonly unknown[] = Array.isArray(addresses) ? addresses : [];
    const checked = list.map((a) =>
      typeof a === "object" && a !== null
        ? (a as Partial<LookupAddress>).address
        : undefined,
    );
    if (
      checked.length === 0 ||
      !checked.every((a) => typeof a === "string" && isPublicAddress(a))
    )
      throw failure("network");
    const address = checked[0] as string;
    return new Promise<Exchange>((resolve, reject) => {
      let connected = false,
        secure = false;
      const req: ClientRequest = httpsRequest({
        host,
        port: HTTPS_PORT,
        path: target,
        method: "GET",
        headers,
        agent,
        [pinned]: address,
      } as object);
      const abort = () => {
        req.destroy();
        reject(call.failure());
      };
      call.onAbort(abort);
      req.on("socket", (socket: Duplex) => {
        call.sockets.add(socket);
        if (call.aborted) socket.destroy();
        socket.once("connect", () => (connected = true));
        socket.once("secureConnect", () => (secure = true));
      });
      req.on("response", (response: IncomingMessage) => {
        call.offAbort(abort);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          response,
        });
      });
      req.on("error", (error: Error & { code?: unknown }) => {
        call.offAbort(abort);
        if (call.aborted) {
          reject(call.failure());
          return;
        }
        const code = typeof error.code === "string" ? error.code : "";
        reject(
          failure(
            tlsCodes.test(code) || (connected && !secure) ? "tls" : "network",
          ),
        );
      });
      req.end();
    });
  }

  function encodingRefused(exchange: Exchange): boolean {
    const encoding = exchange.headers["content-encoding"];
    return (
      encoding !== undefined && encoding.trim().toLowerCase() !== "identity"
    );
  }

  /** BR-194: counts bytes before keeping them; refuses above the limit. */
  function readBody(
    call: Call,
    exchange: Exchange,
    limit: number,
  ): Promise<Buffer> {
    const declared = exchange.headers["content-length"];
    if (declared !== undefined && Number(declared) > limit)
      return Promise.reject(failure("silent"));
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const response = exchange.response;
      const abort = () => {
        reject(call.failure());
      };
      call.onAbort(abort);
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          call.offAbort(abort);
          response.destroy();
          call.destroy();
          reject(failure("silent"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        call.offAbort(abort);
        resolve(Buffer.concat(chunks, total));
      });
      response.on("error", () => {
        call.offAbort(abort);
        reject(call.aborted ? call.failure() : failure("network"));
      });
      response.on("aborted", () => {
        call.offAbort(abort);
        reject(call.aborted ? call.failure() : failure("network"));
      });
    });
  }

  const apiHeaders = (json: boolean): Record<string, string> => ({
    ...(json ? { accept: "application/json" } : {}),
    "user-agent": USER_AGENT,
    "accept-encoding": "identity",
    authorization: `Bearer ${token}`,
  });

  /** One JSON route request (BR-190, BR-192–BR-196). Never retried. */
  async function json(route: Route): Promise<JsonOutcome> {
    const call = new Call(DEADLINE_MS);
    let release: (() => void) | undefined;
    try {
      release = await limiter.acquire(call);
      if (call.aborted) throw call.failure();
      const exchange = await hop(
        call,
        API_HOST,
        route.target,
        route.template,
        apiHeaders(true),
      );
      if (encodingRefused(exchange)) throw failure("silent");
      const status = exchange.status;
      if (status >= 200 && status < 300) {
        const body = await readBody(call, exchange, JSON_LIMIT);
        return envelope(body);
      }
      const body = await readBody(call, exchange, ERROR_LIMIT);
      if (status >= 300 && status < 400) throw failure("silent");
      refused(status);
      if (status === 404 && errorCode(body) === "object_not_found")
        return { kind: "missing" };
      if (status >= 400 && status <= 599) throw new ReadFailure(status);
      throw failure("silent");
    } catch (error) {
      return report(error);
    } finally {
      call.finish();
      call.destroy();
      release?.();
    }
  }

  /** Raw bounded hops for the owner-run recorder (BR-211); same checks. */
  async function record(route: Route, range?: string): Promise<RecordedHop[]> {
    const call = new Call(DEADLINE_MS);
    let release: (() => void) | undefined;
    const hops: RecordedHop[] = [];
    try {
      release = await limiter.acquire(call);
      const download = range !== undefined;
      let exchange = await hop(call, API_HOST, route.target, route.template, {
        ...apiHeaders(!download),
        ...(download ? { range } : {}),
      });
      for (let index = 0; ; index++) {
        if (encodingRefused(exchange)) throw failure("silent");
        const success = exchange.status >= 200 && exchange.status < 300;
        const body = await readBody(
          call,
          exchange,
          success ? JSON_LIMIT : ERROR_LIMIT,
        );
        hops.push({ status: exchange.status, headers: exchange.headers, body });
        if (!download || exchange.status !== 302 || index > 0) break;
        const next = storageTarget(exchange.headers.location);
        if (!next) throw failure("silent");
        exchange = await hop(call, next.host, next.target, STORAGE_HOP, {
          "user-agent": USER_AGENT,
          "accept-encoding": "identity",
          range,
        });
      }
      return hops;
    } catch (error) {
      return report(error);
    } finally {
      call.finish();
      call.destroy();
      release?.();
    }
  }

  /**
   * One download (BR-192, BR-193, BR-195, BR-206): final headers within the
   * deadline, both hops included; the slot stays with the body reader.
   */
  async function download(
    route: Route,
    range: string,
    signal: AbortSignal,
  ): Promise<Download> {
    const call = new Call(DEADLINE_MS, signal);
    let release: (() => void) | undefined;
    let handed = false;
    try {
      release = await limiter.acquire(call);
      if (call.aborted) throw call.failure();
      let exchange = await hop(call, API_HOST, route.target, route.template, {
        ...apiHeaders(false),
        range,
      });
      if (exchange.status === 302) {
        await readBody(call, exchange, ERROR_LIMIT);
        const next = storageTarget(exchange.headers.location);
        if (!next) throw failure("silent");
        exchange = await hop(call, next.host, next.target, STORAGE_HOP, {
          "user-agent": USER_AGENT,
          "accept-encoding": "identity",
          range,
        });
      }
      if (encodingRefused(exchange)) throw failure("silent");
      const status = exchange.status;
      if (status >= 300 && status < 400) throw failure("silent");
      if (status < 200 || status >= 300) {
        await readBody(call, exchange, ERROR_LIMIT);
        refused(status);
        if (status >= 400 && status <= 599) throw new ReadFailure(status);
        throw failure("silent");
      }
      call.finish();
      const slot = release;
      handed = true;
      const contentLength = exchange.headers["content-length"];
      return {
        status,
        contentRange: exchange.headers["content-range"],
        contentLength,
        etag: single(exchange.headers.etag),
        body: bodyReader(call, exchange.response, Number(contentLength), () => {
          slot();
        }),
      };
    } catch (error) {
      return report(error);
    } finally {
      if (!handed) {
        call.finish();
        call.destroy();
        release?.();
      }
    }
  }

  /** BR-195/BR-206: bounded reads, idle limit, slot release and socket destruction. */
  function bodyReader(
    call: Call,
    response: IncomingMessage,
    expected: number,
    release: () => void,
  ): BodyReader {
    let closed = false,
      ended = false,
      broken = false,
      total = 0,
      buffered: Buffer = Buffer.alloc(0),
      idle: ReturnType<typeof setTimeout> | undefined,
      wake: (() => void) | undefined;
    response.pause();
    const notify = () => {
      const w = wake;
      wake = undefined;
      w?.();
    };
    response.on("readable", notify);
    response.on("end", () => {
      ended = true;
      notify();
    });
    response.on("error", () => {
      broken = true;
      notify();
    });
    response.on("aborted", () => {
      broken = true;
      notify();
    });
    const close = () => {
      if (closed) return;
      closed = true;
      if (idle !== undefined) clearTimeout(idle);
      idle = undefined;
      response.destroy();
      call.destroy();
      release();
      notify();
    };
    const arm = () => {
      if (closed) return;
      idle = setTimeout(close, DEADLINE_MS);
    };
    arm();
    let overflow = false;
    function take(max: number): Uint8Array | undefined {
      if (buffered.length === 0) {
        const chunk = response.read() as Buffer | null;
        if (chunk !== null) {
          total += chunk.length;
          buffered = chunk;
        }
      }
      if (total > expected) {
        overflow = true;
        return undefined;
      }
      if (buffered.length === 0) return undefined;
      const part = buffered.subarray(0, max);
      buffered = buffered.subarray(part.length);
      return Uint8Array.prototype.slice.call(part);
    }
    return {
      read(max: number, signal: AbortSignal): Promise<Uint8Array | null> {
        if (idle !== undefined) clearTimeout(idle);
        idle = undefined;
        return new Promise<Uint8Array | null>((resolve, reject) => {
          if (
            !Number.isSafeInteger(max) ||
            max < 1 ||
            !(signal instanceof AbortSignal)
          ) {
            close();
            reject(unavailable());
            return;
          }
          const done = (
            error: Error | undefined,
            value?: Uint8Array | null,
          ) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", aborted);
            wake = undefined;
            if (error) {
              close();
              reject(error);
            } else {
              if (value === null) close();
              else arm();
              resolve(value ?? null);
            }
          };
          const aborted = () => {
            done(failure("abort"));
          };
          const attempt = () => {
            if (closed || broken) {
              done(unavailable());
              return;
            }
            if (signal.aborted) {
              done(failure("abort"));
              return;
            }
            const chunk = take(max);
            if (overflow) done(unavailable());
            else if (chunk) done(undefined, chunk);
            else if (ended) done(undefined, null);
            else wake = attempt;
          };
          signal.addEventListener("abort", aborted, { once: true });
          const timer = setTimeout(() => {
            done(failure("timeout"));
          }, DEADLINE_MS);
          attempt();
        }).catch((error: unknown) => report(error));
      },
      close,
    };
  }

  /** BR-191: the checked public address of the API host. */
  async function resolve(call: Call): Promise<string> {
    const addresses = await race(call, lookup(API_HOST, { all: true }));
    if (call.aborted) throw call.failure();
    const list: readonly unknown[] = Array.isArray(addresses) ? addresses : [];
    const checked = list.map((a) =>
      typeof a === "object" && a !== null
        ? (a as Partial<LookupAddress>).address
        : undefined,
    );
    if (
      checked.length === 0 ||
      !checked.every((a) => typeof a === "string" && isPublicAddress(a))
    )
      throw failure("network");
    return checked[0] as string;
  }
  /** D-17-5: resolves once the TLS handshake of a new connection completed. */
  function handshake(call: Call, socket: Duplex): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        socket.off("secureConnect", secure);
        socket.off("error", broken);
        socket.off("close", closed);
        call.offAbort(abort);
        if (error) reject(error);
        else resolve();
      };
      const secure = () => {
        done();
      };
      const broken = () => {
        done(failure("tls"));
      };
      const closed = () => {
        done(failure("network"));
      };
      const abort = () => {
        done(call.failure());
      };
      socket.once("secureConnect", secure);
      socket.once("error", broken);
      socket.once("close", closed);
      call.onAbort(abort);
    });
  }
  /** BR-268: status, bounded `Retry-After` and a complete bounded 2xx body. */
  function exchange(
    call: Call,
    socket: Duplex,
    route: MutationRoute,
    body: Buffer | undefined,
  ): Promise<MutationResponse> {
    return new Promise<MutationResponse>((resolve, reject) => {
      let settled = false;
      const settle = (value: MutationResponse | undefined) => {
        if (settled) return;
        settled = true;
        call.offAbort(abort);
        if (value) resolve(value);
        else reject(mutationUnknown());
      };
      const abort = () => {
        req.destroy();
        socket.destroy();
        settle(undefined);
      };
      const req: ClientRequest = httpRequest({
        host: API_HOST,
        port: HTTPS_PORT,
        path: route.target,
        method: route.method,
        setHost: false,
        headers: {
          host: API_HOST,
          ...apiHeaders(true),
          connection: "close",
          "content-length": String(body?.length ?? 0),
          ...(body
            ? { "content-type": route.contentType ?? "application/json" }
            : {}),
        },
        createConnection: () => socket,
      });
      call.onAbort(abort);
      req.on("error", () => {
        socket.destroy();
        settle(undefined);
      });
      req.on("response", (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        refused(status);
        const raw = response.headers["retry-after"];
        const retryAfter =
          typeof raw === "string" && Buffer.byteLength(raw) <= RETRY_AFTER_BYTES
            ? raw
            : undefined;
        const success = status >= 200 && status < 300;
        const limit = success ? JSON_LIMIT : ERROR_LIMIT;
        const head = (complete?: Buffer): MutationResponse => ({
          status,
          ...(retryAfter === undefined ? {} : { retryAfter }),
          ...(success && complete ? { body: complete } : {}),
        });
        const declared = response.headers["content-length"];
        if (
          (success &&
            encodingRefused({ status, headers: response.headers, response })) ||
          (declared !== undefined && Number(declared) > limit)
        ) {
          response.destroy();
          socket.destroy();
          settle(head());
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > limit) {
            response.destroy();
            socket.destroy();
            settle(head());
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          settle(head(Buffer.concat(chunks, total)));
        });
        // A truncated body: the status is known, the body is not kept.
        response.on("error", () => {
          settle(head());
        });
        response.on("close", () => {
          settle(head());
        });
      });
      req.end(body);
    });
  }
  /**
   * F-017 BR-266–BR-269: one mutation request on a new connection. Before the
   * handshake completes nothing can have been sent (`NotSent`); from then on
   * a failure is unknown. No deadline other than `signal` (BR-269).
   */
  async function mutate(
    route: MutationRoute,
    body: Buffer | undefined,
    signal: AbortSignal,
  ): Promise<MutationResponse> {
    const call = new Call(undefined, signal);
    let release: (() => void) | undefined;
    let socket: Duplex;
    try {
      release = await limiter.acquire(call);
      if (call.aborted) throw call.failure();
      observe(route.template, route.method);
      const address = await resolve(call);
      socket = options.connect({
        host: address,
        port: HTTPS_PORT,
        servername: API_HOST,
      });
      call.sockets.add(socket);
      await handshake(call, socket);
    } catch {
      call.finish();
      call.destroy();
      release?.();
      throw new NotSent();
    }
    try {
      return await exchange(call, socket, route, body);
    } catch {
      throw mutationUnknown();
    } finally {
      call.finish();
      call.destroy();
      release();
    }
  }

  return Object.freeze({ json, download, record, mutate });
}

function race<T>(call: Call, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(call.failure());
    };
    call.onAbort(abort);
    promise.then(
      (value) => {
        call.offAbort(abort);
        resolve(value);
      },
      (error: unknown) => {
        call.offAbort(abort);
        reject(error instanceof Error ? error : unavailable());
      },
    );
  });
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** BR-192: the only accepted redirect target. */
export function storageTarget(
  location: string | undefined,
): { host: string; target: string } | undefined {
  if (typeof location !== "string") return undefined;
  const match = storageLocation.exec(location);
  if (!match) return undefined;
  return {
    host: `${match[1] ?? ""}${STORAGE_SUFFIX}`,
    target: match[2] ?? "/",
  };
}

function envelope(body: Buffer): JsonOutcome {
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    return { kind: "envelope" };
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).result !== "success" ||
    !Object.hasOwn(value, "data")
  )
    return { kind: "envelope" };
  return { kind: "success", value: value as Record<string, unknown> };
}

/** Only `error.code` is read, and only to recognize `object_not_found`. */
function errorCode(body: Buffer): unknown {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    const error = (value as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null) return undefined;
    return (error as Record<string, unknown>).code;
  } catch {
    return undefined;
  }
}

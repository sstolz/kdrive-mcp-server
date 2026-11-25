import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { MAX_HEADER_LINES } from "./limits.js";
import { errorResponse } from "./responses.js";
import type { HttpHandler, HttpLogger } from "./types.js";

/** BR-170: a fixed placeholder; the router never reads the Web `Request` URL. */
const PLACEHOLDER_URL = "https://placeholder.invalid/";

/** One request while its response is being produced and written (BR-169 close order). */
export interface InFlight {
  /** True once `handle()` settled; the response is then being written. */
  settled: boolean;
  /** Resolves when the adapter has finished writing, or the connection closed. */
  readonly written: Promise<void>;
}

/** BR-170: the body streamed from the socket without destroying it on cancel. */
function bodyStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  const onData = (
    chunk: Buffer,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    controller.enqueue(new Uint8Array(chunk));
    if ((controller.desiredSize ?? 0) <= 0) req.pause();
  };
  let listener: ((chunk: Buffer) => void) | undefined;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      listener = (chunk) => {
        onData(chunk, controller);
      };
      req.on("data", listener);
      req.on("end", () => {
        if (!cancelled) controller.close();
      });
      req.on("error", (error) => {
        if (!cancelled) controller.error(error);
      });
    },
    pull() {
      req.resume();
    },
    cancel() {
      cancelled = true;
      if (listener) req.off("data", listener);
      req.resume();
    },
  });
}

/** Methods the Fetch `Request` constructor refuses (Fetch "forbidden methods"). */
const FORBIDDEN_METHODS = new Set(["CONNECT", "TRACE", "TRACK"]);

/**
 * A routable stand-in for a Fetch-forbidden method: no route allows it, so the
 * router answers it with its normal Host → 404/405 order instead of a 500.
 */
export const UNSUPPORTED_METHOD = "UNSUPPORTED";

/** BR-170: method as received, headers from `rawHeaders` in order, streamed body. */
export function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2)
    headers.append(req.rawHeaders[i] ?? "", req.rawHeaders[i + 1] ?? "");
  const received = req.method ?? "GET";
  const method = FORBIDDEN_METHODS.has(received.toUpperCase())
    ? UNSUPPORTED_METHOD
    : received;
  if (method === "GET" || method === "HEAD")
    return new Request(PLACEHOLDER_URL, { method, headers });
  return new Request(PLACEHOLDER_URL, {
    method,
    headers,
    body: bodyStream(req),
    duplex: "half",
  } as RequestInit);
}

/** True once the connection can no longer carry a response. */
function gone(res: ServerResponse, abandoned?: AbortSignal): boolean {
  return res.destroyed || res.writableEnded || abandoned?.aborted === true;
}

/** BR-166 v2: one shared `close` listener per socket and its unsettled requests. */
const socketWatches = new WeakMap<
  Socket,
  { readonly requests: Set<() => void>; readonly listener: () => void }
>();

/**
 * BR-166 v2: calls `onClose` when the socket closes; the returned function
 * stops watching, removing the shared listener once no request is left.
 */
function watchSocket(socket: Socket, onClose: () => void): () => void {
  let watch = socketWatches.get(socket);
  if (!watch) {
    const requests = new Set<() => void>();
    const listener = () => {
      for (const request of [...requests]) request();
    };
    watch = { requests, listener };
    socketWatches.set(socket, watch);
    socket.on("close", listener);
  }
  const current = watch;
  current.requests.add(onClose);
  return () => {
    current.requests.delete(onClose);
    if (current.requests.size === 0) {
      socket.off("close", current.listener);
      socketWatches.delete(socket);
    }
  };
}

/**
 * BR-170: writes a response unchanged, closing the connection after an unread
 * body. It never waits on a connection that is already gone (BR-169): an
 * aborted request settles at once instead of staying in flight. An aborted
 * `abandoned` signal (BR-166 v2 disconnect) also ends the wait.
 */
export async function writeResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response,
  onBodyFailure?: () => void,
  abandoned?: AbortSignal,
): Promise<void> {
  if (gone(res, abandoned)) {
    await response.body?.cancel().catch(() => undefined);
    return;
  }
  let body: Buffer;
  try {
    body = Buffer.from(await response.arrayBuffer());
  } catch {
    // The head is not written yet: answer 500 instead of destroying the socket.
    onBodyFailure?.();
    await writeResponse(
      req,
      res,
      errorResponse(500, "server_error"),
      undefined,
      abandoned,
    );
    return;
  }
  if (gone(res, abandoned)) return;
  const pairs: string[] = [];
  for (const [name, value] of response.headers) pairs.push(name, value);
  if (!response.headers.has("content-length"))
    pairs.push("content-length", String(body.length));
  if (!req.complete && !response.headers.has("connection"))
    pairs.push("connection", "close");
  res.writeHead(response.status, pairs);
  await new Promise<void>((resolve) => {
    const done = () => {
      res.off("close", done);
      abandoned?.removeEventListener("abort", done);
      resolve();
    };
    res.once("close", done);
    abandoned?.addEventListener("abort", done, { once: true });
    res.end(body, done);
    if (res.destroyed || abandoned?.aborted) done();
  });
}

/**
 * BR-170: answers one request; any exception becomes the 500 of the router.
 * BR-446: more than 100 header lines are refused 431 before `handle()`.
 * BR-166 v2: the request's disconnect signal aborts when the response or the
 * socket closes before the response was completely written.
 */
export async function serve(
  handler: HttpHandler,
  logger: HttpLogger | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  flight: InFlight,
): Promise<void> {
  const target = req.url ?? "";
  const refused = (status = 500, error = "server_error") => {
    try {
      logger?.event("request_refused", {
        route: handler.routeOf(target),
        status,
        error,
      });
    } catch {
      // A logger failure never changes a response.
    }
  };
  const disconnect = new AbortController();
  // Ends the response-write wait once the response or the socket closed; kept
  // apart from `disconnect`, which only the queue listens to (BR-445).
  const closed = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) disconnect.abort();
    closed.abort();
  };
  res.on("close", onClose);
  const socket = req.socket as Socket | null;
  const unwatch =
    typeof socket?.on === "function" ? watchSocket(socket, onClose) : undefined;
  if (socket?.destroyed) onClose();
  try {
    let response: Response;
    if (req.rawHeaders.length / 2 > MAX_HEADER_LINES) {
      refused(431, "invalid_request");
      response = errorResponse(431, "invalid_request", {
        connection: "close",
      });
    } else
      try {
        response = await handler.handle(
          toRequest(req),
          target,
          req.socket.remoteAddress,
          disconnect.signal,
        );
      } catch {
        refused();
        response = errorResponse(500, "server_error");
      }
    flight.settled = true;
    try {
      await writeResponse(req, res, response, refused, closed.signal);
    } catch {
      // The response had started or the connection failed: end the connection.
      res.destroy();
    }
  } finally {
    res.off("close", onClose);
    unwatch?.();
  }
}

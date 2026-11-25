import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { serve, type InFlight } from "./adapter.js";
import { HttpStartupError } from "./errors.js";
import { createHttpHandler } from "./handler.js";
import { MAX_HEADERS_COUNT } from "./limits.js";
import type { HttpHandlerOptions, HttpLogger } from "./types.js";

export type ListenPort = (
  server: Server,
  port: number,
  host: string,
) => Promise<AddressInfo>;

export interface HttpServer {
  readonly server: Server;
  close(): Promise<void>;
}

export interface StartedHttpServer {
  readonly address: AddressInfo;
  close(): Promise<void>;
}

/** F-053 AC-14 test evidence: the in-flight set of each created server. */
const inFlightSets = new WeakMap<Server, ReadonlySet<InFlight>>();

/** F-053 AC-14 test evidence only: the number of requests still in flight. */
export function inFlightSize(server: Server): number {
  return inFlightSets.get(server)?.size ?? 0;
}

/** BR-444: at most one `listener_error` per this many milliseconds. */
const LISTENER_ERROR_INTERVAL_MS = 60_000;
const ERROR_CODE = /^E[A-Z0-9]{1,31}$/u;

/**
 * BR-444: the post-bind `error` listener. It never closes, rejects or ends
 * anything; it emits a bounded, payload-free `listener_error` at most once
 * per minute of the handler clock and counts the others.
 */
function listenerErrorHandler(
  clock: () => Date,
  logger: HttpLogger | undefined,
): (error: unknown) => void {
  let last: number | undefined;
  let suppressed = 0;
  return (error: unknown) => {
    const at = clock().getTime();
    if (last !== undefined) {
      const elapsed = at - last;
      if (elapsed >= 0 && elapsed < LISTENER_ERROR_INTERVAL_MS) {
        suppressed++;
        return;
      }
    }
    const code: unknown =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "code")
        : undefined;
    const fields = {
      code: typeof code === "string" && ERROR_CODE.test(code) ? code : "other",
      suppressed,
    };
    last = at;
    suppressed = 0;
    try {
      logger?.event("listener_error", fields);
    } catch {
      // A logger failure changes nothing else (BR-444).
    }
  };
}

/** BR-169: the bound on waiting for a settled response to be written. */
const WRITE_GRACE_MS = 1000;

function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** BR-169/BR-170: the `node:http` server around the router; it never listens. */
export function createHttpServer(options: HttpHandlerOptions): HttpServer {
  const handler = createHttpHandler(options);
  const inflight = new Set<InFlight>();
  const server = http.createServer(
    {
      requireHostHeader: false,
      headersTimeout: 10_000,
      requestTimeout: 30_000,
      keepAliveTimeout: 5000,
      maxHeaderSize: 16_384,
    },
    (req: IncomingMessage, res: ServerResponse) => {
      let finish!: () => void;
      const written = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const flight: InFlight = { settled: false, written };
      inflight.add(flight);
      void serve(handler, options.logger, req, res, flight).finally(() => {
        inflight.delete(flight);
        finish();
      });
    },
  );
  server.maxConnections = 256;
  // BR-169 v4: one line beyond the BR-446 bound, so the excess shows.
  server.maxHeadersCount = MAX_HEADERS_COUNT;
  inFlightSets.set(server, inflight);
  let closing: Promise<void> | undefined;
  return {
    server,
    close() {
      closing ??= (async () => {
        const stopped = new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        });
        await handler.close();
        await new Promise<void>((resolve) => setImmediate(resolve));
        const pending = [...inflight]
          .filter((flight) => flight.settled)
          .map((flight) => flight.written);
        await withTimeout(Promise.all(pending), WRITE_GRACE_MS);
        server.closeAllConnections();
        await stopped;
        // BR-169 v2 step (6), BR-304: the store closes after the listener.
        try {
          handler.closeStore();
        } catch {
          // The store counts as closed; close() still resolves.
        }
      })();
      return closing;
    },
  };
}

const defaultListen: ListenPort = (server, port, host) =>
  new Promise<AddressInfo>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address() as AddressInfo);
    });
  });

/** BR-153: listens on the effective host and port; insecure mode only on 127.0.0.1. */
export async function startHttpServer(
  options: HttpHandlerOptions & { listen?: ListenPort },
): Promise<StartedHttpServer> {
  const { listen = defaultListen, ...handlerOptions } = options;
  const created = createHttpServer(handlerOptions);
  const { configuration } = handlerOptions;
  const insecure = configuration.insecureNoAuth;
  const host = insecure ? "127.0.0.1" : configuration.httpHost;
  let address: AddressInfo;
  try {
    address = await listen(created.server, configuration.httpPort, host);
  } catch {
    await created.close();
    throw new HttpStartupError("LISTEN_FAILED");
  }
  // BR-444: once bound, one `error` listener stays until close() resolves.
  const onError = listenerErrorHandler(
    handlerOptions.clock,
    handlerOptions.logger,
  );
  created.server.on("error", onError);
  const close = async () => {
    await created.close();
    created.server.off("error", onError);
  };
  if (insecure && address.address !== "127.0.0.1") {
    await close();
    throw new HttpStartupError("INSECURE_BIND_REFUSED");
  }
  return { address, close };
}

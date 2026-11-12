import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { serve, type InFlight } from "./adapter.js";
import { HttpStartupError } from "./errors.js";
import { createHttpHandler } from "./handler.js";
import type { HttpHandlerOptions } from "./types.js";

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
  if (insecure && address.address !== "127.0.0.1") {
    await created.close();
    throw new HttpStartupError("INSECURE_BIND_REFUSED");
  }
  return { address, close: () => created.close() };
}

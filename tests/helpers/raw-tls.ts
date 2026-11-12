// F-017: a raw loopback TLS server for the mutation port. It parses each
// HTTP/1.1 request itself so a test sees the exact method, path, headers,
// body bytes and the connection each request used, and can answer with
// arbitrary bytes, close the socket, or never answer.
import { createServer, connect as tlsConnect, type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import { CANARY, PUBLIC_ADDRESS, certificates } from "./kdrive.js";

export interface RawRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  /** Index of the connection that carried the request (from 0). */
  readonly connection: number;
  /** Number of requests seen on that connection so far, this one included. */
  readonly onConnection: number;
}
/** What to do with a parsed request: raw bytes to write, then close or hold. */
export type RawAction =
  | { readonly write: string | Buffer; readonly end?: boolean }
  | { readonly destroy: true }
  | { readonly hold: true };
export type RawHandler = (request: RawRequest) => RawAction;

export function response(
  status: number,
  body: string | Buffer = "",
  headers: Record<string, string> = {},
): RawAction {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  const lines = [
    `HTTP/1.1 ${String(status)} X`,
    "Connection: close",
    `Content-Length: ${String(bytes.length)}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ];
  return {
    write: Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`), bytes]),
    end: true,
  };
}
export const json = (status: number, value: unknown, headers = {}) =>
  response(status, JSON.stringify(value), {
    "Content-Type": "application/json",
    ...headers,
  });

export async function rawServer(handler: RawHandler) {
  const { key, cert } = certificates();
  const requests: RawRequest[] = [];
  const sockets = new Set<TLSSocket>();
  const closed: number[] = [];
  let connections = 0;
  const state = { handler };
  const server = createServer({ key, cert }, (socket) => {
    const index = connections++;
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let count = 0;
    socket.on("close", () => {
      sockets.delete(socket);
      closed.push(index);
    });
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString("latin1").split("\r\n");
        const [method = "", path = ""] = (head[0] ?? "").split(" ");
        const headers: Record<string, string> = {};
        for (const line of head.slice(1)) {
          const at = line.indexOf(":");
          headers[line.slice(0, at).trim().toLowerCase()] = line
            .slice(at + 1)
            .trim();
        }
        const length = Number(headers["content-length"] ?? "0");
        if (buffer.length < end + 4 + length) return;
        const body = Buffer.from(buffer.subarray(end + 4, end + 4 + length));
        buffer = buffer.subarray(end + 4 + length);
        const request: RawRequest = {
          method,
          path,
          headers,
          body,
          connection: index,
          onConnection: ++count,
        };
        requests.push(request);
        const action = state.handler(request);
        if ("destroy" in action) socket.destroy();
        else if ("write" in action) {
          socket.write(action.write);
          if (action.end) socket.end();
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requests,
    closed,
    sockets,
    state,
    /** The injected `{lookup, connect}` pair of BR-216 v2. */
    lookup: () =>
      Promise.resolve([{ address: PUBLIC_ADDRESS, family: 4 }] as const),
    connect: (options: { servername: string }) =>
      tlsConnect({
        host: "127.0.0.1",
        port,
        servername: options.servername,
        ca: certificates().ca,
      }),
    leaks: () =>
      requests.filter(
        (r) =>
          Object.entries(r.headers).some(
            ([name, value]) =>
              name !== "authorization" && value.includes(CANARY),
          ) || r.path.includes(CANARY),
      ).length,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

// F-028 (CIMD): local TLS document servers, a stub UDP DNS server and fake
// c-ares resolvers. Certificates are generated per process with the dev
// image's openssl; no key material is committed.
import { execFileSync } from "node:child_process";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The synthetic CIMD client host (example.com is reserved, RFC 2606). */
export const CIMD_HOST = "client.example.com";
export const CIMD_ORIGIN = `https://${CIMD_HOST}`;
export const CIMD_URL = `${CIMD_ORIGIN}/c.json`;
/** The rehearsal double's host (AC-12). */
export const REHEARSAL_HOST = "cimd-double.example.org";

interface Material {
  ca: string;
  key: string;
  cert: string;
  untrustedKey: string;
  untrustedCert: string;
}
let material: Material | undefined;

/** A test CA, a server certificate it signs, and an unrelated self-signed one. */
export function cimdCertificates(): Material {
  if (material) return material;
  const dir = mkdtempSync(join(tmpdir(), "kdrive-cimd-tls-"));
  const run = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1"];
  run(
    "req",
    "-x509",
    ...ec,
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "2",
    "-subj",
    "/CN=cimd-test-ca",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign",
  );
  run(
    "req",
    ...ec,
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    `/CN=${CIMD_HOST}`,
  );
  writeFileSync(
    join(dir, "ext.cnf"),
    `subjectAltName=DNS:${CIMD_HOST},DNS:${REHEARSAL_HOST}\n`,
  );
  run(
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.pem",
    "-days",
    "2",
    "-extfile",
    "ext.cnf",
  );
  run(
    "req",
    "-x509",
    ...ec,
    "-nodes",
    "-keyout",
    "untrusted.key",
    "-out",
    "untrusted.pem",
    "-days",
    "2",
    "-subj",
    `/CN=${CIMD_HOST}`,
    "-addext",
    `subjectAltName=DNS:${CIMD_HOST}`,
  );
  material = {
    ca: readFileSync(join(dir, "ca.pem"), "utf8"),
    key: readFileSync(join(dir, "server.key"), "utf8"),
    cert: readFileSync(join(dir, "server.pem"), "utf8"),
    untrustedKey: readFileSync(join(dir, "untrusted.key"), "utf8"),
    untrustedCert: readFileSync(join(dir, "untrusted.pem"), "utf8"),
  };
  return material;
}

export interface SeenRequest {
  method: string;
  url: string;
  rawHeaders: string[];
}

export interface DocumentServer {
  server: Server;
  port: number;
  requests: SeenRequest[];
  sockets: Socket[];
  /** Resolves on the next request the server receives. */
  nextRequest(): Promise<void>;
  close(): Promise<void>;
}

export type DocumentHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

/** A loopback HTTPS server on 127.0.0.1 only. */
export async function startDocumentServer(
  handler: DocumentHandler,
  options: { untrusted?: boolean } = {},
): Promise<DocumentServer> {
  const tls = cimdCertificates();
  const requests: SeenRequest[] = [];
  const sockets: Socket[] = [];
  let waiters: Array<() => void> = [];
  const server = createServer(
    options.untrusted
      ? { key: tls.untrustedKey, cert: tls.untrustedCert }
      : { key: tls.key, cert: tls.cert },
    (request, response) => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        rawHeaders: [...request.rawHeaders],
      });
      const pending = waiters;
      waiters = [];
      for (const wake of pending) wake();
      handler(request, response);
    },
  );
  server.on("secureConnection", (socket: Socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    requests,
    sockets,
    nextRequest: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** Writes one JSON response with the given status and extra headers. */
export function reply(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string | string[]> = {},
): void {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(bytes.length),
    ...headers,
  });
  response.end(bytes);
}

/** A valid CIMD document for `url` (BR-308). */
export function cimdDocument(
  url: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    client_id: url,
    client_name: "Synthetic CIMD client",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    token_endpoint_auth_method: "none",
    ...extra,
  };
}

export interface FakeResolver {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  cancel(): void;
}

export interface ResolverScript {
  v4?: string[] | Error | "never" | ((call: number) => string[]);
  v6?: string[] | Error | "never";
}

/** A `Resolver`-shaped fake; `calls` counts each query, `cancels` each cancel. */
export function scriptedResolver(script: ResolverScript) {
  const state = { v4Calls: 0, v6Calls: 0, cancels: 0, created: 0 };
  const answer = (
    value: ResolverScript["v4"],
    call: number,
  ): Promise<string[]> => {
    if (value === undefined) return Promise.resolve([]);
    if (value === "never") return new Promise<string[]>(() => undefined);
    if (value instanceof Error) return Promise.reject(value);
    if (typeof value === "function") return Promise.resolve(value(call));
    return Promise.resolve([...value]);
  };
  const factory = (): FakeResolver => {
    state.created += 1;
    return {
      resolve4: () => answer(script.v4, ++state.v4Calls),
      resolve6: () => answer(script.v6, ++state.v6Calls),
      cancel: () => {
        state.cancels += 1;
      },
    };
  };
  return { factory, state };
}

export function dnsError(code: string): Error {
  return Object.assign(new Error(`synthetic ${code}`), { code });
}

/** An address policy that allows every address (tests only). */
export const allowEveryAddress = { allows: () => true };

export interface DnsStub {
  port: number;
  /** Receive times (ms since epoch) of every query. */
  received: number[];
  close(): Promise<void>;
}

/**
 * A stub UDP DNS server. With `a` it answers A queries for `host` with that
 * address and every other query with an empty NOERROR answer; without `a` it
 * never answers.
 */
export async function startDnsStub(
  options: { host?: string; a?: string } = {},
): Promise<DnsStub> {
  const socket: UdpSocket = createSocket("udp4");
  const received: number[] = [];
  socket.on("message", (message, remote) => {
    received.push(Date.now());
    if (options.a === undefined) return;
    const answer = dnsAnswer(message, options.host ?? "", options.a);
    if (answer) socket.send(answer, remote.port, remote.address);
  });
  await new Promise<void>((resolve) => {
    socket.bind(0, "127.0.0.1", resolve);
  });
  return {
    port: socket.address().port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      }),
  };
}

function dnsAnswer(
  query: Buffer,
  host: string,
  address: string,
): Buffer | undefined {
  if (query.length < 12) return undefined;
  let offset = 12;
  const labels: string[] = [];
  while (offset < query.length) {
    const length = query[offset] ?? 0;
    offset += 1;
    if (length === 0) break;
    labels.push(query.subarray(offset, offset + length).toString("latin1"));
    offset += length;
  }
  const type = query.readUInt16BE(offset);
  const question = query.subarray(12, offset + 4);
  const name = labels.join(".").toLowerCase();
  const answers: Buffer[] = [];
  if (type === 1 && name === host) {
    const record = Buffer.alloc(16);
    record.writeUInt16BE(0xc00c, 0);
    record.writeUInt16BE(1, 2);
    record.writeUInt16BE(1, 4);
    record.writeUInt32BE(60, 6);
    record.writeUInt16BE(4, 10);
    address.split(".").forEach((part, index) => {
      record[12 + index] = Number(part);
    });
    answers.push(record);
  }
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.readUInt16BE(0), 0);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  return Buffer.concat([header, question, ...answers]);
}

// ---- a fake CIMD fetch port for proxy tests (F-028) -------------------------

/** What the fake port serves for a URL. */
export interface Served {
  status?: number;
  body?: string | Uint8Array | Record<string, unknown> | unknown[];
  cacheControl?: string[];
  /** A failure outcome instead of a document. */
  failure?: {
    reason:
      | "blocked_address"
      | "resolution"
      | "connection"
      | "certificate"
      | "timeout"
      | "status"
      | "content_type"
      | "size";
    status: number;
    transient: boolean;
  };
}

type Outcome =
  | {
      ok: true;
      status: 200;
      body: Uint8Array;
      cacheControl: readonly string[];
    }
  | {
      ok: false;
      reason: NonNullable<Served["failure"]>["reason"];
      status: number;
      transient: boolean;
    };

function outcomeOf(served: Served): Outcome {
  if (served.failure) return { ok: false, ...served.failure };
  const body = served.body;
  let bytes: Uint8Array;
  if (typeof body === "string") bytes = Buffer.from(body);
  else if (body instanceof Uint8Array) bytes = body;
  else bytes = Buffer.from(JSON.stringify(body ?? {}));
  return {
    ok: true,
    status: 200,
    body: bytes,
    cacheControl: served.cacheControl ?? [],
  };
}

/** A counting fake of the `ClientMetadataFetch` port; never touches the network. */
export class FakeMetadata {
  calls: string[] = [];
  signals: AbortSignal[] = [];
  serve = new Map<string, Served | "pending">();
  held: Array<{ url: string; settle: (served: Served) => void }> = [];
  /** Served for a URL with no entry: a valid document. */
  fallback: (url: string) => Served = (url) => ({ body: cimdDocument(url) });
  fetch = (url: string, signal: AbortSignal): Promise<Outcome> => {
    this.calls.push(url);
    this.signals.push(signal);
    const served = this.serve.get(url) ?? this.fallback(url);
    if (served === "pending")
      return new Promise<Outcome>((resolve) => {
        this.held.push({
          url,
          settle: (value) => {
            resolve(outcomeOf(value));
          },
        });
      });
    return Promise.resolve(outcomeOf(served));
  };
  count(url: string): number {
    return this.calls.filter((call) => call === url).length;
  }
}

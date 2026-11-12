// F-014: injected transport for adapter tests. A test `lookup` plus a test
// `connect` that dials a loopback TLS server serving scripted responses
// (BR-216 "injected transport"). Certificates are generated per process with
// the dev image's openssl; no key material is committed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";

export const CANARY = "SYNTHETIC_CANARY_TOKEN_70";
export const API_HOST = "api.infomaniak.com";
export const STORAGE_HOST = "s1.download.kdrive.infomaniakusercontent.com";
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- F-014: a public address literal for the address-policy fixture
export const PUBLIC_ADDRESS = "1.1.1.1";

let material: { ca: string; key: string; cert: string } | undefined;
export function certificates() {
  if (material) return material;
  const dir = mkdtempSync(join(tmpdir(), "kdrive-tls-"));
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
    "/CN=kdrive-test-ca",
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
    `/CN=${API_HOST}`,
  );
  writeFileSync(
    join(dir, "ext.cnf"),
    `subjectAltName=DNS:${API_HOST},DNS:*.download.kdrive.infomaniakusercontent.com\n`,
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
  material = {
    ca: readFileSync(join(dir, "ca.pem"), "utf8"),
    key: readFileSync(join(dir, "server.key"), "utf8"),
    cert: readFileSync(join(dir, "server.pem"), "utf8"),
  };
  return material;
}

export interface Seen {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage["headers"];
  readonly url: string;
  /** F-018: the raw exchange (non-enumerable) for a handler that answers itself. */
  readonly raw?: { req: IncomingMessage; res: ServerResponse };
}
export interface Reply {
  readonly status?: number;
  readonly headers?: Record<string, string | number>;
  readonly json?: unknown;
  readonly body?: string | Buffer;
  /** Never send headers. */
  readonly stall?: "headers" | "body";
  /** Omit Content-Length (chunked transfer). */
  readonly chunked?: true;
  /** F-018: the handler answered (or dropped) the exchange itself. */
  readonly handled?: true;
}
export type Handler = (request: Seen) => Reply | Promise<Reply>;

export interface Upstream {
  readonly port: number;
  readonly seen: Seen[];
  readonly sockets: Set<Socket>;
  /** Canary placements outside the API Authorization header. */
  readonly leaks: string[];
  handler: Handler;
  close(): Promise<void>;
}

export async function startUpstream(handler: Handler): Promise<Upstream> {
  const { key, cert } = certificates();
  const seen: Seen[] = [],
    leaks: string[] = [],
    sockets = new Set<Socket>();
  const state: Upstream = {
    port: 0,
    seen,
    sockets,
    leaks,
    handler,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
  const server: Server = createServer(
    { key, cert },
    (req: IncomingMessage, res: ServerResponse) => {
      void respond(req, res);
    },
  );
  server.on("secureConnection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  async function respond(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `https://${req.headers.host ?? ""}`);
    const request: Seen = {
      method: req.method ?? "",
      host: req.headers.host ?? "",
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      url: req.url ?? "",
    };
    Object.defineProperty(request, "raw", { value: { req, res } });
    for (const [name, value] of Object.entries(req.headers))
      if (
        String(value).includes(CANARY) &&
        !(name === "authorization" && request.host === API_HOST)
      )
        leaks.push(name);
    if ((req.url ?? "").includes(CANARY)) leaks.push("url");
    seen.push(request);
    const reply = await state.handler(request);
    if (reply.stall === "headers" || reply.handled) return;
    const body =
      reply.json !== undefined
        ? Buffer.from(JSON.stringify(reply.json))
        : Buffer.from(reply.body ?? "");
    const headers: Record<string, string | number> = {
      ...(reply.json !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(reply.stall === "body" || reply.chunked
        ? {}
        : { "content-length": body.length }),
      ...reply.headers,
    };
    res.writeHead(reply.status ?? 200, headers);
    if (reply.stall === "body") {
      res.flushHeaders();
      return;
    }
    res.end(body);
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return Object.assign(state, {
    port: (server.address() as AddressInfo).port,
  });
}

export interface ConnectCall {
  readonly options: Record<string, unknown>;
}
/** The injected `{lookup, connect}` pair; `connect` asserts the BR-216 key set. */
export function transport(
  upstream: Upstream,
  addresses: readonly string[] = [PUBLIC_ADDRESS],
) {
  const { ca } = certificates();
  const connects: ConnectCall[] = [];
  const lookups: string[] = [];
  return {
    connects,
    lookups,
    lookup: (hostname: string) => {
      lookups.push(hostname);
      return Promise.resolve(
        addresses.map((address) => ({
          address,
          family: address.includes(":") ? 6 : 4,
        })),
      );
    },
    connect: (options: { host: string; port: number; servername: string }) => {
      connects.push({ options: { ...options } });
      return tlsConnect({
        host: "127.0.0.1",
        port: upstream.port,
        servername: options.servername,
        ca,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// A small fake kDrive serving a synthetic tree (provider wire shapes).

export interface Node {
  readonly id: number;
  readonly parent: number;
  readonly type: "dir" | "file";
  readonly name: string;
  readonly size?: number;
  readonly status?: string | null;
  readonly capabilities?: Record<string, boolean>;
}
export const DRIVE = 101;
export const BYTES = Buffer.from("0123456789abcdef");
export const PROVIDER_ETAG = '"opaque-etag-1"';
export const tree: Node[] = [
  { id: 10, parent: 1, type: "dir", name: "Private" },
  { id: 11, parent: 10, type: "dir", name: "docs" },
  { id: 12, parent: 11, type: "file", name: "a.bin", size: 16 },
  { id: 13, parent: 10, type: "dir", name: "other" },
  { id: 14, parent: 13, type: "file", name: "o.txt", size: 3 },
  { id: 15, parent: 11, type: "file", name: "empty.txt", size: 0 },
];

export function chainOf(nodes: readonly Node[], id: number): Node[] {
  const chain: Node[] = [];
  let current = nodes.find((n) => n.id === id);
  while (current && current.parent !== 1) {
    const parent = nodes.find((n) => n.id === current?.parent);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}
export function pathOf(nodes: readonly Node[], id: number): string {
  if (id === 1) return "/";
  const node = nodes.find((n) => n.id === id);
  return `/${[...chainOf(nodes, id), node]
    .map((n) => n?.name ?? "")
    .join("/")}`;
}
export function providerItem(
  nodes: readonly Node[],
  id: number,
  driveId = DRIVE,
  order: "root-first" | "leaf-first" = "root-first",
): Record<string, unknown> {
  if (id === 1)
    return {
      id: 1,
      drive_id: driveId,
      parent_id: 1,
      type: "dir",
      status: null,
      name: "Root",
      path: "/",
      parents: [],
      capabilities: { can_read: true },
    };
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`unknown ${String(id)}`);
  const parents = chainOf(nodes, id).map((p) => ({
    id: p.id,
    drive_id: driveId,
    parent_id: p.parent,
    type: "dir",
    name: p.name,
  }));
  return {
    id: node.id,
    drive_id: driveId,
    parent_id: node.parent,
    type: node.type,
    status: node.status === undefined ? "ok" : node.status,
    name: node.name,
    path: pathOf(nodes, id),
    ...(node.size === undefined ? {} : { size: node.size }),
    parents: order === "root-first" ? parents : parents.toReversed(),
    capabilities: node.capabilities ?? { can_read: true },
  };
}
export const success = (
  data: unknown,
  extra: Record<string, unknown> = {},
) => ({
  json: { result: "success", data, ...extra },
});
export const notFound: Reply = {
  status: 404,
  json: { result: "error", error: { code: "object_not_found" } },
};

export interface FakeDrive {
  nodes: Node[];
  drives: { id: number; role: string }[];
  etag: string;
  bytes: Buffer;
  pageSize?: number;
  shared?: Record<string, unknown>[];
  overrides: ((request: Seen) => Reply | undefined)[];
}
export function fakeDrive(partial: Partial<FakeDrive> = {}): FakeDrive {
  return {
    nodes: [...tree],
    drives: [{ id: DRIVE, role: "admin" }],
    etag: PROVIDER_ETAG,
    bytes: BYTES,
    overrides: [],
    ...partial,
  };
}

function page(
  entries: readonly unknown[],
  query: URLSearchParams,
  size: number,
): Reply {
  const start = Number(query.get("cursor")?.slice(1) ?? "0");
  const slice = entries.slice(start, start + size),
    more = start + size < entries.length;
  return success(slice, {
    has_more: more,
    cursor: more ? `c${String(start + size)}` : null,
  });
}

/** Serves the provider routes for one synthetic drive and the storage hop. */
export function driveHandler(drive: FakeDrive): Handler {
  return (r) => {
    for (const override of drive.overrides) {
      const reply = override(r);
      if (reply) return reply;
    }
    if (r.host === STORAGE_HOST) return storage(drive, r);
    const size = drive.pageSize ?? Number(r.query.get("limit") ?? "256");
    const item = /^\/3\/drive\/(\d+)\/files\/(\d+)$/u.exec(r.path);
    const list = /^\/3\/drive\/(\d+)\/files\/(\d+)\/files$/u.exec(r.path);
    const collection =
      /^\/3\/drive\/(\d+)\/files\/(search|recents|my_shared)$/u.exec(r.path);
    const download = /^\/2\/drive\/(\d+)\/files\/(\d+)\/download$/u.exec(
      r.path,
    );
    if (r.path === "/2/drive/init") return success({ drives: drive.drives });
    if (r.path === "/3/drive/files/shared_with_me")
      return page(drive.shared ?? [], r.query, size);
    if (item) {
      const id = Number(item[2]);
      if (id !== 1 && !drive.nodes.some((n) => n.id === id)) return notFound;
      return success(providerItem(drive.nodes, id, Number(item[1])));
    }
    if (list) {
      const parent = Number(list[2]);
      const children = drive.nodes
        .filter((n) => n.parent === parent)
        .map((n) => providerItem(drive.nodes, n.id, Number(list[1])));
      return page(children, r.query, size);
    }
    if (collection) {
      const all = drive.nodes.map((n) =>
        providerItem(drive.nodes, n.id, Number(collection[1])),
      );
      const q = r.query.get("query");
      return page(
        q === null ? all : all.filter((i) => String(i.name).includes(q)),
        r.query,
        size,
      );
    }
    if (download)
      return {
        status: 302,
        headers: { location: `https://${STORAGE_HOST}/r/${download[2] ?? ""}` },
      };
    return { status: 500, json: { result: "error" } };
  };
}

function storage(drive: FakeDrive, r: Seen): Reply {
  const range = /^bytes=(\d+)-(\d+)$/u.exec(r.headers.range ?? "");
  const total = drive.bytes.length;
  if (!range)
    return { status: 200, body: drive.bytes, headers: { etag: drive.etag } };
  const start = Number(range[1]),
    end = Math.min(Number(range[2]), total - 1);
  if (start >= total)
    return { status: 416, body: "", headers: { "content-type": "text/html" } };
  return {
    status: 206,
    body: drive.bytes.subarray(start, end + 1),
    headers: {
      "content-range": `bytes ${String(start)}-${String(end)}/${String(total)}`,
      etag: drive.etag,
      "accept-ranges": "bytes",
    },
  };
}

/** Fixture: fake drive + loopback upstream + injected transport. */
export async function kdriveFixture(partial: Partial<FakeDrive> = {}) {
  const drive = fakeDrive(partial);
  const upstream = await startUpstream(driveHandler(drive));
  const injected = transport(upstream);
  return {
    drive,
    upstream,
    ...injected,
    apiRequests: () => upstream.seen.filter((s) => s.host === API_HOST),
    close: async () => {
      await upstream.close();
      if (upstream.leaks.length)
        throw new Error(`canary leaked in ${upstream.leaks.join(",")}`);
    },
  };
}

export type AdapterOptions = Partial<
  Parameters<typeof import("../../src/kdrive/index.js").createKdriveAdapter>[0]
>;
export async function adapterFor(
  f: { lookup: unknown; connect: unknown },
  options: AdapterOptions = {},
) {
  const { createKdriveAdapter } = await import("../../src/kdrive/index.js");
  return createKdriveAdapter({
    token: CANARY,
    lookup: f.lookup as never,
    connect: f.connect as never,
    ...options,
  });
}
export const invocation = () => ({
  invocation: Object.freeze({}),
  listing: Object.freeze({}),
});
export const signal = () => new AbortController().signal;

/** A resolved configuration for drive 101 (synthetic preflight, no adapter). */
export async function configuration(env: Record<string, string> = {}) {
  const { loadConfiguration, preflightConfiguration } =
    await import("../../src/config.js");
  const local = await loadConfiguration({
    argv: [],
    env: { KDRIVE_ID: String(DRIVE), KDRIVE_TOKEN: "SYNTHETIC", ...env },
  });
  return preflightConfiguration(local, {
    inspectDrive: (id) => Promise.resolve({ id, role: "admin" }),
    resolveDirectory: (driveId, selector) =>
      Promise.resolve({
        driveId,
        id: selector.kind === "id" ? selector.value : 1,
        type: "dir",
      }),
  });
}

/** A real SDK client over an in-memory pair to `createNavigationServer`. */
export async function navigationClient(
  dependencies: import("../../src/policy/index.js").PolicyDependencies,
  env: Record<string, string> = {},
) {
  const { Client, InMemoryTransport } =
    await import("@modelcontextprotocol/client");
  const { createNavigationServer } = await import("../../src/navigation.js");
  const server = createNavigationServer(await configuration(env), dependencies);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "kdrive-adapter-test", version: "1" });
  await client.connect(clientSide);
  return {
    client,
    async call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { text: string }[])[0]?.text ?? "";
      return result.isError === true
        ? { error: text }
        : { ok: JSON.parse(text) as unknown };
    },
    async info(fileId: number, driveId = DRIVE) {
      const result = await client.callTool({
        name: "kdrive_info",
        arguments: { drive_id: driveId, file_id: fileId },
      });
      const text = (result.content as { text: string }[])[0]?.text ?? "";
      return result.isError === true
        ? { error: text }
        : { ok: JSON.parse(text) as unknown };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

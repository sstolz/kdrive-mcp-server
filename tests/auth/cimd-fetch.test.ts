// F-028 AC-03 and AC-14 (BR-306): the production fetch port over a local TLS
// server trusted through the injectable CA list, with an injected resolver and
// an allow-all address policy (loopback is otherwise blocked, BR-307).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClientMetadataFetch,
  type ClientMetadataFetchOptions,
} from "../../src/auth/proxy/client-metadata-fetch.js";
import {
  CIMD_HOST,
  allowEveryAddress,
  cimdCertificates,
  dnsError,
  reply,
  scriptedResolver,
  startDnsStub,
  startDocumentServer,
  type DocumentHandler,
  type DocumentServer,
  type ResolverScript,
} from "../helpers/cimd.js";

let servers: DocumentServer[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

async function serve(handler: DocumentHandler, untrusted = false) {
  const server = await startDocumentServer(handler, { untrusted });
  servers.push(server);
  return server;
}

function port(
  script: ResolverScript = { v4: ["127.0.0.1"] },
  extra: Partial<ClientMetadataFetchOptions> = {},
) {
  const resolver = scriptedResolver(script);
  const fetch = createClientMetadataFetch({
    resolver: resolver.factory,
    addressPolicy: allowEveryAddress,
    ca: [cimdCertificates().ca],
    ...extra,
  });
  return { fetch, resolver };
}

const urlFor = (server: { port: number }, path = "/c.json") =>
  `https://${CIMD_HOST}:${String(server.port)}${path}`;
const signal = () => new AbortController().signal;

describe("BR-306 production fetch port (AC-03)", () => {
  it("BR-306 sends one GET with exactly Host, Accept, User-Agent and Connection", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, '{"a":1}', { "Cache-Control": "max-age=600" });
    });
    const { fetch } = port();
    const outcome = await fetch.fetch(urlFor(server), signal());
    expect(outcome).toMatchObject({ ok: true, status: 200 });
    if (!outcome.ok) throw new Error("expected success");
    expect(Buffer.from(outcome.body).toString()).toBe('{"a":1}');
    expect(outcome.cacheControl).toEqual(["max-age=600"]);
    expect(server.requests).toHaveLength(1);
    const seen = server.requests[0]!;
    expect(seen.method).toBe("GET");
    expect(seen.url).toBe("/c.json");
    const names = seen.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .map((name) => name.toLowerCase())
      .sort();
    expect(names).toEqual(["accept", "connection", "host", "user-agent"]);
    const value = (name: string) =>
      seen.rawHeaders[
        seen.rawHeaders.findIndex((entry) => entry.toLowerCase() === name) + 1
      ];
    expect(value("accept")).toBe("application/json");
    expect(value("user-agent")).toBe("kdrive-mcp-server");
    expect(value("connection")).toBe("close");
    expect(value("host")).toBe(`${CIMD_HOST}:${String(server.port)}`);
  });

  it("BR-306 a gzip Content-Encoding fails as content_type, terminal", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}", { "Content-Encoding": "gzip" });
    });
    expect(await port().fetch.fetch(urlFor(server), signal())).toEqual({
      ok: false,
      reason: "content_type",
      status: 200,
      transient: false,
    });
  });

  it("BR-306 an identity Content-Encoding is accepted", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}", { "Content-Encoding": "identity" });
    });
    expect(await port().fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: true,
    });
  });

  it("BR-306 resolves once: a resolver changing its answer is called once and the first answer is used", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}");
    });
    const { fetch, resolver } = port({
      v4: (call) => (call === 1 ? ["127.0.0.1"] : ["127.0.0.3"]),
    });
    expect(await fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: true,
    });
    expect(resolver.state.v4Calls).toBe(1);
    expect(resolver.state.v6Calls).toBe(1);
    expect(server.requests).toHaveLength(1);
  });

  it.each([301, 302, 307, 308, 404])(
    "BR-306 refuses status %i without following, terminal",
    async (status) => {
      const server = await serve((_request, response) => {
        reply(response, status, "{}", { Location: "/other.json" });
      });
      expect(await port().fetch.fetch(urlFor(server), signal())).toEqual({
        ok: false,
        reason: "status",
        status,
        transient: false,
      });
      expect(server.requests.map((request) => request.url)).toEqual([
        "/c.json",
      ]);
    },
  );

  it.each([429, 503])(
    "BR-306 refuses status %i as transient",
    async (status) => {
      const server = await serve((_request, response) => {
        reply(response, status, "{}");
      });
      expect(await port().fetch.fetch(urlFor(server), signal())).toEqual({
        ok: false,
        reason: "status",
        status,
        transient: true,
      });
    },
  );

  it("BR-306 refuses text/html as content_type, terminal", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}", { "Content-Type": "text/html" });
    });
    expect(await port().fetch.fetch(urlFor(server), signal())).toEqual({
      ok: false,
      reason: "content_type",
      status: 200,
      transient: false,
    });
  });

  it.each([
    "application/json; charset=utf-8",
    "application/cimd+json",
    "Application/JSON",
  ])("BR-306 accepts the media type %s", async (type) => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}", { "Content-Type": type });
    });
    expect(await port().fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: true,
    });
  });

  it("BR-306 falls over from an address with no listener to the next checked address", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}");
    });
    const { fetch } = port({ v4: ["127.0.0.2", "127.0.0.1"] });
    expect(await fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: true,
    });
  });

  it("BR-306 accepts 5,120 bytes and refuses 5,121, also with a false Content-Length", async () => {
    const body = (size: number) => Buffer.alloc(size, 0x20);
    const exact = await serve((_request, response) => {
      reply(response, 200, body(5120));
    });
    expect(await port().fetch.fetch(urlFor(exact), signal())).toMatchObject({
      ok: true,
    });
    const over = await serve((_request, response) => {
      reply(response, 200, body(5121));
    });
    expect(await port().fetch.fetch(urlFor(over), signal())).toEqual({
      ok: false,
      reason: "size",
      status: 200,
      transient: false,
    });
    const lying = await serve((request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "100",
      });
      // The socket carries more than announced; Node rejects the excess or
      // the reader stops at its byte limit: both must refuse.
      request.socket.write(body(5121));
      request.socket.end();
    });
    const outcome = await port().fetch.fetch(urlFor(lying), signal());
    expect(outcome.ok).toBe(false);
  });

  it("BR-306 a chunked body over 5,120 bytes fails as size", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(Buffer.alloc(4000, 0x20));
      response.end(Buffer.alloc(1121, 0x20));
    });
    expect(await port().fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: false,
      reason: "size",
    });
  });

  it("BR-306 a body stalled past 5,000 ms fails as timeout at 5,000 ms on the fake clock", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetch, resolver } = port();
    let settled: unknown;
    const pending = fetch.fetch(urlFor(server), signal()).then((outcome) => {
      settled = outcome;
      return outcome;
    });
    await server.nextRequest();
    await new Promise((done) => setImmediate(done));
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({
      ok: false,
      reason: "timeout",
      status: 200,
      transient: true,
    });
    expect(resolver.state.cancels).toBeGreaterThanOrEqual(1);
    await new Promise((done) => setImmediate(done));
    expect(server.sockets.every((socket) => socket.destroyed)).toBe(true);
  });

  it("BR-306 a resolver that never answers fails as timeout at 5,000 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetch, resolver } = port({ v4: "never", v6: "never" });
    let settled: unknown;
    const pending = fetch
      .fetch(`https://${CIMD_HOST}/c.json`, signal())
      .then((outcome) => {
        settled = outcome;
        return outcome;
      });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({
      ok: false,
      reason: "timeout",
      status: 0,
      transient: true,
    });
    expect(resolver.state.cancels).toBe(1);
  });

  it("BR-306 an untrusted certificate fails as certificate, terminal", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}");
    }, true);
    expect(await port().fetch.fetch(urlFor(server), signal())).toEqual({
      ok: false,
      reason: "certificate",
      status: 0,
      transient: false,
    });
  });

  it("BR-306 a refused connection fails as connection, transient", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}");
    });
    const { fetch } = port({ v4: ["127.0.0.2"] });
    expect(await fetch.fetch(urlFor(server), signal())).toEqual({
      ok: false,
      reason: "connection",
      status: 0,
      transient: true,
    });
  });

  it("BR-306 an aborted signal cancels the resolver and destroys the socket", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
    });
    const { fetch, resolver } = port();
    const controller = new AbortController();
    const pending = fetch.fetch(urlFor(server), controller.signal);
    await server.nextRequest();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false });
    expect(resolver.state.cancels).toBeGreaterThanOrEqual(1);
    await new Promise((done) => setTimeout(done, 50));
    expect(server.sockets.every((socket) => socket.destroyed)).toBe(true);
  });

  it("BR-306 ignores proxy variables and NODE_TLS_REJECT_UNAUTHORIZED=0 in a child process", async () => {
    const trusted = await serve((_request, response) => {
      reply(response, 200, "{}");
    });
    const untrusted = await serve((_request, response) => {
      reply(response, 200, "{}");
    }, true);
    let proxied = 0;
    const proxy = createServer((socket: Socket) => {
      proxied += 1;
      socket.destroy();
    });
    await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
    const proxyUrl = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
    const child = spawn(
      process.execPath,
      [
        resolve("tests/helpers/cimd-proxy-child.mjs"),
        String(trusted.port),
        String(untrusted.port),
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_USE_ENV_PROXY: "1",
          HTTPS_PROXY: proxyUrl,
          HTTP_PROXY: proxyUrl,
          https_proxy: proxyUrl,
          http_proxy: proxyUrl,
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          CIMD_TEST_CA: cimdCertificates().ca,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (data: Buffer) => {
      out += data.toString();
    });
    const code = await new Promise<number | null>((done) =>
      child.on("close", done),
    );
    await new Promise<void>((done) => {
      proxy.close(() => {
        done();
      });
    });
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toEqual({
      trusted: { ok: true, status: 200 },
      untrusted: { ok: false, reason: "certificate" },
    });
    expect(proxied).toBe(0);
    expect(trusted.requests).toHaveLength(1);
  });
});

describe("BR-306 c-ares resolution outside the threadpool (AC-14)", () => {
  it("BR-306 the fetch module never calls dns.lookup and creates its Resolver with timeout 2,000 and tries 2", () => {
    const source = readFileSync(
      "src/auth/proxy/client-metadata-fetch.ts",
      "utf8",
    );
    expect(source).not.toMatch(/\blookup\s*\(\s*(?:hostname|host|url)/u);
    expect(source).not.toMatch(/dns\s*\.\s*lookup|\{[^}]*\blookup\b[^}]*\}\s*from\s*"node:dns/u);
    expect(source).toMatch(
      /new\s+(?:dns\.)?Resolver\(\{\s*timeout:\s*2_?000,\s*tries:\s*2\s*\}\)/u,
    );
  });

  it("BR-306 a resolver that never answers is cancelled once at 5,000 ms and fails as timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetch, resolver } = port({ v4: "never", v6: "never" });
    const pending = fetch.fetch(`https://${CIMD_HOST}/c.json`, signal());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ ok: false, reason: "timeout" });
    expect(resolver.state.created).toBe(1);
    expect(resolver.state.cancels).toBe(1);
  });

  it("BR-306 an ENODATA resolve6 and an allowed resolve4 address connect", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}");
    });
    const { fetch } = port({ v4: ["127.0.0.1"], v6: dnsError("ENODATA") });
    expect(await fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: true,
    });
  });

  it("BR-306 an ENOTFOUND query contributes no address", async () => {
    const server = await serve((_request, response) => {
      reply(response, 200, "{}");
    });
    const { fetch } = port({ v4: ["127.0.0.1"], v6: dnsError("ENOTFOUND") });
    expect(await fetch.fetch(urlFor(server), signal())).toMatchObject({
      ok: true,
    });
  });

  it("BR-306 an ESERVFAIL resolve4 fails as resolution, transient", async () => {
    const { fetch } = port({ v4: dnsError("ESERVFAIL"), v6: [] });
    expect(
      await fetch.fetch(`https://${CIMD_HOST}/c.json`, signal()),
    ).toEqual({ ok: false, reason: "resolution", status: 0, transient: true });
  });

  it("BR-306 with UV_THREADPOOL_SIZE=1 four pending fetches leave the pool free and stop querying at the deadline", async () => {
    const stub = await startDnsStub();
    try {
      const child = spawn(
        process.execPath,
        [resolve("tests/helpers/cimd-threadpool-child.mjs"), String(stub.port)],
        {
          env: { PATH: process.env.PATH, UV_THREADPOOL_SIZE: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "";
      let printedAt = 0;
      child.stdout.on("data", (data: Buffer) => {
        out += data.toString();
        printedAt = Date.now();
      });
      const code = await new Promise<number | null>((done) =>
        child.on("close", done),
      );
      const exitedAt = Date.now();
      expect(code).toBe(0);
      const report = JSON.parse(out.trim()) as {
        start: number;
        fileAt: number;
        hashAt: number;
        results: Array<{ outcome: { reason: string }; at: number }>;
      };
      const firstTimeout = Math.min(...report.results.map((r) => r.at));
      expect(report.fileAt).toBeLessThan(firstTimeout);
      expect(report.hashAt).toBeLessThan(firstTimeout);
      expect(report.fileAt).toBeLessThan(4000);
      expect(report.hashAt).toBeLessThan(4000);
      for (const result of report.results) {
        expect(result.outcome.reason).toBe("timeout");
        expect(result.at).toBeGreaterThanOrEqual(5000);
      }
      expect(stub.received.length).toBeGreaterThan(0);
      for (const at of stub.received)
        expect(at).toBeLessThanOrEqual(report.start + 5100);
      // No handle outlives the fetches: the child exits by itself.
      expect(exitedAt - printedAt).toBeLessThan(2000);
    } finally {
      await stub.close();
    }
  }, 20_000);
});

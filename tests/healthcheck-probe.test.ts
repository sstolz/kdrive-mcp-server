import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probe, probePort } from "../src/healthcheck.js";
import { httpFixture, listening } from "./helpers/http.js";

// F-021 AC-06: the container health probe, spawned from the built
// dist/healthcheck.js against loopback test servers only.

const PROBE = "dist/healthcheck.js";
const OK = '{"status":"ok"}';
const LIMITED = '{"error":"rate_limited"}';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function httpServer(
  answer: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
    });
    answer(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
  return { port: (server.address() as AddressInfo).port, seen };
}

async function rawServer(
  onSocket: (socket: Socket) => void,
): Promise<{ port: number; connections: () => number }> {
  let count = 0;
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    count++;
    sockets.add(socket);
    socket.on("error", () => undefined);
    onSocket(socket);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
  };
}

function reply(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      ...headers,
    });
    res.end(body);
  };
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

async function runProbe(env: Record<string, string>): Promise<Run> {
  const started = Date.now();
  const child = spawn(process.execPath, [PROBE], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  return { code, stdout, stderr, ms: Date.now() - started };
}

const port = (value: number) => ({ MCP_HTTP_PORT: String(value) });

function expectFailure(run: Run, code: string): void {
  expect(run.code).toBe(1);
  expect(run.stdout).toBe("");
  expect(run.stderr).toBe(`healthcheck failed: ${code}\n`);
}

describe("BR-326 container health probe", () => {
  it.each([
    [200, OK],
    [429, LIMITED],
  ])(
    "BR-326 AC-06 exits 0 silently on %i with the expected body",
    async (status, body) => {
      const server = await httpServer(reply(status, body));
      const run = await runProbe(port(server.port));
      expect(run).toMatchObject({ code: 0, stdout: "", stderr: "" });
      expect(server.seen).toHaveLength(1);
      const [request] = server.seen;
      expect(request?.method).toBe("GET");
      expect(request?.url).toBe("/healthz");
      expect(request?.headers.host).toBe(`127.0.0.1:${String(server.port)}`);
      expect(request?.headers.authorization).toBeUndefined();
      expect(request?.headers.cookie).toBeUndefined();
    },
  );

  it("BR-326 AC-06 parses a zero-padded port like the server and sends the unpadded number", async () => {
    const server = await httpServer(reply(200, OK));
    const run = await runProbe({ MCP_HTTP_PORT: `0${String(server.port)}` });
    expect(run).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(server.seen[0]?.headers.host).toBe(
      `127.0.0.1:${String(server.port)}`,
    );
  });

  it.each([
    ["200 with another body", 200, '{"status":"fine"}'],
    ["200 over 1,024 bytes", 200, `${OK}${" ".repeat(1010)}`],
    ["429 with another body", 429, '{"error":"other"}'],
    ["429 over 1,024 bytes", 429, `${LIMITED}${" ".repeat(1001)}`],
  ])("BR-326 AC-06 fails body on %s", async (_name, status, body) => {
    const server = await httpServer(reply(status, body));
    expectFailure(await runProbe(port(server.port)), "body");
  });

  it.each([
    [301, { location: "/healthz" }],
    [403, {}],
    [503, {}],
    [500, {}],
  ] as const)(
    "BR-326 AC-06 fails status on %i and follows no redirect",
    async (status, headers) => {
      const server = await httpServer(reply(status, OK, headers));
      expectFailure(await runProbe(port(server.port)), "status");
      expect(server.seen).toHaveLength(1);
    },
  );

  it("BR-326 AC-06 fails connection when nothing listens", async () => {
    const server = await rawServer((socket) => {
      socket.destroy();
    });
    const free = server.port;
    await closers.splice(0)[0]?.();
    expectFailure(await runProbe(port(free)), "connection");
  });

  it("BR-326 AC-06 fails connection on a reset and on an unparsable reply", async () => {
    const reset = await rawServer((socket) => {
      socket.once("data", () => {
        socket.resetAndDestroy();
      });
    });
    expectFailure(await runProbe(port(reset.port)), "connection");
    const garbage = await rawServer((socket) => {
      socket.once("data", () => {
        socket.end("garbage\r\n\r\n");
      });
    });
    expectFailure(await runProbe(port(garbage.port)), "connection");
    const short = await rawServer((socket) => {
      socket.once("data", () => {
        socket.end(
          'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 15\r\n\r\n{"sta',
        );
      });
    });
    expectFailure(await runProbe(port(short.port)), "connection");
  });

  it("BR-326 AC-06 fails timeout after 5,000 ms without a status line or with a stalled body", async () => {
    const silent = await rawServer(() => undefined);
    const first = await runProbe(port(silent.port));
    expectFailure(first, "timeout");
    expect(first.ms).toBeGreaterThanOrEqual(4900);
    expect(first.ms).toBeLessThan(9000);
    const stalled = await rawServer((socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 15\r\n\r\n{",
        );
      });
    });
    const second = await runProbe(port(stalled.port));
    expectFailure(second, "timeout");
    expect(second.ms).toBeGreaterThanOrEqual(4900);
    expect(second.ms).toBeLessThan(9000);
  }, 25_000);

  // Preloaded into the probe: every socket connection attempt writes a marker
  // line to stderr, so an exact stderr match proves no connection was tried.
  const CONNECT_SPY = {
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(
      'import net from "node:net";' +
        "const c = net.Socket.prototype.connect;" +
        "net.Socket.prototype.connect = function (...a) {" +
        'process.stderr.write("CONNECT\\n"); return c.apply(this, a); };',
    )}`,
  };

  it("BR-326 AC-06 connection spy reports a connection attempt", async () => {
    const server = await httpServer(reply(200, OK));
    const run = await runProbe({ ...port(server.port), ...CONNECT_SPY });
    expect(run).toMatchObject({ code: 0, stdout: "", stderr: "CONNECT\n" });
  });

  it.each(["0", "65536", "abc", "-1", "3000.0", " 3000", ""])(
    "BR-326 AC-06 fails port without connecting for MCP_HTTP_PORT %j",
    async (value) => {
      expectFailure(
        await runProbe({ MCP_HTTP_PORT: value, ...CONNECT_SPY }),
        "port",
      );
    },
  );

  it("BR-326 AC-06 ignores proxy environment variables", async () => {
    const server = await httpServer(reply(200, OK));
    const proxy = await rawServer((socket) => {
      socket.destroy();
    });
    const run = await runProbe({
      ...port(server.port),
      NODE_USE_ENV_PROXY: "1",
      HTTP_PROXY: `http://127.0.0.1:${String(proxy.port)}`,
      http_proxy: `http://127.0.0.1:${String(proxy.port)}`,
    });
    expect(run).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(proxy.connections()).toBe(0);
    expect(server.seen).toHaveLength(1);
  });

  it.each([
    ["insecure", { insecure: true, upstream: null }],
    ["authenticated", {}],
  ] as const)(
    "BR-326 BR-322 AC-06 exits 0 against the real F-012 server in %s mode",
    async (_mode, options) => {
      const f = await httpFixture(options);
      const server = await listening(f);
      try {
        const run = await runProbe(port(server.port));
        expect(run).toMatchObject({ code: 0, stdout: "", stderr: "" });
      } finally {
        await server.close();
      }
    },
  );

  it("BR-326 AC-06 imports only node:http and reads only MCP_HTTP_PORT", () => {
    const source = readFileSync("src/healthcheck.ts", "utf8");
    const imports = [...source.matchAll(/\bfrom\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(imports).toEqual(["node:http"]);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    const env = [...source.matchAll(/process\.env(\.\w+|\[[^\]]*\])?/gu)].map(
      (match) => match[1],
    );
    expect(env).toEqual([".MCP_HTTP_PORT"]);
  });
});

describe("BR-326 probe functions (in process)", () => {
  it.each([
    [undefined, 3000],
    ["3000", 3000],
    ["03000", 3000],
    ["1", 1],
    ["65535", 65535],
    ["0", undefined],
    ["65536", undefined],
    ["", undefined],
    ["+1", undefined],
    ["1e3", undefined],
    ["9".repeat(20), undefined],
  ])("BR-326 AC-06 probePort(%j) is %j", (value, expected) => {
    expect(probePort(value)).toBe(expected);
  });

  it("BR-326 AC-06 probe resolves undefined on 200 and the failure code otherwise", async () => {
    const ok = await httpServer(reply(200, OK));
    expect(await probe(ok.port)).toBeUndefined();
    const limited = await httpServer(reply(429, LIMITED));
    expect(await probe(limited.port)).toBeUndefined();
    const status = await httpServer(reply(404, OK));
    expect(await probe(status.port)).toBe("status");
    const body = await httpServer(reply(200, "x".repeat(2000)));
    expect(await probe(body.port)).toBe("body");
    const silent = await rawServer(() => undefined);
    expect(await probe(silent.port, 200)).toBe("timeout");
    const reset = await rawServer((socket) => {
      socket.once("data", () => {
        socket.resetAndDestroy();
      });
    });
    expect(await probe(reset.port)).toBe("connection");
  });
});

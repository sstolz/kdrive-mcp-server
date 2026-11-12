import http from "node:http";
import { createConnection, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serve } from "../../src/http/adapter.js";
import type { HttpHandler, RouteName } from "../../src/http/types.js";
import {
  HOST,
  INITIALIZE,
  exchange,
  httpFixture,
  jsonRpc,
  listening,
  rawHeader,
} from "../helpers/http.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A bare server that answers every request through `serve` with `handler`. */
async function adapterServer(
  handler: HttpHandler,
  events: Array<{ name: string; fields: Record<string, string | number> }>,
) {
  const logger = {
    event(name: string, fields: Record<string, string | number>) {
      events.push({ name, fields });
    },
  };
  const server = http.createServer((req, res) => {
    void serve(handler, logger, req, res, {
      settled: false,
      written: Promise.resolve(),
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

const fixedRoute =
  (name: RouteName) =>
  (target: string): RouteName =>
    target.startsWith("/mcp") ? name : "unknown";

describe("BR-170 forbidden Fetch methods keep the router order", () => {
  for (const method of ["TRACE"]) {
    it(`BR-170 BR-156 (socket) ${method} with a bad Host answers 403 invalid_host`, async () => {
      const f = await httpFixture();
      const server = await listening(f);
      try {
        const response = await exchange(server.port, {
          method,
          target: "/mcp",
          headers: [["Host", "evil.test"]],
        });
        expect(response?.status).toBe(403);
        expect(response?.body).toContain("invalid_host");
      } finally {
        await server.close();
      }
    });
  }

  it("BR-170 BR-154 (socket) TRACE with the right Host answers 405 with the route's Allow, and 404 off-route", async () => {
    const f = await httpFixture();
    const server = await listening(f);
    try {
      const known = await exchange(server.port, {
        method: "TRACE",
        target: "/mcp",
        headers: [["Host", HOST]],
      });
      expect(known?.status).toBe(405);
      expect(known && rawHeader(known, "allow")).toBe("POST, DELETE");
      const unknown = await exchange(server.port, {
        method: "TRACE",
        target: "/nowhere",
        headers: [["Host", HOST]],
      });
      expect(unknown?.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

describe("BR-170 BR-167 adapter-level failures", () => {
  it("BR-170 BR-167 (socket) answers 500 server_error when the response body fails before the head, logging the matched route", async () => {
    const events: Array<{
      name: string;
      fields: Record<string, string | number>;
    }> = [];
    const handler: HttpHandler = {
      handle: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new Error("CANARY-BODY-FAILURE"));
              },
            }),
          ),
        ),
      routeOf: fixedRoute("mcp"),
      close: () => Promise.resolve(),
      closeStore: () => undefined,
    };
    const { server, port } = await adapterServer(handler, events);
    try {
      const response = await exchange(port, {
        target: "/mcp",
        headers: [["Host", HOST]],
      });
      expect(response?.status).toBe(500);
      expect(response?.body).toContain("server_error");
      expect(response?.body).not.toContain("CANARY");
      expect(events).toEqual([
        {
          name: "request_refused",
          fields: { route: "mcp", status: 500, error: "server_error" },
        },
      ]);
    } finally {
      server.close();
    }
  });

  it("BR-167 (socket) the 500 of a throwing handler logs the matched route, not unknown", async () => {
    const events: Array<{
      name: string;
      fields: Record<string, string | number>;
    }> = [];
    const handler: HttpHandler = {
      handle: () => Promise.reject(new Error("CANARY-HANDLER-FAILURE")),
      routeOf: fixedRoute("mcp"),
      close: () => Promise.resolve(),
      closeStore: () => undefined,
    };
    const { server, port } = await adapterServer(handler, events);
    try {
      const response = await exchange(port, {
        target: "/mcp?x=1",
        headers: [["Host", HOST]],
      });
      expect(response?.status).toBe(500);
      expect(events.map((e) => e.fields)).toEqual([
        { route: "mcp", status: 500, error: "server_error" },
      ]);
    } finally {
      server.close();
    }
  });

  it("BR-167 the handler's routeOf names the matched route and unknown otherwise", async () => {
    const f = await httpFixture();
    expect(f.handler.routeOf("/mcp")).toBe("mcp");
    expect(f.handler.routeOf("/mcp?q=1")).toBe("mcp");
    expect(f.handler.routeOf("/nowhere")).toBe("unknown");
    expect(f.handler.routeOf("*")).toBe("unknown");
    await f.handler.close();
  });
});

describe("BR-163 BR-164 a failed registration evicts nothing", () => {
  it("BR-163 BR-164 AC-15 with eight sessions, a logger failure on session_opened closes none of them", async () => {
    const closed: Array<Record<string, string | number>> = [];
    let opened = 0;
    const f = await httpFixture({
      logger: {
        event(name, fields) {
          if (name === "session_closed") closed.push(fields);
          if (name === "session_opened" && ++opened === 9)
            throw new Error("CANARY-LOGGER-FAILURE");
        },
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      f.clock.advance(1000);
      ids.push(await f.open(await f.mint()));
    }
    f.clock.advance(1000);
    const failed = await f.mcp(await f.mint(), INITIALIZE);
    expect(failed.status).toBe(500);
    await failed.text();
    expect(closed.filter((c) => c.reason === "evicted")).toEqual([]);
    for (const id of ids) {
      const used = await f.mcp(await f.mint(), jsonRpc("tools/list", 2), id);
      expect(used.status).toBe(200);
      await used.text();
    }
    await f.handler.close();
  });
});

describe("BR-169 BR-170 aborted connections settle", () => {
  it("BR-169 BR-170 (socket) a request whose client disconnects before the response settles serve at once", async () => {
    const settled: Array<Promise<void>> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const handler: HttpHandler = {
      handle: async () => {
        entered();
        await gate;
        return new Response("{}", {
          headers: { "content-type": "application/json" },
        });
      },
      routeOf: fixedRoute("mcp"),
      close: () => Promise.resolve(),
      closeStore: () => undefined,
    };
    const server = http.createServer((req, res) => {
      settled.push(
        serve(handler, undefined, req, res, {
          settled: false,
          written: Promise.resolve(),
        }),
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const { port } = server.address() as AddressInfo;
      for (const request of [
        `GET /mcp HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`,
        `POST /mcp HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: 10\r\n\r\n{}`,
      ]) {
        const socket = createConnection(port, "127.0.0.1");
        await new Promise<void>((resolve) => socket.once("connect", resolve));
        socket.write(request);
        await started;
        socket.destroy();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      release();
      const outcome = await Promise.race([
        Promise.all(settled).then(() => "settled"),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve("hung");
          }, 2000);
        }),
      ]);
      expect(settled).toHaveLength(2);
      expect(outcome).toBe("settled");
    } finally {
      server.close();
    }
  });
});

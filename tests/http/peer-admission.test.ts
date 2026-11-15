import { DatabaseSync } from "node:sqlite";
import { importJWK, jwtVerify } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import { createHttpHandler, type HttpHandler } from "../../src/http/index.js";
import { signAccessToken, loadSigningKey } from "../../src/auth/proxy/keys.js";
import type { OAuthStateStorePort } from "../../src/auth/proxy/store.js";
import { bodyJson, exchange, httpFixture, listening } from "../helpers/http.js";
import { stateOptions } from "../helpers/http-state.js";
import {
  Clock,
  PUBLIC_URL,
  counterRandom,
  harness,
  json,
  openState,
  removeStateFiles,
  stateFile,
  syntheticPem,
} from "../helpers/proxy.js";

vi.mock("../../src/auth/proxy/keys.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/keys.js")>();
  return { ...actual, signAccessToken: vi.fn(actual.signAccessToken) };
});
afterEach(() => {
  removeStateFiles();
  vi.mocked(signAccessToken).mockClear();
});

it("BR-422 BR-162 v3 AC-13 the adapter passes the socket address", async () => {
  for (const trusted of ["127.0.0.1", ""]) {
    const f = await httpFixture({ env: { MCP_HTTP_TRUSTED_PROXIES: trusted } });
    const server = await listening(f);
    const send = (peer: string) =>
      exchange(server.port, {
        target: "/mcp/oauth/authorize",
        headers: [
          ["Host", "mcp.test"],
          ["X-Forwarded-For", peer],
        ],
      });
    try {
      for (let i = 0; i < 30; i++)
        expect((await send("198.51.100.1"))?.status).toBe(400);
      expect((await send("198.51.100.1"))?.status).toBe(429);
      expect((await send("203.0.113.9"))?.status).toBe(trusted ? 400 : 429);
      expect(f.events("request_refused").at(-1)?.fields.window).toBe("peer");
    } finally {
      await server.close();
      await f.handler.close();
    }
  }
});

interface RefreshFamily {
  clientId: string;
  token: string;
}

async function seedFamilies(path: string, clock: Clock, pem: string) {
  const seed = openState(path, { clock });
  const families: RefreshFamily[] = [];
  try {
    const h = await harness({ clock, pem, store: seed });
    for (let i = 0; i < 20; i++) {
      const done = await h.login();
      families.push({
        clientId: done.client.clientId,
        token: json(await h.redeem(done)).refresh_token as string,
      });
    }
    return families;
  } finally {
    seed.close();
  }
}

function workloadPort() {
  const counts = { commits: 0, rotations: 0 };
  const port: Partial<OAuthStateStorePort> = {
    openDatabase(file) {
      const db = new DatabaseSync(file, { timeout: 0 });
      return {
        exec(sql) {
          db.exec(sql);
          if (sql === "COMMIT") counts.commits++;
        },
        prepare(sql) {
          const statement = db.prepare(sql);
          return {
            run(...args) {
              const result = statement.run(...args);
              if (sql.startsWith("UPDATE families")) counts.rotations++;
              return result;
            },
            get: (...args) => statement.get(...args),
            all: (...args) => statement.all(...args),
          };
        },
        close() {
          db.close();
        },
      };
    },
  };
  return { port, counts };
}

function refreshRequest(
  handler: HttpHandler,
  family: RefreshFamily,
  peer: string,
) {
  const request = new Request("http://placeholder.invalid/", {
    method: "POST",
    headers: {
      host: "mcp.test",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: family.clientId,
      refresh_token: family.token,
    }),
  });
  return handler.handle(request, "/mcp/oauth/token", peer);
}

async function rotateWorkload(
  handler: HttpHandler,
  families: RefreshFamily[],
  clock: Clock,
  pem: string,
) {
  const publicKey = await importJWK(
    loadSigningKey(Buffer.from(pem)).publicJwk,
    "ES256",
  );
  for (const [index, family] of families.entries()) {
    for (let i = 0; i < 60; i++) {
      const response = await refreshRequest(
        handler,
        family,
        `2001:db8:${index.toString(16)}::1`,
      );
      expect(response.status).toBe(200);
      const body = await bodyJson(response);
      const verified = await jwtVerify(body.access_token as string, publicKey, {
        algorithms: ["ES256"],
        issuer: PUBLIC_URL,
        audience: PUBLIC_URL,
        currentDate: clock.now(),
      });
      expect(verified.protectedHeader.alg).toBe("ES256");
      family.token = body.refresh_token as string;
    }
  }
}

async function refreshAfterReopen(
  path: string,
  clock: Clock,
  pem: string,
  families: RefreshFamily[],
) {
  const reopened = openState(path, { clock });
  try {
    const h = await harness({
      clock,
      pem,
      store: reopened,
      random: counterRandom("reopened-workload"),
    });
    for (const family of families) {
      const client = {
        clientId: family.clientId,
        method: "none",
        redirect: "",
      };
      expect((await h.refresh(client, family.token)).status).toBe(200);
    }
  } finally {
    reopened.close();
  }
}

it("BR-162 v3 AC-16 persisted refresh workload respects the global ceiling", async () => {
  const path = stateFile();
  const clock = new Clock();
  const pem = syntheticPem();
  const families = await seedFamilies(path, clock, pem);
  const { port, counts } = workloadPort();
  const options = await stateOptions(path, { clock, pem, port });
  const handler = createHttpHandler({
    ...options.handlerOptions,
    randomBytes: counterRandom("refresh-workload"),
  });
  counts.commits = 0;
  counts.rotations = 0;
  vi.mocked(signAccessToken).mockClear();
  const started = performance.now();
  try {
    await rotateWorkload(handler, families, clock, pem);
    expect(counts).toEqual({ commits: 1200, rotations: 1200 });
    expect(signAccessToken).toHaveBeenCalledTimes(1200);
    const fresh = families[0];
    if (!fresh) throw new Error("missing synthetic family");
    const refused = await refreshRequest(handler, fresh, "2001:db8:ffff::1");
    expect(refused.status).toBe(429);
    expect(options.logs.at(-1)?.fields.window).toBe("global");
    expect(counts).toEqual({ commits: 1200, rotations: 1200 });
    expect(signAccessToken).toHaveBeenCalledTimes(1200);
    // Test-run evidence only; this is deliberately not a throughput assertion.
    const elapsed = Math.round(performance.now() - started);
    console.info(
      `F-035 AC-16: 1200 persisted refreshes in ${String(elapsed)} ms`,
    );
  } finally {
    await handler.close();
    handler.closeStore();
  }
  await refreshAfterReopen(path, clock, pem, families);
}, 120_000);

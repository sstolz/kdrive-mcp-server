// F-014 AC-01 (BR-190) and AC-02 (BR-191).
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_HOST,
  CANARY,
  DRIVE,
  STORAGE_HOST,
  adapterFor,
  certificates,
  invocation,
  kdriveFixture,
  signal,
  transport,
} from "../helpers/kdrive.js";
import { PinnedAgent } from "../../src/kdrive/transport.js";
import { PACKAGE_VERSION } from "../../src/version.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const templates = [
  /^\/2\/drive\/init$/u,
  /^\/3\/drive\/[1-9]\d*\/files\/[1-9]\d*$/u,
  /^\/3\/drive\/[1-9]\d*\/files\/[1-9]\d*\/files$/u,
  /^\/3\/drive\/[1-9]\d*\/files\/search$/u,
  /^\/3\/drive\/[1-9]\d*\/files\/recents$/u,
  /^\/3\/drive\/[1-9]\d*\/files\/my_shared$/u,
  /^\/3\/drive\/files\/shared_with_me$/u,
  /^\/2\/drive\/[1-9]\d*\/files\/[1-9]\d*\/download$/u,
];

describe("BR-190 fixed origin, GET only, route templates", () => {
  it("TestBR190_every_port_uses_GET_on_the_route_table_with_bearer_only_on_the_API_origin", async () => {
    const f = (fixture = await kdriveFixture({
      drives: [
        { id: DRIVE, role: "admin" },
        { id: 202, role: "external" },
      ],
    }));
    const a = await adapterFor(f);
    const d = a.dependencies;
    const scope = { driveId: DRIVE, id: 11 };
    await d.inspect({ driveId: DRIVE, id: 12 }, "live");
    await d.children({
      ...invocation(),
      driveId: DRIVE,
      id: 11,
      location: "live",
    });
    for (const kind of ["list", "search", "recents", "my-shared"])
      await d.collection({
        ...invocation(),
        kind,
        scope,
        ...(kind === "search" ? { query: "a b&c=d/é?#" } : {}),
      });
    await d.received.list(invocation());
    await d.received.inspect({ driveId: 202, id: 12 }, "live");
    await d.received.children({
      ...invocation(),
      driveId: 202,
      id: 11,
      location: "live",
    });
    await d.received.collection({
      ...invocation(),
      kind: "list",
      scope: { driveId: 202, id: 11 },
    });
    const described = (await d.content.describe(
      { driveId: DRIVE, id: 12 },
      signal(),
    )) as {
      etag: string;
    };
    const opened = (await d.content.open(
      {
        target: { driveId: DRIVE, id: 12 },
        start: 0,
        end: 3,
        size_bytes: 16,
        etag: described.etag,
      },
      signal(),
    )) as { body: { close(): void } };
    opened.body.close();
    await a.preflight.inspectDrive(DRIVE);
    await a.preflight.resolveDirectory(DRIVE, {
      driveId: DRIVE,
      kind: "id",
      value: 11,
    });
    await a.preflight.resolveDirectory(DRIVE, {
      driveId: DRIVE,
      kind: "path",
      value: "/Private/docs",
    });

    const seen = f.upstream.seen;
    expect(seen.length).toBeGreaterThan(15);
    for (const r of seen) {
      expect(r.method).toBe("GET");
      if (r.host === API_HOST) {
        expect(templates.some((t) => t.test(r.path))).toBe(true);
        expect(r.headers.authorization).toBe(`Bearer ${CANARY}`);
        expect(r.headers["accept-encoding"]).toBe("identity");
        expect(r.headers["user-agent"]).toBe(
          `kdrive-mcp-server/${PACKAGE_VERSION}`,
        );
      } else {
        expect(r.host).toBe(STORAGE_HOST);
        expect(r.headers.authorization).toBeUndefined();
        expect(r.headers.cookie).toBeUndefined();
      }
    }
    for (const c of f.connects)
      expect([API_HOST, STORAGE_HOST]).toContain(c.options.servername);
    // Query values are encoded by URLSearchParams and arrive unchanged.
    const search = seen.find((r) => r.path.endsWith("/files/search"));
    expect(search?.query.get("query")).toBe("a b&c=d/é?#");
    expect(search?.url).toContain(
      `query=${new URLSearchParams({ q: "a b&c=d/é?#" }).toString().slice(2)}`,
    );
    expect(search?.query.get("directory_id")).toBe("11");
    expect(search?.query.get("limit")).toBe("50");
  });

  it.each([1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "TestBR190_non_safe_integer_ID_%s_throws_before_transport",
    async (bad) => {
      const f = (fixture = await kdriveFixture());
      const a = await adapterFor(f);
      await expect(
        a.dependencies.inspect({ driveId: DRIVE, id: bad }, "live"),
      ).rejects.toThrow("READ_UNAVAILABLE");
      await expect(
        a.dependencies.content.describe({ driveId: bad, id: 12 }, signal()),
      ).rejects.toThrow("READ_UNAVAILABLE");
      await expect(a.preflight.inspectDrive(bad)).rejects.toThrow(
        "READ_UNAVAILABLE",
      );
      expect(f.connects).toHaveLength(0);
      expect(f.lookups).toHaveLength(0);
      expect(f.upstream.seen).toHaveLength(0);
    },
  );
});

describe("BR-191 address policy, TLS verification, no proxy", () => {
  it("TestBR191_agent_without_a_checked_address_refuses_before_connect", () => {
    let dials = 0;
    const agent = new PinnedAgent(() => {
      dials++;
      throw new Error("dialed");
    });
    expect(() => agent.createConnection({ host: API_HOST, port: 443 })).toThrow(
      "READ_UNAVAILABLE",
    );
    expect(dials).toBe(0);
  });
  /* eslint-disable sonarjs/no-hardcoded-ip -- F-014: address-policy fixtures name each refused class */
  const refused = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "240.0.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "198.18.0.1",
    "192.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12::1",
    "ff02::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "64:ff9b::1.2.3.4",
    "64:ff9b:1::1",
    "2002:0a00:0001::1",
    "2001:0:4136:e378::1",
    "2001:db8::1",
    "2001:2::1",
    "100::1",
    "3fff::1",
  ];
  it.each(refused)(
    "TestBR191_refused_address_%s_never_reaches_connect",
    async (address) => {
      const f = (fixture = await kdriveFixture());
      const injected = transport(f.upstream, [address]);
      const a = await adapterFor(injected);
      await expect(
        a.dependencies.inspect({ driveId: DRIVE, id: 12 }, "live"),
      ).rejects.toThrow(/^READ_UNAVAILABLE$/u);
      expect(injected.connects).toHaveLength(0);
    },
  );
  it("TestBR191_mixed_public_and_private_answer_is_refused", async () => {
    const f = (fixture = await kdriveFixture());
    const injected = transport(f.upstream, ["1.1.1.1", "10.0.0.1"]);
    const a = await adapterFor(injected);
    await expect(a.preflight.inspectDrive(DRIVE)).rejects.toThrow(
      "READ_UNAVAILABLE",
    );
    expect(injected.connects).toHaveLength(0);
  });
  it.each(["1.1.1.1", "2606:4700::1111", "::ffff:1.1.1.1"])(
    /* eslint-enable sonarjs/no-hardcoded-ip */
    "TestBR191_public_address_%s_reaches_connect_with_exact_options",
    async (address) => {
      const f = (fixture = await kdriveFixture());
      const injected = transport(f.upstream, [address]);
      const a = await adapterFor(injected);
      expect(await a.preflight.inspectDrive(DRIVE)).toEqual({
        id: DRIVE,
        role: "admin",
      });
      expect(injected.connects).toHaveLength(1);
      const options = injected.connects[0]?.options ?? {};
      expect(Object.keys(options).sort()).toEqual([
        "host",
        "port",
        "servername",
      ]);
      expect(options).toEqual({
        host: address,
        port: 443,
        servername: API_HOST,
      });
      expect(options).not.toHaveProperty("ca");
      expect(options).not.toHaveProperty("rejectUnauthorized");
    },
  );
  it("TestBR191_wrong_CA_fails_TLS_verification", async () => {
    const f = (fixture = await kdriveFixture());
    const { connect: tlsConnect } = await import("node:tls");
    const a = await adapterFor({
      lookup: f.lookup,
      connect: () =>
        tlsConnect({
          host: "127.0.0.1",
          port: f.upstream.port,
          servername: API_HOST,
        }),
    });
    await expect(a.preflight.inspectDrive(DRIVE)).rejects.toThrow(
      /^READ_UNAVAILABLE$/u,
    );
  });
  it("TestBR191_child_with_NODE_USE_ENV_PROXY_and_HTTPS_PROXY_never_contacts_the_proxy", async () => {
    const f = (fixture = await kdriveFixture());
    let proxied = 0;
    const proxy = createServer((socket: Socket) => {
      proxied++;
      socket.destroy();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const proxyUrl = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
    const child = spawn(
      process.execPath,
      [
        resolve("tests/helpers/kdrive-proxy-child.mjs"),
        String(f.upstream.port),
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_USE_ENV_PROXY: "1",
          HTTPS_PROXY: proxyUrl,
          HTTP_PROXY: proxyUrl,
          https_proxy: proxyUrl,
          KDRIVE_TEST_CA: certificates().ca,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    const code = await new Promise<number | null>((r) => child.on("close", r));
    await new Promise<void>((r) => {
      proxy.close(() => {
        r();
      });
    });
    // The child's connect asserted the checked address, servername and the
    // exact key set before dialing (AC-02, same contract as the helper).
    expect(out.trim()).toMatch(
      new RegExp(`^ok ${String(DRIVE)} admin connects=[1-9]\\d*$`, "u"),
    );
    expect(code).toBe(0);
    expect(proxied).toBe(0);
  });
});

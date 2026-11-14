// F-028 AC-04 (BR-307, BR-306): the production address policy and the fetch
// refusal of blocked or empty answers before any connection.
/* eslint-disable sonarjs/no-hardcoded-ip -- F-028: the address policy is tested on literal samples */
import { afterEach, describe, expect, it } from "vitest";
import { productionAddressPolicy } from "../../src/auth/proxy/address-policy.js";
import { createClientMetadataFetch } from "../../src/auth/proxy/client-metadata-fetch.js";
import {
  CIMD_HOST,
  cimdCertificates,
  reply,
  scriptedResolver,
  startDocumentServer,
  type DocumentServer,
} from "../helpers/cimd.js";

let servers: DocumentServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

const BLOCKED_V4: Array<[string, string, string[]]> = [
  ["0.0.0.0/8", "0.1.2.3", ["1.0.0.0"]],
  ["10.0.0.0/8", "10.1.2.3", ["9.255.255.255", "11.0.0.0"]],
  ["100.64.0.0/10", "100.127.255.255", ["100.63.255.255", "100.128.0.0"]],
  ["127.0.0.0/8", "127.0.0.1", ["126.255.255.255", "128.0.0.0"]],
  ["169.254.0.0/16", "169.254.1.1", ["169.253.255.255", "169.255.0.0"]],
  ["172.16.0.0/12", "172.31.255.255", ["172.15.255.255", "172.32.0.0"]],
  ["192.0.0.0/24", "192.0.0.8", ["191.255.255.255", "192.0.1.0"]],
  ["192.0.2.0/24", "192.0.2.1", ["192.0.1.255", "192.0.3.0"]],
  ["192.88.99.0/24", "192.88.99.1", ["192.88.98.255", "192.88.100.0"]],
  ["192.168.0.0/16", "192.168.1.1", ["192.167.255.255", "192.169.0.0"]],
  ["198.18.0.0/15", "198.19.255.255", ["198.17.255.255", "198.20.0.0"]],
  ["198.51.100.0/24", "198.51.100.7", ["198.51.99.255", "198.51.101.0"]],
  ["203.0.113.0/24", "203.0.113.9", ["203.0.112.255", "203.0.114.0"]],
  ["224.0.0.0/4", "224.0.0.1", ["223.255.255.255"]],
  ["240.0.0.0/4", "255.255.255.255", []],
];

const BLOCKED_V6: Array<[string, string]> = [
  ["2001::/23", "2001:1ff::1"],
  ["2001::/32 (Teredo)", "2001:0:4136:e378::1"],
  ["2001:db8::/32", "2001:db8::1"],
  ["2002::/16", "2002:808:808::1"],
  ["3fff::/20", "3fff::1"],
];

const OUTSIDE_GLOBAL = [
  "::",
  "::1",
  "::ffff:8.8.8.8",
  "::ffff:0:8.8.8.8",
  "::8.8.8.8",
  "64:ff9b::808:808",
  "64:ff9b:1::1",
  "fc00::1",
  "fe80::1",
  "fec0::1",
  "ff02::1",
];

describe("BR-307 production address policy (AC-04)", () => {
  it.each(BLOCKED_V4)(
    "BR-307 blocks a sample inside %s and allows its non-blocked neighbours",
    (_range, inside, outside) => {
      expect(productionAddressPolicy.allows(inside)).toBe(false);
      for (const address of outside)
        expect(productionAddressPolicy.allows(address), address).toBe(true);
    },
  );

  it.each(BLOCKED_V6)("BR-307 blocks a sample inside %s", (_range, sample) => {
    expect(productionAddressPolicy.allows(sample)).toBe(false);
  });

  it.each(OUTSIDE_GLOBAL)(
    "BR-307 blocks %s, outside 2000::/3, whatever it embeds",
    (sample) => {
      expect(productionAddressPolicy.allows(sample)).toBe(false);
    },
  );

  it("BR-307 allows 2001:200::1 just outside 2001::/23 and public addresses", () => {
    expect(productionAddressPolicy.allows("2001:200::1")).toBe(true);
    expect(productionAddressPolicy.allows("8.8.8.8")).toBe(true);
    expect(productionAddressPolicy.allows("2606:4700::1")).toBe(true);
  });

  it("BR-307 blocks a value that is not an address", () => {
    expect(productionAddressPolicy.allows("")).toBe(false);
    expect(productionAddressPolicy.allows(CIMD_HOST)).toBe(false);
  });
});

describe("BR-306 BR-307 the fetch refuses a blocked or empty answer without connecting (AC-04)", () => {
  async function attempt(v4: string[], v6: string[] = []) {
    const server = await startDocumentServer((_request, response) => {
      reply(response, 200, "{}");
    });
    servers.push(server);
    let connections = 0;
    server.server.on("connection", () => {
      connections += 1;
    });
    const resolver = scriptedResolver({ v4, v6 });
    const port = createClientMetadataFetch({
      resolver: resolver.factory,
      ca: [cimdCertificates().ca],
    });
    const outcome = await port.fetch(
      `https://${CIMD_HOST}:${String(server.port)}/c.json`,
      new AbortController().signal,
    );
    return { outcome, connections, requests: server.requests.length };
  }

  it("BR-307 one blocked address fails as blocked_address, terminal, status 0", async () => {
    const result = await attempt(["127.0.0.1"]);
    expect(result.outcome).toEqual({
      ok: false,
      reason: "blocked_address",
      status: 0,
      transient: false,
    });
    expect(result.connections).toBe(0);
    expect(result.requests).toBe(0);
  });

  it("BR-307 an allowed and a blocked address together fail as blocked_address", async () => {
    const result = await attempt(["8.8.8.8", "127.0.0.1"]);
    expect(result.outcome).toMatchObject({
      ok: false,
      reason: "blocked_address",
    });
    expect(result.connections).toBe(0);
  });

  it("BR-307 a blocked IPv6 answer beside an allowed IPv4 fails as blocked_address", async () => {
    const result = await attempt(["8.8.8.8"], ["::1"]);
    expect(result.outcome).toMatchObject({
      ok: false,
      reason: "blocked_address",
    });
    expect(result.connections).toBe(0);
  });

  it("BR-306 an empty answer fails as resolution, transient", async () => {
    const result = await attempt([]);
    expect(result.outcome).toEqual({
      ok: false,
      reason: "resolution",
      status: 0,
      transient: true,
    });
    expect(result.connections).toBe(0);
  });
});

import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AuthConfigurationError } from "../../src/auth/access-token.js";
import {
  createOAuthProxy,
  createProductionPorts,
  type UpstreamOidcPort,
} from "../../src/auth/proxy/index.js";
import {
  LOOPBACK,
  PUBLIC_URL,
  UPSTREAM,
  counterRandom,
  publicPem,
  syntheticPem,
} from "../helpers/proxy.js";

function construct(pem: string | Uint8Array, upstream?: UpstreamOidcPort) {
  const clock = vi.fn(() => new Date());
  const random = vi.fn(counterRandom());
  const fetchJson = vi.fn(() => Promise.reject(new Error("no")));
  const postForm = vi.fn(() => Promise.reject(new Error("no")));
  const port = upstream ?? { fetchJson, postForm };
  const proxy = createOAuthProxy({
    config: {
      publicUrl: PUBLIC_URL,
      oauthIssuer: UPSTREAM,
      oauthAllowedSubjects: ["user-1"],
      oauthAllowedEmails: [],
      oauthUpstreamClientId: "c",
      oauthUpstreamClientSecret: "s",
      oauthSigningKey:
        typeof pem === "string" ? new TextEncoder().encode(pem) : pem,
      oauthAllowedRedirectUris: [LOOPBACK],
    },
    clock,
    randomBytes: random,
    upstream: port,
  });
  return { proxy, clock, random, fetchJson, postForm };
}

function thumbprint(pem: string): string {
  const jwk = createPublicKey(pem).export({ format: "jwk" });
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  return createHash("sha256").update(canonical).digest("base64url");
}

describe("BR-124 proxy construction and signing key", () => {
  it("BR-124 constructs without calling any port and derives the RFC 7638 kid", () => {
    const pem = syntheticPem();
    const first = construct(pem);
    expect(first.clock).not.toHaveBeenCalled();
    expect(first.random).not.toHaveBeenCalled();
    expect(first.fetchJson).not.toHaveBeenCalled();
    expect(first.postForm).not.toHaveBeenCalled();
    expect(first.proxy.kid).toBe(thumbprint(pem));
    expect(construct(pem).proxy.kid).toBe(first.proxy.kid);
    expect(construct(syntheticPem()).proxy.kid).not.toBe(first.proxy.kid);
  });

  it("BR-124 refuses every other key material with one identical fixed message", () => {
    const ec = syntheticPem();
    const inputs: (string | Uint8Array)[] = [
      syntheticPem("ec", "P-384"),
      syntheticPem("rsa"),
      syntheticPem("ed25519"),
      publicPem(),
      `${ec}${syntheticPem()}`,
      new Uint8Array(randomBytes(256)),
      ec.replace("PRIVATE KEY-----\n", "PRIVATE KEY-----\nAAAA"),
    ];
    const messages = new Set<string>();
    for (const input of inputs) {
      let caught: unknown;
      try {
        construct(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AuthConfigurationError);
      const message = (caught as Error).message;
      messages.add(message);
      const text =
        typeof input === "string"
          ? input
          : Buffer.from(input).toString("latin1");
      for (let index = 0; index + 16 <= text.length; index += 1)
        expect(message).not.toContain(text.slice(index, index + 16));
    }
    expect(messages.size).toBe(1);
  });

  it("BR-124 production ports use node:crypto randomBytes and the system clock", () => {
    const ports = createProductionPorts();
    expect(ports.randomBytes).toBe(randomBytes);
    const before = Date.now();
    const value = ports.clock().getTime();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

// F-028 AC-13: the production composition passes no CIMD test seam.
describe("F-028 AC-13 production composition has no CIMD seam", () => {
  it("BR-306 src/main.ts passes no resolver, address policy, CA override or DNS server list", () => {
    const main = readFileSync("src/main.ts", "utf8");
    for (const seam of [
      "clientMetadataSeam",
      "clientMetadataFetch",
      "createClientMetadataFetch",
      "addressPolicy",
      "dnsServers",
      "resolver",
    ])
      expect(main, seam).not.toContain(seam);
  });

  it("BR-306 the proxy builds the production port without options and the handler only forwards the seam", () => {
    const proxySource = readFileSync("src/auth/proxy/proxy.ts", "utf8");
    expect(proxySource).toContain("createClientMetadataFetch()");
    const handler = readFileSync("src/http/handler.ts", "utf8");
    const calls = [
      ...handler.matchAll(/createClientMetadataFetch\(([^)]*)\)/gu),
    ].map((match) => match[1]);
    expect(calls).toEqual(["options.clientMetadataSeam"]);
    const acceptance = readFileSync("scripts/http-acceptance.ts", "utf8");
    const main = acceptance.slice(acceptance.indexOf("async function main"));
    expect(main).not.toContain("clientMetadataSeam");
  });
});

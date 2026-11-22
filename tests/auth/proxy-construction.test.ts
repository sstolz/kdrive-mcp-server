import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfiguration, ConfigurationError } from "../../src/config.js";
import { SIGNING_KEY_ERROR } from "../../src/auth/proxy/keys.js";
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
    ].map((match) => (match[1] ?? "").replaceAll(/[\s,]/gu, ""));
    expect(calls).toEqual(["options.clientMetadataSeam"]);
    const acceptance = readFileSync("scripts/http-acceptance.ts", "utf8");
    const main = acceptance.slice(acceptance.indexOf("async function main"));
    expect(main).not.toContain("clientMetadataSeam");
  });
});

function loadSyntheticSigning(content: Uint8Array) {
  return loadConfiguration({
    argv: [],
    env: {
      KDRIVE_ID: "7",
      KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
      KDRIVE_MCP_TRANSPORT: "http",
      MCP_PUBLIC_URL: "https://service.example.com/mcp",
      OAUTH_MODE: "proxy",
      OAUTH_ISSUER: "https://issuer.example.org",
      OAUTH_ALLOWED_SUBJECTS: "synthetic-subject",
      OAUTH_UPSTREAM_CLIENT_ID: "synthetic-client",
      OAUTH_UPSTREAM_CLIENT_SECRET: "SYNTHETIC_CLIENT_SECRET",
      OAUTH_SIGNING_KEY_FILE: "/synthetic/key",
      OAUTH_ALLOWED_REDIRECT_URIS: "https://client.example.net/callback",
    },
    readFile: () => Promise.resolve(content),
  });
}
function signingBytes(
  config: Awaited<ReturnType<typeof loadConfiguration>>,
): Uint8Array {
  if (!config.oauthSigningKey) throw new Error("expected signing bytes");
  return config.oauthSigningKey;
}
function expectSigningConstruction(content: Uint8Array, kid: string) {
  const result = construct(content);
  expect(result.proxy.kid).toBe(kid);
  expect(result.clock).not.toHaveBeenCalled();
  expect(result.random).not.toHaveBeenCalled();
  expect(result.fetchJson).not.toHaveBeenCalled();
  expect(result.postForm).not.toHaveBeenCalled();
}
function expectSigningRefusal(content: Uint8Array) {
  let caught: unknown;
  try {
    construct(content);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AuthConfigurationError);
  if (!(caught instanceof AuthConfigurationError))
    throw new Error("expected signing refusal");
  expect(caught.message).toBe(SIGNING_KEY_ERROR);
}
function signingOutcome(
  content: Uint8Array,
): { kid: string } | { error: string } {
  try {
    return { kid: construct(content).proxy.kid };
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    return { error: error.message };
  }
}
// The generated fixture has only a terminal LF as outer padding.
const unpaddedSyntheticPem = () => syntheticPem().replace(/\n$/u, "");

for (const variant of [
  {
    name: "BR-026 v2 BR-124 v2 AC-15 signing trailing LF",
    padding: ["\n", "\n\n"],
  },
  {
    name: "BR-026 v2 BR-124 v2 AC-16 signing trailing CRLF",
    padding: ["\r\n", "\r\n\r\n"],
  },
]) {
  it.each(variant.padding)(variant.name, async (padding) => {
    const pem = unpaddedSyntheticPem();
    const loaded = signingBytes(
      await loadSyntheticSigning(Buffer.from(pem + padding)),
    );
    expect(Buffer.from(loaded).equals(Buffer.from(pem))).toBe(true);
    expectSigningConstruction(loaded, construct(pem).proxy.kid);
  });
}
it.each([
  [" \t", "\t "],
  ["\r\n\t ", " \t\r\n"],
])(
  "BR-026 v2 BR-124 v2 AC-17 signing surrounding spaces and tabs",
  async (prefix, suffix) => {
    const pem = unpaddedSyntheticPem();
    const loaded = signingBytes(
      await loadSyntheticSigning(Buffer.from(prefix + pem + suffix)),
    );
    expect(Buffer.from(loaded).equals(Buffer.from(pem))).toBe(true);
    expectSigningConstruction(loaded, construct(pem).proxy.kid);
  },
);
it.each(["", " ", "\t", "\r", "\n", " \t\r\n\n"])(
  "BR-026 v2 BR-124 v2 AC-18 signing empty after trim",
  async (content) => {
    await expect(
      loadSyntheticSigning(Buffer.from(content)),
    ).rejects.toBeInstanceOf(ConfigurationError);
    await expect(
      loadSyntheticSigning(Buffer.from(content)),
    ).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
      setting: "oauthSigningKeyFile",
    });
  },
);
// Direct construction pins the existing parser independently of file loading.
// These expectations require execution in the project's Docker gate.
it.each(["LF", "CRLF", "space", "tab"] as const)(
  "BR-026 v2 BR-124 v2 AC-19 signing interior whitespace",
  async (variant) => {
    const pem = unpaddedSyntheticPem();
    const content =
      variant === "CRLF"
        ? pem.replaceAll("\n", "\r\n")
        : variant === "LF"
          ? pem
          : pem.replace(
              /(-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=])/u,
              `$1${variant === "space" ? " " : "\t"}`,
            );
    const original = Buffer.from(content);
    const accepted = variant === "LF" || variant === "CRLF";
    if (accepted) expectSigningConstruction(original, construct(pem).proxy.kid);
    else expectSigningRefusal(original);
    const loaded = signingBytes(await loadSyntheticSigning(original));
    expect(Buffer.from(loaded).equals(original)).toBe(true);
    if (accepted) expectSigningConstruction(loaded, construct(pem).proxy.kid);
    else expectSigningRefusal(loaded);
  },
);
it.each(["\u00a0", "\u2003"])(
  "BR-026 v2 BR-124 v2 AC-20 signing nontrimmed Unicode",
  async (edge) => {
    const pem = unpaddedSyntheticPem();
    const original = Buffer.from(edge + pem + (edge === "\u2003" ? "" : edge));
    // Non-BOM Unicode remains significant to the unchanged parser.
    const direct = signingOutcome(original);
    if ("error" in direct) expect(direct.error).toBe(SIGNING_KEY_ERROR);
    const loaded = signingBytes(await loadSyntheticSigning(original));
    expect(Buffer.from(loaded).equals(original)).toBe(true);
    expect(signingOutcome(loaded)).toEqual(direct);
    expectSigningRefusal(loaded);
  },
);
it.each(["NUL", "invalid UTF-8"])(
  "BR-026 v2 BR-124 v2 AC-21 signing NUL and invalid encoding",
  async (variant) => {
    const pem = unpaddedSyntheticPem();
    const core = Buffer.concat([
      Buffer.from([variant === "NUL" ? 0 : 0xff]),
      Buffer.from(pem),
    ]);
    const loaded = signingBytes(
      await loadSyntheticSigning(
        Buffer.concat([Buffer.from(" \t"), core, Buffer.from("\n")]),
      ),
    );
    expect(Buffer.from(loaded).equals(core)).toBe(true);
    expectSigningRefusal(loaded);
  },
);
it("BR-026 v2 BR-023 v4 AC-22 raw file budgets precede trimming", async () => {
  const pem = unpaddedSyntheticPem();
  const loaded = signingBytes(
    await loadSyntheticSigning(
      Buffer.from(" ".repeat(65536 - Buffer.byteLength(pem)) + pem),
    ),
  );
  expect(Buffer.from(loaded).equals(Buffer.from(pem))).toBe(true);
  expectSigningConstruction(loaded, construct(pem).proxy.kid);
});
it.each(["P-384", "RSA", "Ed25519", "public", "two blocks", "corrupted"])(
  "BR-026 v3 BR-124 v2 F-049 AC-22 key qualification unchanged",
  async (variant) => {
    let pem: string;
    switch (variant) {
      case "P-384":
        pem = syntheticPem("ec", "P-384");
        break;
      case "RSA":
        pem = syntheticPem("rsa");
        break;
      case "Ed25519":
        pem = syntheticPem("ed25519");
        break;
      case "public":
        pem = publicPem();
        break;
      case "two blocks":
        pem = syntheticPem() + syntheticPem();
        break;
      default:
        pem = syntheticPem().replace(
          "PRIVATE KEY-----\n",
          "PRIVATE KEY-----\nAAAA",
        );
    }
    const loaded = signingBytes(
      await loadSyntheticSigning(Buffer.from(" \t\r\n" + pem + " \t\r\n")),
    );
    expectSigningRefusal(loaded);
  },
);

const fileBom = Buffer.from([0xef, 0xbb, 0xbf]);
const filePadding = Buffer.from([0x20, 0x09, 0x0d, 0x0a]);
for (const ac of ["19", "20"] as const) {
  const labels =
    ac === "19"
      ? ["prefix", "both edges", "padded prefix"]
      : [
          "suffix",
          "interior",
          "after padding",
          "between padding",
          "after newline",
        ];
  it.each(labels)(
    `BR-026 v3 BR-124 v2 F-049 AC-${ac} ${ac === "19" ? "BOM refuses before construction" : "signing suffix and interior BOM refused"}`,
    async (variant) => {
      const pem = unpaddedSyntheticPem();
      const core = Buffer.from(pem);
      const fixtures: Record<string, Buffer> = {
        prefix: Buffer.concat([fileBom, core]),
        "both edges": Buffer.concat([fileBom, core, fileBom]),
        "padded prefix": Buffer.concat([
          filePadding,
          fileBom,
          core,
          filePadding,
        ]),
        suffix: Buffer.concat([core, fileBom]),
        interior: Buffer.from(
          pem.replace(
            /(-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=])/u,
            "$1\ufeff",
          ),
        ),
        "after padding": Buffer.concat([core, filePadding, fileBom]),
        "between padding": Buffer.concat([
          core,
          filePadding,
          fileBom,
          filePadding,
        ]),
        "after newline": Buffer.concat([core, Buffer.from([10]), fileBom]),
      };
      const clock = vi.fn(() => new Date());
      const random = vi.fn(counterRandom());
      const fetchJson = vi.fn(() =>
        Promise.reject(new Error("unexpected port")),
      );
      const postForm = vi.fn(() =>
        Promise.reject(new Error("unexpected port")),
      );
      const continuation = vi.fn(
        (config: Awaited<ReturnType<typeof loadConfiguration>>) => {
          createOAuthProxy({
            config: {
              publicUrl: PUBLIC_URL,
              oauthIssuer: UPSTREAM,
              oauthAllowedSubjects: ["synthetic-subject"],
              oauthAllowedEmails: [],
              oauthUpstreamClientId: "synthetic-client",
              oauthUpstreamClientSecret: "SYNTHETIC_CLIENT_SECRET",
              oauthSigningKey: signingBytes(config),
              oauthAllowedRedirectUris: [LOOPBACK],
            },
            clock,
            randomBytes: random,
            upstream: { fetchJson, postForm },
          });
          // Fail even if this runtime happens to accept BOM-wrapped keys.
          throw new Error("unexpected key construction");
        },
      );
      const content = fixtures[variant];
      if (!content) throw new Error("missing synthetic fixture");
      await expect(
        loadSyntheticSigning(content).then(continuation),
      ).rejects.toMatchObject({
        code: "CREDENTIAL_BOM",
        setting: "oauthSigningKeyFile",
      });
      for (const port of [continuation, clock, random, fetchJson, postForm])
        expect(port).not.toHaveBeenCalled();
    },
  );
}
it("BR-026 v3 BR-124 v2 F-049 AC-21 valid signing padding unchanged", async () => {
  const pem = unpaddedSyntheticPem();
  const loaded = signingBytes(
    await loadSyntheticSigning(
      Buffer.concat([filePadding, Buffer.from(pem), filePadding]),
    ),
  );
  expect(Buffer.from(loaded).equals(Buffer.from(pem))).toBe(true);
  expectSigningConstruction(loaded, thumbprint(pem));
});
for (const [label, marker] of [
  ["UTF-16LE marker stays opaque", [0xff, 0xfe]],
  ["UTF-16BE marker stays opaque", [0xfe, 0xff]],
] as const) {
  it(`BR-026 v3 BR-124 v2 F-049 AC-15 ${label}`, async () => {
    const original = Buffer.concat([
      Buffer.from(marker),
      Buffer.from(unpaddedSyntheticPem()),
    ]);
    const loaded = signingBytes(await loadSyntheticSigning(original));
    expect(Buffer.from(loaded).equals(original)).toBe(true);
    expectSigningRefusal(loaded);
  });
}

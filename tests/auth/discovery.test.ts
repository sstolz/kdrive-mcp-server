import { describe, expect, it } from "vitest";
import { usableKeys } from "../../src/auth/access-token.js";
import {
  discover,
  parseIssuer,
  wellKnownUrls,
} from "../../scripts/oidc/discovery.js";
import { run } from "../../scripts/oidc-qualify.js";
import { issuer, signingKey } from "../helpers/oidc.js";
import { harness, tokenArgs } from "../helpers/oidc-run.js";
import {
  fakeFetch,
  jwksUrl,
  metadata,
  oauthUrl,
  oidcUrl,
  without,
} from "../helpers/oidc-provider.js";

async function ecKey() {
  return (await signingKey("ES256")).jwk;
}

async function oidcOnly(document: Record<string, unknown>, jwks?: unknown) {
  const provider = fakeFetch({
    [oidcUrl]: { body: document },
    [jwksUrl]: { body: jwks ?? { keys: [await ecKey()] } },
  });
  return { result: await discover(issuer, provider.fetch), provider };
}

describe("BR-094 discovery documents", () => {
  it("BR-094 an issuer differing by one trailing slash makes the document unusable; one usable and one 404 is usable", async () => {
    const mismatch = await oidcOnly(metadata({ issuer: `${issuer}/` }));
    expect(mismatch.result.usable).toBe(false);
    expect(mismatch.result.documents.map((d) => d.state)).toEqual([
      "unusable",
      "unavailable",
    ]);
    const usable = await oidcOnly(metadata());
    expect(usable.result.usable).toBe(true);
    expect(usable.result.documents.map((d) => d.state)).toEqual([
      "usable",
      "unavailable",
    ]);
  });

  it("BR-094 non-object JSON, invalid JSON and redirects are unusable or unavailable", async () => {
    for (const response of [
      { body: [metadata()] },
      { raw: "{not json" },
      { status: 302, body: metadata() },
    ]) {
      const provider = fakeFetch({ [oidcUrl]: response });
      expect((await discover(issuer, provider.fetch)).usable).toBe(false);
    }
  });

  it("BR-094 every request has a deadline and follows no redirect", async () => {
    const { provider } = await oidcOnly(metadata());
    expect(provider.calls.length).toBeGreaterThan(0);
    for (const call of provider.calls) {
      expect(call.redirect).toBe("manual");
      expect(call.signal).toBe(true);
    }
  });

  it.each([
    "http://idp.test",
    "https://idp.test?x=1",
    "https://idp.test#f",
    "https://u@idp.test",
    "https://u:p@idp.test",
    "idp.test",
    "",
  ])("BR-094 issuer %s is refused before any fetch", (value) => {
    expect(parseIssuer(value)).toBeUndefined();
  });

  it("BR-094 a refused issuer makes no fetch and writes nothing in a full run", async () => {
    for (const value of [
      "http://idp.test",
      "https://idp.test?x=1",
      "https://idp.test#f",
      "https://u@idp.test",
    ])
      for (const args of [
        ["discover", "--issuer", value, "--label", "x"],
        tokenArgs().map((arg, index, all) =>
          all[index - 1] === "--issuer" ? value : arg,
        ),
      ]) {
        const h = await harness();
        expect(await run(args, h.deps), value).not.toBe(0);
        expect(h.calls).toEqual([]);
        expect(h.reports.size).toBe(0);
      }
  });

  it("BR-094 builds both well-known URLs, keeping the port and stripping one trailing slash", () => {
    expect(wellKnownUrls("https://idp.test/realm")).toEqual({
      openid: "https://idp.test/realm/.well-known/openid-configuration",
      oauth: "https://idp.test/.well-known/oauth-authorization-server/realm",
    });
    expect(wellKnownUrls("https://idp.test:8443/realm/")).toEqual({
      openid: "https://idp.test:8443/realm/.well-known/openid-configuration",
      oauth:
        "https://idp.test:8443/.well-known/oauth-authorization-server/realm",
    });
    expect(wellKnownUrls("https://idp.test")).toEqual({
      openid: "https://idp.test/.well-known/openid-configuration",
      oauth: "https://idp.test/.well-known/oauth-authorization-server",
    });
  });

  it("BR-094 fetches exactly the two documents for a path issuer", async () => {
    const provider = fakeFetch({});
    await discover("https://idp.test:8443/realm/", provider.fetch);
    expect(provider.calls.map((call) => call.url)).toEqual([
      "https://idp.test:8443/realm/.well-known/openid-configuration",
      "https://idp.test:8443/.well-known/oauth-authorization-server/realm",
    ]);
  });
});

describe("BR-095 capability evaluation", () => {
  it("BR-095 the complete variant is yes for every capability", async () => {
    const { result } = await oidcOnly(metadata());
    expect(result.effective).toEqual({
      pkceS256: "yes",
      authorizationCode: "yes",
      dynamicRegistration: "yes",
      cimd: "yes",
      jwks: "yes",
      tokenAuthNone: "yes",
      tokenAuthClientSecretBasic: "yes",
      tokenAuthClientSecretPost: "yes",
      issParameter: "yes",
    });
    expect(result.contradictions).toEqual([]);
    expect(result.anomalies).toEqual([]);
    expect(result.authorizationEndpoint).toBe(`${issuer}/authorize`);
    expect(result.tokenEndpoint).toBe(`${issuer}/token`);
    expect(result.keys).toHaveLength(1);
  });

  it.each([
    [
      without(metadata(), "code_challenge_methods_supported"),
      "pkceS256",
      "unknown",
    ],
    [
      metadata({ code_challenge_methods_supported: ["plain"] }),
      "pkceS256",
      "no",
    ],
    [
      metadata({ registration_endpoint: "http://idp.test/register" }),
      "dynamicRegistration",
      "no",
    ],
    [
      without(metadata(), "registration_endpoint"),
      "dynamicRegistration",
      "unknown",
    ],
    [metadata({ client_id_metadata_document_supported: "true" }), "cimd", "no"],
    [
      without(metadata(), "client_id_metadata_document_supported"),
      "cimd",
      "unknown",
    ],
    [without(metadata(), "grant_types_supported"), "authorizationCode", "yes"],
    [
      metadata({ grant_types_supported: ["implicit"] }),
      "authorizationCode",
      "no",
    ],
    [
      without(metadata(), "token_endpoint_auth_methods_supported"),
      "tokenAuthClientSecretBasic",
      "unknown",
    ],
    [
      metadata({
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      "tokenAuthNone",
      "no",
    ],
    [metadata({ jwks_uri: "http://idp.test/jwks" }), "jwks", "no"],
    [without(metadata(), "jwks_uri"), "jwks", "unknown"],
    [
      without(metadata(), "authorization_response_iss_parameter_supported"),
      "issParameter",
      "no",
    ],
    [
      metadata({ authorization_response_iss_parameter_supported: false }),
      "issParameter",
      "no",
    ],
  ] as const)(
    "BR-095 metadata variant %# yields the specified value",
    async (document, name, value) => {
      const { result } = await oidcOnly(document);
      expect(result.effective[name]).toBe(value);
    },
  );

  it("BR-095 a string iss-parameter flag is no with an anomaly listed", async () => {
    const { result } = await oidcOnly(
      metadata({ authorization_response_iss_parameter_supported: "true" }),
    );
    expect(result.effective.issParameter).toBe("no");
    expect(result.anomalies).toEqual([
      "RFC 9207 iss-parameter flag is not a boolean",
    ]);
  });

  async function both(
    openid: Record<string, unknown>,
    oauth: Record<string, unknown>,
    jwks: Record<string, unknown> = {},
  ) {
    const key = await ecKey();
    const provider = fakeFetch({
      [oidcUrl]: { body: openid },
      [oauthUrl]: { body: oauth },
      [jwksUrl]: { body: { keys: [key] } },
      ...Object.fromEntries(
        Object.entries(jwks).map(([url, body]) => [url, { body }]),
      ),
    });
    return discover(issuer, provider.fetch);
  }

  it("BR-095 different endpoint values in two usable documents are listed as anomalies", async () => {
    const result = await both(
      metadata(),
      metadata({
        authorization_endpoint: `${issuer}/other-authorize`,
        token_endpoint: `${issuer}/other-token`,
      }),
    );
    expect(result.anomalies).toEqual([
      "authorization_endpoint differs between documents",
      "token_endpoint differs between documents",
    ]);
    const same = await both(metadata(), metadata());
    expect(same.anomalies).toEqual([]);
  });

  it("BR-095 different jwks_uri values make JWKS unknown with the contradiction listed", async () => {
    const other = `${issuer}/other-jwks`;
    const result = await both(metadata(), metadata({ jwks_uri: other }), {
      [other]: { keys: [await ecKey()] },
    });
    expect(result.effective.jwks).toBe("unknown");
    expect(result.contradictions).toContain("jwks");
    expect(result.keys).toEqual([]);
  });

  it("BR-095 auth methods post-only in one document and absent in the other make basic no", async () => {
    const result = await both(
      metadata({
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      without(metadata(), "token_endpoint_auth_methods_supported"),
    );
    expect(result.effective.tokenAuthClientSecretBasic).toBe("no");
    expect(result.effective.tokenAuthClientSecretPost).toBe("yes");
    const absent = await both(
      without(metadata(), "token_endpoint_auth_methods_supported"),
      without(metadata(), "token_endpoint_auth_methods_supported"),
    );
    expect(absent.effective.tokenAuthClientSecretBasic).toBe("unknown");
  });

  it("BR-095 S256 in one document and plain in the other is unknown with the contradiction listed", async () => {
    const result = await both(
      metadata(),
      metadata({ code_challenge_methods_supported: ["plain"] }),
    );
    expect(result.effective.pkceS256).toBe("unknown");
    expect(result.contradictions).toEqual(["pkceS256"]);
  });

  it("BR-095 iss-parameter true in one document and absent in the other is unknown", async () => {
    const result = await both(
      metadata(),
      without(metadata(), "authorization_response_iss_parameter_supported"),
    );
    expect(result.effective.issParameter).toBe("unknown");
    expect(result.contradictions).toEqual(["issParameter"]);
  });

  it("BR-095 combination table for two usable documents", async () => {
    const cases: Array<[unknown, unknown, string]> = [
      [["S256"], ["S256"], "yes"],
      [["S256"], undefined, "yes"],
      [["plain"], ["plain"], "no"],
      [["plain"], undefined, "no"],
      [undefined, undefined, "unknown"],
    ];
    for (const [first, second, expected] of cases) {
      const document = (value: unknown) =>
        value === undefined
          ? without(metadata(), "code_challenge_methods_supported")
          : metadata({ code_challenge_methods_supported: value });
      const result = await both(document(first), document(second));
      expect(result.effective.pkceS256).toBe(expected);
    }
  });

  it("BR-095 an unusable document does not contribute", async () => {
    const result = await both(
      metadata(),
      metadata({
        issuer: "https://elsewhere.test",
        code_challenge_methods_supported: ["plain"],
      }),
    );
    expect(result.effective.pkceS256).toBe("yes");
    expect(result.contradictions).toEqual([]);
  });
});

describe("BR-107 usable JWKS keys", () => {
  it("BR-107 only the valid EC key makes JWKS yes; a private member poisons the whole set", async () => {
    const valid = await ecKey();
    const rsa = (await signingKey("RS256")).jwk;
    const ed = (await signingKey("Ed25519")).jwk;
    const variants: Array<[string, unknown[], string]> = [
      ["only oct", [{ kty: "oct", k: "c2VjcmV0" }], "no"],
      ["RSA with d", [{ ...rsa, d: "x" }], "no"],
      ["RSA use enc", [{ ...rsa, use: "enc" }], "no"],
      ["RSA alg HS256", [{ ...rsa, alg: "HS256" }], "no"],
      ["OKP X25519", [{ ...ed, crv: "X25519" }], "no"],
      ["EC secp256k1", [{ ...valid, crv: "secp256k1" }], "no"],
      ["RSA key_ops encrypt", [{ ...rsa, key_ops: ["encrypt"] }], "no"],
      ["valid EC", [valid], "yes"],
      ["private member with a valid key", [valid, { ...rsa, p: "x" }], "no"],
    ];
    for (const [name, keys, expected] of variants) {
      const { result } = await oidcOnly(metadata(), { keys });
      expect(result.effective.jwks, name).toBe(expected);
    }
  });

  it("BR-107 accepted key shapes", async () => {
    const rsa = (await signingKey("RS256")).jwk;
    const ed = (await signingKey("Ed25519")).jwk;
    const p384 = (await signingKey("ES384")).jwk;
    expect(
      usableKeys({
        keys: [
          { ...rsa, use: "sig", alg: "PS256" },
          { ...ed, key_ops: ["verify"] },
          p384,
          { ...p384, crv: "P-521" },
          { kty: "OKP", crv: "Ed448", x: "x" },
          "not-an-object",
        ],
      }),
    ).toHaveLength(3);
    expect(usableKeys(undefined)).toEqual([]);
    expect(usableKeys({ keys: "x" })).toEqual([]);
    expect(usableKeys({ keys: [{ ...rsa, k: "x" }] })).toEqual([]);
  });
});

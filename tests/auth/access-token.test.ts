import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  AuthConfigurationError,
  createAccessTokenValidator,
} from "../../src/auth/access-token.js";
import {
  audience,
  claims,
  clientId,
  issuer,
  now,
  nowSeconds,
  sign,
  signWithCrit,
  signingKey,
  unsigned,
  type SigningKey,
} from "../helpers/oidc.js";

async function setup(alg = "ES256") {
  const key = await signingKey(alg);
  const validate = createAccessTokenValidator({
    issuer,
    audience,
    jwks: { keys: [key.jwk] },
    allowedSubjects: [{ iss: issuer, sub: "user-1" }],
    allowedEmails: [],
  });
  return { key, validate };
}

const rejected = (status: 401 | 403, reason: string) => ({
  ok: false,
  status,
  reason,
});

describe("BR-098 access-token validation", () => {
  it("BR-098 accepts a single aud, an aud array and Ed25519/EdDSA keys", async () => {
    const { key, validate } = await setup();
    const accepted = {
      ok: true,
      identity: { iss: issuer, sub: "user-1" },
    };
    expect(await validate(await sign(key, claims()), now)).toEqual(accepted);
    expect(
      await validate(
        await sign(key, claims({ aud: [clientId, audience] })),
        now,
      ),
    ).toEqual(accepted);
    for (const alg of ["Ed25519", "EdDSA"]) {
      const ed = await signingKey("Ed25519");
      const edValidate = createAccessTokenValidator({
        issuer,
        audience,
        jwks: { keys: [ed.jwk] },
        allowedSubjects: [{ iss: issuer, sub: "user-1" }],
        allowedEmails: [],
      });
      expect(
        await edValidate(await sign({ ...ed, alg }, claims()), now),
      ).toEqual(accepted);
    }
  });

  it("BR-098 accepts RSA and PS keys and the nbf boundary equal to now", async () => {
    for (const alg of ["RS256", "PS384", "ES384"]) {
      const { key, validate } = await setup(alg);
      expect(
        await validate(await sign(key, claims({ nbf: nowSeconds })), now),
      ).toMatchObject({ ok: true });
    }
  });

  it("BR-098 rejects alg none and HS256 with reason algorithm", async () => {
    const { validate } = await setup();
    expect(await validate(unsigned({ alg: "none" }, claims()), now)).toEqual(
      rejected(401, "algorithm"),
    );
    const hs = await new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256" })
      .sign(new Uint8Array(32).fill(7));
    expect(await validate(hs, now)).toEqual(rejected(401, "algorithm"));
  });

  it("BR-098 rejects an unknown crit parameter and broken structure as malformed", async () => {
    const { key, validate } = await setup();
    expect(await validate(await signWithCrit(key, claims()), now)).toEqual(
      rejected(401, "malformed"),
    );
    for (const token of [
      "",
      "a.b",
      "a.b.c.d",
      "opaque-token-value",
      "e30.bm90LWpzb24.sig",
      unsigned({ alg: "ES256" }, claims()).replace(/^[^.]+/u, "%%%"),
    ])
      expect(await validate(token, now)).toEqual(rejected(401, "malformed"));
  });

  it("BR-098 rejects a key absent from the JWKS with reason signature", async () => {
    const { validate } = await setup();
    const other = await signingKey("ES256", "k1");
    expect(await validate(await sign(other, claims()), now)).toEqual(
      rejected(401, "signature"),
    );
    const otherKid = await signingKey("ES256", "unknown");
    expect(await validate(await sign(otherKid, claims()), now)).toEqual(
      rejected(401, "signature"),
    );
  });

  it("BR-098 rejects wrong issuer, client-ID audience, sub, exp and nbf violations", async () => {
    const { key, validate } = await setup();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ iss: `${issuer}/` }, "issuer"],
      [{ aud: clientId }, "audience"],
      [{ aud: [clientId] }, "audience"],
      [{ sub: undefined }, "malformed"],
      [{ sub: "" }, "malformed"],
      [{ sub: 7 }, "malformed"],
      [{ exp: undefined }, "expired"],
      [{ exp: nowSeconds }, "expired"],
      [{ exp: "later" }, "expired"],
      [{ nbf: nowSeconds + 1 }, "not-yet-valid"],
    ];
    for (const [change, reason] of cases) {
      const payload = claims(change);
      for (const name of Object.keys(change))
        if (change[name] === undefined) delete payload[name];
      expect(await validate(await sign(key, payload), now), reason).toEqual(
        rejected(401, reason),
      );
    }
  });

  it("BR-098 applies the documented check order", async () => {
    const { key, validate } = await setup();
    // A wrong issuer with a nonce is an ID-token rejection before the issuer.
    expect(
      await validate(
        await sign(key, claims({ iss: "https://other.test", nonce: "n" })),
        now,
      ),
    ).toEqual(rejected(401, "id-token"));
    // An expired token with a wrong audience reports the audience first.
    expect(
      await validate(
        await sign(key, claims({ aud: clientId, exp: nowSeconds - 5 })),
        now,
      ),
    ).toEqual(rejected(401, "audience"));
  });

  it("BR-098 reasons never echo token content", async () => {
    const { key, validate } = await setup();
    const result = await validate(
      await sign(key, claims({ iss: "https://leak.test/SECRETVALUE" })),
      now,
    );
    expect(JSON.stringify(result)).not.toContain("SECRETVALUE");
  });

  it.each([
    "https://MCP.test/mcp",
    "https://mcp.test:443/mcp",
    "https://mcp.test/mcp/",
    "https://mcp.test/mcp#x",
    "https://mcp.test/mcp?x=1",
    "https://u@mcp.test/mcp",
    "http://mcp.test/mcp",
    "HTTPS://mcp.test/mcp",
    "not a url",
  ])("BR-098 non-canonical audience %s is a configuration error", (value) => {
    expect(() =>
      createAccessTokenValidator({
        issuer,
        audience: value,
        jwks: { keys: [] },
        allowedSubjects: [{ iss: issuer, sub: "user-1" }],
        allowedEmails: [],
      }),
    ).toThrow(AuthConfigurationError);
  });

  it("BR-098 canonical audiences with root path and non-default port are accepted", () => {
    for (const value of ["https://mcp.test/", "https://mcp.test:8443/mcp"])
      expect(() =>
        createAccessTokenValidator({
          issuer,
          audience: value,
          jwks: { keys: [] },
          allowedSubjects: [{ iss: issuer, sub: "user-1" }],
          allowedEmails: [],
        }),
      ).not.toThrow();
  });
});

describe("BR-099 ID-token rejection", () => {
  it("BR-099 rejects a nonce claim and typ id_token, accepts typ application/at+jwt", async () => {
    const { key, validate } = await setup();
    expect(
      await validate(await sign(key, claims({ nonce: "n" })), now),
    ).toEqual(rejected(401, "id-token"));
    expect(
      await validate(await sign(key, claims(), { typ: "id_token" }), now),
    ).toEqual(rejected(401, "id-token"));
    for (const typ of [
      "application/at+jwt",
      "AT+JWT",
      "jwt",
      "application/jwt",
    ])
      expect(
        await validate(await sign(key, claims(), { typ }), now),
      ).toMatchObject({ ok: true });
  });

  it("BR-099 an ID-token-shaped JWT without nonce is rejected by audience", async () => {
    const { key, validate } = await setup();
    expect(
      await validate(
        await sign(key, claims({ aud: clientId }), { typ: "JWT" }),
        now,
      ),
    ).toEqual(rejected(401, "audience"));
  });
});

describe("BR-100 identity authorization", () => {
  async function emailSetup(): Promise<{
    key: SigningKey;
    validate: ReturnType<typeof createAccessTokenValidator>;
  }> {
    const key = await signingKey();
    return {
      key,
      validate: createAccessTokenValidator({
        issuer,
        audience,
        jwks: { keys: [key.jwk] },
        allowedSubjects: [{ iss: issuer, sub: "someone-else" }],
        allowedEmails: ["owner@example.test"],
      }),
    };
  }

  it("BR-100 email matches only with boolean email_verified true", async () => {
    const { key, validate } = await emailSetup();
    const email = { email: "owner@example.test" };
    expect(
      await validate(
        await sign(key, claims({ ...email, email_verified: "true" })),
        now,
      ),
    ).toEqual(rejected(403, "identity"));
    expect(await validate(await sign(key, claims(email)), now)).toEqual(
      rejected(403, "identity"),
    );
    expect(
      await validate(
        await sign(key, claims({ ...email, email_verified: true })),
        now,
      ),
    ).toEqual({ ok: true, identity: { iss: issuer, sub: "user-1" } });
    expect(
      await validate(
        await sign(
          key,
          claims({ email: "OWNER@example.test", email_verified: true }),
        ),
        now,
      ),
    ).toEqual(rejected(403, "identity"));
  });

  it("BR-100 the subject allowlist binds the issuer", async () => {
    const key = await signingKey();
    const validate = createAccessTokenValidator({
      issuer,
      audience,
      jwks: { keys: [key.jwk] },
      allowedSubjects: [{ iss: "https://other.test", sub: "user-1" }],
      allowedEmails: [],
    });
    expect(await validate(await sign(key, claims()), now)).toEqual(
      rejected(403, "identity"),
    );
  });

  it("BR-100 both allowlists empty is a configuration error", () => {
    expect(() =>
      createAccessTokenValidator({
        issuer,
        audience,
        jwks: { keys: [] },
        allowedSubjects: [],
        allowedEmails: [],
      }),
    ).toThrow(AuthConfigurationError);
  });
});

describe("BR-100 v2 upstream issuer for proxy-issued tokens", () => {
  const upstream = "https://upstream.test";
  async function proxySetup() {
    const key = await signingKey();
    return {
      key,
      validate: createAccessTokenValidator({
        issuer,
        audience,
        jwks: { keys: [key.jwk] },
        allowedSubjects: [{ iss: upstream, sub: "user-1" }],
        allowedEmails: [],
        upstreamIssuer: upstream,
      }),
    };
  }

  it("BR-100 v2 matches the subject allowlist against the upstream issuer and returns that identity", async () => {
    const { key, validate } = await proxySetup();
    expect(
      await validate(await sign(key, claims({ upstream_iss: upstream })), now),
    ).toEqual({ ok: true, identity: { iss: upstream, sub: "user-1" } });
    expect(
      await validate(
        await sign(key, claims({ upstream_iss: upstream, sub: "user-2" })),
        now,
      ),
    ).toEqual(rejected(403, "identity"));
  });

  it("BR-100 v2 rejects an absent or different upstream_iss with reason issuer after the iss check", async () => {
    const { key, validate } = await proxySetup();
    expect(await validate(await sign(key, claims()), now)).toEqual(
      rejected(401, "issuer"),
    );
    expect(
      await validate(
        await sign(key, claims({ upstream_iss: "https://evil.test" })),
        now,
      ),
    ).toEqual(rejected(401, "issuer"));
    expect(
      await validate(
        await sign(
          key,
          claims({ upstream_iss: upstream, aud: "https://other.test" }),
        ),
        now,
      ),
    ).toEqual(rejected(401, "audience"));
    // The upstream_iss check runs right after iss, before aud.
    expect(
      await validate(
        await sign(
          key,
          claims({
            upstream_iss: "https://evil.test",
            aud: "https://other.test",
          }),
        ),
        now,
      ),
    ).toEqual(rejected(401, "issuer"));
  });

  it("BR-100 v2 without upstreamIssuer an upstream_iss claim changes nothing", async () => {
    const { key, validate } = await setup();
    expect(
      await validate(
        await sign(key, claims({ upstream_iss: "https://anything.test" })),
        now,
      ),
    ).toEqual({ ok: true, identity: { iss: issuer, sub: "user-1" } });
  });
});

import { SignJWT, decodeJwt, decodeProtectedHeader, importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_URL,
  SECOND,
  UPSTREAM,
  harness,
  header,
  json,
  type Harness,
  type Registered,
} from "../helpers/proxy.js";

function basic(id: string, secret: string): string {
  // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function clients(h: Harness) {
  return {
    none: await h.register({ token_endpoint_auth_method: "none" }),
    basic: await h.register({
      token_endpoint_auth_method: "client_secret_basic",
    }),
    post: await h.register({
      token_endpoint_auth_method: "client_secret_post",
    }),
    codeOnly: await h.register({
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
    }),
  };
}

function expectError(
  response: Awaited<ReturnType<Harness["redeem"]>>,
  status: number,
  error: string,
): void {
  expect(response.status).toBe(status);
  expect(response.body).toBe(JSON.stringify({ error }));
  expect(header(response, "cache-control")).toBe("no-store");
  expect(header(response, "pragma")).toBe("no-cache");
}

describe("BR-135 authorization code lifetime", () => {
  it("BR-135 a code is redeemable before 60 seconds and not at 60 seconds", async () => {
    const h = await harness();
    const early = await h.login();
    h.clock.advance(59_999);
    expect((await h.redeem(early)).status).toBe(200);
    const late = await h.login();
    h.clock.advance(60 * SECOND);
    expectError(await h.redeem(late), 400, "invalid_grant");
  });
});

describe("BR-136 token endpoint client authentication", () => {
  it("BR-136 authenticates each registered method", async () => {
    const h = await harness();
    const c = await clients(h);
    for (const client of [c.none, c.basic, c.post]) {
      const response = await h.redeem(await h.login(client));
      expect(response.status).toBe(200);
      expect(header(response, "cache-control")).toBe("no-store");
      expect(header(response, "pragma")).toBe("no-cache");
    }
  });

  it("BR-136 refuses client authentication failures without touching the code", async () => {
    const h = await harness();
    const c = await clients(h);
    const done = await h.login(c.basic);
    const form = (extra: Record<string, string>) =>
      new URLSearchParams({
        grant_type: "authorization_code",
        code: done.code,
        redirect_uri: done.redirect,
        code_verifier: done.verifier,
        ...extra,
      });
    const secret = c.basic.clientSecret ?? "";
    const cases: [
      Parameters<Harness["proxy"]["token"]>[0],
      number,
      string,
      boolean,
    ][] = [
      [{ form: form({ client_id: "unknown" }) }, 401, "invalid_client", false],
      [
        { form: form({}), authorization: basic("unknown", "x") },
        401,
        "invalid_client",
        true,
      ],
      [
        { form: form({}), authorization: basic(c.basic.clientId, "wrong") },
        401,
        "invalid_client",
        true,
      ],
      [
        { form: form({ client_id: c.basic.clientId, client_secret: secret }) },
        401,
        "invalid_client",
        false,
      ],
      [
        {
          form: form({ client_id: c.post.clientId }),
          authorization: basic(c.post.clientId, c.post.clientSecret ?? ""),
        },
        401,
        "invalid_client",
        true,
      ],
      [
        { form: form({ client_id: c.none.clientId, client_secret: "x" }) },
        401,
        "invalid_client",
        false,
      ],
      [
        {
          form: form({ client_secret: secret }),
          authorization: basic(c.basic.clientId, secret),
        },
        400,
        "invalid_request",
        false,
      ],
      [
        {
          form: form({ client_id: "different" }),
          authorization: basic(c.basic.clientId, secret),
        },
        400,
        "invalid_request",
        false,
      ],
      [
        { form: form({}), authorization: "Basic !!!" },
        400,
        "invalid_request",
        false,
      ],
      [
        {
          form: form({}),
          authorization: `Basic ${Buffer.from("no-colon").toString("base64")}`,
        },
        400,
        "invalid_request",
        false,
      ],
      [
        { form: form({}), authorization: "Bearer abc" },
        400,
        "invalid_request",
        false,
      ],
      [{ form: form({}) }, 400, "invalid_request", false],
      [
        {
          form: (() => {
            const f = form({});
            f.append("code", done.code);
            return f;
          })(),
          authorization: basic(c.basic.clientId, secret),
        },
        400,
        "invalid_request",
        false,
      ],
      [
        {
          form: (() => {
            const f = form({});
            f.delete("grant_type");
            return f;
          })(),
          authorization: basic(c.basic.clientId, secret),
        },
        400,
        "invalid_request",
        false,
      ],
      [
        {
          form: form({ grant_type: "password" }),
          authorization: basic(c.basic.clientId, secret),
        },
        400,
        "unsupported_grant_type",
        false,
      ],
    ];
    for (const [input, status, error, challenge] of cases) {
      const response = await h.proxy.token(input);
      expectError(response, status, error);
      expect(header(response, "www-authenticate")).toBe(
        challenge ? 'Basic realm="oauth-token"' : undefined,
      );
    }
    const refreshForm = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "x",
      client_id: c.codeOnly.clientId,
    });
    expectError(
      await h.proxy.token({ form: refreshForm }),
      400,
      "unauthorized_client",
    );
    expect((await h.redeem(done)).status).toBe(200);
  });

  it("BR-136 percent-decodes Basic credentials after Base64", async () => {
    const h = await harness();
    const client = await h.register({
      token_endpoint_auth_method: "client_secret_basic",
    });
    const done = await h.login(client);
    const response = await h.proxy.token({
      form: new URLSearchParams({
        grant_type: "authorization_code",
        code: done.code,
        redirect_uri: done.redirect,
        code_verifier: done.verifier,
      }),
      authorization: basic(
        encodeURIComponent(client.clientId).replace(/-/gu, "%2D"),
        (client.clientSecret ?? "").replace(/_/gu, "%5F"),
      ),
    });
    expect(response.status).toBe(200);
    // %3A and + decode to ':' and ' ' inside the parts.
    const odd = await h.proxy.token({
      form: new URLSearchParams({
        grant_type: "authorization_code",
        code: "c",
      }),
      authorization: basic("a%3Ab+c", "d"),
    });
    expectError(odd, 401, "invalid_client");
  });
});

describe("BR-137 authorization-code grant", () => {
  it.each([
    ["another client's credentials", "other"],
    ["an absent redirect_uri", { redirect_uri: undefined }],
    [
      "an altered loopback port",
      { redirect_uri: "http://127.0.0.1:9999/callback" },
    ],
    ["a wrong verifier", { code_verifier: "w".repeat(43) }],
    ["a 42-character verifier", { code_verifier: "v".repeat(42) }],
    [
      "a verifier with a forbidden character",
      { code_verifier: `${"v".repeat(42)}+` },
    ],
    ["another resource", { resource: "https://other.test" }],
  ])("BR-137 refuses %s and consumes the code", async (_l, variant) => {
    const h = await harness();
    const client = await h.register({
      redirect_uris: ["http://127.0.0.1/callback"],
    });
    const loopback: Registered = {
      ...client,
      redirect: "http://127.0.0.1:5000/callback",
    };
    const done = await h.login(loopback);
    const other = await h.register();
    const response =
      variant === "other"
        ? await h.redeem(done, {}, other)
        : await h.redeem(done, variant as Record<string, string | undefined>);
    const error =
      typeof variant === "object" && "resource" in variant
        ? "invalid_target"
        : "invalid_grant";
    expectError(response, 400, error);
    expectError(await h.redeem(done), 400, "invalid_grant");
  });

  it("BR-137 an absent or unknown code is invalid_grant", async () => {
    const h = await harness();
    const done = await h.login();
    expectError(
      await h.redeem(done, { code: undefined }),
      400,
      "invalid_grant",
    );
    expectError(
      await h.redeem(done, { code: "unknown" }),
      400,
      "invalid_grant",
    );
  });

  it("BR-137 a matching resource is accepted and the success body has the stated members", async () => {
    const h = await harness();
    const done = await h.login();
    const response = await h.redeem(done, { resource: PUBLIC_URL });
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual([
      "access_token",
      "expires_in",
      "refresh_token",
      "token_type",
    ]);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
    // BR-139 v2: `<family id>.<secret>`.
    expect(body.refresh_token).toMatch(
      /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u,
    );
  });

  it("BR-137 a client without the refresh grant receives no refresh token", async () => {
    const h = await harness();
    const client = await h.register({ grant_types: ["authorization_code"] });
    const body = json(await h.redeem(await h.login(client)));
    expect("refresh_token" in body).toBe(false);
  });

  it("BR-137 a second redemption is refused and revokes the family of the first", async () => {
    const h = await harness();
    const done = await h.login();
    const first = json(await h.redeem(done));
    expectError(await h.redeem(done), 400, "invalid_grant");
    expectError(
      await h.refresh(done.client, first.refresh_token as string),
      400,
      "invalid_grant",
    );
    expect(
      h.logs.some((entry) => entry.name === "refresh_family_revoked"),
    ).toBe(true);
  });

  it("BR-137 two concurrent redemptions yield exactly one success", async () => {
    const h = await harness();
    const done = await h.login();
    const results = await Promise.all([h.redeem(done), h.redeem(done)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
});

describe("BR-138 access token and BR-141 proxy verifier", () => {
  it("BR-138 issues an ES256 at+jwt with exactly the stated members", async () => {
    const h = await harness();
    const done = await h.login();
    const token = json(await h.redeem(done)).access_token as string;
    expect(decodeProtectedHeader(token)).toEqual({
      alg: "ES256",
      typ: "at+jwt",
      kid: h.proxy.kid,
    });
    const payload = decodeJwt(token);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "aud",
        "client_id",
        "exp",
        "iat",
        "iss",
        "jti",
        "sub",
        "upstream_iss",
      ].sort(),
    );
    expect(payload.iss).toBe(PUBLIC_URL);
    expect(payload.sub).toBe("user-1");
    expect(payload.upstream_iss).toBe(UPSTREAM);
    expect(payload.aud).toBe(PUBLIC_URL);
    expect(payload.client_id).toBe(done.client.clientId);
    expect(payload.iat).toBe(Math.floor(h.clock.ms / 1000));
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
    expect(payload.jti).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  });

  it("BR-138 copies email claims only when the email allowlist is nonempty", async () => {
    const withEmail = await harness({ emails: ["owner@example.test"] });
    const claims = { email: "owner@example.test", email_verified: true };
    const token = json(
      await withEmail.redeem(await withEmail.login(undefined, claims)),
    ).access_token as string;
    expect(decodeJwt(token).email).toBe("owner@example.test");
    expect(decodeJwt(token).email_verified).toBe(true);
    const without = await harness();
    const plain = json(
      await without.redeem(await without.login(undefined, claims)),
    ).access_token as string;
    expect("email" in decodeJwt(plain)).toBe(false);
    expect("email_verified" in decodeJwt(plain)).toBe(false);
  });

  it("BR-141 the proxy verifier accepts the token until exp and checks audience and upstream_iss", async () => {
    const h = await harness();
    const token = json(await h.redeem(await h.login())).access_token as string;
    const exp = decodeJwt(token).exp ?? 0;
    expect(await h.proxy.verifier(token, new Date((exp - 1) * 1000))).toEqual({
      ok: true,
      identity: { iss: UPSTREAM, sub: "user-1" },
    });
    expect(await h.proxy.verifier(token, new Date(exp * 1000))).toEqual({
      ok: false,
      status: 401,
      reason: "expired",
    });
    const key = await importPKCS8(h.pem, "ES256");
    const resign = (changes: Record<string, unknown>, drop?: string) => {
      const payload: Record<string, unknown> = {
        ...decodeJwt(token),
        ...changes,
      };
      if (drop) delete payload[drop];
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: h.proxy.kid })
        .sign(key);
    };
    const at = new Date((exp - 10) * 1000);
    expect(
      await h.proxy.verifier(await resign({ aud: "https://other.test" }), at),
    ).toMatchObject({ status: 401, reason: "audience" });
    expect(
      await h.proxy.verifier(
        await resign({ upstream_iss: "https://evil.test" }),
        at,
      ),
    ).toMatchObject({ status: 401, reason: "issuer" });
    expect(
      await h.proxy.verifier(await resign({}, "upstream_iss"), at),
    ).toMatchObject({ status: 401, reason: "issuer" });
  });
});

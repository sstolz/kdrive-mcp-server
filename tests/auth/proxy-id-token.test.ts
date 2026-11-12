import { CompactSign, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  SECOND,
  UPSTREAM,
  UPSTREAM_CLIENT,
  harness,
  location,
  upstreamKey,
  type Harness,
} from "../helpers/proxy.js";

const verifier = "v".repeat(43);

async function attempt(
  h: Harness,
  token: (nonce: string) => Promise<string>,
): Promise<URL> {
  const flow = await h.approve(await h.register(), verifier);
  const up = location(flow.upstreamRedirect);
  h.upstream.tokenReply = {
    status: 200,
    json: {
      token_type: "bearer",
      id_token: await token(up.searchParams.get("nonce") ?? ""),
    },
  };
  return location(
    await h.proxy.callback({
      query: new URLSearchParams({
        code: "c",
        state: up.searchParams.get("state") ?? "",
      }),
      cookie: flow.cookie,
    }),
  );
}

function rejected(target: URL): void {
  expect(target.searchParams.get("error")).toBe("server_error");
  expect(target.searchParams.has("code")).toBe(false);
}

describe("BR-133 strict upstream ID-token verification", () => {
  it("BR-133 accepts a valid token, a bearer token type in any case and a matching azp", async () => {
    const h = await harness();
    expect(
      (await attempt(h, (n) => h.idToken(n))).searchParams.get("code"),
    ).not.toBeNull();
    expect(
      (
        await attempt(h, (n) =>
          h.idToken(n, {
            aud: [UPSTREAM_CLIENT, "other"],
            azp: UPSTREAM_CLIENT,
          }),
        )
      ).searchParams.get("code"),
    ).not.toBeNull();
    expect(
      (
        await attempt(h, (n) =>
          h.idToken(n, { nbf: Math.floor(h.clock.ms / 1000) }),
        )
      ).searchParams.get("code"),
    ).not.toBeNull();
    expect(
      (
        await attempt(h, (n) => h.idToken(n, { sub: "s".repeat(255) }))
      ).searchParams.get("error"),
    ).toBe("access_denied");
  });

  it.each([
    [
      "a wrong signature",
      async (h: Harness, n: string) =>
        h.idToken(n, {}, {}, await upstreamKey("u1")),
    ],
    [
      "alg HS256",
      async (_h: Harness, n: string) =>
        new SignJWT({
          iss: UPSTREAM,
          aud: UPSTREAM_CLIENT,
          sub: "user-1",
          nonce: n,
          iat: 1,
          exp: 9e9,
        })
          .setProtectedHeader({ alg: "HS256" })
          .sign(new Uint8Array(32)),
    ],
    [
      "a crit header",
      async (h: Harness, n: string) => {
        const iat = Math.floor(h.clock.ms / 1000);
        return new CompactSign(
          new TextEncoder().encode(
            JSON.stringify({
              iss: UPSTREAM,
              aud: UPSTREAM_CLIENT,
              sub: "user-1",
              nonce: n,
              iat,
              exp: iat + 60,
            }),
          ),
        )
          .setProtectedHeader({
            alg: "ES256",
            kid: "u1",
            crit: ["urn:x"],
            "urn:x": 1,
          })
          .sign(h.idKey.privateKey, { crit: { "urn:x": true } });
      },
    ],
    [
      "an issuer with a trailing slash",
      (h: Harness, n: string) => h.idToken(n, { iss: `${UPSTREAM}/` }),
    ],
    [
      "another audience",
      (h: Harness, n: string) => h.idToken(n, { aud: "other-client" }),
    ],
    [
      "an aud array without azp",
      (h: Harness, n: string) =>
        h.idToken(n, { aud: [UPSTREAM_CLIENT, "other"] }),
    ],
    [
      "a single aud with another azp",
      (h: Harness, n: string) => h.idToken(n, { azp: "other" }),
    ],
    ["a wrong nonce", (h: Harness, n: string) => h.idToken(`${n}x`)],
    [
      "exp equal to now",
      (h: Harness, n: string) =>
        h.idToken(n, { exp: Math.floor(h.clock.ms / 1000) }),
    ],
    ["no iat", (h: Harness, n: string) => h.idToken(n, { iat: undefined })],
    [
      "nbf in the future",
      (h: Harness, n: string) =>
        h.idToken(n, { nbf: Math.floor(h.clock.ms / 1000) + 1 }),
    ],
    ["an empty sub", (h: Harness, n: string) => h.idToken(n, { sub: "" })],
    [
      "a 256-byte sub",
      (h: Harness, n: string) => h.idToken(n, { sub: "s".repeat(256) }),
    ],
    ["a non-JWS value", () => Promise.resolve("not-a-token")],
  ])("BR-133 refuses %s", async (_l, token) => {
    const h = await harness();
    rejected(await attempt(h, (n) => token(h, n)));
    expect(h.logs.some((entry) => entry.name === "id_token_refused")).toBe(
      true,
    );
  });

  it("BR-133 refetches the JWKS once per 60 seconds for an unknown kid and never without kid", async () => {
    const h = await harness();
    await attempt(h, (n) => h.idToken(n));
    expect(h.upstream.count("get", "/jwks")).toBe(1);
    const rotated = await upstreamKey("u2");
    h.clock.advance(61 * SECOND);
    rejected(await attempt(h, (n) => h.idToken(n, {}, {}, rotated)));
    expect(h.upstream.count("get", "/jwks")).toBe(2);
    h.clock.advance(SECOND);
    rejected(await attempt(h, (n) => h.idToken(n, {}, {}, rotated)));
    expect(h.upstream.count("get", "/jwks")).toBe(2);
    h.clock.advance(100 * SECOND);
    rejected(
      await attempt(h, (n) => h.idToken(n, {}, { kid: undefined }, rotated)),
    );
    expect(h.upstream.count("get", "/jwks")).toBe(2);
    h.upstream.jwks = { keys: [h.idKey.jwk, rotated.jwk] };
    h.clock.advance(SECOND);
    expect(
      (await attempt(h, (n) => h.idToken(n, {}, {}, rotated))).searchParams.get(
        "code",
      ),
    ).not.toBeNull();
    expect(h.upstream.count("get", "/jwks")).toBe(3);
  });

  it("BR-133 never trusts a JWKS cache older than 3,600 seconds when the refetch fails", async () => {
    const h = await harness();
    expect(
      (await attempt(h, (n) => h.idToken(n))).searchParams.get("code"),
    ).not.toBeNull();
    h.clock.advance(3_600 * SECOND);
    h.upstream.jwksFail = true;
    rejected(await attempt(h, (n) => h.idToken(n)));
    expect(h.upstream.count("get", "/jwks")).toBe(2);
  });

  it("BR-133 throttles JWKS fetches with an empty cache to one per 60 seconds", async () => {
    const h = await harness();
    h.upstream.jwksFail = true;
    rejected(await attempt(h, (n) => h.idToken(n)));
    expect(h.upstream.count("get", "/jwks")).toBe(1);
    h.clock.advance(59 * SECOND);
    rejected(await attempt(h, (n) => h.idToken(n)));
    expect(h.upstream.count("get", "/jwks")).toBe(1);
    h.upstream.jwksFail = false;
    h.clock.advance(SECOND);
    expect(
      (await attempt(h, (n) => h.idToken(n))).searchParams.get("code"),
    ).not.toBeNull();
    expect(h.upstream.count("get", "/jwks")).toBe(2);
  });

  it("BR-133 refuses a token whose kid is present but not a string", async () => {
    const h = await harness();
    rejected(await attempt(h, (n) => h.idToken(n, {}, { kid: 7 })));
  });

  it("BR-133 refetches the JWKS after 3,600 seconds", async () => {
    const h = await harness();
    await attempt(h, (n) => h.idToken(n));
    h.clock.advance(3_600 * SECOND);
    await attempt(h, (n) => h.idToken(n));
    expect(h.upstream.count("get", "/jwks")).toBe(2);
  });
});

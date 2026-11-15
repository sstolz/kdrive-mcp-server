import { CompactSign, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SECOND,
  UPSTREAM,
  UPSTREAM_CLIENT,
  harness,
  location,
  upstreamKey,
  type Harness,
} from "../helpers/proxy.js";

import { verifiesWithKeys } from "../../src/auth/access-token.js";
import { gate } from "../helpers/http.js";

vi.mock("../../src/auth/access-token.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/access-token.js")>();
  return { ...actual, verifiesWithKeys: vi.fn(actual.verifiesWithKeys) };
});
afterEach(() => vi.mocked(verifiesWithKeys).mockClear());

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

function holdJwks(h: Harness, outcome: "ok" | "reject" | "status" = "ok") {
  const held = gate();
  const original = h.upstream.fetchJson.bind(h.upstream);
  h.upstream.fetchJson = async (url) => {
    if (!url.endsWith("/jwks")) return await original(url);
    h.upstream.calls.push({ kind: "get", url });
    await held.enter();
    if (outcome === "reject") throw new Error("synthetic JWKS failure");
    return { status: outcome === "status" ? 503 : 200, json: h.upstream.jwks };
  };
  return {
    ...held,
    restore: () => {
      h.upstream.fetchJson = original;
    },
  };
}

// Prepare every signed reply before starting concurrent callbacks. The token
// exchange captures its reply synchronously, avoiding a shared-fixture race.
async function preparedCallback(
  h: Harness,
  claims: Record<string, unknown> = {},
  key = h.idKey,
) {
  const flow = await h.approve(await h.register(), verifier);
  const up = location(flow.upstreamRedirect);
  const token = await h.idToken(
    up.searchParams.get("nonce") ?? "",
    claims,
    {},
    key,
  );
  return () => {
    h.upstream.tokenReply = {
      status: 200,
      json: { token_type: "Bearer", id_token: token },
    };
    return h.proxy
      .callback({
        query: new URLSearchParams({
          code: "c",
          state: up.searchParams.get("state") ?? "",
        }),
        cookie: flow.cookie,
      })
      .then(location);
  };
}

async function verificationStarted() {
  // postForm and keysFor each cross a microtask boundary; no timer or I/O.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

it("BR-133 v2 AC-05 concurrent callbacks on a cold cache share one JWKS fetch", async () => {
  for (const count of [2, 3]) {
    const h = await harness();
    const callbacks = [];
    for (let i = 0; i < count; i++) callbacks.push(await preparedCallback(h));
    const held = holdJwks(h);
    const pending = callbacks.map((start) => start());
    await verificationStarted();
    expect(held.entered()).toBe(1);
    held.release();
    for (const target of await Promise.all(pending))
      expect(target.searchParams.has("code")).toBe(true);
    expect(h.upstream.count("get", "/jwks")).toBe(1);
  }
});

it("BR-133 v2 AC-05 shared fetch checks expiry at completion", async () => {
  for (const elapsed of [999, 1000, 5000]) {
    const h = await harness();
    const exp = h.clock.ms / 1000 + 1;
    const a = await preparedCallback(h, { exp });
    const b = await preparedCallback(h, { exp });
    const held = holdJwks(h);
    const pending = [a(), b()];
    await verificationStarted();
    h.clock.advance(elapsed);
    held.release();
    for (const target of await Promise.all(pending)) {
      if (elapsed < 1000) expect(target.searchParams.has("code")).toBe(true);
      else rejected(target);
    }
    expect(h.upstream.count("get", "/jwks")).toBe(1);
  }
});

it("BR-133 v2 AC-05 signature verification checks expiry at completion", async () => {
  const h = await harness();
  await attempt(h, (nonce) => h.idToken(nonce));
  const start = await preparedCallback(h, { exp: h.clock.ms / 1000 + 1 });
  const held = gate();
  const actual = await vi.importActual<
    typeof import("../../src/auth/access-token.js")
  >("../../src/auth/access-token.js");
  vi.mocked(verifiesWithKeys).mockImplementationOnce(async (...args) => {
    const verified = await actual.verifiesWithKeys(...args);
    await held.enter();
    return verified;
  });
  const pending = start();
  await vi.waitFor(() => {
    expect(held.entered()).toBe(1);
  });
  h.clock.advance(1000);
  held.release();
  rejected(await pending);
  expect(h.upstream.count("get", "/jwks")).toBe(1);
});

it("BR-133 v2 AC-06 concurrent callbacks with a rotated kid share one refetch", async () => {
  const h = await harness();
  await attempt(h, (nonce) => h.idToken(nonce));
  const rotated = await upstreamKey("u2");
  h.upstream.jwks = { keys: [h.idKey.jwk, rotated.jwk] };
  h.clock.advance(61_000);
  const a = await preparedCallback(h, {}, rotated);
  const b = await preparedCallback(h, {}, rotated);
  const old = await preparedCallback(h);
  const held = holdJwks(h);
  const pending = [a(), b()];
  expect((await old()).searchParams.has("code")).toBe(true);
  expect(held.entered()).toBe(1);
  held.release();
  for (const target of await Promise.all(pending))
    expect(target.searchParams.has("code")).toBe(true);
  expect(
    (
      await attempt(h, (nonce) => h.idToken(nonce, {}, {}, rotated))
    ).searchParams.has("code"),
  ).toBe(true);
  expect(h.upstream.count("get", "/jwks")).toBe(2);
});

it("BR-133 v2 AC-07 a shared fetch fails for every waiter and both bounds count from its start", async () => {
  for (const outcome of ["reject", "status"] as const) {
    const h = await harness();
    const a = await preparedCallback(h);
    const b = await preparedCallback(h);
    const held = holdJwks(h, outcome);
    const pending = [a(), b()];
    await verificationStarted();
    h.clock.advance(5000);
    held.release();
    for (const target of await Promise.all(pending)) rejected(target);
    held.restore();
    expect(h.upstream.count("get", "/jwks")).toBe(1);
    h.clock.advance(54_999);
    rejected(await attempt(h, (nonce) => h.idToken(nonce)));
    expect(h.upstream.count("get", "/jwks")).toBe(1);
    h.clock.advance(1);
    expect(
      (await attempt(h, (nonce) => h.idToken(nonce))).searchParams.has("code"),
    ).toBe(true);
    expect(h.upstream.count("get", "/jwks")).toBe(2);
  }
  const h = await harness();
  const start = await preparedCallback(h);
  const held = holdJwks(h);
  const pending = start();
  await verificationStarted();
  h.clock.advance(5000);
  held.release();
  await pending;
  held.restore();
  h.clock.advance(3_594_999);
  expect(
    (await attempt(h, (nonce) => h.idToken(nonce))).searchParams.has("code"),
  ).toBe(true);
  expect(h.upstream.count("get", "/jwks")).toBe(1);
  h.clock.advance(1);
  expect(
    (await attempt(h, (nonce) => h.idToken(nonce))).searchParams.has("code"),
  ).toBe(true);
  expect(h.upstream.count("get", "/jwks")).toBe(2);
});

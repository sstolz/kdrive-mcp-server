import { describe, expect, it } from "vitest";
import { UPSTREAM, harness, json, signIdToken } from "../helpers/proxy.js";

describe("BR-141 proxy verifier refuses upstream tokens", () => {
  it("BR-141 refuses an upstream-style token, an upstream ID token and an unlisted subject", async () => {
    const h = await harness();
    const now = h.clock.now();
    const iat = Math.floor(h.clock.ms / 1000);
    const upstreamStyle = await signIdToken(h.idKey, {
      iss: UPSTREAM,
      aud: "https://mcp.test/mcp",
      sub: "user-1",
      upstream_iss: UPSTREAM,
      iat,
      exp: iat + 60,
    });
    expect(await h.proxy.verifier(upstreamStyle, now)).toEqual({
      ok: false,
      status: 401,
      reason: "signature",
    });
    const idToken = await h.idToken("nonce-1");
    expect(await h.proxy.verifier(idToken, now)).toEqual({
      ok: false,
      status: 401,
      reason: "id-token",
    });
    // A proxy-issued token whose subject is not on the allowlist: the proxy
    // never issues one, so the allowlist differs between issuer and verifier.
    const issuing = await harness({
      subjects: ["user-1", "intruder"],
      pem: h.pem,
    });
    const token = json(
      await issuing.redeem(await issuing.login(undefined, { sub: "intruder" })),
    ).access_token as string;
    expect(await h.proxy.verifier(token, issuing.clock.now())).toEqual({
      ok: false,
      status: 403,
      reason: "identity",
    });
  });
});

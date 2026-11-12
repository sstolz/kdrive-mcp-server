import { describe, expect, it } from "vitest";
import { loadSigningKey } from "../../src/auth/proxy/keys.js";
import {
  UPSTREAM,
  UPSTREAM_CLIENT,
  b64url,
  signIdToken,
  syntheticPem,
} from "../helpers/proxy.js";
import {
  INITIALIZE,
  PRM,
  expectError,
  httpFixture,
  jsonRpc,
} from "../helpers/http.js";

const invalid = `Bearer error="invalid_token", resource_metadata="${PRM}"`;

describe("BR-159 verification of every MCP request", () => {
  it("BR-159 AC-07 answers one identical 401 for every rejected token", async () => {
    const f = await httpFixture();
    const iat = Math.floor(f.clock.ms / 1000);
    const upstreamKey = f.idKey;
    const tokens: Record<string, string> = {
      expired: await f.mint({ exp: iat - 10 }),
      notYetValid: await f.mint({ nbf: iat + 1000 }),
      audience: await f.mint({ aud: "https://other.test" }),
      issuer: await f.mint({ iss: "https://other.test" }),
      noUpstreamIssuer: await f.mint({ upstream_iss: undefined }),
      otherKey: await f.mint(
        {},
        loadSigningKey(new TextEncoder().encode(syntheticPem())),
      ),
      algNone: `${b64url(JSON.stringify({ alg: "none", typ: "at+jwt" }))}.${b64url(JSON.stringify({ iss: "https://mcp.test/mcp", sub: "user-1", aud: "https://mcp.test/mcp", exp: iat + 60 }))}.`,
      idToken: await signIdToken(upstreamKey, {
        iss: UPSTREAM,
        aud: UPSTREAM_CLIENT,
        sub: "user-1",
        nonce: "n",
        iat,
        exp: iat + 60,
      }),
      randomBytes: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo",
    };
    const bodies = new Set<string>();
    for (const [name, token] of Object.entries(tokens)) {
      const response = await f.mcp(token, INITIALIZE);
      expect(response.status, name).toBe(401);
      expect(response.headers.get("www-authenticate"), name).toBe(invalid);
      const text = await response.text();
      expect(text).not.toContain("error_description");
      bodies.add(text);
    }
    expect(bodies).toEqual(new Set(['{"error":"invalid_token"}']));
    await f.handler.close();
  });

  it("BR-159 AC-08 answers 403 access_denied without a challenge for an unlisted identity", async () => {
    const f = await httpFixture();
    const response = await f.mcp(await f.mint({ sub: "intruder" }), INITIALIZE);
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expectError(response, 403, "access_denied");
    await f.handler.close();
  });

  it("BR-159 AC-08 lets an allowed token reach the transport", async () => {
    const f = await httpFixture();
    const response = await f.mcp(await f.mint(), INITIALIZE);
    expect(response.status).toBe(200);
    await response.text();
    await f.handler.close();
  });

  it("BR-159 AC-08 verifies requests that carry a session ID", async () => {
    const f = await httpFixture();
    const token = await f.mint({ exp: Math.floor(f.clock.ms / 1000) + 60 });
    const session = await f.open(token);
    f.clock.advance(61_000);
    const response = await f.mcp(token, jsonRpc("tools/list", 5), session);
    expect(response.headers.get("www-authenticate")).toBe(invalid);
    await expectError(response, 401, "invalid_token");
    await f.handler.close();
  });
});

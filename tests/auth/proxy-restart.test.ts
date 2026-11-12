import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import {
  Clock,
  UPSTREAM,
  harness,
  json,
  syntheticPem,
} from "../helpers/proxy.js";

describe("BR-142 v2 BR-292 restart semantics without a state file (AC-02)", () => {
  it("BR-142 v2 BR-292 a new instance forgets clients but verifies tokens signed with the same key", async () => {
    const clock = new Clock();
    const a = await harness({ clock });
    const done = await a.login();
    const second = await a.login(done.client);
    const issued = json(await a.redeem(done));
    const access = issued.access_token as string;
    const b = await harness({ clock, pem: a.pem });
    // Both grants of A's client are answered with invalid_client by B.
    const code = await b.proxy.token({
      form: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: done.client.clientId,
        code: second.code,
        redirect_uri: second.redirect,
        code_verifier: second.verifier,
      }),
    });
    expect(code.status).toBe(401);
    expect(code.body).toBe(JSON.stringify({ error: "invalid_client" }));
    const refresh = await b.refresh(
      done.client,
      issued.refresh_token as string,
    );
    expect(refresh.status).toBe(401);
    expect(refresh.body).toBe(JSON.stringify({ error: "invalid_client" }));
    const exp = decodeJwt(access).exp ?? 0;
    expect(await b.proxy.verifier(access, new Date((exp - 1) * 1000))).toEqual({
      ok: true,
      identity: { iss: UPSTREAM, sub: "user-1" },
    });
    expect(await b.proxy.verifier(access, new Date(exp * 1000))).toMatchObject({
      ok: false,
      reason: "expired",
    });
    const c = await harness({ clock, pem: syntheticPem() });
    expect(await c.proxy.verifier(access, clock.now())).toEqual({
      ok: false,
      status: 401,
      reason: "signature",
    });
  });
});

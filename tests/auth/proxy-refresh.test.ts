import { afterEach, describe, expect, it } from "vitest";
import {
  Clock,
  DAY,
  harness,
  json,
  openState,
  readState,
  removeStateFiles,
  stateFile,
  type Harness,
  type Registered,
} from "../helpers/proxy.js";

afterEach(() => {
  removeStateFiles();
});

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u;

async function family(h: Harness, client?: Registered) {
  const done = await h.login(client);
  const body = json(await h.redeem(done));
  return { client: done.client, token: body.refresh_token as string };
}

async function rotate(h: Harness, client: Registered, token: string) {
  const response = await h.refresh(client, token);
  expect(response.status).toBe(200);
  return json(response).refresh_token as string;
}

function refused(
  response: Awaited<ReturnType<Harness["refresh"]>>,
  error = "invalid_grant",
) {
  expect(response.status).toBe(400);
  expect(response.body).toBe(JSON.stringify({ error }));
}

describe("BR-139 refresh-token lifetime and rotation", () => {
  it("BR-139 the family ends 30 days after creation even with regular use", async () => {
    const h = await harness();
    const { client, token: first } = await family(h);
    let token = first;
    for (let day = 6; day < 30; day += 6) {
      h.clock.advance(6 * DAY);
      token = await rotate(h, client, token);
    }
    h.clock.advance(6 * DAY - 1); // 30 days minus 1 ms
    token = await rotate(h, client, token);
    h.clock.advance(1); // exactly 30 days
    refused(await h.refresh(client, token));
  });

  it("BR-139 an unused token expires 7 days after its issue", async () => {
    const h = await harness();
    const one = await family(h);
    h.clock.advance(7 * DAY - 1);
    expect((await h.refresh(one.client, one.token)).status).toBe(200);
    const h2 = await harness();
    const two = await family(h2);
    h2.clock.advance(7 * DAY);
    refused(await h2.refresh(two.client, two.token));
  });

  it("BR-139 v2 refresh tokens are a family ID and a secret, distinct on rotation", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    expect(token).toMatch(TOKEN_FORMAT);
    expect(token).toHaveLength(66);
    const next = await rotate(h, client, token);
    expect(next).toMatch(TOKEN_FORMAT);
    expect(next).not.toBe(token);
    // The family ID stays; only the secret rotates.
    expect(next.split(".")[0]).toBe(token.split(".")[0]);
  });
});

describe("BR-140 refresh grant", () => {
  it("BR-140 a reused token revokes the whole family", async () => {
    const h = await harness();
    const { client, token: r1 } = await family(h);
    const r2 = await rotate(h, client, r1);
    refused(await h.refresh(client, r1));
    refused(await h.refresh(client, r2));
    expect(
      h.logs.filter((entry) => entry.name === "refresh_family_revoked"),
    ).toHaveLength(1);
  });

  it("BR-140 a reused token is revoking even after its inactivity expiry", async () => {
    const h = await harness();
    const { client, token: r1 } = await family(h);
    const r2 = await rotate(h, client, r1);
    h.clock.advance(7 * DAY);
    refused(await h.refresh(client, r1));
    refused(await h.refresh(client, r2));
    expect(
      h.logs.filter((entry) => entry.name === "refresh_family_revoked"),
    ).toHaveLength(1);
  });

  it("BR-140 an expired token ends its family with at most one revocation event", async () => {
    const h = await harness();
    const { client, token: r1 } = await family(h);
    h.clock.advance(7 * DAY);
    refused(await h.refresh(client, r1));
    refused(await h.refresh(client, r1));
    expect(
      h.logs.filter((entry) => entry.name === "refresh_family_revoked"),
    ).toHaveLength(1);
  });

  it("BR-140 a token presented by another client revokes the family", async () => {
    const h = await harness();
    const { client, token: r1 } = await family(h);
    const r2 = await rotate(h, client, r1);
    const other = await h.register();
    refused(await h.refresh(other, r2));
    refused(await h.refresh(client, r2));
  });

  it("BR-140 an absent or unknown token is invalid_grant", async () => {
    const h = await harness();
    const { client } = await family(h);
    refused(await h.refresh(client, undefined));
    refused(await h.refresh(client, "unknown"));
  });

  it("BR-140 a success body has the BR-137 members", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    const body = json(await h.refresh(client, token));
    expect(Object.keys(body).sort()).toEqual([
      "access_token",
      "expires_in",
      "refresh_token",
      "token_type",
    ]);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
  });

  it("BR-140 two concurrent presentations give one success and revoke the family", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    const results = await Promise.all([
      h.refresh(client, token),
      h.refresh(client, token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = results.find((r) => r.status === 200);
    if (!winner) throw new Error("no winner");
    refused(await h.refresh(client, json(winner).refresh_token as string));
  });

  it("BR-140 another resource is invalid_target without rotation", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    refused(
      await h.refresh(client, token, { resource: "https://other.test" }),
      "invalid_target",
    );
    expect(
      (await h.refresh(client, token, { resource: "https://mcp.test/mcp" }))
        .status,
    ).toBe(200);
  });
});

describe("BR-139 v2 BR-140 v2 BR-301 family ID and secret (AC-10)", () => {
  const revocations = (h: Harness) =>
    h.logs.filter((entry) => entry.name === "refresh_family_revoked").length;

  it("BR-139 v2 BR-140 v2 AC-10 a rotated secret presented again revokes the family", async () => {
    const h = await harness();
    const { client, token: r1 } = await family(h);
    const r2 = await rotate(h, client, r1);
    expect(r2).toMatch(TOKEN_FORMAT);
    refused(await h.refresh(client, r1));
    refused(await h.refresh(client, r2));
    expect(revocations(h)).toBe(1);
  });

  it("BR-140 v2 AC-10 a forged secret with a valid family ID revokes the family", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    const [familyId] = token.split(".");
    refused(await h.refresh(client, `${familyId ?? ""}.${"A".repeat(43)}`));
    expect(revocations(h)).toBe(1);
    refused(await h.refresh(client, token));
  });

  it("BR-140 v2 AC-10 an unknown family ID revokes nothing", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    const [, secret] = token.split(".");
    refused(await h.refresh(client, `${"B".repeat(22)}.${secret ?? ""}`));
    expect(revocations(h)).toBe(0);
    expect((await h.refresh(client, token)).status).toBe(200);
  });

  it("BR-140 v2 AC-10 a token in the former format is invalid_grant and revokes nothing", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    refused(await h.refresh(client, token.split(".")[1]));
    refused(await h.refresh(client, "C".repeat(43)));
    refused(await h.refresh(client, `${token}x`));
    expect(revocations(h)).toBe(0);
    expect((await h.refresh(client, token)).status).toBe(200);
  });

  it("BR-140 v2 AC-10 the current token presented by another client revokes the family", async () => {
    const h = await harness();
    const { client, token } = await family(h);
    const other = await h.register();
    refused(await h.refresh(other, token));
    expect(revocations(h)).toBe(1);
    refused(await h.refresh(client, token));
  });

  it("BR-301 AC-10 a subject removed from the allowlist revokes the family at refresh, before the resource check", async () => {
    const path = stateFile();
    const clock = new Clock();
    const first = openState(path, { clock });
    const a = await harness({ clock, store: first });
    const one = await family(a);
    const two = await family(a, one.client);
    first.close();
    expect(readState(path).families).toHaveLength(2);

    const second = openState(path, { clock });
    const b = await harness({
      clock,
      store: second,
      subjects: ["someone-else"],
      pem: a.pem,
    });
    refused(await b.refresh(one.client, one.token));
    refused(
      await b.refresh(two.client, two.token, {
        resource: "https://other.test",
      }),
    );
    expect(revocations(b)).toBe(2);
    expect(
      b.logs.some(
        (entry) =>
          entry.name === "token_refused" &&
          entry.fields.error === "invalid_target",
      ),
    ).toBe(false);
    second.close();
    expect(readState(path).families).toEqual([]);
  });

  it("BR-301 AC-10 an email identity is kept across a reopen and revoked once its email is removed", async () => {
    const path = stateFile();
    const clock = new Clock();
    const emails = ["owner@example.test"];
    const first = openState(path, { clock });
    const a = await harness({ clock, store: first, subjects: [], emails });
    const done = await a.login(undefined, {
      sub: "user-9",
      email: "owner@example.test",
      email_verified: true,
    });
    const token = json(await a.redeem(done)).refresh_token as string;
    first.close();
    const second = openState(path, { clock });
    const b = await harness({
      clock,
      store: second,
      subjects: [],
      emails,
      pem: a.pem,
    });
    const next = await rotate(b, done.client, token);
    second.close();
    const third = openState(path, { clock });
    const c = await harness({
      clock,
      store: third,
      subjects: [],
      emails: ["other@example.test"],
      pem: a.pem,
    });
    refused(await c.refresh(done.client, next));
    expect(revocations(c)).toBe(1);
    third.close();
    expect(readState(path).families).toEqual([]);
  });
});

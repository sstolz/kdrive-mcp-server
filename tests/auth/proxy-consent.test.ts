import { describe, expect, it } from "vitest";
import {
  COOKIE,
  PUBLIC_URL,
  SECOND,
  harness,
  header,
  headers,
  location,
  s256,
  type Harness,
  type Registered,
} from "../helpers/proxy.js";

const challenge = s256("v".repeat(43));
const ATTRIBUTES = "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600";

async function page(h: Harness, client: Registered, cookie?: string) {
  return h.proxy.authorize({
    query: h.authorizeQuery(client, challenge),
    ...(cookie === undefined ? {} : { cookie }),
  });
}

describe("BR-129 consent page", () => {
  it("BR-129 shows an escaped, unverified client name, the exact redirect and a fresh identifier each time", async () => {
    const h = await harness();
    const client = await h.register({
      client_name: "<script>alert(1)</script>",
    });
    const first = await page(h, client);
    const second = await page(h, client);
    for (const response of [first, second]) {
      expect(response.status).toBe(200);
      expect(response.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(response.body).not.toContain("<script>");
      expect(response.body).toContain("unverified");
      expect(response.body).toContain(client.redirect);
      expect(response.body).toContain(client.clientId);
      expect(response.body).toContain(PUBLIC_URL);
      expect(response.body).toContain(`action="${PUBLIC_URL}/oauth/consent"`);
      expect(header(response, "cache-control")).toBe("no-store");
      expect(header(response, "x-frame-options")).toBe("DENY");
      expect(header(response, "referrer-policy")).toBe("no-referrer");
      expect(header(response, "content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    }
    expect(h.consentId(first)).not.toBe(h.consentId(second));
  });

  it("BR-129 labels a client without a name", async () => {
    const h = await harness();
    const response = await page(h, await h.register());
    expect(response.body).toContain("unnamed client");
  });

  it("BR-129 deny redirects to the client with access_denied, state and iss", async () => {
    const h = await harness();
    const client = await h.register();
    const response = await page(h, client);
    const denied = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(response),
        decision: "deny",
      }),
      cookie: `${COOKIE}=${h.cookieOf(response)}`,
    });
    expect(denied.status).toBe(302);
    const target = location(denied);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
    expect(h.upstream.calls).toEqual([]);
  });
});

describe("BR-130 browser binding of the consent", () => {
  it("BR-130 sets the cookie with exactly the stated attributes and reuses a single well-formed value", async () => {
    const h = await harness();
    const client = await h.register();
    const first = await page(h, client);
    const value = h.cookieOf(first);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(headers(first, "set-cookie")).toEqual([
      `${COOKIE}=${value}${ATTRIBUTES}`,
    ]);
    const reused = await page(h, client, `other=1; ${COOKIE}=${value}`);
    expect(h.cookieOf(reused)).toBe(value);
    const two = await page(h, client, `${COOKIE}=${value}; ${COOKIE}=${value}`);
    expect(h.cookieOf(two)).not.toBe(value);
    const malformed = await page(h, client, `${COOKIE}=short`);
    expect(h.cookieOf(malformed)).not.toBe("short");
  });

  it.each([
    ["without the cookie", () => undefined, {}],
    ["with another cookie value", () => `${COOKIE}=${"A".repeat(43)}`, {}],
    [
      "with two cookies of that name",
      (v: string) => `${COOKIE}=${v}; ${COOKIE}=${v}`,
      {},
    ],
    [
      "with decision maybe",
      (v: string) => `${COOKIE}=${v}`,
      { decision: "maybe" },
    ],
  ])(
    "BR-130 refuses a consent posted %s and consumes it",
    async (_l, cookieFor, extra) => {
      const h = await harness();
      const client = await h.register();
      const response = await page(h, client);
      const value = h.cookieOf(response);
      const id = h.consentId(response);
      const cookie = cookieFor(value);
      const refused = await h.proxy.consent({
        form: new URLSearchParams({
          consent: id,
          decision: "approve",
          ...extra,
        }),
        ...(cookie === undefined ? {} : { cookie }),
      });
      expect(refused.status).toBe(400);
      expect(header(refused, "location")).toBeUndefined();
      const retry = await h.proxy.consent({
        form: new URLSearchParams({ consent: id, decision: "approve" }),
        cookie: `${COOKIE}=${value}`,
      });
      expect(retry.status).toBe(400);
      expect(h.upstream.calls).toEqual([]);
    },
  );

  it("BR-129 refuses an expired or reused consent identifier", async () => {
    const h = await harness();
    const client = await h.register();
    const response = await page(h, client);
    const cookie = `${COOKIE}=${h.cookieOf(response)}`;
    h.clock.advance(600 * SECOND);
    const expired = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(response),
        decision: "approve",
      }),
      cookie,
    });
    expect(expired.status).toBe(400);
    const fresh = await page(h, client);
    const flow = { consent: h.consentId(fresh), decision: "deny" };
    const ok = await h.proxy.consent({
      form: new URLSearchParams(flow),
      cookie: `${COOKIE}=${h.cookieOf(fresh)}`,
    });
    expect(ok.status).toBe(302);
    const again = await h.proxy.consent({
      form: new URLSearchParams(flow),
      cookie: `${COOKIE}=${h.cookieOf(fresh)}`,
    });
    expect(again.status).toBe(400);
  });

  it("BR-130 the approval redirect re-sends the same cookie with Max-Age=600", async () => {
    const h = await harness();
    const client = await h.register();
    const flow = await h.approve(client, "v".repeat(43));
    expect(flow.upstreamRedirect.status).toBe(302);
    expect(headers(flow.upstreamRedirect, "set-cookie")).toEqual([
      `${flow.cookie}${ATTRIBUTES}`,
    ]);
  });
});

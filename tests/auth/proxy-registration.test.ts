import { describe, expect, it } from "vitest";
import {
  CLAUDE,
  LOCALHOST,
  LOOPBACK,
  harness,
  header,
  json,
} from "../helpers/proxy.js";

async function post(body: unknown) {
  const h = await harness();
  const response = await h.proxy.register({
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { h, response };
}

describe("BR-127 dynamic client registration", () => {
  it.each([
    [CLAUDE, undefined, "client_secret_basic"],
    [LOOPBACK, "none", "none"],
    [LOCALHOST, "client_secret_post", "client_secret_post"],
    ["http://localhost:8123/callback", "none", "none"],
  ])(
    "BR-127 registers %s with method %s",
    async (redirect, method, effective) => {
      const { response } = await post({
        redirect_uris: [redirect],
        ...(method === undefined ? {} : { token_endpoint_auth_method: method }),
        client_name: "Claude",
        logo_uri: "https://evil.test/logo.png",
      });
      expect(response.status).toBe(201);
      expect(header(response, "cache-control")).toBe("no-store");
      const data = json(response);
      expect(data.client_id).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(typeof data.client_id_issued_at).toBe("number");
      expect(data.redirect_uris).toEqual([redirect]);
      expect(data.grant_types).toEqual(["authorization_code", "refresh_token"]);
      expect(data.response_types).toEqual(["code"]);
      expect(data.token_endpoint_auth_method).toBe(effective);
      expect(data.client_name).toBe("Claude");
      expect("logo_uri" in data).toBe(false);
      if (effective === "none") {
        expect("client_secret" in data).toBe(false);
      } else {
        expect(data.client_secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(data.client_secret_expires_at).toBe(0);
      }
    },
  );

  it("BR-127 keeps an explicit authorization-code-only grant list", async () => {
    const { response } = await post({
      redirect_uris: [CLAUDE],
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
    expect(response.status).toBe(201);
    expect(json(response).grant_types).toEqual(["authorization_code"]);
  });

  it.each([
    [
      "an unlisted redirect URI",
      { redirect_uris: ["https://evil.test/cb"] },
      "invalid_redirect_uri",
    ],
    ["an empty list", { redirect_uris: [] }, "invalid_redirect_uri"],
    [
      "an 11-item list",
      {
        redirect_uris: Array.from(
          { length: 11 },
          (_, i) => `http://127.0.0.1:${i + 1}/callback`,
        ),
      },
      "invalid_redirect_uri",
    ],
    [
      "duplicate URIs",
      { redirect_uris: [CLAUDE, CLAUDE] },
      "invalid_redirect_uri",
    ],
    ["no redirect_uris", {}, "invalid_redirect_uri"],
    [
      "uppercase LOCALHOST",
      { redirect_uris: ["http://LOCALHOST/callback"] },
      "invalid_redirect_uri",
    ],
    [
      "grant implicit",
      { redirect_uris: [CLAUDE], grant_types: ["implicit"] },
      "invalid_client_metadata",
    ],
    [
      "refresh only",
      { redirect_uris: [CLAUDE], grant_types: ["refresh_token"] },
      "invalid_client_metadata",
    ],
    [
      "response type token",
      { redirect_uris: [CLAUDE], response_types: ["token"] },
      "invalid_client_metadata",
    ],
    [
      "private_key_jwt",
      {
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "private_key_jwt",
      },
      "invalid_client_metadata",
    ],
    [
      "a 201-character name",
      { redirect_uris: [CLAUDE], client_name: "n".repeat(201) },
      "invalid_client_metadata",
    ],
    [
      "a name with a control",
      { redirect_uris: [CLAUDE], client_name: "a\u0007b" },
      "invalid_client_metadata",
    ],
    [
      "an empty name",
      { redirect_uris: [CLAUDE], client_name: "" },
      "invalid_client_metadata",
    ],
    ["a non-object body", "[1,2]", "invalid_client_metadata"],
    ["a non-JSON body", "{", "invalid_client_metadata"],
    [
      "a 16,385-byte body",
      JSON.stringify({ redirect_uris: [CLAUDE], client_name: "x" }).padEnd(
        16_385,
        " ",
      ),
      "invalid_client_metadata",
    ],
  ])("BR-127 refuses %s", async (_label, body, error) => {
    const { h, response } = await post(body);
    expect(response.status).toBe(400);
    expect(response.body).toBe(JSON.stringify({ error }));
    expect(h.logs.map((entry) => entry.name)).toEqual(["registration_refused"]);
    // No client was stored: a token request for any client ID is unknown.
    const token = await h.proxy.token({
      form: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "x",
        code: "c",
      }),
    });
    expect(token.status).toBe(401);
  });

  it("BR-127 accepts a body of exactly 16,384 bytes", async () => {
    const body = JSON.stringify({ redirect_uris: [CLAUDE] }).padEnd(
      16_384,
      " ",
    );
    const { response } = await post(body);
    expect(response.status).toBe(201);
  });
});

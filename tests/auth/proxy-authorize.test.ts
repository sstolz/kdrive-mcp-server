import { describe, expect, it } from "vitest";
import {
  LOOPBACK,
  PUBLIC_URL,
  harness,
  header,
  location,
  s256,
} from "../helpers/proxy.js";

const challenge = s256("v".repeat(43));

describe("BR-128 authorization request validation", () => {
  it.each([
    ["an unknown client_id", { client_id: "unknown" }],
    ["an absent redirect_uri", { redirect_uri: undefined }],
    ["an altered path", { redirect_uri: "https://claude.ai/api/mcp/other" }],
    [
      "an altered host",
      { redirect_uri: "https://claude.com/api/mcp/auth_callback" },
    ],
    [
      "an extra query",
      { redirect_uri: "https://claude.ai/api/mcp/auth_callback?x=1" },
    ],
  ])(
    "BR-128 answers %s with an error page and no redirect",
    async (_l, extra) => {
      const h = await harness();
      const client = await h.register();
      const response = await h.proxy.authorize({
        query: h.authorizeQuery(client, challenge, extra),
      });
      expect(response.status).toBe(400);
      expect(header(response, "location")).toBeUndefined();
      expect(header(response, "content-type")).toContain("text/html");
    },
  );

  it("BR-128 answers a repeated parameter with an error page", async () => {
    const h = await harness();
    const client = await h.register();
    const query = h.authorizeQuery(client, challenge);
    query.append("client_id", client.clientId);
    const response = await h.proxy.authorize({ query });
    expect(response.status).toBe(400);
    expect(header(response, "location")).toBeUndefined();
  });

  it("BR-128 requires redirect_uri even for a client with one registered URI", async () => {
    const h = await harness();
    const client = await h.register({ redirect_uris: [LOOPBACK] });
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, { redirect_uri: undefined }),
    });
    expect(response.status).toBe(400);
  });

  it.each([
    [
      "response_type token",
      { response_type: "token" },
      "unsupported_response_type",
      true,
    ],
    [
      "response_type absent",
      { response_type: undefined },
      "unsupported_response_type",
      true,
    ],
    [
      "method plain",
      { code_challenge_method: "plain" },
      "invalid_request",
      true,
    ],
    [
      "method absent",
      { code_challenge_method: undefined },
      "invalid_request",
      true,
    ],
    [
      "challenge absent",
      { code_challenge: undefined },
      "invalid_request",
      true,
    ],
    [
      "42-character challenge",
      { code_challenge: challenge.slice(1) },
      "invalid_request",
      true,
    ],
    ["resource absent", { resource: undefined }, "invalid_target", true],
    [
      "another resource",
      { resource: "https://other.test" },
      "invalid_target",
      true,
    ],
    [
      "a 1,025-byte state",
      { state: "s".repeat(1025) },
      "invalid_request",
      false,
    ],
    [
      "a state with CR LF",
      { state: "a\r\nLocation: https://evil.test" },
      "invalid_request",
      false,
    ],
    ["an empty state", { state: "" }, "invalid_request", false],
  ])(
    "BR-128 redirects %s with its error and iss",
    async (_l, extra, error, echo) => {
      const h = await harness();
      const client = await h.register();
      const response = await h.proxy.authorize({
        query: h.authorizeQuery(client, challenge, extra),
      });
      expect(response.status).toBe(302);
      const target = location(response);
      expect(`${target.origin}${target.pathname}`).toBe(client.redirect);
      expect(target.searchParams.get("error")).toBe(error);
      expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
      expect(target.searchParams.has("state")).toBe(echo);
      if (echo) expect(target.searchParams.get("state")).toBe("client-state");
      expect(header(response, "location")).not.toMatch(/[\r\n]/u);
    },
  );

  it("BR-128 checks defects in the stated order", async () => {
    const h = await harness();
    const client = await h.register();
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, {
        response_type: "token",
        state: "",
        resource: undefined,
      }),
    });
    expect(location(response).searchParams.get("error")).toBe(
      "unsupported_response_type",
    );
    const second = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, {
        state: "",
        resource: undefined,
      }),
    });
    expect(location(second).searchParams.get("error")).toBe("invalid_request");
  });

  it("BR-128 round-trips a valid state with reserved and non-ASCII characters", async () => {
    const h = await harness();
    const client = await h.register();
    const state = "a&b#c%d é";
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, {
        resource: undefined,
        state,
      }),
    });
    expect(location(response).searchParams.get("state")).toBe(state);
  });

  it("BR-128 ignores scope and unknown parameters and answers with the consent page", async () => {
    const h = await harness();
    const client = await h.register();
    const response = await h.proxy.authorize({
      query: h.authorizeQuery(client, challenge, {
        scope: "anything",
        prompt: "login",
      }),
    });
    expect(response.status).toBe(200);
    expect(response.body).toContain('name="consent"');
  });
});

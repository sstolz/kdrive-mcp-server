import { describe, expect, it } from "vitest";
import {
  COOKIE,
  FakeUpstream,
  PUBLIC_URL,
  SECOND,
  UPSTREAM,
  UPSTREAM_CLIENT,
  UPSTREAM_SECRET,
  harness,
  header,
  location,
  upstreamMetadata,
  type Harness,
} from "../helpers/proxy.js";

const verifier = "v".repeat(43);

async function flowOf(h: Harness, redirect?: string) {
  const client = await h.register(
    redirect ? { redirect_uris: [redirect] } : {},
  );
  const flow = await h.approve(client, verifier);
  const up = location(flow.upstreamRedirect);
  return {
    client,
    flow,
    state: up.searchParams.get("state") ?? "",
    nonce: up.searchParams.get("nonce") ?? "",
  };
}

describe("BR-132 callback state and browser binding", () => {
  it.each([
    [
      "an altered state",
      (s: string) => ({ state: `${s}x` }),
      (c: string) => c,
      0,
    ],
    ["no state", () => ({}), (c: string) => c, 0],
    [
      "the state after 600 s",
      (s: string) => ({ state: s }),
      (c: string) => c,
      600,
    ],
    ["no cookie", (s: string) => ({ state: s }), () => undefined, 0],
    [
      "another browser's cookie",
      (s: string) => ({ state: s }),
      () => `${COOKIE}=${"B".repeat(43)}`,
      0,
    ],
  ])(
    "BR-132 refuses a callback with %s without redirect or exchange",
    async (_l, query, cookie, wait) => {
      const h = await harness();
      const { flow, state } = await flowOf(h);
      h.clock.advance(wait * SECOND);
      const c = cookie(flow.cookie);
      const response = await h.proxy.callback({
        query: new URLSearchParams({ code: "c", ...query(state) }),
        ...(c === undefined ? {} : { cookie: c }),
      });
      expect(response.status).toBe(400);
      expect(header(response, "location")).toBeUndefined();
      expect(h.upstream.count("post", "/token")).toBe(0);
    },
  );

  it("BR-132 a state is consumed by its first presentation, failed or not", async () => {
    const h = await harness();
    const { flow, state } = await flowOf(h);
    const failed = await h.proxy.callback({
      query: new URLSearchParams({ code: "c", state }),
    });
    expect(failed.status).toBe(400);
    const retry = await h.proxy.callback({
      query: new URLSearchParams({ code: "c", state }),
      cookie: flow.cookie,
    });
    expect(retry.status).toBe(400);
    const h2 = await harness();
    const second = await flowOf(h2);
    const ok = await h2.callback(second.flow);
    expect(ok.status).toBe(302);
    const replay = await h2.proxy.callback({
      query: new URLSearchParams({ code: "c", state: second.state }),
      cookie: second.flow.cookie,
    });
    expect(replay.status).toBe(400);
  });

  it("BR-132 a repeated parameter yields an error page", async () => {
    const h = await harness();
    const { flow, state } = await flowOf(h);
    const query = new URLSearchParams({ code: "c", state });
    query.append("code", "d");
    const response = await h.proxy.callback({ query, cookie: flow.cookie });
    expect(response.status).toBe(400);
    expect(header(response, "location")).toBeUndefined();
  });

  it("BR-130 a callback after a long login succeeds with the cookie re-sent at approval", async () => {
    const h = await harness();
    const client = await h.register();
    const page = await h.proxy.authorize({
      query: h.authorizeQuery(client, "x".repeat(43)),
    });
    const cookie = `${COOKIE}=${h.cookieOf(page)}`;
    h.clock.advance(599 * SECOND);
    const approved = await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(page),
        decision: "approve",
      }),
      cookie,
    });
    expect(h.cookieOf(approved)).toBe(h.cookieOf(page));
    h.clock.advance(599 * SECOND);
    const done = await h.callback({ page, cookie, upstreamRedirect: approved });
    expect(done.status).toBe(302);
    expect(location(done).searchParams.get("code")).toMatch(
      /^[A-Za-z0-9_-]{43}$/u,
    );
  });
});

describe("BR-132 callback outcomes", () => {
  it.each([
    ["advertised iss absent", true, {}, "server_error"],
    [
      "iss of another issuer",
      false,
      { iss: "https://evil.test" },
      "server_error",
    ],
    [
      "code and error together",
      false,
      { error: "access_denied" },
      "server_error",
    ],
    ["an empty code", false, { code: "" }, "server_error"],
  ])(
    "BR-132 %s yields %s without upstream request",
    async (_l, advertised, extra, error) => {
      const upstream = new FakeUpstream();
      if (advertised)
        upstream.metadata = upstreamMetadata({
          authorization_response_iss_parameter_supported: true,
        });
      const h = await harness({ upstream });
      const { flow, state } = await flowOf(h);
      const response = await h.proxy.callback({
        query: new URLSearchParams({ code: "c", state, ...extra }),
        cookie: flow.cookie,
      });
      const target = location(response);
      expect(target.searchParams.get("error")).toBe(error);
      expect(target.searchParams.get("state")).toBe("client-state");
      expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
      expect(h.upstream.count("post", "/token")).toBe(0);
    },
  );

  it("BR-132 neither code nor error yields server_error", async () => {
    const h = await harness();
    const { flow, state } = await flowOf(h);
    const response = await h.proxy.callback({
      query: new URLSearchParams({ state }),
      cookie: flow.cookie,
    });
    expect(location(response).searchParams.get("error")).toBe("server_error");
    expect(h.upstream.count("post", "/token")).toBe(0);
  });

  it("BR-132 accepts the advertised iss when equal to the upstream issuer", async () => {
    const upstream = new FakeUpstream();
    upstream.metadata = upstreamMetadata({
      authorization_response_iss_parameter_supported: true,
    });
    const h = await harness({ upstream });
    const { flow } = await flowOf(h);
    const done = await h.callback(flow, {}, { iss: UPSTREAM });
    expect(location(done).searchParams.get("code")).not.toBeNull();
  });

  it.each([
    ["access_denied", "access_denied"],
    ["login_required", "server_error"],
  ])(
    "BR-132 maps upstream error %s to %s without description",
    async (upstreamError, error) => {
      const h = await harness();
      const { flow, state } = await flowOf(h);
      const response = await h.proxy.callback({
        query: new URLSearchParams({
          state,
          error: upstreamError,
          error_description: "SYNTHETIC-DESCRIPTION",
          error_uri: "https://idp.test/err",
        }),
        cookie: flow.cookie,
      });
      const target = location(response);
      expect(target.searchParams.get("error")).toBe(error);
      expect(target.searchParams.has("error_description")).toBe(false);
      expect(target.searchParams.has("error_uri")).toBe(false);
      expect(header(response, "location")).not.toContain("SYNTHETIC");
      expect(target.searchParams.get("state")).toBe("client-state");
      expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
    },
  );

  it.each([
    ["a 400 exchange", { status: 400, json: { error: "invalid_grant" } }],
    ["no id_token", { status: 200, json: { token_type: "Bearer" } }],
    [
      "token_type mac",
      { status: 200, json: { token_type: "mac", id_token: "x.y.z" } },
    ],
    ["a non-object body", { status: 200, json: "text" }],
  ])("BR-132 %s yields server_error", async (_l, reply) => {
    const h = await harness();
    const { flow, state } = await flowOf(h);
    h.upstream.tokenReply = reply;
    const response = await h.proxy.callback({
      query: new URLSearchParams({ code: "c", state }),
      cookie: flow.cookie,
    });
    const target = location(response);
    expect(target.searchParams.get("error")).toBe("server_error");
    expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
  });

  it("BR-132 exchanges the code with Basic form-urlencoded credentials and the PKCE verifier", async () => {
    const h = await harness();
    const { flow } = await flowOf(h);
    await h.callback(flow);
    const post = h.upstream.calls.find((call) => call.kind === "post");
    expect(post?.url).toBe(`${UPSTREAM}/token`);
    expect(post?.authorization).toBe(
      // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
      `Basic ${Buffer.from(`${UPSTREAM_CLIENT}:${UPSTREAM_SECRET}`).toString("base64")}`,
    );
    const form = post?.form;
    expect(form?.get("grant_type")).toBe("authorization_code");
    expect(form?.get("code")).toBe("SYNTHETIC-UPSTREAM-CODE");
    expect(form?.get("redirect_uri")).toBe(`${PUBLIC_URL}/oauth/callback`);
    expect(form?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(form?.has("client_secret")).toBe(false);
  });

  it("BR-132 uses client_secret_post when Basic is not listed", async () => {
    const upstream = new FakeUpstream();
    upstream.metadata = upstreamMetadata({
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    });
    const h = await harness({ upstream });
    const { flow } = await flowOf(h);
    await h.callback(flow);
    const post = h.upstream.calls.find((call) => call.kind === "post");
    expect(post?.authorization).toBeUndefined();
    expect(post?.form?.get("client_id")).toBe(UPSTREAM_CLIENT);
    expect(post?.form?.get("client_secret")).toBe(UPSTREAM_SECRET);
  });

  it("BR-132 Basic credentials are form-urlencoded before Base64", async () => {
    const special = new FakeUpstream();
    const h2 = await harness({ upstream: special });
    // Re-create a proxy whose upstream client ID contains reserved characters.
    const { createOAuthProxy } = await import("../../src/auth/proxy/index.js");
    const proxy = createOAuthProxy({
      config: {
        ...h2.config,
        oauthUpstreamClientId: "id:with space",
        oauthUpstreamClientSecret: "s&+",
      },
      clock: h2.clock.now,
      randomBytes: (size) => new Uint8Array(size).fill(7),
      upstream: special,
    });
    const reg = await proxy.register({
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const clientId = (JSON.parse(reg.body) as { client_id: string }).client_id;
    const page = await proxy.authorize({
      query: new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
        resource: PUBLIC_URL,
      }),
    });
    const cookie = `${COOKIE}=${h2.cookieOf(page)}`;
    const up = await proxy.consent({
      form: new URLSearchParams({
        consent: h2.consentId(page),
        decision: "approve",
      }),
      cookie,
    });
    special.tokenReply = { status: 400, json: {} };
    await proxy.callback({
      query: new URLSearchParams({
        code: "c",
        state: location(up).searchParams.get("state") ?? "",
      }),
      cookie,
    });
    const post = special.calls.find((call) => call.kind === "post");
    expect(post?.authorization).toBe(
      `Basic ${Buffer.from("id%3Awith+space:s%26%2B").toString("base64")}`,
    );
  });

  it("BR-135 keeps an existing redirect query and adds code, state and iss", async () => {
    const redirect = "https://claude.ai/api/mcp/auth_callback?a=1";
    const h = await harness({ redirects: [redirect] });
    const { flow } = await flowOf(h, redirect);
    const done = await h.callback(flow);
    const value = header(done, "location") ?? "";
    expect(value.startsWith(`${redirect}&code=`)).toBe(true);
    const target = location(done);
    expect(target.searchParams.get("a")).toBe("1");
    expect(target.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(target.searchParams.get("state")).toBe("client-state");
    expect(target.searchParams.get("iss")).toBe(PUBLIC_URL);
  });
});

describe("BR-134 identity authorization at login", () => {
  it.each([
    ["an allowed sub", { sub: "user-1" }, true],
    [
      "an allowed verified email",
      { sub: "other", email: "owner@example.test", email_verified: true },
      true,
    ],
    [
      "an allowed email with string verification",
      { sub: "other", email: "owner@example.test", email_verified: "true" },
      false,
    ],
    [
      "an allowed email without verification",
      { sub: "other", email: "owner@example.test" },
      false,
    ],
    ["an unlisted sub", { sub: "intruder" }, false],
  ])("BR-134 %s", async (_l, claims, allowed) => {
    const h = await harness({ emails: ["owner@example.test"] });
    const { flow } = await flowOf(h);
    const done = await h.callback(flow, claims);
    const target = location(done);
    if (allowed) {
      expect(target.searchParams.get("code")).not.toBeNull();
    } else {
      expect(target.searchParams.get("error")).toBe("access_denied");
      expect(target.searchParams.has("code")).toBe(false);
      expect(h.logs.some((entry) => entry.name === "identity_refused")).toBe(
        true,
      );
    }
  });
});

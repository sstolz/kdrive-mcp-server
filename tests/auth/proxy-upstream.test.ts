import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchUpstream, type Fetch } from "../../src/auth/proxy/index.js";
import {
  PUBLIC_URL,
  SECOND,
  UPSTREAM,
  UPSTREAM_CLIENT,
  FakeUpstream,
  harness,
  location,
  s256,
  upstreamMetadata,
} from "../helpers/proxy.js";

const verifier = "v".repeat(43);

describe("BR-131 upstream discovery and redirect", () => {
  it.each([
    [
      "an issuer with a trailing slash",
      upstreamMetadata({ issuer: `${UPSTREAM}/` }),
    ],
    [
      "an http token endpoint",
      upstreamMetadata({ token_endpoint: "http://idp.test/token" }),
    ],
    [
      "no S256",
      upstreamMetadata({ code_challenge_methods_supported: ["plain"] }),
    ],
    [
      "only auth method none",
      upstreamMetadata({ token_endpoint_auth_methods_supported: ["none"] }),
    ],
    ["a non-object document", ["not", "an", "object"]],
  ])(
    "BR-131 refuses %s and retries at most once per 60 seconds",
    async (_l, metadata) => {
      const upstream = new FakeUpstream();
      upstream.metadata = metadata;
      const h = await harness({ upstream });
      const client = await h.register();
      const first = await h.approve(client, verifier);
      expect(location(first.upstreamRedirect).searchParams.get("error")).toBe(
        "temporarily_unavailable",
      );
      expect(location(first.upstreamRedirect).searchParams.get("iss")).toBe(
        PUBLIC_URL,
      );
      expect(upstream.count("get", "openid-configuration")).toBe(1);
      h.clock.advance(59 * SECOND);
      await h.approve(client, verifier);
      expect(upstream.count("get", "openid-configuration")).toBe(1);
      h.clock.advance(SECOND);
      await h.approve(client, verifier);
      expect(upstream.count("get", "openid-configuration")).toBe(2);
      expect(
        h.logs.some((entry) => entry.name === "upstream_unavailable"),
      ).toBe(true);
    },
  );

  it("BR-131 caches usable Infomaniak-shaped discovery and sends exactly the stated parameters", async () => {
    const h = await harness();
    const client = await h.register();
    const flow = await h.approve(client, verifier);
    expect(flow.upstreamRedirect.status).toBe(302);
    const target = location(flow.upstreamRedirect);
    expect(`${target.origin}${target.pathname}`).toBe(`${UPSTREAM}/authorize`);
    const params = Object.fromEntries(target.searchParams);
    expect(Object.keys(params).sort()).toEqual(
      [
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "nonce",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
      ].sort(),
    );
    expect(params.response_type).toBe("code");
    expect(params.client_id).toBe(UPSTREAM_CLIENT);
    expect(params.redirect_uri).toBe(`${PUBLIC_URL}/oauth/callback`);
    expect(params.scope).toBe("openid");
    expect(params.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(params.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(params.code_challenge).not.toBe(s256(verifier));
    expect(params.code_challenge_method).toBe("S256");
    await h.approve(client, verifier);
    expect(h.upstream.count("get", "openid-configuration")).toBe(1);
  });

  it("BR-131 asks for the email scope when the email allowlist is nonempty", async () => {
    const h = await harness({ emails: ["owner@example.test"] });
    const flow = await h.approve(await h.register(), verifier);
    expect(location(flow.upstreamRedirect).searchParams.get("scope")).toBe(
      "openid email",
    );
  });

  it("BR-131 consents approved while discovery is in flight share it", async () => {
    const h = await harness();
    const client = await h.register();
    const pages = [];
    for (let index = 0; index < 2; index += 1)
      pages.push(
        await h.proxy.authorize({
          query: h.authorizeQuery(client, s256(verifier)),
        }),
      );
    const results = await Promise.all(
      pages.map((page) =>
        h.proxy.consent({
          form: new URLSearchParams({
            consent: h.consentId(page),
            decision: "approve",
          }),
          cookie: `__Host-kdrive-oauth=${h.cookieOf(page)}`,
        }),
      ),
    );
    for (const result of results)
      expect(location(result).searchParams.has("nonce")).toBe(true);
    expect(h.upstream.count("get", "openid-configuration")).toBe(1);
  });

  it("BR-131 a non-200 discovery answer is unusable", async () => {
    const upstream = new FakeUpstream();
    upstream.metadataStatus = 500;
    const h = await harness({ upstream });
    const flow = await h.approve(await h.register(), verifier);
    expect(location(flow.upstreamRedirect).searchParams.get("error")).toBe(
      "temporarily_unavailable",
    );
  });
});

function streamResponse(
  bytes: number,
  init: ResponseInit = { status: 200 },
): Response {
  const chunk = new Uint8Array(1024).fill(0x20);
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunk.length, bytes - sent);
        controller.enqueue(chunk.subarray(0, size));
        sent += size;
      },
    }),
    init,
  );
}

describe("BR-131 bounded production upstream port", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("BR-131 sends GET and form POST requests without following redirects", async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    );
    const port = createFetchUpstream({ fetch });
    expect(await port.fetchJson(`${UPSTREAM}/x`)).toEqual({
      status: 200,
      json: { ok: true },
    });
    const form = new URLSearchParams({ a: "1" });
    expect(await port.postForm(`${UPSTREAM}/token`, form, "Basic abc")).toEqual(
      {
        status: 200,
        json: { ok: true },
      },
    );
    const init = fetch.mock.calls[1]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBe("a=1");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Basic abc",
    );
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("BR-131 a non-JSON body yields undefined JSON and exactly 65,536 bytes are read", async () => {
    const port = createFetchUpstream({
      fetch: () => Promise.resolve(streamResponse(65_536)),
    });
    expect(await port.fetchJson(`${UPSTREAM}/x`)).toEqual({
      status: 200,
      json: undefined,
    });
  });

  it.each([
    [
      "an http URL",
      "http://idp.test/x",
      () => Promise.resolve(new Response("{}")),
    ],
    [
      "a redirect",
      `${UPSTREAM}/x`,
      () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.test" },
          }),
        ),
    ],
    [
      "a body over 65,536 bytes",
      `${UPSTREAM}/x`,
      () => Promise.resolve(streamResponse(65_537)),
    ],
    [
      "a network failure",
      `${UPSTREAM}/x`,
      () => Promise.reject(new Error("down")),
    ],
  ])("BR-131 fails on %s without retry", async (_l, url, behaviour) => {
    const fetch = vi.fn(behaviour);
    const port = createFetchUpstream({ fetch });
    await expect(port.fetchJson(url)).rejects.toThrow();
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("BR-131 times out after 10 seconds", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const port = createFetchUpstream({ fetch });
    const pending = port.fetchJson(`${UPSTREAM}/x`);
    const outcome = pending.then(
      () => "resolved",
      () => "rejected",
    );
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("rejected");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("BR-131 a failing port yields temporarily_unavailable at discovery and server_error at exchange", async () => {
    const upstream = new FakeUpstream();
    upstream.metadata = undefined;
    upstream.fetchJson = () => Promise.reject(new Error("timeout"));
    const h = await harness({ upstream });
    const client = await h.register();
    const flow = await h.approve(client, verifier);
    expect(location(flow.upstreamRedirect).searchParams.get("error")).toBe(
      "temporarily_unavailable",
    );
    const ok = await harness();
    const okFlow = await ok.approve(await ok.register(), verifier);
    ok.upstream.tokenReply = "fail";
    const state =
      location(okFlow.upstreamRedirect).searchParams.get("state") ?? "";
    const done = await ok.proxy.callback({
      query: new URLSearchParams({ code: "c", state }),
      cookie: okFlow.cookie,
    });
    expect(location(done).searchParams.get("error")).toBe("server_error");
  });
});

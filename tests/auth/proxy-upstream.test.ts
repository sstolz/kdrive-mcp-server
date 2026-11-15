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

function cleanupFixture(
  options: {
    status?: number;
    opaque?: boolean;
    bytes?: number;
    close?: boolean;
    streamError?: boolean;
    fetchError?: boolean;
    abortAware?: boolean;
    cancellation?: "throws" | "rejects" | "never settles";
  } = {},
) {
  let signal: AbortSignal | null | undefined;
  const original = new Error("synthetic upstream failure");
  const cancel = vi.fn(() => {
    if (options.cancellation === "throws") throw new Error("cleanup failed");
    if (options.cancellation === "rejects")
      return Promise.reject(new Error("cleanup failed"));
    if (options.cancellation === "never settles")
      return new Promise<void>(() => undefined);
    return undefined;
  });
  const fetch: Fetch = (_input, init) => {
    signal = init?.signal;
    if (options.fetchError) return Promise.reject(original);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (options.bytes !== undefined)
          controller.enqueue(new Uint8Array(options.bytes).fill(0x20));
        if (options.close) controller.close();
        if (options.abortAware) {
          signal?.addEventListener(
            "abort",
            () => {
              controller.error(original);
            },
            { once: true },
          );
        }
      },
      pull(controller) {
        if (options.streamError) controller.error(original);
      },
      cancel,
    });
    const response = options.opaque
      ? ({ type: "opaqueredirect", status: 0, body } as Response)
      : new Response(body, { status: options.status ?? 200 });
    return Promise.resolve(response);
  };
  return {
    port: createFetchUpstream({ fetch }),
    cancel,
    original,
    aborted: () => signal?.aborted,
  };
}

function fetchUpstream(port: ReturnType<typeof createFetchUpstream>) {
  return port.fetchJson(`${UPSTREAM}/jwks`);
}

function postUpstream(port: ReturnType<typeof createFetchUpstream>) {
  return port.postForm(`${UPSTREAM}/token`, new URLSearchParams());
}

describe("BR-131 v2 cleanup", () => {
  afterEach(() => vi.useRealTimers());

  it("BR-131 v2 AC-08 a refused redirect cancels its body and aborts its request", async () => {
    for (const requestUpstream of [fetchUpstream, postUpstream]) {
      for (const status of [301, 302, 303, 307, 308, 0]) {
        const f = cleanupFixture(status === 0 ? { opaque: true } : { status });
        await expect(requestUpstream(f.port)).rejects.toThrow(
          "Upstream redirect refused.",
        );
        expect(f.aborted()).toBe(true);
        expect(f.cancel).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("BR-131 v2 AC-08 a bodyless opaque redirect aborts its request", async () => {
    for (const requestUpstream of [fetchUpstream, postUpstream]) {
      let signal: AbortSignal | null | undefined;
      const port = createFetchUpstream({
        fetch: (_input, init) => {
          signal = init?.signal;
          const response = Response.error();
          Object.defineProperty(response, "type", { value: "opaqueredirect" });
          return Promise.resolve(response);
        },
      });
      await expect(requestUpstream(port)).rejects.toThrow(
        "Upstream redirect refused.",
      );
      expect(signal?.aborted).toBe(true);
    }
  });

  it("BR-131 v2 AC-09 every other early exit aborts its request and releases the body", async () => {
    for (const requestUpstream of [fetchUpstream, postUpstream]) {
      const success = cleanupFixture({ bytes: 65_536, close: true });
      expect((await requestUpstream(success.port)).status).toBe(200);
      expect(success.aborted()).toBe(false);
      expect(success.cancel).not.toHaveBeenCalled();
      const large = cleanupFixture({ bytes: 65_537 });
      await expect(requestUpstream(large.port)).rejects.toThrow(
        "Upstream response too large.",
      );
      expect(large.aborted()).toBe(true);
      expect(large.cancel).toHaveBeenCalledTimes(1);
      for (const options of [
        { bytes: 10, streamError: true },
        { fetchError: true },
      ]) {
        const failed = cleanupFixture(options);
        await expect(requestUpstream(failed.port)).rejects.toBe(
          failed.original,
        );
        expect(failed.aborted()).toBe(true);
      }
    }
    vi.useFakeTimers();
    const stalled = cleanupFixture();
    let settled = false;
    const outcome = stalled.port
      .fetchJson(`${UPSTREAM}/x`)
      .catch((error: unknown) => {
        settled = true;
        return error;
      });
    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual(new Error("Upstream deadline exceeded."));
    expect(stalled.aborted()).toBe(true);
    expect(stalled.cancel).toHaveBeenCalledTimes(1);
  });

  it("BR-131 v2 AC-09 a closed oversized stream needs no cancel callback", async () => {
    const f = cleanupFixture({ bytes: 65_537, close: true });
    await expect(f.port.fetchJson(`${UPSTREAM}/x`)).rejects.toThrow(
      "Upstream response too large.",
    );
    expect(f.aborted()).toBe(true);
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it.each(["throws", "rejects", "never settles"] as const)(
    "BR-131 v2 AC-09 cancellation %s cannot delay or replace the failure",
    async (cancellation) => {
      vi.useFakeTimers();
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        for (const oversized of [false, true]) {
          const f = cleanupFixture({
            cancellation,
            ...(oversized ? { bytes: 65_537 } : {}),
          });
          let settled = false;
          const outcome = f.port
            .fetchJson(`${UPSTREAM}/x`)
            .catch((error: unknown) => {
              settled = true;
              return error;
            });
          await vi.advanceTimersByTimeAsync(oversized ? 0 : 10_000);
          expect(settled).toBe(true);
          expect(await outcome).toEqual(
            new Error(
              oversized
                ? "Upstream response too large."
                : "Upstream deadline exceeded.",
            ),
          );
          expect(f.aborted()).toBe(true);
          expect(f.cancel).toHaveBeenCalledTimes(1);
        }
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    },
  );

  it("BR-131 v2 AC-09 abort-aware streams need no cancel callback", async () => {
    vi.useFakeTimers();
    for (const oversized of [false, true]) {
      const f = cleanupFixture({
        abortAware: true,
        ...(oversized ? { bytes: 65_537 } : {}),
      });
      const outcome = f.port
        .fetchJson(`${UPSTREAM}/x`)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(oversized ? 0 : 10_000);
      expect(await outcome).toEqual(
        new Error(
          oversized
            ? "Upstream response too large."
            : "Upstream deadline exceeded.",
        ),
      );
      expect(f.aborted()).toBe(true);
    }
  });
});

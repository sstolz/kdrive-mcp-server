import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
import {
  UPSTREAM,
  UPSTREAM_CLIENT,
  UPSTREAM_SECRET,
} from "../helpers/proxy.js";
import {
  P,
  PRM,
  bodyJson,
  expectError,
  httpFixture,
  oauthLogin,
  jsonRpc,
} from "../helpers/http.js";

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return { ...actual, createOAuthProxy: vi.fn(actual.createOAuthProxy) };
});

afterEach(() => vi.mocked(createOAuthProxy).mockClear());

describe("BR-155 protected resource metadata", () => {
  it("BR-152 BR-155 BR-158 AC-04 publishes the exact metadata and derives P once", async () => {
    const f = await httpFixture();
    const response = await f.send(
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe(
      '{"resource":"https://mcp.test/mcp","authorization_servers":["https://mcp.test/mcp"],"bearer_methods_supported":["header"]}',
    );
    const challenge = await f.send("POST", "/mcp", { body: "{}" });
    expect(challenge.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${PRM}"`,
    );
    await challenge.text();
    const as = await bodyJson(
      await f.send("GET", "/.well-known/oauth-authorization-server/mcp"),
    );
    expect(as.issuer).toBe(P);
    const options = vi.mocked(createOAuthProxy).mock.calls[0]![0];
    expect(options.config.publicUrl).toBe(P);
    expect(options.config.oauthAudience).toBe(P);
    expect(options.config.oauthUpstreamClientSecret).toBe(UPSTREAM_SECRET);
    expect(options.config.oauthUpstreamClientId).toBe(UPSTREAM_CLIENT);
    expect(options.config.oauthIssuer).toBe(UPSTREAM);
    expect(options.config.oauthAllowedSubjects).toEqual(["user-1"]);
    expect(options.config.oauthAllowedEmails).toEqual([]);
    expect(new TextDecoder().decode(options.config.oauthSigningKey)).toBe(
      f.pem,
    );
    expect(options.upstream).toBe(f.upstream);
    await f.handler.close();
  });

  it("BR-152 BR-155 AC-04 accepts a token for P and refuses another audience", async () => {
    const f = await httpFixture();
    const login = await oauthLogin(f);
    const accepted = await f.mcp(
      login.accessToken,
      jsonRpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "c", version: "1" },
      }),
    );
    expect(accepted.status).toBe(200);
    await accepted.text();
    const other = await f.mint({ aud: "https://mcp.test/other" });
    await expectError(await f.mcp(other, "{}"), 401, "invalid_token");
    await f.handler.close();
  });
});

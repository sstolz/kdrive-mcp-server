import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type FetchLike,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { CLAUDE } from "../helpers/proxy.js";
import {
  HOST,
  P,
  SYNTHETIC_PLACEHOLDER,
  browserLogin,
  httpFixture,
  type Fixture,
} from "../helpers/http.js";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.handler.close();
  fixture = undefined;
});

/** A fetch whose requests are answered by `handle()`; the path and query are the target. */
function bridge(f: Fixture): FetchLike {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("host", HOST);
    const method = request.method;
    const bridged = new Request(SYNTHETIC_PLACEHOLDER, {
      method,
      headers,
      ...(method === "GET" || method === "HEAD"
        ? {}
        : { body: await request.arrayBuffer() }),
    });
    return await f.handler.handle(bridged, `${url.pathname}${url.search}`);
  };
}

describe("SDK client against the HTTP layer", () => {
  it("BR-154 BR-155 BR-159 BR-163 BR-165 AC-20 connects through discovery, registration and consent", async () => {
    const f = (fixture = await httpFixture());
    let authorization: URL | undefined;
    let information: StoredOAuthClientInformation | undefined;
    let tokens: StoredOAuthTokens | undefined;
    let verifier = "";
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return CLAUDE;
      },
      get clientMetadata() {
        return {
          redirect_uris: [CLAUDE],
          client_name: "synthetic-sdk-client",
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        };
      },
      clientInformation: () => information,
      saveClientInformation: (value) => {
        information = value;
      },
      tokens: () => tokens,
      saveTokens: (value) => {
        tokens = value;
      },
      redirectToAuthorization: (url) => {
        authorization = url;
      },
      saveCodeVerifier: (value) => {
        verifier = value;
      },
      codeVerifier: () => verifier,
    };
    const first = new StreamableHTTPClientTransport(new URL(P), {
      authProvider: provider,
      fetch: bridge(f),
    });
    const client = new Client({ name: "synthetic-sdk-client", version: "1" });
    await expect(client.connect(first)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(authorization?.pathname).toBe("/mcp/oauth/authorize");
    expect(authorization?.searchParams.get("resource")).toBe(P);
    expect(information).toBeDefined();

    const redirect = await browserLogin(f, authorization!.toString());
    expect(redirect.origin + redirect.pathname).toBe(CLAUDE);
    await first.finishAuth(redirect.searchParams);
    expect(tokens?.access_token).toBeTruthy();

    const second = new Client({ name: "synthetic-sdk-client", version: "1" });
    await second.connect(
      new StreamableHTTPClientTransport(new URL(P), {
        authProvider: provider,
        fetch: bridge(f),
      }),
    );
    const listed = await second.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain("kdrive_info");
    const result = await second.callTool({
      name: "kdrive_info",
      arguments: { file_id: 3 },
    });
    expect(result.isError).not.toBe(true);
    await second.close();
  });

  it("BR-163 AC-22 falls back from the server/discover probe to initialize", async () => {
    const f = (fixture = await httpFixture());
    const token = await f.mint();
    const client = new Client(
      { name: "synthetic-sdk-client", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(P), {
        fetch: bridge(f),
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    expect(client.getProtocolEra()).toBe("legacy");
    const listed = await client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
    const probes = f
      .events("request_refused")
      .filter((e) => e.fields.status === 400);
    expect(probes.length).toBeGreaterThanOrEqual(1);
    await client.close();
  });
});

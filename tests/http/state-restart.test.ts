// F-019 AC-21 (BR-292, BR-298): rehearsal of the owner run over real HTTP. A
// client registers, logs in and gets tokens; the server closes; a new server
// on the same state file refreshes the token without registration or login.
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "../../src/http/index.js";
import { stateOptions } from "../helpers/http-state.js";
import {
  HOST,
  exchange,
  rawHeader,
  type RawResponse,
} from "../helpers/http.js";
import {
  CLAUDE,
  COOKIE,
  UPSTREAM,
  UPSTREAM_CLIENT,
  removeStateFiles,
  s256,
  signIdToken,
  stateFile,
  upstreamMetadata,
} from "../helpers/proxy.js";

afterEach(() => {
  removeStateFiles();
});

type Started = Awaited<ReturnType<typeof stateOptions>> & {
  server: ReturnType<typeof createHttpServer>;
  port: number;
};

async function start(path: string, pem?: string): Promise<Started> {
  const state = await stateOptions(path, pem === undefined ? {} : { pem });
  const server = createHttpServer(state.handlerOptions);
  await new Promise<void>((resolve, reject) => {
    server.server.once("error", reject);
    server.server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { ...state, server, port };
}

async function call(
  port: number,
  method: string,
  target: string,
  headers: Array<[string, string]> = [],
  body?: string,
): Promise<RawResponse> {
  const response = await exchange(port, {
    method,
    target,
    headers: [
      ["Host", HOST],
      ["Connection", "close"],
      ...headers,
      ...(body === undefined
        ? []
        : ([["Content-Length", String(Buffer.byteLength(body))]] as Array<
            [string, string]
          >)),
    ],
    ...(body === undefined ? {} : { body }),
  });
  if (!response) throw new Error(`no response to ${method} ${target}`);
  return response;
}

const FORM: [string, string] = [
  "Content-Type",
  "application/x-www-form-urlencoded",
];

describe("BR-292 BR-298 restart over HTTP (AC-21)", () => {
  it("BR-292 AC-21 a refresh succeeds on a new server without registration or login", async () => {
    const path = stateFile();
    const first = await start(path);
    const registration = await call(
      first.port,
      "POST",
      "/mcp/oauth/register",
      [["Content-Type", "application/json"]],
      JSON.stringify({
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "none",
      }),
    );
    expect(registration.status).toBe(201);
    const clientId = (JSON.parse(registration.body) as { client_id: string })
      .client_id;
    const verifier = `synthetic-verifier-restart-${"r".repeat(30)}`;
    const authorize = await call(
      first.port,
      "GET",
      `/mcp/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: CLAUDE,
        state: "client-state",
        code_challenge: s256(verifier),
        code_challenge_method: "S256",
        resource: "https://mcp.test/mcp",
      }).toString()}`,
    );
    expect(authorize.status).toBe(200);
    const consentId =
      /name="consent" value="([^"]+)"/u.exec(authorize.body)?.[1] ?? "";
    const cookie = `${COOKIE}=${/__Host-kdrive-oauth=([^;]+)/u.exec(rawHeader(authorize, "set-cookie") ?? "")?.[1] ?? ""}`;
    const approved = await call(
      first.port,
      "POST",
      "/mcp/oauth/consent",
      [FORM, ["Origin", "null"], ["Cookie", cookie]],
      new URLSearchParams({
        consent: consentId,
        decision: "approve",
      }).toString(),
    );
    expect(approved.status).toBe(302);
    const upstream = new URL(rawHeader(approved, "location") ?? "");
    const iat = Math.floor(first.clock.ms / 1000);
    first.upstream.metadata = upstreamMetadata();
    first.upstream.tokenReply = {
      status: 200,
      json: {
        token_type: "Bearer",
        access_token: "SYNTHETIC-UPSTREAM-ACCESS",
        id_token: await signIdToken(first.idKey, {
          iss: UPSTREAM,
          aud: UPSTREAM_CLIENT,
          sub: "user-1",
          nonce: upstream.searchParams.get("nonce") ?? "",
          iat,
          exp: iat + 300,
        }),
      },
    };
    const callback = await call(
      first.port,
      "GET",
      `/mcp/oauth/callback?${new URLSearchParams({
        code: "SYNTHETIC-UPSTREAM-CODE",
        state: upstream.searchParams.get("state") ?? "",
      }).toString()}`,
      [["Cookie", cookie]],
    );
    const code =
      new URL(rawHeader(callback, "location") ?? "").searchParams.get("code") ??
      "";
    const tokens = await call(
      first.port,
      "POST",
      "/mcp/oauth/token",
      [FORM],
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CLAUDE,
        code_verifier: verifier,
        client_id: clientId,
      }).toString(),
    );
    expect(tokens.status).toBe(200);
    const refreshToken = (JSON.parse(tokens.body) as { refresh_token: string })
      .refresh_token;
    await first.server.close();

    const second = await start(path, first.pem);
    try {
      expect(second.logs).toContainEqual({
        name: "store_loaded",
        fields: { clients: 1, families: 1 },
      });
      const refreshed = await call(
        second.port,
        "POST",
        "/mcp/oauth/token",
        [FORM],
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
        }).toString(),
      );
      expect(refreshed.status).toBe(200);
      const body = JSON.parse(refreshed.body) as Record<string, unknown>;
      expect(body.token_type).toBe("Bearer");
      expect(body.refresh_token).not.toBe(refreshToken);
      expect(second.upstream.calls).toEqual([]);
    } finally {
      await second.server.close();
    }
  });
});

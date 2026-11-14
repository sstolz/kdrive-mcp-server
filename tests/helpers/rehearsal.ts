// Shared steps of the owner-run acceptance rehearsals (F-028 AC-12, F-029
// AC-05): raw HTTP calls, a tool call, and the consent-to-tokens login.
import { expect } from "vitest";
import {
  HOST,
  INITIALIZE,
  RawClient,
  exchange,
  jsonRpc,
  rawHeader,
  rawText,
  type RawResponse,
} from "./http.js";
import {
  CLAUDE,
  COOKIE,
  UPSTREAM,
  UPSTREAM_CLIENT,
  s256,
  signIdToken,
  type FakeUpstream,
  type UpstreamKey,
} from "./proxy.js";

export const FORM: [string, string] = [
  "Content-Type",
  "application/x-www-form-urlencoded",
];

export async function call(
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

export async function callTool(
  port: number,
  accessToken: string,
): Promise<number> {
  const client = await RawClient.connect(port);
  const send = (body: string, session?: string) => {
    client.write(
      rawText({
        method: "POST",
        target: "/mcp",
        headers: [
          ["Host", HOST],
          ["Authorization", `Bearer ${accessToken}`],
          ["Content-Type", "application/json"],
          ["Accept", "application/json, text/event-stream"],
          ["Content-Length", String(Buffer.byteLength(body))],
          ...(session
            ? ([["Mcp-Session-Id", session]] as Array<[string, string]>)
            : []),
        ],
        body,
      }),
    );
  };
  try {
    send(INITIALIZE);
    const init = await client.next();
    if (init?.status !== 200) return init?.status ?? 0;
    const session = rawHeader(init, "mcp-session-id") ?? "";
    send(jsonRpc("notifications/initialized", undefined), session);
    await client.next();
    send(
      jsonRpc("tools/call", 3, { name: "kdrive_list_drives", arguments: {} }),
      session,
    );
    const result = await client.next();
    expect(result?.body).not.toContain('"isError":true');
    return result?.status ?? 0;
  } finally {
    client.destroy();
  }
}

/** The CIMD authorize target a client with `documentUrl` opens. */
export function authorizeTarget(
  documentUrl: string,
  verifier: string,
  resource: string,
): string {
  return `/mcp/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: documentUrl,
    redirect_uri: CLAUDE,
    state: "client-state",
    code_challenge: s256(verifier),
    code_challenge_method: "S256",
    resource,
  }).toString()}`;
}

export interface LoginOptions {
  port: number;
  upstream: FakeUpstream;
  idKey: UpstreamKey;
  target: string;
  documentUrl: string;
  verifier: string;
  clientHost: string;
}

/**
 * Consent page (showing the client host), approval, upstream login, code and
 * token exchange; returns the issued token response.
 */
export async function login(
  options: LoginOptions,
): Promise<Record<string, string>> {
  const { port, upstream, idKey } = options;
  const page = await call(port, "GET", options.target);
  expect(page.status).toBe(200);
  expect(page.body).toContain(`Client host: ${options.clientHost}`);
  const consentId =
    /name="consent" value="([^"]+)"/u.exec(page.body)?.[1] ?? "";
  const cookie = `${COOKIE}=${/__Host-kdrive-oauth=([^;]+)/u.exec(rawHeader(page, "set-cookie") ?? "")?.[1] ?? ""}`;
  const approved = await call(
    port,
    "POST",
    "/mcp/oauth/consent",
    [FORM, ["Cookie", cookie]],
    new URLSearchParams({
      consent: consentId,
      decision: "approve",
    }).toString(),
  );
  expect(approved.status).toBe(302);
  const upstreamLogin = new URL(rawHeader(approved, "location") ?? "");
  const iat = Math.floor(Date.now() / 1000);
  upstream.tokenReply = {
    status: 200,
    json: {
      token_type: "Bearer",
      access_token: "SYNTHETIC-UPSTREAM-ACCESS",
      id_token: await signIdToken(idKey, {
        iss: UPSTREAM,
        aud: UPSTREAM_CLIENT,
        sub: "user-1",
        nonce: upstreamLogin.searchParams.get("nonce") ?? "",
        iat,
        exp: iat + 300,
      }),
    },
  };
  const callback = await call(
    port,
    "GET",
    `/mcp/oauth/callback?${new URLSearchParams({
      code: "SYNTHETIC-UPSTREAM-CODE",
      state: upstreamLogin.searchParams.get("state") ?? "",
    }).toString()}`,
    [["Cookie", cookie]],
  );
  expect(callback.status).toBe(302);
  const code =
    new URL(rawHeader(callback, "location") ?? "").searchParams.get("code") ??
    "";
  const tokens = await call(
    port,
    "POST",
    "/mcp/oauth/token",
    [FORM],
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE,
      code_verifier: options.verifier,
      client_id: options.documentUrl,
    }).toString(),
  );
  expect(tokens.status).toBe(200);
  return JSON.parse(tokens.body) as Record<string, string>;
}

/** A refresh-token exchange; returns the issued token response. */
export async function refresh(
  port: number,
  refreshToken: string,
  documentUrl: string,
): Promise<Record<string, string>> {
  const refreshed = await call(
    port,
    "POST",
    "/mcp/oauth/token",
    [FORM],
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: documentUrl,
    }).toString(),
  );
  expect(refreshed.status).toBe(200);
  return JSON.parse(refreshed.body) as Record<string, string>;
}

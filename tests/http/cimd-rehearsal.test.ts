// F-028 AC-12: rehearsal of the owner-run CIMD acceptance. The acceptance
// composition (scripts/http-acceptance.ts) runs the real HTTP layer with a
// fake upstream, a temporary state file and a local TLS CIMD client double.
// Only the test CA and the loopback allowance are substituted (rehearsal
// seam); the real c-ares Resolver resolves the double's host through a stub
// UDP DNS server and feeds the pinned lookup.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAcceptance } from "../../scripts/http-acceptance.ts";
import { productionAddressPolicy } from "../../src/auth/proxy/address-policy.js";
import {
  REHEARSAL_HOST,
  cimdCertificates,
  cimdDocument,
  reply,
  startDnsStub,
  startDocumentServer,
  type DnsStub,
  type DocumentServer,
} from "../helpers/cimd.js";
import {
  HOST,
  INITIALIZE,
  P,
  RawClient,
  exchange,
  jsonRpc,
  listeningPort,
  rawHeader,
  rawText,
  type RawResponse,
} from "../helpers/http.js";
import {
  CLAUDE,
  COOKIE,
  FakeUpstream,
  UPSTREAM,
  UPSTREAM_CLIENT,
  s256,
  signIdToken,
  syntheticPem,
  upstreamKey,
} from "../helpers/proxy.js";

let directory = "";
let double: DocumentServer | undefined;
let dns: DnsStub | undefined;
afterEach(async () => {
  await double?.close();
  await dns?.close();
  double = undefined;
  dns = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

const FORM: [string, string] = [
  "Content-Type",
  "application/x-www-form-urlencoded",
];

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

async function callTool(port: number, accessToken: string): Promise<number> {
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

describe("F-028 AC-12 CIMD rehearsal through the acceptance composition", () => {
  it("BR-305 BR-306 BR-311 BR-393 discovery, consent, tokens, tool calls and a refresh after restart", async () => {
    directory = await mkdtemp(join(tmpdir(), "kdrive-cimd-rehearsal-"));
    const pem = syntheticPem();
    await writeFile(join(directory, "upstream-secret"), "SYNTHETIC-SECRET\n");
    await writeFile(join(directory, "signing.pem"), pem);
    const statePath = join(directory, "state.db");
    const port = await listeningPort();

    // The CIMD client double: one document, counted per GET.
    let served = 0;
    let documentUrl = "";
    double = await startDocumentServer((request, response) => {
      served += 1;
      if (request.url !== "/client.json") {
        reply(response, 404, "{}");
        return;
      }
      reply(response, 200, JSON.stringify(cimdDocument(documentUrl)));
    });
    const doubleOrigin = `https://${REHEARSAL_HOST}:${String(double.port)}`;
    documentUrl = `${doubleOrigin}/client.json`;
    dns = await startDnsStub({ host: REHEARSAL_HOST, a: "127.0.0.1" });
    const seam = {
      dnsServers: [`127.0.0.1:${String(dns.port)}`],
      ca: [cimdCertificates().ca],
      addressPolicy: {
        allows: (address: string) =>
          address === "127.0.0.1" || productionAddressPolicy.allows(address),
      },
    };
    const upstream = new FakeUpstream();
    const idKey = await upstreamKey();
    upstream.jwks = { keys: [idKey.jwk] };
    const env = (origins: string) => ({
      MCP_PUBLIC_URL: P,
      MCP_HTTP_PORT: String(port),
      OAUTH_ISSUER: UPSTREAM,
      OAUTH_ALLOWED_SUBJECTS: "user-1",
      OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
      OAUTH_UPSTREAM_CLIENT_SECRET_FILE: join(directory, "upstream-secret"),
      OAUTH_SIGNING_KEY_FILE: join(directory, "signing.pem"),
      OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
      OAUTH_STATE_FILE: statePath,
      OAUTH_ALLOWED_CLIENT_ID_ORIGINS: origins,
    });
    const start = (origins: string) =>
      startAcceptance({
        env: env(origins),
        cwd: directory,
        upstream,
        stderr: () => undefined,
        clientMetadataSeam: seam,
      });
    const verifier = `synthetic-cimd-rehearsal-${"r".repeat(30)}`;
    const authorizeTarget = `/mcp/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: documentUrl,
      redirect_uri: CLAUDE,
      state: "client-state",
      code_challenge: s256(verifier),
      code_challenge_method: "S256",
      resource: P,
    }).toString()}`;

    // Discovery: a placeholder origin advertises CIMD; the refused request's
    // address bar reveals the origin to list.
    const discovery = await start("https://cimd-discovery.invalid");
    let origin: string;
    try {
      const metadata = await call(
        port,
        "GET",
        "/.well-known/oauth-authorization-server/mcp",
      );
      expect(metadata.status).toBe(200);
      expect(
        (JSON.parse(metadata.body) as Record<string, unknown>)
          .client_id_metadata_document_supported,
      ).toBe(true);
      const refused = await call(port, "GET", authorizeTarget);
      expect(refused.status).toBe(400);
      const addressBar = new URL(`https://${HOST}${authorizeTarget}`);
      origin = new URL(addressBar.searchParams.get("client_id") ?? "").origin;
      expect(origin).toBe(doubleOrigin);
      expect(served).toBe(0);
    } finally {
      await discovery.close();
    }

    // The real origin: consent, upstream login, code, tokens, a tool call.
    const first = await start(origin);
    let refreshToken: string;
    try {
      const page = await call(port, "GET", authorizeTarget);
      expect(page.status).toBe(200);
      expect(page.body).toContain(`Client host: ${REHEARSAL_HOST}`);
      expect(served).toBe(1);
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
      const login = new URL(rawHeader(approved, "location") ?? "");
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
            nonce: login.searchParams.get("nonce") ?? "",
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
          state: login.searchParams.get("state") ?? "",
        }).toString()}`,
        [["Cookie", cookie]],
      );
      expect(callback.status).toBe(302);
      const code =
        new URL(rawHeader(callback, "location") ?? "").searchParams.get(
          "code",
        ) ?? "";
      const tokens = await call(
        port,
        "POST",
        "/mcp/oauth/token",
        [FORM],
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CLAUDE,
          code_verifier: verifier,
          client_id: documentUrl,
        }).toString(),
      );
      expect(tokens.status).toBe(200);
      const issued = JSON.parse(tokens.body) as Record<string, string>;
      refreshToken = issued.refresh_token ?? "";
      expect(refreshToken).not.toBe("");
      expect(await callTool(port, issued.access_token ?? "")).toBe(200);
    } finally {
      await first.close();
    }

    // Restart on the same file: the refresh needs no fetch.
    const second = await start(origin);
    try {
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
      const body = JSON.parse(refreshed.body) as Record<string, string>;
      expect(await callTool(port, body.access_token ?? "")).toBe(200);
    } finally {
      await second.close();
    }
    // One document fetch within the freshness window, none for the refresh.
    expect(served).toBe(1);
    expect(dns.received.length).toBeGreaterThan(0);
  }, 30_000);
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSigningKey, signAccessToken } from "../../src/auth/proxy/keys.js";
import {
  INLINE_SECRET_REFUSED,
  acceptanceSettings,
  startAcceptance,
} from "../../scripts/http-acceptance.ts";
import {
  CLAUDE,
  FakeUpstream,
  UPSTREAM,
  UPSTREAM_CLIENT,
  syntheticPem,
} from "../helpers/proxy.js";
import {
  HOST,
  INITIALIZE,
  P,
  RawClient,
  jsonRpc,
  listeningPort,
  rawHeader,
  rawText,
} from "../helpers/http.js";

let directory = "";
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

const SECRET = "SYNTHETIC-ACCEPTANCE-SECRET";

async function environment(extra: Record<string, string> = {}) {
  directory = await mkdtemp(join(tmpdir(), "kdrive-acceptance-"));
  const pem = syntheticPem();
  await writeFile(join(directory, "upstream-secret"), `${SECRET}\n`);
  await writeFile(join(directory, "signing.pem"), pem);
  const port = await listeningPort();
  return {
    pem,
    port,
    env: {
      MCP_PUBLIC_URL: P,
      MCP_HTTP_PORT: String(port),
      OAUTH_ISSUER: UPSTREAM,
      OAUTH_ALLOWED_SUBJECTS: "user-1",
      OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
      OAUTH_UPSTREAM_CLIENT_SECRET_FILE: join(directory, "upstream-secret"),
      OAUTH_SIGNING_KEY_FILE: join(directory, "signing.pem"),
      OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
      ...extra,
    },
  };
}

describe("BR-171 acceptance composition", () => {
  it("BR-171 AC-23 serves initialize and tools/list over a synthetic drive without global fetch", async () => {
    const { env, pem, port } = await environment();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const lines: string[] = [];
    const started = await startAcceptance({
      env,
      cwd: directory,
      upstream: new FakeUpstream(),
      stderr: (line) => lines.push(line),
    });
    try {
      const iat = Math.floor(Date.now() / 1000);
      const token = await signAccessToken(
        loadSigningKey(new TextEncoder().encode(pem)),
        {
          iss: P,
          sub: "user-1",
          upstream_iss: UPSTREAM,
          aud: P,
          iat,
          exp: iat + 600,
        },
      );
      const client = await RawClient.connect(port);
      const send = (body: string, session?: string) => {
        client.write(
          rawText({
            method: "POST",
            target: "/mcp",
            headers: [
              ["Host", HOST],
              ["Authorization", `Bearer ${token}`],
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
      send(INITIALIZE);
      const init = await client.next();
      expect(init?.status).toBe(200);
      const session = rawHeader(init!, "mcp-session-id")!;
      send(jsonRpc("notifications/initialized", undefined), session);
      await client.next();
      send(jsonRpc("tools/list", 2), session);
      const list = await client.next();
      expect(list?.body).toContain("kdrive_list_drives");
      send(
        jsonRpc("tools/call", 3, { name: "kdrive_list_drives", arguments: {} }),
        session,
      );
      expect((await client.next())?.status).toBe(200);
      client.destroy();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await started.close();
    }
    const events = lines.map((line) => JSON.parse(line) as { event: string });
    expect(events.length).toBeGreaterThan(0);
    const allowed = new Set([
      "request_refused",
      "session_opened",
      "session_closed",
      "registration_refused",
      "authorization_refused",
      "consent_refused",
      "upstream_unavailable",
      "callback_refused",
      "id_token_refused",
      "identity_refused",
      "token_refused",
      "refresh_family_revoked",
      "store_full",
    ]);
    for (const entry of events) expect(allowed.has(entry.event)).toBe(true);
    expect(events.map((e) => e.event)).toContain("session_opened");
    expect(lines.join("")).not.toContain(SECRET);
  });

  it("BR-171 AC-23 refuses an inline upstream client secret with a fixed message", async () => {
    const { env } = await environment({
      OAUTH_UPSTREAM_CLIENT_SECRET: "INLINE-CANARY",
    });
    const refusal = await startAcceptance({
      env: { ...env, OAUTH_UPSTREAM_CLIENT_SECRET_FILE: undefined },
      cwd: directory,
      upstream: new FakeUpstream(),
      stderr: () => undefined,
    }).catch((error: unknown) => error as Error);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe(INLINE_SECRET_REFUSED);
    expect((refusal as Error).message).not.toContain("INLINE-CANARY");
  });

  it("BR-171 v2 AC-23 publishes the port on the host loopback only and lists the target", () => {
    const makefile = readFileSync("Makefile", "utf8");
    const recipe =
      /^http-acceptance:[^\n]*\n((?:\t[^\n]*\n?)+)/mu.exec(makefile)?.[1] ?? "";
    // v2 clause: the recipe only calls the entry script, which holds the run.
    expect(recipe).toContain("scripts/http-acceptance-entry.sh");
    expect(recipe).not.toContain("$(COMPOSE) run");
    const entry = readFileSync("scripts/http-acceptance-entry.sh", "utf8");
    const publish = [
      ...entry.matchAll(/(?:--publish|-p)[ =]"?([^\s\\"]+)/gu),
    ].map((m) => m[1]!);
    expect(publish.length).toBeGreaterThan(0);
    for (const value of publish)
      expect(value.startsWith("127.0.0.1:")).toBe(true);
    expect(makefile).toContain("'  make http-acceptance  ");
    const start = makefile.indexOf(".PHONY:");
    const phony = makefile.slice(start, makefile.indexOf("\n\n", start));
    expect(phony.split(/[\s\\]+/u)).toContain("http-acceptance");
  });

  it("BR-171 AC-23 keeps the composition out of the package and the build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      files: string[];
    };
    expect(pkg.files).toEqual(["dist/", "LICENSE", "NOTICE", "README.md"]);
    const build = JSON.parse(readFileSync("tsconfig.build.json", "utf8")) as {
      include: string[];
    };
    expect(build.include).toEqual(["src/**/*.ts"]);
    const script = readFileSync("scripts/http-acceptance.ts", "utf8");
    expect(script).not.toMatch(/KDRIVE_TOKEN_FILE|process\.env\.KDRIVE_TOKEN/u);
  });

  it("BR-396 AC-01 forwards exactly the BR-171 settings and OAUTH_STATE_FILE", () => {
    const names = [
      "MCP_PUBLIC_URL",
      "MCP_HTTP_HOST",
      "MCP_HTTP_PORT",
      "OAUTH_ISSUER",
      "OAUTH_ALLOWED_SUBJECTS",
      "OAUTH_ALLOWED_EMAILS",
      "OAUTH_UPSTREAM_CLIENT_ID",
      "OAUTH_UPSTREAM_CLIENT_SECRET",
      "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
      "OAUTH_SIGNING_KEY_FILE",
      "OAUTH_ALLOWED_REDIRECT_URIS",
      "OAUTH_ALLOWED_CLIENT_ID_ORIGINS",
    ];
    const settings = Object.fromEntries(
      names.map((name) => [name, `value-of-${name}`]),
    );
    const others = {
      KDRIVE_TOKEN: "SYNTHETIC-TOKEN",
      OAUTH_MODE: "proxy",
      HOME: "/home/synthetic",
    };
    expect(
      acceptanceSettings({ ...settings, OAUTH_STATE_FILE: "", ...others }),
    ).toStrictEqual(settings);
    expect(
      acceptanceSettings({
        ...settings,
        OAUTH_STATE_FILE: "/run/oauth-state/oauth-state.sqlite",
        ...others,
      }),
    ).toStrictEqual({
      ...settings,
      OAUTH_STATE_FILE: "/run/oauth-state/oauth-state.sqlite",
    });
    expect(acceptanceSettings({ ...others, MCP_PUBLIC_URL: "" })).toStrictEqual(
      {},
    );
    const source = readFileSync("scripts/http-acceptance.ts", "utf8");
    const main = source.slice(source.indexOf("async function main("));
    expect(main).toContain(
      "startAcceptance({ env: acceptanceSettings(process.env) })",
    );
    expect(main.match(/startAcceptance\(/gu)).toHaveLength(1);
  });
});

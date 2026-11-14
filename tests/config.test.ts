import { mkdtemp, writeFile, symlink, mkdir, chmod } from "node:fs/promises";
import fs from "node:fs/promises";
import { readBoundedFile } from "../src/config-files.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfiguration, ConfigurationError } from "../src/config.js";

const base = { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC_TOKEN" };
const http = {
  KDRIVE_MCP_TRANSPORT: "http",
  MCP_PUBLIC_URL: "https://service.example/mcp",
  OAUTH_MODE: "delegate",
  OAUTH_ISSUER: "https://issuer.example",
  OAUTH_ALLOWED_SUBJECTS: "subject",
};
const proxy = {
  ...http,
  OAUTH_MODE: "proxy",
  OAUTH_UPSTREAM_CLIENT_ID: "client",
  OAUTH_UPSTREAM_CLIENT_SECRET: "SYNTHETIC_UPSTREAM",
  OAUTH_SIGNING_KEY_FILE: "/synthetic/key",
  OAUTH_ALLOWED_REDIRECT_URIS: "https://client.example/callback",
};
const bytes = (text: string) => Buffer.from(text);
function load(
  env: Record<string, string> = {},
  argv: string[] = [],
  yaml?: string,
) {
  return loadConfiguration({
    argv,
    env: { ...base, ...env },
    cwd: "/work",
    readFile: async (path) =>
      await Promise.resolve(
        bytes(
          path === "/work/settings.yaml" ? (yaml ?? "{}") : "SYNTHETIC_FILE",
        ),
      ),
  });
}
function error(code: string, setting: string) {
  return { code, setting };
}
afterEach(() => vi.restoreAllMocks());

describe("BR-017 BR-018 inventory and source precedence", () => {
  // Every one of the 34 inventory rows is represented, including both secret pairs.
  const rows = [
    ["transport", "KDRIVE_MCP_TRANSPORT", "--http", "http", "http"],
    ["token", "KDRIVE_TOKEN", "", "SYNTHETIC_INLINE", "SYNTHETIC_INLINE"],
    [
      "tokenFile",
      "KDRIVE_TOKEN_FILE",
      "--token-file",
      "/synthetic/token",
      "/synthetic/token",
    ],
    ["driveId", "KDRIVE_ID", "--drive-id", "7", 7],
    ["driveIds", "KDRIVE_IDS", "--drive-ids", "7,8", [7, 8]],
    ["mode", "KDRIVE_MCP_MODE", "--mode", "share", "share"],
    [
      "roots",
      "KDRIVE_MCP_ROOTS",
      "--roots",
      "7:42",
      [{ driveId: 7, kind: "id", value: 42 }],
    ],
    [
      "deny",
      "KDRIVE_MCP_DENY",
      "--deny",
      "/private,**/tmp",
      ["/private", "**/tmp"],
    ],
    ["maxTreeItems", "KDRIVE_MCP_MAX_TREE_ITEMS", "--max-tree-items", "23", 23],
    [
      "sharedWithMe",
      "KDRIVE_MCP_SHARED_WITH_ME",
      "--shared-with-me",
      "1",
      true,
    ],
    ["sharedWrite", "KDRIVE_MCP_SHARED_WRITE", "--shared-write", "1", true],
    ["maxReadBytes", "KDRIVE_MCP_MAX_READ_BYTES", "--max-read-bytes", "21", 21],
    [
      "maxExtractBytes",
      "KDRIVE_MCP_MAX_EXTRACT_BYTES",
      "--max-extract-bytes",
      "22",
      22,
    ],
    [
      "extractTimeoutMs",
      "KDRIVE_MCP_EXTRACT_TIMEOUT_MS",
      "--extract-timeout-ms",
      "24",
      24,
    ],
    [
      "maxOutputChars",
      "KDRIVE_MCP_MAX_OUTPUT_CHARS",
      "--max-output-chars",
      "25",
      25,
    ],
    [
      "auditLog",
      "KDRIVE_MCP_AUDIT_LOG",
      "--audit-log",
      "audit.log",
      "/work/audit.log",
    ],
    [
      "allowPublicLinks",
      "KDRIVE_MCP_ALLOW_PUBLIC_LINKS",
      "--allow-public-links",
      "1",
      true,
    ],
    [
      "inviteDomains",
      "KDRIVE_MCP_INVITE_DOMAINS",
      "--invite-domains",
      "Example.COM",
      ["example.com"],
    ],
    ["httpHost", "MCP_HTTP_HOST", "--host", "localhost", "localhost"],
    ["httpPort", "MCP_HTTP_PORT", "--port", "8443", 8443],
    [
      "publicUrl",
      "MCP_PUBLIC_URL",
      "--public-url",
      "https://service.example/mcp/",
      "https://service.example/mcp",
    ],
    [
      "insecureNoAuth",
      "KDRIVE_MCP_INSECURE_NO_AUTH",
      "--insecure-no-auth",
      "0",
      false,
    ],
    ["oauthMode", "OAUTH_MODE", "--oauth-mode", "proxy", "proxy"],
    [
      "oauthIssuer",
      "OAUTH_ISSUER",
      "--oauth-issuer",
      "https://issuer.example/",
      "https://issuer.example",
    ],
    [
      "oauthAudience",
      "OAUTH_AUDIENCE",
      "--oauth-audience",
      "https://service.example/mcp/",
      "https://service.example/mcp",
    ],
    [
      "oauthAllowedSubjects",
      "OAUTH_ALLOWED_SUBJECTS",
      "--oauth-allowed-subjects",
      "Subject",
      ["Subject"],
    ],
    [
      "oauthAllowedEmails",
      "OAUTH_ALLOWED_EMAILS",
      "--oauth-allowed-emails",
      "User@Example.COM",
      ["User@example.com"],
    ],
    [
      "oauthUpstreamClientId",
      "OAUTH_UPSTREAM_CLIENT_ID",
      "--oauth-upstream-client-id",
      "client",
      "client",
    ],
    [
      "oauthUpstreamClientSecret",
      "OAUTH_UPSTREAM_CLIENT_SECRET",
      "",
      "SYNTHETIC_UPSTREAM",
      "SYNTHETIC_UPSTREAM",
    ],
    [
      "oauthUpstreamClientSecretFile",
      "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
      "--oauth-upstream-client-secret-file",
      "/synthetic/secret",
      "/synthetic/secret",
    ],
    [
      "oauthSigningKeyFile",
      "OAUTH_SIGNING_KEY_FILE",
      "--oauth-signing-key-file",
      "/synthetic/key",
      "/synthetic/key",
    ],
    [
      "oauthAllowedRedirectUris",
      "OAUTH_ALLOWED_REDIRECT_URIS",
      "--oauth-allowed-redirect-uris",
      "https://client.example/callback?q=1",
      ["https://client.example/callback?q=1"],
    ],
    // F-019 BR-290: resolved against the working directory like auditLog.
    [
      "oauthStateFile",
      "OAUTH_STATE_FILE",
      "--oauth-state-file",
      "state/oauth.sqlite",
      "/work/state/oauth.sqlite",
    ],
    // F-028 BR-291: the CIMD origin list.
    [
      "oauthAllowedClientIdOrigins",
      "OAUTH_ALLOWED_CLIENT_ID_ORIGINS",
      "--oauth-allowed-client-id-origins",
      "https://client.example.com,https://other.example.org:8443",
      ["https://client.example.com", "https://other.example.org:8443"],
    ],
  ] as const;
  it.each(rows)(
    "normalizes inventory %s from every supported source",
    async (key, name, cli, raw, expected) => {
      const env: Record<string, string> = { ...base, ...proxy };
      if (key === "tokenFile") delete env.KDRIVE_TOKEN;
      if (key === "oauthUpstreamClientSecretFile")
        delete env.OAUTH_UPSTREAM_CLIENT_SECRET;
      const reader = async () => await Promise.resolve(bytes("SYNTHETIC_FILE"));
      const result = await loadConfiguration({
        env: { ...env, [name]: raw },
        argv: [],
        cwd: "/work",
        readFile: reader,
      });
      expect(result[key]).toEqual(expected);
      if (!cli) return;
      const cliArgs = key === "transport" ? [cli] : [`${cli}=${raw}`];
      const cliResult = await loadConfiguration({
        env: { ...env, [name]: "invalid ignored" },
        argv: cliArgs,
        cwd: "/work",
        readFile: reader,
      });
      expect(cliResult[key]).toEqual(expected);
      delete env[name];
      const yamlValue =
        typeof expected === "boolean"
          ? expected
          : Array.isArray(expected)
            ? raw.split(",")
            : raw;
      const yamlResult = await loadConfiguration({
        env,
        argv: ["--config", "settings.yaml"],
        cwd: "/work",
        readFile: async (path) =>
          await Promise.resolve(
            path === "/work/settings.yaml"
              ? bytes(`${key}: ${JSON.stringify(yamlValue)}\n`)
              : bytes("SYNTHETIC_FILE"),
          ),
      });
      expect(yamlResult[key]).toEqual(expected);
    },
  );
  it("replaces whole lists and atomically selects credential sources without reading losers", async () => {
    const readFile = vi.fn(
      async (path: string) =>
        await Promise.resolve(
          bytes(
            path === "/work/settings.yaml"
              ? "tokenFile: /ignored\ndeny: [/old]\n"
              : "SYNTHETIC_CLI\n",
          ),
        ),
    );
    const config = await loadConfiguration({
      argv: [
        "--config",
        "settings.yaml",
        "--token-file",
        "/chosen",
        "--deny",
        "",
      ],
      env: {
        ...base,
        KDRIVE_TOKEN_FILE: "/ignored-env",
        KDRIVE_MCP_DENY: "/env",
      },
      cwd: "/work",
      readFile,
    });
    expect(config.token).toBe("SYNTHETIC_CLI");
    expect(config.deny).toEqual([]);
    expect(readFile.mock.calls.map((c) => c[0])).toEqual([
      "/work/settings.yaml",
      "/chosen",
    ]);
    await expect(load({ KDRIVE_TOKEN_FILE: "" })).rejects.toMatchObject(
      error("CONFLICTING_SETTINGS", "token"),
    );
    await expect(
      load({ KDRIVE_MCP_MODE: "" }, [], "mode: read"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "mode"));
  });
  it.each([
    [["--token", "CANARY"], "UNKNOWN_OPTION", "cli"],
    [["positional"], "UNKNOWN_OPTION", "cli"],
    [["--"], "UNKNOWN_OPTION", "cli"],
    [["--mode", "read", "--mode", "share"], "DUPLICATE_OPTION", "cli"],
    [["--http", "--http"], "DUPLICATE_OPTION", "cli"],
    [["--http", "--stdio"], "CONFLICTING_SETTINGS", "transport"],
    [["--http=1"], "INVALID_VALUE", "transport"],
    [["--mode"], "INVALID_VALUE", "mode"],
    [["--config"], "INVALID_VALUE", "configFile"],
    [["--mode", "--roots", "7:1"], "INVALID_VALUE", "mode"],
    [["--mode", "-bad"], "INVALID_VALUE", "mode"],
    [["--help", "--version"], "INVALID_VALUE", "cli"],
    [["--help", "--unknown"], "INVALID_VALUE", "cli"],
    [["--mode="], "INVALID_VALUE", "mode"],
    [Array.from({ length: 129 }, () => "x"), "LIMIT_EXCEEDED", "cli"],
    [["x".repeat(65537)], "UNKNOWN_OPTION", "cli"],
    [["--mode=" + "x".repeat(65537)], "LIMIT_EXCEEDED", "mode"],
  ])("maps CLI structure case %#", async (argv, code, setting) => {
    await expect(load({}, argv)).rejects.toMatchObject(error(code, setting));
  });
  it("checks structures before winning values and reads no implicit files", async () => {
    const reader = vi.fn(async () => await Promise.resolve(bytes("{}")));
    await loadConfiguration({
      env: base,
      argv: [],
      cwd: "/work",
      readFile: reader,
    });
    expect(reader).not.toHaveBeenCalled();
    await expect(
      load({ KDRIVE_UNKNOWN: "CANARY", KDRIVE_MCP_MODE: "x" }, ["--bad"]),
    ).rejects.toMatchObject(error("UNKNOWN_OPTION", "cli"));
    await expect(
      load({ OAUTH_UNKNOWN: "CANARY", KDRIVE_MCP_MODE: "x" }),
    ).rejects.toMatchObject(error("UNKNOWN_SETTING", "environment"));
    await expect(
      load({ KDRIVE_MCP_MODE: "x".repeat(65537) }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "mode"));
    await expect(
      load({}, ["--config", "settings.yaml"], "mode: []\n"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "mode"));
  });
  it.each([
    "",
    "null",
    "[]",
    "mode: read\nmode: share",
    "mode: !custom read",
    "mode: &a read",
    "mode: *a",
    "<<: {}",
    "mode: {nested: value}",
    "? [a,b]\n: x",
    "1: value",
    "mode: null",
    "---\nmode: read\n---\nmode: share",
    "mode: [unfinished",
  ])("rejects forbidden YAML structure %s", async (yaml) => {
    await expect(
      load({}, ["--config", "settings.yaml", "--mode", "read"], yaml),
    ).rejects.toMatchObject(error("CONFIG_SYNTAX", "configFile"));
  });
  it("orders YAML structural, unknown-key and primitive failures and bounds bytes", async () => {
    await expect(
      load({}, ["--config", "settings.yaml"], "unknown: x\nmode: {}\n"),
    ).rejects.toMatchObject(error("CONFIG_SYNTAX", "configFile"));
    await expect(
      load({}, ["--config", "settings.yaml"], "unknown: x\nmode: []\n"),
    ).rejects.toMatchObject(error("UNKNOWN_SETTING", "configFile"));
    await expect(
      load({}, ["--config", "settings.yaml"], "token: CANARY"),
    ).rejects.toMatchObject(error("UNKNOWN_SETTING", "configFile"));
    await expect(
      load({}, ["--config", "settings.yaml"], "sharedWrite: 1"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "sharedWrite"));
    await expect(
      load({}, ["--config", "settings.yaml"], "driveIds: [true]"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "driveIds"));
    await expect(
      load({}, ["--config", "settings.yaml"], "#".repeat(65537)),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "configFile"));
    await expect(
      loadConfiguration({
        env: base,
        argv: ["--config", "/x"],
        readFile: async () => await Promise.resolve(Buffer.from([0xff])),
      }),
    ).rejects.toMatchObject(error("CONFIG_SYNTAX", "configFile"));
    await expect(
      loadConfiguration({
        env: base,
        argv: ["--config", "/x"],
        readFile: async () => {
          await Promise.resolve();
          throw new Error("CANARY path");
        },
      }),
    ).rejects.toMatchObject(error("CONFIG_READ_FAILED", "configFile"));
  });
});

describe("BR-019 BR-020 drive and root boundaries", () => {
  it("derives defaults while retaining exact allowlists", async () => {
    const singleton = await load();
    expect(singleton.driveIds).toEqual([7]);
    expect(singleton.roots).toEqual([{ driveId: 7, kind: "id", value: 1 }]);
    const list = await loadConfiguration({
      env: { KDRIVE_IDS: "08,7", KDRIVE_TOKEN: "SYNTHETIC" },
      argv: [],
    });
    expect(list.driveId).toBe(8);
    expect(list.driveIds).toEqual([8, 7]);
    await expect(
      loadConfiguration({ env: { KDRIVE_TOKEN: "SYNTHETIC" }, argv: [] }),
    ).rejects.toMatchObject(error("MISSING_REQUIRED", "driveIds"));
    await expect(load({ KDRIVE_IDS: "8,9" })).rejects.toMatchObject(
      error("CONFLICTING_SETTINGS", "driveId"),
    );
    expect(
      (await load({ KDRIVE_IDS: "7,8", KDRIVE_MCP_ROOTS: "8:/Folder,7:042" }))
        .roots,
    ).toEqual([
      { driveId: 8, kind: "path", value: "/Folder" },
      { driveId: 7, kind: "id", value: 42 },
    ]);
  });
  it.each(["0", "-1", "1.1", "9007199254740992", " 7", "+7", "1e2", "NaN", ""])(
    "rejects ID %s",
    async (raw) => {
      await expect(load({ KDRIVE_ID: raw })).rejects.toMatchObject(
        error("INVALID_VALUE", "driveId"),
      );
    },
  );
  it.each([
    [{ KDRIVE_IDS: "7,07" }, "INVALID_VALUE", "driveIds"],
    [
      {
        KDRIVE_IDS: Array.from({ length: 65 }, (_, i) => String(i + 1)).join(
          ",",
        ),
      },
      "LIMIT_EXCEEDED",
      "driveIds",
    ],
    [{ KDRIVE_MCP_ROOTS: "" }, "INVALID_VALUE", "roots"],
    [
      { KDRIVE_IDS: "7,8", KDRIVE_MCP_ROOTS: "7:1" },
      "MISSING_REQUIRED",
      "roots",
    ],
    [
      { KDRIVE_IDS: "7,8", KDRIVE_MCP_ROOTS: "9:1" },
      "DRIVE_NOT_ALLOWED",
      "roots",
    ],
    [{ KDRIVE_MCP_ROOTS: "7:1,07:01" }, "INVALID_VALUE", "roots"],
    ...[
      "relative",
      "/a/",
      "/a//b",
      "/a/../b",
      "/./b",
      "/a\\b",
      "/a\nb",
      "/a,b",
    ].map(
      (path) =>
        [{ KDRIVE_MCP_ROOTS: `7:${path}` }, "INVALID_VALUE", "roots"] as const,
    ),
  ] as const)("rejects root/drive case %j", async (env, code, setting) => {
    await expect(load(env)).rejects.toMatchObject(error(code, setting));
  });
  it("preserves literal YAML paths and allows explicit whole roots", async () => {
    const config = await load(
      {},
      ["--config", "settings.yaml"],
      'roots: ["7:/A, B/%20/é", "7:/"]',
    );
    expect(config.roots.map((r) => r.value)).toEqual(["/A, B/%20/é", "/"]);
    expect((await load({ KDRIVE_ID: "9007199254740991" })).driveId).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe("BR-022 BR-023 values and resource limits", () => {
  for (const mode of ["read", "write", "share"])
    for (const sharedWithMe of [false, true])
      for (const sharedWrite of [false, true])
        for (const allowPublicLinks of [false, true]) {
          it(`switch truth table ${mode}/${sharedWithMe}/${sharedWrite}/${allowPublicLinks}`, async () => {
            const c = await load({
              KDRIVE_MCP_MODE: mode,
              KDRIVE_MCP_SHARED_WITH_ME: sharedWithMe ? "1" : "0",
              KDRIVE_MCP_SHARED_WRITE: sharedWrite ? "1" : "0",
              KDRIVE_MCP_ALLOW_PUBLIC_LINKS: allowPublicLinks ? "1" : "0",
            });
            expect(c.effectiveSharedWrite).toBe(
              sharedWithMe && sharedWrite && mode !== "read",
            );
            expect(c.effectivePublicLinks).toBe(
              allowPublicLinks && mode === "share",
            );
          });
        }
  const bounds = [
    ["KDRIVE_MCP_MAX_TREE_ITEMS", "maxTreeItems", 1000000, 10000],
    ["KDRIVE_MCP_MAX_READ_BYTES", "maxReadBytes", 1073741824, 5000000],
    ["KDRIVE_MCP_MAX_EXTRACT_BYTES", "maxExtractBytes", 1073741824, 50000000],
    ["KDRIVE_MCP_EXTRACT_TIMEOUT_MS", "extractTimeoutMs", 300000, 20000],
    ["KDRIVE_MCP_MAX_OUTPUT_CHARS", "maxOutputChars", 10000000, 200000],
    ["MCP_HTTP_PORT", "httpPort", 65535, 3000],
  ] as const;
  it.each(bounds)("scalar bounds %s", async (name, key, max, def) => {
    expect((await load(http))[key]).toBe(def);
    for (const value of [1, max])
      expect((await load({ ...http, [name]: String(value) }))[key]).toBe(value);
    for (const value of ["0", String(max + 1), "-1", "1.5", " 1", "1e2"])
      await expect(load({ ...http, [name]: value })).rejects.toMatchObject(
        error("INVALID_VALUE", key),
      );
  });
  it("keeps independent byte limits and resolves audit without opening it", async () => {
    expect(
      (
        await load({
          KDRIVE_MCP_MAX_READ_BYTES: "999",
          KDRIVE_MCP_MAX_EXTRACT_BYTES: "1",
        })
      ).maxExtractBytes,
    ).toBe(1);
    const reader = vi.fn(async () => await Promise.resolve(bytes("SYNTHETIC")));
    const config = await loadConfiguration({
      env: { ...base, KDRIVE_MCP_AUDIT_LOG: "relative.log" },
      argv: [],
      cwd: "/work",
      readFile: reader,
    });
    expect(config.auditLog).toBe("/work/relative.log");
    expect(reader).not.toHaveBeenCalled();
  });
  it.each([
    ["KDRIVE_MCP_SHARED_WRITE", "true", "sharedWrite"],
    ["KDRIVE_MCP_MODE", "READ", "mode"],
    ["KDRIVE_MCP_INVITE_DOMAINS", "*.example.com", "inviteDomains"],
    ["KDRIVE_MCP_INVITE_DOMAINS", "example.com,EXAMPLE.COM", "inviteDomains"],
    ["KDRIVE_MCP_INVITE_DOMAINS", "localhost", "inviteDomains"],
    ["KDRIVE_MCP_INVITE_DOMAINS", "a..com", "inviteDomains"],
    ["KDRIVE_MCP_INVITE_DOMAINS", "-x.com", "inviteDomains"],
    ["KDRIVE_MCP_DENY", "/a/**b", "deny"],
    ["KDRIVE_MCP_DENY", "/a//b", "deny"],
    ["KDRIVE_MCP_DENY", "/a/[b]", "deny"],
    ["KDRIVE_MCP_DENY", "relative", "deny"],
    ["KDRIVE_MCP_DENY", "/a,", "deny"],
    ["OAUTH_ALLOWED_SUBJECTS", "a,,b", "oauthAllowedSubjects"],
    ["OAUTH_ALLOWED_EMAILS", "a..b@example.com", "oauthAllowedEmails"],
    ["OAUTH_ALLOWED_EMAILS", "*@example.com", "oauthAllowedEmails"],
    [
      "OAUTH_ALLOWED_EMAILS",
      "a@EXAMPLE.COM,a@example.com",
      "oauthAllowedEmails",
    ],
    ["MCP_HTTP_HOST", "host:80", "httpHost"],
    ["MCP_HTTP_HOST", "[::1]", "httpHost"],
    ["KDRIVE_MCP_AUDIT_LOG", "", "auditLog"],
  ])("rejects malformed %s %s", async (name, value, key) => {
    await expect(load({ ...http, [name]: value })).rejects.toMatchObject(
      error("INVALID_VALUE", key),
    );
  });
  it("normalizes only domain portions and retains exact subjects/globs", async () => {
    const c = await load({
      ...http,
      OAUTH_ALLOWED_SUBJECTS: "Subject,subject",
      OAUTH_ALLOWED_EMAILS: "User@Example.COM,user@example.com",
      KDRIVE_MCP_INVITE_DOMAINS: "Example.COM,sub.example.com",
      KDRIVE_MCP_DENY: "/,**/a?,/b/**/c*",
    });
    expect(c.oauthAllowedEmails).toEqual([
      "User@example.com",
      "user@example.com",
    ]);
    expect(c.oauthAllowedSubjects).toEqual(["Subject", "subject"]);
    expect(c.inviteDomains).toEqual(["example.com", "sub.example.com"]);
  });
  it.each([
    ["KDRIVE_MCP_DENY", "/" + "x".repeat(1024), "deny"],
    ["KDRIVE_MCP_ROOTS", "7:/" + "x".repeat(4096), "roots"],
    ["KDRIVE_MCP_AUDIT_LOG", "x".repeat(4097), "auditLog"],
    ["OAUTH_ALLOWED_SUBJECTS", "x".repeat(1025), "oauthAllowedSubjects"],
    ["OAUTH_UPSTREAM_CLIENT_ID", "x".repeat(1025), "oauthUpstreamClientId"],
    ["MCP_PUBLIC_URL", "https://example.com/" + "x".repeat(4096), "publicUrl"],
    [
      "KDRIVE_MCP_INVITE_DOMAINS",
      Array.from({ length: 257 }, (_, i) => `d${i}.com`).join(","),
      "inviteDomains",
    ],
  ])("enforces bounded %s", async (name, value, key) => {
    await expect(load({ ...proxy, [name]: value })).rejects.toMatchObject(
      error("LIMIT_EXCEEDED", key),
    );
  });
});

describe("BR-024 BR-025 v2 transport/auth matrix", () => {
  it.each(["delegate", "delegate-static", "proxy"])(
    "prepares %s without networking",
    async (mode) => {
      const c = await load(
        mode === "proxy" ? proxy : { ...http, OAUTH_MODE: mode },
      );
      expect(c.transport).toBe("http");
      expect(c.oauthAudience).toBe(http.MCP_PUBLIC_URL);
      expect(c.httpHost).toBe("127.0.0.1");
    },
  );
  it("forces insecure loopback and derives the exact origin", async () => {
    const c = await load({
      KDRIVE_MCP_TRANSPORT: "http",
      KDRIVE_MCP_INSECURE_NO_AUTH: "1",
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_PORT: "8080",
    });
    expect(c.httpHost).toBe("127.0.0.1");
    expect(c.publicUrl).toBe("http://127.0.0.1:8080");
    const b = await load({}, ["--http", "--insecure-no-auth"]);
    expect(b.insecureNoAuth).toBe(true);
  });
  it.each([
    "MCP_HTTP_HOST",
    "MCP_HTTP_PORT",
    "MCP_PUBLIC_URL",
    "KDRIVE_MCP_INSECURE_NO_AUTH",
    ...Object.keys(proxy).filter((k) => k.startsWith("OAUTH_")),
  ])("rejects explicit HTTP field %s in stdio", async (name) => {
    const values: Record<string, string> = {
      ...proxy,
      MCP_HTTP_HOST: "localhost",
      MCP_HTTP_PORT: "3000",
      KDRIVE_MCP_INSECURE_NO_AUTH: "0",
    };
    await expect(load({ [name]: values[name] ?? "x" })).rejects.toMatchObject({
      code: "CONFLICTING_SETTINGS",
    });
  });
  it.each([
    "OAUTH_MODE",
    "OAUTH_ISSUER",
    "OAUTH_ALLOWED_SUBJECTS",
    "OAUTH_ALLOWED_EMAILS",
    "OAUTH_AUDIENCE",
    "OAUTH_UPSTREAM_CLIENT_ID",
    "OAUTH_UPSTREAM_CLIENT_SECRET",
    "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
    "OAUTH_SIGNING_KEY_FILE",
    "OAUTH_ALLOWED_REDIRECT_URIS",
  ])("rejects %s in insecure HTTP", async (name) => {
    const values: Record<string, string> = {
      ...proxy,
      OAUTH_AUDIENCE: http.MCP_PUBLIC_URL,
      OAUTH_ALLOWED_EMAILS: "",
      OAUTH_UPSTREAM_CLIENT_SECRET_FILE: "/synthetic/secret",
    };
    await expect(
      load({
        KDRIVE_MCP_TRANSPORT: "http",
        KDRIVE_MCP_INSECURE_NO_AUTH: "1",
        [name]: values[name] ?? "x",
      }),
    ).rejects.toMatchObject({ code: "CONFLICTING_SETTINGS" });
  });
  it.each([
    "OAUTH_UPSTREAM_CLIENT_ID",
    "OAUTH_UPSTREAM_CLIENT_SECRET",
    "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
    "OAUTH_SIGNING_KEY_FILE",
    "OAUTH_ALLOWED_REDIRECT_URIS",
  ])("rejects proxy field %s with delegate", async (name) => {
    const values: Record<string, string> = {
      ...proxy,
      OAUTH_UPSTREAM_CLIENT_SECRET_FILE: "/synthetic/secret",
    };
    await expect(
      load({ ...http, [name]: values[name] ?? "x" }),
    ).rejects.toMatchObject({ code: "CONFLICTING_SETTINGS" });
  });
  it.each([
    ["MCP_PUBLIC_URL", "publicUrl"],
    ["OAUTH_MODE", "oauthMode"],
    ["OAUTH_ISSUER", "oauthIssuer"],
    ["OAUTH_ALLOWED_SUBJECTS", "oauthAllowedSubjects"],
    ["OAUTH_UPSTREAM_CLIENT_ID", "oauthUpstreamClientId"],
    ["OAUTH_UPSTREAM_CLIENT_SECRET", "oauthUpstreamClientSecret"],
    ["OAUTH_SIGNING_KEY_FILE", "oauthSigningKeyFile"],
    ["OAUTH_ALLOWED_REDIRECT_URIS", "oauthAllowedRedirectUris"],
  ])("requires proxy %s", async (name, key) => {
    const env: Record<string, string> = { ...proxy };
    delete env[name];
    await expect(load(env)).rejects.toMatchObject(
      error("MISSING_REQUIRED", key),
    );
  });
  it.each([
    [
      { ...http, OAUTH_AUDIENCE: "https://other.example" },
      "CONFLICTING_SETTINGS",
      "oauthAudience",
    ],
    [
      { ...proxy, OAUTH_ISSUER: http.MCP_PUBLIC_URL + "/" },
      "CONFLICTING_SETTINGS",
      "oauthIssuer",
    ],
    ...[
      "http://127.0.0.2:3000",
      "http://localhost:3000",
      "http://127.0.0.1:4000",
      "https://127.0.0.1:3000",
    ].map(
      (url) =>
        [
          {
            KDRIVE_MCP_TRANSPORT: "http",
            KDRIVE_MCP_INSECURE_NO_AUTH: "1",
            MCP_PUBLIC_URL: url,
          },
          "CONFLICTING_SETTINGS",
          "publicUrl",
        ] as const,
    ),
    ...[
      "http://service.example",
      "https://u:p@example.com",
      "https://example.com/?q=1",
      "https://example.com/#x",
      "/relative",
    ].map(
      (url) =>
        [
          { ...http, MCP_PUBLIC_URL: url },
          "INVALID_VALUE",
          "publicUrl",
        ] as const,
    ),
    ...[
      // BR-024 v2: other loopback spellings stay rejected.
      "http://127.1/cb",
      "http://LOCALHOST/cb",
      "http://localhost./cb",
      "https://*.example.com/cb",
      "https://example.com/cb#x",
    ].map(
      (url) =>
        [
          { ...proxy, OAUTH_ALLOWED_REDIRECT_URIS: url },
          "INVALID_VALUE",
          "oauthAllowedRedirectUris",
        ] as const,
    ),
  ] as const)("rejects unsafe auth case %j", async (env, code, setting) => {
    await expect(load(env)).rejects.toMatchObject(error(code, setting));
  });
  it("canonicalizes resource URLs and retains byte-exact redirect URIs", async () => {
    const c = await load({
      ...proxy,
      MCP_PUBLIC_URL: "https://SERVICE.example:443/mcp///",
      OAUTH_AUDIENCE: "https://service.example/mcp",
      OAUTH_ALLOWED_REDIRECT_URIS:
        "http://127.0.0.1:9876/cb?q=a%20b,http://[::1]/cb,https://Client.example:443/cb/",
    });
    expect(c.publicUrl).toBe(http.MCP_PUBLIC_URL);
    expect(c.oauthAllowedRedirectUris).toEqual([
      "http://127.0.0.1:9876/cb?q=a%20b",
      "http://[::1]/cb",
      "https://Client.example:443/cb/",
    ]);
  });
});

describe("BR-024 v2 localhost loopback redirect URIs", () => {
  it("BR-024 v2 retains lowercase localhost redirect URIs byte for byte", async () => {
    const c = await load({
      ...proxy,
      OAUTH_ALLOWED_REDIRECT_URIS:
        "http://localhost/cb,http://localhost:8765/callback",
    });
    expect(c.oauthAllowedRedirectUris).toEqual([
      "http://localhost/cb",
      "http://localhost:8765/callback",
    ]);
  });
});

describe("BR-026 BR-027 bounded credentials and redaction", () => {
  it.each([
    "",
    "SYNTHETIC\n",
    "SYNTHETIC\r",
    "SYNTHETIC\0",
    "SYNTHETIC\t",
    "SYNTHETIC\x7f",
  ])("rejects environment contents without interpolation %j", async (token) => {
    await expect(load({ KDRIVE_TOKEN: token })).rejects.toMatchObject(
      error("CREDENTIAL_INVALID", "token"),
    );
  });
  it("checks all configuration before any selected credential I/O", async () => {
    const readFile = vi.fn(
      async () => await Promise.resolve(bytes("SYNTHETIC")),
    );
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "0", KDRIVE_TOKEN_FILE: "/sensitive/CANARY" },
        argv: [],
        readFile,
      }),
    ).rejects.toMatchObject(error("INVALID_VALUE", "driveId"));
    expect(readFile).not.toHaveBeenCalled();
    await expect(
      loadConfiguration({ env: { KDRIVE_ID: "7" }, argv: [] }),
    ).rejects.toMatchObject(error("MISSING_REQUIRED", "token"));
    await expect(
      load({ KDRIVE_TOKEN: "x".repeat(16385) }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "token"));
    await expect(load({}, ["--token-file", "relative"])).rejects.toMatchObject(
      error("INVALID_VALUE", "tokenFile"),
    );
  });
  it.each([
    [bytes("SYNTHETIC\n"), "SYNTHETIC", undefined],
    [bytes("SYNTHETIC\r\n"), "SYNTHETIC", undefined],
    [bytes("SYNTHETIC\n\n"), undefined, "CREDENTIAL_INVALID"],
    [Buffer.from([0xff]), undefined, "CREDENTIAL_INVALID"],
    [bytes("x".repeat(16385)), undefined, "LIMIT_EXCEEDED"],
    [bytes(""), undefined, "CREDENTIAL_INVALID"],
  ])(
    "bounds and decodes selected credential file",
    async (content, expected, code) => {
      const operation = loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: "/sensitive/CANARY" },
        argv: [],
        readFile: async () => await Promise.resolve(content),
      });
      if (code)
        await expect(operation).rejects.toMatchObject(
          error(code, code === "LIMIT_EXCEEDED" ? "tokenFile" : "token"),
        );
      else expect((await operation).token).toBe(expected);
    },
  );
  it("sanitizes injected failures and keeps only stable diagnostic data", async () => {
    try {
      await loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: "/CANARY" },
        argv: [],
        readFile: async () => {
          await Promise.resolve();
          throw new Error("CANARY source excerpt");
        },
      });
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigurationError);
      expect(JSON.stringify(e)).toBe(
        '{"code":"CREDENTIAL_READ_FAILED","setting":"tokenFile"}',
      );
      expect(String(e)).not.toContain("CANARY");
    }
  });
  it("uses real regular-file/no-follow reads with allowed parent symlinks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-files-"));
    const file = join(dir, "token");
    await writeFile(file, "SYNTHETIC\r\n");
    expect(
      (
        await loadConfiguration({
          env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: file },
          argv: [],
        })
      ).token,
    ).toBe("SYNTHETIC");
    const link = join(dir, "link");
    await symlink(file, link);
    for (const path of [link, dir, join(dir, "missing")])
      await expect(
        loadConfiguration({
          env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: path },
          argv: [],
        }),
      ).rejects.toMatchObject(error("CREDENTIAL_READ_FAILED", "tokenFile"));
    await mkdir(join(dir, "real"));
    await writeFile(join(dir, "real", "token"), "SYNTHETIC");
    await symlink(join(dir, "real"), join(dir, "parent"));
    expect(
      (
        await loadConfiguration({
          env: {
            KDRIVE_ID: "7",
            KDRIVE_TOKEN_FILE: join(dir, "parent", "token"),
          },
          argv: [],
        })
      ).token,
    ).toBe("SYNTHETIC");
    await chmod(file, 0);
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: file },
        argv: [],
      }),
    ).rejects.toMatchObject(error("CREDENTIAL_READ_FAILED", "tokenFile"));
    await writeFile(join(dir, "large"), Buffer.alloc(16385));
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: join(dir, "large") },
        argv: [],
      }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "tokenFile"));
  });
  it("rejects replacement identity and growth with synthetic real descriptors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-races-"));
    const file = join(dir, "a");
    const other = join(dir, "b");
    await writeFile(file, "SYNTHETIC_A");
    await writeFile(other, "SYNTHETIC_B");
    const originalOpen = fs.open;
    vi.spyOn(fs, "open").mockImplementation(
      async () => await Promise.resolve(originalOpen(other, "r")),
    );
    await expect(readBoundedFile(file, 16384, true)).rejects.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(fs, "open").mockImplementation(async (path, flags) => {
      const handle = await originalOpen(path, flags);
      await writeFile(file, Buffer.alloc(16385));
      return handle;
    });
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: file },
        argv: [],
      }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "tokenFile"));
  });
});

describe("BR-018 BR-023 BR-026 BR-027 boundary and overlap regressions", () => {
  it("canonicalizes uppercase URL schemes through WHATWG", async () => {
    expect(
      (
        await load({
          ...http,
          MCP_PUBLIC_URL: "HTTPS://SERVICE.EXAMPLE:443/mcp/",
          OAUTH_AUDIENCE: "https://service.example/mcp",
        })
      ).publicUrl,
    ).toBe(http.MCP_PUBLIC_URL);
  });
  it("applies byte/count limits before content failures within effective values", async () => {
    await expect(
      load({
        ...http,
        KDRIVE_MCP_MODE: "BAD",
        OAUTH_ALLOWED_SUBJECTS: "é".repeat(513),
      }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "oauthAllowedSubjects"));
    await expect(
      load({ ...http, KDRIVE_MCP_INVITE_DOMAINS: "BAD," + "x".repeat(254) }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "inviteDomains"));
    await expect(
      load({}, ["--bad", "x".repeat(65536), "y".repeat(65536)]),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "cli"));
    await expect(
      load({ OAUTH_UNKNOWN: "x", KDRIVE_MCP_MODE: "x".repeat(65537) }),
    ).rejects.toMatchObject(error("UNKNOWN_SETTING", "environment"));
    await expect(
      load({
        KDRIVE_TOKEN: "",
        KDRIVE_TOKEN_FILE: "relative",
        KDRIVE_ID: "BAD",
      }),
    ).rejects.toMatchObject(error("CONFLICTING_SETTINGS", "token"));
  });
  it("checks YAML primitive shapes even when overridden, but only winning scalar content", async () => {
    await expect(
      load({}, ["--config", "settings.yaml", "--mode", "read"], "mode: [read]"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "mode"));
    expect(
      (
        await load(
          {},
          ["--config", "settings.yaml", "--mode", "read"],
          "mode: BAD",
        )
      ).mode,
    ).toBe("read");
    await expect(
      load({}, ["--config", "settings.yaml"], "sharedWrite: '1'"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "sharedWrite"));
    await expect(
      load({}, ["--config", "settings.yaml"], "maxTreeItems: 1.5"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "maxTreeItems"));
    expect(
      (await load({}, ["--config", "settings.yaml"], "driveIds: [7, 8]"))
        .driveIds,
    ).toEqual([7, 8]);
    await expect(
      load({}, ["--config", "settings.yaml"], "deny: [' /private']"),
    ).rejects.toMatchObject(error("INVALID_VALUE", "deny"));
  });
  it("accepts exact string/list maxima and rejects adjacent values", async () => {
    const path = "/" + "é".repeat(2047) + "a";
    expect(
      (await load({ KDRIVE_MCP_ROOTS: `7:${path}` })).roots[0]?.value,
    ).toBe(path);
    const subjects = Array.from({ length: 256 }, (_, i) => `s${i}`).join(",");
    expect(
      (await load({ ...http, OAUTH_ALLOWED_SUBJECTS: subjects }))
        .oauthAllowedSubjects,
    ).toHaveLength(256);
    await expect(
      load({ ...http, OAUTH_ALLOWED_SUBJECTS: subjects + ",extra" }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "oauthAllowedSubjects"));
    const roots = Array.from({ length: 256 }, (_, i) => `7:${i + 1}`).join(",");
    expect((await load({ KDRIVE_MCP_ROOTS: roots })).roots).toHaveLength(256);
    await expect(
      load({ KDRIVE_MCP_ROOTS: roots + ",7:999" }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "roots"));
    expect(
      (
        await load({
          KDRIVE_IDS: Array.from({ length: 64 }, (_, i) => String(i + 1)).join(
            ",",
          ),
        })
      ).driveIds,
    ).toHaveLength(64);
    expect(
      (await load({ ...http, OAUTH_ALLOWED_SUBJECTS: "é".repeat(512) }))
        .oauthAllowedSubjects[0],
    ).toHaveLength(512);
    expect(
      (await load({ KDRIVE_TOKEN: "x".repeat(16384) })).token,
    ).toHaveLength(16384);
  });
  it("reads no lower priority secret selector and accepts opaque bounded signing bytes", async () => {
    const readFile = vi.fn((path: string) =>
      Promise.resolve(
        path === "/cfg"
          ? bytes(
              "tokenFile: /ignored\noauthUpstreamClientSecretFile: /ignored-secret",
            )
          : Buffer.from([0xff, 0x00, 0x0a]),
      ),
    );
    const c = await loadConfiguration({
      env: { ...base, ...proxy },
      argv: ["--config", "/cfg"],
      readFile,
    });
    expect(c.token).toBe(base.KDRIVE_TOKEN);
    expect(c.oauthUpstreamClientSecret).toBe(
      proxy.OAUTH_UPSTREAM_CLIENT_SECRET,
    );
    expect(c.oauthSigningKey).toEqual(Buffer.from([0xff, 0, 10]));
    expect(readFile.mock.calls.map((c) => c[0])).toEqual([
      "/cfg",
      "/synthetic/key",
    ]);
    for (const [content, code] of [
      [Buffer.alloc(0), "CREDENTIAL_INVALID"],
      [Buffer.alloc(65537), "LIMIT_EXCEEDED"],
    ] as const)
      await expect(
        loadConfiguration({
          env: { ...base, ...proxy },
          argv: [],
          readFile: () => Promise.resolve(content),
        }),
      ).rejects.toMatchObject(error(code, "oauthSigningKeyFile"));
    expect(
      (
        await loadConfiguration({
          env: { ...base, ...proxy },
          argv: [],
          readFile: () => Promise.resolve(Buffer.alloc(65536)),
        })
      ).oauthSigningKey,
    ).toHaveLength(65536);
  });
  it("maps real YAML failures without decoding excerpts or reading credential files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-yaml-"));
    for (const file of [dir, join(dir, "missing")])
      await expect(
        loadConfiguration({ env: base, argv: ["--config", file] }),
      ).rejects.toMatchObject(error("CONFIG_READ_FAILED", "configFile"));
    const file = join(dir, "invalid");
    await writeFile(file, Buffer.from([0xff]));
    await expect(
      loadConfiguration({ env: base, argv: ["--config", file] }),
    ).rejects.toMatchObject(error("CONFIG_SYNTAX", "configFile"));
    await writeFile(file, "#".repeat(65536));
    await expect(
      loadConfiguration({ env: base, argv: ["--config", file] }),
    ).rejects.toMatchObject(error("CONFIG_SYNTAX", "configFile"));
    await writeFile(file, "#".repeat(65537));
    await expect(
      loadConfiguration({ env: base, argv: ["--config", file] }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "configFile"));
  });
  it("enforces no-follow during replacement and the streaming limit after metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-open-race-"));
    const file = join(dir, "token");
    const target = join(dir, "target");
    await writeFile(file, "SYNTHETIC");
    await writeFile(target, "SYNTHETIC_OTHER");
    const originalOpen = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (path, flags) => {
      await fs.rename(file, join(dir, "old"));
      await symlink(target, file);
      return originalOpen(path, flags);
    });
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: file },
        argv: [],
      }),
    ).rejects.toMatchObject(error("CREDENTIAL_READ_FAILED", "tokenFile"));
    vi.restoreAllMocks();
    const growing = join(dir, "growing");
    await writeFile(growing, "SYNTHETIC");
    vi.spyOn(fs, "open").mockImplementation(async (path, flags) => {
      const handle = await originalOpen(path, flags);
      const stat = await handle.stat();
      vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
        await writeFile(growing, Buffer.alloc(16385));
        return stat;
      });
      return handle;
    });
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: growing },
        argv: [],
      }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "tokenFile"));
  });
  it("rejects final-entry replacement after the bounded read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-final-race-"));
    const file = join(dir, "token");
    await writeFile(file, "SYNTHETIC");
    const lstat = fs.lstat;
    let count = 0;
    vi.spyOn(fs, "lstat").mockImplementation(
      async (...args: Parameters<typeof fs.lstat>) => {
        if (++count === 2) {
          await fs.rename(file, join(dir, "old"));
          await writeFile(file, "SYNTHETIC_REPLACEMENT");
        }
        return lstat(...args);
      },
    );
    await expect(
      loadConfiguration({
        env: { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: file },
        argv: [],
      }),
    ).rejects.toMatchObject(error("CREDENTIAL_READ_FAILED", "tokenFile"));
  });
});
it("BR-017 BR-027 maps values on bare transport flags and atomic upstream conflicts", async () => {
  await expect(load({}, ["--http", "1"])).rejects.toMatchObject(
    error("INVALID_VALUE", "transport"),
  );
  await expect(
    load({ ...proxy, OAUTH_UPSTREAM_CLIENT_SECRET_FILE: "" }),
  ).rejects.toMatchObject(
    error("CONFLICTING_SETTINGS", "oauthUpstreamClientSecret"),
  );
  await expect(
    load({ ...proxy, OAUTH_SIGNING_KEY_FILE: "relative" }),
  ).rejects.toMatchObject(error("INVALID_VALUE", "oauthSigningKeyFile"));
});

describe("BR-017 BR-018 BR-027 frozen v2 CLI budget phases", () => {
  const oversized = "x".repeat(65537);
  it.each([
    [[`--mode=${oversized}`], "LIMIT_EXCEEDED", "mode"],
    [["--mode", oversized], "LIMIT_EXCEEDED", "mode"],
    [["--config", oversized], "LIMIT_EXCEEDED", "configFile"],
    [["--unknown", `--mode=${oversized}`], "UNKNOWN_OPTION", "cli"],
    [[`--mode=${oversized}`, "--unknown"], "UNKNOWN_OPTION", "cli"],
    [["--help", `--mode=${oversized}`], "INVALID_VALUE", "cli"],
    [[`--mode=${oversized}`, "--mode", "read"], "DUPLICATE_OPTION", "cli"],
    [[`--mode=${oversized}`, "--roots"], "INVALID_VALUE", "roots"],
    [[oversized], "UNKNOWN_OPTION", "cli"],
    [
      [`--roots=${oversized}`, `--mode=${"x".repeat(65536)}`],
      "LIMIT_EXCEEDED",
      "cli",
    ],
  ] as const)(
    "maps structure and raw budgets case %#",
    async (argv, code, setting) => {
      await expect(load({}, [...argv])).rejects.toMatchObject(
        error(code, setting),
      );
    },
  );
  it("allows exactly 65536 value bytes in either form and bounds only recognized values", async () => {
    const entries = Array.from(
      { length: 128 },
      (_, i) => `7:/${String(i).padStart(3, "0")}${"x".repeat(505)}`,
    );
    entries[0] += "x";
    const raw = entries.join(",");
    expect(Buffer.byteLength(raw)).toBe(65536);
    for (const argv of [["--roots", raw], [`--roots=${raw}`]])
      expect((await load({}, argv)).roots).toHaveLength(128);
    await expect(load({}, [`--roots=${raw}x`])).rejects.toMatchObject(
      error("LIMIT_EXCEEDED", "roots"),
    );
    await expect(
      load({}, ["--mode=" + "x".repeat(65536)]),
    ).rejects.toMatchObject(error("INVALID_VALUE", "mode"));
  });
});

describe("BR-023 ASCII validation before Unicode case folding (PR review R1)", () => {
  for (const character of ["\u017f", "\u212a"]) {
    it.each([
      [
        "invitation domain",
        "KDRIVE_MCP_INVITE_DOMAINS",
        `${character}.example`,
        "inviteDomains",
      ],
      [
        "email domain",
        "OAUTH_ALLOWED_EMAILS",
        `User@${character}.example`,
        "oauthAllowedEmails",
      ],
      [
        "email local part",
        "OAUTH_ALLOWED_EMAILS",
        `${character}@example.com`,
        "oauthAllowedEmails",
      ],
      [
        "HTTP DNS hostname",
        "MCP_HTTP_HOST",
        `${character}.example`,
        "httpHost",
      ],
      ["HTTP single-label hostname", "MCP_HTTP_HOST", character, "httpHost"],
    ])(
      `rejects ${character} in %s before normalization`,
      async (_context, name, value, setting) => {
        await expect(load({ ...http, [name]: value })).rejects.toMatchObject(
          error("INVALID_VALUE", setting),
        );
      },
    );
  }
  it("keeps ASCII uppercase and A-labels while rejecting Kelvin text before its ASCII lowercase conversion", async () => {
    // The raw Kelvin sign becomes ASCII if lowercased first: validate raw input.
    expect("\u212a.example".toLowerCase()).toBe("k.example");
    await expect(
      load({ KDRIVE_MCP_INVITE_DOMAINS: "\u212a.example" }),
    ).rejects.toMatchObject(error("INVALID_VALUE", "inviteDomains"));
    const config = await load({
      ...http,
      KDRIVE_MCP_INVITE_DOMAINS: "EXAMPLE.COM,XN--BCHER-KVA.EXAMPLE",
      OAUTH_ALLOWED_EMAILS: "User@EXAMPLE.COM,Other@XN--BCHER-KVA.EXAMPLE",
      MCP_HTTP_HOST: "XN--BCHER-KVA.EXAMPLE",
    });
    expect(config.inviteDomains).toEqual([
      "example.com",
      "xn--bcher-kva.example",
    ]);
    expect(config.oauthAllowedEmails).toEqual([
      "User@example.com",
      "Other@xn--bcher-kva.example",
    ]);
  });
});

describe("BR-290 BR-023 v2 BR-024 v3 OAuth state file setting (F-019 AC-01)", () => {
  it("BR-290 resolves a relative path from environment, option and YAML", async () => {
    expect(
      (await load({ ...proxy, OAUTH_STATE_FILE: "a.db" })).oauthStateFile,
    ).toBe("/work/a.db");
    expect(
      (await load(proxy, ["--oauth-state-file", "b.db"])).oauthStateFile,
    ).toBe("/work/b.db");
    expect(
      (
        await load(
          proxy,
          ["--config", "settings.yaml"],
          "oauthStateFile: c.db\n",
        )
      ).oauthStateFile,
    ).toBe("/work/c.db");
    expect(
      (await load({ ...proxy, OAUTH_STATE_FILE: "/abs/d.db" })).oauthStateFile,
    ).toBe("/abs/d.db");
  });

  it("BR-290 has no default", async () => {
    expect((await load(proxy)).oauthStateFile).toBeUndefined();
  });

  it("BR-290 gives the value stderr no special meaning", async () => {
    expect(
      (await load({ ...proxy, OAUTH_STATE_FILE: "stderr" })).oauthStateFile,
    ).toBe("/work/stderr");
  });

  it.each([
    ["stdio", { OAUTH_STATE_FILE: "/s/state.db" }],
    [
      "insecure HTTP",
      {
        KDRIVE_MCP_TRANSPORT: "http",
        KDRIVE_MCP_INSECURE_NO_AUTH: "1",
        OAUTH_STATE_FILE: "/s/state.db",
      },
    ],
    ["delegate", { ...http, OAUTH_STATE_FILE: "/s/state.db" }],
    [
      "delegate-static",
      {
        ...http,
        OAUTH_MODE: "delegate-static",
        OAUTH_STATE_FILE: "/s/state.db",
      },
    ],
  ])("BR-024 v3 refuses the key in %s", async (_name, env) => {
    await expect(load(env)).rejects.toMatchObject(
      error("CONFLICTING_SETTINGS", "oauthStateFile"),
    );
  });

  it("BR-290 refuses a state file that resolves to the audit log", async () => {
    await expect(
      load({
        ...proxy,
        OAUTH_STATE_FILE: "audit/same.log",
        KDRIVE_MCP_AUDIT_LOG: "/work/audit/same.log",
      }),
    ).rejects.toMatchObject(error("CONFLICTING_SETTINGS", "oauthStateFile"));
    await expect(
      load({
        ...proxy,
        OAUTH_STATE_FILE: "/work/audit/same.log",
        KDRIVE_MCP_AUDIT_LOG: "audit/same.log",
      }),
    ).rejects.toMatchObject(error("CONFLICTING_SETTINGS", "oauthStateFile"));
  });

  it("BR-290 refuses an audit log equal to the state journal", async () => {
    await expect(
      load({
        ...proxy,
        OAUTH_STATE_FILE: "/work/state.db",
        KDRIVE_MCP_AUDIT_LOG: "state.db-journal",
      }),
    ).rejects.toMatchObject(error("CONFLICTING_SETTINGS", "oauthStateFile"));
    expect(
      (
        await load({
          ...proxy,
          OAUTH_STATE_FILE: "/work/state.db",
          KDRIVE_MCP_AUDIT_LOG: "state.db-wal",
        })
      ).oauthStateFile,
    ).toBe("/work/state.db");
  });

  it("BR-023 v2 bounds the path to 4,096 characters", async () => {
    expect(
      (await load({ ...proxy, OAUTH_STATE_FILE: "/" + "x".repeat(4095) }))
        .oauthStateFile,
    ).toBe("/" + "x".repeat(4095));
    await expect(
      load({ ...proxy, OAUTH_STATE_FILE: "/" + "x".repeat(4096) }),
    ).rejects.toMatchObject(error("LIMIT_EXCEEDED", "oauthStateFile"));
  });

  it.each(["", "a\u0001b", "a\nb", "a\u007fb"])(
    "BR-023 v2 refuses the invalid value %j",
    async (value) => {
      await expect(
        load({ ...proxy, OAUTH_STATE_FILE: value }),
      ).rejects.toMatchObject(error("INVALID_VALUE", "oauthStateFile"));
    },
  );
});

describe("BR-291 BR-023 v3 BR-024 v4 CIMD origin list (F-028 AC-01)", () => {
  const VALID = [
    "https://client.example.com",
    "https://xn--bcher-kva.example",
    "https://a-b.example.org:8443",
    "https://a.b.c.example:65535",
    `https://${"a".repeat(63)}.example`,
  ];
  async function viaEach(value: string[]) {
    const env = await load({
      ...proxy,
      OAUTH_ALLOWED_CLIENT_ID_ORIGINS: value.join(","),
    });
    const option = await load(proxy, [
      `--oauth-allowed-client-id-origins=${value.join(",")}`,
    ]);
    const yaml = await load(
      proxy,
      ["--config", "settings.yaml"],
      `oauthAllowedClientIdOrigins: ${JSON.stringify(value)}\n`,
    );
    return [env, option, yaml].map(
      (config) => config.oauthAllowedClientIdOrigins,
    );
  }

  it("BR-291 loads valid lists from environment, option and YAML", async () => {
    expect(await viaEach(VALID)).toEqual([VALID, VALID, VALID]);
    const sixteen = Array.from(
      { length: 16 },
      (_, n) => `https://c${String(n)}.example.com`,
    );
    expect(await viaEach(sixteen)).toEqual([sixteen, sixteen, sixteen]);
  });

  it("BR-291 defaults to an empty list, also for an empty environment value", async () => {
    expect((await load(proxy)).oauthAllowedClientIdOrigins).toEqual([]);
    expect(
      (await load({ ...proxy, OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "" }))
        .oauthAllowedClientIdOrigins,
    ).toEqual([]);
  });

  const host253 = `${["a".repeat(63), "b".repeat(63), "c".repeat(63)].join(".")}.${"d".repeat(61)}`;
  const INVALID: Array<[string, string[]]> = [
    [
      "17 entries",
      Array.from({ length: 17 }, (_, n) => `https://c${String(n)}.example.com`),
    ],
    ["a duplicate", ["https://client.example.com", "https://client.example.com"]],
    ["a 1,025-character entry", [`https://${"a".repeat(1009)}.example`]],
    ["http://", ["http://client.example.com"]],
    ["an uppercase host", ["https://Client.example.com"]],
    ["an IP host", ["https://192.0.2.1"]],
    ["localhost", ["https://localhost"]],
    ["a one-label host", ["https://client"]],
    ["a trailing dot", ["https://client.example.com."]],
    ["an all-digit last label", ["https://a.123"]],
    ["an underscore", ["https://client_a.example.com"]],
    ["a label starting with a hyphen", ["https://-client.example.com"]],
    ["a label ending with a hyphen", ["https://client-.example.com"]],
    ["a 64-character label", [`https://${"a".repeat(64)}.example`]],
    ["a 254-character host", [`https://${host253}a`]],
    ["the Unicode host", ["https://b\u00fccher.example"]],
    ["port 443", ["https://client.example.com:443"]],
    ["port 0", ["https://client.example.com:0"]],
    ["port 08080", ["https://client.example.com:08080"]],
    ["port 65536", ["https://client.example.com:65536"]],
    ["a path", ["https://client.example.com/c.json"]],
    ["a trailing slash", ["https://client.example.com/"]],
    ["userinfo", ["https://user@client.example.com"]],
    ["a query", ["https://client.example.com?x=1"]],
    ["a fragment", ["https://client.example.com#f"]],
  ];

  it("BR-291 the 253-character host is valid", async () => {
    expect(host253.length).toBe(253);
    expect(await viaEach([`https://${host253}`])).toEqual([
      [`https://${host253}`],
      [`https://${host253}`],
      [`https://${host253}`],
    ]);
  });

  it.each(INVALID)(
    "BR-291 refuses %s with INVALID_VALUE from every source",
    async (_case, value) => {
      const expected = error("INVALID_VALUE", "oauthAllowedClientIdOrigins");
      await expect(
        load({ ...proxy, OAUTH_ALLOWED_CLIENT_ID_ORIGINS: value.join(",") }),
      ).rejects.toMatchObject(expected);
      await expect(
        load(proxy, [`--oauth-allowed-client-id-origins=${value.join(",")}`]),
      ).rejects.toMatchObject(expected);
      await expect(
        load(
          proxy,
          ["--config", "settings.yaml"],
          `oauthAllowedClientIdOrigins: ${JSON.stringify(value)}\n`,
        ),
      ).rejects.toMatchObject(expected);
    },
  );

  it.each([
    ["stdio", {}],
    ["delegate", http],
    [
      "authentication off",
      { KDRIVE_MCP_TRANSPORT: "http", KDRIVE_MCP_INSECURE_NO_AUTH: "1" },
    ],
  ])("BR-291 refuses the list with %s as CONFLICTING_SETTINGS", async (_case, env) => {
    await expect(
      load({
        ...env,
        OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "https://client.example.com",
      }),
    ).rejects.toMatchObject(
      error("CONFLICTING_SETTINGS", "oauthAllowedClientIdOrigins"),
    );
  });

  it("BR-291 refuses an entry equal to the publicUrl or oauthIssuer origin", async () => {
    for (const origin of ["https://service.example", "https://issuer.example"])
      await expect(
        load({
          ...proxy,
          OAUTH_ALLOWED_CLIENT_ID_ORIGINS: `https://client.example.com,${origin}`,
        }),
      ).rejects.toMatchObject(
        error("CONFLICTING_SETTINGS", "oauthAllowedClientIdOrigins"),
      );
  });
});

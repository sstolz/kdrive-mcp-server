import { expect, it, vi } from "vitest";
import { loadConfiguration, type LocalConfiguration } from "../src/config.js";

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
interface BoundaryInput {
  env?: Record<string, string>;
  context?: "stdio" | "proxy" | "insecure";
  omit?: string[];
  yaml?: string;
  bytes?: Uint8Array;
  noRead?: boolean;
}
type BoundaryCase = BoundaryInput &
  (
    | { expected: Partial<LocalConfiguration>; error?: never }
    | { error: { code: string; setting: string }; expected?: never }
  );
// Every ID is one public-API scenario from the corresponding BR v1 record.
// Only the selected synthetic reader is injected; validation remains real.
function boundary(name: string, row: BoundaryCase) {
  it(name, async () => {
    let context: Record<string, string> = http;
    if (row.context === "proxy") context = proxy;
    else if (row.context === "stdio") context = {};
    else if (row.context === "insecure")
      context = {
        KDRIVE_MCP_TRANSPORT: "http",
        KDRIVE_MCP_INSECURE_NO_AUTH: "1",
      };
    const env: Record<string, string> = { ...base, ...context, ...row.env };
    for (const key of row.omit ?? []) delete env[key];
    const readFile = vi.fn((path: string) =>
      Promise.resolve(
        path === "/work/settings.yaml"
          ? Buffer.from(row.yaml ?? "{}")
          : (row.bytes ?? Buffer.from("SYNTHETIC")),
      ),
    );
    const operation = loadConfiguration({
      argv: row.yaml === undefined ? [] : ["--config", "settings.yaml"],
      env,
      cwd: "/work",
      readFile,
    });
    if (row.error) await expect(operation).rejects.toMatchObject(row.error);
    else expect(await operation).toMatchObject(row.expected);
    if (row.noRead) expect(readFile).not.toHaveBeenCalled();
  });
}
const x = (n: number) => "x".repeat(n);
const domain253 = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
const domain254 = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
const email254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
const email255 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
const url4096 = "https://example.com/" + x(4076);
const url4097 = "https://example.com/" + x(4077);
const invalid = (setting: string) => ({ code: "INVALID_VALUE", setting });
const limit = (setting: string) => ({ code: "LIMIT_EXCEEDED", setting });

boundary("P-BR023-001 BR-023 v1: retains a 1024-byte deny pattern", {
  env: { KDRIVE_MCP_DENY: "/" + x(1023) },
  expected: { deny: ["/" + x(1023)] },
});
boundary(
  "P-BR023-002 BR-023 v1: retains a 4096-byte audit path without opening it",
  {
    env: { KDRIVE_MCP_AUDIT_LOG: "/" + x(4095) },
    expected: { auditLog: "/" + x(4095) },
    noRead: true,
  },
);
boundary("P-BR023-003 BR-023 v1: rejects a 4097-byte audit path before I/O", {
  env: { KDRIVE_MCP_AUDIT_LOG: "/" + x(4096) },
  error: limit("auditLog"),
  noRead: true,
});
boundary(
  "P-BR023-004 BR-023 v1: resolves a one-byte audit path without opening it",
  {
    env: { KDRIVE_MCP_AUDIT_LOG: "a" },
    expected: { auditLog: "/work/a" },
    noRead: true,
  },
);
boundary("P-BR023-005 BR-023 v1: retains a 1024-byte upstream client ID", {
  context: "proxy",
  env: { OAUTH_UPSTREAM_CLIENT_ID: x(1024) },
  expected: { oauthUpstreamClientId: x(1024) },
});
boundary("P-BR023-006 BR-023 v1: retains a one-byte upstream client ID", {
  context: "proxy",
  env: { OAUTH_UPSTREAM_CLIENT_ID: "x" },
  expected: { oauthUpstreamClientId: "x" },
});
boundary("P-BR023-007 BR-023 v1: rejects an empty upstream client ID", {
  context: "proxy",
  env: { OAUTH_UPSTREAM_CLIENT_ID: "" },
  error: invalid("oauthUpstreamClientId"),
  noRead: true,
});
boundary("P-BR023-008 BR-023 v1: retains a 4096-byte public URL", {
  env: { MCP_PUBLIC_URL: url4096 },
  expected: { publicUrl: url4096 },
});
boundary("P-BR023-009 BR-023 v1: rejects a 4097-byte public URL", {
  env: { MCP_PUBLIC_URL: url4097 },
  error: limit("publicUrl"),
  noRead: true,
});
boundary("P-BR023-010 BR-023 v1: retains a 4096-byte issuer URL", {
  env: { OAUTH_ISSUER: url4096 },
  expected: { oauthIssuer: url4096 },
});
boundary("P-BR023-011 BR-023 v1: rejects a 4097-byte issuer URL", {
  env: { OAUTH_ISSUER: url4097 },
  error: limit("oauthIssuer"),
  noRead: true,
});
boundary(
  "P-BR023-012 BR-023 v1: accepts equal 4096-byte public and audience URLs",
  {
    env: { MCP_PUBLIC_URL: url4096, OAUTH_AUDIENCE: url4096 },
    expected: { publicUrl: url4096, oauthAudience: url4096 },
  },
);
boundary(
  "P-BR023-013 BR-023 v1: rejects audience byte overflow before equality",
  {
    env: { OAUTH_AUDIENCE: url4097 },
    error: limit("oauthAudience"),
    noRead: true,
  },
);
boundary("P-BR023-014 BR-023 v1: retains an exact 4096-byte redirect URI", {
  context: "proxy",
  env: { OAUTH_ALLOWED_REDIRECT_URIS: url4096 },
  expected: { oauthAllowedRedirectUris: [url4096] },
});
boundary("P-BR023-015 BR-023 v1: rejects a 4097-byte redirect URI", {
  context: "proxy",
  env: { OAUTH_ALLOWED_REDIRECT_URIS: url4097 },
  error: limit("oauthAllowedRedirectUris"),
  noRead: true,
});
boundary("P-BR023-016 BR-023 v1: accepts a 253-byte invitation DNS name", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: domain253 },
  expected: { inviteDomains: [domain253] },
});
boundary("P-BR023-017 BR-023 v1: rejects a 254-byte invitation DNS name", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: domain254 },
  error: limit("inviteDomains"),
});
boundary("P-BR023-018 BR-023 v1: accepts a 63-byte DNS label", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: "a".repeat(63) + ".com" },
  expected: { inviteDomains: ["a".repeat(63) + ".com"] },
});
boundary("P-BR023-019 BR-023 v1: rejects a 64-byte DNS label", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: "a".repeat(64) + ".com" },
  error: invalid("inviteDomains"),
});
boundary("P-BR023-020 BR-023 v1: accepts two one-byte DNS labels", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: "a.b" },
  expected: { inviteDomains: ["a.b"] },
});
boundary("P-BR023-021 BR-023 v1: rejects a single invitation DNS label", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: "a" },
  error: invalid("inviteDomains"),
});
boundary("P-BR023-022 BR-023 v1: accepts a 64-byte email local part", {
  env: { OAUTH_ALLOWED_EMAILS: "a".repeat(64) + "@b.c" },
  expected: { oauthAllowedEmails: ["a".repeat(64) + "@b.c"] },
});
boundary("P-BR023-023 BR-023 v1: rejects a 65-byte email local part", {
  env: { OAUTH_ALLOWED_EMAILS: "a".repeat(65) + "@b.c" },
  error: invalid("oauthAllowedEmails"),
});
boundary("P-BR023-024 BR-023 v1: accepts a 254-byte email", {
  env: { OAUTH_ALLOWED_EMAILS: email254 },
  expected: { oauthAllowedEmails: [email254] },
});
boundary("P-BR023-025 BR-023 v1: rejects a 255-byte email", {
  env: { OAUTH_ALLOWED_EMAILS: email255 },
  error: limit("oauthAllowedEmails"),
});
boundary("P-BR023-026 BR-023 v1: accepts a one-byte email local part", {
  env: { OAUTH_ALLOWED_EMAILS: "a@b.c" },
  expected: { oauthAllowedEmails: ["a@b.c"] },
});
boundary("P-BR023-027 BR-023 v1: rejects an empty email local part", {
  env: { OAUTH_ALLOWED_EMAILS: "@b.c" },
  error: invalid("oauthAllowedEmails"),
});
boundary("P-BR023-028 BR-023 v1: accepts a 253-byte DNS bind host", {
  env: { MCP_HTTP_HOST: domain253 },
  expected: { httpHost: domain253 },
});
boundary("P-BR023-029 BR-023 v1: rejects a 254-byte DNS bind host", {
  env: { MCP_HTTP_HOST: domain254 },
  error: limit("httpHost"),
});
boundary("P-BR023-030 BR-023 v1: accepts a 63-byte bind-host label", {
  env: { MCP_HTTP_HOST: "a".repeat(63) + ".com" },
  expected: { httpHost: "a".repeat(63) + ".com" },
});
boundary("P-BR023-031 BR-023 v1: rejects a 64-byte bind-host label", {
  env: { MCP_HTTP_HOST: "a".repeat(64) + ".com" },
  error: invalid("httpHost"),
});
const denies = Array.from({ length: 256 }, (_, i) => `/d${i}`);
const invitations = Array.from({ length: 256 }, (_, i) => `d${i}.com`);
const emails = Array.from({ length: 256 }, (_, i) => `u${i}@example.com`);
const redirects = Array.from(
  { length: 256 },
  (_, i) => `https://client.example/c${i}`,
);
boundary("P-BR023-032 BR-023 v1: retains 256 deny entries", {
  env: { KDRIVE_MCP_DENY: denies.join(",") },
  expected: { deny: denies },
});
boundary("P-BR023-033 BR-023 v1: rejects 257 deny entries", {
  env: { KDRIVE_MCP_DENY: [...denies, "/d256"].join(",") },
  error: limit("deny"),
});
boundary("P-BR023-034 BR-023 v1: retains 256 invitation domains", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: invitations.join(",") },
  expected: { inviteDomains: invitations },
});
boundary("P-BR023-035 BR-023 v1: retains 256 emails", {
  env: { OAUTH_ALLOWED_EMAILS: emails.join(",") },
  expected: { oauthAllowedEmails: emails },
});
boundary("P-BR023-036 BR-023 v1: rejects 257 emails", {
  env: { OAUTH_ALLOWED_EMAILS: [...emails, "u256@example.com"].join(",") },
  error: limit("oauthAllowedEmails"),
});
boundary("P-BR023-037 BR-023 v1: retains 256 byte-exact redirects", {
  context: "proxy",
  env: { OAUTH_ALLOWED_REDIRECT_URIS: redirects.join(",") },
  expected: { oauthAllowedRedirectUris: redirects },
});
boundary("P-BR023-038 BR-023 v1: rejects 257 redirects", {
  context: "proxy",
  env: {
    OAUTH_ALLOWED_REDIRECT_URIS: [
      ...redirects,
      "https://client.example/c256",
    ].join(","),
  },
  error: limit("oauthAllowedRedirectUris"),
});
boundary("P-BR023-039 BR-023 v1: accepts an explicit empty invitation list", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: "" },
  expected: { inviteDomains: [] },
});
boundary("P-BR023-040 BR-023 v1: rejects an empty invitation entry", {
  env: { KDRIVE_MCP_INVITE_DOMAINS: "a.b," },
  error: invalid("inviteDomains"),
});
boundary(
  "P-BR023-041 BR-023 v1: accepts empty subjects with one allowed email",
  {
    env: { OAUTH_ALLOWED_SUBJECTS: "", OAUTH_ALLOWED_EMAILS: "a@b.c" },
    expected: { oauthAllowedSubjects: [], oauthAllowedEmails: ["a@b.c"] },
  },
);
boundary("P-BR023-042 BR-023 v1: rejects an empty YAML subject entry", {
  omit: ["OAUTH_ALLOWED_SUBJECTS"],
  yaml: 'oauthAllowedSubjects: [""]',
  env: { OAUTH_ALLOWED_EMAILS: "a@b.c" },
  error: invalid("oauthAllowedSubjects"),
});
boundary("P-BR023-043 BR-023 v1: retains a one-byte YAML subject", {
  omit: ["OAUTH_ALLOWED_SUBJECTS"],
  yaml: "oauthAllowedSubjects: [s]",
  expected: { oauthAllowedSubjects: ["s"] },
});
boundary("P-BR023-044 BR-023 v1: accepts an explicit empty email list", {
  env: { OAUTH_ALLOWED_EMAILS: "" },
  expected: { oauthAllowedEmails: [], oauthAllowedSubjects: ["subject"] },
});
boundary("P-BR023-045 BR-023 v1: rejects an empty email entry", {
  env: { OAUTH_ALLOWED_EMAILS: "a@b.c," },
  error: invalid("oauthAllowedEmails"),
});
boundary("P-BR023-046 BR-023 v1: rejects an empty redirect value", {
  context: "proxy",
  env: { OAUTH_ALLOWED_REDIRECT_URIS: "" },
  error: invalid("oauthAllowedRedirectUris"),
});
boundary(
  "P-BR023-047 BR-023 v1: retains a non-root path without terminal slash",
  {
    env: { KDRIVE_MCP_ROOTS: "7:/a" },
    expected: { roots: [{ driveId: 7, kind: "path", value: "/a" }] },
  },
);
boundary("P-BR024-001 BR-024 v1: accepts email-only identity authorization", {
  env: { OAUTH_ALLOWED_SUBJECTS: "", OAUTH_ALLOWED_EMAILS: "User@Example.COM" },
  expected: {
    oauthAllowedSubjects: [],
    oauthAllowedEmails: ["User@example.com"],
  },
});
boundary("P-BR024-002 BR-024 v1: rejects zero combined identity entries", {
  env: { OAUTH_ALLOWED_SUBJECTS: "", OAUTH_ALLOWED_EMAILS: "" },
  error: { code: "MISSING_REQUIRED", setting: "oauthAllowedSubjects" },
});
boundary(
  "P-BR025-001 BR-025 v2: accepts an explicit matching insecure loopback origin",
  {
    context: "insecure",
    env: { MCP_HTTP_PORT: "3000", MCP_PUBLIC_URL: "http://127.0.0.1:3000" },
    expected: { httpHost: "127.0.0.1", publicUrl: "http://127.0.0.1:3000" },
  },
);
boundary("P-BR025-002 BR-025 v2: rejects explicit insecure true with stdio", {
  context: "stdio",
  env: { KDRIVE_MCP_INSECURE_NO_AUTH: "1" },
  error: { code: "CONFLICTING_SETTINGS", setting: "insecureNoAuth" },
});
boundary("P-BR026-001 BR-026 v1: accepts a one-byte environment token", {
  context: "stdio",
  env: { KDRIVE_TOKEN: "x" },
  expected: { token: "x" },
});
const tokenFile = {
  context: "stdio" as const,
  omit: ["KDRIVE_TOKEN"],
  env: { KDRIVE_TOKEN_FILE: "/synthetic/token" },
};
boundary("P-BR026-002 BR-026 v1: accepts a one-byte token file", {
  ...tokenFile,
  bytes: Buffer.from("x"),
  expected: { token: "x" },
});
boundary("P-BR026-003 BR-026 v1: accepts a 16384-byte token file", {
  ...tokenFile,
  bytes: Buffer.from(x(16384)),
  expected: { token: x(16384) },
});
boundary(
  "P-BR026-004 BR-026 v1: counts token LF in the 16384-byte file budget",
  {
    ...tokenFile,
    bytes: Buffer.from(x(16383) + "\n"),
    expected: { token: x(16383) },
  },
);
boundary(
  "P-BR026-005 BR-026 v1: rejects token file overflow before LF stripping",
  {
    ...tokenFile,
    bytes: Buffer.from(x(16384) + "\n"),
    error: limit("tokenFile"),
  },
);
boundary("P-BR026-006 BR-026 v1: accepts exactly 16384 UTF-8 token bytes", {
  context: "stdio",
  env: { KDRIVE_TOKEN: "é".repeat(8192) },
  expected: { token: "é".repeat(8192) },
});
boundary("P-BR026-007 BR-026 v1: rejects UTF-8 token byte overflow", {
  context: "stdio",
  env: { KDRIVE_TOKEN: "é".repeat(8193) },
  error: limit("token"),
});
boundary(
  "P-BR026-008 BR-026 v1: rejects an empty upstream environment secret",
  {
    context: "proxy",
    env: { OAUTH_UPSTREAM_CLIENT_SECRET: "" },
    error: { code: "CREDENTIAL_INVALID", setting: "oauthUpstreamClientSecret" },
  },
);
boundary(
  "P-BR026-009 BR-026 v1: accepts a one-byte upstream environment secret",
  {
    context: "proxy",
    env: { OAUTH_UPSTREAM_CLIENT_SECRET: "x" },
    expected: { oauthUpstreamClientSecret: "x" },
  },
);
boundary(
  "P-BR026-010 BR-026 v1: accepts a 16384-byte upstream environment secret",
  {
    context: "proxy",
    env: { OAUTH_UPSTREAM_CLIENT_SECRET: x(16384) },
    expected: { oauthUpstreamClientSecret: x(16384) },
  },
);
boundary("P-BR026-011 BR-026 v1: rejects upstream environment byte overflow", {
  context: "proxy",
  env: { OAUTH_UPSTREAM_CLIENT_SECRET: x(16385) },
  error: limit("oauthUpstreamClientSecret"),
});
const upstreamFile = {
  context: "proxy" as const,
  omit: ["OAUTH_UPSTREAM_CLIENT_SECRET"],
  env: { OAUTH_UPSTREAM_CLIENT_SECRET_FILE: "/synthetic/upstream" },
};
boundary("P-BR026-012 BR-026 v1: rejects an empty upstream secret file", {
  ...upstreamFile,
  bytes: Buffer.alloc(0),
  error: { code: "CREDENTIAL_INVALID", setting: "oauthUpstreamClientSecret" },
});
boundary("P-BR026-013 BR-026 v1: accepts a one-byte upstream secret file", {
  ...upstreamFile,
  bytes: Buffer.from("x"),
  expected: { oauthUpstreamClientSecret: "x" },
});
boundary("P-BR026-014 BR-026 v1: accepts a 16384-byte upstream secret file", {
  ...upstreamFile,
  bytes: Buffer.from(x(16384)),
  expected: { oauthUpstreamClientSecret: x(16384) },
});
boundary("P-BR026-015 BR-026 v1: rejects upstream secret file overflow", {
  ...upstreamFile,
  bytes: Buffer.from(x(16385)),
  error: limit("oauthUpstreamClientSecretFile"),
});
boundary("P-BR026-016 BR-026 v1: accepts one opaque signing byte", {
  context: "proxy",
  bytes: Buffer.from([0]),
  expected: { oauthSigningKey: Buffer.from([0]) },
});
boundary("P-BR026-017 BR-026 v1: accepts a 4096-byte token selector", {
  context: "stdio",
  omit: ["KDRIVE_TOKEN"],
  env: { KDRIVE_TOKEN_FILE: "/" + x(4095) },
  expected: { tokenFile: "/" + x(4095), token: "SYNTHETIC" },
});
boundary("P-BR026-018 BR-026 v1: rejects token selector overflow before read", {
  context: "stdio",
  omit: ["KDRIVE_TOKEN"],
  env: { KDRIVE_TOKEN_FILE: "/" + x(4096) },
  error: limit("tokenFile"),
  noRead: true,
});
boundary("P-BR026-019 BR-026 v1: accepts a 4096-byte upstream selector", {
  context: "proxy",
  omit: ["OAUTH_UPSTREAM_CLIENT_SECRET"],
  env: { OAUTH_UPSTREAM_CLIENT_SECRET_FILE: "/" + x(4095) },
  expected: {
    oauthUpstreamClientSecretFile: "/" + x(4095),
    oauthUpstreamClientSecret: "SYNTHETIC",
  },
});
boundary(
  "P-BR026-020 BR-026 v1: rejects upstream selector overflow before read",
  {
    context: "proxy",
    omit: ["OAUTH_UPSTREAM_CLIENT_SECRET"],
    env: { OAUTH_UPSTREAM_CLIENT_SECRET_FILE: "/" + x(4096) },
    error: limit("oauthUpstreamClientSecretFile"),
    noRead: true,
  },
);
boundary("P-BR026-021 BR-026 v1: accepts a 4096-byte signing selector", {
  context: "proxy",
  env: { OAUTH_SIGNING_KEY_FILE: "/" + x(4095) },
  bytes: Buffer.from([0]),
  expected: {
    oauthSigningKeyFile: "/" + x(4095),
    oauthSigningKey: Buffer.from([0]),
  },
});
boundary(
  "P-BR026-022 BR-026 v1: rejects signing selector overflow before read",
  {
    context: "proxy",
    env: { OAUTH_SIGNING_KEY_FILE: "/" + x(4096) },
    error: limit("oauthSigningKeyFile"),
    noRead: true,
  },
);

// F-019 BR-023 v2 / BR-290: the OAuth state file bounds (AC-01).
boundary("P-BR290-001 BR-023 v2: retains a 4096-byte state path without I/O", {
  context: "proxy",
  env: { OAUTH_STATE_FILE: "/" + x(4095) },
  expected: { oauthStateFile: "/" + x(4095) },
});
boundary("P-BR290-002 BR-023 v2: rejects a 4097-byte state path before I/O", {
  context: "proxy",
  env: { OAUTH_STATE_FILE: "/" + x(4096) },
  error: limit("oauthStateFile"),
  noRead: true,
});
boundary("P-BR290-003 BR-023 v2: resolves a one-byte state path", {
  context: "proxy",
  env: { OAUTH_STATE_FILE: "a" },
  expected: { oauthStateFile: "/work/a" },
});
boundary("P-BR290-004 BR-023 v2: rejects an empty state path before I/O", {
  context: "proxy",
  env: { OAUTH_STATE_FILE: "" },
  error: invalid("oauthStateFile"),
  noRead: true,
});
boundary("P-BR290-005 BR-024 v3: refuses a state path in stdio", {
  context: "stdio",
  env: { OAUTH_STATE_FILE: "/s/state.db" },
  error: { code: "CONFLICTING_SETTINGS", setting: "oauthStateFile" },
  noRead: true,
});
boundary("P-BR290-006 BR-024 v3: refuses a state path in insecure HTTP", {
  context: "insecure",
  env: { OAUTH_STATE_FILE: "/s/state.db" },
  error: { code: "CONFLICTING_SETTINGS", setting: "oauthStateFile" },
  noRead: true,
});
boundary("P-BR290-007 BR-024 v3: refuses a state path in delegate mode", {
  env: { OAUTH_STATE_FILE: "/s/state.db" },
  error: { code: "CONFLICTING_SETTINGS", setting: "oauthStateFile" },
  noRead: true,
});

// F-028 BR-023 v3 / BR-024 v4 / BR-291: the CIMD origin list bounds (AC-01).
const origins = (count: number) =>
  Array.from({ length: count }, (_, n) => `https://c${String(n)}.example.com`);
boundary("P-BR291-001 BR-023 v3: retains 16 distinct origins", {
  context: "proxy",
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: origins(16).join(",") },
  expected: { oauthAllowedClientIdOrigins: origins(16) },
});
boundary("P-BR291-002 BR-023 v3: rejects 17 origins with INVALID_VALUE", {
  context: "proxy",
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: origins(17).join(",") },
  error: invalid("oauthAllowedClientIdOrigins"),
  noRead: true,
});
boundary(
  "P-BR291-003 BR-023 v3: rejects a 1,025-character origin with INVALID_VALUE",
  {
    context: "proxy",
    env: {
      OAUTH_ALLOWED_CLIENT_ID_ORIGINS: `https://${"a".repeat(1009)}.example`,
    },
    error: invalid("oauthAllowedClientIdOrigins"),
    noRead: true,
  },
);
boundary("P-BR291-004 BR-023 v3: an empty value is the empty list", {
  context: "proxy",
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "" },
  expected: { oauthAllowedClientIdOrigins: [] },
});
boundary("P-BR291-005 BR-024 v4: refuses origins in stdio", {
  context: "stdio",
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "https://client.example.com" },
  error: {
    code: "CONFLICTING_SETTINGS",
    setting: "oauthAllowedClientIdOrigins",
  },
  noRead: true,
});
boundary("P-BR291-006 BR-024 v4: refuses origins in insecure HTTP", {
  context: "insecure",
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "https://client.example.com" },
  error: {
    code: "CONFLICTING_SETTINGS",
    setting: "oauthAllowedClientIdOrigins",
  },
  noRead: true,
});
boundary("P-BR291-007 BR-024 v4: refuses origins in delegate mode", {
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "https://client.example.com" },
  error: {
    code: "CONFLICTING_SETTINGS",
    setting: "oauthAllowedClientIdOrigins",
  },
  noRead: true,
});
boundary("P-BR291-008 BR-024 v4: refuses the publicUrl origin", {
  context: "proxy",
  env: { OAUTH_ALLOWED_CLIENT_ID_ORIGINS: "https://service.example" },
  error: {
    code: "CONFLICTING_SETTINGS",
    setting: "oauthAllowedClientIdOrigins",
  },
  noRead: true,
});

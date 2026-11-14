/** Exact frozen F-002 source inventory; its order also defines diagnostics. */
export const inventory = [
  ["transport", "KDRIVE_MCP_TRANSPORT", "", "enum", "stdio"],
  ["token", "KDRIVE_TOKEN", "", "secret"],
  ["tokenFile", "KDRIVE_TOKEN_FILE", "token-file", "file"],
  ["driveId", "KDRIVE_ID", "drive-id", "integer"],
  ["driveIds", "KDRIVE_IDS", "drive-ids", "ids"],
  ["mode", "KDRIVE_MCP_MODE", "mode", "enum", "read"],
  ["roots", "KDRIVE_MCP_ROOTS", "roots", "list"],
  ["deny", "KDRIVE_MCP_DENY", "deny", "list", []],
  [
    "maxTreeItems",
    "KDRIVE_MCP_MAX_TREE_ITEMS",
    "max-tree-items",
    "integer",
    10000,
  ],
  [
    "sharedWithMe",
    "KDRIVE_MCP_SHARED_WITH_ME",
    "shared-with-me",
    "boolean",
    false,
  ],
  ["sharedWrite", "KDRIVE_MCP_SHARED_WRITE", "shared-write", "boolean", false],
  [
    "maxReadBytes",
    "KDRIVE_MCP_MAX_READ_BYTES",
    "max-read-bytes",
    "integer",
    5000000,
  ],
  [
    "maxExtractBytes",
    "KDRIVE_MCP_MAX_EXTRACT_BYTES",
    "max-extract-bytes",
    "integer",
    50000000,
  ],
  [
    "extractTimeoutMs",
    "KDRIVE_MCP_EXTRACT_TIMEOUT_MS",
    "extract-timeout-ms",
    "integer",
    20000,
  ],
  [
    "maxOutputChars",
    "KDRIVE_MCP_MAX_OUTPUT_CHARS",
    "max-output-chars",
    "integer",
    200000,
  ],
  ["auditLog", "KDRIVE_MCP_AUDIT_LOG", "audit-log", "string", "stderr"],
  [
    "allowPublicLinks",
    "KDRIVE_MCP_ALLOW_PUBLIC_LINKS",
    "allow-public-links",
    "boolean",
    false,
  ],
  ["inviteDomains", "KDRIVE_MCP_INVITE_DOMAINS", "invite-domains", "list", []],
  ["httpHost", "MCP_HTTP_HOST", "host", "string", "127.0.0.1"],
  ["httpPort", "MCP_HTTP_PORT", "port", "integer", 3000],
  ["publicUrl", "MCP_PUBLIC_URL", "public-url", "string"],
  [
    "insecureNoAuth",
    "KDRIVE_MCP_INSECURE_NO_AUTH",
    "insecure-no-auth",
    "boolean",
    false,
  ],
  ["oauthMode", "OAUTH_MODE", "oauth-mode", "enum"],
  ["oauthIssuer", "OAUTH_ISSUER", "oauth-issuer", "string"],
  ["oauthAudience", "OAUTH_AUDIENCE", "oauth-audience", "string"],
  [
    "oauthAllowedSubjects",
    "OAUTH_ALLOWED_SUBJECTS",
    "oauth-allowed-subjects",
    "list",
    [],
  ],
  [
    "oauthAllowedEmails",
    "OAUTH_ALLOWED_EMAILS",
    "oauth-allowed-emails",
    "list",
    [],
  ],
  [
    "oauthUpstreamClientId",
    "OAUTH_UPSTREAM_CLIENT_ID",
    "oauth-upstream-client-id",
    "string",
  ],
  ["oauthUpstreamClientSecret", "OAUTH_UPSTREAM_CLIENT_SECRET", "", "secret"],
  [
    "oauthUpstreamClientSecretFile",
    "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
    "oauth-upstream-client-secret-file",
    "file",
  ],
  [
    "oauthSigningKeyFile",
    "OAUTH_SIGNING_KEY_FILE",
    "oauth-signing-key-file",
    "file",
  ],
  [
    "oauthAllowedRedirectUris",
    "OAUTH_ALLOWED_REDIRECT_URIS",
    "oauth-allowed-redirect-uris",
    "list",
  ],
  // F-019 BR-290: appended last; `proxyKeys` is `inventory.slice(27)`.
  ["oauthStateFile", "OAUTH_STATE_FILE", "oauth-state-file", "string"],
  // F-028 BR-291: proxy-only, appended last (inside `proxyKeys`).
  [
    "oauthAllowedClientIdOrigins",
    "OAUTH_ALLOWED_CLIENT_ID_ORIGINS",
    "oauth-allowed-client-id-origins",
    "list",
    [],
  ],
] as const;
export type Setting = (typeof inventory)[number][0];
export type DiagnosticSetting =
  Setting | "cli" | "configFile" | "environment" | "preflight";
export type ErrorCode =
  | "UNKNOWN_OPTION"
  | "DUPLICATE_OPTION"
  | "INVALID_VALUE"
  | "LIMIT_EXCEEDED"
  | "UNKNOWN_SETTING"
  | "CONFIG_READ_FAILED"
  | "CONFIG_SYNTAX"
  | "MISSING_REQUIRED"
  | "CONFLICTING_SETTINGS"
  | "CREDENTIAL_READ_FAILED"
  | "CREDENTIAL_INVALID"
  | "DRIVE_NOT_ALLOWED"
  | "ROOT_NOT_RESOLVED"
  | "PREFLIGHT_UNAVAILABLE"
  | "PREFLIGHT_FAILED";
export class ConfigurationError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly setting: DiagnosticSetting,
  ) {
    super(`Configuration error [${code}] (${setting}).`);
    this.name = "ConfigurationError";
  }
  toJSON() {
    return { code: this.code, setting: this.setting };
  }
}
export function fail(code: ErrorCode, setting: DiagnosticSetting): never {
  throw new ConfigurationError(code, setting);
}
export type RootSelector = Readonly<
  | { driveId: number; kind: "id"; value: number }
  | { driveId: number; kind: "path"; value: string }
>;
export interface LocalConfiguration {
  readonly transport: "stdio" | "http";
  readonly token: string;
  readonly tokenFile?: string;
  readonly driveId: number;
  readonly driveIds: readonly number[];
  readonly mode: "read" | "write" | "share";
  readonly roots: readonly RootSelector[];
  readonly deny: readonly string[];
  readonly maxTreeItems: number;
  readonly sharedWithMe: boolean;
  readonly sharedWrite: boolean;
  readonly effectiveSharedWrite: boolean;
  readonly maxReadBytes: number;
  readonly maxExtractBytes: number;
  readonly extractTimeoutMs: number;
  readonly maxOutputChars: number;
  readonly auditLog: string;
  readonly allowPublicLinks: boolean;
  readonly effectivePublicLinks: boolean;
  readonly inviteDomains: readonly string[];
  readonly httpHost: string;
  readonly httpPort: number;
  readonly publicUrl?: string;
  readonly insecureNoAuth: boolean;
  readonly oauthMode?: "delegate" | "delegate-static" | "proxy";
  readonly oauthIssuer?: string;
  readonly oauthAudience?: string;
  readonly oauthAllowedSubjects: readonly string[];
  readonly oauthAllowedEmails: readonly string[];
  readonly oauthUpstreamClientId?: string;
  readonly oauthUpstreamClientSecret?: string;
  readonly oauthUpstreamClientSecretFile?: string;
  readonly oauthSigningKeyFile?: string;
  readonly oauthSigningKey?: Uint8Array;
  readonly oauthAllowedRedirectUris?: readonly string[];
  /** F-019 BR-290: the absolute OAuth state file path. */
  readonly oauthStateFile?: string;
  /** F-028 BR-291: the CIMD origins; empty keeps CIMD off. */
  readonly oauthAllowedClientIdOrigins: readonly string[];
}
export interface PreflightResolver {
  inspectDrive(driveId: number): Promise<unknown>;
  resolveDirectory(driveId: number, selector: RootSelector): Promise<unknown>;
}
export type FileReader = (
  path: string,
  maximumBytes: number,
  credential: boolean,
) => Promise<Uint8Array>;
export interface ConfigurationInput {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  readFile?: FileReader;
}
export type Source = Partial<Record<Setting, unknown>>;
export type Selected = Partial<
  Record<
    Setting,
    { value: unknown; source: "cli" | "env" | "yaml" | "default" }
  >
>;
export const secretPairs = [
  ["token", "tokenFile"],
  ["oauthUpstreamClientSecret", "oauthUpstreamClientSecretFile"],
] as const;
export const controls = /[\x00-\x1f\x7f]/u;
export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
export function budget(
  value: string,
  max: number,
  key: DiagnosticSetting,
): void {
  if (byteLength(value) > max) fail("LIMIT_EXCEEDED", key);
}
export function integer(
  value: unknown,
  key: DiagnosticSetting,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^\d+$/u.test(value))
  )
    fail("INVALID_VALUE", key);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max)
    fail("INVALID_VALUE", key);
  return number;
}

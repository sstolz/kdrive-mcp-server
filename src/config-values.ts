import { isAbsolute, resolve } from "node:path";
import { isIP } from "node:net";
import { trimAsciiListEntry, removeTerminalSlashes } from "./config-text.js";
import {
  budget,
  controls,
  fail,
  integer,
  inventory,
  type RootSelector,
  type Selected,
  type Setting,
  type Source,
} from "./config-schema.js";

const listKeys = new Set<Setting>(
  inventory
    .filter((row) => row[3] === "list" || row[3] === "ids")
    .map((row) => row[0]),
);
const entryBounds: Partial<Record<Setting, number>> = {
  deny: 1024,
  inviteDomains: 253,
  oauthAllowedSubjects: 1024,
  oauthAllowedEmails: 254,
  oauthAllowedRedirectUris: 4096,
};
const stringBounds: Partial<Record<Setting, number>> = {
  tokenFile: 4096,
  oauthUpstreamClientSecretFile: 4096,
  oauthSigningKeyFile: 4096,
  auditLog: 4096,
  oauthStateFile: 4096,
  publicUrl: 4096,
  oauthIssuer: 4096,
  oauthAudience: 4096,
  oauthUpstreamClientId: 1024,
  httpHost: 253,
};
const maxima: Partial<Record<Setting, number>> = {
  maxTreeItems: 1000000,
  maxReadBytes: 1073741824,
  maxExtractBytes: 1073741824,
  extractTimeoutMs: 300000,
  maxOutputChars: 10000000,
  httpPort: 65535,
};
function asList(value: unknown, key: Setting): unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  if (typeof value !== "string") fail("INVALID_VALUE", key);
  if (
    value === "" &&
    [
      "deny",
      "inviteDomains",
      "oauthAllowedSubjects",
      "oauthAllowedEmails",
    ].includes(key)
  )
    return [];
  return value.split(",").map(trimAsciiListEntry);
}
function string(value: unknown, key: Setting): string {
  if (typeof value !== "string" || !value || controls.test(value))
    fail("INVALID_VALUE", key);
  return value;
}
function domain(value: string, key: Setting, singleLabel = false): string {
  const labels = value.split(".");
  if (
    (!singleLabel && labels.length < 2) ||
    !labels.every((label) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(label),
    )
  )
    fail("INVALID_VALUE", key);
  return value.toLowerCase();
}
function email(value: string, key: Setting): string {
  const parts = value.split("@");
  const local = parts[0];
  const host = parts[1];
  if (
    parts.length !== 2 ||
    !local ||
    !host ||
    Buffer.byteLength(local) > 64 ||
    !local
      .split(".")
      .every((atom) => /^[A-Za-z0-9!#$%&'+/=?^_`{|}~-]+$/u.test(atom))
  )
    fail("INVALID_VALUE", key);
  budget(host, 253, key);
  return `${local}@${domain(host, key)}`;
}
function pathComponents(value: string, key: Setting, glob: boolean): void {
  if (controls.test(value) || value.includes("\\")) fail("INVALID_VALUE", key);
  if (value === "/") return;
  if (
    glob
      ? !(value.startsWith("/") || value.startsWith("**/"))
      : !value.startsWith("/")
  )
    fail("INVALID_VALUE", key);
  const parts = (value.startsWith("/") ? value.slice(1) : value).split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    fail("INVALID_VALUE", key);
  if (
    glob &&
    (/[{}[\]()]/u.test(value) ||
      parts.some((part) => part.includes("**") && part !== "**"))
  )
    fail("INVALID_VALUE", key);
}
function root(value: string): RootSelector {
  const colon = value.indexOf(":");
  if (colon < 0) fail("INVALID_VALUE", "roots");
  const driveId = integer(value.slice(0, colon), "roots");
  const selector = value.slice(colon + 1);
  if (selector.startsWith("/")) {
    pathComponents(selector, "roots", false);
    return Object.freeze({ driveId, kind: "path", value: selector });
  }
  return Object.freeze({
    driveId,
    kind: "id",
    value: integer(selector, "roots"),
  });
}
/** The WHATWG parser canonicalizes resources; redirects retain their original bytes. */
export function url(
  value: string,
  key: Setting,
  redirect = false,
  allowHttp = false,
): string {
  if (
    controls.test(value) ||
    value.trim() !== value ||
    value.includes("\\") ||
    !/^https?:\/\//iu.test(value)
  )
    fail("INVALID_VALUE", key);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("INVALID_VALUE", key);
  }
  if (
    !parsed.hostname ||
    (/^https?:\/\/([^/?#]+)/iu.exec(value)?.[1] ?? "").includes("@") ||
    parsed.username ||
    parsed.password ||
    value.includes("#") ||
    (!redirect && value.includes("?"))
  )
    fail("INVALID_VALUE", key);
  if (redirect) {
    const authority = /^https?:\/\/([^/?#]+)/iu.exec(value)?.[1] ?? "";
    // BR-024 v2: lowercase `localhost` is the third accepted loopback host.
    const literalLoopback = /^(127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?$/u.test(
      authority,
    );
    if (
      value.includes("*") ||
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && literalLoopback))
    )
      fail("INVALID_VALUE", key);
    return value;
  }
  if (
    parsed.protocol !== "https:" &&
    !(allowHttp && parsed.protocol === "http:")
  )
    fail("INVALID_VALUE", key);
  return removeTerminalSlashes(parsed.href);
}
type Kind = (typeof inventory)[number][3];
type Selection = NonNullable<Selected[Setting]>;
const enumValues: Partial<Record<Setting, readonly string[]>> = {
  transport: ["stdio", "http"],
  mode: ["read", "write", "share"],
  oauthMode: ["delegate", "delegate-static", "proxy"],
};
function budgetListItem(item: unknown, key: Setting): void {
  if (typeof item !== "string") return;
  const max = entryBounds[key];
  if (max) budget(item, max, key);
  if (key === "roots") {
    const selector = item.slice(item.indexOf(":") + 1);
    if (selector.startsWith("/")) budget(selector, 4096, key);
  }
}
function prepareValue(value: unknown, key: Setting, kind: Kind): unknown {
  if (listKeys.has(key)) {
    const list = asList(value, key);
    if (list.length > (key === "driveIds" ? 64 : 256))
      fail("LIMIT_EXCEEDED", key);
    for (const item of list) budgetListItem(item, key);
    return list;
  }
  const max = stringBounds[key];
  if (kind !== "secret" && typeof value === "string" && max)
    budget(value, max, key);
  return value;
}
function normalizeBoolean(
  value: unknown,
  key: Setting,
  source: Selection["source"],
): boolean {
  if (source === "yaml" || source === "default") {
    if (typeof value !== "boolean") fail("INVALID_VALUE", key);
    return value;
  }
  if (value !== "0" && value !== "1") fail("INVALID_VALUE", key);
  return value === "1";
}
// eslint-disable-next-line sonarjs/function-return-type -- F-011: the union return type is part of the reviewed contract
function normalizeListItem(
  item: unknown,
  key: Setting,
): number | string | RootSelector {
  if (key === "driveIds") return integer(item, key);
  const text = string(item, key);
  switch (key) {
    case "roots":
      return root(text);
    case "deny":
      pathComponents(text, key, true);
      return text;
    case "inviteDomains":
      return domain(text, key);
    case "oauthAllowedEmails":
      return email(text, key);
    case "oauthAllowedRedirectUris":
      return url(text, key, true);
    default:
      return text;
  }
}
function normalizeList(
  value: unknown,
  key: Setting,
): readonly (number | string | RootSelector)[] {
  const list = value as unknown[];
  if (
    ["roots", "driveIds", "oauthAllowedRedirectUris"].includes(key) &&
    !list.length
  )
    fail("INVALID_VALUE", key);
  const normalized = list.map((item) => normalizeListItem(item, key));
  const unique = new Set(
    normalized.map((item) =>
      typeof item === "object" ? JSON.stringify(item) : item,
    ),
  );
  if (unique.size !== normalized.length) fail("INVALID_VALUE", key);
  return Object.freeze(normalized);
}
function normalizeText(
  text: string,
  key: Setting,
  prepared: Source,
  selected: Selected,
  cwd: string,
): string {
  const allowed = enumValues[key];
  if (allowed && !allowed.includes(text)) fail("INVALID_VALUE", key);
  switch (key) {
    case "auditLog":
      return text === "stderr" ? text : resolve(cwd, text);
    // BR-290: `stderr` has no special meaning for the state file.
    case "oauthStateFile":
      return resolve(cwd, text);
    case "httpHost":
      if (!isIP(text)) domain(text, key, true);
      return text;
    case "publicUrl":
      return url(
        text,
        key,
        false,
        prepared.insecureNoAuth === true ||
          selected.insecureNoAuth?.value === "1" ||
          selected.insecureNoAuth?.value === true,
      );
    case "oauthIssuer":
    case "oauthAudience":
      return url(text, key);
    default:
      return text;
  }
}
function normalizeValue(
  key: Setting,
  kind: Kind,
  entry: Selection,
  prepared: Source,
  selected: Selected,
  cwd: string,
): unknown {
  const value = prepared[key];
  switch (kind) {
    case "secret":
      return value;
    case "integer":
      return integer(value, key, maxima[key]);
    case "boolean":
      return normalizeBoolean(value, key, entry.source);
    case "file": {
      const text = string(value, key);
      if (!isAbsolute(text)) fail("INVALID_VALUE", key);
      return text;
    }
    default:
      if (listKeys.has(key)) return normalizeList(value, key);
      return normalizeText(string(value, key), key, prepared, selected, cwd);
  }
}
export function validateValues(selected: Selected, cwd: string): Source {
  const prepared: Source = {};
  // Preserve complete budget phase before any content/duplicate validation.
  for (const [key, , , kind] of inventory) {
    const entry = selected[key];
    if (entry) prepared[key] = prepareValue(entry.value, key, kind);
  }
  for (const [key, , , kind] of inventory) {
    const entry = selected[key];
    if (entry)
      prepared[key] = normalizeValue(key, kind, entry, prepared, selected, cwd);
  }
  return prepared;
}
function explicit(selected: Selected, key: Setting): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- F-011: defensive runtime check kept; the value can change outside the static type flow
  return selected[key] !== undefined && selected[key]?.source !== "default";
}
function required(values: Source, key: Setting): void {
  if (values[key] === undefined) fail("MISSING_REQUIRED", key);
}
function rejectExplicit(selected: Selected, keys: readonly Setting[]): void {
  for (const key of keys)
    if (explicit(selected, key)) fail("CONFLICTING_SETTINGS", key);
}
function validateDrives(values: Source): readonly number[] {
  if (values.driveId === undefined && values.driveIds === undefined)
    fail("MISSING_REQUIRED", "driveIds");
  const drives =
    values.driveIds === undefined
      ? [values.driveId as number]
      : (values.driveIds as readonly number[]);
  if (
    values.driveId !== undefined &&
    !drives.includes(values.driveId as number)
  )
    fail("CONFLICTING_SETTINGS", "driveId");
  values.driveId ??= drives[0];
  values.driveIds = Object.freeze(drives);
  return drives;
}
function validateRoots(values: Source, drives: readonly number[]): void {
  if (values.roots === undefined) {
    values.roots = Object.freeze(
      drives.map((driveId) => Object.freeze({ driveId, kind: "id", value: 1 })),
    );
    return;
  }
  const roots = values.roots as readonly RootSelector[];
  if (roots.some((root) => !drives.includes(root.driveId)))
    fail("DRIVE_NOT_ALLOWED", "roots");
  if (drives.some((id) => !roots.some((root) => root.driveId === id)))
    fail("MISSING_REQUIRED", "roots");
}
function validateInsecurePublicUrl(values: Source, selected: Selected): void {
  if (!explicit(selected, "publicUrl")) return;
  const parsed = new URL(values.publicUrl as string);
  // Preserve literal spelling: WHATWG accepts alternate numeric IP forms.
  const raw = selected.publicUrl?.value as string;
  if (
    parsed.protocol !== "http:" ||
    !/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/iu.test(raw) ||
    parsed.hostname !== "127.0.0.1" ||
    Number(parsed.port || 80) !== values.httpPort
  )
    fail("CONFLICTING_SETTINGS", "publicUrl");
}
const httpKeys = inventory.slice(18).map((row) => row[0]);
const oauthKeys = inventory.slice(22).map((row) => row[0]);
const proxyKeys = inventory.slice(27).map((row) => row[0]);
function validateInsecureHttp(values: Source, selected: Selected): void {
  validateInsecurePublicUrl(values, selected);
  rejectExplicit(selected, oauthKeys);
  values.httpHost = "127.0.0.1";
  values.publicUrl ??= `http://127.0.0.1:${String(values.httpPort)}`;
}
function validateIssuerAudience(values: Source): void {
  if (values.oauthMode === "proxy" && values.oauthIssuer === values.publicUrl)
    fail("CONFLICTING_SETTINGS", "oauthIssuer");
  if (
    values.oauthAudience !== undefined &&
    values.oauthAudience !== values.publicUrl
  )
    fail("CONFLICTING_SETTINGS", "oauthAudience");
  values.oauthAudience ??= values.publicUrl;
}
function validateAuthenticatedHttp(values: Source, selected: Selected): void {
  // Preserve inventory order for missing/conflicting matrix diagnostics.
  required(values, "publicUrl");
  required(values, "oauthMode");
  required(values, "oauthIssuer");
  validateIssuerAudience(values);
  if (
    !(values.oauthAllowedSubjects as readonly string[]).length &&
    !(values.oauthAllowedEmails as readonly string[]).length
  )
    fail("MISSING_REQUIRED", "oauthAllowedSubjects");
  if (values.oauthMode === "proxy") {
    required(values, "oauthUpstreamClientId");
    required(values, "oauthSigningKeyFile");
    required(values, "oauthAllowedRedirectUris");
    validateStateFile(values);
  } else rejectExplicit(selected, proxyKeys);
}
/** BR-290: the state file and its journal never coincide with the audit log. */
function validateStateFile(values: Source): void {
  const state = values.oauthStateFile as string | undefined;
  if (state === undefined) return;
  if (values.auditLog === state || values.auditLog === `${state}-journal`)
    fail("CONFLICTING_SETTINGS", "oauthStateFile");
}
function requireCredentials(values: Source): void {
  if (values.token === undefined && values.tokenFile === undefined)
    fail("MISSING_REQUIRED", "token");
  if (
    values.oauthMode === "proxy" &&
    values.oauthUpstreamClientSecret === undefined &&
    values.oauthUpstreamClientSecretFile === undefined
  )
    fail("MISSING_REQUIRED", "oauthUpstreamClientSecret");
}
export function crossFields(values: Source, selected: Selected): void {
  const drives = validateDrives(values);
  validateRoots(values, drives);
  if (values.transport === "stdio") rejectExplicit(selected, httpKeys);
  else if (values.insecureNoAuth) validateInsecureHttp(values, selected);
  else validateAuthenticatedHttp(values, selected);
  requireCredentials(values);
}

import { resolve } from "node:path";
import {
  ConfigurationError,
  controls,
  fail,
  integer,
  inventory,
  secretPairs,
  type ConfigurationInput,
  type LocalConfiguration,
  type PreflightResolver,
  type Source,
  type FileReader,
  type RootSelector,
} from "./config-schema.js";
import {
  decode,
  readBoundedFile,
  readSelected,
  refuseCredentialBom,
} from "./config-files.js";
import {
  cliSource,
  environmentSource,
  selectSources,
  yamlSource,
} from "./config-sources.js";
import { crossFields, validateValues } from "./config-values.js";
import type { DiagnosticRootPath } from "./deny-root-warning.js";
import { path as checkPath } from "./policy/values.js";
export {
  ConfigurationError,
  type ConfigurationInput,
  type LocalConfiguration,
  type RootSelector,
  type PreflightResolver,
  type FileReader,
} from "./config-schema.js";

const resolvedBrand: unique symbol = Symbol("resolved-configuration");
const resolvedInstances = new WeakSet<object>();
const diagnosticPaths = new WeakMap<
  ResolvedConfiguration,
  readonly DiagnosticRootPath[]
>();
/** BR-029: only the exact object returned by successful preflight is accepted. */
export function isResolvedConfiguration(
  value: unknown,
): value is ResolvedConfiguration {
  return (
    typeof value === "object" && value !== null && resolvedInstances.has(value)
  );
}
export interface ResolvedConfiguration extends Omit<
  LocalConfiguration,
  "roots"
> {
  readonly [resolvedBrand]: true;
  readonly resolvedRoots: readonly Readonly<{
    driveId: number;
    folderId: number;
  }>[];
}
function resolvedConfiguration(
  local: LocalConfiguration,
  roots: ResolvedConfiguration["resolvedRoots"],
): ResolvedConfiguration {
  const rest: Omit<LocalConfiguration, "roots"> & {
    roots?: LocalConfiguration["roots"];
  } = { ...local };
  delete rest.roots;
  const result = Object.freeze({
    ...rest,
    [resolvedBrand]: true as const,
    resolvedRoots: Object.freeze(roots),
  });
  resolvedInstances.add(result);
  return result;
}

async function loadYaml(
  configFile: string | undefined,
  cwd: string,
  reader: FileReader,
): Promise<Source> {
  if (configFile === undefined) return {};
  const data = await readSelected(
    reader,
    resolve(cwd, configFile),
    65536,
    false,
    "configFile",
  );
  try {
    return yamlSource(decode(data, "configFile", false));
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    return fail("CONFIG_SYNTAX", "configFile");
  }
}
/** BR-026 v3: trim four ASCII boundary byte values after read/limit/BOM checks. */
function trimSecretFile(data: Uint8Array): Uint8Array {
  const padding = (byte: number | undefined) =>
    byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a;
  let start = 0;
  let end = data.length;
  while (start < end && padding(data[start])) start += 1;
  while (end > start && padding(data[end - 1])) end -= 1;
  return data.subarray(start, end);
}
async function loadSecret(
  reader: FileReader,
  values: Source,
  [inline, file]: (typeof secretPairs)[number],
): Promise<string> {
  let value: string;
  if (values[file] === undefined) {
    value = values[inline] as string;
    if (Buffer.byteLength(value) > 16384) fail("LIMIT_EXCEEDED", inline);
  } else {
    const data = await readSelected(
      reader,
      values[file] as string,
      16384,
      true,
      file,
    );
    refuseCredentialBom(data, inline);
    value = decode(trimSecretFile(data), inline, true);
  }
  if (!value || controls.test(value)) fail("CREDENTIAL_INVALID", inline);
  return value;
}
async function loadSecrets(reader: FileReader, values: Source): Promise<void> {
  for (const pair of secretPairs) {
    const [inline, file] = pair;
    if (values[inline] === undefined && values[file] === undefined) continue;
    values[inline] = await loadSecret(reader, values, pair);
  }
}
async function loadSigning(
  reader: FileReader,
  reference: unknown,
): Promise<Uint8Array | undefined> {
  if (reference === undefined) return undefined;
  const data = await readSelected(
    reader,
    reference as string,
    65536,
    true,
    "oauthSigningKeyFile",
  );
  refuseCredentialBom(data, "oauthSigningKeyFile");
  const signing = trimSecretFile(data);
  if (!signing.length) fail("CREDENTIAL_INVALID", "oauthSigningKeyFile");
  return signing;
}
/** Pure construction: process state and file I/O are consulted only when called. */
export async function loadConfiguration(
  input: ConfigurationInput = {},
): Promise<LocalConfiguration> {
  const cli = cliSource(input.argv ?? process.argv.slice(2));
  const env = environmentSource(input.env ?? process.env);
  const cwd = input.cwd ?? process.cwd();
  const reader = input.readFile ?? readBoundedFile;
  const yaml = await loadYaml(cli.configFile, cwd, reader);
  const selected = selectSources(cli.source, env, yaml);
  const values = validateValues(selected, cwd);
  crossFields(values, selected);
  await loadSecrets(reader, values);
  const signing = await loadSigning(reader, values.oauthSigningKeyFile);
  // All fields are schema-normalized and requiredness is established above.
  return Object.freeze({
    ...values,
    effectiveSharedWrite:
      values.sharedWithMe === true &&
      values.sharedWrite === true &&
      values.mode !== "read",
    effectivePublicLinks:
      values.allowPublicLinks === true && values.mode === "share",
    ...(signing ? { oauthSigningKey: signing } : {}),
  }) as unknown as LocalConfiguration;
}
function record(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    return Object.fromEntries(
      fields.map((key) => [key, (value as Record<string, unknown>)[key]]),
    );
  } catch {
    return fail("PREFLIGHT_FAILED", "preflight");
  }
}
function returnedId(value: unknown): number | undefined {
  try {
    return integer(value, "preflight");
  } catch {
    return undefined;
  }
}
async function inspectConfiguredDrive(
  resolver: PreflightResolver,
  driveId: number,
): Promise<void> {
  let inspected: unknown;
  try {
    inspected = await resolver.inspectDrive(driveId);
  } catch {
    fail("PREFLIGHT_FAILED", "preflight");
  }
  const drive = record(inspected, ["id", "role"]);
  if (!drive || returnedId(drive.id) !== driveId || drive.role !== "admin")
    fail("DRIVE_NOT_ALLOWED", "driveIds");
}
async function resolveConfiguredRoot(
  resolver: PreflightResolver,
  selector: RootSelector,
): Promise<DiagnosticRootPath> {
  let resolved: unknown;
  try {
    resolved = await resolver.resolveDirectory(selector.driveId, selector);
  } catch {
    fail("PREFLIGHT_FAILED", "preflight");
  }
  const directory = record(resolved, ["driveId", "id", "type"]);
  const id = returnedId(directory?.id);
  if (
    !directory ||
    returnedId(directory.driveId) !== selector.driveId ||
    !id ||
    directory.type !== "dir" ||
    (selector.kind === "id" && id !== selector.value)
  )
    fail("ROOT_NOT_RESOLVED", "roots");
  return Object.freeze({
    driveId: selector.driveId,
    folderId: id,
    path: diagnosticPath(resolved),
  });
}
/** Optional evidence cannot turn a successful identity resolution into a failure. */
function diagnosticPath(resolved: unknown): string | null {
  try {
    return checkPath((resolved as Record<string, unknown>).path);
  } catch {
    return null;
  }
}
/**
 * BR-208: a frozen copy whose `token` is empty and which has no `tokenFile`.
 * Preflight and the runtimes receive only this copy; the adapter alone holds
 * the token.
 */
export function withoutCredential(
  local: LocalConfiguration,
): LocalConfiguration {
  const copy: Partial<LocalConfiguration> & { tokenFile?: string } = {
    ...local,
  };
  delete copy.tokenFile;
  return Object.freeze({ ...copy, token: "" }) as LocalConfiguration;
}
/** No credential is passed to the port; the composition binds it (BR-208). */
export async function preflightConfiguration(
  local: LocalConfiguration,
  resolver?: PreflightResolver,
): Promise<ResolvedConfiguration> {
  const result = await resolveConfiguration(local, resolver);
  diagnosticPaths.set(result.configuration, result.diagnosticRootPaths);
  return result.configuration;
}
/** BR-021 v3: one resolution, with identity-bound evidence kept outside BR-029. */
export async function preflightConfigurationWithDiagnosticPaths(
  local: LocalConfiguration,
  resolver?: PreflightResolver,
  preflight: typeof preflightConfiguration = preflightConfiguration,
): Promise<
  Readonly<{
    configuration: ResolvedConfiguration;
    diagnosticRootPaths: readonly DiagnosticRootPath[];
  }>
> {
  // Retain the existing composition port; call it exactly once. A replacement
  // that supplies no startup evidence leaves every diagnostic path unknown.
  const configuration = await preflight(local, resolver);
  return Object.freeze({
    configuration,
    diagnosticRootPaths:
      diagnosticPaths.get(configuration) ??
      Object.freeze(
        configuration.resolvedRoots.map((root) =>
          Object.freeze({ ...root, path: null }),
        ),
      ),
  });
}
async function resolveConfiguration(
  local: LocalConfiguration,
  resolver?: PreflightResolver,
): Promise<
  Readonly<{
    configuration: ResolvedConfiguration;
    diagnosticRootPaths: readonly DiagnosticRootPath[];
  }>
> {
  if (!resolver) fail("PREFLIGHT_UNAVAILABLE", "preflight");
  const roots: Array<Readonly<{ driveId: number; folderId: number }>> = [];
  const evidence = new Map<string, DiagnosticRootPath>();
  const conflicts = new Set<string>();
  try {
    for (const driveId of local.driveIds)
      await inspectConfiguredDrive(resolver, driveId);
    for (const selector of local.roots) {
      const root = await resolveConfiguredRoot(resolver, selector);
      const pair = `${String(root.driveId)}:${String(root.folderId)}`;
      const previous = evidence.get(pair);
      if (!previous) {
        roots.push(
          Object.freeze({ driveId: root.driveId, folderId: root.folderId }),
        );
        evidence.set(pair, root);
      } else if (!conflicts.has(pair) && root.path !== null) {
        if (previous.path !== null && previous.path !== root.path) {
          conflicts.add(pair);
          evidence.set(pair, Object.freeze({ ...root, path: null }));
        } else {
          evidence.set(pair, root);
        }
      }
    }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    fail("PREFLIGHT_FAILED", "preflight");
  }
  return Object.freeze({
    configuration: resolvedConfiguration(local, roots),
    diagnosticRootPaths: Object.freeze([...evidence.values()]),
  });
}
export const configurationHelp =
  "Usage: kdrive-mcp-server [--help | --version | OPTIONS]\n" +
  "Serve kDrive over stdio or HTTP after production preflight.\n" +
  "Sources: CLI > environment > explicitly selected YAML > defaults.\n" +
  "  --config PATH  Read one flat YAML configuration (no automatic file search).\n" +
  "  --http | --stdio  Select transport; --insecure-no-auth[=0|1] forces loopback.\n" +
  inventory
    .filter((row) => row[2] && row[0] !== "insecureNoAuth")
    .map((row) => `  --${row[2]} VALUE  (${row[1]})`)
    .join("\n") +
  "\n" +
  "Supply KDRIVE_TOKEN or --token-file and --drive-id or --drive-ids.\n";

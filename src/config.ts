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
import { decode, readBoundedFile, readSelected } from "./config-files.js";
import {
  cliSource,
  environmentSource,
  selectSources,
  yamlSource,
} from "./config-sources.js";
import { crossFields, validateValues } from "./config-values.js";
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
    value = decode(data, inline, true).replace(/\r?\n$/u, "");
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
  const signing = await readSelected(
    reader,
    reference as string,
    65536,
    true,
    "oauthSigningKeyFile",
  );
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
): Promise<Readonly<{ driveId: number; folderId: number }>> {
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
  return Object.freeze({ driveId: selector.driveId, folderId: id });
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
  if (!resolver) fail("PREFLIGHT_UNAVAILABLE", "preflight");
  const roots: Array<Readonly<{ driveId: number; folderId: number }>> = [];
  const seen = new Set<string>();
  try {
    for (const driveId of local.driveIds)
      await inspectConfiguredDrive(resolver, driveId);
    for (const selector of local.roots) {
      const root = await resolveConfiguredRoot(resolver, selector);
      const pair = `${String(root.driveId)}:${String(root.folderId)}`;
      if (!seen.has(pair)) {
        roots.push(root);
        seen.add(pair);
      }
    }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    fail("PREFLIGHT_FAILED", "preflight");
  }
  return resolvedConfiguration(local, roots);
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

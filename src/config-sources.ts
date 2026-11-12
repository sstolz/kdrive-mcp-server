import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  visit,
  type Document,
  type YAMLMap,
} from "yaml";
import {
  budget,
  fail,
  inventory,
  secretPairs,
  type DiagnosticSetting,
  type Selected,
  type Source,
  type Setting,
} from "./config-schema.js";
import { compareOrdinal } from "./config-text.js";

const options = new Map(
  inventory.filter((row) => row[2]).map((row) => [`--${row[2]}`, row[0]]),
);
const recognized = (arg: string) =>
  options.has(arg.split("=")[0] ?? "") ||
  ["--http", "--stdio", "--config", "--help", "--version"].includes(
    arg.split("=")[0] ?? "",
  );
interface CliSource {
  source: Source;
  configFile?: string;
}
interface CliOption {
  option: string;
  key: Setting | "configFile";
  equal: number;
}
function optionKey(option: string): CliOption["key"] {
  if (option === "--config") return "configFile";
  if (option === "--http" || option === "--stdio") return "transport";
  const key = options.get(option);
  if (!key) fail("UNKNOWN_OPTION", "cli");
  return key;
}
function parseOption(arg: string, seen: Set<string>): CliOption {
  const equal = arg.indexOf("=");
  const option = equal < 0 ? arg : arg.slice(0, equal);
  const key = optionKey(option);
  if (seen.has(option)) fail("DUPLICATE_OPTION", "cli");
  seen.add(option);
  return { option, key, equal };
}
function selectTransport(
  source: Source,
  parsed: CliOption,
  next: string | undefined,
): void {
  if (parsed.equal >= 0 || (next !== undefined && !next.startsWith("-")))
    fail("INVALID_VALUE", "transport");
  if (source.transport !== undefined) fail("CONFLICTING_SETTINGS", "transport");
  source.transport = parsed.option.slice(2);
}
function cliValue(
  argv: readonly string[],
  index: number,
  parsed: CliOption,
): { value: string; index: number } {
  if (parsed.equal >= 0)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
    return { value: argv[index]!.slice(parsed.equal + 1), index };
  if (parsed.option === "--insecure-no-auth") return { value: "1", index };
  const next = argv[index + 1];
  if (next === undefined || recognized(next)) fail("INVALID_VALUE", parsed.key);
  return { value: next, index: index + 1 };
}
function assignCliValue(
  result: CliSource,
  key: CliOption["key"],
  value: string,
): void {
  if (key === "configFile") {
    if (!value) fail("INVALID_VALUE", key);
    result.configFile = value;
  } else result.source[key] = value;
}
export function cliSource(argv: readonly string[]): CliSource {
  if (
    argv.length > 128 ||
    argv.reduce((n, arg) => n + Buffer.byteLength(arg), 0) > 131072
  )
    fail("LIMIT_EXCEEDED", "cli");
  if (argv.some((arg) => arg === "--help" || arg === "--version"))
    fail("INVALID_VALUE", "cli");
  const result: CliSource = { source: {} };
  const seen = new Set<string>();
  const rawValues: Array<{ key: DiagnosticSetting; value: string }> = [];
  let index = 0;
  while (index < argv.length) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
    const parsed = parseOption(argv[index]!, seen);
    if (parsed.key === "transport") {
      selectTransport(result.source, parsed, argv[index + 1]);
      index++;
      continue;
    }
    const next = cliValue(argv, index, parsed);
    index = next.index + 1;
    rawValues.push({ key: parsed.key, value: next.value });
    assignCliValue(result, parsed.key, next.value);
  }
  // Complete structure validation precedes all raw-value budgets (F-002 v2).
  for (const { key, value } of rawValues) budget(value, 65536, key);
  return result;
}
export function environmentSource(
  env: Readonly<Record<string, string | undefined>>,
): Source {
  const names = new Map(inventory.map((row) => [row[1], row[0]]));
  const source: Source = {};
  for (const name of Object.keys(env).sort(compareOrdinal))
    if (
      (/^(KDRIVE_|OAUTH_|MCP_HTTP_)/u.test(name) ||
        name === "MCP_PUBLIC_URL") &&
      !names.has(name as (typeof inventory)[number][1])
    )
      fail("UNKNOWN_SETTING", "environment");
  for (const [key, name] of inventory)
    if (Object.hasOwn(env, name) && env[name] !== undefined) {
      const value = env[name];
      budget(value, 65536, key);
      source[key] = value;
    }
  return source;
}
function validateYamlNodes(doc: Document, root: YAMLMap): void {
  visit(doc, (_key, node) => {
    if (isAlias(node) || (isMap(node) && node !== root))
      fail("CONFIG_SYNTAX", "configFile");
    if (
      (isScalar(node) || isMap(node) || isSeq(node)) &&
      (node.tag || node.anchor)
    )
      fail("CONFIG_SYNTAX", "configFile");
    if (isScalar(node) && node.value === null)
      fail("CONFIG_SYNTAX", "configFile");
  });
}
function validateYamlKeys(root: YAMLMap): void {
  const keys = new Set<Setting>(
    inventory.filter((row) => row[3] !== "secret").map((row) => row[0]),
  );
  for (const pair of root.items)
    if (
      !isScalar(pair.key) ||
      typeof pair.key.value !== "string" ||
      pair.key.value === "<<"
    )
      fail("CONFIG_SYNTAX", "configFile");
  for (const pair of root.items)
    if (!keys.has((pair.key as { value: Setting }).value))
      fail("UNKNOWN_SETTING", "configFile");
}
type Kind = (typeof inventory)[number][3];
function validYamlShape(kind: Kind, value: unknown): boolean {
  if (kind === "list" || kind === "ids")
    return (
      Array.isArray(value) &&
      value.every(
        (entry: unknown) =>
          typeof entry === "string" ||
          (kind === "ids" && typeof entry === "number"),
      )
    );
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "integer")
    return typeof value === "string" || typeof value === "number";
  return typeof value === "string";
}
function yamlValues(map: Map<Setting, unknown>): Source {
  const source: Source = {};
  for (const [key, , , kind] of inventory) {
    if (!map.has(key)) continue;
    const value = map.get(key);
    if (!validYamlShape(kind, value)) fail("INVALID_VALUE", key);
    source[key] = value;
  }
  return source;
}
export function yamlSource(text: string): Source {
  const docs = parseAllDocuments(text, {
    uniqueKeys: true,
    strict: true,
    version: "1.2",
    prettyErrors: false,
    logLevel: "silent",
  });
  if (docs.length !== 1) fail("CONFIG_SYNTAX", "configFile");
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
  const doc = docs[0]!;
  if (doc.errors.length || doc.warnings.length || !isMap(doc.contents))
    fail("CONFIG_SYNTAX", "configFile");
  validateYamlNodes(doc, doc.contents);
  validateYamlKeys(doc.contents);
  // No alias survives the AST pass; forbid expansion again at conversion.
  return yamlValues(
    doc.toJS({ mapAsMap: true, maxAliasCount: 0 }) as Map<Setting, unknown>,
  );
}
type PrioritizedSources = ReadonlyArray<
  readonly [Source, "cli" | "env" | "yaml"]
>;
function winningValue(
  sources: PrioritizedSources,
  key: Setting,
): Selected[Setting] {
  for (const [source, name] of sources)
    if (Object.hasOwn(source, key)) return { value: source[key], source: name };
  return undefined;
}
function selectPair(
  selected: Selected,
  sources: PrioritizedSources,
  inline: Setting,
  file: Setting,
): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- F-011: removes a named key from a locally built object; behaviour kept
  delete selected[inline];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- F-011: removes a named key from a locally built object; behaviour kept
  delete selected[file];
  for (const [source, name] of sources) {
    const hasInline = Object.hasOwn(source, inline);
    const hasFile = Object.hasOwn(source, file);
    if (!hasInline && !hasFile) continue;
    if (hasInline && hasFile) fail("CONFLICTING_SETTINGS", inline);
    const key = hasInline ? inline : file;
    selected[key] = { value: source[key], source: name };
    return;
  }
}
export function selectSources(
  cli: Source,
  env: Source,
  yaml: Source,
): Selected {
  const selected: Selected = {};
  const sources: PrioritizedSources = [
    [cli, "cli"],
    [env, "env"],
    [yaml, "yaml"],
  ];
  for (const [key, , , , fallback] of inventory) {
    const winning = winningValue(sources, key);
    if (winning) selected[key] = winning;
    else if (fallback !== undefined)
      selected[key] = { value: fallback, source: "default" };
  }
  for (const [inline, file] of secretPairs)
    selectPair(selected, sources, inline, file);
  return selected;
}

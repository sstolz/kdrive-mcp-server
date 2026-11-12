// F-023: secret-fed privacy scan (BR-342–BR-349, BR-352). Node built-ins only.
// The deny patterns come only from PRIVACY_DENY_PATTERNS. No output ever holds
// a pattern, matched text or text around a hit: only locations and numbers.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface Pattern {
  line: number;
  regex: RegExp;
}

class FixedExit extends Error {
  readonly text: string;
  constructor(text: string) {
    super("fixed exit");
    this.text = text;
  }
}

// BR-343: split on \n, drop a trailing \r, trim; skip blank and # lines; each
// remaining line is one regex with flags giu, numbered by its physical line.
export function parsePatterns(secret: string): Pattern[] {
  const patterns: Pattern[] = [];
  const lines = secret.split("\n");
  for (const [index, raw] of lines.entries()) {
    const text = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trim();
    if (text === "" || text.startsWith("#")) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(text, "giu");
    } catch {
      throw new FixedExit(
        `privacy-scan: pattern ${String(index + 1)} is not a valid regex`,
      );
    }
    patterns.push({ line: index + 1, regex });
  }
  return patterns;
}

// BR-349: every git child runs with piped stdio; stderr is discarded. The
// PRIVACY_* values never reach a child process.
const childEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("PRIVACY_")),
);
const MAX_BUFFER = 1024 * 1024 * 1024;
function gitRaw(
  args: string[],
  input?: Buffer,
): { status: number; out: Buffer } {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-023: the Docker-only dev image fixes PATH (Dockerfile.dev)
  const result = spawnSync("git", args, {
    env: childEnv,
    input,
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, out: result.stdout };
}
function git(args: string[], input?: Buffer): Buffer {
  const result = gitRaw(args, input);
  if (result.status !== 0) throw new Error("git failed");
  return result.out;
}

// BR-345: blobs come only from the object database, through one
// `git cat-file --batch` process per scan.
function readBlobs(ids: string[]): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  if (ids.length === 0) return blobs;
  const out = git(["cat-file", "--batch"], Buffer.from(`${ids.join("\n")}\n`));
  let offset = 0;
  for (const id of ids) {
    const end = out.indexOf(0x0a, offset);
    if (end < 0) throw new Error("truncated batch output");
    const header = out.subarray(offset, end).toString("latin1").split(" ");
    if (header.length !== 3 || header[0] !== id)
      throw new Error("unexpected batch header");
    const size = Number.parseInt(header[2] ?? "", 10);
    if (!Number.isSafeInteger(size)) throw new Error("bad batch size");
    blobs.set(id, out.subarray(end + 1, end + 1 + size));
    offset = end + 1 + size + 1;
  }
  return blobs;
}

// BR-345 decoding: UTF-16 by BOM; else strict UTF-8 without NUL (UTF-8 BOM
// removed); anything else is binary (undefined).
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const UTF16 = new TextDecoder("utf-16le", { ignoreBOM: true });
export function decode(blob: Buffer): string | undefined {
  if (blob.length >= 2 && blob[0] === 0xff && blob[1] === 0xfe)
    return UTF16.decode(blob.subarray(2));
  if (blob.length >= 2 && blob[0] === 0xfe && blob[1] === 0xff) {
    const swapped = Buffer.from(blob.subarray(2));
    const even = swapped.length - (swapped.length % 2);
    swapped.subarray(0, even).swap16();
    return UTF16.decode(swapped);
  }
  if (blob.includes(0)) return undefined;
  try {
    return UTF8.decode(blob);
  } catch {
    return undefined;
  }
}

// BR-345 views: %XX percent-decoding, HTML numeric entities.
function percentDecode(line: string): string {
  return line.replaceAll(/(?:%[0-9A-Fa-f]{2})+/gu, (run) => {
    const bytes = Buffer.from(run.replaceAll("%", ""), "hex");
    try {
      return UTF8.decode(bytes);
    } catch {
      return bytes.toString("latin1");
    }
  });
}
function entityDecode(line: string): string {
  return line.replaceAll(
    /&#(?:(\d{1,7})|[xX]([0-9A-Fa-f]{1,6}));/gu,
    (entity, decimal?: string, hex?: string) => {
      const code =
        decimal === undefined
          ? Number.parseInt(hex ?? "", 16)
          : Number.parseInt(decimal, 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}
function matches(regex: RegExp, text: string): boolean {
  regex.lastIndex = 0;
  const found = regex.test(text);
  regex.lastIndex = 0;
  return found;
}

type LineHits = Map<number, Set<number>>;
function addHit(result: LineHits, line: number, pattern: number): void {
  const set = result.get(line) ?? new Set<number>();
  set.add(pattern);
  result.set(line, set);
}

// The as-is lines joined by single spaces (blank lines dropped), with the
// offset and 1-based number of each joined line.
interface Collapsed {
  text: string;
  starts: number[];
  numbers: number[];
}
function collapse(lines: string[]): Collapsed {
  const collapsed: Collapsed = { text: "", starts: [], numbers: [] };
  for (const [index, line] of lines.entries()) {
    if (line === "") continue;
    if (collapsed.text !== "") collapsed.text += " ";
    collapsed.starts.push(collapsed.text.length);
    collapsed.numbers.push(index + 1);
    collapsed.text += line;
  }
  return collapsed;
}
function lineAt(collapsed: Collapsed, offset: number): number {
  let position = 0;
  while ((collapsed.starts[position + 1] ?? Infinity) <= offset) position += 1;
  return collapsed.numbers[position] ?? 1;
}

// Returns, per 1-based line, the set of pattern numbers that hit it: three
// views per line, then the as-is text with line breaks collapsed to single
// spaces, a hit placed at the line where the match starts.
export function scanText(text: string, patterns: Pattern[]): LineHits {
  const result: LineHits = new Map();
  const lines = text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  for (const [index, line] of lines.entries())
    for (const view of [line, percentDecode(line), entityDecode(line)])
      for (const pattern of patterns)
        if (matches(pattern.regex, view))
          addHit(result, index + 1, pattern.line);
  const collapsed = collapse(lines);
  for (const pattern of patterns)
    for (const match of collapsed.text.matchAll(pattern.regex))
      addHit(result, lineAt(collapsed, match.index), pattern.line);
  return result;
}
function patternsIn(text: string, patterns: Pattern[]): Set<number> {
  const all = new Set<number>();
  for (const set of scanText(text, patterns).values())
    for (const pattern of set) all.add(pattern);
  return all;
}

interface Counters {
  hits: string[];
  files: number;
  binary: number;
  gitlinks: number;
  commits: number;
}
function hit(counters: Counters, location: string, pattern: number): void {
  counters.hits.push(
    `privacy-scan: hit ${location} pattern ${String(pattern)}`,
  );
}
function report(
  counters: Counters,
  prefix: (line: number) => string,
  found: Map<number, Set<number>>,
): void {
  for (const line of [...found.keys()].sort((a, b) => a - b))
    for (const pattern of [...(found.get(line) ?? [])].sort((a, b) => a - b))
      hit(counters, prefix(line), pattern);
}

const GITLINK = "160000";
const ZERO_ID = /^0+$/u;

// BR-345 / BR-348: the tracked entries of `git ls-files -z -s`.
function scanEntries(patterns: Pattern[], counters: Counters): void {
  const entries = git(["ls-files", "-z", "-s"])
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode = "", id = ""] = entry.slice(0, tab).split(" ");
      return { mode, id, path: entry.slice(tab + 1) };
    });
  const blobIds = [
    ...new Set(
      entries
        .filter((entry) => entry.mode !== GITLINK)
        .map((entry) => entry.id),
    ),
  ];
  const blobs = readBlobs(blobIds);
  for (const [index, entry] of entries.entries()) {
    if (entry.mode === GITLINK) {
      counters.gitlinks += 1;
      continue;
    }
    counters.files += 1;
    const pathHits = patternsIn(entry.path, patterns);
    const name = pathHits.size > 0 ? `file #${String(index + 1)}` : entry.path;
    for (const pattern of [...pathHits].sort((a, b) => a - b))
      hit(counters, `path ${name}`, pattern);
    const text = decode(blobs.get(entry.id) ?? Buffer.alloc(0));
    if (text === undefined) {
      counters.binary += 1;
      continue;
    }
    report(
      counters,
      (line) => `${name}:${String(line)}`,
      scanText(text, patterns),
    );
  }
}

// Returns the commit id, or undefined when the ref is not a commit in the
// clone; any other git failure (no repository) throws.
function resolveCommit(ref: string): string | undefined {
  if (ref === "" || ref.startsWith("-")) return undefined;
  const result = gitRaw([
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  if (result.status === 1) return undefined;
  if (result.status !== 0) throw new Error("git failed");
  return result.out.toString("utf8").trim();
}

// BR-346: the commits of `<base>..<head>`, or the full history of the head
// on workflow_dispatch and for an empty, all-zero or unknown base.
function rangeCommits(base: string, head: string, event: string): string[] {
  const resolvedBase =
    event === "workflow_dispatch" || /^0{40}$/u.test(base)
      ? undefined
      : resolveCommit(base);
  const range =
    resolvedBase === undefined ? [head] : [`${resolvedBase}..${head}`];
  return git(["rev-list", "--reverse", ...range])
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");
}

// Every path of a commit, with the new blob id unless it is deleted (all
// zeros) or a gitlink. Merge commits list nothing (no -m).
interface Change {
  path: string;
  id?: string;
}
function changedEntries(commit: string): Change[] {
  const fields = git([
    "diff-tree",
    "-r",
    "--no-renames",
    "--no-commit-id",
    "--root",
    "-z",
    commit,
  ])
    .toString("utf8")
    .split("\0");
  const list: Change[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, newMode = "", , newId = ""] = (fields[index] ?? "")
      .slice(1)
      .split(" ");
    const path = fields[index + 1] ?? "";
    const scanBlob = !ZERO_ID.test(newId) && newMode !== GITLINK;
    list.push(scanBlob ? { path, id: newId } : { path });
  }
  return list;
}

// A cache private to the commit scan: each blob id is read and decoded once;
// a binary blob counts once.
function scanCommitBlobs(
  ids: Set<string>,
  patterns: Pattern[],
  counters: Counters,
): Map<string, Set<number>> {
  const cache = new Map<string, Set<number>>();
  for (const [id, blob] of readBlobs([...ids])) {
    const text = decode(blob);
    if (text === undefined) counters.binary += 1;
    cache.set(id, text === undefined ? new Set() : patternsIn(text, patterns));
  }
  return cache;
}

function sorted(set: Set<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

function scanCommitMeta(
  commit: string,
  patterns: Pattern[],
  counters: Counters,
): void {
  const message = git(["log", "-1", "--format=%B", commit]).toString("utf8");
  report(
    counters,
    (line) => `commit ${commit} line ${String(line)}`,
    scanText(message, patterns),
  );
  const identity = new Set<number>();
  const names = git(["log", "-1", "--format=%an%x00%ae%x00%cn%x00%ce", commit])
    .toString("utf8")
    .trimEnd()
    .split("\0");
  for (const name of names)
    for (const pattern of patternsIn(name, patterns)) identity.add(pattern);
  for (const pattern of sorted(identity))
    hit(counters, `commit ${commit} identity`, pattern);
}

// BR-346: commit messages, identities, changed blobs and paths of the range.
function scanCommits(
  commits: string[],
  patterns: Pattern[],
  counters: Counters,
): void {
  counters.commits = commits.length;
  const changes = new Map(
    commits.map((commit) => [commit, changedEntries(commit)]),
  );
  const ids = new Set(
    [...changes.values()].flat().flatMap((change) => change.id ?? []),
  );
  const cache = scanCommitBlobs(ids, patterns, counters);
  for (const commit of commits) {
    scanCommitMeta(commit, patterns, counters);
    const added = new Set<number>();
    for (const change of changes.get(commit) ?? [])
      for (const pattern of [
        ...patternsIn(change.path, patterns),
        ...(cache.get(change.id ?? "") ?? []),
      ])
        added.add(pattern);
    for (const pattern of sorted(added))
      hit(counters, `commit ${commit} added`, pattern);
  }
}

function run(env: NodeJS.ProcessEnv): { stdout: string; status: number } {
  const patterns = parsePatterns(env.PRIVACY_DENY_PATTERNS ?? "");
  if (patterns.length === 0)
    throw new FixedExit("privacy-scan: no pattern is configured");
  const event = env.PRIVACY_EVENT ?? "";
  const head = resolveCommit(env.PRIVACY_RANGE_HEAD ?? "");
  if (head === undefined)
    throw new FixedExit("privacy-scan: head is not a commit");
  const counters: Counters = {
    hits: [],
    files: 0,
    binary: 0,
    gitlinks: 0,
    commits: 0,
  };
  scanEntries(patterns, counters);
  scanCommits(
    rangeCommits(env.PRIVACY_RANGE_BASE ?? "", head, event),
    patterns,
    counters,
  );
  // BR-347: pull-request text only on pull_request.
  if (event === "pull_request") {
    report(
      counters,
      (line) => `pr-title:${String(line)}`,
      scanText(env.PRIVACY_PR_TITLE ?? "", patterns),
    );
    report(
      counters,
      (line) => `pr-body:${String(line)}`,
      scanText(env.PRIVACY_PR_BODY ?? "", patterns),
    );
  }
  const summary = `privacy-scan: ${String(counters.hits.length)} hits, ${String(counters.files)} files, ${String(counters.binary)} binary skipped, ${String(counters.gitlinks)} gitlinks skipped, ${String(counters.commits)} commits, ${String(patterns.length)} patterns`;
  return {
    stdout: `${[...counters.hits, summary].join("\n")}\n`,
    status: counters.hits.length === 0 ? 0 : 1,
  };
}

// BR-344 / BR-349: fixed messages and one top-level handler; nothing is
// printed on stdout before the whole scan succeeded.
export function main(): void {
  try {
    const { stdout, status } = run(process.env);
    process.stdout.write(stdout);
    process.exitCode = status;
  } catch (error) {
    process.stderr.write(
      `${error instanceof FixedExit ? error.text : "privacy-scan: internal error"}\n`,
    );
    process.exitCode = 2;
  }
}

// Resolve symlinks on both sides so a symlinked invocation still runs the
// scan instead of exiting 0 silently.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  main();

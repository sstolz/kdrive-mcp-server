// #95: builds the public tree of this repository from a Git ref of the
// private archive. The private tree is never rewritten: the export happens in
// an ignored output directory, is scanned with a private deny list and gets a
// deterministic root commit there. Procedure: ops/public/README.md (private).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Repository = { owner: string; name: string };
export type Substitution = { from: string; to: string };
export type DenyPattern = { source: string; regex: RegExp };
export type Hit = { path: string; line: number; pattern: string };
export type Source = { sha: string; date: string };
export type ExportResult = {
  removed: string[];
  changed: string[];
  added: string[];
  hits: Hit[];
  /** Files scanned only as best-effort binary text (`B` manifest lines). */
  binaries: string[];
  /** Binary files absent from `allow-binaries.txt`; each fails the export. */
  unallowedBinaries: string[];
};

export const PUBLIC_REPOSITORY: Repository = {
  owner: "sstolz",
  name: "kdrive-mcp-server",
};
export const PUBLIC_IDENTITY = {
  name: "sstolz",
  email: "2139682+sstolz@users.noreply.github.com",
};

/**
 * Any e-mail address, except reserved example domains (`example`,
 * `example.<tld>`), reserved fixture TLDs (`.test`, `.invalid`, `.localhost`)
 * and GitHub no-reply addresses. Always part of the deny scan.
 */
export const EMAIL_PATTERN = String.raw`[a-z0-9._%+-]+@(?!(?:[a-z0-9-]+\.)*(?:example(?:\.[a-z]+)?|test|invalid|localhost)(?![a-z0-9.-]))(?!users\.noreply\.github\.com(?![a-z0-9.-]))[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}`;

/** Non-empty lines without `#` comments, trimmed. */
export function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Literal `from<TAB>to` lines; `#` comments and blank lines are skipped. */
export function parseSubstitutions(text: string): Substitution[] {
  const result: Substitution[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    const [from, to] = fields;
    if (fields.length !== 2 || !from || to === undefined)
      throw new Error(
        `substitutions line ${String(index + 1)}: want from<TAB>to`,
      );
    result.push({ from, to });
  }
  return result;
}

/** Case-insensitive deny regexes, one per line; the e-mail rule is built in. */
export function parseDenyPatterns(text: string): DenyPattern[] {
  return [...parseLines(text), EMAIL_PATTERN].map((source) => ({
    source,
    regex: new RegExp(source, "giu"),
  }));
}

/** An entry ending with `/` excludes a directory; any other an exact path. */
export function isExcluded(path: string, entries: readonly string[]): boolean {
  return entries.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );
}

export function applySubstitutions(
  text: string,
  substitutions: readonly Substitution[],
): string {
  let result = text;
  for (const { from, to } of substitutions)
    result = result.replaceAll(from, to);
  return result;
}

const escape = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const isRelative = (target: string) =>
  !/^[a-z][a-z0-9+.-]*:/iu.test(target) && !target.startsWith("//");

function archivedEvidence(path: string): string {
  return `archived evidence \`${path}\``;
}

function describeRelative(
  target: string,
  removed: Removed | undefined,
): string | undefined {
  const runs = /(?:^|\/)(runs\/[^#?]*)/u.exec(target);
  if (runs?.[1]) return archivedEvidence(runs[1]);
  if (!removed) return undefined;
  const [file = ""] = target.split(/[#?]/u, 1);
  const path = posix.normalize(posix.join(posix.dirname(removed.from), file));
  return removed.paths(path) ? `archive \`${path}\`` : undefined;
}

const issueKind = (kind: string) =>
  kind === "pull" || kind === "pulls" ? "PR" : "issue";

/** A revision page (`blob`, `tree`, `commit`, `compare`) as plain text. */
function describeRevision(kind: string, rest: string): string {
  const [revision = "", ...parts] = rest.split("/");
  if (revision === "") return `archive ${kind} page`;
  const short = revision.slice(0, 12);
  const path = parts.join("/");
  if (path.startsWith("runs/")) return archivedEvidence(path);
  return path
    ? `archive \`${path}\` at \`${short}\``
    : `archive commit \`${short}\``;
}

/** A page of the private repository as plain text, never as `#N`. */
function describePage(kind: string, rest: string): string | undefined {
  if (kind === "issues" || kind === "pull") {
    const number = /^\d+/u.exec(rest);
    return number ? `archive ${issueKind(kind)} ${number[0]}` : undefined;
  }
  if (kind === "projects") return "archive project board";
  if (["blob", "tree", "commit", "compare"].includes(kind))
    return describeRevision(kind, rest);
  return `archive ${kind} page`;
}

/** The plain-text replacement of a link target, or undefined to keep it. */
export function describeTarget(
  target: string,
  repository: Repository,
  removed?: Removed,
): string | undefined {
  if (isRelative(target)) return describeRelative(target, removed);
  const owner = escape(repository.owner);
  const name = escape(repository.name);
  const base = String.raw`^https?://(?:www\.)?github\.com/`;
  const project = new RegExp(`${base}users/${owner}/projects/`, "iu");
  if (project.test(target)) return "archive project board";
  const api = new RegExp(
    String.raw`^https?://api\.github\.com/repos/${owner}/${name}/(issues|pulls)/(\d+)`,
    "iu",
  ).exec(target);
  if (api?.[1] && api[2])
    return `archive ${issueKind(api[1].toLowerCase())} ${api[2]}`;
  const own = new RegExp(
    `${base}${owner}/${name}/(${PRIVATE_KINDS.join("|")})/([^?#]*)`,
    "iu",
  ).exec(target);
  if (!own?.[1]) return undefined;
  return describePage(own[1].toLowerCase(), own[2] ?? "");
}

/** Private repository page kinds that a public tree never links to. */
const PRIVATE_KINDS = [
  "issues",
  "pull",
  "commit",
  "commits",
  "blob",
  "tree",
  "actions",
  "discussions",
  "milestone",
  "projects",
  "compare",
  "releases",
];

// A link text holds no `]`, spans at most four lines and stays bounded.
const LINK =
  /(!?)\[([^\]]{0,400})\]\(\s*<?([^\s)>]{1,2000})>?(?:\s+"[^"\n]{0,200}")?\s*\)/gu;
const BARE_URL = /<?(https?:\/\/[^\s)<>\]`"']{1,2000})>?/gu;

/**
 * Rewrites Markdown links into plain text: links to archived evidence under
 * `runs/`, and links and bare URLs to the private issues, pull requests,
 * revisions and project board of the repository. Other links stay unchanged.
 */
/** The file being rewritten and the test for paths removed from the tree. */
export type Removed = { from: string; paths: (path: string) => boolean };

export function rewriteMarkdown(
  text: string,
  repository: Repository,
  removed?: Removed,
): string {
  const linked = text.replaceAll(
    LINK,
    (whole, _image: string, label: string, target: string) => {
      const description = describeTarget(target, repository, removed);
      if (description === undefined) return whole;
      return label.trim() === "" ? description : `${label} (${description})`;
    },
  );
  return linked.replaceAll(BARE_URL, (whole, url: string) => {
    let trimmed = url;
    while (/[.,;:]$/u.test(trimmed)) trimmed = trimmed.slice(0, -1);
    const description = describeTarget(trimmed, repository);
    if (description === undefined) return whole;
    const tail = url.slice(trimmed.length);
    return `${description}${tail}`;
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  hyphen: "-",
  dash: "-",
  period: ".",
  lowbar: "_",
  commat: "@",
  sol: "/",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
};

/** Decodes `%XX` runs (as UTF-8, else Latin-1) and HTML entities. */
export function normalizeEncoded(text: string): string {
  const percent = text.replaceAll(/(?:%[0-9a-f]{2})+/giu, (run) => {
    const bytes = Buffer.from(run.replaceAll("%", ""), "hex");
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    return utf8.includes("\uFFFD") ? bytes.toString("latin1") : utf8;
  });
  return percent.replaceAll(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/giu,
    (whole, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined)
        return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
      const code = Number.parseInt(decimal ?? hex ?? "", decimal ? 10 : 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/**
 * The deny hits of one file, as path, 1-based line and pattern source. Each
 * line is scanned as is and after `normalizeEncoded`; the whole normalized
 * text is scanned again with line breaks collapsed to single spaces, so a
 * name wrapped over two lines is found, reported at the line where the
 * match starts. One hit per line and pattern.
 */
export function scanText(
  path: string,
  text: string,
  patterns: readonly DenyPattern[],
  allowed: readonly string[] = [],
): Hit[] {
  const allow = new Set(allowed.map((value) => value.toLowerCase()));
  const lines = text.split("\n");
  const normalized = lines.map(normalizeEncoded);
  const starts: number[] = [];
  let offset = 0;
  const collapsed = normalized
    .map((line, index) => {
      const trimmed = index === 0 ? line.trimEnd() : line.trim();
      starts.push(offset);
      offset += trimmed.length + 1;
      return trimmed;
    })
    .join(" ");
  const lineAt = (index: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= index) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  const found = new Set<string>();
  const hits: Hit[] = [];
  const report = (line: number, pattern: string) => {
    const key = `${String(line)}\0${pattern}`;
    if (found.has(key)) return;
    found.add(key);
    hits.push({ path, line, pattern });
  };
  const denied = (regex: RegExp, value: string) => {
    for (const match of value.matchAll(regex))
      if (!allow.has(match[0].toLowerCase())) return match;
    return undefined;
  };
  for (const [index, line] of lines.entries())
    for (const { source, regex } of patterns)
      if (
        denied(regex, line) ??
        (normalized[index] === line
          ? undefined
          : denied(regex, normalized[index] ?? ""))
      )
        report(index + 1, source);
  for (const { source, regex } of patterns)
    for (const match of collapsed.matchAll(regex))
      if (!allow.has(match[0].toLowerCase()))
        report(lineAt(match.index), source);
  return hits.sort((left, right) => left.line - right.line);
}

export function formatHit(hit: Hit): string {
  return `${hit.path}:${String(hit.line)}: ${hit.pattern}`;
}

/** The scan text of a file and whether it is binary. */
export type Decoded = {
  text: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "latin1" | "binary";
};

/**
 * Decodes file bytes for the scan; nothing is skipped. A UTF-16 BOM selects
 * UTF-16; valid UTF-8 without NUL bytes is UTF-8; other bytes without NUL
 * are Latin-1 text. Bytes with NUL are binary: they are still scanned as
 * Latin-1 with the NUL bytes removed (which also exposes UTF-16 text without
 * BOM), but a binary file must be listed in `allow-binaries.txt`.
 */
export function decodeContent(buffer: Buffer): Decoded {
  const [first, second] = buffer;
  if (first === 0xff && second === 0xfe)
    return {
      text: new TextDecoder("utf-16le").decode(buffer),
      encoding: "utf-16le",
    };
  if (first === 0xfe && second === 0xff)
    return {
      text: new TextDecoder("utf-16be").decode(buffer),
      encoding: "utf-16be",
    };
  if (buffer.includes(0))
    return {
      text: buffer.toString("latin1").replaceAll("\0", ""),
      encoding: "binary",
    };
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return { text: utf8.decode(buffer), encoding: "utf-8" };
  } catch {
    return { text: buffer.toString("latin1"), encoding: "latin1" };
  }
}

/** The Git blob SHA-1 of some bytes, as `git hash-object` computes it. */
export function gitBlobSha(content: Buffer): string {
  // eslint-disable-next-line sonarjs/hashing -- a Git object ID (SHA-1 by Git's format), compared with Git's own; not a security use
  return createHash("sha1")
    .update(`blob ${String(content.length)}\0`)
    .update(content)
    .digest("hex");
}

/** The Git file mode of a path of the tree. */
function gitMode(file: string): string {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) return "120000";
  return (stat.mode & 0o100) === 0 ? "100644" : "100755";
}

/** Regular files under a directory, as sorted POSIX paths; `.git` skipped. */
export function listFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, path));
    else if (entry.isFile() || entry.isSymbolicLink())
      files.push(relative(root, path).split(sep).join("/"));
  }
  return files.sort(byCodeUnit);
}

/** Locale-independent order, so manifests are the same everywhere. */
export function byCodeUnit(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** File bytes, or the target of a symbolic link (never followed). */
function contentOf(file: string): Buffer {
  return lstatSync(file).isSymbolicLink()
    ? Buffer.from(readlinkSync(file))
    : readFileSync(file);
}

/**
 * Runs a tool of the dev image. The Docker-only dev image fixes PATH
 * (Dockerfile.dev); the commands are fixed names, never input.
 */
function run(
  command: "git" | "tar",
  args: string[],
  options: Parameters<typeof execFileSync>[2] = {},
): Buffer {
  return execFileSync(command, args, {
    maxBuffer: 1 << 30,
    ...options,
  }) as Buffer;
}

function removeEmptyParents(root: string, path: string) {
  let current = dirname(join(root, path));
  while (current !== root && readdirSync(current).length === 0) {
    rmdirSync(current);
    current = dirname(current);
  }
}

export function stampPath(out: string): string {
  return `${resolve(out)}.export.json`;
}

/**
 * Prepares an empty output directory. A non-empty one is removed only when
 * this tool's stamp beside it shows that it made it; otherwise it refuses.
 */
export function prepareOutput(out: string) {
  const stamp = stampPath(out);
  if (existsSync(out) && readdirSync(out).length > 0) {
    if (!existsSync(stamp))
      throw new Error(
        `${out} exists, is not empty and has no export stamp: refusing to remove it`,
      );
    rmSync(out, { recursive: true });
  }
  rmSync(stamp, { force: true });
  mkdirSync(out, { recursive: true });
}

/** The archive of a ref and its commit SHA and committer date, from Git. */
export function readSource(
  repositoryDirectory: string,
  ref: string,
): { archive: Buffer; source: Source } {
  const git = (...args: string[]) =>
    run("git", args, { cwd: repositoryDirectory });
  const [sha = "", date = ""] = git("log", "-1", "--format=%H%n%cI", ref, "--")
    .toString("utf8")
    .trim()
    .split("\n");
  return {
    archive: git("archive", "--format=tar", sha),
    source: { sha, date },
  };
}

/** Reformats a rewritten text file (Markdown tables change width). */
export type Formatter = (path: string, text: string) => Promise<string>;

export type ExportOptions = {
  archive: Buffer;
  source: Source;
  out: string;
  config: string;
  repository?: Repository;
  format?: Formatter;
};

function readConfig(config: string, name: string): string {
  const path = join(config, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** `path<SPACE>blob-sha` lines, or `path -` for a path absent from the ref. */
export function parseOverlayLock(text: string): Map<string, string> {
  const lock = new Map<string, string>();
  for (const line of parseLines(text)) {
    const match = /^(\S+)\s+([0-9a-f]{40}|-)$/u.exec(line);
    if (!match?.[1] || !match[2])
      throw new Error(`overlay.lock: want "path blob-sha", got "${line}"`);
    lock.set(match[1], match[2]);
  }
  return lock;
}

/**
 * Refuses an overlay whose source files changed since its curation: each
 * overlaid path needs an `overlay.lock` entry with the ref's blob SHA (`-`
 * when the ref has no such file), so a new private line cannot vanish under
 * a stale overlay.
 */
export function checkOverlay(
  overlayFiles: readonly string[],
  lock: ReadonlyMap<string, string>,
  original: ReadonlyMap<string, Buffer>,
) {
  const problems: string[] = [];
  for (const path of overlayFiles) {
    const locked = lock.get(path);
    const content = original.get(path);
    const actual = content ? gitBlobSha(content) : "-";
    if (locked === undefined)
      problems.push(`${path}: no overlay.lock entry (source blob ${actual})`);
    else if (locked !== actual)
      problems.push(
        `${path}: the source blob is ${actual}, overlay.lock has ${locked}; curate the overlay again, then update overlay.lock`,
      );
  }
  for (const path of lock.keys())
    if (!overlayFiles.includes(path))
      problems.push(`${path}: in overlay.lock but not in the overlay`);
  if (problems.length > 0)
    throw new Error(`overlay drift:\n${problems.join("\n")}`);
}

/** The recorded state of an export, beside the output directory. */
export type Stamp = Source & {
  hits: number;
  unallowedBinaries: number;
  /** Every exported path with its Git mode and blob SHA. */
  files: Record<string, string>;
};

/** The deny rules, allowed literals and allowed binaries of a configuration. */
type ScanConfig = {
  patterns: DenyPattern[];
  allowed: string[];
  allowedBinaries: Set<string>;
};

function readScanConfig(config: string): ScanConfig {
  return {
    patterns: parseDenyPatterns(readConfig(config, "deny-patterns.txt")),
    allowed: parseLines(readConfig(config, "allow-literals.txt")),
    allowedBinaries: new Set(
      parseLines(readConfig(config, "allow-binaries.txt")),
    ),
  };
}

/** Removes the excluded paths of an extracted tree and returns them. */
function removeExcluded(
  out: string,
  paths: Iterable<string>,
  exclude: readonly string[],
): string[] {
  const removed = [...paths].filter((path) => isExcluded(path, exclude));
  for (const path of removed) {
    rmSync(join(out, path));
    removeEmptyParents(out, path);
  }
  return removed;
}

/** Rewrites Markdown links, applies substitutions and reformats a change. */
async function cleanText(
  path: string,
  text: string,
  context: {
    repository: Repository;
    exclude: readonly string[];
    substitutions: readonly Substitution[];
    format: Formatter | undefined;
  },
): Promise<string> {
  let result = path.endsWith(".md")
    ? rewriteMarkdown(text, context.repository, {
        from: path,
        paths: (candidate) => isExcluded(candidate, context.exclude),
      })
    : text;
  result = applySubstitutions(result, context.substitutions);
  if (result !== text && context.format)
    result = await context.format(path, result);
  return result;
}

/**
 * Decodes a file and rewrites it in place when it is a UTF-8 regular file;
 * other encodings and symbolic link targets are only scanned. Returns the
 * text to scan.
 */
async function rewriteFile(
  file: string,
  clean: (text: string) => Promise<string>,
): Promise<Decoded> {
  const decoded = decodeContent(contentOf(file));
  if (lstatSync(file).isSymbolicLink() || decoded.encoding !== "utf-8")
    return decoded;
  const text = await clean(decoded.text);
  if (text !== decoded.text) writeFileSync(file, text);
  return { text, encoding: decoded.encoding };
}

/** Extracts, cleans, rewrites and scans the tree; writes the stamp. */
export async function exportTree(
  options: ExportOptions,
): Promise<ExportResult> {
  const { out, config, source } = options;
  if (!existsSync(join(config, "exclude.txt")))
    throw new Error(
      `${config}/exclude.txt is missing: no export configuration`,
    );
  const repository = options.repository ?? PUBLIC_REPOSITORY;
  const exclude = parseLines(readConfig(config, "exclude.txt"));
  const substitutions = parseSubstitutions(
    readConfig(config, "substitutions.tsv"),
  );
  const scan = readScanConfig(config);
  const lock = parseOverlayLock(readConfig(config, "overlay.lock"));
  prepareOutput(out);
  run("tar", ["-xf", "-", "-C", out], { input: options.archive });
  const original = new Map<string, Buffer>();
  for (const path of listFiles(out))
    original.set(path, contentOf(join(out, path)));
  const overlay = join(config, "overlay");
  const overlayFiles = existsSync(overlay) ? listFiles(overlay) : [];
  checkOverlay(overlayFiles, lock, original);
  const removed = removeExcluded(out, original.keys(), exclude);
  if (overlayFiles.length > 0) cpSync(overlay, out, { recursive: true });
  const clean = (path: string, text: string) =>
    cleanText(path, text, {
      repository,
      exclude,
      substitutions,
      format: options.format,
    });
  const result: ExportResult = {
    removed,
    changed: [],
    added: [],
    hits: [],
    binaries: [],
    unallowedBinaries: [],
  };
  const files: Record<string, string> = {};
  for (const path of listFiles(out)) {
    const file = join(out, path);
    const { text, encoding } = await rewriteFile(file, (value) =>
      clean(path, value),
    );
    result.hits.push(...scanText(path, text, scan.patterns, scan.allowed));
    if (encoding === "binary") result.binaries.push(path);
    const before = original.get(path);
    const after = contentOf(file);
    files[path] = `${gitMode(file)} ${gitBlobSha(after)}`;
    if (!before || isExcluded(path, exclude)) result.added.push(path);
    else if (!before.equals(after)) result.changed.push(path);
  }
  result.unallowedBinaries = result.binaries.filter(
    (path) => !scan.allowedBinaries.has(path),
  );
  const stamp: Stamp = {
    ...source,
    hits: result.hits.length,
    unallowedBinaries: result.unallowedBinaries.length,
    files,
  };
  writeFileSync(stampPath(out), `${JSON.stringify(stamp, null, 2)}\n`);
  return result;
}

/** Prettier with the exported tree's own configuration and ignore file. */
export async function prettierFormatter(out: string): Promise<Formatter> {
  const prettier = await import("prettier");
  const ignorePath = join(resolve(out), ".prettierignore");
  return async (path, text) => {
    const file = join(resolve(out), path);
    const info = await prettier.getFileInfo(file, { ignorePath });
    if (info.ignored || info.inferredParser === null) return text;
    const config = await prettier.resolveConfig(file);
    return prettier.format(text, { ...config, filepath: file });
  };
}

export function formatManifest(source: Source, result: ExportResult): string {
  return [
    `# Public export manifest`,
    `source ${source.sha}`,
    `committer-date ${source.date}`,
    `removed ${String(result.removed.length)}`,
    `changed ${String(result.changed.length)}`,
    `added ${String(result.added.length)}`,
    `deny-hits ${String(result.hits.length)}`,
    `binaries ${String(result.binaries.length)}`,
    `unallowed-binaries ${String(result.unallowedBinaries.length)}`,
    "",
    ...result.removed.map((path) => `R ${path}`),
    ...result.changed.map((path) => `M ${path}`),
    ...result.added.map((path) => `A ${path}`),
    ...result.binaries.map((path) =>
      result.unallowedBinaries.includes(path)
        ? `B ${path} (not in allow-binaries.txt)`
        : `B ${path}`,
    ),
    ...result.hits.map((hit) => `H ${formatHit(hit)}`),
    "",
  ].join("\n");
}

export function commitMessage(source: Source): string {
  return [
    "Initial public release of kdrive-mcp-server",
    "",
    `Exported from the private development archive at ${source.sha.slice(0, 12)}.`,
    "",
    "Assisted-by: AI coding agents (method in AGENTS.md)",
    "",
  ].join("\n");
}

function readStamp(out: string): Stamp {
  const stampFile = stampPath(out);
  if (!existsSync(stampFile))
    throw new Error(`${stampFile} is missing: run the export first`);
  const recorded = JSON.parse(readFileSync(stampFile, "utf8")) as Stamp;
  if (recorded.hits !== 0)
    throw new Error(`the export has ${String(recorded.hits)} deny hits`);
  if (recorded.unallowedBinaries !== 0)
    throw new Error(
      `the export has ${String(recorded.unallowedBinaries)} binary files outside allow-binaries.txt`,
    );
  if (typeof recorded.files !== "object")
    throw new Error(`${stampFile} has no file list: run the export again`);
  return recorded;
}

/** `git ls-files --stage -z` as path to `mode blob`. */
function parseStage(output: string): Map<string, string> {
  const staged = new Map<string, string>();
  for (const entry of output.split("\0")) {
    const match = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/su.exec(entry);
    if (match?.[1] && match[2] && match[3])
      staged.set(match[3], `${match[1]} ${match[2]}`);
  }
  return staged;
}

/** Extra, modified and missing paths of the index against the stamp. */
export function compareFiles(
  staged: ReadonlyMap<string, string>,
  recorded: Readonly<Record<string, string>>,
): string[] {
  const drift: string[] = [];
  for (const [path, state] of staged) {
    const expected = recorded[path];
    if (expected === undefined) drift.push(`extra ${path}`);
    else if (expected !== state) drift.push(`modified ${path}`);
  }
  for (const path of Object.keys(recorded))
    if (!staged.has(path)) drift.push(`missing ${path}`);
  return drift.toSorted(byCodeUnit);
}

/** Deny hits and unallowed binaries of files of a tree, as report lines. */
function rescan(out: string, paths: Iterable<string>, scan: ScanConfig) {
  const problems: string[] = [];
  for (const path of paths) {
    const decoded = decodeContent(contentOf(join(out, path)));
    for (const hit of scanText(path, decoded.text, scan.patterns, scan.allowed))
      problems.push(formatHit(hit));
    if (decoded.encoding === "binary" && !scan.allowedBinaries.has(path))
      problems.push(`binary ${path}`);
  }
  return problems;
}

/**
 * Creates the deterministic root commit of a scanned tree and returns its
 * SHA. Refuses unless the stamp records a clean scan, the files to commit are
 * exactly the exported files with their exported content (files ignored by
 * the tree's own `.gitignore`, such as build outputs, are left out), and a
 * fresh scan of them finds no hit and no unallowed binary.
 */
export function commitTree(out: string, config: string): string {
  const recorded = readStamp(out);
  const source: Source = { sha: recorded.sha, date: recorded.date };
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: out,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: PUBLIC_IDENTITY.name,
    GIT_AUTHOR_EMAIL: PUBLIC_IDENTITY.email,
    GIT_AUTHOR_DATE: source.date,
    GIT_COMMITTER_NAME: PUBLIC_IDENTITY.name,
    GIT_COMMITTER_EMAIL: PUBLIC_IDENTITY.email,
    GIT_COMMITTER_DATE: source.date,
  };
  const git = (args: string[], input?: string) =>
    run("git", args, { cwd: out, env, input }).toString("utf8").trim();
  const refuse = (message: string): never => {
    rmSync(join(out, ".git"), { recursive: true, force: true });
    throw new Error(message);
  };
  rmSync(join(out, ".git"), { recursive: true, force: true });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["add", "--all"]);
  const staged = parseStage(git(["ls-files", "--stage", "-z"]));
  const drift = compareFiles(staged, recorded.files);
  if (drift.length > 0)
    refuse(
      `the tree differs from the exported file list; export again:\n${drift.join("\n")}`,
    );
  const problems = rescan(out, staged.keys(), readScanConfig(config));
  if (problems.length > 0)
    refuse(
      `deny hits or unallowed binaries in the files to commit:\n${problems.join("\n")}`,
    );
  git(["commit", "--quiet", "--no-verify", "--file=-"], commitMessage(source));
  return git(["rev-parse", "HEAD"]);
}

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${name} needs a value`);
  return value;
}

async function exportCommand(
  args: string[],
  out: string,
  config: string,
): Promise<number> {
  const manifest = option(args, "--manifest", "artifacts/public-manifest.txt");
  const archivePath = option(args, "--archive", "");
  let archive: Buffer;
  let source: Source;
  if (archivePath) {
    archive = readFileSync(archivePath === "-" ? 0 : archivePath);
    source = {
      sha: option(args, "--source-sha", ""),
      date: option(args, "--source-date", ""),
    };
    if (!/^[0-9a-f]{40}$/u.test(source.sha) || source.date === "")
      throw new Error("--archive needs --source-sha and --source-date");
  } else ({ archive, source } = readSource(".", option(args, "--ref", "HEAD")));
  const result = await exportTree({
    archive,
    source,
    out,
    config,
    format: await prettierFormatter(out),
  });
  writeFileSync(manifest, formatManifest(source, result));
  for (const hit of result.hits) console.error(formatHit(hit));
  for (const path of result.unallowedBinaries)
    console.error(`${path}: binary file not in allow-binaries.txt`);
  console.log(
    `public-export: ${String(result.removed.length)} removed, ${String(result.changed.length)} changed, ${String(result.added.length)} added, ${String(result.hits.length)} deny hits, ${String(result.binaries.length)} binaries (${String(result.unallowedBinaries.length)} not allowed); manifest ${manifest}`,
  );
  return result.hits.length === 0 && result.unallowedBinaries.length === 0
    ? 0
    : 1;
}

export async function main(args: string[]): Promise<number> {
  const [command] = args;
  const out = option(args, "--out", "artifacts/public-tree");
  const config = option(args, "--config", "ops/public");
  if (command === "export") return exportCommand(args, out, config);
  if (command === "commit") {
    console.log(commitTree(out, config));
    return 0;
  }
  console.error(
    "usage: public-export.ts export [--ref R | --archive T --source-sha S --source-date D] [--out DIR] [--config DIR] [--manifest FILE]\n       public-export.ts commit [--out DIR] [--config DIR]",
  );
  return 2;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `public-export: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

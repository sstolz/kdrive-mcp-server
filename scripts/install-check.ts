// F-027 BR-392 (#12): install the packed tarball from the npm registry into a
// new empty prefix and check the installed tree: at least one zod, every zod
// >= 4.6.6, no @jimp/ package, no symbolic link. Node built-ins only; not
// part of make check (it needs the registry).
import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface Installed {
  name: string;
  version: string | null;
  path: string;
  symlink?: true;
}

function stat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function manifestVersion(directory: string): string | null | undefined {
  const file = join(directory, "package.json");
  if (!stat(file)?.isFile()) return undefined;
  try {
    const value = (
      JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }
    ).version;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// Every node_modules directory under the prefix, at every depth; links are
// collected as findings and never followed.
export function collectInstalled(prefix: string): Installed[] {
  const found: Installed[] = [];
  const entry = (path: string, name: string) => {
    const info = stat(path);
    if (!info) return;
    if (info.isSymbolicLink()) {
      found.push({
        name,
        version: null,
        path: relative(prefix, path),
        symlink: true,
      });
      return;
    }
    if (!info.isDirectory()) return;
    const version = manifestVersion(path);
    if (version !== undefined)
      found.push({ name, version, path: relative(prefix, path) });
    search(path);
  };
  const modules = (directory: string) => {
    for (const name of readdirSync(directory)) {
      if (name.startsWith(".")) continue;
      const path = join(directory, name);
      if (name.startsWith("@") && stat(path)?.isDirectory()) {
        for (const inner of readdirSync(path))
          if (!inner.startsWith("."))
            entry(join(path, inner), `${name}/${inner}`);
      } else entry(path, name);
    }
  };
  const search = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (!stat(path)?.isDirectory()) continue;
      if (name === "node_modules") modules(path);
      else search(path);
    }
  };
  search(prefix);
  return found;
}

// Numeric x.y.z comparison; a prerelease, null or unparseable version is below.
function atLeast(version: string | null, minimum: string): boolean {
  const parse = (text: string) =>
    /^\d+\.\d+\.\d+$/u.test(text) ? text.split(".").map(Number) : undefined;
  const actual = parse(version ?? ""),
    floor = parse(minimum);
  if (!actual || !floor) return false;
  for (let index = 0; index < 3; index++) {
    const a = actual[index] ?? 0,
      b = floor[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export function installVerdict(list: Installed[]): {
  ok: boolean;
  findings: string[];
} {
  const findings: string[] = [];
  const zod = list.filter((item) => item.name === "zod");
  if (zod.length === 0) findings.push("no zod is installed");
  for (const item of zod)
    if (!atLeast(item.version, "4.6.6"))
      findings.push(
        `zod ${String(item.version)} at ${item.path} is below 4.6.6`,
      );
  for (const item of list) {
    if (item.name.startsWith("@jimp/"))
      findings.push(
        `${item.name} ${String(item.version)} at ${item.path} is a Jimp package`,
      );
    if (item.symlink)
      findings.push(`${item.name} at ${item.path} is a symbolic link`);
  }
  return { ok: findings.length === 0, findings };
}

function run(work: string, prefix: string): number {
  for (const file of ["dist", "LICENSE", "NOTICE", "README.md", "package.json"])
    cpSync(file, join(work, file), { recursive: true });
  let tarball: string;
  try {
    const output = execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-027: the Docker-only dev image fixes PATH (Dockerfile.dev)
      "npm",
      ["pack", "--json", "--ignore-scripts", "--prefer-online"],
      {
        cwd: work,
        encoding: "utf8",
        timeout: 120000,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const packed = JSON.parse(output) as { filename?: unknown }[];
    const filename = packed[0]?.filename;
    if (packed.length !== 1 || typeof filename !== "string") {
      process.stderr.write(
        "install-check: npm pack did not produce exactly one tarball\n",
      );
      return 1;
    }
    tarball = join(work, filename);
  } catch {
    process.stderr.write("install-check: npm pack failed\n");
    return 1;
  }
  try {
    execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-027: the Docker-only dev image fixes PATH (Dockerfile.dev)
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        tarball,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefer-online",
      ],
      { cwd: work, timeout: 600000, stdio: ["ignore", "inherit", "inherit"] },
    );
  } catch {
    process.stderr.write("install-check: npm install of the tarball failed\n");
    return 1;
  }
  const list = collectInstalled(prefix);
  for (const item of list)
    if (item.name === "zod")
      process.stdout.write(
        `install-check: zod ${String(item.version)} at ${item.path}\n`,
      );
  const verdict = installVerdict(list);
  for (const finding of verdict.findings)
    process.stdout.write(`install-check: finding: ${finding}\n`);
  process.stdout.write(
    `install-check: ${verdict.ok ? "passed" : "failed"} (${String(list.length)} installed packages)\n`,
  );
  return verdict.ok ? 0 : 1;
}

export function main(): void {
  const work = mkdtempSync(join(tmpdir(), "kdrive-install-check-"));
  const prefix = mkdtempSync(join(tmpdir(), "kdrive-install-prefix-"));
  try {
    process.exitCode = run(work, prefix);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(prefix, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  main();

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { killGroup } from "./deadline.ts";

export interface CoverageRecord {
  status: "success";
  runId: string;
  inputs: Record<string, string>;
  lcov: string;
}

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const configuration = [
  "package.json",
  "package-lock.json",
  "vitest.config.ts",
  "tsconfig.json",
  "tsconfig.build.json",
  "eslint.config.mjs",
  "sonar-project.properties",
  "Dockerfile.dev",
  "compose.yaml",
  "compose.sonar-file.yaml",
  "Makefile",
];

export async function inputDigests(
  root: string,
): Promise<Record<string, string>> {
  const files: string[] = [];
  async function visit(path: string) {
    const stat = await lstat(join(root, path)).catch(() => undefined);
    if (!stat) return;
    if (stat.isSymbolicLink())
      throw new Error("Input symlinks are not supported");
    if (stat.isDirectory()) {
      // eslint-disable-next-line sonarjs/no-alphabetical-sort -- F-011: code-unit order is the intended deterministic order
      for (const name of (await readdir(join(root, path))).sort())
        await visit(join(path, name));
    } else if (stat.isFile()) files.push(path);
  }
  for (const path of [...configuration, "src", "tests", "scripts"])
    await visit(path);
  const result: Record<string, string> = {};
  // eslint-disable-next-line sonarjs/no-misleading-array-reverse, sonarjs/no-alphabetical-sort -- F-011: in-place reordering of a local array is intended; F-011: code-unit order is the intended deterministic order
  for (const path of files.sort())
    result[path] = hash(await readFile(join(root, path)));
  return result;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeLcov(
  root: string,
  value: string,
  inputs: Record<string, string>,
): string {
  const seen = new Set<string>();
  const normalized = value
    .split("\n")
    .map((line) => {
      if (!line.startsWith("SF:")) return line;
      const original = line.slice(3);
      const path = isAbsolute(original) ? relative(root, original) : original;
      if (!path.startsWith("src/") || path.includes("..") || !inputs[path])
        throw new Error("LCOV references an invalid source");
      seen.add(path);
      return `SF:${path}`;
    })
    .join("\n");
  if (!seen.size || !normalized.includes("end_of_record"))
    throw new Error("LCOV is empty or incomplete");
  for (const file of Object.keys(inputs)) {
    if (
      file.startsWith("src/") &&
      file.endsWith(".ts") &&
      !file.endsWith(".d.ts") &&
      !seen.has(file)
    )
      throw new Error("LCOV omits a source file");
  }
  return normalized;
}

export async function createCoverage(
  root: string,
  runId: string,
  run: () => Promise<number>,
): Promise<CoverageRecord> {
  await mkdir(join(root, "coverage"), { recursive: true });
  // Invalidate any earlier success before invoking a test process.
  await writeFile(
    join(root, "coverage/success.json"),
    JSON.stringify({ status: "running", runId }),
  );
  await writeFile(join(root, "coverage/lcov.info"), "");
  const inputs = await inputDigests(root);
  if ((await run()) !== 0) throw new Error("Coverage tests failed");
  if (!same(inputs, await inputDigests(root)))
    throw new Error("Inputs changed during coverage");
  const lcovPath = join(root, "coverage/lcov.info");
  const normalized = normalizeLcov(
    root,
    await readFile(lcovPath, "utf8"),
    inputs,
  );
  await writeFile(lcovPath, normalized);
  const record: CoverageRecord = {
    status: "success",
    runId,
    inputs,
    lcov: hash(normalized),
  };
  await writeFile(
    join(root, "coverage/success.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  return record;
}

export async function verifyCoverage(
  root: string,
  runId: string,
): Promise<CoverageRecord> {
  const record = JSON.parse(
    await readFile(join(root, "coverage/success.json"), "utf8"),
  ) as CoverageRecord | null;
  if (
    !record ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- F-011: defensive runtime check kept; the value can change outside the static type flow
    record.status !== "success" ||
    record.runId !== runId ||
    !same(record.inputs, await inputDigests(root))
  )
    throw new Error("Coverage provenance mismatch");
  const lcov = await readFile(join(root, "coverage/lcov.info"), "utf8");
  if (
    normalizeLcov(root, lcov, record.inputs) !== lcov ||
    hash(lcov) !== record.lcov
  )
    throw new Error("Coverage report mismatch");
  return record;
}

export function command(
  command: string,
  args: string[],
  root: string,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolveExit, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      detached: true,
    });
    const abort = () => {
      killGroup(child);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("error", reject);
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolveExit(signal?.aborted ? 1 : (code ?? 1));
    });
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = process.cwd();
    await createCoverage(root, randomUUID(), () =>
      command(
        "node",
        ["node_modules/vitest/vitest.mjs", "run", "--coverage"],
        root,
      ),
    );
  } catch {
    process.stderr.write(
      "Coverage failed; no reusable success evidence was produced.\n",
    );
    process.exitCode = 1;
  }
}

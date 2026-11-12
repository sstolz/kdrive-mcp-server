import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  symlink,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { command, createCoverage, verifyCoverage } from "./coverage.ts";
import {
  analysisMode,
  verifyMain,
  verifyPullRequest,
  type AnalysisMode,
  type MainSnapshot,
} from "./sonar.ts";
import { withinDeadline } from "./deadline.ts";

function gitIn(root: string, signal?: AbortSignal) {
  return async (...args: string[]) =>
    (
      await promisify(execFile)(
        "git",
        ["-c", `safe.directory=${root}`, ...args],
        {
          cwd: root,
          encoding: "utf8",
          ...(signal ? { signal, killSignal: "SIGKILL" as const } : {}),
        },
      )
    ).stdout.trim();
}

export async function inspectMain(
  root: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<MainSnapshot> {
  const git = gitIn(root, signal);
  const snapshot: MainSnapshot = {
    branch: await git("symbolic-ref", "--short", "HEAD"),
    commit: await git("rev-parse", "HEAD"),
    trustedMain: await git("rev-parse", "refs/remotes/origin/main"),
    clean:
      (await git("status", "--porcelain", "--untracked-files=normal")) === "",
    repository: await git("remote", "get-url", "origin"),
    event: env.GITHUB_EVENT_NAME ?? "local",
  };
  if (env.GITHUB_ACTIONS === "true" || env.GITHUB_EVENT_NAME) {
    if (
      env.GITHUB_REPOSITORY !== "sstolz/kdrive-mcp-server" ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_SHA !== snapshot.commit ||
      !["push", "workflow_dispatch"].includes(snapshot.event)
    )
      throw new Error("Untrusted CI source");
  }
  verifyMain(snapshot);
  return snapshot;
}

// BR-148: only a clean same-repository pull-request merge commit into main.
export async function inspectPullRequest(
  root: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<MainSnapshot> {
  const repository = "sstolz/kdrive-mcp-server";
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "pull_request" ||
    env.GITHUB_REPOSITORY !== repository ||
    env.SONAR_PR_HEAD_REPOSITORY !== repository ||
    env.GITHUB_BASE_REF !== "main" ||
    !/^refs\/pull\/[1-9]\d*\/merge$/.test(env.GITHUB_REF ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Untrusted pull request source");
  const git = gitIn(root, signal);
  const snapshot: MainSnapshot = {
    branch: "",
    commit: await git("rev-parse", "HEAD"),
    trustedMain: env.GITHUB_SHA ?? "",
    clean:
      (await git("status", "--porcelain", "--untracked-files=normal")) === "",
    repository: await git("remote", "get-url", "origin"),
    event: "pull_request",
    ref: env.GITHUB_REF ?? "",
    headRepository: env.SONAR_PR_HEAD_REPOSITORY,
    baseRef: env.GITHUB_BASE_REF,
  };
  verifyPullRequest(snapshot);
  return snapshot;
}

function inspectorFor(mode: AnalysisMode) {
  return mode === "pr" ? inspectPullRequest : inspectMain;
}

async function freeze(path: string): Promise<void> {
  for (const name of await readdir(path)) {
    const child = join(path, name);
    const stat = await lstat(child);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) await freeze(child);
    else await chmod(child, stat.mode & 0o555);
  }
  await chmod(path, 0o555);
}

export async function prepareSnapshot(
  root: string,
  env: NodeJS.ProcessEnv,
  startedAt = Date.now(),
  budget = 900_000,
) {
  return withinDeadline(budget - (Date.now() - startedAt), async (signal) => {
    if (env.SONAR_ENABLED !== "true")
      throw new Error("Remote analysis is not enabled");
    // BR-150: the Make target fixes the mode; direct test calls default to main.
    const mode = analysisMode(env.SONAR_ANALYSIS_MODE ?? "main");
    const inspect = inspectorFor(mode);
    const snapshot = await inspect(root, env, signal);
    const runId = randomUUID();
    const parent = join(root, "artifacts/sonar-input");
    const destination = join(parent, runId);
    await mkdir(destination, { recursive: true });
    const git = async (...args: string[]) =>
      (
        await promisify(execFile)(
          "git",
          ["-c", `safe.directory=${root}`, ...args],
          {
            cwd: root,
            encoding: "buffer",
            signal,
            killSignal: "SIGKILL",
            maxBuffer: 16 * 1024 * 1024,
          },
        )
      ).stdout;
    const paths = (await git("ls-tree", "-rz", "--name-only", snapshot.commit))
      .toString()
      .split("\0")
      .filter(Boolean);
    for (const path of paths) {
      signal.throwIfAborted();
      if (path === ".config/qube-token")
        throw new Error("Tracked supported credential path is forbidden");
      if (
        path
          .split("/")
          .some((part) =>
            [
              "secrets",
              "node_modules",
              "coverage",
              "artifacts",
              "dist",
            ].includes(part),
          ) ||
        (/(^|\/)\.env($|\.)/.test(path) && path !== ".env.example") ||
        /\.(pem|key|p12|pfx)$/.test(path)
      )
        continue;
      const info = (
        await git("ls-tree", snapshot.commit, "--", path)
      ).toString();
      if (!info.startsWith("100644 ") && !info.startsWith("100755 "))
        throw new Error("Snapshot requires regular tracked files");
      await mkdir(dirname(join(destination, path)), { recursive: true });
      await writeFile(
        join(destination, path),
        await git("show", `${snapshot.commit}:${path}`),
      );
    }
    await symlink(
      join(root, "node_modules"),
      join(destination, "node_modules"),
    );
    if ((await command("npm", ["run", "build"], destination, signal)) !== 0)
      throw new Error("Snapshot build failed");
    await createCoverage(destination, runId, () =>
      command(
        "node",
        [join(root, "node_modules/vitest/vitest.mjs"), "run", "--coverage"],
        destination,
        signal,
      ),
    );
    await verifyCoverage(destination, runId);
    if (
      JSON.stringify(await inspect(root, env, signal)) !==
      JSON.stringify(snapshot)
    )
      throw new Error("Source changed during snapshot preparation");
    await writeFile(
      join(destination, "analysis-snapshot.json"),
      JSON.stringify({ ...snapshot, runId, startedAt }, null, 2) + "\n",
    );
    await freeze(destination);
    signal.throwIfAborted();
    const pointer = join(parent, `pointer-${runId}`);
    await symlink(runId, pointer);
    const invocation = env.SONAR_INVOCATION_ID;
    if (invocation !== undefined && !/^\d+$/.test(invocation))
      throw new Error("Invalid local invocation identity");
    await rename(
      pointer,
      join(parent, invocation ? `current-${invocation}` : "current"),
    );
    process.stdout.write(
      `Prepared immutable ${mode} snapshot ${snapshot.commit}; remote analysis has not run.\n`,
    );
    return destination;
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await prepareSnapshot(process.cwd(), process.env);
  } catch (error) {
    process.stderr.write(
      `Sonar snapshot preparation failed: ${error instanceof Error ? error.message : "unknown failure"}\n`,
    );
    process.exitCode = 1;
  }
}

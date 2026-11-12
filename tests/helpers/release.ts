// F-024 test doubles for scripts/release.ts, scripts/release-image.sh and the
// release Make targets: one HTTP double for the GitHub API, the npm registry
// and GHCR, temporary Git repositories, fake npm and docker executables.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const VERSION = "0.6.0-beta.1";
export const PACKAGE = "@sstolz/kdrive-mcp-server";
export const PLACEHOLDER = "0.0.0-placeholder.0";
export const TARBALL = `sstolz-kdrive-mcp-server-${VERSION}.tgz`;
export const RELEASE_SCRIPT = resolve("scripts/release.ts");
export const IMAGE_SCRIPT = resolve("scripts/release-image.sh");
export const IDENTITY = {
  GIT_AUTHOR_NAME: "Synthetic Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Synthetic Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

const roots: string[] = [];
export function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
export function cleanupTemporaries(): void {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}
/** Asynchronous spawn, so in-process HTTP doubles keep answering. */
export function run(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; input?: string },
): Promise<Result> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (status) => {
      done({ status, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
export interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
}
export interface Double {
  url: string;
  seen: Seen[];
  close: () => Promise<void>;
}
export async function double(route: (request: Seen) => Reply): Promise<Double> {
  const seen: Seen[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const entry: Seen = {
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization,
    };
    seen.push(entry);
    request.resume();
    request.on("end", () => {
      const reply = route(entry);
      let body: Buffer;
      const headers: Record<string, string> = { ...reply.headers };
      if (reply.body === undefined) body = Buffer.alloc(0);
      else if (Buffer.isBuffer(reply.body)) body = reply.body;
      else if (typeof reply.body === "string") body = Buffer.from(reply.body);
      else {
        body = Buffer.from(JSON.stringify(reply.body));
        headers["content-type"] ??= "application/json";
      }
      headers["content-length"] = String(body.length);
      response.writeHead(reply.status, headers);
      response.end(entry.method === "HEAD" ? undefined : body);
    });
  });
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    seen,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => {
          done();
        });
      }),
  };
}

const REPO = "/repos/sstolz/kdrive-mcp-server";
export const OCI_INDEX = "application/vnd.oci.image.index.v1+json";

export function indexBody(platforms: string[]): string {
  return JSON.stringify({
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests: [
      ...platforms.map((platform, index) => {
        const [os, architecture] = platform.split("/");
        return {
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: `sha256:${String(index).repeat(64)}`,
          size: 1,
          platform: { os, architecture },
        };
      }),
      ...platforms.map((_, index) => ({
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: `sha256:${String(index + 5).repeat(64)}`,
        size: 1,
        platform: { os: "unknown", architecture: "unknown" },
      })),
    ],
  });
}

export function npmDocument(
  options: {
    published?: boolean;
    tarballUrl?: string;
    latest?: string | undefined;
    beta?: string;
    attestations?: boolean;
    placeholder?: boolean;
    placeholderDeprecated?: boolean;
  } = {},
): Record<string, unknown> {
  const versions: Record<string, unknown> = {};
  const time: Record<string, string> = {};
  if (options.placeholder ?? true) {
    versions[PLACEHOLDER] =
      (options.placeholderDeprecated ?? true)
        ? { version: PLACEHOLDER, deprecated: "Placeholder, not a release." }
        : { version: PLACEHOLDER };
    time[PLACEHOLDER] = "2026-11-12T00:00:00.000Z";
  }
  if (options.published) {
    versions[VERSION] = {
      version: VERSION,
      dist: {
        tarball: options.tarballUrl ?? "",
        ...((options.attestations ?? true)
          ? { attestations: { url: "x", provenance: { predicateType: "y" } } }
          : {}),
      },
    };
    time[VERSION] = "2026-11-13T00:00:00.000Z";
  }
  const tags: Record<string, string> = {};
  const latest = "latest" in options ? options.latest : PLACEHOLDER;
  if (latest !== undefined) tags.latest = latest;
  if (options.beta !== undefined) tags.beta = options.beta;
  else if (options.published) tags.beta = VERSION;
  return { name: PACKAGE, "dist-tags": tags, versions, time };
}

/** Mutable answers of the release double; tests change them per case. */
export interface ReleaseState {
  sha: string;
  ciRuns: Reply;
  ciJobs: Reply;
  environment: Reply;
  policies: Reply;
  npm: Reply | ((attempt: number) => Reply);
  npmAttempts: number;
  ghcrToken: Reply;
  manifest: Reply;
  index: Reply;
  latest: Reply;
  anonToken: Reply;
  anonManifest: Reply;
  tarball: Reply;
}

export function goodEnvironment(): Record<string, unknown> {
  return {
    name: "release",
    protection_rules: [
      { id: 1, type: "required_reviewers", reviewers: [{ type: "User" }] },
      { id: 2, type: "branch_policy" },
    ],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  };
}
export function goodPolicies(): Record<string, unknown> {
  return {
    total_count: 1,
    branch_policies: [{ id: 1, name: "main", type: "branch" }],
  };
}

export function releaseState(sha: string): ReleaseState {
  return {
    sha,
    ciRuns: {
      status: 200,
      body: {
        total_count: 1,
        workflow_runs: [
          { id: 11, head_sha: sha, head_branch: "main", event: "push" },
        ],
      },
    },
    ciJobs: {
      status: 200,
      body: { jobs: [{ name: "ci-result", conclusion: "success" }] },
    },
    environment: { status: 200, body: goodEnvironment() },
    policies: { status: 200, body: goodPolicies() },
    npm: { status: 200, body: npmDocument() },
    npmAttempts: 0,
    ghcrToken: { status: 200, body: { token: "pull-token" } },
    manifest: { status: 404 },
    index: {
      status: 200,
      body: indexBody(["linux/amd64", "linux/arm64"]),
      headers: { "content-type": OCI_INDEX },
    },
    latest: { status: 404 },
    anonToken: { status: 200, body: { token: "anon-token" } },
    anonManifest: { status: 200 },
    tarball: { status: 404 },
  };
}

function githubRoute(state: ReleaseState, url: string): Reply | undefined {
  if (url.startsWith(`${REPO}/actions/workflows/ci.yml/runs?`))
    return state.ciRuns;
  if (
    /^\/repos\/sstolz\/kdrive-mcp-server\/actions\/runs\/\d+\/jobs/u.test(url)
  )
    return state.ciJobs;
  if (
    url ===
    `${REPO}/environments/release/deployment-branch-policies?per_page=100`
  )
    return state.policies;
  if (url === `${REPO}/environments/release`) return state.environment;
  return undefined;
}
function ghcrRoute(state: ReleaseState, request: Seen): Reply | undefined {
  if (request.url.startsWith("/token?"))
    return request.authorization === undefined
      ? state.anonToken
      : state.ghcrToken;
  const manifest = /^\/v2\/sstolz\/kdrive-mcp-server\/manifests\/(.+)$/u.exec(
    request.url,
  );
  if (!manifest) return undefined;
  if (request.authorization === "Bearer anon-token") return state.anonManifest;
  if (manifest[1] === "latest") return state.latest;
  return request.method === "HEAD" ? state.manifest : state.index;
}
export function releaseRoute(state: ReleaseState): (request: Seen) => Reply {
  return (request) => {
    const url = request.url;
    if (url === "/@sstolz%2fkdrive-mcp-server") {
      state.npmAttempts += 1;
      return typeof state.npm === "function"
        ? state.npm(state.npmAttempts)
        : state.npm;
    }
    if (url === "/tarballs/pkg.tgz") return state.tarball;
    return (
      githubRoute(state, url) ?? ghcrRoute(state, request) ?? { status: 404 }
    );
  };
}

/** A temporary Git repository holding a release commit on main. */
export interface ReleaseRepo {
  root: string;
  sha: string;
  parent: string;
  git: (...args: string[]) => string;
}
export interface RepoOptions {
  versionFile?: string;
  packageVersion?: string;
  tag?: "head" | "parent" | "none" | "annotated";
  side?: boolean;
  files?: Record<string, string>;
}
export function gitEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: temporary("release-home-"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: tmpdir(),
    ...IDENTITY,
  };
}
export function releaseRepo(options: RepoOptions = {}): ReleaseRepo {
  const root = temporary("release-repo-");
  const env = gitEnv();
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
      cwd: root,
      encoding: "utf8",
      env,
    }).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  git("init", "-q", "--initial-branch=main");
  write("VERSION", "0.1.0\n");
  git("add", "-A");
  git("commit", "-q", "-m", "parent");
  const parent = git("rev-parse", "HEAD");
  write("VERSION", options.versionFile ?? `${VERSION}\n`);
  write(
    "package.json",
    `${JSON.stringify({ name: PACKAGE, version: options.packageVersion ?? VERSION }, null, 2)}\n`,
  );
  write(
    "package-lock.json",
    `${JSON.stringify({ name: PACKAGE, version: VERSION, lockfileVersion: 3, packages: { "": { name: PACKAGE, version: VERSION } } }, null, 2)}\n`,
  );
  for (const [path, content] of Object.entries(options.files ?? {}))
    write(path, content);
  git("add", "-A");
  git("commit", "-q", "-m", "release");
  let sha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", sha);
  if (options.side) {
    git("checkout", "-q", "-b", "side");
    write("SIDE", "side\n");
    git("add", "-A");
    git("commit", "-q", "-m", "side");
    sha = git("rev-parse", "HEAD");
  }
  const tag = options.tag ?? "head";
  if (tag === "head") git("tag", `v${VERSION}`, sha);
  else if (tag === "parent") git("tag", `v${VERSION}`, parent);
  else if (tag === "annotated")
    git("tag", "-a", "-m", "release", `v${VERSION}`, sha);
  return { root, sha, parent, git };
}

/** Writes an executable fixture script. */
export function executable(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/** A gzip tarball holding package/package.json (and optional files). */
export function packTarball(
  path: string,
  manifest: Record<string, unknown>,
  extra: Record<string, string> = {},
): Buffer {
  const staging = temporary("release-tarball-");
  mkdirSync(join(staging, "package"), { recursive: true });
  writeFileSync(
    join(staging, "package/package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const [name, content] of Object.entries(extra))
    writeFileSync(join(staging, "package", name), content);
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("tar", ["-czf", path, "-C", staging, "package"]);
  return readFileSync(path);
}

/**
 * Fake npm: records each call as one JSON line (argv and the environment
 * names) in $FAKE_NPM_LOG, answers --version with $FAKE_NPM_VERSION, creates
 * node_modules/.package-lock.json for ci, and copies $FAKE_NPM_TARBALL for pack.
 */
export const FAKE_NPM = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ argv, env: Object.keys(process.env) }) + "\\n");
if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, "npm " + argv.join(" ") + "\\n");
if (argv[0] === "--version") { process.stdout.write((process.env.FAKE_NPM_VERSION || "11.5.1") + "\\n"); process.exit(0); }
if (argv[0] === "ci") { fs.mkdirSync("node_modules", { recursive: true }); fs.writeFileSync("node_modules/.package-lock.json", "{}"); process.exit(0); }
if (argv[0] === "pack") {
  const destination = argv[argv.indexOf("--pack-destination") + 1];
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const name = manifest.name.replace("@", "").replace("/", "-") + "-" + manifest.version + ".tgz";
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(process.env.FAKE_NPM_TARBALL, path.join(destination, name));
  process.exit(0);
}
process.exit(Number(process.env.FAKE_NPM_STATUS || "0"));
`;

/**
 * Fake docker: \`compose run … dev <command>\` runs <command> on the host with
 * only PATH, HOME and the -e names; \`compose build\`, buildx, login, logout
 * and run are recorded in $FAKE_DOCKER_LOG (login stdin in $FAKE_DOCKER_STDIN).
 */
export const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
const log = (line) => fs.appendFileSync(process.env.FAKE_DOCKER_LOG, line + "\\n");
if (argv[0] === "compose" && argv[1] === "run") {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, FAKE_NPM_LOG: process.env.FAKE_NPM_LOG, FAKE_NPM_TARBALL: process.env.FAKE_NPM_TARBALL, FAKE_DOCKER_LOG: process.env.FAKE_DOCKER_LOG };
  const names = [];
  let index = 2;
  while (argv[index] !== "dev") {
    if (argv[index] === "-e") { const name = argv[index + 1]; names.push(name); if (process.env[name] !== undefined) env[name] = process.env[name]; index += 2; }
    else index += 1;
  }
  log("compose run " + names.join(",") + " :: " + argv.slice(index + 1).join(" "));
  const result = spawnSync(argv[index + 1], argv.slice(index + 2), { stdio: "inherit", env });
  process.exit(result.status === null ? 1 : result.status);
}
if (argv[0] === "login") fs.writeFileSync(process.env.FAKE_DOCKER_STDIN, fs.readFileSync(0));
log(argv.join(" "));
if (argv[0] === "buildx" && argv[1] === "build" && process.env.FAKE_BUILD_FAIL === "1") process.exit(1);
process.exit(0);
`;

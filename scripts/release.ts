// F-024: release checks, npm release step and read-back (BR-359–BR-369,
// BR-372, BR-373, BR-375, BR-378, BR-379). Node built-ins only. No output
// holds a token, an Authorization value or a response body: an HTTP failure is
// reported by its status code only (BR-365).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { gunzipSync } from "node:zlib";

const PACKAGE = "@sstolz/kdrive-mcp-server";
const REPOSITORY = "sstolz/kdrive-mcp-server";
const IMAGE = "sstolz/kdrive-mcp-server";
const TARBALL_PREFIX = "sstolz-kdrive-mcp-server-";
const DEFAULTS = {
  RELEASE_GITHUB_API_URL: "https://api.github.com",
  RELEASE_NPM_REGISTRY_URL: "https://registry.npmjs.org",
  RELEASE_GHCR_URL: "https://ghcr.io",
};
type Endpoint = keyof typeof DEFAULTS;
const ATTEMPTS = 20;
const RETRY_DELAY_MS = 15_000;
const TIMEOUT_MS = 30_000;
const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

class FixedExit extends Error {
  readonly code: number;
  readonly text: string;
  constructor(code: number, text: string) {
    super("fixed exit");
    this.code = code;
    this.text = text;
  }
}

/** One printed check: `<prefix>: <name> ok` or `<prefix>: <name> FAIL <reason>`. */
class Report {
  readonly prefix: string;
  failures = 0;
  total = 0;
  constructor(prefix: string) {
    this.prefix = prefix;
  }
  check(name: string, reason: string | null): boolean {
    this.total += 1;
    if (reason === null) {
      process.stdout.write(`${this.prefix}: ${name} ok\n`);
      return true;
    }
    this.failures += 1;
    process.stdout.write(`${this.prefix}: ${name} FAIL ${reason}\n`);
    return false;
  }
  summary(): number {
    process.stdout.write(
      `${this.prefix}: ${String(this.failures)} of ${String(this.total)} checks failed\n`,
    );
    return this.failures === 0 ? 0 : 1;
  }
}

const env = (name: string): string | undefined => process.env[name];

// BR-367: endpoint overrides exist for test doubles only.
function refuseOverridesInCi(): void {
  if (env("GITHUB_ACTIONS") !== "true") return;
  for (const name of Object.keys(DEFAULTS))
    if (env(name) !== undefined)
      throw new FixedExit(2, "release: endpoint override refused in CI");
}
function endpoint(name: Endpoint): string {
  const value = env(name);
  return value === undefined || value === "" ? DEFAULTS[name] : value;
}

// BR-359: SemVer 2.0.0 reference expression, then the F-024 v1 beta form.
const NUMBER = String.raw`(?:0|[1-9][0-9]*)`;
const IDENTIFIER = String.raw`(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER = new RegExp(
  String.raw`^${NUMBER}\.${NUMBER}\.${NUMBER}(-${IDENTIFIER}(?:\.${IDENTIFIER})*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$`,
  "u",
);
const BETA = new RegExp(
  String.raw`^${NUMBER}\.${NUMBER}\.${NUMBER}-beta\.${NUMBER}$`,
  "u",
);
function versionReason(version: string): string | null {
  const match = SEMVER.exec(version);
  if (!match) return "version is not a SemVer version";
  if (BETA.test(version)) return null;
  if (match[1] === undefined)
    return "stable releases are out of scope (F-024 v1)";
  return "unsupported pre-release";
}

interface Inputs {
  version: string;
  sha: string;
  dryRun: boolean;
  phase: string;
}
/** BR-359: validated before any value is used in a path, ref, URL or child. */
function validateInputs(report: Report, withPhase: boolean): Inputs | null {
  const version = env("RELEASE_VERSION") ?? "";
  const sha = env("RELEASE_SHA") ?? "";
  const dryRun = env("RELEASE_DRY_RUN") ?? "";
  const phase = env("RELEASE_PHASE") ?? "";
  let valid = report.check("version", versionReason(version));
  valid =
    report.check(
      "sha",
      /^[0-9a-f]{40}$/u.test(sha) ? null : "sha is not a full commit id",
    ) && valid;
  valid =
    report.check(
      "dry_run",
      dryRun === "true" || dryRun === "false"
        ? null
        : "dry_run is not a boolean",
    ) && valid;
  if (withPhase)
    valid =
      report.check(
        "phase",
        ["verify", "image", "npm"].includes(phase)
          ? null
          : "phase is not a release phase",
      ) && valid;
  return valid ? { version, sha, dryRun: dryRun === "true", phase } : null;
}

// BR-364, BR-366: read-only Git commands; stderr is piped and discarded.
function git(args: string[]): { status: number; out: string } {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-024: the Docker-only dev image fixes PATH (Dockerfile.dev)
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, out: result.stdout.trim() };
}
/** Status 0 or 1 is an answer; anything else is an internal error. */
function gitAnswer(args: string[]): { ok: boolean; out: string } {
  const result = git(args);
  if (result.status !== 0 && result.status !== 1) throw new Error("git failed");
  return { ok: result.status === 0, out: result.out };
}
function fileAt(sha: string, path: string): string | null {
  if (!gitAnswer(["rev-parse", "--verify", "--quiet", `${sha}:${path}`]).ok)
    return null;
  const result = git(["cat-file", "blob", `${sha}:${path}`]);
  if (result.status !== 0) throw new Error("git failed");
  // The trimmed output drops the final newline; VERSION is read raw below.
  return result.out;
}
function rawFileAt(sha: string, path: string): string | null {
  if (!gitAnswer(["rev-parse", "--verify", "--quiet", `${sha}:${path}`]).ok)
    return null;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-024: the Docker-only dev image fixes PATH (Dockerfile.dev)
  const result = spawnSync("git", ["cat-file", "blob", `${sha}:${path}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("git failed");
  return result.stdout;
}
function jsonField(text: string | null, field: string): unknown {
  if (text === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed[field] : undefined;
  } catch {
    return undefined;
  }
}

/** BR-360, BR-361. */
function commitChecks(report: Report, inputs: Inputs): void {
  const head = git(["rev-parse", "HEAD"]);
  if (head.status !== 0) throw new Error("git failed");
  const { sha, version } = inputs;
  const exists = gitAnswer([
    "rev-parse",
    "--verify",
    "--quiet",
    `${sha}^{commit}`,
  ]).ok;
  report.check("commit", exists ? null : "sha does not name a commit");
  report.check(
    "HEAD",
    head.out === sha ? null : "sha is not the checked-out HEAD",
  );
  const versionFile = exists ? rawFileAt(sha, "VERSION") : null;
  report.check(
    "VERSION file",
    versionFile === `${version}\n`
      ? null
      : "VERSION does not match the version",
  );
  const manifest = exists ? fileAt(sha, "package.json") : null;
  report.check(
    "package.json name",
    jsonField(manifest, "name") === PACKAGE
      ? null
      : `package.json name is not ${PACKAGE}`,
  );
  report.check(
    "package.json version",
    jsonField(manifest, "version") === version
      ? null
      : "package.json version does not match",
  );
  const lock = exists ? fileAt(sha, "package-lock.json") : null;
  report.check(
    "package-lock.json version",
    jsonField(lock, "version") === version
      ? null
      : "package-lock.json version does not match",
  );
  const tag = gitAnswer([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/tags/v${version}^{commit}`,
  ]);
  report.check(
    "release tag",
    tag.ok && tag.out === sha
      ? null
      : "release tag missing or on another commit",
  );
  const onMain =
    exists &&
    gitAnswer(["merge-base", "--is-ancestor", sha, "refs/remotes/origin/main"])
      .ok;
  report.check("on main", onMain ? null : "commit is not on main");
  report.check(
    "dispatched commit",
    env("GITHUB_SHA") === sha ? null : "sha is not the dispatched commit",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Answer {
  status: number;
  body: Buffer;
  type: string;
}
async function request(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "user-agent": "kdrive-mcp-server-release",
        ...options.headers,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      body,
      type: response.headers.get("content-type") ?? "",
    };
  } catch {
    // A network failure counts as a failed request (status 0), never a body.
    return { status: 0, body: Buffer.alloc(0), type: "" };
  }
}
function parse(answer: Answer): unknown {
  try {
    return JSON.parse(answer.body.toString("utf8"));
  } catch {
    return undefined;
  }
}
function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}
function hasKey(value: unknown, key: string): boolean {
  return isRecord(value) && Object.hasOwn(value, key);
}

function githubHeaders(): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${env("GITHUB_TOKEN") ?? ""}`,
    "x-github-api-version": "2022-11-28",
  };
}
const api = (path: string) =>
  request(`${endpoint("RELEASE_GITHUB_API_URL")}${path}`, {
    headers: githubHeaders(),
  });

/** BR-362: a successful ci-result on a main push or dispatch run of the sha. */
async function ciEvidence(sha: string): Promise<string | null> {
  const runs = await api(
    `/repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`,
  );
  if (runs.status < 200 || runs.status > 299)
    return `GitHub API status ${String(runs.status)}`;
  const list = field(parse(runs), "workflow_runs");
  const candidates = (Array.isArray(list) ? list : []).filter(
    (run: unknown) =>
      field(run, "head_sha") === sha &&
      field(run, "head_branch") === "main" &&
      ["push", "workflow_dispatch"].includes(String(field(run, "event"))),
  );
  for (const run of candidates) {
    const id = field(run, "id");
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
      continue;
    const jobs = await api(
      `/repos/${REPOSITORY}/actions/runs/${String(id)}/jobs?per_page=100`,
    );
    if (jobs.status < 200 || jobs.status > 299)
      return `GitHub API status ${String(jobs.status)}`;
    const entries = field(parse(jobs), "jobs");
    if (
      Array.isArray(entries) &&
      entries.some(
        (job: unknown) =>
          field(job, "name") === "ci-result" &&
          field(job, "conclusion") === "success",
      )
    )
      return null;
  }
  return "no successful ci-result run on main for this commit";
}

/** BR-378: the release environment needs a reviewer and exactly branch main. */
async function environmentProtected(): Promise<string | null> {
  const environment = await api(`/repos/${REPOSITORY}/environments/release`);
  const policies = await api(
    `/repos/${REPOSITORY}/environments/release/deployment-branch-policies?per_page=100`,
  );
  for (const answer of [environment, policies])
    if (answer.status < 200 || answer.status > 299)
      return `release environment unreadable ${String(answer.status)}; refer to the owner`;
  const notProtected = "release environment not protected (P-2)";
  if (environment.status !== 200 || policies.status !== 200)
    return notProtected;
  const body = parse(environment);
  const rules = field(body, "protection_rules");
  const reviewed =
    Array.isArray(rules) &&
    rules.some((rule: unknown) => {
      const reviewers = field(rule, "reviewers");
      return (
        field(rule, "type") === "required_reviewers" &&
        Array.isArray(reviewers) &&
        reviewers.length > 0
      );
    });
  const policy = field(body, "deployment_branch_policy");
  const branchOnly =
    isRecord(policy) &&
    Object.keys(policy).length === 2 &&
    policy.protected_branches === false &&
    policy.custom_branch_policies === true;
  const list = parse(policies);
  const entries = field(list, "branch_policies");
  const mainOnly =
    field(list, "total_count") === 1 &&
    Array.isArray(entries) &&
    entries.length === 1 &&
    field(entries[0], "name") === "main" &&
    field(entries[0], "type") === "branch";
  return reviewed && branchOnly && mainOnly ? null : notProtected;
}

const npmDocument = () =>
  request(
    `${endpoint("RELEASE_NPM_REGISTRY_URL")}/${PACKAGE.replace("/", "%2f")}`,
    { headers: { accept: "application/json" } },
  );

/** BR-363: the exact version is unpublished; P-0 placeholder on latest. */
function npmChecks(report: Report, inputs: Inputs, answer: Answer): void {
  const document = answer.status === 200 ? parse(answer) : undefined;
  let published: string | null;
  if (answer.status === 404)
    published = inputs.dryRun ? null : "npm registry status 404";
  else if (answer.status !== 200)
    published = `npm registry status ${String(answer.status)}`;
  else if (!isRecord(field(document, "versions")))
    // A 200 body that is not an object with a `versions` object fails closed.
    published = "npm document unreadable; refer to the owner";
  else if (
    hasKey(field(document, "versions"), inputs.version) ||
    hasKey(field(document, "time"), inputs.version)
  )
    published = "version already published on npm";
  else published = null;
  report.check("npm version not published", published);
  if (inputs.dryRun) return;
  let placeholder: string | null = null;
  if (answer.status !== 200) placeholder = "npm placeholder missing (P-0)";
  else if (!deprecatedLatest(document, inputs.version))
    placeholder = "npm latest is not a deprecated placeholder (P-0)";
  report.check("npm placeholder", placeholder);
}
function deprecatedLatest(document: unknown, version: string): boolean {
  const latest = field(document, "dist-tags", "latest");
  if (typeof latest !== "string" || latest === version) return false;
  const deprecated = field(document, "versions", latest, "deprecated");
  return typeof deprecated === "string" && deprecated !== "";
}

/** A GHCR pull token, with GITHUB_TOKEN or anonymous. */
async function ghcrToken(
  credential: boolean,
): Promise<{ status: number; token: string }> {
  const headers: Record<string, string> = {};
  if (credential) {
    const basic = Buffer.from(
      "x-access-token:" + (env("GITHUB_TOKEN") ?? ""),
    ).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  const answer = await request(
    `${endpoint("RELEASE_GHCR_URL")}/token?scope=repository:${IMAGE}:pull&service=ghcr.io`,
    { headers },
  );
  const token = field(parse(answer), "token");
  return {
    status:
      answer.status === 200 && typeof token === "string" ? 200 : answer.status,
    token: typeof token === "string" ? token : "",
  };
}
const manifest = (tag: string, token: string, method = "GET") =>
  request(`${endpoint("RELEASE_GHCR_URL")}/v2/${IMAGE}/manifests/${tag}`, {
    method,
    headers: {
      accept: INDEX_TYPES.join(", "),
      authorization: `Bearer ${token}`,
    },
  });

/** BR-363 GHCR part, by phase. */
async function ghcrCheck(inputs: Inputs): Promise<string | null> {
  const token = await ghcrToken(true);
  if (token.status !== 200)
    return `unexpected GHCR token status ${String(token.status)}; refer to the owner`;
  const answer = await manifest(inputs.version, token.token, "HEAD");
  if (answer.status !== 200 && answer.status !== 404)
    return `unexpected GHCR status ${String(answer.status)}; refer to the owner`;
  if (inputs.phase === "npm")
    return answer.status === 200 ? null : "image not pushed";
  return answer.status === 404 ? null : "image already published";
}

async function check(): Promise<number> {
  const report = new Report("release-check");
  const inputs = validateInputs(report, true);
  if (!inputs) return report.summary();
  commitChecks(report, inputs);
  report.check("CI evidence", await ciEvidence(inputs.sha));
  npmChecks(report, inputs, await npmDocument());
  report.check("GHCR image", await ghcrCheck(inputs));
  report.check("release environment protected", await environmentProtected());
  return report.summary();
}

/** Minimal ustar reader: the bytes of one member of a .tgz file. */
function tarMember(tgz: Buffer, wanted: string): Buffer | null {
  const tar = gunzipSync(tgz);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return null;
    const text = (start: number, length: number) => {
      const raw = header.subarray(start, start + length).toString("utf8");
      const end = raw.indexOf("\0");
      return end < 0 ? raw : raw.slice(0, end);
    };
    const prefix = text(345, 155);
    const name = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const start = offset + 512;
    if (name.replace(/^\.\//u, "") === wanted && text(156, 1) !== "x")
      return tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

const REFUSED = new Set([
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "NPM_ID_TOKEN",
  "NPM_CONFIG__AUTH",
  "NPM_CONFIG__AUTHTOKEN",
  "NPM_CONFIG__PASSWORD",
  "NPM_CONFIG_USERNAME",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
]);
function npmTokenPresent(): boolean {
  return Object.keys(process.env).some((name) => {
    const upper = name.toUpperCase();
    return REFUSED.has(upper) || upper.startsWith("NPM_CONFIG_//");
  });
}

/** BR-365: npm output is captured and never printed (it may hold a body). */
function npmChild(args: string[]) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-024: the Docker-only dev image fixes PATH (Dockerfile.dev)
  return spawnSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function npmVersionOk(): boolean {
  const result = npmChild(["--version"]);
  if (result.error) throw result.error;
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(result.stdout.trim());
  if (result.status !== 0 || !match) return false;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  if (major !== 11) return (major ?? 0) > 11;
  if (minor !== 5) return (minor ?? 0) > 5;
  return (patch ?? 0) >= 1;
}

/** BR-369: the tarball's own package.json, or a fixed refusal. */
function releaseTarball(version: string): { bytes: Buffer; manifest: unknown } {
  let names: string[] = [];
  try {
    names = readdirSync("artifacts").filter(
      (name) => name.startsWith(TARBALL_PREFIX) && name.endsWith(".tgz"),
    );
  } catch {
    names = [];
  }
  if (names.length > 1) throw new FixedExit(1, "more than one tarball");
  if (names[0] !== `${TARBALL_PREFIX}${version}.tgz`)
    throw new FixedExit(1, "tarball not found");
  const bytes = readFileSync(`artifacts/${names[0]}`);
  let manifest: unknown;
  try {
    const member = tarMember(bytes, "package/package.json");
    manifest = member ? JSON.parse(member.toString("utf8")) : undefined;
  } catch {
    manifest = undefined;
  }
  if (
    field(manifest, "name") !== PACKAGE ||
    field(manifest, "version") !== version
  )
    throw new FixedExit(1, "tarball package.json does not match");
  return { bytes, manifest };
}

function publishNpm(): number {
  const report = new Report("release-npm");
  const inputs = validateInputs(report, false);
  if (!inputs) return report.summary();
  const tarball = releaseTarball(inputs.version);
  if (hasKey(tarball.manifest, "publishConfig"))
    throw new FixedExit(1, "publishConfig refused");
  if (!npmVersionOk()) throw new FixedExit(1, "npm 11.5.1 or later required");
  const digest = createHash("sha256").update(tarball.bytes).digest("hex");
  process.stdout.write(`release-npm: tarball sha256 ${digest}\n`);
  if (!inputs.dryRun) {
    if (env("RELEASE_TARBALL_SHA256") !== digest)
      throw new FixedExit(1, "tarball digest does not match verify");
    if (
      !env("ACTIONS_ID_TOKEN_REQUEST_URL") ||
      !env("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    )
      throw new FixedExit(1, "OIDC environment missing");
    if (npmTokenPresent())
      throw new FixedExit(1, "npm token in environment refused");
  }
  const args = [
    "publish",
    `./artifacts/${TARBALL_PREFIX}${inputs.version}.tgz`,
    "--tag",
    "beta",
    "--access",
    "public",
    "--ignore-scripts",
    "--provenance",
  ];
  if (inputs.dryRun) args.push("--dry-run");
  const result = npmChild(args);
  if (result.error) throw result.error;
  const code = result.status ?? 1;
  process.stdout.write(`release-npm: publish exit ${String(code)}\n`);
  if (code !== 0) throw new FixedExit(1, "npm publish failed");
  process.stdout.write("release-npm: done\n");
  return 0;
}

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** BR-379: the registry tarball bytes hash to the verify digest. */
async function tarballMatches(
  document: unknown,
  version: string,
  expected: string | null,
): Promise<string | null> {
  if (expected === null) return "verify digest missing";
  if (!hasKey(field(document, "versions"), version))
    return "npm version missing";
  const url = field(document, "versions", version, "dist", "tarball");
  let origin = "";
  try {
    origin = typeof url === "string" ? new URL(url).origin : "";
  } catch {
    origin = "";
  }
  if (
    origin === "" ||
    origin !== new URL(endpoint("RELEASE_NPM_REGISTRY_URL")).origin
  )
    return "npm tarball url refused";
  const answer = await request(String(url));
  if (answer.status !== 200)
    return `npm tarball status ${String(answer.status)}`;
  return sha256(answer.body) === expected
    ? null
    : "npm tarball differs from verify";
}

type Outcome = [string, string | null][];
/** BR-372 conditions of one attempt. */
async function npmAttempt(
  version: string,
  expected: string | null,
): Promise<Outcome> {
  const answer = await npmDocument();
  const document = answer.status === 200 ? parse(answer) : undefined;
  const status =
    answer.status === 200
      ? null
      : `npm registry status ${String(answer.status)}`;
  const present = hasKey(field(document, "versions"), version);
  return [
    [
      "npm version present",
      status ?? (present ? null : "version not published"),
    ],
    [
      "npm beta tag",
      field(document, "dist-tags", "beta") === version
        ? null
        : "beta does not name the version",
    ],
    [
      "npm latest is a deprecated placeholder",
      deprecatedLatest(document, version)
        ? null
        : "latest is not a deprecated placeholder",
    ],
    [
      "npm provenance",
      field(document, "versions", version, "dist", "attestations") === undefined
        ? "attestations missing"
        : null,
    ],
    [
      "npm tarball matches verify",
      await tarballMatches(document, version, expected),
    ],
  ];
}

function platforms(index: unknown): string[] {
  const entries = field(index, "manifests");
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry: unknown) => {
      const os = field(entry, "platform", "os");
      const architecture = field(entry, "platform", "architecture");
      return `${String(os)}/${String(architecture)}`;
    })
    .filter((platform) => platform !== "unknown/unknown");
}

/** BR-373: the index of the version has exactly the two platforms. */
function indexReason(index: Answer): string | null {
  if (index.status !== 200) return `GHCR status ${String(index.status)}`;
  const body = parse(index);
  const mediaType = field(body, "mediaType");
  const media = typeof mediaType === "string" ? mediaType : index.type;
  if (!INDEX_TYPES.some((type) => media.startsWith(type)))
    return "not an image index";
  const found = platforms(body);
  return found.length === 2 &&
    found.includes("linux/amd64") &&
    found.includes("linux/arm64")
    ? null
    : "platforms are not linux/amd64 and linux/arm64";
}
function latestReason(latest: Answer, digest: string): string | null {
  if (latest.status === 404) return null;
  if (latest.status !== 200) return `GHCR status ${String(latest.status)}`;
  return digest !== "" && sha256(latest.body) !== digest
    ? null
    : "latest names the release";
}
/** BR-373 `image is public (P-3)`: anonymous token, then anonymous HEAD. */
async function publicReason(version: string): Promise<string | null> {
  const anonymous = await ghcrToken(false);
  if (anonymous.status !== 200)
    return `anonymous token status ${String(anonymous.status)}`;
  const pulled = await manifest(version, anonymous.token, "HEAD");
  return pulled.status === 200
    ? null
    : `anonymous pull status ${String(pulled.status)}`;
}

/** BR-373: the multi-platform index, no latest tag, anonymous pulls. */
async function imageChecks(report: Report, version: string): Promise<void> {
  const token = await ghcrToken(true);
  let digest = "";
  if (token.status === 200) {
    const index = await manifest(version, token.token);
    const reason = indexReason(index);
    if (reason === null) digest = sha256(index.body);
    report.check("image platforms", reason);
    report.check(
      "image latest tag",
      latestReason(await manifest("latest", token.token), digest),
    );
  } else {
    const reason = `GHCR token status ${String(token.status)}`;
    report.check("image platforms", reason);
    report.check("image latest tag", reason);
  }
  if (digest !== "")
    process.stdout.write(`release-verify: image digest sha256:${digest}\n`);
  report.check("image is public (P-3)", await publicReason(version));
}

function retryDelay(): number {
  const value = env("RELEASE_RETRY_DELAY_MS");
  // Test doubles shorten the delay; it is never shortened in CI.
  if (env("GITHUB_ACTIONS") === "true" || value === undefined)
    return RETRY_DELAY_MS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : RETRY_DELAY_MS;
}

async function verify(): Promise<number> {
  const report = new Report("release-verify");
  const inputs = validateInputs(report, false);
  if (!inputs) return report.summary();
  const digest = env("RELEASE_TARBALL_SHA256") ?? "";
  const expected = /^[0-9a-f]{64}$/u.test(digest) ? digest : null;
  let outcome: Outcome = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    outcome = await npmAttempt(inputs.version, expected);
    if (expected === null || outcome.every(([, reason]) => reason === null))
      break;
    if (attempt < ATTEMPTS) await sleep(retryDelay());
  }
  for (const [name, reason] of outcome) report.check(name, reason);
  await imageChecks(report, inputs.version);
  return report.summary();
}

const MODES: Record<string, () => Promise<number>> = {
  check,
  npm: () => Promise.resolve(publishNpm()),
  verify,
};

async function main(): Promise<number> {
  refuseOverridesInCi();
  const mode = MODES[process.argv[2] ?? ""];
  if (!mode) throw new FixedExit(2, "release: unknown mode");
  return mode();
}

// BR-366: one top-level handler; only fixed texts are ever printed.
try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof FixedExit) {
    if (error.code === 2) process.stderr.write(`${error.text}\n`);
    else process.stdout.write(`release-npm: FAIL ${error.text}\n`);
    process.exitCode = error.code;
  } else {
    process.stderr.write("release: internal error\n");
    process.exitCode = 2;
  }
}

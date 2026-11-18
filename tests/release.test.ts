// F-024 AC-05–AC-13, AC-21: scripts/release.ts, scripts/release-image.sh and
// the release Make targets against test doubles.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { rules } from "./helpers/image-policy.js";
import {
  RecoveryRegistry,
  PREVIOUS_INDEX,
  PREVIOUS_DIGEST,
  RECOVERY_ACCEPT,
  runRecoveryBlock,
} from "./helpers/release-recovery.js";
import {
  CHECK_VARIABLES,
  NPM_VARIABLES,
  VERIFY_VARIABLES,
} from "./helpers/release-policy.js";
import {
  FAKE_DOCKER,
  FAKE_NPM,
  IMAGE_SCRIPT,
  OCI_INDEX,
  PLACEHOLDER,
  RELEASE_SCRIPT,
  TARBALL,
  VERSION,
  cleanupTemporaries,
  double,
  executable,
  gitEnv,
  goodEnvironment,
  indexBody,
  npmDocument,
  packTarball,
  releaseRepo,
  releaseRoute,
  releaseState,
  run,
  sha256,
  temporary,
  type Double,
  type ReleaseState,
  type RepoOptions,
  type Result,
} from "./helpers/release.js";

afterAll(() => {
  cleanupTemporaries();
});
const doubles: Double[] = [];
afterEach(async () => {
  for (const entry of doubles.splice(0)) await entry.close();
});

const GOOD_SHA = "a".repeat(40);
const TOKEN = "SYNTHETIC-RELEASE-TOKEN";

/** A fake bin directory with git recorded (then real git), npm and docker. */
function fakeBin(): {
  bin: string;
  npmLog: string;
  dockerLog: string;
  gitLog: string;
  stdin: string;
} {
  const root = temporary("release-bin-");
  const bin = join(root, "bin");
  const gitLog = join(root, "git.log");
  executable(
    join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${gitLog}'\nPATH='${process.env.PATH ?? "/usr/bin:/bin"}' exec git "$@"\n`,
  );
  executable(join(bin, "npm"), FAKE_NPM);
  executable(join(bin, "docker"), FAKE_DOCKER);
  return {
    bin,
    npmLog: join(root, "npm.log"),
    dockerLog: join(root, "docker.log"),
    gitLog,
    stdin: join(root, "docker.stdin"),
  };
}
function lines(path: string): string[] {
  return existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean)
    : [];
}
interface NpmCall {
  argv: string[];
  env: string[];
}
function npmCalls(path: string): NpmCall[] {
  return lines(path).map((line) => JSON.parse(line) as NpmCall);
}

async function startDouble(state: ReleaseState): Promise<Double> {
  const started = await double(releaseRoute(state));
  doubles.push(started);
  return started;
}
function endpoints(url: string): Record<string, string> {
  return {
    RELEASE_GITHUB_API_URL: url,
    RELEASE_NPM_REGISTRY_URL: url,
    RELEASE_GHCR_URL: url,
  };
}

function release(
  mode: string,
  cwd: string,
  env: Record<string, string | undefined>,
  bin?: string,
): Promise<Result> {
  const base = gitEnv();
  const clean: Record<string, string> = {
    ...base,
    PATH: bin ? `${bin}:${base.PATH ?? ""}` : (base.PATH ?? ""),
  };
  for (const [key, value] of Object.entries(env))
    if (value !== undefined) clean[key] = value;
  return run(process.execPath, [RELEASE_SCRIPT, mode], { cwd, env: clean });
}
function failed(stdout: string, prefix: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith(`${prefix}: `) && line.includes(" FAIL "))
    .map((line) => line.slice(prefix.length + 2, line.indexOf(" FAIL ")));
}
function line(stdout: string, prefix: string, check: string): string {
  return (
    stdout
      .split("\n")
      .find(
        (entry) =>
          entry === `${prefix}: ${check} ok` ||
          entry.startsWith(`${prefix}: ${check} FAIL `),
      ) ?? ""
  );
}

function checkEnv(
  repo: { sha: string },
  url: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    RELEASE_VERSION: VERSION,
    RELEASE_SHA: repo.sha,
    RELEASE_DRY_RUN: "true",
    RELEASE_PHASE: "verify",
    GITHUB_SHA: repo.sha,
    GITHUB_TOKEN: TOKEN,
    ...endpoints(url),
    ...extra,
  };
}

describe("F-024 AC-05 input validation", () => {
  const cases: [string, Record<string, string>, string][] = [
    [
      "v0.6.0-beta.1",
      { RELEASE_VERSION: "v0.6.0-beta.1" },
      "version is not a SemVer version",
    ],
    [
      "0.6.0-beta.01",
      { RELEASE_VERSION: "0.6.0-beta.01" },
      "version is not a SemVer version",
    ],
    [
      "0.6.0-rc.1",
      { RELEASE_VERSION: "0.6.0-rc.1" },
      "unsupported release version",
    ],
    [
      "0.6.0-beta.1+build",
      { RELEASE_VERSION: "0.6.0-beta.1+build" },
      "unsupported release version",
    ],
    ["0.6", { RELEASE_VERSION: "0.6" }, "version is not a SemVer version"],
    [
      "empty version",
      { RELEASE_VERSION: "" },
      "version is not a SemVer version",
    ],
    [
      "39-hex sha",
      { RELEASE_SHA: "a".repeat(39) },
      "sha is not a full commit id",
    ],
    [
      "upper-case sha",
      { RELEASE_SHA: "A".repeat(40) },
      "sha is not a full commit id",
    ],
    ["dry_run=yes", { RELEASE_DRY_RUN: "yes" }, "dry_run is not a boolean"],
    [
      "phase deploy",
      { RELEASE_PHASE: "deploy" },
      "phase is not a release phase",
    ],
  ];
  it.each(cases)("BR-359 refuses input %s", async (_name, override, reason) => {
    const state = releaseState(GOOD_SHA);
    const server = await startDouble(state);
    const fake = fakeBin();
    const cwd = temporary("release-inputs-");
    const result = await release(
      "check",
      cwd,
      checkEnv({ sha: GOOD_SHA }, server.url, override),
      fake.bin,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(` FAIL ${reason}\n`);
    expect(result.stdout).toMatch(
      /release-check: [1-4] of 4 checks failed\n$/u,
    );
    expect(server.seen).toEqual([]);
    expect(lines(fake.gitLog)).toEqual([]);
  });

  it("BR-359 passes input validation for 0.6.0-beta.1 and a full sha", async () => {
    const repo = releaseRepo();
    const server = await startDouble(releaseState(repo.sha));
    const result = await release(
      "check",
      repo.root,
      checkEnv(repo, server.url),
    );
    for (const check of ["version", "sha", "dry_run", "phase"])
      expect(result.stdout).toContain(`release-check: ${check} ok\n`);
  });
});

describe("F-024 AC-06 commit checks", () => {
  const cases: [string, RepoOptions, "sha" | "parent" | "unset", string[]][] = [
    ["matching VERSION, package.json, lockfile and tag", {}, "sha", []],
    [
      "VERSION 0.6.0-beta.2",
      { versionFile: "0.6.0-beta.2\n" },
      "sha",
      ["VERSION file"],
    ],
    [
      "package.json version mismatch",
      { packageVersion: "0.6.0-beta.2" },
      "sha",
      ["package.json version"],
    ],
    ["no tag", { tag: "none" }, "sha", ["release tag"]],
    ["tag on the parent commit", { tag: "parent" }, "sha", ["release tag"]],
    ["annotated tag on the commit", { tag: "annotated" }, "sha", []],
    ["commit only on the side branch", { side: true }, "sha", ["on main"]],
    [
      "GITHUB_SHA set to the parent commit",
      {},
      "parent",
      ["dispatched commit"],
    ],
    ["GITHUB_SHA unset", {}, "unset", ["dispatched commit"]],
  ];
  it.each(cases)(
    "BR-360 BR-361 commit checks: %s",
    async (_name, options, dispatched, expected) => {
      const repo = releaseRepo(options);
      const server = await startDouble(releaseState(repo.sha));
      const githubSha =
        dispatched === "sha"
          ? repo.sha
          : dispatched === "parent"
            ? repo.parent
            : undefined;
      const result = await release(
        "check",
        repo.root,
        checkEnv(repo, server.url, { GITHUB_SHA: githubSha }),
      );
      expect(failed(result.stdout, "release-check")).toEqual(expected);
      expect(result.status).toBe(expected.length === 0 ? 0 : 1);
      if (dispatched !== "sha")
        expect(line(result.stdout, "release-check", "dispatched commit")).toBe(
          "release-check: dispatched commit FAIL sha is not the dispatched commit",
        );
    },
  );
});

describe("F-024 AC-07 CI evidence", () => {
  const run = (sha: string, event: string, branch = "main") => ({
    status: 200,
    body: {
      total_count: 1,
      workflow_runs: [{ id: 11, head_sha: sha, head_branch: branch, event }],
    },
  });
  const job = (conclusion: string) => ({
    status: 200,
    body: { jobs: [{ name: "ci-result", conclusion }] },
  });
  const cases: [string, (state: ReleaseState) => void, boolean][] = [
    ["successful push run on main", () => undefined, true],
    [
      "only a pull_request run",
      (s) => {
        s.ciRuns = run(s.sha, "pull_request");
      },
      false,
    ],
    [
      "ci-result failure",
      (s) => {
        s.ciJobs = job("failure");
      },
      false,
    ],
    [
      "ci-result skipped",
      (s) => {
        s.ciJobs = job("skipped");
      },
      false,
    ],
    [
      "a run on another sha",
      (s) => {
        s.ciRuns = run("b".repeat(40), "push");
      },
      false,
    ],
    [
      "status 500",
      (s) => {
        s.ciRuns = { status: 500 };
      },
      false,
    ],
  ];
  it.each(cases)("BR-362 CI evidence: %s", async (_name, change, passes) => {
    const repo = releaseRepo();
    const state = releaseState(repo.sha);
    change(state);
    const server = await startDouble(state);
    const result = await release(
      "check",
      repo.root,
      checkEnv(repo, server.url),
    );
    expect(failed(result.stdout, "release-check")).toEqual(
      passes ? [] : ["CI evidence"],
    );
    if (_name === "status 500")
      expect(line(result.stdout, "release-check", "CI evidence")).toBe(
        "release-check: CI evidence FAIL GitHub API status 500",
      );
  });
});

describe("F-024 AC-08 registry checks", () => {
  const published = (where: "versions" | "time") => {
    const document = npmDocument({ published: true, tarballUrl: "x" });
    if (where === "time")
      delete (document.versions as Record<string, unknown>)[VERSION];
    else delete (document.time as Record<string, unknown>)[VERSION];
    return { status: 200, body: document };
  };
  type Case = [
    string,
    string,
    string,
    (state: ReleaseState) => void,
    string[],
    string?,
  ];
  const cases: Case[] = [
    [
      "npm 404",
      "true",
      "verify",
      (s) => {
        s.npm = { status: 404 };
      },
      [],
    ],
    [
      "npm 200 without the version",
      "true",
      "verify",
      (s) => {
        // AC-39 BR-363 v3: retain a valid bootstrap registry state.
        s.npm = { status: 200, body: npmDocument({}) };
      },
      [],
    ],
    [
      "npm 200 with the version in versions",
      "true",
      "verify",
      (s) => {
        s.npm = published("versions");
      },
      ["npm version not published"],
    ],
    [
      "npm 200 with the version only in time",
      "true",
      "verify",
      (s) => {
        s.npm = published("time");
      },
      ["npm version not published"],
    ],
    [
      "npm 200 with only the deprecated placeholder on latest",
      "true",
      "verify",
      () => undefined,
      [],
    ],
    [
      "npm 503",
      "true",
      "verify",
      (s) => {
        s.npm = { status: 503 };
      },
      ["npm version not published", "npm default", "GHCR image"],
    ],
    ["GHCR manifest 404", "true", "verify", () => undefined, []],
    [
      "GHCR manifest 200",
      "true",
      "verify",
      (s) => {
        s.manifest = { status: 200 };
      },
      ["GHCR image"],
    ],
    [
      "GHCR manifest 401",
      "true",
      "verify",
      (s) => {
        s.manifest = { status: 401 };
      },
      ["GHCR image"],
      "unexpected GHCR status 401; refer to the owner",
    ],
    [
      "GHCR manifest 403",
      "true",
      "verify",
      (s) => {
        s.manifest = { status: 403 };
      },
      ["GHCR image"],
      "unexpected GHCR status 403; refer to the owner",
    ],
    [
      "GHCR token 401",
      "true",
      "verify",
      (s) => {
        s.ghcrToken = { status: 401 };
      },
      ["GHCR image"],
      "unexpected GHCR token status 401; refer to the owner",
    ],
    [
      "GHCR token 200 without a token",
      "true",
      "verify",
      (s) => {
        s.ghcrToken = { status: 200, body: { access_token: 1 } };
      },
      ["GHCR image"],
      "unexpected GHCR token status 0; refer to the owner",
    ],
    [
      "GHCR token 200 with a non-string token",
      "true",
      "verify",
      (s) => {
        s.ghcrToken = { status: 200, body: { token: 7 } };
      },
      ["GHCR image"],
      "unexpected GHCR token status 0; refer to the owner",
    ],
    [
      "dry run false npm 404",
      "false",
      "verify",
      (s) => {
        s.npm = { status: 404 };
      },
      ["npm version not published", "npm default", "GHCR image"],
      "npm registry status 404",
    ],
    [
      "dry run false deprecated placeholder on latest",
      "false",
      "verify",
      () => undefined,
      [],
    ],
    [
      "dry run false latest on a non-deprecated version",
      "false",
      "verify",
      (s) => {
        s.npm = {
          status: 200,
          body: npmDocument({ placeholderDeprecated: false }),
        };
      },
      ["npm default", "GHCR image"],
      "original placeholder is not deprecated",
    ],
    [
      "dry run false dist-tags without latest",
      "false",
      "verify",
      (s) => {
        s.npm = { status: 200, body: npmDocument({ latest: undefined }) };
      },
      ["npm default", "GHCR image"],
      "npm latest tag missing",
    ],
    [
      "phase npm GHCR manifest 200",
      "true",
      "npm",
      (s) => {
        s.manifest = { status: 200 };
      },
      [],
    ],
    [
      "phase npm GHCR manifest 404",
      "true",
      "npm",
      () => undefined,
      ["GHCR image"],
      "image not pushed",
    ],
  ];
  it.each([
    ["a non-JSON body", "true", "<html>not json</html>"],
    ["a non-JSON body", "false", "<html>not json</html>"],
    ["a JSON array", "true", [1, 2]],
    ["a body without versions", "true", { "dist-tags": { latest: "x" } }],
    ["a body without versions", "false", { "dist-tags": { latest: "x" } }],
    ["versions not an object", "true", { versions: "0.6.0-beta.1" }],
    ["a body without time", "true", { versions: {} }],
    ["a body without time", "false", { versions: {} }],
    ["time not an object", "true", { versions: {}, time: "0.6.0-beta.1" }],
    ["time an array", "false", { versions: {}, time: ["0.6.0-beta.1"] }],
  ])(
    "BR-363 already published: npm 200 with %s fails closed (dry run %s)",
    async (_name, dryRun, body) => {
      const repo = releaseRepo();
      const state = releaseState(repo.sha);
      state.npm = { status: 200, body };
      const server = await startDouble(state);
      const result = await release(
        "check",
        repo.root,
        checkEnv(repo, server.url, { RELEASE_DRY_RUN: dryRun }),
      );
      expect(
        line(result.stdout, "release-check", "npm version not published"),
      ).toBe(
        "release-check: npm version not published FAIL npm document unreadable; refer to the owner",
      );
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("not json");
    },
  );
  it.each(cases)(
    "BR-363 already published: %s",
    async (_name, dryRun, phase, change, expected, reason) => {
      const repo = releaseRepo();
      const state = releaseState(repo.sha);
      change(state);
      const server = await startDouble(state);
      const result = await release(
        "check",
        repo.root,
        checkEnv(repo, server.url, {
          RELEASE_DRY_RUN: dryRun,
          RELEASE_PHASE: phase,
        }),
      );
      expect(failed(result.stdout, "release-check")).toEqual(expected);
      expect(result.status).toBe(expected.length === 0 ? 0 : 1);
      if (reason) expect(result.stdout).toContain(` FAIL ${reason}\n`);
      // BR-364: only GET and HEAD requests (the token request is a GET).
      for (const request of server.seen)
        expect(["GET", "HEAD"]).toContain(request.method);
    },
  );
});

describe("F-024 AC-21 release environment protection", () => {
  const cases: [string, (state: ReleaseState) => void, string | null][] = [
    ["required reviewer and exactly branch main", () => undefined, null],
    [
      "no required_reviewers rule",
      (s) => {
        s.environment = {
          status: 200,
          body: {
            ...goodEnvironment(),
            protection_rules: [{ type: "branch_policy" }],
          },
        };
      },
      "release environment not protected (P-2)",
    ],
    [
      "empty reviewers",
      (s) => {
        s.environment = {
          status: 200,
          body: {
            ...goodEnvironment(),
            protection_rules: [{ type: "required_reviewers", reviewers: [] }],
          },
        };
      },
      "release environment not protected (P-2)",
    ],
    [
      "protected_branches true",
      (s) => {
        s.environment = {
          status: 200,
          body: {
            ...goodEnvironment(),
            deployment_branch_policy: {
              protected_branches: true,
              custom_branch_policies: false,
            },
          },
        };
      },
      "release environment not protected (P-2)",
    ],
    [
      "policies main and dev",
      (s) => {
        s.policies = {
          status: 200,
          body: {
            total_count: 2,
            branch_policies: [
              { name: "main", type: "branch" },
              { name: "dev", type: "branch" },
            ],
          },
        };
      },
      "release environment not protected (P-2)",
    ],
    [
      "single policy main of type tag",
      (s) => {
        s.policies = {
          status: 200,
          body: {
            total_count: 1,
            branch_policies: [{ name: "main", type: "tag" }],
          },
        };
      },
      "release environment not protected (P-2)",
    ],
    [
      "single policy main*",
      (s) => {
        s.policies = {
          status: 200,
          body: {
            total_count: 1,
            branch_policies: [{ name: "main*", type: "branch" }],
          },
        };
      },
      "release environment not protected (P-2)",
    ],
    [
      "environment 404",
      (s) => {
        s.environment = { status: 404 };
      },
      "release environment unreadable 404; refer to the owner",
    ],
    [
      "environment 403",
      (s) => {
        s.environment = { status: 403 };
      },
      "release environment unreadable 403; refer to the owner",
    ],
    [
      "environment 500",
      (s) => {
        s.environment = { status: 500 };
      },
      "release environment unreadable 500; refer to the owner",
    ],
    [
      "policies 403",
      (s) => {
        s.policies = { status: 403 };
      },
      "release environment unreadable 403; refer to the owner",
    ],
  ];
  it.each(cases)(
    "BR-378 release environment protection: %s",
    async (_name, change, reason) => {
      const repo = releaseRepo();
      for (const phase of ["verify", "image", "npm"]) {
        const state = releaseState(repo.sha);
        if (phase === "npm") state.manifest = { status: 200 };
        change(state);
        const server = await startDouble(state);
        const result = await release(
          "check",
          repo.root,
          checkEnv(repo, server.url, { RELEASE_PHASE: phase }),
        );
        expect(
          line(result.stdout, "release-check", "release environment protected"),
        ).toBe(
          reason === null
            ? "release-check: release environment protected ok"
            : `release-check: release environment protected FAIL ${reason}`,
        );
        expect(result.status).toBe(reason === null ? 0 : 1);
        const environmentReads = server.seen.filter((request) =>
          request.url.includes("/environments/release"),
        );
        expect(environmentReads).toHaveLength(2);
        for (const request of environmentReads)
          expect(request.method).toBe("GET");
      }
    },
  );
});

describe("F-024 AC-09 output safety", () => {
  it("BR-365 never prints credentials", async () => {
    const echo = await double((request) => ({
      status: 500,
      body: { echo: request.authorization ?? "", marker: "BODY-MARKER" },
    }));
    doubles.push(echo);
    const repo = releaseRepo();
    const fake = fakeBin();
    mkdirSync(join(repo.root, "artifacts"));
    packTarball(join(repo.root, "artifacts", TARBALL), {
      name: "@sstolz/kdrive-mcp-server",
      version: VERSION,
    });
    for (const mode of ["check", "npm", "verify"]) {
      const result = await release(
        mode,
        repo.root,
        {
          ...checkEnv(repo, echo.url),
          RELEASE_TARBALL_SHA256: "0".repeat(64),
          RELEASE_RETRY_DELAY_MS: "0",
          FAKE_NPM_LOG: fake.npmLog,
        },
        fake.bin,
      );
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain("BODY-MARKER");
      expect(output).not.toMatch(/Bearer|Basic /u);
    }
    expect(echo.seen.length).toBeGreaterThan(0);
  });

  it("BR-366 internal error", async () => {
    const server = await startDouble(releaseState(GOOD_SHA));
    const cwd = temporary("release-not-a-repo-");
    const result = await release(
      "check",
      cwd,
      checkEnv({ sha: GOOD_SHA }, server.url),
    );
    expect(result.stderr).toBe("release: internal error\n");
    expect(result.status).toBe(2);
  });

  it("BR-367 refuses overrides in CI", async () => {
    const server = await startDouble(releaseState(GOOD_SHA));
    const repo = releaseRepo();
    const fake = fakeBin();
    for (const mode of ["check", "npm", "verify"]) {
      const result = await release(
        mode,
        repo.root,
        {
          RELEASE_VERSION: VERSION,
          RELEASE_SHA: repo.sha,
          RELEASE_DRY_RUN: "true",
          RELEASE_PHASE: "verify",
          GITHUB_SHA: repo.sha,
          GITHUB_TOKEN: TOKEN,
          GITHUB_ACTIONS: "true",
          RELEASE_NPM_REGISTRY_URL: server.url,
          FAKE_NPM_LOG: fake.npmLog,
        },
        fake.bin,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("release: endpoint override refused in CI\n");
      expect(result.status).toBe(2);
    }
    expect(server.seen).toEqual([]);
    expect(lines(fake.gitLog)).toEqual([]);
    expect(npmCalls(fake.npmLog)).toEqual([]);
  });
});

const PUBLISH_ARGV = [
  "publish",
  `./artifacts/${TARBALL}`,
  "--tag",
  "beta",
  "--access",
  "public",
  "--ignore-scripts",
  "--provenance",
];
function expectPublishArgv(argv: string[], dryRun: boolean): void {
  const expected = dryRun ? [...PUBLISH_ARGV, "--dry-run"] : PUBLISH_ARGV;
  if (JSON.stringify(argv) !== JSON.stringify(expected))
    throw new Error(`unexpected npm publish argv: ${argv.join(" ")}`);
}

describe("F-024 AC-10 npm publish", () => {
  const OIDC = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:1/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "SYNTHETIC-OIDC",
  };
  const RELEASED = { name: "@sstolz/kdrive-mcp-server", version: VERSION };
  interface Setup {
    tarballs?: Record<string, Record<string, unknown>>;
    env?: Record<string, string | undefined>;
    npmVersion?: string;
  }
  /** Packs the fixture tarballs, then runs release-npm; `setup` may read the digest. */
  async function publish(
    setup: Setup | ((digest: string) => Setup),
  ): Promise<{ result: Result; calls: NpmCall[]; digest: string }> {
    const cwd = temporary("release-npm-");
    const fake = fakeBin();
    mkdirSync(join(cwd, "artifacts"), { recursive: true });
    const tarballs = (typeof setup === "function"
      ? undefined
      : setup.tarballs) ?? {
      [TARBALL]: RELEASED,
    };
    let digest = "";
    for (const [name, manifest] of Object.entries(tarballs)) {
      const bytes = packTarball(join(cwd, "artifacts", name), manifest);
      if (name === TARBALL) digest = sha256(bytes);
    }
    const resolved = typeof setup === "function" ? setup(digest) : setup;
    const result = await release(
      "npm",
      cwd,
      {
        RELEASE_VERSION: VERSION,
        RELEASE_SHA: GOOD_SHA,
        RELEASE_DRY_RUN: "true",
        FAKE_NPM_LOG: fake.npmLog,
        FAKE_NPM_VERSION: resolved.npmVersion ?? "11.5.1",
        ...resolved.env,
      },
      fake.bin,
    );
    return { result, calls: npmCalls(fake.npmLog), digest };
  }
  const publishes = (calls: NpmCall[]) =>
    calls.filter((call) => call.argv[0] === "publish");

  it("BR-368 BR-369 npm publish: dry run", async () => {
    const { result, calls, digest } = await publish({});
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(`release-npm: tarball sha256 ${digest}\n`);
    expect(publishes(calls)).toHaveLength(1);
    expectPublishArgv(publishes(calls)[0]!.argv, true);
    expect(calls.map((call) => call.argv)).toEqual([
      ["--version"],
      [...PUBLISH_ARGV, "--dry-run"],
    ]);
  });

  it("BR-368 BR-369 npm publish: real run with OIDC and the verify digest", async () => {
    const { result, calls, digest } = await publish((verified) => ({
      env: {
        RELEASE_DRY_RUN: "false",
        RELEASE_TARBALL_SHA256: verified,
        ...OIDC,
      },
    }));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(`release-npm: tarball sha256 ${digest}\n`);
    expect(publishes(calls)).toHaveLength(1);
    expectPublishArgv(publishes(calls)[0]!.argv, false);
    expect(calls.map((call) => call.argv)).toEqual([
      ["--version"],
      PUBLISH_ARGV,
    ]);
  });

  it.each([
    [
      "without the leading ./",
      PUBLISH_ARGV.map((arg) => arg.replace(/^\.\//u, "")),
    ],
    [
      "without --provenance",
      PUBLISH_ARGV.filter((arg) => arg !== "--provenance"),
    ],
  ])(
    "BR-369 npm publish: the exact-argv assertion rejects an argv %s",
    (_name, argv) => {
      expect(() => {
        expectPublishArgv(argv, false);
      }).toThrow();
    },
  );

  const inputCases: [string, Record<string, string>, string][] = [
    [
      "version v0.6.0-beta.1",
      { RELEASE_VERSION: "v0.6.0-beta.1" },
      "version is not a SemVer version",
    ],
    [
      "version 0.6.0-beta.1;id",
      { RELEASE_VERSION: "0.6.0-beta.1;id" },
      "version is not a SemVer version",
    ],
    [
      "upper-case sha",
      { RELEASE_SHA: "A".repeat(40) },
      "sha is not a full commit id",
    ],
    ["dry_run=yes", { RELEASE_DRY_RUN: "yes" }, "dry_run is not a boolean"],
  ];
  it.each(inputCases)(
    "BR-369 npm publish: input %s",
    async (_name, env, reason) => {
      const { result, calls } = await publish({ env });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(` FAIL ${reason}\n`);
      expect(calls).toEqual([]);
    },
  );

  const REFUSED = [
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN",
    "NPM_ID_TOKEN",
    "NPM_CONFIG__AUTH",
    "NPM_CONFIG__AUTHTOKEN",
    "NPM_CONFIG__PASSWORD",
    "NPM_CONFIG_USERNAME",
    "NPM_CONFIG_USERCONFIG",
    "NPM_CONFIG_GLOBALCONFIG",
    "node_auth_token",
    "npm_config_//registry.npmjs.org/:_authToken",
  ];
  const real =
    (env: Record<string, string | undefined>) =>
    (digest: string): Setup => ({
      env: {
        RELEASE_DRY_RUN: "false",
        ...OIDC,
        RELEASE_TARBALL_SHA256: digest,
        ...env,
      },
    });
  const other = { ...RELEASED, description: "other" };
  const refusals: [string, Setup | ((digest: string) => Setup), string][] = [
    [
      "RELEASE_TARBALL_SHA256 missing",
      real({ RELEASE_TARBALL_SHA256: undefined }),
      "tarball digest does not match verify",
    ],
    [
      "RELEASE_TARBALL_SHA256 upper-case",
      (digest) =>
        real({ RELEASE_TARBALL_SHA256: digest.toUpperCase() })(digest),
      "tarball digest does not match verify",
    ],
    [
      "RELEASE_TARBALL_SHA256 of another tarball",
      real({ RELEASE_TARBALL_SHA256: sha256(JSON.stringify(other)) }),
      "tarball digest does not match verify",
    ],
    ...REFUSED.map((name): [string, (digest: string) => Setup, string] => [
      `refused variable ${name}`,
      real({ [name]: "SYNTHETIC" }),
      "npm token in environment refused",
    ]),
    [
      "without the OIDC variables",
      real({
        ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
      }),
      "OIDC environment missing",
    ],
    ["npm 11.5.0", { npmVersion: "11.5.0" }, "npm 11.5.1 or later required"],
    ["npm 10.9.2", { npmVersion: "10.9.2" }, "npm 11.5.1 or later required"],
    ["missing tarball", { tarballs: {} }, "tarball not found"],
    [
      "two tarballs",
      {
        tarballs: {
          [TARBALL]: RELEASED,
          "sstolz-kdrive-mcp-server-0.6.0-beta.2.tgz": {
            ...RELEASED,
            version: "0.6.0-beta.2",
          },
        },
      },
      "more than one tarball",
    ],
    [
      "inner version differs",
      { tarballs: { [TARBALL]: { ...RELEASED, version: "0.6.0-beta.2" } } },
      "tarball package.json does not match",
    ],
    [
      "publishConfig dry run true",
      {
        tarballs: {
          [TARBALL]: { ...RELEASED, publishConfig: { tag: "latest" } },
        },
      },
      "publishConfig refused",
    ],
    [
      "publishConfig dry run false",
      {
        tarballs: {
          [TARBALL]: { ...RELEASED, publishConfig: { tag: "latest" } },
        },
        env: { RELEASE_DRY_RUN: "false", ...OIDC },
      },
      "publishConfig refused",
    ],
  ];
  it.each([
    ["0", 0],
    ["1", 1],
  ])(
    "BR-369 npm publish: output hidden, fixed status line (BR-365, npm exit %s)",
    async (status, code) => {
      const { result, calls } = await publish({
        env: {
          FAKE_NPM_STATUS: status,
          FAKE_NPM_PUBLISH_OUTPUT:
            '{"_id":"@sstolz/kdrive-mcp-server","BODY-MARKER":"registry"}',
        },
      });
      expect(publishes(calls)).toHaveLength(1);
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("BODY-MARKER");
      expect(output).not.toContain("_id");
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        `release-npm: publish exit ${String(code)}\n`,
      );
      expect(result.status).toBe(code === 0 ? 0 : 1);
    },
  );
  it("BR-369 npm publish: a failed publish prints only npm's bare error code (BR-365)", async () => {
    const { result, calls } = await publish({
      env: {
        FAKE_NPM_STATUS: "1",
        FAKE_NPM_PUBLISH_OUTPUT: [
          '{"_id":"@sstolz/kdrive-mcp-server","BODY-MARKER":"registry"}',
          "npm error code E403",
          "npm error 403 Forbidden - PUT BODY-MARKER",
          "npm error code E403 BODY-MARKER",
          " npm error code EBODYMARKER",
        ].join("\n"),
      },
    });
    expect(publishes(calls)).toHaveLength(1);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("BODY-MARKER");
    expect(output).not.toContain("EBODYMARKER");
    expect(output).not.toContain("Forbidden");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "release-npm: publish exit 1\nrelease-npm: npm error code E403\n",
    );
    expect(result.stdout.split("npm error code").length - 1).toBe(1);
    expect(result.status).toBe(1);
  });
  it("BR-369 npm publish: a failed publish without an error code prints no code line", async () => {
    const { result } = await publish({
      env: {
        FAKE_NPM_STATUS: "1",
        FAKE_NPM_PUBLISH_OUTPUT: "npm ERR! code e403\nnpm ERR! code E403 x",
      },
    });
    expect(result.stdout).not.toContain("npm error code");
    expect(result.stdout).toContain("release-npm: publish exit 1\n");
    expect(result.status).toBe(1);
  });
  it("BR-369 npm publish: the legacy npm ERR! prefix is recognised (BR-365)", async () => {
    const { result } = await publish({
      env: {
        FAKE_NPM_STATUS: "1",
        FAKE_NPM_PUBLISH_OUTPUT: "BODY-MARKER\nnpm ERR! code E404",
      },
    });
    expect(result.stdout).toContain("release-npm: npm error code E404\n");
    expect(result.stdout).not.toContain("BODY-MARKER");
    expect(result.status).toBe(1);
  });
  it.each(refusals)("BR-369 npm publish: %s", async (_name, setup, message) => {
    const { result, calls } = await publish(setup);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`FAIL ${message}\n`);
    expect(publishes(calls)).toEqual([]);
  });
});

describe("F-024 AC-11 image build", () => {
  async function image(
    env: Record<string, string>,
  ): Promise<{ result: Result; calls: string[]; stdin: string }> {
    const fake = fakeBin();
    const cwd = temporary("release-image-");
    const base = gitEnv();
    const result = await run("/bin/sh", [IMAGE_SCRIPT], {
      cwd,
      env: {
        PATH: `${fake.bin}:${base.PATH ?? ""}`,
        HOME: base.HOME ?? "",
        FAKE_DOCKER_LOG: fake.dockerLog,
        FAKE_DOCKER_STDIN: fake.stdin,
        RELEASE_VERSION: VERSION,
        RELEASE_SHA: GOOD_SHA,
        RELEASE_DRY_RUN: "true",
        IMAGE_PLATFORMS: "linux/amd64 linux/arm64",
        ...env,
      },
    });
    return {
      result,
      calls: lines(fake.dockerLog),
      stdin: existsSync(fake.stdin) ? readFileSync(fake.stdin, "utf8") : "",
    };
  }
  const builds = (calls: string[]) =>
    calls.filter((call) => call.startsWith("buildx build "));

  it("BR-370 image build: dry run builds both platforms without push, tag or login", async () => {
    const { result, calls } = await image({});
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const build = builds(calls);
    expect(build).toHaveLength(1);
    const words = build[0]!.split(" ");
    expect(words).toContain("--platform");
    expect(words[words.indexOf("--platform") + 1]).toBe(
      "linux/amd64,linux/arm64",
    );
    expect(words[words.indexOf("--target") + 1]).toBe("runtime");
    for (const flag of [
      "--push",
      "--load",
      "--output",
      "--tag",
      "--cache-from",
      "--cache-to",
      "--build-arg",
      "--secret",
    ])
      expect(words).not.toContain(flag);
    expect(calls.some((call) => call.startsWith("login"))).toBe(false);
    const create = calls.find((call) => call.startsWith("buildx create "));
    expect(create).toMatch(/--driver docker-container/u);
    expect(create).toMatch(/image=moby\/buildkit:v[\d.]+@sha256:[0-9a-f]{64}/u);
  });

  it("BR-368 BR-370 image build: real run logs in through stdin, pushes one tag and logs out", async () => {
    const { result, calls, stdin } = await image({
      RELEASE_DRY_RUN: "false",
      GITHUB_TOKEN: TOKEN,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const login = calls.findIndex((call) => call.startsWith("login ghcr.io"));
    expect(login).toBeGreaterThanOrEqual(0);
    expect(calls[login]).toContain("--password-stdin");
    expect(stdin).toBe(TOKEN);
    for (const call of calls) expect(call).not.toContain(TOKEN);
    const build = builds(calls);
    expect(build).toHaveLength(1);
    const words = build[0]!.split(" ");
    expect(words.filter((word) => word === "--push")).toHaveLength(1);
    expect(words.filter((word) => word === "--tag")).toHaveLength(1);
    expect(words[words.indexOf("--tag") + 1]).toBe(
      `ghcr.io/sstolz/kdrive-mcp-server:${VERSION}`,
    );
    for (const label of [
      "org.opencontainers.image.source=https://github.com/sstolz/kdrive-mcp-server",
      `org.opencontainers.image.version=${VERSION}`,
      `org.opencontainers.image.revision=${GOOD_SHA}`,
    ])
      expect(words).toContain(label);
    expect(build[0]).not.toContain("latest");
    for (const flag of ["--cache-from", "--cache-to", "--load", "--output"])
      expect(words).not.toContain(flag);
    const logout = calls.findIndex((call) => call === "logout ghcr.io");
    expect(logout).toBeGreaterThan(calls.indexOf(build[0]!));
    expect(login).toBeLessThan(calls.indexOf(build[0]!));
  });

  it("BR-370 image build: a failed build still logs out", async () => {
    const { result, calls } = await image({
      RELEASE_DRY_RUN: "false",
      GITHUB_TOKEN: TOKEN,
      FAKE_BUILD_FAIL: "1",
    });
    expect(result.status).not.toBe(0);
    expect(
      calls.at(-1) === "logout ghcr.io" || calls.includes("logout ghcr.io"),
    ).toBe(true);
    expect(calls.indexOf("logout ghcr.io")).toBeGreaterThan(
      calls.findIndex((call) => call.startsWith("buildx build ")),
    );
  });

  const refusals: [string, Record<string, string>, string][] = [];
  for (const dryRun of ["true", "false"])
    refusals.push(
      [
        `version v0.6.0-beta.1 dry_run=${dryRun}`,
        { RELEASE_DRY_RUN: dryRun, RELEASE_VERSION: "v0.6.0-beta.1" },
        "version is not a SemVer version",
      ],
      [
        `version 0.6.0-beta.1;id dry_run=${dryRun}`,
        { RELEASE_DRY_RUN: dryRun, RELEASE_VERSION: "0.6.0-beta.1;id" },
        "version is not a SemVer version",
      ],
      [
        `39-hex sha dry_run=${dryRun}`,
        { RELEASE_DRY_RUN: dryRun, RELEASE_SHA: "a".repeat(39) },
        "sha is not a full commit id",
      ],
    );
  refusals.push([
    "dry_run=yes",
    { RELEASE_DRY_RUN: "yes" },
    "dry_run is not a boolean",
  ]);
  it.each(refusals)(
    "BR-370 image build: refuses %s",
    async (_name, env, reason) => {
      const { result, calls } = await image({ GITHUB_TOKEN: TOKEN, ...env });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(` FAIL ${reason}\n`);
      expect(calls).toEqual([]);
    },
  );
});

describe("F-024 AC-12 read-back", () => {
  const PACKED = Buffer.from("synthetic packed tarball bytes");
  async function readBack(
    change: (state: ReleaseState, url: string, other: string) => void,
    env: Record<string, string | undefined> = {},
  ): Promise<{
    result: Result;
    server: Double;
    other: Double;
    state: ReleaseState;
  }> {
    const state = releaseState(GOOD_SHA);
    const server = await startDouble(state);
    const other = await double(() => ({ status: 200, body: PACKED }));
    doubles.push(other);
    state.npm = {
      status: 200,
      body: npmDocument({
        published: true,
        tarballUrl: `${server.url}/tarballs/pkg.tgz`,
      }),
    };
    state.tarball = { status: 200, body: PACKED };
    change(state, server.url, other.url);
    const result = await release("verify", temporary("release-verify-"), {
      RELEASE_VERSION: VERSION,
      RELEASE_SHA: GOOD_SHA,
      RELEASE_DRY_RUN: "false",
      GITHUB_TOKEN: TOKEN,
      RELEASE_TARBALL_SHA256: sha256(PACKED),
      RELEASE_RETRY_DELAY_MS: "0",
      ...endpoints(server.url),
      ...env,
    });
    return { result, server, other, state };
  }
  const npm =
    (options: Parameters<typeof npmDocument>[0]) =>
    (s: ReleaseState, url: string) => {
      s.npm = {
        status: 200,
        body: npmDocument({
          published: true,
          tarballUrl: `${url}/tarballs/pkg.tgz`,
          ...options,
        }),
      };
    };
  const index = (platforms: string[]) => (s: ReleaseState) => {
    s.index = {
      status: 200,
      body: indexBody(platforms),
      headers: { "content-type": OCI_INDEX },
    };
  };
  type Change = (state: ReleaseState, url: string, other: string) => void;
  const cases: [string, Change, string | null][] = [
    ["everything holds with the placeholder on latest", () => undefined, null],
    [
      "latest is the sole version (P-0 skipped)",
      npm({ placeholder: false, latest: VERSION }),
      "npm default",
    ],
    ["beta points elsewhere", npm({ beta: PLACEHOLDER }), "npm beta tag"],
    [
      "latest moved to the new version",
      npm({ latest: VERSION }),
      "npm default",
    ],
    ["latest missing", npm({ latest: undefined }), "npm default"],
    [
      "latest names a non-deprecated version",
      npm({ placeholderDeprecated: false }),
      "npm default",
    ],
    ["attestations missing", npm({ attestations: false }), "npm provenance"],
    ["the index lacks linux/arm64", index(["linux/amd64"]), "image platforms"],
    [
      "the index has an extra linux/386",
      index(["linux/amd64", "linux/arm64", "linux/386"]),
      "image platforms",
    ],
    [
      "image tag latest resolves to the new digest",
      (s) => {
        s.latest = s.index;
      },
      "image latest tag",
    ],
    [
      "anonymous token 401",
      (s) => {
        s.anonToken = { status: 401 };
      },
      "image is public (P-3)",
    ],
    [
      "anonymous manifest 401",
      (s) => {
        s.anonManifest = { status: 401 };
      },
      "image is public (P-3)",
    ],
    [
      "anonymous manifest 404",
      (s) => {
        s.anonManifest = { status: 404 };
      },
      "image is public (P-3)",
    ],
    [
      "the version never appears within 20 attempts",
      (s) => {
        s.npm = { status: 200, body: npmDocument() };
      },
      "npm version present",
    ],
    [
      "the version appears only on the third attempt",
      (s, url) => {
        const late = {
          status: 200,
          body: npmDocument({
            published: true,
            tarballUrl: `${url}/tarballs/pkg.tgz`,
          }),
        };
        s.npm = (attempt) =>
          attempt >= 3 ? late : { status: 200, body: npmDocument() };
      },
      null,
    ],
  ];
  it.each(cases)(
    "BR-372 v2 BR-373 v2 read-back: %s",
    async (name, change, failing) => {
      const { result, server, state } = await readBack(change);
      if (failing === null) {
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(failed(result.stdout, "release-verify")).toEqual([]);
        expect(result.stdout).toMatch(
          /^release-verify: image digest sha256:[0-9a-f]{64}$/mu,
        );
        expect(result.stdout).toContain(
          `release-verify: image digest sha256:${sha256(indexBody(["linux/amd64", "linux/arm64"]))}\n`,
        );
      } else {
        expect(result.status).toBe(1);
        expect(failed(result.stdout, "release-verify")).toContain(failing);
      }
      if (name.includes("third")) expect(state.npmAttempts).toBe(3);
      if (name.includes("20 attempts")) expect(state.npmAttempts).toBe(20);
      const anonymousToken = server.seen.filter(
        (request) =>
          request.url.startsWith("/token?") &&
          request.authorization === undefined,
      );
      expect(anonymousToken.length).toBeGreaterThan(0);
      for (const request of server.seen)
        if (request.authorization !== undefined)
          expect(
            request.authorization.includes("anon-token") ||
              request.authorization === "Bearer pull-token" ||
              request.authorization.startsWith("Basic "),
          ).toBe(true);
    },
  );

  it.each(["", `sha256:${"a".repeat(64)}`, `sha256:${"A".repeat(64)}`])(
    "BR-372 v2 BR-373 v2 read-back: ignores valid unused run digest %s",
    async (digest) => {
      const { result } = await readBack(() => undefined, {
        RELEASE_IMAGE_DIGEST: digest,
      });
      expect(result.status, result.stdout).toBe(0);
    },
  );

  const tarballCases: [
    string,
    Change,
    Record<string, string | undefined>,
    string,
  ][] = [
    [
      "the dist.tarball bytes hash to another digest",
      (s) => {
        s.tarball = { status: 200, body: Buffer.from("other bytes") };
      },
      {},
      "npm tarball differs from verify",
    ],
    ["dist.tarball on another origin", npmOther, {}, "npm tarball url refused"],
    [
      "the dist.tarball request returns 404",
      (s) => {
        s.tarball = { status: 404 };
      },
      {},
      "npm tarball status 404",
    ],
    [
      "RELEASE_TARBALL_SHA256 missing",
      () => undefined,
      { RELEASE_TARBALL_SHA256: undefined },
      "verify digest missing",
    ],
    [
      "RELEASE_TARBALL_SHA256 upper-case",
      () => undefined,
      { RELEASE_TARBALL_SHA256: sha256(PACKED).toUpperCase() },
      "verify digest missing",
    ],
  ];
  function npmOther(s: ReleaseState, _url: string, other: string): void {
    s.npm = {
      status: 200,
      body: npmDocument({
        published: true,
        tarballUrl: `${other}/tarballs/pkg.tgz`,
      }),
    };
  }
  it.each(tarballCases)(
    "BR-379 read-back tarball digest: %s",
    async (name, change, env, reason) => {
      const { result, server, other } = await readBack(change, env);
      expect(result.status).toBe(1);
      expect(
        line(result.stdout, "release-verify", "npm tarball matches verify"),
      ).toBe(`release-verify: npm tarball matches verify FAIL ${reason}`);
      if (name.includes("another origin")) expect(other.seen).toEqual([]);
      if (name.includes("RELEASE_TARBALL_SHA256"))
        expect(
          server.seen.filter((request) => request.url === "/tarballs/pkg.tgz"),
        ).toEqual([]);
    },
  );

  it.each([
    [
      "version v0.6.0-beta.1",
      { RELEASE_VERSION: "v0.6.0-beta.1" },
      "version is not a SemVer version",
    ],
    [
      "39-hex sha",
      { RELEASE_SHA: "a".repeat(39) },
      "sha is not a full commit id",
    ],
    ["dry_run=yes", { RELEASE_DRY_RUN: "yes" }, "dry_run is not a boolean"],
  ])(
    "BR-372 v2 BR-373 v2 read-back: refuses %s",
    async (_name, env, reason) => {
      const { result, server, other } = await readBack(() => undefined, env);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(` FAIL ${reason}\n`);
      expect(server.seen).toEqual([]);
      expect(other.seen).toEqual([]);
    },
  );
});

describe("F-024 AC-13 Make targets and rehearsal", () => {
  const makefile = readFileSync("Makefile", "utf8");
  const all = rules(makefile);
  const recipeOf = (target: string) => {
    const rule = all.find((entry) => entry.target === target);
    if (!rule) throw new Error(`missing target ${target}`);
    return rule;
  };
  function containerNames(target: string, mode: string): string[] {
    const command = recipeOf(target).recipe[0] ?? "";
    const match =
      /^\$\(COMPOSE\) run --rm -T((?: -e [A-Z0-9_]+)+) dev node scripts\/release\.ts (\w+)$/u.exec(
        command,
      );
    expect(match, command).not.toBeNull();
    expect(match![2]).toBe(mode);
    return match![1]!
      .trim()
      .split(" ")
      .filter((word) => word !== "-e");
  }

  it("BR-375 Makefile targets and imports", () => {
    const targets = [
      "release-check",
      "release-setup",
      "release-npm",
      "release-image",
      "release-verify",
    ];
    expect(containerNames("release-check", "check")).toEqual(CHECK_VARIABLES);
    expect(containerNames("release-npm", "npm")).toEqual(NPM_VARIABLES);
    expect(containerNames("release-verify", "verify")).toEqual(
      VERIFY_VARIABLES,
    );
    expect(recipeOf("release-check").recipe).toHaveLength(1);
    expect(recipeOf("release-verify").recipe).toHaveLength(1);
    for (const target of [
      "release-check",
      "release-setup",
      "release-npm",
      "release-verify",
    ])
      expect(recipeOf(target).prerequisites).toEqual([
        "_require-container-config",
      ]);
    expect(recipeOf("release-setup").recipe).toEqual([
      "$(COMPOSE) build dev",
      "$(COMPOSE) run --rm -T dev npm ci --ignore-scripts",
    ]);
    expect(recipeOf("release-image").prerequisites).toEqual([]);
    expect(recipeOf("release-image").recipe).toEqual([
      "/bin/sh scripts/release-image.sh",
    ]);
    const npmRecipe = recipeOf("release-npm").recipe.slice(1).join("\n");
    expect(npmRecipe).toContain('test "$${RELEASE_DRY_RUN:-}" = true');
    expect(npmRecipe).toContain('test -n "$${GITHUB_OUTPUT:-}"');
    expect(npmRecipe).toContain(
      'sha256sum "artifacts/sstolz-kdrive-mcp-server-$$RELEASE_VERSION.tgz"',
    );
    expect(npmRecipe).toContain('>> "$$GITHUB_OUTPUT"');
    for (const rule of all)
      for (const target of targets)
        expect(rule.prerequisites).not.toContain(target);
    const phony = makefile.slice(
      makefile.indexOf(".PHONY:"),
      makefile.indexOf("\n\n", makefile.indexOf(".PHONY:")),
    );
    const help = recipeOf("help").recipe.join("\n");
    for (const target of targets) {
      expect(phony).toMatch(new RegExp(`(?:^|\\s)${target}(?:\\s|$)`, "u"));
      expect(help).toContain(`'  make ${target}`);
    }
    const source = readFileSync("scripts/release.ts", "utf8");
    const specifiers = source
      .split("\n")
      .map((text) => / from "([^"]+)";$/u.exec(text)?.[1])
      .filter((specifier) => specifier !== undefined);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:/u);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/u);
  });

  it("F-024 rehearsal dry run then publish against doubles", async () => {
    // A temporary release commit on main with its tag and the real scripts.
    const files: Record<string, string> = {};
    for (const path of [
      "Makefile",
      "compose.yaml",
      "Dockerfile.dev",
      "scripts/release.ts",
      "scripts/release-image.sh",
    ])
      files[path] = readFileSync(path, "utf8");
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    lock.version = VERSION;
    lock.packages[""]!.version = VERSION;
    files["package-lock.json"] = `${JSON.stringify(lock, null, 2)}\n`;
    const repo = releaseRepo({ files });
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(repo.root, "package.json"),
      `${JSON.stringify({ ...manifest, version: VERSION }, null, 2)}\n`,
    );
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "release package.json");
    const sha = repo.git("rev-parse", "HEAD");
    repo.git("update-ref", "refs/remotes/origin/main", sha);
    repo.git("tag", "-f", `v${VERSION}`, sha);

    const fake = fakeBin();
    const prepared = join(temporary("release-prepared-"), "prepared.tgz");
    const packed = packTarball(prepared, {
      name: "@sstolz/kdrive-mcp-server",
      version: VERSION,
    });
    const state = releaseState(sha);
    const server = await startDouble(state);
    const base = gitEnv();
    const make = async (
      target: string,
      env: Record<string, string>,
      output: string,
    ) => {
      const result = await run(
        "/usr/bin/make",
        ["--no-print-directory", target],
        {
          cwd: repo.root,
          env: {
            PATH: `${fake.bin}:${base.PATH ?? ""}`,
            HOME: base.HOME ?? "",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CEILING_DIRECTORIES: base.GIT_CEILING_DIRECTORIES ?? "",
            FAKE_NPM_LOG: fake.npmLog,
            FAKE_NPM_TARBALL: prepared,
            FAKE_DOCKER_LOG: fake.dockerLog,
            FAKE_DOCKER_STDIN: fake.stdin,
            GITHUB_SHA: sha,
            GITHUB_OUTPUT: output,
            ...endpoints(server.url),
            ...env,
          },
        },
      );
      expect(
        result.status,
        `${target}\n${result.stdout}\n${result.stderr}`,
      ).toBe(0);
      return result;
    };
    const step = (dryRun: string) => ({
      RELEASE_VERSION: VERSION,
      RELEASE_SHA: sha,
      RELEASE_DRY_RUN: dryRun,
    });
    const outputs = (path: string) =>
      lines(path).filter((entry) => entry.startsWith("tarball-sha256="));
    const sequence = async (dryRun: "true" | "false") => {
      const output = join(temporary("release-output-"), "github_output");
      writeFileSync(output, "");
      // verify
      await make(
        "release-check",
        { ...step(dryRun), RELEASE_PHASE: "verify", GITHUB_TOKEN: TOKEN },
        output,
      );
      await make("release-setup", {}, output);
      await make("pack", {}, output);
      await make("release-npm", step("true"), output);
      await make(
        "image-binfmt",
        { IMAGE_PLATFORMS: "linux/amd64 linux/arm64" },
        output,
      );
      await make(
        "release-image",
        { ...step("true"), IMAGE_PLATFORMS: "linux/amd64 linux/arm64" },
        output,
      );
      expect(outputs(output)).toEqual([`tarball-sha256=${sha256(packed)}`]);
      return outputs(output)[0]!.slice("tarball-sha256=".length);
    };

    // Dry run: only verify runs.
    const dryDigest = await sequence("true");
    expect(
      npmCalls(fake.npmLog).some(
        (call) => call.argv.join(" ") === "ci --ignore-scripts",
      ),
    ).toBe(true);
    const dryPublishes = npmCalls(fake.npmLog).filter(
      (call) => call.argv[0] === "publish",
    );
    expect(dryPublishes).toHaveLength(1);
    expectPublishArgv(dryPublishes[0]!.argv, true);
    expect(lines(fake.dockerLog).some((call) => call.startsWith("login"))).toBe(
      false,
    );
    expect(lines(fake.dockerLog).some((call) => call.includes("--push"))).toBe(
      false,
    );
    expect(dryDigest).toBe(sha256(packed));

    // Real run: verify, publish-image, publish-npm, read-back.
    const realDigest = await sequence("false");
    const output = join(temporary("release-output-"), "github_output");
    writeFileSync(output, "");
    await make(
      "release-check",
      { ...step("false"), RELEASE_PHASE: "image", GITHUB_TOKEN: TOKEN },
      output,
    );
    await make(
      "image-binfmt",
      { IMAGE_PLATFORMS: "linux/amd64 linux/arm64" },
      output,
    );
    await make(
      "release-image",
      {
        ...step("false"),
        IMAGE_PLATFORMS: "linux/amd64 linux/arm64",
        GITHUB_TOKEN: TOKEN,
      },
      output,
    );
    state.manifest = { status: 200 };
    await make(
      "release-check",
      { ...step("false"), RELEASE_PHASE: "npm", GITHUB_TOKEN: TOKEN },
      output,
    );
    await make(
      "release-npm",
      {
        ...step("false"),
        RELEASE_TARBALL_SHA256: realDigest,
        ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:1/oidc",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "SYNTHETIC-OIDC",
      },
      output,
    );
    const docker = lines(fake.dockerLog);
    const pushIndex = docker.findIndex((call) => call.includes("--push"));
    const publishIndex = docker.findIndex(
      (call) => call.startsWith("npm publish ") && !call.endsWith("--dry-run"),
    );
    expect(pushIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(pushIndex);
    const publishes = npmCalls(fake.npmLog).filter(
      (call) => call.argv[0] === "publish",
    );
    expect(publishes).toHaveLength(3);
    expectPublishArgv(publishes[2]!.argv, false);

    // Registries after the publish.
    state.npm = {
      status: 200,
      body: npmDocument({
        published: true,
        tarballUrl: `${server.url}/tarballs/pkg.tgz`,
      }),
    };
    state.tarball = {
      status: 200,
      body: readFileSync(join(repo.root, "artifacts", TARBALL)),
    };
    const verified = await make(
      "release-verify",
      {
        ...step("false"),
        GITHUB_TOKEN: TOKEN,
        RELEASE_TARBALL_SHA256: realDigest,
      },
      output,
    );
    expect(verified.stdout).toMatch(
      /release-verify: image digest sha256:[0-9a-f]{64}/u,
    );

    // Every release-check read both environment endpoints (1 dry + 3 real runs).
    expect(
      server.seen.filter(
        (request) =>
          request.url ===
          "/repos/sstolz/kdrive-mcp-server/environments/release",
      ),
    ).toHaveLength(4);
    expect(
      server.seen.filter((request) =>
        request.url.includes("/deployment-branch-policies"),
      ),
    ).toHaveLength(4);
    // The -e names reaching the container equal the BR-375 lists.
    const composeRuns = lines(fake.dockerLog).filter((call) =>
      call.startsWith("compose run "),
    );
    for (const [mode, names] of [
      ["check", CHECK_VARIABLES],
      ["npm", NPM_VARIABLES],
      ["verify", VERIFY_VARIABLES],
    ] as const) {
      const calls = composeRuns.filter((call) =>
        call.endsWith(`node scripts/release.ts ${mode}`),
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls)
        expect(
          call.slice("compose run ".length, call.indexOf(" :: ")).split(","),
        ).toEqual(names);
    }
  });
});

// F-024 v3 AC-25–AC-33. All registry traffic terminates at loopback doubles.
const STABLE = "1.0.0";
const INDEX_ACCEPT = `${OCI_INDEX}, application/vnd.docker.distribution.manifest.list.v2+json`;
const RUN_INDEX = indexBody(["linux/amd64", "linux/arm64"]);
const RUN_DIGEST = `sha256:${sha256(RUN_INDEX)}`;
const PUBLISHED_ON_NPM = "version already published on npm";
const DIGEST_INPUT = "RELEASE_IMAGE_DIGEST is not a sha256 digest";
const EMPTY_DIGEST =
  "RELEASE_IMAGE_DIGEST must be empty in verify and image phases";
type NpmFixture = {
  versions: Record<string, Record<string, unknown>>;
  time: Record<string, string>;
  "dist-tags": Record<string, string>;
};
function stableDocument(url = ""): NpmFixture {
  const doc = npmDocument() as NpmFixture;
  doc.versions[STABLE] = {
    version: STABLE,
    dist: {
      tarball: `${url}/tarballs/pkg.tgz`,
      attestations: { provenance: {} },
    },
  };
  doc.time[STABLE] = "2026-11-16T00:00:00.000Z";
  doc["dist-tags"].latest = STABLE;
  return doc;
}
function stableRepo(version = STABLE) {
  const repo = releaseRepo({
    versionFile: `${version}\n`,
    packageVersion: version,
    tag: "none",
    files: {
      "package-lock.json": JSON.stringify({
        version,
        packages: { "": { version } },
      }),
    },
  });
  repo.git("tag", `v${version}`, repo.sha);
  return repo;
}
async function stableCheck(
  change: (state: ReleaseState) => void = () => undefined,
  env: Record<string, string | undefined> = {},
) {
  const version = env.RELEASE_VERSION ?? STABLE;
  const repo = stableRepo(version);
  const state = releaseState(repo.sha);
  state.index = { status: 404 };
  if (env.RELEASE_PHASE === "npm") {
    state.index = { status: 200, body: RUN_INDEX };
    state.latest = state.index;
    state.manifest = { status: 200 };
  }
  change(state);
  const server = await startDouble(state);
  const result = await release(
    "check",
    repo.root,
    checkEnv(repo, server.url, {
      RELEASE_VERSION: version,
      RELEASE_DRY_RUN: "false",
      ...(env.RELEASE_PHASE === "npm"
        ? { RELEASE_IMAGE_DIGEST: RUN_DIGEST }
        : {}),
      ...env,
    }),
  );
  return { result, state, server, repo };
}
// Commands run through GNU Make exit 2 when the recipe fails (exit 1).
function reasonViaMake(result: Result, expected: string) {
  expect(result.status, result.stdout + result.stderr).toBe(2);
  expect(result.stdout).toContain(` FAIL ${expected}\n`);
}
function reason(result: Result, expected: string) {
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stdout).toContain(` FAIL ${expected}\n`);
}

describe("F-024 v3 validation first", () => {
  const modes = ["check", "npm", "verify", "image"];
  async function entry(
    mode: string,
    overrides: Record<string, string | undefined>,
  ) {
    const fake = fakeBin();
    const server = await startDouble(releaseState(GOOD_SHA));
    const cwd = temporary("release-v3-input-");
    const env: Record<string, string | undefined> = {
      ...gitEnv(),
      RELEASE_VERSION: VERSION,
      RELEASE_SHA: GOOD_SHA,
      RELEASE_DRY_RUN: "true",
      RELEASE_PHASE: "verify",
      RELEASE_TARBALL_SHA256: "a".repeat(64),
      RELEASE_RETRY_DELAY_MS: "0",
      FAKE_NPM_LOG: fake.npmLog,
      FAKE_DOCKER_LOG: fake.dockerLog,
      FAKE_DOCKER_STDIN: fake.stdin,
      ...endpoints(server.url),
      ...overrides,
    };
    const result =
      mode === "image"
        ? await run("/bin/sh", [IMAGE_SCRIPT], {
            cwd,
            env: Object.fromEntries(
              Object.entries({
                ...env,
                PATH: `${fake.bin}:${process.env.PATH ?? ""}`,
              }),
            ),
          })
        : await release(mode, cwd, env, fake.bin);
    return { result, fake, server };
  }
  it.each(
    modes.flatMap((mode) =>
      ["1.0.0", "1.2.3", "0.0.0", "0.6.0-beta.2"].map((version) => [
        `${mode} ${version}`,
        mode,
        version,
      ]),
    ),
  )(
    "BR-359 v2 accepts stable and beta inputs: %s",
    async (_name, mode, version) => {
      const { result } = await entry(mode, { RELEASE_VERSION: version });
      expect(result.stdout).toContain(
        (mode === "image" ? "release-image" : "release-" + mode) +
          ": version ok\n",
      );
    },
  );
  const invalid: [string, Record<string, string | undefined>, string][] = [
    ...[
      "01.0.0",
      "1.00.0",
      "1.0.00",
      "v1.0.0",
      " 1.0.0",
      "1.0.0\n",
      "1.0.0-beta.01",
    ].map((version): [string, Record<string, string>, string] => [
      version,
      { RELEASE_VERSION: version },
      "version is not a SemVer version",
    ]),
    ...[
      "1.0.0-alpha.1",
      "1.0.0-rc.1",
      "1.0.0-beta",
      "1.0.0-beta.1.2",
      "1.0.0+b",
      "1.0.0-beta.1+b",
    ].map((version): [string, Record<string, string>, string] => [
      version,
      { RELEASE_VERSION: version },
      "unsupported release version",
    ]),
    ["sha", { RELEASE_SHA: "A".repeat(40) }, "sha is not a full commit id"],
    ["boolean", { RELEASE_DRY_RUN: "yes" }, "dry_run is not a boolean"],
  ];
  const digestCases: typeof invalid = [];
  for (const mode of ["check", "verify"])
    for (const digest of [
      undefined,
      "",
      "sha256:ABC",
      `sha256:${"A".repeat(64)}`,
      `${RUN_DIGEST}\n`,
    ])
      digestCases.push([
        `${mode} stable digest ${String(digest)}`,
        {
          RELEASE_VERSION: STABLE,
          RELEASE_PHASE: "npm",
          RELEASE_IMAGE_DIGEST: digest,
        },
        DIGEST_INPUT,
      ]);
  it.each([
    ...modes.flatMap((mode) =>
      invalid.map(
        ([name, env, diagnostic]) =>
          [`${mode} ${name}`, mode, env, diagnostic] as const,
      ),
    ),
    [
      "check phase",
      "check",
      { RELEASE_PHASE: "deploy" },
      "phase is not a release phase",
    ] as const,
    ...digestCases.map(
      ([name, env, diagnostic]) =>
        [name, name.split(" ")[0]!, env, diagnostic] as const,
    ),
    ...["verify", "image"].flatMap((phase) =>
      [RUN_DIGEST, "invalid"].map(
        (digest) =>
          [
            `check ${phase} nonempty digest`,
            "check",
            {
              RELEASE_VERSION: STABLE,
              RELEASE_PHASE: phase,
              RELEASE_IMAGE_DIGEST: digest,
            },
            EMPTY_DIGEST,
          ] as const,
      ),
    ),
    ...["check", "verify"].map(
      (mode) =>
        [
          `${mode} invalid beta digest`,
          mode,
          { RELEASE_IMAGE_DIGEST: "invalid" },
          DIGEST_INPUT,
        ] as const,
    ),
  ])(
    "BR-359 v2 refuses inputs before side effects: %s",
    async (_name, mode, env, diagnostic) => {
      const { result, fake, server } = await entry(mode, env);
      reason(result, diagnostic);
      expect(server.seen).toEqual([]);
      expect(lines(fake.gitLog)).toEqual([]);
      expect(lines(fake.npmLog)).toEqual([]);
      expect(lines(fake.dockerLog)).toEqual([]);
    },
  );
});

describe("F-024 v3 registry phase matrices", () => {
  type NpmCase = [string, (doc: NpmFixture) => void, string | null];
  const cases: NpmCase[] = [
    ["placeholder only", () => undefined, null],
    [
      "created and modified ignored",
      (d) => {
        d.time.created = "date";
        d.time.modified = "date";
      },
      null,
    ],
    [
      "malformed time key",
      (d) => {
        d.time["untrusted-key"] = "date";
      },
      "npm time contains a non-SemVer version key",
    ],
    [
      "malformed versions key",
      (d) => {
        d.versions["untrusted-key"] = {};
      },
      "npm versions contains a non-SemVer version key",
    ],
    [
      "candidate in versions",
      (d) => {
        d.versions[STABLE] = { version: STABLE };
      },
      PUBLISHED_ON_NPM,
    ],
    [
      "candidate in time",
      (d) => {
        d.time[STABLE] = "date";
      },
      PUBLISHED_ON_NPM,
    ],
    [
      "missing latest",
      (d) => {
        delete d["dist-tags"].latest;
      },
      "npm latest tag missing",
    ],
    [
      "placeholder not deprecated",
      (d) => {
        delete d.versions[PLACEHOLDER]!.deprecated;
      },
      "original placeholder is not deprecated",
    ],
    [
      "placeholder entry absent",
      (d) => {
        delete d.versions[PLACEHOLDER];
      },
      "npm latest version record incomplete",
    ],
    [
      "placeholder empty deprecation",
      (d) => {
        d.versions[PLACEHOLDER]!.deprecated = "";
      },
      "original placeholder is not deprecated",
    ],
  ];
  it.each(
    ["verify", "image", "npm"].flatMap((phase) =>
      ["true", "false"].flatMap((dry) =>
        cases.map(
          ([name, change, diagnostic]) =>
            [
              `${phase} dry=${dry} ${name}`,
              phase,
              dry,
              change,
              diagnostic,
            ] as const,
        ),
      ),
    ),
  )(
    "BR-363 v2 npm phase matrix: %s",
    async (_name, phase, dry, change, diagnostic) => {
      const doc = npmDocument() as NpmFixture;
      change(doc);
      const { result } = await stableCheck(
        (s) => {
          s.npm = { status: 200, body: doc };
        },
        { RELEASE_PHASE: phase, RELEASE_DRY_RUN: dry },
      );
      if (diagnostic) reason(result, diagnostic);
      else expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).not.toContain("untrusted-key");
    },
  );
  it.each(
    ["verify", "image", "npm"].flatMap((phase) =>
      ["true", "false"].flatMap((dry) =>
        [STABLE, VERSION].flatMap((version) =>
          [
            "latest stable",
            "latest deprecated stable",
            "latest beta",
            "versions stable",
            "time stable",
          ].map(
            (variant) =>
              [
                `${phase} ${dry} ${version} ${variant}`,
                phase,
                dry,
                version,
                variant,
              ] as const,
          ),
        ),
      ),
    ),
  )(
    "BR-363 v2 npm phase matrix: %s",
    async (_name, phase, dry, version, variant) => {
      const doc = npmDocument() as NpmFixture;
      if (variant.startsWith("latest")) {
        doc["dist-tags"].latest = variant.endsWith("beta")
          ? "0.9.0-beta.1"
          : "0.9.0";
        doc.versions[doc["dist-tags"].latest] =
          variant === "latest deprecated stable"
            ? { deprecated: "retired" }
            : {};
      } else if (variant.startsWith("versions"))
        doc.versions["0.9.0+build"] = {};
      else doc.time["0.9.0"] = "date";
      // AC-38 AC-45 BR-363 v3: malformed history wins over presence and ordering.
      doc.versions[version] = {};
      doc.time["untrusted-key"] = "date";
      delete doc.versions[PLACEHOLDER]!.deprecated;
      const { result } = await stableCheck(
        (s) => {
          s.npm = { status: 200, body: doc };
        },
        {
          RELEASE_VERSION: version,
          RELEASE_PHASE: phase,
          RELEASE_DRY_RUN: dry,
          ...(version === VERSION ? { RELEASE_IMAGE_DIGEST: "" } : {}),
        },
      );
      reason(result, "npm time contains a non-SemVer version key");
      expect(result.stdout).not.toContain("untrusted-key");
    },
  );
  it.each([
    [
      "stable dry 404",
      STABLE,
      "true",
      { status: 404 },
      "npm registry status 404",
    ],
    [
      "stable real 404",
      STABLE,
      "false",
      { status: 404 },
      "npm registry status 404",
    ],
    ["beta dry 404", VERSION, "true", { status: 404 }, null],
    [
      "beta real 404",
      VERSION,
      "false",
      { status: 404 },
      "npm registry status 404",
    ],
    [
      "unreadable",
      STABLE,
      "true",
      { status: 200, body: "{" },
      "npm document unreadable; refer to the owner",
    ],
    [
      "missing time",
      STABLE,
      "false",
      { status: 200, body: { versions: {} } },
      "npm document unreadable; refer to the owner",
    ],
    ["status 503", STABLE, "false", { status: 503 }, "npm registry status 503"],
  ] as const)(
    "BR-363 v2 npm phase matrix: %s",
    async (_name, version, dry, npm, diagnostic) => {
      const { result } = await stableCheck(
        (s) => {
          s.npm = npm;
        },
        { RELEASE_VERSION: version, RELEASE_DRY_RUN: dry },
      );
      if (diagnostic) reason(result, diagnostic);
      else expect(result.status, result.stdout).toBe(0);
    },
  );
  it.each([
    ["1.0.0", "0.6.0-beta.2", true],
    ["0.6.0", "0.6.0-beta.2", true],
    ["0.5.0", "0.6.0-beta.2", true],
    ["1.9.9", "1.10.0-beta.1", true],
    ["1.10.0", "1.9.9-beta.1", true],
    ["9007199254740993.0.0", "9007199254740992.999.999-beta.1", true],
    ["9007199254740992.0.0", "9007199254740993.0.0-beta.1", true],
    [VERSION, "0.9.0-beta.9", false],
  ] as const)(
    "BR-363 v2 npm phase matrix: ordering %s above %s",
    async (candidate, published, passes) => {
      const doc = npmDocument() as NpmFixture;
      doc.time[published] = "date";
      doc.versions[`${published}+build`] = { version: published };
      const { result } = await stableCheck(
        (s) => {
          s.npm = { status: 200, body: doc };
        },
        { RELEASE_VERSION: candidate },
      );
      // AC-38 BR-363 v3: prereleases never block a stable; beta ordering
      // remains authoritative even before the first stable.
      exactCheck(
        result,
        "npm version not published",
        passes
          ? null
          : "beta version is not greater than every published version",
      );
      expect(result.status, result.stdout).toBe(passes ? 0 : 1);
    },
  );
  const ghcrCases: [string, (s: ReleaseState) => void, string | null][] = [
    ["both absent", () => undefined, null],
    [
      "candidate present",
      (s) => {
        s.index = { status: 200, body: RUN_INDEX };
      },
      "image already published",
    ],
    [
      "latest present",
      (s) => {
        s.latest = { status: 200, body: RUN_INDEX };
      },
      "GHCR latest exists without a stable npm default",
    ],
    [
      "candidate unexpected",
      (s) => {
        s.index = { status: 503 };
      },
      "unexpected GHCR status 503; refer to the owner",
    ],
    [
      "latest unexpected",
      (s) => {
        s.latest = { status: 401 };
      },
      "unexpected GHCR status 401; refer to the owner",
    ],
    [
      "token refused",
      (s) => {
        s.ghcrToken = { status: 401 };
      },
      "unexpected GHCR token status 401; refer to the owner",
    ],
  ];
  it.each(
    ["verify", "image"].flatMap((phase) =>
      ["true", "false"].flatMap((dry) =>
        ghcrCases.map(
          ([name, change, diagnostic]) =>
            [
              `${phase} ${dry} ${name}`,
              phase,
              dry,
              change,
              diagnostic,
            ] as const,
        ),
      ),
    ),
  )(
    "BR-363 v2 GHCR phase matrix: %s",
    async (_name, phase, dry, change, diagnostic) => {
      const { result, server } = await stableCheck(change, {
        RELEASE_PHASE: phase,
        RELEASE_DRY_RUN: dry,
      });
      if (diagnostic) reason(result, diagnostic);
      else expect(result.status, result.stdout).toBe(0);
      const manifests = server.seen.filter((r) =>
        r.url.includes("/manifests/"),
      );
      for (const request of manifests) {
        expect(request.method).toBe("GET");
        expect(request.accept).toBe(INDEX_ACCEPT);
      }
      if (!diagnostic)
        expect(manifests.map((r) => r.url.split("/").at(-1)).sort()).toEqual([
          STABLE,
          "latest",
        ]);
    },
  );
  it.each(
    ["verify", "image", "npm"].flatMap((phase) =>
      [
        "",
        RUN_DIGEST,
        RUN_DIGEST.toUpperCase().replace("SHA256", "sha256"),
      ].map((digest) => [`beta ${phase} ${digest}`, phase, digest] as const),
    ),
  )("BR-363 v2 GHCR phase matrix: %s", async (_name, phase, digest) => {
    const { result, server } = await stableCheck(
      (s) => {
        s.manifest = { status: phase === "npm" ? 200 : 404 };
        s.latest = { status: 500 };
      },
      {
        RELEASE_VERSION: VERSION,
        RELEASE_PHASE: phase,
        RELEASE_IMAGE_DIGEST: digest,
      },
    );
    // AC-39 BR-363 v3: beta now validates the bootstrap GHCR default.
    reason(result, "unexpected GHCR status 500; refer to the owner");
    expect(
      server.seen
        .filter((r) => r.url.includes("/manifests/"))
        .map((r) => [r.method, r.url.split("/").at(-1)]),
    ).toEqual([
      ["HEAD", VERSION],
      ["GET", "latest"],
    ]);
  });
  const binding: [string, (s: ReleaseState) => void, string | null][] = [
    ["both raw GET bodies match", () => undefined, null],
    ...["index", "latest"].flatMap(
      (tag) =>
        [
          [
            `${tag} 404`,
            (s: ReleaseState) => {
              s[tag as "index" | "latest"] = { status: 404 };
            },
            "image manifest unavailable",
          ],
          [
            `${tag} invalid`,
            (s: ReleaseState) => {
              s[tag as "index" | "latest"] = { status: 200, body: "{}" };
            },
            "image manifest invalid",
          ],
          [
            `${tag} another run despite equal HEAD digest`,
            (s: ReleaseState) => {
              s.manifest = {
                status: 200,
                headers: { "docker-content-digest": RUN_DIGEST },
              };
              s[tag as "index" | "latest"] = {
                status: 200,
                body: `${RUN_INDEX}\n`,
              };
            },
            "image digest does not match RELEASE_IMAGE_DIGEST",
          ],
        ] as [string, (s: ReleaseState) => void, string][],
    ),
    [
      "equal tags from another run",
      (s) => {
        s.index = { status: 200, body: `${RUN_INDEX}\n` };
        s.latest = s.index;
      },
      "image digest does not match RELEASE_IMAGE_DIGEST",
    ],
    [
      "token denied",
      (s) => {
        s.ghcrToken = { status: 403 };
      },
      "unexpected GHCR token status 403; refer to the owner",
    ],
  ];
  it.each(binding)(
    "BR-363 v2 stable digest binding: %s",
    async (_name, change, diagnostic) => {
      const { result, server } = await stableCheck(change, {
        RELEASE_PHASE: "npm",
      });
      if (diagnostic) reason(result, diagnostic);
      else expect(result.status, result.stdout).toBe(0);
      for (const r of server.seen.filter((r) =>
        r.url.includes("/manifests/"),
      )) {
        expect(r.method).toBe("GET");
        expect(r.accept).toBe(INDEX_ACCEPT);
      }
    },
  );
});

describe("F-024 v3 npm and image publication", () => {
  async function npmPublish(
    version: string,
    dry: string,
    mutate: (env: Record<string, string>, root: string) => void = () =>
      undefined,
    manifest: Record<string, unknown> = {},
  ) {
    const root = temporary("release-v3-publish-");
    const fake = fakeBin();
    const path = join(
      root,
      "artifacts",
      `sstolz-kdrive-mcp-server-${version}.tgz`,
    );
    const bytes = packTarball(path, {
      name: "@sstolz/kdrive-mcp-server",
      version,
      ...manifest,
    });
    const env = {
      RELEASE_VERSION: version,
      RELEASE_SHA: GOOD_SHA,
      RELEASE_DRY_RUN: dry,
      RELEASE_TARBALL_SHA256: sha256(bytes),
      FAKE_NPM_LOG: fake.npmLog,
      ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:1/oidc",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "SYNTHETIC-OIDC",
    };
    mutate(env, root);
    const result = await release("npm", root, env, fake.bin);
    return { result, calls: npmCalls(fake.npmLog) };
  }
  it.each(
    [STABLE, VERSION].flatMap((version) =>
      ["true", "false"].map((dry) => [`${version} dry=${dry}`, version, dry]),
    ),
  )("BR-368 v2 BR-369 v2 npm exact argv: %s", async (_name, version, dry) => {
    const { result, calls } = await npmPublish(version, dry);
    expect(result.status, result.stdout).toBe(0);
    expect(calls.map((c) => c.argv)).toEqual([
      ["--version"],
      [
        "publish",
        `./artifacts/sstolz-kdrive-mcp-server-${version}.tgz`,
        "--tag",
        version === STABLE ? "latest" : "beta",
        "--access",
        "public",
        "--ignore-scripts",
        "--provenance",
        ...(dry === "true" ? ["--dry-run"] : []),
      ],
    ]);
  });
  const safeguards: [
    string,
    (env: Record<string, string>, root: string) => void,
    string,
    Record<string, unknown>?,
  ][] = [
    [
      "digest",
      (e) => {
        e.RELEASE_TARBALL_SHA256 = "b".repeat(64);
      },
      "tarball digest does not match verify",
    ],
    [
      "OIDC URL",
      (e) => {
        delete e.ACTIONS_ID_TOKEN_REQUEST_URL;
      },
      "OIDC environment missing",
    ],
    [
      "OIDC token",
      (e) => {
        delete e.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      },
      "OIDC environment missing",
    ],
    [
      "old npm",
      (e) => {
        e.FAKE_NPM_VERSION = "11.5.0";
      },
      "npm 11.5.1 or later required",
    ],
    [
      "wrong inner version",
      () => undefined,
      "tarball package.json does not match",
      { version: VERSION },
    ],
    [
      "wrong package",
      () => undefined,
      "tarball package.json does not match",
      { name: "other" },
    ],
    [
      "publishConfig",
      () => undefined,
      "publishConfig refused",
      { publishConfig: {} },
    ],
    [
      "second tarball",
      (_e, root) => {
        packTarball(join(root, "artifacts", TARBALL), {
          name: "@sstolz/kdrive-mcp-server",
          version: VERSION,
        });
      },
      "more than one tarball",
    ],
    ...[
      "NODE_AUTH_TOKEN",
      "NPM_TOKEN",
      "NPM_ID_TOKEN",
      "NPM_CONFIG__AUTH",
      "NPM_CONFIG__AUTHTOKEN",
      "NPM_CONFIG__PASSWORD",
      "NPM_CONFIG_USERNAME",
      "NPM_CONFIG_USERCONFIG",
      "NPM_CONFIG_GLOBALCONFIG",
      "node_auth_token",
      "npm_config_//registry.npmjs.org/:_authToken",
    ].map((name): [string, (env: Record<string, string>) => void, string] => [
      name,
      (e) => {
        e[name] = "SYNTHETIC";
      },
      "npm token in environment refused",
    ]),
  ];
  it.each(safeguards)(
    "BR-369 v2 stable publish safeguards: %s",
    async (_name, mutate, diagnostic, manifest) => {
      const { result, calls } = await npmPublish(
        STABLE,
        "false",
        mutate,
        manifest,
      );
      reason(result, diagnostic);
      expect(calls.filter((c) => c.argv[0] === "publish")).toEqual([]);
    },
  );

  it("BR-368 v2 BR-370 v2 image argv: parser failure before login", async () => {
    const fake = fakeBin();
    executable(
      join(fake.bin, "docker"),
      FAKE_DOCKER.replace(
        "  const result = spawnSync(argv[index + 1]",
        "  process.exit(1);\n  const result = spawnSync(argv[index + 1]",
      ),
    );
    const result = await run("/bin/sh", [IMAGE_SCRIPT], {
      cwd: temporary("release-v3-image-parser-"),
      env: {
        ...gitEnv(),
        PATH: `${fake.bin}:${process.env.PATH ?? ""}`,
        FAKE_DOCKER_LOG: fake.dockerLog,
        FAKE_DOCKER_STDIN: fake.stdin,
        RELEASE_VERSION: STABLE,
        RELEASE_SHA: GOOD_SHA,
        RELEASE_DRY_RUN: "false",
        GITHUB_TOKEN: TOKEN,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "release-image: buildx metadata digest is not a sha256 digest",
    );
    const calls = lines(fake.dockerLog);
    expect(calls.some((call) => call.startsWith("compose run "))).toBe(true);
    expect(calls.some((call) => call.startsWith("login"))).toBe(false);
    expect(
      calls.some(
        (call) => call.startsWith("buildx build ") && call.includes("--push"),
      ),
    ).toBe(false);
  });

  const metadataSample = JSON.parse(
    readFileSync("tests/fixtures/release/buildx-metadata-stable.json", "utf8"),
  ) as Record<string, unknown>;
  const metadataDigest = metadataSample["containerimage.digest"] as string;
  const metadataVariants: [string, string, string | null][] = [
    ["recorded buildx sample", JSON.stringify(metadataSample), null],
    [
      "missing digest",
      JSON.stringify({ ...metadataSample, "containerimage.digest": undefined }),
      "buildx metadata digest is not a sha256 digest",
    ],
    [
      "decoy digest",
      JSON.stringify({
        digest: metadataDigest,
        "containerimage.descriptor":
          metadataSample["containerimage.descriptor"],
      }),
      "buildx metadata digest is not a sha256 digest",
    ],
    [
      "newline digest",
      JSON.stringify({
        ...metadataSample,
        "containerimage.digest": `${metadataDigest}\nimage_digest=decoy`,
      }),
      "buildx metadata digest is not a sha256 digest",
    ],
    [
      "uppercase digest",
      JSON.stringify({
        ...metadataSample,
        "containerimage.digest": metadataDigest.toUpperCase(),
      }),
      "buildx metadata digest is not a sha256 digest",
    ],
    [
      "null digest",
      JSON.stringify({ ...metadataSample, "containerimage.digest": null }),
      "buildx metadata digest is not a sha256 digest",
    ],
    ["malformed JSON", "{", "buildx metadata digest is not a sha256 digest"],
  ];
  it.each([
    ...[STABLE, VERSION].flatMap((version) =>
      ["true", "false"].map(
        (dry) =>
          [
            `${version} dry=${dry}`,
            version,
            dry,
            JSON.stringify(metadataSample),
            null,
            false,
          ] as const,
      ),
    ),
    ...metadataVariants
      .slice(1)
      .map(
        ([name, metadata, diagnostic]) =>
          [name, STABLE, "false", metadata, diagnostic, false] as const,
      ),
    [
      "extra compose stdout",
      STABLE,
      "false",
      JSON.stringify(metadataSample),
      "buildx metadata digest is not a sha256 digest",
      false,
    ] as const,
    [
      "failed build logs out",
      STABLE,
      "false",
      JSON.stringify(metadataSample),
      null,
      true,
    ] as const,
  ])(
    "BR-368 v2 BR-370 v2 image argv: %s",
    async (name, version, dry, metadata, diagnostic, failBuild) => {
      const fake = fakeBin();
      if (name === "extra compose stdout") {
        // Keep this case exercising real metadata after the pre-login self-check.
        executable(
          join(fake.bin, "docker"),
          FAKE_DOCKER.replace(
            "  const result = spawnSync(argv[index + 1]",
            '  if (fs.readFileSync(process.env.FAKE_DOCKER_LOG, "utf8").includes("buildx build ")) console.log("compose preamble");\n  const result = spawnSync(argv[index + 1]',
          ).replace(
            "  process.exit(result.status === null ? 1 : result.status);",
            '  if (fs.readFileSync(process.env.FAKE_DOCKER_LOG, "utf8").includes("buildx build ")) console.log("\\ncompose epilogue");\n  process.exit(result.status === null ? 1 : result.status);',
          ),
        );
      }
      const cwd = temporary("release-v3-image-");
      const output = join(cwd, "output");
      const metadataPath = join(cwd, "metadata.json");
      writeFileSync(output, "existing=value\n");
      writeFileSync(metadataPath, metadata);
      const result = await run("/bin/sh", [IMAGE_SCRIPT], {
        cwd,
        env: {
          ...gitEnv(),
          PATH: `${fake.bin}:${process.env.PATH ?? ""}`,
          FAKE_DOCKER_LOG: fake.dockerLog,
          FAKE_DOCKER_STDIN: fake.stdin,
          FAKE_BUILDX_METADATA: metadataPath,
          FAKE_BUILD_FAIL: failBuild ? "1" : "0",
          RELEASE_VERSION: version,
          RELEASE_SHA: GOOD_SHA,
          RELEASE_DRY_RUN: dry,
          GITHUB_TOKEN: TOKEN,
          GITHUB_OUTPUT: output,
        },
      });
      const calls = lines(fake.dockerLog);
      const builds = calls.filter((c) => c.startsWith("buildx build "));
      expect(builds).toHaveLength(1);
      const argv = builds[0]!.split(" ");
      expect(argv[argv.indexOf("--platform") + 1]).toBe(
        "linux/amd64,linux/arm64",
      );
      expect(argv[argv.indexOf("--target") + 1]).toBe("runtime");
      for (const flag of [
        "--cache-from",
        "--cache-to",
        "--build-arg",
        "--secret",
        "--load",
        "--output",
      ])
        expect(argv).not.toContain(flag);
      const tags = argv.flatMap((word, i) =>
        word === "--tag" ? [argv[i + 1]] : [],
      );
      const digestLines = result.stdout
        .split("\n")
        .filter((line) => line.startsWith("release-image: image digest "));
      const outputLines = lines(output).filter((line) =>
        line.startsWith("image_digest="),
      );
      if (dry === "true") {
        expect(tags).toEqual([]);
        expect(argv).not.toContain("--push");
        expect(calls.some((c) => c.startsWith("login"))).toBe(false);
      } else {
        expect(tags).toEqual([
          `ghcr.io/sstolz/kdrive-mcp-server:${version}`,
          ...(version === STABLE
            ? ["ghcr.io/sstolz/kdrive-mcp-server:latest"]
            : []),
        ]);
        expect(argv.filter((word) => word === "--push")).toHaveLength(1);
        expect(argv.filter((word) => word === "--metadata-file")).toHaveLength(
          1,
        );
        expect(readFileSync(fake.stdin, "utf8")).toBe(TOKEN);
        expect(calls).toContain("logout ghcr.io");
        expect(
          calls.findIndex(
            (c) =>
              c.startsWith("login ghcr.io") && c.includes("--password-stdin"),
          ),
        ).toBeLessThan(calls.indexOf(builds[0]!));
        for (const label of [
          `org.opencontainers.image.version=${version}`,
          `org.opencontainers.image.revision=${GOOD_SHA}`,
          "org.opencontainers.image.source=https://github.com/sstolz/kdrive-mcp-server",
        ])
          expect(argv).toContain(label);
      }
      const expectsFailure = diagnostic !== null || failBuild;
      const assertBuildResult = () => {
        if (expectsFailure) {
          expect(result.status).toBe(1);
          if (diagnostic)
            expect(result.stdout + result.stderr).toContain(diagnostic);
          expect(outputLines).toEqual([]);
          expect(digestLines).toEqual([]);
        } else {
          expect(result.status, result.stdout + result.stderr).toBe(0);
          expect(outputLines).toEqual(
            version === STABLE && dry === "false"
              ? [`image_digest=${metadataDigest}`]
              : [],
          );
          expect(digestLines).toEqual(
            version === STABLE && dry === "false"
              ? [`release-image: image digest ${metadataDigest}`]
              : [],
          );
        }
      };
      assertBuildResult();
      expect(lines(output)[0]).toBe("existing=value");
      expect(calls.join("\n")).not.toContain(TOKEN);
    },
  );
});

describe("F-024 v3 stable read-back", () => {
  const packed = Buffer.from("stable synthetic tarball");
  type Change = (s: ReleaseState, doc: NpmFixture) => void;
  async function readStable(change: Change = () => undefined) {
    const state = releaseState(GOOD_SHA);
    const server = await startDouble(state);
    const doc = stableDocument(server.url);
    state.npm = { status: 200, body: doc };
    state.tarball = { status: 200, body: packed };
    state.index = { status: 200, body: RUN_INDEX };
    state.latest = state.index;
    change(state, doc);
    const result = await release("verify", temporary("stable-readback-"), {
      RELEASE_VERSION: STABLE,
      RELEASE_SHA: GOOD_SHA,
      RELEASE_DRY_RUN: "false",
      RELEASE_IMAGE_DIGEST: RUN_DIGEST,
      RELEASE_TARBALL_SHA256: sha256(packed),
      GITHUB_TOKEN: TOKEN,
      RELEASE_RETRY_DELAY_MS: "0",
      ...endpoints(server.url),
    });
    return { result, state, server };
  }
  const npmCases: [string, Change, string | null][] = [
    ["published first stable (read-back only recovery)", () => undefined, null],
    [
      "version absent",
      (_s, d) => {
        delete d.versions[STABLE];
      },
      "npm version present",
    ],
    [
      "inner version differs",
      (_s, d) => {
        d.versions[STABLE]!.version = "1.0.1";
      },
      "npm version present",
    ],
    [
      "time absent",
      (_s, d) => {
        delete d.time[STABLE];
      },
      "npm version present",
    ],
    [
      "latest differs",
      (_s, d) => {
        d["dist-tags"].latest = PLACEHOLDER;
      },
      "npm latest tag FAIL latest does not name the version",
    ],
    [
      "latest missing",
      (_s, d) => {
        delete d["dist-tags"].latest;
      },
      "npm latest tag FAIL latest does not name the version",
    ],
    [
      "placeholder absent",
      (_s, d) => {
        delete d.versions[PLACEHOLDER];
      },
      "npm original placeholder deprecated FAIL original placeholder is not deprecated",
    ],
    [
      "placeholder deprecation empty",
      (_s, d) => {
        d.versions[PLACEHOLDER]!.deprecated = "";
      },
      "npm original placeholder deprecated FAIL original placeholder is not deprecated",
    ],
    [
      "provenance absent",
      (_s, d) => {
        (d.versions[STABLE]!.dist as Record<string, unknown>).attestations =
          undefined;
      },
      "npm provenance",
    ],
    [
      "tarball mismatch",
      (s) => {
        s.tarball = { status: 200, body: "other bytes" };
      },
      "npm tarball matches verify",
    ],
    [
      "tarball 404",
      (s) => {
        s.tarball = { status: 404 };
      },
      "npm tarball matches verify",
    ],
    [
      "registry 503",
      (s) => {
        s.npm = { status: 503 };
      },
      "npm version present",
    ],
    [
      "appears on attempt 20",
      (s, d) => {
        s.npm = (attempt) => ({
          status: 200,
          body: attempt >= 20 ? d : npmDocument(),
        });
      },
      null,
    ],
    [
      "absent after attempt 20",
      (s) => {
        s.npm = { status: 200, body: npmDocument() };
      },
      "npm version present",
    ],
  ];
  it.each(npmCases)(
    "BR-372 v2 stable npm read-back: %s",
    async (name, change, failure) => {
      const { result, state } = await readStable(change);
      expect(result.status, result.stdout).toBe(failure ? 1 : 0);
      if (failure) {
        expect(result.stdout).toContain(
          `release-verify: ${failure}${failure.includes(" FAIL ") ? "\n" : " FAIL "}`,
        );
      } else {
        for (const line of [
          "npm latest tag ok",
          "npm original placeholder deprecated ok",
          "image version digest ok",
          "image latest digest ok",
          "image latest is public (P-3) ok",
          `image digest ${RUN_DIGEST}`,
        ])
          expect(result.stdout).toContain(`release-verify: ${line}\n`);
      }
      expect(state.npmAttempts).toBe(name.includes("20") || failure ? 20 : 1);
      for (const betaLine of [
        "npm beta tag",
        "npm default",
        "image latest tag",
      ])
        expect(result.stdout).not.toContain(`release-verify: ${betaLine} `);
    },
  );
  const images: [string, Change, string | null][] = [
    ["both tags bound to this run", () => undefined, null],
    ...["index", "latest"].flatMap(
      (tag) =>
        [
          [
            `${tag} unavailable`,
            (s: ReleaseState) => {
              s[tag as "index" | "latest"] = { status: 404 };
            },
            `image ${tag === "index" ? "version" : "latest"} digest FAIL image manifest unavailable`,
          ],
          [
            `${tag} invalid`,
            (s: ReleaseState) => {
              s[tag as "index" | "latest"] = { status: 200, body: "{}" };
            },
            `image ${tag === "index" ? "version" : "latest"} digest FAIL image manifest invalid`,
          ],
          [
            `${tag} digest mismatch`,
            (s: ReleaseState) => {
              s[tag as "index" | "latest"] = {
                status: 200,
                body: `${RUN_INDEX}\n`,
              };
            },
            `image ${tag === "index" ? "version" : "latest"} digest FAIL image digest does not match RELEASE_IMAGE_DIGEST`,
          ],
          [
            `${tag} missing arm64`,
            (s: ReleaseState) => {
              s[tag as "index" | "latest"] = {
                status: 200,
                body: indexBody(["linux/amd64"]),
              };
            },
            tag === "index"
              ? "image platforms"
              : "image latest digest FAIL image manifest invalid",
          ],
        ] as [string, Change, string][],
    ),
    [
      "equal tags from another run",
      (s) => {
        s.index = { status: 200, body: `${RUN_INDEX}\n` };
        s.latest = s.index;
      },
      "image version digest FAIL image digest does not match RELEASE_IMAGE_DIGEST",
    ],
    [
      "token failure",
      (s) => {
        s.ghcrToken = { status: 401 };
      },
      "image version digest FAIL image manifest unavailable",
    ],
    [
      "anonymous token failure",
      (s) => {
        s.anonToken = { status: 401 };
      },
      "image latest is public (P-3) FAIL anonymous pull failed",
    ],
    [
      "anonymous version HEAD failure",
      (s) => {
        s.anonManifest = { status: 403 };
        s.anonLatestManifest = { status: 200 };
      },
      "image is public (P-3)",
    ],
    [
      "anonymous latest HEAD failure",
      (s) => {
        s.anonLatestManifest = { status: 403 };
      },
      "image latest is public (P-3) FAIL anonymous pull failed",
    ],
    [
      "anonymous HEAD failure",
      (s) => {
        s.anonManifest = { status: 403 };
      },
      "image latest is public (P-3) FAIL anonymous pull failed",
    ],
  ];
  it.each(images)(
    "BR-373 v2 stable image read-back: %s",
    async (_name, change, failure) => {
      const { result, server } = await readStable(change);
      expect(result.status, result.stdout).toBe(failure ? 1 : 0);
      if (failure) {
        expect(result.stdout).toContain(
          `release-verify: ${failure}${failure.includes(" FAIL ") ? "\n" : " FAIL "}`,
        );
      } else {
        expect(result.stdout).toContain(
          `release-verify: image digest ${RUN_DIGEST}\n`,
        );
        expect(
          server.seen
            .filter((r) => r.authorization === "Bearer anon-token")
            .map((r) => [r.method, r.url.split("/").at(-1)])
            .sort(),
        ).toEqual([
          ["HEAD", STABLE],
          ["HEAD", "latest"],
        ]);
      }
      for (const r of server.seen.filter(
        (r) =>
          r.url.includes("/manifests/") &&
          r.authorization === "Bearer pull-token",
      )) {
        expect(r.method).toBe("GET");
        expect(r.accept).toBe(INDEX_ACCEPT);
      }
      expect(server.seen.every((r) => ["GET", "HEAD"].includes(r.method))).toBe(
        true,
      );
    },
  );
});

describe("F-024 v3 retained gates", () => {
  it.each([
    "tag",
    "dispatched SHA",
    "main ancestry",
    "CI",
    "environment reviewer",
    "environment branch",
  ])("F-024 v3 stable release retains existing gates: %s", async (gate) => {
    const repo = stableRepo();
    const state = releaseState(repo.sha);
    state.index = { status: 404 };
    if (gate === "tag")
      repo.git("update-ref", `refs/tags/v${STABLE}`, repo.parent);
    if (gate === "main ancestry")
      repo.git("update-ref", "refs/remotes/origin/main", repo.parent);
    if (gate === "CI") state.ciJobs = { status: 200, body: { jobs: [] } };
    if (gate === "environment reviewer")
      state.environment = {
        status: 200,
        body: { ...goodEnvironment(), protection_rules: [] },
      };
    if (gate === "environment branch")
      state.policies = {
        status: 200,
        body: { total_count: 0, branch_policies: [] },
      };
    const server = await startDouble(state);
    const result = await release(
      "check",
      repo.root,
      checkEnv(repo, server.url, {
        RELEASE_VERSION: STABLE,
        GITHUB_SHA: gate === "dispatched SHA" ? repo.parent : repo.sha,
      }),
    );
    expect(result.status, result.stdout).toBe(1);
    const labels: Record<string, string> = {
      tag: "release tag",
      "dispatched SHA": "dispatched commit",
      "main ancestry": "on main",
      CI: "CI evidence",
      "environment reviewer": "release environment protected",
      "environment branch": "release environment protected",
    };
    const label = labels[gate]!;
    expect(result.stdout).toMatch(
      new RegExp(`release-check: ${label} FAIL`, "u"),
    );
  });
});

// An owner-action harness, never a registry client: state changes below represent
// acknowledged outcomes of fake commands or explicit owner recovery actions.
describe("F-024 v3 stable release and recovery", () => {
  it.each([
    "success",
    "rejected second approval",
    "expired second approval",
    "npm preflight failed",
    "npm publish failed",
    "partial image push",
    "main advanced",
    "uncertain npm accepted",
    "read-back failed",
  ])(
    "F-024 v3 stable release and recovery rehearsal: %s",
    async (scenario) => {
      const files: Record<string, string> = {};
      for (const path of [
        "Makefile",
        "compose.yaml",
        "Dockerfile.dev",
        "scripts/release.ts",
        "scripts/release-image.sh",
      ])
        files[path] = readFileSync(path, "utf8");
      const repo = releaseRepo({
        versionFile: `${STABLE}\n`,
        packageVersion: STABLE,
        tag: "none",
        files: {
          ...files,
          "package-lock.json": JSON.stringify({
            version: STABLE,
            packages: { "": { version: STABLE } },
          }),
        },
      });
      repo.git("tag", `v${STABLE}`, repo.sha);
      const fake = fakeBin();
      const root = temporary("release-v3-rehearsal-");
      const prepared = join(root, "prepared.tgz");
      let packed = packTarball(prepared, {
        name: "@sstolz/kdrive-mcp-server",
        version: STABLE,
      });
      const metadata = JSON.parse(
        readFileSync(
          "tests/fixtures/release/buildx-metadata-stable.json",
          "utf8",
        ),
      ) as Record<string, unknown>;
      metadata["containerimage.digest"] = RUN_DIGEST;
      const metadataPath = join(root, "metadata.json");
      writeFileSync(metadataPath, JSON.stringify(metadata));
      const output = join(root, "output");
      writeFileSync(output, "");
      let releaseVersion = STABLE;
      let releaseSha = repo.sha;
      let dispatchedSha = repo.sha;
      const state = releaseState(repo.sha);
      // Package versions keyed by digest: deleting one removes every tag on it.
      const images = new Map<string, Set<string>>();
      const route = releaseRoute(state);
      let deletionConfirmed = true;
      const server = await double((request) => {
        if (request.url.includes("/manifests/")) {
          const tag = request.url.split("/").at(-1)!;
          const present = [...images.values()].some((tags) => tags.has(tag));
          if (!present) return { status: 404 };
          return {
            status: 200,
            body: RUN_INDEX,
            headers: { "content-type": OCI_INDEX },
          };
        }
        return route(request);
      });
      doubles.push(server);
      const journal: string[] = [];
      const command = async (
        target: string,
        env: Record<string, string> = {},
      ) => {
        const result = await run(
          "/usr/bin/make",
          ["--no-print-directory", target],
          {
            cwd: repo.root,
            env: {
              ...gitEnv(),
              PATH: `${fake.bin}:${process.env.PATH ?? ""}`,
              FAKE_NPM_LOG: fake.npmLog,
              FAKE_NPM_TARBALL: prepared,
              FAKE_DOCKER_LOG: fake.dockerLog,
              FAKE_DOCKER_STDIN: fake.stdin,
              FAKE_BUILDX_METADATA: metadataPath,
              GITHUB_OUTPUT: output,
              RELEASE_VERSION: releaseVersion,
              RELEASE_SHA: releaseSha,
              GITHUB_SHA: dispatchedSha,
              RELEASE_DRY_RUN: "false",
              GITHUB_TOKEN: TOKEN,
              RELEASE_RETRY_DELAY_MS: "0",
              ...endpoints(server.url),
              ...env,
            },
          },
        );
        return result;
      };
      const ok = async (target: string, env: Record<string, string> = {}) => {
        const result = await command(target, env);
        expect(
          result.status,
          `${target}\n${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        return result;
      };
      let imageApproval = false;
      let npmApproval = false;
      let verifiedTarball = "";
      let verifiedImage = "";
      let dryEvidence = "";
      const verify = async (dry: boolean) => {
        writeFileSync(output, "");
        await ok("release-check", {
          RELEASE_PHASE: "verify",
          RELEASE_DRY_RUN: String(dry),
        });
        await ok("release-setup");
        await ok("pack");
        await ok("release-npm", { RELEASE_DRY_RUN: "true" });
        await ok("image-binfmt", {
          IMAGE_PLATFORMS: "linux/amd64 linux/arm64",
        });
        await ok("release-image", { RELEASE_DRY_RUN: "true" });
        verifiedTarball = lines(output)
          .find((line) => line.startsWith("tarball-sha256="))!
          .split("=")[1]!;
        expect(verifiedTarball).toBe(sha256(packed));
        journal.push("verify");
        if (dry) dryEvidence = `${releaseVersion}:${releaseSha}`;
      };
      const publishImage = async () => {
        if (
          !deletionConfirmed ||
          !imageApproval ||
          dryEvidence !== `${releaseVersion}:${releaseSha}`
        )
          return false;
        imageApproval = false;
        await ok("release-check", { RELEASE_PHASE: "image" });
        const result = await command("release-image", {
          ...(scenario === "partial image push"
            ? { FAKE_BUILD_FAIL: "1" }
            : {}),
        });
        // Simulate an acknowledged push (or uncertain partial push confirmed by GET).
        images.set(RUN_DIGEST, new Set([STABLE, "latest"]));
        if (scenario === "partial image push") {
          // GNU Make exits 2 when the recipe fails.
          expect(result.status).toBe(2);
          return false;
        }
        expect(result.status, result.stdout).toBe(0);
        verifiedImage = lines(output)
          .find((line) => line.startsWith("image_digest="))!
          .slice("image_digest=".length);
        expect(verifiedImage).toBe(RUN_DIGEST);
        journal.push("publish-image");
        return true;
      };
      const publishNpm = async (fails = false, accepted = false) => {
        if (!npmApproval) return false;
        npmApproval = false;
        const checked = await command("release-check", {
          RELEASE_PHASE: "npm",
          RELEASE_IMAGE_DIGEST: verifiedImage,
        });
        if (checked.status !== 0) return false;
        const result = await command("release-npm", {
          RELEASE_TARBALL_SHA256: verifiedTarball,
          ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:1/oidc",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "SYNTHETIC-OIDC",
          FAKE_NPM_STATUS: fails ? "1" : "0",
        });
        if (result.status === 0 || accepted) {
          state.npm = { status: 200, body: stableDocument(server.url) };
          state.tarball = { status: 200, body: packed };
          journal.push("publish-npm");
        }
        return result.status === 0;
      };
      const readback = () =>
        command("release-verify", {
          RELEASE_IMAGE_DIGEST: verifiedImage,
          RELEASE_TARBALL_SHA256: verifiedTarball,
        });
      const ownerDelete = () => {
        const doc =
          typeof state.npm === "function"
            ? undefined
            : (state.npm.body as NpmFixture);
        if (!doc || doc.versions[STABLE] || doc.time[STABLE])
          throw new Error("npm accepted: publication blocked; see #91");
        images.delete(RUN_DIGEST);
        deletionConfirmed = false;
        journal.push("owner cleanup");
      };
      const checkAcceptedRelease = async (pushed: boolean) => {
        expect(pushed).toBe(true);
        npmApproval = true;
        expect(
          await publishNpm(
            scenario === "uncertain npm accepted",
            scenario === "uncertain npm accepted",
          ),
        ).toBe(scenario !== "uncertain npm accepted");
        expect(() => {
          ownerDelete();
        }).toThrow("npm accepted");
        const refused = await command("release-check", {
          RELEASE_PHASE: "verify",
        });
        reasonViaMake(refused, PUBLISHED_ON_NPM);
        const count = npmCalls(fake.npmLog).filter(
          (c) => c.argv[0] === "publish",
        ).length;
        if (scenario === "read-back failed") {
          state.tarball = { status: 404 };
          const before = server.seen.filter(
            (r) => r.url === "/tarballs/pkg.tgz",
          ).length;
          reasonViaMake(await readback(), "npm tarball status 404");
          expect(
            server.seen.filter((r) => r.url === "/tarballs/pkg.tgz"),
          ).toHaveLength(before + 20);
          state.tarball = { status: 200, body: packed };
        }
        const result = await readback();
        expect(result.status, result.stdout).toBe(0);
        expect(
          npmCalls(fake.npmLog).filter((c) => c.argv[0] === "publish"),
        ).toHaveLength(count);
        expect(journal.indexOf("publish-image")).toBeLessThan(
          journal.indexOf("publish-npm"),
        );
      };
      const checkRecovery = async () => {
        reasonViaMake(
          await command("release-check", { RELEASE_PHASE: "verify" }),
          "image already published",
        );
        if (scenario === "npm preflight failed") {
          state.environment = { status: 403 };
          npmApproval = true;
          expect(await publishNpm()).toBe(false);
          state.environment = releaseState(repo.sha).environment;
        }
        if (scenario === "npm publish failed") {
          npmApproval = true;
          expect(await publishNpm(true)).toBe(false);
        }
        if (
          [
            "rejected second approval",
            "npm preflight failed",
            "npm publish failed",
          ].includes(scenario)
        ) {
          // Preferred recovery: same-run failed npm job, same digest, renewed gates and approval.
          expect(await publishNpm()).toBe(false);
          npmApproval = true;
          expect(await publishNpm()).toBe(true);
          expect((await readback()).status).toBe(0);
          expect(journal).not.toContain("owner cleanup");
        } else {
          // This owner model selects an unavailable retry; advanced main alone
          // does not make the original run ineligible (AC-44).
          if (scenario === "main advanced") {
            writeFileSync(join(repo.root, "main-advanced.txt"), "new change\n");
            repo.git("add", "main-advanced.txt");
            repo.git("commit", "-q", "-m", "advance main fixture");
            dispatchedSha = repo.git("rev-parse", "HEAD");
            repo.git("update-ref", "refs/remotes/origin/main", dispatchedSha);
          }
          ownerDelete();
          expect(deletionConfirmed).toBe(false);
          expect(images.size).toBe(0);
          const absence = server.seen.length;
          const preflight = await command("release-check", {
            RELEASE_PHASE: "verify",
          });
          const reads = server.seen
            .slice(absence)
            .filter((r) => r.url.includes("/manifests/"));
          expect(reads.map((r) => r.url.split("/").at(-1)).sort()).toEqual([
            STABLE,
            "latest",
          ]);
          deletionConfirmed = true;
          if (scenario === "main advanced") {
            reasonViaMake(preflight, "sha is not the checked-out HEAD");
            // A new patch commit on main gets its own version, tag, go and dry-run evidence.
            const patch = "1.0.1";
            writeFileSync(join(repo.root, "VERSION"), `${patch}\n`);
            writeFileSync(
              join(repo.root, "package.json"),
              JSON.stringify({
                name: "@sstolz/kdrive-mcp-server",
                version: patch,
              }),
            );
            writeFileSync(
              join(repo.root, "package-lock.json"),
              JSON.stringify({
                version: patch,
                packages: { "": { version: patch } },
              }),
            );
            repo.git("add", "-A");
            repo.git("commit", "-q", "-m", "patch fixture");
            const sha = repo.git("rev-parse", "HEAD");
            repo.git("update-ref", "refs/remotes/origin/main", sha);
            repo.git("tag", `v${patch}`, sha);
            // A new version starts a new run with a fresh artifact directory.
            rmSync(join(repo.root, "artifacts"), {
              recursive: true,
              force: true,
            });
            releaseVersion = patch;
            releaseSha = sha;
            dispatchedSha = sha;
            state.ciRuns = releaseState(sha).ciRuns;
            packed = packTarball(prepared, {
              name: "@sstolz/kdrive-mcp-server",
              version: patch,
            });
            dryEvidence = "";
            imageApproval = true;
            expect(await publishImage()).toBe(false);
            await verify(true);
            expect(dryEvidence).toBe(`${patch}:${sha}`);
          } else {
            expect(preflight.status, preflight.stdout).toBe(0);
            dryEvidence = "";
            imageApproval = true;
            expect(await publishImage()).toBe(false);
            await verify(true);
          }
        }
      };
      await verify(true);
      expect(images.size).toBe(0);
      expect(
        lines(fake.dockerLog).some(
          (line) => line.includes("--push") || line.startsWith("login"),
        ),
      ).toBe(false);
      expect(
        npmCalls(fake.npmLog)
          .filter((c) => c.argv[0] === "publish")
          .every((c) => c.argv.includes("--dry-run")),
      ).toBe(true);
      await verify(false);
      expect(await publishImage()).toBe(false);
      imageApproval = true;
      const pushed = await publishImage();
      expect(await publishNpm()).toBe(false);
      if (
        scenario === "success" ||
        scenario === "uncertain npm accepted" ||
        scenario === "read-back failed"
      ) {
        await checkAcceptedRelease(pushed);
      } else {
        await checkRecovery();
      }
      expect(
        server.seen.filter((r) => r.url.endsWith("/environments/release"))
          .length,
      ).toBeGreaterThanOrEqual(3);
      expect(
        server.seen.filter((r) => r.url.includes("deployment-branch-policies"))
          .length,
      ).toBeGreaterThanOrEqual(3);
      expect(lines(fake.dockerLog).every((line) => !line.includes(TOKEN))).toBe(
        true,
      );
    },
    // Each scenario runs many Make and Compose commands; read-back failed runs two read-backs.
    120_000,
  );
});

it("BR-354 v2 stable release procedure preserves owner gates", () => {
  const guide = readFileSync("docs/publishing.md", "utf8").replace(
    /\s+/gu,
    " ",
  );
  for (const phrase of [
    "explicit go for a given version and commit",
    "green real `dry_run=true` dispatch of the same version and commit is required",
    "before any `dry_run=false` dispatch",
    "first approval",
    "second approval",
    "Agents never",
    "owner",
    "read-back",
    "Re-run all jobs",
  ])
    expect(guide).toContain(phrase);
  // AC-35 is a per-release evidence gate; AC-34 is actual-main acceptance.
  // Neither an in-process rehearsal nor this documentation check is that evidence.
  expect(guide).toMatch(/(each|every).{0,60}(release|redispatch)/iu);
  expect(guide).toMatch(
    /(dry.run|dry run).{0,100}(patch|recovered|redispatch)/iu,
  );
});

// AC-28: exercise the fixed refusal strings, rather than merely searching for them.
describe("F-024 v3 exact diagnostics", () => {
  const cases: [
    string,
    Record<string, string | undefined>,
    (s: ReleaseState) => void,
  ][] = [
    [
      "version is not a SemVer version",
      { RELEASE_VERSION: "01.0.0" },
      () => undefined,
    ],
    [
      "unsupported release version",
      { RELEASE_VERSION: "1.0.0-rc.1" },
      () => undefined,
    ],
    [EMPTY_DIGEST, { RELEASE_IMAGE_DIGEST: RUN_DIGEST }, () => undefined],
    [
      DIGEST_INPUT,
      { RELEASE_PHASE: "npm", RELEASE_IMAGE_DIGEST: "invalid" },
      () => undefined,
    ],
    [
      "npm registry status 404",
      {},
      (s) => {
        s.npm = { status: 404 };
      },
    ],
    [
      "npm latest tag missing",
      {},
      (s) => {
        const d = npmDocument() as NpmFixture;
        delete d["dist-tags"].latest;
        s.npm = { status: 200, body: d };
      },
    ],
    [
      "original placeholder is not deprecated",
      {},
      (s) => {
        s.npm = {
          status: 200,
          body: npmDocument({ placeholderDeprecated: false }),
        };
      },
    ],
    [
      PUBLISHED_ON_NPM,
      {},
      (s) => {
        s.npm = { status: 200, body: stableDocument() };
      },
    ],
    [
      "image already published",
      {},
      (s) => {
        s.index = { status: 200, body: RUN_INDEX };
      },
    ],
    [
      "GHCR latest exists without a stable npm default",
      {},
      (s) => {
        s.latest = { status: 200, body: RUN_INDEX };
      },
    ],
    [
      "image digest does not match RELEASE_IMAGE_DIGEST",
      { RELEASE_PHASE: "npm" },
      (s) => {
        s.latest = { status: 200, body: `${RUN_INDEX}\n` };
      },
    ],
    [
      "image manifest unavailable",
      { RELEASE_PHASE: "npm" },
      (s) => {
        s.latest = { status: 503 };
      },
    ],
    [
      "image manifest invalid",
      { RELEASE_PHASE: "npm" },
      (s) => {
        s.latest = { status: 200, body: "{}" };
      },
    ],
    [
      "npm time contains a non-SemVer version key",
      {},
      (s) => {
        const d = npmDocument() as NpmFixture;
        d.time.invalid = "date";
        s.npm = { status: 200, body: d };
      },
    ],
    [
      "npm versions contains a non-SemVer version key",
      {},
      (s) => {
        const d = npmDocument() as NpmFixture;
        d.versions.invalid = {};
        s.npm = { status: 200, body: d };
      },
    ],
    [
      "stable version is not greater than every published stable version",
      {},
      (s) => {
        const d = npmDocument() as NpmFixture;
        d.time["1.1.0"] = "date";
        s.npm = { status: 200, body: d };
      },
    ],
    [
      "version already published on npm",
      { RELEASE_VERSION: VERSION },
      (s) => {
        s.npm = { status: 200, body: npmDocument({ published: true }) };
      },
    ],
  ];
  it.each(cases)(
    "F-024 v3 exact diagnostics: %s",
    async (diagnostic, env, change) => {
      const { result } = await stableCheck(change, env);
      reason(result, diagnostic);
    },
  );
  it("F-024 v3 exact diagnostics: removed legacy messages", () => {
    const removed = [
      ["unsupported", "pre-release"].join(" "),
      ["stable releases are out of scope", "(F-024 v1)"].join(" "),
      [
        "releases after the first stable are out of scope;",
        "see #91 (F-024 v4)",
      ].join(" "),
      ["GHCR latest already exists;", "first stable requires 404"].join(" "),
      ["stable version is not greater than every", "published version"].join(
        " ",
      ),
    ];
    for (const path of [
      "scripts/release.ts",
      "scripts/release-image.sh",
      "tests/release.test.ts",
      "tests/release-policy.test.ts",
      "tests/helpers/release.ts",
      "tests/helpers/release-policy.ts",
    ])
      for (const legacy of removed)
        expect(readFileSync(path, "utf8")).not.toContain(legacy);
  });
});

it.each([
  ["npm latest tag", "ok", ""],
  ["npm latest tag", "FAIL latest does not name the version", "latest"],
  ["npm original placeholder deprecated", "ok", ""],
  [
    "npm original placeholder deprecated",
    "FAIL original placeholder is not deprecated",
    "placeholder",
  ],
  ["image version digest", "ok", ""],
  ["image latest digest", "ok", ""],
  ...["version", "latest"].flatMap((tag) => [
    [
      `image ${tag} digest`,
      "FAIL image manifest unavailable",
      `${tag} unavailable`,
    ],
    [`image ${tag} digest`, "FAIL image manifest invalid", `${tag} invalid`],
    [
      `image ${tag} digest`,
      "FAIL image digest does not match RELEASE_IMAGE_DIGEST",
      `${tag} mismatch`,
    ],
  ]),
  ["image latest is public (P-3)", "ok", ""],
  [
    "image latest is public (P-3)",
    "FAIL anonymous pull failed",
    "anonymous latest",
  ],
  [`image digest ${RUN_DIGEST}`, "", ""],
])(
  "F-024 v3 exact diagnostics: release-verify %s %s",
  async (condition, outcome, mutation) => {
    const state = releaseState(GOOD_SHA);
    const server = await startDouble(state);
    const doc = stableDocument(server.url);
    const packed = Buffer.from("stable exact diagnostics tarball");
    state.npm = { status: 200, body: doc };
    state.tarball = { status: 200, body: packed };
    state.index = { status: 200, body: RUN_INDEX };
    state.latest = state.index;
    if (mutation === "latest") doc["dist-tags"].latest = PLACEHOLDER;
    if (mutation === "placeholder")
      delete doc.versions[PLACEHOLDER]!.deprecated;
    if (mutation === "anonymous latest")
      state.anonLatestManifest = { status: 403 };
    if (mutation.includes(" ") && mutation !== "anonymous latest") {
      const tag = mutation.startsWith("version") ? "index" : "latest";
      state[tag] = mutation.endsWith("unavailable")
        ? { status: 404 }
        : {
            status: 200,
            body: mutation.endsWith("invalid") ? "{}" : `${RUN_INDEX}\n`,
          };
    }
    const result = await release("verify", temporary("release-diagnostics-"), {
      RELEASE_VERSION: STABLE,
      RELEASE_SHA: GOOD_SHA,
      RELEASE_DRY_RUN: "false",
      RELEASE_IMAGE_DIGEST: RUN_DIGEST,
      RELEASE_TARBALL_SHA256: sha256(packed),
      RELEASE_RETRY_DELAY_MS: "0",
      ...endpoints(server.url),
    });
    expect(result.status, result.stdout).toBe(mutation ? 1 : 0);
    expect(result.stdout.split("\n")).toContain(
      `release-verify: ${condition}` + (outcome ? " " + outcome : ""),
    );
  },
);

// F-024 v4 AC-38–AC-45. All histories and raw indexes are bounded synthetic data.
const PRIOR_INDEX = `${RUN_INDEX}\n`;
const LATER_STABLE = "1.1.1";
const LATER_BETA = "1.3.0-beta.1";
const PHASES = ["verify", "image", "npm"] as const;
type LifecycleChange = (s: ReleaseState, d: NpmFixture) => void;
function addVersion(d: NpmFixture, version: string) {
  d.versions[version] = { version };
  d.time[version] = "2026-11-17T00:00:00.000Z";
}
function lifecycleDocument(prior = STABLE): NpmFixture {
  const doc = npmDocument() as NpmFixture;
  addVersion(doc, prior);
  doc["dist-tags"].latest = prior;
  return doc;
}
// Reuse immutable release commits across the bounded registry matrices.
const lifecycleRepos = new Map<string, ReturnType<typeof stableRepo>>();
async function lifecycleCheck(
  candidate: string,
  phase: string,
  dry: string,
  change: LifecycleChange = () => undefined,
) {
  let repo = lifecycleRepos.get(candidate);
  if (!repo) {
    repo = stableRepo(candidate);
    lifecycleRepos.set(candidate, repo);
  }
  const state = releaseState(repo.sha);
  const doc = lifecycleDocument();
  state.references = { [STABLE]: { status: 200, body: PRIOR_INDEX } };
  state.index = { status: phase === "npm" ? 200 : 404, body: RUN_INDEX };
  state.manifest = { status: phase === "npm" ? 200 : 404 };
  state.latest = {
    status: 200,
    body: phase === "npm" && !candidate.includes("-") ? RUN_INDEX : PRIOR_INDEX,
  };
  state.npm = { status: 200, body: doc };
  change(state, doc);
  const server = await startDouble(state);
  const fake = fakeBin();
  const result = await release(
    "check",
    repo.root,
    checkEnv(repo, server.url, {
      RELEASE_VERSION: candidate,
      RELEASE_PHASE: phase,
      RELEASE_DRY_RUN: dry,
      RELEASE_IMAGE_DIGEST:
        phase === "npm" && !candidate.includes("-") ? RUN_DIGEST : "",
    }),
    fake.bin,
  );
  expect(npmCalls(fake.npmLog)).toEqual([]);
  expect(lines(fake.dockerLog)).toEqual([]);
  expect(
    server.seen.every((r) => r.method === "GET" || r.method === "HEAD"),
  ).toBe(true);
  return { result, state, doc, server, repo };
}
function exactCheck(
  result: Result,
  condition: string,
  diagnostic: string | null,
) {
  const ending = diagnostic ? "FAIL " + diagnostic : "ok";
  expect(line(result.stdout, "release-check", condition)).toBe(
    `release-check: ${condition} ${ending}`,
  );
}
function comparedGets(server: Double) {
  const gets = server.seen.filter(
    (r) => r.url.includes("/manifests/") && r.method === "GET",
  );
  for (const request of gets) expect(request.accept).toBe(INDEX_ACCEPT);
  return gets.map((r) => r.url.split("/").at(-1));
}

describe("F-024 v4 AC-38 union-history ordering", () => {
  const rows: [string[], string, boolean][] = [
    [["1.0.0"], "1.0.1", true],
    [["1.0.0"], "1.1.0", true],
    [["1.0.0"], "2.0.0", true],
    [["1.0.0"], "1.1.0-beta.1", true],
    [["1.1.0", "1.2.0-beta.1"], "1.1.1", true],
    [["1.0.0", "1.1.0-beta.1"], "1.0.1", true],
    [["1.1.0"], "1.0.1", false],
    [["1.1.0", "1.2.0-beta.1"], "1.1.2-beta.1", false],
    [["1.0.0", "1.1.0-beta.1"], "1.0.5-beta.1", false],
    [["1.0.5"], "1.0.5-beta.1", false],
    [["1.0.5"], "1.0.4", false],
    [["1.0.5"], "1.0.6-beta.1", true],
    [["1.1.0-beta.9"], "1.1.0-beta.10", true],
    [["1.1.0-beta.10"], "1.1.0-beta.9", false],
    [["9007199254740992.999.999"], "9007199254740993.0.0", true],
    [["9007199254740993.0.0"], "9007199254740992.999.999", false],
    [["1.1.0-beta.9007199254740992"], "1.1.0-beta.9007199254740993", true],
    [["1.1.0-beta.9007199254740993"], "1.1.0-beta.9007199254740992", false],
    [["1.1.0-1"], "1.1.0-beta.1", true],
    [["1.1.0-alpha.z"], "1.1.0-beta.1", true],
    [["1.1.0-Beta.999"], "1.1.0-beta.1", true],
    [["1.1.0-betaz"], "1.1.0-beta.1", false],
    [["1.9007199254740992.9"], "1.9007199254740993.0", true],
    [["1.0.9007199254740993"], "1.0.9007199254740992", false],
    [["1.1.0-rc.1"], "1.1.0-beta.1", false],
    [["1.1.0-beta"], "1.1.0-beta.1", true],
    [["1.1.0-beta.1.0"], "1.1.0-beta.1", false],
    [["1.1.0-beta.1+build"], "1.1.0-beta.1", false],
    [["1.1.0+build"], "1.1.0", false],
    [[PLACEHOLDER], "0.0.0-beta.1", true],
    [["0.0.0-stage"], "0.0.0-beta.1", false],
  ];
  it.each(
    rows.flatMap(([history, candidate, passes]) =>
      ["versions", "time", "both"].map(
        (where) =>
          [
            `${candidate} after ${history.join(",")} in ${where}`,
            history,
            candidate,
            passes,
            where,
          ] as const,
      ),
    ),
  )(
    "BR-363 v3 BR-431 v1 ordering: %s",
    async (_name, history, candidate, passes, where) => {
      for (const phase of PHASES)
        for (const dry of ["true", "false"]) {
          const { result } = await lifecycleCheck(
            candidate,
            phase,
            dry,
            (s, d) => {
              // Bootstrap isolates ordering from default validation. Stable versions in
              // history intentionally invalidate P; ordering still reports independently.
              const bootstrap = npmDocument() as NpmFixture;
              Object.assign(d, bootstrap);
              for (const version of history) {
                if (version === PLACEHOLDER) continue;
                if (where !== "time") d.versions[version] = { version };
                if (where !== "versions") d.time[version] = "date";
              }
              s.latest = { status: 404 };
              d.time.created = "date";
              d.time.modified = "date";
            },
          );
          exactCheck(
            result,
            "npm version not published",
            passes
              ? null
              : candidate.includes("-")
                ? "beta version is not greater than every published version"
                : "stable version is not greater than every published stable version",
          );
          if (!passes) expect(result.status).toBe(1);
        }
    },
    120_000,
  );

  it.each(["versions", "time"] as const)(
    "BR-363 v3 BR-431 v1 ordering: malformed %s precedes candidate presence and ordering (AC-38 AC-45)",
    async (where) => {
      for (const phase of PHASES)
        for (const dry of ["true", "false"]) {
          const { result } = await lifecycleCheck(
            LATER_BETA,
            phase,
            dry,
            (_s, d) => {
              addVersion(d, LATER_BETA);
              addVersion(d, "9.0.0");
              if (where === "versions") d.versions["unsafe/key"] = {};
              else d.time["unsafe/key"] = "date";
              if (where === "versions") d.time["also-invalid"] = "date";
            },
          );
          exactCheck(
            result,
            "npm version not published",
            `npm ${where} contains a non-SemVer version key`,
          );
          expect(result.stdout).not.toContain("unsafe/key");
        }
    },
    120_000,
  );
});

describe("F-024 v4 AC-39 AC-40 AC-41 AC-45 lifecycle matrices", () => {
  const defaults: [string, LifecycleChange, string][] = [
    [
      "missing latest",
      (_s, d) => {
        delete d["dist-tags"].latest;
      },
      "npm latest tag missing",
    ],
    [
      "beta default",
      (_s, d) => {
        d["dist-tags"].latest = "1.0.1-beta.1";
      },
      "npm latest is not a supported stable default",
    ],
    [
      "unsafe key",
      (_s, d) => {
        d["dist-tags"].latest = "../unsafe";
      },
      "npm latest is not a supported stable default",
    ],
    [
      "missing record",
      (_s, d) => {
        delete d.versions[STABLE];
      },
      "npm latest version record incomplete",
    ],
    [
      "wrong version",
      (_s, d) => {
        d.versions[STABLE]!.version = "1.0.1";
      },
      "npm latest version record incomplete",
    ],
    [
      "missing timestamp",
      (_s, d) => {
        delete d.time[STABLE];
      },
      "npm latest version record incomplete",
    ],
    [
      "placeholder missing",
      (_s, d) => {
        delete d.versions[PLACEHOLDER];
      },
      "original placeholder is not deprecated",
    ],
    [
      "placeholder healthy",
      (_s, d) => {
        d.versions[PLACEHOLDER]!.deprecated = "";
      },
      "original placeholder is not deprecated",
    ],
    [
      "placeholder non-string deprecation",
      (_s, d) => {
        d.versions[PLACEHOLDER]!.deprecated = false;
      },
      "npm document unreadable; refer to the owner",
    ],
    [
      "P reset with versions stable",
      (_s, d) => {
        d["dist-tags"].latest = PLACEHOLDER;
      },
      "npm placeholder latest cannot follow stable history",
    ],
    [
      "P reset with time-only stable",
      (_s, d) => {
        d["dist-tags"].latest = PLACEHOLDER;
        delete d.versions[STABLE];
      },
      "npm placeholder latest cannot follow stable history",
    ],
    [
      "stale default",
      (_s, d) => {
        addVersion(d, "1.0.1");
      },
      "npm latest is not the greatest published stable version",
    ],
    [
      "non-string deprecation",
      (_s, d) => {
        d.versions[STABLE]!.deprecated = false;
      },
      "npm document unreadable; refer to the owner",
    ],
    [
      "unreadable document",
      (s) => {
        s.npm = { status: 200, body: "{" };
      },
      "npm document unreadable; refer to the owner",
    ],
  ];
  it.each(defaults)(
    "BR-363 v3 lifecycle phase matrix: invalid %s (AC-39 AC-45)",
    async (_name, change, diagnostic) => {
      for (const candidate of [LATER_STABLE, LATER_BETA])
        for (const phase of PHASES)
          for (const dry of ["true", "false"]) {
            const { result, server } = await lifecycleCheck(
              candidate,
              phase,
              dry,
              (s, d) => {
                change(s, d);
                s.ghcrToken = { status: 403 };
              },
            );
            exactCheck(result, "npm default", diagnostic);
            exactCheck(result, "GHCR image", "npm stable default unavailable");
            expect(
              server.seen.filter(
                (r) =>
                  r.url.startsWith("/token?") || r.url.includes("/manifests/"),
              ),
            ).toEqual([]);
            expect(result.stdout).not.toContain("../unsafe");
            expect(result.status).toBe(1);
          }
    },
    120_000,
  );

  it.each([LATER_STABLE, LATER_BETA])(
    "BR-363 v3 lifecycle phase matrix: healthy older S for %s (AC-39)",
    async (candidate) => {
      for (const phase of PHASES)
        for (const dry of ["true", "false"]) {
          const { result, server } = await lifecycleCheck(
            candidate,
            phase,
            dry,
          );
          expect(result.status, result.stdout).toBe(0);
          exactCheck(result, "npm default", null);
          exactCheck(result, "npm version not published", null);
          const gets = comparedGets(server);
          expect(gets).toContain("latest");
          expect(gets).toContain(
            phase === "npm" && !candidate.includes("-") ? candidate : STABLE,
          );
          if (candidate.includes("-")) {
            const manifests = server.seen.filter((r) =>
              r.url.includes("/manifests/"),
            );
            expect([
              manifests[0]!.method,
              manifests[0]!.url.split("/").at(-1),
            ]).toEqual(["HEAD", candidate]);
          }
        }
    },
    120_000,
  );

  it.each(["1.0.2", "1.0.1", "1.0.0"])(
    "BR-363 v3 lifecycle phase matrix: time-only stable candidate %s (AC-39)",
    async (candidate) => {
      for (const phase of PHASES) {
        const { result } = await lifecycleCheck(
          candidate,
          phase,
          "false",
          (_s, d) => {
            d.time["1.0.1"] = "date";
          },
        );
        exactCheck(result, "npm default", null);
        exactCheck(
          result,
          "npm version not published",
          candidate === "1.0.2" ? null : "version already published on npm",
        );
        expect(result.status, result.stdout).toBe(
          candidate === "1.0.2" ? 0 : 1,
        );
      }
    },
  );

  it.each([LATER_STABLE, LATER_BETA])(
    "BR-363 v3 lifecycle phase matrix: npm 404 for %s (AC-39)",
    async (candidate) => {
      for (const phase of PHASES)
        for (const dry of ["true", "false"]) {
          const { result, server } = await lifecycleCheck(
            candidate,
            phase,
            dry,
            (s) => {
              s.npm = { status: 404 };
              s.latest = { status: 404 };
            },
          );
          const allowed = candidate.includes("-") && dry === "true";
          expect(result.status, result.stdout).toBe(allowed ? 0 : 1);
          exactCheck(
            result,
            "npm version not published",
            allowed ? null : "npm registry status 404",
          );
          if (!allowed) expect(comparedGets(server)).toEqual([]);
        }
    },
    120_000,
  );

  const imageCases: [string, LifecycleChange, string][] = [
    [
      "S absent",
      (s) => {
        s.references![STABLE] = { status: 404 };
      },
      "previous stable image unavailable",
    ],
    [
      "latest absent",
      (s) => {
        s.latest = { status: 404 };
      },
      "GHCR latest missing for stable npm default",
    ],
    [
      "S invalid",
      (s) => {
        s.references![STABLE] = { status: 200, body: "{}" };
      },
      "previous stable image manifest invalid",
    ],
    [
      "latest invalid",
      (s) => {
        s.latest = { status: 200, body: indexBody(["linux/amd64"]) };
      },
      "previous stable image manifest invalid",
    ],
    [
      "orphan latest",
      (s) => {
        s.latest = { status: 200, body: RUN_INDEX };
      },
      "GHCR latest does not match npm stable default",
    ],
    [
      "S status",
      (s) => {
        s.references![STABLE] = { status: 503 };
      },
      "unexpected GHCR status 503; refer to the owner",
    ],
    [
      "latest status",
      (s) => {
        s.latest = { status: 401 };
      },
      "unexpected GHCR status 401; refer to the owner",
    ],
    [
      "token status",
      (s) => {
        s.ghcrToken = { status: 403 };
      },
      "unexpected GHCR token status 403; refer to the owner",
    ],
  ];
  it.each(imageCases)(
    "BR-363 v3 BR-373 v3 lifecycle phase matrix: %s (AC-39 AC-41)",
    async (_name, change, diagnostic) => {
      for (const candidate of [LATER_STABLE, LATER_BETA])
        for (const phase of PHASES) {
          if (candidate === LATER_STABLE && phase === "npm") continue;
          const { result, server } = await lifecycleCheck(
            candidate,
            phase,
            "false",
            change,
          );
          exactCheck(result, "GHCR image", diagnostic);
          expect(result.status).toBe(1);
          comparedGets(server);
        }
    },
    120_000,
  );

  it.each([
    "old latest",
    "equal other run",
    "candidate absent",
    "candidate invalid",
    "latest invalid",
    "token denied",
  ])("BR-363 v3 prior default and run binding: %s (AC-41)", async (variant) => {
    const { result, server } = await lifecycleCheck(
      LATER_STABLE,
      "npm",
      "false",
      (s) => {
        if (variant === "old latest")
          s.latest = { status: 200, body: PRIOR_INDEX };
        if (variant === "equal other run")
          s.index = s.latest = { status: 200, body: PRIOR_INDEX };
        if (variant === "candidate absent") s.index = { status: 404 };
        if (variant === "candidate invalid")
          s.index = { status: 200, body: "{}" };
        if (variant === "latest invalid")
          s.latest = { status: 200, body: "{}" };
        if (variant === "token denied") s.ghcrToken = { status: 403 };
        s.manifest = {
          status: 200,
          headers: { "docker-content-digest": RUN_DIGEST },
        };
      },
    );
    const diagnostic =
      variant === "candidate absent"
        ? "image manifest unavailable"
        : variant.includes("invalid")
          ? "image manifest invalid"
          : variant === "token denied"
            ? "unexpected GHCR token status 403; refer to the owner"
            : "image digest does not match RELEASE_IMAGE_DIGEST";
    exactCheck(result, "GHCR image", diagnostic);
    expect(result.status).toBe(1);
    expect(comparedGets(server)).not.toContain(STABLE);
  });

  it.each(["verify", "image", "npm"])(
    "BR-432 v1 deprecated stable recovery: %s (AC-40)",
    async (phase) => {
      for (const candidate of ["1.0.1", LATER_BETA])
        for (const dry of ["true", "false"]) {
          const { result } = await lifecycleCheck(
            candidate,
            phase,
            dry,
            (_s, d) => {
              d.versions[STABLE]!.deprecated = "vulnerable";
              addVersion(d, "1.2.0-beta.1");
            },
          );
          const beta = candidate.includes("-");
          exactCheck(
            result,
            "npm default",
            beta
              ? "npm latest stable is deprecated; owner recovery required"
              : null,
          );
          expect(result.status, result.stdout).toBe(beta ? 1 : 0);
        }
      const { result } = await lifecycleCheck(
        "1.0.1",
        phase,
        "false",
        (s, d) => {
          addVersion(d, "1.1.0");
          d["dist-tags"].latest = "1.1.0";
          d.versions["1.1.0"]!.deprecated = "vulnerable";
          s.references!["1.1.0"] = { status: 200, body: PRIOR_INDEX };
        },
      );
      exactCheck(
        result,
        "npm version not published",
        "stable version is not greater than every published stable version",
      );
    },
    120_000,
  );

  it.each(["absent", "equal", "different", "invalid", "unexpected"])(
    "BR-363 v3 lifecycle phase matrix: bootstrap beta latest %s (AC-39)",
    async (variant) => {
      for (const phase of PHASES) {
        const { result, server } = await lifecycleCheck(
          LATER_BETA,
          phase,
          "false",
          (s, d) => {
            Object.assign(d, npmDocument());
            s.latest =
              variant === "absent"
                ? { status: 404 }
                : variant === "unexpected"
                  ? { status: 503 }
                  : {
                      status: 200,
                      body: variant === "equal" ? RUN_INDEX : PRIOR_INDEX,
                    };
            if (variant === "invalid") s.index = { status: 200, body: "{}" };
          },
        );
        const diagnostic =
          variant === "absent" || (phase === "npm" && variant === "different")
            ? null
            : variant === "unexpected"
              ? "unexpected GHCR status 503; refer to the owner"
              : phase === "npm"
                ? "latest names the release"
                : "GHCR latest exists without a stable npm default";
        exactCheck(result, "GHCR image", diagnostic);
        expect(result.status, result.stdout).toBe(diagnostic ? 1 : 0);
        comparedGets(server);
      }
    },
    120_000,
  );
});

const LIFECYCLE_TARBALL = Buffer.from("v4 verified tarball");
async function lifecycleReadBack(
  candidate: string,
  change: LifecycleChange = () => undefined,
) {
  const state = releaseState(GOOD_SHA);
  const server = await startDouble(state);
  const doc = lifecycleDocument("1.1.0");
  addVersion(doc, candidate);
  doc.versions[candidate]!.dist = {
    tarball: `${server.url}/tarballs/pkg.tgz`,
    attestations: { provenance: {} },
  };
  doc["dist-tags"].beta = candidate.includes("-") ? candidate : "1.2.0-beta.1";
  if (!candidate.includes("-")) {
    addVersion(doc, "1.2.0-beta.1");
    doc["dist-tags"].latest = candidate;
  }
  state.npm = { status: 200, body: doc };
  state.index = { status: 200, body: RUN_INDEX };
  state.references = {
    "1.1.0": { status: 200, body: PRIOR_INDEX },
    "1.2.0": { status: 200, body: `${PRIOR_INDEX}\n` },
  };
  state.latest = {
    status: 200,
    body: candidate.includes("-") ? PRIOR_INDEX : RUN_INDEX,
  };
  state.tarball = { status: 200, body: LIFECYCLE_TARBALL };
  change(state, doc);
  const root = temporary("lifecycle-readback-");
  const waits = join(root, "waits.jsonl");
  const clock = join(root, "clock.mjs");
  writeFileSync(
    clock,
    `import timers from "node:timers/promises";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
timers.setTimeout = async (delay) => { appendFileSync(${JSON.stringify(waits)}, JSON.stringify(delay) + "\\n"); };
syncBuiltinESMExports();
`,
  );
  const result = await release("verify", root, {
    RELEASE_VERSION: candidate,
    RELEASE_SHA: GOOD_SHA,
    RELEASE_DRY_RUN: "false",
    RELEASE_IMAGE_DIGEST: candidate.includes("-") ? "" : RUN_DIGEST,
    RELEASE_TARBALL_SHA256: sha256(LIFECYCLE_TARBALL),
    GITHUB_TOKEN: TOKEN,
    NODE_OPTIONS: `--import=file://${clock}`,
    ...endpoints(server.url),
  });
  expect(
    server.seen.every((r) => r.method === "GET" || r.method === "HEAD"),
  ).toBe(true);
  return { result, state, server, doc, waits: lines(waits) };
}

describe("F-024 v4 AC-42 AC-45 read-back", () => {
  const cases: [string, LifecycleChange, string | null][] = [
    ["healthy", () => undefined, null],
    [
      "candidate absent",
      (_s, d) => {
        delete d.versions[
          d["dist-tags"].beta === LATER_BETA ? LATER_BETA : LATER_STABLE
        ];
      },
      "npm version present",
    ],
    [
      "wrong candidate version",
      (_s, d) => {
        for (const v of [LATER_STABLE, LATER_BETA])
          if (d.versions[v]) d.versions[v].version = "2.0.0";
      },
      "npm version present",
    ],
    [
      "candidate timestamp absent",
      (_s, d) => {
        delete d.time[LATER_STABLE];
        delete d.time[LATER_BETA];
      },
      "npm version present",
    ],
    [
      "candidate deprecated",
      (_s, d) => {
        for (const v of [LATER_STABLE, LATER_BETA])
          if (d.versions[v]) d.versions[v].deprecated = "vulnerable";
      },
      "npm candidate not deprecated FAIL candidate is deprecated",
    ],
    [
      "candidate deprecation unreadable",
      (_s, d) => {
        for (const v of [LATER_STABLE, LATER_BETA])
          if (d.versions[v]) d.versions[v].deprecated = 1;
      },
      "npm candidate not deprecated FAIL npm document unreadable; refer to the owner",
    ],
    [
      "original placeholder healthy",
      (_s, d) => {
        d.versions[PLACEHOLDER]!.deprecated = "";
      },
      "npm original placeholder deprecated FAIL original placeholder is not deprecated",
    ],
    [
      "original placeholder non-string deprecation",
      (_s, d) => {
        d.versions[PLACEHOLDER]!.deprecated = false;
      },
      "npm original placeholder deprecated FAIL npm document unreadable; refer to the owner",
    ],
    [
      "provenance absent",
      (_s, d) => {
        for (const v of [LATER_STABLE, LATER_BETA])
          if (d.versions[v])
            (d.versions[v].dist as Record<string, unknown>).attestations =
              undefined;
      },
      "npm provenance",
    ],
    [
      "tarball changed",
      (s) => {
        s.tarball = { status: 200, body: "changed" };
      },
      "npm tarball matches verify",
    ],
    [
      "candidate platform absent",
      (s) => {
        s.index = { status: 200, body: indexBody(["linux/amd64"]) };
      },
      "image platforms",
    ],
    [
      "candidate private",
      (s) => {
        s.anonManifest = { status: 403 };
      },
      // F-024 v4 lines 360–376 retain the candidate's v3 status diagnostic.
      "image is public (P-3) FAIL anonymous pull status 403",
    ],
    [
      "latest private",
      (s) => {
        s.anonLatestManifest = { status: 404 };
      },
      "image latest is public (P-3) FAIL anonymous pull failed",
    ],
  ];
  it.each(
    cases.flatMap(([name, change, failure]) =>
      [LATER_STABLE, LATER_BETA].map(
        (candidate) =>
          [`${candidate} ${name}`, candidate, change, failure] as const,
      ),
    ),
  )(
    "BR-372 v3 BR-373 v3 lifecycle read-back: %s (AC-42 AC-45)",
    async (name, candidate, change, failure) => {
      const { result, state, server, waits } = await lifecycleReadBack(
        candidate,
        change,
      );
      expect(result.status, result.stdout + result.stderr).toBe(
        failure ? 1 : 0,
      );
      if (failure)
        expect(result.stdout).toContain(
          `release-verify: ${failure}${failure.includes(" FAIL ") ? "\n" : " FAIL "}`,
        );
      if (!failure) {
        expect(failed(result.stdout, "release-verify")).toEqual([]);
        expect(
          line(result.stdout, "release-verify", "npm candidate not deprecated"),
        ).toBe("release-verify: npm candidate not deprecated ok");
        expect(result.stdout).toContain(
          "release-verify: npm original placeholder deprecated ok\n",
        );
        expect(result.stdout).toContain(
          `release-verify: image digest ${RUN_DIGEST}\n`,
        );
        expect(state.npmAttempts).toBe(1);
        expect(waits).toEqual([]);
      }
      if (name.includes("candidate absent"))
        expect(
          line(result.stdout, "release-verify", "npm candidate not deprecated"),
        ).toBe(
          "release-verify: npm candidate not deprecated FAIL npm document unreadable; refer to the owner",
        );
      if (failure?.startsWith("npm")) {
        expect(state.npmAttempts).toBe(20);
        expect(waits).toEqual(Array.from({ length: 19 }, () => "15000"));
      }
      if (candidate === LATER_STABLE) {
        for (const suppressed of [
          "npm beta tag",
          "npm default",
          "image latest tag",
        ])
          expect(line(result.stdout, "release-verify", suppressed)).toBe("");
      } else {
        for (const suppressed of [
          "npm latest tag",
          "image version digest",
          "image latest digest",
        ])
          expect(line(result.stdout, "release-verify", suppressed)).toBe("");
      }
      expect(result.stdout).not.toContain(
        ["npm latest is a deprecated", "placeholder"].join(" "),
      );
      comparedGets(server);
    },
  );

  it.each([
    ["beta tag differs", "npm beta tag", true],
    ["stable latest differs", "npm latest tag", false],
    ["stable latest old bytes", "image latest digest", false],
    ["beta stable mapping changed", "image latest tag", true],
    [
      "beta latest equals candidate",
      "image latest tag FAIL latest names the release",
      true,
    ],
    [
      "beta default deprecated",
      "npm default FAIL npm latest stable is deprecated; owner recovery required",
      true,
    ],
  ] as const)(
    "BR-372 v3 BR-373 v3 lifecycle read-back: %s (AC-42)",
    async (name, failure, beta) => {
      const { result, state, waits } = await lifecycleReadBack(
        beta ? LATER_BETA : LATER_STABLE,
        (s, d) => {
          if (name === "beta tag differs") d["dist-tags"].beta = "1.2.0-beta.1";
          if (name === "stable latest differs") d["dist-tags"].latest = "1.1.0";
          if (name === "stable latest old bytes")
            s.latest = { status: 200, body: PRIOR_INDEX };
          if (name === "beta stable mapping changed")
            s.latest = { status: 200, body: `${PRIOR_INDEX}\n` };
          if (name === "beta latest equals candidate")
            s.latest = s.references!["1.1.0"] = s.index;
          if (name === "beta default deprecated")
            d.versions["1.1.0"]!.deprecated = "vulnerable";
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `release-verify: ${failure}${failure.includes(" FAIL ") ? "\n" : " FAIL "}`,
      );
      if (failure.startsWith("npm")) {
        expect(state.npmAttempts).toBe(20);
        expect(waits).toHaveLength(19);
      }
    },
  );

  it.each(
    ["success", "exhaustion"].flatMap((outcome) =>
      ["invalid", "different"].map((final) => [outcome, final] as const),
    ),
  )(
    "BR-372 v3 BR-373 v3 lifecycle read-back: final document after %s is %s (AC-42)",
    async (outcome, final) => {
      const { result, state, server } = await lifecycleReadBack(
        LATER_BETA,
        (s, d) => {
          const early = structuredClone(d);
          delete early.versions[LATER_BETA];
          const last = structuredClone(d);
          if (final === "invalid") last["dist-tags"].latest = "../unsafe";
          else {
            addVersion(last, "1.2.0");
            last["dist-tags"].latest = "1.2.0";
            s.latest = s.references!["1.2.0"]!;
          }
          if (outcome === "exhaustion") delete last.time[LATER_BETA];
          s.npm = (attempt) => ({
            status: 200,
            body: attempt === 20 ? last : early,
          });
        },
      );
      expect(state.npmAttempts).toBe(20);
      if (final === "invalid") {
        expect(line(result.stdout, "release-verify", "image latest tag")).toBe(
          "release-verify: image latest tag FAIL npm stable default unavailable",
        );
        expect(comparedGets(server).filter((r) => r !== LATER_BETA)).toEqual(
          [],
        );
      } else {
        expect(line(result.stdout, "release-verify", "image latest tag")).toBe(
          "release-verify: image latest tag ok",
        );
        expect(comparedGets(server)).toContain("1.2.0");
        expect(comparedGets(server)).not.toContain("1.1.0");
      }
      expect(result.status).toBe(
        final === "invalid" || outcome === "exhaustion" ? 1 : 0,
      );
    },
  );

  it("BR-372 v3 BR-373 v3 lifecycle read-back: deprecated stable fix stays deprecated historically (AC-40)", async () => {
    const { result, doc } = await lifecycleReadBack("1.0.1", (_s, d) => {
      delete d.versions["1.1.0"];
      delete d.time["1.1.0"];
      addVersion(d, STABLE);
      d.versions[STABLE]!.deprecated = "vulnerable";
    });
    expect(result.status, result.stdout).toBe(0);
    expect(doc.versions[STABLE]!.deprecated).toBe("vulnerable");
    expect(doc["dist-tags"].latest).toBe("1.0.1");
  });
});

function restorationVariant(
  registry: RecoveryRegistry,
  variant: string,
): string {
  if (variant === "reserialize" || variant === "fail") registry.copy = variant;
  if (variant === "missing") registry.tags.delete(STABLE);
  if (variant === "get failure") registry.latestReply = { status: 503 };
  if (variant === "invalid") registry.latestReply = { status: 200, body: "{}" };
  const invalidDigests: Record<string, string> = {
    empty: "",
    uppercase: PREVIOUS_DIGEST.toUpperCase(),
    short: "sha256:abc",
    injection: `${PREVIOUS_DIGEST}; exit 0`,
  };
  return invalidDigests[variant] ?? PREVIOUS_DIGEST;
}

describe("F-024 v4 AC-43 byte-preserving owner restoration", () => {
  it.each([
    ["exact bytes", "", null],
    [
      "reserialized JSON",
      "reserialize",
      "recovery blocked: latest restoration unconfirmed",
    ],
    ["command failure", "fail", "recovery blocked: latest repoint failed"],
    [
      "missing S",
      "missing",
      "recovery blocked: latest restoration unconfirmed",
    ],
    [
      "GET unavailable despite matching HEAD",
      "get failure",
      "recovery blocked: latest restoration unconfirmed",
    ],
    [
      "latest invalid",
      "invalid",
      "recovery blocked: latest restoration unconfirmed",
    ],
    ["empty digest", "empty", "recovery blocked: image identity uncertain"],
    [
      "uppercase digest",
      "uppercase",
      "recovery blocked: image identity uncertain",
    ],
    ["short digest", "short", "recovery blocked: image identity uncertain"],
    [
      "digest injection",
      "injection",
      "recovery blocked: image identity uncertain",
    ],
  ] as const)(
    "BR-433 v1 BR-354 v3 byte preserving restoration: %s (AC-43)",
    async (_name, variant, diagnostic) => {
      const registry = new RecoveryRegistry();
      registry.put(PREVIOUS_INDEX, [STABLE]);
      registry.put(RUN_INDEX, ["1.0.1", "latest"]);
      const server = await double(
        (request) =>
          registry.route(request) ?? {
            status: 200,
            body: { token: "pull-token" },
          },
      );
      doubles.push(server);
      const digest = restorationVariant(registry, variant);
      const root = temporary("guide-restoration-");
      const log = join(root, "docker.jsonl");
      const result = await runRecoveryBlock(root, server.url, digest, log);
      const tokenRequests = server.seen.filter((r) =>
        r.url.startsWith("/token?"),
      );
      for (const request of tokenRequests) {
        expect(request.authorization).toBe(
          `Basic ${Buffer.from("x-access-token:SYNTHETIC-RECOVERY-TOKEN").toString("base64")}`,
        );
      }
      const manifests = server.seen.filter((r) =>
        r.url.includes("/manifests/"),
      );
      for (const request of manifests) {
        expect(request.method).toBe("GET");
        expect(request.authorization).toBe("Bearer pull-token");
      }
      const curlCalls = lines(`${log}.curl`);
      expect(curlCalls).toHaveLength(tokenRequests.length + manifests.length);
      for (const argv of curlCalls) {
        expect(argv).not.toContain("SYNTHETIC-RECOVERY-TOKEN");
        expect(argv).not.toContain("pull-token");
      }
      const assertFailure = () => {
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(`${diagnostic}\n`);
        expect(result.stdout).not.toContain("recovery: GHCR latest restored");
        expect(
          registry.journal.some((entry) => entry.startsWith("delete ")),
        ).toBe(false);
        expect(registry.tags.get("1.0.1")).toBe(RUN_DIGEST);
        if (["empty", "uppercase", "short", "injection"].includes(variant)) {
          expect(lines(log)).toEqual([]);
          expect(server.seen).toEqual([]);
        }
      };
      const assertSuccess = () => {
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(tokenRequests).toHaveLength(1);
        expect(curlCalls).toHaveLength(3);
        expect(result.stdout).toContain(
          `recovery: GHCR latest restored ${PREVIOUS_DIGEST}\n`,
        );
        expect(registry.tags.get("latest")).toBe(PREVIOUS_DIGEST);
        const confirmations = server.seen.filter((r) =>
          r.url.includes("/manifests/"),
        );
        expect(confirmations.map((r) => r.url.split("/").at(-1))).toEqual(
          expect.arrayContaining([STABLE, "latest"]),
        );
        for (const r of confirmations) {
          expect(r.method).toBe("GET");
          expect(r.accept).toBe(RECOVERY_ACCEPT);
        }
        registry.deletePackage(RUN_DIGEST);
        expect(registry.tags.has("1.0.1")).toBe(false);
        expect(registry.tags.get(STABLE)).toBe(PREVIOUS_DIGEST);
        expect(registry.tags.get("latest")).toBe(PREVIOUS_DIGEST);
        expect(registry.bodies.get(PREVIOUS_DIGEST)).toBe(PREVIOUS_INDEX);
        expect(registry.journal.indexOf("GET latest")).toBeLessThan(
          registry.journal.indexOf(`delete ${RUN_DIGEST}`),
        );
      };
      if (diagnostic) assertFailure();
      else assertSuccess();
    },
  );
});

interface RecoveryEvidence {
  owner: boolean;
  prior: string | undefined;
  priorDigest: string;
  candidateDigest: string;
  priorEvidence: boolean;
  npmCertain: boolean;
  restoreOnly: boolean;
  failConfirmation: boolean;
}
function hasPublished(doc: NpmFixture, candidate: string): boolean {
  return !!(doc.versions[candidate] || doc.time[candidate]);
}
function cleanupIdentityValid(
  registry: RecoveryRegistry,
  doc: NpmFixture,
  candidate: string,
  beta: boolean,
  evidence: RecoveryEvidence,
  restoreOnly: boolean,
): boolean {
  if (!evidence.owner) return false;
  if (
    evidence.prior !== undefined &&
    !priorIdentityValid(registry, doc, evidence, restoreOnly)
  )
    return false;
  if (restoreOnly) return true;
  const attached = [...registry.tags]
    .filter(([, digest]) => digest === evidence.candidateDigest)
    .map(([tag]) => tag)
    .sort();
  const allowed = beta ? [candidate] : [candidate, "latest"].sort();
  return (
    !!evidence.candidateDigest &&
    registry.tags.get(candidate) === evidence.candidateDigest &&
    JSON.stringify(attached) === JSON.stringify(allowed)
  );
}
function priorIdentityValid(
  registry: RecoveryRegistry,
  doc: NpmFixture,
  evidence: RecoveryEvidence,
  restoreOnly: boolean,
): boolean {
  return (
    evidence.priorEvidence &&
    doc["dist-tags"].latest === evidence.prior &&
    registry.tags.get(evidence.prior!) === evidence.priorDigest &&
    (restoreOnly || evidence.priorDigest !== evidence.candidateDigest)
  );
}
async function recoveryGet(server: Double, tag: string) {
  const response = await fetch(
    `${server.url}/v2/sstolz/kdrive-mcp-server/manifests/${tag}`,
    { headers: { Accept: INDEX_ACCEPT } },
  );
  return {
    status: response.status,
    digest: `sha256:${sha256(Buffer.from(await response.arrayBuffer()))}`,
  };
}
async function priorConfirmed(
  server: Double,
  prior: string,
  digest: string,
): Promise<boolean> {
  for (const tag of [prior, "latest"]) {
    const read = await recoveryGet(server, tag);
    if (read.status !== 200 || read.digest !== digest) return false;
  }
  return true;
}
async function cleanupConfirmed(
  server: Double,
  doc: NpmFixture,
  candidate: string,
  evidence: RecoveryEvidence,
): Promise<boolean> {
  if ((await recoveryGet(server, candidate)).status !== 404) return false;
  if (!evidence.prior)
    return (await recoveryGet(server, "latest")).status === 404;
  return (
    (await priorConfirmed(server, evidence.prior, evidence.priorDigest)) &&
    doc["dist-tags"].latest === evidence.prior &&
    !hasPublished(doc, candidate)
  );
}
async function restorePrior(
  server: Double,
  digest: string,
): Promise<string | null> {
  const root = temporary("owner-recovery-");
  const restored = await runRecoveryBlock(
    root,
    server.url,
    digest,
    join(root, "docker.jsonl"),
  );
  if (restored.status === 0) return null;
  return (
    /recovery blocked: [^\n]+/u.exec(restored.stdout + restored.stderr)?.[0] ??
    "recovery blocked: latest restoration unconfirmed"
  );
}
// AC-43 AC-44 BR-433 v1: explicit owner model, as in the v3 rehearsal.
// Production entry paths are used for preflight/publication; this model grants
// no real authority and mutates only a digest-keyed in-memory package double.
async function ownerCleanup(
  registry: RecoveryRegistry,
  state: ReleaseState,
  server: Double,
  candidate: string,
  beta: boolean,
  evidence: RecoveryEvidence,
): Promise<string> {
  const npm = typeof state.npm === "function" ? undefined : state.npm;
  if (!evidence.npmCertain || npm?.status !== 200)
    return "recovery blocked: npm outcome uncertain";
  const doc = npm.body as NpmFixture;
  if (hasPublished(doc, candidate)) return "npm accepted: read-back only";
  const prior = evidence.prior;
  const restoreOnly =
    evidence.restoreOnly &&
    !evidence.candidateDigest &&
    !beta &&
    prior !== undefined;
  if (
    !cleanupIdentityValid(registry, doc, candidate, beta, evidence, restoreOnly)
  )
    return "recovery blocked: image identity uncertain";
  if (prior && !beta) {
    const failure = await restorePrior(server, evidence.priorDigest);
    if (failure) return failure;
  }
  if (restoreOnly)
    return "recovery: restored only; candidate burned; new version required";
  // Recheck npm immediately before deletion, including a time-only acceptance.
  if (hasPublished(doc, candidate)) return "npm accepted: read-back only";
  if (
    beta &&
    prior &&
    !(await priorConfirmed(server, prior, evidence.priorDigest))
  )
    return "recovery blocked: image identity uncertain";
  return deleteConfirmedCandidate(registry, doc, server, candidate, evidence);
}
async function deleteConfirmedCandidate(
  registry: RecoveryRegistry,
  doc: NpmFixture,
  server: Double,
  candidate: string,
  evidence: RecoveryEvidence,
): Promise<string> {
  const recheck = await fetch(`${server.url}/@sstolz%2fkdrive-mcp-server`);
  if (recheck.status !== 200) return "recovery blocked: npm outcome uncertain";
  const fresh = (await recheck.json()) as NpmFixture;
  if (fresh.versions[candidate] || fresh.time[candidate])
    return "npm accepted: read-back only";
  if (fresh["dist-tags"].latest !== doc["dist-tags"].latest)
    return "recovery blocked: image identity uncertain";
  registry.deletePackage(evidence.candidateDigest);
  if (evidence.failConfirmation) registry.put(RUN_INDEX, [candidate]);
  if (!(await cleanupConfirmed(server, doc, candidate, evidence)))
    return "recovery blocked: cleanup unconfirmed";
  return "recovery: cleanup confirmed";
}
function recoveryEvidence(
  overrides: Partial<RecoveryEvidence> = {},
): RecoveryEvidence {
  return {
    owner: true,
    prior: STABLE,
    priorDigest: PREVIOUS_DIGEST,
    candidateDigest: RUN_DIGEST,
    priorEvidence: true,
    npmCertain: true,
    restoreOnly: false,
    failConfirmation: false,
    ...overrides,
  };
}

function cleanupVariant(
  registry: RecoveryRegistry,
  doc: NpmFixture,
  candidate: string,
  variant: string,
  evidence: RecoveryEvidence,
) {
  if (variant === "bootstrap") evidence.prior = undefined;
  if (variant === "restore only") {
    evidence.candidateDigest = "";
    evidence.restoreOnly = true;
  }
  if (variant === "same digest") {
    registry.put(PREVIOUS_INDEX, [candidate, "latest"]);
    evidence.candidateDigest = PREVIOUS_DIGEST;
  }
  cleanupEvidenceVariant(registry, doc, variant, evidence);
  cleanupNpmVariant(doc, candidate, variant, evidence);
}
function cleanupEvidenceVariant(
  registry: RecoveryRegistry,
  doc: NpmFixture,
  variant: string,
  evidence: RecoveryEvidence,
) {
  if (variant === "extra tag") registry.tags.set("unexpected", RUN_DIGEST);
  if (variant === "missing evidence") evidence.priorEvidence = false;
  if (variant === "changed npm default") doc["dist-tags"].latest = "1.0.2";
  if (variant === "candidate unknown") evidence.candidateDigest = "";
}
function cleanupNpmVariant(
  doc: NpmFixture,
  candidate: string,
  variant: string,
  evidence: RecoveryEvidence,
) {
  if (variant === "npm accepted") addVersion(doc, candidate);
  if (variant === "npm time accepted") doc.time[candidate] = "date";
  if (variant === "npm uncertain") evidence.npmCertain = false;
  if (variant === "not owner") evidence.owner = false;
  if (variant === "cleanup unconfirmed") evidence.failConfirmation = true;
}

function expectedCleanup(variant: string, success: boolean): string {
  if (success) return "recovery: cleanup confirmed";
  if (variant === "restore only")
    return "recovery: restored only; candidate burned; new version required";
  if (variant === "npm uncertain")
    return "recovery blocked: npm outcome uncertain";
  if (variant.startsWith("npm ")) return "npm accepted: read-back only";
  if (variant === "cleanup unconfirmed")
    return "recovery blocked: cleanup unconfirmed";
  return "recovery blocked: image identity uncertain";
}

it.each([
  "stable",
  "beta",
  "bootstrap",
  "restore only",
  "same digest",
  "extra tag",
  "missing evidence",
  "changed npm default",
  "candidate unknown",
  "npm accepted",
  "npm time accepted",
  "npm uncertain",
  "not owner",
  "cleanup unconfirmed",
])(
  "BR-433 v1 byte preserving restoration: owner branch %s (AC-43)",
  async (variant) => {
    const candidate = variant === "beta" ? "1.1.0-beta.1" : "1.0.1";
    const registry = new RecoveryRegistry();
    const state = releaseState(GOOD_SHA);
    const doc =
      variant === "bootstrap"
        ? (npmDocument() as NpmFixture)
        : lifecycleDocument();
    state.npm = { status: 200, body: doc };
    const route = releaseRoute(state);
    const server = await double((r) => registry.route(r) ?? route(r));
    doubles.push(server);
    if (variant !== "bootstrap")
      registry.put(PREVIOUS_INDEX, [STABLE, "latest"]);
    registry.put(
      RUN_INDEX,
      variant === "beta" ? [candidate] : [candidate, "latest"],
    );
    const evidence = recoveryEvidence();
    cleanupVariant(registry, doc, candidate, variant, evidence);
    const result = await ownerCleanup(
      registry,
      state,
      server,
      candidate,
      variant === "beta",
      evidence,
    );
    const success = ["stable", "beta", "bootstrap"].includes(variant);
    const expected = expectedCleanup(variant, success);
    expect(result).toBe(expected);
    const deletes = registry.journal.filter((entry) =>
      entry.startsWith("delete "),
    );
    expect(deletes).toHaveLength(
      success || variant === "cleanup unconfirmed" ? 1 : 0,
    );
    if (success) {
      expect(registry.tags.has(candidate)).toBe(false);
      expect(doc.versions[candidate]).toBeUndefined();
      expect(doc.time[candidate]).toBeUndefined();
      if (variant === "bootstrap") expect(registry.tags.size).toBe(0);
      else {
        expect(registry.tags.get(STABLE)).toBe(PREVIOUS_DIGEST);
        expect(registry.tags.get("latest")).toBe(PREVIOUS_DIGEST);
      }
    }
    if (["bootstrap", "beta"].includes(variant))
      expect(registry.journal).not.toContain("copy");
    if (variant === "restore only") {
      expect(registry.tags.get(candidate)).toBe(RUN_DIGEST);
      expect(registry.tags.get("latest")).toBe(PREVIOUS_DIGEST);
    }
  },
);

function lifecycleKind(scenario: string) {
  const beta =
    scenario === "post-stable beta" ||
    scenario === "post-stable beta cleanup" ||
    scenario === "lower beta refused";
  const prior = [
    "patch ahead of future beta",
    "lower stable refused",
    "vulnerable rollback reconciliation",
  ].includes(scenario)
    ? "1.1.0"
    : STABLE;
  const candidate =
    scenario === "lower stable refused"
      ? "1.0.1"
      : scenario === "lower beta refused"
        ? "1.1.2-beta.1"
        : beta
          ? LATER_BETA
          : prior === "1.1.0"
            ? "1.1.1"
            : "1.0.2";
  return { beta, prior, candidate };
}
function lifecycleFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of [
    "Makefile",
    "compose.yaml",
    "Dockerfile.dev",
    "scripts/release.ts",
    "scripts/release-image.sh",
  ])
    files[path] = readFileSync(path, "utf8");
  return files;
}
function prepareLifecycleDocument(
  doc: NpmFixture,
  scenario: string,
  prior: string,
): void {
  if (
    scenario.startsWith("deprecated") ||
    scenario === "vulnerable rollback reconciliation"
  )
    doc.versions[prior]!.deprecated = "vulnerable";
  if (scenario === "stale default reconciliation") addVersion(doc, "1.0.1");
  if (scenario === "vulnerable rollback reconciliation") {
    addVersion(doc, STABLE);
    doc["dist-tags"].latest = STABLE;
  }
  if (scenario.startsWith("time-only")) doc.time["1.0.1"] = "date";
}
function expectMakeSuccess(target: string, result: Result): void {
  expect(result.status, `${target}\n${result.stdout}\n${result.stderr}`).toBe(
    0,
  );
}

// BR-354 v3 BR-432 v1 BR-433 v1; AC-40 AC-44 AC-45.
it.each([
  "later stable",
  "post-stable beta",
  "patch ahead of future beta",
  "deprecated fix",
  "deprecated withheld dry-run evidence",
  "deprecated denied environment",
  "withheld dry-run evidence",
  "denied image approval",
  "denied second approval",
  "expired second approval",
  "npm preflight failure",
  "npm publish failure",
  "partial image push",
  "uncertain npm acceptance",
  "cancelled retry",
  "expired retry",
  "missing artifact",
  "main advanced retry",
  "main advanced cleanup",
  "orphan blocks beta",
  "stale default reconciliation",
  "vulnerable rollback reconciliation",
  "time-only history",
  "time-only orphan reconciliation",
  "lower stable refused",
  "lower beta refused",
  "post-stable beta cleanup",
])(
  "F-024 v4 lifecycle rehearsal: %s (AC-44)",
  async (scenario) => {
    const {
      beta,
      prior,
      candidate: initialCandidate,
    } = lifecycleKind(scenario);
    let candidate = initialCandidate;
    const files = lifecycleFiles();
    const repo = releaseRepo({
      versionFile: `${candidate}\n`,
      packageVersion: candidate,
      tag: "none",
      files: {
        ...files,
        "package-lock.json": JSON.stringify({
          version: candidate,
          packages: { "": { version: candidate } },
        }),
      },
    });
    repo.git("tag", `v${candidate}`, repo.sha);
    const state = releaseState(repo.sha);
    const doc = lifecycleDocument(prior);
    addVersion(doc, "1.2.0-beta.1");
    doc["dist-tags"].beta = "1.2.0-beta.1";
    prepareLifecycleDocument(doc, scenario, prior);
    state.npm = { status: 200, body: doc };
    const registry = new RecoveryRegistry();
    registry.put(PREVIOUS_INDEX, [prior, "latest"]);
    const route = releaseRoute(state);
    const server = await double((r) => registry.route(r) ?? route(r));
    doubles.push(server);
    const fake = fakeBin();
    const root = temporary("lifecycle-rehearsal-");
    const prepared = join(root, "prepared.tgz");
    let packed = packTarball(prepared, {
      name: "@sstolz/kdrive-mcp-server",
      version: candidate,
    });
    const output = join(root, "outputs");
    writeFileSync(output, "");
    const metadata = join(root, "metadata.json");
    writeFileSync(
      metadata,
      JSON.stringify({ "containerimage.digest": RUN_DIGEST }),
    );
    const journal: string[] = [];
    let releaseSha = repo.sha;
    let dispatchedSha = releaseSha;
    const command = (target: string, env: Record<string, string> = {}) =>
      run("/usr/bin/make", ["--no-print-directory", target], {
        cwd: repo.root,
        env: {
          ...gitEnv(),
          PATH: `${fake.bin}:${process.env.PATH ?? ""}`,
          FAKE_NPM_LOG: fake.npmLog,
          FAKE_NPM_TARBALL: prepared,
          FAKE_DOCKER_LOG: fake.dockerLog,
          FAKE_DOCKER_STDIN: fake.stdin,
          FAKE_BUILDX_METADATA: metadata,
          GITHUB_OUTPUT: output,
          RELEASE_VERSION: candidate,
          RELEASE_SHA: releaseSha,
          GITHUB_SHA: dispatchedSha,
          RELEASE_DRY_RUN: "false",
          GITHUB_TOKEN: TOKEN,
          RELEASE_RETRY_DELAY_MS: "0",
          ...endpoints(server.url),
          ...env,
        },
      });
    const ok = async (target: string, env: Record<string, string> = {}) => {
      const result = await command(target, env);
      expectMakeSuccess(target, result);
      return result;
    };
    const refuseLower = async () => {
      if (scenario.startsWith("lower")) {
        reasonViaMake(
          await command("release-check", { RELEASE_PHASE: "verify" }),
          beta
            ? "beta version is not greater than every published version"
            : "stable version is not greater than every published stable version",
        );
        expect(npmCalls(fake.npmLog)).toEqual([]);
        expect(lines(fake.dockerLog).some((l) => l.includes("--push"))).toBe(
          false,
        );
        return true;
      }
      return false;
    };
    if (await refuseLower()) return;
    const reconcileDefaults = async () => {
      if (scenario.includes("reconciliation")) {
        const stale = scenario !== "time-only orphan reconciliation";
        if (stale) {
          reasonViaMake(
            await command("release-check", { RELEASE_PHASE: "verify" }),
            "npm latest is not the greatest published stable version",
          );
          // Separate owner authority in the model, not an automated release bypass.
          const greatest =
            scenario === "stale default reconciliation" ? "1.0.1" : prior;
          doc["dist-tags"].latest = greatest;
          registry.tags.set(greatest, PREVIOUS_DIGEST);
          registry.tags.set("latest", PREVIOUS_DIGEST);
          journal.push("owner npm/GHCR reconciliation");
        } else {
          registry.put(RUN_INDEX, ["1.0.1", "latest"]);
          reasonViaMake(
            await command("release-check", { RELEASE_PHASE: "verify" }),
            "GHCR latest does not match npm stable default",
          );
          const restored = await runRecoveryBlock(
            root,
            server.url,
            PREVIOUS_DIGEST,
            join(root, "restore.log"),
          );
          expect(restored.status, restored.stdout + restored.stderr).toBe(0);
          journal.push("owner GHCR reconciliation");
        }
      }
    };
    await reconcileDefaults();
    let dryEvidence = "";
    let tarballDigest = "";
    const verify = async (dry: boolean) => {
      await ok("release-check", {
        RELEASE_PHASE: "verify",
        RELEASE_DRY_RUN: String(dry),
      });
      await ok("release-setup");
      await ok("pack");
      await ok("release-npm", { RELEASE_DRY_RUN: "true" });
      await ok("image-binfmt", { IMAGE_PLATFORMS: "linux/amd64 linux/arm64" });
      await ok("release-image", { RELEASE_DRY_RUN: "true" });
      tarballDigest = lines(output)
        .find((l) => l.startsWith("tarball-sha256="))!
        .slice("tarball-sha256=".length);
      expect(tarballDigest).toBe(sha256(packed));
      if (dry) dryEvidence = `${candidate}:${releaseSha}`;
      journal.push(dry ? "dry verify" : "verify");
    };
    const approvedImage = async () => {
      await verify(true);
      expect(registry.tags.get("latest")).toBe(PREVIOUS_DIGEST);
      expect(doc["dist-tags"].latest).toBe(
        scenario === "stale default reconciliation" ? "1.0.1" : prior,
      );
      await verify(false);
      if (scenario.endsWith("withheld dry-run evidence")) dryEvidence = "";
      const imageApproved = scenario !== "denied image approval";
      if (!imageApproved || dryEvidence !== `${candidate}:${releaseSha}`) {
        expect(registry.tags.has(candidate)).toBe(false);
        expect(
          npmCalls(fake.npmLog)
            .filter((c) => c.argv[0] === "publish")
            .every((c) => c.argv.includes("--dry-run")),
        ).toBe(true);
        expect(lines(fake.dockerLog).some((l) => l.includes("--push"))).toBe(
          false,
        );
        return false;
      }
      journal.push("image approval");
      await ok("release-check", { RELEASE_PHASE: "image" });
      const image = await command(
        "release-image",
        scenario === "partial image push" ? { FAKE_BUILD_FAIL: "1" } : {},
      );
      expect(image.status, image.stdout).toBe(
        scenario === "partial image push" ? 2 : 0,
      );
      registry.put(RUN_INDEX, beta ? [candidate] : [candidate, "latest"]);
      journal.push("image push");
      return true;
    };
    if (!(await approvedImage())) return;
    const imageDigest = beta
      ? ""
      : (lines(output)
          .find((l) => l.startsWith("image_digest="))
          ?.slice("image_digest=".length) ?? "");
    if (!beta && scenario !== "partial image push")
      expect(imageDigest).toBe(RUN_DIGEST);
    expect(registry.tags.get("latest")).toBe(
      beta ? PREVIOUS_DIGEST : RUN_DIGEST,
    );
    expect(doc["dist-tags"].latest).not.toBe(candidate);
    const checkOrphan = async () => {
      if (scenario === "orphan blocks beta") {
        const blocked = await release(
          "check",
          repo.root,
          checkEnv(repo, server.url, {
            RELEASE_VERSION: LATER_BETA,
            RELEASE_DRY_RUN: "false",
          }),
        );
        // Commit mismatch is independent; the registry condition still pins the orphan.
        exactCheck(
          blocked,
          "GHCR image",
          "GHCR latest does not match npm stable default",
        );
      }
    };
    await checkOrphan();
    const advanceMain = () => {
      writeFileSync(join(repo.root, "advance.txt"), "advanced main\n");
      repo.git("add", "advance.txt");
      repo.git("commit", "-q", "-m", "advance fixture main");
      const advanced = repo.git("rev-parse", "HEAD");
      repo.git("update-ref", "refs/remotes/origin/main", advanced);
      repo.git("checkout", "-q", "--detach", repo.sha);
      return advanced;
    };
    let advanced = "";
    if (scenario.startsWith("main advanced")) advanced = advanceMain();
    const publishNpm = async (
      approved: boolean,
      failure = false,
      accepted = false,
    ) => {
      if (!approved) return false;
      journal.push("npm approval");
      const checked = await command("release-check", {
        RELEASE_PHASE: "npm",
        RELEASE_IMAGE_DIGEST: imageDigest,
      });
      if (checked.status !== 0) return false;
      const published = await command("release-npm", {
        RELEASE_TARBALL_SHA256: tarballDigest,
        ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:1/oidc",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "SYNTHETIC-OIDC",
        FAKE_NPM_STATUS: failure ? "1" : "0",
      });
      if (published.status === 0 || accepted) {
        addVersion(doc, candidate);
        doc.versions[candidate]!.dist = {
          tarball: `${server.url}/tarballs/pkg.tgz`,
          attestations: { provenance: {} },
        };
        doc["dist-tags"][beta ? "beta" : "latest"] = candidate;
        state.tarball = { status: 200, body: packed };
        journal.push("npm accepted");
      }
      return published.status === 0;
    };
    const cleanupScenarios = [
      "expired second approval",
      "partial image push",
      "cancelled retry",
      "expired retry",
      "missing artifact",
      "main advanced cleanup",
      "orphan blocks beta",
      "post-stable beta cleanup",
    ];
    const cleanupRun = async () => {
      if (cleanupScenarios.includes(scenario)) {
        expect(await publishNpm(false)).toBe(false);
        const cleaned = await ownerCleanup(
          registry,
          state,
          server,
          candidate,
          beta,
          recoveryEvidence({ prior }),
        );
        expect(cleaned).toBe("recovery: cleanup confirmed");
        expect(registry.tags.get("latest")).toBe(PREVIOUS_DIGEST);
        expect(doc["dist-tags"].latest).toBe(prior);
        const replaceAdvanced = async () => {
          dispatchedSha = advanced;
          reasonViaMake(
            await command("release-check", { RELEASE_PHASE: "verify" }),
            "sha is not the dispatched commit",
          );
          // Cleanup authorizes neither an old-commit redispatch nor a replacement.
          const oldCandidate = candidate;
          repo.git("checkout", "-q", "--detach", advanced);
          candidate = "2.0.0";
          writeFileSync(join(repo.root, "VERSION"), `${candidate}\n`);
          writeFileSync(
            join(repo.root, "package.json"),
            JSON.stringify({
              name: "@sstolz/kdrive-mcp-server",
              version: candidate,
            }),
          );
          writeFileSync(
            join(repo.root, "package-lock.json"),
            JSON.stringify({
              version: candidate,
              packages: { "": { version: candidate } },
            }),
          );
          repo.git("add", "VERSION", "package.json", "package-lock.json");
          repo.git("commit", "-q", "-m", "replacement release fixture");
          releaseSha = repo.git("rev-parse", "HEAD");
          dispatchedSha = releaseSha;
          repo.git("update-ref", "refs/remotes/origin/main", releaseSha);
          repo.git("tag", `v${candidate}`, releaseSha);
          state.ciRuns = releaseState(releaseSha).ciRuns;
          packed = packTarball(prepared, {
            name: "@sstolz/kdrive-mcp-server",
            version: candidate,
          });
          dryEvidence = "";
          expect(dryEvidence).not.toBe(`${candidate}:${releaseSha}`);
          writeFileSync(output, "");
          // AC-44 (F-024 v4 lines 671–676): a new dispatch has fresh artifacts.
          renameSync(
            join(repo.root, "artifacts"),
            join(root, "original-artifacts"),
          );
          await verify(true);
          expect(dryEvidence).toBe(`${candidate}:${releaseSha}`);
          journal.push("replacement exact-pair owner go");
          await verify(false);
          await ok("release-check", { RELEASE_PHASE: "image" });
          await ok("release-image");
          registry.put(RUN_INDEX, [candidate, "latest"]);
          expect(await publishNpm(true)).toBe(true);
          await ok("release-verify", {
            RELEASE_IMAGE_DIGEST: RUN_DIGEST,
            RELEASE_TARBALL_SHA256: tarballDigest,
          });
          expect(doc.versions[oldCandidate]).toBeUndefined();
          expect(doc["dist-tags"].latest).toBe(candidate);
        };
        if (advanced) await replaceAdvanced();
        else await ok("release-check", { RELEASE_PHASE: "verify" });
        if (scenario === "orphan blocks beta") {
          const eligible = await release(
            "check",
            repo.root,
            checkEnv(repo, server.url, {
              RELEASE_VERSION: LATER_BETA,
              RELEASE_DRY_RUN: "false",
            }),
          );
          exactCheck(eligible, "GHCR image", null);
        }
        return true;
      }
      return false;
    };
    if (await cleanupRun()) return;
    const prePublishFailures = async () => {
      if (scenario === "deprecated denied environment") {
        state.environment = { status: 403 };
        const before = npmCalls(fake.npmLog).length;
        expect(await publishNpm(true)).toBe(false);
        expect(npmCalls(fake.npmLog)).toHaveLength(before);
        expect(doc.versions[candidate]).toBeUndefined();
        expect(doc.versions[prior]!.deprecated).toBe("vulnerable");
        return true;
      }
      if (scenario === "denied second approval")
        expect(await publishNpm(false)).toBe(false);
      if (scenario === "npm preflight failure") {
        state.environment = { status: 403 };
        const before = npmCalls(fake.npmLog).length;
        expect(await publishNpm(true)).toBe(false);
        expect(npmCalls(fake.npmLog)).toHaveLength(before);
        state.environment = releaseState(repo.sha).environment;
      }
      if (scenario === "npm publish failure")
        expect(await publishNpm(true, true)).toBe(false);
      return false;
    };
    if (await prePublishFailures()) return;
    const uncertain = scenario === "uncertain npm acceptance";
    expect(await publishNpm(true, uncertain, uncertain)).toBe(!uncertain);
    const publishedCount = npmCalls(fake.npmLog).length;
    expect(
      await ownerCleanup(
        registry,
        state,
        server,
        candidate,
        beta,
        recoveryEvidence({ prior }),
      ),
    ).toBe("npm accepted: read-back only");
    const assertPublished = async () => {
      const verified = await ok("release-verify", {
        RELEASE_IMAGE_DIGEST: imageDigest,
        RELEASE_TARBALL_SHA256: tarballDigest,
      });
      expect(failed(verified.stdout, "release-verify")).toEqual([]);
      expect(npmCalls(fake.npmLog)).toHaveLength(publishedCount);
      // AC-44 (F-024 v4 lines 690–694) requires one prior reconciliation copy.
      expect(
        registry.journal.filter((e) => e.startsWith("delete ") || e === "copy"),
      ).toEqual(scenario === "time-only orphan reconciliation" ? ["copy"] : []);
      expect(doc["dist-tags"].latest).toBe(beta ? prior : candidate);
      expect(registry.tags.get("latest")).toBe(
        beta ? PREVIOUS_DIGEST : RUN_DIGEST,
      );
      if (
        scenario.startsWith("deprecated") ||
        scenario === "vulnerable rollback reconciliation"
      )
        expect(doc.versions[prior]!.deprecated).toBe("vulnerable");
      const realPublishes = npmCalls(fake.npmLog).filter(
        (c) => c.argv[0] === "publish" && !c.argv.includes("--dry-run"),
      );
      for (const call of realPublishes) {
        expect(call.argv).toEqual([
          "publish",
          `./artifacts/sstolz-kdrive-mcp-server-${candidate}.tgz`,
          "--tag",
          beta ? "beta" : "latest",
          "--access",
          "public",
          "--ignore-scripts",
          "--provenance",
        ]);
      }
      expect(
        npmCalls(fake.npmLog).some((c) => c.argv.includes("dist-tag")),
      ).toBe(false);
      const push = lines(fake.dockerLog).find(
        (l) => l.startsWith("buildx build") && l.includes("--push"),
      )!;
      expect(push).toContain(
        `--tag ghcr.io/sstolz/kdrive-mcp-server:${candidate}`,
      );
      expect(
        push.includes("--tag ghcr.io/sstolz/kdrive-mcp-server:latest"),
      ).toBe(!beta);
      expect(journal.indexOf("image push")).toBeLessThan(
        journal.indexOf("npm accepted"),
      );
      expect(
        server.seen.filter((r) => r.url.endsWith("/environments/release"))
          .length,
      ).toBeGreaterThanOrEqual(4);
      if (advanced) {
        dispatchedSha = advanced;
        reasonViaMake(
          await command("release-check", { RELEASE_PHASE: "verify" }),
          "sha is not the dispatched commit",
        );
      }
    };
    await assertPublished();
  },
  120_000,
);

// AC-45 BR-363 v3 BR-372 v3 BR-373 v3 BR-431 v1 BR-432 v1.
it.each([
  [
    "history unreadable",
    "npm version not published",
    "npm document unreadable; refer to the owner",
  ],
  [
    "malformed versions before time",
    "npm version not published",
    "npm versions contains a non-SemVer version key",
  ],
  [
    "candidate before ordering",
    "npm version not published",
    "version already published on npm",
  ],
  [
    "beta ordering",
    "npm version not published",
    "beta version is not greater than every published version",
  ],
  [
    "stable ordering",
    "npm version not published",
    "stable version is not greater than every published stable version",
  ],
  ["candidate before prior image", "GHCR image", "image already published"],
  ["default before token", "GHCR image", "npm stable default unavailable"],
] as const)(
  "F-024 v4 exact diagnostics: %s (AC-45)",
  async (variant, condition, diagnostic) => {
    const candidate =
      variant === "beta ordering" ? "1.0.1-beta.1" : LATER_STABLE;
    const { result } = await lifecycleCheck(
      candidate,
      "verify",
      "false",
      (s, d) => {
        if (variant === "history unreadable")
          s.npm = { status: 200, body: { versions: {}, time: [] } };
        if (variant === "malformed versions before time") {
          d.versions["unsafe/versions"] = {};
          d.time["unsafe/time"] = "date";
          addVersion(d, candidate);
        }
        if (variant === "candidate before ordering") {
          addVersion(d, candidate);
          addVersion(d, "9.0.0");
        }
        if (variant === "beta ordering" || variant === "stable ordering")
          addVersion(d, "2.0.0");
        if (variant === "candidate before prior image") {
          s.index = { status: 200, body: RUN_INDEX };
          s.references![STABLE] = { status: 404 };
          s.latest = { status: 503 };
        }
        if (variant === "default before token") {
          delete d["dist-tags"].latest;
          s.ghcrToken = { status: 403 };
          s.index = { status: 200, body: RUN_INDEX };
        }
      },
    );
    exactCheck(result, condition, diagnostic);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/unsafe\/(?:versions|time)/u);
  },
);

// AC-39 AC-42 AC-45 BR-372 v3 BR-373 v3: pin beta's separate default-image report.
it.each([
  ["S absent", "previous stable image unavailable"],
  ["S invalid", "previous stable image manifest invalid"],
  ["latest absent", "GHCR latest missing for stable npm default"],
  ["latest invalid", "previous stable image manifest invalid"],
  ["S status", "GHCR status 503"],
  ["latest status", "GHCR status 503"],
  ["token status", "GHCR token status 403"],
  ["unsafe default", "npm stable default unavailable"],
  ["unreadable default", "npm stable default unavailable"],
] as const)(
  "BR-372 v3 BR-373 v3 lifecycle read-back: beta %s (AC-42)",
  async (variant, diagnostic) => {
    const { result, server } = await lifecycleReadBack(LATER_BETA, (s, d) => {
      if (variant === "S absent") s.references!["1.1.0"] = { status: 404 };
      if (variant === "S invalid")
        s.references!["1.1.0"] = { status: 200, body: "{}" };
      if (variant === "latest absent") s.latest = { status: 404 };
      if (variant === "latest invalid") s.latest = { status: 200, body: "{}" };
      if (variant === "S status") s.references!["1.1.0"] = { status: 503 };
      if (variant === "latest status") s.latest = { status: 503 };
      if (variant === "token status") s.ghcrToken = { status: 403 };
      if (variant === "unsafe default") d["dist-tags"].latest = "../unsafe";
      if (variant === "unreadable default") s.npm = { status: 200, body: "{" };
    });
    expect(line(result.stdout, "release-verify", "image latest tag")).toBe(
      `release-verify: image latest tag FAIL ${diagnostic}`,
    );
    expect(result.status).toBe(1);
    if (diagnostic === "npm stable default unavailable") {
      expect(comparedGets(server).filter((tag) => tag !== LATER_BETA)).toEqual(
        [],
      );
      expect(result.stdout).not.toContain("../unsafe");
    }
  },
);

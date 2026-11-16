// F-024 AC-05–AC-13, AC-21: scripts/release.ts, scripts/release-image.sh and
// the release Make targets against test doubles.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { rules } from "./helpers/image-policy.js";
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
        // F-024 v3 (BR-363 v2): a non-placeholder latest is the #91 refusal,
        // so this case keeps the valid pre-1.0 registry state.
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
      ["npm version not published"],
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
      ["npm version not published", "npm placeholder"],
      "npm placeholder missing (P-0)",
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
      ["npm placeholder"],
      "npm latest is not a deprecated placeholder (P-0)",
    ],
    [
      "dry run false dist-tags without latest",
      "false",
      "verify",
      (s) => {
        s.npm = { status: 200, body: npmDocument({ latest: undefined }) };
      },
      ["npm placeholder"],
      "npm latest is not a deprecated placeholder (P-0)",
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
      "npm latest is a deprecated placeholder",
    ],
    ["beta points elsewhere", npm({ beta: PLACEHOLDER }), "npm beta tag"],
    [
      "latest moved to the new version",
      npm({ latest: VERSION }),
      "npm latest is a deprecated placeholder",
    ],
    [
      "latest missing",
      npm({ latest: undefined }),
      "npm latest is a deprecated placeholder",
    ],
    [
      "latest names a non-deprecated version",
      npm({ placeholderDeprecated: false }),
      "npm latest is a deprecated placeholder",
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
const AFTER_STABLE =
  "releases after the first stable are out of scope; see #91 (F-024 v4)";
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
    const env = {
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
              }).filter(
                (pair): pair is [string, string] => pair[1] !== undefined,
              ),
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
      const { result } = await entry(mode!, { RELEASE_VERSION: version! });
      expect(result.stdout).toContain(
        `${mode === "image" ? "release-image" : `release-${mode}`}\u003a version ok\n`,
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
      AFTER_STABLE,
    ],
    [
      "candidate in time",
      (d) => {
        d.time[STABLE] = "date";
      },
      AFTER_STABLE,
    ],
    [
      "missing latest",
      (d) => {
        delete d["dist-tags"].latest;
      },
      "npm placeholder missing (P-0)",
    ],
    [
      "placeholder not deprecated",
      (d) => {
        delete d.versions[PLACEHOLDER]!.deprecated;
      },
      "npm latest is not a deprecated placeholder (P-0)",
    ],
    [
      "placeholder entry absent",
      (d) => {
        delete d.versions[PLACEHOLDER];
      },
      "npm latest is not a deprecated placeholder (P-0)",
    ],
    [
      "placeholder empty deprecation",
      (d) => {
        d.versions[PLACEHOLDER]!.deprecated = "";
      },
      "npm latest is not a deprecated placeholder (P-0)",
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
        doc.versions[doc["dist-tags"].latest!] =
          variant === "latest deprecated stable"
            ? { deprecated: "retired" }
            : {};
      } else if (variant.startsWith("versions"))
        doc.versions["0.9.0+build"] = {};
      else doc.time["0.9.0"] = "date";
      // #91 must win even over candidate presence, malformed keys and missing deprecation.
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
      reason(result, AFTER_STABLE);
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
    ["0.5.0", "0.6.0-beta.2", false],
    ["1.9.9", "1.10.0-beta.1", false],
    ["1.10.0", "1.9.9-beta.1", true],
    ["9007199254740993.0.0", "9007199254740992.999.999-beta.1", true],
    ["9007199254740992.0.0", "9007199254740993.0.0-beta.1", false],
    [VERSION, "0.9.0-beta.9", true],
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
      if (passes) expect(result.status, result.stdout).toBe(0);
      else
        reason(
          result,
          "stable version is not greater than every published version",
        );
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
      "GHCR latest already exists; first stable requires 404",
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
    expect(result.status, result.stdout).toBe(0);
    expect(
      server.seen
        .filter((r) => r.url.includes("/manifests/"))
        .map((r) => [r.method, r.url.split("/").at(-1)]),
    ).toEqual([["HEAD", VERSION]]);
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
    const { result, calls } = await npmPublish(version!, dry!);
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
      "failed build logs out",
      STABLE,
      "false",
      JSON.stringify(metadataSample),
      null,
      true,
    ] as const,
  ])(
    "BR-368 v2 BR-370 v2 image argv: %s",
    async (_name, version, dry, metadata, diagnostic, failBuild) => {
      const fake = fakeBin();
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
      if (diagnostic || failBuild) {
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
        "npm latest is a deprecated placeholder",
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
              GITHUB_SHA: releaseSha,
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
        reasonViaMake(refused, AFTER_STABLE);
        const count = npmCalls(fake.npmLog).filter(
          (c) => c.argv[0] === "publish",
        ).length;
        if (scenario === "read-back failed") {
          state.tarball = { status: 404 };
          expect((await readback()).status).toBe(1);
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
      } else {
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
          // Re-run unavailable (expired, partial image job or main moved): owner cleanup first.
          if (scenario === "main advanced")
            repo.git("update-ref", "refs/remotes/origin/main", repo.parent);
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
            // GNU Make exits 2 when the recipe fails.
            expect(preflight.status).toBe(2);
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
            releaseVersion = patch;
            releaseSha = sha;
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
      "npm placeholder missing (P-0)",
      {},
      (s) => {
        const d = npmDocument() as NpmFixture;
        delete d["dist-tags"].latest;
        s.npm = { status: 200, body: d };
      },
    ],
    [
      "npm latest is not a deprecated placeholder (P-0)",
      {},
      (s) => {
        s.npm = {
          status: 200,
          body: npmDocument({ placeholderDeprecated: false }),
        };
      },
    ],
    [
      AFTER_STABLE,
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
      "GHCR latest already exists; first stable requires 404",
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
      "stable version is not greater than every published version",
      {},
      (s) => {
        const d = npmDocument() as NpmFixture;
        d.time["1.1.0-beta.1"] = "date";
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
    if (mutation?.includes(" ") && mutation !== "anonymous latest") {
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
      `release-verify: ${condition}${outcome ? ` ${outcome}` : ""}`,
    );
  },
);

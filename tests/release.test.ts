// F-024 AC-05–AC-13, AC-21: scripts/release.ts, scripts/release-image.sh and
// the release Make targets against test doubles.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { rules } from "./helpers/image-policy.js";
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

// BR-375: the exact -e lists of the three scripts/release.ts targets.
const CHECK_VARIABLES = [
  "GITHUB_ACTIONS",
  "GITHUB_SHA",
  "GITHUB_TOKEN",
  "RELEASE_VERSION",
  "RELEASE_SHA",
  "RELEASE_DRY_RUN",
  "RELEASE_PHASE",
  "RELEASE_GITHUB_API_URL",
  "RELEASE_NPM_REGISTRY_URL",
  "RELEASE_GHCR_URL",
];
const NPM_VARIABLES = [
  "GITHUB_ACTIONS",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "GITHUB_EVENT_NAME",
  "GITHUB_REF",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "GITHUB_REPOSITORY_OWNER_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "GITHUB_WORKFLOW_REF",
  "RUNNER_ENVIRONMENT",
  "RELEASE_VERSION",
  "RELEASE_SHA",
  "RELEASE_DRY_RUN",
  "RELEASE_TARBALL_SHA256",
];
const VERIFY_VARIABLES = [
  "GITHUB_ACTIONS",
  "GITHUB_TOKEN",
  "RELEASE_VERSION",
  "RELEASE_SHA",
  "RELEASE_DRY_RUN",
  "RELEASE_TARBALL_SHA256",
  "RELEASE_GITHUB_API_URL",
  "RELEASE_NPM_REGISTRY_URL",
  "RELEASE_GHCR_URL",
];

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
      "0.6.0",
      { RELEASE_VERSION: "0.6.0" },
      "stable releases are out of scope (F-024 v1)",
    ],
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
      "unsupported pre-release",
    ],
    [
      "0.6.0-beta.1+build",
      { RELEASE_VERSION: "0.6.0-beta.1+build" },
      "unsupported pre-release",
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
        s.npm = {
          status: 200,
          body: npmDocument({ placeholder: false, latest: "0.5.0" }),
        };
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

  it("BR-369 npm publish: dry run", async () => {
    const { result, calls, digest } = await publish({});
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(`release-npm: tarball sha256 ${digest}\n`);
    expect(publishes(calls)).toHaveLength(1);
    expectPublishArgv(publishes(calls)[0]!.argv, true);
  });

  it("BR-369 npm publish: real run with OIDC and the verify digest", async () => {
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
      "version 0.6.0",
      { RELEASE_VERSION: "0.6.0" },
      "stable releases are out of scope (F-024 v1)",
    ],
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

  it("BR-370 image build: real run logs in through stdin, pushes one tag and logs out", async () => {
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
    "BR-372 BR-373 read-back: %s",
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
  ])("BR-372 BR-373 read-back: refuses %s", async (_name, env, reason) => {
    const { result, server, other } = await readBack(() => undefined, env);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(` FAIL ${reason}\n`);
    expect(server.seen).toEqual([]);
    expect(other.seen).toEqual([]);
  });
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

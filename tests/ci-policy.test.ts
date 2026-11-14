import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  CI_RESULT_FAILURE,
  CONCURRENCY,
  expectedAuditJob,
  expectedPrivacyScanJob,
  DISABLED_NOTICE,
  FINAL_GIT_CHECK,
  FORK_REFUSAL,
  PRISTINE_COMPARISON,
  PRISTINE_EXPORT,
  HOSTED,
  JOB_CONDITIONS,
  LABELS,
  PR_CONDITIONS,
  PRIVACY_CONDITIONS,
  PRIVACY_ENV,
  PRIVACY_FORK_NOTICE,
  RUNNER_ACCEPTANCE_GUARD,
  stepRuns,
  validateRunnerAcceptance,
  validateWorkflow,
  type AcceptanceWorkflow,
  type Step,
  type Workflow,
} from "./helpers/ci-policy.js";

function workflow(): Workflow {
  return JSON.parse(
    readFileSync(".github/workflows/ci.yml", "utf8"),
  ) as Workflow;
}
function steps(fixture: Workflow, job: string): Step[] {
  const found = fixture.jobs[job]?.steps;
  if (!found) throw new Error(`Missing job ${job}`);
  return found;
}
function find(fixture: Workflow, job: string, run: string): Step {
  const step = steps(fixture, job).find((entry) => entry.run === run);
  if (!step) throw new Error(`Missing step ${run}`);
  return step;
}

it("BR-015 v3 validates the real CI policy with main and PR Sonar jobs", () => {
  expect(() => {
    validateWorkflow(workflow());
  }).not.toThrow();
});

it.each(["skip", "write", "tag", "unpin", "token", "sonar-pr"])(
  "BR-015 v3 rejects unsafe CI fixture %s",
  (mutation) => {
    const fixture = workflow();
    const lint = fixture.jobs.lint;
    const sonar = fixture.jobs.sonar;
    if (!lint || !sonar) throw new Error("Missing required jobs");
    if (mutation === "skip") lint.if = "false";
    if (mutation === "write") fixture.permissions.contents = "write";
    if (mutation === "tag") fixture.on.push = { branches: ["main", "tags/*"] };
    if (mutation === "unpin")
      lint.steps.unshift({ uses: "actions/checkout@main" });
    if (mutation === "token")
      lint.steps.push({
        run: "make lint",
        env: { SONAR_TOKEN: "synthetic-never-a-secret" },
      });
    if (mutation === "sonar-pr")
      sonar.if = "github.event_name == 'pull_request'";
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("BR-015 v7 BR-183 v3 accepts the real workflow with the changes-gated image job on hosted runners", () => {
  const image = workflow().jobs.image;
  expect(image).toEqual({
    "runs-on": "ubuntu-24.04",
    needs: ["changes"],
    if: "needs.changes.outputs.image != 'false'",
    permissions: { contents: "read" },
    "timeout-minutes": 30,
    strategy: {
      "fail-fast": false,
      matrix: { platform: ["linux/amd64", "linux/arm64"] },
    },
    steps: [
      {
        uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        with: { "persist-credentials": false },
      },
      ...["make image-binfmt", "make image", "make image-smoke"].map((run) => ({
        run,
        env: { IMAGE_PLATFORMS: "${{ matrix.platform }}" },
      })),
    ],
  });
  expect(() => {
    validateWorkflow(workflow());
  }).not.toThrow();
});

const imageMutations: Record<string, (fixture: Workflow) => void> = {
  "image without its if": (fixture) => {
    if (fixture.jobs.image) delete fixture.jobs.image.if;
  },
  "image without needs changes": (fixture) => {
    if (fixture.jobs.image) delete fixture.jobs.image.needs;
  },
  if: (fixture) => {
    if (fixture.jobs.image)
      fixture.jobs.image.if = "github.event_name == 'push'";
  },
  needs: (fixture) => {
    if (fixture.jobs.image) fixture.jobs.image.needs = ["lint"];
  },
  "job env": (fixture) => {
    if (fixture.jobs.image)
      fixture.jobs.image.env = { IMAGE_PLATFORMS: "linux/amd64" };
  },
  "secrets reference": (fixture) => {
    const step = find(fixture, "image", "make image");
    step.env = { ...step.env, TOKEN: "${{ secrets.GITHUB_TOKEN }}" };
  },
  "missing timeout-minutes": (fixture) => {
    if (fixture.jobs.image) delete fixture.jobs.image["timeout-minutes"];
  },
  "write permission": (fixture) => {
    if (fixture.jobs.image)
      fixture.jobs.image.permissions = { contents: "write" };
  },
  "third matrix entry": (fixture) => {
    fixture.jobs.image?.strategy?.matrix.platform.push("linux/s390x");
  },
  "fail-fast": (fixture) => {
    const strategy = fixture.jobs.image?.strategy;
    if (strategy) strategy["fail-fast"] = true;
  },
  "setup-qemu action": (fixture) => {
    steps(fixture, "image").splice(1, 0, {
      uses: "docker/setup-qemu-action@29109295f81e9208d7d86ff1c6c12d2833863392",
    });
  },
  "make image in a gate job": (fixture) => {
    steps(fixture, "build").push({ run: "make image" });
  },
  "make image --push": (fixture) => {
    find(fixture, "image", "make image").run = "make image --push";
  },
  "missing step env": (fixture) => {
    delete find(fixture, "image", "make image-smoke").env;
  },
  "reordered steps": (fixture) => {
    const list = steps(fixture, "image");
    list.push(list.splice(1, 1)[0] as Step);
  },
  "other runner": (fixture) => {
    if (fixture.jobs.image) fixture.jobs.image["runs-on"] = "ubuntu-latest";
  },
  "image targets in another job": (fixture) => {
    fixture.jobs.extra = {
      "runs-on": "ubuntu-24.04",
      steps: [{ run: "make image-smoke" }],
    };
  },
};
it.each(Object.keys(imageMutations))(
  "BR-015 v5 BR-183 v2 rejects image job mutation: %s",
  (name) => {
    const fixture = workflow();
    imageMutations[name]?.(fixture);
    expect(fixture).not.toEqual(workflow());
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("BR-015 v3 gives the main analysis exactly enablement, host, token and pristine archive", () => {
  expect(find(workflow(), "sonar", "make sonar").env).toEqual({
    SONAR_ENABLED: "${{ vars.SONAR_ENABLED }}",
    SONAR_HOST_URL: "${{ secrets.SONAR_HOST_URL }}",
    SONAR_TOKEN: "${{ secrets.SONAR_TOKEN }}",
    SONAR_PRISTINE_TAR: "${{ runner.temp }}/pristine.tar",
  });
});

it.each([
  "SONAR_SERVER_VERSION",
  "SONAR_COMPATIBILITY_EVIDENCE",
  "SONAR_TOKEN_FILE",
  "SONAR_HOST_URL_FILE",
])("BR-015 v3 rejects unsupported CI scanner configuration %s", (name) => {
  for (const [job, run] of [
    ["sonar", "make sonar"],
    ["sonar-pr", "make sonar-pr"],
  ] as const) {
    const fixture = workflow();
    const step = find(fixture, job, run);
    step.env = { ...step.env, [name]: "/synthetic/configuration" };
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  }
});

it("BR-015 v3 rejects a trusted-main condition that admits another repository", () => {
  const fixture = workflow();
  const sonar = fixture.jobs.sonar;
  if (!sonar?.if) throw new Error("Missing analysis condition");
  sonar.if = sonar.if.replace(
    "github.repository == 'sstolz/kdrive-mcp-server'",
    "github.repository != 'sstolz/kdrive-mcp-server'",
  );
  expect(() => {
    validateWorkflow(fixture);
  }).toThrow();
});

const mutations: Record<string, (fixture: Workflow) => void> = {
  "pull_request_target trigger": (fixture) => {
    fixture.on.pull_request_target = { branches: ["main"] };
  },
  "SONAR_TOKEN in the PR job": (fixture) => {
    const step = find(fixture, "sonar-pr", "make sonar-pr");
    step.env = { ...step.env, SONAR_TOKEN: "${{ secrets.SONAR_TOKEN }}" };
  },
  "SONAR_PR_TOKEN in the main job": (fixture) => {
    const step = find(fixture, "sonar", "make sonar");
    step.env = { ...step.env, SONAR_TOKEN: "${{ secrets.SONAR_PR_TOKEN }}" };
  },
  "secret in job env": (fixture) => {
    const job = fixture.jobs["sonar-pr"];
    if (job) job.env = { HOST: "${{ secrets.SONAR_HOST_URL }}" };
  },
  "secret in workflow env": (fixture) => {
    fixture.env = { HOST: "${{ secrets.SONAR_HOST_URL }}" };
  },
  "secret given to make setup": (fixture) => {
    const step = find(fixture, "sonar-pr", "make setup");
    step.env = { SONAR_TOKEN: "${{ secrets.SONAR_PR_TOKEN }}" };
  },
  "fork refusal removed": (fixture) => {
    const job = fixture.jobs["sonar-pr"];
    if (job) job.steps = job.steps.filter((step) => step.run !== FORK_REFUSAL);
  },
  "needs entry dropped": (fixture) => {
    const job = fixture.jobs["sonar-pr"];
    if (job) job.needs = ["lint", "format", "typecheck", "test"];
  },
  "cancel-in-progress": (fixture) => {
    const job = fixture.jobs["sonar-pr"];
    if (job?.concurrency) job.concurrency["cancel-in-progress"] = true;
  },
  "same-repository condition removed": (fixture) => {
    const step = find(fixture, "sonar-pr", "make sonar-pr");
    step.if = "vars.SONAR_ENABLED == 'true'";
  },
  "pristine export removed (main)": (fixture) => {
    const job = fixture.jobs.sonar;
    if (job)
      job.steps = job.steps.filter((step) => step.run !== PRISTINE_EXPORT);
  },
  "pristine export after setup (PR)": (fixture) => {
    const list = steps(fixture, "sonar-pr");
    const exportIndex = list.findIndex((step) => step.run === PRISTINE_EXPORT);
    const [exported] = list.splice(exportIndex, 1);
    const setupIndex = list.findIndex((step) => step.run === "make setup");
    if (exported) list.splice(setupIndex + 1, 0, exported);
  },
  "comparison removed (PR)": (fixture) => {
    const job = fixture.jobs["sonar-pr"];
    if (job)
      job.steps = job.steps.filter((step) => step.run !== PRISTINE_COMPARISON);
  },
  "comparison after analysis (main)": (fixture) => {
    const list = steps(fixture, "sonar");
    const index = list.findIndex((step) => step.run === PRISTINE_COMPARISON);
    const [moved] = list.splice(index, 1);
    if (moved) list.push(moved);
  },
  "constant runs a working-tree file": (fixture) => {
    find(fixture, "sonar-pr", PRISTINE_COMPARISON).run =
      "sh scripts/compare.sh";
  },
  "constant text changed": (fixture) => {
    find(fixture, "sonar", PRISTINE_EXPORT).run = PRISTINE_EXPORT.replace(
      '"$GITHUB_SHA"',
      "HEAD",
    );
  },
  "env on a BR-151 step": (fixture) => {
    find(fixture, "sonar", PRISTINE_COMPARISON).env = { LANG: "C" };
  },
  "SONAR_PRISTINE_TAR dropped": (fixture) => {
    const step = find(fixture, "sonar-pr", "make sonar-pr");
    const env = { ...step.env };
    delete env.SONAR_PRISTINE_TAR;
    step.env = env;
  },
  "head repository interpolated into run": (fixture) => {
    find(fixture, "sonar-pr", FORK_REFUSAL).run =
      "echo ${{ github.event.pull_request.head.repo.full_name }}\nexit 1";
  },
  "fork condition weakened": (fixture) => {
    find(fixture, "sonar-pr", FORK_REFUSAL).if = "false";
  },
  "extra job": (fixture) => {
    fixture.jobs.extra = { steps: [{ run: "make lint" }] };
  },
  // BR-015 v3 / BR-151 v2 (AC-09 v3 mutations).
  "final Git-metadata step removed (main)": (fixture) => {
    const job = fixture.jobs.sonar;
    if (job)
      job.steps = job.steps.filter((step) => step.run !== FINAL_GIT_CHECK);
  },
  "final Git-metadata step before the analysis (PR)": (fixture) => {
    const list = steps(fixture, "sonar-pr");
    const index = list.findIndex((step) => step.run === FINAL_GIT_CHECK);
    const [moved] = list.splice(index, 1);
    if (moved) list.splice(list.length - 1, 0, moved);
  },
  "final Git-metadata step without always() (main)": (fixture) => {
    const step = find(fixture, "sonar", FINAL_GIT_CHECK);
    delete step.if;
  },
  "final Git-metadata step with another condition (PR)": (fixture) => {
    find(fixture, "sonar-pr", FINAL_GIT_CHECK).if = "failure()";
  },
  "final Git-metadata step with a combined condition (main)": (fixture) => {
    find(fixture, "sonar", FINAL_GIT_CHECK).if =
      "always() && vars.SONAR_ENABLED == 'true'";
  },
  "env on the final Git-metadata step": (fixture) => {
    find(fixture, "sonar-pr", FINAL_GIT_CHECK).env = { LANG: "C" };
  },
  "SONAR_TOKEN as a gate checkout token": (fixture) => {
    const checkout = fixture.jobs.lint?.steps[0];
    if (checkout?.with) checkout.with.token = "${{ secrets.SONAR_TOKEN }}";
  },
  "bracket secret syntax in a gate condition": (fixture) => {
    const step = fixture.jobs.lint?.steps[1];
    if (step) step.if = "secrets['SONAR_TOKEN'] != ''";
  },
  "toJSON(secrets) in a setup env": (fixture) => {
    find(fixture, "sonar", "make setup").env = {
      ALL: "${{ toJSON(secrets) }}",
    };
  },
  "upper-case SECRETS in a gate job env": (fixture) => {
    const job = fixture.jobs.test;
    if (job) job.env = { HOST: "${{ SECRETS.SONAR_TOKEN }}" };
  },
  "a secrets key on a job": (fixture) => {
    const job = fixture.jobs.build as unknown as Record<string, unknown>;
    job.secrets = "inherit";
  },
};
it.each(Object.keys(mutations))(
  "BR-149 rejects unsafe PR gate fixture %s",
  (name) => {
    const fixture = workflow();
    mutations[name]?.(fixture);
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("BR-149 v3 PR gate runs only for same-repository pull requests, after changes and the gates, serialized, on hosted runners", () => {
  const job = workflow().jobs["sonar-pr"];
  expect(job?.if).toBe(
    "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && needs.changes.outputs.heavy != 'false'",
  );
  expect(job?.["runs-on"]).toBe("ubuntu-24.04");
  expect(job?.needs).toEqual([
    "changes",
    "lint",
    "format",
    "typecheck",
    "test",
    "build",
  ]);
  expect(job?.["timeout-minutes"]).toBe(15);
  expect(job?.concurrency).toEqual({
    group: "sonar-kdrive-mcp-server-pr",
    "cancel-in-progress": false,
  });
  expect(find(workflow(), "sonar-pr", "make sonar-pr").env).toEqual({
    SONAR_ENABLED: "${{ vars.SONAR_ENABLED }}",
    SONAR_HOST_URL: "${{ secrets.SONAR_HOST_URL }}",
    SONAR_TOKEN: "${{ secrets.SONAR_PR_TOKEN }}",
    SONAR_PRISTINE_TAR: "${{ runner.temp }}/pristine.tar",
    SONAR_PR_HEAD_REPOSITORY:
      "${{ github.event.pull_request.head.repo.full_name }}",
  });
});

function executed(context: {
  headRepository: string;
  sonarEnabled: string;
}): Step[] {
  return steps(workflow(), "sonar-pr").filter((step) =>
    stepRuns(step.if, {
      ...context,
      repository: "sstolz/kdrive-mcp-server",
    }),
  );
}
function runs(list: Step[]): string[] {
  return list.flatMap((step) => (step.run ? [step.run] : []));
}
it.each(["fork/kdrive-mcp-server", ""])(
  "BR-149 fork runs execute only the secret-free refusal run step (head %j)",
  (headRepository) => {
    for (const sonarEnabled of ["true", ""]) {
      const list = executed({ headRepository, sonarEnabled });
      // BR-151 v2: the final step always runs and exits 0 without an export.
      expect(runs(list)).toEqual([FORK_REFUSAL, FINAL_GIT_CHECK]);
      for (const step of list)
        expect(JSON.stringify(step)).not.toContain("secrets.");
    }
  },
);
it("BR-149 same-repository runs analyse only when enabled", () => {
  const head = "sstolz/kdrive-mcp-server";
  expect(runs(executed({ headRepository: head, sonarEnabled: "" }))).toEqual([
    DISABLED_NOTICE,
    FINAL_GIT_CHECK,
  ]);
  expect(
    runs(executed({ headRepository: head, sonarEnabled: "true" })),
  ).toEqual([
    PRISTINE_EXPORT,
    "make setup",
    PRISTINE_COMPARISON,
    "make sonar-pr",
    FINAL_GIT_CHECK,
  ]);
  expect(PR_CONDITIONS.enabled).toContain("vars.SONAR_ENABLED == 'true'");
});

// AC-18: run the two BR-151 constants with bash -eo pipefail, as GitHub does.
function bash(script: string, cwd: string, env: Record<string, string>) {
  return spawnSync("bash", ["-eo", "pipefail", "-c", script], {
    cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    encoding: "utf8",
  });
}
function repository() {
  const root = mkdtempSync(join(tmpdir(), "pristine-repo-"));
  const runner = mkdtempSync(join(tmpdir(), "pristine-runner-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Synthetic Fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "Makefile"), "all:\n\ttrue\n");
  writeFileSync(join(root, "scripts/sonar-entry.sh"), "#!/bin/sh\nexit 0\n");
  writeFileSync(
    join(root, ".gitignore"),
    "node_modules/\n.env\ncompose.override.yaml\n.config/\n",
  );
  git("add", ".");
  git("commit", "-q", "-m", "fixture");
  const env = { RUNNER_TEMP: runner, GITHUB_SHA: git("rev-parse", "HEAD") };
  return { root, runner, git, env };
}
type Tamper = (root: string, git: (...args: string[]) => string) => void;
const tampering: Record<string, Tamper> = {
  "a modified tracked file": (root) => {
    writeFileSync(join(root, "Makefile"), "all:\n\tfalse\n");
  },
  "a staged file": (root, git) => {
    writeFileSync(join(root, "staged.txt"), "x\n");
    git("add", "staged.txt");
  },
  "an untracked file": (root) => {
    writeFileSync(join(root, "untracked.txt"), "x\n");
  },
  "an ignored compose.override.yaml": (root) => {
    writeFileSync(join(root, "compose.override.yaml"), "services: {}\n");
  },
  "an ignored .env": (root) => {
    writeFileSync(join(root, ".env"), "COMPOSE_FILE=other.yaml\n");
  },
  "an ignored .config/sonar-host-url": (root) => {
    mkdirSync(join(root, ".config"));
    writeFileSync(join(root, ".config/sonar-host-url"), "x\n");
  },
  "a Makefile committed with git commit -a": (root, git) => {
    writeFileSync(join(root, "Makefile"), "all:\n\tfalse\n");
    git("commit", "-q", "-a", "-m", "tamper");
  },
  "a skip-worktree entry script": (root, git) => {
    git("update-index", "--skip-worktree", "scripts/sonar-entry.sh");
    writeFileSync(join(root, "scripts/sonar-entry.sh"), "#!/bin/sh\nexit 1\n");
  },
  "an excluded GNUmakefile": (root) => {
    writeFileSync(join(root, ".git/info/exclude"), "GNUmakefile\n");
    writeFileSync(join(root, "GNUmakefile"), "all:\n\tfalse\n");
  },
  "a non-empty node_modules": (root) => {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules/x"), "x\n");
  },
  "a node_modules symlink": (root) => {
    mkdirSync(join(root, "elsewhere"));
    symlinkSync("elsewhere", join(root, "node_modules"));
  },
  "a nested scripts/node_modules/x": (root) => {
    mkdirSync(join(root, "scripts/node_modules"));
    writeFileSync(join(root, "scripts/node_modules/x"), "x\n");
  },
  "a nested scripts/.git/x": (root) => {
    mkdirSync(join(root, "scripts/.git"));
    writeFileSync(join(root, "scripts/.git/x"), "x\n");
  },
};
it.each([false, true])(
  "BR-151 pristine comparison accepts an unchanged checkout (empty node_modules: %s)",
  (mountPoint) => {
    const f = repository();
    const exported = bash(PRISTINE_EXPORT, f.root, f.env);
    expect(exported.status, exported.stderr).toBe(0);
    if (mountPoint) mkdirSync(join(f.root, "node_modules"));
    const compared = bash(PRISTINE_COMPARISON, f.root, f.env);
    expect(compared.status, compared.stderr).toBe(0);
  },
);
it.each(Object.keys(tampering))(
  "BR-151 pristine comparison rejects %s",
  (name) => {
    const f = repository();
    expect(bash(PRISTINE_EXPORT, f.root, f.env).status).toBe(0);
    tampering[name]?.(f.root, f.git);
    const compared = bash(PRISTINE_COMPARISON, f.root, f.env);
    expect(compared.status).not.toBe(0);
    expect(compared.stdout + compared.stderr).not.toContain(f.runner);
    expect(compared.stdout + compared.stderr).not.toContain(f.env.GITHUB_SHA);
  },
);
it("BR-151 pristine export rejects HEAD different from GITHUB_SHA", () => {
  const f = repository();
  const result = bash(PRISTINE_EXPORT, f.root, {
    ...f.env,
    GITHUB_SHA: "b".repeat(40),
  });
  expect(result.status).not.toBe(0);
});

// AC-21: the BR-151 v2 Git-metadata save, comparison and final step.
const gitTampering: Record<string, (root: string) => void> = {
  "a core.fsmonitor setting": (root) => {
    execFileSync("git", ["config", "core.fsmonitor", "touch /tmp/owned"], {
      cwd: root,
    });
  },
  "a post-checkout hook": (root) => {
    writeFileSync(join(root, ".git/hooks/post-checkout"), "#!/bin/sh\n", {
      mode: 0o755,
    });
  },
  "an info/attributes file": (root) => {
    writeFileSync(join(root, ".git/info/attributes"), "* filter=x\n");
  },
  "a symlinked .git/config": (root) => {
    const config = readFileSync(join(root, ".git/config"));
    writeFileSync(join(root, "elsewhere-config"), config);
    rmSync(join(root, ".git/config"));
    symlinkSync("../elsewhere-config", join(root, ".git/config"));
  },
  "a symlinked .git/hooks directory": (root) => {
    mkdirSync(join(root, "elsewhere-hooks"));
    rmSync(join(root, ".git/hooks"), { recursive: true });
    symlinkSync("../elsewhere-hooks", join(root, ".git/hooks"));
  },
  "a .git/commondir file": (root) => {
    writeFileSync(join(root, ".git/commondir"), "../other\n");
  },
  "a .git/modules directory": (root) => {
    mkdirSync(join(root, ".git/modules"));
  },
  "a symlinked .git": (root) => {
    execFileSync("mv", [join(root, ".git"), join(root, "real-git")]);
    symlinkSync("real-git", join(root, ".git"));
  },
};
function infoRemoved() {
  const f = repository();
  rmSync(join(f.root, ".git/info"), { recursive: true });
  return f;
}
function quiet(
  result: { stdout: string; stderr: string },
  f: {
    runner: string;
    env: { GITHUB_SHA: string };
  },
) {
  expect(result.stdout + result.stderr).not.toContain(f.runner);
  expect(result.stdout + result.stderr).not.toContain(f.env.GITHUB_SHA);
}
it("BR-151 v2 export, comparison and final step accept an unchanged checkout", () => {
  for (const f of [repository(), infoRemoved()]) {
    for (const script of [
      PRISTINE_EXPORT,
      PRISTINE_COMPARISON,
      FINAL_GIT_CHECK,
    ]) {
      const result = bash(script, f.root, f.env);
      expect(result.status, result.stderr).toBe(0);
    }
    expect(lstatSync(join(f.root, ".git")).isDirectory()).toBe(true);
  }
});
const metadataCases: [
  string,
  () => ReturnType<typeof repository>,
  (root: string) => void,
][] = [
  ...Object.entries(gitTampering).map(
    ([name, tamper]) =>
      [name, repository, tamper] as [
        string,
        () => ReturnType<typeof repository>,
        (root: string) => void,
      ],
  ),
  [
    "an info directory created after an export without one",
    infoRemoved,
    (root) => {
      mkdirSync(join(root, ".git/info"));
    },
  ],
];
it.each(metadataCases.map(([name]) => name))(
  "BR-151 v2 Git metadata check rejects %s",
  (name) => {
    const [, make, tamper] = metadataCases.find(([entry]) => entry === name)!;
    const f = make();
    expect(bash(PRISTINE_EXPORT, f.root, f.env).status).toBe(0);
    tamper(f.root);
    const compared = bash(PRISTINE_COMPARISON, f.root, f.env);
    expect(compared.status).not.toBe(0);
    quiet(compared, f);
  },
);
it.each(metadataCases.map(([name]) => name))(
  "BR-151 v2 final step quarantines .git after %s",
  (name) => {
    const [, make, tamper] = metadataCases.find(([entry]) => entry === name)!;
    const f = make();
    expect(bash(PRISTINE_EXPORT, f.root, f.env).status).toBe(0);
    tamper(f.root);
    const final = bash(FINAL_GIT_CHECK, f.root, f.env);
    expect(final.status).not.toBe(0);
    quiet(final, f);
    expect(() => lstatSync(join(f.root, ".git"))).toThrow();
    expect(lstatSync(join(f.root, ".git.quarantine"))).toBeDefined();
  },
);
it("BR-151 v2 final step falls back when .git.quarantine is occupied", () => {
  const f = repository();
  expect(bash(PRISTINE_EXPORT, f.root, f.env).status).toBe(0);
  gitTampering["a core.fsmonitor setting"]?.(f.root);
  mkdirSync(join(f.root, ".git.quarantine"));
  writeFileSync(join(f.root, ".git.quarantine/x"), "x\n");
  const final = bash(FINAL_GIT_CHECK, f.root, f.env);
  expect(final.status).not.toBe(0);
  expect(() => lstatSync(join(f.root, ".git"))).toThrow();
  expect(existsSync(join(f.root, ".git.quarantine/x"))).toBe(true);
  expect(lstatSync(join(f.runner, "git-quarantine")).isDirectory()).toBe(true);
});
it("BR-151 v2 final step passes without an export", () => {
  const f = repository();
  gitTampering["a core.fsmonitor setting"]?.(f.root);
  const final = bash(FINAL_GIT_CHECK, f.root, f.env);
  expect(final.status, final.stderr).toBe(0);
  expect(lstatSync(join(f.root, ".git")).isDirectory()).toBe(true);
});
// BR-151 v3 (AC-21): the pinned checkout leaves an inert .git/config.worktree
// (git sparse-checkout disable, then extensions.worktreeConfig unset). It is
// written directly: git config --worktree targets .git/config while the
// extension is unset.
const WORKTREE_CONFIG =
  "[core]\n\tsparseCheckout = false\n\tsparseCheckoutCone = false\n[index]\n\tsparse = false\n";
function withWorktreeConfig() {
  const f = repository();
  writeFileSync(join(f.root, ".git/config.worktree"), WORKTREE_CONFIG);
  return f;
}
it("BR-151 v3 export, comparison and final step accept an unchanged config.worktree", () => {
  const f = withWorktreeConfig();
  for (const script of [
    PRISTINE_EXPORT,
    PRISTINE_COMPARISON,
    FINAL_GIT_CHECK,
  ]) {
    const result = bash(script, f.root, f.env);
    expect(result.status, result.stderr).toBe(0);
  }
  expect(lstatSync(join(f.root, ".git")).isDirectory()).toBe(true);
  expect(
    readFileSync(join(f.runner, "git-meta/config.worktree")).equals(
      readFileSync(join(f.root, ".git/config.worktree")),
    ),
  ).toBe(true);
});
const worktreeCases: [
  string,
  () => ReturnType<typeof repository>,
  (root: string) => void,
][] = [
  [
    "created after an export without one",
    repository,
    (root) => {
      writeFileSync(join(root, ".git/config.worktree"), WORKTREE_CONFIG);
    },
  ],
  [
    "modified with core.fsmonitor",
    withWorktreeConfig,
    (root) => {
      writeFileSync(
        join(root, ".git/config.worktree"),
        WORKTREE_CONFIG + "[core]\n\tfsmonitor = touch /tmp/owned\n",
      );
    },
  ],
  [
    "replaced by a symlink",
    withWorktreeConfig,
    (root) => {
      writeFileSync(join(root, "elsewhere-worktree"), WORKTREE_CONFIG);
      rmSync(join(root, ".git/config.worktree"));
      symlinkSync("../elsewhere-worktree", join(root, ".git/config.worktree"));
    },
  ],
  [
    "removed",
    withWorktreeConfig,
    (root) => {
      rmSync(join(root, ".git/config.worktree"));
    },
  ],
];
it.each(worktreeCases.map(([name]) => name))(
  "BR-151 v3 Git metadata check rejects config.worktree %s",
  (name) => {
    const [, make, tamper] = worktreeCases.find(([entry]) => entry === name)!;
    const f = make();
    expect(bash(PRISTINE_EXPORT, f.root, f.env).status).toBe(0);
    tamper(f.root);
    const compared = bash(PRISTINE_COMPARISON, f.root, f.env);
    expect(compared.status).not.toBe(0);
    quiet(compared, f);
  },
);
it.each(worktreeCases.map(([name]) => name))(
  "BR-151 v3 final step quarantines .git after config.worktree %s",
  (name) => {
    const [, make, tamper] = worktreeCases.find(([entry]) => entry === name)!;
    const f = make();
    expect(bash(PRISTINE_EXPORT, f.root, f.env).status).toBe(0);
    tamper(f.root);
    const final = bash(FINAL_GIT_CHECK, f.root, f.env);
    expect(final.status).not.toBe(0);
    quiet(final, f);
    expect(() => lstatSync(join(f.root, ".git"))).toThrow();
    expect(lstatSync(join(f.root, ".git.quarantine"))).toBeDefined();
  },
);
it.each(["commondir", "modules"])(
  "BR-151 v3 export rejects unsupported Git metadata %s",
  (name) => {
    const f = repository();
    if (name === "modules") mkdirSync(join(f.root, ".git/modules"));
    else writeFileSync(join(f.root, ".git/commondir"), "../other\n");
    expect(bash(PRISTINE_EXPORT, f.root, f.env).status).not.toBe(0);
  },
);
it("BR-151 v2 final step invokes no git command", () => {
  expect(FINAL_GIT_CHECK).not.toMatch(/(^|[\s;&|(])git(\s|$)/mu);
  expect(FINAL_GIT_CHECK).toContain("mv -T -- .git .git.quarantine");
  expect(FINAL_GIT_CHECK).not.toMatch(/\brm\b/u);
});

// F-015: the self-hosted runner policy (BR-015 v5, BR-149 v2, BR-183 v2,
// BR-225, BR-227, BR-228).
function job(fixture: Workflow, name: string) {
  const found = fixture.jobs[name];
  if (!found) throw new Error(`Missing job ${name}`);
  return found;
}

it("BR-015 v7 BR-225 v3 accepts the real workflow on hosted runners", () => {
  const fixture = workflow();
  expect(Object.keys(fixture.jobs).sort()).toEqual([
    "audit",
    "build",
    "changes",
    "ci-result",
    "fork-refusal",
    "format",
    "image",
    "lint",
    "privacy-scan",
    "sonar",
    "sonar-pr",
    "test",
    "typecheck",
  ]);
  const timeouts: Record<string, number> = {};
  for (const [name, entry] of Object.entries(fixture.jobs)) {
    timeouts[name] = entry["timeout-minutes"] ?? 0;
    expect(entry["runs-on"]).toBe("ubuntu-24.04");
  }
  expect(timeouts).toEqual({
    changes: 5,
    lint: 20,
    format: 20,
    typecheck: 20,
    test: 20,
    build: 20,
    image: 30,
    audit: 20,
    sonar: 15,
    "sonar-pr": 15,
    "ci-result": 5,
    "fork-refusal": 5,
    "privacy-scan": 20,
  });
  expect(HOSTED).toBe("ubuntu-24.04");
  expect(JSON.stringify(fixture)).not.toContain("self-hosted");
  expect(() => {
    validateWorkflow(fixture);
  }).not.toThrow();
});

it("BR-015 v7 counts exactly eleven admitted non-Make run texts", () => {
  const admitted = [
    PRISTINE_EXPORT,
    PRISTINE_COMPARISON,
    FINAL_GIT_CHECK,
    FORK_REFUSAL,
    DISABLED_NOTICE,
    CI_RESULT_FAILURE,
    PRIVACY_FORK_NOTICE,
  ];
  const count = Object.values(workflow().jobs)
    .flatMap((entry) => entry.steps)
    .filter(
      (step) => step.run !== undefined && admitted.includes(step.run),
    ).length;
  expect(count).toBe(11);
});

const runnerMutations: Record<string, (fixture: Workflow) => void> = {
  "a gate job on the label array": (fixture) => {
    job(fixture, "lint")["runs-on"] = [...LABELS];
  },
  "ci-result on the label array": (fixture) => {
    job(fixture, "ci-result")["runs-on"] = [...LABELS];
  },
  "fork-refusal on the self-hosted labels": (fixture) => {
    job(fixture, "fork-refusal")["runs-on"] = [...LABELS];
  },
  "another hosted image": (fixture) => {
    job(fixture, "test")["runs-on"] = "ubuntu-22.04";
  },
  "a hosted image in an array": (fixture) => {
    job(fixture, "test")["runs-on"] = ["ubuntu-24.04"];
  },
  "a different timeout-minutes": (fixture) => {
    job(fixture, "build")["timeout-minutes"] = 60;
  },
  "a missing timeout-minutes": (fixture) => {
    delete job(fixture, "changes")["timeout-minutes"];
  },
  "a paths filter": (fixture) => {
    fixture.on.pull_request = {
      branches: ["main"],
      paths: ["src/**"],
    } as unknown as { branches: string[] };
  },
  "a paths-ignore filter": (fixture) => {
    fixture.on.push = {
      branches: ["main"],
      "paths-ignore": ["runs/**"],
    } as unknown as { branches: string[] };
  },
  "make ci-changes in another job": (fixture) => {
    steps(fixture, "lint").push({ run: "make ci-changes" });
  },
  "the ci-result text in another job": (fixture) => {
    steps(fixture, "build").push({ run: CI_RESULT_FAILURE });
  },
  "the fork-refusal text in a gate job": (fixture) => {
    steps(fixture, "lint").push({ run: FORK_REFUSAL });
  },
};
it.each(Object.keys(runnerMutations))(
  "BR-015 v7 BR-225 v3 rejects runner mutation: %s",
  (name) => {
    const fixture = workflow();
    runnerMutations[name]?.(fixture);
    expect(fixture).not.toEqual(workflow());
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("BR-227 v3 the changes job classifies with a fork guard and no needs", () => {
  expect(job(workflow(), "changes")).toEqual({
    "runs-on": "ubuntu-24.04",
    if: "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
    "timeout-minutes": 5,
    outputs: {
      heavy: "${{ steps.classify.outputs.heavy }}",
      image: "${{ steps.classify.outputs.image }}",
    },
    steps: [
      {
        uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        with: { "fetch-depth": 2, "persist-credentials": false },
      },
      { id: "classify", run: "make ci-changes" },
    ],
  });
  for (const gate of ["lint", "format", "typecheck", "test", "build"]) {
    expect(job(workflow(), gate).needs).toEqual(["changes"]);
    expect(job(workflow(), gate).if).toBe(
      "needs.changes.outputs.heavy != 'false'",
    );
  }
});

it("BR-227 v3 ci-result needs every job but fork-refusal, privacy-scan included, and fails on any failure", () => {
  expect(job(workflow(), "ci-result")).toEqual({
    "runs-on": "ubuntu-24.04",
    needs: [
      "changes",
      "lint",
      "format",
      "typecheck",
      "test",
      "build",
      "image",
      "audit",
      "sonar",
      "sonar-pr",
      "privacy-scan",
    ],
    if: "always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)",
    "timeout-minutes": 5,
    steps: [
      {
        if: "needs.changes.result != 'success' || needs.privacy-scan.result != 'success' || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')",
        run: CI_RESULT_FAILURE,
      },
    ],
  });
  expect(CI_RESULT_FAILURE).toMatch(/>&2\nexit 1$/u);
});

it("BR-149 v2 fork-refusal is a hosted read-only refusal for fork PRs", () => {
  expect(job(workflow(), "fork-refusal")).toEqual({
    "runs-on": "ubuntu-24.04",
    if: "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository",
    permissions: { contents: "read" },
    "timeout-minutes": 5,
    steps: [{ run: FORK_REFUSAL }],
  });
});

const dependencyMutations: Record<string, (fixture: Workflow) => void> = {
  "changes without the fork guard": (fixture) => {
    job(fixture, "changes").if = "github.event_name != 'pull_request'";
  },
  "changes with needs": (fixture) => {
    job(fixture, "changes").needs = ["lint"];
  },
  "a gate job without needs changes": (fixture) => {
    delete job(fixture, "typecheck").needs;
  },
  "heavy == 'true' instead of != 'false'": (fixture) => {
    job(fixture, "test").if = "needs.changes.outputs.heavy == 'true'";
  },
  "image without its if": (fixture) => {
    delete job(fixture, "image").if;
  },
  "image with heavy instead of image": (fixture) => {
    job(fixture, "image").if = JOB_CONDITIONS.heavy;
  },
  "always() on a gate job": (fixture) => {
    job(fixture, "lint").if = `always() && ${JOB_CONDITIONS.heavy}`;
  },
  "always() on sonar-pr": (fixture) => {
    job(fixture, "sonar-pr").if = `always() && ${JOB_CONDITIONS.sonarPr}`;
  },
  "ci-result without the needs.changes.result term": (fixture) => {
    const step = steps(fixture, "ci-result")[0];
    if (step)
      step.if =
        "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')";
  },
  "ci-result without always()": (fixture) => {
    job(fixture, "ci-result").if = JOB_CONDITIONS.changes;
  },
  "ci-result without sonar-pr in needs": (fixture) => {
    const entry = job(fixture, "ci-result");
    entry.needs = (entry.needs ?? []).filter((name) => name !== "sonar-pr");
  },
  "ci-result needing fork-refusal": (fixture) => {
    job(fixture, "ci-result").needs?.push("fork-refusal");
  },
  "fork-refusal with a checkout": (fixture) => {
    steps(fixture, "fork-refusal").unshift({
      uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
      with: { "persist-credentials": false },
    });
  },
  "fork-refusal with write permission": (fixture) => {
    job(fixture, "fork-refusal").permissions = { contents: "write" };
  },
  "fork-refusal with needs": (fixture) => {
    job(fixture, "fork-refusal").needs = ["changes"];
  },
  "sonar-pr without the heavy term": (fixture) => {
    job(fixture, "sonar-pr").if =
      "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository";
  },
  "sonar-pr without needs changes": (fixture) => {
    job(fixture, "sonar-pr").needs = [
      "lint",
      "format",
      "typecheck",
      "test",
      "build",
    ];
  },
  "head repository in a gate job if": (fixture) => {
    job(fixture, "build").if =
      "needs.changes.outputs.heavy != 'false' && github.event.pull_request.head.repo.full_name == github.repository";
  },
  "head repository in a step env": (fixture) => {
    const step = find(fixture, "lint", "make lint");
    step.env = { HEAD: "${{ github.event.pull_request.head.repo.full_name }}" };
  },
};
it.each(Object.keys(dependencyMutations))(
  "BR-149 v2 BR-183 v2 BR-227 rejects job mutation: %s",
  (name) => {
    const fixture = workflow();
    dependencyMutations[name]?.(fixture);
    expect(fixture).not.toEqual(workflow());
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("BR-228 the top-level concurrency cancels superseded PR runs only", () => {
  const fixture = workflow();
  expect(fixture.concurrency).toEqual({
    group:
      "ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
    "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
  });
  expect(CONCURRENCY).toEqual(fixture.concurrency);
  expect(job(fixture, "sonar").concurrency).toEqual({
    group: "sonar-kdrive-mcp-server",
    "cancel-in-progress": false,
  });
  expect(job(fixture, "sonar-pr").concurrency).toEqual({
    group: "sonar-kdrive-mcp-server-pr",
    "cancel-in-progress": false,
  });
});

const concurrencyMutations: Record<string, (fixture: Workflow) => void> = {
  "cancel-in-progress: true": (fixture) => {
    if (fixture.concurrency) fixture.concurrency["cancel-in-progress"] = true;
  },
  "a group without the event split": (fixture) => {
    if (fixture.concurrency) fixture.concurrency.group = "ci-${{ github.ref }}";
  },
  "no top-level concurrency": (fixture) => {
    delete fixture.concurrency;
  },
  "sonar-pr job group changed": (fixture) => {
    const entry = job(fixture, "sonar-pr");
    entry.concurrency = { group: "ci", "cancel-in-progress": false };
  },
};
it.each(Object.keys(concurrencyMutations))(
  "BR-228 rejects concurrency mutation: %s",
  (name) => {
    const fixture = workflow();
    concurrencyMutations[name]?.(fixture);
    expect(fixture).not.toEqual(workflow());
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("TestBR320_audit_job BR-320 v3 audit job on hosted runners", () => {
  const fixture = workflow();
  expect(fixture.jobs.audit).toEqual(expectedAuditJob);
  expect(expectedAuditJob).toEqual({
    "runs-on": "ubuntu-24.04",
    needs: ["changes"],
    if: "needs.changes.outputs.heavy != 'false'",
    "timeout-minutes": 20,
    steps: [
      {
        uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        with: { "persist-credentials": false },
      },
      { run: "make setup" },
      { run: "make audit" },
      { run: "make install-check" },
    ],
  });
  expect(job(fixture, "ci-result").needs).toContain("audit");
  expect(job(fixture, "sonar").needs).toEqual([
    "lint",
    "format",
    "typecheck",
    "test",
    "build",
  ]);
  expect(job(fixture, "sonar-pr").needs).toEqual([
    "changes",
    "lint",
    "format",
    "typecheck",
    "test",
    "build",
  ]);
  expect(() => {
    validateWorkflow(fixture);
  }).not.toThrow();
});

const auditMutations: Record<string, (fixture: Workflow) => void> = {
  "audit removed": (fixture) => {
    delete fixture.jobs.audit;
  },
  "if changed": (fixture) => {
    job(fixture, "audit").if = "github.event_name == 'push'";
  },
  "if removed": (fixture) => {
    delete job(fixture, "audit").if;
  },
  "needs removed": (fixture) => {
    delete job(fixture, "audit").needs;
  },
  "persist-credentials removed": (fixture) => {
    delete steps(fixture, "audit")[0]?.with?.["persist-credentials"];
  },
  "make audit replaced": (fixture) => {
    find(fixture, "audit", "make audit").run = "make lint";
  },
  "make audit with a flag": (fixture) => {
    find(fixture, "audit", "make audit").run = "make audit ARGS=--omit=dev";
  },
  "make audit moved to another job": (fixture) => {
    const list = steps(fixture, "audit");
    list.splice(2, 1);
    job(fixture, "image").steps.push({ run: "make audit" });
  },
  "make install-check dropped": (fixture) => {
    steps(fixture, "audit").pop();
  },
  "make install-check with a flag": (fixture) => {
    find(fixture, "audit", "make install-check").run =
      "make install-check ARGS=--offline";
  },
  "make install-check moved to another job": (fixture) => {
    steps(fixture, "audit").pop();
    job(fixture, "image").steps.push({ run: "make install-check" });
  },
  "make install-check added to a gate job": (fixture) => {
    steps(fixture, "lint").push({ run: "make install-check" });
  },
  "make install-check before make audit": (fixture) => {
    const list = steps(fixture, "audit");
    const [audit, install] = list.splice(2, 2);
    if (audit && install) list.push(install, audit);
  },
  "make audit added to a gate job": (fixture) => {
    steps(fixture, "lint").push({ run: "make audit" });
  },
  "make audit in a new job": (fixture) => {
    fixture.jobs.extra = {
      "runs-on": LABELS,
      needs: ["changes"],
      "timeout-minutes": 20,
      steps: [{ run: "make audit" }],
    };
  },
  "audit dropped from ci-result needs": (fixture) => {
    const entry = job(fixture, "ci-result");
    entry.needs = (entry.needs ?? []).filter((name) => name !== "audit");
  },
  "audit added to sonar needs": (fixture) => {
    job(fixture, "sonar").needs?.push("audit");
  },
  "audit added to sonar-pr needs": (fixture) => {
    job(fixture, "sonar-pr").needs?.push("audit");
  },
  "another timeout": (fixture) => {
    job(fixture, "audit")["timeout-minutes"] = 30;
  },
  "step env with a secret": (fixture) => {
    find(fixture, "audit", "make audit").env = {
      NPM_TOKEN: "${{ secrets.NPM_TOKEN }}",
    };
  },
  "job permissions": (fixture) => {
    job(fixture, "audit").permissions = { contents: "read" };
  },
  "job env": (fixture) => {
    job(fixture, "audit").env = { NPM_CONFIG_AUDIT_LEVEL: "critical" };
  },
  "matrix strategy": (fixture) => {
    job(fixture, "audit").strategy = {
      "fail-fast": false,
      matrix: { platform: ["linux/amd64"] },
    };
  },
  "fifth step": (fixture) => {
    steps(fixture, "audit").push({ run: "make lint" });
  },
  "other runner": (fixture) => {
    job(fixture, "audit")["runs-on"] = [...LABELS];
  },
};
it.each(Object.keys(auditMutations))(
  "TestBR320_audit_job BR-015 v7 BR-320 v3 rejects audit mutation: %s",
  (name) => {
    const fixture = workflow();
    auditMutations[name]?.(fixture);
    expect(fixture).not.toEqual(workflow());
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

// ------------------------------------------------- F-023 BR-341, BR-350
it("BR-341 privacy-scan is a hosted, read-only, three-step job without needs, if or env", () => {
  const scan = job(workflow(), "privacy-scan");
  expect(scan).toEqual(expectedPrivacyScanJob);
  expect(scan).toEqual({
    "runs-on": "ubuntu-24.04",
    permissions: { contents: "read" },
    "timeout-minutes": 20,
    steps: [
      {
        if: "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository",
        run: PRIVACY_FORK_NOTICE,
      },
      {
        if: "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
        uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        with: { "fetch-depth": 0, "persist-credentials": false },
      },
      {
        if: "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
        run: "make privacy-scan",
        env: {
          PRIVACY_DENY_PATTERNS: "${{ secrets.PRIVACY_DENY_PATTERNS }}",
          PRIVACY_EVENT: "${{ github.event_name }}",
          PRIVACY_RANGE_BASE:
            "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
          PRIVACY_RANGE_HEAD:
            "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
          PRIVACY_PR_TITLE: "${{ github.event.pull_request.title }}",
          PRIVACY_PR_BODY: "${{ github.event.pull_request.body }}",
        },
      },
    ],
  });
  expect(PRIVACY_ENV.PRIVACY_DENY_PATTERNS).toBe(
    "${{ secrets.PRIVACY_DENY_PATTERNS }}",
  );
  // BR-342: the deny secret appears in exactly one place of the workflow.
  const text = JSON.stringify(workflow());
  expect(text.split("secrets.PRIVACY_DENY_PATTERNS")).toHaveLength(2);
  expect(JSON.stringify(scan)).not.toContain("secrets.SONAR");
  expect(() => {
    validateWorkflow(workflow());
  }).not.toThrow();
});

const privacyMutations: Record<string, (fixture: Workflow) => void> = {
  "one job on the label array": (fixture) => {
    job(fixture, "privacy-scan")["runs-on"] = [...LABELS];
  },
  "a gate on the label array": (fixture) => {
    job(fixture, "build")["runs-on"] = [...LABELS];
  },
  "privacy-scan with needs": (fixture) => {
    job(fixture, "privacy-scan").needs = ["changes"];
  },
  "privacy-scan with a job if": (fixture) => {
    job(fixture, "privacy-scan").if = JOB_CONDITIONS.heavy;
  },
  "privacy-scan with a job env": (fixture) => {
    job(fixture, "privacy-scan").env = { PRIVACY_EVENT: "push" };
  },
  "a make setup step in privacy-scan": (fixture) => {
    steps(fixture, "privacy-scan").splice(2, 0, {
      if: PRIVACY_CONDITIONS.scan,
      run: "make setup",
    });
  },
  "the deny secret in another step": (fixture) => {
    find(fixture, "lint", "make lint").env = {
      PRIVACY_DENY_PATTERNS: "${{ secrets.PRIVACY_DENY_PATTERNS }}",
    };
  },
  "the deny secret in a with": (fixture) => {
    const checkout = steps(fixture, "privacy-scan")[1];
    if (checkout?.with)
      checkout.with.token = "${{ secrets.PRIVACY_DENY_PATTERNS }}";
  },
  "the deny secret in the job env": (fixture) => {
    job(fixture, "privacy-scan").env = {
      PRIVACY_DENY_PATTERNS: "${{ secrets.PRIVACY_DENY_PATTERNS }}",
    };
  },
  "the deny secret in a Sonar analysis step": (fixture) => {
    const analysis = find(fixture, "sonar", "make sonar");
    analysis.env = {
      ...analysis.env,
      PRIVACY_DENY_PATTERNS: "${{ secrets.PRIVACY_DENY_PATTERNS }}",
    };
  },
  "a Sonar secret in privacy-scan": (fixture) => {
    const scan = find(fixture, "privacy-scan", "make privacy-scan");
    scan.env = { ...scan.env, SONAR_TOKEN: "${{ secrets.SONAR_TOKEN }}" };
  },
  "checkout without fetch-depth 0": (fixture) => {
    delete steps(fixture, "privacy-scan")[1]?.with?.["fetch-depth"];
  },
  "checkout with fetch-depth 1": (fixture) => {
    const checkout = steps(fixture, "privacy-scan")[1];
    if (checkout?.with) checkout.with["fetch-depth"] = 1;
  },
  "checkout persisting credentials": (fixture) => {
    const checkout = steps(fixture, "privacy-scan")[1];
    if (checkout?.with) checkout.with["persist-credentials"] = true;
  },
  "a scan step without the same-repository if": (fixture) => {
    delete find(fixture, "privacy-scan", "make privacy-scan").if;
  },
  "a scan env value changed": (fixture) => {
    const scan = find(fixture, "privacy-scan", "make privacy-scan");
    scan.env = { ...scan.env, PRIVACY_EVENT: "push" };
  },
  "a scan env value added": (fixture) => {
    const scan = find(fixture, "privacy-scan", "make privacy-scan");
    scan.env = { ...scan.env, PRIVACY_EXTRA: "${{ github.sha }}" };
  },
  "make privacy-scan in another job": (fixture) => {
    steps(fixture, "lint").push({ run: "make privacy-scan" });
  },
  "the fork notice in another job": (fixture) => {
    steps(fixture, "lint").push({ run: PRIVACY_FORK_NOTICE });
  },
  "another timeout": (fixture) => {
    job(fixture, "privacy-scan")["timeout-minutes"] = 30;
  },
  "write permission": (fixture) => {
    job(fixture, "privacy-scan").permissions = { contents: "write" };
  },
  "privacy-scan removed": (fixture) => {
    delete fixture.jobs["privacy-scan"];
  },
  "ci-result without privacy-scan": (fixture) => {
    const entry = job(fixture, "ci-result");
    entry.needs = (entry.needs ?? []).filter((name) => name !== "privacy-scan");
  },
  "ci-result step without the privacy-scan result": (fixture) => {
    const step = steps(fixture, "ci-result")[0];
    if (step)
      step.if =
        "needs.changes.result != 'success' || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')";
  },
};
it.each(Object.keys(privacyMutations))(
  "BR-341 BR-342 rejects privacy-scan mutation: %s",
  (name) => {
    const fixture = workflow();
    privacyMutations[name]?.(fixture);
    expect(fixture).not.toEqual(workflow());
    expect(() => {
      validateWorkflow(fixture);
    }).toThrow();
  },
);

it("BR-350 step 1 of privacy-scan prints the fork notice only for fork pull requests", () => {
  const [notice] = steps(workflow(), "privacy-scan");
  expect(notice).toEqual({
    if: PRIVACY_CONDITIONS.fork,
    run: PRIVACY_FORK_NOTICE,
  });
  expect(PRIVACY_FORK_NOTICE).toBe(
    "printf '%s\\n' 'privacy-scan: fork pull request; deny patterns are unavailable, no scan was run.'",
  );
  expect(PRIVACY_CONDITIONS.fork).toBe(
    "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository",
  );
  const result = spawnSync("bash", ["-c", PRIVACY_FORK_NOTICE], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    "privacy-scan: fork pull request; deny patterns are unavailable, no scan was run.\n",
  );
});

// ------------------------------------------------------------ BR-229 v2
function acceptance(): AcceptanceWorkflow {
  return JSON.parse(
    readFileSync(".github/workflows/runner-acceptance.yml", "utf8"),
  ) as AcceptanceWorkflow;
}
it("BR-229 v2 runner acceptance runs only on dispatch and never in this repository", () => {
  const fixture = acceptance();
  expect(Object.keys(fixture.on)).toEqual(["workflow_dispatch"]);
  for (const entry of Object.values(fixture.jobs))
    expect(entry.if).toBe("github.repository != 'sstolz/kdrive-mcp-server'");
  expect(RUNNER_ACCEPTANCE_GUARD).toBe(
    "github.repository != 'sstolz/kdrive-mcp-server'",
  );
  expect(() => {
    validateRunnerAcceptance(fixture);
  }).not.toThrow();
});
const acceptanceMutations: Record<
  string,
  (fixture: AcceptanceWorkflow) => void
> = {
  "a job without the guard": (fixture) => {
    const probe = fixture.jobs.probe;
    if (probe) delete probe.if;
  },
  "another guard": (fixture) => {
    const mark = fixture.jobs["reset-mark"];
    if (mark) mark.if = "github.repository == 'sstolz/kdrive-mcp-server'";
  },
  "a push trigger": (fixture) => {
    fixture.on.push = { branches: ["main"] };
  },
};
it.each(Object.keys(acceptanceMutations))(
  "BR-229 v2 rejects runner acceptance mutation: %s",
  (name) => {
    const fixture = acceptance();
    acceptanceMutations[name]?.(fixture);
    expect(() => {
      validateRunnerAcceptance(fixture);
    }).toThrow();
  },
);

export interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
}
export interface Job {
  "runs-on"?: string | string[];
  if?: string;
  needs?: string[];
  outputs?: Record<string, string>;
  steps: Step[];
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
  concurrency?: { group: string; "cancel-in-progress": boolean | string };
  strategy?: { "fail-fast": boolean; matrix: { platform: string[] } };
}
export interface Workflow {
  name: string;
  on: Record<string, { branches?: string[] } | null>;
  permissions: Record<string, string>;
  env?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean | string };
  jobs: Record<string, Job>;
}

const REPOSITORY = "sstolz/kdrive-mcp-server";
const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";

// BR-015 v3: the only admitted non-Make `run` texts (BR-151 v2 and BR-149).
// BR-151 v3: the Git-metadata check shared by the comparison and the final
// step. It invokes no git command, so a tampered config is never executed.
const GIT_METADATA_CHECK = [
  "git_metadata_ok() {",
  "  if test -L .git || ! test -d .git; then return 1; fi",
  "  for name in commondir modules; do",
  '    if test -e ".git/$name" || test -L ".git/$name"; then return 1; fi',
  "  done",
  "  for name in config config.worktree hooks info; do",
  '    saved="$RUNNER_TEMP/git-meta/$name"',
  '    if test -e "$saved" || test -L "$saved" || test -e ".git/$name" || test -L ".git/$name"; then',
  '      diff -r --no-dereference "$saved" ".git/$name" > /dev/null 2>&1 || return 1',
  "    fi",
  "  done",
  "}",
];
export const PRISTINE_EXPORT = [
  'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
  "if test -L .git || ! test -d .git; then printf '%s\\n' 'The .git entry must be a directory.' >&2; exit 1; fi",
  "for name in commondir modules; do",
  "  if test -e \".git/$name\" || test -L \".git/$name\"; then printf '%s\\n' 'Unsupported Git metadata exists.' >&2; exit 1; fi",
  "done",
  'rm -rf "$RUNNER_TEMP/pristine" "$RUNNER_TEMP/pristine.tar" "$RUNNER_TEMP/git-meta"',
  'mkdir "$RUNNER_TEMP/pristine"',
  'git archive --format=tar "$GITHUB_SHA" > "$RUNNER_TEMP/pristine.tar"',
  'tar -xf "$RUNNER_TEMP/pristine.tar" -C "$RUNNER_TEMP/pristine"',
  'mkdir "$RUNNER_TEMP/git-meta"',
  "for name in config config.worktree hooks info; do",
  '  if test -e ".git/$name" || test -L ".git/$name"; then cp -a ".git/$name" "$RUNNER_TEMP/git-meta/$name"; fi',
  "done",
].join("\n");
export const PRISTINE_COMPARISON = [
  "fail() { printf '%s\\n' \"$1\" >&2; exit 1; }",
  "if test -L node_modules; then fail 'node_modules must not be a symlink.'; fi",
  "if test -e node_modules; then",
  "  test -d node_modules || fail 'node_modules must be the empty mount point.'",
  "  test -z \"$(ls -A node_modules)\" || fail 'node_modules must be the empty mount point.'",
  "fi",
  "diff -r --no-dereference --exclude=.git --exclude=node_modules \"$RUNNER_TEMP/pristine\" . > /dev/null 2>&1 || fail 'The working tree differs from the pristine archive.'",
  "nested=$(find . -mindepth 2 \\( -name node_modules -o -name .git \\) -not -path './.git/*' -print -quit)",
  "test -z \"$nested\" || fail 'A nested node_modules or .git entry exists.'",
  "for name in GNUmakefile makefile ./*.mk compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml .env .config/qube-token .config/sonar-host-url; do",
  '  if test -e "$name" || test -L "$name"; then fail \'A forbidden file exists in the checkout.\'; fi',
  "done",
  ...GIT_METADATA_CHECK,
  "git_metadata_ok || fail 'Git metadata differs from the saved copy.'",
].join("\n");
export const FINAL_GIT_CHECK = [
  'if ! test -d "$RUNNER_TEMP/git-meta"; then exit 0; fi',
  ...GIT_METADATA_CHECK,
  "if git_metadata_ok; then exit 0; fi",
  'mv -T -- .git .git.quarantine 2> /dev/null || mv -T -- .git "$RUNNER_TEMP/git-quarantine" 2> /dev/null || true',
  "printf '%s\\n' 'Git metadata differs from the saved copy; .git was moved aside.' >&2",
  "exit 1",
].join("\n");
export const FORK_REFUSAL = [
  "printf '%s\\n' 'Fork pull requests do not run the PR Quality Gate; re-push the reviewed change to a same-repository branch.' >&2",
  "exit 1",
].join("\n");
export const DISABLED_NOTICE =
  "printf '%s\\n' 'PR Quality Gate disabled: SONAR_ENABLED is not true; no analysis ran.'";

// BR-350 / BR-015 v7: the fork notice, step 1 of `privacy-scan`.
export const PRIVACY_FORK_NOTICE =
  "printf '%s\\n' 'privacy-scan: fork pull request; deny patterns are unavailable, no scan was run.'";

// BR-015 v5 / BR-227: the only non-Make text of the `ci-result` job.
export const CI_RESULT_FAILURE = [
  "printf '%s\\n' 'CI failed: the changes job did not succeed, or a job failed or was cancelled.' >&2",
  "exit 1",
].join("\n");

const SAME =
  "github.event.pull_request.head.repo.full_name == github.repository";
const FORK =
  "github.event.pull_request.head.repo.full_name != github.repository";
const ENABLED = `${SAME} && vars.SONAR_ENABLED == 'true'`;
export const PR_CONDITIONS = {
  fork: FORK,
  disabled: `${SAME} && vars.SONAR_ENABLED != 'true'`,
  enabled: ENABLED,
};
// BR-225 v3: every ci.yml job on one hosted image. The self-hosted label array
// survives only in runner-acceptance.yml (BR-229 v2).
export const HOSTED = "ubuntu-24.04";
export const LABELS = ["self-hosted", "linux", "x64", "kdrive-ci"];
export const TIMEOUTS: Record<string, number> = {
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
};
// BR-227 v3, BR-149 v3, BR-183 v3: the exact job conditions.
export const JOB_CONDITIONS = {
  changes: `github.event_name != 'pull_request' || ${SAME}`,
  heavy: "needs.changes.outputs.heavy != 'false'",
  image: "needs.changes.outputs.image != 'false'",
  sonarPr: `github.event_name == 'pull_request' && ${SAME} && needs.changes.outputs.heavy != 'false'`,
  forkRefusal: `github.event_name == 'pull_request' && ${FORK}`,
  ciResult: `always() && (github.event_name != 'pull_request' || ${SAME})`,
  ciResultStep:
    "needs.changes.result != 'success' || needs.privacy-scan.result != 'success' || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')",
};
// BR-341 / BR-350: the step conditions of `privacy-scan`.
export const PRIVACY_CONDITIONS = {
  fork: `github.event_name == 'pull_request' && ${FORK}`,
  scan: `github.event_name != 'pull_request' || ${SAME}`,
};
// BR-341: the exact env of `make privacy-scan`.
export const PRIVACY_ENV = {
  PRIVACY_DENY_PATTERNS: "${{ secrets.PRIVACY_DENY_PATTERNS }}",
  PRIVACY_EVENT: "${{ github.event_name }}",
  PRIVACY_RANGE_BASE:
    "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
  PRIVACY_RANGE_HEAD:
    "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
  PRIVACY_PR_TITLE: "${{ github.event.pull_request.title }}",
  PRIVACY_PR_BODY: "${{ github.event.pull_request.body }}",
};
// BR-228: the exact top-level concurrency.
export const CONCURRENCY = {
  group:
    "ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
  "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
};
const GATES = ["lint", "format", "typecheck", "test", "build"];
// BR-015 v5 / BR-183 v2: the per-architecture image job, compared exactly.
const IMAGE_TARGETS = ["make image-binfmt", "make image", "make image-smoke"];
const expectedImageJob: Job = {
  "runs-on": HOSTED,
  needs: ["changes"],
  if: JOB_CONDITIONS.image,
  permissions: { contents: "read" },
  "timeout-minutes": 30,
  strategy: {
    "fail-fast": false,
    matrix: { platform: ["linux/amd64", "linux/arm64"] },
  },
  steps: [
    { uses: CHECKOUT, with: { "persist-credentials": false } },
    ...IMAGE_TARGETS.map((run) => ({
      run,
      env: { IMAGE_PLATFORMS: "${{ matrix.platform }}" },
    })),
  ],
};
// BR-320 v3 / BR-015 v6: the dependency audit job, compared exactly, with
// the F-027 install check as its fourth step. It is not one of the five
// build gates, so Sonar never waits for it (BR-149 v2).
export const expectedAuditJob: Job = {
  "runs-on": HOSTED,
  needs: ["changes"],
  if: JOB_CONDITIONS.heavy,
  "timeout-minutes": 20,
  steps: [
    { uses: CHECKOUT, with: { "persist-credentials": false } },
    { run: "make setup" },
    { run: "make audit" },
    { run: "make install-check" },
  ],
};
// BR-227: the classification job.
const expectedChangesJob: Job = {
  "runs-on": HOSTED,
  if: JOB_CONDITIONS.changes,
  "timeout-minutes": 5,
  outputs: {
    heavy: "${{ steps.classify.outputs.heavy }}",
    image: "${{ steps.classify.outputs.image }}",
  },
  steps: [
    {
      uses: CHECKOUT,
      with: { "fetch-depth": 2, "persist-credentials": false },
    },
    { id: "classify", run: "make ci-changes" },
  ],
};
// BR-149 v2: the hosted fork refusal.
const expectedForkRefusalJob: Job = {
  "runs-on": HOSTED,
  if: JOB_CONDITIONS.forkRefusal,
  permissions: { contents: "read" },
  "timeout-minutes": 5,
  steps: [{ run: FORK_REFUSAL }],
};
// BR-341: the privacy scan, compared exactly.
export const expectedPrivacyScanJob: Job = {
  "runs-on": HOSTED,
  permissions: { contents: "read" },
  "timeout-minutes": 20,
  steps: [
    { if: PRIVACY_CONDITIONS.fork, run: PRIVACY_FORK_NOTICE },
    {
      if: PRIVACY_CONDITIONS.scan,
      uses: CHECKOUT,
      with: { "fetch-depth": 0, "persist-credentials": false },
    },
    { if: PRIVACY_CONDITIONS.scan, run: "make privacy-scan", env: PRIVACY_ENV },
  ],
};
// BR-227 v3: the aggregate result job.
const expectedCiResultJob: Job = {
  "runs-on": HOSTED,
  needs: [
    "changes",
    ...GATES,
    "image",
    "audit",
    "sonar",
    "sonar-pr",
    "privacy-scan",
  ],
  if: JOB_CONDITIONS.ciResult,
  "timeout-minutes": 5,
  steps: [{ if: JOB_CONDITIONS.ciResultStep, run: CI_RESULT_FAILURE }],
};
const PRISTINE_TAR = "${{ runner.temp }}/pristine.tar";

const expectedSonarSteps: Step[] = [
  {
    uses: CHECKOUT,
    with: { ref: "main", "fetch-depth": 0, "persist-credentials": false },
  },
  { run: PRISTINE_EXPORT },
  { run: "make setup" },
  { run: PRISTINE_COMPARISON },
  {
    run: "make sonar",
    env: {
      SONAR_ENABLED: "${{ vars.SONAR_ENABLED }}",
      SONAR_HOST_URL: "${{ secrets.SONAR_HOST_URL }}",
      SONAR_TOKEN: "${{ secrets.SONAR_TOKEN }}",
      SONAR_PRISTINE_TAR: PRISTINE_TAR,
    },
  },
  { if: "always()", run: FINAL_GIT_CHECK },
];
const expectedPullRequestSteps: Step[] = [
  {
    uses: CHECKOUT,
    with: { "fetch-depth": 0, "persist-credentials": false },
  },
  { name: "Refuse fork pull requests", if: FORK, run: FORK_REFUSAL },
  {
    name: "PR Quality Gate disabled",
    if: PR_CONDITIONS.disabled,
    run: DISABLED_NOTICE,
  },
  { if: ENABLED, run: PRISTINE_EXPORT },
  { if: ENABLED, run: "make setup" },
  { if: ENABLED, run: PRISTINE_COMPARISON },
  {
    if: ENABLED,
    run: "make sonar-pr",
    env: {
      SONAR_ENABLED: "${{ vars.SONAR_ENABLED }}",
      SONAR_HOST_URL: "${{ secrets.SONAR_HOST_URL }}",
      SONAR_TOKEN: "${{ secrets.SONAR_PR_TOKEN }}",
      SONAR_PRISTINE_TAR: PRISTINE_TAR,
      SONAR_PR_HEAD_REPOSITORY:
        "${{ github.event.pull_request.head.repo.full_name }}",
    },
  },
  { if: "always()", run: FINAL_GIT_CHECK },
];

// Canonical JSON with sorted keys, so key order in the workflow is free.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function validateGates(workflow: Workflow): void {
  for (const gate of GATES) {
    const job = workflow.jobs[gate];
    // BR-015 v5 / BR-227: gated on the classification, read-only.
    check(
      job &&
        job.if === JOB_CONDITIONS.heavy &&
        canonical(job.needs) === canonical(["changes"]) &&
        !job.permissions,
      "gate job needs changes with the heavy condition",
    );
    const runs =
      job?.steps.flatMap((step) => (step.run ? [step.run] : [])) ?? [];
    check(runs[0] === "make setup", "container setup first");
    const expected: Record<string, string> = {
      lint: "make lint",
      format: "make format-check",
      typecheck: "make typecheck",
      test: "make build\nmake coverage",
      build: "make build\nmake pack",
    };
    check(
      runs[1] === expected[gate] && runs.length === 2,
      "required gate command",
    );
  }
}

// BR-015 v5: where each admitted non-Make text may appear.
const ADMITTED_JOBS = new Map<string, string[]>([
  [PRISTINE_EXPORT, ["sonar", "sonar-pr"]],
  [PRISTINE_COMPARISON, ["sonar", "sonar-pr"]],
  [FINAL_GIT_CHECK, ["sonar", "sonar-pr"]],
  [FORK_REFUSAL, ["sonar-pr", "fork-refusal"]],
  [DISABLED_NOTICE, ["sonar-pr"]],
  [CI_RESULT_FAILURE, ["ci-result"]],
  [PRIVACY_FORK_NOTICE, ["privacy-scan"]],
]);
const ADMITTED_OCCURRENCES = 11;

// Checks one run text; returns 1 for an admitted non-Make constant.
function validateRun(job: string, run: string): number {
  const admittedIn = ADMITTED_JOBS.get(run);
  if (IMAGE_TARGETS.includes(run))
    check(job === "image", "image targets only in the image job");
  else if (run === "make audit")
    check(job === "audit", "make audit only in the audit job");
  else if (run === "make install-check")
    check(job === "audit", "make install-check only in the audit job");
  else if (run === "make ci-changes")
    check(job === "changes", "make ci-changes only in the changes job");
  else if (run === "make privacy-scan")
    check(job === "privacy-scan", "make privacy-scan only in privacy-scan");
  else if (admittedIn) {
    check(admittedIn.includes(job), "admitted constant in its job only");
    return 1;
  } else if (job === "privacy-scan")
    check(false, "no other command in privacy-scan, make setup included");
  else
    check(
      /^make (setup|lint|format-check|typecheck|build|coverage|pack|sonar|sonar-pr)(\nmake (coverage|pack))?$/u.test(
        run,
      ),
      "Make-only commands or an admitted constant",
    );
  return 0;
}

function validateSteps(workflow: Workflow): void {
  let admittedCount = 0;
  for (const [name, job] of Object.entries(workflow.jobs)) {
    check(
      !job.env || !JSON.stringify(job.env).includes("secrets."),
      "no job-level secret",
    );
    check(
      Object.keys(job.env ?? {}).every((key) => !key.startsWith("SONAR_")),
      "no job-wide Sonar configuration",
    );
    for (const step of job.steps) {
      check(
        !step.uses || /^actions\/checkout@[0-9a-f]{40}$/u.test(step.uses),
        "pinned official checkout only",
      );
      if (step.run !== undefined) admittedCount += validateRun(name, step.run);
      check(
        !step.run?.includes("github.event"),
        "event data is never interpolated into a run script",
      );
      const env = JSON.stringify(step.env ?? {});
      check(
        !env.includes("SONAR_TOKEN_FILE") &&
          !env.includes("SONAR_HOST_URL_FILE"),
        "no CI file credential mode",
      );
      if (env.includes("secrets."))
        check(
          (name === "sonar" && step.run === "make sonar") ||
            (name === "sonar-pr" && step.run === "make sonar-pr") ||
            (name === "privacy-scan" && step.run === "make privacy-scan"),
          "secrets only on the analysis and privacy-scan steps",
        );
      // BR-342: the deny secret only in the scan step, no Sonar secret there.
      check(
        !env.includes("secrets.PRIVACY_DENY_PATTERNS") ||
          (name === "privacy-scan" && step.run === "make privacy-scan"),
        "PRIVACY_DENY_PATTERNS only in the privacy-scan step",
      );
      check(
        name !== "privacy-scan" || !env.includes("secrets.SONAR_"),
        "no Sonar secret in privacy-scan",
      );
      check(
        name === "sonar" || !env.includes("secrets.SONAR_TOKEN }}"),
        "SONAR_TOKEN only in the main analysis",
      );
      check(
        name === "sonar-pr" || !env.includes("secrets.SONAR_PR_TOKEN"),
        "SONAR_PR_TOKEN only in the PR analysis",
      );
    }
  }
  check(
    admittedCount === ADMITTED_OCCURRENCES,
    "exactly eleven admitted non-Make run texts",
  );
}

// BR-015 v7: the word `secrets`, case-insensitive, in any parsed key or string
// value, is admitted only inside the env values of the two analysis steps and
// of the privacy-scan step.
function secretReferences(value: unknown, path: string[], found: string[][]) {
  if (typeof value === "string") {
    if (/\bsecrets\b/iu.test(value)) found.push(path);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/\bsecrets\b/iu.test(key)) found.push([...path, key]);
    secretReferences(entry, [...path, key], found);
  }
}
function validateSecretPlacement(workflow: Workflow): void {
  const found: string[][] = [];
  secretReferences(workflow, [], found);
  const analysis: Record<string, string> = {
    sonar: "make sonar",
    "sonar-pr": "make sonar-pr",
    "privacy-scan": "make privacy-scan",
  };
  for (const path of found) {
    const [jobs, job = "", steps, index = "", env, name] = path;
    const step = workflow.jobs[job]?.steps[Number(index)];
    check(
      jobs === "jobs" &&
        steps === "steps" &&
        env === "env" &&
        name !== undefined &&
        path.length === 6 &&
        /^\d+$/u.test(index) &&
        step?.run === analysis[job] &&
        /^\$\{\{ secrets\.[A-Z_]+ \}\}$/u.test(step?.env?.[name] ?? ""),
      "secrets only in the analysis env values",
    );
  }
}

// BR-149 v2: where the head repository may appear.
function stringsWithPath(
  value: unknown,
  path: string[],
  found: [string[], string][],
) {
  if (typeof value === "string") {
    found.push([path, value]);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value))
    stringsWithPath(entry, [...path, key], found);
}
const HEAD_REPOSITORY = "head.repo.full_name";
function validateHeadRepositoryPlacement(workflow: Workflow): void {
  const found: [string[], string][] = [];
  stringsWithPath(workflow, [], found);
  const jobIfs = new Map<string, string>([
    ["sonar-pr", JOB_CONDITIONS.sonarPr],
    ["fork-refusal", JOB_CONDITIONS.forkRefusal],
    ["changes", JOB_CONDITIONS.changes],
    ["ci-result", JOB_CONDITIONS.ciResult],
  ]);
  for (const [path, value] of found) {
    if (!value.includes(HEAD_REPOSITORY)) continue;
    const [jobs, job = "", key, index, stepKey, name] = path;
    const jobIf =
      jobs === "jobs" && key === "if" && path.length === 3
        ? jobIfs.get(job) === value
        : false;
    const stepIf =
      jobs === "jobs" &&
      key === "steps" &&
      /^\d+$/u.test(index ?? "") &&
      stepKey === "if" &&
      path.length === 5;
    const headEnv =
      jobs === "jobs" &&
      job === "sonar-pr" &&
      key === "steps" &&
      stepKey === "env" &&
      name === "SONAR_PR_HEAD_REPOSITORY" &&
      path.length === 6;
    check(jobIf || stepIf || headEnv, "head repository only where admitted");
  }
}

// BR-225 v3: hosted runners and timeouts.
function validateRunners(workflow: Workflow): void {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    check(job["runs-on"] === HOSTED, "every job on ubuntu-24.04");
    check(
      !JSON.stringify(job["runs-on"]).includes("self-hosted"),
      "no self-hosted runner",
    );
    check(job["timeout-minutes"] === TIMEOUTS[name], "BR-225 timeout-minutes");
  }
}

// BR-227 v3: only ci-result uses always() at job level; every job except
// changes, privacy-scan, fork-refusal and ci-result depends on changes
// directly or transitively.
function dependsOnChanges(
  workflow: Workflow,
  name: string,
  seen: Set<string>,
): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const needs = workflow.jobs[name]?.needs ?? [];
  return needs.some(
    (entry) => entry === "changes" || dependsOnChanges(workflow, entry, seen),
  );
}
function validateDependencies(workflow: Workflow): void {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== "ci-result")
      check(!job.if?.includes("always()"), "always() only on ci-result");
    if (
      !["changes", "ci-result", "fork-refusal", "privacy-scan"].includes(name)
    )
      check(
        dependsOnChanges(workflow, name, new Set()),
        "job depends on changes",
      );
  }
  check(!workflow.jobs.changes?.needs, "changes has no needs");
  const scan = workflow.jobs["privacy-scan"];
  check(
    scan && !scan.needs && scan.if === undefined && !scan.env,
    "privacy-scan has no needs, no job if and no job env",
  );
  check(!workflow.jobs["fork-refusal"]?.needs, "fork-refusal has no needs");
}

export function validateWorkflow(workflow: Workflow): void {
  check(workflow.name === "CI", "CI name");
  validateSecretPlacement(workflow);
  validateHeadRepositoryPlacement(workflow);
  check(
    canonical(workflow.permissions) === '{"contents":"read"}',
    "read-only permissions",
  );
  check(
    Object.keys(workflow.on).every((event) =>
      ["push", "pull_request", "workflow_dispatch"].includes(event),
    ),
    "trusted trigger set",
  );
  check(
    !JSON.stringify(workflow).includes("pull_request_target"),
    "never pull_request_target",
  );
  for (const event of ["push", "pull_request"])
    check(
      canonical(workflow.on[event]) === '{"branches":["main"]}',
      "main trigger without path filters",
    );
  check(
    !workflow.env || !JSON.stringify(workflow.env).includes("secrets."),
    "no workflow-level secret",
  );
  check(
    Object.keys(workflow.env ?? {}).every((key) => !key.startsWith("SONAR_")),
    "no workflow-wide Sonar configuration",
  );
  check(
    canonical(workflow.concurrency) === canonical(CONCURRENCY),
    "BR-228 top-level concurrency",
  );
  check(
    Object.keys(workflow.jobs)
      .sort((a, b) => a.localeCompare(b))
      .join(",") ===
      "audit,build,changes,ci-result,fork-refusal,format,image,lint,privacy-scan,sonar,sonar-pr,test,typecheck",
    "exact job set",
  );
  validateRunners(workflow);
  validateDependencies(workflow);
  validateGates(workflow);
  validateSteps(workflow);

  check(
    canonical(workflow.jobs.changes) === canonical(expectedChangesJob),
    "changes job: fork guard, outputs, checkout with depth 2, make ci-changes",
  );
  check(
    canonical(workflow.jobs["fork-refusal"]) ===
      canonical(expectedForkRefusalJob),
    "fork-refusal job: hosted, read-only, refusal step only",
  );
  check(
    canonical(workflow.jobs["privacy-scan"]) ===
      canonical(expectedPrivacyScanJob),
    "privacy-scan job: hosted, read-only, fork notice, full checkout, make privacy-scan with its env",
  );
  check(
    canonical(workflow.jobs["ci-result"]) === canonical(expectedCiResultJob),
    "ci-result job: needs every job, always(), one conditional failure step",
  );

  const sonar = workflow.jobs.sonar;
  check(
    sonar?.if ===
      `github.repository == '${REPOSITORY}' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && vars.SONAR_ENABLED == 'true'`,
    "trusted opt-in main Sonar",
  );
  check(canonical(sonar?.needs) === canonical(GATES), "Sonar after all gates");
  check(
    sonar?.["timeout-minutes"] === 15 &&
      canonical(sonar.concurrency) ===
        canonical({
          group: "sonar-kdrive-mcp-server",
          "cancel-in-progress": false,
        }),
    "bounded serialized main analysis",
  );
  check(
    canonical(sonar?.steps) === canonical(expectedSonarSteps),
    "main analysis steps: checkout, pristine export, setup, comparison, analysis, final Git-metadata step",
  );

  check(
    canonical(workflow.jobs.image) === canonical(expectedImageJob),
    "image job: changes-gated per-architecture matrix, bounded, read-only, checkout then the three image targets",
  );

  check(
    canonical(workflow.jobs.audit) === canonical(expectedAuditJob),
    "audit job: changes-gated heavy job, bounded, checkout, make setup, make audit, make install-check",
  );

  const pr = workflow.jobs["sonar-pr"];
  check(pr?.if === JOB_CONDITIONS.sonarPr, "PR gate on same-repository PRs");
  check(
    canonical(pr?.needs) === canonical(["changes", ...GATES]),
    "PR gate after changes and all gates",
  );
  check(
    pr?.["timeout-minutes"] === 15 &&
      canonical(pr.concurrency) ===
        canonical({
          group: "sonar-kdrive-mcp-server-pr",
          "cancel-in-progress": false,
        }),
    "bounded serialized PR analysis",
  );
  check(
    canonical(pr?.steps) === canonical(expectedPullRequestSteps),
    "PR gate steps: checkout, fork refusal, disabled notice, pristine export, setup, comparison, analysis, final Git-metadata step",
  );
}

// BR-229 v2: the owner's runner acceptance never runs in this repository.
export const RUNNER_ACCEPTANCE_GUARD = `github.repository != '${REPOSITORY}'`;
export interface AcceptanceWorkflow {
  on: Record<string, unknown>;
  jobs: Record<string, { "runs-on"?: unknown; if?: string }>;
}
export function validateRunnerAcceptance(workflow: AcceptanceWorkflow): void {
  check(
    canonical(Object.keys(workflow.on)) === canonical(["workflow_dispatch"]),
    "workflow_dispatch is the only trigger",
  );
  check(
    canonical(Object.keys(workflow.jobs).sort((a, b) => a.localeCompare(b))) ===
      canonical(["probe", "reset-check", "reset-mark"]),
    "the three acceptance jobs",
  );
  for (const job of Object.values(workflow.jobs)) {
    check(job.if === RUNNER_ACCEPTANCE_GUARD, "repository guard on each job");
    check(
      canonical(job["runs-on"]) === canonical(LABELS),
      "the label array survives here",
    );
  }
}

// AC-14: a minimal evaluator for the exact step conditions used above.
export interface Context {
  headRepository: string;
  repository: string;
  sonarEnabled: string;
}
export function stepRuns(
  condition: string | undefined,
  context: Context,
): boolean {
  if (condition === undefined || condition === "always()") return true;
  const values: Record<string, string> = {
    "github.event.pull_request.head.repo.full_name": context.headRepository,
    "github.repository": context.repository,
    "vars.SONAR_ENABLED": context.sonarEnabled,
  };
  const operand = (text: string) => {
    const quoted = /^'(.*)'$/u.exec(text);
    if (quoted) return quoted[1] ?? "";
    const value = values[text];
    if (value === undefined) throw new Error(`Unsupported operand ${text}`);
    return value;
  };
  return condition.split(" && ").every((term) => {
    const match = /^(\S+) (==|!=) (\S+)$/u.exec(term);
    if (!match) throw new Error(`Unsupported condition ${term}`);
    const [, left = "", op, right = ""] = match;
    return (operand(left) === operand(right)) === (op === "==");
  });
}

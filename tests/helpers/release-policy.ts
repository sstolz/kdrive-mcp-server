// F-024 BR-355–BR-358, BR-371: closed-set policy for
// .github/workflows/release.yml. The workflow is compared with the exact
// expected structure; only step names (literals) and the 40-hex action pins
// may vary, so any key not listed by the rules is rejected at every level.

export const RELEASE_GUARD =
  "github.repository == 'sstolz/kdrive-mcp-server' && github.ref == 'refs/heads/main'";
export const PUBLISH_GUARD = `${RELEASE_GUARD} && inputs.dry_run == false`;
export const RUN_NAME =
  "Release ${{ inputs.version }} @ ${{ inputs.sha }} dry_run=${{ inputs.dry_run }}";

const PIN = "@<40-hex>";
const ACTIONS = [
  "actions/checkout",
  "actions/upload-artifact",
  "actions/download-artifact",
];
const VERSION = "${{ inputs.version }}";
const SHA = "${{ inputs.sha }}";
const DRY_RUN = "${{ inputs.dry_run }}";
const TOKEN = "${{ github.token }}";
const DIGEST = "${{ needs.verify.outputs.tarball-sha256 }}";
const PLATFORMS = "linux/amd64 linux/arm64";

const checkout = {
  uses: `actions/checkout${PIN}`,
  with: {
    ref: "${{ github.sha }}",
    "fetch-depth": 0,
    "persist-credentials": false,
  },
};
const make = (target: string, env?: Record<string, string>) =>
  env ? { run: `make ${target}`, env } : { run: `make ${target}` };
const releaseCheck = (phase: string) =>
  make("release-check", {
    RELEASE_VERSION: VERSION,
    RELEASE_SHA: SHA,
    RELEASE_DRY_RUN: DRY_RUN,
    RELEASE_PHASE: phase,
    GITHUB_TOKEN: TOKEN,
  });
const binfmt = make("image-binfmt", { IMAGE_PLATFORMS: PLATFORMS });

export const EXPECTED_RELEASE_WORKFLOW = {
  name: "Release",
  "run-name": RUN_NAME,
  on: {
    workflow_dispatch: {
      inputs: {
        version: { type: "string", required: true },
        sha: { type: "string", required: true },
        dry_run: { type: "boolean", required: false, default: true },
      },
    },
  },
  permissions: {},
  concurrency: { group: "release", "cancel-in-progress": false },
  env: { DEV_UID: "1001", DEV_GID: "1001" },
  jobs: {
    verify: {
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 60,
      if: RELEASE_GUARD,
      permissions: { contents: "read", actions: "read", packages: "read" },
      outputs: {
        "tarball-sha256": "${{ steps.release-npm.outputs.tarball-sha256 }}",
      },
      steps: [
        checkout,
        releaseCheck("verify"),
        make("release-setup"),
        make("pack"),
        {
          id: "release-npm",
          ...make("release-npm", {
            RELEASE_VERSION: VERSION,
            RELEASE_SHA: SHA,
            RELEASE_DRY_RUN: "true",
          }),
        },
        binfmt,
        make("release-image", {
          RELEASE_VERSION: VERSION,
          RELEASE_SHA: SHA,
          RELEASE_DRY_RUN: "true",
          IMAGE_PLATFORMS: PLATFORMS,
        }),
        {
          uses: `actions/upload-artifact${PIN}`,
          with: {
            name: "npm-tarball",
            path: "artifacts/sstolz-kdrive-mcp-server-*.tgz",
            "if-no-files-found": "error",
          },
        },
      ],
    },
    "publish-image": {
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 60,
      if: PUBLISH_GUARD,
      needs: ["verify"],
      environment: "release",
      permissions: { contents: "read", actions: "read", packages: "write" },
      steps: [
        checkout,
        releaseCheck("image"),
        binfmt,
        make("release-image", {
          RELEASE_VERSION: VERSION,
          RELEASE_SHA: SHA,
          RELEASE_DRY_RUN: DRY_RUN,
          IMAGE_PLATFORMS: PLATFORMS,
          GITHUB_TOKEN: TOKEN,
        }),
      ],
    },
    "publish-npm": {
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 60,
      if: PUBLISH_GUARD,
      needs: ["verify", "publish-image"],
      environment: "release",
      permissions: {
        contents: "read",
        actions: "read",
        packages: "read",
        "id-token": "write",
      },
      steps: [
        checkout,
        releaseCheck("npm"),
        {
          uses: `actions/download-artifact${PIN}`,
          with: { name: "npm-tarball", path: "artifacts" },
        },
        make("release-npm", {
          RELEASE_VERSION: VERSION,
          RELEASE_SHA: SHA,
          RELEASE_DRY_RUN: DRY_RUN,
          RELEASE_TARBALL_SHA256: DIGEST,
        }),
      ],
    },
    "read-back": {
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 60,
      if: PUBLISH_GUARD,
      needs: ["verify", "publish-npm"],
      permissions: { contents: "read", packages: "read" },
      steps: [
        checkout,
        make("release-verify", {
          RELEASE_VERSION: VERSION,
          RELEASE_SHA: SHA,
          RELEASE_DRY_RUN: DRY_RUN,
          GITHUB_TOKEN: TOKEN,
          RELEASE_TARBALL_SHA256: DIGEST,
        }),
      ],
    },
  },
};

function fail(path: string, message: string): never {
  throw new Error(`release.yml ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Step names are free literals; action pins are any 40-hex commit. */
function normalizeStep(step: unknown, path: string): unknown {
  if (!isRecord(step)) return step;
  const copy: Record<string, unknown> = { ...step };
  if ("name" in copy) {
    if (typeof copy.name !== "string" || copy.name.includes("${{"))
      fail(`${path}.name`, "a step name is a literal without ${{");
    delete copy.name;
  }
  if (typeof copy.uses === "string") {
    const match = /^([\w./-]+)@([0-9a-f]{40})$/u.exec(copy.uses);
    if (match && ACTIONS.includes(match[1] ?? ""))
      copy.uses = `${match[1] ?? ""}${PIN}`;
  }
  return copy;
}

function normalize(workflow: unknown): unknown {
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) return workflow;
  const jobs: Record<string, unknown> = {};
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (isRecord(job) && Array.isArray(job.steps))
      jobs[name] = {
        ...job,
        steps: job.steps.map((step: unknown, index) =>
          normalizeStep(step, `jobs.${name}.steps[${String(index)}]`),
        ),
      };
    else jobs[name] = job;
  }
  return { ...workflow, jobs };
}

/** Exact structural comparison: same key sets, same array order. */
function compare(actual: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      fail(path, "differs from the BR-355–BR-358 contract");
    expected.forEach((item: unknown, index) => {
      compare((actual as unknown[])[index], item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) fail(path, "differs from the contract");
    const keys = Object.keys(expected).sort();
    const found = Object.keys(actual).sort();
    if (keys.join(",") !== found.join(","))
      fail(path, `has keys ${found.join(",")}, expected ${keys.join(",")}`);
    for (const key of keys)
      compare(actual[key], expected[key], `${path}.${key}`);
    return;
  }
  if (actual !== expected) fail(path, "differs from the contract");
}

/** BR-355–BR-358, BR-371: throws on any departure from the contract. */
export function validateReleaseWorkflow(text: string): void {
  if (/secrets/iu.test(text)) fail("text", "mentions secrets");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("text", "is not the JSON form of the workflow");
  }
  compare(normalize(parsed), EXPECTED_RELEASE_WORKFLOW, "$");
}

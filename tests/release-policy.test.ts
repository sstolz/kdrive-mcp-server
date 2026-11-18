// F-024 AC-02, AC-03, AC-04: release workflow policy and release documentation.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECK_VARIABLES,
  NPM_VARIABLES,
  VERIFY_VARIABLES,
  EXPECTED_RELEASE_WORKFLOW,
  validateReleaseWorkflow,
} from "./helpers/release-policy.js";

import { rules } from "./helpers/image-policy.js";

const PATH = ".github/workflows/release.yml";

type Json = Record<string, unknown>;
interface Step {
  id?: string;
  uses?: string;
  run?: string;
  with?: Json;
  env?: Record<string, string>;
  [key: string]: unknown;
}
interface Job {
  needs?: string[];
  steps: Step[];
  permissions: Record<string, string>;
  [key: string]: unknown;
}
interface Workflow {
  on: Json;
  jobs: Record<string, Job>;
  [key: string]: unknown;
}

function real(): Workflow {
  return JSON.parse(readFileSync(PATH, "utf8")) as Workflow;
}
function job(workflow: Workflow, name: string): Job {
  const found = workflow.jobs[name];
  if (!found) throw new Error(`missing job ${name}`);
  return found;
}
function step(workflow: Workflow, name: string, run: string): Step {
  const found = job(workflow, name).steps.find((entry) => entry.run === run);
  if (!found) throw new Error(`missing ${run} in ${name}`);
  return found;
}
function checkoutOf(workflow: Workflow, name: string): Step {
  const found = job(workflow, name).steps[0];
  if (!found?.with) throw new Error(`missing checkout in ${name}`);
  return found;
}
function inputs(workflow: Workflow): Record<string, Json> {
  return (workflow.on.workflow_dispatch as { inputs: Record<string, Json> })
    .inputs;
}
const JOBS = ["verify", "publish-image", "publish-npm", "read-back"];
const PUBLISHING = ["verify", "publish-image", "publish-npm"];
const PIN = "11bd71901bbe5b1630ceea73d27597364c9af683";

describe("F-024 AC-03 AC-04 release workflow policy", () => {
  it("BR-355 accepts the real release workflow", () => {
    expect(() => {
      validateReleaseWorkflow(readFileSync(PATH, "utf8"));
    }).not.toThrow();
  });

  const mutations: Record<string, (w: Workflow) => void> = {
    // BR-355 triggers, inputs, top level
    "push trigger": (w) => {
      w.on.push = { branches: ["main"] };
    },
    "pull_request trigger": (w) => {
      w.on.pull_request = null;
    },
    "pull_request_target trigger": (w) => {
      w.on.pull_request_target = null;
    },
    "workflow_run trigger": (w) => {
      w.on.workflow_run = { workflows: ["CI"] };
    },
    "dry_run default false": (w) => {
      inputs(w).dry_run!.default = false;
    },
    "top-level permissions not empty": (w) => {
      w.permissions = { contents: "read" };
    },
    "concurrency missing": (w) => {
      delete w.concurrency;
    },
    "concurrency cancel-in-progress true": (w) => {
      w.concurrency = { group: "release", "cancel-in-progress": true };
    },
    "top-level env missing": (w) => {
      delete w.env;
    },
    "DEV_UID other than 1001": (w) => {
      w.env = { DEV_UID: "1000", DEV_GID: "1001" };
    },
    "DEV_GID other than 1001": (w) => {
      w.env = { DEV_UID: "1001", DEV_GID: "1000" };
    },
    "top-level env extra key": (w) => {
      w.env = { DEV_UID: "1001", DEV_GID: "1001", EXTRA: "1" };
    },
    "run-name missing": (w) => {
      delete w["run-name"];
    },
    "run-name other text": (w) => {
      w["run-name"] = "Release ${{ inputs.version }}";
    },
    "unlisted top-level key defaults": (w) => {
      w.defaults = { run: { shell: "bash" } };
    },
    // BR-356 permissions, needs, environment, guards
    "packages write on verify": (w) => {
      job(w, "verify").permissions.packages = "write";
    },
    "id-token write on verify": (w) => {
      job(w, "verify").permissions["id-token"] = "write";
    },
    "id-token write on publish-image": (w) => {
      job(w, "publish-image").permissions["id-token"] = "write";
    },
    "id-token write on read-back": (w) => {
      job(w, "read-back").permissions["id-token"] = "write";
    },
    "id-token write on an added job": (w) => {
      w.jobs.extra = {
        ...structuredClone(job(w, "read-back")),
        permissions: { contents: "read", "id-token": "write" },
      };
    },
    "packages write on publish-npm": (w) => {
      job(w, "publish-npm").permissions.packages = "write";
    },
    "packages write on read-back": (w) => {
      job(w, "read-back").permissions.packages = "write";
    },
    "packages write on an added job": (w) => {
      w.jobs.extra = {
        ...structuredClone(job(w, "read-back")),
        permissions: { contents: "read", packages: "write" },
      };
    },
    ...Object.fromEntries(
      JOBS.map((name) => [
        `contents write on ${name}`,
        (w: Workflow) => {
          job(w, name).permissions.contents = "write";
        },
      ]),
    ),
    "read-back with an environment": (w) => {
      job(w, "read-back").environment = "release";
    },
    "read-back without verify in needs": (w) => {
      job(w, "read-back").needs = ["publish-npm"];
    },
    "read-back without publish-npm in needs": (w) => {
      job(w, "read-back").needs = ["verify"];
    },
    "publish-image without environment": (w) => {
      delete job(w, "publish-image").environment;
    },
    "publish-npm without environment": (w) => {
      delete job(w, "publish-npm").environment;
    },
    "publish-image without the dry_run condition": (w) => {
      job(w, "publish-image").if = job(w, "verify").if;
    },
    "publish-npm without the dry_run condition": (w) => {
      job(w, "publish-npm").if = job(w, "verify").if;
    },
    "publish-npm without publish-image in needs": (w) => {
      job(w, "publish-npm").needs = ["verify"];
    },
    ...Object.fromEntries(
      JOBS.map((name) => [
        `${name} without the repository and main guard`,
        (w: Workflow) => {
          job(w, name).if =
            name === "verify" ? "true" : "inputs.dry_run == false";
        },
      ]),
    ),
    ...Object.fromEntries(
      JOBS.flatMap((name) => [
        [
          `${name} runs-on ubuntu-latest`,
          (w: Workflow) => {
            job(w, name)["runs-on"] = "ubuntu-latest";
          },
        ],
        [
          `${name} runs-on self-hosted`,
          (w: Workflow) => {
            job(w, name)["runs-on"] = "self-hosted";
          },
        ],
      ]),
    ),
    "verify without the tarball-sha256 output": (w) => {
      delete job(w, "verify").outputs;
    },
    "continue-on-error on a job": (w) => {
      job(w, "verify")["continue-on-error"] = true;
    },
    "job env": (w) => {
      job(w, "verify").env = { X: "1" };
    },
    "job container": (w) => {
      job(w, "verify").container = "node:26";
    },
    "job services": (w) => {
      job(w, "verify").services = { db: { image: "x" } };
    },
    // BR-357 steps
    ...Object.fromEntries(
      ["publish-image", "publish-npm"].map((name) => [
        `${name} without make release-check`,
        (w: Workflow) => {
          job(w, name).steps.splice(1, 1);
        },
      ]),
    ),
    "release-check after the image push": (w) => {
      const steps = job(w, "publish-image").steps;
      const [check] = steps.splice(1, 1);
      steps.push(check!);
    },
    "release-check after the npm publish": (w) => {
      const steps = job(w, "publish-npm").steps;
      const [check] = steps.splice(1, 1);
      steps.push(check!);
    },
    ...Object.fromEntries(
      JOBS.flatMap((name) => [
        [
          `${name} runs make release-check twice`,
          (w: Workflow) => {
            const steps = job(w, name).steps;
            steps.splice(
              1,
              0,
              structuredClone(step(w, "verify", "make release-check")),
            );
          },
        ],
        [
          `${name} adds make setup`,
          (w: Workflow) => {
            job(w, name).steps.splice(1, 0, { run: "make setup" });
          },
        ],
        [
          `${name} adds a second checkout`,
          (w: Workflow) => {
            const steps = job(w, name).steps;
            steps.splice(1, 0, structuredClone(steps[0]!));
          },
        ],
        [
          `${name} checkout fetch-depth 1`,
          (w: Workflow) => {
            checkoutOf(w, name).with!["fetch-depth"] = 1;
          },
        ],
        [
          `${name} checkout without fetch-depth`,
          (w: Workflow) => {
            delete checkoutOf(w, name).with!["fetch-depth"];
          },
        ],
        [
          `${name} checkout persist-credentials true`,
          (w: Workflow) => {
            checkoutOf(w, name).with!["persist-credentials"] = true;
          },
        ],
        [
          `${name} checkout ref inputs.sha`,
          (w: Workflow) => {
            checkoutOf(w, name).with!.ref = "${{ inputs.sha }}";
          },
        ],
        [
          `${name} checkout ref main`,
          (w: Workflow) => {
            checkoutOf(w, name).with!.ref = "main";
          },
        ],
        [
          `${name} checkout extra with key`,
          (w: Workflow) => {
            checkoutOf(w, name).with!.token = "${{ github.token }}";
          },
        ],
      ]),
    ),
    "make setup in place of make release-setup": (w) => {
      step(w, "verify", "make release-setup").run = "make setup";
    },
    // BR-358 step inputs and credentials
    "a secrets reference": (w) => {
      step(w, "verify", "make release-check").env!.GITHUB_TOKEN =
        "${{ secrets.GITHUB_TOKEN }}";
    },
    "a run with inputs.version": (w) => {
      step(w, "verify", "make pack").run =
        "make pack VERSION=${{ inputs.version }}";
    },
    "GITHUB_TOKEN on make release-setup": (w) => {
      step(w, "verify", "make release-setup").env = {
        GITHUB_TOKEN: "${{ github.token }}",
      };
    },
    "GITHUB_TOKEN on make pack": (w) => {
      step(w, "verify", "make pack").env = {
        GITHUB_TOKEN: "${{ github.token }}",
      };
    },
    "GITHUB_TOKEN on make image-binfmt": (w) => {
      step(w, "publish-image", "make image-binfmt").env!.GITHUB_TOKEN =
        "${{ github.token }}";
    },
    "GITHUB_TOKEN on make release-npm": (w) => {
      step(w, "publish-npm", "make release-npm").env!.GITHUB_TOKEN =
        "${{ github.token }}";
    },
    "GITHUB_TOKEN on the download step": (w) => {
      job(w, "publish-npm").steps[2]!.env = {
        GITHUB_TOKEN: "${{ github.token }}",
      };
    },
    "RELEASE_TARBALL_SHA256 on make release-check": (w) => {
      step(w, "publish-npm", "make release-check").env!.RELEASE_TARBALL_SHA256 =
        "${{ needs.verify.outputs.tarball-sha256 }}";
    },
    "RELEASE_TARBALL_SHA256 on verify make release-npm": (w) => {
      step(w, "verify", "make release-npm").env!.RELEASE_TARBALL_SHA256 =
        "${{ needs.verify.outputs.tarball-sha256 }}";
    },
    "RELEASE_TARBALL_SHA256 missing on make release-verify": (w) => {
      delete step(w, "read-back", "make release-verify").env!
        .RELEASE_TARBALL_SHA256;
    },
    "publish-npm make release-npm without RELEASE_TARBALL_SHA256": (w) => {
      delete step(w, "publish-npm", "make release-npm").env!
        .RELEASE_TARBALL_SHA256;
    },
    "RELEASE_PHASE swapped between jobs": (w) => {
      step(w, "publish-image", "make release-check").env!.RELEASE_PHASE = "npm";
      step(w, "publish-npm", "make release-check").env!.RELEASE_PHASE = "image";
    },
    ...Object.fromEntries(
      PUBLISHING.map((name) => [
        `${name} make release-check without RELEASE_PHASE`,
        (w: Workflow) => {
          delete step(w, name, "make release-check").env!.RELEASE_PHASE;
        },
      ]),
    ),
    "IMAGE_PLATFORMS other on make image-binfmt": (w) => {
      step(w, "verify", "make image-binfmt").env!.IMAGE_PLATFORMS =
        "linux/amd64";
    },
    "IMAGE_PLATFORMS other on make release-image": (w) => {
      step(w, "publish-image", "make release-image").env!.IMAGE_PLATFORMS =
        "linux/arm64 linux/amd64";
    },
    "an unpinned action": (w) => {
      job(w, "verify").steps[0]!.uses = "actions/checkout@v4";
    },
    "another action": (w) => {
      job(w, "verify").steps[0]!.uses = `someone/checkout@${PIN}`;
    },
    "RELEASE_DRY_RUN from the input on verify make release-npm": (w) => {
      step(w, "verify", "make release-npm").env!.RELEASE_DRY_RUN =
        "${{ inputs.dry_run }}";
    },
    "RELEASE_DRY_RUN from the input on verify make release-image": (w) => {
      step(w, "verify", "make release-image").env!.RELEASE_DRY_RUN =
        "${{ inputs.dry_run }}";
    },
    "continue-on-error on a step": (w) => {
      step(w, "verify", "make pack")["continue-on-error"] = true;
    },
    "a step if": (w) => {
      step(w, "verify", "make pack").if = "always()";
    },
    "a step shell": (w) => {
      step(w, "verify", "make pack").shell = "bash";
    },
    "a step name with an expression": (w) => {
      step(w, "verify", "make pack").name = "Pack ${{ inputs.version }}";
    },
    "RELEASE_NPM_REGISTRY_URL on make release-check": (w) => {
      step(w, "verify", "make release-check").env!.RELEASE_NPM_REGISTRY_URL =
        "http://127.0.0.1:1";
    },
    "download-artifact with run-id": (w) => {
      job(w, "publish-npm").steps[2]!.with!["run-id"] = "1";
    },
    "download-artifact with github-token": (w) => {
      job(w, "publish-npm").steps[2]!.with!["github-token"] =
        "${{ github.token }}";
    },
    "upload-artifact other path": (w) => {
      job(w, "verify").steps.at(-1)!.with!.path = "artifacts/";
    },
  };

  it.each(Object.keys(mutations))(
    "BR-355 rejects release workflow mutation: %s",
    (name) => {
      const workflow = JSON.parse(
        JSON.stringify(EXPECTED_RELEASE_WORKFLOW).replaceAll(
          "@<40-hex>",
          `@${PIN}`,
        ),
      ) as Workflow;
      expect(() => {
        validateReleaseWorkflow(JSON.stringify(workflow));
      }).not.toThrow();
      const before = JSON.stringify(workflow);
      mutations[name]!(workflow);
      const text = JSON.stringify(workflow, null, 2);
      expect(JSON.stringify(workflow)).not.toBe(before);
      expect(() => {
        validateReleaseWorkflow(text);
      }).toThrow();
    },
  );

  it("BR-356 BR-371 only publish-image writes packages and only publish-npm mints OIDC", () => {
    const workflow = real();
    for (const [name, entry] of Object.entries(workflow.jobs)) {
      expect(entry.permissions.packages === "write").toBe(
        name === "publish-image",
      );
      expect(entry.permissions["id-token"] === "write").toBe(
        name === "publish-npm",
      );
    }
    expect(job(workflow, "publish-npm").needs).toContain("publish-image");
  });
});

// AC-02: tracked-tree walk without Git (learnings 2026-11-03).
const SKIPPED = new Set([
  ".git",
  "node_modules",
  "dist",
  "artifacts",
  "coverage",
  ".scannerwork",
  ".sonar",
  "features",
  "business-rules",
]);
function treeFiles(directory = "."): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (SKIPPED.has(entry)) return [];
    const path = directory === "." ? entry : join(directory, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}
const prose = (text: string) => text.replace(/\s+/gu, " ");

describe("F-024 AC-02 release documentation", () => {
  it("BR-354 documentation uses the scoped name", () => {
    const version = (
      JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
    ).version;
    const readme = readFileSync("README.md", "utf8");
    const tarball = `./artifacts/sstolz-kdrive-mcp-server-${version}.tgz`;
    expect(readme).toContain(tarball);
    const named = readme
      .split(/\s/u)
      .filter((word) => word.includes("sstolz-kdrive-mcp-server-"))
      .map((word) => word.replaceAll("`", ""));
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(name).toBe(tarball);
    if (readFileSync("VERSION", "utf8").includes("-beta."))
      expect(readme).toContain("npm install -g @sstolz/kdrive-mcp-server@beta");

    const old = ["artifacts/", "kdrive-mcp-server-"].join("");
    const offenders = treeFiles().filter(
      (path) =>
        path !== "CHANGELOG.md" &&
        !path.endsWith(".tgz") &&
        readFileSync(path, "utf8").includes(old),
    );
    expect(offenders).toEqual([]);

    const npx = readFileSync("SPEC.md", "utf8")
      .split("\n")
      .filter((line) => line.startsWith("npx "));
    expect(npx.length).toBeGreaterThan(0);
    for (const line of npx)
      expect(
        line.startsWith(
          readFileSync("VERSION", "utf8").includes("-beta.")
            ? "npx @sstolz/kdrive-mcp-server"
            : "npx -y @sstolz/kdrive-mcp-server@",
        ),
      ).toBe(true);

    const raw = readFileSync("docs/publishing.md", "utf8");
    const doc = prose(raw);
    expect(doc).not.toContain("Pending change");
    expect(raw).toMatch(
      /^\| npm package \| `@sstolz\/kdrive-mcp-server` \(scoped\) \| In use +\|$/mu,
    );
    expect(doc).toContain(
      "`latest` points at the deprecated placeholder `0.0.0-placeholder.0` until 1.0.0",
    );
    expect(doc).toContain(
      "install `@sstolz/kdrive-mcp-server@beta` or an exact version",
    );
    expect(doc).not.toMatch(/latest[^.]*first beta/iu);

    const section =
      /^## Release workflow\n([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(raw)?.[1] ??
      "";
    expect(section).not.toBe("");
    const order = ["P-0", "P-1", "P-4", "P-2", "P-5", "P-3"].map((id) =>
      section.indexOf(`**${id}**`),
    );
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(section).toContain(
      [
        "```sh",
        "npm login",
        "npm publish --access public --tag latest",
        'npm deprecate @sstolz/kdrive-mcp-server@0.0.0-placeholder.0 "Placeholder, not a release. Install @sstolz/kdrive-mcp-server@beta."',
        "npm view @sstolz/kdrive-mcp-server dist-tags.latest",
        "npm logout",
        "```",
      ].join("\n"),
    );
    const text = prose(section);
    for (const phrase of [
      // P-3 after the first image push, verified by read-back
      "P-3 is done after the first image push and is verified by `read-back`",
      // dispatched from main while the release commit is main's HEAD
      "dispatched from `main` while the release commit is `main`'s HEAD",
      "otherwise BR-361 refuses it because `GITHUB_SHA` differs",
      // green real dry run first
      "green real `dry_run=true` dispatch of the same version and commit is required, and its run link recorded, before any `dry_run=false` dispatch",
      // read-back recovery
      "re-run only the failed `read-back` job",
      "`npm view @sstolz/kdrive-mcp-server@<version>`",
      "`docker buildx imagetools inspect ghcr.io/sstolz/kdrive-mcp-server:<version>`",
      "a new dispatch of that version is refused by BR-363, as intended",
      // check the registry first
      "first check with `npm view` whether the registry accepted it anyway",
      "`read-back`, skipped because its `needs` failed, is not re-run",
      // image pushed, npm not published
      "the second approval is rejected",
      "`release-check` fails in `publish-npm`",
      "`npm publish` reports a failure and `npm view` does not find the version",
      "re-run the `publish-npm` job",
      // expired approval
      "when the second approval expires",
      "GitHub cancels a run waiting 30 days and allows no re-run after 30 days",
      // image push failed, GHCR lacks the version
      "when the image push reports a failure and GHCR does not have the version, re-run the failed `publish-image` job or dispatch again",
      // image in GHCR but npm never ran
      "when the image push reports a failure but GHCR has the version, `publish-npm` never ran and npm is unpublished",
      // main-HEAD limit
      "deleting the GHCR version and dispatching again works only while the release commit is still `main`'s HEAD",
    ])
      expect(text).toContain(phrase);
  });
});

// F-024 v3 AC-24, AC-30, AC-33. Keep the beta assertions above until VERSION is stable.
describe("F-024 v3 documentation and digest plumbing", () => {
  it("BR-354 v2 install text follows VERSION", () => {
    for (const root of [".", "tests/fixtures/release/stable-install"]) {
      const version = readFileSync(join(root, "VERSION"), "utf8").trim();
      for (const file of ["README.md", "SPEC.md"]) {
        const doc = readFileSync(join(root, file), "utf8");
        if (version.includes("-beta.")) {
          if (file === "README.md")
            expect(doc).toContain(
              "npm install -g @sstolz/kdrive-mcp-server@beta",
            );
          expect(doc).toContain("@sstolz/kdrive-mcp-server");
        } else {
          const install = doc
            .split("\n")
            .filter((line) => line.startsWith("npm install -g "));
          expect(install).toEqual(["npm install -g @sstolz/kdrive-mcp-server"]);
          expect(doc).toContain(`npx -y @sstolz/kdrive-mcp-server@${version}`);
        }
      }
    }
  });
  it("BR-354 v2 guide covers first stable recovery", () => {
    const raw = readFileSync("docs/publishing.md", "utf8");
    const text = prose(raw);
    for (const fragment of [
      "1.0.0",
      "latest",
      "beta",
      "RELEASE_IMAGE_DIGEST",
      "containerimage.digest",
      "release-image: image digest",
      "packages: write",
      "mutable",
      "digest",
      "Re-run failed jobs",
      "Re-run all jobs",
      "package version",
      "404",
      "versions",
      "time",
      "read-back",
      "#91",
      "dry_run=true",
      "dry_run=false",
    ])
      expect(text).toContain(fragment);
    expect(text).toMatch(/latest.{0,200}not protected.{0,100}release/iu);
    expect(text).toMatch(/same-repository workflow.{0,150}overwrite/iu);
    expect(text).toMatch(/re-run.{0,150}publish-npm/iu);
    expect(text).toMatch(/never.{0,80}(delete|republish)/iu);
    // AC-37 BR-354 v3 replaces the first-stable-only no-repoint expectation.
    expect(text).toContain("--prefer-index=false");
    // The accepted beta recovery bullets remain verbatim, independently of stable recovery.
    const beta = readFileSync(
      "tests/fixtures/release/beta-recovery.md",
      "utf8",
    );
    const bullets = beta.match(/^- [\s\S]*?(?=^-(?: |$)|(?![\s\S]))/gmu) ?? [];
    expect(bullets).toHaveLength(7);
    for (const bullet of bullets) expect(text).toContain(prose(bullet).trim());
    const order = [...raw.matchAll(/\*\*(P-[0-5])\*\*/gu)].map(
      (match) => match[1],
    );
    expect(order).toEqual(["P-0", "P-1", "P-4", "P-2", "P-5", "P-3"]);
  });
  const digest = "${{ needs.publish-image.outputs.image_digest }}";
  it.each(["output", "step id", "needs", "recipients", "closed set"])(
    "BR-356 v2 BR-358 v2 stable digest plumbing: %s",
    (part) => {
      const w = real();
      if (part === "output")
        expect(job(w, "publish-image").outputs).toEqual({
          image_digest: "${{ steps.release-image.outputs.image_digest }}",
        });
      if (part === "step id") {
        expect(step(w, "publish-image", "make release-image").id).toBe(
          "release-image",
        );
        expect(step(w, "verify", "make release-npm").id).toBe("release-npm");
      }
      if (part === "needs")
        expect(job(w, "read-back").needs).toEqual([
          "verify",
          "publish-image",
          "publish-npm",
        ]);
      if (part === "recipients") {
        const recipients = Object.entries(w.jobs).flatMap(([name, j]) =>
          j.steps
            .filter((s) => s.env?.RELEASE_IMAGE_DIGEST !== undefined)
            .map((s) => [name, s.run, s.env!.RELEASE_IMAGE_DIGEST]),
        );
        expect(recipients).toEqual([
          ["publish-npm", "make release-check", digest],
          ["read-back", "make release-verify", digest],
        ]);
      }
      if (part === "closed set")
        expect(() => {
          validateReleaseWorkflow(JSON.stringify(w));
        }).not.toThrow();
    },
  );
  it.each([
    "missing output",
    "wrong output",
    "missing id",
    "digest on npm publish",
    "missing npm digest",
    "missing read-back digest",
    "missing dependency",
  ])("BR-356 v2 BR-358 v2 stable digest plumbing: rejects %s", (mutation) => {
    const w = JSON.parse(
      JSON.stringify(EXPECTED_RELEASE_WORKFLOW).replaceAll(
        "@<40-hex>",
        `@${PIN}`,
      ),
    ) as Workflow;
    expect(() => {
      validateReleaseWorkflow(JSON.stringify(w));
    }).not.toThrow();
    if (mutation === "missing output") delete job(w, "publish-image").outputs;
    if (mutation === "wrong output")
      job(w, "publish-image").outputs = { image_digest: "wrong" };
    if (mutation === "missing id")
      delete step(w, "publish-image", "make release-image").id;
    if (mutation === "digest on npm publish")
      step(w, "publish-npm", "make release-npm").env!.RELEASE_IMAGE_DIGEST =
        digest;
    if (mutation === "missing npm digest")
      delete step(w, "publish-npm", "make release-check").env!
        .RELEASE_IMAGE_DIGEST;
    if (mutation === "missing read-back digest")
      delete step(w, "read-back", "make release-verify").env!
        .RELEASE_IMAGE_DIGEST;
    if (mutation === "missing dependency")
      job(w, "read-back").needs = ["verify", "publish-npm"];
    expect(() => {
      validateReleaseWorkflow(JSON.stringify(w));
    }).toThrow();
  });
});

it.each(["release-check", "release-npm", "release-verify", "release-image"])(
  "BR-375 v2 release target variables: %s",
  (target) => {
    const rule = rules(readFileSync("Makefile", "utf8")).find(
      (r) => r.target === target,
    )!;
    if (target === "release-image") {
      // A make environment variable must reach the host shell; the rehearsal checks the actual output.
      expect(rule.recipe).toEqual(["/bin/sh scripts/release-image.sh"]);
    } else {
      const names = [...rule.recipe[0]!.matchAll(/ -e ([A-Z_0-9]+)/gu)].map(
        (match) => match[1],
      );
      expect(names).toEqual(
        target === "release-check"
          ? CHECK_VARIABLES
          : target === "release-verify"
            ? VERIFY_VARIABLES
            : NPM_VARIABLES,
      );
    }
  },
);

// F-024 v4 AC-37, AC-43, AC-44, AC-48. This checks guide content, not a release go.
it("BR-354 v3 lifecycle guide (AC-37 AC-48)", () => {
  const raw = readFileSync("docs/publishing.md", "utf8");
  const text = prose(raw);
  for (const fragment of [
    "every published stable version",
    "every published version",
    "versions",
    "time",
    "created",
    "modified",
    "0.0.0-placeholder.0",
    "0.0.0-stage",
    "1.1.1",
    "1.2.0-beta.1",
    "1.0.1",
    "1.1.0",
    "--prefer-index=false",
    "previous_digest",
    "RELEASE_IMAGE_DIGEST",
    "Re-run failed jobs",
    "Re-run all jobs",
    "package version",
    "restore-only",
    "new version",
    "deprecated",
    "healthy",
    "main HEAD",
    "tarball",
    "provenance",
    "both approvals",
    "read-back evidence",
    "exact-version, exact-SHA go",
    "successful real dry run",
    "Agents never",
    "npm install -g @sstolz/kdrive-mcp-server",
    "npx -y @sstolz/kdrive-mcp-server@<version>",
    "@beta",
    "mutable",
    "packages: write",
    "ghcr.io/sstolz/kdrive-mcp-server@sha256:<hex>",
  ])
    expect(text).toContain(fragment);
  // The guide pins every changed diagnostic, including safe owner recovery states.
  for (const diagnostic of [
    "npm latest tag missing",
    "npm latest is not a supported stable default",
    "npm latest version record incomplete",
    "original placeholder is not deprecated",
    "npm placeholder latest cannot follow stable history",
    "npm latest is not the greatest published stable version",
    "npm latest stable is deprecated; owner recovery required",
    "stable version is not greater than every published stable version",
    "beta version is not greater than every published version",
    "npm stable default unavailable",
    "GHCR latest exists without a stable npm default",
    "previous stable image unavailable",
    "GHCR latest missing for stable npm default",
    "previous stable image manifest invalid",
    "GHCR latest does not match npm stable default",
    "candidate is deprecated",
    "recovery blocked: npm outcome uncertain",
    "recovery blocked: same-run npm retry unavailable",
    "recovery blocked: image identity uncertain",
    "recovery blocked: latest repoint failed",
    "recovery blocked: latest restoration unconfirmed",
    "recovery blocked: cleanup unconfirmed",
    "recovery: GHCR latest restored",
  ])
    expect(text).toContain(diagnostic);
  const table = raw
    .split("\n")
    .filter((row) => /^\|\s*(Stable|Beta)\s*\|/u.test(row));
  for (const kind of ["Stable", "Beta"]) {
    const rows = table.filter((row) => row.includes(kind));
    for (const phase of ["verify", "image", "npm", "read-back"])
      expect(
        rows.some((row) => row.includes(phase)),
        `${kind} ${phase}`,
      ).toBe(true);
  }
  expect(text).toMatch(/deprecated.{0,250}stable.{0,250}(fix|successor)/iu);
  expect(text).toMatch(/no healthy earlier stable/iu);
  expect(text).toMatch(/beta.{0,200}(blocked|refuse).{0,200}healthy/iu);
  expect(text).toMatch(
    /(advanced main|main advance).{0,200}(not|doesn't|does not).{0,100}(block|prevent).{0,100}(same.run|retry)/iu,
  );
  expect(text).toMatch(/buildx.{0,100}v?\d+\.\d+\.\d+/iu);
  expect(text).toMatch(/older.{0,150}(refus|block)/iu);
  expect(text).toMatch(
    /(post.stable beta|beta cleanup).{0,600}(no|without).{0,50}repoint/iu,
  );
  expect(text).toMatch(/(burn|never reuse).{0,100}(candidate|version)/iu);
  expect(text).not.toContain(
    "No previous stable or default-tag repointing exists in this scope",
  );
  expect(text).not.toContain(
    "No new gated stable or beta release is available until #91",
  );
  // Preserve the accepted pre-stable instructions byte for byte after whitespace folding.
  const beta = readFileSync("tests/fixtures/release/beta-recovery.md", "utf8");
  for (const bullet of beta.match(/^- [\s\S]*?(?=^-(?: |$)|(?![\s\S]))/gmu) ??
    [])
    expect(text).toContain(prose(bullet).trim());
  const preconditions = [...raw.matchAll(/\*\*(P-[0-5])\*\*/gu)].map(
    (m) => m[1],
  );
  expect(preconditions).toEqual(["P-0", "P-1", "P-4", "P-2", "P-5", "P-3"]);
});

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// F-015 BR-226: change classification for the CI job conditions.
function classify(event: string, paths: string[]) {
  const input = paths.length === 0 ? "" : `${paths.join("\n")}\n`;
  const result = spawnSync("/bin/sh", ["scripts/ci-changes.sh", event], {
    input,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return result.stdout;
}

describe("BR-226 scripts/ci-changes.sh", () => {
  it.each<[string, string, string[], string]>([
    [
      "records-only PR",
      "pull_request",
      ["runs/x.md", "BACKLOG.md"],
      "heavy=false\nimage=false\n",
    ],
    [
      "docs PR",
      "pull_request",
      ["docs/deployment.md"],
      "heavy=true\nimage=false\n",
    ],
    ["source PR", "pull_request", ["src/cli.ts"], "heavy=true\nimage=true\n"],
    [
      "records plus README PR",
      "pull_request",
      ["features/x.md", "README.md"],
      "heavy=true\nimage=true\n",
    ],
    ["empty PR list", "pull_request", [], "heavy=true\nimage=true\n"],
    ["push", "push", ["runs/x.md"], "heavy=true\nimage=true\n"],
    [
      "workflow_dispatch",
      "workflow_dispatch",
      ["runs/x.md"],
      "heavy=true\nimage=true\n",
    ],
    [
      "every records path",
      "pull_request",
      [
        "runs/a.md",
        "features/F-1.md",
        "business-rules/BR-1.md",
        "architecture-decisions/ADR-1.md",
        "learnings.md",
        "BACKLOG.md",
        "CHANGELOG.md",
        "capability-map.md",
      ],
      "heavy=false\nimage=false\n",
    ],
  ])("BR-226 classifies %s", (_name, event, paths, expected) => {
    expect(classify(event, paths)).toBe(expected);
  });

  it("BR-226 a path `runs` without a slash is not a records path", () => {
    expect(classify("pull_request", ["runs"])).toMatch(/^heavy=true\n/u);
  });

  it("BR-226 a nested records-like path is not a records path", () => {
    expect(classify("pull_request", ["docs/runs/x.md"])).toMatch(
      /^heavy=true\n/u,
    );
  });

  it.each([
    "Dockerfile",
    ".dockerignore",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "LICENSE",
    "NOTICE",
    "README.md",
    "Makefile",
    "scripts/image-smoke.sh",
    "scripts/http-acceptance.ts",
    "scripts/ci-changes.sh",
    ".github/workflows/ci.yml",
    "src/http/server.ts",
  ])("BR-226 %s is an image input", (path) => {
    expect(classify("pull_request", ["runs/x.md", path])).toBe(
      "heavy=true\nimage=true\n",
    );
  });

  it.each(["scripts/sonar-entry.sh", "tests/x.test.ts", "Dockerfile.dev"])(
    "BR-226 %s is heavy but not an image input",
    (path) => {
      expect(classify("pull_request", [path])).toBe(
        "heavy=true\nimage=false\n",
      );
    },
  );
});

describe("BR-226 make ci-changes", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function fixture(gitScript: string) {
    root = mkdtempSync(join(tmpdir(), "kdrive-ci-changes-"));
    copyFileSync("Makefile", join(root, "Makefile"));
    mkdirSync(join(root, "scripts"));
    copyFileSync("scripts/ci-changes.sh", join(root, "scripts/ci-changes.sh"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const git = join(bin, "git");
    writeFileSync(
      git,
      ["#!/bin/sh", 'printf "%s\\n" "$*" >> "$FAKE_LOG"', gitScript, ""].join(
        "\n",
      ),
    );
    chmodSync(git, 0o755);
    const output = join(root, "github-output");
    writeFileSync(output, "");
    const log = join(root, "git-calls");
    const run = (env: Record<string, string>) =>
      spawnSync("/usr/bin/make", ["ci-changes"], {
        cwd: root,
        env: { PATH: `${bin}:/usr/bin:/bin`, FAKE_LOG: log, ...env },
        encoding: "utf8",
      });
    const read = (path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    };
    return { run, output, calls: () => read(log), outputs: () => read(output) };
  }

  it("BR-226 feeds the PR diff to the classifier and appends to GITHUB_OUTPUT", () => {
    const f = fixture("printf 'runs/x.md\\000BACKLOG.md\\000'");
    const result = f.run({
      GITHUB_OUTPUT: f.output,
      GITHUB_EVENT_NAME: "pull_request",
    });
    expect(result.status).toBe(0);
    expect(f.outputs()).toBe("heavy=false\nimage=false\n");
    expect(f.calls()).toBe("diff --no-renames --name-only -z HEAD^1 HEAD\n");
  });

  it("BR-226 a rename into runs/ listed by --no-renames as both paths is heavy", () => {
    const f = fixture("printf 'src/a.ts\\000runs/a.ts\\000'");
    const result = f.run({
      GITHUB_OUTPUT: f.output,
      GITHUB_EVENT_NAME: "pull_request",
    });
    expect(result.status).toBe(0);
    expect(f.outputs()).toBe("heavy=true\nimage=true\n");
  });

  it("BR-226 a failing git command runs everything", () => {
    const f = fixture("printf 'runs/x.md\\000'; exit 128");
    const result = f.run({
      GITHUB_OUTPUT: f.output,
      GITHUB_EVENT_NAME: "pull_request",
    });
    expect(result.status).toBe(0);
    expect(f.outputs()).toBe("heavy=true\nimage=true\n");
  });

  it("BR-226 a push runs everything without calling git", () => {
    const f = fixture("printf 'runs/x.md\\000'");
    const result = f.run({
      GITHUB_OUTPUT: f.output,
      GITHUB_EVENT_NAME: "push",
    });
    expect(result.status).toBe(0);
    expect(f.outputs()).toBe("heavy=true\nimage=true\n");
    expect(f.calls()).toBe("");
  });

  it.each(["GITHUB_OUTPUT", "GITHUB_EVENT_NAME"])(
    "BR-226 requires %s",
    (missing) => {
      const f = fixture("printf 'runs/x.md\\000'");
      const env: Record<string, string> = {
        GITHUB_OUTPUT: f.output,
        GITHUB_EVENT_NAME: "pull_request",
      };
      delete env[missing];
      const result = f.run(env);
      expect(result.status).not.toBe(0);
      expect(f.outputs()).toBe("");
    },
  );
});

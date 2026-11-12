import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { withinDeadline } from "../scripts/deadline.js";
import { verifyProperties } from "../scripts/sonar.js";

// Real fixture compilers/linters use the same bounded budget as the existing
// quality-command integration tests. Deadline tests use deterministic timers.
vi.setConfig({ testTimeout: 75_000 });

function directory(prefix: string) {
  return mkdtempSync(resolve("node_modules", prefix));
}

function executable(path: string, text: string) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

it("BR-009 v1 P-02 completes ordered parallel Make gates in pinned dev", () => {
  const root = directory(".boundary-make-");
  copyFileSync("Makefile", join(root, "Makefile"));
  for (const file of [
    "compose.yaml",
    "Dockerfile.dev",
    "package.json",
    "package-lock.json",
  ])
    writeFileSync(join(root, file), "synthetic fixture\n");
  const docker = join(root, "docker");
  const log = join(root, "calls");
  executable(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n');
  const result = spawnSync(
    "/usr/bin/make",
    ["-j8", "check", `DOCKER=${docker}`],
    {
      cwd: root,
      env: { PATH: "/usr/bin:/bin", FAKE_LOG: log },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const calls = readFileSync(log, "utf8");
  const gates = [
    "npm run lint",
    "npm run format:check",
    "npm run typecheck",
    "npm run build",
    "npm test",
    "npm pack --pack-destination artifacts",
  ];
  const positions = gates.map((gate) => calls.indexOf(gate));
  for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  expect(calls).not.toMatch(/volume rm|down --volumes|prune/u);
});

const dockerfile = readFileSync("Dockerfile.dev", "utf8");

function versionAssertion(tool: "node" | "npm" | "git") {
  const line = dockerfile
    .split("\n")
    .find((candidate) => candidate.includes(`$(${tool} --version)`));
  if (!line) throw new Error(`Missing dev ${tool} version assertion`);
  return line.trim().replace(/^&& /u, "").replace(/ \\$/u, "");
}

function assertToolchain(versions: Record<"node" | "npm" | "git", string>) {
  const root = directory(".boundary-pins-");
  for (const tool of ["node", "npm", "git"] as const)
    executable(
      join(root, tool),
      `#!/bin/sh\nprintf '%s\\n' "$SYNTHETIC_${tool.toUpperCase()}_VERSION"\n`,
    );
  const script = join(root, "assert-pins.sh");
  writeFileSync(
    script,
    (["node", "npm", "git"] as const)
      .map((tool) => versionAssertion(tool))
      .join(" && ") + "\n",
  );
  return spawnSync("/bin/sh", [script], {
    env: {
      PATH: `${root}:/usr/bin:/bin`,
      SYNTHETIC_NODE_VERSION: versions.node,
      SYNTHETIC_NPM_VERSION: versions.npm,
      SYNTHETIC_GIT_VERSION: versions.git,
    },
    encoding: "utf8",
    timeout: 5000,
  });
}

const pinnedVersions = {
  node: "v26.13.0",
  npm: "11.20.0",
  git: "git version 2.39.5",
};

it("BR-009 v1 P-03 rejects a mismatched dev Node pin", () => {
  expect(assertToolchain({ ...pinnedVersions, node: "v26.12.9" }).status).toBe(
    1,
  );
});

it("BR-009 v1 P-04 accepts the exact dev toolchain pins", () => {
  expect(assertToolchain(pinnedVersions).status).toBe(0);
});

it("BR-009 v1 P-05 rejects a mismatched dev npm pin", () => {
  expect(assertToolchain({ ...pinnedVersions, npm: "11.19.0" }).status).toBe(1);
});

it("BR-009 v1 P-06 rejects a mismatched dev Git pin", () => {
  expect(
    assertToolchain({ ...pinnedVersions, git: "git version 2.39.4" }).status,
  ).toBe(1);
});

function identityGuard(uid: string, gid: string) {
  const guard = /^RUN (case .+ esac) \\$/mu.exec(dockerfile)?.[1];
  if (!guard) throw new Error("Missing dev identity guard");
  const script = join(directory(".boundary-identity-"), "identity.sh");
  writeFileSync(script, guard + "\n");
  return spawnSync("/bin/sh", [script], {
    env: { PATH: "/usr/bin:/bin", DEV_UID: uid, DEV_GID: gid },
    encoding: "utf8",
    timeout: 5000,
  });
}

it("BR-009 v1 P-07 accepts a positive non-root identity guard pair", () => {
  expect(identityGuard("1", "1").status).toBe(0);
});

it("BR-009 v1 P-08 rejects root UID mapping", () => {
  expect(identityGuard("0", "1000").status).toBe(1);
});

it("BR-009 v1 P-09 rejects root GID mapping", () => {
  expect(identityGuard("1000", "0").status).toBe(1);
});

it("BR-009 v1 P-10 rejects nonnumeric identity mapping", () => {
  expect(identityGuard("abc", "1000").status).toBe(1);
});

function qualityFixture(source: string, test?: string) {
  const root = directory(".boundary-quality-");
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "tests"));
  for (const file of [
    "eslint.config.mjs",
    "tsconfig.json",
    "tsconfig.build.json",
    "vitest.config.ts",
    ".prettierrc.json",
  ])
    copyFileSync(file, join(root, file));
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(root, "src/index.ts"), source);
  if (test !== undefined)
    writeFileSync(join(root, "tests/example.test.ts"), test);
  return root;
}

function qualityCommand(root: string, binary: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("node_modules", binary), ...args],
    {
      cwd: root,
      env: { PATH: "/usr/bin:/bin" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

it("BR-010 v1 P-01 accepts a zero-finding lint fixture", () => {
  const root = qualityFixture("export const value = 1;\n");
  const result = qualityCommand(root, "eslint/bin/eslint.js", [
    ".",
    "--max-warnings=0",
  ]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it("BR-010 v1 P-02 rejects a warning-only lint fixture", () => {
  const root = qualityFixture(
    // SonarJS reports task-marker comments as errors (BR-010 v2), so the
    // warning-only fixture uses a neutral custom term.
    "// SYNTHETIC: warning\nexport const value = 1;\n",
  );
  copyFileSync(join(root, "eslint.config.mjs"), join(root, "eslint.base.mjs"));
  writeFileSync(
    join(root, "eslint.config.mjs"),
    'import base from "./eslint.base.mjs";\nexport default [...base, {files: ["src/**/*.ts"], rules: {"no-warning-comments": ["warn", {terms: ["SYNTHETIC"], location: "start"}]}}];\n',
  );
  const result = qualityCommand(root, "eslint/bin/eslint.js", [
    "src/index.ts",
    "--max-warnings=0",
    "--format=json",
  ]);
  expect(result.status, result.stdout + result.stderr).toBe(1);
  const report = JSON.parse(result.stdout) as Array<{
    errorCount: number;
    warningCount: number;
  }>;
  expect(report).toHaveLength(1);
  expect(report[0]?.errorCount).toBe(0);
  expect(report[0]?.warningCount).toBe(1);
});

it("BR-010 v1 P-03 accepts correctly formatted source without rewriting", () => {
  const source = "export const value = 1;\n";
  const root = qualityFixture(source);
  const result = qualityCommand(root, "prettier/bin/prettier.cjs", [
    "--check",
    "src/index.ts",
  ]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(join(root, "src/index.ts"), "utf8")).toBe(source);
});

it("BR-010 v1 P-04 accepts a type-correct build fixture", () => {
  const root = qualityFixture("export const value: number = 1;\n");
  const result = qualityCommand(root, "typescript/bin/tsc", [
    "-p",
    "tsconfig.build.json",
  ]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(join(root, "dist/index.js"), "utf8")).toContain(
    "export const value = 1;",
  );
});

it("BR-010 v1 P-05 accepts one passing discovered fixture test", () => {
  const root = qualityFixture(
    "export const value = 1;\n",
    'import {expect, it} from "vitest"; it("synthetic passing test", () => {expect(1).toBe(1);});\n',
  );
  const result = qualityCommand(root, "vitest/vitest.mjs", ["run"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("1 passed");
});

it("BR-014 v1 P-01 rejects a shorter altered gate-wait property", () => {
  const properties = readFileSync("sonar-project.properties", "utf8");
  expect(() => {
    verifyProperties(properties);
  }).not.toThrow();
  expect(() => {
    verifyProperties(properties.replace("timeout=300", "timeout=299"));
  }).toThrow();
});

it("BR-014 v1 P-02 accepts completion before the shared deadline", async () => {
  vi.useFakeTimers();
  try {
    const operation = withinDeadline(
      900_000,
      async () =>
        await new Promise<string>((resolveWork) => {
          setTimeout(() => {
            resolveWork("completed");
          }, 899_999);
        }),
    );
    await vi.advanceTimersByTimeAsync(899_999);
    await expect(operation).resolves.toBe("completed");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("BR-014 v1 P-03 aborts work after the shared deadline", async () => {
  vi.useFakeTimers();
  try {
    let aborted = false;
    const laterUpload = vi.fn();
    const operation = withinDeadline(900_000, (signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("synthetic owned work aborted"));
        });
      }).then(laterUpload),
    );
    const refusal = expect(operation).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(900_001);
    await refusal;
    expect(aborted).toBe(true);
    expect(laterUpload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

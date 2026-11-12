import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it, vi } from "vitest";

// File-scoped integration budget: a test may run two bounded 30-second tools.
// Leave room for fixture setup and CI scheduling without relaxing other suites.
vi.setConfig({ testTimeout: 75_000 });

function fixture(source: string, test?: string) {
  const directory = mkdtempSync(resolve("node_modules/.quality-fixture-"));
  mkdirSync(join(directory, "src"));
  mkdirSync(join(directory, "tests"));
  for (const file of [
    "eslint.config.mjs",
    "tsconfig.json",
    "tsconfig.build.json",
    "vitest.config.ts",
    ".prettierrc.json",
  ]) {
    copyFileSync(resolve(file), join(directory, file));
  }
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(directory, "src/index.ts"), source);
  if (test !== undefined)
    writeFileSync(join(directory, "tests/example.test.ts"), test);
  return directory;
}
function command(directory: string, binary: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("node_modules", binary), ...args],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, SONAR_TOKEN: undefined },
    },
  );
}

it("BR-010 typed lint rejects a valid unhandled Promise independently of compiler and formatting", () => {
  const directory = fixture("export {};\nPromise.resolve(1);\n");
  const compiler = command(directory, "typescript/bin/tsc", [
    "--noEmit",
    "-p",
    "tsconfig.json",
  ]);
  expect(compiler.status, compiler.stdout + compiler.stderr).toBe(0);
  const result = command(directory, "eslint/bin/eslint.js", [
    ".",
    "--max-warnings=0",
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("no-floating-promises");
});
it("BR-010 formatter rejects malformed formatting without rewriting", () => {
  const directory = fixture("export const value={a:1};\n");
  const result = command(directory, "prettier/bin/prettier.cjs", [
    "--check",
    "src/index.ts",
  ]);
  expect(result.status).toBe(1);
});
it("BR-010 compiler and build both reject a source type error", () => {
  const directory = fixture('export const value: number = "wrong";\n');
  for (const config of ["tsconfig.json", "tsconfig.build.json"]) {
    const result = command(directory, "typescript/bin/tsc", ["-p", config]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("TS2322");
  }
});
it("BR-010 typecheck includes tests", () => {
  const directory = fixture(
    "export const value = 1;\n",
    'const value: number = "wrong";\nexport { value };\n',
  );
  const result = command(directory, "typescript/bin/tsc", [
    "--noEmit",
    "-p",
    "tsconfig.json",
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("tests/example.test.ts");
});
it.each([
  'import { it, expect } from "vitest"; it("synthetic failure", () => { expect(1).toBe(2); });',
  undefined,
])(
  "BR-010 tests reject failing assertions and zero discovered tests (%s)",
  (test) => {
    const directory = fixture("export const value = 1;\n", test);
    const result = command(directory, "vitest/vitest.mjs", ["run"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(
      test ? /synthetic failure/u : /No test files found/u,
    );
  },
);

// F-011 AC-01: a SonarJS-class defect that compiles and is formatted.
const duplicatedBranches = `export function choose(flag: boolean, run: () => void): void {
  if (flag) {
    run();
  } else {
    run();
  }
}
`;
const fixedBranches = `export function choose(flag: boolean, run: () => void): void {
  if (flag) {
    run();
  }
}
`;
function lint(source: string) {
  const directory = fixture(source);
  return command(directory, "eslint/bin/eslint.js", [".", "--max-warnings=0"]);
}
it("BR-010 v2 SonarJS rejects a seeded duplicated-branch fixture", () => {
  const directory = fixture(duplicatedBranches);
  const compiler = command(directory, "typescript/bin/tsc", [
    "--noEmit",
    "-p",
    "tsconfig.json",
  ]);
  expect(compiler.status, compiler.stdout + compiler.stderr).toBe(0);
  const result = command(directory, "eslint/bin/eslint.js", [
    ".",
    "--max-warnings=0",
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(
    "sonarjs/no-all-duplicated-branches",
  );
});
it("BR-010 v2 accepts the fixed fixture", () => {
  const result = lint(fixedBranches);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
it.each([
  [
    "a directive without a reason",
    "// eslint-disable-next-line @typescript-eslint/no-floating-promises\nvoid 0;\nPromise.resolve(1);\nexport {};\n",
    "kdrive/justified-suppressions",
  ],
  [
    "a directive without a rule",
    "/* eslint-disable -- synthetic reason */\nexport const value = 1;\n",
    "Unjustified blanket lint suppression",
  ],
  [
    "an unused directive",
    "// eslint-disable-next-line sonarjs/no-all-duplicated-branches -- synthetic reason\nexport const value = 1;\n",
    "Unused eslint-disable directive",
  ],
  // BR-144 v2: inline configuration comments stop the lint run, even when
  // they turn off the rule that would report them.
  [
    "an inline rule configuration turning off the suppression rule",
    '/* eslint kdrive/justified-suppressions: "off" */\nexport const value = 1; // NO' +
      "SONAR\n",
    "Inline ESLint configuration comment",
  ],
  [
    "an inline rule configuration in the newline form",
    '/*eslint\n @typescript-eslint/no-floating-promises: "off" */\nPromise.resolve(1);\nexport {};\n',
    "Inline ESLint configuration comment",
  ],
  [
    "an inline rule configuration after a tab",
    '/*\teslint\t@typescript-eslint/no-floating-promises: "off" */\nexport const value = 1;\n',
    "Inline ESLint configuration comment",
  ],
  [
    "an eslint-env comment",
    "/* eslint-env node */\nexport const value = 1;\n",
    "Inline ESLint configuration comment",
  ],
  [
    "a global comment",
    "/* global synthetic */\nexport const value = 1;\n",
    "Inline ESLint configuration comment",
  ],
  [
    "a globals comment",
    "/* globals synthetic */\nexport const value = 1;\n",
    "Inline ESLint configuration comment",
  ],
  [
    "a Sonar suppression marker",
    "export const value = 1; // NO" + "SONAR\n",
    "kdrive/justified-suppressions",
  ],
])("BR-144 lint rejects %s", (_name, source, expected) => {
  const result = lint(source);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(expected);
});
it("BR-144 v2 accepts block comments that are not configuration comments", () => {
  const result = lint(
    "/* eslintrc-like prose and globalThis notes are not directives */\n/* -- eslint is named here only in prose */\nexport const value = 1;\n",
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
it("BR-144 accepts a named and justified suppression", () => {
  const result = lint(
    "// eslint-disable-next-line @typescript-eslint/no-floating-promises -- synthetic justified fixture\nPromise.resolve(1);\nexport {};\n",
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

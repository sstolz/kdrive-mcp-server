import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const { default: config } = (await import(
  pathToFileURL(resolve("eslint.config.mjs")).href
)) as { default: Linter.Config[] };

// BR-144: the only rules that the pinned upstream configurations enable and
// that repository configuration lowers, and only for tests/**/*.ts.
const testsAllowlist = [
  "@typescript-eslint/no-dynamic-delete",
  "@typescript-eslint/no-non-null-assertion",
  "@typescript-eslint/restrict-plus-operands",
  "@typescript-eslint/restrict-template-expressions",
  "sonarjs/no-alphabetical-sort",
  "sonarjs/no-clear-text-protocols",
  "sonarjs/no-nested-conditional",
  "sonarjs/no-os-command-from-path",
];

function severity(value: Linter.RuleEntry | undefined): number {
  const level = Array.isArray(value) ? value[0] : value;
  if (level === "error" || level === 2) return 2;
  if (level === "warn" || level === 1) return 1;
  return 0;
}
function upstreamErrors(): string[] {
  const rules: Record<string, Linter.RuleEntry> = {};
  for (const entry of tseslint.configs.strictTypeChecked)
    Object.assign(rules, entry.rules);
  Object.assign(rules, sonarjs.configs.recommended.rules);
  return Object.entries(rules)
    .filter(([, value]) => severity(value) === 2)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}
async function lowered(file: string): Promise<string[]> {
  const eslint = new ESLint();
  const effective = (await eslint.calculateConfigForFile(file)) as {
    rules: Record<string, Linter.RuleEntry>;
  };
  return upstreamErrors().filter(
    (name) => severity(effective.rules[name]) !== 2,
  );
}

it("BR-010 v2 BR-144 keeps every upstream error rule at error for src and scripts", async () => {
  expect(upstreamErrors().length).toBeGreaterThan(250);
  expect(upstreamErrors()).toContain("sonarjs/no-all-duplicated-branches");
  expect(upstreamErrors()).toContain(
    "@typescript-eslint/no-non-null-assertion",
  );
  expect(await lowered("src/index.ts")).toEqual([]);
  expect(await lowered("scripts/sonar.ts")).toEqual([]);
});

it("BR-144 lowers exactly the bounded allowlist for tests", async () => {
  expect(await lowered("tests/lint-policy.test.ts")).toEqual(testsAllowlist);
});

it("BR-144 repository entries set no off or warn rule outside the tests allowlist", () => {
  const own = config.filter((entry) => entry.name?.startsWith("kdrive/"));
  expect(own.map((entry) => entry.name)).toEqual([
    "kdrive/typed",
    "kdrive/tests-allowlist",
  ]);
  for (const entry of own) {
    const values = Object.values(entry.rules ?? {}).map(severity);
    if (entry.name === "kdrive/tests-allowlist") {
      expect(entry.files).toEqual(["tests/**/*.ts"]);
      expect(Object.keys(entry.rules ?? {}).sort()).toEqual(testsAllowlist);
    } else expect(values.every((value) => value === 2)).toBe(true);
  }
  const text = readFileSync("eslint.config.mjs", "utf8");
  const allowlist = text.slice(text.indexOf('name: "kdrive/tests-allowlist"'));
  for (const rule of testsAllowlist) {
    const line = allowlist.indexOf(`"${rule}": "off"`);
    expect(line, rule).toBeGreaterThan(0);
    // A justification comment line directly precedes each allowlist entry.
    expect(allowlist.slice(0, line)).toMatch(/\/\/ [^\n]+\n\s*$/u);
  }
});

// Built from parts so this file does not contain the marker itself.
const marker = new RegExp("\\b" + "NO" + "SONAR" + "\\b", "u");
it("BR-144 no tracked TypeScript file contains the Sonar suppression marker", () => {
  // Walk the source trees directly: snapshot coverage runs outside Git.
  const files = ["src", "tests", "scripts"]
    .flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" }).map((path) =>
        join(root, path),
      ),
    )
    .filter((path) => /\.(ts|mjs)$/u.test(path))
    .concat(["eslint.config.mjs", "vitest.config.ts"]);
  expect(files.length).toBeGreaterThan(50);
  for (const file of files)
    expect(readFileSync(file, "utf8"), file).not.toMatch(marker);
});

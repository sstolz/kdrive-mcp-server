import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCoverage, verifyCoverage } from "../scripts/coverage.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coverage-contract-"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "src", "example.ts"), "export const value = 1;\n");
  await writeFile(join(root, "tests", "example.test.ts"), "// fixture test\n");
  await writeFile(join(root, "package-lock.json"), "{}\n");
  return root;
}

async function passing(root: string) {
  await mkdir(join(root, "coverage"), { recursive: true });
  await writeFile(
    join(root, "coverage", "lcov.info"),
    `TN:\nSF:${root}/src/example.ts\nDA:1,1\nend_of_record\n`,
  );
  return 0;
}

describe("BR-012 coverage provenance", () => {
  it("actual V8 coverage includes an unexecuted source file", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "src/unexecuted.ts"),
      "export const unexecuted = () => 42;\n",
    );
    await writeFile(
      join(root, "tests/example.test.ts"),
      'import { it, expect } from "vitest"; import { value } from "../src/example"; it("fixture", () => { expect(value).toBe(1); });\n',
    );
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(
      join(root, "vitest.config.ts"),
      'export default { test: { coverage: { provider: "v8", include: ["src/**/*.ts"], reporter: ["lcov"] } } };\n',
    );
    await symlink(resolve("node_modules"), join(root, "node_modules"));
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/vitest/vitest.mjs"), "run", "--coverage"],
      { cwd: root, encoding: "utf8", timeout: 30_000 },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const report = await readFile(join(root, "coverage/lcov.info"), "utf8");
    expect(report).toContain("src/unexecuted.ts");
    expect(report).toMatch(/SF:[^\n]*unexecuted\.ts[\s\S]*DA:\d+,0/);
  });

  it("records the actual successful run and project-relative LCOV", async () => {
    const root = await fixture();
    const result = await createCoverage(root, "run-one", () => passing(root));
    expect(await verifyCoverage(root, "run-one")).toEqual(result);
    expect(await readFile(join(root, "coverage/lcov.info"), "utf8")).toContain(
      "SF:src/example.ts",
    );
    await expect(verifyCoverage(root, "different-run")).rejects.toThrow();
  });

  it.each(["src/example.ts", "tests/example.test.ts", "package-lock.json"])(
    "rejects changed input %s",
    async (file) => {
      const root = await fixture();
      await createCoverage(root, "run-one", () => passing(root));
      await writeFile(join(root, file), "changed\n");
      await expect(verifyCoverage(root, "run-one")).rejects.toThrow();
    },
  );

  it("rejects input changes while tests are running", async () => {
    const root = await fixture();
    await expect(
      createCoverage(root, "run-one", async () => {
        await passing(root);
        await writeFile(join(root, "src/example.ts"), "changed during tests\n");
        return 0;
      }),
    ).rejects.toThrow();
    await expect(verifyCoverage(root, "run-one")).rejects.toThrow();
  });

  it("invalidates a previous success before a failed test run", async () => {
    const root = await fixture();
    await createCoverage(root, "run-one", () => passing(root));
    await expect(
      createCoverage(root, "run-two", () => Promise.resolve(1)),
    ).rejects.toThrow();
    await expect(verifyCoverage(root, "run-one")).rejects.toThrow();
    await expect(verifyCoverage(root, "run-two")).rejects.toThrow();
  });

  it("does not reuse a previous LCOV when a new runner produces none", async () => {
    const root = await fixture();
    await createCoverage(root, "run-one", () => passing(root));
    await expect(
      createCoverage(root, "run-two", () => Promise.resolve(0)),
    ).rejects.toThrow();
    await expect(verifyCoverage(root, "run-two")).rejects.toThrow();
  });

  it.each(["", "SF:/outside/source.ts\n", "TN:\n"])(
    "rejects unusable LCOV %j",
    async (lcov) => {
      const root = await fixture();
      await expect(
        createCoverage(root, "run-one", async () => {
          await passing(root);
          await writeFile(join(root, "coverage/lcov.info"), lcov);
          return 0;
        }),
      ).rejects.toThrow();
    },
  );

  it("rejects altered LCOV and malformed metadata", async () => {
    const root = await fixture();
    await createCoverage(root, "run-one", () => passing(root));
    await writeFile(
      join(root, "coverage/lcov.info"),
      "SF:src/example.ts\nDA:1,0\nend_of_record\n",
    );
    await expect(verifyCoverage(root, "run-one")).rejects.toThrow();
    await writeFile(join(root, "coverage/success.json"), "null");
    await expect(verifyCoverage(root, "run-one")).rejects.toThrow();
  });
});

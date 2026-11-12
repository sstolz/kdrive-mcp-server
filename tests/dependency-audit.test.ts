import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { ResizeOptions } from "@jimp/plugin-resize";
import { ResizeStrategy } from "@jimp/plugin-resize";
import type { ImageResizeOptions } from "../src/extraction-image.js";

// F-020 (#104): pinned dependency overrides, lockfile resolution, type-check
// settings and audit documentation.

interface Manifest {
  dependencies?: Record<string, string>;
  overrides?: unknown;
}
interface Lockfile {
  packages: Record<string, { version?: string }>;
}

const OVERRIDES = {
  "@jimp/types": { zod: "$zod" },
  "@jimp/plugin-resize": { zod: "$zod" },
  minimatch: "11.0.8",
};

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// BR-315: the exact overrides object, and zod a direct exact dependency.
function assertOverrides(manifest: Manifest): void {
  check(
    JSON.stringify(sortKeys(manifest.overrides)) ===
      JSON.stringify(sortKeys(OVERRIDES)),
    "overrides differ from BR-315",
  );
  check(
    /^\d+\.\d+\.\d+$/u.test(manifest.dependencies?.zod ?? ""),
    "zod is a direct exact dependency",
  );
}
function sortKeys(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}

// Numeric x.y.z comparison; a pre-release or malformed version never passes.
function atLeast(version: string | undefined, minimum: string): boolean {
  const parse = (text: string) =>
    /^\d+\.\d+\.\d+$/u.test(text) ? text.split(".").map(Number) : undefined;
  const actual = parse(version ?? ""),
    floor = parse(minimum);
  if (!actual || !floor) return false;
  for (let index = 0; index < 3; index++) {
    const a = actual[index] ?? 0,
      b = floor[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

// BR-316: one root zod >= 4.6.6 and every minimatch >= 11.0.1.
function assertLockfile(lock: Lockfile): void {
  const named = (name: string) =>
    Object.entries(lock.packages).filter(
      ([key]) => key.split("node_modules/").at(-1) === name,
    );
  const zod = named("zod");
  check(
    zod.length === 1 && zod[0]?.[0] === "node_modules/zod",
    "the only zod is node_modules/zod",
  );
  check(atLeast(zod[0]?.[1].version, "4.6.6"), "zod >= 4.6.6");
  const minimatch = named("minimatch");
  check(minimatch.length > 0, "minimatch is present");
  for (const [, entry] of minimatch)
    check(atLeast(entry.version, "11.0.1"), "minimatch >= 11.0.1");
}

const manifest = () =>
  JSON.parse(readFileSync("package.json", "utf8")) as Manifest;
const lockfile = () =>
  JSON.parse(readFileSync("package-lock.json", "utf8")) as Lockfile;

it("TestBR315_overrides package.json pins the exact overrides and a direct exact zod", () => {
  const real = manifest();
  expect(real.overrides).toEqual(OVERRIDES);
  expect(() => {
    assertOverrides(real);
  }).not.toThrow();
});

it.each(["@jimp/types", "@jimp/plugin-resize", "minimatch"])(
  "TestBR315_overrides rejects a copy without the %s override",
  (name) => {
    const copy = manifest();
    const overrides = { ...(copy.overrides as Record<string, unknown>) };
    delete overrides[name];
    copy.overrides = overrides;
    expect(() => {
      assertOverrides(copy);
    }).toThrow();
  },
);

it("TestBR315_overrides rejects a minimatch range and a zod range", () => {
  const ranged = manifest();
  ranged.overrides = { ...OVERRIDES, minimatch: "^11.0.8" };
  expect(() => {
    assertOverrides(ranged);
  }).toThrow();
  const zodRange = manifest();
  zodRange.dependencies = { ...zodRange.dependencies, zod: "^4.6.7" };
  expect(() => {
    assertOverrides(zodRange);
  }).toThrow();
});

it("TestBR316_lockfile holds one root zod >= 4.6.6 and minimatch >= 11.0.1", () => {
  const lock = lockfile();
  expect(
    Object.keys(lock.packages).filter(
      (key) => key.split("node_modules/").at(-1) === "zod",
    ),
  ).toEqual(["node_modules/zod"]);
  expect(() => {
    assertLockfile(lock);
  }).not.toThrow();
});

it.each([
  [
    "a nested Jimp zod 3.25.76",
    (lock: Lockfile) => {
      lock.packages["node_modules/@jimp/types/node_modules/zod"] = {
        version: "3.25.76",
      };
    },
  ],
  [
    "a root zod 4.6.5",
    (lock: Lockfile) => {
      lock.packages["node_modules/zod"] = { version: "4.6.5" };
    },
  ],
  [
    "a minimatch 10.2.6",
    (lock: Lockfile) => {
      lock.packages["node_modules/minimatch"] = { version: "10.2.6" };
    },
  ],
  [
    "a nested minimatch 10.2.6",
    (lock: Lockfile) => {
      lock.packages["node_modules/eslint/node_modules/minimatch"] = {
        version: "10.2.6",
      };
    },
  ],
] as const)("TestBR316_lockfile rejects %s", (_name, mutate) => {
  const lock = lockfile();
  mutate(lock);
  expect(() => {
    assertLockfile(lock);
  }).toThrow();
});

it("TestBR316_lockfile version comparison is numeric and refuses pre-releases", () => {
  expect(atLeast("4.10.0", "4.6.6")).toBe(true);
  expect(atLeast("4.6.6", "4.6.6")).toBe(true);
  expect(atLeast("4.6.5", "4.6.6")).toBe(false);
  expect(atLeast("4.6.6-beta.1", "4.6.6")).toBe(false);
  expect(atLeast(undefined, "4.6.6")).toBe(false);
});

// BR-318: a literal copy of the base compilerOptions (before F-020).
const BASE_COMPILER_OPTIONS = {
  target: "ES2023",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  rewriteRelativeImportExtensions: true,
  noEmit: true,
  verbatimModuleSyntax: true,
  forceConsistentCasingInFileNames: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  types: ["node"],
};

it("TestBR318_skiplibcheck tsconfig.json adds only skipLibCheck and the build config sets none", () => {
  const base = JSON.parse(readFileSync("tsconfig.json", "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };
  const build = JSON.parse(readFileSync("tsconfig.build.json", "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };
  expect(base.compilerOptions).toEqual({
    ...BASE_COMPILER_OPTIONS,
    skipLibCheck: true,
  });
  expect(build.compilerOptions).not.toHaveProperty("skipLibCheck");
});

// The library type collapses to `any` under skipLibCheck with Zod 4; this
// assignment stops compiling once a Jimp release fixes it, so the local type
// of BR-318 is revisited then.
type IsAny<T> = 0 extends 1 & T ? true : false;
export const resizeOptionsIsAny: IsAny<ResizeOptions> = true;

it("TestBR318_skiplibcheck the local resize options type rejects a wrong mode and a missing height", () => {
  const valid: ImageResizeOptions = {
    w: 2,
    h: 1,
    mode: ResizeStrategy.NEAREST_NEIGHBOR,
  };
  /* eslint-disable @typescript-eslint/no-unsafe-enum-assignment -- BR-318: the rejected string mode is the type-level assertion */
  const wrongMode: ImageResizeOptions = {
    w: 2,
    h: 1,
    // @ts-expect-error BR-318: a plain string is not a ResizeStrategy.
    mode: "nearest",
  };
  /* eslint-enable @typescript-eslint/no-unsafe-enum-assignment */
  // @ts-expect-error BR-318: the height is required.
  const missingHeight: ImageResizeOptions = {
    w: 2,
    mode: ResizeStrategy.NEAREST_NEIGHBOR,
  };
  expect(valid.mode).toBe(ResizeStrategy.NEAREST_NEIGHBOR);
  expect(wrongMode.mode).toBe("nearest");
  expect(missingHeight).not.toHaveProperty("h");
});

it("TestBR318_skiplibcheck image.resize receives the typed options value, never an inline literal", () => {
  const source = readFileSync("src/extraction-image.ts", "utf8");
  const calls = [...source.matchAll(/image\.resize\(([^)]*)\)/gu)].map(
    (match) => (match[1] ?? "").trim(),
  );
  expect(calls).toHaveLength(1);
  const argument = calls[0] ?? "";
  expect(argument).toMatch(/^[A-Za-z_$][\w$]*$/u);
  expect(source).toMatch(
    new RegExp(`const ${argument}: ImageResizeOptions = \\{`, "u"),
  );
  expect(source).toMatch(
    /export type ImageResizeOptions = \{\s*w: number;\s*h: number;\s*mode: ResizeStrategy;?\s*\};/u,
  );
});

it("TestBR321_audit_docs development, security and changelog state the audit contract", () => {
  const prose = (text: string) => text.replace(/\s+/gu, " ");
  const development = prose(readFileSync("docs/development.md", "utf8"));
  expect(development).not.toMatch(/audit is not clean/iu);
  expect(development).toContain("make audit");
  expect(development).toContain("ADR-009");
  for (const name of ["@jimp/types", "@jimp/plugin-resize", "minimatch"])
    expect(development).toContain(name);
  expect(development).toMatch(/CI `audit` job/u);
  const security = readFileSync("SECURITY.md", "utf8");
  const section =
    /^## Dependency audit\n([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(
      security,
    )?.[1] ?? "";
  expect(section).not.toBe("");
  const text = prose(section);
  expect(text).toMatch(/high or critical/u);
  expect(text).toMatch(/not allowlisted/u);
  expect(text).toContain("npm install -g");
  expect(text).toMatch(/Zod 3/u);
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const unreleased =
    /^## \[Unreleased\]\n([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(
      changelog,
    )?.[1] ?? "";
  const fixed = /^### Fixed\n([\s\S]*?)(?=^### |(?![\s\S]))/mu.exec(
    unreleased,
  )?.[1];
  const added = /^### Added\n([\s\S]*?)(?=^### |(?![\s\S]))/mu.exec(
    unreleased,
  )?.[1];
  expect(fixed).toMatch(/#104[\s\S]*GHSA-mrhx-c7xc-m3w5/u);
  expect(added).toMatch(/#104[\s\S]*make audit/u);
});

import {
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
import type { ResizeOptions } from "@jimp/plugin-resize";
import { ResizeStrategy } from "@jimp/plugin-resize";
import type { ImageResizeOptions } from "../src/extraction-image.js";
import {
  collectInstalled,
  installVerdict,
  type Installed,
} from "../scripts/install-check.js";

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
  expect(changelogAuditSection(changelog)).toBe(
    "## [0.6.0-beta.1] - 2026-11-13",
  );
});

// BR-321 v3: the #104 Fixed and Added lines live in the first release section
// citing #104 in file order, or under Unreleased when there is no release
// section. Returns the heading of the section that holds them.
const RELEASE_HEADING =
  /^## \[\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\] - \d{4}-\d{2}-\d{2}$/u;
const CITES_104 = /#104\b/u;

function changelogAuditSection(changelog: string): string {
  const sections = changelog
    .split(/^(?=## )/mu)
    .filter((part) => part.startsWith("## "))
    .map((part) => {
      const end = part.indexOf("\n");
      return end < 0
        ? { heading: part, body: "" }
        : { heading: part.slice(0, end), body: part.slice(end + 1) };
    });
  const releases = sections.filter((s) => RELEASE_HEADING.test(s.heading));
  const target =
    releases.length > 0
      ? releases.find((s) => CITES_104.test(s.body))
      : sections.find((s) => s.heading === "## [Unreleased]");
  check(target, "no changelog section holds the #104 lines");
  const holds = (name: string, marker: string) => {
    const body =
      new RegExp(
        `^### ${name}\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`,
        "mu",
      ).exec(target?.body ?? "")?.[1] ?? "";
    return body
      .split(/^(?=- )/mu)
      .some((entry) => CITES_104.test(entry) && entry.includes(marker));
  };
  check(holds("Fixed", "GHSA-mrhx-c7xc-m3w5"), "missing #104 Fixed line");
  check(holds("Added", "make audit"), "missing #104 Added line");
  return target?.heading ?? "";
}

const FIXED_104 = "- #104: advisory GHSA-mrhx-c7xc-m3w5 is fixed.\n";
const ADDED_104 = "- #104: `make audit` and the CI `audit` job.\n";
const OTHER = "- #7: another change.\n";

function changelogFixture(
  ...sections: [heading: string, fixed: string, added: string][]
): string {
  let text = "# Changelog\n\nIntro.\n";
  for (const [heading, fixed, added] of sections) {
    text += `\n${heading}\n`;
    if (added) text += `\n### Added\n\n${added}`;
    if (fixed) text += `\n### Fixed\n\n${fixed}`;
  }
  return text;
}

it("TestBR321_audit_docs changelog release section holding the #104 lines passes", () => {
  const fixture = changelogFixture(
    ["## [Unreleased]", "", ""],
    ["## [0.6.0-beta.1] - 2026-11-13", FIXED_104 + OTHER, OTHER + ADDED_104],
  );
  expect(changelogAuditSection(fixture)).toBe("## [0.6.0-beta.1] - 2026-11-13");
});

it("TestBR321_audit_docs changelog release section missing the #104 lines fails", () => {
  const release = "## [0.6.0-beta.1] - 2026-11-13";
  expect(() =>
    changelogAuditSection(
      changelogFixture(
        ["## [Unreleased]", "", ""],
        [release, OTHER, ADDED_104],
      ),
    ),
  ).toThrow("missing #104 Fixed line");
  expect(() =>
    changelogAuditSection(
      changelogFixture(
        ["## [Unreleased]", "", ""],
        [release, FIXED_104, OTHER],
      ),
    ),
  ).toThrow("missing #104 Added line");
  expect(() =>
    changelogAuditSection(
      changelogFixture(
        ["## [Unreleased]", FIXED_104, ADDED_104],
        [release, OTHER, OTHER],
      ),
    ),
  ).toThrow("no changelog section holds the #104 lines");
});

it("TestBR321_audit_docs changelog without a release section reads Unreleased", () => {
  const unreleased: [string, string, string] = [
    "## [Unreleased]",
    FIXED_104,
    ADDED_104,
  ];
  expect(changelogAuditSection(changelogFixture(unreleased))).toBe(
    "## [Unreleased]",
  );
  expect(
    changelogAuditSection(
      changelogFixture(unreleased, ["## [0.7.0]", OTHER, OTHER]),
    ),
  ).toBe("## [Unreleased]");
  expect(() =>
    changelogAuditSection(
      changelogFixture(["## [Unreleased]", OTHER, ADDED_104]),
    ),
  ).toThrow("missing #104 Fixed line");
  expect(() =>
    changelogAuditSection(
      changelogFixture(["## [Unreleased]", FIXED_104, OTHER]),
    ),
  ).toThrow("missing #104 Added line");
});

it("TestBR321_audit_docs changelog selects the first release section citing #104", () => {
  const empty: [string, string, string] = ["## [Unreleased]", "", ""];
  expect(() =>
    changelogAuditSection(
      changelogFixture(empty, ["## [0.6.0-beta.1] - 2026-11-13", OTHER, OTHER]),
    ),
  ).toThrow("no changelog section holds the #104 lines");
  expect(() =>
    changelogAuditSection(
      changelogFixture(empty, [
        "## [0.6.0-beta.1] - 2026-11-13",
        FIXED_104.replace("#104", "#1040"),
        ADDED_104.replace("#104", "#1040"),
      ]),
    ),
  ).toThrow("no changelog section holds the #104 lines");
  expect(
    changelogAuditSection(
      changelogFixture(
        empty,
        ["## [0.7.0] - 2026-12-01", OTHER, OTHER],
        ["## [0.6.0-beta.1] - 2026-11-13", FIXED_104, ADDED_104],
      ),
    ),
  ).toBe("## [0.6.0-beta.1] - 2026-11-13");
});

// BR-392 (F-027, #12): the install check's verdict, collector and npm calls.
const ZOD = "lib/node_modules/zod";
const NESTED = "lib/node_modules/@jimp/types/node_modules/zod";
const pkg = (
  name: string,
  version: string | null,
  path: string,
): Installed => ({ name, version, path });
const VERDICTS: [string, Installed[], boolean, string[]][] = [
  ["zod 4.6.7", [pkg("zod", "4.6.7", ZOD)], true, []],
  ["zod 4.6.6", [pkg("zod", "4.6.6", ZOD)], true, []],
  [
    "a nested zod 3.25.76 under @jimp/types",
    [pkg("zod", "4.6.7", ZOD), pkg("zod", "3.25.76", NESTED)],
    false,
    ["zod", "3.25.76", NESTED],
  ],
  ["zod 4.6.5", [pkg("zod", "4.6.5", ZOD)], false, ["zod", "4.6.5", ZOD]],
  [
    "zod 4.6.6-beta.1",
    [pkg("zod", "4.6.6-beta.1", ZOD)],
    false,
    ["zod", "4.6.6-beta.1", ZOD],
  ],
  ["an unparseable zod version", [pkg("zod", "x", ZOD)], false, ["zod", ZOD]],
  ["no zod", [], false, ["zod"]],
  [
    "a @jimp/core package",
    [
      pkg("zod", "4.6.7", ZOD),
      pkg("@jimp/core", "1.6.1", "lib/node_modules/@jimp/core"),
    ],
    false,
    ["@jimp/core", "lib/node_modules/@jimp/core"],
  ],
  [
    "a zod without version",
    [
      pkg("zod", "4.6.7", ZOD),
      pkg("zod", null, "lib/node_modules/a/node_modules/zod"),
    ],
    false,
    ["zod", "lib/node_modules/a/node_modules/zod"],
  ],
  [
    "a symbolic link",
    [
      pkg("zod", "4.6.7", ZOD),
      { name: "e", version: null, path: "lib/node_modules/e", symlink: true },
    ],
    false,
    ["e", "lib/node_modules/e"],
  ],
];
it.each(VERDICTS)(
  "TestBR392_install_check verdict on %s",
  (_name, list, ok, named) => {
    const result = installVerdict(list);
    expect(result.ok).toBe(ok);
    if (ok) expect(result.findings).toEqual([]);
    else {
      expect(result.findings.length).toBeGreaterThan(0);
      const text = result.findings.join("\n");
      for (const part of named) expect(text).toContain(part);
    }
  },
);

function writePackage(directory: string, name: string, version: string) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name, version }),
  );
}
it("TestBR392_install_check collector walks every node_modules level without following links", () => {
  const prefix = mkdtempSync(join(tmpdir(), "kdrive-install-tree-"));
  const outside = mkdtempSync(join(tmpdir(), "kdrive-install-outside-"));
  try {
    const modules = join(prefix, "lib/node_modules");
    writePackage(join(modules, "zod"), "zod", "4.6.7");
    writePackage(join(modules, "@jimp/types"), "@jimp/types", "1.6.1");
    writePackage(
      join(modules, "@jimp/types/node_modules/zod"),
      "zod",
      "3.25.76",
    );
    writePackage(join(modules, "a"), "a", "1.0.0");
    writePackage(join(modules, "a/node_modules/b"), "b", "1.0.0");
    writePackage(
      join(modules, "a/node_modules/b/node_modules/@s/c"),
      "@s/c",
      "1.0.0",
    );
    writePackage(
      join(modules, "a/node_modules/b/node_modules/@s/c/node_modules/zod"),
      "zod",
      "4.6.6",
    );
    mkdirSync(join(modules, "d"));
    mkdirSync(join(modules, ".bin"));
    writeFileSync(join(modules, ".bin/tool"), "");
    writePackage(join(outside, "node_modules/zod"), "zod", "3.25.76");
    symlinkSync(outside, join(modules, "e"));
    const list = collectInstalled(prefix);
    const byPath = (items: Installed[]) =>
      [...items].sort((x, y) => x.path.localeCompare(y.path));
    expect(byPath(list)).toEqual(
      byPath([
        pkg("a", "1.0.0", "lib/node_modules/a"),
        pkg("b", "1.0.0", "lib/node_modules/a/node_modules/b"),
        pkg(
          "@s/c",
          "1.0.0",
          "lib/node_modules/a/node_modules/b/node_modules/@s/c",
        ),
        pkg(
          "zod",
          "4.6.6",
          "lib/node_modules/a/node_modules/b/node_modules/@s/c/node_modules/zod",
        ),
        { name: "e", version: null, path: "lib/node_modules/e", symlink: true },
        pkg("@jimp/types", "1.6.1", "lib/node_modules/@jimp/types"),
        pkg("zod", "3.25.76", NESTED),
        pkg("zod", "4.6.7", ZOD),
      ]),
    );
    const result = installVerdict(list);
    expect(result.ok).toBe(false);
    const text = result.findings.join("\n");
    for (const part of ["zod", "3.25.76", "@jimp/types", "lib/node_modules/e"])
      expect(text).toContain(part);
    expect(text).not.toContain("4.6.6 ");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

it("TestBR392_install_check both npm calls prefer online with a numeric timeout", () => {
  const source = readFileSync("scripts/install-check.ts", "utf8");
  const calls = [
    ...source.matchAll(
      /execFileSync\(\s*(?:\/\/[^\n]*\n\s*)?"npm",\s*\[([^\]]*)\],\s*\{([^}]*)\}/gu,
    ),
  ];
  expect(calls).toHaveLength(2);
  const [pack, install] = calls;
  expect(pack?.[1]).toMatch(
    /"pack",\s*"--json",\s*"--ignore-scripts",\s*"--prefer-online"/u,
  );
  expect(pack?.[2]).toMatch(/timeout: 120000\b/u);
  expect(install?.[1]).toMatch(
    /"install",\s*"--global",\s*"--prefix",\s*prefix,\s*tarball,\s*"--ignore-scripts",\s*"--no-audit",\s*"--no-fund",\s*"--prefer-online"/u,
  );
  expect(install?.[2]).toMatch(/timeout: 600000\b/u);
  expect(source).not.toMatch(/from "(?!node:)/u);
});

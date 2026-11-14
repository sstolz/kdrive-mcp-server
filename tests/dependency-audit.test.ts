import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  collectInstalled,
  installVerdict,
  type Installed,
} from "../scripts/install-check.js";

// F-020 (#104), F-027 (#12): pinned dependency overrides, image dependencies,
// lockfile resolution, type-check settings and audit documentation.

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: unknown;
}
interface Lockfile {
  packages: Record<string, { version?: string }>;
}

// BR-315 v2: the Jimp overrides are gone with Jimp (F-027).
const OVERRIDES = {
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
  expect(real.dependencies?.zod).toBe("4.6.7");
  expect(() => {
    assertOverrides(real);
  }).not.toThrow();
});

it.each(["minimatch"])(
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

it.each(["@jimp/types", "@jimp/plugin-resize"])(
  "TestBR315_overrides rejects a copy with a %s override",
  (name) => {
    const copy = manifest();
    copy.overrides = { ...OVERRIDES, [name]: { zod: "$zod" } };
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

it("TestBR318_full_lib_check tsconfig.json has the base options without skipLibCheck and the build config sets none", () => {
  const base = JSON.parse(readFileSync("tsconfig.json", "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };
  const build = JSON.parse(readFileSync("tsconfig.build.json", "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };
  expect(base.compilerOptions).toEqual(BASE_COMPILER_OPTIONS);
  expect(base.compilerOptions).not.toHaveProperty("skipLibCheck");
  expect(build.compilerOptions).not.toHaveProperty("skipLibCheck");
  expect(readFileSync("src/extraction-image.ts", "utf8")).not.toContain(
    "ImageResizeOptions",
  );
});

// BR-389: no Jimp package or import; exact codec pins in manifest and lock.
const JIMP = "@jimp/";
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/gu;
function assertImageDependencies(
  pack: Manifest,
  lock: Lockfile,
  sources: Record<string, string>,
): void {
  for (const group of [pack.dependencies, pack.devDependencies, pack.overrides])
    for (const key of Object.keys(group ?? {}))
      check(!key.startsWith(JIMP), `package.json has ${key}`);
  check(pack.dependencies?.pngjs === "7.0.0", "pngjs is exactly 7.0.0");
  check(pack.dependencies?.["jpeg-js"] === "0.4.4", "jpeg-js is exactly 0.4.4");
  for (const key of Object.keys(lock.packages))
    check(!key.includes(`node_modules/${JIMP}`), `lockfile has ${key}`);
  check(
    lock.packages["node_modules/pngjs"]?.version === "7.0.0",
    "locked pngjs 7.0.0",
  );
  check(
    lock.packages["node_modules/jpeg-js"]?.version === "0.4.4",
    "locked jpeg-js 0.4.4",
  );
  for (const [file, text] of Object.entries(sources))
    for (const match of text.matchAll(IMPORT_SPECIFIER))
      check(!match[1]?.startsWith(JIMP), `${file} imports ${match[1] ?? ""}`);
}
function typeScriptSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const root of ["src", "tests", "scripts"])
    for (const entry of readdirSync(root, {
      recursive: true,
      withFileTypes: true,
    }))
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        const file = join(entry.parentPath, entry.name);
        sources[file] = readFileSync(file, "utf8");
      }
  return sources;
}

it("TestBR389_image_dependencies package.json, lockfile and sources hold no Jimp and pin the codecs", () => {
  const sources = typeScriptSources();
  expect(Object.keys(sources)).toContain("src/extraction-image.ts");
  expect(sources["src/extraction-image.ts"]).toMatch(/from "pngjs"/u);
  expect(sources["src/extraction-image.ts"]).toMatch(/from "jpeg-js"/u);
  expect(() => {
    assertImageDependencies(manifest(), lockfile(), sources);
  }).not.toThrow();
});

it.each([
  [
    "a @jimp/core dependency",
    (pack: Manifest) => {
      pack.dependencies = { ...pack.dependencies, "@jimp/core": "1.6.1" };
    },
  ],
  [
    "a node_modules/@jimp/types lock key",
    (_pack: Manifest, lock: Lockfile) => {
      lock.packages["node_modules/@jimp/types"] = { version: "1.6.1" };
    },
  ],
  [
    "pngjs at ^7.0.0",
    (pack: Manifest) => {
      pack.dependencies = { ...pack.dependencies, pngjs: "^7.0.0" };
    },
  ],
  [
    "jpeg-js locked at 0.4.3",
    (_pack: Manifest, lock: Lockfile) => {
      lock.packages["node_modules/jpeg-js"] = { version: "0.4.3" };
    },
  ],
  [
    "a @jimp/js-png import",
    (_pack: Manifest, _lock: Lockfile, sources: Record<string, string>) => {
      sources["tests/extra.ts"] = `import png from "${JIMP}js-png";\n`;
    },
  ],
] as const)("TestBR389_image_dependencies rejects %s", (_name, mutate) => {
  const pack = manifest(),
    lock = lockfile(),
    sources = typeScriptSources();
  mutate(pack, lock, sources);
  expect(() => {
    assertImageDependencies(pack, lock, sources);
  }).toThrow();
});

const prose = (text: string) => text.replaceAll(/\s+/gu, " ");
function securitySection(security: string): string {
  return (
    /^## Dependency audit\n([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(
      security,
    )?.[1] ?? ""
  );
}

// BR-321 v4: the SECURITY.md dependency-audit statements.
function assertSecuritySection(section: string): void {
  const text = prose(section);
  check(text !== "", "SECURITY.md has a Dependency audit section");
  check(/high or critical/u.test(text), "high or critical gate");
  check(/not allowlisted/u.test(text), "no allowlist");
  check(text.includes("npm install -g"), "names npm install -g");
  check(
    text.includes("from the first release that includes #12"),
    "limits the claim to the first release that includes #12",
  );
  check(text.includes("make install-check"), "names make install-check");
  check(!text.includes("@jimp/"), "no @jimp/ package name");
  check(!text.includes("fixed before 1.0"), "no fixed-before-1.0 promise");
  const legacy = text
    .split(". ")
    .filter((sentence) => /Jimp|Zod 3/u.test(sentence));
  check(legacy.length === 1, "exactly one sentence names Jimp or Zod 3");
  for (const part of ["0.6.0-beta.1", "3.25.76", "upgrade", "container"])
    check(
      legacy[0]?.includes(part),
      `the earlier-versions sentence has ${part}`,
    );
}

// BR-321 v4: docs/development.md audit paragraph and Make table row.
function assertDevelopment(development: string): void {
  const text = prose(development);
  check(!/audit is not clean/iu.test(text), "no audit-is-not-clean sentence");
  for (const part of [
    "minimatch",
    "ADR-010",
    "make audit",
    "make install-check",
  ])
    check(text.includes(part), `development guide names ${part}`);
  check(
    /CI `audit` job/u.test(text),
    "development guide names the CI audit job",
  );
  check(!/jimp/iu.test(development), "development guide names no Jimp");
  const row = /^\| `make install-check` +\|([^\n]*)\|$/mu.exec(
    development,
  )?.[1];
  check(row, "Make table has a make install-check row");
  check(
    /packed tarball/u.test(row ?? "") &&
      /registry/u.test(row ?? "") &&
      /not part of `make check`/u.test(row ?? ""),
    "the row says it installs the packed tarball from the registry outside make check",
  );
}

it("TestBR321_audit_docs development, security and changelog state the audit contract", () => {
  expect(() => {
    assertDevelopment(readFileSync("docs/development.md", "utf8"));
  }).not.toThrow();
  const section = securitySection(readFileSync("SECURITY.md", "utf8"));
  expect(() => {
    assertSecuritySection(section);
  }).not.toThrow();
  expect(prose(section)).toMatch(/Zod 3/u);
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  expect(changelogAuditSection(changelog)).toBe(
    "## [0.6.0-beta.1] - 2026-11-13",
  );
  expect(changelogTicket12Section(changelog)).toBe("## [Unreleased]");
});

it("TestBR321_audit_docs a development guide naming Jimp or lacking the install-check row fails", () => {
  const development = readFileSync("docs/development.md", "utf8");
  expect(() => {
    assertDevelopment(`${development}\nJimp.\n`);
  }).toThrow("names no Jimp");
  expect(() => {
    assertDevelopment(
      development.replace(/^\| `make install-check`[^\n]*\n/mu, ""),
    );
  }).toThrow("make install-check row");
});

it("TestBR321_audit_docs a security section without the #12 limit or the earlier-versions sentence fails", () => {
  const section = securitySection(readFileSync("SECURITY.md", "utf8"));
  expect(() => {
    assertSecuritySection(
      section.replaceAll("from the first release that includes #12", ""),
    );
  }).toThrow("first release that includes #12");
  const legacy = prose(section)
    .split(". ")
    .find((sentence) => /Jimp|Zod 3/u.test(sentence));
  expect(legacy).toBeDefined();
  expect(() => {
    assertSecuritySection(prose(section).replace(`${legacy ?? ""}. `, ""));
  }).toThrow("exactly one sentence names Jimp or Zod 3");
  expect(() => {
    assertSecuritySection(`${section}\nThe Jimp tree is gone.\n`);
  }).toThrow("exactly one sentence");
  expect(() => {
    assertSecuritySection(
      `${section}\nFixed before 1.0 in #12, fixed before 1.0.\n`,
    );
  }).toThrow("fixed-before-1.0");
});

// BR-321 v3: the #104 Fixed and Added lines live in the first release section
// citing #104 in file order, or under Unreleased when there is no release
// section. Returns the heading of the section that holds them.
const RELEASE_HEADING =
  /^## \[\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\] - \d{4}-\d{2}-\d{2}$/u;

function changelogTicketSection(
  changelog: string,
  ticket: string,
  fixedMarker: string,
  addedMarker: string,
): string {
  const cites = new RegExp(`${ticket}\\b`, "u");
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
  const cited = releases.find((s) => cites.test(s.body));
  const target =
    ticket === "#104" && releases.length > 0
      ? cited
      : (cited ?? sections.find((s) => s.heading === "## [Unreleased]"));
  check(target, `no changelog section holds the ${ticket} lines`);
  const holds = (name: string, marker: string) => {
    const body =
      new RegExp(
        `^### ${name}\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`,
        "mu",
      ).exec(target?.body ?? "")?.[1] ?? "";
    return body
      .split(/^(?=- )/mu)
      .some((entry) => cites.test(entry) && entry.includes(marker));
  };
  check(holds("Fixed", fixedMarker), `missing ${ticket} Fixed line`);
  check(holds("Added", addedMarker), `missing ${ticket} Added line`);
  return target?.heading ?? "";
}

// BR-321 v3: the #104 lines.
function changelogAuditSection(changelog: string): string {
  return changelogTicketSection(
    changelog,
    "#104",
    "GHSA-mrhx-c7xc-m3w5",
    "make audit",
  );
}

// BR-321 v4: the #12 lines (Fixed: the tarball install no longer resolves
// Zod 3; Added: make install-check and its CI step). F-027 v2: only the
// text before the `## [0.6.0-beta.1]` heading is searched, because that
// section and older ones cite tickets of the archived repository.
const FIXED_12_MARKER = "no longer resolves Zod 3";
const ADDED_12_MARKER = "make install-check";
function changelogTicket12Section(changelog: string): string {
  const archived = changelog.search(/^## \[0\.6\.0-beta\.1\]/mu);
  return changelogTicketSection(
    archived < 0 ? changelog : changelog.slice(0, archived),
    "#12",
    FIXED_12_MARKER,
    ADDED_12_MARKER,
  );
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
    symlinkSync(outside, join(modules, "@t"));
    mkdirSync(join(modules, "@s"));
    symlinkSync(outside, join(modules, "@s/l"));
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
        {
          name: "@t",
          version: null,
          path: "lib/node_modules/@t",
          symlink: true,
        },
        {
          name: "@s/l",
          version: null,
          path: "lib/node_modules/@s/l",
          symlink: true,
        },
        pkg("@jimp/types", "1.6.1", "lib/node_modules/@jimp/types"),
        pkg("zod", "3.25.76", NESTED),
        pkg("zod", "4.6.7", ZOD),
      ]),
    );
    const result = installVerdict(list);
    expect(result.ok).toBe(false);
    const text = result.findings.join("\n");
    for (const part of [
      "zod",
      "3.25.76",
      "@jimp/types",
      "lib/node_modules/e",
      "lib/node_modules/@t",
      "lib/node_modules/@s/l",
    ])
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

const FIXED_12 =
  "- #12: an install of the packed tarball no longer resolves Zod 3.\n";
const ADDED_12 = "- #12: `make install-check` and its CI step.\n";

it("TestBR321_audit_docs changelog #12 lines under Unreleased pass when no release section cites #12", () => {
  expect(
    changelogTicket12Section(
      changelogFixture(
        ["## [Unreleased]", FIXED_12 + OTHER, ADDED_12],
        ["## [0.6.0-beta.1] - 2026-11-13", FIXED_104, ADDED_104],
      ),
    ),
  ).toBe("## [Unreleased]");
  expect(
    changelogTicket12Section(
      changelogFixture(
        ["## [Unreleased]", "", ""],
        ["## [0.7.0] - 2026-12-01", FIXED_12, ADDED_12],
        ["## [0.6.0-beta.1] - 2026-11-13", FIXED_104, ADDED_104],
      ),
    ),
  ).toBe("## [0.7.0] - 2026-12-01");
});

it("TestBR321_audit_docs changelog #12 lines misplaced, incomplete or citing #120 fail", () => {
  expect(() =>
    changelogTicket12Section(
      changelogFixture(
        ["## [Unreleased]", "", ""],
        ["## [0.7.0] - 2026-12-01", FIXED_12, OTHER],
        ["## [0.6.0-beta.1] - 2026-11-13", OTHER, ADDED_12],
      ),
    ),
  ).toThrow("missing #12 Added line");
  expect(() =>
    changelogTicket12Section(
      changelogFixture(["## [Unreleased]", FIXED_12, OTHER]),
    ),
  ).toThrow("missing #12 Added line");
  expect(() =>
    changelogTicket12Section(
      changelogFixture(["## [Unreleased]", OTHER, ADDED_12]),
    ),
  ).toThrow("missing #12 Fixed line");
  expect(() =>
    changelogTicket12Section(
      changelogFixture([
        "## [Unreleased]",
        FIXED_12.replace("#12", "#120"),
        ADDED_12.replace("#12", "#120"),
      ]),
    ),
  ).toThrow("missing #12 Fixed line");
  expect(() =>
    changelogTicket12Section(
      changelogFixture(
        ["## [Unreleased]", "", ""],
        ["## [0.6.0-beta.1] - 2026-11-13", FIXED_12, ADDED_12],
      ),
    ),
  ).toThrow("missing #12 Fixed line");
});

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { runDiagnostic } from "./helpers/diagnostic.js";
import { rules } from "./helpers/image-policy.js";
import { shrinkwrap } from "../scripts/shrinkwrap.js";

interface Packed {
  files: Array<{ path: string }>;
  filename: string;
}
function packageResult(output: string): Packed {
  const results = JSON.parse(output) as Packed[];
  const result = results[0];
  if (!result) throw new Error("npm pack did not return an artifact");
  return result;
}
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
it("BR-004 real package allowlist excludes synthetic secrets, source, tests and reports", () => {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-package-"));
  for (const path of ["dist", "LICENSE", "NOTICE", "README.md", "package.json"])
    cpSync(path, join(directory, path), { recursive: true });
  const forbidden = [
    // BR-014: only synthetic credential paths are ever inspected by tests.
    ".config/qube-token",
    ".env",
    ".env.production",
    "private.pem",
    "private.key",
    "private.p12",
    "private.pfx",
    "secrets/example",
    "src/fixture.ts",
    "tests/fixture.test.ts",
    "runs/report.md",
    "coverage/lcov.info",
  ];
  for (const path of forbidden) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), "");
  }
  const dry = packageResult(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
    }),
  );
  for (const file of ["dist/cli.js", "LICENSE", "NOTICE", "README.md"])
    expect(dry.files.map((entry) => entry.path)).toContain(file);
  for (const file of forbidden)
    expect(dry.files.map((entry) => entry.path)).not.toContain(file);
  const packed = packageResult(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
    }),
  );
  execFileSync("tar", [
    "-xzf",
    join(directory, packed.filename),
    "-C",
    directory,
  ]);
  const cli = join(directory, "package/dist/cli.js");
  // BR-016: install the already locked runtime parser into the isolated package.
  cpSync("node_modules/yaml", join(directory, "package/node_modules/yaml"), {
    recursive: true,
  });
  // Verify all diagnostic paths on the packed executable without project source.
  for (const args of [["--version"], ["--help"], [], ["--unknown"]]) {
    const result = runDiagnostic(cli, args);
    expect(result.status).toBe(
      args[0] === "--version" || args[0] === "--help" ? 0 : 1,
    );
    if (args[0] === "--version") expect(result.stdout).toBe("0.1.0\n");
    else if (args[0] === "--help")
      expect(result.stdout).toContain("Usage: kdrive-mcp-server");
    else {
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        args.length
          ? "Configuration error [UNKNOWN_OPTION] (cli).\n"
          : "Configuration error [MISSING_REQUIRED] (driveIds).\n",
      );
    }
  }
  for (const transport of ["stdio", "http"]) {
    const result = runDiagnostic(
      cli,
      transport === "http" ? ["--http", "--insecure-no-auth"] : [],
      { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: "/nonexistent/SYNTHETIC_PACKED" },
    );
    // BR-016 v2: packed paths end before any adapter request.
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Configuration error [CREDENTIAL_READ_FAILED] (tokenFile).\n",
    );
  }
});
it("BR-004 ignores synthetic private and generated paths while keeping the empty example", () => {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-ignore-"));
  cpSync(".gitignore", join(directory, ".gitignore"));
  execFileSync("git", ["init", "--quiet", directory]);
  const paths = [
    ".config/qube-token",
    ".env",
    ".env.production",
    "private.pem",
    "private.key",
    "private.p12",
    "private.pfx",
    "secrets/example",
    "node_modules/tool",
    "dist/cli.js",
    "coverage/lcov.info",
    "archive.tgz",
  ];
  const ignored = execFileSync(
    "git",
    ["check-ignore", "--no-index", ...paths],
    { cwd: directory, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  expect(ignored).toEqual(paths);
  // BR-014: neighboring configuration files remain ordinary repository files.
  expect(
    spawnSync("git", ["check-ignore", "--no-index", ".config/settings.json"], {
      cwd: directory,
    }).status,
  ).toBe(1);
  expect(
    spawnSync("git", ["check-ignore", "--no-index", ".env.example"], {
      cwd: directory,
    }).status,
  ).toBe(1);
  for (const line of readFileSync(".env.example", "utf8").split("\n")) {
    if (line && !line.startsWith("#"))
      expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/u);
  }
});
it("BR-004 records original MIT licensing and accurate deferred upstream provenance", () => {
  expect(readFileSync("LICENSE", "utf8")).toContain("MIT License");
  const notice = readFileSync("NOTICE", "utf8");
  expect(notice).toContain("https://github.com/Infomaniak/mcp-server-kdrive");
  expect(notice).toContain("857272d7fd42c0940ae389b9092b1c4cd2351337");
  expect(notice).toContain("No upstream source code is copied");
  expect(notice).toContain("Apache-2.0");
});
it("BR-105 the package holds the built auth modules and the pinned jose, never the qualification command or reports", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  expect(manifest.dependencies.jose).toBe("6.2.12");
  expect(manifest.devDependencies.jose).toBeUndefined();
  const directory = mkdtempSync(join(tmpdir(), "kdrive-auth-package-"));
  for (const path of ["dist", "LICENSE", "NOTICE", "README.md", "package.json"])
    cpSync(path, join(directory, path), { recursive: true });
  for (const path of [
    "scripts/oidc-qualify.ts",
    "scripts/oidc/report.ts",
    "artifacts/oidc-qualification/synthetic-20261102T120000Z.md",
  ]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), "");
  }
  const files = packageResult(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
    }),
  ).files.map((entry) => entry.path);
  for (const file of ["dist/auth/access-token.js", "dist/auth/verdict.js"])
    expect(files).toContain(file);
  expect(
    files.filter(
      (file) =>
        file.startsWith("scripts/") ||
        file.startsWith("artifacts/") ||
        file.includes("oidc-qualif"),
    ),
  ).toEqual([]);
});
it("BR-171 AC-23 the packed artifact holds no scripts entry and the SDK client stays a dev dependency", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    files: string[];
  };
  expect(manifest.devDependencies["@modelcontextprotocol/client"]).toBe(
    "2.4.0",
  );
  expect(manifest.dependencies["@modelcontextprotocol/client"]).toBeUndefined();
  const directory = mkdtempSync(join(tmpdir(), "kdrive-acceptance-package-"));
  for (const path of ["dist", "LICENSE", "NOTICE", "README.md", "package.json"])
    cpSync(path, join(directory, path), { recursive: true });
  mkdirSync(join(directory, "scripts"), { recursive: true });
  writeFileSync(join(directory, "scripts/http-acceptance.ts"), "");
  const files = packageResult(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
    }),
  ).files.map((entry) => entry.path);
  expect(files.filter((file) => file.startsWith("scripts/"))).toEqual([]);
  expect(files).toContain("dist/http/index.js");
});

// F-024: scoped package (BR-016 v3, BR-353) and the production shrinkwrap
// (BR-376, BR-377).
interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: number;
  packages: Record<string, Record<string, unknown>>;
}
let scopedPack:
  { directory: string; filename: string; count: number } | undefined;
/** The make pack recipe in a temporary copy: shrinkwrap, then npm pack. */
function packScoped(): { directory: string; filename: string; count: number } {
  if (scopedPack) return scopedPack;
  const directory = mkdtempSync(join(tmpdir(), "kdrive-scoped-package-"));
  for (const path of [
    "dist",
    "LICENSE",
    "NOTICE",
    "README.md",
    "package.json",
    "package-lock.json",
    "scripts/shrinkwrap.ts",
  ]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    cpSync(path, join(directory, path), { recursive: true });
  }
  execFileSync(process.execPath, ["scripts/shrinkwrap.ts"], { cwd: directory });
  const results = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
    }),
  ) as Packed[];
  execFileSync("tar", [
    "-xzf",
    join(directory, results[0]?.filename ?? ""),
    "-C",
    directory,
  ]);
  scopedPack = {
    directory,
    filename: results[0]?.filename ?? "",
    count: results.length,
  };
  return scopedPack;
}
function tarEntries(tarball: string): string[] {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

it("BR-016 v3 packs the scoped package with the unchanged command", () => {
  const { directory, filename, count } = packScoped();
  expect(count).toBe(1);
  expect(filename).toBe("sstolz-kdrive-mcp-server-0.1.0.tgz");
  const manifest = JSON.parse(
    readFileSync(join(directory, "package/package.json"), "utf8"),
  ) as { name: string; bin: unknown; repository: unknown };
  expect(manifest.name).toBe("@sstolz/kdrive-mcp-server");
  expect(manifest.bin).toEqual({ "kdrive-mcp-server": "dist/cli.js" });
  expect(manifest.repository).toEqual({
    type: "git",
    url: "https://github.com/sstolz/kdrive-mcp-server.git",
  });
  cpSync("node_modules/yaml", join(directory, "package/node_modules/yaml"), {
    recursive: true,
  });
  const cli = join(directory, "package/dist/cli.js");
  const version = runDiagnostic(cli, ["--version"]);
  expect(version.status).toBe(0);
  expect(version.stdout).toBe("0.1.0\n");
  const help = runDiagnostic(cli, ["--help"]);
  expect(help.stdout.startsWith("Usage: kdrive-mcp-server")).toBe(true);
  // The MCP server-info name and the User-Agent product token stay unscoped.
  expect(readFileSync("src/navigation.ts", "utf8")).toContain(
    '{ name: "kdrive-mcp-server", version: PACKAGE_VERSION }',
  );
});

it("BR-353 lockfile names", () => {
  const lock = JSON.parse(
    readFileSync("package-lock.json", "utf8"),
  ) as Lockfile;
  expect(lock.name).toBe("@sstolz/kdrive-mcp-server");
  expect(lock.packages[""]?.name).toBe("@sstolz/kdrive-mcp-server");
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
  };
  expect(manifest.name).toBe("@sstolz/kdrive-mcp-server");
});

/** BR-376 staleness comparison: the packed file must be the script output. */
function checkShrinkwrap(
  packed: string,
  lockText: string,
  expected: string,
): void {
  if (packed !== expected)
    throw new Error("packed npm-shrinkwrap.json differs from the lockfile");
  const parsed = JSON.parse(packed) as Lockfile;
  if ("devDependencies" in (parsed.packages[""] ?? {}))
    throw new Error("shrinkwrap root keeps devDependencies");
  for (const [key, entry] of Object.entries(parsed.packages))
    if (entry.dev === true) throw new Error(`dev entry ${key}`);
  const lock = JSON.parse(lockText) as Lockfile;
  for (const [key, entry] of Object.entries(lock.packages))
    if (entry.dev !== true && !(key in parsed.packages))
      throw new Error(`missing production entry ${key}`);
}
function generated(lockText: string): string {
  return shrinkwrap(lockText);
}

it("BR-376 packs the production shrinkwrap generated from the lockfile", () => {
  const pack = rules(readFileSync("Makefile", "utf8")).find(
    (rule) => rule.target === "pack",
  );
  const recipe = pack?.recipe.join("\n") ?? "";
  expect(recipe.indexOf("node scripts/shrinkwrap.ts")).toBeGreaterThan(-1);
  expect(recipe.indexOf("node scripts/shrinkwrap.ts")).toBeLessThan(
    recipe.indexOf("npm pack"),
  );
  expect(recipe.lastIndexOf("rm -f npm-shrinkwrap.json")).toBeGreaterThan(
    recipe.indexOf("npm pack"),
  );
  expect(readFileSync(".gitignore", "utf8").split("\n")).toContain(
    "/npm-shrinkwrap.json",
  );
  expect(existsSync("npm-shrinkwrap.json")).toBe(false);
  const lockText = readFileSync("package-lock.json", "utf8");
  const expected = generated(lockText);
  const tarballs = [join(packScoped().directory, packScoped().filename)];
  // During make pack (pack:check), the real artifact is checked as well.
  if (process.env.npm_lifecycle_event === "pack:check")
    tarballs.push("artifacts/sstolz-kdrive-mcp-server-0.1.0.tgz");
  for (const tarball of tarballs) {
    expect(
      tarEntries(tarball).filter((entry) =>
        entry.endsWith("npm-shrinkwrap.json"),
      ),
    ).toEqual(["package/npm-shrinkwrap.json"]);
    const packed = execFileSync(
      "tar",
      ["-xzOf", tarball, "package/npm-shrinkwrap.json"],
      { encoding: "utf8" },
    );
    expect(() => {
      checkShrinkwrap(packed, lockText, expected);
    }).not.toThrow();
  }
});

const STALE: Record<string, (lock: Lockfile) => void> = {
  "a dev entry": (lock) => {
    const [key] = Object.entries(lock.packages).find(
      ([name, entry]) => name !== "" && entry.dev !== true,
    )!;
    lock.packages[key]!.dev = true;
  },
  "a changed version": (lock) => {
    lock.packages["node_modules/zod"]!.version = "4.6.8";
  },
  "a removed entry": (lock) => {
    delete lock.packages["node_modules/zod"];
  },
};
it.each(Object.keys(STALE))("BR-376 rejects stale shrinkwrap: %s", (name) => {
  const lockText = readFileSync("package-lock.json", "utf8");
  const packed = generated(lockText);
  const lock = JSON.parse(lockText) as Lockfile;
  STALE[name]!(lock);
  const changed = `${JSON.stringify(lock, null, 2)}\n`;
  const regenerated = generated(changed);
  expect(() => {
    checkShrinkwrap(packed, changed, regenerated);
  }).toThrow();
});

/** BR-377: the BR-316 predicate applied to the shipped shrinkwrap. */
function atLeast(version: unknown, minimum: [number, number, number]): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version));
  if (!match) return false;
  const parts = [match[1], match[2], match[3]].map(Number);
  for (const [index, part] of parts.entries()) {
    if (part !== minimum[index]) return part > (minimum[index] ?? 0);
  }
  return true;
}
function checkResolution(text: string): void {
  const packages = (JSON.parse(text) as Lockfile).packages;
  const last = (key: string) => key.split("node_modules/").at(-1);
  const zod = Object.keys(packages).filter((key) => last(key) === "zod");
  if (zod.join() !== "node_modules/zod")
    throw new Error(`zod entries: ${zod.join()}`);
  if (!atLeast(packages["node_modules/zod"]?.version, [4, 6, 6]))
    throw new Error("zod below 4.6.6");
  for (const [key, entry] of Object.entries(packages))
    if (last(key) === "minimatch" && !atLeast(entry.version, [11, 0, 1]))
      throw new Error(`${key} below 11.0.1`);
}

it("BR-377 the packed shrinkwrap holds the audited resolution", () => {
  const { directory } = packScoped();
  const text = readFileSync(
    join(directory, "package/npm-shrinkwrap.json"),
    "utf8",
  );
  expect(() => {
    checkResolution(text);
  }).not.toThrow();
  expect(
    (JSON.parse(text) as Lockfile).packages["node_modules/zod"]?.version,
  ).toBe("4.6.7");
});

const RESOLUTIONS: Record<string, (packages: Lockfile["packages"]) => void> = {
  "nested @jimp/types zod 3.25.76": (packages) => {
    packages["node_modules/@jimp/types/node_modules/zod"] = {
      version: "3.25.76",
    };
  },
  "nested zod 4.6.7": (packages) => {
    packages["node_modules/@jimp/core/node_modules/zod"] = { version: "4.6.7" };
  },
  "root zod 3.25.76": (packages) => {
    packages["node_modules/zod"] = { version: "3.25.76" };
  },
  "minimatch 10.2.6": (packages) => {
    packages["node_modules/glob/node_modules/minimatch"] = {
      version: "10.2.6",
    };
  },
};
it.each(Object.keys(RESOLUTIONS))(
  "BR-377 rejects shrinkwrap resolution: %s",
  (name) => {
    const { directory } = packScoped();
    const parsed = JSON.parse(
      readFileSync(join(directory, "package/npm-shrinkwrap.json"), "utf8"),
    ) as Lockfile;
    RESOLUTIONS[name]!(parsed.packages);
    expect(() => {
      checkResolution(JSON.stringify(parsed));
    }).toThrow();
  },
);

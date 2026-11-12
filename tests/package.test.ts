import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { runDiagnostic } from "./helpers/diagnostic.js";

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

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

function validateCompose(compose: string) {
  if (
    !compose.includes("node_modules:/workspace/node_modules") ||
    !compose.includes("npm_cache:/home/node/.npm")
  )
    throw new Error("Missing isolated volumes");
  if (
    !compose.includes("target: /workspace") ||
    !compose.includes("dockerfile: Dockerfile.dev")
  )
    throw new Error("Missing dev checkout");
  if (/privileged:\s*true|env_file:|docker\.sock|ports:|expose:/u.test(compose))
    throw new Error("Unsafe development service");
  const dev = compose.split("  analysis:")[0] ?? "";
  if (/SONAR_TOKEN|environment:/u.test(dev))
    throw new Error("Unexpected default credentials");
}
it("BR-009 Compose keeps development isolated and without credentials or ports", () => {
  const compose = readFileSync("compose.yaml", "utf8");
  expect(() => {
    validateCompose(compose);
  }).not.toThrow();
  for (const bad of [
    "privileged: true",
    "env_file: .env",
    "ports: [8080]",
    "volumes: [/var/run/docker.sock:/socket]",
  ]) {
    expect(() => {
      validateCompose(`${compose}\n${bad}`);
    }).toThrow();
  }
});
it("BR-009 Docker image and context preserve pinned non-root development isolation", () => {
  const dockerfile = readFileSync("Dockerfile.dev", "utf8");
  expect(dockerfile).toMatch(
    /FROM node:26\.13\.0-bookworm@sha256:[a-f0-9]{64}/u,
  );
  expect(dockerfile).toContain("USER node");
  expect(dockerfile).toContain("git --version");
  const ignore = readFileSync(".dockerignore", "utf8").split("\n");
  for (const path of [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "secrets/",
    "node_modules/",
    "dist/",
    "coverage/",
  ])
    expect(ignore).toContain(path);
});
function makeFixture(fail = "") {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-make-"));
  copyFileSync("Makefile", join(directory, "Makefile"));
  mkdirSync(join(directory, "scripts"));
  if (existsSync("scripts/sonar-entry.sh"))
    copyFileSync(
      "scripts/sonar-entry.sh",
      join(directory, "scripts/sonar-entry.sh"),
    );
  for (const file of [
    "compose.yaml",
    "Dockerfile.dev",
    "package.json",
    "package-lock.json",
  ])
    writeFileSync(join(directory, file), "fixture\n");
  const binaries = join(directory, "bin");
  mkdirSync(binaries);
  const docker = join(binaries, "docker");
  writeFileSync(
    docker,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$FAKE_LOG"',
      'case "$*" in *"$FAIL_COMMAND"*) if test -n "$FAIL_COMMAND"; then exit "${FAIL_STATUS:-37}"; fi ;; esac',
      // F-011: emulate a successful prep container that publishes a snapshot.
      'case "$*" in *scripts/sonar-snapshot.ts*)',
      '  if test -n "${FAKE_PREP:-}"; then /bin/sh "$FAKE_PREP" || exit 1; else',
      "    run=00000000-0000-4000-8000-000000000000",
      '    mkdir -p "artifacts/sonar-input/$run"',
      '    ln -s "$run" "artifacts/sonar-input/current-$SONAR_INVOCATION_ID"',
      "  fi ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(docker, 0o755);
  const make = "/usr/bin/make";
  return {
    directory,
    make,
    env: {
      PATH: binaries,
      FAKE_LOG: join(directory, "calls"),
      FAIL_COMMAND: fail,
    },
    log: join(directory, "calls"),
  };
}
it("BR-009 default help needs neither Docker nor daemon", () => {
  const fixture = makeFixture();
  const result = spawnSync(fixture.make, ["DOCKER=/missing/docker"], {
    cwd: fixture.directory,
    env: fixture.env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("make setup");
});

it.each(["sonar", "sonar-pr", "quality"])(
  "BR-014 %s rejects unsafe credential locations before any Docker prerequisite",
  (target) => {
    for (const variant of [
      "existing-env",
      "dangling-env",
      "internal",
      "dotdot",
      "directory-alias",
      "file-symlink",
      "both",
      "neither",
    ]) {
      const fixture = makeFixture();
      const outside = mkdtempSync(join(tmpdir(), "sonar-external-"));
      mkdirSync(join(fixture.directory, ".config"));
      const supported = join(fixture.directory, ".config/qube-token");
      const internal = join(fixture.directory, "synthetic-token");
      writeFileSync(internal, "SYNTHETIC_ONLY");
      writeFileSync(join(outside, "token"), "SYNTHETIC_ONLY");
      let env: Record<string, string> = {};
      if (variant === "existing-env") {
        writeFileSync(supported, "SYNTHETIC_ONLY");
        env.SONAR_TOKEN = "SYNTHETIC_ENV";
      }
      if (variant === "dangling-env") {
        symlinkSync("missing", supported);
        env.SONAR_TOKEN = "SYNTHETIC_ENV";
      }
      if (variant === "internal") env.SONAR_TOKEN_FILE = internal;
      if (variant === "dotdot")
        env.SONAR_TOKEN_FILE =
          join(fixture.directory, ".config") + "/../synthetic-token";
      if (variant === "directory-alias") {
        symlinkSync(fixture.directory, join(outside, "alias"));
        env.SONAR_TOKEN_FILE = join(outside, "alias/synthetic-token");
      }
      if (variant === "file-symlink") {
        symlinkSync(join(outside, "token"), join(outside, "alias"));
        env.SONAR_TOKEN_FILE = join(outside, "alias");
      }
      if (variant === "both")
        env = {
          SONAR_TOKEN: "SYNTHETIC_ENV",
          SONAR_TOKEN_FILE: join(outside, "token"),
        };
      const result = spawnSync(
        fixture.make,
        [target, `DOCKER=${join(fixture.directory, "bin/docker")}`],
        {
          cwd: fixture.directory,
          env: {
            ...fixture.env,
            SONAR_HOST_URL: "https://sonar.example.test",
            ...env,
            SONAR_ENABLED: "true",
          },
          encoding: "utf8",
        },
      );
      expect(result.status, variant).not.toBe(0);
      expect(
        existsSync(fixture.log),
        `${variant}: ${result.stdout} ${result.stderr}`,
      ).toBe(false);
      expect(result.stdout + result.stderr).not.toContain("SYNTHETIC_ENV");
    }
  },
);
it("BR-009 parallel check remains ordered, fails fast and preserves Docker failure", () => {
  const fixture = makeFixture("npm run typecheck");
  const result = spawnSync(
    fixture.make,
    ["-j8", "check", `DOCKER=${resolve(fixture.directory, "bin/docker")}`],
    { cwd: fixture.directory, env: fixture.env, encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
  const calls = readFileSync(fixture.log, "utf8");
  expect(calls.indexOf("npm run lint")).toBeLessThan(
    calls.indexOf("npm run format:check"),
  );
  expect(calls.indexOf("npm run format:check")).toBeLessThan(
    calls.indexOf("npm run typecheck"),
  );
  expect(calls).not.toContain("npm run build");
  expect(calls).not.toMatch(/volume rm|down --volumes|prune/u);
});

it.each(["sonar", "sonar-pr", "quality"])(
  "BR-014 %s routes safe environment and external-file modes after the entry guard",
  (target) => {
    for (const mode of ["environment", "file"]) {
      const fixture = makeFixture();
      const outside = mkdtempSync(join(tmpdir(), "safe-token-"));
      const file = join(outside, "token");
      writeFileSync(file, "SYNTHETIC_ONLY\n");
      const hostFile = join(outside, "host");
      writeFileSync(hostFile, "https://sonar.example.test\n");
      const selected =
        mode === "file"
          ? { SONAR_TOKEN_FILE: file }
          : { SONAR_TOKEN: "SYNTHETIC_ENV" };
      const result = spawnSync(
        fixture.make,
        [target, `DOCKER=${join(fixture.directory, "bin/docker")}`],
        {
          cwd: fixture.directory,
          env: {
            ...fixture.env,
            PATH: `${fixture.env.PATH}:/usr/bin:/bin`,
            ...selected,
            ...(mode === "file"
              ? { SONAR_HOST_URL_FILE: hostFile }
              : { SONAR_HOST_URL: "https://sonar.example.test" }),
            SONAR_ENABLED: "true",
          },
          encoding: "utf8",
          timeout: 3000,
        },
      );
      expect(result.status, `${mode}: ${result.stdout} ${result.stderr}`).toBe(
        0,
      );
      const calls = readFileSync(fixture.log, "utf8");
      expect(calls).toContain("prep node scripts/sonar-snapshot.ts");
      expect(calls).toContain("--profile analysis run");
      expect(calls.includes("-f compose.sonar-file.yaml")).toBe(
        mode === "file",
      );
      expect(calls.includes("-f compose.sonar-host-file.yaml")).toBe(
        mode === "file",
      );
      expect(calls).toContain(`-e SONAR_ANALYSIS_MODE`);
      for (const call of calls
        .split("\n")
        .filter((line) => / (dev|prep) /u.test(line)))
        expect(call).not.toMatch(
          /SONAR_TOKEN|SONAR_HOST_URL|sonar-file|host-file/,
        );
      for (const call of calls
        .split("\n")
        .filter((line) => /sonar-snapshot|--profile analysis/u.test(line)))
        expect(call.startsWith("compose -f compose.yaml"), call).toBe(true);
      expect(result.stderr).toContain(
        "pristine snapshot and manifest comparisons are skipped",
      );
      expect(calls + result.stdout + result.stderr).not.toContain(
        "SYNTHETIC_ENV",
      );
      if (target === "quality")
        expect(calls.indexOf("npm run lint")).toBeLessThan(
          calls.indexOf("scripts/sonar-snapshot.ts"),
        );
    }
  },
);

it("BR-014 failed snapshot preparation prevents any scanner container launch", () => {
  const fixture = makeFixture("scripts/sonar-snapshot.ts");
  const result = spawnSync(
    fixture.make,
    ["sonar", `DOCKER=${join(fixture.directory, "bin/docker")}`],
    {
      cwd: fixture.directory,
      env: {
        ...fixture.env,
        PATH: `${fixture.env.PATH}:/usr/bin:/bin`,
        SONAR_TOKEN: "SYNTHETIC_ENV",
        SONAR_HOST_URL: "https://sonar.example.test",
        SONAR_ENABLED: "true",
      },
      encoding: "utf8",
      timeout: 3000,
    },
  );
  expect(result.status).not.toBe(0);
  expect(readFileSync(fixture.log, "utf8")).not.toContain(
    "--profile analysis run",
  );
});

it("BR-014 scanner-only credential mount and writable cache/work preserve dev isolation", () => {
  const compose = readFileSync("compose.yaml", "utf8");
  const override = readFileSync("compose.sonar-file.yaml", "utf8");
  const analysis = compose.split("  analysis:")[1] ?? "";
  expect(analysis).toContain('user: "1000:1000"');
  expect(analysis).toContain("read_only: true");
  expect(analysis).toContain("create_host_path: false");
  expect(analysis).toContain("sonar_work:/tmp/.scannerwork");
  expect(analysis).toContain("sonar_cache:/opt/sonar-scanner/.sonar");
  expect(analysis).not.toContain("SONAR_COMPATIBILITY_EVIDENCE");
  expect(override).not.toContain("  dev:");
  expect(override).toContain("source: ${SONAR_TOKEN_FILE:?");
  expect(override).toContain("target: /run/secrets/sonar-token");
  expect(override).toContain("read_only: true");
  expect(override).toContain("create_host_path: false");
  expect(readFileSync(".dockerignore", "utf8")).toContain(
    "/.config/qube-token",
  );
  expect(
    JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] },
  ).toHaveProperty("files", ["dist/", "LICENSE", "NOTICE", "README.md"]);
});

it("BR-014 outer shared deadline terminates invocation-owned containers and prevents later upload", () => {
  const fixture = makeFixture();
  const binaries = join(fixture.directory, "bin");
  writeFileSync(join(binaries, "sleep"), "#!/bin/sh\n/bin/sleep 0.02\n");
  chmodSync(join(binaries, "sleep"), 0o755);
  writeFileSync(
    join(binaries, "docker"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\ncase "$*" in *scripts/sonar-snapshot.ts*) /bin/sleep 0.2 ;; esac\n',
  );
  const result = spawnSync(
    fixture.make,
    ["sonar", `DOCKER=${join(binaries, "docker")}`],
    {
      cwd: fixture.directory,
      env: {
        ...fixture.env,
        PATH: `${binaries}:/usr/bin:/bin`,
        SONAR_TOKEN: "SYNTHETIC_ENV",
        SONAR_HOST_URL: "https://sonar.example.test",
        SONAR_ENABLED: "true",
      },
      encoding: "utf8",
      timeout: 2000,
    },
  );
  expect(result.status).not.toBe(0);
  const calls = readFileSync(fixture.log, "utf8");
  expect(calls).toMatch(/kill kdrive-sonar-prep-\d+ kdrive-sonar-scan-\d+/);
  expect(calls).not.toContain("--profile analysis run");
  expect(result.stderr).toContain("shared 15-minute deadline");
});

function runTarget(
  fixture: ReturnType<typeof makeFixture>,
  target: string,
  env: Record<string, string>,
) {
  return spawnSync(
    fixture.make,
    [target, `DOCKER=${join(fixture.directory, "bin/docker")}`],
    {
      cwd: fixture.directory,
      env: {
        ...fixture.env,
        PATH: `${fixture.env.PATH}:/usr/bin:/bin`,
        SONAR_ENABLED: "true",
        ...env,
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
}

it.each(["sonar", "sonar-pr", "quality"])(
  "BR-145 %s rejects unsafe host file locations before any Docker prerequisite",
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: a flat table of negative host-file fixtures reads best inline
  (target) => {
    for (const variant of [
      "relative",
      "internal",
      "dotdot",
      "directory-alias",
      "file-symlink",
      "missing",
      "existing-env",
      "dangling-env",
      "both",
      "neither",
      "empty",
    ]) {
      const fixture = makeFixture();
      const outside = mkdtempSync(join(tmpdir(), "sonar-host-external-"));
      mkdirSync(join(fixture.directory, ".config"));
      const supported = join(fixture.directory, ".config/sonar-host-url");
      const internal = join(fixture.directory, "synthetic-host");
      writeFileSync(internal, "https://sonar.example.test\n");
      writeFileSync(join(outside, "host"), "https://sonar.example.test\n");
      let env: Record<string, string> = {};
      if (variant === "relative") env.SONAR_HOST_URL_FILE = "synthetic-host";
      if (variant === "internal") env.SONAR_HOST_URL_FILE = internal;
      if (variant === "dotdot")
        env.SONAR_HOST_URL_FILE =
          join(fixture.directory, ".config") + "/../synthetic-host";
      if (variant === "directory-alias") {
        symlinkSync(fixture.directory, join(outside, "alias"));
        env.SONAR_HOST_URL_FILE = join(outside, "alias/synthetic-host");
      }
      if (variant === "file-symlink") {
        symlinkSync(join(outside, "host"), join(outside, "alias"));
        env.SONAR_HOST_URL_FILE = join(outside, "alias");
      }
      if (variant === "missing")
        env.SONAR_HOST_URL_FILE = join(outside, "missing");
      if (variant === "existing-env") {
        writeFileSync(supported, "https://sonar.example.test\n");
        env.SONAR_HOST_URL = "https://sonar.example.test";
      }
      if (variant === "dangling-env") {
        symlinkSync("missing", supported);
        env.SONAR_HOST_URL = "https://sonar.example.test";
      }
      if (variant === "both")
        env = {
          SONAR_HOST_URL: "https://sonar.example.test",
          SONAR_HOST_URL_FILE: join(outside, "host"),
        };
      if (variant === "empty") env.SONAR_HOST_URL = " ";
      const result = runTarget(fixture, target, {
        SONAR_TOKEN: "SYNTHETIC_ENV",
        ...env,
      });
      expect(result.status, variant).not.toBe(0);
      expect(
        existsSync(fixture.log),
        `${variant}: ${result.stdout} ${result.stderr}`,
      ).toBe(false);
      expect((result.stdout + result.stderr).toLowerCase()).not.toContain(
        "sonar.example.test",
      );
    }
  },
);

function services(file: string): Record<string, Record<string, unknown>> {
  return (
    parse(readFileSync(file, "utf8")) as {
      services: Record<string, Record<string, unknown>>;
    }
  ).services;
}
const secretNames = [
  "SONAR_TOKEN",
  "SONAR_HOST_URL",
  "SONAR_TOKEN_FILE",
  "SONAR_HOST_URL_FILE",
  "/run/secrets",
];
it("BR-150 only the analysis service receives Sonar secrets", () => {
  const base = services("compose.yaml");
  expect(Object.keys(base).sort()).toEqual(["analysis", "dev", "prep"]);
  for (const name of ["dev", "prep"])
    for (const secret of secretNames)
      expect(JSON.stringify(base[name]), `${name} ${secret}`).not.toContain(
        secret,
      );
  expect(base.analysis?.environment).toEqual([
    "SONAR_TOKEN",
    "SONAR_HOST_URL",
    "SONAR_ENABLED",
    "SONAR_ANALYSIS_MODE",
    "SONAR_USER_HOME=/opt/sonar-scanner/.sonar",
  ]);
  for (const overlay of [
    "compose.sonar-file.yaml",
    "compose.sonar-host-file.yaml",
  ])
    expect(Object.keys(services(overlay))).toEqual(["analysis"]);
  expect(services("compose.sonar-host-file.yaml").analysis).toEqual({
    environment: ["SONAR_HOST_URL_FILE=/run/secrets/sonar-host-url"],
    volumes: [
      {
        type: "bind",
        source: "${SONAR_HOST_URL_FILE:?Select an explicit external host file}",
        target: "/run/secrets/sonar-host-url",
        read_only: true,
        bind: { create_host_path: false },
      },
    ],
  });
  const entry = readFileSync("scripts/sonar-entry.sh", "utf8");
  const prep = entry
    .split("\n")
    .find((line) => line.includes("scripts/sonar-snapshot.ts"));
  expect(prep).toBeDefined();
  for (const secret of secretNames) expect(prep).not.toContain(secret);
  expect(entry).toContain("SONAR_ANALYSIS_MODE=$mode");
});

// The dev image tag is derived from the Compose project name, so checkouts
// with different project names never replace each other's prep image.
const devImage = "${COMPOSE_PROJECT_NAME:?Compose project name}-dev:local";
it("BR-150 prep mounts the checkout read-only", () => {
  const base = services("compose.yaml");
  expect(base.dev?.image).toBe(devImage);
  const prep = base.prep ?? {};
  expect(prep.image).toBe(devImage);
  expect(prep).not.toHaveProperty("build");
  expect(prep.pull_policy).toBe("never");
  expect(prep.volumes).toEqual([
    { type: "bind", source: ".", target: "/workspace", read_only: true },
    {
      type: "bind",
      source: "./artifacts/sonar-input",
      target: "/workspace/artifacts/sonar-input",
      bind: { create_host_path: false },
    },
    "node_modules:/workspace/node_modules",
    "npm_cache:/home/node/.npm",
  ]);
  const entry = readFileSync("scripts/sonar-entry.sh", "utf8");
  const calls = entry.match(/"\$docker" compose[^\n]*/gu) ?? [];
  expect(calls.length).toBeGreaterThanOrEqual(2);
  for (const call of calls)
    expect(call.startsWith('"$docker" compose -f compose.yaml'), call).toBe(
      true,
    );
});

// AC-20: no service can write Git metadata.
type Mount = Record<string, unknown> | string;
const gitBind = {
  type: "bind",
  source: "./.git",
  target: "/workspace/.git",
  read_only: true,
  bind: { create_host_path: false },
};
function mountTarget(mount: Mount): string {
  if (typeof mount === "string") return mount.split(":")[1] ?? "";
  return typeof mount.target === "string" ? mount.target : "";
}
function coversCheckout(mount: Mount): boolean {
  const source = typeof mount === "string" ? mount.split(":")[0] : mount.source;
  return source === "." || source === "./";
}
function readOnly(mount: Mount): boolean {
  if (typeof mount === "string") return /:ro$/u.test(mount);
  return mount.read_only === true;
}
function validateServiceMounts(name: string, mounts: Mount[]): void {
  const gitIndex = mounts.findIndex(
    (mount) => JSON.stringify(mount) === JSON.stringify(gitBind),
  );
  for (const [index, mount] of mounts.entries()) {
    const target = mountTarget(mount);
    const underGit =
      target === "/workspace/.git" || target.startsWith("/workspace/.git/");
    if (underGit && index !== gitIndex)
      throw new Error(`${name} mounts over /workspace/.git`);
    if (coversCheckout(mount) && !readOnly(mount) && gitIndex <= index)
      throw new Error(`${name} binds a writable checkout without .git`);
  }
}
function validateGitReadOnly(
  definitions: Record<string, Record<string, unknown>>,
): void {
  for (const [name, service] of Object.entries(definitions))
    validateServiceMounts(name, (service.volumes ?? []) as Mount[]);
  const devMounts = (definitions.dev?.volumes ?? []) as Mount[];
  if (!devMounts.some((m) => JSON.stringify(m) === JSON.stringify(gitBind)))
    throw new Error("dev lacks the read-only .git bind");
  const prepMounts = (definitions.prep?.volumes ?? []) as Mount[];
  if (!prepMounts.some((m) => coversCheckout(m) && readOnly(m)))
    throw new Error("prep checkout is writable");
}
const gitMutations: Record<
  string,
  (definitions: Record<string, Record<string, unknown>>) => void
> = {
  "dev .git bind dropped": (d) => {
    const dev = d.dev ?? {};
    dev.volumes = (dev.volumes as Mount[]).filter(
      (mount) => mountTarget(mount) !== "/workspace/.git",
    );
  },
  "dev .git bind writable": (d) => {
    for (const mount of (d.dev?.volumes ?? []) as Mount[])
      if (typeof mount !== "string" && mount.target === "/workspace/.git")
        mount.read_only = false;
  },
  "prep checkout writable": (d) => {
    for (const mount of (d.prep?.volumes ?? []) as Mount[])
      if (typeof mount !== "string" && mount.target === "/workspace")
        delete mount.read_only;
  },
  "a new service with a writable checkout": (d) => {
    d.extra = {
      volumes: [{ type: "bind", source: ".", target: "/workspace" }],
    };
  },
  "a writable bind at /workspace/.git/hooks": (d) => {
    (d.dev?.volumes as Mount[]).push({
      type: "bind",
      source: "./hooks",
      target: "/workspace/.git/hooks",
    });
  },
};
it.each(["the committed compose.yaml", ...Object.keys(gitMutations)])(
  "BR-150 v2 .git is read-only in dev and prep (%s)",
  (name) => {
    const definitions = services("compose.yaml");
    const mutate = gitMutations[name];
    if (!mutate) {
      expect(() => {
        validateGitReadOnly(definitions);
      }).not.toThrow();
      const dev = (definitions.dev?.volumes ?? []) as Mount[];
      expect(dev.findIndex((m) => mountTarget(m) === "/workspace")).toBe(0);
      expect(dev[1]).toEqual(gitBind);
      return;
    }
    mutate(definitions);
    expect(() => {
      validateGitReadOnly(definitions);
    }).toThrow();
  },
);

// AC-19: a fake prep builds the snapshot from a pristine tree, then mutates it.
function pristineFixture(ci: boolean) {
  const fixture = makeFixture();
  const outside = mkdtempSync(join(tmpdir(), "pristine-archive-"));
  const tree = join(outside, "tree");
  const files: Record<string, string> = {
    "scripts/sonar.ts": "export {};\n",
    "src/x.ts": "export const x = 1;\n",
    "tests/x.test.ts": "export {};\n",
    "tsconfig.json": "{}\n",
    "sonar-project.properties": "sonar.projectKey=kdrive-mcp-server\n",
    "package.json": '{"type":"module"}\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(tree, path, ".."), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  const archive = join(outside, "pristine.tar");
  execFileSync("tar", ["-cf", archive, "-C", tree, "."]);
  const temporary = mkdtempSync(join(tmpdir(), "pristine-tmp-"));
  const prep = join(outside, "prep.sh");
  writeFileSync(
    prep,
    [
      "set -e",
      "run=00000000-0000-4000-8000-000000000000",
      'dir="artifacts/sonar-input/$run"',
      `cp -R ${JSON.stringify(tree)} "$dir"`,
      'mkdir -p "$dir/coverage" "$dir/dist"',
      'printf "lcov\\n" > "$dir/coverage/lcov.info"',
      'printf "js\\n" > "$dir/dist/x.js"',
      'ln -s /workspace/node_modules "$dir/node_modules"',
      `printf '{\\n  "commit": "${"a".repeat(40)}",\\n  "event": "pull_request",\\n  "runId": "%s",\\n  "startedAt": 1\\n}\\n' "$run" > "$dir/analysis-snapshot.json"`,
      '(cd "$dir" && eval "${FAKE_MUTATION:-true}")',
      'ln -s "${FAKE_TARGET:-$run}" "artifacts/sonar-input/current-$SONAR_INVOCATION_ID"',
      "",
    ].join("\n"),
  );
  const env: Record<string, string> = {
    SONAR_TOKEN: "SYNTHETIC_ENV",
    SONAR_HOST_URL: "https://sonar.example.test",
    SONAR_PRISTINE_TAR: archive,
    FAKE_PREP: prep,
    TMPDIR: temporary,
  };
  if (ci) {
    env.GITHUB_ACTIONS = "true";
    env.GITHUB_SHA = "a".repeat(40);
  }
  return { fixture, env, outside, temporary };
}
const snapshotMutations: Record<string, string> = {
  "rewritten scripts/sonar.ts": "printf 'evil\\n' > scripts/sonar.ts",
  "rewritten src/x.ts": "printf 'evil\\n' > src/x.ts",
  "rewritten tsconfig.json": "printf '{\"x\":1}\\n' > tsconfig.json",
  "added scripts/extra.ts": "printf 'x\\n' > scripts/extra.ts",
  "changed sonar-project.properties":
    "printf 'sonar.exclusions=src/**\\n' >> sonar-project.properties",
  "changed package.json": "printf '{}\\n' > package.json",
  "removed tests/x.test.ts": "rm tests/x.test.ts",
  "node_modules directory": "rm node_modules && mkdir node_modules",
  "node_modules re-pointed at coverage/nm":
    "rm node_modules && mkdir coverage/nm && ln -s coverage/nm node_modules",
  "manifest commit rewritten": `sed -i 's/${"a".repeat(40)}/${"b".repeat(40)}/' analysis-snapshot.json`,
  "manifest runId rewritten":
    "sed -i 's/00000000-0000-4000-8000-000000000000/11111111-1111-4111-8111-111111111111/' analysis-snapshot.json",
  "nested src/coverage/x.ts":
    "mkdir src/coverage && printf 'x\\n' > src/coverage/x.ts",
  "nested tests/dist/x.test.ts":
    "mkdir tests/dist && printf 'x\\n' > tests/dist/x.test.ts",
  "nested scripts/node_modules/x":
    "mkdir scripts/node_modules && printf 'x\\n' > scripts/node_modules/x",
  "prep-created .env": "printf 'X=1\\n' > ../../../.env",
  "prep-created compose.override.yaml":
    "printf 'services: {}\\n' > ../../../compose.override.yaml",
};
function listing(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => !["artifacts", "calls"].includes(name))
    .sort((a, b) => a.localeCompare(b));
}
it.each([false, true])(
  "BR-150 analysis runs only pristine snapshot code (identical, CI %s)",
  (ci) => {
    const f = pristineFixture(ci);
    const before = listing(f.fixture.directory);
    const result = runTarget(f.fixture, "sonar-pr", {
      ...f.env,
      FAKE_MUTATION: "printf 'more\\n' > coverage/extra.info",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.fixture.log, "utf8")).toContain(
      "--profile analysis run",
    );
    expect(listing(f.fixture.directory)).toEqual(before);
    expect(readdirSync(f.temporary)).toEqual([]);
  },
);
it.each(Object.keys(snapshotMutations))(
  "BR-150 analysis runs only pristine snapshot code (%s)",
  (name) => {
    const f = pristineFixture(true);
    const result = runTarget(f.fixture, "sonar-pr", {
      ...f.env,
      FAKE_MUTATION: snapshotMutations[name] ?? "false",
    });
    expect(result.status, `${name}: ${result.stderr}`).not.toBe(0);
    expect(readFileSync(f.fixture.log, "utf8")).not.toContain(
      "--profile analysis run",
    );
    expect(readdirSync(f.temporary)).toEqual([]);
    hostAbsent(result);
  },
);
// BR-146 (AC-05): entry-script fixed messages never contain the host.
function hostAbsent(result: { stdout: string; stderr: string }): void {
  expect((result.stdout + result.stderr).toLowerCase()).not.toContain(
    "sonar.example.test",
  );
}
it("BR-150 analysis rejects a snapshot pointer outside artifacts/sonar-input", () => {
  const f = pristineFixture(true);
  const elsewhere = mkdtempSync(join(tmpdir(), "outside-snapshot-"));
  const result = runTarget(f.fixture, "sonar-pr", {
    ...f.env,
    FAKE_TARGET: elsewhere,
  });
  expect(result.status).not.toBe(0);
  expect(readFileSync(f.fixture.log, "utf8")).not.toContain(
    "--profile analysis run",
  );
  hostAbsent(result);
});
it.each([".env", "compose.override.yaml"])(
  "BR-150 analysis refuses an existing %s before any Docker prerequisite",
  (name) => {
    const f = pristineFixture(true);
    writeFileSync(join(f.fixture.directory, name), "X=1\n");
    const result = runTarget(f.fixture, "sonar-pr", f.env);
    expect(result.status).not.toBe(0);
    expect(existsSync(f.fixture.log)).toBe(false);
    hostAbsent(result);
  },
);
it.each(["unset", "relative", "symlink", "inside"])(
  "BR-150 CI analysis requires an external pristine archive (%s)",
  (variant) => {
    const f = pristineFixture(true);
    const env = { ...f.env };
    if (variant === "unset") delete env.SONAR_PRISTINE_TAR;
    if (variant === "relative") env.SONAR_PRISTINE_TAR = "pristine.tar";
    if (variant === "symlink") {
      symlinkSync(f.env.SONAR_PRISTINE_TAR ?? "", join(f.outside, "link.tar"));
      env.SONAR_PRISTINE_TAR = join(f.outside, "link.tar");
    }
    if (variant === "inside") {
      copyFileSync(
        f.env.SONAR_PRISTINE_TAR ?? "",
        join(f.fixture.directory, "pristine.tar"),
      );
      env.SONAR_PRISTINE_TAR = join(f.fixture.directory, "pristine.tar");
    }
    const result = runTarget(f.fixture, "sonar-pr", env);
    expect(result.status).not.toBe(0);
    expect(existsSync(f.fixture.log)).toBe(false);
    hostAbsent(result);
  },
);
it("BR-150 make help lists the PR analysis target", () => {
  const fixture = makeFixture();
  const result = spawnSync(fixture.make, ["help"], {
    cwd: fixture.directory,
    env: fixture.env,
    encoding: "utf8",
  });
  expect(result.stdout).toContain("make sonar-pr");
});
it.each(["sonar", "sonar-pr", "quality"])(
  "BR-189 %s refuses a secrets path in the checkout before any Docker prerequisite",
  (target) => {
    for (const variant of ["directory", "file", "dangling-symlink"]) {
      const fixture = makeFixture();
      const secrets = join(fixture.directory, "secrets");
      if (variant === "directory") mkdirSync(secrets);
      if (variant === "file") writeFileSync(secrets, "SYNTHETIC_ONLY");
      if (variant === "dangling-symlink") symlinkSync("missing", secrets);
      const outside = mkdtempSync(join(tmpdir(), "sonar-external-"));
      writeFileSync(join(outside, "token"), "SYNTHETIC_ONLY");
      const result = spawnSync(
        fixture.make,
        [target, `DOCKER=${join(fixture.directory, "bin/docker")}`],
        {
          cwd: fixture.directory,
          env: {
            ...fixture.env,
            SONAR_TOKEN_FILE: join(outside, "token"),
            SONAR_HOST_URL: "https://sonar.example.test",
            SONAR_ENABLED: "true",
          },
          encoding: "utf8",
        },
      );
      expect(result.status, variant).not.toBe(0);
      expect(result.stderr, variant).toContain(
        "A supported credential or host path exists in this checkout. Use an isolated clean checkout.",
      );
      expect(existsSync(fixture.log), variant).toBe(false);
    }
  },
);

function runAudit(fail: string, status: string) {
  const fixture = makeFixture(fail);
  const result = spawnSync(
    fixture.make,
    ["audit", `DOCKER=${join(fixture.directory, "bin/docker")}`],
    {
      cwd: fixture.directory,
      env: { ...fixture.env, FAIL_STATUS: status },
      encoding: "utf8",
    },
  );
  return { result, calls: readFileSync(fixture.log, "utf8").split("\n") };
}
it("TestBR319_make_audit runs exactly the high-threshold npm audit in dev and passes its success", () => {
  const { result, calls } = runAudit("", "1");
  expect(result.status, result.stderr).toBe(0);
  const audits = calls.filter((line) => line.includes("npm audit"));
  expect(audits).toEqual(["compose run --rm dev npm audit --audit-level=high"]);
  expect(calls[0]).toContain("node_modules/.package-lock.json");
});
it("TestBR319_make_audit fails with the npm audit failure status", () => {
  const { result, calls } = runAudit("npm audit", "1");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("audit] Error 1");
  expect(calls).toContain("compose run --rm dev npm audit --audit-level=high");
});
it("TestBR319_make_audit help lists the target and check never runs npm audit", () => {
  const fixture = makeFixture();
  const help = spawnSync(fixture.make, ["help"], {
    cwd: fixture.directory,
    env: fixture.env,
    encoding: "utf8",
  });
  expect(help.stdout).toContain("make audit");
  const dry = spawnSync(
    fixture.make,
    ["-n", "check", `DOCKER=${join(fixture.directory, "bin/docker")}`],
    { cwd: fixture.directory, env: fixture.env, encoding: "utf8" },
  );
  expect(dry.status, dry.stderr).toBe(0);
  expect(dry.stdout).toContain("npm run lint");
  expect(dry.stdout).not.toContain("npm audit");
});

function runInstallCheck(fail: string) {
  const fixture = makeFixture(fail);
  const result = spawnSync(
    fixture.make,
    ["install-check", `DOCKER=${join(fixture.directory, "bin/docker")}`],
    { cwd: fixture.directory, env: fixture.env, encoding: "utf8" },
  );
  return { result, calls: readFileSync(fixture.log, "utf8").split("\n") };
}
it("TestBR392_install_check runs exactly the install-check script in dev after the build", () => {
  const { result, calls } = runInstallCheck("");
  expect(result.status, result.stderr).toBe(0);
  expect(calls[0]).toContain("node_modules/.package-lock.json");
  const build = calls.indexOf("compose run --rm dev npm run build");
  const check = calls.indexOf(
    "compose run --rm -T dev node scripts/install-check.ts",
  );
  expect(build).toBeGreaterThan(0);
  expect(check).toBeGreaterThan(build);
  expect(calls.filter((line) => line.includes("install-check"))).toHaveLength(
    1,
  );
});
it("TestBR392_install_check fails with the script failure status", () => {
  const { result } = runInstallCheck("scripts/install-check.ts");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("install-check] Error 37");
});
it("TestBR392_install_check help lists the target and check never runs it", () => {
  const fixture = makeFixture();
  const help = spawnSync(fixture.make, ["help"], {
    cwd: fixture.directory,
    env: fixture.env,
    encoding: "utf8",
  });
  expect(help.stdout).toContain("make install-check");
  const dry = spawnSync(
    fixture.make,
    ["-n", "check", `DOCKER=${join(fixture.directory, "bin/docker")}`],
    { cwd: fixture.directory, env: fixture.env, encoding: "utf8" },
  );
  expect(dry.status, dry.stderr).toBe(0);
  expect(dry.stdout).toContain("npm run lint");
  expect(dry.stdout).not.toContain("install-check");
});

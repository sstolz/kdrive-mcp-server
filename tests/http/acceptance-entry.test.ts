// F-012 v2 AC-25: `make http-acceptance` validates an external, read-only
// secrets directory before any Docker command (BR-171 v2).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

const SECRETS_IN_CHECKOUT =
  "A secrets path exists in this checkout. Move the acceptance secrets outside the checkout.";
const SET_VARIABLE =
  "Set HTTP_ACCEPTANCE_SECRETS_DIR to an absolute directory outside the checkout.";
const UNAVAILABLE = "The acceptance secrets directory is unavailable.";
const INSIDE = "The acceptance secrets directory is inside the dev checkout.";
const FILE_UNAVAILABLE = "An acceptance secret file is unavailable.";
const OTHER_ENTRIES = "The acceptance secrets directory holds other entries.";
const COMPOSE_GUARD =
  "A Compose override or .env file exists in this checkout; analysis refused.";
const CONTENT = "SYNTHETIC_SECRET_CONTENT";
const MAKE = "/usr/bin/make";
const ENTRY = "scripts/http-acceptance-entry.sh";

interface Fixture {
  root: string;
  outside: string;
  secrets: string;
  docker: string;
  log: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "kdrive-acceptance-"));
  copyFileSync("Makefile", join(root, "Makefile"));
  mkdirSync(join(root, "scripts"));
  if (existsSync(ENTRY)) copyFileSync(ENTRY, join(root, ENTRY));
  for (const file of [
    "compose.yaml",
    "Dockerfile.dev",
    "package.json",
    "package-lock.json",
  ])
    writeFileSync(join(root, file), "fixture\n");
  mkdirSync(join(root, "bin"));
  const docker = join(root, "bin/docker");
  const log = join(root, "calls");
  writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n');
  chmodSync(docker, 0o755);
  const outside = mkdtempSync(join(tmpdir(), "kdrive-acceptance-outside-"));
  const secrets = join(outside, "secrets");
  mkdirSync(secrets);
  writeFileSync(join(secrets, "upstream-client-secret"), CONTENT);
  writeFileSync(join(secrets, "signing-key.pem"), CONTENT);
  return { root, outside, secrets, docker, log };
}

type Setup = (fixture: Fixture) => string | undefined;

const variants: [string, string, Setup][] = [
  [
    "secrets directory in the checkout",
    SECRETS_IN_CHECKOUT,
    (f) => {
      mkdirSync(join(f.root, "secrets"));
      return f.secrets;
    },
  ],
  [
    "secrets regular file in the checkout",
    SECRETS_IN_CHECKOUT,
    (f) => {
      writeFileSync(join(f.root, "secrets"), CONTENT);
      return f.secrets;
    },
  ],
  [
    "dangling secrets symlink in the checkout",
    SECRETS_IN_CHECKOUT,
    (f) => {
      symlinkSync("missing", join(f.root, "secrets"));
      return f.secrets;
    },
  ],
  ["variable unset", SET_VARIABLE, () => undefined],
  ["variable empty", SET_VARIABLE, () => ""],
  ["relative value", SET_VARIABLE, () => "secrets-x"],
  ["value containing a colon", SET_VARIABLE, (f) => `${f.secrets}:x`],
  ["value containing a newline", SET_VARIABLE, (f) => `${f.secrets}\nx`],
  [
    "directory that is a symlink",
    UNAVAILABLE,
    (f) => {
      symlinkSync(f.secrets, join(f.outside, "alias"));
      return join(f.outside, "alias");
    },
  ],
  ["missing directory", UNAVAILABLE, (f) => join(f.outside, "missing")],
  [
    "directory that is a regular file",
    UNAVAILABLE,
    (f) => join(f.secrets, "signing-key.pem"),
  ],
  ["directory equal to the checkout", INSIDE, (f) => f.root],
  [
    "directory under the checkout",
    INSIDE,
    (f) => {
      mkdirSync(join(f.root, "held"));
      return join(f.root, "held");
    },
  ],
  [
    "directory that is an ancestor of the checkout",
    INSIDE,
    (f) => dirname(f.root),
  ],
  [
    "directory reached through an outside symlinked parent",
    INSIDE,
    (f) => {
      mkdirSync(join(f.root, "held"));
      symlinkSync(f.root, join(f.outside, "parent"));
      return join(f.outside, "parent/held");
    },
  ],
  [
    "trailing-slash symlink value",
    UNAVAILABLE,
    (f) => {
      symlinkSync(f.secrets, join(f.outside, "alias"));
      return `${join(f.outside, "alias")}/`;
    },
  ],
  ...(["upstream-client-secret", "signing-key.pem"] as const).flatMap(
    (name): [string, string, Setup][] => [
      [
        `${name} missing`,
        FILE_UNAVAILABLE,
        (f) => {
          spawnSync("/bin/rm", [join(f.secrets, name)]);
          return f.secrets;
        },
      ],
      [
        `${name} symlink to an outside file`,
        FILE_UNAVAILABLE,
        (f) => {
          spawnSync("/bin/rm", [join(f.secrets, name)]);
          writeFileSync(join(f.outside, "target"), CONTENT);
          symlinkSync(join(f.outside, "target"), join(f.secrets, name));
          return f.secrets;
        },
      ],
      [
        `${name} directory`,
        FILE_UNAVAILABLE,
        (f) => {
          spawnSync("/bin/rm", [join(f.secrets, name)]);
          mkdirSync(join(f.secrets, name));
          return f.secrets;
        },
      ],
      [
        `${name} mode 000`,
        FILE_UNAVAILABLE,
        (f) => {
          chmodSync(join(f.secrets, name), 0o000);
          return f.secrets;
        },
      ],
    ],
  ),
  // Review #65 round 1: a `.`/`..` component would skip the symlink check.
  [
    "value with a dot component through a symlink",
    SET_VARIABLE,
    (f) => {
      symlinkSync(f.secrets, join(f.outside, "alias"));
      return `${join(f.outside, "alias")}/.`;
    },
  ],
  [
    "value with a dot-dot component",
    SET_VARIABLE,
    (f) => `${f.secrets}/../secrets`,
  ],
  // Review #65 round 1: an unlistable directory would hide extra entries.
  [
    "directory that cannot be listed",
    UNAVAILABLE,
    (f) => {
      chmodSync(f.secrets, 0o311);
      return f.secrets;
    },
  ],
  [
    "extra hidden entry",
    OTHER_ENTRIES,
    (f) => {
      writeFileSync(join(f.secrets, ".extra"), CONTENT);
      return f.secrets;
    },
  ],
  [
    "compose.override.yaml in the checkout",
    COMPOSE_GUARD,
    (f) => {
      writeFileSync(join(f.root, "compose.override.yaml"), "fixture\n");
      return f.secrets;
    },
  ],
  [
    ".env in the checkout",
    COMPOSE_GUARD,
    (f) => {
      writeFileSync(join(f.root, ".env"), "fixture\n");
      return f.secrets;
    },
  ],
];

function environment(fixture: Fixture, value: string | undefined) {
  const env: Record<string, string> = {
    PATH: `${join(fixture.root, "bin")}:/usr/bin:/bin`,
    FAKE_LOG: fixture.log,
  };
  if (value !== undefined) env.HTTP_ACCEPTANCE_SECRETS_DIR = value;
  return env;
}

it("BR-171 v2 AC-25 runs as the non-root dev user", () => {
  expect(process.getuid?.()).not.toBe(0);
});

it.each(variants)(
  "BR-171 v2 AC-25 refuses %s before any Docker command",
  (_name, line, setup) => {
    const fixture = makeFixture();
    const value = setup(fixture);
    const env = environment(fixture, value);
    const viaMake = spawnSync(
      MAKE,
      ["http-acceptance", `DOCKER=${fixture.docker}`],
      { cwd: fixture.root, env, encoding: "utf8" },
    );
    const direct = spawnSync(
      "/bin/sh",
      [ENTRY, fixture.docker, MAKE, "Makefile"],
      { cwd: fixture.root, env, encoding: "utf8" },
    );
    expect(viaMake.status).not.toBe(0);
    expect(viaMake.stderr).toContain(`${line}\n`);
    expect(direct.status).toBe(1);
    expect(direct.stderr).toBe(`${line}\n`);
    expect(direct.stdout).toBe("");
    for (const output of [viaMake.stdout + viaMake.stderr, direct.stderr]) {
      expect(output).not.toContain(CONTENT);
      if (value) expect(output).not.toContain(value);
      expect(output).not.toContain(fixture.outside);
    }
    expect(existsSync(fixture.log)).toBe(false);
  },
);

it("BR-171 v2 AC-25 builds, then runs one compose run with the read-only mount", () => {
  const fixture = makeFixture();
  const result = spawnSync(
    MAKE,
    ["http-acceptance", `DOCKER=${fixture.docker}`],
    {
      cwd: fixture.root,
      env: environment(fixture, fixture.secrets),
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const calls = readFileSync(fixture.log, "utf8").split("\n");
  const build = calls.findIndex((call) => call.includes("npm run build"));
  const runs = calls.filter((call) =>
    call.includes("node scripts/http-acceptance.ts"),
  );
  expect(build).toBeGreaterThanOrEqual(0);
  expect(runs).toHaveLength(1);
  const run = runs[0] ?? "";
  expect(calls.indexOf(run)).toBeGreaterThan(build);
  expect(run).toMatch(/\bcompose\b.* run /u);
  expect(run).toContain(
    `--volume ${realpathSync(fixture.secrets)}:/run/secrets:ro`,
  );
  expect(run).toContain(
    "OAUTH_UPSTREAM_CLIENT_SECRET_FILE=/run/secrets/upstream-client-secret",
  );
  expect(run).toContain("OAUTH_SIGNING_KEY_FILE=/run/secrets/signing-key.pem");
  expect(run).toContain("--publish 127.0.0.1:3000:3000");
  expect(run).not.toContain("/workspace/secrets");
  expect(result.stdout + result.stderr).not.toContain(CONTENT);
});

it("BR-171 v2 AC-25 repeats the Compose guard after the build step", () => {
  const fixture = makeFixture();
  // The fake build writes a .env into the checkout; the final run must refuse.
  writeFileSync(
    fixture.docker,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\ncase "$*" in *"npm run build"*) : > .env ;; esac\n',
  );
  const result = spawnSync(
    "/bin/sh",
    [ENTRY, fixture.docker, MAKE, "Makefile"],
    {
      cwd: fixture.root,
      env: environment(fixture, fixture.secrets),
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${COMPOSE_GUARD}\n`);
  const calls = readFileSync(fixture.log, "utf8");
  expect(calls).toContain("npm run build");
  expect(calls).not.toContain("node scripts/http-acceptance.ts");
});

function treeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

it("BR-171 v2 AC-25 no tracked tool or doc file references the in-checkout secrets path", () => {
  for (const file of [
    "Makefile",
    "compose.yaml",
    ...treeFiles("scripts"),
    ...treeFiles("docs"),
  ])
    expect(readFileSync(file, "utf8"), file).not.toContain(
      "/workspace/secrets",
    );
  expect(readFileSync("docs/oauth-proxy.md", "utf8")).toContain(
    "HTTP_ACCEPTANCE_SECRETS_DIR",
  );
});

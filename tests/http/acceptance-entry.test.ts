// F-012 v2 AC-25: `make http-acceptance` validates an external, read-only
// secrets directory before any Docker command (BR-171 v3, formerly v2).
// F-029 AC-02 to AC-04 and AC-06: the optional private state directory
// (BR-397, BR-171 v3, BR-398).
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

it("BR-171 v3 AC-25 runs as the non-root dev user", () => {
  expect(process.getuid?.()).not.toBe(0);
});

it.each(variants)(
  "BR-171 v3 AC-25 refuses %s before any Docker command",
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

it("BR-171 v3 AC-25 builds, then runs one compose run with the read-only mount", () => {
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

it("BR-171 v3 AC-25 repeats the Compose guard after the build step", () => {
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

it("BR-171 v3 AC-25 no tracked tool or doc file references the in-checkout secrets path", () => {
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

// F-029: the optional private state directory (BR-397, BR-171 v3, BR-398).
const STATE_FILE_SET =
  "Do not set OAUTH_STATE_FILE; set HTTP_ACCEPTANCE_STATE_DIR to persist the acceptance OAuth state.";
const STATE_SELECTION =
  "Set HTTP_ACCEPTANCE_STATE_DIR to an absolute directory outside the checkout.";
const STATE_UNAVAILABLE = "The acceptance state directory is unavailable.";
const STATE_INSIDE =
  "The acceptance state directory is inside the dev checkout.";
const STATE_OVERLAP =
  "The acceptance state directory overlaps the secrets directory.";
const STATE_NOT_PRIVATE = "The acceptance state directory is not private.";
const STATE_OTHER_ENTRIES =
  "The acceptance state directory holds other entries.";
const STATE_FILE_UNAVAILABLE = "An acceptance state file is unavailable.";
const STATE_TARGET = "/run/oauth-state";
const STATE_FILE = "oauth-state.sqlite";
const STATE_SETTING = `OAUTH_STATE_FILE=${STATE_TARGET}/${STATE_FILE}`;

function stateDirectory(): string {
  // mkdtemp creates the directory with mode 0700.
  return mkdtempSync(join(tmpdir(), "kdrive-acceptance-state-"));
}

interface StateCase {
  value: string;
  extra?: Record<string, string>;
}

const stateVariants: [string, string, (f: Fixture) => StateCase][] = [
  [
    "(1) OAUTH_STATE_FILE set with a valid state directory",
    STATE_FILE_SET,
    () => ({
      value: stateDirectory(),
      extra: { OAUTH_STATE_FILE: "/run/oauth-state/oauth-state.sqlite" },
    }),
  ],
  [
    "(1) OAUTH_STATE_FILE set without a state directory",
    STATE_FILE_SET,
    () => ({ value: "", extra: { OAUTH_STATE_FILE: "state.sqlite" } }),
  ],
  ["(2) a relative path", STATE_SELECTION, () => ({ value: "state-x" })],
  [
    "(2) a dot-dot component",
    STATE_SELECTION,
    () => {
      const state = stateDirectory();
      return {
        value: `${state}/../${state.slice(state.lastIndexOf("/") + 1)}`,
      };
    },
  ],
  ["(2) a colon", STATE_SELECTION, () => ({ value: `${stateDirectory()}:x` })],
  [
    "(3) a missing path",
    STATE_UNAVAILABLE,
    (f) => ({ value: join(f.outside, "missing-state") }),
  ],
  [
    "(3) a symlink to a directory",
    STATE_UNAVAILABLE,
    (f) => {
      symlinkSync(stateDirectory(), join(f.outside, "state-alias"));
      return { value: join(f.outside, "state-alias") };
    },
  ],
  ["(4) the checkout", STATE_INSIDE, (f) => ({ value: f.root })],
  [
    "(4) a directory under the checkout",
    STATE_INSIDE,
    (f) => {
      mkdirSync(join(f.root, "state"), { mode: 0o700 });
      return { value: join(f.root, "state") };
    },
  ],
  [
    "(4) an ancestor of the checkout",
    STATE_INSIDE,
    (f) => ({ value: dirname(f.root) }),
  ],
  ["(5) the secrets directory", STATE_OVERLAP, (f) => ({ value: f.secrets })],
  [
    "(5) an ancestor of the secrets directory",
    STATE_OVERLAP,
    (f) => ({ value: f.outside }),
  ],
  ...([0o750, 0o701] as const).map(
    (mode): [string, string, (f: Fixture) => StateCase] => [
      `(6) mode 0${mode.toString(8)}`,
      STATE_NOT_PRIVATE,
      () => {
        const state = stateDirectory();
        chmodSync(state, mode);
        return { value: state };
      },
    ],
  ),
  [
    "(7) a hidden file",
    STATE_OTHER_ENTRIES,
    () => {
      const state = stateDirectory();
      writeFileSync(join(state, ".hidden"), CONTENT);
      return { value: state };
    },
  ],
  [
    "(8) the state file as a symlink",
    STATE_FILE_UNAVAILABLE,
    (f) => {
      const state = stateDirectory();
      writeFileSync(join(f.outside, "state-target"), CONTENT);
      symlinkSync(join(f.outside, "state-target"), join(state, STATE_FILE));
      return { value: state };
    },
  ],
  [
    "(8) the state file as a directory",
    STATE_FILE_UNAVAILABLE,
    () => {
      const state = stateDirectory();
      mkdirSync(join(state, STATE_FILE));
      return { value: state };
    },
  ],
];

function stateEnvironment(fixture: Fixture, state: StateCase | undefined) {
  const env = environment(fixture, fixture.secrets);
  if (state !== undefined) {
    env.HTTP_ACCEPTANCE_STATE_DIR = state.value;
    Object.assign(env, state.extra);
  }
  return env;
}

it.each(stateVariants)(
  "BR-397 AC-02 refuses %s before any Docker command",
  (_name, line, setup) => {
    const fixture = makeFixture();
    const state = setup(fixture);
    const env = stateEnvironment(fixture, state);
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
      if (state.value) expect(output).not.toContain(state.value);
      expect(output).not.toContain(fixture.outside);
      expect(output).not.toContain(tmpdir());
    }
    expect(existsSync(fixture.log)).toBe(false);
  },
);

function v2Run(fixture: Fixture, insert = ""): string {
  return (
    "compose -f compose.yaml run --rm --publish 127.0.0.1:3000:3000" +
    " -e MCP_HTTP_HOST=0.0.0.0 -e MCP_HTTP_PORT=3000" +
    " -e MCP_PUBLIC_URL -e OAUTH_ISSUER -e OAUTH_ALLOWED_SUBJECTS -e OAUTH_ALLOWED_EMAILS" +
    " -e OAUTH_UPSTREAM_CLIENT_ID -e OAUTH_ALLOWED_REDIRECT_URIS -e OAUTH_ALLOWED_CLIENT_ID_ORIGINS" +
    ` --volume ${realpathSync(fixture.secrets)}:/run/secrets:ro` +
    " -e OAUTH_UPSTREAM_CLIENT_SECRET_FILE=/run/secrets/upstream-client-secret" +
    " -e OAUTH_SIGNING_KEY_FILE=/run/secrets/signing-key.pem" +
    insert +
    " dev node scripts/http-acceptance.ts"
  );
}

const runCases: [string, (() => string) | undefined][] = [
  ["(a) without a state directory", undefined],
  ["(b) with an empty private state directory", stateDirectory],
  [
    "(c) with a state file and its journal",
    () => {
      const state = stateDirectory();
      writeFileSync(join(state, STATE_FILE), "");
      writeFileSync(join(state, `${STATE_FILE}-journal`), "");
      return state;
    },
  ],
];

it.each(runCases)(
  "BR-397 BR-171 v3 AC-03 builds, then runs one compose run %s",
  (_name, makeState) => {
    const fixture = makeFixture();
    const state = makeState?.();
    const result = spawnSync(
      MAKE,
      ["http-acceptance", `DOCKER=${fixture.docker}`],
      {
        cwd: fixture.root,
        env: stateEnvironment(
          fixture,
          state === undefined ? undefined : { value: state },
        ),
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
    expect(calls.indexOf(runs[0] ?? "")).toBeGreaterThan(build);
    expect(runs[0]).toBe(
      v2Run(
        fixture,
        state === undefined
          ? ""
          : ` --volume ${realpathSync(state)}:${STATE_TARGET} -e ${STATE_SETTING}`,
      ),
    );
    expect(runs[0]).not.toContain(`${STATE_TARGET}:ro`);
  },
);

it("BR-171 v3 AC-04 only the entry script mounts the state directory", () => {
  const files = [
    "Makefile",
    "compose.yaml",
    ...treeFiles("scripts"),
    ...treeFiles("docs"),
  ];
  const naming = new Set(["Makefile", ENTRY, "docs/oauth-proxy.md"]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    expect(text.includes(`:${STATE_TARGET}`), file).toBe(file === ENTRY);
    if (text.includes("HTTP_ACCEPTANCE_STATE_DIR"))
      expect(naming.has(file), file).toBe(true);
    for (const match of text.matchAll(
      /OAUTH_STATE_FILE[=:]\s*["'`]?([^\s"'`]*)/gu,
    )) {
      const value = match[1] ?? "";
      if (value === "") continue;
      expect(value.startsWith("/"), `${file}: ${value}`).toBe(true);
      expect(value.startsWith("/workspace"), `${file}: ${value}`).toBe(false);
    }
    const paths = text
      .split(/[\s`"']+/u)
      .filter((token) => token.includes(`/${STATE_FILE}`));
    for (const path of paths) {
      const allowed =
        path.includes(`${STATE_TARGET}/${STATE_FILE}`) ||
        file === "docs/oauth-proxy.md" ||
        // F-029 v2 AC-04: the F-013 production path in docs/deployment.md.
        (file === "docs/deployment.md" &&
          path.endsWith("/audit/oauth-state.sqlite"));
      expect(allowed, `${file}: ${path}`).toBe(true);
    }
  }
  // In the Makefile, only the help line and the http-acceptance recipe name it.
  const lines = readFileSync("Makefile", "utf8").split("\n");
  const recipe = lines.indexOf("http-acceptance:");
  lines.forEach((line, index) => {
    if (!line.includes("HTTP_ACCEPTANCE_STATE_DIR")) return;
    const inRecipe =
      index > recipe &&
      lines.slice(recipe + 1, index + 1).every((l) => l.startsWith("\t"));
    expect(line.includes("make http-acceptance ") || inRecipe, line).toBe(true);
  });
});

it("BR-398 AC-06 documents the optional state directory and the owner run", () => {
  const doc = readFileSync("docs/oauth-proxy.md", "utf8");
  const start = doc.indexOf("### Owner-run acceptance composition");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = doc.indexOf("\n#", start + 1);
  const section = (
    next === -1 ? doc.slice(start) : doc.slice(start, next)
  ).replaceAll(/\s+/gu, " ");
  for (const statement of [
    "`HTTP_ACCEPTANCE_STATE_DIR` is optional",
    "a restart loses every client and login",
    "outside the checkout and the secrets directory",
    "owned by the dev container user",
    "mode `0700`",
    "nothing but the state file and its journal",
    "`DEV_UID=… make setup`",
    "`docs/development.md`",
    "`OAUTH_STATE_UNAVAILABLE`",
    "same `MCP_PUBLIC_URL`",
    "`OAUTH_STATE_MISMATCH`",
    "credential store",
    "delete `oauth-state.sqlite` and its `-journal`",
    "HTTP_ACCEPTANCE_SECRETS_DIR=/abs/secrets HTTP_ACCEPTANCE_STATE_DIR=/abs/state make http-acceptance",
    "consent page shows the client host",
    "without logging in again",
    "client matrix",
  ])
    expect(section, statement).toContain(statement);
  const help = spawnSync(MAKE, ["-s", "help"], { encoding: "utf8" });
  const line = help.stdout
    .split("\n")
    .find((entry) => entry.includes("make http-acceptance "));
  expect(line).toContain("HTTP_ACCEPTANCE_STATE_DIR");
});

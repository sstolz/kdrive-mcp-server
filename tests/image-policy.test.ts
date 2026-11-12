import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishScope,
  validateDockerfile,
  validateDockerignore,
  validateMakefile,
  validateNoPublish,
} from "./helpers/image-policy.js";

const dockerfile = readFileSync("Dockerfile", "utf8");
const makefile = readFileSync("Makefile", "utf8");
const dockerignore = readFileSync(".dockerignore", "utf8");

function rejects(run: () => void): void {
  expect(run).toThrow();
}

describe("F-013 AC-02 Dockerfile policy", () => {
  it("BR-172 BR-173 BR-174 BR-175 BR-176 accept the real Dockerfile", () => {
    expect(() => {
      validateDockerfile(dockerfile);
    }).not.toThrow();
  });

  it("BR-172 pins every external base by digest and runs build stages natively", () => {
    const froms = dockerfile
      .split("\n")
      .filter((line) => line.startsWith("FROM "));
    expect(froms).toHaveLength(4);
    expect(froms[0]).toMatch(
      /^FROM --platform=\$BUILDPLATFORM node:26\.13\.0-bookworm@sha256:[0-9a-f]{64} AS build$/u,
    );
    expect(froms[1]).toMatch(
      /^FROM --platform=\$BUILDPLATFORM node:26\.13\.0-bookworm@sha256:[0-9a-f]{64} AS deps$/u,
    );
    expect(froms[2]).toMatch(
      /^FROM node:26\.13\.0-bookworm-slim@sha256:[0-9a-f]{64} AS runtime$/u,
    );
    expect(froms[3]).toBe("FROM runtime AS smoke");
  });

  const mutations: Record<string, (text: string) => string> = {
    // BR-172
    "unpinned base": (text) =>
      text.replace(/(node:26\.13\.0-bookworm-slim)@sha256:[0-9a-f]{64}/u, "$1"),
    "reordered stages": (text) =>
      text.replace(" AS build", " AS first").replace(" AS deps", " AS build"),
    "platform on runtime": (text) =>
      text.replace(
        "FROM node:26.13.0-bookworm-slim",
        "FROM --platform=$BUILDPLATFORM node:26.13.0-bookworm-slim",
      ),
    "missing runtime node check": (text) =>
      text.replace('RUN test "$(node --version)" = v26.13.0\nENV', "ENV"),
    // BR-173
    "COPY . .": (text) =>
      text.replace(
        "ENV NODE_ENV=production",
        "COPY . .\nENV NODE_ENV=production",
      ),
    "RUN npm in runtime": (text) =>
      text.replace(
        "ENV NODE_ENV=production",
        "RUN npm --version\nENV NODE_ENV=production",
      ),
    "cache kept": (text) => text.replaceAll("rm -rf /tmp/npm-cache", "true"),
    "optional dependencies": (text) => text.replaceAll(" --omit=optional", ""),
    // BR-174
    "missing USER": (text) => text.replace("USER 1000:1000\n", ""),
    "chown copy": (text) =>
      text.replace("COPY --from=deps", "COPY --chown=1000:1000 --from=deps"),
    // BR-175
    "CMD in runtime": (text) =>
      text.replace("STOPSIGNAL SIGTERM", 'STOPSIGNAL SIGTERM\nCMD ["--http"]'),
    "other STOPSIGNAL": (text) =>
      text.replace("STOPSIGNAL SIGTERM", "STOPSIGNAL SIGINT"),
    // BR-176
    "extra smoke file": (text) =>
      text.replace(
        'ENTRYPOINT ["node", "/app/scripts/http-acceptance.ts"]',
        'COPY scripts/oidc-qualify.ts /app/scripts/oidc-qualify.ts\nENTRYPOINT ["node", "/app/scripts/http-acceptance.ts"]',
      ),
    "writable smoke file": (text) =>
      text.replace(
        "--chmod=0755 scripts/http-acceptance.ts",
        "--chmod=0775 scripts/http-acceptance.ts",
      ),
    // BR-179
    "secret ARG": (text) =>
      text.replace("AS runtime\n", "AS runtime\nARG KDRIVE_TOKEN\n"),
  };
  it.each(Object.keys(mutations))(
    "BR-172 BR-173 BR-174 BR-175 BR-176 reject Dockerfile mutation: %s",
    (name) => {
      const mutated = mutations[name]?.(dockerfile) ?? dockerfile;
      expect(mutated).not.toBe(dockerfile);
      rejects(() => {
        validateDockerfile(mutated);
      });
    },
  );
});

describe("F-021 AC-07 runtime HEALTHCHECK policy", () => {
  const HEALTHCHECK =
    'HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=3 CMD ["node", "/app/dist/healthcheck.js"]';
  const runtimeLines = () => {
    const start = dockerfile.indexOf(" AS runtime\n");
    const end = dockerfile.indexOf(" AS smoke\n");
    return dockerfile.slice(start, end).split("\n");
  };

  it("BR-327 the runtime stage has exactly the health check, smoke none, and one RUN", () => {
    const runtime = runtimeLines();
    expect(runtime.filter((line) => line.startsWith("HEALTHCHECK"))).toEqual([
      HEALTHCHECK,
    ]);
    expect(runtime.filter((line) => line.startsWith("RUN"))).toEqual([
      'RUN test "$(node --version)" = v26.13.0',
    ]);
    const smoke = dockerfile.slice(dockerfile.indexOf(" AS smoke\n"));
    expect(smoke).not.toContain("HEALTHCHECK");
    expect(() => {
      validateDockerfile(dockerfile);
    }).not.toThrow();
  });

  const replaceCheck = (replacement: string) => (text: string) =>
    text.replace(HEALTHCHECK, replacement);
  const mutations: Record<string, (text: string) => string> = {
    "no HEALTHCHECK": replaceCheck(""),
    "shell-form CMD": replaceCheck(
      "HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=3 CMD node /app/dist/healthcheck.js",
    ),
    "curl in the command": replaceCheck(
      'HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=3 CMD ["curl", "-f", "http://127.0.0.1:3000/healthz"]',
    ),
    "other interval": (text) =>
      text.replace("--interval=10s", "--interval=30s"),
    "other timeout": (text) => text.replace("--timeout=10s", "--timeout=5s"),
    "other start period": (text) =>
      text.replace("--start-period=30s", "--start-period=60s"),
    "other retries": (text) => text.replace("--retries=3", "--retries=5"),
    "added start interval": (text) =>
      text.replace("--retries=3", "--retries=3 --start-interval=1s"),
    "two HEALTHCHECKs": replaceCheck(`${HEALTHCHECK}\n${HEALTHCHECK}`),
    "HEALTHCHECK in smoke": (text) =>
      text.replace(
        'ENTRYPOINT ["node", "/app/scripts/http-acceptance.ts"]',
        `${HEALTHCHECK}\nENTRYPOINT ["node", "/app/scripts/http-acceptance.ts"]`,
      ),
    "HEALTHCHECK NONE": replaceCheck("HEALTHCHECK NONE"),
    "added RUN apt-get install curl": (text) =>
      text.replace(
        "ENV NODE_ENV=production",
        "RUN apt-get update && apt-get install -y curl\nENV NODE_ENV=production",
      ),
  };
  it.each(Object.keys(mutations))(
    "BR-327 rejects Dockerfile mutation: %s",
    (name) => {
      const mutated = mutations[name]?.(dockerfile) ?? dockerfile;
      expect(mutated).not.toBe(dockerfile);
      rejects(() => {
        validateDockerfile(mutated);
      });
    },
  );
});

describe("F-013 AC-05 build, binfmt, ignore and publish policy", () => {
  it("BR-177 BR-188 accept the real Makefile", () => {
    expect(() => {
      validateMakefile(makefile);
    }).not.toThrow();
  });

  it("BR-179 accepts the real .dockerignore", () => {
    expect(() => {
      validateDockerignore(dockerignore);
    }).not.toThrow();
  });

  it("BR-178 finds no push, publish or login marker in Dockerfiles, Makefile, scripts or workflows", () => {
    const scope = publishScope();
    expect(Object.keys(scope)).toContain("scripts/image-smoke.sh");
    expect(Object.keys(scope)).toContain(".github/workflows/ci.yml");
    expect(() => {
      validateNoPublish(scope);
    }).not.toThrow();
  });

  const LOAD = '--target "$$target" --load';
  const makeMutations: Record<string, (text: string) => string> = {
    "--push": (text) => text.replace(LOAD, LOAD.replace("--load", "--push")),
    "docker login": (text) =>
      text.replace(
        '"$(DOCKER)" buildx version',
        'docker login && "$(DOCKER)" buildx version',
      ),
    "tag-pinned binfmt": (text) =>
      text.replace(
        /tonistiigi\/binfmt@sha256:[0-9a-f]{64}/u,
        "tonistiigi/binfmt:latest",
      ),
    "image depends on image-binfmt": (text) =>
      text.replace(/^image:/mu, "image: image-binfmt"),
    "image calls image-binfmt": (text) =>
      text.replace(
        /^image:\n/mu,
        'image:\n\t+$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" image-binfmt\n',
      ),
    "build argument": (text) => text.replace(LOAD, `${LOAD} --build-arg X=1`),
    "second privileged recipe": (text) =>
      text.replace(
        '"$(DOCKER)" buildx version',
        '"$(DOCKER)" run --rm --privileged busybox true; "$(DOCKER)" buildx version',
      ),
    "missing architecture check": (text) =>
      text.replace(
        "image inspect --format '{{.Os}}/{{.Architecture}}'",
        "image ls",
      ),
  };
  it.each(Object.keys(makeMutations))(
    "BR-177 BR-178 BR-188 reject Makefile mutation: %s",
    (name) => {
      const mutated = makeMutations[name]?.(makefile) ?? makefile;
      expect(mutated).not.toBe(makefile);
      rejects(() => {
        validateMakefile(mutated);
        validateNoPublish({ Makefile: mutated });
      });
    },
  );

  it("BR-178 v2 scans ops/runner and the runner workflow and admits the runner base and probe", () => {
    const scope = publishScope();
    for (const path of [
      "ops/runner/Dockerfile",
      "ops/runner/probe.sh",
      "ops/runner/supervise.sh",
      "ops/runner/install.sh",
      ".github/workflows/runner-acceptance.yml",
    ])
      expect(Object.keys(scope)).toContain(path);
    expect(() => {
      validateNoPublish(scope);
    }).not.toThrow();
  });

  const runnerScope = () => {
    const scope = publishScope();
    return Object.fromEntries(
      Object.entries(scope).filter(([path]) => path.startsWith("ops/runner/")),
    );
  };
  const runnerMutations: Record<
    string,
    (scope: Record<string, string>) => void
  > = {
    "tag-only FROM": (scope) => {
      scope["ops/runner/Dockerfile"] = (
        scope["ops/runner/Dockerfile"] ?? ""
      ).replace(/@sha256:[0-9a-f]{64}/u, "");
    },
    "second FROM": (scope) => {
      const text = scope["ops/runner/Dockerfile"] ?? "";
      const from = text.split("\n").find((line) => line.startsWith("FROM "));
      scope["ops/runner/Dockerfile"] = `${text}\n${from ?? ""}\n`;
    },
    "second ghcr.io string in probe.sh": (scope) => {
      scope["ops/runner/probe.sh"] =
        `${scope["ops/runner/probe.sh"] ?? ""}\n# https://ghcr.io/v2/\n`;
    },
    "different ghcr.io string in probe.sh": (scope) => {
      scope["ops/runner/probe.sh"] = (
        scope["ops/runner/probe.sh"] ?? ""
      ).replace("https://ghcr.io/v2/", "https://ghcr.io/v2/actions/");
    },
    "ghcr.io in another ops file": (scope) => {
      scope["ops/runner/provision.sh"] =
        `${scope["ops/runner/provision.sh"] ?? ""}\n# ghcr.io/x/y\n`;
    },
    "docker login in an ops file": (scope) => {
      scope["ops/runner/supervise.sh"] =
        `${scope["ops/runner/supervise.sh"] ?? ""}\ndocker login\n`;
    },
    "--push in an ops file": (scope) => {
      scope["ops/runner/provision.sh"] =
        `${scope["ops/runner/provision.sh"] ?? ""}\ndocker build --push .\n`;
    },
  };
  it.each(Object.keys(runnerMutations))(
    "BR-178 v2 rejects runner mutation: %s",
    (name) => {
      const scope = runnerScope();
      const before = JSON.stringify(scope);
      runnerMutations[name]?.(scope);
      expect(JSON.stringify(scope)).not.toBe(before);
      rejects(() => {
        validateNoPublish(scope);
      });
    },
  );

  it("BR-178 rejects a ghcr.io reference in the Dockerfile", () => {
    rejects(() => {
      validateNoPublish({
        Dockerfile: dockerfile.replace(
          "node:26.13.0-bookworm-slim",
          "ghcr.io/x/node",
        ),
      });
    });
  });

  it.each(["runs/", "secrets/", "*.pem", ".git"])(
    "BR-179 rejects a .dockerignore without %s",
    (entry) => {
      const mutated = dockerignore
        .split("\n")
        .filter((line) => line.trim() !== entry)
        .join("\n");
      rejects(() => {
        validateDockerignore(mutated);
      });
    },
  );
});

describe("F-013 Make image recipes against a stub docker", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function fixture(arch: string, inspected: string) {
    root = mkdtempSync(join(tmpdir(), "kdrive-image-make-"));
    copyFileSync("Makefile", join(root, "Makefile"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const docker = join(bin, "docker");
    writeFileSync(
      docker,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$FAKE_LOG"',
        'case "$1 $2" in "image inspect") printf "%s\\n" "$FAKE_PLATFORM" ;; esac',
        "",
      ].join("\n"),
    );
    chmodSync(docker, 0o755);
    const uname = join(bin, "uname");
    writeFileSync(uname, `#!/bin/sh\nprintf '%s\\n' ${arch}\n`);
    chmodSync(uname, 0o755);
    const log = join(root, "calls");
    const run = (target: string, platforms: string) =>
      spawnSync(
        "/usr/bin/make",
        [target, `DOCKER=${docker}`, `IMAGE_PLATFORMS=${platforms}`],
        {
          cwd: root,
          env: {
            PATH: `${bin}:/usr/bin:/bin`,
            FAKE_LOG: log,
            FAKE_PLATFORM: inspected,
          },
          encoding: "utf8",
        },
      );
    const calls = () => {
      try {
        return readFileSync(log, "utf8");
      } catch {
        return "";
      }
    };
    return { run, calls };
  }

  it("BR-177 builds runtime and smoke with --load and checks the loaded platform", () => {
    const { run, calls } = fixture("x86_64", "linux/amd64");
    const result = run("image", "linux/amd64");
    expect(result.status, result.stderr).toBe(0);
    const lines = calls().trim().split("\n");
    expect(lines).toEqual([
      "buildx version",
      "buildx build --platform linux/amd64 --target runtime --load --tag kdrive-mcp-server:runtime-amd64 .",
      "image inspect --format {{.Os}}/{{.Architecture}} kdrive-mcp-server:runtime-amd64",
      "buildx build --platform linux/amd64 --target smoke --load --tag kdrive-mcp-server:smoke-amd64 .",
      "image inspect --format {{.Os}}/{{.Architecture}} kdrive-mcp-server:smoke-amd64",
    ]);
  });

  it("BR-177 fails naming the tag when the loaded platform differs", () => {
    const { run } = fixture("x86_64", "linux/arm64");
    const result = run("image", "linux/amd64");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("kdrive-mcp-server:runtime-amd64");
  });

  it("BR-188 registers arm64 binfmt on a non-arm64 host when arm64 is requested", () => {
    const { run, calls } = fixture("x86_64", "");
    const result = run("image-binfmt", "linux/arm64");
    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toMatch(
      /^run --rm --privileged tonistiigi\/binfmt@sha256:[0-9a-f]{64} --install arm64\n$/u,
    );
  });

  it.each([
    ["x86_64", "linux/amd64"],
    ["aarch64", "linux/arm64"],
    ["arm64", "linux/amd64 linux/arm64"],
  ])(
    "BR-188 skips binfmt with one line on host %s for %s",
    (arch, platforms) => {
      const { run, calls } = fixture(arch, "");
      const result = run("image-binfmt", platforms);
      expect(result.status, result.stderr).toBe(0);
      expect(calls()).toBe("");
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
    },
  );
});

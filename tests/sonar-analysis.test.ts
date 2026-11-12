import { describe, expect, it } from "vitest";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
  access,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  runAnalysis,
  verifyMain,
  verifyProperties,
  verifyTaskMetadata,
  verifyAnalysedSet,
  type AnalysisOptions,
} from "../scripts/sonar.js";
import {
  inspectMain,
  inspectPullRequest,
  prepareSnapshot,
} from "../scripts/sonar-snapshot.js";
import { withinDeadline } from "../scripts/deadline.js";
import { command } from "../scripts/coverage.js";

const sentinel = "SYNTHETIC_TEST_TOKEN_NOT_A_CREDENTIAL";
const sha = "a".repeat(40);
const metadata =
  "projectKey=kdrive-mcp-server\nserverUrl=https://sonar.example.test\nceTaskId=fixture-task\nceTaskUrl=https://sonar.example.test/api/ce/task?id=fixture-task\n";
const host = {
  url: "https://sonar.example.test",
  hostname: "sonar.example.test",
};
function fixture() {
  const logs: string[] = [];
  let uploads = 0;
  const options: AnalysisOptions = {
    token: sentinel,
    enabled: "true",
    host,
    mode: "main",
    snapshot: {
      branch: "main",
      commit: sha,
      trustedMain: sha,
      clean: true,
      repository: "https://github.com/sstolz/kdrive-mcp-server.git",
      event: "local",
    },
    verifySnapshot: () => Promise.resolve(),
    scan: () => {
      uploads++;
      return Promise.resolve({ code: 0, metadata });
    },
    log: (line) => logs.push(line),
    timeoutMs: 100,
  };
  return { options, logs, uploads: () => uploads };
}
async function repository(
  origin = "https://github.com/sstolz/kdrive-mcp-server.git",
) {
  const root = await mkdtemp(join(tmpdir(), "sonar-main-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Synthetic Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", origin);
  await writeFile(join(root, "source.txt"), "synthetic fixture\n");
  const commit = () => {
    git("add", ".");
    git("commit", "-m", "synthetic fixture");
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  };
  return { root, git, commit };
}
async function snapshotRepository(
  build = "node --version",
  test = 'import { it, expect } from "vitest"; import { value } from "../src/example"; it("fixture", () => { expect(value).toBe(1); });\n',
) {
  const fixture = await repository();
  const { root } = fixture;
  for (const dir of ["src", "tests", "scripts"]) await mkdir(join(root, dir));
  for (const file of [
    "coverage.ts",
    "sonar.ts",
    "sonar-snapshot.ts",
    "deadline.ts",
  ])
    await copyFile(resolve("scripts", file), join(root, "scripts", file));
  await symlink(resolve("node_modules"), join(root, "node_modules"));
  await writeFile(
    join(root, ".gitignore"),
    "node_modules/\nartifacts/\ncoverage/\n",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ type: "module", scripts: { build } }),
  );
  await writeFile(join(root, "package-lock.json"), "{}\n");
  await mkdir(join(root, ".config"));
  await writeFile(join(root, ".config/settings.json"), '{"synthetic":true}\n');
  await writeFile(join(root, "src/example.ts"), "export const value = 1;\n");
  await writeFile(join(root, "tests/example.test.ts"), test);
  await writeFile(
    join(root, "vitest.config.ts"),
    'export default { test: { coverage: { provider: "v8", include: ["src/**/*.ts"], reporter: ["lcov"] } } };\n',
  );
  fixture.commit();
  return fixture;
}

describe("BR-014 main provenance, immutable coverage and bounded official analysis", () => {
  it("prepares fresh coverage from committed main, binds run/source/LCOV and freezes inputs", async () => {
    const { root, git } = await snapshotRepository();
    const destination = await prepareSnapshot(root, { SONAR_ENABLED: "true" });
    expect(await realpath(join(root, "artifacts/sonar-input/current"))).toBe(
      destination,
    );
    expect((await stat(join(destination, "src/example.ts"))).mode & 0o222).toBe(
      0,
    );
    const manifest = JSON.parse(
      await readFile(join(destination, "analysis-snapshot.json"), "utf8"),
    ) as { commit: string; runId: string; startedAt: number };
    const coverage = JSON.parse(
      await readFile(join(destination, "coverage/success.json"), "utf8"),
    ) as {
      status: string;
      runId: string;
      lcov: string;
      inputs: Record<string, string>;
    };
    expect(manifest.commit).toBe(git("rev-parse", "HEAD"));
    expect(coverage.status).toBe("success");
    expect(coverage.runId).toBe(manifest.runId);
    expect(coverage.lcov).toMatch(/^[a-f0-9]{64}$/);
    expect(coverage.inputs["src/example.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await readFile(join(destination, ".config/settings.json"), "utf8"),
    ).toBe('{"synthetic":true}\n');
    await writeFile(join(root, "src/example.ts"), "changed after snapshot\n");
    expect(await readFile(join(destination, "src/example.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  });
  it("rejects the exact tracked supported credential path before exporting its content", async () => {
    const f = await repository();
    await mkdir(join(f.root, ".config"));
    await writeFile(join(f.root, ".config/qube-token"), "SYNTHETIC_ONLY");
    f.commit();
    await expect(
      prepareSnapshot(f.root, { SONAR_ENABLED: "true" }),
    ).rejects.toThrow("Tracked supported credential path");
    await expect(
      access(join(f.root, "artifacts/sonar-input/current")),
    ).rejects.toThrow();
  });
  it.each([
    "https://github.com/sstolz/kdrive-mcp-server.git",
    "https://github.com/sstolz/kdrive-mcp-server",
  ])("derives clean main for canonical origin %s", async (origin) => {
    const { root, git, commit } = await repository(origin);
    commit();
    expect((await inspectMain(root, {})).commit).toBe(git("rev-parse", "HEAD"));
    for (const event of ["push", "workflow_dispatch"])
      expect(
        (
          await inspectMain(root, {
            GITHUB_ACTIONS: "true",
            GITHUB_EVENT_NAME: event,
            GITHUB_REF: "refs/heads/main",
            GITHUB_SHA: git("rev-parse", "HEAD"),
            GITHUB_REPOSITORY: "sstolz/kdrive-mcp-server",
          })
        ).repository,
      ).toBe(origin);
    for (const event of ["pull_request", "pull_request_target"])
      await expect(
        inspectMain(root, { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: event }),
      ).rejects.toThrow();
    await writeFile(join(root, "source.txt"), "dirty\n");
    await expect(inspectMain(root, {})).rejects.toThrow();
    git("checkout", "--", "source.txt");
    git("switch", "-c", "feature/fixture");
    await expect(inspectMain(root, {})).rejects.toThrow();
  });
  it.each([
    "http://github.com/sstolz/kdrive-mcp-server",
    "https://github.com.evil.invalid/sstolz/kdrive-mcp-server",
    "https://github.com@evil.invalid/sstolz/kdrive-mcp-server",
    "https://user@github.com/sstolz/kdrive-mcp-server",
    "https://user:synthetic@github.com/sstolz/kdrive-mcp-server",
    "https://github.com/fork/kdrive-mcp-server",
    "https://github.com/sstolz/kdrive-mcp-server-evil",
    "https://github.com/sstolz/kdrive-mcp-server.git.evil",
    "https://github.com/sstolz/kdrive-mcp-server/extra",
    "https://github.com/sstolz/kdrive-mcp-server?redirect=other",
    "https://github.com/sstolz/kdrive-mcp-server.git#main",
    "https://github.com/sstolz/kdrive-mcp-server/",
    "https://github.com:443/sstolz/kdrive-mcp-server",
    "https://github.com/sstolz/kdrive-mcp-server%2egit",
  ])("rejects noncanonical repository %s before upload", async (repository) => {
    const f = fixture();
    f.options.snapshot.repository = repository;
    expect(() => {
      verifyMain(f.options.snapshot);
    }).toThrow();
    expect(await runAnalysis(f.options)).not.toBe(0);
    expect(f.uploads()).toBe(0);
  });
  it.each([
    { branch: "feature/work" },
    { clean: false },
    { commit: "b".repeat(40) },
    { event: "pull_request" },
    { event: "pull_request_target" },
  ])("rejects untrusted provenance %j", async (change) => {
    const f = fixture();
    Object.assign(f.options.snapshot, change);
    expect(await runAnalysis(f.options)).not.toBe(0);
    expect(f.uploads()).toBe(0);
  });
  it.each(["token", "enabled"] as const)(
    "rejects missing %s before upload",
    async (field) => {
      const f = fixture();
      delete f.options[field];
      expect(await runAnalysis(f.options)).not.toBe(0);
      expect(f.uploads()).toBe(0);
    },
  );
  it("rejects changed or stale coverage before upload", async () => {
    const f = fixture();
    f.options.verifySnapshot = () =>
      Promise.reject(new Error("source changed"));
    expect(await runAnalysis(f.options)).not.toBe(0);
    expect(f.uploads()).toBe(0);
  });
  it.each([
    "",
    metadata.replace("kdrive-mcp-server", "other"),
    metadata.replace("sonar.example.test", "other.invalid"),
    metadata.replace("ceTaskId=fixture-task", "ceTaskId="),
    metadata + "projectKey=other\n",
  ])("rejects missing or wrong official task metadata %s", async (metadata) => {
    const f = fixture();
    f.options.scan = () => Promise.resolve({ code: 0, metadata });
    expect(await runAnalysis(f.options)).not.toBe(0);
  });
  it("accepts realistic official metadata with no fabricated SHA/gate fields", () => {
    expect(verifyTaskMetadata(metadata, "main", host)).toBe("fixture-task");
  });
  it.each([2, 3, 42, 137])(
    "preserves failed scanner/gate/network/signal exit %s",
    async (code) => {
      const f = fixture();
      f.options.scan = () => Promise.resolve({ code, metadata });
      expect(await runAnalysis(f.options)).toBe(code);
    },
  );
  it("bounds preparation and scanner hangs and aborts them", async () => {
    for (const stage of ["verifySnapshot", "scan"] as const) {
      const f = fixture();
      let aborted = false;
      f.options[stage] = (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("timeout"));
          });
        });
      expect(await runAnalysis(f.options)).not.toBe(0);
      expect(aborted).toBe(true);
      if (stage === "verifySnapshot") expect(f.uploads()).toBe(0);
    }
  });
  it("uses one deadline across stages and kills an owned subprocess group", async () => {
    const root = await mkdtemp(join(tmpdir(), "deadline-"));
    const pidFile = join(root, "pid");
    const started = Date.now();
    await expect(
      withinDeadline(150, async (signal) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        await command(
          process.execPath,
          [
            "-e",
            `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`,
          ],
          root,
          signal,
        );
        throw new Error("must not reach later upload");
      }),
    ).rejects.toThrow("deadline");
    expect(Date.now() - started).toBeLessThan(1000);
    const pid = Number(await readFile(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it.each(["build", "coverage"])(
    "terminates a real %s hang without publishing a reusable snapshot",
    async (stage) => {
      const f = await snapshotRepository(
        stage === "build"
          ? 'node -e "setInterval(()=>{},1000)"'
          : "node --version",
        stage === "coverage"
          ? 'import {it} from "vitest"; it("hang", () => new Promise(() => {}), 60000);'
          : undefined,
      );
      const startedAt = Date.now();
      await expect(
        prepareSnapshot(f.root, { SONAR_ENABLED: "true" }, startedAt, 350),
      ).rejects.toThrow("deadline");
      expect(Date.now() - startedAt).toBeLessThan(1500);
      await expect(
        access(join(f.root, "artifacts/sonar-input/current")),
      ).rejects.toThrow();
    },
  );
  it("accepts only reviewed target, LCOV and gate properties, forbidding branch/debug/token injection", async () => {
    const text = await readFile("sonar-project.properties", "utf8");
    expect(() => {
      verifyProperties(text);
    }).not.toThrow();
    for (const changed of [
      text.replace("kdrive-mcp-server", "other"),
      text.replace("wait=true", "wait=false"),
      text.replace("timeout=300", "timeout=999"),
      text + "sonar.branch.name=feature\n",
      text + "sonar.pullrequest.key=28\n",
      text + "sonar.token=synthetic\n",
      text + "sonar.verbose=true\n",
      text + "sonar.host.url=https://sonar.example.test\n",
    ])
      expect(() => {
        verifyProperties(changed);
      }).toThrow();
  });
});

function pullRequestEnv(sha: string): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "sstolz/kdrive-mcp-server",
    SONAR_PR_HEAD_REPOSITORY: "sstolz/kdrive-mcp-server",
    GITHUB_BASE_REF: "main",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_SHA: sha,
  };
}

describe("BR-147 no Sonar host in the analysed set", () => {
  async function analysed(files: Record<string, string>) {
    const root = await mkdtemp(join(tmpdir(), "analysed-set-"));
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    }
    return root;
  }
  const base = {
    "sonar-project.properties": "sonar.projectKey=kdrive-mcp-server\n",
    "src/x.ts": "export const x = 1;\n",
    "tests/x.test.ts": "export {};\n",
  };
  it.each(["src/x.ts", "tests/x.test.ts", "sonar-project.properties"])(
    "BR-147 fails on the host in the analysed set (%s)",
    async (path) => {
      const root = await analysed({
        ...base,
        [path]: "// see HTTPS://SONAR.EXAMPLE.TEST/dashboard\n",
      });
      const error = await verifyAnalysedSet(root, host.hostname).catch(
        (caught: unknown) => caught,
      );
      expect((error as Error).message).toBe(
        "Analysed sources contain the configured analysis host",
      );
    },
  );
  it("BR-147 ignores records outside the analysed set", async () => {
    const root = await analysed({
      ...base,
      "runs/x.md": "https://sonar.example.test\n",
      "architecture-decisions/ADR-x.md": "sonar.example.test\n",
    });
    await expect(verifyAnalysedSet(root, host.hostname)).resolves.toBe(
      undefined,
    );
  });
  it("BR-147 rejects host, inclusion and exclusion properties", async () => {
    const text = await readFile("sonar-project.properties", "utf8");
    expect(text).not.toContain("sonar.host.url");
    expect(text).toContain("sonar.projectKey=kdrive-mcp-server\n");
    expect(() => {
      verifyProperties(text);
    }).not.toThrow();
    for (const changed of [
      text + "sonar.host.url=https://sonar.example.test\n",
      text + "sonar.exclusions=src/**\n",
      text + "sonar.inclusions=src/**\n",
      text + "sonar.test.exclusions=tests/**\n",
      text.replace("sonar.sources=src", "sonar.sources=src,runs"),
    ])
      expect(() => {
        verifyProperties(changed);
      }).toThrow();
  });
  it("BR-147 scripts/sonar.ts names no https host other than github.com", async () => {
    const source = await readFile("scripts/sonar.ts", "utf8");
    const hosts = [...source.matchAll(/https:\/\/([^/"'`\s]+)/gu)].map(
      (match) => match[1],
    );
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set(["github.com"]));
  });
});

describe("BR-148 same-repository pull request provenance", () => {
  it("BR-148 accepts the trusted same-repository merge commit", async () => {
    const { root, git, commit } = await repository();
    commit();
    const sha = git("rev-parse", "HEAD");
    const snapshot = await inspectPullRequest(root, pullRequestEnv(sha));
    expect(snapshot).toMatchObject({
      commit: sha,
      event: "pull_request",
      ref: "refs/pull/7/merge",
      headRepository: "sstolz/kdrive-mcp-server",
      baseRef: "main",
    });
  });
  it.each([
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { SONAR_PR_HEAD_REPOSITORY: "fork/kdrive-mcp-server" },
    { SONAR_PR_HEAD_REPOSITORY: "" },
    { GITHUB_BASE_REF: "develop" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_SHA: "b".repeat(40) },
    { GITHUB_ACTIONS: undefined },
    { dirty: true },
  ])("BR-148 rejects untrusted PR provenance %j", async (change) => {
    const { root, git, commit } = await repository();
    commit();
    const env = { ...pullRequestEnv(git("rev-parse", "HEAD")) };
    for (const [key, value] of Object.entries(change)) {
      if (key === "dirty") await writeFile(join(root, "source.txt"), "dirty\n");
      else if (value === undefined) delete env[key];
      else env[key] = value as string;
    }
    // BR-146 (AC-05): snapshot rejections never contain a synthetic host.
    env.SONAR_HOST_URL = "https://sonar.example.test";
    const failures = [
      await inspectPullRequest(root, env).catch((error: unknown) => error),
      await prepareSnapshot(root, {
        ...env,
        SONAR_ENABLED: "true",
        SONAR_ANALYSIS_MODE: "pr",
      }).catch((error: unknown) => error),
    ];
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message.toLowerCase()).not.toContain(
        "sonar.example.test",
      );
    }
    await expect(
      access(join(root, "artifacts/sonar-input/current")),
    ).rejects.toThrow();
  });
  it("BR-014 v2 main mode rejects pull_request", async () => {
    const f = fixture();
    f.options.snapshot.event = "pull_request";
    expect(await runAnalysis(f.options)).toBe(1);
    expect(f.uploads()).toBe(0);
    const { root, git, commit } = await repository();
    commit();
    await expect(
      inspectMain(root, pullRequestEnv(git("rev-parse", "HEAD"))),
    ).rejects.toThrow();
  });
});

describe("BR-012 v2 PR snapshot coverage", () => {
  it("BR-012 v2 binds fresh coverage to the PR merge commit", async () => {
    const { root, git } = await snapshotRepository();
    const sha = git("rev-parse", "HEAD");
    const destination = await prepareSnapshot(root, {
      ...pullRequestEnv(sha),
      SONAR_ENABLED: "true",
      SONAR_ANALYSIS_MODE: "pr",
    });
    const manifest = JSON.parse(
      await readFile(join(destination, "analysis-snapshot.json"), "utf8"),
    ) as { commit: string; runId: string; event: string; ref: string };
    expect(manifest).toMatchObject({
      commit: sha,
      event: "pull_request",
      ref: "refs/pull/7/merge",
    });
    const coverage = JSON.parse(
      await readFile(join(destination, "coverage/success.json"), "utf8"),
    ) as { status: string; runId: string; inputs: Record<string, string> };
    expect(coverage.status).toBe("success");
    expect(coverage.runId).toBe(manifest.runId);
    expect(coverage.inputs["src/example.ts"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(coverage.inputs["package-lock.json"]).toMatch(/^[a-f0-9]{64}$/u);
  });
});

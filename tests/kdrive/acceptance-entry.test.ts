// F-014 AC-21 (BR-211, BR-212, BR-215 entry checks): the owner-run kDrive
// targets refuse an invalid KDRIVE_ACCEPTANCE_DIR, and kdrive-acceptance a
// dirty worktree or a HEAD other than origin/main, before any Docker command.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SET_VARIABLE =
  "Set KDRIVE_ACCEPTANCE_DIR to an absolute directory outside the checkout.";
const UNAVAILABLE = "The kDrive acceptance directory is unavailable.";
const INSIDE = "The kDrive acceptance directory is inside the dev checkout.";
const FILE_UNAVAILABLE = "A kDrive acceptance file is unavailable.";
const OTHER_ENTRIES = "The kDrive acceptance directory holds other entries.";
const DIRTY = "kdrive-acceptance requires a clean worktree.";
const NOT_MAIN = "kdrive-acceptance requires HEAD to equal origin/main.";
const ENTRY = "scripts/kdrive-entry.sh";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kdrive-entry-"));
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
  writeFileSync(join(root, ".gitignore"), "bin/\ncalls\n");
  const docker = join(root, "bin/docker");
  mkdirSync(join(root, "bin"));
  writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n');
  chmodSync(docker, 0o755);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const outside = mkdtempSync(join(tmpdir(), "kdrive-entry-outside-"));
  const dir = join(outside, "acceptance");
  mkdirSync(dir);
  writeFileSync(join(dir, "kdrive-token"), "SYNTHETIC_TOKEN\n");
  writeFileSync(join(dir, "fixtures.json"), "{}\n");
  return { root, outside, dir, docker, log: join(root, "calls"), git };
}
type Fixture = ReturnType<typeof fixture>;
function run(f: Fixture, target: string, selected: string | undefined) {
  return spawnSync("make", [target, `DOCKER=${f.docker}`], {
    cwd: f.root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      FAKE_LOG: f.log,
      ...(selected === undefined ? {} : { KDRIVE_ACCEPTANCE_DIR: selected }),
    },
  });
}
const calls = (f: Fixture) =>
  existsSync(f.log) ? readFileSync(f.log, "utf8") : "";

const invalid: [string, string, (f: Fixture) => string | undefined][] = [
  ["unset", SET_VARIABLE, () => undefined],
  ["relative", SET_VARIABLE, () => "acceptance"],
  ["containing a colon", SET_VARIABLE, (f) => `${f.dir}:x`],
  ["with a dot-dot component", SET_VARIABLE, (f) => `${f.dir}/../acceptance`],
  [
    "a symlink",
    UNAVAILABLE,
    (f) => {
      symlinkSync(f.dir, join(f.outside, "alias"));
      return join(f.outside, "alias");
    },
  ],
  ["missing", UNAVAILABLE, (f) => join(f.outside, "missing")],
  [
    "unreadable",
    UNAVAILABLE,
    (f) => {
      chmodSync(f.dir, 0o300);
      return f.dir;
    },
  ],
  [
    "inside the checkout",
    INSIDE,
    (f) => {
      mkdirSync(join(f.root, "held"));
      copyFileSync(
        join(f.dir, "kdrive-token"),
        join(f.root, "held/kdrive-token"),
      );
      return join(f.root, "held");
    },
  ],
  ["an ancestor of the checkout", INSIDE, (f) => dirname(f.root)],
  [
    "missing token",
    FILE_UNAVAILABLE,
    (f) => {
      execFileSync("rm", [join(f.dir, "kdrive-token")]);
      return f.dir;
    },
  ],
  [
    "token symlink",
    FILE_UNAVAILABLE,
    (f) => {
      execFileSync("rm", [join(f.dir, "kdrive-token")]);
      symlinkSync(join(f.outside, "x"), join(f.dir, "kdrive-token"));
      return f.dir;
    },
  ],
  [
    "extra entry",
    OTHER_ENTRIES,
    (f) => {
      writeFileSync(join(f.dir, "notes"), "x");
      return f.dir;
    },
  ],
  [
    "hidden extra entry",
    OTHER_ENTRIES,
    (f) => {
      writeFileSync(join(f.dir, ".env"), "x");
      return f.dir;
    },
  ],
];

describe("BR-212 owner-run entry checks", () => {
  for (const target of ["kdrive-record", "kdrive-acceptance"])
    it.each(invalid)(
      `TestBR212_${target}_refuses_a_directory_%s_before_any_Docker_command`,
      (_name, message, setup) => {
        const f = fixture();
        const result = run(f, target, setup(f));
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(message);
        expect(calls(f)).toBe("");
      },
    );

  it("TestBR212_record_mounts_the_directory_read_only_and_passes_only_the_token_file", () => {
    const f = fixture();
    const result = run(f, "kdrive-record", f.dir);
    expect(result.status).toBe(0);
    const log = calls(f);
    expect(log).toContain(`--volume ${f.dir}:/run/kdrive-acceptance:ro`);
    expect(log).toContain(
      "-e KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token",
    );
    expect(log).toContain("dev node scripts/kdrive-record.ts");
    expect(log).not.toContain("SYNTHETIC_TOKEN");
  });

  it("TestBR215_acceptance_refuses_a_dirty_worktree_before_any_Docker_command", () => {
    const f = fixture();
    writeFileSync(join(f.root, "Dockerfile.dev"), "changed\n");
    const result = run(f, "kdrive-acceptance", f.dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(DIRTY);
    expect(calls(f)).toBe("");
  });

  it("TestBR215_acceptance_refuses_HEAD_other_than_origin_main", () => {
    const f = fixture();
    f.git("commit", "-q", "--allow-empty", "-m", "ahead");
    const result = run(f, "kdrive-acceptance", f.dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(NOT_MAIN);
    expect(calls(f)).toBe("");
  });

  it("TestBR215_acceptance_on_actual_main_runs_the_acceptance_script", () => {
    const f = fixture();
    const result = run(f, "kdrive-acceptance", f.dir);
    expect(result.status).toBe(0);
    const log = calls(f);
    expect(log).toContain(`--volume ${f.dir}:/run/kdrive-acceptance:ro`);
    expect(log).toContain("dev node scripts/kdrive-acceptance.ts");
    expect(log).toMatch(/KDRIVE_ACCEPTANCE_SHA=[0-9a-f]{40}/u);
  });
});

describe("BR-215 v2 acceptance summary", () => {
  it("TestBR215_summary_holds_the_request_and_invocation_maxima_and_no_planted_value", async () => {
    const { formatReport } = await import("../../scripts/kdrive-acceptance.ts");
    const planted = {
      id: "987654321",
      name: "planted-secret-name",
      cursor: "planted-cursor-value",
      url: "https://planted.example/leak",
    };
    const leak = `${planted.url}/${planted.id}/${planted.name}?cursor=${planted.cursor}`;
    const text = formatReport({
      sha: "0123456789abcdef0123456789abcdef01234567",
      total: 7,
      counts: new Map([
        ["/3/drive/{d}/files/{f}/files", 4],
        ["/3/drive/files/shared_with_me", 2],
        [leak, 1],
      ]),
      maxRequestMs: new Map([
        ["/3/drive/{d}/files/{f}/files", 1_879.4],
        ["/3/drive/files/shared_with_me", 640],
        [leak, 4_000],
      ]),
      maxInvocationMs: 9_400.2,
      bytes: 16,
      ms: 120_000,
      checks: [
        Object.assign(
          { check: "AC-23 run A", pass: true, ms: 10 },
          { detail: leak },
        ),
      ],
    });
    const report = JSON.parse(text) as {
      maxRequestMs: Record<string, number>;
      maxInvocationMs: number;
      byTemplate: Record<string, number>;
    };
    expect(report.maxRequestMs).toEqual({
      "/3/drive/{d}/files/{f}/files": 1_879,
      "/3/drive/files/shared_with_me": 640,
    });
    expect(report.maxInvocationMs).toBe(9_400);
    expect(report.byTemplate).toEqual({
      "/3/drive/{d}/files/{f}/files": 4,
      "/3/drive/files/shared_with_me": 2,
    });
    for (const value of Object.values(planted))
      expect(text).not.toContain(value);
    expect(text).not.toContain("planted");
  });

  it("TestBR215_any_REQUEST_TIMEOUT_fails_the_check", async () => {
    const { timedOut } = await import("../../scripts/kdrive-acceptance.ts");
    expect(timedOut({ error: "REQUEST_TIMEOUT" })).toBe(true);
    expect(timedOut({ error: "ACCESS_DENIED" })).toBe(false);
    expect(timedOut({ ok: {} })).toBe(false);
  });
});

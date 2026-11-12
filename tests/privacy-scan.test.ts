// F-023 BR-341–BR-352: the secret-fed privacy scan, on synthetic patterns and
// temporary Git repositories only. No network.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parsePatterns } from "../scripts/privacy-scan.js";

const SCRIPT = join(process.cwd(), "scripts/privacy-scan.ts");
const TOKEN = "synthetic-deny-1234";
const PATTERN_1 = "synthetic-deny-[0-9]{4}";
const PATTERN_2 = "synthetic deny [0-9]{4}";
const PATTERNS = `${PATTERN_1}\n${PATTERN_2}\n`;
const ZEROS = "0".repeat(40);
const IDENTITY = {
  GIT_AUTHOR_NAME: "Synthetic Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Synthetic Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

const roots: string[] = [];
function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const HOME = temporary("privacy-scan-home-");

function baseEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: tmpdir(),
  };
}

interface Fixture {
  root: string;
  git: (args: string[], env?: Record<string, string>) => string;
  write: (path: string, content: string | Buffer) => void;
  commit: (message: string, env?: Record<string, string>) => string;
}
function repository(): Fixture {
  const root = temporary("privacy-scan-repo-");
  const git = (args: string[], env: Record<string, string> = {}) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...baseEnv(), ...IDENTITY, ...env },
    }).trim();
  git(["init", "-q", "--initial-branch=main"]);
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = (message: string, env: Record<string, string> = {}) => {
    git(["add", "-A"]);
    git(["commit", "-q", "--allow-empty", "-m", message], env);
    return git(["rev-parse", "HEAD"]);
  };
  return { root, git, write, commit };
}

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}
function scan(cwd: string, env: Record<string, string | undefined>): Result {
  const clean: Record<string, string> = baseEnv();
  for (const [key, value] of Object.entries(env))
    if (value !== undefined) clean[key] = value;
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: clean,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
function scanAt(
  fixture: Fixture,
  base: string,
  head: string,
  extra: Record<string, string> = {},
): Result {
  return scan(fixture.root, {
    PRIVACY_DENY_PATTERNS: PATTERNS,
    PRIVACY_EVENT: "push",
    PRIVACY_RANGE_BASE: base,
    PRIVACY_RANGE_HEAD: head,
    ...extra,
  });
}
function hits(result: Result): string[] {
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("privacy-scan: hit "));
}
function lastLine(result: Result): string {
  return result.stdout.trimEnd().split("\n").at(-1) ?? "";
}
function expectNoLeak(result: Result): void {
  const output = `${result.stdout}${result.stderr}`;
  for (const text of ["synthetic", "deny", PATTERN_1, PATTERN_2])
    expect(output).not.toContain(text);
}
function utf16le(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, "utf16le"),
  ]);
}
function utf16be(text: string): Buffer {
  const little = Buffer.from(text, "utf16le");
  const big = Buffer.alloc(little.length);
  for (let index = 0; index + 1 < little.length; index += 2) {
    big[index] = little[index + 1] ?? 0;
    big[index + 1] = little[index] ?? 0;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), big]);
}

describe("BR-343 secret parsing", () => {
  it("BR-343 parses comments, blank lines and CRLF into patterns numbered by physical line", () => {
    const secret = `# synthetic comment\r\n\r\n  ${PATTERN_1}  \r\n   # indented comment\r\n${PATTERN_2}\r\n\r\n`;
    const patterns = parsePatterns(secret);
    expect(patterns.map((pattern) => pattern.line)).toEqual([3, 5]);
    expect(patterns.map((pattern) => pattern.regex.source)).toEqual([
      PATTERN_1,
      PATTERN_2,
    ]);
    for (const pattern of patterns) expect(pattern.regex.flags).toBe("giu");
  });
});

describe("BR-344 fails closed", () => {
  const cwd = temporary("privacy-scan-empty-");
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["comments only", "# synthetic comment\n\n   \n# another\n"],
  ])("BR-344 exits 2 when the secret is %s", (_name, secret) => {
    const result = scan(cwd, { PRIVACY_DENY_PATTERNS: secret });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("privacy-scan: no pattern is configured\n");
    expectNoLeak(result);
  });
  it("BR-344 exits 2 naming only the line of an invalid regex", () => {
    const result = scan(cwd, {
      PRIVACY_DENY_PATTERNS: `${PATTERN_1}\nsynthetic-(deny\n`,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "privacy-scan: pattern 2 is not a valid regex\n",
    );
    expectNoLeak(result);
  });
});

describe("BR-345 tracked entries", () => {
  it("BR-345 seeded rehearsal reports four hits by location and pattern number only", () => {
    const fixture = repository();
    fixture.write(
      "notes.txt",
      [
        "clean line",
        TOKEN,
        "clean",
        "synthetic%2Ddeny%2D1234",
        "synthetic&#45;deny&#45;1234",
        "synthetic deny",
        "1234",
        "",
      ].join("\n"),
    );
    const head = fixture.commit("seed");
    const result = scanAt(fixture, head, head);
    expect(hits(result)).toEqual([
      "privacy-scan: hit notes.txt:2 pattern 1",
      "privacy-scan: hit notes.txt:4 pattern 1",
      "privacy-scan: hit notes.txt:5 pattern 1",
      "privacy-scan: hit notes.txt:6 pattern 2",
    ]);
    expect(lastLine(result)).toBe(
      "privacy-scan: 4 hits, 1 files, 0 binary skipped, 0 gitlinks skipped, 0 commits, 2 patterns",
    );
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(5);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(1);
    expectNoLeak(result);
  });

  it("BR-345 binary blobs (NUL byte, invalid UTF-8) are skipped and counted", () => {
    const fixture = repository();
    fixture.write("nul.bin", `${TOKEN}\u0000tail\n`);
    fixture.write(
      "latin.txt",
      Buffer.concat([Buffer.from(`${TOKEN} `), Buffer.from([0xc3, 0x28])]),
    );
    const head = fixture.commit("binary");
    const result = scanAt(fixture, head, head);
    expect(hits(result)).toEqual([]);
    expect(lastLine(result)).toBe(
      "privacy-scan: 0 hits, 2 files, 2 binary skipped, 0 gitlinks skipped, 0 commits, 2 patterns",
    );
    expect(result.status).toBe(0);
    expectNoLeak(result);
  });

  it("BR-345 decoders read UTF-16 LE and BE with BOM, hexadecimal entities and a UTF-8 BOM", () => {
    const fixture = repository();
    fixture.write("a-le.txt", utf16le(`clean\n${TOKEN}\n`));
    fixture.write("b-be.txt", utf16be(`clean\nclean\n${TOKEN}\n`));
    fixture.write("c-hex.txt", "one\ntwo\nsynthetic&#x2d;deny&#X2D;1234\n");
    fixture.write(
      "d-bom.txt",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TOKEN)]),
    );
    const head = fixture.commit("decoders");
    const result = scanAt(fixture, head, head);
    expect(hits(result)).toEqual([
      "privacy-scan: hit a-le.txt:2 pattern 1",
      "privacy-scan: hit b-be.txt:3 pattern 1",
      "privacy-scan: hit c-hex.txt:3 pattern 1",
      "privacy-scan: hit d-bom.txt:1 pattern 1",
    ]);
    expect(lastLine(result)).toBe(
      "privacy-scan: 4 hits, 4 files, 0 binary skipped, 0 gitlinks skipped, 0 commits, 2 patterns",
    );
    expect(result.status).toBe(1);
    expectNoLeak(result);
  });

  it("BR-345 object database: deleted working file, symlink target text, gitlink skipped", () => {
    const fixture = repository();
    fixture.write("gone.txt", `${TOKEN}\n`);
    symlinkSync(TOKEN, join(fixture.root, "link"));
    const first = fixture.commit("entries");
    fixture.git([
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${first},vendor/module`,
    ]);
    const head = fixture.commit("gitlink");
    rmSync(join(fixture.root, "gone.txt"));
    const result = scanAt(fixture, head, head);
    expect(hits(result)).toEqual([
      "privacy-scan: hit gone.txt:1 pattern 1",
      "privacy-scan: hit link:1 pattern 1",
    ]);
    expect(lastLine(result)).toBe(
      "privacy-scan: 2 hits, 2 files, 0 binary skipped, 1 gitlinks skipped, 0 commits, 2 patterns",
    );
    expect(result.status).toBe(1);
    expectNoLeak(result);
  });
});

describe("BR-348 locations", () => {
  it("BR-348 a tracked path holding the token is reported as file #k only", () => {
    const fixture = repository();
    fixture.write("a.txt", "clean\n");
    fixture.write(`dir/${TOKEN}.txt`, `clean\n${TOKEN}\n`);
    fixture.write("z.txt", "clean\n");
    const head = fixture.commit("paths");
    const result = scanAt(fixture, head, head);
    expect(hits(result)).toEqual([
      "privacy-scan: hit path file #2 pattern 1",
      "privacy-scan: hit file #2:2 pattern 1",
    ]);
    expect(result.status).toBe(1);
    expectNoLeak(result);
  });
});

describe("BR-346 commit range", () => {
  const fixture = repository();
  fixture.write("a.txt", "clean\n");
  const a = fixture.commit("first");
  fixture.write("b.txt", "clean b\n");
  const b = fixture.commit(`second\n\n${TOKEN}\n`);
  fixture.write("c.txt", `clean\n${TOKEN}\n`);
  const c = fixture.commit("third");
  fixture.git(["checkout", "-q", "-b", "other", a]);
  fixture.write("d.txt", "clean d\n");
  const d = fixture.commit("other side");
  fixture.git(["checkout", "-q", "main"]);
  const expected = [
    `privacy-scan: hit commit ${b} line 3 pattern 1`,
    `privacy-scan: hit commit ${c} added pattern 1`,
  ];
  const commitHits = (result: Result) =>
    hits(result).filter((line) => line.includes(" commit "));

  it.each([
    ["base A", a, {}, 2],
    ["base forty zeros", ZEROS, {}, 3],
    ["an unknown base", "1".repeat(40), {}, 3],
    ["an unknown non-hexadecimal base", "no-such-ref", {}, 3],
    ["an empty base", "", {}, 3],
    [
      "workflow_dispatch and base C",
      c,
      { PRIVACY_EVENT: "workflow_dispatch" },
      3,
    ],
    [
      "a moved PR base D sharing only A",
      d,
      { PRIVACY_EVENT: "pull_request" },
      2,
    ],
  ])(
    "BR-346 scans the range or full history with %s",
    (_name, base, extra, commits) => {
      const result = scanAt(fixture, base, c, extra);
      expect(commitHits(result)).toEqual(expected);
      expect(hits(result)).toContain("privacy-scan: hit c.txt:2 pattern 1");
      expect(lastLine(result)).toMatch(
        new RegExp(`, ${String(commits)} commits, 2 patterns$`, "u"),
      );
      expect(result.status).toBe(1);
      expectNoLeak(result);
    },
  );

  it("BR-346 scans nothing of history with base C", () => {
    const result = scanAt(fixture, c, c);
    expect(commitHits(result)).toEqual([]);
    expect(lastLine(result)).toMatch(/, 0 commits, 2 patterns$/u);
  });

  it.each([
    ["an empty head", ""],
    ["an unknown head", "1".repeat(40)],
    ["an option-like head", "--all"],
  ])("BR-346 refuses %s", (_name, head) => {
    const result = scanAt(fixture, a, head);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("privacy-scan: head is not a commit\n");
  });

  it("BR-346 reports a token in a commit identity once", () => {
    const other = repository();
    other.write("a.txt", "clean\n");
    const base = other.commit("first");
    other.write("b.txt", "clean\n");
    const head = other.commit("second", {
      GIT_AUTHOR_EMAIL: `${TOKEN}@example.invalid`,
    });
    const result = scanAt(other, base, head);
    expect(hits(result)).toEqual([
      `privacy-scan: hit commit ${head} identity pattern 1`,
    ]);
    expect(result.status).toBe(1);
    expectNoLeak(result);
  });

  it("BR-346 reports a +++ line of a new blob and a deleted path once per commit", () => {
    const other = repository();
    other.write(`${TOKEN}.txt`, "clean\n");
    const base = other.commit("path holder");
    other.write("e.txt", `clean\n+++ ${TOKEN}\n`);
    const e = other.commit("plus lines");
    rmSync(join(other.root, `${TOKEN}.txt`));
    const f = other.commit("delete");
    const result = scanAt(other, base, f);
    expect(hits(result).filter((line) => line.includes(" commit "))).toEqual([
      `privacy-scan: hit commit ${e} added pattern 1`,
      `privacy-scan: hit commit ${f} added pattern 1`,
    ]);
    expectNoLeak(result);
  });

  it("BR-346 reports a commit adding a UTF-16 LE file with BOM", () => {
    const other = repository();
    other.write("a.txt", "clean\n");
    const base = other.commit("first");
    other.write("wide.txt", utf16le(`clean\n${TOKEN}\n`));
    const head = other.commit("wide");
    const result = scanAt(other, base, head);
    expect(hits(result)).toContain(
      `privacy-scan: hit commit ${head} added pattern 1`,
    );
    expect(lastLine(result)).toMatch(/ 0 binary skipped, /u);
    expectNoLeak(result);
  });
});

describe("BR-347 pull-request text", () => {
  const fixture = repository();
  fixture.write("a.txt", "clean\n");
  const head = fixture.commit("clean");
  const pr = {
    PRIVACY_PR_TITLE: `Add ${TOKEN}`,
    PRIVACY_PR_BODY: `line one\nline two\nsee ${TOKEN}\n`,
  };
  it("BR-347 scans the title and body on pull_request", () => {
    const result = scanAt(fixture, head, head, {
      ...pr,
      PRIVACY_EVENT: "pull_request",
    });
    expect(hits(result)).toEqual([
      "privacy-scan: hit pr-title:1 pattern 1",
      "privacy-scan: hit pr-body:3 pattern 1",
    ]);
    expect(result.status).toBe(1);
    expectNoLeak(result);
  });
  it("BR-347 ignores the title and body on push", () => {
    const result = scanAt(fixture, head, head, {
      ...pr,
      PRIVACY_EVENT: "push",
    });
    expect(hits(result)).toEqual([]);
    expect(lastLine(result)).toBe(
      "privacy-scan: 0 hits, 1 files, 0 binary skipped, 0 gitlinks skipped, 0 commits, 2 patterns",
    );
    expect(result.status).toBe(0);
  });
});

describe("BR-349 internal error", () => {
  it("BR-349 internal error prints one fixed stderr line and exits 2 outside a repository", () => {
    const cwd = temporary("privacy-scan-outside-");
    const result = scan(cwd, {
      PRIVACY_DENY_PATTERNS: PATTERNS,
      PRIVACY_EVENT: "push",
      PRIVACY_RANGE_BASE: ZEROS,
      PRIVACY_RANGE_HEAD: "1".repeat(40),
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("privacy-scan: internal error\n");
  });
});

describe("BR-352 Makefile and imports", () => {
  it("BR-352 Makefile runs the scan in dev by variable name only, without setup", () => {
    const makefile = readFileSync("Makefile", "utf8");
    const block = /^privacy-scan:(.*)\n((?:\t.*\n)+)/mu.exec(makefile);
    expect(block?.[1]).toBe(" _require-container-config");
    const names = [
      "PRIVACY_DENY_PATTERNS",
      "PRIVACY_EVENT",
      "PRIVACY_RANGE_BASE",
      "PRIVACY_RANGE_HEAD",
      "PRIVACY_PR_TITLE",
      "PRIVACY_PR_BODY",
    ];
    expect(block?.[2]).toBe(
      `\t$(COMPOSE) run --rm -T ${names.map((name) => `-e ${name}`).join(" ")} dev node scripts/privacy-scan.ts\n`,
    );
    expect(block?.[2]).not.toMatch(/-e PRIVACY_\w+=/u);
    expect(block?.[0]).not.toContain("_require-setup");
    expect(makefile).toMatch(/^\.PHONY:[^\n]*(?:\\\n[^\n]*)*privacy-scan/mu);
  });
  it("BR-352 scripts/privacy-scan.ts imports only node: built-ins", () => {
    const source = readFileSync("scripts/privacy-scan.ts", "utf8");
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/gu),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gmu),
    ].map((match) => match[1] ?? "");
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:/u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
  });
});

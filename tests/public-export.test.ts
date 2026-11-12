// #95: public export tooling. Synthetic fixtures only: the repository is
// `acme/widget`, the private name is `doe` and the handle `jdoe`.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySubstitutions,
  commitMessage,
  commitTree,
  checkOverlay,
  compareFiles,
  decodeContent,
  gitBlobSha,
  normalizeEncoded,
  parseOverlayLock,
  EMAIL_PATTERN,
  exportTree,
  formatHit,
  formatManifest,
  isExcluded,
  parseDenyPatterns,
  parseLines,
  parseSubstitutions,
  readSource,
  rewriteMarkdown,
  scanText,
  stampPath,
} from "../scripts/public-export.js";

const repo = { owner: "acme", name: "widget" };
const gh = "https://github.com";
// Built at run time so that the export's own deny scan never sees them.
const email = (local: string, domain: string) => [local, domain].join("@");
// A Markdown link into runs/ is a deny form of the export: built at run time.
const link = (label: string, target: string) => `[${label}]` + `(${target})`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "public-export-"));
  roots.push(root);
  return root;
}
function write(root: string, path: string, content: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
const fixtureEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_AUTHOR_DATE: "2026-01-02T03:04:05+01:00",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.test",
  GIT_COMMITTER_DATE: "2026-01-02T03:04:05+01:00",
};
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, env: { ...fixtureEnv, HOME: cwd } })
    .toString("utf8")
    .trim();
}

describe("Markdown link rewriting", () => {
  it("turns a link to runs/ into an archived-evidence mention", () => {
    expect(
      rewriteMarkdown(
        `See ${link("the review", "../runs/5-review-1.md#top")}.`,
        repo,
      ),
    ).toBe("See the review (archived evidence `runs/5-review-1.md`).");
  });

  it("rewrites runs/ links with a wrapped label, an image marker or a title", () => {
    expect(
      rewriteMarkdown(link("the observed\nfailures", "runs/8-dev-3.md"), repo),
    ).toBe("the observed\nfailures (archived evidence `runs/8-dev-3.md`)");
    expect(rewriteMarkdown(`!${link("chart", 'runs/x/c.png "C"')}`, repo)).toBe(
      "chart (archived evidence `runs/x/c.png`)",
    );
  });

  it("turns issue and pull request links into archive mentions", () => {
    expect(
      rewriteMarkdown(
        `[the verdict](${gh}/acme/widget/pull/41#issuecomment-9) and [ticket](${gh}/acme/widget/issues/7)`,
        repo,
      ),
    ).toBe("the verdict (archive PR 41) and ticket (archive issue 7)");
    expect(
      rewriteMarkdown(`Ticket: [#5](${gh}/acme/widget/issues/5).`, repo),
    ).toBe("Ticket: #5 (archive issue 5).");
    expect(
      rewriteMarkdown(`See [issue #2](${gh}/acme/widget/issues/2).`, repo),
    ).toBe("See issue #2 (archive issue 2).");
    expect(
      rewriteMarkdown(
        link("run", gh + "/acme/widget/actions/runs/99") +
          ` [log](${gh}/acme/widget/commits/main) [r](${gh}/acme/widget/releases/tag/v1) [p](${gh}/acme/widget/projects/2)`,
        repo,
      ),
    ).toBe(
      "run (archive actions page) log (archive commits page) r (archive releases page) p (archive project board)",
    );
  });

  it("never produces a #N reference for a private issue or pull request", () => {
    const text = rewriteMarkdown(
      `[a](${gh}/acme/widget/issues/3) [b](${gh}/acme/widget/pull/4) ${gh}/acme/widget/pull/5 https://api.github.com/repos/acme/widget/pulls/6 https://api.github.com/repos/acme/widget/issues/7`,
      repo,
    );
    expect(text).toBe(
      "a (archive issue 3) b (archive PR 4) archive PR 5 archive PR 6 archive issue 7",
    );
    expect(text).not.toMatch(/#\d/u);
  });

  it("turns project board, revision and runs-revision links into plain text", () => {
    expect(rewriteMarkdown(`[board](${gh}/users/acme/projects/1/)`, repo)).toBe(
      "board (archive project board)",
    );
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(
      rewriteMarkdown(
        `[test](${gh}/acme/widget/blob/${sha}/tests/a.ts#L3)`,
        repo,
      ),
    ).toBe("test (archive `tests/a.ts` at `0123456789ab`)");
    expect(
      rewriteMarkdown(`[root](${gh}/acme/widget/commit/${sha})`, repo),
    ).toBe("root (archive commit `0123456789ab`)");
    expect(
      rewriteMarkdown(
        link("run", `${gh}/acme/widget/blob/${sha}/runs/r.md`),
        repo,
      ),
    ).toBe("run (archived evidence `runs/r.md`)");
  });

  it("rewrites bare and angle-bracket URLs of private issues and boards", () => {
    expect(
      rewriteMarkdown(
        `Target: ${gh}/acme/widget/issues/12. Board <${gh}/users/acme/projects/1/>.`,
        repo,
      ),
    ).toBe("Target: archive issue 12. Board archive project board.");
  });

  it("turns a relative link to a removed path into an archive mention", () => {
    const removed = {
      from: "docs/spec/index.md",
      paths: (path: string) => path === "docs/issues.json",
    };
    expect(
      rewriteMarkdown(
        "[export](../issues.json) and [backlog](../backlog.md)",
        repo,
        removed,
      ),
    ).toBe("export (archive `docs/issues.json`) and [backlog](../backlog.md)");
  });

  it("keeps other links unchanged", () => {
    const text = [
      `[docs](docs/runbook.md)`,
      `[repo](${gh}/acme/widget)`,
      `[issues](${gh}/acme/widget/issues)`,
      `[other](${gh}/other/widget/issues/3)`,
      link("spec", "https://example.org/runs/x"),
      `${gh}/other/widget/pull/4`,
      "plain runs/5-review-1.md mention",
    ].join("\n");
    expect(rewriteMarkdown(text, repo)).toBe(text);
  });
});

describe("substitutions", () => {
  it("parses literal from<TAB>to lines and applies them in order", () => {
    const subs = parseSubstitutions(
      "# comment\nhttps://ci.acme.lan\thttps://ci.example.org\n\nci.acme.lan\tci.example.org\n",
    );
    expect(subs).toEqual([
      { from: "https://ci.acme.lan", to: "https://ci.example.org" },
      { from: "ci.acme.lan", to: "ci.example.org" },
    ]);
    expect(
      applySubstitutions("https://ci.acme.lan/x and ci.acme.lan (a.b)", subs),
    ).toBe("https://ci.example.org/x and ci.example.org (a.b)");
  });

  it("refuses a line without exactly one tab", () => {
    expect(() => parseSubstitutions("only-from\n")).toThrow(/line 1/u);
    expect(() => parseSubstitutions("a\tb\tc\n")).toThrow(/line 1/u);
  });
});

describe("deny scan", () => {
  const patterns = parseDenyPatterns(
    "# names\n(?<![a-z])doe\nacme[-.]?private\n",
  );

  it("reports each hit with path, line and pattern, case-insensitively", () => {
    const hits = scanText(
      "docs/a.md",
      "first\nby Jane DOE\nsee acme-private.net and Doe\n",
      patterns,
    );
    expect(hits.map(formatHit)).toEqual([
      "docs/a.md:2: (?<![a-z])doe",
      "docs/a.md:3: (?<![a-z])doe",
      "docs/a.md:3: acme[-.]?private",
    ]);
  });

  it("allows the public handle that contains the private name", () => {
    expect(
      scanText("README.md", `${gh}/jdoe/widget and @jdoe`, patterns),
    ).toEqual([]);
  });

  it("reports personal e-mail addresses with the built-in rule", () => {
    const text = [
      email("someone", "privatecorp.org"),
      email("first.last", "mail.example-isp.ch"),
      email("x", "example.com.evil.org"),
    ].join("\n");
    expect(scanText("a.txt", text, patterns).map((hit) => hit.line)).toEqual([
      1, 2, 3,
    ]);
    expect(patterns.at(-1)?.source).toBe(EMAIL_PATTERN);
  });

  it("allows reserved example, fixture and no-reply addresses", () => {
    const text = [
      "user@example.com",
      "User@EXAMPLE.ORG",
      "pw@sonar.example.test",
      "a@b.example",
      "Other@xn--bcher-kva.example",
      "u@idp.test",
      "fixture@example.invalid",
      "http://localhost:8080@evil.test/cb",
      "me@host.localhost",
      "1+jdoe@users.noreply.github.com",
      "npm@11.20.0 and @scope/package",
    ].join("\n");
    expect(scanText("a.txt", text, patterns)).toEqual([]);
  });

  it("suppresses exact allowed literals only", () => {
    const fixture = email("user", "fixture-corp.io");
    const text = `${fixture}\n${email("other", "fixture-corp.io")}\n`;
    expect(
      scanText("t.ts", text, patterns, [fixture.toUpperCase()]).map(
        (hit) => hit.line,
      ),
    ).toEqual([2]);
  });

  it("decodes UTF-8, UTF-16 with a BOM and Latin-1, and flags NUL bytes as binary", () => {
    expect(decodeContent(Buffer.from("text é\n"))).toEqual({
      text: "text é\n",
      encoding: "utf-8",
    });
    expect(decodeContent(Buffer.from("\uFEFFbom"))).toEqual({
      text: "\uFEFFbom",
      encoding: "utf-8",
    });
    expect(decodeContent(Buffer.from([0x4a, 0xe9, 0x44, 0x4f, 0x45]))).toEqual({
      text: "JéDOE",
      encoding: "latin1",
    });
    const le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("by doe", "utf16le"),
    ]);
    expect(decodeContent(le)).toEqual({ text: "by doe", encoding: "utf-16le" });
    const be = Buffer.from(le.subarray(2)).swap16();
    expect(
      decodeContent(Buffer.concat([Buffer.from([0xfe, 0xff]), be])),
    ).toEqual({ text: "by doe", encoding: "utf-16be" });
    expect(
      decodeContent(Buffer.from([0x89, 0x00, 0x64, 0x00, 0x6f, 0x65])),
    ).toEqual({ text: "\u0089doe", encoding: "binary" });
  });

  it("finds names in Latin-1, UTF-16 and binary content", () => {
    for (const bytes of [
      Buffer.from([0x4a, 0xe9, 0x20, 0x44, 0x4f, 0x45]),
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("by Doe", "utf16le"),
      ]),
      Buffer.from("x\0by\0 \0d\0o\0e\0", "latin1"),
    ])
      expect(
        scanText("f", decodeContent(bytes).text, patterns).map(formatHit),
      ).toEqual(["f:1: (?<![a-z])doe"]);
  });

  it("decodes percent escapes and HTML entities before matching", () => {
    expect(
      normalizeEncoded("acme%2Dprivate &amp; acme&#45;private &#x64;oe"),
    ).toBe("acme-private & acme-private doe");
    expect(normalizeEncoded("%E9 %C3%A9 &bogus; 100%")).toBe(
      "é é &bogus; 100%",
    );
    const hits = scanText(
      "a.md",
      "ok\nhttps://acme%2Dprivate.net\nby &#68;oe and acme&period;private\n",
      patterns,
    );
    expect(hits.map(formatHit)).toEqual([
      "a.md:2: acme[-.]?private",
      "a.md:3: (?<![a-z])doe",
      "a.md:3: acme[-.]?private",
    ]);
  });

  it("finds a name split over a line break at the line where it starts", () => {
    const split = parseDenyPatterns("acme[\\s\\-_.%]*(?:2d)?private\n");
    expect(
      scanText("a.md", "intro\nthe acme\n  private site\nend\n", split).map(
        formatHit,
      ),
    ).toEqual(["a.md:2: acme[\\s\\-_.%]*(?:2d)?private"]);
    expect(
      scanText("a.md", "Acme_%2dPrivate and ACME PRIVATE\n", split).map(
        (hit) => hit.line,
      ),
    ).toEqual([1]);
    expect(scanText("a.md", "acme\n\npublic private\n", split)).toEqual([]);
  });
});

describe("exclusion", () => {
  it("parses entries and excludes directories by prefix and files exactly", () => {
    const entries = parseLines("# private\nruns/\n\n  docs/issues.json  \n");
    expect(entries).toEqual(["runs/", "docs/issues.json"]);
    expect(isExcluded("runs/a.md", entries)).toBe(true);
    expect(isExcluded("runs/sub/b.md", entries)).toBe(true);
    expect(isExcluded("docs/issues.json", entries)).toBe(true);
    expect(isExcluded("docs/runs/a.md", entries)).toBe(false);
    expect(isExcluded("docs/issues.json.bak", entries)).toBe(false);
    expect(isExcluded("runs", entries)).toBe(false);
  });
});

function fixtureRepository() {
  const root = temporary();
  const source = join(root, "source");
  mkdirSync(source);
  git(source, "init", "--quiet", "--initial-branch=main");
  write(source, "runs/1-review-1.md", "private run\n");
  write(source, "docs/issues.json", "[]\n");
  write(
    source,
    "docs/guide.md",
    `See ${link("run", "../runs/1-review-1.md")} and [list](issues.json#top) at ci.acme.lan.\n`,
  );
  write(source, "learnings.md", "private learnings\n");
  write(source, "src/a.ts", 'export const host = "ci.acme.lan";\n');
  write(source, "tests/img.bin", Buffer.from([0x00, 0x01, 0x02, 0x03]));
  write(source, "README.md", "Widget by jdoe.\n");
  git(source, "add", "--all");
  git(source, "commit", "--quiet", "-m", "fixture");
  const config = join(root, "config");
  write(config, "exclude.txt", "runs/\ndocs/issues.json\n");
  write(config, "substitutions.tsv", "ci.acme.lan\tci.example.org\n");
  write(config, "deny-patterns.txt", "(?<![a-z])doe\nacme\\.lan\n");
  write(config, "overlay/learnings.md", "public learnings\n");
  write(config, "overlay/NEW.md", "added by the overlay\n");
  write(
    config,
    "overlay.lock",
    `# curated\nlearnings.md ${gitBlobSha(Buffer.from("private learnings\n"))}\nNEW.md -\n`,
  );
  write(config, "allow-binaries.txt", "tests/img.bin\n");
  return { root, source, config };
}

describe("export and root commit", () => {
  it("removes excluded paths, applies overlay, rewrites and scans clean", async () => {
    const { root, source, config } = fixtureRepository();
    const { archive, source: commit } = readSource(source, "HEAD");
    expect(commit.date).toBe("2026-01-02T03:04:05+01:00");
    const out = join(root, "out");
    const result = await exportTree({
      archive,
      source: commit,
      out,
      config,
      repository: repo,
    });
    expect(result).toEqual({
      removed: ["docs/issues.json", "runs/1-review-1.md"],
      changed: ["docs/guide.md", "learnings.md", "src/a.ts"],
      added: ["NEW.md"],
      hits: [],
      binaries: ["tests/img.bin"],
      unallowedBinaries: [],
    });
    expect(existsSync(join(out, "runs"))).toBe(false);
    expect(readFileSync(join(out, "docs/guide.md"), "utf8")).toBe(
      "See run (archived evidence `runs/1-review-1.md`) and list (archive `docs/issues.json`) at ci.example.org.\n",
    );
    expect(readFileSync(join(out, "learnings.md"), "utf8")).toBe(
      "public learnings\n",
    );
    const manifest = formatManifest(commit, result);
    expect(manifest).toContain(
      "removed 2\nchanged 3\nadded 1\ndeny-hits 0\nbinaries 1\nunallowed-binaries 0\n",
    );
    expect(manifest).toContain("B tests/img.bin\n");
    expect(manifest).toContain("R runs/1-review-1.md\n");
    expect(manifest).toContain("M src/a.ts\n");
  });

  it("reports deny hits and then refuses the commit", async () => {
    const { root, source, config } = fixtureRepository();
    write(config, "substitutions.tsv", "");
    const { archive, source: commit } = readSource(source, "HEAD");
    const out = join(root, "out");
    const result = await exportTree({
      archive,
      source: commit,
      out,
      config,
      repository: repo,
    });
    expect(result.hits.map(formatHit)).toEqual([
      "docs/guide.md:1: acme\\.lan",
      "src/a.ts:1: acme\\.lan",
    ]);
    expect(() => commitTree(out, config)).toThrow(/2 deny hits/u);
    expect(existsSync(join(out, ".git"))).toBe(false);
  });

  it("refuses to export without an exclusion list", async () => {
    const { root, source } = fixtureRepository();
    const { archive, source: commit } = readSource(source, "HEAD");
    const out = join(root, "out");
    await expect(
      exportTree({ archive, source: commit, out, config: join(root, "none") }),
    ).rejects.toThrow(/exclude\.txt is missing/u);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a non-empty output directory it did not create", async () => {
    const { root, source, config } = fixtureRepository();
    const out = join(root, "out");
    write(out, "keep.txt", "owner data\n");
    const { archive, source: commit } = readSource(source, "HEAD");
    await expect(
      exportTree({ archive, source: commit, out, config, repository: repo }),
    ).rejects.toThrow(/no export stamp/u);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("owner data\n");
  });

  it("gives the same root commit SHA for the same source ref", async () => {
    const { root, source, config } = fixtureRepository();
    const { archive, source: commit } = readSource(source, "HEAD");
    const shas: string[] = [];
    for (const name of ["first", "second", "second"]) {
      const out = join(root, name);
      await exportTree({
        archive,
        source: commit,
        out,
        config,
        repository: repo,
      });
      expect(existsSync(stampPath(out))).toBe(true);
      shas.push(commitTree(out, config));
    }
    expect(new Set(shas).size).toBe(1);
    const out = join(root, "second");
    expect(git(out, "log", "--format=%an <%ae>|%cn <%ce>|%aI|%cI")).toBe(
      [
        "sstolz <2139682+sstolz@users.noreply.github.com>",
        "sstolz <2139682+sstolz@users.noreply.github.com>",
        commit.date,
        commit.date,
      ].join("|"),
    );
    expect(git(out, "log", "--format=%B")).toBe(commitMessage(commit).trim());
    expect(commitMessage(commit)).toBe(
      `Initial public release of kdrive-mcp-server\n\nExported from the private development archive at ${commit.sha.slice(0, 12)}.\n\nAssisted-by: AI coding agents (method in AGENTS.md)\n`,
    );
    expect(git(out, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("fails on a binary file outside the allow-list and refuses the commit", async () => {
    const { root, source, config } = fixtureRepository();
    write(config, "allow-binaries.txt", "# none\n");
    const { archive, source: commit } = readSource(source, "HEAD");
    const out = join(root, "out");
    const result = await exportTree({
      archive,
      source: commit,
      out,
      config,
      repository: repo,
    });
    expect(result.unallowedBinaries).toEqual(["tests/img.bin"]);
    expect(formatManifest(commit, result)).toContain("unallowed-binaries 1\n");
    expect(formatManifest(commit, result)).toContain(
      "B tests/img.bin (not in allow-binaries.txt)\n",
    );
    expect(() => commitTree(out, config)).toThrow(/1 binary files/u);
  });

  it("scans symbolic link targets and non-UTF-8 files", async () => {
    const { root, source, config } = fixtureRepository();
    symlinkSync("../doe/notes.md", join(source, "docs/notes.md"));
    write(
      source,
      "docs/latin.txt",
      Buffer.from([0xe9, 0x20, 0x64, 0x6f, 0x65]),
    );
    git(source, "add", "--all");
    git(source, "commit", "--quiet", "-m", "more");
    const { archive, source: commit } = readSource(source, "HEAD");
    const result = await exportTree({
      archive,
      source: commit,
      out: join(root, "out"),
      config,
      repository: repo,
    });
    expect(result.hits.map(formatHit)).toEqual([
      "docs/latin.txt:1: (?<![a-z])doe",
      "docs/notes.md:1: (?<![a-z])doe",
    ]);
  });

  it("fails when an overlaid source file changed since its curation", async () => {
    const { root, source, config } = fixtureRepository();
    write(source, "learnings.md", "private learnings\nnew private line\n");
    git(source, "commit", "--quiet", "-am", "new learning");
    const { archive, source: commit } = readSource(source, "HEAD");
    await expect(
      exportTree({
        archive,
        source: commit,
        out: join(root, "out"),
        config,
        repository: repo,
      }),
    ).rejects.toThrow(
      /overlay drift:\nlearnings\.md: the source blob is [0-9a-f]{40}/u,
    );
  });

  it("lists extra, modified and missing files against the stamp", () => {
    expect(
      compareFiles(
        new Map([
          ["a", "100644 1"],
          ["b", "100755 2"],
          ["z", "100644 3"],
        ]),
        { a: "100644 1", b: "100644 2", c: "100644 4" },
      ),
    ).toEqual(["extra z", "missing c", "modified b"]);
  });

  it("checks every overlay file against the lock", () => {
    const original = new Map([["a.md", Buffer.from("a\n")]]);
    const sha = gitBlobSha(Buffer.from("a\n"));
    expect(sha).toBe("78981922613b2afb6025042ff6bd878ac1994e85");
    expect(() => {
      checkOverlay(
        ["a.md", "b.md"],
        parseOverlayLock(`a.md ${sha}\nb.md -\n`),
        original,
      );
    }).not.toThrow();
    expect(() => {
      checkOverlay(["a.md"], new Map(), original);
    }).toThrow(/a\.md: no overlay\.lock entry/u);
    expect(() => {
      checkOverlay([], parseOverlayLock(`a.md ${sha}\n`), original);
    }).toThrow(/in overlay\.lock but not in the overlay/u);
    expect(() => parseOverlayLock("a.md abc\n")).toThrow(/overlay\.lock/u);
  });

  it("commits only the exported files, ignoring build outputs the tree ignores", async () => {
    const { root, source, config } = fixtureRepository();
    write(source, ".gitignore", "dist/\n");
    git(source, "add", "--all");
    git(source, "commit", "--quiet", "-m", "ignore");
    const { archive, source: commit } = readSource(source, "HEAD");
    const out = join(root, "out");
    await exportTree({
      archive,
      source: commit,
      out,
      config,
      repository: repo,
    });
    const first = commitTree(out, config);
    write(out, "dist/build.js", "built\n");
    expect(commitTree(out, config)).toBe(first);
    write(out, "stray.txt", "left over\n");
    expect(() => commitTree(out, config)).toThrow(/extra stray\.txt/u);
    expect(existsSync(join(out, ".git"))).toBe(false);
    rmSync(join(out, "stray.txt"));
    write(out, "README.md", "edited\n");
    expect(() => commitTree(out, config)).toThrow(/modified README\.md/u);
    const stamp = JSON.parse(readFileSync(stampPath(out), "utf8")) as {
      files: Record<string, string>;
    };
    expect(stamp.files["NEW.md"]).toBe(
      `100644 ${gitBlobSha(Buffer.from("added by the overlay\n"))}`,
    );
  });
});

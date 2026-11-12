import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sonar from "../scripts/sonar.js";
import { withinDeadline } from "../scripts/deadline.js";

const token = "SYNTHETIC_PROJECT_TOKEN";
const sha = "a".repeat(40);
const report =
  "projectKey=kdrive-mcp-server\nserverUrl=https://sonar.example.test\nceTaskId=synthetic-task\n";
const host = {
  url: "https://sonar.example.test",
  hostname: "sonar.example.test",
};
const snapshot = {
  branch: "main",
  commit: sha,
  trustedMain: sha,
  clean: true,
  repository: "https://github.com/sstolz/kdrive-mcp-server.git",
  event: "local",
};

describe("BR-014 official scanner contract", () => {
  it("accepts project token without legacy configuration or custom network calls", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Custom HTTP forbidden"));
    const scan = vi.fn(() => Promise.resolve({ code: 0, metadata: report }));
    const log = vi.fn();
    expect(
      await sonar.runAnalysis({
        enabled: "true",
        token,
        host,
        mode: "main",
        snapshot,
        verifySnapshot: () => Promise.resolve(),
        scan,
        log,
      }),
    ).toBe(0);
    expect(scan).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
  it("preserves scanner failure code and exact redacted diagnostic", async () => {
    const log = vi.fn();
    expect(
      await sonar.runAnalysis({
        enabled: "true",
        token,
        host,
        mode: "main",
        snapshot,
        verifySnapshot: () => Promise.resolve(),
        scan: () =>
          Promise.reject(new Error(`Access denied: ${token}; retry ${token}`)),
        log,
      }),
    ).toBe(1);
    expect(log.mock.calls.flat().join("")).toContain(
      "Access denied: [REDACTED]; retry [REDACTED]",
    );
  });
  it("loads exactly one selected token, accepting file terminal LF/CRLF only", async () => {
    const root = await mkdtemp(join(tmpdir(), "sonar-token-"));
    const file = join(root, "synthetic-token");
    for (const suffix of ["", "\n", "\r\n"]) {
      await writeFile(file, token + suffix);
      expect(await sonar.loadToken({ SONAR_TOKEN_FILE: file })).toBe(token);
    }
    expect(await sonar.loadToken({ SONAR_TOKEN: token })).toBe(token);
    for (const env of [
      {},
      { SONAR_TOKEN: "" },
      { SONAR_TOKEN: "  " },
      { SONAR_TOKEN: "a\nb" },
      { SONAR_TOKEN: token, SONAR_TOKEN_FILE: file },
      { SONAR_TOKEN_FILE: join(root, "missing") },
    ])
      await expect(sonar.loadToken(env)).rejects.toThrow();
    for (const value of ["", " \n", `${token}\n\n`, `${token}\nsecond`]) {
      await writeFile(file, value);
      await expect(
        sonar.loadToken({ SONAR_TOKEN_FILE: file }),
      ).rejects.toThrow();
    }
    await writeFile(file, token);
    await chmod(file, 0o000);
    await expect(sonar.loadToken({ SONAR_TOKEN_FILE: file })).rejects.toThrow();
  });
  it("runs a fake scanner with official metadata, split redaction and runtime-only credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "official-scanner-"));
    const work = join(root, "work");
    const cache = join(root, "cache");
    await mkdir(work);
    await mkdir(cache);
    const executable = join(root, "scanner");
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconst fs=require('fs'); const args=process.argv.slice(2); fs.writeFileSync(${JSON.stringify(join(root, "args.json"))},JSON.stringify(args)); const report=args.find(a=>a.startsWith('-Dsonar.scanner.metadataFilePath=')).split('=').slice(1).join('=');fs.writeFileSync(report,${JSON.stringify(report)});process.stdout.write('Diagnostic '+process.env.SONAR_TOKEN.slice(0,8));setTimeout(()=>{process.stdout.write(process.env.SONAR_TOKEN.slice(8)+' again '+process.env.SONAR_TOKEN+' end\\n');},10);\n`,
    );
    await chmod(executable, 0o755);
    const logs: string[] = [];
    const result = await sonar.scanOfficial({
      root,
      work,
      cache,
      executable,
      token,
      host,
      commit: sha,
      runId: "00000000-0000-4000-8000-000000000000",
      signal: new AbortController().signal,
      log: (text) => logs.push(text),
    });
    expect(result).toEqual({ code: 0, metadata: report });
    expect(logs.join("")).toBe("Diagnostic [REDACTED] again [REDACTED] end\n");
    const args = await readFile(join(root, "args.json"), "utf8");
    expect(args).not.toContain(token);
    expect(args).toContain(`-Dsonar.scm.revision=${sha}`);
    expect(args).toContain("-Dsonar.qualitygate.wait=true");
    await expect(
      sonar.scanOfficial({
        root,
        work,
        cache,
        executable,
        token,
        host,
        commit: sha,
        runId: "00000000-0000-4000-8000-000000000000",
        signal: new AbortController().signal,
        log: (text) => logs.push(text),
      }),
    ).rejects.toThrow("already exists");
  });

  it.each([
    "failed-gate",
    "network",
    "signal",
    "hang",
    "output-cap",
    "delayed-output-cap",
  ])(
    "preserves failure diagnostics and kills owned scanner work: %s",
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), "scanner-error-"));
      const work = join(root, "work");
      const cache = join(root, "cache");
      await mkdir(work);
      await mkdir(cache);
      const pidFile = join(root, "pid");
      const executable = join(root, "scanner");
      const capped = mode.endsWith("output-cap");
      const delay = mode === "delayed-output-cap" ? 250 : 10;
      const script = `#!/usr/bin/env node\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); if(process.env.SONAR_SCANNER_OPTS || process.env.SONAR_SCANNER_JSON_PARAMS || process.env.SONAR_TOKEN_FILE) process.exit(99); process.stderr.write('ERROR ${mode}: '+process.env.SONAR_TOKEN.slice(0,5));setTimeout(()=>{process.stderr.write(process.env.SONAR_TOKEN.slice(5)+' '+process.env.SONAR_TOKEN+' detail\\n');${mode === "signal" ? "process.kill(process.pid,'SIGTERM');" : mode === "hang" ? "setInterval(()=>{},1000);" : capped ? "process.stdout.write('x'.repeat(1000)+process.env.SONAR_TOKEN);setInterval(()=>{},1000);" : "process.exitCode=23;"}},${delay});\n`;
      await writeFile(executable, script);
      await chmod(executable, 0o755);
      const logs: string[] = [];
      let code = 0;
      const startedAt = Date.now();
      let scannerWork: Promise<sonar.ScanResult> | undefined;
      try {
        code = await withinDeadline(
          // Only the hang case exercises the injected short deadline. Other
          // cases need startup/scheduling headroom to reach their own failure.
          mode === "hang" ? 200 : 2000,
          async (signal) => {
            scannerWork = sonar.scanOfficial({
              root,
              work,
              cache,
              executable,
              token,
              host,
              commit: sha,
              runId: "00000000-0000-4000-8000-000000000000",
              signal,
              log: (text) => logs.push(text),
              outputLimit: capped ? 150 : 10000,
            });
            return (await scannerWork).code;
          },
        );
      } catch (error) {
        expect(
          mode,
          `${String(error)}; elapsed=${Date.now() - startedAt}ms; diagnostic=${logs.join("")}`,
        ).toBe("hang");
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Analysis deadline exceeded");
        await scannerWork;
        code = 1;
      }
      expect(code).not.toBe(0);
      if (["failed-gate", "network"].includes(mode)) expect(code).toBe(23);
      expect(logs.join("")).not.toContain(token);
      expect(logs.join("")).toContain(
        `ERROR ${mode}: [REDACTED] [REDACTED] detail\n`,
      );
      if (capped) expect(logs.join("")).toContain("output limit exceeded");
      await new Promise((resolve) => setTimeout(resolve, 25));
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it("redacts every boundary split and repeated token before capped emission", () => {
    for (let split = 0; split <= token.length; split++) {
      const output = sonar.redactCaptured(
        [
          { stream: 0, text: `before ${token.slice(0, split)}` },
          {
            stream: 0,
            text: `${token.slice(split)} mid ${token.slice(0, split)}`,
          },
          { stream: 0, text: `${token.slice(split)} after` },
        ],
        token,
      );
      expect(output).toBe("before [REDACTED] mid [REDACTED] after");
    }
  });

  it("redacts a credential split between stdout and stderr before forwarding either stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-streams-"));
    const work = join(root, "work");
    const cache = join(root, "cache");
    await mkdir(work);
    await mkdir(cache);
    const executable = join(root, "scanner");
    await writeFile(
      executable,
      "#!/usr/bin/env node\nprocess.stdout.write('ERROR '+process.env.SONAR_TOKEN.slice(0,8));setTimeout(()=>{process.stderr.write(process.env.SONAR_TOKEN.slice(8)+' detail\\n');process.exitCode=23;},10);\n",
    );
    await chmod(executable, 0o755);
    const logs: string[] = [];
    expect(
      (
        await sonar.scanOfficial({
          root,
          work,
          cache,
          executable,
          token,
          host,
          commit: sha,
          runId: "00000000-0000-4000-8000-000000000000",
          signal: new AbortController().signal,
          log: (text) => logs.push(text),
        })
      ).code,
    ).toBe(23);
    expect(logs.join("")).toBe("ERROR [REDACTED] detail\n");
  });

  it.each(["stdout", "stderr"])(
    "keeps %s token fragments private across unrelated interleaved messages",
    async (channel) => {
      const root = await mkdtemp(join(tmpdir(), "scanner-interleaved-"));
      const work = join(root, "work");
      const cache = join(root, "cache");
      await mkdir(work);
      await mkdir(cache);
      const executable = join(root, "scanner");
      const other = channel === "stdout" ? "stderr" : "stdout";
      await writeFile(
        executable,
        `#!/usr/bin/env node\nprocess.${channel}.write('ERROR '+process.env.SONAR_TOKEN.slice(0,8));setTimeout(()=>process.${other}.write('warning\\n'),20);setTimeout(()=>process.${channel}.write(process.env.SONAR_TOKEN.slice(8,15)),40);setTimeout(()=>process.${other}.write('notice\\n'),60);setTimeout(()=>{process.${channel}.write(process.env.SONAR_TOKEN.slice(15)+' detail\\n');process.exitCode=23;},80);\n`,
      );
      await chmod(executable, 0o755);
      const logs: string[] = [];
      const result = await sonar.scanOfficial({
        root,
        work,
        cache,
        executable,
        token,
        host,
        commit: sha,
        runId: "00000000-0000-4000-8000-000000000000",
        signal: new AbortController().signal,
        log: (text) => logs.push(text),
      });
      expect(result.code).toBe(23);
      expect(logs.join("")).toBe("ERROR [REDACTED]warning\nnotice\n detail\n");
      for (const fragment of [
        token.slice(0, 8),
        token.slice(8, 15),
        token.slice(15),
      ])
        expect(logs.join("")).not.toContain(fragment);
    },
  );

  it.each(["eof", "cap"])(
    "does not flush a partial credential at %s",
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), "scanner-partial-"));
      const work = join(root, "work");
      const cache = join(root, "cache");
      await mkdir(work);
      await mkdir(cache);
      const executable = join(root, "scanner");
      await writeFile(
        executable,
        `#!/usr/bin/env node\nprocess.stdout.write('ERROR '+process.env.SONAR_TOKEN.slice(0,8));setTimeout(()=>{${mode === "cap" ? "process.stderr.write('w'.repeat(1000));setInterval(()=>{},1000);" : "process.exitCode=23;"}},20);\n`,
      );
      await chmod(executable, 0o755);
      const logs: string[] = [];
      const result = await sonar.scanOfficial({
        root,
        work,
        cache,
        executable,
        token,
        host,
        commit: sha,
        runId: "00000000-0000-4000-8000-000000000000",
        signal: new AbortController().signal,
        log: (text) => logs.push(text),
        outputLimit: 100,
      });
      expect(result.code).not.toBe(0);
      expect(logs.join("")).not.toContain(token.slice(0, 8));
      expect(logs.join("")).toContain("ERROR [REDACTED]");
      if (mode === "cap")
        expect(logs.join("")).toContain("output limit exceeded");
      else expect(logs.join("")).toBe("ERROR [REDACTED]");
    },
  );
});

const prSnapshot = {
  branch: "",
  commit: sha,
  trustedMain: sha,
  clean: true,
  repository: "https://github.com/sstolz/kdrive-mcp-server",
  event: "pull_request",
  ref: "refs/pull/7/merge",
  headRepository: "sstolz/kdrive-mcp-server",
  baseRef: "main",
};
const prReport =
  "projectKey=kdrive-mcp-server-pr\nserverUrl=https://sonar.example.test\nceTaskId=synthetic-task\n";

describe("BR-145 runtime analysis host", () => {
  it("BR-145 loads exactly one canonical https host", async () => {
    for (const value of [
      "https://sonar.example.test",
      "https://sonar.example.test/",
      "https://sonar.example.test/ctx",
    ]) {
      const loaded = await sonar.loadHost({ SONAR_HOST_URL: value });
      expect(loaded).toEqual({ url: value, hostname: "sonar.example.test" });
    }
    const rejected = [
      "http://sonar.example.test",
      "sonar.example.test",
      "/relative",
      "https://user:pw@sonar.example.test",
      "https://sonar.example.test?q=1",
      "https://sonar.example.test#f",
      "https://SONAR.example.test",
      "https://sonar.example.test:443",
      "https://sonar.example.test/ ctx",
      "https://sonar.example.test\n",
      "https://sonar.example.test\0",
      "",
    ];
    for (const value of rejected) {
      const error = await sonar
        .loadHost({ SONAR_HOST_URL: value })
        .catch((caught: unknown) => caught);
      expect(error, JSON.stringify(value)).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid analysis host");
    }
    const root = await mkdtemp(join(tmpdir(), "sonar-host-"));
    const file = join(root, "host");
    await writeFile(file, "https://sonar.example.test\n");
    for (const env of [
      {},
      {
        SONAR_HOST_URL: "https://sonar.example.test",
        SONAR_HOST_URL_FILE: file,
      },
    ]) {
      const error = await sonar
        .loadHost(env)
        .catch((caught: unknown) => caught);
      expect((error as Error).message).toBe(
        "Select exactly one analysis host mode",
      );
    }
  });
  it("BR-145 host file accepts one terminal LF/CRLF only", async () => {
    const root = await mkdtemp(join(tmpdir(), "sonar-host-file-"));
    const file = join(root, "host");
    for (const suffix of ["", "\n", "\r\n"]) {
      await writeFile(file, `https://sonar.example.test${suffix}`);
      expect(await sonar.loadHost({ SONAR_HOST_URL_FILE: file })).toEqual(host);
    }
    for (const value of ["https://sonar.example.test\n\n", "", "\n"]) {
      await writeFile(file, value);
      await expect(
        sonar.loadHost({ SONAR_HOST_URL_FILE: file }),
      ).rejects.toThrow();
    }
    await expect(
      sonar.loadHost({ SONAR_HOST_URL_FILE: join(root, "missing") }),
    ).rejects.toThrow("Analysis host file is unavailable or invalid");
  });
});

async function fakeScanner(body: string) {
  const root = await mkdtemp(join(tmpdir(), "scanner-host-"));
  const work = join(root, "work");
  const cache = join(root, "cache");
  await mkdir(work);
  await mkdir(cache);
  const executable = join(root, "scanner");
  await writeFile(executable, `#!/usr/bin/env node\n${body}\n`);
  await chmod(executable, 0o755);
  return { root, work, cache, executable };
}

describe("BR-146 host redaction", () => {
  it("BR-146 redacts the host across chunks and streams", async () => {
    const f = await fakeScanner(
      `const fs=require('fs');fs.writeFileSync(process.argv[1]+'.env',process.env.SONAR_HOST_URL);const h=process.env.SONAR_HOST_URL.slice(8);process.stdout.write('whole '+h+' upper '+h.toUpperCase()+' split '+h.slice(0,6));setTimeout(()=>{process.stdout.write(h.slice(6)+' cross '+h.slice(0,9));setTimeout(()=>{process.stderr.write(h.slice(9)+' tail '+h.slice(0,4));process.exitCode=23;},10);},10);`,
    );
    const logs: string[] = [];
    const result = await sonar.scanOfficial({
      ...f,
      token,
      host,
      commit: sha,
      runId: "00000000-0000-4000-8000-000000000000",
      signal: new AbortController().signal,
      log: (text) => logs.push(text),
    });
    expect(result.code).toBe(23);
    const output = logs.join("");
    expect(output).toContain("[REDACTED]");
    expect(output.toLowerCase()).not.toContain("sonar.example.test");
    expect(output).toBe(
      "whole [REDACTED] upper [REDACTED] split [REDACTED] cross [REDACTED] tail [REDACTED]",
    );
    expect(await readFile(`${f.executable}.env`, "utf8")).toBe(host.url);
  });
  it("BR-146 fixed messages never contain the host", async () => {
    const logs: string[] = [];
    for (const change of [
      { enabled: "false" },
      { snapshot: { ...snapshot, branch: "feature" } },
      { scan: () => Promise.resolve({ code: 0, metadata: "" }) },
      {
        scan: () =>
          Promise.reject(
            new Error(`failed at ${host.url} for SONAR.example.TEST`),
          ),
      },
    ])
      expect(
        await sonar.runAnalysis({
          enabled: "true",
          token,
          host,
          mode: "main",
          snapshot,
          verifySnapshot: () => Promise.resolve(),
          scan: () => Promise.resolve({ code: 0, metadata: report }),
          log: (text) => logs.push(text),
          ...change,
        }),
      ).toBe(1);
    expect(logs.join("").toLowerCase()).not.toContain("sonar.example.test");
    for (const value of [
      "https://SONAR.example.test",
      "http://sonar.example.test",
    ]) {
      const error = await sonar
        .loadHost({ SONAR_HOST_URL: value })
        .catch((caught: unknown) => caught);
      expect((error as Error).message.toLowerCase()).not.toContain(
        "sonar.example.test",
      );
    }
  });
});

describe("BR-148 PR analysis targets only the PR project", () => {
  it("BR-148 PR mode targets only the PR project", async () => {
    const f = await fakeScanner(
      `const fs=require('fs'); const args=process.argv.slice(2); fs.writeFileSync(process.argv[1]+'.args',JSON.stringify(args)); const report=args.find(a=>a.startsWith('-Dsonar.scanner.metadataFilePath=')).split('=').slice(1).join('=');fs.writeFileSync(report,${JSON.stringify(prReport)});`,
    );
    const result = await sonar.scanOfficial({
      ...f,
      token,
      host,
      mode: "pr",
      commit: sha,
      runId: "00000000-0000-4000-8000-000000000001",
      signal: new AbortController().signal,
      log: () => undefined,
    });
    expect(result).toEqual({ code: 0, metadata: prReport });
    const args = JSON.parse(
      await readFile(`${f.executable}.args`, "utf8"),
    ) as string[];
    expect(args).toContain("-Dsonar.projectKey=kdrive-mcp-server-pr");
    expect(args.join(" ")).not.toMatch(/sonar\.(branch|pullrequest)\./u);
    const run = (metadata: string) =>
      sonar.runAnalysis({
        enabled: "true",
        token,
        host,
        mode: "pr",
        snapshot: prSnapshot,
        verifySnapshot: () => Promise.resolve(),
        scan: () => Promise.resolve({ code: 0, metadata }),
        log: () => undefined,
      });
    expect(await run(prReport)).toBe(0);
    expect(await run(report)).toBe(1);
    expect(
      await run(prReport.replace("sonar.example.test", "other.example.test")),
    ).toBe(1);
  });
  it("BR-148 preserves a failed PR gate exit code", async () => {
    expect(
      await sonar.runAnalysis({
        enabled: "true",
        token,
        host,
        mode: "pr",
        snapshot: prSnapshot,
        verifySnapshot: () => Promise.resolve(),
        scan: () => Promise.resolve({ code: 3, metadata: "" }),
        log: () => undefined,
      }),
    ).toBe(3);
  });
  it.each([
    ["pr", { ...prSnapshot, event: "push" }],
    ["main", { ...snapshot, event: "pull_request" }],
  ] as const)(
    "BR-150 mode mismatch with the manifest event fails before the scanner (%s)",
    async (mode, manifest) => {
      let scans = 0;
      const logs: string[] = [];
      expect(
        await sonar.runAnalysis({
          enabled: "true",
          token,
          host,
          mode,
          snapshot: manifest,
          verifySnapshot: () => Promise.resolve(),
          scan: () => {
            scans++;
            return Promise.resolve({ code: 0, metadata: report });
          },
          log: (text) => logs.push(text),
        }),
      ).toBe(1);
      expect(scans).toBe(0);
      expect(logs.join("")).toContain(
        "Analysis mode does not match the snapshot event",
      );
    },
  );
  it("BR-150 accepts only the fixed main and pr modes", () => {
    expect(sonar.analysisMode("main")).toBe("main");
    expect(sonar.analysisMode("pr")).toBe("pr");
    for (const value of [undefined, "", "PR", "pull_request"])
      expect(() => sonar.analysisMode(value)).toThrow("Invalid analysis mode");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmod,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  qualityFilter,
  readTaskMetadata,
  runAnalysis,
  scanOfficial,
  type AnalysisHost,
  type AnalysisOptions,
  type MetadataFiles,
} from "../scripts/sonar.js";

// F-022: Quality Gate failure summary. No network: every request goes to an
// injected fake fetch.
const token = "SYNTHETIC_SUMMARY_TOKEN_NOT_A_CREDENTIAL";
const sha = "a".repeat(40);
const KEY = "kdrive-mcp-server";
const host: AnalysisHost = {
  url: "https://sonar.example.test",
  hostname: "sonar.example.test",
};
const NO_METADATA =
  "Quality Gate summary unavailable: no verified task metadata.";
const TIME_LIMIT = "Quality Gate summary unavailable: time limit reached.";
const INTERNAL = "Quality Gate summary unavailable: internal error.";
const TASK_FAILED = "Quality Gate summary unavailable: task stage failed.";
const ISSUES_HEADER = `Quality Gate issues: current open issues of ${KEY} (may include another analysis of this project).`;
const RAW = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

function metadata(server = host.url, task = "task-1", key = KEY): string {
  return `projectKey=${key}\nserverUrl=${server}\nceTaskId=${task}\n`;
}
type Answer =
  | Response
  | Error
  | "hang"
  | (() => Response)
  | { after: number; response: Response };
interface Call {
  url: URL;
  init: RequestInit;
  signal: AbortSignal;
  previousAborted: boolean;
}
function fakeFetch(answers: Answer[]) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const signal = init.signal ?? new AbortController().signal;
    calls.push({
      url: new URL(input instanceof Request ? input.url : String(input)),
      init,
      signal,
      previousAborted: calls.every((call) => call.signal.aborted),
    });
    const answer = answers.shift() ?? "hang";
    if (answer === "hang")
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    if (answer instanceof Error) return Promise.reject(answer);
    if (typeof answer === "function") return Promise.resolve(answer());
    if ("after" in answer)
      return new Promise<Response>((resolve) =>
        setTimeout(() => {
          resolve(answer.response);
        }, answer.after),
      );
    return Promise.resolve(answer);
  };
  return { fetch, calls };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}
const successTask = () =>
  json({ task: { status: "SUCCESS", analysisId: "analysis-1" } });
function condition(
  metricKey: string,
  status = "ERROR",
  extra: Record<string, unknown> = {},
) {
  return {
    status,
    metricKey,
    comparator: "GT",
    errorThreshold: "1",
    actualValue: "2",
    ...extra,
  };
}
function gate(conditions: unknown[]) {
  return json({ projectStatus: { status: "ERROR", conditions } });
}
function issue(n: number, extra: Record<string, unknown> = {}) {
  return {
    rule: "typescript:S1",
    component: `${KEY}:src/f${n}.ts`,
    message: `m${n}`,
    severity: "MAJOR",
    type: "CODE_SMELL",
    line: n,
    ...extra,
  };
}
interface RunInput {
  code?: number;
  meta?: string;
  answers?: Answer[];
  timeoutMs?: number;
  analysisHost?: AnalysisHost;
  log?: (logs: string[], line: string) => void;
}
function start(input: RunInput = {}) {
  const logs: string[] = [];
  const fake = fakeFetch(input.answers ?? []);
  const options: AnalysisOptions = {
    token,
    enabled: "true",
    host: input.analysisHost ?? host,
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
    scan: () =>
      Promise.resolve({
        code: input.code ?? 2,
        metadata: input.meta ?? metadata(input.analysisHost?.url),
      }),
    log: (line) => {
      if (input.log) input.log(logs, line);
      else logs.push(line);
    },
    timeoutMs: input.timeoutMs ?? 900_000,
    fetch: fake.fetch,
  };
  const lines = () =>
    logs
      .join("")
      .split("\n")
      .filter((line) => line !== "");
  return { promise: runAnalysis(options), logs, lines, calls: fake.calls };
}
async function run(input: RunInput = {}) {
  const started = start(input);
  const code = await started.promise;
  return { ...started, code };
}
async function issueLines(body: unknown) {
  const result = await run({
    answers: [successTask(), gate([condition("coverage")]), json(body)],
  });
  const lines = result.lines();
  return lines.slice(lines.indexOf(ISSUES_HEADER));
}
const SCAN_ID = "00000000-0000-4000-8000-000000000000";
async function scanWith(action: string) {
  const root = await mkdtemp(join(tmpdir(), "summary-scan-"));
  const work = join(root, "work");
  const cache = join(root, "cache");
  await mkdir(work);
  await mkdir(cache);
  const valid = join(root, "valid.txt");
  await writeFile(valid, metadata());
  const executable = join(root, "scanner");
  await writeFile(
    executable,
    `#!/usr/bin/env node\nconst fs=require('fs');const report=process.argv.slice(2).find(a=>a.startsWith('-Dsonar.scanner.metadataFilePath=')).split('=').slice(1).join('=');const valid=${JSON.stringify(valid)};${action}\nprocess.exit(2);\n`,
  );
  await chmod(executable, 0o755);
  return scanOfficial({
    root,
    work,
    cache,
    executable,
    token,
    host,
    commit: sha,
    runId: SCAN_ID,
    signal: new AbortController().signal,
    log: () => undefined,
  });
}
function fakeFiles(content: string, size = 100) {
  const flags: number[] = [];
  const data = Buffer.from(content);
  let position = 0;
  const stat = () => Promise.resolve({ isFile: () => true, size });
  const files: MetadataFiles = {
    lstat: stat,
    open: (_path, flag) => {
      flags.push(flag);
      return Promise.resolve({
        stat,
        read: (buffer: Uint8Array, offset: number, length: number) => {
          const chunk = data.subarray(position, position + length);
          buffer.set(chunk, offset);
          position += chunk.length;
          return Promise.resolve({ bytesRead: chunk.length });
        },
        close: () => Promise.resolve(),
      });
    },
  };
  return { files, flags };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("F-022 Quality Gate failure summary", () => {
  it("BR-328 no summary on a passing gate", async () => {
    const result = await run({ code: 0 });
    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(0);
    expect(result.logs.join("")).not.toContain("Quality Gate summary");
  });

  it("BR-328 summary on nonzero exit", async () => {
    const result = await run({
      code: 2,
      answers: [json({ task: { status: "PENDING" } })],
    });
    expect(result.code).toBe(2);
    expect(result.calls).toHaveLength(1);
    expect(result.lines()).toEqual([TASK_FAILED]);
  });

  it("BR-329 unverified metadata", async () => {
    const big = `${metadata()}#${"x".repeat(65_536)}\n`;
    const [missing, oversized, symlink, directory, valid] = await Promise.all([
      scanWith(""),
      scanWith(`fs.writeFileSync(report, ${JSON.stringify(big)});`),
      scanWith("fs.symlinkSync(valid, report);"),
      scanWith("fs.mkdirSync(report);"),
      scanWith("fs.copyFileSync(valid, report);"),
    ]);
    const scanned = { missing, oversized, symlink, directory, valid };
    // Positive control: a regular file is read on a nonzero exit too.
    expect(scanned.valid).toEqual({ code: 2, metadata: metadata() });
    const control = await run({
      meta: scanned.valid.metadata,
      answers: [json({ task: { status: "PENDING" } })],
    });
    expect(control.calls).toHaveLength(1);
    const reader = fakeFiles(`${metadata()}#`.padEnd(65_537, "x"));
    const overRead = await readTaskMetadata("/fixture/report", reader.files);
    expect(overRead).toBe("");
    expect((reader.flags[0] ?? 0) & constants.O_NOFOLLOW).toBe(
      constants.O_NOFOLLOW,
    );
    const atLimit = fakeFiles(`${metadata()}#`.padEnd(65_536, "x"));
    expect(await readTaskMetadata("/fixture/report", atLimit.files)).toContain(
      "ceTaskId=task-1",
    );
    const cases = [
      scanned.missing.metadata,
      scanned.oversized.metadata,
      scanned.symlink.metadata,
      scanned.directory.metadata,
      overRead,
      metadata(host.url, "task-1", "other-project"),
      metadata("https://other.example.test"),
      metadata(host.url, ""),
    ];
    for (const meta of cases) {
      const result = await run({ meta, answers: [successTask()] });
      expect(result.code).toBe(2);
      expect(result.lines()).toEqual([NO_METADATA]);
      expect(result.calls).toHaveLength(0);
    }
  });

  it("BR-334 conditions", async () => {
    const result = await run({
      answers: [
        successTask(),
        gate([
          condition("new_violations"),
          condition("coverage", "OK"),
          condition("new_coverage", "ERROR", {
            comparator: "LT",
            errorThreshold: "80",
            actualValue: "12.5",
          }),
        ]),
        json({ issues: [], paging: { total: 0 } }),
      ],
    });
    expect(result.code).toBe(2);
    expect(result.calls.map((call) => call.url.pathname)).toEqual([
      "/api/ce/task",
      "/api/qualitygates/project_status",
      "/api/issues/search",
    ]);
    expect(result.calls[1]?.url.searchParams.get("analysisId")).toBe(
      "analysis-1",
    );
    expect(result.lines()).toEqual([
      `Quality Gate summary: ${KEY} status ERROR`,
      "- condition new_violations GT 1: actual 2",
      "- condition new_coverage LT 80: actual 12.5",
      ISSUES_HEADER,
    ]);
  });

  it("BR-336 issues", async () => {
    const result = await run({
      answers: [
        successTask(),
        gate([
          condition("new_violations"),
          condition("coverage"),
          condition("duplicated_lines", "OK"),
        ]),
        json({ issues: [issue(1), issue(2), issue(3)], paging: { total: 25 } }),
      ],
    });
    expect(result.lines()).toEqual([
      `Quality Gate summary: ${KEY} status ERROR`,
      "- condition new_violations GT 1: actual 2",
      "- condition coverage GT 1: actual 2",
      ISSUES_HEADER,
      "- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts:1 m1",
      "- issue MAJOR CODE_SMELL typescript:S1 src/f2.ts:2 m2",
      "- issue MAJOR CODE_SMELL typescript:S1 src/f3.ts:3 m3",
      "- 22 more issues not shown",
    ]);
  });

  it("BR-330 incomplete task stops", async () => {
    const pending = await run({
      answers: [json({ task: { status: "PENDING" } }), successTask()],
    });
    expect(pending.lines()).toEqual([TASK_FAILED]);
    expect(pending.calls).toHaveLength(1);
    const noAnalysis = await run({
      answers: [json({ task: { status: "SUCCESS" } }), successTask()],
    });
    expect(noAnalysis.lines()).toEqual([
      "Quality Gate summary unavailable: task stage failed (unexpected response).",
    ]);
    expect(noAnalysis.calls).toHaveLength(1);
  });

  it("BR-331 request shape", async () => {
    for (const [url, prefix] of [
      ["https://sonar.example", ""],
      ["https://example.test/sonar", "/sonar"],
    ] as const) {
      const analysisHost = { url, hostname: new URL(url).hostname };
      const result = await run({
        analysisHost,
        meta: metadata(url, "a&b#c/d"),
        answers: [json({ task: { status: "PENDING" } })],
      });
      const call = result.calls[0];
      expect(call?.url.origin).toBe(new URL(url).origin);
      expect(call?.url.pathname).toBe(`${prefix}/api/ce/task`);
      expect(String(call?.url).startsWith(`${url}/api/ce/task?`)).toBe(true);
      expect([...(call?.url.searchParams.keys() ?? [])]).toEqual(["id"]);
      expect(call?.url.searchParams.get("id")).toBe("a&b#c/d");
      expect(call?.url.hash).toBe("");
      expect(call?.init.redirect).toBe("error");
      expect([...new Headers(call?.init.headers).entries()]).toEqual([
        [
          "authorization",
          "Basic " + Buffer.from(token + ":").toString("base64"),
        ],
      ]);
    }
  });

  it("BR-332 stage failures", async () => {
    const secretBody = `failure at ${host.url} with ${token}`;
    const cases: [Answer, string][] = [
      [
        new Response(secretBody, { status: 500 }),
        "Quality Gate summary unavailable: task stage failed (HTTP 500).",
      ],
      [
        new TypeError("fetch failed: redirect mode is set to error"),
        TASK_FAILED,
      ],
      [
        () => {
          throw new Error(secretBody);
        },
        TASK_FAILED,
      ],
      [new Response(`{"task": ${secretBody}`), TASK_FAILED],
      [
        json({ task: { status: 5 } }),
        "Quality Gate summary unavailable: task stage failed (unexpected response).",
      ],
    ];
    for (const [answer, line] of cases) {
      const result = await run({ answers: [answer] });
      expect(result.code).toBe(2);
      expect(result.lines()).toEqual([line]);
      const output = result.logs.join("");
      expect(output).not.toContain(token);
      expect(output.toLowerCase()).not.toContain(host.hostname);
      expect(output).not.toContain("api/");
      expect(output).not.toContain("failure at");
      expect(result.calls.every((call) => call.signal.aborted)).toBe(true);
    }

    // Streamed oversized body with a falsely small Content-Length.
    const chunk = 64 * 1024;
    let enqueued = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          enqueued += chunk;
          controller.enqueue(new Uint8Array(chunk).fill(32));
        },
        cancel() {
          cancelled = true;
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    );
    const oversized = await run({
      answers: [new Response(stream, { headers: { "content-length": "10" } })],
    });
    expect(oversized.lines()).toEqual([TASK_FAILED]);
    expect(cancelled).toBe(true);
    expect(enqueued).toBeLessThanOrEqual(1024 * 1024 + chunk);

    // Successful stages are aborted when they end, before a failing issues stage.
    const partial = await run({
      answers: [
        successTask(),
        gate([condition("coverage")]),
        json({ error: secretBody }, 500),
      ],
    });
    expect(partial.lines().at(-1)).toBe(
      "Quality Gate summary unavailable: issues stage failed (HTTP 500).",
    );
    expect(partial.calls.map((call) => call.previousAborted)).toEqual([
      true,
      true,
      true,
    ]);
    expect(partial.calls.every((call) => call.signal.aborted)).toBe(true);
    const success = await run({
      answers: [
        successTask(),
        gate([condition("coverage")]),
        json({ issues: [issue(1)] }),
      ],
    });
    expect(success.calls.map((call) => call.previousAborted)).toEqual([
      true,
      true,
      true,
    ]);
    expect(success.calls.every((call) => call.signal.aborted)).toBe(true);

    // A request that never resolves ends with its 15 s timer.
    vi.useFakeTimers();
    const hanging = start({ answers: ["hang"] });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(hanging.lines()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await hanging.promise).toBe(2);
    expect(hanging.lines()).toEqual([TASK_FAILED]);
    expect(hanging.calls[0]?.signal.aborted).toBe(true);
  });

  it("BR-332 endless body", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"task":'));
      },
      pull: () => new Promise<void>(() => undefined),
    });
    const result = start({ answers: [new Response(stream)] });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result.promise).toBe(2);
    expect(result.lines()).toEqual([TASK_FAILED]);
  });

  it("BR-333 degraded issues", async () => {
    for (const status of [403, 401]) {
      const result = await run({
        answers: [
          successTask(),
          gate([condition("coverage")]),
          json({ errors: [] }, status),
        ],
      });
      expect(result.lines()).toEqual([
        `Quality Gate summary: ${KEY} status ERROR`,
        "- condition coverage GT 1: actual 2",
        `Quality Gate issues unavailable (HTTP ${status}): the token may lack Browse permission on the project.`,
      ]);
    }
  });

  it("BR-333 issues HTTP 400", async () => {
    const result = await run({
      answers: [
        successTask(),
        gate([condition("coverage")]),
        json({ errors: [] }, 400),
      ],
    });
    expect(result.lines()).toEqual([
      `Quality Gate summary: ${KEY} status ERROR`,
      "- condition coverage GT 1: actual 2",
      "Quality Gate summary unavailable: issues stage failed (HTTP 400).",
    ]);
  });

  it("BR-335 issue query", async () => {
    const query = async (conditions: unknown[]) => {
      const result = await run({
        answers: [successTask(), gate(conditions), json({ issues: [] })],
      });
      return result;
    };
    const newOnly = await query([
      condition("new_violations"),
      condition("new_coverage"),
      condition("coverage", "OK"),
    ]);
    const mixed = await query([
      condition("new_reliability_rating"),
      condition("coverage"),
    ]);
    const base = {
      componentKeys: KEY,
      resolved: "false",
      s: "SEVERITY",
      asc: "false",
      ps: "20",
    };
    expect(
      Object.fromEntries(newOnly.calls[2]?.url.searchParams ?? []),
    ).toEqual({ ...base, inNewCodePeriod: "true" });
    expect(Object.fromEntries(mixed.calls[2]?.url.searchParams ?? [])).toEqual(
      base,
    );
    const passing = await query([condition("coverage", "OK")]);
    expect(passing.calls).toHaveLength(2);
    expect(passing.lines()).toEqual([
      `Quality Gate summary: ${KEY} status ERROR`,
    ]);
  });

  it("BR-335 v2 quality filter", async () => {
    const base = {
      componentKeys: KEY,
      resolved: "false",
      s: "SEVERITY",
      asc: "false",
      ps: "20",
    };
    const cases: [string[], Record<string, string>][] = [
      [
        ["software_quality_reliability_rating"],
        { impactSoftwareQualities: "RELIABILITY" },
      ],
      [
        [
          "new_software_quality_security_rating",
          "software_quality_reliability_rating",
        ],
        { impactSoftwareQualities: "RELIABILITY,SECURITY" },
      ],
      [["new_reliability_rating", "bugs"], { types: "BUG" }],
      [
        ["sqale_rating", "security_rating"],
        { types: "CODE_SMELL,VULNERABILITY" },
      ],
      [["software_quality_reliability_rating", "coverage"], {}],
      [["reliability_rating", "software_quality_reliability_rating"], {}],
      [["security_hotspots_reviewed"], {}],
      [
        ["new_reliability_rating", "new_bugs"],
        { types: "BUG", inNewCodePeriod: "true" },
      ],
      [
        ["new_maintainability_rating", "new_reliability_rating"],
        { types: "BUG,CODE_SMELL", inNewCodePeriod: "true" },
      ],
    ];
    for (const [metrics, extra] of cases) {
      const result = await run({
        answers: [
          successTask(),
          gate(metrics.map((metric) => condition(metric))),
          json({ issues: [] }),
        ],
      });
      expect(
        Object.fromEntries(result.calls[2]?.url.searchParams ?? []),
      ).toEqual({ ...base, ...extra });
    }
  });

  it.each([
    [
      "software_quality_maintainability_rating",
      "impactSoftwareQualities",
      "MAINTAINABILITY",
    ],
    [
      "new_software_quality_maintainability_debt_ratio",
      "impactSoftwareQualities",
      "MAINTAINABILITY",
    ],
    [
      "new_software_quality_security_rating",
      "impactSoftwareQualities",
      "SECURITY",
    ],
    ["reliability_remediation_effort", "types", "BUG"],
    ["new_bugs", "types", "BUG"],
    ["security_rating", "types", "VULNERABILITY"],
    ["security_remediation_effort", "types", "VULNERABILITY"],
    ["new_vulnerabilities", "types", "VULNERABILITY"],
    ["maintainability_rating", "types", "CODE_SMELL"],
    ["new_technical_debt", "types", "CODE_SMELL"],
    ["code_smells", "types", "CODE_SMELL"],
    ["sqale_index", "types", "CODE_SMELL"],
    ["new_sqale_debt_ratio", "types", "CODE_SMELL"],
  ])("BR-335 v2 quality mapping %s", (metric, name, value) => {
    expect(qualityFilter([metric])).toEqual({ [name]: value });
  });

  it.each([
    ["coverage"],
    ["security_review_rating"],
    ["new_duplicated_lines_density"],
    [""],
  ])("BR-335 v2 unmapped metric %s", (metric) => {
    expect(qualityFilter([metric])).toEqual({});
  });

  it("BR-336 issue fields", async () => {
    expect(
      await issueLines({ issues: [issue(1, { line: undefined })], total: 1 }),
    ).toEqual([
      ISSUES_HEADER,
      "- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts m1",
    ]);
    expect(
      await issueLines({
        issues: [issue(1), issue(2, { component: "other-project:src/x.ts" })],
      }),
    ).toEqual([
      ISSUES_HEADER,
      "- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts:1 m1",
    ]);
    const mixedProjects = Array.from({ length: 25 }, (_value, index) =>
      issue(index + 1, index < 5 ? { component: `${KEY}-pr:src/a.ts` } : {}),
    );
    const filtered = await issueLines({ issues: mixedProjects });
    expect(filtered).toHaveLength(21);
    expect(filtered.at(1)).toBe(
      "- issue MAJOR CODE_SMELL typescript:S1 src/f6.ts:6 m6",
    );
    const noType = { severity: undefined, type: undefined };
    expect(
      await issueLines({
        issues: [
          issue(1, {
            ...noType,
            impacts: [
              { softwareQuality: "MAINTAINABILITY", severity: "HIGH" },
              { softwareQuality: "RELIABILITY", severity: "LOW" },
            ],
          }),
          issue(2, noType),
          issue(3, {
            ...noType,
            impacts: ["A", "B", "C", "D", "E"].map((quality) => ({
              softwareQuality: quality,
              severity: "LOW",
            })),
          }),
          issue(4, {
            ...noType,
            impacts: [{ softwareQuality: 1, severity: null }],
          }),
          issue(5, { line: 0 }),
        ],
      }),
    ).toEqual([
      ISSUES_HEADER,
      "- issue MAINTAINABILITY:HIGH,RELIABILITY:LOW typescript:S1 src/f1.ts:1 m1",
      "- issue - typescript:S1 src/f2.ts:2 m2",
      "- issue A:LOW,B:LOW,C:LOW typescript:S1 src/f3.ts:3 m3",
      "- issue - typescript:S1 src/f4.ts:4 m4",
      "- issue MAJOR CODE_SMELL typescript:S1 src/f5.ts m5",
    ]);
    expect(
      (await issueLines({ issues: [issue(1)], paging: { total: 4 } })).at(-1),
    ).toBe("- 3 more issues not shown");
    expect((await issueLines({ issues: [issue(1)], total: 6 })).at(-1)).toBe(
      "- 5 more issues not shown",
    );
    expect(
      (
        await issueLines({
          issues: [issue(1)],
          paging: { total: "5" },
          total: 7,
        })
      ).at(-1),
    ).toBe("- 6 more issues not shown");
    expect(
      (await issueLines({ issues: [issue(1)], paging: { total: -1 } })).at(-1),
    ).toBe("- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts:1 m1");
    expect(await issueLines({ issues: [], paging: { total: 0 } })).toEqual([
      ISSUES_HEADER,
    ]);
  });

  it("BR-337 sanitization", async () => {
    const message =
      "a\u007Fb\u202Ec\u2028d\u0085e\nf\u001Bg\uFEFFh\uD800i\u{E0001}j\\u202Ek SONAR.Example.TEST " +
      token;
    const lines = await issueLines({ issues: [issue(1, { message })] });
    expect(lines[1]).toBe(
      "- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts:1 " +
        "a\\u007Fb\\u202Ec\\u2028d\\u0085e\\u000Af\\u001Bg\\uFEFFh\\uD800i\\u{E0001}j\\\\u202Ek [REDACTED] [REDACTED]",
    );
    for (const line of lines) expect(line).not.toMatch(RAW);
    const long = "\u{1F600}".repeat(250);
    const cut = await issueLines({ issues: [issue(1, { message: long })] });
    expect(cut[1]).toBe(
      `- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts:1 ${"\u{1F600}".repeat(200)}`,
    );
  });

  it("BR-337 truncation boundaries", async () => {
    const prefix = "- issue MAJOR CODE_SMELL typescript:S1 src/f1.ts:1 ";
    const inToken = await issueLines({
      issues: [issue(1, { message: `${"x".repeat(195)}${token}tail` })],
    });
    expect(inToken[1]).toBe(`${prefix}${"x".repeat(195)}`);
    const inEscape = await issueLines({
      issues: [issue(1, { message: `${"x".repeat(198)}\u202Ey` })],
    });
    expect(inEscape[1]).toBe(`${prefix}${"x".repeat(198)}`);
    const fits = await issueLines({
      issues: [issue(1, { message: `${"x".repeat(190)}${token}` })],
    });
    expect(fits[1]).toBe(`${prefix}${"x".repeat(190)}[REDACTED]`);
    for (const lines of [inToken, inEscape, fits])
      expect(
        (lines[1] ?? "").slice(prefix.length).match(/[\s\S]/gu)?.length,
      ).toBeLessThanOrEqual(200);
  });

  it("BR-146 v2 summary redaction", async () => {
    const mixedHost = "Sonar.EXAMPLE.test";
    const result = await run({
      answers: [
        successTask(),
        json({
          projectStatus: {
            status: `ERROR ${token}`,
            conditions: [
              condition(`metric_${mixedHost}`, "ERROR", {
                comparator: token,
                actualValue: `${mixedHost}/x`,
              }),
            ],
          },
        }),
        json({
          issues: [
            issue(1, { rule: `rule:${token}`, message: `see ${mixedHost}` }),
          ],
        }),
      ],
    });
    const output = result.logs.join("");
    expect(output).not.toContain(token);
    expect(output.toLowerCase()).not.toContain(host.hostname);
    expect(result.lines()).toEqual([
      `Quality Gate summary: ${KEY} status ERROR [REDACTED]`,
      "- condition metric_[REDACTED] [REDACTED] 1: actual [REDACTED]/x",
      ISSUES_HEADER,
      "- issue MAJOR CODE_SMELL rule:[REDACTED] src/f1.ts:1 see [REDACTED]",
    ]);
  });

  it("BR-334 caps", async () => {
    const conditions = Array.from({ length: 21 }, (_value, index) =>
      condition(`metric_${index + 1}`),
    );
    conditions[0] = condition("metric_1", "ERROR", { comparator: undefined });
    const result = await run({
      answers: [successTask(), gate(conditions), json({ issues: [] })],
    });
    const lines = result.lines();
    expect(lines.filter((line) => line.startsWith("- condition"))).toHaveLength(
      20,
    );
    expect(lines[1]).toBe("- condition metric_1 - 1: actual 2");
    expect(lines[21]).toBe("- 1 more conditions not shown");
  });

  it("BR-336 caps", async () => {
    const issues = Array.from({ length: 25 }, (_value, index) =>
      issue(index + 1),
    );
    issues[0] = issue(1, { rule: "r".repeat(150) });
    const lines = await issueLines({ issues, paging: { total: 25 } });
    expect(lines.filter((line) => line.startsWith("- issue"))).toHaveLength(20);
    expect(lines[1]).toBe(
      `- issue MAJOR CODE_SMELL ${"r".repeat(100)} src/f1.ts:1 m1`,
    );
    expect(lines.at(-1)).toBe("- 5 more issues not shown");
  });

  it("BR-338 exit code preserved", async () => {
    let first = true;
    const failingSink = await run({
      code: 3,
      answers: [json({ task: { status: "PENDING" } })],
      log: (logs, line) => {
        if (first) {
          first = false;
          throw new Error("sink failure");
        }
        logs.push(line);
      },
    });
    expect(failingSink.code).toBe(3);
    expect(failingSink.lines()).toEqual([INTERNAL]);
    vi.useFakeTimers();
    const late = start({ code: 3, timeoutMs: 12_000, answers: ["hang"] });
    await vi.advanceTimersByTimeAsync(6_999);
    expect(late.lines()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await late.promise).toBe(3);
    expect(late.lines()).toEqual([TIME_LIMIT]);
  });

  it("BR-338 deadline during summary", async () => {
    vi.useFakeTimers();
    const pending = start({
      code: 2,
      timeoutMs: 30_000,
      answers: [{ after: 12_000, response: successTask() }, "hang"],
    });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(pending.lines()).toEqual([]);
    expect(pending.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending.promise).toBe(2);
    expect(pending.lines()).toEqual([TIME_LIMIT]);
    vi.useRealTimers();
    const expired = await run({ timeoutMs: 4_000, answers: [successTask()] });
    expect(expired.code).toBe(2);
    expect(expired.lines()).toEqual([TIME_LIMIT]);
    expect(expired.calls).toHaveLength(0);
    const unverified = await run({
      timeoutMs: 4_000,
      meta: "",
      answers: [successTask()],
    });
    expect(unverified.lines()).toEqual([NO_METADATA]);
    expect(unverified.calls).toHaveLength(0);
  });

  it("BR-340 development docs", async () => {
    const docs = await readFile("docs/development.md", "utf8");
    const begin = docs.indexOf("## Conditional remote analysis");
    const end = docs.indexOf("\n## ", begin + 1);
    const section = docs.slice(begin, end);
    expect(begin).toBeGreaterThanOrEqual(0);
    for (const text of [
      "Quality Gate summary: ",
      "- condition ",
      "Quality Gate issues: current open issues of",
      "- issue ",
      "more issues not shown",
      "Quality Gate summary unavailable: ",
      "Quality Gate issues unavailable (HTTP",
      "the token may lack Browse permission on the project.",
      "user token",
      "no code change",
      "kdrive-mcp-server-pr",
      "another pull request",
    ])
      expect(section).toContain(text);
  });
});

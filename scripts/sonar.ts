import { spawn } from "node:child_process";
import {
  readFile,
  readdir,
  lstat,
  open,
  access,
  constants,
  mkdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { verifyCoverage } from "./coverage.ts";
import { withinDeadline, killGroup } from "./deadline.ts";

// BR-014 v2: the host is never a constant; it comes from SONAR_HOST_URL.
export const PROJECT = "kdrive-mcp-server";
export const PR_PROJECT = "kdrive-mcp-server-pr";
const REPOSITORY = "sstolz/kdrive-mcp-server";
const REPOSITORY_URLS = [
  "https://github.com/sstolz/kdrive-mcp-server",
  "https://github.com/sstolz/kdrive-mcp-server.git",
];
export type AnalysisMode = "main" | "pr";
export interface AnalysisHost {
  url: string;
  hostname: string;
}
export interface MainSnapshot {
  branch: string;
  commit: string;
  trustedMain: string;
  clean: boolean;
  repository: string;
  event: string;
  ref?: string;
  headRepository?: string;
  baseRef?: string;
}
export interface ScanResult {
  code: number;
  metadata: string;
}
export interface AnalysisOptions {
  enabled?: string;
  token?: string;
  host: AnalysisHost;
  mode: AnalysisMode;
  snapshot: MainSnapshot;
  verifySnapshot: (signal: AbortSignal) => Promise<void>;
  scan: (signal: AbortSignal) => Promise<ScanResult>;
  log: (message: string) => void;
  timeoutMs?: number;
  // F-022: injectable for tests; the summary is the only caller.
  fetch?: typeof globalThis.fetch;
}
export function verifyMain(snapshot: MainSnapshot) {
  if (
    snapshot.branch !== "main" ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- F-011: the manifest is runtime JSON; only the boolean true is clean
    snapshot.clean !== true ||
    !/^[a-f0-9]{40}$/.test(snapshot.commit) ||
    snapshot.commit !== snapshot.trustedMain ||
    !REPOSITORY_URLS.includes(snapshot.repository) ||
    !["local", "push", "workflow_dispatch"].includes(snapshot.event)
  )
    throw new Error("Trusted clean main is required");
}
// BR-148: a clean same-repository pull-request merge commit into main.
export function verifyPullRequest(snapshot: MainSnapshot) {
  if (
    snapshot.event !== "pull_request" ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- F-011: the manifest is runtime JSON; only the boolean true is clean
    snapshot.clean !== true ||
    !/^[a-f0-9]{40}$/.test(snapshot.commit) ||
    snapshot.commit !== snapshot.trustedMain ||
    !REPOSITORY_URLS.includes(snapshot.repository) ||
    !/^refs\/pull\/[1-9]\d*\/merge$/.test(snapshot.ref ?? "") ||
    snapshot.headRepository !== REPOSITORY ||
    snapshot.baseRef !== "main"
  )
    throw new Error("Trusted same-repository pull request is required");
}
export function analysisMode(value: string | undefined): AnalysisMode {
  if (value === "main" || value === "pr") return value;
  throw new Error("Invalid analysis mode");
}
export function projectFor(mode: AnalysisMode): string {
  return mode === "pr" ? PR_PROJECT : PROJECT;
}
function validToken(token: string) {
  if (!token.trim() || /[\r\n\0]/.test(token))
    throw new Error("Invalid analysis token");
  return token;
}
export async function loadToken(env: NodeJS.ProcessEnv): Promise<string> {
  const environment = env.SONAR_TOKEN !== undefined;
  const file = env.SONAR_TOKEN_FILE !== undefined;
  if (environment === file)
    throw new Error("Select exactly one analysis credential mode");
  if (environment) return validToken(env.SONAR_TOKEN ?? "");
  try {
    return validToken(
      (await readFile(env.SONAR_TOKEN_FILE ?? "", "utf8")).replace(
        /\r?\n$/,
        "",
      ),
    );
  } catch {
    throw new Error("Analysis token file is unavailable or invalid");
  }
}
// BR-145: canonical absolute https URL; every rejection is a fixed message.
export function validHost(value: string): AnalysisHost {
  let url: URL | undefined;
  try {
    if (!/[\s\u0000-\u0008\u000e-\u001f\u007f]/u.test(value))
      url = new URL(value);
  } catch {
    url = undefined;
  }
  if (
    url?.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    (url.href !== value && url.href !== `${value}/`)
  )
    throw new Error("Invalid analysis host");
  return { url: value, hostname: url.hostname };
}
export async function loadHost(env: NodeJS.ProcessEnv): Promise<AnalysisHost> {
  const environment = env.SONAR_HOST_URL !== undefined;
  const file = env.SONAR_HOST_URL_FILE !== undefined;
  if (environment === file)
    throw new Error("Select exactly one analysis host mode");
  if (environment) return validHost(env.SONAR_HOST_URL ?? "");
  let text: string;
  try {
    text = await readFile(env.SONAR_HOST_URL_FILE ?? "", "utf8");
  } catch {
    throw new Error("Analysis host file is unavailable or invalid");
  }
  return validHost(text.replace(/\r?\n$/, ""));
}
// ASCII-only folding keeps string lengths, so positions map back exactly.
function fold(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
function replaceAll(text: string, needle: string, folded: boolean): string {
  if (!needle) return text;
  const haystack = folded ? fold(text) : text;
  const target = folded ? fold(needle) : needle;
  let result = "";
  let start = 0;
  let index: number;
  while ((index = haystack.indexOf(target, start)) >= 0) {
    result += text.slice(start, index) + "[REDACTED]";
    start = index + target.length;
  }
  return result + text.slice(start);
}
export function redact(text: string, token: string, hostname = ""): string {
  return replaceAll(replaceAll(text, token, false), hostname, true);
}
export interface OutputEvent {
  stream: number;
  text: string;
}
interface Segment extends OutputEvent {
  offset: number;
  viewOffset: number;
}
interface Needle {
  value: string;
  folded: boolean;
}
interface Marks {
  hidden: Uint8Array;
  replacement: Uint8Array;
}
// Mark original positions behind a [start, end) range of one stream view.
function markRange(
  segments: Segment[],
  marks: Marks,
  start: number,
  end: number,
) {
  let first = true;
  for (const segment of segments) {
    if (segment.viewOffset >= end) break;
    const segmentEnd = segment.viewOffset + segment.text.length;
    if (segmentEnd <= start) continue;
    const from =
      Math.max(start, segment.viewOffset) - segment.viewOffset + segment.offset;
    const to = Math.min(end, segmentEnd) - segment.viewOffset + segment.offset;
    if (from < to) {
      marks.hidden.fill(1, from, to);
      if (first) marks.replacement[from] = 1;
      first = false;
    }
  }
}
function markNeedle(segments: Segment[], marks: Marks, needle: Needle) {
  const view = segments.map((segment) => segment.text).join("");
  const text = needle.folded ? fold(view) : view;
  let next = 0;
  let index: number;
  while ((index = text.indexOf(needle.value, next)) >= 0) {
    markRange(segments, marks, index, index + needle.value.length);
    next = index + needle.value.length;
  }
  // EOF, signal and output-cap truncation cannot release a pending prefix.
  let partial = Math.min(needle.value.length - 1, text.length - next);
  while (partial && !needle.value.startsWith(text.slice(-partial))) partial--;
  if (partial) markRange(segments, marks, text.length - partial, text.length);
}
// Inspect both canonical streams and the observed arrival order before emitting
// anything. Map secret characters back to their original positions so unrelated
// interleaved diagnostics retain their exact text and order. The token matches
// exactly; the host name matches ASCII case-insensitively (BR-146).
export function redactCaptured(
  events: OutputEvent[],
  token: string,
  hostname = "",
): string {
  validToken(token);
  let offset = 0;
  const positioned = events.map((event) => {
    const item = { ...event, offset };
    offset += event.text.length;
    return item;
  });
  const original = events.map((event) => event.text).join("");
  const marks: Marks = {
    hidden: new Uint8Array(original.length),
    replacement: new Uint8Array(original.length),
  };
  const needles: Needle[] = [
    { value: token, folded: false },
    { value: fold(hostname), folded: true },
  ].filter((needle) => needle.value);
  for (const selected of [
    positioned,
    positioned.filter((event) => event.stream === 0),
    positioned.filter((event) => event.stream === 1),
  ]) {
    let viewOffset = 0;
    const segments: Segment[] = selected.map((event) => {
      const segment = { ...event, viewOffset };
      viewOffset += event.text.length;
      return segment;
    });
    for (const needle of needles) markNeedle(segments, marks, needle);
  }
  const result: string[] = [];
  let safeStart = 0;
  for (let index = 0; index < original.length; index++) {
    if (!marks.hidden[index]) continue;
    if (safeStart < index) result.push(original.slice(safeStart, index));
    if (marks.replacement[index]) result.push("[REDACTED]");
    safeStart = index + 1;
  }
  result.push(original.slice(safeStart));
  return result.join("");
}
function properties(text: string) {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([\w.]+)=(.*)$/.exec(line);
    if (!match?.[1] || match[2] === undefined || result.has(match[1]))
      throw new Error("Invalid or duplicate scanner property");
    result.set(match[1], match[2]);
  }
  return result;
}
// BR-147: no host property; the analysed set is exactly src/ and tests/.
export function verifyProperties(text: string) {
  const expected: Record<string, string> = {
    "sonar.projectKey": PROJECT,
    "sonar.sources": "src",
    "sonar.tests": "tests",
    "sonar.sourceEncoding": "UTF-8",
    "sonar.javascript.lcov.reportPaths": "coverage/lcov.info",
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- F-011: /tmp is the analysis container's private tmpfs
    "sonar.working.directory": "/tmp/.scannerwork/analysis",
    "sonar.qualitygate.wait": "true",
    "sonar.qualitygate.timeout": "300",
    "sonar.verbose": "false",
  };
  const actual = properties(text);
  if (
    actual.size !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => actual.get(key) !== value)
  )
    throw new Error(
      "Scanner properties differ from the reviewed target and gate contract",
    );
}
// BR-147: fail before upload when an analysed file names the configured host.
export async function verifyAnalysedSet(
  root: string,
  hostname: string,
): Promise<void> {
  const target = fold(hostname);
  async function visit(path: string): Promise<void> {
    const stat = await lstat(join(root, path)).catch(() => undefined);
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const name of await readdir(join(root, path)))
        await visit(join(path, name));
      return;
    }
    if (!stat.isFile()) return;
    const text = fold((await readFile(join(root, path))).toString("latin1"));
    if (target && text.includes(target))
      throw new Error("Analysed sources contain the configured analysis host");
  }
  for (const path of ["src", "tests", "sonar-project.properties"])
    await visit(path);
}
function withoutSlash(value: string | undefined): string {
  return (value ?? "").replace(/\/$/u, "");
}
export function verifyTaskMetadata(
  text: string,
  mode: AnalysisMode,
  host: AnalysisHost,
): string {
  const report = properties(text);
  const task = report.get("ceTaskId");
  if (
    report.get("projectKey") !== projectFor(mode) ||
    withoutSlash(report.get("serverUrl")) !== withoutSlash(host.url) ||
    !task?.trim()
  )
    throw new Error("Missing or wrong-target scanner task metadata");
  return task;
}
// F-022: Quality Gate failure summary (BR-328–BR-338, BR-146 v2).
const METADATA_LIMIT = 64 * 1024;
const BODY_LIMIT = 1024 * 1024;
const REQUEST_TIMEOUT = 15_000;
const SUMMARY_TIMEOUT = 60_000;
const DEADLINE_MARGIN = 5_000;
const LIST_LIMIT = 20;
const UNAVAILABLE = "Quality Gate summary unavailable:";
interface MetadataStat {
  isFile: () => boolean;
  size: number;
}
export interface MetadataHandle {
  stat: () => Promise<MetadataStat>;
  read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  close: () => Promise<void>;
}
export interface MetadataFiles {
  lstat: (path: string) => Promise<MetadataStat>;
  open: (path: string, flags: number) => Promise<MetadataHandle>;
}
const metadataFiles: MetadataFiles = {
  lstat: (path) => lstat(path),
  open: (path, flags) => open(path, flags),
};
function boundedFile(stat: MetadataStat): boolean {
  return stat.isFile() && stat.size <= METADATA_LIMIT;
}
// BR-329: a regular non-symlink file of at most 64 KiB, else empty.
export async function readTaskMetadata(
  path: string,
  files: MetadataFiles = metadataFiles,
): Promise<string> {
  try {
    if (!boundedFile(await files.lstat(path))) return "";
    const handle = await files.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!boundedFile(await handle.stat())) return "";
      const buffer = new Uint8Array(METADATA_LIMIT + 1);
      let total = 0;
      let bytes = -1;
      while (bytes !== 0 && total < buffer.length) {
        ({ bytesRead: bytes } = await handle.read(
          buffer,
          total,
          buffer.length - total,
          total,
        ));
        total += bytes;
      }
      if (total > METADATA_LIMIT) return "";
      return Buffer.from(buffer.subarray(0, total)).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}
type Fields = Record<string, unknown>;
function fields(value: unknown): Fields | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
const FORMAT = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;
function escapeText(value: string): string {
  let result = "";
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (character === "\\") result += "\\\\";
    else if (!FORMAT.test(character)) result += character;
    else {
      const hex = point.toString(16).toUpperCase();
      result += point > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
    }
  }
  return result;
}
const UNIT = /\[REDACTED\]|\\(?:\\|u\{[0-9A-F]+\}|u[0-9A-F]{4})|[\s\S]/gu;
function truncate(value: string, limit: number): string {
  let result = "";
  let count = 0;
  for (const [unit] of value.matchAll(UNIT)) {
    // Markers and escapes are ASCII; any other unit is one code point.
    const size =
      unit === "[REDACTED]" || unit.startsWith("\\") ? unit.length : 1;
    if (count + size > limit) break;
    result += unit;
    count += size;
  }
  return result;
}
interface Summary {
  code: number;
  metadata: string;
  mode: AnalysisMode;
  host: AnalysisHost;
  token: string;
  deadline: number;
  log: (message: string) => void;
  fetch: typeof globalThis.fetch;
}
interface Stage {
  summary: Summary;
  base: URL;
  authorization: string;
  signal: AbortSignal;
  print: (line: string) => void;
  project: string;
}
// BR-337: escape, redact, then truncate on escape and marker boundaries.
function clean(summary: Summary, value: unknown, limit = 100): string {
  const raw = text(value);
  if (raw === undefined) return "-";
  return truncate(
    redact(escapeText(raw), summary.token, summary.host.hostname),
    limit,
  );
}
type Fetched = { ok: true; body: unknown } | { ok: false; status?: number };
function abortion(signal: AbortSignal): Promise<never> {
  const promise = new Promise<never>((_resolve, reject) => {
    const fail = () => {
      reject(new Error("Summary request aborted"));
    };
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
  promise.catch(() => undefined);
  return promise;
}
// BR-332: streamed body with a byte counter, cancelled above 1 MiB.
async function boundedBody(
  response: Response,
  aborted: Promise<never>,
): Promise<string | undefined> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (
      let next = await Promise.race([reader.read(), aborted]);
      !next.done;
      next = await Promise.race([reader.read(), aborted])
    ) {
      size += next.value.byteLength;
      if (size > BODY_LIMIT) return undefined;
      chunks.push(next.value);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
// BR-331: fixed relative path, URLSearchParams values, no redirect, 15 s.
async function request(
  stage: Stage,
  path: string,
  query: Record<string, string>,
): Promise<Fetched> {
  const url = new URL(path, stage.base);
  url.search = new URLSearchParams(query).toString();
  const controller = new AbortController();
  const forward = () => {
    controller.abort();
  };
  stage.signal.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(forward, REQUEST_TIMEOUT);
  const aborted = abortion(controller.signal);
  try {
    const response = await Promise.race([
      Promise.resolve().then(() =>
        stage.summary.fetch(url, {
          method: "GET",
          redirect: "error",
          headers: { Authorization: stage.authorization },
          signal: controller.signal,
        }),
      ),
      aborted,
    ]);
    if (response.status < 200 || response.status > 299)
      return { ok: false, status: response.status };
    const body = await boundedBody(response, aborted);
    if (body === undefined) return { ok: false };
    return { ok: true, body: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
    stage.signal.removeEventListener("abort", forward);
    controller.abort();
  }
}
type Parsed<T> = { value: T } | { detail: string };
const UNEXPECTED = { detail: " (unexpected response)" };
async function runStage<T>(
  stage: Stage,
  name: "task" | "conditions" | "issues",
  path: string,
  query: Record<string, string>,
  parse: (body: unknown) => Parsed<T>,
): Promise<T | undefined> {
  const fetched = await request(stage, path, query);
  // BR-338: the time-limit line replaces the aborted stage line.
  if (stage.signal.aborted) {
    stage.print(`${UNAVAILABLE} time limit reached.`);
    return undefined;
  }
  let detail = "";
  if (fetched.ok) {
    const parsed = parse(fetched.body);
    if ("value" in parsed) return parsed.value;
    detail = parsed.detail;
  } else if (fetched.status !== undefined) {
    // BR-333: the Browse permission line replaces the issues stage line.
    if (name === "issues" && [401, 403].includes(fetched.status)) {
      stage.print(
        `Quality Gate issues unavailable (HTTP ${String(fetched.status)}): the token may lack Browse permission on the project.`,
      );
      return undefined;
    }
    detail = ` (HTTP ${String(fetched.status)})`;
  }
  stage.print(`${UNAVAILABLE} ${name} stage failed${detail}.`);
  return undefined;
}
function parseTask(body: unknown): Parsed<string> {
  const task = fields(fields(body)?.task);
  const status = text(task?.status);
  if (status === undefined) return UNEXPECTED;
  if (status !== "SUCCESS") return { detail: "" };
  const analysis = text(task?.analysisId);
  return analysis ? { value: analysis } : UNEXPECTED;
}
interface Condition extends Fields {
  status: string;
  metricKey: string;
}
interface GateStatus {
  status: string;
  conditions: Condition[];
}
function parseGate(body: unknown): Parsed<GateStatus> {
  const project = fields(fields(body)?.projectStatus);
  const status = text(project?.status);
  const conditions = project?.conditions;
  if (
    status === undefined ||
    !Array.isArray(conditions) ||
    !conditions.every((item) => {
      const condition = fields(item);
      return (
        text(condition?.status) !== undefined &&
        text(condition?.metricKey) !== undefined
      );
    })
  )
    return UNEXPECTED;
  return { value: { status, conditions: conditions as Condition[] } };
}
interface Issue extends Fields {
  rule: string;
  component: string;
  message: string;
}
interface IssuePage {
  issues: Issue[];
  totals: unknown[];
}
function parseIssues(body: unknown): Parsed<IssuePage> {
  const root = fields(body);
  const issues = root?.issues;
  if (
    !Array.isArray(issues) ||
    !issues.every((item) => {
      const issue = fields(item);
      return ["rule", "component", "message"].every(
        (key) => text(issue?.[key]) !== undefined,
      );
    })
  )
    return UNEXPECTED;
  return {
    value: {
      issues: issues as Issue[],
      totals: [fields(root?.paging)?.total, root?.total],
    },
  };
}
// BR-334: header, then at most 20 ERROR conditions in server order.
function printConditions(stage: Stage, gate: GateStatus, failed: Condition[]) {
  const s = stage.summary;
  stage.print(
    `Quality Gate summary: ${stage.project} status ${clean(s, gate.status)}`,
  );
  for (const condition of failed.slice(0, LIST_LIMIT))
    stage.print(
      `- condition ${clean(s, condition.metricKey)} ${clean(s, condition.comparator)} ${clean(s, condition.errorThreshold)}: actual ${clean(s, condition.actualValue)}`,
    );
  if (failed.length > LIST_LIMIT)
    stage.print(
      `- ${String(failed.length - LIST_LIMIT)} more conditions not shown`,
    );
}
function severityOf(summary: Summary, issue: Issue): string {
  if (text(issue.severity) !== undefined && text(issue.type) !== undefined)
    return `${clean(summary, issue.severity)} ${clean(summary, issue.type)}`;
  const impacts = Array.isArray(issue.impacts) ? issue.impacts : [];
  const typed = impacts
    .map((item) => fields(item))
    .filter(
      (item) =>
        text(item?.softwareQuality) !== undefined &&
        text(item?.severity) !== undefined,
    )
    .slice(0, 3)
    .map(
      (item) =>
        `${clean(summary, item?.softwareQuality)}:${clean(summary, item?.severity)}`,
    );
  return typed.length ? typed.join(",") : "-";
}
function issueLine(stage: Stage, issue: Issue): string {
  const s = stage.summary;
  const prefix = `${stage.project}:`;
  const file = issue.component.startsWith(prefix)
    ? issue.component.slice(prefix.length)
    : issue.component;
  const line =
    typeof issue.line === "number" &&
    Number.isInteger(issue.line) &&
    issue.line > 0
      ? `:${String(issue.line)}`
      : "";
  return `- issue ${severityOf(s, issue)} ${clean(s, issue.rule)} ${clean(s, file)}${line} ${clean(s, issue.message, 200)}`;
}
// BR-336: only issues of the analysed project, at most 20, with the total.
function printIssues(stage: Stage, page: IssuePage) {
  stage.print(
    `Quality Gate issues: current open issues of ${stage.project} (may include another analysis of this project).`,
  );
  const kept = page.issues.filter(
    (issue) =>
      issue.component === stage.project ||
      issue.component.startsWith(`${stage.project}:`),
  );
  const printed = kept.slice(0, LIST_LIMIT);
  for (const issue of printed) stage.print(issueLine(stage, issue));
  const total =
    page.totals.find(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value) && value >= 0,
    ) ?? kept.length;
  if (total > printed.length)
    stage.print(`- ${String(total - printed.length)} more issues not shown`);
}
async function summaryStages(stage: Stage, task: string): Promise<void> {
  const analysis = await runStage(
    stage,
    "task",
    "api/ce/task",
    { id: task },
    parseTask,
  );
  if (analysis === undefined) return;
  const gate = await runStage(
    stage,
    "conditions",
    "api/qualitygates/project_status",
    { analysisId: analysis },
    parseGate,
  );
  if (gate === undefined) return;
  const failed = gate.conditions.filter(
    (condition) => condition.status === "ERROR",
  );
  printConditions(stage, gate, failed);
  // BR-335: issues only when a condition failed; new code only for new_*.
  if (failed.length === 0) return;
  const newOnly = failed.every((condition) =>
    condition.metricKey.startsWith("new_"),
  );
  const quality = qualityFilter(failed.map((condition) => condition.metricKey));
  const page = await runStage(
    stage,
    "issues",
    "api/issues/search",
    {
      componentKeys: stage.project,
      resolved: "false",
      s: "SEVERITY",
      asc: "false",
      ps: String(LIST_LIMIT),
      ...quality,
      ...(newOnly ? { inNewCodePeriod: "true" } : {}),
    },
    parseIssues,
  );
  if (page !== undefined) printIssues(stage, page);
}
// BR-335 v2: map each failed metric to its software quality (MQR) or legacy
// issue type; an unmapped metric or a mix of both families adds no filter.
function qualityOf(metricKey: string): [string, string] | undefined {
  const key = metricKey.replace(/^new_/u, "");
  for (const [prefix, value] of [
    ["software_quality_reliability_", "RELIABILITY"],
    ["software_quality_security_", "SECURITY"],
    ["software_quality_maintainability_", "MAINTAINABILITY"],
  ] as const)
    if (key.startsWith(prefix)) return ["impactSoftwareQualities", value];
  if (key.startsWith("reliability_") || key === "bugs") return ["types", "BUG"];
  if (
    [
      "security_rating",
      "security_remediation_effort",
      "vulnerabilities",
    ].includes(key)
  )
    return ["types", "VULNERABILITY"];
  if (
    key.startsWith("sqale_") ||
    ["maintainability_rating", "technical_debt", "code_smells"].includes(key)
  )
    return ["types", "CODE_SMELL"];
  return undefined;
}
export function qualityFilter(metricKeys: string[]): Record<string, string> {
  const mapped = metricKeys.map((key) => qualityOf(key));
  const first = mapped[0];
  if (
    first === undefined ||
    mapped.some((entry) => entry === undefined || entry[0] !== first[0])
  )
    return {};
  const values = [...new Set(mapped.map((entry) => entry?.[1] ?? ""))].sort(
    (left, right) => left.localeCompare(right),
  );
  return { [first[0]]: values.join(",") };
}
function verifiedTask(summary: Summary): string | undefined {
  try {
    return verifyTaskMetadata(summary.metadata, summary.mode, summary.host);
  } catch {
    return undefined;
  }
}
// BR-338: never throws and always returns the scanner's nonzero code.
async function summarize(summary: Summary): Promise<number> {
  // BR-146 v2: every summary line passes through redact.
  const print = (line: string) => {
    summary.log(redact(`${line}\n`, summary.token, summary.host.hostname));
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const task = verifiedTask(summary);
    if (task === undefined) {
      print(`${UNAVAILABLE} no verified task metadata.`);
      return summary.code;
    }
    const limit = Math.min(
      SUMMARY_TIMEOUT,
      summary.deadline - Date.now() - DEADLINE_MARGIN,
    );
    if (limit <= 0) {
      print(`${UNAVAILABLE} time limit reached.`);
      return summary.code;
    }
    timer = setTimeout(() => {
      controller.abort();
    }, limit);
    const base = new URL(summary.host.url.replace(/\/?$/u, "/"));
    const basic = Buffer.from(summary.token + ":").toString("base64");
    await summaryStages(
      {
        summary,
        base,
        authorization: `Basic ${basic}`,
        signal: controller.signal,
        print,
        project: projectFor(summary.mode),
      },
      task,
    );
  } catch {
    try {
      print(`${UNAVAILABLE} internal error.`);
    } catch {
      // The sink itself failed; the scanner code is still returned.
    }
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
  return summary.code;
}
interface ScanOutcome {
  code: number;
  failure?: { metadata: string; mode: AnalysisMode; host: AnalysisHost };
}
export async function runAnalysis(options: AnalysisOptions): Promise<number> {
  const token = options.token ?? "";
  const hostname = options.host.hostname;
  const budget = options.timeoutMs ?? 900_000;
  const deadline = Date.now() + budget;
  let outcome: ScanOutcome;
  try {
    outcome = await withinDeadline(budget, async (signal) => {
      if (options.enabled !== "true")
        throw new Error("Remote analysis is not enabled");
      validToken(token);
      const host = validHost(options.host.url);
      const mode = analysisMode(options.mode);
      // BR-150: the fixed mode and the manifest event must agree.
      if ((options.snapshot.event === "pull_request") !== (mode === "pr"))
        throw new Error("Analysis mode does not match the snapshot event");
      if (mode === "pr") verifyPullRequest(options.snapshot);
      else verifyMain(options.snapshot);
      await options.verifySnapshot(signal);
      signal.throwIfAborted();
      const result = await options.scan(signal);
      signal.throwIfAborted();
      // BR-328: only a nonzero scanner exit leads to the summary.
      if (result.code !== 0)
        return {
          code: result.code,
          failure: { metadata: result.metadata, mode, host },
        };
      const task = verifyTaskMetadata(result.metadata, mode, host);
      options.log(
        redact(
          `Sonar task ${task}: scanner exit 0 after built-in Quality Gate waiting.\n`,
          token,
          hostname,
        ),
      );
      return { code: 0 };
    });
  } catch (error) {
    options.log(
      redact(
        `${error instanceof Error ? error.message : "Analysis failed"}\n`,
        token,
        hostname,
      ),
    );
    return 1;
  }
  // BR-338: outside the outer deadline abort path; returns the scanner code.
  if (!outcome.failure) return outcome.code;
  return summarize({
    ...outcome.failure,
    code: outcome.code,
    token,
    deadline,
    log: options.log,
    fetch: options.fetch ?? globalThis.fetch,
  });
}
interface ScannerOptions {
  root: string;
  work: string;
  cache: string;
  token: string;
  host: AnalysisHost;
  mode?: AnalysisMode;
  commit: string;
  runId: string;
  signal: AbortSignal;
  log: (text: string) => void;
  executable?: string;
  outputLimit?: number;
}
export async function scanOfficial(
  options: ScannerOptions,
): Promise<ScanResult> {
  const { token, signal, log } = options;
  validToken(token);
  const host = validHost(options.host.url);
  const mode = options.mode ?? "main";
  signal.throwIfAborted();
  if (process.getuid?.() === 0) throw new Error("Scanner must be non-root");
  if (
    !/^[a-f0-9-]{36}$/.test(options.runId) ||
    !/^[a-f0-9]{40}$/.test(options.commit)
  )
    throw new Error("Invalid scanner invocation identity");
  await mkdir(options.work, { recursive: true });
  await access(options.work, constants.W_OK);
  await access(options.cache, constants.W_OK | constants.X_OK);
  await mkdir(join(options.work, "runs"), { recursive: true });
  const report = join(options.work, "runs", `${options.runId}.txt`);
  try {
    await access(report);
    throw new Error("Task metadata already exists");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  signal.throwIfAborted();
  const args = [
    `-Dsonar.scanner.metadataFilePath=${report}`,
    `-Dsonar.scm.revision=${options.commit}`,
    "-Dsonar.qualitygate.wait=true",
    "-Dsonar.qualitygate.timeout=300",
    "-Dsonar.verbose=false",
    // BR-148: the PR project key overrides the main key of the tracked file.
    ...(mode === "pr" ? [`-Dsonar.projectKey=${PR_PROJECT}`] : []),
  ];
  const code = await new Promise<number>((resolveExit, reject) => {
    // Positive environment allowlist excludes scanner argument/property injection.
    const env: NodeJS.ProcessEnv = {
      SONAR_TOKEN: token,
      SONAR_HOST_URL: host.url,
      SONAR_USER_HOME: options.cache,
    };
    for (const name of ["PATH", "HOME", "JAVA_HOME", "LANG", "LC_ALL"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    const child = spawn(options.executable ?? "sonar-scanner", args, {
      cwd: options.root,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let captured = 0;
    let overflow = false;
    const limit = options.outputLimit ?? 16 * 1024 * 1024;
    const events: OutputEvent[] = [];
    const append = (stream: number, text: string) => {
      if (!text) return;
      const last = events.at(-1);
      if (last?.stream === stream) last.text += text;
      else events.push({ stream, text });
    };
    const abort = () => {
      killGroup(child);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    for (const [identity, stream] of [child.stdout, child.stderr].entries()) {
      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => {
        if (overflow) return;
        const available = Math.max(0, limit - captured);
        const retained = chunk.subarray(0, available);
        captured += retained.length;
        append(identity, decoder.write(retained));
        if (chunk.length > available || events.length >= 65_536) {
          overflow = true;
          killGroup(child);
        }
      });
      stream.once("end", () => {
        append(identity, decoder.end());
      });
    }
    child.once("error", reject);
    child.once("close", (exit) => {
      log(redactCaptured(events, token, host.hostname));
      if (overflow) log("Scanner output limit exceeded; analysis failed.\n");
      signal.removeEventListener("abort", abort);
      resolveExit(signal.aborted || overflow ? 1 : (exit ?? 1));
    });
  });
  // BR-329: the summary needs the task metadata of a failed run too.
  if (code !== 0) return { code, metadata: await readTaskMetadata(report) };
  signal.throwIfAborted();
  return { code, metadata: await readFile(report, "utf8") };
}
async function main() {
  if (process.argv.length !== 2)
    throw new Error("Scanner arguments are not accepted");
  const root = process.cwd();
  const manifest = JSON.parse(
    await readFile(join(root, "analysis-snapshot.json"), "utf8"),
  ) as MainSnapshot & { runId: string; startedAt: number };
  const elapsed = Date.now() - manifest.startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 900_000)
    throw new Error("Snapshot deadline expired");
  // BR-150: the mode comes only from the fixed value set by the Make target.
  const mode = analysisMode(process.env.SONAR_ANALYSIS_MODE);
  const token = await loadToken(process.env);
  const host = await loadHost(process.env);
  const log = (text: string) => process.stdout.write(text);
  // The container-private tmpfs holds the scanner work tree (compose.yaml).
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- F-011: /tmp is the analysis container's private tmpfs
  const work = "/tmp/.scannerwork";
  return runAnalysis({
    token,
    host,
    mode,
    enabled: process.env.SONAR_ENABLED ?? "",
    snapshot: manifest,
    timeoutMs: 900_000 - elapsed,
    verifySnapshot: async () => {
      verifyProperties(
        await readFile(join(root, "sonar-project.properties"), "utf8"),
      );
      await verifyCoverage(root, manifest.runId);
      await verifyAnalysedSet(root, host.hostname);
    },
    scan: (signal) =>
      scanOfficial({
        root,
        work,
        cache: "/opt/sonar-scanner/.sonar",
        token,
        host,
        mode,
        commit: manifest.commit,
        runId: manifest.runId,
        signal,
        log,
      }),
    log,
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    // Credential and host loading errors are fixed messages; scanner errors are
    // handled above.
    process.stderr.write(
      `${error instanceof Error ? error.message : "Invalid analysis snapshot or configuration"}\n`,
    );
    process.exitCode = 1;
  }
}

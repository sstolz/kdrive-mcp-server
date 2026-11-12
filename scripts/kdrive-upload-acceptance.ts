// F-018 BR-287: owner-run real-API upload acceptance on actual main
// (make kdrive-upload-acceptance KDRIVE_WRITE_FOLDER=<id>). Runs the two
// phases of the F-018 Acceptance sequence in process through main(deps) with
// the production {lookup, connect}, mode `write` and the designated folder as
// the only root, at most 100 upstream requests within 300,000 ms and at most
// 1,048,576 uploaded bytes. The audit log goes to a container temporary file.
// Prints only a sanitized summary: per-step pass/fail, statuses, observations,
// request counts by method and route template, durations and the main SHA;
// never an ID, name, path, token or content.
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { mutationRoutes, routes } from "../src/kdrive/routes.ts";
import { LineTransport } from "./kdrive-acceptance.ts";
import { parseManifest } from "./kdrive-record.ts";
import { auditMatches, leaks } from "./kdrive-write-acceptance.ts";

const MAX_REQUESTS = 100;
const MAX_MS = 300_000;
const MAX_UPLOADED = 1_048_576;
const OVER_BOUND = 524_289;
const TOKEN_FILE = "/run/kdrive-acceptance/kdrive-token";
const DENY = "**/*-deny*";
const dist = (path: string) => new URL(`../dist/${path}`, import.meta.url).href;

type Method = "GET" | "POST" | "DELETE";
interface Outcome {
  readonly value?: Record<string, unknown>;
  readonly error?: string;
}
export interface Step {
  readonly step: string;
  pass: boolean;
  readonly statuses: number[];
  observed?: string;
  ms: number;
}

const started = performance.now();
const counts = new Map<string, number>();
let total = 0,
  writes = 0,
  uploaded = 0,
  stopped = false;
const steps: Step[] = [];
/** The run's counters and steps, read by the synthetic end-to-end test. */
export function uploadAcceptanceState(): UploadAcceptanceState {
  return {
    sha: undefined,
    total,
    uploaded,
    counts,
    ms: performance.now() - started,
    steps,
  };
}
const observe = (method: Method, template: string) => {
  total++;
  if (method !== "GET") writes++;
  const key = `${method} ${template}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/** BR-287: only route-table templates are printed. */
const TEMPLATES = new Set([
  ...[
    routes.init(),
    routes.item(1, 1),
    routes.children(1, 1),
    routes.sharedWithMe(),
    routes.download(1, 1),
  ].map((r) => `GET ${r.template}`),
  ...[
    mutationRoutes.create(1, 1),
    mutationRoutes.upload(1, 1, "x", 0, "error"),
  ].map((r) => `${r.method} ${r.template}`),
]);

export interface UploadAcceptanceState {
  readonly sha: string | undefined;
  readonly total: number;
  readonly uploaded: number;
  readonly counts: ReadonlyMap<string, number>;
  readonly ms: number;
  readonly steps: readonly Step[];
}
/** BR-287: the sanitized summary; only templates, statuses and numbers. */
export function formatUploadReport(state: UploadAcceptanceState): string {
  const report = {
    sha: /^[0-9a-f]{40}$/u.test(state.sha ?? "") ? state.sha : "unknown",
    requests: state.total,
    requestsWithinBound: state.total <= MAX_REQUESTS,
    uploadedBytes: state.uploaded,
    uploadedWithinBound: state.uploaded <= MAX_UPLOADED,
    byRoute: Object.fromEntries(
      [...state.counts].filter(([key]) => TEMPLATES.has(key)),
    ),
    ms: Math.round(state.ms),
    steps: state.steps.map((s) => ({
      step: s.step,
      pass: s.pass,
      statuses: s.statuses,
      ...(s.observed === undefined ? {} : { observed: s.observed }),
      ms: Math.round(s.ms),
    })),
  };
  return `${JSON.stringify(report, null, 1)}\n`;
}

interface Client {
  callTool(p: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content?: unknown; isError?: unknown }>;
  close(): Promise<void>;
}
function parsed(r: { content?: unknown; isError?: unknown }): Outcome {
  const text = (r.content as { text?: string }[] | undefined)?.[0]?.text ?? "";
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return { value: value as Record<string, unknown> };
  } catch {
    /* A plain error code. */
  }
  return { error: r.isError === true ? text : "UNPARSED" };
}
/** A result label for the summary: a gate result or a fixed error code. */
function label(r: Outcome): string {
  const result = r.value?.result;
  return typeof result === "string" ? result : (r.error ?? "UNPARSED");
}

/** The network and token seams; production values unless a test injects them. */
export interface UploadAcceptanceOptions {
  readonly lookup?: (host: string, options: unknown) => Promise<unknown>;
  readonly connect?: (options: {
    host: string;
    port: number;
    servername: string;
  }) => unknown;
  readonly tokenFile?: string;
}

/** One in-process main(deps) session in mode `write` with one root. */
async function session(
  env: Record<string, string>,
  options: UploadAcceptanceOptions = {},
) {
  const { main } = (await import(
    dist("main.js")
  )) as typeof import("../src/main.ts");
  const production = (await import(
    dist("kdrive/production.js")
  )) as typeof import("../src/kdrive/production.ts");
  const sdk = (await import("@modelcontextprotocol/client")) as unknown as {
    Client: new (
      info: object,
    ) => Client & { connect(t: unknown): Promise<void> };
  };
  const input = new PassThrough(),
    output = new PassThrough(),
    signals = new EventEmitter();
  const handle = await main({
    argv: [],
    env: { ...env, KDRIVE_TOKEN_FILE: options.tokenFile ?? TOKEN_FILE },
    stdout: { write: () => true },
    stderr: { write: () => true },
    protocol: { input, output },
    signals: {
      on: (n, l) => signals.on(n, l),
      off: (n, l) => signals.off(n, l),
    },
    exit: () => undefined,
    now: () => performance.now(),
    lookup: (host, lookupOptions) =>
      total >= MAX_REQUESTS
        ? Promise.reject(new Error("budget"))
        : (
            (options.lookup ??
              production.productionLookup) as typeof production.productionLookup
          )(host, lookupOptions),
    connect: (options.connect ??
      production.productionConnect) as typeof production.productionConnect,
    onRequest: observe,
  });
  if (!handle) throw new Error("start");
  const client = new sdk.Client({
    name: "kdrive-upload-acceptance",
    version: "1",
  });
  await client.connect(new LineTransport(input, output));
  return {
    call: async (name: string, args: Record<string, unknown>) =>
      parsed(await client.callTool({ name, arguments: args })),
    async close() {
      await client.close();
      await handle.close();
    },
  };
}
type Session = Awaited<ReturnType<typeof session>>;

/** BR-287: a step after a stopping failure is reported `not run`. */
async function step(name: string, run: (s: Step) => Promise<boolean>) {
  const s: Step = { step: name, pass: false, statuses: [], ms: 0 };
  const at = performance.now();
  if (stopped) s.observed = "not run";
  else
    try {
      if (performance.now() - started > MAX_MS) throw new Error("time");
      s.pass = await run(s);
    } catch {
      s.pass = false;
    }
  s.ms = performance.now() - at;
  steps.push(s);
  return s;
}

export async function uploadAcceptance(
  driveId: number,
  folderId: number,
  secrets: { ids: number[]; names: string[] },
  options: UploadAcceptanceOptions = {},
) {
  const run = randomBytes(4).toString("hex");
  const marker = `p19x-${run}`;
  const n = (letter: string) => {
    const value = `${marker}-${letter}`;
    secrets.names.push(value);
    return value;
  };
  /** Content that carries the run marker, padded to `size` bytes. */
  const content = (size: number) =>
    `${marker}-${"c".repeat(Math.max(0, size - marker.length - 1))}`.slice(
      0,
      size,
    );
  const audit = mkdtempSync(join(tmpdir(), "kdrive-upload-"));
  const base = {
    KDRIVE_ID: String(driveId),
    KDRIVE_MCP_MODE: "write",
    KDRIVE_MCP_ROOTS: `${String(driveId)}:${String(folderId)}`,
  };
  const ids = new Map<string, number>();
  const id = (letter: string) => {
    const value = ids.get(letter);
    if (value === undefined) throw new Error("missing fixture");
    return value;
  };
  const results: { tool: string; result: string }[][] = [[], []];
  let phase = 0;
  const tool = async (
    s: Session,
    st: Step,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const r = await s.call(name, { drive_id: driveId, ...args });
    const result = r.value?.result;
    if (typeof result === "string")
      results[phase]?.push({ tool: name, result });
    if (typeof r.value?.status === "number") st.statuses.push(r.value.status);
    return r;
  };
  const upload = async (
    s: Session,
    st: Step,
    args: Record<string, unknown>,
    bytes: number,
  ) => {
    uploaded += bytes;
    if (uploaded > MAX_UPLOADED) throw new Error("bytes");
    return tool(s, st, "kdrive_upload", { parent_id: folderId, ...args });
  };
  const value = (r: Outcome) =>
    (r.value?.value ?? {}) as {
      id?: unknown;
      size?: unknown;
      action?: unknown;
    };
  const keep = (letter: string, r: Outcome) => {
    const v = value(r);
    if (r.value?.result !== "succeeded" || typeof v.id !== "number")
      return false;
    ids.set(letter, v.id);
    secrets.ids.push(v.id);
    return true;
  };
  /** `kdrive_info` carries no size: read the file back as text instead. */
  const readBack = async (s: Session, fileId: number) => {
    const r = await s.call("kdrive_read", {
      drive_id: driveId,
      file_id: fileId,
      format: "text",
    });
    let found: unknown;
    JSON.parse(JSON.stringify(r.value ?? {}), (key, v: unknown) => {
      if (key === "size_bytes") found = v;
      return v;
    });
    return { size: found, text: JSON.stringify(r.value ?? {}) };
  };
  const size = async (s: Session, fileId: number) =>
    (await readBack(s, fileId)).size;
  const zeroWrites = async (work: () => Promise<boolean>) => {
    const before = writes;
    const ok = await work();
    return ok && writes === before;
  };
  /** One paginated listing of R; names that start with the run marker. */
  const listed = async (s: Session) => {
    const names: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await s.call("kdrive_list", {
        drive_id: driveId,
        folder_id: folderId,
        ...(cursor ? { cursor } : {}),
      });
      const items = (page.value?.items ?? []) as { name?: unknown }[];
      for (const item of items)
        if (typeof item.name === "string" && item.name.startsWith(marker))
          names.push(item.name);
      const next = page.value?.next_cursor;
      cursor = typeof next === "string" ? next : undefined;
      pages++;
    } while (cursor && pages < 10);
    return { names, complete: !cursor };
  };
  const is = (r: Outcome, result: string) => r.value?.result === result;

  // Phase 1: deny list empty.
  const one = await session(
    {
      ...base,
      KDRIVE_MCP_AUDIT_LOG: join(audit, "phase-1.jsonl"),
    },
    options,
  );
  try {
    const first = await step("1 upload a (16 bytes)", async (st) => {
      const r = await upload(one, st, { name: n("a"), text: content(16) }, 16);
      st.observed = `parent_id present: ${is(r, "succeeded") ? "yes" : "unknown"}`;
      if (!keep("a", r)) return false;
      return value(r).action === "created" && (await size(one, id("a"))) === 16;
    });
    if (!first.pass) stopped = true;
    await step("2 same name again is refused 409", async (st) => {
      const r = await upload(one, st, { name: n("a"), text: content(24) }, 24);
      return (
        is(r, "failed") &&
        r.value?.code === "UPSTREAM_REJECTED" &&
        r.value.status === 409 &&
        (await size(one, id("a"))) === 16
      );
    });
    await step("3 upload e with 0 bytes as base64", async (st) => {
      const r = await upload(one, st, { name: n("e"), base64: "" }, 0);
      return keep("e", r) && value(r).size === 0;
    });
    await step("4 case variant A is a new file", async (st) => {
      const r = await upload(one, st, { name: n("A"), text: content(16) }, 16);
      return keep("A", r) && id("A") !== id("a");
    });
    await step("5 overwrite a replaces in place", async (st) => {
      const bytes = content(24);
      const r = await upload(
        one,
        st,
        { name: n("a"), text: bytes, overwrite: true, file_id: id("a") },
        24,
      );
      const read = await readBack(one, id("a"));
      return (
        is(r, "succeeded") &&
        value(r).action === "replaced" &&
        value(r).id === id("a") &&
        value(r).size === 24 &&
        read.size === 24 &&
        read.text.includes(bytes)
      );
    });
    await step("6 overwrite with another name is denied", (st) =>
      zeroWrites(async () =>
        is(
          await upload(
            one,
            st,
            { name: n("e"), text: "x", overwrite: true, file_id: id("a") },
            1,
          ),
          "denied",
        ),
      ),
    );
    const seventh = await step("7 upload y-deny (no deny yet)", async (st) =>
      keep(
        "y-deny",
        await upload(one, st, { name: n("y-deny"), text: content(8) }, 8),
      ),
    );
    if (!seventh.pass) stopped = true;
    await step("8 file named like a folder (observed)", async (st) => {
      const folder = await tool(one, st, "kdrive_create_folder", {
        parent_id: folderId,
        name: n("D"),
      });
      if (!keep("D", folder)) return false;
      const r = await upload(one, st, { name: n("D"), text: content(8) }, 8);
      keep("D-file", r);
      const { names, complete } = await listed(one);
      const named = names.filter((x) => x === n("D")).length;
      // F-018 v2 step 8 (v2): run-prefix children outside the kept set.
      const kept = new Set(
        [...ids.keys()].filter((k) => k !== "D-file").map((k) => n(k)),
      );
      const offSet = names.filter((x) => !kept.has(x)).length;
      st.observed = `result ${label(r)}; children named D: ${complete ? String(named) : "unknown"}; off-set children: ${complete ? String(offSet) : "unknown"}`;
      return true;
    });
    // F-018 v2 step 9 (v2): NFD refused (a), NFC stored as sent (b),
    // compatibility ligature observed (c).
    await step("9 NFC names (9c observed)", async (st) => {
      const before = total;
      const nfd = await tool(one, st, "kdrive_upload", {
        parent_id: folderId,
        name: n("n-e\u0301"),
        text: content(8),
      });
      const refused = nfd.error === "INVALID_ARGUMENTS" && total === before;
      const composed = n("c-\u00E9");
      const nfc = await upload(
        one,
        st,
        { name: composed, text: content(8) },
        8,
      );
      keep("c", nfc);
      const ligature = n("k-\uFB01");
      const lig = await upload(
        one,
        st,
        { name: ligature, text: content(8) },
        8,
      );
      keep("k", lig);
      const { names, complete } = await listed(one);
      const written = is(lig, "succeeded") || is(lig, "uncertain");
      let equal = "unknown";
      if (written && names.includes(ligature)) equal = "yes";
      else if (written && complete) equal = "no";
      st.observed = `9c result ${label(lig)}; stored name equals sent: ${equal}`;
      return refused && is(nfc, "succeeded") && names.includes(composed);
    });
    await step(
      "10 524,289 bytes is LIMIT_EXCEEDED with zero requests",
      async (st) => {
        const before = total;
        const r = await tool(one, st, "kdrive_upload", {
          parent_id: folderId,
          name: n("big"),
          base64: Buffer.alloc(OVER_BOUND, 0x61).toString("base64"),
        });
        return r.error === "LIMIT_EXCEEDED" && total === before;
      },
    );
  } finally {
    await one.close();
  }

  // Phase 2: deny list `**/*-deny*`.
  phase = 1;
  const two = await session(
    {
      ...base,
      KDRIVE_MCP_DENY: DENY,
      KDRIVE_MCP_AUDIT_LOG: join(audit, "phase-2.jsonl"),
    },
    options,
  );
  try {
    await step("11 denied uploads make zero writes", (st) =>
      zeroWrites(async () => {
        const fresh = is(
          await upload(two, st, { name: n("x-deny"), text: "x" }, 1),
          "denied",
        );
        const replace = is(
          await upload(
            two,
            st,
            {
              name: n("y-deny"),
              text: "y",
              overwrite: true,
              file_id: id("y-deny"),
            },
            1,
          ),
          "denied",
        );
        return fresh && replace;
      }),
    );
  } finally {
    await two.close();
  }

  stopped = false;
  await step("12 audit records match results and hold no name or content", () =>
    Promise.resolve(
      ["phase-1.jsonl", "phase-2.jsonl"].every((file, index) =>
        auditMatches(join(audit, file), results[index] ?? [], marker),
      ),
    ),
  );
}

async function main() {
  const folder = process.env.KDRIVE_WRITE_FOLDER ?? "";
  if (
    !/^[1-9]\d{0,15}$/u.test(folder) ||
    !Number.isSafeInteger(Number(folder))
  ) {
    process.stdout.write(
      "Set KDRIVE_WRITE_FOLDER to a positive decimal folder ID.\n",
    );
    process.exitCode = 1;
    return;
  }
  const folderId = Number(folder);
  const token = readFileSync(
    process.env.KDRIVE_TOKEN_FILE ?? TOKEN_FILE,
    "utf8",
  ).replace(/\r?\n$/u, "");
  const driveId = parseManifest(
    readFileSync("/run/kdrive-acceptance/fixtures.json", "utf8"),
  ).driveId;
  const secrets = { ids: [driveId, folderId], names: [] as string[] };
  const timer = setTimeout(() => {
    process.stdout.write(
      "kdrive-upload-acceptance: 300,000 ms bound reached.\n",
    );
    process.exit(1);
  }, MAX_MS);
  try {
    await uploadAcceptance(driveId, folderId, secrets);
  } catch {
    steps.push({
      step: "upload acceptance run",
      pass: false,
      statuses: [],
      ms: performance.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }
  const report = formatUploadReport({
    sha: process.env.KDRIVE_ACCEPTANCE_SHA,
    total,
    uploaded,
    counts,
    ms: performance.now() - started,
    steps,
  });
  const leak = leaks(report, { token, ...secrets });
  if (leak !== undefined) {
    process.stdout.write(
      `kdrive-upload-acceptance: summary refused (${leak}).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(report);
  process.exitCode =
    steps.every((s) => s.pass) &&
    total <= MAX_REQUESTS &&
    uploaded <= MAX_UPLOADED
      ? 0
      : 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main();

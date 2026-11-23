// F-050 v1 AC-08/09: bounded read-only owner qualification on actual main.
// One direct metadata read and one SDK info call per designated item. No raw
// values, identifiers, provider diagnostics or credentials enter the report.
import { EventEmitter } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { LineTransport } from "./kdrive-acceptance.ts";

const BASE = "/run/kdrive-acceptance";
const MAX_REQUESTS = 32;
const MAX_MS = 120_000;
const dist = (path: string) => new URL(`../dist/${path}`, import.meta.url).href;
interface Designated {
  driveId: number;
  id: number;
  size_bytes?: number | null;
  modified_at?: string;
}
interface Manifest {
  file: Designated;
  folder: Designated;
  received?: Designated;
}
interface Client {
  connect(transport: unknown): Promise<void>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{
    content?: unknown;
    isError?: unknown;
  }>;
  close(): Promise<void>;
}
function validSize(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}
function designated(value: unknown, known: boolean, folder = false): Designated {
  if (!value || typeof value !== "object") throw new Error("manifest");
  const r = value as Designated;
  if (![r.driveId, r.id].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error("manifest");
  if (
    known &&
    !(
      (validSize(r.size_bytes) || (folder && r.size_bytes === null)) &&
      typeof r.modified_at === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(r.modified_at)
    )
  )
    throw new Error("manifest");
  return r;
}
function manifest(): Manifest {
  const raw = JSON.parse(readFileSync(`${BASE}/fixtures.json`, "utf8")) as {
    info?: { file?: unknown; folder?: unknown; received?: unknown };
  };
  if (!raw.info) throw new Error("manifest");
  const selected = {
    file: designated(raw.info.file, true),
    folder: designated(raw.info.folder, false),
    ...(raw.info.received === undefined
      ? {}
      : { received: designated(raw.info.received, true, true) }),
  };
  const refs = [selected.file, selected.folder, selected.received].filter(
    (r) => r !== undefined,
  );
  const keys = refs.map((r) => `${String(r.driveId)}:${String(r.id)}`);
  if (new Set(keys).size !== keys.length) throw new Error("manifest");
  return selected;
}
const started = performance.now();
let requests = 0;
function observe(method: string) {
  requests++;
  if (method !== "GET") throw new Error("method");
}
async function runtime(m: Manifest) {
  const { main } = (await import(
    dist("main.js")
  )) as typeof import("../src/main.ts");
  const production = (await import(
    dist("kdrive/production.js")
  )) as typeof import("../src/kdrive/production.ts");
  const { createTransport } = (await import(
    dist("kdrive/transport.js")
  )) as typeof import("../src/kdrive/transport.ts");
  const { routes } = (await import(
    dist("kdrive/routes.js")
  )) as typeof import("../src/kdrive/routes.ts");
  const sdk = (await import("@modelcontextprotocol/client")) as unknown as {
    Client: new (info: object) => Client;
  };
  const options = {
    token: readFileSync(`${BASE}/kdrive-token`, "utf8").trim(),
    lookup: (host: string, options: { all: true }) =>
      requests > MAX_REQUESTS || performance.now() - started >= MAX_MS
        ? Promise.reject(new Error("budget"))
        : production.productionLookup(host, options),
    connect: production.productionConnect,
    onRequest: observe,
  };
  const input = new PassThrough(),
    output = new PassThrough(),
    signals = new EventEmitter();
  const drives = [...new Set([m.file.driveId, m.folder.driveId])];
  const handle = await main({
    argv: [],
    env: {
      KDRIVE_TOKEN_FILE: `${BASE}/kdrive-token`,
      KDRIVE_IDS: drives.join(","),
      KDRIVE_MCP_ROOTS: drives.map((d) => `${String(d)}:1`).join(","),
      KDRIVE_MCP_SHARED_WITH_ME: m.received ? "1" : "0",
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
    protocol: { input, output },
    signals: {
      on: (n, l) => signals.on(n, l),
      off: (n, l) => signals.off(n, l),
    },
    exit: () => undefined,
    now: () => performance.now(),
    lookup: options.lookup,
    connect: options.connect,
    onRequest: observe,
  });
  if (!handle) throw new Error("start");
  const client = new sdk.Client({ name: "kdrive-info-acceptance", version: "1" });
  try {
    await client.connect(new LineTransport(input, output));
  } catch {
    await handle.close();
    throw new Error("start");
  }
  const transport = createTransport(options);
  return {
    async read(ref: Designated) {
      const raw = await transport.json(routes.item(ref.driveId, ref.id));
      if (raw.kind !== "success") throw new Error("metadata");
      const result = await client.callTool({
        name: "kdrive_info",
        arguments: { drive_id: ref.driveId, file_id: ref.id },
      });
      if (result.isError) throw new Error("info");
      const text = (result.content as { text?: string }[] | undefined)?.[0]?.text;
      if (!text) throw new Error("info");
      const parsed = JSON.parse(text) as { item: Record<string, unknown> };
      return { raw: raw.value.data as Record<string, unknown>, item: parsed.item };
    },
    async close() {
      try {
        await client.close();
      } finally {
        await handle.close();
      }
    },
  };
}
function timestamp(value: unknown): string | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 253402300799
    ? new Date(value * 1000).toISOString().replace(".000Z", "Z")
    : null;
}
function knownMismatch(ref: Designated, bytes: number | null, date: string | null) {
  return bytes !== ref.size_bytes || (date !== null && date !== ref.modified_at);
}
function compare(
  ref: Designated,
  folder: boolean,
  raw: Record<string, unknown>,
  item: Record<string, unknown>,
) {
  if (
    raw.id !== ref.id ||
    raw.drive_id !== ref.driveId ||
    item.id !== ref.id ||
    item.drive_id !== ref.driveId ||
    raw.type !== (folder ? "dir" : "file") ||
    item.type !== raw.type
  )
    return "failed";
  const size = raw.size;
  const bytes = !folder && validSize(size) ? size + 0 : null;
  const date = timestamp(raw.last_modified_at);
  if (item.size_bytes !== bytes || item.modified_at !== date) return "failed";
  if (ref.modified_at !== undefined && knownMismatch(ref, bytes, date))
    return "failed";
  return date === null ? "inconclusive" : "passed";
}
async function run() {
  const m = manifest();
  const session = await runtime(m);
  const checks: { check: string; outcome: string }[] = [];
  try {
    for (const [check, ref] of [
      ["file", m.file],
      ["folder", m.folder],
      ["received", m.received],
    ] as const) {
      if (!ref) continue;
      const { raw, item } = await session.read(ref);
      const folder =
        check === "folder" || (check === "received" && ref.size_bytes === null);
      checks.push({ check, outcome: compare(ref, folder, raw, item) });
    }
  } finally {
    await session.close();
  }
  return {
    qualified: checks.every((c) => c.outcome === "passed"),
    checks,
    received: m.received
      ? "compared"
      : "unverified real-account metadata residual risk",
  };
}
async function main() {
  const timer = setTimeout(() => {
    process.stdout.write('{"qualified":false,"outcome":"failed time bound"}\n');
    process.exit(1);
  }, MAX_MS);
  let report: object;
  try {
    const result = await run();
    report = result;
    process.exitCode = result.qualified ? 0 : 1;
  } catch {
    report = { qualified: false, outcome: "failed" };
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
  const sha = process.env.KDRIVE_ACCEPTANCE_SHA;
  process.stdout.write(
    `${JSON.stringify({
      ...report,
      sha: /^[0-9a-f]{40}$/u.test(sha ?? "") ? sha : "unknown",
      requests,
    })}\n`,
  );
}
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  await main();

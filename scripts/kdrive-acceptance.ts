// F-014 BR-215: owner-run acceptance on actual main (make kdrive-acceptance).
// Executes the AC-23–AC-26 checks in process through main(deps) with the
// production {lookup, connect} and a counting onRequest observer, plus a
// packaged-CLI smoke. At most 400 GET requests and 900,000 ms. Prints only a
// sanitized summary: per-check pass/fail, request counts, durations, byte
// totals and the main SHA; never an ID, name, path, cursor, ETag, URL or token.
// BR-215 v2: it also reports, on a monotonic clock, the maximum single-request
// duration per route template and the maximum navigation invocation duration;
// any REQUEST_TIMEOUT fails the check that met it.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { routes } from "../src/kdrive/routes.ts";
import { parseManifest, type Manifest } from "./kdrive-record.ts";

const MAX_REQUESTS = 400;
const MAX_MS = 900_000;
const TOKEN_FILE = "/run/kdrive-acceptance/kdrive-token";
const dist = (path: string) => new URL(`../dist/${path}`, import.meta.url).href;
type Result = { ok?: Record<string, unknown>; error?: string };
interface Client {
  callTool(p: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content?: unknown; isError?: unknown }>;
  readResource(p: { uri: string }): Promise<{ contents: unknown[] }>;
  close(): Promise<void>;
}

const started = performance.now();
const counts = new Map<string, number>();
let total = 0,
  bytes = 0;
const summary: { check: string; pass: boolean; ms: number }[] = [];
const maxRequestMs = new Map<string, number>();
let maxInvocationMs = 0,
  timeouts = 0;
// The observer runs synchronously just before the hop's lookup, so the lookup
// wrapper takes the hop's template and start; connections are not reused
// (keepAlive false), so each connect pairs, in lookup-completion order, with
// one hop whose duration ends when its socket closes. No production seam.
let last: { template: string; at: number } | undefined;
const resolved: { template: string; at: number }[] = [];
const observe = (_method: string, template: string) => {
  total++;
  counts.set(template, (counts.get(template) ?? 0) + 1);
  last = { template, at: performance.now() };
};
type Production = typeof import("../src/kdrive/production.ts");
function timedLookup(lookup: Production["productionLookup"]) {
  return (async (hostname: string, options: never) => {
    const hop = last;
    const addresses: unknown = await lookup(hostname, options);
    if (hop) resolved.push(hop);
    return addresses;
  }) as Production["productionLookup"];
}
function timedConnect(connect: Production["productionConnect"]) {
  return ((options) => {
    const socket = connect(options);
    const hop = resolved.shift();
    if (hop)
      socket.once("close", () => {
        const ms = performance.now() - hop.at;
        maxRequestMs.set(
          hop.template,
          Math.max(maxRequestMs.get(hop.template) ?? 0, ms),
        );
      });
    return socket;
  }) as Production["productionConnect"];
}

/** BR-215 v2: a REQUEST_TIMEOUT result fails the check that met it. */
export function timedOut(r: Result): boolean {
  return r.error?.includes("REQUEST_TIMEOUT") === true;
}

const TEMPLATES = new Set(
  [
    routes.init(),
    routes.item(1, 1),
    routes.children(1, 1),
    routes.search(1, "a", undefined),
    routes.recents(1),
    routes.myShared(1),
    routes.sharedWithMe(),
    routes.download(1, 1),
  ].map((r) => r.template),
);
const known = (map: ReadonlyMap<string, number>) =>
  Object.fromEntries(
    [...map]
      .filter(([template]) => TEMPLATES.has(template))
      .map(([template, value]) => [template, Math.round(value)]),
  );

export interface AcceptanceState {
  readonly sha: string | undefined;
  readonly total: number;
  readonly counts: ReadonlyMap<string, number>;
  readonly maxRequestMs: ReadonlyMap<string, number>;
  readonly maxInvocationMs: number;
  readonly bytes: number;
  readonly ms: number;
  readonly checks: readonly { check: string; pass: boolean; ms: number }[];
}

/** BR-215 v2: the sanitized summary; only route templates and numbers. */
export function formatReport(state: AcceptanceState): string {
  const report = {
    sha: /^[0-9a-f]{40}$/u.test(state.sha ?? "") ? state.sha : "unknown",
    requests: state.total,
    requestsWithinBound: state.total <= MAX_REQUESTS,
    byTemplate: known(state.counts),
    maxRequestMs: known(state.maxRequestMs),
    maxInvocationMs: Math.round(state.maxInvocationMs),
    bytes: state.bytes,
    ms: Math.round(state.ms),
    checks: state.checks.map((c) => ({
      check: c.check,
      pass: c.pass,
      ms: Math.round(c.ms),
    })),
  };
  return `${JSON.stringify(report, null, 1)}\n`;
}
const downloads = () => counts.get("/2/drive/{d}/files/{f}/download") ?? 0;
const metadata = () => counts.get("/3/drive/{d}/files/{f}") ?? 0;

async function check(name: string, run: () => Promise<boolean>) {
  const at = performance.now();
  const before = timeouts;
  let pass = false;
  try {
    if (performance.now() - started > MAX_MS) throw new Error("time");
    pass = await run();
  } catch {
    pass = false;
  }
  if (timeouts !== before) pass = false;
  summary.push({ check: name, pass, ms: Math.round(performance.now() - at) });
}
const result = (r: { content?: unknown; isError?: unknown }): Result => {
  const text = (r.content as { text?: string }[] | undefined)?.[0]?.text ?? "";
  if (r.isError === true) return { error: text };
  try {
    return { ok: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { error: "UNPARSED" };
  }
};

export class LineTransport {
  onmessage?: (m: unknown) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;
  private buffer = "";
  private readonly input: PassThrough;
  private readonly output: PassThrough;
  // BR-215 v2: no parameter properties; Node type stripping runs this file.
  constructor(input: PassThrough, output: PassThrough) {
    this.input = input;
    this.output = output;
  }
  start() {
    this.output.on("data", (d: Buffer) => {
      this.buffer += d.toString();
      for (
        let i = this.buffer.indexOf("\n");
        i >= 0;
        i = this.buffer.indexOf("\n")
      ) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        if (line.trim()) {
          const message: unknown = JSON.parse(line);
          setImmediate(() => this.onmessage?.(message));
        }
      }
    });
    return Promise.resolve();
  }
  send(m: unknown) {
    this.input.write(`${JSON.stringify(m)}\n`);
    return Promise.resolve();
  }
  close() {
    this.onclose?.();
    return Promise.resolve();
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => {
    server.listen(0, "127.0.0.1", () => {
      r();
    });
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => {
    server.close(() => {
      r();
    });
  });
  return port;
}

/** One in-process main(deps) run with the production transport. */
async function session(env: Record<string, string>, http: boolean) {
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
    StreamableHTTPClientTransport: new (url: URL) => unknown;
  };
  const input = new PassThrough(),
    output = new PassThrough(),
    signals = new EventEmitter();
  const port = http ? await freePort() : 0;
  const handle = await main({
    argv: http ? ["--http", "--insecure-no-auth"] : [],
    env: {
      ...env,
      KDRIVE_TOKEN_FILE: TOKEN_FILE,
      ...(http ? { MCP_HTTP_PORT: String(port) } : {}),
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
    lookup: (host, options) =>
      total > MAX_REQUESTS
        ? Promise.reject(new Error("budget"))
        : timedLookup(production.productionLookup)(host, options),
    connect: timedConnect(production.productionConnect),
    onRequest: observe,
  });
  if (!handle) throw new Error("start");
  const client = new sdk.Client({ name: "kdrive-acceptance", version: "1" });
  await client.connect(
    http
      ? new sdk.StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${String(port)}/`),
        )
      : new LineTransport(input, output),
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const at = performance.now();
    const r = result(await client.callTool({ name, arguments: args }));
    maxInvocationMs = Math.max(maxInvocationMs, performance.now() - at);
    if (timedOut(r)) timeouts++;
    return r;
  };
  return {
    client,
    call,
    async close() {
      await client.close();
      await handle.close();
    },
  };
}

async function prompt(text: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`${text}\n`);
  rl.close();
  return performance.now();
}

/** Paths for deny patterns come from fresh metadata in process; never printed. */
async function paths(token: string, m: Manifest) {
  const kdrive = (await import(
    dist("kdrive/index.js")
  )) as typeof import("../src/kdrive/index.ts");
  const production = (await import(
    dist("kdrive/production.js")
  )) as typeof import("../src/kdrive/production.ts");
  const adapter = kdrive.createKdriveAdapter({
    token,
    lookup: timedLookup(production.productionLookup),
    connect: timedConnect(production.productionConnect),
    onRequest: observe,
  });
  const own = (await adapter.dependencies.inspect(
    { driveId: m.driveId, id: m.denyChildId },
    "live",
  )) as { path?: string };
  const shared = (await adapter.dependencies.received.inspect(
    { driveId: m.received.driveId, id: m.received.denyId },
    "live",
  )) as { path?: string };
  const binary = (await adapter.dependencies.inspect(
    { driveId: m.driveId, id: m.binaryId },
    "live",
  )) as { name?: string };
  if (!own.path || !shared.path || !binary.name) throw new Error("fixtures");
  return {
    adapter,
    deny: own.path,
    sharedDeny: shared.path,
    binaryName: binary.name,
  };
}

/** Simulated directory or share effect through createPolicy with a spy execute. */
async function simulated(
  token: string,
  env: Record<string, string>,
  op: Record<string, unknown>,
) {
  const config = (await import(
    dist("config.js")
  )) as typeof import("../src/config.ts");
  const policyModule = (await import(
    dist("policy/index.js")
  )) as typeof import("../src/policy/index.ts");
  const kdrive = (await import(
    dist("kdrive/index.js")
  )) as typeof import("../src/kdrive/index.ts");
  const production = (await import(
    dist("kdrive/production.js")
  )) as typeof import("../src/kdrive/production.ts");
  const adapter = kdrive.createKdriveAdapter({
    token,
    lookup: timedLookup(production.productionLookup),
    connect: timedConnect(production.productionConnect),
    onRequest: observe,
  });
  const local = await config.loadConfiguration({
    argv: [],
    env: { ...env, KDRIVE_TOKEN_FILE: TOKEN_FILE },
  });
  const resolved = await config.preflightConfiguration(
    config.withoutCredential(local),
    adapter.preflight,
  );
  let executed = 0;
  const policy = policyModule.createPolicy(resolved, {
    ...adapter.dependencies,
    execute: () => {
      executed++;
      return Promise.resolve({ simulated: true });
    },
  });
  const outcome = (await policy.dispatch(op)) as { ok: boolean };
  return { ok: outcome.ok, executed };
}

async function packagedSmoke(env: Record<string, string>, m: Manifest) {
  const child = spawn(process.execPath, ["dist/cli.js"], {
    env: {
      PATH: process.env.PATH ?? "",
      ...env,
      KDRIVE_TOKEN_FILE: TOKEN_FILE,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const wait = async (id: number) => {
    for (let i = 0; i < 300; i++) {
      const line = out
        .split("\n")
        .find((l) => l.includes(`"id":${String(id)}`));
      if (line) return JSON.parse(line) as Record<string, unknown>;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout");
  };
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1" },
      },
    });
    await wait(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = (await wait(2)).result as { tools: unknown[] };
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "kdrive_info",
        arguments: { drive_id: m.driveId, file_id: m.binaryId },
      },
    });
    const read = (await wait(3)).result as { isError?: boolean };
    return tools.tools.length === 10 && read.isError !== true;
  } finally {
    child.kill("SIGTERM");
  }
}

export async function acceptance(m: Manifest, token: string) {
  const d = m.driveId,
    r = m.received;
  const fixtures = await paths(token, m);
  const runA = {
    KDRIVE_ID: String(d),
    KDRIVE_MCP_ROOTS: `${String(d)}:${String(m.namespaceId)}`,
    KDRIVE_MCP_DENY: fixtures.deny,
  };
  const runB = { ...runA, KDRIVE_MCP_ROOTS: `${String(d)}:1` };
  const runC = {
    ...runA,
    KDRIVE_MCP_SHARED_WITH_ME: "1",
    KDRIVE_MCP_DENY: fixtures.sharedDeny,
  };
  for (const [label, env] of [
    ["A", runA],
    ["B", runB],
  ] as const) {
    const s = await session(env, false);
    // F-014 v5 AC-23: run B's root `1` contains the outside-scope item.
    const refused =
      label === "A"
        ? [m.denyChildId, m.outsideId, m.missingId]
        : [m.denyChildId, m.missingId];
    await check(
      `AC-23 ${label} permitted reads with fresh metadata`,
      async () => {
        const ids = [
          m.binaryId,
          m.nestedId,
          ...(label === "B" ? [1, m.outsideId] : []),
        ];
        for (const id of ids)
          if (!(await s.call("kdrive_info", { drive_id: d, file_id: id })).ok)
            return false;
        const before = metadata();
        await s.call("kdrive_info", { drive_id: d, file_id: m.binaryId });
        const once = metadata() - before;
        await s.call("kdrive_info", { drive_id: d, file_id: m.binaryId });
        return once >= 1 && metadata() - before === 2 * once;
      },
    );
    await check(
      `AC-23 ${label} list and search return permitted entries and omit denied ones`,
      async () => {
        const list = await s.call("kdrive_list", {
          drive_id: d,
          folder_id: m.namespaceId,
        });
        const search = await s.call("kdrive_search", {
          drive_id: d,
          query: fixtures.binaryName,
        });
        const listed = (list.ok?.items as { id: number }[] | undefined) ?? [];
        const found = (search.ok?.items as { id: number }[] | undefined) ?? [];
        return (
          listed.length > 0 &&
          found.some((e) => e.id === m.binaryId) &&
          ![...listed, ...found].some((e) => refused.includes(e.id))
        );
      },
    );
    await check(
      label === "A"
        ? "AC-23 A denied, outside and nonexistent items are denied"
        : "AC-23 B denied and nonexistent items are denied",
      async () => {
        for (const id of refused)
          if (
            (await s.call("kdrive_info", { drive_id: d, file_id: id }))
              .error !== "ACCESS_DENIED"
          )
            return false;
        return true;
      },
    );
    await s.close();
    await check(
      `AC-23 ${label} 1,001-child traversal authorizes the simulated effect`,
      async () => {
        const outcome = await simulated(
          token,
          { ...env, KDRIVE_MCP_MODE: "write" },
          { kind: "trash", target: { driveId: d, id: m.paginationId } },
        );
        return outcome.ok && outcome.executed === 1;
      },
    );
  }
  for (const http of [false, true]) {
    const s = await session(runA, http);
    const mode = http ? "HTTP" : "stdio";
    await check(`AC-24 ${mode} tool and resource read the binary`, async () => {
      const info = await s.call("kdrive_info", {
        drive_id: d,
        file_id: m.binaryId,
      });
      const resource = await s.client.readResource({
        uri: `kdrive://${String(d)}/file/${String(m.binaryId)}`,
      });
      const blob =
        (resource.contents[0] as { blob?: string } | undefined)?.blob ?? "";
      bytes += Buffer.from(blob, "base64").length;
      return info.ok !== undefined && Buffer.from(blob, "base64").length === 16;
    });
    await check(
      `AC-24 ${mode} outside item is denied without a download`,
      async () => {
        const before = downloads();
        const tool = await s.call("kdrive_download", {
          drive_id: d,
          file_id: m.outsideId,
        });
        let resourceDenied = false;
        try {
          await s.client.readResource({
            uri: `kdrive://${String(d)}/file/${String(m.outsideId)}`,
          });
        } catch (error) {
          resourceDenied = (error as Error).message.includes("ACCESS_DENIED");
        }
        return (
          tool.error === "ACCESS_DENIED" &&
          resourceDenied &&
          downloads() === before
        );
      },
    );
    await s.close();
  }
  await check("AC-24 packaged CLI stdio smoke", () => packagedSmoke(runA, m));
  const c = await session(runC, false);
  await check("AC-25 discovery and received reads", async () => {
    const listed = await c.call("kdrive_shared_with_me", {});
    const ids = ((listed.ok?.items as { id: number }[] | undefined) ?? []).map(
      (e) => e.id,
    );
    if (!ids.includes(r.rootId) || !ids.includes(r.revocableId)) return false;
    for (const id of [r.rootId, r.childId, r.grandchildId]) {
      const info = await c.call("kdrive_info", {
        drive_id: r.driveId,
        file_id: id,
      });
      if (
        !String(
          (info.ok?.item as { path?: string } | undefined)?.path,
        ).startsWith("/Shared/")
      )
        return false;
    }
    return true;
  });
  await check(
    "AC-25 scoped child listing takes at least six upstream pages",
    async () => {
      // F-014 v7: count upstream children pages (50 entries each), not
      // tool pages, which aggregate several upstream pages.
      const CHILDREN = "/3/drive/{d}/files/{f}/files";
      const before = counts.get(CHILDREN) ?? 0;
      let cursor: string | undefined,
        pages = 0;
      do {
        const page = await c.call("kdrive_list", {
          drive_id: r.driveId,
          folder_id: r.childId,
          ...(cursor ? { cursor } : {}),
        });
        if (!page.ok) return false;
        pages++;
        cursor = page.ok.next_cursor as string | undefined;
      } while (cursor && pages < 10);
      return !cursor && (counts.get(CHILDREN) ?? 0) - before >= 6;
    },
  );
  await check(
    "AC-25 unrelated, denied and external-root requests are refused",
    async () => {
      const unrelated = await c.call("kdrive_info", {
        drive_id: r.driveId,
        file_id: r.unrelatedId,
      });
      const denied = await c.call("kdrive_info", {
        drive_id: r.driveId,
        file_id: r.denyId,
      });
      const root = await c.call("kdrive_list", {
        drive_id: r.driveId,
        folder_id: 1,
      });
      return (
        unrelated.error !== undefined &&
        denied.error !== undefined &&
        root.error !== undefined
      );
    },
  );
  await check(
    "AC-25 simulated re-share of the received root is denied",
    async () => {
      const outcome = await simulated(
        token,
        { ...runC, KDRIVE_MCP_MODE: "share" },
        { kind: "share-link", target: { driveId: r.driveId, id: r.rootId } },
      );
      return !outcome.ok && outcome.executed === 0;
    },
  );
  await check(
    "AC-25 revocation is enforced once the snapshot is 60 s old",
    async () => {
      if (
        !(
          await c.call("kdrive_info", {
            drive_id: r.driveId,
            file_id: r.revocableId,
          })
        ).ok
      )
        return false;
      const confirmed = await prompt(
        "AC-25: have the second account remove the revocable share, then press Enter.",
      );
      const wait = confirmed + 60_000 - performance.now();
      if (wait > 0) await new Promise((x) => setTimeout(x, wait));
      // F-014 v6 AC-25 / D-23: kDrive may refuse the removed share itself
      // (403 → READ_UNAVAILABLE); that code also covers transient failures,
      // so it counts only with the share gone from discovery, the received
      // root still listed, and a repeated refusal.
      const read = () =>
        c.call("kdrive_info", { drive_id: r.driveId, file_id: r.revocableId });
      const first = await read();
      if (first.ok !== undefined) return false;
      if (first.error === "ACCESS_DENIED") return true;
      if (first.error !== "READ_UNAVAILABLE") return false;
      const listed = await c.call("kdrive_shared_with_me", {});
      const ids = (
        (listed.ok?.items as { id: number }[] | undefined) ?? []
      ).map((e) => e.id);
      if (!ids.includes(r.rootId) || ids.includes(r.revocableId)) return false;
      const again = await read();
      return (
        again.ok === undefined &&
        (again.error === "ACCESS_DENIED" || again.error === "READ_UNAVAILABLE")
      );
    },
  );
  await c.close();
  const v = await session({ ...runA }, false);
  await check(
    "AC-26 version change gives a new etag and VERSION_CHANGED",
    async () => {
      const args = {
        drive_id: d,
        file_id: m.versionFileId,
        offset_bytes: 0,
        length_bytes: 1,
      };
      const first = await v.call("kdrive_download", args);
      const second = await v.call("kdrive_download", args);
      const etag = first.ok?.etag;
      if (typeof etag !== "string" || second.ok?.etag !== etag) return false;
      await prompt(
        "AC-26: edit the version-change file in the kDrive web interface, then press Enter.",
      );
      const next = await v.call("kdrive_download", args);
      const continued = await v.call("kdrive_download", { ...args, etag });
      return (
        typeof next.ok?.etag === "string" &&
        next.ok.etag !== etag &&
        continued.error === "VERSION_CHANGED"
      );
    },
  );
  await v.close();
}

async function main() {
  const token = readFileSync(
    process.env.KDRIVE_TOKEN_FILE ?? TOKEN_FILE,
    "utf8",
  ).replace(/\r?\n$/u, "");
  const manifest = parseManifest(
    readFileSync("/run/kdrive-acceptance/fixtures.json", "utf8"),
  );
  const timer = setTimeout(() => {
    process.stdout.write("kdrive-acceptance: 900,000 ms bound reached.\n");
    process.exit(1);
  }, MAX_MS);
  try {
    await acceptance(manifest, token);
  } catch {
    summary.push({
      check: "acceptance run",
      pass: false,
      ms: Math.round(performance.now() - started),
    });
  } finally {
    clearTimeout(timer);
  }
  process.stdout.write(
    formatReport({
      sha: process.env.KDRIVE_ACCEPTANCE_SHA,
      total,
      counts,
      maxRequestMs,
      maxInvocationMs,
      bytes,
      ms: performance.now() - started,
      checks: summary,
    }),
  );
  process.exitCode =
    summary.every((s) => s.pass) && total <= MAX_REQUESTS ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main();

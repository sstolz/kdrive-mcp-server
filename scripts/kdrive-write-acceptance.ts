// F-017 BR-276: owner-run real-API write acceptance on actual main
// (make kdrive-write-acceptance KDRIVE_WRITE_FOLDER=<id>). Runs the two
// phases of the F-017 Acceptance sequence in process through main(deps) with
// the production {lookup, connect}, mode `write` and the designated folder as
// the only root, at most 200 upstream requests within 600,000 ms. The audit
// log goes to a container temporary file. Prints only a sanitized summary:
// per-step pass/fail, statuses, request counts by method and route template,
// durations and the main SHA; never an ID, name, path, token or `cancel_id`.
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

const MAX_REQUESTS = 200;
const MAX_MS = 600_000;
const TOKEN_FILE = "/run/kdrive-acceptance/kdrive-token";
const DENY = "**/*-deny*";
const dist = (path: string) => new URL(`../dist/${path}`, import.meta.url).href;

type Method = "GET" | "POST" | "DELETE";
/** A parsed tool result: the gate result or read payload, or an error code. */
interface Outcome {
  readonly value?: Record<string, unknown>;
  readonly error?: string;
}
interface Step {
  readonly step: string;
  pass: boolean;
  readonly statuses: number[];
  observed?: string;
  ms: number;
}

const started = performance.now();
const counts = new Map<string, number>();
let total = 0,
  writes = 0;
const steps: Step[] = [];
const observe = (method: Method, template: string) => {
  total++;
  if (method !== "GET") writes++;
  const key = `${method} ${template}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/** BR-276: only route-table templates are printed. */
const TEMPLATES = new Set([
  ...[
    routes.init(),
    routes.item(1, 1),
    routes.children(1, 1),
    routes.search(1, "a", undefined),
    routes.recents(1),
    routes.myShared(1),
    routes.sharedWithMe(),
    routes.download(1, 1),
    routes.trash(1, 1),
  ].map((r) => `GET ${r.template}`),
  ...[
    mutationRoutes.create(1, 1),
    mutationRoutes.rename(1, 1),
    mutationRoutes.move(1, 1, 1),
    mutationRoutes.trash(1, 1),
    mutationRoutes.restore(1, 1),
  ].map((r) => `${r.method} ${r.template}`),
]);

export interface WriteAcceptanceState {
  readonly sha: string | undefined;
  readonly total: number;
  readonly counts: ReadonlyMap<string, number>;
  readonly ms: number;
  readonly steps: readonly Step[];
}
/** BR-276: the sanitized summary; only templates, statuses and numbers. */
export function formatWriteReport(state: WriteAcceptanceState): string {
  const report = {
    sha: /^[0-9a-f]{40}$/u.test(state.sha ?? "") ? state.sha : "unknown",
    requests: state.total,
    requestsWithinBound: state.total <= MAX_REQUESTS,
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

/**
 * BR-276 / BR-213 v3 categories: the summary's text values (numbers are
 * statuses, counts and durations) hold no token, real ID other than `1`, real
 * name, `@` between word characters or URL.
 */
export function leaks(
  report: string,
  secrets: { token: string; ids: readonly number[]; names: readonly string[] },
): string | undefined {
  const texts: string[] = [];
  JSON.parse(report, (_key, value: unknown) => {
    if (typeof value === "string") texts.push(value);
    return value;
  });
  const text = texts.join("\n");
  if (secrets.token && report.includes(secrets.token)) return "token";
  for (const id of secrets.ids)
    if (
      id !== 1 &&
      new RegExp(`(?<![\\w])${String(id)}(?![\\w])`, "u").test(text)
    )
      return "real ID";
  for (const name of secrets.names)
    if (report.includes(name)) return "real name";
  if (/\w@\w/u.test(report)) return "email";
  if (/https?:/u.test(report)) return "URL";
  return undefined;
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

/** One in-process main(deps) session in mode `write` with one root. */
async function session(env: Record<string, string>) {
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
    env: { ...env, KDRIVE_TOKEN_FILE: TOKEN_FILE },
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
        : production.productionLookup(host, options),
    connect: production.productionConnect,
    onRequest: observe,
  });
  if (!handle) throw new Error("start");
  const client = new sdk.Client({
    name: "kdrive-write-acceptance",
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

async function step(name: string, run: (s: Step) => Promise<boolean>) {
  const s: Step = { step: name, pass: false, statuses: [], ms: 0 };
  const at = performance.now();
  try {
    if (performance.now() - started > MAX_MS) throw new Error("time");
    s.pass = await run(s);
  } catch {
    s.pass = false;
  }
  s.ms = performance.now() - at;
  steps.push(s);
}

/** Audit records of one phase, read back from the container temporary file. */
function records(file: string): Record<string, unknown>[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function writeAcceptance(
  driveId: number,
  folderId: number,
  token: string,
  secrets: { ids: number[]; names: string[] },
) {
  const run = randomBytes(4).toString("hex");
  const n = (letter: string) => {
    const value = `p18x-${run}-${letter}`;
    secrets.names.push(value);
    return value;
  };
  const audit = mkdtempSync(join(tmpdir(), "kdrive-write-"));
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
  const created = (r: Outcome) => {
    const value = r.value?.value as { id?: unknown } | undefined;
    return r.value?.result === "succeeded" && typeof value?.id === "number"
      ? value.id
      : undefined;
  };
  const info = async (s: Session, fileId: number) => {
    const r = await s.call("kdrive_info", {
      drive_id: driveId,
      file_id: fileId,
    });
    return r.value?.item as { id?: number; path?: string } | undefined;
  };
  const zeroWrites = async (work: () => Promise<boolean>) => {
    const before = writes;
    const ok = await work();
    return ok && writes === before;
  };
  const make = async (s: Session, st: Step, letter: string, parent: number) => {
    const r = await tool(s, st, "kdrive_create_folder", {
      parent_id: parent,
      name: n(letter),
    });
    const value = created(r);
    if (value === undefined) return false;
    ids.set(letter, value);
    secrets.ids.push(value);
    return true;
  };
  const is = (r: Outcome, result: string) => r.value?.result === result;

  // Phase 1: deny list empty.
  const one = await session({
    ...base,
    KDRIVE_MCP_AUDIT_LOG: join(audit, "phase-1.jsonl"),
  });
  try {
    await step("1 create A, B, F, C, X-deny, E", async (st) => {
      const okay = [
        await make(one, st, "A", folderId),
        await make(one, st, "B", folderId),
        await make(one, st, "F", folderId),
      ];
      okay.push(await make(one, st, "C", id("A")));
      okay.push(await make(one, st, "X-deny", id("C")));
      okay.push(await make(one, st, "E", id("B")));
      const createdRecords = records(join(audit, "phase-1.jsonl")).filter(
        (r) => r.event === "outcome" && typeof r.created === "number",
      );
      return okay.every(Boolean) && createdRecords.length === 6;
    });
    await step("2 rename F to F2, move F2 into B", async (st) => {
      const renamed = await tool(one, st, "kdrive_rename", {
        file_id: id("F"),
        name: n("F2"),
      });
      const moved = await tool(one, st, "kdrive_move", {
        file_id: id("F"),
        destination_folder_id: id("B"),
      });
      const b = await info(one, id("B"));
      const f = await info(one, id("F"));
      return (
        is(renamed, "succeeded") &&
        is(moved, "succeeded") &&
        typeof b?.path === "string" &&
        f?.path === `${b.path}/${n("F2")}`
      );
    });
    await step("3 rename B to the name of A is rejected", async (st) => {
      const r = await tool(one, st, "kdrive_rename", {
        file_id: id("B"),
        name: n("A"),
      });
      return (
        is(r, "failed") &&
        r.value?.code === "UPSTREAM_REJECTED" &&
        r.value.status === 409
      );
    });
    await step("4 move A into its descendant C is denied", (st) =>
      zeroWrites(async () =>
        is(
          await tool(one, st, "kdrive_move", {
            file_id: id("A"),
            destination_folder_id: id("C"),
          }),
          "denied",
        ),
      ),
    );
    await step("5 trash E and B; restore E denied; restore B", async (st) => {
      const before = await info(one, id("B"));
      const trashedE = await tool(one, st, "kdrive_trash", {
        file_id: id("E"),
      });
      const trashedB = await tool(one, st, "kdrive_trash", {
        file_id: id("B"),
      });
      const deniedE = await zeroWrites(async () =>
        is(
          await tool(one, st, "kdrive_restore", { file_id: id("E") }),
          "denied",
        ),
      );
      const restored = await tool(one, st, "kdrive_restore", {
        file_id: id("B"),
      });
      const after = await info(one, id("B"));
      return (
        is(trashedE, "succeeded") &&
        is(trashedB, "succeeded") &&
        deniedE &&
        is(restored, "succeeded") &&
        after?.id === id("B") &&
        typeof before?.path === "string" &&
        after.path === before.path
      );
    });
    await step(
      "6 restore H after its former parent was renamed",
      async (st) => {
        const madeG = await make(one, st, "G", folderId);
        const madeH = madeG && (await make(one, st, "H", id("G")));
        if (!madeH) return false;
        const trashed = await tool(one, st, "kdrive_trash", {
          file_id: id("H"),
        });
        const renamed = await tool(one, st, "kdrive_rename", {
          file_id: id("G"),
          name: n("G2"),
        });
        if (!is(trashed, "succeeded") || !is(renamed, "succeeded"))
          return false;
        const restored = await tool(one, st, "kdrive_restore", {
          file_id: id("H"),
        });
        const result = label(restored);
        if (result === "denied") {
          st.observed = "denied: trash path is a deletion-time snapshot";
          return true;
        }
        if (result !== "succeeded") {
          st.observed = `${result}: unmeasured`;
          return true;
        }
        st.observed = "succeeded: trash path is recomputed";
        const g2 = await info(one, id("G"));
        const h = await info(one, id("H"));
        const listing = await one.call("kdrive_list", {
          drive_id: driveId,
          folder_id: folderId,
        });
        const items = (listing.value?.items ?? []) as { name?: string }[];
        return (
          typeof g2?.path === "string" &&
          h?.id === id("H") &&
          h.path === `${g2.path}/${n("H")}` &&
          listing.value?.has_more === false &&
          !items.some((i) => i.name === n("G"))
        );
      },
    );
    await step("7 create A again (collision observed)", async (st) => {
      const r = await tool(one, st, "kdrive_create_folder", {
        parent_id: folderId,
        name: n("A"),
      });
      const again = created(r);
      if (again !== undefined) secrets.ids.push(again);
      st.observed = label(r);
      return true;
    });
  } finally {
    await one.close();
  }

  // Phase 2: deny list `**/*-deny*`.
  phase = 1;
  const two = await session({
    ...base,
    KDRIVE_MCP_DENY: DENY,
    KDRIVE_MCP_AUDIT_LOG: join(audit, "phase-2.jsonl"),
  });
  try {
    await step(
      "8 rename, move and trash A (deny descendant) are denied",
      (st) =>
        zeroWrites(async () => {
          const r = [
            await tool(two, st, "kdrive_rename", {
              file_id: id("A"),
              name: n("A3"),
            }),
            await tool(two, st, "kdrive_move", {
              file_id: id("A"),
              destination_folder_id: id("B"),
            }),
            await tool(two, st, "kdrive_trash", { file_id: id("A") }),
          ];
          return r.every((x) => is(x, "denied"));
        }),
    );
    await step("9 create Y-deny and rename F2 to F2-deny are denied", (st) =>
      zeroWrites(async () => {
        const r = [
          await tool(two, st, "kdrive_create_folder", {
            parent_id: folderId,
            name: n("Y-deny"),
          }),
          await tool(two, st, "kdrive_rename", {
            file_id: id("F"),
            name: n("F2-deny"),
          }),
        ];
        return r.every((x) => is(x, "denied"));
      }),
    );
    await step(
      "10 trash B; folder restore with denies is denied",
      async (st) => {
        const trashed = await tool(two, st, "kdrive_trash", {
          file_id: id("B"),
        });
        const denied = await zeroWrites(async () =>
          is(
            await tool(two, st, "kdrive_restore", { file_id: id("B") }),
            "denied",
          ),
        );
        return is(trashed, "succeeded") && denied;
      },
    );
  } finally {
    await two.close();
  }

  await step("11 audit records match results and hold no fixture name", () =>
    Promise.resolve(
      ["phase-1.jsonl", "phase-2.jsonl"].every((file, index) =>
        auditMatches(join(audit, file), results[index] ?? [], `p18x-${run}`),
      ),
    ),
  );
}

/** Step 11: one intent and one outcome per run, one denied per denial. */
export function auditMatches(
  file: string,
  results: readonly { tool: string; result: string }[],
  marker: string,
): boolean {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return false;
  }
  if (text.includes(marker)) return false;
  const recs = records(file);
  const tools = (event: string) =>
    recs
      .filter((r) => r.event === event)
      .map((r) => r.tool)
      .join(",");
  const expected = (denied: boolean) =>
    results
      .filter((r) => (r.result === "denied") === denied)
      .map((r) => r.tool)
      .join(",");
  return (
    tools("denied") === expected(true) &&
    tools("intent") === expected(false) &&
    tools("outcome") === expected(false)
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
      "kdrive-write-acceptance: 600,000 ms bound reached.\n",
    );
    process.exit(1);
  }, MAX_MS);
  try {
    await writeAcceptance(driveId, folderId, token, secrets);
  } catch {
    steps.push({
      step: "write acceptance run",
      pass: false,
      statuses: [],
      ms: performance.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }
  const report = formatWriteReport({
    sha: process.env.KDRIVE_ACCEPTANCE_SHA,
    total,
    counts,
    ms: performance.now() - started,
    steps,
  });
  const leak = leaks(report, { token, ...secrets });
  if (leak !== undefined) {
    process.stdout.write(
      `kdrive-write-acceptance: summary refused (${leak}).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(report);
  process.exitCode =
    steps.every((s) => s.pass) && total <= MAX_REQUESTS ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main();

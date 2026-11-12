// F-014 BR-211: owner-run recording of sanitized kDrive fixtures. Runs only
// inside the dev Compose service (make kdrive-record), reads the token and
// the private manifest from /run/kdrive-acceptance, issues at most 200 GET
// requests within 600,000 ms through the production transport, and writes
// only sanitized recordings under artifacts/kdrive-recordings/<run>/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeSanitized, type RawExchange } from "./kdrive-sanitize.ts";

export const MAX_REQUESTS = 200;
export const MAX_MS = 600_000;
const MANIFEST = "/run/kdrive-acceptance/fixtures.json";

export interface Manifest {
  readonly driveId: number;
  readonly namespaceId: number;
  readonly binaryId: number;
  readonly nestedId: number;
  readonly paginationId: number;
  readonly outsideId: number;
  readonly denyChildId: number;
  readonly missingId: number;
  readonly versionFileId: number;
  readonly received: {
    readonly driveId: number;
    readonly rootId: number;
    readonly childId: number;
    readonly grandchildId: number;
    readonly denyId: number;
    readonly revocableId: number;
    readonly unrelatedId: number;
  };
}
type Route = { readonly template: string; readonly target: string };
type Hop = {
  status: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Buffer;
};
export interface Recorder {
  record(route: Route, range?: string): Promise<Hop[]>;
}
type Routes = typeof import("../src/kdrive/routes.ts").routes;

const positive = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export function parseManifest(text: string): Manifest {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("The fixture manifest is invalid.");
  }
  const received = value.received as Record<string, unknown> | undefined;
  const top = [
    "driveId",
    "namespaceId",
    "binaryId",
    "nestedId",
    "paginationId",
    "outsideId",
    "denyChildId",
    "missingId",
    "versionFileId",
  ];
  const nested = [
    "driveId",
    "rootId",
    "childId",
    "grandchildId",
    "denyId",
    "revocableId",
    "unrelatedId",
  ];
  if (
    !top.every((k) => positive(value[k])) ||
    !received ||
    !nested.every((k) => positive(received[k]))
  )
    throw new Error("The fixture manifest is invalid.");
  return value as unknown as Manifest;
}

/** Per route template: requests (hops) and the longest request in ms. */
export interface RouteTiming {
  requests: number;
  maxMs: number;
}
/** BR-211 v2: the most children pages recorded for one folder. */
export const MAX_FOLDER_PAGES = 32;

/**
 * BR-211 v2 success summary: per route template, the request count and the
 * maximum request duration. Templates carry no ID; nothing else is printed.
 */
export function formatSummary(
  timings: ReadonlyMap<string, RouteTiming>,
  exchanges: readonly RawExchange[],
  run: string,
): string {
  const requests = exchanges.reduce((sum, e) => sum + e.hops.length, 0);
  const lines = [
    `kdrive-record: ${String(exchanges.length)} exchanges, ${String(requests)} requests, run ${run}`,
  ];
  for (const [template, t] of [...timings].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    lines.push(
      `  ${template}: ${String(t.requests)} requests, max ${String(Math.round(t.maxMs))} ms`,
    );
  return `${lines.join("\n")}\n`;
}

/** Bounded plan of GET requests (BR-211); every hop counts toward the budget. */
export async function recordSession(
  recorder: Recorder,
  routes: Routes,
  manifest: Manifest,
  // A monotonic clock (BR-211 v2).
  now: () => number = () => performance.now(),
  timings: Map<string, RouteTiming> = new Map(),
): Promise<RawExchange[]> {
  const started = now();
  const exchanges: RawExchange[] = [];
  let requests = 0;
  async function get(
    route: Route,
    params: { d?: number; f?: number },
    range?: string,
  ) {
    if (now() - started > MAX_MS)
      throw new Error("The recording exceeded 600,000 ms.");
    if (requests + (range === undefined ? 1 : 2) > MAX_REQUESTS)
      throw new Error("The recording exceeded 200 requests.");
    let hops: Hop[];
    const begun = now();
    try {
      hops = await recorder.record(route, range);
    } catch {
      requests += 1;
      // Fixed text only: the ordinal, route template and duration carry no ID.
      const ms = Math.round((now() - begun) / 100) * 100;
      throw new Error(
        `A recording request failed (request ${String(exchanges.length + 1)}, ${route.template}, after ${String(ms)} ms).`,
      );
    }
    requests += hops.length;
    const timing = timings.get(route.template) ?? { requests: 0, maxMs: 0 };
    timing.requests += hops.length;
    timing.maxMs = Math.max(timing.maxMs, now() - begun);
    timings.set(route.template, timing);
    const query = [
      ...new URLSearchParams(route.target.split("?")[1] ?? ""),
    ].map(([k, v]) => [k, v] as const);
    exchanges.push({
      template: route.template,
      params,
      query,
      ...(range === undefined ? {} : { range }),
      hops,
    });
    return hops;
  }
  const json = (hops: readonly { readonly body: Uint8Array }[]) => {
    try {
      const last = hops.at(-1);
      return JSON.parse(
        last ? Buffer.from(last.body).toString("utf8") : "",
      ) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  // BR-211 v2: every page through the terminal page, at most 16 per folder.
  async function pages(d: number, f: number) {
    let cursor: string | undefined;
    for (let i = 0; i < MAX_FOLDER_PAGES; i++) {
      const body = json(await get(routes.children(d, f, cursor), { d, f }));
      if (body.has_more !== true || typeof body.cursor !== "string") return;
      cursor = body.cursor;
    }
    throw new Error(
      "The recording found a folder still nonterminal after 32 pages.",
    );
  }
  const m = manifest,
    r = manifest.received;
  await get(routes.init(), {});
  for (const f of [
    1,
    m.namespaceId,
    m.binaryId,
    m.nestedId,
    m.paginationId,
    m.outsideId,
    m.denyChildId,
    m.missingId,
    m.versionFileId,
  ])
    await get(routes.item(m.driveId, f), { d: m.driveId, f });
  for (const f of [m.namespaceId, m.nestedId, m.paginationId])
    await pages(m.driveId, f);
  const binary = json(
    exchanges.find((e) => e.params.f === m.binaryId)?.hops.slice() ?? [],
  ).data as Record<string, unknown> | undefined;
  const query = typeof binary?.name === "string" ? binary.name : "a";
  await get(routes.search(m.driveId, query, m.namespaceId), { d: m.driveId });
  await get(routes.search(m.driveId, query, undefined), { d: m.driveId });
  await get(routes.recents(m.driveId), { d: m.driveId });
  await get(routes.myShared(m.driveId), { d: m.driveId });
  let cursor: string | undefined;
  for (let i = 0; i < 4; i++) {
    const body = json(await get(routes.sharedWithMe(cursor), {}));
    if (body.has_more !== true || typeof body.cursor !== "string") break;
    cursor = body.cursor;
  }
  for (const f of [
    r.rootId,
    r.childId,
    r.grandchildId,
    r.denyId,
    r.revocableId,
    r.unrelatedId,
  ])
    await get(routes.item(r.driveId, f), { d: r.driveId, f });
  for (const f of [r.rootId, r.childId]) await pages(r.driveId, f);
  for (const range of ["bytes=0-0", "bytes=7-9", "bytes=15-15", "bytes=16-16"])
    await get(
      routes.download(m.driveId, m.binaryId),
      { d: m.driveId, f: m.binaryId },
      range,
    );
  await get(
    routes.download(m.driveId, m.versionFileId),
    { d: m.driveId, f: m.versionFileId },
    "bytes=0-0",
  );
  return exchanges;
}

async function main(): Promise<void> {
  const tokenFile = process.env.KDRIVE_TOKEN_FILE ?? "";
  const token = readFileSync(tokenFile, "utf8").replace(/\r?\n$/u, "");
  const manifest = parseManifest(readFileSync(MANIFEST, "utf8"));
  const dist = (path: string) =>
    new URL(`../dist/${path}`, import.meta.url).href;
  const { createTransport } = (await import(
    dist("kdrive/transport.js")
  )) as typeof import("../src/kdrive/transport.ts");
  const { routes } = (await import(
    dist("kdrive/routes.js")
  )) as typeof import("../src/kdrive/routes.ts");
  const production = (await import(
    dist("kdrive/production.js")
  )) as typeof import("../src/kdrive/production.ts");
  const transport = createTransport({
    token,
    lookup: production.productionLookup,
    connect: production.productionConnect,
  });
  const timings = new Map<string, RouteTiming>();
  const exchanges = await recordSession(
    transport,
    routes,
    manifest,
    () => performance.now(),
    timings,
  );
  const ids = new Set<number>([
    manifest.namespaceId,
    manifest.binaryId,
    manifest.nestedId,
    manifest.paginationId,
    manifest.outsideId,
    manifest.denyChildId,
    manifest.versionFileId,
    ...Object.values(manifest.received),
  ]);
  const run = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
  const directory = join("artifacts/kdrive-recordings", run);
  writeSanitized(
    { exchanges, manifestIds: ids, binaryId: manifest.binaryId, token },
    (text) => {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "recording.json"), text);
    },
  );
  process.stdout.write(formatSummary(timings, exchanges, run));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  try {
    await main();
  } catch (error) {
    // Fixed messages only; provider data never reaches the output.
    const known =
      error instanceof Error && /^(The |A recording)/u.test(error.message);
    process.stderr.write(
      `${known ? error.message : "kdrive-record failed."}\n`,
    );
    process.exitCode = 1;
  }

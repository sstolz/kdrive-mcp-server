// F-014 AC-22 (BR-214): the adapter contract suite over the committed
// recordings, replayed through the injected transport with no network.
// tests/fixtures/kdrive/ holds sanitized recordings; `origin: "synthetic"`
// marks the recorder-pipeline sample, owner recordings carry `recorded`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Recording } from "../../scripts/kdrive-sanitize.ts";
import {
  recordingProblems,
  replayHandler,
  syntheticSession,
} from "../helpers/kdrive-replay.js";
import {
  adapterFor,
  invocation,
  signal,
  startUpstream,
  transport,
} from "../helpers/kdrive.js";

const DIRECTORY = "tests/fixtures/kdrive";
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith(".json"));
const load = (name: string) =>
  JSON.parse(readFileSync(join(DIRECTORY, name), "utf8")) as Recording;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function replay(recording: Recording) {
  const upstream = await startUpstream(replayHandler(recording));
  close = () => upstream.close();
  return adapterFor(transport(upstream));
}

describe("BR-214 committed recordings", () => {
  it("TestBR214_committed_recordings_exist_and_use_only_synthetic_forms", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files)
      expect(recordingProblems(load(name)), name).toEqual([]);
  });

  it("TestBR214_the_synthetic_sample_is_the_recorder_pipeline_output", async () => {
    const sample = files.filter((name) => load(name).origin === "synthetic");
    expect(sample).toEqual(["synthetic-session.json"]);
    expect(load("synthetic-session.json")).toEqual(await syntheticSession());
  });

  it.each(files)(
    "TestBR214_contract_suite_replays_%s_with_complete_results",
    // eslint-disable-next-line sonarjs/cognitive-complexity -- F-014: one dispatch per recorded route keeps the contract suite readable
    async (name) => {
      const recording = load(name);
      const a = await replay(recording);
      const roles = new Map<number, string>();
      for (const e of recording.exchanges)
        if (e.template === "/2/drive/init") {
          const data = (
            e.hops[0]?.json as {
              data: { drives: { id: number; role: string }[] };
            }
          ).data;
          for (const d of data.drives) roles.set(d.id, d.role);
          const first = data.drives[0];
          if (first)
            expect(await a.preflight.inspectDrive(first.id)).toEqual(first);
        }
      let checked = 0;
      for (const e of recording.exchanges) {
        const d = e.params.d ?? 0,
          f = e.params.f ?? 0;
        const external = roles.get(d) === "external";
        const status = e.hops[0]?.status ?? 0;
        const cursor = e.query.find(([k]) => k === "cursor")?.[1];
        if (e.template === "/3/drive/{d}/files/{f}") {
          const port = external ? a.dependencies.received : a.dependencies;
          const result = await port.inspect({ driveId: d, id: f }, "live");
          expect(result, `${name} item`).toMatchObject({
            status: status === 404 ? "missing" : "complete",
          });
          checked++;
        } else if (e.template === "/3/drive/{d}/files/{f}/files") {
          const port = external ? a.dependencies.received : a.dependencies;
          const result = await port.children({
            ...invocation(),
            driveId: d,
            id: f,
            location: "live",
            ...(cursor === undefined ? {} : { cursor }),
          });
          expect(result, `${name} children`).toMatchObject({
            status: "complete",
          });
          checked++;
        } else if (e.template === "/3/drive/files/shared_with_me") {
          const result = await a.dependencies.received.list({
            ...invocation(),
            ...(cursor === undefined ? {} : { cursor }),
          });
          expect(result, `${name} shared_with_me`).toMatchObject({
            status: "complete",
            discover: true,
          });
          checked++;
        } else if (
          e.template.endsWith("/download") &&
          e.range === "bytes=0-0" &&
          status !== 416
        ) {
          const described = await a.dependencies.content.describe(
            { driveId: d, id: f },
            signal(),
          );
          expect(described, `${name} describe`).toMatchObject({
            version_bound: true,
          });
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10);
    },
  );

  it("TestBR214_refuses_a_planted_non_synthetic_name_ID_and_member", () => {
    const base = load("synthetic-session.json");
    const plant = (change: (r: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(base)) as Recording;
      const item = copy.exchanges.find(
        (e) =>
          e.template === "/3/drive/{d}/files/{f}" && e.hops[0]?.status === 200,
      );
      change((item?.hops[0]?.json as { data: Record<string, unknown> }).data);
      return recordingProblems(copy);
    };
    expect(plant((d) => (d.name = "Budget 2024"))).toContainEqual(
      expect.stringMatching(/^non-synthetic name/u),
    );
    expect(plant((d) => (d.id = 4242))).toContainEqual(
      expect.stringMatching(/^non-synthetic ID/u),
    );
    expect(plant((d) => (d.created_by = { id: 1 }))).toContainEqual(
      expect.stringMatching(/^member created_by/u),
    );
  });

  it("TestBR203v3_a_recorded_received_descendant_anchors_on_its_share_root", async () => {
    const a = await replay(load("recorded-20261109095250.json"));
    const result = (await a.dependencies.received.inspect(
      { driveId: 1001276, id: 1000053 },
      "live",
    )) as {
      status: string;
      path: string;
      anchorId: number;
      parents: { id: number; path: string }[];
    };
    expect(result.status).toBe("complete");
    expect(result.path).toBe("/Shared/n12/n5/n4");
    expect(result.anchorId).toBe(1000002);
    expect(result.parents.map((m) => [m.id, m.path])).toEqual([
      [1000002, "/Shared/n12"],
      [1000003, "/Shared/n12/n5"],
    ]);
  });

  it("TestBR214v2_refuses_a_planted_separator_cursor_or_ETag", () => {
    const base = load("synthetic-session.json");
    const copy = JSON.parse(JSON.stringify(base)) as Recording;
    const listing = copy.exchanges.find((e) =>
      e.query.some(([k]) => k === "cursor"),
    );
    const download = copy.exchanges.find((e) =>
      e.hops.some((h) => h.headers.etag !== undefined),
    );
    expect(listing && download).toBeTruthy();
    const withCursor = JSON.parse(JSON.stringify(copy)) as Recording;
    const l = withCursor.exchanges[copy.exchanges.indexOf(listing!)]!;
    (l.query as [string, string][]).forEach((pair) => {
      if (pair[0] === "cursor") pair[1] = "cursor-1";
    });
    expect(recordingProblems(withCursor)).toContainEqual(
      expect.stringMatching(/^cursor at/u),
    );
    const withEtag = JSON.parse(JSON.stringify(copy)) as Recording;
    const d = withEtag.exchanges[copy.exchanges.indexOf(download!)]!;
    for (const hop of d.hops)
      if (hop.headers.etag !== undefined)
        (hop.headers as Record<string, string>).etag = '"etag-1"';
    expect(recordingProblems(withEtag)).toContainEqual(
      expect.stringMatching(/^etag at/u),
    );
  });
});

describe("BR-211 recorder bounds", () => {
  const manifest = {
    driveId: 8101,
    namespaceId: 7010,
    binaryId: 7012,
    nestedId: 7011,
    paginationId: 7020,
    outsideId: 7014,
    denyChildId: 7013,
    missingId: 7999,
    versionFileId: 7015,
    received: {
      driveId: 8202,
      rootId: 8500,
      childId: 8501,
      grandchildId: 8502,
      denyId: 8503,
      revocableId: 8504,
      unrelatedId: 8505,
    },
  };
  const page = (more: boolean) =>
    Buffer.from(
      JSON.stringify({
        result: "success",
        data: [],
        has_more: more,
        cursor: more ? "c" : null,
      }),
    );
  it("TestBR211_a_failed_request_names_its_route_template_without_IDs", async () => {
    const { recordSession } = await import("../../scripts/kdrive-record.ts");
    const { routes } = await import("../../src/kdrive/routes.js");
    let calls = 0;
    const failing = recordSession(
      {
        record: () => {
          calls++;
          return calls === 3
            ? Promise.reject(new Error("READ_UNAVAILABLE"))
            : Promise.resolve([
                { status: 200, headers: {}, body: page(false) },
              ]);
        },
      },
      routes,
      manifest,
    );
    const error = (await failing.catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(
      /^A recording request failed \(request 3, \/[^(),]*, after \d+ ms\)\.$/u,
    );
    expect(error.message).not.toMatch(/\b(8101|8202|70\d\d|85\d\d)\b/u);
  });
  it("TestBR211_malformed_manifest_JSON_gives_the_fixed_invalid_message", async () => {
    const { parseManifest } = await import("../../scripts/kdrive-record.ts");
    expect(() => parseManifest('{"driveId": REPLACE}')).toThrow(
      "The fixture manifest is invalid.",
    );
  });
  it("TestBR211_the_recording_plan_stays_within_200_GET_requests", async () => {
    const { recordSession } = await import("../../scripts/kdrive-record.ts");
    const { routes } = await import("../../src/kdrive/routes.js");
    let requests = 0;
    const perFolder = new Map<string, number>();
    const exchanges = await recordSession(
      {
        record: (route, range) => {
          requests += range === undefined ? 1 : 2;
          // Worst case: every folder ends on its 32nd page.
          const folder = route.target.split("?")[0] ?? "";
          const seen = (perFolder.get(folder) ?? 0) + 1;
          perFolder.set(folder, seen);
          const more =
            !route.template.endsWith("/files/{f}/files") || seen < 32;
          return Promise.resolve(
            Array.from({ length: range === undefined ? 1 : 2 }, () => ({
              status: 200,
              headers: {},
              body: page(more),
            })),
          );
        },
      },
      routes,
      manifest,
    );
    expect(requests).toBeLessThanOrEqual(200);
    expect(exchanges.reduce((sum, e) => sum + e.hops.length, 0)).toBe(requests);
  });
  it("TestBR211_the_recorder_refuses_past_200_requests_or_600000_ms", async () => {
    const { recordSession } = await import("../../scripts/kdrive-record.ts");
    const { routes } = await import("../../src/kdrive/routes.js");
    const heavy = {
      record: () =>
        Promise.resolve(
          Array.from({ length: 20 }, () => ({
            status: 200,
            headers: {},
            body: page(false),
          })),
        ),
    };
    await expect(recordSession(heavy, routes, manifest)).rejects.toThrow(
      "The recording exceeded 200 requests.",
    );
    let clock = 0;
    const slow = {
      record: () => {
        clock += 100_000;
        return Promise.resolve([
          { status: 200, headers: {}, body: page(false) },
        ]);
      },
    };
    await expect(
      recordSession(slow, routes, manifest, () => clock),
    ).rejects.toThrow("The recording exceeded 600,000 ms.");
  });
  const CHILDREN = "/3/drive/{d}/files/{f}/files";
  /** Scripted recorder: the pagination folder has `paginationPages` pages. */
  function scripted(
    paginationPages: number,
    extra: Record<string, unknown> = {},
  ) {
    let pageNumber = 0;
    return {
      record: (route: { template: string; target: string }, range?: string) => {
        let more = false;
        if (
          route.template === CHILDREN &&
          route.target.includes(`/files/${String(manifest.paginationId)}/files`)
        ) {
          pageNumber++;
          more = pageNumber < paginationPages;
        }
        return Promise.resolve(
          Array.from({ length: range === undefined ? 1 : 2 }, () => ({
            status: 200,
            headers: {},
            body: Buffer.from(
              JSON.stringify({
                result: "success",
                data: [],
                has_more: more,
                cursor: more ? `c${String(pageNumber)}` : null,
                ...extra,
              }),
            ),
          })),
        );
      },
    };
  }
  it("TestBR211v3_records_all_21_pages_of_the_1001_child_folder_through_its_terminal_page", async () => {
    const { recordSession } = await import("../../scripts/kdrive-record.ts");
    const { routes } = await import("../../src/kdrive/routes.js");
    const exchanges = await recordSession(scripted(21), routes, manifest);
    const pages = exchanges.filter(
      (e) => e.template === CHILDREN && e.params.f === manifest.paginationId,
    );
    expect(pages).toHaveLength(21);
    expect(
      exchanges.reduce((sum, e) => sum + e.hops.length, 0),
    ).toBeLessThanOrEqual(200);
  });
  it("TestBR211v3_a_folder_nonterminal_after_32_pages_fails_without_writing", async () => {
    const { recordSession } = await import("../../scripts/kdrive-record.ts");
    const { routes } = await import("../../src/kdrive/routes.js");
    // Writing happens only after recordSession resolves (main), so a
    // rejection here means no file is written.
    await expect(recordSession(scripted(33), routes, manifest)).rejects.toThrow(
      "The recording found a folder still nonterminal after 32 pages.",
    );
    await expect(
      recordSession(scripted(32), routes, manifest),
    ).resolves.toBeDefined();
  });
  it("TestBR211_success_summary_lists_per_route_counts_and_max_durations_without_identifiers", async () => {
    const { recordSession, formatSummary } =
      await import("../../scripts/kdrive-record.ts");
    const { routes } = await import("../../src/kdrive/routes.js");
    const planted = {
      id: 987654321,
      name: "planted-secret-name",
      cursorValue: "planted-cursor-value",
      url: "https://planted.example/leak",
    };
    let clock = 0;
    let first = true;
    const inner = scripted(3, {
      data: [{ id: planted.id, name: planted.name, url: planted.url }],
      next: planted.cursorValue,
    });
    const recorder = {
      record: (route: { template: string; target: string }, range?: string) => {
        if (route.template === CHILDREN && first) {
          first = false;
          clock += 1_879;
        } else clock += 25;
        return inner.record(route, range);
      },
    };
    const timings = new Map<string, { requests: number; maxMs: number }>();
    const exchanges = await recordSession(
      recorder,
      routes,
      manifest,
      () => clock,
      timings,
    );
    const summary = formatSummary(timings, exchanges, "20261108000000");
    expect(summary).toContain(`${CHILDREN}: `);
    expect(summary).toMatch(
      new RegExp(
        `${CHILDREN.replace(/[{}]/gu, "\\$&")}: \\d+ requests, max 1879 ms`,
        "u",
      ),
    );
    expect(summary).toMatch(
      /\/3\/drive\/files\/shared_with_me: \d+ requests, max 25 ms/u,
    );
    const total = [...timings.values()].reduce((s, t) => s + t.requests, 0);
    expect(total).toBe(exchanges.reduce((s, e) => s + e.hops.length, 0));
    for (const value of [
      String(planted.id),
      planted.name,
      planted.cursorValue,
      planted.url,
      "planted",
      "https://",
      "c1",
    ])
      expect(summary).not.toContain(value);
    expect(summary).not.toMatch(/\b(8101|8202|70\d\d|85\d\d|7999)\b/u);
  });
});

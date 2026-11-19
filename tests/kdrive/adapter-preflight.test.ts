// F-014 AC-16 (BR-207): production preflight through the adapter.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadConfiguration,
  preflightConfiguration,
  type LocalConfiguration,
} from "../../src/config.js";
import {
  DRIVE,
  adapterFor,
  kdriveFixture,
  providerItem,
  success,
  tree,
  type Node,
  type Reply,
  type Seen,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await fixture?.close();
  fixture = undefined;
});
async function local(roots: string, drives = String(DRIVE)) {
  return loadConfiguration({
    argv: [],
    env: {
      KDRIVE_IDS: drives,
      KDRIVE_TOKEN: "SYNTHETIC",
      KDRIVE_MCP_ROOTS: roots,
    },
  });
}
async function outcome(
  config: LocalConfiguration,
  partial: Parameters<typeof kdriveFixture>[0] = {},
  extra?: (f: Awaited<ReturnType<typeof kdriveFixture>>) => void,
) {
  const f = (fixture = await kdriveFixture(partial));
  extra?.(f);
  const a = await adapterFor(f);
  try {
    return { resolved: await preflightConfiguration(config, a.preflight), f };
  } catch (error) {
    return {
      code: (error as { code: string }).code,
      setting: (error as { setting: string }).setting,
      f,
    };
  }
}
const dup: Node[] = [
  ...tree,
  { id: 30, parent: 10, type: "dir", name: "docs" },
];

describe("BR-207 preflight resolution", () => {
  it("TestBR207_admin_drive_ID_root_and_unique_path_root_resolve", async () => {
    const { resolved } = await outcome(
      await local(
        `${String(DRIVE)}:11,${String(DRIVE)}:/Private/docs,${String(DRIVE)}:1`,
      ),
    );
    expect(resolved?.resolvedRoots).toEqual([
      { driveId: DRIVE, folderId: 11 },
      { driveId: DRIVE, folderId: 1 },
    ]);
  });
  it.each([
    ["external", [{ id: DRIVE, role: "external" }]],
    ["absent", [{ id: 5, role: "admin" }]],
  ])("TestBR207_%s_drive_gives_DRIVE_NOT_ALLOWED", async (_name, drives) => {
    expect(
      await outcome(await local(`${String(DRIVE)}:1`), { drives }),
    ).toMatchObject({ code: "DRIVE_NOT_ALLOWED", setting: "driveIds" });
  });
  it("TestBR207_inspectDrive_returns_role_absent_for_an_unlisted_drive", async () => {
    const f = (fixture = await kdriveFixture({
      drives: [{ id: 5, role: "admin" }],
    }));
    const a = await adapterFor(f);
    expect(await a.preflight.inspectDrive(DRIVE)).toEqual({
      id: DRIVE,
      role: "absent",
    });
  });
  it.each([`${String(DRIVE)}:12`, `${String(DRIVE)}:/Private/docs/a.bin`])(
    "TestBR207_file_root_%s_gives_ROOT_NOT_RESOLVED",
    async (roots) => {
      expect(await outcome(await local(roots))).toMatchObject({
        code: "ROOT_NOT_RESOLVED",
        setting: "roots",
      });
    },
  );
  it.each([
    [
      "init 401",
      `${String(DRIVE)}:1`,
      (f: Awaited<ReturnType<typeof kdriveFixture>>) =>
        f.drive.overrides.push((r) =>
          r.path === "/2/drive/init" ? { status: 401, body: "" } : undefined,
        ),
    ],
    ["missing ID root", `${String(DRIVE)}:999`, undefined],
  ] as [
    string,
    string,
    ((f: Awaited<ReturnType<typeof kdriveFixture>>) => void) | undefined,
  ][])("TestBR207_%s_gives_PREFLIGHT_FAILED", async (_name, roots, extra) => {
    const result = await outcome(await local(roots), {}, extra);
    expect(result).toMatchObject({
      code: "PREFLIGHT_FAILED",
      setting: "preflight",
    });
    expect(requestTrace(result.f.apiRequests())).toEqual(
      _name === "init 401"
        ? [initTrace]
        : [
            initTrace,
            "GET /3/drive/101/files/999?with=path%2Cparents%2Ccapabilities",
          ],
    );
  });
  it.each([
    [
      "file as intermediate",
      `${String(DRIVE)}:/Private/docs/a.bin/x`,
      undefined,
    ],
    ["missing name", `${String(DRIVE)}:/Private/nothing`, undefined],
    [
      "duplicated name",
      `${String(DRIVE)}:/Private/docs`,
      (f: Awaited<ReturnType<typeof kdriveFixture>>) =>
        f.drive.nodes.push(...dup.slice(tree.length)),
    ],
  ] as [
    string,
    string,
    ((f: Awaited<ReturnType<typeof kdriveFixture>>) => void) | undefined,
  ][])("BR-207 v2 %s gives ROOT_NOT_RESOLVED", async (_name, roots, extra) => {
    const result = await outcome(await local(roots), {}, extra);
    expect(result).toMatchObject({
      code: "ROOT_NOT_RESOLVED",
      setting: "roots",
    });
  });
  it("TestBR207_65_components_give_PREFLIGHT_FAILED_without_listing", async () => {
    const base = await local(`${String(DRIVE)}:1`);
    const config = {
      ...base,
      roots: [
        {
          driveId: DRIVE,
          kind: "path",
          value: `/${Array(65).fill("a").join("/")}`,
        },
      ],
    } as LocalConfiguration;
    const { code, setting, f } = await outcome(config);
    expect({ code, setting }).toEqual({
      code: "PREFLIGHT_FAILED",
      setting: "preflight",
    });
    expect(
      f.apiRequests().filter((r) => r.path.endsWith("/files")),
    ).toHaveLength(0);
  });
  it("TestBR207_exhausted_request_budget_gives_PREFLIGHT_FAILED", async () => {
    const many: Node[] = [
      ...tree,
      ...Array.from({ length: 1100 }, (_, i): Node => ({
        id: 200000 + i,
        parent: 10,
        type: "file",
        name: `z${String(i)}`,
      })),
    ];
    const { code, setting, f } = await outcome(
      await local(`${String(DRIVE)}:/Private/docs`),
      { nodes: many, pageSize: 1 },
    );
    expect({ code, setting }).toEqual({
      code: "PREFLIGHT_FAILED",
      setting: "preflight",
    });
    expect(f.apiRequests()).toHaveLength(1024);
    // 1,024 loopback TLS requests: about 43 s plain and 60 s under coverage (#80).
  }, 180_000);
  it("TestBR207_120000_ms_bound_gives_PREFLIGHT_FAILED", async () => {
    const many: Node[] = [
      ...tree,
      ...Array.from({ length: 40 }, (_, i): Node => ({
        id: 300000 + i,
        parent: 1,
        type: "file",
        name: `y${String(i)}`,
      })),
    ];
    const f = (fixture = await kdriveFixture({ nodes: many, pageSize: 1 }));
    const gates: (() => void)[] = [];
    const original = f.upstream.handler;
    f.upstream.handler = (r) =>
      r.path.endsWith("/files")
        ? new Promise<Reply>((resolve) =>
            gates.push(() => {
              resolve(original(r));
            }),
          )
        : original(r);
    const a = await adapterFor(f);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const result = preflightConfiguration(
      await local(`${String(DRIVE)}:/Private`),
      a.preflight,
    ).then(
      () => "resolved",
      (e: unknown) => {
        const error = e as { code: string; setting: string };
        return { code: error.code, setting: error.setting };
      },
    );
    const settled: unknown[] = [];
    void result.then((v) => settled.push(v));
    const pending = () => settled.length === 0;
    for (let i = 0; i < 40 && pending(); i++) {
      for (let j = 0; j < 4000 && gates.length === 0 && pending(); j++)
        await new Promise((r) => setImmediate(r));
      if (!pending()) break;
      await vi.advanceTimersByTimeAsync(4000);
      gates.shift()?.();
    }
    expect(await result).toEqual({
      code: "PREFLIGHT_FAILED",
      setting: "preflight",
    });
    const listings = f.apiRequests().filter((r) => r.path.endsWith("/files"));
    expect(listings.length).toBeGreaterThanOrEqual(30);
    expect(listings.length).toBeLessThanOrEqual(31);
  });
});

// F-044 AC-01–AC-08: pre-change trace expectations from the fixed route table.
const documents: Node = {
  id: 10,
  parent: 1,
  type: "dir",
  name: "Documents",
};
const reports: Node = {
  id: 11,
  parent: 10,
  type: "dir",
  name: "Reports",
};
const initTrace = "GET /2/drive/init?with=drives";
const earlierTrace =
  "GET /3/drive/7/files/1?with=path%2Cparents%2Ccapabilities";
function listingTrace(parent: number, cursor?: string) {
  const base =
    `GET /3/drive/7/files/${parent}/files` +
    "?limit=50&with=path%2Cparents%2Ccapabilities";
  return cursor === undefined ? base : base + "&cursor=" + cursor;
}
function requestTrace(requests: readonly Seen[]) {
  return requests.map((r) => `${r.method} ${r.url}`);
}
async function pathLocal(path: string, failing: boolean) {
  return local(failing ? `7:1,7:${path},7:999` : `7:${path}`, "7");
}
async function pathOutcome(
  path: string,
  nodes: Node[],
  folderId: number | null,
  listings: string[],
  pageSize = 50,
) {
  const result = await outcome(await pathLocal(path, folderId === null), {
    nodes,
    drives: [{ id: 7, role: "admin" }],
    pageSize,
  });
  if (folderId === null) {
    expect(result).toMatchObject({
      code: "ROOT_NOT_RESOLVED",
      setting: "roots",
    });
    expect(result.resolved).toBeUndefined();
  } else {
    expect(result.resolved?.resolvedRoots).toEqual([{ driveId: 7, folderId }]);
  }
  // The earlier numeric selector sends metadata only (zero listing requests).
  // The exact trace also excludes retries, file descendants and selector 999.
  expect(requestTrace(result.f.apiRequests())).toEqual([
    initTrace,
    ...(folderId === null ? [earlierTrace] : []),
    ...listings,
  ]);
}

const unresolvedCases: {
  label: string;
  path: string;
  nodes: Node[];
}[] = [
  { label: "missing first", path: "/Documents", nodes: [] },
  {
    label: "ambiguous first",
    path: "/Documents",
    nodes: [documents, { ...documents, id: 20 }],
  },
  {
    label: "mixed ambiguous first",
    path: "/Documents",
    nodes: [documents, { ...documents, id: 20, type: "file" }],
  },
  {
    label: "file first final",
    path: "/Documents",
    nodes: [{ ...documents, type: "file" }],
  },
  {
    label: "file first intermediate",
    path: "/Documents/Reports",
    nodes: [{ ...documents, type: "file" }],
  },
  { label: "missing deeper", path: "/Documents/Reports", nodes: [documents] },
  {
    label: "ambiguous deeper",
    path: "/Documents/Reports",
    nodes: [documents, reports, { ...reports, id: 20 }],
  },
  {
    label: "file deeper final",
    path: "/Documents/Reports",
    nodes: [documents, { ...reports, type: "file" }],
  },
  {
    label: "file deeper intermediate",
    path: "/Documents/Reports/Archive",
    nodes: [documents, { ...reports, type: "file" }],
  },
];

describe("F-044 root path classification", () => {
  it("BR-207 v2 missing first component gives ROOT_NOT_RESOLVED", async () => {
    await pathOutcome("/Documents", [], null, [listingTrace(1)]);
  });

  it.each(unresolvedCases)(
    "BR-207 v2 unresolved components resolve to null — $label",
    async ({ path, nodes }) => {
      const f = (fixture = await kdriveFixture({
        nodes,
        drives: [{ id: 7, role: "admin" }],
      }));
      const a = await adapterFor(f);
      await expect(
        a.preflight.resolveDirectory(7, {
          driveId: 7,
          kind: "path",
          value: path,
        }),
      ).resolves.toBeNull();
    },
  );

  it.each(["dir", "file"] as const)(
    "BR-207 v2 ambiguous component gives ROOT_NOT_RESOLVED — dir and %s",
    async (type) => {
      await pathOutcome(
        "/Documents",
        [documents, { ...documents, id: 20, type }],
        null,
        [listingTrace(1)],
      );
    },
  );

  it.each(unresolvedCases.filter((c) => c.label.startsWith("file")))(
    "BR-207 v2 file at final or intermediate component gives ROOT_NOT_RESOLVED — $label",
    async ({ path, nodes }) => {
      await pathOutcome(
        path,
        nodes,
        null,
        nodes.length === 1
          ? [listingTrace(1)]
          : [listingTrace(1), listingTrace(10)],
      );
    },
  );

  it.each([0, 1, 2])(
    "BR-207 v2 deeper component resolves only one exact directory — %i matches",
    async (count) => {
      const nodes = [
        documents,
        ...Array.from({ length: count }, (_, i) => ({
          ...reports,
          id: 11 + i,
        })),
      ];
      await pathOutcome("/Documents/Reports", nodes, count === 1 ? 11 : null, [
        listingTrace(1),
        listingTrace(10),
      ]);
      if (count === 1) {
        // Pin the successful adapter record as well as config output.
        const a = await adapterFor(fixture!);
        await expect(
          a.preflight.resolveDirectory(7, {
            driveId: 7,
            kind: "path",
            value: "/Documents/Reports",
          }),
        ).resolves.toEqual({ driveId: 7, id: 11, type: "dir" });
      }
    },
  );

  it.each([false, true])(
    "BR-207 v2 component matching remains case sensitive — exact match %s",
    async (exact) => {
      await pathOutcome(
        "/Documents",
        [
          { ...documents, id: 20, name: "documents" },
          ...(exact ? [documents] : []),
        ],
        exact ? 10 : null,
        [listingTrace(1)],
      );
    },
  );

  it.each([
    { label: "match only on page two", names: ["Other", "Documents"], id: 11 },
    {
      label: "match on both pages",
      names: ["Documents", "Documents"],
      id: null,
    },
    { label: "no match on either page", names: ["Other", "Else"], id: null },
  ])(
    "BR-207 v2 complete pagination determines unique path matches — $label",
    async ({ names, id }) => {
      await pathOutcome(
        "/Documents",
        names.map((name, i) => ({ ...documents, id: 10 + i, name })),
        id,
        [listingTrace(1), listingTrace(1, "c1")],
        1,
      );
    },
  );
});

const upstreamFailures = ([1, 10] as const).flatMap((parent) =>
  (["HTTP", "timeout", "malformed"] as const).flatMap((failure) =>
    [-1, 0, 1, 2].map((priorMatches) => ({ parent, failure, priorMatches })),
  ),
);
it.each(upstreamFailures)(
  "BR-207 v2 upstream failures at every component remain PREFLIGHT_FAILED — parent $parent, $failure, prior matches $priorMatches",
  async ({ parent, failure, priorMatches }) => {
    let reachedFailure: (() => void) | undefined;
    const failureReached = new Promise<void>((resolve) => {
      reachedFailure = resolve;
    });
    const component = parent === 1 ? documents : reports;
    const entries = Array.from({ length: Math.max(0, priorMatches) }, (_, i) =>
      providerItem([{ ...component, id: 20 + i }], 20 + i, 7),
    );
    const reply: Reply =
      failure === "HTTP"
        ? { status: 401, body: "" }
        : failure === "timeout"
          ? { stall: "headers" }
          : success({}, { has_more: false, cursor: null });
    if (failure === "timeout")
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = outcome(
      await pathLocal("/Documents/Reports", true),
      { nodes: [documents], drives: [{ id: 7, role: "admin" }] },
      (f) => {
        f.drive.overrides.push((r) => {
          if (r.path !== `/3/drive/7/files/${parent}/files`) return undefined;
          if (priorMatches >= 0 && !r.query.has("cursor"))
            return success(entries, { has_more: true, cursor: "next" });
          reachedFailure?.();
          return reply;
        });
      },
    );
    if (failure === "timeout") {
      await failureReached;
      await vi.advanceTimersByTimeAsync(120_000);
    }
    const result = await pending;
    expect(result).toMatchObject({
      code: "PREFLIGHT_FAILED",
      setting: "preflight",
    });
    expect(result.resolved).toBeUndefined();
    expect(requestTrace(result.f.apiRequests())).toEqual([
      initTrace,
      earlierTrace,
      ...(parent === 10 ? [listingTrace(1)] : []),
      listingTrace(parent),
      ...(priorMatches >= 0 ? [listingTrace(parent, "next")] : []),
    ]);
  },
);

const traceCases: {
  label: string;
  path: string;
  nodes: Node[];
  folderId: number | null;
  listings: string[];
  pageSize: number;
}[] = [
  {
    label: "successful path",
    path: "/Documents/Reports",
    nodes: [documents, reports],
    folderId: 11,
    listings: [listingTrace(1), listingTrace(10)],
    pageSize: 50,
  },
  {
    label: "missing name",
    path: "/Documents",
    nodes: [],
    folderId: null,
    listings: [listingTrace(1)],
    pageSize: 50,
  },
  {
    label: "duplicate name",
    path: "/Documents",
    nodes: [documents, { ...documents, id: 20 }],
    folderId: null,
    listings: [listingTrace(1)],
    pageSize: 50,
  },
  {
    label: "intermediate file",
    path: "/Documents/Reports",
    nodes: [{ ...documents, type: "file" }],
    folderId: null,
    listings: [listingTrace(1)],
    pageSize: 50,
  },
  {
    label: "final file",
    path: "/Documents",
    nodes: [{ ...documents, type: "file" }],
    folderId: null,
    listings: [listingTrace(1)],
    pageSize: 50,
  },
  {
    label: "paginated path",
    path: "/Documents",
    nodes: [{ ...documents, id: 20, name: "Other" }, documents],
    folderId: 10,
    listings: [listingTrace(1), listingTrace(1, "c1")],
    pageSize: 1,
  },
  {
    label: "complete pages after multiple matches",
    path: "/Documents",
    nodes: [
      documents,
      { ...documents, id: 20 },
      { ...documents, id: 30, name: "Other" },
    ],
    folderId: null,
    listings: [listingTrace(1), listingTrace(1, "c2")],
    pageSize: 2,
  },
];
it.each(traceCases)(
  "BR-207 v2 classification preserves request traces — $label",
  async ({ path, nodes, folderId, listings, pageSize }) => {
    await pathOutcome(path, nodes, folderId, listings, pageSize);
  },
);
it("BR-207 v2 classification preserves request traces — upstream failure", async () => {
  const result = await outcome(
    await pathLocal("/Documents/Reports", true),
    { nodes: [documents], drives: [{ id: 7, role: "admin" }] },
    (f) => {
      f.drive.overrides.push((r) =>
        r.path === "/3/drive/7/files/10/files"
          ? { status: 401, body: "" }
          : undefined,
      );
    },
  );
  expect(result).toMatchObject({
    code: "PREFLIGHT_FAILED",
    setting: "preflight",
  });
  expect(result.resolved).toBeUndefined();
  expect(requestTrace(result.f.apiRequests())).toEqual([
    initTrace,
    earlierTrace,
    listingTrace(1),
    listingTrace(10),
  ]);
});

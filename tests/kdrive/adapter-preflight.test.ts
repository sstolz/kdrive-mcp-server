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
  tree,
  type Node,
  type Reply,
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
    return { code: (error as { code: string }).code, f };
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
      (await outcome(await local(`${String(DRIVE)}:1`), { drives })).code,
    ).toBe("DRIVE_NOT_ALLOWED");
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
      expect((await outcome(await local(roots))).code).toBe(
        "ROOT_NOT_RESOLVED",
      );
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
  ][])("TestBR207_%s_gives_PREFLIGHT_FAILED", async (_name, roots, extra) => {
    expect((await outcome(await local(roots), {}, extra)).code).toBe(
      "PREFLIGHT_FAILED",
    );
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
    const { code, f } = await outcome(config);
    expect(code).toBe("PREFLIGHT_FAILED");
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
    const { code, f } = await outcome(
      await local(`${String(DRIVE)}:/Private/docs`),
      { nodes: many, pageSize: 1 },
    );
    expect(code).toBe("PREFLIGHT_FAILED");
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
      (e: unknown) => (e as { code: string }).code,
    );
    const settled: string[] = [];
    void result.then((v) => settled.push(v));
    const pending = () => settled.length === 0;
    for (let i = 0; i < 40 && pending(); i++) {
      for (let j = 0; j < 4000 && gates.length === 0 && pending(); j++)
        await new Promise((r) => setImmediate(r));
      if (!pending()) break;
      await vi.advanceTimersByTimeAsync(4000);
      gates.shift()?.();
    }
    expect(await result).toBe("PREFLIGHT_FAILED");
    const listings = f.apiRequests().filter((r) => r.path.endsWith("/files"));
    expect(listings.length).toBeGreaterThanOrEqual(30);
    expect(listings.length).toBeLessThanOrEqual(31);
  });
});

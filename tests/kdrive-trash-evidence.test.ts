// F-017 AC-08, AC-09 (BR-264, BR-265, BR-200 v2): original-trash evidence from
// the trash metadata and the live former parent, over the injected transport.
import { afterEach, describe, expect, it } from "vitest";
import {
  DRIVE,
  adapterFor,
  invocation,
  kdriveFixture,
  notFound,
  providerItem,
  success,
  tree,
  type Node,
} from "./helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const TRASHED = 50;
/** Trash metadata as observed in #16 (docs/kdrive-write-evidence.md). */
function trashed(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: TRASHED,
    drive_id: DRIVE,
    parent_id: 11,
    type: "file",
    status: "trashed",
    name: "gone.txt",
    path: "/Private/docs/gone.txt",
    parents: [],
    deleted_at: 1_762_250_000,
    deleted_by: 9,
    capabilities: { can_read: true },
    ...overrides,
  };
}
async function setup(
  metadata: unknown,
  nodes: Node[] = [...tree],
  parentOverride?: unknown,
) {
  const observed: string[] = [];
  const f = (fixture = await kdriveFixture({ nodes }));
  f.drive.overrides.push((r) => {
    if (r.path === `/3/drive/${String(DRIVE)}/trash/${String(TRASHED)}`)
      return metadata === "missing" ? notFound : success(metadata);
    return undefined;
  });
  if (parentOverride !== undefined)
    f.drive.overrides.push((r) =>
      /^\/3\/drive\/\d+\/files\/\d+$/u.test(r.path)
        ? (parentOverride as never)
        : undefined,
    );
  const a = await adapterFor(f, {
    onRequest: (method, template) => observed.push(`${method} ${template}`),
  });
  const inspect = () =>
    a.dependencies.inspect({ driveId: DRIVE, id: TRASHED }, "original-trash");
  return { f, a, observed, inspect };
}
const chain = (
  ...members: [number, string, string][]
): Record<string, unknown>[] =>
  members.map(([id, name, path]) => ({
    driveId: DRIVE,
    id,
    type: "dir",
    name,
    path,
    location: "original-trash",
    lifecycle: "live",
  }));
const evidence = (
  type: "file" | "dir",
  name: string,
  path: string,
  parents: Record<string, unknown>[],
) => ({
  driveId: DRIVE,
  id: TRASHED,
  status: "complete",
  type,
  name,
  path,
  parents,
  location: "original-trash",
  lifecycle: "trashed",
  rootId: 1,
  treeRootId: TRASHED,
});
const TWO = ["GET /3/drive/{d}/trash/{f}", "GET /3/drive/{d}/files/{f}"];

describe("AC-08 BR-264 complete original-trash evidence", () => {
  it.each(["file", "dir"] as const)(
    "TestBR264_a_directly_trashed_%s_with_a_live_former_parent",
    async (type) => {
      const s = await setup(trashed({ type }));
      expect(await s.inspect()).toEqual(
        evidence(
          type,
          "gone.txt",
          "/Private/docs/gone.txt",
          chain(
            [1, "", "/"],
            [10, "Private", "/Private"],
            [11, "docs", "/Private/docs"],
          ),
        ),
      );
      expect(s.observed).toEqual(TWO);
      const query = s.f.apiRequests()[0]?.query;
      expect(query?.get("with")).toBe("path,parents,capabilities");
      expect(s.f.apiRequests()[1]?.path).toBe(
        `/3/drive/${String(DRIVE)}/files/11`,
      );
    },
  );
  it("TestBR264_a_former_parent_that_is_root_gives_the_sentinel_chain", async () => {
    const s = await setup(trashed({ parent_id: 1, path: "/gone.txt" }));
    expect(await s.inspect()).toEqual(
      evidence("file", "gone.txt", "/gone.txt", chain([1, "", "/"])),
    );
    expect(s.observed).toEqual(TWO);
  });
  it("TestBR264_metadata_without_a_drive_id_member_is_accepted", async () => {
    const metadata = trashed();
    delete metadata.drive_id;
    const s = await setup(metadata);
    expect(await s.inspect()).toMatchObject({ status: "complete" });
  });
});

describe("AC-08 BR-265 missing and incomplete evidence", () => {
  it("TestBR265_a_trash_404_object_not_found_is_missing", async () => {
    const s = await setup("missing");
    expect(await s.inspect()).toEqual({ status: "missing" });
    expect(s.observed).toEqual([TWO[0]]);
  });
  const one: [string, Record<string, unknown>][] = [
    ["status trash_inherited", { status: "trash_inherited" }],
    ["status ok", { status: "ok" }],
    ["status null", { status: null }],
    ["missing id", { id: undefined }],
    ["invalid id", { id: "50" }],
    ["id differing from the target", { id: 51 }],
    ["missing type", { type: undefined }],
    ["invalid type", { type: "link" }],
    ["missing name", { name: undefined }],
    ["invalid name", { name: "a/b" }],
    ["missing parent_id", { parent_id: undefined }],
    ["invalid parent_id", { parent_id: 0 }],
    ["missing path", { path: undefined }],
    ["non-canonical path", { path: "/Private//docs/gone.txt" }],
    ["drive_id differing from the requested drive", { drive_id: DRIVE + 1 }],
  ];
  it.each(one)(
    "TestBR265_%s_is_incomplete_after_one_GET",
    async (_label, overrides) => {
      const s = await setup(trashed(overrides));
      expect(await s.inspect()).toEqual({ status: "incomplete" });
      expect(s.observed).toEqual([TWO[0]]);
    },
  );
  const two: [
    string,
    Partial<Parameters<typeof setup>>,
    Record<string, unknown>,
  ][] = [
    ["a 404 former parent", [undefined, tree.filter((n) => n.id !== 11)], {}],
    [
      "a trashed former parent",
      [
        undefined,
        tree.map((n) => (n.id === 11 ? { ...n, status: "trashed" } : n)),
      ],
      {},
    ],
    [
      "a file former parent",
      [undefined, undefined],
      { parent_id: 12, path: "/Private/docs/a.bin/gone.txt" },
    ],
    [
      "an unnormalizable former parent",
      [
        undefined,
        undefined,
        success({ ...providerItem(tree, 11), path: "/x/docs" }),
      ],
      {},
    ],
    [
      "a renamed former parent (joined path differs)",
      [undefined, undefined],
      { path: "/Private/old-docs/gone.txt" },
    ],
  ];
  it.each(two)(
    "TestBR265_%s_is_incomplete",
    async (_label, args, overrides) => {
      const s = await setup(trashed(overrides), args[1] ?? [...tree], args[2]);
      expect(await s.inspect()).toEqual({ status: "incomplete" });
      expect(s.observed).toEqual(TWO);
    },
  );
});

describe("AC-09 BR-200 v2 no trashed-tree enumeration and no adapter execute", () => {
  it("TestBR200_children_original_trash_and_execute_are_unavailable_without_requests", async () => {
    const s = await setup(trashed());
    expect(
      await s.a.dependencies.children({
        ...invocation(),
        driveId: DRIVE,
        id: TRASHED,
        location: "original-trash",
        treeRootId: TRASHED,
      }),
    ).toEqual({ status: "unavailable" });
    for (const kind of ["create", "rename", "move", "trash", "restore"])
      expect(await s.a.dependencies.execute({ kind })).toEqual({
        status: "unavailable",
      });
    expect(s.observed).toEqual([]);
    expect(s.f.upstream.seen).toHaveLength(0);
  });
});

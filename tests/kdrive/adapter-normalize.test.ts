// F-014 AC-08 (BR-197) is in adapter-freshness.test.ts; this file covers
// AC-09 (BR-198, BR-199) and AC-10 (BR-200).
import { afterEach, describe, expect, it } from "vitest";
import { item } from "../../src/policy/values.js";
import { brandedRead } from "../../src/read-retry.js";
import {
  DRIVE,
  adapterFor,
  invocation,
  kdriveFixture,
  providerItem,
  success,
  tree,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
type Provider = Record<string, unknown>;
async function inspectWith(
  data: Provider | ((p: Provider) => Provider),
  id = 12,
) {
  const f = (fixture = await kdriveFixture());
  const body = typeof data === "function" ? data(providerItem(tree, id)) : data;
  f.drive.overrides.push((r) =>
    r.path === `/3/drive/101/files/${String(id)}` ? success(body) : undefined,
  );
  const a = await adapterFor(f);
  return a.dependencies.inspect({ driveId: DRIVE, id }, "live");
}
const parentsOf = (p: Provider) => p.parents as Provider[];

describe("BR-198 BR-199 configured-tree normalization", () => {
  it("TestBR199_root_1_normalizes_to_the_sentinel", async () => {
    const result = await inspectWith(providerItem(tree, 1), 1);
    expect(result).toEqual({
      driveId: DRIVE,
      id: 1,
      status: "complete",
      type: "dir",
      name: "",
      path: "/",
      parents: [],
      location: "live",
      lifecycle: "live",
      rootId: 1,
    });
    expect(item(result, { driveId: DRIVE, id: 1 }, "live")).toEqual(result);
  });
  it.each([null, 0])(
    "TestBR199_root_1_with_parent_id_%s_normalizes_to_the_sentinel",
    async (parentId) => {
      const result = await inspectWith(
        (p) => ({ ...p, parent_id: parentId }),
        1,
      );
      expect(result).toMatchObject({
        id: 1,
        status: "complete",
        type: "dir",
        name: "",
        path: "/",
        parents: [],
      });
    },
  );
  const rootTampered: [string, (p: Provider) => Provider][] = [
    ["type file", (p) => ({ ...p, type: "file" })],
    ["provider path other than /", (p) => ({ ...p, path: "/Private" })],
    [
      "nonempty parents",
      (p) => ({
        ...p,
        parents: [{ id: 10, drive_id: DRIVE, parent_id: 1, type: "dir" }],
      }),
    ],
    ["foreign drive_id", (p) => ({ ...p, drive_id: DRIVE + 1 })],
    [
      "absent status",
      (p) =>
        Object.fromEntries(Object.entries(p).filter(([k]) => k !== "status")),
    ],
    ["unknown status", (p) => ({ ...p, status: "trashed" })],
  ];
  it.each(rootTampered)(
    "TestBR199_root_1_tampered_%s_is_incomplete",
    async (_name, change) => {
      expect(await inspectWith(change, 1)).toEqual({ status: "incomplete" });
    },
  );

  it.each(["root-first", "leaf-first"] as const)(
    "TestBR199_depth_3_file_with_%s_parents_normalizes_and_passes_item",
    async (order) => {
      const result = await inspectWith(providerItem(tree, 12, DRIVE, order));
      const normalized = item(result, { driveId: DRIVE, id: 12 }, "live");
      expect(normalized.path).toBe("/Private/docs/a.bin");
      expect(normalized.parents.map((p) => [p.id, p.path])).toEqual([
        [1, "/"],
        [10, "/Private"],
        [11, "/Private/docs"],
      ]);
      expect(result).toEqual(normalized);
    },
  );

  it.each([null, "ok"])("TestBR199_status_%s_is_live", async (status) => {
    const result = await inspectWith((p) => ({ ...p, status }));
    expect(result).toMatchObject({ status: "complete", lifecycle: "live" });
  });

  const tampered: [string, (p: Provider) => Provider][] = [
    ["missing parent", (p) => ({ ...p, parents: parentsOf(p).slice(1) })],
    [
      "gap",
      (p) => ({
        ...p,
        parents: [parentsOf(p)[0], { ...parentsOf(p)[1], parent_id: 99 }],
      }),
    ],
    [
      "cycle",
      (p) => ({
        ...p,
        parents: [{ ...parentsOf(p)[0], parent_id: 11 }, parentsOf(p)[1]],
      }),
    ],
    [
      "mixed order",
      (p) => ({
        ...p,
        parents: [parentsOf(p)[1], parentsOf(p)[0], parentsOf(p)[1]],
      }),
    ],
    ["wrong drive_id", (p) => ({ ...p, drive_id: 202 })],
    ["path mismatch", (p) => ({ ...p, path: "/Private/docs/b.bin" })],
    ["unknown status", (p) => ({ ...p, status: "trashed" })],
    [
      "absent status",
      (p) =>
        Object.fromEntries(Object.entries(p).filter(([k]) => k !== "status")),
    ],
    [
      "extra root in parents",
      (p) => ({
        ...p,
        parents: [
          { id: 1, drive_id: DRIVE, parent_id: 1, type: "dir", name: "" },
          ...parentsOf(p),
        ],
      }),
    ],
    ["unknown type", (p) => ({ ...p, type: "link" })],
    ["non-integer id", (p) => ({ ...p, id: "12" })],
    ["zero parent_id", (p) => ({ ...p, parent_id: 0 })],
    ["parent_id not last member", (p) => ({ ...p, parent_id: 10 })],
    ["parents not an array", (p) => ({ ...p, parents: {} })],
    [
      "slash in name",
      (p) => ({ ...p, name: "a/b", path: "/Private/docs/a/b" }),
    ],
    [
      "file as parent",
      (p) => ({
        ...p,
        parents: [parentsOf(p)[0], { ...parentsOf(p)[1], type: "file" }],
      }),
    ],
    ["wrong id", (p) => ({ ...p, id: 13 })],
  ];
  it.each(tampered)(
    "TestBR199_tampered_%s_is_incomplete",
    async (_name, change) => {
      expect(await inspectWith(change)).toEqual({ status: "incomplete" });
    },
  );

  it("TestBR198_404_object_not_found_is_missing", async () => {
    const f = (fixture = await kdriveFixture());
    const a = await adapterFor(f);
    expect(
      await a.dependencies.inspect({ driveId: DRIVE, id: 999 }, "live"),
    ).toEqual({
      status: "missing",
    });
  });

  it("TestBR198_404_with_another_code_rejects_ReadFailure_404", async () => {
    const f = (fixture = await kdriveFixture());
    f.drive.overrides.push(() => ({
      status: 404,
      json: { result: "error", error: { code: "gone" } },
    }));
    const a = await adapterFor(f);
    const error = await a.dependencies
      .inspect({ driveId: DRIVE, id: 12 }, "live")
      .catch((e: unknown) => e);
    expect(brandedRead(error)).toBe(true);
  });
});

describe("BR-200 no trash evidence and no execution", () => {
  // BR-200 v2 (F-017): the configured-drive original-trash inspect is now
  // BR-264 evidence (tests/kdrive-trash-evidence.test.ts); trashed-tree
  // children, received original-trash and `execute` stay unavailable.
  it("TestBR200_original_trash_and_execute_are_unavailable_without_requests", async () => {
    const f = (fixture = await kdriveFixture());
    const a = await adapterFor(f);
    expect(
      await a.dependencies.children({
        ...invocation(),
        driveId: DRIVE,
        id: 12,
        location: "original-trash",
        treeRootId: 12,
      }),
    ).toEqual({
      status: "unavailable",
    });
    expect(
      await a.dependencies.received.inspect(
        { driveId: 202, id: 12 },
        "original-trash",
      ),
    ).toEqual({
      status: "unavailable",
    });
    for (const kind of ["rename", "trash", "create-file", "share-link"])
      expect(await a.dependencies.execute({ kind })).toEqual({
        status: "unavailable",
      });
    expect(f.upstream.seen).toHaveLength(0);
    expect(f.connects).toHaveLength(0);
  });
});

// F-014 AC-08 (BR-197) is in adapter-freshness.test.ts; this file covers
// AC-09 (BR-198, BR-199) and AC-10 (BR-200).
import { afterEach, describe, expect, it, vi } from "vitest";
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
  configuration,
  navigationClient,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
import { sizeCases, dateCases } from "../helpers/info-metadata.js";
import { createNavigationController } from "../../src/navigation.js";
import { payload } from "../helpers/navigation.js";

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
      size_bytes: null,
      modified_at: null,
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

// BR-063 v2, BR-436 v1, BR-437 v1: real adapter boundary, including root ID 1.
it("TestBR436_v1_size_boundaries", async () => {
  const f = (fixture = await kdriveFixture());
  let metadata: Provider = {};
  f.drive.overrides.push((r) => {
    const match = /^\/3\/drive\/101\/files\/(1|11|12)$/u.exec(r.path);
    return match ? success({ ...providerItem(tree, Number(match[1])), ...metadata }) : undefined;
  });
  const a = await adapterFor(f);
  const client = await navigationClient(a.dependencies);
  try {
  for (const id of [12, 11, 1]) for (const { raw, expected } of sizeCases) {
    metadata = { size: raw, last_modified_at: 1 };
    const result = await a.dependencies.inspect({ driveId: DRIVE, id }, "live");
    expect(result).toMatchObject({ status: "complete", size_bytes: id === 12 ? expected : null, modified_at: "1970-01-01T00:00:01Z" });
    if (id === 12 && expected === 0) expect(Object.is((result as Provider).size_bytes, -0)).toBe(false);
    expect(await client.info(id)).toMatchObject({ ok: { item: { size_bytes: id === 12 ? expected : null, modified_at: "1970-01-01T00:00:01Z" } } });
  }
  } finally { await client.close(); }
});

it("TestBR437_v1_timestamp_boundaries", async () => {
  const f = (fixture = await kdriveFixture());
  let metadata: Provider = {};
  f.drive.overrides.push((r) => {
    const match = /^\/3\/drive\/101\/files\/(1|11|12)$/u.exec(r.path);
    return match ? success({ ...providerItem(tree, Number(match[1])), ...metadata }) : undefined;
  });
  const a = await adapterFor(f);
  const client = await navigationClient(a.dependencies);
  try {
    for (const id of [12, 11, 1]) for (const { raw, expected } of dateCases) {
      metadata = { size: 16, last_modified_at: raw, updated_at: 1, created_at: 1, revised_at: 1 };
      const result = await a.dependencies.inspect({ driveId: DRIVE, id }, "live");
      expect(result).toMatchObject({ status: "complete", size_bytes: id === 12 ? 16 : null, modified_at: expected });
      expect(await client.info(id)).toEqual({ ok: { item: {
        drive_id: DRIVE, id,
        name: id === 1 ? "" : id === 11 ? "docs" : "a.bin",
        type: id === 12 ? "file" : "dir",
        path: id === 1 ? "/" : id === 11 ? "/Private/docs" : "/Private/docs/a.bin",
        size_bytes: id === 12 ? 16 : null, modified_at: expected,
      } } });
    }
  } finally { await client.close(); }
});

it("TestBR063_v2_non_inspect_metadata_absent", async () => {
  const f = (fixture = await kdriveFixture());
  const decorated = (id: number) => ({ ...providerItem(tree, id), size: 16, last_modified_at: 1 });
  f.drive.overrides.push((r) => {
    if (r.path === "/3/drive/101/files/11") return success(decorated(11));
    if (r.path.endsWith("/11/files")) return success([decorated(12)], { has_more: false, cursor: null });
    if (/\/(search|recents|my_shared)$/u.test(r.path)) return success([decorated(12)], { has_more: false, cursor: null });
    if (r.path === "/3/drive/101/trash/12") return success({ ...decorated(12), status: "trashed", deleted_at: 1, deleted_by: 9 });
    return undefined;
  });
  const a = await adapterFor(f);
  const absent = (value: unknown) => {
    expect(value).toMatchObject({ status: "complete" });
    expect(value).not.toHaveProperty("size_bytes");
    expect(value).not.toHaveProperty("modified_at");
  };
  const children = await a.dependencies.children({ ...invocation(), driveId: DRIVE, id: 11, location: "live" }) as Provider;
  for (const entry of children.entries as unknown[]) absent(entry);
  for (const kind of ["search", "recents", "my-shared"]) {
    const page = await a.dependencies.collection({ ...invocation(), kind, scope: { driveId: DRIVE, id: 11 }, query: "a" }) as Provider;
    expect(page).toMatchObject({ status: "complete" });
    for (const entry of page.entries as unknown[]) absent(entry);
  }
  absent(await a.dependencies.inspect({ driveId: DRIVE, id: 12 }, "original-trash"));
  const resolved = await a.preflight.resolveDirectory(DRIVE, { kind: "id", value: 11 });
  expect(resolved).toMatchObject({ driveId: DRIVE, id: 11, type: "dir" });
  expect(resolved).not.toHaveProperty("size_bytes");
  expect(resolved).not.toHaveProperty("modified_at");
});

it("TestBR436_v1_optional_metadata_preserves_required_evidence", async () => {
  const f = (fixture = await kdriveFixture());
  let metadata: Provider = {};
  f.drive.overrides.push((r) => r.path === "/3/drive/101/files/12" ? success({ ...providerItem(tree, 12), ...metadata }) : undefined);
  const a = await adapterFor(f);
  const execute = vi.fn();
  const c = createNavigationController(await configuration(), { ...a.dependencies, execute });
  const cases = [
    { raw: { size: 16, last_modified_at: 0 }, size: 16, date: "1970-01-01T00:00:00Z" },
    { raw: { size: "CANARY", last_modified_at: 1 }, size: null, date: "1970-01-01T00:00:01Z" },
    { raw: { size: 16, last_modified_at: "CANARY" }, size: 16, date: null },
    { raw: { size: undefined, last_modified_at: undefined }, size: null, date: null },
  ];
  let baseline: string[] | undefined;
  try {
    for (const row of cases) {
      metadata = row.raw;
      const before = f.apiRequests().length;
      expect(payload(await c.invoke("kdrive_info", { file_id: 12 }))).toEqual({ item: {
        drive_id: DRIVE, id: 12, name: "a.bin", path: "/Private/docs/a.bin", type: "file",
        size_bytes: row.size, modified_at: row.date,
      } });
      const requests = f.apiRequests().slice(before).map((r) => `${r.method} ${r.path}`);
      if (baseline) expect(requests).toEqual(baseline);
      else baseline = requests;
    }
    expect(execute).not.toHaveBeenCalled();
    expect(f.upstream.seen.every((r) => r.method === "GET" && !r.path.includes("download"))).toBe(true);
  } finally { c.close(); }
});

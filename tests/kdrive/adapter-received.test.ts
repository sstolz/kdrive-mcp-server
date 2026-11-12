// F-014 AC-13 (BR-203, BR-204): received shares.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolicy, navigatePolicy } from "../../src/policy/index.js";
import {
  DRIVE,
  adapterFor,
  configuration,
  invocation,
  kdriveFixture,
  success,
  type Seen,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
const OWNER = 202;
type P = Record<string, unknown>;
const owner = {
  id: 77,
  drive_id: OWNER,
  parent_id: 5,
  type: "dir",
  name: "Owner",
  path: "/Private/Owner",
};
const anchor = {
  id: 500,
  drive_id: OWNER,
  parent_id: 77,
  type: "dir",
  name: "team",
  path: "/Shared/team",
};
const sub = {
  id: 501,
  drive_id: OWNER,
  parent_id: 500,
  type: "dir",
  name: "sub",
};
const root: P = {
  ...anchor,
  status: null,
  capabilities: {
    can_read: true,
    can_write: true,
    can_rename: true,
    can_move: true,
  },
};
const fileRoot: P = {
  id: 600,
  drive_id: OWNER,
  parent_id: 78,
  type: "file",
  status: "ok",
  name: "doc.pdf",
  path: "/Shared/doc.pdf",
  size: 3,
  capabilities: { can_read: true },
};
const child: P = {
  ...sub,
  status: "ok",
  path: "/Shared/team/sub",
  parents: [owner, anchor],
  capabilities: { can_read: true, can_write: true },
};
const grandchild: P = {
  id: 502,
  drive_id: OWNER,
  parent_id: 501,
  type: "file",
  status: "ok",
  name: "g.txt",
  path: "/Shared/team/sub/g.txt",
  size: 4,
  parents: [owner, anchor, sub],
  capabilities: { can_read: true, can_delete: true },
};

async function setup(
  roles: { id: number; role: string }[] = [
    { id: DRIVE, role: "admin" },
    { id: OWNER, role: "external" },
  ],
  extra: (r: Seen) => ReturnType<typeof success> | undefined = () => undefined,
) {
  const f = (fixture = await kdriveFixture({ shared: [root, fileRoot] }));
  f.drive.overrides.push((r) => {
    const own = extra(r);
    if (own) return own;
    if (r.path === "/2/drive/init") return success({ drives: roles });
    if (r.path === "/3/drive/202/files/500")
      return success({ ...root, parents: [] });
    if (r.path === "/3/drive/202/files/501") return success(child);
    if (r.path === "/3/drive/202/files/502") return success(grandchild);
    if (r.path === "/3/drive/202/files/500/files")
      return success([child], { has_more: false, cursor: null });
    if (r.path === "/3/drive/202/files/501/files")
      return success([grandchild], { has_more: false, cursor: null });
    if (r.path === "/3/drive/202/files/search")
      return success([child, grandchild], { has_more: false, cursor: null });
    return undefined;
  });
  return { f, a: await adapterFor(f) };
}
const receivedFalse = {
  createFile: false,
  createDirectory: false,
  replace: false,
  rename: false,
  renameTree: false,
  moveOut: false,
  acceptMove: false,
  moveTree: false,
  trash: false,
  trashTree: false,
  restore: false,
  restoreTree: false,
  acceptRestore: false,
};

describe("BR-203 received routes and normalization", () => {
  it("TestBR203_list_uses_only_the_unscoped_route_and_normalizes_roots", async () => {
    const { f, a } = await setup();
    const request = invocation();
    const page = (await a.dependencies.received.list(request)) as P;
    expect(page).toMatchObject({
      ...request,
      status: "complete",
      discover: true,
      terminal: true,
    });
    expect(page.entries).toEqual([
      {
        driveId: OWNER,
        id: 500,
        status: "complete",
        type: "dir",
        name: "team",
        path: "/Shared/team",
        parents: [],
        location: "live",
        lifecycle: "live",
        anchorId: 500,
        role: "external",
        capabilities: {
          read: true,
          list: true,
          search: true,
          ...receivedFalse,
        },
      },
      {
        driveId: OWNER,
        id: 600,
        status: "complete",
        type: "file",
        name: "doc.pdf",
        path: "/Shared/doc.pdf",
        parents: [],
        location: "live",
        lifecycle: "live",
        anchorId: 600,
        role: "external",
        capabilities: {
          read: true,
          list: false,
          search: false,
          ...receivedFalse,
        },
      },
    ]);
    const shared = f
      .apiRequests()
      .filter((r) => r.path.endsWith("shared_with_me"));
    expect(shared.map((r) => r.path)).toEqual([
      "/3/drive/files/shared_with_me",
    ]);
    expect(shared[0]?.query.get("with")).toBe("path,capabilities");
    expect(
      f
        .apiRequests()
        .some((r) => /^\/3\/drive\/\d+\/files\/shared_with_me$/u.test(r.path)),
    ).toBe(false);
  });

  it.each([
    ["admin", [{ id: OWNER, role: "admin" }]],
    ["absent", [{ id: DRIVE, role: "admin" }]],
  ] as [string, { id: number; role: string }[]][])(
    "TestBR203_role_%s_makes_received_results_incomplete_without_discover",
    async (_name, roles) => {
      const { a } = await setup(roles);
      expect(await a.dependencies.received.list(invocation())).toEqual({
        status: "incomplete",
      });
      expect(
        await a.dependencies.received.inspect(
          { driveId: OWNER, id: 502 },
          "live",
        ),
      ).toEqual({
        status: "incomplete",
      });
      expect(
        await a.dependencies.received.children({
          ...invocation(),
          driveId: OWNER,
          id: 500,
          location: "live",
        }),
      ).toEqual({ status: "incomplete" });
    },
  );

  it("TestBR203_descendant_anchor_is_the_member_at_Shared_name_and_relative_chain_follows", async () => {
    const { f, a } = await setup();
    const result = await a.dependencies.received.inspect(
      { driveId: OWNER, id: 502 },
      "live",
    );
    expect(result).toEqual({
      driveId: OWNER,
      id: 502,
      status: "complete",
      type: "file",
      name: "g.txt",
      path: "/Shared/team/sub/g.txt",
      parents: [
        {
          driveId: OWNER,
          id: 500,
          type: "dir",
          name: "team",
          path: "/Shared/team",
          location: "live",
          lifecycle: "live",
        },
        {
          driveId: OWNER,
          id: 501,
          type: "dir",
          name: "sub",
          path: "/Shared/team/sub",
          location: "live",
          lifecycle: "live",
        },
      ],
      location: "live",
      lifecycle: "live",
      anchorId: 500,
      role: "external",
      capabilities: {
        read: true,
        list: false,
        search: false,
        ...receivedFalse,
      },
    });
    expect(f.apiRequests().map((r) => r.path)).toEqual([
      "/2/drive/init",
      "/3/drive/202/files/502",
    ]);
  });

  it("TestBR203v3_members_without_path_anchor_by_position_from_the_item_path", async () => {
    const bare = (m: P): P =>
      Object.fromEntries([
        ...Object.entries(m).filter(([key]) => key !== "path"),
        ["status", "ok"],
      ]);
    const leaf: P = {
      ...grandchild,
      parents: [bare(owner), bare(anchor), bare(sub)],
    };
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/202/files/502" ? success(leaf) : undefined,
    );
    const result = (await a.dependencies.received.inspect(
      { driveId: OWNER, id: 502 },
      "live",
    )) as { parents: { id: number; path: string }[]; anchorId: number };
    expect(result.parents.map((m) => [m.id, m.path])).toEqual([
      [500, "/Shared/team"],
      [501, "/Shared/team/sub"],
    ]);
    expect(result.anchorId).toBe(500);
  });

  it("TestBR203v3_an_outer_folder_named_like_the_share_is_dropped", async () => {
    const outer = { ...owner, id: 70, name: "team" };
    const inner = { ...anchor, parent_id: 70 };
    const leaf: P = {
      ...grandchild,
      id: 504,
      parent_id: 500,
      name: "x",
      path: "/Shared/team/x",
      parents: [outer, inner],
    };
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/202/files/504" ? success(leaf) : undefined,
    );
    const result = (await a.dependencies.received.inspect(
      { driveId: OWNER, id: 504 },
      "live",
    )) as { parents: { id: number; path: string }[]; anchorId: number };
    expect(result.parents.map((m) => [m.id, m.path])).toEqual([
      [500, "/Shared/team"],
    ]);
    expect(result.anchorId).toBe(500);
  });

  it("TestBR203v3_a_nested_share_root_drops_its_linked_chain", async () => {
    const p = { ...owner, id: 70, parent_id: 5 };
    const q = { ...owner, id: 71, parent_id: 70 };
    const nested: P = { ...root, parent_id: 71, parents: [p, q] };
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/202/files/500" ? success(nested) : undefined,
    );
    expect(
      await a.dependencies.received.inspect(
        { driveId: OWNER, id: 500 },
        "live",
      ),
    ).toMatchObject({
      status: "complete",
      id: 500,
      path: "/Shared/team",
      parents: [],
      anchorId: 500,
    });
  });

  it("TestBR203_relative_chain_starts_with_the_anchor_and_drops_earlier_members", async () => {
    // Provider chain: owner-side root → `/Shared` → anchor → child.
    const top = { ...owner, id: 75, parent_id: 4, path: "/Private" };
    const shared = {
      id: 76,
      drive_id: OWNER,
      parent_id: 75,
      type: "dir",
      name: "Shared",
      path: "/Shared",
    };
    const linked = { ...anchor, parent_id: 76 };
    const leaf: P = {
      ...grandchild,
      id: 503,
      name: "h.txt",
      path: "/Shared/team/sub/h.txt",
      parents: [top, shared, linked, sub],
    };
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/202/files/503" ? success(leaf) : undefined,
    );
    const result = (await a.dependencies.received.inspect(
      { driveId: OWNER, id: 503 },
      "live",
    )) as { parents: { id: number; path: string }[]; anchorId: number };
    expect(result.parents.map((m) => [m.id, m.path])).toEqual([
      [500, "/Shared/team"],
      [501, "/Shared/team/sub"],
    ]);
    expect(result.anchorId).toBe(500);
  });

  it.each([
    ["a path outside Shared", { ...grandchild, path: "/Other/team/sub/g.txt" }],
    [
      "a chain shorter than the path",
      { ...grandchild, parent_id: 501, parents: [sub] },
    ],
    [
      "a chain name that differs from the path",
      { ...grandchild, parents: [owner, { ...anchor, name: "tean" }, sub] },
    ],
    [
      "a last path component that differs from the name",
      { ...grandchild, path: "/Shared/team/sub/other.txt" },
    ],
    ["an empty path component", { ...grandchild, path: "/Shared/team//g.txt" }],
    [
      "a trashed chain member",
      {
        ...grandchild,
        parents: [owner, { ...anchor, status: "trashed" }, sub],
      },
    ],
    [
      "a file chain member",
      { ...grandchild, parents: [owner, { ...anchor, type: "file" }, sub] },
    ],
    ["path mismatch", { ...grandchild, path: "/Shared/team/other/g.txt" }],
    ["broken order", { ...grandchild, parents: [anchor, owner, sub] }],
    ["wrong drive", { ...grandchild, drive_id: 303 }],
    ["trashed", { ...grandchild, status: "trashed" }],
  ] as [string, P][])("TestBR203_%s_is_incomplete", async (_name, body) => {
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/202/files/502" ? success(body) : undefined,
    );
    expect(
      await a.dependencies.received.inspect(
        { driveId: OWNER, id: 502 },
        "live",
      ),
    ).toEqual({
      status: "incomplete",
    });
  });

  it("TestBR203_children_and_collection_use_the_BR201_BR202_routes_on_the_request_drive", async () => {
    const { f, a } = await setup();
    const request = {
      ...invocation(),
      driveId: OWNER,
      id: 501,
      location: "live" as const,
    };
    const page = (await a.dependencies.received.children(request)) as P;
    expect(page).toMatchObject({
      ...request,
      status: "complete",
      terminal: true,
    });
    expect((page.entries as P[])[0]).toMatchObject({
      id: 502,
      anchorId: 500,
      role: "external",
    });
    const scope = { driveId: OWNER, id: 500 };
    const search = { ...invocation(), kind: "search", scope, query: "g" };
    const found = (await a.dependencies.received.collection(search)) as P;
    expect(found).toMatchObject({ ...search, status: "complete" });
    expect((found.entries as P[]).map((e) => e.id)).toEqual([501, 502]);
    const paths = f.apiRequests().map((r) => r.path);
    expect(paths).toContain("/3/drive/202/files/501/files");
    expect(paths).toContain("/3/drive/202/files/search");
    expect(
      f
        .apiRequests()
        .find((r) => r.path.endsWith("/search"))
        ?.query.get("directory_id"),
    ).toBe("500");
    expect(
      f
        .apiRequests()
        .find((r) => r.path.endsWith("/501/files"))
        ?.query.get("limit"),
    ).toBe("50");
  });

  it("TestBR203_policy_reads_received_root_child_and_grandchild_with_recipient_paths", async () => {
    const { a } = await setup();
    const policy = createPolicy(
      await configuration({ KDRIVE_MCP_SHARED_WITH_ME: "1" }),
      {
        ...a.dependencies,
        execute: vi.fn(),
      },
    );
    for (const [id, path] of [
      [500, "/Shared/team"],
      [501, "/Shared/team/sub"],
      [502, "/Shared/team/sub/g.txt"],
    ] as const)
      expect(
        await navigatePolicy(policy, {
          kind: "read",
          target: { driveId: OWNER, id },
        }),
      ).toMatchObject({
        ok: true,
        item: { drive_id: OWNER, id, path },
      });
  });
});

describe("BR-204 received capabilities and discovery", () => {
  it("TestBR204_can_read_false_maps_every_predicate_to_false", async () => {
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/202/files/501"
        ? success({
            ...child,
            capabilities: { can_read: false, can_write: true },
          })
        : undefined,
    );
    expect(
      await a.dependencies.received.inspect(
        { driveId: OWNER, id: 501 },
        "live",
      ),
    ).toMatchObject({
      capabilities: {
        read: false,
        list: false,
        search: false,
        ...receivedFalse,
      },
    });
  });

  it("TestBR204_discover_true_only_on_a_complete_page", async () => {
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/files/shared_with_me"
        ? success([root], { has_more: true, cursor: null })
        : undefined,
    );
    const page = (await a.dependencies.received.list(invocation())) as P;
    expect(page).toEqual({ status: "incomplete" });
    expect(page).not.toHaveProperty("discover");
  });

  it("TestBR204_next_page_carries_discover_and_next", async () => {
    const { a } = await setup(undefined, (r) =>
      r.path === "/3/drive/files/shared_with_me"
        ? success([root], { has_more: true, cursor: "k1" })
        : undefined,
    );
    expect(await a.dependencies.received.list(invocation())).toMatchObject({
      status: "complete",
      discover: true,
      next: "k1",
    });
  });
});

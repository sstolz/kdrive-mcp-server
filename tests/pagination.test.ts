import { afterEach, describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import {
  navigationFixture,
  payload,
  plainItem,
  projection,
} from "./helpers/navigation.js";

afterEach(() => vi.useRealTimers());
const result = (
  value: Awaited<
    ReturnType<ReturnType<typeof createNavigationController>["invoke"]>
  >,
) =>
  payload(value) as {
    items: ReturnType<typeof projection>[];
    has_more: boolean;
    next_cursor?: string;
  };
const error = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});
const tools = [
  "kdrive_list",
  "kdrive_search",
  "kdrive_recents",
  "kdrive_my_shared",
];
const args = (tool: string) =>
  tool === "kdrive_list"
    ? { folder_id: 1 }
    : tool === "kdrive_search"
      ? { query: "q" }
      : {};

describe("F-006 paged collections", () => {
  it.each(tools)(
    "TestBR065_v2_filtered_empty_is_not_exhaustion %s",
    async (tool) => {
      const f = await navigationFixture();
      let calls = 0;
      f.collection.mockImplementation(async (request) => ({
        ...(await Promise.resolve(request)),
        status: "complete",
        entries: [],
        ...(++calls === 7 ? { terminal: true } : { next: String(calls) }),
      }));
      const c = createNavigationController(f.config, f.dependencies),
        a = args(tool);
      const first = result(await c.invoke(tool, a));
      expect(first).toMatchObject({ items: [], has_more: true });
      expect(calls).toBe(5);
      expect(
        result(await c.invoke(tool, { ...a, cursor: first.next_cursor })),
      ).toEqual({ items: [], has_more: false });
      expect(calls).toBe(7);
      c.close();
    },
  );
  it.each(tools)("TestBR065_v2_final_capped_page %s", async (tool) => {
    const f = await navigationFixture();
    let n = 0;
    f.collection.mockImplementation(async (request) => ({
      ...(await Promise.resolve(request)),
      status: "complete",
      entries: [],
      ...(++n === 5 ? { terminal: true } : { next: String(n) }),
    }));
    const c = createNavigationController(f.config, f.dependencies);
    expect(result(await c.invoke(tool, args(tool)))).toEqual({
      items: [],
      has_more: false,
    });
    expect(n).toBe(5);
    c.close();
  });
  it.each(tools)("TestBR074_large_overlap_continuation %s", async (tool) => {
    const f = await navigationFixture(),
      nodes = Array.from({ length: 1001 }, (_, i) =>
        plainItem(100 + i, "/x" + i, "file", [f.root]),
      );
    f.collection.mockImplementation(async (request) => {
      const offset = Number(request.cursor ?? 0),
        end = Math.min(offset + 250, nodes.length);
      return {
        ...(await Promise.resolve(request)),
        status: "complete",
        entries: nodes.slice(offset, end),
        ...(end === nodes.length ? { terminal: true } : { next: String(end) }),
      };
    });
    const c = createNavigationController(f.config, f.dependencies);
    let cursor: string | undefined;
    const seen = [];
    do {
      const page = result(
        await c.invoke(tool, { ...args(tool), ...(cursor ? { cursor } : {}) }),
      );
      seen.push(...page.items);
      cursor = page.next_cursor;
      expect(page.has_more).toBe(Boolean(cursor));
    } while (cursor);
    expect(seen).toEqual(nodes.map(projection));
    c.close();
  });
  it("TestBR075_context_binding TestBR080_invalid_handle", async () => {
    const f = await navigationFixture();
    f.collection.mockImplementation(async (request) => ({
      ...(await Promise.resolve(request)),
      status: "complete",
      entries: [f.dir],
      next: "next",
    }));
    const c = createNavigationController(f.config, f.dependencies),
      a = { folder_id: 1 };
    const first = result(await c.invoke("kdrive_list", a));
    const before = f.inspect.mock.calls.length;
    for (const cursor of [
      "x",
      "v2.x",
      "v1.00000000-0000-4000-8000-000000000000",
    ])
      expect(await c.invoke("kdrive_list", { ...a, cursor })).toEqual(
        error("INVALID_CURSOR"),
      );
    expect(
      await c.invoke("kdrive_list", {
        folder_id: 2,
        cursor: first.next_cursor,
      }),
    ).toEqual(error("INVALID_CURSOR"));
    expect(
      await c.invoke("kdrive_search", {
        query: "q",
        cursor: first.next_cursor,
      }),
    ).toEqual(error("INVALID_CURSOR"));
    expect(f.inspect).toHaveBeenCalledTimes(before);
    const other = createNavigationController(f.config, f.dependencies);
    expect(
      await other.invoke("kdrive_list", { ...a, cursor: first.next_cursor }),
    ).toEqual(error("INVALID_CURSOR"));
    other.close();
    await c.invoke("kdrive_list", {
      ...a,
      drive_id: 7,
      cursor: first.next_cursor,
    });
    expect(
      await c.invoke("kdrive_list", { ...a, cursor: first.next_cursor }),
    ).toEqual(error("INVALID_CURSOR"));
    c.close();
  });
  it("TestBR078_fixed_projection", async () => {
    for (const mode of ["read", "write", "share"]) {
      const f = await navigationFixture({ KDRIVE_MCP_MODE: mode });
      f.collection.mockImplementation(async (request) => ({
        ...(await Promise.resolve(request)),
        status: "complete",
        entries: [
          {
            ...f.dir,
            users: [{ token: "CANARY_NESTED", teams: ["CANARY_NESTED"] }],
            sharelink: { url: "CANARY_NESTED" },
            toJSON: () => "CANARY_NESTED",
          },
        ],
        terminal: true,
      }));
      const c = createNavigationController(f.config, f.dependencies);
      for (const tool of tools) {
        const r = await c.invoke(tool, args(tool));
        expect(result(r).items).toEqual([projection(f.dir)]);
        expect(JSON.stringify(r)).not.toContain("CANARY_NESTED");
      }
      c.close();
    }
  });
});

it("TestBR072_configuration_order TestBR074_cursor_chain_namespace", async () => {
  const f = await navigationFixture({ KDRIVE_MCP_ROOTS: "7:1,7:2,9:1" });
  const calls: number[] = [];
  f.collection.mockImplementation(async (request) => {
    calls.push(request.scope.id);
    const entries =
      request.scope.id === 1
        ? [f.file]
        : [f.file, plainItem(10, "/docs/z", "file", [f.root, f.dir])];
    return {
      ...(await Promise.resolve(request)),
      status: "complete",
      entries,
      ...(request.cursor ? { terminal: true } : { next: "same-token" }),
    };
  });
  const c = createNavigationController(f.config, f.dependencies);
  let cursor: string | undefined;
  const all = [];
  do {
    const page = result(
      await c.invoke("kdrive_search", {
        query: "q",
        ...(cursor ? { cursor } : {}),
      }),
    );
    all.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  expect(all.map((x) => x.id)).toEqual([3, 10]);
  expect(calls).toEqual([1, 1, 2, 2]);
  c.close();
});
it("TestBR076_state_bounds TestBR080_expiry_and_eviction", async () => {
  const f = await navigationFixture();
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [f.dir],
    next: "next",
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const pages = [];
  for (let i = 0; i < 17; i++) {
    time++;
    pages.push(result(await c.invoke("kdrive_list", { folder_id: 1 })));
  }
  expect(
    await c.invoke("kdrive_list", {
      folder_id: 1,
      cursor: pages[0]!.next_cursor,
    }),
  ).toEqual(error("INVALID_CURSOR"));
  time = 300017;
  expect(
    await c.invoke("kdrive_list", {
      folder_id: 1,
      cursor: pages[16]!.next_cursor,
    }),
  ).toEqual(error("INVALID_CURSOR"));
  c.close();
});
it("TestBR077_reauthorize_continuation TestBR079_collection_scope", async () => {
  const f = await navigationFixture();
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [f.file, f.sibling],
    next: "n",
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const first = result(
    await c.invoke("kdrive_search", { folder_id: 2, query: "q" }),
  );
  expect(first.items).toEqual([projection(f.file)]);
  f.nodes.delete("7:2");
  const calls = f.collection.mock.calls.length;
  expect(
    await c.invoke("kdrive_search", {
      folder_id: 2,
      query: "q",
      cursor: first.next_cursor,
    }),
  ).toEqual(error("ACCESS_DENIED"));
  expect(f.collection).toHaveBeenCalledTimes(calls);
  c.close();
});
it("TestBR081_invalidation rejects same-chain loops without a partial result", async () => {
  const f = await navigationFixture();
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [f.dir],
    next: "loop",
  }));
  const c = createNavigationController(f.config, f.dependencies),
    a = { folder_id: 1 };
  const first = result(await c.invoke("kdrive_list", a));
  expect(
    await c.invoke("kdrive_list", { ...a, cursor: first.next_cursor }),
  ).toEqual(error("ACCESS_DENIED"));
  expect(
    await c.invoke("kdrive_list", { ...a, cursor: first.next_cursor }),
  ).toEqual(error("INVALID_CURSOR"));
  c.close();
});
it.each(["kdrive_search", "kdrive_recents", "kdrive_my_shared"])(
  "TestBR074_large_overlapping_roots %s",
  async (tool) => {
    const f = await navigationFixture({ KDRIVE_MCP_ROOTS: "7:1,7:2,9:1" }),
      nodes = Array.from({ length: 1001 }, (_, i) =>
        plainItem(100 + i, "/docs/x" + i, "file", [f.root, f.dir]),
      );
    f.collection.mockImplementation(async (request) => {
      await Promise.resolve();
      const offset = Number(request.cursor ?? 0),
        end = Math.min(offset + 250, nodes.length);
      return {
        ...request,
        status: "complete",
        entries: nodes.slice(offset, end),
        ...(end === nodes.length ? { terminal: true } : { next: String(end) }),
      };
    });
    const c = createNavigationController(f.config, f.dependencies);
    let cursor: string | undefined;
    const all = [];
    do {
      const page = result(
        await c.invoke(tool, { ...args(tool), ...(cursor ? { cursor } : {}) }),
      );
      all.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    expect(all).toEqual(nodes.map(projection));
    expect(f.collection).toHaveBeenCalledTimes(10);
    c.close();
  },
);

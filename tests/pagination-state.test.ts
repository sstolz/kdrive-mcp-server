import { afterEach, expect, it, vi } from "vitest";
import { createPagination, PaginationError } from "../src/pagination.js";
import type { NavigationItem } from "../src/policy/index.js";
import { createNavigationController } from "../src/navigation.js";
import {
  navigationFixture,
  payload,
  plainItem,
  projection,
} from "./helpers/navigation.js";

afterEach(() => vi.restoreAllMocks());
const error = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});
it("TestBR076_state_bounds emitted IDs and chain history stop before overflow", async () => {
  const f = await navigationFixture();
  let generation = 0,
    calls = 0;
  const ports = {
    root: () => Promise.resolve(undefined),
    read: () =>
      Promise.resolve({ ...projection(f.root), type: "dir" as const }),
    listCalls: () => calls,
    candidates: () => Promise.resolve([]),
    page: () => {
      calls++;
      generation++;
      return Promise.resolve({
        entries: Array.from(
          { length: 256 },
          (_, i) =>
            projection(
              plainItem(
                (generation - 1) * 256 + i + 2,
                "/x" + ((generation - 1) * 256 + i),
                "file",
                [f.root],
              ),
            ) as NavigationItem,
        ),
        next: String(generation),
      });
    },
  };
  const p = createPagination(f.config, ports);
  let cursor: string | undefined;
  for (let i = 0; i < 32; i++) {
    calls = 0;
    const page = await p.run("kdrive_list", {
      folder_id: 1,
      ...(cursor ? { cursor } : {}),
    });
    cursor = page.next_cursor;
    p.finish(true);
  }
  calls = 0;
  await expect(
    p.run("kdrive_list", { folder_id: 1, cursor }),
  ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  p.finish(false);
  const q = createPagination(f.config, {
    ...ports,
    page: () => {
      calls++;
      generation++;
      return Promise.resolve({ entries: [], next: String(generation) });
    },
  });
  cursor = undefined;
  for (let i = 0; i < 1638; i++) {
    calls = 0;
    const page = await q.run("kdrive_list", {
      folder_id: 1,
      ...(cursor ? { cursor } : {}),
    });
    cursor = page.next_cursor;
    q.finish(true);
  }
  calls = 0;
  await expect(
    q.run("kdrive_list", { folder_id: 1, cursor }),
  ).rejects.toBeInstanceOf(PaginationError);
  q.finish(false);
  q.close();
  p.close();
});
it("TestBR080_expiry boundary-minus-one succeeds without renewal", async () => {
  const f = await navigationFixture();
  let time = 0,
    n = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [plainItem(100 + n, "/x" + n++, "file", [f.root])],
    next: String(n),
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const first = payload(await c.invoke("kdrive_list", { folder_id: 1 })) as {
    next_cursor: string;
  };
  time = 299999;
  const second = payload(
    await c.invoke("kdrive_list", { folder_id: 1, cursor: first.next_cursor }),
  ) as { next_cursor: string };
  expect(second.next_cursor).toBeTypeOf("string");
  time = 300000;
  expect(
    await c.invoke("kdrive_list", { folder_id: 1, cursor: second.next_cursor }),
  ).toEqual(error("INVALID_CURSOR"));
  c.close();
});
it("TestBR065_v2_final_capped_page with256 visible results", async () => {
  const f = await navigationFixture();
  let calls = 0;
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries:
      ++calls === 5
        ? Array.from({ length: 256 }, (_, i) =>
            plainItem(100 + i, "/x" + i, "file", [f.root]),
          )
        : [],
    ...(calls === 5 ? { terminal: true } : { next: String(calls) }),
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const page = payload(await c.invoke("kdrive_list", { folder_id: 1 })) as {
    items: unknown[];
    has_more: boolean;
    next_cursor?: string;
  };
  expect(page.items).toHaveLength(256);
  expect(page.has_more).toBe(false);
  expect(page.next_cursor).toBeUndefined();
  expect(calls).toBe(5);
  c.close();
});
it("TestBR081_invalidation output limit rejects cursor and unrelated traversals survive", async () => {
  const f = await navigationFixture({ KDRIVE_MCP_MAX_OUTPUT_CHARS: "200" });
  let n = 0;
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [plainItem(100 + n, "/x" + n++, "file", [f.root])],
    next: String(n),
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const first = payload(await c.invoke("kdrive_list", { folder_id: 1 })) as {
    next_cursor: string;
  };
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [plainItem(200, "/" + "x".repeat(300), "file", [f.root])],
    next: "z",
  }));
  expect(
    await c.invoke("kdrive_list", { folder_id: 1, cursor: first.next_cursor }),
  ).toEqual(error("LIMIT_EXCEEDED"));
  expect(
    await c.invoke("kdrive_list", { folder_id: 1, cursor: first.next_cursor }),
  ).toEqual(error("INVALID_CURSOR"));
  c.close();
});
it("TestBR081_invalidation cancellation and timeout consume admitted handles", async () => {
  vi.useFakeTimers();
  const f = await navigationFixture();
  let n = 0;
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [f.dir],
    next: String(n++),
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const first = payload(await c.invoke("kdrive_list", { folder_id: 1 })) as {
    next_cursor: string;
  };
  f.collection.mockImplementation(() => new Promise(() => {}));
  const abort = new AbortController();
  const pending = c.invoke(
    "kdrive_list",
    { folder_id: 1, cursor: first.next_cursor },
    abort.signal,
  );
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  expect(await pending).toEqual(error("ACCESS_DENIED"));
  expect(
    await c.invoke("kdrive_list", { folder_id: 1, cursor: first.next_cursor }),
  ).toEqual(error("INVALID_CURSOR"));
  const timeout = c.invoke("kdrive_list", { folder_id: 1 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(await timeout).toEqual(error("REQUEST_TIMEOUT"));
  c.close();
  vi.useRealTimers();
});
it("TestBR078_fixed_projection never invokes accessors", async () => {
  const f = await navigationFixture(),
    getter = vi.fn(() => "CANARY_GETTER");
  const entry = { ...f.dir };
  Object.defineProperty(entry, "users", { get: getter, enumerable: true });
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [entry],
    terminal: true,
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const response = await c.invoke("kdrive_list", { folder_id: 1 });
  expect(getter).not.toHaveBeenCalled();
  expect(JSON.stringify(response)).not.toContain("CANARY_GETTER");
  c.close();
});
it("TestBR081_invalidation malformed automatic root proof is not exhaustion", async () => {
  const f = await navigationFixture();
  f.inspect.mockResolvedValue({
    status: "complete",
    driveId: 7,
    id: 1,
    type: "dir",
    path: "bad",
  });
  const c = createNavigationController(f.config, f.dependencies);
  expect(await c.invoke("kdrive_recents", {})).toEqual(error("ACCESS_DENIED"));
  expect(f.collection).not.toHaveBeenCalled();
  c.close();
});

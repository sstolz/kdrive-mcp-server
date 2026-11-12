import { describe, expect, it } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { fixture, node } from "./helpers/received.js";
import { payload, projection } from "./helpers/navigation.js";

const error = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});
async function setup(count = 1001, env: Record<string, string> = {}) {
  const f = await fixture(env),
    roots = Array.from({ length: count }, (_, i) => ({
      ...node(100 + i, "r" + i, "dir"),
      anchorId: 100 + i,
    }));
  f.items.clear();
  for (const root of roots) f.items.set("live:8:" + root.id, root);
  f.received.list.mockImplementation(async (request) => {
    const r = request as { cursor?: string };
    const offset = Number(r.cursor ?? 0),
      end = Math.min(offset + 256, roots.length);
    return {
      ...(await Promise.resolve(request)),
      status: "complete",
      discover: true,
      entries: roots.slice(offset, end),
      ...(end === roots.length ? { terminal: true } : { next: String(end) }),
    };
  });
  const c = createNavigationController(f.config, {
    ...f.configured,
    execute: f.execute,
    received: f.received,
  });
  return { ...f, c, roots };
}
describe("F-006 complete received proof pagination", () => {
  it("TestBR074_large_received_candidate_continuation TestBR073_all_list_ports_share_budget", async () => {
    const f = await setup();
    let cursor: string | undefined;
    const items = [];
    do {
      const result = await f.c.invoke(
        "kdrive_shared_with_me",
        cursor ? { cursor } : {},
      );
      expect(result.isError).toBeUndefined();
      const page = payload(result) as {
        items: unknown[];
        next_cursor?: string;
      };
      items.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    expect(items).toEqual(f.roots.map(projection));
    expect(f.received.list).toHaveBeenCalledTimes(4);
    expect(f.received.inspect).toHaveBeenCalledTimes(1001);
    f.c.close();
  });
  it("TestBR065_v2_received_candidate_continuation", async () => {
    const f = await setup(257);
    const first = payload(
      await f.c.invoke("kdrive_shared_with_me", { type: "file" }),
    ) as { items: unknown[]; has_more: boolean; next_cursor: string };
    expect(first).toMatchObject({ items: [], has_more: true });
    expect(
      payload(
        await f.c.invoke("kdrive_shared_with_me", {
          type: "file",
          cursor: first.next_cursor,
        }),
      ),
    ).toEqual({ items: [], has_more: false });
    f.c.close();
  });
  it("TestBR073 incomplete sixth proof page refuses without a continuation", async () => {
    const f = await setup(1281);
    expect(await f.c.invoke("kdrive_shared_with_me", {})).toEqual(
      error("LIMIT_EXCEEDED"),
    );
    expect(f.received.list).toHaveBeenCalledTimes(5);
    expect(f.received.inspect).not.toHaveBeenCalled();
    f.c.close();
  });
  it.each(["empty", "duplicate"])(
    "TestBR079 malformed received proof %s refuses",
    async (kind) => {
      const f = await setup(2);
      f.received.list.mockImplementation(async (request) => ({
        ...(await Promise.resolve(request)),
        status: "complete",
        discover: true,
        entries: kind === "empty" ? [] : [f.roots[0], f.roots[0]],
        next: "next",
      }));
      expect(await f.c.invoke("kdrive_shared_with_me", {})).toEqual(
        error("ACCESS_DENIED"),
      );
      f.c.close();
    },
  );
  it("TestBR077_reauthorize_continuation refreshes membership at60 seconds", async () => {
    const f = await setup(257);
    const first = payload(await f.c.invoke("kdrive_shared_with_me", {})) as {
      next_cursor: string;
    };
    f.clock.value = 60000;
    f.roots.splice(256, 1);
    expect(
      payload(
        await f.c.invoke("kdrive_shared_with_me", {
          cursor: first.next_cursor,
        }),
      ),
    ).toEqual({ items: [], has_more: false });
    expect(f.received.list).toHaveBeenCalledTimes(3);
    f.c.close();
  });
  it("TestBR079 opt-out zero received calls and external-root denial", async () => {
    const f = await setup(2, { KDRIVE_MCP_SHARED_WITH_ME: "0" });
    expect(payload(await f.c.invoke("kdrive_shared_with_me", {}))).toEqual({
      items: [],
      has_more: false,
    });
    expect(f.received.list).not.toHaveBeenCalled();
    expect(
      await f.c.invoke("kdrive_search", { drive_id: 8, query: "q" }),
    ).toEqual(error("ACCESS_DENIED"));
    expect(
      await f.c.invoke("kdrive_list", { drive_id: 8, folder_id: 1 }),
    ).toEqual(error("ACCESS_DENIED"));
    f.c.close();
  });
});

it("TestBR073 complete five-page proof defers data without a sixth list start", async () => {
  const f = await setup(1280),
    anchor = f.roots[0]!,
    child = { ...node(2000, "child", "file", [anchor]), anchorId: anchor.id };
  f.items.set("live:8:2000", child);
  f.received.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [child],
    terminal: true,
  }));
  const first = payload(
    await f.c.invoke("kdrive_list", { drive_id: 8, folder_id: anchor.id }),
  ) as { next_cursor: string };
  expect(first).toMatchObject({ items: [], has_more: true });
  expect(f.received.list).toHaveBeenCalledTimes(5);
  expect(f.received.collection).not.toHaveBeenCalled();
  expect(
    payload(
      await f.c.invoke("kdrive_list", {
        drive_id: 8,
        folder_id: anchor.id,
        cursor: first.next_cursor,
      }),
    ),
  ).toEqual({ items: [projection(child)], has_more: false });
  expect(f.received.collection).toHaveBeenCalledTimes(1);
  f.c.close();
});
it("TestBR074 owner identity pairs keep equal IDs on distinct drives", async () => {
  const f = await setup(2);
  const second = f.roots[1]!;
  f.items.delete("live:8:" + second.id);
  second.id = f.roots[0]!.id;
  second.anchorId = second.id;
  second.driveId = 9;
  f.items.set("live:9:" + second.id, second);
  expect(payload(await f.c.invoke("kdrive_shared_with_me", {}))).toEqual({
    items: f.roots.map(projection),
    has_more: false,
  });
  f.c.close();
});
it("TestBR077 disappeared queued root is omitted without publishing cached metadata", async () => {
  const f = await setup(257);
  const first = payload(await f.c.invoke("kdrive_shared_with_me", {})) as {
    next_cursor: string;
  };
  f.items.delete("live:8:" + f.roots[256]!.id);
  expect(
    payload(
      await f.c.invoke("kdrive_shared_with_me", { cursor: first.next_cursor }),
    ),
  ).toEqual({ items: [], has_more: false });
  f.c.close();
});

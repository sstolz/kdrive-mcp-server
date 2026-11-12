import { expect, it } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { fixture, node } from "./helpers/received.js";
import { payload, projection } from "./helpers/navigation.js";

const denied = {
  isError: true,
  content: [{ type: "text", text: "ACCESS_DENIED" }],
};
const states = ["absent", "descendant", "root", "denied", "malformed"] as const;
it.each(
  states.flatMap((state) => [59999, 60000].map((time) => ({ state, time }))),
)(
  "TestBR077 current received-root candidate $state at $time ms",
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async ({ state, time }) => {
    const f = await fixture(),
      roots = Array.from({ length: 257 }, (_, i) => ({
        ...node(100 + i, "r" + i, "dir"),
        anchorId: 100 + i,
      })),
      current = [...roots];
    f.items.clear();
    for (const root of roots) f.items.set("live:8:" + root.id, root);
    f.received.list.mockImplementation(async (request) => {
      await Promise.resolve();
      const offset = Number((request as { cursor?: string }).cursor ?? 0),
        end = Math.min(offset + 256, current.length);
      return {
        ...request,
        status: "complete",
        discover: true,
        entries: current.slice(offset, end),
        ...(end === current.length
          ? { terminal: true }
          : { next: String(end) }),
      };
    });
    const c = createNavigationController(f.config, {
      ...f.configured,
      execute: f.execute,
      received: f.received,
    });
    try {
      const first = payload(await c.invoke("kdrive_shared_with_me", {})) as {
        items: unknown[];
        next_cursor: string;
      };
      expect(first.items).toHaveLength(256);
      const queued = roots[256]!,
        key = "live:8:" + queued.id;
      const child = {
        ...node(queued.id, queued.name, "dir", [roots[0]!]),
        anchorId: roots[0]!.id,
      };
      if (state === "absent" || state === "descendant") current.splice(256, 1);
      if (state === "absent") f.items.delete(key);
      if (state === "descendant") f.items.set(key, child);
      if (state === "denied")
        f.items.set(key, {
          ...queued,
          capabilities: { ...queued.capabilities, read: false },
        });
      if (state === "malformed")
        f.items.set(key, { ...queued, path: "relative" });
      f.clock.value = time;
      const before = f.received.inspect.mock.calls.length;
      const response = await c.invoke("kdrive_shared_with_me", {
        cursor: first.next_cursor,
      });
      if (state === "malformed" || (state === "descendant" && time === 59999))
        expect(response).toEqual(denied);
      else
        expect(payload(response)).toEqual({
          items: state === "root" ? [projection(queued)] : [],
          has_more: false,
        });
      expect(f.received.list).toHaveBeenCalledTimes(
        time === 59999
          ? 2
          : state === "absent" || state === "descendant"
            ? 3
            : 4,
      );
      if (time === 60000 && (state === "absent" || state === "descendant"))
        expect(f.received.inspect).toHaveBeenCalledTimes(before);
      if (time === 60000 && state === "descendant")
        expect(
          payload(
            await c.invoke("kdrive_info", { drive_id: 8, file_id: queued.id }),
          ),
        ).toEqual({ item: projection(child) });
    } finally {
      c.close();
    }
  },
);

import { afterEach, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { createPolicy } from "../src/policy/index.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";
import {
  navigationFixture,
  payload,
  projection,
} from "./helpers/navigation.js";
import { fixture as receivedFixture } from "./helpers/received.js";

afterEach(() => vi.restoreAllMocks());
const cursorError = {
  isError: true,
  content: [{ type: "text", text: "INVALID_CURSOR" }],
};
const denied = {
  isError: true,
  content: [{ type: "text", text: "ACCESS_DENIED" }],
};
it.each(["invalid", "expired", "binding", "replay"])(
  "TestBR080 actual SDK keeps INVALID_CURSOR for %s",
  async (kind) => {
    const f = await navigationFixture();
    let time = 0,
      calls = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    f.collection.mockImplementation(async (request) => ({
      ...(await Promise.resolve(request)),
      status: "complete",
      entries: [f.dir],
      ...(++calls === 1 ? { next: "next" } : { terminal: true }),
    }));
    const w = await createWire(f.config, f.dependencies);
    const send = (id: number, args: Record<string, unknown>) =>
      w.send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "kdrive_list", arguments: args },
      });
    try {
      w.send(initialize);
      await w.read(1);
      w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send(2, { folder_id: 1 });
      const first = await w.read(2),
        cursor = (
          payload(first.result as { content: unknown }) as {
            next_cursor: string;
          }
        ).next_cursor;
      if (kind === "replay") {
        send(3, { folder_id: 1, cursor });
        await w.read(3);
      }
      if (kind === "expired") time = 300000;
      const before = f.inspect.mock.calls.length,
        collections = f.collection.mock.calls.length;
      send(4, {
        folder_id: kind === "binding" ? 2 : 1,
        cursor: kind === "invalid" ? "CANARY_INVALID_HANDLE" : cursor,
      });
      expect((await w.read(4)).result).toEqual(cursorError);
      expect(f.inspect).toHaveBeenCalledTimes(before);
      expect(f.collection).toHaveBeenCalledTimes(collections);
      expect(w.stdout() + w.stderr()).not.toContain("CANARY_INVALID_HANDLE");
    } finally {
      await w.session.close();
    }
  },
);
it.each(["kdrive_list", "kdrive_search", "kdrive_recents", "kdrive_my_shared"])(
  "TestBR079 BR081 malformed configured page refuses without partial items or continuation %s",
  async (tool) => {
    const f = await navigationFixture();
    let calls = 0;
    f.collection.mockImplementation(async (request) => ({
      ...(await Promise.resolve(request)),
      status: "complete",
      entries:
        ++calls === 1 ? [f.file] : [f.file, { ...f.sibling, path: "relative" }],
      next: String(calls),
    }));
    const c = createNavigationController(f.config, f.dependencies),
      args = {
        folder_id: 2,
        ...(tool === "kdrive_search" ? { query: "q" } : {}),
      };
    const first = payload(await c.invoke(tool, args)) as {
      next_cursor: string;
    };
    expect(
      await c.invoke(tool, { ...args, cursor: first.next_cursor }),
    ).toEqual(denied);
    expect(
      await c.invoke(tool, { ...args, cursor: first.next_cursor }),
    ).toEqual(cursorError);
    c.close();
  },
);
it("TestBR079 BR081 malformed received normalized page refuses without partial items or continuation", async () => {
  const f = await receivedFixture();
  let calls = 0;
  f.received.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: ++calls === 1 ? [f.a] : [f.a, { ...f.b, path: "relative" }],
    next: String(calls),
  }));
  const c = createNavigationController(f.config, {
      ...f.configured,
      execute: f.execute,
      received: f.received,
    }),
    args = { drive_id: 8, folder_id: 20 };
  const first = payload(await c.invoke("kdrive_list", args)) as {
    next_cursor: string;
  };
  expect(
    await c.invoke("kdrive_list", { ...args, cursor: first.next_cursor }),
  ).toEqual(denied);
  expect(
    await c.invoke("kdrive_list", { ...args, cursor: first.next_cursor }),
  ).toEqual(cursorError);
  c.close();
});
it("Legacy abstract collection normalization still omits isolated malformed entries", async () => {
  const f = await navigationFixture();
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [f.file, { ...f.sibling, path: "relative" }],
    terminal: true,
  }));
  const policy = createPolicy(f.config, f.dependencies);
  const result = await policy.dispatch({
    kind: "list",
    scope: { driveId: 7, id: 2 },
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    const entries = (
      result.value as {
        entries: {
          driveId: number;
          id: number;
          name: string;
          type: string;
          path: string;
        }[];
      }
    ).entries;
    expect(entries.map(projection)).toEqual([projection(f.file)]);
  }
});

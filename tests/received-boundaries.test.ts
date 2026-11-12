import { describe, expect, it } from "vitest";
import {
  fixture,
  ref,
  denied,
  node,
  type SharedNode,
} from "./helpers/received.js";

const read = { kind: "read", target: ref(24) };
describe("received membership, caching, effects and facade", () => {
  it("BR-051 list-only cache boundary and fresh target evidence", async () => {
    const f = await fixture();
    expect((await f.policy.dispatch(read)).ok).toBe(true);
    const before = f.received.inspect.mock.calls.length;
    f.clock.value = 59999;
    expect((await f.policy.dispatch(read)).ok).toBe(true);
    expect(f.received.list).toHaveBeenCalledTimes(1);
    expect(f.received.inspect.mock.calls.length).toBeGreaterThan(before);
    f.clock.value = 60000;
    expect((await f.policy.dispatch(read)).ok).toBe(true);
    expect(f.received.list).toHaveBeenCalledTimes(2);
  });
  it("BR-051 BR-052 mutations refresh lists even after cached reads and batch refreshes once", async () => {
    const f = await fixture(),
      replace = {
        kind: "replace",
        target: ref(24),
        destination: ref(22),
        name: "report",
      };
    await f.policy.dispatch(read);
    await f.policy.dispatch(replace);
    await f.policy.dispatch(replace);
    expect(f.received.list).toHaveBeenCalledTimes(3);
    expect(
      (
        await f.policy.dispatch({
          kind: "batch",
          operations: [
            replace,
            {
              kind: "replace",
              target: ref(25),
              destination: ref(22),
              name: "other",
            },
          ],
        })
      ).ok,
    ).toBe(true);
    expect(f.received.list).toHaveBeenCalledTimes(4);
  });
  it.each(["failed", "incomplete", "slow", "rollback", "nonfinite"])(
    "BR-051 BR-056 no stale refresh fallback %s",
    async (mode) => {
      const f = await fixture();
      await f.policy.dispatch(read);
      f.clock.value = 60000;
      f.received.list.mockImplementation(async (r) => {
        await Promise.resolve();
        if (mode === "failed") throw new Error("MUST_NOT_LEAK");
        if (mode === "slow") f.clock.value += 60000;
        if (mode === "rollback") f.clock.value -= 1;
        if (mode === "nonfinite") f.clock.value = NaN;
        return {
          ...r,
          status: mode === "incomplete" ? "incomplete" : "complete",
          entries: [f.anchor],
          terminal: true,
          discover: true,
        };
      });
      expect(await f.policy.dispatch(read)).toEqual(denied);
      expect(f.execute).toHaveBeenCalledTimes(1);
      if (mode === "failed" || mode === "incomplete") {
        f.clock.value = 1;
        expect(await f.policy.dispatch(read)).toEqual(denied);
      }
    },
  );
  it("BR-051 age rechecked after fresh inspection and instances never share cache", async () => {
    const f = await fixture();
    await f.policy.dispatch(read);
    f.clock.value = 59999;
    f.received.inspect.mockImplementation(async (r, location) => {
      await Promise.resolve();
      f.clock.value = 60000;
      return structuredClone(f.items.get(location + ":8:" + r.id)!);
    });
    expect(await f.policy.dispatch(read)).toEqual(denied);
    const other = await fixture();
    await other.policy.dispatch(read);
    expect(other.received.list).toHaveBeenCalledTimes(1);
  });
  it("BR-048 complete two-page discovery filters denied roots", async () => {
    const f = await fixture({ KDRIVE_MCP_DENY: "/Shared/Hidden/**" });
    const hidden = { ...node(30, "Hidden", "dir"), anchorId: 30 };
    f.items.set("live:8:30", hidden);
    f.received.list.mockImplementation(async (r: object) => {
      await Promise.resolve();
      const request = r as { cursor?: string };
      return {
        ...r,
        status: "complete",
        entries: request.cursor ? [hidden] : [f.anchor],
        ...(request.cursor ? { terminal: true } : { next: "two" }),
        discover: true,
      };
    });
    const result = await f.policy.dispatch({ kind: "shared-with-me" });
    expect(result).toMatchObject({
      ok: true,
      value: { entries: [{ id: 20 }] },
    });
    if (result.ok)
      expect((result.value as { entries: unknown[] }).entries).toHaveLength(1);
    expect(f.received.list).toHaveBeenCalledTimes(2);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    "loop",
    "wrong-binding",
    "duplicate",
    "role",
    "limit",
    "no-terminal",
    "empty-next",
  ])("BR-048 BR-056 discovery invalidates %s", async (mode) => {
    const f = await fixture({ KDRIVE_MCP_MAX_TREE_ITEMS: "2" });
    f.received.list.mockImplementation(async (r) => {
      await Promise.resolve();
      return {
        ...r,
        status: "complete",
        discover: true,
        entries:
          mode === "duplicate" || mode === "limit"
            ? mode === "limit"
              ? [f.anchor, { ...node(30, "Other", "dir"), anchorId: 30 }]
              : [f.anchor, f.anchor]
            : mode === "empty-next"
              ? []
              : [
                  {
                    ...f.anchor,
                    ...(mode === "role" ? { role: "admin" } : {}),
                  },
                ],
        ...(mode === "loop" || mode === "empty-next"
          ? { next: "repeat" }
          : mode === "no-terminal"
            ? {}
            : { terminal: true }),
        ...(mode === "wrong-binding" ? { invocation: {} } : {}),
      };
    });
    expect(await f.policy.dispatch(read)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    "missing",
    "wrong-drive",
    "wrong-anchor",
    "cycle",
    "gap",
    "wrong-path",
    "trash",
    "unsafe-array",
    "alias",
  ])("BR-049 BR-056 refuses malformed membership %s", async (mode) => {
    const f = await fixture();
    if (mode === "missing") f.items.delete("live:8:24");
    if (mode === "wrong-drive") f.file.driveId = 9;
    if (mode === "wrong-anchor") f.file.anchorId = 99;
    if (mode === "cycle") f.file.parents.push(f.file);
    if (mode === "gap") f.file.parents = [f.anchor];
    if (mode === "wrong-path") f.file.path = "/Shared/Other/report";
    if (mode === "trash") f.file.lifecycle = "trashed";
    if (mode === "unsafe-array")
      f.received.inspect.mockResolvedValue({
        ...f.file,
        parents: new Array<SharedNode>(1),
      });
    if (mode === "alias") {
      const alias = {
        ...f.a,
        anchorId: 22,
        parents: [],
        path: "/Shared/Other",
        name: "Other",
      };
      f.received.list.mockImplementation(async (r) => {
        await Promise.resolve();
        return {
          ...r,
          status: "complete",
          discover: true,
          entries: [f.anchor, alias],
          terminal: true,
        };
      });
    }
    expect(await f.policy.dispatch(read)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("BR-049 file anchors authorize only their exact identity and unknown IDs never pass", async () => {
    const f = await fixture();
    f.anchor.type = "file";
    expect(
      (await f.policy.dispatch({ kind: "read", target: ref(20) })).ok,
    ).toBe(true);
    expect(await f.policy.dispatch(read)).toEqual(denied);
    expect(await f.policy.dispatch({ kind: "read", target: ref(999) })).toEqual(
      denied,
    );
  });
  it.each(["list", "search"])(
    "BR-055 denies external root and permits proved scoped %s",
    async (kind) => {
      const f = await fixture();
      expect(
        await f.policy.dispatch({
          kind,
          scope: ref(1),
          ...(kind === "search" ? { query: "" } : {}),
        }),
      ).toEqual(denied);
      expect(
        (
          await f.policy.dispatch({
            kind,
            scope: ref(22),
            ...(kind === "search" ? { query: "" } : {}),
          })
        ).ok,
      ).toBe(true);
    },
  );
  it("BR-050 current/result/descendant denies and complete traversals", async () => {
    const f = await fixture({ KDRIVE_MCP_DENY: "/Shared/Project/a/report" });
    for (const op of [
      read,
      { kind: "rename", target: ref(22), name: "renamed" },
      { kind: "trash", target: ref(22) },
      { kind: "move", target: ref(22), destination: ref(23) },
    ])
      expect(await f.policy.dispatch(op)).toEqual(denied);
    const result = await fixture({
      KDRIVE_MCP_DENY: "/Shared/Project/b/a/report",
    });
    expect(
      await result.policy.dispatch({
        kind: "move",
        target: ref(22),
        destination: ref(23),
      }),
    ).toEqual(denied);
    const incomplete = await fixture({ KDRIVE_MCP_DENY: "/never" });
    incomplete.received.children.mockImplementation(async (r) => {
      await Promise.resolve();
      return {
        ...r,
        status: "incomplete",
        entries: [],
        terminal: true,
      };
    });
    expect(
      await incomplete.policy.dispatch({ kind: "trash", target: ref(22) }),
    ).toEqual(denied);
  });
  it("BR-050 original restore path and namespace substitution deny", async () => {
    const f = await fixture({ KDRIVE_MCP_DENY: "/Shared/Project/a/old/**" });
    expect(
      await f.policy.dispatch({
        kind: "restore",
        target: ref(26),
        destination: ref(23),
      }),
    ).toEqual(denied);
    f.items.delete("original-trash:8:26");
    expect(
      await f.policy.dispatch({
        kind: "restore",
        target: ref(26),
        destination: ref(23),
      }),
    ).toEqual(denied);
  });
  it("BR-057 collections filter unreadable entries and reject conflicting duplicate/bindings", async () => {
    const f = await fixture();
    f.file.capabilities.read = false;
    const result = await f.policy.dispatch({ kind: "list", scope: ref(22) });
    expect(result).toMatchObject({ ok: true, value: { entries: [] } });
    f.received.collection.mockImplementation(async (r) => {
      await Promise.resolve();
      return {
        ...r,
        status: "complete",
        terminal: true,
        entries: [f.file, { ...f.file, path: "/conflict" }],
      };
    });
    expect(await f.policy.dispatch({ kind: "list", scope: ref(22) })).toEqual(
      denied,
    );
    f.received.collection.mockImplementation(async (r) => {
      await Promise.resolve();
      return {
        ...r,
        invocation: {},
        status: "complete",
        terminal: true,
        entries: [],
      };
    });
    expect(await f.policy.dispatch({ kind: "list", scope: ref(22) })).toEqual(
      denied,
    );
  });
  it("BR-057 fake tool/resource single guard, immutable inputs, denied batch and grant nonreuse", async () => {
    const f = await fixture();
    const tool = () => f.policy.dispatch(read),
      resource = () => f.policy.dispatch(read);
    expect((await tool()).ok).toBe(true);
    expect((await resource()).ok).toBe(true);
    expect(await f.policy.check(read)).toEqual({ allowed: true });
    f.file.capabilities.read = false;
    expect(await tool()).toEqual(denied);
    expect(
      await f.policy.dispatch({
        kind: "batch",
        operations: [
          {
            kind: "replace",
            target: ref(24),
            destination: ref(22),
            name: "report",
          },
          {
            kind: "replace",
            target: ref(999),
            destination: ref(22),
            name: "report",
          },
        ],
      }),
    ).toEqual(denied);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(Object.keys(f.policy).sort()).toEqual(["check", "dispatch"]);
  });
  it.each([false, true])(
    "BR-057 interacting shared batch denies reversed=%s",
    async (reverse) => {
      const f = await fixture();
      const ops = [
        { kind: "move", target: ref(22), destination: ref(23) },
        { kind: "rename", target: ref(23), name: "changed" },
      ];
      expect(
        await f.policy.dispatch({
          kind: "batch",
          // eslint-disable-next-line sonarjs/no-misleading-array-reverse -- F-011: in-place reordering of a local array is intended
          operations: reverse ? ops.reverse() : ops,
        }),
      ).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each(["is_team_space", "is_private_space"])(
    "BR-058 visibility %s leaves ordinary configured routing intact",
    async (visibility) => {
      const f = await fixture();
      f.configured.inspect.mockResolvedValue({
        status: "complete",
        driveId: 7,
        id: 50,
        type: "dir",
        name: "team",
        path: "/team",
        parents: [],
        rootId: 1,
        location: "live",
        lifecycle: "live",
        visibility,
      });
      expect(
        (await f.policy.dispatch({ kind: "read", target: ref(50, 7) })).ok,
      ).toBe(true);
      expect(f.received.list).not.toHaveBeenCalled();
      expect(f.received.inspect).not.toHaveBeenCalled();
    },
  );
});

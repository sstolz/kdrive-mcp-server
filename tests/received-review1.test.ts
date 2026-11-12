import { expect, it, vi } from "vitest";
import {
  fixture,
  ref,
  denied,
  node,
  type SharedNode,
} from "./helpers/received.js";
import type { Location } from "../src/policy/index.js";

it("BR-056 R1 unused nested capability data never invokes getters", async () => {
  const f = await fixture(),
    getter = vi.fn(() => undefined);
  const unsafe = {
    ...f.file,
    capabilities: {
      ...f.file.capabilities,
      unused: Object.defineProperty({}, "toJSON", { get: getter }),
    },
  };
  f.received.collection.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      terminal: true,
      entries: [unsafe],
    }),
  );
  expect((await f.policy.dispatch({ kind: "list", scope: ref(22) })).ok).toBe(
    true,
  );
  expect(getter).not.toHaveBeenCalled();
});
it("BR-056 BR-057 R1 contradictory capabilities cannot hide behind toJSON callbacks", async () => {
  const f = await fixture(),
    callback = vi.fn(() => ({ read: true }));
  const values = [true, false].map((read) => ({
    ...f.file,
    capabilities: { ...f.file.capabilities, read, toJSON: callback },
  }));
  f.received.collection.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      terminal: true,
      entries: values,
    }),
  );
  expect(await f.policy.dispatch({ kind: "list", scope: ref(22) })).toEqual(
    denied,
  );
  expect(callback).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
it("BR-053 BR-056 R1 malformed known nested predicate denies without callbacks", async () => {
  const f = await fixture(),
    getter = vi.fn(() => undefined);
  const inspected = {
    ...f.file,
    capabilities: {
      ...f.file.capabilities,
      replace: Object.defineProperty({}, "toJSON", { get: getter }),
    },
  };
  const original = f.received.inspect.getMockImplementation()!;
  f.received.inspect.mockImplementation((r, loc) =>
    r.id === 24 ? Promise.resolve(inspected) : original(r, loc),
  );
  expect(
    await f.policy.dispatch({
      kind: "replace",
      target: ref(24),
      destination: ref(22),
      name: "report",
    }),
  ).toEqual(denied);
  expect(getter).not.toHaveBeenCalled();
});
function forgedRoot(
  f: Awaited<ReturnType<typeof fixture>>,
  location: Location,
): SharedNode {
  const anchor = { ...f.anchor, location, lifecycle: "live" as const };
  const fake = {
    ...node(1, "owner-root", "dir", [anchor]),
    location,
    lifecycle: "live" as const,
  };
  return {
    ...f.file,
    path: fake.path + "/report",
    parents: [anchor, fake],
    location,
    lifecycle: location === "live" ? "live" : "trashed",
    ...(location === "original-trash" ? { treeRootId: 24 } : {}),
  };
}
it.each(["read", "collection", "descendant", "original"])(
  "BR-049 BR-056 R2 owner-root sentinel cannot enter received proof %s",
  async (kind) => {
    const f = await fixture({ KDRIVE_MCP_DENY: "/never" });
    const fake = forgedRoot(f, kind === "original" ? "original-trash" : "live");
    if (kind === "read" || kind === "original")
      f.items.set(fake.location + ":8:24", fake);
    if (kind === "collection")
      f.received.collection.mockImplementation((r) =>
        Promise.resolve({
          ...r,
          status: "complete",
          terminal: true,
          entries: [fake],
        }),
      );
    if (kind === "descendant") {
      const forgedDirectory = {
        ...f.a,
        path: fake.parents[1]!.path + "/a",
        parents: fake.parents,
      };
      const forgedChild = {
        ...f.file,
        path: forgedDirectory.path + "/report",
        parents: [...fake.parents, forgedDirectory],
      };
      f.items.set("live:8:22", forgedDirectory);
      f.received.children.mockImplementation((r) =>
        Promise.resolve({
          ...r,
          status: "complete",
          terminal: true,
          entries: [forgedChild],
        }),
      );
    }
    const result = await f.policy.dispatch(
      kind === "collection"
        ? { kind: "search", scope: ref(20), query: "" }
        : kind === "descendant"
          ? { kind: "trash", target: ref(22) }
          : kind === "original"
            ? { kind: "restore", target: ref(24), destination: ref(23) }
            : { kind: "read", target: ref(24) },
    );
    if (kind === "collection")
      expect(result).toMatchObject({ ok: true, value: { entries: [] } });
    else expect(result).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  },
);
async function overlapping() {
  const f = await fixture({ KDRIVE_MCP_DENY: "/never" });
  const narrow = { ...structuredClone(f.a), anchorId: 22, parents: [] };
  f.received.list.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      discover: true,
      entries: [f.anchor, narrow],
      terminal: true,
    }),
  );
  const original = f.received.inspect.getMockImplementation()!;
  f.received.inspect.mockImplementation((r, loc) =>
    r.id === 22 && loc === "live"
      ? Promise.resolve(structuredClone(narrow))
      : original(r, loc),
  );
  return { ...f, narrow };
}
it.each([false, true])(
  "BR-049 BR-057 R3 compatible overlapping-anchor read batch succeeds reversed=%s",
  async (reverse) => {
    const f = await overlapping();
    const ops = [
      { kind: "read", target: ref(24) },
      { kind: "read", target: ref(22) },
    ];
    for (const op of ops) expect((await f.policy.dispatch(op)).ok).toBe(true);
    expect(
      (
        await f.policy.dispatch({
          kind: "batch",
          // eslint-disable-next-line sonarjs/no-misleading-array-reverse -- F-011: in-place reordering of a local array is intended
          operations: reverse ? ops.reverse() : ops,
        })
      ).ok,
    ).toBe(true);
  },
);
it.each(["list", "search"])(
  "BR-049 BR-057 R3 overlapping-anchor scoped %s exposes permitted child",
  async (kind) => {
    const f = await overlapping();
    expect(
      await f.policy.dispatch({
        kind,
        scope: ref(22),
        ...(kind === "search" ? { query: "" } : {}),
      }),
    ).toMatchObject({ ok: true, value: { entries: [{ id: 24 }] } });
  },
);
it("BR-049 BR-057 R3 compatible duplicate entries keep one identity across anchor routes", async () => {
  const f = await overlapping(),
    narrowChild = { ...f.file, anchorId: 22, parents: [f.narrow] };
  f.received.collection.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      terminal: true,
      entries: [f.file, narrowChild],
    }),
  );
  expect(
    await f.policy.dispatch({ kind: "search", scope: ref(22), query: "" }),
  ).toMatchObject({ ok: true, value: { entries: [{ id: 24 }] } });
});
it.each(["broad", "narrow"])(
  "BR-050 R3 recursive mutation reconciles anchor-relative chains %s",
  async (route) => {
    const f = await overlapping();
    if (route === "narrow") {
      f.file.anchorId = 22;
      f.file.parents = [f.narrow];
      f.other.anchorId = 22;
      f.other.parents = [f.narrow];
    }
    expect(
      (
        await f.policy.dispatch({
          kind: "trash",
          target: ref(route === "broad" ? 22 : 20),
        })
      ).ok,
    ).toBe(true);
    expect(f.received.children).toHaveBeenCalled();
    expect(f.execute).toHaveBeenCalledTimes(1);
  },
);
it.each(["path", "identity", "type", "lifecycle"])(
  "BR-049 BR-056 R3 overlapping-anchor contradictions still deny %s",
  async (mode) => {
    const f = await overlapping();
    if (mode === "path") {
      f.narrow.path = "/Shared/Conflicting";
      f.narrow.name = "Conflicting";
    }
    if (mode === "identity") f.file.parents[1] = { ...f.a, id: 99 };
    if (mode === "type") f.narrow.type = "file";
    if (mode === "lifecycle") f.narrow.lifecycle = "trashed";
    const result = await f.policy.dispatch({
      kind: "batch",
      operations: [
        { kind: "read", target: ref(22) },
        { kind: "read", target: ref(24) },
      ],
    });
    expect(result).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  },
);

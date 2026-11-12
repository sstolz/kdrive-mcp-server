import { describe, expect, it, vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../src/config.js";
import { createPolicy, type EvidenceRequest } from "../src/policy/index.js";
import { Refusal } from "../src/policy/values.js";

type Ref = { driveId: number; id: number };
type Location = "live" | "original-trash";
type Node = Ref & {
  status: "complete";
  location: Location;
  lifecycle: "live" | "trashed";
  type: "file" | "dir";
  name: string;
  path: string;
  rootId: 1;
  parents: Parent[];
  treeRootId?: number;
};
type Parent = Ref & {
  type: "dir";
  name: string;
  path: string;
  location: Location;
  lifecycle: "live" | "trashed";
};
const ref = (id: number, driveId = 7): Ref => ({ driveId, id });
function node(
  id: number,
  path: string,
  type: "file" | "dir" = "file",
  parents: Node[] = [],
  location: Location = "live",
  treeRootId?: number,
): Node {
  return {
    ...ref(id),
    status: "complete",
    location,
    lifecycle: location === "live" ? "live" : "trashed",
    type,
    name: path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1),
    path,
    rootId: 1,
    parents: parents.map(
      ({ driveId, id: parentId, name, path: parentPath }) => ({
        driveId,
        id: parentId,
        type: "dir",
        name,
        path: parentPath,
        location,
        lifecycle: "live",
      }),
    ),
    ...(treeRootId === undefined ? {} : { treeRootId }),
  };
}
const root = node(10, "/r", "dir");
const a = node(11, "/r/a", "dir", [root]);
const b = node(12, "/r/b", "dir", [root]);
const file = node(13, "/r/a/report", "file", [root, a]);
const read = (id = 13, driveId = 7) => ({
  kind: "read",
  target: ref(id, driveId),
});
const denied = { ok: false, code: "ACCESS_DENIED" };
const page = (entries: unknown[], next?: string) => ({
  status: "complete",
  entries,
  ...(next === undefined ? { terminal: true } : { next }),
});

async function fixture(
  env: Record<string, string> = {},
  nodes: Node[] = [root, a, b, file],
) {
  const local = await loadConfiguration({
    argv: [],
    env: {
      KDRIVE_ID: "7",
      KDRIVE_TOKEN: "SYNTHETIC",
      KDRIVE_MCP_ROOTS: "7:10",
      ...env,
    },
    cwd: "/work",
  });
  const config = await preflightConfiguration(local, {
    inspectDrive: (driveId) =>
      Promise.resolve().then(() => ({ id: driveId, role: "admin" })),
    resolveDirectory: (driveId, selector) =>
      Promise.resolve().then(() => ({
        driveId,
        id: selector.kind === "id" ? selector.value : 10,
        type: "dir",
      })),
  });
  const items = new Map(
    nodes.map((item) => [
      `${item.location}:${item.driveId}:${item.id}`,
      structuredClone(item),
    ]),
  );
  const inspect = vi.fn((target: Ref, location: Location): Promise<unknown> =>
    Promise.resolve().then(() =>
      structuredClone(
        items.get(`${location}:${target.driveId}:${target.id}`) ?? {
          status: "missing",
        },
      ),
    ),
  );
  const children = vi.fn((request: EvidenceRequest): Promise<unknown> =>
    Promise.resolve().then(() => ({ ...page([]), ...request })),
  );
  const collection = vi.fn(
    (request: { scope: Ref; kind: string }): Promise<unknown> =>
      Promise.resolve().then(() => ({
        ...page([]),
        ...request,
      })),
  );
  const execute = vi.fn((operation: unknown): Promise<unknown> =>
    Promise.resolve().then(() => ({
      executed: operation,
    })),
  );
  const dependencies = { inspect, children, collection, execute };
  const policy = createPolicy(config, dependencies);
  return {
    local,
    config,
    policy,
    items,
    inspect,
    children,
    collection,
    execute,
    dependencies,
  };
}

describe("policy trust and roots", () => {
  it("BR-029 rejects unresolved and forged resolved configuration, without I/O", async () => {
    const f = await fixture();
    expect(() => createPolicy(f.local, f.dependencies)).toThrow();
    expect(() => createPolicy({ ...f.config }, f.dependencies)).toThrow();
    expect(f.inspect).not.toHaveBeenCalled();
    expect(await f.policy.dispatch(read())).toMatchObject({ ok: true });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["path", "parents", "allowed", "effects"])(
    "BR-029 rejects caller authority field %s",
    async (field) => {
      const f = await fixture();
      expect(await f.policy.dispatch({ ...read(), [field]: true })).toEqual(
        denied,
      );
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("BR-030 root self and ancestor match, siblings and colliding drive IDs fail", async () => {
    const f = await fixture({}, [
      ...[root, a, b, file],
      node(30, "/outside"),
      { ...file, driveId: 8 },
    ]);
    expect(await f.policy.dispatch(read(10))).toMatchObject({ ok: true });
    expect(await f.policy.dispatch(read())).toMatchObject({ ok: true });
    expect(await f.policy.dispatch(read(30))).toEqual(denied);
    expect(await f.policy.dispatch(read(13, 8))).toEqual(denied);
  });
  it("BR-030 BR-034 root 1 need not occur in parents but does not bypass denies", async () => {
    const f = await fixture(
      { KDRIVE_MCP_ROOTS: "7:1", KDRIVE_MCP_DENY: "/r/a/**" },
      [node(1, "/", "dir"), root, a, file],
    );
    expect(await f.policy.dispatch(read(1))).toMatchObject({ ok: true });
    expect(await f.policy.dispatch(read())).toEqual(denied);
  });
  it("BR-031 identity follows external rename/move; old-path replacement has no authority", async () => {
    const outside = node(20, "/else", "dir");
    const moved = node(10, "/else/new", "dir", [outside]);
    const child = node(13, "/else/new/report", "file", [outside, moved]);
    const replacement = node(99, "/r", "dir");
    const f = await fixture({}, [moved, child, replacement, outside]);
    expect(await f.policy.dispatch(read())).toMatchObject({ ok: true });
    expect(await f.policy.dispatch(read(99))).toEqual(denied);
  });
  it("BR-032 external movement outside root is denied on next fresh check", async () => {
    const f = await fixture();
    expect(await f.policy.dispatch(read())).toMatchObject({ ok: true });
    f.items.set("live:7:13", node(13, "/outside"));
    expect(await f.policy.dispatch(read())).toEqual(denied);
    expect(f.inspect).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "missing" },
    { status: "incomplete" },
    { status: "failed" },
    { ...file, id: 77 },
    { ...file, driveId: 8 },
    { ...file, type: "link" },
    { ...file, lifecycle: "trashed" },
    { ...file, location: "original-trash" },
    { ...file, path: "/r/b/report" },
    { ...file, rootId: 2 },
    { ...file, parents: [root, root] },
    { ...file, parents: [a, root] },
    { ...file, parents: [] },
    { ...file, parents: [root, { ...a, id: 13 }] },
    { ...file, parents: [root, { ...a, location: "original-trash" }] },
    { ...file, name: "../report" },
    { ...file, path: "/r//a/report" },
  ])("BR-033 rejects malformed/incomplete proof %#", async (proof) => {
    const f = await fixture();
    f.inspect.mockResolvedValue(proof);
    expect(await f.policy.dispatch(read())).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
});

describe("path and operation effects", () => {
  it.each([
    ["/private/**", "/private", true],
    ["/private/**", "/private/a/b", true],
    ["/private/**", "/private2/a", false],
    ["**/.ssh/**", "/a/.ssh/key", true],
    ["**/.ssh/**", "/.ssh", true],
    ["**/.ssh/**", "/a/.ssh2/key", false],
    ["/a/*/c", "/a/b/c", true],
    ["/a/*/c", "/a/b/d/c", false],
    ["/a/*/c", "/a/c", false],
    ["/a/?", "/a/😀", true],
    ["/a/?", "/a/é", true],
    ["/a/?", "/a/ee", false],
    ["/A/%2F", "/A/%2F", true],
    ["/A/%2F", "/a/%2F", false],
    ["/café", "/café", false],
    ["/café", "/café", true],
    ["/r/a/*", "/r/a/report", true],
    ["/r/a", "/r/a/report", false],
    ["/a/x*", "/a/x", true],
    ["/a/**/x", "/a/x", true],
    ["/a/space %", "/a/space %", true],
    ["/", "/", true],
  ])("BR-034 glob %s on %s denies=%s", async (pattern, path, matches) => {
    const components = path.split("/").filter(Boolean);
    const ancestors = components
      .slice(0, -1)
      .map((_, i) =>
        node(100 + i, `/${components.slice(0, i + 1).join("/")}`, "dir"),
      );
    const target = node(13, path, "file", ancestors);
    const f = await fixture(
      { KDRIVE_MCP_ROOTS: "7:1", KDRIVE_MCP_DENY: pattern },
      [target],
    );
    expect((await f.policy.dispatch(read())).ok).toBe(!matches);
  });
  it.each([
    { kind: "create", destination: ref(11), name: "secret", type: "file" },
    { kind: "upload-new", destination: ref(11), name: "secret" },
    { kind: "rename", target: ref(13), name: "secret" },
    { kind: "move", target: ref(13), destination: ref(12), name: "secret" },
  ])("BR-035 forbidden derived result rejects $kind", async (operation) => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "**/secret",
    });
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "replace", target: ref(13), destination: ref(11), name: "report" },
    { kind: "trash", target: ref(13) },
    { kind: "rename", target: ref(13), name: "public" },
    { kind: "move", target: ref(13), destination: ref(12) },
  ])("BR-035 forbidden current source rejects $kind", async (operation) => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/r/a/**",
    });
    expect(await f.policy.dispatch(operation)).toEqual(denied);
  });
  it.each([
    { kind: "create", destination: ref(13), name: "x", type: "file" },
    { kind: "rename", target: ref(1), name: "x" },
    { kind: "trash", target: ref(1) },
    { kind: "move", target: ref(11), destination: ref(11) },
    { kind: "move", target: ref(11), destination: ref(12, 8) },
    { kind: "rename", target: ref(13), name: "../x" },
    { kind: "invented", target: ref(13) },
  ])("BR-035 invalid structural operation %#", async (operation) => {
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_ROOTS: "7:1" },
      [node(1, "/", "dir"), root, a, b, file],
    );
    expect(await f.policy.dispatch(operation)).toEqual(denied);
  });
  it("BR-036 descendant denial before and after directory rename/move/trash", async () => {
    for (const operation of [
      { kind: "rename", target: ref(11), name: "hidden" },
      { kind: "move", target: ref(11), destination: ref(12) },
      { kind: "trash", target: ref(11) },
    ]) {
      const f = await fixture({
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_DENY: "**/report",
      });
      f.children.mockImplementation((request) =>
        Promise.resolve().then(() => ({
          ...request,
          ...page(request.id === 11 ? [file] : []),
        })),
      );
      expect(await f.policy.dispatch(operation)).toEqual(denied);
    }
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/r/hidden/report",
    });
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page([file]),
      })),
    );
    expect(
      await f.policy.dispatch({
        kind: "rename",
        target: ref(11),
        name: "hidden",
      }),
    ).toEqual(denied);
  });
  it("BR-038 empty deny skips descendants without skipping membership and level", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" });
    expect(
      await f.policy.dispatch({ kind: "rename", target: ref(11), name: "new" }),
    ).toMatchObject({ ok: true });
    expect(f.children).not.toHaveBeenCalled();
    const other = await fixture();
    expect(
      await other.policy.dispatch({ kind: "trash", target: ref(11) }),
    ).toEqual(denied);
    expect(other.children).not.toHaveBeenCalled();
  });
});

describe("additional frozen acceptance boundaries", () => {
  it.each([
    { kind: "read", target: ref(13) },
    { kind: "list", scope: ref(11) },
    { kind: "search", scope: ref(11), query: "report" },
    { kind: "recents", scope: ref(11) },
    { kind: "my-shared", scope: ref(11) },
    { kind: "create", destination: ref(11), name: "new", type: "file" },
    { kind: "create", destination: ref(11), name: "new-dir", type: "dir" },
    { kind: "upload-new", destination: ref(11), name: "new" },
    { kind: "replace", target: ref(13), destination: ref(11), name: "report" },
    { kind: "rename", target: ref(13), name: "new" },
    { kind: "rename", target: ref(11), name: "new" },
    { kind: "move", target: ref(13), destination: ref(12) },
    { kind: "move", target: ref(11), destination: ref(12) },
    { kind: "trash", target: ref(13) },
    { kind: "trash", target: ref(11) },
    { kind: "share-link", target: ref(13) },
    { kind: "share-invite", target: ref(13), domain: "example.com" },
  ])("BR-035 complete permitted matrix row $kind", async (op) => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "share",
      KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "1",
      KDRIVE_MCP_INVITE_DOMAINS: "example.com",
    });
    expect(await f.policy.dispatch(op)).toMatchObject({ ok: true });
  });
  it("BR-029 immutable preflight deny settings cannot change constructed policy", async () => {
    const f = await fixture({ KDRIVE_MCP_DENY: "/never" });
    expect(() => (f.config.deny as string[]).push("/r/**")).toThrow(TypeError);
    expect(await f.policy.dispatch(read())).toMatchObject({ ok: true });
  });
  it.each(["read", "write", "share"])(
    "BR-041 public link switches at level %s",
    async (mode) => {
      for (const enabled of ["0", "1"]) {
        const f = await fixture({
          KDRIVE_MCP_MODE: mode,
          KDRIVE_MCP_ALLOW_PUBLIC_LINKS: enabled,
        });
        expect(
          (await f.policy.dispatch({ kind: "share-link", target: ref(13) })).ok,
        ).toBe(mode === "share" && enabled === "1");
      }
    },
  );
  it("BR-037 root-sentinel omission and separate listing tokens are supported", async () => {
    const driveRoot = node(1, "/", "dir");
    const first = node(10, "/r", "dir");
    const f = await fixture(
      {
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_ROOTS: "7:1",
        KDRIVE_MCP_DENY: "/never",
      },
      [driveRoot, first],
    );
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({ ...request, ...page([]) })),
    );
    expect(
      await f.policy.dispatch({ kind: "trash", target: ref(10) }),
    ).toMatchObject({ ok: true });
    const requests: unknown[] = [];
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => {
        requests.push(request.listing);
        return { ...request, ...page([]) };
      }),
    );
    await f.policy.dispatch({ kind: "trash", target: ref(10) });
    await f.policy.dispatch({ kind: "trash", target: ref(10) });
    expect(requests[0]).not.toBe(requests[1]);
  });
  it("BR-037 independently constructed endless page fake stops below request budget", async () => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_MAX_TREE_ITEMS: "3",
      KDRIVE_MCP_DENY: "/never",
    });
    let requests = 0;
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => {
        requests++;
        return {
          ...request,
          ...page(
            [node(30 + requests, `/r/a/f${requests}`, "file", [root, a])],
            `cursor-${requests}`,
          ),
        };
      }),
    );
    expect(await f.policy.dispatch({ kind: "trash", target: ref(11) })).toEqual(
      denied,
    );
    expect(requests).toBe(3);
    expect(requests).toBeLessThanOrEqual(2 * 3 + 256);
  });
  // BR-039 v2 (F-017): the destination is the evidence's immediate parent
  // `a`, inspected live; the operation carries only its target.
  it.each([
    "live-source",
    "denied-original",
    "denied-destination",
    "trashed-destination",
  ])("BR-039 v2 restore refuses %s", async (mode) => {
    const old = node(
      13,
      "/r/a/report",
      "file",
      [root, a],
      "original-trash",
      13,
    );
    const f = await fixture(
      {
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_DENY:
          mode === "denied-original"
            ? "/r/a/report"
            : mode === "denied-destination"
              ? "/r/a"
              : "/never",
      },
      [root, a, b, old],
    );
    if (mode === "live-source") f.items.set("original-trash:7:13", file);
    if (mode === "trashed-destination")
      f.items.set("live:7:11", { ...a, lifecycle: "trashed" });
    expect(
      await f.policy.dispatch({ kind: "restore", target: ref(13) }),
    ).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(["parents", "lifecycle", "path", "treeRootId"])(
    "BR-039 malformed original-trash %s refuses",
    async (field) => {
      const old = node(
        13,
        "/r/a/report",
        "file",
        [root, a],
        "original-trash",
        13,
      );
      const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [root, a, b, old]);
      f.items.set("original-trash:7:13", {
        ...old,
        [field]: undefined,
      });
      expect(
        await f.policy.dispatch({ kind: "restore", target: ref(13) }),
      ).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("BR-036 BR-037 grandchild results and multi-target combined ceiling are checked", async () => {
    const inner = node(20, "/r/a/inner", "dir", [root, a]);
    const child = node(21, "/r/a/inner/key", "file", [root, a, inner]);
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: "/r/new/inner/key" },
      [root, a, b, inner, child],
    );
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page(request.id === 11 ? [inner] : [child]),
      })),
    );
    expect(
      await f.policy.dispatch({ kind: "rename", target: ref(11), name: "new" }),
    ).toEqual(denied);
    const g = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/never",
      KDRIVE_MCP_MAX_TREE_ITEMS: "3",
    });
    g.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page(
          request.id === 11
            ? [file]
            : [
                node(30, "/r/b/x", "file", [root, b]),
                node(31, "/r/b/y", "file", [root, b]),
              ],
        ),
      })),
    );
    expect(
      await g.policy.dispatch({
        kind: "batch",
        operations: [
          { kind: "trash", target: ref(11) },
          { kind: "trash", target: ref(12) },
        ],
      }),
    ).toEqual(denied);
    expect(g.execute).not.toHaveBeenCalled();
  });
  it.each([
    [
      { kind: "rename", target: ref(13), name: "x" },
      { kind: "create", destination: ref(11), name: "x", type: "file" },
    ],
    [
      { kind: "trash", target: ref(11) },
      { kind: "read", target: ref(13) },
    ],
    [
      { kind: "move", target: ref(11), destination: ref(12) },
      { kind: "create", destination: ref(11), name: "x", type: "file" },
    ],
  ])(
    "BR-045 rejects overlapping result/dependency regions %#",
    async (first, second) => {
      const f = await fixture({ KDRIVE_MCP_MODE: "write" });
      expect(
        await f.policy.dispatch({ kind: "batch", operations: [first, second] }),
      ).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("BR-043 execution failure propagates rather than claiming no write", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" });
    const failure = new Error("SYNTHETIC_EXECUTION_FAILURE");
    f.execute.mockRejectedValue(failure);
    await expect(
      f.policy.dispatch({
        kind: "replace",
        target: ref(13),
        destination: ref(11),
        name: "report",
      }),
    ).rejects.toBe(failure);
  });
  it("BR-033 live parent lifecycle cannot be trashed", async () => {
    const f = await fixture();
    f.inspect.mockResolvedValue({
      ...file,
      parents: [root, { ...a, lifecycle: "trashed" }],
    });
    expect(await f.policy.dispatch(read())).toEqual(denied);
  });
});

describe("complete tree and original-trash proofs", () => {
  it.each([
    [1, 0, true],
    [1, 1, false],
    [3, 2, true],
    [3, 3, false],
    [3, 4, false],
  ])("BR-037 N=%i count=%i permitted=%s", async (limit, count, permitted) => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/never",
      KDRIVE_MCP_MAX_TREE_ITEMS: String(limit),
    });
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page(
          Array.from({ length: count }, (_, i) =>
            node(50 + i, `/r/a/f${i}`, "file", [root, a]),
          ),
        ),
      })),
    );
    expect(
      (await f.policy.dispatch({ kind: "trash", target: ref(11) })).ok,
    ).toBe(permitted);
  });
  it.each([
    "loop",
    "duplicate",
    "missing-final",
    "later-failure",
    "empty-next",
    "wrong-parent",
  ])("BR-037 incomplete paged tree %s denies", async (mode) => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/never",
    });
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => {
        if (mode === "missing-final")
          return { ...request, status: "complete", entries: [] };
        if (mode === "empty-next") return { ...request, ...page([], "next") };
        if (mode === "wrong-parent") return { ...request, ...page([b]) };
        if (!request.cursor) return { ...request, ...page([file], "next") };
        if (mode === "later-failure") throw new Error("SYNTHETIC");
        return {
          ...request,
          ...page(
            mode === "loop"
              ? [node(14, "/r/a/other", "file", [root, a])]
              : [file],
            mode === "loop" ? "next" : undefined,
          ),
        };
      }),
    );
    expect(await f.policy.dispatch({ kind: "trash", target: ref(11) })).toEqual(
      denied,
    );
    expect(f.children.mock.calls.length).toBeLessThanOrEqual(2);
  });
  it("BR-037 equal cursor text across separate directories is permitted", async () => {
    const inner = node(20, "/r/a/inner", "dir", [root, a]);
    const f1 = node(21, "/r/a/one", "file", [root, a]);
    const f2 = node(22, "/r/a/two", "file", [root, a]);
    const f3 = node(23, "/r/a/inner/three", "file", [root, a, inner]);
    const f4 = node(24, "/r/a/inner/four", "file", [root, a, inner]);
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/never",
    });
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page(
          request.id === 11
            ? request.cursor
              ? [f2]
              : [inner, f1]
            : request.cursor
              ? [f4]
              : [f3],
          request.cursor ? undefined : "SAME",
        ),
      })),
    );
    expect(
      await f.policy.dispatch({ kind: "trash", target: ref(11) }),
    ).toMatchObject({ ok: true });
    expect(f.children).toHaveBeenCalledTimes(4);
  });
  it("BR-039 requires original proof, complete original descendants and live destination", async () => {
    const old = node(11, "/r/a", "dir", [root], "original-trash", 11);
    const oldFile = node(
      13,
      "/r/a/report",
      "file",
      [root, old],
      "original-trash",
      11,
    );
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: "/never" },
      [root, b, old, oldFile],
    );
    // BR-039 v2: the destination is the former parent, root 10.
    const operation = { kind: "restore", target: ref(11) };
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        treeRootId: 11,
        ...page([oldFile]),
      })),
    );
    expect(await f.policy.dispatch(operation)).toMatchObject({ ok: true });
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        location: "live",
        ...page([file]),
      })),
    );
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    f.children.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        status: "incomplete",
      })),
    );
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    f.items.set("live:7:10", { ...root, lifecycle: "trashed" });
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    f.items.delete("original-trash:7:11");
    expect(await f.policy.dispatch(operation)).toEqual(denied);
  });
  it("BR-039 outside-root original cannot be restored into allowed scope, even with empty denies", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [
      root,
      b,
      node(30, "/outside", "file", [], "original-trash", 30),
    ]);
    expect(
      await f.policy.dispatch({ kind: "restore", target: ref(30) }),
    ).toEqual(denied);
    expect(f.children).not.toHaveBeenCalled();
  });
});

describe("PR42 review regressions", () => {
  it.each([
    [false, ""],
    [true, ""],
    [false, "/r/c/secret"],
    [true, "/r/c/secret"],
  ])(
    "BR-033 BR-045 R1 ancestor identity contradicts current paths reversed=%s deny=%s",
    async (reverse, deny) => {
      const moved = node(11, "/r/renamed", "dir", [root]);
      const changed = node(13, "/r/renamed/report", "file", [root, moved]);
      const f = await fixture(
        { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: deny },
        [root, a, changed],
      );
      f.children.mockImplementation((request) =>
        Promise.resolve({ ...request, ...page([file]) }),
      );
      const ops = [
        { kind: "rename", target: ref(11), name: "c" },
        { kind: "rename", target: ref(13), name: "secret" },
      ];
      expect(
        await f.policy.dispatch({
          kind: "batch",
          operations: reverse ? [...ops].reverse() : ops,
        }),
      ).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("BR-033 BR-037 R2 repeated descendants across batch targets refuse below ceiling", async () => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "/never",
      KDRIVE_MCP_MAX_TREE_ITEMS: "10",
    });
    f.children.mockImplementation((request) =>
      Promise.resolve({
        ...request,
        ...page([
          request.id === 11 ? file : node(13, "/r/b/report", "file", [root, b]),
        ]),
      }),
    );
    expect(
      await f.policy.dispatch({
        kind: "batch",
        operations: [
          { kind: "trash", target: ref(11) },
          { kind: "trash", target: ref(12) },
        ],
      }),
    ).toEqual(denied);
    expect(f.children).toHaveBeenCalledTimes(2);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(["forged", "getter", "prototype-trap"])(
    "BR-046 R3 hostile thrown refusal %s normalizes",
    async (mode) => {
      const f = await fixture();
      const getter = vi.fn(() => {
        throw new Error("MUST_NOT_READ_CODE");
      });
      const forged: unknown = Object.create(Refusal.prototype) as unknown;
      if (mode === "forged")
        Object.defineProperty(forged, "code", {
          value: "SYNTHETIC_RAW_PATH:/private",
        });
      if (mode === "getter")
        Object.defineProperty(forged, "code", { get: getter });
      const thrown =
        mode === "prototype-trap"
          ? new Proxy({}, { getPrototypeOf: getter })
          : forged;
      f.inspect.mockRejectedValue(thrown);
      expect(await f.policy.check(read())).toEqual({
        allowed: false,
        code: "EVIDENCE_UNAVAILABLE",
      });
      expect(await f.policy.dispatch(read())).toEqual(denied);
      expect(getter).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each(["drive", "listing", "cursor", "namespace"])(
    "BR-037 R4 child page rejects wrong %s binding",
    async (mode) => {
      const f = await fixture({
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_DENY: "/never",
        KDRIVE_MCP_MAX_TREE_ITEMS: "10",
      });
      f.children.mockImplementation((request) =>
        Promise.resolve({
          ...request,
          ...page([file]),
          ...(mode === "drive"
            ? { driveId: 8 }
            : mode === "listing"
              ? { listing: {} }
              : mode === "cursor"
                ? { cursor: "UNREQUESTED" }
                : { location: "original-trash" }),
        }),
      );
      expect(
        await f.policy.dispatch({ kind: "trash", target: ref(11) }),
      ).toEqual(denied);
      expect(f.children).toHaveBeenCalledTimes(1);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
});

describe("PR42 second review regressions", () => {
  it("BR-035 R1 rejects caller map returning an unregistered kind", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" });
    const inputs = [read()];
    const custom = vi.fn(() => [{ kind: "unregistered-operation" }]);
    Object.defineProperty(inputs, "map", { value: custom });
    expect(
      await f.policy.dispatch({ kind: "batch", operations: inputs }),
    ).toEqual(denied);
    expect(custom).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("BR-035 BR-041 BR-043 R1 rejects map preserving a mutable read-to-trash operation", async () => {
    const f = await fixture();
    const raw = read(),
      inputs = [raw];
    const custom = vi.fn(() => [raw]);
    Object.defineProperty(inputs, "map", { value: custom });
    const pending = f.policy.dispatch({ kind: "batch", operations: inputs });
    raw.kind = "trash";
    expect(await pending).toEqual(denied);
    expect(custom).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("BR-043 R1 ordinary batch operation stays immutable across inspection await", async () => {
    const f = await fixture(),
      raw = read();
    f.inspect.mockImplementation(() =>
      Promise.resolve().then(() => {
        raw.kind = "trash";
        return file;
      }),
    );
    expect(
      await f.policy.dispatch({ kind: "batch", operations: [raw] }),
    ).toMatchObject({ ok: true });
    expect(f.execute).toHaveBeenCalledWith({
      kind: "batch",
      operations: [read()],
    });
  });
  it.each(["getter", "iterator", "subclass", "hole"])(
    "BR-035 R1 rejects unsupported batch array %s without callbacks",
    async (mode) => {
      const f = await fixture();
      const callback = vi.fn(() => read());
      let inputs: unknown[] = [read()];
      if (mode === "getter")
        Object.defineProperty(inputs, "0", { get: callback });
      if (mode === "iterator")
        Object.defineProperty(inputs, Symbol.iterator, { value: callback });
      if (mode === "subclass") {
        class Inputs extends Array<unknown> {}
        inputs = new Inputs(read());
      }
      if (mode === "hole") inputs = new Array<unknown>(1);
      expect(
        await f.policy.dispatch({ kind: "batch", operations: inputs }),
      ).toEqual(denied);
      expect(callback).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each(["page-slice", "parent-iterator"])(
    "BR-033 R1 rejects unsafe evidence array %s without callbacks",
    async (mode) => {
      const f = await fixture();
      const callback = vi.fn(() =>
        mode === "page-slice" ? [file] : [root, a],
      );
      if (mode === "page-slice") {
        const entries: unknown[] = [];
        Object.defineProperty(entries, "slice", { value: callback });
        f.collection.mockImplementation((request) =>
          Promise.resolve({ ...request, ...page(entries) }),
        );
        expect(
          await f.policy.dispatch({ kind: "list", scope: ref(11) }),
        ).toEqual(denied);
      } else {
        const parents = [...file.parents];
        Object.defineProperty(parents, Symbol.iterator, { value: callback });
        f.inspect.mockResolvedValue({ ...file, parents });
        expect(await f.policy.dispatch(read())).toEqual(denied);
      }
      expect(callback).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    [false, 10],
    [true, 10],
    [false, 11],
    [true, 11],
  ])(
    "BR-033 BR-044 R2 denied collection ancestry conflicts reversed=%s scope=%s",
    async (reverse, scope) => {
      const moved = node(11, "/r/private", "dir", [root]);
      const hidden = node(99, "/r/private/secret", "file", [root, moved]);
      const f = await fixture({ KDRIVE_MCP_DENY: "/r/private/**" });
      const entries = reverse ? [file, hidden] : [hidden, file];
      f.collection.mockImplementation((request) =>
        Promise.resolve({ ...request, ...page(entries) }),
      );
      expect(
        await f.policy.dispatch({ kind: "list", scope: ref(scope) }),
      ).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
});

describe("PR42 third review restore lifecycle regressions", () => {
  // BR-039 v2 (F-017): the caller no longer picks a destination. The "self"
  // case is evidence naming the trashed source as its own former parent; the
  // "descendant" case is a live former parent whose chain holds the source.
  it.each([
    ["", "self"],
    ["/never", "self"],
    ["", "descendant"],
    ["/never", "descendant"],
  ])(
    "BR-033 BR-039 rejects currently trashed source as live restore destination deny=%s role=%s",
    async (deny, role) => {
      const historical = node(30, "/r/a", "dir", [root]);
      const former = node(21, "/r/a/x", "dir", [root, historical]);
      const old =
        role === "self"
          ? node(11, "/r/a/a", "dir", [root, a], "original-trash", 11)
          : node(
              11,
              "/r/a/x/a",
              "dir",
              [root, historical, former],
              "original-trash",
              11,
            );
      const liveFormer = node(21, "/r/a/x", "dir", [root, a]);
      const f = await fixture(
        { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: deny },
        [root, a, old, liveFormer],
      );
      const operation = { kind: "restore", target: ref(11) };
      expect(await f.policy.dispatch(operation)).toEqual(denied);
      expect(await f.policy.check(operation)).toEqual({
        allowed: false,
        code: "EVIDENCE_UNAVAILABLE",
      });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each(["", "/never"])(
    "BR-039 v2 legitimate restore keeps original-trash and live namespaces separate deny=%s",
    async (deny) => {
      const currentRoot = node(10, "/current", "dir");
      const destination = node(12, "/current/b", "dir", [currentRoot]);
      const old = node(
        11,
        "/current/b/a",
        "dir",
        [currentRoot, destination],
        "original-trash",
        11,
      );
      const oldFile = node(
        13,
        "/current/b/a/report",
        "file",
        [currentRoot, destination, old],
        "original-trash",
        11,
      );
      const f = await fixture(
        { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: deny },
        [currentRoot, destination, old, oldFile],
      );
      f.children.mockImplementation((request) =>
        Promise.resolve({ ...request, ...page([oldFile]) }),
      );
      expect(
        await f.policy.dispatch({ kind: "restore", target: ref(11) }),
      ).toMatchObject({ ok: true });
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );
});

describe("levels, guard lifetime, collections and batches", () => {
  it.each([
    ["/r/a/private/**", false],
    ["/r/ab/**", false],
    ["**/.ssh/**", false],
    ["/else/**", true],
  ])("BR-040 static share prefix %s allowed=%s", async (pattern, permitted) => {
    const f = await fixture({
      KDRIVE_MCP_MODE: "share",
      KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "1",
      KDRIVE_MCP_DENY: pattern,
    });
    expect(
      (await f.policy.dispatch({ kind: "share-link", target: ref(11) })).ok,
    ).toBe(permitted);
    expect(f.children).not.toHaveBeenCalled();
  });
  it.each(["read", "write", "share"])(
    "BR-041 cumulative level %s never widened by switches",
    async (mode) => {
      const f = await fixture({
        KDRIVE_MCP_MODE: mode,
        KDRIVE_MCP_SHARED_WITH_ME: "1",
        KDRIVE_MCP_SHARED_WRITE: "1",
        KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "1",
        KDRIVE_MCP_INVITE_DOMAINS: "example.com",
      });
      expect((await f.policy.dispatch(read())).ok).toBe(true);
      expect(
        (
          await f.policy.dispatch({
            kind: "replace",
            target: ref(13),
            destination: ref(11),
            name: "report",
          })
        ).ok,
      ).toBe(mode !== "read");
      expect(
        (await f.policy.dispatch({ kind: "share-link", target: ref(13) })).ok,
      ).toBe(mode === "share");
      expect(
        (
          await f.policy.dispatch({
            kind: "share-invite",
            target: ref(13),
            domain: "example.com",
          })
        ).ok,
      ).toBe(mode === "share");
      expect(
        await f.policy.dispatch({
          kind: "share-invite",
          target: ref(13),
          domain: "sub.example.com",
        }),
      ).toEqual(denied);
    },
  );
  it.each(["0", "1"])(
    "BR-042 v2 external access denied with switches %s",
    async (enabled) => {
      const f = await fixture({
        KDRIVE_MCP_SHARED_WITH_ME: enabled,
        KDRIVE_MCP_SHARED_WRITE: enabled,
        KDRIVE_MCP_MODE: "share",
      });
      for (const operation of [
        read(13, 8),
        {
          kind: "replace",
          target: ref(13, 8),
          destination: ref(11, 8),
          name: "report",
        },
        { kind: "shared-with-me", scope: ref(1, 8) },
      ])
        expect(await f.policy.dispatch(operation)).toEqual(denied);
    },
  );
  it("BR-043 freezes operation before awaits; check decisions confer no reusable grant", async () => {
    const f = await fixture();
    const operation = read();
    f.inspect.mockImplementation(async () => {
      operation.target.id = 999;
      await Promise.resolve();
      return structuredClone(file);
    });
    expect(await f.policy.dispatch(operation)).toMatchObject({ ok: true });
    expect(f.execute).toHaveBeenCalledWith(read());
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    expect(f.execute).toHaveBeenCalledTimes(1);
    f.inspect.mockResolvedValue(file);
    expect(await f.policy.check(read())).toEqual({ allowed: true });
    expect(f.execute).toHaveBeenCalledTimes(1);
    await f.policy.dispatch(read());
    expect(f.inspect).toHaveBeenCalledTimes(4);
  });
  it("BR-043 fake tool/resource share one guard and no raw adapter export", async () => {
    const f = await fixture();
    const tool = (target: number) => f.policy.dispatch(read(target));
    const resource = (target: number) => f.policy.dispatch(read(target));
    expect(await tool(99)).toEqual(await resource(99));
    expect((await tool(13)).ok).toBe((await resource(13)).ok);
    expect(Object.keys(f.policy).sort()).toEqual(["check", "dispatch"]);
  });
  it("BR-044 collection filters fresh entries without per-item inspection and rejects malformed page", async () => {
    const f = await fixture();
    f.collection.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page([file, node(90, "/outside"), { status: "incomplete" }]),
      })),
    );
    const operation = { kind: "list", scope: ref(11) };
    const result = await f.policy.dispatch(operation);
    expect(result).toMatchObject({
      ok: true,
      value: { entries: [{ id: 13 }] },
    });
    if (result.ok)
      expect((result.value as { entries: unknown[] }).entries).toHaveLength(1);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    f.collection.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        ...page([file, { ...file, path: "/different" }]),
      })),
    );
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    f.collection.mockImplementation((request) =>
      Promise.resolve().then(() => ({
        ...request,
        status: "complete",
        entries: [],
      })),
    );
    expect(await f.policy.dispatch(operation)).toEqual(denied);
  });
  it("BR-044 previous collection page object cannot supply a new invocation", async () => {
    const f = await fixture();
    const prior = { kind: "list", scope: ref(11), ...page([file]) };
    f.collection.mockResolvedValue(prior);
    expect(await f.policy.dispatch({ kind: "list", scope: ref(11) })).toEqual(
      denied,
    );
  });
  it("BR-045 batch failure is all-or-nothing; independent same-parent files pass", async () => {
    const other = node(14, "/r/a/other", "file", [root, a]);
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [
      root,
      a,
      b,
      file,
      other,
    ]);
    const replace = (id: number) => ({
      kind: "replace",
      target: ref(id),
      destination: ref(11),
      name: id === 14 ? "other" : "report",
    });
    expect(
      await f.policy.dispatch({
        kind: "batch",
        operations: [replace(13), replace(99)],
      }),
    ).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
    expect(
      await f.policy.dispatch({
        kind: "batch",
        operations: [replace(13), replace(14)],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await f.policy.dispatch({
        kind: "batch",
        operations: [replace(13), replace(13)],
      }),
    ).toEqual(denied);
  });
  it.each([false, true])(
    "BR-045 reported interacting batch bypass denied in both orders reversed=%s",
    async (reverse) => {
      const f = await fixture({
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_DENY: "/r/c/a/**",
      });
      const operations = [
        { kind: "move", target: ref(11), destination: ref(12) },
        { kind: "rename", target: ref(12), name: "c" },
      ];
      expect(
        await f.policy.dispatch({
          kind: "batch",
          // eslint-disable-next-line sonarjs/no-misleading-array-reverse -- F-011: in-place reordering of a local array is intended
          operations: reverse ? operations.reverse() : operations,
        }),
      ).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("BR-045 batch size 256 allowed, 257 refused before evidence", async () => {
    const nodes = Array.from({ length: 256 }, (_, i) =>
      node(100 + i, `/r/f${i}`, "file", [root]),
    );
    const f = await fixture({}, [root, ...nodes]);
    const operations = nodes.map((item) => read(item.id));
    expect((await f.policy.dispatch({ kind: "batch", operations })).ok).toBe(
      true,
    );
    f.inspect.mockClear();
    expect(
      await f.policy.dispatch({
        kind: "batch",
        operations: [...operations, read(999)],
      }),
    ).toEqual(denied);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it("BR-046 no raw thrown data/accessors or paths cross refusal boundary", async () => {
    const f = await fixture();
    const stringify = vi.fn(() => {
      throw new Error("MUST_NOT_STRINGIFY");
    });
    f.inspect.mockRejectedValue({
      secret: "SYNTHETIC_CREDENTIAL",
      path: "/private",
      toString: stringify,
    });
    expect(await f.policy.dispatch(read())).toEqual(denied);
    expect(await f.policy.check(read())).toEqual({
      allowed: false,
      code: "EVIDENCE_UNAVAILABLE",
    });
    f.inspect.mockResolvedValue(
      Object.defineProperty({}, "status", {
        get: () => {
          throw new Error("SYNTHETIC");
        },
      }),
    );
    expect(await f.policy.dispatch(read())).toEqual(denied);
    expect(stringify).not.toHaveBeenCalled();
  });
});

// F-017 AC-07: BR-039 v2 derives the restore destination from the evidence.
describe("BR-039 v2 derived restore destination", () => {
  const old = node(13, "/r/a/report", "file", [root, a], "original-trash", 13);
  const restore = { kind: "restore", target: ref(13) };
  it("BR-039 v2 a valid restore is authorized with the former parent as destination", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [root, a, old]);
    expect(await f.policy.dispatch(restore)).toMatchObject({ ok: true });
    expect(f.execute).toHaveBeenCalledWith(restore);
    expect(f.inspect).toHaveBeenCalledWith(ref(11), "live");
    expect(f.inspect).toHaveBeenCalledWith(ref(13), "original-trash");
  });
  it("BR-039 v2 an outside-source restore whose former parent is outside every root is denied", async () => {
    const outside = node(50, "/out", "dir");
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [
      root,
      outside,
      node(51, "/out/x", "file", [outside], "original-trash", 51),
    ]);
    expect(
      await f.policy.dispatch({ kind: "restore", target: ref(51) }),
    ).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    ["a file former parent", { ...a, type: "file" }],
    ["another ID", { ...a, id: 99 }],
    ["another path", { ...a, name: "a2", path: "/r/a2" }],
  ])(
    "BR-039 v2 a live destination read with %s is denied",
    async (_label, live) => {
      const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [root, old]);
      f.items.set("live:7:11", structuredClone(live) as never);
      expect(await f.policy.dispatch(restore)).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["destination", { ...restore, destination: ref(12) }],
    ["name", { ...restore, name: "back" }],
  ])(
    "BR-039 v2 a restore operation carrying %s is INVALID_OPERATION",
    async (_label, operation) => {
      const f = await fixture({ KDRIVE_MCP_MODE: "write" }, [root, a, b, old]);
      expect(await f.policy.check(operation)).toEqual({
        allowed: false,
        code: "INVALID_OPERATION",
      });
      expect(await f.policy.dispatch(operation)).toEqual(denied);
      expect(f.inspect).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("BR-039 v2 a directory restore with denies needs the unavailable trashed-tree enumeration", async () => {
    const folder = node(
      20,
      "/r/a/folder",
      "dir",
      [root, a],
      "original-trash",
      20,
    );
    const operation = { kind: "restore", target: ref(20) };
    const denying = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: "/never" },
      [root, a, folder],
    );
    denying.children.mockImplementation(() =>
      Promise.resolve({ status: "unavailable" }),
    );
    expect(await denying.policy.dispatch(operation)).toEqual(denied);
    expect(denying.execute).not.toHaveBeenCalled();
    const open = await fixture({ KDRIVE_MCP_MODE: "write" }, [root, a, folder]);
    expect(await open.policy.dispatch(operation)).toMatchObject({ ok: true });
    expect(open.children).not.toHaveBeenCalled();
  });
  it("BR-039 v2 a root-sentinel former parent restores into root 1", async () => {
    const driveRoot = node(1, "/", "dir");
    const top = node(40, "/top", "file", [driveRoot], "original-trash", 40);
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_ROOTS: "7:1" },
      [driveRoot, top],
    );
    expect(
      await f.policy.dispatch({ kind: "restore", target: ref(40) }),
    ).toMatchObject({ ok: true });
    expect(f.inspect).toHaveBeenCalledWith(ref(1), "live");
  });
});

// F-017 AC-06: BR-278 protects every configured root pair.
describe("BR-278 configured roots are never trashed, renamed or moved", () => {
  it.each([
    { kind: "trash", target: ref(10) },
    { kind: "rename", target: ref(10), name: "x" },
    { kind: "move", target: ref(10), destination: ref(12) },
  ])("BR-278 $kind of a configured root is denied", async (operation) => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" });
    expect(await f.policy.dispatch(operation)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("BR-278 a non-root child of a configured root can be renamed", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" });
    expect(
      await f.policy.dispatch({ kind: "rename", target: ref(11), name: "x" }),
    ).toMatchObject({ ok: true });
  });
});

describe("F-018 BR-035 v2 replace bindings", () => {
  const outside = node(30, "/x", "dir");
  const outsideFile = node(31, "/x/f", "file", [outside]);
  const deniedDir = node(15, "/r/f-deny", "dir", [root]);
  const deniedFile = node(16, "/r/a/y-deny", "file", [root, a]);
  const nodes = [root, a, b, file, outside, outsideFile, deniedDir, deniedFile];
  const replace = (
    target: number,
    destination: number,
    name: string,
    driveId = 7,
  ) => ({
    kind: "replace",
    target: ref(target, driveId),
    destination: ref(destination),
    name,
  });
  it("BR-035 v2 a permitted replace and upload-new execute once", async () => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, nodes);
    expect(await f.policy.dispatch(replace(13, 11, "report"))).toMatchObject({
      ok: true,
    });
    expect(
      await f.policy.dispatch({
        kind: "upload-new",
        destination: ref(11),
        name: "new",
      }),
    ).toMatchObject({ ok: true });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["no destination", { kind: "replace", target: ref(13), name: "report" }],
    ["no name", { kind: "replace", target: ref(13), destination: ref(11) }],
    ["target only", { kind: "replace", target: ref(13) }],
    ["target is a folder", replace(11, 10, "a")],
    ["target in another folder", replace(13, 12, "report")],
    ["another name", replace(13, 11, "other")],
    ["case-only name difference", replace(13, 11, "Report")],
    ["target in another drive", replace(13, 11, "report", 8)],
    ["destination is a file", replace(13, 13, "report")],
    ["destination outside every root", replace(31, 30, "f")],
    ["target missing (404)", replace(99, 11, "report")],
    ["destination missing (404)", replace(13, 99, "report")],
    [
      "upload-new outside every root",
      { kind: "upload-new", destination: ref(30), name: "n" },
    ],
    [
      "upload-new into a missing folder",
      { kind: "upload-new", destination: ref(99), name: "n" },
    ],
  ])("BR-035 v2 denies a replace or upload with %s", async (_label, op) => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, nodes);
    expect(await f.policy.dispatch(op)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    ["trashed target", replace(13, 11, "report")],
    ["trashed destination", replace(13, 11, "report")],
  ])("BR-035 v2 denies a %s", async (label, op) => {
    const f = await fixture({ KDRIVE_MCP_MODE: "write" }, nodes);
    const id = label === "trashed target" ? 13 : 11;
    f.items.delete(`live:7:${String(id)}`);
    f.items.set(`original-trash:7:${String(id)}`, {
      ...(id === 13 ? file : a),
      location: "original-trash",
      lifecycle: "trashed",
    });
    expect(await f.policy.dispatch(op)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    [
      "x-deny into a permitted folder",
      { kind: "upload-new", destination: ref(11), name: "x-deny" },
    ],
    [
      "into a denied folder",
      { kind: "upload-new", destination: ref(15), name: "ok" },
    ],
    ["replace at a denied path", replace(16, 11, "y-deny")],
  ])("BR-035 v2 BR-034 deny list refuses upload %s", async (_label, op) => {
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_DENY: "**/*-deny*" },
      nodes,
    );
    expect(await f.policy.dispatch(op)).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
});

describe("F-018 BR-035 v2 replace in the drive root", () => {
  const driveRoot = node(1, "/", "dir");
  it.each([
    ["root omitted from parents", node(17, "/top", "file", [])],
    ["root listed in parents", node(17, "/top", "file", [driveRoot])],
  ])("BR-035 v2 permits a replace with %s", async (_label, top) => {
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_ROOTS: "7:1" },
      [driveRoot, top],
    );
    expect(
      await f.policy.dispatch({
        kind: "replace",
        target: ref(17),
        destination: ref(1),
        name: "top",
      }),
    ).toMatchObject({ ok: true });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("BR-035 v2 denies a root file with empty parents under a non-root destination", async () => {
    const dirX = node(19, "/x", "dir", [driveRoot]);
    const top = node(18, "/z", "file", []);
    const f = await fixture(
      { KDRIVE_MCP_MODE: "write", KDRIVE_MCP_ROOTS: "7:1" },
      [driveRoot, dirX, top],
    );
    expect(
      await f.policy.dispatch({
        kind: "replace",
        target: ref(18),
        destination: ref(19),
        name: "z",
      }),
    ).toEqual(denied);
    expect(f.execute).not.toHaveBeenCalled();
  });
});

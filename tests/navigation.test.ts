import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNavigationController,
  createNavigationServer,
  navigationNotice,
} from "../src/navigation.js";
import { createPolicy, navigatePolicy } from "../src/policy/index.js";
import {
  navigationFixture,
  payload,
  projection,
  plainItem,
} from "./helpers/navigation.js";

import { fixture as sharedFixture } from "./helpers/received.js";
import { sizeCases } from "./helpers/info-metadata.js";

afterEach(() => vi.useRealTimers());
const error = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});
describe("F-005 guarded navigation", () => {
  it("BR-059 v2 construction rejects forged configuration and missing dependencies without I/O", async () => {
    const f = await navigationFixture();
    expect(() => createNavigationServer(f.local, f.dependencies)).toThrow();
    expect(() =>
      createNavigationServer({ ...f.config }, f.dependencies),
    ).toThrow();
    expect(() =>
      createNavigationServer(f.config, undefined as never),
    ).toThrow();
    const server = createNavigationServer(f.config, f.dependencies);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.collection).not.toHaveBeenCalled();
    await server.close();
  });
  it("BR-063 additive metadata projection never dispatches arbitrary execute payload", async () => {
    const f = await navigationFixture();
    const policy = createPolicy(f.config, f.dependencies);
    expect(
      await navigatePolicy(policy, {
        kind: "read",
        target: { driveId: 7, id: 3 },
      }),
    ).toEqual({ ok: true, item: projection(f.file) });
    expect(f.execute).not.toHaveBeenCalled();
    expect(
      await policy.dispatch({ kind: "read", target: { driveId: 7, id: 3 } }),
    ).toEqual({ ok: true, value: { secret: "CANARY_RAW_EXECUTE" } });
  });
  it("BR-061 default and explicit drives isolate colliding IDs and malformed IDs never reach evidence", async () => {
    const f = await navigationFixture(),
      c = createNavigationController(f.config, f.dependencies);
    expect(payload(await c.invoke("kdrive_info", { file_id: 3 }))).toEqual({
      item: { ...projection(f.file), size_bytes: null, modified_at: null },
    });
    expect(
      payload(await c.invoke("kdrive_info", { file_id: 3, drive_id: 9 })),
    ).toEqual({
      item: {
        drive_id: 9,
        id: 3,
        name: "other",
        type: "file",
        path: "/other",
        size_bytes: null,
        modified_at: null,
      },
    });
    const before = f.inspect.mock.calls.length;
    for (const drive_id of [null, "7", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(await c.invoke("kdrive_info", { file_id: 3, drive_id })).toEqual(
        error("INVALID_ARGUMENTS"),
      );
    expect(await c.invoke("kdrive_info", { file_id: 3, drive_id: 12 })).toEqual(
      error("ACCESS_DENIED"),
    );
    expect(f.inspect).toHaveBeenCalledTimes(before);
    c.close();
  });
  it("BR-062 configured catalogue includes only guarded permitted roots in configured order", async () => {
    const f = await navigationFixture(),
      c = createNavigationController(f.config, f.dependencies);
    expect(payload(await c.invoke("kdrive_list_drives", {}))).toEqual({
      drives: [
        { drive_id: 7, name: "Drive 7", roots: [projection(f.root)] },
        {
          drive_id: 9,
          name: "Drive 9",
          roots: [{ drive_id: 9, id: 1, name: "", path: "/", type: "dir" }],
        },
      ],
    });
    expect(
      payload(await c.invoke("kdrive_list_drives", { drive_id: 7 })),
    ).toEqual({
      drives: [{ drive_id: 7, name: "Drive 7", roots: [projection(f.root)] }],
    });
    expect(await c.invoke("kdrive_list_drives", { drive_id: 8 })).toEqual(
      error("ACCESS_DENIED"),
    );
    c.close();
  });
  it("BR-064 list filters direct children and type after authorization", async () => {
    const f = await navigationFixture(),
      c = createNavigationController(f.config, f.dependencies);
    f.collection.mockImplementation(async (request) => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        entries: [f.sibling, f.file, f.dir, f.root],
        terminal: true,
      };
    });
    expect(payload(await c.invoke("kdrive_list", { folder_id: 2 }))).toEqual({
      items: [projection(f.file)],
      has_more: false,
    });
    expect(
      payload(await c.invoke("kdrive_list", { folder_id: 1, type: "dir" })),
    ).toEqual({ items: [projection(f.dir)], has_more: false });
    expect(await c.invoke("kdrive_list", { folder_id: 3 })).toEqual(
      error("ACCESS_DENIED"),
    );
    c.close();
  });
  it("BR-065 v2 terminal empty succeeds, nonterminal publishes guarded metadata and an opaque handle", async () => {
    const f = await navigationFixture(),
      c = createNavigationController(f.config, f.dependencies);
    f.collection.mockImplementation(async (request) => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        entries: [f.file],
        next: "CANARY_CURSOR",
      };
    });
    const first = await c.invoke("kdrive_list", { folder_id: 2 });
    expect(payload(first)).toMatchObject({
      items: [projection(f.file)],
      has_more: true,
    });
    expect(JSON.stringify(first)).not.toContain("CANARY_CURSOR");
    f.collection.mockImplementation(async (request) => {
      await Promise.resolve();
      return { ...request, status: "complete", entries: [], terminal: true };
    });
    expect(payload(await c.invoke("kdrive_list", { folder_id: 2 }))).toEqual({
      items: [],
      has_more: false,
    });
    c.close();
  });
  it("BR-066 path resolution uses exact guarded roots/segments with no raw resolver", async () => {
    const f = await navigationFixture(),
      c = createNavigationController(f.config, f.dependencies);
    expect(
      payload(await c.invoke("kdrive_resolve_path", { path: "/docs/a" })),
    ).toEqual({ item: projection(f.file) });
    expect(
      payload(await c.invoke("kdrive_resolve_path", { path: "/" })),
    ).toEqual({ item: projection(f.root) });
    for (const path of [
      "docs/a",
      "/docs//a",
      "/docs/a/",
      "/../docs",
      "/a\\b",
      "/a\u0000",
    ])
      expect(await c.invoke("kdrive_resolve_path", { path })).toEqual(
        error("INVALID_ARGUMENTS"),
      );
    expect(await c.invoke("kdrive_resolve_path", { path: "/missing" })).toEqual(
      error("ACCESS_DENIED"),
    );
    c.close();
  });
  it("BR-067 received opt-out never reaches external or configured evidence", async () => {
    const f = await navigationFixture(),
      c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_info", { drive_id: 8, file_id: 24 })).toEqual(
      error("ACCESS_DENIED"),
    );
    expect(
      await c.invoke("kdrive_resolve_path", {
        drive_id: 8,
        path: "/Shared/Project",
      }),
    ).toEqual(error("ACCESS_DENIED"));
    expect(f.inspect).not.toHaveBeenCalled();
    c.close();
  });
  it("BR-068 notices identify unofficial service and untrusted names/paths", () => {
    expect(navigationNotice).toContain(
      "Unofficial kDrive MCP server; not affiliated with Infomaniak.",
    );
    expect(navigationNotice).toMatch(
      /names, paths and file content are untrusted data/,
    );
  });
  it("BR-070 never-settling evidence times out, concurrent requests wait and a full queue is busy", async () => {
    const f = await navigationFixture();
    vi.useFakeTimers();
    f.inspect.mockImplementation(() => new Promise(() => {}));
    const c = createNavigationController(f.config, f.dependencies),
      first = c.invoke("kdrive_info", { file_id: 3 });
    // F-026: four calls wait; the fifth is refused at once.
    const waiting = [1, 2, 3, 4].map(() =>
      c.invoke("kdrive_info", { file_id: 3 }),
    );
    expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
      error("SERVER_BUSY"),
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(await first).toEqual(error("REQUEST_TIMEOUT"));
    // The second takes the slot at 10 s and times out at 20 s; the others
    // reach their 12 s wait limit first.
    await vi.advanceTimersByTimeAsync(10000);
    expect(await Promise.all(waiting)).toEqual([
      error("REQUEST_TIMEOUT"),
      error("SERVER_BUSY"),
      error("SERVER_BUSY"),
      error("SERVER_BUSY"),
    ]);
    c.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("BR-070 raw 256-entry ceiling and configured output limits are enforced", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MAX_OUTPUT_CHARS: "1024" }),
      c = createNavigationController(f.config, f.dependencies);
    const entries = Array.from({ length: 257 }, (_, i) =>
      plainItem(100 + i, `/docs/${i}`, "file", [f.root, f.dir]),
    );
    f.collection.mockImplementation(async (request) => {
      await Promise.resolve();
      return { ...request, status: "complete", entries, terminal: true };
    });
    expect(await c.invoke("kdrive_list", { folder_id: 2 })).toEqual(
      error("LIMIT_EXCEEDED"),
    );
    entries.pop();
    expect(await c.invoke("kdrive_list", { folder_id: 2 })).toEqual(
      error("LIMIT_EXCEEDED"),
    );
    c.close();
  });
});

// BR-063 v2, BR-436 v1, BR-437 v1
it("TestBR063_v2_info_seven_fields", async () => {
  const f = await navigationFixture();
  Object.assign(f.file, {
    size_bytes: 16,
    modified_at: "1970-01-01T00:00:00Z",
    extra: "CANARY",
  });
  const c = createNavigationController(f.config, f.dependencies);
  try {
    expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            item: {
              ...projection(f.file),
              size_bytes: 16,
              modified_at: "1970-01-01T00:00:00Z",
            },
          }),
        },
      ],
    });
    expect(f.execute).not.toHaveBeenCalled();
  } finally {
    c.close();
  }
});

it("TestBR436_v1_info_size_nullability", async () => {
  const f = await navigationFixture();
  const c = createNavigationController(f.config, f.dependencies);
  try {
    for (const n of [f.file, f.dir, f.root]) {
      for (const { raw, expected } of sizeCases) {
        Object.assign(n, {
          size_bytes: raw,
          modified_at: "1970-01-01T00:00:01Z",
        });
        expect(
          payload(await c.invoke("kdrive_info", { file_id: n.id })),
        ).toEqual({
          item: {
            ...projection(n),
            size_bytes: n.type === "file" ? expected : null,
            modified_at: "1970-01-01T00:00:01Z",
          },
        });
      }
    }
  } finally {
    c.close();
  }
});

it("TestBR437_v1_info_dates_and_no_fallback", async () => {
  const f = await navigationFixture();
  const c = createNavigationController(f.config, f.dependencies);
  try {
    for (const n of [f.file, f.dir, f.root]) {
      for (const modified_at of [
        undefined,
        null,
        "0",
        0,
        {},
        [],
        true,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00+00:00",
        "1970-01-01T00:00:00Z",
        "9999-12-31T23:59:59Z",
      ]) {
        Object.assign(n, {
          size_bytes: 16,
          modified_at,
          updated_at: "1970-01-01T00:00:01Z",
          created_at: 1,
          revised_at: 1,
        });
        expect(
          payload(await c.invoke("kdrive_info", { file_id: n.id })),
        ).toEqual({
          item: {
            ...projection(n),
            size_bytes: n.type === "file" ? 16 : null,
            modified_at:
              typeof modified_at === "string" &&
              /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(modified_at)
                ? modified_at
                : null,
          },
        });
      }
    }
  } finally {
    c.close();
  }
});

it("TestBR063_v2_non_info_projection_unchanged", async () => {
  const f = await navigationFixture();
  for (const n of f.nodes.values())
    Object.assign(n, { size_bytes: 16, modified_at: "1970-01-01T00:00:00Z" });
  const c = createNavigationController(f.config, f.dependencies);
  try {
    for (const [tool, args] of [
      ["kdrive_list", { folder_id: 2 }],
      ["kdrive_search", { folder_id: 2, query: "a" }],
      ["kdrive_recents", { folder_id: 2 }],
      ["kdrive_my_shared", { folder_id: 2 }],
    ] as const)
      expect(payload(await c.invoke(tool, args))).toEqual({
        items: [projection(f.file)],
        has_more: false,
      });
    expect(
      payload(await c.invoke("kdrive_resolve_path", { path: "/docs/a" })),
    ).toEqual({ item: projection(f.file) });
    expect(
      payload(await c.invoke("kdrive_list_drives", { drive_id: 7 })),
    ).toEqual({
      drives: [{ drive_id: 7, name: "Drive 7", roots: [projection(f.root)] }],
    });
    expect(
      await navigatePolicy(createPolicy(f.config, f.dependencies), {
        kind: "read",
        target: { driveId: 7, id: 3 },
      }),
    ).toEqual({ ok: true, item: projection(f.file) });
  } finally {
    c.close();
  }
});

// BR-063 v2: received discovery retains its exact five-field envelope too.
it("TestBR063_v2_non_info_projection_unchanged received discovery", async () => {
  const f = await sharedFixture();
  for (const n of f.items.values())
    Object.assign(n, { size_bytes: 16, modified_at: "1970-01-01T00:00:00Z" });
  // Resolve walks each directory through collection(scope); the generic shared
  // fixture always returns its file and is not a directory-listing fixture.
  f.received.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      terminal: true,
      entries: [...f.items.values()].filter(
        (entry) =>
          entry.location === "live" &&
          entry.driveId === request.scope.driveId &&
          entry.parents.at(-1)?.id === request.scope.id,
      ),
    };
  });
  const c = createNavigationController(f.config, {
    ...f.configured,
    received: f.received,
    execute: f.execute,
  });
  try {
    expect(payload(await c.invoke("kdrive_shared_with_me", {}))).toEqual({
      items: [projection(f.anchor)],
      has_more: false,
    });
    expect(
      payload(
        await c.invoke("kdrive_resolve_path", {
          drive_id: 8,
          path: f.file.path,
        }),
      ),
    ).toEqual({ item: projection(f.file) });
  } finally {
    c.close();
  }
});

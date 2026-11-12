import { afterEach, expect, it, vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../src/config.js";
import {
  createNavigationController,
  createNavigationServer,
} from "../src/navigation.js";
import {
  navigationFixture,
  payload,
  plainItem,
  projection,
} from "./helpers/navigation.js";
import { fixture as receivedFixture, node } from "./helpers/received.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";
import { runDiagnostic } from "./helpers/diagnostic.js";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { startStdioNavigation } from "../src/stdio.js";
afterEach(() => vi.useRealTimers());
const error = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});
async function httpPreflight() {
  const local = await loadConfiguration({
    argv: ["--http", "--insecure-no-auth"],
    env: { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC" },
  });
  return await preflightConfiguration(local, {
    inspectDrive: async (id) => {
      await Promise.resolve();
      return { id, role: "admin" };
    },
    resolveDirectory: async (driveId) => {
      await Promise.resolve();
      return { driveId, id: 1, type: "dir" };
    },
  });
}
it("BR-059 v2 HTTP preflight config is refused by the stdio runner", async () => {
  const config = await httpPreflight();
  const f = await navigationFixture();
  const input = new PassThrough(),
    output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });
  expect(() =>
    startStdioNavigation(config, f.dependencies, {
      input,
      output,
      signals: false,
      diagnostic: () => undefined,
    }),
  ).toThrow(
    new TypeError(
      "Resolved stdio configuration and explicit policy dependencies required.",
    ),
  );
  expect(f.inspect).not.toHaveBeenCalled();
  expect(f.collection).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.children).not.toHaveBeenCalled();
  expect(written).toBe("");
  expect(input.listenerCount("data")).toBe(0);
});
it("BR-059 v2 HTTP preflight config constructs a navigation server without I/O", async () => {
  const config = await httpPreflight();
  const f = await navigationFixture();
  const server = createNavigationServer(config, f.dependencies);
  expect(server).toBeDefined();
  expect(f.inspect).not.toHaveBeenCalled();
  expect(f.collection).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.children).not.toHaveBeenCalled();
  await server.close();
});
it("BR-059 v2 forged, copied and dependency-less construction is still refused", async () => {
  const config = await httpPreflight();
  const f = await navigationFixture();
  expect(() => createNavigationServer({ ...config }, f.dependencies)).toThrow();
  expect(() => createNavigationServer(f.local, f.dependencies)).toThrow();
  expect(() => createNavigationServer(config, undefined as never)).toThrow();
});
it("BR-062 denied roots/drives are omitted without exposing their IDs or paths", async () => {
  const f = await navigationFixture({
    KDRIVE_MCP_ROOTS: "7:2,9:1",
    KDRIVE_MCP_DENY: "/docs",
  });
  const c = createNavigationController(f.config, f.dependencies);
  const result = payload(await c.invoke("kdrive_list_drives", {}));
  expect(result).toEqual({
    drives: [
      {
        drive_id: 9,
        name: "Drive 9",
        roots: [{ drive_id: 9, id: 1, type: "dir", name: "", path: "/" }],
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("docs");
  c.close();
});
it("BR-063 getters and toJSON are never executed and raw provider errors never escape", async () => {
  const f = await navigationFixture(),
    c = createNavigationController(f.config, f.dependencies);
  let calls = 0;
  const hostile = {
    ...f.file,
    toJSON: () => {
      calls++;
      return { CANARY: "RAW" };
    },
  };
  f.inspect.mockResolvedValue(hostile);
  expect(payload(await c.invoke("kdrive_info", { file_id: 3 }))).toEqual({
    item: projection(f.file),
  });
  expect(calls).toBe(0);
  Object.defineProperty(hostile, "extra", {
    enumerable: true,
    get() {
      calls++;
      throw Error("CANARY");
    },
  });
  expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
    error("ACCESS_DENIED"),
  );
  expect(calls).toBe(0);
  f.inspect.mockRejectedValue({
    get message() {
      calls++;
      throw Error("CANARY");
    },
  });
  expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
    error("ACCESS_DENIED"),
  );
  expect(calls).toBe(0);
  c.close();
});
it("BR-064 duplicate identities deduplicate; contradictory identities and out-of-scope entries refuse or omit", async () => {
  const f = await navigationFixture({ KDRIVE_MCP_ROOTS: "7:2,9:1" }),
    c = createNavigationController(f.config, f.dependencies);
  f.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [f.file, f.file, f.sibling],
      terminal: true,
    };
  });
  expect(payload(await c.invoke("kdrive_list", { folder_id: 2 }))).toEqual({
    items: [projection(f.file)],
    has_more: false,
  });
  f.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [
        f.file,
        { ...f.file, name: "different", path: "/docs/different" },
      ],
      terminal: true,
    };
  });
  expect(await c.invoke("kdrive_list", { folder_id: 2 })).toEqual(
    error("ACCESS_DENIED"),
  );
  c.close();
});
it("BR-065 v2 raw 256 entries succeed, 257 refuse before filtering; repeated upstream cursors refuse", async () => {
  const f = await navigationFixture(),
    c = createNavigationController(f.config, f.dependencies);
  const entries = Array.from({ length: 256 }, (_, i) =>
    plainItem(100 + i, `/docs/${i}`, "file", [f.root, f.dir]),
  );
  f.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return { ...request, status: "complete", entries, terminal: true };
  });
  expect(
    (
      payload(await c.invoke("kdrive_list", { folder_id: 2 })) as {
        items: unknown[];
      }
    ).items,
  ).toHaveLength(256);
  entries.push(plainItem(400, "/docs/extra", "file", [f.root, f.dir]));
  expect(await c.invoke("kdrive_list", { folder_id: 2, type: "dir" })).toEqual(
    error("LIMIT_EXCEEDED"),
  );
  f.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [f.file],
      next: "CANARY",
    };
  });
  expect(await c.invoke("kdrive_list", { folder_id: 2, type: "dir" })).toEqual(
    error("ACCESS_DENIED"),
  );
  c.close();
});
it("BR-066 overlapping configured roots choose a guarded anchor; duplicate names and incomplete traversal refuse", async () => {
  const f = await navigationFixture({ KDRIVE_MCP_ROOTS: "7:1,7:2,9:1" }),
    c = createNavigationController(f.config, f.dependencies);
  expect(
    payload(await c.invoke("kdrive_resolve_path", { path: "/docs/a" })),
  ).toEqual({ item: projection(f.file) });
  expect(
    f.collection.mock.calls.every(([request]) => request.scope.id === 2),
  ).toBe(true);
  f.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [f.file, { ...f.file, id: 99 }],
      terminal: true,
    };
  });
  expect(await c.invoke("kdrive_resolve_path", { path: "/docs/a" })).toEqual(
    error("ACCESS_DENIED"),
  );
  f.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [f.file],
      next: "opaque",
    };
  });
  expect(await c.invoke("kdrive_resolve_path", { path: "/docs/a" })).toEqual(
    error("PAGINATION_UNAVAILABLE"),
  );
  c.close();
});
it("BR-066 canonical 4096-byte/64-component boundaries accept and over-bound paths refuse before evidence", async () => {
  const f = await navigationFixture(),
    c = createNavigationController(f.config, f.dependencies);
  const name = "a".repeat(4095),
    long = plainItem(50, "/" + name, "file", [f.root]);
  f.nodes.set("7:50", long);
  expect(
    payload(await c.invoke("kdrive_resolve_path", { path: long.path })),
  ).toEqual({ item: projection(long) });
  const chain = [f.root];
  for (let i = 1; i <= 64; i++) {
    const parent = chain.at(-1)!;
    const n = plainItem(
      100 + i,
      (parent.path === "/" ? "" : parent.path) + "/a",
      "dir",
      [...chain],
    );
    chain.push(n);
    f.nodes.set(`7:${n.id}`, n);
  }
  expect(
    payload(
      await c.invoke("kdrive_resolve_path", { path: chain.at(-1)!.path }),
    ),
  ).toEqual({ item: projection(chain.at(-1)!) });
  const before = f.inspect.mock.calls.length;
  expect(
    await c.invoke("kdrive_resolve_path", { path: long.path + "a" }),
  ).toEqual(error("INVALID_ARGUMENTS"));
  expect(
    await c.invoke("kdrive_resolve_path", { path: chain.at(-1)!.path + "/a" }),
  ).toEqual(error("INVALID_ARGUMENTS"));
  expect(f.inspect).toHaveBeenCalledTimes(before);
  c.close();
});
it("BR-067 actual tools read/list/resolve proved external root and child and refuse unrelated/denied/expired evidence", async () => {
  const f = await receivedFixture();
  f.received.collection.mockImplementation(async (request) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      terminal: true,
      entries: [...f.items.values()].filter(
        (i) =>
          i.location === "live" && i.parents.at(-1)?.id === request.scope.id,
      ),
    };
  });
  const dependencies = {
    ...f.configured,
    execute: f.execute,
    received: f.received,
  };
  const w = await createWire(f.config, dependencies);
  try {
    w.send(initialize);
    await w.read(1);
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    let id = 2;
    for (const [name, args] of [
      ["kdrive_info", { file_id: 20 }],
      ["kdrive_info", { file_id: 24 }],
      ["kdrive_list", { folder_id: 22 }],
      ["kdrive_resolve_path", { path: "/Shared/Project/a/report" }],
    ] as const) {
      w.send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: { ...args, drive_id: 8 } },
      });
      const response = await w.read(id++);
      expect(response.result).not.toHaveProperty("isError", true);
    }
    w.send({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "kdrive_info", arguments: { drive_id: 8, file_id: 999 } },
    });
    expect((await w.read(20)).result).toMatchObject(error("ACCESS_DENIED"));
    w.send({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "kdrive_list", arguments: { drive_id: 8, folder_id: 1 } },
    });
    expect((await w.read(21)).result).toMatchObject(error("ACCESS_DENIED"));
    f.clock.value = 60000;
    f.received.list.mockImplementation(async (request) => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        entries: [],
        terminal: true,
        discover: true,
      };
    });
    w.send({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { name: "kdrive_info", arguments: { drive_id: 8, file_id: 24 } },
    });
    expect((await w.read(22)).result).toMatchObject(error("ACCESS_DENIED"));
  } finally {
    await w.session.close();
  }
});
it("BR-067 denied recipient paths and missing capability do not disclose shared metadata", async () => {
  const f = await receivedFixture({ KDRIVE_MCP_DENY: "/Shared/Project/a/**" });
  const c = createNavigationController(f.config, {
    ...f.configured,
    execute: f.execute,
    received: f.received,
  });
  expect(await c.invoke("kdrive_info", { drive_id: 8, file_id: 24 })).toEqual(
    error("ACCESS_DENIED"),
  );
  f.anchor.capabilities.read = false;
  f.items.set("live:8:20", f.anchor);
  expect(await c.invoke("kdrive_info", { drive_id: 8, file_id: 20 })).toEqual(
    error("ACCESS_DENIED"),
  );
  c.close();
});
it("BR-070 cancellation/close settle pending evidence, release timers and cannot publish a late success", async () => {
  const f = await navigationFixture();
  vi.useFakeTimers();
  let resolveEvidence!: (value: unknown) => void;
  f.inspect.mockImplementation(
    () =>
      new Promise((r) => {
        resolveEvidence = r;
      }),
  );
  const c = createNavigationController(f.config, f.dependencies),
    abort = new AbortController();
  const result = c.invoke("kdrive_info", { file_id: 3 }, abort.signal);
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  expect(await result).toEqual(error("ACCESS_DENIED"));
  resolveEvidence(f.file);
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  const second = c.invoke("kdrive_info", { file_id: 3 });
  await vi.advanceTimersByTimeAsync(0);
  c.close();
  c.close();
  expect(await second).toEqual(error("ACCESS_DENIED"));
  expect(vi.getTimerCount()).toBe(0);
});
it("BR-070 dependency call 512 succeeds and 513 refuses without invoking the port", async () => {
  for (const pageCount of [2, 3]) {
    const f = await receivedFixture();
    const roots = Array.from({ length: 255 }, (_, i) => ({
      ...node(100 + i, `root${i}`, "dir"),
      anchorId: 100 + i,
    }));
    let pages = 0;
    const chunks =
      pageCount === 2
        ? [[roots[0]!], roots.slice(1)]
        : [[roots[0]!], [roots[1]!], roots.slice(2)];
    f.received.list.mockImplementation(async (request) => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        entries: chunks[pages++]!,
        ...(pages < pageCount ? { next: `page${pages}` } : { terminal: true }),
        discover: true,
      };
    });
    // Two valid nonempty pages +255 discovery inspections +255 fresh anchor reads =512.
    f.received.inspect.mockImplementation(async (target) => {
      await Promise.resolve();
      return structuredClone(
        roots.find((r) => r.id === target.id) ?? { status: "missing" },
      );
    });
    const c = createNavigationController(f.config, {
      ...f.configured,
      execute: f.execute,
      received: f.received,
    });
    const result = await c.invoke("kdrive_resolve_path", {
      drive_id: 8,
      path: "/Shared/root0",
    });
    if (pageCount === 2)
      expect(payload(result)).toEqual({ item: projection(roots[0]!) });
    else expect(result).toEqual(error("LIMIT_EXCEEDED"));
    expect(
      f.received.list.mock.calls.length + f.received.inspect.mock.calls.length,
    ).toBe(512);
    c.close();
  }
});
it("BR-070 serialized payload character ceiling allows equality and refuses one character below", async () => {
  const initial = await navigationFixture(),
    text = JSON.stringify({ item: projection(initial.file) });
  for (const delta of [0, -1]) {
    const f = await navigationFixture({
        KDRIVE_MCP_MAX_OUTPUT_CHARS: String(text.length + delta),
      }),
      c = createNavigationController(f.config, f.dependencies);
    const result = await c.invoke("kdrive_info", { file_id: 3 });
    if (delta === 0)
      expect(payload(result)).toEqual({ item: projection(f.file) });
    else expect(result).toEqual(error("LIMIT_EXCEEDED"));
    c.close();
  }
});
it("BR-071 v2 packed production bin keeps request-free diagnostics; help names the production runtime", () => {
  const cli = resolve("dist/cli.js");
  for (const transport of ["stdio", "http"]) {
    const result = runDiagnostic(
      cli,
      transport === "http" ? ["--http", "--insecure-no-auth"] : [],
      { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: "/nonexistent/SYNTHETIC" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Configuration error [CREDENTIAL_READ_FAILED] (tokenFile).\n",
    );
  }
  expect(runDiagnostic(cli, ["--help"]).stdout).toContain(
    "Serve kDrive over stdio or HTTP after production preflight.",
  );
});

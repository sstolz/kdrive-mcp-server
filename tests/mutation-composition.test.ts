// F-016 composition tests: AC-04, AC-05, AC-21 (compositions), AC-23–AC-26.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { createStderrSink, type AuditSink } from "../src/audit/sink.js";
import {
  createMutationGate,
  gatedDependencies,
  type Mutator,
} from "../src/mutation-gate.js";
import {
  createNavigationController,
  navigationBinding,
} from "../src/navigation.js";
import { startStdioNavigation } from "../src/stdio.js";
import type { PolicyDependencies } from "../src/policy/index.js";
import { navigationFixture } from "./helpers/navigation.js";
import { httpFixture } from "./helpers/http.js";
import { UPSTREAM } from "./helpers/proxy.js";
import {
  DRIVE,
  adapterFor,
  configuration,
  kdriveFixture,
  success,
  type Node,
} from "./helpers/kdrive.js";
import { runMain, stdioClient, textOf, tokenFile } from "./helpers/main.js";

const hooks = vi.hoisted(() => {
  const state: { servers: unknown[]; tool: string; operation: unknown } = {
    servers: [],
    tool: "kdrive_rename",
    operation: undefined,
  };
  return state;
});
vi.mock("../src/navigation.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/navigation.js")>();
  return {
    ...original,
    createNavigationServer: (
      ...args: Parameters<typeof original.createNavigationServer>
    ) => {
      const server = original.createNavigationServer(...args);
      hooks.servers.push(server);
      // Test-only tool: the first write tools arrive with #18.
      server.registerTool(
        "test_mutate",
        { inputSchema: z.strictObject({}) },
        async (_args, ctx) => {
          const binding = original.navigationBinding(server);
          const value = await binding?.controller.mutate(
            hooks.tool,
            hooks.operation,
            binding.identity,
            ctx.mcpReq.signal,
          );
          return { content: [{ type: "text", text: JSON.stringify(value) }] };
        },
      );
      return server;
    },
  };
});

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
  hooks.servers = [];
});

const OP = "000102030405060708090a0b0c0d0e0f";
const ok = (status = 200, extra: Record<string, unknown> = {}) => ({
  outcome: "response",
  status,
  accepted: status >= 200 && status < 300,
  ...extra,
});
function memory() {
  const lines: string[] = [];
  let hook: ((index: number, commit: () => void) => void) | undefined;
  const sink = createStderrSink({
    write(chunk, callback) {
      const commit = () => {
        lines.push(chunk);
        callback();
      };
      if (hook) hook(lines.length, commit);
      else commit();
      return true;
    },
  });
  return {
    sink,
    lines,
    records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    onWrite(next: (index: number, commit: () => void) => void) {
      hook = next;
    },
  };
}
function gateFor(
  sink: AuditSink,
  mutators: Record<string, Mutator>,
  mode: "write" | "share" = "write",
) {
  return createMutationGate({
    mode,
    sink,
    mutators,
    random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    clock: () => new Date("2026-11-09T10:00:00.000Z"),
    now: () => performance.now(),
    diagnostic: () => undefined,
  });
}
const lastServer = () => hooks.servers.at(-1) as McpServer;

describe("BR-237 identity plumbing", () => {
  const renameFile = {
    kind: "rename",
    target: { driveId: 7, id: 3 },
    name: "b",
  };
  it("TestBR237_the_stdio_runner_binds_the_stdio_identity", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const m = memory();
    const gate = gateFor(m.sink, { rename: () => Promise.resolve(ok()) });
    const started = startStdioNavigation(
      f.config,
      gatedDependencies(f.dependencies, gate),
      {
        input: new PassThrough(),
        output: new PassThrough(),
        signals: false,
        gate,
      },
    );
    cleanup.push(() => started.close());
    await started.ready;
    const binding = navigationBinding(started.server);
    expect(binding?.identity).toEqual({ kind: "stdio" });
    const result = await binding?.controller.mutate(
      "kdrive_rename",
      renameFile,
      binding.identity,
    );
    expect(result).toMatchObject({ ok: true, value: { result: "succeeded" } });
    expect(m.records().map((r) => r.identity)).toEqual([
      { kind: "stdio" },
      { kind: "stdio" },
    ]);
  });

  it.each([
    ["oauth", false, { kind: "oauth", iss: UPSTREAM, sub: "user-1" }],
    ["insecure", true, { kind: "insecure" }],
  ] as const)(
    "TestBR237_an_HTTP_%s_session_binds_its_identity",
    async (_name, insecure, identity) => {
      const navigation = await navigationFixture();
      const m = memory();
      const gate = gateFor(m.sink, { rename: () => Promise.resolve(ok()) });
      const f = await httpFixture({
        insecure,
        ...(insecure ? { upstream: null } : {}),
        env: { KDRIVE_MCP_MODE: "write" },
        dependencies: gatedDependencies(navigation.dependencies, gate),
        gate,
      });
      cleanup.push(() => f.handler.close());
      const opened = insecure
        ? await f.initialize("", {}, "/")
        : await f.initialize(await f.mint());
      expect(opened.response.status).toBe(200);
      const binding = navigationBinding(lastServer());
      expect(binding?.identity).toEqual(identity);
      const result = await binding?.controller.mutate(
        "kdrive_rename",
        renameFile,
        binding.identity,
      );
      expect(result).toMatchObject({
        ok: true,
        value: { result: "succeeded" },
      });
      expect(m.records().map((r) => r.identity)).toEqual([identity, identity]);
    },
  );

  it("TestBR237_a_run_without_identity_is_refused_before_policy_evaluation", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const m = memory();
    const gate = gateFor(m.sink, { rename: () => Promise.resolve(ok()) });
    const c = createNavigationController(
      f.config,
      gatedDependencies(f.dependencies, gate),
      undefined,
      { gate },
    );
    expect(await c.mutate("kdrive_rename", renameFile, undefined)).toEqual({
      ok: true,
      value: { result: "failed", code: "AUDIT_UNAVAILABLE", attempts: 0 },
    });
    expect(f.inspect).not.toHaveBeenCalled();
    expect(m.lines).toEqual([]);
  });
});

describe("BR-238 and BR-069 v2 stdio composition", () => {
  it("TestBR238_TestBR069_stdout_carries_only_MCP_frames_and_stderr_the_two_records", async () => {
    const f = await kdriveFixture();
    cleanup.push(() => f.close());
    const mutator = vi.fn<Mutator>(() => Promise.resolve(ok()));
    const run = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: String(DRIVE),
        KDRIVE_TOKEN_FILE: tokenFile(),
        KDRIVE_MCP_MODE: "write",
      },
      lookup: f.lookup,
      connect: f.connect,
      mutators: { rename: mutator },
    });
    const client = await stdioClient(run);
    cleanup.push(async () => {
      await client.close();
      await (run.handle as { close(): Promise<void> }).close();
    });
    expect(
      textOf(
        await client.callTool({
          name: "kdrive_info",
          arguments: { file_id: 12 },
        }),
      ),
    ).toMatchObject({ ok: { item: { id: 12 } } });
    hooks.operation = {
      kind: "rename",
      target: { driveId: DRIVE, id: 12 },
      name: "b.bin",
    };
    const result = textOf(
      await client.callTool({ name: "test_mutate", arguments: {} }),
    );
    expect(result).toMatchObject({
      ok: { ok: true, value: { result: "succeeded" } },
    });
    expect(mutator).toHaveBeenCalledTimes(1);
    const frames = run.stdout().split("\n").filter(Boolean);
    for (const frame of frames)
      expect(JSON.parse(frame)).toHaveProperty("jsonrpc", "2.0");
    expect(run.stdout()).not.toContain('"event":"intent"');
    const records = run
      .stderr()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.map((r) => [r.event, r.identity])).toEqual([
      ["intent", { kind: "stdio" }],
      ["outcome", { kind: "stdio" }],
    ]);
  });

  it("TestBR238_mode_read_never_opens_the_file_sink", async () => {
    const f = await kdriveFixture();
    cleanup.push(() => f.close());
    const path = join(mkdtempSync(join(tmpdir(), "kdrive-audit-")), "a.log");
    const run = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: String(DRIVE),
        KDRIVE_TOKEN_FILE: tokenFile(),
        KDRIVE_MCP_AUDIT_LOG: path,
      },
      lookup: f.lookup,
      connect: f.connect,
    });
    cleanup.push(() => (run.handle as { close(): Promise<void> }).close());
    expect(run.exits).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("TestBR238_mode_write_with_a_bad_file_path_stops_startup", async () => {
    const f = await kdriveFixture();
    cleanup.push(() => f.close());
    const run = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: String(DRIVE),
        KDRIVE_TOKEN_FILE: tokenFile(),
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_AUDIT_LOG: mkdtempSync(join(tmpdir(), "kdrive-audit-")),
      },
      lookup: f.lookup,
      connect: f.connect,
    });
    expect(run.handle).toBeUndefined();
    expect(run.exits).toEqual([1]);
    expect(run.stderr()).toBe(
      "The audit log could not be opened or is not a private regular file.\n",
    );
  });

  it("TestBR238_mode_write_with_a_file_path_records_to_the_file", async () => {
    const f = await kdriveFixture();
    cleanup.push(() => f.close());
    const path = join(mkdtempSync(join(tmpdir(), "kdrive-audit-")), "a.log");
    const run = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: String(DRIVE),
        KDRIVE_TOKEN_FILE: tokenFile(),
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_AUDIT_LOG: path,
      },
      lookup: f.lookup,
      connect: f.connect,
      mutators: { rename: () => Promise.resolve(ok()) },
    });
    const client = await stdioClient(run);
    cleanup.push(async () => {
      await client.close();
      await (run.handle as { close(): Promise<void> }).close();
    });
    expect(existsSync(path)).toBe(true);
    hooks.operation = {
      kind: "rename",
      target: { driveId: DRIVE, id: 12 },
      name: "b.bin",
    };
    await client.callTool({ name: "test_mutate", arguments: {} });
    const { readFileSync } = await import("node:fs");
    expect(
      readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { event: string }).event),
    ).toEqual(["intent", "outcome"]);
    expect(run.stderr()).toBe("");
  });
});

describe("BR-254 shutdown order", () => {
  it("TestBR254_stdio_EOF_waits_for_the_in_flight_outcome_then_closes", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const m = memory();
    let release!: () => void;
    const mutator = vi.fn<Mutator>(
      () =>
        new Promise((r) => {
          release = () => {
            r(ok());
          };
        }),
    );
    const gate = gateFor(m.sink, { rename: mutator });
    const input = new PassThrough();
    const started = startStdioNavigation(
      f.config,
      gatedDependencies(f.dependencies, gate),
      { input, output: new PassThrough(), signals: false, gate },
    );
    await started.ready;
    const binding = navigationBinding(started.server);
    const pending = binding?.controller.mutate(
      "kdrive_rename",
      { kind: "rename", target: { driveId: 7, id: 3 }, name: "b" },
      binding.identity,
    );
    await vi.waitFor(() => {
      expect(mutator).toHaveBeenCalled();
    });
    let closed = false;
    void started.closed.then(() => (closed = true));
    input.end();
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    release();
    await started.closed;
    expect(m.records().map((r) => [r.event, r.result])).toEqual([
      ["intent", undefined],
      ["outcome", "succeeded"],
    ]);
    expect(await pending).toMatchObject({ ok: true });
  });

  it("TestBR254_stdio_EOF_without_a_committed_run_closes_within_1000_ms", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const m = memory();
    const gate = gateFor(m.sink, { rename: () => Promise.resolve(ok()) });
    const input = new PassThrough();
    const started = startStdioNavigation(
      f.config,
      gatedDependencies(f.dependencies, gate),
      { input, output: new PassThrough(), signals: false, gate },
    );
    await started.ready;
    const start = performance.now();
    input.end();
    await started.closed;
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("TestBR254_HTTP_shutdown_answers_503_records_the_outcome_then_exits", async () => {
    const f = await kdriveFixture();
    cleanup.push(() => f.close());
    const { listeningPort } = await import("./helpers/http.js");
    const port = await listeningPort();
    let release!: () => void;
    const mutator = vi.fn<Mutator>(
      () =>
        new Promise((r) => {
          release = () => {
            r(ok());
          };
        }),
    );
    const run = await runMain({
      argv: ["--http", "--insecure-no-auth"],
      env: {
        KDRIVE_ID: String(DRIVE),
        KDRIVE_TOKEN_FILE: tokenFile(),
        MCP_HTTP_PORT: String(port),
        KDRIVE_MCP_MODE: "write",
      },
      lookup: f.lookup,
      connect: f.connect,
      mutators: { rename: mutator },
    });
    const base = `http://127.0.0.1:${String(port)}/`;
    const headers = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };
    const init = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      }),
    });
    const session = init.headers.get("mcp-session-id") ?? "";
    await init.text();
    const withSession = {
      ...headers,
      "mcp-session-id": session,
      "mcp-protocol-version": "2025-06-18",
    };
    await (
      await fetch(base, {
        method: "POST",
        headers: withSession,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      })
    ).text();
    hooks.operation = {
      kind: "rename",
      target: { driveId: DRIVE, id: 12 },
      name: "b.bin",
    };
    const call = fetch(base, {
      method: "POST",
      headers: withSession,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "test_mutate", arguments: {} },
      }),
    });
    await vi.waitFor(() => {
      expect(mutator).toHaveBeenCalled();
    });
    run.signals.emit("SIGTERM");
    const response = await call;
    expect(response.status).toBe(503);
    await response.text();
    await new Promise((r) => setTimeout(r, 50));
    expect(run.exits).toEqual([]);
    expect(run.stderr()).not.toContain('"event":"outcome"');
    release();
    await vi.waitFor(() => {
      expect(run.exits).toEqual([0]);
    });
    const records = run
      .stderr()
      .split("\n")
      .filter((l) => l.startsWith('{"v":1'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.map((r) => [r.event, r.result, r.identity])).toEqual([
      ["intent", undefined, { kind: "insecure" }],
      ["outcome", "succeeded", { kind: "insecure" }],
    ]);
  });
});

describe("BR-256 production evidence for mutation decisions", () => {
  async function compose(
    nodes: Node[],
    overrides: ((r: {
      path: string;
      query: URLSearchParams;
    }) => unknown)[] = [],
    env: Record<string, string> = {},
  ) {
    const f = await kdriveFixture({ nodes });
    cleanup.push(() => f.close());
    for (const override of overrides) f.drive.overrides.push(override as never);
    const config = await configuration({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_DENY: "**/secret,**/secret/**",
      KDRIVE_MCP_MAX_TREE_ITEMS: "3",
      ...env,
    });
    const adapter = await adapterFor(f);
    const m = memory();
    const mutator = vi.fn<Mutator>(() => Promise.resolve(ok()));
    const gate = gateFor(
      m.sink,
      Object.fromEntries(
        ["rename", "move", "trash", "create"].map((k) => [k, mutator]),
      ),
    );
    const dependencies = gatedDependencies(adapter.dependencies, gate);
    const controller = createNavigationController(
      config,
      dependencies,
      undefined,
      { gate },
    );
    return { f, m, mutator, gate, controller, dependencies };
  }
  const dir = (id: number, parent: number, name: string): Node => ({
    id,
    parent,
    type: "dir",
    name,
  });
  const file = (id: number, parent: number, name: string): Node => ({
    id,
    parent,
    type: "file",
    name,
    size: 1,
  });
  const ref = (id: number) => ({ driveId: DRIVE, id });
  const rename = (id: number) =>
    [
      "kdrive_rename",
      { kind: "rename", target: ref(id), name: "fresh" },
    ] as const;
  const expectDenied = async (
    c: Awaited<ReturnType<typeof compose>>,
    tool: string,
    operation: unknown,
  ) => {
    const result = await c.controller.mutate(tool, operation, {
      kind: "stdio",
    });
    expect(result).toEqual({
      ok: true,
      value: { result: "denied", op: OP, code: "ACCESS_DENIED", attempts: 0 },
    });
    expect(c.m.records().map((r) => r.event)).toEqual(["denied"]);
    expect(c.mutator).not.toHaveBeenCalled();
    expect(c.f.upstream.seen.every((s) => s.method === "GET")).toBe(true);
  };

  it("TestBR256_a_move_into_a_secret_folder_is_denied", async () => {
    const c = await compose([dir(20, 1, "A"), dir(21, 1, "secret")]);
    await expectDenied(c, "kdrive_move", {
      kind: "move",
      target: ref(20),
      destination: ref(21),
    });
  });

  it("TestBR256_a_folder_trash_covering_a_secret_descendant_is_denied", async () => {
    const c = await compose([dir(30, 1, "B"), dir(31, 30, "secret")]);
    await expectDenied(c, "kdrive_trash", { kind: "trash", target: ref(30) });
  });

  it("TestBR256_a_create_with_a_secret_result_path_is_denied", async () => {
    const c = await compose([dir(30, 1, "B")]);
    await expectDenied(c, "kdrive_create_folder", {
      kind: "create",
      destination: ref(30),
      name: "secret",
      type: "dir",
    });
  });

  it("TestBR256_a_folder_rename_with_a_secret_descendant_is_denied", async () => {
    const c = await compose([dir(30, 1, "B"), dir(31, 30, "secret")]);
    await expectDenied(c, ...rename(30));
  });

  it("TestBR256_a_tree_reaching_maxTreeItems_is_denied", async () => {
    const c = await compose([
      dir(40, 1, "Big"),
      file(41, 40, "a"),
      file(42, 40, "b"),
      file(43, 40, "c"),
      file(44, 40, "d"),
    ]);
    await expectDenied(c, ...rename(40));
  });

  it("TestBR256_a_paging_loop_beyond_the_page_budget_is_denied", async () => {
    const c = await compose(
      [dir(50, 1, "Loop"), file(51, 50, "a")],
      [
        (r) =>
          r.path === `/3/drive/${String(DRIVE)}/files/50/files`
            ? success([], {
                has_more: true,
                cursor: `k${r.query.get("cursor") ?? ""}x`,
              })
            : undefined,
      ],
      { KDRIVE_MCP_MAX_TREE_ITEMS: "1000" },
    );
    await expectDenied(c, ...rename(50));
  });

  it("TestBR256_a_page_with_has_more_and_no_cursor_is_denied", async () => {
    const c = await compose(
      [dir(60, 1, "More"), file(61, 60, "a")],
      [
        (r) =>
          r.path === `/3/drive/${String(DRIVE)}/files/60/files`
            ? success([], { has_more: true, cursor: null })
            : undefined,
      ],
    );
    await expectDenied(c, ...rename(60));
  });

  it("TestBR256_a_child_whose_path_differs_from_parent_and_name_is_denied", async () => {
    const nodes = [dir(70, 1, "Odd"), file(71, 70, "a")];
    const { providerItem } = await import("./helpers/kdrive.js");
    const c = await compose(nodes, [
      (r) =>
        r.path === `/3/drive/${String(DRIVE)}/files/70/files`
          ? success([{ ...providerItem(nodes, 71), path: "/Odd/elsewhere" }], {
              has_more: false,
              cursor: null,
            })
          : undefined,
    ]);
    await expectDenied(c, ...rename(70));
  });

  it("TestBR256_a_target_whose_inspect_path_differs_from_the_listing_is_denied", async () => {
    const nodes = [dir(80, 1, "Real"), dir(81, 80, "inner"), file(82, 81, "x")];
    const { providerItem } = await import("./helpers/kdrive.js");
    const c = await compose(nodes, [
      (r) =>
        r.path === `/3/drive/${String(DRIVE)}/files/80/files`
          ? success(
              [
                {
                  ...providerItem(nodes, 81),
                  path: "/Moved/inner",
                  parents: [
                    {
                      id: 80,
                      drive_id: DRIVE,
                      parent_id: 1,
                      type: "dir",
                      name: "Moved",
                    },
                  ],
                },
              ],
              { has_more: false, cursor: null },
            )
          : undefined,
    ]);
    await expectDenied(c, ...rename(80));
  });

  it("TestBR256_a_clean_tree_succeeds", async () => {
    const c = await compose([dir(90, 1, "Clean"), file(91, 90, "a")]);
    const result = await c.controller.mutate(...rename(90), { kind: "stdio" });
    expect(result).toEqual({
      ok: true,
      value: { result: "succeeded", op: OP, attempts: 1, status: 200 },
    });
    expect(c.m.records().map((r) => r.event)).toEqual(["intent", "outcome"]);
    expect(c.mutator).toHaveBeenCalledTimes(1);
  });

  it("TestBR256_a_direct_execute_outside_a_run_is_unavailable", async () => {
    const c = await compose([dir(90, 1, "Clean")]);
    const before = c.f.upstream.seen.length;
    expect(
      await c.dependencies.execute(
        Object.freeze({ kind: "rename", target: ref(90), name: "x" }),
      ),
    ).toEqual({ status: "unavailable" });
    expect(c.m.lines).toEqual([]);
    expect(c.f.upstream.seen).toHaveLength(before);
    expect(c.mutator).not.toHaveBeenCalled();
  });
});

describe("BR-257 received-share mutation evidence", () => {
  it("TestBR257_a_received_rename_reloads_shared_with_me_and_is_denied", async () => {
    const OWNER = 202;
    const root = {
      id: 500,
      drive_id: OWNER,
      parent_id: 77,
      type: "dir",
      name: "team",
      path: "/Shared/team",
      status: null,
      capabilities: {
        can_read: true,
        can_write: true,
        can_rename: true,
        can_move: true,
      },
    };
    const f = await kdriveFixture({ shared: [root] });
    cleanup.push(() => f.close());
    f.drive.overrides.push((r) => {
      if (r.path === "/2/drive/init")
        return success({
          drives: [
            { id: DRIVE, role: "admin" },
            { id: OWNER, role: "external" },
          ],
        });
      if (r.path === "/3/drive/202/files/500")
        return success({ ...root, parents: [] });
      if (r.path === "/3/drive/202/files/500/files")
        return success([], { has_more: false, cursor: null });
      return undefined;
    });
    const config = await configuration({
      KDRIVE_MCP_MODE: "write",
      KDRIVE_MCP_SHARED_WITH_ME: "1",
      KDRIVE_MCP_SHARED_WRITE: "1",
    });
    const adapter = await adapterFor(f);
    const m = memory();
    const mutator = vi.fn<Mutator>(() => Promise.resolve(ok()));
    const gate = gateFor(m.sink, { rename: mutator });
    const c = createNavigationController(
      config,
      gatedDependencies(adapter.dependencies, gate),
      undefined,
      { gate },
    );
    const shared = () =>
      f.apiRequests().filter((r) => r.path.endsWith("shared_with_me")).length;
    expect(
      (await c.invoke("kdrive_info", { drive_id: OWNER, file_id: 500 }))
        .isError,
    ).toBeUndefined();
    const afterRead = shared();
    expect(afterRead).toBeGreaterThan(0);
    const result = await c.mutate(
      "kdrive_rename",
      { kind: "rename", target: { driveId: OWNER, id: 500 }, name: "x" },
      { kind: "stdio" },
    );
    expect(shared()).toBeGreaterThan(afterRead);
    expect(result).toEqual({
      ok: true,
      value: { result: "denied", op: OP, code: "ACCESS_DENIED", attempts: 0 },
    });
    expect(m.records().map((r) => r.event)).toEqual(["denied"]);
    expect(mutator).not.toHaveBeenCalled();
  });
});

describe("BR-258 and BR-070 v2 mutation invocation lifecycle", () => {
  async function controllerWith(
    mutator: Mutator,
    env: Record<string, string> = {},
    slowInspect = 0,
  ) {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write", ...env });
    if (slowInspect) {
      const original = f.inspect.getMockImplementation();
      f.inspect.mockImplementation(async (...args) => {
        await new Promise((r) => setTimeout(r, slowInspect));
        return original?.(...args);
      });
    }
    const m = memory();
    const spy = vi.fn<Mutator>(mutator);
    const gate = gateFor(m.sink, { rename: spy });
    const deps: PolicyDependencies = gatedDependencies(f.dependencies, gate);
    const c = createNavigationController(f.config, deps, undefined, { gate });
    return { f, m, c, mutator: spy, gate };
  }
  const renameFile = {
    kind: "rename",
    target: { driveId: 7, id: 3 },
    name: "b",
  } as const;
  const later = (ms: number, value: unknown) =>
    new Promise((r) =>
      setTimeout(() => {
        r(value);
      }, ms),
    );

  it("TestBR258_TestBR070_a_12000_ms_write_succeeds_and_holds_the_slot", async () => {
    vi.useFakeTimers();
    const h = await controllerWith(() => later(12_000, ok()));
    let result: unknown;
    void h.c
      .mutate("kdrive_rename", renameFile, { kind: "stdio" })
      .then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(h.mutator).toHaveBeenCalled();
    // F-026 BR-258 v2: a read during the gate run waits for the slot.
    let waited: unknown;
    void h.c.invoke("kdrive_info", { file_id: 3 }).then((r) => (waited = r));
    await vi.advanceTimersByTimeAsync(500);
    expect(waited).toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    expect((waited as { isError?: boolean }).isError).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      value: { result: "succeeded", op: OP, attempts: 1, status: 200 },
    });
    expect(h.m.records()[1]).toMatchObject({ result: "succeeded" });
    expect(
      (await h.c.invoke("kdrive_info", { file_id: 3 })).isError,
    ).toBeUndefined();
  });

  it("TestBR258_TestBR250_the_navigation_deadline_before_the_intent_gives_REQUEST_TIMEOUT", async () => {
    vi.useFakeTimers();
    const h = await controllerWith(() => Promise.resolve(ok()), {}, 10_500);
    let result: unknown;
    void h.c
      .mutate("kdrive_rename", renameFile, { kind: "stdio" })
      .then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(result).toEqual({
      ok: true,
      value: { result: "failed", op: OP, code: "REQUEST_TIMEOUT", attempts: 0 },
    });
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it("TestBR258_TestBR250_a_client_cancellation_during_the_decision_gives_CANCELLED", async () => {
    vi.useFakeTimers();
    const h = await controllerWith(() => Promise.resolve(ok()), {}, 2_000);
    const client = new AbortController();
    let result: unknown;
    void h.c
      .mutate("kdrive_rename", renameFile, { kind: "stdio" }, client.signal)
      .then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1_000);
    client.abort();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(result).toEqual({
      ok: true,
      value: { result: "failed", op: OP, code: "CANCELLED", attempts: 0 },
    });
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it("TestBR258_an_oversize_value_is_returned_without_value", async () => {
    const h = await controllerWith(
      () => Promise.resolve(ok(200, { value: "v".repeat(2000) })),
      { KDRIVE_MCP_MAX_OUTPUT_CHARS: "1000" },
    );
    expect(
      await h.c.mutate("kdrive_rename", renameFile, { kind: "stdio" }),
    ).toEqual({
      ok: true,
      value: { result: "succeeded", op: OP, attempts: 1, status: 200 },
    });
  });

  it("TestBR258_TestBR070_a_429_at_8000_ms_retried_after_5_s_succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const h = await controllerWith(() =>
      calls++ === 0
        ? later(8_000, ok(429, { retryAfter: "5" }))
        : Promise.resolve(ok()),
    );
    let result: unknown;
    void h.c
      .mutate("kdrive_rename", renameFile, { kind: "stdio" })
      .then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(result).toEqual({
      ok: true,
      value: { result: "succeeded", op: OP, attempts: 2, status: 200 },
    });
  });

  it("TestBR258_mutate_waits_while_another_invocation_is_active", async () => {
    const h = await controllerWith(() => Promise.resolve(ok()));
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const original = h.f.inspect.getMockImplementation();
    h.f.inspect.mockImplementationOnce(async (...args) => {
      await held;
      return original?.(...args);
    });
    const read = h.c.invoke("kdrive_info", { file_id: 3 });
    const write = h.c.mutate("kdrive_rename", renameFile, { kind: "stdio" });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    release();
    await read;
    expect(await write).toMatchObject({
      ok: true,
      value: { result: "succeeded" },
    });
    expect(h.mutator).toHaveBeenCalledTimes(1);
  });

  it("TestBR258_TestBR070_a_client_cancel_during_the_attempt_keeps_succeeded", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const h = await controllerWith((_op, _payload, s) => {
      signal = s;
      return later(2_000, ok());
    });
    const client = new AbortController();
    let result: unknown;
    void h.c
      .mutate("kdrive_rename", renameFile, { kind: "stdio" }, client.signal)
      .then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.mutator).toHaveBeenCalled();
    client.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(false);
    expect(result).toEqual({
      ok: true,
      value: { result: "succeeded", op: OP, attempts: 1, status: 200 },
    });
    expect(h.m.records()[1]).toMatchObject({ result: "succeeded" });
  });

  it("TestBR258_TestBR070_a_client_cancel_after_the_intent_gives_CANCELLED", async () => {
    const h = await controllerWith(() => Promise.resolve(ok()));
    const client = new AbortController();
    h.m.onWrite((index, commit) => {
      commit();
      if (index === 0) client.abort();
    });
    expect(
      await h.c.mutate(
        "kdrive_rename",
        renameFile,
        { kind: "stdio" },
        client.signal,
      ),
    ).toEqual({
      ok: true,
      value: { result: "failed", op: OP, code: "CANCELLED", attempts: 0 },
    });
    expect(h.m.records().map((r) => [r.event, r.code])).toEqual([
      ["intent", undefined],
      ["outcome", "CANCELLED"],
    ]);
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it("TestBR258_a_session_close_after_the_intent_is_a_cancellation_and_the_run_completes", async () => {
    let release!: () => void;
    const h = await controllerWith(
      () =>
        new Promise((r) => {
          release = () => {
            r(ok());
          };
        }),
    );
    const pending = h.c.mutate("kdrive_rename", renameFile, {
      kind: "stdio",
    });
    await vi.waitFor(() => {
      expect(h.mutator).toHaveBeenCalled();
    });
    h.c.close();
    release();
    expect(await pending).toEqual({
      ok: true,
      value: { result: "succeeded", op: OP, attempts: 1, status: 200 },
    });
  });
});

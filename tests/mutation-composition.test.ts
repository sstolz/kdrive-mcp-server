// F-016 composition tests: AC-04, AC-05, AC-21 (compositions), AC-23–AC-26.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import * as auditModule from "../src/audit/sink.js";
import * as gateModule from "../src/mutation-gate.js";
import * as configModule from "../src/config.js";
import * as adapterModule from "../src/kdrive/index.js";
import * as httpModule from "../src/http/index.js";
import * as stdioTransportModule from "../src/stdio-transport.js";
import { main } from "../src/main.js";
import { ProcessOutput } from "./helpers/f054-process-stream.js";
import {
  FlushPort,
  processPorts,
  observed,
  microtasks,
} from "./helpers/f039-composition.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createStderrSink, type AuditSink } from "../src/audit/sink.js";
import {
  createMutationGate,
  gatedDependencies,
  type GateResult,
  type Mutator,
} from "../src/mutation-gate.js";
import {
  createNavigationController,
  navigationBinding,
} from "../src/navigation.js";
import { startStdioNavigation } from "../src/stdio.js";
import { createPolicy, type PolicyDependencies } from "../src/policy/index.js";
import type { Operation } from "../src/policy/operation.js";
import {
  navigationFixture,
  plainItem,
  plainRoot,
} from "./helpers/navigation.js";
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
  const state: {
    servers: unknown[];
    tool: string;
    operation: unknown;
    largeResult: boolean;
  } = {
    servers: [],
    tool: "kdrive_rename",
    operation: undefined,
    largeResult: false,
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
      if (hooks.largeResult)
        server.registerTool(
          "synthetic_large_result",
          { description: "F-054 test fixture only" },
          () =>
            Promise.resolve({
              content: [{ type: "text", text: "x".repeat(262070) }],
            }),
        );
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
  hooks.largeResult = false;
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
    // F-042 AC-06 / BR-429: production capabilities never grant received writes,
    // even when the provider advertises can_write/can_rename.
    const received = (await adapter.dependencies.received.inspect(
      { driveId: OWNER, id: 500 },
      "live",
    )) as { capabilities: Record<string, boolean> };
    expect(received.capabilities).toEqual({
      read: true,
      list: true,
      search: true,
      createFile: false,
      createDirectory: false,
      replace: false,
      rename: false,
      renameTree: false,
      moveOut: false,
      acceptMove: false,
      moveTree: false,
      trash: false,
      trashTree: false,
      restore: false,
      restoreTree: false,
      acceptRestore: false,
    });
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

  it("TestBR248_v2_AC06_429_at_8000_ms_finishes_without_a_navigation_retry", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const h = await controllerWith(() =>
      calls++ === 0
        ? later(8_000, ok(429, { retryAfter: "5" }))
        : Promise.resolve(ok()),
    );
    let result: unknown;
    let settledAt: number | undefined;
    const start = performance.now();
    const pending = h.c
      .mutate("kdrive_rename", renameFile, { kind: "stdio" })
      .then((value) => {
        result = value;
        settledAt = performance.now() - start;
      });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const expected = {
      ok: true,
      value: {
        result: "failed",
        op: OP,
        code: "RATE_LIMITED",
        attempts: 1,
        status: 429,
      },
    };
    const base = {
      v: 1,
      ts: "2026-11-09T10:00:00.000Z",
      op: OP,
      identity: { kind: "stdio" },
      tool: "kdrive_rename",
      kind: "rename",
      drive: 7,
      ids: { target: 3 },
    };
    const records = [
      { ...base, event: "intent" },
      {
        ...base,
        event: "outcome",
        result: "failed",
        attempts: 1,
        ms: 8_000,
        status: 429,
        code: "RATE_LIMITED",
      },
    ];
    expect(result).toEqual(expected);
    expect(settledAt).toBe(8_000);
    expect(h.m.records()).toEqual(records);
    await pending;
    await vi.advanceTimersByTimeAsync(52_001);
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expected);
    expect(h.m.records()).toEqual(records);
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

// F-037: the real guarded policy, mutable complete evidence and injected writes.
describe("BR-248 v2 fresh authorization after a rate-limited invocation", () => {
  const ref = (id: number) => ({ driveId: 101, id });
  const rename: Operation = {
    kind: "rename",
    target: ref(42),
    name: "renamed",
  };
  const limited = (op: string) => ({
    result: "failed",
    op,
    code: "RATE_LIMITED",
    attempts: 1,
    status: 429,
  });
  const baseFor = (tool: string, operation: Operation, op: string) => ({
    v: 1,
    ts: "2026-11-09T10:00:00.000Z",
    op,
    identity: { kind: "stdio" },
    tool,
    kind: operation.kind,
    drive: 101,
    ids: {
      ...(operation.target ? { target: operation.target.id } : {}),
      ...(operation.destination
        ? { destination: operation.destination.id }
        : {}),
    },
  });
  const limitedRecords = (base: ReturnType<typeof baseFor>) => [
    { ...base, event: "intent" },
    {
      ...base,
      event: "outcome",
      result: "failed",
      attempts: 1,
      ms: 0,
      status: 429,
      code: "RATE_LIMITED",
    },
  ];

  function fixture() {
    const drive = plainRoot(101);
    const root = plainItem(10, "/r", "dir", [drive], 101);
    const parent = plainItem(11, "/r/open", "dir", [drive, root], 101);
    const destination = plainItem(12, "/r/dest", "dir", [drive, root], 101);
    const secret = plainItem(13, "/r/secret", "dir", [drive, root], 101);
    const outside = plainItem(20, "/outside", "dir", [drive], 101);
    const target = plainItem(
      42,
      "/r/open/a",
      "file",
      [drive, root, parent],
      101,
    );
    const nodes = new Map(
      [drive, root, parent, destination, secret, outside, target].map(
        (node) => [node.id, node],
      ),
    );
    const replies = [ok(429, { retryAfter: "5" }), ok()];
    const mutator = vi.fn<Mutator>(() => Promise.resolve(replies.shift()));
    let sequence = 0;
    const defaults = {
      KDRIVE_ID: "101",
      KDRIVE_IDS: "101",
      KDRIVE_MCP_ROOTS: "101:10",
      KDRIVE_MCP_DENY: "/r/secret/**",
      KDRIVE_MCP_MODE: "share",
      KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "1",
      KDRIVE_MCP_INVITE_DOMAINS: "example.test",
    };
    async function compose(env: Record<string, string> = {}) {
      const f = await navigationFixture({ ...defaults, ...env });
      const inspect = vi.fn<PolicyDependencies["inspect"]>(
        (reference, location) => {
          const node = nodes.get(reference.id);
          if (!node || reference.driveId !== 101)
            return Promise.resolve({ status: "missing" });
          // Original-trash evidence has a historical parent chain in its own
          // namespace. The live parent remains separately inspectable.
          return Promise.resolve(
            structuredClone(
              location === "original-trash"
                ? {
                    ...node,
                    location,
                    lifecycle: "trashed",
                    treeRootId: node.id,
                    parents: node.parents.map((ancestor) => ({
                      ...ancestor,
                      location,
                    })),
                  }
                : node,
            ),
          );
        },
      );
      const m = memory();
      const gate = createMutationGate({
        mode: f.config.mode,
        ...(f.config.mode === "read" ? {} : { sink: m.sink }),
        // Sharing remains injected even for the reconstructed write-mode gate.
        mutators: Object.fromEntries(
          [
            "rename",
            "move",
            "replace",
            "restore",
            "share-link",
            "share-invite",
          ].map((kind) => [kind, mutator]),
        ),
        random: (n) => {
          const offset = sequence++ * 16;
          return Uint8Array.from({ length: n }, (_, index) => index + offset);
        },
        clock: () => new Date("2026-11-09T10:00:00.000Z"),
        now: () => performance.now(),
        diagnostic: () => undefined,
      });
      const dependencies: PolicyDependencies = {
        ...f.dependencies,
        inspect,
        children: (request) =>
          Promise.resolve({
            ...request,
            status: "complete",
            entries: [],
            terminal: true,
          }),
      };
      const policy = createPolicy(
        f.config,
        gatedDependencies(dependencies, gate),
      );
      const dispatch = vi.fn((operation: Operation) =>
        policy.dispatch(operation),
      );
      return {
        m,
        policy,
        inspect,
        dispatch,
        run: (tool: string, operation: Operation) =>
          gate.run({ tool, operation, identity: { kind: "stdio" }, dispatch }),
      };
    }
    function move(id: number, parentId: number) {
      const node = nodes.get(id)!;
      const nextParent = nodes.get(parentId)!;
      nodes.set(
        id,
        plainItem(
          id,
          `${nextParent.path}/${node.name}`,
          node.type,
          [...nextParent.parents, nextParent],
          101,
        ),
      );
    }
    return { compose, nodes, move, mutator, replies };
  }

  function start(
    h: Awaited<ReturnType<ReturnType<typeof fixture>["compose"]>>,
    tool: string,
    operation: Operation,
  ) {
    const state: { result?: GateResult; settledAt?: number } = {};
    const beginning = performance.now();
    const pending = h.run(tool, operation).then((value) => {
      state.result = value;
      state.settledAt = performance.now() - beginning;
    });
    return { state, pending };
  }

  it("TestBR248_v2_AC02_target_moves_into_denied_directory_during_retry_after", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const h = await f.compose();
    const base = baseFor("kdrive_rename", rename, OP);
    const first = start(h, "kdrive_rename", rename);
    await vi.advanceTimersByTimeAsync(0);
    // Soft assertions also expose the old code's second upstream call below.
    expect.soft(first.state.result).toEqual(limited(OP));
    expect.soft(first.state.settledAt).toBe(0);
    expect.soft(h.m.records()).toEqual(limitedRecords(base));
    await vi.advanceTimersByTimeAsync(1_000);
    f.move(42, 13);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(f.mutator).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    await first.pending;
    expect(first.state.result).toEqual(limited(OP));
    expect(h.m.records()).toEqual(limitedRecords(base));
    const before = h.inspect.mock.calls.length;
    const second = await h.run("kdrive_rename", rename);
    const nextOp = "101112131415161718191a1b1c1d1e1f";
    expect(second).toEqual({
      result: "denied",
      op: nextOp,
      code: "ACCESS_DENIED",
      attempts: 0,
    });
    expect(h.inspect.mock.calls.slice(before)).toEqual([[ref(42), "live"]]);
    expect(h.m.records().slice(0, 2)).toEqual(limitedRecords(base));
    expect(h.m.records().slice(2)).toEqual([
      {
        ...baseFor("kdrive_rename", rename, nextOp),
        event: "denied",
        code: "ACCESS_DENIED",
      },
    ]);
    // This is deny matching on consistent ancestry, not an evidence refusal.
    expect(await h.policy.check(rename)).toEqual({
      allowed: false,
      code: "DENIED_PATH",
    });
    await vi.advanceTimersByTimeAsync(55_001);
    expect(f.mutator).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.m.records()).toEqual([
      ...limitedRecords(base),
      {
        ...baseFor("kdrive_rename", rename, nextOp),
        event: "denied",
        code: "ACCESS_DENIED",
      },
    ]);
  });

  it("TestBR248_v2_AC03_unchanged_target_requires_a_new_authorized_invocation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const h = await f.compose();
    const base = baseFor("kdrive_rename", rename, OP);
    const first = start(h, "kdrive_rename", rename);
    await vi.advanceTimersByTimeAsync(0);
    expect.soft(first.state.result).toEqual(limited(OP));
    expect.soft(first.state.settledAt).toBe(0);
    expect.soft(h.m.records()).toEqual(limitedRecords(base));
    await vi.advanceTimersByTimeAsync(5_001);
    expect(f.mutator).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    await first.pending;
    expect(first.state.result).toEqual(limited(OP));
    expect(h.m.records()).toEqual(limitedRecords(base));
    const before = h.inspect.mock.calls.length;
    const second = await h.run("kdrive_rename", rename);
    const nextOp = "101112131415161718191a1b1c1d1e1f";
    expect(second).toEqual({
      result: "succeeded",
      op: nextOp,
      attempts: 1,
      status: 200,
    });
    expect(h.inspect.mock.calls.slice(before)).toEqual([[ref(42), "live"]]);
    const nextBase = baseFor("kdrive_rename", rename, nextOp);
    const records = [
      { ...nextBase, event: "intent" },
      {
        ...nextBase,
        event: "outcome",
        result: "succeeded",
        attempts: 1,
        ms: 0,
        status: 200,
      },
    ];
    expect(h.m.records().slice(0, 2)).toEqual(limitedRecords(base));
    expect(h.m.records().slice(2)).toEqual(records);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(f.mutator).toHaveBeenCalledTimes(2);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.m.records()).toEqual([...limitedRecords(base), ...records]);
  });

  const cases: [string, string, Operation, Record<string, string>, string][] = [
    ["target_outside_root", "kdrive_rename", rename, {}, "OUTSIDE_SCOPE"],
    [
      "destination_denied",
      "kdrive_move",
      { kind: "move", target: ref(42), destination: ref(12) },
      {},
      "DENIED_PATH",
    ],
    [
      "destination_outside_root",
      "kdrive_move",
      { kind: "move", target: ref(42), destination: ref(12) },
      {},
      "OUTSIDE_SCOPE",
    ],
    [
      "replacement_parent_changed",
      "kdrive_upload",
      { kind: "replace", target: ref(42), destination: ref(11), name: "a" },
      {},
      "INVALID_OPERATION",
    ],
    [
      "restore_parent_denied",
      "kdrive_restore",
      { kind: "restore", target: ref(42) },
      { KDRIVE_MCP_DENY: "/r/open" },
      "DENIED_PATH",
    ],
    [
      "configured_root_target",
      "kdrive_rename",
      rename,
      { KDRIVE_MCP_ROOTS: "101:42" },
      "INVALID_OPERATION",
    ],
    [
      "share_mode_removed",
      "kdrive_share_link",
      { kind: "share-link", target: ref(42) },
      { KDRIVE_MCP_MODE: "write" },
      "LEVEL_REQUIRED",
    ],
    [
      "domain_removed",
      "kdrive_share_access",
      { kind: "share-invite", target: ref(42), domain: "example.test" },
      { KDRIVE_MCP_INVITE_DOMAINS: "other.test" },
      "SHARE_RESTRICTED",
    ],
    [
      "public_links_disabled",
      "kdrive_share_link",
      { kind: "share-link", target: ref(42) },
      { KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "0" },
      "SHARE_RESTRICTED",
    ],
    [
      "read_mode",
      "kdrive_rename",
      rename,
      { KDRIVE_MCP_MODE: "read" },
      "LEVEL_REQUIRED",
    ],
  ];
  it.each(cases)(
    "TestBR248_v2_AC04_new_invocation_after_%s_uses_current_authorization",
    async (row, tool, operation, env, refusal) => {
      vi.useFakeTimers();
      const f = fixture();
      if (row === "configured_root_target") f.nodes.get(42)!.type = "dir";
      const h = await f.compose();
      const base = baseFor(tool, operation, OP);
      const first = start(h, tool, operation);
      await vi.advanceTimersByTimeAsync(0);
      expect(first.state.result).toEqual(limited(OP));
      expect(first.state.settledAt).toBe(0);
      expect(h.m.records()).toEqual(limitedRecords(base));
      await first.pending;
      await vi.advanceTimersByTimeAsync(1_000);
      const moves: Record<string, [number, number]> = {
        target_outside_root: [42, 20],
        destination_denied: [12, 13],
        destination_outside_root: [12, 20],
        replacement_parent_changed: [42, 12],
      };
      const move = moves[row];
      if (move) f.move(...move);
      // Changed configuration is captured by a newly constructed policy/gate.
      const next = Object.keys(env).length ? await f.compose(env) : h;
      await vi.advanceTimersByTimeAsync(59_001);
      expect(f.mutator).toHaveBeenCalledTimes(1);
      expect(first.state.result).toEqual(limited(OP));
      expect(h.m.records()).toEqual(limitedRecords(base));
      const recordOffset = next.m.records().length;
      const second = await next.run(tool, operation);
      const nextOp = "101112131415161718191a1b1c1d1e1f";
      expect(second).toEqual(
        row === "read_mode"
          ? { result: "failed", code: "ACCESS_DENIED", attempts: 0 }
          : {
              result: "denied",
              op: nextOp,
              code: "ACCESS_DENIED",
              attempts: 0,
            },
      );
      const records =
        row === "read_mode"
          ? []
          : [
              {
                ...baseFor(tool, operation, nextOp),
                event: "denied",
                code: "ACCESS_DENIED",
              },
            ];
      expect(next.m.records().slice(recordOffset)).toEqual(records);
      expect(h.m.records().slice(0, 2)).toEqual(limitedRecords(base));
      // Check the exact policy reason, isolating binding, scope and config
      // rules from malformed evidence or an unavailable share mutator.
      expect(await next.policy.check(operation)).toEqual({
        allowed: false,
        code: refusal,
      });
      expect(f.mutator).toHaveBeenCalledTimes(1);
      expect(f.replies).toEqual([ok()]);
      expect(h.m.records()).toEqual([
        ...limitedRecords(base),
        ...(next === h ? records : []),
      ]);
      if (next !== h) expect(next.m.records()).toEqual(records);
    },
  );
});

// F-039: real gate/sinks with only clocks, process ports and upstream facades injected.
const F039_RENAME = {
  kind: "rename",
  target: { driveId: 101, id: 42 },
  name: "renamed",
};
const F039_FAILED = {
  result: "failed",
  op: OP,
  code: "AUDIT_UNAVAILABLE",
  attempts: 0,
};
function f039Sink(
  kind: "stderr" | "write" | "sync" | "release",
  order: string[] = [],
  releaseRejects = false,
) {
  const records: auditModule.AuditRecord[] = [];
  const callbacks: (() => void)[] = [];
  const portOperations: (() => void)[] = [];
  let blocked = true;
  let releaseCalls = 0;
  const releases: (() => void)[] = [];
  const release = () => {
    releaseCalls++;
    order.push("release");
    return releaseRejects
      ? Promise.reject(new Error("SYNTHETIC_RELEASE_FAILURE"))
      : new Promise<void>((resolve) => releases.push(resolve));
  };
  const port: auditModule.AuditFilePort = {
    open: () => Promise.resolve(3),
    fstat: () =>
      Promise.resolve({ isFile: () => true, uid: 1000, mode: 0o100600 }),
    geteuid: () => 1000,
    write: async (_fd, bytes) => {
      records.push(
        JSON.parse(Buffer.from(bytes).toString()) as auditModule.AuditRecord,
      );
      if (kind === "write" && blocked)
        await new Promise<void>((resolve) => portOperations.push(resolve));
      return bytes.length;
    },
    fdatasync: async () => {
      if (kind === "sync" && blocked)
        await new Promise<void>((resolve) => portOperations.push(resolve));
    },
    close: release,
  };
  const pending =
    kind === "stderr"
      ? Promise.resolve(
          createStderrSink({
            write(text, callback) {
              records.push(JSON.parse(text) as auditModule.AuditRecord);
              callbacks.push(() => {
                callback();
              });
              if (!blocked) callback();
              return false;
            },
          }),
        )
      : auditModule.openFileSink("/synthetic/f039-audit", { port });
  return {
    records,
    callbacks,
    portOperations,
    releases,
    releaseCalls: () => releaseCalls,
    unblock() {
      blocked = false;
      callbacks.at(-1)?.();
      portOperations.at(-1)?.();
    },
    block() {
      blocked = true;
    },
    sink: pending.then(
      (sink) =>
        new Proxy({} as AuditSink, {
          get(_target, key) {
            const target = sink;
            if (key === "close")
              return (...args: unknown[]) => {
                order.push("sink-close");
                const close: (deadline?: number) => Promise<void> =
                  target.close.bind(target);
                return close(args[0] as number | undefined);
              };
            return Reflect.get(target, key, target) as unknown;
          },
        }),
    ),
  };
}
function f039Gate(
  sink: AuditSink,
  mutator: Mutator = () => Promise.resolve(ok(200, { value: { id: 42 } })),
) {
  const diagnostics: string[] = [];
  const attempt = vi.fn(mutator);
  const gate = createMutationGate({
    mode: "write",
    sink,
    mutators: { rename: attempt },
    random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    clock: () => new Date("2026-11-09T10:00:00.000Z"),
    now: () => performance.now(),
    diagnostic: (text) => {
      diagnostics.push(text);
    },
  });
  const run = (dispatch?: (operation: Operation) => Promise<unknown>) =>
    gate.run({
      tool: "kdrive_rename",
      operation: F039_RENAME,
      identity: { kind: "stdio" },
      dispatch:
        dispatch ??
        (async (operation) => ({
          ok: true,
          value: await gate.execute(operation),
        })),
    });
  return { gate, run, attempt, diagnostics };
}

/** Inject only the startup/upstream/OS ports; retain main -> stdio -> real exit routing. */
async function f039Main(
  sink: AuditSink,
  options: {
    owned?: boolean;
    http?: boolean;
    order?: string[];
    startFailure?: boolean;
    transportMs?: number;
    mutator?: Mutator;
    exit?: (code: number, deadline?: number) => void;
    output?: PassThrough | ProcessOutput;
  } = {},
) {
  const order = options.order ?? [];
  const fixture = await navigationFixture({
    KDRIVE_MCP_MODE: "write",
    ...(options.http
      ? { KDRIVE_MCP_TRANSPORT: "http", KDRIVE_MCP_INSECURE_NO_AUTH: "1" }
      : {}),
  });
  // ProcessOutput models process.stdout at runtime; the seam needs stream typing.
  const out = (options.output ?? new PassThrough()) as PassThrough;
  const frames: Record<string, unknown>[] = [];
  let wireBuffer = "";
  out.on("data", (bytes: Buffer) => {
    wireBuffer += bytes.toString();
    for (;;) {
      const end = wireBuffer.indexOf("\n");
      if (end < 0) break;
      frames.push(
        JSON.parse(wireBuffer.slice(0, end)) as Record<string, unknown>,
      );
      wireBuffer = wireBuffer.slice(end + 1);
    }
  });
  const runs: ReturnType<typeof observed<GateResult>>[] = [];
  const err = new FlushPort();
  const ports = processPorts(out, err, () => order.push("exit"));
  const listeners = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [signal, process.listeners(signal)]),
  );
  const signals = new EventEmitter();
  const setExitCode = vi.fn();
  const originalAdapter = adapterModule.createKdriveAdapter;
  const originalGate = gateModule.createMutationGate;
  const mocks: { mockRestore(): void }[] = [
    vi
      .spyOn(configModule, "preflightConfiguration")
      .mockResolvedValue(fixture.config),
    vi
      .spyOn(adapterModule, "createKdriveAdapter")
      .mockImplementation((options_) => {
        const adapter = originalAdapter(options_);
        return {
          ...adapter,
          dependencies: { ...adapter.dependencies, ...fixture.dependencies },
        };
      }),
    vi.spyOn(auditModule, "openAuditSink").mockResolvedValue(sink),
  ];
  let gate!: gateModule.MutationGate;
  mocks.push(
    vi
      .spyOn(gateModule, "createMutationGate")
      .mockImplementation((options_) => {
        const real = originalGate({
          ...options_,
          random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
        });
        gate = new Proxy({} as gateModule.MutationGate, {
          get(_target, key) {
            if (key === "run")
              return async (request: gateModule.GateRun) => {
                const pending = real.run(request);
                runs.push(observed(pending));
                const result = await pending;
                if (result.audit === "outcome_unrecorded")
                  order.push("outcome-failure");
                return result;
              };
            if (key === "close")
              return async (...args: unknown[]) => {
                const close: (deadline?: number) => Promise<void> =
                  real.close.bind(real);
                await close(args[0] as number | undefined);
                order.push("gate-close");
              };
            return Reflect.get(real, key, real) as unknown;
          },
        });
        return gate;
      }),
  );
  if (options.transportMs) {
    const realTransport = stdioTransportModule.createOwnedStdioTransport;
    mocks.push(
      vi
        .spyOn(stdioTransportModule, "createOwnedStdioTransport")
        .mockImplementation((...args) => {
          const transport = realTransport(...args);
          let notify: (() => void) | undefined;
          Object.defineProperty(transport, "onclose", {
            configurable: true,
            get: () => () => {
              setTimeout(() => notify?.(), options.transportMs);
            },
            set: (listener: (() => void) | undefined) => {
              notify = listener;
            },
          });
          const close = transport.close.bind(transport);
          transport.close = async () => {
            await close();
            await new Promise<void>((resolve) =>
              setTimeout(resolve, options.transportMs),
            );
          };
          return transport;
        }),
    );
  }
  let handler: httpModule.HttpHandler | undefined;
  if (options.http)
    mocks.push(
      vi.spyOn(httpModule, "startHttpServer").mockImplementation((args) => {
        handler = httpModule.createHttpHandler(args);
        return Promise.resolve({
          address: { address: "127.0.0.1", family: "IPv4", port: 3000 },
          close: async () => {
            await handler?.close();
            order.push("transport-close");
          },
        });
      }),
    );
  if (options.startFailure) {
    // Fail an injected input port during the real transport's start.
    const on = ports.input.on.bind(ports.input);
    mocks.push(
      vi.spyOn(ports.input, "on").mockImplementation((event, listener) => {
        if (event === "data") throw new Error("SYNTHETIC_START_FAILURE");
        return on(event, listener);
      }),
    );
  }
  out.on("close", () => order.push("transport-close"));
  const restore = () => {
    for (const signal of ["SIGINT", "SIGTERM"])
      for (const listener of process.listeners(signal))
        if (!listeners.get(signal)?.includes(listener))
          process.off(signal, listener);
    for (const mock of mocks.toReversed()) mock.mockRestore();
    out.destroy();
    ports.restore();
  };
  try {
    const handle = await main({
      ...ports.dependencies,
      ...(options.exit ? { exit: options.exit } : {}),
      argv: [],
      env: {
        KDRIVE_ID: "7",
        KDRIVE_TOKEN: "SYNTHETIC",
        KDRIVE_MCP_MODE: "write",
        ...(options.http
          ? { KDRIVE_MCP_TRANSPORT: "http", KDRIVE_MCP_INSECURE_NO_AUTH: "1" }
          : {}),
      },
      ...(options.owned
        ? { protocol: { input: ports.input, output: out }, setExitCode }
        : {}),
      signals: {
        on: (name, fn) => signals.on(name, fn),
        off: (name, fn) => signals.off(name, fn),
      },
      mutators: {
        rename:
          options.mutator ??
          (() => Promise.resolve(ok(200, { value: { id: 42 } }))),
      },
    });
    return {
      ports,
      out,
      err,
      setExitCode,
      gate,
      handle,
      handler,
      fixture,
      frames,
      runs,
      async wireMutation(deny = false) {
        if (deny) fixture.inspect.mockResolvedValue({ status: "absent" });
        const send = (frame: unknown) => {
          ports.input.write(`${JSON.stringify(frame)}\n`);
        };
        send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "f039", version: "1" },
          },
        });
        await vi.advanceTimersByTimeAsync(0);
        await microtasks();
        expect(frames.some((frame) => frame.id === 1)).toBe(true);
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        await vi.advanceTimersByTimeAsync(0);
        hooks.operation = {
          kind: "rename",
          target: { driveId: 7, id: 3 },
          name: "b",
        };
        send({
          jsonrpc: "2.0",
          id: 39,
          method: "tools/call",
          params: { name: "test_mutate", arguments: {} },
        });
        await vi.advanceTimersByTimeAsync(0);
        await microtasks();
        expect(runs).toHaveLength(1);
        return runs[0]!;
      },
      restore,
      order,
      signal(name: "EOF" | "SIGINT" | "SIGTERM") {
        if (name === "EOF") ports.input.end();
        else if (options.http || options.owned) signals.emit(name);
        else
          for (const listener of process.listeners(name))
            if (!listeners.get(name)?.includes(listener)) listener(name);
      },
      runDenied: () =>
        gate.run({
          tool: "kdrive_rename",
          operation: F039_RENAME,
          identity: { kind: "stdio" },
          dispatch: () => Promise.resolve({ ok: false, code: "ACCESS_DENIED" }),
        }),
      run: () =>
        gate.run({
          tool: "kdrive_rename",
          operation: F039_RENAME,
          identity: { kind: "stdio" },
          dispatch: async (operation) => ({
            ok: true,
            value: await gate.execute(operation),
          }),
        }),
    };
  } catch (error) {
    restore();
    throw error;
  }
}

describe("F-039 bounded audit composition", () => {
  it.each(["stalled-intent", "pre-intent"] as const)(
    "TestBR254_v2_AC08_gate_close_preserves_attempt_and_bounds_audit_waits [%s]",
    async (row) => {
      vi.useFakeTimers();
      const s = f039Sink("stderr");
      const h = f039Gate(await s.sink);
      let policyDone!: () => void;
      const policy = new Promise<void>((resolve) => {
        policyDone = resolve;
      });
      const result = observed(
        h.run(
          row === "pre-intent"
            ? async (operation) => {
                await policy;
                return { ok: true, value: await h.gate.execute(operation) };
              }
            : undefined,
        ),
      );
      await microtasks();
      const closing = observed(h.gate.close());
      if (row === "pre-intent") {
        await vi.advanceTimersByTimeAsync(100);
        policyDone();
      }
      await vi.advanceTimersByTimeAsync(row === "pre-intent" ? 0 : 5000);
      expect(result.value).toEqual(
        row === "pre-intent"
          ? { result: "failed", op: OP, code: "CANCELLED", attempts: 0 }
          : F039_FAILED,
      );
      expect(closing).toEqual({ settled: true, value: undefined });
      expect(performance.now()).toBeLessThanOrEqual(45000);
      expect(h.attempt).not.toHaveBeenCalled();
      expect(s.records.map((record) => record.event)).toEqual(
        row === "pre-intent" ? [] : ["intent"],
      );
      expect(await h.run()).toEqual({
        result: "failed",
        code: "AUDIT_UNAVAILABLE",
        attempts: 0,
      });
    },
  );

  it("TestBR070_v5_AC08_shutdown_keeps_committed_result_semantics", async () => {
    vi.useFakeTimers();
    const s = f039Sink("sync");
    let late!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    const h = f039Gate(
      await s.sink,
      async (_operation, _payload, cancellation) => {
        signal = cancellation;
        return new Promise((resolve) => {
          late = resolve;
        });
      },
    );
    const result = observed(h.run());
    await vi.advanceTimersByTimeAsync(4999);
    s.unblock();
    await microtasks();
    s.block();
    expect(h.attempt).toHaveBeenCalledTimes(1);
    const at = performance.now(),
      closing = observed(h.gate.close());
    await vi.advanceTimersByTimeAsync(29999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(result.value).toEqual({
      result: "uncertain",
      op: OP,
      code: "UPSTREAM_UNCERTAIN",
      attempts: 1,
      audit: "outcome_unrecorded",
      message: gateModule.UNCERTAIN_MESSAGE,
    });
    // Settle the already-issued sync so file release can legally start, then stall release.
    s.portOperations.at(-1)?.();
    await microtasks();
    await vi.advanceTimersByTimeAsync(5000);
    expect(closing).toEqual({ settled: true, value: undefined });
    expect(performance.now() - at).toBeLessThanOrEqual(45000);
    expect(s.releaseCalls()).toBe(1);
    late(ok(200));
    await microtasks();
    expect(result.value?.result).toBe("uncertain");
    expect(await h.run()).toEqual({
      result: "failed",
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
  });

  it("TestBR070_v5_AC11_audit_timeout_releases_navigation_slot", async () => {
    vi.useFakeTimers();
    const fixture = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const s = f039Sink("stderr"),
      h = f039Gate(await s.sink);
    const controller = createNavigationController(
      fixture.config,
      gatedDependencies(fixture.dependencies, h.gate),
      undefined,
      { gate: h.gate },
    );
    const result = observed(
      controller.mutate(
        "kdrive_rename",
        { kind: "rename", target: { driveId: 7, id: 3 }, name: "b" },
        { kind: "stdio" },
      ),
    );
    await microtasks();
    const read = observed(controller.invoke("kdrive_info", { file_id: 3 }));
    await vi.advanceTimersByTimeAsync(4999);
    expect(read.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.value).toEqual({ ok: true, value: F039_FAILED });
    expect(read.settled).toBe(true);
    expect(read.value?.isError).toBeUndefined();
    expect(h.attempt).not.toHaveBeenCalled();
    controller.close();
  });
});

const F039_SIGNALS = ["EOF", "SIGINT", "SIGTERM"] as const;
describe("F-039 dedicated and owned shutdown", () => {
  it("TestBR070_v5_AC13_commit_during_transport_close_omits_exit_deadline", async () => {
    vi.useFakeTimers();
    const s = f039Sink("stderr");
    const h = await f039Main(await s.sink, { transportMs: 200 });
    try {
      let commit!: () => void;
      const dispatched = new Promise<void>((resolve) => {
        commit = resolve;
      });
      const result = observed(
        h.gate.run({
          tool: "kdrive_rename",
          operation: F039_RENAME,
          identity: { kind: "stdio" },
          dispatch: async (operation) => {
            await dispatched;
            return h.gate.execute(operation);
          },
        }),
      );
      expect(h.gate.hasCommitted).toBe(false);
      h.signal("SIGTERM");
      await vi.advanceTimersByTimeAsync(100);
      commit();
      await microtasks();
      expect(h.gate.hasCommitted).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(result.value).toEqual(F039_FAILED);
      expect(h.order).toContain("gate-close");
      expect(h.ports.exits).toEqual([]);
      expect(h.err.callbacks).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(h.ports.exits).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.ports.exits).toEqual([{ code: 0, at: 5350 }]);
    } finally {
      h.restore();
    }
  });

  it("TestBR254_v2_AC09_throwing_shorten_deadline_drains_run_and_releases_file_before_close", async () => {
    vi.useFakeTimers();
    const s = f039Sink("release");
    const sink = await s.sink;
    const shortenDeadline = vi.fn(() => {
      throw new Error("SYNTHETIC_SHORTEN_FAILURE");
    });
    const close = vi.fn((deadline?: number) => sink.close(deadline));
    const h = f039Gate({
      append: (record) => sink.append(record),
      get latched() {
        return sink.latched;
      },
      latch: () => {
        sink.latch();
      },
      close,
      onLatch: (listener) => sink.onLatch?.(listener),
      shortenDeadline,
    });
    let policyDone!: () => void;
    const policy = new Promise<void>((resolve) => {
      policyDone = resolve;
    });
    const result = observed(
      h.run(async (operation) => {
        await policy;
        return { ok: true, value: await h.gate.execute(operation) };
      }),
    );
    await microtasks();
    expect(result.settled).toBe(false);
    const deadline = performance.now() + 1000;
    const closing = observed(h.gate.close(deadline));
    await microtasks();
    expect(shortenDeadline).toHaveBeenCalledExactlyOnceWith(deadline);
    expect(sink.latched).toBe(true);
    expect(h.diagnostics).toEqual([gateModule.OUTCOME_UNRECORDED_DIAGNOSTIC]);
    expect(closing.settled).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(s.releaseCalls()).toBe(0);

    policyDone();
    await microtasks();
    expect(result.value).toEqual({
      result: "failed",
      op: OP,
      code: "CANCELLED",
      attempts: 0,
    });
    expect(h.attempt).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith(deadline);
    expect(s.releaseCalls()).toBe(1);
    expect(closing.settled).toBe(false);

    s.releases[0]!();
    await microtasks();
    expect(closing).toEqual({ settled: true, value: undefined });
  });

  it("TestBR254_v2_AC09_throwing_shorten_deadline_still_reaches_stdio_exit", async () => {
    vi.useFakeTimers();
    const s = f039Sink("stderr");
    const sink = await s.sink;
    const shortenDeadline = vi.fn(() => {
      throw new Error("SYNTHETIC_SHORTEN_FAILURE");
    });
    const h = await f039Main({
      append: (record) => sink.append(record),
      get latched() {
        return sink.latched;
      },
      latch: () => {
        sink.latch();
      },
      close: (deadline) => sink.close(deadline),
      onLatch: (listener) => sink.onLatch?.(listener),
      shortenDeadline,
    });
    try {
      const closing = observed(h.handle!.close());
      await vi.advanceTimersByTimeAsync(250);
      expect(closing).toEqual({ settled: true, value: undefined });
      expect(shortenDeadline).toHaveBeenCalledTimes(1);
      expect(sink.latched).toBe(true);
      expect(h.err.writes).toContain(gateModule.OUTCOME_UNRECORDED_DIAGNOSTIC);
      expect(h.ports.exits).toEqual([{ code: 0, at: 250 }]);
      await h.handle!.close();
      expect(shortenDeadline).toHaveBeenCalledTimes(1);
    } finally {
      h.restore();
    }
  });

  it.each(
    F039_SIGNALS.flatMap((signal) =>
      [false, true].map((rejects) => ({ signal, rejects })),
    ),
  )(
    "TestBR070_v5_AC09_idle_stdio_exit_bound_is_unchanged [$signal releaseRejects=$rejects]",
    async ({ signal, rejects }) => {
      vi.useFakeTimers();
      const order: string[] = [],
        s = f039Sink("release", order, rejects);
      const h = await f039Main(await s.sink, { order });
      try {
        h.signal(signal);
        await vi.advanceTimersByTimeAsync(999);
        if (!rejects) expect(h.ports.exits).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.ports.exits).toHaveLength(1);
        expect(h.ports.exits[0]?.code).toBe(0);
        expect(h.ports.exits[0]?.at).toBeLessThanOrEqual(1000);
        expect(order.indexOf("sink-close")).toBeLessThan(
          order.indexOf("gate-close"),
        );
        expect(s.releaseCalls()).toBe(1);
        expect(observed(h.gate.close()).error).toBeUndefined();
      } finally {
        h.restore();
      }
    },
  );

  const deniedRows = F039_SIGNALS.flatMap((signal) =>
    ["stderr", "write", "sync", "release", "positive-flush"].map((kind) => ({
      signal,
      kind,
    })),
  );
  it.each(deniedRows)(
    "TestBR070_v5_AC13_denied_append_shares_remaining_stdio_shutdown_budget [$signal $kind]",
    async ({ signal, kind }) => {
      vi.useFakeTimers();
      const sinkKind =
        kind === "positive-flush" || kind === "release"
          ? "sync"
          : (kind as "stderr" | "write" | "sync" | "release");
      const s = f039Sink(sinkKind),
        h = await f039Main(await s.sink, { transportMs: 200 });
      try {
        const result = await h.wireMutation(true);
        await vi.advanceTimersByTimeAsync(100);
        h.signal(signal);
        await vi.advanceTimersByTimeAsync(200);
        if (kind === "release" || kind === "positive-flush") {
          // Acknowledge at 400ms, leaving 700ms for release and flush.
          await vi.advanceTimersByTimeAsync(100);
          s.unblock();
          await microtasks();
          if (kind === "positive-flush") {
            await vi.advanceTimersByTimeAsync(600);
            s.releases[0]?.();
            await microtasks();
          }
        }
        // A repeated signal cannot extend either shutdown deadline.
        if (signal !== "EOF") h.signal(signal);
        await vi.advanceTimersByTimeAsync(1099 - performance.now());
        expect(h.ports.exits).toEqual([]);
        if (!["release", "positive-flush"].includes(kind))
          expect(result.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(result.value).toEqual({
          result: "denied",
          op: OP,
          code: "ACCESS_DENIED",
          attempts: 0,
        });
        expect(s.records.map((record) => record.event)).toEqual(["denied"]);
        expect(h.ports.exits).toEqual([{ code: 0, at: 1100 }]);
        const diagnostics = h.err.writes.filter(
          (text) => text === gateModule.OUTCOME_UNRECORDED_DIAGNOSTIC,
        );
        expect(diagnostics).toHaveLength(kind === "positive-flush" ? 0 : 1);
        if (kind === "write" || kind === "sync")
          expect(s.releaseCalls()).toBe(0);
        // Destroyed stdout is already complete; stderr's flush proves shared-helper routing.
        if (kind === "positive-flush") expect(h.err.callbacks).toHaveLength(1);
        s.unblock();
        s.releases[0]?.();
        await vi.advanceTimersByTimeAsync(5000);
        expect(h.ports.exits).toHaveLength(1);
        expect(h.frames.filter((frame) => frame.id === 39)).toEqual([]);
      } finally {
        h.restore();
      }
    },
  );

  it.each(["healthy", "output-failed", "start-failed"] as const)(
    "TestBR070_v5_AC13_denied_append_shares_remaining_stdio_shutdown_budget [owned %s]",
    async (row) => {
      vi.useFakeTimers();
      const s = f039Sink("stderr");
      s.unblock();
      const h = await f039Main(await s.sink, {
        owned: true,
        startFailure: row === "start-failed",
      });
      try {
        if (row === "output-failed")
          h.out.emit("error", new Error("SYNTHETIC_OUTPUT_FAILURE"));
        else h.signal("EOF");
        await vi.advanceTimersByTimeAsync(1000);
        const closed = observed(h.handle?.close() ?? Promise.resolve());
        await microtasks();
        expect(closed).toEqual({ settled: true, value: undefined });
        expect(h.ports.exits).toEqual([]);
        expect(process.exitCode).toBeUndefined();
        expect(h.setExitCode.mock.calls).toEqual(
          row === "healthy" ? [] : [[1]],
        );
        expect(h.err.callbacks).toHaveLength(0);
      } finally {
        h.restore();
      }
    },
  );

  it.each(["output-failed", "start-failed"] as const)(
    "TestBR070_v5_AC13_denied_append_shares_remaining_stdio_shutdown_budget [dedicated %s code1]",
    async (row) => {
      vi.useFakeTimers();
      const s = f039Sink("stderr");
      s.unblock();
      const h = await f039Main(await s.sink, {
        startFailure: row === "start-failed",
      });
      try {
        if (row === "output-failed")
          h.out.emit("error", new Error("SYNTHETIC_OUTPUT_FAILURE"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.err.writes).toContain(
          row === "output-failed"
            ? "STDIO_OUTPUT_FAILED\n"
            : "STDIO_START_FAILED\n",
        );
        expect(h.ports.exits).toHaveLength(1);
        expect(h.ports.exits[0]?.code).toBe(1);
        expect(h.err.callbacks).toHaveLength(1);
      } finally {
        h.restore();
      }
    },
  );
});

const F039_OUTCOME_ROWS = [
  ...F039_SIGNALS.flatMap((signal) =>
    [false, true].map((rejects) => ({ transport: "stdio", signal, rejects })),
  ),
  ...(["SIGINT", "SIGTERM"] as const).flatMap((signal) =>
    [false, true].map((rejects) => ({ transport: "http", signal, rejects })),
  ),
];
describe("F-039 production shutdown ordering", () => {
  it.each(F039_OUTCOME_ROWS)(
    "TestBR254_v2_AC09_stdio_and_HTTP_shutdown_do_not_wait_for_stderr [$transport $signal releaseRejects=$rejects]",
    async ({ transport, signal, rejects }) => {
      vi.useFakeTimers();
      const order: string[] = [];
      const s = f039Sink(rejects ? "sync" : "stderr", order, rejects);
      const h = await f039Main(await s.sink, {
        http: transport === "http",
        order,
      });
      try {
        let wire: ReturnType<typeof observed<Response>> | undefined;
        let result: ReturnType<typeof observed<GateResult>> | undefined;
        if (transport === "http") {
          const send = (body: unknown, session?: string) =>
            h.handler!.handle(
              new Request("http://127.0.0.1:3000/", {
                method: "POST",
                headers: {
                  host: "127.0.0.1:3000",
                  accept: "application/json, text/event-stream",
                  "content-type": "application/json",
                  ...(session
                    ? {
                        "mcp-session-id": session,
                        "mcp-protocol-version": "2025-06-18",
                      }
                    : {}),
                },
                body: JSON.stringify(body),
              }),
              "/",
              "127.0.0.1",
            );
          const init = await send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "f039", version: "1" },
            },
          });
          const session = init.headers.get("mcp-session-id") ?? "";
          await init.text();
          await (
            await send(
              { jsonrpc: "2.0", method: "notifications/initialized" },
              session,
            )
          ).text();
          hooks.operation = {
            kind: "rename",
            target: { driveId: 7, id: 3 },
            name: "b",
          };
          wire = observed(
            send(
              {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: { name: "test_mutate", arguments: {} },
              },
              session,
            ),
          );
        } else result = await h.wireMutation();
        await microtasks();
        // Acknowledge intent only, then hold outcome's stderr callback or file sync.
        s.callbacks[0]?.();
        s.portOperations[0]?.();
        await microtasks();
        expect(s.records.map((record) => record.event)).toEqual([
          "intent",
          "outcome",
        ]);
        h.signal(signal);
        await vi.advanceTimersByTimeAsync(0);
        if (wire) {
          expect(wire.value?.status).toBe(503);
          await wire.value?.text();
        }
        expect(h.ports.exits).toEqual([]);
        await vi.advanceTimersByTimeAsync(5000);
        if (result)
          expect(result.value).toEqual({
            result: "succeeded",
            op: OP,
            attempts: 1,
            status: 200,
            value: { id: 42 },
            audit: "outcome_unrecorded",
          });
        if (rejects) {
          s.portOperations.at(-1)?.();
          await microtasks();
        }
        await vi.advanceTimersByTimeAsync(250);
        expect(h.ports.exits).toHaveLength(1);
        expect(h.ports.exits[0]?.code).toBe(0);
        expect(order.filter((step) => step !== "release")).toEqual([
          "transport-close",
          "outcome-failure",
          "sink-close",
          "gate-close",
          "exit",
        ]);
        // A rejecting release is contained: gate close resolves and the real helper is reached.
        const closing = observed(h.gate.close());
        await microtasks();
        expect(closing).toEqual({ settled: true, value: undefined });
        expect(h.err.callbacks.length).toBeGreaterThanOrEqual(1);
        if (transport === "stdio")
          expect(h.frames.filter((frame) => frame.id === 39)).toEqual([]);
      } finally {
        h.restore();
      }
    },
  );
});

// F-041 AC-09: BR-257 still refuses after fresh received-share evidence.
describe("F-041 received-share controls", () => {
  it.each(
    ["write", "share"].flatMap((mode) =>
      ["trash", "rename", "move"].map((kind) => ({ mode, kind })),
    ),
  )(
    "TestBR278_v2_AC09_received_share_refused_without_root_reads $mode $kind",
    async ({ mode, kind }) => {
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
        KDRIVE_MCP_MODE: mode,
        KDRIVE_MCP_ROOTS: "101:1,101:40",
        KDRIVE_MCP_SHARED_WITH_ME: "1",
        KDRIVE_MCP_SHARED_WRITE: "1",
      });
      const adapter = await adapterFor(f);
      const m = memory();
      const mutator = vi.fn<Mutator>(() => Promise.resolve(ok()));
      const gate = gateFor(m.sink, {
        trash: mutator,
        rename: mutator,
        move: mutator,
      });
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
      const start = f.apiRequests().length;
      const result = await c.mutate(
        `kdrive_${kind}`,
        {
          kind,
          target: { driveId: OWNER, id: 500 },
          ...(kind === "rename" ? { name: "x" } : {}),
          ...(kind === "move"
            ? { destination: { driveId: DRIVE, id: 1 } }
            : {}),
        },
        { kind: "stdio" },
      );
      expect(shared()).toBeGreaterThan(afterRead);
      expect(result).toEqual({
        ok: true,
        value: { result: "denied", op: OP, code: "ACCESS_DENIED", attempts: 0 },
      });
      expect(m.records().map((r) => r.event)).toEqual(["denied"]);
      expect(mutator).not.toHaveBeenCalled();
      expect(
        f
          .apiRequests()
          .slice(start)
          .filter((r) => r.path === "/3/drive/101/files/40"),
      ).toEqual([]);
      // Move may inspect its destination; that is not a root-ancestry read.
      expect(
        f
          .apiRequests()
          .slice(start)
          .filter((r) => r.path === "/3/drive/101/files/1"),
      ).toHaveLength(kind === "move" ? 1 : 0);
      expect(
        f
          .apiRequests()
          .slice(start)
          .filter((r) => r.method !== "GET"),
      ).toEqual([]);
      c.close();
      await gate.close();
    },
  );
});

// F-054: unchanged BR-254 drain coverage from F-016 AC-21.
function f054HealthyFile(order: string[]) {
  const records: auditModule.AuditRecord[] = [];
  return auditModule
    .openFileSink("/synthetic/f054-audit", {
      port: {
        open: () => Promise.resolve(3),
        fstat: () =>
          Promise.resolve({ isFile: () => true, uid: 1000, mode: 0o100600 }),
        geteuid: () => 1000,
        write: (_fd, bytes) => {
          const record = JSON.parse(
            Buffer.from(bytes).toString(),
          ) as auditModule.AuditRecord;
          records.push(record);
          order.push(records.length === 1 ? "intent" : "outcome");
          return Promise.resolve(bytes.length);
        },
        fdatasync: () => Promise.resolve(),
        close: () => {
          order.push("sink-close");
          return Promise.resolve();
        },
      },
    })
    .then((sink) => ({ sink, records }));
}
function f054TimedMutation(order: string[]) {
  let dispatch!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    dispatch = resolve;
  });
  const mutator = vi.fn<Mutator>(
    () =>
      new Promise((resolve) => {
        dispatch();
        setTimeout(() => {
          order.push("mutator-success");
          resolve(ok(200, { value: { id: 42 } }));
        }, 3000);
      }),
  );
  return { mutator, dispatched };
}
it("TestBR254_unchanged_F016_AC21_AC01_dedicated_SIGTERM_drains_3000ms_mutation", async () => {
  vi.useFakeTimers();
  const order: string[] = [],
    file = await f054HealthyFile(order);
  const mutation = f054TimedMutation(order),
    exits: number[] = [];
  const h = await f039Main(file.sink, {
    order,
    mutator: mutation.mutator,
    exit: (code) => {
      exits.push(code);
      order.push(`exit-${String(code)}`);
    },
  });
  try {
    const run = await h.wireMutation();
    await mutation.dispatched;
    expect(h.gate.hasCommitted).toBe(true);
    h.signal("SIGTERM");
    await vi.advanceTimersByTimeAsync(1000);
    expect(exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await microtasks();
    expect(
      order.filter((s) =>
        ["mutator-success", "outcome", "sink-close", "exit-0"].includes(s),
      ),
    ).toEqual(["mutator-success", "outcome", "sink-close", "exit-0"]);
    expect(exits).toEqual([0]);
    expect(mutation.mutator).toHaveBeenCalledTimes(1);
    expect(file.records).toHaveLength(2);
    expect(run.value).toMatchObject({ result: "succeeded", attempts: 1 });
  } finally {
    h.restore();
  }
});
it("TestBR254_unchanged_F016_AC21_AC02_owned_SIGTERM_drains_3000ms_mutation", async () => {
  const f = await kdriveFixture();
  const order: string[] = [],
    file = await f054HealthyFile(order);
  const sinkSpy = vi
    .spyOn(auditModule, "openAuditSink")
    .mockResolvedValue(file.sink);
  const setter = vi.fn();
  const mutation = f054TimedMutation(order);
  let run: Awaited<ReturnType<typeof runMain>> | undefined;
  try {
    run = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: "101",
        KDRIVE_TOKEN_FILE: tokenFile(),
        KDRIVE_MCP_MODE: "write",
      },
      lookup: f.lookup,
      connect: f.connect,
      mutators: { rename: mutation.mutator },
      setExitCode: setter,
    });
    const client = await stdioClient(run);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    hooks.operation = {
      kind: "rename",
      target: { driveId: 101, id: 12 },
      name: "b",
    };
    observed(client.callTool({ name: "test_mutate", arguments: {} }));
    await mutation.dispatched;
    run.signals.emit("SIGTERM");
    const closed = observed((run.handle as { close(): Promise<void> }).close());
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(closed.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await microtasks();
    expect(closed).toEqual({ settled: true, value: undefined });
    expect(order).toEqual([
      "intent",
      "mutator-success",
      "outcome",
      "sink-close",
    ]);
    expect(file.records).toHaveLength(2);
    expect(mutation.mutator).toHaveBeenCalledTimes(1);
    expect(run.exits).toEqual([]);
    expect(setter).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    sinkSpy.mockRestore();
    await f.close();
  }
});

// BR-254 v3: rejecting ports are synthetic; real transport and mutation gate retain ownership.
const F054_CLOSE_ROWS = [
  "signal-server",
  "signal-gate",
  "signal-diagnostic-throws",
  "gate-first",
  "expiry",
  "expiry-committed",
  "reject-without-onclose",
  "expiry-without-onclose",
  "expiry-without-onclose-committed",
  "eof",
  "failure",
  "sdk-close",
  "start-failure",
  "host-close",
  "earlier-stderr",
] as const;
it.each(
  [false, true].flatMap((owned) =>
    F054_CLOSE_ROWS.filter((row) => owned || row !== "earlier-stderr").flatMap(
      (row) =>
        (["SIGINT", "SIGTERM"] as const).map((signal) => ({
          owned,
          row,
          signal,
        })),
    ),
  ),
)(
  "TestBR254_v3_AC04_stdio_signal_close_rejection_is_contained [$owned $row $signal]",
  async ({ owned, row, signal }) => {
    vi.useFakeTimers();
    const order: string[] = [],
      file = await f054HealthyFile(order);
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const mutation = f054TimedMutation(order);
    const realGate = f039Gate(file.sink, mutation.mutator);
    let gateCalls = 0;
    const target = realGate.gate;
    // The real gate is frozen: proxy an empty delegate so `close` can be replaced.
    const gate = new Proxy(Object.create(target) as typeof target, {
      get(_delegate, key) {
        if (key === "close") {
          return async (deadline?: number) => {
            gateCalls++;
            order.push("gate-close-start");
            await target.close(deadline);
            order.push("gate-close-done");
            if (row === "signal-gate") throw Error("PRIVATE_CLOSE_CANARY");
          };
        }
        return Reflect.get(target, key, target) as unknown;
      },
    });
    const ports = processPorts(new PassThrough());
    const output = ports.stdout as PassThrough;
    let stdout = "";
    output.on("data", (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    const before = new Map(
      ["SIGINT", "SIGTERM"].map((name) => [name, process.listeners(name)]),
    );
    const diagnostics: string[] = [],
      exits: number[] = [],
      statuses: number[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const sdkInstances: StdioServerTransport[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The original is invoked with the synthetic SDK instance through call().
    const sdkStart = StdioServerTransport.prototype.start;
    const startSpy = vi
      .spyOn(StdioServerTransport.prototype, "start")
      .mockImplementation(function (this: StdioServerTransport) {
        sdkInstances.push(this);
        if (row === "start-failure")
          return Promise.reject(Error("PRIVATE_START_CANARY"));
        return sdkStart.call(this);
      });
    const sdkClose = vi
      .spyOn(StdioServerTransport.prototype, "close")
      .mockRejectedValue(Error("PRIVATE_SDK_CANARY"));
    let rejectServer!: (reason: unknown) => void;
    const serverPending = new Promise<void>((_resolve, reject) => {
      rejectServer = reject;
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The original is invoked with the synthetic server instance through call().
    const serverOriginal = McpServer.prototype.close;
    const serverSpy = vi
      .spyOn(McpServer.prototype, "close")
      .mockImplementation(async function (this: McpServer) {
        if (row === "earlier-stderr" || row === "signal-gate") {
          sdkClose.mockResolvedValue(undefined);
          return serverOriginal.call(this);
        }
        if (!row.includes("without-onclose")) {
          // Observe the original transport close; the SDK failure is consumed here only
          // for server-port rows. EOF/failure/SDK-close rows exercise the transport's own void sites.
          await serverOriginal.call(this).catch(() => {});
        }
        if (row === "gate-first" || row.startsWith("expiry"))
          return serverPending;
        throw Error("PRIVATE_SERVER_CANARY");
      });
    let started: ReturnType<typeof startStdioNavigation> | undefined;
    try {
      if (row === "earlier-stderr") {
        expect(() =>
          ports.stderr.emit(
            "error",
            Object.assign(Error("PRIVATE_STDERR_CANARY"), { code: "EIO" }),
          ),
        ).not.toThrow();
      }
      started = startStdioNavigation(
        f.config,
        gatedDependencies(f.dependencies, gate),
        {
          ...(owned ? { input: ports.input, output } : {}),
          gate,
          diagnostic: (text) => {
            diagnostics.push(text);
            if (row === "signal-diagnostic-throws")
              throw Error("PRIVATE_DIAGNOSTIC_CANARY");
          },
          setExitCode: (code) => {
            statuses.push(code);
          },
          exit: (code) => {
            exits.push(code);
            order.push(`exit-${String(code)}`);
          },
        },
      );
      const ready = observed(started.ready);
      await microtasks();
      const committed = row === "eof" || row.includes("committed");
      if (committed) {
        observed(realGate.run());
        await mutation.dispatched;
      }
      function triggerClose(session: ReturnType<typeof startStdioNavigation>) {
        if (row === "eof") ports.input.end();
        else if (row === "failure")
          ports.input.emit("error", Error("PRIVATE_INPUT_CANARY"));
        else if (row === "sdk-close") sdkInstances[0]!.onclose?.();
        else if (row === "host-close") observed(session.close());
        else if (row !== "start-failure") {
          const listeners = process
            .listeners(signal)
            .filter((fn) => !before.get(signal)?.includes(fn));
          expect(listeners).toHaveLength(1);
          for (const listener of listeners) {
            listener(signal);
            listener(signal);
          }
        }
      }
      triggerClose(started);
      const closed = observed(started.closed);
      await microtasks();
      async function verifyGateFirst() {
        if (row === "gate-first") {
          expect(order).toContain("gate-close-done");
          expect(closed.settled).toBe(false);
          expect(exits).toEqual([]);
          rejectServer(Error("PRIVATE_LATE_CANARY"));
          await microtasks();
        }
      }
      async function verifyExpiry() {
        if (row.startsWith("expiry")) {
          const deadline = committed ? 45000 : 1000;
          await vi.advanceTimersByTimeAsync(deadline - 1);
          expect(closed.settled).toBe(false);
          expect(exits).toEqual([]);
          // AC-04: gate/sink drain completes before the deadline and before exit.
          expect(order).toContain("sink-close");
          await vi.advanceTimersByTimeAsync(1);
          await microtasks();
          expect(closed.settled).toBe(true);
          if (order.includes("exit-1"))
            expect(order.indexOf("sink-close")).toBeLessThan(
              order.indexOf("exit-1"),
            );
          rejectServer(Error("PRIVATE_AFTER_EXPIRY_CANARY"));
          await microtasks();
        }
      }
      async function verifyEofDrain() {
        if (row === "eof") {
          await vi.advanceTimersByTimeAsync(1000);
          expect(closed.settled).toBe(false);
          expect(exits).toEqual([]);
          await vi.advanceTimersByTimeAsync(1999);
          expect(closed.settled).toBe(false);
          await vi.advanceTimersByTimeAsync(1);
          await microtasks();
          expect(
            order.filter((text) =>
              ["mutator-success", "outcome", "sink-close"].includes(text),
            ),
          ).toEqual(["mutator-success", "outcome", "sink-close"]);
          expect(file.records).toHaveLength(2);
        }
      }
      await verifyGateFirst();
      await verifyExpiry();
      await verifyEofDrain();
      expect(closed).toEqual({ settled: true, value: undefined });
      expect(ready).toEqual({ settled: true, value: undefined });
      await expect(started.close()).resolves.toBeUndefined();
      expect(gateCalls).toBe(1);
      expect(order).toContain("sink-close");
      expect(owned ? statuses : exits).toEqual(
        row === "earlier-stderr" ? [] : [1],
      );
      if (owned) expect(exits).toEqual([]);
      expect(
        diagnostics.filter((text) => text === "PROCESS_CLOSE_FAILED\n"),
      ).toHaveLength(row === "earlier-stderr" ? 0 : 1);
      expect(diagnostics.join("") + stdout).not.toContain("PRIVATE_");
      expect(stdout).toBe("");
      expect(unhandled).toEqual([]);
      for (const name of ["SIGINT", "SIGTERM"])
        expect(process.listeners(name)).toEqual(before.get(name));
    } finally {
      for (const name of ["SIGINT", "SIGTERM"])
        for (const listener of process.listeners(name))
          if (!before.get(name)?.includes(listener))
            process.off(name, listener);
      process.off("unhandledRejection", onUnhandled);
      serverSpy.mockRestore();
      sdkClose.mockRestore();
      startSpy.mockRestore();
      ports.restore();
    }
  },
);

// BR-254 v3 / BR-447 v1 / BR-448 v1: IPC orders real OS pipe failure and committed drain.
it.each(["broken", "healthy"] as const)(
  "TestBR254_v3_TestBR447_TestBR448_AC10_pending_stdout_pipe_drain [%s]",
  async (row) => {
    const { lifecycleChild } = await import("./helpers/f054-child.js");
    const child = lifecycleChild("stdout");
    try {
      await child.wait("ready");
      await child.wait("committed");
      child.write({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "f054", version: "1" },
        },
      });
      // An explicit initialization response barrier precedes pausing the pipe.
      const initialized = new Promise<void>((resolve) => {
        const inspect = () => {
          if (child.stdout().includes('"id":0')) {
            child.process.stdout!.off("data", inspect);
            resolve();
          }
        };
        child.process.stdout!.on("data", inspect);
        inspect();
      });
      await initialized;
      child.write({ jsonrpc: "2.0", method: "notifications/initialized" });
      const prefix = Buffer.byteLength(child.stdout());
      child.process.stdout!.pause();
      child.write({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "synthetic_large_result", arguments: {} },
      });
      const pending = await child.wait("pending-frame");
      expect(pending.bytes).toBe(262144);
      expect(pending.returned).toBe(false);
      expect(pending.writableLength).toBeGreaterThan(0);
      child.process.kill("SIGTERM");
      await child.wait("transport-closed-draining");
      if (row === "broken") {
        child.process.stdout!.destroy();
        await child.wait("write-callback-error");
        await child.wait("contained-EPIPE-draining");
      } else {
        const received = new Promise<void>((resolve) => {
          const inspect = () => {
            if (Buffer.byteLength(child.stdout()) - prefix === 262144) {
              child.process.stdout!.off("data", inspect);
              resolve();
            }
          };
          child.process.stdout!.on("data", inspect);
          inspect();
        });
        child.process.stdout!.resume();
        await Promise.all([received, child.wait("write-callback-no-error")]);
        expect(Buffer.byteLength(child.stdout()) - prefix).toBe(262144);
      }
      expect(child.process.exitCode).toBeNull();
      expect(
        child.messages.some((message) => message.event === "outcome"),
      ).toBe(false);
      child.send("release-mutator");
      await child.wait("mutator-success");
      const outcome = await child.wait("outcome");
      await child.wait("sink-close");
      expect(outcome.records).toHaveLength(2);
      expect(outcome.records?.[1]).toMatchObject({
        result: "succeeded",
        attempts: 1,
      });
      expect(await child.exited).toEqual({
        code: row === "broken" ? 1 : 0,
        signal: null,
      });
      const events = child.messages.map((message) => message.event);
      const milestones = [
        "intent",
        "committed",
        "pending-frame",
        "transport-closed-draining",
        ...(row === "broken"
          ? ["write-callback-error", "contained-EPIPE-draining"]
          : ["write-callback-no-error"]),
        "mutator-success",
        "outcome",
        "sink-close",
      ];
      expect(events.filter((event) => milestones.includes(event))).toEqual(
        milestones,
      );
      // A timeout/transport failure would test the old path, so it is always a harness failure.
      expect(
        child.stderr(),
        "Harness timing failure: per-frame deadline expired",
      ).not.toContain("STDIO_OUTPUT_FAILED");
      expect(child.stderr()).not.toMatch(/uncaught|unhandled|Error:|at .*\(/iu);
    } finally {
      child.dispose();
    }
  },
  15000,
);

// BR-254 v3 / BR-447 v1 / BR-448 v1: a late protocol callback must survive transport close.
it.each(["EPIPE", "EIO", "EPIPE-with-close-failure"] as const)(
  "TestBR254_v3_TestBR447_TestBR448_AC09_stdout_failure_during_drain [%s]",
  async (row) => {
    vi.useFakeTimers();
    hooks.largeResult = true;
    const output = new ProcessOutput();
    for (let session = 0; session < 2; session++) {
      output.holdFrames = false;
      const order: string[] = [],
        file = await f054HealthyFile(order);
      const mutation = f054TimedMutation(order),
        exits: number[] = [];
      const h = await f039Main(file.sink, {
        output,
        order,
        mutator: mutation.mutator,
        exit: (code) => {
          exits.push(code);
          order.push(`exit-${String(code)}`);
        },
      });
      let closeSpy: { mockRestore(): void } | undefined;
      try {
        const run = await h.wireMutation();
        await mutation.dispatched;
        expect(h.gate.hasCommitted).toBe(true);
        output.holdFrames = true;
        h.ports.input.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "synthetic_large_result", arguments: {} } })}\n`,
        );
        await vi.advanceTimersByTimeAsync(0);
        await microtasks();
        const frame = output.frames.at(-1)!;
        expect(Buffer.byteLength(frame)).toBe(262144);
        expect(Buffer.byteLength(frame)).toBeLessThan(1048576);
        expect(JSON.parse(frame)).toMatchObject({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "x".repeat(262070) }] },
        });
        expect(output.writableLength).toBe(262144);
        if (row === "EPIPE-with-close-failure") {
          const server = lastServer(),
            original = server.close.bind(server);
          closeSpy = vi.spyOn(server, "close").mockImplementation(async () => {
            await original();
            throw Error("PRIVATE_CLOSE_CANARY");
          });
        }
        h.signal("SIGTERM");
        await microtasks();
        expect(exits).toEqual([]);
        expect(output.closes).toBeGreaterThan(0);
        expect(output.listenerCount("error")).toBe(1);
        const failure = Object.assign(Error("PRIVATE_PROTOCOL_CANARY"), {
          code: row === "EIO" ? "EIO" : "EPIPE",
        });
        output.frameCallbacks.at(-1)!(failure);
        expect(() => output.emit("error", failure)).not.toThrow();
        await vi.advanceTimersByTimeAsync(1000);
        expect(exits).toEqual([]);
        await vi.advanceTimersByTimeAsync(1999);
        expect(exits).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await microtasks();
        expect(exits).toEqual([1]);
        expect(
          order.filter((event) =>
            ["mutator-success", "outcome", "sink-close", "exit-1"].includes(
              event,
            ),
          ),
        ).toEqual(["mutator-success", "outcome", "sink-close", "exit-1"]);
        expect(file.records).toHaveLength(2);
        expect(run.value).toMatchObject({ result: "succeeded", attempts: 1 });
        expect(mutation.mutator).toHaveBeenCalledTimes(1);
        expect(h.err.writes.join("")).not.toMatch(
          /STDIO_OUTPUT_FAILED|PRIVATE_/u,
        );
        expect(output.listenerCount("error")).toBe(1);
      } finally {
        closeSpy?.mockRestore();
        h.restore();
      }
    }
    expect(output.listenerCount("error")).toBe(1);
    // Exactly one large protocol frame per session: the failed callback is never retried.
    expect(
      output.frames.filter((frame) => Buffer.byteLength(frame) === 262144),
    ).toHaveLength(2);
  },
);

// F-014 AC-20 (BR-210): HTTP composition through in-process main(deps).
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kdriveFixture } from "../helpers/kdrive.js";
import { httpClient, runMain, textOf, tokenFile } from "../helpers/main.js";
import { listeningPort, P } from "../helpers/http.js";
import {
  warningEnvironment,
  warningFixture,
  warningLine,
} from "../helpers/deny-root-warning.js";
import {
  CLAUDE,
  UPSTREAM,
  UPSTREAM_CLIENT,
  syntheticPem,
} from "../helpers/proxy.js";

const upstreamSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../src/auth/proxy/index.js", async (original) => {
  const actual =
    await original<typeof import("../../src/auth/proxy/index.js")>();
  return {
    ...actual,
    createFetchUpstream: (
      options: Parameters<typeof actual.createFetchUpstream>[0],
    ) => {
      upstreamSpy.calls++;
      return actual.createFetchUpstream(options);
    },
  };
});

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

// F-048 BR-435 v1: the real common main path precedes the HTTP listener.
it.each([false, true])(
  "TestBR435_http_startup_warning_lifecycle throwing=%s",
  async (throws) => {
    const f = (fixture = await warningFixture());
    f.drive.nodes = f.drive.nodes.map((node) =>
      node.id === 42 ? { ...node, name: "SYNTHETIC_ROOT_CANARY" } : node,
    );
    const http = await import("../../src/http/index.js");
    const activation = vi.spyOn(http, "startHttpServer");
    const port = await listeningPort();
    const offered: string[] = [];
    let run: Awaited<ReturnType<typeof runMain>> | undefined;
    try {
      run = await runMain({
        argv: ["--http", "--insecure-no-auth"],
        env: {
          ...warningEnvironment(
            "/Mismatch/SYNTHETIC_PATTERN_CANARY/**,/Private/SYNTHETIC_ROOT_CANARY/**,/Elsewhere/**",
          ),
          KDRIVE_MCP_ROOTS: "7:/Private/SYNTHETIC_ROOT_CANARY",
          MCP_HTTP_PORT: String(port),
        },
        lookup: f.lookup,
        connect: f.connect,
        onStderrWrite: (line) => {
          if (!line.includes("deny_pattern_root_warning")) return;
          expect(activation).not.toHaveBeenCalled();
          expect(f.apiRequests()).toHaveLength(3);
          offered.push(line);
          if (throws) throw new Error("SYNTHETIC_WRITER_CANARY");
        },
      });
      expect(offered).toEqual([warningLine(0), warningLine(2)]);
      expect(run.stderr()).toBe(throws ? "" : warningLine(0) + warningLine(2));
      expect(run.stdout()).toBe("");
      expect(run.exits).toEqual([]);
      expect(activation).toHaveBeenCalledTimes(1);
      const configuration = activation.mock.calls.at(0)?.[0].configuration;
      const { isResolvedConfiguration } = await import("../../src/config.js");
      expect(isResolvedConfiguration(configuration)).toBe(true);
      expect(configuration).not.toHaveProperty("diagnosticRootPaths");
      expect(configuration?.resolvedRoots).toEqual([
        { driveId: 7, folderId: 42 },
      ]);
      for (let session = 0; session < 2; session++) {
        const client = await httpClient(port);
        try {
          await client.listTools();
          const info = await client.callTool({
            name: "kdrive_info",
            arguments: { drive_id: 7, file_id: 43 },
          });
          expect(JSON.stringify(info)).not.toContain(
            "deny_pattern_root_warning",
          );
        } finally {
          await client.close();
        }
      }
      await (run.handle as { close(): Promise<void> }).close();
      expect(offered).toEqual([warningLine(0), warningLine(2)]);
      expect(run.stdout()).toBe("");
      const warningLines = run
        .stderr()
        .split("\n")
        .filter((line) => line.includes("deny_pattern_root_warning"));
      expect(warningLines).toEqual(
        throws ? [] : [warningLine(0).trimEnd(), warningLine(2).trimEnd()],
      );
    } finally {
      await (run?.handle as { close(): Promise<void> } | undefined)?.close();
      activation.mockRestore();
    }
  },
);

describe("BR-210 HTTP composition", () => {
  it.each(["SIGTERM", "SIGINT"])(
    "TestBR210_insecure_loopback_serves_kdrive_info_logs_JSON_lines_and_%s_exits_0",
    async (signal) => {
      const f = (fixture = await kdriveFixture());
      const port = await listeningPort();
      const run = await runMain({
        argv: ["--http", "--insecure-no-auth"],
        env: {
          KDRIVE_ID: "101",
          KDRIVE_TOKEN_FILE: tokenFile(),
          MCP_HTTP_PORT: String(port),
        },
        lookup: f.lookup,
        connect: f.connect,
      });
      expect(run.handle).toMatchObject({
        address: { address: "127.0.0.1", port },
      });
      const client = await httpClient(port);
      const info = textOf(
        await client.callTool({
          name: "kdrive_info",
          arguments: { drive_id: 101, file_id: 12 },
        }),
      );
      expect(info).toMatchObject({ ok: { item: { id: 12 } } });
      await client.close();
      const lines = run.stderr().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines)
        expect(JSON.parse(line)).toHaveProperty("event");
      expect(upstreamSpy.calls).toBe(0);
      run.signals.emit(signal);
      for (let i = 0; i < 2000 && run.exits.length === 0; i++)
        await new Promise((r) => setImmediate(r));
      expect(run.exits).toEqual([0]);
      await expect(
        fetch(`http://127.0.0.1:${String(port)}/mcp`),
      ).rejects.toThrow();
    },
  );

  it("TestBR210_proxy_mode_passes_createFetchUpstream_to_startHttpServer", async () => {
    const f = (fixture = await kdriveFixture());
    const directory = await mkdtemp(join(tmpdir(), "kdrive-proxy-"));
    await writeFile(join(directory, "upstream-secret"), "SYNTHETIC-SECRET\n");
    await writeFile(join(directory, "signing.pem"), syntheticPem());
    const port = await listeningPort();
    upstreamSpy.calls = 0;
    const run = await runMain({
      argv: ["--http"],
      env: {
        KDRIVE_ID: "101",
        KDRIVE_TOKEN_FILE: tokenFile(),
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_HTTP_PORT: String(port),
        MCP_PUBLIC_URL: P,
        OAUTH_MODE: "proxy",
        OAUTH_ISSUER: UPSTREAM,
        OAUTH_ALLOWED_SUBJECTS: "user-1",
        OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
        OAUTH_UPSTREAM_CLIENT_SECRET_FILE: join(directory, "upstream-secret"),
        OAUTH_SIGNING_KEY_FILE: join(directory, "signing.pem"),
        OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
      },
      lookup: f.lookup,
      connect: f.connect,
    });
    expect(run.stderr()).toBe("");
    expect(upstreamSpy.calls).toBe(1);
    run.signals.emit("SIGTERM");
    for (let i = 0; i < 2000 && run.exits.length === 0; i++)
      await new Promise((r) => setImmediate(r));
    expect(run.exits).toEqual([0]);
  });
});

// F-054 BR-210 v2 / BR-254 v3: main owns the real signal registration and shutdown result.
it.each(["SIGINT", "SIGTERM"].flatMap((signal) =>
  ["success", "transport", "gate", "diagnostic-throws"].map((row) => ({ signal, row })),
))("TestBR210_v2_AC03_signal_close_failure_is_fixed_exit1 [$signal $row]", async ({ signal, row }) => {
  const { main } = await import("../../src/main.js");
  const config = await import("../../src/config.js");
  const adapters = await import("../../src/kdrive/index.js");
  const audit = await import("../../src/audit/sink.js");
  const gates = await import("../../src/mutation-gate.js");
  const http = await import("../../src/http/index.js");
  const { navigationFixture } = await import("../helpers/navigation.js");
  const { deferred } = await import("../helpers/f040-admission.js");
  const { microtasks } = await import("../helpers/f039-composition.js");
  const { EventEmitter } = await import("node:events");
  const f = await navigationFixture({ KDRIVE_MCP_TRANSPORT: "http", KDRIVE_MCP_INSECURE_NO_AUTH: "1" });
  const signals = new EventEmitter(), order: string[] = [], errors: string[] = [], stdout: string[] = [], exits: number[] = [];
  const pending = deferred<void>(), gatePending = deferred<void>();
  const realAdapter = adapters.createKdriveAdapter;
  const realGate = gates.createMutationGate;
  const mocks = [
    vi.spyOn(config, "preflightConfiguration").mockResolvedValue(f.config),
    vi.spyOn(adapters, "createKdriveAdapter").mockImplementation((options) => {
      const adapter = realAdapter(options);
      return { ...adapter, dependencies: { ...adapter.dependencies, ...f.dependencies } };
    }),
    vi.spyOn(audit, "openAuditSink").mockResolvedValue(audit.createStderrSink({ write: (_text, callback) => { callback(); return true; } })),
    vi.spyOn(gates, "createMutationGate").mockImplementation((options) => {
      const gate = realGate(options);
      const target = gate;
      // The real gate is frozen: proxy an empty delegate so `close` can be replaced.
      return new Proxy(Object.create(target) as typeof target, { get(_delegate, key) {
        if (key === "close") return async () => {
          order.push("gate"); await gatePending.promise; await target.close();
          if (row === "gate") throw Error("PRIVATE_GATE_CANARY");
        };
        return Reflect.get(target, key, target) as unknown;
      } });
    }),
    vi.spyOn(http, "startHttpServer").mockResolvedValue({
      address: { address: "127.0.0.1", family: "IPv4", port: 3000 },
      close: async () => {
        order.push("transport"); await pending.promise;
        if (row === "transport" || row === "diagnostic-throws") throw Error("PRIVATE_TRANSPORT_CANARY");
      },
    }),
  ];
  const unhandled: unknown[] = [], onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", onUnhandled);
  try {
    await main({ argv: ["--http", "--insecure-no-auth"], env: { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC" },
      lookup: async () => [], connect: () => { throw Error("Unexpected network"); }, now: () => 0,
      signals: { on: (name, fn) => signals.on(name, fn), off: (name, fn) => signals.off(name, fn) },
      stdout: { write: (text) => { stdout.push(text); } },
      stderr: { write: (text) => { errors.push(text); if (row === "diagnostic-throws") throw Error("PRIVATE_DIAGNOSTIC_CANARY"); return true; } },
      exit: (code) => { exits.push(code); },
    });
    signals.emit(signal); signals.emit(signal);
    await microtasks();
    expect(order).toEqual(["transport"]);
    expect(exits).toEqual([]);
    pending.resolve(undefined); await microtasks();
    expect(order).toEqual(["transport", "gate"]);
    expect(exits).toEqual([]);
    gatePending.resolve(undefined); await microtasks();
    expect(exits).toEqual([row === "success" ? 0 : 1]);
    expect(errors).toEqual(row === "success" ? [] : ["PROCESS_CLOSE_FAILED\n"]);
    expect(stdout).toEqual([]);
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    expect(unhandled).toEqual([]);
  } finally { process.off("unhandledRejection", onUnhandled); for (const mock of mocks.toReversed()) mock.mockRestore(); }
});

// BR-447 v1 / BR-448 v1: production dependencies install owners before HTTP main entry.
it("TestBR447_TestBR448_AC06_HTTP_closed_stderr_SIGTERM_exit0", async () => {
  vi.useFakeTimers();
  const { main } = await import("../../src/main.js");
  const config = await import("../../src/config.js");
  const adapters = await import("../../src/kdrive/index.js");
  const audit = await import("../../src/audit/sink.js");
  const http = await import("../../src/http/index.js");
  const { navigationFixture } = await import("../helpers/navigation.js");
  const { FlushPort, processPorts, microtasks } = await import("../helpers/f039-composition.js");
  const { EventEmitter } = await import("node:events");
  const f = await navigationFixture({ KDRIVE_MCP_TRANSPORT: "http", KDRIVE_MCP_INSECURE_NO_AUTH: "1" });
  const out = new FlushPort(), err = new FlushPort(), signals = new EventEmitter();
  const ports = processPorts(out, err);
  let epipes = 0;
  err.onWrite = () => {
    queueMicrotask(() => {
      err.emit("error", Object.assign(Error("PRIVATE_HTTP_PIPE_CANARY"), { code: "EPIPE" })); epipes++;
    });
  };
  out.onWrite = (callback) => { callback(); };
  const originalAdapter = adapters.createKdriveAdapter;
  const mocks = [
    vi.spyOn(config, "preflightConfiguration").mockResolvedValue(f.config),
    vi.spyOn(adapters, "createKdriveAdapter").mockImplementation((options) => {
      const adapter = originalAdapter(options);
      return { ...adapter, dependencies: { ...adapter.dependencies, ...f.dependencies } };
    }),
    vi.spyOn(audit, "openAuditSink").mockResolvedValue(audit.createStderrSink({ write: (_text, callback) => { callback(); return true; } })),
    vi.spyOn(http, "startHttpServer").mockImplementation(async (options) => {
      expect(err.listenerCount("error")).toBe(1);
      expect(out.listenerCount("error")).toBe(1);
      options.logger?.event("listener_error", {});
      return { address: { address: "127.0.0.1", family: "IPv4", port: 3000 }, close: async () => {} };
    }),
  ];
  try {
    expect(err.listenerCount("error")).toBe(1);
    ports.dependencies.stderr.write("SYNTHETIC_DIAGNOSTIC\n");
    await main({ ...ports.dependencies, argv: ["--http", "--insecure-no-auth"],
      env: { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC" },
      signals: { on: (name, fn) => signals.on(name, fn), off: (name, fn) => signals.off(name, fn) },
    });
    await microtasks();
    expect(epipes).toBe(2);
    expect(err.writes).toEqual(["SYNTHETIC_DIAGNOSTIC\n", '{"event":"listener_error"}\n']);
    signals.emit("SIGTERM");
    await microtasks();
    await vi.advanceTimersByTimeAsync(250);
    expect(ports.exits.map((exit) => exit.code)).toEqual([0]);
    expect(err.writes.join("")).not.toContain("PRIVATE_");
    expect(out.writes).toEqual([""]);
    expect(err.listenerCount("error")).toBe(1);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  } finally { for (const mock of mocks.toReversed()) mock.mockRestore(); ports.restore(); vi.useRealTimers(); }
});

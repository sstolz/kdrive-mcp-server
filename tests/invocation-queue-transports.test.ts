// F-026: the invocation queue over the stdio and HTTP transports.
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStderrSink } from "../src/audit/sink.js";
import {
  createMutationGate,
  gatedDependencies,
  type Mutator,
} from "../src/mutation-gate.js";
import { startStdioNavigation } from "../src/stdio.js";
import { blockedDependencies, httpFixture } from "./helpers/http.js";
import { StreamClientTransport, textOf } from "./helpers/main.js";
import { navigationFixture } from "./helpers/navigation.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const step of cleanup.splice(0).reverse()) await step();
});

const info = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "kdrive_info", arguments: { file_id: 3 } },
});

/** A stdio session over owned streams whose stdout completes each write later. */
async function stdioSession(
  f: Awaited<ReturnType<typeof navigationFixture>>,
  writeDelay: number,
  options: { gate?: ReturnType<typeof createMutationGate> } = {},
  dependencies = f.dependencies,
) {
  const input = new PassThrough(),
    frames: string[] = [];
  let diagnostics = "";
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      setTimeout(() => {
        frames.push(...chunk.toString().split("\n").filter(Boolean));
        callback();
      }, writeDelay);
    },
  });
  const session = startStdioNavigation(f.config, dependencies, {
    input,
    output,
    signals: false,
    diagnostic: (message) => {
      diagnostics += message;
    },
    setExitCode: () => undefined,
    ...options,
  });
  await session.ready;
  cleanup.push(() => session.close());
  const responses = () =>
    frames.map((line) => JSON.parse(line) as Record<string, unknown>);
  const result = (id: number) =>
    responses().find((r) => r.id === id)?.result as
      { isError?: boolean; content: { text: string }[] } | undefined;
  return {
    send: (...messages: unknown[]) =>
      input.write(messages.map((m) => JSON.stringify(m) + "\n").join("")),
    responses,
    result,
    diagnostics: () => diagnostics,
  };
}

describe("F-026 queue over the transports", () => {
  it("TestBR380_stdio_parallel_reads_both_succeed", async () => {
    const f = await navigationFixture();
    const w = await createWire(f.config, f.dependencies);
    cleanup.push(() => w.session.close());
    const { Client } = await import("@modelcontextprotocol/client");
    const client = new Client({ name: "queue-test", version: "1" });
    await client.connect(new StreamClientTransport(w.input, w.output));
    cleanup.push(() => client.close());
    const [a, b] = await Promise.all([
      client.callTool({ name: "kdrive_info", arguments: { file_id: 3 } }),
      client.callTool({ name: "kdrive_info", arguments: { file_id: 3 } }),
    ]);
    expect(textOf(a)).toMatchObject({ ok: { item: { id: 3 } } });
    expect(textOf(b)).toMatchObject({ ok: { item: { id: 3 } } });
  });

  it("TestBR380_http_parallel_reads_in_one_session_both_succeed", async () => {
    const base = await navigationFixture();
    const { held, dependencies } = blockedDependencies(base.dependencies);
    const f = await httpFixture({ dependencies });
    cleanup.push(() => f.handler.close());
    const token = await f.mint();
    const session = await f.open(token);
    const first = f.call(token, session, "kdrive_info", { file_id: 3 }, 3);
    await vi.waitFor(() => {
      expect(held.entered()).toBe(1);
    });
    // The second call arrives while the first one holds the slot.
    const second = f.call(token, session, "kdrive_info", { file_id: 3 }, 4);
    await new Promise((r) => setTimeout(r, 20));
    expect(held.entered()).toBe(1);
    held.release();
    const [a, b] = await Promise.all([first, second]);
    expect(held.entered()).toBe(2);
    for (const response of [a, b]) {
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('"id\\":3');
      expect(text).not.toContain("SERVER_BUSY");
    }
  });

  it("TestBR380_http_sessions_have_separate_queues", async () => {
    const base = await navigationFixture();
    const { held, dependencies } = blockedDependencies(base.dependencies);
    const f = await httpFixture({ dependencies });
    cleanup.push(() => f.handler.close());
    const token = await f.mint();
    const one = await f.open(token),
      two = await f.open(token);
    // Each session holds a read that never answers until released.
    const heldOne = f.call(token, one, "kdrive_info", { file_id: 3 }, 3);
    const heldTwo = f.call(token, two, "kdrive_info", { file_id: 3 }, 3);
    await vi.waitFor(() => {
      expect(held.entered()).toBe(2);
    });
    // A third call on session two waits only behind session two's read.
    const queued = f.call(token, two, "kdrive_info", { file_id: 3 }, 4);
    await new Promise((r) => setTimeout(r, 20));
    expect(held.entered()).toBe(2);
    held.release();
    for (const response of await Promise.all([heldOne, heldTwo, queued])) {
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("SERVER_BUSY");
    }
    expect(held.entered()).toBe(3);
  });

  it("TestBR388_stdio_parallel_reads_with_synchronous_port_keep_session_open", async () => {
    const f = await navigationFixture();
    f.inspect.mockImplementation((ref) =>
      Promise.resolve(f.nodes.get(`${ref.driveId}:${ref.id}`)),
    );
    const s = await stdioSession(f, 5);
    s.send(initialize, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await vi.waitFor(() => {
      expect(s.result(1)).toBeDefined();
    });
    s.send(info(2), info(3));
    await vi.waitFor(() => {
      expect(s.result(3)).toBeDefined();
    });
    expect(s.result(2)?.isError).toBeUndefined();
    expect(s.result(3)?.isError).toBeUndefined();
    expect(s.diagnostics()).not.toContain("STDIO_OUTPUT_FAILED");
    s.send(info(4));
    await vi.waitFor(() => {
      expect(s.result(4)?.isError).toBeUndefined();
    });
  });

  it("TestBR382_TestBR388_two_stdio_waiters_time_out_together_session_stays_open", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const lines: string[] = [];
    const mutator = vi.fn<Mutator>(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({ outcome: "response", status: 200, accepted: true });
          }, 20_000),
        ),
    );
    const gate = createMutationGate({
      mode: "write",
      sink: createStderrSink({
        write(chunk, callback) {
          lines.push(chunk);
          callback();
          return true;
        },
      }),
      mutators: { rename: mutator },
      random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
      clock: () => new Date("2026-11-13T10:00:00.000Z"),
      now: () => performance.now(),
      diagnostic: () => undefined,
    });
    const s = await stdioSession(
      f,
      1,
      { gate },
      gatedDependencies(f.dependencies, gate),
    );
    s.send(initialize, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(s.result(1)).toBeDefined();
    s.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kdrive_rename", arguments: { file_id: 3, name: "b" } },
    });
    await vi.advanceTimersByTimeAsync(990);
    expect(mutator).toHaveBeenCalledTimes(1);
    const calls = f.inspect.mock.calls.length;
    s.send(info(3), info(4));
    await vi.advanceTimersByTimeAsync(11_999);
    expect(s.result(3)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(s.result(3)?.content[0]?.text).toBe("SERVER_BUSY");
    expect(s.result(4)?.content[0]?.text).toBe("SERVER_BUSY");
    expect(f.inspect.mock.calls).toHaveLength(calls);
    expect(s.diagnostics()).not.toContain("STDIO_OUTPUT_FAILED");
    await vi.advanceTimersByTimeAsync(7_100);
    expect(JSON.parse(s.result(2)?.content[0]?.text ?? "{}")).toMatchObject({
      result: "succeeded",
    });
    // Only the rename wrote its intent and outcome records.
    expect(lines).toHaveLength(2);
  });
});

import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { createOwnedStdioTransport } from "../src/stdio-transport.js";
import { startStdioNavigation } from "../src/stdio.js";
import { navigationFixture } from "./helpers/navigation.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";
afterEach(() => vi.restoreAllMocks());

it("BR-069 review1 R1 BOM-prefixed JSON receives fixed parse error before valid followup", async () => {
  const f = await navigationFixture(),
    w = await createWire(f.config, f.dependencies);
  try {
    w.input.write(
      Buffer.from('\ufeff{"jsonrpc":"2.0","id":77,"method":"ping"}\n'),
    );
    expect(await w.read(null)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.collection).not.toHaveBeenCalled();
    w.send(initialize);
    await w.read(1);
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    w.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kdrive_info", arguments: { file_id: 3 } },
    });
    expect((await w.read(2)).result).not.toHaveProperty("isError", true);
    expect(w.stderr()).toBe("");
  } finally {
    await w.session.close();
  }
});

for (const path of ["callback", "drain"] as const) {
  it.each([999, 1000, 1100])(
    "BR-070 review1 R2 " +
      path +
      " settlement at%dms obeys absolute monotonic deadline",
    async (elapsed) => {
      let time = 0,
        done!: (error?: Error | null) => void,
        diagnostic = "",
        failures = 0;
      vi.spyOn(performance, "now").mockImplementation(() => time);
      const input = new PassThrough(),
        output = new Writable({
          highWaterMark: path === "drain" ? 1 : 4096,
          write(_chunk, _encoding, callback) {
            done = callback;
          },
        });
      const emit = output.emit.bind(output);
      if (path === "drain")
        vi.spyOn(output, "emit").mockImplementation(
          (event: string | symbol, ...args: unknown[]) =>
            event === "drain" ? false : emit(event, ...args),
        );
      const transport = createOwnedStdioTransport(input, output, {
        diagnostic: (message) => {
          diagnostic += message;
        },
        onFailure: () => {
          failures++;
        },
      });
      await transport.start();
      const sent = transport.send({ jsonrpc: "2.0", id: 1, result: {} });
      const outcome = sent.then(
        () => "resolved",
        () => "rejected",
      );
      if (path === "callback") {
        time = elapsed;
        done();
      } else {
        time = 100;
        done();
        time = elapsed;
        emit("drain");
      }
      expect(await outcome).toBe(elapsed < 1000 ? "resolved" : "rejected");
      expect(failures).toBe(elapsed < 1000 ? 0 : 1);
      expect(diagnostic).toBe(elapsed < 1000 ? "" : "STDIO_OUTPUT_FAILED\n");
      expect(output.destroyed).toBe(elapsed >= 1000);
      await transport.close();
      expect(output.listenerCount("drain")).toBe(0);
    },
  );
}
it("BR-070 review1 R2 synchronous write delay cannot settle before overdue timer phase", async () => {
  let diagnostic = "",
    failures = 0;
  const input = new PassThrough(),
    output = new Writable({
      write(_chunk, _encoding, done) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1010);
        done();
      },
    });
  const transport = createOwnedStdioTransport(input, output, {
    diagnostic: (message) => {
      diagnostic += message;
    },
    onFailure: () => {
      failures++;
    },
  });
  await transport.start();
  const start = performance.now();
  await expect(
    transport.send({ jsonrpc: "2.0", id: 1, result: {} }),
  ).rejects.toThrow("STDIO_CLOSED");
  expect(performance.now() - start).toBeGreaterThanOrEqual(1000);
  expect(failures).toBe(1);
  expect(diagnostic).toBe("STDIO_OUTPUT_FAILED\n");
  await transport.close();
});
function callerListeners(input: PassThrough, output: PassThrough) {
  const caller = () => {};
  for (const event of ["data", "end", "close", "error"])
    input.on(event, caller);
  output.on("error", caller);
  return () => {
    for (const event of ["data", "end", "close", "error"])
      expect(input.listeners(event)).toEqual([caller]);
    expect(output.listeners("error")).toEqual([caller]);
  };
}
it("BR-070 review1 R3 direct close-before-ready installs no listeners and preserves callers", async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    assertCallers = callerListeners(input, output);
  let work = 0;
  const transport = createOwnedStdioTransport(input, output, {
    diagnostic: () => {
      work++;
    },
    onFailure: () => {
      work++;
    },
  });
  const starting = transport.start();
  await transport.close();
  await starting;
  await transport.close();
  assertCallers();
  expect(work).toBe(0);
  expect(output.destroyed).toBe(true);
});
it("BR-059 v2 BR-070 review1 R3 public runner immediate close-before-ready preserves callers and zero work", async () => {
  const f = await navigationFixture(),
    input = new PassThrough(),
    output = new PassThrough(),
    assertCallers = callerListeners(input, output);
  let diagnostic = "",
    exitCode = 0;
  const session = startStdioNavigation(f.config, f.dependencies, {
    input,
    output,
    signals: false,
    diagnostic: (m) => {
      diagnostic += m;
    },
    setExitCode: (code) => {
      exitCode = code;
    },
  });
  await session.close();
  await session.ready;
  await session.closed;
  await session.close();
  assertCallers();
  expect(f.inspect).not.toHaveBeenCalled();
  expect(f.collection).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(diagnostic).toBe("");
  expect(exitCode).toBe(0);
});

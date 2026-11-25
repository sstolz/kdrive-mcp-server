// F-054 AC-07 / AC-10. Runtime imports use the gate's freshly built dist tree.
import assert from "node:assert/strict";
import { productionDependencies } from "../../dist/production.js";
import {
  loadConfiguration,
  preflightConfiguration,
} from "../../dist/config.js";
import { startStdioNavigation } from "../../dist/stdio.js";
import { createMutationGate } from "../../dist/mutation-gate.js";
import { openFileSink } from "../../dist/audit/sink.js";
import { acquireExtraction } from "../../dist/extraction-admission.js";

const send = (event, fields = {}) => process.send?.({ event, ...fields });
const waiters = new Map();
const received = new Set();
process.on("message", ({ event }) => {
  received.add(event);
  waiters.get(event)?.();
});
const wait = (event) =>
  received.has(event)
    ? Promise.resolve()
    : new Promise((resolve) => waiters.set(event, resolve));
const configuration = await preflightConfiguration(
  await loadConfiguration({
    argv: [],
    env: {
      KDRIVE_ID: "7",
      KDRIVE_TOKEN: "SYNTHETIC",
      KDRIVE_MCP_MODE: "write",
    },
  }),
  {
    inspectDrive: async (id) => ({ id, role: "admin" }),
    resolveDirectory: async (driveId, selector) => ({
      driveId,
      id: selector.value ?? 1,
      type: "dir",
    }),
  },
);
const unexpected = () => {
  throw Error("Unexpected synthetic policy invocation");
};
const dependencies = {
  inspect: unexpected,
  children: unexpected,
  collection: unexpected,
  execute: unexpected,
};
if (process.argv[2] === "stderr") {
  // The extraction writer is lazy and built-in; no test error listener masks ownership.
  const session = startStdioNavigation(configuration, dependencies, {
    input: new (await import("node:stream")).PassThrough(),
    output: new (await import("node:stream")).PassThrough(),
    signals: false,
    setExitCode: () => {},
  });
  await session.ready;
  const originalEmit = process.stderr.emit;
  let errors = 0;
  process.stderr.emit = function (event, ...args) {
    if (event === "error") {
      assert.equal(args[0]?.code, "EPIPE");
      errors++;
    }
    const value = originalEmit.call(this, event, ...args);
    if (event === "error") send(errors === 1 ? "first-EPIPE" : "second-EPIPE");
    return value;
  };
  send("ready");
  await wait("reader-closed");
  const permit = await acquireExtraction(
    { kind: "stdio" },
    new AbortController().signal,
    () => {},
  );
  permit.detach();
  await wait("first-observed");
  await session.close();
  send("session-closed");
  permit.release();
  permit.workerExited();
  await wait("second-observed");
  assert.equal(errors, 2);
  process.exit(0);
} else {
  const production = productionDependencies();
  const records = [];
  const sink = await openFileSink("/synthetic/f054-child-audit", {
    port: {
      open: async () => 3,
      fstat: async () => ({ isFile: () => true, uid: 1000, mode: 0o100600 }),
      geteuid: () => 1000,
      write: async (_fd, bytes) => {
        const record = JSON.parse(Buffer.from(bytes).toString());
        records.push(record);
        send(records.length === 1 ? "intent" : "outcome", { records });
        return bytes.length;
      },
      fdatasync: async () => {},
      close: async () => {
        send("sink-close", { records });
      },
    },
  });
  const gate = createMutationGate({
    mode: "write",
    sink,
    mutators: {
      rename: async () => {
        send("committed");
        await wait("release-mutator");
        send("mutator-success");
        return { outcome: "response", accepted: true, status: 200 };
      },
    },
    random: (n) => new Uint8Array(n),
    clock: () => new Date("2026-11-25T00:00:00Z"),
    now: () => performance.now(),
    diagnostic: () => {},
  });
  const session = startStdioNavigation(configuration, dependencies, {
    gate,
    exit: production.exit,
  });
  session.server.registerTool(
    "synthetic_large_result",
    { description: "Test fixture only" },
    async () => ({
      content: [{ type: "text", text: "x".repeat(262070) }],
    }),
  );
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => {
    if (typeof chunk !== "string" || Buffer.byteLength(chunk) !== 262144)
      return originalWrite(chunk, ...args);
    assert.equal(Buffer.byteLength(chunk), 262144);
    assert.ok(Buffer.byteLength(chunk) < 1048576);
    const callback = args.at(-1);
    const returned = originalWrite(chunk, (error) => {
      callback?.(error);
      send(error ? "write-callback-error" : "write-callback-no-error");
    });
    assert.equal(returned, false, "Harness must produce a pending write");
    assert.ok(
      process.stdout.writableLength > 0,
      "Harness must retain pending bytes",
    );
    send("pending-frame", {
      bytes: Buffer.byteLength(chunk),
      returned,
      writableLength: process.stdout.writableLength,
    });
    return returned;
  };
  const originalDestroy = process.stdout.destroy.bind(process.stdout);
  process.stdout.destroy = (...args) => {
    const value = originalDestroy(...args);
    assert.equal(process.stdout.destroyed, false);
    assert.equal(gate.hasCommitted, true);
    // This IPC message is sent after the transport removes its own error listener.
    assert.equal(process.stdout.listenerCount("error"), 1);
    send("transport-closed-draining");
    return value;
  };
  const originalEmit = process.stdout.emit;
  process.stdout.emit = function (event, ...args) {
    const value = originalEmit.call(this, event, ...args);
    if (event === "error") {
      assert.equal(args[0]?.code, "EPIPE");
      assert.equal(gate.hasCommitted, true);
      send("contained-EPIPE-draining");
    }
    return value;
  };
  await session.ready;
  void gate.run({
    tool: "kdrive_rename",
    operation: {
      kind: "rename",
      target: { driveId: 7, id: 3 },
      name: "b",
    },
    identity: { kind: "stdio" },
    dispatch: async (operation) => ({
      ok: true,
      value: await gate.execute(operation),
    }),
  });
  send("ready");
}

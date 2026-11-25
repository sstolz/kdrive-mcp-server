// F-054: BR-447 v1 / BR-448 v1, process-lifetime owners over fresh stream identities.
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { productionDependencies } from "../src/production.js";
import { createStderrSink } from "../src/audit/sink.js";
import { startStdioNavigation } from "../src/stdio.js";
import { navigationFixture } from "./helpers/navigation.js";
import {
  FlushPort,
  microtasks,
  processPorts,
} from "./helpers/f039-composition.js";
import { lifecycleChild } from "./helpers/f054-child.js";

afterEach(() => {
  vi.useRealTimers();
});

it("TestBR447_TestBR448_AC06_permanent_stderr_owner", async () => {
  const err = new FlushPort(),
    out = new FlushPort();
  const ports = processPorts(out, err);
  const f = await navigationFixture();
  try {
    expect(err.listenerCount("error")).toBe(1);
    expect(out.listenerCount("error")).toBe(1);
    for (let index = 0; index < 2; index++) {
      productionDependencies();
      productionDependencies();
      const input = new PassThrough(),
        output = new PassThrough();
      const statuses: number[] = [];
      const session = startStdioNavigation(f.config, f.dependencies, {
        input,
        output,
        signals: false,
        setExitCode: (code) => {
          statuses.push(code);
        },
      });
      await session.ready;
      input.emit("error", Error("PRIVATE_INPUT_CANARY"));
      await session.closed;
      expect(statuses).toEqual([1]);
      expect(output.listenerCount("error")).toBe(0);
      expect(err.listenerCount("error")).toBe(1);
      // Asynchronous delivery after closure, independent of the writer callback.
      queueMicrotask(() =>
        err.emit(
          "error",
          Object.assign(Error("PRIVATE_EPIPE_CANARY"), { code: "EPIPE" }),
        ),
      );
      await microtasks();
      expect(ports.exits).toEqual([]);
    }
    expect(err.writes).toEqual([
      "STDIO_INPUT_FAILED\n",
      "STDIO_INPUT_FAILED\n",
    ]);
    expect(err.destroyed).toBe(false);
    const audit = createStderrSink(err);
    expect(err.listenerCount("error")).toBe(2);
    err.emit(
      "error",
      Object.assign(Error("PRIVATE_AUDIT_CANARY"), { code: "EPIPE" }),
    );
    expect(audit.latched).toBe(true);
    await audit.close();
    expect(err.writes.join("")).not.toContain("PRIVATE_");
    expect(out.writes).toEqual([]);
    expect(err.listenerCount("error")).toBe(2);
  } finally {
    ports.restore();
  }
});

it("TestBR447_TestBR448_AC07_closed_stderr_pipe", async () => {
  const child = lifecycleChild("stderr");
  try {
    await child.wait("ready");
    child.process.stderr!.destroy();
    child.send("reader-closed");
    await child.wait("first-EPIPE");
    child.send("first-observed");
    await child.wait("session-closed");
    await child.wait("second-EPIPE");
    child.send("second-observed");
    expect(await child.exited).toEqual({ code: 0, signal: null });
    expect(child.messages.map((message) => message.event)).toEqual([
      "ready",
      "first-EPIPE",
      "session-closed",
      "second-EPIPE",
    ]);
    expect(child.stdout()).toBe("");
  } finally {
    child.dispose();
  }
}, 15000);

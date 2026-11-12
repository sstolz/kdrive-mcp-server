import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import * as owner from "../src/extraction-owner.js";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function watchdog<T>(promise: Promise<T>, ms = 1500): Promise<T> {
  const abort = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(ms, undefined, { signal: abort.signal }).then(() => {
        throw Error("Lifecycle watchdog expired");
      }),
    ]);
  } finally {
    abort.abort();
  }
}
const workers: Worker[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(workers.splice(0).map((w) => w.terminate()));
});
function fixedFixture(mode: "cpu" | "never", holdExit = true) {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- F-011: void is the settled value type of a test deferred
  const started = deferred<void>(),
    exited = deferred<number>(),
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- F-011: void is the settled value type of a test deferred
    release = deferred<void>();
  let worker: Worker | undefined,
    hasExited = false;
  vi.spyOn(owner, "createExtractionWorker").mockImplementation(() => {
    worker = new Worker(
      new URL("./helpers/extraction-lifecycle-worker.mjs", import.meta.url),
      { workerData: { mode }, stdout: true, stderr: true },
    );
    workers.push(worker);
    worker.on("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "started" in message
      )
        started.resolve();
    });
    worker.once("exit", (code) => {
      hasExited = true;
      exited.resolve(code);
    });
    const terminate = worker.terminate.bind(worker);
    if (holdExit)
      vi.spyOn(worker, "terminate").mockImplementation(async () => {
        const code = await terminate();
        await release.promise;
        return code;
      });
    return worker;
  });
  return {
    started: started.promise,
    exited: exited.promise,
    release: () => {
      release.resolve();
    },
    worker: () => worker!,
    alive: () => !hasExited && worker!.threadId > 0,
  };
}
it.each(["cpu", "never"] as const)(
  "TestBR118_worker_lifecycle running %s cancellation owns exit, busy and late message",
  async (mode) => {
    const h = fixedFixture(mode),
      f = await contentFixture({}, Buffer.from("safe")),
      c = createNavigationController(f.config, f.dependencies),
      abort = new AbortController();
    let settled = false;
    const task = c
      .invoke("kdrive_read", { file_id: 3, format: "text" }, abort.signal)
      .then((value) => {
        settled = true;
        return value;
      });
    try {
      await watchdog(h.started);
      await delay(10);
      expect(h.alive()).toBe(true);
      expect(settled).toBe(false);
      expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
        contentError("SERVER_BUSY"),
      );
      const calls = f.inspect.mock.calls.length;
      abort.abort();
      await watchdog(h.exited);
      expect(settled).toBe(false);
      expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
        contentError("SERVER_BUSY"),
      );
      h.worker().emit("message", {
        value: { kind: "text", text: "CANARY_QUEUED_LATE", encoding: "utf-8" },
      });
      h.release();
      expect(await watchdog(task)).toEqual(contentError("ACCESS_DENIED"));
      expect(f.inspect).toHaveBeenCalledTimes(calls);
      expect(
        (await c.invoke("kdrive_info", { file_id: 3 })).isError,
      ).toBeUndefined();
    } finally {
      h.release();
      c.close();
      await task;
    }
  },
);
it("TestBR118_worker_lifecycle close during started never-settling extraction waits for exit", async () => {
  const h = fixedFixture("never"),
    f = await contentFixture({}, Buffer.from("safe")),
    c = createNavigationController(f.config, f.dependencies);
  let settled = false;
  const task = c
    .invoke("kdrive_read", { file_id: 3, format: "text" })
    .then((v) => {
      settled = true;
      return v;
    });
  try {
    await watchdog(h.started);
    await delay(10);
    expect(h.alive()).toBe(true);
    const calls = f.inspect.mock.calls.length;
    c.close();
    await watchdog(h.exited);
    expect(settled).toBe(false);
    expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
      contentError("ACCESS_DENIED"),
    );
    h.release();
    expect(await watchdog(task)).toEqual(contentError("ACCESS_DENIED"));
    expect(f.inspect).toHaveBeenCalledTimes(calls);
  } finally {
    h.release();
    c.close();
    await task;
  }
});
it("TestBR118_worker_lifecycle invocation deadline stops already-started CPU work", async () => {
  const h = fixedFixture("cpu"),
    f = await contentFixture(
      { KDRIVE_MCP_EXTRACT_TIMEOUT_MS: "300000" },
      Buffer.from("safe"),
    ),
    c = createNavigationController(f.config, f.dependencies);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let settled = false;
  const task = c
    .invoke("kdrive_read", { file_id: 3, format: "text" })
    .then((v) => {
      settled = true;
      return v;
    });
  try {
    await watchdog(h.started);
    await delay(10);
    expect(h.alive()).toBe(true);
    const calls = f.inspect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    await watchdog(h.exited);
    expect(settled).toBe(false);
    expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
      contentError("SERVER_BUSY"),
    );
    h.release();
    expect(await watchdog(task)).toEqual(contentError("REQUEST_TIMEOUT"));
    expect(f.inspect).toHaveBeenCalledTimes(calls);
    expect(
      (await c.invoke("kdrive_info", { file_id: 3 })).isError,
    ).toBeUndefined();
  } finally {
    h.release();
    c.close();
    await task;
  }
});
it("TestBR118_worker_lifecycle processing deadline terminates started never-settling work without new policy calls", async () => {
  const h = fixedFixture("never"),
    f = await contentFixture(
      { KDRIVE_MCP_EXTRACT_TIMEOUT_MS: "150" },
      Buffer.from("safe"),
    ),
    c = createNavigationController(f.config, f.dependencies);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let settled = false;
  const task = c
    .invoke("kdrive_read", { file_id: 3, format: "text" })
    .then((v) => {
      settled = true;
      return v;
    });
  try {
    await watchdog(h.started);
    await delay(10);
    expect(h.alive()).toBe(true);
    const calls = f.inspect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(150);
    await watchdog(h.exited);
    expect(settled).toBe(false);
    expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
      contentError("SERVER_BUSY"),
    );
    h.release();
    expect(await watchdog(task)).toEqual(contentError("REQUEST_TIMEOUT"));
    expect(f.inspect).toHaveBeenCalledTimes(calls);
  } finally {
    h.release();
    c.close();
    await task;
  }
});
it("TestBR118_worker_lifecycle actual SDK watchdog terminates started CPU task at extract deadline", async () => {
  const h = fixedFixture("cpu", false),
    f = await contentFixture(
      { KDRIVE_MCP_EXTRACT_TIMEOUT_MS: "150" },
      Buffer.from("safe"),
    ),
    w = await createWire(f.config, f.dependencies);
  async function response(id: number) {
    for (let i = 0; i < 500; i++) {
      const message = w.responses().find((m) => m.id === id);
      if (message) return message;
      await delay(2);
    }
    throw Error("SDK response watchdog expired");
  }
  try {
    w.send(initialize);
    await w.read(1);
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    w.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "kdrive_read",
        arguments: { file_id: 3, format: "text" },
      },
    });
    await watchdog(h.started);
    await delay(10);
    expect(h.alive()).toBe(true);
    w.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "kdrive_info", arguments: { file_id: 3 } },
    });
    expect((await watchdog(response(3))).result).toEqual(
      contentError("SERVER_BUSY"),
    );
    const calls = f.inspect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(150);
    const message = await watchdog(response(2));
    expect(message.result).toEqual(contentError("REQUEST_TIMEOUT"));
    await watchdog(h.exited);
    expect(f.inspect).toHaveBeenCalledTimes(calls);
    h.worker().emit("message", {
      value: { kind: "text", text: "CANARY_LATE_SDK", encoding: "utf-8" },
    });
    await delay(10);
    expect(w.responses().filter((m) => m.id === 2)).toHaveLength(1);
    expect(w.stdout() + w.stderr()).not.toContain("CANARY");
    vi.useRealTimers();
    w.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "kdrive_info", arguments: { file_id: 3 } },
    });
    expect(
      ((await w.read(4)).result as { isError?: boolean }).isError,
    ).toBeUndefined();
  } finally {
    vi.useRealTimers();
    await w.session.close();
  }
});

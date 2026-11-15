import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import * as owner from "../src/extraction-owner.js";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";

type Controller = ReturnType<typeof createNavigationController>;
/** F-026: a probe call waits (no policy call) while the slot is held; its own abort removes it. */
async function expectSlotHeld(
  c: Controller,
  f: { inspect: { mock: { calls: unknown[] } } },
) {
  const before = f.inspect.mock.calls.length,
    probe = new AbortController();
  let settled = false;
  const call = c
    .invoke("kdrive_info", { file_id: 3 }, probe.signal)
    .then((r) => {
      settled = true;
      return r;
    });
  await delay(5);
  expect(settled).toBe(false);
  expect(f.inspect.mock.calls).toHaveLength(before);
  probe.abort();
  expect(await call).toEqual(contentError("ACCESS_DENIED"));
}
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
        await release.promise;
        return terminate();
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
  "TestBR118_worker_lifecycle running %s cancellation owns exit, slot and late message",
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
      await expectSlotHeld(c, f);
      const calls = f.inspect.mock.calls.length;
      abort.abort();
      expect(h.alive()).toBe(true);
      expect(settled).toBe(false);
      await expectSlotHeld(c, f);
      h.worker().emit("message", {
        value: { kind: "text", text: "CANARY_QUEUED_LATE", encoding: "utf-8" },
      });
      h.release();
      await watchdog(h.exited);
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
    expect(h.alive()).toBe(true);
    expect(settled).toBe(false);
    expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
      contentError("ACCESS_DENIED"),
    );
    h.release();
    await watchdog(h.exited);
    expect(await watchdog(task)).toEqual(contentError("ACCESS_DENIED"));
    expect(f.inspect).toHaveBeenCalledTimes(calls);
  } finally {
    h.release();
    c.close();
    await task;
  }
});
it("TestBR118_v3_worker_lifecycle invocation deadline detaches already-started CPU work", async () => {
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
    const callsBeforeDeadline = f.inspect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.alive()).toBe(true);
    expect(await watchdog(task)).toEqual(contentError("REQUEST_TIMEOUT"));
    expect(settled).toBe(true);
    expect(f.inspect).toHaveBeenCalledTimes(callsBeforeDeadline);
    expect(
      (await c.invoke("kdrive_info", { file_id: 3 })).isError,
    ).toBeUndefined();
    const calls = f.inspect.mock.calls.length;
    h.release();
    await watchdog(h.exited);
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
    expect(h.alive()).toBe(true);
    expect(settled).toBe(false);
    await expectSlotHeld(c, f);
    h.release();
    await watchdog(h.exited);
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
    // F-026: request 3 waits for the slot; it runs only after the worker exit.
    await delay(10);
    expect(w.responses().find((m) => m.id === 3)).toBeUndefined();
    const aliveAtCall: boolean[] = [],
      original = f.inspect.getMockImplementation();
    f.inspect.mockImplementation((...args) => {
      aliveAtCall.push(h.alive());
      return original?.(...args) as ReturnType<typeof f.inspect>;
    });
    await vi.advanceTimersByTimeAsync(150);
    const message = await watchdog(response(2));
    expect(message.result).toEqual(contentError("REQUEST_TIMEOUT"));
    await watchdog(h.exited);
    expect(
      ((await watchdog(response(3))).result as { isError?: boolean }).isError,
    ).toBeUndefined();
    expect(aliveAtCall.length).toBeGreaterThan(0);
    expect(aliveAtCall.every((alive) => !alive)).toBe(true);
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

// F-040: real workers are held alive, independently of termination acknowledgments.
import {
  installControlledWorkers,
  microtasks,
  wallBound,
  deferredValue,
  DETACH_LINE,
  RELEASE_LINE,
} from "./helpers/f040-lifecycle.js";
import { rangeResponse } from "./helpers/content.js";
import type { AuditIdentity } from "../src/audit/sink.js";

async function untilLifecycle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) return;
    await delay(2);
  }
  throw Error("F-040 lifecycle condition watchdog expired");
}

const safeResult = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        drive_id: 7,
        file_id: 3,
        etag: '"version-1"',
        size_bytes: 4,
        format: "text",
        offset: 0,
        characters_read: 4,
        total_characters: 4,
        text: "safe",
        has_more: false,
        encoding: "utf-8",
      }),
    },
  ],
};
const ordinaryRows = [
  "success",
  "error",
  "timeout",
  "cancel",
  "close",
] as const;
const detachedRows = [
  "termination-rejection",
  "termination-pending-at-deadline",
  "cancel-pending-at-deadline",
  "close-pending-at-deadline",
  "termination-rejection-final-denial",
  "termination-rejection-final-auth-deadline",
  "detach-removes-existing-waiter",
  "detach-diagnostics",
  "diagnostic-failure",
  "two-stuck-workers",
  "stdio-stuck-worker",
  "exit-before-transfer",
  "exit-after-transfer",
] as const;
type LifecycleRow =
  (typeof ordinaryRows)[number] | (typeof detachedRows)[number];

async function lifecycleScenario(
  row: LifecycleRow,
  diagnosticMode: "throws" | "reenters" | "unacknowledged" = "throws",
  lateAuthorization: "resolve" | "reject" = "resolve",
) {
  vi.resetModules();
  const lines: string[] = [];
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      lines.push(String(chunk));
      if (row === "diagnostic-failure" && diagnosticMode === "throws")
        throw Error("CANARY_DIAGNOSTIC");
      if (row === "diagnostic-failure" && diagnosticMode === "reenters") {
        h.records[0]?.worker.emit("error", Error("CANARY_REENTRANT_ERROR"));
      }
      return false; // An unacknowledged/backpressured sink must never be awaited.
    });
  const { contentFixture } = await import("./helpers/content.js");
  const navigation = await import("../src/navigation.js"),
    extractionOwner = await import("../src/extraction-owner.js"),
    h = installControlledWorkers(extractionOwner);
  let now = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const calls: Promise<unknown>[] = [];
  const refusedContents: Awaited<
    ReturnType<typeof contentFixture>
  >["content"][] = [];
  const sessions: ReturnType<typeof navigation.createNavigationServer>[] = [];
  async function session(identity: string, heldBody = false, stdio = false) {
    const f = await contentFixture(
      {
        KDRIVE_MCP_EXTRACT_TIMEOUT_MS:
          row === "timeout" && identity === "A" ? "1000" : "300000",
      },
      Buffer.from("safe"),
    );
    const bodyRelease = deferredValue<boolean>();
    if (heldBody)
      f.content.open.mockImplementation((request) => {
        const response = rangeResponse(request, f.bytes),
          read = response.body.read.getMockImplementation()!;
        response.body.read.mockImplementation(async (max) => {
          await bodyRelease.promise;
          return read(max);
        });
        f.bodies.push(response.body);
        return Promise.resolve(response);
      });
    const trusted: AuditIdentity = stdio
      ? { kind: "stdio" }
      : { kind: "oauth", iss: "https://issuer.example", sub: identity };
    const server = navigation.createNavigationServer(
      f.config,
      f.dependencies,
      undefined,
      identity === "fallback" ? {} : { identity: trusted },
    );
    sessions.push(server);
    const c = navigation.navigationBinding(server)!.controller,
      abort = new AbortController();
    const invoke = () => {
      const task = c.invoke(
        "kdrive_read",
        { file_id: 3, format: "text" },
        abort.signal,
      );
      calls.push(task);
      return task;
    };
    return {
      f,
      c,
      abort,
      invoke,
      releaseBody: () => {
        bodyRelease.resolve(true);
      },
    };
  }
  async function advance(to: number) {
    const elapsed = to - now;
    now = to;
    await vi.advanceTimersByTimeAsync(elapsed);
    await microtasks();
  }
  try {
    const a = await session("A", false, row === "stdio-stuck-worker"),
      task = a.invoke();
    let results = 0;
    void task.then(() => {
      results++;
    });
    await untilLifecycle(() => h.records.length === 1);
    const worker = h.records[0]!;
    await wallBound(worker.started);
    await microtasks();
    await advance(500);
    const b = await session("B", row !== "two-stuck-workers"),
      bTask = b.invoke();
    await microtasks();
    if (row === "two-stuck-workers") {
      await untilLifecycle(() => h.records.length >= 2);
      await wallBound(h.records[1]!.started);
    }
    const c = await session("C", true),
      cTask = c.invoke();
    await microtasks();
    expect.soft(c.f.content.describe).not.toHaveBeenCalled();
    await advance(1000);
    function triggerCleanup() {
      if (row === "cancel" || row === "cancel-pending-at-deadline")
        a.abort.abort();
      else if (row === "close" || row === "close-pending-at-deadline")
        a.c.close();
      else if (row === "error")
        worker.worker.emit("error", Error("CANARY_WORKER"));
      else if (row !== "timeout") worker.sendResult();
    }
    triggerCleanup();
    await untilLifecycle(() => worker.terminate.mock.calls.length > 0);
    const ordinary = (ordinaryRows as readonly string[]).includes(row);
    async function verifyOrdinary() {
      expect(results).toBe(0);
      if (row === "close")
        expect(await a.c.invoke("kdrive_info", { file_id: 3 })).toEqual(
          contentError("ACCESS_DENIED"),
        );
      else await expectSlotHeld(a.c, a.f);
      expect(worker.worker.threadId).toBeGreaterThan(0);
      await wallBound(worker.confirmExit());
      const code =
        row === "error"
          ? "LIMIT_EXCEEDED"
          : row === "timeout"
            ? "REQUEST_TIMEOUT"
            : "ACCESS_DENIED";
      expect(await wallBound(task)).toEqual(
        row === "success" ? safeResult : contentError(code),
      );
      await microtasks();
      expect(c.f.content.describe).toHaveBeenCalledTimes(1);
      expect(lines).toEqual([]);
    }
    async function verifyDetached() {
      const denial = row === "termination-rejection-final-denial";
      const authDeadline = row === "termination-rejection-final-auth-deadline";
      const auth = deferredValue<unknown>(),
        originalInspect = a.f.inspect.getMockImplementation()!,
        inspectBeforeCleanup = a.f.inspect.mock.calls.length;
      void auth.promise.catch(() => {});
      if (denial || authDeadline)
        a.f.inspect.mockImplementation(() => auth.promise);
      let same: Awaited<ReturnType<typeof session>> | undefined,
        sameTask: Promise<unknown> | undefined;
      const rejection = ![
        "termination-pending-at-deadline",
        "cancel-pending-at-deadline",
        "close-pending-at-deadline",
      ].includes(row);
      async function beginDetach() {
        if (row === "detach-removes-existing-waiter") {
          same = await session("A");
          sameTask = same.invoke();
          await microtasks();
        }
        if (row === "exit-before-transfer")
          await wallBound(worker.confirmExit());
        else if (rejection) worker.rejectTermination();
        await microtasks();
        if (denial || authDeadline)
          expect(a.f.inspect.mock.calls.length).toBeGreaterThan(
            inspectBeforeCleanup,
          );
        if (row === "exit-after-transfer") {
          await microtasks();
          await wallBound(worker.confirmExit());
        }
        if (denial) {
          await advance(1001);
          auth.resolve(undefined);
        }
        if (!rejection || authDeadline) await advance(10000);
      }
      async function expectDetachedOutcome() {
        const expected =
          row === "exit-before-transfer"
            ? safeResult
            : contentError(
                row.startsWith("cancel-") || row.startsWith("close-") || denial
                  ? "ACCESS_DENIED"
                  : !rejection || authDeadline
                    ? "REQUEST_TIMEOUT"
                    : "CONTENT_UNAVAILABLE",
              );
        expect(await wallBound(task)).toEqual(expected);
        if (sameTask) {
          expect(await wallBound(sameTask)).toEqual(
            contentError("SERVER_BUSY"),
          );
          expect(same!.f.content.describe).not.toHaveBeenCalled();
        }
        if (authDeadline) {
          if (lateAuthorization === "resolve")
            auth.resolve(a.f.nodes.get("7:3"));
          else auth.reject(Error("CANARY_LATE_AUTHORIZATION"));
          await microtasks();
        }
        if (denial || authDeadline)
          a.f.inspect.mockImplementation(originalInspect);
        if (!row.startsWith("close-"))
          expect(
            (await wallBound(a.c.invoke("kdrive_info", { file_id: 3 })))
              .isError,
          ).toBeUndefined();
      }
      async function refuseAfterDetach() {
        if (!row.startsWith("exit-")) {
          if (now < 1500) await advance(1500);
          if (row === "stdio-stuck-worker") {
            b.abort.abort();
            c.abort.abort();
            await wallBound(Promise.all([bTask, cTask]));
          }
          const second = await session(
              "A",
              false,
              row === "stdio-stuck-worker",
            ),
            secondTask = second.invoke();
          expect(await wallBound(secondTask)).toEqual(
            contentError("SERVER_BUSY"),
          );
          expect(second.f.content.describe).not.toHaveBeenCalled();
          refusedContents.push(second.f.content);
          if (row === "stdio-stuck-worker") {
            const fallback = await session("fallback");
            expect(await wallBound(fallback.invoke())).toEqual(
              contentError("SERVER_BUSY"),
            );
            expect(fallback.f.content.describe).not.toHaveBeenCalled();
            refusedContents.push(fallback.f.content);
          }
          expect(lines.filter((line) => line === DETACH_LINE)).toHaveLength(1);
          expect(lines.filter((line) => line === RELEASE_LINE)).toHaveLength(0);
        }
      }
      async function releaseOtherPermit() {
        if (now < 10000) await advance(10000);
        expect(results).toBe(1);
        if (!row.startsWith("exit-"))
          expect(c.f.content.describe).not.toHaveBeenCalled();
        if (row === "two-stuck-workers") {
          const second = h.records[1]!;
          second.sendResult();
          await untilLifecycle(() => second.terminate.mock.calls.length > 0);
          second.rejectTermination();
          expect(await wallBound(bTask)).toEqual(
            contentError("CONTENT_UNAVAILABLE"),
          );
          // This row deliberately skips B's normal release at t=10,001.
          const d = await session("D"),
            dTask = d.invoke();
          expect(await wallBound(dTask)).toEqual(contentError("SERVER_BUSY"));
          expect(d.f.content.describe).not.toHaveBeenCalled();
          refusedContents.push(d.f.content);
          expect(lines.filter((line) => line === DETACH_LINE)).toHaveLength(2);
          await advance(10001);
          expect(c.f.content.describe).not.toHaveBeenCalled();
          await wallBound(second.confirmExit());
        } else {
          await advance(10001);
          b.abort.abort();
          await wallBound(bTask);
        }
        await microtasks();
        if (row !== "stdio-stuck-worker")
          expect(c.f.content.describe).toHaveBeenCalledTimes(1);
      }
      async function confirmDetachedExit() {
        await advance(10002);
        await wallBound(worker.confirmExit());
        await microtasks();
        if (!row.startsWith("exit-"))
          expect(lines.filter((line) => line === RELEASE_LINE)).toHaveLength(
            row === "two-stuck-workers" ? 2 : 1,
          );
        if (row === "exit-before-transfer") expect(lines).toEqual([]);
        expect(results).toBe(1);
        const linesBeforeDuplicates = [...lines];
        worker.worker.emit("message", {
          value: { kind: "text", text: "CANARY_LATE", encoding: "utf-8" },
        });
        worker.worker.emit("exit", 0);
        // Detached ownership must keep an error-drain listener even after session settlement.
        expect(() =>
          worker.worker.emit("error", Error("CANARY_LATE")),
        ).not.toThrow();
        await microtasks();
        expect(results).toBe(1);
        expect(lines).toEqual(linesBeforeDuplicates);
        for (const content of refusedContents) {
          expect(content.describe).not.toHaveBeenCalled();
          expect(content.open).not.toHaveBeenCalled();
        }
        expect(lines.join("")).not.toContain("CANARY");
        await advance(10003);
        const fresh = await session("A", true, row === "stdio-stuck-worker");
        void fresh.invoke();
        await microtasks();
        expect(fresh.f.content.describe).toHaveBeenCalledTimes(1);
      }
      await beginDetach();
      await expectDetachedOutcome();
      await refuseAfterDetach();
      await releaseOtherPermit();
      await confirmDetachedExit();
    }
    if (ordinary) await verifyOrdinary();
    else await verifyDetached();
    if (row === "stdio-stuck-worker") return;
    c.releaseBody();
    await untilLifecycle(() =>
      h.records.some(
        (record) => record !== worker && record.worker.threadId > 0,
      ),
    );
    const last = h.records.at(-1)!;
    await wallBound(last.started);
    last.sendResult();
    await untilLifecycle(() => last.terminate.mock.calls.length > 0);
    await wallBound(last.confirmExit());
    expect(await wallBound(cTask)).toEqual(safeResult);
    for (const body of a.f.bodies) expect(body.close).toHaveBeenCalledTimes(1);
  } finally {
    for (const server of sessions)
      navigation.navigationBinding(server)!.controller.close();
    await h.close();
    await vi.advanceTimersByTimeAsync(300000);
    await wallBound(Promise.allSettled(calls));
    stderr.mockRestore();
  }
}
it.each([...ordinaryRows, ...detachedRows])(
  "TestBR426_v1_AC08_worker_exit_precedes_permit_reuse %s",
  async (row) => {
    await lifecycleScenario(row);
  },
);
it.each(detachedRows)(
  "TestBR118_v3_AC08_detached_exit_preserves_deadline_and_slot_reuse %s",
  async (row) => {
    await lifecycleScenario(row);
  },
);

it("TestBR425_v1_AC05_closed_queued_session_publishes_no_wire_result", async () => {
  vi.resetModules();
  const { contentFixture } = await import("./helpers/content.js");
  const navigation = await import("../src/navigation.js"),
    extractionOwner = await import("../src/extraction-owner.js"),
    wire = await import("./helpers/navigation-wire.js"),
    h = installControlledWorkers(extractionOwner);
  const controllers: ReturnType<
    typeof navigation.createNavigationController
  >[] = [];
  const pending: Promise<unknown>[] = [];
  let w: Awaited<ReturnType<typeof wire.createWire>> | undefined;
  try {
    for (const identity of ["A", "B"]) {
      const f = await contentFixture({}, Buffer.from("safe")),
        server = navigation.createNavigationServer(
          f.config,
          f.dependencies,
          undefined,
          {
            identity: {
              kind: "oauth",
              iss: "https://issuer.example",
              sub: identity,
            },
          },
        ),
        c = navigation.navigationBinding(server)!.controller;
      controllers.push(c);
      pending.push(c.invoke("kdrive_read", { file_id: 3, format: "text" }));
    }
    await untilLifecycle(() => h.records.length === 2);
    await wallBound(Promise.all(h.records.map((record) => record.started)));
    const f = await contentFixture({}, Buffer.from("safe"));
    w = await wire.createWire(f.config, f.dependencies);
    w.send(initialize);
    await wallBound(w.read(1));
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    w.send({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "kdrive_read",
        arguments: { file_id: 3, format: "text" },
      },
    });
    await delay(20);
    expect.soft(f.content.describe).not.toHaveBeenCalled();
    await wallBound(w.session.close());
    for (const record of h.records) {
      record.sendResult();
      await wallBound(record.confirmExit());
    }
    await microtasks();
    await delay(10);
    expect(w.responses().filter((response) => response.id === 40)).toEqual([]);
    expect(f.content.describe).not.toHaveBeenCalled();
    expect(f.content.open).not.toHaveBeenCalled();
  } finally {
    for (const c of controllers) c.close();
    await h.close();
    await wallBound(Promise.allSettled(pending));
    if (w) await wallBound(w.session.close());
  }
});

it.each(["reenters", "unacknowledged"] as const)(
  "TestBR426_v1_AC08_worker_exit_precedes_permit_reuse diagnostic-failure %s",
  async (mode) => {
    await lifecycleScenario("diagnostic-failure", mode);
  },
);

it("TestBR426_v1_AC08_worker_exit_precedes_permit_reuse termination-rejection-final-auth-deadline late rejection", async () => {
  await lifecycleScenario(
    "termination-rejection-final-auth-deadline",
    "throws",
    "reject",
  );
});

import { getEventListeners } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { ReadFailure } from "../src/read-retry.js";
import {
  contentError,
  contentResult,
  rangeResponse,
} from "./helpers/content.js";
import { classicPdf } from "./helpers/extraction.js";
import { encodePng } from "./helpers/image-codecs.js";
import {
  admissionHarness,
  deferred,
  expectUntouched,
  pump,
  safePayload,
  safeResult,
  type AdmissionHarness,
} from "./helpers/f040-admission.js";

let h: AdmissionHarness;
afterEach(async () => {
  await h.dispose();
});
async function pair(holdBody = false) {
  const a = await h.caller("A", { holdBody });
  const b = await h.caller("B", { holdBody });
  const calls = [a.invoke(), b.invoke()];
  await pump();
  return { a, b, calls };
}
async function recover() {
  const callers = await Promise.all(
    ["recovery-A", "recovery-B", "recovery-C"].map((id) => h.caller(id)),
  );
  const start = h.workers.length;
  const calls = callers.map((c) => c.invoke());
  await pump();
  expect(h.workers).toHaveLength(start + 2);
  expectUntouched(callers[2]!);
  h.workers[start]!.success();
  await pump();
  expect(h.workers).toHaveLength(start + 3);
  h.workers[start + 1]!.success();
  h.workers[start + 2]!.success();
  await pump();
  expect(await Promise.all(calls.map((call) => call.task))).toEqual([
    safeResult,
    safeResult,
    safeResult,
  ]);
  expect(vi.getTimerCount()).toBe(0);
}

it("TestBR426_v1_AC08_duplicate_exit_after_termination_confirmation_keeps_one_drain", async () => {
  h = admissionHarness();
  const a = await h.caller("A"),
    call = a.invoke();
  await pump();
  const worker = h.workers[0]!;
  worker.terminate.mockImplementationOnce(() => {
    worker.exited = true;
    Object.defineProperty(worker, "threadId", { value: -1 });
    return Promise.resolve(0);
  });
  worker.success();
  expect(await call.task).toEqual(safeResult);
  await pump();
  const drains = worker.listenerCount("error");
  // Model Node's exit event arriving after terminate() confirmed threadId -1.
  worker.emit("exit", 0);
  await pump();
  expect(worker.listenerCount("error")).toBe(drains);
  expect(call.observation.count).toBe(1);
  await recover();
});

it.each(["body", "worker"] as const)(
  "TestBR423_v1_AC01_third_extraction_waits_before_source_buffering %s",
  async (row) => {
    h = admissionHarness();
    const { a, b, calls } = await pair(row === "body");
    const c = await h.caller("C", { holdBody: row === "body" });
    const allocations = vi.spyOn(Buffer, "alloc");
    const copies = vi.spyOn(Uint8Array, "from");
    const priorWorkers = h.workers.length;
    const third = c.invoke();
    await pump();
    expectUntouched(c);
    expect(allocations.mock.calls.filter(([size]) => size === 4)).toHaveLength(
      0,
    );
    expect(copies).not.toHaveBeenCalled();
    expect(h.workers).toHaveLength(priorWorkers);
    expect(third.observation.settled).toBe(false);
    if (row === "body") {
      a.releaseBody();
      await pump();
    }
    h.workers[0]!.success();
    await pump();
    expect(c.f.content.describe).toHaveBeenCalledTimes(1);
    if (row === "body") {
      b.releaseBody();
      c.releaseBody();
      await pump();
    }
    h.workers.slice(1).forEach((worker) => {
      worker.success();
    });
    await pump();
    expect(
      await Promise.all([...calls, third].map((call) => call.task)),
    ).toEqual([safeResult, safeResult, safeResult]);
    for (const caller of [a, b, c])
      expect(caller.f.bodies[0]!.close).toHaveBeenCalledTimes(1);
  },
);

it("TestBR424_v1_AC02_four_waiters_are_FIFO_without_barging", async () => {
  h = admissionHarness();
  const { calls } = await pair();
  const waiting = await Promise.all(
    ["C", "D", "E", "F"].map((id) => h.caller(id)),
  );
  const waitCalls = waiting.map((caller) => caller.invoke());
  await pump();
  waiting.forEach(expectUntouched);
  waitCalls.forEach(({ observation }) => {
    expect(observation.settled).toBe(false);
  });
  h.workers[0]!.success();
  const newcomer = await h.caller("G"),
    last = newcomer.invoke();
  await pump();
  expect(h.starts).toEqual(["A", "B", "C"]);
  expectUntouched(newcomer);
  for (let index = 1; index < 7; index++) {
    expect(
      h.workers.filter((worker) => !worker.exited).length,
    ).toBeLessThanOrEqual(2);
    h.workers[index]!.success();
    await pump();
  }
  expect(h.starts).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  expect(
    await Promise.all([...calls, ...waitCalls, last].map((call) => call.task)),
  ).toEqual(Array.from({ length: 7 }, () => safeResult));
});

it("TestBR424_v1_AC03_seventh_caller_fifth_waiter_refuses_SERVER_BUSY_without_retry", async () => {
  h = admissionHarness();
  await pair();
  for (const id of ["C", "D", "E", "F"]) (await h.caller(id)).invoke();
  const refused = await h.caller("G");
  await pump();
  const timers = vi.getTimerCount(),
    call = refused.invoke();
  await pump();
  expect(call.observation.value).toEqual(contentError("SERVER_BUSY"));
  expectUntouched(refused);
  expect(vi.getTimerCount()).toBe(timers);
  h.workers[0]!.success();
  await pump();
  await vi.advanceTimersByTimeAsync(1);
  expectUntouched(refused);
  expect(call.observation.count).toBe(1);
  const retry = refused.invoke();
  await pump();
  expect(retry.observation.settled).toBe(false);
  h.autoWorkers();
  for (const worker of h.workers) if (!worker.exited) worker.success();
  await pump();
  expect(await retry.task).toEqual(safeResult);
  expect(refused.f.content.describe).toHaveBeenCalledTimes(1);
});

it.each(["queued", "body", "worker-short", "worker-remaining"] as const)(
  "TestBR425_v1_AC04_queue_and_work_share_invocation_deadline %s",
  async (row) => {
    h = admissionHarness();
    const a = await h.caller("A"),
      b = await h.caller("B");
    a.invoke();
    await pump();
    const c = await h.caller("C", {
      holdBody: row === "body",
      env: {
        KDRIVE_MCP_EXTRACT_TIMEOUT_MS: row === "worker-short" ? "500" : "5000",
      },
    });
    // Hold the existing session-admission await after slot acquisition, before
    // extraction admission, to model t=0 slot start and t=2,000 queue entry.
    const admission = deferred<undefined>();
    h.onDispose(() => {
      admission.resolve(undefined);
    });
    const resolved = vi
      .spyOn(Promise, "resolve")
      .mockReturnValueOnce(admission.promise);
    const call = c.invoke();
    expect(resolved).toHaveBeenCalledTimes(1);
    resolved.mockRestore();
    await vi.advanceTimersByTimeAsync(500);
    b.invoke();
    await pump();
    await vi.advanceTimersByTimeAsync(1500);
    admission.resolve(undefined);
    await pump();
    expectUntouched(c);
    await vi.advanceTimersByTimeAsync(7000);
    let d: Awaited<ReturnType<typeof h.caller>> | undefined;
    let follow: ReturnType<typeof c.invoke> | undefined;
    if (row !== "queued") {
      h.workers[0]!.success();
      await pump();
      expect(c.f.content.describe).toHaveBeenCalledTimes(1);
      if (row === "body") {
        d = await h.caller("D");
        follow = d.invoke();
        await pump();
        expectUntouched(d);
      }
    }
    const until = row === "worker-short" ? 500 : 1000;
    await vi.advanceTimersByTimeAsync(until - 1);
    expect(call.observation.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pump();
    expect(call.observation.value).toEqual(contentError("REQUEST_TIMEOUT"));
    if (row === "queued") expectUntouched(c);
    if (row === "body") {
      expect(c.f.bodies[0]!.close).toHaveBeenCalledTimes(1);
      const readSignal = c.f.bodies[0]!.read.mock.calls[0] as unknown as [
        number,
        AbortSignal,
      ];
      expect(readSignal[1].aborted).toBe(true);
      expect(d!.f.content.describe).toHaveBeenCalledTimes(1);
      c.releaseBody();
      await pump();
      expect(c.f.bodies[0]!.read).toHaveBeenCalledTimes(1);
      h.workers.at(-1)!.success();
      await pump();
      expect(await follow!.task).toEqual(safeResult);
    }
    expect(call.observation.count).toBe(1);
  },
);

it.each(["cancel", "close", "pre-aborted", "already-closed"] as const)(
  "TestBR425_v1_AC05_queued_cancel_and_close_remove_only_the_owner %s",
  async (row) => {
    h = admissionHarness();
    await pair();
    const waiting = await Promise.all(
      ["C", "D", "E", "F"].map((id) => h.caller(id)),
    );
    const abort = new AbortController();
    if (row === "pre-aborted") abort.abort();
    if (row === "already-closed") waiting[1]!.c.close();
    const calls = waiting.map((caller, index) =>
      caller.invoke({}, index === 1 ? abort.signal : undefined),
    );
    await pump();
    if (row === "cancel") abort.abort();
    if (row === "close") waiting[1]!.c.close();
    await pump();
    expect(calls[1]!.observation.value).toEqual(contentError("ACCESS_DENIED"));
    expectUntouched(waiting[1]!);
    for (const index of [0, 2, 3])
      expect(calls[index]!.observation.settled).toBe(false);
    const replacement = await h.caller("G"),
      replacementCall = replacement.invoke();
    await pump();
    expect(replacementCall.observation.settled).toBe(false);
    expectUntouched(replacement);
    h.autoWorkers();
    h.workers[0]!.success();
    h.workers[1]!.success();
    await pump();
    expect(h.starts).toEqual(["A", "B", "C", "E", "F", "G"]);
    expect(calls[1]!.observation.count).toBe(1);
    expect(await replacementCall.task).toEqual(safeResult);
  },
);

it.each([
  "abort-before",
  "abort-after",
  "deadline-before",
  "deadline-after",
] as const)(
  "TestBR425_v1_AC06_dead_waiter_cannot_win_permit_handoff %s",
  async (row) => {
    h = admissionHarness();
    await pair();
    const c = await h.caller("C"),
      d = await h.caller("D"),
      abort = new AbortController();
    const queueSignals = new Set<AbortSignal>();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Native method is invoked with its original receiver via call below.
    const addListener = AbortSignal.prototype.addEventListener;
    const added = vi
      .spyOn(AbortSignal.prototype, "addEventListener")
      .mockImplementation(function (this: AbortSignal, ...args) {
        if (this !== abort.signal && args[0] === "abort")
          queueSignals.add(this);
        addListener.call(this, ...args);
      });
    const doomed = c.invoke({}, abort.signal);
    await pump();
    added.mockRestore();
    await vi.advanceTimersByTimeAsync(1);
    const survivor = d.invoke();
    await pump();
    expectUntouched(c);
    expectUntouched(d);
    let clock: { mockRestore: () => void } | undefined;
    let handoffObserved = false;
    const expire = () => {
      if (row.startsWith("abort")) abort.abort();
      else clock = vi.spyOn(performance, "now").mockReturnValue(10000);
    };
    if (row.endsWith("before")) expire();
    else {
      // Grant retires the queued abort listener synchronously. Inject liveness
      // loss in the microtask after that handoff, before its await resumes.
      expect(queueSignals.size).toBe(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Native method is invoked with its original receiver via call below.
      const removeListener = AbortSignal.prototype.removeEventListener;
      vi.spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(
        function (this: AbortSignal, ...args) {
          removeListener.call(this, ...args);
          if (
            !handoffObserved &&
            args[0] === "abort" &&
            queueSignals.has(this)
          ) {
            handoffObserved = true;
            queueMicrotask(expire);
          }
        },
      );
    }
    h.workers[0]!.success();
    await pump();
    expect(doomed.observation.value).toEqual(
      contentError(
        row.startsWith("abort") ? "ACCESS_DENIED" : "REQUEST_TIMEOUT",
      ),
    );
    expectUntouched(c);
    expect(d.f.content.describe).toHaveBeenCalledTimes(1);
    if (row.endsWith("after")) expect(handoffObserved).toBe(true);
    clock?.mockRestore();
    for (const worker of h.workers) if (!worker.exited) worker.success();
    await pump();
    expect(await survivor.task).toEqual(safeResult);
    expect(doomed.observation.count).toBe(1);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
    for (const signal of queueSignals)
      expect(getEventListeners(signal, "abort")).toHaveLength(0);
    await recover();
  },
);

const terminalRows = [
  "success",
  "source-error",
  "source-bound",
  "worker-error",
  "worker-construction",
  "invalid-output",
  "projection-error",
  "final-denial",
  "final-auth-stalled",
  "final-auth-stalled-rejection",
  "timeout",
  "invocation-timeout",
  "cancel",
  "close",
] as const;
it.each(terminalRows)(
  "TestBR426_v1_AC07_every_terminal_path_releases_once %s",
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Named terminal matrix keeps each trigger and expected outcome in one test.
  async (row) => {
    h = admissionHarness();
    const a = await h.caller("A", {
      holdBody: true,
      env: {
        KDRIVE_MCP_EXTRACT_TIMEOUT_MS: row === "timeout" ? "500" : "300000",
      },
    });
    const b = await h.caller("B", { holdBody: true });
    const abort = new AbortController(),
      final = deferred<unknown>(),
      source = deferred<unknown>();
    h.onDispose(() => {
      final.resolve(undefined);
      source.resolve(undefined);
    });
    if (row === "source-bound")
      a.f.content.describe.mockImplementation(() => source.promise);
    if (row === "source-error") {
      const open = a.f.content.open.getMockImplementation()!;
      a.f.content.open.mockImplementation(async (request) => {
        const response = (await open(request)) as ReturnType<
          typeof rangeResponse
        >;
        response.body.read.mockImplementationOnce(() =>
          source.promise.then(() => {
            throw new ReadFailure(503);
          }),
        );
        return response;
      });
    }
    if (row === "worker-construction")
      h.factory.mockImplementationOnce(() => {
        throw Error("CANARY_FACTORY");
      });
    const call = a.invoke(
      row === "projection-error" ? { offset: 5, etag: '"version-1"' } : {},
      abort.signal,
    );
    await pump();
    await vi.advanceTimersByTimeAsync(500);
    b.invoke();
    await pump();
    const c = await h.caller("C"),
      third = c.invoke();
    await pump();
    expectUntouched(c);
    source.resolve({
      target: { driveId: 7, id: 3 },
      size_bytes: 8388609,
      etag: a.f.etag,
      version_bound: true,
    });
    a.releaseBody();
    await pump();
    if (
      [
        "final-denial",
        "final-auth-stalled",
        "final-auth-stalled-rejection",
      ].includes(row)
    ) {
      if (row === "final-denial") a.f.nodes.delete("7:3");
      else a.f.inspect.mockImplementation(() => final.promise);
    }
    const worker = [
      "source-error",
      "source-bound",
      "worker-construction",
    ].includes(row)
      ? undefined
      : h.workers[0];
    if (row === "worker-error") worker!.emit("error", Error("CANARY_WORKER"));
    else if (row === "invalid-output")
      worker!.emit("message", { value: "CANARY_INVALID" });
    else if (row === "cancel") abort.abort();
    else if (row === "close") a.c.close();
    else if (row === "timeout") await vi.advanceTimersByTimeAsync(500);
    else if (row === "invocation-timeout")
      await vi.advanceTimersByTimeAsync(9500);
    else if (worker) worker.success();
    await pump();
    if (row.startsWith("final-auth-stalled")) {
      expect(call.observation.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(9500);
      await pump();
    }
    const code =
      row === "source-error"
        ? "READ_UNAVAILABLE"
        : ["source-bound", "worker-error"].includes(row)
          ? "LIMIT_EXCEEDED"
          : row === "invalid-output"
            ? "CONTENT_UNAVAILABLE"
            : row === "projection-error"
              ? "INVALID_RANGE"
              : [
                    "timeout",
                    "invocation-timeout",
                    "final-auth-stalled",
                    "final-auth-stalled-rejection",
                  ].includes(row)
                ? "REQUEST_TIMEOUT"
                : "ACCESS_DENIED";
    expect(call.observation.value).toEqual(
      row === "success" ? safeResult : contentError(code),
    );
    expect(c.f.content.describe).toHaveBeenCalledTimes(1);
    for (const body of a.f.bodies) expect(body.close).toHaveBeenCalledTimes(1);
    if (worker) expect(worker.exited).toBe(true);
    if (row === "final-auth-stalled-rejection")
      final.reject(Error("CANARY_LATE_AUTHORIZATION"));
    else final.resolve(a.f.file);
    b.releaseBody();
    await pump();
    for (const active of h.workers) if (!active.exited) active.success();
    await pump();
    expect(await third.task).toEqual(safeResult);
    expect(call.observation.count).toBe(1);
    await recover();
  },
);

it("TestBR424_v1_AC09_admission_errors_are_fixed_and_silent", async () => {
  h = admissionHarness();
  await pair();
  for (const id of ["C", "D", "E", "F"]) (await h.caller(id)).invoke();
  const refused = await h.caller("CANARY_ID", {
    bytes: Buffer.from("CANARY_SOURCE"),
  });
  refused.f.file.path = "/CANARY_PATH";
  const result = refused.invoke();
  await pump();
  expect(result.observation.value).toEqual(contentError("SERVER_BUSY"));
  expectUntouched(refused);
  expect(refused.diagnostic).not.toHaveBeenCalled();
  expect(refused.f.execute).not.toHaveBeenCalled();
});

it("TestBR423_v1_AC09_granted_waiter_rechecks_authority", async () => {
  h = admissionHarness();
  await pair();
  const c = await h.caller("C"),
    call = c.invoke();
  await pump();
  expectUntouched(c);
  c.f.nodes.delete("7:3");
  h.workers[0]!.success();
  await pump();
  expect(call.observation.value).toEqual(contentError("ACCESS_DENIED"));
  expectUntouched(c);
  h.workers[1]!.success();
  await pump();
  await recover();
});

it.each(["text", "continuation", "empty", "pdf", "image"] as const)(
  "TestBR423_v1_AC10_formats_share_capacity_and_other_reads_do_not %s",
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Exact format matrix includes source, arguments and wire projection.
  async (row) => {
    h = admissionHarness();
    await pair();
    const bytes =
      row === "empty"
        ? Buffer.alloc(0)
        : row === "pdf"
          ? classicPdf(["safe"])
          : row === "image"
            ? encodePng({ width: 1, height: 1, data: Buffer.alloc(4, 255) })
            : Buffer.from("safe");
    const c = await h.caller("C", { bytes });
    const call = c.invoke(
      row === "continuation"
        ? { offset: 2, etag: '"version-1"' }
        : row === "pdf"
          ? { format: "pdf", pages: [1] }
          : row === "image"
            ? { format: "image" }
            : {},
    );
    await pump();
    expectUntouched(c);
    const other = await h.caller("non-extraction");
    expect(await other.c.invoke("kdrive_info", { file_id: 3 })).toEqual(
      contentResult({
        item: {
          drive_id: 7,
          id: 3,
          name: "a",
          type: "file",
          path: "/docs/a",
          size_bytes: null,
          modified_at: null,
        },
      }),
    );
    expect(await other.c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentResult({
        drive_id: 7,
        file_id: 3,
        offset_bytes: 0,
        bytes_read: 4,
        size_bytes: 4,
        etag: '"version-1"',
        encoding: "base64",
        data: "c2FmZQ==",
        has_more: false,
      }),
    );
    expect(await other.c.readResource("kdrive://7/file/3")).toEqual({
      contents: [
        {
          uri: "kdrive://7/file/3",
          mimeType: "application/octet-stream",
          blob: "c2FmZQ==",
        },
      ],
    });
    h.workers[0]!.success();
    await pump();
    const worker = h.workers[2]!;
    const value =
      row === "pdf"
        ? { kind: "pdf", text: "safe", pages: [1], total_pages: 1 }
        : row === "image"
          ? { kind: "image", data: Uint8Array.from(bytes), width: 1, height: 1 }
          : {
              kind: "text",
              text: row === "empty" ? "" : "safe",
              encoding: "utf-8",
            };
    worker.emit("message", { value });
    await pump();
    let expected: unknown;
    if (row === "image")
      expected = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              drive_id: 7,
              file_id: 3,
              etag: '"version-1"',
              size_bytes: bytes.length,
              format: "image",
              width: 1,
              height: 1,
              mime_type: "image/png",
            }),
          },
          {
            type: "image",
            mimeType: "image/png",
            data: bytes.toString("base64"),
          },
        ],
      };
    else if (row === "pdf") {
      const base = Object.fromEntries(
        Object.entries(safePayload).filter(([key]) => key !== "encoding"),
      );
      expected = contentResult({
        ...base,
        size_bytes: bytes.length,
        format: "pdf",
        pages: [1],
        total_pages: 1,
      });
    } else
      expected = contentResult({
        ...safePayload,
        ...(row === "empty"
          ? { size_bytes: 0, characters_read: 0, total_characters: 0, text: "" }
          : row === "continuation"
            ? { offset: 2, characters_read: 2, text: "fe" }
            : {}),
      });
    expect(await call.task).toEqual(expected);
    expect(c.f.content.open).toHaveBeenCalledTimes(row === "empty" ? 0 : 1);
  },
);

it.each(["text", "continuation", "empty", "pdf", "image"] as const)(
  "TestBR111_BR117_F040_uncontended_real_worker_projection %s",
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Real-worker characterization repeats the specified format matrix.
  async (row) => {
    h = admissionHarness();
    h.factory.mockRestore();
    const bytes =
      row === "empty"
        ? Buffer.alloc(0)
        : row === "pdf"
          ? classicPdf(["safe"])
          : row === "image"
            ? encodePng({ width: 1, height: 1, data: Buffer.alloc(4, 255) })
            : Buffer.from("safe");
    const c = await h.caller("characterization", { bytes });
    const args =
      row === "continuation"
        ? { offset: 2, etag: '"version-1"' }
        : row === "pdf"
          ? { format: "pdf", pages: [1] }
          : row === "image"
            ? { format: "image" }
            : {};
    // Vitest's wall watchdog bounds the real worker; the fixture's invocation is closed in afterEach.
    const result = await c.invoke(args).task;
    if (row === "image")
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              drive_id: 7,
              file_id: 3,
              etag: '"version-1"',
              size_bytes: bytes.length,
              format: "image",
              width: 1,
              height: 1,
              mime_type: "image/png",
            }),
          },
          {
            type: "image",
            mimeType: "image/png",
            data: bytes.toString("base64"),
          },
        ],
      });
    else if (row === "pdf") {
      const base = Object.fromEntries(
        Object.entries(safePayload).filter(([key]) => key !== "encoding"),
      );
      expect(result).toEqual(
        contentResult({
          ...base,
          size_bytes: bytes.length,
          format: "pdf",
          pages: [1],
          total_pages: 1,
        }),
      );
    } else
      expect(result).toEqual(
        contentResult({
          ...safePayload,
          ...(row === "empty"
            ? {
                size_bytes: 0,
                characters_read: 0,
                total_characters: 0,
                text: "",
              }
            : row === "continuation"
              ? { offset: 2, characters_read: 2, text: "fe" }
              : {}),
        }),
      );
    expect(c.f.content.open).toHaveBeenCalledTimes(row === "empty" ? 0 : 1);
    for (const body of c.f.bodies) expect(body.close).toHaveBeenCalledTimes(1);
  },
  2000,
);

it.each([
  "fresh-policy",
  "worker-error",
  "worker-construction",
  "invalid-output",
  "projection-error",
  "final-denial",
] as const)(
  "TestBR109_BR118_BR120_F040_existing_failure_normalization %s",
  async (row) => {
    h = admissionHarness();
    const c = await h.caller("control");
    if (row === "fresh-policy") c.f.nodes.delete("7:3");
    if (row === "worker-construction")
      h.factory.mockImplementationOnce(() => {
        throw Error("CANARY_CONSTRUCTION");
      });
    const call = c.invoke(
      row === "projection-error" ? { offset: 5, etag: '"version-1"' } : {},
    );
    await pump();
    if (row === "final-denial") c.f.nodes.delete("7:3");
    if (row === "worker-error")
      h.workers[0]!.emit("error", Error("CANARY_WORKER"));
    else if (row === "invalid-output")
      h.workers[0]!.emit("message", { value: "CANARY_INVALID" });
    else if (h.workers[0]) h.workers[0].success();
    await pump();
    const code =
      row === "worker-error"
        ? "LIMIT_EXCEEDED"
        : row === "invalid-output"
          ? "CONTENT_UNAVAILABLE"
          : row === "projection-error"
            ? "INVALID_RANGE"
            : "ACCESS_DENIED";
    expect(call.observation.value).toEqual(contentError(code));
    if (row === "fresh-policy") expectUntouched(c);
    for (const worker of h.workers) expect(worker.exited).toBe(true);
  },
);

it("TestBR084_F040_uncontended_metadata_raw_and_resource_projections", async () => {
  h = admissionHarness();
  const c = await h.caller("control");
  expect(await c.c.invoke("kdrive_info", { file_id: 3 })).toEqual(
    contentResult({
      item: {
        drive_id: 7,
        id: 3,
        name: "a",
        type: "file",
        path: "/docs/a",
        size_bytes: null,
        modified_at: null,
      },
    }),
  );
  expect(await c.c.invoke("kdrive_download", { file_id: 3 })).toEqual(
    contentResult({
      drive_id: 7,
      file_id: 3,
      offset_bytes: 0,
      bytes_read: 4,
      size_bytes: 4,
      etag: '"version-1"',
      encoding: "base64",
      data: "c2FmZQ==",
      has_more: false,
    }),
  );
  expect(await c.c.readResource("kdrive://7/file/3")).toEqual({
    contents: [
      {
        uri: "kdrive://7/file/3",
        mimeType: "application/octet-stream",
        blob: "c2FmZQ==",
      },
    ],
  });
  expect(h.factory).not.toHaveBeenCalled();
});

// F-054 BR-447 v1: detached extraction diagnostics outlive the navigation session.
it("TestBR447_AC06_extraction_diagnostic_after_session_close", async () => {
  const { FlushPort } = await import("./helpers/f039-composition.js");
  const { DETACH_LINE, RELEASE_LINE } =
    await import("./helpers/f040-lifecycle.js");
  const stderr = new FlushPort();
  h = admissionHarness();
  const getter = vi
    .spyOn(process, "stderr", "get")
    .mockReturnValue(stderr as unknown as typeof process.stderr);
  try {
    for (const label of ["first-session", "second-session"]) {
      const caller = await h.caller(label),
        call = caller.invoke();
      await pump();
      const worker = h.workers.at(-1)!;
      worker.terminate.mockRejectedValue(Error("PRIVATE_TERMINATION_CANARY"));
      caller.c.close();
      await pump();
      expect(await call.task).toEqual(contentError("ACCESS_DENIED"));
      expect(stderr.listenerCount("error")).toBe(1);
      expect(stderr.writes.at(-1)).toBe(DETACH_LINE);
      queueMicrotask(() =>
        stderr.emit(
          "error",
          Object.assign(Error("PRIVATE_EPIPE_CANARY"), { code: "EPIPE" }),
        ),
      );
      await pump();
      worker.exited = true;
      worker.emit("exit", 0);
      worker.terminate.mockResolvedValue(0);
      await pump();
      expect(stderr.writes.at(-1)).toBe(RELEASE_LINE);
      expect(stderr.listenerCount("error")).toBe(1);
      expect(() =>
        stderr.emit(
          "error",
          Object.assign(Error("PRIVATE_LATE_CANARY"), { code: "EPIPE" }),
        ),
      ).not.toThrow();
      // None of the diagnostic callbacks has fired; capacity and results still settle.
      expect(stderr.callbacks).toHaveLength(stderr.writes.length);
    }
    expect(stderr.writes).toEqual([
      DETACH_LINE,
      RELEASE_LINE,
      DETACH_LINE,
      RELEASE_LINE,
    ]);
    expect(stderr.destroyed).toBe(false);
    await recover();
  } finally {
    getter.mockRestore();
  }
});

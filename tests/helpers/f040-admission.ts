import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import { setTimeout as wallDelay } from "node:timers/promises";
import type { Worker } from "node:worker_threads";
import { expect, vi } from "vitest";
import * as owner from "../../src/extraction-owner.js";
import {
  createNavigationServer,
  navigationBinding,
  type NavigationController,
} from "../../src/navigation.js";
import type { AuditIdentity } from "../../src/audit/sink.js";
import type { WorkerRequest } from "../../src/extraction-values.js";
import { contentFixture, contentResult, rangeResponse } from "./content.js";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Bounded microtask drain: no wall-clock ordering assumptions or timer execution. */
export async function pump() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}
export const safePayload = {
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
};
export const safeResult = contentResult(safePayload);
export class ControlledWorker extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exited = false;
  readonly terminate = vi.fn(() => {
    if (!this.exited) {
      this.exited = true;
      this.emit("exit", 0);
    }
    return Promise.resolve(0);
  });
  constructor(readonly request: WorkerRequest) {
    super();
  }
  success() {
    this.emit("message", {
      value: { kind: "text", text: "safe", encoding: "utf-8" },
    });
  }
}
export function admissionHarness() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const workers: ControlledWorker[] = [];
  const callers: { c: NavigationController; releaseBody: () => void }[] = [];
  const tasks: Promise<unknown>[] = [];
  const starts: string[] = [];
  const signals = new Set<AbortSignal>();
  const releases: (() => void)[] = [];
  let autoWorkers = false;
  const factory = vi
    .spyOn(owner, "createExtractionWorker")
    .mockImplementation((request) => {
      const worker = new ControlledWorker(request);
      workers.push(worker);
      queueMicrotask(() => {
        worker.emit("message", { started: true });
        if (autoWorkers) worker.success();
      });
      return worker as unknown as Worker;
    });
  async function caller(
    label: string,
    settings: {
      identity?: AuditIdentity;
      bytes?: Buffer;
      holdBody?: boolean;
      env?: Record<string, string>;
    } = {},
  ) {
    const f = await contentFixture(
      { KDRIVE_MCP_EXTRACT_TIMEOUT_MS: "300000", ...settings.env },
      Buffer.from(settings.bytes ?? Buffer.from("safe")),
    );
    const diagnostic = vi.fn();
    const server = createNavigationServer(
      f.config,
      f.dependencies,
      diagnostic,
      {
        identity: settings.identity ?? {
          kind: "oauth",
          iss: "https://issuer.invalid",
          sub: label,
        },
      },
    );
    const c = navigationBinding(server)!.controller;
    const firstRead = deferred<unknown>();
    let released = !settings.holdBody;
    const originalDescribe = f.content.describe.getMockImplementation()!;
    f.content.describe.mockImplementation((target, signal?: AbortSignal) => {
      if (signal) signals.add(signal);
      starts.push(label);
      return originalDescribe(target);
    });
    f.content.open.mockImplementation((request, signal?: AbortSignal) => {
      if (signal) signals.add(signal);
      const response = rangeResponse(request, f.bytes);
      if (settings.holdBody) {
        const read = response.body.read.getMockImplementation()!;
        response.body.read.mockImplementationOnce(async (max) => {
          if (!released) await firstRead.promise;
          return read(max);
        });
      }
      f.bodies.push(response.body);
      return Promise.resolve(response);
    });
    const invoke = (
      args: Record<string, unknown> = {},
      signal?: AbortSignal,
    ) => {
      const observation: { settled: boolean; value?: unknown; count: number } =
        { settled: false, count: 0 };
      const task = c
        .invoke("kdrive_read", { file_id: 3, format: "text", ...args }, signal)
        .then((value) => {
          observation.settled = true;
          observation.value = value;
          observation.count++;
          return value;
        });
      tasks.push(task);
      return { task, observation };
    };
    const result = {
      label,
      f,
      c,
      server,
      diagnostic,
      invoke,
      releaseBody() {
        released = true;
        firstRead.resolve(undefined);
      },
    };
    callers.push(result);
    return result;
  }
  return {
    caller,
    callers,
    workers,
    factory,
    starts,
    autoWorkers(value = true) {
      autoWorkers = value;
    },
    onDispose(release: () => void) {
      releases.push(release);
    },
    async dispose() {
      const stop = new AbortController();
      const cleanup = async () => {
        callers.forEach(({ c, releaseBody }) => {
          c.close();
          releaseBody();
        });
        releases.forEach((release) => {
          release();
        });
        for (const worker of workers) await worker.terminate();
        await pump();
        await Promise.allSettled(tasks);
      };
      try {
        await Promise.race([
          cleanup(),
          wallDelay(1000, undefined, { signal: stop.signal }).then(() => {
            throw Error("F-040 cleanup watchdog expired");
          }),
        ]);
        expect(vi.getTimerCount()).toBe(0);
        for (const signal of signals)
          expect(getEventListeners(signal, "abort")).toHaveLength(0);
      } finally {
        stop.abort();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    },
  };
}
export type AdmissionHarness = ReturnType<typeof admissionHarness>;
export type AdmissionCaller = Awaited<ReturnType<AdmissionHarness["caller"]>>;
export function expectUntouched(caller: AdmissionCaller) {
  expect(caller.f.content.describe).not.toHaveBeenCalled();
  expect(caller.f.content.open).not.toHaveBeenCalled();
  expect(caller.f.bodies).toHaveLength(0);
}

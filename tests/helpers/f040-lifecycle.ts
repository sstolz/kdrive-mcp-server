import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { vi } from "vitest";
import type * as ExtractionOwner from "../../src/extraction-owner.js";

export function deferredValue<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function wallBound<T>(promise: Promise<T>): Promise<T> {
  const abort = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(1500, undefined, { signal: abort.signal }).then(() => {
        throw Error("F-040 real-worker watchdog expired");
      }),
    ]);
  } finally {
    abort.abort();
  }
}
export async function microtasks() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}
export function installControlledWorkers(owner: typeof ExtractionOwner) {
  const records: ReturnType<typeof makeWorker>[] = [];
  function makeWorker() {
    const start = deferredValue<boolean>(),
      acknowledgement = deferredValue<number>();
    // Rejection is always observed, including teardown before terminate was requested.
    void acknowledgement.promise.catch(() => {});
    const worker = new Worker(
      new URL("./f040-lifecycle-worker.mjs", import.meta.url),
      {
        stdout: true,
        stderr: true,
      },
    );
    const originalTerminate = worker.terminate.bind(worker);
    let exit: Promise<number> | undefined;
    const terminate = vi
      .spyOn(worker, "terminate")
      .mockImplementation(() => acknowledgement.promise);
    worker.on("message", (value: unknown) => {
      if (typeof value === "object" && value !== null && "started" in value)
        start.resolve(true);
    });
    return {
      worker,
      terminate,
      started: start.promise,
      sendResult: () => {
        worker.postMessage("finish");
      },
      rejectTermination: () => {
        acknowledgement.reject(Error("CANARY_TERMINATION_PATH_ID_NAME"));
      },
      confirmExit: () => {
        exit ??= originalTerminate().then((code) => {
          acknowledgement.resolve(code);
          return code;
        });
        return exit;
      },
    };
  }
  const factory = vi
    .spyOn(owner, "createExtractionWorker")
    .mockImplementation(() => {
      const record = makeWorker();
      records.push(record);
      return record.worker;
    });
  return {
    records,
    factory,
    close: async () => {
      for (const record of records) await wallBound(record.confirmExit());
    },
  };
}
export const DETACH_LINE =
  "Extraction worker detached; capacity remains charged until exit.\n";
export const RELEASE_LINE =
  "Detached extraction worker exited; capacity released.\n";

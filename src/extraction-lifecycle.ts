import type { Worker } from "node:worker_threads";
import { ContentFailure } from "./content.js";
import { record } from "./policy/values.js";
import type { ExtractionPermit } from "./extraction-admission.js";

const workerCodes = new Set([
  "LIMIT_EXCEEDED",
  "CONTENT_UNAVAILABLE",
  "INVALID_ENCODING",
  "UNSUPPORTED_FORMAT",
  "NO_EXTRACTABLE_TEXT",
  "INVALID_RANGE",
]);
type FailureCode = ConstructorParameters<typeof ContentFailure>[0];
export interface ExtractionOwnership {
  readonly permit: ExtractionPermit;
  readonly deadline: number;
}
const discard = () => {};

/** BR-118 v3/426: after settlement only the exit watcher and permit survive.
 * No worker listener or pending termination handler retains the invocation,
 * request/source, result, or promise resolvers after detach.
 */
class OwnedWorker {
  private exited = false;
  private stopping = false;
  private started = false;
  private settled = false;
  private value: unknown;
  private code: FailureCode | undefined;
  private signal: AbortSignal | undefined;
  private resolve: ((value: unknown) => void) | undefined;
  private reject: ((error: unknown) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly worker: Worker,
    private readonly permit: ExtractionPermit | undefined,
  ) {
    worker.stdout.on("data", discard);
    worker.stderr.on("data", discard);
    // Keep a payload-free error drain, including after detached exit.
    worker.on("error", discard);
    worker.once("exit", this.onExit);
  }

  run(signal: AbortSignal, timeout: number, deadline: number) {
    return new Promise<unknown>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.signal = signal;
      this.worker.on("message", this.onMessage);
      this.worker.on("error", this.onError);
      signal.addEventListener("abort", this.onAbort, { once: true });
      this.timer = setTimeout(
        () => {
          this.finish(undefined, "REQUEST_TIMEOUT");
        },
        Math.max(1, timeout),
      );
      this.deadlineTimer = setTimeout(
        () => {
          this.finish(undefined, "REQUEST_TIMEOUT");
          this.detach("REQUEST_TIMEOUT");
        },
        Math.max(0, deadline - performance.now()),
      );
      if (signal.aborted) this.onAbort();
    });
  }

  private readonly onAbort = () => {
    this.finish(undefined, "ACCESS_DENIED");
  };
  private readonly onError = () => {
    this.finish(undefined, "LIMIT_EXCEEDED");
  };
  private readonly onExit = () => {
    // Node removes every Worker listener after emitting exit. Restore only the
    // payload-free error drain after that native cleanup, without retaining us.
    const worker = this.worker;
    queueMicrotask(() => worker.on("error", discard));
    this.exited = true;
    this.permit?.workerExited();
    if (!this.stopping) {
      this.stopping = true;
      this.code = "LIMIT_EXCEEDED";
    }
    this.settle();
  };
  private readonly onMessage = (value: unknown) => {
    if (this.stopping) return;
    try {
      const message = record(value);
      if (Object.keys(message).length === 1 && message.started === true) {
        if (this.started) this.finish(undefined, "CONTENT_UNAVAILABLE");
        else this.started = true;
      } else if (!this.started) {
        this.finish(undefined, "CONTENT_UNAVAILABLE");
      } else if (
        Object.keys(message).length === 1 &&
        typeof message.code === "string" &&
        workerCodes.has(message.code)
      ) {
        this.finish(undefined, message.code as FailureCode);
      } else this.finish(value);
    } catch {
      this.finish(undefined, "CONTENT_UNAVAILABLE");
    }
  };

  private finish(value: unknown, code?: FailureCode) {
    if (this.stopping) return;
    this.stopping = true;
    this.value = value;
    this.code = code;
    void this.terminate();
  }

  private async terminate() {
    try {
      await this.worker.terminate();
      // Native termination resolves after exit. An arbitrary acknowledgment
      // alone cannot make a still-live worker's permit reusable.
      if (this.worker.threadId === -1 && !this.exited) this.onExit();
    } catch {
      this.detach("CONTENT_UNAVAILABLE");
    }
  }

  private detach(code: FailureCode) {
    if (this.settled) return;
    this.value = undefined;
    this.code = code;
    if (!this.exited) this.permit?.detach();
    this.settle();
  }

  private settle() {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.deadlineTimer);
    this.timer = undefined;
    this.deadlineTimer = undefined;
    this.signal?.removeEventListener("abort", this.onAbort);
    this.signal = undefined;
    this.worker.off("message", this.onMessage);
    this.worker.off("error", this.onError);
    const resolve = this.resolve,
      reject = this.reject,
      value = this.value;
    this.resolve = undefined;
    this.reject = undefined;
    this.value = undefined;
    if (this.code) reject?.(new ContentFailure(this.code));
    else resolve?.(value);
  }
}

export function runOwnedWorker(
  worker: Worker,
  signal: AbortSignal,
  timeout: number,
  ownership?: ExtractionOwnership,
) {
  return new OwnedWorker(worker, ownership?.permit).run(
    signal,
    timeout,
    ownership?.deadline ?? performance.now() + timeout,
  );
}

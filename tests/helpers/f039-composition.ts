// F-039 process-port seam: the production exit implementation remains real.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { vi } from "vitest";
import { productionDependencies } from "../../src/production.js";

export type FlushCallback = (error?: Error | null) => void;
export class FlushPort extends EventEmitter {
  readonly writes: string[] = [];
  readonly callbacks: FlushCallback[] = [];
  destroyed = false;
  onWrite?: (callback: FlushCallback) => void;
  write(text: string, callback?: FlushCallback): boolean {
    this.writes.push(text);
    if (callback) {
      this.callbacks.push(callback);
    }
    // A Writable still performs writes when its caller omits the callback.
    this.onWrite?.(callback ?? (() => {}));
    return false;
  }
}

/** Narrow structural typing permits the frozen optional deadline before src adds it. */
export type BoundedExit = (code: number, shutdownDeadline?: number) => void;
export function processPorts(
  stdout: FlushPort | PassThrough = new FlushPort(),
  stderr: FlushPort = new FlushPort(),
  onExit?: () => void,
) {
  const oldCode = process.exitCode;
  const input = new PassThrough();
  const inputSpy = vi
    .spyOn(process, "stdin", "get")
    .mockReturnValue(input as unknown as typeof process.stdin);
  const outputSpy = vi
    .spyOn(process, "stdout", "get")
    .mockReturnValue(stdout as unknown as typeof process.stdout);
  const errorSpy = vi
    .spyOn(process, "stderr", "get")
    .mockReturnValue(stderr as unknown as typeof process.stderr);
  const exits: { code: number | undefined; at: number }[] = [];
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    onExit?.();
    exits.push({
      code: code === undefined ? undefined : Number(code),
      at: performance.now(),
    });
    return undefined as never;
  });
  process.exitCode = undefined;
  const dependencies = productionDependencies();
  const exit: BoundedExit = dependencies.exit;
  return {
    input,
    stdout,
    stderr,
    exits,
    dependencies,
    exit,
    restore() {
      inputSpy.mockRestore();
      outputSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      process.exitCode = oldCode;
      input.destroy();
    },
  };
}

export function observed<T>(promise: Promise<T>) {
  const state: { value?: T; error?: unknown; settled: boolean } = {
    settled: false,
  };
  void promise.then(
    (value) => {
      state.value = value;
      state.settled = true;
    },
    (error: unknown) => {
      state.error = error;
      state.settled = true;
    },
  );
  return state;
}
export async function microtasks() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

// F-014 AC-18 (BR-209): the extraction worker starts with an empty
// environment and no arguments. Hygiene only (D-13), not a boundary.
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted((): { options: unknown } => ({
  options: undefined,
}));
vi.mock("node:worker_threads", async (original) => {
  const actual = await original<typeof import("node:worker_threads")>();
  class CapturingWorker extends actual.Worker {
    constructor(
      _url: URL | string,
      options: import("node:worker_threads").WorkerOptions,
    ) {
      captured.options = options;
      // Run a probe that reports what a worker started with these options sees.
      const rest: import("node:worker_threads").WorkerOptions = { ...options };
      delete rest.workerData;
      delete rest.transferList;
      super(
        `const { parentPort } = require("node:worker_threads");
         parentPort.postMessage({ env: { ...process.env }, argv: process.argv.slice(2), execArgv: process.execArgv });`,
        { ...rest, eval: true },
      );
    }
  }
  return { ...actual, Worker: CapturingWorker };
});

describe("BR-209 extraction worker isolation", () => {
  it("TestBR209_worker_reads_an_empty_env_argv_and_execArgv", async () => {
    const { createExtractionWorker } =
      await import("../src/extraction-owner.js");
    const bytes = new Uint8Array(4);
    const worker = createExtractionWorker({
      bytes,
      args: { format: "text" },
      budget: 10,
    } as never);
    expect(captured.options).toMatchObject({ env: {}, argv: [], execArgv: [] });
    const seen = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      },
    );
    await worker.terminate();
    expect(seen).toEqual({ env: {}, argv: [], execArgv: [] });
  });
});

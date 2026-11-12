import { Worker } from "node:worker_threads";
import type { WorkerRequest } from "./extraction-values.js";
/** Internal fixed composition. No MCP/config/environment target or option selector exists. */
export function createExtractionWorker(request: WorkerRequest) {
  return new Worker(
    new URL(
      import.meta.url.endsWith(".ts")
        ? "../dist/extraction-worker.js"
        : "./extraction-worker.js",
      import.meta.url,
    ),
    {
      workerData: request,
      // BR-209: hygiene, not a boundary (F-014 D-13).
      env: {},
      argv: [],
      execArgv: [],
      transferList: [request.bytes.buffer as ArrayBuffer],
      stdout: true,
      stderr: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    },
  );
}

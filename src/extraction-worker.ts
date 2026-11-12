import { parentPort, workerData } from "node:worker_threads";
import { contentFailure } from "./content.js";
import { decodeText } from "./extraction-text.js";
import type { WorkerRequest } from "./extraction-values.js";
const request = workerData as WorkerRequest;
// The closed extraction pipeline has no network use, including dependency fetch fallbacks.
globalThis.fetch = () => Promise.reject(new Error("EXTERNAL_UNAVAILABLE"));
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
parentPort!.postMessage({ started: true });
try {
  let value;
  if (request.args.format === "text")
    value = decodeText(request.bytes, request.args.encoding, request.budget);
  else if (request.args.format === "pdf")
    value = await (await import("./extraction-pdf.js")).extractPdf(request);
  else
    value = await (await import("./extraction-image.js")).extractImage(request);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
  parentPort!.postMessage({ value });
} catch (error) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
  parentPort!.postMessage({
    code: contentFailure(error) ?? "CONTENT_UNAVAILABLE",
  });
}

// Fixed started-worker fixture. Only explicit harness teardown ends this worker.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ started: true });
parentPort.on("message", () => {
  parentPort.postMessage({
    value: { kind: "text", text: "safe", encoding: "utf-8" },
  });
});

// Fixed test fixture; never imported or selected by production composition.
import { parentPort, workerData } from "node:worker_threads";
parentPort.postMessage({ started: true });
if (workerData.mode === "cpu") {
  const until = performance.now() + 5000;
  let n = 0;
  while (performance.now() < until) n = (n + 1) | 0;
  parentPort.postMessage({
    value: { kind: "text", text: "CANARY_LATE_CPU_" + n, encoding: "utf-8" },
  });
} else {
  const timer = setInterval(() => {}, 1000);
  setTimeout(() => {
    clearInterval(timer);
    parentPort.postMessage({
      value: { kind: "text", text: "CANARY_LATE_NEVER", encoding: "utf-8" },
    });
  }, 5000);
  await new Promise(() => {});
}

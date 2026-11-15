// AC-15: Node child "pipe" is a Unix socketpair; no filesystem FIFO is used.
import { register } from "node:module";
register(
  new URL("./audit-source-loader.mjs", import.meta.url),
  import.meta.url,
);
const { createStderrSink, AuditUnavailable } =
  await import("../../src/audit/sink.ts");
const sink = createStderrSink({
  write(text, callback) {
    return process.stderr.write(text, (error) => {
      callbackCompleted = true;
      callback(error);
    });
  },
  on(event, listener) {
    process.stderr.on(event, listener);
  },
});
let callbackCompleted = false;
// Exactly 8 MiB, finite regardless of backpressure; the parent never reads fd 2.
const block = Buffer.alloc(64 * 1024, 0x78);
for (let index = 0; index < 128; index++) process.stderr.write(block);
const started = performance.now();
process.send?.({ status: "append-start" });
try {
  await sink.append({
    ts: "2026-11-15T00:00:00.000Z",
    event: "intent",
    op: "0f".repeat(16),
    identity: { kind: "stdio" },
    tool: "kdrive_rename",
    kind: "rename",
    drive: 101,
    ids: { target: 42 },
  });
  process.send?.({
    status: "unexpected-success",
    elapsed: performance.now() - started,
  });
} catch (error) {
  const valid =
    error instanceof AuditUnavailable &&
    error.message === "AUDIT_UNAVAILABLE" &&
    sink.latched &&
    !callbackCompleted;
  process.send?.({
    status: valid ? "timeout-latched-callback-pending" : "invalid-failure",
    elapsed: performance.now() - started,
  });
}
// Parent owns forced cleanup, including assertion failures; no natural exit assumption.
setInterval(() => undefined, 1000);

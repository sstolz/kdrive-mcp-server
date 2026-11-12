// F-016 AC-09: one writer process appending fixed-size records to one file.
import { openFileSink, serializeAuditRecord } from "../../dist/audit/sink.js";
const [path, label, count] = process.argv.slice(2);
const record = (index, sub) => ({
  ts: "2026-11-09T10:00:00.000Z",
  event: "intent",
  op: index.toString(16).padStart(32, "0"),
  identity: { kind: "oauth", iss: "i", sub },
  tool: "kdrive_rename",
  kind: "rename",
  drive: 101,
  ids: { target: 42 },
});
const base = serializeAuditRecord(record(0, label)).length;
const sub = label + "x".repeat(8000 - base);
const sink = await openFileSink(path);
await Promise.all(
  Array.from({ length: Number(count) }, (_, index) =>
    sink.append(record(index, sub)),
  ),
);
await sink.close();

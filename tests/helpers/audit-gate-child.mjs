// F-016 AC-20: a gate process killed with SIGKILL inside its mutator.
import { openFileSink } from "../../dist/audit/sink.js";
import { createMutationGate } from "../../dist/mutation-gate.js";
const [path] = process.argv.slice(2);
const sink = await openFileSink(path);
const gate = createMutationGate({
  mode: "write",
  sink,
  mutators: {
    rename: () => {
      process.kill(process.pid, "SIGKILL");
      return new Promise(() => undefined);
    },
  },
  random: (n) => new Uint8Array(n).fill(0xcd),
  clock: () => new Date("2026-11-09T10:00:00.000Z"),
  now: () => performance.now(),
  diagnostic: () => undefined,
});
await gate.run({
  tool: "kdrive_rename",
  operation: { kind: "rename", target: { driveId: 101, id: 42 }, name: "n" },
  identity: { kind: "stdio" },
  dispatch: async (op) => ({ ok: true, value: await gate.execute(op) }),
});

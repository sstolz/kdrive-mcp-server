// F-016 audit sink: AC-01, AC-03, AC-06–AC-09, AC-20, AC-27 (sink side).
import { spawn, execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_OPEN_FAILED_MESSAGE,
  createStderrSink,
  openAuditSink,
  openFileSink,
  serializeAuditRecord,
  type AuditFilePort,
  type AuditRecord,
} from "../src/audit/sink.js";

afterEach(() => {
  vi.useRealTimers();
});

const intent: AuditRecord = {
  ts: "2026-11-09T10:00:00.000Z",
  event: "intent",
  op: "0f".repeat(16),
  identity: { kind: "stdio" },
  tool: "kdrive_rename",
  kind: "rename",
  drive: 101,
  ids: { target: 42 },
};
const COMMON = ["v", "ts", "event", "op", "identity", "tool", "kind", "drive"];
const directory = () => mkdtempSync(join(tmpdir(), "kdrive-audit-"));

interface FakePortState {
  calls: string[];
  writes: Uint8Array[];
  write?: (data: Uint8Array) => Promise<number>;
  fdatasync?: () => Promise<void>;
}
function fakePort(state: FakePortState): AuditFilePort {
  return {
    open: () => Promise.resolve(3),
    fstat: () =>
      Promise.resolve({ isFile: () => true, uid: 1000, mode: 0o100600 }),
    geteuid: () => 1000,
    write: (_fd, data) => {
      state.calls.push("write");
      state.writes.push(data);
      return state.write ? state.write(data) : Promise.resolve(data.length);
    },
    fdatasync: () => {
      state.calls.push("fdatasync");
      return state.fdatasync ? state.fdatasync() : Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}
function errno(code: string) {
  return Object.assign(new Error(`synthetic ${code}`), { code });
}
function streamOf(lines: string[]) {
  return {
    write(chunk: string, callback: (error?: Error | null) => void) {
      lines.push(chunk);
      callback();
      return true;
    },
  };
}

describe("BR-234 record schema", () => {
  it("TestBR234_intent_matches_the_spec_example_and_member_order", () => {
    const line = serializeAuditRecord(intent);
    expect(line).toBe(
      `{"v":1,"ts":"2026-11-09T10:00:00.000Z","event":"intent","op":"${"0f".repeat(16)}","identity":{"kind":"stdio"},"tool":"kdrive_rename","kind":"rename","drive":101,"ids":{"target":42}}\n`,
    );
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });

  it.each([
    [
      "outcome succeeded",
      {
        ...intent,
        event: "outcome",
        result: "succeeded",
        attempts: 1,
        ms: 12,
        status: 201,
        created: 77,
      },
      [...COMMON, "ids", "result", "attempts", "ms", "status", "created"],
    ],
    [
      "outcome failed",
      {
        ...intent,
        event: "outcome",
        result: "failed",
        attempts: 0,
        ms: 0,
        code: "AUDIT_UNAVAILABLE",
      },
      [...COMMON, "ids", "result", "attempts", "ms", "code"],
    ],
    [
      "outcome uncertain",
      {
        ...intent,
        event: "outcome",
        result: "uncertain",
        attempts: 1,
        ms: 30000,
        status: 503,
        code: "UPSTREAM_UNCERTAIN",
      },
      [...COMMON, "ids", "result", "attempts", "ms", "status", "code"],
    ],
    [
      "denied cross-drive",
      {
        ...intent,
        event: "denied",
        tool: "kdrive_move",
        kind: "move",
        destinationDrive: 102,
        ids: { target: 42, destination: 5 },
        code: "ACCESS_DENIED",
      },
      [...COMMON, "destinationDrive", "ids", "code"],
    ],
  ] as [string, AuditRecord, string[]][])(
    "TestBR234_%s_has_exactly_its_members_in_order",
    (_name, record, members) => {
      const line = serializeAuditRecord(record);
      expect(line.endsWith("\n")).toBe(true);
      expect(line.split("\n")).toHaveLength(2);
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(members);
      expect(Object.keys(parsed.identity as object)).toEqual(["kind"]);
    },
  );

  it("TestBR234_ids_keep_target_then_destination", () => {
    const parsed = JSON.parse(
      serializeAuditRecord({
        ...intent,
        tool: "kdrive_move",
        kind: "move",
        ids: { destination: 5, target: 42 },
      }),
    ) as { ids: object };
    expect(Object.keys(parsed.ids)).toEqual(["target", "destination"]);
  });
});

describe("BR-236 escaping and size", () => {
  it("TestBR236_identity_controls_and_non_ascii_are_escaped_on_one_line", () => {
    const sub = "a\nb\rc\u0000d\u007Fe\u0085f\u009Bg\u202Eh\u2028i";
    const line = serializeAuditRecord({
      ...intent,
      identity: { kind: "oauth", iss: "https://issuer.test", sub },
    });
    expect(line.indexOf("\n")).toBe(line.length - 1);
    expect(/^[\x20-\x7E]*\n$/u.test(line)).toBe(true);
    for (const escape of [
      "\\n",
      "\\r",
      "\\u0000",
      "\\u007f",
      "\\u0085",
      "\\u009b",
      "\\u202e",
      "\\u2028",
    ])
      expect(line).toContain(escape);
    const parsed = JSON.parse(line) as { identity: { sub: string } };
    expect(parsed.identity.sub).toBe(sub);
    expect(Object.keys(parsed.identity)).toEqual(["kind", "iss", "sub"]);
  });

  it("TestBR236_an_8193_byte_record_rejects_without_io_and_does_not_latch", async () => {
    const state: FakePortState = { calls: [], writes: [] };
    const sink = await openFileSink("/synthetic/audit.log", {
      port: fakePort(state),
    });
    const base = serializeAuditRecord({
      ...intent,
      identity: { kind: "oauth", iss: "i", sub: "" },
    }).length;
    const oversize: AuditRecord = {
      ...intent,
      identity: { kind: "oauth", iss: "i", sub: "s".repeat(8193 - base) },
    };
    expect(Buffer.byteLength(serializeAuditRecord(oversize))).toBe(8193);
    const exact: AuditRecord = {
      ...intent,
      identity: { kind: "oauth", iss: "i", sub: "s".repeat(8192 - base) },
    };
    await expect(sink.append(oversize)).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(state.calls).toEqual([]);
    expect(sink.latched).toBe(false);
    await sink.append(exact);
    expect(state.calls).toEqual(["write", "fdatasync"]);
    expect(state.writes[0]?.length).toBe(8192);
  });
});

describe("BR-238 sink selection", () => {
  it("TestBR238_stderr_selects_the_stream_and_writes_no_file", async () => {
    const lines: string[] = [];
    const port = { ...fakePort({ calls: [], writes: [] }), open: vi.fn() };
    const sink = await openAuditSink("stderr", {
      stderr: streamOf(lines),
      port,
    });
    await sink.append(intent);
    expect(lines).toEqual([serializeAuditRecord(intent)]);
    expect(port.open).not.toHaveBeenCalled();
  });
});

describe("BR-239 file sink checks", () => {
  it("TestBR239_a_missing_file_is_created_with_mode_0600", async () => {
    const path = join(directory(), "audit.log");
    const sink = await openAuditSink(path, { stderr: streamOf([]) });
    await sink.append(intent);
    await sink.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe(serializeAuditRecord(intent));
  });

  it("TestBR239_an_existing_private_file_is_appended", async () => {
    const path = join(directory(), "audit.log");
    writeFileSync(path, "earlier\n", { mode: 0o600 });
    const sink = await openFileSink(path);
    await sink.append(intent);
    await sink.close();
    expect(readFileSync(path, "utf8")).toBe(
      `earlier\n${serializeAuditRecord(intent)}`,
    );
  });

  it.each([
    [
      "symlink",
      (dir: string) => {
        const target = join(dir, "target");
        writeFileSync(target, "keep\n", { mode: 0o600 });
        symlinkSync(target, join(dir, "audit.log"));
        return target;
      },
    ],
    [
      "directory",
      (dir: string) => {
        mkdirSync(join(dir, "audit.log"), { mode: 0o700 });
        return join(dir, "audit.log");
      },
    ],
    [
      "fifo",
      (dir: string) => {
        execFileSync("mkfifo", ["-m", "0600", join(dir, "audit.log")]);
        return join(dir, "audit.log");
      },
    ],
    [
      "group-readable file",
      (dir: string) => {
        writeFileSync(join(dir, "audit.log"), "keep\n");
        chmodSync(join(dir, "audit.log"), 0o640);
        return join(dir, "audit.log");
      },
    ],
  ] as [string, (dir: string) => string][])(
    "TestBR239_a_%s_stops_startup_unchanged",
    async (_name, prepare) => {
      const dir = directory();
      const target = prepare(dir);
      const before = lstatSync(target);
      const content = before.isFile() ? readFileSync(target, "utf8") : "";
      await expect(
        openAuditSink(join(dir, "audit.log"), { stderr: streamOf([]) }),
      ).rejects.toThrow(AUDIT_OPEN_FAILED_MESSAGE);
      const after = lstatSync(target);
      expect(after.mode).toBe(before.mode);
      expect(after.uid).toBe(before.uid);
      if (before.isFile()) expect(readFileSync(target, "utf8")).toBe(content);
    },
  );

  it("TestBR239_an_unwritable_parent_stops_startup_and_creates_nothing", async () => {
    const dir = join(directory(), "locked");
    mkdirSync(dir, { mode: 0o500 });
    await expect(openFileSink(join(dir, "audit.log"))).rejects.toThrow(
      AUDIT_OPEN_FAILED_MESSAGE,
    );
    chmodSync(dir, 0o700);
    expect(() => statSync(join(dir, "audit.log"))).toThrow();
  });

  it("TestBR239_another_owner_is_refused", async () => {
    const port = {
      ...fakePort({ calls: [], writes: [] }),
      geteuid: () => 1001,
    };
    await expect(
      openFileSink("/synthetic/audit.log", { port }),
    ).rejects.toThrow(AUDIT_OPEN_FAILED_MESSAGE);
  });
});

describe("BR-240 append durability", () => {
  it("TestBR240_file_append_resolves_after_one_write_and_one_fdatasync", async () => {
    let finishWrite!: (n: number) => void, finishSync!: () => void;
    const state: FakePortState = {
      calls: [],
      writes: [],
      write: (data) =>
        new Promise<number>((r) => {
          finishWrite = () => {
            r(data.length);
          };
        }),
      fdatasync: () =>
        new Promise<void>((r) => {
          finishSync = r;
        }),
    };
    const sink = await openFileSink("/synthetic/audit.log", {
      port: fakePort(state),
    });
    let done = false;
    const append = sink.append(intent).then(() => (done = true));
    await vi.waitFor(() => {
      expect(state.calls).toEqual(["write"]);
    });
    finishWrite(0);
    await vi.waitFor(() => {
      expect(state.calls).toEqual(["write", "fdatasync"]);
    });
    expect(done).toBe(false);
    finishSync();
    await append;
    expect(done).toBe(true);
    expect(Buffer.from(state.writes[0] ?? []).toString()).toBe(
      serializeAuditRecord(intent),
    );
    expect(state.writes).toHaveLength(1);
  });

  it("TestBR240_stderr_append_waits_for_the_write_callback", async () => {
    let callback!: (error?: Error | null) => void;
    const chunks: string[] = [];
    const sink = createStderrSink({
      write(chunk, cb) {
        chunks.push(chunk);
        callback = cb;
        return true;
      },
    });
    let done = false;
    const append = sink.append(intent).then(() => (done = true));
    await vi.waitFor(() => {
      expect(chunks).toHaveLength(1);
    });
    await new Promise((r) => setImmediate(r));
    expect(done).toBe(false);
    callback();
    await append;
    expect(chunks).toEqual([serializeAuditRecord(intent)]);
  });
});

describe("BR-241 latching", () => {
  it.each([
    ["ENOSPC", { write: () => Promise.reject(errno("ENOSPC")) }],
    ["EACCES", { write: () => Promise.reject(errno("EACCES")) }],
    ["short write", { write: () => Promise.resolve(10) }],
    ["fdatasync failure", { fdatasync: () => Promise.reject(errno("EIO")) }],
  ] as [string, Partial<FakePortState>][])(
    "TestBR241_%s_rejects_and_latches",
    async (_name, failure) => {
      const state: FakePortState = { calls: [], writes: [], ...failure };
      const sink = await openFileSink("/synthetic/audit.log", {
        port: fakePort(state),
      });
      await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
      expect(sink.latched).toBe(true);
      const calls = state.calls.length;
      await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
      expect(state.calls).toHaveLength(calls);
    },
  );

  it("TestBR241_an_EPIPE_stream_error_latches_the_stderr_sink", async () => {
    const listeners: ((error: Error) => void)[] = [];
    const chunks: string[] = [];
    const sink = createStderrSink({
      write(chunk, cb) {
        chunks.push(chunk);
        cb();
        return true;
      },
      on(_event, listener) {
        listeners.push(listener);
      },
    });
    await sink.append(intent);
    for (const listener of listeners) listener(errno("EPIPE"));
    expect(sink.latched).toBe(true);
    await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(chunks).toHaveLength(1);
  });

  it("TestBR241_a_failing_write_callback_latches_the_stderr_sink", async () => {
    let calls = 0;
    const sink = createStderrSink({
      write(_chunk, cb) {
        calls++;
        cb(errno("EPIPE"));
        return false;
      },
    });
    await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
    await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(calls).toBe(1);
  });
});

describe("BR-242 ordering and concurrent writers", () => {
  it("TestBR242_appends_are_written_one_at_a_time_in_call_order", async () => {
    const pending: (() => void)[] = [];
    const state: FakePortState = {
      calls: [],
      writes: [],
      write: (data) =>
        new Promise<number>((r) => {
          pending.push(() => {
            r(data.length);
          });
        }),
    };
    const sink = await openFileSink("/synthetic/audit.log", {
      port: fakePort(state),
    });
    const ops = ["a", "b", "c"].map((c) => c.repeat(32));
    const appends = ops.map((op) => sink.append({ ...intent, op }));
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => {
        expect(pending).toHaveLength(i + 1);
      });
      expect(state.writes).toHaveLength(i + 1);
      pending[i]?.();
    }
    await Promise.all(appends);
    expect(
      state.writes.map(
        (w) => (JSON.parse(Buffer.from(w).toString()) as { op: string }).op,
      ),
    ).toEqual(ops);
  });

  it("TestBR242_two_processes_appending_8000_byte_records_never_share_a_line", async () => {
    const path = join(directory(), "audit.log");
    const child = (label: string) =>
      new Promise<number | null>((done) => {
        const process_ = spawn(
          process.execPath,
          [resolve("tests/helpers/audit-child.mjs"), path, label, "1000"],
          { stdio: ["ignore", "ignore", "inherit"] },
        );
        process_.on("exit", done);
      });
    expect(await Promise.all([child("a"), child("b")])).toEqual([0, 0]);
    const lines = readFileSync(path, "utf8").split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(2000);
    const seen: Record<string, number[]> = { a: [], b: [] };
    for (const line of lines) {
      expect(Buffer.byteLength(line) + 1).toBe(8000);
      const record = JSON.parse(line) as {
        op: string;
        identity: { sub: string };
      };
      seen[record.identity.sub.charAt(0)]?.push(Number.parseInt(record.op, 16));
    }
    for (const label of ["a", "b"]) {
      const order = seen[label] ?? [];
      expect(order).toHaveLength(1000);
      expect(order).toEqual(order.toSorted((x, y) => x - y));
    }
  }, 60_000);
});

describe("BR-253 orphan intent after a crash", () => {
  it("TestBR253_a_killed_process_leaves_its_intent_last_for_its_op", async () => {
    const path = join(directory(), "audit.log");
    const signal = await new Promise<NodeJS.Signals | null>((done) => {
      const child = spawn(
        process.execPath,
        [resolve("tests/helpers/audit-gate-child.mjs"), path],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
      child.on("exit", (_code, killed) => {
        done(killed);
      });
    });
    expect(signal).toBe("SIGKILL");
    const first = readFileSync(path, "utf8");
    const { createMutationGate } = await import("../src/mutation-gate.js");
    const sink = await openFileSink(path);
    const gate = createMutationGate({
      mode: "write",
      sink,
      mutators: {
        rename: () =>
          Promise.resolve({ outcome: "response", status: 200, accepted: true }),
      },
      random: (n) => new Uint8Array(n).fill(0xab),
      clock: () => new Date("2026-11-09T10:00:01.000Z"),
      now: () => performance.now(),
      diagnostic: () => undefined,
    });
    const result = await gate.run({
      tool: "kdrive_rename",
      operation: {
        kind: "rename",
        target: { driveId: 101, id: 42 },
        name: "next",
      },
      identity: { kind: "stdio" },
      dispatch: async (op) => ({ ok: true, value: await gate.execute(op) }),
    });
    await gate.close();
    expect(result.result).toBe("succeeded");
    const lines = readFileSync(path, "utf8").split("\n").slice(0, -1);
    expect(lines).toHaveLength(3);
    const records = lines.map(
      (l) => JSON.parse(l) as { event: string; op: string },
    );
    expect(`${lines[0] ?? ""}\n`).toBe(first);
    expect(records[0]?.event).toBe("intent");
    expect(records.filter((r) => r.op === records[0]?.op)).toHaveLength(1);
    expect(records.slice(1).map((r) => [r.event, r.op])).toEqual([
      ["intent", "ab".repeat(16)],
      ["outcome", "ab".repeat(16)],
    ]);
  }, 30_000);
});

describe("BR-259 file append bound", () => {
  it("TestBR259_a_stalled_fdatasync_rejects_and_latches_after_5000_ms", async () => {
    vi.useFakeTimers();
    const state: FakePortState = {
      calls: [],
      writes: [],
      fdatasync: () => new Promise<void>(() => undefined),
    };
    const sink = await openFileSink("/synthetic/audit.log", {
      port: fakePort(state),
    });
    let outcome: string | undefined;
    sink.append(intent).then(
      () => (outcome = "resolved"),
      () => (outcome = "rejected"),
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("rejected");
    expect(sink.latched).toBe(true);
  });
});

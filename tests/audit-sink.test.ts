// F-016 audit sink: AC-01, AC-03, AC-06–AC-09, AC-20, AC-27 (sink side).
import { spawn, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  constants,
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
  AuditUnavailable,
  type AuditSink,
  createStderrSink,
  openAuditSink,
  openFileSink,
  serializeAuditRecord,
  type AuditFilePort,
  type AuditRecord,
} from "../src/audit/sink.js";

afterEach(() => {
  vi.restoreAllMocks();
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

describe("F-045 audit open flags", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const baseFlags =
    constants.O_WRONLY |
    constants.O_APPEND |
    constants.O_CREAT |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK;

  async function expectAuditOpen(platform: NodeJS.Platform, flags: number) {
    vi.stubGlobal("process", { ...process, platform });
    vi.resetModules();
    const { openFileSink: openSink } = await import("../src/audit/sink.js");
    const open = vi.fn<AuditFilePort["open"]>().mockResolvedValue(3);
    const port = { ...fakePort({ calls: [], writes: [] }), open };
    const sink = await openSink("/audit.log", { port });
    try {
      expect(open.mock.calls).toEqual([["/audit.log", flags, 0o600]]);
    } finally {
      await sink.close();
    }
  }

  it("BR-239 v2 linux preserves exact open flags", async () => {
    await expectAuditOpen("linux", baseFlags | 0o2000000);
  });

  it.each(["darwin", "win32"] as const)(
    "BR-239 v2 non-linux omits Linux close-on-exec flag",
    async (platform) => {
      await expectAuditOpen(platform, baseFlags);
    },
  );
});

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

// F-039: observers attach rejection handlers immediately and never await a promise
// expected to remain pending on the old implementation.
function auditDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function auditObserved(promise: Promise<void>) {
  const state: {
    status: "pending" | "resolved" | "rejected";
    error?: unknown;
  } = { status: "pending" };
  void promise.then(
    () => {
      state.status = "resolved";
    },
    (error: unknown) => {
      state.status = "rejected";
      state.error = error;
    },
  );
  return state;
}
async function auditTurns() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}
function auditRejected(state: ReturnType<typeof auditObserved>) {
  expect(state.status).toBe("rejected");
  expect(state.error).toBeInstanceOf(AuditUnavailable);
  expect((state.error as Error).message).toBe("AUDIT_UNAVAILABLE");
}
function auditStream() {
  const events = new EventEmitter();
  const callbacks: ((error?: Error | null) => void)[] = [];
  const lines: string[] = [];
  const end = vi.fn();
  const destroy = vi.fn();
  const stream = Object.assign(events, {
    write: vi.fn((line: string, callback: (error?: Error | null) => void) => {
      lines.push(line);
      callbacks.push(callback);
      return false;
    }),
    end,
    destroy,
  });
  return { stream, callbacks, lines, end, destroy };
}
type AuditPhase = "stderr" | "write" | "sync";
async function boundedSinkFixture(phase: AuditPhase) {
  const stderr = auditStream();
  const pending: { complete: () => void; reject: (reason: unknown) => void }[] =
    [];
  const lines: string[] = [];
  const calls: string[] = [];
  const release = auditDeferred<undefined>();
  const close = vi.fn(() => {
    calls.push("close");
    return release.promise;
  });
  const port: AuditFilePort = {
    ...fakePort({ calls: [], writes: [] }),
    write: (_fd, bytes) => {
      calls.push("write");
      lines.push(Buffer.from(bytes).toString());
      if (phase !== "write") return Promise.resolve(bytes.length);
      const work = auditDeferred<number>();
      pending.push({
        complete: () => {
          work.resolve(bytes.length);
        },
        reject: work.reject,
      });
      return work.promise;
    },
    fdatasync: () => {
      calls.push("sync");
      if (phase !== "sync") return Promise.resolve();
      const work = auditDeferred<undefined>();
      pending.push({
        complete: () => {
          work.resolve(undefined);
        },
        reject: work.reject,
      });
      return work.promise;
    },
    close,
  };
  const sink: AuditSink =
    phase === "stderr"
      ? createStderrSink(stderr.stream)
      : await openFileSink("/synthetic/f039-audit.log", { port });
  return {
    sink,
    stderr,
    calls,
    port,
    close,
    release,
    lines: phase === "stderr" ? stderr.lines : lines,
    complete(index: number, error?: Error) {
      if (phase === "stderr") stderr.callbacks[index]?.(error);
      else if (error) pending[index]?.reject(error);
      else pending[index]?.complete();
    },
  };
}

describe("F-039 bounded audit sink", () => {
  it.each(["stderr", "write", "sync", "close"] as const)(
    "TestBR259_v2_AC06_early_timer_rechecks_monotonic_deadline [%s]",
    async (phase) => {
      vi.useFakeTimers();
      let monotonic = 0;
      vi.spyOn(performance, "now").mockImplementation(() => monotonic);
      const f = await boundedSinkFixture(phase === "close" ? "write" : phase);
      const state = auditObserved(
        phase === "close" ? f.sink.close() : f.sink.append(intent),
      );
      await auditTurns();
      monotonic = 4998.6;
      await vi.advanceTimersByTimeAsync(5000);
      expect(state.status).toBe("pending");
      expect(f.sink.latched).toBe(false);
      monotonic = 4999.97;
      await vi.advanceTimersByTimeAsync(2);
      expect(state.status).toBe("pending");
      expect(f.sink.latched).toBe(false);
      monotonic = 5000;
      await vi.advanceTimersByTimeAsync(1);
      if (phase === "close") expect(state.status).toBe("resolved");
      else auditRejected(state);
      expect(f.sink.latched).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("TestBR241_v2_AC14_latch_notifies_each_listener_once_despite_throws_and_reentrancy", async () => {
    vi.useFakeTimers();
    const f = await boundedSinkFixture("write");
    const late = vi.fn(() => {
      throw new Error("SYNTHETIC_LISTENER_FAILURE");
    });
    const first = vi.fn(() => {
      f.sink.onLatch?.(late);
      f.sink.latch();
      throw new Error("SYNTHETIC_LISTENER_FAILURE");
    });
    const second = vi.fn();
    f.sink.onLatch?.(first);
    f.sink.onLatch?.(second);
    expect(() => {
      f.sink.latch();
    }).not.toThrow();
    f.sink.onLatch?.(first);
    f.sink.onLatch?.(late);
    const after = vi.fn();
    f.sink.onLatch?.(after);
    f.sink.onLatch?.(after);
    f.sink.latch();
    for (const listener of [first, second, late, after])
      expect(listener).toHaveBeenCalledTimes(1);
    const closing = auditObserved(f.sink.close());
    await auditTurns();
    expect(f.close).toHaveBeenCalledTimes(1);
    f.release.resolve(undefined);
    await auditTurns();
    expect(closing.status).toBe("resolved");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["active", "idle"] as const)(
    "TestBR241_v2_AC02_stream_error_rejects_active_queued_and_future_appends [%s]",
    async (when) => {
      vi.useFakeTimers();
      const f = auditStream();
      const sink = createStderrSink(f.stream);
      const states =
        when === "active"
          ? [0, 1, 2].map(() => auditObserved(sink.append(intent)))
          : [];
      await vi.advanceTimersByTimeAsync(100);
      expect(f.lines).toHaveLength(when === "active" ? 1 : 0);
      expect(() =>
        f.stream.emit("error", new Error("SECRET-STREAM-PAYLOAD")),
      ).not.toThrow();
      await auditTurns();
      for (const state of states) auditRejected(state);
      const future = auditObserved(sink.append(intent));
      await auditTurns();
      auditRejected(future);
      expect(sink.latched).toBe(true);
      expect(() => {
        f.callbacks[0]?.();
        f.callbacks[0]?.(new Error("LATE"));
        f.stream.emit("error", new Error("REPEATED"));
      }).not.toThrow();
      await auditTurns();
      expect(f.lines).toHaveLength(when === "active" ? 1 : 0);
      expect(f.stream.listenerCount("error")).toBeLessThanOrEqual(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  describe.each(["stderr", "write", "sync"] as const)("%s", (phase) => {
    it.each(["staggered", "simultaneous"] as const)(
      "TestBR259_v2_AC03_queue_time_is_inside_each_append_budget [%s]",
      async (arrival) => {
        vi.useFakeTimers();
        const f = await boundedSinkFixture(phase);
        const a = auditObserved(
          f.sink.append({ ...intent, op: "a".repeat(32) }),
        );
        await auditTurns();
        if (arrival === "simultaneous") {
          const b = auditObserved(f.sink.append(intent));
          const c = auditObserved(f.sink.append(intent));
          await vi.advanceTimersByTimeAsync(4999);
          expect([a.status, b.status, c.status]).toEqual([
            "pending",
            "pending",
            "pending",
          ]);
          await vi.advanceTimersByTimeAsync(1);
          for (const state of [a, b, c]) auditRejected(state);
          expect(f.lines).toHaveLength(1);
        } else {
          await vi.advanceTimersByTimeAsync(1000);
          const b = auditObserved(
            f.sink.append({ ...intent, op: "b".repeat(32) }),
          );
          await vi.advanceTimersByTimeAsync(3000);
          expect(f.lines).toHaveLength(1);
          f.complete(0);
          await auditTurns();
          expect(a.status).toBe("resolved");
          expect(
            f.lines.map((line) => (JSON.parse(line) as { op: string }).op),
          ).toEqual(["a".repeat(32), "b".repeat(32)]);
          await vi.advanceTimersByTimeAsync(1999);
          expect(b.status).toBe("pending");
          await vi.advanceTimersByTimeAsync(1);
          auditRejected(b);
        }
        expect(f.sink.latched).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it.each(
      [4999, 5000, 6000].flatMap((at) =>
        ["completion-first", "timer-first"].map((order) => ({ at, order })),
      ),
    )(
      "TestBR240_v2_AC06_success_requires_completion_before_deadline [$at/$order]",
      async ({ at, order }) => {
        vi.useFakeTimers();
        let monotonic = 0;
        vi.spyOn(performance, "now").mockImplementation(() => monotonic);
        const f = await boundedSinkFixture(phase);
        const state = auditObserved(f.sink.append(intent));
        await auditTurns();
        monotonic = at;
        if (order === "timer-first") await vi.advanceTimersByTimeAsync(at);
        f.complete(0);
        await auditTurns();
        if (at < 5000) {
          expect(state.status).toBe("resolved");
          expect(f.sink.latched).toBe(false);
        } else {
          auditRejected(state);
          expect(f.sink.latched).toBe(true);
          const future = auditObserved(f.sink.append(intent));
          await auditTurns();
          auditRejected(future);
          expect(f.lines).toHaveLength(1);
          f.complete(0, new Error("LATE-FILE-OR-CALLBACK-ERROR"));
          await auditTurns();
        }
        expect(vi.getTimerCount()).toBe(0);
      },
    );
  });

  it.each([
    "callback-error",
    "write-throw",
    "late-file-rejection",
    "backpressure-success",
    "backpressure-stall",
  ] as const)(
    "TestBR240_v2_AC06_success_requires_completion_before_deadline [%s]",
    async (row) => {
      vi.useFakeTimers();
      if (row === "late-file-rejection") {
        const f = await boundedSinkFixture("write");
        const state = auditObserved(f.sink.append(intent));
        await vi.advanceTimersByTimeAsync(5000);
        auditRejected(state);
        f.complete(0, new Error("SECRET-LATE-FILE-REJECTION"));
        await auditTurns();
        auditRejected(state);
        expect(f.calls).toEqual(["write"]);
        return;
      }
      const f = auditStream();
      if (row === "write-throw")
        f.stream.write.mockImplementation(() => {
          throw new Error("SECRET-SYNC-THROW");
        });
      const sink = createStderrSink(f.stream);
      const state = auditObserved(sink.append(intent));
      await auditTurns();
      if (row === "callback-error")
        f.callbacks[0]?.(new Error("SECRET-CALLBACK-ERROR"));
      if (row === "backpressure-success") {
        expect(state.status).toBe("pending");
        await vi.advanceTimersByTimeAsync(4999);
        f.callbacks[0]?.();
      }
      if (row === "backpressure-stall") await vi.advanceTimersByTimeAsync(5000);
      await auditTurns();
      if (row === "backpressure-success") {
        expect(state.status).toBe("resolved");
        expect(sink.latched).toBe(false);
      } else {
        auditRejected(state);
        expect(sink.latched).toBe(true);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("TestBR240_v2_AC06_success_requires_completion_before_deadline [healthy listener and timer controls]", async () => {
    vi.useFakeTimers();
    const f = auditStream();
    const sink = createStderrSink(f.stream);
    const listeners = f.stream.listenerCount("error");
    for (let index = 0; index < 24; index++) {
      const state = auditObserved(sink.append(intent));
      await auditTurns();
      f.callbacks[index]?.();
      await auditTurns();
      expect(state.status).toBe("resolved");
      expect(f.stream.listenerCount("error")).toBe(listeners);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(listeners).toBeLessThanOrEqual(1);
  });

  it("TestBR254_v2_AC07_sink_close_bounds_drain_and_release [stderr drain]", async () => {
    vi.useFakeTimers();
    const f = auditStream();
    const sink = createStderrSink(f.stream);
    const active = auditObserved(sink.append(intent));
    await auditTurns();
    const queued = auditObserved(sink.append(intent));
    const first = auditObserved(sink.close());
    const second = auditObserved(sink.close());
    await auditTurns();
    auditRejected(queued);
    expect(first.status).toBe("pending");
    expect(second.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(4999);
    expect(first.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    auditRejected(active);
    expect([first.status, second.status]).toEqual(["resolved", "resolved"]);
    expect(sink.latched).toBe(true);
    f.callbacks[0]?.();
    f.callbacks[0]?.(new Error("LATE"));
    const future = auditObserved(sink.append(intent));
    await auditTurns();
    auditRejected(future);
    expect(f.lines).toHaveLength(1);
    expect(f.end).not.toHaveBeenCalled();
    expect(f.destroy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "TestBR254_v2_AC07_sink_close_bounds_drain_and_release [release late %s]",
    async (settlement) => {
      vi.useFakeTimers();
      const f = await boundedSinkFixture("write");
      const append = auditObserved(f.sink.append(intent));
      await auditTurns();
      const close = auditObserved(f.sink.close());
      await vi.advanceTimersByTimeAsync(4000);
      f.complete(0);
      await auditTurns();
      expect(append.status).toBe("resolved");
      expect(f.calls).toEqual(["write", "sync", "close"]);
      const again = auditObserved(f.sink.close());
      await auditTurns();
      expect(again.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(999);
      expect(close.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect([close.status, again.status]).toEqual(["resolved", "resolved"]);
      expect(f.sink.latched).toBe(true);
      if (settlement === "resolve") f.release.resolve(undefined);
      else f.release.reject(new Error("LATE-RELEASE"));
      await auditTurns();
      await f.sink.close();
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["stderr-healthy", "file-healthy", "release-reject"] as const)(
    "TestBR254_v2_AC07_sink_close_bounds_drain_and_release [%s]",
    async (row) => {
      vi.useFakeTimers();
      const f = await boundedSinkFixture(
        row === "stderr-healthy" ? "stderr" : "write",
      );
      const close = auditObserved(f.sink.close());
      await auditTurns();
      if (row === "release-reject")
        f.release.reject(new Error("SECRET-RELEASE-ERROR"));
      else f.release.resolve(undefined);
      await auditTurns();
      expect(close.status).toBe("resolved");
      expect(f.sink.latched).toBe(row === "release-reject");
      await f.sink.close();
      expect(f.close).toHaveBeenCalledTimes(row === "stderr-healthy" ? 0 : 1);
      expect(f.stderr.end).not.toHaveBeenCalled();
      expect(f.stderr.destroy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  describe.each(["write", "sync"] as const)("busy file %s", (phase) => {
    it.each([
      "resolve-at-6000",
      "reject-at-6000",
      "resolve-at-11000",
      "reject-at-11000",
      "never",
    ] as const)(
      "TestBR254_v2_AC07_sink_close_bounds_drain_and_release [%s]",
      async (settlement) => {
        vi.useFakeTimers();
        const f = await boundedSinkFixture(phase);
        const append = auditObserved(f.sink.append(intent));
        await vi.advanceTimersByTimeAsync(5000);
        auditRejected(append);
        const originalCalls = [...f.calls];
        const close = auditObserved(f.sink.close());
        await auditTurns();
        expect(f.close).not.toHaveBeenCalled();
        if (settlement.endsWith("6000")) {
          await vi.advanceTimersByTimeAsync(1000);
          f.complete(
            0,
            settlement.startsWith("reject")
              ? new Error("SECRET-PORT-ERROR")
              : undefined,
          );
          await auditTurns();
          expect(f.calls).toEqual([...originalCalls, "close"]);
          expect(f.close).toHaveBeenCalledTimes(1);
        }
        const repeated = auditObserved(f.sink.close());
        await auditTurns();
        expect(repeated.status).toBe("pending");
        await vi.advanceTimersByTimeAsync(
          settlement.endsWith("6000") ? 3999 : 4999,
        );
        expect(close.status).toBe("pending");
        await vi.advanceTimersByTimeAsync(1);
        expect([close.status, repeated.status]).toEqual([
          "resolved",
          "resolved",
        ]);
        expect(f.sink.latched).toBe(true);
        if (!settlement.endsWith("6000")) {
          expect(f.close).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1000);
          if (settlement !== "never")
            f.complete(
              0,
              settlement.startsWith("reject")
                ? new Error("LATE-PORT-ERROR")
                : undefined,
            );
          await auditTurns();
          await f.sink.close();
          expect(f.calls).toEqual(originalCalls);
        } else {
          f.release.reject(new Error("LATE-RELEASE-ERROR"));
          await auditTurns();
          await f.sink.close();
          expect(f.close).toHaveBeenCalledTimes(1);
        }
        expect(vi.getTimerCount()).toBe(0);
      },
    );
  });

  it.each([
    "size",
    "short-write",
    "sync-error",
    "sync-barrier",
    "stderr-barrier",
  ] as const)(
    "TestBR241_v2_AC10_validation_and_file_failure_controls [%s]",
    async (row) => {
      vi.useFakeTimers();
      if (row === "stderr-barrier" || row === "sync-barrier") {
        const f = await boundedSinkFixture(
          row === "stderr-barrier" ? "stderr" : "sync",
        );
        const state = auditObserved(f.sink.append(intent));
        await auditTurns();
        expect(state.status).toBe("pending");
        expect(f.lines).toEqual([serializeAuditRecord(intent)]);
        if (row === "sync-barrier") expect(f.calls).toEqual(["write", "sync"]);
        f.complete(0);
        await auditTurns();
        expect(state.status).toBe("resolved");
        expect(f.sink.latched).toBe(false);
        return;
      }
      const state: FakePortState = { calls: [], writes: [] };
      if (row === "short-write")
        state.write = (data) => Promise.resolve(data.length - 1);
      if (row === "sync-error")
        state.fdatasync = () => Promise.reject(new Error("SECRET-SYNC-ERROR"));
      const sink = await openFileSink("/synthetic/f039-audit.log", {
        port: fakePort(state),
      });
      if (row === "size") {
        const record = {
          ...intent,
          identity: { kind: "oauth", iss: "i", sub: "" },
        } as const;
        const base = Buffer.byteLength(serializeAuditRecord(record));
        const sized = (bytes: number): AuditRecord => ({
          ...record,
          identity: { ...record.identity, sub: "s".repeat(bytes - base) },
        });
        await expect(sink.append(sized(8193))).rejects.toThrow(
          "AUDIT_UNAVAILABLE",
        );
        expect(state.calls).toEqual([]);
        expect(sink.latched).toBe(false);
        await sink.append(sized(8192));
        expect(state.calls).toEqual(["write", "fdatasync"]);
        expect(state.writes[0]?.byteLength).toBe(8192);
      } else {
        await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
        expect(sink.latched).toBe(true);
        await expect(sink.append(intent)).rejects.toThrow("AUDIT_UNAVAILABLE");
        expect(state.calls).toEqual(
          row === "short-write" ? ["write"] : ["write", "fdatasync"],
        );
        expect(state.writes).toHaveLength(1);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("TestBR259_v2_AC15_unread_child_stderr_pipe_keeps_append_timeout_runnable", async () => {
    vi.useRealTimers();
    expect(process.platform).toBe("linux");
    const child = spawn(
      process.execPath,
      [resolve("tests/helpers/audit-blocked-stderr-child.mjs")],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    child.stderr?.pause();
    const childState = { exited: false };
    const exit = new Promise<void>((done) => {
      child.once("exit", () => {
        childState.exited = true;
        done();
      });
      child.once("error", () => {
        childState.exited = true;
        done();
      });
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let startup: ReturnType<typeof setTimeout> | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await new Promise<{ status: string; elapsed: number }>(
        (done, fail) => {
          let started = false;
          startup = setTimeout(() => {
            fail(new Error("AC15 child did not announce append start"));
          }, 10_000);
          child.once("error", () => {
            fail(new Error("AC15 child could not start"));
          });
          child.once("exit", () => {
            fail(new Error("AC15 child exited before timeout evidence"));
          });
          child.on("message", (message: unknown) => {
            if (
              message === null ||
              typeof message !== "object" ||
              !("status" in message)
            )
              return;
            if (message.status === "append-start" && !started) {
              started = true;
              clearTimeout(startup);
              watchdog = setTimeout(() => {
                fail(new Error("AC15 append did not settle within watchdog"));
              }, 10_000);
            } else if (
              started &&
              typeof message.status === "string" &&
              "elapsed" in message &&
              typeof message.elapsed === "number"
            ) {
              done({ status: message.status, elapsed: message.elapsed });
            }
          });
        },
      );
      expect(result.status).toBe("timeout-latched-callback-pending");
      expect(result.elapsed).toBeGreaterThanOrEqual(5000);
      expect(result.elapsed).toBeLessThanOrEqual(6500);
    } finally {
      clearTimeout(startup);
      clearTimeout(watchdog);
      if (!childState.exited) child.kill("SIGKILL");
      try {
        await Promise.race([
          exit,
          new Promise<never>((_done, fail) => {
            cleanupTimer = setTimeout(() => {
              fail(new Error("AC15 child cleanup exceeded 1000 ms"));
            }, 1000);
          }),
        ]);
      } finally {
        clearTimeout(cleanupTimer);
        if (child.connected) child.disconnect();
        child.stderr?.destroy();
      }
    }
  }, 23_000);
});

// F-026: bounded invocation queue in front of the single invocation slot.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStderrSink } from "../src/audit/sink.js";
import {
  createMutationGate,
  gatedDependencies,
  type Mutator,
} from "../src/mutation-gate.js";
import { createNavigationController } from "../src/navigation.js";
import type { PolicyDependencies } from "../src/policy/index.js";
import { navigationFixture } from "./helpers/navigation.js";

const ok = (status = 200) => ({
  outcome: "response",
  status,
  accepted: status >= 200 && status < 300,
});
const renameFile = {
  kind: "rename",
  target: { driveId: 7, id: 3 },
  name: "b",
} as const;
const stdio = { kind: "stdio" } as const;
const BUSY = {
  isError: true,
  content: [{ type: "text", text: "SERVER_BUSY" }],
};
const DENIED = {
  isError: true,
  content: [{ type: "text", text: "ACCESS_DENIED" }],
};
const later = (ms: number, value: unknown) =>
  new Promise((r) =>
    setTimeout(() => {
      r(value);
    }, ms),
  );

function memory() {
  const lines: string[] = [];
  const sink = createStderrSink({
    write(chunk, callback) {
      lines.push(chunk);
      callback();
      return true;
    },
  });
  return { sink, lines };
}

async function setup(mutator: Mutator = () => Promise.resolve(ok())) {
  const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
  const m = memory();
  const spy = vi.fn<Mutator>(mutator);
  const gate = createMutationGate({
    mode: "write",
    sink: m.sink,
    mutators: { rename: spy, "create-folder": spy },
    random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    clock: () => new Date("2026-11-13T10:00:00.000Z"),
    now: () => performance.now(),
    diagnostic: () => undefined,
  });
  const deps: PolicyDependencies = gatedDependencies(f.dependencies, gate);
  const c = createNavigationController(f.config, deps, undefined, { gate });
  const original = f.inspect.getMockImplementation();
  /** Holds the next `inspect` call until the returned release is called. */
  const holdInspect = () => {
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    f.inspect.mockImplementationOnce(async (...args) => {
      await held;
      return original?.(...args);
    });
    return () => {
      release();
    };
  };
  /** The next `inspect` call never settles. */
  const hangInspect = () => {
    f.inspect.mockImplementationOnce(() => new Promise(() => undefined));
  };
  return { f, m, c, mutator: spy, holdInspect, hangInspect };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F-026 bounded invocation queue (controller)", () => {
  it("TestBR380_parallel_reads_info_then_list_both_succeed", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const info = h.c.invoke("kdrive_info", { file_id: 3 });
    const list = h.c.invoke("kdrive_list", { folder_id: 2 });
    await settle();
    expect(h.f.collection).not.toHaveBeenCalled();
    release();
    const [a, b] = await Promise.all([info, list]);
    expect(a.isError).toBeUndefined();
    expect(b.isError).toBeUndefined();
    expect(h.f.collection).toHaveBeenCalled();
  });

  it("TestBR380_parallel_reads_list_then_info_both_succeed", async () => {
    const h = await setup();
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const original = h.f.collection.getMockImplementation();
    h.f.collection.mockImplementationOnce(async (...args) => {
      await held;
      return original?.(...args);
    });
    const list = h.c.invoke("kdrive_list", { folder_id: 2 });
    await settle();
    const before = h.f.inspect.mock.calls.length;
    const info = h.c.invoke("kdrive_info", { file_id: 3 });
    await settle();
    expect(h.f.inspect.mock.calls).toHaveLength(before);
    release();
    const [a, b] = await Promise.all([list, info]);
    expect(a.isError).toBeUndefined();
    expect(b.isError).toBeUndefined();
    expect(h.f.inspect.mock.calls.length).toBeGreaterThan(before);
  });

  it("TestBR384_second_read_succeeds_after_first_times_out", async () => {
    vi.useFakeTimers();
    const h = await setup();
    h.hangInspect();
    const first = h.c.invoke("kdrive_info", { file_id: 3 });
    const second = h.c.invoke("kdrive_info", { file_id: 3 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toEqual({
      isError: true,
      content: [{ type: "text", text: "REQUEST_TIMEOUT" }],
    });
    expect((await second).isError).toBeUndefined();
  });

  it("TestBR383_read_waits_behind_mutation_without_overlap", async () => {
    vi.useFakeTimers();
    const h = await setup(() => later(2_000, ok()));
    const rename = h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(100);
    const calls = h.f.inspect.mock.calls.length;
    const info = h.c.invoke("kdrive_info", { file_id: 3 });
    await vi.advanceTimersByTimeAsync(1_800);
    expect(h.f.inspect.mock.calls).toHaveLength(calls);
    await vi.advanceTimersByTimeAsync(200);
    expect(await rename).toMatchObject({
      ok: true,
      value: { result: "succeeded" },
    });
    expect((await info).isError).toBeUndefined();
  });

  it("TestBR383_mutation_waits_behind_read_without_overlap", async () => {
    vi.useFakeTimers();
    const h = await setup();
    const original = h.f.inspect.getMockImplementation();
    h.f.inspect.mockImplementationOnce(async (...args) => {
      await later(2_000, undefined);
      return original?.(...args);
    });
    const info = h.c.invoke("kdrive_info", { file_id: 3 });
    await vi.advanceTimersByTimeAsync(100);
    const rename = h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(1_850);
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect((await info).isError).toBeUndefined();
    expect(await rename).toMatchObject({
      ok: true,
      value: { result: "succeeded" },
    });
  });

  it("TestBR383_two_mutations_run_one_after_the_other", async () => {
    vi.useFakeTimers();
    const h = await setup(() => later(1_000, ok()));
    const one = h.c.mutate("kdrive_rename", renameFile, stdio);
    const two = h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(h.m.lines).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    // The second intent append follows the first outcome record.
    expect(h.m.lines).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await one).toMatchObject({ ok: true });
    expect(await two).toMatchObject({ ok: true });
    expect(h.m.lines).toHaveLength(4);
  });

  it("TestBR381_fourth_waiting_call_is_admitted", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const waiters = [1, 2, 3, 4].map(() =>
      h.c.invoke("kdrive_info", { file_id: 3 }),
    );
    release();
    await running;
    for (const w of await Promise.all(waiters))
      expect(w.isError).toBeUndefined();
  });

  it("TestBR381_fifth_waiting_call_is_SERVER_BUSY_with_zero_requests", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const order: number[] = [];
    const waiters = [1, 2, 3, 4].map((n) =>
      h.c.invoke("kdrive_info", { file_id: 3 }).then((r) => {
        order.push(n);
        return r;
      }),
    );
    await settle();
    const calls = h.f.inspect.mock.calls.length;
    expect(await h.c.invoke("kdrive_info", { file_id: 3 })).toEqual(BUSY);
    const refused = (await h.c
      .readResource("kdrive://7/file/3")
      .catch((error: unknown) => error)) as { code: number; message: string };
    expect(refused.code).toBe(-32000);
    expect(refused.message).toContain("SERVER_BUSY");
    expect(await h.c.mutate("kdrive_rename", renameFile, stdio)).toEqual({
      ok: false,
      code: "SERVER_BUSY",
    });
    expect(h.f.inspect.mock.calls).toHaveLength(calls);
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    release();
    await running;
    for (const w of await Promise.all(waiters))
      expect(w.isError).toBeUndefined();
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("TestBR382_waiter_gets_slot_at_11999_ms", async () => {
    vi.useFakeTimers();
    const h = await setup(() => later(11_999, ok()));
    const rename = h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(0);
    const info = h.c.invoke("kdrive_info", { file_id: 3 });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await rename).toMatchObject({ ok: true });
    expect((await info).isError).toBeUndefined();
  });

  it("TestBR382_waiter_is_SERVER_BUSY_at_12000_ms_with_zero_requests", async () => {
    vi.useFakeTimers();
    const h = await setup(() => later(12_001, ok()));
    const rename = h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(0);
    const calls = h.f.inspect.mock.calls.length;
    let first: unknown;
    void h.c.invoke("kdrive_info", { file_id: 3 }).then((r) => (first = r));
    await vi.advanceTimersByTimeAsync(5_000);
    let second: unknown;
    void h.c.invoke("kdrive_info", { file_id: 3 }).then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(6_999);
    expect(first).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toEqual(BUSY);
    expect(h.f.inspect.mock.calls).toHaveLength(calls);
    await vi.advanceTimersByTimeAsync(10);
    expect(await rename).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect((second as { isError?: boolean }).isError).toBeUndefined();
  });

  it("TestBR382_waiting_mutation_is_SERVER_BUSY_with_zero_records", async () => {
    vi.useFakeTimers();
    const h = await setup();
    h.hangInspect();
    void h.c.invoke("kdrive_info", { file_id: 3 });
    let result: unknown;
    void h.c
      .mutate("kdrive_rename", renameFile, stdio)
      .then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    // The running read times out at 10 s, so hang a fresh one to hold the slot.
    h.c.close();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ ok: false, code: "ACCESS_DENIED" });
    expect(h.m.lines).toEqual([]);
    const g = await setup(() => later(30_000, ok()));
    void g.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(0);
    let waiting: unknown;
    void g.c
      .mutate("kdrive_rename", renameFile, stdio)
      .then((r) => (waiting = r));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(waiting).toEqual({ ok: false, code: "SERVER_BUSY" });
    expect(g.mutator).toHaveBeenCalledTimes(1);
    expect(g.m.lines).toHaveLength(1);
  });

  it("TestBR382_release_and_timeout_at_the_same_instant_is_SERVER_BUSY", async () => {
    vi.useFakeTimers();
    // Both callbacks due at the same instant, in both orders: the waiter
    // at 12,000 ms is refused and the next waiter takes the slot.
    const probe = await setup();
    await probe.c.invoke("kdrive_info", { file_id: 3 });
    const perInfo = probe.f.inspect.mock.calls.length;
    for (const timerFirst of [true, false]) {
      const g = await setup(() => later(12_000, ok()));
      void g.c.mutate("kdrive_rename", renameFile, stdio);
      if (!timerFirst) await vi.advanceTimersByTimeAsync(0);
      const a = g.c.invoke("kdrive_info", { file_id: 3 });
      await vi.advanceTimersByTimeAsync(1);
      const b = g.c.invoke("kdrive_info", { file_id: 3 });
      const calls = g.f.inspect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(11_999);
      expect(await a).toEqual(BUSY);
      await vi.advanceTimersByTimeAsync(0);
      expect((await b).isError).toBeUndefined();
      // Only b's own lookup ran: the refused waiter made no request.
      expect(g.f.inspect.mock.calls.length - calls).toBe(perInfo);
    }
  });

  it("TestBR383_taker_rechecks_abort_with_zero_requests", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const abort = new AbortController();
    const aborted = h.c.invoke("kdrive_info", { file_id: 3 }, abort.signal);
    const next = h.c.invoke("kdrive_info", { file_id: 3 });
    await settle();
    const calls = h.f.inspect.mock.calls.length;
    release();
    abort.abort();
    await running;
    expect(await aborted).toEqual(DENIED);
    expect((await next).isError).toBeUndefined();
    expect(h.f.inspect.mock.calls.length).toBeGreaterThan(calls);
  });

  it("TestBR385_aborted_waiter_leaves_queue_with_zero_requests", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const order: string[] = [];
    const abort = new AbortController();
    const a = h.c
      .invoke("kdrive_info", { file_id: 3 })
      .then(() => order.push("A"));
    const b = h.c.invoke("kdrive_info", { file_id: 3 }, abort.signal);
    const c = h.c
      .invoke("kdrive_info", { file_id: 3 })
      .then(() => order.push("C"));
    await settle();
    const calls = h.f.inspect.mock.calls.length;
    abort.abort();
    expect(await b).toEqual(DENIED);
    expect(h.f.inspect.mock.calls).toHaveLength(calls);
    release();
    await Promise.all([running, a, c]);
    expect(order).toEqual(["A", "C"]);
  });

  it("TestBR385_aborted_waiting_mutation_writes_no_record", async () => {
    vi.useFakeTimers();
    const h = await setup();
    h.hangInspect();
    void h.c.invoke("kdrive_info", { file_id: 3 });
    const abort = new AbortController();
    const waiting = h.c.mutate(
      "kdrive_rename",
      renameFile,
      stdio,
      abort.signal,
    );
    await vi.advanceTimersByTimeAsync(100);
    abort.abort();
    expect(await waiting).toEqual({ ok: false, code: "ACCESS_DENIED" });
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("TestBR386_close_settles_waiters_with_ACCESS_DENIED", async () => {
    vi.useFakeTimers();
    const h = await setup();
    let settledRunning = false;
    h.f.inspect.mockImplementationOnce(
      () =>
        new Promise(() => {
          // never answers, never observes the abort
        }),
    );
    void h.c
      .invoke("kdrive_info", { file_id: 3 })
      .then(() => (settledRunning = true));
    const read = h.c.invoke("kdrive_info", { file_id: 3 });
    const write = h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(10);
    const calls = h.f.inspect.mock.calls.length;
    h.c.close();
    expect(await read).toEqual(DENIED);
    expect(await write).toEqual({ ok: false, code: "ACCESS_DENIED" });
    expect(h.f.inspect.mock.calls).toHaveLength(calls);
    expect(h.m.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(await h.c.invoke("kdrive_info", { file_id: 3 })).toEqual(DENIED);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settledRunning).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TestBR383_waiters_start_in_join_order", async () => {
    vi.useFakeTimers();
    const h = await setup(() => later(10, ok()));
    const release = h.holdInspect();
    const order: string[] = [];
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const all = [
      h.c.invoke("kdrive_info", { file_id: 3 }).then(() => order.push("read")),
      h.c
        .readResource("kdrive://7/file/3")
        .catch(() => undefined)
        .then(() => order.push("resource")),
      h.c
        .mutate("kdrive_rename", renameFile, stdio)
        .then(() => order.push("mutate")),
      h.c
        .invoke("kdrive_list", { folder_id: 2 })
        .then(() => order.push("list")),
    ];
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
    await Promise.all(all);
    expect(order).toEqual(["read", "resource", "mutate", "list"]);
  });

  it("TestBR383_new_call_never_overtakes_a_waiter", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const order: string[] = [];
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const old = h.c
      .invoke("kdrive_info", { file_id: 3 })
      .then(() => order.push("old"));
    await settle();
    release();
    const fresh = h.c
      .invoke("kdrive_info", { file_id: 3 })
      .then(() => order.push("new"));
    await Promise.all([running, old, fresh]);
    expect(order).toEqual(["old", "new"]);
  });

  it("TestBR384_deadline_starts_when_the_slot_is_taken", async () => {
    vi.useFakeTimers();
    const h = await setup(() => later(9_000, ok()));
    void h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(0);
    const original = h.f.inspect.getMockImplementation();
    h.f.inspect.mockImplementationOnce(async (...args) => {
      await later(9_500, undefined);
      return original?.(...args);
    });
    const slow = h.c.invoke("kdrive_info", { file_id: 3 });
    await vi.advanceTimersByTimeAsync(9_000 + 9_500);
    expect((await slow).isError).toBeUndefined();
    void h.c.mutate("kdrive_rename", renameFile, stdio);
    await vi.advanceTimersByTimeAsync(0);
    h.hangInspect();
    let hung: unknown;
    void h.c.invoke("kdrive_info", { file_id: 3 }).then((r) => (hung = r));
    await vi.advanceTimersByTimeAsync(9_000 + 9_999);
    expect(hung).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(hung).toEqual({
      isError: true,
      content: [{ type: "text", text: "REQUEST_TIMEOUT" }],
    });
  });

  it("TestBR384_budgets_are_fresh_per_invocation", async () => {
    const h = await setup();
    const release = h.holdInspect();
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const lists = [1, 2, 3, 4].map(() =>
      h.c.invoke("kdrive_list", { folder_id: 2 }),
    );
    release();
    await running;
    for (const r of await Promise.all(lists)) expect(r.isError).toBeUndefined();
  });
});

describe("F-026 documentation", () => {
  it("TestBR387_docs_describe_queue_and_retryable_SERVER_BUSY", () => {
    const readme = readFileSync("README.md", "utf8");
    const limits = readme.slice(
      readme.indexOf("Key limits:"),
      readme.indexOf("\n\n", readme.indexOf("Key limits:") + 13),
    );
    const doc = readFileSync("docs/mcp-client-compatibility.md", "utf8");
    const section = doc.slice(doc.indexOf("\n## Parallel tool calls\n"));
    for (const raw of [limits, section]) {
      const text = raw.replace(/\s+/g, " ");
      expect(text).toContain("SERVER_BUSY");
      expect(text).toMatch(/[Uu]p to 4 further calls/);
      expect(text).toMatch(/12 seconds/);
      expect(text).toMatch(/safe to retry, writes included/);
    }
    expect(section.length).toBeGreaterThan(100);
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const unreleased = changelog.slice(
      changelog.indexOf("## [Unreleased]"),
      changelog.indexOf("\n## [", changelog.indexOf("## [Unreleased]") + 1),
    );
    expect(unreleased).toMatch(/### Fixed\n\n- #16 /);
  });
});

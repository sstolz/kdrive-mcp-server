import {
  changelogFixture,
  changelogTicketSection,
  currentRepositoryChangelog,
} from "./helpers/changelog.js";
import { ancestorFixture, structuralKinds } from "./helpers/root-ancestors.js";
import { plainItem } from "./helpers/navigation.js";
// F-026: bounded invocation queue in front of the single invocation slot.
import { getEventListeners } from "node:events";
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
import {
  contentFixture,
  contentError,
  rangeResponse,
} from "./helpers/content.js";
import { fixture as receivedFixture, node } from "./helpers/received.js";
import {
  navigationFixture,
  payload,
  projection,
} from "./helpers/navigation.js";

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
    const firsts: string[] = [];
    for (const timerFirst of [true, false]) {
      const order: string[] = [];
      const g = await setup(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              order.push("release");
              resolve(ok());
            }, 12_000),
          ),
      );
      void g.c.mutate("kdrive_rename", renameFile, stdio);
      if (!timerFirst) await vi.advanceTimersByTimeAsync(0);
      const a = g.c.invoke("kdrive_info", { file_id: 3 }).then((r) => {
        order.push("waiter");
        return r;
      });
      await vi.advanceTimersByTimeAsync(1);
      const b = g.c.invoke("kdrive_info", { file_id: 3 });
      const calls = g.f.inspect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(11_999);
      expect(await a).toEqual(BUSY);
      await vi.advanceTimersByTimeAsync(0);
      expect((await b).isError).toBeUndefined();
      // Only b's own lookup ran: the refused waiter made no request.
      expect(g.f.inspect.mock.calls.length - calls).toBe(perInfo);
      firsts.push(order[0] ?? "");
    }
    // The two passes ran the two callbacks in opposite orders.
    expect(firsts).toEqual(["waiter", "release"]);
  });

  it("TestBR383_taker_rechecks_abort_with_zero_requests", async () => {
    const probe = await setup();
    await probe.c.invoke("kdrive_info", { file_id: 3 });
    const perInfo = probe.f.inspect.mock.calls.length;
    const h = await setup();
    const release = h.holdInspect();
    const running = h.c.invoke("kdrive_info", { file_id: 3 });
    const abort = new AbortController();
    const aborted = h.c.invoke("kdrive_info", { file_id: 3 }, abort.signal);
    const next = h.c.invoke("kdrive_info", { file_id: 3 });
    await settle();
    const calls = h.f.inspect.mock.calls.length;
    // The abort lands in the same step as the release, before the running
    // invocation settles; the abort listener removes the waiter, and the
    // re-check in `next()` stays a defensive guard for the same outcome.
    release();
    abort.abort();
    await running;
    expect(await aborted).toEqual(DENIED);
    expect((await next).isError).toBeUndefined();
    // Only `next` made requests after the release: the aborted waiter none.
    expect(h.f.inspect.mock.calls.length - calls).toBe(perInfo);
  });

  it("TestBR385_aborted_waiter_leaves_queue_with_zero_requests", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    const calls = h.f.inspect.mock.calls.length,
      timers = vi.getTimerCount();
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(1);
    abort.abort();
    expect(await b).toEqual(DENIED);
    expect(h.f.inspect.mock.calls).toHaveLength(calls);
    // B's wait timer and abort listener are gone.
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(timers - 1);
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

// BR-387 v2 uses the shared parser for both real and synthetic documents,
// in Fixed-only mode: the Fixed bullet starts with `- #16 ` and no Added line
// is required.
function queueChangelogSection(changelog: string): string {
  return changelogTicketSection(
    currentRepositoryChangelog(changelog),
    "#16",
    "- #16 ",
    "",
    { fixedPrefix: "- #16 " },
  );
}

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
    // F-043 AC-01: do not derive this expectation from the selection helper.
    const expectedHeading =
      changelog
        .split("\n")
        .find((line) =>
          /^## \[0\.6\.0-beta\.2\] - \d{4}-\d{2}-\d{2}$/u.test(line),
        ) ?? "## [Unreleased]";
    expect(queueChangelogSection(changelog)).toBe(expectedHeading);
  });
});

describe("F-043 changelog sections (BR-387 v2)", () => {
  const unreleased = "## [Unreleased]";
  const beta2 = "## [0.6.0-beta.2] - 2026-11-15";
  const newer = "## [0.7.0] - 2026-12-01";
  const beta1 = "## [0.6.0-beta.1] - 2026-11-13";
  // No additional content marker is required by BR-387 v2.
  const fixed = "- #16 Queue fix.\n";
  const other = "- #7 Another change.\n";
  const citation = "- Related queue fix for #16.\n";

  it.each([
    ["no release", ""],
    ["undated release", changelogFixture(["## [0.7.0]", other, ""])],
    ["unrelated dated release", changelogFixture([newer, other, ""])],
  ])("TestBR387_v2_changelog_unreleased_fallback: %s", (_name, suffix) => {
    expect(
      queueChangelogSection(changelogFixture([unreleased, fixed, ""]) + suffix),
    ).toBe(unreleased);
  });

  it.each([
    ["no release", ""],
    ["undated release", changelogFixture(["## [0.7.0]", other, ""])],
    ["unrelated dated release", changelogFixture([newer, other, ""])],
  ])(
    "TestBR387_v2_changelog_unreleased_fallback: missing entry with %s fails",
    (_name, suffix) => {
      expect(() =>
        queueChangelogSection(changelogFixture([unreleased, "", ""]) + suffix),
      ).toThrow("missing #16 Fixed line");
    },
  );

  it.each([
    ["first Fixed bullet", beta2, fixed],
    ["later Fixed bullet", beta2, other + fixed],
    ["different release date", "## [0.6.0-beta.2] - 2026-11-30", fixed],
  ])(
    "TestBR387_v2_changelog_release_fixed_line: %s",
    (_name, heading, entry) => {
      expect(
        queueChangelogSection(
          changelogFixture([unreleased, "", ""], [heading, entry, ""]),
        ),
      ).toBe(heading);
    },
  );

  it.each([
    ["Added only", `### Added\n\n${fixed}`],
    ["Changed only", `### Changed\n\n${fixed}`],
    ["citation later in the Fixed bullet", `### Fixed\n\n${citation}`],
    [
      "prefix inside the Fixed bullet, with an Added citation",
      `### Fixed\n\n- Related - #16 Queue fix.\n\n### Added\n\n${citation}`,
    ],
    [
      "Changed citation after an unrelated Fixed entry",
      `### Fixed\n\n${other}\n### Changed\n\n${fixed}`,
    ],
  ])("TestBR387_v2_changelog_release_fixed_line: %s fails", (_name, body) => {
    expect(() =>
      queueChangelogSection(`${unreleased}\n\n${beta2}\n\n${body}`),
    ).toThrow("missing #16 Fixed line");
  });

  it.each([
    ["Unreleased #160 only", unreleased, ""],
    ["release #160 only", beta2, ""],
    ["Unreleased #16 Added cannot validate #160 Fixed", unreleased, citation],
    ["release #16 Added cannot validate #160 Fixed", beta2, citation],
  ])("TestBR387_v2_changelog_ticket_boundary: %s", (_name, heading, added) => {
    expect(() =>
      queueChangelogSection(
        changelogFixture(
          ...(heading === unreleased
            ? []
            : ([[unreleased, "", ""]] as [string, string, string][])),
          [heading, fixed.replace("#16", "#160"), added],
        ),
      ),
    ).toThrow("missing #16 Fixed line");
  });

  it.each([
    ["only older release cites #16", other, fixed, beta2],
    ["both releases cite #16", fixed, fixed, newer],
    ["no release cites #16", other, other, unreleased],
  ])(
    "TestBR387_v2_changelog_first_matching_release: %s",
    (_name, newerFixed, olderFixed, expected) => {
      expect(
        queueChangelogSection(
          changelogFixture(
            [unreleased, fixed, ""],
            [newer, newerFixed, ""],
            [beta2, olderFixed, ""],
          ),
        ),
      ).toBe(expected);
    },
  );

  it("TestBR387_v2_changelog_first_matching_release: file order wins over version order", () => {
    expect(
      queueChangelogSection(
        changelogFixture(
          [unreleased, "", ""],
          [beta2, fixed, ""],
          [newer, fixed, ""],
        ),
      ),
    ).toBe(beta2);
  });

  it.each([
    ["valid older release", "", fixed],
    ["valid Unreleased", fixed, other],
  ])(
    "TestBR387_v2_changelog_first_matching_release: newer Added citation blocks %s",
    (_name, unreleasedFixed, olderFixed) => {
      expect(() =>
        queueChangelogSection(
          changelogFixture(
            [unreleased, unreleasedFixed, ""],
            [newer, other, citation],
            [beta2, olderFixed, ""],
          ),
        ),
      ).toThrow("missing #16 Fixed line");
    },
  );

  it.each([
    ["at the archive cutoff", changelogFixture([beta1, fixed, ""])],
    [
      "after the archive cutoff",
      changelogFixture(
        [beta1, other, ""],
        ["## [0.5.0] - 2026-10-01", fixed, ""],
      ),
    ],
  ])(
    "TestBR387_v2_changelog_archive_cutoff_and_empty_section: #16 %s fails",
    (_name, suffix) => {
      expect(() =>
        queueChangelogSection(changelogFixture([unreleased, "", ""]) + suffix),
      ).toThrow("missing #16 Fixed line");
    },
  );

  it.each([
    ["at the archive cutoff", changelogFixture([beta1, fixed, ""])],
    [
      "after the archive cutoff",
      changelogFixture(
        [beta1, other, ""],
        ["## [0.5.0] - 2026-10-01", fixed, ""],
      ),
    ],
  ])(
    "TestBR387_v2_changelog_archive_cutoff_and_empty_section: Unreleased wins over #16 %s",
    (_name, suffix) => {
      expect(
        queueChangelogSection(
          changelogFixture([unreleased, fixed, ""]) + suffix,
        ),
      ).toBe(unreleased);
    },
  );

  it.each([
    ["heading only", unreleased],
    [
      "cannot borrow from preceding undated section",
      changelogFixture(["## [0.7.0]", fixed, ""]) + unreleased,
    ],
    ["heading with final newline", `${unreleased}\n`],
  ])(
    "TestBR387_v2_changelog_archive_cutoff_and_empty_section: %s fails",
    (_name, fixture) => {
      expect(() => queueChangelogSection(fixture)).toThrow(
        "missing #16 Fixed line",
      );
    },
  );
});

it("TestBR384_v2_AC06_waiting_and_prior_operations_do_not_spend_stream_deadline", async () => {
  vi.useFakeTimers();
  const f = await receivedFixture();
  const raw = await contentFixture({}, Buffer.alloc(600));
  const roots = Array.from({ length: 255 }, (_, i) => ({
    ...node(100 + i, `root${i}`, "dir"),
    anchorId: 100 + i,
  }));
  let pages = 0;
  f.received.list.mockImplementation(async (request) => {
    await Promise.resolve();
    const first = pages++ % 2 === 0;
    return {
      ...request,
      status: "complete",
      discover: true,
      entries: first ? [roots[0]!] : roots.slice(1),
      ...(first ? { next: "page2" } : { terminal: true }),
    };
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inspections = 0;
  f.received.inspect.mockImplementation(async (target) => {
    // The second invocation also spends 512 operations, then holds the slot.
    if (++inspections === 1020) await held;
    return structuredClone(
      roots.find((r) => r.id === target.id) ?? { status: "missing" },
    );
  });
  let finishRead!: (value: unknown) => void;
  const readHeld = new Promise<unknown>((resolve) => {
    finishRead = resolve;
  });
  const response = rangeResponse(
    {
      target: { driveId: 7, id: 3 },
      start: 0,
      end: 599,
      size_bytes: 600,
      etag: raw.etag,
    },
    raw.bytes,
  );
  response.body.read.mockImplementation(() => readHeld);
  raw.content.open.mockResolvedValue(response);
  const c = createNavigationController(f.config, {
    ...raw.dependencies,
    received: f.received,
  });
  const args = { drive_id: 8, path: "/Shared/root0" };
  const first = c.invoke("kdrive_resolve_path", args);
  try {
    expect(payload(await first)).toEqual({ item: projection(roots[0]!) });
    expect(f.received.list.mock.calls.length + inspections).toBe(512);
    // Expire completed evidence; the next invocation must perform another 512 operations.
    f.clock.value = 60000;
    const second = c.invoke("kdrive_resolve_path", args);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.received.list.mock.calls.length + inspections).toBe(1024);
    const settled = vi.fn();
    const stream = c.invoke("kdrive_download", { file_id: 3 }).then((value) => {
      settled(value);
      return value;
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(f.received.list.mock.calls.length + inspections).toBe(1024);
    expect(raw.content.open).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(payload(await second)).toEqual({ item: projection(roots[0]!) });
    expect(f.received.list.mock.calls.length + inspections).toBe(1024);
    expect(response.body.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await stream).toEqual(contentError("REQUEST_TIMEOUT"));
    expect(performance.now()).toBe(19000);
    expect(response.body.close).toHaveBeenCalledOnce();
    finishRead(raw.bytes);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledOnce();
    expect(response.body.read).toHaveBeenCalledOnce();
    expect(response.body.close).toHaveBeenCalledOnce();
    expect(raw.content.describe).toHaveBeenCalledOnce();
    expect(raw.content.open).toHaveBeenCalledOnce();
    expect(
      (await c.invoke("kdrive_info", { file_id: 3 })).isError,
    ).toBeUndefined();
  } finally {
    release();
    c.close();
    await first;
  }
});

// F-041 AC-08: bounded evidence, through the real mutation tool projection.
it.each(
  structuralKinds.flatMap((kind) =>
    ["deadline", "cancel", "budget-exhaustion"].map((row) => ({ kind, row })),
  ),
)(
  "TestBR427_AC08_root_reads_share_existing_invocation_bounds $row $kind",
  async ({ kind, row }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const roots = Array.from({ length: 255 }, (_, i) => 1000 + i);
    const f = await ancestorFixture(
      row === "budget-exhaustion"
        ? {
            KDRIVE_MCP_ROOTS: ["101:1", ...roots.map((id) => `101:${id}`)].join(
              ",",
            ),
            KDRIVE_MCP_DENY: "/blocked/**",
            KDRIVE_MCP_MAX_TREE_ITEMS: "1000",
          }
        : {},
    );
    for (const id of roots)
      f.nodes.set(
        `101:${id}`,
        plainItem(id, `/R${id}`, "dir", [f.sentinel], 101),
      );
    // AC-08 precondition correction: configuration caps roots at 256 entries.
    // 255 non-sentinel roots plus a 257-directory deny traversal share 512 calls.
    if (row === "budget-exhaustion") {
      let parent = f.sibling;
      for (let i = 0; i < 257; i++) {
        const child = plainItem(
          2000 + i,
          `${parent.path}/d`,
          "dir",
          [...parent.parents, parent],
          101,
        );
        f.nodes.set(`101:${child.id}`, child);
        parent = child;
      }
      // Use the request-aware port below rather than a paged collection budget.
      f.children.mockImplementation((request) =>
        Promise.resolve({
          ...request,
          status: "complete",
          terminal: true,
          entries: [...f.nodes.values()].filter(
            (n) => n.parents.at(-1)?.id === request.id,
          ),
        }),
      );
    }
    const m = memory();
    const mutator = vi.fn<Mutator>(() => Promise.resolve(ok()));
    const gate = createMutationGate({
      mode: "write",
      sink: m.sink,
      mutators: { [kind]: mutator },
      clock: () => new Date("2026-11-15T00:00:00.000Z"),
      now: () => performance.now(),
      random: (n) => new Uint8Array(n),
      diagnostic: () => undefined,
    });
    const c = createNavigationController(
      f.config,
      gatedDependencies(f.dependencies, gate),
      undefined,
      { gate },
    );
    const abort = new AbortController();
    let release!: (value: unknown) => void;
    const pendingRoot = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const original = f.inspect.getMockImplementation()!;
    f.inspect.mockImplementation((ref) =>
      ref.id === 40 && row !== "budget-exhaustion"
        ? pendingRoot
        : original(ref),
    );
    try {
      const pending = c.invokeMutation(
        `kdrive_${kind}`,
        {
          file_id: 20,
          ...(kind === "rename" ? { name: "New" } : {}),
          ...(kind === "move" ? { destination_folder_id: 30 } : {}),
        },
        stdio,
        abort.signal,
      );
      await vi.advanceTimersByTimeAsync(0);
      if (row === "deadline") await vi.advanceTimersByTimeAsync(10_000);
      if (row === "cancel") abort.abort();
      const result = await pending;
      const codes: Record<string, string> = {
        deadline: "REQUEST_TIMEOUT",
        cancel: "CANCELLED",
        "budget-exhaustion": "LIMIT_EXCEEDED",
      };
      const code = codes[row];
      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              result: "failed",
              op: "0".repeat(32),
              code,
              attempts: 0,
            }),
          },
        ],
      });
      expect(mutator).not.toHaveBeenCalled();
      expect(m.lines).toEqual([]);
      if (row === "budget-exhaustion") {
        expect(f.inspect).toHaveBeenCalledTimes(kind === "move" ? 257 : 256);
        expect(
          f.inspect.mock.calls.length +
            vi.mocked(f.dependencies.children).mock.calls.length,
        ).toBe(512);
      } else
        expect(
          f.inspect.mock.calls.filter(([ref]) => ref.id === 40),
        ).toHaveLength(1);
      release(f.root);
      await vi.advanceTimersByTimeAsync(0);
      expect(mutator).not.toHaveBeenCalled();
      expect(m.lines).toEqual([]);
    } finally {
      release(f.root);
      c.close();
      await gate.close();
    }
  },
);

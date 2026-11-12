// F-014 AC-04 (BR-193): deadlines and cancellation with fake timers.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE,
  STORAGE_HOST,
  adapterFor,
  kdriveFixture,
  type Reply,
  type Seen,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await fixture?.close();
  fixture = undefined;
});
const target = { driveId: DRIVE, id: 12 };
const tick = () => new Promise<void>((r) => setImmediate(r));
async function until(condition: () => boolean) {
  for (let i = 0; i < 2000 && !condition(); i++) await tick();
  expect(condition()).toBe(true);
}
async function setup(override: (r: Seen) => Reply | undefined) {
  const f = (fixture = await kdriveFixture());
  f.drive.overrides.push(override);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  return { f, a: await adapterFor(f) };
}
function settled(promise: Promise<unknown>) {
  const state = { done: false, error: undefined as unknown };
  promise.then(
    () => (state.done = true),
    (error: unknown) => {
      state.done = true;
      state.error = error;
    },
  );
  return state;
}

describe("BR-193 deadlines", () => {
  it("TestBR193_stalled_JSON_body_rejects_at_5000_ms_and_destroys_the_socket", async () => {
    const { f, a } = await setup((r) =>
      r.path === "/3/drive/101/files/12"
        ? { stall: "body", headers: { "content-type": "application/json" } }
        : undefined,
    );
    const state = settled(a.dependencies.inspect(target, "live"));
    await until(
      () => f.upstream.sockets.size === 1 && f.upstream.seen.length === 1,
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => state.done);
    expect((state.error as Error).message).toBe("READ_UNAVAILABLE");
    await until(() => f.upstream.sockets.size === 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TestBR193_stalled_download_headers_on_the_second_hop_reject_within_5000_ms_total", async () => {
    const { f, a } = await setup((r) =>
      r.host === STORAGE_HOST ? { stall: "headers" } : undefined,
    );
    const state = settled(
      a.dependencies.content.open(
        { target, start: 0, end: 3, size_bytes: 16, etag: '"x"' },
        new AbortController().signal,
      ),
    );
    await until(() => f.upstream.seen.some((s) => s.host === STORAGE_HOST));
    await vi.advanceTimersByTimeAsync(5000);
    await until(() => state.done);
    expect((state.error as Error).message).toBe("READ_UNAVAILABLE");
    await until(() => f.upstream.sockets.size === 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TestBR193_stalled_body_read_rejects_at_5000_ms", async () => {
    const { f, a } = await setup((r) =>
      r.host === STORAGE_HOST
        ? {
            stall: "body",
            status: 206,
            headers: {
              "content-range": "bytes 0-3/16",
              "content-length": 4,
              etag: '"opaque-etag-1"',
            },
          }
        : undefined,
    );
    const response = (await a.dependencies.content.open(
      { target, start: 0, end: 3, size_bytes: 16, etag: '"x"' },
      new AbortController().signal,
    )) as { body: { read(max: number, s: AbortSignal): Promise<unknown> } };
    const state = settled(response.body.read(4, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(4999);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => state.done);
    expect((state.error as Error).message).toBe("READ_UNAVAILABLE");
    await until(() => f.upstream.sockets.size === 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TestBR193_aborted_content_signal_destroys_the_socket_at_once", async () => {
    const { f, a } = await setup((r) =>
      r.host === STORAGE_HOST ? { stall: "headers" } : undefined,
    );
    const controller = new AbortController();
    const state = settled(
      a.dependencies.content.open(
        { target, start: 0, end: 3, size_bytes: 16, etag: '"x"' },
        controller.signal,
      ),
    );
    await until(() => f.upstream.seen.some((s) => s.host === STORAGE_HOST));
    controller.abort();
    await until(() => state.done);
    expect((state.error as Error).message).toBe("READ_UNAVAILABLE");
    await until(() => f.upstream.sockets.size === 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TestBR193_aborted_signal_during_a_body_read_rejects_and_destroys", async () => {
    const { f, a } = await setup((r) =>
      r.host === STORAGE_HOST
        ? {
            stall: "body",
            status: 206,
            headers: {
              "content-range": "bytes 0-3/16",
              "content-length": 4,
              etag: '"opaque-etag-1"',
            },
          }
        : undefined,
    );
    const response = (await a.dependencies.content.open(
      { target, start: 0, end: 3, size_bytes: 16, etag: '"x"' },
      new AbortController().signal,
    )) as { body: { read(max: number, s: AbortSignal): Promise<unknown> } };
    const controller = new AbortController();
    const state = settled(response.body.read(4, controller.signal));
    await tick();
    controller.abort();
    await until(() => state.done);
    expect((state.error as Error).message).toBe("READ_UNAVAILABLE");
    await until(() => f.upstream.sockets.size === 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

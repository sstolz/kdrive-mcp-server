import { afterEach, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
afterEach(() => vi.useRealTimers());

function receiverReader(bytes: Buffer, pending = false) {
  const states = new WeakMap<object, { emitted: boolean; closed: boolean }>(),
    receivers: unknown[] = [],
    closeReceivers: unknown[] = [],
    hook = vi.fn(() => {
      throw new Error("CANARY_METHOD_OVERRIDE");
    });
  const reader = {
    read(this: object): Promise<unknown> {
      receivers.push(this);
      const state = states.get(this);
      if (!state) return Promise.reject(new Error("CANARY_READ_RECEIVER"));
      if (pending) return new Promise(() => {});
      if (state.emitted) return Promise.resolve(null);
      state.emitted = true;
      return Promise.resolve(Buffer.from(bytes));
    },
    close(this: object): void {
      closeReceivers.push(this);
      const state = states.get(this);
      if (!state) throw new Error("CANARY_CLOSE_RECEIVER");
      state.closed = true;
    },
  };
  // Valid own methods can themselves have hostile .call/.apply fields.
  for (const methodName of ["read", "close"]) {
    const method = Object.getOwnPropertyDescriptor(reader, methodName)!
      .value as object;
    for (const name of ["call", "apply"])
      Object.defineProperty(method, name, { get: hook });
  }
  const state = { emitted: false, closed: false };
  states.set(reader, state);
  return { reader, state, receivers, closeReceivers, hook };
}

it("TestBR091_receiver_snapshot and TestBR089_receiver_cleanup preserve WeakMap identity on success", async () => {
  const f = await contentFixture(),
    body = receiverReader(f.bytes),
    diagnostics: string[] = [];
  f.content.open.mockImplementation((request) =>
    Promise.resolve({ ...request, status: 206, body: body.reader }),
  );
  const c = createNavigationController(f.config, f.dependencies, (s) =>
    diagnostics.push(s),
  );
  const result = await c.invoke("kdrive_download", { file_id: 3 });
  c.close();
  expect(result.isError).toBeUndefined();
  expect(body.receivers).toEqual([body.reader, body.reader]);
  expect(body.closeReceivers).toEqual([body.reader]);
  expect(body.state.closed).toBe(true);
  expect(body.hook).not.toHaveBeenCalled();
  expect(diagnostics).toEqual([]);
});

it.each(["range", "accessor"])(
  "TestBR089_receiver_cleanup valid original close on %s refusal",
  async (kind) => {
    const f = await contentFixture(),
      body = receiverReader(f.bytes),
      getter = vi.fn(() => "CANARY_HEADER");
    f.content.open.mockImplementation((request) => {
      const response = { ...request, status: 200, body: body.reader };
      return Promise.resolve(
        kind === "accessor"
          ? Object.defineProperty(response, "status", { get: getter })
          : response,
      );
    });
    const c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("CONTENT_UNAVAILABLE"),
    );
    c.close();
    expect(body.receivers).toEqual([]);
    expect(body.closeReceivers).toEqual([body.reader]);
    expect(body.state.closed).toBe(true);
    expect(body.hook).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  },
);

it("TestBR089_receiver_cleanup cancellation closes receiver-dependent pending read once", async () => {
  vi.useFakeTimers();
  const f = await contentFixture(),
    body = receiverReader(f.bytes, true),
    abort = new AbortController();
  f.content.open.mockImplementation((request) =>
    Promise.resolve({ ...request, status: 206, body: body.reader }),
  );
  const c = createNavigationController(f.config, f.dependencies),
    pending = c.invoke("kdrive_download", { file_id: 3 }, abort.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(body.receivers).toEqual([body.reader]);
  abort.abort();
  expect(await pending).toEqual(contentError("ACCESS_DENIED"));
  c.close();
  expect(body.closeReceivers).toEqual([body.reader]);
  expect(body.state.closed).toBe(true);
  expect(body.hook).not.toHaveBeenCalled();
});

it("TestBR089_receiver_cleanup late open closes original receiver unread", async () => {
  vi.useFakeTimers();
  const f = await contentFixture(),
    body = receiverReader(f.bytes),
    abort = new AbortController();
  let resolve: (value: unknown) => void = () => {};
  f.content.open.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const c = createNavigationController(f.config, f.dependencies),
    pending = c.invoke("kdrive_download", { file_id: 3 }, abort.signal);
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  expect(await pending).toEqual(contentError("ACCESS_DENIED"));
  resolve({
    ...f.content.open.mock.calls[0]![0],
    status: 206,
    body: body.reader,
  });
  await vi.advanceTimersByTimeAsync(0);
  c.close();
  expect(body.receivers).toEqual([]);
  expect(body.closeReceivers).toEqual([body.reader]);
  expect(body.state.closed).toBe(true);
  expect(body.hook).not.toHaveBeenCalled();
});

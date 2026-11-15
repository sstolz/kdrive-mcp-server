import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadFailure } from "../src/read-retry.js";
import { createNavigationController } from "../src/navigation.js";
import { createPolicy } from "../src/policy/index.js";
import {
  contentFixture,
  contentError,
  contentResult,
  rangeResponse,
} from "./helpers/content.js";
import { fixture } from "./helpers/received.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";
afterEach(() => vi.useRealTimers());

describe("central read retry and bounded lifecycle", () => {
  it.each([429, 500, 599])(
    "TestBR088_bounded_retry_matrix metadata status %s waits100/200",
    async (status) => {
      vi.useFakeTimers();
      const f = await contentFixture(),
        starts: number[] = [];
      f.inspect.mockImplementation(() => {
        starts.push(performance.now());
        return starts.length < 3
          ? Promise.reject(new ReadFailure(status))
          : Promise.resolve(f.file);
      });
      const c = createNavigationController(f.config, f.dependencies),
        pending = c.invoke("kdrive_info", { file_id: 3 });
      await vi.advanceTimersByTimeAsync(300);
      expect((await pending).isError).toBeUndefined();
      expect(starts).toEqual([0, 100, 300]);
      c.close();
    },
  );
  it.each([400, 401, 403, 404, 416])(
    "TestBR088_bounded_retry_matrix nonretryable %s",
    async (status) => {
      const f = await contentFixture();
      f.inspect.mockRejectedValue(new ReadFailure(status));
      const c = createNavigationController(f.config, f.dependencies);
      expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
        contentError("READ_UNAVAILABLE"),
      );
      expect(f.inspect).toHaveBeenCalledOnce();
      c.close();
    },
  );
  it.each(["inspect", "describe", "open"] as const)(
    "TestBR088_bounded_retry_matrix exhaustion %s preserves precedence",
    async (port) => {
      vi.useFakeTimers();
      const f = await contentFixture(),
        c = createNavigationController(f.config, f.dependencies);
      const dependency = port === "inspect" ? f.inspect : f.content[port];
      dependency.mockRejectedValue(new ReadFailure(503));
      const pending = c.invoke("kdrive_download", { file_id: 3 });
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toEqual(contentError("READ_UNAVAILABLE"));
      expect(dependency).toHaveBeenCalledTimes(3);
      c.close();
    },
  );
  it("TestBR088_shared_retry_budgets fifth list attempt prevents sixth retry", async () => {
    vi.useFakeTimers();
    const f = await contentFixture();
    let starts = 0;
    f.collection.mockImplementation((request) => {
      if (++starts !== 3) return Promise.reject(new ReadFailure(429));
      return Promise.resolve({
        ...request,
        status: "complete",
        entries: [],
        next: "next",
      });
    });
    const c = createNavigationController(f.config, f.dependencies),
      pending = c.invoke("kdrive_list", { folder_id: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(contentError("LIMIT_EXCEEDED"));
    expect(starts).toBe(5);
    c.close();
  });
  it("TestBR070_v4_AC02_fragmentation_does_not_consume_operations", async () => {
    for (const fragmentSize of [600, 1]) {
      const f = await contentFixture({}, Buffer.alloc(600));
      const response = rangeResponse(
        {
          target: { driveId: 7, id: 3 },
          start: 0,
          end: 599,
          size_bytes: 600,
          etag: f.etag,
        },
        f.bytes,
      );
      let offset = 0;
      response.body.read.mockImplementation((max) => {
        if (offset === 600) return Promise.resolve(null);
        const chunk = f.bytes.subarray(
          offset,
          offset + Math.min(max, fragmentSize),
        );
        offset += chunk.length;
        return Promise.resolve(chunk);
      });
      f.content.open.mockResolvedValue(response);
      const c = createNavigationController(f.config, f.dependencies);
      try {
        expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
          contentResult({
            drive_id: 7,
            file_id: 3,
            offset_bytes: 0,
            bytes_read: 600,
            size_bytes: 600,
            etag: f.etag,
            encoding: "base64",
            data: "A".repeat(800),
            has_more: false,
          }),
        );
        expect(response.body.read).toHaveBeenCalledTimes(
          600 / fragmentSize + 1,
        );
        expect(response.body.close).toHaveBeenCalledOnce();
        expect(f.content.describe).toHaveBeenCalledOnce();
        expect(f.content.open).toHaveBeenCalledOnce();
        expect(f.inspect).toHaveBeenCalledTimes(4);
      } finally {
        c.close();
      }
    }
  });
  it("TestBR093_read_only_retry_composition abstract dispatch and execute never retry", async () => {
    const f = await contentFixture();
    f.execute.mockRejectedValue(new ReadFailure(503));
    const policy = createPolicy(f.config, f.dependencies);
    await expect(
      policy.dispatch({ kind: "read", target: { driveId: 7, id: 3 } }),
    ).rejects.toThrow("READ_UNAVAILABLE");
    expect(f.execute).toHaveBeenCalledOnce();
    f.inspect.mockRejectedValue(new ReadFailure(503));
    expect(
      await policy.check({ kind: "read", target: { driveId: 7, id: 3 } }),
    ).toEqual({ allowed: false, code: "EVIDENCE_UNAVAILABLE" });
    expect(f.inspect).toHaveBeenCalledTimes(2);
  });
  it("TestBR089_content_lifecycle cancel retry wait releases slot without new attempts", async () => {
    vi.useFakeTimers();
    const f = await contentFixture(),
      abort = new AbortController();
    f.content.describe.mockRejectedValue(new ReadFailure(503));
    const c = createNavigationController(f.config, f.dependencies),
      pending = c.invoke("kdrive_download", { file_id: 3 }, abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    expect(await pending).toEqual(contentError("ACCESS_DENIED"));
    await vi.advanceTimersByTimeAsync(500);
    expect(f.content.describe).toHaveBeenCalledOnce();
    expect(
      (await c.invoke("kdrive_info", { file_id: 3 })).isError,
    ).toBeUndefined();
    c.close();
  });
  it.each(["cancel", "timeout", "close"])(
    "TestBR089_content_lifecycle pending body %s closes and prevents publication",
    async (action) => {
      vi.useFakeTimers();
      const f = await contentFixture(),
        abort = new AbortController();
      let response: ReturnType<typeof rangeResponse> | undefined;
      f.content.open.mockImplementation((request) => {
        response = rangeResponse(request, f.bytes);
        response.body.read.mockImplementation(() => new Promise(() => {}));
        return Promise.resolve(response);
      });
      const c = createNavigationController(f.config, f.dependencies),
        pending = c.invoke("kdrive_download", { file_id: 3 }, abort.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(response).toBeDefined();
      // F-026: a concurrent read waits without opening content; its own
      // cancellation removes it with ACCESS_DENIED.
      const other = new AbortController(),
        waiter = c.readResource("kdrive://7/file/3", other.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.content.open).toHaveBeenCalledOnce();
      other.abort();
      await expect(waiter).rejects.toThrow("ACCESS_DENIED");
      if (action === "cancel") abort.abort();
      else if (action === "close") c.close();
      else await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toEqual(
        contentError(
          action === "timeout" ? "REQUEST_TIMEOUT" : "ACCESS_DENIED",
        ),
      );
      expect(response!.body.close).toHaveBeenCalledOnce();
      expect(response!.body.read).toHaveBeenCalledOnce();
      c.close();
    },
  );
  it("TestBR089_content_lifecycle late open closes once without consumption", async () => {
    vi.useFakeTimers();
    const f = await contentFixture(),
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
    const response = rangeResponse(f.content.open.mock.calls[0]![0], f.bytes);
    resolve(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(response.body.close).toHaveBeenCalledOnce();
    expect(response.body.read).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR089_content_lifecycle never-settling descriptor times out", async () => {
    vi.useFakeTimers();
    const f = await contentFixture();
    f.content.describe.mockImplementation(() => new Promise(() => {}));
    const c = createNavigationController(f.config, f.dependencies),
      pending = c.invoke("kdrive_download", { file_id: 3 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual(contentError("REQUEST_TIMEOUT"));
    expect(f.content.describe).toHaveBeenCalledOnce();
    c.close();
  });
});

describe("received content freshness", () => {
  it.each([false, true])(
    "TestBR082_received_freshness root/child positive and opt-out %s",
    async (optout) => {
      const f = await fixture(optout ? { KDRIVE_MCP_SHARED_WITH_ME: "0" } : {}),
        raw = await contentFixture();
      const c = createNavigationController(f.config, {
        ...f.configured,
        execute: f.execute,
        received: f.received,
        content: raw.content,
      });
      const result = await c.invoke("kdrive_download", {
        drive_id: 8,
        file_id: 24,
      });
      expect(result.isError).toBe(optout ? true : undefined);
      if (optout) {
        expect(f.received.list).not.toHaveBeenCalled();
        expect(raw.content.describe).not.toHaveBeenCalled();
      } else
        expect(
          (await c.readResource("kdrive://8/file/24")).contents[0]!.blob,
        ).toBe(raw.bytes.toString("base64"));
      expect(
        await c.invoke("kdrive_download", { drive_id: 8, file_id: 1 }),
      ).toEqual(contentError("ACCESS_DENIED"));
      c.close();
    },
  );
  it.each(["revocation", "expiry", "transition"])(
    "TestBR082_received_freshness final %s discards bytes",
    async (kind) => {
      const f = await fixture(),
        raw = await contentFixture();
      raw.content.open.mockImplementation((request) => {
        if (kind === "revocation") f.file.capabilities.read = false;
        else {
          f.clock.value = 60000;
          f.received.list.mockImplementation((r) =>
            Promise.resolve({
              ...r,
              status: "complete",
              entries:
                kind === "transition"
                  ? [
                      {
                        ...f.anchor,
                        type: "file",
                        capabilities: { read: true },
                      },
                    ]
                  : [],
              terminal: true,
              discover: true,
            }),
          );
        }
        return Promise.resolve(rangeResponse(request, raw.bytes));
      });
      const c = createNavigationController(f.config, {
        ...f.configured,
        execute: f.execute,
        received: f.received,
        content: raw.content,
      });
      expect(
        await c.invoke("kdrive_download", { drive_id: 8, file_id: 24 }),
      ).toEqual(contentError("ACCESS_DENIED"));
      expect(raw.content.open).toHaveBeenCalledOnce();
      c.close();
    },
  );
  it("TestBR082_received_freshness retry reauthorization blocks revoked share", async () => {
    vi.useFakeTimers();
    const f = await fixture(),
      raw = await contentFixture();
    raw.content.open.mockImplementationOnce(() => {
      f.file.capabilities.read = false;
      return Promise.reject(new ReadFailure(503));
    });
    const c = createNavigationController(f.config, {
        ...f.configured,
        execute: f.execute,
        received: f.received,
        content: raw.content,
      }),
      pending = c.invoke("kdrive_download", { drive_id: 8, file_id: 24 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual(contentError("ACCESS_DENIED"));
    expect(raw.content.open).toHaveBeenCalledOnce();
    c.close();
  });
  it("TestBR082_received_freshness expired continuation cannot retain authority", async () => {
    const f = await fixture(),
      raw = await contentFixture(),
      c = createNavigationController(f.config, {
        ...f.configured,
        execute: f.execute,
        received: f.received,
        content: raw.content,
      });
    expect(
      (
        await c.invoke("kdrive_download", {
          drive_id: 8,
          file_id: 24,
          length_bytes: 2,
        })
      ).isError,
    ).toBeUndefined();
    f.clock.value = 60000;
    f.received.list.mockImplementation((r) =>
      Promise.resolve({
        ...r,
        status: "complete",
        entries: [],
        terminal: true,
        discover: true,
      }),
    );
    expect(
      await c.invoke("kdrive_download", {
        drive_id: 8,
        file_id: 24,
        offset_bytes: 2,
        etag: raw.etag,
      }),
    ).toEqual(contentError("ACCESS_DENIED"));
    expect(raw.content.open).toHaveBeenCalledOnce();
    c.close();
  });
});

// A body with a controllable late completion: no sleeps and no transport I/O.
async function stalledStream(
  stage: "data" | "EOF" | "EOF_single" | "progress",
) {
  const f = await contentFixture({}, Buffer.alloc(600));
  let release!: (value: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  let count = 0;
  const body = {
    read: vi.fn<(max: number, signal: AbortSignal) => Promise<unknown>>(() => {
      count++;
      if (stage === "EOF" && count <= 600)
        return Promise.resolve(Buffer.alloc(1));
      if (stage === "EOF_single" && count === 1)
        return Promise.resolve(f.bytes);
      if (stage === "progress" && count <= 2) {
        const delay = count === 1 ? 5000 : 4999;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(Buffer.alloc(300));
          }, delay);
        });
      }
      return held;
    }),
    close: vi.fn(),
  };
  f.content.open.mockImplementation((request) =>
    Promise.resolve({ ...request, status: 206, body }),
  );
  return {
    f,
    body,
    release,
    readCount:
      stage === "EOF"
        ? 601
        : stage === "data"
          ? 1
          : stage === "progress"
            ? 3
            : 2,
  };
}

it.each(["data", "EOF", "EOF_single", "progress"] as const)(
  "TestBR070_v4_AC04_pending_data_and_EOF_obey_deadline %s",
  async (stage) => {
    vi.useFakeTimers();
    const h = await stalledStream(stage);
    const c = createNavigationController(h.f.config, h.f.dependencies);
    const settled = vi.fn();
    const pending = c
      .invoke("kdrive_download", { file_id: 3 })
      .then((value) => {
        settled(value);
        return value;
      });
    try {
      await vi.advanceTimersByTimeAsync(9999);
      expect(settled).not.toHaveBeenCalled();
      expect(h.body.read).toHaveBeenCalledTimes(h.readCount);
      const signal = h.body.read.mock.calls.at(-1)![1];
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual(contentError("REQUEST_TIMEOUT"));
      expect(signal.aborted).toBe(true);
      expect(h.body.close).toHaveBeenCalledOnce();
      const inspectCalls = h.f.inspect.mock.calls.length;
      h.release(stage === "data" ? h.f.bytes : null);
      await vi.advanceTimersByTimeAsync(10000);
      expect(settled).toHaveBeenCalledOnce();
      expect(h.body.read).toHaveBeenCalledTimes(h.readCount);
      expect(h.body.close).toHaveBeenCalledOnce();
      expect(h.f.inspect).toHaveBeenCalledTimes(inspectCalls);
      expect(h.f.content.describe).toHaveBeenCalledOnce();
      expect(h.f.content.open).toHaveBeenCalledOnce();
      expect(
        (await c.invoke("kdrive_info", { file_id: 3 })).isError,
      ).toBeUndefined();
    } finally {
      c.close();
      await pending;
    }
  },
);

it.each([
  ["data", "cancel"],
  ["data", "close"],
  ["EOF", "cancel"],
  ["EOF", "close"],
  ["EOF_single", "cancel"],
  ["EOF_single", "close"],
] as const)(
  "TestBR070_v4_AC04_pending_data_and_EOF_obey_cancel_and_close %s %s",
  async (stage, action) => {
    vi.useFakeTimers();
    const h = await stalledStream(stage);
    const c = createNavigationController(h.f.config, h.f.dependencies);
    const abort = new AbortController();
    const settled = vi.fn();
    const pending = c
      .invoke("kdrive_download", { file_id: 3 }, abort.signal)
      .then((value) => {
        settled(value);
        return value;
      });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).not.toHaveBeenCalled();
      expect(h.body.read).toHaveBeenCalledTimes(h.readCount);
      if (action === "cancel") abort.abort();
      else c.close();
      expect(await pending).toEqual(contentError("ACCESS_DENIED"));
      expect(h.body.read.mock.calls.at(-1)![1].aborted).toBe(true);
      expect(h.body.close).toHaveBeenCalledOnce();
      const inspectCalls = h.f.inspect.mock.calls.length;
      h.release(stage === "data" ? h.f.bytes : null);
      await vi.advanceTimersByTimeAsync(20000);
      expect(settled).toHaveBeenCalledOnce();
      expect(h.body.read).toHaveBeenCalledTimes(h.readCount);
      expect(h.body.close).toHaveBeenCalledOnce();
      expect(h.f.inspect).toHaveBeenCalledTimes(inspectCalls);
      expect(h.f.content.describe).toHaveBeenCalledOnce();
      expect(h.f.content.open).toHaveBeenCalledOnce();
      if (action === "cancel")
        expect(
          (await c.invoke("kdrive_info", { file_id: 3 })).isError,
        ).toBeUndefined();
      else
        expect(await c.invoke("kdrive_info", { file_id: 3 })).toEqual(
          contentError("ACCESS_DENIED"),
        );
    } finally {
      c.close();
      await pending;
    }
  },
);

it.each(["data", "EOF", "EOF_single"] as const)(
  "TestBR070_v4_AC04_pending_data_and_EOF_obey_cancel_and_close wire_close %s",
  async (stage) => {
    const h = await stalledStream(stage);
    const w = await createWire(h.f.config, h.f.dependencies);
    vi.useFakeTimers();
    try {
      w.send(initialize);
      await vi.advanceTimersByTimeAsync(0);
      expect(w.responses().some((r) => r.id === 1)).toBe(true);
      w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      w.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "kdrive_download",
          arguments: { file_id: 3 },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.body.read).toHaveBeenCalledTimes(h.readCount);
      expect(w.responses().some((r) => r.id === 2)).toBe(false);
      await w.session.close();
      expect(h.body.read.mock.calls.at(-1)![1].aborted).toBe(true);
      expect(h.body.close).toHaveBeenCalledOnce();
      h.release(stage === "data" ? h.f.bytes : null);
      await vi.advanceTimersByTimeAsync(20000);
      expect(w.responses().some((r) => r.id === 2)).toBe(false);
      expect(h.body.read).toHaveBeenCalledTimes(h.readCount);
      expect(h.body.close).toHaveBeenCalledOnce();
      expect(h.f.content.describe).toHaveBeenCalledOnce();
      expect(h.f.content.open).toHaveBeenCalledOnce();
    } finally {
      await w.session.close();
    }
  },
);

it("TestBR070_v4_AC04_immediate_fragments_obey_monotonic_deadline", async () => {
  vi.useFakeTimers();
  const f = await contentFixture({}, Buffer.alloc(600));
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const body = {
    read: vi.fn<(max: number, signal: AbortSignal) => Promise<unknown>>(() => {
      now = now === 0 ? 9999 : 10000;
      return Promise.resolve(Buffer.alloc(300));
    }),
    close: vi.fn(),
  };
  f.content.open.mockImplementation((request) =>
    Promise.resolve({ ...request, status: 206, body }),
  );
  const c = createNavigationController(f.config, f.dependencies);
  try {
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("REQUEST_TIMEOUT"),
    );
    expect(body.read).toHaveBeenCalledTimes(2);
    expect(body.close).toHaveBeenCalledOnce();
    expect(body.read.mock.calls[1]![1].aborted).toBe(true);
    expect(f.inspect).toHaveBeenCalledTimes(3);
    expect(f.content.describe).toHaveBeenCalledOnce();
    expect(f.content.open).toHaveBeenCalledOnce();
  } finally {
    c.close();
    clock.mockRestore();
  }
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadFailure } from "../src/read-retry.js";
import { createNavigationController } from "../src/navigation.js";
import { createPolicy } from "../src/policy/index.js";
import {
  contentFixture,
  contentError,
  rangeResponse,
} from "./helpers/content.js";
import { fixture } from "./helpers/received.js";
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
  it("TestBR088_shared_retry_budgets body reads share512 actual starts", async () => {
    const f = await contentFixture({}, Buffer.alloc(600));
    let response: ReturnType<typeof rangeResponse> | undefined;
    f.content.open.mockImplementation((request) => {
      response = rangeResponse(request, f.bytes);
      response.body.read.mockImplementation(() =>
        Promise.resolve(Buffer.from([0])),
      );
      return Promise.resolve(response);
    });
    const c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("LIMIT_EXCEEDED"),
    );
    expect(
      response!.body.read.mock.calls.length +
        f.inspect.mock.calls.length +
        f.content.describe.mock.calls.length +
        f.content.open.mock.calls.length,
    ).toBe(512);
    expect(response!.body.close).toHaveBeenCalledOnce();
    c.close();
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
      await expect(c.readResource("kdrive://7/file/3")).rejects.toThrow(
        "SERVER_BUSY",
      );
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

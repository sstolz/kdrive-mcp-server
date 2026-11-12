// F-014 AC-05 (BR-194) and AC-06 (BR-195).
import { afterEach, describe, expect, it, vi } from "vitest";
import { brandedRead } from "../../src/read-retry.js";
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
const MiB4 = 4 * 1024 * 1024;
const tick = () => new Promise<void>((r) => setImmediate(r));
async function until(condition: () => boolean) {
  for (let i = 0; i < 4000 && !condition(); i++) await tick();
  expect(condition()).toBe(true);
}
async function setup(
  override: (r: Seen) => Reply | Promise<Reply> | undefined,
) {
  const f = (fixture = await kdriveFixture());
  const original = f.upstream.handler;
  f.upstream.handler = async (r) => (await override(r)) ?? original(r);
  return { f, a: await adapterFor(f) };
}
function padded(size: number) {
  const base = JSON.stringify({
    result: "success",
    data: { drives: [{ id: DRIVE, role: "admin" }], pad: "" },
  });
  return base.replace('"pad":""', `"pad":"${"x".repeat(size - base.length)}"`);
}
async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("BR-194 body bounds and encoding", () => {
  it("TestBR194_JSON_success_body_of_exactly_4_MiB_is_accepted", async () => {
    const { a } = await setup((r) =>
      r.path === "/2/drive/init"
        ? {
            body: padded(MiB4),
            headers: { "content-type": "application/json" },
          }
        : undefined,
    );
    expect(await a.preflight.inspectDrive(DRIVE)).toEqual({
      id: DRIVE,
      role: "admin",
    });
  });
  it("TestBR194_JSON_success_body_of_4_MiB_plus_1_is_refused", async () => {
    const { a } = await setup((r) =>
      r.path === "/2/drive/init" ? { body: padded(MiB4 + 1) } : undefined,
    );
    const error = await failure(a.preflight.inspectDrive(DRIVE));
    expect((error as Error).message).toBe("READ_UNAVAILABLE");
    expect(brandedRead(error)).toBe(false);
  });
  it("TestBR194_JSON_body_without_length_above_4_MiB_is_refused_while_counting", async () => {
    const { a } = await setup((r) =>
      r.path === "/2/drive/init"
        ? { body: padded(MiB4 + 1), chunked: true }
        : undefined,
    );
    const error = await failure(a.preflight.inspectDrive(DRIVE));
    expect(brandedRead(error)).toBe(false);
  });
  it.each([
    [8192, true],
    [8193, false],
  ])("TestBR194_error_body_of_%s_bytes_branded_%s", async (size, branded) => {
    const { a } = await setup((r) =>
      r.path === "/2/drive/init"
        ? { status: 401, body: "e".repeat(size) }
        : undefined,
    );
    const error = await failure(a.preflight.inspectDrive(DRIVE));
    expect((error as Error).message).toBe("READ_UNAVAILABLE");
    expect(brandedRead(error)).toBe(branded);
  });
  it.each([
    [8192, true],
    [8193, false],
  ])(
    "TestBR194_redirect_body_of_%s_bytes_accepted_%s",
    async (size, accepted) => {
      const { a } = await setup((r) =>
        r.path.endsWith("/download")
          ? {
              status: 302,
              body: "r".repeat(size),
              headers: { location: `https://${STORAGE_HOST}/r` },
            }
          : undefined,
      );
      const result = a.dependencies.content.describe(
        { driveId: DRIVE, id: 12 },
        new AbortController().signal,
      );
      if (accepted) expect(await result).toMatchObject({ version_bound: true });
      else await expect(result).rejects.toThrow(/^READ_UNAVAILABLE$/u);
    },
  );
  it("TestBR194_JSON_content_encoding_gzip_is_refused", async () => {
    const { a } = await setup((r) =>
      r.path === "/2/drive/init"
        ? { body: padded(200), headers: { "content-encoding": "gzip" } }
        : undefined,
    );
    const error = await failure(a.preflight.inspectDrive(DRIVE));
    expect(brandedRead(error)).toBe(false);
  });
  it("TestBR194_identity_content_encoding_is_accepted", async () => {
    const { a } = await setup((r) =>
      r.path === "/2/drive/init"
        ? { body: padded(200), headers: { "content-encoding": "identity" } }
        : undefined,
    );
    expect(await a.preflight.inspectDrive(DRIVE)).toEqual({
      id: DRIVE,
      role: "admin",
    });
  });
  it("TestBR194_download_content_encoding_gzip_is_refused", async () => {
    const { a } = await setup((r) =>
      r.host === STORAGE_HOST
        ? {
            status: 206,
            body: "0",
            headers: {
              "content-range": "bytes 0-0/16",
              etag: '"e"',
              "content-encoding": "gzip",
            },
          }
        : undefined,
    );
    await expect(
      a.dependencies.content.describe(
        { driveId: DRIVE, id: 12 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/^READ_UNAVAILABLE$/u);
  });
});

describe("BR-195 bounded concurrency", () => {
  it("TestBR195_8_in_flight_64_waiters_73rd_refused_waiters_start_in_order", async () => {
    const gates = new Map<number, () => void>();
    const { f, a } = await setup((r) => {
      const m = /^\/3\/drive\/101\/files\/(\d+)$/u.exec(r.path);
      const id = Number(m?.[1]);
      if (!m || id < 1000) return undefined;
      return new Promise<Reply>((resolve) => {
        gates.set(id, () => {
          resolve({
            status: 404,
            json: { error: { code: "object_not_found" } },
          });
        });
      });
    });
    const calls: Promise<unknown>[] = [];
    for (let i = 0; i < 8; i++)
      calls.push(
        a.dependencies.inspect({ driveId: DRIVE, id: 1000 + i }, "live"),
      );
    await until(() => gates.size === 8);
    for (let i = 0; i < 64; i++)
      calls.push(
        a.dependencies.inspect({ driveId: DRIVE, id: 2000 + i }, "live"),
      );
    const extra = a.dependencies.inspect({ driveId: DRIVE, id: 3000 }, "live");
    await expect(extra).rejects.toThrow(/^READ_UNAVAILABLE$/u);
    expect(gates.size).toBe(8);
    for (let released = 0; released < 72; released++) {
      const next = [...gates.keys()].sort((x, y) => x - y)[0];
      if (next === undefined) await until(() => gates.size > 0);
      const id = [...gates.keys()].sort((x, y) => x - y)[0] ?? 0;
      gates.get(id)?.();
      gates.delete(id);
      if (released < 64) await until(() => gates.size === 8);
    }
    await Promise.all(calls);
    const started = f.upstream.seen
      .map((s) => Number(/\/files\/(\d+)$/u.exec(s.path)?.[1]))
      .filter((id) => id >= 2000);
    expect(started).toEqual([...Array(64).keys()].map((i) => 2000 + i));
    expect(f.upstream.seen.some((s) => s.path.endsWith("/3000"))).toBe(false);
  });

  async function eightReaders() {
    const { f, a } = await setup((r) =>
      r.host === STORAGE_HOST
        ? {
            stall: "body",
            status: 206,
            headers: {
              "content-range": "bytes 0-1/16",
              "content-length": 2,
              etag: '"e"',
            },
          }
        : undefined,
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const readers: {
      read(max: number, s: AbortSignal): Promise<unknown>;
      close(): void;
    }[] = [];
    for (let i = 0; i < 8; i++) {
      const response = (await a.dependencies.content.open(
        {
          target: { driveId: DRIVE, id: 12 },
          start: 0,
          end: 1,
          size_bytes: 16,
          etag: '"x"',
        },
        new AbortController().signal,
      )) as { body: (typeof readers)[number] };
      readers.push(response.body);
    }
    return { f, a, readers };
  }

  it("TestBR195_a_waiter_past_its_deadline_rejects_without_starting", async () => {
    const { f, a, readers } = await eightReaders();
    const before = f.upstream.seen.length;
    const waiter = a.dependencies.inspect({ driveId: DRIVE, id: 12 }, "live");
    const caught = waiter.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4000);
    const pending = readers.map((r) =>
      r.read(2, new AbortController().signal).catch(() => null),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await caught) as Error).message).toBe("READ_UNAVAILABLE");
    expect(f.upstream.seen).toHaveLength(before);
    for (const r of readers) r.close();
    await Promise.all(pending);
  });

  it.each(["close", "failed-read", "idle", "end"])(
    "TestBR195_reader_slot_is_released_on_%s",
    async (how) => {
      const { f, a, readers } = await eightReaders();
      const sockets = f.upstream.sockets.size;
      const waiter = a.dependencies.inspect({ driveId: DRIVE, id: 12 }, "live");
      await tick();
      const before = f.upstream.seen.length;
      const first = readers[0];
      if (how === "close") first?.close();
      if (how === "idle") await vi.advanceTimersByTimeAsync(4999);
      if (how === "idle") expect(f.upstream.seen).toHaveLength(before);
      if (how === "idle") await vi.advanceTimersByTimeAsync(1);
      if (how === "failed-read") {
        const read = first
          ?.read(2, new AbortController().signal)
          .catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(5000);
        expect(((await read) as Error).message).toBe("READ_UNAVAILABLE");
      }
      if (how === "end") {
        // End of stream: the server-side socket ends; the reader returns null.
        for (const s of f.upstream.sockets) s.end();
        const read = first
          ?.read(2, new AbortController().signal)
          .catch((e: unknown) => e);
        await read;
      }
      vi.useRealTimers();
      await until(() => f.upstream.seen.length === before + 1);
      await waiter;
      await until(() => f.upstream.sockets.size < sockets + 1);
      for (const r of readers) r.close();
    },
  );
});

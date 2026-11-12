// F-014 AC-14 (BR-205) and AC-15 (BR-206).
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { strongETag } from "../../src/content.js";
import { brandedRead } from "../../src/read-retry.js";
import {
  BYTES,
  DRIVE,
  PROVIDER_ETAG,
  STORAGE_HOST,
  adapterFor,
  kdriveFixture,
  navigationClient,
  signal,
  success,
  providerItem,
  tree,
  type Reply,
  type Seen,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
let nav: Awaited<ReturnType<typeof navigationClient>> | undefined;
afterEach(async () => {
  await nav?.close();
  nav = undefined;
  await fixture?.close();
  fixture = undefined;
});
const target = { driveId: DRIVE, id: 12 };
const derived = (etag: string) =>
  `"kd1-${createHash("sha256").update(Buffer.from(etag, "latin1")).digest("base64url")}"`;
const storage = (reply: Reply) => (r: Seen) =>
  r.host === STORAGE_HOST ? reply : undefined;
async function setup(
  override: (r: Seen) => Reply | undefined = () => undefined,
) {
  const f = (fixture = await kdriveFixture());
  f.drive.overrides.push(override);
  const a = await adapterFor(f);
  nav = await navigationClient(a.dependencies);
  return { f, a, nav };
}
type Body = {
  read(max: number, s: AbortSignal): Promise<Uint8Array | null>;
  close(): void;
};

describe("BR-205 describe and the derived ETag", () => {
  it("TestBR205_recorded_16_byte_binary_yields_version_bound_and_a_derived_strong_etag", async () => {
    const { f, a } = await setup();
    const d = (await a.dependencies.content.describe(
      target,
      signal(),
    )) as Record<string, unknown>;
    expect(d).toEqual({
      target,
      size_bytes: 16,
      etag: derived(PROVIDER_ETAG),
      version_bound: true,
    });
    expect(strongETag(d.etag)).toBe(true);
    expect(d.etag).not.toBe(PROVIDER_ETAG);
    const download = f.upstream.seen.filter((s) => s.host === STORAGE_HOST);
    expect(download.map((s) => s.headers.range)).toEqual(["bytes=0-0"]);
  });

  const variants: [string, (r: Seen) => Reply | undefined, number?][] = [
    ["size 0", () => undefined, 15],
    [
      "Content-Range total 15",
      storage({
        status: 206,
        body: "0",
        headers: { "content-range": "bytes 0-0/15", etag: '"e"' },
      }),
    ],
    [
      "missing ETag",
      storage({
        status: 206,
        body: "0",
        headers: { "content-range": "bytes 0-0/16" },
      }),
    ],
    [
      "257-byte ETag",
      storage({
        status: 206,
        body: "0",
        headers: { "content-range": "bytes 0-0/16", etag: "e".repeat(257) },
      }),
    ],
    [
      "non-visible ETag",
      storage({
        status: 206,
        body: "0",
        headers: { "content-range": "bytes 0-0/16", etag: '"a b"' },
      }),
    ],
    [
      "200 ignoring the range",
      storage({ status: 200, body: BYTES, headers: { etag: '"e"' } }),
    ],
    [
      "wrong Content-Length",
      storage({
        status: 206,
        body: "01",
        headers: { "content-range": "bytes 0-0/16", etag: '"e"' },
      }),
    ],
    ["folder target", () => undefined, 11],
  ];
  it.each(variants)(
    "TestBR205_variant_%s_yields_a_null_etag_and_VERSION_UNAVAILABLE",
    async (_name, override, id = 12) => {
      const { a, nav: client } = await setup(override);
      const d = (await a.dependencies.content.describe(
        { driveId: DRIVE, id },
        signal(),
      )) as Record<string, unknown>;
      expect(d.etag).toBeNull();
      expect(d.version_bound).toBe(false);
      if (id !== 11)
        expect(
          await client.call("kdrive_download", {
            drive_id: DRIVE,
            file_id: id,
          }),
        ).toEqual({
          error: "VERSION_UNAVAILABLE",
        });
    },
  );

  it("TestBR205_256_byte_ETag_is_accepted", async () => {
    const etag = "e".repeat(256);
    const { a } = await setup(
      storage({
        status: 206,
        body: "0",
        headers: { "content-range": "bytes 0-0/16", etag },
      }),
    );
    expect(
      await a.dependencies.content.describe(target, signal()),
    ).toMatchObject({
      etag: derived(etag),
      version_bound: true,
    });
  });

  it("TestBR205_metadata_404_rejects_unbranded_and_the_client_sees_ACCESS_DENIED", async () => {
    let metadata = 0;
    const { a, nav: client } = await setup((r) =>
      r.path === "/3/drive/101/files/12" && metadata++ === 1
        ? {
            status: 404,
            json: { result: "error", error: { code: "object_not_found" } },
          }
        : undefined,
    );
    expect(
      await client.call("kdrive_download", { drive_id: DRIVE, file_id: 12 }),
    ).toEqual({
      error: "ACCESS_DENIED",
    });
    metadata = 1;
    const error = await a.dependencies.content
      .describe(target, signal())
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe("READ_UNAVAILABLE");
    expect(brandedRead(error)).toBe(false);
  });

  it("TestBR205_invalid_metadata_rejects_unbranded", async () => {
    const { a } = await setup((r) =>
      r.path === "/3/drive/101/files/12"
        ? success({ ...providerItem(tree, 12), status: "trashed" })
        : undefined,
    );
    const error = await a.dependencies.content
      .describe(target, signal())
      .catch((e: unknown) => e);
    expect(brandedRead(error)).toBe(false);
  });
});

describe("BR-206 open and the bounded body reader", () => {
  it.each([
    [0, 1],
    [7, 3],
    [15, 1],
  ])(
    "TestBR206_range_at_%s_of_%s_bytes_returns_the_exact_known_bytes",
    async (offset, length) => {
      const { f, nav: client } = await setup();
      const first = (await client.call("kdrive_download", {
        drive_id: DRIVE,
        file_id: 12,
        offset_bytes: 0,
        length_bytes: 1,
      })) as {
        ok: { etag: string };
      };
      const result = (await client.call("kdrive_download", {
        drive_id: DRIVE,
        file_id: 12,
        offset_bytes: offset,
        length_bytes: length,
        etag: first.ok.etag,
      })) as { ok: { data: string; bytes_read: number } };
      expect(Buffer.from(result.ok.data, "base64")).toEqual(
        BYTES.subarray(offset, offset + length),
      );
      const ranges = f.upstream.seen
        .filter((s) => s.host === STORAGE_HOST)
        .map((s) => s.headers.range);
      expect(ranges).toContain(
        `bytes=${String(offset)}-${String(offset + length - 1)}`,
      );
      expect(
        f.upstream.seen
          .filter((s) => s.path.endsWith("/download"))
          .every((s) => s.headers["accept-encoding"] === "identity"),
      ).toBe(true);
    },
  );

  it("TestBR206_range_16_16_gets_416_as_ReadFailure", async () => {
    const { a } = await setup();
    const error = await a.dependencies.content
      .open(
        {
          target,
          start: 16,
          end: 16,
          size_bytes: 16,
          etag: derived(PROVIDER_ETAG),
        },
        signal(),
      )
      .catch((e: unknown) => e);
    expect(brandedRead(error)).toBe(true);
  });

  it("TestBR206_reads_return_at_most_max_bytes_then_null_and_close_destroys_the_socket", async () => {
    const { f, a } = await setup();
    const response = (await a.dependencies.content.open(
      {
        target,
        start: 7,
        end: 10,
        size_bytes: 16,
        etag: derived(PROVIDER_ETAG),
      },
      signal(),
    )) as Record<string, unknown> & { body: Body };
    expect(Object.keys(response).sort()).toEqual([
      "body",
      "end",
      "etag",
      "size_bytes",
      "start",
      "status",
      "target",
    ]);
    expect(response).toMatchObject({
      target,
      start: 7,
      end: 10,
      size_bytes: 16,
      etag: derived(PROVIDER_ETAG),
      status: 206,
    });
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = await response.body.read(3, signal());
      if (chunk === null) break;
      expect(chunk.length).toBeLessThanOrEqual(3);
      expect(chunk.length).toBeGreaterThan(0);
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(BYTES.subarray(7, 11));
    response.body.close();
    const second = (await a.dependencies.content.open(
      {
        target,
        start: 0,
        end: 3,
        size_bytes: 16,
        etag: derived(PROVIDER_ETAG),
      },
      signal(),
    )) as { body: Body };
    const before = f.upstream.sockets.size;
    second.body.close();
    for (let i = 0; i < 500 && f.upstream.sockets.size >= before; i++)
      await new Promise((r) => setImmediate(r));
    expect(f.upstream.sockets.size).toBeLessThan(before);
  });

  it("TestBR206_different_ETag_gives_VERSION_CHANGED", async () => {
    let etag = PROVIDER_ETAG;
    const { f, nav: client } = await setup();
    const first = (await client.call("kdrive_download", {
      drive_id: DRIVE,
      file_id: 12,
      offset_bytes: 0,
      length_bytes: 1,
    })) as {
      ok: { etag: string };
    };
    f.drive.overrides.push((r) => {
      if (r.host !== STORAGE_HOST || r.headers.range === "bytes=0-0")
        return undefined;
      etag = '"changed"';
      return {
        status: 206,
        body: "789",
        headers: { "content-range": "bytes 7-9/16", etag },
      };
    });
    expect(
      await client.call("kdrive_download", {
        drive_id: DRIVE,
        file_id: 12,
        offset_bytes: 7,
        length_bytes: 3,
        etag: first.ok.etag,
      }),
    ).toEqual({ error: "VERSION_CHANGED" });
  });

  it.each([
    [
      "wrong Content-Range",
      {
        status: 206,
        body: "789",
        headers: { "content-range": "bytes 7-9/17", etag: PROVIDER_ETAG },
      },
    ],
    [
      "wrong Content-Length",
      {
        status: 206,
        body: "78",
        headers: { "content-range": "bytes 7-9/16", etag: PROVIDER_ETAG },
      },
    ],
    [
      "status 200",
      { status: 200, body: BYTES, headers: { etag: PROVIDER_ETAG } },
    ],
    [
      "extra trailing byte",
      {
        status: 206,
        body: "789a",
        headers: { "content-range": "bytes 7-9/16", etag: PROVIDER_ETAG },
      },
    ],
    [
      "chunked without length",
      {
        status: 206,
        body: "789",
        headers: { "content-range": "bytes 7-9/16", etag: PROVIDER_ETAG },
        chunked: true,
      },
    ],
  ] as [string, Reply][])(
    "TestBR206_%s_is_refused_before_any_body_byte",
    async (_name, reply) => {
      const { a } = await setup((r) =>
        r.host === STORAGE_HOST && r.headers.range === "bytes=7-9"
          ? reply
          : undefined,
      );
      await expect(
        a.dependencies.content.open(
          {
            target,
            start: 7,
            end: 9,
            size_bytes: 16,
            etag: derived(PROVIDER_ETAG),
          },
          signal(),
        ),
      ).rejects.toThrow(/^READ_UNAVAILABLE$/u);
    },
  );
});

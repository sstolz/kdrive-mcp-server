import { afterEach, describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { strongETag, resourceTarget } from "../src/content.js";
import { ReadFailure } from "../src/read-retry.js";
import {
  contentFixture,
  contentError,
  rangeResponse,
  type RawPayload,
} from "./helpers/content.js";
import { payload } from "./helpers/navigation.js";
afterEach(() => vi.useRealTimers());

describe("raw/version/range boundaries", () => {
  it.each([0, 1, 2, 3, 16, 65539])(
    "TestBR083_binary_continuation exact binary length %s",
    async (size) => {
      const bytes = Buffer.from(
        Array.from({ length: size }, (_, i) => i % 256),
      );
      const f = await contentFixture({}, bytes),
        c = createNavigationController(f.config, f.dependencies),
        parts: Buffer[] = [];
      let offset = 0;
      do {
        const result = await c.invoke("kdrive_download", {
          file_id: 3,
          offset_bytes: offset,
          length_bytes: 20000,
          ...(offset ? { etag: f.etag } : {}),
        });
        expect(result.isError).toBeUndefined();
        const data = payload(result) as RawPayload;
        const decoded = Buffer.from(data.data, "base64");
        parts.push(decoded);
        expect(data).toMatchObject({
          drive_id: 7,
          file_id: 3,
          offset_bytes: offset,
          bytes_read: decoded.length,
          size_bytes: size,
          etag: f.etag,
          encoding: "base64",
        });
        expect(decoded.toString("base64")).toBe(data.data);
        expect(data.has_more).toBe(offset + decoded.length < size);
        if (!data.has_more) {
          expect(data).not.toHaveProperty("next_offset_bytes");
          break;
        }
        expect(data.next_offset_bytes).toBe(offset + decoded.length);
        offset = data.next_offset_bytes!;
      } while (offset < size);
      expect(Buffer.concat(parts)).toEqual(bytes);
      for (const body of f.bodies) {
        expect(body.close).toHaveBeenCalledTimes(1);
        expect(body.read.mock.calls.every(([max]) => max <= 16384)).toBe(true);
      }
      c.close();
    },
  );
  it.each([
    { file_id: 3, offset_bytes: 1 },
    { file_id: 3, offset_bytes: -1 },
    { file_id: 3, offset_bytes: 0.5 },
    { file_id: 3, offset_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { file_id: 3, length_bytes: 0 },
    { file_id: 3, length_bytes: "1" },
    { file_id: "3" },
    { file_id: 3, drive_id: null },
    { file_id: 3, offset: 1 },
    { file_id: 3, cursor: "opaque" },
    { file_id: 3, etag: 'W/"weak"' },
    { file_id: 3, etag: '"tag"\n' },
    { file_id: 3, etag: '"é"' },
    { file_id: 3, etag: '""' },
  ])("TestBR083_version_binding invalid schema %j", async (args) => {
    const f = await contentFixture(),
      c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_download", args)).toEqual(
      contentError("INVALID_ARGUMENTS"),
    );
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.content.describe).not.toHaveBeenCalled();
    c.close();
  });
  it.each([undefined, "opaque", 'W/"weak"', '"tag"\n', false])(
    "TestBR083_version_binding unqualified validator %s",
    async (etag) => {
      const f = await contentFixture(),
        c = createNavigationController(f.config, f.dependencies);
      f.content.describe.mockImplementation((target) =>
        Promise.resolve({ target, size_bytes: 7, etag, version_bound: true }),
      );
      expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
        contentError("VERSION_UNAVAILABLE"),
      );
      expect(f.content.open).not.toHaveBeenCalled();
      c.close();
    },
  );
  it("TestBR083_version_binding rejects changed version and same-tag unqualified evidence", async () => {
    const f = await contentFixture(),
      c = createNavigationController(f.config, f.dependencies);
    expect(
      await c.invoke("kdrive_download", {
        file_id: 3,
        offset_bytes: 2,
        etag: '"old"',
      }),
    ).toEqual(contentError("VERSION_CHANGED"));
    f.content.describe.mockImplementation((target) =>
      Promise.resolve({
        target,
        size_bytes: 7,
        etag: f.etag,
        version_bound: false,
      }),
    );
    expect(
      await c.invoke("kdrive_download", {
        file_id: 3,
        offset_bytes: 2,
        etag: f.etag,
      }),
    ).toEqual(contentError("VERSION_UNAVAILABLE"));
    expect(f.content.open).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR084_exact_range_evidence EOF and beyond EOF open no range", async () => {
    const f = await contentFixture(),
      c = createNavigationController(f.config, f.dependencies);
    const data = payload(
      await c.invoke("kdrive_download", {
        file_id: 3,
        offset_bytes: 7,
        etag: f.etag,
      }),
    ) as RawPayload;
    expect(data).toMatchObject({ data: "", bytes_read: 0, has_more: false });
    expect(
      await c.invoke("kdrive_download", {
        file_id: 3,
        offset_bytes: 8,
        etag: f.etag,
      }),
    ).toEqual(contentError("INVALID_RANGE"));
    expect(f.content.open).not.toHaveBeenCalled();
    c.close();
  });
  it.each([200, 302, 416, 500])(
    "TestBR084_exact_range_evidence rejects status %s without body reads",
    async (status) => {
      const f = await contentFixture();
      let response: ReturnType<typeof rangeResponse> | undefined;
      f.content.open.mockImplementation((request) =>
        Promise.resolve(
          // eslint-disable-next-line sonarjs/no-nested-assignment -- F-011: assignment inside the expression keeps the reviewed evaluation order
          (response = { ...rangeResponse(request, f.bytes), status }),
        ),
      );
      const c = createNavigationController(f.config, f.dependencies);
      expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
        contentError("CONTENT_UNAVAILABLE"),
      );
      expect(response!.body.read).not.toHaveBeenCalled();
      expect(response!.body.close).toHaveBeenCalledOnce();
      expect(f.content.open).toHaveBeenCalledOnce();
      c.close();
    },
  );
  it.each(["start", "end", "size_bytes", "target", "etag", "extra"])(
    "TestBR084_exact_range_evidence rejects mismatch %s",
    async (field) => {
      const f = await contentFixture();
      let response: ReturnType<typeof rangeResponse> | undefined;
      f.content.open.mockImplementation((request) => {
        const result = rangeResponse(request, f.bytes);
        response = result;
        return Promise.resolve({
          ...result,
          [field]:
            field === "target"
              ? { driveId: 9, id: 3 }
              : field === "etag"
                ? '"changed"'
                : -1,
        });
      });
      const c = createNavigationController(f.config, f.dependencies);
      expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
        contentError(
          field === "etag" ? "VERSION_CHANGED" : "CONTENT_UNAVAILABLE",
        ),
      );
      expect(response!.body.read).not.toHaveBeenCalled();
      expect(response!.body.close).toHaveBeenCalledOnce();
      c.close();
    },
  );
  it.each(["short", "extra", "empty", "oversize", "nonbyte", "throw"])(
    "TestBR084_exact_range_evidence rejects body %s",
    async (kind) => {
      const f = await contentFixture();
      const body = {
        read: vi.fn((): Promise<unknown> => Promise.resolve(null)),
        close: vi.fn(),
      };
      if (kind === "extra")
        body.read
          .mockResolvedValueOnce(f.bytes)
          .mockResolvedValueOnce(Buffer.from([1]));
      if (kind === "empty") body.read.mockResolvedValueOnce(Buffer.alloc(0));
      if (kind === "oversize") body.read.mockResolvedValueOnce(Buffer.alloc(8));
      if (kind === "nonbyte") body.read.mockResolvedValueOnce("CANARY_CONTENT");
      if (kind === "throw")
        body.read.mockRejectedValueOnce(new ReadFailure(503));
      f.content.open.mockImplementation((request) =>
        Promise.resolve({ ...request, status: 206, body }),
      );
      const c = createNavigationController(f.config, f.dependencies);
      expect((await c.invoke("kdrive_download", { file_id: 3 })).isError).toBe(
        true,
      );
      expect(f.content.open).toHaveBeenCalledOnce();
      expect(body.close).toHaveBeenCalledOnce();
      c.close();
    },
  );
  it("TestBR084_exact_range_evidence safe-integer total and final-byte arithmetic", async () => {
    const f = await contentFixture();
    const total = Number.MAX_SAFE_INTEGER;
    f.content.describe.mockImplementation((target) =>
      Promise.resolve({
        target,
        size_bytes: total,
        etag: f.etag,
        version_bound: true,
      }),
    );
    f.content.open.mockImplementation((request) =>
      Promise.resolve({
        ...request,
        status: 206,
        body: {
          read: vi
            .fn()
            .mockResolvedValueOnce(Buffer.from([255]))
            .mockResolvedValueOnce(null),
          close: vi.fn(),
        },
      }),
    );
    const c = createNavigationController(f.config, f.dependencies);
    const data = payload(
      await c.invoke("kdrive_download", {
        file_id: 3,
        offset_bytes: total - 1,
        etag: f.etag,
      }),
    ) as RawPayload;
    expect(data).toMatchObject({
      bytes_read: 1,
      size_bytes: total,
      has_more: false,
    });
    expect(f.content.open.mock.calls[0]![0].end).toBe(total - 1);
    c.close();
  });
});

describe("policy, output and representation bounds", () => {
  it("TestBR091_content_own_data_projection malformed open closes own-data reader without hooks", async () => {
    const f = await contentFixture(),
      getter = vi.fn(() => "CANARY_HEADER"),
      close = vi.fn();
    f.content.open.mockImplementation((request) =>
      Promise.resolve(
        Object.defineProperty(
          { ...request, status: 206, body: { read: vi.fn(), close } },
          "status",
          { get: getter },
        ),
      ),
    );
    const c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("CONTENT_UNAVAILABLE"),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    c.close();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "7"])(
    "TestBR091_content_own_data_projection invalid descriptor size %s",
    async (size) => {
      const f = await contentFixture();
      f.content.describe.mockImplementation((target) =>
        Promise.resolve({
          target,
          size_bytes: size,
          etag: f.etag,
          version_bound: true,
        }),
      );
      const c = createNavigationController(f.config, f.dependencies);
      expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
        contentError("CONTENT_UNAVAILABLE"),
      );
      expect(f.content.open).not.toHaveBeenCalled();
      c.close();
    },
  );
  it("TestBR091_content_own_data_projection missing validator and body method hooks", async () => {
    const f = await contentFixture(),
      getter = vi.fn(() => Promise.resolve(null)),
      close = vi.fn();
    f.content.describe.mockImplementationOnce((target) =>
      Promise.resolve({ target, size_bytes: 7, version_bound: true }),
    );
    const c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("VERSION_UNAVAILABLE"),
    );
    f.content.open.mockImplementation((request) =>
      Promise.resolve({
        ...request,
        status: 206,
        body: Object.defineProperty({ close }, "read", { get: getter }),
      }),
    );
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("CONTENT_UNAVAILABLE"),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    c.close();
  });
  it.each([{ file_id: 2 }, { file_id: 999 }, { file_id: 3, drive_id: 12 }])(
    "TestBR082_surface_policy_agreement denied %j",
    async (args) => {
      const f = await contentFixture(),
        c = createNavigationController(f.config, f.dependencies);
      expect(await c.invoke("kdrive_download", args)).toEqual(
        contentError("ACCESS_DENIED"),
      );
      await expect(
        c.readResource(`kdrive://${args.drive_id ?? 7}/file/${args.file_id}`),
      ).rejects.toThrow("ACCESS_DENIED");
      expect(f.content.describe).not.toHaveBeenCalled();
      c.close();
    },
  );
  it("TestBR082_surface_policy_agreement default/explicit owner and colliding IDs", async () => {
    const f = await contentFixture(),
      c = createNavigationController(f.config, f.dependencies);
    for (const drive_id of [undefined, 9, undefined]) {
      const args = { file_id: 3, ...(drive_id ? { drive_id } : {}) };
      const info = payload(await c.invoke("kdrive_info", args)) as {
        item: { drive_id: number };
      };
      const data = payload(
        await c.invoke("kdrive_download", args),
      ) as RawPayload;
      expect(data.drive_id).toBe(info.item.drive_id);
      expect(
        (await c.readResource(`kdrive://${data.drive_id}/file/3`)).contents[0]!
          .blob,
      ).toBe(f.bytes.toString("base64"));
    }
    c.close();
  });
  it("TestBR082_surface_policy_agreement final changed authorization discards bytes", async () => {
    const f = await contentFixture();
    f.content.open.mockImplementation((request) => {
      const result = rangeResponse(request, f.bytes);
      const read = result.body.read.getMockImplementation()!;
      result.body.read.mockImplementation((max) => {
        f.nodes.delete("7:3");
        return read(max);
      });
      return Promise.resolve(result);
    });
    const c = createNavigationController(f.config, f.dependencies);
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("ACCESS_DENIED"),
    );
    c.close();
  });
  it.each([1, 2, 3])(
    "TestBR085_raw_byte_budget and TestBR085_base64_output_budget exact cap %s",
    async (cap) => {
      const f = await contentFixture({
          KDRIVE_MCP_MAX_READ_BYTES: String(cap),
        }),
        c = createNavigationController(f.config, f.dependencies);
      const data = payload(
        await c.invoke("kdrive_download", { file_id: 3 }),
      ) as RawPayload;
      expect(data.bytes_read).toBe(cap);
      expect(data.data).toHaveLength(4 * Math.ceil(cap / 3));
      const calls = f.content.describe.mock.calls.length;
      expect(
        await c.invoke("kdrive_download", {
          file_id: 3,
          length_bytes: cap + 1,
        }),
      ).toEqual(contentError("LIMIT_EXCEEDED"));
      expect(f.content.describe).toHaveBeenCalledTimes(calls);
      await expect(c.readResource("kdrive://7/file/3")).rejects.toThrow(
        "LIMIT_EXCEEDED",
      );
      c.close();
    },
  );
  it.each([1, 2, 3])(
    "TestBR085_base64_output_budget exact serialized character ceiling length %s",
    async (length) => {
      const bytes = Buffer.alloc(length),
        initial = await contentFixture({}, bytes),
        first = createNavigationController(
          initial.config,
          initial.dependencies,
        );
      const response = await first.invoke("kdrive_download", { file_id: 3 });
      const count = (response.content[0] as { text: string }).text.length;
      first.close();
      const f = await contentFixture(
          { KDRIVE_MCP_MAX_OUTPUT_CHARS: String(count) },
          bytes,
        ),
        c = createNavigationController(f.config, f.dependencies);
      expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
        response,
      );
      c.close();
      const smaller = await contentFixture(
          { KDRIVE_MCP_MAX_OUTPUT_CHARS: String(count - 1) },
          bytes,
        ),
        d = createNavigationController(smaller.config, smaller.dependencies);
      expect(await d.invoke("kdrive_download", { file_id: 3 })).toEqual(
        contentError("LIMIT_EXCEEDED"),
      );
      expect(smaller.content.open).not.toHaveBeenCalled();
      d.close();
    },
  );
  it("TestBR085_base64_output_budget byte ceiling and escaped tag include whole overhead", async () => {
    const f = await contentFixture(
        { KDRIVE_MCP_MAX_OUTPUT_CHARS: "10000000" },
        Buffer.alloc(200000),
      ),
      c = createNavigationController(f.config, f.dependencies),
      etag = '"a\\b"';
    f.content.describe.mockImplementation((target) =>
      Promise.resolve({
        target,
        size_bytes: f.bytes.length,
        etag,
        version_bound: true,
      }),
    );
    const result = await c.invoke("kdrive_download", { file_id: 3 }),
      text = (result.content[0] as { text: string }).text,
      data = payload(result) as RawPayload;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262144);
    expect(262144 - Buffer.byteLength(text)).toBeLessThan(4);
    expect(data.etag).toBe(etag);
    expect(data.has_more).toBe(true);
    expect(Buffer.from(data.data, "base64")).toEqual(
      f.bytes.subarray(0, data.bytes_read),
    );
    c.close();
  });
  it.each([0, 1, 2, 3, 16])(
    "TestBR086_complete_binary_resource length %s",
    async (size) => {
      const f = await contentFixture({}, Buffer.alloc(size, 255)),
        c = createNavigationController(f.config, f.dependencies);
      expect(await c.readResource("kdrive://7/file/3")).toEqual({
        contents: [
          {
            uri: "kdrive://7/file/3",
            mimeType: "application/octet-stream",
            blob: f.bytes.toString("base64"),
          },
        ],
      });
      c.close();
    },
  );
  it("TestBR086_complete_binary_resource full output overhead equality and above", async () => {
    const bytes = Buffer.alloc(3),
      value = {
        contents: [
          {
            uri: "kdrive://7/file/3",
            mimeType: "application/octet-stream",
            blob: bytes.toString("base64"),
          },
        ],
      },
      limit = JSON.stringify(value).length;
    for (const delta of [-1, 0, 1]) {
      const f = await contentFixture(
          { KDRIVE_MCP_MAX_OUTPUT_CHARS: String(limit + delta) },
          bytes,
        ),
        c = createNavigationController(f.config, f.dependencies);
      if (delta < 0) {
        await expect(c.readResource("kdrive://7/file/3")).rejects.toThrow(
          "LIMIT_EXCEEDED",
        );
        expect(f.content.open).not.toHaveBeenCalled();
      } else expect(await c.readResource("kdrive://7/file/3")).toEqual(value);
      c.close();
    }
  });
  it.each([
    "kdrive://7/file/3?representation=text",
    "kdrive://7/file/3?offset=1",
    "kdrive://7/file/3#image",
    "kdrive://07/file/3",
    "kdrive://7/file/03",
    "KDRIVE://7/file/3",
    "kdrive://7/file/3/",
    "kdrive://7/file/%33",
    "kdrive://user@7/file/3",
    "kdrive://7:80/file/3",
    "kdrive://7/file/9007199254740992",
    "kdrive://7/file/3\n",
    "x",
  ])("TestBR087_unsupported_resource_representation %s", async (uri) => {
    const f = await contentFixture(),
      c = createNavigationController(f.config, f.dependencies);
    await expect(c.readResource(uri)).rejects.toThrow(
      "UNSUPPORTED_REPRESENTATION",
    );
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.content.describe).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR091_content_own_data_projection rejects hooks without invocation", async () => {
    const f = await contentFixture(),
      getter = vi.fn(() => "CANARY_GETTER"),
      hook = vi.fn(() => "CANARY_JSON");
    const c = createNavigationController(f.config, f.dependencies);
    f.content.describe.mockImplementation((target) =>
      Promise.resolve(
        Object.defineProperty(
          { target, size_bytes: 7, etag: f.etag, version_bound: true },
          "secret",
          { get: getter },
        ),
      ),
    );
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("CONTENT_UNAVAILABLE"),
    );
    expect(getter).not.toHaveBeenCalled();
    f.content.describe.mockImplementation((target) =>
      Promise.resolve({
        target,
        size_bytes: 7,
        etag: f.etag,
        version_bound: true,
        toJSON: hook,
      }),
    );
    expect(await c.invoke("kdrive_download", { file_id: 3 })).toEqual(
      contentError("CONTENT_UNAVAILABLE"),
    );
    expect(hook).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR091_content_own_data_projection byteLength hook never executes", async () => {
    const f = await contentFixture(),
      getter = vi.fn(() => 999);
    f.content.open.mockImplementation((request) => {
      const response = rangeResponse(request, f.bytes);
      response.body.read
        .mockResolvedValueOnce(
          Object.defineProperty(Buffer.from(f.bytes), "byteLength", {
            get: getter,
          }),
        )
        .mockResolvedValueOnce(null);
      return Promise.resolve(response);
    });
    const c = createNavigationController(f.config, f.dependencies);
    const result = await c.invoke("kdrive_download", { file_id: 3 });
    expect(result.isError).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR090_content_error_redaction never inspects hostile thrown object", async () => {
    const f = await contentFixture(),
      getter = vi.fn(() => "CANARY_SECRET"),
      stderr: string[] = [];
    const thrown = Object.defineProperty({}, "message", { get: getter });
    f.content.open.mockRejectedValue(thrown);
    const c = createNavigationController(f.config, f.dependencies, (s) =>
      stderr.push(s),
    );
    const result = await c.invoke("kdrive_download", { file_id: 3 });
    expect(result.isError).toBe(true);
    await expect(c.readResource("kdrive://7/file/3")).rejects.toThrow(
      "ACCESS_DENIED",
    );
    expect(JSON.stringify(result) + stderr.join("")).not.toContain("CANARY_");
    expect(getter).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR083_version_binding strong validator grammar exact boundaries", () => {
    for (const tag of ['"a"', '"' + "a".repeat(254) + '"', '"a\\b"'])
      expect(strongETag(tag)).toBe(true);
    for (const tag of [
      '""',
      '"' + "a".repeat(255) + '"',
      'W/"a"',
      '"a"\n',
      '"é"',
    ])
      expect(strongETag(tag)).toBe(false);
    expect(resourceTarget("kdrive://7/file/3")).toEqual({ driveId: 7, id: 3 });
  });
});

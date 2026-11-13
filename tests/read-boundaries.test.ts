import { expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { readResult } from "../src/extraction.js";
import { decodeText } from "../src/extraction-text.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { payload } from "./helpers/navigation.js";
import { ReadFailure } from "../src/read-retry.js";
const read = { file_id: 3, format: "text" };
it.each([
  [Buffer.from("\ufeffa\ufeff"), undefined, "a\ufeff", "utf-8"],
  [
    Buffer.from([255, 254, 65, 0, 61, 216, 0, 222]),
    undefined,
    "A😀",
    "utf-16le",
  ],
  [Buffer.from([254, 255, 0, 65]), undefined, "A", "utf-16be"],
  [Buffer.from([128, 233]), "windows-1252", "€é", "windows-1252"],
  [Buffer.alloc(0), undefined, "", "utf-8"],
] as const)(
  "TestBR112_strict_decoding valid encoding sample %#",
  (bytes, encoding, text, selected) => {
    expect(decodeText(bytes, encoding, 100)).toEqual({
      kind: "text",
      text,
      encoding: selected,
    });
  },
);
it.each([
  [Buffer.from([192, 175]), undefined, "INVALID_ENCODING"],
  [Buffer.from([226, 130]), undefined, "INVALID_ENCODING"],
  [Buffer.from([255, 254, 0, 216]), undefined, "INVALID_ENCODING"],
  [Buffer.from([1]), "utf-16le", "INVALID_ENCODING"],
  [Buffer.from([239, 187, 191, 65]), "utf-16le", "INVALID_ENCODING"],
  [Buffer.from([0]), undefined, "UNSUPPORTED_FORMAT"],
  [Buffer.from([1, 2, 3]), "windows-1252", "UNSUPPORTED_FORMAT"],
] as const)(
  "TestBR112_strict_decoding refuses corrupt encoding %#",
  (bytes, encoding, code) => {
    expect(() => decodeText(bytes, encoding, 100)).toThrow(code);
  },
);
it("TestBR117_decoded_bytes count UTF8 bytes independently of source length", () => {
  expect(() => decodeText(Buffer.from([128]), "windows-1252", 2)).toThrow(
    "LIMIT_EXCEEDED",
  );
  expect(decodeText(Buffer.from([128]), "windows-1252", 3).text).toBe("€");
});
it("TestBR113_complete_output_budget includes both escaping layers and preserves progress", () => {
  const meta = { drive_id: 7, file_id: 3, etag: '"a\\b"', size_bytes: 20 };
  const value = {
    kind: "text" as const,
    text: 'A😀\n"\\é'.repeat(20),
    encoding: "utf-8",
  };
  const result = readResult(meta, { format: "text" }, value, 100000),
    size = JSON.stringify(result).length;
  expect(readResult(meta, { format: "text" }, value, size)).toEqual(result);
  const truncated = readResult(meta, { format: "text" }, value, size - 1),
    p = payload(truncated) as {
      text: string;
      next_offset: number;
      has_more: boolean;
    };
  expect(p.has_more).toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- F-011: code-point iteration of the string is intended
  expect(p.next_offset).toBe([...p.text].length);
  expect(p.text.length).toBeGreaterThan(0);
  expect(JSON.stringify(truncated).length).toBeLessThanOrEqual(size - 1);
  expect(() => readResult(meta, { format: "text" }, value, 1)).toThrow(
    "LIMIT_EXCEEDED",
  );
  expect(() =>
    readResult(meta, { format: "text", offset: 999 }, value, 1000),
  ).toThrow("INVALID_RANGE");
  const empty = { kind: "text" as const, text: "", encoding: "utf-8" };
  expect(
    payload(readResult(meta, { format: "text" }, empty, 1000)),
  ).toMatchObject({ characters_read: 0, has_more: false, total_characters: 0 });
});
it.each(["text", "pdf", "image"])(
  "TestBR111_complete_source rejects oversized %s before open",
  async (format) => {
    const f = await contentFixture(
        { KDRIVE_MCP_MAX_READ_BYTES: "3" },
        Buffer.from("four"),
      ),
      c = createNavigationController(f.config, f.dependencies);
    try {
      expect(await c.invoke("kdrive_read", { file_id: 3, format })).toEqual(
        contentError("LIMIT_EXCEEDED"),
      );
      expect(f.content.open).not.toHaveBeenCalled();
    } finally {
      c.close();
    }
  },
);
it("TestBR110_version_selection refuses changed or unqualified versions before bodies", async () => {
  const f = await contentFixture({}, Buffer.from("hello")),
    c = createNavigationController(f.config, f.dependencies);
  try {
    expect(
      await c.invoke("kdrive_read", { ...read, offset: 1, etag: '"other"' }),
    ).toEqual(contentError("VERSION_CHANGED"));
    expect(f.content.open).not.toHaveBeenCalled();
    f.content.describe.mockImplementation((target) =>
      Promise.resolve({
        target,
        size_bytes: 5,
        etag: f.etag,
        version_bound: false,
      }),
    );
    expect(await c.invoke("kdrive_read", read)).toEqual(
      contentError("VERSION_UNAVAILABLE"),
    );
    expect(f.content.open).not.toHaveBeenCalled();
  } finally {
    c.close();
  }
});
it.each([
  { file_id: 3, format: "text", offset: 1 },
  { ...read, offset: null },
  { ...read, length: 0 },
  { ...read, pages: [1] },
  { file_id: 3, format: "pdf", encoding: "utf-8" },
  { file_id: 3, format: "pdf", pages: [2, 1] },
  { file_id: 3, format: "pdf", pages: [] },
  { file_id: 3, format: "image", length: 1 },
  { ...read, unknown: ["CANARY"] },
])(
  "TestBR119_explicit_refusals rejects schema before calls %#",
  async (args) => {
    const f = await contentFixture(),
      c = createNavigationController(f.config, f.dependencies);
    try {
      expect(await c.invoke("kdrive_read", args)).toEqual(
        contentError("INVALID_ARGUMENTS"),
      );
      expect(f.inspect).not.toHaveBeenCalled();
      expect(f.content.describe).not.toHaveBeenCalled();
    } finally {
      c.close();
    }
  },
);
it("TestBR109_fresh_policy final revocation discards already downloaded/extracted content", async () => {
  const f = await contentFixture({}, Buffer.from("CANARY_REVOKED")),
    c = createNavigationController(f.config, f.dependencies);
  try {
    const original = f.content.open.getMockImplementation()!;
    f.content.open.mockImplementation(async (request) => {
      const response = await original(request);
      setTimeout(() => f.nodes.delete("7:3"), 5);
      return response;
    });
    expect(await c.invoke("kdrive_read", read)).toEqual(
      contentError("ACCESS_DENIED"),
    );
    expect(f.bodies[0]!.close).toHaveBeenCalledOnce();
  } finally {
    c.close();
  }
});
it("TestBR109_fresh_policy retries reauthorize and never retries body reads", async () => {
  const f = await contentFixture({}, Buffer.from("one")),
    c = createNavigationController(f.config, f.dependencies);
  try {
    f.content.describe.mockRejectedValueOnce(new ReadFailure(503));
    expect((await c.invoke("kdrive_read", read)).isError).toBeUndefined();
    expect(f.content.describe).toHaveBeenCalledTimes(2);
    const before = f.content.open.mock.calls.length;
    f.content.open.mockImplementation(() =>
      Promise.resolve({
        target: { driveId: 7, id: 3 },
        start: 0,
        end: 2,
        size_bytes: 3,
        etag: f.etag,
        status: 206,
        body: {
          read: () => Promise.reject(new ReadFailure(503)),
          close: vi.fn(),
        },
      }),
    );
    expect((await c.invoke("kdrive_read", read)).isError).toBe(true);
    expect(f.content.open).toHaveBeenCalledTimes(before + 1);
  } finally {
    c.close();
  }
});
it("TestBR118_worker_lifecycle timeout, waiting, cancellation and slot recovery", async () => {
  const f = await contentFixture(
      { KDRIVE_MCP_EXTRACT_TIMEOUT_MS: "1" },
      Buffer.from("a".repeat(100000)),
    ),
    c = createNavigationController(f.config, f.dependencies);
  try {
    const order: string[] = [];
    const task = c.invoke("kdrive_read", read).then((r) => {
      order.push("read");
      return r;
    });
    // BR-118 v2: the info call waits and runs after the read settles.
    const info = c.invoke("kdrive_info", { file_id: 3 }).then((r) => {
      order.push("info");
      return r;
    });
    expect(await task).toEqual(contentError("REQUEST_TIMEOUT"));
    expect((await info).isError).toBeUndefined();
    expect(order).toEqual(["read", "info"]);
    expect(
      (await c.invoke("kdrive_info", { file_id: 3 })).isError,
    ).toBeUndefined();
    const abort = new AbortController();
    const cancel = c.invoke("kdrive_read", read, abort.signal);
    abort.abort();
    expect(await cancel).toEqual(contentError("ACCESS_DENIED"));
    expect(f.bodies.every((b) => b.close.mock.calls.length === 1)).toBe(true);
  } finally {
    c.close();
  }
});
it("TestBR120_redaction and TestBR121_own_data_projection reject hostile descriptors without hooks", async () => {
  const f = await contentFixture(),
    logs: string[] = [],
    c = createNavigationController(f.config, f.dependencies, (m) =>
      logs.push(m),
    );
  let hooks = 0;
  try {
    f.content.describe.mockResolvedValue(
      Object.defineProperty({}, "etag", {
        get() {
          hooks++;
          throw Error("CANARY_TOKEN_URL");
        },
      }),
    );
    const result = await c.invoke("kdrive_read", read);
    expect(result.isError).toBe(true);
    expect(hooks).toBe(0);
    expect(JSON.stringify(result) + logs.join("")).not.toContain("CANARY");
  } finally {
    c.close();
  }
});

it("TestBR121_own_data_projection rejects worker accessors without calling hooks", async () => {
  const { validateExtracted } = await import("../src/extraction.js");
  let hooks = 0;
  const v = Object.defineProperty({ kind: "text", encoding: "utf-8" }, "text", {
    enumerable: true,
    get() {
      hooks++;
      return "CANARY";
    },
  });
  expect(() => validateExtracted(v, 100)).toThrow();
  expect(hooks).toBe(0);
  const data = new Uint8Array([1, 2, 3]);
  Object.defineProperty(data, "byteLength", {
    get() {
      hooks++;
      return 999;
    },
  });
  expect(() =>
    validateExtracted({ kind: "image", data, width: 1, height: 1 }, 100),
  ).toThrow("CONTENT_UNAVAILABLE");
  expect(hooks).toBe(0);
});

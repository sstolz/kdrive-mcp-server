import { afterEach, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import jpegJs from "jpeg-js";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { payload } from "./helpers/navigation.js";
import {
  extractImage,
  preflightImage,
  resizeNearest,
} from "../src/extraction-image.js";
import {
  decodeJpeg,
  decodePng,
  encodeJpeg,
  encodePng,
} from "./helpers/image-codecs.js";
const bitmap = (w: number, h: number) => ({
  width: w,
  height: h,
  data: Buffer.alloc(w * h * 4, 255),
});
const req = (
  bytes: Uint8Array,
  budget = 16777216,
  maxOutputChars = 200000,
) => ({
  bytes,
  budget,
  maxOutputChars,
  args: { format: "image" as const },
  metadata: { drive_id: 7, file_id: 3, etag: '"v1"', size_bytes: bytes.length },
});
it.each(["png", "jpeg"])(
  "TestBR116_complete_images whole valid %s returns one PNG",
  async (format) => {
    const b = bitmap(20, 10),
      bytes = format === "png" ? encodePng(b) : encodeJpeg(b);
    const f = await contentFixture({}, Buffer.from(bytes)),
      c = createNavigationController(f.config, f.dependencies);
    try {
      const result = await c.invoke("kdrive_read", {
        file_id: 3,
        format: "image",
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(2);
      const image = result.content[1] as {
        type: string;
        data: string;
        mimeType: string;
      };
      expect(image.type).toBe("image");
      expect(image.mimeType).toBe("image/png");
      const decoded = decodePng(Buffer.from(image.data, "base64"));
      expect([decoded.width, decoded.height]).toEqual([20, 10]);
      expect(payload(result)).toMatchObject({ width: 20, height: 10 });
    } finally {
      c.close();
    }
  },
);
it("TestBR116_image_budgets exact JPEG megapixel boundary and declared PNG bombs", async () => {
  const jpegBytes = encodeJpeg(bitmap(1024, 1024));
  expect(preflightImage(jpegBytes, 16777216).width).toBe(1024);
  expect(
    decodeJpeg(jpegBytes, {
      tolerantDecoding: false,
      maxResolutionInMP: 1048576 / 1000000,
      maxMemoryUsageInMB: 32,
    }).width,
  ).toBe(1024);
  const bytes = encodePng(bitmap(2, 2));
  expect(() => preflightImage(bytes, 15)).toThrow("LIMIT_EXCEEDED");
  const broken = Buffer.from(bytes);
  broken[broken.length - 1] = broken[broken.length - 1]! ^ 1;
  expect(() => preflightImage(broken, 16777216)).toThrow();
  const result = await extractImage(req(bytes, 16777216, 1000));
  expect(result.width).toBe(2);
  await expect(extractImage(req(bytes, 16777216, 10))).rejects.toThrow(
    "LIMIT_EXCEEDED",
  );
});
it("TestBR119_explicit_refusals rejects unsupported formats and image argument slicing", async () => {
  const f = await contentFixture({}, Buffer.from("GIF89a")),
    c = createNavigationController(f.config, f.dependencies);
  try {
    expect(
      await c.invoke("kdrive_read", { file_id: 3, format: "image" }),
    ).toEqual(contentError("UNSUPPORTED_FORMAT"));
    expect(
      await c.invoke("kdrive_read", { file_id: 3, format: "image", offset: 0 }),
    ).toEqual(contentError("INVALID_ARGUMENTS"));
  } finally {
    c.close();
  }
});

it("TestBR116_image_budgets rejects one-over JPEG in both admission and actual decoder", () => {
  const bytes = Buffer.from(encodeJpeg(bitmap(1024, 1024)));
  let pos = 2;
  while (bytes[pos + 1] !== 192) {
    const length = bytes.readUInt16BE(pos + 2);
    pos += length + 2;
  }
  bytes.writeUInt16BE(1025, pos + 7);
  expect(() => preflightImage(bytes, 16777216)).toThrow("LIMIT_EXCEEDED");
  expect(() =>
    decodeJpeg(bytes, {
      tolerantDecoding: false,
      maxResolutionInMP: 1048576 / 1000000,
      maxMemoryUsageInMB: 32,
    }),
  ).toThrow();
});
it("TestBR116_complete_images direct decoder ignores oriented EXIF", async () => {
  const original = encodeJpeg(bitmap(20, 10)),
    exif = Buffer.from(
      "45786966000049492a0008000000010012010300010000000600000000000000",
      "hex",
    ),
    header = Buffer.alloc(4);
  header[0] = 255;
  header[1] = 225;
  header.writeUInt16BE(exif.length + 2, 2);
  const bytes = Buffer.concat([
    original.subarray(0, 2),
    header,
    exif,
    original.subarray(2),
  ]);
  const result = await extractImage(req(bytes));
  expect([result.width, result.height]).toEqual([20, 10]);
});

it("TestBR116_image_budgets stops PNG expansion at exact scanline length", async () => {
  const { crc32, deflateSync } = await import("node:zlib");
  const chunk = (type: string, body: Buffer) => {
    const b = Buffer.alloc(body.length + 12);
    b.writeUInt32BE(body.length);
    b.write(type, 4, "ascii");
    b.set(body, 8);
    b.writeUInt32BE(crc32(b.subarray(4, body.length + 8)), body.length + 8);
    return b;
  };
  const header = Buffer.from("00000001000000010806000000", "hex"),
    signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const bomb = Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(4097))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  expect(() => preflightImage(bomb, 16777216)).toThrow("LIMIT_EXCEEDED");
  const ordinary = encodePng(bitmap(1, 1));
  expect(preflightImage(ordinary, 5)).toMatchObject({ width: 1, height: 1 });
  expect(() => preflightImage(ordinary, 4)).toThrow("LIMIT_EXCEEDED");
});
it("TestBR390_codec_calls image route resizes a 600 x 400 PNG to 512 x 341", async () => {
  const bytes = encodePng(bitmap(600, 400));
  const f = await contentFixture({}, Buffer.from(bytes)),
    c = createNavigationController(f.config, f.dependencies);
  try {
    const result = await c.invoke("kdrive_read", {
      file_id: 3,
      format: "image",
    });
    expect(result.isError).toBeUndefined();
    const image = result.content[1] as { data: string; mimeType: string };
    expect(image.mimeType).toBe("image/png");
    const decoded = decodePng(Buffer.from(image.data, "base64"));
    expect([decoded.width, decoded.height]).toEqual([512, 341]);
    expect(payload(result)).toMatchObject({ width: 512, height: 341 });
  } finally {
    c.close();
  }
  const direct = await extractImage(req(bytes));
  expect([direct.width, direct.height]).toEqual([512, 341]);
});

afterEach(() => {
  vi.restoreAllMocks();
});
const PNG_WRITE = {
  deflateLevel: 9,
  deflateStrategy: 3,
  filterType: -1,
  colorType: 6,
  inputHasAlpha: true,
};
it("TestBR390_codec_calls decodes and encodes with the exact codec options", async () => {
  // pngjs fills defaults into the options object it receives, so each spy
  // records a copy of the options as passed, then delegates.
  const realRead = PNG.sync.read,
    realWrite = PNG.sync.write,
    realDecode = jpegJs.decode;
  const read = vi
      .spyOn(PNG.sync, "read")
      .mockImplementation((data, options) =>
        realRead(data, options && { ...options }),
      ),
    write = vi
      .spyOn(PNG.sync, "write")
      .mockImplementation((png, options) =>
        realWrite(png, options && { ...options }),
      ),
    decode = vi
      .spyOn(jpegJs, "decode")
      .mockImplementation((data, options) =>
        realDecode(data, options && { ...options }),
      );
  const pngBytes = encodePng(bitmap(600, 400)),
    jpegBytes = encodeJpeg(bitmap(20, 10));
  write.mockClear();
  const fromPng = await extractImage(req(pngBytes, 16777216, 1000));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]?.[1]).toEqual({ checkCRC: true });
  expect(write.mock.calls.length).toBeGreaterThan(1);
  for (const call of write.mock.calls) expect(call[1]).toEqual(PNG_WRITE);
  expect(fromPng.width).toBeLessThan(512);
  write.mockClear();
  const fromJpeg = await extractImage(req(jpegBytes));
  expect(decode).toHaveBeenCalledTimes(1);
  expect(decode.mock.calls[0]?.[1]).toEqual({
    tolerantDecoding: false,
    maxResolutionInMP: 1.048576,
    maxMemoryUsageInMB: 32,
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]?.[1]).toEqual(PNG_WRITE);
  expect([fromJpeg.width, fromJpeg.height]).toEqual([20, 10]);
});

// AC-03: pixel k of a 3 x 2 bitmap holds [k, k + 10, k + 20, k + 30].
const indexed = (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4);
  for (let k = 0; k < width * height; k++)
    data.set([k, k + 10, k + 20, k + 30], k * 4);
  return { width, height, data };
};
const pixels = (data: Buffer) =>
  Array.from({ length: data.length / 4 }, (_, k) => data[k * 4]);
it.each([
  [2, 1, [0, 1]],
  [5, 3, [0, 0, 1, 1, 2, 0, 0, 1, 1, 2, 3, 3, 4, 4, 5]],
  [1, 1, [0]],
] as const)(
  "TestBR391_resize_nearest 3 x 2 to %i x %i picks the formula's source pixels",
  (width, height, expected) => {
    const src = indexed(3, 2),
      copy = Buffer.from(src.data);
    const out = resizeNearest(src, width, height);
    expect([out.width, out.height]).toEqual([width, height]);
    expect(out.data).toBeInstanceOf(Buffer);
    expect(out.data).toHaveLength(width * height * 4);
    expect(out.data).not.toBe(src.data);
    expect(pixels(out.data)).toEqual(expected);
    for (let k = 0; k < expected.length; k++) {
      const source = expected[k] ?? 0;
      expect([...out.data.subarray(k * 4, k * 4 + 4)]).toEqual([
        source,
        source + 10,
        source + 20,
        source + 30,
      ]);
    }
    expect(src.data).toEqual(copy);
  },
);
it("TestBR391_resize_nearest chained resizes sample the previous result", () => {
  const src = indexed(4, 4);
  const half = resizeNearest(src, 2, 2);
  expect(pixels(half.data)).toEqual([0, 2, 8, 10]);
  const one = resizeNearest(half, 1, 1);
  expect(pixels(one.data)).toEqual([0]);
  const shifted = { ...half, data: Buffer.from(half.data) };
  shifted.data.set([99, 99, 99, 99], 0);
  expect(pixels(resizeNearest(shifted, 1, 1).data)).toEqual([99]);
});
it("TestBR391_resize_nearest multiplies before dividing", () => {
  const src = indexed(30, 1);
  const out = resizeNearest(src, 22, 1);
  expect(Math.floor((11 * 30) / 22)).toBe(15);
  expect(Math.floor(11 * (30 / 22))).toBe(14);
  expect(out.data[11 * 4]).toBe(15);
});

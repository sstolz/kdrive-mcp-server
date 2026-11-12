import { expect, it } from "vitest";
import png from "@jimp/js-png";
import jpeg from "@jimp/js-jpeg";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { payload } from "./helpers/navigation.js";
import { extractImage, preflightImage } from "../src/extraction-image.js";
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
      bytes = format === "png" ? png().encode(b) : jpeg().encode(b);
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
      const decoded = png().decode(Buffer.from(image.data, "base64"));
      expect([decoded.width, decoded.height]).toEqual([20, 10]);
      expect(payload(result)).toMatchObject({ width: 20, height: 10 });
    } finally {
      c.close();
    }
  },
);
it("TestBR116_image_budgets exact JPEG megapixel boundary and declared PNG bombs", async () => {
  const jpegBytes = jpeg().encode(bitmap(1024, 1024));
  expect(preflightImage(jpegBytes, 16777216).width).toBe(1024);
  expect(
    jpeg().decode(jpegBytes, {
      tolerantDecoding: false,
      maxResolutionInMP: 1048576 / 1000000,
      maxMemoryUsageInMB: 32,
    }).width,
  ).toBe(1024);
  const bytes = png().encode(bitmap(2, 2));
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
  const bytes = Buffer.from(jpeg().encode(bitmap(1024, 1024)));
  let pos = 2;
  while (bytes[pos + 1] !== 192) {
    const length = bytes.readUInt16BE(pos + 2);
    pos += length + 2;
  }
  bytes.writeUInt16BE(1025, pos + 7);
  expect(() => preflightImage(bytes, 16777216)).toThrow("LIMIT_EXCEEDED");
  expect(() =>
    jpeg().decode(bytes, {
      tolerantDecoding: false,
      maxResolutionInMP: 1048576 / 1000000,
      maxMemoryUsageInMB: 32,
    }),
  ).toThrow();
});
it("TestBR116_complete_images direct decoder ignores oriented EXIF", async () => {
  const original = jpeg().encode(bitmap(20, 10)),
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
  const ordinary = png().encode(bitmap(1, 1));
  expect(preflightImage(ordinary, 5)).toMatchObject({ width: 1, height: 1 });
  expect(() => preflightImage(ordinary, 4)).toThrow("LIMIT_EXCEEDED");
});
it("TestBR317_jimp_on_root_zod image route resizes a 600 x 400 PNG to 512 x 341", async () => {
  const bytes = png().encode(bitmap(600, 400));
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
    const decoded = png().decode(Buffer.from(image.data, "base64"));
    expect([decoded.width, decoded.height]).toEqual([512, 341]);
    expect(payload(result)).toMatchObject({ width: 512, height: 341 });
  } finally {
    c.close();
  }
  const direct = await extractImage(req(bytes));
  expect([direct.width, direct.height]).toEqual([512, 341]);
});

import { createHash } from "node:crypto";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { expect, it } from "vitest";
import { contentFailure } from "../src/content.js";
import { extractImage, preflightImage } from "../src/extraction-image.js";
import { createNavigationController } from "../src/navigation.js";
import { contentError, contentFixture } from "./helpers/content.js";
import { encodeJpeg, encodePng, type Bitmap } from "./helpers/image-codecs.js";

// F-027 (#12) AC-01 and AC-14: the image route's outputs and codec error
// outcomes, recorded on the Jimp 1.6.1 path before the codec switch. Inputs
// come from pngjs, jpeg-js and node:zlib only, so this file is unchanged by
// the switch.

// PNG byte digests depend on the deflate output of Node's zlib; linux/amd64
// is their reference architecture (D-9).
const reference = process.platform === "linux" && process.arch === "x64";

const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

// The concatenated, inflated IDAT payload: filtered scanlines, independent of
// the deflate output.
function idatDigest(data: Uint8Array): string {
  const bytes = Buffer.from(data);
  const parts: Buffer[] = [];
  let pos = 8;
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos),
      type = bytes.toString("latin1", pos + 4, pos + 8);
    if (type === "IDAT") parts.push(bytes.subarray(pos + 8, pos + 8 + length));
    pos += length + 12;
  }
  return sha256(inflateSync(Buffer.concat(parts)));
}

// Deterministic RGBA noise (xorshift32); alpha forced to 255 when opaque.
function noise(width: number, height: number, opaque: boolean): Bitmap {
  const data = Buffer.alloc(width * height * 4);
  let state = (width * 73856093) ^ (height * 19349663) ^ 0x9e3779b9;
  for (let index = 0; index < data.length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[index] = state & 255;
  }
  if (opaque)
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
  return { width, height, data };
}

function pngInput(width: number, height: number, colorType: 2 | 6): Buffer {
  const png = new PNG({ width, height });
  png.data = noise(width, height, colorType === 2).data;
  return PNG.sync.write(png, { colorType, inputHasAlpha: true });
}

const jpegInput = (width: number, height: number) =>
  jpeg.encode(noise(width, height, true), 90).data;

const request = (bytes: Uint8Array) => ({
  bytes,
  budget: 16777216,
  maxOutputChars: 200000,
  args: { format: "image" as const },
  metadata: { drive_id: 7, file_id: 3, etag: '"v1"', size_bytes: bytes.length },
});

interface Recorded {
  input: () => Buffer;
  width: number;
  height: number;
  idat: string;
  bytes: string;
}

const CASES: Record<string, Recorded> = {
  "initial resize then halving (PNG colour type 2 600 x 400)": {
    input: () => pngInput(600, 400, 2),
    width: 256,
    height: 170,
    idat: "102cfd4ec7ec308bc776328abad088e63a803ceacebf6e06b1fcebd36016f991",
    bytes: "cf86d37b35a7d6232940149b535d297d22fb4746a098929160b703906ecfc7ff",
  },
  "halving from an unresized decode (PNG colour type 6 300 x 200)": {
    input: () => pngInput(300, 200, 6),
    width: 150,
    height: 100,
    idat: "a7627462d3570fe714ea882b60ccb98025a6602b6829efec7c5ae66b50f3d6d7",
    bytes: "5f1dfe051778736c5a7d03f67b2d3a513d7538ba416a55daa3aa6bc81805c04b",
  },
  "two halvings (PNG colour type 6 1024 x 1024)": {
    input: () => pngInput(1024, 1024, 6),
    width: 128,
    height: 128,
    idat: "424f60b7aa704fd52c1698850a73a4ecc8239d44c2b8241745f4e99286e59645",
    bytes: "237271babc9ac597fc0f369e0b332195589941711c1013fbf6ed90383a5a504e",
  },
  "a non-integer ratio (PNG colour type 2 1023 x 7)": {
    input: () => pngInput(1023, 7, 2),
    width: 512,
    height: 3,
    idat: "0dbda6c7e6f9268e94157bb6de7da2425fbaa9e77e6970f85b0e50e4e42fd674",
    bytes: "194864ba606e296f50d777f2544124b5b606d2cef250406c89bb26a71d7bfd40",
  },
  "no resize at all (PNG colour type 6 64 x 48)": {
    input: () => pngInput(64, 48, 6),
    width: 64,
    height: 48,
    idat: "1ac3516877397f7db1f2efeca7b4c0764e7660f2119a4ecba3f804bff2047e2e",
    bytes: "1dd04bfce8dfeba078ed024b39197fd1752af3b2fc8133cbee8847319dd21a9d",
  },
  "JPEG with two halvings (JPEG 640 x 480)": {
    input: () => jpegInput(640, 480),
    width: 128,
    height: 96,
    idat: "23609198ba0c20302d5136115492437bbbcec7656a39a03ccd920651070c7352",
    bytes: "12ede30628f7068d91e00d6dff3cada46e6e0fa87b5bfe0055bedc48d6c6805b",
  },
  "a resize with no halving (JPEG 100 x 700)": {
    input: () => jpegInput(100, 700),
    width: 73,
    height: 512,
    idat: "80c9af1dd2e6539958dbcc5a9abb9bbd810b519944f7d8cdeb0861a116cc12b9",
    bytes: "1d3ad6b877b18490213c6f2f1b62199d326c9e7ee0f14b14958ae23882221a7e",
  },
};

const outputs = new Map<
  string,
  Promise<{ data: Uint8Array; width: number; height: number }>
>();
function output(name: string) {
  let value = outputs.get(name);
  if (!value) {
    const recorded = CASES[name];
    if (!recorded) throw new Error(`unknown case ${name}`);
    value = extractImage(request(recorded.input()));
    outputs.set(name, value);
  }
  return value;
}

it.each(Object.keys(CASES))(
  "TestBR391_characterization %s keeps its size and inflated IDAT digest",
  async (name) => {
    const recorded = CASES[name];
    const result = await output(name);
    expect([result.width, result.height]).toEqual([
      recorded?.width,
      recorded?.height,
    ]);
    expect(idatDigest(result.data)).toBe(recorded?.idat);
  },
);

it.skipIf(!reference).each(Object.keys(CASES))(
  "TestBR391_characterization %s keeps its PNG byte digest on linux/amd64",
  async (name) => {
    const result = await output(name);
    expect(sha256(result.data)).toBe(CASES[name]?.bytes);
  },
);

const white = (width: number, height: number): Bitmap => ({
  width,
  height,
  data: Buffer.alloc(width * height * 4, 255),
});
const ENCODERS: Record<string, { jpeg: string; idat: string; bytes: string }> =
  {
    "20 x 10": {
      jpeg: "84ae82c836518b00e70bef4cf16f21c0a7612f8dea7f2be69f2bfd2a86034086",
      idat: "a9a89565ce753f7b2aea64fdd1b90c2bb9091b6569ec3d77f5e37213aafa28c6",
      bytes: "17e59bfeec622e9da3d65c062f9c9565c5cc257bdc6edf1693fc0398dfd45891",
    },
    "600 x 400": {
      jpeg: "8794ecfb247043d8ff77999c070696de84bf8e73bf68214ed49f0a6ea673a021",
      idat: "c9fd30221ac6927e3feb301720d81efdae3dfbf095e50e4885a58011e63de7ed",
      bytes: "9c742486d1e5ea54e2d97a4e8779d081ab6235a99956b1515f792a6b2038491e",
    },
  };
const size = (name: string) => {
  const [width, height] = name.split(" x ").map(Number);
  return white(width ?? 0, height ?? 0);
};

it.each(Object.keys(ENCODERS))(
  "TestBR391_characterization fixture encoders keep the %s white JPEG and PNG IDAT",
  (name) => {
    expect(sha256(encodeJpeg(size(name)))).toBe(ENCODERS[name]?.jpeg);
    expect(idatDigest(encodePng(size(name)))).toBe(ENCODERS[name]?.idat);
  },
);

it.skipIf(!reference).each(Object.keys(ENCODERS))(
  "TestBR391_characterization fixture encoders keep the %s white PNG bytes on linux/amd64",
  (name) => {
    expect(sha256(encodePng(size(name)))).toBe(ENCODERS[name]?.bytes);
  },
);

// AC-14: inputs that pass preflightImage and fail in the codec.
function chunk(type: string, body: Buffer): Buffer {
  const b = Buffer.alloc(body.length + 12);
  b.writeUInt32BE(body.length);
  b.write(type, 4, "latin1");
  b.set(body, 8);
  b.writeUInt32BE(crc32(b.subarray(4, body.length + 8)), body.length + 8);
  return b;
}

function badFilterPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((1 + 4 * 4) * 2, 7);
  rows[0] = 5;
  rows[17] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Offset of the first segment with this marker (after FF xx).
function segment(bytes: Buffer, marker: number): number {
  let pos = 2;
  while (bytes[pos + 1] !== marker) pos += bytes.readUInt16BE(pos + 2) + 2;
  return pos;
}

function badHuffmanJpeg(): Buffer {
  const bytes = Buffer.from(jpegInput(64, 48));
  const counts = segment(bytes, 196) + 5;
  bytes.fill(0, counts, counts + 16);
  bytes[counts] = 1;
  return bytes;
}

function truncatedJpeg(): Buffer {
  const bytes = Buffer.from(jpegInput(64, 48));
  const sos = segment(bytes, 218),
    end = sos + 2 + bytes.readUInt16BE(sos + 2);
  return Buffer.concat([bytes.subarray(0, end + 8), Buffer.from([255, 217])]);
}

const ERRORS: Record<string, { input: () => Buffer; message: string }> = {
  "PNG filter type 5": {
    input: badFilterPng,
    message: "Unrecognised filter type - 5",
  },
  "JPEG Huffman counts": {
    input: badHuffmanJpeg,
    message: "Could not recreate Huffman Table",
  },
  "JPEG cut after SOS": {
    input: truncatedJpeg,
    message: "unexpected marker: ffd9",
  },
};

it.each(Object.keys(ERRORS))(
  "TestBR390_codec_errors %s rejects with the codec error and reads as CONTENT_UNAVAILABLE",
  async (name) => {
    const recorded = ERRORS[name];
    const bytes = recorded?.input() ?? Buffer.alloc(0);
    expect(() => preflightImage(bytes, 16777216)).not.toThrow();
    let thrown: unknown;
    try {
      await extractImage(request(bytes));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(contentFailure(thrown)).toBeUndefined();
    expect((thrown as Error).message).toBe(recorded?.message);
    const f = await contentFixture({}, Buffer.from(bytes)),
      c = createNavigationController(f.config, f.dependencies);
    try {
      expect(
        await c.invoke("kdrive_read", { file_id: 3, format: "image" }),
      ).toEqual(contentError("CONTENT_UNAVAILABLE"));
    } finally {
      c.close();
    }
  },
);

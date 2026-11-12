import { crc32, inflateSync } from "node:zlib";
import { createJimp } from "@jimp/core";
import png from "@jimp/js-png";
import jpeg from "@jimp/js-jpeg";
import { methods, ResizeStrategy } from "@jimp/plugin-resize";
import { ContentFailure } from "./content.js";
import {
  extractionFail as fail,
  imageResult,
  resultFits,
  type WorkerRequest,
} from "./extraction-values.js";
const Jimp = createJimp({ plugins: [methods], formats: [] });
/**
 * BR-318: `ResizeOptions` of `@jimp/plugin-resize` is `any` under
 * `skipLibCheck` with Zod 4 (ADR-009), so the resize call is checked here.
 */
export type ImageResizeOptions = {
  w: number;
  h: number;
  mode: ResizeStrategy;
};
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function dimensions(width: number, height: number, budget: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 1048576 ||
    width * height * 4 > budget
  )
    fail("LIMIT_EXCEEDED");
}
/** BR-116: admission precedes every codec; no MIME, metadata or automatic EXIF route. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function preflightImage(input: Uint8Array, budget: number) {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.subarray(0, 8).equals(pngSignature)) {
    let pos = 8,
      width = 0,
      height = 0,
      channels = 0,
      idat = false,
      ended = false;
    const compressed: Buffer[] = [];
    while (pos < bytes.length) {
      if (pos + 12 > bytes.length) fail("CONTENT_UNAVAILABLE");
      const length = bytes.readUInt32BE(pos),
        type = bytes.toString("latin1", pos + 4, pos + 8);
      if (length > bytes.length - pos - 12) fail("CONTENT_UNAVAILABLE");
      const body = bytes.subarray(pos + 8, pos + 8 + length);
      if (
        crc32(bytes.subarray(pos + 4, pos + 8 + length)) !==
        bytes.readUInt32BE(pos + 8 + length)
      )
        fail("CONTENT_UNAVAILABLE");
      if (type === "IHDR") {
        if (pos !== 8 || length !== 13) fail("CONTENT_UNAVAILABLE");
        width = body.readUInt32BE(0);
        height = body.readUInt32BE(4);
        dimensions(width, height, budget);
        if (
          body[8] !== 8 ||
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
          ![2, 6].includes(body[9]!) ||
          body[10] !== 0 ||
          body[11] !== 0 ||
          body[12] !== 0
        )
          fail("UNSUPPORTED_FORMAT");
        channels = body[9] === 2 ? 3 : 4;
        const expanded = (1 + width * channels) * height;
        if (expanded > budget) fail("LIMIT_EXCEEDED");
      } else if (type === "IDAT") {
        if (!width || ended) fail("CONTENT_UNAVAILABLE");
        idat = true;
        compressed.push(body);
      } else if (type === "IEND") {
        if (length || !idat || pos + 12 !== bytes.length)
          fail("CONTENT_UNAVAILABLE");
        ended = true;
      } else fail("UNSUPPORTED_FORMAT");
      pos += length + 12;
    }
    if (!ended) fail("CONTENT_UNAVAILABLE");
    const expected = (1 + width * channels) * height;
    try {
      const out = inflateSync(Buffer.concat(compressed), {
        maxOutputLength: expected,
        rejectGarbageAfterEnd: true,
      });
      if (out.length !== expected) fail("CONTENT_UNAVAILABLE");
    } catch (e) {
      if (e instanceof ContentFailure) throw e;
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? (Object.getOwnPropertyDescriptor(e, "code")?.value as unknown)
          : undefined;
      if (code === "ERR_BUFFER_TOO_LARGE") fail("LIMIT_EXCEEDED");
      fail("CONTENT_UNAVAILABLE");
    }
    return { format: "png" as const, width, height };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let pos = 2,
      width = 0,
      height = 0,
      components = 0,
      frame = false,
      scan = false,
      ended = false;
    while (pos < bytes.length && !scan) {
      if (bytes[pos++] !== 255) fail("CONTENT_UNAVAILABLE");
      while (bytes[pos] === 255) pos++;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
      const marker = bytes[pos++]!;
      if (pos + 2 > bytes.length) fail("CONTENT_UNAVAILABLE");
      const length = bytes.readUInt16BE(pos);
      if (length < 2 || length > bytes.length - pos)
        fail("CONTENT_UNAVAILABLE");
      const body = bytes.subarray(pos + 2, pos + length);
      pos += length;
      if (marker === 192) {
        if (frame || body.length < 6) fail("CONTENT_UNAVAILABLE");
        frame = true;
        if (body[0] !== 8) fail("UNSUPPORTED_FORMAT");
        height = body.readUInt16BE(1);
        width = body.readUInt16BE(3);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
        components = body[5]!;
        if (![1, 3].includes(components) || body.length !== 6 + components * 3)
          fail("UNSUPPORTED_FORMAT");
        dimensions(width, height, budget);
      } else if (marker === 218) {
        if (
          !frame ||
          body.length !== 1 + 2 * components + 3 ||
          body[0] !== components ||
          body.at(-3) !== 0 ||
          body.at(-2) !== 63 ||
          body.at(-1) !== 0
        )
          fail("UNSUPPORTED_FORMAT");
        scan = true;
      } else if (
        ![196, 219, 221, 254].includes(marker) &&
        !(marker >= 224 && marker <= 239)
      )
        fail("UNSUPPORTED_FORMAT");
    }
    if (!scan) fail("CONTENT_UNAVAILABLE");
    while (pos < bytes.length) {
      if (bytes[pos++] !== 255) continue;
      while (bytes[pos] === 255) pos++;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
      const marker = bytes[pos++]!;
      if (marker === 0 || (marker >= 208 && marker <= 215)) continue;
      if (marker === 217 && pos === bytes.length) {
        ended = true;
        break;
      }
      fail("UNSUPPORTED_FORMAT");
    }
    if (!ended) fail("CONTENT_UNAVAILABLE");
    return { format: "jpeg" as const, width, height };
  }
  return fail("UNSUPPORTED_FORMAT");
}
export async function extractImage(request: WorkerRequest) {
  await Promise.resolve();
  const plan = preflightImage(request.bytes, request.budget),
    bytes = Buffer.from(
      request.bytes.buffer,
      request.bytes.byteOffset,
      request.bytes.byteLength,
    );
  const bitmap =
    plan.format === "png"
      ? png().decode(bytes, { checkCRC: true })
      : jpeg().decode(bytes, {
          tolerantDecoding: false,
          maxResolutionInMP: 1048576 / 1000000,
          maxMemoryUsageInMB: 32,
        });
  if (
    bitmap.width !== plan.width ||
    bitmap.height !== plan.height ||
    bitmap.data.length !== plan.width * plan.height * 4
  )
    fail("CONTENT_UNAVAILABLE");
  const image = new Jimp({
    data: Buffer.from(bitmap.data),
    width: bitmap.width,
    height: bitmap.height,
  });
  const scale = Math.min(1, 512 / plan.width, 512 / plan.height);
  let width = Math.max(1, Math.floor(plan.width * scale)),
    height = Math.max(1, Math.floor(plan.height * scale));
  for (let attempt = 0; attempt < 10; attempt++) {
    if (image.bitmap.width !== width || image.bitmap.height !== height) {
      const options: ImageResizeOptions = {
        w: width,
        h: height,
        mode: ResizeStrategy.NEAREST_NEIGHBOR,
      };
      image.resize(options);
    }
    const encoded = png().encode(image.bitmap);
    if (
      resultFits(
        imageResult(request.metadata, width, height, encoded),
        request.maxOutputChars,
      )
    )
      return {
        kind: "image" as const,
        data: Uint8Array.from(encoded),
        width,
        height,
      };
    if (width === 1 && height === 1) break;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return fail("LIMIT_EXCEEDED");
}

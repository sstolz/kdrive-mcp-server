import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// F-027 (#12): fixture codecs on pngjs and jpeg-js with the defaults the
// former Jimp wrappers used, so every fixture keeps its bytes (AC-01).
export interface Bitmap {
  width: number;
  height: number;
  data: Buffer;
}

// BR-390: the PNG encode options of the image route (Jimp png().encode).
export function encodePng(bitmap: Bitmap): Buffer {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  png.data = bitmap.data;
  return PNG.sync.write(png, {
    deflateLevel: 9,
    deflateStrategy: 3,
    filterType: -1,
    colorType: 6,
    inputHasAlpha: true,
  });
}

// Jimp jpeg().encode used jpeg-js with its default quality 100.
export function encodeJpeg(bitmap: Bitmap): Buffer {
  return jpeg.encode(bitmap, 100).data;
}

export function decodePng(data: Buffer): Bitmap {
  const result = PNG.sync.read(data);
  return { data: result.data, width: result.width, height: result.height };
}

export function decodeJpeg(
  data: Buffer,
  options: Parameters<typeof jpeg.decode>[1],
): Bitmap {
  return jpeg.decode(data, options);
}

import { createExtractionWorker } from "./extraction-owner.js";
import { crc32 } from "node:zlib";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { record, array } from "./policy/values.js";
import { ContentFailure } from "./content.js";
import {
  extractionFail,
  imageResult,
  resultFits,
  type WorkerRequest,
  type ReadArguments,
  type ReadMetadata,
  type Extracted,
} from "./extraction-values.js";
const workerCodes = new Set([
  "LIMIT_EXCEEDED",
  "CONTENT_UNAVAILABLE",
  "INVALID_ENCODING",
  "UNSUPPORTED_FORMAT",
  "NO_EXTRACTABLE_TEXT",
  "INVALID_RANGE",
]);
/** BR-118: owned worker exit precedes settlement, including synchronous CPU cancellation. */
export async function runExtraction(
  request: WorkerRequest,
  signal: AbortSignal,
  timeout: number,
): Promise<Extracted> {
  if (signal.aborted) throw new ContentFailure("ACCESS_DENIED");
  const worker = createExtractionWorker(request);
  // Drain without retaining or publishing dependency output; each chunk is ephemeral.
  worker.stdout.on("data", () => {});
  worker.stderr.on("data", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  try {
    return await new Promise<Extracted>((resolve, reject) => {
      let done = false,
        started = false;
      const finish = (value: unknown, code?: string) => {
        if (done) return;
        done = true;
        void worker.terminate().then(
          () => {
            if (code) {
              reject(new ContentFailure(code as "LIMIT_EXCEEDED"));
              return;
            }
            try {
              const message = record(value);
              if (
                Object.keys(message).length !== 1 ||
                !Object.hasOwn(message, "value")
              )
                extractionFail("CONTENT_UNAVAILABLE");
              resolve(validateExtracted(message.value, request.budget));
            } catch {
              reject(new ContentFailure("CONTENT_UNAVAILABLE"));
            }
          },
          () => {
            reject(new ContentFailure("CONTENT_UNAVAILABLE"));
          },
        );
      };
      cancel = () => {
        finish(undefined, "ACCESS_DENIED");
      };
      signal.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(
        () => {
          finish(undefined, "REQUEST_TIMEOUT");
        },
        Math.max(1, timeout),
      );
      worker.on("message", (value: unknown) => {
        if (done) return;
        try {
          const m = record(value);
          if (Object.keys(m).length === 1 && m.started === true) {
            if (started) finish(undefined, "CONTENT_UNAVAILABLE");
            else started = true;
            return;
          }
          if (!started) {
            finish(undefined, "CONTENT_UNAVAILABLE");
            return;
          }
          if (
            Object.keys(m).length === 1 &&
            typeof m.code === "string" &&
            workerCodes.has(m.code)
          )
            finish(undefined, m.code);
          else finish(value);
        } catch {
          finish(undefined, "CONTENT_UNAVAILABLE");
        }
      });
      worker.once("error", () => {
        finish(undefined, "LIMIT_EXCEEDED");
      });
      worker.once("exit", () => {
        finish(undefined, "LIMIT_EXCEEDED");
      });
      if (signal.aborted) cancel();
    });
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
export function validateExtracted(value: unknown, budget: number): Extracted {
  const v = record(value);
  if (v.kind === "image") {
    if (
      Object.keys(v).length !== 4 ||
      !(v.data instanceof Uint8Array) ||
      Object.getPrototypeOf(v.data) !== Uint8Array.prototype ||
      typedLength(v.data) > 196608 ||
      !Number.isSafeInteger(v.width) ||
      !Number.isSafeInteger(v.height) ||
      (v.width as number) < 1 ||
      (v.height as number) < 1 ||
      (v.width as number) > 512 ||
      (v.height as number) > 512
    )
      extractionFail("CONTENT_UNAVAILABLE");
    const data = copyTyped(v.data);
    if (!completePng(data, v.width as number, v.height as number))
      extractionFail("CONTENT_UNAVAILABLE");
    return {
      kind: "image",
      data,
      width: v.width as number,
      height: v.height as number,
    };
  }
  if (typeof v.text !== "string" || Buffer.byteLength(v.text) > budget)
    extractionFail("CONTENT_UNAVAILABLE");
  if (
    v.kind === "text" &&
    Object.keys(v).length === 3 &&
    typeof v.encoding === "string" &&
    ["utf-8", "utf-16le", "utf-16be", "windows-1252"].includes(v.encoding)
  )
    return { kind: "text", text: v.text, encoding: v.encoding };
  if (
    v.kind === "pdf" &&
    Object.keys(v).length === 4 &&
    Number.isSafeInteger(v.total_pages) &&
    (v.total_pages as number) > 0 &&
    (v.total_pages as number) <= 256
  ) {
    const pages = array(v.pages, 10);
    if (
      pages.length < 1 ||
      pages.some(
        (n, i) =>
          !Number.isSafeInteger(n) ||
          (n as number) < 1 ||
          (n as number) > (v.total_pages as number) ||
          (i > 0 && (pages[i - 1] as number) >= (n as number)),
      )
    )
      extractionFail("CONTENT_UNAVAILABLE");
    return {
      kind: "pdf",
      text: v.text,
      total_pages: v.total_pages as number,
      pages: pages as number[],
    };
  }
  return extractionFail("CONTENT_UNAVAILABLE");
}
/** BR-110/113: exact code-point projection with full MCP/escaped JSON accounting. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function readResult(
  metadata: ReadMetadata,
  args: ReadArguments,
  value: Extracted,
  max: number,
): CallToolResult {
  if (value.kind === "image") {
    if (args.format !== "image") extractionFail("CONTENT_UNAVAILABLE");
    const result = imageResult(metadata, value.width, value.height, value.data);
    if (!resultFits(result, max)) extractionFail("LIMIT_EXCEEDED");
    return result;
  }
  if (value.kind !== args.format) extractionFail("CONTENT_UNAVAILABLE");
  const offset = args.offset ?? 0,
    points: string[] = [];
  let total = 0;
  // Count all code points without allocating an input-sized array in the parent.
  // No fitting wire result can contain more than262144 code points.
  for (const point of value.text) {
    if (
      total >= offset &&
      points.length < Math.min(args.length ?? 262144, 262144)
    )
      points.push(point);
    total++;
  }
  if (offset > total) extractionFail("INVALID_RANGE");
  const representation = (n: number) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...metadata,
          format: args.format,
          offset,
          characters_read: n,
          total_characters: total,
          text: points.slice(0, n).join(""),
          has_more: offset + n < total,
          ...(offset + n < total ? { next_offset: offset + n } : {}),
          ...(value.kind === "text"
            ? { encoding: value.encoding }
            : { pages: value.pages, total_pages: value.total_pages }),
        }),
      },
    ],
  });
  const remaining = total - offset;
  let low = 0,
    high = points.length;
  if (resultFits(representation(high), max)) low = high;
  else {
    high = Math.min(high, Math.max(0, remaining - 1));
    while (low < high) {
      const mid = low + Math.ceil((high - low) / 2);
      if (resultFits(representation(mid), max)) low = mid;
      else high = mid - 1;
    }
  }
  const result = representation(low);
  if (!resultFits(result, max) || (remaining > 0 && low === 0))
    extractionFail("LIMIT_EXCEEDED");
  return result;
}

function typedLength(value: Uint8Array): number {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
  return Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype) as object,
    "byteLength",
  )!.get!.call(value) as number;
}
function copyTyped(value: Uint8Array) {
  const result = new Uint8Array(typedLength(value));
  Uint8Array.prototype.set.call(result, value);
  return result;
}

/** Validate the bounded encoder projection without decoding document data in the parent. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
function completePng(data: Uint8Array, width: number, height: number) {
  const bytes = Buffer.from(data);
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return false;
  let pos = 8,
    header = false,
    idat = false;
  while (pos < bytes.length) {
    if (pos + 12 > bytes.length) return false;
    const length = bytes.readUInt32BE(pos);
    if (length > bytes.length - pos - 12) return false;
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (
      crc32(bytes.subarray(pos + 4, pos + 8 + length)) !==
      bytes.readUInt32BE(pos + 8 + length)
    )
      return false;
    if (type === "IHDR") {
      if (
        header ||
        pos !== 8 ||
        length !== 13 ||
        bytes.readUInt32BE(pos + 8) !== width ||
        bytes.readUInt32BE(pos + 12) !== height ||
        bytes[pos + 16] !== 8 ||
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
        ![2, 6].includes(bytes[pos + 17]!) ||
        bytes[pos + 18] !== 0 ||
        bytes[pos + 19] !== 0 ||
        bytes[pos + 20] !== 0
      )
        return false;
      header = true;
    } else if (type === "IDAT") {
      if (!header) return false;
      idat = true;
    } else if (type === "IEND")
      return length === 0 && idat && pos + 12 === bytes.length;
    else return false;
    pos += length + 12;
  }
  return false;
}

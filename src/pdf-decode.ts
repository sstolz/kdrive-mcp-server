import { createInflate, inflateSync } from "node:zlib";
import { ContentFailure } from "./content.js";
import { extractionFail as fail } from "./extraction-values.js";
import { isName, numeric, type PdfValue } from "./pdf-syntax.js";
/** BR-117/BR-414: decoded bytes of every needed stream count against B. */
export class Budget {
  decoded = 0;
  constructor(readonly limit: number) {}
  get remaining() {
    return this.limit - this.decoded;
  }
  use(bytes: number) {
    this.decoded += bytes;
    if (this.decoded > this.limit) fail("LIMIT_EXCEEDED");
  }
}
export type Deref = (v: PdfValue | undefined) => PdfValue | undefined;
type Filter = "FlateDecode" | "ASCII85Decode" | "ASCIIHexDecode";
interface Predictor {
  predictor: number;
  colors: number;
  columns: number;
}
interface Chain {
  filters: Filter[];
  predictor?: Predictor;
}
const ascii = new Set<string>(["ASCII85Decode", "ASCIIHexDecode"]);
function filterNames(value: PdfValue | undefined): string[] {
  if (value === undefined) return [];
  if (isName(value)) return [value.name];
  if (Array.isArray(value) && value.length >= 1 && value.length <= 2)
    return value.map((v) => (isName(v) ? v.name : fail("UNSUPPORTED_FORMAT")));
  return fail("UNSUPPORTED_FORMAT");
}
function admittedOrder(names: string[]): Filter[] {
  const [first, second] = names;
  if (names.length === 1 && (first === "FlateDecode" || ascii.has(first ?? "")))
    return names as Filter[];
  if (names.length === 2 && ascii.has(first ?? "") && second === "FlateDecode")
    return names as Filter[];
  if (names.length === 0) return [];
  return fail("UNSUPPORTED_FORMAT");
}
function parmsList(value: PdfValue | undefined, count: number) {
  if (value === undefined || value === null) return [];
  if (value instanceof Map && count === 1) return [value];
  if (
    Array.isArray(value) &&
    value.length === count &&
    value.every((v) => v === null || v instanceof Map)
  )
    return value;
  return fail("UNSUPPORTED_FORMAT");
}
function integerIn(
  v: PdfValue | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min)
    fail("UNSUPPORTED_FORMAT");
  if (v > max) fail("LIMIT_EXCEEDED");
  return v;
}
function predictorOf(parms: Map<string, PdfValue>, deref: Deref) {
  const predictor = deref(parms.get("Predictor")) ?? 1;
  if (
    predictor !== 1 &&
    (typeof predictor !== "number" ||
      predictor < 10 ||
      predictor > 15 ||
      !Number.isInteger(predictor))
  )
    fail("UNSUPPORTED_FORMAT");
  const colors = deref(parms.get("Colors")) ?? 1,
    bits = deref(parms.get("BitsPerComponent")) ?? 8;
  if (
    typeof colors !== "number" ||
    ![1, 2, 3, 4].includes(colors) ||
    bits !== 8
  )
    fail("UNSUPPORTED_FORMAT");
  const columns = integerIn(deref(parms.get("Columns")), 1, 1, 65536);
  return predictor === 1 ? undefined : { predictor, colors, columns };
}
/** BR-414: the admitted filter chains and their parameters. */
export function streamChain(
  dictionary: Map<string, PdfValue>,
  deref: Deref,
): Chain {
  const filters = admittedOrder(filterNames(deref(dictionary.get("Filter"))));
  const parms = parmsList(deref(dictionary.get("DecodeParms")), filters.length);
  let predictor: Predictor | undefined;
  parms.forEach((entry, i) => {
    const value = deref(entry);
    if (!(value instanceof Map)) return;
    if (filters[i] !== "FlateDecode") fail("UNSUPPORTED_FORMAT");
    predictor = predictorOf(value, deref);
  });
  return predictor ? { filters, predictor } : { filters };
}
function hexValue(n: number) {
  if (n >= 48 && n <= 57) return n - 48;
  if (n >= 65 && n <= 70) return n - 55;
  if (n >= 97 && n <= 102) return n - 87;
  return -1;
}
const isWhite = (n: number) =>
  n === 0 || n === 9 || n === 10 || n === 12 || n === 13 || n === 32;
/** Growable output that refuses at the byte that passes the remaining B. */
class Output {
  private buffer: Buffer;
  length = 0;
  constructor(
    estimate: number,
    private readonly cap: number,
  ) {
    this.buffer = Buffer.alloc(Math.max(16, Math.min(estimate, cap + 1)));
  }
  push(byte: number) {
    if (this.length >= this.cap) fail("LIMIT_EXCEEDED");
    if (this.length === this.buffer.length) {
      const next = Buffer.alloc(Math.min(this.buffer.length * 2, this.cap + 1));
      this.buffer.copy(next);
      this.buffer = next;
    }
    this.buffer[this.length++] = byte;
  }
  done() {
    return this.buffer.subarray(0, this.length);
  }
}
export function asciiHex(input: Buffer, cap: number) {
  const out = new Output(Math.ceil(input.length / 2), cap);
  let high = -1;
  for (const n of input) {
    if (n === 62) {
      if (high >= 0) out.push(high * 16);
      return out.done();
    }
    if (isWhite(n)) continue;
    const digit = hexValue(n);
    if (digit < 0) fail("CONTENT_UNAVAILABLE");
    if (high < 0) high = digit;
    else {
      out.push(high * 16 + digit);
      high = -1;
    }
  }
  return fail("CONTENT_UNAVAILABLE");
}
function a85Group(out: Output, group: number[]) {
  if (group.length === 1) fail("CONTENT_UNAVAILABLE");
  const size = group.length;
  while (group.length < 5) group.push(84);
  let value = 0;
  for (const digit of group) value = value * 85 + digit;
  if (value > 0xffffffff) fail("CONTENT_UNAVAILABLE");
  for (let i = 0; i < size - 1; i++) out.push((value >>> (24 - 8 * i)) & 255);
}
class Ascii85 {
  private group: number[] = [];
  constructor(private readonly out: Output) {}
  add(n: number) {
    if (n === 122 && this.group.length === 0) {
      for (let k = 0; k < 4; k++) this.out.push(0);
      return;
    }
    if (n < 33 || n > 117) fail("CONTENT_UNAVAILABLE");
    this.group.push(n - 33);
    if (this.group.length === 5) {
      a85Group(this.out, this.group);
      this.group = [];
    }
  }
  end() {
    if (this.group.length) a85Group(this.out, this.group);
    return this.out.done();
  }
}
export function ascii85(input: Buffer, cap: number) {
  const decoder = new Ascii85(new Output(input.length, cap));
  for (let i = 0; i < input.length; i++) {
    const n = input[i] ?? 0;
    if (isWhite(n)) continue;
    if (n !== 126) decoder.add(n);
    else if (input[i + 1] === 62) return decoder.end();
    else fail("CONTENT_UNAVAILABLE");
  }
  return fail("CONTENT_UNAVAILABLE");
}
function zlibCode(error: unknown) {
  if (error instanceof ContentFailure) throw error;
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}
export function inflate(input: Buffer, budget: Budget) {
  try {
    const remaining = budget.remaining;
    const out = inflateSync(input, {
      maxOutputLength: Math.max(1, remaining),
      rejectGarbageAfterEnd: true,
    });
    budget.use(out.length);
    return out;
  } catch (error) {
    if (zlibCode(error) === "ERR_BUFFER_TOO_LARGE") fail("LIMIT_EXCEEDED");
    return fail("CONTENT_UNAVAILABLE");
  }
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
function unpredictRow(tag: number, row: Buffer, previous: Buffer, bpp: number) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? (row[i - bpp] ?? 0) : 0,
      up = previous[i] ?? 0,
      corner = i >= bpp ? (previous[i - bpp] ?? 0) : 0,
      raw = row[i] ?? 0;
    let value: number;
    if (tag === 0) value = raw;
    else if (tag === 1) value = raw + left;
    else if (tag === 2) value = raw + up;
    else if (tag === 3) value = raw + Math.floor((left + up) / 2);
    else if (tag === 4) value = raw + paeth(left, up, corner);
    else return fail("CONTENT_UNAVAILABLE");
    row[i] = value & 255;
  }
}
/** BR-414: PNG rows are undone with each row's own tag; data is whole rows. */
export function unpredict(data: Buffer, predictor: Predictor) {
  const rowBytes = predictor.colors * predictor.columns,
    stride = rowBytes + 1;
  if (data.length % stride) fail("CONTENT_UNAVAILABLE");
  const rows = data.length / stride,
    out = Buffer.alloc(rows * rowBytes);
  let previous = Buffer.alloc(rowBytes);
  for (let r = 0; r < rows; r++) {
    const row = out.subarray(r * rowBytes, (r + 1) * rowBytes);
    data.copy(row, 0, r * stride + 1, (r + 1) * stride);
    unpredictRow(data[r * stride] ?? 0, row, previous, predictor.colors);
    previous = row;
  }
  return out;
}
/** BR-414: decodes one needed stream; every stage counts against B. */
export function decodeStream(
  dictionary: Map<string, PdfValue>,
  raw: Buffer,
  budget: Budget,
  deref: Deref,
) {
  const chain = streamChain(dictionary, deref);
  let data = raw;
  if (chain.filters.length === 0) budget.use(raw.length);
  for (const filter of chain.filters) {
    if (filter === "FlateDecode") {
      data = inflate(data, budget);
      if (chain.predictor) data = unpredict(data, chain.predictor);
    } else {
      data =
        filter === "ASCIIHexDecode"
          ? asciiHex(data, budget.remaining)
          : ascii85(data, budget.remaining);
      budget.use(data.length);
    }
  }
  return data;
}
/**
 * BR-414/BR-416: one Flate inline image, capped by the smaller of its computed
 * size and the remaining B; returns the input bytes the inflate consumed.
 */
export function inflateInline(rest: Buffer, computed: number, budget: Budget) {
  const remaining = budget.remaining,
    cap = Math.min(computed, remaining);
  try {
    const result = inflateSync(rest, {
      maxOutputLength: Math.max(1, cap),
      info: true,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (result.buffer.length > cap) fail("LIMIT_EXCEEDED");
    budget.use(result.buffer.length);
    return result.engine.bytesWritten;
  } catch (error) {
    if (zlibCode(error) === "ERR_BUFFER_TOO_LARGE")
      fail(computed < remaining ? "CONTENT_UNAVAILABLE" : "LIMIT_EXCEEDED");
    return fail("CONTENT_UNAVAILABLE");
  }
}
function programFilter(dictionary: Map<string, PdfValue>, deref: Deref) {
  if (dictionary.has("DecodeParms")) fail("UNSUPPORTED_FORMAT");
  const names = filterNames(deref(dictionary.get("Filter")));
  if (names.length === 0) return false;
  if (names.length === 1 && names[0] === "FlateDecode") return true;
  return fail("UNSUPPORTED_FORMAT");
}
/** BR-420: the direct `/Length1` of a Type 1 program, 1–65,536. */
export function cleartextLength(dictionary: Map<string, PdfValue>) {
  const length = dictionary.get("Length1");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1)
    fail("CONTENT_UNAVAILABLE");
  if (length > 65536) fail("LIMIT_EXCEEDED");
  return length;
}
function inflateUntil(raw: Buffer, length: number, budget: Budget) {
  return new Promise<Buffer>((resolve, reject) => {
    const stream = createInflate({ chunkSize: 16384 }),
      chunks: Buffer[] = [];
    let produced = 0,
      settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      if (error !== undefined) {
        reject(
          error instanceof Error ? error : new Error("CONTENT_UNAVAILABLE"),
        );
        return;
      }
      resolve(Buffer.concat(chunks).subarray(0, length));
    };
    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      produced += chunk.length;
      try {
        budget.use(chunk.length);
      } catch (error) {
        finish(error);
        return;
      }
      chunks.push(chunk);
      if (produced >= length) finish();
    });
    const short = () => {
      finish(new ContentFailure("CONTENT_UNAVAILABLE"));
    };
    stream.on("end", short);
    stream.on("error", short);
    stream.on("close", short);
    stream.end(raw);
  });
}
/**
 * BR-414/BR-420: the cleartext part of a Type 1 program, read up to `/Length1`
 * by an asynchronous inflate destroyed once that many bytes are held.
 */
export async function readCleartext(
  dictionary: Map<string, PdfValue>,
  raw: Buffer,
  budget: Budget,
  deref: Deref,
) {
  const length = cleartextLength(dictionary);
  const flate = programFilter(dictionary, deref);
  if (length > budget.remaining) fail("LIMIT_EXCEEDED");
  if (!flate) {
    if (raw.length < length) fail("CONTENT_UNAVAILABLE");
    budget.use(length);
    return raw.subarray(0, length);
  }
  return inflateUntil(raw, length, budget);
}
export const finiteNumber = (v: PdfValue | undefined, max = 1000000) => {
  const n = numeric(v);
  return n !== undefined && Number.isFinite(n) && Math.abs(n) <= max;
};

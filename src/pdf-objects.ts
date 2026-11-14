import { extractionFail as fail } from "./extraction-values.js";
import { Budget, decodeStream } from "./pdf-decode.js";
import { PdfParser, isName, isRef, type PdfValue } from "./pdf-syntax.js";
export type XrefEntry =
  | { type: 0 }
  | { type: 1; offset: number; gen: number }
  | { type: 2; stream: number; index: number };
export interface PdfStream {
  dict: Map<string, PdfValue>;
  raw: Buffer;
}
export interface Framed {
  value: PdfValue;
  stream?: PdfStream;
}
export type LengthOf = (v: PdfValue | undefined) => number;
/** BR-413: `<number> <generation> obj`, one value, an optional stream and `endobj`. */
export function parseObjectAt(
  source: Buffer,
  offset: number,
  lengthOf: LengthOf | undefined,
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= source.length)
    fail("CONTENT_UNAVAILABLE");
  const first = source[offset] ?? 0;
  if (first < 48 || first > 57) fail("CONTENT_UNAVAILABLE");
  const p = new PdfParser(source, offset);
  const id = p.integer(),
    gen = p.integer();
  p.expect("obj");
  const value = p.value();
  p.skip();
  let stream: PdfStream | undefined;
  if (source.toString("latin1", p.pos, p.pos + 6) === "stream") {
    if (!(value instanceof Map) || lengthOf === undefined)
      fail("CONTENT_UNAVAILABLE");
    stream = {
      dict: value,
      raw: frameStream(p, lengthOf(value.get("Length"))),
    };
  }
  p.expect("endobj");
  return { id, gen, framed: stream ? { value, stream } : { value } };
}
function frameStream(p: PdfParser, length: number) {
  const source = p.data;
  p.pos += 6;
  if (source[p.pos] === 13) p.pos++;
  if (source[p.pos++] !== 10) fail("CONTENT_UNAVAILABLE");
  if (length > 8388608) fail("LIMIT_EXCEEDED");
  if (p.pos + length > source.length) fail("CONTENT_UNAVAILABLE");
  const raw = source.subarray(p.pos, p.pos + length);
  p.pos += length;
  if (source[p.pos] === 13) p.pos++;
  if (source[p.pos] === 10) p.pos++;
  p.expect("endstream");
  return raw;
}
export function directLength(v: PdfValue | undefined) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    fail("CONTENT_UNAVAILABLE");
  return v;
}
interface ObjectStream {
  first: number;
  data: Buffer;
  pairs: [number, number][];
}
/** BR-413: resolution through the merged cross-reference table only. */
export class PdfFile {
  private readonly cache = new Map<number, Framed>();
  private readonly pending = new Set<number>();
  private readonly objectStreams = new Map<number, ObjectStream>();
  private readonly decodedStreams = new Map<PdfStream, Buffer>();
  readonly deref = (v: PdfValue | undefined) =>
    isRef(v) ? this.resolve(v).value : v;
  constructor(
    readonly source: Buffer,
    readonly table: Map<number, XrefEntry>,
    readonly budget: Budget,
  ) {}
  /** BR-413: `n g R` names entry `n` with generation `g`; 4,096 distinct objects. */
  resolve(ref: { ref: number; gen: number }, depth = 0): Framed {
    const cached = this.cache.get(ref.ref);
    const entry = this.table.get(ref.ref);
    if (!entry || entry.type === 0) return fail("CONTENT_UNAVAILABLE");
    if (entry.type === 1 ? entry.gen !== ref.gen : ref.gen !== 0)
      fail("CONTENT_UNAVAILABLE");
    if (cached) return cached;
    if (this.pending.has(ref.ref)) fail("CONTENT_UNAVAILABLE");
    if (this.cache.size + this.pending.size >= 4096) fail("LIMIT_EXCEEDED");
    this.pending.add(ref.ref);
    const framed =
      entry.type === 1
        ? this.typeOne(ref.ref, entry, depth, true)
        : this.typeTwo(ref.ref, entry, depth);
    this.pending.delete(ref.ref);
    this.cache.set(ref.ref, framed);
    return framed;
  }
  private typeOne(
    id: number,
    entry: { offset: number; gen: number },
    depth: number,
    streams: boolean,
  ): Framed {
    const parsed = parseObjectAt(
      this.source,
      entry.offset,
      streams ? (v) => this.lengthOf(v, depth) : undefined,
    );
    if (parsed.id !== id || parsed.gen !== entry.gen)
      fail("CONTENT_UNAVAILABLE");
    return parsed.framed;
  }
  /** BR-413: an indirect `/Length` opens at most one object stream and never frames a stream. */
  private lengthOf(v: PdfValue | undefined, depth: number): number {
    if (!isRef(v)) return directLength(v);
    const entry = this.table.get(v.ref);
    if (entry?.type === 2 && depth > 0) fail("CONTENT_UNAVAILABLE");
    const cached = this.cache.get(v.ref);
    if (cached) return directLength(cached.stream ? undefined : cached.value);
    if (entry?.type === 1) {
      if (entry.gen !== v.gen || this.pending.has(v.ref))
        fail("CONTENT_UNAVAILABLE");
      if (this.cache.size + this.pending.size >= 4096) fail("LIMIT_EXCEEDED");
      const framed = this.typeOne(v.ref, entry, depth, false);
      this.cache.set(v.ref, framed);
      return directLength(framed.value);
    }
    const framed = this.resolve(v, depth);
    return directLength(framed.stream ? undefined : framed.value);
  }
  private typeTwo(
    id: number,
    entry: { stream: number; index: number },
    depth: number,
  ): Framed {
    const container = this.objectStream(entry.stream, depth);
    const pair = container.pairs[entry.index];
    if (!pair || pair[0] !== id) return fail("CONTENT_UNAVAILABLE");
    const start = container.first + pair[1],
      next = container.pairs[entry.index + 1],
      end = next ? container.first + next[1] : container.data.length;
    const p = new PdfParser(container.data, start, end);
    const value = p.value();
    if (!p.done()) fail("CONTENT_UNAVAILABLE");
    return { value };
  }
  private objectStream(number: number, depth: number): ObjectStream {
    const known = this.objectStreams.get(number);
    if (known) return known;
    const entry = this.table.get(number);
    if (entry?.type !== 1) return fail("CONTENT_UNAVAILABLE");
    const framed = this.resolve({ ref: number, gen: entry.gen }, depth + 1);
    const stream = framed.stream;
    if (!stream) return fail("CONTENT_UNAVAILABLE");
    const d = stream.dict,
      type = d.get("Type"),
      n = d.get("N"),
      first = d.get("First");
    if (!isName(type) || type.name !== "ObjStm") fail("CONTENT_UNAVAILABLE");
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1)
      fail("CONTENT_UNAVAILABLE");
    if (n > 4096) fail("LIMIT_EXCEEDED");
    const firstOffset = directLength(first);
    const data = this.decoded(stream);
    const parsed = {
      first: firstOffset,
      data,
      pairs: objectStreamHeader(data, firstOffset, n),
    };
    this.objectStreams.set(number, parsed);
    return parsed;
  }
  /** BR-414: each needed stream is decoded once per invocation. */
  decoded(stream: PdfStream) {
    const known = this.decodedStreams.get(stream);
    if (known) return known;
    const data = decodeStream(stream.dict, stream.raw, this.budget, this.deref);
    this.decodedStreams.set(stream, data);
    return data;
  }
  wasDecoded(stream: PdfStream) {
    return this.decodedStreams.has(stream);
  }
}
function objectStreamHeader(data: Buffer, first: number, n: number) {
  if (first > data.length) fail("CONTENT_UNAVAILABLE");
  const p = new PdfParser(data, 0, first);
  p.refs = false;
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const id = p.integer(),
      offset = p.integer();
    const previous = pairs[i - 1];
    if ((previous && offset <= previous[1]) || offset >= data.length - first)
      fail("CONTENT_UNAVAILABLE");
    pairs.push([id, offset]);
  }
  return pairs;
}

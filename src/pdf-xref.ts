import { extractionFail as fail } from "./extraction-values.js";
import { type Budget, decodeStream } from "./pdf-decode.js";
import { directLength, parseObjectAt, type XrefEntry } from "./pdf-objects.js";
import { PdfParser, isName, isRef, type PdfValue } from "./pdf-syntax.js";
type Entries = Map<number, XrefEntry>;
interface Section {
  entries: Entries;
  trailer: Map<string, PdfValue>;
  stream?: Entries;
}
const horizontal = (n: number | undefined) =>
  n !== undefined && (n === 0 || n === 9 || n === 12 || n === 32);
const eol = (n: number | undefined) => n === 10 || n === 13;
/** BR-114: terminal markers occupy whole physical lines, never comment substrings. */
export function terminalFrame(source: Buffer) {
  const line = (end: number) => {
    let start = end;
    while (start > 0 && !eol(source[start - 1])) start--;
    let left = start,
      right = end;
    while (left < right && horizontal(source[left])) left++;
    while (right > left && horizontal(source[right - 1])) right--;
    return { start, left, end: right };
  };
  const previous = (current: ReturnType<typeof line>) => {
    if (current.start === 0) fail("CONTENT_UNAVAILABLE");
    let end = current.start - 1;
    if (source[end] === 10 && end > 0 && source[end - 1] === 13) end--;
    return line(end);
  };
  const equal = (value: ReturnType<typeof line>, expected: string) =>
    source.subarray(value.left, value.end).equals(Buffer.from(expected));
  let end = source.length;
  while (end > 0 && (eol(source[end - 1]) || horizontal(source[end - 1])))
    end--;
  const eof = line(end);
  if (!equal(eof, "%%EOF")) fail("CONTENT_UNAVAILABLE");
  const offset = previous(eof),
    keyword = previous(offset);
  const digits = source.toString("latin1", offset.left, offset.end);
  if (!equal(keyword, "startxref") || !/^\d{1,16}$/u.test(digits))
    fail("CONTENT_UNAVAILABLE");
  const xref = Number(digits);
  if (!Number.isSafeInteger(xref) || xref >= keyword.start)
    fail("CONTENT_UNAVAILABLE");
  return xref;
}
function endLine(p: PdfParser) {
  while (p.pos < p.end && (p.at() === 9 || p.at() === 32)) p.pos++;
  if (p.at() === 37) while (p.pos < p.end && !eol(p.at())) p.pos++;
  if (p.at() === 13) {
    p.pos++;
    if (p.at() === 10) p.pos++;
  } else if (p.at() === 10) p.pos++;
  else fail("CONTENT_UNAVAILABLE");
}
function subsectionSeparator(p: PdfParser) {
  const start = p.pos;
  while (p.pos < p.end && (p.at() === 9 || p.at() === 32)) p.pos++;
  const next = p.at();
  if (p.pos === start || next === undefined || eol(next) || next === 37)
    fail("CONTENT_UNAVAILABLE");
}
function xrefEntry(p: PdfParser): XrefEntry {
  if (p.pos + 20 > p.end) fail("CONTENT_UNAVAILABLE");
  const text = p.data.toString("latin1", p.pos, p.pos + 20),
    match = /^(\d{10}) (\d{5}) ([nf])(?: \n| \r|\r\n)$/u.exec(text);
  if (!match) return fail("CONTENT_UNAVAILABLE");
  p.pos += 20;
  return match[3] === "n"
    ? { type: 1, offset: Number(match[1]), gen: Number(match[2]) }
    : { type: 0 };
}
function sizeOf(trailer: Map<string, PdfValue>) {
  const size = trailer.get("Size");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
    fail("CONTENT_UNAVAILABLE");
  if (size > 65536) fail("LIMIT_EXCEEDED");
  return size;
}
function checkListed(entries: Entries, size: number) {
  for (const id of entries.keys()) if (id >= size) fail("LIMIT_EXCEEDED");
}
function classicSection(source: Buffer, offset: number): Section {
  const p = new PdfParser(source, offset);
  p.expect("xref");
  endLine(p);
  const entries: Entries = new Map();
  for (;;) {
    p.skip();
    if (source.toString("latin1", p.pos, p.pos + 7) === "trailer") break;
    const first = p.integer();
    subsectionSeparator(p);
    const count = p.integer();
    endLine(p);
    if (first + count > 65536) fail("LIMIT_EXCEEDED");
    for (let i = 0; i < count; i++) {
      if (entries.has(first + i)) fail("CONTENT_UNAVAILABLE");
      entries.set(first + i, xrefEntry(p));
    }
  }
  p.expect("trailer");
  const trailer = p.value();
  if (!(trailer instanceof Map)) return fail("CONTENT_UNAVAILABLE");
  checkListed(entries, sizeOf(trailer));
  return { entries, trailer };
}
function directInteger(v: PdfValue | undefined) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    return fail("CONTENT_UNAVAILABLE");
  return v;
}
function widths(v: PdfValue | undefined) {
  if (!Array.isArray(v) || v.length !== 3) return fail("CONTENT_UNAVAILABLE");
  const w = v.map(directInteger);
  if (w.some((n) => n > 8)) fail("LIMIT_EXCEEDED");
  if ((w[1] ?? 0) < 1) fail("CONTENT_UNAVAILABLE");
  return w;
}
function indexPairs(v: PdfValue | undefined, size: number) {
  if (v === undefined) return [[0, size]];
  if (!Array.isArray(v) || v.length % 2) return fail("CONTENT_UNAVAILABLE");
  if (v.length / 2 > 4096) fail("LIMIT_EXCEEDED");
  const pairs: number[][] = [];
  let next = 0,
    total = 0;
  for (let i = 0; i < v.length; i += 2) {
    const start = directInteger(v[i]),
      count = directInteger(v[i + 1]);
    if (start < next) fail("CONTENT_UNAVAILABLE");
    next = start + count;
    total += count;
    pairs.push([start, count]);
  }
  if (total > size) fail("CONTENT_UNAVAILABLE");
  if (next > size) fail("LIMIT_EXCEEDED");
  return pairs;
}
function field(data: Buffer, at: number, width: number, fallback: number) {
  if (width === 0) return fallback;
  let value = 0;
  for (let i = 0; i < width; i++) value = value * 256 + (data[at + i] ?? 0);
  return value;
}
function streamEntry(type: number, second: number, third: number): XrefEntry {
  if (type === 1) return { type: 1, offset: second, gen: third };
  if (type === 2) return { type: 2, stream: second, index: third };
  return { type: 0 };
}
const directOnly = [
  "Length",
  "Filter",
  "DecodeParms",
  "Size",
  "W",
  "Index",
  "Prev",
];
/** BR-412: a cross-reference stream with direct keys, `/W` and `/Index` bounds. */
function streamSection(
  source: Buffer,
  offset: number,
  budget: Budget,
): Section {
  const parsed = parseObjectAt(source, offset, directLength);
  const stream = parsed.framed.stream;
  if (!stream) return fail("CONTENT_UNAVAILABLE");
  const d = stream.dict,
    type = d.get("Type");
  if (!isName(type) || type.name !== "XRef") fail("CONTENT_UNAVAILABLE");
  if (directOnly.some((key) => isRef(d.get(key)))) fail("CONTENT_UNAVAILABLE");
  const size = sizeOf(d),
    w = widths(d.get("W")),
    pairs = indexPairs(d.get("Index"), size);
  const data = decodeStream(d, stream.raw, budget, (v) => v);
  const [w0 = 0, w1 = 0, w2 = 0] = w,
    row = w0 + w1 + w2,
    count = pairs.reduce((sum, pair) => sum + (pair[1] ?? 0), 0);
  if (data.length !== count * row) fail("CONTENT_UNAVAILABLE");
  const entries: Entries = new Map();
  let at = 0;
  for (const [start = 0, n = 0] of pairs)
    for (let i = 0; i < n; i++, at += row)
      entries.set(
        start + i,
        streamEntry(
          field(data, at, w0, 1),
          field(data, at + w0, w1, 0),
          field(data, at + w0 + w1, w2, 0),
        ),
      );
  return { entries, trailer: d };
}
function optionalOffset(trailer: Map<string, PdfValue>, key: string) {
  const v = trailer.get(key);
  return v === undefined ? undefined : directInteger(v);
}
/** BR-412: the chain from the last `startxref`, newest section first, merged. */
export function readXref(source: Buffer, start: number, budget: Budget) {
  const seen = new Set<number>(),
    sections: Section[] = [];
  const visit = (offset: number) => {
    if (seen.has(offset)) fail("CONTENT_UNAVAILABLE");
    if (seen.size >= 32) fail("LIMIT_EXCEEDED");
    seen.add(offset);
    if (offset >= source.length) fail("CONTENT_UNAVAILABLE");
  };
  let offset: number | undefined = start;
  while (offset !== undefined) {
    visit(offset);
    const classic =
      source.subarray(offset, offset + 4).toString("latin1") === "xref";
    const section = classic
      ? classicSection(source, offset)
      : streamSection(source, offset, budget);
    const hybrid = classic
      ? optionalOffset(section.trailer, "XRefStm")
      : undefined;
    if (hybrid !== undefined) {
      visit(hybrid);
      section.stream = streamSection(source, hybrid, budget).entries;
    }
    sections.push(section);
    offset = optionalOffset(section.trailer, "Prev");
  }
  return { table: merge(sections), trailers: sections.map((s) => s.trailer) };
}
function merge(sections: Section[]) {
  const table: Entries = new Map();
  const put = (entries: Entries, keep: (e: XrefEntry) => boolean) => {
    for (const [id, entry] of entries)
      if (keep(entry) && !table.has(id)) table.set(id, entry);
  };
  for (const section of sections) {
    if (section.stream) {
      put(section.entries, (e) => e.type !== 0);
      put(section.stream, () => true);
    }
    put(section.entries, () => true);
  }
  return table;
}

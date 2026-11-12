/* eslint-disable @typescript-eslint/no-non-null-assertion -- F-011: this file holds 18 pre-existing assertions on values checked earlier in the same flow (indexed parser and policy state); a file-level directive is kept for this dense file only, and removing them is deferred to keep reviewed control flow unchanged (BACKLOG.md) */
import { inflateSync } from "node:zlib";
import { ContentFailure } from "./content.js";
import { extractionFail as fail } from "./extraction-values.js";
import {
  PdfParser,
  type PdfValue,
  dict,
  isRef,
  isBytes,
  isName,
  name,
  keys,
  serialize,
  numeric as numericValue,
} from "./pdf-syntax.js";
interface PdfObject {
  id: number;
  value: Map<string, PdfValue>;
  stream?: Buffer;
}
const finite = (v: PdfValue | undefined, max = 1000000) => {
  const n = numericValue(v);
  return n !== undefined && Number.isFinite(n) && Math.abs(n) <= max;
};
function endLine(p: PdfParser) {
  while (p.pos < p.end && [9, 32].includes(p.data[p.pos]!)) p.pos++;
  if (p.data[p.pos] === 37)
    while (p.pos < p.end && ![10, 13].includes(p.data[p.pos]!)) p.pos++;
  if (p.data[p.pos] === 13) {
    p.pos++;
    if (p.data[p.pos] === 10) p.pos++;
  } else if (p.data[p.pos] === 10) p.pos++;
  else fail("CONTENT_UNAVAILABLE");
}
function subsectionSeparator(p: PdfParser) {
  const start = p.pos;
  while (p.pos < p.end && [9, 32].includes(p.data[p.pos]!)) p.pos++;
  if (
    p.pos === start ||
    p.pos >= p.end ||
    [10, 13, 37].includes(p.data[p.pos]!)
  )
    fail("CONTENT_UNAVAILABLE");
}
function xrefEntry(p: PdfParser) {
  if (p.pos + 20 > p.end) fail("CONTENT_UNAVAILABLE");
  const line = p.data.toString("latin1", p.pos, p.pos + 20),
    match = /^(\d{10}) (\d{5}) ([nf])(?: \n| \r|\r\n)$/u.exec(line);
  if (!match) fail("CONTENT_UNAVAILABLE");
  p.pos += 20;
  return { offset: Number(match[1]), gen: Number(match[2]), state: match[3]! };
}
/** BR-114: terminal markers occupy whole physical lines, never comment substrings. */
function terminalFrame(source: Buffer) {
  const eol = (n: number | undefined) => n === 10 || n === 13;
  const horizontal = (n: number | undefined) =>
    n !== undefined && [0, 9, 12, 32].includes(n);
  const line = (end: number) => {
    let start = end;
    while (start > 0 && !eol(source[start - 1])) start--;
    let left = start;
    while (left < end && horizontal(source[left])) left++;
    while (end > left && horizontal(source[end - 1])) end--;
    return { start, left, end };
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
  if (
    !equal(keyword, "startxref") ||
    offset.end - offset.left < 1 ||
    offset.end - offset.left > 16
  )
    fail("CONTENT_UNAVAILABLE");
  for (let at = offset.left; at < offset.end; at++)
    if (source[at]! < 48 || source[at]! > 57) fail("CONTENT_UNAVAILABLE");
  const xref = Number(source.toString("latin1", offset.left, offset.end));
  if (!Number.isSafeInteger(xref) || xref >= keyword.start)
    fail("CONTENT_UNAVAILABLE");
  return { xref, start: keyword.start };
}
/** BR-114/117: every source stream is expanded before the dependency sees canonical input. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function preflightPdf(
  input: Uint8Array,
  budget: number,
  selected: number[],
) {
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!/^%PDF-1\.[0-7][\r\n]/u.test(source.subarray(0, 10).toString("latin1")))
    fail("UNSUPPORTED_FORMAT");
  const terminal = terminalFrame(source),
    xref = terminal.xref;
  if (!source.subarray(xref, xref + 4).equals(Buffer.from("xref")))
    fail("CONTENT_UNAVAILABLE");
  const p = new PdfParser(source, xref, terminal.start);
  p.expect("xref");
  endLine(p);
  const entries = new Map<number, { offset: number; free: boolean }>();
  for (;;) {
    p.skip();
    if (source.toString("latin1", p.pos, p.pos + 7) === "trailer") break;
    const first = p.integer();
    subsectionSeparator(p);
    const count = p.integer();
    endLine(p);
    if (count > 4097 || first + count > 4097 || entries.size + count > 4097)
      fail("LIMIT_EXCEEDED");
    for (let i = 0; i < count; i++) {
      const { offset, gen, state } = xrefEntry(p);
      if (
        entries.has(first + i) ||
        !["n", "f"].includes(state) ||
        gen !== (first + i === 0 ? 65535 : 0)
      )
        fail("CONTENT_UNAVAILABLE");
      entries.set(first + i, { offset, free: state === "f" });
    }
  }
  p.expect("trailer");
  const trailer = dict(p.value());
  keys(trailer, ["Size", "Root"]);
  if (
    [...entries.keys()].some((id) => id >= entries.size) ||
    !p.done() ||
    trailer.get("Size") !== entries.size ||
    entries.get(0)?.offset !== 0 ||
    !entries.get(0)?.free
  )
    fail("CONTENT_UNAVAILABLE");
  const positions = [...entries]
    .filter(([id, e]) => id !== 0 && !e.free)
    .sort((a, b) => a[1].offset - b[1].offset);
  if (positions.length > 4096) fail("LIMIT_EXCEEDED");
  const objects = new Map<number, PdfObject>();
  let decoded = 0;
  const prefix = new PdfParser(source, 0, positions[0]?.[1].offset ?? xref);
  if (!prefix.done()) fail("CONTENT_UNAVAILABLE");
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  positions.forEach(([id, entry], i) => {
    const end = positions[i + 1]?.[1].offset ?? xref;
    if (entry.offset < 0 || entry.offset >= end || end > xref)
      fail("CONTENT_UNAVAILABLE");
    if (source[entry.offset]! < 48 || source[entry.offset]! > 57)
      fail("CONTENT_UNAVAILABLE");
    const reader = new PdfParser(source, entry.offset, end);
    if (reader.integer() !== id || reader.integer() !== 0)
      fail("CONTENT_UNAVAILABLE");
    reader.expect("obj");
    const value = dict(reader.value());
    reader.skip();
    let bytes: Buffer | undefined;
    if (source.toString("latin1", reader.pos, reader.pos + 6) === "stream") {
      reader.pos += 6;
      if (source[reader.pos] === 13) reader.pos++;
      if (source[reader.pos++] !== 10) fail("CONTENT_UNAVAILABLE");
      const length = value.get("Length");
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0
      )
        fail("UNSUPPORTED_FORMAT");
      if (length > 8388608) fail("LIMIT_EXCEEDED");
      if (reader.pos + length > end) fail("CONTENT_UNAVAILABLE");
      bytes = source.subarray(reader.pos, reader.pos + length);
      reader.pos += length;
      if (source[reader.pos] === 13) reader.pos++;
      if (source[reader.pos] === 10) reader.pos++;
      reader.expect("endstream");
      if (value.has("DecodeParms")) fail("UNSUPPORTED_FORMAT");
      if (value.has("Filter")) {
        if (name(value.get("Filter")) !== "FlateDecode")
          fail("UNSUPPORTED_FORMAT");
        try {
          const remaining = budget - decoded;
          if (remaining === 0) {
            const empty = inflateSync(bytes, {
              maxOutputLength: 1,
              rejectGarbageAfterEnd: true,
            });
            if (empty.length) fail("LIMIT_EXCEEDED");
            bytes = empty;
          } else
            bytes = inflateSync(bytes, {
              maxOutputLength: remaining,
              rejectGarbageAfterEnd: true,
            });
        } catch (e) {
          if (e instanceof ContentFailure) throw e;
          const code =
            typeof e === "object" && e !== null && "code" in e
              ? e.code
              : undefined;
          if (code === "ERR_BUFFER_TOO_LARGE") fail("LIMIT_EXCEEDED");
          fail("CONTENT_UNAVAILABLE");
        }
      }
      decoded += bytes.length;
      if (decoded > budget) fail("LIMIT_EXCEEDED");
    }
    reader.expect("endobj");
    if (!reader.done()) fail("CONTENT_UNAVAILABLE");
    objects.set(id, {
      id,
      value,
      ...(bytes === undefined ? {} : { stream: bytes }),
    });
  });
  const used = new Set<number>();
  const get = (v: PdfValue | undefined) => {
    if (!isRef(v) || !objects.has(v.ref)) return fail("UNSUPPORTED_FORMAT");
    return objects.get(v.ref)!;
  };
  const mark = (object: PdfObject) => {
    used.add(object.id);
    return object.value;
  };
  const root = get(trailer.get("Root")),
    catalog = mark(root);
  keys(catalog, ["Type", "Pages"]);
  if (name(catalog.get("Type")) !== "Catalog" || root.stream)
    fail("UNSUPPORTED_FORMAT");
  const pages: PdfObject[] = [];
  const seen = new Set<number>();
  function walk(object: PdfObject, parent?: number) {
    if (seen.has(object.id)) fail("CONTENT_UNAVAILABLE");
    seen.add(object.id);
    const d = mark(object);
    if (object.stream) fail("UNSUPPORTED_FORMAT");
    const type = name(d.get("Type"));
    if (
      parent !== undefined &&
      (!isRef(d.get("Parent")) ||
        (d.get("Parent") as { ref: number }).ref !== parent)
    )
      fail("CONTENT_UNAVAILABLE");
    if (type === "Page") {
      keys(d, ["Type", "Parent", "MediaBox", "Resources", "Contents"]);
      pages.push(object);
      if (pages.length > 256) fail("LIMIT_EXCEEDED");
      return 1;
    }
    if (type !== "Pages") fail("UNSUPPORTED_FORMAT");
    keys(d, ["Type", "Kids", "Count"], parent === undefined ? [] : ["Parent"]);
    const kids = d.get("Kids");
    if (!Array.isArray(kids)) fail("UNSUPPORTED_FORMAT");
    let n = 0;
    for (const child of kids) n += walk(get(child), object.id);
    if (d.get("Count") !== n) fail("CONTENT_UNAVAILABLE");
    return n;
  }
  const pageRoot = get(catalog.get("Pages"));
  if (name(pageRoot.value.get("Type")) !== "Pages") fail("UNSUPPORTED_FORMAT");
  walk(pageRoot);
  if (pages.length < 1) fail("UNSUPPORTED_FORMAT");
  if (selected.some((n) => n > pages.length)) fail("INVALID_RANGE");
  let producerBytes = 0,
    producerItems = 0;
  const contentIds = new Set<number>();
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  pages.forEach((page, index) => {
    const d = page.value,
      box = d.get("MediaBox");
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      !box.every((n) => finite(n)) ||
      numericValue(box[2])! <= numericValue(box[0])! ||
      numericValue(box[3])! <= numericValue(box[1])!
    )
      fail("UNSUPPORTED_FORMAT");
    const resources = dict(d.get("Resources"));
    keys(resources, [], ["Font", "XObject"]);
    let font = false;
    if (resources.has("Font")) {
      const fonts = dict(resources.get("Font"));
      keys(fonts, ["F1"]);
      const f = get(fonts.get("F1")),
        fv = mark(f);
      keys(fv, ["Type", "Subtype", "BaseFont", "Encoding"]);
      if (
        f.stream ||
        name(fv.get("Type")) !== "Font" ||
        name(fv.get("Subtype")) !== "Type1" ||
        name(fv.get("BaseFont")) !== "Helvetica" ||
        name(fv.get("Encoding")) !== "WinAnsiEncoding"
      )
        fail("UNSUPPORTED_FORMAT");
      font = true;
    }
    const images = new Set<string>();
    if (resources.has("XObject")) {
      const xs = dict(resources.get("XObject"));
      if (xs.size > 256) fail("LIMIT_EXCEEDED");
      for (const [key, ref] of xs) {
        if (!/^Im(?:[1-9]\d{0,2})$/u.test(key) || Number(key.slice(2)) > 256)
          fail("UNSUPPORTED_FORMAT");
        const im = get(ref),
          v = mark(im);
        keys(
          v,
          [
            "Type",
            "Subtype",
            "Width",
            "Height",
            "ColorSpace",
            "BitsPerComponent",
            "Length",
          ],
          ["Filter"],
        );
        const w = v.get("Width"),
          h = v.get("Height"),
          color = name(v.get("ColorSpace"));
        if (
          name(v.get("Type")) !== "XObject" ||
          name(v.get("Subtype")) !== "Image" ||
          v.get("BitsPerComponent") !== 8 ||
          !["DeviceGray", "DeviceRGB"].includes(color) ||
          !Number.isSafeInteger(w) ||
          !Number.isSafeInteger(h) ||
          (w as number) < 1 ||
          (h as number) < 1 ||
          (w as number) > 8192 ||
          (h as number) > 8192 ||
          (w as number) * (h as number) > 1048576
        )
          fail("UNSUPPORTED_FORMAT");
        if (
          im.stream?.length !==
          (w as number) * (h as number) * (color === "DeviceRGB" ? 3 : 1)
        )
          fail("CONTENT_UNAVAILABLE");
        images.add(key);
      }
    }
    const content = get(d.get("Contents"));
    if (contentIds.has(content.id) || content.stream === undefined)
      fail("UNSUPPORTED_FORMAT");
    contentIds.add(content.id);
    keys(mark(content), ["Length"], ["Filter"]);
    const stats = contentStats(content.stream, font, images);
    if (selected.includes(index + 1)) {
      producerBytes += 8 * (stats.bytes + stats.ops + 1);
      producerItems += 2 * (stats.bytes + stats.ops + 1);
    }
  });
  if (
    producerBytes + 3 * (selected.length - 1) > budget ||
    producerItems > 65536
  )
    fail("LIMIT_EXCEEDED");
  if (used.size !== objects.size) fail("UNSUPPORTED_FORMAT");
  const chunks: (Buffer | string)[] = ["%PDF-1.4\n"],
    offsets = new Map<number, number>();
  let total = 9;
  for (const object of [...objects.values()].sort((a, b) => a.id - b.id)) {
    offsets.set(object.id, total);
    const value = new Map(object.value);
    if (object.stream !== undefined) {
      value.delete("Filter");
      value.set("Length", object.stream.length);
    }
    const head = `${String(object.id)} 0 obj\n${serialize(value)}${object.stream === undefined ? "\nendobj\n" : "\nstream\n"}`;
    chunks.push(head);
    total += Buffer.byteLength(head);
    if (object.stream !== undefined) {
      chunks.push(object.stream, "\nendstream\nendobj\n");
      total += object.stream.length + 18;
    }
  }
  const canonicalXref = total;
  let endingText = `xref\n0 ${String(entries.size)}\n0000000000 65535 f \n`;
  for (let id = 1; id < entries.size; id++)
    endingText += `${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 ${offsets.has(id) ? "n" : "f"} \n`;
  endingText += `trailer\n${serialize(trailer)}\nstartxref\n${String(canonicalXref)}\n%%EOF\n`;
  chunks.push(endingText);
  total += Buffer.byteLength(endingText);
  if (total > budget) fail("LIMIT_EXCEEDED");
  const canonical = Buffer.alloc(total);
  let at = 0;
  for (const chunk of chunks) {
    if (typeof chunk === "string") at += canonical.write(chunk, at);
    else {
      canonical.set(chunk, at);
      at += chunk.length;
    }
  }
  if (at !== total) fail("CONTENT_UNAVAILABLE");
  return {
    bytes: canonical,
    total_pages: pages.length,
    producerBytes,
    producerItems,
  };
}
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
function contentStats(bytes: Buffer, font: boolean, images: Set<string>) {
  const p = new PdfParser(bytes),
    operands: PdfValue[] = [];
  let ops = 0,
    n = 0,
    text = false,
    graphics = 0,
    selectedFont = false;
  const strings = (v: PdfValue) => {
    if (!isBytes(v)) fail("UNSUPPORTED_FORMAT");
    for (const b of v.bytes) if (b < 32) fail("UNSUPPORTED_FORMAT");
    n += v.bytes.length;
  };
  while (!p.done()) {
    p.skip();
    const ch = bytes[p.pos]!;
    if (
      ch === 47 ||
      ch === 40 ||
      ch === 60 ||
      ch === 91 ||
      ch === 43 ||
      ch === 45 ||
      ch === 46 ||
      (ch >= 48 && ch <= 57)
    ) {
      if (operands.length > 65536) fail("LIMIT_EXCEEDED");
      operands.push(p.value());
      continue;
    }
    const op = p.word();
    ops++;
    const numeric = (count: number) => {
      if (operands.length !== count || !operands.every((v) => finite(v)))
        fail("UNSUPPORTED_FORMAT");
    };
    switch (op) {
      case "q":
        numeric(0);
        if (text || ++graphics > 32) fail("UNSUPPORTED_FORMAT");
        break;
      case "Q":
        numeric(0);
        if (text || --graphics < 0) fail("UNSUPPORTED_FORMAT");
        break;
      case "cm":
        numeric(6);
        if (text) fail("UNSUPPORTED_FORMAT");
        break;
      case "BT":
        numeric(0);
        if (text) fail("UNSUPPORTED_FORMAT");
        text = true;
        selectedFont = false;
        break;
      case "ET":
        numeric(0);
        if (!text) fail("UNSUPPORTED_FORMAT");
        text = false;
        break;
      case "Tf":
        if (
          !text ||
          !font ||
          operands.length !== 2 ||
          !isName(operands[0]) ||
          operands[0].name !== "F1" ||
          !finite(operands[1], 512) ||
          numericValue(operands[1])! < 1
        )
          fail("UNSUPPORTED_FORMAT");
        selectedFont = true;
        break;
      case "Tm":
        numeric(6);
        if (!text) fail("UNSUPPORTED_FORMAT");
        break;
      case "Td":
      case "TD":
        numeric(2);
        if (!text) fail("UNSUPPORTED_FORMAT");
        break;
      case "T*":
        numeric(0);
        if (!text) fail("UNSUPPORTED_FORMAT");
        break;
      case "Tj":
      case "'":
        if (!text || !selectedFont || operands.length !== 1)
          fail("UNSUPPORTED_FORMAT");
        strings(operands[0]!);
        break;
      case '"':
        if (
          !text ||
          !selectedFont ||
          operands.length !== 3 ||
          !finite(operands[0]) ||
          !finite(operands[1])
        )
          fail("UNSUPPORTED_FORMAT");
        strings(operands[2]!);
        break;
      case "TJ":
        if (
          !text ||
          !selectedFont ||
          operands.length !== 1 ||
          !Array.isArray(operands[0])
        )
          fail("UNSUPPORTED_FORMAT");
        for (const item of operands[0]) {
          if (numericValue(item) !== undefined) {
            if (!finite(item)) fail("UNSUPPORTED_FORMAT");
          } else strings(item);
        }
        break;
      case "Do":
        if (
          text ||
          operands.length !== 1 ||
          !isName(operands[0]) ||
          !images.has(operands[0].name)
        )
          fail("UNSUPPORTED_FORMAT");
        break;
      default:
        fail("UNSUPPORTED_FORMAT");
    }
    operands.length = 0;
  }
  if (text || graphics || operands.length) fail("CONTENT_UNAVAILABLE");
  return { bytes: n, ops };
}

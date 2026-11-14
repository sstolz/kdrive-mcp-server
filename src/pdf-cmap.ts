import { extractionFail as fail } from "./extraction-values.js";
import {
  PdfParser,
  isBytes,
  isKeyword,
  isName,
  type PdfToken,
} from "./pdf-syntax.js";
/** BR-417: a `ToUnicode` CMap keyed by numeric code, last entry winning. */
export type CMap = Map<number, Buffer>;
function destination(token: PdfToken | undefined) {
  if (isName(token)) return fail("UNSUPPORTED_FORMAT");
  if (!isBytes(token)) return fail("CONTENT_UNAVAILABLE");
  const length = token.bytes.length;
  if (length > 64) fail("LIMIT_EXCEEDED");
  if (length < 2 || length % 2) fail("CONTENT_UNAVAILABLE");
  return token.bytes;
}
function code(token: PdfToken | undefined) {
  if (!isBytes(token) || token.bytes.length === 0)
    return fail("CONTENT_UNAVAILABLE");
  if (token.bytes.length > 2) fail("UNSUPPORTED_FORMAT");
  return token.bytes;
}
const valueOf = (bytes: Buffer) =>
  bytes.length === 2 ? bytes.readUInt16BE(0) : (bytes[0] ?? 0);
/** PDF.js 6.5.438 `mapBfRange`: increments the last byte, carrying once. */
function increment(dst: Buffer) {
  const next = Buffer.from(dst),
    last = next.length - 1;
  const value = (next[last] ?? 0) + 1;
  if (value <= 0xff) {
    next[last] = value;
    return next;
  }
  const carried = (next[last - 1] ?? 0xff) + 1;
  if (last < 1 || carried > 0xff) fail("UNSUPPORTED_FORMAT");
  next[last - 1] = carried;
  next[last] = 0;
  return next;
}
class CMapReader {
  readonly map: CMap = new Map();
  private entries = 0;
  constructor(private readonly p: PdfParser) {}
  private count() {
    if (++this.entries > 65536) fail("LIMIT_EXCEEDED");
  }
  private items(end: string, read: (first: PdfToken) => void) {
    for (;;) {
      const token = this.p.token();
      if (token === undefined) fail("CONTENT_UNAVAILABLE");
      if (isKeyword(token)) {
        if (token.op === end) return;
        fail("CONTENT_UNAVAILABLE");
      }
      read(token);
    }
  }
  codespace() {
    this.items("endcodespacerange", (first) => {
      code(first);
      code(this.p.token());
    });
  }
  bfchar() {
    this.items("endbfchar", (first) => {
      this.count();
      const source = code(first);
      this.map.set(valueOf(source), destination(this.p.token()));
    });
  }
  bfrange() {
    this.items("endbfrange", (first) => {
      this.count();
      const low = code(first),
        high = code(this.p.token());
      const lo = valueOf(low),
        hi = valueOf(high);
      if (
        low.length !== high.length ||
        (low.length === 2 && low[0] !== high[0]) ||
        lo > hi
      )
        fail("CONTENT_UNAVAILABLE");
      this.range(lo, hi, this.p.token());
    });
  }
  private range(lo: number, hi: number, target: PdfToken | undefined) {
    if (Array.isArray(target)) {
      if (target.length !== hi - lo + 1) fail("CONTENT_UNAVAILABLE");
      target.forEach((item, i) => this.map.set(lo + i, destination(item)));
      return;
    }
    let dst = destination(target);
    for (let c = lo; c <= hi; c++) {
      this.map.set(c, dst);
      if (c < hi) dst = increment(dst);
    }
  }
}
/** BR-417: parse with the bounded tokenizer; only ranges, bfchar and bfrange count. */
export function parseCMap(data: Buffer): CMap {
  const p = new PdfParser(data);
  p.refs = false;
  const reader = new CMapReader(p);
  for (;;) {
    const token = p.token();
    if (token === undefined) return reader.map;
    if (!isKeyword(token)) continue;
    if (token.op === "usecmap") fail("UNSUPPORTED_FORMAT");
    if (token.op === "begincodespacerange") reader.codespace();
    else if (token.op === "beginbfchar") reader.bfchar();
    else if (token.op === "beginbfrange") reader.bfrange();
  }
}
/** BR-418: UTF-8 length of a UTF-16BE destination; an unpaired surrogate counts 3. */
export function utf8Length(dst: Buffer) {
  let total = 0;
  for (let i = 0; i < dst.length; i += 2) {
    const unit = dst.readUInt16BE(i);
    const following = i + 3 < dst.length ? dst.readUInt16BE(i + 2) : -1;
    if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      following >= 0xdc00 &&
      following <= 0xdfff
    ) {
      total += 4;
      i += 2;
    } else if (unit < 0x80) total += 1;
    else if (unit < 0x800) total += 2;
    else total += 3;
  }
  return total;
}
const header =
  "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
const footer =
  "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
/** BR-417: one `bfchar` entry per mapped code, in ascending order. */
export function canonicalCMap(map: CMap) {
  const codes = [...map.keys()].sort((a, b) => a - b),
    parts = [header];
  for (let i = 0; i < codes.length; i += 100) {
    const block = codes.slice(i, i + 100);
    parts.push(`${String(block.length)} beginbfchar\n`);
    for (const c of block)
      parts.push(
        `<${c.toString(16).padStart(4, "0")}> <${(map.get(c) ?? Buffer.alloc(0)).toString("hex")}>\n`,
      );
    parts.push("endbfchar\n");
  }
  parts.push(footer);
  return Buffer.from(parts.join(""), "latin1");
}

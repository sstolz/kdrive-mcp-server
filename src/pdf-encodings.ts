import { contentFailure } from "./content.js";
import { extractionFail as fail } from "./extraction-values.js";
import {
  macExpertEncoding,
  macRomanEncoding,
  standardEncoding,
  winAnsiEncoding,
} from "./pdf-encoding-tables.js";
import { pdfjsGlyphNames } from "./pdf-glyph-list.js";
import {
  PdfParser,
  isKeyword,
  isName,
  type PdfToken,
  type PdfValue,
} from "./pdf-syntax.js";
export const baseTables: ReadonlyMap<string, readonly string[]> = new Map([
  ["StandardEncoding", standardEncoding],
  ["WinAnsiEncoding", winAnsiEncoding],
  ["MacRomanEncoding", macRomanEncoding],
  ["MacExpertEncoding", macExpertEncoding],
]);
/** BR-420: the base encoding names PDF.js 6.5.438 honours when emitted. */
export const emittedBases = new Set([
  "WinAnsiEncoding",
  "MacRomanEncoding",
  "MacExpertEncoding",
]);
function inRange(value: number) {
  return value >= 1 && value <= 0x10ffff;
}
const numericForms: [RegExp, number, number][] = [
  [/^uni([0-9A-F]{4})$/u, 1, 16],
  [/^u([0-9A-F]{4,6})$/u, 1, 16],
  [/^G([0-9A-Fa-f]{2})$/u, 1, 16],
  [/^g([0-9A-Fa-f]{4})$/u, 1, 16],
  [/^[Cc](\d{2,3})$/u, 1, 10],
];
/** BR-420: whether PDF.js 6.5.438 maps a glyph name to a character. */
export function pdfjsMapsGlyph(name: string) {
  if (pdfjsGlyphNames.has(name)) return true;
  if (name === "f_h" || name === "f_t" || name === "T_h") return true;
  for (const [pattern, group, radix] of numericForms) {
    const match = pattern.exec(name);
    const digits = match?.[group];
    if (digits !== undefined) return inRange(Number.parseInt(digits, radix));
  }
  return false;
}
/** BR-418: D contribution of one canonical `/Differences` glyph name. */
export function glyphWeight(name: string) {
  if (
    name.startsWith("u") &&
    (name.length === 6 || (name.length === 7 && !name.startsWith("uni")))
  )
    return 4;
  return 3;
}
function glyphName(v: PdfToken | undefined) {
  if (!isName(v)) return fail("UNSUPPORTED_FORMAT");
  if (Buffer.byteLength(v.name, "latin1") > 31) fail("LIMIT_EXCEEDED");
  return v.name;
}
/** BR-420: `/Differences` of codes 0–255 and glyph names, at most 256 codes. */
export function parseDifferences(value: PdfValue | undefined) {
  const out = new Map<number, string>();
  if (value === undefined) return out;
  if (!Array.isArray(value)) return fail("UNSUPPORTED_FORMAT");
  let code = -1,
    count = 0;
  for (const item of value) {
    if (typeof item === "number") {
      if (!Number.isInteger(item) || item < 0 || item > 255)
        fail("UNSUPPORTED_FORMAT");
      code = item;
      continue;
    }
    if (code < 0 || code > 255) fail("UNSUPPORTED_FORMAT");
    if (++count > 256) fail("LIMIT_EXCEEDED");
    out.set(code++, glyphName(item));
  }
  return out;
}
class Cleartext {
  private readonly p: PdfParser;
  constructor(data: Buffer) {
    this.p = new PdfParser(data);
    this.p.refs = false;
  }
  /** Any parser failure is `UNSUPPORTED_FORMAT`, except a glyph name over the
   * tokenizer's name limit, which passes the 31-byte ceiling (BR-420). */
  next(glyph = false): PdfToken | undefined {
    let token: PdfToken | undefined;
    try {
      token = this.p.token();
    } catch (error) {
      if (glyph && contentFailure(error) === "LIMIT_EXCEEDED") throw error;
      fail("UNSUPPORTED_FORMAT");
    }
    return token;
  }
  expect(op: string) {
    const token = this.next();
    if (!isKeyword(token) || token.op !== op) fail("UNSUPPORTED_FORMAT");
  }
  integer(): number {
    const token = this.next();
    if (typeof token !== "number" || !Number.isInteger(token))
      return fail("UNSUPPORTED_FORMAT");
    return token;
  }
}
const loop = [
  "0",
  "1",
  "255",
  "{",
  "1",
  "index",
  "exch",
  "/.notdef",
  "put",
  "}",
  "for",
];
function tokenText(token: PdfToken | undefined) {
  if (isKeyword(token)) return token.op;
  if (isName(token)) return "/" + token.name;
  return typeof token === "number" ? String(token) : undefined;
}
function readLoop(reader: Cleartext) {
  for (const expected of loop.slice(1))
    if (tokenText(reader.next()) !== expected) fail("UNSUPPORTED_FORMAT");
}
function readPuts(
  reader: Cleartext,
  size: number,
  first: PdfToken | undefined,
) {
  const table: (string | undefined)[] = new Array<string | undefined>(size);
  let token = first,
    groups = 0;
  while (isKeyword(token) && token.op === "dup") {
    if (++groups > 256) fail("LIMIT_EXCEEDED");
    const code = reader.integer();
    if (code < 0 || code >= size) fail("UNSUPPORTED_FORMAT");
    table[code] = glyphName(reader.next(true));
    reader.expect("put");
    token = reader.next();
  }
  const end = tokenText(token);
  if (end === "readonly") reader.expect("def");
  else if (end !== "def") fail("UNSUPPORTED_FORMAT");
  return table;
}
/** BR-420: the built-in encoding of a Type 1 program, from its cleartext part. */
export function builtInEncoding(
  cleartext: Buffer,
): readonly (string | undefined)[] {
  const reader = new Cleartext(cleartext);
  for (;;) {
    const token = reader.next();
    if (token === undefined) return fail("UNSUPPORTED_FORMAT");
    if (isName(token) && token.name === "Encoding") break;
  }
  const kind = reader.next();
  if (isKeyword(kind) && kind.op === "StandardEncoding") {
    reader.expect("def");
    return standardEncoding;
  }
  if (
    typeof kind !== "number" ||
    !Number.isInteger(kind) ||
    kind < 1 ||
    kind > 256
  )
    return fail("UNSUPPORTED_FORMAT");
  reader.expect("array");
  let token = reader.next();
  if (tokenText(token) === "0") {
    readLoop(reader);
    token = reader.next();
  }
  return readPuts(reader, kind, token);
}

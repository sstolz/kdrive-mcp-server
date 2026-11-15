import { extractionFail as fail } from "./extraction-values.js";
export type PdfValue =
  | number
  | { real: number }
  | boolean
  | null
  | { name: string }
  | { ref: number; gen: number }
  | { bytes: Buffer }
  | PdfValue[]
  | Map<string, PdfValue>;
/** A content-stream or PostScript keyword (operator) token. */
export interface PdfKeyword {
  op: string;
}
export type PdfToken = PdfValue | PdfKeyword;
export const white = (n: number | undefined) =>
  n !== undefined &&
  (n === 0 || n === 9 || n === 10 || n === 12 || n === 13 || n === 32);
const delimiterBytes = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
export const delimiter = (n: number | undefined) =>
  n === undefined || white(n) || delimiterBytes.has(n);
function hexDigit(n: number | undefined) {
  if (n === undefined) return -1;
  if (n >= 48 && n <= 57) return n - 48;
  if (n >= 65 && n <= 70) return n - 55;
  if (n >= 97 && n <= 102) return n - 87;
  return -1;
}
const escapes = new Map([
  [110, 10],
  [114, 13],
  [116, 9],
  [98, 8],
  [102, 12],
]);
const numberPattern = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
const startsValue = (ch: number | undefined) =>
  ch === 47 ||
  ch === 40 ||
  ch === 60 ||
  ch === 91 ||
  ch === 43 ||
  ch === 45 ||
  ch === 46 ||
  (ch !== undefined && ch >= 48 && ch <= 57);
function keyword(word: string): PdfToken {
  const constants = new Map<string, boolean | null>([
    ["true", true],
    ["false", false],
    ["null", null],
  ]);
  const constant = constants.get(word);
  return constant === undefined ? { op: word } : constant;
}
/** BR-114: bounded lexical framing; binary stream payloads are never token-searched. */
export class PdfParser {
  pos: number;
  /** BR-413: `n g R` is read as a reference only where objects may hold references. */
  refs = true;
  constructor(
    readonly data: Buffer,
    pos = 0,
    readonly end = data.length,
  ) {
    this.pos = pos;
  }
  at(offset = 0): number | undefined {
    const at = this.pos + offset;
    return at < this.end ? this.data[at] : undefined;
  }
  skip() {
    while (this.pos < this.end) {
      const ch = this.data[this.pos];
      if (white(ch)) this.pos++;
      else if (ch === 37) {
        while (this.pos < this.end && !this.eol(this.data[this.pos]))
          this.pos++;
      } else break;
    }
  }
  private eol(n: number | undefined) {
    return n === 10 || n === 13;
  }
  word() {
    this.skip();
    const start = this.pos;
    while (this.pos < this.end && !delimiter(this.data[this.pos])) this.pos++;
    if (start === this.pos) fail("CONTENT_UNAVAILABLE");
    return this.data.toString("latin1", start, this.pos);
  }
  expect(value: string) {
    if (this.word() !== value) fail("CONTENT_UNAVAILABLE");
  }
  private numericToken() {
    const text = this.word();
    if (text.length > 32 || !numberPattern.test(text))
      fail("CONTENT_UNAVAILABLE");
    const value = Number(text);
    if (!Number.isFinite(value)) fail("CONTENT_UNAVAILABLE");
    return { value, integer: /^[-+]?\d+$/u.test(text) };
  }
  number() {
    return this.numericToken().value;
  }
  integer() {
    const token = this.numericToken();
    if (!token.integer || !Number.isSafeInteger(token.value) || token.value < 0)
      fail("CONTENT_UNAVAILABLE");
    return token.value;
  }
  /** Reads the next token: a value, or a keyword such as an operator. */
  token(): PdfToken | undefined {
    this.skip();
    if (this.pos >= this.end) return undefined;
    const ch = this.data[this.pos];
    let token: PdfToken;
    if (startsValue(ch)) token = this.value();
    else if (ch === 41 || ch === 62 || ch === 93 || ch === 123 || ch === 125) {
      this.pos++;
      token = { op: String.fromCodePoint(ch) };
    } else token = keyword(this.word());
    return token;
  }
  value(depth = 0): PdfValue {
    if (depth > 32) fail("LIMIT_EXCEEDED");
    this.skip();
    const ch = this.at();
    let value: PdfValue;
    if (ch === 47) value = this.name();
    else if (ch === 40) value = this.literal();
    else if (ch === 60 && this.at(1) === 60) value = this.dictionary(depth);
    else if (ch === 60) value = this.hex();
    else if (ch === 91) value = this.array(depth);
    else value = this.scalar();
    return value;
  }
  private name(): { name: string } {
    this.pos++;
    let name = "";
    while (this.pos < this.end && !delimiter(this.data[this.pos])) {
      let n = this.data[this.pos++] ?? 0;
      if (n === 35) {
        const high = hexDigit(this.at()),
          low = hexDigit(this.at(1));
        if (high < 0 || low < 0) fail("CONTENT_UNAVAILABLE");
        n = high * 16 + low;
        this.pos += 2;
        if (n === 0) fail("UNSUPPORTED_FORMAT");
      }
      if (name.length >= 256) fail("LIMIT_EXCEEDED");
      name += String.fromCodePoint(n);
    }
    return { name };
  }
  private literal(): { bytes: Buffer } {
    this.pos++;
    const out: number[] = [];
    const state = { nesting: 1 };
    while (this.pos < this.end) {
      const n = this.literalByte(state);
      if (state.nesting === 0) return { bytes: Buffer.from(out) };
      if (n < 0) continue;
      out.push(n);
      if (out.length > 4096) fail("LIMIT_EXCEEDED");
    }
    return fail("CONTENT_UNAVAILABLE");
  }
  /** One byte of a literal string, or -1 for an escaped line end. */
  private literalByte(state: { nesting: number }) {
    const n = this.data[this.pos++] ?? 0;
    if (n === 92) return this.escape();
    if (n === 40 && ++state.nesting > 32) fail("LIMIT_EXCEEDED");
    if (n === 41) state.nesting--;
    if (n === 13) {
      if (this.at() === 10) this.pos++;
      return 10;
    }
    return n;
  }
  private escape() {
    if (this.pos >= this.end) return fail("CONTENT_UNAVAILABLE");
    const n = this.data[this.pos++] ?? 0;
    if (n === 10) return -1;
    if (n === 13) {
      if (this.at() === 10) this.pos++;
      return -1;
    }
    if (n >= 48 && n <= 55) {
      let value = n - 48;
      for (let i = 0; i < 2; i++) {
        const next = this.at();
        if (next === undefined || next < 48 || next > 55) break;
        value = value * 8 + next - 48;
        this.pos++;
      }
      return value & 255;
    }
    return escapes.get(n) ?? n;
  }
  private dictionary(depth: number) {
    this.pos += 2;
    const dict = new Map<string, PdfValue>();
    for (;;) {
      this.skip();
      if (this.pos >= this.end) fail("CONTENT_UNAVAILABLE");
      if (this.at() === 62 && this.at(1) === 62) {
        this.pos += 2;
        return dict;
      }
      const key = this.value(depth + 1);
      if (!isName(key) || dict.has(key.name)) fail("CONTENT_UNAVAILABLE");
      if (dict.size >= 4096) fail("LIMIT_EXCEEDED");
      dict.set(key.name, this.value(depth + 1));
    }
  }
  private hex(): { bytes: Buffer } {
    this.pos++;
    let hex = "";
    while (this.pos < this.end && this.data[this.pos] !== 62) {
      const n = this.data[this.pos++];
      if (white(n)) continue;
      if (hexDigit(n) < 0) fail("CONTENT_UNAVAILABLE");
      hex += String.fromCodePoint(n ?? 0);
      if (hex.length > 8192) fail("LIMIT_EXCEEDED");
    }
    if (this.data[this.pos++] !== 62 || this.pos > this.end)
      fail("CONTENT_UNAVAILABLE");
    if (hex.length % 2) hex += "0";
    return { bytes: Buffer.from(hex, "hex") };
  }
  private array(depth: number) {
    this.pos++;
    const a: PdfValue[] = [];
    for (;;) {
      this.skip();
      if (this.pos >= this.end) fail("CONTENT_UNAVAILABLE");
      if (this.at() === 93) {
        this.pos++;
        return a;
      }
      if (a.length >= 65536) fail("LIMIT_EXCEEDED");
      a.push(this.value(depth + 1));
    }
  }
  private scalar(): PdfValue {
    const start = this.pos,
      token = this.word();
    const constant = keyword(token);
    let value: PdfValue;
    if (isKeyword(constant)) {
      this.pos = start;
      value = this.numberOrReference(token);
    } else value = constant;
    return value;
  }
  private numberOrReference(token: string): PdfValue {
    const numeric = this.numericToken(),
      n = numeric.value;
    let value: PdfValue = numeric.integer ? n : { real: n };
    if (
      numeric.integer &&
      this.refs &&
      Number.isSafeInteger(n) &&
      n > 0 &&
      /^\d/u.test(token)
    ) {
      const gen = this.referenceTail();
      if (gen !== undefined) value = { ref: n, gen };
    }
    return value;
  }
  /** Reads ` <generation> R` after an object number without consuming otherwise. */
  private referenceTail() {
    const start = this.pos;
    this.skip();
    const digits = this.pos;
    while (
      this.pos < this.end &&
      (this.at() ?? 0) >= 48 &&
      (this.at() ?? 0) <= 57
    )
      this.pos++;
    const length = this.pos - digits;
    if (length > 0 && length <= 5 && delimiter(this.at())) {
      const gen = Number(this.data.toString("latin1", digits, this.pos));
      this.skip();
      if (this.at() === 82 && delimiter(this.at(1))) {
        this.pos++;
        return gen;
      }
    }
    this.pos = start;
    return undefined;
  }
  done() {
    this.skip();
    return this.pos === this.end;
  }
}
export function isName(v: PdfToken | undefined): v is { name: string } {
  return !!v && typeof v === "object" && "name" in v;
}
export function isRef(
  v: PdfToken | undefined,
): v is { ref: number; gen: number } {
  return !!v && typeof v === "object" && "ref" in v;
}
export function isBytes(v: PdfToken | undefined): v is { bytes: Buffer } {
  return !!v && typeof v === "object" && "bytes" in v;
}
export function isKeyword(v: PdfToken | undefined): v is PdfKeyword {
  return !!v && typeof v === "object" && "op" in v;
}
/** Preserve numeric lexical kind: only numeric operand contexts unwrap real objects. */
export function numeric(v: PdfToken | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (!!v && typeof v === "object" && "real" in v) return v.real;
  return undefined;
}
function isReal(v: PdfValue): v is { real: number } {
  return !!v && typeof v === "object" && "real" in v;
}
export function dict(v: PdfValue | undefined) {
  if (!(v instanceof Map)) fail("UNSUPPORTED_FORMAT");
  return v;
}
export function name(v: PdfValue | undefined) {
  if (!isName(v)) fail("UNSUPPORTED_FORMAT");
  return v.name;
}
export function keys(
  v: Map<string, PdfValue>,
  required: string[],
  optional: string[] = [],
) {
  if (
    required.some((k) => !v.has(k)) ||
    [...v.keys()].some((k) => !required.includes(k) && !optional.includes(k))
  )
    fail("UNSUPPORTED_FORMAT");
}
/** BR-416: names escape bytes outside 0x21–0x7E, delimiters and `#`. */
export function serializeName(value: string) {
  let out = "/";
  for (const ch of value) {
    const n = ch.codePointAt(0) ?? 0;
    out +=
      n < 0x21 || n > 0x7e || n === 35 || delimiterBytes.has(n)
        ? "#" + n.toString(16).padStart(2, "0")
        : ch;
  }
  return out;
}
/** F-009 canonical number form: plain decimal digits, never exponent notation. */
export function serializeNumber(v: number) {
  const text = String(v);
  if (!/[eE]/u.test(text)) return text;
  const negative = v < 0,
    [coefficient = "", exponent = "0"] = String(Math.abs(v)).split("e"),
    [whole = "", fraction = ""] = coefficient.split("."),
    digits = whole + fraction,
    point = whole.length + Number(exponent);
  let body: string;
  if (point <= 0) body = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length)
    body = digits + "0".repeat(point - digits.length);
  else body = digits.slice(0, point) + "." + digits.slice(point);
  return (negative ? "-" : "") + body;
}
export function serialize(v: PdfValue): string {
  if (v instanceof Map) {
    const entries = [...v].map(
      ([k, x]) => serializeName(k) + " " + serialize(x),
    );
    return `<< ${entries.join(" ")} >>`;
  }
  if (Array.isArray(v)) return `[${v.map(serialize).join(" ")}]`;
  if (isReal(v)) {
    const real = serializeNumber(v.real);
    return real.includes(".") ? real : real + ".0";
  }
  if (isName(v)) return serializeName(v.name);
  if (isRef(v)) return `${String(v.ref)} ${String(v.gen)} R`;
  if (isBytes(v)) return `<${v.bytes.toString("hex")}>`;
  if (typeof v === "number") return serializeNumber(v);
  return String(v);
}

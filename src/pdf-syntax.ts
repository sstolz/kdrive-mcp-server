/* eslint-disable @typescript-eslint/no-non-null-assertion -- F-011: this file holds 11 pre-existing assertions on values checked earlier in the same flow (indexed parser and policy state); a file-level directive is kept for this dense file only, and removing them is deferred to keep reviewed control flow unchanged (BACKLOG.md) */
import { extractionFail as fail } from "./extraction-values.js";
export type PdfValue =
  | number
  | { real: number }
  | boolean
  | null
  | { name: string }
  | { ref: number }
  | { bytes: Buffer }
  | PdfValue[]
  | Map<string, PdfValue>;
const white = (n: number | undefined) =>
  n !== undefined && [0, 9, 10, 12, 13, 32].includes(n);
const delimiter = (n: number | undefined) =>
  n === undefined ||
  white(n) ||
  [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(n);
const hexDigit = (n: number | undefined) =>
  n !== undefined && n >= 48 && n <= 57
    ? n - 48
    : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
      n !== undefined && n >= 65 && n <= 70
      ? n - 55
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
        n !== undefined && n >= 97 && n <= 102
        ? n - 87
        : -1;
/** BR-114: bounded lexical framing; binary stream payloads are never token-searched. */
export class PdfParser {
  pos: number;
  constructor(
    readonly data: Buffer,
    pos = 0,
    readonly end = data.length,
  ) {
    this.pos = pos;
  }
  skip() {
    while (this.pos < this.end) {
      if (white(this.data[this.pos])) {
        this.pos++;
        continue;
      }
      if (this.data[this.pos] === 37) {
        while (this.pos < this.end && ![10, 13].includes(this.data[this.pos]!))
          this.pos++;
        continue;
      }
      break;
    }
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
    if (text.length > 32 || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text))
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
  // eslint-disable-next-line sonarjs/cognitive-complexity, sonarjs/function-return-type -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md); F-011: the union return type is part of the reviewed contract
  value(depth = 0): PdfValue {
    if (depth > 32) fail("LIMIT_EXCEEDED");
    this.skip();
    const start = this.pos,
      ch = this.data[this.pos++];
    if (ch === 47) {
      let name = "";
      while (this.pos < this.end && !delimiter(this.data[this.pos])) {
        let n = this.data[this.pos++]!;
        if (n === 35) {
          if (this.pos + 2 > this.end) fail("CONTENT_UNAVAILABLE");
          const high = hexDigit(this.data[this.pos]),
            low = hexDigit(this.data[this.pos + 1]);
          if (high < 0 || low < 0) fail("CONTENT_UNAVAILABLE");
          n = high * 16 + low;
          this.pos += 2;
        }
        if (n < 33 || n > 126 || name.length >= 256) fail("UNSUPPORTED_FORMAT");
        name += String.fromCodePoint(n);
      }
      return { name };
    }
    if (ch === 40) {
      const out: number[] = [];
      let nesting = 1;
      while (this.pos < this.end && nesting) {
        let n = this.data[this.pos++]!;
        if (n === 92) {
          n = this.data[this.pos++]!;
          const named: Record<number, number> = {
            110: 10,
            114: 13,
            116: 9,
            98: 8,
            102: 12,
          };
          if (n === 10) continue;
          if (n === 13) {
            if (this.data[this.pos] === 10) this.pos++;
            continue;
          }
          if (n >= 48 && n <= 55) {
            let oct = String.fromCodePoint(n);
            for (
              let i = 0;
              i < 2 && this.data[this.pos]! >= 48 && this.data[this.pos]! <= 55;
              i++
            )
              oct += String.fromCodePoint(this.data[this.pos++]!);
            n = Number.parseInt(oct, 8) & 255;
          } else n = named[n] ?? n;
        } else if (n === 40) {
          if (++nesting > 32) fail("LIMIT_EXCEEDED");
        } else if (n === 41) {
          if (--nesting === 0) break;
        } else if (n === 13) {
          if (this.data[this.pos] === 10) this.pos++;
          n = 10;
        }
        out.push(n);
        if (out.length > 4096) fail("LIMIT_EXCEEDED");
      }
      if (nesting) fail("CONTENT_UNAVAILABLE");
      return { bytes: Buffer.from(out) };
    }
    if (ch === 60 && this.data[this.pos] === 60) {
      this.pos++;
      const dict = new Map<string, PdfValue>();
      for (;;) {
        this.skip();
        if (this.data[this.pos] === 62 && this.data[this.pos + 1] === 62) {
          this.pos += 2;
          return dict;
        }
        const key = this.value(depth + 1);
        if (!isName(key) || dict.has(key.name)) fail("CONTENT_UNAVAILABLE");
        if (dict.size >= 4096) fail("LIMIT_EXCEEDED");
        dict.set(key.name, this.value(depth + 1));
      }
    }
    if (ch === 60) {
      let hex = "";
      while (this.pos < this.end && this.data[this.pos] !== 62) {
        const n = this.data[this.pos++]!;
        if (white(n)) continue;
        const digit = String.fromCodePoint(n);
        if (hexDigit(n) < 0) fail("CONTENT_UNAVAILABLE");
        hex += digit;
        if (hex.length > 8192) fail("LIMIT_EXCEEDED");
      }
      if (this.data[this.pos++] !== 62) fail("CONTENT_UNAVAILABLE");
      if (hex.length % 2) hex += "0";
      return { bytes: Buffer.from(hex, "hex") };
    }
    if (ch === 91) {
      const a: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.data[this.pos] === 93) {
          this.pos++;
          return a;
        }
        if (a.length >= 65536) fail("LIMIT_EXCEEDED");
        a.push(this.value(depth + 1));
      }
    }
    this.pos = start;
    const token = this.word();
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    this.pos = start;
    const tokenNumber = this.numericToken(),
      n = tokenNumber.value;
    const after = this.pos;
    if (!tokenNumber.integer) return { real: n };
    if (Number.isSafeInteger(n) && n > 0) {
      try {
        const generation = this.integer();
        if (generation === 0 && this.word() === "R") return { ref: n };
      } catch {
        /* Number operands need no following reference. */
      }
      this.pos = after;
    }
    return n;
  }
  done() {
    this.skip();
    return this.pos === this.end;
  }
}
export function isName(v: PdfValue | undefined): v is { name: string } {
  return !!v && typeof v === "object" && "name" in v;
}
export function isRef(v: PdfValue | undefined): v is { ref: number } {
  return !!v && typeof v === "object" && "ref" in v;
}
export function isBytes(v: PdfValue | undefined): v is { bytes: Buffer } {
  return !!v && typeof v === "object" && "bytes" in v;
}
/** Preserve numeric lexical kind: only numeric operand contexts unwrap real objects. */
export function numeric(v: PdfValue | undefined): number | undefined {
  return typeof v === "number"
    ? v
    : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
      !!v && typeof v === "object" && "real" in v
      ? v.real
      : undefined;
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function serialize(v: PdfValue): string {
  if (v instanceof Map)
    // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
    return `<< ${[...v].map(([k, x]) => `/${k} ${serialize(x)}`).join(" ")} >>`;
  if (Array.isArray(v)) return `[${v.map(serialize).join(" ")}]`;
  if (isReal(v)) {
    const real = serialize(v.real);
    return real.includes(".") ? real : real + ".0";
  }
  if (isName(v))
    return `/${v.name.replaceAll(/[^A-Za-z0-9]/gu, (c) => "#" + c.codePointAt(0)!.toString(16).padStart(2, "0"))}`;
  if (isRef(v)) return `${String(v.ref)} 0 R`;
  if (isBytes(v)) return `<${v.bytes.toString("hex")}>`;
  if (typeof v === "number" && /[eE]/u.test(String(v))) {
    const negative = v < 0,
      [coefficient, exponent] = String(Math.abs(v)).split("e"),
      [whole, fraction = ""] = coefficient!.split("."),
      digits = whole! + fraction,
      point = whole!.length + Number(exponent);
    return (
      (negative ? "-" : "") +
      (point <= 0
        ? "0." + "0".repeat(-point) + digits
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          point >= digits.length
          ? digits + "0".repeat(point - digits.length)
          : digits.slice(0, point) + "." + digits.slice(point))
    );
  }
  return String(v);
}

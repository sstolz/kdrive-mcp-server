import { extractionFail as fail } from "./extraction-values.js";
import { canonicalCMap, parseCMap, utf8Length, type CMap } from "./pdf-cmap.js";
import { finiteNumber, readCleartext } from "./pdf-decode.js";
import {
  baseTables,
  builtInEncoding,
  emittedBases,
  glyphWeight,
  parseDifferences,
  pdfjsMapsGlyph,
} from "./pdf-encodings.js";
import type { PdfFile } from "./pdf-objects.js";
import {
  isBytes,
  isName,
  isRef,
  numeric,
  serialize,
  serializeName,
  type PdfValue,
} from "./pdf-syntax.js";
export const standardLatin = new Set([
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
]);
/** Adds one canonical object (a dictionary text, or a dictionary and stream data). */
export type AddObject = (body: string, stream?: Buffer) => number;
type Dict = Map<string, PdfValue>;
const ref = (n: number) => `${String(n)} 0 R`;
const descriptorNumbers = [
  "ItalicAngle",
  "Ascent",
  "Descent",
  "CapHeight",
  "StemV",
  "MissingWidth",
];
function typed<T>(ok: boolean, value: T) {
  if (!ok) fail("CONTENT_UNAVAILABLE");
  return value;
}
function dictOf(file: PdfFile, v: PdfValue | undefined): Dict {
  const value = file.deref(v);
  return typed(value instanceof Map, value as Dict);
}
function baseFontName(v: PdfValue | undefined) {
  if (!isName(v)) return fail("CONTENT_UNAVAILABLE");
  if (Buffer.byteLength(v.name, "latin1") > 127) fail("LIMIT_EXCEEDED");
  return v.name;
}
function integerValue(v: PdfValue | undefined, min: number, max: number) {
  return typed(
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max,
    v as number,
  );
}
/** BR-417: a kept `FontDescriptor`, type-checked; programs are only noted. */
class Descriptor {
  readonly flags: number;
  readonly programs: Set<string>;
  private readonly kept: [string, PdfValue][] = [];
  constructor(file: PdfFile, d: Dict) {
    typed(isName(d.get("FontName")), 0);
    const flags = file.deref(d.get("Flags"));
    this.flags = integerValue(flags, 0, 0xffffffff);
    const box = file.deref(d.get("FontBBox"));
    if (box !== undefined) {
      typed(
        Array.isArray(box) &&
          box.length === 4 &&
          box.every((n) => finiteNumber(n)),
        0,
      );
      this.kept.push(["FontBBox", box]);
    }
    for (const key of descriptorNumbers) {
      const value = file.deref(d.get(key));
      if (value === undefined) continue;
      typed(finiteNumber(value), 0);
      this.kept.push([key, value]);
    }
    this.programs = new Set(
      ["FontFile", "FontFile2", "FontFile3"].filter((k) => d.has(k)),
    );
  }
  get nonsymbolic() {
    return (
      Math.floor(this.flags / 32) % 2 === 1 &&
      Math.floor(this.flags / 4) % 2 === 0
    );
  }
  write(add: AddObject, fontName: string) {
    let flags = this.flags;
    if (Math.floor(flags / 4) % 2) flags -= 4;
    if (!(Math.floor(flags / 32) % 2)) flags += 32;
    const extra = this.kept.map(([k, v]) => ` /${k} ${serialize(v)}`).join("");
    return add(
      `<< /Type /FontDescriptor /FontName ${serializeName(fontName)} /Flags ${String(flags)}${extra} >>`,
    );
  }
}
/** BR-417/418: shared ToUnicode handling and the D weight of a font. */
abstract class ProjectedFont {
  readonly baseFont: string;
  protected weightD = 1;
  constructor(
    readonly name: string,
    readonly type0: boolean,
    protected readonly toUnicode: CMap | undefined,
    sourceBase: string | undefined,
  ) {
    this.baseFont =
      sourceBase !== undefined && standardLatin.has(sourceBase)
        ? sourceBase
        : name;
    for (const dst of toUnicode?.values() ?? [])
      this.weightD = Math.max(this.weightD, utf8Length(dst));
  }
  /** BR-418: m = max(1, ceil(D / 3)). */
  get m() {
    return Math.max(1, Math.ceil(this.weightD / 3));
  }
  /** Validates and collects the codes of one shown string; returns S. */
  abstract show(bytes: Buffer): Promise<number> | number;
  abstract write(add: AddObject): number;
  protected writeToUnicode(add: AddObject) {
    return this.toUnicode
      ? ` /ToUnicode ${ref(add("<< >>", canonicalCMap(this.toUnicode)))}`
      : "";
  }
}
interface SimpleSource {
  subtype: string;
  base: string | undefined;
  widths: string;
  descriptor: Descriptor | undefined;
  baseEncoding: string | undefined;
  differences: Map<number, string>;
  table: () => Promise<readonly (string | undefined)[] | undefined>;
}
/** BR-420: simple fonts with explicit, determinable or built-in encodings. */
class SimpleFont extends ProjectedFont {
  private readonly emitted = new Map<number, string>();
  private readonly seen = new Set<number>();
  constructor(
    name: string,
    toUnicode: CMap | undefined,
    private readonly source: SimpleSource,
  ) {
    super(
      name,
      false,
      toUnicode,
      source.subtype === "Type3" ? undefined : source.base,
    );
  }
  async show(bytes: Buffer) {
    for (const code of bytes) {
      if (this.seen.has(code)) continue;
      this.seen.add(code);
      if (this.toUnicode?.has(code)) continue;
      const glyph =
        this.source.differences.get(code) ??
        (await this.source.table())?.[code];
      if (!glyph || glyph === ".notdef" || !pdfjsMapsGlyph(glyph))
        fail("UNSUPPORTED_FORMAT");
      this.emitted.set(code, glyph);
      this.weightD = Math.max(this.weightD, glyphWeight(glyph));
    }
    return bytes.length;
  }
  write(add: AddObject) {
    const s = this.source,
      differences = [...this.emitted]
        .sort((a, b) => a[0] - b[0])
        .map(([code, glyph]) => `${String(code)} ${serializeName(glyph)}`)
        .join(" ");
    const base = s.baseEncoding ? ` /BaseEncoding /${s.baseEncoding}` : "";
    const descriptor = s.descriptor
      ? ` /FontDescriptor ${ref(s.descriptor.write(add, this.baseFont))}`
      : "";
    const subtype = s.subtype === "Type3" ? "Type1" : s.subtype;
    return add(
      `<< /Type /Font /Subtype /${subtype} /BaseFont ${serializeName(this.baseFont)}${s.widths}${descriptor}${this.writeToUnicode(add)} /Encoding << /Type /Encoding${base} /Differences [${differences}] >> >>`,
    );
  }
}
interface CidSource {
  encoding: string;
  subtype: string;
  descriptor: Descriptor;
  extra: string;
}
/** BR-417: Type0 Identity-H/V fonts whose `ToUnicode` maps every shown code. */
class Type0Font extends ProjectedFont {
  constructor(
    name: string,
    toUnicode: CMap,
    private readonly source: CidSource,
  ) {
    super(name, true, toUnicode, undefined);
  }
  show(bytes: Buffer) {
    if (bytes.length % 2) fail("CONTENT_UNAVAILABLE");
    for (let i = 0; i < bytes.length; i += 2)
      if (!this.toUnicode?.has(bytes.readUInt16BE(i)))
        fail("UNSUPPORTED_FORMAT");
    return bytes.length / 2;
  }
  write(add: AddObject) {
    const s = this.source,
      name = serializeName(this.baseFont);
    const descriptor = s.descriptor.write(add, this.baseFont);
    const cid = add(
      `<< /Type /Font /Subtype /${s.subtype} /BaseFont ${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ref(descriptor)}${s.extra} >>`,
    );
    return add(
      `<< /Type /Font /Subtype /Type0 /BaseFont ${name} /Encoding /${s.encoding} /DescendantFonts [${ref(cid)}]${this.writeToUnicode(add)} >>`,
    );
  }
}
const subsetPrefix = /^[A-Z]{6}\+/u;
/** BR-417/420: reads fonts selected by a kept `Tf`, at most 128 per invocation. */
export class FontRegistry {
  private readonly byRef = new Map<number, ProjectedFont>();
  private readonly byDict = new Map<Dict, ProjectedFont>();
  private count = 0;
  private codes = 0;
  constructor(private readonly file: PdfFile) {}
  get fonts() {
    return [...this.byRef.values(), ...this.byDict.values()];
  }
  select(value: PdfValue): ProjectedFont {
    let known: ProjectedFont | undefined;
    if (isRef(value)) known = this.byRef.get(value.ref);
    else if (value instanceof Map) known = this.byDict.get(value);
    if (known) return known;
    if (++this.count > 128) fail("LIMIT_EXCEEDED");
    const font = this.load(value, `K${String(this.count)}`);
    if (isRef(value)) this.byRef.set(value.ref, font);
    else this.byDict.set(value as Dict, font);
    return font;
  }
  private load(value: PdfValue, name: string): ProjectedFont {
    const resolved = isRef(value) ? this.file.resolve(value) : { value };
    if (resolved.stream || !(resolved.value instanceof Map))
      return fail("CONTENT_UNAVAILABLE");
    const d = resolved.value,
      type = d.get("Type");
    if (type !== undefined && !(isName(type) && type.name === "Font"))
      fail("CONTENT_UNAVAILABLE");
    const subtype = d.get("Subtype");
    if (!isName(subtype)) return fail("CONTENT_UNAVAILABLE");
    if (subtype.name === "Type0") return this.type0(d, name);
    if (["Type1", "MMType1", "TrueType", "Type3"].includes(subtype.name))
      return this.simple(d, name, subtype.name);
    return fail("UNSUPPORTED_FORMAT");
  }
  private cmap(v: PdfValue | undefined): CMap | undefined {
    if (v === undefined) return undefined;
    if (isName(v)) return fail("UNSUPPORTED_FORMAT");
    if (!isRef(v)) return fail("CONTENT_UNAVAILABLE");
    const stream = this.file.resolve(v).stream;
    if (!stream) return fail("CONTENT_UNAVAILABLE");
    const map = parseCMap(this.file.decoded(stream));
    this.codes += map.size;
    if (this.codes > 262144) fail("LIMIT_EXCEEDED");
    return map;
  }
  private widths(d: Dict, type3: number | undefined) {
    const first = this.file.deref(d.get("FirstChar")),
      last = this.file.deref(d.get("LastChar")),
      widths = this.file.deref(d.get("Widths"));
    if (
      type3 !== undefined &&
      (first === undefined || last === undefined || widths === undefined)
    )
      fail("CONTENT_UNAVAILABLE");
    if (widths === undefined && first === undefined && last === undefined)
      return "";
    const low = integerValue(first, 0, 255),
      high = integerValue(last, 0, 255);
    if (!Array.isArray(widths)) return fail("CONTENT_UNAVAILABLE");
    if (widths.length > 256) fail("LIMIT_EXCEEDED");
    const scaled = widths.map((w) => {
      const n = numeric(w);
      if (n === undefined || !Number.isFinite(n))
        return fail("CONTENT_UNAVAILABLE");
      if (type3 === undefined) return serialize(w);
      const product = n * type3 * 1000;
      if (Math.abs(product) > 1000000) fail("UNSUPPORTED_FORMAT");
      return serialize({ real: product });
    });
    return ` /FirstChar ${String(low)} /LastChar ${String(high)} /Widths [${scaled.join(" ")}]`;
  }
  private fontMatrix(d: Dict) {
    const matrix = this.file.deref(d.get("FontMatrix"));
    if (matrix === undefined) return fail("CONTENT_UNAVAILABLE");
    if (
      !Array.isArray(matrix) ||
      matrix.length !== 6 ||
      !matrix.every((n) => finiteNumber(n))
    )
      return fail("UNSUPPORTED_FORMAT");
    const [a = 0, b = 0, c = 0, dd = 0] = matrix.map((n) => numeric(n) ?? 0);
    if (a <= 0 || b !== 0 || c !== 0 || dd === 0) fail("UNSUPPORTED_FORMAT");
    return a;
  }
  private encoding(d: Dict, type3: boolean) {
    const raw = d.get("Encoding");
    if (raw === undefined) {
      if (type3) fail("CONTENT_UNAVAILABLE");
      return { differences: new Map<number, string>() };
    }
    const value = this.file.deref(raw);
    if (isName(value)) {
      if (!baseTables.has(value.name)) fail("UNSUPPORTED_FORMAT");
      return { base: value.name, differences: new Map<number, string>() };
    }
    if (!(value instanceof Map)) return fail("UNSUPPORTED_FORMAT");
    const type = this.file.deref(value.get("Type")),
      base = this.file.deref(value.get("BaseEncoding"));
    if (type !== undefined && !(isName(type) && type.name === "Encoding"))
      fail("UNSUPPORTED_FORMAT");
    if (base !== undefined && !(isName(base) && baseTables.has(base.name)))
      fail("UNSUPPORTED_FORMAT");
    const differences = parseDifferences(
      this.file.deref(value.get("Differences")),
    );
    return isName(base) ? { base: base.name, differences } : { differences };
  }
  private descriptor(v: PdfValue | undefined) {
    return v === undefined
      ? undefined
      : new Descriptor(this.file, dictOf(this.file, v));
  }
  private simple(d: Dict, name: string, subtype: string): ProjectedFont {
    const type3 = subtype === "Type3";
    const scale = type3 ? this.fontMatrix(d) : undefined;
    const rawBase = d.get("BaseFont");
    const base =
      type3 && rawBase === undefined
        ? undefined
        : baseFontName(this.file.deref(rawBase));
    const widths = this.widths(d, scale);
    const descriptor = type3
      ? undefined
      : this.descriptor(d.get("FontDescriptor"));
    const encoding = this.encoding(d, type3);
    const toUnicode = this.cmap(d.get("ToUnicode"));
    const table = this.baseTable(encoding.base, {
      subtype,
      base,
      descriptor,
      d,
    });
    return new SimpleFont(name, toUnicode, {
      subtype,
      base,
      widths,
      descriptor,
      baseEncoding:
        encoding.base !== undefined && emittedBases.has(encoding.base)
          ? encoding.base
          : undefined,
      differences: encoding.differences,
      table,
    });
  }
  /** BR-420: the base table, the built-in one read lazily from the cleartext. */
  private baseTable(
    named: string | undefined,
    font: {
      subtype: string;
      base: string | undefined;
      descriptor: Descriptor | undefined;
      d: Dict;
    },
  ) {
    const fixed = (t: readonly (string | undefined)[] | undefined) => () =>
      Promise.resolve(t);
    if (named !== undefined) return fixed(baseTables.get(named));
    const standard = baseTables.get("StandardEncoding");
    const programs = font.descriptor?.programs ?? new Set<string>();
    if (font.subtype === "Type3") return fixed(undefined);
    const bare = font.base?.replace(subsetPrefix, "");
    if (
      programs.size === 0 &&
      ((bare !== undefined && standardLatin.has(bare)) ||
        font.descriptor?.nonsymbolic)
    )
      return fixed(standard);
    if (
      font.subtype === "TrueType" &&
      programs.has("FontFile2") &&
      font.descriptor &&
      Math.floor(font.descriptor.flags / 32) % 2
    )
      return fixed(standard);
    if (font.subtype !== "TrueType" && programs.has("FontFile")) {
      let cached: Promise<readonly (string | undefined)[]> | undefined;
      return () => (cached ??= this.builtIn(font.d));
    }
    return fixed(undefined);
  }
  private async builtIn(d: Dict) {
    const descriptor = dictOf(this.file, d.get("FontDescriptor"));
    const program = descriptor.get("FontFile");
    const stream = isRef(program)
      ? this.file.resolve(program).stream
      : undefined;
    if (!stream) return fail("CONTENT_UNAVAILABLE");
    const clear = await readCleartext(
      stream.dict,
      stream.raw,
      this.file.budget,
      this.file.deref,
    );
    return builtInEncoding(clear);
  }
  private cidSystemInfo(v: PdfValue | undefined) {
    const info = dictOf(this.file, v);
    for (const key of ["Registry", "Ordering"]) {
      const s = this.file.deref(info.get(key));
      if (!isBytes(s)) fail("CONTENT_UNAVAILABLE");
      if (s.bytes.length > 64) fail("LIMIT_EXCEEDED");
    }
    integerValue(this.file.deref(info.get("Supplement")), -Infinity, Infinity);
  }
  private type0(d: Dict, name: string): ProjectedFont {
    const encoding = this.file.deref(d.get("Encoding"));
    if (
      !isName(encoding) ||
      !["Identity-H", "Identity-V"].includes(encoding.name)
    )
      return fail("UNSUPPORTED_FORMAT");
    baseFontName(this.file.deref(d.get("BaseFont")));
    const descendants = this.file.deref(d.get("DescendantFonts"));
    if (!Array.isArray(descendants)) return fail("CONTENT_UNAVAILABLE");
    if (descendants.length !== 1) fail("UNSUPPORTED_FORMAT");
    const cid = dictOf(this.file, descendants[0]),
      subtype = this.file.deref(cid.get("Subtype"));
    if (!isName(subtype)) return fail("CONTENT_UNAVAILABLE");
    if (!["CIDFontType0", "CIDFontType2"].includes(subtype.name))
      fail("UNSUPPORTED_FORMAT");
    if (cid.has("BaseFont")) baseFontName(this.file.deref(cid.get("BaseFont")));
    this.cidSystemInfo(cid.get("CIDSystemInfo"));
    const fd = cid.get("FontDescriptor");
    if (fd === undefined) return fail("CONTENT_UNAVAILABLE");
    const descriptor = new Descriptor(this.file, dictOf(this.file, fd));
    const extra = this.cidMetrics(cid);
    const toUnicode = this.cmap(d.get("ToUnicode"));
    if (!toUnicode) return fail("UNSUPPORTED_FORMAT");
    return new Type0Font(name, toUnicode, {
      encoding: encoding.name,
      subtype: subtype.name,
      descriptor,
      extra,
    });
  }
  private cidMetrics(cid: Dict) {
    let extra = "";
    const dw = this.file.deref(cid.get("DW"));
    if (dw !== undefined)
      extra += ` /DW ${serialize(typed(finiteNumber(dw), dw))}`;
    const w = this.file.deref(cid.get("W"));
    if (w !== undefined) extra += ` /W ${serialize(cidWidths(w))}`;
    return extra;
  }
}
const cidCode = (v: PdfValue | undefined) => integerValue(v, 0, 65535);
/** BR-417: `c [w …]` and `c1 c2 w` forms, at most 65,536 numbers in total. */
function cidWidths(w: PdfValue): PdfValue[] {
  if (!Array.isArray(w)) fail("CONTENT_UNAVAILABLE");
  const out: PdfValue[] = [];
  let total = 0;
  const count = (n: number) => {
    total += n;
    if (total > 65536) fail("LIMIT_EXCEEDED");
  };
  for (let i = 0; i < w.length;) {
    out.push(cidCode(w[i]));
    const next = w[i + 1];
    if (Array.isArray(next)) {
      count(1 + next.length);
      typed(
        next.every((n) => finiteNumber(n)),
        0,
      );
      out.push(next);
      i += 2;
    } else {
      count(3);
      out.push(cidCode(next));
      typed(finiteNumber(w[i + 2]), 0);
      out.push(w[i + 2] ?? 0);
      i += 3;
    }
  }
  return out;
}
export type { ProjectedFont };

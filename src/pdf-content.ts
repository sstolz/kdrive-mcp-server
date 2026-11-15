import { extractionFail as fail } from "./extraction-values.js";
import { type Budget, finiteNumber, inflateInline } from "./pdf-decode.js";
import type { PdfFile, PdfStream } from "./pdf-objects.js";
import {
  PdfParser,
  delimiter,
  isBytes,
  isKeyword,
  isName,
  numeric,
  white,
  type PdfToken,
  type PdfValue,
} from "./pdf-syntax.js";
/** One kept operator of a content stream, with checked operands. */
export type Op =
  | { kind: "op"; op: string; operands: PdfValue[] }
  | { kind: "show"; op: string; operands: PdfValue[]; strings: Buffer[] }
  | { kind: "font"; font: PdfValue; size: PdfValue }
  | { kind: "form"; stream: PdfStream; id: number };
export type Scope = Map<string, PdfValue> | undefined;
/** BR-416: the tokenizer entry point (observable by tests). */
export const contentTokenizer = {
  open(bytes: Buffer) {
    const p = new PdfParser(bytes);
    p.refs = false;
    return p;
  },
};
const dropped = new Set(
  "m l c v y h re S s f F f* B B* b b* n W W* CS cs SC SCN sc scn G g RG rg K k w J j M d ri i sh BMC BDC EMC MP DP BX EX".split(
    " ",
  ),
);
const textState = new Set(["Tc", "Tw", "Tz", "TL", "Ts"]);
const arity = new Map([
  ["q", 0],
  ["Q", 0],
  ["BT", 0],
  ["ET", 0],
  ["T*", 0],
  ["cm", 6],
  ["Tm", 6],
  ["Td", 2],
  ["TD", 2],
]);
const insideText = new Set(["Td", "TD", "Tm", "T*", "Tj", "TJ", "'", '"']);
function numbers(operands: PdfValue[], count: number) {
  if (operands.length !== count || !operands.every((v) => finiteNumber(v)))
    fail("UNSUPPORTED_FORMAT");
}
function showStrings(op: string, operands: PdfValue[]): Buffer[] {
  if (op === "TJ") {
    const [items] = operands;
    if (operands.length !== 1 || !Array.isArray(items))
      return fail("UNSUPPORTED_FORMAT");
    return items.flatMap((item) => {
      if (isBytes(item)) return [item.bytes];
      if (!finiteNumber(item)) fail("UNSUPPORTED_FORMAT");
      return [];
    });
  }
  if (op === '"') {
    const [aw, ac, s] = operands;
    if (
      operands.length !== 3 ||
      !finiteNumber(aw) ||
      !finiteNumber(ac) ||
      !isBytes(s)
    )
      return fail("UNSUPPORTED_FORMAT");
    return [s.bytes];
  }
  const [s] = operands;
  if (operands.length !== 1 || !isBytes(s)) return fail("UNSUPPORTED_FORMAT");
  return [s.bytes];
}
const inlineKeys = new Map([
  ["L", "L"],
  ["Length", "L"],
  ["F", "F"],
  ["Filter", "F"],
  ["DP", "DP"],
  ["DecodeParms", "DP"],
  ["W", "W"],
  ["Width", "W"],
  ["H", "H"],
  ["Height", "H"],
  ["BPC", "BPC"],
  ["BitsPerComponent", "BPC"],
  ["CS", "CS"],
  ["ColorSpace", "CS"],
  ["IM", "IM"],
  ["ImageMask", "IM"],
]);
const filterAliases = new Map([
  ["AHx", "AHx"],
  ["ASCIIHexDecode", "AHx"],
  ["A85", "A85"],
  ["ASCII85Decode", "A85"],
  ["Fl", "Fl"],
  ["FlateDecode", "Fl"],
]);
const components = new Map([
  ["G", 1],
  ["DeviceGray", 1],
  ["I", 1],
  ["Indexed", 1],
  ["RGB", 3],
  ["DeviceRGB", 3],
  ["CMYK", 4],
  ["DeviceCMYK", 4],
]);
function dimension(v: PdfValue | undefined) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    return fail("UNSUPPORTED_FORMAT");
  if (v > 65536) fail("LIMIT_EXCEEDED");
  return v;
}
function componentCount(image: Map<string, PdfValue>) {
  if (image.get("IM") === true) return 1;
  const cs = image.get("CS");
  if (isName(cs)) return components.get(cs.name) ?? fail("UNSUPPORTED_FORMAT");
  const [family] = Array.isArray(cs) ? cs : [];
  if (isName(family) && (family.name === "I" || family.name === "Indexed"))
    return 1;
  return fail("UNSUPPORTED_FORMAT");
}
/** BR-416: H × ceil(W × BPC × components / 8). */
function computedSize(image: Map<string, PdfValue>) {
  const w = dimension(image.get("W")),
    h = dimension(image.get("H"));
  const bpc = image.get("BPC") ?? (image.get("IM") === true ? 1 : undefined);
  if (typeof bpc !== "number" || ![1, 2, 4, 8, 16].includes(bpc))
    return fail("UNSUPPORTED_FORMAT");
  return h * Math.ceil((w * bpc * componentCount(image)) / 8);
}
function firstFilter(image: Map<string, PdfValue>) {
  const f = image.get("F");
  let list: PdfValue[] = [];
  if (Array.isArray(f)) list = f;
  else if (f !== undefined) list = [f];
  const names = list.map((v) =>
    isName(v)
      ? (filterAliases.get(v.name) ?? v.name)
      : fail("UNSUPPORTED_FORMAT"),
  );
  return names;
}
/** BR-416: skips one inline image's data by a length that never searches for `EI`. */
class InlineImage {
  constructor(
    private readonly p: PdfParser,
    private readonly budget: Budget,
  ) {}
  skip() {
    const image = this.dictionary();
    const p = this.p;
    if (!white(p.at())) fail("CONTENT_UNAVAILABLE");
    p.pos++;
    const length = this.length(image);
    if (p.pos + length > p.end) fail("CONTENT_UNAVAILABLE");
    p.pos += length;
    while (white(p.at())) p.pos++;
    if (p.at() !== 69 || p.at(1) !== 73 || !delimiter(p.at(2)))
      fail("CONTENT_UNAVAILABLE");
    p.pos += 2;
  }
  private dictionary() {
    const image = new Map<string, PdfValue>();
    let pairs = 0;
    for (;;) {
      const key = this.p.token();
      if (isKeyword(key) && key.op === "ID") return image;
      if (!isName(key)) return fail("CONTENT_UNAVAILABLE");
      if (++pairs > 32) fail("LIMIT_EXCEEDED");
      const value = this.p.token();
      if (value === undefined) return fail("CONTENT_UNAVAILABLE");
      if (isKeyword(value)) return fail("UNSUPPORTED_FORMAT");
      image.set(inlineKeys.get(key.name) ?? key.name, value);
    }
  }
  private search(marker: string) {
    const at = this.p.data.indexOf(marker, this.p.pos, "latin1");
    if (at < 0 || at + marker.length > this.p.end) fail("CONTENT_UNAVAILABLE");
    return at + marker.length - this.p.pos;
  }
  private length(image: Map<string, PdfValue>) {
    const declared = image.get("L");
    if (declared !== undefined) {
      if (
        typeof declared !== "number" ||
        !Number.isSafeInteger(declared) ||
        declared < 0
      )
        fail("UNSUPPORTED_FORMAT");
      return declared;
    }
    const filters = firstFilter(image);
    if (filters[0] === "AHx") return this.search(">");
    if (filters[0] === "A85") return this.search("~>");
    if (filters.length === 0) return computedSize(image);
    if (filters.length === 1 && filters[0] === "Fl" && !image.has("DP")) {
      const rest = this.p.data.subarray(this.p.pos, this.p.end);
      return inflateInline(rest, computedSize(image), this.budget);
    }
    return fail("UNSUPPORTED_FORMAT");
  }
}
/** Resolves resource names of one scope for the recorder. */
class Resources {
  constructor(
    private readonly file: PdfFile,
    private readonly scope: Scope,
  ) {}
  lookup(category: string, key: string) {
    const group = this.file.deref(this.scope?.get(category));
    if (group !== undefined && !(group instanceof Map))
      fail("CONTENT_UNAVAILABLE");
    const value = group?.get(key);
    if (value === undefined) fail("CONTENT_UNAVAILABLE");
    return value;
  }
  extGState(key: string) {
    const state = this.file.deref(this.lookup("ExtGState", key));
    if (!(state instanceof Map)) fail("CONTENT_UNAVAILABLE");
    if (state.has("Font")) fail("UNSUPPORTED_FORMAT");
  }
  xobject(key: string): Op | undefined {
    const value = this.lookup("XObject", key);
    if (typeof value !== "object" || value === null || !("ref" in value))
      return fail("CONTENT_UNAVAILABLE");
    const stream = this.file.resolve(value).stream;
    if (!stream) return fail("CONTENT_UNAVAILABLE");
    const subtype = this.file.deref(stream.dict.get("Subtype"));
    if (!isName(subtype)) return fail("CONTENT_UNAVAILABLE");
    if (subtype.name === "Form") return { kind: "form", stream, id: value.ref };
    if (subtype.name === "Image" || subtype.name === "PS") return undefined;
    return fail("UNSUPPORTED_FORMAT");
  }
}
/**
 * BR-416: tokenizes one content stream (or joined `Contents`) once, yielding
 * the kept operators in order; stream-local structure is checked here.
 */
export function* recordContent(
  bytes: Buffer,
  file: PdfFile,
  scope: Scope,
): Generator<Op> {
  const p = contentTokenizer.open(bytes),
    resources = new Resources(file, scope),
    operands: PdfValue[] = [];
  const state = { text: false, depth: 0 };
  for (;;) {
    const token: PdfToken | undefined = p.token();
    if (token === undefined) break;
    if (!isKeyword(token)) {
      if (operands.length >= 65536) fail("LIMIT_EXCEEDED");
      operands.push(token);
      continue;
    }
    if (token.op === "BI") new InlineImage(p, file.budget).skip();
    else yield* operator(token.op, operands, state, resources);
    operands.length = 0;
  }
  if (state.text || operands.length) fail("CONTENT_UNAVAILABLE");
  for (; state.depth > 0; state.depth--)
    yield { kind: "op", op: "Q", operands: [] };
}
function* operator(
  op: string,
  operands: PdfValue[],
  state: { text: boolean; depth: number },
  resources: Resources,
): Generator<Op> {
  if (dropped.has(op)) return;
  if (op === "gs") {
    const [key] = operands;
    if (operands.length !== 1 || !isName(key)) fail("UNSUPPORTED_FORMAT");
    resources.extGState(key.name);
    return;
  }
  if (op === "Do") {
    const [key] = operands;
    if (state.text || operands.length !== 1 || !isName(key))
      fail("UNSUPPORTED_FORMAT");
    const form = resources.xobject(key.name);
    if (form) yield form;
    return;
  }
  if (insideText.has(op) && !state.text) fail("UNSUPPORTED_FORMAT");
  const framing = structural(op, operands, state);
  if (framing === null) return;
  yield framing ?? textOperator(op, operands, resources);
}
function structural(
  op: string,
  operands: PdfValue[],
  state: { text: boolean; depth: number },
): Op | null | undefined {
  const count = arity.get(op);
  if (count === undefined) return undefined;
  numbers(operands, count);
  let kept: Op | null = { kind: "op", op, operands: [...operands] };
  if (op === "BT" || op === "ET") {
    if (state.text === (op === "BT")) fail("UNSUPPORTED_FORMAT");
    state.text = op === "BT";
  } else if (op === "q" || op === "Q" || op === "cm") {
    if (state.text) fail("UNSUPPORTED_FORMAT");
    if (op === "q") state.depth++;
    if (op === "Q" && state.depth === 0) kept = null;
    else if (op === "Q") state.depth--;
  }
  return kept;
}
function textOperator(
  op: string,
  operands: PdfValue[],
  resources: Resources,
): Op {
  if (textState.has(op)) {
    numbers(operands, 1);
    return { kind: "op", op, operands: [...operands] };
  }
  if (op === "Tr") {
    const [mode] = operands;
    if (
      operands.length !== 1 ||
      typeof mode !== "number" ||
      !Number.isInteger(mode) ||
      mode < 0 ||
      mode > 7
    )
      fail("UNSUPPORTED_FORMAT");
    return { kind: "op", op, operands: [...operands] };
  }
  if (op === "Tf") {
    const [key, size] = operands;
    const n = numeric(size);
    if (
      operands.length !== 2 ||
      !isName(key) ||
      !finiteNumber(size) ||
      n === 0 ||
      Math.abs(n ?? 0) > 100000
    )
      return fail("UNSUPPORTED_FORMAT");
    return {
      kind: "font",
      font: resources.lookup("Font", key.name),
      size: size ?? 0,
    };
  }
  if (op === "Tj" || op === "TJ" || op === "'" || op === '"')
    return {
      kind: "show",
      op,
      operands: [...operands],
      strings: showStrings(op, operands),
    };
  return fail("UNSUPPORTED_FORMAT");
}

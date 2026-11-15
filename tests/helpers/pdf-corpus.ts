// F-034: deterministic synthetic PDF corpus (S01–S33 and hostile samples).
// Every file is built here from synthetic content; no generator output or
// font program is committed.
import { deflateSync } from "node:zlib";
export const L = (s: string) => Buffer.from(s, "latin1");
export const T = "Hello modern PDF";
export interface StreamBody {
  dict: string;
  data: Buffer;
  /** Writes `/Length` as an indirect reference to this object number. */
  lengthRef?: number;
}
export type Body = string | StreamBody;
export const stm = (dict: string, data: Buffer | string): StreamBody => ({
  dict,
  data: typeof data === "string" ? L(data) : data,
});
export const flate = (data: Buffer | string) =>
  deflateSync(typeof data === "string" ? L(data) : data);
/** PNG "Up" predictor rows of `columns` bytes (predictor 12). */
export function predictUp(data: Buffer, columns: number) {
  const rows = Math.ceil(data.length / columns),
    out = Buffer.alloc(rows * (columns + 1));
  for (let r = 0; r < rows; r++) {
    out[r * (columns + 1)] = 2;
    for (let c = 0; c < columns; c++) {
      const cur = data[r * columns + c] ?? 0,
        up = r ? (data[(r - 1) * columns + c] ?? 0) : 0;
      out[r * (columns + 1) + 1 + c] = (cur - up) & 255;
    }
  }
  return out;
}
export function a85(buf: Buffer) {
  let out = "";
  for (let i = 0; i < buf.length; i += 4) {
    const chunk = Buffer.alloc(4);
    buf.copy(chunk, 0, i, i + 4);
    const n = Math.min(4, buf.length - i);
    let v = chunk.readUInt32BE(0);
    if (v === 0 && n === 4) {
      out += "z";
      continue;
    }
    const d: string[] = [];
    for (let k = 0; k < 5; k++) {
      d.unshift(String.fromCodePoint((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    out += d.join("").slice(0, n + 1);
  }
  return out + "~>";
}
export const ahx = (buf: Buffer) => buf.toString("hex") + ">";
export const hex = (s: string) => Buffer.from(s, "latin1").toString("hex");
export const utf16 = (s: string) => Buffer.from(s, "utf16le").swap16();
/** A `ToUnicode` CMap with one `bfchar` per entry; codes of `bytes` bytes. */
export function toUnicode(entries: [number, string][], bytes = 2) {
  const lines = entries.map(
    ([code, text]) =>
      `<${code.toString(16).padStart(bytes * 2, "0")}> <${utf16(text).toString("hex")}>`,
  );
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 100) {
    const block = lines.slice(i, i + 100);
    blocks.push(`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Synthetic-UCS def /CMapType 2 def
1 begincodespacerange <${"00".repeat(bytes)}> <${"FF".repeat(bytes)}> endcodespacerange
${blocks.join("\n")}
endcmap CMapName currentdict /CMap defineresource pop end end
`;
}
/** ASCII printable range mapped to itself (two-byte codes). */
export const asciiCMap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CMapName /Synthetic-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfrange <0020> <007E> <0020> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end
`;
export const hex2 = (s: string) =>
  Array.from(s)
    .map((c) => (c.codePointAt(0) ?? 0).toString(16).padStart(4, "0"))
    .join("");
export type Entry =
  | { type: 1; offset: number; gen: number }
  | { type: 2; stream: number; index: number }
  | { type: 0 };
export interface Written {
  bytes: Buffer;
  entries: Map<number, Entry>;
  size: number;
}
function writeBody(id: number, gen: number, body: Body) {
  if (typeof body === "string") return L(`${id} ${gen} obj\n${body}\nendobj\n`);
  const length = body.lengthRef
    ? `${body.lengthRef} 0 R`
    : String(body.data.length);
  const dict = body.dict.replace(/>>\s*$/u, ` /Length ${length} >>`);
  return Buffer.concat([
    L(`${id} ${gen} obj\n${dict}\nstream\n`),
    body.data,
    L("\nendstream\nendobj\n"),
  ]);
}
export interface ObjectsOptions {
  version?: string;
  start?: Buffer;
  gens?: Map<number, number>;
  /** Object numbers stored in one object stream (non-stream bodies only). */
  objStm?: number[];
  objStmId?: number;
}
/** Writes objects (index + 1 = object number, `undefined` leaves a gap). */
export function writeObjects(
  objs: (Body | undefined)[],
  o: ObjectsOptions = {},
) {
  const parts = [
    o.start ?? L(`%PDF-${o.version ?? "1.7"}\n%\xe2\xe3\xcf\xd3\n`),
  ];
  let pos = parts[0]!.length;
  const entries = new Map<number, Entry>();
  const inStm = new Set(o.objStm ?? []);
  objs.forEach((body, i) => {
    const id = i + 1;
    if (body === undefined || inStm.has(id)) return;
    const gen = o.gens?.get(id) ?? 0,
      part = writeBody(id, gen, body);
    entries.set(id, { type: 1, offset: pos, gen });
    parts.push(part);
    pos += part.length;
  });
  if (o.objStm?.length) {
    const stmId = o.objStmId ?? objs.length + 1;
    let header = "",
      data = "";
    o.objStm.forEach((id, index) => {
      header += `${id} ${data.length} `;
      data += `${objs[id - 1] as string}\n`;
      entries.set(id, { type: 2, stream: stmId, index });
    });
    const body = stm(
      `<< /Type /ObjStm /N ${o.objStm.length} /First ${header.length} /Filter /FlateDecode >>`,
      flate(header + data),
    );
    const part = writeBody(stmId, 0, body);
    entries.set(stmId, { type: 1, offset: pos, gen: 0 });
    parts.push(part);
    pos += part.length;
  }
  return { parts, pos, entries };
}
export function classicXref(
  entries: Map<number, Entry>,
  size: number,
  trailer: string,
) {
  let x = `xref\n0 ${size}\n`;
  for (let i = 0; i < size; i++) {
    const e = entries.get(i);
    x +=
      e?.type === 1
        ? `${String(e.offset).padStart(10, "0")} ${String(e.gen).padStart(5, "0")} n \n`
        : `0000000000 ${i === 0 ? "65535" : "00000"} f \n`;
  }
  return `${x}trailer\n<< /Size ${size} ${trailer} >>\n`;
}
export interface XrefStreamOptions {
  w?: number[];
  index?: string;
  dictExtra?: string;
  /** Rows written for these object numbers in order (defaults to 0..size-1). */
  rows?: number[];
  truncate?: number;
  predictor?: boolean;
  /** Overrides the `/Size` and `/W` texts of the dictionary. */
  size?: number;
  wText?: string;
}
/** Encodes cross-reference stream rows for `entries`. */
export function xrefRows(
  entries: Map<number, Entry>,
  rows: number[],
  w = [1, 4, 2],
) {
  const width = w.reduce((a, b) => a + b, 0),
    out = Buffer.alloc(rows.length * width);
  const put = (at: number, size: number, value: number) => {
    for (let k = size - 1; k >= 0; k--) {
      out[at + k] = value % 256;
      value = Math.floor(value / 256);
    }
  };
  rows.forEach((id, r) => {
    const e = entries.get(id) ?? { type: 0 as const },
      at = r * width;
    const [a, b, c] =
      e.type === 1
        ? [1, e.offset, e.gen]
        : e.type === 2
          ? [2, e.stream, e.index]
          : [0, 0, id === 0 ? 65535 : 0];
    put(at, w[0]!, a);
    put(at + w[0]!, w[1]!, b);
    put(at + w[0]! + w[1]!, w[2]!, c);
  });
  return out;
}
export function xrefStream(
  id: number,
  entries: Map<number, Entry>,
  size: number,
  trailer: string,
  o: XrefStreamOptions = {},
) {
  const w = o.w ?? [1, 4, 2];
  const rows = o.rows ?? Array.from({ length: size }, (_, i) => i);
  let data = xrefRows(entries, rows, w);
  if (o.truncate) data = data.subarray(0, data.length - o.truncate);
  const width = w.reduce((a, b) => a + b, 0);
  const encoded =
    o.predictor === false ? flate(data) : flate(predictUp(data, width));
  const parms =
    o.predictor === false
      ? ""
      : ` /DecodeParms << /Predictor 12 /Columns ${width} >>`;
  return writeBody(
    id,
    0,
    stm(
      `<< /Type /XRef /Size ${o.size ?? size} /W ${o.wText ?? "[" + w.join(" ") + "]"}${o.index ? " /Index " + o.index : ""} ${trailer}${o.dictExtra ?? ""} /Filter /FlateDecode${parms} >>`,
      encoded,
    ),
  );
}
export interface PdfOptions extends ObjectsOptions {
  xref?: "classic" | "stream";
  /** Edits the entries before the cross-reference section is written. */
  edit?: (entries: Map<number, Entry>) => void;
  trailer?: string;
  root?: number;
  xrefOptions?: XrefStreamOptions;
}
/** Builds a complete one-revision PDF from object bodies. */
export function pdf(objs: (Body | undefined)[], o: PdfOptions = {}): Written {
  const written = writeObjects(objs, o);
  const { parts, entries } = written;
  const pos = written.pos;
  const trailer = `/Root ${o.root ?? 1} 0 R ${o.trailer ?? ""}`;
  const start = pos;
  o.edit?.(entries);
  let size = Math.max(...entries.keys(), objs.length) + 1;
  if (o.xref === "stream") {
    const id = size;
    size++;
    entries.set(id, { type: 1, offset: pos, gen: 0 });
    parts.push(xrefStream(id, entries, size, trailer, o.xrefOptions));
  } else parts.push(L(classicXref(entries, size, trailer)));
  parts.push(L(`startxref\n${start}\n%%EOF\n`));
  return { bytes: Buffer.concat(parts), entries, size };
}
/** Appends an incremental revision with a classic section and `/Prev`. */
export function update(
  base: Written,
  objs: Map<number, Body>,
  trailer = "/Root 1 0 R",
) {
  const previous = /startxref\n(\d+)\n%%EOF\n$/u.exec(
    base.bytes.toString("latin1"),
  );
  const parts = [base.bytes];
  let pos = base.bytes.length;
  let table = "xref\n0 1\n0000000000 65535 f \n";
  for (const [id, body] of [...objs].sort((a, b) => a[0] - b[0])) {
    const part = writeBody(id, 0, body);
    table += `${id} 1\n${String(pos).padStart(10, "0")} 00000 n \n`;
    parts.push(part);
    pos += part.length;
  }
  const size = Math.max(base.size, ...[...objs.keys()].map((n) => n + 1));
  parts.push(
    L(
      `${table}trailer\n<< /Size ${size} ${trailer} /Prev ${previous?.[1] ?? 0} >>\nstartxref\n${pos}\n%%EOF\n`,
    ),
  );
  return { bytes: Buffer.concat(parts), entries: base.entries, size };
}
export const HELV =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
export const font = (base: string) =>
  `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;
export const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
export const PAGES = (kids: string, count = 1) =>
  `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`;
export const pageDict = (resources: string, contents: string, extra = "") =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${contents}${extra} >>`;
export const textOf = (text: string, name = "F1") =>
  `BT /${name} 12 Tf 72 720 Td (${text}) Tj ET`;
/** One page with the given content stream, font objects follow at 5, 6, … */
export function onePage(
  content: Body,
  fonts: Body[] = [HELV],
  resources?: string,
  o: PdfOptions = {},
) {
  const fontRes = fonts.map((_, i) => `/F${i + 1} ${5 + i} 0 R`).join(" ");
  return pdf(
    [
      CATALOG,
      PAGES("3 0 R"),
      pageDict(resources ?? `<< /Font << ${fontRes} >> >>`, "4 0 R"),
      typeof content === "string" ? stm("<< >>", content) : content,
      ...fonts,
    ],
    o,
  ).bytes;
}
export interface Features {
  flate?: boolean;
  predictor?: boolean;
  info?: boolean;
  xrefStream?: boolean;
  objStm?: boolean;
  incremental?: boolean;
  indirectLength?: boolean;
  fontName?: string;
  trueType?: boolean;
  type0?: boolean;
  graphics?: boolean;
  markedContent?: boolean;
  procSet?: boolean;
  pageExtras?: boolean;
  catalogExtras?: boolean;
  inherit?: boolean;
  contentArray?: boolean;
  colourInText?: boolean;
}
const ID = "<0123456789abcdef0123456789abcdef>";
function fontBodies(f: Features, first: number): Body[] {
  if (f.type0)
    return [
      `<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Arial /Encoding /Identity-H /DescendantFonts [${first + 1} 0 R] /ToUnicode ${first + 2} 0 R >>`,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Arial /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${first + 3} 0 R /DW 500 /CIDToGIDMap /Identity >>`,
      stm("<< >>", asciiCMap),
      "<< /Type /FontDescriptor /FontName /ABCDEF+Arial /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
    ];
  if (f.trueType)
    return [
      `<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FirstChar 32 /LastChar 126 /Widths [${Array(95).fill(500).join(" ")}] /FontDescriptor ${first + 1} 0 R /Encoding /WinAnsiEncoding >>`,
      "<< /Type /FontDescriptor /FontName /Arial /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
    ];
  return [HELV];
}
function contentOf(f: Features, key: string) {
  let content = f.type0
    ? `BT /${key} 12 Tf 72 720 Td <${hex2(T)}> Tj ET`
    : `BT /${key} 12 Tf 72 720 Td (${T}) Tj ET`;
  if (f.graphics)
    content = `q 0.9 0.9 0.9 rg 50 700 300 40 re f Q /GS1 gs ${content}`;
  if (f.markedContent) content = `/P <</MCID 0>> BDC ${content} EMC`;
  if (f.colourInText) content = content.replace("BT ", "BT 0 g ");
  return content + "\n";
}
interface PageParts {
  key: string;
  fontId: number;
  contents: string;
}
function pageTree(
  f: Features,
  objs: (Body | undefined)[],
  add: (b: Body) => number,
  p: PageParts,
) {
  const gs = f.graphics
    ? ` /ExtGState << /GS1 ${add("<< /Type /ExtGState /CA 1 /ca 1 >>")} 0 R >>`
    : "";
  const procSet = f.procSet ? " /ProcSet [/PDF /Text]" : "";
  const res = `<< /Font << /${p.key} ${p.fontId} 0 R >>${gs}${procSet} >>`;
  const box = "[0 0 612 792]";
  const extras = f.pageExtras
    ? " /Group << /Type /Group /S /Transparency /CS /DeviceRGB >> /Tabs /S /StructParents 0"
    : "";
  objs[2] = f.inherit
    ? `<< /Type /Page /Parent 2 0 R /Contents ${p.contents}${extras} >>`
    : `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Resources ${res} /Contents ${p.contents}${extras} >>`;
  objs[1] = f.inherit
    ? `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox ${box} /Resources ${res} >>`
    : PAGES("3 0 R");
}
function catalogExtras(add: (b: Body) => number) {
  const md = add(
    stm(
      "<< /Type /Metadata /Subtype /XML >>",
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>',
    ),
  );
  return ` /Metadata ${md} 0 R /Lang (en-US) /ViewerPreferences << /DisplayDocTitle true >>`;
}
/** Measurement 1 shapes (S01–S20): the profile page plus generator features. */
export function modern(f: Features = {}) {
  const key = f.fontName ?? "F1";
  const objs: (Body | undefined)[] = [undefined, undefined, undefined];
  const add = (body: Body) => objs.push(body);
  const fontId = objs.length + 1;
  fontBodies(f, fontId).forEach(add);
  let data = L(contentOf(f, key)),
    dict = "<< >>";
  if (f.flate) {
    data = f.predictor ? flate(predictUp(data, 8)) : flate(data);
    dict = f.predictor
      ? "<< /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 8 >> >>"
      : "<< /Filter /FlateDecode >>";
  }
  const contentId = add(stm(dict, data));
  let contents = `${contentId} 0 R`;
  if (f.contentArray) {
    const open = add(stm("<< >>", "q\n")),
      close = add(stm("<< >>", "Q\n"));
    contents = `[${open} 0 R ${contentId} 0 R ${close} 0 R]`;
  }
  if (f.indirectLength) {
    const body = objs[contentId - 1] as StreamBody;
    body.lengthRef = add(String(body.data.length));
  }
  pageTree(f, objs, add, { key, fontId, contents });
  const catalogExtra = f.catalogExtras ? catalogExtras(add) : "";
  objs[0] = `<< /Type /Catalog /Pages 2 0 R${catalogExtra} >>`;
  const trailer = f.info
    ? `/Info ${add("<< /Producer (Synthetic generator) /CreationDate (D:20261113000000Z) >>")} 0 R /ID [${ID} ${ID}]`
    : "";
  const inStm = f.objStm
    ? objs.flatMap((b, i) => (typeof b === "string" ? [i + 1] : []))
    : undefined;
  const written = pdf(objs, {
    xref: f.xrefStream ? "stream" : "classic",
    trailer,
    ...(inStm ? { objStm: inStm } : {}),
  });
  if (!f.incremental) return written.bytes;
  return update(written, new Map([[1, objs[0]]]), `/Root 1 0 R ${trailer}`)
    .bytes;
}
export const measurement1: Record<string, Features> = {
  S01: {},
  S02: { flate: true },
  S03: { info: true },
  S04: { flate: true, predictor: true },
  S05: { xrefStream: true },
  S06: { xrefStream: true, objStm: true },
  S07: { incremental: true },
  S08: { indirectLength: true },
  S09: { fontName: "F2" },
  S10: { trueType: true },
  S11: { type0: true },
  S12: { graphics: true },
  S13: { markedContent: true },
  S14: { procSet: true },
  S15: { pageExtras: true },
  S16: { catalogExtras: true },
  S17: { inherit: true },
  S18: { contentArray: true },
  S19: { colourInText: true },
  S20: {
    info: true,
    xrefStream: true,
    objStm: true,
    type0: true,
    graphics: true,
    markedContent: true,
    procSet: true,
    pageExtras: true,
    catalogExtras: true,
    fontName: "F2",
    flate: true,
  },
};
const IMG = stm(
  "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
  Buffer.from([128]),
);
const PROGRAM = stm("<< /Length1 4 >>", "\0\x01\0\0");
const page1 = (resources: string, contents: string) =>
  [CATALOG, PAGES("3 0 R"), pageDict(resources, contents)] as Body[];
/** S21: OCRmyPDF image page with an invisible Type0 text layer as a Form. */
function s21() {
  const form = `q 1 0 0 1 0 0 cm BT 3 Tr /f-0-0 12 Tf 1 0 0 1 72 720 Tm <${hex2(T)}> Tj ET Q`;
  return pdf([
    ...page1("<< /XObject << /Im0 5 0 R /OCR-1 6 0 R >> >>", "4 0 R"),
    stm("<< >>", "q 612 0 0 792 0 0 cm /Im0 Do Q\nq /OCR-1 Do Q\n"),
    IMG,
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /f-0-0 7 0 R >> >> >>",
      form,
    ),
    "<< /Type /Font /Subtype /Type0 /BaseFont /GlyphLessFont /Encoding /Identity-H /DescendantFonts [8 0 R] /ToUnicode 9 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GlyphLessFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 10 0 R /DW 500 /CIDToGIDMap /Identity >>",
    stm("<< >>", asciiCMap),
    "<< /Type /FontDescriptor /FontName /GlyphLessFont /Flags 5 /FontBBox [0 0 500 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile2 11 0 R >>",
    PROGRAM,
  ]).bytes;
}
/** S22: qpdf/pdftk overlay, `Contents` array and a stamp Form with its own `/F1`. */
function s22() {
  return pdf([
    ...page1(
      "<< /Font << /F1 7 0 R >> /XObject << /Fx0 8 0 R >> >>",
      "[4 0 R 5 0 R 6 0 R]",
    ),
    stm("<< >>", "q\n"),
    stm("<< >>", `BT /F1 12 Tf 72 720 Td (${T}) Tj ET\n`),
    stm("<< >>", "\nQ\nq 1 0 0 1 0 0 cm /Fx0 Do Q\n"),
    HELV,
    stm(
      "<< /Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> /ProcSet [/PDF /Text] >> >>",
      "BT /F1 10 Tf 72 700 Td (Overlay stamp) Tj ET",
    ),
    font("Courier"),
  ]).bytes;
}
/** S23: pdfjam 2-up, two page Forms, one with a rotating `/Matrix`. */
function s23() {
  return pdf([
    ...page1("<< /XObject << /Fm1 5 0 R /Fm2 6 0 R >> >>", "4 0 R"),
    stm(
      "<< >>",
      "q 0.5 0 0 0.5 0 396 cm /Fm1 Do Q q 0.5 0 0 0.5 306 396 cm /Fm2 Do Q\n",
    ),
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Matrix [1 0 0 1 0 0] /Resources << /Font << /F1 7 0 R >> >> >>",
      `BT /F1 12 Tf 72 720 Td (${T}) Tj ET`,
    ),
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [0 0 792 612] /Matrix [0 1 -1 0 612 0] /Resources << /Font << /F1 8 0 R >> >> >>",
      "BT /F1 12 Tf 72 500 Td (Second page) Tj ET",
    ),
    HELV,
    font("Times-Roman"),
  ]).bytes;
}
/** S24: pdfTeX page including a figure Form whose labels sit in a nested Form. */
function s24() {
  return pdf([
    ...page1(
      "<< /Font << /F1 7 0 R >> /XObject << /Im1 5 0 R >> /ProcSet [/PDF /Text] >>",
      "4 0 R",
    ),
    stm(
      "<< >>",
      `BT /F1 12 Tf 72 720 Td (${T}) Tj ET\nq 1 0 0 1 100 400 cm /Im1 Do Q\n`,
    ),
    stm(
      "<< /Type /XObject /Subtype /Form /FormType 1 /PTEX.FileName (./fig.pdf) /PTEX.PageNumber 1 /PTEX.InfoDict 8 0 R /BBox [0 0 200 100] /Group << /S /Transparency >> /Resources << /XObject << /Fm0 6 0 R >> /ExtGState << /A1 << /CA 1 >> >> >> >>",
      "q /A1 gs 0 0 1 RG 10 10 m 190 90 l S Q /Fm0 Do",
    ),
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << /Font << /F1 9 0 R >> >> >>",
      "q 0 g BT /F1 8 Tf 20 20 Td (Figure label) Tj ET Q",
    ),
    HELV,
    "<< /Producer (synthetic) >>",
    font("Helvetica-Bold"),
  ]).bytes;
}
/** S25: Skia (Chrome) text in a transparency-group Form drawn after `gs`. */
function s25() {
  return pdf([
    ...page1(
      "<< /ExtGState << /G3 << /ca 0.5 /CA 0.5 >> >> /XObject << /X5 5 0 R >> >>",
      "4 0 R",
    ),
    stm("<< >>", "q 1 0 0 -1 0 792 cm q /G3 gs /X5 Do Q Q\n"),
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Group << /Type /Group /S /Transparency /CS /DeviceRGB /I true /K false >> /Resources << /Font << /F4 6 0 R >> >> >>",
      `BT /F4 12 Tf 1 0 0 -1 72 72 Tm <${hex2(T)}> Tj ET`,
    ),
    "<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Arial /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Arial /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /W [32 [278] 72 [722]] /DW 556 >>",
    stm("<< >>", asciiCMap),
    "<< /Type /FontDescriptor /FontName /AAAAAA+Arial /Flags 4 /FontBBox [-665 -325 2000 1006] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 716 /StemV 80 /FontFile2 10 0 R >>",
    PROGRAM,
  ]).bytes;
}
function eexec(plain: Buffer, r0: number) {
  let r = r0;
  const out = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) {
    const c = (plain[i] ?? 0) ^ (r >> 8);
    out[i] = c;
    r = ((c + r) * 52845 + 22719) & 0xffff;
  }
  return out;
}
const OT1: Record<number, string> = {
  12: "fi",
  34: "quotedblright",
  92: "quotedblleft",
  123: "endash",
};
/** A synthetic Type 1 program whose cleartext holds an OT1-like encoding. */
export function type1Program(encoding?: string[]) {
  const enc = encoding ?? [
    "/Encoding 256 array",
    "0 1 255 {1 index exch /.notdef put} for",
    "dup 32 /space put",
    ...Array.from({ length: 58 }, (_, i) => 65 + i)
      .filter((c) => /[A-Za-z]/u.test(String.fromCodePoint(c)))
      .map((c) => `dup ${c} /${String.fromCodePoint(c)} put`),
    ...Object.entries(OT1).map(([c, n]) => `dup ${c} /${n} put`),
    "readonly def",
  ];
  const clear = L(`%!PS-AdobeFont-1.0: CMR10 003.002
%%Title: CMR10
11 dict begin
/FontInfo 7 dict dup begin
/version (003.002) readonly def
/Notice (Synthetic test font) readonly def
/FullName (CMR10) readonly def
/FamilyName (Computer Modern) readonly def
/Weight (Medium) readonly def
/ItalicAngle 0 def
/isFixedPitch false def
end readonly def
/FontName /ABCDEF+CMR10 def
/PaintType 0 def
/FontType 1 def
/FontMatrix [0.001 0 0 0.001 0 0] readonly def
${enc.join("\n")}
/FontBBox {-40 -250 1009 750} readonly def
currentdict end
currentfile eexec
`);
  const priv = eexec(
    L(
      "\0\0\0\0dup /Private 8 dict dup begin\n/lenIV 4 def\nend\nmark currentfile closefile\n",
    ),
    55665,
  );
  const trailer = L("\n" + ("0".repeat(64) + "\n").repeat(8) + "cleartomark\n");
  return {
    clear,
    program: Buffer.concat([clear, priv, trailer]),
    priv,
    trailer,
  };
}
/** S26: pdfLaTeX Computer Modern Type 1 subset; only mapping is the built-in encoding. */
function s26() {
  const f = type1Program();
  return pdf([
    ...page1("<< /Font << /F15 5 0 R >> >>", "4 0 R"),
    stm(
      "<< >>",
      "BT /F15 12 Tf 72 720 Td (Hello \\014nal \\134modern\\042 \\173 PDF) Tj ET\n",
    ),
    `<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+CMR10 /FirstChar 0 /LastChar 127 /Widths [${Array(128).fill(500).join(" ")}] /FontDescriptor 6 0 R >>`,
    "<< /Type /FontDescriptor /FontName /ABCDEF+CMR10 /Flags 4 /FontBBox [-40 -250 1009 750] /ItalicAngle 0 /Ascent 694 /Descent -194 /CapHeight 683 /StemV 69 /FontFile 7 0 R >>",
    stm(
      `<< /Length1 ${f.clear.length} /Length2 ${f.priv.length} /Length3 ${f.trailer.length} /Filter /FlateDecode >>`,
      flate(f.program),
    ),
  ]).bytes;
}
/** S27–S29: inline images before the text. */
function inline(kind: "a85fl" | "fl" | "raw") {
  let bi: Buffer;
  if (kind === "a85fl")
    bi = Buffer.concat([
      L("BI /W 2 /H 2 /BPC 8 /CS /RGB /F [/A85 /Fl] ID\n"),
      L(a85(flate(Buffer.alloc(12, 200)))),
      L("\nEI Q\n"),
    ]);
  else if (kind === "fl")
    bi = Buffer.concat([
      L("BI /IM true /W 8 /H 2 /BPC 1 /F /Fl ID "),
      flate(Buffer.from([0xf0, 0x0f])),
      L("\nEI Q\n"),
    ]);
  else
    bi = Buffer.concat([
      L("BI /W 4 /H 1 /BPC 8 /CS /G ID "),
      Buffer.from([0x45, 0x49, 0x20, 0x51]),
      L("\nEI Q\n"),
    ]);
  const content = Buffer.concat([
    L("q 20 0 0 20 72 600 cm "),
    bi,
    L(`BT /F1 12 Tf 72 720 Td (${T}) Tj ET\n`),
  ]);
  return onePage(stm("<< >>", content));
}
const SMILE = 0x1f600;
/** S32: LibreOffice-shaped Type3 emoji font between Helvetica text. */
function s32() {
  return pdf([
    ...page1("<< /Font << /F1 5 0 R /F2 6 0 R >> >>", "4 0 R"),
    stm(
      "<< >>",
      "BT /F1 12 Tf 72 720 Td (Smile ) Tj /F2 12 Tf <01> Tj /F1 12 Tf ( done) Tj ET\n",
    ),
    HELV,
    "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /FirstChar 1 /LastChar 1 /Widths [1000] /Encoding << /Type /Encoding /Differences [1 /gid883] >> /CharProcs << /gid883 7 0 R >> /Resources << >> /ToUnicode 8 0 R >>",
    stm("<< >>", "1000 0 0 0 1000 1000 d1 0 0 1000 1000 re f"),
    stm("<< >>", toUnicode([[1, String.fromCodePoint(SMILE)]], 1)),
  ]).bytes;
}
/** S33: cairo-shaped Type3 font with a flipped `FontMatrix`. */
function s33() {
  return pdf([
    ...page1("<< /Font << /F1 5 0 R /F2 6 0 R >> >>", "4 0 R"),
    stm(
      "<< >>",
      "BT /F1 12 Tf 72 720 Td (Smile ) Tj /F2 12 Tf <00> Tj /F1 12 Tf (done) Tj ET\n",
    ),
    HELV,
    "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [1 0 0 -1 0 0] /FirstChar 0 /LastChar 0 /Widths [1.0] /Encoding << /Type /Encoding /Differences [0 /0] >> /CharProcs << /0 7 0 R >> /Resources << >> /ToUnicode 8 0 R >>",
    stm("<< >>", "1 0 0 0 1 1 d1 0 0 1 1 re f"),
    stm("<< >>", toUnicode([[0, String.fromCodePoint(SMILE)]], 1)),
  ]).bytes;
}
/** Every sample of F-034 AC-01 (S01–S33). */
export function sample(name: string): Buffer {
  const features = measurement1[name];
  if (features) return modern(features);
  const content = L(`BT /F1 12 Tf 72 720 Td (${T}) Tj ET\n`);
  const builders: Record<string, () => Buffer> = {
    S21: s21,
    S22: s22,
    S23: s23,
    S24: s24,
    S25: s25,
    S26: s26,
    S27: () => inline("a85fl"),
    S28: () => inline("fl"),
    S29: () => inline("raw"),
    S30: () =>
      onePage(
        stm(
          "<< /Filter [/ASCII85Decode /FlateDecode] >>",
          L(a85(flate(content))),
        ),
      ),
    S31: () => onePage(stm("<< /Filter /ASCIIHexDecode >>", L(ahx(content)))),
    S32: s32,
    S33: s33,
  };
  const build = builders[name];
  if (!build) throw new Error(`unknown sample ${name}`);
  return build();
}

export const objects = (content = textOf(T)): (Body | undefined)[] => [
  CATALOG,
  PAGES("3 0 R"),
  pageDict("<< /Font << /F1 5 0 R >> >>", "4 0 R"),
  stm("<< >>", content),
  HELV,
];
export const streamFile = (o: XrefStreamOptions) =>
  pdf(objects(), { xref: "stream", xrefOptions: o }).bytes;
/** Objects whose `members` live in object stream `stmId` (header built here). */
export function objStm(
  objs: (Body | undefined)[],
  members: number[],
  stmId: number,
  o: {
    header?: string;
    n?: number;
    lengthRef?: number;
    filler?: number;
  } & PdfOptions = {},
) {
  let header = "",
    data = "";
  const all = [
    ...members,
    ...Array.from({ length: o.filler ?? 0 }, (_, i) => objs.length + 1 + i),
  ];
  all.forEach((id) => {
    header += `${id} ${data.length} `;
    data += `${(objs[id - 1] as string | undefined) ?? "null"}\n`;
  });
  const out = [...objs];
  for (const id of members) out[id - 1] = undefined;
  const body = stm(
    `<< /Type /ObjStm /N ${o.n ?? all.length} /First ${(o.header ?? header).length} >>`,
    (o.header ?? header) + data,
  );
  if (o.lengthRef) body.lengthRef = o.lengthRef;
  out[stmId - 1] = body;
  return pdf(out, {
    xref: "stream",
    ...o,
    edit: (entries) => {
      all.forEach((id, index) =>
        entries.set(id, { type: 2, stream: stmId, index }),
      );
      o.edit?.(entries);
    },
  }).bytes;
}
/** `n` items joined by `sep`, built by `item(i)`. */
export const seq = (n: number, item: (i: number) => string, sep = " ") =>
  Array.from({ length: n }, (_, i) => item(i)).join(sep);

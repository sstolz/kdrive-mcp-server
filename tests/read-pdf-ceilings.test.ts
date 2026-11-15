import { expect, it, vi } from "vitest";
import { winAnsiEncoding } from "../src/pdf-encoding-tables.js";
import {
  L,
  T,
  asciiCMap,
  flate,
  objStm,
  objects,
  onePage,
  pdf,
  seq,
  stm,
  streamFile,
  textOf,
  type1Program,
} from "./helpers/pdf-corpus.js";
import { refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const pairs = (n: number) => "[" + seq(n, (i) => String(i) + " 1") + "]";
const rows = (n: number) => Array.from({ length: n }, (_, i) => i);
const inline = (pairCount: number) =>
  onePage(
    stm(
      "<< >>",
      `q BI /W 1 /H 1 /BPC 8 /CS /G ${seq(pairCount - 4, (i) => "/X" + String(i) + " 0")} ID x EI Q ${textOf(T)}`,
    ),
  );
/** A cleartext whose built-in encoding has `groups` `dup` groups (codes 0–255, repeated). */
function groups(count: number) {
  const names = winAnsiEncoding.map((n) => n || "space");
  const puts = Array.from(
    { length: count },
    (_, i) => `dup ${i % 256} /${names[i % 256] ?? "space"} put`,
  );
  const p = type1Program(["/Encoding 256 array", ...puts, "readonly def"]);
  return onePage(stm("<< >>", textOf("Hello")), [
    `<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+CMR10 /FontDescriptor 6 0 R >>`,
    "<< /Type /FontDescriptor /FontName /ABCDEF+CMR10 /Flags 4 /FontFile 7 0 R >>",
    stm(
      `<< /Length1 ${p.clear.length} /Filter /FlateDecode >>`,
      flate(p.program),
    ),
  ]);
}
const baseFont = (length: number) =>
  onePage(stm("<< >>", textOf("Hello")), [
    `<< /Type /Font /Subtype /TrueType /BaseFont /${"B".repeat(length)} /Encoding /WinAnsiEncoding >>`,
  ]);
const cidInfo = (length: number) =>
  onePage(stm("<< >>", "BT /F1 12 Tf 72 720 Td <00480069> Tj ET"), [
    "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (${"R".repeat(length)}) /Ordering (${"O".repeat(length)}) /Supplement 0 >> /FontDescriptor 8 0 R >>`,
    stm("<< >>", asciiCMap),
    "<< /Type /FontDescriptor /FontName /X /Flags 32 >>",
  ]);
/** A classic section whose trailer `/Size` is `size` (objects 0–5 listed). */
const listed = (size: number) =>
  L(
    pdf(objects())
      .bytes.toString("latin1")
      .replace("<< /Size 6 ", `<< /Size ${size} `),
  );
/** An inline Flate image whose output is `output` bytes; B leaves `room` bytes for it. */
function inlineFlate(output: number) {
  const head = "q BI /W 1000 /H 1000 /BPC 8 /CS /G /F /Fl ID ";
  const content = Buffer.concat([
    L(head),
    flate(Buffer.alloc(output)),
    L(` EI Q ${"0 0 m ".repeat(200)}${textOf(T)}`),
  ]);
  return { bytes: onePage(stm("<< >>", content)), decoded: content.length };
}
it.each([
  [
    "/Index pairs",
    () => streamFile({ size: 4097, index: pairs(4096), rows: rows(4096) }),
    () => streamFile({ size: 4098, index: pairs(4097), rows: rows(4097) }),
  ],
  [
    "objects in one object stream",
    () => objStm([...objects(), undefined], [1, 2, 3, 5], 6, { filler: 4092 }),
    () => objStm([...objects(), undefined], [1, 2, 3, 5], 6, { filler: 4093 }),
  ],
  ["inline image dictionary pairs", () => inline(32), () => inline(33)],
  ["built-in encoding groups", () => groups(256), () => groups(257)],
  ["BaseFont bytes", () => baseFont(127), () => baseFont(128)],
  ["CIDSystemInfo string bytes", () => cidInfo(64), () => cidInfo(65)],
  ["listed object numbers below /Size", () => listed(6), () => listed(5)],
] as const)(
  "BR-412 AC-13 ceilings at and over: %s",
  async (_name, at, over) => {
    expect(await text(at())).toMatch(/^(?:Hello modern PDF|Hello|Hi)$/u);
    await refuses(over(), "LIMIT_EXCEEDED");
  },
);
it("BR-412 AC-13 ceilings at and over: Flate inline image output at the remaining B", async () => {
  const output = 50000,
    file = inlineFlate(output);
  expect(await text(file.bytes, file.decoded + output)).toBe(T);
  await refuses(file.bytes, "LIMIT_EXCEEDED", file.decoded + output - 1);
});

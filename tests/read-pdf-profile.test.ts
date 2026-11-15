import { expect, it, vi } from "vitest";
import {
  CATALOG,
  HELV,
  L,
  PAGES,
  T,
  onePage,
  pdf,
  sample,
  stm,
  textOf,
} from "./helpers/pdf-corpus.js";
import { canonical, read, refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const golden: Record<string, string> = {
  S22: `${T}\nOverlay stamp`,
  S23: `${T}\nSecond page`,
  S24: `${T}\nFigure label`,
  S26: "Hello ﬁnal “modern” – PDF",
  S32: "Smile 😀 done",
  S33: "Smile 😀done",
};
const names = Array.from(
  { length: 33 },
  (_, i) => `S${String(i + 1).padStart(2, "0")}`,
);
const forbidden = [
  "/Filter",
  "/XRef",
  "/ObjStm",
  "/FontFile",
  "/Metadata",
  "/Info",
  "/ExtGState",
  "/XObject",
  "/Type3",
  "/CharProcs",
  "BI",
];
it.each(names)(
  "BR-114 v2 AC-01 synthetic producer corpus extracts %s",
  async (name) => {
    const bytes = sample(name),
      result = await read(bytes);
    expect(result.text).toBe(golden[name] ?? T);
    expect(result.total_pages).toBe(1);
    const projected = await canonical(bytes);
    for (const token of forbidden) expect(projected).not.toContain(token);
  },
);
/** AC-05: a three-page file full of keys the projection leaves out. */
function threePages() {
  const text3 = "BT /F2 12 Tf 72 720 Td <0048> Tj ET";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R /OpenAction 9 0 R /AcroForm << /Fields [] >> /Names << /EmbeddedFiles 10 0 R >> /Outlines 11 0 R /StructTreeRoot 12 0 R /Metadata 13 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://example.invalid/) >> >>] >>",
    "<< /Type /Page /Parent 2 0 R >>",
    "<< /Type /Page /Parent 2 0 R /Contents 14 0 R >>",
    stm("<< >>", textOf(T)),
    HELV,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Ryumin /Encoding /UniJIS-UCS2-H /DescendantFonts [15 0 R] >>",
    "<< /S /JavaScript /JS (app.alert\\(1\\)) >>",
    "<< /Names [(a.txt) 16 0 R] >>",
    "<< /Type /Outlines /Count 0 >>",
    "<< /Type /StructTreeRoot >>",
    stm("<< /Type /Metadata /Subtype /XML >>", "<x/>"),
    stm("<< >>", text3),
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Ryumin /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 4 >> /FontDescriptor 17 0 R >>",
    "<< /Type /Filespec /F (a.txt) /EF << /F 18 0 R >> >>",
    "<< /Type /FontDescriptor /FontName /Ryumin /Flags 4 >>",
    stm("<< /Type /EmbeddedFile >>", "attachment"),
  ]).bytes;
}
it("BR-415 AC-05 canonical projection", async () => {
  const bytes = threePages(),
    result = await read(bytes, undefined, [1, 2]);
  expect(result.text).toBe(`${T}\n\f\n`);
  expect(result.total_pages).toBe(3);
  const projected = await canonical(bytes, undefined, [1, 2]);
  for (const key of [
    "/OpenAction",
    "/Annots",
    "/AcroForm",
    "/Names",
    "/EmbeddedFiles",
    "/Outlines",
    "/StructTreeRoot",
    "/Metadata",
    "/S /JavaScript",
    "/URI",
    "/Ryumin",
    "/UniJIS",
  ])
    expect(projected).not.toContain(key);
  const pages = [
    ...projected.matchAll(
      /\/Type \/Page \/Parent \d+ 0 R \/MediaBox \[0 0 612 792\] \/Resources (<<.*?>>) \/Contents (\d+) 0 R/gu,
    ),
  ];
  expect(pages).toHaveLength(3);
  expect(pages[0]?.[1]).toMatch(/^<< \/Font << \/K1 \d+ 0 R >> >>$/u);
  expect(projected).toMatch(/\/K1 12 Tf/u);
  const length = (id: string | undefined) =>
    new RegExp(`\\n${id} 0 obj\\n<< /Length (\\d+) >>`, "u").exec(
      projected,
    )?.[1];
  expect(length(pages[1]?.[2])).toBe("0");
  expect(pages[2]?.[1]).toBe("<< >>");
  expect(length(pages[2]?.[2])).toBe("0");
  await refuses(bytes, "UNSUPPORTED_FORMAT", undefined, [3]);
});
it("BR-415 AC-05 canonical projection (b) unread resources of a page not selected", async () => {
  const bytes = pdf([
    CATALOG,
    PAGES("3 0 R 6 0 R", 2),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stm("<< >>", textOf(T)),
    HELV,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources 99 0 R /Contents 4 0 R >>",
  ]).bytes;
  expect(await text(bytes, undefined, [1])).toBe(T);
  await refuses(bytes, "CONTENT_UNAVAILABLE", undefined, [2]);
});
it("BR-415 AC-05 canonical projection (c) a font selected only in a text-free Form", async () => {
  const bytes = pdf([
    CATALOG,
    PAGES("3 0 R"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /XObject << /Fm 6 0 R >> >> /Contents 4 0 R >>",
    stm("<< >>", `/Fm Do ${textOf(T)}`),
    HELV,
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F2 7 0 R >> >> >>",
      "/F2 12 Tf 0 0 m",
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ]).bytes;
  expect(await text(bytes)).toBe(T);
  const projected = await canonical(bytes);
  expect(projected).toContain("/K1 12 Tf");
  expect(projected).not.toContain("/K2");
  expect(projected).not.toContain("/Courier");
  expect(projected.match(/\/Type \/Font /gu)).toHaveLength(1);
});
const base = () => onePage(textOf(T));
function withHeader(header: string) {
  const bytes = base().toString("latin1");
  const first = bytes.indexOf("\n");
  const shift = header.length - first;
  const fixed = bytes
    .slice(first)
    .replace(
      /startxref\n(\d+)/u,
      (_, n: string) => `startxref\n${Number(n) + shift}`,
    );
  const offsets = fixed.replace(
    /(\d{10}) (\d{5}) n/gu,
    (_, n: string, g: string) =>
      `${String(Number(n) + shift).padStart(10, "0")} ${g} n`,
  );
  return L(header + offsets);
}
it.each([
  [
    "(a) /Encrypt",
    () =>
      pdf(
        [
          CATALOG,
          PAGES("3 0 R"),
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
          stm("<< >>", textOf(T)),
          HELV,
          "<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>",
        ],
        { trailer: "/Encrypt 6 0 R" },
      ).bytes,
    "UNSUPPORTED_FORMAT",
  ],
  ["(c) %PDF-2.1", () => withHeader("%PDF-2.1"), "UNSUPPORTED_FORMAT"],
  [
    "(d) cross-reference offset one byte off",
    () =>
      L(
        base()
          .toString("latin1")
          .replace(
            /startxref\n(\d+)/u,
            (_, n: string) => `startxref\n${Number(n) - 1}`,
          ),
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(e) bytes after the last %%EOF",
    () => Buffer.concat([base(), L("garbage")]),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(f) header followed by a space",
    () => withHeader("%PDF-1.7 "),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(g) unknown operator and a /Prev cycle",
    () => {
      const first = pdf([
        CATALOG,
        PAGES("3 0 R"),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        stm("<< >>", `${textOf(T)} 1 2 3 zz`),
        HELV,
      ]);
      const s = first.bytes.toString("latin1");
      const start = /startxref\n(\d+)/u.exec(s)?.[1] ?? "0";
      return L(s.replace("/Root 1 0 R ", `/Root 1 0 R /Prev ${start} `));
    },
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(h) LZW page 1 then 129 fonts on page 2",
    () => {
      const fonts = Array.from({ length: 129 }, (_, i) => `/G${i} 7 0 R`).join(
        " ",
      );
      const many = Array.from(
        { length: 129 },
        (_, i) => `/G${i} 12 Tf (a) Tj`,
      ).join(" ");
      return pdf([
        CATALOG,
        PAGES("3 0 R 4 0 R", 2),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << ${fonts} >> >> /Contents 6 0 R >>`,
        stm(
          "<< /Filter /LZWDecode >>",
          Buffer.from([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]),
        ),
        stm("<< >>", `BT ${many} ET`),
        HELV,
      ]).bytes;
    },
    "UNSUPPORTED_FORMAT",
  ],
] as const)(
  "BR-114 v2 AC-09 error classification %s",
  async (_name, build, code) => {
    await refuses(
      build(),
      code,
      undefined,
      _name.startsWith("(h)") ? [1, 2] : [1],
    );
  },
);
it("BR-114 v2 AC-09 error classification (b) %PDF-2.0", async () => {
  expect(await text(withHeader("%PDF-2.0"))).toBe(T);
});

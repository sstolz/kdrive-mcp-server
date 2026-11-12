import { expect, it, vi } from "vitest";
import * as pdfjs from "pdfjs-dist";
import { preflightPdf } from "../src/extraction-pdf-profile.js";
import { extractPdf } from "../src/extraction-pdf.js";
import { PdfParser } from "../src/pdf-syntax.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
interface LexicalOptions {
  key?: string;
  catalog?: string;
  pagesRef?: string;
  kidRef?: string;
  parentRef?: string;
  contentRef?: string;
  fontRef?: string;
  length?: string;
  count?: string;
  size?: string;
  rootRef?: string;
  width?: string;
  height?: string;
  bits?: string;
  objectId?: string;
  objectGeneration?: string;
  xrefFirst?: string;
  xrefCount?: string;
  xrefOffsetReal?: boolean;
  xrefGeneration?: string;
  startxrefReal?: boolean;
  realGeometry?: boolean;
  unpaddedXref?: boolean;
  signedXref?: boolean;
  xrefTab?: boolean;
  xrefEol?: string;
  flatXrefHeader?: boolean;
  splitSubsectionHeader?: boolean;
}
function lexicalPdf(o: LexicalOptions = {}) {
  const content = o.realGeometry
    ? "BT /F1 12.0 Tf 1.0 0.0 0.0 1.0 72.5 720.25 Tm [(Hello) -10.5 ( bounded PDF)] TJ ET"
    : "BT /F1 12 Tf 1 0 0 1 72 720 Tm (Hello bounded PDF) Tj ET";
  const objects = [
    `<< ${o.key ?? "/Type"} ${o.catalog ?? "/Catalog"} /Pages ${o.pagesRef ?? "2 0 R"} >>`,
    `<< /Type /Pages /Count ${o.count ?? "1"} /Kids [${o.kidRef ?? "4 0 R"}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Type /Page /Parent ${o.parentRef ?? "2 0 R"} /MediaBox ${o.realGeometry ? "[0.0 0.0 612.5 792.25]" : "[0 0 612 792]"} /Resources << /Font << /F1 ${o.fontRef ?? "3 0 R"} >> /XObject << /Im1 6 0 R >> >> /Contents ${o.contentRef ?? "5 0 R"} >>`,
    `<< /Length ${o.length ?? String(content.length)} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${o.width ?? "1"} /Height ${o.height ?? "1"} /BitsPerComponent ${o.bits ?? "8"} /ColorSpace /DeviceRGB /Length 3 >>\nstream\n\xff\xff\xff\nendstream`,
  ];
  const parts = [Buffer.from("%PDF-1.4\n")],
    offsets: number[] = [];
  let size = 9;
  objects.forEach((object, i) => {
    offsets.push(size);
    const part = Buffer.from(
      `${i === 0 ? (o.objectId ?? "1") : String(i + 1)} ${i === 0 ? (o.objectGeneration ?? "0") : "0"} obj\n${object}\nendobj\n`,
      "latin1",
    );
    parts.push(part);
    size += part.length;
  });
  let end = `xref${o.flatXrefHeader ? " " : "\n"}${o.xrefFirst ?? "0"}${o.splitSubsectionHeader ? "\n" : " "}${o.xrefCount ?? "7"}\n0000000000 65535 f${o.xrefEol ?? " \n"}`;
  offsets.forEach((offset, i) => {
    end += `${o.xrefOffsetReal && i === 0 ? offset + ".0" : o.unpaddedXref ? String(offset) : o.signedXref && i === 0 ? "+" + String(offset).padStart(9, "0") : String(offset).padStart(10, "0")}${o.xrefTab ? "\t" : " "}${i === 0 ? (o.xrefGeneration ?? "00000") : "00000"} n${o.xrefEol ?? " \n"}`;
  });
  end += `trailer\n<< /Size ${o.size ?? "7"} /Root ${o.rootRef ?? "1 0 R"} >>\nstartxref\n${size}${o.startxrefReal ? ".0" : ""}\n%%EOF\n`;
  parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}
const invalid: { name: string; options: LexicalOptions }[] = [
  {
    name: "high-bit escaped-name both nibbles",
    options: { key: "/#\xb5\xb4ype" },
  },
  {
    name: "high-bit escaped-name first nibble",
    options: { key: "/#\xb54ype" },
  },
  {
    name: "high-bit escaped-name second nibble",
    options: { key: "/#5\xb4ype" },
  },
  {
    name: "high-bit escaped-name value",
    options: { catalog: "/Cata#\xb6\xc3og" },
  },
  { name: "real reference object number", options: { pagesRef: "2.0 0 R" } },
  { name: "real reference generation", options: { pagesRef: "2 0.0 R" } },
  { name: "real Kids reference", options: { kidRef: "4.0 0 R" } },
  { name: "real Parent reference", options: { parentRef: "2 0.0 R" } },
  { name: "real Contents reference", options: { contentRef: "5.0 0 R" } },
  { name: "real Font reference", options: { fontRef: "3 0.0 R" } },
  { name: "real trailer Root reference", options: { rootRef: "1.0 0 R" } },
  { name: "real stream Length", options: { length: "57.0" } },
  { name: "real Pages Count", options: { count: "1.0" } },
  { name: "real trailer Size", options: { size: "7.0" } },
  { name: "real Image Width", options: { width: "1.0" } },
  { name: "real Image Height", options: { height: "1.0" } },
  { name: "real Image BitsPerComponent", options: { bits: "8.0" } },
  { name: "real xref subsection first", options: { xrefFirst: "0.0" } },
  { name: "real xref subsection count", options: { xrefCount: "7.0" } },
  { name: "real xref object offset", options: { xrefOffsetReal: true } },
  { name: "real xref generation", options: { xrefGeneration: "0.0" } },
  { name: "real object header ID", options: { objectId: "1.0" } },
  {
    name: "real object header generation",
    options: { objectGeneration: "0.0" },
  },
  { name: "real startxref offset", options: { startxrefReal: true } },
];
invalid.push(
  { name: "unpadded xref fields", options: { unpaddedXref: true } },
  { name: "signed xref offset", options: { signedXref: true } },
  { name: "tab xref separator", options: { xrefTab: true } },
  { name: "19-byte xref entry", options: { xrefEol: "\n" } },
  { name: "21-byte xref entry", options: { xrefEol: "  \n" } },
  { name: "flat xref keyword/header", options: { flatXrefHeader: true } },
  {
    name: "split xref subsection header",
    options: { splitSubsectionHeader: true },
  },
);
it.each(invalid)(
  "TestBR114_pdf_framing review2 rejects $name before PDF.js",
  async ({ options }) => {
    const bytes = lexicalPdf(options),
      getDocument = vi.mocked(pdfjs.getDocument);
    getDocument.mockClear();
    expect(() => preflightPdf(bytes, 16777216, [1])).toThrow();
    await expect(
      extractPdf({
        bytes,
        budget: 16777216,
        maxOutputChars: 200000,
        args: { format: "pdf" },
        metadata: {
          drive_id: 7,
          file_id: 3,
          etag: '"v1"',
          size_bytes: bytes.length,
        },
      }),
    ).rejects.toThrow();
    expect(getDocument).not.toHaveBeenCalled();
  },
);
it.each([
  { key: "/#54ype", catalog: "/#43atalog" },
  { realGeometry: true },
  { xrefEol: "\r\n" },
  { xrefEol: " \r" },
])(
  "TestBR114_pdf_framing review2 preserves valid escapes and finite real geometry %#",
  async (options) => {
    const bytes = lexicalPdf(options);
    expect(preflightPdf(bytes, 16777216, [1]).total_pages).toBe(1);
    const result = await extractPdf({
      bytes,
      budget: 16777216,
      maxOutputChars: 200000,
      args: { format: "pdf" },
      metadata: {
        drive_id: 7,
        file_id: 3,
        etag: '"v1"',
        size_bytes: bytes.length,
      },
    });
    expect(result.text).toBe("Hello bounded PDF");
  },
);
it.each(["0.0", "1.", "+2.0", ".0", "-0.0"])(
  "TestBR114_pdf_framing review2 integer method refuses real token %s",
  (token) => {
    expect(() => new PdfParser(Buffer.from(token)).integer()).toThrow();
  },
);
it.each(["+2", "0002", "-0"])(
  "TestBR114_pdf_framing review2 integer lexical control %s",
  (token) => {
    expect(new PdfParser(Buffer.from(token)).integer()).toBe(Number(token));
  },
);

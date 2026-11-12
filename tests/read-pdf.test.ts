import { expect, it } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { payload } from "./helpers/navigation.js";
import {
  classicPdf,
  pdfObjects,
  stream,
  scannedPdf,
} from "./helpers/extraction.js";
import { preflightPdf } from "../src/extraction-pdf-profile.js";
import { extractPdf } from "../src/extraction-pdf.js";
const request = (bytes: Buffer, budget = 16777216, pages = [1]) => ({
  bytes: Uint8Array.from(bytes),
  budget,
  maxOutputChars: 200000,
  metadata: { drive_id: 7, file_id: 3, size_bytes: bytes.length, etag: '"v1"' },
  args: { format: "pdf" as const, pages },
});
it.each([false, true])(
  "TestBR115_selected_pdf_text actual dependency Flate=%s",
  async (compressed) => {
    const f = await contentFixture(
      {},
      classicPdf(["one", "two", "three"], compressed),
    );
    const c = createNavigationController(f.config, f.dependencies);
    try {
      const result = await c.invoke("kdrive_read", {
        file_id: 3,
        format: "pdf",
        pages: [1, 3],
      });
      expect(result.isError).toBeUndefined();
      expect(payload(result)).toMatchObject({
        text: "one\n\f\nthree",
        pages: [1, 3],
        total_pages: 3,
        has_more: false,
      });
    } finally {
      c.close();
    }
  },
);
it("TestBR114_canonical_equivalence removes Flate without changing text", async () => {
  const raw = classicPdf([
    "Euro \\200 caf\\351 (escaped)".replace("(escaped)", "\\(escaped\\)"),
  ]);
  const compressed = classicPdf(["Euro \\200 caf\\351 \\(escaped\\)"], true);
  const a = await extractPdf(request(raw)),
    b = await extractPdf(request(compressed));
  expect(a.text).toBe(b.text);
  expect(a.text).toContain("€ café");
  const plan = preflightPdf(compressed, 16777216, [1]);
  expect(Buffer.from(plan.bytes).toString("latin1")).not.toContain(
    "/FlateDecode",
  );
});
it("TestBR114_pdf_framing rejects alternate containers before parser", () => {
  for (const bytes of [
    Buffer.concat([classicPdf(), Buffer.from("x")]),
    classicPdf().subarray(0, 40),
    pdfObjects(
      [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 0 /Kids [] >>",
      ],
      "/Encrypt 3 0 R",
    ),
    classicPdf(["x"], false, "/F1 Do"),
    classicPdf(["x"], false, "BT /F1 12 Tf <00> Tj ET"),
  ])
    expect(() => preflightPdf(bytes, 16777216, [1])).toThrow();
});
it("TestBR114_pdf_bombs fails aggregate/expansion before PDF.js", () => {
  const bomb = pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 0 /Kids [] >>",
    stream(Buffer.alloc(4097, 65), true),
  ]);
  expect(() => preflightPdf(bomb, 4096, [1])).toThrow("LIMIT_EXCEEDED");
});
it("TestBR114_pdf_producer_admission bounds repeated TJ text at small budgets", async () => {
  const many = classicPdf(
    [""],
    true,
    `BT /F1 12 Tf [${Array.from({ length: 1200 }, () => "(a) 1").join(" ")}] TJ ET`,
  );
  expect(() => preflightPdf(many, 4096, [1])).toThrow("LIMIT_EXCEEDED");
  expect(() =>
    preflightPdf(classicPdf(["x".repeat(4097)]), 16777216, [1]),
  ).toThrow("LIMIT_EXCEEDED");
  const bytes = classicPdf(["a".repeat(500)]);
  const plan = preflightPdf(bytes, 16777216, [1]);
  expect(plan.producerBytes).toBeGreaterThan(500);
  const actual = await extractPdf(request(bytes));
  expect(Buffer.byteLength(actual.text)).toBeLessThanOrEqual(
    plan.producerBytes,
  );
});
it("TestBR115_selected_pdf_text explicitly refuses blank, wrong-page and zero-byte PDFs", async () => {
  for (const [bytes, pages, error] of [
    [classicPdf([""]), [1], "NO_EXTRACTABLE_TEXT"],
    [classicPdf(), [2], "INVALID_RANGE"],
    [Buffer.alloc(0), [1], "UNSUPPORTED_FORMAT"],
  ] as const) {
    const f = await contentFixture({}, bytes),
      c = createNavigationController(f.config, f.dependencies);
    try {
      expect(
        await c.invoke("kdrive_read", {
          file_id: 3,
          format: "pdf",
          pages: [...pages],
        }),
      ).toEqual(contentError(error));
    } finally {
      c.close();
    }
  }
});

it.each([false, true])(
  "TestBR115_selected_pdf_text scanned image-only refusal, Flate=%s",
  async (compressed) => {
    const f = await contentFixture({}, scannedPdf(compressed)),
      c = createNavigationController(f.config, f.dependencies);
    try {
      expect(
        await c.invoke("kdrive_read", { file_id: 3, format: "pdf" }),
      ).toEqual(contentError("NO_EXTRACTABLE_TEXT"));
    } finally {
      c.close();
    }
  },
);

it("TestBR114_pdf_framing rejects arrays/reuse, duplicate keys, embedded font and Forms", () => {
  const make = (
    contents: string,
    font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    extra = "",
  ) =>
    pdfObjects([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [4 0 R] >>",
      font,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} ${extra} >>`,
      stream(Buffer.from("BT /F1 12 Tf (hello) Tj ET"), true),
    ]);
  for (const bytes of [
    make("[5 0 R]"),
    make("5 0 R", undefined, "/Contents 5 0 R"),
    make(
      "5 0 R",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 5 0 R >>",
    ),
    make(
      "5 0 R",
      "<< /Type /Font /Subtype /Type3 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ),
  ])
    expect(() => preflightPdf(bytes, 16777216, [1])).toThrow();
  const reused = pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [4 0 R 6 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    stream(Buffer.from("BT /F1 12 Tf (one) Tj ET")),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
  ]);
  expect(() => preflightPdf(reused, 16777216, [1, 2])).toThrow(
    "UNSUPPORTED_FORMAT",
  );
});
it("TestBR114_pdf_framing never treats delimiter-like strings as object boundaries", async () => {
  const bytes = classicPdf(
    ["obj endobj stream endstream /Filter \\(literal\\)"],
    true,
  );
  const result = await extractPdf(request(bytes));
  expect(result.text).toContain(
    "obj endobj stream endstream /Filter (literal)",
  );
});

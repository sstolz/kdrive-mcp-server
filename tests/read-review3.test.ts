import { expect, it, vi } from "vitest";
import * as pdfjs from "pdfjs-dist";
import { classicPdf } from "./helpers/extraction.js";
import { preflightPdf } from "../src/extraction-pdf-profile.js";
import { extractPdf } from "../src/extraction-pdf.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
function terminalPdf(frame: (offset: string) => string) {
  const source = classicPdf(["Hello bounded PDF"]).toString("latin1"),
    match = /\nstartxref\n(\d+)\n%%EOF\n$/u.exec(source)!;
  return Buffer.from(source.slice(0, match.index) + frame(match[1]!), "latin1");
}
const request = (bytes: Buffer) => ({
  bytes,
  budget: 16777216,
  maxOutputChars: 200000,
  args: { format: "pdf" as const },
  metadata: { drive_id: 7, file_id: 3, etag: '"v1"', size_bytes: bytes.length },
});
const invalid: { name: string; frame: (offset: string) => string }[] = [
  { name: "commented keyword", frame: (n) => `\n%startxref\n${n}\n%%EOF\n` },
  {
    name: "keyword inside comment",
    frame: (n) => `\n%ignored startxref\n${n}\n%%EOF\n`,
  },
  { name: "same trailer line", frame: (n) => ` startxref\n${n}\n%%EOF\n` },
  {
    name: "longer keyword token prefix",
    frame: (n) => `\nrestartxref\n${n}\n%%EOF\n`,
  },
  { name: "name keyword token", frame: (n) => `\n/startxref\n${n}\n%%EOF\n` },
  {
    name: "high-bit keyword prefix",
    frame: (n) => `\n\xbastartxref\n${n}\n%%EOF\n`,
  },
  {
    name: "longer keyword token suffix",
    frame: (n) => `\nstartxrefExtra\n${n}\n%%EOF\n`,
  },
  {
    name: "keyword and offset same line",
    frame: (n) => `\nstartxref ${n}\n%%EOF\n`,
  },
  {
    name: "offset and EOF same line",
    frame: (n) => `\nstartxref\n${n} %%EOF\n`,
  },
  {
    name: "all framing on same line",
    frame: (n) => `\nstartxref ${n} %%EOF\n`,
  },
  {
    name: "space before keyword without line boundary",
    frame: (n) => ` \tstartxref\n${n}\n%%EOF\n`,
  },
  { name: "NUL keyword separator", frame: (n) => `\nstartxref\0${n}\n%%EOF\n` },
  {
    name: "form-feed keyword separator",
    frame: (n) => `\nstartxref\f${n}\n%%EOF\n`,
  },
  { name: "tab keyword separator", frame: (n) => `\nstartxref\t${n}\n%%EOF\n` },
  { name: "NUL EOF separator", frame: (n) => `\nstartxref\n${n}\0%%EOF\n` },
  {
    name: "form-feed EOF separator",
    frame: (n) => `\nstartxref\n${n}\f%%EOF\n`,
  },
  { name: "commented offset", frame: (n) => `\nstartxref\n%${n}\n%%EOF\n` },
  { name: "offset token suffix", frame: (n) => `\nstartxref\n${n}x\n%%EOF\n` },
  { name: "offset real token", frame: (n) => `\nstartxref\n${n}.0\n%%EOF\n` },
  { name: "extra offset line", frame: (n) => `\nstartxref\n${n}\n0\n%%EOF\n` },
  {
    name: "blank keyword/offset line",
    frame: (n) => `\nstartxref\n\n${n}\n%%EOF\n`,
  },
  {
    name: "blank offset/EOF line",
    frame: (n) => `\nstartxref\n${n}\n\n%%EOF\n`,
  },
  { name: "EOF token suffix", frame: (n) => `\nstartxref\n${n}\n%%EOFextra\n` },
  {
    name: "EOF comment suffix",
    frame: (n) => `\nstartxref\n${n}\n%%EOF %extra\n`,
  },
  {
    name: "later comment after EOF",
    frame: (n) => `\nstartxref\n${n}\n%%EOF\n%later\n`,
  },
  { name: "trailing data", frame: (n) => `\nstartxref\n${n}\n%%EOF\nx` },
];
it.each(invalid)(
  "TestBR114_pdf_framing review3 rejects $name before PDF.js",
  async ({ frame }) => {
    const bytes = terminalPdf(frame);
    vi.mocked(pdfjs.getDocument).mockClear();
    expect(() => preflightPdf(bytes, 16777216, [1])).toThrow();
    await expect(extractPdf(request(bytes))).rejects.toThrow();
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  },
);
const valid = [
  { name: "LF", eol: "\n", tail: "\n" },
  { name: "CRLF", eol: "\r\n", tail: "\r\n" },
  { name: "CR", eol: "\r", tail: "\r" },
  { name: "no final EOL", eol: "\n", tail: "" },
  { name: "trailing PDF whitespace", eol: "\n", tail: " \t\0\f\r\n\r\n" },
];
it.each(valid)(
  "TestBR114_pdf_framing review3 actual extraction preserves $name terminal lines",
  async ({ eol, tail }) => {
    const bytes = terminalPdf(
      (n) => `${eol}startxref${eol}${n}${eol}%%EOF${tail}`,
    );
    expect(preflightPdf(bytes, 16777216, [1]).total_pages).toBe(1);
    expect((await extractPdf(request(bytes))).text).toBe("Hello bounded PDF");
  },
);
it("TestBR114_pdf_framing review3 complete preceding comment cannot cut terminal boundary", async () => {
  const bytes = terminalPdf(
    (n) => `\n%ignored startxref\nstartxref\n${n}\n%%EOF\n`,
  );
  expect((await extractPdf(request(bytes))).text).toBe("Hello bounded PDF");
});

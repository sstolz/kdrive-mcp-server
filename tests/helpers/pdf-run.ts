// F-034: runs synthetic files through `extractPdf` (the actual pinned PDF.js)
// with a spy on the PDF.js start. Test files must mock `pdfjs-dist` so that
// `getDocument` is a spy:
//   vi.mock("pdfjs-dist", async (original) => {
//     const actual = await original<typeof import("pdfjs-dist")>();
//     return { ...actual, getDocument: vi.fn(actual.getDocument) };
//   });
import { expect, vi } from "vitest";
import * as pdfjs from "pdfjs-dist";
import { extractPdf } from "../../src/extraction-pdf.js";
import { preflightPdf } from "../../src/extraction-pdf-profile.js";
export const B16 = 16777216;
export const request = (bytes: Buffer, budget = B16, pages = [1]) => ({
  bytes: Uint8Array.from(bytes),
  budget,
  maxOutputChars: 1000000,
  metadata: { drive_id: 7, file_id: 3, size_bytes: bytes.length, etag: '"v1"' },
  args: { format: "pdf" as const, pages },
});
/** Extracts through PDF.js and returns the text; fails the test on refusal. */
export async function text(bytes: Buffer, budget = B16, pages = [1]) {
  const result = await extractPdf(request(bytes, budget, pages));
  return result.text;
}
export async function read(bytes: Buffer, budget = B16, pages = [1]) {
  return extractPdf(request(bytes, budget, pages));
}
/** Asserts the refusal code and that PDF.js never started. */
export async function refuses(
  bytes: Buffer,
  code: string,
  budget = B16,
  pages = [1],
) {
  const getDocument = vi.mocked(pdfjs.getDocument);
  getDocument.mockClear();
  await expect(extractPdf(request(bytes, budget, pages))).rejects.toThrow(code);
  expect(getDocument).not.toHaveBeenCalled();
}
/** The canonical document PDF.js would receive. */
export async function canonical(bytes: Buffer, budget = B16, pages = [1]) {
  return (await preflightPdf(bytes, budget, pages)).bytes.toString("latin1");
}
/** The canonical content streams of a canonical document, in object order. */
export function contentStreams(document: string) {
  return [
    ...document.matchAll(/<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/gu),
  ].map((m) => m[1] ?? "");
}

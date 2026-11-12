import { getDocument } from "pdfjs-dist";
import { preflightPdf } from "./extraction-pdf-profile.js";
import {
  extractionFail as fail,
  type WorkerRequest,
} from "./extraction-values.js";
import { record, array } from "./policy/values.js";
class NoExternalFactory {
  fetch(): Promise<never> {
    return Promise.reject(new Error("EXTERNAL_UNAVAILABLE"));
  }
}
/** BR-115/122: only bounded canonical plain streams and a closed font/operator profile. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export async function extractPdf(request: WorkerRequest) {
  const pages = request.args.pages ?? [1],
    plan = preflightPdf(request.bytes, request.budget, pages);
  const options = {
    data: Uint8Array.from(plan.bytes),
    isEvalSupported: false,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: true,
    verbosity: 0,
    CMapReaderFactory: NoExternalFactory,
    StandardFontDataFactory: NoExternalFactory,
    WasmFactory: NoExternalFactory,
  };
  const task = getDocument(options);
  let bytes = 0,
    items = 0;
  const texts: string[] = [];
  try {
    const document = await task.promise;
    if (document.numPages !== plan.total_pages) fail("CONTENT_UNAVAILABLE");
    for (const index of pages) {
      const page = await document.getPage(index),
        reader = page
          .streamTextContent({ disableNormalization: true })
          .getReader();
      let pageText = "";
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const chunk = record(result.value);
          for (const raw of array(chunk.items, 65536)) {
            const item = record(raw);
            if (
              typeof item.str !== "string" ||
              typeof item.hasEOL !== "boolean"
            )
              fail("CONTENT_UNAVAILABLE");
            if (++items > plan.producerItems) fail("LIMIT_EXCEEDED");
            const piece = item.str + (item.hasEOL ? "\n" : "");
            bytes += Buffer.byteLength(piece);
            if (bytes > request.budget || bytes > plan.producerBytes)
              fail("LIMIT_EXCEEDED");
            pageText += piece;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      texts.push(pageText);
      page.cleanup();
    }
    const text = texts.join("\n\f\n");
    if (Buffer.byteLength(text) > request.budget) fail("LIMIT_EXCEEDED");
    if (!texts.some((s) => /\S/u.test(s))) fail("NO_EXTRACTABLE_TEXT");
    return {
      kind: "pdf" as const,
      text,
      pages: [...pages],
      total_pages: plan.total_pages,
    };
  } finally {
    await task.destroy();
  }
}

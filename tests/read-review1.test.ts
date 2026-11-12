import { afterEach, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { fixture } from "./helpers/received.js";
import { classicPdf, pdfObjects, stream } from "./helpers/extraction.js";
import { preflightPdf } from "../src/extraction-pdf-profile.js";
import { extractPdf } from "../src/extraction-pdf.js";
import * as pdfjs from "pdfjs-dist";
import * as owner from "../src/extraction-owner.js";
afterEach(() => vi.restoreAllMocks());
function afterWorkerStart(action: () => void) {
  const actual = owner.createExtractionWorker;
  let observed = false;
  vi.spyOn(owner, "createExtractionWorker").mockImplementation((request) => {
    const worker = actual(request);
    worker.once("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "started" in message &&
        message.started === true
      ) {
        observed = true;
        action();
      }
    });
    return worker;
  });
  return () => observed;
}
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const malformed = [
  { format: "text", bytes: Buffer.from([192, 175]) },
  { format: "pdf", bytes: Buffer.from("not PDF") },
  { format: "image", bytes: Buffer.from("GIF89a") },
];
it.each(malformed)(
  "TestBR109_fresh_policy review1 configured revoked failed $format",
  async ({ format, bytes }) => {
    const f = await contentFixture({}, bytes),
      c = createNavigationController(f.config, f.dependencies),
      started = afterWorkerStart(() => f.nodes.delete("7:3"));
    try {
      expect(await c.invoke("kdrive_read", { file_id: 3, format })).toEqual(
        contentError("ACCESS_DENIED"),
      );
      expect(started()).toBe(true);
    } finally {
      c.close();
    }
  },
);
it.each(["revocation", "expiry"])(
  "TestBR109_fresh_policy review1 received failed extraction %s",
  async (kind) => {
    const f = await fixture(),
      raw = await contentFixture({}, Buffer.from([192, 175]));
    const started = afterWorkerStart(() => {
      if (kind === "revocation") f.file.capabilities.read = false;
      else {
        f.clock.value = 60000;
        f.received.list.mockImplementation((r) =>
          Promise.resolve({
            ...r,
            status: "complete",
            discover: true,
            terminal: true,
            entries: [],
          }),
        );
      }
    });
    const c = createNavigationController(f.config, {
      ...f.configured,
      execute: f.execute,
      received: f.received,
      content: raw.content,
    });
    try {
      expect(
        await c.invoke("kdrive_read", {
          drive_id: 8,
          file_id: 24,
          format: "text",
        }),
      ).toEqual(contentError("ACCESS_DENIED"));
      expect(started()).toBe(true);
    } finally {
      c.close();
    }
  },
);
it("TestBR109_fresh_policy review1 pre-body version failure still checks final authority", async () => {
  const f = await contentFixture({}, Buffer.from("safe")),
    c = createNavigationController(f.config, f.dependencies);
  f.content.describe.mockImplementation((target) => {
    f.nodes.delete("7:3");
    return Promise.resolve({
      target,
      size_bytes: 4,
      etag: f.etag,
      version_bound: false,
    });
  });
  try {
    expect(
      await c.invoke("kdrive_read", { file_id: 3, format: "text" }),
    ).toEqual(contentError("ACCESS_DENIED"));
    expect(f.content.open).not.toHaveBeenCalled();
  } finally {
    c.close();
  }
});
function malformedPdfs() {
  const high = classicPdf(),
    pos = high.indexOf(Buffer.from("stream\n"));
  high[pos] = high[pos]! | 128;
  const shifted = classicPdf(),
    entry = shifted.indexOf(Buffer.from("0000000009 00000 n"));
  shifted.write("0000000008", entry, "ascii");
  const shiftedXref = classicPdf(),
    str = shiftedXref.toString("latin1"),
    match = /startxref\n(\d+)\n/u.exec(str)!;
  shiftedXref.write(String(Number(match[1]) - 1), match.index + 10, "ascii");
  const root = pdfObjects([
    "<< /Type /Catalog /Pages 3 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 2 0 R >> >> /Contents 4 0 R >>",
    stream(Buffer.from("BT /F1 12 Tf (hello) Tj ET")),
  ]);
  return [
    { name: "high-bit stream", bytes: high },
    { name: "shifted object offset", bytes: shifted },
    { name: "shifted startxref", bytes: shiftedXref },
    { name: "Catalog direct Page", bytes: root },
  ];
}
it.each(malformedPdfs())(
  "TestBR114_pdf_framing review1 refuses $name before PDF.js",
  async ({ bytes }) => {
    const getDocument = vi.mocked(pdfjs.getDocument);
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

it("TestBR116_image_budgets review1 related high-bit PNG framing is never repaired", async () => {
  const [
    { default: png },
    { crc32 },
    { preflightImage },
    { validateExtracted },
  ] = await Promise.all([
    import("@jimp/js-png"),
    import("node:zlib"),
    import("../src/extraction-image.js"),
    import("../src/extraction.js"),
  ]);
  const bytes = Buffer.from(
    png().encode({ width: 1, height: 1, data: Buffer.alloc(4, 255) }),
  );
  bytes[12] = bytes[12]! | 128;
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  expect(() => preflightImage(bytes, 16777216)).toThrow();
  expect(() =>
    validateExtracted(
      { kind: "image", data: Uint8Array.from(bytes), width: 1, height: 1 },
      16777216,
    ),
  ).toThrow("CONTENT_UNAVAILABLE");
});

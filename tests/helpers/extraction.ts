import { deflateSync } from "node:zlib";
export function pdfObjects(objects: (string | Buffer)[], trailer = "") {
  const parts = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let size = parts[0]!.length;
  objects.forEach((object, i) => {
    offsets.push(size);
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(object) ? object : Buffer.from(object),
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    size += part.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  parts.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
export function stream(bytes: Buffer, compressed = false, extra = "") {
  const body = compressed ? deflateSync(bytes) : bytes;
  return Buffer.concat([
    Buffer.from(
      `<< /Length ${body.length} ${compressed ? "/Filter /FlateDecode" : ""} ${extra} >>\nstream\n`,
    ),
    body,
    Buffer.from("\nendstream"),
  ]);
}
export function classicPdf(
  texts = ["Hello bounded PDF"],
  compressed = false,
  content?: string,
) {
  const objects: (string | Buffer)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
    `<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  texts.forEach((text, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objects.push(
      stream(
        Buffer.from(
          content ?? `BT /F1 12 Tf 1 0 0 1 72 720 Tm (${text}) Tj ET`,
        ),
        compressed,
      ),
    );
  });
  return pdfObjects(objects);
}

export function scannedPdf(compressed = false) {
  return pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    stream(Buffer.from("q 10 0 0 10 40 700 cm /Im1 Do Q"), compressed),
    stream(
      Buffer.from([255, 255, 255]),
      compressed,
      "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8",
    ),
  ]);
}

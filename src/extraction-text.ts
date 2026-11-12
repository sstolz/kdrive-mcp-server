import { extractionFail, type ReadArguments } from "./extraction-values.js";
/** BR-112: fatal incremental decoding, one explicit leading BOM, no replacement. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function decodeText(
  bytes: Uint8Array,
  encoding: ReadArguments["encoding"],
  budget: number,
) {
  const bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? "utf-8"
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
        bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : undefined;
  if (encoding && bom && encoding !== bom) extractionFail("INVALID_ENCODING");
  const selected = encoding ?? bom ?? "utf-8",
    // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
    start = bom ? (bom === "utf-8" ? 3 : 2) : 0;
  const decoder = new TextDecoder(selected, { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  let size = 0;
  const append = (part: string) => {
    size += Buffer.byteLength(part);
    if (size > budget) extractionFail("LIMIT_EXCEEDED");
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(part))
      extractionFail("UNSUPPORTED_FORMAT");
    parts.push(part);
  };
  try {
    for (let i = start; i < bytes.length; i += 4096)
      append(
        decoder.decode(bytes.subarray(i, Math.min(i + 4096, bytes.length)), {
          stream: true,
        }),
      );
    append(decoder.decode());
  } catch (error) {
    if (error instanceof ContentFailure) throw error;
    extractionFail("INVALID_ENCODING");
  }
  return { kind: "text" as const, text: parts.join(""), encoding: selected };
}
import { ContentFailure } from "./content.js";

import type { CallToolResult } from "@modelcontextprotocol/server";
import { ContentFailure } from "./content.js";
export function extractionFail(
  code:
    | "LIMIT_EXCEEDED"
    | "CONTENT_UNAVAILABLE"
    | "INVALID_ENCODING"
    | "UNSUPPORTED_FORMAT"
    | "NO_EXTRACTABLE_TEXT"
    | "INVALID_RANGE",
): never {
  throw new ContentFailure(code);
}
export interface ReadArguments {
  format: "text" | "pdf" | "image";
  offset?: number;
  length?: number;
  etag?: string;
  encoding?: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
  pages?: number[];
}
export interface ReadMetadata {
  drive_id: number;
  file_id: number;
  etag: string;
  size_bytes: number;
}
export interface WorkerRequest {
  bytes: Uint8Array;
  args: ReadArguments;
  metadata: ReadMetadata;
  budget: number;
  maxOutputChars: number;
}
export type Extracted =
  | { kind: "text"; text: string; encoding: string }
  | { kind: "pdf"; text: string; pages: number[]; total_pages: number }
  | { kind: "image"; data: Uint8Array; width: number; height: number };
export function resultFits(value: unknown, max: number) {
  const s = JSON.stringify(value);
  return s.length <= max && Buffer.byteLength(s) <= 262144;
}
export function imageResult(
  metadata: ReadMetadata,
  width: number,
  height: number,
  data: Uint8Array,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ...metadata,
          format: "image",
          width,
          height,
          mime_type: "image/png",
        }),
      },
      {
        type: "image",
        mimeType: "image/png",
        data: Buffer.from(data).toString("base64"),
      },
    ],
  };
}

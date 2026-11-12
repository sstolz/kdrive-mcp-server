import { constants } from "node:fs";
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  type DiagnosticSetting,
  type FileReader,
  fail,
} from "./config-schema.js";

class FileLimitError extends Error {}
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
/** Open the selected entry once, bound streaming reads, and reject identity changes. */
export const readBoundedFile: FileReader = async (
  path,
  maximumBytes,
  credential,
) => {
  const before = credential ? await fs.lstat(path) : await fs.stat(path);
  if (!before.isFile()) throw new Error("Invalid file");
  const handle = await fs.open(
    path,
    constants.O_RDONLY |
      constants.O_NONBLOCK |
      (credential ? constants.O_NOFOLLOW : 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened))
      throw new Error("Invalid file");
    if (opened.size > maximumBytes) throw new FileLimitError();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(8192, maximumBytes - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) throw new FileLimitError();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = credential ? await fs.lstat(path) : await fs.stat(path);
    if (!after.isFile() || !sameFile(opened, after))
      throw new Error("Invalid file");
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
};
export async function readSelected(
  reader: FileReader,
  path: string,
  max: number,
  credential: boolean,
  key: DiagnosticSetting,
): Promise<Uint8Array> {
  let value: Uint8Array;
  try {
    value = await reader(path, max, credential);
  } catch (e) {
    if (e instanceof FileLimitError) fail("LIMIT_EXCEEDED", key);
    fail(credential ? "CREDENTIAL_READ_FAILED" : "CONFIG_READ_FAILED", key);
  }
  if (!(value instanceof Uint8Array))
    fail(credential ? "CREDENTIAL_READ_FAILED" : "CONFIG_READ_FAILED", key);
  if (value.byteLength > max) fail("LIMIT_EXCEEDED", key);
  return value;
}
export function decode(
  value: Uint8Array,
  key: DiagnosticSetting,
  credential: boolean,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      value,
    );
  } catch {
    return fail(credential ? "CREDENTIAL_INVALID" : "CONFIG_SYNTAX", key);
  }
}

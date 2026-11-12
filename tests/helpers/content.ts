import { vi } from "vitest";
import type { ContentRange } from "../../src/content.js";
import type { Ref } from "../../src/policy/index.js";
import { navigationFixture } from "./navigation.js";

export const contentError = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});
export interface RawPayload {
  drive_id: number;
  file_id: number;
  offset_bytes: number;
  bytes_read: number;
  size_bytes: number;
  etag: string;
  encoding: string;
  data: string;
  has_more: boolean;
  next_offset_bytes?: number;
}
export function rangeResponse(request: ContentRange, bytes: Buffer) {
  let offset = request.start;
  const body = {
    read: vi.fn((max: number): Promise<unknown> => {
      if (offset > request.end) return Promise.resolve(null);
      const result = bytes.subarray(
        offset,
        Math.min(offset + max, request.end + 1),
      );
      offset += result.length;
      return Promise.resolve(result);
    }),
    close: vi.fn(),
  };
  return { ...request, status: 206, body };
}
export async function contentFixture(
  env: Record<string, string> = {},
  bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5]),
) {
  const f = await navigationFixture(env),
    etag = '"version-1"',
    bodies: ReturnType<typeof rangeResponse>["body"][] = [];
  const content = {
    describe: vi.fn((target: Ref): Promise<unknown> =>
      Promise.resolve({
        target,
        size_bytes: bytes.length,
        etag,
        version_bound: true,
      }),
    ),
    open: vi.fn((request: ContentRange): Promise<unknown> => {
      const result = rangeResponse(request, bytes);
      bodies.push(result.body);
      return Promise.resolve(result);
    }),
  };
  return {
    ...f,
    bytes,
    etag,
    content,
    bodies,
    dependencies: { ...f.dependencies, content },
  };
}

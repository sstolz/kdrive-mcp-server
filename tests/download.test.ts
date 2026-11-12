import { describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { navigationFixture, payload } from "./helpers/navigation.js";

describe("bounded raw content", () => {
  it("TestBR083_binary_continuation reconstructs independently encoded chunks", async () => {
    const f = await navigationFixture();
    const bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5]);
    const etag = '"version-1"';
    const content = {
      describe: vi.fn(async (target: { driveId: number; id: number }) => ({
        target: await Promise.resolve(target),
        size_bytes: bytes.length,
        etag,
        version_bound: true,
      })),
      open: vi.fn(
        async (request: {
          target: { driveId: number; id: number };
          start: number;
          end: number;
          size_bytes: number;
          etag: string;
        }) => {
          await Promise.resolve();
          let offset = request.start;
          return {
            ...request,
            status: 206,
            body: {
              read: vi.fn(async (max: number) => {
                await Promise.resolve();
                if (offset > request.end) return null;
                const result = bytes.subarray(
                  offset,
                  Math.min(offset + max, request.end + 1),
                );
                offset += result.length;
                return result;
              }),
              close: vi.fn(),
            },
          };
        },
      ),
    };
    const controller = createNavigationController(f.config, {
      ...f.dependencies,
      content,
    });
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const result = await controller.invoke("kdrive_download", {
        file_id: 3,
        offset_bytes: offset,
        length_bytes: 2,
        ...(offset ? { etag } : {}),
      });
      expect(result.isError).toBeUndefined();
      const data = payload(result) as {
        data: string;
        next_offset_bytes?: number;
        has_more: boolean;
      };
      chunks.push(Buffer.from(data.data, "base64"));
      offset = data.next_offset_bytes ?? bytes.length;
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(content.open).toHaveBeenCalledTimes(4);
    controller.close();
  });
  it("TestBR082_surface_policy_agreement denies before protected content", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_DENY: "/docs/**" });
    const content = { describe: vi.fn(), open: vi.fn() };
    const controller = createNavigationController(f.config, {
      ...f.dependencies,
      content,
    });
    expect(await controller.invoke("kdrive_download", { file_id: 3 })).toEqual({
      isError: true,
      content: [{ type: "text", text: "ACCESS_DENIED" }],
    });
    expect(content.describe).not.toHaveBeenCalled();
    controller.close();
  });
  it("TestBR092_missing_content_port fails explicitly after authorization", async () => {
    const f = await navigationFixture();
    const controller = createNavigationController(f.config, f.dependencies);
    expect(await controller.invoke("kdrive_download", { file_id: 3 })).toEqual({
      isError: true,
      content: [{ type: "text", text: "CONTENT_UNAVAILABLE" }],
    });
    controller.close();
  });
});

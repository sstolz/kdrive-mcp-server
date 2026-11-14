import { expect, it } from "vitest";
import { decodePng, encodePng } from "./helpers/image-codecs.js";
import { contentFixture } from "./helpers/content.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";
it("TestBR116_complete_images actual SDK has one valid image block and preserves raw resource", async () => {
  const bytes = encodePng({
      width: 2,
      height: 1,
      data: Buffer.alloc(8, 255),
    }),
    f = await contentFixture({}, Buffer.from(bytes)),
    w = await createWire(f.config, f.dependencies);
  try {
    w.send(initialize);
    await w.read(1);
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    w.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "kdrive_read",
        arguments: { file_id: 3, format: "image" },
      },
    });
    const result = (await w.read(2)).result as {
      isError?: boolean;
      content: { type: string; data?: string; text?: string }[];
    };
    expect(result.isError).toBeUndefined();
    expect(result.content.map((c) => c.type)).toEqual(["text", "image"]);
    const base64 = result.content[1]!.data!;
    expect(Buffer.from(base64, "base64").toString("base64")).toBe(base64);
    const image = decodePng(Buffer.from(base64, "base64"));
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      262144,
    );
    w.send({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "kdrive://7/file/3" },
    });
    expect((await w.read(3)).result).toMatchObject({
      contents: [
        {
          mimeType: "application/octet-stream",
          blob: bytes.toString("base64"),
        },
      ],
    });
    expect(w.stderr()).toBe("");
  } finally {
    await w.session.close();
  }
});
it("TestBR120_redaction actual SDK preserves extraction tool errors only", async () => {
  const f = await contentFixture({}, Buffer.from([192, 175])),
    w = await createWire(f.config, f.dependencies);
  try {
    w.send(initialize);
    await w.read(1);
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    w.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "kdrive_read",
        arguments: { file_id: 3, format: "text" },
      },
    });
    expect((await w.read(2)).result).toEqual({
      isError: true,
      content: [{ type: "text", text: "INVALID_ENCODING" }],
    });
    expect(w.stderr()).toBe("");
  } finally {
    await w.session.close();
  }
});

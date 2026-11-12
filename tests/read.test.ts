import { expect, it } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { payload } from "./helpers/navigation.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";

it("TestBR110_code_point_continuation reads whole versions with Unicode offsets", async () => {
  const text = "A😀é\r\n";
  const f = await contentFixture({}, Buffer.from(text));
  const c = createNavigationController(f.config, f.dependencies);
  try {
    let offset = 0,
      reconstructed = "";
    for (const codePoint of text) {
      const result = await c.invoke("kdrive_read", {
        file_id: 3,
        format: "text",
        offset,
        length: 1,
        ...(offset ? { etag: f.etag } : {}),
      });
      expect(result.isError).toBeUndefined();
      const value = payload(result) as {
        text: string;
        characters_read: number;
        total_characters: number;
        next_offset?: number;
        has_more: boolean;
      };
      expect(value.text).toBe(codePoint);
      expect(value.characters_read).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- F-011: code-point iteration of the string is intended
      expect(value.total_characters).toBe([...text].length);
      reconstructed += value.text;
      offset++;
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- F-011: code-point iteration of the string is intended
      expect(value.has_more).toBe(offset < [...text].length);
    }
    expect(reconstructed).toBe(text);
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- F-011: code-point iteration of the string is intended
    expect(f.content.open).toHaveBeenCalledTimes([...text].length);
    expect(f.bodies.every((body) => body.close.mock.calls.length === 1)).toBe(
      true,
    );
  } finally {
    c.close();
  }
});
it("TestBR123_missing_content keeps policy denial before unavailable", async () => {
  const f = await contentFixture();
  const c = createNavigationController(f.config, {
    inspect: f.inspect,
    collection: f.collection,
    children: f.children,
    execute: f.execute,
  });
  try {
    expect(
      await c.invoke("kdrive_read", { file_id: 3, format: "text" }),
    ).toEqual(contentError("CONTENT_UNAVAILABLE"));
    expect(
      await c.invoke("kdrive_read", { file_id: 999, format: "text" }),
    ).toEqual(contentError("ACCESS_DENIED"));
  } finally {
    c.close();
  }
});
it("TestBR060_v4_registration bounded actual SDK text sample", async () => {
  const f = await contentFixture({}, Buffer.from("SDK 😀 sample"));
  const w = await createWire(f.config, f.dependencies);
  try {
    w.send(initialize);
    await w.read(1);
    w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    w.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(
      ((await w.read(2)).result as { tools: unknown[] }).tools,
    ).toHaveLength(10);
    w.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "kdrive_read",
        arguments: { file_id: 3, format: "text" },
      },
    });
    const result = (await w.read(3)).result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      text: "SDK 😀 sample",
      has_more: false,
      encoding: "utf-8",
    });
    expect(w.stderr()).toBe("");
  } finally {
    await w.session.close();
  }
});

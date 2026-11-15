import { expect, it } from "vitest";
import { createNavigationController } from "../src/navigation.js";
import { mutationOperation, mutationSchemas } from "../src/mutation-tools.js";
import { contentError, contentFixture } from "./helpers/content.js";
import { classicPdf } from "./helpers/extraction.js";
import { decodePng, encodePng } from "./helpers/image-codecs.js";
import { navigationFixture, payload } from "./helpers/navigation.js";
import {
  connectedCatalog,
  dictionary,
  expectedDescription,
} from "./helpers/tool-description-catalog.js";

const imageBytes = () =>
  encodePng({ width: 2, height: 1, data: Buffer.alloc(8, 255) });
type Result = {
  text?: string;
  data?: string;
  etag: string;
  has_more?: boolean;
  next_cursor?: string;
  next_offset?: number;
  next_offset_bytes?: number;
  characters_read?: number;
  bytes_read?: number;
};

it.each(["kdrive_list", "kdrive_search", "kdrive_recents", "kdrive_my_shared"])(
  "TestBR428_AC04_guidance_matches_continuation_results empty page [%s]",
  async (tool) => {
    const f = await navigationFixture();
    let calls = 0;
    f.collection.mockImplementation(async (request) => ({
      ...(await Promise.resolve(request)),
      status: "complete",
      entries: [],
      ...(++calls === 7 ? { terminal: true } : { next: String(calls) }),
    }));
    const c = createNavigationController(f.config, f.dependencies);
    const args = {
      folder_id: 1,
      ...(tool === "kdrive_search" ? { query: "q" } : {}),
    };
    try {
      const first = payload(await c.invoke(tool, args)) as Result;
      expect(first).toEqual({
        items: [],
        has_more: true,
        next_cursor: first.next_cursor,
      });
      expect(typeof first.next_cursor).toBe("string");
      expect(calls).toBe(5);
      const last = payload(
        await c.invoke(tool, { ...args, cursor: first.next_cursor }),
      );
      expect(last).toEqual({ items: [], has_more: false });
      expect(calls).toBe(7);
    } finally {
      c.close();
    }
  },
);

it("TestBR428_AC04_guidance_matches_continuation_results Unicode code points", async () => {
  const f = await contentFixture({}, Buffer.from("A😀B"));
  const c = createNavigationController(f.config, f.dependencies);
  try {
    let offset = 0;
    let etag: string | undefined;
    let reconstructed = "";
    for (const [index, text] of ["A", "😀", "B"].entries()) {
      const answer = await c.invoke("kdrive_read", {
        file_id: 3,
        format: "text",
        length: 1,
        offset,
        ...(etag === undefined ? {} : { etag }),
      });
      expect(answer.isError).toBeUndefined();
      const part = payload(answer) as Result;
      expect(part).toMatchObject({
        text,
        characters_read: 1,
        etag: f.etag,
        has_more: index < 2,
      });
      reconstructed += part.text;
      etag = part.etag;
      if (index < 2) {
        expect(part.next_offset).toBe(index + 1);
        offset = part.next_offset!;
      } else {
        expect(part).not.toHaveProperty("next_offset");
      }
      expect(part).not.toHaveProperty("next_cursor");
    }
    expect(reconstructed).toBe("A😀B");
  } finally {
    c.close();
  }
});

it("TestBR428_AC04_guidance_matches_continuation_results raw bytes", async () => {
  const bytes = Buffer.from([0, 255, 65]);
  const f = await contentFixture({}, bytes);
  const c = createNavigationController(f.config, f.dependencies);
  try {
    let offset = 0;
    let etag: string | undefined;
    const chunks: Buffer[] = [];
    for (let index = 0; index < 3; index++) {
      const answer = await c.invoke("kdrive_download", {
        file_id: 3,
        length_bytes: 1,
        offset_bytes: offset,
        ...(etag === undefined ? {} : { etag }),
      });
      expect(answer.isError).toBeUndefined();
      const part = payload(answer) as Result;
      expect(part).toMatchObject({
        bytes_read: 1,
        etag: f.etag,
        has_more: index < 2,
      });
      chunks.push(Buffer.from(part.data!, "base64"));
      etag = part.etag;
      if (index < 2) {
        expect(part.next_offset_bytes).toBe(index + 1);
        offset = part.next_offset_bytes!;
      } else {
        expect(part).not.toHaveProperty("next_offset_bytes");
      }
      expect(part).not.toHaveProperty("next_cursor");
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
  } finally {
    c.close();
  }
});

it("TestBR428_AC04_guidance_matches_continuation_results image", async () => {
  const f = await contentFixture({}, Buffer.from(imageBytes()));
  const c = createNavigationController(f.config, f.dependencies);
  try {
    const answer = await c.invoke("kdrive_read", {
      file_id: 3,
      format: "image",
    });
    expect(answer.isError).toBeUndefined();
    expect(answer.content.map((block) => block.type)).toEqual([
      "text",
      "image",
    ]);
    const metadata = payload(answer) as Result;
    expect(metadata).toMatchObject({ etag: f.etag });
    for (const key of ["next_cursor", "next_offset", "next_offset_bytes"])
      expect(metadata).not.toHaveProperty(key);
    const image = answer.content[1];
    expect(image?.type).toBe("image");
    if (image?.type !== "image") throw Error("Missing image");
    expect(image.mimeType).toBe("image/png");
    const decoded = decodePng(Buffer.from(image.data, "base64"));
    expect([decoded.width, decoded.height]).toEqual([2, 1]);
  } finally {
    c.close();
  }
});

it("TestBR428_AC04_guidance_matches_continuation_results", async () => {
  const h = await connectedCatalog("read");
  try {
    const { tools } = await h.client.listTools();
    for (const name of [
      "kdrive_list",
      "kdrive_search",
      "kdrive_recents",
      "kdrive_my_shared",
      "kdrive_shared_with_me",
      "kdrive_read",
      "kdrive_download",
    ])
      expect(tools.find((tool) => tool.name === name)?.description).toBe(
        expectedDescription(name),
      );
  } finally {
    await h.close();
  }
});

const readCases: {
  label: string;
  format: "text" | "pdf" | "image";
  args: Record<string, unknown>;
  valid: boolean;
}[] = [];
for (const format of ["text", "pdf"] as const) {
  for (const offset of [undefined, 0, 1]) {
    readCases.push({
      label: `${format} offset ${String(offset)} no etag`,
      format,
      args: offset === undefined ? {} : { offset },
      valid: offset !== 1,
    });
    readCases.push({
      label: `${format} offset ${String(offset)} with etag`,
      format,
      args: {
        ...(offset === undefined ? {} : { offset }),
        etag: '"version-1"',
      },
      valid: true,
    });
  }
}
for (const format of ["text", "pdf", "image"] as const)
  readCases.push({
    label: `${format} encoding`,
    format,
    args: { encoding: "utf-8" },
    valid: format === "text",
  });
for (const pages of [
  [1],
  [1, 2],
  [],
  [1, 1],
  [2, 1],
  [0],
  Array.from({ length: 11 }, (_, i) => i + 1),
])
  readCases.push({
    label: `pdf pages ${JSON.stringify(pages)}`,
    format: "pdf",
    args: { pages },
    valid: JSON.stringify(pages) === "[1]" || JSON.stringify(pages) === "[1,2]",
  });
readCases.push({
  label: "text forbids pages",
  format: "text",
  args: { pages: [1] },
  valid: false,
});
for (const args of [
  { offset: 0 },
  { offset: 1 },
  { length: 1 },
  { pages: [1] },
])
  readCases.push({
    label: `image forbids ${JSON.stringify(args)}`,
    format: "image",
    args,
    valid: false,
  });
readCases.push(
  { label: "image no optional fields", format: "image", args: {}, valid: true },
  {
    label: "image valid etag",
    format: "image",
    args: { etag: '"version-1"' },
    valid: true,
  },
);

it.each(readCases)(
  "TestBR429_AC05_cross_field_descriptions_match_validation [$label]",
  async ({ format, args, valid }) => {
    const bytes =
      format === "pdf"
        ? classicPdf(["AB", "CD"])
        : format === "image"
          ? imageBytes()
          : Buffer.from("A😀B");
    const f = await contentFixture({}, Buffer.from(bytes));
    const c = createNavigationController(f.config, f.dependencies);
    try {
      const result = await c.invoke("kdrive_read", {
        file_id: 3,
        format,
        ...args,
      });
      if (valid) {
        expect(result.isError).toBeUndefined();
        expect(f.content.open).toHaveBeenCalled();
        expect(payload(result)).toMatchObject({ etag: f.etag });
      } else {
        expect(result).toEqual(contentError("INVALID_ARGUMENTS"));
        expect(f.inspect).not.toHaveBeenCalled();
        expect(f.content.describe).not.toHaveBeenCalled();
        expect(f.content.open).not.toHaveBeenCalled();
      }
    } finally {
      c.close();
    }
  },
);

it.each([
  { label: "omitted", args: {}, valid: true },
  { label: "zero", args: { offset_bytes: 0 }, valid: true },
  { label: "one without etag", args: { offset_bytes: 1 }, valid: false },
  {
    label: "one with etag",
    args: { offset_bytes: 1, etag: '"version-1"' },
    valid: true,
  },
])(
  "TestBR429_AC05_cross_field_descriptions_match_validation [download $label]",
  async ({ args, valid }) => {
    const f = await contentFixture();
    const c = createNavigationController(f.config, f.dependencies);
    try {
      const result = await c.invoke("kdrive_download", { file_id: 3, ...args });
      if (valid) {
        expect(result.isError).toBeUndefined();
        expect(payload(result)).toMatchObject({ etag: f.etag });
        expect(f.content.open).toHaveBeenCalled();
      } else {
        expect(result).toEqual(contentError("INVALID_ARGUMENTS"));
        expect(f.inspect).not.toHaveBeenCalled();
        expect(f.content.describe).not.toHaveBeenCalled();
        expect(f.content.open).not.toHaveBeenCalled();
      }
    } finally {
      c.close();
    }
  },
);

function checkUploadCombination(
  content: Record<string, string>,
  overwrite: boolean | undefined,
  fileId: number | undefined,
) {
  const args = {
    parent_id: 2,
    name: "a",
    ...content,
    ...(overwrite === undefined ? {} : { overwrite }),
    ...(fileId === undefined ? {} : { file_id: fileId }),
  };
  const validContent = Object.keys(content).length === 1;
  const valid = validContent && (fileId !== undefined) === (overwrite === true);
  const parsed = mutationSchemas.kdrive_upload.safeParse(args);
  expect(parsed.success, JSON.stringify(args)).toBe(valid);
  if (parsed.success) {
    expect(mutationOperation("kdrive_upload", parsed.data, 7)).toEqual({
      kind: overwrite === true ? "replace" : "upload-new",
      destination: { driveId: 7, id: 2 },
      name: "a",
      ...(overwrite === true ? { target: { driveId: 7, id: 3 } } : {}),
    });
  }
}

it("TestBR429_AC05_cross_field_descriptions_match_validation upload matrix", () => {
  const contents = [
    { text: "hello" },
    { text: "" },
    { base64: "YQ==" },
    { base64: "" },
    {},
    { text: "", base64: "" },
  ];
  for (const content of contents)
    for (const overwrite of [undefined, false, true])
      for (const fileId of [undefined, 3]) {
        checkUploadCombination(content, overwrite, fileId);
      }
});

it("TestBR429_AC05_cross_field_descriptions_match_validation", async () => {
  const h = await connectedCatalog("write");
  try {
    const { tools } = await h.client.listTools();
    for (const [name, properties] of Object.entries({
      kdrive_read: {
        format: "F",
        offset: "O",
        etag: "E",
        encoding: "EN",
        pages: "P",
      },
      kdrive_download: { offset_bytes: "OB", etag: "EB" },
      kdrive_upload: {
        text: "TEXT",
        base64: "B64",
        overwrite: "OW",
        file_id: "FU",
      },
    })) {
      const tool = tools.find((item) => item.name === name);
      const published = tool?.inputSchema.properties as Record<
        string,
        { description?: string }
      >;
      for (const [property, key] of Object.entries(properties))
        expect(published[property]?.description, `${name}.${property}`).toBe(
          dictionary[key],
        );
    }
  } finally {
    await h.close();
  }
});

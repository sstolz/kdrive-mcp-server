// F-042 BR-429: observable validation/default controls remain green before metadata edits.
import { isDeepStrictEqual } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  createNavigationController,
  createNavigationServer,
} from "../src/navigation.js";
import {
  mutationSchemas,
  mutationOperation,
  uploadContent,
} from "../src/mutation-tools.js";
import { navigationFixture, payload, plainItem } from "./helpers/navigation.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { classicPdf } from "./helpers/extraction.js";
import { fixture as receivedFixture } from "./helpers/received.js";
import {
  bindings,
  dictionary,
  connectedCatalog,
} from "./helpers/tool-description-catalog.js";

afterEach(() => vi.restoreAllMocks());
const invalid = contentError("INVALID_ARGUMENTS");
const baseArguments: Record<string, Record<string, unknown>> = {
  kdrive_list_drives: {},
  kdrive_list: { folder_id: 1 },
  kdrive_search: { query: "q" },
  kdrive_recents: {},
  kdrive_my_shared: {},
  kdrive_shared_with_me: {},
  kdrive_info: { file_id: 3 },
  kdrive_read: { file_id: 3, format: "text", etag: '"v"' },
  kdrive_download: { file_id: 3, etag: '"v"' },
  kdrive_resolve_path: { path: "/" },
  kdrive_create_folder: { parent_id: 1, name: "x" },
  kdrive_rename: { file_id: 3, name: "x" },
  kdrive_move: { file_id: 3, destination_folder_id: 1 },
  kdrive_trash: { file_id: 3 },
  kdrive_restore: { file_id: 3 },
  kdrive_upload: { parent_id: 1, name: "x", text: "" },
};

it("TestBR429_AC06_bounds_and_defaults_match_validation", async () => {
  const c = await connectedCatalog("write");
  try {
    const listing = await c.client.listTools();
    // Independent dictionary literals name the limits measured by the controls below.
    for (const tool of listing.tools) {
      const properties = tool.inputSchema.properties as Record<
        string,
        { description?: string }
      >;
      for (const [property, key] of Object.entries(bindings[tool.name]!)) {
        if (property === "pages.items") continue;
        expect(
          properties[property]?.description,
          `${tool.name}.${property}`,
        ).toBe(dictionary[key]);
      }
    }
  } finally {
    await c.close();
  }
});

async function checkNumericRegistration(
  client: Client,
  toolName: string,
  property: string,
  minimum: number,
) {
  for (const [value, valid] of [
    [minimum, true],
    [Number.MAX_SAFE_INTEGER, true],
    [minimum - 1, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
    [minimum + 0.5, false],
  ] as const) {
    const args = {
      ...baseArguments[toolName],
      [property]: property === "pages" ? [value] : value,
    };
    if (property === "pages") args.format = "pdf";
    if (toolName === "kdrive_upload" && property === "file_id")
      args.overwrite = true;
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    const text = (result.content as { text: string }[])[0]!.text;
    expect(
      text.startsWith("Input validation error:"),
      `${toolName}.${property}=${value}`,
    ).toBe(!valid);
  }
}

it("TestBR429_AC06_numeric_minimum_maximum_outside_and_fraction_registration_controls", async () => {
  const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
  const server = createNavigationServer(f.config, f.dependencies);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "numeric-boundary", version: "1" });
  await client.connect(a);
  try {
    let checked = 0;
    for (const tool of (await client.listTools()).tools) {
      const properties = tool.inputSchema.properties as Record<
        string,
        {
          type?: string;
          minimum?: number;
          maximum?: number;
          items?: { type?: string; minimum?: number; maximum?: number };
        }
      >;
      for (const [property, original] of Object.entries(properties)) {
        const schema = property === "pages" ? original.items : original;
        if (schema?.type !== "integer") continue;
        const minimum =
          property === "offset" || property === "offset_bytes" ? 0 : 1;
        expect(schema.minimum).toBe(minimum);
        expect(schema.maximum).toBe(Number.MAX_SAFE_INTEGER);
        await checkNumericRegistration(client, tool.name, property, minimum);
        checked++;
      }
    }
    expect(checked).toBe(36); // Includes every repeated numeric property and pages.items.
  } finally {
    await client.close();
    await server.close();
  }
});

function expectArgumentValidation(result: unknown, valid: boolean) {
  expect(isDeepStrictEqual(result, invalid)).toBe(!valid);
}

it("TestBR429_AC06_query_path_name_and_etag_boundary_controls", async () => {
  const f = await navigationFixture();
  const c = createNavigationController(f.config, f.dependencies);
  try {
    for (const [query, valid] of [
      ["a", true],
      ["é".repeat(2048), true],
      ["", false],
      ["é".repeat(2048) + "a", false],
    ] as const) {
      const result = await c.invoke("kdrive_search", { query });
      if (valid) expect(result.isError).toBeUndefined();
      else expect(result).toEqual(invalid);
    }
    for (const [path, valid] of [
      ["/", true],
      ["/" + "a".repeat(4095), true],
      ["/" + "a".repeat(4096), false],
      ["/" + Array(64).fill("a").join("/"), true],
      ["/" + Array(65).fill("a").join("/"), false],
      ...[
        "relative",
        "/a//b",
        "/a/./b",
        "/a/../b",
        "/a/",
        "/a\\b",
        "/a\u0000",
        "/a\u001f",
        "/a\u007f",
      ].map((path) => [path, false] as const),
    ] as const) {
      const result = await c.invoke("kdrive_resolve_path", { path });
      expectArgumentValidation(result, valid);
    }
    for (const tool of [
      "kdrive_create_folder",
      "kdrive_rename",
      "kdrive_upload",
    ] as const) {
      for (const [name, valid] of [
        ["a", true],
        ["é".repeat(2048), true],
        ["", false],
        ["é".repeat(2048) + "a", false],
        ...[
          " a",
          "a ",
          "e\u0301",
          "\ud800",
          ".",
          "..",
          "a/b",
          "a\\b",
          "a\u0000",
          "a\u001f",
          "a\u007f",
        ].map((name) => [name, false] as const),
      ] as const)
        expect(
          mutationSchemas[tool].safeParse({ ...baseArguments[tool], name })
            .success,
          `${tool}: ${JSON.stringify(name.slice(0, 10))}`,
        ).toBe(valid);
    }
    for (const tool of ["kdrive_read", "kdrive_download"]) {
      for (const [etag, valid] of [
        ['"a"', true],
        ['"' + "a".repeat(254) + '"', true],
        ['""', false],
        ['"' + "a".repeat(255) + '"', false],
        ['"a b"', false],
        ['"a"b"', false],
        ['W/"a"', false],
      ] as const) {
        const result = await c.invoke(tool, { ...baseArguments[tool], etag });
        expectArgumentValidation(result, valid);
      }
    }
  } finally {
    c.close();
  }
});

it("TestBR429_AC06_upload_encoding_and_decoded_size_controls", () => {
  for (const size of [0, 524288, 524289]) {
    for (const args of [
      { text: "a".repeat(size) },
      { base64: Buffer.alloc(size, 97).toString("base64") },
    ]) {
      const result = uploadContent(args);
      if (size > 524288) expect(result).toEqual({ code: "LIMIT_EXCEEDED" });
      else {
        expect("bytes" in result).toBe(true);
        if ("bytes" in result) expect(result.bytes).toHaveLength(size);
      }
    }
  }
  for (const base64 of [
    "YQ",
    "YR==",
    " YQ==",
    "YQ==\n",
    "-w==",
    "_w==",
    "!" + "A".repeat(699052),
  ])
    expect(uploadContent({ base64 })).toEqual({ code: "INVALID_ARGUMENTS" });
  expect(uploadContent({ text: "a".repeat(524289) + "\ud800" })).toEqual({
    code: "INVALID_ARGUMENTS",
  });
});

it("TestBR429_AC06_text_and_raw_default_controls", async () => {
  const cases = [
    { bytes: Buffer.from("A😀B"), encoding: "utf-8", text: "A😀B" },
    {
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("A😀B"),
      ]),
      encoding: "utf-8",
      text: "A😀B",
    },
    {
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("AB", "utf16le"),
      ]),
      encoding: "utf-16le",
      text: "AB",
    },
    {
      bytes: Buffer.from([0xfe, 0xff, 0, 65, 0, 66]),
      encoding: "utf-16be",
      text: "AB",
    },
  ];
  for (const row of cases) {
    const f = await contentFixture({}, row.bytes),
      c = createNavigationController(f.config, f.dependencies);
    try {
      expect(
        payload(await c.invoke("kdrive_read", { file_id: 3, format: "text" })),
      ).toMatchObject({ text: row.text, encoding: row.encoding });
      if (row.encoding !== "utf-8")
        expect(
          await c.invoke("kdrive_read", {
            file_id: 3,
            format: "text",
            encoding: "utf-8",
          }),
        ).toEqual(contentError("INVALID_ENCODING"));
      if (row.text === "A😀B")
        for (const [length, text] of [
          [1, "A"],
          [2, "A😀"],
        ] as const)
          expect(
            payload(
              await c.invoke("kdrive_read", {
                file_id: 3,
                format: "text",
                length,
              }),
            ),
          ).toMatchObject({
            text,
            characters_read: length,
            has_more: true,
            next_offset: length,
          });
    } finally {
      c.close();
    }
  }
  const bounded = await contentFixture(
    { KDRIVE_MCP_MAX_OUTPUT_CHARS: "512" },
    Buffer.from("x".repeat(2000)),
  );
  const bc = createNavigationController(bounded.config, bounded.dependencies);
  try {
    const value = payload(
      await bc.invoke("kdrive_read", {
        file_id: 3,
        format: "text",
        length: 2000,
      }),
    ) as {
      text: string;
      characters_read: number;
      next_offset: number;
      has_more: boolean;
    };
    expect(value.characters_read).toBeGreaterThan(0);
    expect(value.characters_read).toBeLessThan(2000);
    expect(value.text).toHaveLength(value.characters_read);
    expect(value.next_offset).toBe(value.characters_read);
    expect(value.has_more).toBe(true);
  } finally {
    bc.close();
  }
  const f = await contentFixture(
    { KDRIVE_MCP_MAX_READ_BYTES: "3" },
    Buffer.from("abcdef"),
  );
  const c = createNavigationController(f.config, f.dependencies);
  try {
    const omitted = await c.invoke("kdrive_download", { file_id: 3 });
    expect(omitted.isError).toBeUndefined();
    expect(omitted).toEqual(
      await c.invoke("kdrive_download", { file_id: 3, length_bytes: 3 }),
    );
    expect(payload(omitted)).toMatchObject({
      bytes_read: 3,
      has_more: true,
      next_offset_bytes: 3,
    });
    vi.clearAllMocks();
    expect(
      await c.invoke("kdrive_download", { file_id: 3, length_bytes: 4 }),
    ).toEqual(contentError("LIMIT_EXCEEDED"));
    for (const port of [
      f.inspect,
      f.collection,
      f.children,
      f.execute,
      f.content.describe,
      f.content.open,
    ])
      expect(port).not.toHaveBeenCalled();
  } finally {
    c.close();
  }
});

it("TestBR429_AC06_PDF_default_page_control", async () => {
  const pdf = await contentFixture(
    {},
    classicPdf(["First page", "Second page"]),
  );
  const pc = createNavigationController(pdf.config, pdf.dependencies);
  try {
    const omitted = await pc.invoke("kdrive_read", {
      file_id: 3,
      format: "pdf",
    });
    expect(omitted.isError).toBeUndefined();
    expect(omitted).toEqual(
      await pc.invoke("kdrive_read", { file_id: 3, format: "pdf", pages: [1] }),
    );
    expect(payload(omitted)).toMatchObject({ text: "First page" });
  } finally {
    pc.close();
  }
});

it("TestBR429_AC06_drive_scope_and_type_omission_controls", async () => {
  const f = await navigationFixture(),
    c = createNavigationController(f.config, f.dependencies);
  try {
    const drives = payload(await c.invoke("kdrive_list_drives", {})) as {
      drives: { drive_id: number }[];
    };
    expect(drives.drives.map((d) => d.drive_id)).toEqual([7, 9]);
    expect(
      payload(await c.invoke("kdrive_info", { file_id: 3 })),
    ).toMatchObject({ item: { drive_id: 7, id: 3 } });
    const listing = payload(
      await c.invoke("kdrive_list", { folder_id: 1 }),
    ) as { items: { type: string }[] };
    expect(listing.items.map((i) => i.type).sort()).toEqual(["dir", "file"]);
    for (const tool of [
      "kdrive_search",
      "kdrive_recents",
      "kdrive_my_shared",
    ]) {
      f.collection.mockClear();
      const result = await c.invoke(
        tool,
        tool === "kdrive_search" ? { query: "q" } : {},
      );
      expect(result.isError).toBeUndefined();
      expect(f.collection.mock.calls.length).toBeGreaterThan(0);
      for (const [request] of f.collection.mock.calls)
        expect(request.scope).toEqual({ driveId: 7, id: 1 });
      expect(
        (
          await c.invoke(tool, {
            folder_id: 2,
            ...(tool === "kdrive_search" ? { query: "q" } : {}),
          })
        ).isError,
      ).toBeUndefined();
    }
    for (const tool of Object.keys(
      mutationSchemas,
    ) as (keyof typeof mutationSchemas)[]) {
      const parsed = mutationSchemas[tool].parse(baseArguments[tool]);
      const operation = mutationOperation(tool, parsed, 7);
      expect(JSON.stringify(operation)).toContain('"driveId":7');
      expect(JSON.stringify(operation)).not.toContain('"driveId":9');
    }
  } finally {
    c.close();
  }
});

it("TestBR429_AC06_received_discovery_and_configured_only_route_controls", async () => {
  const r = await receivedFixture(),
    f = await navigationFixture({ KDRIVE_MCP_SHARED_WITH_ME: "1" });
  const secondAnchor = {
    ...r.anchor,
    driveId: 10,
    id: 30,
    anchorId: 30,
    name: "Other",
    path: "/Shared/Other",
    parents: [],
  };
  r.items.set("live:10:30", secondAnchor);
  r.received.list.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [r.anchor, secondAnchor],
    terminal: true,
    discover: true,
  }));
  const c = createNavigationController(f.config, {
    ...f.dependencies,
    received: r.received,
  });
  try {
    const discovered = payload(await c.invoke("kdrive_shared_with_me", {})) as {
      items: { drive_id: number }[];
    };
    expect(
      discovered.items.map((i) => i.drive_id).sort((a, b) => a - b),
    ).toEqual([8, 10]);
    for (const tool of ["kdrive_recents", "kdrive_my_shared"]) {
      expect(await c.invoke(tool, { drive_id: 8, folder_id: 22 })).toEqual(
        contentError("ACCESS_DENIED"),
      );
      expect(
        (await c.invoke(tool, { drive_id: 7, folder_id: 2 })).isError,
      ).toBeUndefined();
    }
    for (const tool of ["kdrive_list", "kdrive_search"]) {
      expect(
        (
          await c.invoke(tool, {
            drive_id: 8,
            folder_id: 22,
            ...(tool === "kdrive_search" ? { query: "q" } : {}),
          })
        ).isError,
      ).toBeUndefined();
      expect(r.received.collection).toHaveBeenCalled();
    }
  } finally {
    c.close();
  }
});

it("TestBR429_AC06_cursor_single_use_binding_grammar_and_expiry_controls", async () => {
  const f = await navigationFixture();
  let now = 0,
    n = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  f.collection.mockImplementation(async (request) => ({
    ...(await Promise.resolve(request)),
    status: "complete",
    entries: [plainItem(100 + n, "/x" + n++, "file", [f.root])],
    next: String(n),
  }));
  const c = createNavigationController(f.config, f.dependencies);
  const page = async (args: Record<string, unknown>) =>
    payload(await c.invoke("kdrive_list", args)) as { next_cursor: string };
  try {
    const first = await page({ folder_id: 1 });
    expect(first.next_cursor).toBeTypeOf("string");
    for (const cursor of ["malformed", "v2.x"])
      expect(await c.invoke("kdrive_list", { folder_id: 1, cursor })).toEqual(
        contentError("INVALID_CURSOR"),
      );
    expect(
      await c.invoke("kdrive_list", {
        folder_id: 2,
        cursor: first.next_cursor,
      }),
    ).toEqual(contentError("INVALID_CURSOR"));
    expect(
      await c.invoke("kdrive_search", {
        query: "q",
        cursor: first.next_cursor,
      }),
    ).toEqual(contentError("INVALID_CURSOR"));
    now = 299999;
    const second = await page({ folder_id: 1, cursor: first.next_cursor });
    expect(second.next_cursor).toBeTypeOf("string");
    expect(
      await c.invoke("kdrive_list", {
        folder_id: 1,
        cursor: first.next_cursor,
      }),
    ).toEqual(contentError("INVALID_CURSOR"));
    now = 300000;
    expect(
      await c.invoke("kdrive_list", {
        folder_id: 1,
        cursor: second.next_cursor,
      }),
    ).toEqual(contentError("INVALID_CURSOR"));
  } finally {
    c.close();
  }
});

import { expect, it, vi } from "vitest";
import * as zlib from "node:zlib";
import {
  CATALOG,
  HELV,
  L,
  PAGES,
  T,
  a85,
  ahx,
  flate,
  onePage,
  pageDict,
  pdf,
  predictUp,
  stm,
  textOf,
  toUnicode,
  type Body,
} from "./helpers/pdf-corpus.js";
import { refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
vi.mock("node:zlib", async (original) => {
  const actual = await original<typeof import("node:zlib")>();
  return { ...actual, inflateSync: vi.fn(actual.inflateSync) };
});
/** Text plus dropped path operators, so decoded bytes dominate every other bound. */
const padded = (bytes: number) => {
  const head = `${textOf(T)}\n`,
    room = bytes - head.length;
  return head + "0 0 m ".repeat(Math.floor(room / 6)) + " ".repeat(room % 6);
};
const predicted = (content: string, columns: number, colors = 1) =>
  onePage(
    stm(
      `<< /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${columns} /Colors ${colors} >> >>`,
      flate(predictUp(L(content), columns * colors)),
    ),
  );
const objStmFile = (filter: string, encode: (b: Buffer) => Buffer) => {
  const values = [
    CATALOG,
    PAGES("3 0 R"),
    pageDict("<< /Font << /F1 5 0 R >> >>", "4 0 R"),
    HELV,
  ];
  let data = "",
    head = "";
  [1, 2, 3, 5].forEach((id, i) => {
    head += `${id} ${data.length} `;
    data += `${values[i] ?? ""}\n`;
  });
  const objs: (Body | undefined)[] = [
    undefined,
    undefined,
    undefined,
    stm("<< >>", textOf(T)),
    undefined,
    stm(
      `<< /Type /ObjStm /N 4 /First ${head.length}${filter} >>`,
      encode(L(head + data)),
    ),
  ];
  const built = pdf(objs, {
    xref: "stream",
    xrefOptions: { predictor: false },
    edit: (e) => {
      [1, 2, 3, 5].forEach((id, index) =>
        e.set(id, { type: 2, stream: 6, index }),
      );
    },
  });
  return {
    bytes: built.bytes,
    xref: built.size * 7,
    objstm: (head + data).length,
  };
};
it("BR-414 AC-04 stream decoding (a) predictor 12 content at B and B + 1", async () => {
  const content = padded(4096),
    inflated = Math.ceil(content.length / 8) * 9;
  const bytes = predicted(content, 8);
  expect(await text(bytes, inflated)).toBe(T);
  await refuses(bytes, "LIMIT_EXCEEDED", inflated - 1);
});
it("BR-414 AC-04 stream decoding (b) object stream and (c) cross-reference stream one byte over", async () => {
  const file = objStmFile(" /Filter /FlateDecode", (b) => flate(b));
  expect(await text(file.bytes)).toBe(T);
  await refuses(file.bytes, "LIMIT_EXCEEDED", file.xref + file.objstm - 1);
  await refuses(file.bytes, "LIMIT_EXCEEDED", file.xref - 1);
});
it("BR-414 AC-04 stream decoding (d) /Columns 65,536 with /Colors 4, then 65,537", async () => {
  expect(await text(predicted(padded(262144), 65536, 4))).toBe(T);
  await refuses(predicted(padded(65537), 65537), "LIMIT_EXCEEDED");
});
it.each([
  [
    "(e) predictor 2",
    () =>
      onePage(
        stm(
          "<< /Filter /FlateDecode /DecodeParms << /Predictor 2 /Columns 4 >> >>",
          flate(textOf(T)),
        ),
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(f) partial predicted row",
    () =>
      onePage(
        stm(
          "<< /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 8 >> >>",
          flate(Buffer.concat([predictUp(L(textOf(T)), 8), L("x")])),
        ),
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(g) LZWDecode content",
    () =>
      onePage(
        stm("<< /Filter /LZWDecode >>", Buffer.from([0x80, 0x0b, 0x60, 0x50])),
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(i) /Length past the end of the file",
    () =>
      pdf([
        CATALOG,
        PAGES("3 0 R"),
        pageDict("<< /Font << /F1 5 0 R >> >>", "4 0 R"),
        `<< /Length 99999 >>\nstream\n${textOf(T)}\nendstream`,
        HELV,
      ]).bytes,
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(k) /DecodeParms on the ASCII stage",
    () =>
      onePage(
        stm(
          "<< /Filter [/ASCII85Decode /FlateDecode] /DecodeParms [<< /Predictor 12 >> null] >>",
          L(a85(flate(textOf(T)))),
        ),
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(l) [/FlateDecode /ASCII85Decode]",
    () =>
      onePage(
        stm(
          "<< /Filter [/FlateDecode /ASCII85Decode] >>",
          flate(a85(L(textOf(T)))),
        ),
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(m) /ASCII85Decode data holding v",
    () =>
      onePage(
        stm(
          "<< /Filter /ASCII85Decode >>",
          L(a85(L(textOf(T))).replace("~>", "v~>")),
        ),
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(m) /ASCII85Decode data without ~>",
    () =>
      onePage(
        stm(
          "<< /Filter /ASCII85Decode >>",
          L(a85(L(textOf(T))).replace("~>", "")),
        ),
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(m) /ASCIIHexDecode data holding G",
    () =>
      onePage(stm("<< /Filter /ASCIIHexDecode >>", L(`G${ahx(L(textOf(T)))}`))),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(m) /ASCIIHexDecode data without >",
    () =>
      onePage(
        stm(
          "<< /Filter /ASCIIHexDecode >>",
          L(ahx(L(textOf(T))).replace(">", "")),
        ),
      ),
    "CONTENT_UNAVAILABLE",
  ],
] as const)("BR-414 AC-04 stream decoding %s", async (_name, build, code) => {
  await refuses(build(), code);
});
it("BR-414 AC-04 stream decoding (h) a DCTDecode image is never decoded", async () => {
  const bytes = onePage(
    stm("<< >>", `q 10 0 0 10 0 0 cm /Im1 Do Q ${textOf(T)}`),
    [
      HELV,
      stm(
        "<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
        "not a JPEG",
      ),
    ],
    "<< /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >>",
  );
  expect(await text(bytes)).toBe(T);
});
it("BR-414 AC-04 stream decoding (j) ASCII filters on content, ToUnicode and object stream", async () => {
  const content = stm(
    "<< /Filter [/ASCII85Decode /FlateDecode] /DecodeParms [null << /Predictor 12 /Columns 4 >>] >>",
    L(a85(flate(predictUp(L(textOf(T)), 4)))),
  );
  const cmap = toUnicode(
    [...new Set(T)].map((c) => [c.codePointAt(0) ?? 0, c]),
    1,
  );
  const font =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>";
  const values = [
    CATALOG,
    PAGES("3 0 R"),
    pageDict("<< /Font << /F1 5 0 R >> >>", "4 0 R"),
    font,
  ];
  let data = "",
    head = "";
  [1, 2, 3, 5].forEach((id, i) => {
    head += `${id} ${data.length} `;
    data += `${values[i] ?? ""}\n`;
  });
  const objs: (Body | undefined)[] = [
    undefined,
    undefined,
    undefined,
    content,
    undefined,
    stm("<< /Filter /ASCIIHexDecode >>", L(ahx(L(cmap)))),
    stm(
      `<< /Type /ObjStm /N 4 /First ${head.length} /Filter [/ASCIIHexDecode /FlateDecode] >>`,
      L(ahx(flate(head + data))),
    ),
  ];
  const bytes = pdf(objs, {
    xref: "stream",
    edit: (e) => {
      [1, 2, 3, 5].forEach((id, index) =>
        e.set(id, { type: 2, stream: 7, index }),
      );
    },
  }).bytes;
  expect(await text(bytes)).toBe(T);
});
it("BR-414 AC-04 stream decoding (n) /ASCII85Decode z groups past the remaining B", async () => {
  const bytes = onePage(
    stm("<< /Filter /ASCII85Decode >>", L(`${"z".repeat(1 << 20)}~>`)),
  );
  await refuses(bytes, "LIMIT_EXCEEDED", 1 << 20);
});
it.each([
  ["(o) /ASCIIHexDecode", "/ASCIIHexDecode", (b: Buffer) => L(ahx(b))],
  ["(p) /ASCII85Decode", "/ASCII85Decode", (b: Buffer) => L(a85(b))],
] as const)(
  "BR-414 AC-04 stream decoding %s alone and before /FlateDecode at B and B + 1",
  async (_name, filter, encode) => {
    const content = L(padded(4096));
    const alone = onePage(stm(`<< /Filter ${filter} >>`, encode(content)));
    expect(await text(alone, content.length)).toBe(T);
    await refuses(alone, "LIMIT_EXCEEDED", content.length - 1);
    const compressed = flate(content);
    const chained = onePage(
      stm(`<< /Filter [${filter} /FlateDecode] >>`, encode(compressed)),
    );
    expect(await text(chained, compressed.length + content.length)).toBe(T);
    const inflate = vi.mocked(zlib.inflateSync);
    inflate.mockClear();
    await refuses(chained, "LIMIT_EXCEEDED", compressed.length - 1);
    expect(inflate).not.toHaveBeenCalled();
  },
);

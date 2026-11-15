import { readFileSync } from "node:fs";
import { createDeflate } from "node:zlib";
import { expect, it, vi } from "vitest";
import {
  macExpertEncoding,
  macRomanEncoding,
  standardEncoding,
  winAnsiEncoding,
} from "../src/pdf-encoding-tables.js";
import { pdfjsGlyphNames } from "../src/pdf-glyph-list.js";
import {
  HELV,
  L,
  flate,
  onePage,
  sample,
  stm,
  textOf,
  toUnicode,
  type1Program,
  type Body,
} from "./helpers/pdf-corpus.js";
import { canonical, refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const worker = readFileSync(
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  "latin1",
);
const font = (encoding: string, base = "Helvetica", extra = "") =>
  `<< /Type /Font /Subtype /Type1 /BaseFont /${base}${encoding ? " /Encoding " + encoding : ""}${extra} >>`;
const shows = (dict: string, content: string, more: Body[] = []) =>
  onePage(stm("<< >>", content), [dict, ...more]);
const hello = (dict: string, more: Body[] = []) =>
  shows(dict, textOf("Hello"), more);
const winNames = winAnsiEncoding.map((n) => n || "space");
/** A Type 1 font (5) with descriptor (6) and `FontFile` (7) built from a synthetic cleartext. */
function embedded(o: {
  encoding?: string[];
  program?: Buffer;
  fontFile?: string;
  differences?: string;
  content?: string;
  clearLength?: number;
}) {
  const p = type1Program(o.encoding);
  const program = o.program ?? flate(p.program);
  const enc = o.differences
    ? ` /Encoding << /Differences ${o.differences} >>`
    : "";
  return onePage(
    stm("<< >>", o.content ?? "BT /F1 12 Tf 72 720 Td (Hello \\014nal) Tj ET"),
    [
      `<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+CMR10 /FirstChar 0 /LastChar 127 /Widths [${Array(128).fill(500).join(" ")}]${enc} /FontDescriptor 6 0 R >>`,
      "<< /Type /FontDescriptor /FontName /ABCDEF+CMR10 /Flags 4 /FontBBox [-40 -250 1009 750] /ItalicAngle 0 /Ascent 694 /Descent -194 /CapHeight 683 /StemV 69 /FontFile 7 0 R >>",
      stm(
        o.fontFile ??
          `<< /Length1 ${o.clearLength ?? p.clear.length} /Filter /FlateDecode >>`,
        program,
      ),
    ],
  );
}
const encodingLines = (
  puts: string[],
  size = 256,
  loop = "0 1 255 {1 index exch /.notdef put} for",
) => [`/Encoding ${size} array`, loop, ...puts, "readonly def"];
const hiPuts = [
  "dup 72 /H put",
  "dup 101 /e put",
  "dup 108 /l put",
  "dup 111 /o put",
  "dup 32 /space put",
  "dup 12 /fi put",
  "dup 110 /n put",
  "dup 97 /a put",
];
/** A cleartext of exactly `size` bytes: a comment pads the start. */
function paddedProgram(size: number) {
  const base = type1Program(encodingLines(hiPuts));
  const room = size - base.clear.length - 2;
  const clear = Buffer.concat([L(`%${"x".repeat(room)}\n`), base.clear]);
  return { clear, program: Buffer.concat([clear, base.priv, base.trailer]) };
}
async function deflated(prefix: Buffer, total: number) {
  const out: Buffer[] = [];
  const stream = createDeflate({ level: 9 });
  stream.on("data", (chunk: Buffer) => out.push(chunk));
  const done = new Promise((resolve) => stream.on("end", resolve));
  stream.write(prefix);
  const zeros = Buffer.alloc(1 << 20);
  for (let left = total - prefix.length; left > 0; left -= zeros.length) {
    const piece = left >= zeros.length ? zeros : zeros.subarray(0, left);
    if (!stream.write(piece))
      await new Promise((resolve) => stream.once("drain", resolve));
  }
  stream.end();
  await done;
  return Buffer.concat(out);
}
it("BR-420 AC-12 simple font encoding (l) base tables and glyph list equal the pinned PDF.js", () => {
  const table = (name: string) =>
    JSON.parse(
      new RegExp(`^const ${name} = (\\[.*\\]);$`, "mu").exec(worker)?.[1] ??
        "[]",
    ) as string[];
  expect(standardEncoding).toEqual(table("StandardEncoding"));
  expect(winAnsiEncoding).toEqual(table("WinAnsiEncoding"));
  expect(macRomanEncoding).toEqual(table("MacRomanEncoding"));
  expect(macExpertEncoding).toEqual(table("MacExpertEncoding"));
  const start = worker.indexOf(
    "const getGlyphsUnicode = getLookupTableFactory",
  );
  const body = worker.slice(start, worker.indexOf("\n});", start));
  const names = [
    ...body.matchAll(/^ {2}t(?:\.(\w+)|\["([^"]+)"\]) = 0x([0-9a-f]+);$/gmu),
  ]
    .filter((m) => Number.parseInt(m[3] ?? "0", 16) !== 0)
    .map((m) => m[1] ?? m[2] ?? "");
  expect(names.length).toBeGreaterThan(4000);
  expect([...pdfjsGlyphNames].toSorted()).toEqual(names.toSorted());
});
it.each([
  [
    "(a) S26",
    () => sample("S26"),
    "Hello ﬁnal “modern” – PDF",
    [],
    ["/BaseEncoding"],
  ],
  [
    "(b) /Differences below 0x20",
    () =>
      shows(
        font("<< /Differences [1 /H 2 /i] >>"),
        "BT /F1 12 Tf 72 720 Td <0102> Tj ET",
      ),
    "Hi",
    [],
    [],
  ],
  [
    "(c) nonembedded Helvetica with no /Encoding",
    () => hello(font("")),
    "Hello",
    ["/BaseFont /Helvetica"],
    [],
  ],
  [
    "(f) /Differences of 256 codes",
    () =>
      hello(
        font(
          `<< /Differences [0 ${winNames.map((n) => "/" + n).join(" ")}] >>`,
        ),
      ),
    "Hello",
    [],
    [],
  ],
  [
    "(g) a glyph name of 31 bytes",
    () =>
      hello(
        font(
          `<< /BaseEncoding /WinAnsiEncoding /Differences [200 /${"a".repeat(31)}] >>`,
        ),
      ),
    "Hello",
    [],
    [],
  ],
  [
    "(h) a cleartext /Length1 of 65,536",
    () => {
      const p = paddedProgram(65536);
      return embedded({ program: flate(p.program), clearLength: 65536 });
    },
    "Hello ﬁnal",
    [],
    [],
  ],
  [
    "(m) /Length1 70,000 never read with full /Differences",
    () =>
      embedded({
        fontFile: "<< /Length1 70000 /Filter /FlateDecode >>",
        differences:
          "[12 /fi 32 /space 72 /H 97 /a 101 /e 108 /l 110 /n 111 /o]",
      }),
    "Hello ﬁnal",
    [],
    [],
  ],
  [
    "(n) a cleartext putting code 65 twice",
    () =>
      embedded({
        encoding: encodingLines(["dup 65 /A put", "dup 65 /B put"]),
        content: "BT /F1 12 Tf 72 720 Td (A) Tj ET",
      }),
    "B",
    ["/Differences [65 /B]", "/Flags 32"],
    ["/BaseEncoding"],
  ],
  [
    "(q) nonembedded Symbol with /Differences",
    () =>
      shows(
        font("<< /Differences [1 /H /alpha /beta] >>", "Symbol"),
        "BT /F1 12 Tf 72 720 Td <010203> Tj ET",
      ),
    "Hαβ",
    ["/BaseFont /K1"],
    [],
  ],
  [
    "(r) a GBK-named TrueType font",
    () =>
      hello(
        "<< /Type /Font /Subtype /TrueType /BaseFont /#CB#CE#CC#E5 /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>",
        ["<< /Type /FontDescriptor /FontName /#B7#C2#CB#CE /Flags 32 >>"],
      ),
    "Hello",
    ["/BaseFont /K1", "/FontName /K1"],
    [],
  ],
  [
    "(s) G/c/uni/g names under /BaseEncoding /WinAnsiEncoding",
    () =>
      shows(
        font(
          "<< /BaseEncoding /WinAnsiEncoding /Differences [128 /G80 /c129 /uni0082 /g0083] >>",
        ),
        "BT /F1 12 Tf 72 720 Td <80818283> Tj ET",
      ),
    "€•‚ƒ",
    ["/BaseEncoding /WinAnsiEncoding"],
    [],
  ],
  [
    "(s) G/c/uni/g names without /BaseEncoding",
    () =>
      shows(
        font("<< /Differences [128 /G80 /c129 /uni0082 /g0083] >>"),
        "BT /F1 12 Tf 72 720 Td <80818283> Tj ET",
      ),
    "\u0080\u0081\u0082\u0083",
    [],
    ["/BaseEncoding"],
  ],
] as const)(
  "BR-420 AC-12 simple font encoding %s",
  async (_name, build, expected, present, absent) => {
    const bytes = build();
    expect(await text(bytes)).toBe(expected);
    const document = await canonical(bytes);
    for (const token of present) expect(document).toContain(token);
    for (const token of absent) expect(document).not.toContain(token);
    expect(document).not.toContain("/FontFile");
  },
);
it.each([
  [
    "(d) symbolic TrueType with FontFile2 and no mapping",
    () =>
      hello(
        "<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Sym /FontDescriptor 6 0 R >>",
        [
          "<< /Type /FontDescriptor /FontName /ABCDEF+Sym /Flags 4 /FontFile2 7 0 R >>",
          stm("<< /Length1 4 >>", "\0\x01\0\0"),
        ],
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(e) /Encoding /Foo with a full ToUnicode",
    () =>
      hello(font("/Foo", "Helvetica", " /ToUnicode 6 0 R"), [
        stm(
          "<< >>",
          toUnicode(
            Array.from("Helo").map((c) => [c.codePointAt(0) ?? 0, c]),
            1,
          ),
        ),
      ]),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(f) /Differences of 257 codes",
    () =>
      hello(
        font(
          `<< /Differences [0 ${winNames.map((n) => "/" + n).join(" ")} 65 /A] >>`,
        ),
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(g) a glyph name of 32 bytes",
    () =>
      hello(
        font(
          `<< /BaseEncoding /WinAnsiEncoding /Differences [200 /${"a".repeat(32)}] >>`,
        ),
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(z) a cleartext glyph name of 300 bytes",
    () =>
      embedded({
        encoding: encodingLines([`dup 72 /${"a".repeat(300)} put`, ...hiPuts]),
      }),
    "LIMIT_EXCEEDED",
  ],
  [
    "(aa) a cleartext string of 5,000 bytes where the glyph name goes",
    () =>
      embedded({
        encoding: encodingLines([
          `dup 72 (${"a".repeat(5000)}) put`,
          ...hiPuts,
        ]),
      }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(h) a cleartext /Length1 of 65,537",
    () => {
      const p = paddedProgram(65537);
      return embedded({ program: flate(p.program), clearLength: 65537 });
    },
    "LIMIT_EXCEEDED",
  ],
  [
    "(i) another procedure in the /Encoding array",
    () =>
      embedded({
        encoding: encodingLines(
          hiPuts,
          256,
          "0 1 255 {1 index exch /space put} for",
        ),
      }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(j) WinAnsi code 0x01 without ToUnicode",
    () => shows(HELV, "BT /F1 12 Tf 72 720 Td <01> Tj ET"),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(k) Symbol with no /Encoding and no ToUnicode",
    () => hello(font("", "Symbol")),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(o) a 10 array that puts code 12",
    () => embedded({ encoding: encodingLines(["dup 12 /fi put"], 10, "") }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(p) a FontFile shorter than /Length1",
    () => embedded({ fontFile: "<< /Length1 60000 /Filter /FlateDecode >>" }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(t) a FontFile with /DecodeParms",
    () =>
      embedded({
        fontFile:
          "<< /Length1 900 /Filter /FlateDecode /DecodeParms << /Predictor 1 >> >>",
      }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(u) a shown code named /g17",
    () => shows(font("<< /Differences [65 /g17] >>"), textOf("A")),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(u) a shown code named /Foo",
    () => shows(font("<< /Differences [65 /Foo] >>"), textOf("A")),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(u) a shown code named /G00",
    () => shows(font("<< /Differences [65 /G00] >>"), textOf("A")),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(u) a shown code named /cAB",
    () => shows(font("<< /Differences [65 /cAB] >>"), textOf("A")),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(w) a Type3 /gid883 without ToUnicode",
    () =>
      shows(
        "<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0] /FirstChar 1 /LastChar 1 /Widths [1000] /Encoding << /Differences [1 /gid883] >> /CharProcs << >> >>",
        "BT /F1 12 Tf 72 720 Td <01> Tj ET",
      ),
    "UNSUPPORTED_FORMAT",
  ],
] as const)(
  "BR-420 AC-12 simple font encoding %s",
  async (_name, build, code) => {
    await refuses(build(), code);
  },
);
const small = type1Program(encodingLines(hiPuts.slice(0, 5), 256, ""));
const content = `${"0 0 m ".repeat(800)}BT /F1 12 Tf 72 720 Td (Hello) Tj ET`;
it("BR-420 AC-12 simple font encoding (v) a 2^30-byte program inflates at most /Length1 + 16,383 bytes", async () => {
  expect(small.clear.length).toBeLessThan(1000);
  const bomb = await deflated(small.clear, 2 ** 30);
  const bytes = embedded({
    program: bomb,
    fontFile: "<< /Length1 1000 /Filter /FlateDecode >>",
    content,
  });
  expect(await text(bytes, content.length + 1000 + 16383)).toBe("Hello");
});
it.each([
  ["(x) one 16,384-byte chunk", 20000, 16384],
  ["(y) exactly /Length1 bytes", 1000, 1000],
] as const)(
  "BR-420 AC-12 simple font encoding %s at B and B + 1",
  async (_name, size, produced) => {
    const data = Buffer.concat([
      small.clear,
      Buffer.alloc(size - small.clear.length, 32),
    ]);
    const bytes = embedded({
      program: flate(data),
      fontFile: "<< /Length1 1000 /Filter /FlateDecode >>",
      content,
    });
    expect(await text(bytes, content.length + produced)).toBe("Hello");
    await refuses(bytes, "LIMIT_EXCEEDED", content.length + produced - 1);
  },
);

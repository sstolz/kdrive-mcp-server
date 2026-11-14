import { expect, it, vi } from "vitest";
import {
  CATALOG,
  HELV,
  PAGES,
  T,
  asciiCMap,
  hex2,
  onePage,
  pdf,
  seq,
  stm,
  textOf,
  toUnicode,
  type Body,
} from "./helpers/pdf-corpus.js";
import { canonical, refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const DESCRIPTOR =
  "<< /Type /FontDescriptor /FontName /ABCDEF+Arial /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>";
interface Type0 {
  base?: string;
  encoding?: string;
  toUnicode?: string | null;
  cmap?: string;
  descendant?: string;
}
/** A page showing `codes` with a Type0 font at 5 (descendant 6, ToUnicode 7, descriptor 8). */
function type0(codes: string, o: Type0 = {}) {
  const base = o.base ?? "ABCDEF+Arial";
  const tu =
    o.toUnicode === null ? "" : ` /ToUnicode ${o.toUnicode ?? "7 0 R"}`;
  return onePage(stm("<< >>", `BT /F1 12 Tf 72 720 Td <${codes}> Tj ET`), [
    `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding ${o.encoding ?? "/Identity-H"} /DescendantFonts [6 0 R]${tu} >>`,
    o.descendant ??
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 500 /CIDToGIDMap /Identity >>`,
    stm("<< >>", o.cmap ?? asciiCMap),
    DESCRIPTOR.replace("ABCDEF+Arial", base),
  ]);
}
const three = toUnicode([
  [1, "ffi"],
  [2, String.fromCodePoint(0x1f600)],
  [3, "A"],
]);
const type3 = (
  matrix: string,
  extra = "/FirstChar 1 /LastChar 1 /Widths [1000]",
) =>
  onePage(stm("<< >>", "BT /F1 12 Tf 72 720 Td <01> Tj ET"), [
    `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix ${matrix} ${extra} /Encoding << /Type /Encoding /Differences [1 /gid883] >> /CharProcs 90 0 R /Resources 91 0 R /ToUnicode 6 0 R >>`,
    stm("<< >>", toUnicode([[1, String.fromCodePoint(0x1f600)]], 1)),
  ]);
const simple = (dict: string, content = textOf("Hello"), more: Body[] = []) =>
  onePage(stm("<< >>", content), [dict, ...more]);
const widths = (n: number) => Array(n).fill(500).join(" ");
const allCodes = (destination: string) => {
  const lines: string[] = [];
  for (let hi = 0; hi < 256; hi++)
    lines.push(
      `<${hi.toString(16).padStart(2, "0")}00> <${hi.toString(16).padStart(2, "0")}ff> <${destination}>`,
    );
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n256 beginbfrange\n${lines.join("\n")}\nendbfrange\nendcmap end end\n`;
};
/** `count` Type0 fonts (5, 6, …) shown on one page; each has its own `ToUnicode`
 * stream (the last one `last`), or all share the first stream when `shared`. */
function manyCMapFonts(count: number, last: string, shared = false) {
  const fonts: Body[] = [];
  const names: string[] = [];
  const cid = 5 + count,
    firstStream = 6 + count,
    streams = shared ? 1 : count;
  for (let i = 0; i < count; i++) {
    const tuId = shared ? firstStream : firstStream + i;
    fonts.push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tuId} 0 R >>`,
    );
    names.push(`/F${i + 1} 12 Tf`);
  }
  fonts.push(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${firstStream + streams} 0 R >>`,
  );
  for (let i = 0; i < streams; i++)
    fonts.push(
      stm("<< >>", i === count - 1 && !shared ? last : allCodes("0000")),
    );
  fonts.push(DESCRIPTOR);
  return onePage(
    stm("<< >>", `BT ${names.join(" ")} 72 720 Td <0041> Tj ET`),
    fonts,
    `<< /Font << ${seq(names.length, (i) => "/F" + String(i + 1) + " " + String(5 + i) + " 0 R")} >> >>`,
  );
}
const cmapEntries = (n: number) =>
  `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n${Array.from(
    { length: Math.ceil(n / 100) },
    (_, b) => {
      const count = Math.min(100, n - b * 100);
      return `${count} beginbfchar\n${seq(count, (i) => "<" + ((b * 100 + i) % 65536).toString(16).padStart(4, "0") + "> <0041>", "\n")}\nendbfchar`;
    },
  ).join("\n")}\nendcmap end end\n`;
function fonts128(count: number) {
  const objs: Body[] = [CATALOG, PAGES("3 0 R"), "", ""];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    objs.push(HELV);
    names.push(`/G${i} ${objs.length} 0 R`);
  }
  const selects = names.map((n) => `${n.split(" ")[0] ?? ""} 12 Tf`).join(" ");
  objs[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << ${names.join(" ")} >> >> /Contents 4 0 R >>`;
  objs[3] = stm("<< >>", `BT ${selects} 72 720 Td (${T}) Tj ET`);
  return pdf(objs).bytes;
}
/** A WinAnsi Helvetica whose one-byte `ToUnicode` CMap (6) is `cmap`. */
const oneByteCMap = (cmap: string) =>
  simple(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>",
    textOf("A"),
    [stm("<< >>", cmap)],
  );
const plusOneCode = allCodes("0000").replace(
  "endcmap",
  "1 beginbfchar\n<0041> <0042>\nendbfchar\nendcmap",
);
const withW = (w: string) =>
  type0(hex2("Hi"), {
    descendant: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /W [${w}] >>`,
  });
const noPrograms = (document: string) => {
  for (const token of [
    "/FontFile",
    "Synthetic-UCS",
    "beginbfrange",
    "/CharProcs",
    "/Type3",
    "/CIDToGIDMap",
  ])
    expect(document).not.toContain(token);
};
it.each([
  [
    "(a) TrueType whose FontFile2 holds random bytes",
    () =>
      simple(
        `<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Arial /FirstChar 32 /LastChar 126 /Widths [${widths(95)}] /FontDescriptor 6 0 R /Encoding /WinAnsiEncoding >>`,
        textOf(T),
        [
          "<< /Type /FontDescriptor /FontName /ABCDEF+Arial /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>",
          stm("<< /Length1 9 >>", "\x8f\x01\x99random"),
        ],
      ),
    T,
    [],
  ],
  [
    "(b) Type0 named ArialMT with multi-code-point destinations",
    () => type0("000100020003", { base: "ArialMT", cmap: three }),
    "ffi😀A",
    ["/BaseFont /K1", "/FontName /K1"],
  ],
  [
    "(e) Type3 projected without CharProcs",
    () => type3("[0.001 0 0 0.001 0 0]"),
    "😀",
    ["/Subtype /Type1 /BaseFont /K1"],
  ],
  [
    "(m) a code mapped by two entries",
    () =>
      type0("0001", {
        cmap: toUnicode([
          [1, "A"],
          [1, "B"],
        ]),
      }),
    "B",
    [],
  ],
  [
    "(s) nonembedded TrueType named Symbol",
    () =>
      simple(
        `<< /Type /Font /Subtype /TrueType /BaseFont /Symbol /FirstChar 32 /LastChar 126 /Widths [${widths(95)}] /Encoding /WinAnsiEncoding >>`,
      ),
    "Hello",
    ["/BaseFont /K1"],
  ],
  [
    "(t) nonembedded Courier without Widths",
    () =>
      simple(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
      ),
    "Hello",
    ["/BaseFont /Courier"],
  ],
  [
    "(g) a CMap of 65,536 entries",
    () => type0("0001", { cmap: cmapEntries(65536) }),
    "A",
    [],
  ],
  [
    "(h) a destination of 64 bytes",
    () => type0("0001", { cmap: toUnicode([[1, "A".repeat(32)]]) }),
    "A".repeat(32),
    [],
  ],
  ["(i) 128 distinct fonts", () => fonts128(128), T, []],
  [
    "(n) CMaps mapping 262,144 codes",
    () => manyCMapFonts(4, allCodes("0000")),
    "A",
    [],
  ],
  [
    "(o) Widths of 256 numbers",
    () =>
      simple(
        `<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FirstChar 0 /LastChar 255 /Widths [${widths(256)}] /Encoding /WinAnsiEncoding >>`,
      ),
    "Hello",
    [],
  ],
  [
    "(p) a descendant W of 65,536 numbers",
    () =>
      type0(hex2("Hi"), {
        descendant: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /W [0 [${widths(65535)}]] >>`,
      }),
    "Hi",
    [],
  ],
  [
    "(v) a CMap assigning 65,536 codes through 256 bfrange entries",
    () => type0("0041", { cmap: allCodes("0000") }),
    "A",
    [],
  ],
  [
    "(x) one ToUnicode stream of 65,536 codes shared by five fonts",
    () => manyCMapFonts(5, "", true),
    "A",
    [],
  ],
  [
    "(y) a descendant W covering 65,536 CIDs",
    () => withW("0 65534 500 65535 [500]"),
    "Hi",
    [],
  ],
] as const)(
  "BR-417 AC-07 fonts %s",
  async (_name, build, expected, present) => {
    const bytes = build();
    expect(await text(bytes)).toBe(expected);
    const document = await canonical(bytes);
    noPrograms(document);
    for (const token of present) expect(document).toContain(token);
  },
);
it.each([
  [
    "(c) Type0 without ToUnicode",
    () => type0("0041", { toUnicode: null }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(d) Type0 with /UniJIS-UCS2-H",
    () => type0("0041", { encoding: "/UniJIS-UCS2-H" }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(e2) FontMatrix [0.001 0.001 0 0.001 0 0]",
    () => type3("[0.001 0.001 0 0.001 0 0]"),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(e2) FontMatrix [-0.001 0 0 0.001 0 0]",
    () => type3("[-0.001 0 0 0.001 0 0]"),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(e2) a Type3 width of 1,000,001",
    () =>
      type3(
        "[0.001 0 0 0.001 0 0]",
        "/FirstChar 1 /LastChar 1 /Widths [1000001]",
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(f) a CMap with usecmap",
    () => type0("0041", { cmap: `/Adobe-Identity-UCS usecmap\n${asciiCMap}` }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(g) a CMap of 65,537 entries",
    () => type0("0001", { cmap: cmapEntries(65537) }),
    "LIMIT_EXCEEDED",
  ],
  [
    "(h) a destination of 66 bytes",
    () => type0("0001", { cmap: toUnicode([[1, "A".repeat(33)]]) }),
    "LIMIT_EXCEEDED",
  ],
  ["(i) 129 distinct fonts", () => fonts128(129), "LIMIT_EXCEEDED"],
  [
    "(j) a Type0 ToUnicode missing one shown code",
    () => type0("00410001", {}),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(k) /ToUnicode /Identity-H",
    () => type0("0041", { toUnicode: "/Identity-H" }),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(l) a bfrange array one element short",
    () =>
      type0("0001", {
        cmap: "1 beginbfrange <0001> <0003> [<0041> <0042>] endbfrange",
      }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(n) CMaps mapping 262,145 codes",
    () => manyCMapFonts(5, toUnicode([[0x41, "A"]])),
    "LIMIT_EXCEEDED",
  ],
  [
    "(o) Widths of 257 numbers",
    () =>
      simple(
        `<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FirstChar 0 /LastChar 255 /Widths [${widths(257)}] /Encoding /WinAnsiEncoding >>`,
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(p) a descendant W of 65,537 numbers",
    () =>
      type0(hex2("Hi"), {
        descendant: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /W [0 [${widths(65536)}]] >>`,
      }),
    "LIMIT_EXCEEDED",
  ],
  [
    "(q) a descendant without FontDescriptor",
    () =>
      type0("0041", {
        descendant:
          "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>",
      }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(r) Flags given as a string",
    () =>
      simple(
        "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 6 0 R /Encoding /WinAnsiEncoding >>",
        textOf("Hello"),
        ["<< /Type /FontDescriptor /FontName /Arial /Flags (32) >>"],
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(u) a Type3 font without Widths",
    () => type3("[0.001 0 0 0.001 0 0]", "/FirstChar 1 /LastChar 1"),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(v) a CMap assigning 65,537 codes, one bfchar after 256 bfrange entries",
    () => type0("0041", { cmap: plusOneCode }),
    "LIMIT_EXCEEDED",
  ],
  [
    "(w) a CMap of 65,536 <00> <FF> <0041> entries",
    () =>
      oneByteCMap(
        `65536 beginbfrange\n${"<00> <FF> <0041>\n".repeat(65536)}endbfrange\n`,
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(y) a descendant W covering 65,537 CIDs",
    () => withW("0 65534 500 65535 [500 500]"),
    "LIMIT_EXCEEDED",
  ],
  [
    "(z) a descendant W of 21,845 full-range triples",
    () => withW(seq(21845, () => "0 65535 500")),
    "LIMIT_EXCEEDED",
  ],
] as const)("BR-417 AC-07 fonts %s", async (_name, build, code) => {
  await refuses(build(), code);
});
const emoji12 = String.fromCodePoint(0x1f600).repeat(12);
const tuFont =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>";
const diffFont =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /u1F600] >> >>";
const k = 1000;
const run = `(${"A".repeat(k)}) Tj`;
it.each([
  [
    "a ToUnicode font with m 16",
    () =>
      onePage(stm("<< >>", `BT /F1 0.01 Tf 0 400 Td ${run} ET`), [
        tuFont,
        stm("<< >>", toUnicode([[0x41, emoji12]], 1)),
      ]),
    8 * (16 * k + 5 + 1),
    emoji12.repeat(k),
  ],
  [
    "a Differences font with m 2",
    () =>
      onePage(stm("<< >>", `BT /F1 0.01 Tf 0 400 Td ${run} ET`), [diffFont]),
    8 * (2 * k + 5 + 1),
    String.fromCodePoint(0x1f600).repeat(k),
  ],
  [
    "a Form holding that string",
    () =>
      onePage(
        stm("<< >>", "/F1 0.01 Tf /Fm Do"),
        [
          diffFont,
          stm(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] >>",
            `BT 0 400 Td ${run} ET`,
          ),
        ],
        "<< /Font << /F1 5 0 R >> /XObject << /Fm 6 0 R >> >>",
      ),
    8 * (2 * k + 7 + 1),
    String.fromCodePoint(0x1f600).repeat(k),
  ],
] as const)(
  "BR-418 AC-08 producer admission %s at the sum of U and one over",
  async (_name, build, u, expected) => {
    const bytes = build();
    expect(await text(bytes, u)).toBe(expected);
    await refuses(bytes, "LIMIT_EXCEEDED", u - 1);
  },
);
it("BR-418 AC-08 producer admission strings of 4,096 and 4,097 bytes", async () => {
  const small = (s: string) =>
    onePage(stm("<< >>", `BT /F1 0.01 Tf 0 400 Td (${s}) Tj ET`));
  expect(await text(small("a".repeat(4096)))).toBe("a".repeat(4096));
  await refuses(small("a".repeat(4097)), "LIMIT_EXCEEDED");
});
/** I = 2 × (S + O + 1) with O = 5 (BT, Tf, Td, TJ, ET); I is even, so 65,538 is the first value over 65,536. */
function itemsPage(codes: number, wide: boolean) {
  const per = wide ? 2048 : 4096,
    parts: string[] = [];
  for (let left = codes; left > 0; left -= per) {
    const n = Math.min(per, left);
    parts.push(wide ? `<${"0041".repeat(n)}>` : `(${"a".repeat(n)})`);
  }
  const content = `BT /F1 0.001 Tf 0 400 Td [${parts.join(" ")}] TJ ET`;
  return wide
    ? onePage(stm("<< >>", content), [
        "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
        "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R >>",
        stm("<< >>", asciiCMap),
        DESCRIPTOR,
      ])
    : onePage(stm("<< >>", content));
}
it.each([false, true])(
  "BR-418 AC-08 producer admission the sum of I at 65,536 and over, Type0 %s",
  async (wide) => {
    const at = 65536 / 2 - 6;
    expect(await text(itemsPage(at, wide))).toHaveLength(at);
    await refuses(itemsPage(at + 1, wide), "LIMIT_EXCEEDED");
  },
);

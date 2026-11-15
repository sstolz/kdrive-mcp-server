import { expect, it, vi } from "vitest";
import * as zlib from "node:zlib";
import { contentTokenizer } from "../src/pdf-content.js";
import {
  CATALOG,
  HELV,
  L,
  PAGES,
  T,
  a85,
  flate,
  onePage,
  pdf,
  seq,
  stm,
  textOf,
  type Body,
} from "./helpers/pdf-corpus.js";
import { canonical, contentStreams, refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
vi.mock("node:zlib", async (original) => {
  const actual = await original<typeof import("node:zlib")>();
  return { ...actual, inflateSync: vi.fn(actual.inflateSync) };
});
const kept = new Set([
  "q",
  "Q",
  "cm",
  "BT",
  "ET",
  "Tf",
  "Tc",
  "Tw",
  "Tz",
  "TL",
  "Ts",
  "Tr",
  "Td",
  "TD",
  "Tm",
  "T*",
  "Tj",
  "TJ",
  "'",
  '"',
]);
/** BR-416: canonical content holds only kept operators, hex strings and escaped names. */
function onlyKept(content: string) {
  const tokens =
    content.match(/<[0-9a-f]*>|\/[^\s/<>[\]()]+|[^\s<>[\]]+|[[\]]/gu) ?? [];
  for (const token of tokens) {
    if (/^<[0-9a-f]*>$|^[[\]]$/u.test(token) || !Number.isNaN(Number(token)))
      continue;
    if (token.startsWith("/"))
      expect(token).toMatch(/^\/(?:[!-~]|#[0-9a-f]{2})+$/u);
    else expect(kept.has(token), token).toBe(true);
  }
}
const families =
  "q 1 0 0 RG 0 0 1 rg /DeviceRGB CS /DeviceRGB cs 1 0 0 SC 1 0 0 sc 0 SCN 0 scn 0 G 0 g 0 0 0 1 K 0 0 0 1 k 2 w 1 J 1 j 4 M [3] 0 d /Perceptual ri 1 i 0 0 m 10 10 l 1 2 3 4 5 6 c 1 2 3 4 v 1 2 3 4 y h 0 0 10 10 re S s f F f* B B* b b* n W n W* n /Sh0 sh /P BMC /P << /MCID 0 >> BDC EMC /P MP /P << >> DP BX EX /GS0 gs Q";
const withGs = (content: string, gs = "<< /CA 1 >>") =>
  onePage(
    stm("<< >>", content),
    [HELV, gs],
    "<< /Font << /F1 5 0 R >> /ExtGState << /GS0 6 0 R >> >>",
  );
const image = (dict: string, data: Buffer | string) =>
  onePage(
    stm(
      "<< >>",
      Buffer.concat([
        L(`q BI ${dict} ID `),
        typeof data === "string" ? L(data) : data,
        L(` EI Q ${textOf(T)}`),
      ]),
    ),
  );
const contentsArray = (refs: number) => {
  const objs: Body[] = [
    CATALOG,
    PAGES("3 0 R"),
    "",
    stm("<< >>", textOf(T)),
    HELV,
    stm("<< >>", "q Q"),
  ];
  const list = [
    "4 0 R",
    ...Array.from({ length: refs - 1 }, () => "6 0 R"),
  ].join(" ");
  objs[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents [${list}] >>`;
  return pdf(objs).bytes;
};
it.each([
  [
    "(a) every dropped operator family",
    () => withGs(`${families} ${textOf(T)} ${families}`),
    T,
  ],
  [
    "(f) a stray Q and two unclosed q",
    () => onePage(stm("<< >>", `Q q q ${textOf(T)}`)),
    T,
  ],
  [
    "(g) BT … ET split across two streams",
    () =>
      pdf([
        CATALOG,
        PAGES("3 0 R"),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents [4 0 R 6 0 R] >>",
        stm("<< >>", "BT /F1 12 Tf 72 720 Td"),
        HELV,
        stm("<< >>", `(${T}) Tj ET`),
      ]).bytes,
    T,
  ],
  [
    "(j) inline image framed by /L",
    () => image("/W 2 /H 2 /BPC 8 /CS /G /F /DCT /L 4", "EI Q"),
    T,
  ],
  [
    "(j) inline image framed by /A85",
    () =>
      image(
        "/W 2 /H 2 /BPC 8 /CS /RGB /F [/A85 /Fl]",
        a85(flate(Buffer.alloc(12, 200))),
      ),
    T,
  ],
  [
    "(j) inline image framed by /AHx",
    () => image("/W 2 /H 2 /BPC 8 /CS /G /F /AHx", "45492051>"),
    T,
  ],
  [
    "(j) inline image framed by size (S29)",
    () =>
      image("/W 4 /H 1 /BPC 8 /CS /G", Buffer.from([0x45, 0x49, 0x20, 0x51])),
    T,
  ],
  [
    "(j) inline image framed by one /Fl inflate",
    () =>
      image(
        "/IM true /W 8 /H 2 /BPC 1 /F /Fl",
        flate(Buffer.from([0xf0, 0x0f])),
      ),
    T,
  ],
  [
    "(n) 32 inline dictionary pairs",
    () =>
      image(
        `/W 1 /H 1 /BPC 8 /CS /G ${seq(28, (i) => "/X" + String(i) + " 0")}`,
        "x",
      ),
    T,
  ],
  [
    "(p) a font name with bytes outside 0x21–0x7E",
    () =>
      onePage(
        stm("<< >>", `BT /F#e9#20x 12 Tf 72 720 Td (${T}) Tj ET`),
        [HELV],
        "<< /Font << /F#e9#20x 5 0 R >> >>",
      ),
    T,
  ],
  [
    "(s) unfiltered image mask without /BPC",
    () => image("/IM true /W 16 /H 2", "abcd"),
    T,
  ],
  [
    "(t) /G image of W 65,536",
    () => image("/W 65536 /H 1 /BPC 1 /CS /G", Buffer.alloc(8192, 0x45)),
    T,
  ],
  [
    "(u) /A85 data holding > before ~>",
    () => image("/W 1 /H 1 /BPC 8 /CS /G /F /A85", "ab>c~>"),
    T,
  ],
  ["(i) 1,024 Contents references", () => contentsArray(1024), T],
] as const)(
  "BR-416 AC-06 content projection %s",
  async (_name, build, expected) => {
    const bytes = build();
    expect(await text(bytes)).toBe(expected);
    for (const content of contentStreams(await canonical(bytes)))
      onlyKept(content);
  },
);
it("BR-416 AC-06 content projection (b) text state outside BT persists into a second BT", async () => {
  const bytes = onePage(
    stm(
      "<< >>",
      "/F1 12 Tf 0 Tc BT 72 720 Td (Hello) Tj ET 1 Tc BT 72 700 Td (world) Tj ET",
    ),
  );
  expect(await text(bytes)).toBe("Hello\nworld");
  onlyKept(contentStreams(await canonical(bytes)).join("\n"));
});
it("BR-416 AC-06 content projection (h) one stream shared by pages 1 and 2", async () => {
  const bytes = pdf([
    CATALOG,
    PAGES("3 0 R 6 0 R", 2),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stm("<< >>", textOf(T)),
    HELV,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  ]).bytes;
  expect(await text(bytes, undefined, [1, 2])).toBe(`${T}\n\f\n${T}`);
  for (const content of contentStreams(
    await canonical(bytes, undefined, [1, 2]),
  ))
    onlyKept(content);
});
it.each([
  [
    "(c) a text-show with no font set",
    () => onePage(stm("<< >>", `BT 72 720 Td (${T}) Tj ET`)),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(d) gs naming an ExtGState with /Font",
    () => withGs(`/GS0 gs ${textOf(T)}`, "<< /Font [5 0 R 12] >>"),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(e) an unknown operator",
    () => onePage(stm("<< >>", `${textOf(T)} 1 zz`)),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(i) 1,025 Contents references",
    () => contentsArray(1025),
    "LIMIT_EXCEEDED",
  ],
  [
    "(k) /F /DCT without /L",
    () => image("/W 2 /H 2 /BPC 8 /CS /G /F /DCT", "abcd"),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(l) /F /Fl with /DP",
    () =>
      image(
        "/W 2 /H 2 /BPC 8 /CS /G /F /Fl /DP << /Predictor 12 >>",
        flate(Buffer.alloc(4)),
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(m) a computed size that overruns the content",
    () => image("/W 100 /H 100 /BPC 8 /CS /G", "abc"),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(n) 33 inline dictionary pairs",
    () =>
      image(
        `/W 1 /H 1 /BPC 8 /CS /G ${seq(29, (i) => "/X" + String(i) + " 0")}`,
        "x",
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(o) Do inside BT",
    () =>
      onePage(
        stm("<< >>", `BT /F1 12 Tf /Im1 Do (${T}) Tj ET`),
        [
          HELV,
          stm(
            "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
            "x",
          ),
        ],
        "<< /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >>",
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(r) a Flate inline image one byte over its computed size",
    () => image("/W 4 /H 1 /BPC 8 /CS /G /F /Fl", flate(Buffer.alloc(5, 7))),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(t) /G image of W 65,537",
    () => image("/W 65537 /H 1 /BPC 1 /CS /G", Buffer.alloc(8193, 0x45)),
    "LIMIT_EXCEEDED",
  ],
  [
    "(w) q inside BT",
    () => onePage(stm("<< >>", `BT q /F1 12 Tf (${T}) Tj ET`)),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(w) BT inside BT",
    () => onePage(stm("<< >>", `BT BT /F1 12 Tf (${T}) Tj ET ET`)),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(w) Td outside BT/ET",
    () => onePage(stm("<< >>", `72 720 Td ${textOf(T)}`)),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(w) ET outside a text object",
    () => onePage(stm("<< >>", `${textOf(T)} ET`)),
    "UNSUPPORTED_FORMAT",
  ],
] as const)(
  "BR-416 AC-06 content projection %s",
  async (_name, build, code) => {
    await refuses(build(), code);
  },
);
it("BR-416 AC-06 content projection (q) a 2^35-byte Flate inline image past the remaining B", async () => {
  const budget = 1 << 20;
  const bytes = image(
    "/W 65536 /H 65536 /BPC 16 /CS /CMYK /F /Fl",
    flate(Buffer.alloc(2 << 20)),
  );
  const inflate = vi.mocked(zlib.inflateSync);
  inflate.mockClear();
  await refuses(bytes, "LIMIT_EXCEEDED", budget);
  for (const call of inflate.mock.calls) {
    const options = call[1] as { maxOutputLength?: number } | undefined;
    expect(options?.maxOutputLength ?? Infinity).toBeLessThanOrEqual(budget);
  }
});
it("BR-416 AC-06 content projection (v) dropped operators paid for at every Contents reference", async () => {
  const dropped = "0 0 m ".repeat(100),
    head = textOf(T);
  const objs: Body[] = [
    CATALOG,
    "",
    stm("<< >>", head),
    HELV,
    stm("<< >>", dropped),
  ];
  const list = ["3 0 R", ...Array.from({ length: 1023 }, () => "5 0 R")].join(
    " ",
  );
  const kids: string[] = [];
  for (let p = 0; p < 10; p++) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents [${list}] >>`,
    );
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = PAGES(kids.join(" "), 10);
  const bytes = pdf(objs).bytes,
    pages = Array.from({ length: 10 }, (_, i) => i + 1);
  // The text stream is used once per page; the dropped stream 1,023 times per page.
  const budget = 10 * head.length + 10 * 1023 * dropped.length;
  const open = vi.spyOn(contentTokenizer, "open");
  expect(await text(bytes, budget, pages)).toBe(
    Array(10).fill(T).join("\n\f\n"),
  );
  open.mockClear();
  await refuses(bytes, "LIMIT_EXCEEDED", budget - 1, pages);
  // Pages 1–9 are tokenized; page 10 refuses at its `Contents` array, before tokenization.
  expect(open).toHaveBeenCalledTimes(9);
  open.mockRestore();
}, 60000);
const big = "[-1000000 -1000000 1000000 1000000]";
function sized(size: number) {
  const abs = Math.abs(size),
    huge = abs >= 100000;
  const box = huge ? big : "[0 0 612 792]";
  const x = huge ? (size > 0 ? -950000 : 950000) : size > 0 ? 72 : 540;
  const y = huge ? 900000 : 720;
  const content = `BT /F1 ${size} Tf ${abs * 1.2} TL 1 0 0 1 ${x} ${y} Tm (Hello modern world) Tj T* (second line here) Tj T* (end) Tj ET`;
  return pdf([
    CATALOG,
    PAGES("3 0 R"),
    `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    stm("<< >>", content),
    HELV,
  ]).bytes;
}
it.each([-100000, -12, -0.5, 0.001, 0.5, 100000])(
  "BR-416 AC-06 content projection (x) Tf size %s",
  async (size) => {
    expect(await text(sized(size))).toBe(
      "Hello modern world\nsecond line here\nend",
    );
  },
);
it.each([0, 100001, -100001])(
  "BR-416 AC-06 content projection (x) Tf size %s refuses",
  async (size) => {
    await refuses(sized(size), "UNSUPPORTED_FORMAT");
  },
);

import { expect, it, vi } from "vitest";
import { CanonicalContent } from "../src/pdf-execute.js";
import {
  CATALOG,
  HELV,
  PAGES,
  T,
  pdf,
  sample,
  seq,
  stm,
  textOf,
  toUnicode,
  type Body,
} from "./helpers/pdf-corpus.js";
import { canonical, contentStreams, refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const FORM = "/Type /XObject /Subtype /Form /BBox [0 0 612 792]";
/** A page (object 3) with content `page`, Helvetica at 4 and objects from 5 on. */
function withForms(page: string, resources: string, forms: Body[]) {
  return pdf([
    CATALOG,
    PAGES("3 0 R"),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${5 + forms.length} 0 R >>`,
    HELV,
    ...forms,
    stm("<< >>", page),
  ]).bytes;
}
const form = (content: string, resources = "", extra = "") =>
  stm(
    `<< ${FORM}${resources ? " /Resources " + resources : ""}${extra} >>`,
    content,
  );
/** Forms 5, 6, … each drawing the next; the last shows text or not. */
function chain(depth: number, last: string) {
  const forms: Body[] = [];
  for (let i = 0; i < depth; i++) {
    const id = 5 + i;
    forms.push(
      i === depth - 1
        ? form(last, "<< /Font << /F1 4 0 R >> >>")
        : form("/X Do", `<< /XObject << /X ${id + 1} 0 R >> >>`),
    );
  }
  return withForms(
    textOf(T) + " /X Do",
    "<< /Font << /F1 4 0 R >> /XObject << /X 5 0 R >> >>",
    forms,
  );
}
const names = Array.from({ length: 5 }, (_, i) => `S${21 + i}`);
const golden: Record<string, string> = {
  S22: `${T}\nOverlay stamp`,
  S23: `${T}\nSecond page`,
  S24: `${T}\nFigure label`,
};
it.each(names)("BR-419 AC-11 Form inlining (a) %s", async (name) => {
  const bytes = sample(name);
  expect(await text(bytes)).toBe(golden[name] ?? T);
  const content = contentStreams(await canonical(bytes)).join("\n");
  expect(content).toMatch(/(?:^|\n)q\n/u);
  expect(content).toMatch(/\nQ(?:\n|$)/u);
  if (name === "S23") expect(content).toContain("q\n0 1 -1 0 612 0 cm\n");
  if (name === "S22") {
    expect(content).toContain("/K1 12 Tf");
    expect(content).toContain("/K2 10 Tf");
  }
});
const loose = (content: string) => form(content);
it.each([
  [
    "(b) a Form without /Resources inside a Form with /F1",
    () =>
      withForms("/A Do", "<< /XObject << /A 5 0 R >> >>", [
        form("/B Do", "<< /Font << /F1 4 0 R >> /XObject << /B 6 0 R >> >>"),
        loose(textOf(T)),
      ]),
    T,
  ],
  ["(d) a text-free Form nested 8 deep", () => chain(8, "0 Tc"), T],
  [
    "(d) Forms with text nested 8 deep",
    () => chain(8, "BT /F1 12 Tf 72 600 Td (Nested) Tj ET"),
    `${T}\nNested`,
  ],
  [
    "(f) 256 distinct Forms",
    () =>
      withForms(
        `${textOf(T)} ${seq(256, (i) => "/X" + String(i) + " Do")}`,
        `<< /Font << /F1 4 0 R >> /XObject << ${seq(256, (i) => "/X" + String(i) + " " + String(5 + i) + " 0 R")} >> >>`,
        Array.from({ length: 256 }, () => loose("0 Tc")),
      ),
    T,
  ],
  [
    "(g) 4,096 Form executions",
    () =>
      withForms(
        `${textOf(T)} ${"/A Do ".repeat(16)}`,
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R /B 6 0 R >> >>",
        [
          form("/B Do ".repeat(255), "<< /XObject << /B 6 0 R >> >>"),
          loose("0 Tc"),
        ],
      ),
    T,
  ],
  [
    "(l) 30 nested q and a Form with one q",
    () =>
      withForms(
        `${"q ".repeat(30)}/F1 12 Tf /A Do`,
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
        [loose(`q ${textOf(T)} Q`)],
      ),
    T,
  ],
] as const)("BR-419 AC-11 Form inlining %s", async (_name, build, expected) => {
  const bytes = build();
  expect(await text(bytes)).toBe(expected);
  if (_name.includes("text-free"))
    expect(contentStreams(await canonical(bytes)).join("\n")).not.toContain(
      "Tc",
    );
});
it.each([
  [
    "(d) Forms with text nested 9 deep",
    () => chain(9, "BT /F1 12 Tf 72 600 Td (Nested) Tj ET"),
    "LIMIT_EXCEEDED",
  ],
  [
    "(e) a Form cycle A→B→A",
    () =>
      withForms("/A Do", "<< /XObject << /A 5 0 R >> >>", [
        form("/B Do", "<< /XObject << /B 6 0 R >> >>"),
        form("/A Do", "<< /XObject << /A 5 0 R >> >>"),
      ]),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(f) 257 distinct Forms",
    () =>
      withForms(
        `${textOf(T)} ${seq(257, (i) => "/X" + String(i) + " Do")}`,
        `<< /Font << /F1 4 0 R >> /XObject << ${seq(257, (i) => "/X" + String(i) + " " + String(5 + i) + " 0 R")} >> >>`,
        Array.from({ length: 257 }, () => loose("0 Tc")),
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(g) 4,097 Form executions",
    () =>
      withForms(
        `${textOf(T)} ${"/A Do ".repeat(16)} /B Do`,
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R /B 6 0 R >> >>",
        [
          form("/B Do ".repeat(255), "<< /XObject << /B 6 0 R >> >>"),
          loose("0 Tc"),
        ],
      ),
    "LIMIT_EXCEEDED",
  ],
  [
    "(h) a /Matrix of five numbers",
    () =>
      withForms(
        "/A Do",
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
        [form(textOf(T), "", " /Matrix [1 0 0 1 0]")],
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(h) a /Matrix entry of 1,000,001",
    () =>
      withForms(
        "/A Do",
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
        [form(textOf(T), "", " /Matrix [1 0 0 1 0 1000001]")],
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(i) an XObject of /Subtype /Foo",
    () =>
      withForms(
        `${textOf(T)} /A Do`,
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
        [stm("<< /Type /XObject /Subtype /Foo >>", "x")],
      ),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "(j) a Form ending inside BT",
    () =>
      withForms(
        "/F1 12 Tf /A Do",
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
        [loose(`BT (${T}) Tj`)],
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(l) 30 nested q and a Form with two q",
    () =>
      withForms(
        `${"q ".repeat(30)}/F1 12 Tf /A Do`,
        "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
        [loose(`q q ${textOf(T)} Q Q`)],
      ),
    "UNSUPPORTED_FORMAT",
  ],
] as const)("BR-419 AC-11 Form inlining %s", async (_name, build, code) => {
  await refuses(build(), code);
});
it("BR-419 AC-11 Form inlining (k) the token that makes the sum of I pass 65,536", async () => {
  // Resolution of the AC: the Form also shows one string with its caller's
  // font, since a Form without text-show emits nothing (BR-419).
  const b = `${"0 Tc ".repeat(1000)}BT (a) Tj ET`;
  const bytes = withForms(
    `/F1 12 Tf ${"/A Do ".repeat(16)}`,
    "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
    [form("/B Do ".repeat(256), "<< /XObject << /B 6 0 R >> >>"), loose(b)],
  );
  const tokens = ["Tf"];
  for (let a = 0; a < 16; a++) {
    tokens.push("q");
    for (let i = 0; i < 256; i++)
      tokens.push(
        "q",
        ...Array<string>(1000).fill("Tc"),
        "BT",
        "Tj",
        "ET",
        "Q",
      );
    tokens.push("Q");
  }
  let s = 0,
    expected = 0;
  for (const [i, token] of tokens.entries()) {
    if (token === "Tj") s++;
    if (2 * (s + i + 1 + 1) > 65536) {
      expected = i + 1;
      break;
    }
  }
  const emit = vi.spyOn(CanonicalContent.prototype, "emit");
  try {
    await refuses(bytes, "LIMIT_EXCEEDED");
    expect(emit).toHaveBeenCalledTimes(expected);
  } finally {
    emit.mockRestore();
  }
});
it("BR-419 AC-11 Form inlining (m) a Form showing text with its caller's simple and Type0 fonts", async () => {
  const bytes = withForms(
    "/F1 12 Tf /Fm Do /F2 12 Tf /Fm Do",
    "<< /Font << /F1 4 0 R /F2 6 0 R >> /XObject << /Fm 5 0 R >> >>",
    [
      loose("BT 72 700 Td (AB) Tj ET"),
      "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>",
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R >>",
      stm("<< >>", toUnicode([[0x4142, "Z"]])),
      "<< /Type /FontDescriptor /FontName /X /Flags 32 >>",
    ],
  );
  expect(await text(bytes)).toBe("ABZ");
  expect(await canonical(bytes)).toContain("/Differences [65 /A 66 /B]");
});
it("BR-419 AC-11 Form inlining (n) Form executions paid for at the Do that passes B", async () => {
  const pad = "0 0 m ".repeat(1000),
    x = `${pad}BT 0 400 Td (a) Tj ET`,
    a = "/X Do ".repeat(4),
    page = "/F1 12 Tf /A Do";
  const bytes = withForms(
    page,
    "<< /Font << /F1 4 0 R >> /XObject << /A 5 0 R >> >>",
    [form(a, "<< /XObject << /X 6 0 R >> >>"), loose(x)],
  );
  const budget = page.length + a.length + 4 * x.length;
  expect(await text(bytes, budget)).toBe("aaaa");
  const emit = vi.spyOn(CanonicalContent.prototype, "emit");
  try {
    await refuses(bytes, "LIMIT_EXCEEDED", budget - 1);
    // Tf, the q of A and three executions of X (q BT Td Tj ET Q): none of the fourth.
    expect(emit).toHaveBeenCalledTimes(2 + 3 * 6);
  } finally {
    emit.mockRestore();
  }
});

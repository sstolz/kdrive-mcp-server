import { expect, it, vi } from "vitest";
import {
  CATALOG,
  HELV,
  L,
  PAGES,
  T,
  classicXref,
  flate,
  modern,
  pageDict,
  pdf,
  seq,
  stm,
  textOf,
  update,
  objStm,
  objects,
  streamFile,
  writeObjects,
  xrefStream,
  type Body,
  type Entry,
} from "./helpers/pdf-corpus.js";
import { Budget } from "../src/pdf-decode.js";
import { readXref, terminalFrame } from "../src/pdf-xref.js";
import { refuses, text } from "./helpers/pdf-run.js";
vi.mock("pdfjs-dist", async (original) => {
  const actual = await original<typeof import("pdfjs-dist")>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});
const pad = (n: number) => String(n).padStart(10, "0");
/** (b), (b2): a hybrid section whose `/XRefStm` lists object 4. */
function hybrid(table: "free" | "in-use") {
  const objs = objects();
  if (table === "in-use") objs.push(undefined, "(Other text)");
  const written = writeObjects(objs);
  const parts = written.parts;
  let pos = written.pos;
  const entries = new Map(written.entries);
  const original = entries.get(4);
  const streamEntries = new Map<number, Entry>([
    [
      4,
      table === "free"
        ? (original ?? { type: 0 })
        : { type: 2, stream: 7, index: 0 },
    ],
  ]);
  const xs = pos;
  const part = xrefStream(6, streamEntries, 8, "", {
    index: "[4 1]",
    rows: [4],
  });
  parts.push(part);
  pos += part.length;
  entries.set(6, { type: 1, offset: xs, gen: 0 });
  if (table === "free") entries.delete(4);
  else {
    const stmPos = pos;
    const data = "7 0 (Other text)";
    const body = L(
      `7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`,
    );
    parts.push(body);
    pos += body.length;
    entries.set(7, { type: 1, offset: stmPos, gen: 0 });
  }
  const start = pos;
  parts.push(
    L(
      `${classicXref(entries, 8, "/Root 1 0 R /XRefStm " + String(xs))}startxref\n${start}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
/** (c): the last `startxref` names a first-page section whose `/Prev` is the main one. */
function linearized() {
  const head = L("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  const section = (entries: Map<number, Entry>, prev: number) =>
    `xref\n0 4\n${classicXref(entries, 4, "").split("\n").slice(2, 6).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R /Prev ${pad(prev)} >>\n`;
  const probe = section(new Map(), 0).length;
  const written = writeObjects(objects(), {
    start: Buffer.concat([head, L(" ".repeat(probe))]),
  });
  const main = written.pos;
  const first = section(written.entries, main);
  const bytes = Buffer.concat(written.parts);
  expect(first).toHaveLength(probe);
  L(first).copy(bytes, head.length);
  return Buffer.concat([
    bytes,
    L(
      `${classicXref(written.entries, 6, "/Root 1 0 R")}startxref\n${head.length}\n%%EOF\n`,
    ),
  ]);
}
/** (d): `/Prev` chain A→B→A. */
function prevCycle() {
  const base = pdf(objects(), { trailer: "/Prev 0000000000" });
  const updated = update(base, new Map([[1, CATALOG]]));
  const s = updated.bytes.toString("latin1");
  const b = /startxref\n(\d+)\n%%EOF\n$/u.exec(s)?.[1] ?? "0";
  return L(s.replace("/Prev 0000000000", `/Prev ${pad(Number(b))}`));
}
function sections(count: number) {
  let written = pdf(objects());
  for (let i = 1; i < count; i++)
    written = update(written, new Map([[1, CATALOG]]));
  return written.bytes;
}
const pairs = (n: number) => "[" + seq(n, (i) => String(i) + " 1") + "]";
const rows = (n: number) => Array.from({ length: n }, (_, i) => i);
const second = () =>
  update(
    pdf(objects()),
    new Map([[4, stm("<< >>", textOf("Second revision"))]]),
  ).bytes;
it.each([
  ["(a) second revision", second, "Second revision"],
  ["(b) hybrid free table entry", () => hybrid("free"), T],
  ["(b2) hybrid in-use table entry", () => hybrid("in-use"), T],
  ["(c) linearized-style first-page section", linearized, T],
  ["(e) 32 sections", () => sections(32), T],
  ["(f) /Size 65,536", () => streamFile({ size: 65536, index: "[0 7]" }), T],
  ["(g) /W [1 8 2]", () => streamFile({ w: [1, 8, 2] }), T],
  ["(k) /W [0 4 0]", () => streamFile({ w: [0, 4, 0] }), T],
  [
    "(o) 4,096 /Index pairs",
    () => streamFile({ size: 4097, index: pairs(4096), rows: rows(4096) }),
    T,
  ],
] as const)(
  "BR-412 AC-02 cross-reference chain %s",
  async (_name, build, expected) => {
    expect(await text(build())).toBe(expected);
  },
);
it.each([
  ["(d) /Prev cycle", prevCycle, "CONTENT_UNAVAILABLE"],
  ["(e) 33 sections", () => sections(33), "LIMIT_EXCEEDED"],
  [
    "(f) /Size 65,537",
    () => streamFile({ size: 65537, index: "[0 7]" }),
    "LIMIT_EXCEEDED",
  ],
  ["(g) /W [1 9 2]", () => streamFile({ w: [1, 9, 2] }), "LIMIT_EXCEEDED"],
  [
    "(h) one byte short",
    () => streamFile({ truncate: 1, predictor: false }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(i) indirect /W",
    () => streamFile({ wText: "5 0 R" }),
    "CONTENT_UNAVAILABLE",
  ],
  ["(j) /W [1 0 2]", () => streamFile({ w: [1, 0, 2] }), "CONTENT_UNAVAILABLE"],
  [
    "(l) /Index [0 5 3 4]",
    () => streamFile({ index: "[0 5 3 4]", rows: [0, 1, 2, 3, 4, 3, 4, 5, 6] }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(m) /Index [5 4 0 5]",
    () =>
      streamFile({
        size: 9,
        index: "[5 4 0 5]",
        rows: [5, 6, 7, 8, 0, 1, 2, 3, 4],
      }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(n) /Index counts /Size + 1",
    () => streamFile({ size: 6, index: "[0 7]", rows: rows(7) }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(o) 4,097 /Index pairs",
    () => streamFile({ size: 4098, index: pairs(4097), rows: rows(4097) }),
    "LIMIT_EXCEEDED",
  ],
] as const)(
  "BR-412 AC-02 cross-reference chain %s",
  async (_name, build, code) => {
    await refuses(build(), code);
  },
);
const base6 = () => [...objects(), undefined];
function pageChain(nodes: number) {
  const objs: Body[] = [CATALOG];
  for (let i = 0; i < nodes; i++) {
    const id = objs.length + 1;
    objs.push(
      `<< /Type /Pages /Kids [${id + 1} 0 R] /Count 1${i ? " /Parent " + String(id - 1) + " 0 R" : ""} >>`,
    );
  }
  const page = objs.length + 1;
  objs.push(
    `<< /Type /Page /Parent ${page - 1} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`,
  );
  objs.push(stm("<< >>", textOf(T)), HELV);
  return pdf(objs).bytes;
}
function sharedTwice() {
  const objs: Body[] = [CATALOG, ""];
  const kids: string[] = [];
  const streams: number[][] = [];
  for (let set = 0; set < 4; set++) {
    const ids: number[] = [];
    for (let i = 0; i < 1000; i++) {
      objs.push(stm("<< >>", i === 0 ? textOf(`Set ${set}`) : "q Q"));
      ids.push(objs.length);
    }
    streams.push(ids);
  }
  objs.push(HELV);
  const fontId = objs.length;
  for (let p = 0; p < 8; p++) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents [${(streams[Math.floor(p / 2)] ?? []).map((n) => String(n) + " 0 R").join(" ")}] >>`,
    );
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = PAGES(kids.join(" "), 8);
  return pdf(objs).bytes;
}
const lengthTwo = () => {
  const objs: (Body | undefined)[] = [
    CATALOG,
    PAGES("3 0 R"),
    pageDict("<< /Font << /F1 5 0 R >> >>", "[4 0 R 9 0 R]"),
    stm("<< >>", "q "),
    HELV,
    undefined,
    "0",
    "0",
    stm("<< >>", `${textOf(T)} Q`),
  ];
  (objs[3] as { lengthRef?: number }).lengthRef = 7;
  (objs[8] as { lengthRef?: number }).lengthRef = 8;
  objs[6] = String(2);
  objs[7] = String(textOf(T).length + 2);
  return objStm(objs, [7], 6);
};
it.each([
  [
    "(a) all non-stream objects in one object stream",
    () => modern({ xrefStream: true, objStm: true }),
  ],
  ["(e) indirect /Length objects", lengthTwo],
  ["(h) 4,096 distinct objects", () => pageChain(4092)],
  ["(i) the same 4,000 objects twice", sharedTwice],
  ["(k) /N 4,096", () => objStm(base6(), [1, 2, 3, 5], 6, { filler: 4092 })],
  [
    "(m) generation 1 content",
    () =>
      pdf(
        [
          CATALOG,
          PAGES("3 0 R"),
          pageDict("<< /Font << /F1 5 0 R >> >>", "4 1 R"),
          stm("<< >>", textOf(T)),
          HELV,
        ],
        { gens: new Map([[4, 1]]) },
      ).bytes,
  ],
] as const)("BR-413 AC-03 object resolution %s", async (name, build) => {
  const pages = name.startsWith("(i)") ? [1, 2, 3, 4, 5, 6, 7, 8] : [1];
  const expected = name.startsWith("(i)")
    ? Array.from({ length: 8 }, (_, p) => `Set ${Math.floor(p / 2)}`).join(
        "\n\f\n",
      )
    : T;
  expect(await text(build(), undefined, pages)).toBe(expected);
});
it.each([
  [
    "(b) object stream that is a type 2 object",
    () =>
      objStm(base6(), [1, 2, 3, 5], 6, {
        edit: (e) => e.set(6, { type: 2, stream: 4, index: 0 }),
      }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(c) header pair naming another object",
    () => objStm(base6(), [1, 2, 3, 5], 6, { header: "99 0 2 34 3 64 5 200 " }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(d) stream inside an object stream",
    () => {
      const objs = base6();
      objs[3] = `<< /Length ${textOf(T).length} >>\nstream\n${textOf(T)}\nendstream`;
      return objStm(objs, [1, 2, 3, 4, 5], 6);
    },
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(f) object stream /Length inside itself",
    () => {
      const objs: (Body | undefined)[] = [...base6(), "0"];
      return objStm(objs, [1, 2, 3, 5, 7], 6, { lengthRef: 7 });
    },
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(g) generation mismatch on the page",
    () =>
      pdf([
        CATALOG,
        PAGES("3 1 R"),
        pageDict("<< /Font << /F1 5 0 R >> >>", "4 0 R"),
        stm("<< >>", textOf(T)),
        HELV,
      ]).bytes,
    "CONTENT_UNAVAILABLE",
  ],
  ["(h) 4,097 distinct objects", () => pageChain(4093), "LIMIT_EXCEEDED"],
  [
    "(j) header offsets 0 10 10",
    () =>
      objStm([...base6(), "1", "2"], [7, 8, 1], 6, {
        header: "7 0 8 10 1 10 ",
      }),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(k) /N 4,097",
    () => objStm(base6(), [1, 2, 3, 5], 6, { filler: 4093 }),
    "LIMIT_EXCEEDED",
  ],
  [
    "(l) object stream /Length in another object stream",
    () => {
      const objs: (Body | undefined)[] = [...base6(), undefined, "0"];
      let header = "",
        data = "";
      for (const id of [1, 2, 3, 5]) {
        header += `${id} ${data.length} `;
        data += `${objs[id - 1] as string}\n`;
      }
      const outer = stm(
        `<< /Type /ObjStm /N 4 /First ${header.length} >>`,
        header + data,
      );
      outer.lengthRef = 8;
      const all: (Body | undefined)[] = [
        undefined,
        undefined,
        undefined,
        objs[3],
        undefined,
        outer,
        stm(`<< /Type /ObjStm /N 1 /First 4 >>`, `8 0 ${outer.data.length}\n`),
      ];
      return pdf(all, {
        xref: "stream",
        edit: (e) => {
          [1, 2, 3, 5].forEach((id, index) =>
            e.set(id, { type: 2, stream: 6, index }),
          );
          e.set(8, { type: 2, stream: 7, index: 0 });
        },
      }).bytes;
    },
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(n) 5 1 R to a type 2 object",
    () =>
      objStm(
        [
          CATALOG,
          PAGES("3 0 R"),
          pageDict("<< /Font << /F1 5 1 R >> >>", "4 0 R"),
          stm("<< >>", textOf(T)),
          HELV,
          undefined,
        ],
        [1, 2, 3, 5],
        6,
      ),
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(o) /Length 7 5 R after object 7 0 R is resolved",
    () => {
      const content = textOf(T);
      return pdf([
        CATALOG,
        PAGES("3 0 R"),
        pageDict("<< /Font << /F1 5 0 R >> >>", "[4 0 R 6 0 R]"),
        `<< /Length 7 0 R >>\nstream\n${content}\nendstream`,
        HELV,
        `<< /Length 7 5 R >>\nstream\n${content}\nendstream`,
        String(content.length),
      ]).bytes;
    },
    "CONTENT_UNAVAILABLE",
  ],
  [
    "(p) /F2 5 7 R selected after /F1 5 0 R",
    () =>
      pdf([
        CATALOG,
        PAGES("3 0 R"),
        pageDict("<< /Font << /F1 5 0 R /F2 5 7 R >> >>", "4 0 R"),
        stm("<< >>", "BT /F1 12 Tf 72 720 Td (A) Tj /F2 12 Tf (B) Tj ET"),
        HELV,
      ]).bytes,
    "CONTENT_UNAVAILABLE",
  ],
] as const)("BR-413 AC-03 object resolution %s", async (_name, build, code) => {
  await refuses(build(), code);
});
/** (p): a classic section whose `/Prev` chain holds 30 streams of 65,536 one-byte rows. */
function floodedChain() {
  const written = writeObjects(objects());
  const parts = [...written.parts];
  let pos = written.pos,
    prev: number | undefined;
  for (let i = 0; i < 30; i++) {
    const data = flate(Buffer.alloc(65536));
    const link = prev === undefined ? "" : ` /Prev ${String(prev)}`;
    const part = Buffer.concat([
      L(
        `${String(100 + i)} 0 obj\n<< /Type /XRef /Size 65536 /W [0 1 0]${link} /Filter /FlateDecode /Length ${String(data.length)} >>\nstream\n`,
      ),
      data,
      L("\nendstream\nendobj\n"),
    ]);
    prev = pos;
    parts.push(part);
    pos += part.length;
  }
  const trailer = "/Root 1 0 R /Prev " + String(prev);
  parts.push(
    L(
      `${classicXref(written.entries, 6, trailer)}startxref\n${String(pos)}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
it("BR-412 AC-02 cross-reference chain (p) 31 sections of 65,536 rows merged as they are read", async () => {
  const bytes = floodedChain();
  expect(await text(bytes)).toBe(T);
  const set = vi.spyOn(Map.prototype, "set");
  let inserts = 0;
  try {
    const { table } = readXref(
      bytes,
      terminalFrame(bytes),
      new Budget(16777216),
    );
    inserts = set.mock.calls.length;
    expect(table.size).toBe(65536);
  } finally {
    set.mockRestore();
  }
  expect(inserts).toBeLessThanOrEqual(65536 + 1024);
});

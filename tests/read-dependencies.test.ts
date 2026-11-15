import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { encodePng } from "./helpers/image-codecs.js";
import { extractPdf } from "../src/extraction-pdf.js";
import {
  CATALOG,
  PAGES,
  asciiCMap,
  hex2,
  pdf,
  stm,
  toUnicode,
  type Body,
} from "./helpers/pdf-corpus.js";
import { preflightPdf } from "../src/extraction-pdf-profile.js";
import { classicPdf } from "./helpers/extraction.js";
const require = createRequire(import.meta.url);
it("TestBR122_pure_js_dependencies pins exact producer source and dependency-free image codecs", () => {
  const directory = dirname(require.resolve("pdfjs-dist"));
  for (const [file, hash] of [
    [
      "pdf.mjs",
      "cbabeebf4df66f3fe736f2fa2792d332e019a878b0aa88d5e2be17d439079de4",
    ],
    [
      "pdf.worker.mjs",
      "43710009ea26bfbcb615524946e46e3aaf8ad927514f5e465e8ff6d18044ffe9",
    ],
  ])
    expect(
      createHash("sha256")
        .update(readFileSync(join(directory, file!)))
        .digest("hex"),
    ).toBe(hash);
  // BR-122 v3: the image codecs declare no dependencies, so the image route
  // loads no zod.
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    packages: Record<string, { version?: string; dependencies?: unknown }>;
  };
  for (const name of ["node_modules/pngjs", "node_modules/jpeg-js"]) {
    const entry = lock.packages[name];
    expect(entry, name).toBeDefined();
    expect(entry, name).not.toHaveProperty("dependencies");
  }
});
it("TestBR114_pdf_producer_admission exact dependency stress respects pre-admitted U/I", async () => {
  const operators = [
    `BT /F1 12 Tf 1 0 0 1 40 720 Tm (${"A".repeat(4096)}) Tj ET`,
    // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
    `BT /F1 12 Tf 1 0 0 1 40 720 Tm [${Array.from({ length: 150 }, (_, i) => `(\\200\\351) ${i % 2 ? -1000 : 1000}`).join(" ")}] TJ ET`,
    `BT /F1 12 Tf 1 0 0 1 40 720 Tm (one) Tj 0 -20 Td (two) ' 0 0 (three) " T* (four) Tj ET`,
  ];
  for (const content of operators) {
    const bytes = classicPdf([""], true, content),
      plan = await preflightPdf(bytes, 16777216, [1]);
    const value = await extractPdf({
      bytes,
      budget: 16777216,
      maxOutputChars: 200000,
      args: { format: "pdf", pages: [1] },
      metadata: {
        drive_id: 7,
        file_id: 3,
        etag: '"v1"',
        size_bytes: bytes.length,
      },
    });
    expect(Buffer.byteLength(value.text)).toBeLessThanOrEqual(
      plan.producerBytes,
    );
  }
  const equality = classicPdf(["a".repeat(600)]);
  const plan = await preflightPdf(equality, 16777216, [1]);
  const cap = Math.max(plan.producerBytes, plan.bytes.length);
  expect((await preflightPdf(equality, cap, [1])).producerBytes).toBe(
    plan.producerBytes,
  );
  await expect(
    preflightPdf(equality, plan.producerBytes - 1, [1]),
  ).rejects.toThrow("LIMIT_EXCEEDED");
});
/** F-034 AC-08: one page on the largest admissible box, font at 5, extra objects from 6. */
function producerPage(
  size: number,
  show: string,
  fonts: Body[],
  formed = false,
) {
  const x = size > 0 ? -900000 : 900000;
  const text = `BT 1 0 0 1 ${String(x)} 0 Tm ${show} ET`;
  const page = formed
    ? `/F1 ${String(size)} Tf /Fm Do`
    : `/F1 ${String(size)} Tf ${text}`;
  const objs: Body[] = [
    CATALOG,
    PAGES("3 0 R"),
    `<< /Type /Page /Parent 2 0 R /MediaBox [-1000000 -1000000 1000000 1000000] /Resources << /Font << /F1 5 0 R >> /XObject << /Fm ${String(5 + fonts.length)} 0 R >> >> /Contents 4 0 R >>`,
    stm("<< >>", page),
    ...fonts,
    stm(
      "<< /Type /XObject /Subtype /Form /BBox [-1000000 -1000000 1000000 1000000] >>",
      text,
    ),
  ];
  return pdf(objs).bytes;
}
const producerFonts: [string, string, Body[]][] = [
  [
    "Type0/ToUnicode",
    `<${hex2("Hello")}> Tj`,
    [
      "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R >>",
      stm("<< >>", asciiCMap),
      "<< /Type /FontDescriptor /FontName /X /Flags 32 >>",
    ],
  ],
  [
    "Differences",
    "[(AB) -200 (Hello)] TJ",
    [
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /u1F600 66 /fi] >> >>",
    ],
  ],
  [
    "Type3",
    "<01> Tj",
    [
      "<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0] /FirstChar 1 /LastChar 1 /Widths [1000] /Encoding << /Differences [1 /gid883] >> /ToUnicode 6 0 R >>",
      stm("<< >>", toUnicode([[1, String.fromCodePoint(0x1f600)]], 1)),
    ],
  ],
];
it.each(
  producerFonts.flatMap(([kind, show, fonts]) =>
    [-12, 0.5, 100000].flatMap((size) => [
      { kind, size, formed: false, show, fonts },
      { kind: `${kind} Form-inlined`, size, formed: true, show, fonts },
    ]),
  ),
)(
  "TestBR114_pdf_producer_admission exact dependency stress F-034 $kind at Tf size $size",
  async ({ size, formed, show, fonts }) => {
    const bytes = producerPage(size, show, fonts, formed),
      plan = await preflightPdf(bytes, 16777216, [1]);
    const value = await extractPdf({
      bytes,
      budget: 16777216,
      maxOutputChars: 200000,
      args: { format: "pdf", pages: [1] },
      metadata: {
        drive_id: 7,
        file_id: 3,
        etag: '"v1"',
        size_bytes: bytes.length,
      },
    });
    expect(value.text.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(value.text)).toBeLessThanOrEqual(
      plan.producerBytes,
    );
  },
);
it("TestBR122_pure_js_dependencies packed-runtime composition works with optional/native dependencies omitted", () => {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-extract-runtime-"));
  for (const file of ["package.json", "package-lock.json", "dist"])
    cpSync(file, join(directory, file), { recursive: true });
  execFileSync(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--omit=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: directory, stdio: "pipe", timeout: 45000 },
  );
  expect(existsSync(join(directory, "node_modules/@napi-rs/canvas"))).toBe(
    false,
  );
  const pdf = classicPdf(["Pure JS \\200\\351"], true),
    image = encodePng({ width: 2, height: 1, data: Buffer.alloc(8, 255) });
  writeFileSync(
    join(directory, "probe.mjs"),
    `import {runExtraction} from './dist/extraction.js';import {acquireExtraction} from './dist/extraction-admission.js';globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};const inputs=${JSON.stringify(
      [
        { format: "pdf", data: pdf.toString("base64") },
        { format: "image", data: Buffer.from(image).toString("base64") },
      ],
    )};const out=[];for(const input of inputs){const bytes=Uint8Array.from(Buffer.from(input.data,'base64'));const signal=new AbortController().signal;const permit=await acquireExtraction(undefined,signal,()=>{});try{const value=await runExtraction({bytes,args:{format:input.format},metadata:{drive_id:7,file_id:3,etag:'"v1"',size_bytes:bytes.length},budget:16777216,maxOutputChars:200000},signal,5000,{permit,deadline:performance.now()+5000});out.push({kind:value.kind,...(value.kind==='pdf'?{text:value.text}:{width:value.width,height:value.height})});}finally{permit.release();}}console.log(JSON.stringify(out));`,
  );
  const result = execFileSync(process.execPath, ["probe.mjs"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 15000,
  });
  expect(JSON.parse(result)).toEqual([
    { kind: "pdf", text: "Pure JS €é" },
    { kind: "image", width: 2, height: 1 },
  ]);
}, 60000);

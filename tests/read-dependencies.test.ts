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
import png from "@jimp/js-png";
import { createJimp } from "@jimp/core";
import { methods } from "@jimp/plugin-resize";
import { JimpClassSchema } from "@jimp/types";
import { ZodError } from "zod";
import { extractPdf } from "../src/extraction-pdf.js";
import { preflightPdf } from "../src/extraction-pdf-profile.js";
import { classicPdf } from "./helpers/extraction.js";
const require = createRequire(import.meta.url);
// BR-317 / BR-122 v2: the zod each Jimp schema package loads at run time.
function jimpZod(name: string): string {
  return createRequire(require.resolve(name)).resolve("zod");
}
it("TestBR122_pure_js_dependencies pins exact producer source, scalar-only Jimp schema surface and root Zod 4", () => {
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
  for (const name of ["@jimp/types", "@jimp/plugin-resize"]) {
    const code = readFileSync(
      join(dirname(require.resolve(name)), "../esm/index.js"),
      "utf8",
    );
    expect(code).not.toMatch(/z\.(?:array|record|map|set)\s*\(/u);
  }
  const types = readFileSync(
    join(dirname(require.resolve("@jimp/types")), "../esm/index.js"),
    "utf8",
  );
  expect(types).toContain("z.instanceof(Buffer)");
  expect(types).toContain("z.instanceof(Uint8Array)");
  const root = require.resolve("zod");
  const version = (
    JSON.parse(
      readFileSync(
        join(root.slice(0, root.lastIndexOf("/zod/") + 4), "package.json"),
        "utf8",
      ),
    ) as { version: string }
  ).version;
  expect(Number(version.split(".")[0])).toBeGreaterThanOrEqual(4);
  for (const name of ["@jimp/types", "@jimp/plugin-resize"])
    expect(jimpZod(name)).toBe(root);
});
it("TestBR317_jimp_on_root_zod Jimp schema packages resolve the root zod", () => {
  const root = require.resolve("zod");
  expect(jimpZod("@jimp/types")).toBe(root);
  expect(jimpZod("@jimp/plugin-resize")).toBe(root);
});
it("TestBR317_jimp_on_root_zod resize validation throws the root ZodError", () => {
  const Jimp = createJimp({ plugins: [methods], formats: [] });
  const image = new Jimp({ data: Buffer.alloc(16, 255), width: 2, height: 2 });
  let thrown: unknown;
  try {
    image.resize({ w: -1 });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ZodError);
  expect([image.bitmap.width, image.bitmap.height]).toEqual([2, 2]);
});
// Under skipLibCheck the declared schema type names Zod 3 types (BR-318), so
// the test reads it through the minimal surface it calls.
const jimpClassSchema = JimpClassSchema as unknown as {
  safeParse(value: unknown): { success: boolean };
};
it("TestBR317_jimp_on_root_zod JimpClassSchema refuses a bitmap whose data is not bytes", () => {
  expect(
    jimpClassSchema.safeParse({ bitmap: { data: "x", width: 1, height: 1 } })
      .success,
  ).toBe(false);
  expect(
    jimpClassSchema.safeParse({
      bitmap: { data: Buffer.alloc(4), width: 1, height: 1 },
    }).success,
  ).toBe(true);
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
      plan = preflightPdf(bytes, 16777216, [1]);
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
  const plan = preflightPdf(equality, 16777216, [1]);
  const cap = Math.max(plan.producerBytes, plan.bytes.length);
  expect(preflightPdf(equality, cap, [1]).producerBytes).toBe(
    plan.producerBytes,
  );
  expect(() => preflightPdf(equality, plan.producerBytes - 1, [1])).toThrow(
    "LIMIT_EXCEEDED",
  );
});
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
    image = png().encode({ width: 2, height: 1, data: Buffer.alloc(8, 255) });
  writeFileSync(
    join(directory, "probe.mjs"),
    `import {runExtraction} from './dist/extraction.js';globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};const inputs=${JSON.stringify(
      [
        { format: "pdf", data: pdf.toString("base64") },
        { format: "image", data: Buffer.from(image).toString("base64") },
      ],
    )};const out=[];for(const input of inputs){const bytes=Uint8Array.from(Buffer.from(input.data,'base64'));const value=await runExtraction({bytes,args:{format:input.format},metadata:{drive_id:7,file_id:3,etag:'"v1"',size_bytes:bytes.length},budget:16777216,maxOutputChars:200000},new AbortController().signal,5000);out.push({kind:value.kind,...(value.kind==='pdf'?{text:value.text}:{width:value.width,height:value.height})});}console.log(JSON.stringify(out));`,
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

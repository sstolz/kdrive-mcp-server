// F-018 AC-01, AC-02, AC-03, the AC-04 envelope and the AC-12 refusal
// (BR-060 v6, BR-279–BR-283, BR-287): `kdrive_upload` over the real MCP
// exchange, its strict arguments, content decoding and bound.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  createNavigationController,
  createNavigationServer,
} from "../src/navigation.js";
import {
  UNCERTAIN_MESSAGE,
  type GateResult,
  type GateRun,
  type MutationGate,
} from "../src/mutation-gate.js";
import { navigationFixture } from "./helpers/navigation.js";

const UPLOAD_SENTENCES = [
  "Uploads a file of at most 524,288 bytes, given as UTF-8 text or base64, into an authorized folder; the resulting path is checked.",
  "With overwrite false (the default), kDrive is asked to refuse an existing file of the same name (names are case-sensitive); this refusal is observed kDrive behaviour, not a guarantee of this server.",
  "With overwrite true, file_id must be the existing file called name in parent_id; its content is replaced in place and it keeps its ID.",
  "Use base64 for large or non-ASCII content: escaped text can exceed the transport message limit, which over stdio stops the server.",
];
const OVERWRITE_SENTENCE =
  "false (default): kDrive is asked to refuse an existing same-name file; observed behaviour, not guaranteed. true: replaces the content of file_id.";
const UNCERTAIN_SENTENCE =
  "If the result is uncertain, verify the item's state with a read tool before any new attempt.";
const MAX = 524_288;
const OP = "0123456789abcdef0123456789abcdef";

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
});

function scriptedGate(
  result: GateResult = { result: "succeeded", attempts: 1 },
) {
  const runs: GateRun[] = [];
  const gate: MutationGate = {
    run: vi.fn((request: GateRun) => {
      runs.push(request);
      return Promise.resolve(result);
    }),
    execute: () => Promise.resolve({ status: "unavailable" }),
    close: () => Promise.resolve(),
  };
  return { gate, runs };
}
async function connected(mode: string, gate?: MutationGate) {
  const f = await navigationFixture({ KDRIVE_MCP_MODE: mode });
  const server = createNavigationServer(f.config, f.dependencies, undefined, {
    ...(gate ? { gate } : {}),
    identity: { kind: "stdio" },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "upload-tool-test", version: "1" });
  await client.connect(clientSide);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return { f, client };
}
async function controller() {
  const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
  const scripted = scriptedGate();
  const c = createNavigationController(f.config, f.dependencies, undefined, {
    gate: scripted.gate,
  });
  cleanup.push(() => {
    c.close();
    return Promise.resolve();
  });
  const invoke = (args: unknown) =>
    c.invokeMutation("kdrive_upload", args, { kind: "stdio" });
  return { f, invoke, runs: scripted.runs, driveId: f.config.driveId };
}
const refusal = (code: string) => ({
  isError: true,
  content: [{ type: "text", text: code }],
});

describe("AC-01 registration, annotations and descriptions", () => {
  it.each([
    ["read", 10],
    ["write", 16],
    ["share", 16],
  ] as const)("TestBR060_v6_%s_mode_lists_%i_tools", async (mode, count) => {
    const { client } = await connected(mode);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(count);
    expect(names.includes("kdrive_upload")).toBe(mode !== "read");
    expect(
      (await client.listResourceTemplates()).resourceTemplates,
    ).toHaveLength(1);
    expect((await client.listResources()).resources).toEqual([]);
  });
  it.each(["write", "share"])(
    "TestBR282_%s_mode_upload_annotations",
    async (mode) => {
      const { client } = await connected(mode);
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === "kdrive_upload",
      );
      expect(tool?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    },
  );
  it("TestBR283_description_and_overwrite_sentence", async () => {
    const { client } = await connected("write");
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "kdrive_upload",
    );
    for (const sentence of [...UPLOAD_SENTENCES, UNCERTAIN_SENTENCE])
      expect(tool?.description).toContain(sentence);
    const overwrite = (
      tool?.inputSchema.properties as Record<string, { description?: string }>
    ).overwrite;
    expect(overwrite?.description).toContain(OVERWRITE_SENTENCE);
  });
});

describe("AC-02 strict arguments and the operation", () => {
  it.each([
    [{ parent_id: 5, name: "n", text: "hi" }, false],
    [{ drive_id: 9, parent_id: 5, name: "n", text: "hi" }, false],
    [{ parent_id: 5, name: "n", text: "hi", overwrite: false }, false],
    [
      { parent_id: 5, name: "n", base64: "aGk=", overwrite: true, file_id: 6 },
      true,
    ],
    [
      {
        drive_id: 9,
        parent_id: 5,
        name: "n",
        text: "hi",
        overwrite: true,
        file_id: 6,
      },
      true,
    ],
  ])("TestBR279_TestBR281_valid_%j", async (args, replace) => {
    const c = await controller();
    const result = await c.invoke(args);
    expect(result.isError).toBe(false);
    expect(c.runs).toHaveLength(1);
    const run = c.runs[0]!;
    expect(run.tool).toBe("kdrive_upload");
    expect(run.identity).toEqual({ kind: "stdio" });
    const driveId = (args as { drive_id?: number }).drive_id ?? c.driveId;
    expect(run.operation).toEqual(
      replace
        ? {
            kind: "replace",
            target: { driveId, id: 6 },
            destination: { driveId, id: 5 },
            name: "n",
          }
        : { kind: "upload-new", destination: { driveId, id: 5 }, name: "n" },
    );
    expect(Buffer.isBuffer(run.payload)).toBe(true);
    expect((run.payload as Buffer).toString()).toBe("hi");
  });
  const base = { parent_id: 5, name: "n", text: "x" };
  it.each([
    ["extra member", { ...base, extra: 1 }],
    ["both forms", { ...base, base64: "eA==" }],
    ["neither form", { parent_id: 5, name: "n" }],
    ["string overwrite", { ...base, overwrite: "true" }],
    ["overwrite without file_id", { ...base, overwrite: true }],
    ["file_id without overwrite", { ...base, file_id: 6 }],
    ["file_id with overwrite false", { ...base, overwrite: false, file_id: 6 }],
    ["parent_id 0", { ...base, parent_id: 0 }],
    ["parent_id unsafe", { ...base, parent_id: 2 ** 53 }],
    ["parent_id string", { ...base, parent_id: "5" }],
    ["parent_id missing", { name: "n", text: "x" }],
    ["drive_id 0", { ...base, drive_id: 0 }],
    ["file_id 1.5", { ...base, overwrite: true, file_id: 1.5 }],
    ["text number", { ...base, text: 1 }],
    ...["", ".", "..", "a/b", "a\\b", "a\u0001", " a", "a ", "a\uD800"].map(
      (name) => [`name ${JSON.stringify(name)}`, { ...base, name }],
    ),
  ] as [string, unknown][])(
    "TestBR279_%s_is_INVALID_ARGUMENTS",
    async (_label, args) => {
      const c = await controller();
      expect(await c.invoke(args)).toEqual(refusal("INVALID_ARGUMENTS"));
      expect(c.runs).toHaveLength(0);
      expect(c.f.inspect).not.toHaveBeenCalled();
      expect(c.f.execute).not.toHaveBeenCalled();
    },
  );
});

describe("AC-03 content decoding, bound and order", () => {
  const base = { parent_id: 5, name: "n" };
  const payload = async (args: Record<string, unknown>) => {
    const c = await controller();
    const result = await c.invoke({ ...base, ...args });
    return { result, runs: c.runs };
  };
  it("TestBR280_text_is_UTF8", async () => {
    const { runs } = await payload({ text: "é😀" });
    expect([...(runs[0]?.payload as Buffer)]).toEqual([
      0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80,
    ]);
  });
  it.each([
    ["text lone surrogate", { text: "a\uD800b" }],
    ["base64 whitespace", { base64: "QQ== " }],
    ["base64 inner newline", { base64: "QUFB\nQUFB" }],
    ["base64 URL-safe", { base64: "-_-_" }],
    ["base64 missing padding", { base64: "QQ" }],
    ["base64 nonzero pad bits", { base64: "QR==" }],
    ["base64 one character", { base64: "Q" }],
    ["base64 stray padding", { base64: "Q===" }],
  ])("TestBR280_%s_is_INVALID_ARGUMENTS", async (_label, args) => {
    const { result, runs } = await payload(args);
    expect(result).toEqual(refusal("INVALID_ARGUMENTS"));
    expect(runs).toHaveLength(0);
  });
  it("TestBR280_canonical_base64_decodes", async () => {
    const { runs } = await payload({ base64: "QQ==" });
    expect([...(runs[0]?.payload as Buffer)]).toEqual([0x41]);
  });
  it.each([
    ["text", { text: "a".repeat(MAX) }],
    ["base64", { base64: Buffer.alloc(MAX, 7).toString("base64") }],
  ])(
    "TestBR280_exactly_524288_bytes_as_%s_makes_one_call",
    async (_l, args) => {
      const { runs } = await payload(args);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.payload as Buffer).toHaveLength(MAX);
    },
  );
  it.each([
    ["text", { text: "a".repeat(MAX + 1) }],
    ["multibyte text", { text: "é".repeat(MAX / 2) + "a" }],
    ["base64", { base64: Buffer.alloc(MAX + 1, 7).toString("base64") }],
  ])("TestBR280_524289_bytes_as_%s_is_LIMIT_EXCEEDED", async (_l, args) => {
    const { result, runs } = await payload(args);
    expect(result).toEqual(refusal("LIMIT_EXCEEDED"));
    expect(runs).toHaveLength(0);
  });
  it.each([
    [
      "non-canonical oversized base64",
      { base64: `${Buffer.alloc(MAX + 3, 7).toString("base64")} ` },
    ],
    [
      "oversized base64 with a URL-safe character",
      {
        base64: `-${Buffer.alloc(MAX + 3, 7)
          .toString("base64")
          .slice(1)}`,
      },
    ],
    [
      "oversized text with a lone surrogate",
      { text: `${"a".repeat(MAX + 1)}\uD800` },
    ],
    [
      "extra member with oversized content",
      { text: "a".repeat(MAX + 1), x: 1 },
    ],
  ])("TestBR280_order_%s_is_INVALID_ARGUMENTS", async (_l, args) => {
    const { result, runs } = await payload(args);
    expect(result).toEqual(refusal("INVALID_ARGUMENTS"));
    expect(runs).toHaveLength(0);
  });
  it.each([{ text: "" }, { base64: "" }])(
    "TestBR280_empty_content_%j_is_a_0_byte_payload",
    async (args) => {
      const { runs } = await payload(args);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.payload as Buffer).toHaveLength(0);
    },
  );
});

describe("AC-04 the gate result envelope", () => {
  const results: GateResult[] = [
    {
      result: "succeeded",
      op: OP,
      attempts: 1,
      status: 200,
      value: { drive_id: 7, id: 3, size: 1, action: "created" },
    },
    {
      result: "failed",
      op: OP,
      code: "UPSTREAM_REJECTED",
      attempts: 1,
      status: 409,
    },
    {
      result: "uncertain",
      op: OP,
      code: "UPSTREAM_UNCERTAIN",
      attempts: 1,
      message: UNCERTAIN_MESSAGE,
    },
    { result: "denied", op: OP, code: "ACCESS_DENIED", attempts: 0 },
  ];
  it.each(results)(
    "TestBR281_a_$result_gate_result_is_one_text_item",
    async (gateResult) => {
      const { gate, runs } = scriptedGate(gateResult);
      const { client } = await connected("write", gate);
      const result = await client.callTool({
        name: "kdrive_upload",
        arguments: { parent_id: 5, name: "n", text: "x" },
      });
      expect(runs).toHaveLength(1);
      const content = result.content as { type: string; text: string }[];
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(JSON.parse(content[0]?.text ?? "")).toEqual(gateResult);
      expect(result.isError === true).toBe(gateResult.result !== "succeeded");
    },
  );
  it("TestBR279_read_mode_has_no_upload", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "read" });
    const { gate, runs } = scriptedGate();
    const c = createNavigationController(f.config, f.dependencies, undefined, {
      gate,
    });
    expect(
      await c.invokeMutation(
        "kdrive_upload",
        { parent_id: 5, name: "n", text: "x" },
        { kind: "stdio" },
      ),
    ).toEqual(refusal("ACCESS_DENIED"));
    expect(runs).toHaveLength(0);
    c.close();
  });
});

describe("AC-12 owner-run upload acceptance refusal", () => {
  const ENTRY = "scripts/kdrive-entry.sh";
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "kdrive-upload-entry-"));
    copyFileSync("Makefile", join(root, "Makefile"));
    mkdirSync(join(root, "scripts"));
    copyFileSync(ENTRY, join(root, ENTRY));
    for (const file of [
      "compose.yaml",
      "Dockerfile.dev",
      "package.json",
      "package-lock.json",
    ])
      writeFileSync(join(root, file), "fixture\n");
    writeFileSync(join(root, ".gitignore"), "bin/\ncalls\n");
    const docker = join(root, "bin/docker");
    mkdirSync(join(root, "bin"));
    writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n');
    chmodSync(docker, 0o755);
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
        { cwd: root, stdio: "ignore" },
      );
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    const dir = join(
      mkdtempSync(join(tmpdir(), "kdrive-upload-outside-")),
      "a",
    );
    mkdirSync(dir);
    writeFileSync(join(dir, "kdrive-token"), "SYNTHETIC_TOKEN\n");
    writeFileSync(join(dir, "fixtures.json"), "{}\n");
    return { root, dir, docker, log: join(root, "calls") };
  }
  const run = (f: ReturnType<typeof fixture>, extra: string[]) =>
    spawnSync(
      "make",
      ["kdrive-upload-acceptance", `DOCKER=${f.docker}`, ...extra],
      {
        cwd: f.root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          FAKE_LOG: f.log,
          KDRIVE_ACCEPTANCE_DIR: f.dir,
        },
      },
    );
  it.each([undefined, "", "0", "012", "-5", "5a", "1234567890123456", "1'x"])(
    "TestBR287_KDRIVE_WRITE_FOLDER_%j_refuses_before_any_Docker_command",
    (folder) => {
      const f = fixture();
      const result = run(
        f,
        folder === undefined ? [] : [`KDRIVE_WRITE_FOLDER=${folder}`],
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Set KDRIVE_WRITE_FOLDER to a positive decimal folder ID.\n",
      );
      expect(existsSync(f.log) ? readFileSync(f.log, "utf8") : "").toBe("");
    },
  );
  it("TestBR287_a_valid_folder_on_actual_main_runs_the_upload_script", () => {
    const f = fixture();
    const result = run(f, ["KDRIVE_WRITE_FOLDER=42"]);
    expect(result.status).toBe(0);
    const calls = readFileSync(f.log, "utf8");
    expect(calls).toContain("KDRIVE_WRITE_FOLDER=42");
    expect(calls).toContain("node scripts/kdrive-upload-acceptance.ts");
    expect(calls).toContain(":/run/kdrive-acceptance:ro");
  });
});

// F-018 v2 (#91): NFC names (BR-279 v2) and the NFC sentence (BR-283 v2).
const NFC_SENTENCE =
  "name must be in Unicode NFC (composed form); other forms are refused.";
const REFUSED_NAMES: [string, string][] = [
  ["NFD e+U+0301", "e\u0301"],
  ["mixed U+00E9-e+U+0301", "\u00E9-e\u0301"],
  ["Hangul jamo", "\u1112\u1161\u11AB"],
  ["ANGSTROM SIGN U+212B", "\u212B"],
];
const ACCEPTED_NAMES: [string, string][] = [
  ["U+00E9", "\u00E9"],
  ["ASCII", "plain.txt"],
  ["U+00C5", "\u00C5"],
  ["q+U+0307", "q\u0307"],
  ["Hangul syllable U+D55C", "\uD55C"],
  ["ligature U+FB01", "\uFB01"],
];

describe("F-018 v2 AC-14 NFC names for kdrive_upload", () => {
  it.each(REFUSED_NAMES)(
    "TestBR279_v2_%s_is_INVALID_ARGUMENTS",
    async (_label, name) => {
      const c = await controller();
      expect(await c.invoke({ parent_id: 5, name, text: "x" })).toEqual(
        refusal("INVALID_ARGUMENTS"),
      );
      expect(c.runs).toHaveLength(0);
      expect(c.f.inspect).not.toHaveBeenCalled();
    },
  );
  it("TestBR279_v2_an_NFD_name_with_oversized_content_is_INVALID_ARGUMENTS", async () => {
    const c = await controller();
    expect(
      await c.invoke({
        parent_id: 5,
        name: "e\u0301",
        text: "a".repeat(MAX + 1),
      }),
    ).toEqual(refusal("INVALID_ARGUMENTS"));
    expect(c.runs).toHaveLength(0);
  });
  it.each(ACCEPTED_NAMES)(
    "TestBR279_v2_%s_makes_one_gate_run_with_that_name",
    async (_label, name) => {
      const c = await controller();
      await c.invoke({ parent_id: 5, name, text: "x" });
      expect(c.runs).toHaveLength(1);
      expect((c.runs[0]?.operation as { name: string }).name).toBe(name);
    },
  );
  it("TestBR283_v2_upload_description_holds_the_NFC_sentence", async () => {
    const { client } = await connected("write");
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "kdrive_upload",
    );
    expect(tool?.description).toContain(NFC_SENTENCE);
  });
});

// F-018 v3 (#100) AC-18 regression: sharing the name validator with
// create_folder and rename leaves the BR-279 v2 refusal unchanged.
describe("F-018 v3 AC-18 kdrive_upload lone surrogate regression", () => {
  it.each([
    ["lone_high_at_end", "a\uD800"],
    ["lone_low_alone", "\uDC00"],
    ["lone_high_at_start", "\uD800a"],
    ["lone_high_inside", "a\uD800b"],
    ["lone_low_inside", "x\uDFFFy"],
  ])(
    "TestBR279_lone_surrogate_regression_%s_is_INVALID_ARGUMENTS",
    async (_label, name) => {
      const c = await controller();
      expect(await c.invoke({ parent_id: 5, name, text: "x" })).toEqual(
        refusal("INVALID_ARGUMENTS"),
      );
      expect(c.runs).toHaveLength(0);
      expect(c.f.inspect).not.toHaveBeenCalled();
    },
  );
});

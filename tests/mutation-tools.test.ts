// F-017 AC-01, AC-02, AC-03 and the AC-15 refusal (BR-060 v5, BR-260–BR-263,
// BR-275, BR-276): the five mutation tools over the real MCP exchange, their
// strict arguments and their result envelope.
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
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  createNavigationController,
  createNavigationServer,
} from "../src/navigation.js";
import { startStdioNavigation } from "../src/stdio.js";
import {
  UNCERTAIN_MESSAGE,
  type GateResult,
  type GateRun,
  type MutationGate,
} from "../src/mutation-gate.js";
import { navigationFixture } from "./helpers/navigation.js";

const READ_TOOLS = [
  "kdrive_list_drives",
  "kdrive_list",
  "kdrive_search",
  "kdrive_recents",
  "kdrive_my_shared",
  "kdrive_shared_with_me",
  "kdrive_info",
  "kdrive_read",
  "kdrive_download",
  "kdrive_resolve_path",
];
const WRITE_TOOLS = [
  "kdrive_create_folder",
  "kdrive_rename",
  "kdrive_move",
  "kdrive_trash",
  "kdrive_restore",
];
const SENTENCES: Record<string, string> = {
  kdrive_create_folder: "Creates a folder in an authorized folder.",
  kdrive_rename:
    "Renames a file or folder in place; the current and resulting paths, and a folder's descendants, are checked.",
  kdrive_move:
    "Moves a file or folder to another folder of the same drive; the current and resulting paths, and a folder's descendants, are checked.",
  kdrive_trash:
    "Moves a file or folder to the kDrive trash; it never deletes permanently. A trashed folder cannot be restored through this server while deny patterns are configured.",
  kdrive_restore:
    "Restores a trashed item to its former folder only when that folder is live and authorized; otherwise the restore is refused. A folder restore is refused while deny patterns are configured.",
};
const UNCERTAIN_SENTENCE =
  "If the result is uncertain, verify the item's state with a read tool before any new attempt.";
const OP = "0123456789abcdef0123456789abcdef";

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
});

/** A scripted gate: records each run and answers `result`. */
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
async function connected(
  mode: string,
  gate?: MutationGate,
  env: Record<string, string> = {},
) {
  const f = await navigationFixture({ KDRIVE_MCP_MODE: mode, ...env });
  const server = createNavigationServer(f.config, f.dependencies, undefined, {
    ...(gate ? { gate } : {}),
    identity: { kind: "stdio" },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "mutation-tools-test", version: "1" });
  await client.connect(clientSide);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return { f, client };
}

describe("AC-01 registration, annotations and descriptions", () => {
  it.each(["read", "write", "share"])(
    // F-018 BR-060 v6: write and share also list kdrive_upload.
    "TestBR060_v6_%s_mode_lists_its_exact_tools",
    async (mode) => {
      const { client } = await connected(mode);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(
        mode === "read"
          ? READ_TOOLS
          : [...READ_TOOLS, ...WRITE_TOOLS, "kdrive_upload"],
      );
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates).toHaveLength(1);
      expect((await client.listResources()).resources).toEqual([]);
    },
  );
  it.each(["write", "share"])(
    "TestBR261_%s_mode_mutation_annotations",
    async (mode) => {
      const { client } = await connected(mode);
      const { tools } = await client.listTools();
      for (const name of WRITE_TOOLS)
        expect(tools.find((t) => t.name === name)?.annotations).toEqual({
          readOnlyHint: false,
          destructiveHint: name === "kdrive_trash",
          idempotentHint: false,
          openWorldHint: true,
        });
    },
  );
  it("TestBR263_each_description_holds_its_fixed_sentences", async () => {
    const { client } = await connected("write");
    const { tools } = await client.listTools();
    for (const name of WRITE_TOOLS) {
      const description = tools.find((t) => t.name === name)?.description;
      expect(description).toContain(SENTENCES[name]);
      expect(description).toContain(UNCERTAIN_SENTENCE);
    }
  });
});

describe("AC-02 strict arguments and the Tool table", () => {
  const valid: [string, Record<string, unknown>, unknown][] = [
    [
      "kdrive_create_folder",
      { parent_id: 4, name: "new" },
      {
        kind: "create",
        destination: { driveId: 7, id: 4 },
        name: "new",
        type: "dir",
      },
    ],
    [
      "kdrive_rename",
      { file_id: 3, name: "renamed" },
      { kind: "rename", target: { driveId: 7, id: 3 }, name: "renamed" },
    ],
    [
      "kdrive_move",
      { file_id: 3, destination_folder_id: 4 },
      {
        kind: "move",
        target: { driveId: 7, id: 3 },
        destination: { driveId: 7, id: 4 },
      },
    ],
    [
      "kdrive_trash",
      { file_id: 3 },
      { kind: "trash", target: { driveId: 7, id: 3 } },
    ],
    [
      "kdrive_restore",
      { file_id: 3 },
      { kind: "restore", target: { driveId: 7, id: 3 } },
    ],
  ];
  const onDrive = (value: unknown, driveId: number): unknown =>
    JSON.parse(
      JSON.stringify(value).replaceAll(
        '"driveId":7',
        `"driveId":${String(driveId)}`,
      ),
    );
  it.each(valid)(
    "TestBR260_%s_builds_the_Tool_table_operation",
    async (name, args, operation) => {
      const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
      const { gate, runs } = scriptedGate();
      const c = createNavigationController(
        f.config,
        f.dependencies,
        undefined,
        {
          gate,
        },
      );
      await c.invokeMutation(name, args, { kind: "stdio" });
      await c.invokeMutation(name, { ...args, drive_id: 9 }, { kind: "stdio" });
      expect(runs.map((r) => [r.tool, r.operation])).toEqual([
        [name, operation],
        [name, onDrive(operation, 9)],
      ]);
      c.close();
    },
  );
  const ids = [0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, "5", null];
  const names = ["", ".", "..", "a/b", "a\\b", "a\u0001b", " a", "a ", "\ta"];
  const invalid: [string, Record<string, unknown>][] = [
    [
      "kdrive_move",
      { file_id: 3, destination_folder_id: 4, destination_drive_id: 9 },
    ],
    ["kdrive_move", { file_id: 3, destination_folder_id: 4, name: "x" }],
    ["kdrive_restore", { file_id: 3, destination_folder_id: 4 }],
    ["kdrive_restore", { file_id: 3, name: "x" }],
    ["kdrive_trash", { file_id: 3, extra: true }],
    ["kdrive_create_folder", { parent_id: 4 }],
    ["kdrive_create_folder", { name: "x" }],
    ["kdrive_rename", { file_id: 3 }],
    ["kdrive_move", { file_id: 3 }],
    ["kdrive_trash", {}],
    ["kdrive_restore", {}],
    ...ids.flatMap((id): [string, Record<string, unknown>][] => [
      ["kdrive_trash", { file_id: id }],
      ["kdrive_restore", { file_id: 3, drive_id: id }],
      ["kdrive_create_folder", { parent_id: id, name: "x" }],
      ["kdrive_move", { file_id: 3, destination_folder_id: id }],
    ]),
    ...names.flatMap((name): [string, Record<string, unknown>][] => [
      ["kdrive_create_folder", { parent_id: 4, name }],
      ["kdrive_rename", { file_id: 3, name }],
    ]),
  ];
  it.each(invalid)("TestBR260_TestBR275_%s_refuses_%j", async (name, args) => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const { gate, runs } = scriptedGate();
    const c = createNavigationController(f.config, f.dependencies, undefined, {
      gate,
    });
    expect(await c.invokeMutation(name, args, { kind: "stdio" })).toEqual({
      isError: true,
      content: [{ type: "text", text: "INVALID_ARGUMENTS" }],
    });
    expect(runs).toHaveLength(0);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    c.close();
  });
  it("TestBR260_an_invalid_call_over_MCP_makes_zero_gate_runs", async () => {
    const { gate, runs } = scriptedGate();
    const { client, f } = await connected("write", gate);
    const result = await client.callTool({
      name: "kdrive_rename",
      arguments: { file_id: 3, name: " x" },
    });
    expect(result.isError).toBe(true);
    expect(runs).toHaveLength(0);
    expect(f.inspect).not.toHaveBeenCalled();
  });
});

describe("AC-03 one mutate call and the gate result envelope", () => {
  const results: GateResult[] = [
    {
      result: "succeeded",
      op: OP,
      attempts: 1,
      status: 200,
      value: { drive_id: 7, id: 3 },
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
    "TestBR262_a_$result_gate_result_is_one_text_item",
    async (gateResult) => {
      const { gate, runs } = scriptedGate(gateResult);
      const { client } = await connected("write", gate);
      const result = await client.callTool({
        name: "kdrive_trash",
        arguments: { file_id: 3 },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.tool).toBe("kdrive_trash");
      expect(runs[0]?.identity).toEqual({ kind: "stdio" });
      expect(runs[0]?.payload).toBeUndefined();
      const content = result.content as { type: string; text: string }[];
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(JSON.parse(content[0]?.text ?? "")).toEqual(gateResult);
      expect(result.isError === true).toBe(gateResult.result !== "succeeded");
    },
  );
  it("TestBR262_the_call_signal_reaches_the_run_cancellation", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    let seen: AbortSignal | undefined;
    const controller = new AbortController();
    const gate: MutationGate = {
      run: (request) => {
        expect(request.cancellation?.aborted).toBe(false);
        controller.abort();
        seen = request.cancellation;
        return Promise.resolve({ result: "succeeded", attempts: 1 });
      },
      execute: () => Promise.resolve({ status: "unavailable" }),
      close: () => Promise.resolve(),
    };
    const c = createNavigationController(f.config, f.dependencies, undefined, {
      gate,
    });
    await c.invokeMutation(
      "kdrive_trash",
      { file_id: 3 },
      { kind: "stdio" },
      controller.signal,
    );
    expect(seen?.aborted).toBe(true);
    c.close();
  });
  it("TestBR262_stdio_carries_a_non_success_gate_result_unchanged", async () => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const uncertain = results[2] as GateResult;
    const { gate } = scriptedGate(uncertain);
    const input = new PassThrough(),
      output = new PassThrough();
    let stdout = "";
    output.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    const session = startStdioNavigation(f.config, f.dependencies, {
      input,
      output,
      signals: false,
      diagnostic: () => undefined,
      setExitCode: () => undefined,
      gate,
    });
    cleanup.push(() => session.close());
    await session.ready;
    const send = (m: unknown) => input.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    for (let i = 0; i < 500 && !stdout.includes('"id":1'); i++)
      await new Promise((r) => setTimeout(r, 2));
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kdrive_trash", arguments: { file_id: 3 } },
    });
    let response:
      | { result?: { isError?: boolean; content: { text: string }[] } }
      | undefined;
    for (let i = 0; i < 500 && !response; i++) {
      response = stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id?: number; result?: never })
        .find((m) => m.id === 2);
      if (!response) await new Promise((r) => setTimeout(r, 2));
    }
    expect(stdout).toContain('"id":2');
    expect(response?.result?.isError).toBe(true);
    expect(JSON.parse(response?.result?.content[0]?.text ?? "")).toEqual(
      uncertain,
    );
  });
});

describe("AC-15 owner-run write acceptance refusal", () => {
  const ENTRY = "scripts/kdrive-entry.sh";
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "kdrive-write-entry-"));
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
        {
          cwd: root,
          stdio: "ignore",
        },
      );
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    const dir = join(mkdtempSync(join(tmpdir(), "kdrive-write-outside-")), "a");
    mkdirSync(dir);
    writeFileSync(join(dir, "kdrive-token"), "SYNTHETIC_TOKEN\n");
    writeFileSync(join(dir, "fixtures.json"), "{}\n");
    return { root, dir, docker, log: join(root, "calls") };
  }
  it.each([
    undefined,
    "",
    "0",
    "012",
    "-5",
    "5a",
    "1.5",
    "1234567890123456",
    "1'x",
  ])(
    "TestBR276_KDRIVE_WRITE_FOLDER_%j_refuses_before_any_Docker_command",
    (folder) => {
      const f = fixture();
      const result = spawnSync(
        "make",
        [
          "kdrive-write-acceptance",
          `DOCKER=${f.docker}`,
          ...(folder === undefined ? [] : [`KDRIVE_WRITE_FOLDER=${folder}`]),
        ],
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
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Set KDRIVE_WRITE_FOLDER to a positive decimal folder ID.\n",
      );
      expect(existsSync(f.log) ? readFileSync(f.log, "utf8") : "").toBe("");
    },
  );
  it("TestBR276_a_valid_folder_on_actual_main_runs_the_write_script", () => {
    const f = fixture();
    const result = spawnSync(
      "make",
      [
        "kdrive-write-acceptance",
        `DOCKER=${f.docker}`,
        "KDRIVE_WRITE_FOLDER=42",
      ],
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
    expect(result.status).toBe(0);
    const calls = readFileSync(f.log, "utf8");
    expect(calls).toContain("KDRIVE_WRITE_FOLDER=42");
    expect(calls).toContain("node scripts/kdrive-write-acceptance.ts");
    expect(calls).toContain(":/run/kdrive-acceptance:ro");
  });
});

// F-018 v2 (#91): NFC names for create_folder and rename (BR-260 v2) and
// the NFC sentence in their descriptions (BR-263 v2).
const NFC_SENTENCE =
  "name must be in Unicode NFC (composed form); other forms are refused.";
/** The create_folder and rename calls of one `name` (F-018 v2 and v3). */
const calls = (name: string) =>
  [
    ["kdrive_create_folder", { parent_id: 5, name }],
    ["kdrive_rename", { file_id: 6, name }],
  ] as const;
/** A write-mode controller over a scripted gate. */
async function controller() {
  const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
  const { gate, runs } = scriptedGate();
  const c = createNavigationController(f.config, f.dependencies, undefined, {
    gate,
  });
  cleanup.push(() => {
    c.close();
    return Promise.resolve();
  });
  return { f, c, runs };
}
describe("F-018 v2 AC-14 AC-15 NFC names for create_folder and rename", () => {
  const refused: [string, string][] = [
    ["NFD e+U+0301", "e\u0301"],
    ["mixed U+00E9-e+U+0301", "\u00E9-e\u0301"],
    ["Hangul jamo", "\u1112\u1161\u11AB"],
    ["ANGSTROM SIGN U+212B", "\u212B"],
  ];
  const accepted: [string, string][] = [
    ["U+00E9", "\u00E9"],
    ["ASCII", "plain"],
    ["U+00C5", "\u00C5"],
    ["q+U+0307", "q\u0307"],
    ["Hangul syllable U+D55C", "\uD55C"],
    ["ligature U+FB01", "\uFB01"],
  ];
  it.each(refused)("TestBR260_v2_%s_is_INVALID_ARGUMENTS", async (_l, name) => {
    for (const [tool, args] of calls(name)) {
      const { f, c, runs } = await controller();
      expect(await c.invokeMutation(tool, args, { kind: "stdio" })).toEqual({
        isError: true,
        content: [{ type: "text", text: "INVALID_ARGUMENTS" }],
      });
      expect(runs).toHaveLength(0);
      expect(f.inspect).not.toHaveBeenCalled();
    }
  });
  it.each(accepted)(
    "TestBR260_v2_%s_makes_one_gate_run_with_that_name",
    async (_l, name) => {
      for (const [tool, args] of calls(name)) {
        const { c, runs } = await controller();
        await c.invokeMutation(tool, args, { kind: "stdio" });
        expect(runs).toHaveLength(1);
        expect((runs[0]?.operation as { name: string }).name).toBe(name);
      }
    },
  );
  it("TestBR263_v2_create_and_rename_descriptions_hold_the_NFC_sentence", async () => {
    const { client } = await connected("write");
    const { tools } = await client.listTools();
    for (const name of ["kdrive_create_folder", "kdrive_rename"])
      expect(tools.find((t) => t.name === name)?.description).toContain(
        NFC_SENTENCE,
      );
    for (const name of ["kdrive_move", "kdrive_trash", "kdrive_restore"])
      expect(tools.find((t) => t.name === name)?.description).not.toContain(
        NFC_SENTENCE,
      );
  });
});

describe("F-018 v2 NFC check runs after the name bound", () => {
  it("TestBR260_v2_an_overlong_non_NFC_name_is_refused_without_normalize", async () => {
    // 1,366 x ("e" + U+0301) = 4,098 UTF-8 bytes, over the 4,096-byte bound.
    const name = "e\u0301".repeat(1366);
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const { gate, runs } = scriptedGate();
    const c = createNavigationController(f.config, f.dependencies, undefined, {
      gate,
    });
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      for (const [tool, args] of [
        ["kdrive_create_folder", { parent_id: 5, name }],
        ["kdrive_rename", { file_id: 6, name }],
        ["kdrive_upload", { parent_id: 5, name, text: "x" }],
      ] as const)
        expect(await c.invokeMutation(tool, args, { kind: "stdio" })).toEqual({
          isError: true,
          content: [{ type: "text", text: "INVALID_ARGUMENTS" }],
        });
      expect(normalize).not.toHaveBeenCalled();
    } finally {
      normalize.mockRestore();
      c.close();
    }
    expect(runs).toHaveLength(0);
  });
});

// F-018 v3 (#100): well-formed UTF-16 names for create_folder and rename
// (BR-260 v3). Names are escaped code units: a lone surrogate cannot render.
describe("F-018 v3 AC-18 well-formed names for create_folder and rename", () => {
  const refused: [string, string][] = [
    ["a+lone_high_at_end", "a\uD800"],
    ["lone_low_alone", "\uDC00"],
    ["lone_high_at_start", "\uD800a"],
    ["lone_high_inside", "a\uD800b"],
    ["lone_low_inside", "x\uDFFFy"],
    ["reversed_pair", "\uDC00\uD800"],
    ["high_then_valid_pair", "a\uD83D😀"],
  ];
  const accepted: [string, string][] = [
    ["emoji_U+1F600", "😀"],
    ["a+emoji+b", "a😀b"],
  ];
  it.each(refused)(
    "TestBR260_v3_%s_lone_surrogate_name_is_INVALID_ARGUMENTS",
    async (_l, name) => {
      for (const [tool, args] of calls(name)) {
        const { f, c, runs } = await controller();
        expect(await c.invokeMutation(tool, args, { kind: "stdio" })).toEqual({
          isError: true,
          content: [{ type: "text", text: "INVALID_ARGUMENTS" }],
        });
        // Zero gate runs: the scripted gate is the only route to a record
        // or an upstream mutation; no read port is touched either.
        expect(runs).toHaveLength(0);
        expect(f.inspect).not.toHaveBeenCalled();
        expect(f.dependencies.collection).not.toHaveBeenCalled();
        expect(f.dependencies.children).not.toHaveBeenCalled();
        expect(f.dependencies.execute).not.toHaveBeenCalled();
      }
    },
  );
  it.each(accepted)(
    "TestBR260_v3_%s_surrogate_pair_name_makes_one_gate_run_with_that_name",
    async (_l, name) => {
      for (const [tool, args] of calls(name)) {
        const { c, runs } = await controller();
        await c.invokeMutation(tool, args, { kind: "stdio" });
        expect(runs).toHaveLength(1);
        expect((runs[0]?.operation as { name: string }).name).toBe(name);
      }
    },
  );
});

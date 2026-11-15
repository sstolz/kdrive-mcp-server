// F-017 AC-04–AC-07, AC-13, AC-14 (BR-274, BR-034, BR-035, BR-036, BR-039 v2,
// BR-234, BR-251, BR-257, BR-271, BR-275, BR-278): the production composition
// `main(deps)` with the real mutators, over the injected loopback transport.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GateResult, MutationGate } from "../src/mutation-gate.js";
import {
  DRIVE,
  kdriveFixture,
  notFound,
  providerItem,
  success,
  type Node,
  type Reply,
  type Seen,
} from "./helpers/kdrive.js";
import { runMain, stdioClient, tokenFile } from "./helpers/main.js";

const hooks = vi.hoisted(() => ({
  gates: [] as { options: { mutators?: unknown }; gate: MutationGate }[],
}));
vi.mock("../src/mutation-gate.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/mutation-gate.js")>();
  return {
    ...original,
    createMutationGate: (
      options: Parameters<typeof original.createMutationGate>[0],
    ) => {
      const gate = original.createMutationGate(options);
      hooks.gates.push({ options, gate });
      return gate;
    },
  };
});

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
  hooks.gates = [];
});

const dir = (id: number, parent: number, name: string): Node => ({
  id,
  parent,
  type: "dir",
  name,
});
const file = (id: number, parent: number, name: string): Node => ({
  id,
  parent,
  type: "file",
  name,
  size: 1,
});
const TREE: Node[] = [
  dir(10, 1, "P"),
  dir(11, 10, "x"),
  dir(12, 11, "secret"),
  file(13, 12, "k"),
  dir(20, 1, "Q"),
  file(21, 20, "y"),
  dir(30, 1, "D"),
  dir(40, 1, "R40"),
  file(41, 40, "c"),
];
const ACTION = { cancel_id: "CANCELMARK-0001", valid_until: 1_800_000_000 };
/** Mutation replies of the fake drive; reads fall through to the tree. */
function mutationReply(names: { create: string }) {
  return (r: Seen): Reply | undefined => {
    if (r.method === "GET") return undefined;
    const parts = r.path.split("/");
    if (r.path.endsWith("/directory"))
      return success({
        id: 99,
        type: "dir",
        name: names.create,
        parent_id: Number(parts[5]),
      });
    return success(ACTION);
  };
}
interface Options {
  readonly env?: Record<string, string>;
  readonly nodes?: Node[];
  readonly drives?: { id: number; role: string }[];
  readonly create?: string;
  readonly overrides?: ((r: Seen) => Reply | undefined)[];
  readonly shared?: Record<string, unknown>[];
}
async function compose(options: Options = {}) {
  const f = await kdriveFixture({
    nodes: options.nodes ?? [...TREE],
    ...(options.drives ? { drives: options.drives } : {}),
    ...(options.shared ? { shared: options.shared } : {}),
  });
  cleanup.push(() => f.close());
  for (const o of options.overrides ?? []) f.drive.overrides.push(o);
  f.drive.overrides.push(mutationReply({ create: options.create ?? "n" }));
  const run = await runMain({
    argv: [],
    env: {
      KDRIVE_ID: String(DRIVE),
      KDRIVE_TOKEN_FILE: tokenFile(),
      KDRIVE_MCP_MODE: "write",
      ...options.env,
    },
    lookup: f.lookup,
    connect: f.connect,
  });
  expect(run.stderr()).not.toContain("error");
  const client = await stdioClient(run);
  cleanup.push(async () => {
    await client.close();
    await (run.handle as { close(): Promise<void> }).close();
  });
  const raw = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await raw(name, args);
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    try {
      return JSON.parse(text) as GateResult;
    } catch {
      return { error: text } as unknown as GateResult;
    }
  };
  const records = () =>
    run
      .stderr()
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => ["intent", "outcome", "denied"].includes(String(r.event)));
  const writes = () => f.upstream.seen.filter((s) => s.method !== "GET");
  return { f, run, raw, call, records, writes };
}
type Composition = Awaited<ReturnType<typeof compose>>;
async function expectDenied(
  c: Composition,
  name: string,
  args: Record<string, unknown>,
) {
  const before = c.records().filter((r) => r.event === "intent").length;
  const writes = c.writes().length;
  const result = await c.call(name, args);
  expect(result).toMatchObject({
    result: "denied",
    code: "ACCESS_DENIED",
    attempts: 0,
  });
  expect(c.records().filter((r) => r.event === "intent")).toHaveLength(before);
  expect(c.writes()).toHaveLength(writes);
}
async function expectSucceeded(
  c: Composition,
  name: string,
  args: Record<string, unknown>,
  method: string,
  path: string,
) {
  const writes = c.writes().length;
  const result = await c.call(name, args);
  expect(result).toMatchObject({
    result: "succeeded",
    attempts: 1,
    status: 200,
  });
  expect(
    c
      .writes()
      .slice(writes)
      .map((s) => [s.method, s.path]),
  ).toEqual([[method, path]]);
  return result;
}
const p = (tail: string) => `/${tail.replace("{d}", String(DRIVE))}`;

describe("AC-04 production registry", () => {
  // F-018 BR-274 v2: the composition now has seven kinds (upload-new, replace).
  it("TestBR274_production_registers_exactly_the_seven_kinds", async () => {
    await compose();
    const captured = hooks.gates.at(-1);
    expect(Object.keys(captured?.options.mutators ?? {}).sort()).toEqual([
      "create",
      "move",
      "rename",
      "replace",
      "restore",
      "trash",
      "upload-new",
    ]);
  });
  it.each([
    [
      "kdrive_share_link",
      { kind: "share-link", target: { driveId: DRIVE, id: 21 } },
    ],
  ])(
    "TestBR274_a_%s_run_is_refused_UNAVAILABLE_with_zero_records",
    async (tool, operation) => {
      const c = await compose();
      const gate = hooks.gates.at(-1)?.gate as MutationGate;
      const dispatch = vi.fn(() => Promise.resolve({ ok: true }));
      expect(
        await gate.run({
          tool,
          operation,
          identity: { kind: "stdio" },
          dispatch,
        }),
      ).toEqual({ result: "failed", code: "UNAVAILABLE", attempts: 0 });
      expect(dispatch).not.toHaveBeenCalled();
      expect(c.records()).toEqual([]);
      expect(c.writes()).toEqual([]);
    },
  );
});

describe("AC-05 descendant and result-path denials, permitted requests", () => {
  const env = { KDRIVE_MCP_DENY: "**/secret/**" };
  it("TestBR036_a_parent_rename_move_trash_over_a_secret_descendant_is_denied", async () => {
    const c = await compose({ env });
    await expectDenied(c, "kdrive_rename", { file_id: 10, name: "P2" });
    await expectDenied(c, "kdrive_move", {
      file_id: 10,
      destination_folder_id: 30,
    });
    await expectDenied(c, "kdrive_trash", { file_id: 10 });
    expect(c.writes()).toEqual([]);
  });
  it("TestBR034_rename_move_and_create_results_matching_a_deny_are_denied", async () => {
    const c = await compose({ env });
    await expectDenied(c, "kdrive_rename", { file_id: 21, name: "secret" });
    await expectDenied(c, "kdrive_move", {
      file_id: 20,
      destination_folder_id: 12,
    });
    await expectDenied(c, "kdrive_create_folder", {
      parent_id: 30,
      name: "secret",
    });
    expect(c.writes()).toEqual([]);
  });
  it("TestBR271_permitted_operations_send_one_request_each_and_succeed", async () => {
    const c = await compose({ env, create: "fresh" });
    await expectSucceeded(
      c,
      "kdrive_rename",
      { file_id: 20, name: "Q2" },
      "POST",
      p("2/drive/{d}/files/20/rename"),
    );
    await expectSucceeded(
      c,
      "kdrive_move",
      { file_id: 20, destination_folder_id: 30 },
      "POST",
      p("3/drive/{d}/files/20/move/30"),
    );
    await expectSucceeded(
      c,
      "kdrive_trash",
      { file_id: 20 },
      "DELETE",
      p("2/drive/{d}/files/20"),
    );
    const created = await expectSucceeded(
      c,
      "kdrive_create_folder",
      { parent_id: 30, name: "fresh" },
      "POST",
      p("3/drive/{d}/files/30/directory"),
    );
    expect(created.value).toEqual({ drive_id: DRIVE, id: 99 });
    expect(
      c
        .records()
        .filter((r) => r.event === "outcome")
        .at(-1)?.created,
    ).toBe(99);
  });
});

describe("AC-06 structural denials and configured roots", () => {
  it("TestBR275_a_move_whose_destination_evidence_has_another_drive_is_denied", async () => {
    const c = await compose({
      overrides: [
        (r) =>
          r.method === "GET" && r.path === p("3/drive/{d}/files/30")
            ? success({ ...providerItem(TREE, 30), drive_id: 202 })
            : undefined,
      ],
    });
    await expectDenied(c, "kdrive_move", {
      file_id: 20,
      destination_folder_id: 30,
    });
  });
  it("TestBR035_a_move_into_itself_or_its_descendant_is_denied", async () => {
    const c = await compose();
    await expectDenied(c, "kdrive_move", {
      file_id: 10,
      destination_folder_id: 10,
    });
    await expectDenied(c, "kdrive_move", {
      file_id: 10,
      destination_folder_id: 11,
    });
  });
  it("TestBR278_trash_rename_move_of_roots_1_and_40_are_denied", async () => {
    const c = await compose({
      env: { KDRIVE_MCP_ROOTS: `${String(DRIVE)}:1,${String(DRIVE)}:40` },
    });
    for (const id of [1, 40]) {
      await expectDenied(c, "kdrive_trash", { file_id: id });
      await expectDenied(c, "kdrive_rename", { file_id: id, name: "z" });
      await expectDenied(c, "kdrive_move", {
        file_id: id,
        destination_folder_id: 30,
      });
    }
    expect(c.records().filter((r) => r.event === "denied")).toHaveLength(6);
    await expectSucceeded(
      c,
      "kdrive_rename",
      { file_id: 41, name: "c2" },
      "POST",
      p("2/drive/{d}/files/41/rename"),
    );
  });
  it("TestBR278_the_same_ID_on_a_second_configured_drive_is_not_a_root", async () => {
    const c = await compose({
      drives: [
        { id: DRIVE, role: "admin" },
        { id: 102, role: "admin" },
      ],
      env: {
        KDRIVE_IDS: `${String(DRIVE)},102`,
        KDRIVE_MCP_ROOTS: `${String(DRIVE)}:1,${String(DRIVE)}:40,102:1`,
      },
    });
    await expectSucceeded(
      c,
      "kdrive_rename",
      { drive_id: 102, file_id: 40, name: "z" },
      "POST",
      "/2/drive/102/files/40/rename",
    );
  });
});

describe("AC-07 restore through the production evidence", () => {
  const TRASHED = 50;
  function trash(metadata: Record<string, unknown>) {
    return (r: Seen): Reply | undefined =>
      r.method === "GET" && r.path === p(`3/drive/{d}/trash/${String(TRASHED)}`)
        ? success({
            id: TRASHED,
            drive_id: DRIVE,
            type: "file",
            status: "trashed",
            parents: [],
            ...metadata,
          })
        : undefined;
  }
  const restore = p(`2/drive/{d}/trash/${String(TRASHED)}/restore`);
  it("TestBR039_a_valid_restore_returns_the_item_to_its_former_parent", async () => {
    const c = await compose({
      overrides: [trash({ parent_id: 20, name: "back", path: "/Q/back" })],
    });
    await expectSucceeded(
      c,
      "kdrive_restore",
      { file_id: TRASHED },
      "POST",
      restore,
    );
    expect(c.f.upstream.seen.at(-1)?.method).toBe("POST");
    expect(c.f.upstream.seen.at(-1)?.query.toString()).toBe("");
  });
  it("TestBR039_a_former_parent_outside_every_root_is_denied", async () => {
    const c = await compose({
      env: { KDRIVE_MCP_ROOTS: `${String(DRIVE)}:30` },
      overrides: [trash({ parent_id: 20, name: "back", path: "/Q/back" })],
    });
    await expectDenied(c, "kdrive_restore", { file_id: TRASHED });
  });
  it("TestBR039_a_former_parent_matching_a_deny_is_denied", async () => {
    const c = await compose({
      env: { KDRIVE_MCP_DENY: "/Q" },
      overrides: [trash({ parent_id: 20, name: "back", path: "/Q/back" })],
    });
    await expectDenied(c, "kdrive_restore", { file_id: TRASHED });
  });
  it("TestBR039_a_trashed_former_parent_is_denied", async () => {
    const c = await compose({
      nodes: TREE.map((n) => (n.id === 20 ? { ...n, status: "trashed" } : n)),
      overrides: [trash({ parent_id: 20, name: "back", path: "/Q/back" })],
    });
    await expectDenied(c, "kdrive_restore", { file_id: TRASHED });
  });
  it("TestBR039_a_folder_restore_is_denied_with_denies_and_allowed_without", async () => {
    const folder = trash({
      type: "dir",
      parent_id: 20,
      name: "back",
      path: "/Q/back",
    });
    const denying = await compose({
      env: { KDRIVE_MCP_DENY: "/never" },
      overrides: [folder],
    });
    await expectDenied(denying, "kdrive_restore", { file_id: TRASHED });
    const open = await compose({ overrides: [folder] });
    await expectSucceeded(
      open,
      "kdrive_restore",
      { file_id: TRASHED },
      "POST",
      restore,
    );
  });
  it("TestBR039_a_missing_trash_entry_is_denied", async () => {
    const c = await compose({
      overrides: [
        (r) =>
          r.path === p(`3/drive/{d}/trash/${String(TRASHED)}`)
            ? notFound
            : undefined,
      ],
    });
    await expectDenied(c, "kdrive_restore", { file_id: TRASHED });
  });
});

describe("AC-13 a lost response is uncertain and never followed by a request", () => {
  const families: [string, Record<string, unknown>, Options["overrides"]][] = [
    ["kdrive_create_folder", { parent_id: 30, name: "n" }, []],
    ["kdrive_rename", { file_id: 20, name: "Q2" }, []],
    ["kdrive_move", { file_id: 20, destination_folder_id: 30 }, []],
    ["kdrive_trash", { file_id: 20 }, []],
    [
      "kdrive_restore",
      { file_id: 50 },
      [
        (r) =>
          r.method === "GET" && r.path === p("3/drive/{d}/trash/50")
            ? success({
                id: 50,
                type: "file",
                status: "trashed",
                parent_id: 20,
                name: "back",
                path: "/Q/back",
              })
            : undefined,
      ],
    ],
  ];
  it.each(families)(
    "TestBR271_lostResponse_%s_is_uncertain",
    async (name, args, overrides) => {
      const c = await compose({ overrides: overrides ?? [] });
      // The request is received, then the connection is lost.
      c.f.drive.overrides.unshift((r) => {
        if (r.method === "GET") return undefined;
        for (const socket of c.f.upstream.sockets) socket.destroy();
        return { stall: "headers" };
      });
      const result = await c.call(name, args);
      expect(result).toMatchObject({
        result: "uncertain",
        code: "UPSTREAM_UNCERTAIN",
        attempts: 1,
        message:
          "The upstream result is unknown; verify the item's state before any new attempt.",
      });
      expect(c.writes()).toHaveLength(1);
      expect(c.f.upstream.seen.at(-1)?.method).not.toBe("GET");
      expect(c.records().map((r) => [r.event, r.result])).toEqual([
        ["intent", undefined],
        ["outcome", "uncertain"],
      ]);
    },
  );
});

describe("AC-14 audit records hold IDs only; received shares stay refused", () => {
  it("TestBR234_records_contain_IDs_and_no_name_or_path_marker", async () => {
    const nodes: Node[] = [
      dir(60, 1, "SECRETMARK-dir"),
      file(61, 60, "SECRETMARK-f"),
    ];
    const c = await compose({ nodes, create: "SECRETMARK-new" });
    await c.call("kdrive_create_folder", {
      parent_id: 60,
      name: "SECRETMARK-new",
    });
    await c.call("kdrive_rename", { file_id: 61, name: "SECRETMARK-g" });
    await c.call("kdrive_move", { file_id: 61, destination_folder_id: 60 });
    await c.call("kdrive_trash", { file_id: 61 });
    await c.call("kdrive_restore", { file_id: 61 });
    const records = c.records();
    expect(records.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(records)).not.toContain("SECRETMARK");
    expect(c.run.stderr()).not.toContain("SECRETMARK");
    expect(c.run.stderr()).not.toContain("CANCELMARK");
    for (const r of records)
      expect(
        Object.keys(r.ids as object).every((k) =>
          ["target", "destination"].includes(k),
        ),
      ).toBe(true);
  });
  it("TestBR257_received_share_targets_with_sharedWrite_are_denied_for_each_tool", async () => {
    const OWNER = 202;
    const root = {
      id: 500,
      drive_id: OWNER,
      parent_id: 77,
      type: "dir",
      name: "team",
      path: "/Shared/team",
      status: null,
      capabilities: {
        can_read: true,
        can_write: true,
        can_rename: true,
        can_move: true,
        can_delete: true,
      },
    };
    const c = await compose({
      shared: [root],
      drives: [
        { id: DRIVE, role: "admin" },
        { id: OWNER, role: "external" },
      ],
      env: { KDRIVE_MCP_SHARED_WITH_ME: "1", KDRIVE_MCP_SHARED_WRITE: "1" },
      overrides: [
        (r) =>
          r.method === "GET" && r.path === `/3/drive/${String(OWNER)}/files/500`
            ? success({ ...root, parents: [] })
            : undefined,
        (r) =>
          r.method === "GET" &&
          r.path === `/3/drive/${String(OWNER)}/files/500/files`
            ? success([], { has_more: false, cursor: null })
            : undefined,
      ],
    });
    const drive_id = OWNER;
    await expectDenied(c, "kdrive_create_folder", {
      drive_id,
      parent_id: 500,
      name: "n",
    });
    await expectDenied(c, "kdrive_rename", {
      drive_id,
      file_id: 500,
      name: "n",
    });
    await expectDenied(c, "kdrive_move", {
      drive_id,
      file_id: 500,
      destination_folder_id: 500,
    });
    await expectDenied(c, "kdrive_trash", { drive_id, file_id: 500 });
    await expectDenied(c, "kdrive_restore", { drive_id, file_id: 500 });
    expect(c.writes()).toEqual([]);
  });
});

// F-041 BR-278 v2 / BR-427: preflight finishes before counters/failures start.
describe("F-041 production ancestor protection", () => {
  const kinds = ["trash", "rename", "move"] as const;
  type Kind = (typeof kinds)[number];
  const modes = ["write", "share"];
  const tree = () => [
    dir(10, 1, "A"),
    dir(11, 10, "B"),
    dir(40, 11, "R"),
    dir(20, 1, "S"),
    file(21, 20, "f"),
    dir(22, 20, "Child"),
    dir(30, 1, "D"),
  ];
  const args = (kind: Kind, id: number, destination = 30) => ({
    file_id: id,
    ...(kind === "rename" ? { name: "New" } : {}),
    ...(kind === "move" ? { destination_folder_id: destination } : {}),
  });
  const rootPath = "/3/drive/101/files/40";
  async function setup(mode = "write", extra: Options = {}) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T00:00:00.000Z"));
    return compose({
      ...extra,
      nodes: extra.nodes ?? tree(),
      env: {
        KDRIVE_MCP_ROOTS: "101:1,101:40",
        KDRIVE_MCP_MODE: mode,
        ...extra.env,
      },
    });
  }
  const reads = (c: Composition, start: number) =>
    c.f.upstream.seen.slice(start).filter((r) => r.method === "GET");
  async function outcome(
    c: Composition,
    kind: Kind,
    input: Record<string, unknown>,
    allowed: boolean,
  ) {
    const count = c.records().length,
      writes = c.writes().length;
    const envelope = await c.raw(`kdrive_${kind}`, input);
    const content = envelope.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe("text");
    const result = JSON.parse(content[0]!.text) as GateResult;
    expect(result.op).toMatch(/^[a-f0-9]{32}$/u);
    expect(envelope.isError).toBe(!allowed);
    const base = {
      v: 1,
      ts: "2026-11-15T00:00:00.000Z",
      op: result.op,
      identity: { kind: "stdio" },
      tool: `kdrive_${kind}`,
      kind,
      drive: 101,
      ids: {
        target: input.file_id,
        ...(kind === "move"
          ? { destination: input.destination_folder_id }
          : {}),
      },
    };
    const records = c.records().slice(count);
    if (allowed) {
      expect(result).toMatchObject({
        result: "succeeded",
        attempts: 1,
        status: 200,
      });
      expect(records.map((r) => r.event)).toEqual(["intent", "outcome"]);
      expect(records[0]).toEqual({ ...base, event: "intent" });
      expect(records[1]).toMatchObject({
        ...base,
        event: "outcome",
        result: "succeeded",
        attempts: 1,
        status: 200,
      });
      expect(c.writes()).toHaveLength(writes + 1);
    } else {
      expect(result).toEqual({
        result: "denied",
        op: result.op,
        code: "ACCESS_DENIED",
        attempts: 0,
      });
      expect(records).toEqual([
        { ...base, event: "denied", code: "ACCESS_DENIED" },
      ]);
      expect(c.writes()).toHaveLength(writes);
      const line = c.run
        .stderr()
        .split("\n")
        .find((l) => l.includes(`"op":"${result.op}"`));
      expect(line).toBeDefined();
      expect(c.run.stderr()).toContain(`${line}\n`);
      expect(JSON.parse(line!)).toEqual(records[0]);
    }
    return result;
  }
  const matrix = modes.flatMap((mode) => kinds.map((kind) => ({ mode, kind })));
  it.each(
    matrix.flatMap((row) =>
      [10, 11].flatMap((id) =>
        ["", "/blocked/**"].map((deny) => ({ ...row, id, deny })),
      ),
    ),
  )(
    "TestBR278_v2_AC01_parent_and_grandparent_refused_in_write_and_share $mode $kind $id deny=$deny",
    async ({ mode, kind, id, deny }) => {
      const c = await setup(mode, { env: { KDRIVE_MCP_DENY: deny } });
      await outcome(c, kind, args(kind, id), false);
    },
  );
  it.each(matrix.flatMap((row) => [1, 40, 20].map((id) => ({ ...row, id }))))(
    "TestBR278_v2_AC02_direct_roots_still_refused_and_siblings_allowed $mode $kind $id",
    async ({ mode, kind, id }) => {
      const c = await setup(mode),
        start = c.f.upstream.seen.length;
      await outcome(c, kind, args(kind, id), id === 20);
      expect(reads(c, start).filter((r) => r.path === rootPath)).toHaveLength(
        id === 20 ? 1 : 0,
      );
    },
  );
  const moveRows = [
    ...[10, 11, 40].map((destination) => ({
      kind: "move" as const,
      id: 20,
      destination,
      allowed: true,
    })),
    ...[10, 11].flatMap((id) =>
      [30, 1, id === 10 ? 1 : 10].map((destination) => ({
        kind: "move" as const,
        id,
        destination,
        allowed: false,
      })),
    ),
    ...[20, 22].map((destination) => ({
      kind: "move" as const,
      id: 20,
      destination,
      allowed: false,
    })),
    ...[10, 11].map((id) => ({
      kind: "rename" as const,
      id,
      destination: 30,
      allowed: false,
    })),
  ];
  it.each(modes.flatMap((mode) => moveRows.map((row) => ({ mode, ...row }))))(
    "TestBR278_v2_AC03_move_destination_is_not_a_protected_source $mode $kind $id to $destination",
    async ({ mode, kind, id, destination, allowed }) => {
      const c = await setup(mode);
      const input = args(kind, id, destination);
      if (kind === "rename") input.name = id === 10 ? "A" : "B";
      const start = c.f.upstream.seen.length;
      await outcome(c, kind, input, allowed);
      if (allowed)
        expect(reads(c, start).filter((r) => r.path === rootPath)).toHaveLength(
          1,
        );
    },
  );
  it.each(matrix)(
    "TestBR278_v2_AC04_ancestor_denial_preserves_result_and_audit_schema $mode $kind",
    async ({ mode, kind }) => {
      const nodes = tree().map((n) => ({ ...n, name: `MARKER_${n.name}` }));
      const c = await setup(mode, { nodes });
      const result = await outcome(c, kind, args(kind, 10), false);
      expect(
        JSON.stringify(result) + JSON.stringify(c.records()),
      ).not.toContain("MARKER_");
    },
  );
  it.each(
    kinds.flatMap((kind) =>
      ["missing", "incomplete", "rejected"].map((row) => ({ kind, row })),
    ),
  )(
    "TestBR427_AC05_unknown_root_ancestry_fails_closed $row $kind",
    async ({ kind, row }) => {
      const c = await setup();
      c.f.drive.overrides.unshift((r) =>
        r.path !== rootPath
          ? undefined
          : row === "missing"
            ? notFound
            : row === "rejected"
              ? { status: 503, json: { result: "error" } }
              : success({ id: 40, type: "dir" }),
      );
      await outcome(c, kind, args(kind, 20), false);
    },
  );
  it.each(matrix)(
    "TestBR427_AC07_renamed_and_moved_roots_use_current_id_ancestry $mode $kind",
    async ({ mode, kind }) => {
      const c = await setup(mode);
      const rootIndex = c.f.drive.nodes.findIndex((n) => n.id === 40);
      let root = c.f.drive.nodes[rootIndex]!;
      for (const name of ["Renamed", "renamed", "\u00e9", "e\u0301"]) {
        root = { ...root, name };
        c.f.drive.nodes[rootIndex] = root;
        for (const id of [10, 11]) {
          const start = c.f.upstream.seen.length;
          await outcome(c, kind, args(kind, id), false);
          expect(
            reads(c, start).filter((r) => r.path === rootPath),
          ).toHaveLength(1);
        }
      }
      root = { ...root, parent: 30 };
      c.f.drive.nodes[rootIndex] = root;
      c.f.drive.nodes.push(dir(41, 11, "R")); // A replacement at the original path is not root 40.
      for (const [id, allowed] of [
        [30, false],
        [11, true],
        [40, false],
      ] as const) {
        const start = c.f.upstream.seen.length;
        await outcome(c, kind, args(kind, id, id === 30 ? 1 : 30), allowed);
        expect(reads(c, start).filter((r) => r.path === rootPath)).toHaveLength(
          id === 40 ? 0 : 1,
        );
        expect(providerItem(c.f.drive.nodes, 40).path).toBe(`/D/${root.name}`);
      }
    },
  );
  it.each(
    kinds.flatMap((kind) =>
      ["last-protected", "unknown", "all-outside"].map((row) => ({
        kind,
        row,
      })),
    ),
  )(
    "TestBR427_AC08_all_same_drive_roots_checked_once_without_tree_walk $row $kind",
    async ({ kind, row }) => {
      const c = await setup("write", {
        nodes: [...tree(), dir(50, 30, "R50"), dir(60, 30, "R60")],
        drives: [
          { id: 101, role: "admin" },
          { id: 102, role: "admin" },
        ],
        env: {
          KDRIVE_IDS: "101,102",
          KDRIVE_MCP_ROOTS: "101:1,101:50,101:60,101:40,102:40",
        },
      });
      c.f.drive.overrides.unshift((r) =>
        r.path === "/3/drive/102/files/40" ||
        (row === "unknown" && r.path === "/3/drive/101/files/60")
          ? notFound
          : undefined,
      );
      const start = c.f.upstream.seen.length;
      await outcome(
        c,
        kind,
        args(kind, row === "last-protected" ? 10 : 20),
        row === "all-outside",
      );
      const requests = reads(c, start);
      for (const id of [50, 60, 40]) {
        const count = requests.filter(
          (r) => r.path === `/3/drive/101/files/${id}`,
        ).length;
        expect(count).toBeLessThanOrEqual(1);
        if (row !== "unknown" || id === 50) expect(count).toBe(1);
      }
      expect(
        requests.some(
          (r) =>
            r.path.includes("/102/") ||
            r.path.endsWith("/files/1") ||
            /\/files\/\d+\/files$/u.test(r.path),
        ),
      ).toBe(false);
    },
  );
  it.each(
    matrix.flatMap((row) => [10, 11].map((parent) => ({ ...row, parent }))),
  )(
    "TestBR278_v2_AC09_create_upload_and_file_mutations_unchanged $mode $kind parent=$parent",
    async ({ mode, kind, parent }) => {
      const c = await setup(mode);
      let rootReads = 0;
      c.f.drive.overrides.unshift((r) => {
        if (r.path !== rootPath) return undefined;
        rootReads++;
        return notFound;
      });
      await expectSucceeded(
        c,
        "kdrive_create_folder",
        { parent_id: parent, name: "n" },
        "POST",
        `/3/drive/101/files/${parent}/directory`,
      );
      await outcome(c, kind, args(kind, 21), true);
      expect(rootReads).toBe(0);
    },
  );
});

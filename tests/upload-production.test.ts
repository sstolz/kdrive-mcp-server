// F-018 AC-04–AC-06, AC-09–AC-11 (BR-035 v2, BR-034, BR-257, BR-281,
// BR-284, BR-289, BR-234): `kdrive_upload` through the production composition
// `main(deps)` with the real mutators, over the injected loopback transport.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStderrSink } from "../src/audit/sink.js";
import {
  UNCERTAIN_MESSAGE,
  createMutationGate,
  type GateResult,
} from "../src/mutation-gate.js";
import { createKdriveAdapter } from "../src/kdrive/index.js";
import type { Operation } from "../src/policy/operation.js";
import {
  CANARY,
  DRIVE,
  kdriveFixture,
  success,
  type Node,
  type Reply,
  type Seen,
} from "./helpers/kdrive.js";
import { runMain, stdioClient, tokenFile } from "./helpers/main.js";
import { rawServer } from "./helpers/raw-tls.js";

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
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
  dir(30, 1, "D"),
  dir(31, 1, "f-deny"),
  file(32, 30, "y-deny"),
  dir(40, 1, "R40"),
  file(41, 40, "c"),
];

/** A synthetic upload store applying `conflict` at body completion. */
interface Store {
  readonly files: Map<string, { id: number; bytes: Buffer }>;
  next: number;
  /** Awaited after the body is read, before the conflict is applied. */
  hold?: (index: number) => Promise<void>;
  readonly stored: (() => void)[];
  count: number;
}
function store(): Store {
  return {
    files: new Map([["40/c", { id: 41, bytes: Buffer.from("x") }]]),
    next: 900,
    stored: [],
    count: 0,
  };
}
function uploads(s: Store) {
  return (r: Seen): Promise<Reply> | undefined => {
    if (r.method !== "POST" || !r.path.endsWith("/upload")) return undefined;
    const { req } = r.raw!;
    const index = s.count++;
    return (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      await s.hold?.(index);
      const parent = Number(r.query.get("directory_id"));
      const name = r.query.get("file_name") ?? "";
      const key = `${String(parent)}/${name}`;
      const existing = s.files.get(key);
      if (existing && r.query.get("conflict") === "error")
        return {
          status: 409,
          json: {
            result: "error",
            error: { code: "file_already_exists_error" },
          },
        };
      const id = existing ? existing.id : s.next++;
      s.files.set(key, { id, bytes: body });
      for (const done of s.stored.splice(0)) done();
      return success({
        id,
        type: "file",
        name,
        size: body.length,
        parent_id: parent,
      });
    })();
  };
}

interface Options {
  readonly env?: Record<string, string>;
  readonly nodes?: Node[];
  readonly drives?: { id: number; role: string }[];
  readonly overrides?: ((r: Seen) => Reply | Promise<Reply> | undefined)[];
  readonly shared?: Record<string, unknown>[];
  readonly fixture?: Awaited<ReturnType<typeof kdriveFixture>>;
  readonly store?: Store;
}
async function compose(options: Options = {}) {
  let f = options.fixture;
  const s = options.store ?? store();
  if (!f) {
    const created = await kdriveFixture({
      nodes: options.nodes ?? [...TREE],
      ...(options.drives ? { drives: options.drives } : {}),
      ...(options.shared ? { shared: options.shared } : {}),
    });
    cleanup.push(() => created.close());
    for (const o of options.overrides ?? [])
      created.drive.overrides.push(o as (r: Seen) => Reply | undefined);
    created.drive.overrides.push(
      uploads(s) as unknown as (r: Seen) => Reply | undefined,
    );
    f = created;
  }
  const mine: string[] = [];
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
    onRequest: (method, template) => mine.push(`${method} ${template}`),
  });
  expect(run.stderr()).not.toContain("error");
  const client = await stdioClient(run);
  cleanup.push(async () => {
    await client.close();
    await (run.handle as { close(): Promise<void> }).close();
  });
  const raw = (args: Record<string, unknown>) =>
    client.callTool({ name: "kdrive_upload", arguments: args });
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    let value: GateResult;
    try {
      value = JSON.parse(text) as GateResult;
    } catch {
      value = { error: text } as unknown as GateResult;
    }
    return Object.assign(value, {}) as GateResult & { isError?: boolean };
  };
  const upload = (args: Record<string, unknown>) => call("kdrive_upload", args);
  const records = () =>
    run
      .stderr()
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => ["intent", "outcome", "denied"].includes(String(r.event)));
  const writes = () => f.upstream.seen.filter((x) => x.method !== "GET");
  return { f, s, run, raw, upload, records, writes, mine };
}
type Composition = Awaited<ReturnType<typeof compose>>;
async function expectDenied(c: Composition, args: Record<string, unknown>) {
  const intents = c.records().filter((r) => r.event === "intent").length;
  const writes = c.writes().length;
  expect(await c.upload(args)).toMatchObject({
    result: "denied",
    code: "ACCESS_DENIED",
    attempts: 0,
  });
  expect(c.records().filter((r) => r.event === "intent")).toHaveLength(intents);
  expect(c.writes()).toHaveLength(writes);
}
const settle = async () => {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
};

describe("AC-04 the production envelope", () => {
  it("TestBR281_production_results_and_isError", async () => {
    const c = await compose();
    const ok = await c.raw({ parent_id: 30, name: "n", text: "abc" });
    expect(ok.isError).toBe(false);
    const again = await c.raw({ parent_id: 30, name: "n", text: "abc" });
    expect(again.isError).toBe(true);
    expect(
      JSON.parse((again.content as { text: string }[])[0]!.text),
    ).toMatchObject({
      result: "failed",
      code: "UPSTREAM_REJECTED",
      status: 409,
    });
    const denied = await c.raw({ parent_id: 999, name: "n", text: "abc" });
    expect(denied.isError).toBe(true);
    expect(
      JSON.parse((denied.content as { text: string }[])[0]!.text),
    ).toMatchObject({
      result: "denied",
    });
  });
});

describe("AC-05 policy denials and permitted requests", () => {
  const env = { KDRIVE_MCP_DENY: "**/*-deny*" };
  it("TestBR035_TestBR034_denied_uploads_make_zero_writes", async () => {
    const c = await compose({ env });
    await expectDenied(c, { parent_id: 30, name: "x-deny", text: "x" });
    await expectDenied(c, { parent_id: 31, name: "ok", text: "x" });
    await expectDenied(c, {
      parent_id: 30,
      name: "y-deny",
      text: "x",
      overwrite: true,
      file_id: 32,
    });
    expect(c.writes()).toEqual([]);
  });
  it.each([
    ["a folder as file_id", { parent_id: 1, name: "R40", file_id: 40 }],
    ["a file in another folder", { parent_id: 30, name: "c", file_id: 41 }],
    ["another name", { parent_id: 40, name: "d", file_id: 41 }],
    ["a case-only difference", { parent_id: 40, name: "C", file_id: 41 }],
    ["a file as destination", { parent_id: 41, name: "c", file_id: 41 }],
    ["a missing target", { parent_id: 40, name: "c", file_id: 999 }],
    ["a missing destination", { parent_id: 999, name: "c", file_id: 41 }],
  ])("TestBR035_v2_replace_with_%s_is_denied", async (_label, args) => {
    const c = await compose();
    await expectDenied(c, { ...args, text: "x", overwrite: true });
  });
  it("TestBR035_v2_replace_in_another_drive_is_denied", async () => {
    const c = await compose();
    await expectDenied(c, {
      drive_id: 999,
      parent_id: 40,
      name: "c",
      text: "x",
      overwrite: true,
      file_id: 41,
    });
  });
  it.each([
    ["upload-new", { parent_id: 30, name: "new", text: "abc" }, "error", 900],
    [
      "replace",
      { parent_id: 40, name: "c", text: "abc", overwrite: true, file_id: 41 },
      "version",
      41,
    ],
  ] as const)(
    "TestBR035_permitted_%s_sends_one_request",
    async (_kind, args, conflict, id) => {
      const c = await compose();
      const result = await c.upload(args);
      expect(result).toMatchObject({
        result: "succeeded",
        attempts: 1,
        status: 200,
        value: { drive_id: DRIVE, id, size: 3 },
      });
      expect(c.writes()).toHaveLength(1);
      expect(c.writes()[0]?.query.get("conflict")).toBe(conflict);
      expect(
        c.s.files
          .get(`${String(args.parent_id)}/${args.name}`)
          ?.bytes.toString(),
      ).toBe("abc");
    },
  );
});

describe("AC-05 replace at the drive root", () => {
  it("TestBR035_v2_permitted_replace_of_a_root_file", async () => {
    const s = store();
    s.files.set("1/top", { id: 50, bytes: Buffer.from("x") });
    const c = await compose({ nodes: [...TREE, file(50, 1, "top")], store: s });
    expect(
      await c.upload({
        parent_id: 1,
        name: "top",
        text: "abc",
        overwrite: true,
        file_id: 50,
      }),
    ).toMatchObject({ result: "succeeded", value: { id: 50, size: 3 } });
    expect(c.writes()).toHaveLength(1);
  });
});

describe("AC-06 received shares stay refused", () => {
  it("TestBR257_upload_into_or_replace_in_a_received_share_is_denied", async () => {
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
    const inner = {
      id: 501,
      drive_id: OWNER,
      parent_id: 500,
      type: "file",
      name: "f",
      path: "/Shared/team/f",
      status: null,
      size: 1,
      capabilities: root.capabilities,
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
          r.method === "GET" && r.path === `/3/drive/${String(OWNER)}/files/501`
            ? success({ ...inner, parents: [{ ...root }] })
            : undefined,
        (r) =>
          r.method === "GET" &&
          r.path === `/3/drive/${String(OWNER)}/files/500/files`
            ? success([], { has_more: false, cursor: null })
            : undefined,
      ],
    });
    const lists = () =>
      c.f.upstream.seen.filter(
        (s) => s.path === "/3/drive/files/shared_with_me",
      ).length;
    for (const args of [
      { drive_id: OWNER, parent_id: 500, name: "n", text: "x" },
      {
        drive_id: OWNER,
        parent_id: 500,
        name: "f",
        text: "x",
        overwrite: true,
        file_id: 501,
      },
    ]) {
      const before = lists();
      await expectDenied(c, args);
      expect(lists()).toBeGreaterThan(before);
    }
    expect(c.writes()).toEqual([]);
  });
});

describe("AC-09 an unknown result is never replayed", () => {
  const cases = [
    ["upload-new", { parent_id: 30, name: "n" }],
    ["replace", { parent_id: 40, name: "c", overwrite: true, file_id: 41 }],
  ] as const;
  const big = Buffer.alloc(300_000, 0x61).toString("base64");
  for (const [kind, args] of cases)
    it.each(["whole", "half"] as const)(
      `TestBR289_${kind}_response_lost_after_the_%s_body_is_uncertain`,
      async (point) => {
        const c = await compose();
        c.f.drive.overrides.unshift((r) => {
          if (r.method === "GET") return undefined;
          const { req } = r.raw!;
          let received = 0;
          const total = Number(r.headers["content-length"]);
          req.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (point === "half" && received >= total / 2) req.socket.destroy();
          });
          req.on("end", () => req.socket.destroy());
          return { handled: true };
        });
        const result = await c.upload({ ...args, base64: big });
        expect(result).toMatchObject({
          result: "uncertain",
          code: "UPSTREAM_UNCERTAIN",
          attempts: 1,
          message: UNCERTAIN_MESSAGE,
        });
        const seen = c.f.upstream.seen.length;
        await settle();
        expect(c.writes()).toHaveLength(1);
        expect(c.f.upstream.seen).toHaveLength(seen);
        expect(c.f.upstream.seen.at(-1)?.method).toBe("POST");
        expect(c.records().map((r) => [r.event, r.result])).toEqual([
          ["intent", undefined],
          ["outcome", "uncertain"],
        ]);
      },
    );
  it.each([
    [
      "upload-new",
      {
        kind: "upload-new",
        destination: { driveId: DRIVE, id: 30 },
        name: "n",
      },
    ],
    [
      "replace",
      {
        kind: "replace",
        target: { driveId: DRIVE, id: 41 },
        destination: { driveId: DRIVE, id: 40 },
        name: "c",
      },
    ],
  ] as [string, Operation][])(
    "TestBR289_%s_no_answer_until_the_30000_ms_abort_is_uncertain",
    async (_kind, operation) => {
      const s = await rawServer(() => ({ hold: true }));
      cleanup.push(() => s.close());
      const a = createKdriveAdapter({
        token: CANARY,
        lookup: s.lookup,
        connect: s.connect,
      });
      const lines: string[] = [];
      const gate = createMutationGate({
        mode: "write",
        sink: createStderrSink({
          write(chunk, callback) {
            lines.push(chunk);
            callback();
            return true;
          },
        }),
        mutators: a.mutators,
        random: (n) => new Uint8Array(n),
        clock: () => new Date("2026-11-10T10:00:00.000Z"),
        now: () => performance.now(),
        diagnostic: () => undefined,
      });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const running = gate.run({
        tool: "kdrive_upload",
        operation,
        identity: { kind: "stdio" },
        payload: Buffer.from("abc"),
        dispatch: (op) => gate.execute(op),
      });
      for (let i = 0; i < 2000 && s.requests.length === 0; i++)
        await new Promise((r) => setImmediate(r));
      expect(s.requests).toHaveLength(1);
      vi.advanceTimersByTime(30_000);
      expect(await running).toMatchObject({
        result: "uncertain",
        attempts: 1,
        message: UNCERTAIN_MESSAGE,
      });
      vi.advanceTimersByTime(60_000);
      vi.useRealTimers();
      await settle();
      expect(s.requests).toHaveLength(1);
      const outcome = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((r) => r.event === "outcome");
      expect(outcome.map((r) => r.result)).toEqual(["uncertain"]);
    },
  );
});

describe("AC-10 same-name concurrency on a synthetic server", () => {
  async function pair() {
    const s = store();
    const f = await kdriveFixture({ nodes: [...TREE] });
    cleanup.push(() => f.close());
    f.drive.overrides.push(
      uploads(s) as unknown as (r: Seen) => Reply | undefined,
    );
    const one = await compose({ fixture: f, store: s });
    const two = await compose({ fixture: f, store: s });
    return { s, f, one, two };
  }
  const args = (text: string) => ({ parent_id: 30, name: "same", text });
  function check(
    p: Awaited<ReturnType<typeof pair>>,
    results: GateResult[],
    contents: string[],
  ) {
    const outcomes = results.map((r) => r.result).toSorted();
    expect(outcomes).toEqual(["failed", "succeeded"]);
    const loser = results.find((r) => r.result === "failed");
    expect(loser).toMatchObject({ code: "UPSTREAM_REJECTED", status: 409 });
    for (const c of [p.one, p.two])
      expect(c.mine.filter((m) => m.startsWith("POST"))).toEqual([
        "POST /3/drive/{d}/upload",
      ]);
    const posts = p.f.upstream.seen.filter((x) => x.method === "POST");
    expect(posts.map((x) => x.query.get("conflict"))).toEqual([
      "error",
      "error",
    ]);
    const winner = results.findIndex((r) => r.result === "succeeded");
    expect(p.s.files.get("30/same")?.bytes.toString()).toBe(contents[winner]);
  }
  it("TestBR284_concurrent_uploads_started_together", async () => {
    const p = await pair();
    const results = await Promise.all([
      p.one.upload(args("from-one")),
      p.two.upload(args("from-two")),
    ]);
    check(p, results, ["from-one", "from-two"]);
  });
  it("TestBR284_concurrent_first_holds_its_body_until_the_second_completes", async () => {
    const p = await pair();
    // The first request's body completion is held until the second is stored.
    p.s.hold = (index) =>
      index === 0
        ? new Promise<void>((resolve) => p.s.stored.push(resolve))
        : Promise.resolve();
    const first = p.one.upload(args("from-one"));
    for (let i = 0; i < 2000 && p.s.count === 0; i++)
      await new Promise((r) => setImmediate(r));
    const second = await p.two.upload(args("from-two"));
    const results = [await first, second];
    expect(second.result).toBe("succeeded");
    check(p, results, ["from-one", "from-two"]);
  });
  it("TestBR284_concurrent_calls_in_one_session_are_SERVER_BUSY", async () => {
    const s = store();
    let release: () => void = () => undefined;
    s.hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const c = await compose({ store: s });
    const first = c.upload(args("from-one"));
    for (let i = 0; i < 2000 && s.count === 0; i++)
      await new Promise((r) => setImmediate(r));
    const busy = await c.raw(args("from-two"));
    expect((busy.content as { text: string }[])[0]?.text).toBe("SERVER_BUSY");
    expect(c.writes()).toHaveLength(1);
    release();
    expect((await first).result).toBe("succeeded");
    expect(c.writes()).toHaveLength(1);
  });
});

describe("AC-11 audit records hold IDs only", () => {
  it("TestBR234_upload_records_hold_no_name_content_or_size", async () => {
    const nodes: Node[] = [...TREE, file(42, 40, "SECRETMARK-old")];
    const c = await compose({ nodes });
    c.s.files.set("40/SECRETMARK-old", { id: 42, bytes: Buffer.from("o") });
    const results = [
      await c.upload({
        parent_id: 30,
        name: "SECRETMARK-new",
        text: "SECRETMARK-content",
      }),
      await c.upload({
        parent_id: 40,
        name: "SECRETMARK-old",
        text: "SECRETMARK-content",
        overwrite: true,
        file_id: 42,
      }),
    ];
    expect(results.map((r) => r.result)).toEqual(["succeeded", "succeeded"]);
    for (const r of results)
      expect(JSON.stringify(r)).not.toContain("SECRETMARK");
    const records = c.records();
    expect(records).toHaveLength(4);
    const text = JSON.stringify(records);
    expect(text).not.toContain("SECRETMARK");
    expect(text).not.toContain('"size"');
    expect(c.run.stderr()).not.toContain("SECRETMARK");
  });
});

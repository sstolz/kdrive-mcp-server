import {
  ancestorFixture,
  structuralKinds,
  structuralOperation,
} from "./helpers/root-ancestors.js";
import { createPolicy } from "../src/policy/index.js";
// F-016 mutation gate unit tests: AC-01–AC-03, AC-10–AC-19, AC-21 (gate),
// AC-22, AC-27, with a synthetic mutator and a fake policy dispatch.
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStderrSink,
  openFileSink,
  type AuditFilePort,
  type AuditSink,
  type AuditRecord,
  serializeAuditRecord,
} from "../src/audit/sink.js";
import {
  NotSent,
  OUTCOME_UNRECORDED_DIAGNOSTIC,
  UNCERTAIN_MESSAGE,
  createMutationGate,
  gatedDependencies,
  type GateResult,
  type Mutator,
} from "../src/mutation-gate.js";

afterEach(() => {
  vi.useRealTimers();
});

const OP = "000102030405060708090a0b0c0d0e0f";
const target = { driveId: 101, id: 42 };
const rename = { kind: "rename", target, name: "renamed" };
const KINDS = [
  "create",
  "upload-new",
  "replace",
  "rename",
  "move",
  "trash",
  "restore",
  "share-link",
  "share-invite",
];
const PAIRS: [string, Record<string, unknown>][] = [
  [
    "kdrive_create_folder",
    {
      kind: "create",
      destination: { driveId: 101, id: 1 },
      name: "n",
      type: "dir",
    },
  ],
  [
    "kdrive_upload",
    { kind: "upload-new", destination: { driveId: 101, id: 1 }, name: "n" },
  ],
  [
    "kdrive_upload",
    {
      kind: "replace",
      target,
      destination: { driveId: 101, id: 1 },
      name: "n",
    },
  ],
  ["kdrive_rename", rename],
  [
    "kdrive_move",
    { kind: "move", target, destination: { driveId: 101, id: 5 } },
  ],
  ["kdrive_trash", { kind: "trash", target }],
  // F-017 BR-039 v2: a restore operation carries only its target.
  ["kdrive_restore", { kind: "restore", target }],
  ["kdrive_share_link", { kind: "share-link", target }],
  ["kdrive_share_access", { kind: "share-invite", target, domain: "ex.test" }],
];
const response = (status: number, extra: Record<string, unknown> = {}) => ({
  outcome: "response",
  status,
  accepted: status >= 200 && status < 300,
  ...extra,
});
function errno(code: string) {
  return Object.assign(new Error(`synthetic ${code}`), { code });
}

interface HarnessOptions {
  mode?: "read" | "write" | "share";
  mutator?: Mutator;
  mutators?: Record<string, Mutator>;
  deny?: boolean;
  throws?: boolean;
  sink?: AuditSink;
  /** Handles write number `index`; `commit` records the line and succeeds. */
  write?: (index: number, commit: () => void, fail: (e: Error) => void) => void;
  diagnostic?: (message: string) => void;
  now?: () => number;
  beforeExecute?: (h: { sink: AuditSink }) => void | Promise<void>;
}
function harness(options: HarnessOptions = {}) {
  const lines: string[] = [];
  const diagnostics: string[] = [];
  let writes = 0;
  const sink =
    options.sink ??
    createStderrSink({
      write(chunk, callback) {
        const index = writes++;
        const commit = () => {
          lines.push(chunk);
          callback();
        };
        if (options.write)
          options.write(index, commit, (e) => {
            callback(e);
          });
        else commit();
        return true;
      },
    });
  const mutator = vi.fn<Mutator>(
    options.mutator ??
      (() => Promise.resolve(response(200, { value: { id: 42 } }))),
  );
  const gate = createMutationGate({
    mode: options.mode ?? "write",
    ...(options.mode === "read" ? {} : { sink }),
    mutators:
      options.mutators ?? Object.fromEntries(KINDS.map((k) => [k, mutator])),
    random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    clock: () => new Date("2026-11-09T10:00:00.000Z"),
    now: options.now ?? (() => performance.now()),
    diagnostic: (message) => {
      diagnostics.push(message);
      options.diagnostic?.(message);
    },
  });
  const policy = vi.fn();
  const dispatch = async (op: object) => {
    policy(op);
    await options.beforeExecute?.({ sink });
    if (options.throws) throw new Error("synthetic dispatch failure");
    if (options.deny) return { ok: false, code: "ACCESS_DENIED" };
    return {
      ok: true,
      value: await gate.execute(Object.freeze({ ...op }) as never),
    };
  };
  const run = (over: Record<string, unknown> = {}) =>
    gate.run({
      tool: "kdrive_rename",
      operation: rename,
      identity: { kind: "stdio" },
      dispatch,
      ...over,
    });
  const records = () =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { gate, sink, lines, records, diagnostics, mutator, policy, run };
}

describe("BR-234 gate records", () => {
  it("TestBR234_a_successful_run_writes_intent_then_outcome", async () => {
    const h = harness({
      mutator: () => Promise.resolve(response(201, { created: 77 })),
    });
    await h.run();
    expect(h.records()).toEqual([
      {
        v: 1,
        ts: "2026-11-09T10:00:00.000Z",
        event: "intent",
        op: OP,
        identity: { kind: "stdio" },
        tool: "kdrive_rename",
        kind: "rename",
        drive: 101,
        ids: { target: 42 },
      },
      {
        v: 1,
        ts: "2026-11-09T10:00:00.000Z",
        event: "outcome",
        op: OP,
        identity: { kind: "stdio" },
        tool: "kdrive_rename",
        kind: "rename",
        drive: 101,
        ids: { target: 42 },
        result: "succeeded",
        attempts: 1,
        ms: expect.any(Number) as number,
        status: 201,
        created: 77,
      },
    ]);
  });

  it("TestBR234_a_refused_cross_drive_move_records_both_drives", async () => {
    const h = harness({ deny: true });
    await h.run({
      tool: "kdrive_move",
      operation: { kind: "move", target, destination: { driveId: 102, id: 5 } },
    });
    expect(h.lines[0]).toBe(
      `{"v":1,"ts":"2026-11-09T10:00:00.000Z","event":"denied","op":"${OP}","identity":{"kind":"stdio"},"tool":"kdrive_move","kind":"move","drive":101,"destinationDrive":102,"ids":{"target":42,"destination":5},"code":"ACCESS_DENIED"}\n`,
    );
  });

  it("TestBR234_a_create_records_its_destination_drive", async () => {
    const h = harness();
    await h.run({
      tool: "kdrive_create_folder",
      operation: PAIRS[0]?.[1],
    });
    expect(h.records()[0]).toMatchObject({
      drive: 101,
      ids: { destination: 1 },
    });
    expect(h.records()[0]).not.toHaveProperty("destinationDrive");
  });
});

describe("BR-235 no content, secret or exception text", () => {
  const MARK = "SECRETMARK";
  const TOKEN = "Bearer SYNTHETIC_TOKEN_CANARY_17";
  const loud = (status: number) =>
    response(status, {
      body: `raw ${MARK}`,
      headers: { "x-echo": MARK, authorization: TOKEN },
      retryAfter: status === 429 ? MARK : undefined,
    });
  it.each([
    ["succeeded", () => Promise.resolve(loud(200)), false],
    ["failed", () => Promise.resolve(loud(409)), false],
    ["rate limited", () => Promise.resolve(loud(429)), false],
    [
      "uncertain",
      () => Promise.reject(new Error(`${MARK} ${TOKEN} https://x.test`)),
      false,
    ],
    ["denied", () => Promise.resolve(loud(200)), true],
  ] as [string, Mutator, boolean][])(
    "TestBR235_%s_leaks_no_marker_or_token",
    async (_name, mutator, deny) => {
      vi.useFakeTimers();
      const h = harness({ mutator, deny });
      const all: GateResult[] = [];
      for (const [tool, operation] of [
        ["kdrive_rename", { kind: "rename", target, name: MARK }],
        [
          "kdrive_move",
          {
            kind: "move",
            target,
            destination: { driveId: 101, id: 5 },
            name: `${MARK}.txt`,
          },
        ],
        [
          "kdrive_share_access",
          { kind: "share-invite", target, domain: `${MARK}.example` },
        ],
      ] as const) {
        const pending = h.run({
          tool,
          operation,
          payload: { authorization: TOKEN, query: MARK, path: `/${MARK}` },
        });
        await vi.runAllTimersAsync();
        all.push(await pending);
      }
      all.push(await h.run({ tool: `kdrive_${MARK}` }));
      const text = [
        ...h.lines,
        ...h.diagnostics,
        ...all.map((r) => JSON.stringify({ ...r, value: undefined })),
      ].join("\n");
      expect(text).not.toContain(MARK);
      expect(text).not.toContain("SYNTHETIC_TOKEN");
      expect(text).not.toContain("x.test");
    },
  );

  it("TestBR235_the_validated_value_passes_through_and_is_never_recorded", async () => {
    const h = harness({
      mutator: () =>
        Promise.resolve(response(200, { value: { name: "SECRETMARK" } })),
    });
    const result = await h.run();
    expect(result.value).toEqual({ name: "SECRETMARK" });
    expect(h.lines.join("")).not.toContain("SECRETMARK");
  });
});

describe("BR-236 identity bounds", () => {
  const oauth = (iss: string, sub: string) => ({ kind: "oauth", iss, sub });
  it("TestBR236_controls_in_sub_are_escaped_on_one_line", async () => {
    const h = harness();
    const sub = "a\nb\rc\u0000d\u007Fe\u0085f\u009Bg\u202Eh\u2028i";
    await h.run({ identity: oauth("https://issuer.test", sub) });
    expect(h.lines).toHaveLength(2);
    for (const line of h.lines) {
      expect(/^[\x20-\x7E]*\n$/u.test(line)).toBe(true);
      expect(line).toContain("\\u202e");
    }
    expect(h.records()[0]?.identity).toEqual(oauth("https://issuer.test", sub));
  });

  it.each([
    ["sub 1024 bytes", oauth("https://i.test", "s".repeat(1024)), true],
    ["sub 1025 bytes", oauth("https://i.test", "s".repeat(1025)), false],
    ["sub 1024 bytes multibyte", oauth("i", "é".repeat(512)), true],
    ["sub 1025 bytes multibyte", oauth("i", `x${"é".repeat(512)}`), false],
    ["iss 4096 bytes", oauth("i".repeat(4096), "s"), true],
    ["iss 4097 bytes", oauth("i".repeat(4097), "s"), false],
    ["empty sub", oauth("https://i.test", ""), false],
    ["empty iss", oauth("", "s"), false],
    ["lone surrogate", oauth("https://i.test", "a\uD800b"), false],
    ["non-string sub", { kind: "oauth", iss: "i", sub: 7 }, false],
    ["extra member", { kind: "stdio", sub: "x" }, false],
  ] as [string, unknown, boolean][])(
    "TestBR236_%s",
    async (_name, identity, accepted) => {
      const h = harness();
      const result = await h.run({ identity });
      if (accepted) {
        expect(result.result).toBe("succeeded");
        expect(h.records()).toHaveLength(2);
      } else {
        expect(result).toEqual({
          result: "failed",
          code: "AUDIT_UNAVAILABLE",
          attempts: 0,
        });
        expect(h.lines).toEqual([]);
        expect(h.policy).not.toHaveBeenCalled();
        expect(h.mutator).not.toHaveBeenCalled();
      }
    },
  );

  it("TestBR236_an_identity_whose_widest_record_exceeds_8192_bytes_is_refused_without_latching", async () => {
    const h = harness();
    const result = await h.run({
      identity: oauth("i".repeat(2000), "\u0001".repeat(1024)),
    });
    expect(result).toEqual({
      result: "failed",
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
    expect(h.lines).toEqual([]);
    expect(h.policy).not.toHaveBeenCalled();
    expect(h.sink.latched).toBe(false);
    expect((await h.run({ identity: oauth("i", "s") })).result).toBe(
      "succeeded",
    );
    expect(h.records()).toHaveLength(2);
  });
});

describe("BR-237 identities at the gate", () => {
  it.each([
    [{ kind: "stdio" }],
    [{ kind: "insecure" }],
    [{ kind: "oauth", iss: "https://i.test", sub: "user-1" }],
  ])("TestBR237_identity_%j_is_recorded", async (identity) => {
    const h = harness();
    await h.run({ identity });
    expect(h.records().map((r) => r.identity)).toEqual([identity, identity]);
  });

  it.each([[undefined], [null], [{ kind: "other" }], ["stdio"]])(
    "TestBR237_identity_%j_is_refused_before_policy",
    async (identity) => {
      const h = harness();
      expect(await h.run({ identity })).toEqual({
        result: "failed",
        code: "AUDIT_UNAVAILABLE",
        attempts: 0,
      });
      expect(h.policy).not.toHaveBeenCalled();
      expect(h.lines).toEqual([]);
    },
  );
});

describe("BR-243 intent before dispatch", () => {
  it("TestBR243_the_intent_is_durable_before_the_first_attempt_and_shares_the_op", async () => {
    let seen: Record<string, unknown>[] = [];
    const h = harness({
      mutator: () => {
        seen = h.records();
        return Promise.resolve(response(200));
      },
    });
    await h.run();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ event: "intent", op: OP });
    expect(h.records().map((r) => [r.event, r.op])).toEqual([
      ["intent", OP],
      ["outcome", OP],
    ]);
    expect(OP).toMatch(/^[0-9a-f]{32}$/u);
  });
});

describe("BR-244 intent failure", () => {
  it.each([
    ["ENOSPC", errno("ENOSPC")],
    ["EACCES", errno("EACCES")],
    ["closed stream", errno("ERR_STREAM_DESTROYED")],
  ])("TestBR244_%s_makes_zero_attempts", async (_name, error) => {
    const h = harness({
      write: (i, commit, fail) => {
        if (i === 0) fail(error);
        else commit();
      },
    });
    expect(await h.run()).toEqual({
      result: "failed",
      op: OP,
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it("TestBR244_a_sink_latched_after_admission_makes_zero_attempts", async () => {
    const h = harness({
      beforeExecute: ({ sink }) => {
        sink.latch();
      },
    });
    expect(await h.run()).toEqual({
      result: "failed",
      op: OP,
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
    expect(h.mutator).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });
});

describe("BR-245 admission", () => {
  it.each([
    ["unknown tool", { tool: "kdrive_delete" }, {}, "UNAVAILABLE"],
    [
      "batch operation",
      { operation: { kind: "batch", operations: [rename] } },
      {},
      "UNAVAILABLE",
    ],
    ["invalid operation", { operation: { kind: "rename" } }, {}, "UNAVAILABLE"],
    [
      "rename tool with a move",
      {
        operation: {
          kind: "move",
          target,
          destination: { driveId: 101, id: 5 },
        },
      },
      {},
      "UNAVAILABLE",
    ],
    [
      "upload tool with a create",
      { tool: "kdrive_upload", operation: PAIRS[0]?.[1] },
      {},
      "UNAVAILABLE",
    ],
    [
      "a read operation",
      { operation: { kind: "read", target } },
      {},
      "UNAVAILABLE",
    ],
    [
      "kind without mutator",
      { tool: "kdrive_trash", operation: { kind: "trash", target } },
      { mutators: { rename: () => Promise.resolve(response(200)) } },
      "UNAVAILABLE",
    ],
    ["mode read", {}, { mode: "read" }, "ACCESS_DENIED"],
  ] as [string, Record<string, unknown>, HarnessOptions, string][])(
    "TestBR245_%s_is_refused",
    async (_name, over, options, code) => {
      const h = harness(options);
      expect(await h.run(over)).toEqual({
        result: "failed",
        code,
        attempts: 0,
      });
      expect(h.lines).toEqual([]);
      expect(h.policy).not.toHaveBeenCalled();
      expect(h.mutator).not.toHaveBeenCalled();
    },
  );

  it("TestBR245_a_latched_sink_and_a_closed_gate_refuse_with_AUDIT_UNAVAILABLE", async () => {
    const h = harness();
    h.sink.latch();
    const refused = {
      result: "failed",
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    };
    expect(await h.run()).toEqual(refused);
    const closed = harness();
    await closed.gate.close();
    expect(await closed.run()).toEqual(refused);
    for (const x of [h, closed]) {
      expect(x.lines).toEqual([]);
      expect(x.policy).not.toHaveBeenCalled();
      expect(x.mutator).not.toHaveBeenCalled();
    }
  });

  it.each(PAIRS)(
    "TestBR245_admission_table_%s_admits_its_kind",
    async (tool, operation) => {
      const h = harness();
      expect((await h.run({ tool, operation })).result).toBe("succeeded");
      expect(h.mutator).toHaveBeenCalledTimes(1);
    },
  );
});

describe("BR-246 policy denial", () => {
  it.each([
    ["denial", { deny: true }],
    ["thrown dispatch", { throws: true }],
  ] as [string, HarnessOptions][])(
    "TestBR246_a_%s_writes_one_denied_record_and_no_intent",
    async (_name, options) => {
      const h = harness(options);
      expect(await h.run()).toEqual({
        result: "denied",
        op: OP,
        code: "ACCESS_DENIED",
        attempts: 0,
      });
      expect(h.records().map((r) => [r.event, r.code])).toEqual([
        ["denied", "ACCESS_DENIED"],
      ]);
      expect(h.mutator).not.toHaveBeenCalled();
      expect(h.policy).toHaveBeenCalledTimes(1);
    },
  );

  it("TestBR246_a_failing_denied_record_leaves_the_result_unchanged", async () => {
    const h = harness({
      deny: true,
      write: (_i, _commit, fail) => {
        fail(errno("ENOSPC"));
      },
    });
    expect(await h.run()).toEqual({
      result: "denied",
      op: OP,
      code: "ACCESS_DENIED",
      attempts: 0,
    });
  });

  it("TestBR246_an_execute_outside_a_run_or_for_another_operation_is_unavailable", async () => {
    const h = harness();
    expect(await h.gate.execute(Object.freeze({ ...rename }) as never)).toEqual(
      { status: "unavailable" },
    );
    const result = await h.gate.run({
      tool: "kdrive_rename",
      operation: rename,
      identity: { kind: "stdio" },
      dispatch: async () => ({
        ok: true,
        value: await h.gate.execute(
          Object.freeze({ ...rename, name: "other" }),
        ),
      }),
    });
    expect(result).toEqual({
      result: "denied",
      op: OP,
      code: "ACCESS_DENIED",
      attempts: 0,
    });
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it("TestBR246_a_late_execute_after_a_settled_denial_never_commits", async () => {
    const h = harness();
    let late: Promise<unknown> | undefined;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = await h.gate.run({
      tool: "kdrive_rename",
      operation: rename,
      identity: { kind: "stdio" },
      dispatch: () => {
        late = gate.then(() =>
          h.gate.execute(Object.freeze({ ...rename }) as never),
        );
        return Promise.resolve({ ok: false, code: "ACCESS_DENIED" });
      },
    });
    expect(result).toEqual({
      result: "denied",
      op: OP,
      code: "ACCESS_DENIED",
      attempts: 0,
    });
    release();
    expect(await late).toEqual({ status: "unavailable" });
    expect(h.mutator).not.toHaveBeenCalled();
  });
});

describe("BR-247 classification", () => {
  const rejected = [400, 401, 403, 404, 405, 409, 410, 411, 412, 413, 415, 422];
  const uncertainStatuses = [100, 301, 302, 408, 418, 500, 502, 503, 504];
  it.each([
    ...[200, 201, 204].map(
      (s) =>
        [
          `${String(s)} accepted`,
          () => Promise.resolve(response(s)),
          {
            result: "succeeded",
            status: s,
          },
        ] as const,
    ),
    [
      "200 not accepted",
      () => Promise.resolve(response(200, { accepted: false })),
      { result: "uncertain", status: 200, code: "UPSTREAM_UNCERTAIN" },
    ] as const,
    ...rejected.map(
      (s) =>
        [
          String(s),
          () => Promise.resolve(response(s)),
          {
            result: "failed",
            status: s,
            code: "UPSTREAM_REJECTED",
          },
        ] as const,
    ),
    ...uncertainStatuses.map(
      (s) =>
        [
          String(s),
          () => Promise.resolve(response(s)),
          {
            result: "uncertain",
            status: s,
            code: "UPSTREAM_UNCERTAIN",
          },
        ] as const,
    ),
    [
      "NotSent",
      () => Promise.reject(new NotSent()),
      { result: "failed", code: "NOT_SENT" },
    ] as const,
    [
      "unbranded NotSent lookalike",
      () =>
        Promise.reject(
          Object.assign(new Error("NOT_SENT"), { name: "NotSent" }),
        ),
      { result: "uncertain", code: "UPSTREAM_UNCERTAIN" },
    ] as const,
    [
      "thrown string",
      () =>
        Promise.reject(new Error("x")).catch(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- BR-247: a thrown non-Error is part of the table
          throw "connection reset";
        }),
      { result: "uncertain", code: "UPSTREAM_UNCERTAIN" },
    ] as const,
    [
      "thrown object with status",
      () => Promise.reject(Object.assign(new Error("e"), { status: 409 })),
      { result: "uncertain", code: "UPSTREAM_UNCERTAIN" },
    ] as const,
    [
      "synchronous throw",
      () => {
        throw new Error("sync");
      },
      { result: "uncertain", code: "UPSTREAM_UNCERTAIN" },
    ] as const,
    ...(
      [
        null,
        "200",
        { outcome: "other", status: 200, accepted: true },
        { outcome: "response", status: "200", accepted: true },
        { outcome: "response", status: 99, accepted: false },
        { outcome: "response", status: 600, accepted: false },
        { outcome: "response", status: 200.5, accepted: true },
        { outcome: "response", status: 200 },
        { outcome: "response", status: 200, accepted: true, created: -1 },
        {
          outcome: "response",
          status: 429,
          accepted: false,
          retryAfter: "1".repeat(33),
        },
      ] as unknown[]
    ).map(
      (value) =>
        [
          `malformed ${JSON.stringify(value)}`,
          () => Promise.resolve(value),
          {
            result: "uncertain",
            code: "UPSTREAM_UNCERTAIN",
          },
        ] as const,
    ),
  ] as unknown as [string, Mutator, Record<string, unknown>][])(
    "TestBR247_%s",
    async (_name, mutator, expected) => {
      const h = harness({ mutator });
      const result = await h.run();
      expect(result).toMatchObject({ ...expected, attempts: 1 });
      if (!("status" in expected)) expect(result).not.toHaveProperty("status");
      if (!("code" in expected)) expect(result).not.toHaveProperty("code");
      const outcome = h.records()[1];
      expect(outcome).toMatchObject({ event: "outcome", ...expected });
      expect(h.mutator).toHaveBeenCalledTimes(1);
    },
  );

  it("TestBR247_a_getter_on_the_result_is_never_invoked", async () => {
    const getter = vi.fn(() => 200);
    const h = harness({
      mutator: () =>
        Promise.resolve(
          Object.defineProperty(
            { outcome: "response", accepted: true },
            "status",
            {
              get: getter,
              enumerable: true,
            },
          ),
        ),
    });
    expect((await h.run()).result).toBe("uncertain");
    expect(getter).not.toHaveBeenCalled();
  });
});

// F-037 v1: complete result and JSONL contracts for the pending v2 rules.
const BASE = {
  v: 1,
  ts: "2026-11-09T10:00:00.000Z",
  op: OP,
  identity: { kind: "stdio" },
  tool: "kdrive_rename",
  kind: "rename",
  drive: 101,
  ids: { target: 42 },
};
const LIMITED = {
  result: "failed",
  op: OP,
  code: "RATE_LIMITED",
  attempts: 1,
  status: 429,
};
const limitedRecords = (ms = 0, base = BASE) => [
  { ...base, event: "intent" },
  {
    ...base,
    event: "outcome",
    result: "failed",
    attempts: 1,
    ms,
    status: 429,
    code: "RATE_LIMITED",
  },
];

describe("BR-248 v2 one attempt per invocation", () => {
  async function terminal429(
    retryAfter: string | undefined,
    tool = "kdrive_rename",
    operation: Record<string, unknown> = rename,
    ids: { target?: number; destination?: number } = { target: 42 },
  ) {
    vi.useFakeTimers();
    const replies = [
      response(429, retryAfter === undefined ? {} : { retryAfter }),
      response(200),
    ];
    const h = harness({
      mode: "share",
      mutator: () => Promise.resolve(replies.shift()),
    });
    const base = { ...BASE, tool, kind: operation.kind, ids };
    const expected = [
      { ...base, event: "intent" },
      {
        ...base,
        event: "outcome",
        result: "failed",
        attempts: 1,
        ms: 0,
        status: 429,
        code: "RATE_LIMITED",
      },
    ];
    const start = performance.now();
    let result: GateResult | undefined;
    const pending = h.run({ tool, operation }).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toEqual(LIMITED);
    expect(performance.now() - start).toBe(0);
    expect(h.records()).toEqual(expected);
    await pending;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(result).toEqual(LIMITED);
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(h.policy).toHaveBeenCalledTimes(1);
    expect(replies).toEqual([response(200)]);
    expect(h.records()).toEqual(expected);
  }

  it.each([
    undefined,
    "0",
    "1",
    "5",
    "30",
    "31",
    "9999999999",
    "",
    "-1",
    "1.5",
    " 5",
    "12345678901",
    "Wed, 21 Oct 2026 07:28:00 GMT",
    // Retain the other v1 over-ceiling inputs.
    "100",
    "0000000031",
  ])(
    "TestBR248_v2_AC01_retry_after_%j_never_schedules_another_attempt",
    async (retryAfter) => {
      await terminal429(retryAfter);
    },
  );

  const ids = [
    { destination: 1 },
    { destination: 1 },
    { target: 42, destination: 1 },
    { target: 42 },
    { target: 42, destination: 5 },
    { target: 42 },
    { target: 42 },
    { target: 42 },
    { target: 42 },
  ];
  it.each(KINDS)(
    "TestBR248_v2_AC01_kind_%s_stops_on_the_first_429",
    async (kind) => {
      const index = KINDS.indexOf(kind);
      const [tool, operation] = PAIRS[index]!;
      await terminal429("5", tool, operation, ids[index]);
    },
  );
});

describe("BR-249 attempt and run deadlines", () => {
  it("TestBR249_an_attempt_is_aborted_after_30000_ms_and_is_uncertain", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const h = harness({
      mutator: (_op, _payload, s) => {
        signal = s;
        return new Promise(() => undefined);
      },
    });
    let result: GateResult | undefined;
    void h.run().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({
      result: "uncertain",
      code: "UPSTREAM_UNCERTAIN",
      attempts: 1,
    });
  });

  it.each([429, 200])(
    "TestBR249_v2_AC06_attempt_deadline_remains_uncertain_without_retry",
    async (lateStatus) => {
      vi.useFakeTimers();
      let release!: (value: unknown) => void;
      let signal: AbortSignal | undefined;
      const h = harness({
        mutator: (_op, _payload, attemptSignal) => {
          signal = attemptSignal;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      });
      let result: GateResult | undefined;
      const pending = h.run().then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(result).toBeUndefined();
      expect(signal?.aborted).toBe(false);
      expect(h.records()).toEqual([{ ...BASE, event: "intent" }]);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      const expected = {
        result: "uncertain",
        op: OP,
        code: "UPSTREAM_UNCERTAIN",
        attempts: 1,
        message:
          "The upstream result is unknown; verify the item's state before any new attempt.",
      };
      const records = [
        { ...BASE, event: "intent" },
        {
          ...BASE,
          event: "outcome",
          result: "uncertain",
          attempts: 1,
          ms: 30_000,
          code: "UPSTREAM_UNCERTAIN",
        },
      ];
      expect(result).toEqual(expected);
      expect(h.records()).toEqual(records);
      await pending;
      release(response(lateStatus, { retryAfter: "5" }));
      await vi.advanceTimersByTimeAsync(30_001);
      expect(result).toEqual(expected);
      expect(h.records()).toEqual(records);
      expect(h.mutator).toHaveBeenCalledTimes(1);
    },
  );

  it("TestBR249_v2_AC06_429_at_25000_ms_never_starts_a_second_attempt", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const h = harness({
      mutator: (_op, _payload, signal) => {
        signals.push(signal);
        if (signals.length === 1)
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(response(429, { retryAfter: "10" }));
            }, 25_000);
          });
        return new Promise(() => undefined);
      },
    });
    let result: GateResult | undefined;
    let settledAt: number | undefined;
    const start = performance.now();
    const pending = h.run().then((value) => {
      result = value;
      settledAt = performance.now() - start;
    });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(result).toEqual(LIMITED);
    expect(settledAt).toBe(25_000);
    expect(h.records()).toEqual(limitedRecords(25_000));
    await pending;
    await vi.advanceTimersByTimeAsync(35_001);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(result).toEqual(LIMITED);
    expect(h.records()).toEqual(limitedRecords(25_000));
  });
});

describe("BR-250 cancellation", () => {
  it("TestBR250_a_cancellation_before_the_intent_makes_zero_records", async () => {
    const cancel = new AbortController();
    const h = harness({
      beforeExecute: () => {
        cancel.abort();
      },
    });
    expect(await h.run({ cancellation: cancel.signal })).toEqual({
      result: "failed",
      op: OP,
      code: "CANCELLED",
      attempts: 0,
    });
    expect(h.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it.each([
    ["REQUEST_TIMEOUT", false],
    ["CANCELLED", false],
    ["REQUEST_TIMEOUT", true],
  ] as const)(
    "TestBR250_a_navigation_%s_at_dispatch_settle_makes_zero_records_denied_%s",
    async (code, deny) => {
      let interrupted = false;
      const h = harness({
        deny,
        beforeExecute: () => {
          interrupted = true;
        },
      });
      expect(
        await h.run({ interrupted: () => (interrupted ? code : undefined) }),
      ).toEqual({ result: "failed", op: OP, code, attempts: 0 });
      expect(h.lines).toEqual([]);
      expect(h.mutator).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["while the intent append is pending", "pending"],
    ["after the intent resolved", "after"],
  ])("TestBR250_a_cancellation_%s_records_CANCELLED", async (_name, when) => {
    const cancel = new AbortController();
    let release!: () => void;
    const h = harness({
      write: (i, commit) => {
        if (i !== 0) {
          commit();
          return;
        }
        if (when === "after") {
          commit();
          cancel.abort();
        } else
          release = () => {
            commit();
          };
      },
    });
    const pending = h.run({ cancellation: cancel.signal });
    if (when === "pending") {
      await vi.waitFor(() => {
        expect(release).toBeTypeOf("function");
      });
      cancel.abort();
      release();
    }
    expect(await pending).toEqual({
      result: "failed",
      op: OP,
      code: "CANCELLED",
      attempts: 0,
    });
    expect(h.mutator).not.toHaveBeenCalled();
    expect(h.records().map((r) => [r.event, r.result, r.code])).toEqual([
      ["intent", undefined, undefined],
      ["outcome", "failed", "CANCELLED"],
    ]);
  });

  it.each(["during_attempt", "during_outcome"])(
    "TestBR250_v2_AC05_cancellation_%s_does_not_replace_a_429",
    async (when) => {
      vi.useFakeTimers();
      const cancel = new AbortController();
      let reply!: (value: unknown) => void;
      let append: (() => void) | undefined;
      let signal: AbortSignal | undefined;
      const h = harness({
        mutator: (_op, _payload, attemptSignal) => {
          signal = attemptSignal;
          return new Promise((resolve) => {
            reply = resolve;
          });
        },
        write: (index, commit) => {
          if (index === 1 && when === "during_outcome") append = commit;
          else commit();
        },
      });
      let result: GateResult | undefined;
      const pending = h.run({ cancellation: cancel.signal }).then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.mutator).toHaveBeenCalledTimes(1);
      expect(h.records()).toEqual([{ ...BASE, event: "intent" }]);
      if (when === "during_attempt") cancel.abort();
      expect(signal?.aborted).toBe(false);
      reply(response(429, { retryAfter: "5" }));
      await vi.advanceTimersByTimeAsync(0);
      if (when === "during_outcome") {
        expect(append).toBeTypeOf("function");
        expect(result).toBeUndefined();
        expect(h.records()).toEqual([{ ...BASE, event: "intent" }]);
        cancel.abort();
        append!();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(result).toEqual(LIMITED);
      expect(h.records()).toEqual(limitedRecords());
      await pending;
      await vi.advanceTimersByTimeAsync(60_001);
      expect(signal?.aborted).toBe(false);
      expect(h.mutator).toHaveBeenCalledTimes(1);
      expect(result).toEqual(LIMITED);
      expect(h.records()).toEqual(limitedRecords());
    },
  );

  it("TestBR250_v2_AC05_pre_attempt_cancellation_keeps_its_boundary", async () => {
    vi.useFakeTimers();
    for (const boundary of ["dispatch", "after_intent"]) {
      const cancel = new AbortController();
      const h = harness({
        beforeExecute: () => {
          if (boundary === "dispatch") cancel.abort();
        },
        write: (index, commit) => {
          commit();
          if (index === 0) cancel.abort();
        },
      });
      expect(await h.run({ cancellation: cancel.signal })).toEqual({
        result: "failed",
        op: OP,
        code: "CANCELLED",
        attempts: 0,
      });
      expect(h.records()).toEqual(
        boundary === "dispatch"
          ? []
          : [
              { ...BASE, event: "intent" },
              {
                ...BASE,
                event: "outcome",
                result: "failed",
                attempts: 0,
                ms: 0,
                code: "CANCELLED",
              },
            ],
      );
      expect(h.mutator).not.toHaveBeenCalled();
    }
  });

  it("TestBR250_a_cancellation_during_an_attempt_does_not_abort_it", async () => {
    const cancel = new AbortController();
    let signal: AbortSignal | undefined;
    const h = harness({
      mutator: async (_op, _payload, s) => {
        signal = s;
        cancel.abort();
        await new Promise((r) => setImmediate(r));
        return response(200);
      },
    });
    expect(await h.run({ cancellation: cancel.signal })).toMatchObject({
      result: "succeeded",
      attempts: 1,
    });
    expect(signal?.aborted).toBe(false);
    expect(h.records()[1]).toMatchObject({ result: "succeeded" });
  });
});

describe("F-037 classification and outcome failure controls", () => {
  it.each([
    "503",
    "412",
    "500",
    "unbranded_throw",
    "not_sent",
    "missing_accepted",
    "accessor_status",
    "oversize_retry_after",
  ])(
    "TestBR248_v2_AC07_reply_%s_preserves_classification_without_retry",
    async (kind) => {
      vi.useFakeTimers();
      const getter = vi.fn(() => 429);
      const replies: Record<string, () => Promise<unknown>> = {
        "503": () => Promise.resolve(response(503)),
        "412": () => Promise.resolve(response(412)),
        "500": () => Promise.resolve(response(500)),
        unbranded_throw: () => Promise.reject(new Error("private failure")),
        not_sent: () => Promise.reject(new NotSent()),
        missing_accepted: () =>
          Promise.resolve({ outcome: "response", status: 429 }),
        accessor_status: () =>
          Promise.resolve(
            Object.defineProperty(
              { outcome: "response", accepted: false },
              "status",
              { get: getter, enumerable: true },
            ),
          ),
        oversize_retry_after: () =>
          Promise.resolve(response(429, { retryAfter: "1".repeat(33) })),
      };
      const h = harness({ mutator: replies[kind]! });
      const rejected = kind === "412";
      const notSent = kind === "not_sent";
      const outcome = {
        result: rejected || notSent ? "failed" : "uncertain",
        attempts: 1,
        code: rejected
          ? "UPSTREAM_REJECTED"
          : notSent
            ? "NOT_SENT"
            : "UPSTREAM_UNCERTAIN",
        ...(["503", "412", "500"].includes(kind)
          ? { status: Number(kind) }
          : {}),
      };
      const expected = {
        ...outcome,
        op: OP,
        ...(outcome.result === "uncertain"
          ? {
              message:
                "The upstream result is unknown; verify the item's state before any new attempt.",
            }
          : {}),
      };
      let result: GateResult | undefined;
      const pending = h.run().then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual(expected);
      const records = [
        { ...BASE, event: "intent" },
        { ...BASE, event: "outcome", ...outcome, ms: 0 },
      ];
      expect(h.records()).toEqual(records);
      await pending;
      await vi.advanceTimersByTimeAsync(60_001);
      expect(h.mutator).toHaveBeenCalledTimes(1);
      expect(getter).not.toHaveBeenCalled();
      expect(result).toEqual(expected);
      expect(h.records()).toEqual(records);
    },
  );

  it("TestBR248_v2_AC07_failed_429_outcome_append_never_replays", async () => {
    vi.useFakeTimers();
    const attempted: unknown[] = [];
    const persisted: unknown[] = [];
    const sink = createStderrSink({
      write(chunk, callback) {
        const record: unknown = JSON.parse(chunk);
        attempted.push(record);
        if (attempted.length === 1) {
          persisted.push(record);
          callback();
        } else callback(new Error("synthetic append failure"));
        return true;
      },
    });
    const h = harness({
      sink,
      mutator: () => Promise.resolve(response(429, { retryAfter: "5" })),
    });
    let result: GateResult | undefined;
    const pending = h.run().then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    const expected = { ...LIMITED, audit: "outcome_unrecorded" };
    expect(result).toEqual(expected);
    await pending;
    expect(persisted).toEqual([{ ...BASE, event: "intent" }]);
    expect(attempted).toEqual(limitedRecords());
    expect(sink.latched).toBe(true);
    expect(h.diagnostics).toEqual([
      "Audit outcome could not be recorded; further writes are refused until restart.\n",
    ]);
    expect(await h.run()).toEqual({
      result: "failed",
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(h.policy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expected);
    expect(persisted).toEqual([{ ...BASE, event: "intent" }]);
    expect(attempted).toEqual(limitedRecords());
    expect(h.diagnostics).toEqual([
      "Audit outcome could not be recorded; further writes are refused until restart.\n",
    ]);
  });
});

describe("BR-251 uncertain results", () => {
  it.each([
    ["503", () => Promise.resolve(response(503)), false],
    ["timeout", () => new Promise(() => undefined), true],
    [
      "connection loss",
      () =>
        Promise.reject(
          Object.assign(new Error("reset"), { code: "ECONNRESET" }),
        ),
      false,
    ],
  ] as [string, Mutator, boolean][])(
    "TestBR251_%s_is_uncertain_with_the_fixed_message_and_no_retry",
    async (_name, mutator, fake) => {
      if (fake) vi.useFakeTimers();
      const h = harness({ mutator });
      const pending = h.run();
      if (fake) await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toMatchObject({
        result: "uncertain",
        code: "UPSTREAM_UNCERTAIN",
        attempts: 1,
        message: UNCERTAIN_MESSAGE,
      });
      expect(UNCERTAIN_MESSAGE).toBe(
        "The upstream result is unknown; verify the item's state before any new attempt.",
      );
      expect(h.mutator).toHaveBeenCalledTimes(1);
      expect(h.records()[1]).toMatchObject({ result: "uncertain" });
    },
  );
});

describe("BR-252 outcome append failure", () => {
  it.each([
    [200, { result: "succeeded" }],
    [503, { result: "uncertain", code: "UPSTREAM_UNCERTAIN" }],
    [409, { result: "failed", code: "UPSTREAM_REJECTED" }],
  ] as [number, Record<string, unknown>][])(
    "TestBR252_status_%i_keeps_its_classification_with_outcome_unrecorded",
    async (status, expected) => {
      const h = harness({
        mutator: () => Promise.resolve(response(status)),
        write: (i, commit, fail) => {
          if (i === 1) fail(errno("ENOSPC"));
          else commit();
        },
      });
      const result = await h.run();
      expect(result).toMatchObject({
        ...expected,
        op: OP,
        attempts: 1,
        status,
        audit: "outcome_unrecorded",
      });
      expect(result.code).not.toBe("AUDIT_UNAVAILABLE");
      expect(h.mutator).toHaveBeenCalledTimes(1);
      expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
      expect(OUTCOME_UNRECORDED_DIAGNOSTIC).toBe(
        "Audit outcome could not be recorded; further writes are refused until restart.\n",
      );
      expect(h.sink.latched).toBe(true);
      expect(await h.run()).toEqual({
        result: "failed",
        code: "AUDIT_UNAVAILABLE",
        attempts: 0,
      });
      expect(h.diagnostics).toHaveLength(1);
      expect(h.mutator).toHaveBeenCalledTimes(1);
    },
  );
});

describe("BR-254 gate close", () => {
  it("TestBR254_close_waits_for_the_in_flight_outcome_then_closes_the_sink", async () => {
    let release!: () => void;
    const events: string[] = [];
    const inner = createStderrSink({
      write(chunk, callback) {
        events.push((JSON.parse(chunk) as { event: string }).event);
        callback();
        return true;
      },
    });
    const sink: AuditSink = {
      append: (record) => inner.append(record),
      get latched() {
        return inner.latched;
      },
      latch: () => {
        inner.latch();
      },
      close: async () => {
        events.push("sink-closed");
        await inner.close();
      },
    };
    const h = harness({
      sink,
      mutator: () =>
        new Promise((r) => {
          release = () => {
            r(response(200));
          };
        }),
    });
    const pending = h.run();
    await vi.waitFor(() => {
      expect(h.mutator).toHaveBeenCalled();
    });
    let closed = false;
    const closing = h.gate.close().then(() => (closed = true));
    expect(await h.run()).toEqual({
      result: "failed",
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
    await new Promise((r) => setImmediate(r));
    expect(closed).toBe(false);
    release();
    expect((await pending).result).toBe("succeeded");
    await closing;
    expect(events).toEqual(["intent", "outcome", "sink-closed"]);
  });
});

describe("BR-255 result members", () => {
  const allowed = [
    "result",
    "op",
    "code",
    "attempts",
    "status",
    "audit",
    "message",
    "value",
  ];
  it("TestBR255_every_result_uses_only_the_listed_members_and_fixed_messages", async () => {
    vi.useFakeTimers();
    const results: GateResult[] = [];
    for (const options of [
      {},
      { deny: true },
      { mutator: () => Promise.resolve(response(409)) },
      { mutator: () => Promise.resolve(response(503)) },
      { mutator: () => Promise.reject(new NotSent()) },
      { mutator: () => Promise.resolve(response(429, { retryAfter: "99" })) },
      { mode: "read" },
      {
        write: (i: number, commit: () => void, fail: (e: Error) => void) => {
          if (i === 1) fail(errno("EIO"));
          else commit();
        },
      },
    ] as HarnessOptions[]) {
      const pending = harness(options).run();
      await vi.runAllTimersAsync();
      results.push(await pending);
    }
    for (const result of results) {
      for (const key of Object.keys(result)) expect(allowed).toContain(key);
      if (result.message !== undefined)
        expect(result.message).toBe(UNCERTAIN_MESSAGE);
      if (result.result === "succeeded")
        expect(result).not.toHaveProperty("code");
    }
    expect(results[0]).toEqual({
      result: "succeeded",
      op: OP,
      attempts: 1,
      status: 200,
      value: { id: 42 },
    });
  });
});

describe("BR-259 slow intent appends", () => {
  function stallingPort(stallAt: number): AuditFilePort {
    let syncs = 0;
    return {
      open: () => Promise.resolve(3),
      fstat: () =>
        Promise.resolve({ isFile: () => true, uid: 1000, mode: 0o100600 }),
      geteuid: () => 1000,
      write: (_fd, data) => Promise.resolve(data.length),
      fdatasync: () =>
        syncs++ === stallAt
          ? new Promise<void>(() => undefined)
          : Promise.resolve(),
      close: () => Promise.resolve(),
    };
  }

  it("TestBR259_a_stalled_intent_fdatasync_gives_AUDIT_UNAVAILABLE_after_5000_ms", async () => {
    vi.useFakeTimers();
    const sink = await openFileSink("/synthetic/audit.log", {
      port: stallingPort(0),
    });
    const h = harness({ sink });
    let result: GateResult | undefined;
    void h.run().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(4999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({
      result: "failed",
      op: OP,
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
    });
    expect(sink.latched).toBe(true);
    expect(h.mutator).not.toHaveBeenCalled();
  });

  it("TestBR259_a_stalled_outcome_fdatasync_gives_outcome_unrecorded", async () => {
    vi.useFakeTimers();
    const sink = await openFileSink("/synthetic/audit.log", {
      port: stallingPort(1),
    });
    const h = harness({ sink });
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      result: "succeeded",
      audit: "outcome_unrecorded",
    });
  });

  // F-039 replaces the v1 late-outcome and exact-deadline success expectations.
  it.each([5000, 6000])(
    "TestBR259_v2_AC06_late_intent_never_dispatches (%i ms)",
    async (at) => {
      vi.useFakeTimers();
      const stream = boundedGateStream();
      const h = harness({ sink: stream.sink });
      const result = observeGate(h.run());
      await vi.advanceTimersByTimeAsync(0);
      setTimeout(() => {
        stream.complete(0);
      }, at);
      await vi.advanceTimersByTimeAsync(at);
      expect(result.value).toEqual(auditIntentFailure);
      expect(result.error).toBeUndefined();
      expect(h.mutator).not.toHaveBeenCalled();
      expect(stream.events()).toEqual(["intent"]);
      expect(stream.sink.latched).toBe(true);
      expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
    },
  );
});

// F-039: capture settlement without awaiting an intentionally stalled old sink.
function observeGate<T>(pending: Promise<T>) {
  const state: { value?: T; error?: unknown; settled: boolean } = {
    settled: false,
  };
  void pending.then(
    (value) => {
      state.value = value;
      state.settled = true;
    },
    (error: unknown) => {
      state.error = error;
      state.settled = true;
    },
  );
  return state;
}
function boundedGateStream(
  onWrite?: (index: number, complete: () => void) => void,
) {
  const emitter = new EventEmitter();
  const attempted: string[] = [],
    acknowledged: string[] = [];
  const callbacks: ((error?: Error | null) => void)[] = [];
  const complete = (index: number, error?: Error) => {
    const line = attempted[index];
    if (line !== undefined && error === undefined) acknowledged.push(line);
    callbacks[index]?.(error);
  };
  const sink = createStderrSink({
    on: (event, listener) => emitter.on(event, listener),
    write(line, callback) {
      const index = attempted.length;
      attempted.push(line);
      callbacks.push(callback);
      onWrite?.(index, () => {
        complete(index);
      });
      return false;
    },
  });
  return {
    sink,
    emitter,
    attempted,
    acknowledged,
    complete,
    events: () =>
      attempted.map((line) => (JSON.parse(line) as { event: string }).event),
  };
}
const auditIntentFailure = {
  result: "failed",
  op: OP,
  code: "AUDIT_UNAVAILABLE",
  attempts: 0,
};
const auditAdmissionFailure = {
  result: "failed",
  code: "AUDIT_UNAVAILABLE",
  attempts: 0,
};
const syntheticPrivateError = () =>
  new Error("SENTINEL_SECRET /private/audit.log underlying-stack");

async function assertAdmissionStillRefused(
  h: ReturnType<typeof harness>,
  stream: ReturnType<typeof boundedGateStream>,
) {
  const writes = stream.attempted.length,
    policies = h.policy.mock.calls.length;
  expect(await h.run()).toEqual(auditAdmissionFailure);
  expect(stream.attempted).toHaveLength(writes);
  expect(h.policy).toHaveBeenCalledTimes(policies);
  expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
}

describe("F-039 bounded gate audit waits", () => {
  it("TestBR259_v2_AC01_blocked_stderr_intent_fails_closed_at_5000_ms", async () => {
    vi.useFakeTimers();
    const stream = boundedGateStream();
    const h = harness({ sink: stream.sink });
    const result = observeGate(h.run());
    await vi.advanceTimersByTimeAsync(4999);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.value).toEqual(auditIntentFailure);
    expect(result.error).toBeUndefined();
    expect(stream.events()).toEqual(["intent"]);
    expect(stream.acknowledged).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(stream.sink.latched).toBe(true);
    await assertAdmissionStillRefused(h, stream);
  });

  it("TestBR241_v2_AC02_stream_error_without_callback_refuses_dispatch", async () => {
    vi.useFakeTimers();
    const stream = boundedGateStream();
    const h = harness({ sink: stream.sink });
    const result = observeGate(h.run());
    await vi.advanceTimersByTimeAsync(100);
    expect(result.settled).toBe(false);
    expect(() =>
      stream.emitter.emit("error", syntheticPrivateError()),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.value).toEqual(auditIntentFailure);
    expect(result.error).toBeUndefined();
    expect(stream.events()).toEqual(["intent"]);
    expect(stream.acknowledged).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    await assertAdmissionStillRefused(h, stream);
    stream.complete(0);
    stream.complete(0, syntheticPrivateError());
    stream.emitter.emit("error", syntheticPrivateError());
    await vi.advanceTimersByTimeAsync(6000);
    expect(result.value).toEqual(auditIntentFailure);
    expect(JSON.stringify(result)).not.toContain("SENTINEL_SECRET");
    expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
  });

  const outcomes = [
    {
      status: 200,
      value: {
        result: "succeeded",
        op: OP,
        attempts: 1,
        status: 200,
        value: { id: 42 },
        audit: "outcome_unrecorded",
      },
    },
    {
      status: 409,
      value: {
        result: "failed",
        op: OP,
        code: "UPSTREAM_REJECTED",
        attempts: 1,
        status: 409,
        audit: "outcome_unrecorded",
      },
    },
    {
      status: 429,
      value: {
        result: "failed",
        op: OP,
        code: "RATE_LIMITED",
        attempts: 1,
        status: 429,
        audit: "outcome_unrecorded",
      },
    },
    {
      status: 503,
      value: {
        result: "uncertain",
        op: OP,
        code: "UPSTREAM_UNCERTAIN",
        attempts: 1,
        status: 503,
        audit: "outcome_unrecorded",
        message: UNCERTAIN_MESSAGE,
      },
    },
  ];
  const outcomeRows = outcomes.flatMap((outcome) =>
    ["timeout", "stream-error"].flatMap((failure) =>
      ["held", "throwing"].map((diagnostic) => ({
        ...outcome,
        failure,
        diagnostic,
      })),
    ),
  );
  it.each(outcomeRows)(
    "TestBR259_v2_AC04_outcome_failure_preserves_each_classification ($status, $failure, $diagnostic)",
    async ({ status, value, failure, diagnostic }) => {
      vi.useFakeTimers();
      const stream = boundedGateStream((index, complete) => {
        if (index === 0) complete();
      });
      const h = harness({
        sink: stream.sink,
        mutator: () =>
          Promise.resolve(
            response(status, status === 200 ? { value: { id: 42 } } : {}),
          ),
        diagnostic: () => {
          if (diagnostic === "throwing") throw syntheticPrivateError();
          // No callback or drain notification: the gate must not wait for one.
        },
      });
      const result = observeGate(h.run());
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.events()).toEqual(["intent", "outcome"]);
      expect(stream.acknowledged).toHaveLength(1);
      expect(result.settled).toBe(false);
      if (failure === "stream-error") {
        await vi.advanceTimersByTimeAsync(100);
        stream.emitter.emit("error", syntheticPrivateError());
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await vi.advanceTimersByTimeAsync(4999);
        expect(result.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(result.value).toEqual(value);
      expect(result.error).toBeUndefined();
      expect(h.mutator).toHaveBeenCalledTimes(1);
      expect(stream.sink.latched).toBe(true);
      await assertAdmissionStillRefused(h, stream);
      stream.complete(1);
      stream.emitter.emit("error", syntheticPrivateError());
      await vi.advanceTimersByTimeAsync(0);
      expect(result.value).toEqual(value);
      expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
    },
  );

  it.each(["denied", "cancel-during-intent", "cancel-after-intent"] as const)(
    "TestBR259_v2_AC05_denied_and_cancelled_runs_settle (%s)",
    async (row) => {
      vi.useFakeTimers();
      const cancel = new AbortController();
      const stream = boundedGateStream((index, complete) => {
        if (row === "cancel-after-intent" && index === 0) {
          complete();
          cancel.abort();
        }
      });
      const h = harness({ sink: stream.sink, deny: row === "denied" });
      const result = observeGate(h.run({ cancellation: cancel.signal }));
      await vi.advanceTimersByTimeAsync(0);
      if (row === "cancel-during-intent") cancel.abort();
      await vi.advanceTimersByTimeAsync(4999);
      expect(result.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(result.value).toEqual(
        row === "denied"
          ? { result: "denied", op: OP, code: "ACCESS_DENIED", attempts: 0 }
          : row === "cancel-during-intent"
            ? auditIntentFailure
            : {
                result: "failed",
                op: OP,
                code: "CANCELLED",
                attempts: 0,
                audit: "outcome_unrecorded",
              },
      );
      expect(result.error).toBeUndefined();
      expect(stream.events()).toEqual(
        row === "denied"
          ? ["denied"]
          : row === "cancel-during-intent"
            ? ["intent"]
            : ["intent", "outcome"],
      );
      expect(stream.acknowledged).toHaveLength(
        row === "cancel-after-intent" ? 1 : 0,
      );
      expect(h.mutator).not.toHaveBeenCalled();
      expect(stream.sink.latched).toBe(true);
      expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
    },
  );

  it("TestBR259_v2_AC06_gate_rejects_stale_acknowledgement", async () => {
    vi.useFakeTimers();
    let now = 0;
    const records: AuditRecord[] = [];
    const sink: AuditSink = {
      latched: false,
      append: (record) => {
        records.push(record);
        if (record.event === "intent") now = 5000;
        return Promise.resolve();
      },
      latch() {},
      close: () => Promise.resolve(),
    };
    const h = harness({ sink, now: () => now });
    expect(await h.run()).toEqual(auditIntentFailure);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(records.map((record) => record.event)).toEqual([
      "intent",
      "outcome",
    ]);
    expect(records[1]).toMatchObject({
      result: "failed",
      code: "AUDIT_UNAVAILABLE",
      attempts: 0,
      ms: 0,
    });
    expect(h.diagnostics).toEqual([]);
  });

  it("TestBR240_v2_AC10_normal_audit_path_is_unchanged", async () => {
    vi.useFakeTimers();
    const h = harness();
    expect(await h.run()).toEqual({
      result: "succeeded",
      op: OP,
      attempts: 1,
      status: 200,
      value: { id: 42 },
    });
    const base = `{"v":1,"ts":"2026-11-09T10:00:00.000Z","event":`;
    const identity = `"op":"${OP}","identity":{"kind":"stdio"},"tool":"kdrive_rename","kind":"rename","drive":101,"ids":{"target":42}`;
    expect(h.lines).toEqual([
      `${base}"intent",${identity}}\n`,
      `${base}"outcome",${identity},"result":"succeeded","attempts":1,"ms":0,"status":200}\n`,
    ]);
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(h.sink.latched).toBe(false);
    expect(h.diagnostics).toEqual([]);
    await h.gate.close();
    const read = harness({ mode: "read" });
    expect(await read.run()).toEqual({
      result: "failed",
      code: "ACCESS_DENIED",
      attempts: 0,
    });
    expect(read.lines).toEqual([]);
    expect(read.policy).not.toHaveBeenCalled();
  });
});

describe("F-039 first-latch diagnostic", () => {
  const failures = [
    "intent-timeout",
    "denied-timeout",
    "outcome-failure",
    "idle-error",
    "close-expiry",
    "release-rejection",
  ] as const;
  const rows = failures.flatMap((failure) =>
    ["held", "throws", "reentrant"].map((writer) => ({ failure, writer })),
  );
  it.each(rows)(
    "TestBR241_v2_AC14_every_first_latch_offers_one_fixed_diagnostic ($failure, $writer)",
    async ({ failure, writer }) => {
      vi.useFakeTimers();
      const stream = boundedGateStream((index, complete) => {
        if (failure === "outcome-failure" && index === 0) complete();
      });
      let releaseCalls = 0;
      let release!: () => void;
      const file =
        failure === "close-expiry" || failure === "release-rejection";
      const sink = file
        ? await openFileSink("/synthetic/SENTINEL_SECRET/audit.log", {
            port: {
              open: () => Promise.resolve(3),
              fstat: () =>
                Promise.resolve({
                  isFile: () => true,
                  uid: 1000,
                  mode: 0o100600,
                }),
              geteuid: () => 1000,
              write: (_fd, data) => Promise.resolve(data.length),
              fdatasync: () => Promise.resolve(),
              close: () => {
                releaseCalls++;
                if (failure === "release-rejection")
                  return Promise.reject(syntheticPrivateError());
                return new Promise<void>((resolve) => {
                  release = resolve;
                });
              },
            },
          })
        : stream.sink;
      const h = harness({
        sink,
        deny: failure === "denied-timeout",
        diagnostic: () => {
          if (writer === "throws") throw syntheticPrivateError();
          if (writer === "reentrant")
            stream.emitter.emit("error", syntheticPrivateError());
          // The held writer accepts the attempt and never offers a callback/drain.
        },
      });
      let result: ReturnType<typeof observeGate<GateResult>> | undefined;
      let closing: ReturnType<typeof observeGate<void>> | undefined;
      if (file) closing = observeGate(h.gate.close());
      else if (failure === "idle-error")
        stream.emitter.emit("error", syntheticPrivateError());
      else {
        result = observeGate(h.run());
        await vi.advanceTimersByTimeAsync(0);
        if (failure === "outcome-failure")
          stream.complete(1, syntheticPrivateError());
      }
      await vi.advanceTimersByTimeAsync(
        failure.endsWith("timeout") || failure === "close-expiry" ? 5000 : 0,
      );
      expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
      expect(sink.latched).toBe(true);
      if (result) {
        expect(result.error).toBeUndefined();
        const expected: Record<string, object> = {
          "outcome-failure": {
            result: "succeeded",
            op: OP,
            attempts: 1,
            status: 200,
            value: { id: 42 },
            audit: "outcome_unrecorded",
          },
          "denied-timeout": {
            result: "denied",
            op: OP,
            code: "ACCESS_DENIED",
            attempts: 0,
          },
          "intent-timeout": auditIntentFailure,
        };
        expect(result.value).toEqual(expected[failure]);
      }
      if (closing) {
        expect(closing.settled).toBe(true);
        expect(closing.error).toBeUndefined();
      }
      expect(await h.run()).toEqual(auditAdmissionFailure);
      const before = stream.attempted.length;
      expect(() =>
        stream.emitter.emit("error", syntheticPrivateError()),
      ).not.toThrow();
      if (stream.attempted.length) {
        stream.complete(stream.attempted.length - 1);
        stream.complete(stream.attempted.length - 1, syntheticPrivateError());
      }
      if (failure === "close-expiry") release();
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.attempted).toHaveLength(before);
      expect(h.diagnostics).toEqual([OUTCOME_UNRECORDED_DIAGNOSTIC]);
      expect(h.diagnostics.join("")).not.toMatch(
        /SENTINEL_SECRET|private|stack|"event"/u,
      );
      if (file) expect(releaseCalls).toBe(1);
    },
  );

  it.each(["healthy-close", "oversize-validation"])(
    "TestBR241_v2_AC14_every_first_latch_offers_one_fixed_diagnostic (no latch: %s)",
    async (row) => {
      const stream = boundedGateStream((_index, complete) => {
        complete();
      });
      const h = harness({ sink: stream.sink });
      if (row === "oversize-validation") {
        const record: AuditRecord = {
          ts: "2026-11-09T10:00:00.000Z",
          event: "intent",
          op: OP,
          identity: { kind: "oauth", iss: "i", sub: "" },
          tool: "kdrive_rename",
          kind: "rename",
          drive: 101,
          ids: { target: 42 },
        };
        const base = Buffer.byteLength(serializeAuditRecord(record));
        const oversize: AuditRecord = {
          ...record,
          identity: { kind: "oauth", iss: "i", sub: "s".repeat(8193 - base) },
        };
        await expect(stream.sink.append(oversize)).rejects.toThrow(
          "AUDIT_UNAVAILABLE",
        );
        expect(stream.attempted).toEqual([]);
      }
      await h.gate.close();
      expect(stream.sink.latched).toBe(false);
      expect(h.diagnostics).toEqual([]);
    },
  );
});

// F-041 AC-04: failed best-effort denial audit with the real policy facade.
it.each(structuralKinds)(
  "TestBR278_v2_AC04_failed_denied_append_keeps_access_denied %s",
  async (kind) => {
    const f = await ancestorFixture();
    const append = vi.fn<AuditSink["append"]>(() =>
      Promise.reject(new Error("synthetic sink failure")),
    );
    const h = harness({
      sink: {
        append,
        latched: false,
        latch: () => undefined,
        close: () => Promise.resolve(),
      },
    });
    const policy = createPolicy(
      f.config,
      gatedDependencies(f.dependencies, h.gate),
    );
    expect(
      await h.gate.run({
        tool: `kdrive_${kind}`,
        operation: structuralOperation(kind, 10),
        identity: { kind: "stdio" },
        dispatch: (op) => policy.dispatch(op),
      }),
    ).toEqual({ result: "denied", op: OP, code: "ACCESS_DENIED", attempts: 0 });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]![0]).toEqual({
      v: 1,
      ts: "2026-11-09T10:00:00.000Z",
      event: "denied",
      op: OP,
      identity: { kind: "stdio" },
      tool: `kdrive_${kind}`,
      kind,
      drive: 101,
      ids: { target: 10, ...(kind === "move" ? { destination: 30 } : {}) },
      code: "ACCESS_DENIED",
    });
    expect(h.mutator).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    await h.gate.close();
  },
);

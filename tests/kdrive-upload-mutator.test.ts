// F-018 AC-07, AC-08 (BR-190 v3, BR-266 v2, BR-284–BR-286, BR-268): the
// upload-new and replace mutators against a raw loopback TLS server.
import { afterEach, describe, expect, it } from "vitest";
import { createStderrSink } from "../src/audit/sink.js";
import {
  NotSent,
  createMutationGate,
  type Mutator,
} from "../src/mutation-gate.js";
import { createKdriveAdapter } from "../src/kdrive/index.js";
import { createMutators } from "../src/kdrive/mutators.js";
import { mutationRoutes } from "../src/kdrive/routes.js";
import type { Operation } from "../src/policy/operation.js";
import { CANARY } from "./helpers/kdrive.js";
import {
  json,
  rawServer,
  response,
  type RawHandler,
} from "./helpers/raw-tls.js";

const D = 101;
const PARENT = 40;
const TARGET = 41;
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
});
async function server(handler: RawHandler) {
  const s = await rawServer(handler);
  cleanup.push(() => s.close());
  return s;
}
function setup(s: Awaited<ReturnType<typeof rawServer>>) {
  const observed: [string, string][] = [];
  const a = createKdriveAdapter({
    token: CANARY,
    lookup: s.lookup,
    connect: s.connect,
    onRequest: (method, template) => observed.push([method, template]),
  });
  const sink = createStderrSink({
    write(_chunk, callback) {
      callback();
      return true;
    },
  });
  const gate = createMutationGate({
    mode: "write",
    sink,
    mutators: a.mutators,
    random: (n) => new Uint8Array(n),
    clock: () => new Date("2026-11-10T10:00:00.000Z"),
    now: () => performance.now(),
    diagnostic: () => undefined,
  });
  return {
    observed,
    run: (operation: Operation, payload: Buffer) =>
      gate.run({
        tool: "kdrive_upload",
        operation,
        identity: { kind: "stdio" },
        payload,
        dispatch: (op) => gate.execute(op),
      }),
  };
}
const ref = (id: number) => ({ driveId: D, id });
const NAME = "a&b=c%d e-é";
const OPS: Record<"upload-new" | "replace", Operation> = {
  "upload-new": { kind: "upload-new", destination: ref(PARENT), name: NAME },
  replace: {
    kind: "replace",
    target: ref(TARGET),
    destination: ref(PARENT),
    name: NAME,
  },
};
const CONFLICT = { "upload-new": "error", replace: "version" } as const;
const kinds = Object.keys(OPS) as (keyof typeof OPS)[];
function file(kind: keyof typeof OPS, size: number, extra = {}) {
  return {
    id: kind === "replace" ? TARGET : 77,
    type: "file",
    name: NAME,
    size,
    parent_id: PARENT,
    ...extra,
  };
}
const ok = (data: unknown) => json(200, { result: "success", data });

describe("AC-07 one POST on the upload route", () => {
  for (const kind of kinds)
    it.each([0, 16, 524_288])(
      `TestBR190_TestBR266_TestBR284_${kind}_sends_one_request_of_%i_bytes`,
      async (size) => {
        const s = await server(() => ok(file(kind, size)));
        const u = setup(s);
        const payload = Buffer.alloc(size, 0x61);
        if (size) payload[size - 1] = 0xff;
        const result = await u.run(OPS[kind], payload);
        expect(result.result).toBe("succeeded");
        expect(s.requests).toHaveLength(1);
        const seen = s.requests[0]!;
        expect(seen.method).toBe("POST");
        const [path, query = ""] = seen.path.split("?");
        expect(path).toBe(`/3/drive/${String(D)}/upload`);
        const params = [...new URLSearchParams(query)];
        expect(params).toEqual([
          ["directory_id", String(PARENT)],
          ["file_name", NAME],
          ["total_size", String(size)],
          ["conflict", CONFLICT[kind]],
        ]);
        expect(query).toBe(
          new URLSearchParams([
            ["directory_id", String(PARENT)],
            ["file_name", NAME],
            ["total_size", String(size)],
            ["conflict", CONFLICT[kind]],
          ]).toString(),
        );
        expect(seen.body.equals(payload)).toBe(true);
        expect(seen.headers["content-type"]).toBe("application/octet-stream");
        expect(seen.headers["content-length"]).toBe(String(size));
        expect(seen.headers.connection).toBe("close");
        expect(seen.headers.authorization).toBe(`Bearer ${CANARY}`);
        expect(seen.onConnection).toBe(1);
        expect(s.leaks()).toBe(0);
        expect(u.observed).toEqual([["POST", "/3/drive/{d}/upload"]]);
      },
    );
  it("TestBR284_conflict_is_only_error_or_version", () => {
    const n = mutationRoutes.upload(D, PARENT, "x", 1, "error");
    const r = mutationRoutes.upload(D, PARENT, "x", 1, "version");
    expect(n.target).toMatch(/&conflict=error$/u);
    expect(r.target).toMatch(/&conflict=version$/u);
    expect(n.template).toBe("/3/drive/{d}/upload");
    expect(n.contentType).toBe("application/octet-stream");
    expect(() =>
      mutationRoutes.upload(D, PARENT, "x", 1, "rename" as "error"),
    ).toThrow();
  });
  it("TestBR274_seven_mutator_kinds", () => {
    const mutators = createMutators(() => Promise.reject(new Error("x")));
    expect(Object.keys(mutators).toSorted()).toEqual(
      [
        "create",
        "rename",
        "move",
        "trash",
        "restore",
        "upload-new",
        "replace",
      ].toSorted(),
    );
  });
  it("TestBR284_a_non_buffer_payload_is_not_sent", async () => {
    let calls = 0;
    const mutators = createMutators(() => {
      calls++;
      return Promise.reject(new Error("x"));
    });
    const upload = mutators["upload-new"] as Mutator;
    await expect(
      upload(OPS["upload-new"], "text", new AbortController().signal),
    ).rejects.toBeInstanceOf(NotSent);
    expect(calls).toBe(0);
  });
});

describe("AC-08 response checks", () => {
  for (const kind of kinds) {
    it(`TestBR285_TestBR286_${kind}_valid_body_succeeds_with_value`, async () => {
      const s = await server(() => ok(file(kind, 3)));
      const result = await setup(s).run(OPS[kind], Buffer.from("abc"));
      expect(result).toMatchObject({
        result: "succeeded",
        value: {
          drive_id: D,
          id: kind === "replace" ? TARGET : 77,
          size: 3,
          action: kind === "replace" ? "replaced" : "created",
        },
      });
      expect(Object.keys((result as { value: object }).value)).toEqual([
        "drive_id",
        "id",
        "size",
        "action",
      ]);
    });
    const bad: [string, () => ReturnType<RawHandler>][] = [
      [
        "result error",
        () => json(200, { result: "error", data: file(kind, 3) }),
      ],
      ["invalid JSON", () => response(200, "{not json")],
      [
        "truncated body",
        () => ({
          write: Buffer.from(
            'HTTP/1.1 200 X\r\nConnection: close\r\nContent-Length: 999\r\n\r\n{"result":"success"',
          ),
          end: true,
        }),
      ],
      ["another name", () => ok(file(kind, 3, { name: "other" }))],
      ["another size", () => ok(file(kind, 4))],
      ["type dir", () => ok(file(kind, 3, { type: "dir" }))],
      ["another parent", () => ok(file(kind, 3, { parent_id: 39 }))],
      ["absent parent", () => ok(file(kind, 3, { parent_id: undefined }))],
      ["invalid id", () => ok(file(kind, 3, { id: 0 }))],
      ...(kind === "replace"
        ? ([["another id", () => ok(file(kind, 3, { id: 42 }))]] as [
            string,
            () => ReturnType<RawHandler>,
          ][])
        : []),
    ];
    it.each(bad)(
      `TestBR285_TestBR286_${kind}_%s_is_uncertain`,
      async (_label, handler) => {
        const s = await server(handler);
        const result = await setup(s).run(OPS[kind], Buffer.from("abc"));
        expect(result.result).toBe("uncertain");
        expect(result).not.toHaveProperty("value");
        expect(s.requests).toHaveLength(1);
      },
    );
    it.each([
      [409, { result: "error", error: { code: "file_already_exists_error" } }],
      [400, { result: "error", error: { code: "upload_failed_error" } }],
      [422, { result: "error", error: { code: "x" } }],
    ])(`TestBR285_${kind}_%i_is_failed`, async (status, body) => {
      const s = await server(() => json(status, body));
      const result = await setup(s).run(OPS[kind], Buffer.from("abc"));
      expect(result).toMatchObject({
        result: "failed",
        code: "UPSTREAM_REJECTED",
        status,
        attempts: 1,
      });
      expect(s.requests).toHaveLength(1);
    });
    it(`TestBR248_${kind}_429_then_200_resends_identical_bytes`, async () => {
      let n = 0;
      const s = await server(() =>
        n++ === 0
          ? json(429, { result: "error" }, { "Retry-After": "0" })
          : ok(file(kind, 3)),
      );
      const result = await setup(s).run(OPS[kind], Buffer.from("abc"));
      expect(result).toMatchObject({ result: "succeeded", attempts: 2 });
      expect(s.requests).toHaveLength(2);
      expect(s.requests[0]!.body.equals(s.requests[1]!.body)).toBe(true);
      expect(s.requests[0]!.path).toBe(s.requests[1]!.path);
    });
  }
});

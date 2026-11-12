// F-017 AC-10, AC-11, AC-12 (BR-190 v2, BR-266–BR-273): the production
// mutation port and mutators against a raw loopback TLS server.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStderrSink } from "../src/audit/sink.js";
import {
  NotSent,
  UNCERTAIN_MESSAGE,
  createMutationGate,
  type Mutator,
} from "../src/mutation-gate.js";
import { createKdriveAdapter } from "../src/kdrive/index.js";
import { mutationRoutes } from "../src/kdrive/routes.js";
import { createTransport, MUTATION_UNKNOWN } from "../src/kdrive/transport.js";
import type { Operation } from "../src/policy/operation.js";
import { CANARY } from "./helpers/kdrive.js";
import {
  json,
  rawServer,
  response,
  type RawHandler,
} from "./helpers/raw-tls.js";

const D = 101;
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
});
async function server(handler: RawHandler) {
  const s = await rawServer(handler);
  cleanup.push(() => s.close());
  return s;
}
type Server = Awaited<ReturnType<typeof rawServer>>;
function adapter(s: Pick<Server, "lookup" | "connect">, extra = {}) {
  const observed: [string, string][] = [];
  const a = createKdriveAdapter({
    token: CANARY,
    lookup: s.lookup,
    connect: s.connect,
    onRequest: (method, template) => observed.push([method, template]),
    ...extra,
  });
  return { ...a, observed };
}
function gateWith(mutators: Readonly<Record<string, Mutator>>) {
  const lines: string[] = [],
    diagnostics: string[] = [];
  const sink = createStderrSink({
    write(chunk, callback) {
      lines.push(chunk);
      callback();
      return true;
    },
  });
  const gate = createMutationGate({
    mode: "write",
    sink,
    mutators,
    random: (n) => new Uint8Array(n),
    clock: () => new Date("2026-11-10T10:00:00.000Z"),
    now: () => performance.now(),
    diagnostic: (m) => diagnostics.push(m),
  });
  return {
    lines,
    diagnostics,
    run: (tool: string, operation: Operation) =>
      gate.run({
        tool,
        operation,
        identity: { kind: "stdio" },
        // The policy decision is out of scope here: authorize directly.
        dispatch: (op) => gate.execute(op),
      }),
  };
}
const ref = (id: number) => ({ driveId: D, id });
const OPS: Record<string, [string, Operation]> = {
  create: [
    "kdrive_create_folder",
    { kind: "create", destination: ref(40), name: "new", type: "dir" },
  ],
  rename: [
    "kdrive_rename",
    { kind: "rename", target: ref(41), name: "renamed" },
  ],
  move: [
    "kdrive_move",
    { kind: "move", target: ref(41), destination: ref(42) },
  ],
  trash: ["kdrive_trash", { kind: "trash", target: ref(41) }],
  restore: ["kdrive_restore", { kind: "restore", target: ref(41) }],
};
const EXPECTED: Record<string, [string, string, string]> = {
  create: ["POST", "/3/drive/101/files/40/directory", '{"name":"new"}'],
  rename: ["POST", "/2/drive/101/files/41/rename", '{"name":"renamed"}'],
  move: ["POST", "/3/drive/101/files/41/move/42", ""],
  trash: ["DELETE", "/2/drive/101/files/41", ""],
  restore: ["POST", "/2/drive/101/trash/41/restore", ""],
};
const TEMPLATES: Record<string, string> = {
  create: "/3/drive/{d}/files/{f}/directory",
  rename: "/2/drive/{d}/files/{f}/rename",
  move: "/3/drive/{d}/files/{f}/move/{p}",
  trash: "/2/drive/{d}/files/{f}",
  restore: "/2/drive/{d}/trash/{f}/restore",
};
const ACTION = { cancel_id: "CANCELMARK-0001", valid_until: 1_800_000_000 };
const createdData = { id: 77, type: "dir", name: "new", parent_id: 40 };
const okBody = (kind: string) =>
  json(200, {
    result: "success",
    data: kind === "create" ? createdData : ACTION,
  });

describe("AC-10 one request per mutator on the route table", () => {
  it.each(Object.keys(OPS))(
    "TestBR190_TestBR266_TestBR271_%s_sends_exactly_one_request",
    async (kind) => {
      const s = await server(() => okBody(kind));
      const a = adapter(s);
      const g = gateWith(a.mutators);
      const [tool, operation] = OPS[kind] as [string, Operation];
      const result = await g.run(tool, operation);
      expect(result.result).toBe("succeeded");
      expect(s.requests).toHaveLength(1);
      const [method, path, body] = EXPECTED[kind] as [string, string, string];
      const seen = s.requests[0];
      expect(seen?.method).toBe(method);
      expect(seen?.path).toBe(path);
      expect(seen?.body.toString()).toBe(body);
      expect(seen?.headers.connection).toBe("close");
      expect(seen?.headers["content-length"]).toBe(
        String(Buffer.byteLength(body)),
      );
      expect(seen?.headers.authorization).toBe(`Bearer ${CANARY}`);
      expect(seen?.headers.host).toBe("api.infomaniak.com");
      expect(seen?.headers["content-type"]).toBe(
        body ? "application/json" : undefined,
      );
      expect(seen?.onConnection).toBe(1);
      expect(s.leaks()).toBe(0);
      expect(a.observed).toEqual([[method, TEMPLATES[kind]]]);
    },
  );
  it("TestBR266_two_mutations_use_two_connections", async () => {
    const s = await server(() => okBody("trash"));
    const g = gateWith(adapter(s).mutators);
    await g.run(...(OPS.trash as [string, Operation]));
    await g.run(...(OPS.trash as [string, Operation]));
    expect(s.requests.map((r) => [r.connection, r.onConnection])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
  it("TestBR266_a_3xx_response_is_not_followed", async () => {
    const s = await server(() =>
      response(302, "", {
        Location: "https://api.infomaniak.com/2/drive/101/files/9",
      }),
    );
    const g = gateWith(adapter(s).mutators);
    const result = await g.run(...(OPS.rename as [string, Operation]));
    expect(result).toMatchObject({ result: "uncertain", status: 302 });
    expect(s.requests).toHaveLength(1);
  });
  it("TestBR270_no_route_deletes_permanently_or_empties_the_trash", () => {
    const built = [
      mutationRoutes.create(1, 2),
      mutationRoutes.rename(1, 2),
      mutationRoutes.move(1, 2, 3),
      mutationRoutes.trash(1, 2),
      mutationRoutes.restore(1, 2),
    ].map((r) => [r.method, r.template]);
    expect(built).toEqual([
      ["POST", "/3/drive/{d}/files/{f}/directory"],
      ["POST", "/2/drive/{d}/files/{f}/rename"],
      ["POST", "/3/drive/{d}/files/{f}/move/{p}"],
      ["DELETE", "/2/drive/{d}/files/{f}"],
      ["POST", "/2/drive/{d}/trash/{f}/restore"],
    ]);
    expect(
      built.filter(([m, t]) => m === "DELETE" && t?.includes("/trash")),
    ).toEqual([]);
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const sources = [
      ...files("src"),
      "scripts/kdrive-write-acceptance.ts",
      "scripts/kdrive-entry.sh",
      "Makefile",
    ];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      // A DELETE built on a trash path, in either order on one statement.
      expect(
        /DELETE[^;\n]*\/trash|\/trash[^;\n]*DELETE/u.test(text),
        file,
      ).toBe(false);
      expect(/empty_?trash|trash\/empty/iu.test(text), file).toBe(false);
    }
  });
});

describe("AC-11 NotSent before the handshake, MUTATION_UNKNOWN after it", () => {
  const port = (s: Pick<Server, "lookup" | "connect">) =>
    createTransport({
      token: CANARY,
      lookup: s.lookup,
      connect: s.connect,
    });
  const trash = mutationRoutes.trash(D, 41);
  const signal = () => new AbortController().signal;
  async function both(
    s: Pick<Server, "lookup" | "connect">,
    expectation: "not-sent",
  ) {
    const error: unknown = await port(s)
      .mutate(trash, undefined, signal())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotSent);
    const result = await gateWith(adapter(s).mutators).run(
      ...(OPS.trash as [string, Operation]),
    );
    expect(result).toMatchObject({ result: "failed", code: "NOT_SENT" });
    return expectation;
  }
  it("TestBR267_a_DNS_failure_is_NotSent", async () => {
    await both(
      {
        lookup: () => Promise.reject(new Error("ENOTFOUND")),
        connect: () => {
          throw new Error("unused");
        },
      },
      "not-sent",
    );
  });
  it("TestBR267_a_refused_private_address_is_NotSent", async () => {
    const s = await server(() => okBody("trash"));
    await both(
      {
        lookup: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
        connect: s.connect,
      } as never,
      "not-sent",
    );
    expect(s.requests).toHaveLength(0);
  });
  it("TestBR267_a_refused_TCP_connect_is_NotSent", async () => {
    const s = await server(() => okBody("trash"));
    const closedPort = s.port;
    await s.close();
    await both(
      {
        lookup: s.lookup,
        connect: (o: { servername: string }) =>
          tlsConnect({
            host: "127.0.0.1",
            port: closedPort,
            servername: o.servername,
          }),
      },
      "not-sent",
    );
  });
  it("TestBR267_a_TLS_failure_is_NotSent", async () => {
    const s = await server(() => okBody("trash"));
    await both(
      {
        lookup: s.lookup,
        // No test CA: the loopback certificate is untrusted.
        connect: (o: { servername: string }) =>
          tlsConnect({
            host: "127.0.0.1",
            port: s.port,
            servername: o.servername,
          }),
      },
      "not-sent",
    );
    expect(s.requests).toHaveLength(0);
  });
  it("TestBR267_a_full_queue_is_NotSent_and_an_abort_while_queued_too", async () => {
    const s = await server(() => ({ hold: true }));
    const a = adapter(s);
    const controllers = Array.from({ length: 72 }, () => new AbortController());
    const pending = controllers.map((c) =>
      (a.mutators.trash as Mutator)(
        (OPS.trash as [string, Operation])[1],
        undefined,
        c.signal,
      ).catch((e: unknown) => e),
    );
    for (let i = 0; i < 500 && s.requests.length < 8; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(s.requests).toHaveLength(8);
    const result = await gateWith(a.mutators).run(
      ...(OPS.trash as [string, Operation]),
    );
    expect(result).toMatchObject({ result: "failed", code: "NOT_SENT" });
    // The last queued request is aborted while it waits: NotSent.
    controllers[71]?.abort();
    expect(await pending[71]).toBeInstanceOf(NotSent);
    // In-flight requests aborted after the handshake: unknown.
    controllers[0]?.abort();
    const first = (await pending[0]) as Error;
    expect(first).not.toBeInstanceOf(NotSent);
    expect(first.message).toBe(MUTATION_UNKNOWN);
    for (const c of controllers) c.abort();
    await Promise.all(pending);
  });
  async function unknown(handler: RawHandler) {
    const s = await server(handler);
    const error = (await port(s)
      .mutate(trash, undefined, signal())
      .catch((e: unknown) => e)) as Error;
    expect(error).not.toBeInstanceOf(NotSent);
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect(error.message).toBe(MUTATION_UNKNOWN);
    const g = gateWith(adapter(s).mutators);
    const result = await g.run(...(OPS.trash as [string, Operation]));
    expect(result).toMatchObject({
      result: "uncertain",
      code: "UPSTREAM_UNCERTAIN",
      message: UNCERTAIN_MESSAGE,
    });
    return s;
  }
  it("TestBR267_a_socket_closed_after_the_request_is_MUTATION_UNKNOWN", async () => {
    await unknown(() => ({ destroy: true }));
  });
  it("TestBR267_half_a_status_line_is_MUTATION_UNKNOWN", async () => {
    await unknown(() => ({ write: "HTTP/1.1 20", end: true }));
  });
  it("TestBR269_the_30000_ms_attempt_abort_destroys_the_socket", async () => {
    const s = await server(() => ({ hold: true }));
    const a = adapter(s);
    let thrown: unknown;
    const g = gateWith({
      trash: (op, payload, sig) =>
        (a.mutators.trash as Mutator)(op, payload, sig).catch((e: unknown) => {
          thrown = e;
          throw e;
        }),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const running = g.run(...(OPS.trash as [string, Operation]));
    for (let i = 0; i < 2000 && s.requests.length === 0; i++)
      await new Promise((r) => setImmediate(r));
    expect(s.requests).toHaveLength(1);
    expect(s.closed).toEqual([]);
    vi.advanceTimersByTime(30_000);
    const result = await running;
    expect(result).toMatchObject({
      result: "uncertain",
      code: "UPSTREAM_UNCERTAIN",
    });
    for (
      let i = 0;
      i < 2000 && (thrown === undefined || s.closed.length === 0);
      i++
    )
      await new Promise((r) => setImmediate(r));
    expect((thrown as Error).message).toBe(MUTATION_UNKNOWN);
    expect(s.closed).toEqual([0]);
  });
});

describe("AC-12 bodies, checks and F-016 classification", () => {
  const big = "x".repeat(4 * 1024 * 1024);
  const cases: [string, string, string | Buffer, boolean][] = [
    [
      "valid create",
      "create",
      JSON.stringify({ result: "success", data: createdData }),
      true,
    ],
    [
      "valid action",
      "rename",
      JSON.stringify({ result: "success", data: ACTION }),
      true,
    ],
    [
      "result error",
      "rename",
      JSON.stringify({ result: "error", data: ACTION }),
      false,
    ],
    ["invalid JSON", "trash", "{not json", false],
    [
      "over 4 MiB",
      "trash",
      JSON.stringify({ result: "success", data: { ...ACTION, pad: big } }),
      false,
    ],
    [
      "create name differs",
      "create",
      JSON.stringify({
        result: "success",
        data: { ...createdData, name: "new (1)" },
      }),
      false,
    ],
    [
      "create parent differs",
      "create",
      JSON.stringify({
        result: "success",
        data: { ...createdData, parent_id: 9 },
      }),
      false,
    ],
    [
      "create type file",
      "create",
      JSON.stringify({
        result: "success",
        data: { ...createdData, type: "file" },
      }),
      false,
    ],
    [
      "cancel_id missing",
      "move",
      JSON.stringify({ result: "success", data: { valid_until: 1 } }),
      false,
    ],
    [
      "cancel_id empty",
      "move",
      JSON.stringify({ result: "success", data: { ...ACTION, cancel_id: "" } }),
      false,
    ],
    [
      "cancel_id over 256 bytes",
      "restore",
      JSON.stringify({
        result: "success",
        data: { ...ACTION, cancel_id: "é".repeat(129) },
      }),
      false,
    ],
    [
      "valid_until not finite",
      "restore",
      `{"result":"success","data":{"cancel_id":"CANCELMARK-0001","valid_until":1e999}}`,
      false,
    ],
  ];
  it.each(cases)(
    "TestBR268_TestBR272_TestBR273_%s",
    async (_label, kind, body, accepted) => {
      const s = await server(() =>
        response(200, body, { "Content-Type": "application/json" }),
      );
      const g = gateWith(adapter(s).mutators);
      const result = await g.run(...(OPS[kind] as [string, Operation]));
      if (accepted) {
        expect(result).toMatchObject({ result: "succeeded", status: 200 });
        expect(result.value).toEqual({
          drive_id: D,
          id: kind === "create" ? 77 : 41,
        });
        const outcome = JSON.parse(g.lines[1] ?? "{}") as { created?: number };
        expect(outcome.created).toBe(kind === "create" ? 77 : undefined);
      } else {
        expect(result).toMatchObject({
          result: "uncertain",
          code: "UPSTREAM_UNCERTAIN",
          status: 200,
        });
        expect(result.value).toBeUndefined();
      }
      const everything =
        JSON.stringify(result) + g.lines.join("") + g.diagnostics.join("");
      expect(everything).not.toContain("CANCELMARK");
    },
  );
  it("TestBR268_a_truncated_2xx_body_is_uncertain", async () => {
    const s = await server(() => ({
      write:
        'HTTP/1.1 200 X\r\nContent-Length: 500\r\nConnection: close\r\n\r\n{"result":',
      end: true,
    }));
    const result = await gateWith(adapter(s).mutators).run(
      ...(OPS.trash as [string, Operation]),
    );
    expect(result).toMatchObject({ result: "uncertain", status: 200 });
  });
  it("TestBR268_a_409_with_a_20_KiB_body_is_rejected", async () => {
    const s = await server(() => response(409, "e".repeat(20 * 1024)));
    const result = await gateWith(adapter(s).mutators).run(
      ...(OPS.rename as [string, Operation]),
    );
    expect(result).toMatchObject({
      result: "failed",
      code: "UPSTREAM_REJECTED",
      status: 409,
      attempts: 1,
    });
  });
  it.each([
    ["2", 2000],
    ["2".padStart(33, "0"), 1000],
  ])(
    "TestBR268_a_429_with_Retry_After_%s_is_retried_after_%i_ms",
    async (retryAfter, wait) => {
      let n = 0;
      const at: number[] = [];
      const s = await server(() => {
        at.push(performance.now());
        return ++n === 1
          ? response(429, "", { "Retry-After": retryAfter })
          : okBody("trash");
      });
      const result = await gateWith(adapter(s).mutators).run(
        ...(OPS.trash as [string, Operation]),
      );
      expect(result).toMatchObject({ result: "succeeded", attempts: 2 });
      expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(wait - 50);
      expect((at[1] ?? 0) - (at[0] ?? 0)).toBeLessThan(wait + 900);
    },
    15_000,
  );
});

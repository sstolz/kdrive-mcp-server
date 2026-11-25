// F-053: the HTTP disconnect signal (BR-166 v2) cancels queued, not-yet-started
// invocations (BR-445) and never a started one. Synthetic keys, a fake
// upstream and synthetic navigation dependencies only.
import { getEventListeners } from "node:events";
import { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { createStderrSink } from "../../src/audit/sink.js";
import {
  createMutationGate,
  gatedDependencies,
  type Mutator,
} from "../../src/mutation-gate.js";
import { createNavigationController } from "../../src/navigation.js";
import { disconnectSignalOf } from "../../src/http/handler.js";
import { inFlightSize } from "../../src/http/server.js";
import type { HttpHandler } from "../../src/http/index.js";
import {
  HOST,
  INITIALIZE,
  RawClient,
  httpFixture,
  jsonRpc,
  listening,
  rawHeader,
  rawText,
} from "../helpers/http.js";
import { navigationFixture } from "../helpers/navigation.js";

// ---- recorded seams ----------------------------------------------------------

interface Handled {
  request: Request;
  target: string;
  disconnect: unknown;
}

/** Every `handle()` call the HTTP server makes, with its explicit arguments. */
const handled = vi.hoisted(() => [] as Handled[]);
vi.mock("../../src/http/handler.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/http/handler.js")>();
  return {
    ...actual,
    createHttpHandler: (
      options: Parameters<typeof actual.createHttpHandler>[0],
    ) => {
      const handler: HttpHandler = actual.createHttpHandler(options);
      const handle = Reflect.get(handler, "handle") as (
        ...args: unknown[]
      ) => Promise<Response>;
      handler.handle = async (
        ...args: Parameters<typeof handler.handle>
      ): Promise<Response> => {
        const all = args as unknown[];
        handled.push({
          request: args[0],
          target: args[1],
          disconnect: all[3],
        });
        return await handle.apply(handler, all);
      };
      return handler;
    },
  };
});

const transportProto = WebStandardStreamableHTTPServerTransport.prototype;
const originalHandleRequest = Reflect.get(transportProto, "handleRequest");
const serverProto = McpServer.prototype;
const originalRegisterTool = Reflect.get(serverProto, "registerTool") as (
  ...args: unknown[]
) => unknown;

/** One request the SDK transport received, with a clone of its response. */
interface Seen {
  readonly request: Request;
  readonly options: unknown;
  readonly id: unknown;
  readonly copy: Promise<Response | undefined>;
  done: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function idOf(options: unknown): unknown {
  const parsed = isObject(options) ? options.parsedBody : undefined;
  return isObject(parsed) ? parsed.id : undefined;
}

function recordTransport(): Seen[] {
  const seen: Seen[] = [];
  vi.spyOn(transportProto, "handleRequest").mockImplementation(function (
    this: WebStandardStreamableHTTPServerTransport,
    ...args: Parameters<typeof transportProto.handleRequest>
  ) {
    const response = originalHandleRequest.apply(this, args);
    const entry: Seen = {
      request: args[0],
      options: args[1],
      id: idOf(args[1]),
      done: false,
      // Cloned before the router consumes the body.
      copy: response.then(
        (value) => value.clone(),
        () => undefined,
      ),
    };
    void entry.copy.finally(() => {
      entry.done = true;
    });
    seen.push(entry);
    return response;
  });
  return seen;
}

/** The SDK context of a tool handler call. */
interface Ctx {
  readonly mcpReq: { readonly id: unknown; readonly signal: AbortSignal };
  readonly http?: { readonly req?: Request };
}

/** Wraps every registered tool callback so its SDK context is recorded. */
function captureContexts(): Ctx[] {
  const contexts: Ctx[] = [];
  vi.spyOn(serverProto, "registerTool").mockImplementation(function (
    this: McpServer,
    ...args: unknown[]
  ) {
    const callback = args[2] as (input: unknown, ctx: Ctx) => unknown;
    return originalRegisterTool.call(
      this,
      args[0],
      args[1],
      (input: unknown, ctx: Ctx) => {
        contexts.push(ctx);
        return callback(input, ctx);
      },
    );
  } as never);
  return contexts;
}

// ---- helpers -----------------------------------------------------------------

const TIMEOUT = Symbol("timeout");

async function within<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => {
          resolve(TIMEOUT);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
  vi.useRealTimers();
  vi.restoreAllMocks();
  handled.length = 0;
});

const OK = { outcome: "response", status: 200, accepted: true } as const;
const DENIED = {
  isError: true,
  content: [{ type: "text", text: "ACCESS_DENIED" }],
};

type Nav = Awaited<ReturnType<typeof navigationFixture>>;

/** Holds the first `inspect` of `fileId` until released; others pass. */
function holdInspect(nav: Nav, fileId: number) {
  const previous = nav.inspect.getMockImplementation();
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  nav.inspect.mockImplementation(async (ref) => {
    if (ref.id === fileId && entered === 0) {
      entered++;
      await opened;
    }
    return await previous?.(ref);
  });
  return {
    release: () => {
      release();
    },
    entered: () => entered,
  };
}

/** kDrive requests: every navigation dependency call plus every mutator call. */
function kdriveCounter(nav: Nav, mutator: { mock: { calls: unknown[] } }) {
  return () =>
    nav.inspect.mock.calls.length +
    nav.collection.mock.calls.length +
    nav.execute.mock.calls.length +
    nav.children.mock.calls.length +
    mutator.mock.calls.length;
}

const inspectsOf = (nav: Nav, fileId: number) =>
  nav.inspect.mock.calls.filter(([ref]) => ref.id === fileId).length;

async function gateFor(mutator: Mutator) {
  const nav = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
  const lines: string[] = [];
  const spy = vi.fn<Mutator>(mutator);
  const gate = createMutationGate({
    mode: "write",
    sink: createStderrSink({
      write(chunk, callback) {
        lines.push(chunk);
        callback();
        return true;
      },
    }),
    mutators: { rename: spy, "create-folder": spy },
    random: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    clock: () => new Date("2026-11-13T10:00:00.000Z"),
    now: () => performance.now(),
    diagnostic: () => undefined,
  });
  return { nav, lines, mutator: spy, gate };
}

/** Tracks the socket `close` listeners added after Node's own (`serve`'s). */
function trackClose(socket: Socket) {
  const baseline = new Set<unknown>(socket.listeners("close"));
  const isServe = (listener: unknown) =>
    !baseline.has(listener) &&
    (listener as { name?: string }).name !== "onServerResponseClose";
  const current = () => socket.listeners("close").filter(isServe).length;
  let max = 0;
  socket.on("newListener", (event: string | symbol, listener: unknown) => {
    if (event === "close")
      max = Math.max(max, current() + (isServe(listener) ? 1 : 0));
  });
  return { max: () => max, current };
}

/** A listening server in write mode with a memory audit sink. */
async function setup(mutator: Mutator = () => Promise.resolve(OK)) {
  const g = await gateFor(mutator);
  const seen = recordTransport();
  const contexts = captureContexts();
  const f = await httpFixture({
    env: { KDRIVE_MCP_MODE: "write" },
    dependencies: gatedDependencies(g.nav.dependencies, g.gate),
    gate: g.gate,
  });
  const server = await listening(f);
  const token = await f.mint();
  const clients: RawClient[] = [];
  const sockets: Socket[] = [];
  const trackers: Array<ReturnType<typeof trackClose>> = [];
  const holds: Array<() => void> = [];
  server.server.on("connection", (socket: Socket) => {
    sockets.push(socket);
    trackers.push(trackClose(socket));
  });
  cleanup.push(async () => {
    for (const release of holds) release();
    for (const client of clients) client.destroy();
    await server.close();
    await f.handler.close();
  });
  async function connect(): Promise<RawClient> {
    const count = sockets.length;
    const client = await RawClient.connect(server.port);
    clients.push(client);
    await vi.waitFor(() => {
      expect(sockets.length).toBeGreaterThan(count);
    });
    return client;
  }
  function hold(fileId: number) {
    const held = holdInspect(g.nav, fileId);
    holds.push(held.release);
    return held;
  }
  async function entry(id: number): Promise<Seen> {
    await vi.waitFor(() => {
      expect(seen.find((e) => e.id === id)).toBeDefined();
    });
    return seen.find((e) => e.id === id) as Seen;
  }
  return {
    ...g,
    f,
    server,
    token,
    seen,
    contexts,
    sockets,
    trackers,
    connect,
    hold,
    entry,
    kdrive: kdriveCounter(g.nav, g.mutator),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

function post(
  token: string,
  body: string,
  session?: string,
  extra: Array<[string, string]> = [],
): string {
  const headers: Array<[string, string]> = [
    ["Host", HOST],
    ["Authorization", `Bearer ${token}`],
    ["Content-Type", "application/json"],
    ["Accept", "application/json, text/event-stream"],
    ["Content-Length", String(Buffer.byteLength(body))],
  ];
  if (session !== undefined) headers.push(["Mcp-Session-Id", session]);
  return rawText({
    method: "POST",
    target: "/mcp",
    headers: [...headers, ...extra],
    body,
  });
}

const info = (id: number, fileId = 3) =>
  jsonRpc("tools/call", id, {
    name: "kdrive_info",
    arguments: { file_id: fileId },
  });
const rename = (id: number) =>
  jsonRpc("tools/call", id, {
    name: "kdrive_rename",
    arguments: { file_id: 3, name: "b" },
  });

/** Initializes a session over a fresh socket. */
async function openSession(h: Setup) {
  const client = await h.connect();
  client.write(post(h.token, INITIALIZE));
  const init = await client.next(1000);
  const session = init ? (rawHeader(init, "mcp-session-id") ?? "") : "";
  client.write(
    post(h.token, jsonRpc("notifications/initialized", undefined), session),
  );
  expect((await client.next(1000))?.status).toBe(202);
  return { client, session };
}

function disconnectOf(request: Request | undefined): AbortSignal | undefined {
  return request === undefined ? undefined : disconnectSignalOf(request);
}

const listeners = (signal: AbortSignal | undefined) =>
  signal === undefined ? 0 : getEventListeners(signal, "abort").length;

/** Waits until the call behind `entry` listens on its disconnect signal. */
async function waiting(entry: Seen): Promise<void> {
  await vi.waitFor(() => {
    expect(listeners(disconnectOf(entry.request))).toBeGreaterThanOrEqual(1);
  });
}

interface RpcBody {
  result?: { isError?: boolean; content?: Array<{ text?: string }> };
  error?: { code?: number; message?: string };
}

/** `ok:<text>`, the tool error text, `error:<code>:<message>` or `none`. */
async function outcome(entry: Seen, ms = 1500): Promise<string> {
  const response = await within(entry.copy, ms);
  if (response === TIMEOUT || response === undefined) return "none";
  const body = JSON.parse(await response.text()) as RpcBody;
  if (body.error)
    return `error:${String(body.error.code)}:${body.error.message ?? ""}`;
  const text = body.result?.content?.[0]?.text ?? "";
  return body.result?.isError === true ? text : `ok:${text}`;
}

async function settledServer(h: Setup): Promise<void> {
  await vi.waitFor(() => {
    expect(inFlightSize(h.server.server)).toBe(0);
  });
}

// ---- AC-08 -------------------------------------------------------------------

async function heldAndWaiting(h: Setup) {
  const { client: a, session } = await openSession(h);
  const held = h.hold(3);
  a.write(post(h.token, info(3), session));
  await vi.waitFor(() => {
    expect(held.entered()).toBe(1);
  });
  return { a, session, held };
}

describe("BR-166 v2 BR-445 AC-08 a disconnect cancels a waiting call", () => {
  it("a waiting tool call leaves with ACCESS_DENIED; a held handler sees only the disconnect", async () => {
    const h = await setup();
    const { a, session, held } = await heldAndWaiting(h);
    const b = await h.connect();
    b.write(post(h.token, info(4), session, [["Cookie", "sid=synthetic"]]));
    const queued = await h.entry(4);
    await waiting(queued);
    const before = h.kdrive();
    b.destroy();
    expect(await outcome(queued)).toBe("ACCESS_DENIED");
    expect(h.kdrive()).toBe(before);
    expect(h.lines).toEqual([]);
    // BR-166 v2: the SDK request has no credential and no aborted signal.
    expect(queued.request.headers.get("authorization")).toBeNull();
    expect(queued.request.headers.get("cookie")).toBeNull();
    expect(isObject(queued.options) && "authInfo" in queued.options).toBe(
      false,
    );
    expect(queued.request.signal.aborted).toBe(false);
    expect(disconnectOf(queued.request)?.aborted).toBe(true);

    // The held (started) handler: ctx.http.req is the request the SDK got.
    const started = await h.entry(3);
    const ctx = h.contexts.find((c) => c.mcpReq.id === 3);
    expect(ctx?.http?.req).toBe(started.request);
    a.destroy();
    await vi.waitFor(() => {
      expect(disconnectOf(ctx?.http?.req)?.aborted).toBe(true);
    });
    expect(ctx?.mcpReq.signal.aborted).toBe(false);
    // A fully written response never sees its disconnect signal abort.
    const initialize = h.seen.find((e) => e.id === 1);
    expect(disconnectOf(initialize?.request)).toBeInstanceOf(AbortSignal);
    expect(disconnectOf(initialize?.request)?.aborted).toBe(false);
    held.release();
    expect(await outcome(started)).toMatch(/^ok:/u);
  });

  it("notifications/cancelled aborts ctx.mcpReq.signal and not the disconnect signal", async () => {
    const h = await setup();
    const { session, held } = await heldAndWaiting(h);
    const ctx = h.contexts.find((c) => c.mcpReq.id === 3);
    const c = await h.connect();
    c.write(
      post(
        h.token,
        jsonRpc("notifications/cancelled", undefined, { requestId: 3 }),
        session,
      ),
    );
    expect((await c.next(1000))?.status).toBe(202);
    await vi.waitFor(() => {
      expect(ctx?.mcpReq.signal.aborted).toBe(true);
    });
    expect(disconnectOf(ctx?.http?.req)).toBeInstanceOf(AbortSignal);
    expect(disconnectOf(ctx?.http?.req)?.aborted).toBe(false);
    held.release();
  });

  it("a waiting custom resources/read is refused -32000 ACCESS_DENIED; a slot taker holds no disconnect listener", async () => {
    const h = await setup();
    const { session, held } = await heldAndWaiting(h);
    const r = await h.connect();
    r.write(
      post(
        h.token,
        jsonRpc("resources/read", 5, { uri: "kdrive://7/file/3" }),
        session,
      ),
    );
    const read = await h.entry(5);
    await waiting(read);
    const w = await h.connect();
    w.write(post(h.token, info(6, 4), session));
    const next = await h.entry(6);
    await waiting(next);
    const before = h.kdrive();
    r.destroy();
    const refused = await outcome(read);
    expect(refused).toMatch(/^error:-32000:/u);
    expect(refused).toContain("ACCESS_DENIED");
    expect(h.kdrive()).toBe(before);
    // The next waiter takes the slot: its disconnect listener is removed then.
    const taker = h.hold(4);
    held.release();
    await vi.waitFor(() => {
      expect(taker.entered()).toBe(1);
    });
    expect(listeners(disconnectOf(next.request))).toBe(0);
    taker.release();
    expect(await outcome(next)).toMatch(/^ok:/u);
  });
});

// ---- AC-09 -------------------------------------------------------------------

describe("BR-445 AC-09 a disconnect cancels a queued write before intent", () => {
  it("a waiting mutate never runs and the next waiter moves up", async () => {
    const h = await setup();
    const { session, held } = await heldAndWaiting(h);
    const m = await h.connect();
    m.write(post(h.token, rename(7), session));
    const write = await h.entry(7);
    await waiting(write);
    const n = await h.connect();
    n.write(post(h.token, info(8, 4), session));
    const after = await h.entry(8);
    await waiting(after);
    const before = h.kdrive();
    m.destroy();
    expect(await outcome(write)).toBe("ACCESS_DENIED");
    expect(h.kdrive()).toBe(before);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
    // The next waiter has not run yet; it takes the slot at the release.
    expect(inspectsOf(h.nav, 4)).toBe(0);
    held.release();
    expect(await outcome(await h.entry(3))).toMatch(/^ok:/u);
    expect(await outcome(after)).toMatch(/^ok:/u);
    expect(inspectsOf(h.nav, 4)).toBeGreaterThan(0);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });
});

// ---- AC-10 -------------------------------------------------------------------

/** Destroys the client, then shows nothing is written once all settle. */
async function disconnectStarted(
  h: Setup,
  client: RawClient,
  release: () => void,
  entry: Seen,
): Promise<string> {
  const writes = vi.spyOn(ServerResponse.prototype, "writeHead");
  client.destroy();
  await client.closePromise;
  await pause(20);
  release();
  const result = await outcome(entry);
  await settledServer(h);
  expect(writes).not.toHaveBeenCalled();
  return result;
}

describe("BR-445 AC-10 a started invocation runs to completion after a disconnect", () => {
  it("a started read keeps its kDrive requests", async () => {
    const h = await setup();
    const { a, held } = await heldAndWaiting(h);
    const before = h.kdrive();
    const started = await h.entry(3);
    const result = await disconnectStarted(h, a, held.release, started);
    expect(result).toMatch(/^ok:/u);
    expect(h.kdrive()).toBeGreaterThanOrEqual(before);
  });

  it("a gate run that appended its intent commits and audits its outcome", async () => {
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await setup(async () => {
      await opened;
      return OK;
    });
    cleanup.push(release);
    const { client, session } = await openSession(h);
    client.write(post(h.token, rename(3), session));
    await vi.waitFor(() => {
      expect(h.mutator).toHaveBeenCalledTimes(1);
    });
    expect(h.lines).toHaveLength(1);
    const run = await h.entry(3);
    const result = await disconnectStarted(h, client, release, run);
    expect(result).toMatch(/^ok:/u);
    expect(result).toContain("succeeded");
    expect(h.lines).toHaveLength(2);
  });

  it("a gate run held before its intent still appends intent, commits and audits", async () => {
    const h = await setup();
    const { client, session } = await openSession(h);
    const held = h.hold(3);
    client.write(post(h.token, rename(3), session));
    await vi.waitFor(() => {
      expect(held.entered()).toBe(1);
    });
    // Slot taken, no intent appended yet.
    expect(h.lines).toEqual([]);
    expect(h.mutator).not.toHaveBeenCalled();
    const run = await h.entry(3);
    const result = await disconnectStarted(h, client, held.release, run);
    // BR-250: `interrupted` never reported CANCELLED for the disconnect.
    expect(result).toMatch(/^ok:/u);
    expect(result).toContain("succeeded");
    expect(h.mutator).toHaveBeenCalledTimes(1);
    expect(h.lines).toHaveLength(2);
  });
});

// ---- AC-11 (controller, same synchronous step) ---------------------------------

async function controllerSetup() {
  const g = await gateFor(() => Promise.resolve(OK));
  const controller = createNavigationController(
    g.nav.config,
    gatedDependencies(g.nav.dependencies, g.gate),
    undefined,
    { gate: g.gate },
  );
  return { ...g, controller };
}

/** Runs `action` right after the signal's next `method` call returns. */
function after(
  signal: AbortSignal,
  method: "addEventListener" | "removeEventListener",
  action: () => void,
): void {
  const original = signal[method].bind(signal) as (...args: unknown[]) => void;
  Object.defineProperty(signal, method, {
    configurable: true,
    value: (...args: unknown[]) => {
      original(...args);
      action();
    },
  });
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("BR-445 AC-11 the slot order decides a disconnect at release", () => {
  it("disconnect first: the waiter is refused with zero records", async () => {
    const h = await controllerSetup();
    const held = holdInspect(h.nav, 3);
    const running = new AbortController();
    const waiter = new AbortController();
    const disconnect = new AbortController();
    const first = h.controller.invoke(
      "kdrive_info",
      { file_id: 3 },
      running.signal,
    );
    const second = h.controller.invoke(
      "kdrive_info",
      { file_id: 4 },
      waiter.signal,
      disconnect.signal,
    );
    await flush();
    expect(held.entered()).toBe(1);
    // The running call removes its own listener in the step that releases
    // the slot: the disconnect lands in that step, before the hand-off.
    after(running.signal, "removeEventListener", () => {
      disconnect.abort();
    });
    held.release();
    expect((await first).isError).toBeUndefined();
    expect(await second).toEqual(DENIED);
    expect(inspectsOf(h.nav, 4)).toBe(0);
    expect(h.lines).toEqual([]);
  });

  it("release first: the waiter has started and completes", async () => {
    const h = await controllerSetup();
    const held = holdInspect(h.nav, 3);
    const running = new AbortController();
    const waiter = new AbortController();
    const disconnect = new AbortController();
    const first = h.controller.invoke(
      "kdrive_info",
      { file_id: 3 },
      running.signal,
    );
    const second = h.controller.invoke(
      "kdrive_info",
      { file_id: 4 },
      waiter.signal,
      disconnect.signal,
    );
    await flush();
    let released = false;
    after(running.signal, "removeEventListener", () => {
      released = true;
    });
    // The waiter's start step attaches its cancel listener: the disconnect
    // lands right after it took the slot, in the same synchronous step.
    after(waiter.signal, "addEventListener", () => {
      if (released) disconnect.abort();
    });
    held.release();
    expect((await first).isError).toBeUndefined();
    const result = await second;
    expect(disconnect.signal.aborted).toBe(true);
    expect(result.isError).toBeUndefined();
    expect(inspectsOf(h.nav, 4)).toBeGreaterThan(0);
  });

  it("an already aborted disconnect on a free slot never starts", async () => {
    const h = await controllerSetup();
    const disconnect = new AbortController();
    disconnect.abort();
    const kdrive = kdriveCounter(h.nav, h.mutator);
    expect(
      await h.controller.invoke(
        "kdrive_info",
        { file_id: 3 },
        undefined,
        disconnect.signal,
      ),
    ).toEqual(DENIED);
    expect(
      await h.controller.invokeMutation(
        "kdrive_rename",
        { file_id: 3, name: "b" },
        { kind: "stdio" },
        undefined,
        disconnect.signal,
      ),
    ).toEqual(DENIED);
    const read = (await h.controller
      .readResource("kdrive://7/file/3", undefined, disconnect.signal)
      .catch((error: unknown) => error)) as { code?: number; message?: string };
    expect(read.code).toBe(-32000);
    expect(read.message).toContain("ACCESS_DENIED");
    expect(kdrive()).toBe(0);
    expect(h.mutator).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });
});

// ---- AC-14 -------------------------------------------------------------------

function watchWarnings(): unknown[] {
  const warnings: unknown[] = [];
  const onWarning = (warning: unknown) => {
    warnings.push(warning);
  };
  process.on("warning", onWarning);
  cleanup.push(() => {
    process.off("warning", onWarning);
  });
  return warnings;
}

const count = (values: string[], expected: string) =>
  values.filter((value) => value === expected).length;

describe("BR-166 v2 BR-445 AC-14 the disconnect signal is passed explicitly and covers pipelined requests", () => {
  it("handle() receives the signal; the map returns it; no own Request signal aborts", async () => {
    const h = await setup();
    const { session, held } = await heldAndWaiting(h);
    const b = await h.connect();
    const from = handled.length;
    b.write(post(h.token, info(4), session));
    const queued = await h.entry(4);
    await vi.waitFor(() => {
      expect(handled.length).toBeGreaterThan(from);
    });
    const call = handled[from];
    expect(call?.disconnect).toBeInstanceOf(AbortSignal);
    expect(disconnectSignalOf(queued.request)).toBe(call?.disconnect);
    await waiting(queued);
    b.destroy();
    await vi.waitFor(() => {
      expect((call?.disconnect as AbortSignal | undefined)?.aborted).toBe(true);
    });
    expect(call?.request.signal.aborted).toBe(false);
    expect(queued.request.signal.aborted).toBe(false);
    expect(await outcome(queued)).toBe("ACCESS_DENIED");
    held.release();
  });

  it("12 pipelined requests: 4 waiting are refused, 7 are busy, all settle", async () => {
    const warnings = watchWarnings();
    const h = await setup();
    const { session } = await openSession(h);
    const held = h.hold(3);
    const p = await h.connect();
    const tracker = h.trackers.at(-1);
    // BR-381 v1: one started call, 4 waiting, the other 7 refused at arrival.
    const ids = Array.from({ length: 12 }, (_, i) => 10 + i);
    p.write(ids.map((id) => post(h.token, info(id), session)).join(""));
    await vi.waitFor(() => {
      expect(held.entered()).toBe(1);
    });
    const entries = await Promise.all(ids.map((id) => h.entry(id)));
    await vi.waitFor(() => {
      expect(
        entries.filter((e) => listeners(disconnectOf(e.request)) >= 1),
      ).toHaveLength(4);
      expect(entries.filter((e) => e.done)).toHaveLength(7);
    });
    const before = h.kdrive();
    p.destroy();
    await vi.waitFor(() => {
      expect(entries.filter((e) => e.done)).toHaveLength(11);
    });
    expect(h.kdrive()).toBe(before);
    expect(h.lines).toEqual([]);
    held.release();
    const results = await Promise.all(entries.map((e) => outcome(e)));
    expect(count(results, "ACCESS_DENIED")).toBe(4);
    expect(count(results, "SERVER_BUSY")).toBe(7);
    expect(results.filter((r) => r.startsWith("ok:"))).toHaveLength(1);
    await settledServer(h);
    expect(tracker?.max()).toBeLessThanOrEqual(1);
    await pause(20);
    expect(warnings).toEqual([]);
  });

  it("10 sequential requests on a kept-alive socket leave no serve listener", async () => {
    const h = await setup();
    const { client, session } = await openSession(h);
    const tracker = h.trackers.at(-1);
    for (let i = 0; i < 8; i++) {
      client.write(post(h.token, jsonRpc("tools/list", 20 + i), session));
      expect((await client.next(1000))?.status).toBe(200);
    }
    await settledServer(h);
    expect(tracker?.current()).toBe(0);
    expect(h.sockets).toHaveLength(1);
  });
});

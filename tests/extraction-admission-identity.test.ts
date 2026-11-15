import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuditIdentity } from "../src/audit/sink.js";
import * as extraction from "../src/extraction.js";
import {
  createNavigationServer,
  navigationBinding,
} from "../src/navigation.js";
import {
  contentError,
  contentFixture,
  contentResult,
} from "./helpers/content.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";

const success = contentResult({
  drive_id: 7,
  file_id: 3,
  etag: '"version-1"',
  size_bytes: 4,
  format: "text",
  offset: 0,
  characters_read: 4,
  total_characters: 4,
  text: "safe",
  has_more: false,
  encoding: "utf-8",
});
const readArgs = { file_id: 3, format: "text" };
const oauth = (sub: string, iss = "https://issuer.test"): AuditIdentity => ({
  kind: "oauth",
  iss,
  sub,
});
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
const cleaners: (() => Promise<void>)[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(extraction, "runExtraction").mockResolvedValue({
    kind: "text",
    text: "safe",
    encoding: "utf-8",
  });
});
afterEach(async () => {
  await Promise.all(cleaners.splice(0).map((clean) => clean()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function session(
  identity?: AuditIdentity,
  starts: string[] = [],
  label = "",
) {
  const f = await contentFixture({}, Buffer.from("safe"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const open = f.content.open.getMockImplementation()!;
  f.content.open.mockImplementation(async (request) => {
    starts.push(label);
    const response = (await open(request)) as ReturnType<
      typeof import("./helpers/content.js").rangeResponse
    >;
    const read = response.body.read.getMockImplementation()!;
    response.body.read.mockImplementation(async (max) => {
      await held;
      return await read(max);
    });
    return response;
  });
  const server = createNavigationServer(
    f.config,
    f.dependencies,
    undefined,
    identity ? { identity } : {},
  );
  const controller = navigationBinding(server)!.controller;
  const tasks: ReturnType<typeof controller.invoke>[] = [];
  cleaners.push(async () => {
    release();
    controller.close();
    await Promise.all(tasks);
    await server.close();
  });
  return {
    f,
    controller,
    release,
    invoke(signal?: AbortSignal) {
      const task = controller.invoke("kdrive_read", readArgs, signal);
      tasks.push(task);
      return task;
    },
  };
}

it.each([
  "same-identity",
  "identity-key",
  "stdio-and-fallback",
  "insecure-http",
] as const)(
  "TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter %s",
  async (row) => {
    const identities: [AuditIdentity | undefined, AuditIdentity | undefined] =
      row === "stdio-and-fallback"
        ? [{ kind: "stdio" }, undefined]
        : row === "insecure-http"
          ? [{ kind: "insecure" }, { kind: "insecure" }]
          : [oauth("A"), oauth("A")];
    const a = await session(identities[0]),
      b = await session(identities[1]);
    const first = a.invoke();
    await flush();
    const second = b.invoke();
    await flush();
    expect.soft(a.f.content.open).toHaveBeenCalledTimes(1);
    expect.soft(b.f.content.describe).not.toHaveBeenCalled();
    if (row === "identity-key") {
      for (const identity of [
        oauth("B"),
        oauth("A", "https://other-issuer.test"),
      ]) {
        const other = await session(identity);
        const call = other.invoke();
        await flush();
        expect(other.f.content.open).toHaveBeenCalledTimes(1);
        other.release();
        expect(await call).toEqual(success);
      }
    }
    a.release();
    expect(await first).toEqual(success);
    await flush();
    expect(b.f.content.open).toHaveBeenCalledTimes(1);
    b.release();
    expect(await second).toEqual(success);
  },
);
it.each(["oldest-eligible", "no-barging"] as const)(
  "TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter %s",
  async (row) => {
    const starts: string[] = [];
    const names = ["A1", "B1", "A2", "C1", "B2", "D1", "E1"];
    const sessions = await Promise.all(
      names.map((name) => session(oauth(name[0]!), starts, name)),
    );
    const tasks = [];
    for (const s of sessions.slice(0, 6)) {
      tasks.push(s.invoke());
      await flush();
    }
    expect.soft(starts).toEqual(["A1", "B1"]);
    sessions[1]!.release();
    await tasks[1];
    if (row === "no-barging") tasks.push(sessions[6]!.invoke());
    await flush();
    expect.soft(starts).toEqual(["A1", "B1", "C1"]);
    sessions[3]!.release();
    await tasks[3];
    await flush();
    expect.soft(starts).toEqual(["A1", "B1", "C1", "B2"]);
    sessions[0]!.release();
    await tasks[0];
    await flush();
    expect.soft(starts).toEqual(["A1", "B1", "C1", "B2", "A2"]);
    sessions[4]!.release();
    await tasks[4];
    await flush();
    expect.soft(starts.at(-1)).toBe("D1");
    sessions[2]!.release();
    await tasks[2];
    await flush();
    if (row === "no-barging") expect.soft(starts.at(-1)).toBe("E1");
    for (const s of sessions) s.release();
    for (const task of tasks) expect(await task).toEqual(success);
  },
);
it("TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter one-waiter-per-identity", async () => {
  const a = await session(oauth("A")),
    b = await session(oauth("B")),
    c = await session(oauth("C")),
    c2 = await session(oauth("C")),
    c3 = await session(oauth("C"));
  void a.invoke();
  void b.invoke();
  await flush();
  const abort = new AbortController();
  const queued = c.invoke(abort.signal);
  await flush();
  let refused: unknown;
  const duplicate = c2.invoke().then((result) => {
    refused = result;
  });
  await flush();
  expect.soft(refused).toEqual(contentError("SERVER_BUSY"));
  expect.soft(c2.f.content.describe).not.toHaveBeenCalled();
  abort.abort();
  expect(await queued).toEqual(contentError("ACCESS_DENIED"));
  const replacement = c3.invoke();
  await flush();
  expect.soft(c3.f.content.describe).not.toHaveBeenCalled();
  a.release();
  await flush();
  c3.release();
  expect(await replacement).toEqual(success);
  c2.release();
  await duplicate;
});
it("TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter stdio composition", async () => {
  vi.useRealTimers();
  const a = await session(oauth("unused"));
  const f = await contentFixture({}, Buffer.from("safe"));
  const wire = await createWire(a.f.config, a.f.dependencies);
  const second = await createWire(f.config, f.dependencies);
  try {
    for (const w of [wire, second]) {
      w.send(initialize);
      await w.read(1);
      w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
    wire.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kdrive_read", arguments: readArgs },
    });
    await flush();
    second.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kdrive_read", arguments: readArgs },
    });
    await flush();
    expect.soft(f.content.describe).not.toHaveBeenCalled();
    expect.soft(second.responses().find((r) => r.id === 2)).toBeUndefined();
    a.release();
    expect((await wire.read(2)).result).toEqual(success);
    expect((await second.read(2)).result).toEqual(success);
    second.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "kdrive_read",
        arguments: { ...readArgs, identity: "other" },
      },
    });
    expect((await second.read(3)).result).toEqual(
      contentError("INVALID_ARGUMENTS"),
    );
  } finally {
    a.release();
    await wire.session.close();
    await second.session.close();
  }
});

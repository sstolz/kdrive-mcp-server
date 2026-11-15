import { afterEach, expect, it, vi } from "vitest";
import { setImmediate as turn } from "node:timers/promises";
import * as extraction from "../../src/extraction.js";
import * as navigation from "../../src/navigation.js";
import {
  contentError,
  contentFixture,
  contentResult,
  rangeResponse,
} from "../helpers/content.js";
import { httpFixture, jsonRpc } from "../helpers/http.js";
import {
  DETACH_LINE,
  RELEASE_LINE,
  installControlledWorkers,
  microtasks,
  wallBound,
} from "../helpers/f040-lifecycle.js";

const args = { file_id: 3, format: "text" };
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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["eight-http-sessions", "insecure-http"] as const)(
  "TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter HTTP %s",
  async (row) => {
    vi.spyOn(extraction, "runExtraction").mockResolvedValue({
      kind: "text",
      text: "safe",
      encoding: "utf-8",
    });
    const composed = vi.spyOn(navigation, "createNavigationServer");
    const f = await contentFixture({}, Buffer.from("safe"));
    const releases: (() => void)[] = [];
    f.content.open.mockImplementation((request) => {
      const response = rangeResponse(request, f.bytes);
      const gate = new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      const read = response.body.read.getMockImplementation()!;
      response.body.read.mockImplementation(async (max) => {
        await gate;
        return await read(max);
      });
      return Promise.resolve(response);
    });
    const insecure = row === "insecure-http";
    const h = await httpFixture({
      dependencies: f.dependencies,
      insecure,
      ...(insecure ? { upstream: null } : {}),
      env: insecure
        ? { MCP_PUBLIC_URL: "http://127.0.0.1:3000/mcp" }
        : { OAUTH_ALLOWED_SUBJECTS: "user-1,user-2" },
    });
    const token = insecure ? "" : await h.mint();
    const sessions: string[] = [];
    const tasks: Promise<unknown>[] = [];
    function controller(index: number) {
      const result = composed.mock.results[index];
      if (result?.type !== "return")
        throw Error("HTTP server was not constructed");
      return navigation.navigationBinding(result.value)!.controller;
    }
    function call(index: number) {
      return controller(index).invoke("kdrive_read", args);
    }
    try {
      for (let i = 0; i < (insecure ? 2 : 8); i++)
        sessions.push(await wallBound(h.open(token)));
      const first = call(0);
      tasks.push(first);
      await turn();
      await microtasks();
      expect(f.content.open).toHaveBeenCalledTimes(1);
      const second = call(1);
      tasks.push(second);
      await turn();
      await microtasks();
      expect.soft(f.content.open).toHaveBeenCalledTimes(1);
      for (let index = 2; index < sessions.length; index++) {
        let result: unknown;
        const refused = call(index).then((value) => {
          result = value;
          return value;
        });
        tasks.push(refused);
        await turn();
        await microtasks();
        expect.soft(result).toEqual(contentError("SERVER_BUSY"));
      }
      if (!insecure) {
        const otherToken = await h.mint({ sub: "user-2" });
        await wallBound(h.open(otherToken));
        const other = call(8);
        tasks.push(other);
        await turn();
        await microtasks();
        expect.soft(f.content.open).toHaveBeenCalledTimes(2);
        // B runs while A2 retains its original waiting age.
        releases.at(-1)!();
        expect(await wallBound(other)).toEqual(success);
      }
      releases[0]!();
      expect(await wallBound(first)).toEqual(success);
      await turn();
      await microtasks();
      // All currently held bodies are released also on the pre-F-040 baseline.
      for (const release of releases) release();
      expect(await wallBound(second)).toEqual(success);
    } finally {
      for (const release of releases) release();
      await wallBound(h.handler.close());
      await wallBound(Promise.allSettled(tasks));
    }
  },
);

it("TestBR426_v1_AC08_worker_exit_precedes_permit_reuse http-process-stderr", async () => {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  // Install the process port before composition module initialization: an owner
  // may legitimately capture that port once for its entire process lifetime.
  vi.resetModules();
  const processOwner = await import("../../src/extraction-owner.js");
  const { httpFixture: processHttpFixture } =
    await import("../helpers/http.js");
  const workers = installControlledWorkers(processOwner);
  const f = await contentFixture({}, Buffer.from("safe"));
  const h = await processHttpFixture({ dependencies: f.dependencies });
  const token = await h.mint();
  const session = await wallBound(h.open(token));
  let task: Promise<unknown> | undefined;
  try {
    task = h
      .call(token, session, "kdrive_read", args)
      .then(
        async (response) =>
          ((await response.json()) as { result: unknown }).result,
      );
    for (let i = 0; i < 100 && workers.records.length === 0; i++) {
      await turn();
      await microtasks();
    }
    expect(workers.records).toHaveLength(1);
    const worker = workers.records[0]!;
    await wallBound(worker.started);
    worker.worker.emit("message", {
      value: { kind: "text", text: "safe", encoding: "utf-8" },
    });
    await microtasks();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.rejectTermination();
    expect(await wallBound(task)).toEqual(contentError("CONTENT_UNAVAILABLE"));
    expect.soft(lines).toEqual([DETACH_LINE]);
    const deleted = await wallBound(h.del(token, session));
    expect(deleted.status).toBe(200);
    await deleted.text();
    // The owner and its process stderr sink survive destruction of the HTTP session.
    await wallBound(worker.confirmExit());
    await turn();
    await microtasks();
    worker.worker.emit("exit", 0);
    expect
      .soft(() => worker.worker.emit("error", Error("CANARY_HTTP_DETACHED")))
      .not.toThrow();
    worker.worker.emit("message", { value: "CANARY_HTTP_PAYLOAD" });
    expect.soft(lines).toEqual([DETACH_LINE, RELEASE_LINE]);
    expect.soft(lines.join("")).not.toContain("CANARY");
    expect(h.logs.filter((event) => event.name.includes("extraction"))).toEqual(
      [],
    );
    const fresh = await wallBound(h.open(token));
    const info = await wallBound(
      h.mcp(
        token,
        jsonRpc("tools/call", 4, {
          name: "kdrive_info",
          arguments: { file_id: 3 },
        }),
        fresh,
      ),
    );
    expect(
      ((await info.json()) as { result: { isError?: boolean } }).result.isError,
    ).toBeUndefined();
  } finally {
    await workers.close();
    await wallBound(h.handler.close());
    if (task) await wallBound(task);
  }
});

it("TestBR423_v1_AC11_identity_cap_and_oldest_eligible_waiter HTTP identity-key", async () => {
  vi.spyOn(extraction, "runExtraction").mockResolvedValue({
    kind: "text",
    text: "safe",
    encoding: "utf-8",
  });
  const composed = vi.spyOn(navigation, "createNavigationServer");
  const f = await contentFixture({}, Buffer.from("safe"));
  const releases: (() => void)[] = [];
  f.content.open.mockImplementation((request) => {
    const response = rangeResponse(request, f.bytes);
    const gate = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    const read = response.body.read.getMockImplementation()!;
    response.body.read.mockImplementation(async (max) => {
      await gate;
      return await read(max);
    });
    return Promise.resolve(response);
  });
  const h = await httpFixture({
    dependencies: f.dependencies,
    env: { OAUTH_ALLOWED_SUBJECTS: "user-1,user-2" },
  });
  const otherIssuer = "https://other-issuer.test";
  const other = await httpFixture({
    dependencies: f.dependencies,
    env: { OAUTH_ISSUER: otherIssuer },
  });
  const tasks: Promise<unknown>[] = [];
  const controller = (index: number) => {
    const result = composed.mock.results[index];
    if (result?.type !== "return") throw Error("HTTP composition missing");
    return navigation.navigationBinding(result.value)!.controller;
  };
  try {
    const token = await h.mint();
    await wallBound(h.open(token));
    await wallBound(h.open(token));
    await wallBound(h.open(await h.mint({ sub: "user-2" })));
    await wallBound(
      other.open(await other.mint({ upstream_iss: otherIssuer })),
    );
    const a = controller(0).invoke("kdrive_read", args);
    tasks.push(a);
    await microtasks();
    const a2 = controller(1).invoke("kdrive_read", args);
    tasks.push(a2);
    await microtasks();
    expect.soft(f.content.open).toHaveBeenCalledTimes(1);
    for (const [index, expected] of [
      [2, 2],
      [3, 3],
    ] as const) {
      const distinct = controller(index).invoke("kdrive_read", args);
      tasks.push(distinct);
      await microtasks();
      expect.soft(f.content.open).toHaveBeenCalledTimes(expected);
      releases.at(-1)!();
      expect(await wallBound(distinct)).toEqual(success);
    }
    releases[0]!();
    expect(await wallBound(a)).toEqual(success);
    await microtasks();
    for (const release of releases) release();
    expect(await wallBound(a2)).toEqual(success);
  } finally {
    for (const release of releases) release();
    await wallBound(h.handler.close());
    await wallBound(other.handler.close());
    await wallBound(Promise.allSettled(tasks));
  }
});

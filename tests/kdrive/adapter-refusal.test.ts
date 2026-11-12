// F-014 AC-28 (BR-217): rate-limited operator events, stdio and HTTP formats.
import { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_HOST,
  CANARY,
  DRIVE,
  STORAGE_HOST,
  adapterFor,
  kdriveFixture,
  transport,
} from "../helpers/kdrive.js";
import { listeningPort } from "../helpers/http.js";
import {
  httpClient,
  runMain,
  stdioClient,
  textOf,
  tokenFile,
} from "../helpers/main.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await fixture?.close();
  fixture = undefined;
});
const tick = () => new Promise<void>((r) => setImmediate(r));
type Mode = "ok" | "tls" | "dns" | "stall" | "stall-download";
const formats = {
  stdio: {
    refused: (s: number) => `kDrive upstream refused a request (${String(s)}).`,
    unavailable: (c: string) => `kDrive upstream unavailable (${c}).`,
  },
  http: {
    refused: (s: number) =>
      JSON.stringify({ event: "kdrive_upstream_refused", status: s }),
    unavailable: (c: string) =>
      JSON.stringify({ event: "kdrive_upstream_unavailable", class: c }),
  },
};

async function start(kind: "stdio" | "http") {
  const f = (fixture = await kdriveFixture());
  const injected = transport(f.upstream);
  const state = { mode: "ok" as Mode, status: 0 };
  f.drive.overrides.push((r) =>
    r.path === "/3/drive/101/files/12" && state.status
      ? { status: state.status, body: `${CANARY} ${API_HOST}` }
      : undefined,
  );
  f.drive.overrides.push((r) =>
    (r.path === "/3/drive/101/files/12" && state.mode === "stall") ||
    (r.host === STORAGE_HOST && state.mode === "stall-download")
      ? { stall: "headers" }
      : undefined,
  );
  const port = await listeningPort();
  const run = await runMain({
    argv: kind === "http" ? ["--http", "--insecure-no-auth"] : [],
    env: {
      KDRIVE_ID: String(DRIVE),
      KDRIVE_TOKEN_FILE: tokenFile(),
      ...(kind === "http" ? { MCP_HTTP_PORT: String(port) } : {}),
    },
    lookup: (host: string) =>
      state.mode === "dns"
        ? Promise.reject(new Error("ENOTFOUND"))
        : injected.lookup(host),
    connect: (options: { host: string; port: number; servername: string }) =>
      state.mode === "tls"
        ? tlsConnect({
            host: "127.0.0.1",
            port: f.upstream.port,
            servername: options.servername,
          })
        : injected.connect(options),
  });
  const client =
    kind === "http" ? await httpClient(port) : await stdioClient(run);
  const info = async () =>
    textOf(
      await client.callTool({
        name: "kdrive_info",
        arguments: { drive_id: DRIVE, file_id: 12 },
      }),
    );
  const lines = () =>
    run
      .stderr()
      .split("\n")
      .filter(
        (l) => l.includes("kdrive_upstream") || l.startsWith("kDrive upstream"),
      );
  return { f, run, client, state, info, lines };
}

describe("BR-217 operator events", () => {
  it.each(["stdio", "http"] as const)(
    "TestBR217_%s_refused_401_three_times_then_403_at_60000_ms",
    async (kind) => {
      const t = await start(kind);
      t.state.status = 401;
      for (const at of [0, 10_000, 59_999]) {
        t.run.clock.now = at;
        expect(await t.info()).toEqual({ error: "READ_UNAVAILABLE" });
      }
      t.state.status = 403;
      t.run.clock.now = 60_000;
      expect(await t.info()).toEqual({ error: "READ_UNAVAILABLE" });
      expect(t.lines()).toEqual([
        formats[kind].refused(401),
        formats[kind].refused(403),
      ]);
      for (const line of t.run.stderr().split("\n"))
        expect(line).not.toMatch(
          new RegExp(`${CANARY}|${API_HOST}|/files/|\\b12\\b|\\b101\\b`, "u"),
        );
      await t.client.close();
      await (t.run.handle as { close(): Promise<void> }).close();
    },
  );

  it.each(["stdio", "http"] as const)(
    "TestBR217_%s_timeout_twice_then_TLS_emits_one_timeout_line",
    async (kind) => {
      const t = await start(kind);
      t.state.mode = "stall";
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      for (const at of [1_000, 2_000]) {
        t.run.clock.now = at;
        const pending = t.info();
        for (let i = 0; i < 50; i++) await tick();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await pending).toEqual({ error: "ACCESS_DENIED" });
      }
      vi.useRealTimers();
      t.state.mode = "tls";
      t.run.clock.now = 3_000;
      expect(await t.info()).toEqual({ error: "ACCESS_DENIED" });
      expect(t.lines()).toEqual([formats[kind].unavailable("timeout")]);
      await t.client.close();
      await (t.run.handle as { close(): Promise<void> }).close();
    },
  );

  it.each(["stdio", "http"] as const)(
    "TestBR217_%s_401_then_timeout_are_separate_windows_then_network_and_silent_abort",
    async (kind) => {
      const t = await start(kind);
      t.state.status = 401;
      t.run.clock.now = 100;
      await t.info();
      // AC-28: a 401 then a timeout within 60,000 ms (separate windows).
      t.state.status = 0;
      t.state.mode = "stall";
      t.run.clock.now = 200;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const stalled = t.info();
      for (let i = 0; i < 50; i++) await tick();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await stalled).toEqual({ error: "ACCESS_DENIED" });
      vi.useRealTimers();
      expect(t.lines()).toEqual([
        formats[kind].refused(401),
        formats[kind].unavailable("timeout"),
      ]);
      // After the window: a DNS failure, then an abort that emits nothing.
      t.state.mode = "dns";
      t.run.clock.now = 60_200;
      expect(await t.info()).toEqual({ error: "ACCESS_DENIED" });
      t.state.mode = "stall-download";
      t.run.clock.now = 120_200;
      const controller = new AbortController();
      const pending = t.client
        .callTool(
          {
            name: "kdrive_download",
            arguments: { drive_id: DRIVE, file_id: 12 },
          },
          { signal: controller.signal },
        )
        .catch(() => undefined);
      for (
        let i = 0;
        i < 4000 && !t.f.upstream.seen.some((r) => r.host === STORAGE_HOST);
        i++
      )
        await tick();
      controller.abort();
      await pending;
      for (let i = 0; i < 100; i++) await tick();
      expect(t.lines()).toEqual([
        formats[kind].refused(401),
        formats[kind].unavailable("timeout"),
        formats[kind].unavailable("network"),
      ]);
      await t.client.close();
      await (t.run.handle as { close(): Promise<void> }).close();
    },
  );

  it("TestBR217_full_queue_reports_the_queue_class_and_the_composition_formats_it", async () => {
    // Navigation admits at most 64 concurrent invocations (F-012 sessions),
    // fewer than the 73 requests that fill the adapter queue, so the queue
    // cause is driven at the adapter seam and formatted by the composition.
    const f = (fixture = await kdriveFixture());
    const gates: (() => void)[] = [];
    const original = f.upstream.handler;
    f.upstream.handler = (r) =>
      new Promise((resolve) =>
        gates.push(() => {
          resolve(original(r));
        }),
      );
    const causes: string[] = [];
    const a = await adapterFor(f, { onUnavailable: (c) => causes.push(c) });
    const calls = Array.from({ length: 72 }, (_, i) =>
      a.dependencies
        .inspect({ driveId: DRIVE, id: 1000 + i }, "live")
        .catch(() => undefined),
    );
    await expect(
      a.dependencies.inspect({ driveId: DRIVE, id: 9 }, "live"),
    ).rejects.toThrow("READ_UNAVAILABLE");
    expect(causes).toEqual(["queue"]);
    for (let i = 0; i < 4000 && gates.length < 8; i++) await tick();
    while (gates.length) {
      gates.shift()?.();
      for (let i = 0; i < 20; i++) await tick();
    }
    await Promise.all(calls);
    const { createOperatorEvents } = await import("../../src/main.js");
    for (const kind of ["stdio", "http"] as const) {
      const out: string[] = [];
      const clock = { now: 0 };
      const events = createOperatorEvents(
        kind,
        () => clock.now,
        (line) => out.push(line),
      );
      events.unavailable("queue");
      events.unavailable("queue");
      clock.now = 60_000;
      events.unavailable("network");
      expect(out).toEqual([
        `${formats[kind].unavailable("queue")}\n`,
        `${formats[kind].unavailable("network")}\n`,
      ]);
    }
  });

  it("TestBR217_socket_error_is_network", async () => {
    const f = (fixture = await kdriveFixture());
    const causes: string[] = [];
    const a = await adapterFor(
      {
        lookup: f.lookup,
        connect: () => {
          const s = new Socket();
          queueMicrotask(() => s.destroy(new Error("ECONNRESET")));
          return s;
        },
      },
      { onUnavailable: (c) => causes.push(c) },
    );
    await a.dependencies
      .inspect({ driveId: DRIVE, id: 12 }, "live")
      .catch(() => undefined);
    expect(causes).toEqual(["network"]);
  });

  it.each([
    ["stdio", "401"],
    ["stdio", "timeout"],
    ["http", "401"],
    ["http", "timeout"],
  ] as const)(
    "TestBR217_%s_preflight_init_%s_writes_only_the_PREFLIGHT_FAILED_line",
    async (kind, failure) => {
      const f = (fixture = await kdriveFixture());
      const injected = transport(f.upstream);
      f.drive.overrides.push((r) =>
        r.path === "/2/drive/init"
          ? failure === "401"
            ? { status: 401, body: `${CANARY} ${API_HOST}` }
            : { stall: "headers" }
          : undefined,
      );
      const port = await listeningPort();
      if (failure === "timeout")
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const state = { settled: false };
      const pending = runMain({
        argv: kind === "http" ? ["--http", "--insecure-no-auth"] : [],
        env: {
          KDRIVE_ID: String(DRIVE),
          KDRIVE_TOKEN_FILE: tokenFile(),
          ...(kind === "http" ? { MCP_HTTP_PORT: String(port) } : {}),
        },
        lookup: injected.lookup,
        connect: injected.connect,
      }).finally(() => {
        state.settled = true;
      });
      // Advance fake time until main settles, bounded by real time (Date is
      // not faked): a fixed round count could leave `pending` waiting on a
      // fake timer nobody advances when real I/O is slow under load.
      const started = Date.now();
      if (failure === "timeout")
        while (!state.settled && Date.now() - started < 15_000) {
          for (let i = 0; i < 50; i++) await tick();
          await vi.advanceTimersByTimeAsync(5_000);
        }
      const run = await pending;
      vi.useRealTimers();
      expect(run.handle).toBeUndefined();
      expect(run.stderr()).toBe(
        "Configuration error [PREFLIGHT_FAILED] (preflight).\n",
      );
    },
    // The fake-timer loop yields with real ticks; under CPU load the default
    // 5,000 ms real test timeout was exhausted (BACKLOG 2026-11-09).
    20_000,
  );
});

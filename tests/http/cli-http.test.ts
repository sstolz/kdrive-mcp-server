// F-014 AC-20 (BR-210): HTTP composition through in-process main(deps).
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kdriveFixture } from "../helpers/kdrive.js";
import { httpClient, runMain, textOf, tokenFile } from "../helpers/main.js";
import { listeningPort, P } from "../helpers/http.js";
import {
  CLAUDE,
  UPSTREAM,
  UPSTREAM_CLIENT,
  syntheticPem,
} from "../helpers/proxy.js";

const upstreamSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../src/auth/proxy/index.js", async (original) => {
  const actual =
    await original<typeof import("../../src/auth/proxy/index.js")>();
  return {
    ...actual,
    createFetchUpstream: (
      options: Parameters<typeof actual.createFetchUpstream>[0],
    ) => {
      upstreamSpy.calls++;
      return actual.createFetchUpstream(options);
    },
  };
});

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("BR-210 HTTP composition", () => {
  it.each(["SIGTERM", "SIGINT"])(
    "TestBR210_insecure_loopback_serves_kdrive_info_logs_JSON_lines_and_%s_exits_0",
    async (signal) => {
      const f = (fixture = await kdriveFixture());
      const port = await listeningPort();
      const run = await runMain({
        argv: ["--http", "--insecure-no-auth"],
        env: {
          KDRIVE_ID: "101",
          KDRIVE_TOKEN_FILE: tokenFile(),
          MCP_HTTP_PORT: String(port),
        },
        lookup: f.lookup,
        connect: f.connect,
      });
      expect(run.handle).toMatchObject({
        address: { address: "127.0.0.1", port },
      });
      const client = await httpClient(port);
      const info = textOf(
        await client.callTool({
          name: "kdrive_info",
          arguments: { drive_id: 101, file_id: 12 },
        }),
      );
      expect(info).toMatchObject({ ok: { item: { id: 12 } } });
      await client.close();
      const lines = run.stderr().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines)
        expect(JSON.parse(line)).toHaveProperty("event");
      expect(upstreamSpy.calls).toBe(0);
      run.signals.emit(signal);
      for (let i = 0; i < 2000 && run.exits.length === 0; i++)
        await new Promise((r) => setImmediate(r));
      expect(run.exits).toEqual([0]);
      await expect(
        fetch(`http://127.0.0.1:${String(port)}/mcp`),
      ).rejects.toThrow();
    },
  );

  it("TestBR210_proxy_mode_passes_createFetchUpstream_to_startHttpServer", async () => {
    const f = (fixture = await kdriveFixture());
    const directory = await mkdtemp(join(tmpdir(), "kdrive-proxy-"));
    await writeFile(join(directory, "upstream-secret"), "SYNTHETIC-SECRET\n");
    await writeFile(join(directory, "signing.pem"), syntheticPem());
    const port = await listeningPort();
    upstreamSpy.calls = 0;
    const run = await runMain({
      argv: ["--http"],
      env: {
        KDRIVE_ID: "101",
        KDRIVE_TOKEN_FILE: tokenFile(),
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_HTTP_PORT: String(port),
        MCP_PUBLIC_URL: P,
        OAUTH_MODE: "proxy",
        OAUTH_ISSUER: UPSTREAM,
        OAUTH_ALLOWED_SUBJECTS: "user-1",
        OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
        OAUTH_UPSTREAM_CLIENT_SECRET_FILE: join(directory, "upstream-secret"),
        OAUTH_SIGNING_KEY_FILE: join(directory, "signing.pem"),
        OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
      },
      lookup: f.lookup,
      connect: f.connect,
    });
    expect(run.stderr()).toBe("");
    expect(upstreamSpy.calls).toBe(1);
    run.signals.emit("SIGTERM");
    for (let i = 0; i < 2000 && run.exits.length === 0; i++)
      await new Promise((r) => setImmediate(r));
    expect(run.exits).toEqual([0]);
  });
});

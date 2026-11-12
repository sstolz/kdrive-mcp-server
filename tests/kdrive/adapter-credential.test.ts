// F-014 AC-17 (BR-208): the token stays in the adapter and the API header.
// The shared fixture also fails every adapter, CLI and HTTP test that sends
// the canary anywhere but the API-origin Authorization header (kdriveFixture).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANARY,
  DRIVE,
  adapterFor,
  invocation,
  kdriveFixture,
  signal,
} from "../helpers/kdrive.js";
import { httpClient, runMain, stdioClient, textOf } from "../helpers/main.js";
import { listeningPort } from "../helpers/http.js";

const captured = vi.hoisted(() => ({ values: [] as unknown[] }));
vi.mock("../../src/config.js", async (original) => {
  const actual = await original<typeof import("../../src/config.js")>();
  return {
    ...actual,
    preflightConfiguration: (local: unknown, resolver: unknown) => {
      captured.values.push(local);
      return actual.preflightConfiguration(local as never, resolver as never);
    },
  };
});
vi.mock("../../src/stdio.js", async (original) => {
  const actual = await original<typeof import("../../src/stdio.js")>();
  return {
    ...actual,
    startStdioNavigation: (configuration: unknown, ...rest: unknown[]) => {
      captured.values.push(configuration);
      return (actual.startStdioNavigation as (...a: unknown[]) => unknown)(
        configuration,
        ...rest,
      );
    },
  };
});
vi.mock("../../src/http/index.js", async (original) => {
  const actual = await original<typeof import("../../src/http/index.js")>();
  return {
    ...actual,
    startHttpServer: (options: { configuration: unknown }) => {
      captured.values.push(options.configuration);
      return actual.startHttpServer(options as never);
    },
  };
});

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("BR-208 credential confinement", () => {
  it("TestBR208_canary_appears_only_in_the_API_Authorization_header", async () => {
    const f = (fixture = await kdriveFixture());
    const a = await adapterFor(f);
    expect(JSON.stringify(a)).not.toContain(CANARY);
    const outputs: unknown[] = [];
    const d = a.dependencies;
    outputs.push(await d.inspect({ driveId: DRIVE, id: 12 }, "live"));
    outputs.push(
      await d.children({
        ...invocation(),
        driveId: DRIVE,
        id: 11,
        location: "live",
      }),
    );
    outputs.push(
      await d.content.describe({ driveId: DRIVE, id: 12 }, signal()),
    );
    outputs.push(await a.preflight.inspectDrive(DRIVE));
    f.drive.overrides.push(() => ({ status: 401, body: `echo ${CANARY}` }));
    outputs.push(
      await d
        .inspect({ driveId: DRIVE, id: 12 }, "live")
        .catch((e: unknown) => e),
    );
    outputs.push(
      await a.preflight.inspectDrive(DRIVE).catch((e: unknown) => e),
    );
    for (const value of outputs) {
      expect(JSON.stringify(value ?? null)).not.toContain(CANARY);
      if (value instanceof Error) {
        expect(value.message).not.toContain(CANARY);
        expect(String(value.stack)).not.toContain(CANARY);
      }
    }
    const authorized = f.upstream.seen.filter(
      (s) => s.headers.authorization !== undefined,
    );
    expect(authorized.length).toBeGreaterThan(0);
    expect(authorized.every((s) => s.host === "api.infomaniak.com")).toBe(true);
  });

  it.each(["stdio", "http"])(
    "TestBR208_%s_main_deletes_KDRIVE_TOKEN_and_never_exposes_the_canary",
    async (transport) => {
      captured.values.length = 0;
      const f = (fixture = await kdriveFixture());
      const port = await listeningPort();
      const env: Record<string, string | undefined> = {
        KDRIVE_ID: "101",
        KDRIVE_TOKEN: CANARY,
        ...(transport === "http" ? { MCP_HTTP_PORT: String(port) } : {}),
      };
      const run = await runMain({
        argv: transport === "http" ? ["--http", "--insecure-no-auth"] : [],
        env,
        lookup: f.lookup,
        connect: f.connect,
      });
      expect(Object.hasOwn(env, "KDRIVE_TOKEN")).toBe(false);
      const client =
        transport === "http" ? await httpClient(port) : await stdioClient(run);
      const results = [
        textOf(
          await client.callTool({
            name: "kdrive_info",
            arguments: { drive_id: 101, file_id: 12 },
          }),
        ),
        textOf(
          await client.callTool({
            name: "kdrive_download",
            arguments: { drive_id: 101, file_id: 12 },
          }),
        ),
      ];
      f.drive.overrides.push(() => ({ status: 401, body: CANARY }));
      results.push(
        textOf(
          await client.callTool({
            name: "kdrive_info",
            arguments: { drive_id: 101, file_id: 12 },
          }),
        ),
      );
      expect(results[2]).toEqual({ error: "READ_UNAVAILABLE" });
      await client.close();
      await (run.handle as { close(): Promise<void> }).close();
      expect(captured.values).toHaveLength(2);
      for (const value of [
        ...captured.values,
        results,
        run.stderr(),
        run.stdout(),
      ])
        expect(JSON.stringify(value)).not.toContain(CANARY);
      for (const value of captured.values)
        expect(value).toMatchObject({ token: "" });
      for (const value of captured.values)
        expect(value).not.toHaveProperty("tokenFile");
    },
  );

  it("TestBR208_withoutCredential_is_a_frozen_token_free_copy", async () => {
    const { loadConfiguration, withoutCredential } =
      await import("../../src/config.js");
    const local = await loadConfiguration({
      argv: [],
      env: { KDRIVE_ID: "101", KDRIVE_TOKEN: CANARY },
    });
    const safe = withoutCredential(local);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(safe.token).toBe("");
    expect(Object.hasOwn(safe, "tokenFile")).toBe(false);
    expect(JSON.stringify(safe)).not.toContain(CANARY);
    expect({ ...safe, token: local.token }).toEqual({ ...local });
  });
});

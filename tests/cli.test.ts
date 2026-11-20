import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FlushPort, processPorts } from "./helpers/f039-composition.js";
import { runDiagnostic, runGuarded } from "./helpers/diagnostic.js";

describe("BR-016 BR-028 diagnostic executable without network or deployment configuration", () => {
  const cli = resolve("dist/cli.js");
  it.each([
    { args: ["--version"], code: 0, stdout: "1.0.1\n", stderr: "" },
    { args: ["--help"], code: 0, stdout: undefined, stderr: "" },
    {
      args: [],
      code: 1,
      stdout: "",
      stderr: "Configuration error [MISSING_REQUIRED] (driveIds).\n",
    },
    {
      args: ["--unknown"],
      code: 1,
      stdout: "",
      stderr: "Configuration error [UNKNOWN_OPTION] (cli).\n",
    },
    {
      args: ["--help", "--version"],
      code: 1,
      stdout: "",
      stderr: "Configuration error [INVALID_VALUE] (cli).\n",
    },
  ])("returns expected output for $args", ({ args, code, stdout, stderr }) => {
    const result = runDiagnostic(cli, args);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(code);
    if (stdout === undefined) {
      expect(result.stdout).toContain("Usage: kdrive-mcp-server");
      expect(result.stdout).toContain("--config");
      expect(result.stdout).toContain("--drive-ids");
    } else expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
  });
  it.each(["--help", "--version"])(
    "ignores hostile deployment environment for %s",
    (arg) => {
      const result = runDiagnostic(cli, [arg], {
        KDRIVE_TOKEN_FILE: "/DO_NOT_READ_CANARY",
        KDRIVE_UNKNOWN: "CANARY",
        OAUTH_UNKNOWN: "CANARY",
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("CANARY");
    },
  );
  it.each(["stdio", "http"])(
    "TestBR016v2_packaged_%s_local_configuration_error_ends_before_any_request",
    (transport) => {
      // BR-016 v2: the packaged binary is exercised only on request-free paths.
      const result = runDiagnostic(
        cli,
        transport === "http" ? ["--http", "--insecure-no-auth"] : [],
        { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: "/nonexistent/CANARY" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Configuration error [CREDENTIAL_READ_FAILED] (tokenFile).\n",
      );
      expect(result.stderr).not.toContain("runtime is not implemented yet");
    },
  );
  it("TestBR016v2_help_shows_the_v2_line_and_neither_replaced_line", () => {
    const result = runDiagnostic(cli, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Serve kDrive over stdio or HTTP after production preflight.\n",
    );
    expect(result.stdout).not.toContain("Validate local configuration;");
    expect(result.stdout).not.toContain("Injected stdio modules exist;");
  });
  it("BR-027 emits no raw option, value, path or stack", () => {
    for (const [args, env, code, setting] of [
      [["--CANARY"], {}, "UNKNOWN_OPTION", "cli"],
      [
        ["--mode", "CANARY"],
        { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC" },
        "INVALID_VALUE",
        "mode",
      ],
      [
        [],
        { KDRIVE_ID: "7", KDRIVE_TOKEN_FILE: "/CANARY" },
        "CREDENTIAL_READ_FAILED",
        "tokenFile",
      ],
    ] as const) {
      const result = runDiagnostic(cli, [...args], env);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `Configuration error [${code}] (${setting}).\n`,
      );
    }
  });
});
it("BR-016 the diagnostic guard actively rejects attempted network access", () => {
  const result = runGuarded(["--eval", "fetch('https://synthetic.invalid')"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Forbidden I/O attempted");
});

describe("F-014 in-process main(deps) composition", () => {
  // AC-19 (BR-016 v2, BR-028 v2, BR-071 v2, BR-123 v2).
  const tools = [
    "kdrive_download",
    "kdrive_info",
    "kdrive_list",
    "kdrive_list_drives",
    "kdrive_my_shared",
    "kdrive_read",
    "kdrive_recents",
    "kdrive_resolve_path",
    "kdrive_search",
    "kdrive_shared_with_me",
  ];
  it("TestBR071v2_stdio_main_serves_ten_tools_and_reads_through_the_adapter", async () => {
    const { kdriveFixture, BYTES } = await import("./helpers/kdrive.js");
    const { runMain, stdioClient, tokenFile, textOf } =
      await import("./helpers/main.js");
    const f = await kdriveFixture();
    const run = await runMain({
      argv: [],
      env: { KDRIVE_ID: "101", KDRIVE_TOKEN_FILE: tokenFile() },
      lookup: f.lookup,
      connect: f.connect,
    });
    const client = await stdioClient(run);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual(tools);
    const info = textOf(
      await client.callTool({
        name: "kdrive_info",
        arguments: { drive_id: 101, file_id: 12 },
      }),
    );
    expect(info).toMatchObject({
      ok: { item: { id: 12, path: "/Private/docs/a.bin" } },
    });
    const resource = await client.readResource({ uri: "kdrive://101/file/12" });
    const blob = (resource.contents[0] as { blob: string }).blob;
    expect(Buffer.from(blob, "base64")).toEqual(BYTES);
    for (const line of run.stdout().split("\n").filter(Boolean))
      expect(JSON.parse(line)).toHaveProperty("jsonrpc", "2.0");
    expect(run.exits).toEqual([]);
    await client.close();
    await (run.handle as { close(): Promise<void> }).close();
    await f.close();
  });

  it("TestBR016v2_transport_failure_gives_exactly_the_preflight_line_and_exit_1", async () => {
    const { kdriveFixture } = await import("./helpers/kdrive.js");
    const { runMain, tokenFile } = await import("./helpers/main.js");
    const f = await kdriveFixture();
    const run = await runMain({
      argv: [],
      env: { KDRIVE_ID: "101", KDRIVE_TOKEN_FILE: tokenFile() },
      lookup: () => Promise.reject(new Error("ENOTFOUND")),
      connect: f.connect,
    });
    expect(run.stderr()).toBe(
      "Configuration error [PREFLIGHT_FAILED] (preflight).\n",
    );
    expect(run.stdout()).toBe("");
    expect(run.exits).toEqual([1]);
    expect(run.handle).toBeUndefined();
    await f.close();
  });

  it("TestBR123v2_production_composition_supplies_the_content_port", async () => {
    const { kdriveFixture } = await import("./helpers/kdrive.js");
    const { runMain, stdioClient, tokenFile, textOf } =
      await import("./helpers/main.js");
    const f = await kdriveFixture();
    const run = await runMain({
      argv: [],
      env: { KDRIVE_ID: "101", KDRIVE_TOKEN_FILE: tokenFile() },
      lookup: f.lookup,
      connect: f.connect,
    });
    const client = await stdioClient(run);
    const read = textOf(
      await client.callTool({
        name: "kdrive_read",
        arguments: { drive_id: 101, file_id: 12, format: "text" },
      }),
    );
    expect(read).toHaveProperty("ok");
    expect(JSON.stringify(read)).toContain("0123456789abcdef");
    await client.close();
    await (run.handle as { close(): Promise<void> }).close();
    await f.close();
  });

  it("TestBR016v2_configuration_error_in_main_prints_one_line_and_exits_1", async () => {
    const { runMain } = await import("./helpers/main.js");
    const run = await runMain({
      argv: ["--unknown"],
      env: {},
      lookup: () => Promise.reject(new Error("unused")),
      connect: () => {
        throw new Error("unused");
      },
    });
    expect(run.stderr()).toBe("Configuration error [UNKNOWN_OPTION] (cli).\n");
    expect(run.exits).toEqual([1]);
  });
});

function configureFlushStreams(row: string, out: FlushPort, err: FlushPort) {
  if (row === "destroyed-stdout") out.destroyed = true;
  if (row.endsWith("-throw"))
    (row.startsWith("stdout") ? out : err).onWrite = () => {
      throw new Error("SYNTHETIC_FLUSH_FAILURE");
    };
  if (row === "sync-errors") {
    for (const stream of [out, err])
      stream.onWrite = (callback) => {
        expect(vi.getTimerCount()).toBe(1);
        callback(new Error("SYNTHETIC_FLUSH_FAILURE"));
      };
  }
}

async function completeFlushStreams(
  row: string,
  out: FlushPort,
  err: FlushPort,
  ports: ReturnType<typeof processPorts>,
  start: number,
) {
  if (
    row === "prompt" ||
    row === "remaining-100-prompt" ||
    row === "stdout-only"
  ) {
    await vi.advanceTimersByTimeAsync(5);
    out.callbacks[0]?.();
    expect(ports.exits).toEqual([]);
  }
  if (row === "stdout-error")
    out.callbacks[0]?.(new Error("SYNTHETIC_FLUSH_FAILURE"));
  if (row === "stderr-error")
    err.callbacks[0]?.(new Error("SYNTHETIC_FLUSH_FAILURE"));
  const prompt = [
    "prompt",
    "remaining-100-prompt",
    "destroyed-stdout",
    "stdout-error",
    "stderr-error",
    "stdout-throw",
    "stderr-throw",
  ].includes(row);
  if (prompt || row === "stderr-only") {
    await vi.advanceTimersByTimeAsync(start + 10 - performance.now());
    if (row === "stderr-error" || row === "stderr-throw") out.callbacks[0]?.();
    else err.callbacks[0]?.();
  }
  return prompt;
}

// BR-254 v2 / BR-070 v5: only ports are replaced; productionDependencies().exit is real.
describe("F-039 production exit flush", () => {
  const rows = [
    "prompt",
    "neither",
    "stdout-only",
    "stderr-only",
    "remaining-100",
    "remaining-100-prompt",
    "remaining-zero",
    "destroyed-stdout",
    "stdout-error",
    "stderr-error",
    "stdout-throw",
    "stderr-throw",
    "sync-errors",
    "first-call-wins",
  ] as const;
  it.each([0, 1].flatMap((code) => rows.map((row) => ({ code, row }))))(
    "TestBR254_v2_AC12_real_production_exit_bounds_flush_wait [$code $row]",
    async ({ code, row }) => {
      vi.useFakeTimers();
      const timerSpy = vi.spyOn(globalThis, "setTimeout");
      const out = new FlushPort(),
        err = new FlushPort();
      const ports = processPorts(out, err);
      try {
        configureFlushStreams(row, out, err);
        // Ordinary fire-and-forget output and the diagnostic must precede the flush.
        err.write("SYNTHETIC_STARTUP_FAILURE\n");
        err.write(
          "Audit outcome could not be recorded; further writes are refused until restart.\n",
        );
        const start = performance.now();
        const deadline = row.startsWith("remaining-100")
          ? start + 100
          : row === "remaining-zero"
            ? start
            : undefined;
        expect(() => {
          ports.exit(code, deadline);
        }).not.toThrow();
        expect(process.exitCode).toBe(code);
        if (row === "remaining-zero" || row === "sync-errors") {
          expect(ports.exits).toEqual([{ code, at: start }]);
          expect(vi.getTimerCount()).toBe(0);
          return;
        }
        if (row === "first-call-wins") ports.exit(1 - code, start + 50);
        expect(process.exitCode).toBe(code);
        // Both writes are issued at entry, so a blocked stdout cannot starve stderr.
        expect(err.writes).toEqual([
          "SYNTHETIC_STARTUP_FAILURE\n",
          "Audit outcome could not be recorded; further writes are refused until restart.\n",
          "",
        ]);
        if (!out.destroyed) expect(out.writes).toEqual([""]);
        expect(vi.getTimerCount()).toBe(1);
        const fallbackTimer: unknown = timerSpy.mock.results[0]?.value;
        expect((fallbackTimer as { hasRef(): boolean }).hasRef()).toBe(true);
        const prompt = await completeFlushStreams(row, out, err, ports, start);
        if (prompt) {
          expect(ports.exits).toEqual([{ code, at: start + 10 }]);
          expect(vi.getTimerCount()).toBe(0);
        } else {
          const cap = row === "remaining-100" ? 100 : 250;
          await vi.advanceTimersByTimeAsync(
            start + cap - 1 - performance.now(),
          );
          expect(ports.exits).toEqual([]);
          await vi.advanceTimersByTimeAsync(1);
          expect(ports.exits).toEqual([{ code, at: start + cap }]);
        }
        // Repeated calls and late/error completions must never retry exit or change its code.
        if (row === "first-call-wins")
          ports.exit(1 - code, performance.now() + 1000);
        for (const stream of [out, err]) {
          stream.callbacks[0]?.();
          expect(() =>
            stream.emit("error", new Error("SYNTHETIC_LATE_FLUSH_ERROR")),
          ).not.toThrow();
        }
        await vi.advanceTimersByTimeAsync(500);
        expect(ports.exits).toHaveLength(1);
        expect(process.exitCode).toBe(code);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        ports.restore();
        timerSpy.mockRestore();
        vi.useRealTimers();
      }
    },
  );
});

// F-014 AC-27 (BR-216): fixed origin, in-process seams only, no logging.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_HOST,
  DRIVE,
  PUBLIC_ADDRESS,
  adapterFor,
  kdriveFixture,
} from "../helpers/kdrive.js";
import { brandedRead } from "../../src/read-retry.js";
import { runMain, stdioClient, textOf, tokenFile } from "../helpers/main.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
const kdriveSources = readdirSync("src/kdrive")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join("src/kdrive", name));
function parse(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}
/** A self-signed certificate for the API host, outside every trust store. */
function selfSigned() {
  const dir = mkdtempSync(join(tmpdir(), "kdrive-self-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      "key.pem",
      "-out",
      "cert.pem",
      "-days",
      "2",
      "-subj",
      `/CN=${API_HOST}`,
      "-addext",
      `subjectAltName=DNS:${API_HOST}`,
    ],
    { cwd: dir, stdio: "ignore" },
  );
  try {
    return {
      key: readFileSync(join(dir, "key.pem"), "utf8"),
      cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

describe("BR-216 fixed origin and seams", () => {
  it("TestBR216_origin_environment_names_change_nothing", async () => {
    const f = (fixture = await kdriveFixture());
    // KDRIVE_* names are refused by F-002 before any request.
    const refused = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: "101",
        KDRIVE_TOKEN_FILE: tokenFile(),
        KDRIVE_API_URL: "https://127.0.0.1:1",
        KDRIVE_API_ORIGIN: "https://evil.example",
        HTTPS_PROXY: "http://127.0.0.1:9",
      },
      lookup: f.lookup,
      connect: f.connect,
    });
    expect(refused.stderr()).toBe(
      "Configuration error [UNKNOWN_SETTING] (environment).\n",
    );
    expect(f.upstream.seen).toHaveLength(0);
    // Names outside the F-002 namespaces start the server; every request
    // still targets the fixed origin.
    const run = await runMain({
      argv: [],
      env: {
        KDRIVE_ID: "101",
        KDRIVE_TOKEN_FILE: tokenFile(),
        API_URL: "https://127.0.0.1:1",
        INFOMANIAK_API_ORIGIN: "https://evil.example",
        HTTPS_PROXY: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
      },
      lookup: f.lookup,
      connect: f.connect,
    });
    const client = await stdioClient(run);
    await client.callTool({
      name: "kdrive_info",
      arguments: { drive_id: DRIVE, file_id: 12 },
    });
    await client.close();
    await (run.handle as { close(): Promise<void> }).close();
    expect(f.upstream.seen.length).toBeGreaterThan(0);
    expect(f.upstream.seen.every((s) => s.host === API_HOST)).toBe(true);
    expect(f.lookups.every((h) => h === API_HOST)).toBe(true);
    expect(f.connects.every((c) => c.options.servername === API_HOST)).toBe(
      true,
    );
  });

  it.each([
    [["--api-url", "https://evil.example"], undefined, "UNKNOWN_OPTION", "cli"],
    [
      ["--config", "config.yaml"],
      "apiUrl: https://evil.example\n",
      "UNKNOWN_SETTING",
      "configFile",
    ],
  ] as [string[], string | undefined, string, string][])(
    "TestBR216_%s_is_refused_by_configuration",
    async (argv, yaml, code, setting) => {
      const { mkdtempSync, writeFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const directory = mkdtempSync(join(tmpdir(), "kdrive-origin-"));
      if (yaml) writeFileSync(join(directory, "config.yaml"), yaml);
      const { main } = await import("../../src/main.js");
      let stderr = "";
      const exits: number[] = [];
      await main({
        argv: yaml ? ["--config", join(directory, "config.yaml")] : argv,
        env: { KDRIVE_ID: "101", KDRIVE_TOKEN: "SYNTHETIC" },
        stdout: { write: () => true },
        stderr: { write: (t: string) => (stderr += t) },
        signals: { on: () => undefined, off: () => undefined },
        exit: (c: number) => exits.push(c),
        now: () => 0,
        lookup: () => Promise.reject(new Error("unused")),
        connect: () => {
          throw new Error("unused");
        },
      });
      expect(stderr).toBe(`Configuration error [${code}] (${setting}).\n`);
      expect(exits).toEqual([1]);
    },
  );

  it("TestBR216_throwing_observer_changes_no_result_and_is_called_per_HTTP_request", async () => {
    const f = (fixture = await kdriveFixture());
    const calls: string[] = [];
    const a = await adapterFor(f, {
      onRequest: (method, template) => {
        calls.push(`${method} ${template}`);
        throw new Error("observer failure");
      },
    });
    expect(
      await a.dependencies.inspect({ driveId: DRIVE, id: 12 }, "live"),
    ).toMatchObject({ id: 12 });
    expect(
      await a.dependencies.content.describe(
        { driveId: DRIVE, id: 12 },
        new AbortController().signal,
      ),
    ).toMatchObject({ version_bound: true });
    expect(calls).toEqual([
      "GET /3/drive/{d}/files/{f}",
      "GET /3/drive/{d}/files/{f}",
      "GET /2/drive/{d}/files/{f}/download",
      "GET {storage}",
    ]);
    expect(calls.join("")).not.toMatch(/101|12|infomaniak|Bearer/u);
  });

  it("TestBR216_main_onRequest_counts_central_helper_retries", async () => {
    let failures = 2;
    const f = (fixture = await kdriveFixture());
    f.drive.overrides.push((r) =>
      r.path === "/3/drive/101/files/12" && failures-- > 0
        ? { status: 503, body: "" }
        : undefined,
    );
    const calls: string[] = [];
    const run = await runMain({
      argv: [],
      env: { KDRIVE_ID: "101", KDRIVE_TOKEN_FILE: tokenFile() },
      lookup: f.lookup,
      connect: f.connect,
      onRequest: (_m, template) => calls.push(template),
    });
    const client = await stdioClient(run);
    const info = textOf(
      await client.callTool({
        name: "kdrive_info",
        arguments: { drive_id: DRIVE, file_id: 12 },
      }),
    );
    expect(info).toHaveProperty("ok");
    await client.close();
    await (run.handle as { close(): Promise<void> }).close();
    expect(calls.filter((t) => t === "/3/drive/{d}/files/{f}")).toHaveLength(
      f.upstream.seen.filter((s) =>
        /^\/3\/drive\/\d+\/files\/\d+$/u.test(s.path),
      ).length,
    );
    expect(calls).toHaveLength(f.upstream.seen.length);
  });

  it("TestBR216_source_reads_no_process_env_in_src_kdrive", () => {
    expect(kdriveSources.length).toBeGreaterThan(5);
    for (const file of kdriveSources)
      walk(parse(file), (node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "process" &&
          node.name.text === "env"
        )
          throw new Error(`process.env in ${file}`);
      });
  });

  it("TestBR216_production_connect_passes_host_port_servername_and_rejectUnauthorized_true", () => {
    const source = parse("src/kdrive/production.ts");
    let found = false;
    walk(source, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "productionConnect" &&
        node.initializer &&
        ts.isArrowFunction(node.initializer)
      ) {
        const fn = node.initializer;
        expect(fn.parameters).toHaveLength(1);
        const parameter = fn.parameters[0]?.name;
        expect(parameter && ts.isIdentifier(parameter)).toBe(true);
        const body = fn.body;
        expect(ts.isCallExpression(body)).toBe(true);
        const call = body as ts.CallExpression;
        expect(ts.isIdentifier(call.expression) && call.expression.text).toBe(
          "tlsConnect",
        );
        expect(call.arguments).toHaveLength(1);
        const argument = call.arguments[0];
        expect(argument && ts.isObjectLiteralExpression(argument)).toBe(true);
        const literal = argument as ts.ObjectLiteralExpression;
        const name = (parameter as ts.Identifier).text;
        const members = literal.properties.map((property) => {
          expect(ts.isPropertyAssignment(property)).toBe(true);
          const assignment = property as ts.PropertyAssignment;
          const key = (assignment.name as ts.Identifier).text;
          const value = assignment.initializer;
          if (key === "rejectUnauthorized")
            expect(value.kind).toBe(ts.SyntaxKind.TrueKeyword);
          else {
            // host, port, servername come from the options argument.
            expect(
              ts.isPropertyAccessExpression(value) &&
                ts.isIdentifier(value.expression) &&
                value.expression.text === name &&
                value.name.text === key,
            ).toBe(true);
          }
          return key;
        });
        expect([...members].sort()).toEqual([
          "host",
          "port",
          "rejectUnauthorized",
          "servername",
        ]);
        found = true;
      }
    });
    expect(found).toBe(true);
    // The tls binding is the node:tls `connect`.
    expect(readFileSync("src/kdrive/production.ts", "utf8")).toMatch(
      /import \{ connect as tlsConnect \} from "node:tls";/u,
    );
    // No TLS option key appears in any object literal of src/kdrive.
    const forbidden = new Set([
      "ca",
      "rejectUnauthorized",
      "checkServerIdentity",
      "secureContext",
      "minVersion",
      "maxVersion",
      "ciphers",
      "secureOptions",
      "pfx",
      "secureProtocol",
      "cert",
      "key",
    ]);
    for (const file of kdriveSources)
      walk(parse(file), (node) => {
        if (ts.isObjectLiteralExpression(node))
          for (const property of node.properties) {
            const name = property.name;
            if (
              name &&
              (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
              forbidden.has(name.text) &&
              // BR-216 v2: the single pinned key in productionConnect.
              !(
                file === join("src/kdrive", "production.ts") &&
                name.text === "rejectUnauthorized" &&
                ts.isPropertyAssignment(property) &&
                property.initializer.kind === ts.SyntaxKind.TrueKeyword
              )
            )
              throw new Error(`TLS option ${name.text} in ${file}`);
          }
      });
  });

  it("TestBR216_production_connect_verifies_even_with_NODE_TLS_REJECT_UNAUTHORIZED_0", async () => {
    const { productionConnect } =
      await import("../../src/kdrive/production.js");
    const { key, cert } = selfSigned();
    const server = createTlsServer({ key, cert }, (socket) => socket.end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      const code = await new Promise<string>((resolve) => {
        const socket = productionConnect({
          host: "127.0.0.1",
          port,
          servername: API_HOST,
        });
        socket.on("secureConnect", () => {
          socket.destroy();
          resolve("connected");
        });
        socket.on("error", (error: NodeJS.ErrnoException) => {
          resolve(error.code ?? "unknown");
        });
      });
      expect(code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      const causes: string[] = [];
      const a = await adapterFor(
        {
          lookup: () =>
            Promise.resolve([{ address: PUBLIC_ADDRESS, family: 4 }]),
          connect: (options: {
            host: string;
            port: number;
            servername: string;
          }) => productionConnect({ ...options, host: "127.0.0.1", port }),
        },
        { onUnavailable: (c) => causes.push(c) },
      );
      const error = await a.dependencies
        .inspect({ driveId: DRIVE, id: 12 }, "live")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("READ_UNAVAILABLE");
      expect(brandedRead(error)).toBe(false);
      expect(causes.length).toBeGreaterThan(0);
      expect(causes.every((c) => c === "tls")).toBe(true);
    } finally {
      if (previous === undefined)
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      await new Promise<void>((r) => {
        server.close(() => {
          r();
        });
      });
    }
  });

  it("TestBR216_cli_only_calls_main_with_production_dependencies", () => {
    const source = parse("src/cli.ts");
    const statements = source.statements.filter(
      (s) => !ts.isImportDeclaration(s),
    );
    expect(statements).toHaveLength(1);
    const statement = statements[0];
    expect(statement && ts.isExpressionStatement(statement)).toBe(true);
    let expression = (statement as ts.ExpressionStatement).expression;
    if (ts.isAwaitExpression(expression)) expression = expression.expression;
    expect(ts.isCallExpression(expression)).toBe(true);
    const call = expression as ts.CallExpression;
    expect(ts.isIdentifier(call.expression) && call.expression.text).toBe(
      "main",
    );
    expect(call.arguments).toHaveLength(1);
    const argument = call.arguments[0];
    expect(
      argument &&
        ts.isCallExpression(argument) &&
        ts.isIdentifier(argument.expression)
        ? argument.expression.text
        : undefined,
    ).toBe("productionDependencies");
  });

  it("TestBR216_no_request_or_response_logging_in_src_kdrive_or_src_main", () => {
    for (const file of [...kdriveSources, "src/main.ts"])
      walk(parse(file), (node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          (node.expression.text === "console" ||
            (node.expression.text === "process" &&
              ["stdout", "stderr"].includes(node.name.text)))
        )
          throw new Error(`logging sink in ${file}`);
      });
    // The only writes in main are the fixed diagnostic, event and output lines.
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).not.toMatch(/\.write\([^)]*(headers|body|url|target|path)\b/u);
  });
});

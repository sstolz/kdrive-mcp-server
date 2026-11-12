// F-014: in-process `main(deps)` runs with in-memory streams, an injected
// signal source, a fake monotonic clock and the injected TLS transport.
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { CANARY } from "./kdrive.js";

export function tokenFile(token = CANARY): string {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-token-"));
  const file = join(directory, "token");
  writeFileSync(file, `${token}\n`);
  return file;
}

export interface MainRun {
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exits: number[];
  readonly signals: EventEmitter;
  readonly input: PassThrough;
  readonly output: PassThrough;
  readonly env: Record<string, string | undefined>;
  clock: { now: number };
  handle: unknown;
}

export async function runMain(options: {
  argv: string[];
  env: Record<string, string | undefined>;
  lookup: unknown;
  connect: unknown;
  onRequest?: (method: "GET" | "POST" | "DELETE", template: string) => void;
  /** F-016 test seam: synthetic mutators by operation kind. */
  mutators?: Record<string, unknown>;
}): Promise<MainRun> {
  const { main } = await import("../../src/main.js");
  let stdout = "",
    stderr = "";
  const input = new PassThrough(),
    output = new PassThrough();
  output.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  const signals = new EventEmitter();
  const run: MainRun = {
    stdout: () => stdout,
    stderr: () => stderr,
    exits: [],
    signals,
    input,
    output,
    env: options.env,
    clock: { now: 0 },
    handle: undefined,
  };
  run.handle = await main({
    argv: options.argv,
    env: options.env,
    stdout: { write: (text: string) => (stdout += text) },
    stderr: {
      write: (text: string, callback?: (error?: Error | null) => void) => {
        stderr += text;
        callback?.();
        return true;
      },
    },
    protocol: { input, output },
    signals: {
      on: (name, listener) => signals.on(name, listener),
      off: (name, listener) => signals.off(name, listener),
    },
    exit: (code: number) => run.exits.push(code),
    now: () => run.clock.now,
    lookup: options.lookup as never,
    connect: options.connect as never,
    ...(options.onRequest ? { onRequest: options.onRequest } : {}),
    ...(options.mutators ? { mutators: options.mutators as never } : {}),
  });
  return run;
}

/** A minimal SDK client transport over the in-memory stdio streams. */
export class StreamClientTransport {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private buffer = "";
  constructor(
    private readonly toServer: PassThrough,
    private readonly fromServer: PassThrough,
  ) {}
  start(): Promise<void> {
    this.fromServer.on("data", (data: string | Buffer) => {
      this.buffer += data.toString();
      for (;;) {
        const index = this.buffer.indexOf("\n");
        if (index < 0) break;
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        // Deliver outside the stream callback, as a real pipe would.
        const message: unknown = JSON.parse(line);
        setImmediate(() => {
          try {
            this.onmessage?.(message);
          } catch (error) {
            this.onerror?.(error as Error);
          }
        });
      }
    });
    return Promise.resolve();
  }
  send(message: unknown): Promise<void> {
    this.toServer.write(`${JSON.stringify(message)}\n`);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.onclose?.();
    return Promise.resolve();
  }
}

export async function stdioClient(run: MainRun) {
  const { Client } = await import("@modelcontextprotocol/client");
  const client = new Client({ name: "kdrive-main-test", version: "1" });
  await client.connect(new StreamClientTransport(run.input, run.output));
  return client;
}

export async function httpClient(port: number) {
  const { Client, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  const client = new Client({ name: "kdrive-main-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${String(port)}/`),
    ),
  );
  return client;
}

export function textOf(result: { content?: unknown; isError?: unknown }) {
  const text =
    (result.content as { text: string }[] | undefined)?.[0]?.text ?? "";
  return result.isError === true
    ? { error: text }
    : { ok: JSON.parse(text) as unknown };
}

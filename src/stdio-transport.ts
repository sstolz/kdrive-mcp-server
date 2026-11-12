import { PassThrough, Readable, Writable } from "node:stream";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/core";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/server";
import { contentMessages } from "./content.js";
import { isGateErrorText } from "./mutation-tools.js";

const byteLimit = 1048576;
type OutboundMessage =
  | JSONRPCMessage
  | { jsonrpc: "2.0"; id: null; error: { code: number; message: string } };
const allowedResourceErrors = new Set([
  "ACCESS_DENIED",
  "PAGINATION_UNAVAILABLE",
  "LIMIT_EXCEEDED",
  "REQUEST_TIMEOUT",
  "SERVER_BUSY",
  "INVALID_ARGUMENTS",
  "INVALID_CURSOR",
  ...contentMessages,
]);
const allowedToolErrors = new Set([
  ...allowedResourceErrors,
  "INVALID_ENCODING",
  "UNSUPPORTED_FORMAT",
  "NO_EXTRACTABLE_TEXT",
]);
function sanitized(message: OutboundMessage): OutboundMessage {
  if ("error" in message) {
    const code = message.error.code;
    const names: Record<number, string> = {
      [-32700]: "Parse error",
      [-32600]: "Invalid request",
      [-32601]: "Method not found",
      [-32602]: "Invalid params",
    };
    const error = {
      code,
      message:
        names[code] ??
        (code === -32000 && allowedResourceErrors.has(message.error.message)
          ? message.error.message
          : "Protocol error"),
    };
    if (message.id === null) return { jsonrpc: "2.0", id: null, error };
    return {
      jsonrpc: "2.0",
      ...(message.id === undefined ? {} : { id: message.id }),
      error,
    };
  }
  if ("result" in message && message.result.isError === true) {
    const content = message.result.content;
    const first: unknown = Array.isArray(content) ? content[0] : undefined;
    const text =
      typeof first === "object" &&
      first !== null &&
      "text" in first &&
      typeof first.text === "string" &&
      // F-017 BR-262: a mutation gate result carries no name or path.
      (allowedToolErrors.has(first.text) || isGateErrorText(first.text))
        ? first.text
        : "INVALID_ARGUMENTS";
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: { isError: true, content: [{ type: "text", text }] },
    };
  }
  return message;
}
interface OwnerOptions {
  diagnostic(message: string): void;
  onFailure(): void;
}
/** BR-069/070: SDK parsing/dispatch, with only narrow bounded input/output ownership. */
export function createOwnedStdioTransport(
  input: Readable,
  output: Writable,
  options: OwnerOptions,
): Transport {
  const normalized = new PassThrough();
  const sdkOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const sdk = new StdioServerTransport(normalized, sdkOutput, {
    maxBufferSize: byteLimit,
  });
  let closed = false,
    started = false,
    notified = false,
    pumping = false;
  let buffer: Buffer = Buffer.alloc(0);
  let pending: { reject(error: Error): void; cleanup(): void } | undefined;
  const internalError = () => new Error("STDIO_CLOSED");
  function fail(message: "STDIO_INPUT_FAILED\n" | "STDIO_OUTPUT_FAILED\n") {
    if (closed) return;
    options.diagnostic(message);
    options.onFailure();
    void close();
  }
  function notifyClose() {
    if (!notified) {
      notified = true;
      owner.onclose?.();
    }
  }
  function close(): Promise<void> {
    if (closed) return Promise.resolve();
    closed = true;
    input.off("data", data);
    input.off("end", ended);
    input.off("close", ended);
    input.off("error", inputError);
    if (input.listenerCount("data") === 0) input.pause();
    buffer = Buffer.alloc(0);
    const active = pending;
    pending = undefined;
    active?.cleanup();
    active?.reject(internalError());
    output.off("error", outputError);
    // Destroy without an error argument: do not create another unhandled error event.
    output.destroy();
    normalized.destroy();
    sdkOutput.destroy();
    const done = sdk.close();
    notifyClose();
    return done;
  }
  function outputError() {
    fail("STDIO_OUTPUT_FAILED\n");
  }
  function inputError() {
    fail("STDIO_INPUT_FAILED\n");
  }
  function ended() {
    void close();
  }
  async function send(message: OutboundMessage): Promise<void> {
    if (closed) throw internalError();
    let frame: string;
    try {
      frame = JSON.stringify(sanitized(message)) + "\n";
    } catch {
      fail("STDIO_OUTPUT_FAILED\n");
      throw internalError();
    }
    if (pending || Buffer.byteLength(frame) > byteLimit) {
      fail("STDIO_OUTPUT_FAILED\n");
      throw internalError();
    }
    const deadline = performance.now() + 1000;
    return new Promise<void>((resolve, reject) => {
      let callbackDone = false,
        drained = false,
        writeReturned = false,
        settled = false;
      const timer = setTimeout(() => {
        fail("STDIO_OUTPUT_FAILED\n");
      }, 1000);
      const cleanup = () => {
        clearTimeout(timer);
        output.off("drain", drain);
      };
      const finish = () => {
        if (settled || closed) return;
        if (performance.now() >= deadline) {
          fail("STDIO_OUTPUT_FAILED\n");
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- F-011: defensive runtime check kept; the value can change outside the static type flow
        if (!settled && !closed && writeReturned && callbackDone && drained) {
          settled = true;
          cleanup();
          pending = undefined;
          resolve();
        }
      };
      function drain() {
        drained = true;
        finish();
      }
      pending = {
        cleanup,
        reject: (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        },
      };
      output.once("drain", drain);
      try {
        const writable = output.write(frame, (error?: Error | null) => {
          if (settled || closed) return;
          if (error) {
            fail("STDIO_OUTPUT_FAILED\n");
            return;
          }
          callbackDone = true;
          finish();
        });
        if (writable) drained = true;
        writeReturned = true;
        finish();
      } catch {
        fail("STDIO_OUTPUT_FAILED\n");
      }
    });
  }
  function parseError(code: -32700 | -32600): Promise<void> {
    return send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code,
        message: code === -32700 ? "Parse error" : "Invalid request",
      },
    });
  }
  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      let newline: number;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- F-011: defensive runtime check kept; the value can change outside the static type flow
      while (!closed && (newline = buffer.indexOf(10)) >= 0) {
        const frame = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
              frame,
            ),
          ) as unknown;
        } catch {
          await parseError(-32700);
          continue;
        }
        const valid = JSONRPCMessageSchema.safeParse(parsed);
        if (!valid.success) {
          await parseError(-32600);
          continue;
        }
        // The original valid bytes preserve generic envelope extensions for SDK era handling.
        normalized.write(Buffer.concat([frame, Buffer.from("\n")]));
      }
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- F-011: defensive runtime check kept; the value can change outside the static type flow
      if (!closed) fail("STDIO_INPUT_FAILED\n");
    } finally {
      pumping = false;
    }
  }
  function data(chunk: Buffer | string) {
    if (closed) return;
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (buffer.length + bytes.length > byteLimit) {
      fail("STDIO_INPUT_FAILED\n");
      return;
    }
    buffer = Buffer.concat([buffer, bytes]);
    void pump();
  }
  const owner: Transport = {
    async start() {
      if (started || closed) throw internalError();
      started = true;
      sdk.onmessage = (message) => owner.onmessage?.(message);
      sdk.onerror = () => {
        if (!closed) fail("STDIO_INPUT_FAILED\n");
      };
      sdk.onclose = () => {
        void close();
      };
      await sdk.start();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- F-011: defensive runtime check kept; the value can change outside the static type flow
      if (closed) return;
      input.on("data", data);
      input.on("end", ended);
      input.on("close", ended);
      input.on("error", inputError);
      output.on("error", outputError);
      if (input.readableEnded || input.destroyed) queueMicrotask(ended);
    },
    send,
    close,
  };
  return owner;
}

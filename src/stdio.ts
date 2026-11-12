import type { Readable, Writable } from "node:stream";
import type { PolicyDependencies } from "./policy/index.js";
import { isResolvedConfiguration } from "./config.js";
import {
  CONFIGURATION_REQUIRED_MESSAGE,
  createNavigationServer,
} from "./navigation.js";
import { createOwnedStdioTransport } from "./stdio-transport.js";
import type { MutationGate } from "./mutation-gate.js";

export interface StdioNavigationOptions {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly signals?: boolean;
  readonly diagnostic?: (message: string) => void;
  readonly setExitCode?: (code: number) => void;
  /** F-016: the mutation gate; the runner closes it after the transport (BR-254). */
  readonly gate?: MutationGate;
}
/** BR-059 v2/069/070: explicit start owns streams/signals; importing never starts a session. */
export function startStdioNavigation(
  configuration: unknown,
  dependencies: PolicyDependencies,
  options: StdioNavigationOptions = {},
) {
  // BR-059 v2: the runner refuses a non-stdio configuration before it uses a stream or a dependency.
  if (
    isResolvedConfiguration(configuration) &&
    configuration.transport !== "stdio"
  )
    throw new TypeError(CONFIGURATION_REQUIRED_MESSAGE);
  const diagnostic =
    options.diagnostic ??
    ((message: string) => {
      process.stderr.write(message);
    });
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });
  const server = createNavigationServer(
    configuration,
    dependencies,
    diagnostic,
    {
      gate: options.gate,
      identity: { kind: "stdio" },
    },
  );
  let done = false;
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const transport = createOwnedStdioTransport(
    options.input ?? process.stdin,
    options.output ?? process.stdout,
    {
      diagnostic,
      onFailure: () => {
        setExitCode(1);
      },
    },
  );
  const cleanup = () => {
    if (done) return;
    done = true;
    // BR-254: the transport is closed; the gate drains, then the process exits.
    // The signal handlers stay installed during the drain so that a signal
    // cannot kill the process before in-flight outcomes are recorded.
    void (options.gate?.close() ?? Promise.resolve()).then(() => {
      process.off("SIGINT", signal);
      process.off("SIGTERM", signal);
      finish();
      // Node's process.stdout can retain an unfinished OS pipe write after destroy().
      // Only the default dedicated-process composition owns process termination.
      if (options.input === undefined && options.output === undefined)
        setImmediate(() => process.exit(process.exitCode ?? 0));
    });
  };
  const originalClose = server.server.onclose;
  server.server.onclose = () => {
    originalClose?.();
    cleanup();
  };
  async function close() {
    if (!done) {
      await server.close();
      cleanup();
    }
    await closed;
  }
  function signal() {
    void close();
  }
  if (options.signals !== false) {
    process.on("SIGINT", signal);
    process.on("SIGTERM", signal);
  }
  const ready = server.connect(transport).catch(async () => {
    if (!done) {
      diagnostic("STDIO_START_FAILED\n");
      setExitCode(1);
      await close();
    }
  });
  return Object.freeze({ server, ready, closed, close });
}

import type { Readable, Writable } from "node:stream";
import type { PolicyDependencies } from "./policy/index.js";
import { isResolvedConfiguration } from "./config.js";
import {
  CONFIGURATION_REQUIRED_MESSAGE,
  createNavigationServer,
} from "./navigation.js";
import { createOwnedStdioTransport } from "./stdio-transport.js";
import { productionExit } from "./production.js";
import {
  processStderr,
  processStdout,
  processStreamsFailed,
} from "./process-streams.js";
import type { MutationGate } from "./mutation-gate.js";

export interface StdioNavigationOptions {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly signals?: boolean;
  readonly diagnostic?: (message: string) => void;
  readonly setExitCode?: (code: number) => void;
  readonly exit?: (code: number, shutdownDeadline?: number) => void;
  /** F-016: the mutation gate; the runner closes it after the transport (BR-254). */
  readonly gate?: MutationGate;
}
/** Observe server close without extending the gate's current absolute bound. */
async function observeClose(
  closing: Promise<void>,
  deadline: () => number,
  expired: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<void>((resolve) => {
    function checkDeadline() {
      const remaining = deadline() - performance.now();
      if (remaining <= 0) {
        expired();
        resolve();
      } else timer = setTimeout(checkDeadline, remaining);
    }
    checkDeadline();
  });
  try {
    await Promise.race([closing, expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
      processStderr().stream.write(message);
    });
  const exit = options.exit ?? productionExit();
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
  const dedicated = options.input === undefined && options.output === undefined;
  let shutdownDeadline: number | undefined;
  let shutdownStarted = false;
  let failed = false;
  let closeDiagnostic = false;
  let closing: Promise<void> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  function report(message: string) {
    try {
      diagnostic(message);
    } catch {
      // Best effort: diagnostic delivery cannot replace the shutdown status.
    }
  }
  function failure() {
    if (failed) return;
    failed = true;
    if (!dedicated) setExitCode(1);
  }
  function closeFailure() {
    failure();
    if (closeDiagnostic) return;
    closeDiagnostic = true;
    report("PROCESS_CLOSE_FAILED\n");
  }
  function beginClose() {
    if (shutdownStarted) return;
    shutdownStarted = true;
    if (!options.gate?.hasCommitted)
      shutdownDeadline = performance.now() + 1000;
    gateDeadline = shutdownDeadline ?? performance.now() + 45000;
  }
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const transport = createOwnedStdioTransport(
    options.input ?? process.stdin,
    options.output ?? processStdout().stream,
    {
      diagnostic: report,
      onClosing: beginClose,
      onFailure: failure,
      onCloseFailure: closeFailure,
    },
  );
  function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    beginClose();
    // A run may commit while the transport closes. Choose the bound at gate close.
    const committed = options.gate?.hasCommitted === true;
    if (committed) shutdownDeadline = undefined;
    gateDeadline = shutdownDeadline ?? performance.now() + 45000;
    cleanupPromise = (async () => {
      try {
        await options.gate?.close(shutdownDeadline);
      } catch {
        closeFailure();
      }
    })();
    return cleanupPromise;
  }
  // One server-close observation shares the gate's absolute shutdown deadline.
  function close(): Promise<void> {
    if (closing) return closing;
    beginClose();
    closing = Promise.resolve().then(async () => {
      // Cleanup normally starts from transport onclose. A pending transport close
      // must still allow an admitted run to commit before the gate closes.
      const observed = Promise.resolve()
        .then(() => server.close())
        .catch(() => {
          closeFailure();
        });
      try {
        await observeClose(observed, () => gateDeadline, closeFailure);
        // Rejection/expiry without onclose must also start cleanup, using the
        // committed state at this point rather than the state at signal time.
        await cleanup();
      } finally {
        process.off("SIGINT", signal);
        process.off("SIGTERM", signal);
        if (dedicated) {
          exit(
            failed || processStreamsFailed()
              ? 1
              : Number(process.exitCode ?? 0),
            shutdownDeadline,
          );
        }
        finish();
      }
    });
    return closing;
  }
  let gateDeadline = Infinity;
  const originalClose = server.server.onclose;
  server.server.onclose = () => {
    try {
      originalClose?.();
    } finally {
      void cleanup();
      void close();
    }
  };
  function signal() {
    void close();
  }
  if (options.signals !== false) {
    process.on("SIGINT", signal);
    process.on("SIGTERM", signal);
  }
  const ready = server.connect(transport).catch(async () => {
    report("STDIO_START_FAILED\n");
    failure();
    await close();
  });
  return Object.freeze({ server, ready, closed, close });
}

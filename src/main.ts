import type { AddressInfo } from "node:net";
import type { Readable, Writable } from "node:stream";
import type {
  Connect,
  Lookup,
  RequestObserver,
  UnavailableClass,
} from "./kdrive/index.js";
import { PACKAGE_VERSION } from "./version.js";
import type { MutationGate, Mutator } from "./mutation-gate.js";
import {
  classifyDenyPatterns,
  type DiagnosticRootPath,
} from "./deny-root-warning.js";

type Signal = "SIGINT" | "SIGTERM";
/** BR-216: the in-process seam of the packaged CLI (D-18). */
export interface MainDependencies {
  readonly argv: readonly string[];
  /** The environment object; `KDRIVE_TOKEN` is deleted from it (BR-208). */
  readonly env: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly stdout: { write(text: string): unknown };
  /** The callback reports a write error; audit records wait for it (BR-240). */
  readonly stderr: {
    write(text: string, callback?: (error?: Error | null) => void): unknown;
    on?(event: "error", listener: (error: Error) => void): unknown;
  };
  /** Owned MCP stdio streams; absent for the dedicated process composition. */
  readonly protocol?: { readonly input: Readable; readonly output: Writable };
  readonly signals: {
    on(name: Signal, listener: () => void): unknown;
    off(name: Signal, listener: () => void): unknown;
  };
  readonly exit: (code: number, shutdownDeadline?: number) => void;
  /** Non-terminating status notification for owned stdio hosts. */
  readonly setExitCode?: (code: number) => void;
  /** Monotonic milliseconds (BR-217 windows). */
  readonly now: () => number;
  readonly lookup: Lookup;
  readonly connect: Connect;
  readonly onRequest?: RequestObserver;
  /** F-016 test seam: synthetic mutators by kind; production registers the F-017 five. */
  readonly mutators?: Readonly<Record<string, Mutator>>;
}
export interface MainHandle {
  readonly address?: AddressInfo;
  close(): Promise<void>;
}

const WINDOW_MS = 60_000;
/**
 * BR-217: at most one refused and one unavailable event per 60,000 ms of
 * monotonic time, in separate windows, with fixed text and no other field.
 */
export function createOperatorEvents(
  mode: "stdio" | "http",
  now: () => number,
  write: (line: string) => void,
) {
  let refusedAt: number | undefined, unavailableAt: number | undefined;
  const open = (last: number | undefined, at: number) =>
    last === undefined || at - last >= WINDOW_MS || at < last;
  return {
    refused(status: 401 | 403) {
      const at = now();
      if (!open(refusedAt, at)) return;
      refusedAt = at;
      write(
        mode === "stdio"
          ? `kDrive upstream refused a request (${String(status)}).\n`
          : `${JSON.stringify({ event: "kdrive_upstream_refused", status })}\n`,
      );
    },
    unavailable(cause: UnavailableClass) {
      const at = now();
      if (!open(unavailableAt, at)) return;
      unavailableAt = at;
      write(
        mode === "stdio"
          ? `kDrive upstream unavailable (${cause}).\n`
          : `${JSON.stringify({ event: "kdrive_upstream_unavailable", class: cause })}\n`,
      );
    },
  };
}

/** BR-435 / BR-027 v2: redacted, best-effort startup events in both transports. */
function warnOutsideRoots(
  stderr: MainDependencies["stderr"],
  configuration: import("./config.js").ResolvedConfiguration,
  paths: readonly DiagnosticRootPath[],
): void {
  for (const pattern_index of classifyDenyPatterns(
    configuration.deny,
    paths,
    configuration.sharedWithMe,
  ))
    try {
      stderr.write(
        `${JSON.stringify({
          event: "deny_pattern_root_warning",
          level: "warn",
          setting: "deny",
          pattern_index,
          reason: "outside_configured_roots",
        })}\n`,
      );
    } catch {
      // A diagnostic write must not change startup or skip later warnings.
    }
}

/** F-014 composition (BR-016 v2, BR-071 v2, BR-208, BR-210, BR-216). */
export async function main(
  deps: MainDependencies,
): Promise<MainHandle | undefined> {
  const args = [...deps.argv];
  if (args.length === 1 && args[0] === "--version") {
    deps.stdout.write(`${PACKAGE_VERSION}\n`);
    return undefined;
  }
  const config = await import("./config.js");
  if (args.length === 1 && args[0] === "--help") {
    deps.stdout.write(config.configurationHelp);
    return undefined;
  }
  const refuse = (error: unknown) => {
    const diagnostic =
      error instanceof config.ConfigurationError
        ? error
        : new config.ConfigurationError("INVALID_VALUE", "cli");
    deps.stderr.write(`${diagnostic.message}\n`);
    deps.exit(1);
  };
  let local: Awaited<ReturnType<typeof config.loadConfiguration>>;
  try {
    local = await config.loadConfiguration({
      argv: args,
      env: deps.env,
      ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
    });
  } catch (error) {
    refuse(error);
    return undefined;
  } finally {
    delete deps.env.KDRIVE_TOKEN;
  }
  const { createKdriveAdapter } = await import("./kdrive/index.js");
  // Operator events start with the runtime: preflight failures keep their
  // single sanitized configuration line (BR-016 v2, BR-175 v2).
  let running = false;
  const events = createOperatorEvents(local.transport, deps.now, (line) => {
    deps.stderr.write(line);
  });
  const adapter = createKdriveAdapter({
    token: local.token,
    lookup: deps.lookup,
    connect: deps.connect,
    onRequest: deps.onRequest,
    onRefused: (status) => {
      if (running) events.refused(status);
    },
    onUnavailable: (cause) => {
      if (running) events.unavailable(cause);
    },
  });
  const safe = config.withoutCredential(local);
  let preflight: Awaited<
    ReturnType<typeof config.preflightConfigurationWithDiagnosticPaths>
  >;
  try {
    preflight = await config.preflightConfigurationWithDiagnosticPaths(
      safe,
      adapter.preflight,
      config.preflightConfiguration,
    );
  } catch (error) {
    refuse(error);
    return undefined;
  }
  const { configuration, diagnosticRootPaths } = preflight;
  warnOutsideRoots(deps.stderr, configuration, diagnosticRootPaths);
  // BR-238/BR-239: the audit sink opens at startup in write and share modes only.
  const audit = await import("./audit/sink.js");
  let sink: import("./audit/sink.js").AuditSink | undefined;
  if (configuration.mode !== "read")
    try {
      sink = await audit.openAuditSink(configuration.auditLog, {
        stderr: {
          write: (text, callback) => deps.stderr.write(text, callback),
          on: (event, listener) => deps.stderr.on?.(event, listener),
        },
      });
    } catch {
      deps.stderr.write(`${audit.AUDIT_OPEN_FAILED_MESSAGE}\n`);
      deps.exit(1);
      return undefined;
    }
  const { createMutationGate, gatedDependencies } =
    await import("./mutation-gate.js");
  const { randomBytes } = await import("node:crypto");
  const gate = createMutationGate({
    mode: configuration.mode,
    sink,
    // F-017 BR-274: the production mutators unless a test seam replaces them.
    mutators: deps.mutators ?? adapter.mutators,
    random: (size) => randomBytes(size),
    clock: () => new Date(),
    now: () => performance.now(),
    diagnostic: (message) => {
      deps.stderr.write(message);
    },
  });
  // BR-256: the policy `execute` dependency is the gate executor.
  const dependencies = gatedDependencies(adapter.dependencies, gate);
  running = true;
  if (configuration.transport === "stdio")
    return stdio(deps, configuration, dependencies, gate);
  return http(deps, configuration, dependencies, gate);
}

async function stdio(
  deps: MainDependencies,
  configuration: import("./config.js").ResolvedConfiguration,
  dependencies: import("./policy/index.js").PolicyDependencies,
  gate: MutationGate,
): Promise<MainHandle> {
  const { startStdioNavigation } = await import("./stdio.js");
  const owned = deps.protocol;
  const started = startStdioNavigation(configuration, dependencies, {
    ...(owned
      ? {
          input: owned.input,
          output: owned.output,
          signals: false,
          setExitCode: deps.setExitCode ?? (() => undefined),
        }
      : { signals: true, exit: deps.exit }),
    diagnostic: (message: string) => {
      deps.stderr.write(message);
    },
    gate,
  });
  if (owned) {
    let failed = false;
    const removeSignals = () => {
      deps.signals.off("SIGINT", stop);
      deps.signals.off("SIGTERM", stop);
    };
    const closeFailure = () => {
      if (!failed) {
        failed = true;
        deps.setExitCode?.(1);
        try {
          deps.stderr.write("PROCESS_CLOSE_FAILED\n");
        } catch {
          // Best effort; an owned composition never terminates its host.
        }
      }
      removeSignals();
    };
    const stop = () => {
      void started.close().then(removeSignals, closeFailure);
    };
    deps.signals.on("SIGINT", stop);
    deps.signals.on("SIGTERM", stop);
    void started.closed.then(removeSignals, closeFailure);
  }
  await started.ready;
  return Object.freeze({ close: () => started.close() });
}

async function http(
  deps: MainDependencies,
  configuration: import("./config.js").ResolvedConfiguration,
  dependencies: import("./policy/index.js").PolicyDependencies,
  gate: MutationGate,
): Promise<MainHandle | undefined> {
  const { startHttpServer, HttpStartupError } = await import("./http/index.js");
  const proxy = await import("./auth/proxy/index.js");
  const ports = proxy.createProductionPorts();
  const authenticated =
    !configuration.insecureNoAuth && configuration.oauthMode === "proxy";
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  try {
    server = await startHttpServer({
      configuration,
      dependencies,
      ...(authenticated
        ? { upstream: proxy.createFetchUpstream({ fetch: globalThis.fetch }) }
        : {}),
      clock: ports.clock,
      randomBytes: ports.randomBytes,
      gate,
      logger: {
        event: (name, fields) => {
          deps.stderr.write(`${JSON.stringify({ event: name, ...fields })}\n`);
        },
      },
    });
  } catch (error) {
    // F-012 fixed startup messages; nothing else is echoed.
    deps.stderr.write(
      `${error instanceof HttpStartupError ? error.message : "The HTTP listener could not be started."}\n`,
    );
    await gate.close();
    deps.exit(1);
    return undefined;
  }
  let closing: Promise<void> | undefined;
  let stopping = false;
  const close = () => {
    closing ??= (async () => {
      // Keep signal handlers through transport closure and committed gate drain.
      try {
        await server.close();
      } finally {
        try {
          await gate.close();
        } finally {
          deps.signals.off("SIGINT", stop);
          deps.signals.off("SIGTERM", stop);
        }
      }
    })();
    return closing;
  };
  // BR-210 v2: repeated signals join one result and one exit request.
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void close().then(
      () => {
        deps.exit(0);
      },
      () => {
        try {
          deps.stderr.write("PROCESS_CLOSE_FAILED\n");
        } catch {
          // Best effort: failure status is independent of diagnostic delivery.
        }
        deps.exit(1);
      },
    );
  };
  deps.signals.on("SIGINT", stop);
  deps.signals.on("SIGTERM", stop);
  return Object.freeze({ address: server.address, close });
}

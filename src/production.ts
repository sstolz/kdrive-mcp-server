import { productionConnect, productionLookup } from "./kdrive/production.js";
import type { MainDependencies } from "./main.js";

/** BR-254 v2: the first exit request owns the code, deadline and flush pair. */
export function productionExit(): MainDependencies["exit"] {
  let started = false;
  return (code, shutdownDeadline) => {
    if (started) return;
    started = true;
    process.exitCode = code;
    const remaining = Math.min(
      250,
      (shutdownDeadline ?? Infinity) - performance.now(),
    );
    if (remaining <= 0) {
      process.exit(code);
      return;
    }
    let exited = false;
    let completed = 0;
    const finish = () => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      process.exit(code);
    };
    // Arm before either write, including synchronous callbacks/throws; keep ref'd.
    const timer = setTimeout(finish, remaining);
    for (const stream of [process.stdout, process.stderr]) {
      let done = false;
      const complete = () => {
        if (done) return;
        done = true;
        if (++completed === 2) finish();
      };
      // Retain one handler per stream for errors emitted after the flush callback.
      stream.on("error", complete);
      if (stream.destroyed) complete();
      else {
        try {
          stream.write("", complete);
        } catch {
          complete();
        }
      }
    }
  };
}

/** BR-216: the only production dependencies; `src/cli.ts` passes them to `main`. */
export function productionDependencies(): MainDependencies {
  return {
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    signals: {
      on: (name, listener) => process.on(name, listener),
      off: (name, listener) => process.off(name, listener),
    },
    exit: productionExit(),
    now: () => performance.now(),
    lookup: productionLookup,
    connect: productionConnect,
  };
}

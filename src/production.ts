import { productionConnect, productionLookup } from "./kdrive/production.js";
import type { MainDependencies } from "./main.js";
import { processStderr, processStdout } from "./process-streams.js";

/** BR-254 v3: first deadline wins; failure can upgrade the code until exit. */
export function productionExit(): MainDependencies["exit"] {
  let started = false;
  let requested = 0;
  let exited = false;
  return (code, shutdownDeadline) => {
    if (exited) return;
    if (!started || code === 1) requested = code;
    if (started) {
      if (code === 1) process.exitCode = 1;
      return;
    }
    started = true;
    const streams = [processStdout(), processStderr()];
    const effectiveCode = () =>
      streams.some(({ owner }) => owner.failed) ? 1 : requested;
    process.exitCode = effectiveCode();
    const remaining = Math.min(
      250,
      (shutdownDeadline ?? Infinity) - performance.now(),
    );
    if (remaining <= 0) {
      exited = true;
      process.exit(effectiveCode());
      return;
    }
    let completed = 0;
    const unsubscribers: (() => void)[] = [];
    const finish = () => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      process.exitCode = effectiveCode();
      process.exit(effectiveCode());
    };
    // Arm before either write, including synchronous callbacks/throws; keep ref'd.
    const timer = setTimeout(finish, remaining);
    for (const { stream, owner } of streams) {
      let done = false;
      const complete = () => {
        if (!exited) process.exitCode = effectiveCode();
        if (done) return;
        done = true;
        if (++completed === 2) finish();
      };
      unsubscribers.push(owner.subscribe(complete));
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
    stdout: processStdout().stream,
    stderr: processStderr().stream,
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

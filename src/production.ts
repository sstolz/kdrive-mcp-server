import { productionConnect, productionLookup } from "./kdrive/production.js";
import type { MainDependencies } from "./main.js";

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
    exit: (code) => {
      process.exitCode = code;
      // Flush pending output before ending the process.
      process.stdout.write("", () =>
        process.stderr.write("", () => process.exit(code)),
      );
    },
    now: () => performance.now(),
    lookup: productionLookup,
    connect: productionConnect,
  };
}

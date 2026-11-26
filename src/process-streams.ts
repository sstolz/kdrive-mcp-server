import type { Writable } from "node:stream";

/** BR-447/448: stream ownership outlives every session and exit flush. */
export function createProcessStreamOwner(
  stream: Writable,
  kind: "stdout" | "stderr",
) {
  let failed = false;
  const subscribers = new Set<() => void>();
  stream.on("error", (error: unknown) => {
    if (kind === "stderr") {
      try {
        if (!(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EPIPE"
        ))
          failed = true;
      } catch {
        // Even an unexpected error object's accessor cannot escape ownership.
        failed = true;
      }
    }
    for (const complete of subscribers) {
      try {
        complete();
      } catch {
        // Containment must not throw, including from a flush subscriber.
      }
    }
  });
  return {
    get failed() {
      return failed;
    },
    protocolFailure() {
      if (kind === "stdout") failed = true;
    },
    subscribe(complete: () => void) {
      subscribers.add(complete);
      return () => {
        subscribers.delete(complete);
      };
    },
  };
}
const owners = new WeakMap<
  Writable,
  ReturnType<typeof createProcessStreamOwner>
>();
function own(stream: Writable, kind: "stdout" | "stderr") {
  let owner = owners.get(stream);
  if (!owner) {
    owner = createProcessStreamOwner(stream, kind);
    owners.set(stream, owner);
  }
  return { stream, owner };
}
export function processStdout() {
  return own(process.stdout, "stdout");
}
export function processStderr() {
  return own(process.stderr, "stderr");
}
export function protocolWriteFailed(stream: Writable) {
  owners.get(stream)?.protocolFailure();
}
export function processStreamsFailed() {
  return processStdout().owner.failed || processStderr().owner.failed;
}

import type { AuditIdentity } from "./audit/sink.js";

export const MAX_ACTIVE_EXTRACTIONS = 2;
export const MAX_WAITING_EXTRACTIONS = 4;
export const MAX_ACTIVE_EXTRACTIONS_PER_IDENTITY = 1;
export const MAX_WAITING_EXTRACTIONS_PER_IDENTITY = 1;

export class ExtractionBusy extends Error {}

export interface ExtractionPermit {
  release(): void;
  detach(): void;
  workerExited(): void;
}

interface Waiter {
  readonly key: string;
  readonly alive: () => void;
  readonly leave: () => void;
  readonly resolve: (permit: ExtractionPermit) => void;
  readonly reject: (error: unknown) => void;
}

// One parent-process owner for HTTP, stdio and embedded controllers. Neither
// sessions nor runtimes can replace/reset it. Tagged tuples preserve exact keys.
const active = new Map<string, { detached: boolean }>();
const waiting: Waiter[] = [];
const diagnostic = (line: string) => {
  try {
    process.stderr.write(line, () => {});
  } catch {
    // Best effort, with no callback/drain wait or retry, even after session close.
  }
};

function remove(waiter: Waiter) {
  const at = waiting.indexOf(waiter);
  if (at < 0) return false;
  waiting.splice(at, 1);
  waiter.leave();
  return true;
}

function retire() {
  for (const waiter of [...waiting]) {
    try {
      waiter.alive();
    } catch (error) {
      if (remove(waiter)) waiter.reject(error);
    }
  }
}

function grant(key: string): ExtractionPermit {
  const state = { detached: false };
  active.set(key, state);
  let cleaned = false,
    exited = false,
    released = false;
  const release = () => {
    if (released || !cleaned || (state.detached && !exited)) return;
    released = true;
    active.delete(key);
    drain();
    if (state.detached)
      diagnostic("Detached extraction worker exited; capacity released.\n");
  };
  return {
    release() {
      cleaned = true;
      release();
    },
    workerExited() {
      exited = true;
      release();
    },
    detach() {
      if (released || exited || state.detached) return;
      state.detached = true;
      retire();
      for (const waiter of [...waiting]) {
        if (waiter.key === key && remove(waiter))
          waiter.reject(new ExtractionBusy());
      }
      diagnostic(
        "Extraction worker detached; capacity remains charged until exit.\n",
      );
    },
  };
}

function drain() {
  retire();
  while (active.size < MAX_ACTIVE_EXTRACTIONS) {
    const waiter = waiting.find((entry) => !active.has(entry.key));
    if (!waiter) return;
    remove(waiter);
    waiter.resolve(grant(waiter.key));
  }
}

/** BR-423–425: wait inside the invocation; its abort timer owns the deadline. */
export async function acquireExtraction(
  identity: AuditIdentity | undefined,
  signal: AbortSignal,
  alive: () => void,
): Promise<ExtractionPermit> {
  alive();
  drain();
  const key = JSON.stringify(
    identity?.kind === "oauth"
      ? ["oauth", identity.iss, identity.sub]
      : [identity?.kind ?? "stdio"],
  );
  if (
    active.get(key)?.detached ||
    (active.size === MAX_ACTIVE_EXTRACTIONS &&
      [...active.values()].every((permit) => permit.detached)) ||
    waiting.some((waiter) => waiter.key === key)
  )
    throw new ExtractionBusy();
  if (active.size < MAX_ACTIVE_EXTRACTIONS && !active.has(key))
    return grant(key);
  if (waiting.length >= MAX_WAITING_EXTRACTIONS) throw new ExtractionBusy();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      try {
        alive();
      } catch (error) {
        if (remove(waiter)) waiter.reject(error);
      }
    };
    const waiter: Waiter = {
      key,
      alive,
      resolve,
      reject,
      leave: () => {
        signal.removeEventListener("abort", cancel);
      },
    };
    waiting.push(waiter);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

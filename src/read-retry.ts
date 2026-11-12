/** Trusted normalized pre-body failures, never inferred from arbitrary thrown properties. */
const statuses = new WeakMap<object, number>();
export class ReadFailure extends Error {
  constructor(status: number) {
    super("READ_UNAVAILABLE");
    if (Number.isInteger(status) && status >= 100 && status <= 599)
      statuses.set(this, status);
  }
}
// BR-088/090: WeakMap lookup never invokes thrown-object hooks.
export function retryableRead(value: unknown): boolean {
  const status =
    (typeof value === "object" && value !== null) || typeof value === "function"
      ? statuses.get(value)
      : undefined;
  return (
    status === 429 || (status !== undefined && status >= 500 && status <= 599)
  );
}
export function brandedRead(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    statuses.has(value)
  );
}

export function retryWait(
  signal: AbortSignal,
  milliseconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("READ_UNAVAILABLE"));
      return;
    }
    const finish = (cancelled: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (cancelled) reject(new Error("READ_UNAVAILABLE"));
      else resolve();
    };
    const abort = () => {
      finish(true);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

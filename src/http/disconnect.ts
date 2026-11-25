/**
 * F-053 BR-166 v2, D-4: the HTTP disconnect signal of each SDK request, keyed
 * by the very `Request` the SDK transport receives (`ctx.http.req`). Stdio
 * requests have no entry, so they have no disconnect signal.
 */
const disconnects = new WeakMap<Request, AbortSignal>();

/** Registers `signal` as the disconnect signal of the SDK request `request`. */
export function registerDisconnect(
  request: Request,
  signal: AbortSignal,
): void {
  disconnects.set(request, signal);
}

/** The disconnect signal registered for `request`, or `undefined` (stdio). */
export function disconnectSignalOf(
  request: Request | undefined,
): AbortSignal | undefined {
  return request === undefined ? undefined : disconnects.get(request);
}

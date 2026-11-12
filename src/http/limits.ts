/** BR-160 body limits. */
export const MCP_BODY_LIMIT = 262_144;
export const OAUTH_BODY_LIMIT = 32_768;
/** BR-158: the longest bearer token the verifier is called with. */
export const MAX_TOKEN_BYTES = 4096;
/** BR-169: the longest request target. */
export const MAX_TARGET_BYTES = 8192;
/** BR-161 and BR-162 windows. */
export const IDENTITY_LIMIT = 120;
export const IDENTITY_WINDOW_MS = 60_000;
/** BR-164 session bounds. */
export const IDLE_MS = 1_800_000;
export const LIFETIME_MS = 86_400_000;
export const SESSIONS_PER_IDENTITY = 8;
export const SESSIONS_TOTAL = 64;

/** BR-162: process-wide windows keyed by route name. */
export const ROUTE_WINDOWS: Readonly<
  Record<string, { limit: number; windowMs: number }>
> = {
  register: { limit: 30, windowMs: 3_600_000 },
  authorize: { limit: 30, windowMs: 60_000 },
  consent: { limit: 30, windowMs: 60_000 },
  callback: { limit: 30, windowMs: 60_000 },
  token: { limit: 60, windowMs: 60_000 },
};

/** F-021 BR-325: the two process-wide `/healthz` windows. */
export const HEALTH_PATH = "/healthz";
export const HEALTH_LIMIT = 120;
export const HEALTH_WINDOW_MS = 60_000;

interface Window {
  start: number;
  count: number;
}

/**
 * A window for a key starts at the first counted event while none is open and
 * lasts `windowMs`; a request is refused when the window already holds `limit`
 * events. Refused requests are not counted.
 */
export class WindowLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts the event, or returns the `Retry-After` seconds when refused. */
  take(key: string, now: number): number | undefined {
    let window = this.windows.get(key);
    if (window && now >= window.start + this.windowMs) window = undefined;
    if (!window) {
      this.windows.set(key, { start: now, count: 1 });
      return undefined;
    }
    if (window.count >= this.limit)
      return Math.ceil((window.start + this.windowMs - now) / 1000);
    window.count++;
    return undefined;
  }
}

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

/** BR-162 v3: per-peer windows and independent global ceilings. */
export const ROUTE_WINDOWS: Readonly<
  Record<string, { limit: number; global: number; windowMs: number }>
> = {
  register: { limit: 30, global: 60, windowMs: 3_600_000 },
  authorize: { limit: 30, global: 60, windowMs: 60_000 },
  consent: { limit: 30, global: 60, windowMs: 60_000 },
  callback: { limit: 30, global: 60, windowMs: 60_000 },
  token: { limit: 60, global: 1200, windowMs: 60_000 },
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

export interface AdmissionRefusal {
  window: "peer" | "global";
  retryAfter: number;
}
export interface AdmissionStats {
  entries: number;
  peerRequests: number;
  globalRequests: number;
}

/** BR-162 v3: check both windows before mutating either one. */
export class OAuthWindowLimiter {
  private readonly peers = new Map<string, Window>();
  private globalWindow: Window | undefined;

  constructor(
    private readonly peerLimit: number,
    private readonly globalLimit: number,
    private readonly windowMs: number,
  ) {}

  private live(window: Window | undefined, now: number): Window | undefined {
    return window && now < window.start + this.windowMs ? window : undefined;
  }

  private refusal(
    window: Window | undefined,
    limit: number,
    now: number,
  ): number | undefined {
    return window && window.count >= limit
      ? Math.ceil((window.start + this.windowMs - now) / 1000)
      : undefined;
  }

  take(peer: string, now: number): AdmissionRefusal | undefined {
    const current = this.live(this.peers.get(peer), now);
    const peerWait = this.refusal(current, this.peerLimit, now);
    if (peerWait !== undefined) return { window: "peer", retryAfter: peerWait };
    const global = this.live(this.globalWindow, now);
    const globalWait = this.refusal(global, this.globalLimit, now);
    if (globalWait !== undefined)
      return { window: "global", retryAfter: globalWait };
    if (current) current.count++;
    else {
      for (const [key, window] of this.peers)
        if (!this.live(window, now)) this.peers.delete(key);
      this.peers.set(peer, { start: now, count: 1 });
    }
    if (global) global.count++;
    else this.globalWindow = { start: now, count: 1 };
    return undefined;
  }

  /** Aggregate test evidence only; never exposes peer keys. */
  stats(): AdmissionStats {
    return {
      entries: this.peers.size,
      peerRequests: [...this.peers.values()].reduce(
        (sum, window) => sum + window.count,
        0,
      ),
      globalRequests: this.globalWindow?.count ?? 0,
    };
  }
}

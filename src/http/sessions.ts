import type {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import {
  IDLE_MS,
  LIFETIME_MS,
  SESSIONS_PER_IDENTITY,
  SESSIONS_TOTAL,
} from "./limits.js";
import type { HttpEvent } from "./types.js";

export type CloseReason =
  "deleted" | "idle" | "lifetime" | "evicted" | "shutdown";

/** Settles a request whose session closed while it was in flight (BR-164). */
export const GONE: unique symbol = Symbol("session-gone");

export interface Session {
  readonly id: string;
  readonly identity: string;
  readonly server: McpServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
  readonly createdAt: number;
  lastUsed: number;
  closed: boolean;
  readonly gone: Promise<typeof GONE>;
  settle(): void;
}

type Emit = (name: HttpEvent, fields: Record<string, string | number>) => void;

/** Closes a session's transport and its `McpServer`; never rejects. */
export async function closeBoth(
  server: McpServer,
  transport: WebStandardStreamableHTTPServerTransport,
): Promise<void> {
  await server.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
}

/** BR-163/BR-164: registered sessions bound to an identity, with their bounds. */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  /** Creations in progress; counted toward the process bound (BR-164). */
  creating = 0;

  constructor(
    private readonly emit: Emit,
    private readonly safeEmit: Emit,
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  /** True when no further initialize may start (BR-164). */
  get full(): boolean {
    return this.sessions.size + this.creating >= SESSIONS_TOTAL;
  }

  /** The session when it exists and is bound to `identity`. */
  find(id: string, identity: string): Session | undefined {
    const session = this.sessions.get(id);
    return session?.identity === identity ? session : undefined;
  }

  /** Closes expired sessions before a lookup or a creation. */
  async sweep(now: number): Promise<void> {
    const closing: Array<Promise<void>> = [];
    for (const session of [...this.sessions.values()]) {
      const idleAt = session.lastUsed + IDLE_MS;
      const lifeAt = session.createdAt + LIFETIME_MS;
      if (now >= Math.min(idleAt, lifeAt))
        closing.push(
          this.close(session, idleAt <= lifeAt ? "idle" : "lifetime"),
        );
    }
    await Promise.all(closing);
  }

  /**
   * Registers a session, evicting its identity's least recently used one when
   * the identity already holds eight. The logger's `session_opened` may throw;
   * then nothing is evicted and nothing is registered.
   */
  register(session: Session, protocol: string): void {
    const own = [...this.sessions.values()].filter(
      (entry) => entry.identity === session.identity,
    );
    let victim: Session | undefined;
    if (own.length >= SESSIONS_PER_IDENTITY)
      for (const entry of own)
        if (!victim || entry.lastUsed < victim.lastUsed) victim = entry;
    // The emit may throw: nothing is evicted or registered before it succeeds.
    // Both events report the net count once the swap is done (BR-167), which
    // never exceeds the per-identity or global cap.
    this.emit("session_opened", {
      count: this.sessions.size + (victim ? 0 : 1),
      requested_protocol: protocol,
    });
    this.sessions.set(session.id, session);
    if (victim) void this.close(victim, "evicted");
  }

  /** Removes the session, settles its in-flight requests and closes it. */
  async close(session: Session, reason: CloseReason): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(session.id);
    this.safeEmit("session_closed", { reason, count: this.sessions.size });
    session.settle();
    await closeBoth(session.server, session.transport);
  }

  async closeAll(reason: CloseReason): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => this.close(session, reason)),
    );
  }
}

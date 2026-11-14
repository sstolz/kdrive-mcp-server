import type { ResolvedConfiguration } from "../config.js";
import type { PolicyDependencies } from "../policy/index.js";
import type {
  OAuthStateStorePort,
  ProxyEvent,
  UpstreamOidcPort,
} from "../auth/proxy/index.js";
import type { MutationGate } from "../mutation-gate.js";
import type { ClientMetadataFetchOptions } from "../auth/proxy/client-metadata-fetch.js";

/** BR-167: the events this feature adds to the proxy's own. */
export type HttpEvent = "request_refused" | "session_opened" | "session_closed";

export interface HttpLogger {
  event(
    name: HttpEvent | ProxyEvent,
    fields: Record<string, string | number>,
  ): void;
}

export interface HttpHandlerOptions {
  /** Transport `http`; refused otherwise (BR-152). */
  configuration: ResolvedConfiguration;
  /** F-005 navigation dependencies. */
  dependencies: PolicyDependencies;
  /** Required when authenticated, refused when insecure (BR-152). */
  upstream?: UpstreamOidcPort;
  clock: () => Date;
  randomBytes: (size: number) => Uint8Array;
  logger?: HttpLogger;
  /** F-016: the process mutation gate shared by every session. */
  gate?: MutationGate;
  /** F-019 test seam: the OAuth state store's I/O port (BR-293–BR-299). */
  oauthStatePort?: Partial<OAuthStateStorePort>;
  /**
   * F-028 test and rehearsal seam: the CIMD fetch port's resolver, DNS
   * server list, address policy and CA list. Production passes none (AC-13).
   */
  clientMetadataSeam?: ClientMetadataFetchOptions;
}

export interface HttpHandler {
  handle(request: Request, target: string): Promise<Response>;
  /** BR-167: the route name a request target matches, `unknown` otherwise. */
  routeOf(target: string): RouteName;
  /** BR-169 v2 step (2): closes the sessions; the OAuth state store stays open. */
  close(): Promise<void>;
  /**
   * BR-304: closes the OAuth state store the handler opened, at most once;
   * later calls do nothing. Called by the HTTP server's `close()` step (6).
   */
  closeStore(): void;
}

export type RouteName =
  | "mcp"
  | "prm"
  | "as_metadata"
  | "register"
  | "authorize"
  | "consent"
  | "callback"
  | "token"
  | "health"
  | "unknown";

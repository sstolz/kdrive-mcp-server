export type HttpStartupCode =
  | "CONFIGURATION_UNSUPPORTED"
  | "UPSTREAM_PORT_UNEXPECTED"
  | "OAUTH_MODE_UNSUPPORTED"
  | "PUBLIC_URL_PATH_REQUIRED"
  | "UPSTREAM_PORT_REQUIRED"
  | "INSECURE_BIND_REFUSED"
  | "LISTEN_FAILED"
  | OAuthStateCode;

/** BR-297: the OAuth state store refusals. */
export type OAuthStateCode =
  | "OAUTH_STATE_UNAVAILABLE"
  | "OAUTH_STATE_LOCKED"
  | "OAUTH_STATE_CORRUPT"
  | "OAUTH_STATE_VERSION"
  | "OAUTH_STATE_MISMATCH";

// BR-152/BR-153: fixed messages; none echoes a configuration value or a system error.
const messages: Record<HttpStartupCode, string> = {
  CONFIGURATION_UNSUPPORTED:
    "The HTTP server requires a resolved HTTP configuration.",
  UPSTREAM_PORT_UNEXPECTED:
    "An upstream OIDC port is refused in insecure mode.",
  OAUTH_MODE_UNSUPPORTED: "The HTTP server supports only the proxy OAuth mode.",
  PUBLIC_URL_PATH_REQUIRED:
    "The public URL of an authenticated server requires a path.",
  UPSTREAM_PORT_REQUIRED:
    "Authenticated proxy mode requires an upstream OIDC port.",
  INSECURE_BIND_REFUSED: "The insecure listener is not bound to 127.0.0.1.",
  LISTEN_FAILED: "The HTTP listener could not be started.",
  // BR-297: the Contract details lines of F-019.
  OAUTH_STATE_UNAVAILABLE:
    "The OAuth state file could not be opened or is not private.",
  OAUTH_STATE_LOCKED: "The OAuth state file is in use by another process.",
  OAUTH_STATE_CORRUPT: "The OAuth state file is not a valid OAuth state file.",
  OAUTH_STATE_VERSION: "The OAuth state file was written by a newer version.",
  OAUTH_STATE_MISMATCH:
    "The OAuth state file belongs to another issuer, audience or upstream.",
};

/** BR-152/BR-153: a startup refusal raised before any request is served. */
export class HttpStartupError extends Error {
  constructor(readonly code: HttpStartupCode) {
    super(messages[code]);
    this.name = "HttpStartupError";
  }
}

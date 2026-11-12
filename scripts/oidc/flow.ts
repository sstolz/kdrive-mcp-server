import { createHash } from "node:crypto";
import type { Capability } from "../../src/auth/verdict.ts";

export type RandomBytes = (size: number) => Uint8Array;
export type ClientAuthentication = "basic" | "post" | "public" | "stop";

const LOOPBACK = /^(?:127\.0\.0\.1|\[::1\]|localhost):(\d{1,5})$/u;

/**
 * BR-096: an `http` loopback redirect URI without userinfo whose authority, as
 * written, names `127.0.0.1`, `[::1]` or `localhost` with a port other than 80.
 */
export function parseRedirectUri(value: string): URL | undefined {
  if (/[\p{Cc}\s]/u.test(value)) return undefined;
  const authority = /^http:\/\/([^/?#]*)/u.exec(value)?.[1];
  const port = authority === undefined ? undefined : LOOPBACK.exec(authority);
  if (!port || Number(port[1]) === 80) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.port !== "" ? url : undefined;
  } catch {
    return undefined;
  }
}

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export interface AuthorizationRequest {
  url: string;
  verifier: string;
  challenge: string;
  state: string;
  nonce: string;
}

/** BR-096: authorization-code request with PKCE S256, state, nonce and resource. */
export function createAuthorizationRequest(
  input: {
    endpoint: string;
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    resource: string;
  },
  random: RandomBytes,
): AuthorizationRequest {
  const verifier = encode(random(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = encode(random(32));
  const nonce = encode(random(32));
  const url = new URL(input.endpoint);
  const parameters: Array<[string, string]> = [
    ["response_type", "code"],
    ["client_id", input.clientId],
    ["redirect_uri", input.redirectUri],
    ["scope", ["openid", ...input.scopes].join(" ")],
    ["state", state],
    ["nonce", nonce],
    ["code_challenge", challenge],
    ["code_challenge_method", "S256"],
    ["resource", input.resource],
  ];
  for (const [name, value] of parameters) url.searchParams.set(name, value);
  return { url: url.href, verifier, challenge, state, nonce };
}

export type RedirectResult =
  | { ok: true; code: string; iss: string | undefined }
  | { ok: false; failure: string; error?: string };

/** BR-097: validates one pasted redirect URL against the issued request. */
export function readRedirect(
  pasted: string,
  redirectUri: URL,
  state: string,
): RedirectResult {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return { ok: false, failure: "redirect URL invalid" };
  }
  if (
    url.origin !== redirectUri.origin ||
    url.pathname !== redirectUri.pathname
  )
    return { ok: false, failure: "redirect target mismatch" };
  if (url.searchParams.get("state") !== state)
    return { ok: false, failure: "state mismatch" };
  const error = url.searchParams.get("error");
  if (error !== null)
    return { ok: false, failure: "authorization error", error };
  const code = url.searchParams.get("code");
  if (!code) return { ok: false, failure: "authorization code missing" };
  return { ok: true, code, iss: url.searchParams.get("iss") ?? undefined };
}

/** BR-097: the token-endpoint client authentication for this run. */
export function clientAuthentication(
  hasSecret: boolean,
  basic: Capability,
  post: Capability,
): ClientAuthentication {
  if (!hasSecret) return "public";
  if (basic === "yes" || basic === "unknown") return "basic";
  return post === "yes" ? "post" : "stop";
}

/** RFC 6749 §2.3.1: form-urlencode each credential before Base64. */
const formEncode = (value: string) =>
  new URLSearchParams([["", value]]).toString().slice(1);

/** BR-097: the authorization-code token request body and headers. */
export function tokenRequest(input: {
  code: string;
  redirectUri: string;
  verifier: string;
  resource: string;
  clientId: string;
  secret: string | undefined;
  method: Exclude<ClientAuthentication, "stop">;
}): { body: URLSearchParams; headers: Record<string, string> } {
  const body = new URLSearchParams([
    ["grant_type", "authorization_code"],
    ["code", input.code],
    ["redirect_uri", input.redirectUri],
    ["code_verifier", input.verifier],
    ["resource", input.resource],
  ]);
  const headers: Record<string, string> = {};
  if (input.method === "basic") {
    const credentials = `${formEncode(input.clientId)}:${formEncode(input.secret ?? "")}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
  } else {
    body.set("client_id", input.clientId);
    if (input.method === "post") body.set("client_secret", input.secret ?? "");
  }
  return { body, headers };
}

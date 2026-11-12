import { compactVerify, importJWK, type JWK } from "jose";

/** BR-098: the only accepted JWS algorithms. */
export const ALLOWED_ALGORITHMS: readonly string[] = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "EdDSA",
  "Ed25519",
];

/** BR-099: header `typ` values that an access token may carry. */
const ACCESS_TOKEN_TYPES = [
  "jwt",
  "at+jwt",
  "application/jwt",
  "application/at+jwt",
];
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k"];

export type RejectionReason =
  | "malformed"
  | "algorithm"
  | "signature"
  | "issuer"
  | "audience"
  | "expired"
  | "not-yet-valid"
  | "id-token"
  | "identity";

export type ValidationResult =
  | { ok: true; identity: { iss: string; sub: string } }
  | { ok: false; status: 401 | 403; reason: RejectionReason };

export type AccessTokenValidator = (
  token: string,
  now: Date,
) => Promise<ValidationResult>;

export interface ValidatorOptions {
  issuer: string;
  audience: string;
  jwks: unknown;
  allowedSubjects: ReadonlyArray<{ iss: string; sub: string }>;
  allowedEmails: readonly string[];
  /**
   * BR-100 v2: set for proxy-issued tokens. The token must carry
   * `upstream_iss` equal to it, and identities are (upstreamIssuer, sub).
   */
  upstreamIssuer?: string;
}

/** A fixed-message configuration error; it never echoes configuration values. */
export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usableKey(key: Record<string, unknown>): boolean {
  const typeOk =
    key.kty === "RSA" ||
    (key.kty === "EC" && (key.crv === "P-256" || key.crv === "P-384")) ||
    (key.kty === "OKP" && key.crv === "Ed25519");
  const useOk = key.use === undefined || key.use === "sig";
  const opsOk =
    key.key_ops === undefined ||
    (Array.isArray(key.key_ops) && key.key_ops.includes("verify"));
  const algOk =
    key.alg === undefined ||
    (typeof key.alg === "string" && ALLOWED_ALGORITHMS.includes(key.alg));
  return typeOk && useOk && opsOk && algOk;
}

/**
 * BR-107: the usable verification keys of a JWKS. A set that contains any
 * private member is unusable as a whole.
 */
export function usableKeys(jwks: unknown): JWK[] {
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) return [];
  const keys: unknown[] = jwks.keys;
  const hasPrivate = keys.some(
    (key) => isRecord(key) && PRIVATE_MEMBERS.some((member) => member in key),
  );
  if (hasPrivate) return [];
  return keys.filter(isRecord).filter(usableKey);
}

/**
 * BR-098: `https`, lowercase scheme and host, no default port, no userinfo,
 * query or fragment, and no trailing slash unless the path is `/`.
 */
export function isCanonicalAudience(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || value.includes("?") || value.includes("#"))
    return false;
  if (url.username || url.password) return false;
  if (url.pathname === "/")
    return url.href === value || url.href === `${value}/`;
  return url.href === value && !value.endsWith("/");
}

function segmentJson(segment: string): Record<string, unknown> | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(segment, "base64url"),
    );
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Decodes a compact JWS without verifying it; undefined when not one. */
export function decodeCompact(
  token: string,
):
  | { header: Record<string, unknown>; payload: Record<string, unknown> }
  | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]*$/u.test(parts[2] ?? "."))
    return undefined;
  const header = segmentJson(parts[0] ?? "");
  const payload = segmentJson(parts[1] ?? "");
  return header && payload ? { header, payload } : undefined;
}

function keyMatches(key: JWK, alg: string, kid: unknown): boolean {
  if (key.alg !== undefined && key.alg !== alg) return false;
  if (typeof kid === "string" && key.kid !== undefined && key.kid !== kid)
    return false;
  if (/^(RS|PS)/u.test(alg)) return key.kty === "RSA";
  if (alg === "ES256") return key.kty === "EC" && key.crv === "P-256";
  if (alg === "ES384") return key.kty === "EC" && key.crv === "P-384";
  return key.kty === "OKP";
}

async function verifies(token: string, key: JWK, alg: string) {
  try {
    const imported = await importJWK(key, alg);
    await compactVerify(token, imported, { algorithms: [alg] });
    return true;
  } catch {
    return false;
  }
}

function idTokenShaped(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  if ("nonce" in payload) return true;
  if (header.typ === undefined) return false;
  return (
    typeof header.typ !== "string" ||
    !ACCESS_TOKEN_TYPES.includes(header.typ.toLowerCase())
  );
}

function audienceMatches(aud: unknown, audience: string): boolean {
  return aud === audience || (Array.isArray(aud) && aud.includes(audience));
}

/**
 * BR-133: verifies a compact JWS against the keys selected by `kid`, `alg`
 * and key type, as BR-098 does for access tokens.
 */
export async function verifiesWithKeys(
  token: string,
  keys: readonly JWK[],
  alg: string,
  kid: unknown,
): Promise<boolean> {
  for (const key of keys.filter((key) => keyMatches(key, alg, kid)))
    if (await verifies(token, key, alg)) return true;
  return false;
}

/** BR-133: whether a usable key is selected for this `alg` and `kid`. */
export function hasMatchingKey(
  keys: readonly JWK[],
  alg: string,
  kid: unknown,
): boolean {
  return keys.some((key) => keyMatches(key, alg, kid));
}

/**
 * BR-098–BR-100: validates an access token for this resource and authorizes
 * its identity. Checks run in the order fixed by F-008 v1.
 */
export function createAccessTokenValidator(
  options: ValidatorOptions,
): AccessTokenValidator {
  if (!isCanonicalAudience(options.audience))
    throw new AuthConfigurationError("The audience is not canonical.");
  if (!options.allowedSubjects.length && !options.allowedEmails.length)
    throw new AuthConfigurationError("No subject or email allowlist entry.");
  const { issuer, audience, upstreamIssuer } = options;
  const identityIssuer = upstreamIssuer ?? issuer;
  const keys = usableKeys(options.jwks);
  const subjects = [...options.allowedSubjects];
  const emails = [...options.allowedEmails];
  const reject = (
    reason: RejectionReason,
    status: 401 | 403 = 401,
  ): ValidationResult => ({ ok: false, status, reason });

  return async (token, now) => {
    const decoded = decodeCompact(token);
    if (!decoded || decoded.header.crit !== undefined)
      return reject("malformed");
    const { header, payload } = decoded;
    const alg = header.alg;
    if (typeof alg !== "string" || !ALLOWED_ALGORITHMS.includes(alg))
      return reject("algorithm");
    if (idTokenShaped(header, payload)) return reject("id-token");
    if (!(await verifiesWithKeys(token, keys, alg, header.kid)))
      return reject("signature");
    if (payload.iss !== issuer) return reject("issuer");
    if (upstreamIssuer !== undefined && payload.upstream_iss !== upstreamIssuer)
      return reject("issuer");
    if (!audienceMatches(payload.aud, audience)) return reject("audience");
    const sub = payload.sub;
    if (typeof sub !== "string" || sub === "") return reject("malformed");
    const nowSeconds = now.getTime() / 1000;
    // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- F-011: the negated comparison is NaN-safe; the opposite operator would accept NaN
    if (typeof payload.exp !== "number" || !(payload.exp > nowSeconds))
      return reject("expired");
    if (
      payload.nbf !== undefined &&
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- F-011: the negated comparison is NaN-safe; the opposite operator would accept NaN
      (typeof payload.nbf !== "number" || !(payload.nbf <= nowSeconds))
    )
      return reject("not-yet-valid");
    const bySubject = subjects.some(
      (entry) => entry.iss === identityIssuer && entry.sub === sub,
    );
    const byEmail =
      typeof payload.email === "string" &&
      emails.includes(payload.email) &&
      payload.email_verified === true;
    if (!bySubject && !byEmail) return reject("identity", 403);
    return { ok: true, identity: { iss: identityIssuer, sub } };
  };
}

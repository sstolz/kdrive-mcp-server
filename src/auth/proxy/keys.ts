import { createHash, createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT, type JWK } from "jose";
import { AuthConfigurationError } from "../access-token.js";

/** BR-124: the single fixed message; it never echoes key material. */
export const SIGNING_KEY_ERROR =
  "The OAuth signing key must be one PKCS#8 PEM EC P-256 private key.";

const PEM =
  /^\s*-----BEGIN PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PRIVATE KEY-----\s*$/u;

export interface SigningKey {
  privateKey: KeyObject;
  publicJwk: JWK;
  kid: string;
}

function parse(bytes: Uint8Array): KeyObject {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!PEM.test(text)) throw new Error("format");
  const key = createPrivateKey({ key: text, format: "pem" });
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new Error("type");
  return key;
}

/** BR-124: parses the signing key and derives its RFC 7638 `kid`. */
export function loadSigningKey(bytes: Uint8Array): SigningKey {
  let privateKey: KeyObject;
  try {
    privateKey = parse(bytes);
  } catch {
    throw new AuthConfigurationError(SIGNING_KEY_ERROR);
  }
  const { crv = "", x = "", y = "" } = privateKey.export({ format: "jwk" });
  const kid = createHash("sha256")
    .update(JSON.stringify({ crv, kty: "EC", x, y }))
    .digest("base64url");
  return {
    privateKey,
    kid,
    publicJwk: { kty: "EC", crv, x, y, kid, alg: "ES256", use: "sig" },
  };
}

/** BR-138: signs an access token with the configured key. */
export function signAccessToken(
  key: SigningKey,
  payload: Record<string, unknown>,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: key.kid })
    .sign(key.privateKey);
}

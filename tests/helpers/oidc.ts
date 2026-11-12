import {
  CompactSign,
  SignJWT,
  base64url,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";

// Synthetic values only: no real issuer, token, code or secret is used.
export const issuer = "https://idp.test";
export const audience = "https://mcp.test/mcp";
export const clientId = "synthetic-client";
export const now = new Date("2026-11-02T12:00:00Z");
export const nowSeconds = Math.floor(now.getTime() / 1000);

export interface SigningKey {
  privateKey: CryptoKey;
  jwk: JWK;
  alg: string;
}

export async function signingKey(
  alg = "ES256",
  kid = "k1",
): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(alg, {
    extractable: true,
  });
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid }, alg };
}

export function claims(extra: JWTPayload = {}): JWTPayload {
  return {
    iss: issuer,
    aud: audience,
    sub: "user-1",
    exp: nowSeconds + 60,
    ...extra,
  };
}

export async function sign(
  key: SigningKey,
  payload: JWTPayload,
  header: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: key.alg, kid: key.jwk.kid ?? "", ...header })
    .sign(key.privateKey);
}

export async function signWithCrit(
  key: SigningKey,
  payload: JWTPayload,
): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({
      alg: key.alg,
      kid: key.jwk.kid ?? "",
      crit: ["urn:synthetic"],
      "urn:synthetic": true,
    })
    .sign(key.privateKey, { crit: { "urn:synthetic": true } });
}

export function unsigned(
  header: Record<string, unknown>,
  payload: JWTPayload,
  signature = "",
): string {
  const encode = (value: unknown) =>
    base64url.encode(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(header)}.${encode(payload)}.${signature}`;
}

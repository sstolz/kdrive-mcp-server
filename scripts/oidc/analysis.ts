import {
  createAccessTokenValidator,
  decodeCompact,
  type ValidationResult,
} from "../../src/auth/access-token.ts";
import type { Capability } from "../../src/auth/verdict.ts";

/** BR-101: the fixed synthetic subject of the negative identity check. */
export const NEGATIVE_SUBJECT = "qualification-negative-subject";
export const NOT_APPLICABLE = "not applicable (unauthenticated)";

export type Relation = "equal" | "different" | "absent";
export type CheckOutcome =
  { status: 200 } | { status: 401 | 403; reason: string };

export type AccessTokenFacts =
  | { kind: "opaque" }
  | {
      kind: "jwt";
      alg: unknown;
      typ: unknown;
      kidPresent: boolean;
      issuer: Relation;
      audience: "resource" | "client-id" | "other" | "absent";
      expPresent: boolean;
      subPresent: boolean;
    };

export interface TokenAnalysis {
  tokenTypeBearer: boolean;
  refreshTokenReturned: boolean;
  idTokenReturned: boolean;
  access: AccessTokenFacts;
  validation: CheckOutcome;
  positiveCheck: CheckOutcome | typeof NOT_APPLICABLE;
  negativeCheck: CheckOutcome | typeof NOT_APPLICABLE;
  /** Identity as booleans and the JSON type/value of `email_verified` only. */
  identity?: {
    allowedBySubject: boolean;
    allowedByEmail: boolean;
    emailVerified: { type: string; value: string };
  };
  idTokenCheck?: CheckOutcome;
  idTokenUsable: boolean;
  issuerIdentification: {
    advertised: Capability;
    redirectIss: Relation;
    inconsistent: boolean;
  };
}

export interface AnalysisInput {
  response: Record<string, unknown>;
  issuer: string;
  clientId: string;
  resource: string;
  nonce: string;
  jwks: unknown;
  allowSubjects: readonly string[];
  allowEmails: readonly string[];
  issParameter: Capability;
  redirectIss: string | undefined;
  now: Date;
}

const outcome = (result: ValidationResult): CheckOutcome =>
  result.ok
    ? { status: 200 }
    : { status: result.status, reason: result.reason };

const relation = (value: unknown, expected: string): Relation =>
  // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
  value === undefined ? "absent" : value === expected ? "equal" : "different";

const contains = (aud: unknown, value: string) =>
  aud === value || (Array.isArray(aud) && aud.includes(value));

function accessFacts(token: string, input: AnalysisInput): AccessTokenFacts {
  const decoded = decodeCompact(token);
  if (!decoded) return { kind: "opaque" };
  const { header, payload } = decoded;
  return {
    kind: "jwt",
    alg: header.alg,
    typ: header.typ,
    kidPresent: header.kid !== undefined,
    issuer: relation(payload.iss, input.issuer),
    audience:
      payload.aud === undefined
        ? "absent"
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          contains(payload.aud, input.resource)
          ? "resource"
          : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
            contains(payload.aud, input.clientId)
            ? "client-id"
            : "other",
    expPresent: payload.exp !== undefined,
    subPresent: payload.sub !== undefined,
  };
}

function identityFacts(token: string, input: AnalysisInput) {
  const payload = decodeCompact(token)?.payload;
  if (!payload) return undefined;
  const verified = payload.email_verified;
  return {
    allowedBySubject:
      payload.iss === input.issuer &&
      typeof payload.sub === "string" &&
      input.allowSubjects.includes(payload.sub),
    allowedByEmail:
      typeof payload.email === "string" &&
      input.allowEmails.includes(payload.email) &&
      verified === true,
    emailVerified:
      verified === undefined
        ? { type: "absent", value: "" }
        : {
            type: verified === null ? "null" : typeof verified,
            value:
              typeof verified === "string"
                ? verified
                : JSON.stringify(verified),
          },
  };
}

/** BR-101: the ID token carries the issuer, the client ID and the sent nonce. */
function idTokenUsable(token: string, input: AnalysisInput): boolean {
  const payload = decodeCompact(token)?.payload;
  return (
    payload !== undefined &&
    payload.iss === input.issuer &&
    contains(payload.aud, input.clientId) &&
    payload.nonce === input.nonce
  );
}

/** BR-101: analyses a token response with the production validator. */
export async function analyseTokens(
  input: AnalysisInput,
): Promise<TokenAnalysis> {
  const { response } = input;
  const accessToken =
    typeof response.access_token === "string" ? response.access_token : "";
  const idToken =
    typeof response.id_token === "string" ? response.id_token : undefined;
  const positive = createAccessTokenValidator({
    issuer: input.issuer,
    audience: input.resource,
    jwks: input.jwks,
    allowedSubjects: input.allowSubjects.map((sub) => ({
      iss: input.issuer,
      sub,
    })),
    allowedEmails: input.allowEmails,
  });
  const negative = createAccessTokenValidator({
    issuer: input.issuer,
    audience: input.resource,
    jwks: input.jwks,
    allowedSubjects: [{ iss: input.issuer, sub: NEGATIVE_SUBJECT }],
    allowedEmails: [],
  });
  const validation = outcome(await positive(accessToken, input.now));
  const authenticated = validation.status !== 401;
  const redirectIss = relation(input.redirectIss, input.issuer);
  const advertised = input.issParameter !== "no";
  const analysis: TokenAnalysis = {
    tokenTypeBearer:
      typeof response.token_type === "string" &&
      response.token_type.toLowerCase() === "bearer",
    refreshTokenReturned: response.refresh_token !== undefined,
    idTokenReturned: idToken !== undefined,
    access: accessFacts(accessToken, input),
    validation,
    positiveCheck: authenticated ? validation : NOT_APPLICABLE,
    negativeCheck: authenticated
      ? outcome(await negative(accessToken, input.now))
      : NOT_APPLICABLE,
    idTokenUsable: idToken !== undefined && idTokenUsable(idToken, input),
    issuerIdentification: {
      advertised: input.issParameter,
      redirectIss,
      inconsistent:
        redirectIss === "different" || (redirectIss === "absent" && advertised),
    },
  };
  const identity = identityFacts(accessToken, input);
  if (identity) analysis.identity = identity;
  if (idToken !== undefined)
    analysis.idTokenCheck = outcome(await positive(idToken, input.now));
  return analysis;
}

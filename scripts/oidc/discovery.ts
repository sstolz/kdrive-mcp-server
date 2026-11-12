import type { JWK } from "jose";
import { isRecord, usableKeys } from "../../src/auth/access-token.ts";
import type { Capability } from "../../src/auth/verdict.ts";
import { getJson, type Fetch } from "./http.ts";

export const CAPABILITIES = [
  "pkceS256",
  "authorizationCode",
  "dynamicRegistration",
  "cimd",
  "jwks",
  "tokenAuthNone",
  "tokenAuthClientSecretBasic",
  "tokenAuthClientSecretPost",
  "issParameter",
] as const;
export type CapabilityName = (typeof CAPABILITIES)[number];
export type Capabilities = Record<CapabilityName, Capability>;

export interface DocumentResult {
  kind: "openid-configuration" | "oauth-authorization-server";
  url: string;
  state: "usable" | "unusable" | "unavailable";
  /** The document's own `issuer` value; provider-controlled. */
  issuer?: unknown;
  capabilities?: Capabilities;
}

export interface Discovery {
  usable: boolean;
  documents: DocumentResult[];
  effective: Capabilities;
  contradictions: CapabilityName[];
  anomalies: string[];
  authorizationEndpoint?: unknown;
  tokenEndpoint?: unknown;
  jwksUri?: unknown;
  /** Usable keys of the effective `jwks_uri`; empty unless JWKS is `yes`. */
  keys: JWK[];
}

const ISS_ANOMALY = "RFC 9207 iss-parameter flag is not a boolean";
const unsafeText = /[\p{Cc}\p{Zl}\p{Zp}\s]/u;

/** An absolute `https` URL without userinfo, whitespace or control characters. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || unsafeText.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** BR-094: the configured issuer, or undefined when it must be refused. */
export function parseIssuer(value: string): string | undefined {
  if (!/^https:\/\//iu.test(value) || !isHttpsUrl(value)) return undefined;
  const authority = /^https:\/\/([^/?#]*)/iu.exec(value)?.[1] ?? "";
  if (authority.includes("@") || value.includes("?") || value.includes("#"))
    return undefined;
  return value;
}

/** BR-094: the OIDC and RFC 8414 well-known URLs of a validated issuer. */
export function wellKnownUrls(issuer: string): {
  openid: string;
  oauth: string;
} {
  const trimmed = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  const url = new URL(issuer);
  const path = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  return {
    openid: `${trimmed}/.well-known/openid-configuration`,
    oauth: `${url.origin}/.well-known/oauth-authorization-server${path}`,
  };
}

function listed(value: unknown, member: string): Capability {
  if (value === undefined) return "unknown";
  return Array.isArray(value) && value.includes(member) ? "yes" : "no";
}

function evaluate(
  document: Record<string, unknown>,
  jwksUsable: (uri: string) => boolean,
  anomalies: Set<string>,
): Capabilities {
  const methods = document.token_endpoint_auth_methods_supported;
  const iss = document.authorization_response_iss_parameter_supported;
  if (iss !== undefined && typeof iss !== "boolean") anomalies.add(ISS_ANOMALY);
  const jwksUri = document.jwks_uri;
  const registration = document.registration_endpoint;
  const cimd = document.client_id_metadata_document_supported;
  const grants = document.grant_types_supported;
  return {
    pkceS256: listed(document.code_challenge_methods_supported, "S256"),
    authorizationCode:
      grants === undefined ? "yes" : listed(grants, "authorization_code"),
    dynamicRegistration:
      registration === undefined
        ? "unknown"
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          isHttpsUrl(registration)
          ? "yes"
          : "no",
    // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
    cimd: cimd === undefined ? "unknown" : cimd === true ? "yes" : "no",
    jwks:
      jwksUri === undefined
        ? "unknown"
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          isHttpsUrl(jwksUri) && jwksUsable(jwksUri)
          ? "yes"
          : "no",
    tokenAuthNone: listed(methods, "none"),
    tokenAuthClientSecretBasic: listed(methods, "client_secret_basic"),
    tokenAuthClientSecretPost: listed(methods, "client_secret_post"),
    issParameter: iss === true ? "yes" : "no",
  };
}

/** BR-095: the effective value over the usable documents. */
function combine(values: Capability[]): {
  value: Capability;
  contradiction: boolean;
} {
  const yes = values.includes("yes");
  const no = values.includes("no");
  if (yes && no) return { value: "unknown", contradiction: true };
  if (yes) return { value: "yes", contradiction: false };
  if (no) return { value: "no", contradiction: false };
  return { value: "unknown", contradiction: false };
}

const firstDefined = (documents: Record<string, unknown>[], name: string) =>
  documents.find((document) => document[name] !== undefined)?.[name];

/** BR-094, BR-095, BR-107: fetches and evaluates the provider metadata. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export async function discover(
  issuer: string,
  fetch: Fetch,
): Promise<Discovery> {
  const urls = wellKnownUrls(issuer);
  const documents: DocumentResult[] = [];
  const usableDocuments: Record<string, unknown>[] = [];
  const kinds = [
    ["openid-configuration", urls.openid],
    ["oauth-authorization-server", urls.oauth],
  ] as const;
  for (const [kind, url] of kinds) {
    const response = await getJson(fetch, url);
    if (!response || response.status !== 200)
      documents.push({ kind, url, state: "unavailable" });
    else if (isRecord(response.json) && response.json.issuer === issuer) {
      documents.push({ kind, url, state: "usable" });
      usableDocuments.push(response.json);
    } else
      documents.push({
        kind,
        url,
        state: "unusable",
        issuer: isRecord(response.json) ? response.json.issuer : undefined,
      });
  }

  const keysByUri = new Map<string, JWK[]>();
  for (const document of usableDocuments) {
    const uri = document.jwks_uri;
    if (isHttpsUrl(uri) && !keysByUri.has(uri)) {
      const response = await getJson(fetch, uri);
      keysByUri.set(
        uri,
        response?.status === 200 ? usableKeys(response.json) : [],
      );
    }
  }

  const anomalies = new Set<string>();
  const evaluated = usableDocuments.map((document) =>
    evaluate(
      document,
      (uri) => (keysByUri.get(uri)?.length ?? 0) > 0,
      anomalies,
    ),
  );
  let index = 0;
  for (const document of documents)
    if (document.state === "usable") {
      const capabilities = evaluated[index++];
      if (capabilities) document.capabilities = capabilities;
    }

  const effective = {} as Capabilities;
  const contradictions: CapabilityName[] = [];
  for (const name of CAPABILITIES) {
    const { value, contradiction } = combine(evaluated.map((c) => c[name]));
    effective[name] = value;
    if (contradiction) contradictions.push(name);
  }
  const uris = new Set(
    usableDocuments
      .map((document) => document.jwks_uri)
      .filter((uri) => uri !== undefined),
  );
  if (uris.size > 1) {
    effective.jwks = "unknown";
    if (!contradictions.includes("jwks")) contradictions.push("jwks");
  }
  for (const name of ["authorization_endpoint", "token_endpoint"]) {
    const values = new Set(
      usableDocuments
        .map((document) => document[name])
        .filter((value) => value !== undefined)
        .map((value) => JSON.stringify(value)),
    );
    if (values.size > 1) anomalies.add(`${name} differs between documents`);
  }
  const jwksUri = firstDefined(usableDocuments, "jwks_uri");
  return {
    usable: usableDocuments.length > 0,
    documents,
    effective,
    contradictions,
    anomalies: [...anomalies],
    authorizationEndpoint: firstDefined(
      usableDocuments,
      "authorization_endpoint",
    ),
    tokenEndpoint: firstDefined(usableDocuments, "token_endpoint"),
    jwksUri,
    keys:
      effective.jwks === "yes" && isHttpsUrl(jwksUri)
        ? (keysByUri.get(jwksUri) ?? [])
        : [],
  };
}

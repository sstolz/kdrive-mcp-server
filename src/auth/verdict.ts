/** A provider capability as evaluated from its metadata (BR-095). */
export type Capability = "yes" | "no" | "unknown";

/** A documented client fact from the compatibility matrix (BR-108). */
export type Fact = "supported" | "not supported" | "unverified";

export type ProviderVerdict =
  | "delegate-capable"
  | "delegate-static-capable"
  | "proxy-only"
  | "unsupported"
  | "incomplete";

export type ClientMode =
  "delegate" | "delegate-static" | "proxy" | "undetermined" | "not decided";

export interface TokenEvidence {
  /** The access-token validator status was not 401 (403 identity included). */
  accessTokenAuthenticated: boolean;
  /** Absent when no ID token was returned. */
  idToken: { rejectedWith401: boolean; usable: boolean } | null;
}

export interface VerdictInput {
  step: "discover" | "token";
  discoveryUsable: boolean;
  pkceS256: Capability;
  jwks: Capability;
  dynamicRegistration: Capability;
  cimd: Capability;
  /** `refused`: a provider condition stopped the token step (BR-096). */
  token?: TokenEvidence | "refused" | "no-response" | undefined;
}

/** BR-102: the provider verdict and its failing conditions. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function providerVerdict(input: VerdictInput): {
  verdict: ProviderVerdict;
  failing: string[];
} {
  if (input.step === "discover")
    return { verdict: "incomplete", failing: ["token step not run"] };
  if (input.token === "no-response" || input.token === undefined)
    return { verdict: "incomplete", failing: ["no token response"] };
  const token = input.token === "refused" ? undefined : input.token;
  const failing: string[] = [];
  if (!input.discoveryUsable) failing.push("discovery not usable");
  if (input.pkceS256 !== "yes") failing.push("PKCE S256 is not yes");
  if (input.jwks !== "yes") failing.push("JWKS is not yes");
  if (!token) failing.push("token step refused");
  else {
    if (!token.accessTokenAuthenticated)
      failing.push("access token not authenticated");
    if (token.idToken && !token.idToken.rejectedWith401)
      failing.push("ID token accepted by the validator");
  }
  if (!failing.length) {
    const registration =
      input.dynamicRegistration === "yes" || input.cimd === "yes";
    return {
      verdict: registration ? "delegate-capable" : "delegate-static-capable",
      failing,
    };
  }
  const usableIdToken = token?.idToken?.usable === true;
  if (input.discoveryUsable && input.pkceS256 === "yes" && usableIdToken)
    return { verdict: "proxy-only", failing };
  if (!usableIdToken) failing.push("no usable ID token");
  return { verdict: "unsupported", failing };
}

export interface ProviderFacts {
  verdict: ProviderVerdict;
  dynamicRegistration: Capability;
  cimd: Capability;
  tokenAuthNone: Capability;
  usableIdToken: boolean;
  /** BR-101: RFC 9207 issuer identification was inconsistent in the run. */
  issuerInconsistent: boolean;
}

export interface ClientFacts {
  client: string;
  dynamicRegistration: Fact;
  cimd: Fact;
  manualClientId: Fact;
  rejectsInconsistentIssuer: Fact;
}

type FactName = Exclude<keyof ClientFacts, "client">;
const FACT_NAMES: FactName[] = [
  "dynamicRegistration",
  "cimd",
  "manualClientId",
  "rejectsInconsistentIssuer",
];

/** BR-103 steps 3–6, reading each fact as documented only when `supported`. */
function documentedMode(
  provider: ProviderFacts,
  client: ClientFacts,
): ClientMode {
  const documented = (name: FactName) => client[name] === "supported";
  const delegated = !(
    provider.issuerInconsistent && documented("rejectsInconsistentIssuer")
  );
  if (delegated && provider.verdict === "delegate-capable") {
    const dynamic =
      documented("dynamicRegistration") &&
      provider.dynamicRegistration === "yes";
    const cimd =
      documented("cimd") &&
      provider.cimd === "yes" &&
      provider.tokenAuthNone === "yes";
    if (dynamic || cimd) return "delegate";
  }
  if (
    delegated &&
    (provider.verdict === "delegate-capable" ||
      provider.verdict === "delegate-static-capable") &&
    documented("manualClientId")
  )
    return "delegate-static";
  if (provider.usableIdToken && documented("dynamicRegistration"))
    return "proxy";
  return "not decided";
}

/** BR-103: the mode decision for one matrix client. */
export function decideClientMode(
  provider: ProviderFacts,
  client: ClientFacts,
): ClientMode {
  if (provider.verdict === "incomplete" || provider.verdict === "unsupported")
    return "not decided";
  const result = documentedMode(provider, client);
  const needed = FACT_NAMES.some((name) => {
    if (client[name] !== "unverified") return false;
    if (name === "rejectsInconsistentIssuer" && provider.issuerInconsistent)
      return true;
    return (
      documentedMode(provider, { ...client, [name]: "supported" }) !== result
    );
  });
  return needed ? "undetermined" : result;
}

/** BR-103: every client decision and the P-21 promotion flag. */
export function decideClientModes(
  provider: ProviderFacts,
  clients: readonly ClientFacts[],
): {
  decisions: Array<{ client: string; mode: ClientMode }>;
  promoteProxy: boolean;
} {
  const decisions = clients.map((client) => ({
    client: client.client,
    mode: decideClientMode(provider, client),
  }));
  return {
    decisions,
    promoteProxy: decisions.some((decision) => decision.mode === "proxy"),
  };
}

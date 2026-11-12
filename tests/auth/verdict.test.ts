import { describe, expect, it } from "vitest";
import {
  decideClientMode,
  decideClientModes,
  providerVerdict,
  type ClientFacts,
  type ProviderFacts,
  type VerdictInput,
} from "../../src/auth/verdict.js";

const authenticated = { accessTokenAuthenticated: true, idToken: null };
const base: VerdictInput = {
  step: "token",
  discoveryUsable: true,
  pkceS256: "yes",
  jwks: "yes",
  dynamicRegistration: "yes",
  cimd: "no",
  token: authenticated,
};
const usableRejected = { rejectedWith401: true, usable: true };

describe("BR-102 provider verdict", () => {
  it.each<[string, Partial<VerdictInput>, string]>([
    ["all conditions with dynamic registration", {}, "delegate-capable"],
    [
      "CIMD only",
      { dynamicRegistration: "unknown", cimd: "yes" },
      "delegate-capable",
    ],
    [
      "rejected real ID token",
      { token: { accessTokenAuthenticated: true, idToken: usableRejected } },
      "delegate-capable",
    ],
    [
      "identity 403 is still authenticated",
      { token: { accessTokenAuthenticated: true, idToken: null } },
      "delegate-capable",
    ],
    [
      "neither registration mechanism",
      { dynamicRegistration: "no", cimd: "unknown" },
      "delegate-static-capable",
    ],
    [
      "accepted ID token, usable",
      {
        token: {
          accessTokenAuthenticated: true,
          idToken: { rejectedWith401: false, usable: true },
        },
      },
      "proxy-only",
    ],
    [
      "accepted ID token, unusable",
      {
        token: {
          accessTokenAuthenticated: true,
          idToken: { rejectedWith401: false, usable: false },
        },
      },
      "unsupported",
    ],
    [
      "opaque token with usable ID token",
      { token: { accessTokenAuthenticated: false, idToken: usableRejected } },
      "proxy-only",
    ],
    [
      "opaque token, unusable ID token",
      {
        token: {
          accessTokenAuthenticated: false,
          idToken: { rejectedWith401: true, usable: false },
        },
      },
      "unsupported",
    ],
    [
      "opaque token, no ID token",
      { token: { accessTokenAuthenticated: false, idToken: null } },
      "unsupported",
    ],
    [
      "PKCE unknown",
      {
        pkceS256: "unknown",
        token: { accessTokenAuthenticated: true, idToken: usableRejected },
      },
      "unsupported",
    ],
    ["PKCE no", { pkceS256: "no" }, "unsupported"],
    [
      "JWKS unknown with usable ID token",
      {
        jwks: "unknown",
        token: { accessTokenAuthenticated: true, idToken: usableRejected },
      },
      "proxy-only",
    ],
    ["JWKS no without ID token", { jwks: "no" }, "unsupported"],
    [
      "discovery unusable",
      {
        discoveryUsable: false,
        token: { accessTokenAuthenticated: true, idToken: usableRejected },
      },
      "unsupported",
    ],
    [
      "token refused by a provider condition",
      { pkceS256: "unknown", token: "refused" },
      "unsupported",
    ],
    [
      "started token run without token response",
      { token: "no-response" },
      "incomplete",
    ],
    ["discover only", { step: "discover", token: undefined }, "incomplete"],
  ])("BR-102 %s", (_name, change, expected) => {
    const input: VerdictInput = { ...base, ...change };
    const result = providerVerdict(input);
    expect(result.verdict).toBe(expected);
    if (
      expected !== "delegate-capable" &&
      expected !== "delegate-static-capable"
    )
      expect(result.failing.length).toBeGreaterThan(0);
  });

  it("BR-102 failing conditions are named", () => {
    expect(providerVerdict({ ...base, step: "discover" }).failing).toEqual([
      "token step not run",
    ]);
    expect(providerVerdict({ ...base, token: "no-response" }).failing).toEqual([
      "no token response",
    ]);
    expect(
      providerVerdict({ ...base, pkceS256: "unknown", jwks: "no" }).failing,
    ).toEqual([
      "PKCE S256 is not yes",
      "JWKS is not yes",
      "no usable ID token",
    ]);
    expect(
      providerVerdict({
        ...base,
        token: {
          accessTokenAuthenticated: false,
          idToken: { rejectedWith401: false, usable: false },
        },
      }).failing,
    ).toEqual([
      "access token not authenticated",
      "ID token accepted by the validator",
      "no usable ID token",
    ]);
    expect(providerVerdict(base).failing).toEqual([]);
  });
});

const provider: ProviderFacts = {
  verdict: "delegate-capable",
  dynamicRegistration: "yes",
  cimd: "no",
  tokenAuthNone: "yes",
  usableIdToken: true,
  issuerInconsistent: false,
};
const client = (facts: Partial<ClientFacts> = {}): ClientFacts => ({
  client: "Synthetic",
  dynamicRegistration: "not supported",
  cimd: "not supported",
  manualClientId: "not supported",
  rejectsInconsistentIssuer: "not supported",
  ...facts,
});

describe("BR-103 per-client mode decision", () => {
  it.each<[string, Partial<ProviderFacts>, Partial<ClientFacts>, string]>([
    ["dynamic only", {}, { dynamicRegistration: "supported" }, "delegate"],
    ["CIMD only with none", { cimd: "yes" }, { cimd: "supported" }, "delegate"],
    [
      "CIMD only without none",
      { cimd: "yes", tokenAuthNone: "no" },
      { cimd: "supported" },
      "not decided",
    ],
    [
      "CIMD only, none unknown, no ID token",
      { cimd: "yes", tokenAuthNone: "unknown", usableIdToken: false },
      { cimd: "supported" },
      "not decided",
    ],
    ["manual only", {}, { manualClientId: "supported" }, "delegate-static"],
    [
      "dynamic unverified changes the result",
      {},
      { dynamicRegistration: "unverified", manualClientId: "supported" },
      "undetermined",
    ],
    [
      "static provider, CIMD unverified does not change the result",
      { verdict: "delegate-static-capable", dynamicRegistration: "no" },
      { cimd: "unverified", manualClientId: "supported" },
      "delegate-static",
    ],
    [
      "inconsistent issuer, rejecting client, usable ID token",
      { issuerInconsistent: true },
      {
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "supported",
      },
      "proxy",
    ],
    [
      "inconsistent issuer, rejection unverified",
      { issuerInconsistent: true },
      {
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "unverified",
      },
      "undetermined",
    ],
    [
      "consistent issuer, rejection unverified",
      {},
      {
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "unverified",
      },
      "delegate",
    ],
    [
      "consistent issuer, rejecting client",
      {},
      {
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "supported",
      },
      "delegate",
    ],
    [
      "inconsistent issuer, client not rejecting",
      { issuerInconsistent: true },
      {
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "not supported",
      },
      "delegate",
    ],
    [
      "inconsistent issuer, rejecting client, no ID token",
      { issuerInconsistent: true, usableIdToken: false },
      {
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "supported",
      },
      "not decided",
    ],
    [
      "no matching mechanism without usable ID token",
      { usableIdToken: false },
      { cimd: "supported" },
      "not decided",
    ],
    [
      "proxy-only provider, dynamic client",
      { verdict: "proxy-only" },
      { dynamicRegistration: "supported" },
      "proxy",
    ],
    [
      "proxy-only provider, dynamic not supported",
      { verdict: "proxy-only" },
      { manualClientId: "supported" },
      "not decided",
    ],
    [
      "proxy-only provider, dynamic unverified",
      { verdict: "proxy-only" },
      { dynamicRegistration: "unverified" },
      "undetermined",
    ],
    [
      "incomplete provider",
      { verdict: "incomplete" },
      { dynamicRegistration: "unverified" },
      "not decided",
    ],
    [
      "unsupported provider",
      { verdict: "unsupported" },
      { dynamicRegistration: "supported" },
      "not decided",
    ],
  ])("BR-103 %s", (_name, providerChange, clientChange, expected) => {
    expect(
      decideClientMode(
        { ...provider, ...providerChange },
        client(clientChange),
      ),
    ).toBe(expected);
  });

  it("BR-103 the P-21 promotion flag is true exactly when one client is proxy", () => {
    const clients = [
      client({
        client: "A",
        dynamicRegistration: "supported",
        rejectsInconsistentIssuer: "supported",
      }),
      client({ client: "B", manualClientId: "supported" }),
    ];
    expect(decideClientModes(provider, clients)).toEqual({
      decisions: [
        { client: "A", mode: "delegate" },
        { client: "B", mode: "delegate-static" },
      ],
      promoteProxy: false,
    });
    const inconsistent = { ...provider, issuerInconsistent: true };
    expect(decideClientModes(inconsistent, clients)).toEqual({
      decisions: [
        { client: "A", mode: "proxy" },
        { client: "B", mode: "delegate-static" },
      ],
      promoteProxy: true,
    });
    for (const verdict of ["incomplete", "unsupported"] as const)
      expect(
        decideClientModes({ ...inconsistent, verdict }, clients).promoteProxy,
      ).toBe(false);
  });
});

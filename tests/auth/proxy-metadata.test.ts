import { describe, expect, it } from "vitest";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
import {
  LOOPBACK,
  UPSTREAM,
  counterRandom,
  header,
  json,
  syntheticPem,
} from "../helpers/proxy.js";

function proxyFor(publicUrl: string) {
  return createOAuthProxy({
    config: {
      publicUrl,
      oauthIssuer: UPSTREAM,
      oauthAllowedSubjects: ["user-1"],
      oauthAllowedEmails: [],
      oauthUpstreamClientId: "c",
      oauthUpstreamClientSecret: "s",
      oauthSigningKey: new TextEncoder().encode(syntheticPem()),
      oauthAllowedRedirectUris: [LOOPBACK],
    },
    clock: () => new Date(),
    randomBytes: counterRandom(),
    upstream: {
      fetchJson: () => Promise.reject(new Error("no")),
      postForm: () => Promise.reject(new Error("no")),
    },
  });
}

describe("BR-125 authorization-server metadata", () => {
  it.each([
    [
      "https://mcp.test",
      [
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
      ],
    ],
    [
      "https://mcp.test/mcp",
      [
        "/.well-known/oauth-authorization-server/mcp",
        "/.well-known/openid-configuration/mcp",
        "/mcp/.well-known/openid-configuration",
      ],
    ],
  ])(
    "BR-125 publishes exactly the RFC 8414 members for %s",
    (issuer, paths) => {
      const proxy = proxyFor(issuer);
      const response = proxy.metadata();
      expect(response.status).toBe(200);
      expect(header(response, "content-type")).toBe("application/json");
      const document = json(response);
      expect(document).toEqual({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_basic",
          "client_secret_post",
        ],
        authorization_response_iss_parameter_supported: true,
      });
      expect("client_id_metadata_document_supported" in document).toBe(false);
      expect(proxy.metadataPaths).toEqual(paths);
    },
  );
});

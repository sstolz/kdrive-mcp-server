import { createHash, randomBytes } from "node:crypto";
import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { run } from "../../scripts/oidc-qualify.js";
import { analyseTokens } from "../../scripts/oidc/analysis.js";
import { parseArgs } from "../../scripts/oidc/args.js";
import {
  clientAuthentication,
  createAuthorizationRequest,
  parseRedirectUri,
} from "../../scripts/oidc/flow.js";
import {
  audience,
  claims,
  clientId,
  issuer,
  now,
  sign,
  signingKey,
} from "../helpers/oidc.js";
import { metadata, tokenUrl, without } from "../helpers/oidc-provider.js";
import {
  accessToken,
  harness,
  redirectUri,
  tokenArgs,
} from "../helpers/oidc-run.js";

const tokenCalls = <T extends { url: string }>(calls: T[]) =>
  calls.filter((call) => call.url === tokenUrl);

function replaceArg(args: string[], name: string, value: string): string[] {
  const copy = [...args];
  copy[copy.indexOf(name) + 1] = value;
  return copy;
}

describe("BR-096 token step preconditions", () => {
  it.each<[string, Record<string, unknown>]>([
    ["unusable discovery", metadata({ issuer: "https://other.test" })],
    [
      "PKCE S256 unknown",
      without(metadata(), "code_challenge_methods_supported"),
    ],
    [
      "http authorization endpoint",
      metadata({ authorization_endpoint: "http://idp.test/authorize" }),
    ],
    [
      "http token endpoint",
      metadata({ token_endpoint: "http://idp.test/token" }),
    ],
  ])(
    "BR-096 %s writes an unsupported report and sends no request",
    async (_name, document) => {
      const h = await harness({ metadata: document });
      expect(await run(tokenArgs(), h.deps)).toBe(0);
      expect(tokenCalls(h.calls)).toEqual([]);
      expect(h.out.join("")).not.toContain("authorize");
      expect(h.prompts).toEqual([]);
      expect(h.report()).toContain("Verdict: `unsupported`");
      expect(h.out.join("")).toContain("Verdict: unsupported");
    },
  );

  it.each([
    ["--resource", "https://MCP.test/mcp"],
    ["--redirect-uri", "https://127.0.0.1:8080/cb"],
    ["--redirect-uri", "http://localhost:8080@evil.test/cb"],
    ["--redirect-uri", "http://127.0.0.1.evil.test:80/cb"],
    ["--redirect-uri", "http://evil.test:80/cb"],
    ["--redirect-uri", "http://127.0.0.1/cb"],
    ["--redirect-uri", "http://127.0.0.1:80/cb"],
    ["--redirect-uri", "http://user@127.0.0.1:8080/cb"],
  ])(
    "BR-096 owner input %s %s writes no report and exits nonzero before any request",
    async (name, value) => {
      const h = await harness();
      expect(await run(replaceArg(tokenArgs(), name, value), h.deps)).not.toBe(
        0,
      );
      expect(h.calls).toEqual([]);
      expect(h.reports.size).toBe(0);
      expect(h.err.join("")).not.toMatch(/\bat \S+:\d+/u);
    },
  );

  it("BR-096 loopback redirect URIs with an explicit non-80 port are accepted", () => {
    for (const value of [
      "http://127.0.0.1:8080/cb",
      "http://[::1]:8080/cb",
      "http://localhost:53682/callback",
    ])
      expect(parseRedirectUri(value)).toBeDefined();
    expect(parseRedirectUri("http://localhost/cb")).toBeUndefined();
    expect(parseRedirectUri("http://LOCALHOST.:8080/cb")).toBeUndefined();
  });

  it("BR-096 the accepted redirect URI proceeds to the token request", async () => {
    const h = await harness();
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    expect(tokenCalls(h.calls)).toHaveLength(1);
  });

  it("BR-096 builds the authorization request with S256 PKCE, state, nonce, scope and resource", () => {
    const request = createAuthorizationRequest(
      {
        endpoint: "https://idp.test/authorize?tenant=a",
        clientId,
        redirectUri,
        scopes: ["profile", "email"],
        resource: audience,
      },
      randomBytes,
    );
    expect(request.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(request.challenge).toBe(
      createHash("sha256").update(request.verifier).digest("base64url"),
    );
    expect(base64url.decode(request.state)).toHaveLength(32);
    expect(base64url.decode(request.nonce)).toHaveLength(32);
    expect(request.state).not.toBe(request.nonce);
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe("https://idp.test/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: "a",
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email",
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.challenge,
      code_challenge_method: "S256",
      resource: audience,
    });
  });
});

describe("BR-097 redirect and token exchange", () => {
  it.each<[string, (sent: { state: string }) => string]>([
    ["a different state", () => `${redirectUri}?code=c&state=other`],
    [
      "another origin",
      (s) => `http://127.0.0.1:9090/cb?code=c&state=${s.state}`,
    ],
    [
      "another path",
      (s) => `http://127.0.0.1:8080/other?code=c&state=${s.state}`,
    ],
    [
      "an error",
      (s) =>
        `${redirectUri}?error=access_denied&error_description=secret+text&state=${s.state}`,
    ],
    ["no code", (s) => `${redirectUri}?state=${s.state}`],
    ["not a URL", () => "not a url"],
  ])(
    "BR-097 a pasted URL with %s ends the run without a token request",
    async (_name, paste) => {
      const h = await harness({ paste });
      expect(await run(tokenArgs(), h.deps)).toBe(0);
      expect(tokenCalls(h.calls)).toEqual([]);
      expect(h.report()).toContain("Verdict: `incomplete`");
      expect(h.report()).not.toContain("secret text");
      if (_name === "an error")
        expect(h.report()).toContain("Authorization error: `access_denied`");
    },
  );

  it("BR-097 chooses Basic, post, stop or public client authentication", () => {
    expect(clientAuthentication(true, "unknown", "unknown")).toBe("basic");
    expect(clientAuthentication(true, "yes", "no")).toBe("basic");
    expect(clientAuthentication(true, "no", "yes")).toBe("post");
    expect(clientAuthentication(true, "no", "unknown")).toBe("stop");
    expect(clientAuthentication(true, "no", "no")).toBe("stop");
    expect(clientAuthentication(false, "no", "no")).toBe("public");
  });

  function form(body: string) {
    return Object.fromEntries(new URLSearchParams(body));
  }

  it("BR-097 auth methods unknown with a secret use form-urlencoded Basic credentials", async () => {
    const h = await harness({
      metadata: without(metadata(), "token_endpoint_auth_methods_supported"),
      secret: "a:b+c%",
    });
    expect(await run(tokenArgs("--client-secret-prompt"), h.deps)).toBe(0);
    const [call] = tokenCalls(h.calls);
    expect(call?.method).toBe("POST");
    expect(call?.redirect).toBe("manual");
    expect(call?.headers.authorization).toBe(
      `Basic ${Buffer.from("synthetic-client:a%3Ab%2Bc%25").toString("base64")}`,
    );
    expect(form(call?.body ?? "")).toEqual({
      grant_type: "authorization_code",
      code: "synthetic-authorization-code",
      redirect_uri: redirectUri,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) as string,
      resource: audience,
    });
    expect(h.prompts.some((prompt) => /secret/iu.test(prompt))).toBe(true);
  });

  it("BR-097 client_secret_post when only post is listed", async () => {
    const h = await harness({
      metadata: metadata({
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      secret: "s3cret",
    });
    expect(await run(tokenArgs("--client-secret-prompt"), h.deps)).toBe(0);
    const [call] = tokenCalls(h.calls);
    expect(call?.headers.authorization).toBeUndefined();
    expect(form(call?.body ?? "")).toMatchObject({
      client_id: clientId,
      client_secret: "s3cret",
    });
  });

  it("BR-097 private_key_jwt only stops before any token request", async () => {
    const h = await harness({
      metadata: metadata({
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
      }),
      secret: "s3cret",
    });
    expect(await run(tokenArgs("--client-secret-prompt"), h.deps)).toBe(0);
    expect(tokenCalls(h.calls)).toEqual([]);
    expect(h.report()).toContain("Verdict: `incomplete`");
  });

  it("BR-097 without a secret sends client_id as a public client", async () => {
    const h = await harness();
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    const [call] = tokenCalls(h.calls);
    expect(call?.headers.authorization).toBeUndefined();
    expect(form(call?.body ?? "")).toMatchObject({ client_id: clientId });
    expect(form(call?.body ?? "").client_secret).toBeUndefined();
    expect(h.prompts.some((prompt) => /secret/iu.test(prompt))).toBe(false);
  });

  it.each(["--client-secret", "--client-secret-file", "--unknown"])(
    "BR-097 the parser rejects %s",
    async (option) => {
      expect(parseArgs([...tokenArgs(), option, "x"])).toHaveProperty("error");
      const h = await harness();
      expect(await run([...tokenArgs(), option, "x"], h.deps)).not.toBe(0);
      expect(h.calls).toEqual([]);
    },
  );

  it.each(["OIDC_CLIENT_SECRET", "MY_CLIENT_SECRET_FILE"])(
    "BR-097 with %s set the command exits nonzero before any request",
    async (name) => {
      for (const args of [
        tokenArgs(),
        ["discover", "--issuer", issuer, "--label", "x"],
      ]) {
        const h = await harness({ env: { [name]: "x" } });
        expect(await run(args, h.deps)).not.toBe(0);
        expect(h.calls).toEqual([]);
        expect(h.reports.size).toBe(0);
      }
    },
  );

  it("BR-097 a token endpoint error ends the run with the sanitized code only", async () => {
    const h = await harness({
      token: () => ({
        status: 400,
        body: { error: "invalid_grant", error_description: "do not print" },
      }),
    });
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    expect(h.report()).toContain("Token error: `invalid_grant`");
    expect(h.report()).not.toContain("do not print");
    expect(h.report()).toContain("Verdict: `incomplete`");
  });
});

describe("BR-101 token analysis", () => {
  async function analyse(
    response: Record<string, unknown>,
    options: {
      issParameter?: "yes" | "no" | "unknown";
      redirectIss?: string | undefined;
      nonce?: string;
    } = {},
  ) {
    const key = await signingKey();
    return {
      key,
      analysis: await analyseTokens({
        response,
        issuer,
        clientId,
        resource: audience,
        nonce: options.nonce ?? "sent-nonce",
        jwks: { keys: [key.jwk] },
        allowSubjects: ["user-1"],
        allowEmails: [],
        issParameter: options.issParameter ?? "yes",
        redirectIss: "redirectIss" in options ? options.redirectIss : issuer,
        now,
      }),
    };
  }

  it("BR-101 an opaque access token is not applicable (unauthenticated) for both checks", async () => {
    const { analysis } = await analyse({
      access_token: "opaque-value",
      token_type: "bearer",
    });
    expect(analysis.access).toEqual({ kind: "opaque" });
    expect(analysis.tokenTypeBearer).toBe(true);
    expect(analysis.validation).toEqual({ status: 401, reason: "malformed" });
    expect(analysis.positiveCheck).toBe("not applicable (unauthenticated)");
    expect(analysis.negativeCheck).toBe("not applicable (unauthenticated)");
    expect(analysis.refreshTokenReturned).toBe(false);
    expect(analysis.idTokenReturned).toBe(false);
  });

  it("BR-101 a JWT whose aud is the client ID has the client-id relation", async () => {
    const key = await signingKey();
    const token = await sign(key, claims({ aud: clientId }), { typ: "JWT" });
    const analysis = await analyseTokens({
      response: { access_token: token, token_type: "MAC" },
      issuer,
      clientId,
      resource: audience,
      nonce: "n",
      jwks: { keys: [key.jwk] },
      allowSubjects: ["user-1"],
      allowEmails: [],
      issParameter: "no",
      redirectIss: undefined,
      now,
    });
    expect(analysis.tokenTypeBearer).toBe(false);
    expect(analysis.access).toEqual({
      kind: "jwt",
      alg: "ES256",
      typ: "JWT",
      kidPresent: true,
      issuer: "equal",
      audience: "client-id",
      expPresent: true,
      subPresent: true,
    });
    expect(analysis.validation).toEqual({ status: 401, reason: "audience" });
    expect(analysis.positiveCheck).toBe("not applicable (unauthenticated)");
  });

  it("BR-101 audience and issuer relations other and absent", async () => {
    const key = await signingKey();
    const base = {
      issuer,
      clientId,
      resource: audience,
      nonce: "n",
      jwks: { keys: [key.jwk] },
      allowSubjects: ["user-1"],
      allowEmails: [],
      issParameter: "no" as const,
      redirectIss: undefined,
      now,
    };
    const other = await analyseTokens({
      ...base,
      response: {
        access_token: await sign(
          key,
          claims({ aud: "https://x.test", iss: "https://y.test" }),
        ),
      },
    });
    expect(other.access).toMatchObject({
      audience: "other",
      issuer: "different",
    });
    const payload = claims();
    delete payload.aud;
    delete payload.iss;
    delete payload.exp;
    delete payload.sub;
    const absent = await analyseTokens({
      ...base,
      response: { access_token: await sign(key, payload) },
    });
    expect(absent.access).toMatchObject({
      audience: "absent",
      issuer: "absent",
      expPresent: false,
      subPresent: false,
    });
  });

  it("BR-101 an accepted JWT with ID and refresh tokens records positive, negative and ID-token checks", async () => {
    const key = await signingKey();
    const idToken = await sign(
      key,
      claims({ aud: clientId, nonce: "sent-nonce" }),
    );
    const analysis = await analyseTokens({
      response: {
        access_token: await sign(
          key,
          claims({ email: "o@example.test", email_verified: true }),
        ),
        id_token: idToken,
        refresh_token: "refresh-value",
        token_type: "Bearer",
      },
      issuer,
      clientId,
      resource: audience,
      nonce: "sent-nonce",
      jwks: { keys: [key.jwk] },
      allowSubjects: ["user-1"],
      allowEmails: [],
      issParameter: "yes",
      redirectIss: issuer,
      now,
    });
    expect(analysis.refreshTokenReturned).toBe(true);
    expect(analysis.idTokenReturned).toBe(true);
    expect(analysis.validation).toEqual({ status: 200 });
    expect(analysis.positiveCheck).toEqual({ status: 200 });
    expect(analysis.negativeCheck).toEqual({ status: 403, reason: "identity" });
    expect(analysis.idTokenCheck).toEqual({ status: 401, reason: "id-token" });
    expect(analysis.idTokenUsable).toBe(true);
    expect(analysis.identity).toEqual({
      allowedBySubject: true,
      allowedByEmail: false,
      emailVerified: { type: "boolean", value: "true" },
    });
    const wrongNonce = await analyseTokens({
      response: { access_token: await accessToken(key), id_token: idToken },
      issuer,
      clientId,
      resource: audience,
      nonce: "other-nonce",
      jwks: { keys: [key.jwk] },
      allowSubjects: ["user-1"],
      allowEmails: [],
      issParameter: "yes",
      redirectIss: issuer,
      now,
    });
    expect(wrongNonce.idTokenUsable).toBe(false);
  });

  it.each<
    [string, "yes" | "no" | "unknown", string | undefined, string, boolean]
  >([
    ["equal", "yes", issuer, "equal", false],
    ["different", "yes", "https://other.test", "different", true],
    [
      "different while not advertised",
      "no",
      "https://other.test",
      "different",
      true,
    ],
    ["absent while advertised", "yes", undefined, "absent", true],
    ["absent while not advertised", "no", undefined, "absent", false],
    ["absent while unknown", "unknown", undefined, "absent", true],
  ])(
    "BR-101 issuer identification %s",
    async (_name, issParameter, redirectIss, relation, inconsistent) => {
      const { analysis } = await analyse(
        { access_token: "opaque" },
        { issParameter, redirectIss },
      );
      expect(analysis.issuerIdentification).toEqual({
        advertised: issParameter,
        redirectIss: relation,
        inconsistent,
      });
    },
  );

  it("BR-101 absent iss with one document true and the other silent is inconsistent in a run", async () => {
    const h = await harness({
      routes: {
        "https://idp.test/.well-known/oauth-authorization-server": {
          body: without(
            metadata(),
            "authorization_response_iss_parameter_supported",
          ),
        },
      },
      paste: (sent) => `${redirectUri}?code=synthetic-code&state=${sent.state}`,
    });
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    expect(h.report()).toContain("Redirect `iss`: `absent`");
    expect(h.report()).toContain("Issuer identification: inconsistent");
  });

  it("BR-102 a positive identity check of 403 leaves the authenticated verdict unchanged", async () => {
    const allowed = await harness();
    expect(await run(tokenArgs(), allowed.deps)).toBe(0);
    expect(allowed.report()).toContain(
      "Positive identity check: 200 (accepted)",
    );
    expect(allowed.report()).toContain("Verdict: `delegate-capable`");
    const args = tokenArgs();
    args[args.indexOf("--allow-subject") + 1] = "someone-else";
    const mismatch = await harness();
    expect(await run(args, mismatch.deps)).toBe(0);
    expect(mismatch.report()).toContain(
      "Positive identity check: 403 `identity`",
    );
    expect(mismatch.report()).toContain("Verdict: `delegate-capable`");
  });

  it("BR-101 token without any allowlist entry stops before any request", async () => {
    const args = tokenArgs().filter(
      (v) => v !== "--allow-subject" && v !== "user-1",
    );
    const h = await harness();
    expect(await run(args, h.deps)).not.toBe(0);
    expect(h.calls).toEqual([]);
    expect(h.reports.size).toBe(0);
  });
});

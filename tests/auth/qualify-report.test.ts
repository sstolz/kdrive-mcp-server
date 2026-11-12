import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../scripts/oidc-qualify.js";
import {
  ACCEPTANCE_SCAN_PATTERNS,
  codeSpan,
  oauthErrorCode,
  patternScan,
} from "../../scripts/oidc/redaction.js";
import { claims, clientId, issuer, sign } from "../helpers/oidc.js";
import { metadata, tokenUrl } from "../helpers/oidc-provider.js";
import { harness, redirectUri, tokenArgs } from "../helpers/oidc-run.js";

const longIssuer =
  "https://login.idp.example.test/realm/0f8fad5b-d9cb-469f-a165-70867728950e";
const identity = {
  sub: "subject-distinct-0001",
  email: "owner.distinct@example.test",
  email_verified: true,
  name: "Distinct Person Name",
  preferred_username: "distinct-username",
  given_name: "DistinctGiven",
  family_name: "DistinctFamily",
  nickname: "DistinctNick",
};
const secret = "client-secret-distinct-value";
const code = "authorization-code-distinct-value";

function args(base: string, sub = identity.sub) {
  const values = tokenArgs(
    "--client-secret-prompt",
    "--allow-email",
    identity.email,
  );
  values[values.indexOf("--issuer") + 1] = base;
  values[values.indexOf("--allow-subject") + 1] = sub;
  return values;
}

function segments(token: string): string[] {
  return [token, ...token.split(".").filter((part) => part !== "")];
}

async function fullRun(
  options: {
    sub?: string;
    typ?: string;
    accessToken?: (token: string) => string;
  } = {},
) {
  const tokens: string[] = [];
  const h = await harness({
    issuer: longIssuer,
    secret,
    code,
    token: async (key, sent) => {
      const own = { ...identity, sub: options.sub ?? identity.sub };
      const access = await sign(
        key,
        claims({ ...own, iss: longIssuer }),
        options.typ === undefined ? {} : { typ: options.typ },
      );
      const id = await sign(
        key,
        claims({ ...own, iss: longIssuer, aud: clientId, nonce: sent.nonce }),
      );
      const accessToken = options.accessToken
        ? options.accessToken(access)
        : access;
      tokens.push(accessToken, id, "refresh-token-distinct-value");
      return {
        body: {
          access_token: accessToken,
          id_token: id,
          refresh_token: "refresh-token-distinct-value",
          token_type: "Bearer",
        },
      };
    },
  });
  const status = await run(args(longIssuer, options.sub), h.deps);
  const tokenCall = h.calls.find((call) => call.url === `${longIssuer}/token`);
  const verifier =
    new URLSearchParams(tokenCall?.body ?? "").get("code_verifier") ?? "";
  return { h, status, tokens, verifier };
}

describe("BR-104 redaction", () => {
  it("BR-104 a full synthetic run leaks no token, segment, code, verifier, secret or identity value", async () => {
    const { h, status, tokens, verifier } = await fullRun();
    expect(status).toBe(0);
    expect(h.reports.size).toBe(1);
    const [path] = h.reports.keys();
    expect(path).toMatch(
      /^artifacts\/oidc-qualification\/synthetic-20261102T120000Z\.md$/u,
    );
    const report = h.report();
    const terminal = h.out.join("") + h.err.join("");
    const forbidden = [
      ...tokens.flatMap(segments),
      code,
      verifier,
      secret,
      identity.sub,
      identity.email,
      identity.name,
      identity.preferred_username,
      identity.given_name,
      identity.family_name,
      identity.nickname,
    ];
    expect(verifier).toHaveLength(43);
    for (const value of forbidden) {
      expect(report, value).not.toContain(value);
      expect(terminal, value).not.toContain(value);
    }
    const sent = h.sent();
    if (!sent) throw new Error("authorization not sent");
    for (const value of [sent.state, sent.nonce]) {
      expect(report).not.toContain(value);
      const lines = terminal.split("\n").filter((line) => line.includes(value));
      expect(lines).toEqual([sent.authorization.href]);
    }
    expect(report).toContain("Allowed by subject list: yes");
    expect(report).toContain("Allowed by email list: yes");
    expect(report).toContain("`email_verified`: boolean `true`");
    expect(report).toContain("Verdict: `delegate-capable`");
    expect(report).toContain("Tool commit: `0123456789ab`");
    expect(report).toContain("Label: `synthetic`");
    expect(patternScan(report)).toEqual([]);
    expect(terminal).toBe(
      `${sent.authorization.href}\nReport: ${path}\nVerdict: delegate-capable\n`,
    );
  });

  it("BR-104 a one-character subject does not block the report", async () => {
    const { h, status } = await fullRun({ sub: "1" });
    expect(status).toBe(0);
    expect(h.reports.size).toBe(1);
    expect(h.report()).toContain("Allowed by subject list: yes");
  });

  it("BR-104 a token with an empty signature segment completes and writes the report", async () => {
    const { h, status } = await fullRun({
      // eslint-disable-next-line sonarjs/super-linear-regex -- F-011: applied only to short, locally bounded strings
      accessToken: (token) => token.replace(/[^.]+$/u, ""),
    });
    expect(status).toBe(0);
    expect(h.reports.size).toBe(1);
    expect(h.report()).toContain("Validator: 401 `signature`");
  });

  it("BR-104 an injected leak writes no file, prints no stack trace and exits nonzero", async () => {
    const { h, status } = await fullRun({ typ: code });
    expect(status).not.toBe(0);
    expect(h.reports.size).toBe(0);
    const terminal = h.out.join("") + h.err.join("");
    expect(terminal).not.toContain(code);
    expect(terminal).not.toMatch(/\bat \S+:\d+|Error:/u);
    expect(h.err.join("")).toBe(
      "Qualification stopped: the report would contain a secret or identity value; nothing was written.\n",
    );
  });

  it("BR-104 the acceptance scan detects injected parameters, JWTs, emails and long runs", () => {
    expect(patternScan("value `code=x` here")).toEqual(["parameter"]);
    expect(patternScan("| a |state=x |")).toEqual(["parameter"]);
    expect(patternScan("encode=x nonce_value=1 xcode=1")).toEqual([]);
    expect(patternScan("eyJhbGciOiJF.eyJzdWIiOiIx.")).toEqual(["jwt"]);
    expect(patternScan("mail a@b.example now")).toEqual(["email"]);
    expect(patternScan("x".repeat(40))).toEqual(["longRun"]);
    expect(patternScan(longIssuer)).toEqual([]);
    expect(Object.keys(ACCEPTANCE_SCAN_PATTERNS)).toEqual([
      "jwt",
      "parameter",
      "email",
      "longRun",
    ]);
  });

  it("BR-104 the oidc-qualify Make recipe is silent, interactive and passes ARGS", () => {
    const makefile = readFileSync("Makefile", "utf8").split("\n");
    const target = makefile.findIndex((line) =>
      line.startsWith("oidc-qualify:"),
    );
    expect(target).toBeGreaterThan(-1);
    const recipe = makefile[target + 1] ?? "";
    expect(recipe).toMatch(/^\t@/u);
    expect(recipe).not.toContain("-T");
    const directory = mkdtempSync(join(tmpdir(), "kdrive-oidc-make-"));
    copyFileSync("Makefile", join(directory, "Makefile"));
    for (const file of [
      "compose.yaml",
      "Dockerfile.dev",
      "package.json",
      "package-lock.json",
    ])
      writeFileSync(join(directory, file), "synthetic fixture\n");
    const docker = join(directory, "docker");
    writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n');
    chmodSync(docker, 0o755);
    const result = spawnSync(
      "/usr/bin/make",
      [
        "oidc-qualify",
        `DOCKER=${docker}`,
        "ARGS=discover --issuer https://idp.test --label x --allow-subject hidden-value",
      ],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, FAKE_LOG: join(directory, "calls") },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("hidden-value");
    const calls = readFileSync(join(directory, "calls"), "utf8")
      .trim()
      .split("\n");
    expect(calls.at(-1)).toBe(
      "compose run --rm dev node scripts/oidc-qualify.ts discover --issuer https://idp.test --label x --allow-subject hidden-value",
    );
  });
});

describe("BR-106 provider-controlled values", () => {
  const hostile = `a\`b\nc\x1b[31m${"z".repeat(500)}`;

  function assertBounded(report: string) {
    expect(report).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/u);
    for (const match of report.matchAll(/`([^`\n]*)`/gu))
      expect(match[1]?.length ?? 0).toBeLessThanOrEqual(200);
    expect(report).not.toContain("z".repeat(201));
  }

  it("BR-106 a hostile issuer and header typ are bounded code spans without control characters", async () => {
    const h = await harness({
      routes: {
        "https://idp.test/.well-known/oauth-authorization-server": {
          body: metadata({ issuer: hostile }),
        },
      },
      token: async (key) => ({
        body: {
          access_token: await sign(key, claims(), { typ: hostile }),
          token_type: hostile,
        },
      }),
    });
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    const report = h.report();
    assertBounded(report);
    expect(report).toContain("`a'bc[31mzzz");
  });

  it("BR-106 an invalid error code is written as invalid and descriptions never appear", async () => {
    const h = await harness({
      token: () => ({
        status: 400,
        body: {
          error: "bad code!",
          error_description: "description-text",
          error_uri: "https://idp.test/error-page",
        },
      }),
    });
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    const report = h.report();
    expect(report).toContain("Token error: `invalid`");
    expect(report).not.toContain("description-text");
    expect(report).not.toContain("error-page");
    const redirect = await harness({
      paste: (sent) =>
        `${redirectUri}?error=bad%20code!&error_description=description-text&state=${sent.state}`,
    });
    expect(await run(tokenArgs(), redirect.deps)).toBe(0);
    expect(redirect.report()).toContain("Authorization error: `invalid`");
    expect(redirect.report()).not.toContain("description-text");
  });

  it("BR-106 an authorization endpoint with a newline is refused", async () => {
    const h = await harness({
      metadata: metadata({ authorization_endpoint: `${issuer}/author\nize` }),
    });
    expect(await run(tokenArgs(), h.deps)).toBe(0);
    expect(h.out.join("")).not.toContain("https://");
    expect(h.calls.filter((call) => call.url === tokenUrl)).toEqual([]);
    expect(h.report()).toContain("Verdict: `unsupported`");
    assertBounded(h.report());
  });

  it("BR-106 sanitizers bound, strip and replace", () => {
    expect(codeSpan(hostile)).toBe(`\`a'bc[31m${"z".repeat(190)}\``);
    expect(codeSpan("")).toBe("(empty)");
    expect(codeSpan(7)).toBe("`7`");
    expect(oauthErrorCode("access_denied")).toBe("`access_denied`");
    expect(oauthErrorCode("bad code!")).toBe("`invalid`");
    expect(oauthErrorCode("x".repeat(65))).toBe("`invalid`");
    expect(oauthErrorCode(undefined)).toBe("`invalid`");
  });
});

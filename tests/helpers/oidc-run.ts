import { readFileSync } from "node:fs";
import type { JWTPayload } from "jose";
import type { QualifyDeps } from "../../scripts/oidc-qualify.js";
import {
  audience,
  claims,
  clientId,
  issuer,
  now,
  sign,
  signingKey,
  type SigningKey,
} from "./oidc.js";
import {
  fakeFetch,
  metadata,
  type FakeCall,
  type FakeResponse,
  type Route,
} from "./oidc-provider.js";

export const redirectUri = "http://127.0.0.1:8080/cb";

export interface Sent {
  state: string;
  nonce: string;
  authorization: URL;
}

export interface HarnessOptions {
  issuer?: string;
  metadata?: Record<string, unknown>;
  routes?: Record<string, Route>;
  token?: (
    key: SigningKey,
    sent: Sent,
    call: FakeCall,
  ) => FakeResponse | Promise<FakeResponse>;
  paste?: (sent: Sent) => string;
  secret?: string;
  env?: Record<string, string>;
  code?: string;
}

export function tokenArgs(...extra: string[]): string[] {
  return [
    "token",
    "--issuer",
    issuer,
    "--client-id",
    clientId,
    "--redirect-uri",
    redirectUri,
    "--resource",
    audience,
    "--allow-subject",
    "user-1",
    "--label",
    "synthetic",
    ...extra,
  ];
}

export async function accessToken(
  key: SigningKey,
  extra: JWTPayload = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  return sign(key, claims(extra), header);
}

export async function harness(options: HarnessOptions = {}) {
  const key = await signingKey();
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const reports = new Map<string, string>();
  let sent: Sent | undefined;
  let counter = 0;
  const code = options.code ?? "synthetic-authorization-code";
  const base = options.issuer ?? issuer;
  const provider = fakeFetch({
    [`${base}/.well-known/openid-configuration`]: {
      body: options.metadata ?? metadata({}, base),
    },
    [`${base}/jwks`]: { body: { keys: [key.jwk] } },
    [`${base}/token`]: async (call) => {
      if (!sent) throw new Error("token request before authorization");
      if (options.token) return options.token(key, sent, call);
      return {
        body: { access_token: await accessToken(key), token_type: "Bearer" },
      };
    },
    ...options.routes,
  });
  const deps: QualifyDeps = {
    fetch: provider.fetch,
    env: options.env ?? {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readLine: (prompt) => {
      prompts.push(prompt);
      const printed = /https:\/\/\S+/u.exec(out.join(""));
      if (!printed) throw new Error("no authorization URL printed");
      const authorization = new URL(printed[0]);
      sent = {
        authorization,
        state: authorization.searchParams.get("state") ?? "",
        nonce: authorization.searchParams.get("nonce") ?? "",
      };
      return Promise.resolve(
        options.paste
          ? options.paste(sent)
          : `${redirectUri}?code=${code}&state=${sent.state}&iss=${encodeURIComponent(base)}`,
      );
    },
    readSecret: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(options.secret ?? "");
    },
    randomBytes: (size) => {
      counter += 1;
      return new Uint8Array(size).map(
        (_, index) => (index * 7 + counter) % 256,
      );
    },
    now: () => now,
    writeReport: (path, text) => {
      reports.set(path, text);
      return Promise.resolve();
    },
    commit: () => Promise.resolve("0123456789abcdef0123"),
    matrix: () =>
      Promise.resolve(readFileSync("docs/mcp-client-compatibility.md", "utf8")),
  };
  return {
    key,
    deps,
    out,
    err,
    prompts,
    reports,
    calls: provider.calls,
    sent: () => sent,
    report: () => [...reports.values()][0] ?? "",
  };
}

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCanonicalAudience, isRecord } from "../src/auth/access-token.ts";
import {
  decideClientModes,
  providerVerdict,
  type TokenEvidence,
} from "../src/auth/verdict.ts";
import { analyseTokens, type TokenAnalysis } from "./oidc/analysis.ts";
import { parseArgs, type Options, type TokenOptions } from "./oidc/args.ts";
import {
  discover,
  isHttpsUrl,
  parseIssuer,
  type Discovery,
} from "./oidc/discovery.ts";
import {
  clientAuthentication,
  createAuthorizationRequest,
  parseRedirectUri,
  readRedirect,
  tokenRequest,
  type RandomBytes,
} from "./oidc/flow.ts";
import { postForm, type Fetch } from "./oidc/http.ts";
import { parseMatrix, type Matrix } from "./oidc/matrix.ts";
import { containsLeak, secretValues } from "./oidc/redaction.ts";
import { renderReport, type ReportModel } from "./oidc/report.ts";
import { readHidden } from "./oidc/terminal.ts";

export interface QualifyDeps {
  fetch: Fetch;
  env: Record<string, string | undefined>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Prompts and reads the pasted redirect URL without echo (BR-104). */
  readLine(prompt: string): Promise<string>;
  /** Prompts and reads one line without echo. */
  readSecret(prompt: string): Promise<string>;
  randomBytes: RandomBytes;
  now(): Date;
  writeReport(path: string, text: string): Promise<void>;
  commit(): Promise<string>;
  matrix(): Promise<string>;
}

const MESSAGES = {
  secretVariable:
    "Refused: unset every environment variable whose name contains CLIENT_SECRET.\n",
  issuer:
    "Refused: the issuer must be an https URL without query, fragment or userinfo.\n",
  allowlist:
    "Refused: token needs at least one --allow-subject or --allow-email.\n",
  resource: "Refused: --resource must be a canonical https audience.\n",
  redirect:
    "Refused: --redirect-uri must be http://127.0.0.1, [::1] or localhost with an explicit port other than 80.\n",
  leak: "Qualification stopped: the report would contain a secret or identity value; nothing was written.\n",
  failure: "Qualification failed; no report was written.\n",
};

const IDENTITY_CLAIMS = [
  "sub",
  "email",
  "name",
  "preferred_username",
  "given_name",
  "family_name",
  "nickname",
];

interface Secrets {
  values: Array<string | undefined>;
  tokens: string[];
}

/** Identity claim values of a token, decoded without verification. */
function identityValues(token: string): string[] {
  const segment = token.split(".")[1];
  if (!segment) return [];
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );
    if (!isRecord(payload)) return [];
    return IDENTITY_CLAIMS.map((name) => payload[name]).filter(
      (value): value is string => typeof value === "string",
    );
  } catch {
    return [];
  }
}

function stamp(now: Date): { iso: string; file: string } {
  const iso = now.toISOString().replace(/\.\d{3}Z$/u, "Z");
  return { iso, file: iso.replace(/[-:]/gu, "") };
}

interface RunState {
  options: Options;
  deps: QualifyDeps;
  matrix: Matrix;
  commit: string;
  discovery: Discovery;
  secrets: Secrets;
}

async function finish(
  state: RunState,
  outcome: {
    token?: TokenEvidence | "refused" | "no-response";
    tokenStep?: string;
    clientAuthentication?: string;
    authorizationError?: unknown;
    tokenError?: unknown;
    analysis?: TokenAnalysis;
    redirectIss?: string | undefined;
  },
): Promise<number> {
  const { options, deps, discovery } = state;
  const effective = discovery.effective;
  const { verdict, failing } = providerVerdict({
    step: options.step,
    discoveryUsable: discovery.usable,
    pkceS256: effective.pkceS256,
    jwks: effective.jwks,
    dynamicRegistration: effective.dynamicRegistration,
    cimd: effective.cimd,
    token: outcome.token,
  });
  const analysis = outcome.analysis;
  const inconsistent = analysis?.issuerIdentification.inconsistent ?? false;
  const issSupported =
    effective.issParameter === "yes" &&
    !inconsistent &&
    (analysis === undefined ||
      analysis.issuerIdentification.redirectIss === "equal");
  const { decisions, promoteProxy } = decideClientModes(
    {
      verdict,
      dynamicRegistration: effective.dynamicRegistration,
      cimd: effective.cimd,
      tokenAuthNone: effective.tokenAuthNone,
      usableIdToken: analysis?.idTokenUsable ?? false,
      issuerInconsistent: inconsistent,
    },
    state.matrix.rows,
  );
  const time = stamp(deps.now());
  const model: ReportModel = {
    label: options.label,
    timestamp: time.iso,
    step: options.step,
    issuer: options.issuer,
    commit: state.commit,
    discovery,
    verdict,
    failing,
    reference: state.matrix.reference,
    decisions: decisions.map((decision, index) => {
      const row = state.matrix.rows[index];
      if (!row) throw new Error("Matrix row missing");
      return {
        row,
        mode: decision.mode,
        redirect: issSupported ? row.redirectWithIss : row.redirectWithoutIss,
      };
    }),
    promoteProxy,
  };
  if (options.step === "token") model.resource = options.resource;
  for (const name of [
    "tokenStep",
    "clientAuthentication",
    "authorizationError",
    "tokenError",
    "analysis",
  ] as const)
    if (outcome[name] !== undefined)
      Object.assign(model, { [name]: outcome[name] });
  const report = renderReport(model);
  const identities = [
    ...state.secrets.tokens.flatMap(identityValues),
    ...(options.step === "token"
      ? [...options.allowSubjects, ...options.allowEmails]
      : []),
  ];
  const secrets = secretValues(state.secrets.values);
  const path = `artifacts/oidc-qualification/${options.label}-${time.file}.md`;
  const terminal = `Report: ${path}\nVerdict: ${verdict}\n`;
  if (
    containsLeak(report, secrets, identities) ||
    containsLeak(terminal, secrets, identities)
  ) {
    deps.stderr(MESSAGES.leak);
    return 1;
  }
  await deps.writeReport(path, report);
  deps.stdout(terminal);
  return 0;
}

/** BR-096–BR-097: the interactive authorization-code exchange. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
async function tokenStep(
  state: RunState,
  options: TokenOptions,
  redirectUri: URL,
): Promise<number> {
  const { deps, discovery } = state;
  const effective = discovery.effective;
  const endpoint = discovery.authorizationEndpoint;
  const tokenEndpoint = discovery.tokenEndpoint;
  if (
    !discovery.usable ||
    effective.pkceS256 !== "yes" ||
    !isHttpsUrl(endpoint) ||
    !isHttpsUrl(tokenEndpoint)
  )
    return finish(state, {
      token: "refused",
      tokenStep: !discovery.usable
        ? "refused: discovery not usable"
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          effective.pkceS256 !== "yes"
          ? "refused: PKCE S256 is not yes"
          : "refused: authorization or token endpoint is not an https URL",
    });
  const method = clientAuthentication(
    options.clientSecretPrompt,
    effective.tokenAuthClientSecretBasic,
    effective.tokenAuthClientSecretPost,
  );
  if (method === "stop")
    return finish(state, {
      token: "no-response",
      tokenStep: "stopped: no supported client secret authentication method",
    });
  const secret = options.clientSecretPrompt
    ? await deps.readSecret("Client secret (input hidden): ")
    : undefined;
  state.secrets.values.push(secret);
  const request = createAuthorizationRequest(
    {
      endpoint,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      scopes: options.scopes,
      resource: options.resource,
    },
    deps.randomBytes,
  );
  state.secrets.values.push(
    request.verifier,
    request.challenge,
    request.state,
    request.nonce,
  );
  deps.stdout(`${request.url}\n`);
  const pasted = await deps.readLine("Paste the redirect URL (input hidden): ");
  const redirect = readRedirect(pasted, redirectUri, request.state);
  if (!redirect.ok)
    return finish(state, {
      token: "no-response",
      tokenStep: `stopped: ${redirect.failure}`,
      authorizationError: redirect.error,
    });
  state.secrets.values.push(redirect.code);
  const exchange = tokenRequest({
    code: redirect.code,
    redirectUri: options.redirectUri,
    verifier: request.verifier,
    resource: options.resource,
    clientId: options.clientId,
    secret,
    method,
  });
  const response = await postForm(
    deps.fetch,
    tokenEndpoint,
    exchange.body,
    exchange.headers,
  );
  const json = isRecord(response?.json) ? response.json : undefined;
  for (const name of ["access_token", "id_token", "refresh_token"]) {
    const value = json?.[name];
    if (typeof value === "string") {
      state.secrets.values.push(value);
      state.secrets.tokens.push(value);
    }
  }
  if (response?.status !== 200 || typeof json?.access_token !== "string")
    return finish(state, {
      token: "no-response",
      clientAuthentication: method,
      tokenStep: response
        ? "stopped: token endpoint returned no access token"
        : "stopped: token request failed",
      tokenError: json?.error,
    });
  const analysis = await analyseTokens({
    response: json,
    issuer: options.issuer,
    clientId: options.clientId,
    resource: options.resource,
    nonce: request.nonce,
    jwks: { keys: discovery.keys },
    allowSubjects: options.allowSubjects,
    allowEmails: options.allowEmails,
    issParameter: effective.issParameter,
    redirectIss: redirect.iss,
    now: deps.now(),
  });
  return finish(state, {
    token: {
      accessTokenAuthenticated: analysis.validation.status !== 401,
      idToken: analysis.idTokenReturned
        ? {
            rejectedWith401: analysis.idTokenCheck?.status === 401,
            usable: analysis.idTokenUsable,
          }
        : null,
    },
    clientAuthentication: method,
    analysis,
  });
}

/** Runs one qualification command; returns the process exit code. */
export async function run(
  argv: readonly string[],
  deps: QualifyDeps,
): Promise<number> {
  try {
    if (Object.keys(deps.env).some((name) => name.includes("CLIENT_SECRET"))) {
      deps.stderr(MESSAGES.secretVariable);
      return 2;
    }
    const options = parseArgs(argv);
    if ("error" in options) {
      deps.stderr(`${options.error}\n`);
      return 2;
    }
    if (!parseIssuer(options.issuer)) {
      deps.stderr(MESSAGES.issuer);
      return 2;
    }
    let redirectUri: URL | undefined;
    if (options.step === "token") {
      if (!options.allowSubjects.length && !options.allowEmails.length) {
        deps.stderr(MESSAGES.allowlist);
        return 2;
      }
      if (!isCanonicalAudience(options.resource)) {
        deps.stderr(MESSAGES.resource);
        return 2;
      }
      redirectUri = parseRedirectUri(options.redirectUri);
      if (!redirectUri) {
        deps.stderr(MESSAGES.redirect);
        return 2;
      }
    }
    const matrix = parseMatrix(await deps.matrix());
    const head = (await deps.commit()).slice(0, 12);
    const state: RunState = {
      options,
      deps,
      matrix,
      commit: /^[0-9a-f]{12}$/u.test(head) ? head : "unknown",
      discovery: await discover(options.issuer, deps.fetch),
      secrets: { values: [], tokens: [] },
    };
    if (options.step === "discover" || !redirectUri)
      return await finish(state, {});
    return await tokenStep(state, options, redirectUri);
  } catch {
    deps.stderr(MESSAGES.failure);
    return 1;
  }
}

const hidden = (prompt: string) =>
  readHidden(process.stdin, process.stdout, prompt);

function commit(): Promise<string> {
  return new Promise((resolvePromise) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- F-011: the Docker-only dev image fixes PATH (Dockerfile.dev)
      "git",
      ["-c", "safe.directory=*", "rev-parse", "HEAD"],
      { timeout: 10_000 },
      (error, stdout) => {
        resolvePromise(error ? "" : stdout.trim());
      },
    );
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run(process.argv.slice(2), {
    fetch: globalThis.fetch,
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readLine: hidden,
    readSecret: hidden,
    randomBytes: (size) => randomBytes(size),
    now: () => new Date(),
    writeReport: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, { flag: "wx", mode: 0o600 });
    },
    commit,
    matrix: () => readFile("docs/mcp-client-compatibility.md", "utf8"),
  });
}

import type { ClientMode, ProviderVerdict } from "../../src/auth/verdict.ts";
import type { CheckOutcome, TokenAnalysis } from "./analysis.ts";
import { NOT_APPLICABLE } from "./analysis.ts";
import type { CapabilityName, Discovery } from "./discovery.ts";
import { CAPABILITIES } from "./discovery.ts";
import type { MatrixRow } from "./matrix.ts";
import { codeSpan, oauthErrorCode } from "./redaction.ts";

/**
 * Everything the renderer may write. Identity reaches it only as booleans and
 * the JSON type/value of `email_verified` (BR-104).
 */
export interface ReportModel {
  label: string;
  timestamp: string;
  step: "discover" | "token";
  issuer: string;
  resource?: string;
  commit: string;
  discovery: Discovery;
  tokenStep?: string;
  clientAuthentication?: string;
  authorizationError?: unknown;
  tokenError?: unknown;
  analysis?: TokenAnalysis;
  verdict: ProviderVerdict;
  failing: string[];
  reference: string;
  decisions: Array<{ row: MatrixRow; mode: ClientMode; redirect: string }>;
  promoteProxy: boolean;
}

const LABELS: Record<CapabilityName, string> = {
  pkceS256: "PKCE S256",
  authorizationCode: "Authorization-code grant",
  dynamicRegistration: "Dynamic registration",
  cimd: "CIMD",
  jwks: "JWKS",
  tokenAuthNone: "Token auth `none`",
  tokenAuthClientSecretBasic: "Token auth `client_secret_basic`",
  tokenAuthClientSecretPost: "Token auth `client_secret_post`",
  issParameter: "RFC 9207 iss parameter",
};

const yesNo = (value: boolean) => (value ? "yes" : "no");
const optional = (value: unknown) =>
  value === undefined ? "absent" : codeSpan(value);
const list = (values: readonly string[]) =>
  values.length ? values.join(", ") : "none";

function check(value: CheckOutcome | typeof NOT_APPLICABLE): string {
  if (value === NOT_APPLICABLE) return NOT_APPLICABLE;
  return value.status === 200
    ? "200 (accepted)"
    : `${String(value.status)} \`${value.reason}\``;
}

function discoverySection(discovery: Discovery): string[] {
  const lines = ["## Discovery", ""];
  for (const document of discovery.documents) {
    lines.push(
      `- ${document.kind}: ${codeSpan(document.url)}, state \`${document.state}\``,
    );
    if (document.state === "unusable")
      lines.push(`  - Document issuer: ${optional(document.issuer)}`);
  }
  const columns = discovery.documents.filter((d) => d.capabilities);
  lines.push(
    "",
    `| Capability | ${[...columns.map((d) => d.kind), "effective"].join(" | ")} |`,
    `| --- | ${[...columns.map(() => "---"), "---"].join(" | ")} |`,
  );
  for (const name of CAPABILITIES) {
    const values = columns.map((d) => `\`${d.capabilities?.[name] ?? ""}\``);
    lines.push(
      // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
      `| ${LABELS[name]} | ${[...values, `\`${discovery.effective[name]}\``].join(" | ")} |`,
    );
  }
  lines.push(
    "",
    `- Discovery usable: ${yesNo(discovery.usable)}`,
    `- Contradictions: ${list(discovery.contradictions.map((name) => LABELS[name]))}`,
    `- Anomalies: ${list(discovery.anomalies)}`,
    `- Authorization endpoint: ${optional(discovery.authorizationEndpoint)}`,
    `- Token endpoint: ${optional(discovery.tokenEndpoint)}`,
    `- JWKS URI: ${optional(discovery.jwksUri)}`,
    `- Usable JWKS keys: ${String(discovery.keys.length)}`,
    "",
  );
  return lines;
}

function tokenSection(model: ReportModel): string[] {
  const lines = ["## Token analysis", ""];
  if (model.step === "discover") return [...lines, "Token step not run.", ""];
  lines.push(`- Token step: ${model.tokenStep ?? "completed"}`);
  if (model.clientAuthentication)
    lines.push(`- Client authentication: \`${model.clientAuthentication}\``);
  if (model.authorizationError !== undefined)
    lines.push(
      `- Authorization error: ${oauthErrorCode(model.authorizationError)}`,
    );
  if (model.tokenError !== undefined)
    lines.push(`- Token error: ${oauthErrorCode(model.tokenError)}`);
  const analysis = model.analysis;
  if (!analysis) return [...lines, ""];
  const access = analysis.access;
  lines.push(
    `- Token type is Bearer: ${yesNo(analysis.tokenTypeBearer)}`,
    `- Refresh token returned: ${yesNo(analysis.refreshTokenReturned)}`,
    `- ID token returned: ${yesNo(analysis.idTokenReturned)}`,
    `- Access token: \`${access.kind}\``,
  );
  if (access.kind === "jwt")
    lines.push(
      `  - Header \`alg\`: ${codeSpan(access.alg)}`,
      `  - Header \`typ\`: ${codeSpan(access.typ)}`,
      `  - Header \`kid\` present: ${yesNo(access.kidPresent)}`,
      `  - Issuer: \`${access.issuer}\``,
      `  - Audience: \`${access.audience}\``,
      `  - \`exp\` present: ${yesNo(access.expPresent)}`,
      `  - \`sub\` present: ${yesNo(access.subPresent)}`,
    );
  lines.push(
    `- Validator: ${check(analysis.validation)}`,
    `- Positive identity check: ${check(analysis.positiveCheck)}`,
    `- Negative identity check: ${check(analysis.negativeCheck)}`,
  );
  if (analysis.identity) {
    const { emailVerified } = analysis.identity;
    lines.push(
      `- Allowed by subject list: ${yesNo(analysis.identity.allowedBySubject)}`,
      `- Allowed by email list: ${yesNo(analysis.identity.allowedByEmail)}`,
      // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
      `- \`email_verified\`: ${emailVerified.type}${emailVerified.type === "absent" ? "" : ` ${codeSpan(emailVerified.value)}`}`,
    );
  }
  if (analysis.idTokenCheck)
    lines.push(`- ID token validator check: ${check(analysis.idTokenCheck)}`);
  const identification = analysis.issuerIdentification;
  lines.push(
    `- ID token usable: ${yesNo(analysis.idTokenUsable)}`,
    `- RFC 9207 iss parameter (effective): \`${identification.advertised}\``,
    `- Redirect \`iss\`: \`${identification.redirectIss}\``,
    `- Issuer identification: ${identification.inconsistent ? "inconsistent" : "consistent"}`,
    "",
  );
  return lines;
}

/** Renders the redacted Markdown report (F-008 "Report" section). */
export function renderReport(model: ReportModel): string {
  const lines = [
    "# OIDC qualification report",
    "",
    "## Run metadata",
    "",
    `- Label: ${codeSpan(model.label)}`,
    `- Step: \`${model.step}\``,
    `- UTC timestamp: \`${model.timestamp}\``,
    `- Issuer: ${codeSpan(model.issuer)}`,
  ];
  if (model.resource !== undefined)
    lines.push(`- Resource: ${codeSpan(model.resource)}`);
  lines.push(`- Tool commit: \`${model.commit}\``, "");
  lines.push(...discoverySection(model.discovery), ...tokenSection(model));
  lines.push(
    "## Provider verdict",
    "",
    `- Verdict: \`${model.verdict}\``,
    `- Failing conditions: ${list(model.failing)}`,
    "",
    "## Client decisions",
    "",
    `Matrix reference MCP authorization version: \`${model.reference}\`.`,
    "",
    "| Client | Mode | Redirect URI for this run |",
    "| --- | --- | --- |",
  );
  for (const decision of model.decisions)
    lines.push(
      `| ${decision.row.client} | \`${decision.mode}\` | ${codeSpan(decision.redirect.replace(/`/gu, ""))} |`,
    );
  lines.push("", `- P-21 promotion flag: ${String(model.promoteProxy)}`, "");
  return lines.join("\n");
}

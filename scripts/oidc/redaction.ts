/**
 * F-008 acceptance evidence: the one pattern set used by the code, the tests
 * and the orchestrator's scan of a redacted report before it is committed.
 * JWT, parameter and email hits are never overridable; a long-run hit may be
 * overridden by the orchestrator with a recorded justification.
 */
export const ACCEPTANCE_SCAN_PATTERNS = {
  jwt: String.raw`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*`,
  parameter: String.raw`(?<![A-Za-z0-9_])(?:code|state|nonce|code_verifier)=`,
  email: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+`,
  longRun: String.raw`[A-Za-z0-9_-]{40,}`,
} as const;

export type ScanPattern = keyof typeof ACCEPTANCE_SCAN_PATTERNS;

/** Names of the acceptance patterns that match the text, in pattern order. */
export function patternScan(text: string): ScanPattern[] {
  return (Object.keys(ACCEPTANCE_SCAN_PATTERNS) as ScanPattern[]).filter(
    (name) => new RegExp(ACCEPTANCE_SCAN_PATTERNS[name], "u").test(text),
  );
}

const MAX_CHARACTERS = 200;

/**
 * BR-106: a provider-controlled value as a Markdown code span, cut to 200
 * characters, without control or line-separator characters and backticks.
 */
export function codeSpan(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  // eslint-disable-next-line @typescript-eslint/no-misused-spread, @typescript-eslint/no-unnecessary-condition -- F-011: code-point iteration of the string is intended; F-011: defensive runtime check kept; the value can change outside the static type flow
  const cut = [...(text ?? "")].slice(0, MAX_CHARACTERS).join("");
  const clean = cut.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "").replace(/`/gu, "'");
  return clean === "" ? "(empty)" : `\`${clean}\``;
}

/** BR-106: an OAuth `error` code, or `invalid` when it is not a plain code. */
export function oauthErrorCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value)
    ? `\`${value}\``
    : "`invalid`";
}

/** BR-104: each secret value with its non-empty dot-separated segments. */
export function secretValues(values: ReadonlyArray<string | undefined>) {
  const result = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    result.add(value);
    for (const segment of value.split(".")) if (segment) result.add(segment);
  }
  return [...result];
}

/**
 * BR-104: true when the text contains a secret value or segment, or an
 * identity value of at least 8 characters.
 */
export function containsLeak(
  text: string,
  secrets: readonly string[],
  identities: readonly string[],
): boolean {
  return (
    secrets.some((value) => value !== "" && text.includes(value)) ||
    identities.some((value) => value.length >= 8 && text.includes(value))
  );
}

export interface DiscoverOptions {
  step: "discover";
  issuer: string;
  label: string;
}

export interface TokenOptions {
  step: "token";
  issuer: string;
  label: string;
  clientId: string;
  clientSecretPrompt: boolean;
  redirectUri: string;
  resource: string;
  scopes: string[];
  allowSubjects: string[];
  allowEmails: string[];
}

export type Options = DiscoverOptions | TokenOptions;

const USAGE = "Invalid arguments; see features/F-008-oidc-qualification.md.";
const SINGLE = [
  "--issuer",
  "--label",
  "--client-id",
  "--redirect-uri",
  "--resource",
];
const REPEATED = ["--scope", "--allow-subject", "--allow-email"];
const TOKEN_ONLY = ["--client-id", "--redirect-uri", "--resource", ...REPEATED];

/**
 * Parses the command arguments. No option takes a client secret: BR-097
 * reads it only from the interactive no-echo prompt.
 */
export function parseArgs(
  argv: readonly string[],
): Options | { error: string } {
  const [step, ...rest] = argv;
  if (step !== "discover" && step !== "token") return { error: USAGE };
  const single = new Map<string, string>();
  const repeated = new Map<string, string[]>(
    REPEATED.map((name) => [name, []]),
  );
  let clientSecretPrompt = false;
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index] ?? "";
    if (name === "--client-secret-prompt" && step === "token") {
      clientSecretPrompt = true;
      continue;
    }
    const value = rest[index + 1];
    const allowed =
      (SINGLE.includes(name) || REPEATED.includes(name)) &&
      (step === "token" || !TOKEN_ONLY.includes(name));
    if (!allowed || value === undefined || value === "" || single.has(name))
      return { error: USAGE };
    index++;
    const list = repeated.get(name);
    if (list) list.push(value);
    else single.set(name, value);
  }
  const issuer = single.get("--issuer");
  const label = single.get("--label");
  if (!issuer || !label || !/^[a-z0-9-]{1,32}$/u.test(label))
    return { error: USAGE };
  if (step === "discover") return { step, issuer, label };
  const clientId = single.get("--client-id");
  const redirectUri = single.get("--redirect-uri");
  const resource = single.get("--resource");
  if (!clientId || !redirectUri || !resource) return { error: USAGE };
  return {
    step,
    issuer,
    label,
    clientId,
    clientSecretPrompt,
    redirectUri,
    resource,
    scopes: repeated.get("--scope") ?? [],
    allowSubjects: repeated.get("--allow-subject") ?? [],
    allowEmails: repeated.get("--allow-email") ?? [],
  };
}

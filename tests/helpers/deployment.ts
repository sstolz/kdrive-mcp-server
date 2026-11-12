// F-013 BR-186/BR-187: hygiene of examples/** and docs/deployment.md.

export const V1_STATUS_SENTENCE =
  "The runtime image does not serve kDrive yet: until the HTTP runtime and the kDrive adapter land (#6, #7), the container reports that the runtime is not implemented and exits 1.";

// Tokens are split on whitespace, quotes and brackets (linear, no backtracking).
const TOKEN_SEPARATOR = /[\s"'`<>()[\]]/u;
const SCHEME_CHAR = /[a-z0-9+.-]/iu;
const EMAIL_SEPARATOR = /[^A-Za-z0-9._%+@-]/u;
const TRAEFIK_HOST = /Host\(([^)]*)\)/gu;
const IP_PATTERN = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\.?\d)/gu;
const DENIED_PATH =
  /(?:^|[\s"'`(=:[,])\/(?:home|Users|root|srv|opt|var|etc|mnt|media|tmp)\//mu;
const WINDOWS_PATH = /\b[A-Za-z]:\\/u;
const CLAIMS =
  /production-ready|production ready|ready for production|fully working/iu;

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function reservedHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/u, "");
  return (
    name === "localhost" || /(?:^|\.)example\.(?:com|org|net)$/u.test(name)
  );
}

/** Every `scheme://…` URL in the text. */
export function urlsIn(text: string): string[] {
  const urls: string[] = [];
  for (const token of text.split(TOKEN_SEPARATOR)) {
    const marker = token.indexOf("://");
    if (marker <= 0) continue;
    let start = marker;
    while (start > 0 && SCHEME_CHAR.test(token.charAt(start - 1))) start -= 1;
    if (start < marker && token.length > marker + 3)
      urls.push(token.slice(start));
  }
  return urls;
}

function emailDomains(text: string): string[] {
  return text
    .split(EMAIL_SEPARATOR)
    .filter((token) => token.includes("@"))
    .map((token) => {
      let domain = token.split("@").at(-1) ?? "";
      while (domain.endsWith(".")) domain = domain.slice(0, -1);
      return domain;
    })
    .filter((domain) => domain.includes("."));
}

/** URL hosts, email domains and literal Traefik Host(...) arguments. */
export function scannedHosts(text: string): string[] {
  const hosts: string[] = [];
  const urls = urlsIn(text);
  for (const url of urls) {
    const authority = url.replace(/^[^:]+:\/\//u, "").split(/[/?#]/u)[0] ?? "";
    const host = (authority.split("@").at(-1) ?? "").replace(/:\d*$/u, "");
    if (!host.startsWith("${")) hosts.push(host);
  }
  let rest = text;
  for (const url of urls) rest = rest.replaceAll(url, " ");
  hosts.push(...emailDomains(rest));
  for (const match of text.matchAll(TRAEFIK_HOST))
    for (const argument of (match[1] ?? "").split(",")) {
      const host = argument.trim().replaceAll(/[`'"]/gu, "");
      if (host && !host.startsWith("${")) hosts.push(host);
    }
  return hosts;
}

/** BR-186 over one file's text. */
export function validateHygiene(path: string, text: string): void {
  for (const host of scannedHosts(text))
    check(reservedHost(host), `${path}: non-reserved host ${host}`);
  for (const [address] of text.matchAll(IP_PATTERN))
    check(
      address === "0.0.0.0" || address === "127.0.0.1",
      `${path}: address ${address}`,
    );
  let withoutUrls = text;
  for (const url of urlsIn(text))
    withoutUrls = withoutUrls.replaceAll(url, " ");
  check(!DENIED_PATH.test(withoutUrls), `${path}: installation path`);
  check(!WINDOWS_PATH.test(withoutUrls), `${path}: Windows drive path`);
  check(!CLAIMS.test(text), `${path}: deployment claim`);
}

function section(text: string, title: string): string {
  const start = text.indexOf(`\n## ${title}\n`);
  check(start >= 0, `section ${title}`);
  const rest = text.slice(start + title.length + 5);
  const end = rest.search(/\n## /u);
  return (end < 0 ? rest : rest.slice(0, end)).replaceAll(/\s+/gu, " ");
}

/** F-021 BR-187 v3: the required phrases of the Health check section. */
export const HEALTH_CHECK_PHRASES = [
  "/healthz",
  "node /app/dist/healthcheck.js",
  "127.0.0.1",
  "MCP_HTTP_PORT",
  "liveness",
  "--no-healthcheck",
  "Traefik",
  "healthy",
  "--port",
  "docker inspect",
  ".State.Health",
  "healthcheck failed:",
  "httpHeaders",
  "invalid_host",
  "timeoutSeconds",
  "GET",
] as const;

/** BR-187 v3: the `### 7. Verify` subsection, up to the next heading line. */
export function verifySubsection(text: string): string {
  const start = text.indexOf("\n### 7. Verify\n");
  check(start >= 0, "subsection 7. Verify");
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n#/u);
  return (end < 0 ? rest : rest.slice(0, end + 1)).replaceAll(/\s+/gu, " ");
}

/** F-021 BR-184 v2: no `healthcheck` key and a comment naming the docs. */
export function validateComposeHealth(text: string): void {
  check(
    !text
      .split("\n")
      .some((line) => line.trimStart().startsWith("healthcheck:")),
    "compose healthcheck key",
  );
  check(
    text
      .split("\n")
      .some(
        (line) =>
          line.trimStart().startsWith("#") &&
          line.includes("HEALTHCHECK") &&
          line.includes("docs/deployment.md"),
      ),
    "compose HEALTHCHECK comment",
  );
}

/** BR-187 v3: required sections and statements of docs/deployment.md. */
export function validateDeploymentDoc(text: string): void {
  validateHygiene("docs/deployment.md", text);
  for (const title of [
    "Build",
    "Personal server, step by step",
    "Health check",
    "Troubleshooting",
  ])
    section(text, title);
  check(
    !text
      .replaceAll(/\s+/gu, " ")
      .toLowerCase()
      .includes(V1_STATUS_SENTENCE.toLowerCase()),
    "v1 status sentence present",
  );
  const status = section(text, "Current status");
  check(!/not implemented/iu.test(status), "Current status: not implemented");
  for (const phrase of [
    "The runtime image serves kDrive",
    "nothing is published to a registry",
    "The runtime image has a `HEALTHCHECK`",
  ])
    check(status.includes(phrase), `Current status states ${phrase}`);
  check(
    !status.includes("It has no `HEALTHCHECK`"),
    "Current status: no HEALTHCHECK",
  );
  const health = section(text, "Health check");
  for (const phrase of HEALTH_CHECK_PHRASES)
    check(health.includes(phrase), `Health check states ${phrase}`);
  const verify = verifySubsection(text);
  for (const phrase of ["docker compose ps", "healthy"])
    check(verify.includes(phrase), `7. Verify states ${phrase}`);
  const startup = section(text, "Startup");
  for (const phrase of [
    "`0.0.0.0` is the container-internal bind address",
    "no host port is published",
    "`compose.yaml`",
    "`config.yaml`",
    "`--config /config/config.yaml`",
    "alternatives",
  ])
    check(startup.includes(phrase), `Startup states ${phrase}`);
  const shutdown = section(text, "Shutdown");
  for (const phrase of ["SIGTERM", "F-012 BR-169", "at least 10 s"])
    check(shutdown.includes(phrase), `Shutdown states ${phrase}`);
  const secrets = section(text, "Secrets");
  for (const phrase of [
    "readable by UID 1000",
    "never passed as environment values or build arguments",
  ])
    check(secrets.includes(phrase), `Secrets states ${phrase}`);
}

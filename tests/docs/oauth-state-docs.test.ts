import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CODES = [
  "OAUTH_STATE_UNAVAILABLE",
  "OAUTH_STATE_LOCKED",
  "OAUTH_STATE_CORRUPT",
  "OAUTH_STATE_VERSION",
  "OAUTH_STATE_MISMATCH",
] as const;

function collapsed(path: string): string {
  return readFileSync(path, "utf8").replaceAll(/\s+/gu, " ");
}

/** The text after a line that is exactly `## <title>` up to the next `## `. */
function section(path: string, title: string): string {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(`\n## ${title}\n`);
  expect(start, `${path} has the section ${title}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + title.length + 5);
  const end = rest.search(/\n## /u);
  return (end < 0 ? rest : rest.slice(0, end)).replaceAll(/\s+/gu, " ");
}

/** Case-insensitive substring check on whitespace-collapsed text. */
function expectText(text: string, phrase: string): void {
  expect(text.toLowerCase(), phrase).toContain(phrase.toLowerCase());
}

const PROXY_DOC = "docs/oauth-proxy.md";
const DEPLOYMENT_DOC = "docs/deployment.md";

describe("BR-313 docs/oauth-proxy.md states the persistent OAuth state (F-019 AC-20)", () => {
  const doc = collapsed(PROXY_DOC);

  it("BR-313 replaces the old restart section", () => {
    expect(doc).not.toContain("## Restart and residual risks");
    expect(doc).not.toContain("All state is in memory in one instance.");
  });

  it("BR-313 states what OAUTH_STATE_FILE persists and what a restart still loses", () => {
    for (const phrase of [
      "persists registered clients and refresh families",
      "pending consents, upstream flows, authorization codes and the discovery and JWKS caches",
      "never stores an upstream access, refresh or ID token",
      "`stderr` has no special meaning",
    ])
      expectText(doc, phrase);
  });

  it("BR-313 states the file and directory requirements", () => {
    for (const phrase of [
      "owned by the user the server runs as (UID 1000 in the image)",
      "mode `0600`",
      "not a symlink",
      "one link",
      "`<path>-wal` or `<path>-shm`",
      "local file system",
      "one instance",
    ])
      expectText(doc, phrase);
  });

  it("BR-313 names each startup code with its operator action", () => {
    const codes = section(PROXY_DOC, "State file startup errors");
    for (const code of CODES) expect(codes, code).toContain(code);
    for (const phrase of [
      "Action:",
      "The OAuth state file could not be opened or is not private.",
      "The OAuth state file is in use by another process.",
      "The OAuth state file is not a valid OAuth state file.",
      "The OAuth state file was written by a newer version.",
      "The OAuth state file belongs to another issuer, audience or upstream.",
    ])
      expectText(codes, phrase);
  });

  it("BR-313 states the signing key, journal and revoke-all actions", () => {
    for (const phrase of [
      "replacing the signing key keeps refresh families valid while access tokens fail until they are refreshed",
      "`<path>-journal` belongs to the store",
      "never delete, move or copy it apart from the file",
      "delete the file and its `<path>-journal` while the server is stopped",
      "every user logs in again",
    ])
      expectText(doc, phrase);
  });

  it("BR-313 states the credential-store warning", () => {
    for (const phrase of [
      "Treat the mount as a credential store",
      "anyone who can write the file or its directory can add a client and a family for an allowlisted subject and obtain tokens after the next restart",
      "restoring an older copy brings back families revoked or rotated since",
      "the same protection as the signing key",
      "never restore the file from a backup",
    ])
      expectText(doc, phrase);
  });

  it("BR-313 states the store_write_failed and downgrade operator actions", () => {
    for (const phrase of [
      "`store_write_failed`",
      '`handler` (`"register"` or `"token"`)',
      '`store` (`"clients"` or `"families"`)',
      "`store_loaded`",
      "`clients` and `families`",
      "fix the cause, then restart",
      "the revocation whose failed commit latched the store is lost at that restart",
      "replacing the file is the only way to be sure that no revoked family returns",
      "generic 503 `busy` page",
      "replace the file before upgrading again",
    ])
      expectText(doc, phrase);
  });

  it("BR-313 states the residual risks", () => {
    const risks = section(PROXY_DOC, "Residual risks");
    for (const phrase of [
      "no integrity check",
      "honour `fsync`",
      "refresh requests are limited only by the process-wide window",
      "removed from the allowlist",
      "crash or dropped connection",
      "<path>-wal",
    ])
      expectText(risks, phrase);
  });
});

describe("BR-314 deployment guide and examples cover the state file (F-019 AC-20)", () => {
  it("BR-314 the audit-log section states the shared writable mount", () => {
    const audit = section(DEPLOYMENT_DOC, "Write and share modes: audit log");
    expect(audit).toContain("`OAUTH_STATE_FILE`");
    expect(audit).toContain("same writable mount");
    expect(audit).toContain("/audit/oauth-state.sqlite");
  });

  it("BR-314 the step-by-step guide explains how to enable it", () => {
    const guide = section(DEPLOYMENT_DOC, "Personal server, step by step");
    expect(guide).toContain("OAUTH_STATE_FILE");
    expect(guide).toContain("/audit/oauth-state.sqlite");
  });

  it("BR-314 Troubleshooting covers each OAUTH_STATE_* line", () => {
    const troubleshooting = section(DEPLOYMENT_DOC, "Troubleshooting");
    for (const code of CODES) expect(troubleshooting, code).toContain(code);
    expect(troubleshooting).toContain("docs/oauth-proxy.md");
  });

  it("BR-314 every OAUTH_STATE_* code appears in both documents", () => {
    const proxy = collapsed(PROXY_DOC);
    const deployment = collapsed(DEPLOYMENT_DOC);
    for (const code of CODES) {
      expect(proxy, code).toContain(code);
      expect(deployment, code).toContain(code);
    }
  });

  it("BR-314 the examples add commented lines only, under /audit/", () => {
    for (const path of ["examples/compose.yaml", "examples/config.yaml"]) {
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => /OAUTH_STATE_FILE|oauthStateFile/u.test(line));
      expect(lines.length, path).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.trimStart().startsWith("#"), `${path}: ${line}`).toBe(true);
        expect(line, path).toContain("/audit/oauth-state.sqlite");
      }
    }
  });

  it("BR-314 no document or example uses a state path outside /audit/", () => {
    for (const path of [
      DEPLOYMENT_DOC,
      PROXY_DOC,
      "examples/compose.yaml",
      "examples/config.yaml",
    ]) {
      const text = readFileSync(path, "utf8");
      for (const token of text.split(/[\s`"']+/u)) {
        if (!token.includes("oauth-state")) continue;
        const state = token.slice(token.lastIndexOf("=") + 1);
        if (state.includes("/"))
          expect(state.startsWith("/audit/"), `${path}: ${state}`).toBe(true);
      }
    }
  });
});

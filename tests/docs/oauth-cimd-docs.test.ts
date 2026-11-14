// F-028 AC-11 (BR-395): the CIMD documentation.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

function expectText(text: string, phrase: string): void {
  expect(text.toLowerCase(), phrase).toContain(phrase.toLowerCase());
}

const TITLE = "Client ID Metadata Documents (`OAUTH_ALLOWED_CLIENT_ID_ORIGINS`)";

describe("BR-395 docs/oauth-proxy.md CIMD section (F-028 AC-11)", () => {
  const doc = section("docs/oauth-proxy.md", TITLE);

  it("BR-395 states the default, the grammar and the advertisement to every client", () => {
    for (const phrase of [
      "CIMD is off while the list is empty",
      "`https://<host>` or `https://<host>:<port>`",
      "at most 16 entries",
      "A-labels",
      "advertises CIMD to every client",
      "claude.ai, Claude iOS, Claude Desktop, ChatGPT and Codex",
      "no documented fallback to dynamic registration",
      "the document origin of every CIMD-capable client in use, or stays empty",
    ])
      expectText(doc, phrase);
  });

  it("BR-395 lists an origin only when its vendor controls every path, and explains origins", () => {
    for (const phrase of [
      "only when its vendor controls every path under it",
      "any document under a listed origin is accepted",
      "several document URLs under one origin",
      "per-callback document",
    ])
      expectText(doc, phrase);
  });

  it("BR-395 holds the origin discovery procedure", () => {
    for (const phrase of [
      "OAUTH_ALLOWED_CLIENT_ID_ORIGINS=https://cimd-discovery.invalid",
      "remove that connector in the client and add it again",
      "the browser address bar shows the `client_id` query parameter",
      "whose origin is the value to list",
      "record the origins found in the client matrix",
    ])
      expectText(doc, phrase);
  });

  it("BR-395 states the redirect allowlist limit and its single action at authorization", () => {
    for (const phrase of [
      "still limited to `OAUTH_ALLOWED_REDIRECT_URIS`",
      "removing a URI from it does not cut off a CIMD client already holding a refresh family",
    ])
      expectText(doc, phrase);
  });

  it("BR-395 states the fetch limits, the proxy-variable limit and NODE_EXTRA_CA_CERTS", () => {
    for (const phrase of [
      "5,120 bytes",
      "5,000 ms",
      "at most four concurrent fetches",
      "no redirect is followed",
      "IPv6 only inside `2000::/3`",
      "ignores proxy variables",
      "CIMD is unusable where egress must go through a proxy",
      "`NODE_EXTRA_CA_CERTS` extends the CAs trusted for the fetch",
    ])
      expectText(doc, phrase);
  });

  it("BR-395 states the cut-off, the access-token lifetime and the version 2 downgrade path", () => {
    for (const phrase of [
      "removing an origin is the only cut-off for its clients",
      "effective at the restart that applies it",
      "access tokens already issued to those clients stay valid until they expire (one hour) unless the signing key is replaced",
      "version 2 while it holds a CIMD family",
      "`OAUTH_STATE_VERSION`",
      "remove the origins, start this release once, then downgrade",
    ])
      expectText(doc, phrase);
  });

  it("BR-395 states the accepted residual risks of D-8", () => {
    for (const phrase of [
      "the owner of a listed origin controls the document",
      "ignores `/etc/hosts`",
      "TLS-intercepting proxy",
      "the 503 page during a remote outage",
    ])
      expectText(doc, phrase);
  });
});

describe("BR-395 deployment, example, security and matrix (F-028 AC-11)", () => {
  it("BR-395 docs/deployment.md lists the variable", () => {
    expectText(collapsed("docs/deployment.md"), "OAUTH_ALLOWED_CLIENT_ID_ORIGINS");
  });

  it("BR-395 .env.example has the variable empty", () => {
    expect(readFileSync(".env.example", "utf8")).toMatch(
      /^OAUTH_ALLOWED_CLIENT_ID_ORIGINS=$/mu,
    );
  });

  it("BR-395 SECURITY.md names the SSRF limits", () => {
    const security = section("SECURITY.md", "Client ID Metadata Documents (F-028)");
    for (const phrase of [
      "server-side request forgery",
      "off by default",
      "listed origins",
      "5,120 bytes",
      "5,000 ms",
      "four concurrent fetches",
      "no redirect",
      "pinned",
    ])
      expectText(security, phrase);
  });

  it("BR-395 the client matrix notes the advertisement condition and the discovery procedure", () => {
    const matrix = collapsed("docs/mcp-client-compatibility.md");
    expectText(
      matrix,
      "the proxy advertises CIMD only with a nonempty `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`",
    );
    expectText(matrix, "origin discovery procedure");
  });

  it("D-12 no shipped document or example names a client document origin", () => {
    for (const path of [
      "docs/oauth-proxy.md",
      ".env.example",
      "examples/compose.yaml",
      "examples/config.yaml",
      "SECURITY.md",
    ]) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/ALLOWED_CLIENT_ID_ORIGINS[=:]\s*\S*chatgpt/iu);
      expect(text, path).not.toContain("https://chatgpt.com/oauth");
    }
  });
});

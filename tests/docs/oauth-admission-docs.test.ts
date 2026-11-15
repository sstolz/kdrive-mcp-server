import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateHygiene } from "../helpers/deployment.js";

const oauth = readFileSync("docs/oauth-proxy.md", "utf8");
const deployment = readFileSync("docs/deployment.md", "utf8");
const prose = (text: string) => text.replaceAll(/\s+/gu, " ");

it("BR-421 BR-162 v3 AC-20 the operator documentation describes peer admission", () => {
  for (const text of [oauth, deployment].map(prose)) {
    for (const statement of [
      "F-035 pending acceptance",
      "`MCP_HTTP_TRUSTED_PROXIES` is optional and empty by default",
      "Use exact proxy addresses or a dedicated access-controlled proxy-only network",
      "Every trusted hop must append the upstream address it observed as the last `X-Forwarded-For` element",
      "Trusting a whole shared network trusts every container on it",
      "An untrusted container on a listed shared network can connect directly to the server and send a victim's address in `X-Forwarded-For`",
      "This selects the victim's peer and can exhaust its window",
      "Exact proxy addresses or an isolated proxy-only network prevent that trust mistake",
      "A residential `/56` or `/48` supplies 256 or 65,536 `/64` peers",
      "one home line can cross the two-peer or twenty-peer global barriers",
    ])
      expect(text).toContain(statement);
  }
  const text = prose(oauth);
  expect(text).toContain(
    "IPv6 addresses are grouped by their first 64 bits (`/64`)",
  );
  expect(text).toContain(
    "A shared hosted-client egress gets only 60 token requests per minute even with spare global capacity",
  );
  expect(text).toContain("At most 32 elements are examined from the right");
  expect(text).toContain(
    "The server reads `X-Forwarded-For` only when the socket address is trusted",
  );
  expect(text).toContain(
    "`Forwarded`, `X-Real-IP` and other `X-Forwarded-*` headers are ignored",
  );
  expect(text).not.toContain("does not handle `X-Forwarded-*` headers");
  for (const row of [
    "| `register` | 30 | 60 | 3,600 s | 119 |",
    "| `authorize` | 30 | 60 | 60 s | 119 |",
    "| `consent` | 30 | 60 | 60 s | 119 |",
    "| `callback` | 30 | 60 | 60 s | 119 |",
    "| `token` | 60 | 1,200 | 60 s | 2,399 |",
  ])
    expect(text).toContain(row);
});

it("BR-186 v2 AC-20 deployment guidance keeps address privacy", () => {
  expect(() => {
    validateHygiene("docs/deployment.md", deployment);
  }).not.toThrow();
  expect(prose(deployment)).toContain(
    "socket `CONTAINER_ADDRESS`, header `X-Forwarded-For: VICTIM_ADDRESS`",
  );
  expect(prose(deployment)).toContain(
    "Required installation-specific values use `${NAME:?…}`; optional values may use `${NAME:-}` with an empty default",
  );
  expect(() => {
    validateHygiene("docs/deployment.md", deployment + "\n192.0.2.1\n");
  }).toThrow();
});

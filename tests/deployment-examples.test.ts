import { generateKeyPairSync } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadConfiguration } from "../src/config.js";
import {
  HEALTH_CHECK_PHRASES,
  V1_STATUS_SENTENCE,
  validateComposeHealth,
  validateDeploymentDoc,
  validateHygiene,
} from "./helpers/deployment.js";

const composeText = readFileSync("examples/compose.yaml", "utf8");
const configText = readFileSync("examples/config.yaml", "utf8");
const docText = readFileSync("docs/deployment.md", "utf8");

interface Service {
  image: string;
  user: string;
  read_only: boolean;
  cap_drop: string[];
  security_opt: string[];
  init: boolean;
  restart: string;
  stop_signal: string;
  stop_grace_period: string;
  ports?: unknown;
  command?: unknown;
  healthcheck?: unknown;
  environment: Record<string, string>;
  secrets: { source: string; target: string }[];
  labels: Record<string, string>;
}
interface Compose {
  services: Record<string, Service>;
  secrets: Record<string, { file: string }>;
}

const compose = parse(composeText) as Compose;
const services = Object.values(compose.services);
const service = services[0] as Service;
const VARIABLE = /^\$\{[A-Z][A-Z0-9_]*:\?[^}]+\}$/u;
const SAMPLE: Record<string, string> = {
  MCP_PUBLIC_URL: "https://mcp.example.com/mcp",
  KDRIVE_ID: "1",
  OAUTH_ISSUER: "https://idp.example.com",
  OAUTH_ALLOWED_EMAILS: "user@example.com",
  OAUTH_UPSTREAM_CLIENT_ID: "client.example.com",
  OAUTH_ALLOWED_REDIRECT_URIS: "https://client.example.org/callback",
};

let directory = "";
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

/** Synthetic credential files; returns their paths by /run/secrets/ name. */
function credentials(): Record<string, string> {
  directory = mkdtempSync(join(tmpdir(), "kdrive-examples-"));
  const files: Record<string, string> = {
    "kdrive-token": "synthetic-kdrive-token",
    "upstream-client-secret": "synthetic-upstream-secret",
    "signing-key.pem": generateKeyPairSync("ec", {
      namedCurve: "P-256",
    }).privateKey.export({ type: "pkcs8", format: "pem" }),
  };
  return Object.fromEntries(
    Object.entries(files).map(([name, content]) => {
      const path = join(directory, name);
      writeFileSync(path, content);
      return [`/run/secrets/${name}`, path];
    }),
  );
}

function durationSeconds(value: string): number {
  const match = /^(\d+)([sm])$/u.exec(value);
  if (!match) return 0;
  return Number.parseInt(match[1] ?? "0", 10) * (match[2] === "m" ? 60 : 1);
}

describe("F-013 AC-07 deployment examples", () => {
  it("BR-184 hardens the single Compose service without ports or command", () => {
    expect(services).toHaveLength(1);
    expect(service.image).toMatch(/^\$\{KDRIVE_MCP_IMAGE:\?[^}]+\}$/u);
    expect(service.user).toBe("1000:1000");
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    expect(service.init).toBe(true);
    expect(service.restart).toBe("on-failure:3");
    expect(service.stop_signal).toBe("SIGTERM");
    expect(durationSeconds(service.stop_grace_period)).toBeGreaterThanOrEqual(
      10,
    );
    expect(service.ports).toBeUndefined();
    expect(service.command).toBeUndefined();
  });

  it("BR-184 sets the HTTP proxy settings and file secrets only", () => {
    const env = service.environment;
    expect(env).toMatchObject({
      KDRIVE_MCP_TRANSPORT: "http",
      OAUTH_MODE: "proxy",
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_PORT: "3000",
    });
    expect(env).not.toHaveProperty("KDRIVE_TOKEN");
    expect(env).not.toHaveProperty("OAUTH_UPSTREAM_CLIENT_SECRET");
    const targets = service.secrets.map(
      (entry) => `/run/secrets/${entry.target}`,
    );
    for (const name of [
      "KDRIVE_TOKEN_FILE",
      "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
      "OAUTH_SIGNING_KEY_FILE",
    ])
      expect(targets).toContain(env[name]);
    expect(targets).toHaveLength(3);
    for (const entry of service.secrets)
      expect(compose.secrets[entry.source]?.file).toMatch(VARIABLE);
    for (const name of Object.keys(SAMPLE)) expect(env[name]).toMatch(VARIABLE);
  });

  it("BR-184 routes a Traefik Host rule to port 3000", () => {
    const labels = service.labels;
    const rules = Object.entries(labels).filter(([key]) =>
      /^traefik\.http\.routers\.[^.]+\.rule$/u.test(key),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.[1]).toMatch(/^Host\(`\$\{[A-Z_]+:\?[^}]+\}`\)$/u);
    expect(labels["traefik.enable"]).toBe("true");
    const ports = Object.entries(labels).filter(([key]) =>
      /^traefik\.http\.services\.[^.]+\.loadbalancer\.server\.port$/u.test(key),
    );
    expect(ports.map(([, value]) => value)).toEqual(["3000"]);
  });

  it("BR-184 Compose environment loads as HTTP proxy configuration", async () => {
    const files = credentials();
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(service.environment))
      env[name] = VARIABLE.test(value)
        ? (SAMPLE[name] ?? "")
        : (files[value] ?? value);
    const config = await loadConfiguration({ argv: [], env, cwd: directory });
    expect(config.transport).toBe("http");
    expect(config.oauthMode).toBe("proxy");
    expect(config.httpHost).toBe("0.0.0.0");
    expect(config.httpPort).toBe(3000);
  });

  it("BR-185 YAML alternative uses file credentials under /run/secrets/ and loads", async () => {
    const yaml = parse(configText) as Record<string, unknown>;
    expect(yaml).toMatchObject({
      transport: "http",
      oauthMode: "proxy",
      httpHost: "0.0.0.0",
      httpPort: 3000,
    });
    for (const key of ["token", "oauthUpstreamClientSecret"])
      expect(yaml).not.toHaveProperty(key);
    for (const key of [
      "tokenFile",
      "oauthUpstreamClientSecretFile",
      "oauthSigningKeyFile",
    ])
      expect(yaml[key]).toMatch(/^\/run\/secrets\/[a-z.-]+$/u);
    const files = credentials();
    let text = configText;
    for (const [secret, path] of Object.entries(files))
      text = text.replaceAll(secret, path);
    writeFileSync(join(directory, "config.yaml"), text);
    const config = await loadConfiguration({
      argv: ["--config", "config.yaml"],
      env: {},
      cwd: directory,
    });
    expect(config.transport).toBe("http");
    expect(config.oauthMode).toBe("proxy");
  });
});

describe("F-013 AC-08 deployment hygiene", () => {
  const scanned: Record<string, string> = {
    "docs/deployment.md": docText,
    ...Object.fromEntries(
      readdirSync("examples").map((name) => [
        `examples/${name}`,
        readFileSync(join("examples", name), "utf8"),
      ]),
    ),
  };

  it("BR-186 examples and the deployment doc use only reserved hosts, allowed addresses and no installation path", () => {
    expect(Object.keys(scanned)).toEqual(
      expect.arrayContaining(["examples/compose.yaml", "examples/config.yaml"]),
    );
    for (const [path, text] of Object.entries(scanned))
      expect(() => {
        validateHygiene(path, text);
      }).not.toThrow();
  });

  it("BR-187 v2 deployment doc has the required sections and statements", () => {
    expect(() => {
      validateDeploymentDoc(docText);
    }).not.toThrow();
  });

  it("BR-186 URL paths do not count as installation paths", () => {
    expect(() => {
      validateHygiene(
        "x",
        "url: https://mcp.example.com/mcp and https://example.org/home/x\n",
      );
    }).not.toThrow();
  });

  const mutations: Record<string, string> = {
    "non-reserved hostname": "See https://mcp.acme-corp.io/mcp.\n",
    "non-reserved email": "Contact admin@acme-corp.io.\n",
    "non-reserved Traefik host": "rule: Host(`mcp.acme-corp.io`)\n",
    "private address": "Bind 10.0.0.1.\n",
    "home path": "Mount /home/alice/secrets.\n",
    "Windows path": String.raw`Copy C:\keys\token.` + "\n",
    claim: "This image is production-ready.\n",
  };
  it.each(Object.keys(mutations))(
    "BR-186 BR-187 rejects seeded mutation: %s",
    (name) => {
      expect(() => {
        validateDeploymentDoc(`${docText}\n${mutations[name] ?? ""}`);
      }).toThrow();
      expect(() => {
        validateHygiene(
          "examples/compose.yaml",
          `${composeText}\n# ${mutations[name] ?? ""}`,
        );
      }).toThrow();
    },
  );

  const v2Mutations: Record<string, string> = {
    "the v1 sentence in Current status": docText.replace(
      "\n## Current status\n",
      `\n## Current status\n\n${V1_STATUS_SENTENCE}\n`,
    ),
    "the v1 sentence in another section": docText.replace(
      "\n## Build\n",
      `\n## Build\n\n${V1_STATUS_SENTENCE}\n`,
    ),
    "not implemented in Current status": docText.replace(
      "\n## Current status\n",
      "\n## Current status\n\nThe runtime is Not Implemented.\n",
    ),
    "a doc without The runtime image serves kDrive": docText.replace(
      "The runtime image serves kDrive",
      "The image works",
    ),
    "a doc without nothing is published to a registry": docText.replace(
      "nothing is published to a registry",
      "it is available",
    ),
    "a doc without the Personal server section": docText.replace(
      "\n## Personal server, step by step\n",
      "\n## Personal server\n",
    ),
    "a doc without the Troubleshooting section": docText.replace(
      "\n## Troubleshooting\n",
      "\n## Problems\n",
    ),
  };
  it.each(Object.keys(v2Mutations))("BR-187 v2 rejects %s", (name) => {
    const mutated = v2Mutations[name] ?? "";
    expect(mutated).not.toBe(docText);
    expect(() => {
      validateDeploymentDoc(mutated);
    }).toThrow();
  });
});

describe("F-021 AC-10 health check deployment", () => {
  const healthStart = docText.indexOf("\n## Health check\n");
  const healthEnd = docText.indexOf("\n## ", healthStart + 1);
  const withHealth = (change: (section: string) => string) =>
    docText.slice(0, healthStart) +
    change(docText.slice(healthStart, healthEnd)) +
    docText.slice(healthEnd);
  const verifyStart = docText.indexOf("\n### 7. Verify\n");
  const verifyEnd = docText.indexOf("\n#", verifyStart + 1);
  const withVerify = (change: (section: string) => string) =>
    docText.slice(0, verifyStart) +
    change(docText.slice(verifyStart, verifyEnd)) +
    docText.slice(verifyEnd);

  it("BR-184 v2 the Compose service has no healthcheck key and points to the docs", () => {
    expect(service.healthcheck).toBeUndefined();
    expect(service.environment.MCP_HTTP_PORT).toBe("3000");
    expect(() => {
      validateComposeHealth(composeText);
    }).not.toThrow();
  });

  it.each([
    [
      "a healthcheck key",
      composeText.replace(
        "    stop_signal: SIGTERM\n",
        '    stop_signal: SIGTERM\n    healthcheck:\n      test: ["CMD", "true"]\n',
      ),
    ],
    [
      "no HEALTHCHECK comment",
      composeText
        .split("\n")
        .filter((line) => !(line.includes("#") && line.includes("HEALTHCHECK")))
        .join("\n"),
    ],
  ])("BR-184 v2 rejects %s", (_name, mutated) => {
    expect(mutated).not.toBe(composeText);
    expect(() => {
      validateComposeHealth(mutated);
    }).toThrow();
  });

  it("BR-187 v3 the deployment doc has the Health check section and the Verify wait", () => {
    expect(healthStart).toBeGreaterThan(0);
    expect(verifyStart).toBeGreaterThan(0);
    expect(() => {
      validateDeploymentDoc(docText);
    }).not.toThrow();
  });

  const v3Mutations: Record<string, string> = {
    "It has no HEALTHCHECK kept": docText.replace(
      "\n## Current status\n",
      "\n## Current status\n\nIt has no `HEALTHCHECK`.\n",
    ),
    "no The runtime image has a HEALTHCHECK": docText.replace(
      /The runtime image has a\s+`HEALTHCHECK`/u,
      "The runtime image is checked",
    ),
    "no Health check section": docText.replace(
      "\n## Health check\n",
      "\n## Health\n",
    ),
    "docker compose ps removed from step 7": withVerify((text) =>
      text.replaceAll(/docker\s+compose\s+ps/gu, "docker ps"),
    ),
    "healthy removed from step 7": withVerify((text) =>
      text.replaceAll("healthy", "up"),
    ),
    ...Object.fromEntries(
      HEALTH_CHECK_PHRASES.map((phrase) => [
        `Health check without ${phrase}`,
        withHealth((text) => text.replaceAll(phrase, "")),
      ]),
    ),
  };
  it.each(Object.keys(v3Mutations))("BR-187 v3 rejects %s", (name) => {
    const mutated = v3Mutations[name] ?? "";
    expect(mutated).not.toBe(docText);
    expect(() => {
      validateDeploymentDoc(mutated);
    }).toThrow();
  });
});

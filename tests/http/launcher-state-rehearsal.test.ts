// F-029 AC-05: rehearsal of the owner run through the real launcher path.
// `make http-acceptance` and its entry script run against a fake `docker`
// that records each argument; the container environment is derived from the
// recorded run arguments only, filtered by `acceptanceSettings` (the function
// `main()` uses) and started with the test seams of F-028 AC-12 only.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptanceSettings,
  startAcceptance,
} from "../../scripts/http-acceptance.ts";
import { productionAddressPolicy } from "../../src/auth/proxy/address-policy.js";
import {
  REHEARSAL_HOST,
  cimdCertificates,
  cimdDocument,
  reply,
  startDnsStub,
  startDocumentServer,
  type DnsStub,
  type DocumentServer,
} from "../helpers/cimd.js";
import { P, listeningPort } from "../helpers/http.js";
import {
  CLAUDE,
  FakeUpstream,
  UPSTREAM,
  UPSTREAM_CLIENT,
  syntheticPem,
  upstreamKey,
} from "../helpers/proxy.js";
import {
  authorizeTarget,
  call,
  callTool,
  login,
  refresh,
} from "../helpers/rehearsal.js";

const MAKE = "/usr/bin/make";
const ENTRY = "scripts/http-acceptance-entry.sh";
const STATE_FILE = "/run/oauth-state/oauth-state.sqlite";
// Unit and record separators between recorded arguments and calls.
const UNIT = "\u001f";
const RECORD = "\u001e";

let directories: string[] = [];
let double: DocumentServer | undefined;
let dns: DnsStub | undefined;
afterEach(async () => {
  await double?.close();
  await dns?.close();
  double = undefined;
  dns = undefined;
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories = [];
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

/** The AC-25 fixture checkout with a fake `docker` recording each argument. */
function checkout() {
  const root = temporary("kdrive-launcher-");
  copyFileSync("Makefile", join(root, "Makefile"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(ENTRY, join(root, ENTRY));
  for (const file of [
    "compose.yaml",
    "Dockerfile.dev",
    "package.json",
    "package-lock.json",
  ])
    writeFileSync(join(root, file), "fixture\n");
  mkdirSync(join(root, "bin"));
  const docker = join(root, "bin/docker");
  writeFileSync(
    docker,
    `#!/bin/sh\nfor arg in "$@"; do printf '%s${UNIT}' "$arg"; done >> "$FAKE_LOG"\nprintf '${RECORD}' >> "$FAKE_LOG"\n`,
  );
  chmodSync(docker, 0o755);
  return { root, docker, log: join(root, "calls") };
}

type Env = Record<string, string>;

/** Runs `make http-acceptance` and returns the recorded run arguments. */
function entryRun(fixture: ReturnType<typeof checkout>, env: Env): string[] {
  rmSync(fixture.log, { force: true });
  const result = spawnSync(
    MAKE,
    ["http-acceptance", `DOCKER=${fixture.docker}`],
    { cwd: fixture.root, env, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  const calls = readFileSync(fixture.log, "utf8")
    .split(RECORD)
    .filter((record) => record !== "")
    .map((record) => record.split(UNIT).slice(0, -1));
  const runs = calls.filter((args) =>
    args.includes("scripts/http-acceptance.ts"),
  );
  expect(runs).toHaveLength(1);
  return runs[0] ?? [];
}

/**
 * The container environment, derived only from the recorded arguments:
 * `-e NAME=value` as given, `-e NAME` from the environment passed to `make`,
 * values under a recorded `--volume` target mapped to its host directory.
 */
function containerEnvironment(args: string[], makeEnv: Env): Env {
  const mounts: Array<{ source: string; target: string }> = [];
  const env: Env = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1] ?? "";
    if (flag === "--volume") {
      const [source = "", target = ""] = value.split(":");
      mounts.push({ source, target });
      index += 1;
    } else if (flag === "-e") {
      const equals = value.indexOf("=");
      if (equals === -1) {
        const inherited = makeEnv[value];
        if (inherited !== undefined) env[value] = inherited;
      } else env[value.slice(0, equals)] = value.slice(equals + 1);
      index += 1;
    }
  }
  for (const [name, value] of Object.entries(env)) {
    const mount = mounts.find((entry) => value.startsWith(`${entry.target}/`));
    if (mount) env[name] = mount.source + value.slice(mount.target.length);
    else expect(name.endsWith("_FILE"), `${name} outside a mount`).toBe(false);
  }
  // The loopback publish: the only substitution.
  expect(env.MCP_HTTP_HOST).toBe("0.0.0.0");
  env.MCP_HTTP_HOST = "127.0.0.1";
  return env;
}

describe("F-029 AC-05 launcher rehearsal of the owner run", () => {
  it("BR-396 BR-397 BR-171 v3 AC-05 persists clients and refresh families across an entry restart", async () => {
    const fixture = checkout();
    const outside = temporary("kdrive-launcher-outside-");
    const secrets = join(outside, "secrets");
    mkdirSync(secrets);
    writeFileSync(
      join(secrets, "upstream-client-secret"),
      "SYNTHETIC-SECRET\n",
    );
    writeFileSync(join(secrets, "signing-key.pem"), syntheticPem());
    const state = temporary("kdrive-launcher-state-");
    const port = await listeningPort();

    let served = 0;
    let documentUrl = "";
    double = await startDocumentServer((request, response) => {
      served += 1;
      if (request.url !== "/client.json") {
        reply(response, 404, "{}");
        return;
      }
      reply(response, 200, JSON.stringify(cimdDocument(documentUrl)));
    });
    const doubleOrigin = `https://${REHEARSAL_HOST}:${String(double.port)}`;
    documentUrl = `${doubleOrigin}/client.json`;
    dns = await startDnsStub({ host: REHEARSAL_HOST, a: "127.0.0.1" });
    const seam = {
      dnsServers: [`127.0.0.1:${String(dns.port)}`],
      ca: [cimdCertificates().ca],
      addressPolicy: {
        allows: (address: string) =>
          address === "127.0.0.1" || productionAddressPolicy.allows(address),
      },
    };
    const upstream = new FakeUpstream();
    const idKey = await upstreamKey();
    upstream.jwks = { keys: [idKey.jwk] };

    // The owner environment of the procedure (step 2 and 4).
    const ownerEnv = (origins: string): Env => ({
      PATH: `${join(fixture.root, "bin")}:/usr/bin:/bin`,
      FAKE_LOG: fixture.log,
      HTTP_ACCEPTANCE_SECRETS_DIR: secrets,
      HTTP_ACCEPTANCE_STATE_DIR: state,
      HTTP_ACCEPTANCE_PORT: String(port),
      MCP_PUBLIC_URL: P,
      OAUTH_ISSUER: UPSTREAM,
      OAUTH_ALLOWED_SUBJECTS: "user-1",
      OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
      OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
      OAUTH_ALLOWED_CLIENT_ID_ORIGINS: origins,
    });
    const recordedStateFiles: string[] = [];
    const start = (origins: string) => {
      const makeEnv = ownerEnv(origins);
      const args = entryRun(fixture, makeEnv);
      recordedStateFiles.push(
        args.find((arg) => arg.startsWith("OAUTH_STATE_FILE=")) ?? "",
      );
      return startAcceptance({
        env: acceptanceSettings(containerEnvironment(args, makeEnv)),
        upstream,
        clientMetadataSeam: seam,
        stderr: () => undefined,
      });
    };
    const verifier = `synthetic-launcher-rehearsal-${"r".repeat(30)}`;
    const target = authorizeTarget(documentUrl, verifier, P);

    // Steps 2-3: discovery with a placeholder origin.
    const discovery = await start("https://cimd-discovery.invalid");
    let origin: string;
    try {
      const metadata = await call(
        port,
        "GET",
        "/.well-known/oauth-authorization-server/mcp",
      );
      expect(metadata.status).toBe(200);
      const refused = await call(port, "GET", target);
      expect(refused.status).toBe(400);
      const addressBar = new URL(`https://mcp.test${target}`);
      origin = new URL(addressBar.searchParams.get("client_id") ?? "").origin;
      expect(origin).toBe(doubleOrigin);
      expect(served).toBe(0);
    } finally {
      await discovery.close();
    }

    // Step 4: the origin, consent showing the client host, login, a tool call.
    const first = await start(origin);
    let issued: Record<string, string>;
    try {
      issued = await login({
        port,
        upstream,
        idKey,
        target,
        documentUrl,
        verifier,
        clientHost: REHEARSAL_HOST,
      });
      expect(served).toBe(1);
      expect(await callTool(port, issued.access_token ?? "")).toBe(200);
    } finally {
      await first.close();
    }
    expect(existsSync(join(state, "oauth-state.sqlite"))).toBe(true);

    // Step 5: a new entry run on the same directory; no new login.
    const postsBefore = upstream.calls.filter(
      (entry) => entry.kind === "post",
    ).length;
    const second = await start(origin);
    try {
      expect(await callTool(port, issued.access_token ?? "")).toBe(200);
      const refreshed = await refresh(
        port,
        issued.refresh_token ?? "",
        documentUrl,
      );
      expect(await callTool(port, refreshed.access_token ?? "")).toBe(200);
    } finally {
      await second.close();
    }
    // No upstream token request and no document fetch in run 2; the test
    // issued no authorize or consent request there.
    expect(upstream.calls.filter((entry) => entry.kind === "post").length).toBe(
      postsBefore,
    );
    expect(served).toBe(1);
    expect(recordedStateFiles).toStrictEqual(
      Array.from({ length: 3 }, () => `OAUTH_STATE_FILE=${STATE_FILE}`),
    );
    expect(
      readdirSync(state).every((name) =>
        ["oauth-state.sqlite", "oauth-state.sqlite-journal"].includes(name),
      ),
    ).toBe(true);
    expect(readdirSync(state)).toContain("oauth-state.sqlite");
    expect(realpathSync(state)).toBe(
      containerEnvironment(
        entryRun(fixture, ownerEnv(origin)),
        ownerEnv(origin),
      ).OAUTH_STATE_FILE?.replace(/\/oauth-state\.sqlite$/u, ""),
    );
  }, 60_000);
});

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// F-013 AC-06: scripts/image-smoke.sh against a stub docker that records each
// call's arguments (unit-separated) and fails one chosen check.

const SEPARATOR = String.fromCodePoint(0x1f);
const FLAGS = [
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
  "--tmpfs",
  "/run/secrets:uid=1000,gid=1000,mode=0700",
];

const STUB = String.raw`#!/bin/sh
s=$STUB_STATE
for a in "$@"; do printf '%s\037' "$a" >> "$s/calls"; done
printf '\n' >> "$s/calls"
f=$STUB_FAIL
cmd=$1
shift
case "$cmd" in
run)
  n=$(cat "$s/n" 2> /dev/null || printf 0)
  n=$((n + 1))
  printf '%s' "$n" > "$s/n"
  case "$*" in
    *smoke-*) kind=smoke ;;
    *--version*) kind=runtime-version ;;
    *"cli.js --http"*) kind=runtime-http ;;
    *"--entrypoint find"*) kind=runtime-find ;;
    *extraction-pdf*) kind=runtime-import ;;
    *"id -u"*) kind=runtime-uid ;;
    *healthcheck.js*) kind=healthcheck-down ;;
    *) kind=runtime-absent ;;
  esac
  printf '%s' "$kind" > "$s/kind-cid$n"
  printf '%s\n' "cid$n" >> "$s/started"
  printf '%s\n' "cid$n"
  ;;
wait)
  kind=$(cat "$s/kind-$1")
  code=0
  if test "$kind" = runtime-http; then code=1; fi
  if test "$kind" = healthcheck-down; then code=1; fi
  case "$f" in runtime-absent|runtime-import) if test "$kind" = "$f"; then code=1; fi ;; esac
  printf '%s\n' "$code"
  ;;
logs)
  kind=$(cat "$s/kind-$1")
  case "$kind" in
    runtime-version) if test "$f" = "$kind"; then echo 9.9.9; else echo 0.6.0-beta.1; fi ;;
    runtime-http) if test "$f" = "$kind"; then echo other >&2; else echo 'Configuration error [PREFLIGHT_FAILED] (preflight).' >&2; fi ;;
    runtime-find) if test "$f" = "$kind"; then echo /app/dist; fi ;;
    runtime-uid) if test "$f" = "$kind"; then echo 0; else echo 1000; fi ;;
    smoke) if test "$f" != startup; then echo 'http-acceptance listening on 127.0.0.1:3000'; fi ;;
    healthcheck-down) if test "$f" = "$kind"; then echo 'healthcheck failed: port' >&2; else echo 'healthcheck failed: connection' >&2; fi ;;
  esac
  ;;
exec)
  shift
  case "$*" in
    "id -u") if test "$f" = uid; then echo 0; else echo 1000; fi ;;
    "cat /proc/1/comm") if test "$f" = pid1; then echo sh; else echo node-MainThread; fi ;;
    *healthz*) if test "$f" = healthcheck-route; then printf '%s\n' '200|application/json|{"status":"ok"}' '403|application/json|{"error":"invalid_host"}' '403|application/json|{"error":"invalid_host"}'; else printf '%s\n' '200|application/json|{"status":"ok"}' '200|application/json|{"status":"ok"}' '403|application/json|{"error":"invalid_host"}'; fi ;;
    *POST*) if test "$f" = unauthenticated; then echo '200|'; else echo '401|Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'; fi ;;
    *) if test "$f" = metadata; then echo '404|text/plain|'; else echo '200|application/json|https://mcp.example.com/mcp'; fi ;;
  esac
  ;;
inspect)
  case "$*" in
    *Running*) if test "$f" = startup; then echo false; else echo true; fi ;;
    *ExitCode*) if test "$f" = sigterm; then echo 137; else echo 0; fi ;;
    *Health.Status*) if test "$f" = healthcheck-status; then echo none; else echo healthy; fi ;;
  esac
  ;;
image)
  if test "$f" = healthcheck-config; then echo '[CMD-SHELL curl -f http://127.0.0.1:3000/healthz]|30s|30s|0s|3'; else echo '[CMD node /app/dist/healthcheck.js]|10s|10s|30s|3'; fi
  ;;
esac
exit 0
`;

let state = "";
afterEach(() => {
  if (state) rmSync(state, { recursive: true, force: true });
  state = "";
});

function runSmoke(fail = "") {
  state = mkdtempSync(join(tmpdir(), "kdrive-image-smoke-"));
  const docker = join(state, "docker");
  writeFileSync(docker, STUB);
  chmodSync(docker, 0o755);
  const result = spawnSync(
    "/bin/sh",
    ["scripts/image-smoke.sh", "linux/amd64"],
    {
      env: {
        PATH: "/usr/bin:/bin",
        DOCKER: docker,
        STUB_STATE: state,
        STUB_FAIL: fail,
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  const calls = readFileSync(join(state, "calls"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(SEPARATOR).slice(0, -1));
  const started = readFileSync(join(state, "started"), "utf8")
    .split("\n")
    .filter(Boolean);
  return { result, calls, started };
}

function sorted(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function removed(calls: string[][]): string[] {
  return calls
    .filter((call) => call[0] === "rm")
    .map((call) => {
      expect(call.slice(0, 2)).toEqual(["rm", "-f"]);
      expect(call).toHaveLength(3);
      return call[2] ?? "";
    });
}

describe("F-013 AC-06 image smoke runner", () => {
  it("BR-176 BR-180 starts the smoke container with the hardened flags and exec'd Node", () => {
    const { result, calls, started } = runSmoke();
    expect(result.status, result.stderr).toBe(0);
    const runs = calls.filter((call) => call[0] === "run");
    expect(runs).toHaveLength(8);
    for (const run of runs) {
      expect(run.slice(0, 2 + FLAGS.length)).toEqual(["run", "-d", ...FLAGS]);
      expect(run).not.toContain("--init");
      expect(run).not.toContain("--privileged");
      expect(run).not.toContain("-p");
      expect(run.some((arg) => arg.startsWith("--publish"))).toBe(false);
    }
    const smoke =
      runs.find((run) => run.includes("kdrive-mcp-server:smoke-amd64")) ?? [];
    expect(smoke[2 + FLAGS.length]).toBe("--health-interval=2s");
    expect(
      runs.filter((run) => run.some((arg) => arg.startsWith("--health"))),
    ).toEqual([smoke]);
    expect(smoke.slice(-5, -1)).toEqual([
      "--entrypoint",
      "sh",
      "kdrive-mcp-server:smoke-amd64",
      "-c",
    ]);
    const script = smoke.at(-1) ?? "";
    expect(script).toMatch(
      /^node -e "[^"]+" && exec node \/app\/scripts\/http-acceptance\.ts$/u,
    );
    const settings = smoke
      .slice(3 + FLAGS.length, -5)
      .filter((arg) => arg !== "-e");
    expect(settings).toEqual(
      expect.arrayContaining([
        "MCP_HTTP_HOST=127.0.0.1",
        "MCP_HTTP_PORT=3000",
        "OAUTH_SIGNING_KEY_FILE=/run/secrets/signing-key.pem",
        "OAUTH_UPSTREAM_CLIENT_SECRET_FILE=/run/secrets/upstream-client-secret",
        "KDRIVE_TOKEN_FILE=/run/secrets/kdrive-token",
      ]),
    );
    for (const setting of settings) {
      expect(setting).not.toMatch(
        /^(?:KDRIVE_TOKEN|OAUTH_UPSTREAM_CLIENT_SECRET)=/u,
      );
      for (const host of setting.matchAll(/(?:\/\/|@)([a-z0-9.-]+)/gu))
        expect(host[1]).toMatch(/(?:^|\.)example\.com$/u);
    }
    expect(calls).toContainEqual(["stop", "--time", "10", "cid7"]);
    expect(sorted(removed(calls))).toEqual(sorted(started));
    expect(result.stdout).toContain("all checks passed");
  });

  it("BR-175 BR-180 runs the runtime --http check with generated secrets and the default CLI", () => {
    const { calls } = runSmoke();
    const http = calls.find((call) => call.at(-1)?.endsWith("cli.js --http"));
    expect(http?.slice(-5, -1)).toEqual([
      "--entrypoint",
      "sh",
      "kdrive-mcp-server:runtime-amd64",
      "-c",
    ]);
    expect(http?.at(-1)).toMatch(
      /^node -e "[^"]+" && exec node \/app\/dist\/cli\.js --http$/u,
    );
    expect(http).toContain("KDRIVE_TOKEN_FILE=/run/secrets/kdrive-token");
  });

  it("BR-180 v2 BR-181 v2 AC-08 runs the health checks before SIGTERM with a no-server probe container", () => {
    const { result, calls } = runSmoke();
    expect(result.status, result.stderr).toBe(0);
    const runs = calls.filter((call) => call[0] === "run");
    expect(runs.at(-1)).toEqual([
      "run",
      "-d",
      ...FLAGS,
      "--entrypoint",
      "node",
      "kdrive-mcp-server:runtime-amd64",
      "/app/dist/healthcheck.js",
    ]);
    const format =
      "{{.Config.Healthcheck.Test}}|{{.Config.Healthcheck.Interval}}|{{.Config.Healthcheck.Timeout}}|{{.Config.Healthcheck.StartPeriod}}|{{.Config.Healthcheck.Retries}}";
    const images = calls.filter((call) => call[0] === "image");
    expect(images).toEqual([
      [
        "image",
        "inspect",
        "--format",
        format,
        "kdrive-mcp-server:runtime-amd64",
      ],
      ["image", "inspect", "--format", format, "kdrive-mcp-server:smoke-amd64"],
    ]);
    const route = calls.find(
      (call) => call[0] === "exec" && call.join(" ").includes("/healthz"),
    );
    expect(route?.slice(0, 4)).toEqual(["exec", "cid7", "node", "-e"]);
    for (const host of [
      "127.0.0.1:3000",
      "mcp.example.com",
      "attacker.example",
    ])
      expect(route?.[4]).toContain(`'${host}'`);
    const status = calls.findIndex(
      (call) => call[0] === "inspect" && call.join(" ").includes("Health"),
    );
    const stop = calls.findIndex((call) => call[0] === "stop");
    const down = calls.findIndex((call) => call === runs.at(-1));
    expect(status).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(status);
    expect(stop).toBeGreaterThan(down);
    expect(calls[status]).toEqual([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      "cid7",
    ]);
  });

  it("BR-180 secret generation writes a P-256 signing key and two hex secrets with mode 0600", () => {
    const { calls } = runSmoke();
    const script =
      calls
        .find((call) => call.includes("kdrive-mcp-server:smoke-amd64"))
        ?.at(-1) ?? "";
    const code = /^node -e "([^"]+)"/u.exec(script)?.[1] ?? "";
    expect(code).toContain("generateKeyPairSync('ec',{namedCurve:'P-256'})");
    const target = mkdtempSync(join(tmpdir(), "kdrive-image-gen-"));
    try {
      const run = spawnSync(
        process.execPath,
        ["-e", code.replaceAll("/run/secrets/", `${target}/`)],
        { encoding: "utf8" },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(sorted(readdirSync(target))).toEqual([
        "kdrive-token",
        "signing-key.pem",
        "upstream-client-secret",
      ]);
      for (const name of readdirSync(target))
        expect(statSync(join(target, name)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(target, "signing-key.pem"), "utf8")).toContain(
        "BEGIN PRIVATE KEY",
      );
      for (const name of ["kdrive-token", "upstream-client-secret"])
        expect(readFileSync(join(target, name), "utf8")).toMatch(
          /^[0-9a-f]{64}$/u,
        );
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it.each([
    "runtime-version",
    "runtime-absent",
    "runtime-import",
    "runtime-find",
    "runtime-uid",
    "runtime-http",
    "startup",
    "uid",
    "pid1",
    "metadata",
    "unauthenticated",
    "healthcheck-config",
    "healthcheck-route",
    "healthcheck-status",
    "healthcheck-down",
    "sigterm",
  ])(
    "BR-181 BR-182 fails on check %s, names it once on stderr and removes only its containers",
    (check) => {
      const { result, calls, started } = runSmoke(check);
      expect(result.status).not.toBe(0);
      expect(result.stderr.trim().split("\n")).toEqual([
        `image-smoke linux/amd64: check failed: ${check}`,
      ]);
      expect(sorted(removed(calls))).toEqual(sorted(started));
      for (const call of calls) {
        expect(call[0]).not.toBe("rmi");
        expect(call[0]).not.toBe("volume");
        expect(call.join(" ")).not.toMatch(/prune/u);
      }
    },
  );

  it("BR-182 rejects an unsupported platform before calling docker", () => {
    const result = spawnSync(
      "/bin/sh",
      ["scripts/image-smoke.sh", "linux/s390x"],
      {
        env: { PATH: "/usr/bin:/bin", DOCKER: "/missing/docker" },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsupported platform");
  });
});

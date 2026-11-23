// F-050 v1 AC-08; BR-436 v1 and BR-437 v1.
// The owner manifest/report format is not fixed by F-050. These tests propose
// fixtures.json.info {file, folder, received?}; file/received carry independently
// known size_bytes and modified_at. The command prints a JSON `qualified` boolean.
// Only Docker, the clean-main probe and mounted path translation are doubled;
// Make, kdrive-entry.sh, the operator and the adapter/SDK remain real.
import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  CANARY,
  DRIVE,
  PUBLIC_ADDRESS,
  adapterFor,
  certificates,
  kdriveFixture,
  navigationClient,
  providerItem,
  success,
  tree,
} from "../helpers/kdrive.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const EPOCH = "1970-01-01T00:00:00Z";
const OWNER = 202;
const SHARED = 600;
const shared = {
  drive_id: OWNER, id: SHARED, parent_id: 77, type: "file", status: "ok",
  name: "CANARY_RECEIVED_NAME", path: "/Shared/CANARY_RECEIVED_NAME",
  parents: [], capabilities: { can_read: true }, size: 16, last_modified_at: 0,
};
let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

async function rehearsal(options: {
  received: boolean;
  rawDate?: unknown;
  expectedDate?: string;
}) {
  const f = (fixture = await kdriveFixture({
    drives: [{ id: DRIVE, role: "admin" }, { id: OWNER, role: "external" }],
    shared: [shared],
  }));
  f.drive.overrides.push((r) => {
    if (r.path === `/3/drive/${DRIVE}/files/12` || r.path === `/3/drive/${DRIVE}/files/11`) {
      const id = Number(r.path.split("/").at(-1));
      return success({ ...providerItem(tree, id), size: 16, last_modified_at: options.rawDate });
    }
    if (r.path === `/3/drive/${OWNER}/files/${SHARED}`) return success(shared);
    return undefined;
  });
  // Establish the existing authorization request budget independently of the
  // operator. Each designated item then permits exactly one additional direct
  // metadata GET; optional scalars authorize no further work.
  const refs = [{ driveId: DRIVE, id: 12 }, { driveId: DRIVE, id: 11 },
    ...(options.received ? [{ driveId: OWNER, id: SHARED }] : [])];
  const a = await adapterFor(f);
  const baseline = await navigationClient(a.dependencies, { KDRIVE_MCP_SHARED_WITH_ME: "1" });
  const budgets = new Map<string, number>();
  try {
    for (const ref of refs) {
      const before = f.apiRequests().length;
      await baseline.info(ref.id, ref.driveId);
      const path = `/3/drive/${ref.driveId}/files/${ref.id}`;
      budgets.set(path, f.apiRequests().slice(before).filter((r) => r.path === path).length + 1);
    }
  } finally { await baseline.close(); }

  const root = mkdtempSync(join(tmpdir(), "info-owner-entry-"));
  const owner = mkdtempSync(join(tmpdir(), "info-owner-inputs-"));
  mkdirSync(join(root, "bin"));
  copyFileSync("Makefile", join(root, "Makefile"));
  for (const name of ["scripts", "src", "dist", "node_modules"])
    symlinkSync(resolve(name), join(root, name));
  for (const name of ["compose.yaml", "Dockerfile.dev", "package.json", "package-lock.json"])
    copyFileSync(name, join(root, name));
  writeFileSync(join(owner, "kdrive-token"), `${CANARY}\n`);
  writeFileSync(join(owner, "fixtures.json"), JSON.stringify({ info: {
    file: { driveId: DRIVE, id: 12, size_bytes: 16, modified_at: options.expectedDate ?? EPOCH },
    folder: { driveId: DRIVE, id: 11 },
    ...(options.received ? { received: { driveId: OWNER, id: SHARED, size_bytes: 16, modified_at: EPOCH } } : {}),
  } }));
  const log = join(root, "docker-calls");
  writeFileSync(log, "");
  // Test-only module loading maps the read-only Compose mount and injects the
  // same lookup/connect pair used by tests/helpers/kdrive.ts. No live lookup
  // or connection can occur through the production transport.
  const hook = join(root, "transport.mjs");
  const injected = `import { connect } from 'node:tls';
export const productionLookup = async () => [{ address: ${JSON.stringify(PUBLIC_ADDRESS)}, family: 4 }];
export const productionConnect = (o) => connect({host:'127.0.0.1', port:${f.upstream.port}, servername:o.servername, ca:${JSON.stringify(certificates().ca)}});`;
  writeFileSync(hook, `import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  if (/\\/kdrive\\/production\\.(?:js|ts)$/.test(url)) return {format:'module',source:${JSON.stringify(injected)},shortCircuit:true};
  const result = next(url, context);
  if (url.includes('/scripts/') && url.endsWith('.ts')) {
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
    result.source = source.replaceAll('/run/kdrive-acceptance', ${JSON.stringify(owner)});
  }
  return result;
}});`);
  // Fake only the forge-independent clean-main probes, never this worktree's Git.
  writeFileSync(join(root, "bin/git"), `#!/bin/sh
case "$1" in
  status) exit 0 ;;
  rev-parse) printf '%s\\n' '${SHA}' ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const docker = join(root, "bin/docker");
  writeFileSync(docker, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');
const i = args.indexOf('node');
if (i < 0) process.exit(0);
const env = { PATH: process.env.PATH };
for (let n = 0; n < args.length; n++) if (args[n] === '-e') {
  const pair = args[++n]; const equal = pair.indexOf('=');
  env[pair.slice(0,equal)] = pair.slice(equal+1);
}
const result = spawnSync(${JSON.stringify(process.execPath)}, ['--import', ${JSON.stringify(pathToFileURL(hook).href)}, ...args.slice(i+1)], {env, stdio:'inherit', timeout:15000});
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  const before = f.apiRequests().length;
  const child = spawn("make", ["--no-print-directory", "-s", "kdrive-info-acceptance", `DOCKER=${docker}`], {
    cwd: root,
    env: { PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, KDRIVE_ACCEPTANCE_DIR: owner },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number | null>((done, reject) => {
    child.on("error", reject);
    child.on("close", done);
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  const command = calls.find((args) => args.includes("scripts/kdrive-info-acceptance.ts"));
  expect(command).toBeDefined();
  expect(command).toContain(`${owner}:/run/kdrive-acceptance:ro`);
  expect(command).toContain(`KDRIVE_ACCEPTANCE_SHA=${SHA}`);
  expect(command).toContain("KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token");
  return { f, refs, budgets, requests: f.apiRequests().slice(before), status, stdout, stderr };
}

it("TestBR437_v1_owner_procedure_rehearsal", async () => {
  for (const received of [false, true]) {
    for (const scenario of [
      { rawDate: 0, expectedDate: EPOCH, outcome: "passed" },
      { rawDate: undefined, expectedDate: EPOCH, outcome: "inconclusive" },
      { rawDate: "0", expectedDate: EPOCH, outcome: "inconclusive" },
      { rawDate: 1, expectedDate: EPOCH, outcome: "failed" },
    ]) {
      const run = await rehearsal({ received, ...scenario });
      try {
        const report = JSON.parse(run.stdout.trim()) as { qualified: boolean };
        expect(report.qualified).toBe(scenario.outcome === "passed");
        if (scenario.outcome === "passed") expect(run.status).toBe(0);
        else expect(`${run.stdout}\n${run.stderr}`).toMatch(
          scenario.outcome === "inconclusive" ? /inconclusive/iu : /fail|mismatch/iu,
        );
        if (scenario.outcome === "failed") expect(run.status).not.toBe(0);
      } finally { await run.f.close(); fixture = undefined; }
    }
  }
}, 60000);

it("TestBR436_v1_owner_procedure_bounds_and_redaction", async () => {
  for (const received of [false, true]) {
    const run = await rehearsal({ received, rawDate: 0 });
    try {
      expect(run.status).toBe(0);
      for (const [path, bound] of run.budgets) {
        const count = run.requests.filter((r) => r.path === path).length;
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count).toBeLessThanOrEqual(bound);
      }
      expect(run.requests.length).toBeLessThanOrEqual(32);
      expect(run.requests.every((r) => r.method === "GET" && !r.path.includes("download"))).toBe(true);
      const output = run.stdout + run.stderr;
      expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4096);
      for (const value of [CANARY, "a.bin", "/Private", shared.name, shared.path, "api.infomaniak.com", EPOCH])
        expect(output).not.toContain(value);
      for (const ref of run.refs) {
        expect(output).not.toMatch(new RegExp(`"(?:drive_id|driveId)"\\s*:\\s*${ref.driveId}\\b`, "u"));
        expect(output).not.toMatch(new RegExp(`"(?:id|file_id|folder_id)"\\s*:\\s*${ref.id}\\b`, "u"));
      }
      if (!received) expect(output).toMatch(/(?:received|share)[\s\S]{0,150}(?:unverified|risk|unavailable)/iu);
      else expect(run.requests.some((r) => r.path === `/3/drive/${OWNER}/files/${SHARED}`)).toBe(true);
    } finally { await run.f.close(); fixture = undefined; }
  }
}, 30000);

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const guardDirectory = mkdtempSync(join(tmpdir(), "kdrive-io-guard-"));
const guard = join(guardDirectory, "guard.mjs");
writeFileSync(
  guard,
  `
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
const deny = () => { throw new Error("Forbidden I/O attempted"); };
net.connect = deny; net.createConnection = deny; net.createServer = deny;
http.request = deny; http.get = deny; http.createServer = deny;
https.request = deny; https.get = deny; https.createServer = deny;
dgram.createSocket = deny; globalThis.fetch = deny;
tls.connect = deny; dns.lookup = deny; dns.promises.lookup = deny;
const readFileSync = fs.readFileSync;
fs.readFileSync = (path, ...args) => {
  if (String(path).includes(".env")) deny();
  return readFileSync(path, ...args);
};
syncBuiltinESMExports();
`,
);

export function runGuarded(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", guard, ...args], {
    cwd: guardDirectory,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
    timeout: 5_000,
  });
}
export function runDiagnostic(
  cli: string,
  args: string[],
  env: Record<string, string> = {},
) {
  return runGuarded([cli, ...args], env);
}

// F-028 AC-14: a child started with UV_THREADPOOL_SIZE=1. The production
// fetch port uses the real c-ares Resolver pointed, through the DNS server
// list seam, at the parent's stub UDP server that never answers. Four fetches
// stay pending while a file read and a pbkdf2 run on the single pool thread.
import { pbkdf2 } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClientMetadataFetch } from "../../dist/auth/proxy/client-metadata-fetch.js";

const dnsPort = process.argv[2];
const port = createClientMetadataFetch({
  dnsServers: [`127.0.0.1:${dnsPort}`],
  addressPolicy: { allows: () => true },
});
const start = Date.now();
const signal = new AbortController().signal;
const fetches = [1, 2, 3, 4].map((n) =>
  port
    .fetch(`https://host${String(n)}.example.com/c.json`, signal)
    .then((outcome) => ({ outcome, at: Date.now() - start })),
);
const file = readFile(new URL(import.meta.url)).then(() => Date.now() - start);
const hash = new Promise((resolve, reject) => {
  pbkdf2("synthetic", "salt", 1000, 32, "sha256", (error) => {
    if (error) reject(error);
    else resolve(Date.now() - start);
  });
});
const [results, fileAt, hashAt] = await Promise.all([
  Promise.all(fetches),
  file,
  hash,
]);
process.stdout.write(
  `${JSON.stringify({ start, fileAt, hashAt, results, printed: Date.now() })}\n`,
);

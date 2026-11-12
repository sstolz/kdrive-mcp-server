import { Agent, request } from "node:http";

// F-021 BR-326: the container health probe (`node /app/dist/healthcheck.js`).
// One GET /healthz to 127.0.0.1 through a dedicated agent with no proxy.

const HEALTH_BODY = '{"status":"ok"}';
const RATE_LIMITED_BODY = '{"error":"rate_limited"}';
const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1024;
const DEADLINE_MS = 5000;

/** The `healthcheck failed: <code>` codes. */
export type ProbeFailure =
  "port" | "connection" | "timeout" | "status" | "body";

/** BR-326: the port as the server's `integer` parser reads `MCP_HTTP_PORT`. */
export function probePort(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/u.test(value)) return undefined;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : undefined;
}

/** BR-326: one probe request; `undefined` when the server is alive. */
export async function probe(
  port: number,
  deadlineMs = DEADLINE_MS,
): Promise<ProbeFailure | undefined> {
  const agent = new Agent({ keepAlive: false, maxSockets: 1 });
  return await new Promise((resolve) => {
    let settled = false;
    const req = request({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/healthz",
      agent,
      headers: { host: `127.0.0.1:${String(port)}` },
    });
    const finish = (failure: ProbeFailure | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      agent.destroy();
      resolve(failure);
    };
    const timer = setTimeout(() => {
      finish("timeout");
    }, deadlineMs);
    req.on("error", () => {
      finish("connection");
    });
    req.on("response", (res) => {
      const status = res.statusCode;
      if (status !== 200 && status !== 429) {
        finish("status");
        return;
      }
      const expected = status === 200 ? HEALTH_BODY : RATE_LIMITED_BODY;
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) finish("body");
        else chunks.push(chunk);
      });
      res.on("end", () => {
        finish(
          Buffer.concat(chunks).toString("utf8") === expected
            ? undefined
            : "body",
        );
      });
      res.on("error", () => {
        finish("connection");
      });
      res.on("close", () => {
        if (!res.complete) finish("connection");
      });
    });
    req.end();
  });
}

async function main(): Promise<void> {
  const port = probePort(process.env.MCP_HTTP_PORT);
  const failure = port === undefined ? "port" : await probe(port);
  if (failure === undefined) process.exit(0);
  process.stderr.write(`healthcheck failed: ${failure}\n`);
  process.exit(1);
}

if (import.meta.main) await main();

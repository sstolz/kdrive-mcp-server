// F-019 AC-04/AC-05: one process holding or opening an OAuth state file.
// Usage: node oauth-store-child.mjs <path> <mode> [issuer audience upstream]
//   try   open, print "open" or the refusal code, close, exit
//   hold  open, print "open", then obey stdin lines: "commit", "close", "kill"
//   hot   interrupt a raw write so that a hot journal stays behind (SIGKILL)
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { openOAuthStateStore } from "../../dist/auth/proxy/store.js";

const [path, mode, issuer, audience, upstreamIssuer] = process.argv.slice(2);
const options = {
  path,
  binding: {
    issuer: issuer ?? "https://mcp.example/mcp",
    audience: audience ?? "https://mcp.example/mcp/",
    upstreamIssuer: upstreamIssuer ?? "https://idp.example",
  },
  allowedRedirectUris: [
    "https://a.example/cb",
    "https://claude.ai/api/mcp/auth_callback",
  ],
  clock: () => new Date("2026-11-11T10:00:00.000Z"),
};
const say = (line) => {
  process.stdout.write(`${line}\n`);
};

function open() {
  try {
    return openOAuthStateStore(options);
  } catch (error) {
    say(error.code ?? "unexpected");
    return undefined;
  }
}

if (mode === "hot") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA locking_mode=EXCLUSIVE; PRAGMA cache_size=2; BEGIN");
  db.exec("UPDATE clients SET name = 'interrupted', last_use = 1");
  process.kill(process.pid, "SIGKILL");
} else if (mode === "try") {
  const store = open();
  if (store) {
    say(`open ${String(store.clients.length)}`);
    store.close();
  }
} else {
  const store = open();
  if (store) {
    say("open");
    let next = 0;
    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      if (line === "commit") {
        next += 1;
        const id = String(next).padStart(43, "d");
        const result = store.commit([
          {
            op: "insertClient",
            client: {
              id,
              redirectUris: ["https://a.example/cb"],
              grantTypes: ["authorization_code"],
              method: "none",
              name: null,
              secretHash: null,
              lastUse: Date.parse("2026-11-11T10:00:00.000Z"),
            },
          },
        ]);
        say(`${result} ${String(statSync(`${path}-journal`).size)}`);
      } else if (line === "close") {
        store.close();
        say("closed");
        lines.close();
        process.stdin.destroy();
      } else if (line === "kill") {
        process.kill(process.pid, "SIGKILL");
      }
    });
  }
}

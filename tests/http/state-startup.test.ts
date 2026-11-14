// F-019 AC-06 (BR-297, BR-152 v2): store refusals stop startup before any
// listener, and the main entry writes only the fixed line.
import { mkdtemp, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openOAuthStateStore } from "../../src/auth/proxy/store.js";
import { startHttpServer } from "../../src/http/index.js";
import { stateOptions } from "../helpers/http-state.js";
import { P } from "../helpers/http.js";
import { kdriveFixture } from "../helpers/kdrive.js";
import { runMain, tokenFile } from "../helpers/main.js";
import {
  CLAUDE,
  Clock,
  STATE_BINDING,
  UPSTREAM,
  UPSTREAM_CLIENT,
  removeStateFiles,
  stateFile,
  syntheticPem,
} from "../helpers/proxy.js";
import { stateChild, type StateChild } from "../helpers/state-child.js";

const LINES = {
  OAUTH_STATE_UNAVAILABLE:
    "The OAuth state file could not be opened or is not private.",
  OAUTH_STATE_LOCKED: "The OAuth state file is in use by another process.",
  OAUTH_STATE_CORRUPT: "The OAuth state file is not a valid OAuth state file.",
  OAUTH_STATE_VERSION: "The OAuth state file was written by a newer version.",
  OAUTH_STATE_MISMATCH:
    "The OAuth state file belongs to another issuer, audience or upstream.",
} as const;
type Code = keyof typeof LINES;
const SEEDED = "SEEDED-ROW-VALUE-4b1d";

let holders: StateChild[] = [];
let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  for (const holder of holders) {
    holder.send("close");
    await holder.exited;
  }
  holders = [];
  await fixture?.close();
  fixture = undefined;
  removeStateFiles();
});

function created(path: string, binding = STATE_BINDING): void {
  openOAuthStateStore({
    path,
    binding,
    allowedRedirectUris: [CLAUDE],
    clock: new Clock().now,
  }).close();
}

/** Prepares a state file that the store refuses with `code`. */
async function refusal(code: Code): Promise<string> {
  const path = stateFile();
  switch (code) {
    case "OAUTH_STATE_UNAVAILABLE":
      return join(path, "missing", "state.db");
    case "OAUTH_STATE_LOCKED": {
      const holder = stateChild(path, "hold");
      holders.push(holder);
      expect(await holder.next()).toBe("open");
      return path;
    }
    case "OAUTH_STATE_CORRUPT":
      writeFileSync(path, `not a database ${SEEDED}`.repeat(8), {
        mode: 0o600,
      });
      return path;
    case "OAUTH_STATE_VERSION": {
      created(path);
      const db = new DatabaseSync(path);
      // BR-295 v2: version 2 is read since F-028; 3 is the first newer one.
      db.exec(`PRAGMA user_version=3; UPDATE meta SET value='${SEEDED}'`);
      db.close();
      return path;
    }
    case "OAUTH_STATE_MISMATCH":
      created(path, { ...STATE_BINDING, issuer: `https://${SEEDED}.test/mcp` });
      return path;
  }
}

const CODES = Object.keys(LINES) as Code[];

describe("BR-297 BR-152 v2 startup refusals (AC-06)", () => {
  it.each(CODES)(
    "BR-297 AC-06 startHttpServer raises %s before any listener exists",
    async (code) => {
      const path = await refusal(code);
      const { handlerOptions, logs } = await stateOptions(path);
      const listen = vi.fn();
      const failure = await startHttpServer({ ...handlerOptions, listen }).then(
        () => undefined,
        (error: unknown) => error as Error & { code?: string },
      );
      expect(failure?.code).toBe(code);
      expect(failure?.message).toBe(LINES[code]);
      expect(failure?.message).not.toContain(path);
      expect(failure?.message).not.toContain(SEEDED);
      expect(listen).not.toHaveBeenCalled();
      expect(logs).toEqual([]);
    },
  );

  it.each(CODES)(
    "BR-297 AC-06 the main entry writes exactly the %s line and exits 1",
    async (code) => {
      const path = await refusal(code);
      const f = (fixture = await kdriveFixture());
      const directory = await mkdtemp(join(tmpdir(), "kdrive-state-main-"));
      await writeFile(join(directory, "upstream-secret"), "SYNTHETIC-SECRET\n");
      await writeFile(join(directory, "signing.pem"), syntheticPem());
      const run = await runMain({
        argv: ["--http"],
        env: {
          KDRIVE_ID: "101",
          KDRIVE_TOKEN_FILE: tokenFile(),
          MCP_HTTP_HOST: "127.0.0.1",
          MCP_HTTP_PORT: "1",
          MCP_PUBLIC_URL: P,
          OAUTH_MODE: "proxy",
          OAUTH_ISSUER: UPSTREAM,
          OAUTH_ALLOWED_SUBJECTS: "user-1",
          OAUTH_UPSTREAM_CLIENT_ID: UPSTREAM_CLIENT,
          OAUTH_UPSTREAM_CLIENT_SECRET_FILE: join(directory, "upstream-secret"),
          OAUTH_SIGNING_KEY_FILE: join(directory, "signing.pem"),
          OAUTH_ALLOWED_REDIRECT_URIS: CLAUDE,
          OAUTH_STATE_FILE: path,
        },
        lookup: f.lookup,
        connect: f.connect,
      });
      expect(run.stderr()).toBe(`${LINES[code]}\n`);
      expect(run.stdout()).toBe("");
      expect(run.exits).toEqual([1]);
      expect(run.stderr()).not.toContain(path);
      expect(run.stderr()).not.toContain(SEEDED);
    },
  );
});

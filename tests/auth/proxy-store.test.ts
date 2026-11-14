// F-019 store: AC-03, AC-04, AC-05 and the store parts of AC-12 and AC-23.
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  OAUTH_STATE_APPLICATION_ID,
  OAUTH_STATE_MAX_BYTES,
  openOAuthStateStore,
  productionFilePort,
  type OAuthStateFilePort,
  type OAuthStateStoreOptions,
  type OAuthStateStorePort,
  type StoredClient,
  type StoredFamily,
  type StoreWrite,
} from "../../src/auth/proxy/store.js";
import { HttpStartupError } from "../../src/http/errors.js";

const NOW = Date.parse("2026-11-11T10:00:00.000Z");
const DAY = 86_400_000;
const binding = {
  issuer: "https://mcp.example/mcp",
  audience: "https://mcp.example/mcp/",
  upstreamIssuer: "https://idp.example",
};
const ALLOWED = ["https://a.example/cb"];
const LINES: Record<string, string> = {
  OAUTH_STATE_UNAVAILABLE:
    "The OAuth state file could not be opened or is not private.",
  OAUTH_STATE_LOCKED: "The OAuth state file is in use by another process.",
  OAUTH_STATE_CORRUPT: "The OAuth state file is not a valid OAuth state file.",
  OAUTH_STATE_VERSION: "The OAuth state file was written by a newer version.",
  OAUTH_STATE_MISMATCH:
    "The OAuth state file belongs to another issuer, audience or upstream.",
};

let directories: string[] = [];
afterEach(() => {
  for (const directory of directories) {
    for (const entry of readdirSync(directory, { recursive: true }))
      try {
        chmodSync(join(directory, String(entry)), 0o700);
      } catch {
        // Symlinks and FIFOs keep their mode.
      }
    rmSync(directory, { recursive: true, force: true });
  }
  directories = [];
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "kdrive-state-"));
  directories.push(directory);
  return directory;
}
const statePath = () => join(tempDir(), "state.db");

function open(path: string, extra: Partial<OAuthStateStoreOptions> = {}) {
  return openOAuthStateStore({
    path,
    binding,
    allowedRedirectUris: ALLOWED,
    clock: () => new Date(NOW),
    ...extra,
  });
}

/** The refusal code, or "opened" (the store is then closed). */
function attempt(path: string, extra: Partial<OAuthStateStoreOptions> = {}) {
  try {
    open(path, extra).close();
    return "opened";
  } catch (error) {
    if (!(error instanceof HttpStartupError)) throw error;
    expect(error.message).toBe(LINES[error.code]);
    expect(error.message).not.toContain(path);
    return error.code;
  }
}

const hash = (fill: number, size = 32) => new Uint8Array(size).fill(fill);
function client(
  n: number,
  overrides: Partial<StoredClient> = {},
): StoredClient {
  return {
    id: String(n).padStart(43, "c"),
    redirectUris: ["https://a.example/cb"],
    grantTypes: ["authorization_code", "refresh_token"],
    method: "client_secret_basic",
    name: "Client",
    secretHash: hash(n),
    lastUse: NOW - 1000,
    ...overrides,
  };
}
function family(
  n: number,
  clientId: string,
  overrides: Partial<StoredFamily> = {},
): StoredFamily {
  return {
    id: String(n).padStart(22, "f"),
    clientId,
    sub: "user-1",
    email: null,
    emailVerified: null,
    resource: binding.audience,
    created: NOW - 1000,
    tokenHash: hash(n),
    tokenIssued: NOW - 1000,
    ...overrides,
  };
}
const insertClient = (value: StoredClient): StoreWrite => ({
  op: "insertClient",
  client: value,
});
const insertFamily = (value: StoredFamily): StoreWrite => ({
  op: "insertFamily",
  family: value,
});

/** A valid file holding the given rows (a fresh store, committed, closed). */
function seed(
  path: string,
  clients: StoredClient[] = [client(1)],
  families: StoredFamily[] = [family(1, client(1).id)],
): void {
  const store = open(path);
  expect(
    store.commit([...clients.map(insertClient), ...families.map(insertFamily)]),
  ).toBe("committed");
  store.close();
}

function raw(path: string, change: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path);
  try {
    change(db);
  } finally {
    db.close();
  }
}

function query(path: string, sql: string): unknown {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

/** Mode, owner and bytes of every entry of the directory, by `lstat`. */
function listing(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    const content = stat.isFile() ? readFileSync(path).toString("base64") : "-";
    result[name] =
      `${stat.mode.toString(8)} ${String(stat.uid)} ${String(stat.nlink)} ${content}`;
  }
  return result;
}

function expectRefusedUnchanged(
  path: string,
  code: string,
  extra: Partial<OAuthStateStoreOptions> = {},
): void {
  const directory = dirname(path);
  const before = listing(directory);
  expect(attempt(path, extra)).toBe(code);
  expect(listing(directory)).toEqual(before);
  expect(existsSync(`${path}-wal`)).toBe(false);
  expect(existsSync(`${path}-shm`)).toBe(false);
}

/** A file port that reports another owner for the given path. */
function otherOwner(target: string): Partial<OAuthStateStorePort> {
  const file: OAuthStateFilePort = {
    ...productionFilePort,
    lstat: (path) => {
      const stat = productionFilePort.lstat(path);
      if (path !== target) return stat;
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        dev: stat.dev,
        ino: stat.ino,
        uid: stat.uid + 1,
        mode: stat.mode,
        nlink: stat.nlink,
        size: stat.size,
      };
    },
  };
  return { file };
}

const sqliteError = (errcode: number) =>
  Object.assign(new Error("injected"), { errcode });

/** A real database whose SQL calls pass through `fault` first. */
function faultPort(
  fault: (sql: string) => void,
  readOnly = false,
): { port: Partial<OAuthStateStorePort>; opened: DatabaseSync[] } {
  const opened: DatabaseSync[] = [];
  return {
    opened,
    port: {
      openDatabase: (path) => {
        const db = new DatabaseSync(path, { timeout: 0, readOnly });
        opened.push(db);
        return {
          exec: (sql) => {
            fault(sql);
            db.exec(sql);
          },
          prepare: (sql) => {
            fault(sql);
            return db.prepare(sql);
          },
          close: () => {
            db.close();
          },
        };
      },
    },
  };
}

function failOnce(match: (sql: string) => boolean, errcode: number) {
  let done = false;
  return (sql: string) => {
    if (done || !match(sql)) return;
    done = true;
    throw sqliteError(errcode);
  };
}

// ---- child processes --------------------------------------------------------

interface Child {
  next(): Promise<string>;
  send(line: string): void;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function child(path: string, mode: "try" | "hold" | "hot"): Child {
  const process_ = spawn(
    process.execPath,
    [resolve("tests/helpers/oauth-store-child.mjs"), path, mode],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const lines: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  createInterface({ input: process_.stdout }).on("line", (line) => {
    const waiter = waiting.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  return {
    next: () => {
      const line = lines.shift();
      return line === undefined
        ? new Promise((done) => {
            waiting.push(done);
          })
        : Promise.resolve(line);
    },
    send: (line) => {
      process_.stdin.write(`${line}\n`);
    },
    exited: new Promise((done) => {
      process_.on("exit", (code, signal) => {
        done({ code, signal });
      });
    }),
  };
}

async function tryChild(path: string): Promise<string> {
  const process_ = child(path, "try");
  const line = await process_.next();
  await process_.exited;
  return line;
}

// ---- AC-03 --------------------------------------------------------------------

describe("BR-293 file and directory checks (AC-03)", () => {
  it("BR-293 a missing parent is refused", () => {
    expect(attempt(join(tempDir(), "missing", "state.db"))).toBe(
      "OAUTH_STATE_UNAVAILABLE",
    );
  });

  it("BR-293 a parent that is a symlink is refused and nothing is created", () => {
    const root = tempDir();
    mkdirSync(join(root, "real"), { mode: 0o700 });
    symlinkSync(join(root, "real"), join(root, "link"));
    expect(attempt(join(root, "link", "state.db"))).toBe(
      "OAUTH_STATE_UNAVAILABLE",
    );
    expect(readdirSync(join(root, "real"))).toEqual([]);
  });

  it("BR-293 a parent owned by another user is refused", () => {
    const path = statePath();
    expect(attempt(path, { port: otherOwner(dirname(path)) })).toBe(
      "OAUTH_STATE_UNAVAILABLE",
    );
    expect(existsSync(path)).toBe(false);
  });

  it.each([0o770, 0o777, 0o500])(
    "BR-293 a parent of mode %o is refused and nothing is created",
    (mode) => {
      const parent = join(tempDir(), "parent");
      mkdirSync(parent, { mode: 0o700 });
      chmodSync(parent, mode);
      expect(attempt(join(parent, "state.db"))).toBe("OAUTH_STATE_UNAVAILABLE");
      chmodSync(parent, 0o700);
      expect(readdirSync(parent)).toEqual([]);
    },
  );

  it("BR-293 an absent path in a 0700 directory is created with mode 0600", () => {
    const path = statePath();
    expect(attempt(path)).toBe("opened");
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  });

  const pathCases: Array<[string, (path: string) => void]> = [
    [
      "a symlink",
      (path) => {
        const target = join(dirname(path), "target.db");
        seed(target);
        symlinkSync(target, path);
      },
    ],
    [
      "a directory",
      (path) => {
        mkdirSync(path, { mode: 0o700 });
      },
    ],
    [
      "a FIFO",
      (path) => {
        execFileSync("mkfifo", ["-m", "0600", path]);
      },
    ],
    [
      "a file with two hard links",
      (path) => {
        seed(path);
        linkSync(path, join(dirname(path), "second.db"));
      },
    ],
    [
      "a file of mode 0640",
      (path) => {
        seed(path);
        chmodSync(path, 0o640);
      },
    ],
    [
      "a valid file of mode 0400 holding an expired family",
      (path) => {
        seed(path, [client(1)], [family(1, client(1).id)]);
        raw(path, (db) => {
          db.exec("UPDATE families SET created = 0, token_issued = 0");
        });
        chmodSync(path, 0o400);
      },
    ],
    [
      "a journal that is a symlink",
      (path) => {
        seed(path);
        writeFileSync(join(dirname(path), "other"), "", { mode: 0o600 });
        symlinkSync(join(dirname(path), "other"), `${path}-journal`);
      },
    ],
    [
      "a journal that is a directory",
      (path) => {
        seed(path);
        mkdirSync(`${path}-journal`, { mode: 0o700 });
      },
    ],
    [
      "a journal of mode 0640",
      (path) => {
        seed(path);
        writeFileSync(`${path}-journal`, "", { mode: 0o600 });
        chmodSync(`${path}-journal`, 0o640);
      },
    ],
    [
      "a -wal regular file",
      (path) => {
        seed(path);
        writeFileSync(`${path}-wal`, "", { mode: 0o600 });
      },
    ],
    [
      "a -wal dangling symlink",
      (path) => {
        seed(path);
        symlinkSync(join(dirname(path), "nowhere"), `${path}-wal`);
      },
    ],
    [
      "a -shm regular file",
      (path) => {
        seed(path);
        writeFileSync(`${path}-shm`, "", { mode: 0o600 });
      },
    ],
  ];

  it.each(pathCases)(
    "BR-293 %s is refused and left unchanged",
    (_name, prepare) => {
      const path = statePath();
      prepare(path);
      const directory = dirname(path);
      const before = listing(directory);
      expect(attempt(path)).toBe("OAUTH_STATE_UNAVAILABLE");
      expect(listing(directory)).toEqual(before);
    },
  );

  it.each(["", "-journal"])(
    "BR-293 a path%s owned by another user is refused and left unchanged",
    (suffix) => {
      const path = statePath();
      seed(path);
      writeFileSync(`${path}-journal`, "", { mode: 0o600 });
      expectRefusedUnchanged(path, "OAUTH_STATE_UNAVAILABLE", {
        port: otherOwner(`${path}${suffix}`),
      });
    },
  );

  it("BR-293 a path swapped between the checks is refused (step 3a)", () => {
    const path = statePath();
    seed(path);
    const other = join(dirname(path), "other.db");
    seed(other);
    const { port, opened } = faultPort(() => undefined);
    const openDatabase = port.openDatabase;
    port.openDatabase = (target) => {
      renameSync(other, target);
      return openDatabase!(target);
    };
    const before = readFileSync(other);
    expect(attempt(path, { port })).toBe("OAUTH_STATE_UNAVAILABLE");
    expect(readFileSync(path)).toEqual(before);
    expect(opened[0]?.isOpen).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
  });

  it("BR-295 a purge commit that fails gives UNAVAILABLE and leaves the bytes unchanged", () => {
    const path = statePath();
    seed(path);
    raw(path, (db) => {
      db.exec("UPDATE families SET created = 0, token_issued = 0");
    });
    const { port, opened } = faultPort(failOnce((sql) => sql === "COMMIT", 10));
    expectRefusedUnchanged(path, "OAUTH_STATE_UNAVAILABLE", { port });
    expect(opened[0]?.isOpen).toBe(false);
    expect(query(path, "SELECT COUNT(*) AS n FROM families")).toEqual([
      { n: 1 },
    ]);
  });

  it.each([false, true])(
    "BR-293 a read-only open (expired family: %s) gives UNAVAILABLE, unchanged and closed",
    (expired) => {
      const path = statePath();
      seed(path);
      if (expired)
        raw(path, (db) => {
          db.exec("UPDATE families SET created = 0, token_issued = 0");
        });
      const { port, opened } = faultPort(() => undefined, true);
      expectRefusedUnchanged(path, "OAUTH_STATE_UNAVAILABLE", { port });
      expect(opened).toHaveLength(1);
      expect(opened[0]?.isOpen).toBe(false);
    },
  );

  it.each([
    [5, "OAUTH_STATE_LOCKED"],
    [261, "OAUTH_STATE_LOCKED"],
    [11, "OAUTH_STATE_CORRUPT"],
    [26, "OAUTH_STATE_CORRUPT"],
    [1544, "OAUTH_STATE_UNAVAILABLE"],
  ])(
    "BR-295 step (3b) BEGIN EXCLUSIVE failing with errcode %i gives %s and closes",
    (errcode, code) => {
      const path = statePath();
      seed(path);
      const { port, opened } = faultPort(
        failOnce((sql) => sql === "BEGIN EXCLUSIVE", errcode),
      );
      expectRefusedUnchanged(path, code, { port });
      expect(opened[0]?.isOpen).toBe(false);
    },
  );

  it.each([
    ["PRAGMA integrity_check", 11, "OAUTH_STATE_CORRUPT"],
    [
      "SELECT type, name, tbl_name, sql FROM sqlite_schema",
      10,
      "OAUTH_STATE_UNAVAILABLE",
    ],
  ])(
    "BR-295 an SQLite error at %s with errcode %i gives %s",
    (prefix, errcode, code) => {
      const path = statePath();
      seed(path);
      const { port, opened } = faultPort(
        failOnce((sql) => sql.startsWith(prefix), errcode),
      );
      expectRefusedUnchanged(path, code, { port });
      expect(opened[0]?.isOpen).toBe(false);
    },
  );
});

// ---- AC-04 --------------------------------------------------------------------

describe("BR-294 exclusive lock and BR-298 journal (AC-04)", () => {
  it("BR-294 a second process is refused while the first keeps working, then opens after close", async () => {
    const path = statePath();
    seed(path);
    const first = child(path, "hold");
    expect(await first.next()).toBe("open");
    const before = readFileSync(path);
    expect(await tryChild(path)).toBe("OAUTH_STATE_LOCKED");
    expect(readFileSync(path)).toEqual(before);
    first.send("commit");
    expect(await first.next()).toBe("committed 0");
    first.send("close");
    expect(await first.next()).toBe("closed");
    expect(await first.exited).toEqual({ code: 0, signal: null });
    expect(await tryChild(path)).toBe("open 2");
  }, 30_000);

  it.each([true, false])(
    "BR-294 no descriptor is opened after SQLite opens the path (existing file: %s)",
    async (existing) => {
      const path = statePath();
      if (existing) seed(path);
      const calls: string[] = [];
      const file: OAuthStateFilePort = {
        ...productionFilePort,
        lstat: (target) => {
          calls.push(`lstat ${target}`);
          return productionFilePort.lstat(target);
        },
        open: (target, flags, mode) => {
          calls.push(`open ${target}`);
          return productionFilePort.open(target, flags, mode);
        },
        read: (fd, buffer, offset, position) => {
          calls.push("read");
          return productionFilePort.read(fd, buffer, offset, position);
        },
        close: (fd) => {
          calls.push("close");
          productionFilePort.close(fd);
        },
      };
      const store = open(path, {
        port: {
          file,
          openDatabase: (target) => {
            calls.push("sqlite");
            return new DatabaseSync(target, { timeout: 0 });
          },
        },
      });
      try {
        const after = calls.slice(calls.indexOf("sqlite") + 1);
        // Identity check (3a) and emptiness after the lock (3b), lstat only.
        expect(after).toEqual([`lstat ${path}`, `lstat ${path}`]);
        const opens = calls.filter((call) => call.startsWith("open"));
        expect(opens).toEqual([`open ${path}`]);
        expect(calls.filter((call) => call === "close")).toHaveLength(1);
        expect(await tryChild(path)).toBe("OAUTH_STATE_LOCKED");
      } finally {
        store.close();
      }
    },
    30_000,
  );

  it("BR-294 a refusal after SQLite opened the path releases the lock", async () => {
    const path = statePath();
    const valid = join(tempDir(), "valid.db");
    seed(valid);
    seed(path);
    raw(path, (db) => {
      db.exec("CREATE TABLE extra(x INTEGER) STRICT");
    });
    expect(attempt(path)).toBe("OAUTH_STATE_CORRUPT");
    copyFileSync(valid, path);
    chmodSync(path, 0o600);
    expect(await tryChild(path)).toBe("open 1");
  }, 30_000);

  it("BR-298 the journal is 0 bytes after a commit and removed by a clean close", async () => {
    const path = statePath();
    seed(path);
    const holder = child(path, "hold");
    expect(await holder.next()).toBe("open");
    holder.send("commit");
    expect(await holder.next()).toBe("committed 0");
    expect(lstatSync(`${path}-journal`).size).toBe(0);
    holder.send("close");
    expect(await holder.next()).toBe("closed");
    await holder.exited;
    expect(existsSync(`${path}-journal`)).toBe(false);
  }, 30_000);

  it("BR-298 a journal left by SIGKILL after a commit passes BR-293 and the rows load", async () => {
    const path = statePath();
    seed(path);
    const holder = child(path, "hold");
    expect(await holder.next()).toBe("open");
    holder.send("commit");
    expect(await holder.next()).toBe("committed 0");
    holder.send("kill");
    expect((await holder.exited).signal).toBe("SIGKILL");
    expect(lstatSync(`${path}-journal`).mode & 0o777).toBe(0o600);
    const store = open(path);
    try {
      expect(store.clients.map((entry) => entry.id)).toEqual([
        client(1).id,
        "1".padStart(43, "d"),
      ]);
    } finally {
      store.close();
    }
  }, 30_000);
});

// ---- AC-05 --------------------------------------------------------------------

function buildFile(path: string, schema: string[], version = 1): void {
  writeFileSync(path, "", { mode: 0o600 });
  raw(path, (db) => {
    for (const sql of schema) db.exec(sql);
    db.exec(`PRAGMA application_id=${String(OAUTH_STATE_APPLICATION_ID)}`);
    db.exec(`PRAGMA user_version=${String(version)}`);
    const insert = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
    insert.run("issuer", binding.issuer);
    insert.run("audience", binding.audience);
    insert.run("upstream_issuer", binding.upstreamIssuer);
  });
}

const CLIENT_ONE = client(1).id;
const corruptCases: Array<[string, (path: string) => void]> = [
  [
    "random bytes",
    (path) => {
      writeFileSync(
        path,
        Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7 + 3) % 256)),
        { mode: 0o600 },
      );
    },
  ],
  [
    "another SQLite database",
    (path) => {
      writeFileSync(path, "", { mode: 0o600 });
      raw(path, (db) => {
        db.exec("CREATE TABLE t(x)");
      });
    },
  ],
  [
    "a truncated file",
    (path) => {
      seed(path);
      truncateSync(path, 4096);
    },
  ],
  [
    "an extra column",
    (path) => {
      seed(path);
      raw(path, (db) => {
        db.exec("ALTER TABLE clients ADD COLUMN extra TEXT");
      });
    },
  ],
  [
    "an extra table",
    (path) => {
      seed(path);
      raw(path, (db) => {
        db.exec("CREATE TABLE extra(x INTEGER) STRICT");
      });
    },
  ],
  [
    "an extra index",
    (path) => {
      seed(path);
      raw(path, (db) => {
        db.exec("CREATE INDEX extra ON families(client_id)");
      });
    },
  ],
  [
    "a trigger",
    (path) => {
      seed(path);
      raw(path, (db) => {
        db.exec(
          "CREATE TRIGGER extra AFTER INSERT ON clients BEGIN DELETE FROM families; END",
        );
      });
    },
  ],
  [
    "a view",
    (path) => {
      seed(path);
      raw(path, (db) => {
        db.exec("CREATE VIEW extra AS SELECT id FROM clients");
      });
    },
  ],
  [
    "a version 1 table created with different SQL text",
    (path) => {
      buildFile(path, [
        "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
        "CREATE TABLE clients(id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL, grant_types TEXT NOT NULL, method TEXT NOT NULL, name TEXT, secret_hash BLOB, last_use INTEGER NOT NULL) STRICT",
        "CREATE TABLE families(id TEXT PRIMARY KEY, client_id TEXT NOT NULL, sub TEXT NOT NULL, email TEXT, email_verified TEXT, resource TEXT NOT NULL, created INTEGER NOT NULL, token_hash BLOB NOT NULL, token_issued INTEGER NOT NULL) STRICT",
      ]);
    },
  ],
  [
    "1,001 client rows",
    (path) => {
      seed(path, [], []);
      raw(path, (db) => {
        const insert = db.prepare(
          "INSERT INTO clients VALUES (?, '[\"https://a.example/cb\"]', '[\"authorization_code\"]', 'none', NULL, NULL, ?)",
        );
        db.exec("BEGIN");
        for (let n = 0; n < 1001; n += 1)
          insert.run(String(n).padStart(43, "c"), NOW);
        db.exec("COMMIT");
      });
    },
  ],
  [
    "a 64 MiB + 1 byte file",
    (path) => {
      seed(path);
      truncateSync(path, OAUTH_STATE_MAX_BYTES + 1);
    },
  ],
  [
    "a 50-byte file",
    (path) => {
      const full = join(dirname(path), "full.db");
      seed(full);
      writeFileSync(path, readFileSync(full).subarray(0, 50), { mode: 0o600 });
    },
  ],
  [
    "a WAL header (bytes 18 and 19 equal to 2)",
    (path) => {
      seed(path);
      const bytes = readFileSync(path);
      bytes[18] = 2;
      bytes[19] = 2;
      writeFileSync(path, bytes);
    },
  ],
];

function rowCase(sql: string, ...parameters: Array<string | Uint8Array>) {
  return (path: string) => {
    seed(path);
    raw(path, (db) => {
      db.prepare(sql).run(...parameters);
    });
  };
}
const rowCases: Array<[string, (path: string) => void]> = [
  [
    "redirect_uris that is not JSON",
    rowCase("UPDATE clients SET redirect_uris = 'seeded-not-json['"),
  ],
  [
    "grant_types that is a JSON object",
    rowCase("UPDATE clients SET grant_types = '{\"a\":1}'"),
  ],
  [
    "method private_key_jwt",
    rowCase("UPDATE clients SET method = 'private_key_jwt'"),
  ],
  [
    "a 31-byte secret_hash",
    rowCase("UPDATE clients SET secret_hash = ?", hash(1, 31)),
  ],
  [
    "a secret_hash with method none",
    rowCase("UPDATE clients SET method = 'none'"),
  ],
  [
    "an https client id",
    (path: string) => {
      seed(path, [client(1)], []);
      raw(path, (db) => {
        db.exec("UPDATE clients SET id = 'https://client.example.com/cimd'");
      });
    },
  ],
  [
    "a family without its client row",
    rowCase("UPDATE families SET client_id = ?", client(9).id),
  ],
  [
    "a 33-byte token_hash",
    rowCase("UPDATE families SET token_hash = ?", hash(1, 33)),
  ],
  [
    "a resource other than the audience",
    rowCase("UPDATE families SET resource = 'https://seeded.example/'"),
  ],
  [
    "a 201-code-point name",
    rowCase("UPDATE clients SET name = ?", "\u{1F600}".repeat(201)),
  ],
  [
    "an expired family with a 33-byte token_hash",
    rowCase(
      "UPDATE families SET token_hash = ?, created = 0, token_issued = 0",
      hash(1, 33),
    ),
  ],
  [
    "a time beyond the JavaScript safe range",
    rowCase("UPDATE clients SET last_use = 9007199254740993"),
  ],
];

describe("BR-295 format checks and BR-296 binding (AC-05)", () => {
  it("BR-295 a zero-length file is initialized to version 1 with the meta values", () => {
    const path = statePath();
    writeFileSync(path, "", { mode: 0o600 });
    expect(attempt(path)).toBe("opened");
    expect(query(path, "PRAGMA application_id")).toEqual([
      { application_id: 0x4b444f53 },
    ]);
    expect(query(path, "PRAGMA user_version")).toEqual([{ user_version: 1 }]);
    expect(query(path, "SELECT key, value FROM meta ORDER BY key")).toEqual([
      { key: "audience", value: "https://mcp.example/mcp/" },
      { key: "issuer", value: "https://mcp.example/mcp" },
      { key: "upstream_issuer", value: "https://idp.example" },
    ]);
  });

  it.each([...corruptCases, ...rowCases])(
    "BR-295 %s gives OAUTH_STATE_CORRUPT, unchanged, without values",
    (_name, prepare) => {
      const path = statePath();
      prepare(path);
      expectRefusedUnchanged(path, "OAUTH_STATE_CORRUPT");
    },
  );

  it("BR-295 the opened database reports trusted_schema 0", () => {
    const path = statePath();
    seed(path);
    const { port, opened } = faultPort(() => undefined);
    const store = open(path, { port });
    try {
      expect(opened[0]?.prepare("PRAGMA trusted_schema").get()).toEqual({
        trusted_schema: 0,
      });
    } finally {
      store.close();
    }
  });

  it("BR-295 sets trusted_schema and secure_delete before any read and only synchronous reads before BEGIN EXCLUSIVE", () => {
    const path = statePath();
    seed(path);
    const { port } = faultPort(() => undefined);
    const openDatabase = port.openDatabase!;
    const statements: string[] = [];
    port.openDatabase = (target) => {
      const db = openDatabase(target);
      return {
        exec: (sql) => {
          statements.push(sql);
          db.exec(sql);
        },
        prepare: (sql) => {
          statements.push(sql);
          return db.prepare(sql);
        },
        close: () => {
          db.close();
        },
      };
    };
    const store = open(path, { port });
    store.close();
    const begin = statements.indexOf("BEGIN EXCLUSIVE");
    expect(statements.slice(0, begin)).toEqual([
      "PRAGMA trusted_schema=OFF",
      "PRAGMA secure_delete=ON",
      "PRAGMA synchronous=FULL",
      "PRAGMA locking_mode=EXCLUSIVE",
    ]);
  });

  it("BR-298 a crash in the first initialization commit leaves a file the next open initializes", () => {
    const path = statePath();
    seed(path);
    expect(lstatSync(path).size).toBeGreaterThan(0);
    // Hot journal of the first commit: no page record, original size 0 pages.
    const header = Buffer.alloc(512);
    Buffer.from("d9d505f920a163d7", "hex").copy(header, 0);
    header.writeUInt32BE(0, 8);
    header.writeUInt32BE(0, 12);
    header.writeUInt32BE(0, 16);
    header.writeUInt32BE(512, 20);
    header.writeUInt32BE(4096, 24);
    writeFileSync(`${path}-journal`, header, { mode: 0o600 });
    const store = open(path);
    try {
      expect(store.clients).toEqual([]);
      expect(store.families).toEqual([]);
    } finally {
      store.close();
    }
    expect(attempt(path)).toBe("opened");
  });

  it("BR-295 v2 user_version 3 on a version 1 schema gives OAUTH_STATE_VERSION", () => {
    const path = statePath();
    seed(path);
    raw(path, (db) => {
      db.exec("PRAGMA user_version=3");
    });
    expectRefusedUnchanged(path, "OAUTH_STATE_VERSION");
  });

  it("BR-295 v2 user_version 3 with an extra table and a bad row gives OAUTH_STATE_VERSION", () => {
    const path = statePath();
    seed(path);
    raw(path, (db) => {
      db.exec("PRAGMA user_version=3; CREATE TABLE extra(x INTEGER) STRICT");
      db.exec("UPDATE clients SET method = 'private_key_jwt'");
    });
    expectRefusedUnchanged(path, "OAUTH_STATE_VERSION");
  });

  it("BR-296 another issuer with an expired family gives OAUTH_STATE_MISMATCH and keeps the family", () => {
    const path = statePath();
    seed(path);
    raw(path, (db) => {
      db.exec("UPDATE families SET created = 0, token_issued = 0");
    });
    expectRefusedUnchanged(path, "OAUTH_STATE_MISMATCH", {
      binding: { ...binding, issuer: "https://other.example/mcp" },
    });
    expect(query(path, "SELECT COUNT(*) AS n FROM families")).toEqual([
      { n: 1 },
    ]);
  });

  it.each([
    { issuer: "https://other.example/mcp" },
    { audience: "https://mcp.example/mcp" },
    { upstreamIssuer: "https://idp.example/other" },
  ])("BR-296 a different binding %o gives OAUTH_STATE_MISMATCH", (change) => {
    const path = statePath();
    seed(path);
    expectRefusedUnchanged(path, "OAUTH_STATE_MISMATCH", {
      binding: { ...binding, ...change },
    });
  });

  it("BR-296 the stored strings are the binding strings byte for byte", () => {
    const path = statePath();
    expect(attempt(path)).toBe("opened");
    const meta = query(path, "SELECT key, value FROM meta") as Array<{
      key: string;
      value: string;
    }>;
    expect(Object.fromEntries(meta.map((row) => [row.key, row.value]))).toEqual(
      {
        issuer: binding.issuer,
        audience: binding.audience,
        upstream_issuer: binding.upstreamIssuer,
      },
    );
  });

  it("BR-295 a private hot journal is rolled back and the committed rows load; a mismatch keeps the rolled-back bytes", async () => {
    const root = tempDir();
    const original = join(root, "state.db");
    const clients = Array.from({ length: 200 }, (_, n) =>
      client(n + 1, { name: "n".repeat(200) }),
    );
    seed(original, clients, []);
    const hot = child(original, "hot");
    expect((await hot.exited).signal).toBe("SIGKILL");
    expect(lstatSync(`${original}-journal`).size).toBeGreaterThan(0);
    const copy = (name: string) => {
      const directory = join(root, name);
      mkdirSync(directory, { mode: 0o700 });
      const path = join(directory, "state.db");
      for (const suffix of ["", "-journal"]) {
        copyFileSync(`${original}${suffix}`, `${path}${suffix}`);
        chmodSync(`${path}${suffix}`, 0o600);
      }
      return path;
    };
    const reference = copy("reference");
    const mismatch = copy("mismatch");
    const store = open(original);
    try {
      expect(store.clients).toHaveLength(200);
      expect(
        store.clients.every((entry) => entry.name === "n".repeat(200)),
      ).toBe(true);
    } finally {
      store.close();
    }
    raw(reference, (db) => {
      db.prepare("SELECT COUNT(*) FROM clients").get();
    });
    expect(
      attempt(mismatch, {
        binding: { ...binding, issuer: "https://other.example/mcp" },
      }),
    ).toBe("OAUTH_STATE_MISMATCH");
    expect(readFileSync(mismatch)).toEqual(readFileSync(reference));
  }, 30_000);
});

// ---- BR-302 startup purge ---------------------------------------------------------

describe("BR-302 startup purge and BR-295 step (11)", () => {
  it("BR-302 removes exactly the expired families and idle or disallowed clients", () => {
    const path = statePath();
    const live = client(1);
    const idleWithFamily = client(2, { lastUse: NOW - 30 * DAY });
    const idle = client(3, { lastUse: NOW - 30 * DAY });
    const almostIdle = client(4, { lastUse: NOW - 30 * DAY + 1 });
    const disallowed = client(5, {
      redirectUris: ["https://b.example/cb"],
    });
    const loopback = client(6, {
      redirectUris: ["https://b.example/cb", "https://a.example/cb"],
    });
    const families = [
      family(1, live.id, { created: NOW - 30 * DAY, tokenIssued: NOW - 1 }),
      family(2, live.id, { created: NOW - 30 * DAY + 1, tokenIssued: NOW - 1 }),
      family(3, live.id, {
        created: NOW - 8 * DAY,
        tokenIssued: NOW - 7 * DAY,
      }),
      family(4, live.id, {
        created: NOW - 8 * DAY,
        tokenIssued: NOW - 7 * DAY + 1,
      }),
      family(5, idleWithFamily.id),
      family(6, disallowed.id),
    ];
    seed(
      path,
      [live, idleWithFamily, idle, almostIdle, disallowed, loopback],
      families,
    );
    const store = open(path);
    try {
      expect(store.families.map((entry) => entry.id)).toEqual([
        family(2, "").id,
        family(4, "").id,
        family(5, "").id,
      ]);
      expect(new Set(store.clients.map((entry) => entry.id))).toEqual(
        new Set([live.id, idleWithFamily.id, almostIdle.id, loopback.id]),
      );
    } finally {
      store.close();
    }
    expect(query(path, "SELECT id FROM families ORDER BY id")).toEqual([
      { id: family(2, "").id },
      { id: family(4, "").id },
      { id: family(5, "").id },
    ]);
    expect(query(path, "SELECT COUNT(*) AS n FROM clients")).toEqual([
      { n: 4 },
    ]);
  });

  it("BR-295 step (11) commits a real write even when nothing is purged", () => {
    const path = statePath();
    seed(path);
    const counter = () => readFileSync(path).readUInt32BE(24);
    const before = counter();
    expect(attempt(path)).toBe("opened");
    expect(counter()).toBeGreaterThan(before);
  });
});

// ---- BR-298 / BR-299 writes, BR-303 bounds, BR-304 close ----------------------------

describe("BR-298 writes, BR-303 bounds and BR-304 close", () => {
  it("BR-298 commits the row operations and AC-23 a reopened file loads the same rows", () => {
    const path = statePath();
    const store = open(path);
    const first = client(1, { name: null });
    const second = client(2, { method: "none", secretHash: null });
    expect(
      store.commit([
        insertClient(first),
        insertClient(second),
        // AC-23: a clock behind the creation time is written as `created`.
        insertFamily(
          family(1, first.id, { created: NOW, tokenIssued: NOW - 3_600_000 }),
        ),
        insertFamily(
          family(2, second.id, {
            email: "a@example.com",
            emailVerified: "true",
          }),
        ),
      ]),
    ).toBe("committed");
    expect(
      store.commit([
        { op: "touchClient", id: first.id, lastUse: NOW + 5 },
        // AC-23: the clock stepped back by one hour before the refresh.
        {
          op: "rotateFamily",
          id: family(1, "").id,
          tokenHash: hash(9),
          issued: NOW - 3_600_000,
        },
      ]),
    ).toBe("committed");
    store.close();
    const reopened = open(path);
    try {
      expect(reopened.clients).toEqual([
        { ...first, secretHash: Buffer.from(hash(1)), lastUse: NOW + 5 },
        second,
      ]);
      expect(reopened.families).toEqual([
        {
          ...family(1, first.id, { created: NOW, tokenIssued: NOW }),
          tokenHash: Buffer.from(hash(9)),
        },
        {
          ...family(2, second.id, {
            email: "a@example.com",
            emailVerified: "true",
          }),
          tokenHash: Buffer.from(hash(2)),
        },
      ]);
      expect(
        reopened.commit([
          { op: "deleteFamily", id: family(2, "").id },
          { op: "deleteClient", id: first.id },
        ]),
      ).toBe("committed");
    } finally {
      reopened.close();
    }
    expect(query(path, "SELECT COUNT(*) AS n FROM families")).toEqual([
      { n: 0 },
    ]);
    expect(query(path, "SELECT id FROM clients")).toEqual([{ id: second.id }]);
  });

  it.each<[string, StoreWrite]>([
    [
      "a client breaking a row rule",
      insertClient(client(2, { method: "none" })),
    ],
    ["a family for an unknown client", insertFamily(family(2, client(7).id))],
    [
      "a family with another resource",
      insertFamily(family(2, CLIENT_ONE, { resource: "https://x.example/" })),
    ],
    [
      "a keyed update of an unknown row",
      { op: "touchClient", id: client(8).id, lastUse: NOW },
    ],
    [
      "a keyed delete of an unknown row",
      { op: "deleteFamily", id: family(8, "").id },
    ],
    [
      "a rotation with a 31-byte hash",
      {
        op: "rotateFamily",
        id: family(1, "").id,
        tokenHash: hash(1, 31),
        issued: NOW,
      },
    ],
  ])("BR-299 %s fails, rolls back and latches the store", (_name, write) => {
    const path = statePath();
    seed(path);
    const store = open(path);
    try {
      expect(store.commit([insertClient(client(3)), write])).toBe("failed");
      expect(store.commit([insertClient(client(4))])).toBe("failed");
    } finally {
      store.close();
    }
    expect(query(path, "SELECT COUNT(*) AS n FROM clients")).toEqual([
      { n: 1 },
    ]);
  });

  it("BR-299 a keyed update whose changes count is not 1 latches the store", () => {
    const path = statePath();
    seed(path);
    const { port } = faultPort(() => undefined);
    const openDatabase = port.openDatabase!;
    port.openDatabase = (target) => {
      const db = openDatabase(target);
      return {
        exec: (sql) => {
          db.exec(sql);
        },
        prepare: (sql) => {
          const statement = db.prepare(sql);
          if (!sql.startsWith("UPDATE")) return statement;
          return {
            run: (...parameters) => ({
              changes: Number(statement.run(...parameters).changes) - 1,
            }),
            get: (...parameters) => statement.get(...parameters),
            all: (...parameters) => statement.all(...parameters),
          };
        },
        close: () => {
          db.close();
        },
      };
    };
    const store = open(path, { port });
    try {
      expect(
        store.commit([{ op: "touchClient", id: CLIENT_ONE, lastUse: NOW + 1 }]),
      ).toBe("failed");
    } finally {
      store.close();
    }
    expect(query(path, "SELECT last_use FROM clients")).toEqual([
      { last_use: NOW - 1000 },
    ]);
  });

  it("BR-303 max_page_count bounds the file and a write beyond it fails", () => {
    const path = statePath();
    seed(path);
    const { port, opened } = faultPort(() => undefined);
    const store = open(path, { port });
    try {
      const db = opened[0]!;
      const pages = db.prepare("PRAGMA max_page_count").get() as {
        max_page_count: number;
      };
      const size = db.prepare("PRAGMA page_size").get() as {
        page_size: number;
      };
      expect(pages.max_page_count * size.page_size).toBeLessThanOrEqual(
        OAUTH_STATE_MAX_BYTES,
      );
      const used = db.prepare("PRAGMA page_count").get() as {
        page_count: number;
      };
      db.exec(`PRAGMA max_page_count=${String(used.page_count)}`);
      const many = Array.from({ length: 50 }, (_, n) =>
        insertClient(client(n + 10, { name: "n".repeat(200) })),
      );
      expect(store.commit(many)).toBe("failed");
    } finally {
      store.close();
    }
  });

  it("BR-303 AC-12 a file holding 1,000 clients and 1,001 families is refused", () => {
    const path = statePath();
    seed(path, [], []);
    raw(path, (db) => {
      const clientInsert = db.prepare(
        "INSERT INTO clients VALUES (?, '[\"https://a.example/cb\"]', '[\"authorization_code\"]', 'none', NULL, NULL, ?)",
      );
      const familyInsert = db.prepare(
        "INSERT INTO families VALUES (?, ?, 'user-1', NULL, NULL, ?, ?, ?, ?)",
      );
      db.exec("BEGIN");
      for (let n = 0; n < 1000; n += 1)
        clientInsert.run(String(n).padStart(43, "c"), NOW);
      for (let n = 0; n < 1001; n += 1)
        familyInsert.run(
          String(n).padStart(22, "f"),
          String(n % 1000).padStart(43, "c"),
          binding.audience,
          NOW,
          hash(1),
          NOW,
        );
      db.exec("COMMIT");
    });
    expectRefusedUnchanged(path, "OAUTH_STATE_CORRUPT");
  });

  it("BR-304 close is idempotent, releases the lock and a later write reports closed", async () => {
    const path = statePath();
    seed(path);
    const store = open(path);
    store.close();
    store.close();
    expect(store.commit([insertClient(client(2))])).toBe("closed");
    expect(await tryChild(path)).toBe("open 1");
  }, 30_000);
});

// F-028 AC-08: store format version 2 for CIMD families (BR-311, BR-295 v2,
// BR-298 v2, BR-299 v2, BR-302 v2, ADR-011).
describe("BR-311 store format version 2 (F-028 AC-08)", () => {
  const CIMD = "https://client.example.com/c.json";
  const ORIGINS = ["https://client.example.com"];
  const version = (path: string) =>
    (query(path, "PRAGMA user_version") as Array<{ user_version: number }>)[0]
      ?.user_version;

  it("BR-311 BR-298 v2 a CIMD family insert on a version 1 file commits and sets user_version 2", () => {
    const path = statePath();
    seed(path);
    expect(version(path)).toBe(1);
    const store = open(path, { allowedClientIdOrigins: ORIGINS });
    expect(store.commit([insertFamily(family(2, CIMD))])).toBe("committed");
    store.close();
    expect(version(path)).toBe(2);
    expect(
      query(path, "SELECT id, client_id FROM families ORDER BY id"),
    ).toEqual([
      { id: family(1, client(1).id).id, client_id: client(1).id },
      { id: family(2, CIMD).id, client_id: CIMD },
    ]);
    expect(
      query(path, `SELECT COUNT(*) AS n FROM clients WHERE id = '${CIMD}'`),
    ).toEqual([{ n: 0 }]);
    // Deleting the last CIMD family does not lower the version (BR-311).
    const second = open(path, { allowedClientIdOrigins: ORIGINS });
    expect(
      second.commit([{ op: "deleteFamily", id: family(2, CIMD).id }]),
    ).toBe("committed");
    expect(second.commit([insertClient(client(3))])).toBe("committed");
    second.close();
    expect(version(path)).toBe(2);
    // The next startup transaction writes version 1: no CIMD family remains.
    open(path, { allowedClientIdOrigins: ORIGINS }).close();
    expect(version(path)).toBe(1);
  });

  it("BR-299 v2 a family whose client ID fails the CIMD syntax and names no client row is a failed write", () => {
    const path = statePath();
    seed(path);
    const store = open(path, { allowedClientIdOrigins: ORIGINS });
    try {
      expect(
        store.commit([insertFamily(family(2, "https://127.0.0.1/c"))]),
      ).toBe("failed");
      // The store is latched (BR-299).
      expect(store.commit([insertClient(client(3))])).toBe("failed");
    } finally {
      store.close();
    }
    expect(version(path)).toBe(1);
  });

  it("BR-311 a family meeting the CIMD syntax commits whatever the list holds", () => {
    const path = statePath();
    seed(path);
    const store = open(path);
    try {
      expect(store.commit([insertFamily(family(2, CIMD))])).toBe("committed");
    } finally {
      store.close();
    }
    expect(version(path)).toBe(2);
  });

  it("BR-295 v2 a version 2 file with a family failing the CIMD syntax is OAUTH_STATE_CORRUPT", () => {
    const path = statePath();
    seed(path);
    raw(path, (db) => {
      db.prepare(
        "INSERT INTO families(id, client_id, sub, email, email_verified, resource, created, token_hash, token_issued) VALUES (?, ?, 'user-1', NULL, NULL, ?, ?, ?, ?)",
      ).run(
        family(2, CIMD).id,
        "https://client.example.com/a/%2E%2E/b",
        binding.audience,
        NOW - 1000,
        hash(2),
        NOW - 1000,
      );
      db.exec("PRAGMA user_version=2");
    });
    expectRefusedUnchanged(path, "OAUTH_STATE_CORRUPT");
  });

  it("BR-295 v2 a version 2 file with a CIMD family of a listed origin loads; removing the origin purges it", () => {
    const path = statePath();
    seed(path);
    const first = open(path, { allowedClientIdOrigins: ORIGINS });
    expect(first.commit([insertFamily(family(2, CIMD))])).toBe("committed");
    first.close();
    const second = open(path, { allowedClientIdOrigins: ORIGINS });
    try {
      expect(second.families.map((row) => row.clientId)).toEqual([
        client(1).id,
        CIMD,
      ]);
    } finally {
      second.close();
    }
    expect(version(path)).toBe(2);
    const third = open(path);
    try {
      expect(third.families.map((row) => row.clientId)).toEqual([client(1).id]);
    } finally {
      third.close();
    }
    expect(version(path)).toBe(1);
    expect(query(path, "SELECT client_id FROM families")).toEqual([
      { client_id: client(1).id },
    ]);
  });

  it("BR-302 v2 a CIMD family survives the removal of every redirect URI while its origin is listed", () => {
    const path = statePath();
    seed(path, [], []);
    const first = open(path, { allowedClientIdOrigins: ORIGINS });
    expect(first.commit([insertFamily(family(2, CIMD))])).toBe("committed");
    first.close();
    const second = open(path, {
      allowedClientIdOrigins: ORIGINS,
      allowedRedirectUris: ["https://other.example/cb"],
    });
    try {
      expect(second.families.map((row) => row.clientId)).toEqual([CIMD]);
    } finally {
      second.close();
    }
  });

  it("BR-302 v2 a CIMD family of the issuer or the audience is purged at startup", () => {
    const path = statePath();
    seed(path, [], []);
    const first = open(path, { allowedClientIdOrigins: ORIGINS });
    expect(first.commit([insertFamily(family(2, binding.issuer))])).toBe(
      "committed",
    );
    first.close();
    const second = open(path, {
      allowedClientIdOrigins: [new URL(binding.issuer).origin],
    });
    try {
      expect(second.families).toEqual([]);
    } finally {
      second.close();
    }
  });

  it("BR-295 v2 a version 1 file holding a CIMD family row is OAUTH_STATE_CORRUPT", () => {
    const path = statePath();
    seed(path);
    raw(path, (db) => {
      db.prepare(
        "INSERT INTO families(id, client_id, sub, email, email_verified, resource, created, token_hash, token_issued) VALUES (?, ?, 'user-1', NULL, NULL, ?, ?, ?, ?)",
      ).run(
        family(2, CIMD).id,
        CIMD,
        binding.audience,
        NOW - 1000,
        hash(2),
        NOW - 1000,
      );
    });
    expect(version(path)).toBe(1);
    expectRefusedUnchanged(path, "OAUTH_STATE_CORRUPT");
  });
});

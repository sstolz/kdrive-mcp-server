import { closeSync, constants, lstatSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
} from "node:sqlite";
import { HttpStartupError, type OAuthStateCode } from "../../http/errors.js";
import { redirectMatches } from "./redirect.js";

// ---- F-019 constants ------------------------------------------------------

/** BR-295: `application_id` of an OAuth state file ("KDOS"). */
export const OAUTH_STATE_APPLICATION_ID = 0x4b_44_4f_53;
/** BR-295: the current format version (`user_version`). */
export const OAUTH_STATE_FORMAT_VERSION = 1;
/** BR-295 step (2), BR-303: the largest accepted file. */
export const OAUTH_STATE_MAX_BYTES = 67_108_864;
/** BR-303: rows per table. */
export const OAUTH_STATE_ROW_LIMIT = 1000;
const DAY = 86_400_000;
/** BR-139 v2 / BR-302: absolute family lifetime. */
export const FAMILY_ABSOLUTE_TTL_MS = 30 * DAY;
/** BR-139 v2 / BR-302: family inactivity limit, from its last token issue. */
export const FAMILY_INACTIVITY_TTL_MS = 7 * DAY;
/** BR-302: a client unused this long, with no live family, is purged. */
export const CLIENT_IDLE_TTL_MS = 30 * DAY;

/** Version 1 schema of Contract details, in creation order. */
export const OAUTH_STATE_SCHEMA_V1 = [
  "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
  "CREATE TABLE clients(id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL, grant_types TEXT NOT NULL, method TEXT NOT NULL, name TEXT, secret_hash BLOB, last_use INTEGER NOT NULL) STRICT",
  "CREATE TABLE families(id TEXT PRIMARY KEY, client_id TEXT NOT NULL, sub TEXT NOT NULL, email TEXT, email_verified TEXT, resource TEXT NOT NULL, created INTEGER NOT NULL, token_hash BLOB NOT NULL, token_issued INTEGER NOT NULL) STRICT",
] as const;

/** The `sqlite_schema` rows the version 1 initialization creates, sorted by type then name. */
const EXPECTED_SCHEMA = JSON.stringify([
  ["index", "sqlite_autoindex_clients_1", "clients", null],
  ["index", "sqlite_autoindex_families_1", "families", null],
  ["index", "sqlite_autoindex_meta_1", "meta", null],
  ["table", "clients", "clients", OAUTH_STATE_SCHEMA_V1[1]],
  ["table", "families", "families", OAUTH_STATE_SCHEMA_V1[2]],
  ["table", "meta", "meta", OAUTH_STATE_SCHEMA_V1[0]],
]);

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
/** Linux O_CLOEXEC; Node does not export it, and libuv also sets it on open. */
const O_CLOEXEC = 0o2000000;
const CREATE_FLAGS =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW |
  O_CLOEXEC;
const HEADER_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC;
const HEADER_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
const HEADER_BYTES = 100;
const HASH_BYTES = 32;
const CLIENT_ID = /^[A-Za-z0-9_-]{43}$/u;
const FAMILY_ID = /^[A-Za-z0-9_-]{22}$/u;
const CONTROL = /\p{Cc}/u;
const GRANTS = ["authorization_code", "refresh_token"] as const;
const METHODS = ["none", "client_secret_basic", "client_secret_post"] as const;
const META_KEYS = ["issuer", "audience", "upstream_issuer"] as const;

// ---- public types ---------------------------------------------------------

export type StoredGrant = (typeof GRANTS)[number];
export type StoredMethod = (typeof METHODS)[number];

/** A `clients` row (Contract details); times are milliseconds since the epoch. */
export interface StoredClient {
  id: string;
  redirectUris: readonly string[];
  grantTypes: readonly StoredGrant[];
  method: StoredMethod;
  name: string | null;
  /** SHA-256 of the issued client secret; null exactly when `method` is `none`. */
  secretHash: Uint8Array | null;
  lastUse: number;
}

/** A `families` row (Contract details). */
export interface StoredFamily {
  id: string;
  clientId: string;
  sub: string;
  email: string | null;
  /** The ID token's `email_verified` as JSON text, or null. */
  emailVerified: string | null;
  resource: string;
  created: number;
  /** SHA-256 of the current refresh-token secret. */
  tokenHash: Uint8Array;
  /** Stored as the larger of this value and `created`. */
  tokenIssued: number;
}

/** BR-296: the exact strings the proxy uses for its tokens. */
export interface OAuthStateBinding {
  issuer: string;
  audience: string;
  upstreamIssuer: string;
}

/**
 * One change of a commit (BR-298). Keyed updates and deletes must change
 * exactly one row (BR-299).
 */
export type StoreWrite =
  | { op: "insertClient"; client: StoredClient }
  | { op: "touchClient"; id: string; lastUse: number }
  /** Deletes the client and, with it, every family of that client. */
  | { op: "deleteClient"; id: string }
  | { op: "insertFamily"; family: StoredFamily }
  /** Sets the family's hash; `token_issued` becomes `max(issued, created)`. */
  | { op: "rotateFamily"; id: string; tokenHash: Uint8Array; issued: number }
  | { op: "deleteFamily"; id: string };

/**
 * `committed`: durable. `failed`: rolled back, the store is latched and every
 * later commit fails (BR-299). `closed`: the store was closed (BR-304), nothing
 * was written.
 */
export type CommitResult = "committed" | "failed" | "closed";

/** The store port the proxy consumes (BR-124 v2). */
export interface OAuthStateStore {
  /** Clients loaded at startup, after the BR-302 startup purge. */
  readonly clients: readonly StoredClient[];
  /** Families loaded at startup, after the BR-302 startup purge. */
  readonly families: readonly StoredFamily[];
  /** Applies the writes in one synchronous transaction; never throws. */
  commit(writes: readonly StoreWrite[]): CommitResult;
  /** Closes the database and releases the lock; later calls do nothing. */
  close(): void;
}

/** The `lstat` fields the checks read. */
export interface OAuthStateFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
  nlink: number;
  size: number;
}

/** The file operations before SQLite opens the path; injected by tests. */
export interface OAuthStateFilePort {
  /** Throws an error with `code` `ENOENT` when the path is absent. */
  lstat(path: string): OAuthStateFileStat;
  open(path: string, flags: number, mode?: number): number;
  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    position: number,
  ): number;
  close(fd: number): void;
  geteuid(): number;
}

export interface OAuthStateStatement {
  run(...parameters: SQLInputValue[]): { changes: number | bigint };
  get(
    ...parameters: SQLInputValue[]
  ): Record<string, SQLOutputValue> | undefined;
  all(...parameters: SQLInputValue[]): Record<string, SQLOutputValue>[];
}

/** The part of `DatabaseSync` the store uses (D-2). */
export interface OAuthStateDatabase {
  exec(sql: string): void;
  prepare(sql: string): OAuthStateStatement;
  close(): void;
}

/** The store's I/O seam; tests inject faults through it. */
export interface OAuthStateStorePort {
  file: OAuthStateFilePort;
  openDatabase(path: string): OAuthStateDatabase;
}

export interface OAuthStateStoreOptions {
  /** Absolute path of the state file. */
  path: string;
  binding: OAuthStateBinding;
  /** The current `oauthAllowedRedirectUris` (BR-302 startup purge). */
  allowedRedirectUris: readonly string[];
  clock: () => Date;
  port?: Partial<OAuthStateStorePort>;
}

export const productionFilePort: OAuthStateFilePort = Object.freeze({
  lstat: (path: string) => lstatSync(path),
  open: (path: string, flags: number, mode?: number) =>
    openSync(path, flags, mode),
  read: (fd: number, buffer: Uint8Array, offset: number, position: number) =>
    readSync(fd, buffer, offset, buffer.byteLength - offset, position),
  close: (fd: number) => {
    closeSync(fd);
  },
  geteuid: () => process.geteuid?.() ?? -1,
});

export const productionStorePort: OAuthStateStorePort = Object.freeze({
  file: productionFilePort,
  openDatabase: (path: string) => new DatabaseSync(path, { timeout: 0 }),
});

// ---- expiry helpers (BR-302) ----------------------------------------------

/** BR-139 v2: absolute or inactivity expiry has passed. */
export function familyExpired(
  family: Pick<StoredFamily, "created" | "tokenIssued">,
  now: number,
): boolean {
  return (
    now >= family.created + FAMILY_ABSOLUTE_TTL_MS ||
    now >= family.tokenIssued + FAMILY_INACTIVITY_TTL_MS
  );
}

/** BR-302: last use 30 days or more in the past (the live-family test is separate). */
export function clientIdle(
  client: Pick<StoredClient, "lastUse">,
  now: number,
): boolean {
  return now - client.lastUse >= CLIENT_IDLE_TTL_MS;
}

// ---- refusals -------------------------------------------------------------

function refuse(code: OAuthStateCode): never {
  throw new HttpStartupError(code);
}

function primaryCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    typeof error.errcode === "number"
  )
    return error.errcode & 0xff;
  return undefined;
}

/** BR-295 step (3b). */
function lockFailure(error: unknown): OAuthStateCode {
  const code = primaryCode(error);
  if (code === SQLITE_BUSY || code === SQLITE_LOCKED)
    return "OAUTH_STATE_LOCKED";
  if (code === SQLITE_CORRUPT || code === SQLITE_NOTADB)
    return "OAUTH_STATE_CORRUPT";
  return "OAUTH_STATE_UNAVAILABLE";
}

/** BR-295 steps (4)–(10). */
function contentFailure(error: unknown): OAuthStateCode {
  const code = primaryCode(error);
  return code === SQLITE_CORRUPT || code === SQLITE_NOTADB
    ? "OAUTH_STATE_CORRUPT"
    : "OAUTH_STATE_UNAVAILABLE";
}

const unavailable = (): OAuthStateCode => "OAUTH_STATE_UNAVAILABLE";

/** Runs a step; a refusal passes through, any other throw is mapped. */
function step<T>(map: (error: unknown) => OAuthStateCode, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof HttpStartupError) throw error;
    throw new HttpStartupError(map(error));
  }
}

// ---- BR-293 / BR-295 steps (1)–(2): files before SQLite --------------------

function lstatOrAbsent(
  file: OAuthStateFilePort,
  path: string,
): OAuthStateFileStat | undefined {
  try {
    return file.lstat(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    return refuse("OAUTH_STATE_UNAVAILABLE");
  }
}

function privateDirectory(stat: OAuthStateFileStat, euid: number): boolean {
  return (
    stat.isDirectory() &&
    stat.uid === euid &&
    (stat.mode & 0o700) === 0o700 &&
    (stat.mode & 0o022) === 0
  );
}

function privateFile(stat: OAuthStateFileStat, euid: number): boolean {
  return (
    stat.isFile() &&
    stat.nlink === 1 &&
    stat.uid === euid &&
    (stat.mode & 0o600) === 0o600 &&
    (stat.mode & 0o077) === 0
  );
}

function createFile(file: OAuthStateFilePort, path: string): void {
  const fd = step(unavailable, () => file.open(path, CREATE_FLAGS, 0o600));
  step(unavailable, () => {
    file.close(fd);
  });
}

function readHeader(file: OAuthStateFilePort, path: string): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  const fd = step(unavailable, () => file.open(path, HEADER_FLAGS));
  let length = 0;
  try {
    step(unavailable, () => {
      for (;;) {
        const read = file.read(fd, header, length, length);
        if (read <= 0) break;
        length += read;
        if (length >= HEADER_BYTES) break;
      }
    });
  } finally {
    try {
      file.close(fd);
    } catch {
      // The refusal or the open below decides; a failed close leaks nothing.
    }
  }
  return header.subarray(0, length);
}

interface CheckedFile {
  dev: number;
  ino: number;
}

/** BR-293 and BR-295 steps (1)–(2), with `lstat` and short-lived descriptors only. */
function checkFiles(file: OAuthStateFilePort, path: string): CheckedFile {
  const euid = file.geteuid();
  const parent = lstatOrAbsent(file, dirname(path));
  if (parent === undefined || !privateDirectory(parent, euid))
    refuse("OAUTH_STATE_UNAVAILABLE");
  const existing = lstatOrAbsent(file, path);
  if (existing !== undefined && !privateFile(existing, euid))
    refuse("OAUTH_STATE_UNAVAILABLE");
  const journal = lstatOrAbsent(file, `${path}-journal`);
  if (journal !== undefined && !privateFile(journal, euid))
    refuse("OAUTH_STATE_UNAVAILABLE");
  if (
    lstatOrAbsent(file, `${path}-wal`) !== undefined ||
    lstatOrAbsent(file, `${path}-shm`) !== undefined
  )
    refuse("OAUTH_STATE_UNAVAILABLE");
  let stat = existing;
  if (stat === undefined) {
    createFile(file, path);
    stat = lstatOrAbsent(file, path);
    if (stat === undefined || !privateFile(stat, euid))
      refuse("OAUTH_STATE_UNAVAILABLE");
  }
  if (stat.size > OAUTH_STATE_MAX_BYTES) refuse("OAUTH_STATE_CORRUPT");
  if (stat.size > 0) {
    const header = readHeader(file, path);
    if (
      header.length < HEADER_BYTES ||
      !header.subarray(0, HEADER_MAGIC.length).equals(HEADER_MAGIC) ||
      header[18] !== 1 ||
      header[19] !== 1
    )
      refuse("OAUTH_STATE_CORRUPT");
  }
  return { dev: stat.dev, ino: stat.ino };
}

// ---- row rules (Contract details) -----------------------------------------

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validHash(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === HASH_BYTES;
}

function distinct(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function validRedirectUris(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 10 &&
    value.every((uri) => typeof uri === "string" && uri !== "") &&
    distinct(value)
  );
}

function validGrants(value: unknown): value is StoredGrant[] {
  return (
    Array.isArray(value) &&
    value.every((grant) => GRANTS.includes(grant as StoredGrant)) &&
    value.includes("authorization_code") &&
    distinct(value)
  );
}

function validName(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- BR-127: code-point iteration of the string is intended
  const length = [...value].length;
  return length >= 1 && length <= 200 && !CONTROL.test(value);
}

function validJsonText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function parseJson(value: unknown): unknown {
  return validJsonText(value) ? JSON.parse(value as string) : undefined;
}

/** Version 1 row rules for a client. */
export function validClient(client: StoredClient): boolean {
  const method = client.method as unknown;
  const hashOk =
    method === "none"
      ? client.secretHash === null
      : validHash(client.secretHash);
  return (
    typeof client.id === "string" &&
    CLIENT_ID.test(client.id) &&
    validRedirectUris(client.redirectUris) &&
    validGrants(client.grantTypes) &&
    METHODS.includes(method as StoredMethod) &&
    validName(client.name) &&
    hashOk &&
    validTime(client.lastUse)
  );
}

/** Version 1 row rules for a family, except the client-row reference. */
export function validFamily(family: StoredFamily, audience: string): boolean {
  return (
    typeof family.id === "string" &&
    FAMILY_ID.test(family.id) &&
    typeof family.clientId === "string" &&
    typeof family.sub === "string" &&
    Buffer.byteLength(family.sub, "utf8") >= 1 &&
    Buffer.byteLength(family.sub, "utf8") <= 255 &&
    (family.email === null || typeof family.email === "string") &&
    (family.emailVerified === null || validJsonText(family.emailVerified)) &&
    family.resource === audience &&
    validHash(family.tokenHash) &&
    validTime(family.created) &&
    validTime(family.tokenIssued) &&
    family.created <= family.tokenIssued
  );
}

function text(value: SQLOutputValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function blob(
  value: SQLOutputValue | undefined,
): Uint8Array | null | undefined {
  if (value === null) return null;
  return value instanceof Uint8Array ? Buffer.from(value) : undefined;
}

function clientRow(row: Record<string, SQLOutputValue>): StoredClient {
  const client = {
    id: text(row.id),
    redirectUris: parseJson(row.redirect_uris),
    grantTypes: parseJson(row.grant_types),
    method: text(row.method),
    name: row.name ?? null,
    secretHash: blob(row.secret_hash),
    lastUse: row.last_use,
  } as unknown as StoredClient;
  if (!validClient(client)) refuse("OAUTH_STATE_CORRUPT");
  return client;
}

function familyRow(
  row: Record<string, SQLOutputValue>,
  audience: string,
  clientIds: ReadonlySet<string>,
): StoredFamily {
  const family = {
    id: text(row.id),
    clientId: text(row.client_id),
    sub: text(row.sub),
    email: row.email ?? null,
    emailVerified: row.email_verified ?? null,
    resource: text(row.resource),
    created: row.created,
    tokenHash: blob(row.token_hash),
    tokenIssued: row.token_issued,
  } as unknown as StoredFamily;
  if (!validFamily(family, audience) || !clientIds.has(family.clientId))
    refuse("OAUTH_STATE_CORRUPT");
  return family;
}

// ---- BR-295 steps (3b)–(11) -----------------------------------------------

function single(db: OAuthStateDatabase, sql: string): SQLOutputValue {
  const row = db.prepare(sql).get();
  return row === undefined ? null : (Object.values(row)[0] ?? null);
}

function count(db: OAuthStateDatabase, sql: string): number {
  return Number(single(db, sql));
}

/** Step (3b): lock, connection settings and journal mode. */
function lock(db: OAuthStateDatabase): void {
  // trusted_schema and secure_delete first; nothing reads the file before
  // BEGIN EXCLUSIVE except synchronous, which SQLite refuses inside a
  // transaction.
  db.exec("PRAGMA trusted_schema=OFF");
  db.exec("PRAGMA secure_delete=ON");
  db.exec("PRAGMA synchronous=FULL");
  db.exec("PRAGMA locking_mode=EXCLUSIVE");
  db.exec("BEGIN EXCLUSIVE");
  db.exec("PRAGMA journal_size_limit=0");
  const pageSize = count(db, "PRAGMA page_size");
  db.exec(
    `PRAGMA max_page_count=${String(Math.floor(OAUTH_STATE_MAX_BYTES / pageSize))}`,
  );
  if (single(db, "PRAGMA journal_mode") !== "delete")
    refuse("OAUTH_STATE_CORRUPT");
}

/** Version 1 initialization of a zero-length file, inside the step (3b) transaction. */
function initialize(db: OAuthStateDatabase, binding: OAuthStateBinding): void {
  for (const sql of OAUTH_STATE_SCHEMA_V1) db.exec(sql);
  db.exec(`PRAGMA application_id=${String(OAUTH_STATE_APPLICATION_ID)}`);
  db.exec(`PRAGMA user_version=${String(OAUTH_STATE_FORMAT_VERSION)}`);
  const insert = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
  insert.run("issuer", binding.issuer);
  insert.run("audience", binding.audience);
  insert.run("upstream_issuer", binding.upstreamIssuer);
}

interface Loaded {
  clients: StoredClient[];
  families: StoredFamily[];
}

function checkHeaderFields(db: OAuthStateDatabase): void {
  // Step (4).
  if (count(db, "PRAGMA application_id") !== OAUTH_STATE_APPLICATION_ID)
    refuse("OAUTH_STATE_CORRUPT");
  // Step (5).
  const version = count(db, "PRAGMA user_version");
  if (version > OAUTH_STATE_FORMAT_VERSION) refuse("OAUTH_STATE_VERSION");
  if (version < OAUTH_STATE_FORMAT_VERSION) refuse("OAUTH_STATE_CORRUPT");
}

function checkStructure(db: OAuthStateDatabase): void {
  // Step (6).
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || Object.values(integrity[0] ?? {})[0] !== "ok")
    refuse("OAUTH_STATE_CORRUPT");
  // Step (7).
  const schema = db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
    )
    .all()
    .map((row) => [row.type, row.name, row.tbl_name, row.sql]);
  if (JSON.stringify(schema) !== EXPECTED_SCHEMA) refuse("OAUTH_STATE_CORRUPT");
  // Step (8).
  if (
    count(db, "SELECT COUNT(*) FROM clients") > OAUTH_STATE_ROW_LIMIT ||
    count(db, "SELECT COUNT(*) FROM families") > OAUTH_STATE_ROW_LIMIT
  )
    refuse("OAUTH_STATE_CORRUPT");
}

/** Step (9): integers out of the JavaScript safe range break the time rules. */
const OUT_OF_RANGE = `NOT BETWEEN 0 AND ${String(Number.MAX_SAFE_INTEGER)}`;

function readRows(
  db: OAuthStateDatabase,
): Loaded & { meta: Map<string, string> } {
  const meta = new Map<string, string>();
  for (const row of db.prepare("SELECT key, value FROM meta").all()) {
    const key = text(row.key);
    const value = text(row.value);
    if (key === undefined || value === undefined) refuse("OAUTH_STATE_CORRUPT");
    meta.set(key, value);
  }
  if (
    meta.size !== META_KEYS.length ||
    !META_KEYS.every((key) => meta.has(key))
  )
    refuse("OAUTH_STATE_CORRUPT");
  if (
    count(db, `SELECT COUNT(*) FROM clients WHERE last_use ${OUT_OF_RANGE}`) >
      0 ||
    count(
      db,
      `SELECT COUNT(*) FROM families WHERE created ${OUT_OF_RANGE} OR token_issued ${OUT_OF_RANGE}`,
    ) > 0
  )
    refuse("OAUTH_STATE_CORRUPT");
  const clients = db
    .prepare("SELECT * FROM clients ORDER BY id")
    .all()
    .map((row) => clientRow(row));
  const clientIds = new Set(clients.map((client) => client.id));
  const audience = meta.get("audience") ?? "";
  const families = db
    .prepare("SELECT * FROM families ORDER BY id")
    .all()
    .map((row) => familyRow(row, audience, clientIds));
  return { meta, clients, families };
}

/** BR-302 startup purge, decided on the validated rows. */
function startupPurge(
  loaded: Loaded,
  now: number,
  allowed: readonly string[],
): Loaded {
  const allowedClients = loaded.clients.filter((client) =>
    client.redirectUris.some((uri) =>
      allowed.some((entry) => redirectMatches(uri, entry)),
    ),
  );
  const allowedIds = new Set(allowedClients.map((client) => client.id));
  const families = loaded.families.filter(
    (family) => allowedIds.has(family.clientId) && !familyExpired(family, now),
  );
  const live = new Set(families.map((family) => family.clientId));
  const clients = allowedClients.filter(
    (client) => live.has(client.id) || !clientIdle(client, now),
  );
  return { clients, families };
}

function load(
  db: OAuthStateDatabase,
  isEmpty: () => boolean,
  options: OAuthStateStoreOptions,
  checkIdentity: () => void,
): Loaded {
  step(unavailable, checkIdentity);
  step(lockFailure, () => {
    lock(db);
  });
  // Emptiness is read after the lock: a hot journal rolled back by SQLite
  // can return a crashed first initialization to zero bytes (lstat only).
  if (step(unavailable, isEmpty))
    step(unavailable, () => {
      initialize(db, options.binding);
    });
  const rows = step(contentFailure, () => {
    checkHeaderFields(db);
    checkStructure(db);
    return readRows(db);
  });
  // Step (10), BR-296.
  const { binding } = options;
  if (
    rows.meta.get("issuer") !== binding.issuer ||
    rows.meta.get("audience") !== binding.audience ||
    rows.meta.get("upstream_issuer") !== binding.upstreamIssuer
  )
    refuse("OAUTH_STATE_MISMATCH");
  // Step (11): always a real write, then the purge, in one committed transaction.
  return step(unavailable, () => {
    const kept = startupPurge(
      rows,
      options.clock().getTime(),
      options.allowedRedirectUris,
    );
    db.exec(`PRAGMA user_version=${String(OAUTH_STATE_FORMAT_VERSION)}`);
    const keptFamilies = new Set(kept.families.map((family) => family.id));
    const keptClients = new Set(kept.clients.map((client) => client.id));
    const dropFamily = db.prepare("DELETE FROM families WHERE id = ?");
    for (const family of rows.families)
      if (!keptFamilies.has(family.id)) dropFamily.run(family.id);
    const dropClient = db.prepare("DELETE FROM clients WHERE id = ?");
    for (const client of rows.clients)
      if (!keptClients.has(client.id)) dropClient.run(client.id);
    db.exec("COMMIT");
    return kept;
  });
}

// ---- BR-298 / BR-299 writes ------------------------------------------------

class WriteRefused extends Error {}

function validWrite(write: StoreWrite, audience: string): boolean {
  switch (write.op) {
    case "insertClient":
      return validClient(write.client);
    case "touchClient":
      return typeof write.id === "string" && validTime(write.lastUse);
    case "insertFamily":
      // The row as written: `token_issued` is never before `created`.
      return validFamily(
        {
          ...write.family,
          tokenIssued: Math.max(write.family.tokenIssued, write.family.created),
        },
        audience,
      );
    case "rotateFamily":
      return (
        typeof write.id === "string" &&
        validHash(write.tokenHash) &&
        validTime(write.issued)
      );
    case "deleteClient":
    case "deleteFamily":
      return typeof write.id === "string";
    default:
      return false;
  }
}

function keyed(result: { changes: number | bigint }): void {
  if (Number(result.changes) !== 1) throw new WriteRefused();
}

function applyWrite(db: OAuthStateDatabase, write: StoreWrite): void {
  switch (write.op) {
    case "insertClient": {
      const { client } = write;
      keyed(
        db
          .prepare(
            "INSERT INTO clients(id, redirect_uris, grant_types, method, name, secret_hash, last_use) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            client.id,
            JSON.stringify(client.redirectUris),
            JSON.stringify(client.grantTypes),
            client.method,
            client.name,
            client.secretHash,
            client.lastUse,
          ),
      );
      return;
    }
    case "touchClient":
      keyed(
        db
          .prepare("UPDATE clients SET last_use = ? WHERE id = ?")
          .run(write.lastUse, write.id),
      );
      return;
    case "deleteClient":
      db.prepare("DELETE FROM families WHERE client_id = ?").run(write.id);
      keyed(db.prepare("DELETE FROM clients WHERE id = ?").run(write.id));
      return;
    case "insertFamily": {
      const { family } = write;
      if (
        db
          .prepare("SELECT 1 FROM clients WHERE id = ?")
          .get(family.clientId) === undefined
      )
        throw new WriteRefused();
      keyed(
        db
          .prepare(
            "INSERT INTO families(id, client_id, sub, email, email_verified, resource, created, token_hash, token_issued) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            family.id,
            family.clientId,
            family.sub,
            family.email,
            family.emailVerified,
            family.resource,
            family.created,
            family.tokenHash,
            Math.max(family.tokenIssued, family.created),
          ),
      );
      return;
    }
    case "rotateFamily":
      keyed(
        db
          .prepare(
            "UPDATE families SET token_hash = ?, token_issued = MAX(?, created) WHERE id = ?",
          )
          .run(write.tokenHash, write.issued, write.id),
      );
      return;
    case "deleteFamily":
      keyed(db.prepare("DELETE FROM families WHERE id = ?").run(write.id));
      return;
  }
}

function createStore(
  db: OAuthStateDatabase,
  loaded: Loaded,
  audience: string,
): OAuthStateStore {
  let closed = false;
  let latched = false;
  return {
    clients: loaded.clients,
    families: loaded.families,
    commit(writes) {
      if (closed) return "closed";
      if (latched) return "failed";
      try {
        // BR-298: every row passes the row rules before its transaction.
        if (!writes.every((write) => validWrite(write, audience)))
          throw new WriteRefused();
        db.exec("BEGIN EXCLUSIVE");
        try {
          for (const write of writes) applyWrite(db, write);
          db.exec("COMMIT");
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // SQLite may already have rolled the transaction back.
          }
          throw error;
        }
        return "committed";
      } catch {
        latched = true;
        return "failed";
      }
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

// ---- entry point -----------------------------------------------------------

function discard(db: OAuthStateDatabase): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // No transaction was open.
  }
  try {
    db.close();
  } catch {
    // The refusal is raised either way.
  }
}

/**
 * BR-293–BR-298, BR-302, BR-303: opens, checks, purges and loads the OAuth
 * state file. Throws `HttpStartupError` with an `OAUTH_STATE_*` code.
 */
export function openOAuthStateStore(
  options: OAuthStateStoreOptions,
): OAuthStateStore {
  const port: OAuthStateStorePort = {
    ...productionStorePort,
    ...options.port,
  };
  const { path } = options;
  const checked = checkFiles(port.file, path);
  const db = step(unavailable, () => port.openDatabase(path));
  try {
    // Step (3a): the path SQLite opened is still the checked file.
    const isEmpty = () => port.file.lstat(path).size === 0;
    const loaded = load(db, isEmpty, options, () => {
      const after = port.file.lstat(path);
      if (after.dev !== checked.dev || after.ino !== checked.ino)
        refuse("OAUTH_STATE_UNAVAILABLE");
    });
    return createStore(db, loaded, options.binding.audience);
  } catch (error) {
    discard(db);
    throw error instanceof HttpStartupError
      ? error
      : new HttpStartupError("OAUTH_STATE_UNAVAILABLE");
  }
}

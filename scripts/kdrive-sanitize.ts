// F-014 BR-213: in-memory sanitization and leak check of a recorded kDrive
// session. Pure: no I/O, no imports from src (the recorder loads dist/).

export interface RawHop {
  readonly status: number;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly body: Uint8Array;
}
export interface RawExchange {
  readonly template: string;
  readonly params: Readonly<{ d?: number; f?: number }>;
  readonly query: readonly (readonly [string, string])[];
  readonly range?: string;
  readonly hops: readonly RawHop[];
}
export interface SanitizeInput {
  readonly exchanges: readonly RawExchange[];
  /** Real IDs of the manifest fixtures (aliased `n<k>`). */
  readonly manifestIds: ReadonlySet<number>;
  /** The designated synthetic binary; only its body bytes are kept. */
  readonly binaryId: number;
  readonly token: string;
}
export interface SanitizedHop {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly body?: string;
}
export interface SanitizedExchange {
  readonly template: string;
  readonly params: Readonly<{ d?: number; f?: number }>;
  readonly query: readonly (readonly [string, string])[];
  readonly range?: string;
  readonly hops: readonly SanitizedHop[];
}
export interface Recording {
  readonly format: "kdrive-recording/1";
  readonly origin: "recorded" | "synthetic";
  readonly exchanges: readonly SanitizedExchange[];
}

export const STORAGE_LOCATION =
  "https://s1.download.kdrive.infomaniakusercontent.com/r";
export const SYNTHETIC_ID_BASE = 1_000_001;
export const HEADER_ALLOWLIST = [
  "status",
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "location",
] as const;
export const ENVELOPE_MEMBERS = [
  "result",
  "data",
  "has_more",
  "cursor",
  "error",
] as const;
export const ITEM_MEMBERS = [
  "id",
  "drive_id",
  "parent_id",
  "type",
  "status",
  "name",
  "path",
  "size",
  "parents",
  "capabilities",
] as const;
export const KEPT_PATH_COMPONENTS = new Set(["Shared", "Private"]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Keeps only Recorded members (BR-213); everything else is dropped. */
export function filterItem(value: unknown): Json | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, Json> = {};
  for (const key of ITEM_MEMBERS) {
    if (!Object.hasOwn(value, key)) continue;
    const v = value[key];
    if (key === "parents") {
      if (Array.isArray(v))
        out.parents = v
          .map((p) => filterItem(p))
          .filter((p): p is Json => p !== undefined);
    } else if (key === "capabilities") {
      if (isRecord(v))
        out.capabilities = Object.fromEntries(
          Object.entries(v).filter(([, c]) => typeof c === "boolean"),
        ) as Json;
    } else if (
      v === null ||
      ["string", "number", "boolean"].includes(typeof v)
    ) {
      out[key] = v as Json;
    }
  }
  return out;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- F-014: one flat pass over the Recorded-members contract reads best as a single table-driven function
function filterBody(template: string, value: unknown): Json | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, Json> = {};
  for (const key of ENVELOPE_MEMBERS) {
    if (!Object.hasOwn(value, key)) continue;
    const v = value[key];
    if (key === "error") {
      if (isRecord(v) && typeof v.code === "string")
        out.error = { code: v.code };
    } else if (key === "data") {
      if (template === "/2/drive/init") {
        const drives = isRecord(v) && Array.isArray(v.drives) ? v.drives : [];
        out.data = {
          drives: drives.filter(isRecord).map((d) => ({
            id: d.id as Json,
            role: d.role as Json,
          })),
        };
      } else if (Array.isArray(v)) {
        out.data = v
          .map((e) => filterItem(e))
          .filter((e): e is Json => e !== undefined);
      } else {
        const item = filterItem(v);
        if (item !== undefined) out.data = item;
      }
    } else if (
      v === null ||
      ["string", "number", "boolean"].includes(typeof v)
    ) {
      out[key] = v as Json;
    }
  }
  return out;
}

function walk(
  value: Json,
  visit: (key: string, v: Json, parent: Record<string, Json>) => void,
) {
  if (Array.isArray(value)) for (const v of value) walk(v, visit);
  else if (isRecord(value))
    for (const [key, v] of Object.entries(value)) {
      visit(key, v, value);
      walk(v, visit);
    }
}

function header(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The category names what kind of value leaked, never the value itself. */
export class LeakError extends Error {
  constructor(category: string) {
    super(
      `The sanitized recording failed the leak check (${category}); nothing was written.`,
    );
  }
}

/**
 * BR-213: sanitizes a whole recorded session. Synthetic IDs are assigned only
 * after the session is complete, sequentially from 1,000,001, skipping every
 * real ID observed. Throws `LeakError` when the output fails the leak check.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-014: one flat pass over the Recorded-members contract reads best as a single table-driven function
export function sanitize(input: SanitizeInput): Recording {
  const bodies = input.exchanges.map((exchange) =>
    exchange.hops.map((hop) => {
      if (exchange.template.endsWith("/download") || hop.status === 302)
        return undefined;
      try {
        return filterBody(
          exchange.template,
          JSON.parse(Buffer.from(hop.body).toString("utf8")) as unknown,
        );
      } catch {
        return undefined;
      }
    }),
  );
  // 1. Every real ID and name observed in the session.
  const ids = new Set<number>();
  const names = new Set<string>();
  const manifestNames = new Set<string>();
  for (const exchange of input.exchanges) {
    for (const id of [exchange.params.d, exchange.params.f])
      if (id !== undefined) ids.add(id);
    for (const [k, v] of exchange.query)
      if (k === "directory_id") ids.add(Number(v));
    for (const hop of exchange.hops) {
      // Names anywhere in a raw response, dropped members included.
      try {
        const raw = JSON.parse(Buffer.from(hop.body).toString("utf8")) as Json;
        walk(raw, (key, v) => {
          if (key === "name" && typeof v === "string") names.add(v);
        });
      } catch {
        /* Non-JSON bodies carry no names. */
      }
    }
  }
  for (const list of bodies)
    for (const body of list)
      if (body !== undefined)
        walk(body, (key, v, parent) => {
          if (
            ["id", "drive_id", "parent_id"].includes(key) &&
            typeof v === "number"
          )
            ids.add(v);
          if (
            key === "name" &&
            typeof v === "string" &&
            typeof parent.id === "number" &&
            input.manifestIds.has(parent.id)
          )
            manifestNames.add(v);
        });
  // 2. Synthetic ID assignment after the whole session.
  const idMap = new Map<number, number>([[1, 1]]);
  let next = SYNTHETIC_ID_BASE;
  for (const id of [...ids].filter((i) => i !== 1).sort((a, b) => a - b)) {
    while (ids.has(next)) next++;
    idMap.set(id, next++);
  }
  const mapId = (id: number) => idMap.get(id) ?? 1;
  // 3. Name aliases: n<k> for manifest fixtures, x<k> for any other entry.
  const aliases = new Map<string, string>([["", ""]]);
  let n = 0,
    x = 0;
  const alias = (name: string) => {
    if (KEPT_PATH_COMPONENTS.has(name)) return name;
    let value = aliases.get(name);
    if (value === undefined) {
      value = manifestNames.has(name) ? `n${String(++n)}` : `x${String(++x)}`;
      aliases.set(name, value);
    }
    return value;
  };
  for (const name of [...manifestNames].sort((a, b) => a.localeCompare(b)))
    alias(name);
  const path = (value: string) =>
    value === "/"
      ? "/"
      : value
          .split("/")
          .map((part) => (part === "" ? "" : alias(part)))
          .join("/");
  const cursors = new Map<string, string>(),
    etags = new Map<string, string>();
  const synthetic = (
    map: Map<string, string>,
    value: string,
    make: (k: number) => string,
  ) => {
    const known = map.get(value);
    if (known !== undefined) return known;
    const created = make(map.size + 1);
    map.set(value, created);
    return created;
  };
  const cursor = (value: string) =>
    synthetic(cursors, value, (k) => `cursor${String(k)}`);
  const etag = (value: string) =>
    synthetic(etags, value, (k) => `"etag${String(k)}"`);
  // eslint-disable-next-line sonarjs/function-return-type -- F-014: JSON rewriting returns the JSON value union by design
  const rewrite = (value: Json): Json => {
    if (!isRecord(value))
      return Array.isArray(value) ? value.map(rewrite) : value;
    const out: Record<string, Json> = {};
    for (const [key, v] of Object.entries(value as Record<string, Json>)) {
      if (
        ["id", "drive_id", "parent_id"].includes(key) &&
        typeof v === "number"
      )
        out[key] = mapId(v);
      else if (key === "name" && typeof v === "string") out[key] = alias(v);
      else if (key === "path" && typeof v === "string") out[key] = path(v);
      else if (key === "cursor" && typeof v === "string") out[key] = cursor(v);
      else out[key] = rewrite(v);
    }
    return out;
  };
  const exchanges: SanitizedExchange[] = input.exchanges.map(
    (exchange, index) => ({
      template: exchange.template,
      params: {
        ...(exchange.params.d === undefined
          ? {}
          : { d: mapId(exchange.params.d) }),
        ...(exchange.params.f === undefined
          ? {}
          : { f: mapId(exchange.params.f) }),
      },
      query: exchange.query.map(([k, v]): readonly [string, string] => {
        if (k === "directory_id") return [k, String(mapId(Number(v)))];
        if (k === "cursor") return [k, cursor(v)];
        if (k === "query") return [k, alias(v)];
        return [k, v];
      }),
      ...(exchange.range === undefined ? {} : { range: exchange.range }),
      hops: exchange.hops.map((hop, h) => {
        const headers: Record<string, string> = {};
        for (const name of HEADER_ALLOWLIST) {
          const value = header(hop.headers[name]);
          if (value === undefined) continue;
          if (name === "etag") headers.etag = etag(value);
          else if (name === "location") headers.location = STORAGE_LOCATION;
          else headers[name] = value;
        }
        const body = bodies[index]?.[h];
        const keepBytes =
          exchange.template.endsWith("/download") &&
          exchange.params.f === input.binaryId &&
          hop.status >= 200 &&
          hop.status < 300;
        return {
          status: hop.status,
          headers,
          ...(body === undefined ? {} : { json: rewrite(body) }),
          ...(keepBytes
            ? { body: Buffer.from(hop.body).toString("base64") }
            : {}),
        };
      }),
    }),
  );
  const recording: Recording = {
    format: "kdrive-recording/1",
    origin: "recorded",
    exchanges,
  };
  leakCheck(recording, {
    token: input.token,
    ids: [...ids],
    names: [...names],
  });
  return recording;
}

/** BR-213 v2: the route-table templates (kept equal to src/kdrive/routes.ts by test). */
export const ROUTE_TEMPLATES: ReadonlySet<string> = new Set([
  "/2/drive/init",
  "/3/drive/{d}/files/{f}",
  "/3/drive/{d}/files/{f}/files",
  "/3/drive/{d}/files/search",
  "/3/drive/{d}/files/recents",
  "/3/drive/{d}/files/my_shared",
  "/3/drive/files/shared_with_me",
  "/2/drive/{d}/files/{f}/download",
  // F-017 BR-190 v2: the trash-metadata GET route.
  "/3/drive/{d}/trash/{f}",
]);

/** BR-213 v2: member names a failure location may print; others print as `<member>`. */
const PRINTABLE_MEMBERS: ReadonlySet<string> = new Set<string>([
  ...ENVELOPE_MEMBERS,
  "code",
  ...ITEM_MEMBERS,
  "drives",
  "role",
  ...HEADER_ALLOWLIST,
  "d",
  "f",
  "format",
  "origin",
  "exchanges",
  "template",
  "params",
  "query",
  "range",
  "hops",
  "status",
  "headers",
  "json",
  "body",
]);

/** BR-213: a whole decimal token is a digit run not adjacent to a letter, digit or underscore. */
const WHOLE_DECIMAL = /(?<!\w)\d+(?!\w)/gu;
const DIGITS = /^\d+$/u;
const CHARSET_UTF8 = /;\s*[cC][hH][aA][rR][sS][eE][tT]=[uU][tT][fF]-8/gu;
const member = (path: string, key: string) =>
  `${path}.${PRINTABLE_MEMBERS.has(key) ? key : "<member>"}`;

/** A text to search for real IDs, with its value-free location. */
interface Leaf {
  readonly at: string;
  readonly text: string;
}
interface Walk {
  readonly leaves: Leaf[];
  readonly forms: string[];
}

const isSize = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);

function walkJson(value: unknown, at: string, out: Walk): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      walkJson(item, `${at}[${String(i)}]`, out);
    });
    return;
  }
  if (typeof value !== "object" || value === null) {
    out.leaves.push({ at, text: String(value) });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const next = member(at, key);
    out.leaves.push({ at: next, text: key });
    if (key === "size") {
      if (!isSize(item)) out.forms.push(next);
    } else walkJson(item, next, out);
  }
}

const HEADER_FORMS: ReadonlyMap<string, RegExp> = new Map([
  ["content-length", DIGITS],
  ["content-range", /^bytes (?:\d+-\d+|\*)\/\d+$/u],
]);

function walkHop(hop: SanitizedHop, at: string, out: Walk): void {
  if (!(Number.isInteger(hop.status) && hop.status >= 100 && hop.status <= 599))
    out.forms.push(`${at}.status`);
  for (const [name, value] of Object.entries(hop.headers)) {
    const where = member(`${at}.headers`, name);
    out.leaves.push({ at: where, text: name });
    const form = HEADER_FORMS.get(name);
    if (form) {
      if (!form.test(value)) out.forms.push(where);
    } else
      out.leaves.push({
        at: where,
        text: name === "content-type" ? value.replace(CHARSET_UTF8, "") : value,
      });
  }
  if (hop.json !== undefined) walkJson(hop.json, `${at}.json`, out);
  if (hop.body !== undefined) {
    out.leaves.push({ at: `${at}.body`, text: hop.body });
    out.leaves.push({
      at: `${at}.body`,
      text: Buffer.from(hop.body, "base64").toString("latin1"),
    });
  }
}

/** BR-213 v2: every searched text with its location, and every form violation. */
function walkRecording(recording: Recording): Walk {
  const out: Walk = { leaves: [], forms: [] };
  out.leaves.push(
    { at: "format", text: recording.format },
    { at: "origin", text: recording.origin },
  );
  recording.exchanges.forEach((e, i) => {
    const at = `exchanges[${String(i)}]`;
    if (!ROUTE_TEMPLATES.has(e.template))
      out.leaves.push({ at: `${at}.template`, text: e.template });
    for (const [key, value] of Object.entries(e.params)) {
      const where = member(`${at}.params`, key);
      out.leaves.push(
        { at: where, text: key },
        { at: where, text: String(value) },
      );
    }
    e.query.forEach(([name, value], j) => {
      const where = `${at}.query[${String(j)}]`;
      out.leaves.push({ at: `${where}[0]`, text: name });
      if (name !== "limit") out.leaves.push({ at: `${where}[1]`, text: value });
      else if (value !== "50") out.forms.push(`${where}[1]`);
    });
    if (e.range !== undefined && !/^bytes=\d+-\d+$/u.test(e.range))
      out.forms.push(`${at}.range`);
    e.hops.forEach((hop, k) => {
      walkHop(hop, `${at}.hops[${String(k)}]`, out);
    });
  });
  return out;
}

/** BR-213 v2: the first location of each real ID other than `1`, by ascending ID. */
function idCollisions(
  leaves: readonly Leaf[],
  ids: readonly number[],
): string[] {
  const found = new Map<string, string>();
  for (const leaf of leaves)
    for (const token of leaf.text.match(WHOLE_DECIMAL) ?? [])
      if (!found.has(token)) found.set(token, leaf.at);
  return ids
    .filter((id) => id !== 1 && found.has(String(id)))
    .sort((a, b) => a - b)
    .map(
      (id) =>
        `real ID of ${String(String(id).length)} digits at ${found.get(String(id)) ?? ""}`,
    );
}

/** BR-213 v2: refuses output containing the token, real IDs/names, emails or URLs. */
export function leakCheck(
  recording: Recording,
  real: { token: string; ids: readonly number[]; names: readonly string[] },
): void {
  const text = JSON.stringify(recording);
  const decoded = recording.exchanges
    .flatMap((e) =>
      e.hops.map((h) =>
        h.body ? Buffer.from(h.body, "base64").toString("latin1") : "",
      ),
    )
    .join("\n");
  const all = `${text}\n${decoded}`;
  if (real.token && all.includes(real.token)) throw new LeakError("token");
  const { leaves, forms } = walkRecording(recording);
  if (forms.length > 0)
    throw new LeakError(
      forms.map((at) => `exempt field form at ${at}`).join("; "),
    );
  const collisions = idCollisions(leaves, real.ids);
  if (collisions.length > 0) throw new LeakError(collisions.join("; "));
  for (const name of real.names)
    if (
      Buffer.byteLength(name) >= 4 &&
      !KEPT_PATH_COMPONENTS.has(name) &&
      all.includes(name)
    )
      throw new LeakError("real name");
  if (/\w@\w/u.test(all)) throw new LeakError("email");
  const urls = all.match(/https?:[^\s"\\]*/gu) ?? [];
  if (urls.some((url) => url !== STORAGE_LOCATION)) throw new LeakError("URL");
}

/** BR-211/BR-213: writes only a recording that passed the leak check. */
export function writeSanitized(
  input: SanitizeInput,
  write: (text: string) => void,
): Recording {
  const recording = sanitize(input);
  write(`${JSON.stringify(recording, null, 1)}\n`);
  return recording;
}

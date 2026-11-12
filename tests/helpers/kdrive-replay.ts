// F-014 BR-214: replay of sanitized recordings through the injected
// transport, validation of their synthetic forms, and the synthetic session
// that exercises the recorder pipeline without any real account.
import {
  ENVELOPE_MEMBERS,
  HEADER_ALLOWLIST,
  ITEM_MEMBERS,
  KEPT_PATH_COMPONENTS,
  STORAGE_LOCATION,
  SYNTHETIC_ID_BASE,
  sanitize,
  type Recording,
} from "../../scripts/kdrive-sanitize.ts";
import { recordSession, type Manifest } from "../../scripts/kdrive-record.ts";
import { createTransport } from "../../src/kdrive/transport.js";
import { routes } from "../../src/kdrive/routes.js";
import {
  CANARY,
  STORAGE_HOST,
  kdriveFixture,
  success,
  tree,
  type Handler,
  type Node,
  type Reply,
} from "./kdrive.js";

/** Every problem that makes a committed recording unacceptable (BR-214). */
export function recordingProblems(value: unknown): string[] {
  const problems: string[] = [];
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const id = (v: unknown, where: string) => {
    if (
      v !== 1 &&
      !(
        typeof v === "number" &&
        Number.isSafeInteger(v) &&
        v >= SYNTHETIC_ID_BASE
      )
    )
      problems.push(`non-synthetic ID at ${where}`);
  };
  const name = (v: unknown, where: string) => {
    if (
      typeof v !== "string" ||
      !(v === "" || /^[nx][1-9]\d*$/u.test(v) || KEPT_PATH_COMPONENTS.has(v))
    )
      problems.push(`non-synthetic name at ${where}`);
  };
  const path = (v: unknown, where: string) => {
    if (typeof v !== "string" || !v.startsWith("/"))
      problems.push(`non-synthetic path at ${where}`);
    else if (v !== "/")
      for (const part of v.slice(1).split("/")) name(part, where);
  };
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-014: one pass per item member mirrors the Recorded-members list
  const item = (v: unknown, where: string) => {
    if (!isRecord(v)) return problems.push(`item shape at ${where}`);
    for (const [key, member] of Object.entries(v)) {
      if (!(ITEM_MEMBERS as readonly string[]).includes(key))
        problems.push(`member ${key} at ${where}`);
      if (["id", "drive_id", "parent_id"].includes(key)) id(member, where);
      if (key === "name") name(member, where);
      if (key === "path") path(member, where);
      if (key === "parents")
        if (Array.isArray(member))
          member.forEach((p, i) => item(p, `${where}.parents[${String(i)}]`));
        else problems.push(`parents at ${where}`);
      if (
        key === "capabilities" &&
        (!isRecord(member) ||
          Object.values(member).some((c) => typeof c !== "boolean"))
      )
        problems.push(`capabilities at ${where}`);
    }
    return undefined;
  };
  if (
    !isRecord(value) ||
    value.format !== "kdrive-recording/1" ||
    !Array.isArray(value.exchanges)
  )
    return ["recording shape"];
  for (const key of Object.keys(value))
    if (!["format", "origin", "exchanges"].includes(key))
      problems.push(`top-level member ${key}`);
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-014: the BR-214 validator walks each exchange shape in one table-driven pass
  value.exchanges.forEach((raw: unknown, index) => {
    const where = `exchange ${String(index)}`;
    if (!isRecord(raw)) return problems.push(where);
    const params = isRecord(raw.params) ? raw.params : {};
    for (const p of Object.values(params)) id(p, where);
    for (const pair of Array.isArray(raw.query)
      ? (raw.query as unknown[])
      : []) {
      const [k, v] = pair as [string, string];
      if (k === "directory_id") id(Number(v), where);
      if (k === "cursor" && !/^cursor[1-9]\d*$/u.test(v))
        problems.push(`cursor at ${where}`);
      if (k === "query") name(v, where);
    }
    for (const hop of Array.isArray(raw.hops) ? (raw.hops as unknown[]) : []) {
      if (!isRecord(hop)) continue;
      for (const [header, v] of Object.entries(
        isRecord(hop.headers) ? hop.headers : {},
      )) {
        if (!(HEADER_ALLOWLIST as readonly string[]).includes(header))
          problems.push(`header ${header} at ${where}`);
        if (header === "etag" && !/^"etag[1-9]\d*"$/u.test(String(v)))
          problems.push(`etag at ${where}`);
        if (header === "location" && v !== STORAGE_LOCATION)
          problems.push(`location at ${where}`);
      }
      if (!isRecord(hop.json)) continue;
      for (const [key, member] of Object.entries(hop.json)) {
        if (!(ENVELOPE_MEMBERS as readonly string[]).includes(key))
          problems.push(`envelope member ${key} at ${where}`);
        if (
          key === "cursor" &&
          member !== null &&
          !(typeof member === "string" && /^cursor[1-9]\d*$/u.test(member))
        )
          problems.push(`cursor at ${where}`);
        if (
          key === "error" &&
          (!isRecord(member) || Object.keys(member).some((k) => k !== "code"))
        )
          problems.push(`error at ${where}`);
        if (key !== "data") continue;
        if (raw.template === "/2/drive/init") {
          const drives =
            isRecord(member) && Array.isArray(member.drives)
              ? (member.drives as unknown[])
              : [];
          if (
            !isRecord(member) ||
            Object.keys(member).some((k) => k !== "drives")
          )
            problems.push(`init at ${where}`);
          for (const d of drives) {
            if (
              !isRecord(d) ||
              Object.keys(d).some((k) => k !== "id" && k !== "role")
            )
              problems.push(`drive at ${where}`);
            else id(d.id, where);
          }
        } else if (Array.isArray(member))
          member.forEach((e, i) => item(e, `${where}.data[${String(i)}]`));
        else item(member, `${where}.data`);
      }
    }
    return undefined;
  });
  return problems;
}

const target = (template: string, params: { d?: number; f?: number }) =>
  template.replace("{d}", String(params.d)).replace("{f}", String(params.f));

/** Serves a recording: API requests by path and query, the storage hop after its download. */
export function replayHandler(recording: Recording): Handler {
  let lastDownload: Recording["exchanges"][number] | undefined;
  const reply = (
    hop: Recording["exchanges"][number]["hops"][number],
  ): Reply => ({
    status: hop.status,
    headers: Object.fromEntries(
      Object.entries(hop.headers).filter(([k]) => k !== "content-length"),
    ),
    // Body bytes are kept only for the designated binary; other bodies are
    // replayed as zero bytes of the recorded length.
    ...(hop.json === undefined
      ? {
          body: hop.body
            ? Buffer.from(hop.body, "base64")
            : Buffer.alloc(Number(hop.headers["content-length"] ?? 0)),
        }
      : { json: hop.json }),
  });
  return (r) => {
    if (r.host === STORAGE_HOST) {
      const hop = lastDownload?.hops[1];
      return hop ? reply(hop) : { status: 500, body: "" };
    }
    const query = [...r.query].map(([k, v]) => `${k}=${v}`).join("&");
    const exchange = recording.exchanges.find(
      (e) =>
        target(e.template, e.params) === r.path &&
        e.query.map(([k, v]) => `${k}=${v}`).join("&") === query &&
        (e.range === undefined || e.range === r.headers.range),
    );
    if (!exchange?.hops[0]) return { status: 500, body: "" };
    if (exchange.template.endsWith("/download")) lastDownload = exchange;
    return reply(exchange.hops[0]);
  };
}

/** A synthetic session through the recorder pipeline (no real account). */
export async function syntheticSession(): Promise<Recording> {
  // Real-looking IDs stay above every alias number and size in the session,
  // as real kDrive IDs do, so the whole-token leak check stays meaningful.
  const shift = (id: number) => (id === 1 ? 1 : id + 7000);
  const nodes: Node[] = [
    // The version-change file is a synthetic 16-byte file like the binary.
    ...tree.map((n) => ({
      ...n,
      id: shift(n.id),
      parent: shift(n.parent),
      ...(n.id === 15 ? { size: 16 } : {}),
    })),
    { id: 7020, parent: 7010, type: "dir", name: "big" },
    ...Array.from({ length: 9 }, (_, i): Node => ({
      id: 9000 + i,
      parent: 7020,
      type: "file",
      name: `p${String(i)}`,
      size: 1,
    })),
  ];
  const own = 8101,
    owner = 8202;
  const anchor = {
    id: 8500,
    drive_id: owner,
    parent_id: 8077,
    type: "dir",
    name: "team",
    path: "/Shared/team",
  };
  const f = await kdriveFixture({
    nodes,
    pageSize: 4,
    drives: [
      { id: own, role: "admin" },
      { id: owner, role: "external" },
    ],
    shared: [{ ...anchor, status: null, capabilities: { can_read: true } }],
  });
  f.drive.overrides.push((r) => {
    const m = /^\/3\/drive\/8202\/files\/(\d+)(\/files)?$/u.exec(r.path);
    if (!m) return undefined;
    const id = Number(m[1]);
    if (m[2]) return success([], { has_more: false, cursor: null });
    if (id === 8500)
      return success({
        ...anchor,
        status: null,
        capabilities: { can_read: true },
        parents: [],
      });
    return success({
      id,
      drive_id: owner,
      parent_id: 8500,
      type: "file",
      status: "ok",
      name: `r${String(id)}`,
      path: `/Shared/team/r${String(id)}`,
      size: 1,
      parents: [anchor],
      capabilities: { can_read: true },
    });
  });
  const manifest: Manifest = {
    driveId: own,
    namespaceId: 7010,
    binaryId: 7012,
    nestedId: 7011,
    paginationId: 7020,
    outsideId: 7014,
    denyChildId: 7013,
    missingId: 7999,
    versionFileId: 7015,
    received: {
      driveId: owner,
      rootId: 8500,
      childId: 8501,
      grandchildId: 8502,
      denyId: 8503,
      revocableId: 8504,
      unrelatedId: 8505,
    },
  };
  try {
    const transport = createTransport({
      token: CANARY,
      lookup: f.lookup,
      connect: f.connect,
    });
    const exchanges = await recordSession(transport, routes, manifest);
    const ids = new Set([
      7010, 7011, 7012, 7013, 7014, 7015, 7020, 8500, 8501, 8502, 8503, 8504,
      8505,
    ]);
    return {
      ...sanitize({
        exchanges,
        manifestIds: ids,
        binaryId: 7012,
        token: CANARY,
      }),
      origin: "synthetic",
    };
  } finally {
    await f.close();
  }
}

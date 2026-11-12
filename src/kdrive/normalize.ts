import {
  item,
  name as checkName,
  join,
  path as checkPath,
} from "../policy/values.js";

/** Provider wire values are untrusted; every reader here fails closed. */
export type Wire = Record<string, unknown>;
export class Incomplete extends Error {
  constructor() {
    super("INCOMPLETE");
  }
}
export function incomplete(): never {
  throw new Incomplete();
}
export function wire(value: unknown): Wire {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    incomplete();
  return value as Wire;
}
export function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    incomplete();
  return value;
}
function safe<T>(check: () => T): T {
  try {
    return check();
  } catch {
    return incomplete();
  }
}
const validName = (value: unknown) => safe(() => checkName(value));
const validPath = (value: unknown) => safe(() => checkPath(value));

/** BR-199: the `status` member is present and `null` or `"ok"`. */
export function live(r: Wire): void {
  if (!Object.hasOwn(r, "status") || (r.status !== null && r.status !== "ok"))
    incomplete();
}
export function kind(value: unknown): "dir" | "file" {
  if (value !== "dir" && value !== "file") incomplete();
  return value;
}

/** Shared identity checks for every live provider item. */
export function identity(value: unknown, driveId: number) {
  const r = wire(value);
  const id = positive(r.id);
  if (positive(r.drive_id) !== driveId) incomplete();
  live(r);
  return { r, id, type: kind(r.type) };
}

interface Member {
  readonly id: number;
  readonly parentId: number;
  readonly name: string;
  readonly status: unknown;
}
function member(value: unknown, driveId: number): Member {
  const r = wire(value);
  const id = positive(r.id);
  if (Object.hasOwn(r, "drive_id") && r.drive_id !== driveId) incomplete();
  if (r.type !== "dir") incomplete();
  return {
    id,
    parentId: positive(r.parent_id),
    name: validName(r.name),
    status: r.status,
  };
}

/**
 * BR-199: exactly one of provider order or reverse order links each member's
 * `parent_id` to the previous member's `id`; the item's `parent_id` is the last
 * member's `id`. `first` is the required `parent_id` of the first member
 * (1 for the configured tree, unconstrained for received chains).
 */
export function ordered(
  value: unknown,
  driveId: number,
  parentId: number,
  first: number | undefined,
): Member[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2048) incomplete();
  const members = value.map((m) => member(m, driveId));
  const linked = (chain: readonly Member[]) => {
    let previous = first;
    for (const m of chain) {
      if (previous !== undefined && m.parentId !== previous) return false;
      previous = m.id;
    }
    return (chain.at(-1)?.id ?? first) === parentId;
  };
  const forward = linked(members),
    reverse = members.length > 1 && linked([...members].reverse());
  if (forward === reverse) {
    if (!forward || members.length > 1) incomplete();
  }
  const chain = forward ? members : [...members].reverse();
  const ids = new Set(chain.map((m) => m.id));
  if (ids.size !== chain.length || ids.has(1)) incomplete();
  return chain;
}

interface ChainMember {
  readonly driveId: number;
  readonly id: number;
  readonly type: "dir";
  readonly name: string;
  readonly path: string;
  readonly location: "live";
  readonly lifecycle: "live";
}
const sentinel = (driveId: number): ChainMember =>
  Object.freeze({
    driveId,
    id: 1,
    type: "dir" as const,
    name: "",
    path: "/",
    location: "live" as const,
    lifecycle: "live" as const,
  });

/** BR-199: a configured-drive item; throws `Incomplete` otherwise. */
export function treeItem(value: unknown, driveId: number) {
  const { r, id, type } = identity(value, driveId);
  if (id === 1) {
    // Root: the sentinel. Its provider path is "/", it has no parents.
    if (type !== "dir" || r.path !== "/") incomplete();
    if (
      r.parents !== undefined &&
      (!Array.isArray(r.parents) || r.parents.length)
    )
      incomplete();
    return safe(() =>
      item(
        { ...sentinel(driveId), status: "complete", parents: [], rootId: 1 },
        { driveId, id },
        "live",
      ),
    );
  }
  const parentId = positive(r.parent_id);
  const chain = ordered(r.parents, driveId, parentId, 1);
  const parents: ChainMember[] = [sentinel(driveId)];
  let previous = "/";
  for (const m of chain) {
    const p = safe(() => join(previous, m.name));
    parents.push(
      Object.freeze({
        driveId,
        id: m.id,
        type: "dir" as const,
        name: m.name,
        path: p,
        location: "live" as const,
        lifecycle: "live" as const,
      }),
    );
    previous = p;
  }
  const name = validName(r.name);
  const expected = safe(() => join(previous, name));
  if (validPath(r.path) !== expected) incomplete();
  return safe(() =>
    item(
      {
        driveId,
        id,
        status: "complete",
        type,
        name,
        path: expected,
        parents,
        location: "live",
        lifecycle: "live",
        rootId: 1,
      },
      { driveId, id },
      "live",
    ),
  );
}

/** F-017 BR-265: the checked members of directly trashed item metadata. */
export interface TrashMetadata {
  readonly driveId: number;
  readonly id: number;
  readonly type: "dir" | "file";
  readonly name: string;
  readonly path: string;
  readonly parentId: number;
}
export function trashMetadata(
  value: unknown,
  target: { readonly driveId: number; readonly id: number },
): TrashMetadata {
  const r = wire(value);
  if (r.status !== "trashed") incomplete();
  if (Object.hasOwn(r, "drive_id") && r.drive_id !== target.driveId)
    incomplete();
  const id = positive(r.id);
  if (id !== target.id) incomplete();
  return {
    driveId: target.driveId,
    id,
    type: kind(r.type),
    name: validName(r.name),
    path: validPath(r.path),
    parentId: positive(r.parent_id),
  };
}
/**
 * F-017 BR-264: complete original-trash evidence when the former parent is a
 * complete live directory and the trash path equals its path joined with the
 * item's name.
 */
export function originalTrashItem(
  trashed: TrashMetadata,
  former: ReturnType<typeof treeItem>,
) {
  if (former.type !== "dir") incomplete();
  if (safe(() => join(former.path, trashed.name)) !== trashed.path)
    incomplete();
  const parents = [...former.parents, former].map((p) =>
    Object.freeze({
      driveId: p.driveId,
      id: p.id,
      type: "dir" as const,
      name: p.name,
      path: p.path,
      location: "original-trash" as const,
      lifecycle: "live" as const,
    }),
  );
  return safe(() =>
    item(
      {
        driveId: trashed.driveId,
        id: trashed.id,
        status: "complete",
        type: trashed.type,
        name: trashed.name,
        path: trashed.path,
        parents,
        location: "original-trash",
        lifecycle: "trashed",
        rootId: 1,
        treeRootId: trashed.id,
      },
      { driveId: trashed.driveId, id: trashed.id },
      "original-trash",
    ),
  );
}

const mutations = [
  "createFile",
  "createDirectory",
  "replace",
  "rename",
  "renameTree",
  "moveOut",
  "acceptMove",
  "moveTree",
  "trash",
  "trashTree",
  "restore",
  "restoreTree",
  "acceptRestore",
] as const;

/** BR-204: read-only mapping; every mutation predicate is false. */
export function receivedCapabilities(value: unknown, type: "dir" | "file") {
  const caps =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Wire)
      : {};
  const read = caps.can_read === true;
  return Object.freeze({
    read,
    list: read && type === "dir",
    search: read && type === "dir",
    ...Object.fromEntries(mutations.map((m) => [m, false])),
  });
}

const SHARED = "/Shared/";
const liveMember = (m: Member) =>
  m.status === undefined || m.status === null || m.status === "ok";

/**
 * BR-203 v3: a received item on the owner's drive. Its provider path is
 * `/Shared/c1/…/cn` with `cn` its name; a root (n = 1) drops its chain, a
 * descendant's relative chain is the last n−1 chain members, named c1 … c(n−1).
 * Member `path` values are never read.
 */
export function receivedItem(value: unknown, driveId: number, role: string) {
  if (role !== "external") incomplete();
  const { r, id, type } = identity(value, driveId);
  const name = validName(r.name);
  const itemPath = validPath(r.path);
  const base = {
    driveId,
    id,
    status: "complete" as const,
    type,
    name,
    path: itemPath,
    location: "live" as const,
    lifecycle: "live" as const,
    role: "external" as const,
    capabilities: receivedCapabilities(r.capabilities, type),
  };
  const raw = r.parents;
  const chain =
    raw === undefined || (Array.isArray(raw) && raw.length === 0)
      ? []
      : ordered(raw, driveId, positive(r.parent_id), undefined);
  if (!chain.every(liveMember) || !itemPath.startsWith(SHARED)) incomplete();
  const components = itemPath.slice(SHARED.length).split("/");
  if (components.includes("") || components.at(-1) !== name) incomplete();
  const relative = chain.slice(chain.length - (components.length - 1));
  if (
    chain.length < components.length - 1 ||
    relative.some((m, i) => m.name !== components[i])
  )
    incomplete();
  if (relative.length === 0)
    return Object.freeze({ ...base, parents: Object.freeze([]), anchorId: id });
  const parents: ChainMember[] = relative.map((m, i) =>
    Object.freeze({
      driveId,
      id: m.id,
      type: "dir" as const,
      name: m.name,
      path: SHARED + components.slice(0, i + 1).join("/"),
      location: "live" as const,
      lifecycle: "live" as const,
    }),
  );
  return Object.freeze({
    ...base,
    parents: Object.freeze(parents),
    anchorId: (relative[0] as Member).id,
  });
}

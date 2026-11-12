import type { ResolvedConfiguration } from "../config.js";
import type { CollectionRequest, EvidenceRequest } from "./index.js";
import type { Operation } from "./operation.js";
import {
  array,
  id,
  join,
  key,
  name,
  path,
  record,
  reference,
  refuse,
  type Item,
  type Location,
  type Parent,
  type Ref,
} from "./values.js";

export interface ReceivedListRequest {
  readonly invocation: object;
  readonly listing: object;
  readonly cursor?: string;
}
/** Credential-bound internal port; no production adapter is qualified by this API. */
export interface ReceivedDependencies {
  list(request: ReceivedListRequest): Promise<unknown>;
  inspect(target: Ref, location: Location): Promise<unknown>;
  children(request: EvidenceRequest): Promise<unknown>;
  collection(request: CollectionRequest): Promise<unknown>;
  now?(): number;
}
interface Snapshot {
  readonly started: number;
  readonly roots: ReadonlyMap<string, Item>;
}
export interface ReceivedInvocation {
  readonly token: object;
  readonly mutation: boolean;
  readonly paging?: boolean;
  snapshot?: Promise<Snapshot>;
  resolvedSnapshot?: Snapshot;
  readonly anchors: Map<string, Promise<Item>>;
}
const capabilityNames = Object.freeze([
  "read",
  "list",
  "search",
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
]);
function capabilities(value: unknown): Readonly<Record<string, boolean>> {
  const r = record(value);
  // BR-053/056: unknown data is never traversed or serialized. Only exact true
  // predicates grant authority; all other known values normalize to false.
  return Object.freeze(
    Object.fromEntries(capabilityNames.map((p) => [p, r[p] === true])),
  );
}
/** Received chains can start at different proved anchors in one namespace. */
export function compatibleReceivedChain(
  a: readonly (Ref & { readonly path: string })[],
  b: readonly (Ref & { readonly path: string })[],
): boolean {
  const short = a.length <= b.length ? a : b,
    long = a.length <= b.length ? b : a;
  const offset = long.length - short.length;
  return short.every(
    (p, i) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
      p.id === long[offset + i]!.id &&
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
      p.driveId === long[offset + i]!.driveId &&
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
      p.path === long[offset + i]!.path,
  );
}
function base(value: unknown, expected: Ref | undefined, location: Location) {
  const r = record(value),
    ref = reference(r);
  if (
    r.status !== "complete" ||
    r.location !== location ||
    r.lifecycle !== (location === "live" ? "live" : "trashed") ||
    (r.type !== "file" && r.type !== "dir") ||
    ref.id === 1 ||
    (expected && key(ref) !== key(expected))
  )
    refuse("EVIDENCE_UNAVAILABLE");
  const p = path(r.path),
    n = name(r.name),
    anchorId = id(r.anchorId);
  if (!p.startsWith("/Shared/") || !p.endsWith("/" + n))
    refuse("EVIDENCE_UNAVAILABLE");
  return { r, ref, p, n, anchorId, caps: capabilities(r.capabilities) };
}
function root(value: unknown): Item {
  const { r, ref, p, n, anchorId, caps } = base(value, undefined, "live");
  if (
    r.role !== "external" ||
    anchorId !== ref.id ||
    array(r.parents, 2048).length
  )
    refuse("EVIDENCE_UNAVAILABLE");
  return Object.freeze({
    ...ref,
    status: "complete",
    type: r.type as "file" | "dir",
    path: p,
    name: n,
    parents: Object.freeze([]),
    location: "live",
    lifecycle: "live",
    anchorId,
    capabilities: caps,
  });
}
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
function parse(
  value: unknown,
  expected: Ref | undefined,
  location: Location,
  anchor: Item,
  roots: ReadonlyMap<string, Item>,
): Item {
  const { r, ref, p, n, anchorId, caps } = base(value, expected, location);
  if (ref.driveId !== anchor.driveId || anchorId !== anchor.id)
    refuse("EVIDENCE_UNAVAILABLE");
  const rawParents = array(r.parents, 2048),
    parents: Parent[] = [],
    seen = new Set([ref.id]);
  function consistentAlias(identity: Ref, at: string, type: unknown) {
    for (const listed of roots.values())
      if (
        listed.driveId === identity.driveId &&
        ((listed.id === identity.id &&
          (listed.path !== at || listed.type !== type)) ||
          (listed.path === at && listed.id !== identity.id))
      )
        refuse("EVIDENCE_UNAVAILABLE");
  }
  let previous = anchor.path;
  if (ref.id === anchor.id) {
    if (
      location !== "live" ||
      rawParents.length ||
      p !== anchor.path ||
      n !== anchor.name ||
      r.type !== anchor.type
    )
      refuse("EVIDENCE_UNAVAILABLE");
  } else {
    if (anchor.type !== "dir" || !rawParents.length)
      refuse("EVIDENCE_UNAVAILABLE");
    for (const raw of rawParents) {
      const parent = record(raw),
        pr = reference(parent),
        pp = path(parent.path),
        pn = name(parent.name);
      if (
        pr.driveId !== ref.driveId ||
        pr.id === 1 ||
        seen.has(pr.id) ||
        parent.type !== "dir" ||
        parent.location !== location ||
        parent.lifecycle !== "live"
      )
        refuse("EVIDENCE_UNAVAILABLE");
      if (!parents.length) {
        if (pr.id !== anchor.id || pp !== anchor.path || pn !== anchor.name)
          refuse("EVIDENCE_UNAVAILABLE");
      } else if (join(previous, pn) !== pp) refuse("EVIDENCE_UNAVAILABLE");
      seen.add(pr.id);
      const alias = roots.get(key(pr));
      if (alias && (alias.path !== pp || alias.type !== "dir"))
        refuse("EVIDENCE_UNAVAILABLE");
      consistentAlias(pr, pp, "dir");
      parents.push(
        Object.freeze({
          ...pr,
          type: "dir",
          name: pn,
          path: pp,
          location,
          lifecycle: "live",
        }),
      );
      previous = pp;
    }
    if (join(previous, n) !== p) refuse("EVIDENCE_UNAVAILABLE");
  }
  const alias = roots.get(key(ref));
  if (alias && (alias.path !== p || alias.type !== r.type))
    refuse("EVIDENCE_UNAVAILABLE");
  consistentAlias(ref, p, r.type);
  const treeRootId =
    location === "original-trash" ? id(r.treeRootId) : undefined;
  if (
    treeRootId !== undefined &&
    treeRootId !== ref.id &&
    !parents.some((v) => v.id === treeRootId)
  )
    refuse("EVIDENCE_UNAVAILABLE");
  return Object.freeze({
    ...ref,
    status: "complete",
    type: r.type as "file" | "dir",
    name: n,
    path: p,
    parents: Object.freeze(parents),
    location,
    lifecycle: location === "live" ? "live" : "trashed",
    anchorId,
    capabilities: caps,
    ...(treeRootId === undefined ? {} : { treeRootId }),
  });
}
function need(i: Item | undefined, ...predicates: string[]) {
  if (!i || predicates.some((p) => i.capabilities?.[p] !== true))
    refuse("SHARED_ACCESS_UNAVAILABLE");
}
/** BR-047–056: only the received-list snapshot can outlive an invocation. */
export function receivedPolicy(
  config: ResolvedConfiguration,
  dependency: ReceivedDependencies | undefined,
) {
  let cached: Snapshot | undefined,
    generation = 0;
  const now = () => (dependency?.now ? dependency.now() : performance.now());
  function time() {
    let n: number;
    try {
      n = now();
    } catch {
      cached = undefined;
      generation++;
      refuse("EVIDENCE_UNAVAILABLE");
    }
    if (typeof n !== "number" || !Number.isFinite(n)) {
      cached = undefined;
      generation++;
      refuse("EVIDENCE_UNAVAILABLE");
    }
    return n;
  }
  function age(snapshot: Snapshot) {
    const elapsed = time() - snapshot.started;
    const valid = elapsed >= 0 && elapsed < 60000;
    if (!valid) {
      cached = undefined;
      generation++;
    }
    return valid;
  }
  function available(): ReceivedDependencies {
    if (!config.sharedWithMe || !dependency)
      refuse("SHARED_ACCESS_UNAVAILABLE");
    return dependency;
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function acquire(ctx: ReceivedInvocation): Promise<Snapshot> {
    const dep = available();
    if (!ctx.mutation && cached && age(cached)) return cached;
    cached = undefined;
    const version = ++generation,
      started = time(),
      listing = Object.freeze({}),
      roots = new Map<string, Item>(),
      paths = new Map<number, Map<string, number>>(),
      cursors = new Set<string>();
    let cursor: string | undefined,
      requests = 0;
    for (;;) {
      if (requests++ >= 2 * config.maxTreeItems + 256)
        refuse("TRAVERSAL_LIMIT");
      const request = Object.freeze({
        invocation: ctx.token,
        listing,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const r = record(await dep.list(request));
      if (
        r.invocation !== ctx.token ||
        r.listing !== listing ||
        r.cursor !== cursor ||
        r.status !== "complete" ||
        r.discover !== true
      )
        refuse("EVIDENCE_UNAVAILABLE");
      const entries = array(r.entries, config.maxTreeItems);
      const terminal = r.terminal === true,
        next =
          typeof r.next === "string" &&
          r.next.length > 0 &&
          Buffer.byteLength(r.next) <= 4096;
      if (
        terminal === next ||
        (r.terminal !== undefined && !terminal) ||
        (r.next !== undefined && !next) ||
        (!terminal && !entries.length)
      )
        refuse("EVIDENCE_UNAVAILABLE");
      for (const raw of entries) {
        const i = root(raw);
        if (config.driveIds.includes(i.driveId) || roots.has(key(i)))
          refuse("EVIDENCE_UNAVAILABLE");
        const drivePaths = paths.get(i.driveId) ?? new Map<string, number>();
        if (drivePaths.has(i.path)) refuse("EVIDENCE_UNAVAILABLE");
        drivePaths.set(i.path, i.id);
        paths.set(i.driveId, drivePaths);
        roots.set(key(i), i);
        if (roots.size >= config.maxTreeItems) refuse("TRAVERSAL_LIMIT");
      }
      if (terminal) break;
      if (cursors.has(r.next as string)) refuse("EVIDENCE_UNAVAILABLE");
      cursors.add(r.next as string);
      cursor = r.next as string;
    }
    const snapshot = Object.freeze({ started, roots });
    if (!age(snapshot)) refuse("EVIDENCE_UNAVAILABLE");
    if (!ctx.mutation && version === generation) cached = snapshot;
    return snapshot;
  }
  function snapshot(ctx: ReceivedInvocation) {
    available();
    // eslint-disable-next-line sonarjs/no-nested-assignment -- F-011: assignment inside the expression keeps the reviewed evaluation order
    return (ctx.snapshot ??= acquire(ctx).then((resolved) => {
      ctx.resolvedSnapshot = resolved;
      return resolved;
    }));
  }
  async function anchor(ref: Ref, ctx: ReceivedInvocation): Promise<Item> {
    const roots = (await snapshot(ctx)).roots,
      k = key(ref),
      listed = roots.get(k);
    if (!listed) refuse("OUTSIDE_SCOPE");
    let proof = ctx.anchors.get(k);
    if (!proof) {
      proof = (async () => {
        const raw = await available().inspect(ref, "live");
        if (ctx.paging && record(raw).status === "missing")
          refuse("OUTSIDE_SCOPE");
        if (record(raw).role !== "external") refuse("EVIDENCE_UNAVAILABLE");
        return parse(raw, ref, "live", listed, roots);
      })();
      ctx.anchors.set(k, proof);
    }
    return proof;
  }
  async function normalize(
    value: unknown,
    expected: Ref | undefined,
    location: Location,
    ctx: ReceivedInvocation,
  ): Promise<Item> {
    const r = record(value),
      ref = reference(r),
      roots = (await snapshot(ctx)).roots;
    if (config.driveIds.includes(ref.driveId)) refuse("OUTSIDE_SCOPE");
    const a = await anchor({ driveId: ref.driveId, id: id(r.anchorId) }, ctx);
    return parse(value, expected, location, a, roots);
  }
  return {
    /** BR-077: identities from complete membership only; each emitted root is inspected later. */
    async candidates(ctx: ReceivedInvocation): Promise<readonly Ref[]> {
      return Object.freeze(
        [...(await snapshot(ctx)).roots.values()].map((i) =>
          Object.freeze({ driveId: i.driveId, id: i.id }),
        ),
      );
    },
    /** BR-077/079: discovery candidates retain root membership, never descendant fallback. */
    async rootCandidate(
      ref: Ref,
      ctx: ReceivedInvocation,
    ): Promise<Item | undefined> {
      if (!(await snapshot(ctx)).roots.has(key(ref))) return undefined;
      const fresh = await anchor(ref, ctx);
      need(fresh, "read");
      return fresh;
    },
    fingerprint: (i: Item) =>
      JSON.stringify([
        i.driveId,
        i.id,
        i.type,
        i.name,
        i.path,
        i.location,
        i.lifecycle,
        i.treeRootId,
        capabilityNames.map((p) => i.capabilities?.[p] === true),
      ]),
    exposed: (i: Item) =>
      Object.freeze({
        driveId: i.driveId,
        id: i.id,
        type: i.type,
        name: i.name,
        path: i.path,
      }),
    async inspect(ref: Ref, location: Location, ctx: ReceivedInvocation) {
      available();
      if (ref.id === 1) refuse("OUTSIDE_SCOPE");
      const roots = (await snapshot(ctx)).roots;
      if (location === "live" && roots.has(key(ref))) return anchor(ref, ctx);
      return normalize(
        await available().inspect(ref, location),
        ref,
        location,
        ctx,
      );
    },
    normalize,
    authorize(i: Item) {
      if (i.anchorId === undefined) refuse("OUTSIDE_SCOPE");
    },
    // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
    gate(
      op: Operation,
      source: Item | undefined,
      destination: Item | undefined,
    ) {
      if (
        ["recents", "my-shared", "share-link", "share-invite"].includes(op.kind)
      )
        refuse("SHARED_ACCESS_UNAVAILABLE");
      if (["read", "list", "search"].includes(op.kind)) {
        need(source, "read", ...(op.kind === "read" ? [] : [op.kind]));
        return;
      }
      if (!config.effectiveSharedWrite) refuse("LEVEL_REQUIRED");
      switch (op.kind) {
        case "create":
          need(
            destination,
            op.type === "dir" ? "createDirectory" : "createFile",
          );
          break;
        case "upload-new":
          need(destination, "createFile");
          break;
        case "replace":
          need(source, "replace");
          break;
        case "rename":
          need(
            source,
            "rename",
            ...(source?.type === "dir" ? ["renameTree"] : []),
          );
          break;
        case "move":
          need(
            source,
            "moveOut",
            ...(source?.type === "dir" ? ["moveTree"] : []),
          );
          need(destination, "acceptMove");
          break;
        case "trash":
          need(
            source,
            "trash",
            ...(source?.type === "dir" ? ["trashTree"] : []),
          );
          break;
        case "restore":
          need(
            source,
            "restore",
            ...(source?.type === "dir" ? ["restoreTree"] : []),
          );
          need(
            destination,
            "acceptRestore",
            source?.type === "dir" ? "createDirectory" : "createFile",
          );
          break;
        default:
          refuse("INVALID_OPERATION");
      }
      // The alias/mount's own mutation effect is not established by this port.
      if (
        source?.id === source?.anchorId &&
        ["rename", "move", "restore"].includes(op.kind)
      )
        refuse("EVIDENCE_UNAVAILABLE");
    },
    read: (i: Item) => {
      need(i, "read");
    },
    children: (request: EvidenceRequest) => available().children(request),
    collection: (request: CollectionRequest) => available().collection(request),
    async discover(ctx: ReceivedInvocation, permitted: (path: string) => void) {
      const roots = (await snapshot(ctx)).roots,
        entries: Item[] = [];
      for (const i of roots.values()) {
        try {
          const fresh = await anchor(i, ctx);
          need(fresh, "read");
          permitted(fresh.path);
          entries.push(fresh);
        } catch {
          /* Individual unreadable roots are omitted; the list is still complete. */
        }
      }
      return Object.freeze({
        entries: Object.freeze(
          entries.map((i) =>
            Object.freeze({
              driveId: i.driveId,
              id: i.id,
              type: i.type,
              name: i.name,
              path: i.path,
            }),
          ),
        ),
        terminal: true,
      });
    },
    async final(ctx: ReceivedInvocation) {
      if (ctx.snapshot && !age(await ctx.snapshot))
        refuse("EVIDENCE_UNAVAILABLE");
    },
    // BR-051/057: call after awaited evaluation, with no await before protected
    // invocation or output publication. A pending snapshot cannot confer a grant.
    terminal(ctx: ReceivedInvocation) {
      if (ctx.snapshot && (!ctx.resolvedSnapshot || !age(ctx.resolvedSnapshot)))
        refuse("EVIDENCE_UNAVAILABLE");
    },
  };
}

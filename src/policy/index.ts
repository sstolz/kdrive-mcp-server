/* eslint-disable @typescript-eslint/no-non-null-assertion -- F-011: this file holds 25 pre-existing assertions on values checked earlier in the same flow (indexed parser and policy state); a file-level directive is kept for this dense file only, and removing them is deferred to keep reviewed control flow unchanged (BACKLOG.md) */
import { isResolvedConfiguration } from "../config.js";
import { matches } from "./glob.js";
import {
  compatibleReceivedChain,
  receivedPolicy,
  type ReceivedDependencies,
  type ReceivedInvocation,
} from "./received.js";
export type { ReceivedDependencies, ReceivedListRequest } from "./received.js";
import {
  collectionKinds,
  operation,
  readKinds,
  shareKinds,
  type Operation,
} from "./operation.js";
import {
  refusalCode,
  array,
  item,
  join,
  key,
  path,
  record,
  refuse,
  within,
  type Code,
  type Item,
  type Location,
  type Parent,
  type Ref,
} from "./values.js";
import type { ContentDependencies } from "../content.js";
export type { Operation } from "./operation.js";
export type { Ref, Location } from "./values.js";
export interface EvidenceRequest extends Ref {
  readonly invocation: object;
  readonly listing: object;
  readonly location: Location;
  readonly treeRootId?: number;
  readonly cursor?: string;
}
export interface CollectionRequest {
  readonly invocation: object;
  readonly listing: object;
  readonly scope: Ref;
  readonly kind: string;
  readonly query?: string;
  readonly cursor?: string;
}
export interface PolicyDependencies {
  readonly content?: ContentDependencies;
  readonly received?: ReceivedDependencies;
  inspect(target: Ref, location: Location): Promise<unknown>;
  children(request: EvidenceRequest): Promise<unknown>;
  collection(request: CollectionRequest): Promise<unknown>;
  execute(operation: Operation): Promise<unknown>;
}
type Decision = { allowed: true } | { allowed: false; code: Code };
type Result =
  { ok: true; value: unknown } | { ok: false; code: "ACCESS_DENIED" };
interface Region {
  driveId: number;
  id?: number;
  path: string;
  subtree: boolean;
  ancestorIds?: readonly number[];
}
interface Effect {
  operation: Operation;
  dependencies: Item[];
  regions: Region[];
}
interface Page {
  entries: readonly unknown[];
  terminal?: true;
  next?: string;
}
interface Invocation {
  readonly received: ReceivedInvocation;
  readonly token: object;
  readonly inspections: Map<string, Item>;
  readonly observations: Map<
    string,
    { fingerprint: string; parents: readonly Parent[]; received: boolean }
  >;
  readonly currentLifecycles: Map<string, "live" | "trashed">;
  readonly descendants: Set<string>;
  readonly visitedDirectories: Set<string>;
  count: number;
  pages: number;
  navigationEntries?: readonly Item[];
}
/** F-005 projection contains only the exact normalized navigation fields. */
export interface NavigationItem {
  readonly drive_id: number;
  readonly id: number;
  readonly name: string;
  readonly type: "file" | "dir";
  readonly path: string;
}
type NavigationResult =
  | {
      readonly ok: true;
      readonly item: NavigationItem;
      readonly entries?: readonly NavigationItem[];
    }
  | {
      readonly ok: false;
      readonly code: "ACCESS_DENIED" | "PAGINATION_UNAVAILABLE";
    };
const navigationFacades = new WeakMap<
  object,
  (value: unknown) => Promise<NavigationResult>
>();
export interface CollectionPage {
  readonly entries: readonly NavigationItem[];
  readonly next?: string;
}
const pagingFacades = new WeakMap<
  object,
  {
    read(ref: Ref): Promise<{ item?: NavigationItem; invalid?: true }>;
    root(ref: Ref): Promise<{ item?: NavigationItem; invalid?: true }>;
    page(value: unknown, cursor?: string): Promise<CollectionPage | undefined>;
    candidates(): Promise<readonly Ref[] | undefined>;
  }
>();
/** F-006: only constructed policies have these immediate guarded consumer ports. */
export function pagePolicy(policy: object, value: unknown, cursor?: string) {
  return (
    pagingFacades.get(policy)?.page(value, cursor) ?? Promise.resolve(undefined)
  );
}
export function receivedCandidatesPolicy(policy: object) {
  return pagingFacades.get(policy)?.candidates() ?? Promise.resolve(undefined);
}
export function readPagePolicy(policy: object, ref: Ref) {
  return (
    pagingFacades.get(policy)?.read(ref) ??
    Promise.resolve({ invalid: true as const })
  );
}
export function readReceivedRootPolicy(policy: object, ref: Ref) {
  return (
    pagingFacades.get(policy)?.root(ref) ??
    Promise.resolve({ invalid: true as const })
  );
}
/** BR-063: only an exact constructed policy instance has a private navigation port. */
export function navigatePolicy(
  policy: object,
  value: unknown,
): Promise<NavigationResult> {
  return navigationFacades.get(policy)?.(value) ?? Promise.resolve(denied);
}
function project(i: Item): NavigationItem {
  return Object.freeze({
    drive_id: i.driveId,
    id: i.id,
    name: i.name,
    type: i.type,
    path: i.path,
  });
}
const denied = Object.freeze({
  ok: false as const,
  code: "ACCESS_DENIED" as const,
});
function page(value: unknown, allowEmpty = false): Page {
  const r = record(value);
  if (r.status !== "complete") refuse("EVIDENCE_UNAVAILABLE");
  const entries = array(r.entries, 1000000);
  const terminal = r.terminal === true,
    next =
      typeof r.next === "string" &&
      r.next.length > 0 &&
      Buffer.byteLength(r.next) <= 4096;
  if (
    terminal === next ||
    (r.terminal !== undefined && r.terminal !== true) ||
    (r.next !== undefined && !next) ||
    (!allowEmpty && !terminal && !entries.length)
  )
    refuse("EVIDENCE_UNAVAILABLE");
  return {
    entries,
    ...(terminal ? { terminal: true } : { next: r.next as string }),
  };
}
function overlaps(a: Region, b: Region): boolean {
  return (
    a.driveId === b.driveId &&
    ((a.id !== undefined && a.id === b.id) ||
      a.path === b.path ||
      (a.subtree && within(a.path, b.path)) ||
      (b.subtree && within(b.path, a.path)) ||
      (a.subtree &&
        a.id !== undefined &&
        b.ancestorIds?.includes(a.id) === true) ||
      (b.subtree &&
        b.id !== undefined &&
        a.ancestorIds?.includes(b.id) === true))
  );
}
function region(i: Item): Region {
  return {
    driveId: i.driveId,
    id: i.id,
    path: i.path,
    subtree: i.type === "dir",
    ancestorIds: i.parents.map((p) => p.id),
  };
}
function namespace(i: Item): string {
  return `${i.location}:${String(i.location === "original-trash" ? i.treeRootId : "")}:${String(i.driveId)}`;
}
/** BR-033: reconcile source/ancestor observations across every evidence port. */
function observe(i: Item, inv: Invocation) {
  // Original parents describe deletion-time history, not current live state.
  // The actual original-trash item, and live items/ancestors, assert current state.
  for (const current of i.location === "live" ? [...i.parents, i] : [i]) {
    const identity = key(current),
      previous = inv.currentLifecycles.get(identity);
    if (previous !== undefined && previous !== current.lifecycle)
      refuse("EVIDENCE_UNAVAILABLE");
    inv.currentLifecycles.set(identity, current.lifecycle);
  }
  const chain = i.parents.filter((p) => p.id !== 1);
  const entries = [...chain, i];
  for (let index = 0; index < entries.length; index++) {
    const current = entries[index]!;
    const identity = `${namespace(i)}:${String(current.id)}`;
    const fingerprint = JSON.stringify([
      current.type,
      current.name,
      current.path,
    ]);
    const previous = inv.observations.get(identity),
      parents = chain.slice(0, index),
      received = i.anchorId !== undefined;
    if (
      previous !== undefined &&
      (previous.fingerprint !== fingerprint ||
        previous.received !== received ||
        (!received && previous.parents.length !== parents.length) ||
        !compatibleReceivedChain(previous.parents, parents))
    )
      refuse("EVIDENCE_UNAVAILABLE");
    // BR-049: a received anchor's empty relative prefix does not disprove its
    // already proved parents. Preserve the longest compatible proof. Ordinary
    // configured-drive ancestry still requires complete, equal-length chains.
    inv.observations.set(identity, {
      fingerprint,
      received,
      parents:
        previous && previous.parents.length > parents.length
          ? previous.parents
          : parents,
    });
  }
}
/** Abstract policy only: injected ports and synthetic consumers do not qualify production. */
export function createPolicy(
  configuration: unknown,
  dependencies: PolicyDependencies,
) {
  if (!isResolvedConfiguration(configuration))
    throw new TypeError("Successful preflight configuration required.");
  const roots = configuration.resolvedRoots.map((r) => Object.freeze({ ...r }));
  const denies = Object.freeze([...configuration.deny]);
  const domains = Object.freeze([...configuration.inviteDomains]);
  const mode = configuration.mode,
    N = configuration.maxTreeItems,
    publicLinks = configuration.effectivePublicLinks;
  const allowedDrives = new Set(configuration.driveIds);
  const shared = receivedPolicy(configuration, dependencies.received);
  function scope(i: Item) {
    if (i.anchorId !== undefined) {
      shared.authorize(i);
      return;
    }
    if (
      !allowedDrives.has(i.driveId) ||
      !roots.some(
        (r) =>
          r.driveId === i.driveId &&
          (r.folderId === 1 ||
            r.folderId === i.id ||
            i.parents.some((p) => p.id === r.folderId)),
      )
    )
      refuse("OUTSIDE_SCOPE");
  }
  function permitted(p: string) {
    path(p);
    if (denies.some((pattern) => matches(pattern, p))) refuse("DENIED_PATH");
  }
  function authorize(i: Item) {
    scope(i);
    permitted(i.path);
  }
  async function inspect(
    ref: Ref,
    location: Location,
    inv: Invocation,
  ): Promise<Item> {
    const k = `${location}:${key(ref)}`,
      prior = inv.inspections.get(k);
    if (prior) return prior;
    const local = async () => {
      const raw = await dependencies.inspect(ref, location);
      if (inv.received.paging && record(raw).status === "missing")
        refuse("OUTSIDE_SCOPE");
      return item(raw, ref, location);
    };
    const inspected = allowedDrives.has(ref.driveId)
      ? await local()
      : await shared.inspect(ref, location, inv.received);
    observe(inspected, inv);
    inv.inspections.set(k, inspected);
    return inspected;
  }
  /** BR-036–039: complete namespace-specific descendants; never filter a tree proof. */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function traverse(
    source: Item,
    result: string | undefined,
    inv: Invocation,
  ) {
    const queue = [source];
    while (queue.length) {
      const parent = queue.shift()!;
      const parentKey = `${namespace(parent)}:${String(parent.id)}`;
      if (inv.visitedDirectories.has(parentKey)) refuse("EVIDENCE_UNAVAILABLE");
      inv.visitedDirectories.add(parentKey);
      const listing = Object.freeze({}),
        cursors = new Set<string>();
      let cursor: string | undefined;
      for (;;) {
        if (inv.pages >= 2 * N + 256) refuse("TRAVERSAL_LIMIT");
        inv.pages++;
        const request: EvidenceRequest = Object.freeze({
          ...{ driveId: parent.driveId, id: parent.id },
          invocation: inv.token,
          listing,
          location: source.location,
          ...(source.treeRootId === undefined
            ? {}
            : { treeRootId: source.treeRootId }),
          ...(cursor === undefined ? {} : { cursor }),
        });
        const raw = record(
          await (source.anchorId === undefined
            ? dependencies.children(request)
            : shared.children(request)),
        );
        if (
          raw.invocation !== inv.token ||
          raw.listing !== listing ||
          raw.driveId !== parent.driveId ||
          raw.id !== parent.id ||
          raw.location !== source.location ||
          raw.treeRootId !== source.treeRootId ||
          raw.cursor !== cursor
        )
          refuse("EVIDENCE_UNAVAILABLE");
        const p = page(raw);
        for (const entry of p.entries) {
          inv.count++;
          if (inv.count >= N) refuse("TRAVERSAL_LIMIT");
          const child =
            source.anchorId === undefined
              ? item(entry, undefined, source.location)
              : await shared.normalize(
                  entry,
                  undefined,
                  source.location,
                  inv.received,
                );
          if (
            child.driveId !== source.driveId ||
            child.id === source.id ||
            inv.descendants.has(`${namespace(child)}:${String(child.id)}`) ||
            child.treeRootId !== source.treeRootId
          )
            refuse("EVIDENCE_UNAVAILABLE");
          const chain = child.parents.filter((p) => p.id !== 1),
            parentChain = [
              ...parent.parents,
              ...(parent.id === 1 ? [] : [parent]),
            ].filter((p) => p.id !== 1);
          const consistent =
            source.anchorId === undefined
              ? chain.length === parentChain.length &&
                chain.every(
                  (a, i) =>
                    a.id === parentChain[i]!.id &&
                    a.path === parentChain[i]!.path &&
                    a.driveId === parentChain[i]!.driveId,
                )
              : chain.at(-1)?.id === parent.id &&
                compatibleReceivedChain(chain, parentChain);
          if (!consistent) refuse("EVIDENCE_UNAVAILABLE");
          if (join(parent.path, child.name) !== child.path)
            refuse("EVIDENCE_UNAVAILABLE");
          inv.descendants.add(`${namespace(child)}:${String(child.id)}`);
          observe(child, inv);
          authorize(child);
          if (result !== undefined)
            permitted(`${result}${child.path.slice(source.path.length)}`);
          if (child.type === "dir") queue.push(child);
        }
        if (p.terminal) break;
        if (cursors.has(p.next!)) refuse("EVIDENCE_UNAVAILABLE");
        cursors.add(p.next!);
        cursor = p.next;
      }
    }
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function effects(op: Operation, inv: Invocation): Promise<Effect> {
    if (op.kind === "shared-with-me") refuse("SHARED_ACCESS_UNAVAILABLE");
    if (
      (!readKinds.has(op.kind) && mode === "read") ||
      (shareKinds.has(op.kind) && mode !== "share")
    )
      refuse("LEVEL_REQUIRED");
    // F-017 BR-278: a configured root is never trashed, renamed or moved.
    if (
      ["trash", "rename", "move"].includes(op.kind) &&
      op.target &&
      roots.some(
        (r) => r.driveId === op.target!.driveId && r.folderId === op.target!.id,
      )
    )
      refuse("INVALID_OPERATION");
    const sourceRef = op.target ?? op.scope;
    const source = sourceRef
      ? await inspect(
          sourceRef,
          // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          op.kind === "restore" ? "original-trash" : "live",
          inv,
        )
      : undefined;
    if (source) authorize(source);
    // BR-039 v2: a restore's destination is the immediate parent of its
    // original-trash evidence, inspected live; both reads must agree.
    const former = op.kind === "restore" ? source?.parents.at(-1) : undefined;
    if (op.kind === "restore" && !former) refuse("EVIDENCE_UNAVAILABLE");
    const destinationRef = former
      ? { driveId: former.driveId, id: former.id }
      : op.destination;
    const destination = destinationRef
      ? await inspect(destinationRef, "live", inv)
      : undefined;
    if (destination) {
      authorize(destination);
      if (destination.type !== "dir") refuse("INVALID_OPERATION");
      if (
        former &&
        (destination.id !== former.id || destination.path !== former.path)
      )
        refuse("EVIDENCE_UNAVAILABLE");
    }
    if (source?.anchorId !== undefined || destination?.anchorId !== undefined)
      shared.gate(op, source, destination);
    if (source && destination && source.driveId !== destination.driveId)
      refuse("INVALID_OPERATION");
    if (
      source?.id === 1 &&
      ["rename", "move", "trash", "restore"].includes(op.kind)
    )
      refuse("INVALID_OPERATION");
    if (collectionKinds.has(op.kind) && source?.type !== "dir")
      refuse("INVALID_OPERATION");
    if (op.kind === "replace" && source?.type !== "file")
      refuse("INVALID_OPERATION");
    // F-018 BR-035 v2: the target is the file called `name` in `destination`.
    if (
      op.kind === "replace" &&
      // The drive root may be omitted from `parents` (as in children checks).
      (!(
        source!.parents.at(-1)?.id === destination!.id ||
        (destination!.id === 1 && source!.parents.length === 0)
      ) ||
        source!.name !== op.name ||
        join(destination!.path, op.name) !== source!.path)
    )
      refuse("INVALID_OPERATION");
    if (
      (op.kind === "move" || op.kind === "restore") &&
      source &&
      destination &&
      (source.id === destination.id ||
        destination.parents.some((p) => p.id === source.id))
    )
      refuse("INVALID_OPERATION");
    let result: string | undefined;
    if (op.kind === "rename") {
      const parent =
        source!.path.slice(0, source!.path.lastIndexOf("/")) || "/";
      result = join(parent, op.name!);
    } else if (destination)
      result = join(destination.path, op.name ?? source!.name);
    if (result !== undefined) permitted(result);
    if (shareKinds.has(op.kind)) {
      if (op.kind === "share-link" && !publicLinks) refuse("SHARE_RESTRICTED");
      if (op.kind === "share-invite" && !domains.includes(op.domain!))
        refuse("SHARE_RESTRICTED");
      if (
        source!.type === "dir" &&
        denies.some((pattern) => {
          const index = pattern.search(/[?*]/u),
            prefix = index < 0 ? pattern : pattern.slice(0, index);
          return (
            prefix.startsWith(source!.path) || source!.path.startsWith(prefix)
          );
        })
      )
        refuse("SHARE_RESTRICTED");
    }
    if (
      source?.type === "dir" &&
      denies.length &&
      ["rename", "move", "trash", "restore"].includes(op.kind)
    )
      await traverse(source, result, inv);
    const regions: Region[] = [];
    if (!readKinds.has(op.kind) && !shareKinds.has(op.kind)) {
      if (source) regions.push(region(source));
      if (result !== undefined)
        regions.push({
          driveId: destination?.driveId ?? source!.driveId,
          path: result,
          subtree: source?.type === "dir" || op.type === "dir",
          ancestorIds: destination
            ? [...destination.parents.map((p) => p.id), destination.id]
            : (source?.parents.map((p) => p.id) ?? []),
        });
    }
    return {
      operation: op,
      dependencies: [
        ...(source ? [source] : []),
        ...(destination ? [destination] : []),
      ],
      regions,
    };
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function collection(
    op: Operation,
    inv: Invocation,
    paging?: { cursor?: string },
  ): Promise<unknown> {
    const listing = Object.freeze({});
    const request: CollectionRequest = Object.freeze({
      kind: op.kind,
      scope: op.scope!,
      invocation: inv.token,
      listing,
      ...(op.query === undefined ? {} : { query: op.query }),
      ...(paging?.cursor === undefined ? {} : { cursor: paging.cursor }),
    });
    const external = !allowedDrives.has(op.scope!.driveId);
    const raw = record(
      await (external
        ? shared.collection(request)
        : dependencies.collection(request)),
    );
    const scopeRef = record(raw.scope);
    if (
      raw.invocation !== inv.token ||
      raw.listing !== listing ||
      raw.kind !== op.kind ||
      scopeRef.driveId !== op.scope!.driveId ||
      scopeRef.id !== op.scope!.id ||
      raw.query !== op.query ||
      (paging !== undefined && raw.cursor !== paging.cursor)
    )
      refuse("EVIDENCE_UNAVAILABLE");
    const p = page(raw, paging !== undefined),
      entries: Item[] = [],
      seen = new Map<string, string>();
    for (const value of p.entries) {
      let parsed: Item;
      let identity: string | undefined;
      try {
        const candidate = record(value);
        if (
          typeof candidate.driveId === "number" &&
          typeof candidate.id === "number"
        )
          identity = `${String(candidate.driveId)}:${String(candidate.id)}`;
      } catch {
        /* Invalid entries are omitted unless they conflict with another identity. */
      }
      try {
        parsed = external
          ? await shared.normalize(value, undefined, "live", inv.received)
          : item(value, undefined, "live");
      } catch {
        // BR-079/081: a malformed paged batch cannot authorize its valid neighbors.
        if (paging !== undefined) refuse("EVIDENCE_UNAVAILABLE");
        if (identity !== undefined) {
          if (seen.has(identity)) refuse("EVIDENCE_UNAVAILABLE");
          seen.set(identity, "incomplete");
        }
        continue;
      }
      const k = key(parsed),
        fingerprint = external
          ? shared.fingerprint(parsed)
          : JSON.stringify(parsed);
      // Reconcile each received proof, including compatible duplicate routes;
      // primitive capability fingerprints separately detect permission conflicts.
      if (external) observe(parsed, inv);
      if (seen.has(k)) {
        if (seen.get(k) !== fingerprint) refuse("EVIDENCE_UNAVAILABLE");
        continue;
      }
      seen.set(k, fingerprint);
      if (!external) observe(parsed, inv);
      try {
        authorize(parsed);
        if (external) {
          shared.read(parsed);
          const scope = op.scope!;
          if (
            parsed.driveId !== scope.driveId ||
            (op.kind === "list"
              ? parsed.parents.at(-1)?.id !== scope.id
              : parsed.id !== scope.id &&
                !parsed.parents.some((p) => p.id === scope.id))
          )
            refuse("OUTSIDE_SCOPE");
        }
      } catch {
        continue;
      }
      entries.push(parsed);
    }
    inv.navigationEntries = entries;
    return Object.freeze({
      entries: Object.freeze(external ? entries.map(shared.exposed) : entries),
      ...(p.terminal ? { terminal: true } : { next: p.next }),
    });
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function evaluate(
    value: unknown,
    paging?: { cursor?: string },
  ): Promise<{ op: Operation; inv: Invocation; value?: unknown }> {
    const op = operation(value),
      token = Object.freeze({}),
      inv: Invocation = {
        token,
        received: {
          token,
          paging: paging !== undefined,
          mutation: (op.operations ?? [op]).some(
            (o) => !readKinds.has(o.kind) && o.kind !== "shared-with-me",
          ),
          anchors: new Map(),
        },
        inspections: new Map(),
        observations: new Map(),
        currentLifecycles: new Map(),
        descendants: new Set(),
        visitedDirectories: new Set(),
        count: 0,
        pages: 0,
      };
    if (op.kind === "shared-with-me") {
      const value = await shared.discover(inv.received, permitted);
      await shared.final(inv.received);
      return { op, inv, value };
    }
    const ops = op.operations ?? [op],
      derived: Effect[] = [],
      targets = new Set<string>();
    for (const entry of ops) {
      const target = entry.target ?? entry.scope;
      if (target) {
        if (targets.has(key(target))) refuse("INVALID_OPERATION");
        targets.add(key(target));
      }
      derived.push(await effects(entry, inv));
    }
    if (op.kind === "batch") {
      if (ops.some((entry) => collectionKinds.has(entry.kind)))
        refuse("INVALID_OPERATION");
      for (let i = 0; i < derived.length; i++)
        for (let j = i + 1; j < derived.length; j++) {
          const a = derived[i]!,
            b = derived[j]!;
          if (
            a.regions.some(
              (r) =>
                b.regions.some((s) => overlaps(r, s)) ||
                b.dependencies.some((d) =>
                  overlaps(r, { ...region(d), subtree: false }),
                ),
            ) ||
            b.regions.some((r) =>
              a.dependencies.some((d) =>
                overlaps(r, { ...region(d), subtree: false }),
              ),
            )
          )
            refuse("INVALID_OPERATION");
        }
    }
    const collectionValue = collectionKinds.has(op.kind)
      ? await collection(op, inv, paging)
      : undefined;
    await shared.final(inv.received);
    return {
      op,
      inv,
      ...(collectionKinds.has(op.kind) ? { value: collectionValue } : {}),
    };
  }
  /** BR-063/064/065: additive immediate projection; dispatch/check surface is unchanged. */
  async function navigate(value: unknown): Promise<NavigationResult> {
    try {
      const op = operation(value);
      if (op.kind !== "read" && op.kind !== "list") return denied;
      const authorized = await evaluate(op);
      shared.terminal(authorized.inv.received);
      const ref = op.target ?? op.scope!;
      const source = authorized.inv.inspections.get(`live:${key(ref)}`);
      if (!source) return denied;
      if (op.kind === "read") return { ok: true, item: project(source) };
      const pageValue = record(authorized.value);
      if (pageValue.terminal !== true)
        return { ok: false, code: "PAGINATION_UNAVAILABLE" };
      const entries = (authorized.inv.navigationEntries ?? [])
        .filter(
          (entry) =>
            entry.driveId === source.driveId &&
            entry.id !== source.id &&
            (entry.parents.at(-1)?.id === source.id ||
              (source.id === 1 && entry.parents.length === 0)) &&
            entry.path === join(source.path, entry.name),
        )
        .map(project);
      return {
        ok: true,
        item: project(source),
        entries: Object.freeze(entries),
      };
    } catch {
      return denied;
    }
  }
  const facade = Object.freeze({
    async check(value: unknown): Promise<Decision> {
      try {
        const authorized = await evaluate(value);
        shared.terminal(authorized.inv.received);
        return { allowed: true };
      } catch (error) {
        return {
          allowed: false,
          code: refusalCode(error),
        };
      }
    },
    async dispatch(value: unknown): Promise<Result> {
      let authorized: Awaited<ReturnType<typeof evaluate>>;
      try {
        authorized = await evaluate(value);
        shared.terminal(authorized.inv.received);
      } catch {
        return denied;
      }
      // BR-043: no application await between private authorization and protected invocation.
      // Execution failures propagate: a failed mutation may already have taken effect.
      if (
        collectionKinds.has(authorized.op.kind) ||
        authorized.op.kind === "shared-with-me"
      )
        return { ok: true, value: authorized.value };
      return { ok: true, value: await dependencies.execute(authorized.op) };
    },
  });
  navigationFacades.set(facade, navigate);
  pagingFacades.set(facade, {
    async root(ref) {
      try {
        const ctx: ReceivedInvocation = {
          token: Object.freeze({}),
          mutation: false,
          paging: true,
          anchors: new Map(),
        };
        const candidate = await shared.rootCandidate(ref, ctx);
        if (candidate) authorize(candidate);
        await shared.final(ctx);
        shared.terminal(ctx);
        return candidate ? { item: project(candidate) } : {};
      } catch (error) {
        return refusalCode(error) === "EVIDENCE_UNAVAILABLE"
          ? { invalid: true }
          : {};
      }
    },
    async read(ref) {
      try {
        const authorized = await evaluate({ kind: "read", target: ref }, {});
        shared.terminal(authorized.inv.received);
        const source = authorized.inv.inspections.get(`live:${key(ref)}`);
        return source ? { item: project(source) } : { invalid: true };
      } catch (error) {
        return refusalCode(error) === "EVIDENCE_UNAVAILABLE"
          ? { invalid: true }
          : {};
      }
    },
    async page(value, cursor) {
      try {
        const op = operation(value);
        if (!collectionKinds.has(op.kind)) return undefined;
        const authorized = await evaluate(op, {
          ...(cursor === undefined ? {} : { cursor }),
        });
        shared.terminal(authorized.inv.received);
        const source = authorized.inv.inspections.get(`live:${key(op.scope!)}`);
        if (!source) return undefined;
        const entries = (authorized.inv.navigationEntries ?? [])
          .filter((entry) => {
            if (
              entry.driveId !== source.driveId ||
              !within(source.path, entry.path)
            )
              return false;
            if (op.kind === "list")
              return (
                entry.id !== source.id &&
                (entry.parents.at(-1)?.id === source.id ||
                  (source.id === 1 && entry.parents.length === 0)) &&
                entry.path === join(source.path, entry.name)
              );
            return (
              entry.id === source.id ||
              source.id === 1 ||
              entry.parents.some(
                (p) => p.id === source.id && p.path === source.path,
              )
            );
          })
          .map(project);
        const raw = record(authorized.value);
        return {
          entries: Object.freeze(entries),
          ...(raw.next === undefined ? {} : { next: raw.next as string }),
        };
      } catch {
        return undefined;
      }
    },
    async candidates() {
      if (!configuration.sharedWithMe) return [];
      try {
        const ctx: ReceivedInvocation = {
          token: Object.freeze({}),
          mutation: false,
          anchors: new Map(),
        };
        const refs = await shared.candidates(ctx);
        await shared.final(ctx);
        shared.terminal(ctx);
        return refs;
      } catch {
        return undefined;
      }
    },
  });
  return facade;
}

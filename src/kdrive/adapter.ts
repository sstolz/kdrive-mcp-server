import { createHash } from "node:crypto";
import type { RootSelector, PreflightResolver } from "../config-schema.js";
import type { ContentDependencies, ContentRange } from "../content.js";
import type {
  CollectionRequest,
  EvidenceRequest,
  PolicyDependencies,
  ReceivedDependencies,
  ReceivedListRequest,
} from "../policy/index.js";
import type { Mutator } from "../mutation-gate.js";
import type { Location, Ref } from "../policy/values.js";
import { createMutators } from "./mutators.js";
import {
  Incomplete,
  identity,
  incomplete,
  originalTrashItem,
  positive,
  receivedItem,
  trashMetadata,
  treeItem,
  wire,
  type Wire,
} from "./normalize.js";
import { PAGE_LIMIT, routes, type Route } from "./routes.js";
import {
  createTransport,
  type Connect,
  type Download,
  type Lookup,
  type RequestObserver,
  type UnavailableClass,
} from "./transport.js";

export interface KdriveAdapterOptions {
  readonly token: string;
  readonly lookup: Lookup;
  readonly connect: Connect;
  /** BR-216: read-only observer; receives no ID, query, header or body. */
  readonly onRequest?: RequestObserver | undefined;
  /** BR-217: an upstream 401/403 was received. */
  readonly onRefused?: ((status: 401 | 403) => void) | undefined;
  /** BR-217: a request failed unbranded for one of these causes. */
  readonly onUnavailable?: ((cause: UnavailableClass) => void) | undefined;
}
export interface KdriveAdapter {
  readonly dependencies: PolicyDependencies & {
    readonly received: ReceivedDependencies;
    readonly content: ContentDependencies;
  };
  readonly preflight: PreflightResolver;
  /** F-017 BR-274: the production mutators, one per operation kind. */
  readonly mutators: Readonly<Record<string, Mutator>>;
}

const MAX_CURSOR_BYTES = 4096;
const PREFLIGHT_REQUESTS = 1024;
const PREFLIGHT_MS = 120_000;
const PREFLIGHT_COMPONENTS = 64;
const ETAG_SYNTAX = /^[!-~]{1,256}$/u;
const unavailableStatus = Object.freeze({ status: "unavailable" as const });
const incompleteStatus = Object.freeze({ status: "incomplete" as const });
const missingStatus = Object.freeze({ status: "missing" as const });

function readUnavailable(): Error {
  return new Error("READ_UNAVAILABLE");
}
/** BR-205: `"kd1-` + base64url(SHA-256(provider ETag bytes)) + `"`. */
export function derivedETag(value: string | undefined): string | null {
  if (value === undefined || !ETAG_SYNTAX.test(value)) return null;
  const digest = createHash("sha256")
    .update(Buffer.from(value, "latin1"))
    .digest("base64url");
  return `"kd1-${digest}"`;
}

interface Page {
  readonly entries: readonly unknown[];
  readonly next: string | undefined;
}
/** BR-201: the page envelope; anything else is incomplete. */
function page(value: Wire): Page {
  const data = value.data;
  if (!Array.isArray(data) || data.length > PAGE_LIMIT) incomplete();
  if (value.has_more === false) return { entries: data, next: undefined };
  if (value.has_more !== true) incomplete();
  const cursor = value.cursor;
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    Buffer.byteLength(cursor) > MAX_CURSOR_BYTES
  )
    incomplete();
  return { entries: data, next: cursor };
}
const tail = (p: Page) =>
  p.next === undefined ? { terminal: true as const } : { next: p.next };

export function createKdriveAdapter(
  options: KdriveAdapterOptions,
): KdriveAdapter {
  const transport = createTransport(options);

  /** A JSON route; policy ports turn envelope failures into `incomplete`. */
  async function data(route: Route) {
    const outcome = await transport.json(route);
    if (outcome.kind === "success") return outcome.value;
    if (outcome.kind === "missing") return "missing" as const;
    return incomplete();
  }
  async function guarded<T>(
    work: () => Promise<T>,
  ): Promise<T | typeof incompleteStatus> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Incomplete) return incompleteStatus;
      throw error;
    }
  }
  /** BR-203: the role of one drive from a fresh init lookup. */
  async function roles(): Promise<ReadonlyMap<number, string>> {
    const value = await data(routes.init());
    if (value === "missing") incomplete();
    const drives = wire(value.data).drives;
    if (!Array.isArray(drives)) incomplete();
    const result = new Map<number, string>();
    for (const raw of drives) {
      const d = wire(raw);
      const id = positive(d.id);
      if (typeof d.role !== "string" || result.has(id)) incomplete();
      result.set(id, d.role);
    }
    return result;
  }
  async function roleOf(driveId: number) {
    return (await roles()).get(driveId) ?? "absent";
  }

  /**
   * F-017 BR-264/BR-265: trash metadata, then the live former parent; the
   * original chain is the former parent's live chain followed by it.
   */
  async function originalTrash(target: Ref): Promise<unknown> {
    const route = routes.trash(target.driveId, target.id);
    return guarded(async () => {
      const value = await data(route);
      if (value === "missing") return missingStatus;
      const trashed = trashMetadata(value.data, target);
      const parent = await data(routes.item(target.driveId, trashed.parentId));
      if (parent === "missing") incomplete();
      const former = treeItem(parent.data, target.driveId);
      if (former.id !== trashed.parentId) incomplete();
      return originalTrashItem(trashed, former);
    });
  }
  async function inspect(target: Ref, location: Location): Promise<unknown> {
    if (location === "original-trash") return originalTrash(target);
    const route = routes.item(target.driveId, target.id);
    return guarded(async () => {
      const value = await data(route);
      if (value === "missing") return missingStatus;
      const normalized = treeItem(value.data, target.driveId);
      if (normalized.id !== target.id) incomplete();
      return normalized;
    });
  }

  /** BR-201: one children page with the echoed request identity. */
  async function childPage(
    request: EvidenceRequest,
    normalize: (value: unknown) => { readonly id: number },
  ) {
    const route = routes.children(request.driveId, request.id, request.cursor);
    const value = await data(route);
    if (value === "missing") incomplete();
    const p = page(value);
    const entries = p.entries.map((entry) => {
      if (wire(entry).parent_id !== request.id) incomplete();
      return normalize(entry);
    });
    return Object.freeze({
      invocation: request.invocation,
      listing: request.listing,
      driveId: request.driveId,
      id: request.id,
      location: request.location,
      ...(request.treeRootId === undefined
        ? {}
        : { treeRootId: request.treeRootId }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      status: "complete",
      entries: Object.freeze(entries),
      ...tail(p),
    });
  }

  function collectionRoute(request: CollectionRequest): Route {
    const { driveId, id } = request.scope;
    switch (request.kind) {
      case "list":
        return routes.children(driveId, id, request.cursor);
      case "search":
        if (typeof request.query !== "string") incomplete();
        return routes.search(
          driveId,
          request.query,
          id === 1 ? undefined : id,
          request.cursor,
        );
      case "recents":
        return routes.recents(driveId, request.cursor);
      case "my-shared":
        return routes.myShared(driveId, request.cursor);
      default:
        return incomplete();
    }
  }
  /** BR-202: the scope filter keeps entries whose chain or identity holds the scope. */
  async function collectionPage(
    request: CollectionRequest,
    normalize: (value: unknown) => {
      readonly id: number;
      readonly parents: readonly { readonly id: number }[];
    },
  ) {
    const route = collectionRoute(request);
    const value = await data(route);
    if (value === "missing") incomplete();
    const p = page(value);
    const scope = request.scope.id;
    const entries = [];
    for (const entry of p.entries) {
      if (request.kind === "list" && wire(entry).parent_id !== scope)
        incomplete();
      let normalized;
      try {
        normalized = normalize(entry);
      } catch (error) {
        if (error instanceof Incomplete && request.kind !== "list") continue;
        throw error;
      }
      if (
        scope === 1 ||
        normalized.id === scope ||
        normalized.parents.some((parent) => parent.id === scope)
      )
        entries.push(normalized);
    }
    return Object.freeze({
      invocation: request.invocation,
      listing: request.listing,
      kind: request.kind,
      scope: request.scope,
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      status: "complete",
      entries: Object.freeze(entries),
      ...tail(p),
    });
  }

  const received: ReceivedDependencies = Object.freeze({
    async list(request: ReceivedListRequest): Promise<unknown> {
      const route = routes.sharedWithMe(request.cursor);
      return guarded(async () => {
        const known = await roles();
        const value = await data(route);
        if (value === "missing") incomplete();
        const p = page(value);
        const entries = p.entries.map((entry) => {
          const driveId = positive(wire(entry).drive_id);
          const normalized = receivedItem(
            entry,
            driveId,
            known.get(driveId) ?? "absent",
          );
          if (normalized.anchorId !== normalized.id) incomplete();
          return normalized;
        });
        return Object.freeze({
          invocation: request.invocation,
          listing: request.listing,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          status: "complete",
          discover: true,
          entries: Object.freeze(entries),
          ...tail(p),
        });
      });
    },
    async inspect(target: Ref, location: Location): Promise<unknown> {
      if (location !== "live") return unavailableStatus;
      const route = routes.item(target.driveId, target.id);
      return guarded(async () => {
        const role = await roleOf(target.driveId);
        const value = await data(route);
        if (value === "missing") return missingStatus;
        const normalized = receivedItem(value.data, target.driveId, role);
        if (normalized.id !== target.id) incomplete();
        return normalized;
      });
    },
    async children(request: EvidenceRequest): Promise<unknown> {
      if (request.location !== "live") return unavailableStatus;
      routes.children(request.driveId, request.id, request.cursor);
      return guarded(async () => {
        const role = await roleOf(request.driveId);
        return childPage(request, (entry) =>
          receivedItem(entry, request.driveId, role),
        );
      });
    },
    async collection(request: CollectionRequest): Promise<unknown> {
      collectionRoute(request);
      return guarded(async () => {
        const role = await roleOf(request.scope.driveId);
        return collectionPage(request, (entry) =>
          receivedItem(entry, request.scope.driveId, role),
        );
      });
    },
  });

  /** BR-205: fresh metadata, then one `bytes=0-0` download. */
  async function describe(target: Ref, signal: AbortSignal): Promise<unknown> {
    const route = routes.item(target.driveId, target.id);
    const download = routes.download(target.driveId, target.id);
    const outcome = await transport.json(route);
    if (outcome.kind !== "success") throw readUnavailable();
    let type: "dir" | "file", size: unknown;
    try {
      const checked = identity(wire(outcome.value).data, target.driveId);
      if (checked.id !== target.id) incomplete();
      type = checked.type;
      size = checked.r.size;
    } catch {
      throw readUnavailable();
    }
    const sizeBytes =
      typeof size === "number" && Number.isSafeInteger(size) && size >= 0
        ? size
        : 0;
    const descriptor = (etag: string | null) =>
      Object.freeze({
        target: Object.freeze({ driveId: target.driveId, id: target.id }),
        size_bytes: sizeBytes,
        etag,
        version_bound: etag !== null,
      });
    if (type !== "file" || sizeBytes < 1 || sizeBytes !== size)
      return descriptor(null);
    const response = await transport.download(download, "bytes=0-0", signal);
    response.body.close();
    if (
      response.status !== 206 ||
      response.contentRange !== `bytes 0-0/${String(sizeBytes)}` ||
      response.contentLength !== "1"
    )
      return descriptor(null);
    return descriptor(derivedETag(response.etag));
  }

  /** BR-206: exact range checks before any body byte is exposed. */
  async function open(
    request: ContentRange,
    signal: AbortSignal,
  ): Promise<unknown> {
    const { target, start, end, size_bytes: size } = request;
    const route = routes.download(target.driveId, target.id);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(size) ||
      start < 0 ||
      end < start
    )
      throw readUnavailable();
    const response: Download = await transport.download(
      route,
      `bytes=${String(start)}-${String(end)}`,
      signal,
    );
    if (
      response.status !== 206 ||
      response.contentRange !==
        `bytes ${String(start)}-${String(end)}/${String(size)}` ||
      response.contentLength !== String(end - start + 1)
    ) {
      response.body.close();
      throw readUnavailable();
    }
    const body = response.body;
    return Object.freeze({
      target: Object.freeze({ driveId: target.driveId, id: target.id }),
      start,
      end,
      size_bytes: size,
      etag: derivedETag(response.etag),
      status: 206,
      body: Object.freeze({
        read: (max: number, s: AbortSignal) => body.read(max, s),
        close: () => {
          body.close();
        },
      }),
    });
  }

  const dependencies = Object.freeze({
    received,
    content: Object.freeze({ describe, open }),
    inspect,
    children(request: EvidenceRequest): Promise<unknown> {
      if (request.location !== "live")
        return Promise.resolve(unavailableStatus);
      routes.children(request.driveId, request.id, request.cursor);
      return guarded(() =>
        childPage(request, (entry) => treeItem(entry, request.driveId)),
      );
    },
    collection(request: CollectionRequest): Promise<unknown> {
      try {
        collectionRoute(request);
      } catch (error) {
        if (!(error instanceof Incomplete))
          return Promise.reject(
            error instanceof Error ? error : readUnavailable(),
          );
      }
      return guarded(() =>
        collectionPage(request, (entry) =>
          treeItem(entry, request.scope.driveId),
        ),
      );
    },
    /** BR-200 v2: no execution and no request; production binds the gate. */
    execute: () => Promise.resolve(unavailableStatus),
  });

  return Object.freeze({
    dependencies,
    preflight: createPreflight(),
    mutators: createMutators((route, body, signal) =>
      transport.mutate(route, body, signal),
    ),
  });

  /** BR-207: init and metadata, then a bounded path walk; never retried. */
  function createPreflight(): PreflightResolver {
    let requests = 0;
    let started: number | undefined;
    function budget() {
      started ??= performance.now();
      if (++requests > PREFLIGHT_REQUESTS) throw readUnavailable();
      if (performance.now() - started >= PREFLIGHT_MS) throw readUnavailable();
    }
    async function success(route: Route): Promise<Wire> {
      budget();
      const remaining = PREFLIGHT_MS - (performance.now() - (started ?? 0));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          transport.json(route),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(readUnavailable());
            }, remaining);
          }),
        ]);
        if (outcome.kind !== "success") throw readUnavailable();
        return outcome.value;
      } finally {
        clearTimeout(timer);
      }
    }
    async function own(driveId: number, id: number) {
      const value = await success(routes.item(driveId, id));
      try {
        const checked = identity(wire(value).data, driveId);
        if (checked.id !== id) incomplete();
        return checked.type;
      } catch {
        throw readUnavailable();
      }
    }
    async function child(driveId: number, parent: number, component: string) {
      const matches: { id: number; type: "dir" | "file" }[] = [];
      let cursor: string | undefined;
      for (;;) {
        const value = await success(routes.children(driveId, parent, cursor));
        try {
          const p = page(value);
          for (const entry of p.entries) {
            const checked = identity(entry, driveId);
            if (wire(entry).parent_id !== parent) incomplete();
            if (wire(entry).name === component)
              matches.push({ id: checked.id, type: checked.type });
          }
          if (p.next === undefined) break;
          cursor = p.next;
        } catch {
          throw readUnavailable();
        }
      }
      if (matches.length !== 1) throw readUnavailable();
      return matches[0] as { id: number; type: "dir" | "file" };
    }
    return Object.freeze({
      async inspectDrive(driveId: number) {
        routes.item(driveId, 1);
        const value = await success(routes.init());
        let known: Map<number, string>;
        try {
          const drives = wire(value.data).drives;
          if (!Array.isArray(drives)) incomplete();
          known = new Map();
          for (const raw of drives) {
            const d = wire(raw);
            if (typeof d.role !== "string") incomplete();
            known.set(positive(d.id), d.role);
          }
        } catch {
          throw readUnavailable();
        }
        return { id: driveId, role: known.get(driveId) ?? "absent" };
      },
      async resolveDirectory(driveId: number, selector: RootSelector) {
        if (selector.kind === "id")
          return {
            driveId,
            id: selector.value,
            type: await own(driveId, selector.value),
          };
        const components = selector.value
          .split("/")
          .filter((part) => part !== "");
        if (components.length > PREFLIGHT_COMPONENTS) throw readUnavailable();
        let current: { id: number; type: "dir" | "file" } = {
          id: 1,
          type: "dir",
        };
        if (!components.length)
          current = { id: 1, type: await own(driveId, 1) };
        for (const component of components) {
          if (current.type !== "dir") throw readUnavailable();
          current = await child(driveId, current.id, component);
        }
        return { driveId, id: current.id, type: current.type };
      },
    });
  }
}

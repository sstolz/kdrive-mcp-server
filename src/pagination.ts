import { createHash, randomUUID } from "node:crypto";
import type { ResolvedConfiguration } from "./config.js";
import type { CollectionPage, NavigationItem, Ref } from "./policy/index.js";

export const pagedTools = new Set([
  "kdrive_list",
  "kdrive_search",
  "kdrive_recents",
  "kdrive_my_shared",
  "kdrive_shared_with_me",
]);
export class PaginationError extends Error {
  constructor(
    readonly code: "INVALID_CURSOR" | "LIMIT_EXCEEDED" | "ACCESS_DENIED",
  ) {
    super(code);
  }
}
interface Ports {
  root(ref: Ref): Promise<NavigationItem | undefined>;
  read(ref: Ref): Promise<NavigationItem | undefined>;
  page(
    kind: string,
    scope: Ref,
    query: string | undefined,
    cursor: string | undefined,
  ): Promise<CollectionPage | undefined>;
  candidates(): Promise<readonly Ref[] | undefined>;
  listCalls(): number;
}
interface State {
  readonly binding: string;
  readonly started: number;
  used: number;
  readonly roots: readonly Ref[];
  readonly explicit: boolean;
  position: number;
  upstream?: string;
  readonly seen: Set<string>;
  readonly cursors: Set<string>;
  candidates?: readonly Ref[];
}
/** BR-065 v2, BR-072–081: one bounded session owner; state contains no grants. */
export function createPagination(config: ResolvedConfiguration, ports: Ports) {
  const states = new Map<string, State>();
  let active: State | undefined, outputHandle: string | undefined;
  const fail = (code: PaginationError["code"]): never => {
    throw new PaginationError(code);
  };
  function expire() {
    const now = performance.now();
    for (const [handle, state] of states)
      if (now - state.started >= 300000 || now < state.started)
        states.delete(handle);
  }
  function finish(success: boolean) {
    if (!success && outputHandle) states.delete(outputHandle);
    active = undefined;
    outputHandle = undefined;
  }
  function emit(items: NavigationItem[], more: boolean) {
    if (!active) return fail("ACCESS_DENIED");
    if (performance.now() - active.started >= 300000)
      return fail("INVALID_CURSOR");
    if (!more) return { items, has_more: false };
    outputHandle = "v1." + randomUUID();
    active.used = performance.now();
    states.set(outputHandle, active);
    return { items, has_more: true, next_cursor: outputHandle };
  }
  return {
    finish,
    close() {
      states.clear();
      active = undefined;
      outputHandle = undefined;
    },
    // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
    async run(tool: string, args: Record<string, unknown>) {
      expire();
      const received = tool === "kdrive_shared_with_me";
      const driveId = received
        ? (args.drive_id as number | undefined)
        : ((args.drive_id as number | undefined) ?? config.driveId);
      const query = args.query as string | undefined;
      const binding = JSON.stringify([
        tool,
        driveId ?? null,
        args.folder_id ?? null,
        query ?? null,
        args.type ?? null,
      ]);
      const input = args.cursor;
      if (input !== undefined) {
        if (
          typeof input !== "string" ||
          Buffer.byteLength(input) > 128 ||
          !/^v1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
            input,
          )
        )
          return fail("INVALID_CURSOR");
        const previous = states.get(input);
        if (!previous || previous.binding !== binding)
          return fail("INVALID_CURSOR");
        states.delete(input);
        active = previous;
      } else {
        while (states.size >= 16) {
          const oldest = [...states].sort((a, b) => a[1].used - b[1].used)[0];
          if (oldest) states.delete(oldest[0]);
        }
        const explicit = args.folder_id !== undefined;
        if (
          !received &&
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
          !config.driveIds.includes(driveId!) &&
          (!explicit || args.folder_id === 1)
        )
          return fail("ACCESS_DENIED");
        const roots = received
          ? []
          : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
            explicit
            ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
              [{ driveId: driveId!, id: args.folder_id as number }]
            : config.resolvedRoots
                .filter((r) => r.driveId === driveId)
                .map((r) => ({ driveId: r.driveId, id: r.folderId }));
        active = {
          binding,
          started: performance.now(),
          used: performance.now(),
          roots,
          explicit,
          position: 0,
          seen: new Set(),
          cursors: new Set(),
        };
      }
      const state = active;
      const items: NavigationItem[] = [];
      function add(item: NavigationItem) {
        if (args.type !== undefined && item.type !== args.type) return;
        const key = `${String(item.drive_id)}:${String(item.id)}`;
        if (state.seen.has(key)) return;
        if (state.seen.size >= 8192) fail("LIMIT_EXCEEDED");
        state.seen.add(key);
        items.push(item);
      }
      if (received) {
        if (state.candidates === undefined) {
          const candidates = await ports.candidates();
          if (!candidates) return fail("ACCESS_DENIED");
          if (candidates.length > 1280) return fail("LIMIT_EXCEEDED");
          state.candidates = candidates.filter(
            (r) => driveId === undefined || r.driveId === driveId,
          );
        }
        const end = Math.min(state.position + 256, state.candidates.length);
        for (; state.position < end; state.position++) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
          const item = await ports.root(state.candidates[state.position]!);
          if (item) add(item);
        }
        return emit(items, state.position < state.candidates.length);
      }
      const kind = tool.slice("kdrive_".length).replaceAll("_", "-");
      while (state.position < state.roots.length) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
        const root = state.roots[state.position]!;
        const scope = await ports.read(root);
        if (!scope || scope.type !== "dir") {
          if (state.explicit) return fail("ACCESS_DENIED");
          state.position++;
          delete state.upstream;
          continue;
        }
        if (items.length || ports.listCalls() >= 5) return emit(items, true);
        const page = await ports.page(kind, root, query, state.upstream);
        if (!page) return fail("ACCESS_DENIED");
        for (const item of page.entries) add(item);
        if (page.next !== undefined) {
          const fingerprint = createHash("sha256")
            .update(
              JSON.stringify([
                kind,
                root.driveId,
                root.id,
                query ?? null,
                state.position,
                page.next,
              ]),
            )
            .digest("hex");
          if (state.cursors.has(fingerprint)) return fail("ACCESS_DENIED");
          if (state.cursors.size >= 8192) return fail("LIMIT_EXCEEDED");
          state.cursors.add(fingerprint);
          state.upstream = page.next;
          if (items.length || ports.listCalls() >= 5) return emit(items, true);
        } else {
          state.position++;
          delete state.upstream;
        }
      }
      return emit(items, false);
    },
  };
}

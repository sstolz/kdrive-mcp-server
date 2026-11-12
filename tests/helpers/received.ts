import { vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../../src/config.js";
import {
  createPolicy,
  type EvidenceRequest,
  type CollectionRequest,
} from "../../src/policy/index.js";

export const ref = (id: number, driveId = 8) => ({ driveId, id });
export const denied = { ok: false, code: "ACCESS_DENIED" };
export const predicates = [
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
];
export interface SharedNode {
  status: string;
  driveId: number;
  id: number;
  anchorId: number;
  role: string;
  type: "file" | "dir";
  name: string;
  path: string;
  parents: SharedNode[];
  location: "live" | "original-trash";
  lifecycle: "live" | "trashed";
  capabilities: Record<string, unknown>;
  treeRootId?: number;
}
export function node(
  id: number,
  name: string,
  type: "file" | "dir",
  parents: SharedNode[] = [],
  location: "live" | "original-trash" = "live",
  treeRootId?: number,
): SharedNode {
  return {
    status: "complete",
    ...ref(id),
    anchorId: 20,
    role: "external",
    type,
    name,
    path: parents.length
      ? parents[parents.length - 1]!.path + "/" + name
      : "/Shared/" + name,
    parents,
    location,
    lifecycle: location === "live" ? "live" : "trashed",
    capabilities: Object.fromEntries(predicates.map((p) => [p, true])),
    ...(treeRootId === undefined ? {} : { treeRootId }),
  };
}
export async function fixture(env: Record<string, string> = {}) {
  const anchor = node(20, "Project", "dir"),
    a = node(22, "a", "dir", [anchor]),
    b = node(23, "b", "dir", [anchor]);
  const file = node(24, "report", "file", [anchor, a]),
    other = node(25, "other", "file", [anchor, a]);
  const old = node(26, "old", "dir", [anchor, a], "original-trash", 26);
  const oldChild = node(
    27,
    "saved",
    "file",
    [anchor, a, old],
    "original-trash",
    26,
  );
  // Historical parents remain live at deletion; only the actual item is trashed.
  oldChild.parents = oldChild.parents.map((p) => ({
    ...p,
    location: "original-trash",
    lifecycle: "live",
  }));
  old.parents = old.parents.map((p) => ({
    ...p,
    location: "original-trash",
    lifecycle: "live",
  }));
  const oldFile = node(
    28,
    "old-file",
    "file",
    old.parents,
    "original-trash",
    28,
  );
  const items = new Map(
    [anchor, a, b, file, other, old, oldChild, oldFile].map((i) => [
      i.location + ":" + i.driveId + ":" + i.id,
      i,
    ]),
  );
  const config = await preflightConfiguration(
    await loadConfiguration({
      argv: [],
      cwd: "/work",
      env: {
        KDRIVE_ID: "7",
        KDRIVE_TOKEN: "SYNTHETIC",
        KDRIVE_MCP_SHARED_WITH_ME: "1",
        KDRIVE_MCP_SHARED_WRITE: "1",
        KDRIVE_MCP_MODE: "write",
        ...env,
      },
    }),
    {
      inspectDrive: async (id) => {
        await Promise.resolve();
        return { id, role: "admin" };
      },
      resolveDirectory: async (driveId) => {
        await Promise.resolve();
        return { driveId, id: 1, type: "dir" };
      },
    },
  );
  const clock = { value: 0 };
  const list = vi.fn(async (request: object): Promise<unknown> => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [structuredClone(anchor)],
      terminal: true,
      discover: true,
    };
  });
  const inspect = vi.fn(
    async (target: { driveId: number; id: number }, location: string) => {
      await Promise.resolve();
      return structuredClone(
        items.get(location + ":" + target.driveId + ":" + target.id) ?? {
          status: "missing",
        },
      );
    },
  );
  const children = vi.fn(async (request: EvidenceRequest): Promise<unknown> => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      terminal: true,
      entries: [...items.values()]
        .filter(
          (i) =>
            i.location === request.location &&
            i.parents[i.parents.length - 1]?.id === request.id,
        )
        .map((i) => structuredClone(i)),
    };
  });
  const collection = vi.fn(
    async (request: CollectionRequest): Promise<unknown> => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        terminal: true,
        entries: [structuredClone(file)],
      };
    },
  );
  const execute = vi.fn(async (op: unknown) => {
    await Promise.resolve();
    return { executed: op };
  });
  const configured = {
    inspect: vi.fn(),
    children: vi.fn(),
    collection: vi.fn(),
  };
  const received = {
    list,
    inspect,
    children,
    collection,
    now: () => clock.value,
  };
  const policy = createPolicy(config, { ...configured, execute, received });
  return {
    policy,
    config,
    items,
    anchor,
    a,
    b,
    file,
    other,
    old,
    oldFile,
    oldChild,
    received,
    configured,
    execute,
    clock,
  };
}
export const mutationRows = [
  {
    label: "create-file",
    op: { kind: "create", destination: ref(23), name: "new", type: "file" },
    needs: [[23, "createFile"]],
  },
  {
    label: "create-dir",
    op: { kind: "create", destination: ref(23), name: "new", type: "dir" },
    needs: [[23, "createDirectory"]],
  },
  {
    label: "upload-new",
    op: { kind: "upload-new", destination: ref(23), name: "new" },
    needs: [[23, "createFile"]],
  },
  {
    label: "replace",
    op: {
      kind: "replace",
      target: ref(24),
      destination: ref(22),
      name: "report",
    },
    needs: [[24, "replace"]],
  },
  ...(["file", "dir"] as const).flatMap((type) => {
    const id = type === "file" ? 24 : 22,
      extra = (p: string) => (type === "dir" ? [[id, p]] : []);
    return [
      {
        label: "rename-" + type,
        op: { kind: "rename", target: ref(id), name: "changed" },
        needs: [[id, "rename"], ...extra("renameTree")],
      },
      {
        label: "move-" + type,
        op: { kind: "move", target: ref(id), destination: ref(23) },
        needs: [[id, "moveOut"], [23, "acceptMove"], ...extra("moveTree")],
      },
      {
        label: "trash-" + type,
        op: { kind: "trash", target: ref(id) },
        needs: [[id, "trash"], ...extra("trashTree")],
      },
      {
        label: "restore-" + type,
        // F-017 BR-039 v2: the destination is the former parent `a` (22).
        op: { kind: "restore", target: ref(type === "file" ? 28 : 26) },
        needs: [
          [type === "file" ? 28 : 26, "restore"],
          [22, "acceptRestore"],
          [22, type === "file" ? "createFile" : "createDirectory"],
          ...(type === "dir" ? [[26, "restoreTree"]] : []),
        ],
      },
    ];
  }),
];

import { vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../../src/config.js";
import type { CollectionRequest, Ref } from "../../src/policy/index.js";

export interface TestNode {
  status: string;
  driveId: number;
  id: number;
  type: "file" | "dir";
  name: string;
  path: string;
  parents: TestNode[];
  rootId: number;
  location: string;
  lifecycle: string;
}
export const plainItem = (
  id: number,
  path: string,
  type: "file" | "dir" = "file",
  parents: TestNode[] = [],
  driveId = 7,
): TestNode => ({
  status: "complete",
  driveId,
  id,
  type,
  name: path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1),
  path,
  parents,
  rootId: 1,
  location: "live",
  lifecycle: "live",
});
export const plainRoot = (driveId = 7): TestNode => ({
  status: "complete",
  driveId,
  id: 1,
  type: "dir",
  name: "",
  path: "/",
  parents: [],
  rootId: 1,
  location: "live",
  lifecycle: "live",
});
export const projection = (node: {
  driveId: number;
  id: number;
  name: string;
  type: string;
  path: string;
}) => ({
  drive_id: node.driveId,
  id: node.id,
  name: node.name,
  type: node.type,
  path: node.path,
});
export async function navigationFixture(env: Record<string, string> = {}) {
  const local = await loadConfiguration({
    argv: [],
    env: {
      KDRIVE_ID: "7",
      KDRIVE_IDS: "7,9",
      KDRIVE_TOKEN: "SYNTHETIC",
      ...env,
    },
  });
  const config = await preflightConfiguration(local, {
    inspectDrive: async (id) => {
      await Promise.resolve();
      return { id, role: "admin" };
    },
    resolveDirectory: async (driveId, selector) => {
      await Promise.resolve();
      return {
        driveId,
        id: selector.kind === "id" ? selector.value : 1,
        type: "dir",
      };
    },
  });
  const root = plainRoot(),
    root9 = plainRoot(9),
    dir = plainItem(2, "/docs", "dir", [root]),
    file = plainItem(3, "/docs/a", "file", [root, dir]),
    sibling = plainItem(4, "/b", "file", [root]);
  const nodes = new Map(
    [
      root,
      root9,
      dir,
      file,
      sibling,
      plainItem(3, "/other", "file", [root9], 9),
    ].map((n) => [`${n.driveId}:${n.id}`, n]),
  );
  const inspect = vi.fn(async (ref: Ref): Promise<unknown> => {
    await Promise.resolve();
    return nodes.get(`${ref.driveId}:${ref.id}`);
  });
  const collection = vi.fn(
    async (request: CollectionRequest): Promise<unknown> => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        entries: [...nodes.values()].filter(
          (n) =>
            n.driveId === request.scope.driveId &&
            n.parents.at(-1)?.id === request.scope.id,
        ),
        terminal: true,
      };
    },
  );
  const execute = vi.fn(async () => {
    await Promise.resolve();
    return { secret: "CANARY_RAW_EXECUTE" };
  });
  const children = vi.fn(async () => {
    await Promise.resolve();
    return { status: "unavailable" };
  });
  return {
    local,
    config,
    root,
    dir,
    file,
    sibling,
    nodes,
    inspect,
    collection,
    execute,
    children,
    dependencies: { inspect, collection, execute, children },
  };
}
export function payload(result: { content?: unknown }) {
  const content = result.content as Array<{ text: string }>;
  return JSON.parse(content[0]!.text) as unknown;
}

// F-041: small normalized tree shared by policy, gate and invocation tests.
import { vi } from "vitest";
import { createPolicy, type EvidenceRequest } from "../../src/policy/index.js";
import { navigationFixture, plainItem, plainRoot } from "./navigation.js";

export const ancestorRef = (id: number, driveId = 101) => ({ driveId, id });
export const structuralKinds = ["trash", "rename", "move"] as const;
export type StructuralKind = (typeof structuralKinds)[number];
export function structuralOperation(
  kind: StructuralKind,
  id: number,
  destination = 30,
) {
  return {
    kind,
    target: ancestorRef(id),
    ...(kind === "rename" ? { name: "New" } : {}),
    ...(kind === "move" ? { destination: ancestorRef(destination) } : {}),
  };
}
export async function ancestorFixture(env: Record<string, string> = {}) {
  const f = await navigationFixture({
    KDRIVE_ID: "101",
    KDRIVE_IDS: "101",
    KDRIVE_MCP_ROOTS: "101:1,101:40",
    KDRIVE_MCP_MODE: "write",
    ...env,
  });
  const sentinel = plainRoot(101);
  const a = plainItem(10, "/A", "dir", [sentinel], 101);
  const b = plainItem(11, "/A/B", "dir", [sentinel, a], 101);
  const root = plainItem(40, "/A/B/R", "dir", [sentinel, a, b], 101);
  const sibling = plainItem(20, "/S", "dir", [sentinel], 101);
  const destination = plainItem(30, "/D", "dir", [sentinel], 101);
  const file = plainItem(21, "/S/f", "file", [sentinel, sibling], 101);
  f.nodes.clear();
  for (const n of [sentinel, a, b, root, sibling, destination, file])
    f.nodes.set(`101:${n.id}`, n);
  const children = vi.fn((request: EvidenceRequest): Promise<unknown> =>
    Promise.resolve({
      ...request,
      status: "complete",
      terminal: true,
      entries: [],
    }),
  );
  const dependencies = { ...f.dependencies, children };
  return {
    ...f,
    children,
    dependencies,
    sentinel,
    a,
    b,
    root,
    sibling,
    destination,
    file,
    policy: createPolicy(f.config, dependencies),
  };
}

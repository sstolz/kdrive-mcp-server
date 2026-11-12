import { describe, expect, it, vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../src/config.js";
import { createPolicy } from "../src/policy/index.js";

const ref = (id: number, driveId = 8) => ({ driveId, id });
const capabilities = { read: true };
const anchor = {
  status: "complete",
  ...ref(20),
  role: "external",
  anchorId: 20,
  type: "dir",
  name: "Project",
  path: "/Shared/Project",
  parents: [],
  location: "live",
  lifecycle: "live",
  capabilities,
};
const child = {
  ...anchor,
  ...ref(21),
  type: "file",
  name: "report",
  path: "/Shared/Project/report",
  parents: [{ ...anchor }],
};
async function fixture(enabled = true) {
  const local = await loadConfiguration({
    argv: [],
    cwd: "/work",
    env: {
      KDRIVE_ID: "7",
      KDRIVE_TOKEN: "SYNTHETIC",
      KDRIVE_MCP_SHARED_WITH_ME: enabled ? "1" : "0",
    },
  });
  const config = await preflightConfiguration(local, {
    inspectDrive: async (id) => {
      await Promise.resolve();
      return { id, role: "admin" };
    },
    resolveDirectory: async (driveId) => {
      await Promise.resolve();
      return { driveId, id: 1, type: "dir" };
    },
  });
  const execute = vi.fn(async () => {
    await Promise.resolve();
    return "protected";
  });
  const list = vi.fn(async (request: object) => {
    await Promise.resolve();
    return {
      ...request,
      status: "complete",
      entries: [anchor],
      terminal: true,
      discover: true,
    };
  });
  const inspect = vi.fn(async (target: { id: number }) => {
    await Promise.resolve();
    return target.id === 20
      ? anchor
      : target.id === 21
        ? child
        : { status: "missing" };
  });
  const received = { list, inspect, children: vi.fn(), collection: vi.fn() };
  const policy = createPolicy(config, {
    inspect: vi.fn(),
    children: vi.fn(),
    collection: vi.fn(),
    execute,
    received,
  });
  return { policy, execute, received };
}
describe("received representative red sample", () => {
  it("BR-042 v2 BR-049 permits a proved shared root and child via the separate facade", async () => {
    const f = await fixture();
    for (const id of [20, 21])
      expect(
        await f.policy.dispatch({ kind: "read", target: ref(id) }),
      ).toEqual({ ok: true, value: "protected" });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it("BR-047 opt-out performs no received evidence or protected execution", async () => {
    const f = await fixture(false);
    expect(await f.policy.dispatch({ kind: "read", target: ref(21) })).toEqual({
      ok: false,
      code: "ACCESS_DENIED",
    });
    expect(f.received.list).not.toHaveBeenCalled();
    expect(f.received.inspect).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
});

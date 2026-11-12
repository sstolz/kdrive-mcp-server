import { expect, it, vi } from "vitest";
import {
  loadConfiguration,
  preflightConfiguration,
  type LocalConfiguration,
  type ResolvedConfiguration,
} from "../src/config.js";
const local = () =>
  loadConfiguration({
    argv: [],
    env: {
      KDRIVE_IDS: "7,8",
      KDRIVE_TOKEN: "SYNTHETIC",
      KDRIVE_MCP_ROOTS: "7:42,8:/Folder,7:/Alias",
    },
  });
// BR-028: locally parsed values never satisfy the resolved readiness type.
function typeBoundary(config: LocalConfiguration) {
  // @ts-expect-error LocalConfiguration is not ResolvedConfiguration.
  const resolved: ResolvedConfiguration = config;
  return resolved;
}
export { typeBoundary };
it("BR-021 BR-028 inspects only configured drives before roots and collapses resolved aliases", async () => {
  const trace: string[] = [];
  const c = await local();
  const result = await preflightConfiguration(c, {
    inspectDrive: async (id) => {
      await Promise.resolve();
      trace.push(`drive:${id}`);
      return { id, role: "admin" };
    },
    resolveDirectory: async (id, selector) => {
      await Promise.resolve();
      trace.push(`root:${id}:${selector.value}`);
      return { driveId: id, id: 42, type: "dir" };
    },
  });
  expect(trace).toEqual([
    "drive:7",
    "drive:8",
    "root:7:42",
    "root:8:/Folder",
    "root:7:/Alias",
  ]);
  expect(result.resolvedRoots).toEqual([
    { driveId: 7, folderId: 42 },
    { driveId: 8, folderId: 42 },
  ]);
  expect(result.driveIds).toEqual([7, 8]);
  expect("roots" in result).toBe(false);
});
it.each([
  undefined,
  null,
  {},
  { id: 7, role: "external" },
  { id: 7, role: "owner" },
  { id: 8, role: "admin" },
  { id: "7.0", role: "admin" },
])("BR-021 rejects untrusted drive result %j before roots", async (result) => {
  const resolveDirectory = vi.fn();
  await expect(
    preflightConfiguration(await local(), {
      inspectDrive: async () => await Promise.resolve(result),
      resolveDirectory,
    }),
  ).rejects.toMatchObject({ code: "DRIVE_NOT_ALLOWED", setting: "driveIds" });
  expect(resolveDirectory).not.toHaveBeenCalled();
});
it.each([
  undefined,
  null,
  {},
  { ambiguous: true },
  { driveId: 8, id: 42, type: "dir" },
  { driveId: 7, id: 42, type: "file" },
  { driveId: 7, id: 1, type: "dir" },
  { driveId: 7, id: 43, type: "dir" },
  { driveId: 7, id: 0, type: "dir" },
  { driveId: 7, id: 42.5, type: "dir" },
])(
  "BR-021 BR-027 rejects invalid directory %j with no later selector",
  async (result) => {
    const resolveDirectory = vi.fn(async () => await Promise.resolve(result));
    await expect(
      preflightConfiguration(await local(), {
        inspectDrive: async (id) =>
          await Promise.resolve({ id, role: "admin" }),
        resolveDirectory,
      }),
    ).rejects.toMatchObject({ code: "ROOT_NOT_RESOLVED", setting: "roots" });
    expect(resolveDirectory).toHaveBeenCalledTimes(1);
  },
);
it("BR-021 accepts canonical numeric string IDs without widening selectors", async () => {
  const result = await preflightConfiguration(await local(), {
    inspectDrive: async (id) =>
      await Promise.resolve({ id: `0${id}`, role: "admin" }),
    resolveDirectory: async (id) =>
      await Promise.resolve({
        driveId: String(id),
        id: "042",
        type: "dir",
      }),
  });
  expect(result.resolvedRoots[0]).toEqual({ driveId: 7, folderId: 42 });
});
it("BR-027 BR-028 rejects absent resolver and sanitizes unexpected callback errors", async () => {
  const c = await local();
  await expect(preflightConfiguration(c)).rejects.toMatchObject({
    code: "PREFLIGHT_UNAVAILABLE",
    setting: "preflight",
  });
  for (const phase of ["drive", "root"]) {
    const operation = preflightConfiguration(c, {
      inspectDrive: async (id) => {
        await Promise.resolve();
        if (phase === "drive") throw Error("CANARY");
        return { id, role: "admin" };
      },
      resolveDirectory: async () => {
        await Promise.resolve();
        throw Error("CANARY");
      },
    });
    await expect(operation).rejects.toMatchObject({
      code: "PREFLIGHT_FAILED",
      setting: "preflight",
    });
  }
});
it("BR-027 sanitizes throwing getters and forged dependency diagnostics", async () => {
  const { ConfigurationError } = await import("../src/config.js");
  const badDrive = {
    get id() {
      throw new ConfigurationError("INVALID_VALUE", "token");
    },
    role: "admin",
  };
  await expect(
    preflightConfiguration(await local(), {
      inspectDrive: () => Promise.resolve(badDrive),
      resolveDirectory: () => Promise.resolve(null),
    }),
  ).rejects.toMatchObject({ code: "PREFLIGHT_FAILED", setting: "preflight" });
});

import { expect, it, vi } from "vitest";
import {
  loadConfiguration,
  isResolvedConfiguration,
  preflightConfiguration,
  preflightConfigurationWithDiagnosticPaths,
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

// F-048 BR-021 v3 / BR-207 v3: optional resolver path, bound by identity.
it("TestBR021v3_retains_identity_bound_diagnostic_paths", async () => {
  const { classifyDenyPatterns } = await import("../src/deny-root-warning.js");
  for (const selector of ["7:42", "7:/Private/Documents"]) {
    const c = await loadConfiguration({ argv: [], env: { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC", KDRIVE_MCP_ROOTS: selector, KDRIVE_MCP_DENY: "/Documents/Confidential/**" } });
    const inspectDrive = vi.fn(async (id: number) => await Promise.resolve({ id, role: "admin" }));
    const resolveDirectory = vi.fn(async () => await Promise.resolve({ driveId: 7, id: 42, type: "dir", path: "/Private/Documents" }));
    const result = await preflightConfigurationWithDiagnosticPaths(c, { inspectDrive, resolveDirectory });
    const configuration: ResolvedConfiguration = result.configuration;
    expect(isResolvedConfiguration(configuration)).toBe(true);
    expect(configuration.resolvedRoots).toEqual([{ driveId: 7, folderId: 42 }]);
    expect(configuration).not.toHaveProperty("diagnosticRootPaths");
    expect(result.diagnosticRootPaths).toEqual([{ driveId: 7, folderId: 42, path: "/Private/Documents" }]);
    expect(classifyDenyPatterns(configuration.deny, result.diagnosticRootPaths, configuration.sharedWithMe)).toEqual([0]);
    expect(inspectDrive).toHaveBeenCalledExactlyOnceWith(7);
    expect(resolveDirectory).toHaveBeenCalledExactlyOnceWith(7, c.roots[0]);
  }
});

it("TestBR021v3_unknown_or_conflicting_paths_are_conservative", async () => {
  const { classifyDenyPatterns } = await import("../src/deny-root-warning.js");
  for (const [roots, idPath, known] of [
    ["7:42,8:42", null, null],
    ["7:42,8:42,7:/Private/Documents", null, "/Private/Documents"],
    ["7:/Private/Documents,8:42,7:42", null, "/Private/Documents"],
    ["7:42,8:42,7:/Private/Documents", "/Private/Documents", "/Private/Documents"],
    ["7:42,8:42,7:/Other", "/Private/Documents", null],
  ] as const) {
    const c = await loadConfiguration({ argv: [], env: { KDRIVE_IDS: "7,8", KDRIVE_TOKEN: "SYNTHETIC", KDRIVE_MCP_ROOTS: roots, KDRIVE_MCP_DENY: "/Mismatch/**" } });
    const resolveDirectory = vi.fn(async (driveId: number, selector: { kind: string; value: string | number }) => await Promise.resolve({ driveId, id: 42, type: "dir", path: driveId === 8 ? "/Second" : selector.kind === "id" ? idPath : selector.value }));
    const inspectDrive = vi.fn(async (id: number) => await Promise.resolve({ id, role: "admin" }));
    const result = await preflightConfigurationWithDiagnosticPaths(c, { inspectDrive, resolveDirectory });
    expect(result.configuration.resolvedRoots).toEqual([{ driveId: 7, folderId: 42 }, { driveId: 8, folderId: 42 }]);
    expect(result.diagnosticRootPaths).toEqual([{ driveId: 7, folderId: 42, path: known }, { driveId: 8, folderId: 42, path: "/Second" }]);
    expect(classifyDenyPatterns(result.configuration.deny, result.diagnosticRootPaths, false)).toEqual(known === null ? [] : [0]);
    expect(resolveDirectory).toHaveBeenCalledTimes(c.roots.length);
    expect(inspectDrive).toHaveBeenCalledTimes(2);
  }
});
// F-048 characterization: BR-029 v1 / BR-021 v2 existing output and branding.
it("TestBR029_existing_preflight_return_contract_unchanged", async () => {
  const c = await local();
  const inspectDrive = vi.fn(
    async (id: number) => await Promise.resolve({ id, role: "admin" }),
  );
  const resolveDirectory = vi.fn(
    async (driveId: number) =>
      await Promise.resolve({ driveId, id: 42, type: "dir" }),
  );
  const result: ResolvedConfiguration = await preflightConfiguration(c, {
    inspectDrive,
    resolveDirectory,
  });
  expect(isResolvedConfiguration(result)).toBe(true);
  expect(isResolvedConfiguration(c)).toBe(false);
  expect(isResolvedConfiguration({ ...result })).toBe(false);
  expect(result.resolvedRoots).toEqual([
    { driveId: 7, folderId: 42 },
    { driveId: 8, folderId: 42 },
  ]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.resolvedRoots)).toBe(true);
  expect(result).not.toHaveProperty("diagnosticRootPaths");
  expect(result).not.toHaveProperty("configuration");
  expect(inspectDrive).toHaveBeenCalledTimes(2);
  expect(resolveDirectory).toHaveBeenCalledTimes(3);
});

// BR-021 v2 / BR-027 v1: pin failures after a previously resolved root.
it("TestBR021_pre_warning_failure_characterization", async () => {
  for (const rejects of [false, true]) {
    const resolveDirectory = vi.fn(async (driveId: number) => {
      await Promise.resolve();
      if (driveId === 7) return { driveId, id: 42, type: "dir" };
      if (rejects) throw new Error("SYNTHETIC_PRIVATE_PATH_CANARY");
      return null;
    });
    await expect(
      preflightConfiguration(await local(), {
        inspectDrive: async (id) => await Promise.resolve({ id, role: "admin" }),
        resolveDirectory,
      }),
    ).rejects.toMatchObject({
      code: rejects ? "PREFLIGHT_FAILED" : "ROOT_NOT_RESOLVED",
      setting: rejects ? "preflight" : "roots",
    });
    expect(resolveDirectory).toHaveBeenCalledTimes(2);
  }
});
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

it.each([
  { label: "explicit unresolved", value: null, rejects: false },
  {
    label: "returned file",
    value: { driveId: 8, id: 10, type: "file" },
    rejects: false,
  },
  { label: "absent return", value: undefined, rejects: false },
  { label: "malformed object", value: {}, rejects: false },
  { label: "malformed primitive", value: "invalid", rejects: false },
  { label: "malformed array", value: [], rejects: false },
  {
    label: "malformed directory ID",
    value: { driveId: 8, id: 0, type: "dir" },
    rejects: false,
  },
  { label: "unexpected rejection", value: null, rejects: true },
])(
  "BR-021 v2 unresolved results and resolver rejections remain distinct — $label",
  async ({ value, rejects }) => {
    const trace: string[] = [];
    const resolveDirectory = vi.fn(async (id: number) => {
      await Promise.resolve();
      trace.push(`root:${id}`);
      if (id === 7) return { driveId: 7, id: 42, type: "dir" };
      if (rejects) throw new Error("SYNTHETIC_CALLBACK_FAILURE");
      return value;
    });
    const operation = preflightConfiguration(await local(), {
      inspectDrive: async (id) => {
        await Promise.resolve();
        trace.push(`drive:${id}`);
        return { id, role: "admin" };
      },
      resolveDirectory,
    });
    const resolved = vi.fn();
    const failed = vi.fn();
    await operation.then(resolved, failed);
    expect(resolved).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: rejects ? "PREFLIGHT_FAILED" : "ROOT_NOT_RESOLVED",
        setting: rejects ? "preflight" : "roots",
      }),
    );
    expect(trace).toEqual(["drive:7", "drive:8", "root:7", "root:8"]);
    expect(resolveDirectory).toHaveBeenCalledTimes(2);
  },
);

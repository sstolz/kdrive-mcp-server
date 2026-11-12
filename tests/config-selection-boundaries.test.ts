import { expect, it, vi } from "vitest";
import { loadConfiguration, preflightConfiguration } from "../src/config.js";

const base = { KDRIVE_ID: "7", KDRIVE_TOKEN: "SYNTHETIC_TOKEN" };
const maximumId = 9007199254740991;
const load = (
  env: Record<string, string> = base,
  argv: string[] = [],
  yaml = "{}",
) =>
  loadConfiguration({
    env,
    argv,
    cwd: "/work",
    readFile: () => Promise.resolve(Buffer.from(yaml)),
  });

for (const { name, argv, code } of [
  {
    name: "TestBR017_ArgvCount128ReachesStructure",
    argv: Array.from({ length: 128 }, () => "x"),
    code: "UNKNOWN_OPTION",
  },
  {
    name: "TestBR017_ArgvTotal131072ReachesStructure",
    argv: ["x".repeat(131072)],
    code: "UNKNOWN_OPTION",
  },
  {
    name: "TestBR017_ArgvTotal131073FailsBudget",
    argv: ["x".repeat(131073)],
    code: "LIMIT_EXCEEDED",
  },
]) {
  it(name + " — BR-017 v1", async () => {
    const readFile = vi.fn(() => Promise.resolve(Buffer.from("{}")));
    await expect(
      loadConfiguration({ env: base, argv, readFile }),
    ).rejects.toMatchObject({ code, setting: "cli" });
    expect(readFile).not.toHaveBeenCalled();
  });
}

function boundedRootPaths() {
  const paths = Array.from(
    { length: 128 },
    (_, i) => "/" + String(i).padStart(3, "0") + "x".repeat(505),
  );
  paths[0] += "x";
  return paths;
}

it("TestBR017_EnvironmentRawValue65536Accepted — BR-017 v1", async () => {
  const paths = boundedRootPaths();
  const raw = paths.map((path) => "7:" + path).join(",");
  expect(Buffer.byteLength(raw)).toBe(65536);
  const config = await load({ ...base, KDRIVE_MCP_ROOTS: raw });
  expect(config.roots).toEqual(
    paths.map((value) => ({ driveId: 7, kind: "path", value })),
  );
});

it("TestBR017_EnvironmentRawValue65537Rejected — BR-017 v1", async () => {
  const raw =
    boundedRootPaths()
      .map((path) => "7:" + path)
      .join(",") + "x";
  expect(Buffer.byteLength(raw)).toBe(65537);
  await expect(load({ ...base, KDRIVE_MCP_ROOTS: raw })).rejects.toMatchObject({
    code: "LIMIT_EXCEEDED",
    setting: "roots",
  });
});

it("TestBR018_ValidYaml65536Accepted — BR-018 v1", async () => {
  const yaml = "mode: read\n#" + "x".repeat(65524);
  expect(Buffer.byteLength(yaml)).toBe(65536);
  const config = await load(base, ["--config", "settings.yaml"], yaml);
  expect(config.mode).toBe("read");
});

it("TestBR018_ValidYaml65537Rejected — BR-018 v1", async () => {
  const yaml = "mode: read\n#" + "x".repeat(65525);
  expect(Buffer.byteLength(yaml)).toBe(65537);
  await expect(
    load(base, ["--config", "settings.yaml"], yaml),
  ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", setting: "configFile" });
});

for (const { name, env, driveIds } of [
  {
    name: "TestBR019_SingularMinimumIdAccepted",
    env: { KDRIVE_ID: "1", KDRIVE_TOKEN: "SYNTHETIC_TOKEN" },
    driveIds: [1],
  },
  {
    name: "TestBR019_PluralMinimumAndMaximumIdsAccepted",
    env: {
      KDRIVE_IDS: "1,9007199254740991",
      KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
    },
    driveIds: [1, maximumId],
  },
]) {
  it(name + " — BR-019 v1", async () => {
    const config = await load(env);
    expect(config.driveId).toBe(1);
    expect(config.driveIds).toEqual(driveIds);
  });
}

it.each([
  ["TestBR019_PluralZeroIdRejected", "0,1"],
  ["TestBR019_PluralUnsafeIdRejected", "1,9007199254740992"],
])("%s — BR-019 v1", async (_name, driveIds) => {
  await expect(
    load({ KDRIVE_IDS: driveIds, KDRIVE_TOKEN: "SYNTHETIC_TOKEN" }),
  ).rejects.toMatchObject({ code: "INVALID_VALUE", setting: "driveIds" });
});

it.each([
  ["TestBR020_RootDriveAndFolderMinimumAccepted", 1],
  ["TestBR020_RootDriveAndFolderMaximumAccepted", maximumId],
] as const)("%s — BR-020 v1", async (_name, id) => {
  const config = await load({
    KDRIVE_ID: String(id),
    KDRIVE_MCP_ROOTS: String(id) + ":" + String(id),
    KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
  });
  expect(config.roots).toEqual([{ driveId: id, kind: "id", value: id }]);
});

it.each([
  ["TestBR020_RootFolderZeroRejected", "1", "1:0"],
  [
    "TestBR020_RootFolderUnsafeIdRejected",
    "9007199254740991",
    "9007199254740991:9007199254740992",
  ],
  ["TestBR020_RootDriveZeroRejected", "1", "0:1"],
  [
    "TestBR020_RootDriveUnsafeIdRejected",
    "9007199254740991",
    "9007199254740992:1",
  ],
])("%s — BR-020 v1", async (_name, driveId, roots) => {
  await expect(
    load({
      KDRIVE_ID: driveId,
      KDRIVE_MCP_ROOTS: roots,
      KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
    }),
  ).rejects.toMatchObject({ code: "INVALID_VALUE", setting: "roots" });
});

it.each([
  ["TestBR021_ReturnedIdMinimumsAccepted", 1],
  ["TestBR021_ReturnedIdMaximumsAccepted", maximumId],
] as const)("%s — BR-021 v1", async (_name, id) => {
  const config = await load({
    KDRIVE_ID: String(id),
    KDRIVE_MCP_ROOTS: String(id) + ":" + String(id),
    KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
  });
  const inspectDrive = vi.fn(() => Promise.resolve({ id, role: "admin" }));
  const resolveDirectory = vi.fn(() =>
    Promise.resolve({ driveId: id, id, type: "dir" }),
  );
  const result = await preflightConfiguration(config, {
    inspectDrive,
    resolveDirectory,
  });
  expect(inspectDrive).toHaveBeenCalledExactlyOnceWith(id);
  expect(resolveDirectory).toHaveBeenCalledExactlyOnceWith(id, {
    driveId: id,
    kind: "id",
    value: id,
  });
  expect(result.driveIds).toEqual([id]);
  expect(result.resolvedRoots).toEqual([{ driveId: id, folderId: id }]);
});

it.each([
  ["TestBR021_InspectedDriveZeroRejected", 1, 0],
  ["TestBR021_InspectedDriveUnsafeIdRejected", maximumId, 9007199254740992],
] as const)("%s — BR-021 v1", async (_name, driveId, returnedId) => {
  const config = await load({
    KDRIVE_ID: String(driveId),
    KDRIVE_MCP_ROOTS: String(driveId) + ":1",
    KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
  });
  const inspectDrive = vi.fn(() =>
    Promise.resolve({ id: returnedId, role: "admin" }),
  );
  const resolveDirectory = vi.fn(() =>
    Promise.resolve({ driveId, id: 1, type: "dir" }),
  );
  await expect(
    preflightConfiguration(config, { inspectDrive, resolveDirectory }),
  ).rejects.toMatchObject({ code: "DRIVE_NOT_ALLOWED", setting: "driveIds" });
  expect(inspectDrive).toHaveBeenCalledExactlyOnceWith(driveId);
  expect(resolveDirectory).not.toHaveBeenCalled();
});

for (const { name, driveId, root, returned } of [
  {
    name: "TestBR021_ResolvedDriveZeroRejected",
    driveId: 1,
    root: "1",
    returned: { driveId: 0, id: 1, type: "dir" },
  },
  {
    name: "TestBR021_ResolvedDriveUnsafeIdRejected",
    driveId: maximumId,
    root: "1",
    returned: { driveId: 9007199254740992, id: 1, type: "dir" },
  },
  {
    name: "TestBR021_ResolvedFolderZeroRejected",
    driveId: 1,
    root: "/Folder",
    returned: { driveId: 1, id: 0, type: "dir" },
  },
  {
    name: "TestBR021_ResolvedFolderUnsafeIdRejected",
    driveId: 1,
    root: "/Folder",
    returned: { driveId: 1, id: 9007199254740992, type: "dir" },
  },
]) {
  it(name + " — BR-021 v1", async () => {
    const config = await load({
      KDRIVE_ID: String(driveId),
      KDRIVE_MCP_ROOTS: String(driveId) + ":" + root,
      KDRIVE_TOKEN: "SYNTHETIC_TOKEN",
    });
    const inspectDrive = vi.fn(() =>
      Promise.resolve({ id: driveId, role: "admin" }),
    );
    const resolveDirectory = vi.fn(() => Promise.resolve(returned));
    await expect(
      preflightConfiguration(config, { inspectDrive, resolveDirectory }),
    ).rejects.toMatchObject({ code: "ROOT_NOT_RESOLVED", setting: "roots" });
    expect(inspectDrive).toHaveBeenCalledExactlyOnceWith(driveId);
    expect(resolveDirectory).toHaveBeenCalledTimes(1);
  });
}

it("TestBR022_DefaultModeSwitchesAndInviteList — BR-022 v1", async () => {
  const config = await load();
  expect(config).toMatchObject({
    mode: "read",
    sharedWithMe: false,
    sharedWrite: false,
    allowPublicLinks: false,
    effectiveSharedWrite: false,
    effectivePublicLinks: false,
    inviteDomains: [],
  });
});

it("TestBR022_ExplicitEmptyInviteList — BR-022 v1", async () => {
  const config = await load({ ...base, KDRIVE_MCP_INVITE_DOMAINS: "" });
  expect(config.inviteDomains).toEqual([]);
});

it("TestBR022_OneInviteDomain — BR-022 v1", async () => {
  const config = await load({
    ...base,
    KDRIVE_MCP_INVITE_DOMAINS: "example.com",
  });
  expect(config.inviteDomains).toEqual(["example.com"]);
});

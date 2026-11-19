import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  ["linux", 0o2000000],
  ["darwin", 0],
  ["win32", 0],
  ["freebsd", 0],
  ["aix", 0],
  ["android", 0],
] as const)(
  "BR-239 v2 BR-293 v2 BR-295 v3 shared flag is Linux only",
  async (platform, expected) => {
    const { closeOnExecFlag } = await import("../src/open-flags.js");
    expect(closeOnExecFlag(platform)).toBe(expected);
  },
);

it.each([
  ["linux", 0o2000000],
  ["darwin", 0],
  ["win32", 0],
] as const)(
  "BR-239 v2 BR-293 v2 BR-295 v3 shared flag defaults to process.platform",
  async (platform, expected) => {
    vi.stubGlobal("process", { ...process, platform });
    vi.resetModules();
    const { closeOnExecFlag } = await import("../src/open-flags.js");
    expect(closeOnExecFlag()).toBe(expected);
  },
);

it("BR-239 v2 BR-293 v2 BR-295 v3 Linux flag literal exists only in the shared helper", () => {
  const matches = readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .filter((path) =>
      readFileSync(join("src", path), "utf8").includes("0o2000000"),
    );
  expect(matches).toEqual(["open-flags.ts"]);
});

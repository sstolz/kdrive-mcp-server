import { expect, it } from "vitest";
import { classifyDenyPatterns } from "../src/deny-root-warning.js";
import { matches } from "../src/policy/glob.js";
import {
  rootPaths,
  warningEnvironment,
  warningFixture,
  warningLine,
} from "./helpers/deny-root-warning.js";
import { runMain } from "./helpers/main.js";

// BR-434 v1: pure classification returns selected-list indices, never paths.
const classify = (
  patterns: readonly string[],
  paths = rootPaths("/Private/Documents"),
  sharedWithMe = false,
) => classifyDenyPatterns(patterns, paths, sharedWithMe);

it("TestBR434_mismatched_literal_prefix", () => {
  const patterns = Object.freeze(["/Documents/Confidential/**"]);
  expect(classify(patterns)).toEqual([0]);
  expect(patterns).toEqual(["/Documents/Confidential/**"]);
});

const compatibilityRows = [
  ["/Documents/Confidential/**", true],
  ["/Private2/**", true],
  ["/private/**", true],
  ["/Private/Documents/Confidential/**", false],
  ["/Private/Documents", false],
  ["/Private", false],
  ["/", false],
  ["/*", false],
  ["/Private/Documents2/**", false],
  ["/Private/*", false],
  ["/Private/**", false],
  ["/Priv*/Documents/**", false],
  ["/?/Other/**", false],
  ["/**/Other", false],
  ["/Private/Doc?ments/**", false],
  ["/Other*/Documents/**", false],
  ["/Other/*/Documents/**", true],
  ["**/Confidential/**", false],
  ["/Shared/Project/**", true],
  // No **: component-local wildcards cannot bridge missing components.
  ["/?", false],
  ["/Priv*", false],
  ["/Other*", true],
  ["/O?", true],
  ["/Other*/*", false],
  ["/Other*/?/*", false],
  ["/*/*", false],
  ["/?/?", false],
  ["/Private/*/report", false],
  ["/?/Other", false],
  ["/?/**", false],
] as const;
it.each(compatibilityRows)(
  "TestBR434_compatibility_table %s",
  (pattern, warn) => {
    expect(classify([pattern])).toEqual(warn ? [0] : []);
  },
);

it.each(["read", "write", "share"])(
  "TestBR434_raw_share_prefix_suppresses_warning %s",
  async (mode) => {
    const { loadConfiguration } = await import("../src/config.js");
    const local = await loadConfiguration({
      argv: [],
      env: {
        ...warningEnvironment("/,/*,/Private,/Private/Documents2/**"),
        KDRIVE_MCP_MODE: mode,
      },
    });
    expect(classify(local.deny)).toEqual([]);
  },
);

it.each(
  compatibilityRows.filter(
    ([pattern]) => pattern.includes("*") || pattern.includes("?"),
  ),
)("TestBR434_wildcard_prefix_is_conservative %s", (pattern, warn) => {
  expect(classify([pattern])).toEqual(warn ? [0] : []);
});

it("TestBR434_any_root_in_any_drive_suppresses_warning", () => {
  for (const driveId of [7, 8]) {
    const first = { driveId: 7, folderId: 42, path: "/Private/Documents" };
    const second = { driveId, folderId: 50, path: "/Documents" };
    const paths = [first, second];
    expect(classify(["/Documents/Confidential/**"], paths)).toEqual([]);
    expect(
      classify(
        ["/Documents/Confidential/**"],
        [first, { ...second, path: "/Other" }],
      ),
    ).toEqual([0]);
  }
  expect(
    classify(
      compatibilityRows.map(([pattern]) => pattern),
      rootPaths("/"),
    ),
  ).toEqual([]);
  expect(
    classify(["/Other/**"], rootPaths("/Private/Documents", null)),
  ).toEqual([]);
  expect(classify(["/é/**"], rootPaths("/e\u0301/Documents"))).toEqual([0]);
});

it.each([false, true])(
  "TestBR434_shared_with_me_namespace_suppresses_warning %s",
  (shared) => {
    expect(
      classify(["/Shared/Project/**", "/Other/**"], undefined, shared),
    ).toEqual(shared ? [1] : [0, 1]);
  },
);
it("TestBR434_received_namespace_has_no_raw_share_prefix_exception", () => {
  expect(classify(["/Shared2/**"], undefined, true)).toEqual([0]);
  expect(classify(["/Shared2/**"], rootPaths("/Shared"), true)).toEqual([]);
});

// Bounded deterministic enumeration: 822 patterns and six namespace cases.
function enumeratedPatterns(): Set<string> {
  const atoms = [
    "Private",
    "Documents",
    "é",
    "e\u0301",
    "Other",
    "*",
    "?",
    "Priv*",
    "**",
  ];
  const patterns = new Set<string>(["/", "**/report", "**/Confidential/**"]);
  for (const a of atoms) {
    patterns.add(`/${a}`);
    for (const b of atoms) {
      patterns.add(`/${a}/${b}`);
      for (const c of atoms) patterns.add(`/${a}/${b}/${c}`);
    }
  }
  return patterns;
}

it("TestBR434_no_false_warning_for_matches", () => {
  const patterns = enumeratedPatterns();
  let matched = 0;
  for (const root of [
    "/",
    "/Private",
    "/Private/Documents",
    "/é/Documents",
    "/e\u0301/Documents",
  ]) {
    const paths = [
      root,
      `${root === "/" ? "" : root}/report`,
      `${root === "/" ? "" : root}/Confidential/report`,
    ];
    for (const pattern of patterns) {
      if (!paths.some((path) => matches(pattern, path))) continue;
      matched++;
      expect(
        classify([pattern], rootPaths(root)),
        `${pattern} under ${root}`,
      ).toEqual([]);
    }
  }
  for (const pattern of [...patterns, "/Shared/Project/**", "**/report"]) {
    if (matches(pattern, "/Shared/Project/report")) {
      matched++;
      expect(classify([pattern], rootPaths("/Other"), true), pattern).toEqual(
        [],
      );
    }
  }
  expect(matched).toBeGreaterThan(100);
});

// BR-435 v1: the existing 256-entry bound also bounds startup writes.
it("TestBR435_warning_count_bound", async () => {
  const f = await warningFixture();
  let run: Awaited<ReturnType<typeof runMain>> | undefined;
  try {
    const patterns = Array.from(
      { length: 256 },
      (_, index) => `/Other${index}/**`,
    );
    run = await runMain({
      argv: [],
      env: warningEnvironment(patterns.join(",")),
      lookup: f.lookup,
      connect: f.connect,
    });
    expect(run.stderr()).toBe(
      patterns.map((_, index) => warningLine(index)).join(""),
    );
    expect(run.exits).toEqual([]);
    expect(run.handle).toBeDefined();
  } finally {
    await (run?.handle as { close(): Promise<void> } | undefined)?.close();
    await f.close();
  }
});

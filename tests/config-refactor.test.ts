import { expect, it } from "vitest";
import { loadConfiguration } from "../src/config.js";
import {
  compareOrdinal,
  trimAsciiListEntry,
  removeTerminalSlashes,
} from "../src/config-text.js";

// BR-017 BR-023: implementation equivalence for the #31 mechanical refactor.
it("preserves ASCII-only edge trimming across exhaustive short strings", () => {
  const alphabet = [" ", "\t", "a", "/", "\u00a0", "\n", "é"];
  let cases = [""];
  for (let length = 0; length < 4; length++)
    cases = [
      ...cases,
      ...cases
        .filter((value) => value.length === length)
        .flatMap((value) => alphabet.map((char) => value + char)),
    ];
  for (const value of cases) {
    expect(trimAsciiListEntry(value)).toBe(
      // eslint-disable-next-line sonarjs/super-linear-regex -- F-011: applied only to short, locally bounded strings
      value.replace(/^[ \t]+|[ \t]+$/gu, ""),
    );
    // eslint-disable-next-line sonarjs/super-linear-regex -- F-011: applied only to short, locally bounded strings
    expect(removeTerminalSlashes(value)).toBe(value.replace(/\/+$/u, ""));
  }
});
it("handles long interior padding and long terminal runs without altering Unicode or interior content", () => {
  const interior = `x${" \t".repeat(524288)}x`;
  expect(trimAsciiListEntry(interior)).toBe(interior);
  expect(trimAsciiListEntry(` \t${interior}\t `)).toBe(interior);
  expect(trimAsciiListEntry(" \t".repeat(524288))).toBe("");
  const path = `https://example.com/a${"/".repeat(1048576)}b`;
  expect(removeTerminalSlashes(path)).toBe(path);
  expect(removeTerminalSlashes(`${path}${"/".repeat(1048576)}`)).toBe(path);
  expect(trimAsciiListEntry("\u00a0 a \u00a0")).toBe("\u00a0 a \u00a0");
}, 2000);
it("preserves UTF-16 code-unit ordering rather than locale ordering", () => {
  const names = [
    "KDRIVE_z",
    "KDRIVE_Z",
    "KDRIVE_ä",
    "KDRIVE_a",
    "KDRIVE_\ud800",
    "KDRIVE_\ue000",
    "KDRIVE_😀",
    "KDRIVE_",
    "KDRIVE_a",
  ];
  expect([...names].sort(compareOrdinal)).toEqual([
    "KDRIVE_",
    "KDRIVE_Z",
    "KDRIVE_a",
    "KDRIVE_a",
    "KDRIVE_z",
    "KDRIVE_ä",
    "KDRIVE_\ud800",
    "KDRIVE_😀",
    "KDRIVE_\ue000",
  ]);
  expect(compareOrdinal("same", "same")).toBe(0);
  expect(compareOrdinal("Z", "a")).toBe(-1);
  expect(compareOrdinal("ä", "z")).toBe(1);
});
it("BR-017 BR-023 keeps list trim and URL normalization behavior through the public boundary", async () => {
  const config = await loadConfiguration({
    argv: [],
    env: {
      KDRIVE_ID: "7",
      KDRIVE_TOKEN: "SYNTHETIC_REFACTOR",
      KDRIVE_MCP_ROOTS: " \t7:/A B\t ",
      KDRIVE_MCP_DENY: " \t/private\t , **/tmp ",
      KDRIVE_MCP_TRANSPORT: "http",
      MCP_PUBLIC_URL: "https://EXAMPLE.com/mcp////",
      OAUTH_MODE: "delegate",
      OAUTH_ISSUER: "https://issuer.example////",
      OAUTH_ALLOWED_SUBJECTS: " Subject , \u00a0Subject\u00a0 ",
    },
  });
  expect(config.roots).toEqual([{ driveId: 7, kind: "path", value: "/A B" }]);
  expect(config.deny).toEqual(["/private", "**/tmp"]);
  expect(config.publicUrl).toBe("https://example.com/mcp");
  expect(config.oauthIssuer).toBe("https://issuer.example");
  expect(config.oauthAllowedSubjects).toEqual([
    "Subject",
    "\u00a0Subject\u00a0",
  ]);
});

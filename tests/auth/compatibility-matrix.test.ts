import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMatrix } from "../../scripts/oidc/matrix.js";

const text = readFileSync("docs/mcp-client-compatibility.md", "utf8");
const facts = ["supported", "not supported", "unverified"];

describe("BR-108 MCP client compatibility matrix", () => {
  it("BR-108 has the six client rows with dates, https sources and allowed values", () => {
    const matrix = parseMatrix(text);
    expect(matrix.reference).toBe("2026-07-28");
    expect(matrix.rows.map((row) => row.client)).toEqual([
      "claude.ai",
      "Claude iOS",
      "Claude Desktop",
      "Claude Code",
      "ChatGPT",
      "Codex",
    ]);
    for (const row of matrix.rows) {
      expect(row.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(new Date(`${row.checked}T00:00:00Z`).toISOString()).toContain(
        row.checked,
      );
      expect(row.sources.length).toBeGreaterThan(0);
      for (const source of row.sources)
        expect(new URL(source).protocol).toBe("https:");
      for (const fact of [
        row.dynamicRegistration,
        row.cimd,
        row.manualClientId,
        row.rejectsInconsistentIssuer,
      ])
        expect(facts).toContain(fact);
      expect(row.redirectWithIss.length).toBeGreaterThan(0);
      expect(row.redirectWithoutIss.length).toBeGreaterThan(0);
      expect(row.version).toMatch(/^(\d{4}-\d{2}-\d{2}|unverified)$/u);
      expect(row.equalsReference).toBe(
        row.version === "unverified"
          ? "unverified"
          : row.version === matrix.reference
            ? "yes"
            : "no",
      );
      expect(["not tested", "passed", "failed"]).toContain(row.realTest);
    }
  });

  it("BR-108 rejects a row with a value outside the allowed set", () => {
    const broken = text.replace(
      /(\|\s*claude\.ai\s*\|[^\n]*?\|\s*)supported(\s*\|)/u,
      "$1maybe$2",
    );
    expect(broken).not.toBe(text);
    expect(() => parseMatrix(broken)).toThrow();
  });

  it("BR-108 rejects a bad date, a non-https source or an inconsistent reference comparison", () => {
    const row = text.split("\n").find((line) => /^\|\s*Codex\s*\|/u.test(line));
    if (!row) throw new Error("Codex row missing");
    for (const replacement of [
      row.replace(/\d{4}-\d{2}-\d{2}/u, "2026-13-45"),
      row.replace(/https:\/\//gu, "http://"),
      row.replace(/\|\s*no\s*\|/u, "| yes |"),
      row.replace(/\|\s*not tested\s*\|/u, "| skipped |"),
    ]) {
      expect(replacement).not.toBe(row);
      expect(() => parseMatrix(text.replace(row, replacement))).toThrow();
    }
    expect(() => parseMatrix("# empty\n")).toThrow();
  });
});

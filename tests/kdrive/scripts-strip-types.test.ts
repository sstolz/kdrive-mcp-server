// F-014 BR-211 v2 / BR-215 v2: the owner-run targets execute scripts/*.ts
// directly with Node's type stripping, which rejects TypeScript-only runtime
// syntax (parameter properties, enums, namespaces) that vitest accepts. Node
// also strip-loads every relative `.ts` file those entries import, so the
// guard follows static imports transitively.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ENTRIES = readdirSync("scripts")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => resolve("scripts", name));
// Runtime imports only: `import type` statements and `typeof import(...)`
// type positions are erased by Node and never load their target.
const STATIC_FROM = /\bfrom\s*["'](\.\.?\/[^"']+\.ts)["']$/u;
const SIDE_EFFECT = /^import\s*["'](\.\.?\/[^"']+\.ts)["']$/u;
const DYNAMIC = /(?<!typeof )\bimport\(\s*["'](\.\.?\/[^"']+\.ts)["']/gu;

function runtimeImports(source: string): string[] {
  const found: string[] = [];
  for (const raw of source.split(";")) {
    const statement = raw.trim();
    if (!/^(?:import|export)\b/u.test(statement)) continue;
    if (/^(?:import|export)\s+type\b/u.test(statement)) continue;
    const target =
      STATIC_FROM.exec(statement)?.[1] ?? SIDE_EFFECT.exec(statement)?.[1];
    if (target) found.push(target);
  }
  for (const match of source.matchAll(DYNAMIC))
    if (match[1]) found.push(match[1]);
  return found;
}

function reachable(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(readFileSync(file, "utf8"))) {
      const target = resolve(dirname(file), spec);
      if (existsSync(target)) queue.push(target);
    }
  }
  return [...seen].map((file) => relative(process.cwd(), file)).sort();
}
const files = reachable(ENTRIES);

describe("BR-211/BR-215 scripts run under Node type stripping", () => {
  it("TestBR211_BR215_the_guard_reaches_runtime_imports_outside_scripts", () => {
    expect(files).toContain(join("src", "kdrive", "routes.ts"));
  });

  it.each(files)("TestBR211_BR215_%s_strips_under_Node", (file) => {
    const source = readFileSync(file, "utf8");
    expect(() => stripTypeScriptTypes(source)).not.toThrow();
  });
});

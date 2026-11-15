// Test-only in-memory loader: child probes exercise the working source, never stale dist/.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && context.parentURL?.includes("/src/")) {
    try {
      return await nextResolve(specifier.slice(0, -3) + ".ts", context);
    } catch {
      // External JavaScript dependencies keep the normal resolver.
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    };
  }
  return nextLoad(url, context);
}

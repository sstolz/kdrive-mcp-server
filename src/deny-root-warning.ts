/** Startup evidence only; these paths never authorize runtime access. */
export interface DiagnosticRootPath {
  readonly driveId: number;
  readonly folderId: number;
  readonly path: string | null;
}

const components = (path: string): string[] =>
  path === "/" ? [] : path.slice(1).split("/");
const prefix = (left: readonly string[], right: readonly string[]) =>
  left.length <= right.length &&
  left.every((part, index) => part === right[index]);

/** BR-434 v1: conservative compatibility, including BR-040's raw prefix. */
export function classifyDenyPatterns(
  patterns: readonly string[],
  paths: readonly DiagnosticRootPath[],
  sharedWithMe: boolean,
): number[] {
  if (paths.some((root) => root.path === null)) return [];
  const known = paths.flatMap((root) =>
    root.path === null ? [] : [root.path],
  );
  const roots = [...known, ...(sharedWithMe ? ["/Shared"] : [])].map(
    components,
  );
  const outside: number[] = [];
  patterns.forEach((pattern, index) => {
    if (pattern.startsWith("**/")) return;
    const wildcard = pattern.search(/[*?]/u);
    const raw = wildcard < 0 ? pattern : pattern.slice(0, wildcard);
    if (known.some((root) => raw.startsWith(root) || root.startsWith(raw)))
      return;
    const parts = components(pattern);
    const firstWildcard = parts.findIndex((part) => /[*?]/u.test(part));
    const literals = firstWildcard < 0 ? parts : parts.slice(0, firstWildcard);
    const globstar = parts.includes("**");
    const compatible = roots.some(
      (root) =>
        (globstar || parts.length >= root.length) &&
        (prefix(literals, root) || prefix(root, literals)),
    );
    if (!compatible) outside.push(index);
  });
  return outside;
}

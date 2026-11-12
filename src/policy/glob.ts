/** BR-034: code-point globbing, with whole-component ** and no normalization. */
function component(pattern: string, value: string): boolean {
  const p = Array.from(pattern),
    v = Array.from(value);
  let previous = new Array<boolean>(v.length + 1).fill(false);
  previous[0] = true;
  for (const token of p) {
    const next = new Array<boolean>(v.length + 1).fill(false);
    for (let j = 0; j <= v.length; j++)
      next[j] =
        token === "*"
          ? !!previous[j] || (j > 0 && !!next[j - 1])
          : j > 0 && !!previous[j - 1] && (token === "?" || token === v[j - 1]);
    previous = next;
  }
  return previous[v.length] === true;
}
export function matches(pattern: string, path: string): boolean {
  const p = (pattern.startsWith("/") ? pattern.slice(1) : pattern).split("/");
  const v = path === "/" ? [] : path.slice(1).split("/");
  if (pattern === "/") return path === "/";
  let previous = new Array<boolean>(v.length + 1).fill(false);
  previous[0] = true;
  for (const token of p) {
    const next = new Array<boolean>(v.length + 1).fill(false);
    for (let j = 0; j <= v.length; j++)
      next[j] =
        token === "**"
          ? !!previous[j] || (j > 0 && !!next[j - 1])
          : // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
            j > 0 && !!previous[j - 1] && component(token, v[j - 1]!);
    previous = next;
  }
  return previous[v.length] === true;
}

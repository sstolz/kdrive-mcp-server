/** List syntax trims only ASCII space/tab, with one pass over each edge. */
export function trimAsciiListEntry(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === " " || value[start] === "\t"))
    start++;
  while (end > start && (value[end - 1] === " " || value[end - 1] === "\t"))
    end--;
  return value.slice(start, end);
}
/** Canonical URL strings contain no raw line terminators; remove literal final slashes. */
export function removeTerminalSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
/** Match default string sorting's UTF-16 ordering without locale-dependent folding. */
export function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const LOOPBACK_PREFIXES = [
  "http://127.0.0.1",
  "http://[::1]",
  "http://localhost",
];

/**
 * BR-126: removes a valid port suffix directly after a loopback host; returns
 * undefined when the value is not a loopback URI of that exact form.
 */
function withoutLoopbackPort(value: string): string | undefined {
  const prefix = LOOPBACK_PREFIXES.find((entry) => value.startsWith(entry));
  if (prefix === undefined) return undefined;
  const rest = value.slice(prefix.length);
  const port = /^:(\d{1,5})(?=[/?]|$)/u.exec(rest);
  if (port) {
    const number = Number(port[1]);
    if (number < 1 || number > 65_535) return undefined;
    return prefix + rest.slice(port[0].length);
  }
  return rest === "" || rest.startsWith("/") || rest.startsWith("?")
    ? value
    : undefined;
}

/** BR-126: exact match, except the port of an HTTP loopback URI. */
export function redirectMatches(candidate: string, reference: string): boolean {
  if (candidate === reference) return true;
  const left = withoutLoopbackPort(candidate);
  const right = withoutLoopbackPort(reference);
  return left !== undefined && left === right;
}

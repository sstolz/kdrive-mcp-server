/** BR-156: the accepted `Host` values (lowercase) for one public URL. */
export function hostForms(
  url: URL,
  hostnames: readonly string[],
): ReadonlySet<string> {
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const forms = new Set<string>();
  for (const hostname of hostnames) {
    if (url.port === "") {
      forms.add(hostname);
      forms.add(`${hostname}:${defaultPort}`);
    } else forms.add(`${hostname}:${url.port}`);
  }
  return forms;
}

/** BR-157: the accepted `Origin` values for one public URL. */
export function originForms(
  url: URL,
  hostnames: readonly string[],
): ReadonlySet<string> {
  const port = url.port === "" ? "" : `:${url.port}`;
  const forms = new Set<string>([url.origin]);
  for (const hostname of hostnames)
    forms.add(`${url.protocol}//${hostname}${port}`);
  return forms;
}

/** F-021 BR-324: a loopback `Host` form (lowercase) accepted on `/healthz`. */
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/u;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOST.test(host);
}

export type Credential =
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "token"; token: string };

const TOKEN = /^ +([A-Za-z0-9._~+/-]+=*)$/u;

/** BR-158: classifies an `Authorization` value as the header grammar allows. */
export function parseCredential(value: string | null): Credential {
  if (value === null) return { kind: "missing" };
  const space = value.indexOf(" ");
  const scheme = space < 0 ? value : value.slice(0, space);
  if (scheme.toLowerCase() !== "bearer") return { kind: "missing" };
  const match = TOKEN.exec(value.slice(scheme.length));
  return match?.[1] === undefined
    ? { kind: "malformed" }
    : { kind: "token", token: match[1] };
}

/** BR-160: the framing refusal reason for one request, if any. */
export function framingRefusal(
  contentLength: string | null,
  transferEncoding: string | null,
  limit: number | undefined,
): "too_large" | "invalid" | undefined {
  if (limit === undefined) {
    if (transferEncoding !== null) return "too_large";
    return contentLength !== null && !/^0+$/u.test(contentLength)
      ? "too_large"
      : undefined;
  }
  if (contentLength === null) return undefined;
  if (!/^\d{1,15}$/u.test(contentLength)) return "invalid";
  return Number(contentLength) > limit ? "too_large" : undefined;
}

/** BR-160: reads at most `limit` bytes; `undefined` when the body is larger. */
export async function readBounded(
  request: Request,
  limit: number,
): Promise<Uint8Array | undefined> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** BR-160: strict UTF-8; `undefined` for an invalid sequence. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** BR-160: the media type, parameters dropped, lowercase. */
export function mediaType(value: string | null): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

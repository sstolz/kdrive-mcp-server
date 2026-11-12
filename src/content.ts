import type { ResolvedConfiguration } from "./config.js";
import { navigatePolicy, type Ref } from "./policy/index.js";
import { record, reference } from "./policy/values.js";

export const contentMessages = [
  "CONTENT_UNAVAILABLE",
  "VERSION_UNAVAILABLE",
  "VERSION_CHANGED",
  "INVALID_RANGE",
  "READ_UNAVAILABLE",
  "UNSUPPORTED_REPRESENTATION",
] as const;
type ContentCode =
  | (typeof contentMessages)[number]
  | "ACCESS_DENIED"
  | "LIMIT_EXCEEDED"
  | "REQUEST_TIMEOUT"
  | "INVALID_ENCODING"
  | "UNSUPPORTED_FORMAT"
  | "NO_EXTRACTABLE_TEXT";
const failures = new WeakMap<object, ContentCode>();
export class ContentFailure extends Error {
  constructor(code: ContentCode) {
    super(code);
    failures.set(this, code);
  }
}
export function contentFailure(value: unknown): ContentCode | undefined {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function"
    ? failures.get(value)
    : undefined;
}
function fail(code: ContentCode): never {
  throw new ContentFailure(code);
}
export function strongETag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.endsWith('"') &&
    /^"[!#-~]{1,254}"$/u.test(value)
  );
}
export interface ContentRange {
  readonly target: Ref;
  readonly start: number;
  readonly end: number;
  readonly size_bytes: number;
  readonly etag: string;
}
export interface ContentDependencies {
  describe(target: Ref, signal: AbortSignal): Promise<unknown>;
  open(request: ContentRange, signal: AbortSignal): Promise<unknown>;
}
interface Body {
  read(max: number, signal: AbortSignal): Promise<unknown>;
  close(): void;
}
interface Runtime {
  signal(): AbortSignal;
  alive(): void;
  call<T>(
    port: () => Promise<T>,
    retry: boolean,
    before?: () => Promise<void>,
  ): Promise<T>;
}
function exact(value: unknown, keys: readonly string[]) {
  const data = record(value);
  if (
    Object.keys(data).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(data, k))
  )
    fail("CONTENT_UNAVAILABLE");
  return data;
}
function targetEquals(value: unknown, target: Ref) {
  const data = exact(value, ["driveId", "id"]),
    ref = reference(data);
  if (ref.driveId !== target.driveId || ref.id !== target.id)
    fail("CONTENT_UNAVAILABLE");
}
function bodyOf(value: unknown): Body {
  const data = exact(value, ["read", "close"]);
  if (typeof data.read !== "function" || typeof data.close !== "function")
    fail("CONTENT_UNAVAILABLE");
  const read = data.read as Body["read"],
    close = data.close as Body["close"];
  return {
    read: (max, signal) => Reflect.apply(read, value, [max, signal]),
    close: () => {
      Reflect.apply(close, value, []);
    },
  };
}
/** Cleanup accepts only own data methods and never reads a getter, even on rejected envelopes. */
export function closeContentResponse(value: unknown): void {
  try {
    if (!value || typeof value !== "object") return;
    const field = Object.getOwnPropertyDescriptor(value, "body");
    if (
      !field ||
      !("value" in field) ||
      !field.value ||
      typeof field.value !== "object"
    )
      return;
    const close = Object.getOwnPropertyDescriptor(
      field.value as object,
      "close",
    );
    if (close && "value" in close && typeof close.value === "function")
      Reflect.apply(close.value as () => void, field.value, []);
  } catch {
    /* Cleanup never publishes provider errors. */
  }
}
export function resourceTarget(uri: string): Ref {
  const match = /^kdrive:\/\/([1-9]\d*)\/file\/([1-9]\d*)$/u.exec(uri);
  if (!match) return fail("UNSUPPORTED_REPRESENTATION");
  if (match[0] !== uri) return fail("UNSUPPORTED_REPRESENTATION");
  const driveId = Number(match[1]),
    id = Number(match[2]);
  if (!Number.isSafeInteger(driveId) || !Number.isSafeInteger(id))
    return fail("UNSUPPORTED_REPRESENTATION");
  return Object.freeze({ driveId, id });
}

/** BR-082–091: private immediate content consumer; callers receive no authorization grant. */
export function createContentReader(
  config: ResolvedConfiguration,
  policy: object,
  content: ContentDependencies | undefined,
  runtime: Runtime,
) {
  async function authorize(target: Ref) {
    runtime.alive();
    const result = await navigatePolicy(policy, { kind: "read", target });
    runtime.alive();
    if (!result.ok || result.item.type !== "file") fail("ACCESS_DENIED");
  }
  function fits(value: unknown) {
    const text = JSON.stringify(value);
    return (
      text.length <= config.maxOutputChars && Buffer.byteLength(text) <= 262144
    );
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  async function read(
    target: Ref,
    offset: number,
    requested: number | undefined,
    expected: string | undefined,
    uri?: string,
    completeLimit?: number,
  ) {
    const signal = runtime.signal();
    if (requested !== undefined && requested > config.maxReadBytes)
      fail("LIMIT_EXCEEDED");
    await authorize(target);
    if (!content) return fail("CONTENT_UNAVAILABLE");
    const raw = await runtime.call(
      () => content.describe(target, signal),
      true,
      () => authorize(target),
    );
    let size: number, etag: string;
    try {
      const data = record(raw);
      targetEquals(data.target, target);
      if (!strongETag(data.etag) || data.version_bound !== true)
        fail("VERSION_UNAVAILABLE");
      exact(raw, ["target", "size_bytes", "etag", "version_bound"]);
      if (
        typeof data.size_bytes !== "number" ||
        !Number.isSafeInteger(data.size_bytes) ||
        data.size_bytes < 0
      )
        fail("CONTENT_UNAVAILABLE");
      size = data.size_bytes;
      etag = data.etag;
    } catch (error) {
      throw new ContentFailure(contentFailure(error) ?? "CONTENT_UNAVAILABLE");
    }
    if (expected !== undefined && expected !== etag) fail("VERSION_CHANGED");
    if (offset > size) fail("INVALID_RANGE");
    if (
      completeLimit !== undefined &&
      (size > completeLimit || size > config.maxReadBytes)
    )
      fail("LIMIT_EXCEEDED");
    const toolPayload = (length: number, data: string) => ({
      drive_id: target.driveId,
      file_id: target.id,
      offset_bytes: offset,
      bytes_read: length,
      size_bytes: size,
      etag,
      encoding: "base64",
      data,
      has_more: offset + length < size,
      ...(offset + length < size ? { next_offset_bytes: offset + length } : {}),
    });
    const representation = (length: number, data: string) =>
      uri === undefined
        ? toolPayload(length, data)
        : {
            contents: [
              { uri, mimeType: "application/octet-stream", blob: data },
            ],
          };
    const remaining = size - offset;
    let count = Math.min(
      remaining,
      requested ?? config.maxReadBytes,
      config.maxReadBytes,
    );
    const plannedFits = (length: number) => {
      // Base64 is ASCII without JSON escaping; count its expansion without allocating it.
      const envelope = JSON.stringify(representation(length, "")),
        expansion = 4 * Math.ceil(length / 3);
      return (
        envelope.length + expansion <= config.maxOutputChars &&
        Buffer.byteLength(envelope) + expansion <= 262144
      );
    };
    if (completeLimit !== undefined) {
      count = size;
    } else if (uri !== undefined) {
      if (size > config.maxReadBytes || !plannedFits(size))
        fail("LIMIT_EXCEEDED");
      count = size;
    } else {
      let low = 0,
        high = count;
      // Near EOF the next-offset field disappears; check that endpoint separately.
      if (!plannedFits(high)) {
        high = Math.min(high, Math.max(0, remaining - 1));
        while (low < high) {
          const mid = low + Math.ceil((high - low) / 2);
          if (plannedFits(mid)) low = mid;
          else high = mid - 1;
        }
        count = low;
      }
      if (!plannedFits(count) || (remaining > 0 && count === 0))
        fail("LIMIT_EXCEEDED");
    }
    let bytes = Buffer.alloc(0);
    if (count > 0) {
      let cleanup = () => {};
      const request: ContentRange = Object.freeze({
        target,
        start: offset,
        end: offset + count - 1,
        size_bytes: size,
        etag,
      });
      const response = await runtime.call(
        async () => {
          const result = await content.open(request, signal);
          let closed = false;
          const close = () => {
            if (!closed) {
              closed = true;
              closeContentResponse(result);
            }
          };
          cleanup = () => {
            signal.removeEventListener("abort", close);
            close();
          };
          if (signal.aborted) close();
          else signal.addEventListener("abort", close, { once: true });
          return result;
        },
        true,
        () => authorize(target),
      );
      try {
        let body: Body;
        try {
          const data = exact(response, [
            "target",
            "start",
            "end",
            "size_bytes",
            "etag",
            "status",
            "body",
          ]);
          targetEquals(data.target, target);
          if (strongETag(data.etag) && data.etag !== etag)
            fail("VERSION_CHANGED");
          if (
            data.status !== 206 ||
            data.start !== request.start ||
            data.end !== request.end ||
            data.size_bytes !== size ||
            data.etag !== etag
          )
            fail("CONTENT_UNAVAILABLE");
          body = bodyOf(data.body);
        } catch (error) {
          throw new ContentFailure(
            contentFailure(error) ?? "CONTENT_UNAVAILABLE",
          );
        }
        bytes = Buffer.alloc(count);
        let read = 0;
        while (read < count) {
          const max = Math.min(16384, count - read);
          const chunk = await runtime.call(() => body.read(max, signal), false);
          if (
            !(chunk instanceof Uint8Array) ||
            ![Uint8Array.prototype, Buffer.prototype].includes(
              Object.getPrototypeOf(chunk) as typeof Uint8Array.prototype,
            ) ||
            byteLength(chunk) < 1 ||
            byteLength(chunk) > max
          )
            fail("CONTENT_UNAVAILABLE");
          bytes.set(chunk, read);
          read += byteLength(chunk);
        }
        if ((await runtime.call(() => body.read(1, signal), false)) !== null)
          fail("CONTENT_UNAVAILABLE");
      } finally {
        cleanup();
      }
    }
    await authorize(target);
    runtime.alive();
    if (completeLimit !== undefined) return { bytes, size_bytes: size, etag };
    const result = representation(count, bytes.toString("base64"));
    if (!fits(result)) fail("LIMIT_EXCEEDED");
    return result;
  }
  return {
    read,
    authorize,
    async complete(target: Ref, expected: string | undefined, limit: number) {
      return (await read(target, 0, undefined, expected, undefined, limit)) as {
        bytes: Buffer;
        size_bytes: number;
        etag: string;
      };
    },
  };
}
function byteLength(value: Uint8Array): number {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
  return Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype) as object,
    "byteLength",
  )!.get!.call(value) as number;
}

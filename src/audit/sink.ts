import { constants, close, fdatasync, fstat, open, write } from "node:fs";

/** BR-237: the identity of the caller of a gate run. */
export type AuditIdentity =
  | { readonly kind: "stdio" }
  | { readonly kind: "insecure" }
  | { readonly kind: "oauth"; readonly iss: string; readonly sub: string };

export type AuditEvent = "intent" | "outcome" | "denied";
export type AuditResult = "succeeded" | "failed" | "uncertain";
/** F-016 closed code set (record schema). */
export type AuditCode =
  | "ACCESS_DENIED"
  | "AUDIT_UNAVAILABLE"
  | "UNAVAILABLE"
  | "CANCELLED"
  | "RATE_LIMITED"
  | "NOT_SENT"
  | "UPSTREAM_REJECTED"
  | "UPSTREAM_UNCERTAIN";

export interface AuditIds {
  readonly target?: number;
  readonly destination?: number;
}
/** BR-234: the members of one record; `serializeAuditRecord` fixes their order. */
export interface AuditRecord {
  readonly ts: string;
  readonly event: AuditEvent;
  readonly op: string;
  readonly identity: AuditIdentity;
  readonly tool: string;
  readonly kind: string;
  readonly drive: number;
  readonly destinationDrive?: number;
  readonly ids: AuditIds;
  readonly result?: AuditResult;
  readonly attempts?: number;
  readonly ms?: number;
  readonly status?: number;
  readonly code?: AuditCode;
  readonly created?: number;
}

/** BR-236: the largest serialized record, LF included. */
export const AUDIT_RECORD_MAX_BYTES = 8192;
/** BR-259 v2: the append bound, including queue time, for both sinks. */
export const AUDIT_APPEND_TIMEOUT_MS = 5000;
export const AUDIT_CLOSE_TIMEOUT_MS = 5000;
/** BR-239: the fixed startup refusal. */
export const AUDIT_OPEN_FAILED_MESSAGE =
  "The audit log could not be opened or is not a private regular file.";

/** A fixed, content-free append failure. */
export class AuditUnavailable extends Error {
  constructor() {
    super("AUDIT_UNAVAILABLE");
  }
}
/** BR-239: startup stops with this fixed message. */
export class AuditStartupError extends Error {
  constructor() {
    super(AUDIT_OPEN_FAILED_MESSAGE);
  }
}

function identityValue(identity: AuditIdentity): Record<string, string> {
  return identity.kind === "oauth"
    ? { kind: "oauth", iss: identity.iss, sub: identity.sub }
    : { kind: identity.kind };
}
function idsValue(ids: AuditIds): Record<string, number> {
  return {
    ...(ids.target === undefined ? {} : { target: ids.target }),
    ...(ids.destination === undefined ? {} : { destination: ids.destination }),
  };
}
function eventMembers(record: AuditRecord): Record<string, unknown> {
  if (record.event === "denied") return { code: record.code };
  if (record.event === "intent") return {};
  return {
    result: record.result,
    attempts: record.attempts,
    ms: record.ms,
    ...(record.status === undefined ? {} : { status: record.status }),
    ...(record.code === undefined ? {} : { code: record.code }),
    ...(record.created === undefined ? {} : { created: record.created }),
  };
}
/**
 * BR-234/BR-236: one JSON object and one LF. Every code unit outside
 * U+0020–U+007E is escaped as `\uXXXX`, so the line is printable ASCII.
 */
export function serializeAuditRecord(record: AuditRecord): string {
  const json = JSON.stringify({
    v: 1,
    ts: record.ts,
    event: record.event,
    op: record.op,
    identity: identityValue(record.identity),
    tool: record.tool,
    kind: record.kind,
    drive: record.drive,
    ...(record.destinationDrive === undefined
      ? {}
      : { destinationDrive: record.destinationDrive }),
    ids: idsValue(record.ids),
    ...eventMembers(record),
  });
  // BR-236: without the `u` flag each match is one UTF-16 code unit, so
  // `codePointAt(0)` yields that unit (a lone surrogate stays a surrogate).
  const line = json.replaceAll(
    /[^\x20-\x7e]/g,
    (unit) => `\\u${(unit.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`,
  );
  return `${line}\n`;
}

export interface AuditSink {
  /** BR-240/BR-242: resolves once the whole record is durable per the sink. */
  append(record: AuditRecord): Promise<void>;
  readonly latched: boolean;
  /** BR-241/BR-252: refuses every later append without I/O. */
  latch(): void;
  /** Internal absolute monotonic deadline for non-committed stdio shutdown. */
  shortenDeadline?(deadline: number): void;
  /** One gate owns the first-latch diagnostic, including idle errors. */
  onLatch?(listener: () => void): void;
  close(shutdownDeadline?: number): Promise<void>;
}

interface PendingAppend {
  readonly line: string;
  deadline: number;
  timer?: ReturnType<typeof setTimeout>;
  settle(success: boolean): void;
}

/** BR-241/242/254/259: bounded callers, serialized physical operations. */
function serialSink(
  writeLine: (line: string, check: () => void) => Promise<void>,
  release: (() => Promise<void>) | undefined,
  timeoutMs = AUDIT_APPEND_TIMEOUT_MS,
): AuditSink {
  let latched = false;
  let closed = false;
  let active: PendingAppend | undefined;
  const pending = new Set<PendingAppend>();
  let deadline = Infinity;
  let listener: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let finishClose: (() => void) | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let closeDeadline = Infinity;
  let closeDone = false;
  let releasing = false;

  function latch() {
    if (latched) return;
    latched = true;
    for (const append of pending) append.settle(false);
    // Latch before notifying: the diagnostic can itself cause a stream error.
    listener?.();
    releaseWhenIdle();
  }
  function check(append: PendingAppend) {
    if (performance.now() >= append.deadline) latch();
    if (latched) throw new AuditUnavailable();
  }
  function arm(append: PendingAppend) {
    clearTimeout(append.timer);
    const remaining = append.deadline - performance.now();
    if (remaining <= 0) latch();
    else append.timer = setTimeout(latch, remaining);
  }
  function completeClose() {
    if (closeDone) return;
    closeDone = true;
    clearTimeout(closeTimer);
    finishClose?.();
  }
  function expireClose() {
    latch();
    completeClose();
  }
  function releaseWhenIdle() {
    if (!closed || closeDone || releasing) return;
    // Shared stderr has no fd to release: a rejected append need not await
    // its late callback. File release must wait for the physical operation.
    if (active && (release || pending.has(active))) return;
    if (performance.now() >= closeDeadline) {
      expireClose();
      return;
    }
    if (!release) {
      completeClose();
      return;
    }
    releasing = true;
    void Promise.resolve()
      .then(() => {
        if (performance.now() >= closeDeadline) {
          expireClose();
          return;
        }
        return release();
      })
      .then(
        () => {
          if (performance.now() >= closeDeadline) latch();
          completeClose();
        },
        () => {
          latch();
          completeClose();
        },
      );
  }
  function pump() {
    if (active || closed || latched) return;
    const append = pending.values().next().value;
    if (!append) return;
    active = append;
    // This promise tracks the underlying operation, never its timeout wrapper.
    void Promise.resolve()
      .then(() => {
        check(append);
        return writeLine(append.line, () => {
          check(append);
        });
      })
      .then(() => {
        if (performance.now() >= append.deadline) latch();
        append.settle(!latched);
      }, latch)
      .then(() => {
        active = undefined;
        if (closed) releaseWhenIdle();
        else pump();
      });
  }
  const sink: AuditSink = {
    get latched() {
      return latched;
    },
    latch,
    onLatch(notify) {
      listener = notify;
      if (latched) notify();
    },
    shortenDeadline(at) {
      deadline = Math.min(deadline, at);
      for (const append of pending) {
        append.deadline = Math.min(append.deadline, deadline);
        arm(append);
      }
    },
    append(record) {
      const started = performance.now();
      if (latched || closed) return Promise.reject(new AuditUnavailable());
      const line = serializeAuditRecord(record);
      // BR-236: validation alone does not latch a healthy sink.
      if (Buffer.byteLength(line) > AUDIT_RECORD_MAX_BYTES)
        return Promise.reject(new AuditUnavailable());
      return new Promise<void>((resolve, reject) => {
        const append: PendingAppend = {
          line,
          deadline: Math.min(started + timeoutMs, deadline),
          settle(success) {
            if (!pending.delete(append)) return;
            clearTimeout(append.timer);
            if (success) resolve();
            else reject(new AuditUnavailable());
          },
        };
        pending.add(append);
        arm(append);
        void Promise.resolve().then(pump);
      });
    },
    close(shutdownDeadline = Infinity) {
      if (!closing) {
        closed = true;
        closing = new Promise<void>((resolve) => {
          finishClose = resolve;
        });
        closeDeadline = performance.now() + AUDIT_CLOSE_TIMEOUT_MS;
        for (const append of pending)
          if (append !== active) append.settle(false);
      }
      if (!closeDone) {
        closeDeadline = Math.min(closeDeadline, shutdownDeadline);
        clearTimeout(closeTimer);
        const remaining = closeDeadline - performance.now();
        if (remaining <= 0) expireClose();
        else {
          closeTimer = setTimeout(expireClose, remaining);
          releaseWhenIdle();
        }
      }
      return closing;
    },
  };
  return sink;
}

/** The file operations of the file sink; injected by tests. */
export interface AuditFilePort {
  open(path: string, flags: number, mode: number): Promise<number>;
  fstat(fd: number): Promise<{ isFile(): boolean; uid: number; mode: number }>;
  geteuid(): number;
  /** Resolves with the number of bytes written by one write call. */
  write(fd: number, data: Uint8Array): Promise<number>;
  fdatasync(fd: number): Promise<void>;
  close(fd: number): Promise<void>;
}

function settle<T>(
  resolve: (value: T) => void,
  reject: (error: unknown) => void,
): (error: Error | null, value: T) => void {
  return (error, value) => {
    if (error) reject(error);
    else resolve(value);
  };
}
export const productionFilePort: AuditFilePort = Object.freeze({
  open: (path: string, flags: number, mode: number) =>
    new Promise<number>((resolve, reject) => {
      open(path, flags, mode, settle(resolve, reject));
    }),
  fstat: (fd: number) =>
    new Promise<{ isFile(): boolean; uid: number; mode: number }>(
      (resolve, reject) => {
        fstat(fd, settle(resolve, reject));
      },
    ),
  geteuid: () => process.geteuid?.() ?? -1,
  write: (fd: number, data: Uint8Array) =>
    new Promise<number>((resolve, reject) => {
      write(fd, data, 0, data.byteLength, null, settle(resolve, reject));
    }),
  fdatasync: (fd: number) =>
    new Promise<void>((resolve, reject) => {
      fdatasync(fd, (error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  close: (fd: number) =>
    new Promise<void>((resolve, reject) => {
      close(fd, (error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
});

/** Linux O_CLOEXEC; Node does not export it, and libuv also sets it on open. */
const O_CLOEXEC = 0o2000000;
/**
 * BR-239 flags. O_NONBLOCK makes an open of a FIFO without reader fail instead
 * of blocking startup; it has no effect on a regular file.
 */
export const AUDIT_OPEN_FLAGS =
  constants.O_WRONLY |
  constants.O_APPEND |
  constants.O_CREAT |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK |
  O_CLOEXEC;

export interface FileSinkOptions {
  readonly port?: AuditFilePort;
  /** BR-259 timer; defaults to the global timers. */
  readonly timeoutMs?: number;
}
/** BR-239–BR-242, BR-259: the private append-only file sink. */
export async function openFileSink(
  path: string,
  options: FileSinkOptions = {},
): Promise<AuditSink> {
  const port = options.port ?? productionFilePort;
  const timeoutMs = options.timeoutMs ?? AUDIT_APPEND_TIMEOUT_MS;
  let fd: number;
  try {
    fd = await port.open(path, AUDIT_OPEN_FLAGS, 0o600);
  } catch {
    throw new AuditStartupError();
  }
  try {
    const stat = await port.fstat(fd);
    if (
      !stat.isFile() ||
      stat.uid !== port.geteuid() ||
      (stat.mode & 0o077) !== 0
    )
      throw new AuditStartupError();
  } catch {
    await port.close(fd).catch(() => undefined);
    throw new AuditStartupError();
  }
  return serialSink(
    async (line, check) => {
      const data = Buffer.from(line);
      const written = await port.write(fd, data);
      check();
      if (written !== data.byteLength) throw new AuditUnavailable();
      await port.fdatasync(fd);
      check();
    },
    () => port.close(fd),
    timeoutMs,
  );
}

/** The part of a writable stream the stderr sink uses. */
export interface AuditStream {
  write(chunk: string, callback: (error?: Error | null) => void): unknown;
  on?(event: "error", listener: (error: Error) => void): unknown;
}
/** BR-238/BR-240/BR-241: records on file descriptor 2, resolved by the write callback. */
export function createStderrSink(stream: AuditStream): AuditSink {
  const sink = serialSink(
    (line) =>
      new Promise<void>((resolve, reject) => {
        stream.write(line, (error) => {
          if (error) reject(new AuditUnavailable());
          else resolve();
        });
      }),
    undefined,
  );
  stream.on?.("error", () => {
    sink.latch();
  });
  return sink;
}

/** BR-238: `stderr` or an absolute file path (F-002). */
export async function openAuditSink(
  auditLog: string,
  options: { readonly stderr: AuditStream; readonly port?: AuditFilePort },
): Promise<AuditSink> {
  if (auditLog === "stderr") return createStderrSink(options.stderr);
  return openFileSink(auditLog, options.port ? { port: options.port } : {});
}

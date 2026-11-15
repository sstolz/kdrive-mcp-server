import { AsyncLocalStorage } from "node:async_hooks";
import {
  AUDIT_APPEND_TIMEOUT_MS,
  AUDIT_RECORD_MAX_BYTES,
  serializeAuditRecord,
  type AuditCode,
  type AuditIdentity,
  type AuditRecord,
  type AuditSink,
} from "./audit/sink.js";
import {
  operation as validOperation,
  type Operation,
} from "./policy/operation.js";
import type { PolicyDependencies } from "./policy/index.js";

/** F-016 admission table (BR-245): the operation kinds each tool admits. */
export const MUTATION_TOOLS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    kdrive_create_folder: Object.freeze(["create"]),
    kdrive_upload: Object.freeze(["upload-new", "replace"]),
    kdrive_rename: Object.freeze(["rename"]),
    kdrive_move: Object.freeze(["move"]),
    kdrive_trash: Object.freeze(["trash"]),
    kdrive_restore: Object.freeze(["restore"]),
    kdrive_share_link: Object.freeze(["share-link"]),
    kdrive_share_access: Object.freeze(["share-invite"]),
  });
/** BR-251: the fixed message of an `uncertain` result. */
export const UNCERTAIN_MESSAGE =
  "The upstream result is unknown; verify the item's state before any new attempt.";
/** BR-252: the fixed stderr diagnostic, written once. */
export const OUTCOME_UNRECORDED_DIAGNOSTIC =
  "Audit outcome could not be recorded; further writes are refused until restart.\n";

const MAX_ATTEMPTS = 1;
const RUN_MS = 60_000;
const ATTEMPT_MS = 30_000;
const ISS_BYTES = 4096;
const SUB_BYTES = 1024;
const REJECTED = new Set([
  400, 401, 403, 404, 405, 409, 410, 411, 412, 413, 415, 422,
]);
const UNAVAILABLE = Object.freeze({ status: "unavailable" as const });

const notSentBrand = new WeakSet<object>();
/** The only failure classified `failed`/`NOT_SENT`: no request byte was written. */
export class NotSent extends Error {
  constructor() {
    super("NOT_SENT");
    notSentBrand.add(this);
  }
}
function isNotSent(value: unknown): boolean {
  return typeof value === "object" && value !== null && notSentBrand.has(value);
}

/**
 * A per-kind upstream dispatcher (#18–#20). It returns one attempt result,
 * `{outcome:"response", status, retryAfter?, accepted, value?, created?}`,
 * or throws `NotSent` only with transport proof that nothing was sent.
 */
export type Mutator = (
  operation: Operation,
  payload: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

export type GateCode = AuditCode | "REQUEST_TIMEOUT";
/** BR-255: the only members of a gate result. */
export interface GateResult {
  readonly result: "succeeded" | "failed" | "uncertain" | "denied";
  readonly op?: string;
  readonly code?: GateCode;
  readonly attempts: number;
  readonly status?: number;
  readonly audit?: "outcome_unrecorded";
  readonly message?: string;
  readonly value?: unknown;
}

export interface MutationGateOptions {
  readonly mode: "read" | "write" | "share";
  /** Present in `write` and `share` modes (BR-238). */
  readonly sink?: AuditSink | undefined;
  readonly mutators?: Readonly<Record<string, Mutator>> | undefined;
  readonly random: (size: number) => Uint8Array;
  /** Wall clock for `ts`. */
  readonly clock: () => Date;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  readonly diagnostic: (message: string) => void;
}

export interface GateRun {
  readonly tool: unknown;
  readonly operation: unknown;
  readonly identity: unknown;
  readonly payload?: unknown;
  /** The guarded policy facade `dispatch` (BR-246). */
  dispatch(operation: Operation): Promise<unknown>;
  /** Client cancellation or session close (BR-250). */
  readonly cancellation?: AbortSignal | undefined;
  /** Navigation bounds before the intent append starts (BR-250, BR-258). */
  readonly interrupted?:
    (() => "REQUEST_TIMEOUT" | "CANCELLED" | undefined) | undefined;
}

export interface MutationGate {
  run(request: GateRun): Promise<GateResult>;
  /** BR-256: the policy `execute` dependency. */
  execute(operation: Operation): Promise<unknown>;
  readonly hasCommitted?: boolean;
  close(shutdownDeadline?: number): Promise<void>;
}

interface RunState {
  readonly op: string;
  readonly tool: string;
  readonly operation: Operation;
  readonly key: string;
  readonly identity: AuditIdentity;
  readonly payload: unknown;
  readonly cancellation: AbortSignal | undefined;
  readonly interrupted: GateRun["interrupted"];
  execution?: Promise<GateResult>;
  code?: "REQUEST_TIMEOUT" | "CANCELLED";
  /** Set once dispatch settles: no later `execute` may commit (defence in depth). */
  settled?: boolean;
}

interface Outcome {
  readonly result: "succeeded" | "failed" | "uncertain";
  readonly attempts: number;
  readonly code?: AuditCode;
  readonly status?: number;
  readonly created?: number;
  readonly value?: { readonly value: unknown };
}

type Reply =
  | { readonly kind: "unknown" }
  | { readonly kind: "not-sent" }
  | {
      readonly kind: "response";
      readonly status: number;
      readonly accepted: boolean;
      readonly retryAfter?: string;
      readonly created?: number;
      readonly value?: { readonly value: unknown };
    };
const UNKNOWN: Reply = Object.freeze({ kind: "unknown" });
const NOT_SENT: Reply = Object.freeze({ kind: "not-sent" });

function own(
  value: object,
  key: string,
): { value: unknown } | undefined | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  return "value" in descriptor ? { value: descriptor.value as unknown } : null;
}
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
/** BR-247: anything outside the attempt-result contract is unknown. */
function reply(value: unknown): Reply {
  if (typeof value !== "object" || value === null) return UNKNOWN;
  const outcome = own(value, "outcome"),
    status = own(value, "status"),
    accepted = own(value, "accepted"),
    retryAfter = own(value, "retryAfter"),
    created = own(value, "created"),
    result = own(value, "value");
  if (
    outcome?.value !== "response" ||
    typeof status?.value !== "number" ||
    !Number.isInteger(status.value) ||
    status.value < 100 ||
    status.value > 599 ||
    typeof accepted?.value !== "boolean" ||
    retryAfter === null ||
    created === null ||
    result === null
  )
    return UNKNOWN;
  const after = retryAfter?.value;
  if (
    after !== undefined &&
    (typeof after !== "string" || Buffer.byteLength(after) > 32)
  )
    return UNKNOWN;
  const id = created?.value;
  if (id !== undefined && !isId(id)) return UNKNOWN;
  return {
    kind: "response",
    status: status.value,
    accepted: accepted.value,
    ...(after === undefined ? {} : { retryAfter: after }),
    ...(id === undefined ? {} : { created: id }),
    ...(result === undefined || result.value === undefined
      ? {}
      : { value: { value: result.value } }),
  };
}
function classify(
  response: Extract<Reply, { kind: "response" }>,
  attempts: number,
): Outcome {
  const { status } = response;
  if (status >= 200 && status <= 299 && response.accepted)
    return {
      result: "succeeded",
      attempts,
      status,
      ...(response.created === undefined ? {} : { created: response.created }),
      ...(response.value === undefined ? {} : { value: response.value }),
    };
  if (REJECTED.has(status))
    return { result: "failed", attempts, status, code: "UPSTREAM_REJECTED" };
  return { result: "uncertain", attempts, status, code: "UPSTREAM_UNCERTAIN" };
}

function text(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/\p{Cs}/u.test(value) &&
    Buffer.byteLength(value) <= maxBytes
  );
}
/** BR-236/BR-237: one of the three identities, with bounded well-formed strings. */
function identityOf(value: unknown): AuditIdentity | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const keys = Reflect.ownKeys(value).toSorted((a, b) =>
    String(a).localeCompare(String(b)),
  );
  const kind = own(value, "kind")?.value;
  if ((kind === "stdio" || kind === "insecure") && keys.length === 1)
    return { kind };
  if (kind !== "oauth" || keys.join(",") !== "iss,kind,sub") return undefined;
  const iss = own(value, "iss")?.value,
    sub = own(value, "sub")?.value;
  if (!text(iss, ISS_BYTES) || !text(sub, SUB_BYTES)) return undefined;
  return { kind, iss, sub };
}
function operationKey(op: Operation): string {
  return JSON.stringify([
    op.kind,
    op.target?.driveId,
    op.target?.id,
    op.scope?.driveId,
    op.scope?.id,
    op.destination?.driveId,
    op.destination?.id,
    op.name,
    op.type,
    op.domain,
    op.query,
  ]);
}
type RecordBase = Omit<AuditRecord, "ts" | "event">;
function recordBase(
  state: Pick<RunState, "op" | "identity" | "tool" | "operation">,
): RecordBase {
  const { target, destination } = state.operation;
  const primary = target ?? destination;
  return {
    op: state.op,
    identity: state.identity,
    tool: state.tool,
    kind: state.operation.kind,
    drive: primary?.driveId ?? 0,
    ...(target && destination && destination.driveId !== target.driveId
      ? { destinationDrive: destination.driveId }
      : {}),
    ids: {
      ...(target ? { target: target.id } : {}),
      ...(destination ? { destination: destination.id } : {}),
    },
  };
}
function refusal(code: GateCode): GateResult {
  return { result: "failed", code, attempts: 0 };
}

/** F-016: the single audit gate for every write and share mutation. */
export function createMutationGate(options: MutationGateOptions): MutationGate {
  const { sink, now } = options;
  const mutators = new Map<string, Mutator>();
  for (const [kind, mutator] of Object.entries(options.mutators ?? {}))
    if (typeof mutator === "function") mutators.set(kind, mutator);
  const storage = new AsyncLocalStorage<RunState>();
  const inflight = new Set<Promise<GateResult>>();
  const states = new Set<RunState>();
  let closing: Promise<void> | undefined;
  let shutdownDeadline: number | undefined;
  let closed = false,
    diagnosed = false;
  const ts = () => options.clock().toISOString();
  function diagnose() {
    if (diagnosed) return;
    diagnosed = true;
    try {
      options.diagnostic(OUTCOME_UNRECORDED_DIAGNOSTIC);
    } catch {
      // Best effort only: diagnostic failure must never replace a gate result.
    }
  }
  sink?.onLatch?.(diagnose);
  const hasCommitted = () =>
    [...states].some((state) => state.execution !== undefined);

  function cancelled(state: RunState): boolean {
    return state.cancellation?.aborted === true;
  }
  function interruptedCode(state: RunState) {
    return (
      state.code ??
      state.interrupted?.() ??
      (cancelled(state) || closed ? "CANCELLED" : undefined)
    );
  }

  /** BR-245, BR-236, BR-237: admission, with no record and no policy call. */
  function admit(request: GateRun): RunState | GateResult {
    const tool = request.tool;
    if (typeof tool !== "string" || !Object.hasOwn(MUTATION_TOOLS, tool))
      return refusal("UNAVAILABLE");
    let op: Operation;
    try {
      op = validOperation(request.operation);
    } catch {
      return refusal("UNAVAILABLE");
    }
    if (!MUTATION_TOOLS[tool]?.includes(op.kind) || !mutators.has(op.kind))
      return refusal("UNAVAILABLE");
    if (options.mode === "read") return refusal("ACCESS_DENIED");
    if (closed || !sink || sink.latched) return refusal("AUDIT_UNAVAILABLE");
    const identity = identityOf(request.identity);
    if (!identity) return refusal("AUDIT_UNAVAILABLE");
    const shape = { op: "f".repeat(32), identity, tool, operation: op };
    const widest: AuditRecord = {
      ...recordBase(shape),
      ts: "+275760-09-13T00:00:00.000Z",
      event: "outcome",
      result: "uncertain",
      attempts: MAX_ATTEMPTS,
      ms: Number.MAX_SAFE_INTEGER,
      status: 599,
      code: "UPSTREAM_UNCERTAIN",
      created: Number.MAX_SAFE_INTEGER,
    };
    if (
      Buffer.byteLength(serializeAuditRecord(widest)) > AUDIT_RECORD_MAX_BYTES
    )
      return refusal("AUDIT_UNAVAILABLE");
    return {
      op: Buffer.from(options.random(16)).toString("hex"),
      tool,
      operation: op,
      key: operationKey(op),
      identity,
      payload: request.payload,
      cancellation: request.cancellation,
      interrupted: request.interrupted,
    };
  }

  function attempt(
    state: RunState,
    mutator: Mutator,
    ms: number,
  ): Promise<Reply> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      // BR-249: the gate aborts the attempt; its result is then unknown.
      const timer = setTimeout(
        () => {
          controller.abort();
          resolve(UNKNOWN);
        },
        Math.max(0, ms),
      );
      // A synchronous throw becomes a rejection, classified like any other.
      const pending = Promise.resolve().then(() =>
        mutator(state.operation, state.payload, controller.signal),
      );
      pending.then(
        (value) => {
          clearTimeout(timer);
          resolve(reply(value));
        },
        (error: unknown) => {
          clearTimeout(timer);
          resolve(isNotSent(error) ? NOT_SENT : UNKNOWN);
        },
      );
    });
  }
  /** BR-248 v2, BR-249 v2, BR-250 v2: classify the sole attempt, never replay. */
  async function attempts(state: RunState): Promise<Outcome> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- admission proved a mutator for this kind
    const mutator = mutators.get(state.operation.kind)!;
    const deadline = now() + RUN_MS;
    const answer = await attempt(
      state,
      mutator,
      Math.min(ATTEMPT_MS, deadline - now()),
    );
    if (answer.kind === "not-sent")
      return { result: "failed", attempts: 1, code: "NOT_SENT" };
    if (answer.kind === "unknown")
      return { result: "uncertain", attempts: 1, code: "UPSTREAM_UNCERTAIN" };
    if (answer.status === 429)
      return {
        result: "failed",
        attempts: 1,
        status: 429,
        code: "RATE_LIMITED",
      };
    return classify(answer, 1);
  }
  /** BR-243, BR-252: the outcome record, then the caller result. */
  async function finish(
    state: RunState,
    base: RecordBase,
    resolvedAt: number,
    outcome: Outcome,
  ): Promise<GateResult> {
    let unrecorded = false;
    try {
      await sink?.append({
        ...base,
        ts: ts(),
        event: "outcome",
        result: outcome.result,
        attempts: outcome.attempts,
        ms: Math.max(0, Math.round(now() - resolvedAt)),
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
        ...(outcome.created === undefined ? {} : { created: outcome.created }),
      });
    } catch {
      unrecorded = true;
      sink?.latch();
      diagnose();
    }
    return {
      result: outcome.result,
      op: state.op,
      ...(outcome.code === undefined ? {} : { code: outcome.code }),
      attempts: outcome.attempts,
      ...(outcome.status === undefined ? {} : { status: outcome.status }),
      ...(unrecorded ? { audit: "outcome_unrecorded" as const } : {}),
      ...(outcome.result === "uncertain" ? { message: UNCERTAIN_MESSAGE } : {}),
      ...(outcome.value === undefined ? {} : { value: outcome.value.value }),
    };
  }
  /** Starts at the intent append: the commit point of BR-258. */
  async function commit(state: RunState): Promise<GateResult> {
    const base = recordBase(state);
    const started = now();
    try {
      await sink?.append({ ...base, ts: ts(), event: "intent" });
    } catch {
      return {
        result: "failed",
        op: state.op,
        code: "AUDIT_UNAVAILABLE",
        attempts: 0,
      };
    }
    const resolvedAt = now();
    if (resolvedAt - started >= AUDIT_APPEND_TIMEOUT_MS)
      return finish(state, base, resolvedAt, {
        result: "failed",
        attempts: 0,
        code: "AUDIT_UNAVAILABLE",
      });
    if (cancelled(state))
      return finish(state, base, resolvedAt, {
        result: "failed",
        attempts: 0,
        code: "CANCELLED",
      });
    return finish(state, base, resolvedAt, await attempts(state));
  }
  async function decide(
    state: RunState,
    dispatch: GateRun["dispatch"],
  ): Promise<GateResult> {
    try {
      await storage.run(state, () => dispatch(state.operation));
    } catch {
      // A thrown dispatch before the commit point is a denial (BR-246).
    }
    state.settled = true;
    if (state.execution) return state.execution;
    const code = interruptedCode(state);
    if (code) return { result: "failed", op: state.op, code, attempts: 0 };
    await sink
      ?.append({
        ...recordBase(state),
        ts: ts(),
        event: "denied",
        code: "ACCESS_DENIED",
      })
      .catch(() => undefined);
    return {
      result: "denied",
      op: state.op,
      code: "ACCESS_DENIED",
      attempts: 0,
    };
  }

  return Object.freeze({
    async run(request: GateRun): Promise<GateResult> {
      const admitted = admit(request);
      if ("result" in admitted) return admitted;
      states.add(admitted);
      const task = decide(admitted, (op) => request.dispatch(op));
      inflight.add(task);
      try {
        return await task;
      } finally {
        inflight.delete(task);
        states.delete(admitted);
      }
    },
    execute(value: Operation): Promise<unknown> {
      const state = storage.getStore();
      if (!state || state.execution || state.code || state.settled)
        return Promise.resolve(UNAVAILABLE);
      let key: string;
      try {
        key = operationKey(validOperation(value));
      } catch {
        return Promise.resolve(UNAVAILABLE);
      }
      if (key !== state.key) return Promise.resolve(UNAVAILABLE);
      const code = interruptedCode(state);
      if (code) {
        state.code = code;
        return Promise.resolve(UNAVAILABLE);
      }
      state.execution = commit(state);
      return state.execution;
    },
    get hasCommitted() {
      return hasCommitted();
    },
    close(deadline?: number) {
      closed = true;
      closing ??= (async () => {
        try {
          if (deadline !== undefined && !hasCommitted()) {
            shutdownDeadline = Math.min(shutdownDeadline ?? Infinity, deadline);
            sink?.shortenDeadline?.(shutdownDeadline);
          }
          while (inflight.size) await Promise.allSettled([...inflight]);
          await sink?.close(shutdownDeadline);
        } catch {
          sink?.latch();
          diagnose();
        }
      })();
      return closing;
    },
  });
}

/** BR-256: the policy `execute` dependency bound to the gate executor. */
export function gatedDependencies<T extends PolicyDependencies>(
  dependencies: T,
  gate: MutationGate,
): T {
  return Object.freeze({
    ...dependencies,
    execute: (operation: Operation) => gate.execute(operation),
  });
}

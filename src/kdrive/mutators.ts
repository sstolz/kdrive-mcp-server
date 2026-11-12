import { NotSent, type Mutator } from "../mutation-gate.js";
import type { Operation } from "../policy/operation.js";
import type { Ref } from "../policy/values.js";
import { mutationRoutes, type MutationRoute } from "./routes.js";
import type { MutationResponse } from "./transport.js";

/** F-017: the production mutation port (BR-266–BR-269). */
export type MutationPort = (
  route: MutationRoute,
  body: Buffer | undefined,
  signal: AbortSignal,
) => Promise<MutationResponse>;

type Data = Record<string, unknown>;
const CANCEL_ID_BYTES = 256;

function plain(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
/** BR-268: the mutator alone parses a 2xx body; anything else is not accepted. */
function successData(body: Buffer | undefined): Data | undefined {
  if (body === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!plain(value) || value.result !== "success" || !plain(value.data))
    return undefined;
  return value.data;
}
/** BR-273: a cancellable action; the `cancel_id` value is never kept. */
function cancellable(data: Data): boolean {
  const cancelId = data.cancel_id;
  return (
    typeof cancelId === "string" &&
    cancelId.length > 0 &&
    Buffer.byteLength(cancelId) <= CANCEL_ID_BYTES &&
    typeof data.valid_until === "number" &&
    Number.isFinite(data.valid_until)
  );
}

interface Plan {
  readonly route: MutationRoute;
  readonly body?: Buffer;
  /** The checked new ID (`create`), `true` for an accepted action, else `false`. */
  accept(data: Data): number | boolean;
  readonly driveId: number;
  readonly id?: number;
  /** F-018 BR-285/BR-286: members appended to an accepted `value`. */
  readonly extra?: Readonly<Record<string, unknown>>;
}
function json(name: string): Buffer {
  return Buffer.from(JSON.stringify({ name }));
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new NotSent();
  return value;
}
const action = (data: Data) => cancellable(data);

/** F-018 BR-284: the payload bytes; anything else is never sent. */
function bytes(payload: unknown): Buffer {
  if (!Buffer.isBuffer(payload)) throw new NotSent();
  return payload;
}
/** F-018 BR-285/BR-286: a file called `name`, of `size` bytes, in `parent`. */
function uploaded(data: Data, name: string, size: number, parent: number) {
  return (
    isId(data.id) &&
    data.type === "file" &&
    data.name === name &&
    data.size === size &&
    data.parent_id === parent
  );
}

/** BR-271: one route per kind, built from the operation's IDs only. */
function plan(operation: Operation, payload: unknown): Plan {
  switch (operation.kind) {
    case "create": {
      const destination: Ref = required(operation.destination);
      const name = required(operation.name);
      return {
        route: mutationRoutes.create(destination.driveId, destination.id),
        body: json(name),
        driveId: destination.driveId,
        // BR-272: a new folder with the requested name under the destination.
        accept: (data) =>
          isId(data.id) &&
          data.type === "dir" &&
          data.name === name &&
          data.parent_id === destination.id
            ? data.id
            : false,
      };
    }
    case "rename": {
      const target = required(operation.target);
      return {
        route: mutationRoutes.rename(target.driveId, target.id),
        body: json(required(operation.name)),
        driveId: target.driveId,
        id: target.id,
        accept: action,
      };
    }
    case "move": {
      const target = required(operation.target);
      const destination = required(operation.destination);
      // BR-275: a single drive for source and destination.
      if (
        destination.driveId !== target.driveId ||
        operation.name !== undefined
      )
        throw new NotSent();
      return {
        route: mutationRoutes.move(target.driveId, target.id, destination.id),
        driveId: target.driveId,
        id: target.id,
        accept: action,
      };
    }
    case "trash": {
      const target = required(operation.target);
      return {
        route: mutationRoutes.trash(target.driveId, target.id),
        driveId: target.driveId,
        id: target.id,
        accept: action,
      };
    }
    case "restore": {
      const target = required(operation.target);
      return {
        route: mutationRoutes.restore(target.driveId, target.id),
        driveId: target.driveId,
        id: target.id,
        accept: action,
      };
    }
    case "upload-new": {
      const destination = required(operation.destination);
      const name = required(operation.name);
      const body = bytes(payload);
      return {
        route: mutationRoutes.upload(
          destination.driveId,
          destination.id,
          name,
          body.length,
          "error",
        ),
        body,
        driveId: destination.driveId,
        extra: { size: body.length, action: "created" },
        // BR-285: a new file with the requested name and size.
        accept: (data) =>
          uploaded(data, name, body.length, destination.id)
            ? (data.id as number)
            : false,
      };
    }
    case "replace": {
      const target = required(operation.target);
      const destination = required(operation.destination);
      const name = required(operation.name);
      const body = bytes(payload);
      if (destination.driveId !== target.driveId) throw new NotSent();
      return {
        route: mutationRoutes.upload(
          destination.driveId,
          destination.id,
          name,
          body.length,
          "version",
        ),
        body,
        driveId: target.driveId,
        id: target.id,
        extra: { size: body.length, action: "replaced" },
        // BR-286: the target itself, with the requested name and size.
        accept: (data) =>
          data.id === target.id &&
          uploaded(data, name, body.length, destination.id),
      };
    }
    default:
      throw new NotSent();
  }
}

/** F-017 BR-271–BR-273, F-018 BR-274 v2: the seven production mutators. */
export function createMutators(
  port: MutationPort,
): Readonly<Record<string, Mutator>> {
  const mutator: Mutator = async (operation, payload, signal) => {
    let planned: Plan;
    try {
      planned = plan(operation, payload);
    } catch {
      throw new NotSent();
    }
    const response = await port(planned.route, planned.body, signal);
    const data =
      response.status >= 200 && response.status <= 299
        ? successData(response.body)
        : undefined;
    const accepted = data === undefined ? false : planned.accept(data);
    const id = typeof accepted === "number" ? accepted : planned.id;
    return {
      outcome: "response",
      status: response.status,
      ...(response.retryAfter === undefined
        ? {}
        : { retryAfter: response.retryAfter }),
      accepted: accepted !== false,
      ...(accepted === false || id === undefined
        ? {}
        : { value: { drive_id: planned.driveId, id, ...planned.extra } }),
      ...(typeof accepted === "number" ? { created: accepted } : {}),
    };
  };
  return Object.freeze(
    Object.fromEntries(
      [
        "create",
        "rename",
        "move",
        "trash",
        "restore",
        "upload-new",
        "replace",
      ].map((kind) => [kind, mutator]),
    ),
  );
}

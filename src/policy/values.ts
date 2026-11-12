/** Normalized internal policy port. Provider adaptation is deliberately separate. */
export type Ref = Readonly<{ driveId: number; id: number }>;
export type Location = "live" | "original-trash";
export type Code =
  | "INVALID_OPERATION"
  | "OUTSIDE_SCOPE"
  | "EVIDENCE_UNAVAILABLE"
  | "DENIED_PATH"
  | "LEVEL_REQUIRED"
  | "TRAVERSAL_LIMIT"
  | "SHARE_RESTRICTED"
  | "SHARED_ACCESS_UNAVAILABLE";
const refusalCodes: ReadonlySet<unknown> = new Set<Code>([
  "INVALID_OPERATION",
  "OUTSIDE_SCOPE",
  "EVIDENCE_UNAVAILABLE",
  "DENIED_PATH",
  "LEVEL_REQUIRED",
  "TRAVERSAL_LIMIT",
  "SHARE_RESTRICTED",
  "SHARED_ACCESS_UNAVAILABLE",
]);
const refusalInstances = new WeakMap<object, Code>();
export class Refusal extends Error {
  constructor(readonly code: Code) {
    const safeCode: Code = refusalCodes.has(code)
      ? code
      : "EVIDENCE_UNAVAILABLE";
    super(safeCode);
    refusalInstances.set(this, safeCode);
  }
}
/** BR-046: no prototype or property access on an untrusted thrown value. */
export function refusalCode(value: unknown): Code {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function"
    ? (refusalInstances.get(value) ?? "EVIDENCE_UNAVAILABLE")
    : "EVIDENCE_UNAVAILABLE";
}
export function refuse(code: Code): never {
  throw new Refusal(code);
}
/** BR-033/035: snapshot only dense plain-array own data, never caller methods. */
export function array(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    refuse("EVIDENCE_UNAVAILABLE");
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length: unknown = lengthDescriptor?.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > max
  )
    refuse("EVIDENCE_UNAVAILABLE");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) refuse("EVIDENCE_UNAVAILABLE");
  const result: unknown[] = [];
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key))
      refuse("EVIDENCE_UNAVAILABLE");
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length)
      refuse("EVIDENCE_UNAVAILABLE");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) refuse("EVIDENCE_UNAVAILABLE");
    result[index] = descriptor.value;
  }
  return Object.freeze(result);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    refuse("EVIDENCE_UNAVAILABLE");
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    refuse("EVIDENCE_UNAVAILABLE");
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") refuse("EVIDENCE_UNAVAILABLE");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) refuse("EVIDENCE_UNAVAILABLE");
    result[key] = descriptor.value;
  }
  return result;
}
export function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    refuse("EVIDENCE_UNAVAILABLE");
  return value;
}
export function reference(value: unknown): Ref {
  const r = record(value);
  return Object.freeze({ driveId: id(r.driveId), id: id(r.id) });
}
export function key(ref: Ref): string {
  return `${String(ref.driveId)}:${String(ref.id)}`;
}
export function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    /[\\/\x00-\x1f\x7f]/u.test(value) ||
    Buffer.byteLength(value) > 4096
  )
    refuse("EVIDENCE_UNAVAILABLE");
  return value;
}
export function path(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    Buffer.byteLength(value) > 4096
  )
    refuse("EVIDENCE_UNAVAILABLE");
  if (value !== "/") for (const part of value.slice(1).split("/")) name(part);
  return value;
}
export function join(parent: string, child: string): string {
  return path(`${parent === "/" ? "" : parent}/${child}`);
}
export function within(parent: string, child: string): boolean {
  return parent === "/" || parent === child || child.startsWith(`${parent}/`);
}
export interface Parent extends Ref {
  readonly type: "dir";
  readonly name: string;
  readonly path: string;
  readonly location: Location;
  readonly lifecycle: "live";
}
export interface Item extends Ref {
  readonly status: "complete";
  readonly type: "file" | "dir";
  readonly name: string;
  readonly path: string;
  readonly parents: readonly Parent[];
  readonly location: Location;
  readonly lifecycle: "live" | "trashed";
  readonly rootId?: 1;
  readonly anchorId?: number;
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly treeRootId?: number;
}
/** BR-033/039: validate exact identity, lifecycle and every adjacent path relationship. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function item(
  value: unknown,
  expected: Ref | undefined,
  location: Location,
): Item {
  const r = record(value),
    ref = reference(r);
  if (
    r.status !== "complete" ||
    r.location !== location ||
    r.lifecycle !== (location === "live" ? "live" : "trashed") ||
    r.rootId !== 1 ||
    (r.type !== "dir" && r.type !== "file") ||
    (expected && key(ref) !== key(expected))
  )
    refuse("EVIDENCE_UNAVAILABLE");
  const itemPath = path(r.path);
  const parentValues = array(r.parents, 2048);
  const parents: Parent[] = [],
    seen = new Set<number>([ref.id]);
  let previous = "/";
  for (const raw of parentValues) {
    const p = record(raw),
      pr = reference(p),
      pp = path(p.path);
    if (
      pr.driveId !== ref.driveId ||
      seen.has(pr.id) ||
      p.type !== "dir" ||
      p.location !== location ||
      p.lifecycle !== "live"
    )
      refuse("EVIDENCE_UNAVAILABLE");
    seen.add(pr.id);
    if (pr.id === 1) {
      if (parents.length || pp !== "/" || p.name !== "")
        refuse("EVIDENCE_UNAVAILABLE");
    } else if (join(previous, name(p.name)) !== pp)
      refuse("EVIDENCE_UNAVAILABLE");
    parents.push(
      Object.freeze({
        ...pr,
        type: "dir",
        name: p.name as string,
        path: pp,
        location,
        lifecycle: "live",
      }),
    );
    previous = pp;
  }
  if (ref.id === 1) {
    if (r.type !== "dir" || itemPath !== "/" || r.name !== "" || parents.length)
      refuse("EVIDENCE_UNAVAILABLE");
  } else if (join(previous, name(r.name)) !== itemPath)
    refuse("EVIDENCE_UNAVAILABLE");
  const treeRootId =
    location === "original-trash" ? id(r.treeRootId) : undefined;
  if (
    treeRootId !== undefined &&
    treeRootId !== ref.id &&
    !parents.some((p) => p.id === treeRootId)
  )
    refuse("EVIDENCE_UNAVAILABLE");
  return Object.freeze({
    ...ref,
    status: "complete",
    type: r.type,
    name: r.name as string,
    path: itemPath,
    parents: Object.freeze(parents),
    location,
    lifecycle: location === "live" ? "live" : "trashed",
    rootId: 1,
    ...(treeRootId === undefined ? {} : { treeRootId }),
  });
}

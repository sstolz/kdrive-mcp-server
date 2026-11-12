import { array, name, record, reference, refuse, type Ref } from "./values.js";
export interface Operation {
  readonly kind: string;
  readonly target?: Ref;
  readonly scope?: Ref;
  readonly destination?: Ref;
  readonly name?: string;
  readonly type?: "file" | "dir";
  readonly domain?: string;
  readonly query?: string;
  readonly operations?: readonly Operation[];
}
const fields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  read: ["target"],
  list: ["scope"],
  search: ["scope", "query"],
  recents: ["scope"],
  "my-shared": ["scope"],
  "shared-with-me": [],
  create: ["destination", "name", "type"],
  "upload-new": ["destination", "name"],
  // F-018 BR-035 v2: the folder and name kDrive selects the file by.
  replace: ["target", "destination", "name"],
  rename: ["target", "name"],
  move: ["target", "destination", "name"],
  trash: ["target"],
  // F-017 BR-039 v2: the destination is derived by the policy core.
  restore: ["target"],
  "share-link": ["target"],
  "share-invite": ["target", "domain"],
  batch: ["operations"],
});
export const collectionKinds = new Set([
  "list",
  "search",
  "recents",
  "my-shared",
]);
export const readKinds = new Set(["read", ...collectionKinds]);
export const shareKinds = new Set(["share-link", "share-invite"]);
/** BR-035/043: strict registry, no caller effects or callbacks, copied before awaits. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function operation(value: unknown, nested = false): Operation {
  try {
    const raw = record(value),
      kind = raw.kind;
    if (
      typeof kind !== "string" ||
      !Object.hasOwn(fields, kind) ||
      (nested && kind === "batch")
    )
      refuse("INVALID_OPERATION");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- F-011: pre-existing assertion on a value checked earlier in the same flow; removing it is deferred to keep reviewed control flow unchanged (BACKLOG.md)
    const allowed = fields[kind]!;
    if (Object.keys(raw).some((k) => k !== "kind" && !allowed.includes(k)))
      refuse("INVALID_OPERATION");
    const out: {
      kind: string;
      target?: Ref;
      scope?: Ref;
      destination?: Ref;
      name?: string;
      type?: "file" | "dir";
      domain?: string;
      query?: string;
      operations?: readonly Operation[];
    } = { kind };
    for (const field of allowed) {
      if (field === "name" && kind === "move" && raw[field] === undefined)
        continue;
      if (field === "target" || field === "scope" || field === "destination") {
        const ref = record(raw[field]);
        if (Object.keys(ref).some((k) => k !== "driveId" && k !== "id"))
          refuse("INVALID_OPERATION");
        out[field] = reference(ref);
      } else if (field === "name") out.name = name(raw.name);
      else if (field === "type") {
        if (raw.type !== "file" && raw.type !== "dir")
          refuse("INVALID_OPERATION");
        out.type = raw.type;
      } else if (field === "domain") {
        if (
          typeof raw.domain !== "string" ||
          !raw.domain ||
          raw.domain.length > 253
        )
          refuse("INVALID_OPERATION");
        out.domain = raw.domain;
      } else if (field === "query") {
        if (
          typeof raw.query !== "string" ||
          Buffer.byteLength(raw.query) > 4096
        )
          refuse("INVALID_OPERATION");
        out.query = raw.query;
      } else if (field === "operations") {
        const inputs = array(raw.operations, 256);
        if (!inputs.length) refuse("INVALID_OPERATION");
        out.operations = Object.freeze(inputs.map((v) => operation(v, true)));
      }
    }
    return Object.freeze(out);
  } catch {
    return refuse("INVALID_OPERATION");
  }
}

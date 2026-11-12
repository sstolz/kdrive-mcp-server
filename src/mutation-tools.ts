import { z } from "zod";
import { name as componentName } from "./policy/values.js";
import type { Operation } from "./policy/operation.js";
import { UNCERTAIN_MESSAGE } from "./mutation-gate.js";

const identifier = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
/** F-018 BR-260 v3, BR-279 v2: no unpaired surrogate (D-18-12, D-18-14). */
const LONE_SURROGATE = /\p{Cs}/u;
const wellFormed = (value: string) => !LONE_SURROGATE.test(value);
/**
 * BR-260 v3, BR-279 v2: a valid F-003 single path component without edge
 * whitespace, well-formed UTF-16, in Unicode NFC (kDrive rewrote a decomposed
 * name, F-018 D-18-12). Shared by create_folder, rename and upload.
 */
const component = z.string().refine((value) => {
  if (/^\s|\s$/u.test(value) || !wellFormed(value)) return false;
  try {
    componentName(value);
  } catch {
    return false;
  }
  // After the 4,096-byte bound: NFC normalization is superlinear on long
  // combining-mark runs, so it only ever sees a bounded name.
  return value === value.normalize("NFC");
});
const drive = { drive_id: identifier.optional() };

/** F-018 BR-280: the decoded content bound, in bytes. */
export const UPLOAD_MAX_BYTES = 524_288;
/** F-018 BR-283: the schema description of `overwrite`. */
export const OVERWRITE_SENTENCE =
  "false (default): kDrive is asked to refuse an existing same-name file; observed behaviour, not guaranteed. true: replaces the content of file_id.";
/** F-018 BR-279: the strict `kdrive_upload` arguments. */
const uploadSchema = z
  .strictObject({
    ...drive,
    parent_id: identifier,
    name: component,
    text: z.string().optional(),
    base64: z.string().optional(),
    overwrite: z.boolean().optional().describe(OVERWRITE_SENTENCE),
    file_id: identifier.optional(),
  })
  .refine(
    (args) =>
      (args.text === undefined) !== (args.base64 === undefined) &&
      (args.file_id !== undefined) === (args.overwrite === true),
  );

/** F-017 BR-260 v3: the strict argument objects of the five mutation tools. */
export const mutationSchemas = {
  kdrive_create_folder: z.strictObject({
    ...drive,
    parent_id: identifier,
    name: component,
  }),
  kdrive_rename: z.strictObject({
    ...drive,
    file_id: identifier,
    name: component,
  }),
  kdrive_move: z.strictObject({
    ...drive,
    file_id: identifier,
    destination_folder_id: identifier,
  }),
  kdrive_trash: z.strictObject({ ...drive, file_id: identifier }),
  kdrive_restore: z.strictObject({ ...drive, file_id: identifier }),
  kdrive_upload: uploadSchema,
};
export type MutationToolName = keyof typeof mutationSchemas;
export const mutationToolNames = Object.freeze(
  Object.keys(mutationSchemas) as MutationToolName[],
);
export function isMutationTool(name: string): name is MutationToolName {
  return Object.hasOwn(mutationSchemas, name);
}

/** BR-263: the uncertain-result sentence of every mutation tool. */
export const UNCERTAIN_SENTENCE =
  "If the result is uncertain, verify the item's state with a read tool before any new attempt.";
/** F-018 BR-263 v2, BR-283 v2: the NFC sentence of the name-carrying tools. */
export const NFC_SENTENCE =
  "name must be in Unicode NFC (composed form); other forms are refused.";
/** BR-263: the fixed description sentences of each tool. */
export const mutationSentences: Readonly<Record<MutationToolName, string>> =
  Object.freeze({
    kdrive_create_folder: `Creates a folder in an authorized folder. ${NFC_SENTENCE}`,
    kdrive_rename: `Renames a file or folder in place; the current and resulting paths, and a folder's descendants, are checked. ${NFC_SENTENCE}`,
    kdrive_move:
      "Moves a file or folder to another folder of the same drive; the current and resulting paths, and a folder's descendants, are checked.",
    kdrive_trash:
      "Moves a file or folder to the kDrive trash; it never deletes permanently. A trashed folder cannot be restored through this server while deny patterns are configured.",
    kdrive_restore:
      "Restores a trashed item to its former folder only when that folder is live and authorized; otherwise the restore is refused. A folder restore is refused while deny patterns are configured.",
    // F-018 BR-283: the fixed Tool-text sentences.
    kdrive_upload: [
      "Uploads a file of at most 524,288 bytes, given as UTF-8 text or base64, into an authorized folder; the resulting path is checked.",
      "With overwrite false (the default), kDrive is asked to refuse an existing file of the same name (names are case-sensitive); this refusal is observed kDrive behaviour, not a guarantee of this server.",
      "With overwrite true, file_id must be the existing file called name in parent_id; its content is replaced in place and it keeps its ID.",
      "Use base64 for large or non-ASCII content: escaped text can exceed the transport message limit, which over stdio stops the server.",
      NFC_SENTENCE,
    ].join(" "),
  });

/** BR-261, F-018 BR-282: write annotations; trash and upload are destructive. */
export function mutationAnnotations(name: MutationToolName) {
  return {
    readOnlyHint: false,
    destructiveHint: name === "kdrive_trash" || name === "kdrive_upload",
    idempotentHint: false,
    openWorldHint: true,
  };
}

/** BR-260 v3: the Tool table's operation for validated arguments. */
export function mutationOperation(
  name: MutationToolName,
  args: Readonly<Record<string, unknown>>,
  defaultDrive: number,
): Operation {
  const driveId = (args.drive_id as number | undefined) ?? defaultDrive;
  const ref = (id: unknown) => Object.freeze({ driveId, id: id as number });
  switch (name) {
    case "kdrive_create_folder":
      return Object.freeze({
        kind: "create",
        destination: ref(args.parent_id),
        name: args.name as string,
        type: "dir" as const,
      });
    case "kdrive_rename":
      return Object.freeze({
        kind: "rename",
        target: ref(args.file_id),
        name: args.name as string,
      });
    case "kdrive_move":
      return Object.freeze({
        kind: "move",
        target: ref(args.file_id),
        destination: ref(args.destination_folder_id),
      });
    case "kdrive_trash":
      return Object.freeze({ kind: "trash", target: ref(args.file_id) });
    case "kdrive_restore":
      return Object.freeze({ kind: "restore", target: ref(args.file_id) });
    // F-018 BR-281: upload-new, or replace of the named file.
    case "kdrive_upload":
      return args.overwrite === true
        ? Object.freeze({
            kind: "replace",
            target: ref(args.file_id),
            destination: ref(args.parent_id),
            name: args.name as string,
          })
        : Object.freeze({
            kind: "upload-new",
            destination: ref(args.parent_id),
            name: args.name as string,
          });
  }
}

/** F-018 BR-280: canonical RFC 4648 §4 base64 (zero pad bits checked below). */
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
/**
 * F-018 BR-280: the content bytes of validated `kdrive_upload` arguments,
 * or the refusal code; encoding is checked before the byte bound.
 */
export function uploadContent(
  args: Readonly<Record<string, unknown>>,
): { readonly bytes: Buffer } | { readonly code: string } {
  let bytes: Buffer;
  if (typeof args.text === "string") {
    if (!wellFormed(args.text)) return { code: "INVALID_ARGUMENTS" };
    bytes = Buffer.from(args.text, "utf8");
  } else {
    const text = args.base64 as string;
    if (!BASE64.test(text)) return { code: "INVALID_ARGUMENTS" };
    bytes = Buffer.from(text, "base64");
    if (bytes.toString("base64") !== text) return { code: "INVALID_ARGUMENTS" };
  }
  if (bytes.length > UPLOAD_MAX_BYTES) return { code: "LIMIT_EXCEEDED" };
  return { bytes };
}

const RESULT_KEYS = new Set([
  "result",
  "op",
  "code",
  "attempts",
  "status",
  "audit",
  "message",
]);
/**
 * BR-262 through the stdio sanitizer: an error result whose text is a gate
 * result without `value` (failed, uncertain or denied) carries no name or path.
 */
export function isGateErrorText(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    ["failed", "uncertain", "denied"].includes(record.result as string) &&
    Object.keys(record).every((key) => RESULT_KEYS.has(key)) &&
    (record.op === undefined ||
      (typeof record.op === "string" && /^[0-9a-f]{32}$/u.test(record.op))) &&
    (record.code === undefined ||
      (typeof record.code === "string" &&
        /^[A-Z_]{1,32}$/u.test(record.code))) &&
    typeof record.attempts === "number" &&
    (record.status === undefined || typeof record.status === "number") &&
    (record.audit === undefined || record.audit === "outcome_unrecorded") &&
    (record.message === undefined || record.message === UNCERTAIN_MESSAGE)
  );
}

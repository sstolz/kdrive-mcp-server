/** BR-190 v2: the fixed route table. IDs are decimal positive safe integers. */
export interface Route {
  /** Route template without IDs, query values or host (BR-216 observer). */
  readonly template: string;
  /** Path and encoded query on the fixed API origin. */
  readonly target: string;
}

export const ITEM_WITH = "path,parents,capabilities";
export const SHARED_WITH = "path,capabilities";
export const PAGE_LIMIT = 50;

function id(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("READ_UNAVAILABLE");
  return String(value);
}

/** BR-190: query members in order, encoded by `URLSearchParams`. */
function encode(
  query: readonly (readonly [string, string | undefined])[],
): string {
  const search = new URLSearchParams();
  for (const [name, value] of query)
    if (value !== undefined) search.append(name, value);
  return search.toString();
}
function route(
  template: string,
  path: string,
  query: readonly (readonly [string, string | undefined])[],
): Route {
  const text = encode(query);
  return Object.freeze({
    template,
    target: text ? `${path}?${text}` : path,
  });
}

export const routes = Object.freeze({
  init: () => route("/2/drive/init", "/2/drive/init", [["with", "drives"]]),
  item: (driveId: number, fileId: number) =>
    route(
      "/3/drive/{d}/files/{f}",
      `/3/drive/${id(driveId)}/files/${id(fileId)}`,
      [["with", ITEM_WITH]],
    ),
  children: (driveId: number, fileId: number, cursor?: string) =>
    route(
      "/3/drive/{d}/files/{f}/files",
      `/3/drive/${id(driveId)}/files/${id(fileId)}/files`,
      [
        ["limit", String(PAGE_LIMIT)],
        ["with", ITEM_WITH],
        ["cursor", cursor],
      ],
    ),
  search: (
    driveId: number,
    query: string,
    directoryId: number | undefined,
    cursor?: string,
  ) =>
    route("/3/drive/{d}/files/search", `/3/drive/${id(driveId)}/files/search`, [
      ["query", query],
      ["limit", String(PAGE_LIMIT)],
      ["with", ITEM_WITH],
      ["directory_id", directoryId === undefined ? undefined : id(directoryId)],
      ["cursor", cursor],
    ]),
  recents: (driveId: number, cursor?: string) =>
    route(
      "/3/drive/{d}/files/recents",
      `/3/drive/${id(driveId)}/files/recents`,
      [
        ["limit", String(PAGE_LIMIT)],
        ["with", ITEM_WITH],
        ["cursor", cursor],
      ],
    ),
  myShared: (driveId: number, cursor?: string) =>
    route(
      "/3/drive/{d}/files/my_shared",
      `/3/drive/${id(driveId)}/files/my_shared`,
      [
        ["limit", String(PAGE_LIMIT)],
        ["with", ITEM_WITH],
        ["cursor", cursor],
      ],
    ),
  sharedWithMe: (cursor?: string) =>
    route("/3/drive/files/shared_with_me", "/3/drive/files/shared_with_me", [
      ["limit", String(PAGE_LIMIT)],
      ["with", SHARED_WITH],
      ["cursor", cursor],
    ]),
  download: (driveId: number, fileId: number) =>
    route(
      "/2/drive/{d}/files/{f}/download",
      `/2/drive/${id(driveId)}/files/${id(fileId)}/download`,
      [],
    ),
  /** F-017 BR-264: the trashed item's metadata. */
  trash: (driveId: number, fileId: number) =>
    route(
      "/3/drive/{d}/trash/{f}",
      `/3/drive/${id(driveId)}/trash/${id(fileId)}`,
      [["with", ITEM_WITH]],
    ),
});

/** BR-190 v3, BR-270: a mutation route; no template deletes permanently. */
export interface MutationRoute extends Route {
  readonly method: "POST" | "DELETE";
  /** F-018 BR-266 v2: the body type; JSON when absent. */
  readonly contentType?: "application/octet-stream";
}
function mutation(
  method: "POST" | "DELETE",
  template: string,
  path: string,
): MutationRoute {
  return Object.freeze({ method, template, target: path });
}

/** F-018 BR-284: the only `conflict` values ever sent. */
const CONFLICTS = new Set(["error", "version"]);

/** F-017 BR-271, F-018 BR-284: the mutation routes, one per operation kind. */
export const mutationRoutes = Object.freeze({
  create: (driveId: number, parentId: number) =>
    mutation(
      "POST",
      "/3/drive/{d}/files/{f}/directory",
      `/3/drive/${id(driveId)}/files/${id(parentId)}/directory`,
    ),
  rename: (driveId: number, fileId: number) =>
    mutation(
      "POST",
      "/2/drive/{d}/files/{f}/rename",
      `/2/drive/${id(driveId)}/files/${id(fileId)}/rename`,
    ),
  move: (driveId: number, fileId: number, parentId: number) =>
    mutation(
      "POST",
      "/3/drive/{d}/files/{f}/move/{p}",
      `/3/drive/${id(driveId)}/files/${id(fileId)}/move/${id(parentId)}`,
    ),
  trash: (driveId: number, fileId: number) =>
    mutation(
      "DELETE",
      "/2/drive/{d}/files/{f}",
      `/2/drive/${id(driveId)}/files/${id(fileId)}`,
    ),
  restore: (driveId: number, fileId: number) =>
    mutation(
      "POST",
      "/2/drive/{d}/trash/{f}/restore",
      `/2/drive/${id(driveId)}/trash/${id(fileId)}/restore`,
    ),
  /** F-018 BR-190 v3: the upload route, query members in this order. */
  upload: (
    driveId: number,
    parentId: number,
    name: string,
    size: number,
    conflict: "error" | "version",
  ): MutationRoute => {
    if (!CONFLICTS.has(conflict) || !Number.isSafeInteger(size) || size < 0)
      throw new Error("READ_UNAVAILABLE");
    const path = `/3/drive/${id(driveId)}/upload`;
    const text = encode([
      ["directory_id", id(parentId)],
      ["file_name", name],
      ["total_size", String(size)],
      ["conflict", conflict],
    ]);
    return Object.freeze({
      method: "POST",
      template: "/3/drive/{d}/upload",
      target: `${path}?${text}`,
      contentType: "application/octet-stream",
    });
  },
});

// F-014 AC-11 (BR-201) and AC-12 (BR-202).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolicy } from "../../src/policy/index.js";
import { item } from "../../src/policy/values.js";
import {
  DRIVE,
  adapterFor,
  configuration,
  invocation,
  kdriveFixture,
  providerItem,
  success,
  tree,
  type Node,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
const big: Node[] = [
  ...tree,
  { id: 20, parent: 10, type: "dir", name: "big" },
  ...Array.from({ length: 1001 }, (_, i): Node => ({
    id: 100000 + i,
    parent: 20,
    type: "file",
    name: `f${String(i)}`,
    size: 1,
  })),
];
const pageOf = (value: unknown) => value as Record<string, unknown>;
function envelopeOk(
  page: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  for (const key of Object.keys(request)) expect(page[key]).toBe(request[key]);
  expect(page.status).toBe("complete");
  const entries = page.entries as unknown[];
  expect(entries.length).toBeLessThanOrEqual(50);
  for (const entry of entries) item(entry, undefined, "live");
  expect(page.terminal === true).not.toBe(typeof page.next === "string");
}

describe("BR-201 children pages", () => {
  it("TestBR201v3_1001_children_take_21_pages_with_terminal_and_next", async () => {
    const f = (fixture = await kdriveFixture({ nodes: big }));
    const a = await adapterFor(f);
    let cursor: string | undefined;
    const sizes: number[] = [];
    for (let i = 0; i < 22; i++) {
      const request = {
        ...invocation(),
        driveId: DRIVE,
        id: 20,
        location: "live" as const,
        ...(cursor === undefined ? {} : { cursor }),
      };
      const page = pageOf(await a.dependencies.children(request));
      envelopeOk(page, request);
      sizes.push((page.entries as unknown[]).length);
      if (page.terminal === true) break;
      cursor = page.next as string;
    }
    expect(sizes).toEqual([...Array.from({ length: 20 }, () => 50), 1]);
    const listing = f
      .apiRequests()
      .filter((r) => r.path.endsWith("/files/20/files"));
    expect(listing.map((r) => r.query.get("limit"))).toEqual(
      Array.from({ length: 21 }, () => "50"),
    );
    expect(
      listing.every((r) => r.query.get("with") === "path,parents,capabilities"),
    ).toBe(true);
  });

  it("TestBR201v3_policy_traversal_of_the_folder_completes_in_21_pages_and_authorizes_the_effect", async () => {
    const f = (fixture = await kdriveFixture({ nodes: big }));
    const a = await adapterFor(f);
    const execute = vi.fn(() => Promise.resolve({ done: true }));
    const policy = createPolicy(
      await configuration({
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_DENY: "**/secret",
      }),
      {
        ...a.dependencies,
        execute,
      },
    );
    const result = await policy.dispatch({
      kind: "trash",
      target: { driveId: DRIVE, id: 20 },
    });
    expect(result).toEqual({ ok: true, value: { done: true } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      f.apiRequests().filter((r) => r.path.endsWith("/files/20/files")),
    ).toHaveLength(21);
  });

  it("TestBR201_truncated_third_page_denies_the_simulated_effect_without_execute", async () => {
    const f = (fixture = await kdriveFixture({ nodes: big }));
    f.drive.overrides.push((r) =>
      r.path.endsWith("/files/20/files") && r.query.get("cursor") === "c200"
        ? success(
            big
              .filter((n) => n.parent === 20)
              .slice(200, 300)
              .map((n) => providerItem(big, n.id)),
            { has_more: true, cursor: null },
          )
        : undefined,
    );
    const a = await adapterFor(f);
    const execute = vi.fn(() => Promise.resolve({}));
    const policy = createPolicy(
      await configuration({
        KDRIVE_MCP_MODE: "write",
        KDRIVE_MCP_DENY: "**/secret",
      }),
      {
        ...a.dependencies,
        execute,
      },
    );
    const result = await policy.dispatch({
      kind: "trash",
      target: { driveId: DRIVE, id: 20 },
    });
    expect(result).toEqual({ ok: false, code: "ACCESS_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  });

  const children = (n = 2) =>
    big
      .filter((x) => x.parent === 20)
      .slice(0, n)
      .map((x) => providerItem(big, x.id));
  it.each([
    [
      "foreign parent_id",
      {
        data: [...children(1), providerItem(big, 12)],
        has_more: false,
        cursor: null,
      },
    ],
    ["51 entries", { data: children(51), has_more: false, cursor: null }],
    [
      "has_more without cursor",
      { data: children(), has_more: true, cursor: null },
    ],
    [
      "cursor of 4097 bytes",
      { data: children(), has_more: true, cursor: "c".repeat(4097) },
    ],
    [
      "has_more false with entries from another folder",
      { data: [providerItem(big, 14)], has_more: false, cursor: null },
    ],
    [
      "has_more not boolean",
      { data: children(), has_more: "no", cursor: null },
    ],
    ["empty cursor", { data: children(), has_more: true, cursor: "" }],
    [
      "invalid entry",
      {
        data: [{ ...children(1)[0], status: "trashed" }],
        has_more: false,
        cursor: null,
      },
    ],
  ] as [string, Record<string, unknown>][])(
    "TestBR201_tampered_%s_is_incomplete",
    async (_name, body) => {
      const f = (fixture = await kdriveFixture({ nodes: big }));
      f.drive.overrides.push((r) =>
        r.path.endsWith("/files/20/files")
          ? { json: { result: "success", ...body } }
          : undefined,
      );
      const a = await adapterFor(f);
      expect(
        await a.dependencies.children({
          ...invocation(),
          driveId: DRIVE,
          id: 20,
          location: "live",
        }),
      ).toEqual({ status: "incomplete" });
    },
  );

  it("TestBR201_cursor_of_4096_bytes_is_accepted", async () => {
    const f = (fixture = await kdriveFixture({ nodes: big }));
    f.drive.overrides.push((r) =>
      r.path.endsWith("/files/20/files")
        ? {
            json: {
              result: "success",
              data: children(),
              has_more: true,
              cursor: "c".repeat(4096),
            },
          }
        : undefined,
    );
    const a = await adapterFor(f);
    const page = pageOf(
      await a.dependencies.children({
        ...invocation(),
        driveId: DRIVE,
        id: 20,
        location: "live",
      }),
    );
    expect(page.next).toBe("c".repeat(4096));
  });
});

describe("BR-202 collections", () => {
  it.each(["search", "recents", "my-shared"])(
    "TestBR202_%s_filters_by_scope_and_sends_directory_id_only_for_a_folder",
    async (kind) => {
      const f = (fixture = await kdriveFixture());
      const a = await adapterFor(f);
      const query = kind === "search" ? { query: "." } : {};
      const scoped = {
        ...invocation(),
        kind,
        scope: { driveId: DRIVE, id: 11 },
        ...query,
      };
      const inScope = pageOf(await a.dependencies.collection(scoped));
      envelopeOk(inScope, scoped);
      expect(
        (inScope.entries as { id: number }[]).map((e) => e.id).sort(),
      ).toEqual(kind === "search" ? [12, 15] : [11, 12, 15]);
      const root = {
        ...invocation(),
        kind,
        scope: { driveId: DRIVE, id: 1 },
        ...query,
      };
      const all = pageOf(await a.dependencies.collection(root));
      envelopeOk(all, root);
      expect(all.entries as unknown[]).toHaveLength(kind === "search" ? 3 : 6);
      const route = {
        search: "search",
        recents: "recents",
        "my-shared": "my_shared",
      }[kind];
      const requests = f
        .apiRequests()
        .filter((r) => r.path.endsWith(`/files/${String(route)}`));
      expect(requests).toHaveLength(2);
      expect(requests[0]?.query.get("directory_id")).toBe(
        kind === "search" ? "11" : null,
      );
      expect(requests[1]?.query.get("directory_id")).toBeNull();
      if (kind === "search")
        expect(requests.map((r) => r.query.get("query"))).toEqual([".", "."]);
    },
  );

  it("TestBR202_list_uses_the_children_route_and_echoes_the_request", async () => {
    const f = (fixture = await kdriveFixture());
    const a = await adapterFor(f);
    const request = {
      ...invocation(),
      kind: "list",
      scope: { driveId: DRIVE, id: 11 },
      cursor: "c0",
    };
    const page = pageOf(await a.dependencies.collection(request));
    envelopeOk(page, request);
    expect(f.apiRequests().at(-1)?.path).toBe("/3/drive/101/files/11/files");
  });

  it("TestBR202_query_is_passed_unchanged", async () => {
    const f = (fixture = await kdriveFixture());
    const a = await adapterFor(f);
    const query = "  Ünï cødé &=+%20 ";
    await a.dependencies.collection({
      ...invocation(),
      kind: "search",
      scope: { driveId: DRIVE, id: 1 },
      query,
    });
    expect(f.apiRequests().at(-1)?.query.get("query")).toBe(query);
  });

  it("TestBR202_invalid_envelope_is_incomplete", async () => {
    const f = (fixture = await kdriveFixture());
    f.drive.overrides.push((r) =>
      r.path.endsWith("/recents") ? success({}) : undefined,
    );
    const a = await adapterFor(f);
    expect(
      await a.dependencies.collection({
        ...invocation(),
        kind: "recents",
        scope: { driveId: DRIVE, id: 1 },
      }),
    ).toEqual({ status: "incomplete" });
  });
});

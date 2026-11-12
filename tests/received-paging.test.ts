import { expect, it } from "vitest";
import { fixture, ref, denied } from "./helpers/received.js";

it.each([
  "binding",
  "duplicate",
  "loop",
  "ceiling",
  "namespace",
  "missing-terminal",
])(
  "BR-050 BR-056 shared descendants require complete bounded pages %s",
  async (mode) => {
    const f = await fixture({
      KDRIVE_MCP_DENY: "/never",
      KDRIVE_MCP_MAX_TREE_ITEMS: mode === "ceiling" ? "2" : "10",
    });
    f.received.children.mockImplementation((request) =>
      Promise.resolve({
        ...request,
        status: "complete",
        entries:
          mode === "duplicate"
            ? [f.file, f.file]
            : mode === "ceiling"
              ? [f.file, f.other]
              : [f.file],
        ...(mode === "loop"
          ? { next: "same" }
          : mode === "missing-terminal"
            ? {}
            : { terminal: true }),
        ...(mode === "binding"
          ? { listing: {} }
          : mode === "namespace"
            ? { location: "original-trash" }
            : {}),
      }),
    );
    expect(await f.policy.dispatch({ kind: "trash", target: ref(22) })).toEqual(
      denied,
    );
    expect(f.execute).not.toHaveBeenCalled();
  },
);
it("BR-048 BR-057 discovery and collections do not expose capability proofs", async () => {
  const f = await fixture();
  for (const op of [
    { kind: "shared-with-me" },
    { kind: "list", scope: ref(22) },
  ]) {
    const result = await f.policy.dispatch(op);
    expect(result.ok).toBe(true);
    if (result.ok)
      for (const entry of (result.value as { entries: object[] }).entries) {
        expect(Object.keys(entry).sort()).toEqual([
          "driveId",
          "id",
          "name",
          "path",
          "type",
        ]);
      }
  }
});
it("BR-049 changed fresh anchor role is contradictory evidence", async () => {
  const f = await fixture();
  const original = f.received.inspect.getMockImplementation()!;
  f.received.inspect.mockImplementation((r, loc) =>
    Promise.resolve(original(r, loc)).then((i) =>
      r.id === 20 ? { ...i, role: "admin" } : i,
    ),
  );
  expect(await f.policy.dispatch({ kind: "read", target: ref(24) })).toEqual(
    denied,
  );
  expect(f.execute).not.toHaveBeenCalled();
});

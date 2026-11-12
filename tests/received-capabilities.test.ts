import { describe, expect, it } from "vitest";
import { fixture, ref, denied, mutationRows } from "./helpers/received.js";

// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
describe("received exhaustive normalized capability matrix", () => {
  for (const row of mutationRows) {
    it.each(["", "/never"])(
      "BR-050 BR-053 all required predicates permit " + row.label + " deny=%s",
      async (deny) => {
        const f = await fixture({ KDRIVE_MCP_DENY: deny });
        expect((await f.policy.dispatch(row.op)).ok).toBe(true);
        expect(f.execute).toHaveBeenCalledTimes(1);
        if (!deny) expect(f.received.children).not.toHaveBeenCalled();
      },
    );
    for (const [id, predicate] of row.needs)
      for (const value of [false, undefined, "true", 1, null]) {
        it(
          "BR-053 individually requires " +
            row.label +
            ":" +
            id +
            "." +
            predicate +
            "=" +
            String(value),
          async () => {
            const f = await fixture();
            const location =
              row.op.kind === "restore" && Number(id) !== 22
                ? "original-trash"
                : "live";
            f.items.get(location + ":8:" + id)!.capabilities[
              String(predicate)
            ] = value;
            expect(await f.policy.dispatch(row.op)).toEqual(denied);
            expect(f.execute).not.toHaveBeenCalled();
          },
        );
      }
    for (const [id, predicate] of row.needs) {
      it(
        "BR-052 each new mutation refreshes " +
          row.label +
          ":" +
          id +
          "." +
          predicate,
        async () => {
          const f = await fixture();
          expect((await f.policy.dispatch(row.op)).ok).toBe(true);
          const priorList = f.received.list.mock.calls.length,
            priorInspect = f.received.inspect.mock.calls.length;
          const location =
            row.op.kind === "restore" && Number(id) !== 22
              ? "original-trash"
              : "live";
          f.items.get(location + ":8:" + id)!.capabilities[String(predicate)] =
            false;
          expect(await f.policy.dispatch(row.op)).toEqual(denied);
          expect(f.received.list.mock.calls).toHaveLength(priorList + 1);
          expect(f.received.inspect.mock.calls.length).toBeGreaterThan(
            priorInspect,
          );
          expect(f.execute).toHaveBeenCalledTimes(1);
        },
      );
    }
  }
  for (const mode of ["read", "write", "share"])
    for (const enabled of ["0", "1"])
      for (const write of ["0", "1"]) {
        it(
          "BR-047 BR-053 exact level and both flags " +
            [mode, enabled, write].join(","),
          async () => {
            const f = await fixture({
              KDRIVE_MCP_MODE: mode,
              KDRIVE_MCP_SHARED_WITH_ME: enabled,
              KDRIVE_MCP_SHARED_WRITE: write,
            });
            for (const row of mutationRows)
              expect((await f.policy.dispatch(row.op)).ok).toBe(
                enabled === "1" && write === "1" && mode !== "read",
              );
            if (enabled === "0") expect(f.received.list).not.toHaveBeenCalled();
          },
        );
      }
  for (const kind of ["read", "list", "search", "shared-with-me"]) {
    const op =
      kind === "read"
        ? { kind, target: ref(24) }
        : kind === "shared-with-me"
          ? { kind }
          : {
              kind,
              scope: ref(22),
              ...(kind === "search" ? { query: "report" } : {}),
            };
    it("BR-048 BR-049 positive read matrix " + kind, async () => {
      const f = await fixture();
      expect((await f.policy.dispatch(op)).ok).toBe(true);
    });
    for (const predicate of kind === "list"
      ? ["read", "list"]
      : kind === "search"
        ? ["read", "search"]
        : ["read"])
      for (const value of [false, undefined, "true"]) {
        it(
          "BR-048 BR-049 missing read predicate " +
            kind +
            ":" +
            predicate +
            "=" +
            String(value),
          async () => {
            const f = await fixture();
            const target =
              kind === "read"
                ? f.file
                : kind === "shared-with-me"
                  ? f.anchor
                  : f.a;
            target.capabilities[predicate] = value;
            const result = await f.policy.dispatch(op);
            if (kind === "shared-with-me")
              expect(result).toMatchObject({
                ok: true,
                value: { entries: [] },
              });
            else expect(result).toEqual(denied);
          },
        );
      }
  }
  it("BR-048 discovery requires envelope discover=true", async () => {
    const f = await fixture();
    f.received.list.mockImplementation(async (r) => {
      await Promise.resolve();
      return {
        ...r,
        status: "complete",
        entries: [f.anchor],
        terminal: true,
        discover: false,
      };
    });
    expect(await f.policy.dispatch({ kind: "shared-with-me" })).toEqual(denied);
  });
  for (const kind of [
    "recents",
    "my-shared",
    "share-link",
    "share-invite",
    "unknown",
  ]) {
    it("BR-054 BR-055 unsupported kind refuses " + kind, async () => {
      const f = await fixture({
        KDRIVE_MCP_MODE: "share",
        KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "1",
        KDRIVE_MCP_INVITE_DOMAINS: "example.com",
      });
      const op =
        kind === "share-invite"
          ? { kind, target: ref(24), domain: "example.com" }
          : kind === "share-link"
            ? { kind, target: ref(24) }
            : { kind, scope: ref(22) };
      expect(await f.policy.dispatch(op)).toEqual(denied);
      expect(f.execute).not.toHaveBeenCalled();
    });
  }
});

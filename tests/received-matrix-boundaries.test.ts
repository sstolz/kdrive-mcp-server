import { expect, it } from "vitest";
import { fixture, ref, denied } from "./helpers/received.js";

it("BR-047 disabled discovery, read and collections never acquire received evidence", async () => {
  const f = await fixture({ KDRIVE_MCP_SHARED_WITH_ME: "0" });
  for (const op of [
    { kind: "shared-with-me" },
    { kind: "read", target: ref(20) },
    { kind: "list", scope: ref(22) },
    { kind: "search", scope: ref(22), query: "" },
  ])
    expect(await f.policy.dispatch(op)).toEqual(denied);
  expect(f.received.list).not.toHaveBeenCalled();
  expect(f.received.inspect).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
it("BR-052 fresh write list observes revocation even while read cache was valid", async () => {
  const f = await fixture();
  expect((await f.policy.dispatch({ kind: "read", target: ref(24) })).ok).toBe(
    true,
  );
  f.received.list.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      discover: true,
      entries: [],
      terminal: true,
    }),
  );
  expect(
    await f.policy.dispatch({
      kind: "replace",
      target: ref(24),
      destination: ref(22),
      name: "report",
    }),
  ).toEqual(denied);
  expect(f.received.list).toHaveBeenCalledTimes(2);
  expect(f.execute).toHaveBeenCalledTimes(1);
});
for (const mode of ["read", "write", "share"])
  for (const enabled of ["0", "1"])
    for (const write of ["0", "1"]) {
      it(
        "BR-054 unconditional root/child re-sharing denial " +
          [mode, enabled, write].join(","),
        async () => {
          const f = await fixture({
            KDRIVE_MCP_MODE: mode,
            KDRIVE_MCP_SHARED_WITH_ME: enabled,
            KDRIVE_MCP_SHARED_WRITE: write,
            KDRIVE_MCP_ALLOW_PUBLIC_LINKS: "1",
            KDRIVE_MCP_INVITE_DOMAINS: "example.com",
          });
          for (const id of [20, 24])
            for (const op of [
              { kind: "share-link", target: ref(id) },
              { kind: "share-invite", target: ref(id), domain: "example.com" },
            ])
              expect(await f.policy.dispatch(op)).toEqual(denied);
          expect(f.execute).not.toHaveBeenCalled();
        },
      );
    }
it("BR-049 BR-056 parent arrays are bounded and stale anchor aliases refuse", async () => {
  const f = await fixture();
  f.received.inspect.mockResolvedValue({
    ...f.file,
    parents: Array.from({ length: 2049 }, () => f.anchor),
  });
  expect(await f.policy.dispatch({ kind: "read", target: ref(24) })).toEqual(
    denied,
  );
  const other = await fixture();
  await other.policy.dispatch({ kind: "read", target: ref(24) });
  other.anchor.name = "Renamed";
  other.anchor.path = "/Shared/Renamed";
  expect(
    await other.policy.dispatch({ kind: "read", target: ref(20) }),
  ).toEqual(denied);
});
it("BR-050 BR-057 cross configured/external effect refuses before any execution", async () => {
  const f = await fixture();
  f.configured.inspect.mockResolvedValue({
    status: "complete",
    driveId: 7,
    id: 50,
    type: "dir",
    name: "team",
    path: "/team",
    parents: [],
    rootId: 1,
    location: "live",
    lifecycle: "live",
  });
  expect(
    await f.policy.dispatch({
      kind: "move",
      target: ref(24),
      destination: ref(50, 7),
    }),
  ).toEqual(denied);
  expect(f.execute).not.toHaveBeenCalled();
});

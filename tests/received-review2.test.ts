import { expect, it, vi } from "vitest";
import { fixture, ref, denied, node } from "./helpers/received.js";

async function collisionFixture() {
  const f = await fixture(),
    duplicate = { ...structuredClone(f.anchor), id: 30, anchorId: 30 };
  const safe = { ...node(40, "Safe", "dir"), anchorId: 40 };
  const child = { ...node(41, "report", "file", [safe]), anchorId: 40 };
  for (const i of [duplicate, safe, child]) f.items.set("live:8:" + i.id, i);
  const roots = [f.anchor, duplicate, safe];
  f.received.list.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      discover: true,
      entries: roots,
      terminal: true,
    }),
  );
  return { ...f, duplicate, safe, child, roots };
}
const safeOperations = [
  { kind: "shared-with-me" },
  { kind: "read", target: ref(40) },
  { kind: "read", target: ref(41) },
  {
    kind: "replace",
    target: ref(41),
    destination: ref(40),
    name: "report",
  },
  {
    kind: "batch",
    operations: [
      { kind: "read", target: ref(40) },
      { kind: "read", target: ref(41) },
    ],
  },
];
for (const [index, operation] of safeOperations.entries()) {
  it(
    "BR-048 BR-051 BR-056 review2 R1 whole-snapshot collision denies unrelated Safe operation " +
      index,
    async () => {
      const f = await collisionFixture();
      expect(await f.policy.dispatch(operation)).toEqual(denied);
      expect(f.received.inspect).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
}
it.each([false, true])(
  "BR-048 BR-056 review2 R1 collision index spans pages and order reversed=%s",
  async (reverse) => {
    const f = await collisionFixture();
    f.received.list.mockImplementation((r) => {
      const cursor = (r as { cursor?: string }).cursor;
      return Promise.resolve({
        ...r,
        status: "complete",
        discover: true,
        entries: cursor
          ? [reverse ? f.anchor : f.duplicate]
          : [f.safe, reverse ? f.duplicate : f.anchor],
        ...(cursor ? { terminal: true } : { next: "second" }),
      });
    });
    expect(await f.policy.dispatch({ kind: "read", target: ref(40) })).toEqual(
      denied,
    );
    expect(f.received.list).toHaveBeenCalledTimes(2);
    expect(f.received.inspect).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  },
);
it("BR-048 BR-056 review2 R1 different root types at one path still invalidate the snapshot", async () => {
  const f = await collisionFixture();
  f.duplicate.type = "file";
  expect(await f.policy.dispatch({ kind: "shared-with-me" })).toEqual(denied);
});
it("BR-051 BR-056 review2 R1 failed inconsistent refresh cannot be cached or reused", async () => {
  const f = await collisionFixture();
  f.roots.splice(0, 2);
  expect((await f.policy.dispatch({ kind: "read", target: ref(40) })).ok).toBe(
    true,
  );
  f.roots.unshift(f.anchor, f.duplicate);
  f.clock.value = 60000;
  expect(await f.policy.dispatch({ kind: "read", target: ref(40) })).toEqual(
    denied,
  );
  f.clock.value = 60001;
  f.received.list.mockRejectedValue(new Error("refresh unavailable"));
  expect(await f.policy.dispatch({ kind: "read", target: ref(40) })).toEqual(
    denied,
  );
  expect(f.received.list).toHaveBeenCalledTimes(3);
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it("BR-048 review2 R1 unique valid roots retain positive discovery/read/write controls", async () => {
  const f = await collisionFixture();
  f.roots.splice(1, 1);
  for (const op of safeOperations.slice(0, 4))
    expect((await f.policy.dispatch(op)).ok).toBe(true);
});
it("BR-048 review2 R1 valid unreadable or path-denied roots are omitted without invalidating the list", async () => {
  const f = await fixture({ KDRIVE_MCP_DENY: "/Shared/Hidden/**" });
  const hidden = { ...node(30, "Hidden", "dir"), anchorId: 30 };
  const unreadable = {
    ...node(40, "Unreadable", "dir"),
    anchorId: 40,
    capabilities: { read: false },
  };
  f.items.set("live:8:30", hidden);
  f.items.set("live:8:40", unreadable);
  f.received.list.mockImplementation((r) =>
    Promise.resolve({
      ...r,
      status: "complete",
      discover: true,
      entries: [f.anchor, hidden, unreadable],
      terminal: true,
    }),
  );
  const result = await f.policy.dispatch({ kind: "shared-with-me" });
  expect(result).toMatchObject({ ok: true, value: { entries: [{ id: 20 }] } });
  if (result.ok)
    expect((result.value as { entries: unknown[] }).entries).toHaveLength(1);
});
it.each(["case", "drive"])(
  "BR-048 BR-049 review2 R1 exact namespace boundary remains positive %s",
  async (variant) => {
    const f = await collisionFixture();
    if (variant === "case") {
      f.duplicate.name = "project";
      f.duplicate.path = "/Shared/project";
    } else {
      f.duplicate.driveId = 9;
      f.items.set("live:9:30", f.duplicate);
    }
    for (const target of [ref(20), ref(30, variant === "drive" ? 9 : 8)])
      expect((await f.policy.dispatch({ kind: "read", target })).ok).toBe(true);
  },
);

const lateCases = [
  {
    name: "read",
    op: { kind: "read", target: ref(24) },
    mutation: false,
    check: false,
  },
  {
    name: "discovery",
    op: { kind: "shared-with-me" },
    mutation: false,
    check: false,
  },
  {
    name: "list",
    op: { kind: "list", scope: ref(22) },
    mutation: false,
    check: false,
  },
  {
    name: "search",
    op: { kind: "search", scope: ref(22), query: "" },
    mutation: false,
    check: false,
  },
  {
    name: "read-batch",
    op: {
      kind: "batch",
      operations: [
        { kind: "read", target: ref(24) },
        { kind: "read", target: ref(25) },
      ],
    },
    mutation: false,
    check: false,
  },
  {
    name: "mutation",
    op: {
      kind: "replace",
      target: ref(24),
      destination: ref(22),
      name: "report",
    },
    mutation: true,
    check: false,
  },
  {
    name: "mutation-batch",
    op: {
      kind: "batch",
      operations: [
        {
          kind: "replace",
          target: ref(24),
          destination: ref(22),
          name: "report",
        },
        {
          kind: "replace",
          target: ref(25),
          destination: ref(22),
          name: "other",
        },
      ],
    },
    mutation: true,
    check: false,
  },
  {
    name: "check",
    op: { kind: "read", target: ref(24) },
    mutation: false,
    check: true,
  },
];
for (const entry of lateCases)
  for (const expires of [true, false]) {
    it(
      "BR-051 BR-057 review2 R2 synchronous terminal age for " +
        entry.name +
        " expires=" +
        String(expires),
      async () => {
        const f = await fixture();
        expect(
          (await f.policy.dispatch({ kind: "read", target: ref(24) })).ok,
        ).toBe(true);
        f.clock.value = 59999;
        // The clock only reads state; the independently queued driver alone advances it.
        const clock = vi.fn(() => f.clock.value);
        f.received.now = clock;
        let executedAt: number | undefined,
          advanced = false,
          ticks = 0;
        f.execute.mockImplementation((op) => {
          executedAt = f.clock.value;
          return Promise.resolve({ executed: op });
        });
        const pending = entry.check
          ? f.policy.check(entry.op)
          : f.policy.dispatch(entry.op);
        queueMicrotask(function tick() {
          ticks++;
          if (clock.mock.calls.length >= (entry.mutation ? 3 : 2)) {
            f.clock.value = expires ? (entry.mutation ? 119999 : 60000) : 59999;
            advanced = true;
            return;
          }
          if (ticks < 100) queueMicrotask(tick);
        });
        const result = await pending;
        expect(advanced).toBe(true);
        expect(ticks).toBeLessThanOrEqual(100);
        if (expires) {
          if (entry.check) expect(result).toMatchObject({ allowed: false });
          else expect(result).toEqual(denied);
          expect(executedAt).toBeUndefined();
          expect(f.execute).toHaveBeenCalledTimes(1);
        } else {
          expect(result).toMatchObject(
            entry.check ? { allowed: true } : { ok: true },
          );
          if (executedAt !== undefined) expect(executedAt).toBe(59999);
        }
        expect(f.received.list).toHaveBeenCalledTimes(entry.mutation ? 2 : 1);
      },
    );
  }
it("BR-051 BR-058 review2 R2 configured-only dispatch does not consult received clock", async () => {
  const f = await fixture();
  const clock = vi.fn(() => NaN);
  f.received.now = clock;
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
    (await f.policy.dispatch({ kind: "read", target: ref(50, 7) })).ok,
  ).toBe(true);
  expect(clock).not.toHaveBeenCalled();
  expect(f.received.list).not.toHaveBeenCalled();
});

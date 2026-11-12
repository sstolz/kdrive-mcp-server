import { expect, it, vi } from "vitest";
import { fixture, ref, denied } from "./helpers/received.js";

it.each([-1, NaN])(
  "BR-051 invalid clock invalidates a previously cached snapshot %s",
  async (bad) => {
    const f = await fixture(),
      read = { kind: "read", target: ref(24) };
    await f.policy.dispatch(read);
    const original = f.received.inspect.getMockImplementation()!;
    f.received.inspect.mockImplementation(async (r, loc) => {
      await Promise.resolve();
      f.clock.value = bad;
      return original(r, loc);
    });
    expect(await f.policy.dispatch(read)).toEqual(denied);
    f.clock.value = 1;
    f.received.inspect.mockImplementation(original);
    f.received.list.mockRejectedValue(new Error("revoked"));
    expect(await f.policy.dispatch(read)).toEqual(denied);
    expect(f.execute).toHaveBeenCalledTimes(1);
  },
);
it.each(["list", "search"])(
  "BR-049 BR-057 a received collection omits another permitted subtree %s",
  async (kind) => {
    const f = await fixture();
    // A valid shared-directory member, but not in the requested a subtree.
    f.received.collection.mockImplementation(async (r) => {
      await Promise.resolve();
      return {
        ...r,
        status: "complete",
        terminal: true,
        entries: [f.b],
      };
    });
    expect(
      await f.policy.dispatch({
        kind,
        scope: ref(22),
        ...(kind === "search" ? { query: "" } : {}),
      }),
    ).toMatchObject({ ok: true, value: { entries: [] } });
  },
);
it("BR-056 pending evidence never grants permission or dispatch", async () => {
  const f = await fixture();
  let finish!: (value: unknown) => void;
  f.received.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let completed = false;
  const pending = f.policy
    .dispatch({ kind: "read", target: ref(24) })
    .then((r) => {
      completed = true;
      return r;
    });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(f.execute).not.toHaveBeenCalled();
  finish({ status: "incomplete" });
  expect(await pending).toEqual(denied);
});
it("BR-057 operations are copied before evidence awaits and execute failures propagate", async () => {
  const f = await fixture(),
    raw = { kind: "read", target: ref(24) };
  const inspect = f.received.inspect.getMockImplementation()!;
  f.received.inspect.mockImplementation(async (r, loc) => {
    await Promise.resolve();
    raw.kind = "trash";
    raw.target.id = 999;
    return inspect(r, loc);
  });
  expect((await f.policy.dispatch(raw)).ok).toBe(true);
  expect(f.execute).toHaveBeenCalledWith({ kind: "read", target: ref(24) });
  f.execute.mockRejectedValue(new Error("execution uncertain"));
  await expect(
    f.policy.dispatch({ kind: "read", target: ref(24) }),
  ).rejects.toThrow("execution uncertain");
});
it("BR-056 untrusted getters and thrown objects never become diagnostics", async () => {
  const f = await fixture(),
    getter = vi.fn(() => {
      throw new Error("private");
    });
  f.received.list.mockRejectedValue(
    Object.defineProperty({}, "code", { get: getter }),
  );
  expect(await f.policy.dispatch({ kind: "read", target: ref(24) })).toEqual(
    denied,
  );
  expect(getter).not.toHaveBeenCalled();
  f.received.list.mockResolvedValue(
    Object.defineProperty({}, "status", { get: getter }),
  );
  expect(await f.policy.dispatch({ kind: "shared-with-me" })).toEqual(denied);
  expect(getter).not.toHaveBeenCalled();
});

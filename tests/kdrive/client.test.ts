import { describe, expect, it, vi } from "vitest";
import { createDriveClient } from "../../src/kdrive/client.js";

describe("drive-bound metadata client", () => {
  it("BR-002 keeps interleaved requests bound to their original drive", async () => {
    const calls: Array<[number, number]> = [];
    const adapter = vi.fn((driveId: number, fileId: number) => {
      calls.push([driveId, fileId]);
      return Promise.resolve({ driveId, fileId });
    });
    const first = createDriveClient(101, adapter);
    const second = createDriveClient(202, adapter);

    await Promise.all([first.info(11), second.info(22), first.info(33)]);

    expect(first.driveId).toBe(101);
    expect(second.driveId).toBe(202);
    expect(calls).toEqual([
      [101, 11],
      [202, 22],
      [101, 33],
    ]);
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  const invalidIds = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity];

  it.each(invalidIds)(
    "BR-002 rejects invalid drive ID %s before data access",
    (id) => {
      const adapter = vi.fn(() => Promise.resolve({}));
      expect(() => createDriveClient(id, adapter)).toThrow();
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it.each(invalidIds)(
    "BR-002 rejects invalid file ID %s before data access",
    async (id) => {
      const adapter = vi.fn(() => Promise.resolve({}));
      const client = createDriveClient(101, adapter);
      await expect(client.info(id)).rejects.toThrow();
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it("BR-003 returns the exact adapter result without reconstruction", async () => {
    const result = { id: 11, nested: { label: "synthetic" } };
    const adapter = vi.fn(() => Promise.resolve(result));
    const client = createDriveClient(101, adapter);
    await expect(client.info(11)).resolves.toBe(result);
    expect(adapter).toHaveBeenCalledExactlyOnceWith(101, 11);
  });

  it("BR-003 propagates the exact rejection without retry", async () => {
    const failure = new Error("synthetic adapter failure");
    const adapter = vi.fn(() => Promise.reject(failure));
    const client = createDriveClient(101, adapter);
    await expect(client.info(11)).rejects.toBe(failure);
    expect(adapter).toHaveBeenCalledExactlyOnceWith(101, 11);
  });

  it("BR-003 does not call the adapter while constructing clients", () => {
    const adapter = vi.fn(() => Promise.resolve({}));
    createDriveClient(101, adapter);
    createDriveClient(202, adapter);
    expect(adapter).not.toHaveBeenCalled();
  });

  it("BR-002 prevents a caller from changing the lifetime drive binding", async () => {
    const adapter = vi.fn(() => Promise.resolve(null));
    const client = createDriveClient(101, adapter);
    expect(Reflect.set(client, "driveId", 202)).toBe(false);
    await client.info(Number.MAX_SAFE_INTEGER);
    expect(adapter).toHaveBeenCalledExactlyOnceWith(
      101,
      Number.MAX_SAFE_INTEGER,
    );
  });
});

it("BR-003 import and construction perform no filesystem or network I/O", async () => {
  const { spawnSync } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const moduleUrl = pathToFileURL(resolve("dist/kdrive/client.js")).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import fs from "node:fs";
    import http from "node:http";
    import net from "node:net";
    import { syncBuiltinESMExports } from "node:module";
    const deny = () => { throw new Error("Unexpected I/O"); };
    const loaderRead = fs.readFileSync;
    let loaderReads = 0;
    fs.readFile = deny; fs.writeFile = deny;
    fs.readFileSync = (path, ...args) => {
      if (![${JSON.stringify(resolve("dist/kdrive/client.js"))}, ${JSON.stringify(moduleUrl)}].includes(String(path)) || ++loaderReads > 1) deny();
      return loaderRead(path, ...args);
    };
    fs.promises.readFile = deny; fs.promises.writeFile = deny;
    http.request = deny; http.get = deny; net.connect = deny;
    net.createConnection = deny; net.createServer = deny; globalThis.fetch = deny;
    syncBuiltinESMExports();
    const { createDriveClient } = await import(${JSON.stringify(moduleUrl)});
    createDriveClient(101, deny);
  `,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  expect(result.status, result.stderr).toBe(0);
});

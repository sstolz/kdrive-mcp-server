import { expect, it, vi } from "vitest";
import { createDriveClient } from "../../src/kdrive/client.js";

it("BR-002 v1 P-01 accepts minimum safe drive ID", () => {
  const adapter = vi.fn(() => Promise.resolve(null));
  const client = createDriveClient(1, adapter);
  expect(client.driveId).toBe(1);
  expect(adapter).not.toHaveBeenCalled();
});

it("BR-002 v1 P-02 accepts maximum safe drive ID", () => {
  const adapter = vi.fn(() => Promise.resolve(null));
  const client = createDriveClient(Number.MAX_SAFE_INTEGER, adapter);
  expect(client.driveId).toBe(Number.MAX_SAFE_INTEGER);
  expect(adapter).not.toHaveBeenCalled();
});

it("BR-002 v1 P-03 accepts minimum safe file ID", async () => {
  const result = { id: 1, label: "synthetic boundary result" };
  const adapter = vi.fn(() => Promise.resolve(result));
  const client = createDriveClient(101, adapter);
  await expect(client.info(1)).resolves.toBe(result);
  expect(adapter).toHaveBeenCalledExactlyOnceWith(101, 1);
});

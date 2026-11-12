// F-014 AC-08 (BR-197): no cache between port calls.
import { afterEach, describe, expect, it } from "vitest";
import {
  DRIVE,
  adapterFor,
  kdriveFixture,
  success,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("BR-197 freshness", () => {
  it("TestBR197_two_inspect_calls_issue_two_requests_and_see_the_change", async () => {
    const f = (fixture = await kdriveFixture());
    const a = await adapterFor(f);
    const first = await a.dependencies.inspect(
      { driveId: DRIVE, id: 12 },
      "live",
    );
    const index = f.drive.nodes.findIndex((n) => n.id === 12);
    const node = f.drive.nodes[index];
    if (node) f.drive.nodes[index] = { ...node, name: "renamed.bin" };
    const second = await a.dependencies.inspect(
      { driveId: DRIVE, id: 12 },
      "live",
    );
    expect(first).toMatchObject({ name: "a.bin" });
    expect(second).toMatchObject({
      name: "renamed.bin",
      path: "/Private/docs/renamed.bin",
    });
    expect(
      f.apiRequests().filter((r) => r.path === "/3/drive/101/files/12"),
    ).toHaveLength(2);
  });

  it("TestBR197_two_received_calls_issue_fresh_role_and_metadata_requests", async () => {
    let role = "external";
    const shared = {
      id: 500,
      drive_id: 202,
      parent_id: 77,
      type: "dir",
      status: null,
      name: "team",
      path: "/Shared/team",
      capabilities: { can_read: true },
    };
    const f = (fixture = await kdriveFixture());
    f.drive.overrides.push((r) => {
      if (r.path === "/2/drive/init")
        return success({
          drives: [
            { id: DRIVE, role: "admin" },
            { id: 202, role },
          ],
        });
      if (r.path === "/3/drive/202/files/500")
        return success({ ...shared, parents: [] });
      return undefined;
    });
    const a = await adapterFor(f);
    const first = await a.dependencies.received.inspect(
      { driveId: 202, id: 500 },
      "live",
    );
    role = "admin";
    const second = await a.dependencies.received.inspect(
      { driveId: 202, id: 500 },
      "live",
    );
    expect(first).toMatchObject({
      status: "complete",
      role: "external",
      anchorId: 500,
    });
    expect(second).toEqual({ status: "incomplete" });
    expect(
      f.apiRequests().filter((r) => r.path === "/2/drive/init"),
    ).toHaveLength(2);
    expect(
      f.apiRequests().filter((r) => r.path === "/3/drive/202/files/500"),
    ).toHaveLength(2);
  });
});

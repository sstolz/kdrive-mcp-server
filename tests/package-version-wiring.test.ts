// F-018 v3 (#100) AC-19 (F-014 BR-190, fixed request headers) and AC-20
// (D-18-15): the User-Agent and the MCP server info follow PACKAGE_VERSION.
// `src/version.js` is substituted, so a literal in the code would fail here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  API_HOST,
  DRIVE,
  adapterFor,
  kdriveFixture,
} from "./helpers/kdrive.js";
import { navigationFixture } from "./helpers/navigation.js";
import { createNavigationServer } from "../src/navigation.js";
import { PACKAGE_VERSION } from "../src/version.js";

vi.mock("../src/version.js", () => ({ PACKAGE_VERSION: "9.9.9-test" }));

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
});

describe("F-018 v3 package version wiring", () => {
  it("uses the substituted version", () => {
    expect(PACKAGE_VERSION).toBe("9.9.9-test");
  });
  it("TestBR190_user_agent_follows_PACKAGE_VERSION", async () => {
    const f = await kdriveFixture({ drives: [{ id: DRIVE, role: "admin" }] });
    cleanup.push(() => f.close());
    const a = await adapterFor(f);
    await a.preflight.inspectDrive(DRIVE);
    const api = f.upstream.seen.filter((r) => r.host === API_HOST);
    expect(api.length).toBeGreaterThan(0);
    for (const r of api)
      expect(r.headers["user-agent"]).toBe("kdrive-mcp-server/9.9.9-test");
  });
  it("server_info_version_follows_PACKAGE_VERSION", async () => {
    const f = await navigationFixture();
    const server = createNavigationServer(f.config, f.dependencies, undefined, {
      identity: { kind: "stdio" },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "version-wiring-test", version: "1" });
    await client.connect(clientSide);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    expect(client.getServerVersion()).toEqual({
      name: "kdrive-mcp-server",
      version: "9.9.9-test",
    });
  });
});

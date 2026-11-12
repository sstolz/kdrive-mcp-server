import { expect, it } from "vitest";
import { createWire, initialize } from "./helpers/navigation-wire.js";
import { navigationFixture } from "./helpers/navigation.js";

it.each(["read", "write", "share"])(
  "TestBR060_v5_tool_registration actual SDK %s continuation and canaries",
  async (mode) => {
    const f = await navigationFixture({ KDRIVE_MCP_MODE: mode });
    let calls = 0;
    f.collection.mockImplementation(async (request) => ({
      ...(await Promise.resolve(request)),
      status: "complete",
      entries: [
        {
          ...f.dir,
          users: { nested: { sharelink: "CANARY_WIRE" } },
          toJSON: () => "CANARY_WIRE",
        },
      ],
      ...(++calls === 1
        ? { next: "CANARY_PROVIDER_CURSOR" }
        : { terminal: true }),
    }));
    const w = await createWire(f.config, f.dependencies);
    try {
      w.send(initialize);
      await w.read(1);
      w.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      w.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const list = await w.read(2);
      const tools = (list.result as { tools: { name: string }[] }).tools;
      // BR-060 v6: write and share add the five F-017 tools and kdrive_upload.
      expect(tools).toHaveLength(mode === "read" ? 10 : 16);
      w.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "kdrive_list", arguments: { folder_id: 1 } },
      });
      const response = await w.read(3),
        text = (response.result as { content: { text: string }[] }).content[0]!
          .text,
        first = JSON.parse(text) as { next_cursor: string; has_more: boolean };
      expect(first.has_more).toBe(true);
      w.send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "kdrive_list",
          arguments: { folder_id: 1, cursor: first.next_cursor },
        },
      });
      const last = await w.read(4);
      expect(JSON.stringify(last)).toContain("has_more");
      expect(JSON.stringify(last)).toContain("false");
      expect(w.stdout() + w.stderr()).not.toContain("CANARY_");
    } finally {
      await w.session.close();
    }
  },
);

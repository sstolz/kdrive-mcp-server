import { expect, it } from "vitest";
import { fixture } from "./helpers/received.js";
import { contentFixture, contentError } from "./helpers/content.js";
import { createNavigationController } from "../src/navigation.js";
import { ReadFailure } from "../src/read-retry.js";
it.each(["allow", "optout", "revocation", "expiry", "transition", "retry"])(
  "TestBR109_fresh_policy received-share %s",
  async (kind) => {
    const f = await fixture(
        kind === "optout" ? { KDRIVE_MCP_SHARED_WITH_ME: "0" } : {},
      ),
      raw = await contentFixture({}, Buffer.from("Shared text"));
    if (kind === "retry")
      raw.content.describe.mockImplementationOnce(() => {
        f.file.capabilities.read = false;
        return Promise.reject(new ReadFailure(503));
      });
    else if (!["allow", "optout"].includes(kind)) {
      const original = raw.content.open.getMockImplementation()!;
      raw.content.open.mockImplementation(async (request) => {
        const response = await original(request);
        setTimeout(() => {
          if (kind === "revocation") f.file.capabilities.read = false;
          else {
            f.clock.value = 60000;
            f.received.list.mockImplementation((r) =>
              Promise.resolve({
                ...r,
                status: "complete",
                discover: true,
                terminal: true,
                entries:
                  kind === "transition"
                    ? [
                        {
                          ...f.anchor,
                          type: "file",
                          capabilities: { read: true },
                        },
                      ]
                    : [],
              }),
            );
          }
        }, 5);
        return response;
      });
    }
    const c = createNavigationController(f.config, {
      ...f.configured,
      execute: f.execute,
      received: f.received,
      content: raw.content,
    });
    try {
      const result = await c.invoke("kdrive_read", {
        drive_id: 8,
        file_id: 24,
        format: "text",
      });
      if (kind === "allow") expect(result.isError).toBeUndefined();
      else expect(result).toEqual(contentError("ACCESS_DENIED"));
      if (["optout", "retry"].includes(kind))
        expect(raw.content.open).not.toHaveBeenCalled();
      expect(
        await c.invoke("kdrive_read", {
          drive_id: 8,
          file_id: 1,
          format: "text",
        }),
      ).toEqual(contentError("ACCESS_DENIED"));
    } finally {
      c.close();
    }
  },
);

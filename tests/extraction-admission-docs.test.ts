import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { contentFixture } from "./helpers/content.js";
import { createWire, initialize } from "./helpers/navigation-wire.js";

const statements = [
  "SERVER_BUSY is a transient admission refusal before source work",
  "including extraction queue saturation",
  "an identity's waiting limit",
  "a detached worker holding its permit",
  "The server does not automatically retry",
  "a later client invocation requires fresh admission and authorization",
  "Capacity may remain unavailable until a stuck worker exits or the process restarts",
];
function validGuidance(input: string) {
  const text = input.replaceAll(/\s+/gu, " ");
  return (
    statements.every((statement) => text.includes(statement)) &&
    !text.includes("LIMIT_EXCEEDED means extraction queue saturation") &&
    !text.includes("SERVER_BUSY guarantees success on retry")
  );
}

it("TestBR424_v1_AC12_docs_explain_transient_SERVER_BUSY", async () => {
  const fixture = await contentFixture();
  const wire = await createWire(fixture.config, fixture.dependencies);
  try {
    wire.send(initialize);
    await wire.read(1);
    wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    wire.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const result = (await wire.read(2)).result as {
      tools: { name: string; description: string }[];
    };
    const read = result.tools.find((tool) => tool.name === "kdrive_read");
    expect(read).toBeDefined();
    const compatibility = await readFile(
      "docs/mcp-client-compatibility.md",
      "utf8",
    );
    const parallel =
      compatibility.split("## Parallel tool calls")[1]?.split("\n## ")[0] ?? "";
    const surfaces = [
      await readFile("README.md", "utf8"),
      read?.description ?? "",
      parallel,
    ];
    // Mutations run independently of the still-red production prose assertion.
    for (const surface of surfaces) {
      const valid =
        surface.replaceAll(/\s+/gu, " ") + " " + statements.join(". ");
      expect(validGuidance(valid)).toBe(true);
      for (const statement of statements)
        expect(validGuidance(valid.replaceAll(statement, ""))).toBe(false);
      for (const falseClaim of [
        "LIMIT_EXCEEDED means extraction queue saturation",
        "SERVER_BUSY guarantees success on retry",
      ])
        expect(validGuidance(valid + falseClaim)).toBe(false);
    }
    for (const [index, surface] of surfaces.entries())
      expect
        .soft(validGuidance(surface), `guidance surface ${String(index)}`)
        .toBe(true);
  } finally {
    await wire.session.close();
  }
});
